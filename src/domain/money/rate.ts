/**
 * الضرب بنسبة — عقد النواة §2.4.
 *
 * BigInt إلزامي ولا نقاش فيه: MAX_ABS_MINOR ≈ 10^12 درهم، وضربه في أساس النقطة (10^4)
 * يعطي 10^16 > 2^53 = Number.MAX_SAFE_INTEGER ⇒ الحساب بـ number يفقد الدقة **صامتًا**.
 * موضع ظهور الخطأ: حاسبة الزكاة 2.5% على أرصدة كبيرة، وأي نسبة سيناريو في القسم 12.
 *
 * التقريب نصف-لأعلى (half-up) لا banker's rounding — قرار موثَّق: الفرق يظهر في حاسبة
 * الزكاة، ونصف-لأعلى هو ما يتوقعه المستخدم في السياق المالي الشخصي.
 */

import { assertInRange, invariant, type Bps, type Minor } from './types'

const BPS_DENOMINATOR = 10_000n
const HALF = 5_000n

/**
 * mulRate(v, bps) = round_half_up(v × bps / 10000)
 *
 * نصف-لأعلى يعني الابتعاد عن الصفر للسالب أيضًا، فيبقى mulRate(-x, b) === -mulRate(x, b).
 */
export function mulRate(v: Minor, bps: Bps): Minor {
  const negative = v < 0
  const magnitude = BigInt(negative ? 0 - (v as number) : v)
  const scaled = (magnitude * BigInt(bps) + HALF) / BPS_DENOMINATOR
  const result = Number(negative ? -scaled : scaled)
  return assertInRange(result)
}

/**
 * نسبة مئوية للعرض والمؤشرات فقط (0..100، عائم مسموح).
 * **يُحرَّم استخدام ناتجها في أي كتابة** — هي رقم عرض لا رقم مال.
 * القسمة على صفر تعيد 0 بدل NaN حتى لا تتسرب NaN إلى الواجهة.
 */
export function percentOf(part: Minor, whole: Minor): number {
  if (whole === 0) return 0
  return (part / whole) * 100
}

/**
 * النسبة كأساس نقطة، للمقارنات داخل النطاق (مثال: نسبة استهلاك الميزانية).
 * تُحسب بـ BigInt ثم تُقرَّب نصف-لأعلى، وتُقصَر على MAX_BPS.
 */
export function ratioBps(part: Minor, whole: Minor): Bps {
  if (whole === 0) return 0 as Bps
  invariant(whole > 0, `المقام في ratioBps يجب أن يكون موجبًا: ${String(whole)}`)
  const scaled = (BigInt(part) * BPS_DENOMINATOR * 2n + BigInt(whole)) / (BigInt(whole) * 2n)
  const clamped = scaled < 0n ? 0n : scaled > 1_000_000n ? 1_000_000n : scaled
  return Number(clamped) as Bps
}

/**
 * نسبة مئوية **منسَّقة للعرض** — سلسلة نصية جاهزة.
 *
 * موضعها هنا لا في الواجهة لأن قاعدة ESLint تمنع التقريب خارج طبقة المال،
 * والمنع مقصود: التقريب في الواجهة أول خطوة نحو جمع قيم مقرَّبة.
 * هذه الدالة تُنتج **نصًا** لا رقمًا، فلا يمكن أن يُجمع ناتجها.
 */
export function formatPercent(part: Minor, whole: Minor, fractionDigits = 0): string {
  if (whole === 0) return '—'
  const value = percentOf(part, whole)
  return value.toFixed(fractionDigits) + '%'
}
