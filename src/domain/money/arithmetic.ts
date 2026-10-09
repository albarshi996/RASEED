/** الحساب الآمن على المبالغ — عقد النواة §2.3. */

import { assertInRange, invariant, unsafeMinor, ZERO, type Minor } from './types'

/** جمع مبالغ، مع فحص المدى على الناتج. */
export function addMinor(...xs: readonly Minor[]): Minor {
  let acc = 0
  for (const x of xs) acc += x
  return assertInRange(acc)
}

/** طرح: a − b. */
export function subMinor(a: Minor, b: Minor): Minor {
  return assertInRange(a - b)
}

/** عكس الإشارة. */
export function negateMinor(a: Minor): Minor {
  return assertInRange(0 - (a as number))
}

/** مجموع قائمة. المجموع الفارغ = صفر. */
export function sumMinor(xs: readonly Minor[]): Minor {
  let acc = 0
  for (const x of xs) acc += x
  return assertInRange(acc)
}

/** مقارنة ثلاثية. */
export function compareMinor(a: Minor, b: Minor): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isZero(a: Minor): boolean {
  return a === 0
}

export function isPositive(a: Minor): boolean {
  return a > 0
}

export function isNegative(a: Minor): boolean {
  return a < 0
}

/** القيمة المطلقة. */
export function absMinor(a: Minor): Minor {
  return assertInRange(Math.abs(a))
}

/** يحوّل السالب إلى صفر. لا يغيّر الموجب. */
export function clampAtZero(a: Minor): Minor {
  return a < 0 ? ZERO : a
}

/** الأصغر من مبلغين. */
export function minMinor(a: Minor, b: Minor): Minor {
  return a <= b ? a : b
}

/** الأكبر من مبلغين. */
export function maxMinor(a: Minor, b: Minor): Minor {
  return a >= b ? a : b
}

/**
 * يحوّل مبلغًا بالوحدة الكبرى (دينار) إلى الوحدة الصغرى (درهم).
 * للاختبارات والبذور فقط — مدخلات المستخدم تمرّ عبر parseAmountToMinor الذي لا يستخدم العوائم.
 */
export function fromMajor(major: number): Minor {
  const scaled = roundHalfAwayFromZero(major * 1000)
  invariant(
    Math.abs(major * 1000 - scaled) < 1e-6,
    `قيمة بالدينار تتجاوز ثلاث خانات عشرية: ${String(major)}`,
  )
  return assertInRange(scaled)
}

/**
 * تقريب نصف-بعيدًا-عن-الصفر، متوافق مع سياسة `mulRate` (نصف-لأعلى في القيمة المطلقة).
 * `Math.round` وحده يكسر التماثل مع السالب: `Math.round(-0.5) === -0` لا `-1`.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** الجزء الصحيح من المبلغ بالدينار (للعرض فقط — لا يُستخدم في أي حساب). */
export function toMajorNumber(minor: Minor): number {
  return minor / 1000
}

export { unsafeMinor, ZERO }
