/**
 * اختبارات الزمن — ADR-008 وتوقيت ليبيا الثابت.
 *
 * هذه ليست اختبارات تجميلية: كل تقرير شهري وكل «مهام اليوم» وكل تاريخ استحقاق
 * يعتمد على هذه الدوال. خطأ هنا يعني عملية تظهر في الشهر الخطأ بلا أي رسالة خطأ.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  compareISODate,
  currentPeriodKey,
  daysInMonth,
  diffDays,
  endOfPeriod,
  isAfter,
  isBefore,
  isValidISODate,
  isValidPeriodKey,
  LIBYA_UTC_OFFSET_MINUTES,
  libyaDateToUtcMs,
  nextPeriod,
  nowISO,
  nowMs,
  periodKeyOf,
  periodRange,
  previousPeriod,
  resetClock,
  setClock,
  startOfPeriod,
  toISODate,
  today,
  toLibyaISODate,
} from '@/lib/time'

afterEach(() => {
  resetClock()
})

describe('توقيت ليبيا — UTC+2 ثابت بلا توقيت صيفي', () => {
  it('الإزاحة 120 دقيقة', () => {
    expect(LIBYA_UTC_OFFSET_MINUTES).toBe(120)
  })

  it('الساعة 23:30 بتوقيت UTC هي اليوم التالي في ليبيا', () => {
    // 2026-03-14T23:30:00Z  ⇒  2026-03-15T01:30 بتوقيت ليبيا
    const utc = Date.UTC(2026, 2, 14, 23, 30, 0)
    expect(toLibyaISODate(utc)).toBe('2026-03-15')
  })

  it('الساعة 21:30 بتوقيت UTC ما زالت نفس اليوم في ليبيا', () => {
    const utc = Date.UTC(2026, 2, 14, 21, 30, 0)
    expect(toLibyaISODate(utc)).toBe('2026-03-14')
  })

  it('آخر لحظة في الشهر: 31 مارس 22:30 UTC = 1 أبريل في ليبيا ⇒ الشهر التالي', () => {
    // هذه هي الحالة التي تجعل عملية تظهر في التقرير الشهري الخطأ.
    const utc = Date.UTC(2026, 2, 31, 22, 30, 0)
    expect(toLibyaISODate(utc)).toBe('2026-04-01')
    expect(periodKeyOf(toLibyaISODate(utc))).toBe('2026-04')
  })

  it('الساعة قابلة للتجميد في الاختبارات', () => {
    setClock(() => Date.UTC(2026, 0, 15, 10, 0, 0))
    expect(today()).toBe('2026-01-15')
    expect(currentPeriodKey()).toBe('2026-01')
  })

  it('لا يتأثر بمنطقة الجهاز الزمنية — النتيجة مشتقة من UTC + إزاحة ثابتة', () => {
    setClock(() => Date.UTC(2026, 5, 1, 0, 30, 0))
    expect(today()).toBe('2026-06-01')
  })
})

describe('periodKeyOf — ADR-008', () => {
  it('المفتاح = أول سبعة محارف من التاريخ، دائمًا', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, mo, d) => {
          const iso = toISODate(`${String(y)}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
          expect(periodKeyOf(iso)).toBe(iso.slice(0, 7))
        },
      ),
      { numRuns: 500 },
    )
  })
})

describe('addMonths — لا انزلاق من 31 يناير إلى 3 مارس', () => {
  it('31 يناير + شهر = 28 فبراير (سنة عادية)', () => {
    expect(addMonths(toISODate('2026-01-31'), 1)).toBe('2026-02-28')
  })

  it('31 يناير + شهر = 29 فبراير (سنة كبيسة)', () => {
    expect(addMonths(toISODate('2028-01-31'), 1)).toBe('2028-02-29')
  })

  it('31 يناير + شهرين = 31 مارس — لا يرث القصّ', () => {
    expect(addMonths(toISODate('2026-01-31'), 2)).toBe('2026-03-31')
  })

  it('يعبر حدّ السنة', () => {
    expect(addMonths(toISODate('2026-11-15'), 3)).toBe('2027-02-15')
    expect(addMonths(toISODate('2026-02-15'), -3)).toBe('2025-11-15')
  })

  it('سياسة exact ترمي بدل الانزلاق الصامت', () => {
    expect(() => addMonths(toISODate('2026-01-31'), 1, 'exact')).toThrow(RangeError)
  })

  it('addYears يقصّ 29 فبراير إلى 28 في سنة عادية', () => {
    expect(addYears(toISODate('2028-02-29'), 1)).toBe('2029-02-28')
  })

  it('property: الناتج دائمًا تاريخ صالح', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -60, max: 60 }),
        (d, mo, delta) => {
          const iso = toISODate(`2026-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
          expect(isValidISODate(addMonths(iso, delta))).toBe(true)
        },
      ),
      { numRuns: 1000 },
    )
  })
})

describe('addDays و diffDays', () => {
  it('يعبر حدّ الشهر والسنة', () => {
    expect(addDays(toISODate('2026-02-28'), 1)).toBe('2026-03-01')
    expect(addDays(toISODate('2028-02-28'), 1)).toBe('2028-02-29')
    expect(addDays(toISODate('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(toISODate('2026-01-01'), -1)).toBe('2025-12-31')
  })

  it('diffDays عكس addDays', () => {
    fc.assert(
      fc.property(fc.integer({ min: -2000, max: 2000 }), (n) => {
        const base = toISODate('2026-06-15')
        expect(diffDays(base, addDays(base, n))).toBe(n)
      }),
      { numRuns: 1000 },
    )
  })
})

describe('التحقق من الصلاحية', () => {
  it.each(['2026-01-01', '2028-02-29', '2026-12-31'])('يقبل %s', (d) => {
    expect(isValidISODate(d)).toBe(true)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '20260101', '', 'abcd-ef-gh', '2026-02-29'])(
    'يرفض %s',
    (d) => {
      expect(isValidISODate(d)).toBe(false)
    },
  )

  it('toISODate يرمي على غير الصالح', () => {
    expect(() => toISODate('2026-02-30')).toThrow(RangeError)
  })

  it('isValidPeriodKey', () => {
    expect(isValidPeriodKey('2026-01')).toBe(true)
    expect(isValidPeriodKey('2026-13')).toBe(false)
    expect(isValidPeriodKey('2026-1')).toBe(false)
  })
})

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i → %i يومًا', (y, mo, expected) => {
    expect(daysInMonth(y, mo)).toBe(expected)
  })
})

describe('الفترات', () => {
  it('بداية ونهاية الفترة', () => {
    expect(startOfPeriod('2026-02' as never)).toBe('2026-02-01')
    expect(endOfPeriod('2026-02' as never)).toBe('2026-02-28')
    expect(endOfPeriod('2028-02' as never)).toBe('2028-02-29')
  })

  it('التالية والسابقة تعبران حدّ السنة', () => {
    expect(nextPeriod('2026-12' as never)).toBe('2027-01')
    expect(previousPeriod('2026-01' as never)).toBe('2025-12')
  })

  it('periodRange شامل الطرفين', () => {
    expect(periodRange('2026-11' as never, '2027-02' as never)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ])
  })

  it('periodRange يعيد فترة واحدة عند تساوي الطرفين', () => {
    expect(periodRange('2026-05' as never, '2026-05' as never)).toEqual(['2026-05'])
  })

  it('periodRange يعيد فارغًا عند مدى مقلوب — لا حلقة لا نهائية', () => {
    expect(periodRange('2026-06' as never, '2026-01' as never)).toEqual([])
  })
})

describe('compareISODate', () => {
  it('المقارنة النصية صحيحة لصيغة ISO', () => {
    expect(compareISODate(toISODate('2026-01-01'), toISODate('2026-01-02'))).toBe(-1)
    expect(compareISODate(toISODate('2026-02-01'), toISODate('2026-01-31'))).toBe(1)
    expect(compareISODate(toISODate('2026-01-01'), toISODate('2026-01-01'))).toBe(0)
  })
})

describe('الدوال المتبقية', () => {
  it('nowMs و nowISO يتبعان الساعة المحقونة', () => {
    const fixed = Date.UTC(2026, 3, 10, 8, 0, 0)
    setClock(() => fixed)
    expect(nowMs()).toBe(fixed)
    expect(nowISO()).toBe('2026-04-10T08:00:00.000Z')
  })

  it('libyaDateToUtcMs يعطي منتصف ليل ليبيا بـ UTC', () => {
    // منتصف ليل 2026-03-15 في ليبيا = 2026-03-14T22:00:00Z
    expect(libyaDateToUtcMs(toISODate('2026-03-15'))).toBe(Date.UTC(2026, 2, 14, 22, 0, 0))
  })

  it('الرحلة ذهابًا وإيابًا: libyaDateToUtcMs ثم toLibyaISODate', () => {
    const d = toISODate('2026-07-01')
    expect(toLibyaISODate(libyaDateToUtcMs(d))).toBe(d)
  })

  it('isBefore و isAfter', () => {
    const a = toISODate('2026-01-01')
    const b = toISODate('2026-06-01')
    expect(isBefore(a, b)).toBe(true)
    expect(isAfter(b, a)).toBe(true)
    expect(isBefore(a, a)).toBe(false)
    expect(isAfter(a, a)).toBe(false)
  })

  it('addWeeks', () => {
    expect(addWeeks(toISODate('2026-01-01'), 2)).toBe('2026-01-15')
    expect(addWeeks(toISODate('2026-01-01'), -1)).toBe('2025-12-25')
  })
})
