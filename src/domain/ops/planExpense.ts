/**
 * تخطيط عملية المصروف — طبقة نقية 100%.
 *
 * **صفر استيراد من firebase أو data.** تأخذ الطلب + لقطة من الحسابات، وتُرجع خطة كتابة
 * أو خطأ نطاق. هذا ما يجعل كل القواعد المحاسبية قابلة للاختبار بلا شبكة ولا محاكي.
 *
 * القيد الناتج (القاعدة 19.1): **Dr حساب المصروف / Cr الحساب النقدي**.
 * الثابت I1 مضمون بالبناء: سطران بنفس المبلغ على جانبين متقابلين.
 */

import { accountTypeOf, normalSideOf, type AccountType } from '@/domain/ledger/chartOfAccounts'
import { MAX_ABS_MINOR, type Minor } from '@/domain/money'
import { isValidISODate, periodKeyOf, type ISODate, type PeriodKey } from '@/lib/time'

export type Scope = 'personal' | 'household'

export interface AccountSnapshot {
  accountId: string
  type: AccountType
  balanceMinor: number
  minBalanceMinor: number
  balanceVersion: number
  status: 'active' | 'archived'
}

export interface ExpenseRequest {
  opId: string
  amountMinor: Minor
  bookedAt: ISODate
  /** حساب مصروف — هو الفئة نفسها (§3.7). */
  categoryAccountId: string
  /** الحساب النقدي المدفوع منه. */
  fromAccountId: string
  description: string
  scope: Scope
  payeeName?: string
  tags?: readonly string[]
}

export interface PlannedLine {
  lineNo: number
  accountId: string
  accountType: AccountType
  side: 'debit' | 'credit'
  amountMinor: number
  signedAmountMinor: number
  scope: Scope
  categoryId: string | null
  settlementDeltaMinor: number
}

export interface AccountDelta {
  accountId: string
  debitMinor: number
  creditMinor: number
  /** أثر الحركة على الرصيد بإشارة الجانب الطبيعي للحساب. */
  balanceDeltaMinor: number
}

export interface ExpensePlan {
  opId: string
  entryId: string
  kind: 'expense'
  bookedAt: ISODate
  periodKey: PeriodKey
  amountMinor: number
  description: string
  tags: readonly string[]
  scope: Scope
  payeeName: string | null
  lines: readonly PlannedLine[]
  accountIds: readonly string[]
  accountTypes: readonly AccountType[]
  totalDebitMinor: number
  totalCreditMinor: number
  deltas: readonly AccountDelta[]
}

export type DomainErrorCode =
  | 'AMOUNT_NOT_POSITIVE'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'INVALID_DATE'
  | 'FUTURE_DATE'
  | 'CATEGORY_NOT_EXPENSE'
  | 'SOURCE_NOT_ASSET'
  | 'ACCOUNT_ARCHIVED'
  | 'ACCOUNT_MISSING'
  | 'SAME_ACCOUNT'
  | 'BALANCE_BELOW_MINIMUM'
  | 'DESCRIPTION_REQUIRED'

export const DOMAIN_ERROR_AR: Record<DomainErrorCode, string> = {
  AMOUNT_NOT_POSITIVE: 'المبلغ يجب أن يكون أكبر من صفر.',
  AMOUNT_OUT_OF_RANGE: 'المبلغ يتجاوز الحد المسموح.',
  INVALID_DATE: 'التاريخ غير صالح.',
  FUTURE_DATE: 'لا يمكن تسجيل مصروف بتاريخ مستقبلي.',
  CATEGORY_NOT_EXPENSE: 'الفئة المختارة ليست فئة مصروف.',
  SOURCE_NOT_ASSET: 'الحساب المدفوع منه ليس حسابًا نقديًا.',
  ACCOUNT_ARCHIVED: 'الحساب مؤرشف ولا يقبل حركات جديدة.',
  ACCOUNT_MISSING: 'الحساب غير موجود.',
  SAME_ACCOUNT: 'لا يمكن أن يكون المصدر والوجهة الحساب نفسه.',
  BALANCE_BELOW_MINIMUM: 'الرصيد لا يكفي. العملية ستجعل رصيد الحساب تحت الحد المسموح.',
  DESCRIPTION_REQUIRED: 'اكتب وصفًا مختصرًا للمصروف.',
}

