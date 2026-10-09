/**
 * تحويل مدخل المستخدم النصي إلى Minor — عقد النواة §2.2.
 *
 * **بلا أي حساب عشري عائم**: التحويل يتم بتجزئة النص، لأن `parseFloat('25.5') * 1000`
 * قد يعطي 25499.999999999996.
 *
 * **رفض صريح لا تقريب صامت** (القسم 25 بند 15 من المتطلبات): من يكتب `25.5055`
 * يجب أن يرى سببًا، لا أن يُحوَّل مبلغه خلسة.
 */

import { assertInRange, LYD_EXPONENT, MAX_ABS_MINOR, type Minor } from './types'

export type ParseErrorCode =
  | 'EMPTY'
  | 'NOT_A_NUMBER'
  | 'TOO_MANY_DECIMALS'
  | 'OUT_OF_RANGE'
  | 'NEGATIVE'

export type ParseResult = { ok: true; value: Minor } | { ok: false; code: ParseErrorCode }

/** رسائل الخطأ بالعربية الواضحة (القسم 25 بند 18). */
export const PARSE_ERROR_MESSAGES: Record<ParseErrorCode, string> = {
  EMPTY: 'أدخل المبلغ.',
  NOT_A_NUMBER: 'المبلغ غير صالح. اكتب رقمًا مثل 25.500',
  TOO_MANY_DECIMALS: 'الحد الأقصى ثلاث خانات عشرية (الدرهم).',
  OUT_OF_RANGE: 'المبلغ يتجاوز الحد المسموح.',
  NEGATIVE: 'المبلغ لا يمكن أن يكون سالبًا. استخدم نوع العملية المناسب بدل الإشارة السالبة.',
}

/**
 * نقاط الترميز معرَّفة **بالأرقام لا بالمحارف**: محرف غير مرئي مكتوب حرفيًا داخل الكود
 * مصدر أخطاء لا يراها أحد (وقد أمسكت قاعدة no-irregular-whitespace نسخة سابقة من هذا الملف).
 */
const CP = {
  /** ٠ — أول الأرقام الهندية-العربية. */
  arabicIndicZero: 0x0660,
  /** ۰ — أول الأرقام الفارسية الممتدة. */
  extendedArabicIndicZero: 0x06f0,
  /** ٫ — الفاصلة العشرية العربية. */
  arabicDecimalSeparator: 0x066b,
  /** ٬ — فاصل الآلاف العربي. */
  arabicThousandsSeparator: 0x066c,
} as const

const ARABIC_DECIMAL_CHAR = String.fromCodePoint(CP.arabicDecimalSeparator)

/**
 * محارف تُزال قبل التحليل: كل المسافات بأنواعها، فاصل الآلاف العربي،
 * وعلامات الاتجاه غير المرئية التي تلصقها لوحات المفاتيح العربية ونسخ النص من المتصفح.
 */
const STRIPPED_CODE_POINTS = new Set<number>([
  0x0009, // tab
  0x000a, // line feed
  0x000b, // vertical tab
  0x000c, // form feed
  0x000d, // carriage return
  0x0020, // space
  0x00a0, // no-break space
  0x2009, // thin space
  0x200e, // left-to-right mark
  0x200f, // right-to-left mark
  0x202f, // narrow no-break space
  0x2066, // left-to-right isolate
  0x2067, // right-to-left isolate
  0x2068, // first strong isolate
  0x2069, // pop directional isolate
  CP.arabicThousandsSeparator,
])

/**
 * يحوّل النص إلى مبلغ بالدرهم.
 *
 * **قاعدة الفواصل — حتمية وموثَّقة:**
 * - فاصل واحد فقط (`.` أو `,` أو `٫`) ⇒ هو الفاصل العشري. فـ `1,234` = `1.234` د.ل.
 * - فاصلان أو أكثر **من نفس النوع** ⇒ كلها فواصل آلاف. فـ `1,234,567` = `1234567` د.ل.
 * - فواصل مختلفة النوع ⇒ **الأخير** هو العشري وما قبله آلاف. فـ `1,234.750` و`1.234,750` كلاهما `1234.750`.
 * - بنية فواصل الآلاف تُفحص: المجموعة الأولى 1..3 أرقام وكل ما بعدها 3 بالضبط.
 *   بلا هذا الفحص يمرّ `25.5.5` كأنه `2555` — وهو القبول الصامت الذي يمنعه العقد.
 * - فاصل الآلاف المفضّل هو المسافة أو `٬` ولا يسبّب أي لبس.
 */
