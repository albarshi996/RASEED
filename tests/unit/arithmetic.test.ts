/** اختبارات الحساب الآمن — عقد النواة §2.3، وبقية حوارس وحدة المال. */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  absMinor,
  addMinor,
  assertInRange,
  clampAtZero,
  compareMinor,
  formatLYDExact,
  dueDateFor,
  installmentRemaining,
  isNegative,
  isPositive,
  isValidMinor,
  isZero,
  MAX_ABS_MINOR,
  maxMinor,
  minMinor,
  minorToInputString,
  MoneyInvariantError,
  negateMinor,
  parseSignedAmountToMinor,
  percentOf,
  subMinor,
  sumMinor,
  toMajorNumber,
  unsafeMinor,
  ZERO,
  type Minor,
} from '@/domain/money'
import { toISODate } from '@/lib/time'

const m = (n: number): Minor => unsafeMinor(n)

describe('addMinor / subMinor / sumMinor', () => {
  it('يجمع ويطرح بدقة', () => {
    expect(addMinor(m(1000), m(500), m(1))).toBe(1501)
    expect(subMinor(m(1000), m(1500))).toBe(-500)
    expect(sumMinor([m(100), m(200), m(300)])).toBe(600)
  })

  it('المجموع الفارغ صفر', () => {
    expect(sumMinor([])).toBe(0)
    expect(addMinor()).toBe(0)
  })

  it('يرفض تجاوز الحد الأقصى بدل الانزلاق الصامت', () => {
    expect(() => addMinor(m(MAX_ABS_MINOR), m(1))).toThrow(MoneyInvariantError)
    expect(() => subMinor(m(-MAX_ABS_MINOR), m(1))).toThrow(MoneyInvariantError)
  })

  it('property: الجمع تبادلي وتجميعي على الأعداد الصحيحة', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (a, b, c) => {
          expect(addMinor(m(a), m(b))).toBe(addMinor(m(b), m(a)))
          expect(addMinor(addMinor(m(a), m(b)), m(c))).toBe(addMinor(m(a), addMinor(m(b), m(c))))
        },
      ),
      { numRuns: 500 },
    )
  })
})

describe('negateMinor / absMinor', () => {
  it('يعكس الإشارة', () => {
    expect(negateMinor(m(500))).toBe(-500)
    expect(negateMinor(m(-500))).toBe(500)
    expect(negateMinor(ZERO)).toBe(0)
  })

  it('القيمة المطلقة', () => {
    expect(absMinor(m(-500))).toBe(500)
    expect(absMinor(m(500))).toBe(500)
  })

  it('النفي المزدوج يعيد الأصل', () => {
    fc.assert(
      fc.property(fc.integer({ min: -MAX_ABS_MINOR, max: MAX_ABS_MINOR }), (x) => {
        expect(negateMinor(negateMinor(m(x)))).toBe(x)
      }),
      { numRuns: 500 },
    )
  })
})

describe('المقارنات', () => {
  it('compareMinor ثلاثية', () => {
    expect(compareMinor(m(1), m(2))).toBe(-1)
    expect(compareMinor(m(2), m(1))).toBe(1)
    expect(compareMinor(m(2), m(2))).toBe(0)
  })

  it('المسنِدات', () => {
    expect(isZero(ZERO)).toBe(true)
    expect(isZero(m(1))).toBe(false)
    expect(isPositive(m(1))).toBe(true)
    expect(isPositive(ZERO)).toBe(false)
    expect(isNegative(m(-1))).toBe(true)
    expect(isNegative(ZERO)).toBe(false)
  })

  it('minMinor و maxMinor', () => {
    expect(minMinor(m(5), m(9))).toBe(5)
    expect(maxMinor(m(5), m(9))).toBe(9)
    expect(minMinor(m(5), m(5))).toBe(5)
  })

  it('clampAtZero يحوّل السالب إلى صفر ولا يمسّ الموجب', () => {
    expect(clampAtZero(m(-1))).toBe(0)
    expect(clampAtZero(m(7))).toBe(7)
    expect(clampAtZero(ZERO)).toBe(0)
  })
})

