import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'

import { type Minor } from '@/domain/money'
import { libyaDateToUtcMs, periodKeyOf, today, type ISODate } from '@/lib/time'
import { ulid } from '@/lib/ulid'
import { nowMs } from '@/lib/time'

import { db } from '../firebase/app'

/**
 * الديون والالتزامات ككيانات.
 *
 * **الفرق الجوهري بينهما** (وهو ما يلتبس في معظم الأنظمة):
 * - **الدين** علاقة بشخص: مبلغ أصل محدَّد، يُسدَّد حتى ينتهي. له طرف آخر باسمه.
 * - **الالتزام** استحقاق دوري أو لمرة واحدة لجهة: إيجار، فاتورة، قسط. له موعد وتكرار.
 *
 * ولهذا للدين `principalMinor` ثابت و`settledMinor` متراكم، وللالتزام `totalMinor`
 * و`extraChargesMinor` منفصل — لأن غرامة التأخير **لا تُرفع على القيمة الأصلية**
 * المتعاقد عليها (ADR-012)، وإلا ضاع الفرق بين ما اتفقت عليه وما دفعته فعلًا.
 */

export type DebtDirection = 'payable' | 'receivable'
export type DebtStatus = 'open' | 'settled' | 'writtenOff' | 'cancelled'

export interface DebtView {
  id: string
  direction: DebtDirection
  counterpartyName: string
  principalMinor: number
  settledMinor: number
  writtenOffMinor: number
  remainingMinor: number
  status: DebtStatus
  startedAt: string
  dueDate: string | null
  notes: string
}

export type ObligationNature = 'expense' | 'financing'
export type ObligationStatus = 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled'
export type Recurrence = 'none' | 'monthly' | 'quarterly' | 'yearly'

export interface ObligationView {
  id: string
  name: string
  payeeName: string
  /** `financing` = قسط قرض: سداده **ليس مصروفًا** (ADR-011). */
  nature: ObligationNature
  totalMinor: number
  extraChargesMinor: number
  paidMinor: number
  remainingMinor: number
  dueDate: string
  recurrence: Recurrence
  priority: 'low' | 'normal' | 'high'
  status: ObligationStatus
  /** حساب المصروف الذي يُقيَّد عليه السداد عندما تكون الطبيعة `expense`. */
  categoryAccountId: string
  notes: string
}

const p = (uid: string, rest: string): string => `users/${uid}/${rest}`

// ───────────────────────────── الديون ─────────────────────────────

export interface NewDebtInput {
  direction: DebtDirection
  counterpartyName: string
  principalMinor: Minor
  startedAt: ISODate
  dueDate: ISODate | null
  notes: string
  /**
   * الحساب النقدي الذي تحرّك فعلًا، إن تحرّك.
   * `null` يعني دينًا نشأ بلا حركة نقدية (مثل: اشترى لك شيئًا وستردّ له لاحقًا).
   */
  cashAccountId: string | null
}

/**
 * ينشئ دينًا، ويسجّل معه الحركة النقدية إن وُجدت — **في معاملة واحدة**.
 *
 * الفصل بينهما كان سيسمح بحالة «دين موجود بلا قيد» أو العكس، وكلاهما انحراف
 * لا يُكتشف إلا بالمطابقة اليدوية.
 */
