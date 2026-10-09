# النواة المحاسبية — النسخة النهائية المعتمدة

> **المسار:** `docs/design/01-financial-core.md`
> **الحالة:** **معتمدة.** هذه الوثيقة هي **العقد** الذي تُبنى عليه كل وحدات «رصيد» الأخرى.
> **المرجع الأعلى:** `docs/00-REQUIREMENTS.md` + `docs/01-OWNER-DECISIONS.md` (ق-1، ق-2، ق-3).
> **الاستقلال:** هذه الوثيقة **مكتفية بذاتها**. لا تُحيل إلى `core-A.md` ولا `core-B.md` ولا `core-C.md`،
> وتلك الثلاث تبقى في المستودع كأرشيف تقييم فقط ولا تُستخدم كمرجع تنفيذي.
> **المرحلة:** تصميم. لا كود تطبيقي، لا مشروع npm، لا لمس Firebase.

---

## 0. كيف تُقرأ هذه الوثيقة

| القسم | ما فيه | من يقرؤه |
|---|---|---|
| 1 | القرار المعماري وسجل ADR وما رُفض ولماذا | المالك + أي مطوّر جديد |
| 2 | تمثيل المال نهائياً (التخزين، العرض، الإدخال، التقريب، التوزيع) | `src/domain/money/**` |
| 3 | شجرة الحسابات والتهيئة الأولى | `src/domain/coa/**` + سكربت التهيئة |
| 4 | واجهات TypeScript كاملة للنواة | تُنسَخ حرفياً إلى `src/domain/types/**` |
| 5 | الأرصدة والمُجمَّعات: ما يُخزَّن ومتى وبأي أسلوب كتابة | `src/domain/ledger/**` |
| 6 | منع الازدواج النهائي (تقني ودلالي) | `src/domain/ops/**` + `src/data/**` |
| 7 | بنية المعاملة الإلزامية (`TxPlan`) | `src/data/ledger/**` |
| 8 | التعديل والإلغاء وجدول تصنيف الحقول حقلاً حقلاً | `src/domain/ledger/amend.ts` |
| 9 | جدول القسم 19 كاملاً: كل قاعدة ⇒ الأثر الدقيق على كل كيان | الجميع — هذا هو جدول الحقيقة |
| 10 | آلات الحالة الأربع | `src/domain/rules/status.ts` |
| 11 | الحوارس (السالب، الزائد، اليتم، الحجز، التشابه) | `src/domain/rules/guards.ts` |
| 12 | خوارزميات كل العمليات بـ pseudocode | `src/domain/ops/**` |
| 13 | الثوابت I1…I24 كجُمل قابلة للاختبار | تتحول مباشرة إلى اختبارات وحدة |
| 14 | قواعد الأمان الكاملة (مع إصلاح عيب الأسبقية) | `firestore.rules` |
| 15 | التكلفة على Spark والفهارس | مراجعة الأداء |
| 16 | إعادة بناء الإسقاطات والتسوية | `src/domain/ledger/rebuild.ts` |
| 17 | الترحيل | `src/domain/migrate/**` |
| 18 | القصور المُعلَن صراحةً (ما لا يحلّه هذا التصميم) | المالك — قرار مستنير |
| 19 | معالجة كل عيب قاتل باسمه | المراجعة الهندسية |
| 20 | الاختبارات الإلزامية | `tests/**` |
| 21 | فرض حدود الطبقات بأداة البناء | `.eslintrc` |
| 22 | ما حُسم وما بقي مفتوحاً | المالك |
| 23 | سطح واجهة النطاق الكامل (ما تناديه الواجهة فقط) | `src/domain/api.ts` |
| 24 | خلاصة العقد في عشر جُمل | الجميع |

**اصطلاحات ثابتة في كل الوثيقة:**

- `X` = مبلغ بالوحدة الصغرى (درهم ليبي)، عدد صحيح موجب.
- `Dr` = مدين (debit)، `Cr` = دائن (credit). «✗» = لا أثر على هذا الكيان.
- كل الأسطر داخل خوارزمية واحدة تُكتب في **معاملة واحدة ذرّية** إلا إن نُصّ على غير ذلك.
- `pk` = `periodKey` = `'YYYY-MM'`.
- أي اسم حقل أو دالة أو مجموعة مكتوب بالإنجليزية = **اسمه النهائي في الكود**، لا اقتراح.

---

## 1. القرار المعماري

### 1.1 القرار

> **نواة قيد مزدوج صارمة في الداخل + واجهة عمليات مُسمّاة في الخارج + مستندات مُجمَّعة مرافقة
> + مجموعة `postings` مسطَّحة للتجميع الخادمي.**
>
> `double-entry core + named operations API + satellite aggregates + flat postings projection`

ثلاث طبقات لا تتبادل المسؤوليات:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ui/            لا تحسب شيئاً. تنادي execute(req) وتقرأ selectors.     │
│                لا تعرف كلمة debit ولا credit ولا lines.               │
├──────────────────────────────────────────────────────────────────────┤
│ domain/        نقية 100%: صفر استيراد من firebase ومن data.          │
│                planOperation(req, snapshot) → WritePlan | DomainError │
│                هي **المكان الوحيد** الذي يبني lines و side.          │
├──────────────────────────────────────────────────────────────────────┤
│ data/          الطبقة الوحيدة التي تلمس Firestore.                   │
│                postOperation() = نقطة الكتابة المالية الوحيدة.        │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 لماذا القيد المزدوج، بالضبط

السبب **ليس** المحاسبة. السبب **ثابت رياضي واحد قابل للفحص آلياً**:

> `Σ debit = Σ credit`

متطلب القسم 18 («دون ازدواج أو فقدان بيانات») والقاعدة 19.11 («حتى لا تتضخم التقارير») لا يمكن فرضهما
إلا بثابت كهذا. وهذه هي الفوائد الأربع الملموسة التي دفعتنا إليه، وكل واحدة منها حُسمت بسيناريو لا برأي:

1. **التقرير دالّة في نوع الحساب، لا في حقل وصفي.** الدخل = سطور على حسابات `income`. المصروف = سطور على
   حسابات `expense`. فالتحويل بين حسابين **لا يمكنه بنيوياً** أن يدخل الدخل أو المصروف، لأن طرفيه كلاهما
   `asset` ولا يوجد حساب دخل/مصروف في القيد أصلاً. أي تصميم يعتمد حقلاً مثل `type: 'income'` مع نوع فرعي
   `debtDrawdown` يعني أن مستنداً نوعه «دخل» **ليس دخلاً**، وأن أول استعلام طبيعي
   (`where type == 'income'`) **يضخّم الدخل بأصل كل قرض مستلم** — وهو عين ما تحرّمه القاعدة 19.11.
2. **العكس يُصفِّر نفسه رياضياً.** قيد العكس يقلب الجانب (`debit ↔ credit`) ولا يورّث أي تصنيف.
   فأي مجموع على القيود المرحَّلة — بأي مرشّح، في أي تقرير، في أي تصدير — يعطي الرقم الصحيح
   **بلا أي منطق استبعاد**. البديل (حركة عكس ترث تصنيف الأصل وتقلب الاتجاه فقط) يجبر كل استعلام تقرير
   على تذكّر استخراج الإشارة من الاتجاه وعدم تصفية دورة الحياة، وأي نسيان ينتج **ضعف المبلغ** أو **سالبه**.
3. **ميزان المراجعة فحص سلامة رخيص وشامل.** بقراءة ~45 مستند حساب فقط: `Σ debitTotalMinor` يجب أن يساوي
   `Σ creditTotalMinor`. تحويل فقد طرفه الثاني (حُدِّث حساب المصدر ولم يُحدَّث حساب الوجهة) **يختلّ فوراً
   ويُكتشف في أول تسجيل دخول**. في تصميم أحادي الجانب لا يوجد أي ثابت عرضي بين المستندات، فتختفي
   500.000 د.ل بلا أي أثر حتى يشتكي المستخدم.
4. **سجل الدفعات مصدر حقيقة واحد.** دفعات الالتزام والدين = استعلام مفهرس على الدفتر
   (`where refs.obligationId == id`). لا مصفوفة معرّفات بسقف 50، ولا مجموعة موازية تنحرف.

### 1.3 ماذا رُفض، ولماذا

| البديل المرفوض | المزية التي خسرناها | سبب الرفض الحاسم |
|---|---|---|
| **دفتر حركات أحادي الجانب** (`transactions` بـ `accountId` + `amount` موقَّع + `reportClass`) | أبسط بكثير، 4 كتابات بدل 7 | **لا ثابت عرضي بين المستندات على الإطلاق.** رصيد خاطئ غير قابل للكشف إلا بمسح الدفتر. وحقل `deltaSumMinor` المقترح كمخفِّف **وهمي**: يُكتب في نفس عبارة الكتابة من نفس القيمة المقروءة، فلا يمكن أن يختلف عن `balanceMinor` إلا بخطأ كتابة حرفي ⇒ لا يكشف أي خطأ حسابي ولا أي كتابة ناقصة. أضف إليه فخّ `type:'income'/subtype:'debtDrawdown'` ودلالات العكس التي تُضاعف أو تُسالب كل تقرير استعلامي |
| **سجل أحداث + إسقاطات (event sourcing)** | إعادة بناء كاملة، قدرة إثبات صحة الإسقاط | **آثار السجلات التشغيلية خارج ضمان التوازن.** حدث دفعة التزام بأرجل 20.000 و`paidDeltaMinor: 200000` **متوازن تماماً** ويمرّ من كل الثوابت والقواعد، والرقم الخاطئ **محفور في حدث غير قابل للتعديل** ⇒ إعادة البناء تُعيد إنتاج الخطأ بالضبط والتسوية تُبلّغ عن انحراف **صفر**. أي أن أقوى ميزة في المنظور عاجزة عن حماية أهم كيانات المتطلبات (الأقسام 8 و9 و10 و12). يُضاف: عدم وجود حقل `reversed` على الحدث يجعل الأحداث المعكوسة غير قابلة للاستبعاد من أي استعلام |
| **قيد مزدوج «نقي» يُدخل الالتزامات والميزانيات والأهداف كحسابات بأسلوب الاستحقاق** | نقاء محاسبي | يعطي المستخدم الشخصي رقماً **لا يريده ولا يفهمه**: إنشاء التزام إيجار سنوي يرفع «مصروفات هذا الشهر» 9,600 د.ل بلا أي مال خرج. يناقض القسم 12 («فصل واضح بين الفعلي والتوقعات») |
| **السطور في مجموعة فرعية** (`journalEntries/{id}/lines/{lineId}`) | `sum()` خادمي مباشر | يُدخل «القيد اليتيم» (قيد بلا سطور / سطر بلا قيد) كاحتمال حقيقي عند فشل جزئي. حُلّت المشكلة الأصلية بـ `postings` المسطَّحة (قسم 5.6) التي تعطي `sum()` **بلا** التنازل عن ذرّية القيد |
| **حساب الرصيد عند القراءة** | لا انحراف ممكن | 3,000 قراءة لفتح لوحة التحكم مرة واحدة بعد سنتين ⇒ 16 فتحة/يوم على Spark. مرفوض |

### 1.4 سجل القرارات المعمارية (ADR)

تُنشأ كملفات مستقلة في `docs/adr/ADR-0NN-*.md` بنفس الترقيم، وكل واحد منها يحمل: السياق، القرار،
البدائل المرفوضة، النتائج، وكيف نعرف أننا أخطأنا.

| # | القرار | الحالة |
|---|---|---|
| ADR-001 | **الدرهم الليبي** وحدة التخزين الصغرى (`1 LYD = 1000 درهم`)، أُسّ عشري = 3، `number` صحيح في Firestore | **معتمد** |
| ADR-002 | **قيد مزدوج** بسطور مضمَّنة في مستند القيد + `postings` مسطَّحة في نفس المعاملة | **معتمد** |
| ADR-003 | الرصيد **مُجمَّع مخزَّن** يُحدَّث داخل نفس المعاملة، لا محسوب عند القراءة | **معتمد** |
| ADR-004 | **`entryId === opId`**: منع الازدواج خصيصة في مفتاح المستند، لا منطق تطبيقي؛ + `payloadHash` | **معتمد** |
| ADR-005 | **لا مجموعة `debtPayments` ولا `obligationPayments`** — سجل الدفعات استعلام على الدفتر (انحراف موثَّق عن القسم 18) | **معتمد** |
| ADR-006 | التعديل = **عكس + بديل في معاملة واحدة بدلتا صافية**؛ لا حذف مالي أبداً | **معتمد** |
| ADR-007 | العمليات المالية تتطلب اتصالاً (`runTransaction` لا يعمل دون اتصال) ⇒ **طابور `pendingCommands` + مرآة محلية**، والعمليات المعلّقة **مستبعدة من كل رصيد وتقرير** | **معتمد** |
| ADR-008 | `periodKey ≡ bookedAt[0:7]` **دائماً** (شهر ميلادي). «بداية الشهر المالي» تصبح **نافذة عرض/تقرير** على نطاق `bookedAt` عبر إسقاط منفصل، ولا تمسّ القيود ولا القواعد | **معتمد** — يحسم تناقضاً قاتلاً |
| ADR-009 | `accountPeriods` تحفظ **الحركة فقط** (`debitMinor`/`creditMinor`)؛ أرصدة البداية/النهاية **مشتقّة تراكمياً** ولا تُخزَّن | **معتمد** — يحسم عيباً قاتلاً |
| ADR-010 | حدّ الرصيد = **`minBalanceMinor` موقَّع** (افتراضي 0). حُذف `allowNegative` البولياني من المخطط نهائياً | **معتمد** |
| ADR-011 | `ObligationNature = 'expense' \| 'financing'` — قسط القرض **ليس مصروفاً** | **معتمد** |
| ADR-012 | `extraChargesMinor` حقل منفصل على الالتزام؛ **`totalMinor` لا يُرفع أبداً** لاستيعاب غرامة أو فاتورة متغيرة | **معتمد** |
| ADR-013 | توليد دورات التكرار **من قالب التكرار عبر مُشغِّل الاستدراك**، لا من معاملة الدفع | **معتمد** — يحسم عيبين |
| ADR-014 | قفل التصحيح مستند مستقل `entryCorrections/{originalEntryId}`، لا `amd:{id}:{count}` | **معتمد** |
| ADR-015 | إعادة بناء الإسقاطات **إجراء كامل** ببوابة في القواعد ومؤشر استئناف وقيم مطلقة | **معتمد** |
| ADR-016 | بصمة الدفتر بـ `getAggregateFromServer(sum(...))` عند الطلب — **لا مستند عدّاد ساخن** | **معتمد** |
| ADR-017 | `earmarkedMinor` مرآة مشتقة على الحساب؛ تجاوز الحجز **تحذير**، تجاوز الرصيد **منع** | **معتمد** |
| ADR-018 | فرض حدود الطبقات **بأداة البناء** (`eslint-plugin-boundaries`) لا بمراجعة الكود | **معتمد** |
| ADR-019 | الأحداث/القيود **لا تُرحَّل أبداً**؛ الترحيل بطيء عند القراءة وللمستندات المشتقة فقط | **معتمد** |
| ADR-020 | الضمان النهائي على Spark = مسار كتابة وحيد + اختبار جدولي + فاحص دوري. **الفرض الخادمي الحقيقي يبدأ عند Blaze** — يُعرض على المالك صراحةً | **معتمد مع إعلان مخاطرة** |
| ADR-021 | `Σ settlementDeltaMinor` على `postings` هو **المصدر المستقل** للتحقق من `paidMinor`/`settledMinor` | **معتمد** |
| ADR-022 | قاعدة `getAfter()` التي تربط تغيّر الرصيد بقيد مصاحب | **مقترح — لا يُعتمد قبل إثباته في المحاكي** |

---

## 2. تمثيل المال — القرار النهائي

### 2.1 وحدة التخزين وعدد الخانات

| البند | القرار |
|---|---|
| العملة | `LYD` — الدينار الليبي. لا تعدد عملات في الإصدار الأول (الحقل محفوظ) |
| وحدة التخزين الصغرى | **الدرهم**. `1 LYD = 1000 درهم` |
| الأُسّ العشري المعتمد | **3** |
| النوع في Firestore | `number` — **عدد صحيح**، لا كسر عشري عائم، إطلاقاً |
| النوع في TypeScript | `Minor` — `number` موسوم (branded) |
| الحد الأقصى المعلن | `MAX_ABS_MINOR = 1_000_000_000_000` (ألف مليار درهم = مليار دينار) |

**لماذا الدرهم (3 خانات) وليس خانتين؟** ثلاث حجج، لا تفضيل:

1. **قياسي:** ISO 4217 يعطي `LYD` أُسّاً = 3. اختيار خانتين كسر صريح للمعيار.
2. **رياضي:** أي أُسّ أقل من 3 يجعل التحويل من مدخل المستخدم إلى التخزين **عملية فاقدة للبيانات** (lossy)،
   وهذا يناقض القسم 18 بند 3 نصّاً. أسعار 0.250 و1.750 د.ل شائعة فعلاً في الوقود والمواد.
3. **عملي:** `Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991` = **9.007 تريليون دينار** بالدرهم.
   لا سيناريو شخصي يقاربه ⇒ لا حاجة إلى `string` ولا `Decimal128` **في التخزين**.
   (لكن **الضرب بنسبة يحتاج `BigInt`** — انظر 2.4، وهذا تصحيح رياضي إلزامي لا اختياري.)

**`MAX_ABS_MINOR` ليس تجميلاً:** هو الحد الذي تفرضه القواعد وطبقة النطاق على كل مبلغ، وسببه أن ضرب مبلغ
بحدّه الأقصى في أساس نقطة (`10^4`) يعطي `10^16 > 2^53` ⇒ أي ضرب بنسبة **يجب** أن يمرّ بـ `BigInt`.

### 2.2 العرض والإدخال — ق-3 مُلزِم

**الأرقام لاتينية في كل الشاشات بلا استثناء** (`1,250.500` وليس `١٬٢٥٠٫٥٠٠`) — قرار المالك ق-3.
هذا يعني في دالة التنسيق الوحيدة في النظام:

```ts
// domain/money/format.ts
const NF_3 = new Intl.NumberFormat('ar-LY-u-nu-latn', {
  minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: true,
});
```

| السياق | عدد الخانات | مثال |
|---|---|---|
| دفتر الحساب، تفاصيل العملية، كشف الحركة، التقارير الجدولية، التصدير | **3 دائماً** | `25.500 د.ل` |
| بطاقات لوحة التحكم والمخططات | `settings.display.amountDecimals: 0 \| 2 \| 3` (افتراضي 3) | `1,250 د.ل` مع القيمة الكاملة في `title` |

**ثلاث قواعد إلزامية على العرض:**

1. **يُحرَّم جمع قيم منسَّقة أو مُقرَّبة.** كل مجموع يُحسب على `Minor` ثم يُنسَّق **مرة واحدة** في النهاية.
   وإلا ظهر «الإجمالي ≠ مجموع الصفوف» في التقارير — خرق مباشر للقسم 23 بند 12.
2. **لا `toFixed()` ولا `toLocaleString()` في أي مكوّن واجهة.** دالة واحدة: `formatLYD()`.
3. الجداول المالية تستخدم `font-variant-numeric: tabular-nums` (ق-3).

**الإدخال:** رفض صريح لا تقريب صامت.

```ts
// domain/money/parse.ts
export type ParseResult =
  | { ok: true; value: Minor }
  | { ok: false; code: 'EMPTY' | 'NOT_A_NUMBER' | 'TOO_MANY_DECIMALS'
                     | 'OUT_OF_RANGE' | 'NEGATIVE' };

/**
 * يحوّل مدخل المستخدم النصي إلى Minor دون أي حساب عشري عائم (عبر تجزئة النص).
 * يقبل: "25.5" | "25.500" | "25,5" | "1 234.750" | "١٢٣٤٫٧٥٠" (أرقام هندية-عربية في **الإدخال** مقبولة
 *        لأن لوحة المفاتيح قد تُنتجها — والعرض يبقى لاتينياً دائماً وفق ق-3).
 * يرفض: أكثر من 3 خانات عشرية ⇒ TOO_MANY_DECIMALS برسالة عربية:
 *        «الحد الأقصى ثلاث خانات عشرية (الدرهم).»
 */
export function parseAmountToMinor(input: string): ParseResult;
```

سبب رفض التقريب الصامت: القسم 25 بند 15 يمنع إخفاء المشكلات. مستخدم يكتب `25.5055` يجب أن يرى سبباً،
لا أن يُحوَّل مبلغه خلسة.

### 2.3 الحساب الآمن

```ts
// domain/money/arithmetic.ts
export function addMinor(...xs: Minor[]): Minor;        // مع فحص MAX_ABS_MINOR
export function subMinor(a: Minor, b: Minor): Minor;
export function negateMinor(a: Minor): Minor;
export function sumMinor(xs: readonly Minor[]): Minor;
export function compareMinor(a: Minor, b: Minor): -1 | 0 | 1;
export function isZero(a: Minor): boolean;
export function clampAtZero(a: Minor): Minor;
export function assertInRange(a: number): Minor;        // يرمي إن تجاوز MAX_ABS_MINOR
```

### 2.4 الضرب بنسبة — `BigInt` إلزامي (تصحيح رياضي)

**النسب في النظام تُمثَّل بأساس النقطة (basis points) كعدد صحيح**، لا ببسط ومقام حرّين:
`1 bps = 0.01%`، فـ `2.5%` = `250 bps`، و`80%` = `8000 bps`.

```ts
// domain/money/rate.ts
export type Bps = number & { readonly __bps: unique symbol };   // عدد صحيح 0..1_000_000

/**
 * الضرب بنسبة، بتقريب نصف-لأعلى (half-up) صريح وواحد.
 *   mulRate(v, bps) = Number( (BigInt(v) * BigInt(bps) + 5000n) / 10000n )
 *
 * **لماذا BigInt إلزامي ولا نقاش فيه:**
 *   MAX_ABS_MINOR ≈ 10^12 درهم، وضربه في أساس نقطة (10^4) يعطي 10^16.
 *   و 10^16 > 2^53 = 9,007,199,254,740,991  ⇒ الحساب بـ number **يفقد الدقة صامتاً**.
 *   الموضع الذي يظهر فيه الخطأ: حاسبة الزكاة 2.5% على أرصدة كبيرة، وأي نسبة سيناريو في القسم 12.
 *   هذا ليس تحسيناً نظرياً: القسم 15.4 يطلب توضيح طريقة الحساب وافتراضاته، ونتيجة خاطئة صامتة
 *   في حاسبة زكاة غير مقبولة بأي معيار.
 *
 * التقريب نصف-لأعلى لا banker's rounding — قرار موثَّق لأن الفرق يظهر في حاسبة الزكاة،
 * وهو ما يتوقعه المستخدم في السياق المالي الشخصي.
 */
export function mulRate(v: Minor, bps: Bps): Minor;

/** للعرض والمؤشرات فقط (0..100، عائم مسموح). يُحرَّم استخدام ناتجها في أي كتابة. */
export function percentOf(part: Minor, whole: Minor): number;

/** النسبة كـ bps من مبلغين — للمقارنات داخل النطاق (مثال: نسبة استهلاك الميزانية). */
export function ratioBps(part: Minor, whole: Minor): Bps;
```

**يُحرَّم في كل النظام:** `Math.round(minor * 0.025)` — يمرّ عبر عدد عشري عائم.
تُفرض هذه الحرمة بقاعدة ESLint (قسم 21): أي `*` أو `/` على متغير نوعه `Minor` خارج `domain/money/**`
هو **خطأ بناء**.

### 2.5 القسمة والتوزيع بلا ضياع وحدات

**القاعدة الحاكمة: مجموع الأجزاء = الكل، بلا استثناء.** الخوارزمية: **أكبر الباقي (largest remainder)**
بتوزيع حتمي.

```ts
// domain/money/allocate.ts

/**
 * تقسيم متساوٍ قدر الإمكان.
 * الثابت المضمون: sumMinor(result) === total  &&  result.length === n
 * الباقي يُوزَّع وحدةً واحدة على أول `remainder` عنصراً (حتمي، قابل للاختبار).
 *
 * splitEven(1000, 3)      → [334, 333, 333]                      المجموع 1000
 * splitEven(1_000_000, 3) → [333_334, 333_333, 333_333]           المجموع 1,000,000
 * splitEven(1, 3)         → [1, 0, 0]        ← لا ثلاثة أصفار
 * splitEven(0, 5)         → [0,0,0,0,0]
 * splitEven(-1000, 3)     → [-334, -333, -333]                    الباقي يتبع الإشارة
 */
export function splitEven(total: Minor, n: number): Minor[];

/**
 * توزيع بأوزان صحيحة (largest remainder، بحساب BigInt للنسب):
 *   exact_i = total × w_i / Σw   (BigInt)
 *   floor_i = ⌊exact_i⌋
 *   left    = total − Σ floor_i
 *   رتّب تنازلياً حسب (exact_i − floor_i) ثم أضف وحدة لأول `left` عنصراً
 *   التعادل في الكسر يُحَل بالفهرس الأصغر ⇒ حتمية كاملة
 *
 * الثابت: sumMinor(result) === total
 * allocateByWeights(1000, [2,1,1]) → [500, 250, 250]
 * allocateByWeights(10,   [1,1,1]) → [4, 3, 3]
 */
export function allocateByWeights(total: Minor, weights: readonly number[]): Minor[];
```

**الاستعمالات:** تقسيم مصروف مشترك بين فئتين، توزيع دفعة واحدة على عدة التزامات، توزيع مبلغ ادخار على
عدة أهداف، وجدول الأقساط.

### 2.6 جدول الأقساط

```ts
export interface InstallmentPlanInput {
  totalMinor: Minor;
  count: number;                     // ≥ 1
  firstDueDate: string;              // 'YYYY-MM-DD'
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  dayOfMonthPolicy?: 'clampToEndOfMonth' | 'exact';   // 31 يناير → 28/29 فبراير
}

export interface Installment {
  index: number;                     // 1-based، ثابت إلى الأبد
  dueDate: string;                   // 'YYYY-MM-DD'
  amountMinor: Minor;                // من splitEven — **يُخزَّن صريحاً**
  paidMinor: Minor;                  // يبدأ 0
  status: 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';
}

export function buildInstallmentPlan(input: InstallmentPlanInput): Installment[];
```

**ثلاثة قرارات صريحة:**

1. **الباقي يُحمَّل على القسط الأول** لا الأخير. السبب: «مبلغ التسوية» في القسط الأخير مُربك للمستخدم،
   والفرق في الأول مقبول عرفاً ويظهر مبكراً حيث يمكن تصحيحه.
2. **الأقساط تُخزَّن صريحةً** في `obligation.installments[]` عند الإنشاء، ولا تُحسب عند كل قراءة —
   وإلا اختلف التوزيع بين شاشة وأخرى أو بين إصدارين.
3. **يُحرَّم إعادة حساب القسط الأخير بالطرح وقت السداد.** هذا مصدر شائع لفروق الوحدة.

### 2.7 اختبارات المال الإلزامية

| الحالة | المتوقع |
|---|---|
| `splitEven(1000, 3)` | `[334,333,333]`، المجموع 1000 |
| `splitEven(1, 3)` | `[1,0,0]` |
| `splitEven(0, 5)` | خمسة أصفار |
| `splitEven(100, 1)` | `[100]` |
| `splitEven(x, n)` لكل `x ∈ [0..5000]`, `n ∈ [1..24]` | **property test:** المجموع = `x`، والفرق بين أكبر وأصغر جزء ≤ 1 |
| `allocateByWeights(total, w)` على 10,000 حالة عشوائية | **property test:** `Σ result === total` |
| `buildInstallmentPlan(800000, 7, …)` | مجموع الأقساط = 800000، والقسط الأول يحمل الباقي |
| `mulRate(1_000_000_000_000, 250)` | النتيجة الصحيحة بالضبط (مقارنة بـ `BigInt` مرجعي) — **يفشل إن استُخدم `number`** |
| `mulRate` بكل أنصاف الوحدات | نصف-لأعلى: `mulRate(2, 5000) === 1`, `mulRate(6, 2500) === 2` |
| `parseAmountToMinor` بمدخلات عربية/أوروبية/4 خانات/فارغ/سالب | رموز الخطأ الصحيحة، لا تقريب صامت |
| `formatLYD` | **أرقام لاتينية دائماً** (ق-3): لا حرف هندي-عربي في المخرج قطعاً |

**ثابت يُفرَض وقت التشغيل** داخل دوال التوزيع نفسها (`invariant()` يرمي استثناء نظام يُسجَّل ولا يُصطاد
إلى الواجهة): أي انحراف في المجموع **عيب برمجي** لا خطأ مستخدم.

---

## 3. شجرة الحسابات

### 3.1 الأنواع الخمسة وقاعدة الإشارة

| النوع `type` | الجانب الطبيعي `normalSide` | يزيد بـ | أمثلة في «رصيد» |
|---|---|---|---|
| `asset` (أصول) | `debit` | مدين | النقد، الحساب المصرفي، المحفظة الإلكترونية، **المستحق لي** |
| `liability` (خصوم) | `credit` | دائن | **الديون عليّ** لكل دائن، الزكاة المستحقة، التزام تمويلي |
| `income` (دخل) | `credit` | دائن | الراتب، المكافآت، الأعمال الإضافية، الإيرادات الاستثمارية |
| `expense` (مصروف) | `debit` | مدين | حساب لكل فئة/فئة فرعية من فئات القسم 6 |
| `equity` (حقوق) | `credit` | دائن | الرصيد الافتتاحي، التسويات، التخصيصات (earmarks) |

```ts
// domain/coa/sides.ts
export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';
export type Side = 'debit' | 'credit';

/** الجانب الطبيعي لنوع الحساب. دالة نقية واحدة في النظام. */
export function normalSideOf(type: AccountType): Side {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

/** +1 إذا كان السطر يزيد الرصيد في اتجاهه الطبيعي، -1 إذا ينقصه. */
export function lineSign(type: AccountType, side: Side): 1 | -1 {
  return side === normalSideOf(type) ? 1 : -1;
}
```

### 3.2 الشجرة الافتراضية المُهيَّأة عند أول تسجيل دخول

لا يراها المستخدم بهذا الشكل؛ يراها مقسّمة على شاشات (مصادر الأموال / الفئات / مصادر الدخل / الديون).

```
asset                                   [فرع، غير قابل للترحيل]
├─ asset.cash                           النقد
│  └─ asset.cash.{accountId}            «نقد شخصي»              isCashLike=true
├─ asset.bank                           الحسابات المصرفية
│  └─ asset.bank.{accountId}            «مصرف الجمهورية»        isCashLike=true
├─ asset.ewallet                        المحافظ الإلكترونية
│  └─ asset.ewallet.{accountId}         «سداد / موبي كاش»       isCashLike=true
└─ asset.receivable                     المستحق لي (ديون للتحصيل)
   └─ asset.receivable.{contactId}      «أحمد»                  isCashLike=false  ← القاعدة 19.9

liability
├─ liability.payable                    الديون عليّ
│  └─ liability.payable.{contactId}     «شركة س / والدي»
├─ liability.financing                  الالتزامات التمويلية (أقساط قروض/سيارة) — ADR-011
│  └─ liability.financing.{contactId}
└─ liability.zakat                      الزكاة المستحقة غير المدفوعة (القسم 15.4)

income
├─ income.salary          الراتب الشهري
├─ income.bonus           المكافآت
├─ income.sidework        الأعمال الإضافية
├─ income.investment      الإيرادات الاستثمارية
├─ income.gift            الهدايا المالية
└─ income.other           أخرى

expense                   حساب واحد لكل فئة/فئة فرعية (ربط 1:1 مع categories)
├─ expense.food           الطعام والمشروبات
├─ expense.transport      المواصلات والوقود
├─ expense.home           مصاريف المنزل         (وتحتها فئات فرعية)
├─ expense.shopping       المشتريات
├─ expense.telecom        الاتصالات والإنترنت
├─ expense.health         الصحة
├─ expense.entertainment  الترفيه
├─ expense.gifts          الهدايا
├─ expense.subscriptions  الاشتراكات
├─ expense.travel         السفر
├─ expense.emergency      المصروفات الطارئة
├─ expense.charity        الصدقات والزكاة المدفوعة
├─ expense.fees           الرسوم والعمولات المصرفية
├─ expense.finance        فوائد وتكاليف تمويل        ← الزيادة على الدين مصروف، أصله لا
├─ expense.baddebt        ديون معدومة (شطب مستحق)
└─ expense.{customId}     فئات مخصصة

equity
├─ equity.opening         الأرصدة الافتتاحية        ← الطرف المقابل لكل رصيد ابتدائي
├─ equity.adjustment      تسويات الجرد والفروق      ← القسم 5 «تسوية واضحة ومبررة»
├─ equity.unallocated     غير مخصص (الطرف المقابل للتخصيصات)
└─ equity.earmark
   └─ equity.earmark.goal.{goalId}      مخصص لهدف مالي (القسم 12)
```

### 3.3 مستندات التهيئة الإلزامية (seed)

**هذه ليست تفصيلاً: غياب أحد هذين المستندين يُوقف النظام بالكامل** (انظر العيب ع-ج-5).
سكربت التهيئة الأولى يكتب في **نفس `writeBatch`**:

| المستند | القيمة الأولية | لماذا إلزامي |
|---|---|---|
| `users/{uid}/meta/integrity` | `{ projectionVersion: 1, rebuildStatus: 'idle', rebuildCursor: null, lastReconciledAt: null }` | بوابة إعادة البناء في القواعد تقرؤه. غيابه ⇒ تقييم `null.data` ⇒ **رفض كل كتابة مالية** برسالة `permission-denied` لا تشرح شيئاً. (والقاعدة نفسها تُكتب بنمط آمن `!exists(...) \|\| get(...)` كطبقة ثانية) |
| `users/{uid}/meta/schema` | `{ currentVersion: 1, appliedMigrations: [] }` | حارس `SCHEMA_VERSION_AHEAD` |
| `users/{uid}/settings/app` | الإعدادات الافتراضية (القسم 21) | لا شاشة بلا مصدر بيانات |
| شجرة الحسابات | ~45 مستنداً من 3.2 | الترحيل مستحيل بلا حسابات |
| `users/{uid}/categories/*` | الفئات المقترحة في القسم 6 | ربط 1:1 مع حسابات `expense` |

**التهيئة idempotent:** معرّفات الحسابات والفئات **حتمية مشتقة من `code`**
(`accountIdOf(code) = sha1(code).slice(0,20)`)، فإعادة تشغيل التهيئة لا تُنشئ شجرة ثانية.
وتُنفَّذ بـ `writeBatch` مجزَّأ ≤450 عملية.

### 3.4 الفئات ليست هي الحسابات، لكن لكل فئة حساب

`categories/{categoryId}` يبقى مستند الفئة الذي يراه المستخدم (اسم، أيقونة، لون، ترتيب، تعطيل)، وله
`expenseAccountId` يشير إلى حساب مصروف يُنشأ تلقائياً عند إنشاء الفئة و**لا يُحذف أبداً**.

**السبب:** القسم 6 يطلب «تعطيل الفئات دون الإضرار بالسجلات التاريخية». التعطيل = `status:'archived'` على
مستند الفئة وعلى الحساب، والقيود التاريخية تبقى سليمة لأنها تشير إلى `accountId` لا إلى اسم.

### 3.5 «مصاريف المنزل» — كيف نمنع الازدواج (القسم 11)

الطبيعة المنزلية **وسم على القيد** (`tags: ['household']`) + فئات فرعية تحت `expense.home`.
ليست شجرة موازية ولا قيداً ثانياً. شاشة المنزل = **استعلام مُصفّى على نفس القيود**، و
`periods.householdExpenseMinor` **مجموع فرعي من نفس الرقم لا قيمة مضافة**.
لهذا تظهر قيمتها في التقرير العام **مرة واحدة فقط** — وهو مطلب القسم 11 الصريح.

> **تحذير بنيوي مهم (انظر جدول 8.2):** لأن وسم `household` يحرّك مُجمَّعاً مالياً
> (`periods.householdExpenseMinor`)، فهو **ليس** حقلاً وصفياً قابلاً للتعديل الحرّ. تعديله يمرّ بمسار
> يُحدِّث المُجمَّع في نفس المعاملة، وإلا انحرف تقرير مصاريف المنزل دون أي قيد يفسّره.

---

## 4. واجهات TypeScript الكاملة للنواة

> هذه الكتل تُنسَخ حرفياً إلى `src/domain/types/**`. كل حقل هنا **موجود في التنفيذ**؛
> لا حقل «للتوضيح».

### 4.1 الأساسيات

```ts
// domain/types/common.ts
import type { Timestamp } from 'firebase/firestore';   // النوع فقط — لا استيراد تنفيذي في domain

declare const MINOR_BRAND: unique symbol;
/** مبلغ بالوحدة الصغرى (درهم ليبي). عدد صحيح. */
export type Minor = number & { readonly [MINOR_BRAND]: 'LYD' };

export const MINOR_PER_UNIT = 1000 as const;
export const DISPLAY_DECIMALS = 3 as const;
export const MAX_ABS_MINOR = 1_000_000_000_000 as const;
export const SCHEMA_VERSION = 1 as const;

/** 'YYYY-MM-DD' بتوقيت المستخدم المحلي. */
export type DateKey = string;
/** 'YYYY-MM' — ADR-008: دائماً bookedAt.slice(0,7) */
export type PeriodKey = string;

export interface OwnedDoc {
  id: string;
  ownerUid: string;
  schemaVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4.2 `Account`

المسار: `users/{uid}/accounts/{accountId}`

```ts
export type AccountSubtype =
  | 'cash' | 'bank' | 'ewallet' | 'other'          // asset سائل
  | 'receivable'                                    // asset غير سائل
  | 'payable' | 'financing' | 'zakatDue'            // liability
  | 'incomeSource'                                  // income
  | 'expenseCategory'                               // expense
  | 'opening' | 'adjustment' | 'earmark' | 'unallocated';   // equity

export interface Account extends OwnedDoc {
  code: string;                   // 'asset.cash.main' — فريد، ثابت، لا يُترجم
  name: string;                   // عربي، قابل للتعديل: «نقد المحفظة»
  nameLower: string;              // للبحث
  type: AccountType;
  subtype: AccountSubtype;
  parentId: string | null;
  ancestorIds: string[];          // مسار الأسلاف — تجميع الفروع باستعلام array-contains واحد
  depth: number;