export interface DomainError {
  code: DomainErrorCode
  message: string
  /** بيانات إضافية للعرض، مثل الرصيد المتاح عند رفض عملية. */
  detail?: Record<string, number | string>
}

export type PlanResult = { ok: true; plan: ExpensePlan } | { ok: false; error: DomainError }

const fail = (code: DomainErrorCode, detail?: Record<string, number | string>): PlanResult => ({
  ok: false,
  error:
    detail === undefined
      ? { code, message: DOMAIN_ERROR_AR[code] }
      : { code, message: DOMAIN_ERROR_AR[code], detail },
})

/**
 * يبني خطة قيد المصروف، أو يرفض بسبب مفهوم.
 *
 * `today` يُمرَّر صراحةً (لا يُقرأ من الساعة هنا) حتى تبقى الدالة نقية وقابلة للاختبار الحتمي.
 */
export function planExpense(
  req: ExpenseRequest,
  accounts: { from: AccountSnapshot | undefined; category: AccountSnapshot | undefined },
  today: ISODate,
): PlanResult {
  const amount = req.amountMinor as number

  if (!Number.isInteger(amount) || amount <= 0) return fail('AMOUNT_NOT_POSITIVE')
  if (amount > MAX_ABS_MINOR) return fail('AMOUNT_OUT_OF_RANGE')
  if (req.description.trim().length === 0) return fail('DESCRIPTION_REQUIRED')
  if (!isValidISODate(req.bookedAt)) return fail('INVALID_DATE')
  if (req.bookedAt > today) return fail('FUTURE_DATE')
  if (req.fromAccountId === req.categoryAccountId) return fail('SAME_ACCOUNT')

  const { from, category } = accounts
  if (!from) return fail('ACCOUNT_MISSING', { accountId: req.fromAccountId })
  if (!category) return fail('ACCOUNT_MISSING', { accountId: req.categoryAccountId })
  if (from.status !== 'active') return fail('ACCOUNT_ARCHIVED', { accountId: from.accountId })
  if (category.status !== 'active') return fail('ACCOUNT_ARCHIVED', { accountId: category.accountId })
  if (accountTypeOf(category.accountId) !== 'expense') return fail('CATEGORY_NOT_EXPENSE')
  if (accountTypeOf(from.accountId) !== 'asset') return fail('SOURCE_NOT_ASSET')

  // حارس الرصيد: الأصل جانبه الطبيعي مدين، فالدائن ينقصه.
  const balanceAfter = from.balanceMinor - amount
  if (balanceAfter < from.minBalanceMinor) {
    return fail('BALANCE_BELOW_MINIMUM', {
      available: from.balanceMinor,
      required: amount,
      shortfall: from.minBalanceMinor - balanceAfter,
    })
  }

  const lines: PlannedLine[] = [
    {
      lineNo: 0,
      accountId: category.accountId,
      accountType: 'expense',
      side: 'debit',
      amountMinor: amount,
      signedAmountMinor: amount,
      scope: req.scope,
      categoryId: category.accountId, // الفئة = الحساب (§3.7)
      settlementDeltaMinor: 0,
    },
    {
      lineNo: 1,
      accountId: from.accountId,
      accountType: 'asset',
      side: 'credit',
      amountMinor: amount,
      signedAmountMinor: -amount,
      scope: req.scope,
      categoryId: null,
      settlementDeltaMinor: 0,
    },
  ]

  const deltas: AccountDelta[] = lines.map((l) => {
    const natural = normalSideOf(l.accountType)
    const signed = l.side === natural ? l.amountMinor : -l.amountMinor
    return {
      accountId: l.accountId,
      debitMinor: l.side === 'debit' ? l.amountMinor : 0,
      creditMinor: l.side === 'credit' ? l.amountMinor : 0,
      balanceDeltaMinor: signed,
    }
  })

  return {
    ok: true,
    plan: {
      opId: req.opId,
      entryId: req.opId, // ADR-004
      kind: 'expense',
      bookedAt: req.bookedAt,
      periodKey: periodKeyOf(req.bookedAt),
      amountMinor: amount,
      description: req.description.trim(),
      tags: req.tags ?? [],
      scope: req.scope,
      payeeName: req.payeeName?.trim() ? req.payeeName.trim() : null,
      lines,
      accountIds: lines.map((l) => l.accountId),
      accountTypes: lines.map((l) => l.accountType),
      totalDebitMinor: amount,
      totalCreditMinor: amount,
      deltas,
    },
  }
}
