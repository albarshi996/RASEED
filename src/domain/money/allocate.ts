/**
 * القسمة والتوزيع بلا ضياع وحدات — عقد النواة §2.5.
 *
 * القاعدة الحاكمة: **مجموع الأجزاء = الكل، بلا استثناء.**
 * الخوارزمية: أكبر الباقي (largest remainder) بتوزيع حتمي تمامًا.
 *
 * الحتمية ليست ترفًا: لو اختلف التوزيع بين استدعاءين لظهر فرق وحدة بين شاشة وأخرى
 * أو بين إصدارين، وهو ما يُفقد الثقة في النظام كله.
 */

import { invariant, unsafeMinor, type Minor } from './types'

/**
 * تقسيم متساوٍ قدر الإمكان على n أجزاء.
 *
 * الثابت المضمون: `sumMinor(result) === total` و `result.length === n`
 * والفرق بين أكبر وأصغر جزء ≤ 1.
 *
 * الباقي يُوزَّع وحدةً واحدة على أول `remainder` عنصرًا (حتمي).
 * الإشارة تُتبَع: التوزيع يتم على القيمة المطلقة ثم تُعاد الإشارة.
 *
 * ```
 * splitEven(1000, 3)  → [334, 333, 333]
 * splitEven(1, 3)     → [1, 0, 0]
 * splitEven(0, 5)     → [0, 0, 0, 0, 0]
 * splitEven(100, 1)   → [100]
 * splitEven(-1000, 3) → [-334, -333, -333]
 * ```
 */
export function splitEven(total: Minor, n: number): Minor[] {
  invariant(Number.isInteger(n) && n >= 1, `عدد الأجزاء يجب أن يكون صحيحًا ≥ 1: ${String(n)}`)

  const negative = total < 0
  const magnitude = negative ? 0 - (total as number) : total
  const quotient = Math.floor(magnitude / n)
  const remainder = magnitude - quotient * n

  const parts: Minor[] = new Array<Minor>(n)
  for (let i = 0; i < n; i++) {
    const part = i < remainder ? quotient + 1 : quotient
    parts[i] = unsafeMinor(negative ? -part : part)
  }

  assertSumMatches(parts, total)
  return parts
}

/**
 * توزيع بأوزان صحيحة غير سالبة، بخوارزمية أكبر الباقي وبحساب BigInt للنسب.
 *
 * ```
 * exact_i = total × w_i / Σw            (BigInt — لا عوائم)
 * floor_i = ⌊exact_i⌋
 * left    = total − Σ floor_i
 * رتّب تنازليًا حسب الباقي (exact_i − floor_i)، والتعادل يُحَل بالفهرس الأصغر
 * ثم أضف وحدة واحدة لأول `left` عنصرًا
 * ```
 *
 * الثابت المضمون: `sumMinor(result) === total`
 *
 * ```
 * allocateByWeights(1000, [2, 1, 1]) → [500, 250, 250]
 * allocateByWeights(10,   [1, 1, 1]) → [4, 3, 3]
 * ```
 */
export function allocateByWeights(total: Minor, weights: readonly number[]): Minor[] {
  invariant(weights.length >= 1, 'قائمة الأوزان فارغة')

  let weightSum = 0n
  for (const w of weights) {
    invariant(Number.isInteger(w) && w >= 0, `الوزن يجب أن يكون عددًا صحيحًا غير سالب: ${String(w)}`)
    weightSum += BigInt(w)
  }
  invariant(weightSum > 0n, 'مجموع الأوزان صفر — لا يمكن التوزيع')

  const negative = total < 0
  const magnitude = BigInt(negative ? 0 - (total as number) : total)

  const floors: bigint[] = []
  const remainders: bigint[] = []
  let distributed = 0n

  for (const w of weights) {
    const numerator = magnitude * BigInt(w)
    const floor = numerator / weightSum
    floors.push(floor)
    remainders.push(numerator - floor * weightSum)
    distributed += floor
  }

  // الباقي بعد التقريب لأسفل. دائمًا 0 ≤ left < weights.length
  let left = magnitude - distributed

  // ترتيب الفهارس تنازليًا حسب الباقي، والتعادل بالفهرس الأصغر ⇒ حتمية كاملة.
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = remainders[a] ?? 0n
      const rb = remainders[b] ?? 0n
      if (ra > rb) return -1
      if (ra < rb) return 1
      return a - b
    })

  for (const index of order) {
    if (left <= 0n) break
    floors[index] = (floors[index] ?? 0n) + 1n
    left -= 1n
  }

  const parts = floors.map((f) => unsafeMinor(Number(negative ? -f : f)))
  assertSumMatches(parts, total)
  return parts
}

/**
 * ثابت يُفرَض وقت التشغيل داخل دوال التوزيع نفسها (§2.7).
 * أي انحراف في المجموع **عيب برمجي** لا خطأ مستخدم.
 */
function assertSumMatches(parts: readonly Minor[], total: Minor): void {
  let acc = 0
  for (const p of parts) acc += p
  invariant(acc === total, `انتهاك ثابت التوزيع: مجموع الأجزاء ${String(acc)} لا يساوي الكل ${String(total)}`)
}
