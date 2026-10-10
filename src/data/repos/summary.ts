import { type AccountView } from './ledgerRepo'

/**
 * مؤشّرات لوحة التحكم — معادلات صريحة لا تقديرات.
 *
 * كل رقم هنا مشتق من أرصدة الحسابات، وأرصدة الحسابات مشتقة من قيود فعلية.
 * لا رقم في هذا الملف يأتي من مكان آخر.
 */

export interface FinancialSummary {
  /** مجموع أرصدة الحسابات النقدية النشطة. */
  availableCashMinor: number
  /** ما لي عند الآخرين. **ليس نقدًا متاحًا** (القاعدة 19.9). */
  receivablesMinor: number
  /** ما عليّ للآخرين. */
  payablesMinor: number
  /** إجمالي الدخل المستلم (تراكمي). */
  totalIncomeMinor: number
  /** إجمالي المصروفات المدفوعة (تراكمي). */
  totalExpensesMinor: number
  /** صافي التدفق = الدخل − المصروفات. */
  netFlowMinor: number
  /**
   * صافي الثروة = النقد المتاح + المستحق لي − المستحق عليّ.
   *
   * **لا تُطرح الالتزامات المستقبلية غير المستحقة**: التزام لم يَحِن موعده ليس دينًا
   * قائمًا عليك بعد، وطرحه يعطي رقمًا متشائمًا لا يصف وضعك اليوم.
   */
  netWorthMinor: number
}

export function computeSummary(accounts: readonly AccountView[]): FinancialSummary {
  const active = accounts.filter((a) => a.status === 'active')
  const sum = (pred: (a: AccountView) => boolean): number =>
    active.filter(pred).reduce((s, a) => s + a.balanceMinor, 0)

  const availableCashMinor = sum((a) => a.isCashLike)
  const receivablesMinor = sum((a) => a.type === 'asset' && !a.isCashLike)
  const payablesMinor = sum((a) => a.type === 'liability')
  const totalIncomeMinor = sum((a) => a.type === 'income')
  const totalExpensesMinor = sum((a) => a.type === 'expense')

  return {
    availableCashMinor,
    receivablesMinor,
    payablesMinor,
    totalIncomeMinor,
    totalExpensesMinor,
    netFlowMinor: totalIncomeMinor - totalExpensesMinor,
    netWorthMinor: availableCashMinor + receivablesMinor - payablesMinor,
  }
}

/** المصروفات حسب الفئة، مرتَّبة تنازليًا، للرسم البياني. */
export function expensesByCategory(
  accounts: readonly AccountView[],
): { accountId: string; name: string; amountMinor: number }[] {
  return accounts
    .filter((a) => a.type === 'expense' && a.balanceMinor > 0)
    .map((a) => ({ accountId: a.accountId, name: a.name, amountMinor: a.balanceMinor }))
    .sort((x, y) => y.amountMinor - x.amountMinor)
}
