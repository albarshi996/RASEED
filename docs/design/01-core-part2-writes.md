## 6. منع الازدواج النهائي

### 6.1 القاعدة الحاكمة (ADR-004)

> **منع الازدواج خصيصةٌ في مفتاح المستند، لا منطق تطبيقي.**
> `journalEntries/{entryId}` حيث `entryId === opId`، والكتابة تتم بـ `tx.set(ref, data)` بعد
> `tx.get(ref)` داخل نفس `runTransaction`. لا يوجد في النظام أي فحص «هل سجّلنا هذا قبلاً؟» بالاستعلام،
> ولا حقل `isDuplicate`، ولا قفل تطبيقي، ولا نافذة زمنية.

**لماذا هذا أقوى من أي منطق تطبيقي — السبب التقني الدقيق:**

معاملة Firestore لا تتبّع **القيم** المقروءة فقط، بل تتبّع **العدم** أيضاً: `tx.get(ref)` على مستند غير
موجود يُسجِّل شرطاً مسبقاً (precondition) بأن المستند **غير موجود** عند لحظة اللقطة. فإن أنشأ جهازٌ آخر
نفس المستند قبل تثبيت معاملتنا، فشلت معاملتنا بـ `aborted` وأُعيدت تلقائياً، لتقرأ في المحاولة الثانية
مستنداً **موجوداً** وتخرج بـ `alreadyApplied` بلا أي كتابة.

هذا يحوّل النمط من `check-then-act` (وهو سباق لا يُحسم أبداً) إلى **compare-and-set ذرّي على مفتاح**.
أي بديل تطبيقي — استعلام «ابحث عن قيد بنفس المبلغ والحساب في آخر دقيقة» — هو `check-then-act` حقيقي:
بين الاستعلام والكتابة نافذة مفتوحة، والاستعلام نفسه **غير مسموح داخل المعاملة** في Web SDK
(`tx.get` يقبل `DocumentReference` فقط). ولهذا السبب بالذات **كل** معرّفات النظام حتمية الشكل
(القسم 7.1) — لا نحتاج استعلاماً داخل معاملة أبداً.

### 6.2 توليد `opId` على العميل — المخططات الثمانية

```ts
// domain/ops/opId.ts
export type OpScheme = 'man' | 'rec' | 'ocr' | 'rev' | 'amd' | 'opn' | 'adj' | 'imp';

/** الشكل الوحيد المقبول. يُفرَض في النطاق وفي Firestore Rules معاً. */
export const OP_ID_RE = /^(man|rec|ocr|rev|amd|opn|adj|imp):[A-Za-z0-9_\-.:]{1,180}$/;

export function assertOpIdShape(opId: string): void;   // يرمي OpIdShapeError
```

| المخطط | الصيغة النهائية | الحتمية | مثال حقيقي |
|---|---|---|---|
| `man` | `man:<ulid>` | **عشوائي مستقر** | `man:01JA7H3K9QX4YV8M2TBRD5F0WZ` |
| `rec` | `rec:<recurringId>:<occurrenceKey>` | **حتمي** | `rec:rcr_netflix:2026-10-05` |
| `ocr` | `ocr:<obligationId>:<occurrenceKey>` | **حتمي** | `ocr:obl_rent:2026-11-01` |
| `rev` | `rev:<originalEntryId>` | **حتمي** | `rev:man:01JA7H3K9QX4YV8M2TBRD5F0WZ` |
| `amd` | `amd:<rootEntryId>:<ulid>` | **عشوائي مستقر + قفل** | `amd:man:01JA7H…F0WZ:01JA7JQ8M0C3K7` |
| `opn` | `opn:<accountId>` | **حتمي** | `opn:asset.cash.main` |
| `adj` | `adj:<ulid>` | **عشوائي مستقر** | `adj:01JA7M2PT4RN9D6SXB1VHE0GYK` |
| `imp` | `imp:<importBatchId>:<rowIndex>` | **حتمي** | `imp:imp_2026-10-09T14-22:0417` |

**ملاحظات إلزامية على الشكل:**

1. `opId` **هو** معرّف المستند، فيجب أن يجتاز قيود Firestore على المعرّفات: لا يحتوي `/`،
   طوله ≤ 190 بايت بهامش أمان (الحد 1500)، لا يساوي `.` ولا `..`، ولا يطابق `__.*__`.
   النقطتان `:` مسموحتان في معرّف المستند — وهي المحدِّد المختار لأنها لا تَرِد في أي `ulid`
   ولا في `YYYY-MM-DD` ولا في معرّفاتنا الداخلية، فالتجزئة العكسية `opId.split(':')` بلا غموض.
2. `ulid` = **ULID** (Crockford Base32، 26 حرفاً، حروف كبيرة فقط، مولَّد من `crypto.getRandomValues`).
   اختياره على `crypto.randomUUID()` لسببين عمليين لا جماليين: (أ) قابل للترتيب معجمياً حسب زمن
   التوليد ⇒ `orderBy(__name__)` يعطي ترتيباً زمنياً مجانياً، وهو ما يحتاجه مؤشر استئناف إعادة البناء
   (ADR-015) ومسار التصدير؛ (ب) 26 حرفاً بلا شُرَط مقابل 36 حرفاً، فهو أقصر في المفاتيح المركّبة.
   **التجزئة الساخنة (hotspotting) على المعرّفات المتتالية ليست خطراً هنا:** مستخدم واحد،
   ~30 كتابة/يوم، والحد الفعلي 500 كتابة/ثانية لكل نطاق معرّفات — بعيد بمعامل 10⁶.
3. `occurrenceKey` = `'YYYY-MM-DD'` = **تاريخ استحقاق الدورة محسوباً من قالب التكرار**
   (تاريخ المرساة + الدورية + الفهرس)، **لا من `Date.now()`**. هذا شرط الحتمية: جهازان يحسبان
   نفس المفتاح لنفس الدورة بالضبط، فيستحيل أن يُولِّدا قيدين (ADR-013).

### 6.3 الحتمي مقابل العشوائي المستقر — الحسم

**القاعدة الفاصلة:**

> إن كان **من الممكن لجهازين أو جلستين أن يستنتجا نفس العملية المنطقية استنتاجاً** (من قالب، من
> جدول، من قيد قائم، من ملف استيراد) ⇒ المفتاح **حتمي ومشتق من محتواه المنطقي**.
> وإن كانت العملية **قراراً بشرياً لحظياً** لا يمكن استنتاجه ⇒ المفتاح **عشوائي**، ويُجمَّد قبل أول إرسال.

| الحالة | المخطط | لماذا هذا وليس غيره |
|---|---|---|
| تنفيذ مصروف/دخل متكرر عند فتح التطبيق | `rec` حتمي | فتح التطبيق من الهاتف والحاسوب في نفس الدقيقة ⇒ نفس المفتاح ⇒ قيد واحد. مفتاح عشوائي كان سينتج قيدين |
| استدراك دورات التزام فائتة (ق-1: المادّية عند الفتح) | `ocr` حتمي | الاستدراك يُنفَّذ كلما فُتح التطبيق؛ الحتمية هي الشيء الوحيد الذي يجعل تكراره بلا أثر |
| عكس قيد | `rev` حتمي | «اعكس هذا القيد» عملية **مُعرَّفة تماماً بالقيد الأصلي** ⇒ عكسٌ مزدوج مستحيل بنيوياً |
| قيد افتتاحي لحساب | `opn` حتمي | رصيد افتتاحي واحد لكل حساب إلى الأبد |
| استيراد ملف JSON (النسخة الاحتياطية، ق-1) | `imp` حتمي | إعادة استيراد نفس الملف بعد انقطاع ⇒ صفر تضاعف |
| **إدخال يدوي** (مصروف، دخل، تحويل، دفعة التزام، تحصيل دين، تخصيص لهدف) | `man` عشوائي مستقر | قهوتان بنفس المبلغ من نفس الحساب في نفس الدقيقة **عمليتان حقيقيتان**. مفتاح حتمي مشتق من المحتوى كان **سيمنع الثانية** — وهذا فقدان بيانات لا منع ازدواج |
| تعديل قيد | `amd` عشوائي مستقر + قفل مستقل | التعديل الثاني لنفس القيد مشروع، فلا يصلح مفتاح حتمي؛ والتزامن يُحسم بقفل القسم 8.5 لا بالمفتاح |
| تسوية يدوية على حساب | `adj` عشوائي مستقر | قرار بشري قد يتكرر مشروعاً |

**`crypto.randomUUID()` ليس حتمياً — ولذلك يُجمَّد.** دورة حياة المفتاح العشوائي:

```
[t0] فتح النموذج
     opId = `man:${ulid()}`
     formInstanceId = opId                       ← المفتاح هو هوية النموذج نفسها
     putDraft(opId, { payload, state: 'draft' }) ← كتابة متزامنة في IndexedDB قبل أي إدخال
     يُوضع opId في مسار التنقّل: /expense/new?f=<opId>
        │
        │  المستخدم يكتب ويغيّر المبلغ 10 مرات  → الحمولة تتغيّر، opId **لا يتغيّر**
        │  (آمن تماماً: لم تُرسَل أي محاولة ⇒ لا يمكن أن يوجد مستند بهذا المفتاح على الخادم)
        │  إعادة تحميل الصفحة / إغلاق المتصفح / تعطّل التبويب → يُستعاد من IndexedDB بنفس opId
        ▼
[t1] أول ضغطة على «حفظ»  ⇒ **التجميد المزدوج**
     state = 'sending'; payloadFrozen = true
     النموذج يصبح للقراءة فقط. الأزرار المتاحة: «إعادة المحاولة» فقط.
        │
        ├── نجاح                → حُفِظ. تعديل لاحق = مسار القسم 8 (عكس + بديل)
        ├── فشل قابل للإعادة    → نفس opId ونفس الحمولة حرفياً، مهما تكرّرت المحاولات
        └── فشل نهائي (رفض نطاق) → المعاملة رُمِيت قبل أي كتابة ⇒ لا مستند.
                                   التعديل مسموح، لكن **بمفتاح جديد**:
                                   opId' = `man:${ulid()}`, retryOf = opId
```

**لماذا مفتاح جديد بعد الرفض النهائي ولا نُعيد استخدام القديم؟** لأن تصنيف الخطأ إلى «نهائي» قرار
برمجي قابل للخطأ، وإعادة استخدام مفتاح مع حمولة مختلفة تُحوِّل خطأ تصنيف واحداً إلى
`OP_PAYLOAD_MISMATCH` دائم يُقفِل العملية على المستخدم. مفتاح جديد يكلّف صفراً ويُلغي الغموض.

### 6.4 `payloadHash` — ما يُجزَّأ بالضبط

`payloadHash` **ليس** بديلاً عن المفتاح ولا تعزيزاً له. المفتاح يجيب: «هل طُبِّقت هذه العملية؟».
و`payloadHash` يجيب سؤالاً مختلفاً تماماً: **«هل العملية المطبَّقة بهذا المفتاح هي العملية التي أرسلها
هذا الطلب؟»** — وتضارب الجواب **عيب برمجي، لا تكرار**.

```ts
// domain/ops/payloadHash.ts

const FS = '\u001F';   // فاصل حقل
const RS = '\u001E';   // فاصل سطر
const RESERVED_TAGS = ['household', 'personal'] as const;

/** مفاتيح refs المالية فقط، بترتيب ثابت أبدي. إضافة مفتاح جديد ⇒ رفع إصدار التقنين. */
const HASHED_REF_KEYS = [
  'obligationId', 'obligationInstallmentIndex',
  'debtId', 'debtDirection',
  'goalId', 'budgetId',
  'recurringId', 'recurringOccurrenceKey',
  'incomeScheduleId', 'transferPairKey', 'zakatRecordId',
] as const;

/**
 * التقنين (canonicalization) — نص واحد حتمي، بلا JSON.stringify إطلاقاً.
 * السبب: ترتيب مفاتيح الكائن في JSON.stringify غير مضمون عبر المحرّكات وعبر إعادة البناء،
 * ونحن نقارن تجزئتين وُلِّدتا على جهازين مختلفين في وقتين مختلفين.
 *
 * الترتيب الملزم للحقول:
 *   1  kind
 *   2  bookedAt                      'YYYY-MM-DD'
 *   3  currency                      'LYD'
 *   4  lines[]  مرتَّبة تصاعدياً بـ (accountId, side, amountMinor) ثم كل سطر:
 *        accountId FS side FS amountMinor FS categoryId? FS contactId? FS settlementDeltaMinor?
 *      والسطور مفصولة بـ RS
 *   5  refs      مفاتيح HASHED_REF_KEYS بترتيبها أعلاه، كل غائب = '-'
 *   6  reservedTags   = (tags ∩ RESERVED_TAGS) مرتَّبة أبجدياً، مفصولة بفاصلة
 *   7  originalEntryId   (للعكس والتعديل فقط، وإلا '-')
 *
 * قواعد التسلسل: النصوص بـ NFC بعد trim؛ الأعداد بالعشري بلا فواصل ولا إشارة زائدة؛
 * الغائب = '-' حرفياً (لا سلسلة فارغة، للتمييز بين «غائب» و«فارغ»).
 */
export function canonicalizePayload(op: OperationRequest): string;

/** `v1:` + SHA-256 بالست عشري الصغير (64 حرفاً) عبر crypto.subtle.digest. */
export async function computePayloadHash(op: OperationRequest): Promise<string>;
```

