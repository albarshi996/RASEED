/**
 * وحدة المال — المدخل الوحيد.
 *
 * كل حساب على المبالغ يمرّ من هنا. يُحرَّم في بقية النظام:
 * - `Math.round/floor/ceil/trunc` على مبلغ        ⇒ استخدم mulRate أو دوال التوزيع
 * - `toFixed()` أو `toLocaleString()` للعرض        ⇒ استخدم formatLYD
 * - `parseFloat` لمدخل المستخدم                    ⇒ استخدم parseAmountToMinor
 * وهذه الحُرُمات مفروضة بقواعد ESLint لا بمراجعة الكود.
 */

export {
  assertInRange,
  invariant,
  isValidMinor,
  LYD_EXPONENT,
  MAX_ABS_MINOR,
  MAX_BPS,
  MINOR_PER_MAJOR,
  MoneyInvariantError,
  toBps,
  unsafeMinor,
  ZERO,
  type Bps,
  type Minor,
} from './types'

export {
  absMinor,
  addMinor,
  clampAtZero,
  compareMinor,
  fromMajor,
  isNegative,
  isPositive,
  isZero,
  maxMinor,
  minMinor,
  negateMinor,
  subMinor,
  sumMinor,
  toMajorNumber,
} from './arithmetic'

export { formatPercent, mulRate, percentOf, ratioBps } from './rate'

export { allocateByWeights, splitEven } from './allocate'

export {
  normalizeDigits,
  parseAmountToMinor,
  parseSignedAmountToMinor,
  PARSE_ERROR_MESSAGES,
  type ParseErrorCode,
  type ParseResult,
} from './parse'

export {
  CURRENCY_CODE,
  CURRENCY_SYMBOL_AR,
  formatLYD,
  formatLYDExact,
  minorToInputString,
  type AmountDecimals,
  type FormatOptions,
} from './format'

export {
  buildInstallmentPlan,
  dueDateFor,
  installmentRemaining,
  installmentsTotal,
  type Installment,
  type InstallmentFrequency,
  type InstallmentPlanInput,
  type InstallmentStatus,
} from './installments'