  // ── سلوك محاسبي ──
  normalSide: Side;               // مشتق من type، مخزَّن لتسهيل القواعد والتدقيق
  isPostable: boolean;            // الترحيل على الأوراق فقط؛ الفروع للتجميع
  isCashLike: boolean;            // يدخل في «النقد المتاح» — القاعدة 19.9
  currency: 'LYD';

  /**
   * ADR-010 — الحدّ الأدنى المسموح للرصيد، **موقَّع**، افتراضي 0.
   *    0        = لا رصيد سالب إطلاقاً (النقد والمصرف).
   *   -500000   = بطاقة ائتمانية بسقف 500 د.ل، أو سحب على المكشوف بحدّ.
   *
   * **حُذف `allowNegative: boolean` من المخطط نهائياً.** البوليان يعطي خيارين فقط:
   * لا سالب إطلاقاً، أو سالب **بلا حدّ** — فبطاقة ائتمانية بسقف 500 د.ل لا تُمثَّل،
   * والنتيجة أن المستخدم يفعّل «السماح بالسالب» بلا سقف ⇒ **فقدان الحاجز كلياً**.
   * «السماح بالسالب» في الواجهة = محدِّد مشتق: `minBalanceMinor < 0`.
   */
  minBalanceMinor: number;

  // ── أرصدة مُجمَّعة (تُحدَّث داخل نفس معاملة القيد) ──
  openingBalanceMinor: number;    // مرآة القيد الافتتاحي (لا يُكتب يدوياً أبداً)
  debitTotalMinor: number;        // مجموع السطور المدينة مدى الحياة
  creditTotalMinor: number;       // مجموع السطور الدائنة مدى الحياة
  balanceMinor: number;           // المشتق المخزَّن (الصيغة في 5.2)

  /**
   * ADR-017 — مرآة مشتقة لمجموع ما حُجز من هذا الحساب لأهداف مالية.
   * تُحدَّث في **نفس معاملة** قيد التخصيص. **للتحذير فقط، لا للمنع.**
   * «المتاح للإنفاق» المعروض = balanceMinor − earmarkedMinor.
   *
   * بدون هذا الحقل، مستند الحساب **لا يعرف** أن جزءاً منه محجوز ⇒ بطاقة «الأموال المتاحة»
   * لا تستطيع عرض «المتاح بعد حجز الأهداف» دون المشي على حسابات حقوق الملكية وضمّها،
   * والمال المخصَّص لهدف يصير **قابلاً للإنفاق دون أي تحذير**.
   */
  earmarkedMinor: number;

  entryCount: number;             // عدد القيود المؤثرة — لكشف الانحراف
  balanceVersion: number;         // يزيد 1 مع كل تحديث — لكشف التحديثات المفقودة
  lastEntryId: string | null;     // يُستخدم في قاعدة getAfter (ADR-022)
  lastPostedAt: Timestamp | null;

  /**
   * نقاط تحقق تراكمية للمدقّق — **تطعيم إلزامي لا تحسين**.
   * الفاحص الكامل بدونها يقرأ **كل** قيود الحساب، وبعد ثلاث سنوات (~6000 قيد) يصير تشغيله
   * مستحيلاً على Spark. مع نقطة التحقق:
   *   computed = lastVerifiedBalanceMinor + Σ(القيود بعد lastVerifiedThroughBookedAt)
   * ⇒ الفحص الشهري يبقى بتكلفة ~200 قراءة **إلى الأبد** بدل أن ينمو خطياً.
   */
  lastVerifiedAt: Timestamp | null;
  lastVerifiedBalanceMinor: number | null;
  lastVerifiedThroughBookedAt: DateKey | null;

  // ── روابط ──
  linkedContactId?: string;       // receivable / payable / financing
  linkedCategoryId?: string;      // expenseCategory
  linkedGoalId?: string;          // earmark
  linkedIncomeSourceId?: string;

  // ── عرض وإدارة ──
  status: 'active' | 'archived';
  sortOrder: number;
  icon?: string;
  colorToken?: string;
  isSystem: boolean;              // حسابات النظام (equity.opening…) لا تُحذف ولا تُعاد تسميتها
  excludeFromNetWorth: boolean;   // لحساب تجريبي
  notes?: string;
}
```

**لماذا `debitTotalMinor` و`creditTotalMinor` معاً وليس `balanceMinor` فقط؟**

1. يعطيان **ميزان المراجعة** بقراءة الحسابات وحدها: `Σ debitTotal` يجب أن يساوي `Σ creditTotal` على كل
   الشجرة ⇒ فحص سلامة شامل بـ ~45 قراءة دون لمس القيود (I4).
2. يعطيان «حركة الحساب الإجمالية» (مدين/دائن مدى الحياة) في التقارير دون مسح القيود.
3. يجعلان العكس **عملية جمع لا طرحاً شرطياً**: العكس يزيد الجانب المقابل، فيبقى التاريخ ظاهراً في الإجماليات.

> **تصحيح إلزامي على قاعدة الأمان (العيب ع-أ-4):** القاعدة **لا تشترط تزايداً مُطلقاً** لهذين الحقلين،
> لأن ذلك يجعل مسار الإصلاح محظوراً بقاعدة النظام نفسه: خطأ طبّق أثر مصروف مرتين يحتاج **تنقيص**
> `debitTotalMinor` ⇒ ترفضه القاعدة ⇒ لا مسار إصلاح أصلاً، والبديل الوحيد قيد تسوية يُعيد التوازن
> **لكن يُبقي إجماليات المدين/الدائن مدى الحياة خاطئة للأبد** — وهي بالضبط الأرقام التي بُرِّر تخزينها
> بأنها تعطي حركة الحساب في التقارير. الشرط الصحيح: التناقص مسموح **فقط** عندما
> `meta/integrity.rebuildStatus == 'running'`. التفصيل في 14.3.

### 4.3 `JournalEntry` و `JournalLine`

المسار: `users/{uid}/journalEntries/{entryId}` — **السطور مُضمَّنة في المستند**.

```ts
export type EntryKind =
  | 'expense'            // مصروف حقيقي
  | 'income'             // دخل حقيقي مستلم
  | 'transfer'           // تحويل بين حسابين (ليس دخلاً ولا مصروفاً) — 19.3
  | 'borrow'             // استلام قرض: نقد ↑ وخصوم ↑ (ليس دخلاً) — 19.6
  | 'debtRepayment'      // سداد دين عليّ: خصوم ↓ ونقد ↓ (ليس مصروفاً) — 19.8
  | 'lend'               // إقراض: مستحق لي ↑ ونقد ↓ (ليس مصروفاً)
  | 'debtCollection'     // تحصيل: نقد ↑ ومستحق لي ↓ (ليس دخلاً) — 19.7
  | 'debtWriteOff'       // شطب مستحق: مصروف ديون معدومة ↑ ومستحق لي ↓
  | 'obligationPayment'  // دفع التزام — 19.5
  | 'opening'            // رصيد افتتاحي
  | 'adjustment'         // تسوية مبرَّرة — القسم 5
  | 'earmark'            // تخصيص لهدف (داخل حقوق الملكية، لا يمس النقد)
  | 'zakatAccrual'       // احتساب زكاة مستحقة دون دفع — 15.4
  | 'reversal';          // عكس قيد سابق

/** 'posted' = ساري. 'reversed' = أُلغي بعكس. 'replaced' = استُبدل بتعديل. */
export type EntryStatus = 'posted' | 'reversed' | 'replaced';

export interface JournalLine {
  lineNo: number;                 // 1-based، ثابت إلى الأبد
  accountId: string;
  accountType: AccountType;       // مكرَّر عن قصد: تصنيف التقرير دون قراءة الحسابات
  accountCode: string;            // مكرَّر للعرض والتصدير دون انضمام
  side: Side;
  amountMinor: number;            // **موجب دائماً** — لا سطر بمبلغ سالب أو صفر
  categoryId?: string;
  contactId?: string;
  memo?: string;
}

export interface EntryRefs {
  obligationId?: string;
  obligationInstallmentIndex?: number;
  debtId?: string;
  debtDirection?: 'payable' | 'receivable';
  goalId?: string;
  recurrenceId?: string;
  recurrenceOccurrenceKey?: DateKey;
  incomeScheduleId?: string;
  transferPairKey?: string;
  zakatRecordId?: string;
  taskId?: string;
  noteId?: string;
}

export interface JournalEntry extends OwnedDoc {
  /** = opId، أو `${opId}__${k}` للعمليات متعددة القيود */
  id: string;
  opId: string;                   // مفتاح منع الازدواج — القسم 6
  payloadHash: string;            // SHA-256 للحمولة المُقنَّنة — كشف تعارض نفس opId بحمولة مختلفة
  kind: EntryKind;
  status: EntryStatus;

  bookedAt: DateKey;              // **التاريخ المحاسبي** بتوقيت المستخدم المحلي — غير قابل للتغيير
  bookedAtTs: Timestamp;          // منتصف نهار UTC لذلك اليوم — للترتيب والنطاقات فقط
  periodKey: PeriodKey;           // ADR-008: == bookedAt.slice(0,7) دائماً، مفروض في القواعد
  valueDate?: DateKey;            // تاريخ القيمة المصرفي إن اختلف

  description: string;            // عربي، إلزامي غير فارغ، ≤ 500 حرفاً
  lines: JournalLine[];           // الطول 2..50
  accountIds: string[];           // مشتق من lines — للاستعلام array-contains
  accountTypes: AccountType[];    // مشتق، مميَّز — لتصفية التقارير
  totalDebitMinor: number;        // **حقل قياسي في أعلى المستند** ⇒ sum() الخادمي يعمل عليه
  totalCreditMinor: number;       // == totalDebitMinor دائماً (I1)
  amountMinor: number;            // «قيمة العملية» للعرض = totalDebitMinor
  currency: 'LYD';

  tags: string[];                 // 'household' | 'personal' | وسوم المستخدم
  refs: EntryRefs;
  attachmentIds?: string[];       // مؤجَّل (ق-1) — الحقل موجود، الواجهة معطَّلة

  // ── سلسلة التصحيح — القسم 8 ──
  reversesEntryId?: string;
  reversedByEntryId?: string;
  replacedByEntryId?: string;
  replacesEntryId?: string;
  correctionGroupId?: string;
  correctionReason?: string;      // إلزامي عند العكس أو التعديل
  /** هل هذا قيد عكس لفترة **مُقفلة**؟ يوجّه المُسقِط إلى حقول تصحيح الفترات السابقة. */
  isPriorPeriodCorrection?: boolean;

  createdBy: string;              // uid
  deviceId?: string;              // لتشخيص تزامن الأجهزة
  clientCreatedAt: string;        // ISO من الجهاز — للتدقيق لا للترتيب
}
```

**لماذا السطور مُضمَّنة؟**

| المعيار | مُضمَّنة (المختار) | مجموعة فرعية |
|---|---|---|
| ذرّية القيد | **مضمونة بالبنية**: القيد يُكتب كاملاً أو لا يُكتب | تحتاج نجاح N كتابات |
| «القيد اليتيم» (سطر بلا قيد أو قيد بلا سطور) | **مستحيل بنيوياً** | ممكن عند فشل جزئي |
| كتابات المصروف البسيط | 1 | 3 |
| `sum()` على مبالغ السطور | غير ممكن داخل المصفوفة | ممكن |

**وهنا الحسم:** الخسارة الوحيدة (`sum()` داخل المصفوفة) **لا تُدفع**، لأننا نكتب `postings` المسطَّحة في
**نفس المعاملة** (4.4). فنحصل على ذرّية التضمين **و** التجميع الخادمي معاً.
وكذلك `totalDebitMinor` و`totalCreditMinor` **حقلان قياسيان في أعلى المستند لا داخل `lines`** ⇒
`getAggregateFromServer(query, { s: sum('totalDebitMinor') })` **يعمل على Spark بقراءتين**.
أي ادّعاء بأنه «لا مجموع خادمي للمبالغ في هذا التصميم» **غير دقيق ومرفوض في هذه الوثيقة**.

### 4.4 `Posting` — الإسقاط المسطَّح (من الإصدار الأول)

المسار: `users/{uid}/postings/{entryId}__{lineNo}`

```ts
/**
 * ADR-002 — تُكتب في **نفس معاملة** القيد، من الإصدار الأول وليس كترقية مؤجلة.
 *
 * **لماذا الآن ولماذا ليس «إن تجاوز الاستخدام 20,000 قيد»:** إضافتها لاحقاً تعني backfill
 * لعشرين ألف مستند — أي بالضبط «الترحيل الذي يكسر البيانات» الذي تتجنبه هذه الوثيقة كلها.
 * التكلفة المقيسة: 7 كتابات ← 9 لكل مصروف، أي 0.045% من حصة Spark اليومية.
 * المكسب: كل تقرير متقدم مستقبلي يصير تجميعاً خادمياً بقراءتين بدل تنزيل قيود السنة.
 */
export interface Posting {
  id: string;                     // `${entryId}__${lineNo}`
  ownerUid: string;
  schemaVersion: number;
  entryId: string;
  lineNo: number;

  accountId: string;
  accountType: AccountType;
  accountCode: string;
  isCashLike: boolean;
  side: Side;

  /** موجب دائماً — مبلغ السطر كما هو. */
  amountMinor: number;

  /**
   * **المفتاح كله.** موقَّع وفق الاتجاه الطبيعي للحساب:
   *   signedAmountMinor = amountMinor × lineSign(accountType, side)
   *
   * فيكون `sum(signedAmountMinor)` صحيحاً **بما فيه قيود العكس** باستعلام واحد بلا GROUP BY،
   * لأن العكس يقلب الجانب ⇒ تنقلب الإشارة ⇒ يتصافر المجموع تلقائياً.
   * (مبلغ موجب دائماً مع حقل اتجاه منفصل يحتاج استعلامين مطروحين — وهذا ما نتجنبه.)
   */
  signedAmountMinor: number;

  /**
   * ADR-021 — الأثر على الكيان المرجعي. غير صفري **فقط** على الرجل التي تمثّل مبلغ التسوية:
   *   obligationPayment  ⇒ رجل النقد (الدائنة على حساب الأصل)
   *   debtRepayment      ⇒ رجل الخصم (المدينة على حساب الخصوم)
   *   debtCollection     ⇒ رجل المستحق (الدائنة على حساب المستحق)
   * موقَّع بحيث:
   *   Σ settlementDeltaMinor على كل postings بنفس obligationId  ===  obligation.paidMinor
   *   Σ settlementDeltaMinor على كل postings بنفس debtId        ===  debt.settledMinor
   * وسالب تلقائياً في قيد العكس لأن الجانب انقلب ⇒ **لا حاجة لأي تصفية بالحالة**.
   * صفر على كل السطور الأخرى.
   * ⇒ التحقق من paidMinor/settledMinor يصير **تجميعاً خادمياً بقراءتين** (I5b و I6b).
   */
  settlementDeltaMinor: number;

  categoryId: string | null;
  contactId: string | null;
  obligationId: string | null;
  debtId: string | null;
  goalId: string | null;

  periodKey: PeriodKey;
  bookedAt: DateKey;              // 'YYYY-MM-DD'
  bookedAtTs: Timestamp;
  tags: string[];
  entryKind: EntryKind;
  /** لقطة حالة القيد عند الكتابة. **لا تُحدَّث** عند العكس — للعكس postings خاصة تُصافر الأصل. */
  entryStatus: EntryStatus;
  createdAt: Timestamp;
}
```

**قاعدة صلبة:** `postings` **لا تُحذف ولا تُعدَّل أبداً** (مثل القيود). أي تصحيح يأتي بـ postings جديدة.

### 4.5 `Obligation`

المسار: `users/{uid}/obligations/{obligationId}`

```ts
/**
 * ADR-011 — أخطر تمييز في النظام كله، وأعلى أولوية في التطعيم.
 *
 * 'expense'   : إيجار، كهرباء، إنترنت، اشتراك ⇒ الدفع مصروف حقيقي يستهلك الميزانية.
 * 'financing' : قسط سيارة، قسط قرض ⇒ الدفع **ليس مصروفاً**: الرجل المقابلة حساب خصوم،
 *               و`budgetPeriods` **لا تُلمس**.
 *
 * بدون هذا الحقل يُرحَّل كل دفع التزام `Dr expense.{categoryId}` ⇒ قسط السيارة يُسجَّل **مصروفاً**
 * ⇒ يتضخم «مصروفات الشهر» وتُستهلك الميزانية **بأصل دين** — وهو بالضبط ما تحذّر منه القاعدة 19.11.
 * والقول بأن «الدين الحقيقي ينتمي إلى debts» لا يصمد: المستخدم **سيُنشئ** «قسط السيارة»
 * التزاماً دورياً لأن له تاريخ استحقاق وتكراراً.
 * التمييز هنا **بنيوي (نوع الحساب المقابل) لا شرطي**.
 */
export type ObligationNature = 'expense' | 'financing';

export type ObligationStatus =
  | 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';

export interface Obligation extends OwnedDoc {
  name: string;                       // «إيجار المنزل»
  nature: ObligationNature;           // ADR-011
  payeeContactId?: string;
  categoryId: string;                 // nature='expense' ⇒ يحدد حساب المصروف عند الدفع
  /** nature='financing' ⇒ حساب الخصم المقابل (يُنشأ تلقائياً عند أول دفعة). */
  financingAccountId?: string;

  /** القيمة الأصلية المتعاقد عليها. **لا تُرفع أبداً** لاستيعاب تجاوز — ADR-012. */
  totalMinor: number;
  /**
   * ADR-012 — غرامات التأخير والزيادة في الفواتير المتغيرة.
   *   due = totalMinor + extraChargesMinor − paidMinor
   *
   * البديل المرفوض (رفع `totalMinor` إلى المبلغ الفعلي عند إقرار المستخدم) **يُتلف القيمة الأصلية
   * المتعاقد عليها إلى الأبد** ولا يبقى منها إلا سجل تدقيق، ويجعل تاريخ الالتزام غير قابل للقراءة،
   * ويُخفي الغرامة كبند مستقل في التقرير.
   */
  extraChargesMinor: number;
  extraChargesReason?: string;        // إلزامي عند أي زيادة > 0
  isVariableAmount: boolean;          // فواتير متغيرة (كهرباء/ماء)

  paidMinor: number;                  // ← تُحدَّث في المعاملة بقيمة مطلقة محسوبة
  /** مشتق مخزَّن: == totalMinor + extraChargesMinor − paidMinor (I5، مفروض في القواعد) */
  remainingMinor: number;
  paymentCount: number;
  lastPaymentEntryId: string | null;

  dueDate: DateKey;
  /** معرّف قالب التكرار الذي ولّد هذه الدورة — ADR-013. */
  recurrenceId?: string;
  occurrenceKey?: DateKey;            // تاريخ استحقاق الدورة — يُشكّل المفتاح الحتمي
  installments?: Installment[];
  priority: 1 | 2 | 3;
  status: ObligationStatus;           // مخزَّنة للفهرسة، ومحسوبة دائماً بدالة 10.2
  statusComputedFor: DateKey;
  notes?: string;
  attachmentIds?: string[];
}
```

**لا مصفوفة `paymentEventIds` ولا مجموعة `obligationPayments`** (ADR-005). سجل الدفعات =
`journalEntries where refs.obligationId == id order by bookedAtTs` بفهرس قائم.
المصفوفة بحدّ «≤ 50 ثم ترحيل إلى مجموعة فرعية» **مرفوضة**: التزام بأقساط 60 شهراً (قسط سيارة — وهو
مثال القسم 8 نفسه) يصطدم بالحد في منتصف عمره، والترحيل غير محدَّد، و`arrayUnion` ينمّي مستنداً تقرؤه
لوحة التحكم مع كل دفعة، **ولا يقابله `arrayRemove` عند العكس** فيفقد الطول مطابقته لعدد الدفعات.

### 4.6 `Debt`

المسار: `users/{uid}/debts/{debtId}` — الاتجاهان في مجموعة واحدة (القسمان 9 و10).

```ts
export type DebtStatus = 'open' | 'partiallySettled' | 'settled' | 'writtenOff' | 'cancelled';

export interface Debt extends OwnedDoc {
  direction: 'payable' | 'receivable';   // payable = عليّ (§9) | receivable = لي (§10)
  counterpartyContactId: string;
  counterpartyName: string;              // لقطة للعرض والتصدير
  counterpartyPhone?: string;            // §10
  /** حساب الخصم/المستحق المقابل في الشجرة (1:1 مع الدين). */
  accountId: string;

  principalMinor: number;                // قيمة الدين الأصلية
  settledMinor: number;                  // المسدَّد (payable) أو المحصَّل (receivable)
  /** مشتق مخزَّن: == principalMinor − settledMinor − writtenOffMinor (I6، مفروض في القواعد) */
  remainingMinor: number;
  writtenOffMinor: number;               // ما شُطب (receivable فقط)

  originatedAt: DateKey;
  expectedSettleAt?: DateKey;
  /** هل نشأ بحركة نقدية فعلية؟ يحدد شكل قيد النشوء (R6). */
  createdCash: boolean;
  installments?: Installment[];
  settlementCount: number;
  lastSettlementEntryId: string | null;
  status: DebtStatus;
  /** ثابت: **ممنوع** السداد/التحصيل الزائد. لا يُفعَّل بأي حال (8.3 القاعدة 2). */
  allowOverSettle: false;
  notes?: string;
  attachmentIds?: string[];
}
```

**سجل المتابعات (القسم 10):** مجموعة فرعية `debts/{id}/followUps/{autoId}` لا مصفوفة مضمَّنة —
لأن المتابعات تنمو بلا سقف معروف وتُقرأ في شاشة واحدة فقط.

### 4.7 المُجمَّعات الزمنية

```ts
// users/{uid}/accountPeriods/{accountId}__{periodKey}
/**
 * ADR-009 — **حركة فقط. لا أرصدة مخزونية (stock).**
 *
 * **لماذا حُذف openingBalanceMinor/closingBalanceMinor نهائياً — عيب قاتل معالَج:**
 * لقطة رصيد لكل (حساب، فترة) تنكسر مع أي قيد بتاريخ ماضٍ، وهي حالة مشروعة متكررة (فاتورة متأخرة).
 * السيناريو: في 2026-10-03 تُكتب لقطة `acc_cash__2026-10.opening = 340.000`. في 2026-10-20 يُدخل
 * المستخدم مصروف وقود منسياً بتاريخ 2026-09-28 بقيمة 60.000 (مسموح: سبتمبر غير مُقفل).
 * المعاملة تمسّ فترة سبتمبر فقط ⇒ `opening(أكتوبر) ≠ closing(سبتمبر)` بفارق 60.000،
 * **وكل شهر بعده يرث الفارق** ⇒ مخطط «اتجاه رصيد الحساب» وكل تقرير «رصيد بداية/نهاية الفترة»
 * خاطئ نهائياً. والقاتل في العيب: `accounts.balanceMinor` سليم وميزان المراجعة **متوازن تماماً**،
 * ففاحص الاتساق يُبلّغ «سليم» فوق تقارير تاريخية تالفة. ولا ثابت في القائمة يكشفه.
 * (وتزيده سوءاً كتابة `openingBalanceMinor: 0` داخل `set(..., {merge:true})` بتعليق
 *  «موجود مسبقاً، لا يُلمس» — والدمج **يكتب الحقل فعلاً ويُصفّر اللقطة القائمة**.)
 *
 * الحل المعتمد: الحركة وحدها تُخزَّن، والمخزون **يُشتقّ تراكمياً**:
 *   closing(acc, P) = acc.openingBalanceMinor + Σ_{p ≤ P} netMinor(acc, p)
 *   opening(acc, P) = closing(acc, P−1)
 * ⇒ القيد بتاريخ ماضٍ يصحّح **كل** الأشهر اللاحقة تلقائياً بلا أي كتابة إضافية وبلا أي إبطال لقطات.
 * التكلفة: مخطط اتجاه الرصيد يقرأ 12 مستند `accountPeriods` ويجمعها تراكمياً في العميل — رخيص.
 */
export interface AccountPeriod {
  id: string;                       // `${accountId}__${periodKey}`
  ownerUid: string; schemaVersion: number;
  accountId: string;
  accountType: AccountType;
  periodKey: PeriodKey;
  debitMinor: number;               // حركة الفترة مدين
  creditMinor: number;              // حركة الفترة دائن
  /** = (debitMinor − creditMinor) × (normalSide === 'debit' ? 1 : −1) — مشتق مخزَّن للراحة */
  netMinor: number;
  entryCount: number;
  updatedAt: Timestamp;
}

// users/{uid}/periods/{periodKey}  — المُجمَّع الذي تقرأه لوحة التحكم والتقرير الشهري
export interface PeriodSummary {
  id: PeriodKey;
  ownerUid: string; schemaVersion: number;
  periodKey: PeriodKey;

  // ── نشاط الفترة ──
  totalIncomeMinor: number;         // من سطور حسابات income فقط
  totalExpenseMinor: number;        // من سطور حسابات expense فقط
  expenseByCategory: Record<string, number>;   // categoryId → Minor
  incomeBySource: Record<string, number>;
  householdExpenseMinor: number;    // القيود الموسومة household — **مجموع فرعي لا إضافة**
  transferVolumeMinor: number;      // حجم التحويلات (للرقابة، لا يدخل الدخل/المصروف)
  borrowedMinor: number; repaidMinor: number;
  lentMinor: number; collectedMinor: number;
  obligationPaidMinor: number;      // يزيد في nature='expense' و'financing' **معاً**
  financingPaidMinor: number;       // الجزء التمويلي وحده (لا يدخل المصروف إطلاقاً)

  /**
   * معالجة عيب قاتل — تصحيحات فترات **سابقة مُقفلة** هبطت في هذه الفترة.
   * دلتا **موقَّعة** (سالبة لعكس مصروف). **لا تُخلط** مع نشاط الفترة.
   *
   * بدون هذين الحقلين: عكس مصروف 500.000 من فترة مُقفلة يخفض `totalExpenseMinor` للشهر الجاري
   * ⇒ «مصروفات هذا الشهر» مشوَّهة (وقد تصير **سالبة**: مصروفات أكتوبر 200.000 وعكس 500.000
   * ⇒ −300.000 معروضة في لوحة التحكم) ونسبة استهلاك الميزانية سالبة، بلا أي أثر مرئي للسبب.
   *
   * **قاعدة عرض إلزامية:** التقرير الشهري يعرض **سطرين منفصلين**:
   *   «نشاط الفترة»  و  «تصحيحات فترات سابقة».
   * **و`budgetPeriods` لا تُلمس إطلاقاً** في تصحيح فترة مُقفلة.
   */
  priorPeriodExpenseCorrectionMinor: number;
  priorPeriodIncomeCorrectionMinor: number;

  /**
   * الثابت I9 — يحفظ معادلة التدفق النقدي سليمة مع وجود التصحيحات:
   * netCashFlowMinor === totalIncomeMinor − totalExpenseMinor
   *                      + priorPeriodIncomeCorrectionMinor − priorPeriodExpenseCorrectionMinor
   */
  netCashFlowMinor: number;

  entryCount: number;
  firstEntryAt: DateKey; lastEntryAt: DateKey;
  updatedAt: Timestamp;
}

// users/{uid}/budgetPeriods/{periodKey}  — القسم 12
export interface BudgetPeriod {
  id: PeriodKey;
  ownerUid: string; schemaVersion: number;
  periodKey: PeriodKey;
  /** null = لا ميزانية عامة لهذا الشهر. */
  overallLimitMinor: number | null;
  overallSpentMinor: number;
  categories: Record<string, {           // مفتاحها categoryId
    limitMinor: number;
    spentMinor: number;
    alertAtPercent: number;              // 80 افتراضياً
    alertFiredAtPercent: number | null;  // منع تكرار التنبيه — القسم 17
  }>;
  updatedAt: Timestamp;
}
```

> **قاعدة صلبة على `budgetPeriods` (معالجة عيب قاتل):** **يُحرَّم** إنشاء مستند ميزانية بـ
> `set(..., {merge:true})` مع `increment` لشهر لم يضع له المستخدم ميزانية. السبب: ينتج مستند
> **بلا `overallLimitMinor` وبلا `categories[cat].limitMinor`** ⇒ بطاقة «نسبة استهلاك الميزانية»
> تقسم على سقف غير موجود. القاعدة: إن لم يوجد المستند أو لم توجد الفئة فيه ⇒ **لا كتابة ميزانية
> إطلاقاً** (الكتابة السابعة تُحذف من المعاملة)، وشاشة الميزانية تعرض «لم تُحدَّد ميزانية لهذا الشهر».
> و`spentMinor` **لا يُكتب بـ `increment` أعمى** لأن تنبيه التجاوز يقرأ النتيجة (جدول 5.4).

```ts
// users/{uid}/periodLocks/{periodKey}
export interface PeriodLock {
  id: PeriodKey;
  ownerUid: string;
  lockedAt: Timestamp; lockedBy: string; reason: string;
}
```

### 4.8 الأهداف المالية

```ts
// users/{uid}/financialGoals/{goalId}
export interface FinancialGoal extends OwnedDoc {
  name: string;
  targetMinor: number;
  /**
   * 'backedAccount'  : مال محوَّل فعلاً إلى حساب توفير. التقدم = رصيد الحساب. **لا قيد خاص**.
   * 'virtualEarmark' : «تخصيص دفتري» دون نقل نقد.
   *                    القيد: Dr equity.unallocated / Cr equity.earmark.goal.{id}
   *                    **لا يمس الأصول ولا الخصوم** ⇒ إجمالي الأموال المتاحة لا يتغير
   *                    (صحيح محاسبياً وصادق مع المستخدم)،
   *                    **ويُحدَّث `account.earmarkedMinor` في نفس المعاملة** للتحذير (ADR-017).
   */
  mode: 'backedAccount' | 'virtualEarmark';
  backingAccountId?: string;
  earmarkAccountId?: string;             // equity.earmark.goal.{id}
  /** mode='virtualEarmark': الحساب النقدي الذي يُحتسب عليه الحجز (مرآة earmarkedMinor). */
  earmarkSourceAccountId?: string;
  savedMinor: number;                    // مشتق مخزَّن
  targetDate?: DateKey;
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
}
```

**تنبيه واجهة إلزامي في وضع `virtualEarmark`:** «مخصص دفترياً، والمال لا يزال في حسابك».

### 4.9 التكرار — قالب لا دورة

```ts
// users/{uid}/recurrences/{recurrenceId}
/**
 * ADR-013 — **قالب التكرار هو مصدر الدورات، لا معاملة الدفع.** هذا يحسم عيبين قاتلين:
 *
 * (1) ربط «توليد الدورة التالية» باكتمال السداد (`remainingAfter === 0`) يعني أن إيجاراً شهرياً
 *     800.000 سُدِّد منه 700.000 ثم توقف المستخدم ⇒ **دورة الشهر التالي لا تُنشأ أبداً**،
 *     فتخلو لوحة التحكم من «إيجار نوفمبر» في «الالتزامات القادمة» ولا يصدر أي تنبيه استحقاق —
 *     مع أن الالتزام الدوري قائم فعلاً. والقسم 8 يطلب تنبيهات قبل الاستحقاق وفي يومه وبعد التأخر:
 *     السيناريو يُسقطها **كلها**.
 * (2) إنشاء الدورة داخل معاملة الدفع يجعل **عكس** تلك الدفعة يتركها قائمة ⇒ «الالتزامات
 *     القادمة/المتأخرة» تعرض الإيجار **مرتين** و«إجمالي الالتزامات المستحقة» متضخم 800.000.
 *
 * ⇒ «توليد الدورة» مفصول عن «اكتمال السداد» ومربوط **بالتقويم**، بمعرّف حتمي
 *   `obl:{recurrenceId}:{dueDate}` يُولِّده **مُشغِّل الاستدراك** عند فتح التطبيق (ق-1).
 */
export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurrenceRule extends OwnedDoc {
  kind: 'expense' | 'income' | 'obligation';
  name: string;
  frequency: Frequency;
  interval: number;                      // كل n وحدة (افتراضي 1)
  startDate: DateKey;
  endDate?: DateKey;
  maxOccurrences?: number;
  dayOfMonthPolicy: 'clampToEndOfMonth' | 'exact';
  /** حمولة العملية/الالتزام المُولَّد (بلا opId ولا تاريخ — يُحسبان من الدورة). */
  template: Record<string, unknown>;
  /** آخر دورة مادّية فعلاً. **للعرض والتشخيص فقط** — المادّية تعتمد المعرّف الحتمي لا هذا الحقل. */
  lastMaterializedKey: DateKey | null;
  status: 'active' | 'paused' | 'ended';
}
```

### 4.10 مستندات التحكم والتدقيق

```ts
// users/{uid}/operations/{opId}  — للعمليات التي تولّد أكثر من قيد واحد فقط
export type OperationKind =
  | 'recordExpense' | 'recordIncome' | 'transfer' | 'payObligation'
  | 'createObligation' | 'createDebt' | 'payDebt' | 'collectDebt' | 'writeOffDebt'
  | 'setOpeningBalance' | 'adjustAccount' | 'voidTransaction' | 'editTransaction'
  | 'earmarkToGoal' | 'materializeRecurring' | 'importBatch'
  | 'accrueZakat' | 'payZakat' | 'rebuildProjections';

export interface OperationRecord {
  id: string;                      // = opId
  ownerUid: string; schemaVersion: number;
  kind: OperationKind;
  /** **لا حالة 'pending'**: المعاملة ذرّية فلا حالة وسطى محتملة، ووجودها يعني وهماً بأمان. */
  status: 'committed' | 'compensated';
  payloadHash: string;
  entryIds: string[];
  touchedDocIds: string[];
  resultSummary: Record<string, number | string>;
  createdAt: Timestamp;
  clientCreatedAt: string;
  deviceId?: string;
}

// users/{uid}/entryCorrections/{originalEntryId}
/**
 * ADR-014 — قفل التصحيح. **وجود المستند** يعني «هذا القيد صُحِّح أو أُلغي»،
 * ومعرّفه هو معرّف القيد الأصلي ⇒ «مرة واحدة فقط» شرط **ذرّي مفروض من قاعدة البيانات**
 * بمفتاح فريد، لا من المنطق.
 *
 * يحل محل المفتاح `amd:{entryId}:{amendCount}` غير الآمن تحت التزامن: جهازان يقرآن
 * `amendCount = 0` فيولّدان **نفس** `opId` لحمولتين **مختلفتين** ⇒ يُرفض الثاني بـ
 * `OP_ID_CONFLICT` برسالة «هذه العملية سُجّلت بمحتوى مختلف» — وهي **رسالة خاطئة دلالياً**
 * ومحيّرة لتعديل مشروع من جهاز آخر. مع القفل، الجهاز الثاني يحصل على الرسالة الصحيحة:
 * «صُحِّح هذا القيد من جهاز آخر — اعرض النسخة الحديثة».
 *
 * التعديل الثاني المشروع يستهدف **القيد البديل** ⇒ قفل جديد بمعرّفه ⇒ سلسلة نظيفة بلا عدّاد.
 */
export interface EntryCorrection {
  id: string;                      // = originalEntryId
  ownerUid: string; schemaVersion: number;
  reversalEntryId: string;         // قيد العكس
  replacedByEntryId: string | null;// القيد البديل (null في الإلغاء المحض)
  reason: string;                  // إلزامي، 5..500 حرفاً
  correctionGroupId: string;
  at: Timestamp; by: string; deviceId?: string;
}

// users/{uid}/meta/integrity  — **يُنشأ في التهيئة إلزامياً**
export interface IntegrityMeta {
  id: 'integrity';
  ownerUid: string; schemaVersion: number;
  projectionVersion: number;             // يزيد 1 مع كل إعادة بناء ناجحة
  rebuildStatus: 'idle' | 'running' | 'failed';
  rebuildCursor: { lastCreatedAt: string; lastEntryId: string } | null;
  rebuildStartedAt: Timestamp | null;
  lastReconciledAt: Timestamp | null;
  lastReconciledDebitMinor: number | null;   // بصمة الدفتر عند آخر تسوية ناجحة
  lastReconciledEntryCount: number | null;
  updatedAt: Timestamp;
}
```

> **`meta/integrity` ليس مستنداً ساخناً** (ADR-016). لا يُكتب مع كل عملية مالية إطلاقاً.
> يُكتب فقط عند: التهيئة، إعادة البناء، والتسوية الناجحة. البصمة تُحسب **عند الطلب** بـ
> `getAggregateFromServer(sum('totalDebitMinor'))` بقراءتين، بلا كتابة سادسة لكل مصروف
> وبلا نقطة تنازع واحدة على المسار الساخن.

```ts
// users/{uid}/meta/schema
export interface SchemaMeta {
  id: 'schema';
  currentVersion: number;
  appliedMigrations: string[];
  updatedAt: Timestamp;
}

// users/{uid}/auditLogs/{autoId}  — غير قابل للتعديل أو الحذف
export interface AuditLogEntry {
  id: string; ownerUid: string; schemaVersion: number;
  action:
    | 'entryReversed' | 'entryAmended' | 'descriptiveEditOnPostedEntry'
    | 'accountCreated' | 'accountArchived' | 'minBalanceChanged'
    | 'openingBalanceSet' | 'balanceAdjusted'
    | 'extraChargesAdded' | 'obligationCancelled'
    | 'debtWrittenOff' | 'periodLocked'
    | 'projectionsRebuilt' | 'migrationApplied' | 'dataExported';
  targetCollection: string; targetId: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
  reason?: string; opId?: string;
  at: Timestamp; by: string; deviceId?: string;
}
```

**قرار مبرَّر (انحراف موثَّق عن القسم 18 بند 9):** لا نكتب `auditLogs` لكل عملية مالية، لأن **دفتر
القيود نفسه سجل تدقيق كامل**: غير قابل للتغيير، مُرقَّم بالوقت، له `createdBy` و`deviceId`
و`payloadHash` و`clientCreatedAt`. `auditLogs` مقصور على ما **لا يمرّ** عبر القيود: التصحيحات،
والرسوم الإضافية، والموافقات الاستثنائية، وإصلاح الأرصدة، وأرشفة الحسابات، وتغيير `minBalanceMinor`.

```ts
// users/{uid}/pendingCommands/{opId}  — ADR-007
/**
 * الطابور الدائم للعمليات المُنشأة دون اتصال. يُكتب بـ `setDoc` (يُطابَر محلياً ويُرسَل
 * تلقائياً عند عودة الاتصال، بخلاف `runTransaction` الذي **يفشل** دون اتصال).
 *
 * **الفائدة الحقيقية مقابل طابور محلي فقط:** صندوق IndexedDB محلي للجهاز ⇒ عملية سُجّلت دون
 * اتصال على هاتف ضاع أو مُسح متصفحه = **ضائعة بلا أثر**. في Firestore تبقى مرئية وقابلة للتنفيذ
 * من أي جهاز، وبنفس `opId` فلا ازدواج مهما تعدّد المُفرِّغ.
 *
 * **حدّ الصدق المطلوب إعلانه للمالك:** العملية تصبح محفوظة فقط **بعد** وصول مستند الطابور إلى
 * الخادم. جهاز ضاع قبل أي عودة للاتصال = العملية ضائعة في كل الأحوال. لا نوهم المستخدم بغير ذلك.
 *
 * **الشرط الصريح غير القابل للتفاوض:** مستبعدة تماماً من **كل** رصيد و**كل** تقرير و**كل** مُجمَّع،
 * ومعروضة بوسم بصري مختلف «بانتظار المزامنة» — القسم 22 والقسم 25 بند 4.
 * لا «رصيد متوقع» مختلط بالرصيد الحقيقي.
 */