**ما يُستثنى صراحةً من التجزئة، ولماذا:**

| الحقل المستثنى | السبب |
|---|---|
| `description`, `memo`, `notes` | تعديل وصفي حرّ (القسم 8.4 صنف أ). لو جُزِّئت، لأصبح تصحيح خطأ إملائي بين محاولتين تضارباً كاذباً |
| الوسوم الحرّة (ما خلا `RESERVED_TAGS`) | لا أثر على أي مُجمَّع |
| `attachmentIds` | معطَّلة على Spark (ق-1)، وبلا أثر مالي |
| `valueDate` | تاريخ القيمة المصرفي — معلومة وصفية لا تمسّ `periodKey` (ADR-008) |
| `deviceId`, `clientCreatedAt`, `opId`, `createdAt` | بيانات نقل وتدقيق؛ تجزئتها تُفشِل كل إعادة محاولة من جهاز آخر |

**الفائدة التي لا يعطيها المفتاح وحده — السيناريو الحقيقي الذي يكشفه:**

> المستخدم يفتح نموذج مصروف، يكتب `25.500`، يضغط «حفظ». الشبكة تتجمّد 40 ثانية. التبويب يُقتل.
> يفتح التطبيق فيُستعاد المسوَّد بنفس `opId` من IndexedDB؛ بسبب عيب برمجي في استعادة حالة التجميد
> يظهر النموذج قابلاً للتعديل، فيُصلِح المبلغ إلى `30.000` ويضغط «حفظ». وفي هذه اللحظة كانت المعاملة
> الأولى قد ثُبِّتت فعلاً على الخادم.
>
> **بالمفتاح وحده:** المعاملة الثانية تقرأ المستند موجوداً وتُرجِع `alreadyApplied` ⇒ الواجهة تقول
> «تم الحفظ» والمستخدم مقتنع أن مصروفه `30.000`، والدفتر يحمل `25.500`. **خطأ صامت.**
> **بـ `payloadHash`:** التجزئتان مختلفتان ⇒ `OP_PAYLOAD_MISMATCH` ⇒ رسالة عربية صريحة:
> «هذه العملية سُجِّلت فعلاً بمبلغ 25.500 د.ل. لتغيير المبلغ استخدم «تعديل العملية».»
> وسطر في `auditLogs` بالرمز `OP_PAYLOAD_MISMATCH` لأنه **عيب برمجي يجب أن يُلاحَظ ويُصلَح**.

**معالجة إصدار التقنين:** إن اختلف البادئ (`v1:` مقابل `v2:`) **تُتخطّى المقارنة** ويُسجَّل سطر
`auditLogs` بالرمز `HASH_VERSION_SKEW`، ولا تفشل العملية. وإلا لحوّل كل ترقية للتقنين كل
`pendingCommands` القديمة إلى أخطاء كاذبة.

### 6.5 مصفوفة بوابة الازدواج — كل حالات المستند القائم

تُنفَّذ هذه المصفوفة داخل مرحلة القراءة في `postOperation` قبل أي تخطيط (القسم 7.4، الخطوة 2):

| حالة `journalEntries/{opId}` | `payloadHash` | النتيجة | الكتابات |
|---|---|---|---|
| غير موجود | — | المتابعة إلى `planOperation()` | حسب الخطة |
| موجود، `reversed === false` | مطابق | `{ alreadyApplied: true }` + رسالة «هذه العملية مسجَّلة مسبقاً» | **0** |
| موجود، `reversed === true` | مطابق | `{ alreadyApplied: true, wasReversed: true }` + تنبيه «العملية مسجَّلة ثم أُلغيت» | **0** |
| موجود، `status === 'replaced'` | مطابق | `{ alreadyApplied: true, replacedByEntryId }` + تحويل الواجهة إلى القيد السارِي | **0** |
| موجود | **غير مطابق** | **رمي** `OP_PAYLOAD_MISMATCH` + `auditLogs` | **0** مالية |
| موجود | بادئ إصدار مختلف | `alreadyApplied: true` + `HASH_VERSION_SKEW` في `auditLogs` | **0** مالية |

### 6.6 السيناريوهات الأربعة — بالنتيجة الرقمية

| السيناريو | ما يحدث تقنياً، خطوة بخطوة | النتيجة النهائية |
|---|---|---|
| **ضغط الزر مرتين** (نقرة مزدوجة، أو نقرة ثم Enter) | النقرة الأولى: `state='sending'`، الزر يُعطَّل بـ `disabled` **تزامنياً في نفس معالج الحدث** قبل أي `await`. إن تسرّبت نقرة ثانية (لمسة مزدوجة على الهاتف قبل إعادة الرسم): نفس `opId` ⇒ إحدى المعاملتين تُثبِّت، والأخرى تفشل `aborted` ⇒ إعادة محاولة تلقائية ⇒ تقرأ المستند موجوداً + نفس `payloadHash` ⇒ `alreadyApplied` | **قيد واحد. 8 كتابات لا 16.** رصيد الحساب تغيّر مرة واحدة |
| **إعادة المحاولة بعد فشل الشبكة** | المعاملة فشلت بـ `unavailable`. الحمولة مجمَّدة (6.3 عند t1) ⇒ إعادة الإرسال بنفس `opId` ونفس `payloadHash` حرفياً. الاحتمالان: (أ) لم تُثبَّت ⇒ تُنشأ الآن؛ (ب) ثُبِّتت والتأكيد فُقِد ⇒ `alreadyApplied` | **قيد واحد في الحالتين.** غموض «هل وصلت؟» **غير ممكن** |
| **تنفيذ المصروف المتكرر** | عند كل فتح للتطبيق يعمل مُشغِّل الاستدراك (ADR-013): لكل دورة مستحقة `opId = rec:{recurringId}:{occurrenceKey}`. الفتح العشرون في نفس اليوم يحسب **نفس المفتاح** ⇒ `alreadyApplied` ⇒ صفر كتابة | **قيد واحد لكل دورة مدى الحياة**، مهما تعدّد الفتح والأجهزة وإعادة التثبيت |
| **فتح التطبيق من جهازين في نفس اللحظة** | كلا الجهازين يحسب `rec:rcr_netflix:2026-10-05`. كلاهما يفتح معاملة ويقرأ المستند **غير موجود** (شرط مسبق مُتتبَّع). الأول يُثبِّت. الثاني يفشل `aborted` ⇒ إعادة محاولة ⇒ المستند موجود ⇒ `alreadyApplied` | **قيد واحد.** ولا حاجة إلى قفل ولا إلى «جهاز رئيسي» ولا إلى تعيين مالك للجدولة |

### 6.7 التشابه الدلالي — تحذير لا منع

منع الازدواج التقني **لا يمسّ** الازدواج الدلالي ولا يجوز أن يمسّه: مصروفان بنفس المبلغ ونفس الحساب
ونفس اليوم **قد يكونان حقيقيين** (قهوتان، وجبتان، تعبئتا وقود). الحجب هنا **فقدان بيانات**، والتصميم
المعتمد **تحذير قابل للتجاوز بنقرة واحدة**.

```ts
// domain/rules/softDuplicate.ts
export interface SoftDuplicateHit {
  readonly entryId: string;
  readonly amountMinor: Minor;
  readonly bookedAt: string;
  readonly minutesAgo: number;      // من createdAt المخزَّن
  readonly tier: 'T1' | 'T2';
}

/**
 * `recent` تأتي **من الذاكرة المخبّأة المحلية** للمستمع الذي يغذّي «آخر العمليات» أصلاً
 * (آخر 50 قيداً) ⇒ **صفر قراءة إضافية على Spark**. يُحرَّم إصدار استعلام من أجل هذه الدالة.
 * نقية 100% — تُختبر بلا Firebase.
 */
export function detectSoftDuplicate(
  draft: EntryDraft,
  recent: readonly JournalEntry[],
): SoftDuplicateHit | null;
```

**الشروط الخمسة التي يجب أن تتحقق كلها (أي واحد ينتفي ⇒ لا تحذير):**

1. `draft.kind === candidate.kind`
2. مجموعة `(accountId, side)` لسطور المسوَّدة **مطابقة تماماً** لمجموعة سطور المرشَّح
   (نفس الحساب النقدي ونفس الحساب المقابل/الفئة بنفس الاتجاهين)
3. `draft.amountMinor === candidate.amountMinor` — **تساوٍ تام**، لا تقارب ولا نسبة
4. `draft.bookedAt === candidate.bookedAt`
5. `candidate.reversed === false && candidate.status === 'posted'`

**الاستثناءات المطلقة — لا تحذير أبداً:**

- `draft.refs.recurringId` موجود (العملية مولَّدة آلياً؛ التحذير ضجيج محض)
- `draft.kind === 'transfer'` وأحد الحسابين مختلف
- المرشَّح يحمل `duplicateAckOf` يساوي قيداً سابقاً (لا نحذّر من سلسلة أقرّها المستخدم مرتين)

**النافذة — طبقتان، لأن نافذة واحدة إما صاخبة أو عديمة الفائدة:**

| الطبقة | النافذة | شرط المبلغ | المنطق |
|---|---|---|---|
| **T1** | `minutesAgo ≤ 10` | أي مبلغ | يغطّي الإرسال المزدوج من نموذجين مختلفين أو من جهازين — الاحتمال الغالب للخطأ الحقيقي |
| **T2** | نفس اليوم كاملاً (`bookedAt` متطابق) | `amountMinor ≥ 50_000` (= 50.000 د.ل) | تكرار 5.000 د.ل في اليوم طبيعي؛ تكرار 50.000 د.ل على نفس الحساب ونفس الفئة في نفس اليوم استثنائي يستحق سؤالاً |

**الرسالة والأثر** (أرقام لاتينية، ق-3):

> «سجّلت مصروفاً مشابهاً بقيمة 25.500 د.ل من «نقد المحفظة» على فئة «الطعام والمشروبات» قبل 4 دقائق.
> هل هذه عملية جديدة؟»   `[ نعم، عملية جديدة ]`   `[ عرض العملية السابقة ]`   `[ إلغاء ]`

- «نعم» ⇒ تُرحَّل العملية ويُكتب على القيد الجديد `duplicateAckOf = <entryId المطابق>`.
  **الغرض:** يُثبت التدقيق لاحقاً أن النظام سأل وأن المستخدم أجاب — لا «لماذا لم يحذّرني؟».
- «عرض العملية السابقة» ⇒ تُحفظ المسوَّدة بنفس `opId` وتُفتَح العملية السابقة؛ العودة تستعيد المسوَّدة كما هي.
- التحذير **لا يُسجَّل في `auditLogs`** إن أُلغيت العملية — لا ضجيج في سجل التدقيق.

### 6.8 اختبارات القسم 6 الإلزامية

| الاختبار | المتوقع |
|---|---|
| `postOperation` بنفس الطلب حرفياً مرتين متتاليتين | قيد واحد، الثانية `alreadyApplied: true`، صفر كتابة، `account.balanceVersion` زاد **1** فقط |
| معاملتان متوازيتان بنفس `opId` (محاكي Firestore) | قيد واحد، إحداهما `alreadyApplied`، لا تضاعف في `postings` |
| نفس `opId` بمبلغ مختلف | `OP_PAYLOAD_MISMATCH`، صفر كتابة مالية، سطر في `auditLogs` |
| نفس `opId` بوصف مختلف فقط | نجاح `alreadyApplied` — **لا** تضارب |
| `canonicalizePayload` على نفس الحمولة بترتيب مفاتيح كائن مختلف | **نص متطابق حرفياً** (property test على 1,000 تبديل) |
| `rec:{id}:{key}` من جهازين متزامنين | قيد واحد |
| مُشغِّل الاستدراك يُنفَّذ 20 مرة في نفس اليوم | عدد القيود = عدد الدورات المستحقة، لا أكثر |
| `assertOpIdShape` على `man:a/b`, `__x__`, `..`, 300 حرفاً | رفض في الأربع |
| `detectSoftDuplicate` بمبلغ 5.000 مكرر في نفس اليوم بفارق 3 ساعات | `null` (أقل من T2) |
| `detectSoftDuplicate` بمبلغ 60.000 مكرر في نفس اليوم بفارق 6 ساعات | `tier: 'T2'` |
| `detectSoftDuplicate` على عملية بـ `refs.recurringId` | `null` دائماً |

