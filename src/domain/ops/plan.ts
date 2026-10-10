/**
 * مُخطِّط العمليات المالية الموحَّد — طبقة نقية 100%.
 *
 * **لماذا مُخطِّط واحد لا مُخطِّط لكل عملية:** كل حركة مالية في «رصيد» هي قيد من طرفين:
 * مدين واحد ودائن واحد. ما يفرّق بينها ليس آلية الكتابة بل **أي حسابين** و**أي أنواع**
 * يُسمح بها. فجعلُ الفرق جدولَ مواصفات بدل سبع دوال متشابهة يعني:
 * قاعدة واحدة للتوازن، وحارس رصيد واحد، ومسار كتابة واحد يُختبر مرة.
 *
 * **نتيجة مجانية مهمة:** حارس الرصيد العام يمنع السداد الزائد بلا منطق خاص.
 * سداد دين قيمته 300 بمبلغ 500 يعني Dr خصوم 500 على رصيد 300 ⇒ رصيد سالب ⇒ مرفوض.
 */

import { accountTypeOf, normalSideOf, type AccountType } from '@/domain/ledger/chartOfAccounts'
import { MAX_ABS_MINOR, type Minor } from '@/domain/money'
import { isValidISODate, periodKeyOf, type ISODate, type PeriodKey } from '@/lib/time'

export type Scope = 'personal' | 'household'

export type OpKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'borrow'
  | 'lend'
  | 'collectDebt'
  | 'payDebt'
  | 'opening'

export interface AccountSnapshot {
  accountId: string
  type: AccountType
  balanceMinor: number
  minBalanceMinor: number
  status: 'active' | 'archived'
  isCashLike: boolean
}

export interface OperationRequest {
  opId: string
  kind: OpKind
  amountMinor: Minor
  bookedAt: ISODate
  /** الحساب الذي **يستقبل** القيمة (الطرف المدين). */
  debitAccountId: string
  /** الحساب الذي **تخرج منه** القيمة (الطرف الدائن). */
  creditAccountId: string
  description: string
  scope?: Scope
  counterpartyName?: string
  tags?: readonly string[]
}

/** قيود كل عملية: أي أنواع حسابات يُسمح بها على كل طرف. */
interface KindSpec {
  /** الأنواع المسموحة للطرف المدين. */
  debitTypes: readonly AccountType[]
  /** الأنواع المسموحة للطرف الدائن. */
  creditTypes: readonly AccountType[]
  /** هل يجب أن يكون الطرف المدين حسابًا نقديًا؟ */
  debitCashLike?: boolean
  creditCashLike?: boolean
  label: string
}

const SPECS: Record<OpKind, KindSpec> = {
  expense: { debitTypes: ['expense'], creditTypes: ['asset'], creditCashLike: true, label: 'مصروف' },
  income: { debitTypes: ['asset'], creditTypes: ['income'], debitCashLike: true, label: 'دخل' },
  transfer: {
    debitTypes: ['asset'],
    creditTypes: ['asset'],
    debitCashLike: true,
    creditCashLike: true,
    label: 'تحويل',
  },
  // الاقتراض **ليس دخلًا**: يرفع النقد ويُنشئ التزامًا مقابله (القاعدة 19.7).
  borrow: { debitTypes: ['asset'], creditTypes: ['liability'], debitCashLike: true, label: 'اقتراض' },
  // الإقراض **ليس مصروفًا**: يحوّل أصلًا نقديًا إلى أصل مستحق (القاعدة 19.9).
  lend: { debitTypes: ['asset'], creditTypes: ['asset'], creditCashLike: true, label: 'إقراض' },
  collectDebt: {
    debitTypes: ['asset'],
    creditTypes: ['asset'],
    debitCashLike: true,
    label: 'تحصيل دين',
  },
  payDebt: { debitTypes: ['liability'], creditTypes: ['asset'], creditCashLike: true, label: 'سداد دين' },
  opening: { debitTypes: ['asset'], creditTypes: ['equity'], label: 'رصيد افتتاحي' },
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
  balanceDeltaMinor: number
}