export interface PendingCommand {
  id: string;                      // = opId النهائي نفسه
  ownerUid: string; schemaVersion: number;
  kind: OperationKind;
  payload: Record<string, unknown>;
  payloadHash: string;
  status: 'queued' | 'applied' | 'rejected';
  rejectionCode?: DomainErrorCode;
  rejectionMessageAr?: string;
  attemptCount: number;
  createdAtClient: string;         // ISO
  createdAt: Timestamp;            // serverTimestamp عند الوصول
  deviceId?: string;
}
```

---

## 5. الأرصدة والمُجمَّعات

### 5.1 القرار

**مُجمَّع مخزَّن (stored aggregate) يُحدَّث داخل نفس معاملة ترحيل القيد** — لا حساب عند القراءة.
وبجانبه: حركة شهرية لكل حساب (`accountPeriods`)، ومُجمَّع شهري عام (`periods`)، وميزانيات
(`budgetPeriods`)، و**إسقاط مسطَّح** (`postings`) يفتح التجميع الخادمي.

**لماذا لا نحسب عند القراءة؟**

| السبب | التفصيل |
|---|---|
| التكلفة | الرصيد المحسوب = قراءة كل قيود الحساب. بعد سنتين (~3000 قيد) = 3000 قراءة لفتح لوحة التحكم **مرة واحدة**. على Spark (50,000 قراءة/يوم) = **16 فتحة فقط يومياً**. مرفوض |
| الزمن | القسم 4 يطلب «ملخص حي ومباشر». 6–10 مستندات حسابات عبر `onSnapshot` = مللي ثوانٍ |
| الاتساق | المُجمَّع يُحدَّث ذرّياً مع القيد ⇒ لا نافذة يرى فيها المستخدم قيداً دون أثره |

**الثمن المقبول:** احتمال **الانحراف** إن أُضيف قيد خارج المسار الواحد. يُعالَج بثلاث طبقات:
مسار كتابة وحيد (`postOperation`) + قواعد أمان + فاحص دوري ومسار إعادة بناء كامل (قسم 16).

### 5.2 الصيغة الدقيقة

```ts
// domain/ledger/balances.ts

/** رصيد الحساب في اتجاهه الطبيعي. صحيح × صحيح → صحيح. */
export function accountBalanceMinor(
  a: Pick<Account, 'type' | 'debitTotalMinor' | 'creditTotalMinor'>
): Minor {
  const raw = a.debitTotalMinor - a.creditTotalMinor;
  return (normalSideOf(a.type) === 'debit' ? raw : -raw) as Minor;
}

/** «المتاح للإنفاق» — ADR-017. للعرض والتحذير، لا للمنع. */
export function spendableMinor(a: Account): Minor {
  return (a.balanceMinor - a.earmarkedMinor) as Minor;
}

/** رصيد نهاية فترة — **مشتق تراكمياً** لا مخزَّن (ADR-009). */
export function closingBalanceAt(
  account: Pick<Account, 'openingBalanceMinor'>,
  periodsAsc: readonly AccountPeriod[],     // مرتَّبة بـ periodKey تصاعدياً، حتى الفترة المطلوبة
): Minor {
  return (account.openingBalanceMinor
          + periodsAsc.reduce((s, p) => s + p.netMinor, 0)) as Minor;
}

/** أثر قيد واحد على حساب واحد. تُستدعى داخل المعاملة فقط. */
export interface AccountDelta { debitMinor: Minor; creditMinor: Minor; }
export function deltaForAccount(entry: JournalEntry, accountId: string): AccountDelta;
```

### 5.3 المحدِّدات — من أين تقرأ الواجهة بالضبط

**لا شاشة بلا مصدر بيانات محدَّد** (القسم 25 بند 5):

| ما يُعرض | المصدر | قراءات |
|---|---|---|
| رصيد كل حساب | `accounts` عبر `onSnapshot` على المجموعة | ~45 مرة واحدة في الجلسة، ثم دلتا |
| «إجمالي الأموال المتاحة» | محدِّد: `Σ balanceMinor` للحسابات `isCashLike && active && isPostable` | 0 إضافية |
| «المتاح بعد حجز الأهداف» | `Σ (balanceMinor − earmarkedMinor)` لنفس المجموعة | 0 |
| «إجمالي المستحق لي» | `Σ` حسابات `subtype === 'receivable'` | 0 |
| «إجمالي الديون عليّ» | `Σ` حسابات `subtype ∈ {payable, financing}` | 0 |
| «صافي الثروة» | الأصول (بما فيها المستحق) − الخصوم، باستثناء `excludeFromNetWorth` | 0 |
| دخل/مصروف الشهر، المصروف حسب الفئة، مصاريف المنزل | `periods/{currentPk}` | 1 |
| «تصحيحات فترات سابقة» (سطر منفصل) | `periods/{currentPk}.priorPeriod*CorrectionMinor` | 0 |
| نسبة استهلاك الميزانية | `budgetPeriods/{currentPk}` | 1 |
| الالتزامات القادمة/المتأخرة | `obligations where remainingMinor > 0 order by dueDate limit 10` | ≤10 |
| كشف حركة حساب | `journalEntries where accountIds array-contains {id} order by bookedAtTs desc limit 25` | 25/صفحة |
| اتجاه رصيد حساب عبر الأشهر | `accountPeriods where accountId == {id} order by periodKey` ثم تجميع تراكمي | ≤12 |
| اتجاه الإنفاق عبر الأشهر | `periods` لآخر 12 شهراً | ≤12 |
| تقرير فئة/وسم/جهة (متقدم) | `getAggregateFromServer(sum('signedAmountMinor'))` على `postings` | 2 |

**قاعدة صارمة:** كل عدد مالي في الواجهة يأتي من **محدِّد (selector) في طبقة النطاق** يستقبل اللقطات
ويعيد `Minor`. **لا مكوّن يجمع أو يطرح مبالغ** — تطبيق القسم 25 بند 7، ومفروض بأداة البناء (قسم 21).

### 5.4 أسلوب الكتابة: `increment` مقابل قراءة + قيمة مطلقة

**القاعدة الفاصلة الدقيقة:**

> **`increment` تصلح متى كان المقدار المُزاد معلوماً يقيناً من قراءة داخل المعاملة أو من الطلب نفسه،
> ولا تصلح متى اعتمد قرارٌ على نتيجة الزيادة.**

| المستند/الحقل | الأسلوب | لماذا |
|---|---|---|
| `periods/{pk}.*` | **`increment` بلا قراءة** | لا قرار يعتمد على النتيجة. توفير قراءة في أكثر العمليات تكراراً |
| `accountPeriods/{acc}__{pk}.*` | **`increment` بلا قراءة** | نفس السبب. **الكتابة بـ `set(..., {merge:true})` مع الحقول الثابتة (`accountId`, `accountType`, `periodKey`) وبلا أي حقل مخزوني** |
| `accounts.debitTotalMinor` / `creditTotalMinor` / `entryCount` / `balanceVersion` | `increment` | لا قرار على نتيجتها |
| `accounts.balanceMinor` | **قراءة + `increment`** | الحساب **يُقرأ** لفحص `minBalanceMinor`، والفحص داخل المعاملة يجعل أي تغيّر متزامن يُعيد المحاولة. `increment` آمن **بعد** القراءة |
| `accounts.earmarkedMinor` | قراءة + قيمة مطلقة | يُقرأ للتحذير |
| `obligation.paidMinor` / `remainingMinor` | **قراءة + قيمة مطلقة محسوبة** | الفحص (`assertNotOverSettled`) يعتمد على القيمة. `increment` يفتح فجوة بين ما فُحص وما كُتب |
| `debt.settledMinor` / `remainingMinor` | **قراءة + قيمة مطلقة محسوبة** | نفسه |
| `budgetPeriods.*.spentMinor` | **قراءة + قيمة مطلقة محسوبة** | **تنبيه التجاوز يقرأ النتيجة داخل المعاملة** (القسم 17: «منع التنبيهات المكررة») |
| `goal.savedMinor` | قراءة + قيمة مطلقة | حالة `achieved` تعتمد على النتيجة |
| `meta/integrity` | **لا يُكتب على المسار الساخن إطلاقاً** | ADR-016 |

**الصافي المقيس لتسجيل مصروف: 3 قراءات / 9 كتابات** (بدل 5 قراءات/7 كتابات لو قرأنا ما لا نحتاجه
وأهملنا `postings`) — **مع بقاء كل الحوارس داخل المعاملة**.

> **لماذا لا نكتب الميزانية بـ `increment` أعمى ونفحص العتبة بعد النجاح؟** لأن ذلك يُنتج ثلاث نتائج
> كلها مخالفة: (1) `spentMinor` يصير قابلاً للسلب ولا شيء يكتشفه داخل المعاملة؛ (2) جهازان يسجّلان
> مصروفين يعبران معاً عتبة 80% ⇒ قراءتان خارج المعاملة ⇒ **تنبيهان متطابقان**، وإعادة فتح التطبيق
> تُعيد الفحص ⇒ تنبيه ثالث — خرق مباشر للقسم 17؛ (3) أي قاعدة مستقبلية من نوع «امنع مصروفاً يتجاوز
> سقفاً صلباً» تصير **غير قابلة للتنفيذ** دون إعادة تصميم المسار الساخن. والتوفير المشترى
> (3 قراءات = 0.006% من حصة Spark اليومية) **لا قيمة له**.

### 5.5 الفهرنة الصحيحة لـ `periodKey` — ADR-008

**القرار المُلزِم:** `entry.periodKey ≡ entry.bookedAt.slice(0, 7)` **دائماً**، ومفروض في قواعد الأمان.

**لماذا، ولماذا كان لا بدّ من الحسم:** القسم 21 يذكر «بداية الشهر المالي» (مثلاً يوم استلام الراتب = 25).
لو حُسب `periodKey` وفق `fiscalMonthStartDay` لصار قيد 2026-10-27 من فترة `2026-11` ⇒ **ترفضه القاعدة
`periodKey == bookedAt[0:7]`**. فإمّا الميزة ميتة، أو القاعدة تسقط (وبسقوطها يسقط ثابت نافع).
والأخطر: `periodKey` مخزَّن على قيد **غير قابل للتغيير**، فتغيير بداية الشهر المالي لاحقاً يستلزم
الكتابة على قيود مرحَّلة — وهو محرَّم.

**الحل المعتمد — فصل محورين:**

| المحور | المصدر | مُفرَض في القواعد؟ | قابل للتغيير لاحقاً؟ |
|---|---|---|---|
| **محور الدفتر** `periodKey` | `bookedAt.slice(0,7)` — شهر ميلادي | **نعم** | لا، وغير مطلوب |
| **محور التقرير** «الشهر المالي» | نطاق على `bookedAt` (`>= '2026-09-25' && <= '2026-10-24'`) يُجمَّع في إسقاط منفصل `fiscalPeriods/{key}` | لا | **نعم، بإعادة بناء** |

فتصبح «بداية الشهر المالي» ميزة **عرض وتقرير** تُبنى بآلية إعادة البناء الموجودة (قسم 16)، ولا تمسّ
القيود ولا القواعد ولا الميزانيات في الإصدار الأول. **الإصدار الأول: ميزانيات وفترات بالشهر الميلادي.**

---

## 6. منع الازدواج — الآلية النهائية

### 6.1 المبدأ

> **معرّف العملية (`opId`) يُولَّد عند تكوين النيّة، لا عند تنفيذها، ويصبح معرّف مستند القيد.**

لأن `entryId === opId`، فإن «الكتابة مرتين» تصبح **كتابة على نفس المستند**، والمعاملة ترفضها بقراءة
مسبقة. هذا يحوّل منع الازدواج من منطق تطبيقي قابل للخطأ إلى **خصيصة بنيوية في مفتاح المستند**.

### 6.2 توليد `opId` — القواعد لكل مصدر

| المصدر | طريقة التوليد | النوع |
|---|---|---|
| نموذج يدوي (مصروف/دخل/تحويل) | `crypto.randomUUID()` **عند تركيب النموذج (mount)**، يُخزَّن في حالة النموذج ويُعاد توليده فقط بعد نجاح مؤكَّد أو عند «إضافة عملية جديدة» | عشوائي، ثابت لعمر النموذج |
| دفع التزام / دين | `crypto.randomUUID()` عند فتح نافذة الدفع | عشوائي |
| مصروف/دخل متكرر | `` `rec:${recurrenceId}:${occurrenceKey}` `` حيث `occurrenceKey = 'YYYY-MM-DD'` | **حتمي** |
| **مادّية دورة التزام** | `` `obl:${recurrenceId}:${dueDate}` `` — ADR-013 | **حتمي** |
| قسط من جدول أقساط | `` `inst:${obligationId}:${installmentIndex}` `` | **حتمي** |
| استيراد ملف | `` `imp:${importBatchId}:${rowIndex}` `` | **حتمي** |
| **إلغاء قيد** | `` `rev:${originalEntryId}` `` — لا يمكن عكس القيد مرتين | **حتمي** |
| **تعديل قيد** | `` `amd:${originalEntryId}` `` + قفل `entryCorrections/{originalEntryId}` — ADR-014. **لا عدّاد `amendCount`** | **حتمي** |
| قيد افتتاحي | `` `open:${accountId}` `` — رصيد افتتاحي واحد لكل حساب | **حتمي** |
| تخصيص لهدف | `crypto.randomUUID()` | عشوائي |

**القاعدة الذهبية:** كلما وُجد **مفتاح طبيعي** للحدث، فالمعرّف **حتمي** مشتق منه. المعرّف العشوائي
مقصور على نية بشرية لا مفتاح طبيعي لها (مصروف القهوة قد يتكرر فعلاً مرتين في اليوم — وهذا مشروع).

### 6.3 `payloadHash` — كشف تعارض المحتوى على نفس المعرّف

```ts
// domain/ops/hash.ts
/** تقنين مستقر: ترتيب المفاتيح أبجدياً، حذف undefined، تحويل Minor إلى عدد، بلا مسافات. */
export function canonicalize(payload: unknown): string;
/** SHA-256 عبر Web Crypto (subtle.digest) → hex */
export async function hashPayload(payload: unknown): Promise<string>;
```

**هذا الحقل يمنع عيباً قاتلاً مشتركاً في كل التصاميم التي لا تملكه.** السيناريو بالتفصيل:
المستخدم يرسل مصروفاً 25.500، تفشل الشبكة في إرجاع الرد **بعد نجاح الكتابة فعلاً**، يرى خطأً،
**يصحّح المبلغ إلى 250.500** ويضغط إرسال بنفس `opId` (وإعادة استخدام `opId` صحيحة ومقصودة).
أي تصميم يكتفي بـ «المستند موجود؟ أعد نجاحاً واخرج» يُرجع **رسالة نجاح** ⇒ المستخدم يظن أنه سجّل
250.500 والنظام يحمل 25.500، **بلا رسالة ولا سجل تدقيق ولا أي أثر**. في تطبيق مالي يومي هذا فارق
يتراكم ويُكتشف بعد شهور عند عدم تطابق رصيد حقيقي.

**السلوك الإلزامي داخل المعاملة:**

| الحالة | الإجراء |
|---|---|
| القيد غير موجود | يُرحَّل |
| موجود و`payloadHash` **مطابق** | **إرجاع ناجح بلا كتابة** — `{ alreadyApplied: true }` |
| موجود و`payloadHash` **مختلف** | **رفض** بـ `OP_ID_CONFLICT`: «هذه العملية سُجّلت بمحتوى مختلف. لتغييرها استخدم التعديل.» |
| موجود وحالته `reversed`/`replaced` ونفس الحمولة | إرجاع ناجح بلا كتابة + تنبيه واجهة «هذه العملية كانت ملغاة/مُعدَّلة» |

### 6.4 السيناريوهات الأربعة المطلوبة

| السيناريو | الميكانيزم | النتيجة |
|---|---|---|
| **ضغط الزر مرتين** | ط1: الزر يُعطَّل عند أول نقرة حتى انتهاء الوعد. ط2: `opId` ثابت لعمر النموذج. ط3: المعاملة تقرأ `journalEntries/{opId}` فتجده | النقرة الثانية تُرجع **نفس** القيد مع `alreadyApplied: true` بـ **0 كتابات**. لا قيد ثانٍ ولا رسالة خطأ |
| **إعادة المحاولة بعد فشل الشبكة** | نفس `opId` + `payloadHash`. ثلاث حالات: (أ) لم تصل ⇒ تُنفَّذ؛ (ب) وصلت ونجحت ولم يصل الرد ⇒ `alreadyApplied`؛ (ج) وصلت وفشلت ⇒ لا شيء مكتوب ⇒ تُنفَّذ | **مرة واحدة بالضبط**، وتغيّر المحتوى يُرفض صراحةً لا يُخفى |
| **تنفيذ المصروف/الالتزام المتكرر** | `opId` حتمي من (القالب، تاريخ الاستحقاق). مُشغِّل الاستدراك يحسب كل المواعيد المستحقة منذ آخر دورة حتى اليوم ويحاولها واحدة واحدة | تشغيل المُشغِّل 50 مرة في اليوم نفسه = **صفر قيود مكرَّرة**. لا حاجة إلى قفل ولا `lastRunAt` موثوق |
| **جهازان معاً** | المعرّفات الحتمية + `runTransaction`: أحدهما يكتب والآخر يفشل بتعارض (`ABORTED`) فتُعاد المعاملة، وفي المحاولة الثانية يجد القيد موجوداً | قيد واحد. وللعمليات العشوائية (مصروفان مختلفان) يُكتب القيدان — **وهذا صحيح**، فهما نيّتان مختلفتان |

### 6.5 الازدواج **الدلالي** — كاشف التشابه

منع الازدواج أعلاه بنيوي وممتاز **للازدواج التقني فقط**. وهناك ازدواج ثانٍ لا يمسّه إطلاقاً:

> نفس مصروف البقالة يُدخله المستخدم يدوياً من الهاتف ومن الحاسوب بمعرّفين مختلفين ⇒
> **قيدان مشروعان شكلاً**، ورصيد ناقص 25.500 بلا سبب مرئي.

```ts
// domain/ops/nearDuplicate.ts
export interface NearDuplicate {
  entryId: string;
  amountMinor: Minor;
  minutesAgo: number;
  accountName: string;
}

/**
 * المعيار: نفس accountId + نفس amountMinor + نفس bookedAt + نفس categoryId
 *          وفارق إنشاء ≤ 10 دقائق.
 * يُستدعى **قبل** التنفيذ على لقطة محلية (0 قراءات مدفوعة عادةً)
 * ويُرجَّع في PostResult.warnings.
 */
export function findNearDuplicates(
  draft: EntryDraft, recentEntries: readonly JournalEntry[], nowIso: string
): NearDuplicate[];
```

**تحذير لا حجب.** الرسالة العربية المعتمدة حرفياً:

> «سجّلت مصروفاً مشابهاً بقيمة 25.500 د.ل قبل 4 دقائق. هل هذه عملية جديدة؟»
> [نعم، عملية جديدة] [اعرض العملية السابقة] [إلغاء]

**لماذا تحذير لا حجب:** قهوتان في ساعة حالة مشروعة تماماً، وحجبها سلوك سيئ يدفع المستخدم إلى
تحريف المبلغ أو التاريخ ليعبر الحاجز.

### 6.6 العمل دون اتصال

**عيب جوهري في Firestore يجب الإقرار به:** `runTransaction` **يفشل دون اتصال**. لا يُطابَر محلياً
(بخلاف `setDoc` و`writeBatch`). والقسم 2 بند 8 يطلب العمل دون اتصال، والقسم 22 يطلب «عدم اعتبار
العملية محفوظة إلا بعد تأكيد نجاح الكتابة».

**الحل المعتمد (ADR-007): طابور `pendingCommands` في Firestore + مرآة محلية في IndexedDB.**

قواعد الطابور:

1. العملية تدخل الطابور **قبل** محاولة الترحيل، دائماً، متصلاً كان الجهاز أو لا.
2. تُحوَّل حالتها إلى `applied` وتُحذف من المرآة المحلية **فقط** بعد تأكيد نجاح المعاملة (أو `alreadyApplied`).
3. الواجهة تعرضها بحالة **«بانتظار المزامنة»** بشكل بصري مختلف تماماً، و**لا تُدخلها في أي رصيد أو تقرير**.
4. إعادة المحاولة بتباطؤ أُسّي (1s, 2s, 4s… حتى 5 دقائق) + محاولة فورية عند عودة الاتصال.
5. تقسيم الأخطاء: **قابلة لإعادة المحاولة** (`unavailable`, `deadline-exceeded`, `aborted`, `internal`)
   مقابل **نهائية** (`permission-denied`, `invalid-argument`, وأخطاء النطاق مثل `OVERPAYMENT`).
   النهائية تصير `rejected` مع `rejectionMessageAr` وتُعرض للمستخدم لتعديلها أو حذفها.
6. التنفيذ **تسلسلي (واحدة في كل مرة)** بترتيب الإدخال. السبب: تحويل ثم سداد من نفس الحساب قد يفشل
   الثاني بسبب الرصيد، والترتيب يجعل السلوك متوقعاً.
7. `pendingCommands` هي **المجموعة المالية الوحيدة التي يُسمح بحذف مستنداتها** (بعد `applied`
   أو بقرار المستخدم على `rejected`)، لأنها ليست سجلاً محاسبياً.

---

## 7. بنية المعاملة الإلزامية

### 7.1 القاعدة الفاصلة بين `runTransaction` و`writeBatch`

> **إن كان قرار الكتابة يعتمد على قيمة مقروءة → `runTransaction`.
> إن كانت الكتابات معروفة سلفاً بالكامل → `writeBatch`.**

كل عملية مالية في «رصيد» تعتمد على قراءة (وجود `opId`، حدّ الرصيد، السداد الزائد، عتبة الميزانية)،
لذلك: **كل ترحيل قيد = `runTransaction`. بلا استثناء.**

| العملية | الأداة |
|---|---|
| مصروف / دخل / تحويل / دفع التزام / سداد أو تحصيل دين / تخصيص / تسوية | `runTransaction` |
| رصيد افتتاحي | `runTransaction` (منع تكراره بـ `open:{accountId}`) |
| إلغاء قيد / تعديل قيد | `runTransaction` **واحدة** (العكس والبديل ذرّيان معاً) |
| إنشاء حساب/فئة/جهة/قالب تكرار | `writeBatch` أو `setDoc` — لا قراءة ولا أثر على الأرصدة |
| تهيئة الشجرة والمستندات الأولى | `writeBatch` مجزَّأ ≤450 |
| استيراد جَمْعي | `writeBatch` للقيود + تمريرة تجميع لاحقة (7.4) |
| تحديث حالات الالتزامات اليومية (`due`→`overdue`) | `writeBatch` — الحالة دالّة في التاريخ لا في مبالغ |
| إعادة بناء الإسقاطات | `writeBatch` مجزَّأ بقيم مطلقة (قسم 16) |

**محرَّم مطلقاً:** استخدام `writeBatch` لأي حقل رصيد أو متبقٍّ (`balanceMinor`, `paidMinor`,
`settledMinor`, `spentMinor`, `savedMinor`) — لأنها لا تكشف التنازع فتفوز آخر كتابة.
الاستثناء الوحيد: إعادة البناء، وهي تعمل خلف بوابة `rebuildStatus === 'running'` التي تمنع كل كتابة مالية.

### 7.2 النوع الذي يجعل «القراءة بعد الكتابة» غير قابلة للتعبير

Firestore يمنع القراءة بعد الكتابة داخل المعاملة، ويمنع الاستعلامات داخلها
(`tx.get` يقبل `DocumentReference` فقط). الفصل بالتسمية والنص **غير كافٍ**؛ نفرضه **بالتوقيع**:

```ts
// data/tx/runPlan.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface TxPlan<TState, TWrites> {
  /** كل القراءات هنا، وهنا فقط. */
  reads: (tx: Transaction) => Promise<TState>;
  /** نقية 100%: لا I/O، لا tx، لا Date.now، لا randomUUID. */
  decide: (state: TState) => Result<TWrites, DomainError>;
  /** كل الكتابات هنا، وهنا فقط. */
  writes: (tx: Transaction, w: TWrites) => void;
}

export function runPlan<TState, TWrites>(
  plan: TxPlan<TState, TWrites>
): Promise<Result<TWrites, DomainError>>;
```

**ما يكسبه هذا التوقيع:**

1. «القراءة بعد الكتابة» **غير قابلة للتعبير** — `writes` لا تملك وصولاً إلى نتائج قراءة جديدة.
2. `decide` **لا تستقبل `tx` إطلاقاً** ⇒ تقتل فئة كاملة من الأخطاء غير الحتمية داخل دالة المعاملة.
   وهذا ضروري لأن Firestore يعيد المحاولة ~5 مرات: أي `Date.now()` أو `randomUUID()` أو دفع إلى
   مصفوفة خارجية أو إرسال تحليلات داخل المعاملة = سلوك غير محدَّد.
3. `decide` تطابق تماماً `planOperation` النقية في طبقة النطاق ⇒ التطعيم شبه مجاني.

**كل القيم المتغيرة تُحسب قبل `runTransaction` وتُمرَّر:** `opId`, `bookedAt`, `periodKey`,
`payloadHash`, `deviceId`, `clientCreatedAt`. و`serverTimestamp()` مسموح **داخل الكتابات** فقط
(يُقيَّم على الخادم عند الـ commit).

### 7.3 نقطة الكتابة المالية الوحيدة

```ts
// data/ledger/postOperation.ts
export interface PostContext {
  uid: string;
  now: { iso: string; bookedAt: DateKey; periodKey: PeriodKey };  // محسوب قبل المعاملة
  deviceId: string;
}

export interface PostResult {
  opId: string;
  entryIds: string[];
  alreadyApplied: boolean;
  balancesAfter: Record<string, Minor>;
  warnings: DomainWarning[];        // تجاوز ميزانية، تجاوز حجز، تشابه، اقتراب من هدف…
}

/**
 * نقطة الكتابة المالية **الوحيدة** في النظام.
 * ثلاث مراحل مفروضة بالتوقيع: reads → decide → writes (7.2).
 */
export async function postOperation(
  ctx: PostContext,
  op: OperationRequest            // اتحاد مُميَّز لكل أنواع العمليات
): Promise<PostResult>;
```

```ts
// domain/ops/plan.ts — طبقة النطاق: نقية، قابلة للاختبار بلا Firebase
export interface LedgerSnapshot {              // ما قرأته مرحلة القراءة
  existingEntry: JournalEntry | null;
  existingCorrection: EntryCorrection | null;
  accounts: Record<string, Account>;
  obligation?: Obligation;
  debt?: Debt;
  goal?: FinancialGoal;
  budgetPeriod?: BudgetPeriod | null;
  periodLocked: boolean;
  integrity: Pick<IntegrityMeta, 'rebuildStatus' | 'projectionVersion'>;
}

export interface WritePlan {
  entries: JournalEntry[];
  postings: Posting[];
  accountUpdates: Array<{
    id: string; debitDelta: Minor; creditDelta: Minor;
    balanceDelta: Minor; earmarkedAbsolute?: Minor; lastEntryId: string;
  }>;
  accountPeriodUpserts: Array<{
    id: string; accountId: string; accountType: AccountType; periodKey: PeriodKey;
    debitDelta: Minor; creditDelta: Minor; netDelta: Minor;
  }>;
  periodSummaryDelta: PeriodDelta;
  budgetUpdate?: { periodKey: PeriodKey; categoryId: string;
                   spentAbsolute: Minor; overallSpentAbsolute: Minor;
                   alertFiredAtPercent?: number | null };
  obligationUpdate?: { id: string; paidMinor: Minor; remainingMinor: Minor;
                       extraChargesMinor?: Minor; status: ObligationStatus };
  debtUpdate?: { id: string; settledMinor: Minor; remainingMinor: Minor; status: DebtStatus };
  goalUpdate?: { id: string; savedMinor: Minor; status: FinancialGoal['status'] };
  entryCorrection?: EntryCorrection;
  operationRecord?: OperationRecord;
  notifications?: NotificationDraft[];
  auditLogs?: AuditLogEntry[];
  warnings: DomainWarning[];
}

/** الدالة المركزية: طلب + لقطة ⇒ خطة كتابة، أو خطأ نطاق. **نقية 100%.** */
export function planOperation(
  op: OperationRequest, snap: LedgerSnapshot, ctx: PostContext
): Result<WritePlan | { alreadyApplied: true; entryIds: string[] }, DomainError>;
```

**هذا التقسيم هو جوهر الالتزام بالقسم 2 والقسم 23 بند 1:** `planOperation` تُختبر بالكامل كدالة نقية
**دون محاكي Firebase**، و`postOperation` تُختبر بالمحاكي للتحقق من المعاملة والقواعد فقط.

### 7.4 الحدود الفعلية وأثرها

| الحد | القيمة | الأثر على تصميمنا |
|---|---|---|
| كتابات `writeBatch` | 500 | التهيئة والاستيراد وإعادة البناء تُجزَّأ على 450 |
| كتابات `runTransaction` | 500 | أكبر معاملة عندنا 13 كتابة (التعديل) — بعيدة جداً |
| لا قراءة بعد الكتابة | إلزامي | مفروض بالتوقيع (7.2) |
| لا استعلامات داخل المعاملة | إلزامي | **هذا القيد شكّل التصميم كله:** كل المعرّفات حتمية (`accountPeriods/{acc}__{pk}`، `periods/{pk}`، `budgetPeriods/{pk}`، `journalEntries/{opId}`، `entryCorrections/{entryId}`) فلا نحتاج استعلاماً داخل معاملة أبداً |
| إعادة محاولة المعاملة | ~5 | `decide` نقية (7.2) |
| `get()`/`exists()` في القواعد | 10 لكل مستند، **20 لكل طلب مركّب** | ميزانيتنا 3–6 لكل معاملة ⇒ داخل الحد بهامش. ويُحاسَب كل واحد منها **كقراءة مدفوعة** (يُحسب في 15.1) |
| سقف كتابة المستند الواحد | ~1/ثانية مستدامة | `periods/{pk}` نقطة الازدحام ⇒ مسار الاستيراد يتجنبها. **ولا مستند عدّاد ساخن آخر** (ADR-016) |
| حجم المستند | 1 ميغابايت | القيد بسطوره آمن؛ `periods.expenseByCategory` بـ 200 فئة ≈ 8KB |
| المعاملة تفشل دون اتصال | إلزامي | الطابور (6.6) |

**نمط الاستيراد الجَمْعي (لماذا لا معاملة):**

```
المرحلة 1  writeBatch (دفعات 450): القيود + postings بـ aggregatesApplied:false
           معرّفات حتمية imp:{batchId}:{row} ⇒ إعادة التشغيل آمنة
