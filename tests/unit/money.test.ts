/**
 * اختبارات المال الإلزامية — عقد النواة §2.7.
 *
 * كل حالة هنا مذكورة نصًّا في العقد. حذف أي منها يعني كسر العقد.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  allocateByWeights,
  buildInstallmentPlan,
  formatLYD,
  fromMajor,
  installmentsTotal,
  MAX_ABS_MINOR,
  minorToInputString,
  MoneyInvariantError,
  mulRate,
  parseAmountToMinor,
  ratioBps,
  splitEven,
  sumMinor,
  toBps,
  unsafeMinor,
  type Minor,
} from '@/domain/money'
import { toISODate } from '@/lib/time'

const m = (n: number): Minor => unsafeMinor(n)

describe('splitEven — مجموع الأجزاء = الكل دائمًا', () => {
  it('splitEven(1000, 3) → [334,333,333]', () => {
    expect(splitEven(m(1000), 3)).toEqual([334, 333, 333])
  })

  it('splitEven(1, 3) → [1,0,0] لا ثلاثة أصفار', () => {
    expect(splitEven(m(1), 3)).toEqual([1, 0, 0])
  })

  it('splitEven(0, 5) → خمسة أصفار', () => {
    expect(splitEven(m(0), 5)).toEqual([0, 0, 0, 0, 0])
  })

  it('splitEven(100, 1) → [100]', () => {
    expect(splitEven(m(100), 1)).toEqual([100])
  })

  it('splitEven(1_000_000, 3) → [333334,333333,333333]', () => {
    expect(splitEven(m(1_000_000), 3)).toEqual([333_334, 333_333, 333_333])
  })

  it('الباقي يتبع الإشارة: splitEven(-1000, 3) → [-334,-333,-333]', () => {
    expect(splitEven(m(-1000), 3)).toEqual([-334, -333, -333])
  })

  it('property: المجموع = الكل، والفرق بين أكبر وأصغر جزء ≤ 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 1, max: 24 }), (x, n) => {
        const parts = splitEven(m(x), n)
        expect(parts).toHaveLength(n)
        expect(sumMinor(parts)).toBe(x)
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
      }),
      { numRuns: 500 },
    )
  })

  it('يرفض عدد أجزاء غير صالح', () => {
    expect(() => splitEven(m(100), 0)).toThrow(MoneyInvariantError)
    expect(() => splitEven(m(100), 1.5)).toThrow(MoneyInvariantError)
  })
})

describe('allocateByWeights — أكبر الباقي، حتمي', () => {
  it('allocateByWeights(1000, [2,1,1]) → [500,250,250]', () => {
    expect(allocateByWeights(m(1000), [2, 1, 1])).toEqual([500, 250, 250])
  })

  it('allocateByWeights(10, [1,1,1]) → [4,3,3]', () => {
    expect(allocateByWeights(m(10), [1, 1, 1])).toEqual([4, 3, 3])
  })

  it('التعادل في الكسر يُحَل بالفهرس الأصغر ⇒ حتمية كاملة', () => {
    const a = allocateByWeights(m(7), [1, 1, 1])
    const b = allocateByWeights(m(7), [1, 1, 1])
    expect(a).toEqual(b)
    expect(a).toEqual([3, 2, 2])
  })

  it('وزن صفري يأخذ صفرًا', () => {
    expect(allocateByWeights(m(100), [1, 0, 1])).toEqual([50, 0, 50])
  })

  it('يرفض مجموع أوزان صفريًا', () => {
    expect(() => allocateByWeights(m(100), [0, 0])).toThrow(MoneyInvariantError)
  })

  it('property على 10,000 حالة: Σ result === total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(weights.reduce((s, w) => s + w, 0) > 0)
          expect(sumMinor(allocateByWeights(m(total), weights))).toBe(total)
        },
      ),
      { numRuns: 10_000 },
    )
  })
})

describe('mulRate — BigInt إلزامي، تقريب نصف-لأعلى', () => {
  it('يعطي النتيجة الصحيحة بالضبط عند الحد الأقصى (يفشل لو استُخدم number)', () => {
    const value = m(MAX_ABS_MINOR)
    const bps = toBps(250)
    const expected = Number((BigInt(MAX_ABS_MINOR) * 250n + 5000n) / 10_000n)
    expect(mulRate(value, bps)).toBe(expected)
    expect(mulRate(value, bps)).toBe(25_000_000_000)
  })

  it('نصف-لأعلى في أنصاف الوحدات', () => {
    expect(mulRate(m(2), toBps(5000))).toBe(1) // 1.0 → 1
    expect(mulRate(m(6), toBps(2500))).toBe(2) // 1.5 → 2
    expect(mulRate(m(1), toBps(5000))).toBe(1) // 0.5 → 1
  })

  it('زكاة 2.5% على رصيد كبير — دقيقة', () => {
    expect(mulRate(m(1_000_000_000), toBps(250))).toBe(25_000_000)
  })

  it('يحافظ على التماثل مع السالب', () => {
    expect(mulRate(m(-6), toBps(2500))).toBe(-2)
  })

  it('يرفض أساس نقطة غير صالح', () => {
    expect(() => toBps(-1)).toThrow(MoneyInvariantError)
    expect(() => toBps(2.5)).toThrow(MoneyInvariantError)
  })
})

describe('ratioBps', () => {
  it('النصف = 5000 bps', () => {
    expect(ratioBps(m(500), m(1000))).toBe(5000)
  })

  it('القسمة على صفر تعطي صفرًا لا NaN', () => {
    expect(ratioBps(m(100), m(0))).toBe(0)
  })

  it('يُقصَر عند الحد الأقصى', () => {
    expect(ratioBps(m(1_000_000_000), m(1))).toBe(1_000_000)
  })
})

describe('parseAmountToMinor — رفض صريح لا تقريب صامت', () => {
  it.each([
    ['25.5', 25_500],
    ['25.500', 25_500],
    ['25,5', 25_500],
    ['1 234.750', 1_234_750],
    ['١٢٣٤٫٧٥٠', 1_234_750], // ١٢٣٤٫٧٥٠
    ['0', 0],
    ['0.001', 1],
    ['.5', 500],
    ['1,234.750', 1_234_750], // فاصلان مختلفان ⇒ الأخير عشري
    ['1.234,750', 1_234_750], // الصيغة الأوروبية
    ['1,234,567', 1_234_567_000], // فواصل متماثلة ⇒ كلها آلاف
  ])('يقبل %s', (input, expected) => {
    const r = parseAmountToMinor(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(expected)
  })

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['abc', 'NOT_A_NUMBER'],
    ['25.5.5', 'NOT_A_NUMBER'],
    ['25.5055', 'TOO_MANY_DECIMALS'],
    ['-10', 'NEGATIVE'],
    ['99999999999999', 'OUT_OF_RANGE'],
  ])('يرفض %s بالرمز %s', (input, code) => {
    const r = parseAmountToMinor(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(code)
  })

  it('لا يُقرِّب 25.5055 صامتًا', () => {
    const r = parseAmountToMinor('25.5055')
    expect(r.ok).toBe(false)
  })

  it('السالب صفرًا مقبول (−0 = 0)', () => {
    const r = parseAmountToMinor('-0')
    expect(r.ok).toBe(true)
  })

  it('round-trip: minorToInputString ثم parse يعيد نفس القيمة', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_ABS_MINOR }), (x) => {
        const r = parseAmountToMinor(minorToInputString(m(x)))
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.value).toBe(x)
      }),
      { numRuns: 2000 },
    )
  })
})

describe('formatLYD — أرقام لاتينية دائمًا (ق-3)', () => {
  const ARABIC_INDIC = /[٠-٩۰-۹]/

  it.each([
    [25_500, '25.500 د.ل'],
    [1_250_500, '1,250.500 د.ل'],
    [0, '0.000 د.ل'],
  ])('%i → %s', (input, expected) => {
    expect(formatLYD(m(input))).toBe(expected)
  })

  it('السالب يستخدم علامة الطرح U+2212', () => {
    expect(formatLYD(m(-25_500))).toBe('−25.500 د.ل')
  })

  it('لا حرف هندي-عربي في المخرج قطعًا', () => {
    fc.assert(
      fc.property(fc.integer({ min: -MAX_ABS_MINOR, max: MAX_ABS_MINOR }), (x) => {
        expect(ARABIC_INDIC.test(formatLYD(m(x)))).toBe(false)
      }),
      { numRuns: 1000 },
    )
  })

  it('يحترم عدد الخانات المطلوب', () => {
    expect(formatLYD(m(1_250_500), { decimals: 0 })).toBe('1,251 د.ل')
    expect(formatLYD(m(1_250_500), { withSymbol: false })).toBe('1,250.500')
    expect(formatLYD(m(1_250_500), { signed: true, withSymbol: false })).toBe('+1,250.500')
  })
})

describe('fromMajor', () => {
  it('يحوّل بلا خطأ عائم', () => {
    expect(fromMajor(25.5)).toBe(25_500)
    expect(fromMajor(0.001)).toBe(1)
    expect(fromMajor(1234.567)).toBe(1_234_567)
  })

  it('يرفض أكثر من ثلاث خانات', () => {
    expect(() => fromMajor(1.2345)).toThrow(MoneyInvariantError)
  })
})

describe('buildInstallmentPlan', () => {
  it('مجموع الأقساط = القيمة، والقسط الأول يحمل الباقي', () => {
    const plan = buildInstallmentPlan({
      totalMinor: m(800_000),
      count: 7,
      firstDueDate: toISODate('2026-01-15'),
      frequency: 'monthly',
    })
    expect(plan).toHaveLength(7)
    expect(installmentsTotal(plan)).toBe(800_000)
    expect(plan[0]?.amountMinor).toBeGreaterThanOrEqual(plan[6]?.amountMinor ?? 0)
  })

  it('الترقيم 1-based وثابت', () => {
    const plan = buildInstallmentPlan({
      totalMinor: m(300),
      count: 3,
      firstDueDate: toISODate('2026-01-31'),
      frequency: 'monthly',
    })
    expect(plan.map((i) => i.index)).toEqual([1, 2, 3])
  })

  it('31 يناير + شهر ⇒ 28 فبراير (لا ينزلق إلى 3 مارس)', () => {
    const plan = buildInstallmentPlan({
      totalMinor: m(300),
      count: 3,
      firstDueDate: toISODate('2026-01-31'),
      frequency: 'monthly',
    })
    expect(plan.map((i) => i.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('property: المجموع محفوظ لأي قيمة وعدد', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 60 }),
        (total, count) => {
          const plan = buildInstallmentPlan({
            totalMinor: m(total),
            count,
            firstDueDate: toISODate('2026-03-15'),
            frequency: 'monthly',
          })
          expect(installmentsTotal(plan)).toBe(total)
        },
      ),
      { numRuns: 1000 },
    )
  })
})
