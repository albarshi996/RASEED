/**
 * اختبارات مُولِّد معرّفات العمليات — ADR-004.
 *
 * `entryId === opId` يعني أن منع الازدواج كله يقوم على هذا الملف.
 * خلل هنا = حركة مالية مزدوجة أو معرّف يرفضه Firestore.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

import { deterministicOpId, isUlid, resetUlidState, setUlidRandomSource, ulid, ulidTime } from '@/lib/ulid'

afterEach(() => {
  resetUlidState()
})

const T = Date.UTC(2026, 9, 9, 12, 0, 0)

describe('ulid — الشكل', () => {
  it('26 محرفًا دائمًا', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), (t) => {
        resetUlidState()
        expect(ulid(t)).toHaveLength(26)
      }),
      { numRuns: 300 },
    )
  })

  it('من أبجدية Crockford فقط — بلا I و L و O و U', () => {
    for (let i = 0; i < 200; i++) {
      const id = ulid(T + i)
      expect(isUlid(id)).toBe(true)
      expect(/[ILOU]/.test(id)).toBe(false)
    }
  })

  it('يرفض طابعًا زمنيًا خارج المدى', () => {
    expect(() => ulid(-1)).toThrow(RangeError)
    expect(() => ulid(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })

  it('isUlid يرفض غير الصالح', () => {
    expect(isUlid('')).toBe(false)
    expect(isUlid('abc')).toBe(false)
    expect(isUlid('I'.repeat(26))).toBe(false) // حرف ممنوع
    expect(isUlid('0'.repeat(25))).toBe(false) // طول خاطئ
    expect(isUlid('0'.repeat(27))).toBe(false)
  })
})

describe('ulid — الترتيب المعجمي = الترتيب الزمني', () => {
  it('طابع زمني أكبر ⇒ معرّف أكبر معجميًا', () => {
    const a = ulid(T)
    const b = ulid(T + 1000)
    expect(a < b).toBe(true)
  })

  it('رتيب داخل نفس المللي ثانية (monotonic)', () => {
    const ids = Array.from({ length: 500 }, () => ulid(T))
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
    expect(new Set(ids).size).toBe(500)
  })

  it('تسلسل عبر مللي ثوانٍ مختلطة يبقى مرتبًا', () => {
    const ids: string[] = []
    for (let i = 0; i < 300; i++) ids.push(ulid(T + Math.floor(i / 7)))
    expect(ids).toEqual([...ids].sort())
    expect(new Set(ids).size).toBe(300)
  })

  it('ulidTime يستعيد الطابع الزمني بالضبط', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), (t) => {
        resetUlidState()
        expect(ulidTime(ulid(t))).toBe(t)
      }),
      { numRuns: 300 },
    )
  })

  it('ulidTime يرفض غير الصالح', () => {
    expect(() => ulidTime('not-a-ulid')).toThrow(RangeError)
  })
})

describe('ulid — فرادة المعرّفات', () => {
  it('لا تصادم في 10,000 معرّف عبر زمن واقعي', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i++) ids.add(ulid(T + Math.floor(i / 50)))
    expect(ids.size).toBe(10_000)
  })

  it('يرمي بدل إنتاج معرّف ضعيف عند غياب مصدر عشوائية', () => {
    setUlidRandomSource(() => {
      throw new Error('no crypto')
    })
    expect(() => ulid(T)).toThrow()
  })

  it('يفيض بأمان عند استنفاد المدى داخل المللي ثانية نفسها', () => {
    // ثبّت العشوائية على أقصى قيمة ⇒ كل زيادة تُحدث حملًا كاملًا
    setUlidRandomSource(() => 0.9999999)
    ulid(T)
    expect(() => ulid(T)).toThrow(/فاض/)
  })
})

describe('deterministicOpId — منع ازدواج العمليات المجدولة', () => {
  it('نفس المدخلات ⇒ نفس المفتاح، دائمًا', () => {
    const a = deterministicOpId('rec', 'rent-2026', '2026-03-01')
    const b = deterministicOpId('rec', 'rent-2026', '2026-03-01')
    expect(a).toBe(b)
    expect(a).toBe('rec__rent-2026__2026-03-01')
  })

  it('مدخلات مختلفة ⇒ مفاتيح مختلفة', () => {
    expect(deterministicOpId('rec', 'r1', '2026-03-01')).not.toBe(
      deterministicOpId('rec', 'r1', '2026-04-01'),
    )
  })

  it('لا عشوائية ولا زمن — مستقل تمامًا عن الجهاز واللحظة', () => {
    setUlidRandomSource(() => 0.5)
    const a = deterministicOpId('rec', 'x', 'y')
    setUlidRandomSource(() => 0.9)
    expect(deterministicOpId('rec', 'x', 'y')).toBe(a)
  })

  it('يرفض المكوّنات التي تكسر المسار أو الفاصل', () => {
    expect(() => deterministicOpId('rec', 'a/b')).toThrow(RangeError)
    expect(() => deterministicOpId('rec', 'a__b')).toThrow(RangeError)
    expect(() => deterministicOpId('rec', '')).toThrow(RangeError)
  })

  it('يرفض ما يتجاوز حدّ معرّف مستند Firestore', () => {
    expect(() => deterministicOpId('rec', 'x'.repeat(1600))).toThrow(RangeError)
  })
})