المرحلة 2  قراءة القيود غير المُجمَّعة وتجميعها في الذاكرة لكل (حساب، فترة) و(فترة)
المرحلة 3  runTransaction واحدة لكل (حساب أو فترة) تُطبّق الدلتا المُجمَّعة وتضع aggregatesApplied:true
المرحلة 4  reconcile() للتأكد
```

السبب: 2000 قيد × معاملة لكل قيد = 2000 رحلة شبكة + 2000 كتابة على `periods/{pk}` الواحد (أي ~2000
ثانية بسبب سقف الكتابة). النمط أعلاه يختصرها إلى ~10 دفعات + ~30 معاملة تجميع.
**الاستيراد التاريخي يتخطى حاجز الرصيد** (`skipBalanceGuard: true`) لأن ترتيب الإدخال قد يخالف ترتيب
التاريخ، ويُشغَّل بعده فاحص يُبلِّغ عن كل لحظة سلبية تاريخية — **إبلاغ لا منع** (قسم 18.1).

---

## 8. التعديل والإلغاء مع حفظ الأثر التاريخي

### 8.1 القاعدة الأساسية

> **القيد المرحَّل غير قابل للتغيير (immutable). لا تُعدَّل سطوره ولا مبالغه ولا تاريخه ولا حساباته أبداً.**

الحقول الوحيدة القابلة للتحديث على قيد مرحَّل: `status`، `reversedByEntryId`، `replacedByEntryId`،
`correctionGroupId`، `updatedAt`، و(الوصفية في الجدول أدناه). وتُفرض هذه الحصرية في **قواعد الأمان**،
لا في الكود وحده.

### 8.2 جدول تصنيف الحقول — حقلاً حقلاً

**هذا الجدول مُلزِم وهو جدول اختبار في نفس الوقت.** «في مكانه» تعني تحديثاً مباشراً + `auditLogs`.
«عكس + بديل» تعني المرور بـ `editTransaction`.

| الحقل | التعديل | السبب / المُجمَّع المتأثر |
|---|---|---|
| `description` | **في مكانه** + تدقيق | لا يحرّك أي مُجمَّع |
| `lines[].memo` | **في مكانه** + تدقيق | لا يحرّك أي مُجمَّع |
| `notes` | **في مكانه** + تدقيق | — |
| `attachmentIds` | **في مكانه** | لا أثر محاسبي |
| `tags` (وسوم مستخدم حرّة) | **في مكانه** + تدقيق | لا مُجمَّع مرتبط |
| **`tags` يحوي/يفقد `household`** | **مسار خاص: تحديث في مكانه + تحديث `periods.householdExpenseMinor` في نفس المعاملة** (أو عكس + بديل) | **خطر مُصحَّح:** اعتباره «وصفياً قابلاً للتعديل الحرّ» يعني أن **تعديلاً وصفياً يحرّك مُجمَّعاً مالياً** ⇒ ينحرف تقرير مصاريف المنزل (القسم 11) **دون أي قيد يفسّره ودون أي ثابت يكشفه** |
| `amountMinor` / `lines[].amountMinor` | **عكس + بديل** | يغيّر الرصيد والميزانية وكل المُجمَّعات |
| `accountId` في أي سطر | **عكس + بديل** | ينقل الأثر بين حسابين |
| `categoryId` | **عكس + بديل** | ينقل الاستهلاك بين ميزانيتين وبين بنود `expenseByCategory` |
| `side` / `kind` | **عكس + بديل** | يغيّر المعنى المحاسبي كلياً |
| **`bookedAt` يغيّر `periodKey`** (شهر آخر) | **عكس + بديل** | ينقل الحركة بين تقريرين شهريين وبين ميزانيتين |
| **`bookedAt` داخل نفس الشهر** | **في مكانه** + تدقيق | لا يغيّر `periodKey` ولا أي مُجمَّع شهري؛ يمسّ التقرير اليومي فقط. **تبسيط عملي سليم ومُوثَّق** — وشرطه أن القاعدة تفرض `periodKey == bookedAt[0:7]` فيبقى الاشتقاق صحيحاً بعد التعديل |
| `refs.*` (الربط بالتزام/دين/هدف) | **عكس + بديل** | يحرّك `paidMinor`/`settledMinor`/`savedMinor` |
| `status`, `reversesEntryId`, `reversedByEntryId`, `replacedByEntryId`, `correctionGroupId` | **النظام فقط** | لا تُعرض للتعديل |
| `opId`, `payloadHash`, `ownerUid`, `currency`, `createdAt`, `createdBy`, `bookedAtTs` | **لا تُعدَّل أبداً** | مفروض في القواعد |

> **ملاحظة اتساق إلزامية:** كل حقل مُصنَّف «في مكانه» **غير مذكور** في قائمة `unchanged()` في
> قواعد الأمان، وكل حقل مُصنَّف «عكس + بديل» **مذكور فيها**. أي تعارض بين هذا الجدول وقواعد الأمان
> هو **عيب يُسقط البناء** — ويُغطّى باختبار محاكي صريح لكل صف (قسم 20).
> السبب: جدول يسمح بتعديل `bookedAt` في مكانه وقواعد لا تذكره في `unchanged` **ولا تربطه بـ `periodKey`**
> يسمح للعميل بنقل `bookedAt` من أكتوبر إلى أغسطس مع بقاء `periodKey = '2026-10'` ⇒ كشف الحساب
> (المرتَّب بالتاريخ) يُظهر الحركة في أغسطس وكل المُجمَّعات تحسبها في أكتوبر ⇒ **تقرير يناقض نفسه**،
> وأي إعادة بناء تنقل المبلغ وتُغيّر أرقاماً كان المستخدم قد رآها وصدّقها.

### 8.3 الإلغاء (عكس قيد)

```ts
export interface VoidTransactionRequest {
  type: 'voidTransaction';
  opId: string;                      // = `rev:${originalEntryId}` (حتمي ⇒ لا عكس مزدوج)
  originalEntryId: string;
  reason: string;                    // إلزامي، 5..500 حرفاً — القسم 18 بند 9
}
```

**بناء قيد العكس:** نفس السطور بالمبالغ نفسها مع **قلب الجانب** (`debit ↔ credit`)، و`kind: 'reversal'`،
و`reversesEntryId`. **لا سطور بمبالغ سالبة** — القلب يحفظ الثابت I2 ويبقي الإجماليات التاريخية ظاهرة.
**ولا يورّث قيد العكس أي تصنيف تقريري** — لا يوجد في هذا التصميم حقل تصنيف يُورَّث أصلاً،
فالتقرير دالّة في نوع الحساب والجانب.

**سياسة التاريخ (قرار صريح، وهو الصحيح بين كل البدائل):**

| الحالة | `bookedAt` قيد العكس | `periodKey` | `isPriorPeriodCorrection` | السبب |
|---|---|---|---|---|
| فترة الأصل **مفتوحة** (`periodLocks/{pk}` غير موجود) | **نفس تاريخ الأصل** | فترة الأصل | `false` | الشهر يعود إلى حالته الصحيحة؛ مصروف سبتمبر الخاطئ **لا يلوّث أكتوبر** |
| فترة الأصل **مُقفلة** | **تاريخ اليوم** | الفترة الحالية | **`true`** | تقرير مُقفل سُلِّم/صُدِّر لا يُغيَّر بأثر رجعي؛ ويُعرض كـ«تصحيح فترة سابقة» في سطر منفصل |

**لماذا هذه السياسة ولماذا البديل مرفوض:** وضع `periodKey` للعكس = «فترة لحظة العكس **دائماً**» —
حتى لو كان شهر الأصل مفتوحاً تماماً — ينتج **إفساد الشهرين معاً**: إيجار 800.000 سُجِّل 2026-09-28
وعُكس 2026-10-02 ⇒ سبتمبر يبقى `totalExpenseMinor = 800.000` **متضخماً إلى الأبد**، وأكتوبر يبدأ
بـ `−800.000` و`budgetPeriods` بنسبة استهلاك **سالبة**، ولوحة التحكم تعرض «مصروفات الشهر:
−800.000 د.ل». ويستحيل أن يصحّ معاً اختبارُ «ملخص الفترة = مجموع سطور الفترة» ومعادلةُ التدفق النقدي.
**وشرط صحة سياستنا هو وجود آلية إقفال حقيقية** — ولهذا `periodLocks` مجموعة فعلية في هذا التصميم
بقاعدة أمان تمنع الكتابة داخل فترة مُقفلة (14.2)، لا مفهوماً نظرياً.

**الأثر على الكيانات المرافقة — إلزامي داخل نفس المعاملة:**

| القيد الأصلي | ما يُعكس أيضاً |
|---|---|
| `expense` | `periods.totalExpenseMinor −= X` (أو `priorPeriodExpenseCorrectionMinor −= X` إن `isPriorPeriodCorrection`)، `expenseByCategory[cat] −= X`، `householdExpenseMinor −= X` إن موسوماً، `budgetPeriods.categories[cat].spentMinor −= X` و**إعادة ضبط `alertFiredAtPercent = null`** إن هبطت النسبة تحت العتبة. **و`budgetPeriods` لا تُلمس إطلاقاً إن كان تصحيح فترة مُقفلة** |
| `income` | `periods.totalIncomeMinor −= X` (أو حقل التصحيح)، `incomeBySource −= X`، و`incomeSchedules` تعود `expected` |
| `obligationPayment` | `obligation.paidMinor −= X`، `remainingMinor` يُعاد حسابه من الطرفين، `paymentCount −= 1`، `status` يُعاد حسابه بدالة 10.2. **ودورة التكرار لا تُلمس** لأنها لم تُنشأ من معاملة الدفع (ADR-013) |
| `debtRepayment` / `debtCollection` | `debt.settledMinor −= X`، `remainingMinor` يُعاد حسابه، `settlementCount −= 1`، `status` يُعاد حسابه |
| `borrow` / `lend` | **ممنوع العكس إن وُجدت تسويات لاحقة** (`settlementCount > 0`) ⇒ `DEBT_HAS_SETTLEMENTS`: «ألغِ الدفعات أولاً». وإلا: عكس + `debt.status = 'cancelled'` |
| `earmark` | `goal.savedMinor −= X`، `account.earmarkedMinor −= X`، `status` يعود `active` إن كان `achieved` |
| `transfer` | رصيدا الحسابين، و`transferVolumeMinor −= X` |
| `opening` | **ممنوع العكس** إن وُجد أي قيد لاحق على الحساب ⇒ يُستخدم `adjustAccount` |
| `reversal` | **ممنوع عكس العكس.** لإعادة الحالة: قيد جديد عبر `editTransaction` |

### 8.4 حاجز الرصيد يُطبَّق على قيد العكس أيضاً

**حالة حقيقية تُغفل عادةً، وهي إلزامية هنا:** عكس **دخل** قد يجعل الرصيد سالباً، لأن المال أُنفق بعد استلامه.

> **السيناريو بالأرقام:** دخل 500.000 سُجِّل بالخطأ على الحساب أ. أُنفق منه 400.000.
> ثم يُطلب عكس الدخل ⇒ رصيد أ يصير **−400.000** على حساب `minBalanceMinor = 0`.
> بلا هذا الحاجز يُكتب العكس ويُخالف القسم 19 **بلا أي إنذار**.

```ts
// داخل planOperation للعكس:
assertBalanceFloor(account, reversalDeltaForAccount)   // على **دلتا العكس** لا على الأصل
```

**الرسالة العربية المعتمدة حرفياً:**

> «لا يمكن إلغاء هذا الدخل لأن المبلغ أُنفق — ألغِ المصروفات المرتبطة أولاً،
> أو فعّل السماح بالرصيد السالب لهذا الحساب.»
> [اعرض المصروفات بعد هذا التاريخ] [إعدادات الحساب] [إلغاء]

ويُضاف اختبار مقابل في قسم 20.

### 8.5 التعديل (استبدال)

```ts
export interface EditTransactionRequest {
  type: 'editTransaction';
  opId: string;                      // = `amd:${originalEntryId}` — ADR-014، بلا عدّاد
  originalEntryId: string;
  reason: string;
  replacement: Omit<EntryDraft, 'opId'>;   // المسودة الجديدة كاملة
}
```

**التنفيذ: معاملة واحدة، ثلاثة قيود منطقية + قفل:**

```
runPlan:
  reads:
    - journalEntries/{originalEntryId}
    - entryCorrections/{originalEntryId}          ← القفل الذرّي
    - journalEntries/{opId}__2                    ← منع الازدواج
    - الحسابات المتأثرة (القديمة + الجديدة)
    - الالتزام/الدين/الهدف إن وُجد
    - budgetPeriods للفترة القديمة والجديدة
    - periodLocks للفترتين
    - meta/integrity
  decide:
    - القفل موجود؟ ⇒ ALREADY_CORRECTED: «صُحِّح هذا القيد من جهاز آخر — اعرض النسخة الحديثة»
    - الأصل status === 'posted' وليس kind === 'reversal'
    - الفترتان غير مُقفلتين (أو تُطبَّق سياسة 8.3)
    - المسودة الجديدة متوازنة (I1) وسطورها صحيحة (I2)
    - **الفحوص على الدلتا الصافية** (حدّ الرصيد، السداد الزائد)
  writes:
    - journalEntries/{opId}__1   ← قيد العكس  (kind:'reversal', reversesEntryId)
    - postings/{opId}__1__*      ← postings العكس (الإشارة مقلوبة)
    - journalEntries/{opId}__2   ← القيد البديل (replacesEntryId, correctionGroupId)
    - postings/{opId}__2__*
    - journalEntries/{originalEntryId} ← { status:'replaced',
                                           reversedByEntryId:`${opId}__1`,
                                           replacedByEntryId:`${opId}__2` }
    - entryCorrections/{originalEntryId} ← القفل (create، يفشل إن وُجد)
    - الحسابات: دلتا **صافية** (العكس + البديل معاً، لا خطوتين)
    - accountPeriods / periods / budgetPeriods: دلتا صافية
    - obligations / debts / goals: قيم مطلقة صافية
    - operations/{opId} + auditLogs
```

**لماذا الدلتا الصافية لا خطوتين متتاليتين؟** لأن الفحوص (حدّ الرصيد، السداد الزائد) يجب أن تُطبَّق على
**النتيجة النهائية**. تعديل مصروف من 500 إلى 480 لا يجوز أن يفشل بسبب حدٍّ تجاوزه الأصل أصلاً.
مثال: تعديل دفعة التزام من 200 إلى 300 على التزام 800 متبقٍّ منه 600 ⇒ الصافي `+100` ⇒ `300 ≤ 800` ✓.

**سلسلة القابلية للتتبع:** `correctionGroupId` = معرّف أول قيد في السلسلة، ويبقى نفسه في كل تعديل لاحق.
استعلام واحد (`where correctionGroupId == X order by createdAt`) يعطي تاريخ العملية كاملاً.

### 8.6 ما تراه الواجهة وما يراه التقرير

| السياق | المرشّح | السبب |
|---|---|---|
| قائمة العمليات للمستخدم | `status == 'posted' && kind != 'reversal'` | المستخدم يرى العمليات السارية فقط، لا ضجيج التصحيحات |
| «سجل التعديلات» لعملية | `correctionGroupId == X` بلا مرشّح آخر | الأثر التاريخي كاملاً — القاعدة 19.10 |
| كشف حركة حساب | **كل** القيود `posted` و`reversed` و`replaced` **بما فيها** `reversal` | الكشف يجب أن يطابق الرصيد؛ إخفاء العكس يجعل مجموع الكشف ≠ الرصيد |
| التقارير المُجمَّعة | لا مرشّح — المُجمَّعات مُحدَّثة مسبقاً | العكس والبديل ألغيا أثرهما لحظة الكتابة |
| التقارير التجميعية الخادمية (`postings`) | لا مرشّح أصلاً | `sum(signedAmountMinor)` يتصافر تلقائياً — انظر الملاحظة أدناه |
| التصدير (Excel/CSV/PDF) | كل القيود + أعمدة `status`, `reversesEntryId`, `replacesEntryId` | قابلية التدقيق — القسم 16 |

> **الملاحظة الأهم في هذا القسم كله:** لأن `reversal + original = 0` **رياضياً** (قلب الجانب يقلب
> `signedAmountMinor`)، فإن **أي** مجموع يُحسب على كل القيود/الـ postings يعطي الرقم الصحيح
> **تلقائياً بلا أي منطق استبعاد ولا أي مرشّح دورة حياة**.
> هذه أكبر فائدة عملية للقيد المزدوج في هذا المشروع، وهي ما يُنجِّينا من عيب «التقارير لا تطابق
> العمليات» (القسم 23 بند 12). وهي **مستحيلة** في تصميم تورّث فيه حركة العكس تصنيف الأصل وتقلب
> الاتجاه وحده: هناك يكون أمام المطوّر طريقان وكلاهما خطأ — جمع المبالغ ⇒ **2X** (تضخّم)،
> أو تصفية الحالة ⇒ **−X** (مصروفات ناقصة أو سالبة).

### 8.7 إقفال الفترة

بعد إنشاء `periodLocks/{pk}`: **ممنوع** أي قيد بـ `periodKey` داخل الفترة — يُفرض في المعاملة **وفي
قواعد الأمان**. التصحيح يُرحَّل بتاريخ اليوم بـ `isPriorPeriodCorrection: true`.
الغرض: تثبيت التقارير المُصدَّرة والميزانيات المُغلقة — وهو ما يجعل «حفظ الأثر التاريخي» حقيقياً.
`periodLocks` **لا تُحدَّث ولا تُحذف** (الإقفال نهائي)؛ فتح فترة = قرار مالك يُنفَّذ يدوياً بتغيير القواعد.

---

## 9. جدول القسم 19 — كل قاعدة ⇒ الأثر الدقيق على كل كيان

**الرموز:** `X` = المبلغ بالدرهم. `A` = حساب نقدي/مصرفي/محفظة. `C` = حساب فئة المصروف.
`pk` = `periodKey`. كل الأسطر في **معاملة واحدة**.
«✗» = **لا أثر** — وهذا نفي مقصود ومُختبَر، لا سكوت.

### R1 — «المصروف المدفوع يخفض رصيد الحساب»

**القيد:** `Dr expense.{categoryId} X` / `Cr asset.{A} X` — `kind: 'expense'`

| الكيان | الأثر الدقيق |
|---|---|
| `accounts` | `A`: `creditTotalMinor += X` ⇒ `balanceMinor −= X`. `C`: `debitTotalMinor += X` ⇒ `balanceMinor += X`. كلاهما `entryCount += 1`, `balanceVersion += 1`, `lastEntryId = entryId`, `lastPostedAt` |
| `postings` | سطران: `C` بـ `signedAmountMinor = +X`، `A` بـ `signedAmountMinor = −X`، `settlementDeltaMinor = 0` لكليهما |
| النقد المتاح | `−X` (لأن `A.isCashLike`) |
| المتاح للإنفاق | `−X` (و`earmarkedMinor` لا يتغير) |
| صافي الثروة | `−X` |
| `accountPeriods` | `{A}__{pk}`: `creditMinor += X`, `netMinor −= X`. `{C}__{pk}`: `debitMinor += X`, `netMinor += X` |
| `periods/{pk}` | `totalExpenseMinor += X`، `expenseByCategory[cat] += X`، `netCashFlowMinor −= X`، `entryCount += 1`, `lastEntryAt` |
| مصاريف المنزل | إن `tags ∋ 'household'`: `householdExpenseMinor += X` — **مجموع فرعي من نفس الرقم، لا قيمة مضافة** (القسم 11) |
| `budgetPeriods` | **إن وُجد المستند ووُجدت الفئة فيه:** `categories[cat].spentMinor = مقروء + X`، `overallSpentMinor = مقروء + X`. إن تجاوزت النسبة `alertAtPercent` ولم تُطلَق ⇒ تحذير في `PostResult.warnings` + إشعار + `alertFiredAtPercent = النسبة` (منع التكرار — القسم 17). **إن لم يوجد المستند/الفئة ⇒ لا كتابة ميزانية إطلاقاً** |
| `obligations` | ✗ (إلا إن `refs.obligationId` ⇒ R5) |
| `debts` / `financialGoals` | ✗ |
| التقارير | المصروفات، اليومي/الشهري/السنوي، التدفق النقدي، حركة الحساب، الميزانية والانحرافات، مصاريف المنزل |
| الفحوص | `X > 0` صحيح؛ `X ≤ MAX_ABS_MINOR`؛ `balance − X ≥ A.minBalanceMinor`؛ `A.isPostable && A.status=='active'`؛ `C.type === 'expense'`؛ الفترة غير مُقفلة؛ `rebuildStatus != 'running'`؛ **تحذير** إن `balance − X < earmarkedMinor`؛ **تحذير** تشابه (6.5) |

### R2 — «الدخل المستلم يرفع رصيد الحساب»

**القيد:** `Dr asset.{A} X` / `Cr income.{sourceId} X` — `kind: 'income'`

| الكيان | الأثر |
|---|---|
| `accounts` | `A`: `debitTotalMinor += X` ⇒ `+X`. `income.{s}`: `creditTotalMinor += X` ⇒ `+X` |
| `postings` | `A`: `+X`، `income.{s}`: `+X` (كلاهما في اتجاهه الطبيعي) |
| النقد المتاح | `+X` |
| صافي الثروة | `+X` |
| `periods/{pk}` | `totalIncomeMinor += X`، `incomeBySource[s] += X`، `netCashFlowMinor += X` |
| الدخل المتوقع | إن `refs.incomeScheduleId`: `incomeSchedules/{id}.occurrences[key] = { status:'received', entryId, receivedMinor: X }`. **الدخل المتوقع لا يولّد قيداً أبداً** ⇒ تطبيق مباشر للقسم 7: «لا تُضاف المبالغ المتوقعة إلى الرصيد المتاح قبل تسجيل استلامها» |
| `budgetPeriods` | ✗ (ميزانيات المصروف فقط) |
| `obligations` / `debts` / `financialGoals` | ✗ |
| الفحوص | `X > 0`؛ `A.isPostable`؛ `income.{s}.type === 'income'`؛ **لا فحص حدّ رصيد** (الرصيد يزيد) |

### R3 — «التحويل بين حسابين لا يغيّر إجمالي الأموال المملوكة»

**بلا عمولة:** `Dr asset.{to} X` / `Cr asset.{from} X` — `kind: 'transfer'`
**بعمولة `f`:** `Dr asset.{to} X` / `Dr expense.fees f` / `Cr asset.{from} (X+f)` — **ثلاثة سطور، قيد واحد**

| الكيان | الأثر |
|---|---|
| `accounts` | `from`: `−(X+f)`. `to`: `+X`. `expense.fees`: `+f` |
| النقد المتاح | **`−f` فقط** (صفر إن لا عمولة) ⇒ **القاعدة محقَّقة بنيوياً** |
| `periods/{pk}` | `totalIncomeMinor`: **لا يتغير**. `totalExpenseMinor += f` **فقط**. `transferVolumeMinor += X`. `netCashFlowMinor −= f` |
| `budgetPeriods` | `expense.fees` إن كان لها ميزانية: `+f` فقط |
| لماذا مضمون؟ | التقارير تشتق الدخل والمصروف من **نوع الحساب في السطر**، لا من `kind`. ولأن طرفي التحويل كلاهما `asset`، **من المستحيل بنيوياً** أن يدخل التحويل في الدخل أو المصروف. جواب مباشر على القاعدة 19.11 |
| الفحوص | `from !== to` ⇒ `SAME_ACCOUNT_TRANSFER`؛ `from.balance − (X+f) ≥ from.minBalanceMinor`؛ كلاهما `type === 'asset'` و`isPostable`؛ `X > 0`, `f ≥ 0` |
| العرض | **عملية واحدة** في السجل (لا عمليتان)، بـ `refs.transferPairKey` للتوافق مع التصدير |

### R4 — «إنشاء التزام غير مدفوع لا يخفض الرصيد النقدي»

**القرار:** إنشاء الالتزام **لا يولّد قيداً إطلاقاً**. يُنشأ مستند `obligations/{id}` فقط.

| الكيان | الأثر |
|---|---|
| `accounts` / `postings` / `journalEntries` | ✗ — **لا قيد** |
| النقد المتاح | ✗ **بلا تغيير** ✓ (القاعدة محقَّقة بنيوياً: لا قيد = لا أثر) |
| صافي الثروة | ✗ — الالتزام يُعرض كمعلومة التزام لا كخصم محاسبي |
| `periods` / `budgetPeriods` | ✗ حتى الدفع |
| لوحة التحكم | «الالتزامات القادمة/المتأخرة» و«إجمالي الالتزامات المستحقة» تقرأ `obligations` مباشرة |
| الفحوص | `totalMinor > 0`؛ `extraChargesMinor >= 0`؛ `dueDate` صالح؛ `categoryId` موجود ونشط عند `nature=='expense'`؛ `nature` إلزامي |

**لماذا لا قيد استحقاق (accrual) حتى كخيار؟** الاستحقاق هو الصواب المحاسبي لكنه يعطي المستخدم الشخصي
رقماً لا يريده: إنشاء التزام إيجار سنوي يرفع «مصروفات هذا الشهر» 9,600 د.ل بلا أي مال خرج — ويناقض
القسم 4 والقسم 12. **الالتزام توقّع، فمكانه قسم التوقعات لا قائمة المصروفات.**
**المقابل المدفوع صراحةً:** تقاريرنا **نقدية الأساس**، فالتزام ديسمبر المدفوع في يناير يظهر مصروف يناير.
هذا مقبول ومُوثَّق ومُعلَن للمالك. والمديونية الحقيقية (قرض، شراء بالأجل) تنتمي إلى `debts` وإلى حساب
خصوم حقيقي — وهذا **هو** مسار الاستحقاق حيث يكون صحيحاً. وأقساط التمويل يغطيها `nature: 'financing'`.

### R5 — «دفع التزام يخفض الرصيد ويسجل الدفعة المرتبطة»

**القيد يعتمد على `nature` — وهذا أهم تمييز في الجدول كله (ADR-011):**

| `nature` | القيد | `kind` |
|---|---|---|
| `'expense'` | `Dr expense.{obligation.categoryId} X` / `Cr asset.{A} X` | `obligationPayment` |
| `'financing'` | `Dr liability.financing.{payeeContactId} X` / `Cr asset.{A} X` | `obligationPayment` |

مع `refs.obligationId = id` و`refs.obligationInstallmentIndex` إن كان قسطاً.
في `'financing'`: يُنشأ حساب `liability.financing.{payeeContactId}` **تلقائياً عند أول دفعة** إن لم يوجد.

| الكيان | الأثر الدقيق |
|---|---|
| `accounts` | `A`: `−X`. و`expense.{cat}`: `+X` (expense) **أو** `liability.financing.{c}`: `−X` (financing — الخصم ينقص) |
| `postings` | رجل النقد تحمل `settlementDeltaMinor = +X` و`obligationId = id` ⇒ I5b قابل للتحقق خادمياً |
| النقد المتاح | `−X` في الحالتين |
| صافي الثروة | `−X` (expense) / **`0`** (financing — نقد ينقص وخصم ينقص) |
| الالتزام | `paidMinor = مقروء + X` **(قيمة مطلقة محسوبة)**؛ `remainingMinor = totalMinor + extraChargesMinor − paidMinor` **(يُعاد حسابه من الأطراف الثلاثة، لا يُطرح من المخزَّن)**؛ `paymentCount += 1`؛ `lastPaymentEntryId`؛ `status = obligationStatus(...)` بدالة 10.2 |
| سجل الدفعات | **لا مجموعة ولا مصفوفة** — استعلام `journalEntries where refs.obligationId == id order by bookedAtTs` (ADR-005) |
| التكرار | **✗ — لا تُنشأ أي دورة هنا إطلاقاً** (ADR-013). الدورات تُولَّد من `recurrences` بمُشغِّل الاستدراك |
| `periods/{pk}` | `obligationPaidMinor += X` **في الحالتين**. و(expense) `totalExpenseMinor += X` + `expenseByCategory[cat] += X` + `netCashFlowMinor −= X`؛ و(financing) `financingPaidMinor += X` + `netCashFlowMinor −= X` و**`totalExpenseMinor` لا يتغير** |
| `budgetPeriods` | (expense) `spentMinor` كأي مصروف + منطق التنبيه؛ **(financing) ✗ — الميزانية لا تُلمس** |
| مصاريف المنزل | إن موسوماً `household` و`nature=='expense'`: `householdExpenseMinor += X` |
| `debts` / `financialGoals` | ✗ |
| التنبيهات | إشعار «سُدِّد بالكامل» أو «سُدِّد جزئياً، المتبقي Y»؛ وإلغاء تنبيه الاستحقاق المعلّق |
| الفحوص | **`X ≤ remainingMinor`** وإلا `OVERPAYMENT` (مع مسار التجاوز في 11.3)؛ `X > 0`؛ حدّ رصيد `A`؛ `obligation.status ∉ {cancelled, paid}`؛ `nature=='financing' ⇒ payeeContactId` موجود |

### R6 — «تسجيل دين على المستخدم لا يعني بالضرورة حركة نقدية»

ثلاث حالات مختلفة تماماً، ولكل منها قيد مختلف — **وهذا بالضبط ما يبرّر القيد المزدوج:**

| الحالة | القيد | `kind` | النقد المتاح | الخصوم |
|---|---|---|---|---|
| **(أ) قرض نقدي مستلم** | `Dr asset.{A} X` / `Cr liability.payable.{contactId} X` | `borrow` | **`+X`** | `+X` |
| **(ب) دين بلا نقد** (شراء بالأجل) | `Dr expense.{cat} X` / `Cr liability.payable.{contactId} X` | `borrow` | ✗ | `+X` |
| **(ج) دين قائم سابقاً** (افتتاحي) | `Dr equity.opening X` / `Cr liability.payable.{contactId} X` | `opening` | ✗ | `+X` |

| الكيان | الأثر |
|---|---|
| `accounts` | `liability.payable.{contactId}`: `creditTotalMinor += X` ⇒ `+X`. ويُنشأ الحساب **تلقائياً** عند أول دين لهذا الشخص |
| `periods/{pk}` | `borrowedMinor += X`. **`totalIncomeMinor` لا يتغير مطلقاً** — القرض ليس دخلاً (19.11) |
| لماذا مضمون؟ | الطرف المقابل حساب `liability` **لا `income`**. التقرير يشتق الدخل من **نوع الحساب** ⇒ **استحالة بنيوية** لتضخّم الدخل. (قارن بتصميم يضع `type:'income', subtype:'debtDrawdown'`: أول استعلام طبيعي `where type=='income'` يضخّم الدخل بأصل كل قرض) |
| `debts` | `debts/{id}`: `direction:'payable'`, `principalMinor: X`, `settledMinor: 0`, `remainingMinor: X`, `createdCash: (الحالة أ)`, `accountId: liability.payable.{contactId}` |
| صافي الثروة | (أ) **`0`** (نقد ↑ وخصوم ↑) / (ب) `−X` (مصروف حقيقي) / (ج) `−X` (يُصحِّح حقوق الملكية الافتتاحية) |
| `budgetPeriods` | (ب) فقط: `spentMinor += X` |
| التقارير | «الديون عليّ»، الالتزامات، صافي الثروة. **لا يظهر في المصروفات** إلا في (ب) حيث يوجد مصروف حقيقي |
| الفحوص | `X > 0`؛ `contactId` موجود؛ (أ) `A.isPostable` |

### R7 — «تحصيل دين يرفع رصيد الحساب المستلم»

**القيد:** `Dr asset.{A} X` / `Cr asset.receivable.{contactId} X` — `kind: 'debtCollection'`

| الكيان | الأثر |
|---|---|
| `accounts` | `A`: `+X`. `asset.receivable.{c}`: `creditTotalMinor += X` ⇒ **`−X`** |
| `postings` | رجل المستحق تحمل `settlementDeltaMinor = +X` و`debtId = id` ⇒ I6b خادمي |
| النقد المتاح | **`+X`** (لأن `A.isCashLike` و`receivable.isCashLike = false`) |
| صافي الثروة | **`0`** — أصل غير سائل تحوّل إلى سائل. مطلب ضمني في القسم 10 |
| `periods/{pk}` | `collectedMinor += X`. **`totalIncomeMinor` لا يتغير** و**`netCashFlowMinor` لا يتغير** — التحصيل ليس دخلاً (19.7 + 19.11). بطاقة «الأموال المتاحة» ترتفع من لقطة الحسابات لا من `periods` |
| `debts` | `settledMinor = مقروء + X`، `remainingMinor = principal − settled − writtenOff`، `settlementCount += 1`، `lastSettlementEntryId`، `status`: `remaining === 0 ⇒ 'settled'` وإلا `'partiallySettled'` |
| `budgetPeriods` / `financialGoals` | ✗ |
| التنبيهات | إلغاء تنبيه «حان التحصيل»؛ إشعار «حُصِّل بالكامل/جزئياً» |
| الفحوص | **`X ≤ debt.remainingMinor`** وإلا `OVER_COLLECTION`؛ `X > 0`؛ `debt.direction === 'receivable'`؛ `debt.status ∉ {settled, cancelled, writtenOff}`؛ و**`receivable.balanceMinor ≥ X`** (يمنع حساب مستحق سالباً) |

**الإقراض (نشوء دين لي):** `Dr asset.receivable.{c} X` / `Cr asset.{A} X` — `kind: 'lend'`.
النقد `−X`، صافي الثروة `0`، **ولا مصروف** (19.11)، `periods.lentMinor += X`.
**شطب المستحق:** `Dr expense.baddebt X` / `Cr asset.receivable.{c} X` — `kind: 'debtWriteOff'`.
**هنا فقط يصبح مصروفاً**، و`debt.writtenOffMinor += X`, `status = 'writtenOff'` إن شُطب الكل.

### R8 — «سداد دين يخفض رصيد الحساب المستخدم للدفع»

**القيد:** `Dr liability.payable.{contactId} X` / `Cr asset.{A} X` — `kind: 'debtRepayment'`

| الكيان | الأثر |
|---|---|
| `accounts` | `liability.payable.{c}`: `debitTotalMinor += X` ⇒ **`−X`** (الخصم ينقص). `A`: `−X` |
| `postings` | رجل الخصم تحمل `settlementDeltaMinor = +X` و`debtId = id` |
| النقد المتاح | `−X` |
| صافي الثروة | **`0`** — نقد ينقص وخصم ينقص بالقدر نفسه |
| `periods/{pk}` | `repaidMinor += X`. **`totalExpenseMinor` لا يتغير** — السداد ليس مصروفاً (19.11) |
| `budgetPeriods` | **✗ — السداد لا يستهلك الميزانية.** فرق جوهري عن R1 وسبب وجود `kind` منفصل |
| `debts` | `settledMinor` و`remainingMinor` و`status` و`settlementCount` كما في R7 |
| الفوائد/الزيادة `i` | ثلاثة سطور: `Dr liability.payable X` / `Dr expense.finance i` / `Cr asset.{A} (X+i)`. **الزيادة مصروف حقيقي، الأصل لا** — و`settlementDeltaMinor = +X` على رجل الخصم فقط |
| الفحوص | **`X ≤ debt.remainingMinor`** وإلا `OVERPAYMENT`؛ حدّ رصيد `A`؛ `debt.direction === 'payable'` |

### R9 — «المبالغ المستحقة للتحصيل لا تُعرض ضمن النقد المتاح»

**التطبيق:** حقل `isCashLike` على الحساب. `asset.receivable.*` ⇒ `isCashLike: false`
**ويُفرض في قواعد الأمان** (لا يُسمح بإنشاء حساب `subtype: 'receivable'` بـ `isCashLike: true`).

```ts
export const availableCashMinor = (accounts: Account[]): Minor =>
  sumMinor(accounts.filter(a => a.isCashLike && a.status === 'active' && a.isPostable)
                   .map(a => a.balanceMinor as Minor));

export const spendableCashMinor = (accounts: Account[]): Minor =>
  sumMinor(accounts.filter(a => a.isCashLike && a.status === 'active' && a.isPostable)
                   .map(a => (a.balanceMinor - a.earmarkedMinor) as Minor));

export const totalReceivablesMinor = (accounts: Account[]): Minor => /* subtype==='receivable' */;
export const totalPayablesMinor    = (accounts: Account[]): Minor => /* subtype∈{payable,financing} */;
export const netWorthMinor         = (accounts: Account[]): Minor => /* الأصول − الخصوم */;
```

لوحة التحكم تعرض **أرقاماً منفصلة بوضوح**: «الأموال المتاحة»، «المتاح بعد حجز الأهداف»، «المستحق لي»،
«الديون عليّ» — **ولا تجمعها في رقم واحد**. والنصّ التوضيحي تحت «الأموال المتاحة» إلزامي:
«لا يشمل المبالغ المستحقة لك».

### R10 — «تعديل/إلغاء عملية معتمدة بطريقة تحفظ الأثر التاريخي وتمنع تضارب الأرصدة»

| المطلب | آلية التطبيق |
|---|---|
| حفظ الأثر التاريخي | القيد غير قابل للتغيير + قيد عكس + قيد بديل + `correctionGroupId` + `auditLogs` |
| منع تضارب الأرصدة | العكس والبديل وكل المُجمَّعات في **معاملة واحدة** بدلتا **صافية** |
| منع العكس المزدوج | `opId` حتمي `rev:{entryId}` + **قفل ذرّي** `entryCorrections/{entryId}` (ADR-014) |
| منع تعديل التصحيح نفسه | `kind: 'reversal'` لا يُعكس ولا يُعدَّل — مفروض في القواعد وفي النطاق |
| منع التصحيح بأثر رجعي على فترة مُقفلة | `periodLocks` + سياسة التاريخ في 8.3 + حقول تصحيح الفترة السابقة |
| **منع رصيد سالب ناتج عن العكس** | `assertBalanceFloor` على **دلتا العكس** (8.4) |

### R11 — «التمييز بين التحويلات والاقتراض والسداد والدخل الحقيقي والمصروف الحقيقي»

**هذه القاعدة هي سبب اختيار القيد المزدوج، وتطبيقها بنيوي لا شرطي:**

```ts
/** الدخل والمصروف في كل التقارير يُشتقّان من **نوع الحساب في السطر**،
 *  لا من kind ولا من أي حقل تصنيف ولا من إشارة المبلغ. */
export function classifyLineForReports(line: JournalLine): 'income' | 'expense' | 'neutral' {
  if (line.accountType === 'income')  return 'income';
  if (line.accountType === 'expense') return 'expense';
  return 'neutral';                    // asset | liability | equity
}
```

| نوع العملية | يمسّ `income`؟ | يمسّ `expense`؟ | النتيجة في التقرير |
|---|---|---|---|
| مصروف | لا | **نعم** | مصروف |
| دخل | **نعم** | لا | دخل |
| تحويل | لا | لا (إلا العمولة) | محيَّد |
| اقتراض نقدي (أ) | لا | لا | محيَّد — نقد ↑ وخصوم ↑ |
| شراء بالأجل (ب) | لا | **نعم** | مصروف حقيقي بالفعل |
| سداد دين | لا | لا (إلا الفوائد) | محيَّد |
| إقراض | لا | لا | محيَّد |
| تحصيل | لا | لا | محيَّد |
| شطب مستحق | لا | **نعم** (`expense.baddebt`) | مصروف |
| دفع التزام `nature='expense'` | لا | **نعم** | مصروف |
| **دفع التزام `nature='financing'`** | لا | **لا** | **محيَّد — خصم ينقص** |
| تخصيص لهدف | لا | لا | محيَّد (داخل حقوق الملكية) |
| تسوية | لا | لا | محيَّد (مقابل `equity.adjustment`) |
| احتساب زكاة | لا | لا | محيَّد — خصم مستحق فقط (15.4) |
| دفع زكاة | لا | **نعم** (`expense.charity`) | مصروف |
| عكس | يعكس الأصل | يعكس الأصل | **يُصفِّر أثر الأصل رياضياً** |

**الضمان:** لا يوجد في النظام أي شرط `if (kind === 'transfer') skip` في منطق التقارير.
استبعاد التحويل من المصروفات **ليس قراراً برمجياً بل نتيجة لعدم وجود حساب مصروف في القيد**.
حقل `kind` للعرض والتصفية والتدقيق فقط، **ولا يُستخدم أبداً في حساب رقم** — وهذا مفروض بأداة البناء.

---

## 10. آلات الحالة

### 10.1 القيد (`JournalEntry`)

```
                    ┌──────────────────────────────────────┐
                    │                                      │
   [create]         ▼                                      │
  ──────────►  ( posted )                                  │
                  │   │                                    │
    voidTransaction│   │editTransaction                     │
                  │   │                                    │
                  ▼   ▼                                    │
          ( reversed ) ( replaced )                        │
                  │          │                             │
                  └──────────┴──► نهائية: لا انتقال بعدها  │
                                                           │
   قيد العكس نفسه: ( posted ) ◄────────────────────────────┘
   ولا يمكن أن ينتقل أبداً (kind='reversal' لا يُعكس ولا يُعدَّل)
```

| من | إلى | الشرط | المحرِّك |
|---|---|---|---|
| — | `posted` | `entryShapeOk` + التوازن + الفترة غير مُقفلة + `rebuildStatus != 'running'` | `postOperation` |
| `posted` | `reversed` | لا `entryCorrections/{id}` + `kind != 'reversal'` + حاجز الرصيد على دلتا العكس | `voidTransaction` |
| `posted` | `replaced` | نفس شروط العكس + مسودة بديلة صالحة | `editTransaction` |
| `reversed` / `replaced` | — | **لا انتقال. نهائية.** | — |

**ممنوع بنيوياً:** `posted → posted` (لا تعديل محاسبي في مكانه)، `reversed → posted` (لا «تراجع عن
الإلغاء» — بل قيد جديد)، وأي انتقال على `kind == 'reversal'`.

### 10.2 الالتزام (`Obligation`)

```ts
/** دالة نقية. الحالة **تُخزَّن** للفهرسة لكنها **تُحسب دائماً بهذه الدالة**. */
export function obligationStatus(
  o: Pick<Obligation, 'paidMinor' | 'totalMinor' | 'extraChargesMinor' | 'dueDate'>,
  today: DateKey,
  cancelled: boolean
): ObligationStatus;
```

**جدول الأولوية — الشروط تُقيَّم بهذا الترتيب بالضبط وأول صفٍّ يتحقق يفوز:**

| # | الشرط | الحالة |
|---|---|---|
| 1 | `cancelled` | `cancelled` |
| 2 | `paidMinor >= totalMinor + extraChargesMinor` | `paid` |
| 3 | `paidMinor > 0 && today > dueDate` | `overdue` ← **المتأخر يغلب المسدَّد جزئياً (أولوية التنبيه)** |
| 4 | `paidMinor > 0` | `partiallyPaid` |
| 5 | `today > dueDate` | `overdue` |
| 6 | `today === dueDate` | `due` |
| 7 | غير ذلك | `upcoming` |

**الصف 3 ليس تفصيلاً:** «مسدَّد جزئياً ومتأخر» يجب أن يظهر في «المتأخرة» لا في «مسدَّد جزئياً»،
وإلا اختفى من شاشة المتابعة. و`partiallyPaid` يُعرض **كشارة ثانية** إلى جانب `overdue`.

**البعد الزمني يُشتقّ عند العرض:** `due`/`overdue` دالّة في **الوقت** لا في الأحداث. لذلك:

- الاستعلام `where remainingMinor > 0 && dueDate < today` يعطي «المتأخرة» بدقة **بلا أي دالة مجدولة**
  — وهذه إحدى نقاط Spark المحلولة مجاناً (ق-1).
- ومهمة خفيفة عند **أول فتح للتطبيق كل يوم** تكتب فقط المستندات التي تغيّرت حالتها، باستعلام
  `where status in ['upcoming','due','partiallyPaid'] && dueDate < today` ⇒ `writeBatch`.

### 10.3 الدين (`Debt`) — الاتجاهان

```
                       [createDebt]
                            │
                            ▼
                        ( open ) ──────────── writeOff (receivable فقط) ──────► ( writtenOff )
                         │     ▲                                                     │
      payDebt/collectDebt│     │ عكس دفعة                                           │ عكس
                         ▼     │                                                     ▼
                ( partiallySettled )                                            ( open/partially )
                         │     ▲
      آخر دفعة (rem = 0) │     │ عكس دفعة
                         ▼     │
                     ( settled )

      ( open ) ── عكس قيد النشوء، بشرط settlementCount == 0 ──► ( cancelled )  [نهائية]