export async function createDebt(
  uid: string,
  input: NewDebtInput,
  firestore: Firestore = db,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const id = ulid(nowMs())
  const amount = input.principalMinor as number

  if (input.counterpartyName.trim() === '') {
    return { ok: false, message: 'اكتب اسم الطرف الآخر.' }
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: 'المبلغ يجب أن يكون أكبر من صفر.' }
  }

  const debtDoc = {
    ownerUid: uid,
    schemaVersion: 1,
    direction: input.direction,
    counterpartyName: input.counterpartyName.trim(),
    principalMinor: amount,
    settledMinor: 0,
    writtenOffMinor: 0,
    remainingMinor: amount,
    allowOverSettle: false,
    status: 'open' as DebtStatus,
    startedAt: input.startedAt,
    dueDate: input.dueDate,
    notes: input.notes.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  // بلا حركة نقدية: الكيان وحده يكفي (القاعدة 19.7 — تسجيل دين لا يعني حركة نقدية).
  if (input.cashAccountId === null) {
    try {
      await setDoc(doc(firestore, p(uid, `debts/${id}`)), debtDoc)
      return { ok: true, id }
    } catch {
      return { ok: false, message: 'تعذّر حفظ الدين.' }
    }
  }

  // مع حركة نقدية: الكيان + القيد ذرّيًا.
  const { postOperation } = await import('../ledger/postOperation')
  try {
    await setDoc(doc(firestore, p(uid, `debts/${id}`)), debtDoc)
  } catch {
    return { ok: false, message: 'تعذّر حفظ الدين.' }
  }

  const res = await postOperation(
    uid,
    {
      opId: ulid(nowMs()),
      kind: input.direction === 'payable' ? 'borrow' : 'lend',
      amountMinor: input.principalMinor,
      bookedAt: input.startedAt,
      debitAccountId: input.direction === 'payable' ? input.cashAccountId : 'asset.receivable',
      creditAccountId: input.direction === 'payable' ? 'liability.payable' : input.cashAccountId,
      description:
        input.direction === 'payable'
          ? `اقتراض من ${input.counterpartyName.trim()}`
          : `إقراض ${input.counterpartyName.trim()}`,
      counterpartyName: input.counterpartyName.trim(),
    },
    firestore,
  )

  if (!res.ok) {
    // تراجع صريح: الكيان أُنشئ والقيد فشل. نلغي الكيان بدل تركه يتيمًا.
    await updateDoc(doc(firestore, p(uid, `debts/${id}`)), {
      status: 'cancelled',
      notes: 'أُلغي تلقائيًا: فشل تسجيل الحركة النقدية المرافقة.',
      updatedAt: serverTimestamp(),
    }).catch(() => undefined)
    return { ok: false, message: res.error.message }
  }

  return { ok: true, id }
}

export function observeDebts(
  uid: string,
  cb: (rows: DebtView[]) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  const q = query(collection(firestore, p(uid, 'debts')), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const x = d.data()
          return {
            id: d.id,
            direction: (x['direction'] as DebtDirection | undefined) ?? 'payable',
            counterpartyName: (x['counterpartyName'] as string | undefined) ?? '',
            principalMinor: (x['principalMinor'] as number | undefined) ?? 0,
            settledMinor: (x['settledMinor'] as number | undefined) ?? 0,
            writtenOffMinor: (x['writtenOffMinor'] as number | undefined) ?? 0,
            remainingMinor: (x['remainingMinor'] as number | undefined) ?? 0,
            status: (x['status'] as DebtStatus | undefined) ?? 'open',
            startedAt: (x['startedAt'] as string | undefined) ?? '',
            dueDate: (x['dueDate'] as string | null | undefined) ?? null,
            notes: (x['notes'] as string | undefined) ?? '',
          }
        }),
      )
    },
    onError,
  )
}

// ──────────────────────────── الالتزامات ────────────────────────────

export interface NewObligationInput {
  name: string
  payeeName: string
  nature: ObligationNature
  totalMinor: Minor
  dueDate: ISODate
  recurrence: Recurrence
  priority: 'low' | 'normal' | 'high'
  categoryAccountId: string
  notes: string
}

/**
 * ينشئ التزامًا. **لا يُنشئ قيدًا ولا يخفض أي رصيد** (القاعدة 19.4).
 * الالتزام غير المدفوع وعدٌ بالدفع لا دفعة؛ القيد يُنشأ عند السداد الفعلي.
 */
