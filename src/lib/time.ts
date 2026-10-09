/**
 * الزمن — المصدر الوحيد لأي تاريخ أو «اليوم» في النظام.
 *
 * **لماذا هذا الملف موجود أصلًا:** حدود الشهر المالي والتقارير اليومية والمهام المستحقة
 * كلها تعتمد على تعريف «اليوم». لو استُخدم `new Date()` مباشرة في الواجهات، لاختلف «اليوم»
 * بين جهاز منطقته UTC وآخر منطقته UTC+2، فظهرت عملية الساعة 1:00 صباحًا في الشهر الخطأ.
 * ولهذا `new Date()` بلا وسائط **خطأ بناء** خارج هذا الملف (قاعدة ESLint).
 *
 * **ليبيا: UTC+2 ثابت بلا توقيت صيفي** (EET، أُلغي التوقيت الصيفي منذ 2013).
 * الإزاحة ثابتة عمدًا ولا تُقرأ من المتصفح: النظام شخصي لمالك في ليبيا، ويجب أن يرى
 * نفس «اليوم» ونفس حدود الشهر سواء فتح التطبيق من هاتفه أو من حاسوب ضُبطت منطقته خطأً.
 */

/** إزاحة ليبيا عن UTC بالدقائق. ثابتة بلا توقيت صيفي. */
export const LIBYA_UTC_OFFSET_MINUTES = 120

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/** تاريخ بصيغة `YYYY-MM-DD` بتوقيت ليبيا. */
export type ISODate = string & { readonly __isoDate: unique symbol }

/** مفتاح الفترة `YYYY-MM` — دائمًا شهر ميلادي (ADR-008). */
export type PeriodKey = string & { readonly __periodKey: unique symbol }

/** لحظة بصيغة ISO 8601 كاملة بتوقيت UTC. */
export type ISOTimestamp = string & { readonly __isoTimestamp: unique symbol }

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PERIOD_KEY_PATTERN = /^\d{4}-\d{2}$/

/** الساعة الحالية. مُحقَنة ليمكن تجميدها في الاختبارات. */
let clock: () => number = () => Date.now()

/** يستبدل مصدر الوقت. للاختبارات فقط. */
export function setClock(fn: () => number): void {
  clock = fn
}

/** يعيد مصدر الوقت إلى الساعة الحقيقية. */
export function resetClock(): void {
  clock = () => Date.now()
}

/** اللحظة الحالية بالميلي ثانية منذ حقبة يونكس. */
export function nowMs(): number {
  return clock()
}

/** اللحظة الحالية بصيغة ISO كاملة (UTC) — هذا ما يُخزَّن في Firestore. */
export function nowISO(): ISOTimestamp {
  return new Date(clock()).toISOString() as ISOTimestamp
}

/** «اليوم» بتوقيت ليبيا بصيغة `YYYY-MM-DD`. */
export function today(): ISODate {
  return toLibyaISODate(clock())
}

/** مفتاح فترة الشهر الحالي بتوقيت ليبيا. */
export function currentPeriodKey(): PeriodKey {
  return periodKeyOf(today())
}

/** يحوّل لحظة (ms منذ الحقبة) إلى تاريخ ليبي `YYYY-MM-DD`. */
export function toLibyaISODate(epochMs: number): ISODate {
  const shifted = new Date(epochMs + LIBYA_UTC_OFFSET_MINUTES * MS_PER_MINUTE)
  const y = shifted.getUTCFullYear()
  const m = shifted.getUTCMonth() + 1
  const d = shifted.getUTCDate()
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}` as ISODate
}

/**
 * يحوّل تاريخًا ليبيًا إلى اللحظة المقابلة لمنتصف ليله بـ UTC.
 * يُستخدم لحدود الاستعلامات الزمنية: `[startOfDayUtc(d), startOfDayUtc(next(d)))`.
 */
export function libyaDateToUtcMs(date: ISODate): number {
  const { year, month, day } = splitISODate(date)
  return Date.UTC(year, month - 1, day) - LIBYA_UTC_OFFSET_MINUTES * MS_PER_MINUTE
}

/**
 * مفتاح الفترة من تاريخ. **`periodKey ≡ bookedAt[0:7]` دائمًا** (ADR-008).
 *
 * «بداية الشهر المالي» في الإعدادات **ليست** جزءًا من هذا المفتاح: هي نافذة عرض/تقرير
 * على نطاق `bookedAt`، ولا تمسّ القيود ولا القواعد. خلط الاثنين كان تناقضًا قاتلًا.
 */
export function periodKeyOf(date: ISODate): PeriodKey {
  return date.slice(0, 7) as PeriodKey
}

/** هل النص تاريخ صالح فعلًا (يرفض 2026-02-30)؟ */
export function isValidISODate(value: string): value is ISODate {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const { year, month, day } = splitISODate(value as ISODate)
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  return true
}

export function isValidPeriodKey(value: string): value is PeriodKey {
  if (!PERIOD_KEY_PATTERN.test(value)) return false
  const month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12
}

/** يبني ISODate بعد التحقق. يرمي إن كان التاريخ غير صالح. */
export function toISODate(value: string): ISODate {
  if (!isValidISODate(value)) throw new RangeError(`تاريخ غير صالح: ${value}`)
  return value
}

/** عدد أيام شهر معيّن، مع مراعاة السنة الكبيسة. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** إضافة أيام (قد تكون سالبة). */
export function addDays(date: ISODate, days: number): ISODate {
  const { year, month, day } = splitISODate(date)
  const ms = Date.UTC(year, month - 1, day) + days * MS_PER_DAY
  const d = new Date(ms)
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` as ISODate
}