---

## 7. بنية المعاملة الإلزامية `TxPlan`

### 7.1 `TxPlan` كبنية بيانات

`TxPlan` **بيان (declaration) لا تنفيذ**: تُنتجها `planOperation()` النقية، وتستهلكها `postOperation()`.
فائدتها الحاسمة: المعاملة تصبح **قابلة للفحص قبل التنفيذ** وقابلة للاختبار الجدولي بلا Firebase،
وتُعدّ كتاباتها عدّاً دقيقاً قبل إرسال بايت واحد.

```ts
// domain/ledger/txPlan.ts

/** كل مسار في النظام حتمي. لا توجد صيغة مسار تحتاج استعلاماً. */
export type DocPath =
  | { col: 'journalEntries';  id: string }   // = opId  أو `${opId}__rev` / `${opId}__new`
  | { col: 'postings';        id: string }   // = `${entryId}__${lineNo}`
  | { col: 'accounts';        id: string }
  | { col: 'accountPeriods';  id: string }   // = `${accountId}__${periodKey}`
  | { col: 'entryCorrections';id: string }   // = rootEntryId
  | { col: 'obligations';     id: string }
  | { col: 'debts';           id: string }
  | { col: 'budgets';         id: string }   // = periodKey   ('YYYY-MM')
  | { col: 'financialGoals';  id: string }
  | { col: 'auditLogs';       id: string }   // = opId  (حتمي ⇒ لا تكرار سطر تدقيق)
  | { col: 'pendingCommands'; id: string };  // = opId  — **لا تُقرأ ولا تُكتب داخل المعاملة**

export type SnapshotSlot =
  | 'existingEntry' | 'correctionLock' | 'originalEntry'
  | `account:${string}` | `accountPeriod:${string}`
  | 'obligation' | 'debt' | 'goal' | 'budget';

export interface TxRead {
  readonly path: DocPath;
  readonly slot: SnapshotSlot;
  readonly required: boolean;     // false ⇒ الغياب حالة مشروعة (accountPeriods أول الشهر)
}

export type TxWrite =
  | { op: 'create'; path: DocPath; data: Record<string, unknown> }   // يفشل إن وُجد
  | { op: 'set';    path: DocPath; data: Record<string, unknown>; merge: boolean }
  | { op: 'update'; path: DocPath; data: Record<string, unknown> };  // يفشل إن لم يوجد

export type CheckId =
  | 'BALANCED'            // Σ debit = Σ credit لكل قيد في الخطة
  | 'POSITIVE_LINES'      // كل amountMinor > 0، ولا سطر صفري أو سالب
  | 'MIN_BALANCE'         // balanceMinor الناتج ≥ account.minBalanceMinor  (ADR-010)
  | 'NO_OVERPAY'          // paidMinor ≤ totalMinor + extraChargesMinor     (ADR-012)
  | 'NO_OVERSETTLE'       // settledMinor ≤ debt.principalMinor
  | 'SETTLEMENT_MIRROR'   // Σ settlementDeltaMinor في الخطة = دلتا paidMinor/settledMinor (ADR-021)
  | 'POSTABLE_ACCOUNTS'   // isPostable && status === 'active'
  | 'PERIOD_KEY_MATCH'    // periodKey === bookedAt.slice(0,7) لكل قيد   (ADR-008)
  | 'NOT_FUTURE'          // bookedAt ≤ libyaToday()
  | 'MAX_ABS'             // كل مبلغ ≤ MAX_ABS_MINOR
  | 'WRITE_BUDGET';       // plan.writes.length ≤ 60

export interface TxCheck {
  readonly id: CheckId;
  readonly code: DomainErrorCode;
  readonly ctx: Record<string, string | number>;  // لبناء الرسالة العربية
}

export interface TxPlan {
  readonly opId: string;
  readonly payloadHash: string;
  readonly reads:  readonly TxRead[];    // (1) تُنفَّذ كلها أولاً
  readonly writes: readonly TxWrite[];   // (2) بعد كل القراءات، بلا استثناء
  readonly checks: readonly TxCheck[];   // (3) تُقيَّم على اللقطة + الخطة قبل أي كتابة
  readonly effects: PlanEffects;         // الدلتا المتوقَّعة — للتحقق والعرض
  readonly warnings: readonly DomainWarning[];  // تجاوز ميزانية، تجاوز حجز (ADR-017)…
}

export interface PlanEffects {
  readonly entryIds: readonly string[];
  readonly balanceAfter: Readonly<Record<string, Minor>>;   // accountId → الرصيد الناتج
  readonly periodKeysTouched: readonly string[];
  readonly settlementDelta?: { readonly kind: 'obligation' | 'debt'; readonly id: string; readonly deltaMinor: Minor };
}
```

**ترتيب `reads` إلزامي ومُعرَّف:** `existingEntry` أولاً، ثم `correctionLock`/`originalEntry`، ثم الحسابات
بترتيب `accountId` أبجدياً، ثم `accountPeriods` بنفس الترتيب، ثم المرافقات. السبب ليس التجميل:
ترتيباً ثابتاً للقراءات على نفس المستندات يقلّل احتمال التصادم المتبادل بين معاملتين متوازيتين،
وأهم من ذلك أنه يجعل سجلات التشخيص قابلة للمقارنة بين محاولة وأخرى.

**قاعدة بنيوية:** `TxPlan.reads` لا تحتوي إلا مسارات من `DocPath`. `planOperation()` التي تحتاج
استعلاماً = **عيب تصميم**، لأن الاستعلام ممنوع داخل المعاملة في Web SDK. أي بيانات يحتاجها التخطيط
ولا يمكن الوصول إليها بمعرّف حتمي **تُقرأ قبل المعاملة** وتُمرَّر في `PostContext`، **ولا يُبنى عليها
أي حارس مالي** — لأنها غير متزامنة مع لقطة المعاملة.

### 7.2 `runTransaction` مقابل `writeBatch`

**القاعدة الفاصلة:**

> إن كان **قرار** الكتابة أو **قيمتها** يعتمد على مستند مقروء ⇒ `runTransaction`.
> إن كانت كل الكتابات معروفة بالكامل سلفاً ⇒ `writeBatch`.

وبما أن **كل** عملية مالية في «رصيد» تقرأ على الأقل `journalEntries/{opId}` (بوابة الازدواج):
**كل ترحيل قيد = `runTransaction`، بلا استثناء واحد.**

| العملية | الأداة | السبب الدقيق |
|---|---|---|
| مصروف / دخل | `runTransaction` | بوابة `opId` + `MIN_BALANCE` + دلتا الميزانية |
| تحويل بين حسابين | `runTransaction` | `MIN_BALANCE` على حساب المصدر |
| دفعة التزام (جزئية/كاملة) | `runTransaction` | قراءة `paidMinor` و`totalMinor` و`extraChargesMinor` لمنع `NO_OVERPAY` |
| تحصيل/سداد دين | `runTransaction` | قراءة `settledMinor` لمنع `NO_OVERSETTLE` |
| قيد افتتاحي | `runTransaction` | `opn:{accountId}` مرة واحدة |
| عكس / تعديل | `runTransaction` **واحدة** | يقرأ الأصل وقفل `entryCorrections`؛ والعكس والبديل **ذرّيان معاً** وإلا ظهر رصيد خاطئ لحظياً |
| تخصيص لهدف (`earmark`) | `runTransaction` | `earmarkedMinor` + رصيد الحساب (ADR-017) |
| تهيئة شجرة الحسابات (~45 مستنداً) | `writeBatch` مجزَّأة 450 | لا قراءة، والمحتوى معروف سلفاً |
| استيراد نسخة JSON (قيود تاريخية) | `writeBatch` للقيود و`postings` + تمريرة تجميع لاحقة بـ `runTransaction` لكل حساب | القيود معروفة سلفاً؛ والمُجمَّعات تُحسب محلياً مرة واحدة بدل 2,000 معاملة |
| إعادة بناء الإسقاطات (ADR-015) | `writeBatch` مجزَّأة 450 بقيم **مطلقة** لا دلتا | لا قراءة؛ القيم محسوبة محلياً بالكامل |
| تحديث حالات الالتزامات اليومية (`due → overdue`) | `writeBatch` | الحالة مشتقة من التاريخ لا من مبلغ |
| إنشاء/أرشفة حساب أو فئة | `setDoc` / `writeBatch` | لا أثر على أي رصيد |

**الحدود الحقيقية وأثرها على التصميم:**

| الحد | القيمة الفعلية | الأثر الملزم علينا |
|---|---|---|
| **لا قراءة بعد كتابة داخل المعاملة** | قاعدة صارمة | البنية نفسها تمنعه: `TxPlan.reads` ثم `TxPlan.writes`، ولا توجد دالة تقرأ في منطقة الكتابة |
| **لا استعلامات داخل المعاملة** (Web SDK: `tx.get(DocumentReference)` فقط) | قاعدة صارمة | **شكّل التصميم كله:** كل معرّف حتمي (`accountPeriods/{accountId}__{pk}`، `budgets/{pk}`، `auditLogs/{opId}`، `entryCorrections/{rootId}`) |
| **إعادة المحاولة التلقائية** | ~5 محاولات (`{ maxAttempts: 5 }`) | **دالة المعاملة تُنفَّذ أكثر من مرة ⇒ يجب أن تكون نقية.** القائمة الكاملة للمحرَّمات في 7.3 |
| سقف العمليات في `writeBatch` | **500** | التهيئة والاستيراد وإعادة البناء تُجزَّأ على **450** بهامش أمان |
| سقف العمليات في `runTransaction` | **500** أيضاً | أكبر معاملة عندنا = التعديل بتغيير الشهر = **18** كتابة. ويُفرض حدّ خطة ذاتي `WRITE_BUDGET ≤ 60` ليفشل أي انفجار تخطيطي **في الاختبار** لا في الإنتاج |
| حجم طلب المعاملة/الدفعة | ~**10 MiB** | أقصى قيد عندنا بسطور مضمَّنة ≈ 6 KB. غير ذي صلة إلا في الاستيراد ⇒ الاستيراد يُجزَّأ بالحجم أيضاً لا بالعدد فقط |
| حجم المستند الواحد | **1 MiB** | القيد بسطور مضمَّنة آمن (~2,000 سطر). يُفرض سقف تطبيقي `lines.length ≤ 100` |
| كتابة مستدامة على مستند واحد | ~**1/ثانية** | **ولهذا لا يوجد في التصميم أي مستند ملخّص شهري ساخن** (ADR-016): المجاميع الشهرية تُحسب بـ `getAggregateFromServer(sum(...))` على `postings`. نقطة الازدحام الوحيدة الباقية `budgets/{pk}`، وحمولتها الواقعية ≤ 40 كتابة/شهر |
| **`runTransaction` يفشل دون اتصال** | قاعدة صارمة (ADR-007) | الطابور في 7.7 — وهو أخطر بند في هذا القسم |

### 7.3 نقاء دالة المعاملة — القائمة الحصرية للمحرَّمات

لأن الدالة قد تُنفَّذ 5 مرات، **كل** ما يلي محرَّم **داخل** `runTransaction(db, async (tx) => { … })`،
ويُفرض بقاعدة ESLint مخصّصة (ADR-018) تُعامل الخرق كخطأ بناء:

| المحرَّم | لماذا | البديل الملزم |
|---|---|---|
| `Date.now()`, `new Date()` | محاولتان في ثانيتين مختلفتين ⇒ `bookedAt`/`periodKey` مختلفان ⇒ قيدان في شهرين | يُحسب في `PostContext.now` **قبل** المعاملة ويُمرَّر |
| `crypto.randomUUID()`, `ulid()` | كل محاولة تولّد مفتاحاً جديداً ⇒ **الازدواج الذي بنينا كل القسم 6 لمنعه** | كل المعرّفات تُولَّد قبل المعاملة |
| `await crypto.subtle.digest(...)` | غير متزامن وبلا داعٍ؛ يوسّع نافذة المعاملة | `payloadHash` يُحسب قبل المعاملة |
| `Math.random()` | عدم حتمية | ممنوع في كل طبقة النطاق أصلاً |
| دفع إلى مصفوفة خارج النطاق، `logs.push(...)`, عدّاد خارجي | تتضاعف قيمه مع كل محاولة | الدالة تُرجِع `PostResult`، والمستهلك يسجّل **بعد** النجاح |
| `analytics.log()`, `toast()`, تحديث حالة React | آثار جانبية مرئية تتكرر 5 مرات | بعد المعاملة فقط |
| قراءة من الذاكرة المخبّأة أو من مستمع (`onSnapshot`) | ليست من لقطة المعاملة ⇒ حارس مبني على قيمة قديمة | `tx.get` فقط |
| `getDoc` / `getDocs` (بدل `tx.get`) | خارج المعاملة ⇒ لا شرط مسبق ⇒ السباق يعود | `tx.get` فقط |
| `serverTimestamp()` **كقيمة تُحسب عليها** | رمز (sentinel) لا قيمة؛ لا يمكن قراءته ولا المقارنة به داخل المعاملة | يُكتب كقيمة في الحمولة فقط، وأي منطق يعتمد على `PostContext.now.iso` |