export function parseAmountToMinor(input: string): ParseResult {
  const normalized = stripInvisible(normalizeDigits(input))
  if (normalized.length === 0) return { ok: false, code: 'EMPTY' }

  let body = normalized
  let negative = false
  if (body.startsWith('-')) {
    negative = true
    body = body.slice(1)
  } else if (body.startsWith('+')) {
    body = body.slice(1)
  }
  if (body.length === 0) return { ok: false, code: 'NOT_A_NUMBER' }

  const separatorPositions: number[] = []
  const separatorChars: string[] = []
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? ''
    if (ch === '.' || ch === ',' || ch === ARABIC_DECIMAL_CHAR) {
      separatorPositions.push(i)
      separatorChars.push(ch === ARABIC_DECIMAL_CHAR ? ',' : ch)
    } else if (ch < '0' || ch > '9') {
      return { ok: false, code: 'NOT_A_NUMBER' }
    }
  }

  const decimalIndex = pickDecimalSeparator(separatorPositions, separatorChars)

  let integerPart: string
  let fractionPart: string
  if (decimalIndex === null) {
    if (!hasValidGrouping(body)) return { ok: false, code: 'NOT_A_NUMBER' }
    integerPart = stripSeparators(body)
    fractionPart = ''
  } else {
    const head = body.slice(0, decimalIndex)
    if (!hasValidGrouping(head)) return { ok: false, code: 'NOT_A_NUMBER' }
    integerPart = stripSeparators(head)
    fractionPart = stripSeparators(body.slice(decimalIndex + 1))
    if (body.slice(decimalIndex + 1).length !== fractionPart.length) {
      return { ok: false, code: 'NOT_A_NUMBER' }
    }
  }

  if (integerPart.length === 0 && fractionPart.length === 0) return { ok: false, code: 'NOT_A_NUMBER' }
  if (fractionPart.length > LYD_EXPONENT) return { ok: false, code: 'TOO_MANY_DECIMALS' }

  const digits = (integerPart.length > 0 ? integerPart : '0') + fractionPart.padEnd(LYD_EXPONENT, '0')

  // الحد يُفحص على النص قبل التحويل، لئلا نمرّ بعدد يتجاوز MAX_SAFE_INTEGER أصلًا.
  const trimmed = digits.replace(/^0+(?=[0-9])/, '')
  if (trimmed.length > String(MAX_ABS_MINOR).length) return { ok: false, code: 'OUT_OF_RANGE' }

  const magnitude = Number(trimmed)
  if (!Number.isSafeInteger(magnitude)) return { ok: false, code: 'OUT_OF_RANGE' }
  if (magnitude > MAX_ABS_MINOR) return { ok: false, code: 'OUT_OF_RANGE' }
  if (negative && magnitude !== 0) return { ok: false, code: 'NEGATIVE' }

  return { ok: true, value: assertInRange(magnitude) }
}

/** مثل parseAmountToMinor لكنه يقبل السالب — للتسويات وحقول الفرق فقط. */
export function parseSignedAmountToMinor(input: string): ParseResult {
  const trimmed = stripInvisible(normalizeDigits(input))
  const negative = trimmed.startsWith('-')
  const result = parseAmountToMinor(negative ? trimmed.slice(1) : trimmed)
  if (!result.ok) return result
  return { ok: true, value: assertInRange(negative ? 0 - (result.value as number) : result.value) }
}

/** يحوّل الأرقام الهندية-العربية والفارسية إلى لاتينية. الإدخال فقط — العرض لاتيني دائمًا (ق-3). */
export function normalizeDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= CP.arabicIndicZero && code <= CP.arabicIndicZero + 9) {
      out += String(code - CP.arabicIndicZero)
    } else if (code >= CP.extendedArabicIndicZero && code <= CP.extendedArabicIndicZero + 9) {
      out += String(code - CP.extendedArabicIndicZero)
    } else {
      out += ch
    }
  }
  return out
}

function stripInvisible(input: string): string {
  let out = ''
  for (const ch of input) {
    if (STRIPPED_CODE_POINTS.has(ch.codePointAt(0) ?? 0)) continue
    out += ch
  }
  return out
}

function stripSeparators(s: string): string {
  return s.replace(/[.,]/g, '')
}

/** المجموعة الأولى 1..3 أرقام، وكل مجموعة بعدها 3 أرقام بالضبط. */
function hasValidGrouping(head: string): boolean {
  if (!head.includes('.') && !head.includes(',')) return true
  const groups = head.split(/[.,]/)
  const first = groups[0] ?? ''
  if (first.length < 1 || first.length > 3) return false
  for (let i = 1; i < groups.length; i++) {
    if ((groups[i] ?? '').length !== 3) return false
  }
  return true
}

/** يطبّق قاعدة الفواصل الموثَّقة أعلاه ويعيد فهرس الفاصل العشري، أو null إن لم يوجد. */
function pickDecimalSeparator(positions: readonly number[], chars: readonly string[]): number | null {
  if (positions.length === 0) return null
  if (positions.length === 1) return positions[0] ?? null

  const first = chars[0]
  const allSame = chars.every((c) => c === first)
  if (allSame) return null // كلها فواصل آلاف

  return positions[positions.length - 1] ?? null
}
