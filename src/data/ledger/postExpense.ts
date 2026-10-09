import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'

import { SEED_ACCOUNTS } from '@/domain/ledger/chartOfAccounts'
import {
  planExpense,
  type AccountSnapshot,
  type DomainError,
  type ExpenseRequest,
} from '@/domain/ops/planExpense'
import { libyaDateToUtcMs, today } from '@/lib/time'

import { db } from '../firebase/app'

/**
 * **نقطة الكتابة المالية الوحيدة في النظام.**
 *
 * كل حركة مالية تمرّ من هنا. أي كتابة مباشرة على `journalEntries` أو `accounts`
 * من أي مكان آخر تلتفّ على الحوارس وتكسر الأرصدة — ولذلك لا تُصدَّر أدوات كتابة أخرى.
 *
 * **لماذا `runTransaction` لا `writeBatch`:** القرار (هل يكفي الرصيد؟ ما قيمة المجمَّع
 * الجديد؟) يعتمد على قيم مقروءة، ويجب أن تُقرأ **خادميًا** وأن تُجهَض العملية إن تغيّرت
 * بين القراءة والالتزام. `writeBatch` لا يعطي ذلك.
 *
 * **دالة المعاملة نقية وقابلة لإعادة التنفيذ:** Firestore قد تعيد تشغيلها عدة مرات عند
 * التنافس. لذلك لا أثر جانبي داخلها، وكل القيم تُشتق من القراءات الطازجة في المحاولة الحالية.
 *
 * **منع الازدواج:** `entryId === opId` ومعرّف المستند هو نفسه. ضغط الزر مرتين أو إعادة
 * المحاولة بعد انقطاع يكتبان نفس المستند، فلا تتضاعف الحركة (ADR-004).
 */

export type PostResult =
  | { ok: true; entryId: string }
  | { ok: false; error: DomainError }
  | { ok: false; error: { code: 'DUPLICATE'; message: string } }
  | { ok: false; error: { code: 'OFFLINE' | 'PERMISSION' | 'UNKNOWN'; message: string } }

const userPath = (uid: string, rest: string): string => `users/${uid}/${rest}`