export function addWeeks(date: ISODate, weeks: number): ISODate {
  return addDays(date, weeks * 7)
}

/** سياسة التعامل مع يوم لا وجود له في الشهر الهدف (31 يناير + شهر = ؟). */
export type DayOfMonthPolicy = 'clampToEndOfMonth' | 'exact'

/**
 * إضافة شهور.
 *
 * - `clampToEndOfMonth` (الافتراضي): 2026-01-31 + شهر ⇒ 2026-02-28. وهو السلوك الصحيح
 *   لالتزام شهري يستحق في آخر الشهر.
 * - `exact`: يرمي إن لم يوجد اليوم في الشهر الهدف، بدل أن ينزلق صامتًا إلى الشهر التالي.
 *
 * **يُحرَّم** الاعتماد على `Date.setMonth` الذي يحوّل 31 فبراير إلى 3 مارس صامتًا —
 * وهذا أشهر مصدر لانزلاق تواريخ الاستحقاق.
 */
export function addMonths(
  date: ISODate,
  months: number,
  policy: DayOfMonthPolicy = 'clampToEndOfMonth',
): ISODate {
  const { year, month, day } = splitISODate(date)
  const totalMonths = year * 12 + (month - 1) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = (totalMonths % 12) + 1
  const limit = daysInMonth(targetYear, targetMonth)

  if (day > limit) {
    if (policy === 'exact') {
      throw new RangeError(`اليوم ${String(day)} غير موجود في ${pad4(targetYear)}-${pad2(targetMonth)}`)
    }
    return `${pad4(targetYear)}-${pad2(targetMonth)}-${pad2(limit)}` as ISODate
  }
  return `${pad4(targetYear)}-${pad2(targetMonth)}-${pad2(day)}` as ISODate
}

export function addYears(
  date: ISODate,
  years: number,
  policy: DayOfMonthPolicy = 'clampToEndOfMonth',
): ISODate {
  return addMonths(date, years * 12, policy)
}

/** فرق الأيام: b − a. */
export function diffDays(a: ISODate, b: ISODate): number {
  const { year: ay, month: am, day: ad } = splitISODate(a)
  const { year: by, month: bm, day: bd } = splitISODate(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY)
}

export function compareISODate(a: ISODate, b: ISODate): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return a < b
}

export function isAfter(a: ISODate, b: ISODate): boolean {
  return a > b
}

/** أول يوم في فترة. */
export function startOfPeriod(pk: PeriodKey): ISODate {
  return `${pk}-01` as ISODate
}

/** آخر يوم في فترة. */
export function endOfPeriod(pk: PeriodKey): ISODate {
  const year = Number(pk.slice(0, 4))
  const month = Number(pk.slice(5, 7))
  return `${pk}-${pad2(daysInMonth(year, month))}` as ISODate
}

/** الفترة التالية. */
export function nextPeriod(pk: PeriodKey): PeriodKey {
  return periodKeyOf(addMonths(startOfPeriod(pk), 1))
}

/** الفترة السابقة. */
export function previousPeriod(pk: PeriodKey): PeriodKey {
  return periodKeyOf(addMonths(startOfPeriod(pk), -1))
}

/** قائمة الفترات من `from` إلى `to` شاملةً الطرفين. */
export function periodRange(from: PeriodKey, to: PeriodKey): PeriodKey[] {
  const out: PeriodKey[] = []
  let cursor = from
  // حارس ضد مدى مقلوب أو ضخم: 1200 شهر = قرن.
  for (let i = 0; i < 1200 && cursor <= to; i++) {
    out.push(cursor)
    cursor = nextPeriod(cursor)
  }
  return out
}

function splitISODate(date: ISODate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}