### 7.4 `postOperation()` — نقطة الكتابة المالية الوحيدة

```
// data/ledger/postOperation.ts
// نقطة الكتابة المالية الوحيدة في النظام. لا يوجد في المستودع أي tx.set/update
// على journalEntries | postings | accounts | accountPeriods | obligations | debts
// | budgets | financialGoals خارج هذا الملف. يُفرض بـ eslint-plugin-boundaries (ADR-018).

async function postOperation(ctx: PostContext, op: OperationRequest): Promise<PostResult>

  ───── المرحلة 0: قبل المعاملة (كل ما هو غير حتمي يحدث هنا، مرة واحدة) ─────
  assertOpIdShape(op.opId)
  assertSchemeMatchesKind(op.opId, op.kind)            // man: لا يُستخدم لعكس، rev: لا يُستخدم لمصروف
  payloadHash ← await computePayloadHash(op)           // غير متزامن ⇒ ممنوع داخل المعاملة
  now ← {
      iso:      ctx.clock.nowIso(),                   // للتدقيق فقط
      bookedAt: op.bookedAt ?? libyaToday(),          // 'YYYY-MM-DD' بتوقيت ليبيا UTC+2 الثابت
      pk:       (op.bookedAt ?? libyaToday()).slice(0, 7)   // ADR-008: periodKey ≡ bookedAt[0:7]
  }
  if (now.bookedAt > libyaToday())  throw DomainError('FUTURE_BOOKED_AT')

  // الطابور قبل أي محاولة، دائماً، متصلاً كان الجهاز أو لا (ADR-007 / القسم 7.7)
  await enqueuePendingCommand(op, payloadHash, now)    // setDoc — يُطابَر محلياً عند عدم الاتصال
  if (!isOnline())  return { status: 'QUEUED', opId: op.opId, writes: 0 }

  readSet ← collectReadSet(op, ctx, now)               // نقية: OperationRequest → TxRead[]
  assertAllPathsDeterministic(readSet)

  ───── المعاملة الذرّية ─────
  return await runTransaction(db, async (tx) => {

      ── (1) مرحلة القراءة: كل القراءات، لا شيء غيرها ──
      refs  ← readSet.map(r => docRef(uid, r.path))
      snaps ← await Promise.all(refs.map(ref => tx.get(ref)))   // لقطة واحدة متّسقة
      snap  ← assembleSnapshot(readSet, snaps)                  // SnapshotSlot → بيانات | null
      for r of readSet where r.required && snap[r.slot] == null:
          throw DomainError('MISSING_REQUIRED_DOC', { path: r.path })

      ── (2) بوابة منع الازدواج (مصفوفة القسم 6.5) ──
      if (snap.existingEntry != null)
          if (hashVersion(snap.existingEntry.payloadHash) !== hashVersion(payloadHash))
              return alreadyAppliedWith(snap.existingEntry, 'HASH_VERSION_SKEW')
          if (snap.existingEntry.payloadHash !== payloadHash)
              throw DomainError('OP_PAYLOAD_MISMATCH', {
                  storedAmountMinor: snap.existingEntry.debitTotalMinor })
          return {
              status: 'OK', opId: op.opId, alreadyApplied: true,
              entryIds: [snap.existingEntry.id],
              wasReversed: snap.existingEntry.reversed === true,
              replacedByEntryId: snap.existingEntry.replacedByEntryId ?? null,
              writes: 0
          }

      ── (3) التخطيط: نقي 100%، لا شبكة ولا وقت ولا عشوائية ──
      plan: TxPlan ← planOperation(op, snap, { ...ctx, payloadHash, now })

      ── (4) التحقق من الثوابت على الخطة، قبل أي كتابة ──
      v ← verifyPlan(plan, snap)
      if (!v.ok)  throw DomainError(v.code, v.ctx)

      ── (5) مرحلة الكتابة: لا قراءة بعد هذه النقطة، أبداً ──
      for w of plan.writes:
          switch (w.op)
            case 'create': tx.set(docRef(uid, w.path), w.data)      // الوجود مستبعَد بـ (2)
            case 'set':    tx.set(docRef(uid, w.path), w.data, { merge: w.merge })
            case 'update': tx.update(docRef(uid, w.path), w.data)

      return {
          status: 'OK', opId: op.opId, alreadyApplied: false,
          entryIds: plan.effects.entryIds,
          balanceAfter: plan.effects.balanceAfter,
          warnings: plan.warnings,
          writes: plan.writes.length
      }

  }, { maxAttempts: 5 })

  ───── المرحلة 6: بعد المعاملة (آثار جانبية — ممنوعة بالداخل) ─────
  // تُنفَّذ في مُغلِّف postOperation، خارج دالة المعاملة:
  //   حذف pendingCommands/{opId}   ← كتابة واحدة مستقلة، فشلها غير ضار (7.7)
  //   إزالة المسوَّدة من IndexedDB
  //   عرض تنبيهات plan.warnings (تجاوز ميزانية، تجاوز حجز — ADR-017)
  //   تسجيل القياسات
```

```ts
// domain/ledger/verifyPlan.ts — نقية، تُختبر وحدةً بلا Firebase
export function verifyPlan(
  plan: TxPlan,
  snap: LedgerSnapshot,
): { ok: true } | { ok: false; code: DomainErrorCode; ctx: Record<string, string | number> };
```

**`verifyPlan` ليست تكراراً لفحوص `planOperation`.** `planOperation` ترمي أخطاء النطاق المتوقَّعة
(سداد زائد، رصيد غير كافٍ) برسائل عربية للمستخدم. و`verifyPlan` **حارس ثوابت على المُخرَج**: تفحص
الخطة نفسها بعد بنائها، فتكشف **عيوب البرمجة** (قيد غير متوازن، سطر صفري، `periodKey` لا يطابق
`bookedAt`، كتابة على حساب فرع غير قابل للترحيل). خرق `BALANCED` ليس خطأ مستخدم: يُسجَّل كخطأ نظام
في `auditLogs` ولا يُصطاد إلى الواجهة كرسالة لطيفة.

### 7.5 عدّ الكتابات الفعلية لمصروف واحد

مصروف: `Dr expense.food 25500` / `Cr asset.cash.main 25500`، بتاريخ `2026-10-09` ⇒ `pk = '2026-10'`.

| # | المستند | العملية | ما يتغيّر فيه |
|---|---|---|---|
| 1 | `journalEntries/man:01JA7H…F0WZ` | `create` | القيد كاملاً بسطريه المضمَّنين، `debitTotalMinor = creditTotalMinor = 25500`، `reversed: false` |
| 2 | `postings/man:01JA7H…F0WZ__1` | `create` | السطر المسطَّح: `accountId: 'expense.food'`, `side: 'debit'`, `amountMinor: 25500`, `periodKey: '2026-10'` (ADR-002) |
| 3 | `postings/man:01JA7H…F0WZ__2` | `create` | `accountId: 'asset.cash.main'`, `side: 'credit'`, `amountMinor: 25500` |
| 4 | `accounts/asset.cash.main` | `update` | `creditTotalMinor += 25500`, `balanceMinor -= 25500`, `entryCount += 1`, `balanceVersion += 1`, `lastEntryId` |
| 5 | `accounts/expense.food` | `update` | `debitTotalMinor += 25500`, `balanceMinor += 25500`, `entryCount += 1`, `balanceVersion += 1` |
| 6 | `accountPeriods/asset.cash.main__2026-10` | `set merge` | `creditMinor += 25500` — **حركة فقط** (ADR-009) |
| 7 | `accountPeriods/expense.food__2026-10` | `set merge` | `debitMinor += 25500` |
| 8 | `auditLogs/man:01JA7H…F0WZ` | `create` | العملية، المستخدم، الجهاز، `payloadHash`، الكتابات |
| 9 | `budgets/2026-10` | `update` | `categories.food.spentMinor += 25500` — **فقط إن وُجدت ميزانية لهذه الفئة** |

> **الرقم: 8 كتابات لمصروف بلا ميزانية، و9 بميزانية نشطة. والقراءات 6**
> (`journalEntries/{opId}` + حسابان + `accountPeriods` اثنان + `budgets/{pk}`).

| العملية | الكتابات | ملاحظة |
|---|---|---|
| مصروف / دخل | **8** (9 بميزانية) | أعلاه |
| تحويل بين حسابين | **8** | قيد + 2 postings + 2 accounts + 2 accountPeriods + audit. لا ميزانية (ليس مصروفاً) |
| دفعة التزام | **10** (11 بميزانية) | + `obligations/{id}` |
| تحصيل/سداد دين | **9** | + `debts/{id}` |
| تخصيص لهدف (`earmark`) | **9** | + `financialGoals/{id}` (و`earmarkedMinor` ضمن تحديث الحساب) |
| تعديل داخل نفس الشهر | **16** | التفصيل في القسم 8.2 |
| تعديل يغيّر الشهر | **18** | `accountPeriods` تصبح أربعة مستندات |

**ثلاث نتائج مباشرة من هذا العدّ:**

1. أقصى معاملة = 18 كتابة مقابل سقف 500 ⇒ **لا خطر سقف على الإطلاق**، وحدّ الخطة الذاتي
   `WRITE_BUDGET ≤ 60` موجود لكشف الانفجار التخطيطي في الاختبار لا لحماية الإنتاج.
2. **غياب أي مستند ملخّص شهري مقصود** (ADR-016): لو وُجد لأضاف كتابة إلى **كل** عملية على
   **مستند واحد ساخن** حدّه ~1 كتابة/ثانية، وهو الاحتناق الوحيد الذي كان ليظهر في الاستيراد.
   المجاميع الشهرية تُحسب بـ `getAggregateFromServer(sum('amountMinor'))` على `postings`
   مع مرشّح `periodKey` و`accountType`، وثمنها **قراءة واحدة محتسبة لكل 1,000 مستند مُجمَّع**.
3. تكلفة Spark: 30 عملية/يوم × 9 كتابات = **270 كتابة/يوم** مقابل سقف 20,000 ⇒ **1.4%**.

### 7.6 ADR-007 — العمل دون اتصال: `pendingCommands`

**الحقيقة التقنية التي يجب الإقرار بها بلا تلطيف:** `runTransaction` **يفشل دون اتصال**. لا يُطابَر
محلياً، بخلاف `setDoc` و`updateDoc` و`writeBatch` التي تُطابَر في الذاكرة المخبّأة المستمرة وتُرسَل
عند عودة الاتصال. فأي عملية مالية في «رصيد» **لا يمكن أن تكتمل دون اتصال**. هذا قيد المنصة،
والتصميم يواجهه صراحةً بدل أن يخفيه.

**شرط بيئي إلزامي:** الذاكرة المخبّأة المستمرة مُفعَّلة، وإلا فُقِد الطابور بإغلاق التبويب:

```ts
initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
```

#### (أ) شكل المستند

```ts
// users/{uid}/pendingCommands/{opId}
export interface PendingCommand {
  readonly opId: string;              // = معرّف المستند = المفتاح النهائي للقيد
  readonly schemaVersion: number;
  readonly ownerUid: string;
  readonly kind: OperationKind;
  readonly payload: OperationRequest; // الطلب الخام كما بُني على العميل
  readonly payloadHash: string;       // يُعاد حسابه عند كل تشغيل ويجب أن يطابق — فحص ذاتي
  readonly enqueuedAt: string;        // ISO من الجهاز (ترتيب التشغيل فقط، لا تدقيق)
  readonly deviceId: string;
  readonly bookedAt: string;          // 'YYYY-MM-DD' مُجمَّد لحظة الإنشاء — لا يُعاد حسابه عند التشغيل
  readonly periodKey: string;         // = bookedAt.slice(0,7)  (ADR-008)

  status: 'queued' | 'inFlight' | 'rejected';
  attemptCount: number;
  firstAttemptAt?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;             // ISO — تباطؤ أُسّي
  lastError?: { code: DomainErrorCode | string; messageAr: string; at: string; retryable: boolean };
  retryOf?: string;                   // opId سابق رُفض نهائياً وأُعيد إدخاله بمفتاح جديد

  // للعرض في شاشة «بانتظار المزامنة» فقط — لا يدخل أي حساب
  readonly previewAmountMinor: Minor;
  readonly previewLabelAr: string;    // «مصروف — الطعام والمشروبات — نقد المحفظة»
}
```