export async function postExpense(
  uid: string,
  req: ExpenseRequest,
  firestore: Firestore = db,
): Promise<PostResult> {
  const entryRef = doc(firestore, userPath(uid, `journalEntries/${req.opId}`))

  // فحص مبكر للازدواج خارج المعاملة: أرخص وأوضح رسالةً من الاعتماد على فشل الكتابة.
  // ليس ضمانًا — الضمان في معرّف المستند نفسه داخل المعاملة.
  const existing = await getDoc(entryRef).catch(() => null)
  if (existing?.exists() === true) {
    return { ok: false, error: { code: 'DUPLICATE', message: 'هذه العملية مسجَّلة بالفعل.' } }
  }

  try {
    const entryId = await runTransaction(firestore, async (tx) => {
      const fromRef = doc(firestore, userPath(uid, `accounts/${req.fromAccountId}`))
      const catRef = doc(firestore, userPath(uid, `accounts/${req.categoryAccountId}`))

      // كل القراءات أولًا — Firestore يمنع القراءة بعد الكتابة داخل المعاملة.
      const [fromSnap, catSnap] = await Promise.all([tx.get(fromRef), tx.get(catRef)])

      const toSnapshot = (s: typeof fromSnap): AccountSnapshot | undefined => {
        if (!s.exists()) return undefined
        const d = s.data()
        return {
          accountId: s.id,
          type: d['type'] as AccountSnapshot['type'],
          balanceMinor: d['balanceMinor'] as number,
          minBalanceMinor: d['minBalanceMinor'] as number,
          balanceVersion: d['balanceVersion'] as number,
          status: d['status'] as AccountSnapshot['status'],
        }
      }

      const planned = planExpense(req, { from: toSnapshot(fromSnap), category: toSnapshot(catSnap) }, today())
      if (!planned.ok) throw new DomainRejection(planned.error)
      const plan = planned.plan

      // المجمَّعات الشهرية تُقرأ لحساب قيمها المطلقة الجديدة: القواعد ترفض تراجع الحركة،
      // و increment() ليست عديمة التكرار فلا تصلح هنا.
      const periodRefs = plan.deltas.map((d) =>
        doc(firestore, userPath(uid, `accountPeriods/${d.accountId}__${plan.periodKey}`)),
      )
      const periodSnaps = await Promise.all(periodRefs.map((r) => tx.get(r)))

      const bookedAtTs = libyaDateToUtcMs(plan.bookedAt)

      tx.set(entryRef, {
        opId: plan.opId,
        ownerUid: uid,
        kind: plan.kind,
        status: 'posted',
        bookedAt: plan.bookedAt,
        bookedAtTs,
        periodKey: plan.periodKey,
        currency: 'LYD',
        schemaVersion: 1,
        description: plan.description,
        tags: plan.tags,
        refs: plan.payeeName === null ? {} : { payeeName: plan.payeeName },
        scope: plan.scope,
        lines: plan.lines,
        accountIds: plan.accountIds,
        accountTypes: plan.accountTypes,
        totalDebitMinor: plan.totalDebitMinor,
        totalCreditMinor: plan.totalCreditMinor,
        amountMinor: plan.amountMinor,
        payloadHash: hash64(plan),
        createdAt: serverTimestamp(),
        createdBy: uid,
      })

      for (const line of plan.lines) {
        tx.set(doc(firestore, userPath(uid, `postings/${plan.entryId}__${String(line.lineNo)}`)), {
          ownerUid: uid,
          entryId: plan.entryId,
          lineNo: line.lineNo,
          accountId: line.accountId,
          accountType: line.accountType,
          side: line.side,
          amountMinor: line.amountMinor,
          signedAmountMinor: line.signedAmountMinor,
          settlementDeltaMinor: line.settlementDeltaMinor,
          scope: line.scope,
          categoryId: line.categoryId,
          bookedAt: plan.bookedAt,
          bookedAtTs,
          periodKey: plan.periodKey,
          kind: plan.kind,
        })
      }

      plan.deltas.forEach((delta, i) => {
        const snap = i === 0 ? catSnap : fromSnap
        const ref = i === 0 ? catRef : fromRef
        const cur = snap.data() ?? {}
        tx.update(ref, {
          debitTotalMinor: (cur['debitTotalMinor'] as number) + delta.debitMinor,
          creditTotalMinor: (cur['creditTotalMinor'] as number) + delta.creditMinor,
          balanceMinor: (cur['balanceMinor'] as number) + delta.balanceDeltaMinor,
          entryCount: (cur['entryCount'] as number) + 1,
          balanceVersion: (cur['balanceVersion'] as number) + 1,
          earmarkedMinor: cur['earmarkedMinor'] as number,
          updatedAt: serverTimestamp(),
        })

        const ps = periodSnaps[i]
        const periodRef = periodRefs[i]
        if (periodRef === undefined) throw new Error('مرجع فترة مفقود — عيب برمجي')
        const prev = ps?.exists() === true ? ps.data() : undefined
        const debitMinor = ((prev?.['debitMinor'] as number | undefined) ?? 0) + delta.debitMinor
        const creditMinor = ((prev?.['creditMinor'] as number | undefined) ?? 0) + delta.creditMinor
        tx.set(periodRef, {
          ownerUid: uid,
          accountId: delta.accountId,
          periodKey: plan.periodKey,
          debitMinor,
          creditMinor,
          netMinor: debitMinor - creditMinor,
          updatedAt: serverTimestamp(),
        })
      })

      return plan.entryId
    })

    return { ok: true, entryId }
  } catch (err) {
    if (err instanceof DomainRejection) return { ok: false, error: err.error }
    return { ok: false, error: classify(err) }
  }
}

class DomainRejection extends Error {
  override readonly name = 'DomainRejection'
  readonly error: DomainError
  constructor(error: DomainError) {
    super(error.message)
    this.error = error
  }
}

function classify(err: unknown): { code: 'OFFLINE' | 'PERMISSION' | 'UNKNOWN'; message: string } {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : ''
  if (code === 'permission-denied') {
    return {
      code: 'PERMISSION',
      message: 'رفض الخادم العملية. تأكّد أن حسابك هو المالك المعتمد وأن القواعد منشورة.',
    }
  }
  if (code === 'unavailable' || code === 'failed-precondition' || code === 'deadline-exceeded') {
    return {
      code: 'OFFLINE',
      message:
        'تعذّر إتمام العملية — العمليات المالية تتطلب اتصالًا بالإنترنت ولم تُحفَظ. تحقّق من الاتصال وأعد المحاولة.',
    }
  }
  return { code: 'UNKNOWN', message: 'تعذّر حفظ العملية. لم يُسجَّل شيء. حاول مرة أخرى.' }
}

/**
 * بصمة الحمولة — تكشف «نفس opId بحمولة مختلفة»، وهو عيب برمجي لا تكرار عادي.
 * ليست أمنية، فلا تحتاج تجزئة تعمية؛ المطلوب حتمية وطول ثابت 64 كما تفرض القواعد.
 */
function hash64(plan: {
  opId: string
  amountMinor: number
  bookedAt: string
  accountIds: readonly string[]
}): string {
  const input = `${plan.opId}|${String(plan.amountMinor)}|${plan.bookedAt}|${plan.accountIds.join(',')}`
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  const part = (n: number): string => n.toString(16).padStart(8, '0')
  return (part(h1) + part(h2) + part(h1 ^ h2) + part((h1 + h2) >>> 0)).padEnd(64, '0').slice(0, 64)
}

/** الحسابات المطلوب إنشاؤها عند أول تسجيل دخول. */
export { SEED_ACCOUNTS }
