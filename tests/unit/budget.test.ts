/** اختبارات الميزانيات والأهداف — القسم 12: الفصل بين الفعلي والخطة. */

import { describe, expect, it } from 'vitest'

import { unsafeMinor } from '@/domain/money'
import {
  availableToSpend,
  evaluateBudget,
  goalProgress,
  healthOf,
  WARNING_THRESHOLD_PERCENT,
  wouldDipIntoEarmark,
  type BudgetPlan,
} from '@/domain/planning/budget'

const plan: BudgetPlan = {
  periodKey: '2026-03',
  overallCapMinor: 0,
  categories: [
    { categoryAccountId: 'expense.food', capMinor: 500_000 },
    { categoryAccountId: 'expense.transport', capMinor: 200_000 },
  ],
}

describe('healthOf — عتبة التحذير قبل التجاوز لا بعده', () => {
  it('آمن تحت العتبة', () => {
    expect(healthOf(100_000, 500_000)).toBe('safe')
  })

  it('تحذير عند بلوغ العتبة بالضبط', () => {
    expect(healthOf(400_000, 500_000)).toBe('warning') // 80%
    expect(WARNING_THRESHOLD_PERCENT).toBe(80)
  })

  it('تحذير لا تجاوز عند 100% بالضبط', () => {
    expect(healthOf(500_000, 500_000)).toBe('warning')
  })

  it('تجاوز فوق السقف بوحدة واحدة', () => {
    expect(healthOf(500_001, 500_000)).toBe('exceeded')
  })

  it('بلا سقف = بلا حكم', () => {
    expect(healthOf(999_999, 0)).toBe('none')
  })
})

describe('evaluateBudget', () => {
  it('يحسب المتبقي والنسبة لكل فئة', () => {
    const actual = new Map([['expense.food', 300_000]])
    const r = evaluateBudget(plan, actual)
    const food = r.lines.find((l) => l.categoryAccountId === 'expense.food')
    expect(food?.spentMinor).toBe(300_000)
    expect(food?.remainingMinor).toBe(200_000)
    expect(food?.usedPercent).toBe(60)
    expect(food?.health).toBe('safe')
  })

  it('المتبقي سالب عند التجاوز — لا يُقصَر على صفر', () => {
    const r = evaluateBudget(plan, new Map([['expense.food', 600_000]]))
    const food = r.lines.find((l) => l.categoryAccountId === 'expense.food')
    expect(food?.remainingMinor).toBe(-100_000)
    expect(food?.health).toBe('exceeded')
  })

  it('السقف الكلي = مجموع الفئات حين لا يُحدَّد صراحةً', () => {
    const r = evaluateBudget(plan, new Map())
    expect(r.totalCapMinor).toBe(700_000)
  })

  it('السقف الكلي الصريح يعلو على مجموع الفئات', () => {
    const r = evaluateBudget({ ...plan, overallCapMinor: 1_000_000 }, new Map())
    expect(r.totalCapMinor).toBe(1_000_000)
  })

  it('المجموع الفعلي يشمل الإنفاق **خارج** الفئات المُميزَنة', () => {
    // لو حُسب من الفئات المُميزَنة وحدها لبدا المستخدم ملتزمًا بينما ينفق خارجها.
    const actual = new Map([
      ['expense.food', 100_000],
      ['expense.travel', 900_000], // فئة بلا سقف
    ])
    const r = evaluateBudget(plan, actual)
    expect(r.totalSpentMinor).toBe(1_000_000)
    expect(r.overall).toBe('exceeded')
  })

  it('فئة بلا إنفاق تُعرض بصفر لا تُحذف', () => {
    const r = evaluateBudget(plan, new Map())
    expect(r.lines).toHaveLength(2)
    expect(r.lines.every((l) => l.spentMinor === 0)).toBe(true)
  })
})

describe('goalProgress', () => {
  it('يحسب النسبة والمتبقي', () => {
    const p = goalProgress(2_500_000, 5_000_000)
    expect(p.percent).toBe(50)
    expect(p.remainingMinor).toBe(2_500_000)
    expect(p.reached).toBe(false)
  })

  it('المتبقي لا يقل عن صفر عند التجاوز', () => {
    const p = goalProgress(6_000_000, 5_000_000)
    expect(p.remainingMinor).toBe(0)
    expect(p.percent).toBe(100)
    expect(p.reached).toBe(true)
  })

  it('الهدف المحقَّق بالضبط', () => {
    expect(goalProgress(5_000_000, 5_000_000).reached).toBe(true)
  })

  it('هدف صفري لا يُحسب محقَّقًا ولا يقسم على صفر', () => {
    const p = goalProgress(0, 0)
    expect(p.percent).toBe(0)
    expect(p.reached).toBe(false)
  })
})

describe('الحجز — نيّة لا حركة (ADR-017)', () => {
  it('المتاح للإنفاق = الرصيد ناقص المحجوز', () => {
    expect(availableToSpend(1_000_000, 300_000)).toBe(700_000)
  })

  it('لا يقل المتاح عن صفر', () => {
    expect(availableToSpend(100_000, 300_000)).toBe(0)
  })

  it('بلا حجز: المتاح = الرصيد كاملًا', () => {
    expect(availableToSpend(1_000_000, 0)).toBe(1_000_000)
  })

  it('يكشف الإنفاق الذي يأكل من المحجوز', () => {
    // رصيد 1000، محجوز 300، متاح 700. إنفاق 800 يأكل 100 من المحجوز.
    expect(wouldDipIntoEarmark(1_000_000, 300_000, unsafeMinor(800_000))).toBe(true)
    expect(wouldDipIntoEarmark(1_000_000, 300_000, unsafeMinor(700_000))).toBe(false)
  })

  it('بلا حجز لا تحذير إطلاقًا', () => {
    expect(wouldDipIntoEarmark(1_000_000, 0, unsafeMinor(999_999))).toBe(false)
  })
})
