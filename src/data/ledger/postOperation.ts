import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'

import {
  planOperation,
  type AccountSnapshot,
  type DomainError,
  type OperationRequest,
} from '@/domain/ops/plan'
import { checkSettlement, type SettlementTarget } from '@/domain/ledger/settlement'
import { libyaDateToUtcMs, today } from '@/lib/time'

import { db } from '../firebase/app'

/**
 * **نقطة الكتابة المالية الوحيدة في النظام.**
 *
 * كل عملية — مصروف، دخل، تحويل، اقتراض، إقراض، تحصيل، سداد، رصيد افتتاحي — تمرّ من هنا.
 * أي كتابة مباشرة على `journalEntries` أو `accounts` من أي مكان آخر تلتفّ على الحوارس
 * وتكسر الأرصدة، ولذلك لا تُصدَّر أدوات كتابة أخرى من هذه الطبقة.
 *
 * **`runTransaction` لا `writeBatch`:** القرار (هل يكفي الرصيد؟ ما قيمة المجمَّع الجديد؟)
 * يعتمد على قيم مقروءة، ويجب أن تُقرأ خادميًا وأن تُجهَض العملية إن تغيّرت بين القراءة
 * والالتزام. ولهذا تحديدًا تفشل العمليات المالية دون اتصال بدل أن تعمل على بيانات قديمة.
 *
 * **دالة المعاملة نقية:** Firestore قد تعيد تشغيلها عند التنافس، فلا أثر جانبي داخلها
 * وكل القيم مشتقة من قراءات المحاولة الحالية.
 */

export type PostError = DomainError | { code: 'DUPLICATE' | 'OFFLINE' | 'PERMISSION' | 'UNKNOWN'; message: string }
export type PostResult = { ok: true; entryId: string } | { ok: false; error: PostError }

const p = (uid: string, rest: string): string => `users/${uid}/${rest}`

