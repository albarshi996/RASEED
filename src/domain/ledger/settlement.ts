/**
 * التسوية — ربط العمليات المالية بالالتزامات والديون.
 *
 * **القاعدة الحاكمة (ADR-005/021):** لا مجموعة `debtPayments` منفصلة.
 * سجل الدفعات هو **استعلام على الدفتر** (`where refs.debtId == id`)، ومجموع
 * `settlementDeltaMinor` على سطور الدفتر هو **المصدر المستقل** للتحقق من `settledMinor`.
 *
 * لماذا لا مجموعة موازية؟ لأن أي مجموعة ثانية تحمل نفس الحقيقة تنحرف عنها عاجلًا أو آجلًا،
 * ولا يبقى مرجع يُحتكم إليه. أما الاستعلام فمشتق حتمًا ولا يمكن أن يختلف.
 */

import { type Minor } from '@/domain/money'

export type SettlementKind = 'debt' | 'obligation'

export interface SettlementTarget {
  kind: SettlementKind
  id: string
  /** المتبقي قبل هذه الدفعة — يُقرأ خادميًا داخل المعاملة. */
  remainingMinor: number
  /** اسم للعرض في رسائل الخطأ. */
  label: string
}

export interface SettlementRequest {
  kind: SettlementKind
  id: string
}

/** هل حالة الدين/الالتزام تسمح بتسوية جديدة؟ */
export type SettlementStatus = 'open' | 'settled' | 'cancelled' | 'writtenOff'

export function isSettleable(status: SettlementStatus): boolean {
  return status === 'open'
}

/**
 * يتحقق من أن مبلغ التسوية لا يتجاوز المتبقي.
 *
 * هذا فحص **ثانٍ** مستقل عن حارس الرصيد في `planOperation`:
 * حارس الرصيد يحمي رصيد الحساب المحاسبي، وهذا يحمي سجل الدين من تجاوز أصله.
 * الاثنان قد ينفصلان: دين سُجِّل بلا حركة نقدية ليس له رصيد حساب يحميه.
 */
export function checkSettlement(
  amountMinor: Minor,
  target: SettlementTarget,
): { ok: true } | { ok: false; code: 'OVERPAYMENT' | 'ALREADY_SETTLED'; message: string } {
  if (target.remainingMinor <= 0) {
    return {
      ok: false,
      code: 'ALREADY_SETTLED',
      message: `«${target.label}» مسدَّد بالكامل بالفعل.`,
    }
  }
  if ((amountMinor as number) > target.remainingMinor) {
    return {
      ok: false,
      code: 'OVERPAYMENT',
      message: `المبلغ يتجاوز المتبقي على «${target.label}».`,
    }
  }
  return { ok: true }
}

/** الحالة الجديدة بعد تسوية. */
export function nextStatus(remainingAfter: number): SettlementStatus {
  return remainingAfter === 0 ? 'settled' : 'open'
}