```

| من | إلى | الشرط |
|---|---|---|
| — | `open` | `principalMinor > 0`، `contactId` موجود |
| `open` / `partiallySettled` | `partiallySettled` | `0 < settled + writtenOff < principal` |
| `open` / `partiallySettled` | `settled` | `remainingMinor === 0` |
| `open` / `partiallySettled` | `writtenOff` | `direction === 'receivable'` + شطب يغطي المتبقي |
| `settled` / `partiallySettled` | `open` / `partiallySettled` | **عكس دفعة** يُعيد حساب الحالة |
| `open` | `cancelled` | عكس قيد النشوء **و`settlementCount === 0`** وإلا `DEBT_HAS_SETTLEMENTS` |
| `cancelled` | — | نهائية |

**ممنوع:** `settled → settled` بدفعة إضافية (`OVERPAYMENT`)، وتجاوز `principalMinor` بأي حال
(`allowOverSettle: false` ثابت غير قابل للتفعيل).

### 10.4 التكرار (`RecurrenceRule`) والدورة

```
قالب التكرار:        ( active ) ⇄ ( paused ) ──► ( ended )
                         │                          ▲
                         │  endDate / maxOccurrences│
                         └──────────────────────────┘

الدورة الواحدة (مادّية بمفتاح حتمي):
  لم تُمادَّ ──[materializeRecurring + opId = rec|obl:{id}:{dueDate}]──► مُمادّة (مرة واحدة إلى الأبد)
```

| من | إلى | الشرط | المحرِّك |
|---|---|---|---|
| — | `active` | `frequency` + `startDate` صالحان | إنشاء القالب |
| `active` | `paused` | قرار المستخدم | الواجهة |
| `paused` | `active` | قرار المستخدم. **الدورات الفائتة أثناء الإيقاف لا تُمادّ تلقائياً** بل تُعرض كقائمة «مواعيد فائتة» يختار منها | الواجهة |
| `active` | `ended` | `today > endDate` أو بلوغ `maxOccurrences` | مُشغِّل الاستدراك |

**حد الاستدراك:** `maxBackfillDays = 120` افتراضياً. ما قبله يُعرض كقائمة «مواعيد فائتة» يختار منها
المستخدم — لأن إنشاء 300 قيد صامت بعد غياب شهور **سلوك سيئ** ويُفسد التقارير بلا موافقة.

---

## 11. الحوارس وأخطاء النطاق

### 11.1 أخطاء النطاق — في مكان واحد، بالعربية

```ts
// domain/errors/DomainError.ts
export type DomainErrorCode =
  // بنية القيد
  | 'UNBALANCED_ENTRY' | 'TOO_FEW_LINES' | 'TOO_MANY_LINES'
  | 'NON_POSITIVE_AMOUNT' | 'NON_INTEGER_AMOUNT' | 'AMOUNT_OUT_OF_RANGE'
  // الحسابات
  | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_NOT_POSTABLE' | 'ACCOUNT_ARCHIVED'
  | 'ACCOUNT_TYPE_MISMATCH' | 'SAME_ACCOUNT_TRANSFER' | 'CURRENCY_MISMATCH'
  // حدّ الرصيد
  | 'NEGATIVE_BALANCE_NOT_ALLOWED'      // minBalanceMinor === 0
  | 'BALANCE_BELOW_FLOOR'               // minBalanceMinor < 0 وتجاوزناه
  // التسويات
  | 'OVERPAYMENT' | 'OVER_COLLECTION' | 'OVER_WRITEOFF'
  // دورة الحياة
  | 'ORPHAN_REFERENCE' | 'OP_ID_CONFLICT' | 'ENTRY_NOT_POSTED'
  | 'ALREADY_CORRECTED' | 'CANNOT_REVERSE_REVERSAL' | 'DEBT_HAS_SETTLEMENTS'
  | 'OPENING_HAS_SUBSEQUENT_ENTRIES'
  // الفترات والنظام
  | 'PERIOD_LOCKED' | 'REBUILD_IN_PROGRESS' | 'SCHEMA_VERSION_AHEAD'
  | 'INTEGRITY_DOC_MISSING' | 'TRIAL_BALANCE_BROKEN';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly messageAr: string,
    readonly details?: Record<string, unknown>,
    readonly retryable: boolean = false
  ) { super(code); }
}
```

**جدول الرسائل العربية الكامل** في `domain/errors/messages.ar.ts` — كل رسالة تذكر **الرقم والسبب
والخطوة التالية**، لا كلمة «خطأ» مجرَّدة (القسم 25 بند 18):

| الرمز | الرسالة |
|---|---|
| `NEGATIVE_BALANCE_NOT_ALLOWED` | «رصيد حساب «{accountName}» {available} د.ل لا يكفي لمبلغ {required} د.ل.» |
| `BALANCE_BELOW_FLOOR` | «هذه العملية تُنزل حساب «{accountName}» إلى {after} د.ل، والحد الأدنى المسموح {floor} د.ل.» |
| `OVERPAYMENT` | «المبلغ أكبر من المتبقي. المتبقي على «{name}» هو {remaining} د.ل.» |
| `OVER_COLLECTION` | «المبلغ أكبر من المتبقي للتحصيل. المتبقي لدى «{name}» هو {remaining} د.ل.» |
| `OP_ID_CONFLICT` | «هذه العملية سُجّلت بمحتوى مختلف. لتغييرها استخدم التعديل.» |
| `ALREADY_CORRECTED` | «صُحِّح هذا القيد من جهاز آخر — اعرض النسخة الحديثة.» |
| `PERIOD_LOCKED` | «شهر {periodKey} مُقفل. سيُسجَّل التصحيح بتاريخ اليوم ويظهر كتصحيح فترة سابقة.» |
| `REBUILD_IN_PROGRESS` | «جارٍ إعادة حساب الأرصدة — لا يمكن تسجيل عمليات الآن.» |
| `DEBT_HAS_SETTLEMENTS` | «لا يمكن إلغاء هذا الدين لوجود {n} دفعة مسجَّلة. ألغِ الدفعات أولاً.» |
| `SCHEMA_VERSION_AHEAD` | «بيانات حسابك أحدث من نسخة التطبيق على هذا الجهاز. حدِّث التطبيق للمتابعة.» |
| `TRIAL_BALANCE_BROKEN` | «اكتُشف خلل في ميزان المراجعة. تسجيل العمليات موقوف حتى الإصلاح — افتح «الإعدادات ← سلامة البيانات».» |

### 11.2 حدّ الرصيد (`minBalanceMinor`)

| الطبقة | الإجراء |
|---|---|
| الواجهة (استباقي) | عرض «المتاح للإنفاق» بجانب حقل المبلغ وتحذير لحظي عند التجاوز. **ليست حماية** (القسم 20) |
| **طبقة النطاق** (الفعّالة) | `assertBalanceFloor(account, netDelta)` داخل `planOperation` على **الدلتا الصافية** |
| **المعاملة** | الفحص على القيمة المقروءة **داخل** `runTransaction` ⇒ لا سبق شرطي (race) بين جهازين |
| **قواعد الأمان** (شبكة أمان) | `request.resource.data.balanceMinor >= resource.data.minBalanceMinor` — **حدّ مطلق ممكن تماماً ورخيص**، وهو شبكة ضد أي مسار كتابة التفّ على `postOperation` |

```ts
export function assertBalanceFloor(acc: Account, netDeltaMinor: Minor): Result<void, DomainError> {
  const after = acc.balanceMinor + netDeltaMinor;
  if (after >= acc.minBalanceMinor) return ok();
  return err(acc.minBalanceMinor === 0
    ? 'NEGATIVE_BALANCE_NOT_ALLOWED'
    : 'BALANCE_BELOW_FLOOR', { acc, after });
}
```

**ما يُفحص وما لا يُفحص:**

- **يُفحص:** كل حساب `asset` بـ `isCashLike === true` (النقد، المصرف، المحفظة) — في كل عملية **بما فيها
  قيد العكس** (8.4).
- **لا يُفحص:** `expense` / `income` / `equity` (لا معنى لسلبها)، و`receivable`/`payable` (سلبها يُمنع
  بفحص السداد الزائد لا بحدّ الرصيد).
- **الاستيراد التاريخي يتخطى الفحص** (`skipBalanceGuard: true`)، ويُشغَّل بعده فاحص يُبلِّغ عن كل لحظة
  سلبية تاريخية — **إبلاغ لا منع** (القصور المُعلَن في 18.1).

**التمييز الدلالي الذي يجب ألا يُدمج (ADR-017):**

| الحالة | السلوك | الرسالة |
|---|---|---|
| `balance − X < earmarkedMinor` لكن `≥ minBalanceMinor` | **تحذير ويمضي** — المال ملك المستخدم وله تعطيل حجز هدفه | «رصيد الحساب يكفي، لكن المتاح للإنفاق {spendable} د.ل بعد حجز الأهداف. هل تمضي؟» |
| `balance − X < minBalanceMinor` | **منع** | `NEGATIVE_BALANCE_NOT_ALLOWED` / `BALANCE_BELOW_FLOOR` |

دمجهما في فحص واحد **خطأ دلالي**: الأول قرار مستخدم والثاني قيد نظام.

### 11.3 السداد/التحصيل الزائد

```ts
export function assertNotOverSettled(
  target: { nameAr: string; dueMinor: Minor; settledMinor: Minor; allowOver: boolean },
  deltaMinor: Minor
): Result<void, DomainError> {
  const remaining = (target.dueMinor - target.settledMinor) as Minor;
  if (!target.allowOver && deltaMinor > remaining) return err('OVERPAYMENT', { target, remaining });
  return ok();
}
```

**خمس قواعد صلبة:**

1. **`remainingMinor` لا يُقرأ من المستند للفحص**، بل يُحسب
   `totalMinor + extraChargesMinor − paidMinor` من نفس اللقطة المقروءة في المعاملة.
   المخزَّن للعرض والاستعلام فقط ⇒ تحصين ضد انحراف المشتق المخزَّن.
2. **الديون: `allowOverSettle = false` ثابت غير قابل للتفعيل.** دفع أكثر من الدين ليس سداداً زائداً
   بل **عمليتان** (سداد + إقراض جديد)، وعلى الواجهة أن تقترح ذلك صراحةً.
3. **الالتزامات — مسار التجاوز المعتمد (ADR-012).** عند `X > remaining`، الواجهة تعرض **خيارين صريحين
   لا تقريباً صامتاً:**

   > «المبلغ المُدخل 950.000 د.ل يتجاوز المتبقي 800.000 د.ل بمقدار 150.000 د.ل.»
   > ◻ **سدّد المتبقي فقط** (800.000 د.ل)
   > ◻ **سجّل الزائد كرسوم إضافية** — والسبب: [ غرامة تأخير / قراءة عداد أعلى / … ] ← **إلزامي**

   الخيار الثاني يكتب في نفس المعاملة: `extraChargesMinor += 150000`,
   `extraChargesReason = السبب`, `paidMinor += 950000`, و`auditLogs: 'extraChargesAdded'`.
   **و`totalMinor` لا يتغير أبداً** ⇒ العقد الأصلي يبقى مرئياً والغرامة تبقى بنداً مستقلاً في التقرير.
4. السداد الصفري أو السالب مرفوض (`NON_POSITIVE_AMOUNT`).
5. **الأقساط:** `X ≤ installment.amountMinor − installment.paidMinor` **بالإضافة** إلى فحص الإجمالي.

### 11.4 الحركة اليتيمة — خمس طبقات

| # | نوع اليُتم | المنع |
|---|---|---|
| 1 | سطر بلا قيد / قيد بلا سطور | **مستحيل بنيوياً**: السطور مضمَّنة في المستند |
| 2 | قيد غير متوازن | `assertBalanced()` في النطاق + فحص `totalDebitMinor == totalCreditMinor` و`lines.size() >= 2` في **قواعد الأمان** |
| 3 | سطر يشير إلى حساب غير موجود/مؤرشف/غير قابل للترحيل | كل الحسابات المرجوّة تُقرأ في مرحلة القراءة وتُفحَص ⇒ `ACCOUNT_NOT_FOUND` / `ACCOUNT_ARCHIVED` / `ACCOUNT_NOT_POSTABLE`. ولأن `tx.get` لا يقبل استعلامات، المعرّفات تأتي من لقطة الحسابات الحيّة ثم **تُعاد قراءتها** داخل المعاملة |
| 4 | قيد يشير إلى التزام/دين/هدف غير موجود (`refs`) | المرجع يُقرأ في مرحلة القراءة **إلزامياً** ⇒ `ORPHAN_REFERENCE`. ويُفحَص وجوده أيضاً في القواعد بـ `exists()` |
| 5 | التزام/دين «مسدَّد» بلا قيود تدعمه، أو `postings` بلا أثر في المُجمَّع | **I5b و I6b** (تجميع خادمي بقراءتين) + ميزان المراجعة I4 + `balanceVersion`/`entryCount` + الفاحص الدوري |

**«عملية غير مكتملة» (القسم 19):** غير ممكنة — الترحيل كله في معاملة ذرّية واحدة.
الحالة الوحيدة المتبقية عملية **لم تُرحَّل بعد** في `pendingCommands`، وهي معروضة بوضوح
كـ«بانتظار المزامنة» و**مستبعدة من كل الأرصدة والتقارير**.

### 11.5 جرد مصادر الانحراف — جدول تهديدات صريح

**من منظور سلامة البيانات، هذا الجدول هو الوثيقة التي تُراجَع عند كل ميزة جديدة.**
كل صف يتحوّل إلى اختبار في قسم 20.

| # | مصدر الانحراف | الاحتمال | الحاجز | الاختبار |
|---|---|---|---|---|
| **1** | **كتابة التفّت على المستودع الوحيد** (مسار كتابة ثانٍ، سكربت، Console) | **أعلى احتمال على الإطلاق** | ‏(أ) `postOperation` نقطة الكتابة المالية الوحيدة؛ (ب) **أداة البناء** تمنع استيراد `firebase/firestore` خارج `data/**` (قسم 21)؛ (ج) قواعد الأمان تفرض `entryShapeOk` و`balanceMinor >= minBalanceMinor`؛ (د) **ميزان المراجعة I4 يكشفه في أول تسجيل دخول** | T-DRIFT-1 |
| 2 | تحديث الرصيد بلا قيد | عالٍ | `getAfter()` تربط `lastEntryId` بقيد في نفس الـ commit (ADR-022، **غير معتمد قبل إثباته**) + I3 + I7 | T-DRIFT-2 |
| 3 | قيد بلا تحديث رصيد | عالٍ | المعاملة ذرّية + I4 (التوازن يختلّ فوراً) + I7 | T-DRIFT-3 |
| 4 | `increment` على حقل يُتخذ عليه قرار | متوسط | جدول 5.4 مُلزِم + قاعدة ESLint ترفض `increment` على `paidMinor`/`settledMinor`/`spentMinor` | T-DRIFT-4 |
| 5 | عكس حركة مرتين | متوسط | `opId` حتمي `rev:{id}` + **قفل ذرّي** `entryCorrections/{id}` | T-DRIFT-5 |
| 6 | تعديل `amountMinor` في مكانه | متوسط | القواعد: `lines` و`totalDebitMinor` و`bookedAt` و`kind` غير قابلة للتغيير | T-DRIFT-6 |
| 7 | تغيير `openingBalanceMinor` بعد وجود حركات | منخفض | القواعد: مشتق من قيد `opening` ولا يُكتب يدوياً؛ التصحيح بـ `adjustAccount` | T-DRIFT-7 |
| 8 | فشل جزئي (قيد كُتب والحساب لا) | **منخفض جداً** | `runTransaction` ذرّية — المكسب الأساسي | T-DRIFT-8 |
| 9 | تعارض كتابة من جهازين | منخفض | إعادة المحاولة التلقائية + المعرّفات الحتمية | T-DRIFT-9 |
| 10 | ترحيل مخطط يغيّر معنى حقل دون إعادة بناء المُجمَّعات | متوسط | ADR-019: القيود **لا تُرحَّل**، والمُجمَّعات كلها **قابلة لإعادة البناء** وكل ترحيل يستدعيها إلزامياً | T-DRIFT-10 |
| 11 | أرشفة حساب فيه حركات | منخفض | الأرشفة لا تمسّ الرصيد ولا تحذف القيود؛ `status='archived'` فقط، والترحيل عليه يُرفض | T-DRIFT-11 |
| **12** | **الازدواج الدلالي** (نفس المصروف من جهازين بـ `opId` مختلفين) | **متوسط ومتكرر عملياً** | `findNearDuplicates` (6.5) — **تحذير لا حجب** | T-DRIFT-12 |
| 13 | تعديل وصفي يحرّك مُجمَّعاً (`tags.household`) | متوسط | جدول 8.2: `household` مسار خاص يُحدِّث المُجمَّع في نفس المعاملة | T-DRIFT-13 |
| 14 | إنشاء مستند ميزانية بلا سقف بـ `merge+increment` | متوسط | قاعدة 4.7: لا كتابة ميزانية إن لم يوجد المستند/الفئة | T-DRIFT-14 |

**الخلاصة الصادقة:** الصفوف 1 و2 و3 كلها من نوع «مسار كتابة التفّ على القاعدة». الفرق الجوهري بين
هذا التصميم وأي تصميم أحادي الجانب أن **الثابت الرياضي I4 يكشفها بـ ~45 قراءة عند كل تسجيل دخول**،
بدل أن تبقى مخفية حتى يشتكي المستخدم من رصيد خاطئ.

---

## 12. الخوارزميات

**تمهيد يسري على كل الخوارزميات أدناه:**

```
قبل أي معاملة (خارجها، في data/):
  opId        ← من جدول 6.2
  bookedAt    ← من مُدخل المستخدم أو تاريخ اليوم المحلي
  periodKey   ← bookedAt.slice(0,7)                        [ADR-008]
  payloadHash ← await hashPayload(canonicalize(payload))
  deviceId, clientCreatedAt
  warnings    ← findNearDuplicates(draft, recentEntries, now)      [تحذير لا حجب]
  إدراج في pendingCommands/{opId} بـ status:'queued'                [ADR-007]

كل خوارزمية مكتوبة كـ TxPlan: reads → decide (نقية) → writes.        [7.2]
في نهاية كل معاملة ناجحة: pendingCommands/{opId}.status = 'applied'
```

### 12.1 `recordExpense`

```
reads:
  E  ← journalEntries/{opId}
  A  ← accounts/{fromAccountId}
  C  ← accounts/{categories[categoryId].expenseAccountId}
  B  ← budgetPeriods/{pk}                       (قد يكون غير موجود)
  L  ← periodLocks/{pk}                         (وجوده = مُقفلة)
  M  ← meta/integrity

decide:
  if M.rebuildStatus == 'running'          → err REBUILD_IN_PROGRESS
  if E exists:
      if E.payloadHash == payloadHash      → return { alreadyApplied: true, entryIds:[opId] }
      else                                 → err OP_ID_CONFLICT
  if L exists                              → err PERIOD_LOCKED
  assertPositiveInteger(X) ; assertInRange(X)
  assertPostable(A) ; assertPostable(C) ; assertType(C,'expense')
  assertBalanceFloor(A, -X)                     // منع
  if (A.balanceMinor - X) < A.earmarkedMinor    // تحذير فقط
      warnings += EARMARK_EXCEEDED(spendable)

  entry = {
    id: opId, opId, kind:'expense', status:'posted', bookedAt, periodKey,
    description, tags, refs,
    lines: [
      { lineNo:1, accountId:C.id, accountType:'expense', accountCode:C.code,
        side:'debit',  amountMinor:X, categoryId },
      { lineNo:2, accountId:A.id, accountType:'asset',   accountCode:A.code,
        side:'credit', amountMinor:X }
    ],
    accountIds:[C.id, A.id], accountTypes:['expense','asset'],
    totalDebitMinor:X, totalCreditMinor:X, amountMinor:X, currency:'LYD', payloadHash
  }
  assertBalanced(entry)                         // I1 — في النطاق قبل الكتابة
  assertLinesValid(entry)                       // I2

  postings = [
    { id:`${opId}__1`, accountId:C.id, accountType:'expense', side:'debit',
      amountMinor:X, signedAmountMinor:+X, settlementDeltaMinor:0, categoryId, … },
    { id:`${opId}__2`, accountId:A.id, accountType:'asset',  side:'credit',
      amountMinor:X, signedAmountMinor:-X, settlementDeltaMinor:0, … }
  ]

  budgetWrite = null
  if B exists AND B.categories[categoryId] exists:
      spentAfter   = B.categories[categoryId].spentMinor + X          // قيمة مطلقة محسوبة
      overallAfter = B.overallSpentMinor + X
      pct = ratioBps(spentAfter, B.categories[categoryId].limitMinor) / 100
      fire = pct >= alertAtPercent AND (alertFiredAtPercent == null OR pct > alertFiredAtPercent)
      budgetWrite = { spentAfter, overallAfter,
                      alertFiredAtPercent: fire ? pct : unchanged }
      if fire: warnings += BUDGET_THRESHOLD(categoryId, pct)
  // B غير موجود أو الفئة بلا سقف ⇒ **لا كتابة ميزانية إطلاقاً**   [4.7]

writes:
  1 create journalEntries/{opId}                        ← entry
  2 create postings/{opId}__1 , postings/{opId}__2
  3 update accounts/{C}  { debitTotalMinor:+X,  balanceMinor:+X,
                           entryCount:+1, balanceVersion:+1, lastEntryId:opId, lastPostedAt }
  4 update accounts/{A}  { creditTotalMinor:+X, balanceMinor:-X, … }
  5 set    accountPeriods/{C}__{pk} (merge) { accountId, accountType, periodKey,
                                              debitMinor:+X,  netMinor:+X,  entryCount:+1 }
  6 set    accountPeriods/{A}__{pk} (merge) { creditMinor:+X, netMinor:-X, entryCount:+1 }
  7 set    periods/{pk} (merge) {
             totalExpenseMinor:+X, 'expenseByCategory.{cat}':+X,
             netCashFlowMinor:-X, entryCount:+1, lastEntryAt:bookedAt,
             householdExpenseMinor: tags∋'household' ? +X : (بلا حقل) }
  8 if budgetWrite: update budgetPeriods/{pk} { قيم مطلقة }
  9 if fire: create notifications/{autoId}

النتيجة: 6 قراءات (منها 0 مدفوعة للحسابات لو كانت من اللقطة… لا: تُعاد قراءتها) / 9–11 كتابة
PostResult = { opId, entryIds:[opId], alreadyApplied:false,
               balancesAfter:{ [A.id]: A.balanceMinor - X }, warnings }
```

> **مثال رقمي كامل:** مصروف `25500` من `acc_cash_main` (رصيده `340000`)، فئة `cat_food`
> (`acc_exp_food`)، الميزانية `limit=200000, spent=118000, alertAt=80, fired=null`.
> `spentAfter = 143500` ⇒ `71.75% < 80%` ⇒ لا تنبيه.
> الرصيد: `340.000 → 314.500 د.ل`. `periods.totalExpenseMinor += 25500`.
> **الضغط مرتين:** المحاولة الثانية تتوقف عند قراءة `journalEntries/{opId}` (موجود،
> `payloadHash` مطابق) وتُرجع `{ alreadyApplied: true }` بـ **صفر كتابات**. لا رسالة خطأ، لا قيد ثانٍ.

### 12.2 `recordIncome`

```
reads:   E ← journalEntries/{opId} ; A ← accounts/{toAccountId} ;
         S ← accounts/{incomeSourceAccountId} ; L ← periodLocks/{pk} ; M ← meta/integrity ;
         H ← incomeSchedules/{id}   إن refs.incomeScheduleId

decide:  نفس حوارس 12.1 ما عدا حدّ الرصيد (**الرصيد يزيد ⇒ لا فحص**)
         assertType(S, 'income')
         lines: Dr A X  /  Cr S X
         postings: A → signed +X ; S → signed +X   (كلاهما في اتجاهه الطبيعي)
         if H: occurrence = { status:'received', entryId:opId, receivedMinor:X }

writes:  1 create journalEntries/{opId} + postings ×2
         2 update accounts/{A} { debitTotalMinor:+X, balanceMinor:+X, … }
         3 update accounts/{S} { creditTotalMinor:+X, balanceMinor:+X, … }
         4 set accountPeriods/{A}__{pk} { debitMinor:+X, netMinor:+X }
         5 set accountPeriods/{S}__{pk} { creditMinor:+X, netMinor:+X }
         6 set periods/{pk} { totalIncomeMinor:+X, 'incomeBySource.{s}':+X,
                              netCashFlowMinor:+X, entryCount:+1 }
         7 if H: update incomeSchedules/{id} { 'occurrences.{key}': occurrence }
         ✗ budgetPeriods — ميزانيات المصروف فقط
```

### 12.3 `transfer`

```
reads:   E ; From ← accounts/{fromId} ; To ← accounts/{toId} ;
         Fee ← accounts/'expense.fees'  إن f > 0 ; L ; M

decide:  if fromId == toId                    → err SAME_ACCOUNT_TRANSFER
         assertType(From,'asset') ; assertType(To,'asset')
         assertBalanceFloor(From, -(X + f))
         lines = f > 0
           ? [ Dr To X , Dr Fee f , Cr From (X+f) ]     // ثلاثة سطور، **قيد واحد**
           : [ Dr To X , Cr From X ]
         assertBalanced(entry)                          // X + f == X + f  ✓
         refs.transferPairKey = opId

writes:  1 create journalEntries/{opId} + postings ×(2 أو 3)
         2 update accounts/{From} { creditTotalMinor:+(X+f), balanceMinor:-(X+f), … }
         3 update accounts/{To}   { debitTotalMinor:+X,      balanceMinor:+X, … }
         4 if f>0: update accounts/{Fee} { debitTotalMinor:+f, balanceMinor:+f, … }
         5 set accountPeriods لكل حساب متأثر
         6 set periods/{pk} { transferVolumeMinor:+X,
                              totalExpenseMinor:+f, 'expenseByCategory.fees':+f,
                              netCashFlowMinor:-f, entryCount:+1 }
         // totalIncomeMinor **لا يتغير** — والسبب بنيوي: لا حساب income في القيد
```

### 12.4 `payObligation` (جزئي أو كامل)

```
reads:   E ← journalEntries/{opId}
         A ← accounts/{fromAccountId}
         O ← obligations/{obligationId}
         Counter ← nature=='expense' ? accounts/{expenseAccountOf(O.categoryId)}
                                     : accounts/{liability.financing.{O.payeeContactId}}
         B ← budgetPeriods/{pk}      (فقط إن nature=='expense')
         L ; M

decide:
  if M.rebuildStatus=='running' → err REBUILD_IN_PROGRESS
  if E exists → (payloadHash مطابق ? alreadyApplied : err OP_ID_CONFLICT)
  if L exists → err PERIOD_LOCKED
  if O.status ∈ {cancelled, paid} → err (رسالة عربية مناسبة)
  dueMinor  = O.totalMinor + O.extraChargesMinor
  remaining = dueMinor - O.paidMinor                  // **محسوب، لا مقروء**
  if X > remaining:
      if NOT (O.isVariableAmount AND req.overpayDecision):
            → err OVERPAYMENT  (ويعرض الخياران في 11.3)
      if req.overpayDecision == 'payRemainingOnly':
            X = remaining
      if req.overpayDecision == 'recordAsExtraCharges':
            assertNonEmpty(req.extraChargesReason)
            extraAfter = O.extraChargesMinor + (X - remaining)
            auditLogs += { action:'extraChargesAdded', before, after, reason }
            // **totalMinor لا يتغير أبداً**
  if installmentIndex: assert X ≤ inst.amountMinor - inst.paidMinor
  assertBalanceFloor(A, -X)
  if (A.balanceMinor - X) < A.earmarkedMinor → warnings += EARMARK_EXCEEDED

  if nature=='financing' AND Counter missing:
      newAccounts += buildAccount('liability.financing.' + O.payeeContactId)

  lines = nature=='expense'
    ? [ Dr expense.{O.categoryId} X , Cr asset.{A} X ]
    : [ Dr liability.financing.{payee} X , Cr asset.{A} X ]
  refs = { obligationId, obligationInstallmentIndex? }

  postings: رجل النقد تحمل settlementDeltaMinor = +X و obligationId = O.id   [ADR-021]

  paidAfter      = O.paidMinor + X
  extraAfter     = extraAfter ?? O.extraChargesMinor
  remainingAfter = O.totalMinor + extraAfter - paidAfter
  statusAfter    = obligationStatus({ paidAfter, O.totalMinor, extraAfter, O.dueDate },
                                    today, cancelled=false)        // جدول 10.2
  ✗ **لا إنشاء لأي دورة تكرار هنا**                                  [ADR-013]

writes:
  1 create journalEntries/{opId} + postings ×2
  2 update accounts/{A}       { creditTotalMinor:+X, balanceMinor:-X, … }
  3 update accounts/{Counter} { nature=='expense' ? debitTotalMinor:+X, balanceMinor:+X
                                                   : debitTotalMinor:+X, balanceMinor:-X , … }
  4 set accountPeriods ×2
  5 set periods/{pk} {
        obligationPaidMinor:+X, netCashFlowMinor:-X, entryCount:+1,
        nature=='expense'  ? { totalExpenseMinor:+X, 'expenseByCategory.{cat}':+X,
                               householdExpenseMinor: tags∋'household' ? +X : — }
                           : { financingPaidMinor:+X } }
  6 if nature=='expense' AND B وفئته موجودان: update budgetPeriods (قيم مطلقة + منطق التنبيه)
  7 update obligations/{id} {
        paidMinor: paidAfter,                       ← قيمة مطلقة
        extraChargesMinor: extraAfter,
        remainingMinor: remainingAfter,             ← محسوب من الأطراف الثلاثة
        paymentCount: increment(1), lastPaymentEntryId: opId,
        status: statusAfter, statusComputedFor: today }
  8 create notifications/{autoId}  «سُدِّد بالكامل» / «سُدِّد جزئياً، المتبقي Y»
  9 if auditLogs: create auditLogs/{autoId}
```

> **مثال رقمي:** `obl_rent` بـ `totalMinor=800000, extraCharges=0, paid=0, dueDate='2026-10-05'`,
> `nature='expense'`, دفع `200000` من `acc_bank_jm` (رصيده `1500000`), اليوم `2026-10-09`.
> ⇒ `remaining=800000` ✓، الرصيد `1,500.000 → 1,300.000`، `paidMinor=200000`,
> `remainingMinor=600000`, الحالة: `paid>0 && today>dueDate` ⇒ **`overdue`** (الصف 3 في 10.2)
> و`partiallyPaid` شارة ثانية. `periods.obligationPaidMinor += 200000`,
> `totalExpenseMinor += 200000`, `householdExpenseMinor += 200000`.
> **لو كان المبلغ 900.000** ⇒ `OVERPAYMENT` **قبل أي كتابة** مع الخيارين في 11.3.
> **لو كان `nature='financing'`** ⇒ `Dr liability.financing.{payee}` و**`totalExpenseMinor` لا يتغير
> و`budgetPeriods` لا تُلمس** و`financingPaidMinor += 200000`.

### 12.5 `payDebt` (سداد دين عليّ)

```
reads:   E ; A ← accounts/{fromAccountId} ; D ← debts/{debtId} ;
         P ← accounts/{D.accountId} (liability.payable) ;
         Fin ← accounts/'expense.finance'  إن i > 0 ; L ; M

decide:  if D.direction != 'payable'          → err ACCOUNT_TYPE_MISMATCH
         if D.status ∈ {settled,cancelled}    → err
         remaining = D.principalMinor - D.settledMinor - D.writtenOffMinor
         assertNotOverSettled({ dueMinor:remaining+D.settledMinor, settledMinor:D.settledMinor,
                                allowOver:false }, X)        → OVERPAYMENT
         assertBalanceFloor(A, -(X + i))
         lines = i > 0 ? [ Dr P X , Dr expense.finance i , Cr A (X+i) ]
                       : [ Dr P X , Cr A X ]
         postings: رجل P تحمل settlementDeltaMinor = +X و debtId = D.id
         settledAfter   = D.settledMinor + X
         remainingAfter = D.principalMinor - settledAfter - D.writtenOffMinor
         statusAfter    = remainingAfter == 0 ? 'settled' : 'partiallySettled'

writes:  1 create journalEntries/{opId} + postings
         2 update accounts/{P} { debitTotalMinor:+X,  balanceMinor:-X, … }   // الخصم ينقص
         3 update accounts/{A} { creditTotalMinor:+(X+i), balanceMinor:-(X+i), … }
         4 if i>0: update accounts/'expense.finance' { debitTotalMinor:+i, balanceMinor:+i }
         5 set accountPeriods لكل حساب
         6 set periods/{pk} { repaidMinor:+X, entryCount:+1,
                              i>0 ? { totalExpenseMinor:+i, netCashFlowMinor:-(X+i) }
                                  : { netCashFlowMinor:-X } }
            // totalExpenseMinor لا يتغير بأصل الدين — **الزيادة فقط مصروف**
         ✗ budgetPeriods — **السداد لا يستهلك الميزانية**
         7 update debts/{id} { settledMinor:settledAfter, remainingMinor:remainingAfter,
                               settlementCount:increment(1), lastSettlementEntryId:opId,
                               status:statusAfter }
         8 create notifications/{autoId}
```

### 12.6 `collectDebt` (تحصيل مستحق لي)

```
reads:   E ; A ← accounts/{toAccountId} ; D ← debts/{debtId} ;
         R ← accounts/{D.accountId} (asset.receivable) ; L ; M

decide:  if D.direction != 'receivable'                   → err ACCOUNT_TYPE_MISMATCH
         if D.status ∈ {settled,cancelled,writtenOff}      → err
         remaining = D.principalMinor - D.settledMinor - D.writtenOffMinor
         if X > remaining                                  → err OVER_COLLECTION
         if R.balanceMinor < X                             → err (يمنع حساب مستحق سالباً)
         ✗ لا فحص حدّ رصيد على A (يزيد)
         lines = [ Dr asset.{A} X , Cr asset.receivable.{c} X ]
         postings: رجل R تحمل settlementDeltaMinor = +X و debtId = D.id
         settledAfter   = D.settledMinor + X
         remainingAfter = D.principalMinor - settledAfter - D.writtenOffMinor
         statusAfter    = remainingAfter == 0 ? 'settled' : 'partiallySettled'

writes:  1 create journalEntries/{opId} + postings ×2
         2 update accounts/{A} { debitTotalMinor:+X,  balanceMinor:+X, … }
         3 update accounts/{R} { creditTotalMinor:+X, balanceMinor:-X, … }
         4 set accountPeriods ×2
         5 set periods/{pk} { collectedMinor:+X, entryCount:+1 }
            // **totalIncomeMinor لا يتغير و netCashFlowMinor لا يتغير**
            // التحصيل ليس دخلاً؛ وبطاقة «الأموال المتاحة» ترتفع من لقطة الحسابات
         6 update debts/{id} { settledMinor, remainingMinor, settlementCount:+1,
                               lastSettlementEntryId, status:statusAfter }
         7 create notifications/{autoId}

الأثر الكلي: الأموال المتاحة +X | المستحق لي −X | **صافي الثروة بلا تغيير**
             الدخل بلا تغيير | المصروف بلا تغيير | الميزانية بلا تغيير
```

> **هذا المثال هو البرهان العملي على قيمة القيد المزدوج:** في تصميم أحادي الجانب كان لا بدّ من حقل
> `excludeFromIncome: true` وشرط في **كل** تقرير يحترمه. هنا، لأن طرفي القيد كلاهما `asset`،
> **لا يوجد حساب دخل في القيد أصلاً**، فاستبعاده من الدخل ليس قراراً بل **حقيقة بنيوية**.

### 12.7 `voidTransaction` (إلغاء)

```
reads:   Orig ← journalEntries/{originalEntryId}
         Lock ← entryCorrections/{originalEntryId}                [القفل الذرّي]
         E    ← journalEntries/{`rev:${originalEntryId}`}
         Accs ← كل accounts/{id} لكل id في Orig.accountIds
         O/D/G ← الكيانات في Orig.refs
         B ← budgetPeriods/{Orig.periodKey}
         Lorig ← periodLocks/{Orig.periodKey} ; Ltoday ← periodLocks/{todayPk}
         M ← meta/integrity

decide:
  if M.rebuildStatus=='running'       → err REBUILD_IN_PROGRESS
  if E exists                         → return alreadyApplied
  if Lock exists                      → err ALREADY_CORRECTED
  if Orig.status != 'posted'          → err ENTRY_NOT_POSTED
  if Orig.kind == 'reversal'          → err CANNOT_REVERSE_REVERSAL
  if Orig.kind == 'opening' AND توجد قيود لاحقة على الحساب → err OPENING_HAS_SUBSEQUENT_ENTRIES
  if Orig.kind ∈ {borrow,lend} AND D.settlementCount > 0  → err DEBT_HAS_SETTLEMENTS
  assertNonEmpty(reason)

  // سياسة التاريخ — 8.3
  if Lorig exists:  revBookedAt = today ; revPk = todayPk ; isPriorCorrection = true
                    if Ltoday exists → err PERIOD_LOCKED
  else:             revBookedAt = Orig.bookedAt ; revPk = Orig.periodKey ; isPriorCorrection = false

  // **حاجز الرصيد على دلتا العكس** — 8.4
  for each cashLike account a in Accs:
      delta = -deltaForAccount(Orig, a.id)       // الدلتا المقلوبة
      assertBalanceFloor(a, delta)               // قد يرفض عكس **دخل** أُنفق
         → err NEGATIVE_BALANCE_NOT_ALLOWED برسالة 8.4 الخاصة

  rev = {
    id: `rev:${originalEntryId}`, opId: نفسه, kind:'reversal', status:'posted',
    bookedAt: revBookedAt, periodKey: revPk, isPriorPeriodCorrection: isPriorCorrection,
    reversesEntryId: originalEntryId, correctionReason: reason,
    correctionGroupId: Orig.correctionGroupId ?? originalEntryId,
    lines: Orig.lines.map(l => ({ ...l, side: flip(l.side) })),     // **قلب الجانب لا سالب**
    totalDebitMinor: Orig.totalCreditMinor, totalCreditMinor: Orig.totalDebitMinor, …
  }
  assertBalanced(rev)                                               // يبقى متوازناً

  revPostings = Orig postings مع signedAmountMinor و settlementDeltaMinor **مقلوبة الإشارة**

writes:
  1 create journalEntries/{rev.id} + postings العكس
  2 update journalEntries/{originalEntryId} { status:'reversed', reversedByEntryId:rev.id }
  3 create entryCorrections/{originalEntryId} { reversalEntryId:rev.id,
                                                replacedByEntryId:null, reason, … }
  4 update كل حساب متأثر بالدلتا المقلوبة
  5 set accountPeriods/{acc}__{revPk} لكل حساب  (بالدلتا المقلوبة)
  6 set periods/{revPk}:
       if isPriorCorrection:
          { priorPeriodExpenseCorrectionMinor:-Xexp,
            priorPeriodIncomeCorrectionMinor:-Xinc,
            netCashFlowMinor: +Xexp - Xinc, entryCount:+1 }
          // **totalExpenseMinor و totalIncomeMinor لا تُلمَسان**
       else:
          { totalExpenseMinor:-Xexp, 'expenseByCategory.{cat}':-Xexp,
            householdExpenseMinor:-Xexp إن موسوماً,
            totalIncomeMinor:-Xinc, 'incomeBySource.{s}':-Xinc,
            transferVolumeMinor / borrowedMinor / repaidMinor / lentMinor /
            collectedMinor / obligationPaidMinor / financingPaidMinor: بالعكس,
            netCashFlowMinor: معكوس, entryCount:+1 }
  7 if NOT isPriorCorrection AND B موجود:
       update budgetPeriods { spentMinor: مقروء - Xexp, overallSpentMinor: مقروء - Xexp,
                              alertFiredAtPercent: null إن هبطت النسبة تحت العتبة }
     // **إن isPriorCorrection ⇒ budgetPeriods لا تُلمس إطلاقاً**  [8.3]
  8 الكيانات المرافقة وفق جدول 8.3:
       obligations { paidMinor: مقروء - X, remainingMinor: محسوب,
                     paymentCount:increment(-1), status: معاد الحساب }
       debts       { settledMinor: مقروء - X, remainingMinor: محسوب,
                     settlementCount:increment(-1), status: معاد الحساب }
       goals       { savedMinor: مقروء - X, status: معاد الحساب }
                  + accounts/{earmarkSource} { earmarkedMinor: مقروء - X }
  9 create auditLogs { action:'entryReversed', targetId:originalEntryId, reason, before, after }
 10 create operations/{opId}
```

### 12.8 `editTransaction` (تعديل = عكس + بديل)

```
reads:   كما في 12.7، **زائد**:
         الحسابات الجديدة في المسودة البديلة
         budgetPeriods/{newPk} و periodLocks/{newPk}  إن تغيّرت الفترة
         journalEntries/{`amd:${orig}`}__2

decide:
  نفس حوارس 12.7 (القفل، الحالة، الفترة، السبب)
  assertBalanced(replacement) ; assertLinesValid(replacement)

  // **الفحوص على الدلتا الصافية لا على خطوتين** — 8.5
  for each account a:
      net = -deltaForAccount(Orig, a.id) + deltaForAccount(Replacement, a.id)
      assertBalanceFloor(a, net)
  if refs.obligationId:
      netSettle = -Xorig + Xnew
      assertNotOverSettled({ dueMinor, settledMinor: O.paidMinor, allowOver:false }, netSettle)

writes:
  1 create journalEntries/{opId}__1  ← قيد العكس  + postings
  2 create journalEntries/{opId}__2  ← القيد البديل + postings
  3 update journalEntries/{orig} { status:'replaced',
                                   reversedByEntryId:`${opId}__1`,
                                   replacedByEntryId:`${opId}__2`,
                                   correctionGroupId }
  4 create entryCorrections/{orig} { reversalEntryId:`${opId}__1`,
                                     replacedByEntryId:`${opId}__2`, reason }
  5 update الحسابات بالدلتا **الصافية** (لا خطوتين)
  6 set accountPeriods بالدلتا الصافية (وللفترتين إن تغيّر الشهر)
  7 set periods بالدلتا الصافية (وللفترتين)
  8 update budgetPeriods بالدلتا الصافية (وللفترتين)
  9 update obligations/debts/goals بقيم مطلقة صافية
 10 create operations/{opId} + auditLogs { action:'entryAmended', before, after, reason }
```

**ملاحظة إلزامية:** تعديل حقل مُصنَّف «في مكانه» في جدول 8.2 **لا يمرّ من هنا** — بل
`update` مباشر على القيد + `auditLogs: 'descriptiveEditOnPostedEntry'`.
والاستثناء الوحيد: `tags.household` الذي يُحدِّث `periods.householdExpenseMinor` في نفس المعاملة.

### 12.9 `materializeRecurring` (مُشغِّل الاستدراك)

**يعمل عند: تسجيل الدخول، وفتح التطبيق، وتغيّر اليوم** (ق-1: لا دوال مجدولة على Spark).

```ts
export interface CatchUpItem {
  recurrenceId: string;
  occurrenceKey: DateKey;        // تاريخ الاستحقاق
  opId: string;                  // `rec:{id}:{key}` أو `obl:{id}:{key}`
  request: OperationRequest;
}

/** **نقية**: تحسب كل المواعيد المستحقة حتى today، بحدّ maxBackfillDays. */
export function planCatchUp(
  rules: readonly RecurrenceRule[], today: DateKey, maxBackfillDays = 120
): { due: CatchUpItem[]; missedBeyondLimit: CatchUpItem[] };