**`bookedAt` يُجمَّد لحظة الإنشاء ولا يُعاد حسابه عند التشغيل.** عملية أُدخلت الساعة 23:50 بتوقيت
ليبيا في 31 أكتوبر ورُحِّلت 01:10 في 1 نوفمبر تبقى **قيد أكتوبر**. وإلا لانتقلت عمليات إلى شهور
لم تحدث فيها، وانهارت كل مقارنة شهرية. (التوقيت: **ليبيا UTC+2 ثابتة بلا توقيت صيفي**،
فـ `libyaToday()` دالة خالصة على `Date.now() + 2h` ولا تحتاج مكتبة مناطق زمنية ولا تحميلاً.)

**لماذا في Firestore لا في IndexedDB مستقل؟** لأن `setDoc` يُطابَر محلياً في نفس الذاكرة المخبّأة
المستمرة التي يستخدمها كل التطبيق. مخزن ثانٍ يدوي = **مصدر حقيقة ثانٍ ينحرف** (طابور فيه عملية
نُفِّذت فعلاً، أو عملية ضاعت لأن الكتابتين لم تكونا ذرّيتين). والمكافأة المجانية: الطابور **يتزامن بين
الأجهزة** — عملية صُفَّت على الهاتف تظهر على الحاسوب ويمكن تشغيلها منه، بأمان تام لأن `opId` واحد
والتشغيل عديم الأثر عند التكرار.

#### (ب) كيف يُصطفّ

```
enqueuePendingCommand(op, payloadHash, now):
    setDoc(pendingCommands/{op.opId}, {
        …, status: 'queued', attemptCount: 0,
        enqueuedAt: now.iso, bookedAt: now.bookedAt, periodKey: now.pk
    })                                  // متصلاً كان أو لا — كتابة واحدة، تُطابَر محلياً
```

ثلاث قواعد غير قابلة للتفاوض:

1. **كل** عملية مالية تمرّ بالطابور **قبل** أول محاولة ترحيل، متصلاً كان الجهاز أو لا.
   لا مسار جانبي «سريع» للحالة المتصلة — مسار واحد يُختبر وحده، وإلا صار المسار الأقل استخداماً
   هو المسار غير المُختبَر.
2. يُحذف من الطابور **فقط** بعد تثبيت المعاملة (أو `alreadyApplied`).
3. `pendingCommands` **ليست** مصدر حقيقة مالياً. ولا تُقرأ في أي رصيد ولا تقرير ولا تصدير.

#### (ج) كيف يُعاد تشغيله

```
flushPendingCommands(trigger):   // trigger ∈ { appOpen, online, visibilityVisible, manual, timer }
    if (!isOnline())                       return
    if (!acquireFlushLease())              return    // قفل عبر التبويبات، صلاحيته 60 ثانية

    // تحرير المعلّقات العالقة: تبويب أُغلق في منتصف الطيران
    for c in query(pendingCommands, where status == 'inFlight'
                                     and lastAttemptAt < now − 2min):
        update(c, { status: 'queued' })    // إعادة التشغيل آمنة بحكم القسم 6

    batch ← query(pendingCommands,
                  where status == 'queued' and nextAttemptAt <= now,
                  orderBy enqueuedAt asc, limit 25)

    for c in batch:                        // **تسلسلياً: واحدة في كل مرة**
        update(c, { status: 'inFlight', attemptCount: +1, lastAttemptAt: now })
        try:
            if (await computePayloadHash(c.payload) !== c.payloadHash):
                → reject(c, 'PENDING_PAYLOAD_TAMPERED')   // فساد في المخزّن المحلي
                continue
            r ← await postOperation(ctxFrom(c), c.payload)   // نفس المسار الوحيد
            deleteDoc(pendingCommands/{c.opId})              // النجاح = الحذف
            notifyPosted(c, r)
        catch e:
            if (isRetryable(e)):
                update(c, { status: 'queued',
                            nextAttemptAt: now + backoff(c.attemptCount),
                            lastError: {…, retryable: true} })
                if (c.attemptCount >= 20)  → reject(c, 'RETRY_EXHAUSTED')
                break                      // توقّف عن الدفعة: الشبكة على الأرجح ساقطة
            else:
                reject(c, e.code)          // status: 'rejected' + رسالة عربية
    releaseFlushLease()
```

| البند | القرار |
|---|---|
| **التسلسل** | **إلزامي، واحدة في كل مرة.** عمليتان مصطفّتان على نفس الحساب يجب أن تُقاسا على الرصيد الجاري الحقيقي: 80 و50 على رصيد 100 ⇒ الأولى تنجح والثانية تُرفض بـ `MIN_BALANCE`. التوازي يجعل النتيجة تعتمد على ترتيب الوصول، وهو غير حتمي وغير قابل للتفسير للمستخدم |
| **الترتيب** | `enqueuedAt` تصاعدياً. ساعة الجهاز قد تكون منحرفة، لكن الطابور **محلي لجهاز واحد** فالترتيب النسبي صحيح حيث يهمّ |
| **التباطؤ** | `1s, 2s, 4s, 8s, 30s, 2m, 10m` ثم 10m مكرَّراً، مع تشويش ‎±20%‎ |
| **المشغِّلات** | فتح التطبيق (ق-1: المادّية عند الفتح)، حدث `online`، `visibilitychange → visible`، مؤقّت 60 ثانية ما دام الطابور غير فارغ، وزر «إعادة المحاولة الآن» |
| **قابل للإعادة** | `unavailable`, `deadline-exceeded`, `aborted`, `internal`, `cancelled`, `resource-exhausted` |
| **نهائي** | `permission-denied`, `invalid-argument`, `failed-precondition`, وكل `DomainErrorCode` (`MIN_BALANCE`, `NO_OVERPAY`, `OP_PAYLOAD_MISMATCH`, `CORRECTION_CONFLICT`…) |
| **النجاح يعني الحذف** | وإن فشل الحذف بقي المستند `inFlight`؛ التشغيل التالي يُعيد `postOperation` فيعود `alreadyApplied: true` بصفر كتابة مالية ثم يُحذف. **ثابت: المستند المعلّق الباقي عديم الأثر دائماً** |
| **المرفوض لا يُحذف آلياً** | يبقى معروضاً حتى يُصلِحه المستخدم (بمفتاح جديد + `retryOf`) أو يحذفه صراحةً |

#### (د) كيف يُعرض للمستخدم — ومنع الاعتقاد الكاذب بالحفظ

هذا أخطر مصدر لفقدان ثقة المستخدم في النظام كله. القاعدة واحدة:

> **«تم الحفظ» جملة لا تُعرض إلا من معاملة مُثبَّتة.** لا حالة وسطى تستعير مفردات النجاح،
> ولا رصيد «متوقَّع»، ولا مبلغ معلّق مخلوط برقم حقيقي في أي شاشة.

| الحالة | ما يراه المستخدم (ق-3: أرقام لاتينية) | المعالجة البصرية |
|---|---|---|
| `queued` ولم تصل الخادم (`metadata.hasPendingWrites === true`) | «**لم تُحفظ بعد.** في انتظار الاتصال — سنرحّلها تلقائياً.» | شريط كهرماني، أيقونة ساعة، **لا علامة صح ولا لون نجاح** |
| `queued` ووصلت الخادم لكن لم تُرحَّل | «**لم تُرحَّل بعد.** جارٍ الترحيل…» | كهرماني + مؤشر تقدّم |
| `inFlight` | «جارٍ الحفظ…» | النموذج للقراءة فقط، زر معطَّل |
| `rejected` | «**لم تُحفظ.** السبب: الرصيد غير كافٍ في «نقد المحفظة» (المتاح 40.000 د.ل، المطلوب 80.000 د.ل).» + `[ تعديل ]` `[ حذف الطلب ]` | أحمر |
| مُثبَّتة | «تم الحفظ» + الرصيد الجديد | أخضر — **الحالة الوحيدة** |

**أربعة التزامات على الواجهة:**

1. العمليات المعلّقة تظهر **في منطقة واحدة مخصّصة** معنونة «عمليات بانتظار المزامنة (N)» مثبَّتة
   أعلى لوحة التحكم وأعلى كشف الحساب المتأثر — **خارج** قائمة العمليات، بخط باهت وبادئة
   «**غير محتسب**» أمام كل مبلغ.
2. لافتة دائمة ما دام `N > 0`: «**N عملية لم تُرحَّل بعد. الأرصدة والتقارير أدناه لا تتضمّنها.**»
3. **يُحرَّم** أي حقل مثل `projectedBalanceMinor` أو «الرصيد المتوقَّع» أو مجموع يخلط
   المعلّق بالمُرحَّل. أي تقدير مختلط يجعل الرقم الذي يراه المستخدم غير قابل لإعادة الإنتاج من الدفتر —
   وهو عين ما يمنعه القسم 22 والقسم 25 بند 4.
4. دون اتصال، الأرصدة تُقرأ من الذاكرة المخبّأة ⇒ تُعرض بوسم
   «آخر مزامنة: 2026-10-09 14:22» (من `snapshot.metadata.fromCache`)، لأن جهازاً آخر قد يكون
   رحّل عمليات لم تصل بعد. **رصيد قديم موسوم بقِدَمه** أصدق من رصيد متوقَّع.

#### (هـ) كيف نضمن استبعاده من كل رصيد وتقرير — ضماناً بنيوياً لا تذكُّراً

| الطبقة | الضمان |
|---|---|
| **البنية** | الأرصدة من `accounts.balanceMinor`، والحركة الشهرية من `accountPeriods`، والمجاميع من `postings`. `pendingCommands` **مجموعة منفصلة لا يمسّها أي من هذه المسارات** — لا يوجد مسار كود يمكنه الخلط |
| **أداة البناء** (ADR-018) | قاعدة `eslint-plugin-boundaries`: `pendingCommands` و`PendingCommand` يُستورَدان **فقط** في `src/data/pending/**` و`src/ui/pending/**`. أي استيراد في `src/domain/**` أو في أي `selector` = **خطأ بناء** |
| **قواعد الأمان** | شكل `pendingCommands` مختلف بنيوياً: لا `lines`، لا `debitTotalMinor`، لا `periodKey` قابل للتجميع كقيد. ولا يمكن لمستند معلّق أن يُقرأ كقيد ولو خطأً |
| **الاختبار الإلزامي** | اختبار تكامل: التقط كل قيم المحدِّدات (`selectors`) ⇒ اقطع الشبكة ⇒ صفِّ 5 عمليات ⇒ **أكّد تطابق كل قيمة حرفياً** ⇒ أعد الشبكة ⇒ أكّد أن الدلتا = مجموع الخمس بالضبط، مرة واحدة |
| **الفاحص الدوري** | عند فتح التطبيق: إن وُجد `opId` في `pendingCommands` و`journalEntries` معاً ⇒ حذف المعلّق + سطر `auditLogs` بالرمز `STALE_PENDING_CLEANED` |

### 7.7 اختبارات القسم 7 الإلزامية

| الاختبار | المتوقع |
|---|---|
| `planOperation` لمصروف 25.500 (جدولي، بلا Firebase) | `TxPlan` مطابق حرفياً للمتوقَّع: 8 كتابات، 6 قراءات، `checks` تحتوي `BALANCED`+`MIN_BALANCE` |
| `verifyPlan` على خطة بقيد غير متوازن | `{ ok: false, code: 'UNBALANCED_ENTRY' }` وصفر كتابة |
| `verifyPlan` على خطة `periodKey = '2026-09'` و`bookedAt = '2026-10-09'` | `PERIOD_KEY_MATCH` يفشل (ADR-008) |
| دالة المعاملة تُنفَّذ مرتين (`maxAttempts` مُحاكى) | نفس `TxPlan` حرفياً، نفس المعرّفات، نفس `bookedAt` — **إثبات النقاء** |
| فحص ثابت على الكود: `Date.now|new Date|randomUUID|ulid|Math.random` داخل `runTransaction` | صفر نتيجة (قاعدة ESLint) |
| عدّ الكتابات لكل عملية في 7.5 | الأرقام 8/9/10/16/18 بالضبط — **اختبار تراجع على التكلفة** |
| قطع الشبكة ⇒ عملية | `status: 'QUEUED'`، مستند في `pendingCommands`، **صفر تغيّر** في كل محدِّد |
| عودة الشبكة | قيد واحد، الطابور فارغ، الرصيد تغيّر مرة واحدة |
| إغلاق التبويب أثناء `inFlight` ⇒ إعادة الفتح | تحرير بعد دقيقتين، إعادة تشغيل، `alreadyApplied` أو إنشاء — **لا تضاعف** |
| ثلاث عمليات مصطفّة مجموعها يتجاوز الرصيد | الأوليان تنجحان، الثالثة `rejected` بـ `MIN_BALANCE` برسالة عربية — بترتيب حتمي |
| تلاعب يدوي في `payload` داخل الذاكرة المخبّأة | `PENDING_PAYLOAD_TAMPERED`، صفر كتابة مالية |
| `writeBatch` للتهيئة بـ 460 عملية | تجزئة تلقائية إلى دفعتين، لا خطأ سقف |

