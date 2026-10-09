/**
 * ULID — مُولِّد معرّفات العمليات (ADR-004).
 *
 * **لماذا ULID لا UUIDv4:** `entryId === opId`، و`opId` يصير معرّف المستند في Firestore.
 * معرّفات عشوائية تمامًا (UUIDv4) تُشتّت الكتابة عشوائيًا على مدى المفاتيح، بينما ULID
 * يبدأ بطابع زمني فيأتي ترتيبه المعجمي = ترتيبه الزمني. هذا يعطي:
 * - ترتيبًا زمنيًا مجانيًا بـ `orderBy(documentId())` بلا فهرس إضافي.
 * - ترقيم صفحات مستقرًا بـ `startAfter(lastId)`.
 * - قراءة تشخيصية: المعرّف نفسه يخبرك متى أُنشئ.
 *
 * **تحذير Firestore المضاد:** المفاتيح المتتابعة تُنشئ «نقطة ساخنة» عند معدلات كتابة عالية
 * (آلاف/ثانية على نفس المجموعة). النظام هنا مستخدم **واحد** بعشرات العمليات يوميًا،
 * فالحدّ بعيد بأربع مراتب عشرية، والمكسب (الترتيب المجاني) حقيقي. موثَّق للمراجعة لو تغيّر النطاق.
 *
 * **الحتمية ومنع الازدواج:** `opId` يُولَّد **مرة واحدة على العميل قبل أي اتصال** ويُثبَّت
 * في حالة النموذج. إعادة المحاولة بعد فشل الشبكة تُرسل **نفس** المعرّف، فتكتب Firestore
 * نفس المستند فلا يتضاعف شيء. العمليات المجدولة (التكرار) تستخدم مفتاحًا حتميًا منفصلًا
 * لا ULID — انظر `deterministicOpId`.
 */

/** أبجدية Crockford Base32: بلا I و L و O و U — تمنع اللبس البصري وأخطاء الإملاء. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = 32
const TIME_LEN = 10
const RANDOM_LEN = 16
const MAX_TIME = 281_474_976_710_655 // 2^48 − 1 ≈ عام 10889

/** آخر طابع زمني ومجموعة عشوائية، لضمان التتابع داخل نفس المللي ثانية. */
let lastTime = -1
let lastRandom: number[] = []

/** مصدر العشوائية. مُحقَن ليمكن تثبيته في الاختبارات. */
let randomSource: () => number = () => {
  const globalCrypto = globalThis.crypto as Crypto | undefined
  if (globalCrypto?.getRandomValues) {
    const buf = new Uint8Array(1)
    globalCrypto.getRandomValues(buf)
    return (buf[0] ?? 0) / 0x100
  }
  // لا بديل صامت: معرّف عملية مالية بعشوائية ضعيفة خطر تصادم حقيقي.
  throw new Error('crypto.getRandomValues غير متاح — لا يمكن توليد معرّف عملية آمن')
}

/** للاختبارات فقط. */
export function setUlidRandomSource(fn: () => number): void {
  randomSource = fn
  lastTime = -1
  lastRandom = []
}

/** للاختبارات فقط. */
export function resetUlidState(): void {
  lastTime = -1
  lastRandom = []
}

function encodeTime(now: number): string {
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIME) {
    throw new RangeError(`طابع زمني خارج مدى ULID: ${String(now)}`)
  }
  let out = ''
  let t = now
  for (let i = 0; i < TIME_LEN; i++) {
    out = ENCODING[t % ENCODING_LEN] + out
    t = Math.floor(t / ENCODING_LEN)
  }
  return out
}

function randomChars(): number[] {
  const out: number[] = new Array<number>(RANDOM_LEN)
  for (let i = 0; i < RANDOM_LEN; i++) {
    out[i] = Math.floor(randomSource() * ENCODING_LEN) % ENCODING_LEN
  }
  return out
}

/** يزيد المجموعة العشوائية بواحد، مع الحمل — يضمن التتابع داخل نفس المللي ثانية. */
function incrementRandom(chars: readonly number[]): number[] {
  const out = [...chars]
  for (let i = RANDOM_LEN - 1; i >= 0; i--) {
    const v = out[i] ?? 0
    if (v < ENCODING_LEN - 1) {
      out[i] = v + 1
      return out
    }
    out[i] = 0
  }
  // فاض المدى (2^80 معرّف في نفس المللي ثانية) — مستحيل عمليًا، ولا نُرجع معرّفًا مكسورًا.
  throw new Error('فاض مدى ULID داخل المللي ثانية نفسها')
}

/**
 * يولّد ULID رتيبًا (monotonic): معرّفان في نفس المللي ثانية يحافظان على ترتيب الإنشاء.
 * الطول 26 محرفًا دائمًا.
 *
 * `nowMs` يُمرَّر صراحةً من `@/lib/time` حتى لا يُستدعى `Date.now()` مباشرة في طبقات أخرى.
 */
export function ulid(nowMs: number): string {
  const time = Math.floor(nowMs)
  if (time === lastTime) {
    lastRandom = incrementRandom(lastRandom)
  } else {
    lastTime = time
    lastRandom = randomChars()
  }
  let rand = ''
  for (const c of lastRandom) rand += ENCODING[c]
  return encodeTime(time) + rand
}

/** يستخرج الطابع الزمني من ULID. مفيد للتشخيص ولفرز لا يحتاج قراءة المستند. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new RangeError(`ليس ULID صالحًا: ${id}`)
  let t = 0
  for (let i = 0; i < TIME_LEN; i++) {
    t = t * ENCODING_LEN + ENCODING.indexOf(id[i] ?? '')
  }
  return t
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value)
}

/**
 * مفتاح عملية **حتمي** للعمليات المولَّدة آليًا (التكرار، الاستدراك).
 *
 * لا يستخدم عشوائية ولا زمنًا: نفس المدخلات ⇒ نفس المفتاح، مهما تكرّر التشغيل
 * ومهما تعدّدت الأجهزة. هذا ما يمنع توليد نفس المصروف الشهري مرتين عند فتح
 * التطبيق من الهاتف والحاسوب في اللحظة نفسها.
 *
 * ```
 * deterministicOpId('rec', 'rent-2026', '2026-03-01') → 'rec__rent-2026__2026-03-01'
 * ```
 *
 * الطول الأقصى لمعرّف مستند Firestore 1500 بايت، والمكوّنات هنا قصيرة ومضبوطة،
 * لكن الدالة تتحقق على كل حال بدل أن تُنتج معرّفًا يُرفض عند الكتابة.
 */
export function deterministicOpId(prefix: string, ...parts: readonly string[]): string {
  const all = [prefix, ...parts]
  for (const p of all) {
    if (p.length === 0) throw new RangeError('مكوّن فارغ في مفتاح العملية الحتمي')
    if (p.includes('/') || p.includes('__')) {
      throw new RangeError(`مكوّن غير صالح في مفتاح العملية: ${p}`)
    }
  }
  const id = all.join('__')
  if (id.length > 1500) throw new RangeError('مفتاح العملية أطول من حدّ Firestore')
  return id
}