export interface OperationPlan {
  opId: string
  entryId: string
  kind: OpKind
  bookedAt: ISODate
  periodKey: PeriodKey
  amountMinor: number
  description: string
  tags: readonly string[]
  scope: Scope
  counterpartyName: string | null
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
  | 'DESCRIPTION_REQUIRED'
  | 'ACCOUNT_MISSING'
  | 'ACCOUNT_ARCHIVED'
  | 'SAME_ACCOUNT'
  | 'WRONG_ACCOUNT_TYPE'
  | 'NOT_CASH_ACCOUNT'
  | 'BALANCE_BELOW_MINIMUM'
  | 'OVERPAYMENT'

export const DOMAIN_ERROR_AR: Record<DomainErrorCode, string> = {
  AMOUNT_NOT_POSITIVE: 'المبلغ يجب أن يكون أكبر من صفر.',
  AMOUNT_OUT_OF_RANGE: 'المبلغ يتجاوز الحد المسموح.',
  INVALID_DATE: 'التاريخ غير صالح.',
  FUTURE_DATE: 'لا يمكن تسجيل عملية بتاريخ مستقبلي.',
  DESCRIPTION_REQUIRED: 'اكتب وصفًا مختصرًا للعملية.',
  ACCOUNT_MISSING: 'الحساب غير موجود.',
  ACCOUNT_ARCHIVED: 'الحساب مؤرشف ولا يقبل حركات جديدة.',
  SAME_ACCOUNT: 'لا يمكن أن يكون الطرفان الحساب نفسه.',
  WRONG_ACCOUNT_TYPE: 'نوع الحساب لا يناسب هذه العملية.',
  NOT_CASH_ACCOUNT: 'هذه العملية تتطلب حسابًا نقديًا.',
  BALANCE_BELOW_MINIMUM: 'الرصيد لا يكفي. العملية ستجعل الرصيد تحت الحد المسموح.',
  OVERPAYMENT: 'المبلغ يتجاوز المستحق على هذا الحساب.',
}

export interface DomainError {
  code: DomainErrorCode
  message: string
  detail?: Record<string, number | string>
}

export type PlanResult = { ok: true; plan: OperationPlan } | { ok: false; error: DomainError }

const fail = (code: DomainErrorCode, detail?: Record<string, number | string>): PlanResult => ({
  ok: false,
  error:
    detail === undefined
      ? { code, message: DOMAIN_ERROR_AR[code] }
      : { code, message: DOMAIN_ERROR_AR[code], detail },
})

/**
 * يبني خطة قيد من طرفين لأي عملية، أو يرفض بسبب مفهوم بالعربية.
 *
 * `today` يُمرَّر صراحةً فتبقى الدالة نقية وحتمية الاختبار.
 */
export function planOperation(
  req: OperationRequest,
  accounts: { debit: AccountSnapshot | undefined; credit: AccountSnapshot | undefined },
  today: ISODate,
): PlanResult {
  const amount = req.amountMinor as number
  const spec = SPECS[req.kind]

  if (!Number.isInteger(amount) || amount <= 0) return fail('AMOUNT_NOT_POSITIVE')
  if (amount > MAX_ABS_MINOR) return fail('AMOUNT_OUT_OF_RANGE')
  if (req.description.trim().length === 0) return fail('DESCRIPTION_REQUIRED')
  if (!isValidISODate(req.bookedAt)) return fail('INVALID_DATE')
  if (req.bookedAt > today) return fail('FUTURE_DATE')
  if (req.debitAccountId === req.creditAccountId) return fail('SAME_ACCOUNT')

  const { debit, credit } = accounts
  if (!debit) return fail('ACCOUNT_MISSING', { accountId: req.debitAccountId })
  if (!credit) return fail('ACCOUNT_MISSING', { accountId: req.creditAccountId })
  if (debit.status !== 'active') return fail('ACCOUNT_ARCHIVED', { accountId: debit.accountId })
  if (credit.status !== 'active') return fail('ACCOUNT_ARCHIVED', { accountId: credit.accountId })

  const debitType = accountTypeOf(debit.accountId)
  const creditType = accountTypeOf(credit.accountId)
  if (!spec.debitTypes.includes(debitType)) {
    return fail('WRONG_ACCOUNT_TYPE', { side: 'debit', accountId: debit.accountId, expected: spec.debitTypes.join('/') })
  }
  if (!spec.creditTypes.includes(creditType)) {
    return fail('WRONG_ACCOUNT_TYPE', { side: 'credit', accountId: credit.accountId, expected: spec.creditTypes.join('/') })
  }
  if (spec.debitCashLike === true && !debit.isCashLike) {
    return fail('NOT_CASH_ACCOUNT', { accountId: debit.accountId })
  }
  if (spec.creditCashLike === true && !credit.isCashLike) {
    return fail('NOT_CASH_ACCOUNT', { accountId: credit.accountId })
  }

  const scope: Scope = req.scope ?? 'personal'

  const lines: PlannedLine[] = [
    {
      lineNo: 0,
      accountId: debit.accountId,
      accountType: debitType,
      side: 'debit',
      amountMinor: amount,
      signedAmountMinor: amount,
      scope,
      categoryId: debitType === 'expense' ? debit.accountId : null,
      settlementDeltaMinor: 0,
    },
    {
      lineNo: 1,
      accountId: credit.accountId,
      accountType: creditType,
      side: 'credit',
      amountMinor: amount,
      signedAmountMinor: -amount,
      scope,
      categoryId: creditType === 'expense' ? credit.accountId : null,
      settlementDeltaMinor: 0,
    },
  ]

  const deltas: AccountDelta[] = lines.map((l) => {
    const natural = normalSideOf(l.accountType)
    return {
      accountId: l.accountId,
      debitMinor: l.side === 'debit' ? amount : 0,
      creditMinor: l.side === 'credit' ? amount : 0,
      balanceDeltaMinor: l.side === natural ? amount : -amount,
    }
  })

  // حارس الرصيد لكل طرف ينقص. يغطي ضمنًا منع السداد الزائد:
  // سداد أكثر من المستحق يجعل رصيد الخصوم سالبًا فيُرفض.
  for (const d of deltas) {
    if (d.balanceDeltaMinor >= 0) continue
    const acct = d.accountId === debit.accountId ? debit : credit
    const after = acct.balanceMinor + d.balanceDeltaMinor
    if (after < acct.minBalanceMinor) {
      const isSettlement = req.kind === 'payDebt' || req.kind === 'collectDebt'
      return fail(isSettlement ? 'OVERPAYMENT' : 'BALANCE_BELOW_MINIMUM', {
        accountId: acct.accountId,
        available: acct.balanceMinor,
        required: amount,
        shortfall: acct.minBalanceMinor - after,
      })
    }
  }

  return {
    ok: true,
    plan: {
      opId: req.opId,
      entryId: req.opId, // ADR-004
      kind: req.kind,
      bookedAt: req.bookedAt,
      periodKey: periodKeyOf(req.bookedAt),
      amountMinor: amount,
      description: req.description.trim(),
      tags: req.tags ?? [],
      scope,
      counterpartyName: req.counterpartyName?.trim() ? req.counterpartyName.trim() : null,
      lines,
      accountIds: lines.map((l) => l.accountId),
      accountTypes: lines.map((l) => l.accountType),
      totalDebitMinor: amount,
      totalCreditMinor: amount,
      deltas,
    },
  }
}

export function kindLabel(kind: OpKind): string {
  return SPECS[kind].label
}

export { SPECS as OPERATION_SPECS }