/** يُنفِّذ **تسلسلياً** عبر postOperation. alreadyApplied متوقَّع وطبيعي ولا يُعرض كخطأ. */
export async function runCatchUp(ctx: PostContext, items: CatchUpItem[]): Promise<CatchUpReport>;
```

```
planCatchUp:
  for each rule where status == 'active':
     cursor = max(rule.startDate, rule.lastMaterializedKey ?? rule.startDate)
     while next(cursor, rule.frequency, rule.interval, rule.dayOfMonthPolicy) <= today:
        cursor = next(...)
        if rule.endDate AND cursor > rule.endDate: rule → 'ended' ; break
        if عدد الدورات بلغ maxOccurrences:        rule → 'ended' ; break
        item = { recurrenceId: rule.id, occurrenceKey: cursor,
                 opId: rule.kind == 'obligation' ? `obl:${rule.id}:${cursor}`
                                                 : `rec:${rule.id}:${cursor}`,
                 request: buildFromTemplate(rule.template, cursor) }
        if (today - cursor) > maxBackfillDays: missedBeyondLimit += item
        else                                 : due += item

runCatchUp:
  for item of due (تسلسلياً):
     res = await postOperation(ctx, item.request)        // opId حتمي ⇒ idempotent
     if res.alreadyApplied: تجاهل بصمت (**ليس خطأ**)
     update recurrences/{id}.lastMaterializedKey = item.occurrenceKey   (للعرض فقط)
  missedBeyondLimit → تُعرض للمستخدم كقائمة «مواعيد فائتة» يختار منها
```

**لـ `kind == 'obligation'` تحديداً:** العملية ليست قيداً بل **إنشاء مستند دورة التزام**
`obligations/{obl:{recurrenceId}:{dueDate}}` بحالة `upcoming` و`remainingMinor = totalMinor`.
المعرّف نفسه هو الحارس: تشغيل المُشغِّل 50 مرة في اليوم نفسه ⇒ **دورة واحدة** (ADR-013).
وعكس أي دفعة **لا يمسّ الدورات** لأنها ليست من نسل معاملة الدفع.

### 12.10 `reconcileAccount` (الفاحص)

```ts
export interface AccountDrift {
  accountId: string;
  storedDebit: Minor;  computedDebit: Minor;
  storedCredit: Minor; computedCredit: Minor;
  storedBalance: Minor; computedBalance: Minor;
  storedEntryCount: number; computedEntryCount: number;
  verifiedThroughBookedAt: DateKey;
}

/** فحص رخيص: يقرأ الحسابات وحدها ويتحقق من I3 و I4. ~45 قراءة. */
export function auditTrialBalance(accounts: readonly Account[]):
  { balanced: boolean; debitTotal: Minor; creditTotal: Minor; offenders: AccountDrift[] };

/** فحص تراكمي لحساب واحد — **لا يكتب شيئاً**. */
export function auditAccount(
  account: Account, entriesAfterCheckpoint: readonly JournalEntry[]
): AccountDrift;
```

```
reconcileAccount(accountId):
  A = accounts/{accountId}
  // **التحقق التراكمي** — لا يقرأ تاريخ الحساب كله
  from = A.lastVerifiedThroughBookedAt ?? '0000-01-01'
  base = A.lastVerifiedBalanceMinor    ?? A.openingBalanceMinor
  entries = journalEntries
              where accountIds array-contains accountId
                and bookedAt > from
              order by bookedAtTs
  computed = base
  for e of entries: computed += signedDeltaFor(e, A)        // كل القيود بما فيها reversal
  drift = A.balanceMinor - computed
  if drift == 0:
      update accounts/{id} { lastVerifiedAt: serverTimestamp(),
                             lastVerifiedBalanceMinor: computed,
                             lastVerifiedThroughBookedAt: today }
      // ⇒ الفحص القادم يقرأ ما بعد اليوم فقط ⇒ **~200 قراءة إلى الأبد لا نمو خطي**
  else:
      **لا يُصحَّح الرصيد صامتاً إطلاقاً.**
      create notifications { severity:'critical', titleAr:'اكتُشف فرق في رصيد حساب' }
      create auditLogs { action:'balanceAdjusted'?  لا — بل تقرير فقط }
      تعطيل الترحيل + شريط أحمر + شاشة «سلامة البيانات» مع خيارين:
         [إعادة بناء الإسقاطات]  (قسم 16 — المسار الصحيح)
         [تسجيل حركة تسوية مبرَّرة]  (Dr/Cr مقابل equity.adjustment، سبب إلزامي)
      ← تطبيق القسم 5: «لا يُسمح بتعديل الرصيد الحالي يدوياً دون تسجيل عملية تسوية واضحة ومبررة»
```

**متى يُشغَّل؟** على Spark لا توجد وظائف مجدولة، فالفاحص يعمل **في العميل**:

| الفحص | التوقيت | التكلفة |
|---|---|---|
| `auditTrialBalance` (I3 + I4) | **كل تسجيل دخول** | ~45 قراءة (من اللقطة الموجودة أصلاً ⇒ 0 إضافية) |
| بصمة الدفتر (I10) | كل تسجيل دخول | **2–3 قراءات** (`sum('totalDebitMinor')` + `count()`) |
| `reconcileAccount` التراكمي | **أول فتحة في كل شهر** لكل حساب نقدي + بطلب المستخدم | ~200 قراءة |
| I5b / I6b (تسويات الكيانات) | عند فتح شاشة التزام/دين + في التسوية الشاملة | **2 قراءات لكل كيان** (`sum('settlementDeltaMinor')`) |
| التسوية الشاملة | بطلب المستخدم، وتلقائياً كل 30 يوماً | انظر 16.1 |

**عند اختلال I4:** شريط تحذير أحمر + **تعطيل الترحيل** حتى الإصلاح (`TRIAL_BALANCE_BROKEN`).
هذا أقسى من اللازم بقصد: دفتر غير متوازن يعني أن كل رقم في النظام مشكوك فيه.

---

## 13. الثوابت (invariants) — جُمل قابلة للاختبار

**كل ثابت هنا جملة واحدة قابلة للتحويل المباشر إلى اختبار وحدة.**
العمود «أين يُفرض» يفرّق بين ما يستحيل خرقه وما يُكتشف بعد الخرق — وهذا الفرق هو مقياس متانة التصميم.

| # | الثابت (جملة قابلة للاختبار) | أين يُفرض | التكلفة |
|---|---|---|---|
| **I1** | **لكل قيد: `totalDebitMinor === totalCreditMinor`** | **طبقة النطاق + قواعد الأمان (الخادم)** | 0 |
| **I2** | لكل قيد: `2 ≤ lines.length ≤ 50`، وكل `line.amountMinor` **عدد صحيح موجب** `≤ MAX_ABS_MINOR`، و`Σ lines[side=='debit'].amountMinor === totalDebitMinor` | النطاق + القواعد (الإجماليات والعدد) | 0 |
| **I3** | لكل حساب: `balanceMinor === (debitTotalMinor − creditTotalMinor) × (normalSide==='debit' ? 1 : −1)` | **قواعد الأمان** (ممكن لأن `normalSide` مخزَّن) + الفاحص | 0 |
| **I4** | **على كل الشجرة: `Σ debitTotalMinor === Σ creditTotalMinor`** (ميزان المراجعة) | الفاحص عند كل تسجيل دخول | ~45 قراءة |
| **I5** | لكل التزام: `remainingMinor === totalMinor + extraChargesMinor − paidMinor` و`0 ≤ paidMinor ≤ totalMinor + extraChargesMinor` | **قواعد الأمان** + المعاملة | 0 |
| **I5b** | **لكل التزام: `paidMinor === Σ settlementDeltaMinor` على كل `postings where obligationId == id`** | الفاحص بـ `getAggregateFromServer(sum(...))` | **2 قراءات** |
| **I6** | لكل دين: `remainingMinor === principalMinor − settledMinor − writtenOffMinor` و`settledMinor + writtenOffMinor ≤ principalMinor` | **قواعد الأمان** + المعاملة | 0 |
| **I6b** | **لكل دين: `settledMinor === Σ settlementDeltaMinor` على كل `postings where debtId == id`** | الفاحص بالتجميع الخادمي | **2 قراءات** |
| **I7** | لكل حساب: `debitTotalMinor === Σ` السطور المدينة في **كل** قيوده (بما فيها `reversal`)، ومثله `creditTotalMinor` | الفاحص التراكمي (`lastVerified*`) | ~200 قراءة/شهر |
| **I8** | لكل حساب: `entryCount === عدد القيود` التي تضمّ `accountId` في `accountIds` | الفاحص + `getCountFromServer` | 1 قراءة |
| **I9** | لكل فترة: `netCashFlowMinor === totalIncomeMinor − totalExpenseMinor + priorPeriodIncomeCorrectionMinor − priorPeriodExpenseCorrectionMinor` | المعاملة + الفاحص | 1 قراءة |
| **I10** | **بصمة الدفتر: `Σ totalDebitMinor` على كل القيود === `Σ amountMinor` على كل `postings where side=='debit'`** | التجميع الخادمي | **3 قراءات** |
| **I11** | **`Σ signedAmountMinor` على كل `postings where accountId == A` === `A.balanceMinor − A.openingBalanceMinor`** (لكل حساب) | التجميع الخادمي | 2 قراءات/حساب |
| **I12** | لكل (حساب، فترة): `netMinor === (debitMinor − creditMinor) × lineSignOfNormal(accountType)` | الفاحص | 1 قراءة |
| **I13** | لكل حساب: `openingBalanceMinor + Σ_{كل الفترات} accountPeriods.netMinor === balanceMinor` ← **هذا هو الثابت الذي يحلّ محلّ لقطات `opening/closing` المحذوفة (ADR-009)** | الفاحص | ≤24 قراءة |
| **I14** | لكل فترة: `totalExpenseMinor === Σ expenseByCategory[*]` و`totalIncomeMinor === Σ incomeBySource[*]` | الفاحص | 1 قراءة |
| **I15** | لكل فترة: `householdExpenseMinor ≤ totalExpenseMinor` ← **مجموع فرعي لا إضافة** (القسم 11) | الفاحص | 1 قراءة |
| **I16** | لكل ميزانية: `overallSpentMinor === Σ categories[*].spentMinor`، وكل `spentMinor ≥ 0` | الفاحص | 1 قراءة |
| **I17** | لا يوجد قيد بـ `periodKey` لفترة لها `periodLocks/{pk}` **إلا** بـ `isPriorPeriodCorrection: true` وتاريخ اليوم | **قواعد الأمان** | 1 `exists()` |
| **I18** | لكل قيد: `periodKey === bookedAt.slice(0,7)` | **قواعد الأمان** | 0 |
| **I19** | لكل قيد: `accountIds` = المجموعة المميَّزة لـ `lines[].accountId`، و`accountTypes` = المجموعة المميَّزة لـ `lines[].accountType` | النطاق + الفاحص | 0 |
| **I20** | `Σ account.earmarkedMinor` على كل الحسابات `=== Σ balanceMinor` لحسابات `equity.earmark.*` | الفاحص | 0 إضافية |
| **I21** | لكل هدف `virtualEarmark`: `savedMinor === balanceMinor` لحساب `equity.earmark.goal.{id}` | الفاحص | 1 قراءة |
| **I22** | كل حساب `subtype === 'receivable'` له `isCashLike === false` | **قواعد الأمان** | 0 |
| **I23** | لا قيد بحالة `posted` له `reversedByEntryId` أو `replacedByEntryId` غير فارغ؛ وكل قيد `reversed`/`replaced` له `entryCorrections/{id}` موجود | الفاحص + القواعد | 1 قراءة |
| **I24** | `rebuildStatus === 'running'` ⇒ **لا قيد جديد أُنشئ بعد `rebuildStartedAt`** | **قواعد الأمان** (البوابة) + الفاحص | 1 `get()` |

**ثلاث ملاحظات على القائمة، كل منها مقصودة:**

1. **I1 و I3 و I5 و I6 و I17 و I18 و I22 مفروضة من الخادم** — أي **يستحيل** خرقها من أي عميل، سليماً كان
   أو متلاعباً أو بنسخة قديمة. وهذا ما يجعل جملة «الثابت المركزي مفروض من الخادم» **صحيحة في هذه
   الوثيقة**، لا دعوى (انظر إصلاح عيب الأسبقية في 14.2).
2. **I5b و I6b و I11 جديدة ومهمة جداً:** تربط المُجمَّعات التشغيلية (التزامات، ديون، أرصدة) بـ
   **مصدر مستقل محمي بالتوازن** (`postings`) بتكلفة قراءتين لكل كيان. بدونها يبقى الرقم الخاطئ في
   `paidMinor` غير قابل للكشف حتى لو كان القيد متوازناً تماماً — وهو أخطر صنف أخطاء في الأنظمة
   المالية لأنه يمرّ من كل الفحوص. مع I5b، السيناريو «دفعة بأرجل 20.000 و`paidMinor += 200.000`»
   يُكتشف **فوراً**: `Σ settlementDeltaMinor = 20.000 ≠ 200.000`.
3. **ما لا يحميه أي ثابت، ويُعلَن صراحةً:** **قلب اتجاه القيد.** قيد `Dr asset / Cr expense` بدل
   `Dr expense / Cr asset` **متوازن تماماً** فيمرّ من I1 ومن كل قواعد الأمان، لكنه يرفع الرصيد ويخفض
   المصروف. **الشرط غير القابل للتفاوض:** اختبار جدولي (table-driven) يغطّي **كل صف** في القسم 9
   بالاتجاه والمبلغ والحساب + ثابت علاقة الإشارة التالي، مفروضاً في طبقة النطاق:

```ts
// domain/rules/kindShape.ts — I2b: علاقة kind بالطبائع والاتجاهات المسموحة
const ALLOWED: Record<EntryKind, Array<{ type: AccountType; side: Side }>> = {
  expense:           [{ type:'expense',   side:'debit'  }, { type:'asset',     side:'credit' }],
  income:            [{ type:'asset',     side:'debit'  }, { type:'income',    side:'credit' }],
  transfer:          [{ type:'asset',     side:'debit'  }, { type:'asset',     side:'credit' },
                      { type:'expense',   side:'debit'  }],
  borrow:            [{ type:'asset',     side:'debit'  }, { type:'expense',   side:'debit'  },
                      { type:'liability', side:'credit' }],
  debtRepayment:     [{ type:'liability', side:'debit'  }, { type:'expense',   side:'debit'  },
                      { type:'asset',     side:'credit' }],
  lend:              [{ type:'asset',     side:'debit'  }, { type:'asset',     side:'credit' }],
  debtCollection:    [{ type:'asset',     side:'debit'  }, { type:'asset',     side:'credit' }],
  debtWriteOff:      [{ type:'expense',   side:'debit'  }, { type:'asset',     side:'credit' }],
  obligationPayment: [{ type:'expense',   side:'debit'  }, { type:'liability', side:'debit'  },
                      { type:'asset',     side:'credit' }],
  opening:           [{ type:'asset',     side:'debit'  }, { type:'liability', side:'credit' },
                      { type:'equity',    side:'debit'  }, { type:'equity',    side:'credit' }],
  adjustment:        [/* أي نوع، والطرف المقابل equity.adjustment إلزامي */],
  earmark:           [{ type:'equity',    side:'debit'  }, { type:'equity',    side:'credit' }],
  zakatAccrual:      [{ type:'equity',    side:'debit'  }, { type:'liability', side:'credit' }],
  reversal:          [/* مشتق من الأصل بالقلب — يُفحص بمطابقة الأصل لا بالقائمة */],
};

/** يرفض أي سطر لا يطابق (النوع، الجانب) المسموح لنوع القيد ⇒ يكشف قلب الاتجاه. */
export function assertKindShape(entry: JournalEntry): Result<void, DomainError>;
```

هذا الثابت **لا يكشف كل قلب اتجاه** (تحويل بين حسابين `asset` مقلوب يبقى مطابقاً للشكل)، لكنه يكشف
**أخطرها**: مصروف يرفع الرصيد، دخل يخفضه، سداد يُسجَّل مصروفاً. والباقي مسؤولية الاختبار الجدولي —
وهذا **مُعلَن لا مُخفى** (قسم 18.3).

---

## 14. قواعد الأمان

### 14.1 الهيكل

كل شيء تحت `users/{uid}/…` ⇒ عزل بيانات المستخدم بشرط واحد في الجذر. والهيكل جاهز لتعدد المستخدمين
دون إعادة تصميم (القسم 20): إضافة `households/{hid}` بعضوية صريحة لاحقاً **لا تمسّ شكل القيود**.

**ق-2 مُلزِم: النظام مغلق على UID المالك المعتمد في القواعد لا في الواجهة.**

> **تنبيه حاسم:** الشرط المعتاد `isOwner(uid) = request.auth.uid == uid` **لا يُغلق النظام**:
> أي شخص يسجّل دخولاً بحساب Google يستطيع إنشاء شجرته الخاصة تحت `users/{uidهو}` والكتابة فيها.
> وهذا **خرق مباشر لق-2**. الإغلاق يحتاج شرطاً ثانياً: `uid in ALLOWED_UIDS`.

### 14.2 إصلاح عيب الأسبقية — أخطر عيب في المسوّدة السابقة

**العيب:** قاعدة `create` على القيود كُتبت:

```javascript
allow create: if isOwner(uid) && ownerUid == uid && entryId == opId.split('__')[0] ||
                 entryId == opId && entryShapeOk(...) && !exists(periodLocks/...)
```

في لغة قواعد Firestore `&&` **أعلى أسبقية** من `||` ⇒ التعبير يُقرأ:

```
(isOwner && ownerUid==uid && entryId==prefix)  ||  (entryId==opId && entryShapeOk && !locked)
```

- **الفرع الأول لا يفحص `entryShapeOk` ولا إقفال الفترة.** وفي العملية ذات القيد الواحد — وهي أكثر
  العمليات — يكون `entryId == opId == opId.split('__')[0]` ⇒ **الفرع الأول يتحقق دائماً**.
- **الفرع الثاني لا يفحص الملكية ولا `ownerUid`** إطلاقاً.

**الأثر:** كل ما تفرضه القواعد **ساقط عملياً**: `totalDebitMinor == totalCreditMinor` (I1)،
و`lines.size() >= 2`، وموجبية المبالغ وصحّتها الصحيحة (I2)، و`periodKey == bookedAt[0:7]` (I18)،
و`status == 'posted'`، و**منع الترحيل في فترة مُقفلة** (I17).
السيناريو: عميل فيه خطأ أو جهاز بنسخة قديمة يكتب
`{ totalDebitMinor: 25500, totalCreditMinor: 1, lines: [سطر واحد], periodKey: '2026-03' }`
على فترة مُقفلة ⇒ **الخادم يقبله**. ويختلّ I4، ويُعطَّل الترحيل كله حتى الإصلاح اليدوي.
و`auditTrialBalance` الرخيص يُحسب من `accounts` التي حُدِّثت من نفس المسار المعطوب ⇒ قد يبقى
متوازناً ولا يُكتشف الخلل إلا بالفاحص الكامل الشهري.

**الإصلاح: أقواس صريحة، والشروط الأساسية مشتركة لا بديلة.**
«القواعد ليست جاهزة لمجرد كتابتها» (القسم 25 بند 10) ⇒ لا تُنشر قبل الاختبار بالمحاكي والموافقة.

### 14.3 المسوّدة الكاملة

```javascript
rules_version = '2';
service cloud.firestore {

  // ──────────────────────────────────────────────────────────────
  // ق-2: النظام مغلق على UID المالك المعتمد. يُلتقط UID عند أول
  // تسجيل دخول ثم يُثبَّت هنا. البريد قابل للتغيير بينما UID ثابت.
  // ──────────────────────────────────────────────────────────────
  function allowedUids() {
    return ['REPLACE_WITH_OWNER_UID'];   // + UID احتياطي عند الحاجة
  }
  function isOwner(uid) {
    return request.auth != null
        && request.auth.uid == uid
        && uid in allowedUids();          // ← الإغلاق الفعلي (ق-2)
  }

  function isPosInt(v) {
    return v is int && v > 0 && v <= 1000000000000;
  }
  function isNonNegInt(v) {
    return v is int && v >= 0 && v <= 1000000000000;
  }
  function unchanged(f) {
    return request.resource.data[f] == resource.data[f];
  }
  function touchedOnly(keys) {
    return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys);
  }

  // بوابة إعادة البناء — **بنمط آمن**: غياب المستند لا يُوقف النظام
  function rebuildNotRunning(uid) {
    return !exists(/databases/$(database)/documents/users/$(uid)/meta/integrity)
        || get(/databases/$(database)/documents/users/$(uid)/meta/integrity)
             .data.rebuildStatus != 'running';
  }
  function rebuildRunning(uid) {
    return exists(/databases/$(database)/documents/users/$(uid)/meta/integrity)
        && get(/databases/$(database)/documents/users/$(uid)/meta/integrity)
             .data.rebuildStatus == 'running';
  }
  function periodNotLocked(uid, pk) {
    return !exists(/databases/$(database)/documents/users/$(uid)/periodLocks/$(pk));
  }
  function accountExists(uid, id) {
    return exists(/databases/$(database)/documents/users/$(uid)/accounts/$(id));
  }

  function entryShapeOk(d) {
    return d.keys().hasAll(['opId','kind','status','bookedAt','periodKey','lines',
                            'accountIds','accountTypes','totalDebitMinor','totalCreditMinor',
                            'amountMinor','currency','ownerUid','schemaVersion',
                            'payloadHash','description','tags','refs'])
      && d.currency == 'LYD'
      && d.schemaVersion is int && d.schemaVersion >= 1
      && d.status == 'posted'                                  // لا يُنشأ قيد بأي حالة أخرى
      && d.lines is list && d.lines.size() >= 2 && d.lines.size() <= 50
      && isPosInt(d.totalDebitMinor)
      && d.totalDebitMinor == d.totalCreditMinor                // ← I1 مفروض من الخادم
      && d.amountMinor == d.totalDebitMinor
      && d.accountIds is list && d.accountIds.size() >= 2 && d.accountIds.size() <= 50
      && d.accountTypes is list
      && d.description is string && d.description.size() > 0 && d.description.size() <= 500
      && d.bookedAt is string && d.bookedAt.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      && d.periodKey is string && d.periodKey.matches('^[0-9]{4}-[0-9]{2}$')
      && d.periodKey == d.bookedAt[0:7]                         // ← I18 (ADR-008)
      && d.payloadHash is string && d.payloadHash.size() == 64
      && d.tags is list && d.tags.size() <= 20;
  }

  // تصحيح فترة مُقفلة: مسموح **فقط** لقيد عكس بتاريخ اليوم وبالوسم الصريح
  function priorPeriodCorrectionOk(d) {
    return d.kind == 'reversal'
        && d.isPriorPeriodCorrection == true;
  }

  match /databases/{database}/documents {
    match /users/{uid} {

      // ── الافتراضي: لا شيء مسموح لمن ليس المالك المعتمد ──
      allow read:  if isOwner(uid);
      allow write: if false;                 // كل مجموعة تُفتح صراحةً أدناه

      match /settings/{docId} {
        allow read: if isOwner(uid);
        allow write: if isOwner(uid);
      }
      match /categories/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow delete: if false;              // الأرشفة بدل الحذف
      }
      match /contacts/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow delete: if false;
      }
      match /recurrences/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════
      // القيود: إنشاء بشروط **مشتركة** (لا بديلة)، تحديث محصور، لا حذف
      // ══════════════════════════════════════════════════════════
      match /journalEntries/{entryId} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && entryShapeOk(request.resource.data)                      // ← مشترك، لا بديل
          && (                                                        // ← أقواس صريحة
                entryId == request.resource.data.opId
             || entryId == request.resource.data.opId + '__1'
             || entryId == request.resource.data.opId + '__2'
             || entryId == request.resource.data.opId + '__3'
             )
          && rebuildNotRunning(uid)                                   // ← I24
          && (
                periodNotLocked(uid, request.resource.data.periodKey) // ← I17
             || priorPeriodCorrectionOk(request.resource.data)
             );

        // لا تعديل محاسبي: المبالغ والسطور والحسابات والتاريخ والنوع ثابتة إلى الأبد
        allow update: if isOwner(uid)
          && touchedOnly(['status','reversedByEntryId','replacedByEntryId',
                          'correctionGroupId','correctionReason','updatedAt',
                          'description','tags','attachmentIds'])
          && unchanged('opId') && unchanged('payloadHash') && unchanged('ownerUid')
          && unchanged('kind') && unchanged('lines') && unchanged('accountIds')
          && unchanged('totalDebitMinor') && unchanged('totalCreditMinor')
          && unchanged('amountMinor') && unchanged('currency')
          && unchanged('bookedAt') && unchanged('bookedAtTs') && unchanged('periodKey')
          && unchanged('refs') && unchanged('createdAt') && unchanged('createdBy')
          && resource.data.kind != 'reversal';          // قيد العكس غير قابل للتعديل

        allow delete: if false;                          // **لا حذف مالي مطلقاً**
      }

      // ══════════════════════════════════════════════════════════
      // postings: تُكتب مع القيد، ولا تُعدَّل ولا تُحذف أبداً
      // ══════════════════════════════════════════════════════════
      match /postings/{postingId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.entryId is string
          && request.resource.data.lineNo is int
          && postingId == request.resource.data.entryId + '__'
                        + string(request.resource.data.lineNo)
          && isPosInt(request.resource.data.amountMinor)
          && request.resource.data.signedAmountMinor is int
          && request.resource.data.settlementDeltaMinor is int
          && (   request.resource.data.signedAmountMinor ==  request.resource.data.amountMinor
              || request.resource.data.signedAmountMinor == -request.resource.data.amountMinor )
          && request.resource.data.periodKey == request.resource.data.bookedAt[0:7]
          && rebuildNotRunning(uid);
        allow update, delete: if false;
      }

      // ══════════════════════════════════════════════════════════
      // الحسابات: I3 مفروض، حدّ الرصيد مفروض، التناقص مسموح في الإصلاح فقط
      // ══════════════════════════════════════════════════════════
      match /accounts/{accountId} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.currency == 'LYD'
          && request.resource.data.debitTotalMinor == 0
          && request.resource.data.creditTotalMinor == 0
          && request.resource.data.balanceMinor == 0
          && request.resource.data.openingBalanceMinor == 0
          && request.resource.data.earmarkedMinor == 0
          && request.resource.data.entryCount == 0
          && request.resource.data.balanceVersion == 0
          && request.resource.data.minBalanceMinor is int
          && request.resource.data.minBalanceMinor <= 0
          && request.resource.data.normalSide ==
               ((request.resource.data.type == 'asset'
                 || request.resource.data.type == 'expense') ? 'debit' : 'credit')
          // القاعدة 19.9 مفروضة من الخادم — I22
          && (request.resource.data.subtype != 'receivable'
              || request.resource.data.isCashLike == false);

        allow update: if isOwner(uid)
          && unchanged('ownerUid') && unchanged('type') && unchanged('code')
          && unchanged('normalSide') && unchanged('currency')
          && request.resource.data.debitTotalMinor is int
          && request.resource.data.creditTotalMinor is int
          && request.resource.data.earmarkedMinor is int
          && request.resource.data.earmarkedMinor >= 0
          && request.resource.data.balanceVersion > resource.data.balanceVersion

          // ── I3 مفروض من الخادم: الرصيد مشتق من الإجماليين ──
          && request.resource.data.balanceMinor ==
               (resource.data.normalSide == 'debit'
                 ? request.resource.data.debitTotalMinor - request.resource.data.creditTotalMinor
                 : request.resource.data.creditTotalMinor - request.resource.data.debitTotalMinor)

          // ── حدّ الرصيد المطلق: شبكة أمان ضد أي مسار التفّ على postOperation ──
          && request.resource.data.balanceMinor >= request.resource.data.minBalanceMinor

          // ── التزايد إلا في الإصلاح: يحفظ إمكان إعادة البناء (ع-أ-4) ──
          && (
               (    request.resource.data.debitTotalMinor  >= resource.data.debitTotalMinor
                 && request.resource.data.creditTotalMinor >= resource.data.creditTotalMinor )
               || rebuildRunning(uid)
             );

        allow delete: if false;                          // الأرشفة بدل الحذف
      }

      // ══════════════════════════════════════════════════════════
      // المُجمَّعات: لا حذف، والحقول المالية أعداد صحيحة
      // ══════════════════════════════════════════════════════════
      match /accountPeriods/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && isNonNegInt(request.resource.data.debitMinor)
          && isNonNegInt(request.resource.data.creditMinor)
          && request.resource.data.netMinor is int
          && request.resource.data.periodKey is string
          && (rebuildRunning(uid)
              || (   request.resource.data.debitMinor  >= resource.data.debitMinor
                  && request.resource.data.creditMinor >= resource.data.creditMinor )
              || !exists(/databases/$(database)/documents/users/$(uid)/accountPeriods/$(id)));
        allow delete: if false;
      }

      match /periods/{pk} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && isNonNegInt(request.resource.data.totalIncomeMinor)
          && isNonNegInt(request.resource.data.totalExpenseMinor)
          && request.resource.data.netCashFlowMinor is int
          && request.resource.data.priorPeriodExpenseCorrectionMinor is int
          && request.resource.data.priorPeriodIncomeCorrectionMinor is int
          && request.resource.data.householdExpenseMinor <=
             request.resource.data.totalExpenseMinor;        // ← I15 من الخادم
        allow delete: if false;
      }

      match /budgetPeriods/{pk} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && isNonNegInt(request.resource.data.overallSpentMinor);
        allow delete: if false;
      }

      match /obligations/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.nature in ['expense','financing']
          && isPosInt(request.resource.data.totalMinor)
          && isNonNegInt(request.resource.data.extraChargesMinor)
          && isNonNegInt(request.resource.data.paidMinor)
          // ← I5 من الخادم: منع السداد الزائد + صحة المشتق
          && request.resource.data.paidMinor <=
               request.resource.data.totalMinor + request.resource.data.extraChargesMinor
          && request.resource.data.remainingMinor ==
               request.resource.data.totalMinor + request.resource.data.extraChargesMinor
               - request.resource.data.paidMinor
          // القيمة الأصلية المتعاقد عليها لا تُرفع لاستيعاب تجاوز (ADR-012)
          && (!('totalMinor' in resource.data.keys())
              || request.resource.data.totalMinor == resource.data.totalMinor
              || rebuildRunning(uid));
        allow delete: if false;
      }

      match /debts/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.direction in ['payable','receivable']
          && isPosInt(request.resource.data.principalMinor)
          && isNonNegInt(request.resource.data.settledMinor)
          && isNonNegInt(request.resource.data.writtenOffMinor)
          // ← I6 من الخادم
          && request.resource.data.settledMinor + request.resource.data.writtenOffMinor
               <= request.resource.data.principalMinor
          && request.resource.data.remainingMinor ==
               request.resource.data.principalMinor - request.resource.data.settledMinor
               - request.resource.data.writtenOffMinor
          && request.resource.data.allowOverSettle == false;
        allow delete: if false;
      }
      match /debts/{id}/followUps/{fid} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid);
        allow delete: if false;
      }

      match /financialGoals/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && isPosInt(request.resource.data.targetMinor)
          && isNonNegInt(request.resource.data.savedMinor);
        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════
      // التحكم والتدقيق
      // ══════════════════════════════════════════════════════════
      match /entryCorrections/{originalEntryId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.reason is string
          && request.resource.data.reason.size() >= 5
          && request.resource.data.reason.size() <= 500;
        allow update, delete: if false;          // ← القفل ذرّي ونهائي (ADR-014)
      }

      match /operations/{opId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && opId == request.resource.data.id
          && request.resource.data.status in ['committed','compensated'];
        allow update: if isOwner(uid) && touchedOnly(['status','resultSummary','updatedAt']);
        allow delete: if false;
      }

      match /periodLocks/{pk} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && request.resource.data.reason is string;
        allow update, delete: if false;          // الإقفال نهائي
      }

      match /auditLogs/{logId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow update, delete: if false;          // سجل تدقيق غير قابل للتلاعب
      }

      match /notifications/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow update: if isOwner(uid) && touchedOnly(['read','readAt','updatedAt']);
        allow delete: if isOwner(uid);            // الإشعارات ليست سجلاً محاسبياً
      }

      match /meta/{docId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid);
        allow update: if isOwner(uid)
          && (docId != 'integrity'
              || request.resource.data.rebuildStatus in ['idle','running','failed']);
        allow delete: if false;                   // **لا يُحذف — غيابه يُربك البوابة**
      }

      // الطابور: المجموعة المالية **الوحيدة** القابلة للحذف — ليست سجلاً محاسبياً
      match /pendingCommands/{opId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && opId == request.resource.data.id
          && request.resource.data.status == 'queued';
        allow update: if isOwner(uid)
          && touchedOnly(['status','attemptCount','rejectionCode',
                          'rejectionMessageAr','updatedAt']);
        allow delete: if isOwner(uid);
      }

      match /incomeSchedules/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow delete: if false;
      }
    }
  }
}
```

### 14.4 ما تفرضه القواعد فعلاً، وما لا تستطيعه

| تفرضه ✓ | لا تستطيعه ✗ |
|---|---|
| **I1** توازن القيد | أن مقدار تغيّر الرصيد **يطابق** مبلغ العملية |
| **I2** عدد السطور والأعداد الصحيحة الموجبة والحدود | صحة اتجاه القيد محاسبياً (قلب مدين/دائن متوازن) |
| **I3** الرصيد مشتق من الإجماليين (لأن `normalSide` مخزَّن) | التحقق من محتويات `lines` حساباً حساباً (لغة القواعد بلا حلقات) |
| **حدّ الرصيد المطلق** `balanceMinor >= minBalanceMinor` | فحص حدّ الرصيد **المشروط على الدلتا** |
| **I5 و I6** منع السداد/التحصيل الزائد كثابت مستند **من الخادم** | التحقق من أن `paidMinor` يطابق مجموع الدفعات (⇐ I5b بالتجميع) |
| **I17** منع الترحيل في فترة مُقفلة | — |
| **I18** تماسك `periodKey` مع `bookedAt` | — |
| **I22** `isCashLike=false` للمستحقات | — |
| **I24** بوابة إعادة البناء | — |
| عدم قابلية القيد والـ postings للتغيير، ومنع الحذف المالي | — |
| **ق-2** إغلاق النظام على UID المالك | — |

**الفرض الحقيقي للمقدار يبدأ عند Blaze** مع `allow write: if false` من العميل وCloud Function كاتباً
وحيداً — وهو **طبقة تحسين لا إعادة بناء** (ق-1 و18.4).

### 14.5 قواعد Storage

مؤجَّلة بقرار المالك (ق-1): Storage يتطلب Blaze. الحقل `attachmentIds` موجود في المخطط والواجهة
معطَّلة بوسم «يتطلب ترقية الخطة». وعند التفعيل: حد 5MB، أنواع `image/jpeg|png|webp|application/pdf`،
والتحقق من الملكية بالمسار `users/{uid}/attachments/{id}`.
**يُرفض** حفظ Base64 في Firestore (سقف المستند 1MB، تضخيم القراءات، تكلفة فهرسة).

---

## 15. التكلفة على Spark والفهارس

### 15.1 تسجيل مصروف واحد

**قبل المعاملة:** 0 قراءات مدفوعة — الحسابات والفئات والميزانية الحالية مُحمَّلة عبر `onSnapshot` عند
بدء التطبيق (قراءات مدفوعة مرة واحدة في الجلسة، ثم دلتا فقط).

| # | القراءة داخل المعاملة | ضرورتها |
|---|---|---|
| 1 | `journalEntries/{opId}` | منع الازدواج + `payloadHash` |
| 2 | `accounts/{cashAccountId}` | حدّ الرصيد + التحذير على الحجز + تحديث ذرّي |
| 3 | `accounts/{expenseAccountId}` | التحقق من النوع والحالة + تحديث ذرّي |
| 4 | `budgetPeriods/{pk}` | حدّ الفئة + منع تكرار التنبيه |
| 5 | `periodLocks/{pk}` | الإقفال |
| 6 | `meta/integrity` | بوابة إعادة البناء |
| **6 قراءات** | | |

> **ملاحظة صدق:** القواعد نفسها تستهلك `exists()`/`get()` إضافية **مُحاسَبة كقراءات**
> (`rebuildNotRunning` + `periodNotLocked` للقيد، ومثلها للـ postings). الميزانية الواقعية
> **~9–11 قراءة مُحاسَبة** للمصروف الواحد، لا 6. نذكرها لأن إخفاءها يُنتج تقديراً خاطئاً.

| # | الكتابة |
|---|---|
| 1 | `journalEntries/{opId}` (create) |
| 2 | `postings/{opId}__1` (create) |
| 3 | `postings/{opId}__2` (create) |
| 4 | `accounts/{cash}` (update) |
| 5 | `accounts/{expense}` (update) |
| 6 | `accountPeriods/{cash}__{pk}` (set merge) |
| 7 | `accountPeriods/{expense}__{pk}` (set merge) |
| 8 | `periods/{pk}` (set merge) ← نقطة الازدحام الوحيدة |
| 9 | `budgetPeriods/{pk}` (update) — **تُحذف إن لا ميزانية للفئة** |
| **9 كتابات** (8 بلا ميزانية) | |

**الحكم:** Spark يعطي 20,000 كتابة/يوم ⇒ **~2,200 مصروف/يوم** لمستخدم واحد.
الاستخدام الواقعي 5–20 يومياً = **0.9‰ من الحصة**. الكتابتان الإضافيتان لـ `postings` =
**0.045% من الحصة اليومية**، وتفتحان كل التقارير التجميعية الخادمية.
**تكلفة القيد المزدوج في Firestore غير ذات دلالة مالية. من يرفضه فليرفضه لتعقيده، لا لتكلفته.**

### 15.2 بقية العمليات

| العملية | قراءات | كتابات |
|---|---|---|
| دخل مستلم | 5–6 | 8 (+1 إن مرتبط بجدول دخل متوقع) |
| تحويل بين حسابين | 5 | 8 |
| تحويل بعمولة | 6 | 11 |
| دفع التزام (`expense`) | 7 | 11 |
| دفع التزام (`financing`) | 6 | 10 (بلا ميزانية) |
| تحصيل دين | 6 | 9 |
| سداد دين | 6 | 9 (+2 إن فوائد) |
| إنشاء دين (أ) | 5 | 8 (+1 إنشاء حساب الخصم عند أول مرة) |
| **إلغاء عملية** | 8–10 | 10–13 |
| **تعديل عملية** (عكس + بديل) | 10–13 | 15–20 |
| تخصيص لهدف | 6 | 9 |
| مادّية دورة التزام | 2 | 2 |
| تهيئة شجرة الحسابات (مرة واحدة) | 0 | ~50 |

### 15.3 فتح لوحة التحكم

| المصدر | قراءات |
|---|---|
| `accounts` كاملة (`onSnapshot`) — تغذّي: الأموال المتاحة، المتاح بعد الحجز، المستحق لي، الديون عليّ، صافي الثروة، أرصدة الحسابات | ~45 مرة واحدة في الجلسة، ثم دلتا |
| `periods/{currentPk}` — الدخل، المصروف، صافي التدفق، المصروف حسب الفئة، مصاريف المنزل، تصحيحات فترات سابقة | 1 |
| `periods` ×11 شهراً سابقاً — مخطط الاتجاه | 11 (الأشهر المنتهية لا تتغير ⇒ يُخزَّن محلياً ⇒ 0 لاحقاً) |
| `budgetPeriods/{currentPk}` | 1 |
| `obligations where remainingMinor > 0 && dueDate <= today order by dueDate limit 10` (المتأخرة) | ≤10 |
| `obligations where remainingMinor > 0 && dueDate <= +7d limit 10` (القادمة) | ≤10 |
| `debts where direction=='payable' && status in [open,partiallySettled]` | ≤10 |
| `debts where direction=='receivable' && status in [open,partiallySettled]` | ≤10 |
| `financialGoals where status=='active' limit 5` | ≤5 |
| `tasks where dueDate == today limit 10` | ≤10 |
| `notifications where read==false order by createdAt desc limit 10` | ≤10 |
| `settings/dashboard` | 1 |
| ميزان المراجعة (I3+I4) | **0 إضافية** — من لقطة `accounts` نفسها |
| بصمة الدفتر (I10) | 3 |
| **الإجمالي: أول فتحة ≈ 120 قراءة. الفتحات التالية في الجلسة ≈ 0–5** | |

على Spark (50,000 قراءة/يوم) ⇒ **~410 فتحة باردة يومياً**. مريح جداً.
**ولو حُسبت الأرصدة من القيود:** ~3,000+ قراءة للفتحة ⇒ 16 فتحة/يوم. **مرفوض.**

### 15.4 تكلفة التقارير

| التقرير | قراءات |
|---|---|
| ملخص شهري | 1 |
| ملخص سنوي | 12 |
| كشف حركة حساب (صفحة 25) | 25 |
| اتجاه رصيد حساب عبر 12 شهراً | ≤12 (`accountPeriods` + تجميع تراكمي) |
| **مجموع أي بُعد على `postings`** (فئة، وسم، جهة، فترة، حساب) | **2** عبر `getAggregateFromServer(sum('signedAmountMinor'))` |
| **بصمة الدفتر** | **2–3** عبر `sum('totalDebitMinor')` + `count()` |
| **تحقق `paidMinor`/`settledMinor`** | **2 لكل كيان** عبر `sum('settlementDeltaMinor')` |
| تقرير مصروفات مُفصَّل لشهر (صفوف لا مجاميع) | عدد قيود الشهر (~150–500) |
| عدد القيود في نطاق | `getCountFromServer()` = قراءة واحدة لكل 1,000 مُدخل فهرس |

**`sum()` و`count()` متاحان على Spark.** وهذا ما يجعل الجمع بين تضمين السطور (للذرّية) و`postings`
المسطَّحة (للتجميع) القرار الصحيح: **لا نتنازل عن أي من الاثنين.**

### 15.5 الفهارس المركَّبة المطلوبة

```
journalEntries:  accountIds (array-contains) + bookedAtTs DESC
journalEntries:  accountIds (array-contains) + bookedAt ASC            ← الفاحص التراكمي
journalEntries:  accountIds (array-contains) + periodKey (==) + bookedAtTs DESC
journalEntries:  status (==) + bookedAtTs DESC
journalEntries:  periodKey (==) + kind (==) + bookedAtTs DESC
journalEntries:  refs.obligationId (==) + bookedAtTs DESC
journalEntries:  refs.debtId (==) + bookedAtTs DESC
journalEntries:  refs.goalId (==) + bookedAtTs DESC
journalEntries:  correctionGroupId (==) + createdAt ASC
journalEntries:  tags (array-contains) + bookedAtTs DESC
journalEntries:  createdAt ASC + __name__ ASC                          ← إعادة البناء (حتمي)

