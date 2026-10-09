/**
 * تنسيق المبالغ — عقد النواة §2.2، وقرار المالك ق-3.
 *
 * **ثلاث قواعد إلزامية:**
 * 1. يُحرَّم جمع قيم منسَّقة أو مُقرَّبة. كل مجموع يُحسب على `Minor` ثم يُنسَّق **مرة واحدة** في النهاية،
 *    وإلا ظهر «الإجمالي ≠ مجموع الصفوف» في التقارير (خرق القسم 23 بند 12).
 * 2. لا `toFixed()` ولا `toLocaleString()` في أي مكوّن واجهة. دالة واحدة: `formatLYD()`.
 * 3. الجداول المالية تستخدم `font-variant-numeric: tabular-nums`.
 *
 * **ق-3 مُلزِم: الأرقام لاتينية في كل الشاشات بلا استثناء** (`1,250.500` لا `١٬٢٥٠٫٥٠٠`).
 */

import { MINOR_PER_MAJOR, type Minor } from './types'

export const CURRENCY_CODE = 'LYD' as const
export const CURRENCY_SYMBOL_AR = 'د.ل' as const

/** عدد الخانات المسموح في العرض. الدفاتر والتقارير 3 دائمًا؛ البطاقات قابلة للتخفيض. */
export type AmountDecimals = 0 | 2 | 3

/**
 * **لماذا `en-US` لا `ar-LY`:** قرار المالك ق-3 اختار الصيغة `1,250.500` صراحةً —
 * فاصلة للآلاف ونقطة للعشري. لكن `ar-LY` يعكسهما (`1.250,500`) لأن ليبيا تتبع العرف
 * الأوروبي في فواصل الأرقام. و`ar-LY-u-nu-latn` يُصلح شكل الأرقام فقط لا الفواصل.
 * فاستُخدم `en-US` للجزء الرقمي وحده، بينما يبقى النص ورمز العملة «د.ل» والاتجاه عربية.
 * هذا ما طلبه المالك حرفيًا، وهو أيضًا ما يُلصق في Excel بلا تحويل.
 *
 * تُبنى المنسِّقات مرة واحدة: `Intl.NumberFormat` مكلف وإنشاؤه داخل حلقة عرض يُبطئ الجداول.
 */
const formatters = new Map<AmountDecimals, Intl.NumberFormat>()

function formatterFor(decimals: AmountDecimals): Intl.NumberFormat {
  const cached = formatters.get(decimals)
  if (cached) return cached
  const created = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  })
  formatters.set(decimals, created)
  return created
}

export interface FormatOptions {
  /** عدد الخانات العشرية. الافتراضي 3 (الدفاتر والتقارير). */
  decimals?: AmountDecimals
  /** إظهار رمز العملة «د.ل». الافتراضي true. */
  withSymbol?: boolean
  /** إظهار علامة + للموجب. مفيد في كشوف الحركة. الافتراضي false. */
  signed?: boolean
}

/**
 * الدالة **الوحيدة** لتنسيق المال في النظام.
 *
 * ```
 * formatLYD(25500 as Minor)                      → '25.500 د.ل'
 * formatLYD(1250500 as Minor)                    → '1,250.500 د.ل'
 * formatLYD(-25500 as Minor)                     → '−25.500 د.ل'
 * formatLYD(0 as Minor)                          → '0.000 د.ل'
 * formatLYD(1250500 as Minor, { decimals: 0 })   → '1,251 د.ل'
 * ```
 *
 * السالب يُعرض بعلامة الطرح الرياضية U+2212 لا الشرطة، لأنها لا تُكسر في RTL
 * ولأن عرضها أوضح بجانب الأرقام الجدولية.
 */
export function formatLYD(minor: Minor, options: FormatOptions = {}): string {
  const { decimals = 3, withSymbol = true, signed = false } = options

  const negative = minor < 0
  const magnitude = (negative ? 0 - (minor as number) : minor) / MINOR_PER_MAJOR
  const body = formatterFor(decimals).format(magnitude)

  const sign = negative ? '−' : signed && minor > 0 ? '+' : ''
  return withSymbol ? `${sign}${body} ${CURRENCY_SYMBOL_AR}` : `${sign}${body}`
}

/**
 * القيمة الكاملة بثلاث خانات، لوضعها في `title` عندما تُعرض قيمة مختصرة في بطاقة.
 * هكذا لا يفقد المستخدم الرقم الدقيق أبدًا.
 */
export function formatLYDExact(minor: Minor): string {
  return formatLYD(minor, { decimals: 3, withSymbol: true })
}

/**
 * يحوّل Minor إلى نص صالح لحقل إدخال (بلا رمز عملة وبلا فواصل آلاف).
 * يُستخدم عند تعبئة نموذج تعديل. التحويل نصي بحت — لا قسمة عائمة.
 */
export function minorToInputString(minor: Minor): string {
  const negative = minor < 0
  const digits = String(negative ? 0 - (minor as number) : minor).padStart(4, '0')
  const cut = digits.length - 3
  const integerPart = digits.slice(0, cut)
  const fractionPart = digits.slice(cut).replace(/0+$/, '')
  const body = fractionPart.length > 0 ? `${integerPart}.${fractionPart}` : integerPart
  return negative ? `-${body}` : body
}