export async function postOperation(
  uid: string,
  req: OperationRequest,
  firestore: Firestore = db,
): Promise<PostResult> {
  const entryRef = doc(firestore, p(uid, `journalEntries/${req.opId}`))

  // فحص مبكر للازدواج: رسالة أوضح من فشل كتابة. ليس ضمانًا —
  // الضمان أن معرّف المستند هو opId نفسه، فالكتابة الثانية تستبدل لا تضاعف.
  const existing = await getDoc(entryRef).catch(() => null)
  if (existing?.exists() === true) {
    return { ok: false, error: { code: 'DUPLICATE', message: 'هذه العملية مسجَّلة بالفعل.' } }
  }

  try {
    const entryId = await runTransaction(firestore, async (tx) => {
      const debitRef = doc(firestore, p(uid, `accounts/${req.debitAccountId}`))
      const creditRef = doc(firestore, p(uid, `accounts/${req.creditAccountId}`))

      // كل القراءات أولًا — Firestore يمنع القراءة بعد الكتابة داخل المعاملة.
      const [debitSnap, creditSnap] = await Promise.all([tx.get(debitRef), tx.get(creditRef)])

      const toSnapshot = (s: typeof debitSnap): AccountSnapshot | undefined => {
        if (!s.exists()) return undefined
        const d = s.data()
        return {
          accountId: s.id,
          type: d['type'] as AccountSnapshot['type'],
          balanceMinor: d['balanceMinor'] as number,
          minBalanceMinor: d['minBalanceMinor'] as number,
          status: d['status'] as AccountSnapshot['status'],
          isCashLike: (d['isCashLike'] as boolean | undefined) ?? false,
        }
      }

      const planned = planOperation(
        req,
        { debit: toSnapshot(debitSnap), credit: toSnapshot(creditSnap) },
        today(),
      )
      if (!planned.ok) throw new DomainRejection(planned.error)
      const plan = planned.plan

      // المجمَّعات الشهرية تُقرأ لحساب قيمها المطلقة: القواعد ترفض تراجع الحركة،
      // و increment() ليست عديمة التكرار فلا تصلح داخل معاملة قد تُعاد.
      const periodRefs = plan.deltas.map((d) =>
        doc(firestore, p(uid, `accountPeriods/${d.accountId}__${plan.periodKey}`)),
      )
      const periodSnaps = await Promise.all(periodRefs.map((r) => tx.get(r)))

      // التسوية: تُقرأ ضمن قراءات المعاملة ثم تُحدَّث معها ذرّيًا.
      // لو حُدِّثت خارجها لأمكن أن يُسجَّل القيد ويفشل تحديث الدين، فينحرف السجلّان.
      let settlementRef: ReturnType<typeof doc> | null = null
      let settlementNext: Record<string, unknown> | null = null
      if (plan.settlement !== null) {
        const isDebt = plan.settlement.kind === 'debt'
        settlementRef = doc(
          firestore,
          p(uid, `${isDebt ? 'debts' : 'obligations'}/${plan.settlement.id}`),
        )
        const snap = await tx.get(settlementRef)
        if (!snap.exists()) {
          throw new DomainRejection({
            code: 'ACCOUNT_MISSING',
            message: isDebt ? 'الدين غير موجود.' : 'الالتزام غير موجود.',
          })
        }
        const d = snap.data()
        const target: SettlementTarget = {
          kind: plan.settlement.kind,
          id: plan.settlement.id,
          remainingMinor: d['remainingMinor'] as number,
          label: (d['name'] as string | undefined) ?? (d['counterpartyName'] as string | undefined) ?? 'السجل',
        }
        const check = checkSettlement(req.amountMinor, target)
        if (!check.ok) {
          throw new DomainRejection({ code: 'OVERPAYMENT', message: check.message })
        }

        if (isDebt) {
          const settled = (d['settledMinor'] as number) + plan.amountMinor
          const remaining = (d['principalMinor'] as number) - settled - (d['writtenOffMinor'] as number)
          settlementNext = {
            settledMinor: settled,
            remainingMinor: remaining,
            status: remaining === 0 ? 'settled' : 'open',
            lastPaymentAt: plan.bookedAt,
            updatedAt: serverTimestamp(),
          }
        } else {
          const paid = (d['paidMinor'] as number) + plan.amountMinor
          const remaining =
            (d['totalMinor'] as number) + (d['extraChargesMinor'] as number) - paid
          settlementNext = {
            paidMinor: paid,
            remainingMinor: remaining,
            status: remaining === 0 ? 'paid' : 'partiallyPaid',
            lastPaymentAt: plan.bookedAt,
            updatedAt: serverTimestamp(),
          }
        }
      }

      const bookedAtTs = libyaDateToUtcMs(plan.bookedAt)
      const refs: Record<string, string> = {}
      if (plan.counterpartyName !== null) refs['counterpartyName'] = plan.counterpartyName
      if (plan.settlement !== null) {
        refs[plan.settlement.kind === 'debt' ? 'debtId' : 'obligationId'] = plan.settlement.id
      }

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
        refs,
        scope: plan.scope,
        lines: plan.lines,
        accountIds: plan.accountIds,
        accountTypes: plan.accountTypes,
        totalDebitMinor: plan.totalDebitMinor,
        totalCreditMinor: plan.totalCreditMinor,
        amountMinor: plan.amountMinor,
        payloadHash: payloadHash(plan),
        createdAt: serverTimestamp(),
        createdBy: uid,
      })

      for (const line of plan.lines) {
        tx.set(doc(firestore, p(uid, `postings/${plan.entryId}__${String(line.lineNo)}`)), {
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
        const isDebitLeg = delta.accountId === req.debitAccountId
        const snap = isDebitLeg ? debitSnap : creditSnap
        const ref = isDebitLeg ? debitRef : creditRef
        const cur = snap.data()
        if (cur === undefined) throw new Error('ACCOUNT_VANISHED')

        tx.update(ref, {
          debitTotalMinor: (cur['debitTotalMinor'] as number) + delta.debitMinor,
          creditTotalMinor: (cur['creditTotalMinor'] as number) + delta.creditMinor,
          balanceMinor: (cur['balanceMinor'] as number) + delta.balanceDeltaMinor,
          openingBalanceMinor:
            plan.kind === 'opening' && isDebitLeg
              ? (cur['openingBalanceMinor'] as number) + plan.amountMinor
              : (cur['openingBalanceMinor'] as number),
          entryCount: (cur['entryCount'] as number) + 1,
          balanceVersion: (cur['balanceVersion'] as number) + 1,
          earmarkedMinor: cur['earmarkedMinor'] as number,
          updatedAt: serverTimestamp(),
        })

        const periodRef = periodRefs[i]
        if (periodRef === undefined) throw new Error('PERIOD_REF_MISSING')
        const periodSnap = periodSnaps[i]
        const prev = periodSnap?.exists() === true ? periodSnap.data() : undefined
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

      if (settlementRef !== null && settlementNext !== null) {
        tx.update(settlementRef, settlementNext)
      }

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
    return { code: 'PERMISSION', message: 'رفض الخادم العملية. تأكّد أن حسابك هو المالك المعتمد.' }
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return {
      code: 'OFFLINE',
      message:
        'تعذّر إتمام العملية — العمليات المالية تتطلب اتصالًا ولم يُحفَظ شيء. تحقّق من الاتصال وأعد المحاولة.',
    }
  }
  return { code: 'UNKNOWN', message: 'تعذّر حفظ العملية. لم يُسجَّل شيء. حاول مرة أخرى.' }
}

/**
 * بصمة الحمولة — تكشف «نفس opId بحمولة مختلفة»، وهو عيب برمجي لا تكرار عادي.
 * ليست أمنية فلا تحتاج تجزئة تعمية؛ المطلوب حتمية وطول 64 كما تفرض القواعد.
 */
function payloadHash(plan: {
  opId: string
  kind: string
  amountMinor: number
  bookedAt: string
  accountIds: readonly string[]
}): string {
  const input = `${plan.opId}|${plan.kind}|${String(plan.amountMinor)}|${plan.bookedAt}|${plan.accountIds.join(',')}`
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