describe('assertInRange / isValidMinor', () => {
  it('يقبل الصحيح داخل المدى', () => {
    expect(assertInRange(0)).toBe(0)
    expect(assertInRange(MAX_ABS_MINOR)).toBe(MAX_ABS_MINOR)
    expect(assertInRange(-MAX_ABS_MINOR)).toBe(-MAX_ABS_MINOR)
  })

  it('يرفض غير الصحيح وخارج المدى', () => {
    expect(() => assertInRange(1.5)).toThrow(MoneyInvariantError)
    expect(() => assertInRange(NaN)).toThrow(MoneyInvariantError)
    expect(() => assertInRange(Infinity)).toThrow(MoneyInvariantError)
    expect(() => assertInRange(MAX_ABS_MINOR + 1)).toThrow(MoneyInvariantError)
  })

  it('isValidMinor حارس نوع', () => {
    expect(isValidMinor(100)).toBe(true)
    expect(isValidMinor(1.5)).toBe(false)
    expect(isValidMinor('100')).toBe(false)
    expect(isValidMinor(null)).toBe(false)
    expect(isValidMinor(MAX_ABS_MINOR + 1)).toBe(false)
  })
})

describe('toMajorNumber و minorToInputString', () => {
  it('toMajorNumber للعرض فقط', () => {
    expect(toMajorNumber(m(25_500))).toBeCloseTo(25.5, 6)
  })

  it('minorToInputString بلا رمز ولا فواصل آلاف', () => {
    expect(minorToInputString(m(25_500))).toBe('25.5')
    expect(minorToInputString(m(25_000))).toBe('25')
    expect(minorToInputString(m(1))).toBe('0.001')
    expect(minorToInputString(m(0))).toBe('0')
    expect(minorToInputString(m(-25_500))).toBe('-25.5')
    expect(minorToInputString(m(1_234_567))).toBe('1234.567')
  })
})

describe('parseSignedAmountToMinor — للتسويات فقط', () => {
  it('يقبل السالب', () => {
    const r = parseSignedAmountToMinor('-25.500')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(-25_500)
  })

  it('يقبل الموجب', () => {
    const r = parseSignedAmountToMinor('25.500')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(25_500)
  })

  it('يمرّر أخطاء التحليل كما هي', () => {
    const r = parseSignedAmountToMinor('-abc')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_A_NUMBER')
  })
})

describe('percentOf — عرض فقط', () => {
  it('يحسب النسبة', () => {
    expect(percentOf(m(25), m(100))).toBe(25)
    expect(percentOf(m(1), m(3))).toBeCloseTo(33.333, 3)
  })

  it('القسمة على صفر تعطي صفرًا لا NaN', () => {
    expect(percentOf(m(10), m(0))).toBe(0)
  })
})

describe('الأقساط — الدوال المساعدة', () => {
  it('installmentRemaining لا يقل عن صفر', () => {
    expect(
      installmentRemaining({
        index: 1,
        dueDate: toISODate('2026-01-01'),
        amountMinor: m(100),
        paidMinor: m(30),
        status: 'partiallyPaid',
      }),
    ).toBe(70)
    expect(
      installmentRemaining({
        index: 1,
        dueDate: toISODate('2026-01-01'),
        amountMinor: m(100),
        paidMinor: m(150),
        status: 'paid',
      }),
    ).toBe(0)
  })

  it('dueDateFor يغطي كل الدوريات', () => {
    const base = toISODate('2026-01-15')
    expect(dueDateFor(base, 2, 'weekly')).toBe('2026-01-29')
    expect(dueDateFor(base, 2, 'biweekly')).toBe('2026-02-12')
    expect(dueDateFor(base, 2, 'monthly')).toBe('2026-03-15')
    expect(dueDateFor(base, 2, 'quarterly')).toBe('2026-07-15')
    expect(dueDateFor(base, 2, 'yearly')).toBe('2028-01-15')
  })

  it('dueDateFor يقصّ نهاية الشهر', () => {
    expect(dueDateFor(toISODate('2026-01-31'), 1, 'monthly')).toBe('2026-02-28')
  })
})

describe('formatLYDExact — القيمة الكاملة لوسم title', () => {
  it('ثلاث خانات ورمز دائمًا، مهما كان عرض البطاقة', () => {
    expect(formatLYDExact(m(1_250_500))).toBe('1,250.500 د.ل')
    expect(formatLYDExact(m(0))).toBe('0.000 د.ل')
  })
})