---

## 8. التعديل والإلغاء

### 8.1 القاعدة (ADR-006)

> **القيد المرحَّل غير قابل للتغيير مالياً. التعديل = عكس + بديل في معاملة واحدة بدلتا صافية.
> لا حذف مالي أبداً — لا `deleteDoc` على `journalEntries` ولا على `postings` في أي مسار كود.**

الحقول الوحيدة القابلة للتحديث على قيد مرحَّل: `reversed`, `reversedByEntryId`, `replacedByEntryId`,
`status`, `description`, `tags`, `attachmentIds`, `notes`, `valueDate`, `updatedAt` — وتُفرَض هذه الحصرية
في `firestore.rules` (القسم 14) **لا في الكود وحده**.

**تفكيك «الدلتا الصافية» — موضع غموض يُحسم هنا نهائياً:**

| المستوى | إجمالي أم صافٍ | السبب |
|---|---|---|
| `journalEntries` و`postings` | **إجمالي**: يُكتب قيد عكس كامل + قيد بديل كامل | الأثر التاريخي والقابلية للتدقيق (القاعدة 19.10)؛ وكشف الحساب يجب أن يطابق الرصيد حسابياً |
| `accounts` و`accountPeriods` و`budgets` و`obligations` و`debts` و`financialGoals` | **تحديث واحد بالمجموع الحسابي لكل سطور الخطة على ذلك المستند** | كتابة واحدة لا كتابتان؛ ولا لحظة يرى فيها أي قارئ العكس مطبَّقاً والبديل لا |
| **الحوارس** (`MIN_BALANCE`, `NO_OVERPAY`, `NO_OVERSETTLE`) | **صافٍ على النتيجة النهائية** | تعديل مصروف من 500 إلى 480 لا يجوز أن يفشل بسبب حدّ تجاوزه الأصل أصلاً |

**وبما أن `accountPeriods` تحفظ الحركة فقط (ADR-009)، فالمجاميع الشهرية كلها صافية بالتعريف:**

> `net(accountId, pk) = accountPeriods[accountId__pk].debitMinor − creditMinor`
> و «مصروف الشهر» `= Σ net(a, pk)` لكل `a` من نوع `expense`.
> **يُحرَّم** حساب مصروف الشهر بـ `Σ debitMinor` وحده، لأن ذلك يحتسب المبلغ المعكوس مرتين.

### 8.2 المثال الرقمي: مصروف 25.500 عُدِّل إلى 30.000

**المعطيات:** `E0 = man:01JA7H3K9QX4YV8M2TBRD5F0WZ`، `bookedAt = '2026-10-09'`، `pk = '2026-10'`،
`Dr expense.food 25500 / Cr asset.cash.main 25500`. رصيد النقد قبل التعديل `174500`،
`budgets/2026-10.categories.food.spentMinor = 25500`.
**الطلب:** `amd:man:01JA7H…F0WZ:01JA7JQ8M0C3K7NXE5WPVD2B6R` بمبلغ `30000`، نفس الحساب ونفس الفئة
ونفس التاريخ، `reason: 'المبلغ الصحيح من الإيصال 30.000'`.

**القيدان الناتجان — بالضبط:**

```
journalEntries/amd:man:01JA7H…F0WZ:01JA7JQ8…B6R__rev
  kind: 'reversal'      reversesEntryId: E0      correctionGroupId: E0
  bookedAt: '2026-10-09'   periodKey: '2026-10'
  description: 'عكس: مصروف الطعام والمشروبات'      correctionReason: 'المبلغ الصحيح من الإيصال 30.000'
  lines:
    { lineNo: 1, accountId: 'asset.cash.main', side: 'debit',  amountMinor: 25500 }
    { lineNo: 2, accountId: 'expense.food',    side: 'credit', amountMinor: 25500 }
  debitTotalMinor: 25500   creditTotalMinor: 25500   reversed: false

journalEntries/amd:man:01JA7H…F0WZ:01JA7JQ8…B6R__new
  kind: 'expense'       replacesEntryId: E0       correctionGroupId: E0
  bookedAt: '2026-10-09'   periodKey: '2026-10'
  description: 'الطعام والمشروبات'                 correctionReason: 'المبلغ الصحيح من الإيصال 30.000'
  lines:
    { lineNo: 1, accountId: 'expense.food',    side: 'debit',  amountMinor: 30000, categoryId: 'food' }
    { lineNo: 2, accountId: 'asset.cash.main', side: 'credit', amountMinor: 30000 }
  debitTotalMinor: 30000   creditTotalMinor: 30000   reversed: false
```

**الكتابات الست عشرة في معاملة واحدة:**

| # | المستند | العملية | القيمة الدقيقة |
|---|---|---|---|
| 1 | `journalEntries/{amd}__rev` | `create` | قيد العكس أعلاه |
| 2 | `journalEntries/{amd}__new` | `create` | القيد البديل أعلاه |
| 3 | `journalEntries/E0` | `update` | `reversed: true`, `status: 'replaced'`, `reversedByEntryId: {amd}__rev`, `replacedByEntryId: {amd}__new`, `correctionGroupId: E0`, `updatedAt` |
| 4 | `postings/{amd}__rev__1` | `create` | `asset.cash.main`, `debit`, `25500` |
| 5 | `postings/{amd}__rev__2` | `create` | `expense.food`, `credit`, `25500` |
| 6 | `postings/{amd}__new__1` | `create` | `expense.food`, `debit`, `30000` |
| 7 | `postings/{amd}__new__2` | `create` | `asset.cash.main`, `credit`, `30000` |
| 8 | `postings/E0__1` | `update` | `reversed: true` |
| 9 | `postings/E0__2` | `update` | `reversed: true` |
| 10 | `accounts/asset.cash.main` | `update` | `debitTotalMinor += 25500`, `creditTotalMinor += 30000`, `balanceMinor: 174500 → 170000` (**صافٍ −4500**), `entryCount += 2`, `balanceVersion += 1` |
| 11 | `accounts/expense.food` | `update` | `debitTotalMinor += 30000`, `creditTotalMinor += 25500`, `balanceMinor += 4500`, `entryCount += 2` |
| 12 | `accountPeriods/asset.cash.main__2026-10` | `set merge` | `debitMinor += 25500`, `creditMinor += 30000` ⇒ الصافي −4500 |
| 13 | `accountPeriods/expense.food__2026-10` | `set merge` | `debitMinor += 30000`, `creditMinor += 25500` ⇒ الصافي +4500 |
| 14 | `budgets/2026-10` | `update` | `categories.food.spentMinor: 25500 → 30000` (**+4500 صافٍ، كتابة واحدة**)، وإعادة ضبط `alertFiredAtBps` إن تغيّرت الشريحة |
| 15 | `entryCorrections/E0` | `set` | `chainLength: 0 → 1`, `currentEntryId: {amd}__new`, `voided: false`, `lastOpId`, `lastReason`, `updatedAt`, `updatedByDevice` |
| 16 | `auditLogs/{amd}` | `create` | القديم 25500، الجديد 30000، الدلتا +4500، السبب، الجهاز، `payloadHash` |

**التحقق الحسابي:**

| البند | قبل | بعد | صحيح؟ |
|---|---|---|---|
| `asset.cash.main.balanceMinor` | 174500 | 170000 | ✓ 174500 − 30000 = 170000 |
| `expense.food` صافي الشهر | 25500 | 30000 | ✓ `(25500+30000) − 25500 = 30000` |
| `budgets/2026-10.food.spentMinor` | 25500 | 30000 | ✓ |
| ميزان المراجعة `Σ debit = Σ credit` | متوازن | متوازن | ✓ كل قيد متوازن منفرداً |
| «مصروف أكتوبر» من `postings` بـ `sum()` | 25500 | 30000 | ✓ بشرط حسابه صافياً: `Σ(debit) − Σ(credit)` على حسابات `expense` |

**`reversed` للعرض لا للصحة.** لأن `العكس + الأصل = 0` رياضياً، فأي مجموع على **كل** السطور يعطي الرقم
الصحيح تلقائياً بلا أي منطق استبعاد. وجود `reversed: true` على `E0` و`postings/E0__*` **راحةُ واجهة**
لإخفاء ضجيج التصحيحات من قائمة العمليات، و**لا يجوز** أن تتوقف صحة أي تقرير على تذكُّر تصفيته —
وهذه أكبر فائدة عملية للقيد المزدوج هنا (القسم 1.2، النقطة 2).

### 8.3 جدول تصنيف الحقول — حقلاً حقلاً

**الأصناف:** **(أ)** تعديل وصفي حرّ لا يمسّ المال · **(ب)** يتطلب عكساً وبديلاً ·
**(ج)** ممنوع نهائياً على المستخدم (بعضه يُكتبه النظام داخل معاملة العكس/الاستبدال وحدها).

#### `JournalEntry`

| الحقل | الصنف | البرهان / الملاحظة |
|---|---|---|
| `id` | **ج** | `=== opId ===` معرّف المستند. تغييره = مستند آخر = ازدواج |
| `opId` | **ج** | مفتاح منع الازدواج (ADR-004) |
| `schemaVersion` | **ج** | القيود لا تُرحَّل أبداً (ADR-019) |
| `ownerUid` | **ج** | يُفرَض في القواعد مطابقاً لـ `request.auth.uid` |
| `payloadHash` | **ج** | تغييره يُعمي كشف «نفس المفتاح بحمولة مختلفة» |
| `kind` | **ب** | يحدّد التصنيف في كل تقرير وآلة الحالة المرافقة |
| `status` | **ج** | يكتبه النظام حصراً: `posted → replaced` داخل معاملة الاستبدال |
| `reversed` | **ج** | يكتبه النظام حصراً داخل معاملة العكس |
| `bookedAt` | **ب** | `periodKey ≡ bookedAt[0:7]` (ADR-008) ⇒ تغييره يُحرِّك المبلغ بين شهرين وبين ميزانيتين. انظر 8.6 |
| `bookedAtTs` | **ج** | مشتق: `Date.parse(bookedAt + 'T12:00:00+02:00')` — منتصف نهار ليبيا لتحصين النطاقات من أي انحراف ‎±12h‎ |
| `periodKey` | **ج** | مشتق من `bookedAt` (ADR-008). حقل محسوب لا مُدخَل |
| `valueDate` | **أ** | تاريخ القيمة المصرفي؛ لا يمسّ `periodKey` ولا أي مُجمَّع |
| `description` | **أ** | + سطر `auditLogs` بالقيمة القديمة والجديدة. منعه يدفع المستخدم إلى إلغاء قيد سليم لتصحيح إملاء |
| `lines[]` | **ب** | جسم القيد المالي |
| `accountIds[]` | **ج** | مشتق من `lines` |
| `accountTypes[]` | **ج** | مشتق من `lines` |
| `debitTotalMinor` | **ج** | مشتق = `Σ` السطور المدينة |
| `creditTotalMinor` | **ج** | مشتق = `Σ` السطور الدائنة |
| `amountMinor` | **ج** | مشتق = `debitTotalMinor` (راحة عرض) |
| `currency` | **ج** | `'LYD'` ثابت؛ لا تعدد عملات في الإصدار الأول |
| `tags` — الوسوم المحجوزة (`household`, `personal`) | **أ مع نشر إلزامي** | «مصروفات المنزل» تُجمَع بـ `tags array-contains 'household'` على `postings` ⇒ التعديل **يجب** أن ينشر الوسم إلى كل `postings/{entryId}__{1..lineCount}` في **نفس المعاملة** (`lineCount` معروف ⇒ معرّفات حتمية ⇒ لا استعلام). القيمة لا تتغيّر، فلا عكس. متطلب القسم 11 («دون تكرار قيمتها») يفرض أن تكون إعادة الوسم رخيصة |
| `tags` — الوسوم الحرّة | **أ** | لا مُجمَّع يعتمد عليها؛ تُنشَر إلى `postings` بنفس الآلية للاتساق |
| `refs.obligationId` / `obligationInstallmentIndex` / `debtId` / `debtDirection` / `goalId` / `budgetId` / `recurringId` / `recurringOccurrenceKey` / `incomeScheduleId` / `transferPairKey` / `zakatRecordId` | **ب** | كل واحد منها يقود دلتا على مستند مرافق. تغييره بلا عكس يترك `paidMinor`/`savedMinor` على الكيان الخطأ ⇒ انحراف غير قابل للكشف |
| `refs.taskId` / `refs.noteId` | **أ** | روابط تنظيمية بلا أثر مالي |
| `attachmentIds` | **أ** | معطَّلة على Spark (ق-1)؛ الحقل قائم في المخطط والواجهة موسومة «يتطلب ترقية» |
| `duplicateAckOf` | **ج** | إقرار المستخدم لحظة الإدخال؛ لا يُعاد كتابته |
| `reversesEntryId` / `reversedByEntryId` / `replacesEntryId` / `replacedByEntryId` / `correctionGroupId` | **ج** | يكتبها النظام حصراً داخل معاملة العكس/الاستبدال؛ تغييرها يقطع سلسلة التصحيح |
| `correctionReason` | **ج** | سبب هذا التصحيح بعينه. تصحيح جديد يحمل سببه الجديد |
| `createdAt` / `createdBy` / `deviceId` / `clientCreatedAt` | **ج** | بيانات تدقيق |
| `updatedAt` | **ج** | يكتبه النظام عند أي تعديل وصفي أو وسم عكس |
| `notes` | **أ** | ملاحظة حرّة |

