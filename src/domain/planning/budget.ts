/**
 * الميزانيات والأهداف — منطق نقي.
 *
 * **الفصل الحاسم بين الفعلي والخطة** (القسم 12 من المتطلبات):
 * الميزانية **خطة** لا حركة مالية. وضع سقف 500 د.ل للطعام لا يُنشئ قيدًا ولا يحجز مالًا.
 * المقارنة تتم بين الخطة والفعلي المقروء من الدفتر، ولا يختلطان أبدًا في رقم واحد.
 */

import { type Minor } from '@/domain/money'

export interface CategoryBudget {
  categoryAccountId: string
  capMinor: number
}

export interface BudgetPlan {
  periodKey: string
  /** سقف الإنفاق الكلي للشهر. صفر = بلا سقف كلي. */
  overallCapMinor: number
  categories: readonly CategoryBudget[]
}

export type BudgetHealth = 'safe' | 'warning' | 'exceeded' | 'none'

export interface BudgetLine {
  categoryAccountId: string
  capMinor: number
  spentMinor: number
  remainingMinor: number
  /** نسبة الاستهلاك 0..100+، للعرض فقط. */
  usedPercent: number
  health: BudgetHealth
}

/** عتبة التحذير الافتراضية — يُنبَّه المستخدم قبل التجاوز لا بعده. */
export const WARNING_THRESHOLD_PERCENT = 80

export function healthOf(spentMinor: number, capMinor: number): BudgetHealth {
  if (capMinor <= 0) return 'none'
  if (spentMinor > capMinor) return 'exceeded'
  if ((spentMinor / capMinor) * 100 >= WARNING_THRESHOLD_PERCENT) return 'warning'
  return 'safe'
}

/**
 * يقارن الخطة بالفعلي.
 *
 * `actualByCategory` يأتي من الدفتر (قيود المصروف في الفترة)، والخطة من مستند
 * الميزانية. لا يُشتق أحدهما من الآخر — وهذا شرط أن تبقى المقارنة ذات معنى.
 */
export function evaluateBudget(
  plan: BudgetPlan,
  actualByCategory: ReadonlyMap<string, number>,
): { lines: BudgetLine[]; totalCapMinor: number; totalSpentMinor: number; overall: BudgetHealth } {
  const lines = plan.categories.map((c) => {
    const spent = actualByCategory.get(c.categoryAccountId) ?? 0
    const remaining = c.capMinor - spent
    return {
      categoryAccountId: c.categoryAccountId,
      capMinor: c.capMinor,
      spentMinor: spent,
      remainingMinor: remaining,
      usedPercent: c.capMinor <= 0 ? 0 : (spent / c.capMinor) * 100,
      health: healthOf(spent, c.capMinor),
    }
  })

  const totalCapMinor =
    plan.overallCapMinor > 0
      ? plan.overallCapMinor
      : plan.categories.reduce((s, c) => s + c.capMinor, 0)

  // المجموع الفعلي من **كل** المصروفات لا من الفئات المُميزَنة وحدها،
  // وإلا بدا المستخدم ملتزمًا بميزانيته بينما ينفق خارجها.
  let totalSpentMinor = 0
  for (const v of actualByCategory.values()) totalSpentMinor += v

  return { lines, totalCapMinor, totalSpentMinor, overall: healthOf(totalSpentMinor, totalCapMinor) }
}

// ───────────────────────────── الأهداف ─────────────────────────────

export interface GoalProgress {
  savedMinor: number
  targetMinor: number
  remainingMinor: number
  percent: number
  reached: boolean
}

export function goalProgress(savedMinor: number, targetMinor: number): GoalProgress {
  const remaining = targetMinor - savedMinor
  return {
    savedMinor,
    targetMinor,
    remainingMinor: remaining > 0 ? remaining : 0,
    percent: targetMinor <= 0 ? 0 : Math.min(100, (savedMinor / targetMinor) * 100),
    reached: savedMinor >= targetMinor && targetMinor > 0,
  }
}

/**
 * المتاح للإنفاق = الرصيد − المحجوز للأهداف.
 *
 * **الحجز ليس حركة مالية**: المال ما زال في الحساب ورصيده لم ينقص. الحجز نيّة،
 * والنيّة لا تمنع المالك من التصرّف في ماله — ولهذا تجاوز المحجوز **تحذير**
 * وتجاوز الرصيد **منع** (ADR-017). لو منعناه لصار النظام يُملي عليه لا يخدمه.
 */
export function availableToSpend(balanceMinor: number, earmarkedMinor: number): number {
  const v = balanceMinor - earmarkedMinor
  return v > 0 ? v : 0
}

export function wouldDipIntoEarmark(
  balanceMinor: number,
  earmarkedMinor: number,
  amountMinor: Minor,
): boolean {
  return earmarkedMinor > 0 && balanceMinor - (amountMinor as number) < earmarkedMinor
}