postings:        accountId (==) + bookedAt ASC
postings:        accountId (==) + periodKey (==)
postings:        periodKey (==) + accountType (==)
postings:        categoryId (==) + periodKey (==)
postings:        obligationId (==) + bookedAtTs ASC
postings:        debtId (==) + bookedAtTs ASC
postings:        tags (array-contains) + periodKey (==)
postings:        side (==) + periodKey (==)

accounts:        type (==) + status (==) + sortOrder ASC
accounts:        isCashLike (==) + status (==) + sortOrder ASC
accountPeriods:  accountId (==) + periodKey ASC
obligations:     remainingMinor (>) + dueDate ASC
obligations:     status (==) + dueDate ASC
obligations:     recurrenceId (==) + occurrenceKey ASC
debts:           direction (==) + status (==) + expectedSettleAt ASC
operations:      kind (==) + createdAt DESC
pendingCommands: status (==) + createdAtClient ASC
```

**استثناءات الفهرسة الأحادية (لتقليل تكلفة الكتابة):** إلغاء فهرسة `lines`, `description`,
`attachmentIds`, `payloadHash`, `ancestorIds`, `notes`, `template` — لا نستعلم عليها، وكل حقل مفهرس
يزيد تكلفة الكتابة وحجم الفهرس.

---

## 16. التسوية وإعادة بناء الإسقاطات

### 16.1 التسوية (reconciliation) — الكشف الرخيص الشامل

```ts
export interface ReconciliationReport {
  ranAt: string;
  trialBalanced: boolean;                 // I4
  ledgerFingerprintMatches: boolean;      // I10
  accountDrift: AccountDrift[];           // I3 + I7 + I11
  periodDrift: Array<{ periodKey: PeriodKey; field: string; stored: Minor; computed: Minor }>;
  obligationDrift: Array<{ obligationId: string; stored: Minor; computed: Minor }>;  // I5b
  debtDrift: Array<{ debtId: string; stored: Minor; computed: Minor }>;              // I6b
  earmarkDrift: Minor;                    // I20
  recommendation: 'ok' | 'repairSingleAccount' | 'rebuildProjections';
}

export function runReconciliation(uid: string): Promise<ReconciliationReport>;
```

**الطبقات وتكلفتها — تحقّق ثنائي الاتجاه:**

| الطبقة | الوسيلة | التكلفة |
|---|---|---|
| 1 | **ميزان المراجعة من `accounts`** (I3, I4) | 0 إضافية (من اللقطة) |
| 2 | **بصمة الدفتر**: `sum('totalDebitMinor')` على `journalEntries` + `count()`، ومقارنتها بـ `sum('amountMinor')` على `postings where side=='debit'` (I10) | **3 قراءات** |
| 3 | **رصيد كل حساب من `postings`**: `sum('signedAmountMinor') where accountId == A` (I11) | 2/حساب |
| 4 | **تسويات الكيانات**: `sum('settlementDeltaMinor') where obligationId/debtId` (I5b, I6b) | 2/كيان |
| 5 | فقط إن اختلف شيء ⇒ الفاحص التراكمي لكل حساب مشكوك فيه (I7) | ~200/حساب |

**هذا هو الفرق الجوهري:** الكشف **رخيص على جانب الحسابات (I4) وعلى جانب الدفتر (I10/I11) معاً**،
لا على جانب واحد. فانحراف يحدث في المُجمَّعات يُكتشف بميزان المراجعة، وانحراف يحدث في الدفتر
(أو كتابة التفّت على المسار) يُكتشف بالبصمة.

**متى:** كل تسجيل دخول (الطبقتان 1 و2)، وتلقائياً كل 30 يوماً (كل الطبقات)، وبطلب المستخدم،
وبعد كل استيراد أو ترحيل مخطط.
**عند أي انحراف: لا تصحيح صامت إطلاقاً** — تنبيه حرج + شاشة «سلامة البيانات» + تعطيل الترحيل عند
اختلال I4، ثم قرار المستخدم بين «إعادة بناء» و«حركة تسوية مبرَّرة».

### 16.2 إعادة بناء الإسقاطات — الإجراء الكامل

**لماذا نحتاجها (أربع حالات حقيقية):**

1. خطأ في منطق التحديث أدّى إلى أرصدة خاطئة **واستمر شهرين**.
2. تغيير شكل إسقاط: إضافة حقل مثل `householdExpenseMinor` **بعد 2000 قيد**.
3. انحراف كشفته التسوية.
4. إسقاط جديد كلياً (تقرير سنوي، محور الشهر المالي في ADR-008).

> **هذه القدرة ليست رفاهية.** مسار «إصلاح حساب واحد بتأكيد المستخدم» لا جواب له عن الحالتين 1 و2.
> والفرق هو الفرق بين «خطأ في المُسقِط **قابل للإصلاح**» و«**غير قابل للإصلاح**».
> والتكلفة في تصميمنا منخفضة جداً **لأن `journalEntries` و`postings` سجل غير قابل للتعديل أصلاً**:
> كل المُجمَّعات مشتقة منه بالكامل.

```ts
export interface RebuildPlan {
  projections: Array<'accounts' | 'accountPeriods' | 'periods' | 'budgetPeriods'
                     | 'obligations' | 'debts' | 'financialGoals'>;
  pageSize: 500;
}
export function rebuildProjections(uid: string, plan: RebuildPlan): Promise<ReconciliationReport>;
```

**الإجراء بست مراحل:**

```
المرحلة 0 — البوابة
  update meta/integrity { rebuildStatus:'running', rebuildStartedAt: serverTimestamp(),
                          rebuildCursor: null }
  ⇒ **قواعد الأمان تمنع إنشاء أي قيد أو posting** (`rebuildNotRunning`)   [I24]
  ⇒ الواجهة تدخل وضع «قراءة فقط» برسالة عربية صريحة:
     «جارٍ إعادة حساب الأرصدة — لا يمكن تسجيل عمليات الآن.»
  ⇒ `pendingCommands` تبقى في الطابور ولا تُنفَّذ

المرحلة 1 — الحالة الأولية
  state = { accounts: {كل حساب بأصفار + openingBalanceMinor من قيد opening},
            accountPeriods: {}, periods: {}, budgets: {سقوف كما هي، spent = 0},
            obligations: {paid = 0}, debts: {settled = 0, writtenOff = 0}, goals: {saved = 0} }
  ملاحظة: **السقوف (limitMinor) مُدخَلات مستخدم لا إسقاطات ⇒ لا تُمسّ إطلاقاً.**
          يُعاد بناء `spentMinor` فقط.

المرحلة 2 — إعادة التشغيل بترتيب حتمي
  استعلم journalEntries order by (createdAt ASC, __name__ ASC) بصفحات pageSize=500
  (ابدأ من rebuildCursor إن وُجد ⇒ **استئناف لا استعادة**)
  لكل قيد — **بما فيه قيود reversal** (لا تُستبعد: الأصل وعكسه يتصافران):
     for each line:
        acc = state.accounts[line.accountId]
        if line.side == 'debit' : acc.debitTotalMinor  += line.amountMinor
        else                    : acc.creditTotalMinor += line.amountMinor
        acc.entryCount += 1
        ap = state.accountPeriods[`${line.accountId}__${entry.periodKey}`]
        ap[line.side === 'debit' ? 'debitMinor' : 'creditMinor'] += line.amountMinor
     طبّق منطق periods وbudgets وobligations وdebts وgoals **من نفس دوال النطاق**
        المستخدمة في المسار الساخن (لا نسخة ثانية — القسم 25 بند 7)
     حدِّث rebuildCursor بعد كل صفحة

المرحلة 3 — الحقول الدالّة في الوقت
  obligation.status ← obligationStatus(...)  بتاريخ اليوم       [10.2]
  debt.status، goal.status، alertFiredAtPercent (يُعاد ضبطه وفق النسبة النهائية)

المرحلة 4 — الكتابة بقيم **مطلقة** لا زيادات
  writeBatch ≤450، بترتيب مقصود:
     (1) accounts
     (2) accountPeriods
     (3) periods
     (4) budgetPeriods
     (5) obligations / debts / financialGoals
     (6) meta/integrity **أخيراً** { projectionVersion: +1, rebuildStatus:'idle',
                                      rebuildCursor: null }
  ⇒ لأن الكتابة **قيم مطلقة محسوبة لا increment**، العملية **قابلة للتكرار بأمان (idempotent)**:
    انقطاع في المنتصف ثم إعادة تشغيل يُنتج نفس النتيجة بالضبط.

المرحلة 5 — التحقق والتدقيق
  runReconciliation() والتأكد من تطابق البصمة والميزان
  create auditLogs { action:'projectionsRebuilt', before, after, reason }
  إن فشل: meta/integrity { rebuildStatus:'failed' } مع بقاء rebuildCursor
     ⇒ المحاولة التالية **تكمل من الموضع نفسه** بنفس الترتيب الحتمي ونفس pageSize
```

### 16.3 عدم الحساسية للترتيب — تحليل صريح

| الإسقاط | حساس للترتيب؟ | السبب |
|---|---|---|
| `accounts.debitTotalMinor` / `creditTotalMinor` / `balanceMinor` | **لا** | مجموع جبري — الجمع تبادلي |
| `accountPeriods.*` | **لا** | مجاميع تجميعية |
| `periods.*` | **لا** | مجاميع تجميعية |
| `budgetPeriods.spentMinor` | **لا** | مجموع |
| `obligation.paidMinor` / `debt.settledMinor` | **لا** | مجموع |
| `obligation.status` / `debt.status` | **لا** | دالّة في (المسدَّد النهائي، `dueDate`، اليوم) لا في المسار |
| `alertFiredAtPercent` | **لا** (بعد إعادة الضبط في المرحلة 3) | يُحسب من النسبة النهائية |
| **حاجز الرصيد السالب** | **غير معنيّ** | حاجز **زمن كتابة** لا إسقاط. **إعادة البناء لا تفحصه ولا تفشل بسببه** |
| **رصيد جارٍ على كل قيد** | **نعم** — **ولذلك لا نخزّنه** (18.2) |

**النتيجة المعمارية المقصودة:** باستثناء ما استُبعد **عن قصد**، كل إسقاطاتنا تجميعية ⇒ **إعادة البناء
مستقلة عن الترتيب**. وهذا يعني أن عدم دقّة مزامنة `createdAt` بين الأجهزة **لا يُفسد** الإعادة؛
الترتيب مطلوب فقط للاستئناف الحتمي وللعرض الزمني.

**عدد مستندات الإسقاط صغير بطبيعته** في تطبيق شخصي:
≈ 50 حساباً + 24 ملخصاً شهرياً + ~600 `accountPeriods` (بعد سنتين) + 24 ميزانية + 60 التزاماً
+ 80 ديناً + 10 أهداف ≈ **850 مستنداً** ⇒ **دفعتان** ⇒ البوابة (المرحلة 0) هي ما يجعلها آمنة،
لا الذرّية. **وهذا مُعلَن لا مُخفى:** إعادة البناء **ليست ذرّية** إن تجاوزت دفعة واحدة، والمعالجة
هي البوابة + الاستئناف + القيم المطلقة.

---

## 17. الترحيل (migration)

### 17.1 العقد الصريح: الدفتر لا يُرحَّل أبداً

**ADR-019 — ثلاث قواعد غير قابلة للتفاوض:**

1. **`journalEntries` و`postings` لا تُرحَّل بأي حال.** الكتابة عليهما تناقض عدم قابليتهما للتغيير
   وتُبطل قيمتهما كسجل تدقيق. وبدلاً من ذلك: **كل قارئ ومُسقِط يحمل معالجاً لكل `schemaVersion`
   تاريخي** (`reduceEntryV1`, `reduceEntryV2`, …).
2. **الترحيل يُطبَّق فقط على المستندات المشتقة والمرافقة:** `accounts`, `accountPeriods`, `periods`,
   `budgetPeriods`, `obligations`, `debts`, `financialGoals`, `settings`, `categories`, `recurrences`.
   **وكلها قابلة لإعادة البناء من الدفتر** ⇒ أي ترحيل فاشل يُصلَح **بإعادة بناء لا باستعادة نسخة احتياطية**.
3. **الترحيل البطيء عند القراءة** (`lazy read-time migration`) هو الافتراضي:

```ts
// domain/migrate/migrate.ts
/** يحوّل في الذاكرة من أي نسخة أقدم إلى النسخة الحالية. نقية. */
export function migrateAccount(raw: unknown): Account;
export function migrateObligation(raw: unknown): Obligation;
// … لكل نوع مشتق

/** المُرحَّل يُكتب عند **أول كتابة طبيعية** على المستند، لا في دفعة عند تسجيل الدخول. */
```

**لماذا البطيء أفضل من الدفعي:** المستندات قليلة التغيّر (أهداف، ميزانيات قديمة، ملخصات شهور منتهية)
لا تحتاج `writeBatch` مجزَّأ عند كل تحديث نسخة. والدفعي يُنتج عشرات الكتابات عند كل تسجيل دخول بعد
كل إصدار، بلا فائدة.
**الاستثناء:** ترحيل يغيّر **معنى** حقل مُجمَّع (لا شكله) ⇒ **إعادة بناء كاملة** (قسم 16)، لا ترحيل.

### 17.2 حارس النسخة الأحدث — يبقى كما هو

```
meta/schema = { currentVersion, appliedMigrations[] }

if meta.currentVersion < APP_SCHEMA_VERSION:
      تشغيل المُرحِّلات المتدرّجة (أو تسجيل النسخة الجديدة إن كان الترحيل بطيئاً)
      + auditLogs { action:'migrationApplied' }

if meta.currentVersion > APP_SCHEMA_VERSION:
      **منع كل كتابة** بخطأ SCHEMA_VERSION_AHEAD
      «بيانات حسابك أحدث من نسخة التطبيق على هذا الجهاز. حدِّث التطبيق للمتابعة.»