#### `JournalLine` (مضمَّن) و`Posting` (مسطَّح)

| الحقل | الصنف | الملاحظة |
|---|---|---|
| `lineNo` | **ج** | يحدّد معرّف `postings/{entryId}__{lineNo}`؛ تغييره يُيتِّم مستنداً مسطَّحاً |
| `accountId` | **ب** | الحساب الخطأ = رصيدان خطأ |
| `accountType` | **ج** | مشتق من الحساب؛ مكرَّر عن قصد لتصنيف التقارير بلا انضمام |
| `accountCode` | **ج** | مشتق، للعرض والتصدير |
| `side` | **ب** | قلب الاتجاه يقلب إشارة العملية كاملة — تحويل يصبح دخلاً |
| `amountMinor` | **ب** | موجب دائماً، `> 0` |
| `categoryId` | **ب** | يختار حساب المصروف وخانة الميزانية؛ يجب أن يطابق `accountId` |
| `contactId` | **ب** | يختار حساب `receivable`/`payable` للطرف |
| `settlementDeltaMinor` | **ب** | المصدر المستقل للتحقق من `paidMinor`/`settledMinor` (ADR-021). قيد العكس يحمل `−X` فيبقى `Σ` مطابقاً |
| `memo` | **أ** | ملاحظة سطر |
| `reversed` (على `Posting` فقط) | **ج** | يكتبه النظام؛ للعرض لا للصحة (8.2) |
| `tags` (على `Posting`) | **أ** | مرآة وسوم القيد؛ تُنشَر في نفس المعاملة |
| `periodKey` (على `Posting`) | **ج** | مشتق من `bookedAt` (ADR-008) |

**الحقول الثلاثة التي يُساء تصنيفها عادةً، وحسمها هنا:** `description` **أ** (لا مال)،
`tags` المحجوزة **أ مع نشر** (المال نفسه لا يتغيّر، تغيّر زاوية العرض فقط)،
`bookedAt` **ب** (يبدو وصفياً وهو أخطر حقل مالي بعد المبلغ، لأنه يُعيد تعريف `periodKey`).

### 8.4 قفل التصحيح `entryCorrections/{originalEntryId}` (ADR-014)

```ts
// users/{uid}/entryCorrections/{rootEntryId}
export interface EntryCorrection {
  readonly rootEntryId: string;   // = معرّف المستند = correctionGroupId للسلسلة كلها
  readonly schemaVersion: number;
  readonly ownerUid: string;
  chainLength: number;            // عدد التصحيحات المطبَّقة. غياب المستند ≡ 0
  currentEntryId: string;         // القيد السارِي الآن (ذيل السلسلة)
  voided: boolean;                // true إن انتهت السلسلة بعكس بلا بديل
  lastOpId: string;
  lastReason: string;
  updatedAt: Timestamp;
  updatedBy: string;              // uid
  updatedByDevice: string;        // لرسالة التعارض: «عُدِّل من جهاز آخر»
}
```

**لماذا مستند قفل مستقل، ولماذا لا يكفي المفتاح — أربعة أسباب لا سبب واحد:**

1. **المفتاح لا يمكنه أن يكون `amd:{id}:{count}`.** `count` يجب أن يُقرأ من الخادم، ومعرّف المستند
   يجب أن يكون معلوماً **قبل** بدء المعاملة (لأن أول قراءة هي `journalEntries/{opId}` نفسها).
   مفتاح يحتوي عدّاداً يفرض دورة «اقرأ ⇒ ابنِ المفتاح ⇒ اقرأ المفتاح» وهي **مستحيلة** داخل معاملة واحدة.
2. **المفتاح وحده لا يُسلسِل التصحيحات إطلاقاً.** جهازان يعدّلان `E0` في نفس اللحظة يولّدان
   `amd:E0:<ulidA>` و`amd:E0:<ulidB>` — **مفتاحان مختلفان**، فتمرّ كلتا المعاملتين من بوابة الازدواج
   بنجاح، ويُعكَس `E0` **مرتين** ويُنشأ بديلان. النتيجة: الرصيد يُطرح منه المبلغ الأصلي مرتين،
   وميزان المراجعة **يبقى متوازناً** (كل قيد متوازن منفرداً) فلا يكشف شيئاً. هذا أخطر سيناريو في القسم 8،
   وهو ما يبرّر وجود هذا المستند.
3. **يُحوِّل التزامن إلى compare-and-set على مستند واحد مُتنازَع عليه.** كلتا المعاملتين تقرأان
   `entryCorrections/E0` وتخطّطان `chainLength: 0 → 1`. الأولى تُثبِّت؛ الثانية تفشل `aborted`
   (شرط مسبق على مستند تغيّر)، وتُعاد تلقائياً، فتقرأ `chainLength === 1 ≠ expectedChainLength === 0`
   ⇒ **ترمي** `CORRECTION_CONFLICT`:
   > «عُدِّل هذا القيد من جهاز آخر قبل لحظات. أعد تحميل العملية ثم عدّلها.» `[ تحديث وعرض ]`
4. **يعطي ذيل السلسلة بقراءة واحدة حتمية.** لا استعلام (ممنوع داخل المعاملة)، ولا مسح للسلسلة.

**الحوارس المفروضة عبر هذا المستند داخل كل معاملة تعديل أو عكس:**

| الفحص | الشرط | الخطأ |
|---|---|---|
| تذيُّل الهدف | `op.originalEntryId === lock.currentEntryId` (أو غياب المستند و`originalEntryId === rootEntryId`) | `STALE_CORRECTION_TARGET`: «هذه العملية عُدِّلت سابقاً. العملية السارية هي … » |
| توقّع السلسلة | `op.expectedChainLength === lock.chainLength` | `CORRECTION_CONFLICT` |
| ليس معكوساً | `tail.reversed === false` | `ENTRY_ALREADY_REVERSED` |
| ليس مستبدلاً | `tail.status === 'posted'` | `ENTRY_ALREADY_REPLACED` |
| السلسلة غير مُلغاة | `lock.voided === false` | `ENTRY_VOIDED`: «هذه العملية ملغاة. أنشئ عملية جديدة» |

**`rootEntryId` يُستخرَج دائماً من `entry.correctionGroupId`** (ويساوي معرّف القيد نفسه إن كان جذراً)،
فكل أعضاء السلسلة يتنازعون **قفلاً واحداً** — وهو ما يمنع تعديلين متزامنين على حلقتين مختلفتين من
نفس السلسلة.

### 8.5 سلسلة التصحيح — التعديل الثاني لنفس القيد

التعديل الثاني **يستهدف الذيل `E1` لا الجذر `E0`**:

```
E0  man:01JA7H…F0WZ          25.500   status: 'replaced'  reversed: true   correctionGroupId: E0
 ├─ {amd1}__rev  عكس 25.500                                                 correctionGroupId: E0
 └─ E1 = {amd1}__new         30.000   status: 'replaced'  reversed: true   correctionGroupId: E0
      ├─ {amd2}__rev  عكس 30.000                                            correctionGroupId: E0
      └─ E2 = {amd2}__new    28.750   status: 'posted'    reversed: false  correctionGroupId: E0

entryCorrections/E0 = { chainLength: 2, currentEntryId: E2, voided: false }
```

| القاعدة | الحسم |
|---|---|
| `correctionGroupId` | يساوي **`E0` أبداً** لكل أعضاء السلسلة ⇒ استعلام واحد (`where correctionGroupId == E0 orderBy createdAt`) يعطي تاريخ العملية كاملاً |
| هدف التعديل | **الذيل فقط**. طلب على `E0` أو `E1` ⇒ `STALE_CORRECTION_TARGET` مع تحويل الواجهة إلى `E2` |
| عكس قيد مستبدَل | **ممنوع** ⇒ `ENTRY_ALREADY_REPLACED`. يُعكَس الذيل |
| عكس قيد عكس | **ممنوع** ⇒ `CANNOT_REVERSE_REVERSAL`. لإعادة الحالة الأصلية: عملية جديدة |
| الصافي التراكمي | `25500 − 25500 + 30000 − 30000 + 28750 = 28750` ✓ — ولا حاجة إلى أي منطق استبعاد |
| عدد الكتابات | 16 لكل حلقة داخل نفس الشهر. سلسلة من 10 تصحيحات = 160 كتابة موزّعة على 10 معاملات، لا معاملة واحدة ⇒ سقف 500 غير ذي صلة |
| سقف السلسلة | **لا سقف.** لكن عند `chainLength ≥ 5` تُظهر الواجهة: «عُدِّلت هذه العملية 5 مرات. إن كانت خاطئة من الأساس، الأنسب إلغاؤها وتسجيل عملية جديدة» — نصيحة لا منع |
| العرض | قائمة العمليات تعرض `E2` فقط (`status === 'posted' && kind !== 'reversal'`)، وزر «سجل التعديلات» يفتح السلسلة كلها بالقيم والأسباب والتواريخ |
| كشف الحساب | يعرض **كل** القيود بما فيها العكوس، لأن مجموع الكشف **يجب** أن يساوي الرصيد. إخفاء العكس وحده يجعل الكشف لا يطابق الرصيد |

### 8.6 العكس (`void`) — الأثر على كل كيان

```ts
export interface VoidEntryRequest {
  readonly type: 'voidEntry';
  readonly opId: string;              // = `rev:${targetEntryId}` — حتمي ⇒ عكس مزدوج مستحيل
  readonly targetEntryId: string;     // يجب أن يساوي lock.currentEntryId
  readonly expectedChainLength: number;
  readonly reason: string;            // إلزامي، غير فارغ
}
```

