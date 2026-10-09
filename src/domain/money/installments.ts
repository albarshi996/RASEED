/**
 * جدول الأقساط — عقد النواة §2.6.
 *
 * **ثلاثة قرارات صريحة:**
 * 1. **الباقي يُحمَّل على القسط الأول** لا الأخير. «مبلغ التسوية» في القسط الأخير مُربك،
 *    والفرق في الأول مقبول عرفًا ويظهر مبكرًا حيث يمكن تصحيحه.
 * 2. **الأقساط تُخزَّن صريحةً** في `obligation.installments[]` عند الإنشاء ولا تُحسب عند كل قراءة،
 *    وإلا اختلف التوزيع بين شاشة وأخرى أو بين إصدارين.
 * 3. **يُحرَّم إعادة حساب القسط الأخير بالطرح وقت السداد** — مصدر شائع لفروق الوحدة.
 */

import {
  addMonths,
  addWeeks,
  addYears,
  type DayOfMonthPolicy,
  type ISODate,
} from '@/lib/time'

import { splitEven } from './allocate'
import { invariant, ZERO, type Minor } from './types'

export type InstallmentFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

export type InstallmentStatus =
  | 'upcoming'
  | 'due'
  | 'overdue'
  | 'partiallyPaid'
  | 'paid'
  | 'cancelled'

export interface InstallmentPlanInput {
  totalMinor: Minor
  /** عدد الأقساط، ≥ 1. */
  count: number
  firstDueDate: ISODate
  frequency: InstallmentFrequency
  /** 31 يناير + شهر ⇒ 28/29 فبراير. الافتراضي clampToEndOfMonth. */
  dayOfMonthPolicy?: DayOfMonthPolicy
}

export interface Installment {
  /** 1-based، ثابت إلى الأبد. لا يُعاد ترقيمه عند الإلغاء أو التعديل. */
  index: number
  dueDate: ISODate
  /** من splitEven — يُخزَّن صريحًا ولا يُعاد حسابه. */
  amountMinor: Minor
  paidMinor: Minor
  status: InstallmentStatus
}

/**
 * يبني جدول أقساط مضمون المجموع.
 *
 * الثابت: `Σ installments[].amountMinor === totalMinor` — مفروض داخل `splitEven`.
 *
 * ```
 * buildInstallmentPlan({ totalMinor: 800000, count: 7, ... })
 *   → القسط الأول 114287 والبقية 114285 ... المجموع 800000 بالضبط
 * ```
 */
export function buildInstallmentPlan(input: InstallmentPlanInput): Installment[] {
  const { totalMinor, count, firstDueDate, frequency, dayOfMonthPolicy = 'clampToEndOfMonth' } = input

  invariant(Number.isInteger(count) && count >= 1, `عدد الأقساط يجب أن يكون صحيحًا ≥ 1: ${String(count)}`)
  invariant(totalMinor >= 0, 'قيمة الجدول لا يمكن أن تكون سالبة')

  // splitEven يضع الباقي على العناصر الأولى ⇒ القسط الأول يحمل الباقي (القرار 1).
  const amounts = splitEven(totalMinor, count)

  return amounts.map((amountMinor, i) => ({
    index: i + 1,
    dueDate: dueDateFor(firstDueDate, i, frequency, dayOfMonthPolicy),
    amountMinor,
    paidMinor: ZERO,
    status: 'upcoming',
  }))
}

/** تاريخ استحقاق القسط رقم `step` (0-based) بعد تاريخ البداية. */
export function dueDateFor(
  firstDueDate: ISODate,
  step: number,
  frequency: InstallmentFrequency,
  policy: DayOfMonthPolicy = 'clampToEndOfMonth',
): ISODate {
  switch (frequency) {
    case 'weekly':
      return addWeeks(firstDueDate, step)
    case 'biweekly':
      return addWeeks(firstDueDate, step * 2)
    case 'monthly':
      return addMonths(firstDueDate, step, policy)
    case 'quarterly':
      return addMonths(firstDueDate, step * 3, policy)
    case 'yearly':
      return addYears(firstDueDate, step, policy)
  }
}

/** المتبقي على قسط. لا يقل عن صفر. */
export function installmentRemaining(installment: Installment): Minor {
  const remaining = installment.amountMinor - installment.paidMinor
  return (remaining > 0 ? remaining : 0) as Minor
}

/** مجموع أقساط الجدول — يجب أن يساوي قيمة الالتزام دائمًا (ثابت قابل للاختبار). */
export function installmentsTotal(installments: readonly Installment[]): Minor {
  let acc = 0
  for (const i of installments) acc += i.amountMinor
  return acc as Minor
}