```

**هذا الحارس هو أفضل ما في فصل الترحيل ولا بديل عنه:** يمنع جهازاً بنسخة أقدم من تلف البيانات
بكتابة بشكل قديم فوق بيانات بشكل جديد — وهو سيناريو حقيقي تماماً مع مستخدم على هاتف وحاسوب.

### 17.3 التصدير والنسخ الاحتياطي

ق-1 يجعل **التصدير اليدوي JSON ميزة أساسية في المرحلة الأولى لا تأجيلاً**، لأنها النسخة الاحتياطية
الوحيدة على Spark. متطلبات النواة منها:

- تصدير كامل: `journalEntries` + `postings` + `accounts` + كل المُجمَّعات + المستندات المرافقة.
- **التصدير يحمل `projectionVersion` و`schemaVersion`** لكل مستند ⇒ الاستعادة تعرف ما تفعله.
- **الاستعادة تستورد الدفتر فقط ثم تُشغِّل إعادة بناء** — لا تستورد المُجمَّعات.
  السبب: الدفتر هو مصدر الحقيقة الوحيد، والمُجمَّعات مشتقة. استيراد مُجمَّع قد يُدخل انحرافاً.
- `auditLogs { action: 'dataExported' }` مع كل تصدير + تذكير دوري داخل التطبيق بأخذ نسخة (ق-1).

---

## 18. القصور المُعلَن صراحةً

> **هذا القسم يُكتب هنا ليُقرأ من المالك، لا ليُكتشف بعد سنة.** كل بند فيه حدٌّ حقيقي للتصميم،
> مع العلاج المعتمد وما يبقى من خسارة.

### 18.1 لا حاجز رصيد تاريخي — حاجز الرصيد يُفحَص على **الرصيد الحالي**

**القصور:** `assertBalanceFloor` يُفحَص على `account.balanceMinor` **الآن**، لا على الرصيد كما كان في
`bookedAt`.

> **السيناريو:** الرصيد اليوم 500.000، ويُسجَّل مصروف 300.000 بتاريخ 2026-08-02 حيث كان الرصيد
> 50.000 ⇒ **يُقبَل**، ويُنتج **رصيداً سالباً في منتصف التاريخ** على حساب `minBalanceMinor = 0`،
> فيظهر التناقض في كشف الحساب الذي يحسب الرصيد التراكمي.

**العلاج المعتمد:**

1. **فاحص يُبلِّغ لا يمنع:** `scanHistoricalNegatives(accountId)` يحسب الرصيد التراكمي على ترتيب
   `bookedAt` ويُبلِّغ عن **كل لحظة سلبية تاريخية** مع تاريخها والقيد المسبِّب، في شاشة «سلامة البيانات».
2. **تحذير واجهة عند الإدخال بتاريخ ماضٍ:** «هذه العملية بتاريخ 2026-08-02. الرصيد التاريخي
   للحساب في ذلك اليوم لم يُفحص.»
3. حساب **الرصيد التراكمي في كشف الحساب فقط** (لا في أي مُجمَّع).

**ما يبقى من خسارة:** قيد بتاريخ ماضٍ قد يُنتج سالباً تاريخياً دون منع. **السبب الذي نقبله:**
المنع الحقيقي يستلزم قراءة كل القيود بعد ذلك التاريخ داخل المعاملة — وهو **مستحيل**
(`tx.get` لا يقبل استعلامات) ومكلف. والمنع البديل (حظر الإدخال بتاريخ ماضٍ) يُسقط حالة مشروعة
ومتكررة: الفاتورة المتأخرة.

### 18.2 لا رصيد جارٍ مخزَّن على القيد

**القرار المقصود:** لا حقل `runningBalanceMinor` على القيد.

**السبب الصريح:** تخزينه **يُبطل إدخال قيد بتاريخ ماضٍ** (كل القيود اللاحقة تحتاج إعادة كتابة)،
ويجعل السجل **حساساً لترتيب الكتابة** (وهو ما يُفسد إعادة البناء — جدول 16.3).

**العلاج:** الرصيد الجاري يُعرض **في الصفحة الأولى من كشف الحساب فقط**، محسوباً في العميل تراكمياً
من `account.balanceMinor` نزولاً. الصفحات الأعمق تعرض المبلغ والاتجاه بلا رصيد جارٍ.
**ما يبقى:** لا عمود «الرصيد بعد الحركة» في التصدير الكامل ولا في الصفحات العميقة.

### 18.3 القيد المزدوج **لا يكشف قلب الاتجاه**

**القصور:** قيد `Dr asset / Cr expense` بدل `Dr expense / Cr asset` **متوازن تماماً** ⇒ يمرّ من I1
ومن كل قواعد الأمان، لكنه **يرفع الرصيد ويخفض المصروف**. أي أن صنف الأخطاء الجديد الذي يُدخله القيد
المزدوج **لا يحميه ثابت بنيوي**.

**العلاج المعتمد (ثلاث طبقات، ومُعلَن أنها اختبار لا ثابت):**

1. **`planOperation` هي المكان الوحيد الذي يبني `lines` و`side`** — مفروض بأداة البناء (قسم 21).
2. **`assertKindShape`** (ثابت I2b في قسم 13): يرفض أي سطر لا يطابق (النوع، الجانب) المسموح لنوع القيد
   ⇒ يكشف «مصروف يرفع الرصيد» و«دخل يخفضه» و«سداد يُسجَّل مصروفاً».
3. **اختبار جدولي (table-driven) يغطّي كل صف في القسم 9** بالاتجاه والمبلغ والحساب — **شرط غير قابل
   للتفاوض قبل أي نشر**.

**ما يبقى:** قلب الاتجاه بين حسابين من **نفس النوع** (تحويل، تحصيل) يبقى مطابقاً للشكل ويعتمد كشفه
على الاختبار الجدولي وحده. **نعلنها بوضوح: هذه نقطة يعتمد فيها الأمان على جودة الاختبارات لا على
ثابت رياضي.**

### 18.4 لا فرض خادمي للمقدار على Spark

**القصور الأهم في النظام كله، ويجب أن يُعرض على المالك بهذه الصيغة:**

> قواعد Firestore تُقيَّم **لكل مستند على حدة** ولا ترى بقية مستندات نفس الـ transaction.
> لذلك **لا شيء على Spark يفرض أن مقدار تغيّر الرصيد يطابق مبلغ العملية واتجاهها.**

ما نملكه فعلاً وما لا نملكه:

| نملكه | لا نملكه |
|---|---|
| `Σdebit == Σcredit` **على مستند القيد** (I1) | أن `balanceMinor` الجديد = القديم ± مبلغ السطر |
| `balanceMinor` مشتق من الإجماليين (I3) | أن الإجماليين زادا بمقدار سطور **هذا** القيد |
| `balanceMinor >= minBalanceMinor` | أن الحركة تخصّ **هذا** الحساب بالمبلغ الصحيح |
| `paidMinor <= due` و`remaining` مشتق (I5, I6) | — |
| `periodKey == bookedAt[0:7]` (I18) | — |
| كشفاً **لاحقاً** رخيصاً بـ I4 و I10 و I11 و I5b | منعاً **مسبقاً** للمقدار |

**الخلاصة التي يجب أن تُكتب في ADR-020 وتُعرض على المالك:**
على Spark، الضمان النهائي = **مسار كتابة وحيد + اختبار جدولي لكل صف في القسم 9 + فاحص دوري +
ثوابت كشف رخيصة**. والفرض الخادمي الحقيقي **يبدأ فقط عند الترقية إلى Blaze** مع
`allow write: if false` من العميل وCloud Function كاتباً وحيداً — **وهذا متوافق مع ق-1 كطبقة تحسين
لا إعادة بناء**، لأن `planOperation` النقية تُشارَك كملف واحد بين العميل والخادم.

**تقييم المخاطرة:** مقبولة لمستخدم واحد هو المالك الوحيد لبياناته (الوضع الحالي بق-2).
**غير مقبولة عند إضافة مستخدمين** — وهذا هو شرط الترقية الحقيقي، لا الأداء ولا التكلفة.

### 18.5 إعادة البناء ليست ذرّية إن تجاوزت دفعة

مُعلَنة في 16.2. المعالجة: البوابة + الاستئناف + القيم المطلقة. وفي الحالة الواقعية (~850 مستند
إسقاط) تحتاج دفعتين، فالبوابة هي ما يحميها لا الذرّية.

### 18.6 أمور أخرى مُعلَنة

| القصور | المعالجة | الخسارة الباقية |
|---|---|---|
| `runTransaction` **يفشل دون اتصال** | طابور `pendingCommands` + معرّفات حتمية | لا ترحيل فوري دون اتصال؛ العملية «بانتظار المزامنة» ومستبعدة من كل رصيد. وعملية على جهاز ضاع **قبل** أي اتصال = ضائعة |
| التقارير **نقدية الأساس** (R4) | الالتزام توقّع لا مصروف حتى يُدفع | التزام ديسمبر المدفوع في يناير يظهر مصروف يناير |
| «بداية الشهر المالي» غير مفعَّلة في الإصدار الأول | ADR-008: محور تقرير منفصل يُبنى بإعادة البناء | التقارير بالشهر الميلادي في الإصدار الأول |
| المرفقات مؤجَّلة (ق-1) | الحقل في المخطط والواجهة معطَّلة بوسم «يتطلب ترقية» | لا صور إيصالات. البديل المؤقت: حقل ملاحظة نصي |
| لا إشعار والتطبيق مغلق (ق-1) | إشعارات داخل التطبيق + Web Notifications عند الإذن | **لا نَعِد المستخدم بإشعار يصله والتطبيق مغلق** |
| ازدحام `periods/{pk}` (~كتابة/ثانية) | مسار استيراد منفصل (7.4) | يظهر في الاستيراد الجَمْعي فقط، ومعالَج |
| التعقيد الذهني (debit/credit، شجرة حسابات) | إخفاء كامل: عمليات مُسمّاة، لا مكوّن يبني `lines`، لا كلمة «مدين/دائن» في أي واجهة مستخدم (إلا شاشة «دفتر القيود» المتقدمة الاختيارية) | تكلفة صيانة أعلى ومنحنى تعلّم لأي مطوّر جديد |
| كلمة «حساب» بمعنيين | الواجهة: «مصادر الأموال» للنقدية و«شجرة الحسابات» للمتقدمة. الكود: `Account` للشجرة و`fundingSource` للعرض | التباس محتمل في المصطلح العربي |

---

## 19. معالجة العيوب القاتلة — كل واحد باسمه

> الترميز: **ع-أ** = عيب في النموذج الفائز (أ) **يجب إصلاحه** — وقد أُصلح هنا.
> **ع-ب** و**ع-ج** = عيب في بديل مرفوض، يُذكر لأن تجنّبه **قرار تصميمي صريح في هذه الوثيقة**
> لا مصادفة. **ع-ع** = عيب عرضي مشترك، يُعلَن في قسم 18.

### 19.1 عيوب النموذج الفائز — أُصلحت كلها

| # | العيب | الشدّة | المعالجة في هذه الوثيقة |
|---|---|---|---|
| **ع-أ-1** | **خطأ أسبقية منطقية في قاعدة `create` على القيود** يُلغي كل الفرض الخادمي: `&&` أعلى أسبقيةً من `or` المنطقي ⇒ `(ملكية && معرّف) \|\| (معرّف && شكل && قفل)`. الفرع الأول يتحقق دائماً في القيد الواحد ⇒ **يُقبل قيد غير متوازن، بسطر واحد، بمبلغ صفري، وفي فترة مُقفلة**، والفرع الثاني لا يفحص الملكية | **قاتلة** | **§14.2 و§14.3:** أقواس صريحة، و`entryShapeOk` و`isOwner` و`ownerUid` شروط **مشتركة لا بديلة**. البوابة والقفل شرطان مستقلان بأقواسهما. + اختبار محاكي T-RULES-1..9 يحاول كل خرق على حدة |
| **ع-أ-2** | **لقطات `accountPeriods.{opening,closing}` تنكسر مع أي قيد بتاريخ ماضٍ** ⇒ رصيد بداية/نهاية كل شهر لاحق خاطئ **إلى الأبد**، و**لا ثابت يكشفه** (الميزان يفحص `accounts` فقط) ⇒ الفاحص يُبلّغ «سليم» فوق تقارير تالفة. ويزيده سوءاً كتابة `openingBalanceMinor: 0` في `set(merge)` التي **تُصفّر اللقطة القائمة** | **قاتلة** | **ADR-009 / §4.7:** الحقلان **محذوفان من المخطط نهائياً**. `accountPeriods` تحفظ الحركة فقط، والمخزون **مشتقّ تراكمياً** (`closingBalanceAt` في §5.2) ⇒ القيد بتاريخ ماضٍ يصحّح كل الأشهر اللاحقة تلقائياً. + **الثابت I13** يربط مجموع الحركات بالرصيد |
| **ع-أ-3** | **تناقض داخلي يُعطِّل ميزة معلنة:** القاعدة تفرض `periodKey == bookedAt[0:7]` بينما القسم 21 ينصّ على `fiscalMonthStartDay` ⇒ قيد 2026-10-27 من فترة `2026-11` **ترفضه القاعدة**. فإمّا الميزة ميتة أو القاعدة تسقط. والأخطر أن `periodKey` على قيد **غير قابل للتغيير** | **قاتلة (تناقض)** | **ADR-008 / §5.5:** حُسم صريحاً. محور الدفتر = الشهر الميلادي **مفروضاً**؛ محور «الشهر المالي» = **نافذة على `bookedAt`** في إسقاط منفصل `fiscalPeriods` يُبنى بآلية إعادة البناء ⇒ قابل للتفعيل والتغيير لاحقاً **بلا أي كتابة على قيد** |
| **ع-أ-4** | **مسار الإصلاح يحظره النظام نفسه:** قاعدة `accounts` تشترط تزايداً **مُطلقاً** لـ `debitTotalMinor`/`creditTotalMinor` ⇒ إصلاح أثر طُبِّق مرتين يستلزم **تنقيصاً** ⇒ **ترفضه القاعدة** ⇒ لا إصلاح. والبديل (قيد تسوية) يُعيد التوازن **لكن يُبقي إجماليات مدى الحياة خاطئة للأبد** | **قاتلة** | **§14.3:** التناقص مسموح **فقط** عندما `rebuildStatus == 'running'` (`\|\| rebuildRunning(uid)`) ⇒ `rebuildProjections` قابل للتنفيذ فعلاً، ويبقى الحارس قائماً في كل الأوقات الأخرى |
| **ع-أ-5** | **دورة متكرّرة تُفقَد بصمت:** الدورة التالية تُنشأ فقط عند `remainingAfter === 0` ⇒ إيجار 800.000 سُدِّد منه 700.000 ⇒ **دورة نوفمبر لا تُنشأ أبداً**، فلا تظهر في «القادمة» ولا يصدر أي تنبيه استحقاق. القسم 8 يطلب تنبيهات قبل/في/بعد ⇒ تسقط كلها | **قاتلة** | **ADR-013 / §4.9 / §12.9:** «توليد الدورة» **مفصول** عن «اكتمال السداد» ومربوط **بالتقويم** عبر `recurrences` + مُشغِّل الاستدراك بـ `opId` حتمي `obl:{recurrenceId}:{dueDate}` |
| **ع-أ-5b** | **دورة وهمية تتضخم:** إنشاء الدورة داخل معاملة الدفع يعني أن **عكس** تلك الدفعة يتركها قائمة ⇒ «الالتزامات القادمة» تعرض الإيجار **مرتين** و«إجمالي المستحق» متضخم 800.000 | عالية | نفس ADR-013: `payObligation` **لا يُنشئ أي دورة إطلاقاً** (§12.4، وجدول 8.3: «ودورة التكرار لا تُلمس») |
| **ع-أ-6** | **فقدان دقة في حساب نسبة:** `applyRatio` و`percentOf` بـ `number`. مبلغ ~`10^12` × بسط `10^4` = `10^16 > 2^53` ⇒ **نتيجة زكاة/رسوم خاطئة صامتة**، في موضع يطلب فيه القسم 15.4 توضيح الطريقة | **قاتلة** | **§2.4:** `mulRate(v, bps) = Number((BigInt(v)*BigInt(bps) + 5000n)/10000n)` + النسب بأساس النقطة عدداً صحيحاً بدل بسط/مقام حرّين + حدّ معلن `MAX_ABS_MINOR` + اختبار يفشل عند استخدام `number` |
| **ع-أ-7** | **قواعد `accounts` لا تربط `balanceMinor` بالإجماليين** ولا بأي قيد ⇒ يمكن كتابة **أي** رصيد مع تقديم `balanceVersion`، والحقل هو الذي **تقرؤه كل بطاقة في لوحة التحكم** | متوسطة | **§14.3:** **I3 مفروض من الخادم** بالتعبير الشرطي على `normalSide` المخزَّن + حدّ `minBalanceMinor` + (ADR-022) شرط `getAfter` بعد إثباته |
| **ع-أ-8** | **تعارض تزامن يظهر كخطأ خاطئ:** `opId` للتعديل `amd:{id}:{amendCount}` ليس آمناً: جهازان يقرآن `amendCount = 0` ⇒ نفس `opId` لحمولتين مختلفتين ⇒ `OP_ID_CONFLICT` برسالة «سُجّلت بمحتوى مختلف» وهي **خاطئة دلالياً** ومحيّرة | متوسطة | **ADR-014 / §4.10:** قفل `entryCorrections/{originalEntryId}` بمفتاح فريد ⇒ `ALREADY_CORRECTED` برسالة صحيحة «صُحِّح هذا القيد من جهاز آخر — اعرض النسخة الحديثة»، و`opId = amd:{id}` بلا عدّاد |
| **ع-أ-9** | **لا `match` لمجموعات المُجمَّعات** (`periods`, `accountPeriods`, `budgetPeriods`, `operations`, `notifications`, `categories`, `meta`) وقواعد Firestore ترفض افتراضياً ما لا قاعدة له ⇒ **كل `postOperation` يفشل بـ `permission-denied` عند أول تشغيل بالمحاكي** | **قاتلة (تشغيلياً)** | **§14.3:** قاعدة صريحة لكل مجموعة، تمنع الحذف وتحصر الحقول القابلة للتحديث وتفرض الأعداد الصحيحة. + `allow write: if false` افتراضياً على مستوى `users/{uid}` وكل مجموعة تُفتح صراحةً |
| **ع-أ-10** | **مخالفة ق-3 المُلزِم:** `formatLYD` موصوفة بأنها تُنتج «أرقاماً هندية-عربية حسب الإعداد»، وق-3 يقرر **أرقاماً لاتينية في كل الشاشات** | **مخالفة قرار مالك** | **§2.2:** `Intl.NumberFormat('ar-LY-u-nu-latn')` **حرفياً**، و`tabular-nums` في الجداول، و**اختبار يفشل إن ظهر أي رقم هندي-عربي في المخرج** (T-MONEY-FMT) |
| **ع-أ-11** | **مخالفة ق-2:** `isOwner(uid) = request.auth.uid == uid` **لا يُغلق النظام** — أي حساب Google يستطيع إنشاء شجرته الخاصة والكتابة فيها | **مخالفة قرار مالك** | **§14.1 و§14.3:** `isOwner` يشترط `uid in allowedUids()` ⇒ الإغلاق **في القواعد لا في الواجهة** (ق-2 حرفياً) + اختبار محاكي بحساب غير معتمد |
| **ع-أ-12** | **قلب اتجاه القيد غير مكشوف** بأي ثابت (متوازن تماماً) والمسؤولية محمَّلة كلها على الاختبار | متوسطة | **§13 (I2b `assertKindShape`) + §18.3:** ثابت علاقة (النوع، الجانب) لكل `kind` **مفروض في طبقة النطاق**، + اختبار جدولي لكل صف في القسم 9، + **إعلان صريح** لما يبقى غير مكشوف |

### 19.2 عيوب البديل «أحادي الجانب» — تجنّبها قرار صريح

| # | العيب | كيف يتجنّبه هذا التصميم |
|---|---|---|
| **ع-ب-1** | **حركة العكس ترث تصنيف الأصل** ومبلغها موجب دائماً ⇒ أي تقرير استعلامي **يُضاعف المبلغ** (2X) بدل أن يُصفّره، أو **يُسالبه** (−X) إن صُفِّي بدورة الحياة. **ولا خيار صحيح للمطوّر.** وتشحن الوثيقة مواصفتين متناقضتين لنفس الحقل (الكود يُرجع `adjustment` والنص يقول «يرث») | **مستحيل بنيوياً هنا:** لا حقل تصنيف تقريري أصلاً. العكس **يقلب الجانب** ⇒ `signedAmountMinor` ينقلب ⇒ **أي** مجموع يتصافر رياضياً بلا أي مرشّح (§8.6) |
| **ع-ب-2** | **لا ثابت عرضي بين المستندات على الإطلاق** ⇒ تحويل فُقد طرفه الثاني يُخفي 500.000 د.ل بلا كشف. و`deltaSumMinor` المقترح كمخفِّف **وهمي**: يُكتب من نفس القيمة المقروءة في نفس العبارة ⇒ لا يكشف أي خطأ حسابي ولا كتابة ناقصة | **I4 (ميزان المراجعة) يكشفه بـ ~45 قراءة عند كل تسجيل دخول**، + I10 (بصمة الدفتر) + I11 (رصيد كل حساب من `postings`) ⇒ تحقّق **ثنائي الاتجاه** لا أحادي |
| **ع-ب-3** | **لا `payloadHash`** ⇒ إعادة إرسال بعد تصحيح المبلغ تُرجع **نجاحاً** والمخزَّن هو المبلغ القديم، **بلا رسالة ولا سجل تدقيق ولا أثر** | **§6.3:** `payloadHash` إلزامي على كل قيد ومقارنته داخل المعاملة ⇒ `OP_ID_CONFLICT` برسالة عربية واضحة |
| **ع-ب-4** | **`type:'income'` + `subtype:'debtDrawdown'`** ⇒ مستند نوعه «دخل» **ليس دخلاً**، وأول استعلام طبيعي `where type=='income'` **يضخّم الدخل بأصل كل قرض** | **مستحيل بنيوياً:** طرف القرض حساب `liability` لا `income`، والتقرير يشتق الدخل من **نوع الحساب** (R6، R11) |
| **ع-ب-5** | الحاجز الخادمي الوحيد `getAfter()` **غير مُثبت** وقاصر بالتصميم: يضمن «لا رصيد بلا حركة» ولا يضمن المقدار ولا الإشارة ولا أن الحركة تخصّ هذا الحساب | **ADR-022 مقترح لا معتمد** — لا نبني سلامة النظام عليه. الضمان عندنا: I1 مفروض من الخادم على مستند القيد + I3 + حدّ الرصيد + كشف رخيص ثنائي الاتجاه. والقصور مُعلَن في §18.4 |
| **ع-ب-6** | **تكاثر المُجمَّعات:** تسعة أسطح انحراف مستقلة و4 دوال patch يجب أن تتفق ⇒ أي تناقض = رقم خاطئ صامت | عندنا مُجمَّعات أيضاً، **لكن كلها مرتبطة بالدفتر بثابت قابل للفحص** (I3, I4, I7, I9, I11, I13, I14, I16, I5b, I6b) **وكلها قابلة لإعادة البناء** (§16.2). والجرد في §11.5 هو الوثيقة المُراجَعة عند كل ميزة |
| **ع-ب-7** | **دالة الأثر تتجاهل الاتجاه** في كل الأنواع إلا `adjustment`، وبناء العكس يقلب الاتجاه فقط ⇒ **إلغاء مصروف يخصم المبلغ مرتين**، والثابت الوحيد يبقى «صحيحاً» فلا شيء يكشفه | **مستحيل:** الأثر عندنا دالّة واحدة `lineSign(accountType, side)` — **لا جدول حالات لكل نوع**، فقلب الجانب يقلب الأثر حتماً |
| **ع-ب-8** | **جدول تصنيف الحقول لا يطابق القواعد:** الجدول يسمح بتعديل التاريخ في مكانه والقواعد لا تذكره في `unchanged` ولا تربطه بـ `periodKey` ⇒ تقرير يناقض نفسه | **§8.2 + §14.3:** الجدول والقواعد **مُلزَمان بالتطابق**، والقاعدة `periodKey == bookedAt[0:7]` تجعل التعديل داخل الشهر آمناً بنيوياً. + اختبار محاكي لكل صف |

### 19.3 عيوب البديل «سجل الأحداث» — تجنّبها قرار صريح

| # | العيب | كيف يتجنّبه هذا التصميم |
|---|---|---|
| **ع-ج-1** | **آثار السجلات التشغيلية خارج ضمان التوازن:** حدث دفعة بأرجل 20.000 و`paidDeltaMinor: 200000` **يمرّ من كل الثوابت والقواعد** ⇒ الالتزام يظهر «مسدَّداً» ويتوقف المستخدم عن دفع إيجاره. والقاتل: الرقم **محفور في حدث غير قابل للتعديل** ⇒ إعادة البناء تُعيد إنتاجه والتسوية تُبلّغ عن انحراف **صفر** | **ADR-021 / I5b / I6b:** الأثر على الكيان **ليس رقماً حرّاً** بل **مشتقّ من سطور القيد** عبر `settlementDeltaMinor` على رجل التسوية ⇒ `Σ settlementDeltaMinor === paidMinor` قابل للتحقق **خادمياً بقراءتين**. ولأن السطور محمية بالتوازن، الرقم الخاطئ **قابل للكشف والإصلاح** بإعادة البناء |
| **ع-ج-2** | **قيد العكس يهبط في الشهر الخطأ:** `periodKey` للعكس = فترة لحظة العكس **دائماً** ⇒ شهر الأصل يبقى متضخماً **إلى الأبد** وشهر العكس يبدأ بمصروف **سالب** ونسبة ميزانية سالبة. والحقل المعالج غير موجود في الواجهة ولا في المُسقِط. والمبرّر مبني على «فترة مُقفلة» **غير مُنفَّذة** | **§8.3:** تاريخ الأصل إن كانت الفترة **مفتوحة**، وتاريخ اليوم إن كانت **مُقفلة فعلاً** — مع `periodLocks` **مجموعة حقيقية بقاعدة أمان** (I17)، + حقلا `priorPeriod*CorrectionMinor` **موجودان في الواجهة وفي المُسقِط وفي قاعدة العرض** (سطران منفصلان)، + `budgetPeriods` **لا تُلمس** في تصحيح فترة مُقفلة، + I9 يحفظ معادلة التدفق النقدي |
| **ع-ج-3** | **الأحداث المعكوسة غير قابلة للاستبعاد من أي استعلام** (لا حقل `reversed` على حدث غير قابل للتعديل)، والقفل في مجموعة منفصلة تتطلب انضماماً سالباً لا يملكه Firestore | عندنا **القيد قابل لوسم دورة الحياة** (`status`) — تعديل **مسموح ومحصور بالقواعد على حقول دورة الحياة فقط** — + **جدول مرشّحات صريح لكل سياق عرض** (§8.6). ومع ذلك **لا نعتمد على المرشّح أصلاً** في المجاميع، لأن العكس يتصافر رياضياً |
| **ع-ج-4** | **تنبيهات ميزانية مكرّرة:** الكتابة بـ `increment` **بلا قراءة** تنقل فحص العتبة **خارج** المعاملة ⇒ جهازان ⇒ تنبيهان، وإعادة فتح التطبيق ⇒ ثالث. ولا حقل `alertedAt`. وعيب مرافق: `set(merge)` يُنشئ مستند ميزانية **بلا سقف** ⇒ القسمة على سقف غير موجود | **§5.4:** جدول صريح — `budgetPeriods.spentMinor` **قراءة + قيمة مطلقة** لأن التنبيه يقرأ النتيجة **داخل** المعاملة، + `alertFiredAtPercent` حقل فعلي (§4.7)، + **قاعدة صلبة: لا كتابة ميزانية إن لم يوجد المستند أو الفئة** |
| **ع-ج-5** | **بوابة إعادة البناء تقفل النظام عند غياب مستند:** `get(checkpoint).data.rebuildStatus` على مستند غير موجود ⇒ خطأ تقييم ⇒ **رفض كل كتابة مالية** برسالة `permission-denied` لا تشرح شيئاً | **§3.3 + §14.3:** المستند `meta/integrity` **يُنشأ في التهيئة إلزامياً**، **و**القاعدة تُكتب بنمط آمن: `!exists(...) \|\| get(...).data.rebuildStatus != 'running'` ⇒ طبقتان، + `allow delete: if false` على `meta` |
| **ع-ج-6** | **مستند عدّاد ساخن** يُكتب في كل حدث ويُقرأ في القواعد في كل إنشاء ⇒ +1 قراءة مفوترة لكل كتابة، ونقطة تنازع واحدة تُسبب إعادة محاولات (وكل إعادة تُعيد كل القراءات)، وسقف ~كتابة/ثانية يصير سقفاً على النظام كله. مع **تناقض داخلي**: تحليل التنازع يتحدث عن تنازع على مستند **لا يُقرأ أصلاً** (و`increment` بلا قراءة لا يُسبّب إعادة محاولة) | **ADR-016:** **لا مستند عدّاد ساخن إطلاقاً.** `meta/integrity` يُكتب فقط في التهيئة وإعادة البناء والتسوية. البصمة تُحسب **عند الطلب** بـ `getAggregateFromServer(sum('totalDebitMinor'))` بـ 2–3 قراءات. ونقطة الازدحام الوحيدة الباقية `periods/{pk}` ومعالَجة في مسار الاستيراد. **وتكلفة `get()` في القواعد مُحاسَبة ومعلنة في §15.1** لا مخفاة |
| **ع-ج-7** | **مصفوفة معرّفات الدفعات بحدّ 50 بلا إجراء ترحيل**، ولا `arrayRemove` عند العكس ⇒ الطول يفقد مطابقته لعدد الدفعات، ومستند تقرؤه لوحة التحكم ينمو مع كل دفعة، والتزام بأقساط 60 شهراً يصطدم بالحد في منتصف عمره | **ADR-005 / §4.5:** **لا مصفوفة ولا مجموعة موازية.** سجل الدفعات = `journalEntries where refs.obligationId == id` بفهرس قائم ⇒ **مصدر حقيقة واحد وحجم مستند ثابت وبلا سقف** |

### 19.4 العيوب العرضية المشتركة

| # | العيب | المعالجة |
|---|---|---|
| **ع-ع-1** | حاجز الرصيد يُفحَص على الرصيد **الحالي** لا التاريخي | **§18.1:** فاحص يُبلِّغ لا يمنع + تحذير واجهة عند التاريخ الماضي + رصيد تراكمي في كشف الحساب — **مُعلَن صراحةً** |
| **ع-ع-2** | قلب اتجاه القيد لا يُخلّ بالتوازن فلا يكشفه ثابت | **§13 I2b + §18.3** — مُعلَن |
| **ع-ع-3** | لا فرض خادمي للمقدار على Spark | **§18.4 + ADR-020** — مُعلَن للمالك بصيغته الكاملة |
| **ع-ع-4** | إعادة الإرسال بعد تعديل المبلغ تُفقد التصحيح بصمت | **§6.3** `payloadHash` — محصَّن |
| **ع-ع-5** | ازدواج **دلالي** (نفس المصروف من جهازين بـ `opId` مختلفين) | **§6.5** `findNearDuplicates` — تحذير لا حجب |

### 19.5 خلاصة: ما صار مفروضاً من الخادم بعد الإصلاح

**قبل الإصلاح** كان الادّعاء «I1 مفروض من الخادم» **غير صحيح** بسبب ع-أ-1، وكان التصميم عملياً
يهبط إلى «انضباط برمجي». **بعد الإصلاح**، المفروض من الخادم فعلاً وبإثبات في المحاكي:

I1 (التوازن) · I2 (شكل السطور والحدود) · I3 (الرصيد مشتق) · حدّ الرصيد المطلق · I5 و I6
(منع السداد/التحصيل الزائد) · I15 (مصاريف المنزل مجموع فرعي) · I17 (الفترة المُقفلة) ·
I18 (تماسك الفترة) · I22 (المستحق ليس نقداً) · I24 (بوابة إعادة البناء) ·
عدم قابلية القيد والـ postings للتغيير · منع الحذف المالي · **ق-2 (إغلاق النظام على UID المالك)**.

---

## 20. الاختبارات الإلزامية

**لا نشر قبل اجتياز كل هذه المجموعات** (القسم 23 + القسم 25 بند 10 و16).

| المجموعة | محتوى الاختبار | البيئة |
|---|---|---|
| **T-MONEY** | جدول §2.7 كاملاً + `parseAmountToMinor` بمدخلات عربية/أوروبية/4 خانات/فارغ/سالب + `mulRate` بـ `BigInt` مقارنةً بمرجع (**يفشل عند استخدام `number`**) | وحدة |
| **T-MONEY-FMT** | `formatLYD` **لا يُنتج أي رقم هندي-عربي أبداً** (ق-3) في كل الإعدادات | وحدة |
| **T-ALLOC** | `splitEven` و`allocateByWeights`: `Σ = total` على 10,000 حالة عشوائية (property) + جدول الحالات الحدّية | وحدة |
| **T-BALANCE** | رفض قيد غير متوازن، بسطر واحد، بمبلغ 0 أو سالب أو كسري أو فوق `MAX_ABS_MINOR` | وحدة |
| **T-PLAN** | **اختبار جدولي لكل صف في القسم 9**: المدخل ⇒ `WritePlan` متوقَّع **بالكامل** (الاتجاه والمبلغ والحساب وكل مُجمَّع). **هذا هو الحاجز الوحيد ضد قلب اتجاه القيد** (§18.3) | وحدة |
| **T-KIND** | `assertKindShape` يرفض: مصروف يرفع الرصيد، دخل يخفضه، سداد يُسجَّل مصروفاً | وحدة |
| **T-NATURE** | التزام `nature='financing'`: **`totalExpenseMinor` لا يتغير** و**`budgetPeriods` لا تُلمس** و`financingPaidMinor` يزيد. وإنشاء `liability.financing.{payee}` تلقائياً عند أول دفعة | وحدة + محاكي |
| **T-EXTRA** | تجاوز على فاتورة متغيرة: الخيار «سدّد المتبقي فقط» و«رسوم إضافية بسبب» ⇒ **`totalMinor` لا يتغير** و`extraChargesMinor` يزيد و`remainingMinor` صحيح و`auditLogs` مكتوب. والقاعدة ترفض رفع `totalMinor` | وحدة + محاكي |
| **T-IDEM** | نفس `opId` ×2 ⇒ قيد واحد و`alreadyApplied` بـ **0 كتابات**؛ نفس `opId` بحمولة مختلفة ⇒ `OP_ID_CONFLICT`؛ استدراك ×50 في نفس اليوم ⇒ قيد/دورة واحدة | محاكي |
| **T-DUP-SOFT** | `findNearDuplicates` يكتشف الحالة ويُرجعها في `warnings` **ولا يحجب** | وحدة |
| **T-CONC** | معاملتان متنافستان على نفس الحساب ⇒ الرصيد النهائي صحيح؛ جهازان بنفس `opId` الحتمي ⇒ قيد واحد؛ رصيد 100 ومصروفان 60 متزامنان ⇒ **أحدهما يُرفض**؛ متبقٍّ 600 ودفعتان 500 ⇒ **الثانية تُرفض** | محاكي |
| **T-OVER** | `X = remaining` ✓، `X = remaining+1` ✗، التزام متغير بإقرار ✓، **دين دائماً ✗** | وحدة + محاكي |
| **T-FLOOR** | `minBalanceMinor = 0` ⇒ رفض؛ `= -500000` ⇒ قبول حتى الحد ثم `BALANCE_BELOW_FLOOR`؛ تخطّي الفحص في الاستيراد | وحدة + محاكي |
| **T-EARMARK** | تجاوز `earmarkedMinor` ⇒ **تحذير ويمضي**؛ تجاوز `minBalanceMinor` ⇒ **منع**؛ I20 و I21 | وحدة |
| **T-VOID** | العكس يُصفّر **كل** المُجمَّعات بالضبط؛ العكس المزدوج ممنوع بالقفل؛ **عكس دخل أُنفق ⇒ رفض بالرسالة الصحيحة** (§8.4) | محاكي |
| **T-VOID-LOCKED** | عكس قيد من فترة **مُقفلة** ⇒ تاريخ اليوم + `priorPeriod*CorrectionMinor` + **`totalExpenseMinor` لا يتغير** + **`budgetPeriods` لا تُلمس** + I9 يصحّ | محاكي |
| **T-EDIT** | التعديل بدلتا **صافية**؛ تعديل تاريخ يُنقل بين فترتين؛ تعديل من 500 إلى 480 **لا يفشل** بسبب حدٍّ تجاوزه الأصل؛ جهازان يعدّلان ⇒ الثاني `ALREADY_CORRECTED` **لا `OP_ID_CONFLICT`** | محاكي |
| **T-FIELDS** | **صفّ لكل صف في جدول §8.2**: الحقول «في مكانه» تُقبل، و«عكس + بديل» تُرفض من القواعد. و`tags.household` يُحدِّث `householdExpenseMinor` | محاكي |
| **T-BACKDATE** | قيد بتاريخ شهر سابق: `accountPeriods` للشهرين صحيحة، و**`closing(سابق) === opening(لاحق)` مشتقاً** (I13)، ومخطط الاتجاه صحيح | وحدة + محاكي |
| **T-RECUR** | دورة التزام لا تُنشأ من الدفع؛ تُنشأ من القالب؛ سداد جزئي **لا يمنع** دورة الشهر التالي؛ عكس دفعة **لا يُنشئ ولا يُلغي** أي دورة؛ `maxBackfillDays` يحوّل الفائت إلى قائمة اختيار | وحدة + محاكي |
| **T-STATUS** | جدول §10.2 صفاً صفاً، وخاصة الصف 3 (**متأخر يغلب مسدَّداً جزئياً**) | وحدة |
| **T-LOCK** | قيد داخل فترة مُقفلة مرفوض **من القواعد** لا من الكود فقط | محاكي |
| **T-RULES-1** | **قيد غير متوازن مرفوض** — الاختبار الذي يكشف عيب الأسبقية (ع-أ-1) | محاكي |
| **T-RULES-2..9** | قيد بسطر واحد ✗؛ مبلغ صفري ✗؛ `periodKey != bookedAt[0:7]` ✗؛ `status != 'posted'` ✗؛ تعديل مبلغ قيد ✗؛ حذف قيد ✗؛ تعديل posting ✗؛ `paidMinor > due` ✗؛ `remainingMinor` خاطئ ✗؛ `balanceMinor != debit−credit` ✗؛ `balanceMinor < minBalanceMinor` ✗؛ `receivable` بـ `isCashLike:true` ✗؛ **قراءة/كتابة من UID غير معتمد ✗ (ق-2)** | محاكي |
| **T-RULES-GATE** | `rebuildStatus='running'` ⇒ إنشاء قيد مرفوض؛ **حذف `meta/integrity` ⇒ النظام يبقى يعمل** (النمط الآمن) | محاكي |
| **T-REPAIR** | تنقيص `debitTotalMinor` مرفوض عادةً و**مقبول** عندما `rebuildStatus='running'` (ع-أ-4) | محاكي |
| **T-INTEGRITY** | توليد 500 عملية عشوائية (بما فيها إلغاءات وتعديلات) ⇒ **كل ثابت من I1 إلى I24 يصحّ** | property + محاكي |
| **T-REBUILD** | إعادة البناء من الصفر تُنتج **نفس** المُجمَّعات بالضبط؛ انقطاع في المنتصف ثم استئناف ⇒ نفس النتيجة (idempotent)؛ **عدم الحساسية للترتيب**: خلط ترتيب التشغيل ⇒ نفس النتيجة | محاكي |
| **T-SETTLE-LINK** | زرع `paidMinor` خاطئ يدوياً ⇒ **I5b يكتشفه** (`Σ settlementDeltaMinor ≠ paidMinor`) — وهذا هو الاختبار الذي يُثبت تجنّب ع-ج-1 | محاكي |
| **T-REPORTS** | مجموع `periods` لسنة = مجموع القيود المحسوب من الصفر = `sum('signedAmountMinor')` على `postings` (القسم 23 بند 12). **ويُجرى على بيانات فيها إلغاءات وتعديلات** | محاكي |
| **T-OUTBOX** | وضع offline ⇒ العملية تُطابَر في `pendingCommands` و**لا تظهر في أي رصيد أو تقرير**؛ عند العودة تُرحَّل **مرة واحدة**؛ خطأ نهائي ⇒ `rejected` برسالة عربية | محاكي + محاكاة الشبكة |
| **T-ISOLATION** | قراءة بيانات مستخدم آخر مرفوضة؛ كتابة بـ `ownerUid` مختلف مرفوضة | محاكي |
| **T-MIGRATE** | `meta.currentVersion > APP_SCHEMA_VERSION` ⇒ **منع كل كتابة** بـ `SCHEMA_VERSION_AHEAD`؛ والترحيل البطيء يقرأ نسخة أقدم ويكتبها عند أول كتابة طبيعية؛ و**لا ترحيل على `journalEntries` أبداً** | محاكي |

**سجل الأخطاء** (القسم 23 سطر 237): لكل خطأ مكتشَف ⇒ `docs/qa/BUGLOG.md` بـ
(الوصف، السبب الجذري، الإصلاح، نتيجة إعادة الاختبار، رقم الاختبار المضاف).
**القاعدة:** كل خطأ يُكتشف يدوياً يصبح **اختباراً آلياً** قبل اعتبار الإصلاح مكتملاً.

---

## 21. فرض حدود الطبقات بأداة البناء

**القاعدة الحاكمة: مراجعة الكود ليست حاجزاً. الأداة هي الحاجز.**
مراجعة الكود لمطوّر واحد = لا مراجعة، وأي قاعدة «تُحرس في مراجعة الكود» تنهار مع أول مطوّر ثانٍ —
وهذا تحديداً الخطر الذي يقتل القيد المزدوج (تسريب debit/credit إلى الواجهة).

### 21.1 هيكل المجلدات

```
src/domain/                       ← **خالصة: صفر استيراد من firebase ومن data ومن ui**
├── money/      { Minor.ts, parse.ts, format.ts, arithmetic.ts, rate.ts, allocate.ts }
├── coa/        { sides.ts, codes.ts, seed.ts }
├── types/      { common.ts, Account.ts, JournalEntry.ts, Posting.ts, Obligation.ts,
│                 Debt.ts, Period.ts, Budget.ts, Goal.ts, Recurrence.ts, Control.ts }
├── ledger/     { balances.ts, deltas.ts, reverse.ts, amend.ts, verify.ts, rebuild.ts }
├── ops/        { plan.ts, requests.ts, hash.ts, nearDuplicate.ts }
├── rules/      { guards.ts, status.ts, kindShape.ts, classify.ts }
├── recurrence/ { materialize.ts, nextDate.ts }
├── period/     { periodKey.ts, dateKey.ts }
├── migrate/    { migrate.ts, versions.ts }
└── errors/     { DomainError.ts, messages.ar.ts }

src/data/                         ← **الطبقة الوحيدة التي تلمس Firestore**
├── tx/         { runPlan.ts }
├── ledger/     { postOperation.ts, reconcile.ts, rebuild.ts }
├── outbox/     { queue.ts, flush.ts }
└── repos/      { accountRepo.ts, entryRepo.ts, obligationRepo.ts, debtRepo.ts, metaRepo.ts }

src/ui/                           ← **لا تحسب شيئاً. تنادي execute() وتقرأ selectors**
```

### 21.2 القواعد المفروضة بـ `eslint-plugin-boundaries`

| # | القاعدة | الخرق = |
|---|---|---|
| **B1** | `domain/` لا تستورد من `data/` ولا `ui/` ولا `firebase/*` | **خطأ بناء** |
| **B2** | `ui/` لا تستورد `firebase/firestore` ولا `firebase/app` مباشرة | **خطأ بناء** |
| **B3** | لا استيراد لـ `firebase/firestore` خارج `src/data/**` | **خطأ بناء** |
| **B4** | **`no-raw-money-arithmetic`:** أي `* ` أو `/` على متغير نوعه `Minor` خارج `domain/money/**` | **خطأ بناء** |
| **B5** | **خاص بهذا التصميم:** حرفية `lines:` أو `side:` أو `'debit'` أو `'credit'` خارج `domain/ops/**` و`domain/ledger/**` و`domain/coa/**` | **خطأ بناء** |
| **B6** | `increment()` على `paidMinor` أو `settledMinor` أو `spentMinor` أو `savedMinor` أو `earmarkedMinor` (جدول §5.4) | **خطأ بناء** |
| **B7** | `writeBatch` يمسّ `balanceMinor` أو `paidMinor` أو `settledMinor` أو `spentMinor` خارج `data/ledger/rebuild.ts` | **خطأ بناء** |
| **B8** | `toFixed(` أو `toLocaleString(` داخل `src/ui/**` | **خطأ بناء** |
| **B9** | `Date.now()` أو `crypto.randomUUID()` أو `serverTimestamp()` داخل دالة مُمرَّرة كـ `decide` في `TxPlan` | **خطأ بناء** (قاعدة مخصّصة) |
| **B10** | استخدام `entry.kind` داخل أي دالة في `domain/rules/classify.ts` أو أي محدِّد يحسب رقماً | **خطأ بناء** — التقرير دالّة في نوع الحساب لا في `kind` (R11) |

**B4 و B5 و B10 هي الثلاثة التي تحمي جوهر التصميم**، ويجب أن تُكتب وتُختبر **قبل** كتابة أول عملية
مالية. وتُضاف `tsc --noEmit` و`eslint --max-warnings 0` إلى بوابة ما قبل الدفع (pre-push hook)
وإلى CI.

---

## 22. ما حُسم، وما بقي للمالك

### 22.1 ما حُسم في هذه الوثيقة (كان مفتوحاً)

| السؤال | القرار |
|---|---|
| عدد الخانات في العرض | **3 في التفصيل والجداول والتصدير؛ قابل للضبط (0/2/3) في البطاقات والمخططات**، والتخزين 3 بلا جدال |
| أسلوب الالتزامات (نقدي/استحقاق) | **نقدي، بلا خيار استحقاق** — والمديونية الحقيقية تنتمي إلى `debts`، وأقساط التمويل إلى `nature:'financing'` (ADR-011) |
| بداية الشهر المالي | **الشهر الميلادي في الإصدار الأول** (ADR-008)، والشهر المالي محور تقرير منفصل يُفعَّل لاحقاً بإعادة بناء بلا أي كتابة على قيد |
| المرفقات | **مؤجَّلة (ق-1)**: الحقل في المخطط والواجهة معطَّلة بوسم «يتطلب ترقية»، + حقل ملاحظة نصي مؤقتاً |
| إقفال الفترات | **مُفعَّل في الإصدار الأول** — لأن سياسة تاريخ العكس (§8.3) **لا تصحّ بدونه** |
| أرقام العرض | **لاتينية في كل مكان (ق-3)**، بلا مفتاح تبديل |
| حدّ الرصيد السالب | **`minBalanceMinor` موقَّع**، و`allowNegative` البولياني **محذوف من المخطط** (ADR-010) |
| طابور العمل دون اتصال | **Firestore `pendingCommands` + مرآة محلية** (ADR-007)، مع إعلان حدّ الصدق |
| `postings` المسطَّحة | **من الإصدار الأول** لا كترقية مؤجلة (ADR-002) |
| مستند عدّاد البصمة | **لا يوجد** — التجميع الخادمي عند الطلب (ADR-016) |

### 22.2 ما بقي يحتاج قرار المالك

| # | السؤال | الأثر |
|---|---|---|
| **1** | **UID المالك المعتمد:** يُلتقط عند أول تسجيل دخول ويُثبَّت في `allowedUids()` بالقواعد. **هل يُضاف UID احتياطي من الآن؟** (ق-2 يعترف بخطر فقدان الوصول) | يمسّ `firestore.rules` مباشرة. **لا نشر للقواعد قبل هذا القرار** |
| **2** | **شاشة «دفتر القيود» المتقدمة:** تُعرض للمالك (مفيدة للتدقيق وفحص الاتجاه) أم تُخفى تماماً؟ | شاشة واحدة؛ لا أثر على البيانات |
| **3** | **ADR-022 (قاعدة `getAfter`):** نُجرِّبها في المحاكي ونعتمدها إن نجحت، أم نتركها؟ | طبقة أمان إضافية بتكلفة قراءة لكل كتابة. **القرار بعد الإثبات لا قبله** |
| **4** | **سقف الاستدراك `maxBackfillDays = 120`:** مناسب أم يُغيَّر؟ | يحدد ما يُولَّد تلقائياً بعد غياب طويل |
| **5** | **عتبة تنبيه الميزانية الافتراضية 80%:** مناسبة؟ | قابلة للضبط لكل فئة |
| **6** | **الترقية إلى Blaze:** ما الحدث الذي يُلزمها؟ الموقف المعتمد هنا: **إضافة مستخدم ثانٍ** (§18.4)، لا الأداء ولا التكلفة | يحدد متى يصبح الفرض الخادمي للمقدار متاحاً |

---

## 23. ملخص واجهة النطاق — ما تناديه الواجهة فقط

```ts
// domain/api.ts — السطح الكامل المتاح للواجهة. **لا شيء غيره يكتب مالاً.**
export type OperationRequest =
  | RecordExpenseRequest | RecordIncomeRequest | TransferRequest
  | CreateObligationRequest | PayObligationRequest | CancelObligationRequest
  | CreateDebtRequest | PayDebtRequest | CollectDebtRequest | WriteOffDebtRequest
  | SetOpeningBalanceRequest | AdjustAccountRequest
  | VoidTransactionRequest | EditTransactionRequest
  | EarmarkToGoalRequest | AccrueZakatRequest | PayZakatRequest;

export interface RecordExpenseRequest {
  type: 'recordExpense';
  opId: string;
  amountMinor: Minor;
  bookedAt: DateKey;
  categoryId: string;
  fromAccountId: string;
  description: string;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'wallet' | 'other';
  payeeContactId?: string;
  tags?: string[];                     // 'household' | 'personal' | …
  notes?: string;
  attachmentIds?: string[];
  refs?: Partial<EntryRefs>;
  acknowledgedWarnings?: string[];      // المستخدم أقرّ بتحذير الحجز أو التشابه
}
// … بقية الطلبات بنفس النمط (مبلغ + تاريخ + أطراف + opId)

/** نقطة الدخول الوحيدة. تُغلّف الطابور ثم postOperation. */
export async function execute(req: OperationRequest): Promise<PostResult>;

/** محدِّدات القراءة — **كل رقم مالي في الواجهة يأتي من هنا**. */
export const selectors = {
  availableCashMinor, spendableCashMinor, totalReceivablesMinor, totalPayablesMinor,
  netWorthMinor,
  monthIncomeMinor, monthExpenseMinor, netCashFlowMinor, priorPeriodCorrections,
  expenseByCategory, householdExpenseMinor,
  budgetUtilizationPercent, goalProgressPercent,
  upcomingObligations, overdueObligations, obligationDueMinor,
  payableDebts, receivableDebts,
  accountStatementPage, accountBalanceTrend,
};

/** أدوات السلامة — تُستدعى من شاشة «الإعدادات ← سلامة البيانات». */
export const integrity = {
  auditTrialBalance, reconcileAccount, runReconciliation,
  scanHistoricalNegatives, rebuildProjections, exportAllJson,
};
```

---

## 24. خلاصة العقد

1. **المال** بالدرهم الليبي، عدد صحيح، 3 خانات، ونسب بـ `BigInt` وأساس النقطة. أرقام **لاتينية** دائماً.
2. **كل عملية مالية قيد مزدوج متوازن**، يُكتب مع `postings` المسطَّحة في **معاملة ذرّية واحدة**.
3. **التقرير دالّة في نوع الحساب**، لا في أي حقل وصفي ⇒ لا تضخّم ولا شروط في التقارير.
4. **`entryId === opId` + `payloadHash`** ⇒ منع الازدواج بنيوي، وكشف تعارض المحتوى صريح.
5. **لا حذف مالي ولا تعديل محاسبي.** التصحيح عكس + بديل بقفل ذرّي ودلتا صافية.
6. **المُجمَّعات مشتقة بالكامل وقابلة لإعادة البناء**، وإعادة البناء إجراء كامل ببوابة واستئناف.
7. **24 ثابتاً** قابلاً للاختبار، منها **14 مفروض من الخادم**، ومنها **ثلاثة** تربط المُجمَّعات التشغيلية
   بمصدر مستقل محمي بالتوازن بتكلفة قراءتين.
8. **الحوارس**: حدّ رصيد موقَّع، منع السداد الزائد، منع اليتم، تمييز التحذير من المنع، كاشف تشابه دلالي.
9. **حدود الطبقات مفروضة بأداة البناء** لا بمراجعة الكود.
10. **القصور مُعلَن** في القسم 18: لا حاجز تاريخي، لا رصيد جارٍ، قلب الاتجاه غير مكشوف بنيوياً،
    ولا فرض خادمي للمقدار على Spark — **والترقية إلى Blaze تفعيل ميزة لا إعادة بناء**.

> **أي انحراف عن هذه الوثيقة في الكود = عيب يُصلَح، لا قرار يُناقَش.**
> وأي تغيير فيها يحتاج ADR جديداً وموافقة المالك.