| الكيان | الحقل | الأثر عند عكس مبلغ `X` | الشرط / المنع |
|---|---|---|---|
| `accounts` (النقدي) | `debitTotalMinor` / `creditTotalMinor` / `balanceMinor` | الجانب المقلوب `+= X` ⇒ `balanceMinor` يعود تماماً | **لا يُفحَص `MIN_BALANCE`** على عكس يرفع الرصيد؛ يُفحَص إن كان العكس يخفضه (عكس دخل) |
| `accounts` (المقابل) | نفسها | الجانب المقلوب `+= X` | — |
| `accountPeriods/{acct}__{pk}` | `debitMinor` / `creditMinor` | حركة العكس تُضاف **إجمالاً** في `pk` **قيد العكس** (= `pk` الأصل، انظر 8.7) | المستند قد يكون لشهر ماضٍ — مسموح |
| **الالتزام** `obligations` | `paidMinor` | **نعم يرجع**: `paidMinor -= X` | يُعاد حساب `remainingMinor = totalMinor + extraChargesMinor − paidMinor` (ADR-012: `totalMinor` **لا يُرفع أبداً**) |
| | `installments[i].paidMinor` | `-= X` على `i = refs.obligationInstallmentIndex` | وإلا ظهر القسط مسدَّداً والإجمالي غير مسدَّد |
| | `status` | **يُعاد حسابه من الصفر** من `(remainingMinor, dueDate, libyaToday())` | يُحرَّم «الرجوع إلى الحالة السابقة»: الزمن تقدّم، فقد يكون `due` أصبح `overdue` |
| | `paymentCount` | `-= 1` | — |
| | تحقّق ADR-021 | قيد العكس يحمل `settlementDeltaMinor = −X` ⇒ `Σ settlementDeltaMinor` على `postings` بـ `refs.obligationId == id` **يظل مطابقاً** لـ `paidMinor` | الفحص `SETTLEMENT_MIRROR` في `verifyPlan` |
| | `ObligationNature` | **لا يتغيّر** (ADR-011). عكس قسط قرض (`financing`) لا يلمس «مصروف الشهر» لأنه لم يدخله أصلاً | — |
| **الدين** `debts` | `settledMinor` / `remainingMinor` / `status` / `settlementCount` | `settledMinor -= X`، إعادة حساب `remainingMinor` و`status`، `settlementCount -= 1` | — |
| | عكس **قيد النشوء** (`borrow`/`lend`) | **ممنوع إن `settlementCount > 0`** ⇒ `DEBT_HAS_SETTLEMENTS`: «ألغِ الدفعات المسجَّلة أولاً». وإلا: عكس + `debt.status = 'cancelled'` | — |
| **الميزانية** `budgets/{pk}` | `categories[c].spentMinor` | `-= X` في ميزانية **`pk` قيد العكس** | إن غاب المستند (لا ميزانية لذلك الشهر) ⇒ لا كتابة، لا خطأ |
| | `alertFiredAtBps` | **يُصفَّر** إن هبطت `ratioBps(spent, limit)` تحت الشريحة التي أُطلِق عندها التنبيه | وإلا لم يُنبَّه المستخدم مرة أخرى عند إعادة التجاوز — تنبيه مفقود صامت |
| **الهدف** `financialGoals` | `savedMinor` | `-= X` | — |
| | `status` | `'achieved' → 'active'` إن صار `savedMinor < targetMinor` | إعادة حساب لا استرجاع |
| | `achievedAt` | يُمحى (`null`) | — |
| `accounts.earmarkedMinor` | (مرآة مشتقة، ADR-017) | عكس قيد `earmark` ⇒ `earmarkedMinor -= X`. عكس مصروف استهلك حجزاً ⇒ `earmarkedMinor += X` | تجاوز الحجز **تحذير** لا منع (ADR-017)؛ **تحرير** الحجز لا يُفحَص أبداً |
| **الملخصات الشهرية** | — | **لا كتابة. لا مستند. صفر عمل** | لا يوجد مستند ملخّص شهري (ADR-016): كل رقم شهري يُحسب بـ `sum()` على `postings`، والعكس يُصفِّر نفسه رياضياً ⇒ **لا يمكن أن ينحرف ملخّص لم يُخزَّن** |
| `entryCorrections/{root}` | `voided` / `chainLength` / `currentEntryId` | `voided: true`, `chainLength += 1`, `currentEntryId` يبقى على القيد المعكوس | السلسلة مُقفلة: `ENTRY_VOIDED` لأي تعديل لاحق |
| `auditLogs/{rev:…}` | — | `create` بالسبب الإلزامي والقيم | القسم 18 بند 9 |
| **القيد الأصلي** | `reversed` / `reversedByEntryId` / `updatedAt` | `reversed: true` + الإشارة | `status` يبقى `'posted'` (عكس بلا بديل ≠ استبدال) |

**الممنوع عكسه إطلاقاً:**

| القيد | الخطأ | البديل |
|---|---|---|
| قيد عكس | `CANNOT_REVERSE_REVERSAL` | عملية جديدة |
| قيد مستبدَل (`status === 'replaced'`) | `ENTRY_ALREADY_REPLACED` | اعكس الذيل |
| قيد افتتاحي (`opn:`) وُجد بعده أي قيد على الحساب | `OPENING_HAS_SUBSEQUENT_ENTRIES` | عملية تسوية `adj:` |
| قيد نشوء دين له تسويات | `DEBT_HAS_SETTLEMENTS` | اعكس التسويات أولاً |

### 8.7 الحالة الخطرة: عكس قيد في شهر ماضٍ — في أي `periodKey` يُسجَّل العكس؟

**القرار المُلزِم:**

> **قيد العكس يحمل `bookedAt` القيد الأصلي حرفياً، ومن ثَمّ `periodKey` الأصل. دائماً. بلا استثناء،
> وبلا سياسة مشروطة بإقفال.**
> وفي التعديل الذي يغيّر `bookedAt`: **العكس في الشهر القديم، والبديل في الشهر الجديد.**

لماذا، بخمسة أسباب بُنيوية:

1. **ADR-008 لا يترك خياراً ثالثاً.** `periodKey ≡ bookedAt[0:7]` دائماً، فالسؤال يختزل إلى
   «ما `bookedAt` العكس؟». وهو تصحيح لحدث اقتصادي **وقع في مارس**، فتاريخه المحاسبي مارس.
   «متى صُحِّح؟» سؤال مختلف يجيبه `createdAt` (طابع خادمي) و`auditLogs` — وهذان هما الحقلان
   المناسبان للزمن الإجرائي.
2. **ADR-009 هو ما يجعل هذا مجاناً — وهذه الحجة الحاسمة.** `accountPeriods` تحفظ **الحركة فقط**،
   وأرصدة البداية/النهاية **مشتقّة تراكمياً ولا تُخزَّن**. فتصحيح بأثر رجعي على `2026-03` يُحدِّث
   مستنداً واحداً، وكل أرصدة افتتاح أبريل ومايو ويونيو **تنزاح تلقائياً** بصفر كتابة إضافية
   وبلا أي احتمال انحراف. لو كنا خزّنّا `openingBalanceMinor` لكل شهر، لفرض هذا القرار إعادة كتابة
   **كل شهر لاحق** في نفس المعاملة — وهو ما كان سيدفعنا قسراً إلى الخيار الأسوأ.
3. **البديل يُنتج رقماً كاذباً في شهرين لا في شهر واحد.** لو حمل العكس تاريخ اليوم:
   مارس **يبقى خاطئاً إلى الأبد** (ما زال يُظهر 25.500 مصروفاً لم يحدث)، وأبريل يُظهر
   **مصروفاً سالباً 25.500−** على فئة الطعام. فأصبح لدينا تقريران خاطئان بدل تقرير واحد صحيح.
   وهذا خرق مباشر للقسم 23 بند 12 (مطابقة التقارير للعمليات الأصلية) والقسم 16
   («جميع الأرقام من البيانات الفعلية»).
4. **لا التزام إيداع ولا جهة خارجية.** المبرّر الوحيد لتجميد شهر محاسبياً هو تقرير سُلِّم لجهة
   (ضريبة، مراجع، مصرف). «رصيد» نظام **شخصي لمستخدم واحد** (القسم 20)، ولا يُسلَّم منه شيء،
   فاستيراد قاعدة «لا تعديل بأثر رجعي» من محاسبة المؤسسات يستورد تكلفتها بلا منفعتها.
5. **لا مجموعة أقفال فترات في هذا العقد** — وكيانات النواة محصورة بالقائمة المعلنة.
   إضافة `periodLocks` كانت ستضيف كياناً وآلة حالة وبوابة في القواعد لحلّ مشكلة لا نملكها.

**ثلاث حوارس وتعويض إلزامي يجعل هذا القرار آمناً:**

| البند | التفصيل |
|---|---|
| حارس `NOT_FUTURE` | `bookedAt ≤ libyaToday()` لكل قيد بما فيه العكس. العكس يورّث تاريخاً ماضياً ⇒ يمرّ دائماً |
| حدّ خلفي | `bookedAt ≥ account.openedAt` لكل حساب في القيد ⇒ لا قيد قبل وجود الحساب |
| **قسم «تصحيحات بأثر رجعي» في كل تقرير شهري** | كل قيد في الشهر `pk` بـ `createdAt > آخر لحظة من pk` يُدرَج في قسم مستقل بعنوان «تصحيحات سُجِّلت لاحقاً (N)» بتاريخ التصحيح وسببه. فلا يفاجأ المستخدم بتغيّر تقرير مارس — **يرى سببه** |
| بصمة الدفتر على كل تصدير (ADR-016) | كل PDF/Excel/CSV يحمل `generatedAt` + `Σ debitTotalMinor` + عدد القيود للفترة. نسختان من تقرير مارس تُقارَنان فوراً، ويُعرف أيّهما أحدث وبكم تغيّر |

**مثال تعديل يغيّر الشهر — 18 كتابة:** مصروف 25.500 سُجِّل بالخطأ في `2026-03-14`، وتاريخه الصحيح
`2026-04-02`:

| المستند | التأثير |
|---|---|
| `journalEntries/{amd}__rev` | `bookedAt: '2026-03-14'`, `periodKey: '2026-03'`, عكس 25500 |
| `journalEntries/{amd}__new` | `bookedAt: '2026-04-02'`, `periodKey: '2026-04'`, مصروف 25500 |
| `accountPeriods/asset.cash.main__2026-03` | `debitMinor += 25500` (العكس يرجع النقد في مارس) |
| `accountPeriods/expense.food__2026-03` | `creditMinor += 25500` ⇒ صافي مارس للطعام **0** ✓ |
| `accountPeriods/asset.cash.main__2026-04` | `creditMinor += 25500` |
| `accountPeriods/expense.food__2026-04` | `debitMinor += 25500` ⇒ صافي أبريل **25500** ✓ |
| `budgets/2026-03` | `food.spentMinor -= 25500` |
| `budgets/2026-04` | `food.spentMinor += 25500` |
| + `postings` ×6، `journalEntries/E0` تحديث، `entryCorrections/E0`، `auditLogs`، `accounts` ×2 | — |

**النتيجة:** رصيد النقد **لم يتغيّر** (`−25500 +25500 = 0`)، ومارس عاد صفراً، وأبريل حمل المصروف،
وميزانيتا الشهرين صحيحتان — في **معاملة ذرّية واحدة**، بلا أي لحظة يرى فيها قارئ شهراً صحيحاً والآخر خطأ.

### 8.8 اختبارات القسم 8 الإلزامية

| الاختبار | المتوقع |
|---|---|
| تعديل 25.500 → 30.000 (المثال 8.2) | **16 كتابة** بالضبط، رصيد النقد `174500 → 170000`، صافي الطعام في `2026-10` = 30000، `budgets` = 30000 |
| تعديل 500.000 → 480.000 على حساب رصيده 10.000 | **ينجح**: الحارس على الصافي (`+20000`) لا على الخطوة |
| تعديل دفعة التزام 200.000 → 300.000 على التزام متبقٍّ منه 600.000 | ينجح (الصافي `+100000 ≤ 600000`) |
| تعديل دفعة التزام 200.000 → 900.000 على نفس الالتزام | `NO_OVERPAY` برسالة عربية، صفر كتابة |
| تعديلان متزامنان لنفس القيد من جهازين (محاكي) | أحدهما ينجح، الآخر `CORRECTION_CONFLICT`. **قيد عكس واحد فقط**، والرصيد انخفض مرة واحدة |
| تعديل يستهدف `E0` بعد وجود `E1` | `STALE_CORRECTION_TARGET` + الإشارة إلى الذيل |
| عكس نفس القيد مرتين (`rev:{id}` مرتين) | الثانية `alreadyApplied`، صفر كتابة |
| عكس قيد عكس | `CANNOT_REVERSE_REVERSAL` |
| عكس دفعة التزام | `paidMinor` و`remainingMinor` و`installments[i].paidMinor` و`status` و`paymentCount` كما قبل الدفعة حرفياً، و`Σ settlementDeltaMinor === paidMinor` (ADR-021) |
| عكس دفعة أعادت النسبة تحت 80% | `alertFiredAtBps` صُفِّر، والتنبيه يُطلَق مجدداً عند إعادة التجاوز |
| عكس قيد نشوء دين له دفعتان | `DEBT_HAS_SETTLEMENTS`، صفر كتابة |
| عكس قيد مارس في أكتوبر | `periodKey` العكس = `'2026-03'`، صافي مارس = 0، أكتوبر غير متأثر، `accounts.balanceMinor` صحيح |
| تعديل يغيّر الشهر (8.7) | **18 كتابة**، أربعة `accountPeriods`، ميزانيتان، رصيد النقد ثابت |
| سلسلة 10 تصحيحات متتالية | `chainLength === 10`، الصافي = قيمة الذيل، ميزان المراجعة متوازن، `correctionGroupId` واحد للجميع |
| `Σ` كل `postings` بلا أي مرشّح استبعاد بعد 10 تصحيحات | يساوي الرصيد الحقيقي — **إثبات أن `reversed` غير لازم للصحة** |
| تعديل وصفي لـ `description` فقط | **صفر قيد جديد**، كتابتان (`journalEntries/{id}` + `auditLogs`)، الرصيد بلا تغيير |
| إعادة وسم `household` | `postings` كلها حُدِّثت في نفس المعاملة، مجموع «مصاريف المنزل» تغيّر، **إجمالي المصروفات لم يتغيّر** (القسم 11) |
| محاولة `deleteDoc` على `journalEntries` أو `postings` | **ترفضها Firestore Rules**، واختبار ثابت على الكود: صفر نتيجة لـ `deleteDoc` على هاتين المجموعتين |