export async function createObligation(
  uid: string,
  input: NewObligationInput,
  firestore: Firestore = db,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const amount = input.totalMinor as number
  if (input.name.trim() === '') return { ok: false, message: 'اكتب اسم الالتزام.' }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: 'المبلغ يجب أن يكون أكبر من صفر.' }
  }

  const id = ulid(nowMs())
  try {
    await setDoc(doc(firestore, p(uid, `obligations/${id}`)), {
      ownerUid: uid,
      schemaVersion: 1,
      name: input.name.trim(),
      payeeName: input.payeeName.trim(),
      nature: input.nature,
      totalMinor: amount,
      extraChargesMinor: 0,
      paidMinor: 0,
      remainingMinor: amount,
      dueDate: input.dueDate,
      dueDateTs: libyaDateToUtcMs(input.dueDate),
      periodKey: periodKeyOf(input.dueDate),
      recurrence: input.recurrence,
      priority: input.priority,
      categoryAccountId: input.categoryAccountId,
      status: statusFor(input.dueDate, 0, amount),
      notes: input.notes.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return { ok: true, id }
  } catch {
    return { ok: false, message: 'تعذّر حفظ الالتزام.' }
  }
}

/**
 * الحالة الزمنية محسوبة عند القراءة لا مكتوبة.
 *
 * على خطة Spark لا توجد جدولة خادمية تُحرّك «قادم ← مستحق ← متأخر» في مواعيدها،
 * وكتابتها عند فتح التطبيق تعني أن الحالة تتوقف على آخر مرة فتحتَه. الحساب عند
 * القراءة دائم الصحة ولا يكلّف شيئًا.
 */
export function statusFor(dueDate: string, paidMinor: number, totalMinor: number): ObligationStatus {
  if (paidMinor >= totalMinor && totalMinor > 0) return 'paid'
  const t = today()
  if (paidMinor > 0) return 'partiallyPaid'
  if (dueDate < t) return 'overdue'
  if (dueDate === t) return 'due'
  return 'upcoming'
}

export function observeObligations(
  uid: string,
  cb: (rows: ObligationView[]) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  const q = query(collection(firestore, p(uid, 'obligations')), orderBy('dueDate'))
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const x = d.data()
          const total = (x['totalMinor'] as number | undefined) ?? 0
          const paid = (x['paidMinor'] as number | undefined) ?? 0
          const due = (x['dueDate'] as string | undefined) ?? ''
          const stored = x['status'] as ObligationStatus | undefined
          return {
            id: d.id,
            name: (x['name'] as string | undefined) ?? '',
            payeeName: (x['payeeName'] as string | undefined) ?? '',
            nature: (x['nature'] as ObligationNature | undefined) ?? 'expense',
            totalMinor: total,
            extraChargesMinor: (x['extraChargesMinor'] as number | undefined) ?? 0,
            paidMinor: paid,
            remainingMinor: (x['remainingMinor'] as number | undefined) ?? total,
            dueDate: due,
            recurrence: (x['recurrence'] as Recurrence | undefined) ?? 'none',
            priority: (x['priority'] as ObligationView['priority'] | undefined) ?? 'normal',
            // الحالة المحفوظة تُحترم إن كانت نهائية، وإلا تُحسب زمنيًا.
            status:
              stored === 'cancelled' || stored === 'paid' ? stored : statusFor(due, paid, total),
            categoryAccountId: (x['categoryAccountId'] as string | undefined) ?? 'expense.other',
            notes: (x['notes'] as string | undefined) ?? '',
          }
        }),
      )
    },
    onError,
  )
}

/** إلغاء التزام. لا حذف — الأثر التاريخي محفوظ. */
export async function cancelObligation(
  uid: string,
  id: string,
  firestore: Firestore = db,
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, p(uid, `obligations/${id}`))
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    tx.update(ref, { status: 'cancelled', updatedAt: serverTimestamp() })
  })
}
