/**
 * تمثيل المال — عقد النواة §2 (ADR-001).
 *
 * وحدة التخزين الصغرى هي **الدرهم الليبي**: 1 LYD = 1000 درهم، الأُسّ العشري = 3.
 * كل مبلغ في النظام عدد صحيح بالدرهم. لا كسر عشري عائم في التخزين ولا في الحساب، إطلاقًا.
 */

/** مبلغ بالوحدة الصغرى (درهم ليبي). عدد صحيح موسوم. */
export type Minor = number & { readonly __minor: unique symbol }

/** نسبة بأساس النقطة. 1 bps = 0.01% ⇒ 2.5% = 250، و100% = 10000. */
export type Bps = number & { readonly __bps: unique symbol }

/** عدد الخانات العشرية للدينار الليبي وفق ISO 4217. */
export const LYD_EXPONENT = 3 as const

/** عدد الدراهم في الدينار الواحد. */
export const MINOR_PER_MAJOR = 1000 as const

/**
 * الحد الأقصى المطلق لأي مبلغ: ألف مليار درهم = مليار دينار.
 *
 * ليس تجميلًا: ضرب هذا الحد في أساس النقطة (10^4) يعطي 10^16 وهو أكبر من
 * Number.MAX_SAFE_INTEGER (2^53 ≈ 9.007×10^15) — ولهذا الضرب بنسبة يمرّ بـ BigInt إلزامًا (§2.4).
 */
export const MAX_ABS_MINOR = 1_000_000_000_000

/** أقصى قيمة مسموحة لأساس النقطة (= 10000%). */
export const MAX_BPS = 1_000_000

/** الصفر، بالنوع الصحيح. */
export const ZERO = 0 as Minor

/** خطأ نظام: انتهاك ثابت داخلي. عيب برمجي لا خطأ مستخدم — لا يُصطاد إلى الواجهة. */
export class MoneyInvariantError extends Error {
  override readonly name = 'MoneyInvariantError'
}

/** يرمي عند انتهاك ثابت. يُستخدم داخل دوال المال نفسها. */
export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new MoneyInvariantError(message)
}

/** هل القيمة عدد صحيح صالح ضمن المدى المسموح؟ */
export function isValidMinor(value: unknown): value is Minor {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_ABS_MINOR
}

/**
 * يتحقق من أن عددًا خامًا صالح كـ Minor ويعيده موسومًا.
 * يرمي MoneyInvariantError إن لم يكن صحيحًا أو تجاوز المدى.
 */
export function assertInRange(value: number): Minor {
  invariant(Number.isInteger(value), `مبلغ غير صحيح (ليس عددًا صحيحًا): ${String(value)}`)
  invariant(
    Math.abs(value) <= MAX_ABS_MINOR,
    `مبلغ خارج المدى المسموح (±${String(MAX_ABS_MINOR)}): ${String(value)}`,
  )
  return value as Minor
}

/** يحوّل عددًا صحيحًا معروف الصحة إلى Minor بلا فحص. للاستخدام داخل domain/money فقط. */
export function unsafeMinor(value: number): Minor {
  return value as Minor
}

/** يبني Bps من عدد صحيح، مع فحص المدى. */
export function toBps(value: number): Bps {
  invariant(Number.isInteger(value), `أساس النقطة يجب أن يكون عددًا صحيحًا: ${String(value)}`)
  invariant(value >= 0 && value <= MAX_BPS, `أساس النقطة خارج المدى 0..${String(MAX_BPS)}: ${String(value)}`)
  return value as Bps
}
