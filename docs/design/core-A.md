# النواة المحاسبية — المنظور (أ): القيد المزدوج الكامل

> **المسار:** `docs/design/core-A.md`
> **المرجع:** `docs/00-REQUIREMENTS.md` (الأقسام 2، 5–12، 18، 19، 20، 22، 23)
> **الحالة:** تصميم فقط — لا كود تطبيقي، لا مشروع npm، لا لمس Firebase.
> **المنظور المطلوب تقييمه:** دفتر قيد مزدوج كامل (journal entries + lines) على شجرة حسابات.

---

## 0. الحكم المختصر (اقرأ هذا أولاً)

**الخلاصة:** القيد المزدوج الكامل هو الخيار الصحيح لنواة «رصيد»، **لكن ليس بصيغته الدفترية الحرفية**.
الصيغة الموصى بها: **قيد مزدوج صارم في الداخل + واجهة عمليات مُسمّاة في الخارج + مستندات مُجمَّعة مرافقة**
(`double-entry core + named operations API + satellite aggregates`).

| السؤال | الجواب |
|---|---|
| هل القيد المزدوج مبالغ فيه لمستخدم واحد؟ | **لا، لأن سببه ليس المحاسبة بل الثابت الرياضي.** متطلب القسم 18 («دون ازدواج أو فقدان») و19 («حتى لا تتضخم التقارير») لا يمكن فرضهما إلا بثابت واحد قابل للتحقق: `Σ debit = Σ credit`. أي تصميم أحادي الجانب (`transaction.amount` + `accountId`) يحتاج شرطاً خاصاً لكل نوع عملية (تحويل، اقتراض، سداد، تحصيل، تسوية) وهذه الشروط هي بالضبط مصدر «تضخم التقارير». |
| ما المبالغ فيه فعلاً؟ | إدخال **الالتزامات والأهداف والميزانيات** كحسابات في الشجرة بأسلوب الاستحقاق (accrual). هذا يُشوِّه معنى «مصروفات هذا الشهر» لمستخدم شخصي يفكر نقدياً. القرار: الالتزام/الهدف/الميزانية **مستندات تخطيط ومتابعة** لا حسابات، ما لم تكن مديونية حقيقية (وقتها تنتمي إلى `debts` وإلى حساب خصوم حقيقي). |
| ما تكلفته في Firestore؟ | **كتابات المصروف الواحد ترتفع من 4 إلى 7** مقارنة بتصميم أحادي الجانب (التفصيل في القسم 9). على Spark (20,000 كتابة/يوم) يعني هذا سقفاً نظرياً ~2,850 عملية مالية يومياً لمستخدم واحد — أي أن التكلفة الكمّية **غير ذات دلالة**. التكلفة الحقيقية **تعقيد ذهني**، لا فاتورة. |
| لماذا يفشل القيد المزدوج عادة في تطبيقات شخصية؟ | لأن المطوّر يسرّب مفاهيم debit/credit إلى الواجهة. العلاج المعماري الوحيد: **لا مكوّن واجهة يبني `lines` أبداً**. الواجهة تنادي `recordExpense(...)` فقط. |

**نقد صريح لمنظوري** — القسم 14 يعرض العيوب كاملة، بما فيها عيبان تقنيان خطيران غالباً ما يُغفلان:
(1) `runTransaction` **لا يعمل دون اتصال**، وهذا يصطدم بمتطلب PWA في القسم 2/8؛
(2) تضمين `lines` كمصفوفة داخل مستند القيد **يُلغي إمكانية استخدام `sum()` aggregation** من جانب الخادم، لأن استعلامات التجميع في Firestore لا تدخل داخل حقول المصفوفات.

---

## 1. تمثيل المال

### 1.1 الوحدة وعدد الخانات — القرار والتبرير

| البند | القرار |
|---|---|
| العملة الافتراضية | `LYD` (الدينار الليبي) |
| الوحدة الصغرى المعتمدة في التخزين | **الدرهم** (`1 LYD = 1000 درهم`) |
| عدد الخانات العشرية المعتمد (exponent) | **3** |
| نوع التخزين في Firestore | `number` (عدد صحيح موجب أو سالب، لا كسور) |
| نوع TypeScript | `Minor` = `number` موسوم بعلامة (branded type) |

**التبرير (ثلاث حجج، لا تفضيل شخصي):**

1. **قياسي:** ISO 4217 يعطي `LYD` أُسّاً عشرياً = 3. اختيار خانتين يعني كسر المعيار وخسارة بيانات في أسعار حقيقية (0.250 د.ل، 1.750 د.ل شائعة في الوقود والمواد).
2. **رياضي:** أي اختيار أقل من 3 يجعل التحويل من مدخل المستخدم إلى التخزين **عملية فقدان** (lossy)، وهذا يناقض القسم 18 بند 3.
3. **عملي:** المدى الآمن لأعداد JavaScript الصحيحة هو `Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991`. بالدرهم يساوي ذلك **9.007 تريليون دينار**. لا سيناريو شخصي يقاربه، فلا حاجة إلى `string` أو `BigInt` أو `Decimal128`.

**قرار العرض (منفصل تماماً عن التخزين):**

- دفتر الحساب، تفاصيل العملية، كشف الحركة، التقارير الجدولية، التصدير → **3 خانات دائماً** (`25.500 د.ل`).
- بطاقات لوحة التحكم والمخططات → **خانتان** أو **بلا خانات** حسب إعداد `settings.display.amountDecimals: 0 | 2 | 3`، مع عرض القيمة الكاملة في `title`/tooltip.
- **قاعدة إلزامية:** مجموع أي عمود معروض يُحسب على `Minor` ثم يُنسَّق مرة واحدة. **يُحرَّم** جمع قيم منسَّقة أو مُقرَّبة (وإلا ظهر `الإجمالي ≠ مجموع الصفوف` في التقارير — وهو عيب يناقض القسم 23 بند 12).
- دالة التنسيق الوحيدة في النظام: `formatLYD()` في طبقة النطاق. لا `toFixed()` في أي مكوّن.

### 1.2 الإدخال والتقريب

```ts
// domain/money/Minor.ts
declare const MINOR_BRAND: unique symbol;
/** مبلغ بالوحدة الصغرى (درهم ليبي). عدد صحيح. قد يكون سالباً في نتائج الحساب فقط، لا في سطور القيد. */
export type Minor = number & { readonly [MINOR_BRAND]: 'LYD' };

export const MINOR_PER_UNIT = 1000 as const;   // درهم في الدينار
export const DISPLAY_DECIMALS = 3 as const;

export type ParseResult =
  | { ok: true; value: Minor }
  | { ok: false; code: 'EMPTY' | 'NOT_A_NUMBER' | 'TOO_MANY_DECIMALS' | 'OUT_OF_RANGE' | 'NEGATIVE' };

/**
 * يحوّل مدخل المستخدم النصي إلى Minor دون أي حساب عشري عائم.
 * يقبل: "25.5" | "25.500" | "٢٥٫٥" | "25,500" (فاصلة عشرية عربية/أوروبية) | "1 234.750".
 * يرفض: أكثر من 3 خانات عشرية  ← رفض صريح برسالة عربية، لا تقريب صامت.
 */
export function parseAmountToMinor(input: string): ParseResult;

/** للعرض فقط. يُحرَّم استخدام ناتجها في أي حساب. */
export function minorToDisplayNumber(m: Minor): number;

export function formatLYD(
  m: Minor,
  opts?: { decimals?: 0 | 2 | 3; withCurrency?: boolean; signDisplay?: 'auto' | 'always' | 'never' }
): string;   // "25.500 د.ل" — أرقام هندية-عربية حسب الإعداد، باتجاه RTL آمن (U+061C)
```

**سبب رفض التقريب الصامت عند الإدخال:** القسم 25 بند 15 يمنع إخفاء المشكلات. مستخدم يكتب `25.5055` يجب أن يرى
«الحد الأقصى ثلاث خانات عشرية (الدرهم)» لا أن يُحوَّل مبلغه خلسة.

### 1.3 الحساب الآمن

```ts
// domain/money/arithmetic.ts
export function addMinor(...xs: Minor[]): Minor;        // مع فحص تجاوز MAX_SAFE_INTEGER
export function subMinor(a: Minor, b: Minor): Minor;
export function negateMinor(a: Minor): Minor;
export function sumMinor(xs: readonly Minor[]): Minor;
export function compareMinor(a: Minor, b: Minor): -1 | 0 | 1;
export function isZero(a: Minor): boolean;
export function clampAtZero(a: Minor): Minor;

/**
 * ضرب في نسبة كسرية مع تقريب صريح واحد.
 * مثال: ضريبة 2.5% على 25.500 → applyRatio(25500, 25, 1000) = 638 (تقريب نصف لأعلى بعيداً عن الصفر)
 * يُحرَّم: Math.round(minor * 0.025)  ← يمر عبر عدد عشري عائم.
 */
export function applyRatio(
  m: Minor,
  numerator: number,       // صحيح
  denominator: number,     // صحيح > 0
  rounding?: 'halfUp' | 'halfEven' | 'floor' | 'ceil'
): Minor;

export function percentOf(part: Minor, whole: Minor): number;   // للعرض/المؤشرات فقط (0..100، عائم مسموح)
```

### 1.4 القسمة والتوزيع دون ضياع وحدات (توزيع الأقساط)

هذه هي المشكلة الحقيقية الوحيدة في حساب المال الصحيح. **القاعدة الحاكمة: مجموع الأجزاء = الكل، بلا استثناء.**
الخوارزمية المعتمدة: **أكبر الباقي (largest remainder)** مع توزيع حتمي (deterministic) للباقي.

```ts
// domain/money/allocate.ts

/**
 * يقسّم مبلغاً على n أجزاء متساوية قدر الإمكان.
 * الثابت المضمون: sumMinor(result) === total  &&  result.length === n
 * توزيع الباقي: على الأجزاء الأولى (first-n) افتراضياً — حتمي وقابل للاختبار.
 *
 * allocate(1000, 3)  → [334, 333, 333]        (مجموعها 1000 بالضبط)
 * allocate(800000, 7)→ [114286, 114286, 114286, 114286, 114286, 114285, 114285]
 * allocate(-1000, 3) → [-334, -333, -333]     (الباقي يتبع الإشارة)
 */
export function allocate(
  total: Minor,
  n: number,
  remainderTo?: 'first' | 'last'
): Minor[];

/**
 * توزيع بأوزان صحيحة (مثال: توزيع فاتورة مشتركة بالنسب 2:1:1).
 * الثابت: sumMinor(result) === total
 */
export function allocateByWeights(total: Minor, weights: readonly number[]): Minor[];

/**
 * جدول أقساط: مبلغ إجمالي على n دفعات بتواريخ.
 * الباقي يُحمَّل على **القسط الأول** لا الأخير — قرار مقصود:
 * المستخدم يرى القسط الأخير «مبلغ التسوية» أمراً مربكاً، والأول مقبول عرفاً.
 * ويُحرَّم إعادة حساب القسط الأخير من الطرح وقت السداد (مصدر شائع لفروق الوحدة).
 */
export interface InstallmentPlanInput {
  totalMinor: Minor;
  count: number;
  firstDueDate: string;              // 'YYYY-MM-DD'
  frequency: 'monthly' | 'weekly' | 'biweekly' | 'quarterly' | 'yearly';
  dayOfMonthPolicy?: 'clampToEndOfMonth' | 'exact';   // 31 يناير → 28/29 فبراير
}
export interface Installment {
  index: number;                     // 1-based
  dueDate: string;
  amountMinor: Minor;
  paidMinor: Minor;                  // يبدأ 0
  status: 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';
}
export function buildInstallmentPlan(input: InstallmentPlanInput): Installment[];
```

**اختبارات إلزامية على التوزيع (القسم 23 بند 1):**

| الحالة | المتوقع |
|---|---|
| `allocate(1000, 3)` | `[334,333,333]`، المجموع 1000 |
| `allocate(1, 3)` | `[1,0,0]`، المجموع 1 — **لا أصفار ثلاثة** |
| `allocate(0, 5)` | خمسة أصفار |
| `allocate(100, 1)` | `[100]` |
| `allocate(x, n)` لكل `x ∈ [0..5000]`, `n ∈ [1..24]` | **property test:** المجموع = `x` دائماً، والفرق بين أكبر وأصغر جزء ≤ 1 |
| `buildInstallmentPlan(800000, 7, …)` | مجموع الأقساط = 800000، والقسط الأول يحمل الباقي |
| `allocateByWeights(1000, [2,1,1])` | `[500,250,250]` |
| `allocateByWeights(10, [1,1,1])` | `[4,3,3]` |

**ثابت يُفرَض في وقت التشغيل** داخل الدوال نفسها (`invariant()` يرمي استثناءً لا يُصطاد إلى الواجهة
بل يُسجَّل كخطأ نظام): أي انحراف في المجموع يعني عيباً برمجياً لا خطأ مستخدم.

---

## 2. شجرة الحسابات (Chart of Accounts)

### 2.1 الأنواع الخمسة وقاعدة الإشارة

| النوع `type` | الجانب الطبيعي `normalSide` | يزيد بـ | أمثلة في «رصيد» |
|---|---|---|---|
| `asset` (أصول) | `debit` | مدين | النقد، الحساب المصرفي، المحفظة الإلكترونية، **المستحق لي** |
| `liability` (خصوم) | `credit` | دائن | **الديون عليّ** لكل دائن، الزكاة المستحقة، التزام بأسلوب الاستحقاق |
| `income` (دخل) | `credit` | دائن | الراتب، المكافآت، الأعمال الإضافية، الإيرادات الاستثمارية |
| `expense` (مصروف) | `debit` | مدين | حساب لكل فئة/فئة فرعية من فئات القسم 6 |
| `equity` (حقوق) | `credit` | دائن | الرصيد الافتتاحي، التسويات، التخصيصات (earmarks) |

```ts
export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';
export type Side = 'debit' | 'credit';

/** إشارة أثر السطر على رصيد الحساب في اتجاهه الطبيعي. */
export function normalSideOf(type: AccountType): Side {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

/** +1 إذا كان السطر يزيد الرصيد الطبيعي، -1 إذا ينقصه. دالة نقية واحدة في النظام كله. */
export function lineSign(type: AccountType, side: Side): 1 | -1 {
  return side === normalSideOf(type) ? 1 : -1;
}
```

### 2.2 الشجرة الافتراضية المُهيَّأة عند أول تسجيل دخول (seed)

لا يراها المستخدم بهذا الشكل؛ يراها مقسّمة على شاشات (الحسابات / الفئات / مصادر الدخل / الديون).

```
asset                                 [فرع، غير قابل للترحيل]
├─ asset.cash                         النقد
│  └─ asset.cash.{accountId}          «نقد شخصي»            isCashLike=true
├─ asset.bank                         الحسابات المصرفية
│  └─ asset.bank.{accountId}          «مصرف الجمهورية»       isCashLike=true
├─ asset.ewallet                      المحافظ الإلكترونية
│  └─ asset.ewallet.{accountId}       «سداد / موبي كاش»      isCashLike=true
└─ asset.receivable                   المستحق لي (ديون للتحصيل)
   └─ asset.receivable.{contactId}    «أحمد»                 isCashLike=false   ← القاعدة 19.9

liability
├─ liability.payable                  الديون عليّ
│  └─ liability.payable.{contactId}   «شركة س / والدي»
├─ liability.obligation               التزامات بأسلوب الاستحقاق (اختياري، لكل التزام مُفعَّل)
│  └─ liability.obligation.{obligationId}
└─ liability.zakat                    الزكاة المستحقة غير المدفوعة (القسم 15.4)

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
├─ expense.home           مصاريف المنزل      (وما تحتها فئات فرعية)
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
└─ expense.{customId}     فئات مخصصة

equity
├─ equity.opening         الأرصدة الافتتاحية          ← الطرف المقابل لكل رصيد ابتدائي
├─ equity.adjustment      تسويات الجرد/الفروق          ← القسم 5 «تسوية واضحة ومبررة»
├─ equity.unallocated     غير مخصص (الطرف المقابل للتخصيصات)
└─ equity.earmark
   └─ equity.earmark.goal.{goalId}   مخصص لهدف مالي (القسم 12)
```

**قرار مهم: الفئات ليست هي الحسابات، لكن لكل فئة حساب.**
`categories/{categoryId}` يبقى مستند الفئة الذي يراه المستخدم (اسم، أيقونة، لون، تعطيل، ترتيب)،
وله حقل `expenseAccountId` يشير إلى حساب مصروف يُنشأ تلقائياً عند إنشاء الفئة ولا يُحذف أبداً.
**السبب:** القسم 6 يطلب «تعطيل الفئات دون الإضرار بالسجلات التاريخية»؛ تعطيل الفئة = `status:'archived'`
على مستند الفئة وعلى الحساب، والقيود التاريخية تبقى سليمة لأنها تشير إلى `accountId` لا إلى اسم.

**«مصاريف المنزل» (القسم 11) — كيف نمنع الازدواج:**
الطبيعة المنزلية **وسم على القيد** (`tags: ['household']`) + فئات فرعية تحت `expense.home`،
وليست شجرة موازية ولا قيداً ثانياً. شاشة المنزل = **استعلام مُصفّى على نفس القيود**.
لهذا تظهر قيمتها في التقرير العام مرة واحدة فقط (مطلب القسم 11 الصريح).

### 2.3 `Account` — الواجهة الفعلية

المسار: `users/{uid}/accounts/{accountId}`

```ts
export interface Account {
  id: string;                     // = معرف المستند
  schemaVersion: number;          // 1
  ownerUid: string;               // تكرار مقصود لتدقيق القواعد وتصدير البيانات
  code: string;                   // 'asset.cash.main' — فريد، ثابت، لا يُترجم
  name: string;                   // عربي، قابل للتعديل: «نقد المحفظة»
  nameLower: string;              // للبحث
  type: AccountType;
  subtype:
    | 'cash' | 'bank' | 'ewallet' | 'other'            // asset سائل
    | 'receivable'                                      // asset غير سائل
    | 'payable' | 'obligationLiability' | 'zakatDue'    // liability
    | 'incomeSource'                                    // income
    | 'expenseCategory'                                 // expense
    | 'opening' | 'adjustment' | 'earmark' | 'unallocated'; // equity
  parentId: string | null;
  ancestorIds: string[];          // مسار الأسلاف — لتجميع الفروع باستعلام array-contains واحد
  depth: number;

  // سلوك محاسبي
  normalSide: Side;               // مشتق من type، مخزَّن لتسهيل القواعد والتدقيق
  isPostable: boolean;            // الترحيل على الأوراق فقط؛ الفروع للتجميع فقط
  isCashLike: boolean;            // يدخل في «النقد المتاح» — القاعدة 19.9
  allowNegative: boolean;         // false للنقد والمصرف؛ true للمحافظ ذات السحب أو عند تفعيل صريح
  currency: 'LYD';                // محجوز للتوسعة؛ لا تعدد عملات في الإصدار الأول

  // أرصدة مُجمَّعة (تُحدَّث داخل نفس المعاملة — القسم 3)
  openingBalanceMinor: number;    // الرصيد الافتتاحي كما رُحِّل عبر قيد افتتاحي
  debitTotalMinor: number;        // مجموع السطور المدينة مدى الحياة
  creditTotalMinor: number;       // مجموع السطور الدائنة مدى الحياة
  balanceMinor: number;           // = lineSign المطبّق: المشتق المخزَّن (القسم 3.2)
  entryCount: number;             // عدد القيود المؤثرة — لكشف الانحراف
  balanceVersion: number;         // يزيد 1 مع كل تحديث — لكشف التحديثات المفقودة
  lastEntryId: string | null;
  lastPostedAt: Timestamp | null;

  // روابط
  linkedContactId?: string;       // receivable / payable
  linkedCategoryId?: string;      // expenseCategory
  linkedObligationId?: string;    // obligationLiability
  linkedGoalId?: string;          // earmark
  linkedIncomeSourceId?: string;

  // عرض وإدارة
  status: 'active' | 'archived';
  sortOrder: number;
  icon?: string;
  colorToken?: string;
  isSystem: boolean;              // حسابات النظام (equity.opening…) لا تُحذف ولا يُعاد تسميتها بحرية
  notes?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**لماذا تخزين `debitTotalMinor` و `creditTotalMinor` معاً وليس `balanceMinor` فقط؟**
1. يعطي **ميزان المراجعة** (trial balance) بقراءة الحسابات وحدها: `Σ debitTotal` يجب أن يساوي `Σ creditTotal`
   على كل الشجرة. فحص صحة شامل بقراءة ~40–80 مستنداً دون لمس القيود (القسم 23 بند 12).
2. يعطي «حركة الحساب» الإجمالية (مدين/دائن) في التقارير دون مسح القيود.
3. يجعل عكس القيد عملية جمع لا طرح شرطي: العكس يزيد الجانب المقابل، فيبقى التاريخ ظاهراً في الإجماليات.

### 2.4 `JournalEntry` و `JournalLine` — الواجهة الفعلية

المسار: `users/{uid}/journalEntries/{entryId}` — **السطور مُضمَّنة في المستند**، لا مجموعة فرعية.

```ts
export type EntryKind =
  | 'expense'            // مصروف حقيقي
  | 'income'             // دخل حقيقي مستلم
  | 'transfer'           // تحويل بين حسابين (ليس دخلاً ولا مصروفاً) — القاعدة 19.3
  | 'borrow'             // استلام قرض: نقد ↑ وخصوم ↑ (ليس دخلاً) — القاعدة 19.6
  | 'debtRepayment'      // سداد دين عليّ: خصوم ↓ ونقد ↓ (ليس مصروفاً) — القاعدة 19.8
  | 'lend'               // إقراض: مستحق لي ↑ ونقد ↓ (ليس مصروفاً)
  | 'debtCollection'     // تحصيل: نقد ↑ ومستحق لي ↓ (ليس دخلاً) — القاعدة 19.7
  | 'obligationPayment'  // دفع التزام — القاعدة 19.5
  | 'opening'            // رصيد افتتاحي
  | 'adjustment'         // تسوية مبرَّرة — القسم 5
  | 'earmark'            // تخصيص لهدف (داخل حقوق الملكية، لا يمس النقد)
  | 'zakatAccrual'       // احتساب زكاة مستحقة دون دفع — القسم 15.4
  | 'reversal';          // عكس قيد سابق

export type EntryStatus = 'posted' | 'reversed' | 'replaced';

export interface JournalLine {
  lineNo: number;                 // 1-based، ثابت
  accountId: string;
  accountType: AccountType;       // مكرَّر عن قصد: يتيح تصنيف دخل/مصروف دون قراءة الحسابات
  accountCode: string;            // مكرَّر للعرض والتصدير دون انضمام
  side: Side;                     // 'debit' | 'credit'
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
  budgetId?: string;
  recurringId?: string;
  recurringOccurrenceKey?: string;   // 'YYYY-MM-DD'
  incomeScheduleId?: string;
  transferPairKey?: string;
  zakatRecordId?: string;
  taskId?: string;
  noteId?: string;
}

export interface JournalEntry {
  id: string;                     // = opId، أو `${opId}__${k}` للعمليات متعددة القيود
  schemaVersion: number;
  ownerUid: string;
  opId: string;                   // مفتاح منع الازدواج — القسم 4
  payloadHash: string;            // SHA-256 لحمولة الطلب المُقنَّنة — كشف تعارض نفس opId بحمولة مختلفة
  kind: EntryKind;
  status: EntryStatus;

  bookedAt: string;               // 'YYYY-MM-DD' — **التاريخ المحاسبي** بتوقيت المستخدم المحلي
  bookedAtTs: Timestamp;          // منتصف نهار UTC لذلك اليوم — للترتيب والنطاقات فقط
  periodKey: string;              // 'YYYY-MM' محسوب وفق settings.fiscalMonthStartDay (القسم 21)
  valueDate?: string;             // تاريخ القيمة المصرفي إن اختلف

  description: string;            // عربي، إلزامي غير فارغ
  lines: JournalLine[];           // طولها ≥ 2
  accountIds: string[];           // مشتق من lines — للاستعلام array-contains
  accountTypes: AccountType[];    // مشتق، مميَّز — لتصفية التقارير
  totalDebitMinor: number;        // = totalCreditMinor دائماً
  totalCreditMinor: number;
  amountMinor: number;            // «قيمة العملية» للعرض = totalDebitMinor (راحة للواجهة)
  currency: 'LYD';

  tags: string[];                 // 'household' | 'personal' | وسوم المستخدم
  refs: EntryRefs;
  attachmentIds?: string[];

  // سلسلة التصحيح — القسم 6
  reversesEntryId?: string;
  reversedByEntryId?: string;
  replacedByEntryId?: string;
  replacesEntryId?: string;
  correctionGroupId?: string;
  correctionReason?: string;      // إلزامي عند العكس أو التعديل

  createdAt: Timestamp;           // serverTimestamp()
  createdBy: string;              // uid
  deviceId?: string;              // لتشخيص تزامن الأجهزة
  clientCreatedAt: string;        // ISO من الجهاز — للتدقيق لا للترتيب
  updatedAt: Timestamp;           // يتغير فقط عند وسم العكس/الاستبدال
}
```

**لماذا السطور مُضمَّنة (embedded) لا مجموعة فرعية (`journalEntries/{id}/lines/{lineId}`)؟**

| المعيار | مُضمَّنة (المختار) | مجموعة فرعية |
|---|---|---|
| ذرّية القيد | **مضمونة بالبنية**: القيد يُكتب أو لا يُكتب | تحتاج معاملة ونجاح N كتابات |
| كتابات المصروف البسيط | 1 | 3 (قيد + سطران) |
| «القيد اليتيم» (سطر بلا قيد أو قيد بلا سطور) | **مستحيل بنيوياً** | ممكن عند فشل جزئي |
| كشف حركة حساب | استعلام واحد `accountIds array-contains` + تصفية السطور في العميل | استعلام مجموعة فرعية (`collectionGroup`) أنظف |
| `sum()` aggregation من الخادم | **غير ممكن** (لا يدخل داخل المصفوفات) ← عيب حقيقي | ممكن ورخيص |
| سقف الحجم | 1 ميغابايت للمستند ⇒ عملياً ~2000 سطر/قيد | لا سقف |

**القرار ومبرره:** التضمين، لأن المخاطر التي تخشاها الوثيقة (ازدواج/فقدان/قيد غير مكتمل — القسم 18 و19)
تُقتل بنيوياً بالتضمين، أما خسارة `sum()` فتُعالَج بمستندات التجميع في القسم 3.4.
**التبعية المقبولة:** كل تقرير يحتاج مجموعاً على بُعد غير مُجمَّع مسبقاً يقرأ القيود ويجمع في العميل.
**إن تجاوز الاستخدام ~20,000 قيد/سنة** (غير واقعي لمستخدم واحد: يعني 55 عملية يومياً) فالترقية هي
إضافة مجموعة `postings` مسطَّحة تُكتب في نفس المعاملة (+2 كتابات/مصروف) للاستفادة من `sum()`.

### 2.5 المستندات المرافقة (satellites) التي تمسّها النواة

هذه ليست حسابات في الشجرة، بل مستندات حالة تُحدَّث **داخل نفس معاملة القيد**.
تُعرض هنا الحقول التي تمسّها النواة المحاسبية فقط (بقية الحقول في تصميم الوحدات).

```ts
// users/{uid}/obligations/{obligationId}            — القسم 8
export interface Obligation {
  id: string; schemaVersion: number; ownerUid: string;
  name: string;                       // «إيجار المنزل»
  payeeContactId?: string;
  categoryId: string;                 // ← يحدد حساب المصروف عند الدفع
  accounting: 'cash' | 'accrual';     // الافتراضي 'cash' (انظر 7.R4)
  liabilityAccountId?: string;        // يُنشأ فقط عند accounting:'accrual'

  totalMinor: number;                 // القيمة الإجمالية
  isVariableAmount: boolean;          // فواتير متغيرة (كهرباء) — تسمح بتجاوز التقدير بإقرار صريح
  paidMinor: number;                  // ← تُحدَّث في المعاملة
  remainingMinor: number;             // = totalMinor - paidMinor (مشتق مخزَّن، يُعاد حسابه دائماً من الطرفين)
  paymentCount: number;
  lastPaymentEntryId: string | null;

  dueDate: string;                    // 'YYYY-MM-DD'
  recurrence: Recurrence | null;
  installments?: Installment[];       // عند الأقساط
  priority: 1 | 2 | 3;
  status: 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';
  statusComputedFor: string;          // تاريخ حساب الحالة — الحالة مشتقة من التاريخ + المسدد
  createdAt: Timestamp; updatedAt: Timestamp;
}

// users/{uid}/debts/{debtId}                        — القسمان 9 و10 في مجموعة واحدة
export interface Debt {
  id: string; schemaVersion: number; ownerUid: string;
  direction: 'payable' | 'receivable';   // payable = عليّ (القسم 9) | receivable = لي (القسم 10)
  counterpartyContactId: string;
  counterpartyName: string;              // لقطة للعرض والتصدير
  accountId: string;                     // حساب الخصم/المستحق المقابل في الشجرة (1:1 مع الدين)
  principalMinor: number;                // قيمة الدين الأصلية
  settledMinor: number;                  // المسدَّد (payable) أو المحصَّل (receivable) ← تُحدَّث في المعاملة
  remainingMinor: number;                // مشتق مخزَّن
  originatedAt: string; expectedSettleAt?: string;
  createdCash: boolean;                  // هل نشأ بحركة نقدية فعلية؟ (يحدد شكل قيد النشوء)
  installments?: Installment[];
  settlementCount: number;
  lastSettlementEntryId: string | null;
  status: 'open' | 'partiallySettled' | 'settled' | 'writtenOff' | 'cancelled';
  allowOverSettle: false;                // ثابت: ممنوع السداد/التحصيل الزائد — القسم 19
  createdAt: Timestamp; updatedAt: Timestamp;
}

// users/{uid}/budgetPeriods/{periodKey}             — القسم 12
export interface BudgetPeriod {
  id: string;                            // = 'YYYY-MM'
  schemaVersion: number; ownerUid: string;
  periodKey: string;
  overallLimitMinor: number | null;
  overallSpentMinor: number;             // ← تُحدَّث في المعاملة
  categories: Record<string, {           // مفتاحها categoryId
    limitMinor: number;
    spentMinor: number;                  // ← تُحدَّث في المعاملة
    alertAtPercent: number;              // 80 افتراضياً
    alertFiredAtPercent?: number;        // لمنع تكرار التنبيه — القسم 17
  }>;
  isLocked: boolean;                     // إقفال الفترة — يمنع الترحيل بتاريخ داخلها
  updatedAt: Timestamp;
}

// users/{uid}/financialGoals/{goalId}               — القسم 12
export interface FinancialGoal {
  id: string; schemaVersion: number; ownerUid: string;
  name: string; targetMinor: number;
  mode: 'backedAccount' | 'virtualEarmark';
  backingAccountId?: string;             // mode='backedAccount': التقدم = رصيد هذا الحساب
  earmarkAccountId?: string;             // mode='virtualEarmark': التقدم = رصيد equity.earmark.goal.{id}
  savedMinor: number;                    // مشتق مخزَّن ← يُحدَّث في المعاملة
  targetDate?: string;
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
  createdAt: Timestamp; updatedAt: Timestamp;
}
```

**الهدف المالي — القرار:** وضعان، لأن للمستخدم نيتين مختلفتين:
- `backedAccount`: مال محوَّل فعلاً إلى حساب توفير. التقدم = رصيد الحساب. **لا قيد خاص**؛ التحويل العادي يكفي.
- `virtualEarmark`: «تخصيص دفتري» دون نقل نقد. القيد: `Dr equity.unallocated / Cr equity.earmark.goal.{id}`.
  **لا يمس الأصول ولا الخصوم**، فإجمالي الأموال المتاحة لا يتغير — وهذا صحيح محاسبياً وصادق مع المستخدم.
  تنبيه واجهة إلزامي: «مخصص دفترياً، والمال لا يزال في حسابك».

---

## 3. حساب الأرصدة: ماذا يُخزَّن، ومتى، ومن أين تقرأ الواجهة

### 3.1 القرار

**مُجمَّع مخزَّن (stored aggregate) يُحدَّث داخل نفس معاملة ترحيل القيد** — لا حساب عند القراءة.
وبجانبه **لقطات شهرية** (`accountPeriods`) و**مُجمَّع شهري عام** (`periods`) ومسار إصلاح (`recompute`).

### 3.2 الصيغة الدقيقة

```ts
// domain/ledger/balances.ts

/** رصيد الحساب في اتجاهه الطبيعي. */
export function accountBalanceMinor(a: Pick<Account,'type'|'debitTotalMinor'|'creditTotalMinor'>): Minor {
  const raw = a.debitTotalMinor - a.creditTotalMinor;          // صحيح × صحيح → صحيح
  return (normalSideOf(a.type) === 'debit' ? raw : -raw) as Minor;
}

/** أثر قيد واحد على حساب واحد. تُستدعى داخل المعاملة فقط. */
export interface AccountDelta { debitMinor: Minor; creditMinor: Minor; }
export function deltaForAccount(entry: JournalEntry, accountId: string): AccountDelta;

/** الرصيد الافتتاحي يُرحَّل كقيد `opening` مقابل equity.opening — لا يُكتب في الحساب يدوياً. */
export function buildOpeningEntry(input: {
  opId: string; accountId: string; amountMinor: Minor; bookedAt: string;
}): JournalEntry;
```

**الثوابت القابلة للفحص (invariants):**

| # | الثابت | أين يُفحَص |
|---|---|---|
| I1 | `entry.totalDebitMinor === entry.totalCreditMinor` | طبقة النطاق + Firestore Rules |
| I2 | `lines.length >= 2` وكل `amountMinor > 0` صحيح | طبقة النطاق + Rules |
| I3 | `account.balanceMinor === accountBalanceMinor(account)` | فاحص الاتساق (3.5) |
| I4 | `Σ debitTotalMinor = Σ creditTotalMinor` على كل الحسابات (ميزان المراجعة) | فاحص الاتساق |
| I5 | `obligation.remainingMinor === totalMinor - paidMinor` و `paidMinor ≤ totalMinor` | المعاملة + الفاحص |
| I6 | `debt.remainingMinor === principalMinor - settledMinor` و `settledMinor ≤ principalMinor` | المعاملة + الفاحص |
| I7 | `account.debitTotalMinor` = مجموع السطور المدينة في القيود `posted` لذلك الحساب | الفاحص (مكلف، شهري) |

### 3.3 لماذا لا نحسب عند القراءة؟

| السبب | التفصيل |
|---|---|
| التكلفة | الرصيد المحسوب يعني قراءة كل قيود الحساب. بعد سنتين (~3000 قيد) = 3000 قراءة لفتح لوحة التحكم مرة واحدة. على Spark (50,000 قراءة/يوم) = 16 فتحة فقط يومياً. **غير مقبول.** |
| القدرة التقنية | `sum()` في Firestore **لا يستطيع** الجمع داخل حقول المصفوفات، وسطورنا مصفوفة (2.4). فلا بديل خادمي. |
| الزمن | القسم 4 يطلب «ملخص حي ومباشر». 6–10 مستندات حسابات عبر `onSnapshot` = مللي ثوانٍ. |
| الاتساق | المُجمَّع يُحدَّث ذرّياً مع القيد، فلا نافذة يرى فيها المستخدم قيداً دون أثره. |

**الثمن المقبول:** احتمال **الانحراف** (drift) إن أُضيف قيد خارج المسار الواحد. العلاج في 3.5،
والدفاع الأساسي: **لا مسار كتابة واحد للقيود غير `postOperation()`**، ومفروض بقواعد الأمان (القسم 12).

### 3.4 التجميعات الزمنية

```ts
// users/{uid}/accountPeriods/{accountId}__{periodKey}
export interface AccountPeriod {
  id: string; schemaVersion: number; ownerUid: string;
  accountId: string; accountType: AccountType; periodKey: string;   // 'YYYY-MM'
  openingBalanceMinor: number;      // رصيد بداية الفترة (لقطة، تُكتب مرة عند أول قيد في الفترة)
  debitMinor: number;               // حركة الفترة
  creditMinor: number;
  closingBalanceMinor: number;      // openingBalance ± حركة الفترة
  entryCount: number;
  updatedAt: Timestamp;
}

// users/{uid}/periods/{periodKey}  — المُجمَّع الذي تقرأه لوحة التحكم والتقرير الشهري
export interface PeriodSummary {
  id: string;                       // 'YYYY-MM'
  schemaVersion: number; ownerUid: string;
  periodKey: string;
  totalIncomeMinor: number;         // من سطور حسابات income فقط
  totalExpenseMinor: number;        // من سطور حسابات expense فقط
  netCashFlowMinor: number;         // = income - expense (مشتق مخزَّن)
  expenseByCategory: Record<string, number>;   // categoryId → Minor
  incomeBySource: Record<string, number>;
  householdExpenseMinor: number;    // القيود الموسومة household — **ليست إضافة، بل مجموع فرعي**
  transferVolumeMinor: number;      // حجم التحويلات (للرقابة، لا يدخل الدخل/المصروف)
  borrowedMinor: number; repaidMinor: number;
  lentMinor: number; collectedMinor: number;
  obligationPaidMinor: number;
  entryCount: number;
  firstEntryAt: string; lastEntryAt: string;
  updatedAt: Timestamp;
}
```

**ملاحظة ازدحام (contention):** مستند `periods/{YYYY-MM}` يتلقى كتابة مع كل حدث مالي، وسقف Firestore
هو ~**كتابة واحدة في الثانية** للمستند الواحد بشكل مستدام. مستخدم واحد لن يقاربه، **لكن الاستيراد الجَمْعي
سيصطدم به** — ولهذا مسار الاستيراد يستخدم `writeBatch` ثم تمريرة تجميع واحدة (القسم 5.4).

### 3.5 مسار الإصلاح وكشف الانحراف

```ts
// domain/ledger/reconcile.ts
export interface AccountDrift {
  accountId: string;
  storedDebit: Minor; computedDebit: Minor;
  storedCredit: Minor; computedCredit: Minor;
  storedBalance: Minor; computedBalance: Minor;
  storedEntryCount: number; computedEntryCount: number;
}

/** لا يكتب شيئاً. يقرأ القيود المرحَّلة لحساب ويقارنها بالمُجمَّع. */
export function auditAccount(accountId: string, entries: JournalEntry[]): AccountDrift;

/** فحص رخيص: يقرأ الحسابات وحدها ويتحقق من I3 و I4. ~40–80 قراءة. */
export function auditTrialBalance(accounts: Account[]):
  { balanced: boolean; debitTotal: Minor; creditTotal: Minor; offenders: AccountDrift[] };

/** إصلاح: يعيد بناء المُجمَّع من القيود. يسجّل في auditLogs ويحتاج تأكيد المستخدم. */
export function planAccountRepair(drift: AccountDrift): RepairPlan;
```

**متى يُشغَّل؟** على Spark لا توجد وظائف مجدولة، فالفاحص يعمل **في العميل**:
- `auditTrialBalance` عند كل تسجيل دخول (رخيص) ← إن اختلّ، شريط تحذير أحمر وتعطيل الترحيل حتى الإصلاح.
- `auditAccount` الكامل عند فتح كشف الحساب لأول مرة في الشهر، أو بطلب المستخدم من «الإعدادات ← سلامة البيانات».

### 3.6 من أين تقرأ الواجهة بالضبط (لا شاشة بلا مصدر — القسم 25 بند 5)

| ما يُعرض | المصدر | عدد القراءات |
|---|---|---|
| رصيد كل حساب | `accounts` عبر `onSnapshot` على المجموعة كاملة | N مستند مرة واحدة ثم تحديثات دلتا |
| «إجمالي الأموال المتاحة» | محدِّد في طبقة النطاق: `sumMinor(accounts.filter(isCashLike && active).map(balanceMinor))` | 0 إضافية |
| «إجمالي المستحق لي» | نفس اللقطة: مجموع `asset.receivable.*` | 0 |
| «إجمالي الديون عليّ» | نفس اللقطة: مجموع `liability.payable.*` | 0 |
| دخل/مصروف الشهر، المصروف حسب الفئة | `periods/{currentPeriodKey}` | 1 |
| نسبة استهلاك الميزانية | `budgetPeriods/{currentPeriodKey}` | 1 |
| الالتزامات القادمة/المتأخرة | استعلام `obligations` مرتب بـ `dueDate` بحد 10 | ≤10 |
| كشف حركة حساب | `journalEntries where accountIds array-contains {id} order by bookedAtTs desc limit 25` | 25 لكل صفحة |
| اتجاه الإنفاق عبر الأشهر | `periods` لآخر 12 شهراً | ≤12 |
| تقرير سنوي | `periods` ×12 للإجماليات، والتفصيل بالتنقّل | 12 + حسب الطلب |

**قاعدة صارمة:** كل عدد مالي في الواجهة يأتي من **محدِّد (selector) في طبقة النطاق** يستقبل اللقطات ويعيد
`Minor`. **لا مكوّن يجمع أو يطرح مبالغ.** هذا تطبيق القسم 25 بند 7 («عدم تكرار منطق الحسابات»).

---

## 4. منع الازدواج (Idempotency)

### 4.1 المبدأ

> **معرّف العملية (`opId`) يُولَّد عند تكوين النيّة، لا عند تنفيذها، ويصبح معرّف مستند القيد.**

لأن `entryId === opId`، فإن «الكتابة مرتين» تصبح **كتابة على نفس المستند**، والمعاملة ترفضها بقراءة مسبقة.
هذا يحوّل منع الازدواج من منطق تطبيقي قابل للخطأ إلى **خصيصة بنيوية في مفتاح المستند**.

### 4.2 توليد `opId` — القواعد لكل مصدر

| المصدر | طريقة التوليد | النوع |
|---|---|---|
| نموذج يدوي (مصروف/دخل/تحويل) | `crypto.randomUUID()` **عند تركيب النموذج** (mount)، يُخزَّن في حالة النموذج ويُعاد توليده فقط بعد نجاح مؤكَّد أو عند «إضافة عملية جديدة» | عشوائي، ثابت لمدة حياة النموذج |
| دفع التزام | `crypto.randomUUID()` عند فتح نافذة الدفع | عشوائي |
| مصروف متكرر | `` `rec:${recurringId}:${occurrenceKey}` `` حيث `occurrenceKey = 'YYYY-MM-DD'` لتاريخ الاستحقاق | **حتمي** |
| دخل متكرر/متوقع عند تأكيد الاستلام | `` `inc:${incomeScheduleId}:${occurrenceKey}` `` | **حتمي** |
| قسط من جدول أقساط | `` `inst:${obligationId}:${installmentIndex}` `` | **حتمي** |
| استيراد ملف | `` `imp:${importBatchId}:${rowIndex}` `` | **حتمي** |
| عكس قيد | `` `rev:${originalEntryId}` `` — **لا يمكن عكس القيد مرتين** | **حتمي** |
| تعديل قيد | `` `amd:${originalEntryId}:${attempt}` `` حيث `attempt` = عدد التعديلات السابقة | **حتمي** |
| قيد افتتاحي | `` `open:${accountId}` `` — رصيد افتتاحي واحد لكل حساب | **حتمي** |

**القاعدة الذهبية:** كلما وُجد مفتاح طبيعي (natural key) للحدث، فالمعرّف **حتمي** مشتق منه، لا عشوائي.
المعرّف العشوائي مقصور على نية بشرية لا مفتاح طبيعي لها (مصروف اليوم على القهوة قد يتكرر فعلاً مرتين).

### 4.3 أين تُخزَّن حالة العملية

```ts
// users/{uid}/operations/{opId}  — يُكتب فقط للعمليات التي تولّد أكثر من قيد واحد
export type OperationKind =
  | 'recordExpense' | 'recordIncome' | 'transfer' | 'payObligation'
  | 'createDebt' | 'repayDebt' | 'collectReceivable'
  | 'recordOpening' | 'adjustAccount' | 'reverseEntry' | 'amendEntry'
  | 'earmarkToGoal' | 'runRecurring' | 'importBatch' | 'accrueZakat';

export interface OperationRecord {
  id: string;                      // = opId
  schemaVersion: number; ownerUid: string;
  kind: OperationKind;
  status: 'committed' | 'compensated';   // لا 'pending': المعاملة ذرّية فلا حالة وسطى محتملة
  payloadHash: string;
  entryIds: string[];
  touchedDocIds: string[];         // للتدقيق والإصلاح
  resultSummary: Record<string, number | string>;
  createdAt: Timestamp;            // serverTimestamp
  clientCreatedAt: string;
  deviceId?: string;
}
```

**القرار:** العملية ذات القيد الواحد **لا تحتاج مستند `operations`** — مستند القيد نفسه `journalEntries/{opId}`
هو سجلّ منع الازدواج. هذا يوفّر قراءة وكتابة لكل مصروف (أكثر العمليات تكراراً).
`operations` يُكتب فقط لـ: `transfer` بعمولة متعددة القيود، `amendEntry` (عكس + بديل)، `runRecurring` (دفعة)،
`importBatch`. ومعرّفات القيود الأبناء حتمية: `` `${opId}__1` ``، `` `${opId}__2` ``.

**لا حالة `pending`**، لأن `runTransaction` ذرّي: إمّا نجحت كل الكتابات أو لم تُكتب أي منها. وجود «pending»
في تصميم كهذا يعني وهماً بأمان لا وجود له، ويخلق حالة تحتاج استرجاعاً (recovery) لا حاجة إليها.

### 4.4 السيناريوهات الأربعة المطلوبة — كيف تُمنع بالضبط

| السيناريو | الميكانيزم | النتيجة |
|---|---|---|
| **ضغط الزر مرتين** | الطبقة 1: الزر يُعطَّل عند أول نقرة ويبقى معطّلاً حتى انتهاء الوعد (نجاحاً أو فشلاً). الطبقة 2: `opId` ثابت لمدة حياة النموذج. الطبقة 3: المعاملة تقرأ `journalEntries/{opId}` فتجده موجوداً | النقرة الثانية تُرجع **نفس** القيد مع `alreadyApplied: true`. **لا قيد ثانٍ ولا رسالة خطأ للمستخدم** |
| **إعادة المحاولة بعد فشل الشبكة** | نفس `opId` يُعاد إرساله. ثلاث نتائج محتملة: (أ) لم تصل الكتابة → تُنفَّذ الآن؛ (ب) وصلت ونجحت ولم يصل الرد → القراءة تجدها → `alreadyApplied`؛ (ج) وصلت وفشلت → لا شيء مكتوب → تُنفَّذ الآن | **مرة واحدة بالضبط** في الحالات الثلاث |
| **تنفيذ المصروف المتكرر** | `opId = rec:{recurringId}:{YYYY-MM-DD}`. مُشغِّل الاستدراك (catch-up runner) يحسب كل المواعيد المستحقة منذ `recurring.lastRunOccurrenceKey` حتى اليوم ويحاول ترحيلها واحدة واحدة | تشغيل المُشغِّل 50 مرة في اليوم نفسه = **صفر قيود مكرَّرة**. لا حاجة إلى قفل ولا إلى `lastRunAt` موثوق |
| **فتح التطبيق من جهازين معاً** | المعرّفات الحتمية + `runTransaction`: الجهازان يقرآن معاً، أحدهما يكتب، والثاني يفشل بتعارض (`ABORTED`) فتُعاد المعاملة تلقائياً، وفي المحاولة الثانية يجد القيد موجوداً | قيد واحد. للعمليات العشوائية (مصروفان مختلفان) يُكتب القيدان — **وهذا صحيح**، فهما نيّتان مختلفتان |

### 4.5 `payloadHash` — كشف تعارض المحتوى على نفس المعرّف

```ts
// domain/ops/hash.ts
/** تقنين مستقر: ترتيب المفاتيح أبجدياً، حذف undefined، تحويل Minor إلى عدد، بلا مسافات. */
export function canonicalize(payload: unknown): string;
/** SHA-256 عبر Web Crypto (subtle.digest) → hex */
export async function hashPayload(payload: unknown): Promise<string>;
```

داخل المعاملة:

| الحالة | الإجراء |
|---|---|
| القيد غير موجود | يُرحَّل |
| موجود و `payloadHash` مطابق | **إرجاع ناجح بلا كتابة** (`alreadyApplied: true`) |
| موجود و `payloadHash` مختلف | **رفض** بخطأ `OP_ID_CONFLICT`: «هذه العملية سُجّلت بمحتوى مختلف. لتغييرها استخدم التعديل.» — يحمي من إعادة استخدام `opId` بعد تحرير النموذج |
| موجود وحالته `reversed` ونفس الحمولة | إرجاع ناجح بلا كتابة + تنبيه واجهة بأن العملية كانت ملغاة |

### 4.6 التنفيذ دون اتصال — المشكلة الحقيقية و حلّها

**عيب جوهري في Firestore يجب الإقرار به:** `runTransaction` **يفشل دون اتصال**. لا يُطابور محلياً
(بخلاف `setDoc` و `writeBatch` التي تُطابَر في ذاكرة الكاش المحلية). ومتطلب القسم 2 بند 8 يطلب
«دراسة العمل دون اتصال والمزامنة»، والقسم 22 يطلب «عدم اعتبار العملية محفوظة إلا بعد تأكيد نجاح الكتابة».

**الحل المعتمد: صندوق صادر محلي (Outbox) + معرّف حتمي.**

```ts
// infra/outbox/types.ts  (مخزَّن في IndexedDB — لا في Firestore)
export interface OutboxItem {
  opId: string;                     // نفس المعرّف الذي سيُستخدم على الخادم
  kind: OperationKind;
  payload: unknown;                 // حمولة العملية
  payloadHash: string;
  enqueuedAt: string;
  attempts: number;
  lastError?: { code: string; messageAr: string; at: string };
  state: 'queued' | 'inFlight' | 'failedPermanent';
}
```

قواعد الصندوق الصادر:
1. العملية تدخل الصندوق **قبل** محاولة الترحيل، دائماً، متصلاً كان الجهاز أو لا.
2. تُحذف من الصندوق فقط بعد تأكيد نجاح المعاملة (أو `alreadyApplied`).
3. الواجهة تعرض العملية المنتظرة بحالة **«بانتظار المزامنة»** بشكل بصري مختلف تماماً، و**لا تُدخلها في أي رصيد
   أو تقرير** — تطبيقاً للقسم 22 والقسم 25 بند 4. لا «رصيد متوقع» مختلط بالرصيد الحقيقي.
4. إعادة المحاولة بتباطؤ أُسّي (1s, 2s, 4s… حتى 5 دقائق) + محاولة فورية عند عودة الاتصال (`navigator.onLine`).
5. الأخطاء تُقسَّم: **قابلة لإعادة المحاولة** (`unavailable`, `deadline-exceeded`, `aborted`, `internal`)
   مقابل **نهائية** (`permission-denied`, `invalid-argument`, وأخطاء النطاق مثل `OVERPAYMENT`) —
   النهائية تُوضع في `failedPermanent` وتُعرض للمستخدم لتعديلها أو حذفها.
6. الترتيب: **لا ضمان ترتيب مطلوب** لأن كل عملية مستقلة وذرّية. الاستثناء: تحويل ثم سداد من نفس الحساب
   قد يفشل الثاني بسبب الرصيد؛ لذا يُنفَّذ الصندوق **تسلسلياً (واحدة في كل مرة)** بترتيب الإدخال.

---

## 5. `runTransaction` مقابل `writeBatch` — المتى والحدود

### 5.1 القاعدة الفاصلة

> **إن كان قرار الكتابة يعتمد على قيمة مقروءة → `runTransaction`. إن كانت الكتابات معروفة سلفاً بالكامل → `writeBatch`.**

كل عملية مالية في «رصيد» تعتمد على قراءة (فحص وجود `opId`، الرصيد السالب، السداد الزائد، الرصيد الافتتاحي
للفترة)، لذلك: **كل ترحيل قيد = `runTransaction`. بلا استثناء.**

### 5.2 خريطة القرار

| العملية | الأداة | لماذا |
|---|---|---|
| تسجيل مصروف/دخل | `runTransaction` | فحص `opId` + الرصيد السالب + تحديث الميزانية |
| تحويل بين حسابين | `runTransaction` | فحص رصيد المصدر |
| دفع التزام (جزئي/كامل) | `runTransaction` | قراءة `remainingMinor` لمنع الزائد |
| تحصيل/سداد دين | `runTransaction` | قراءة `remainingMinor` |
| رصيد افتتاحي | `runTransaction` | منع تكراره (`open:{accountId}`) |
| عكس قيد | `runTransaction` | قراءة الأصل والتأكد أنه `posted` وغير معكوس |
| تعديل قيد | `runTransaction` واحدة | العكس والبديل **ذرّيان معاً**، وإلا ظهر رصيد خاطئ لحظياً |
| تخصيص لهدف | `runTransaction` | قراءة `equity.unallocated` + الهدف |
| إنشاء حساب/فئة | `writeBatch` أو `setDoc` | لا قراءة مطلوبة؛ لا أثر على الأرصدة |
| تهيئة شجرة الحسابات (seed) | `writeBatch` (مجزَّأ ≤450) | ~45 مستنداً معروفة سلفاً |
| استيراد جَمْعي | `writeBatch` للقيود + تمريرة تجميع لاحقة (5.4) | تجنّب ازدحام مستند `periods` |
| أرشفة/تعطيل مجموعة فئات | `writeBatch` | تحديثات حالة بحتة |
| حذف بيانات مستخدم (تصدير/حذف) | `writeBatch` مجزَّأ | كتابات معروفة |
| تحديث حالات الالتزامات اليومية (`due`→`overdue`) | `writeBatch` | الحالة مشتقة من التاريخ، لا من مبالغ |

### 5.3 الحدود الفعلية وأثرها على التصميم

| الحد | القيمة | أثره على تصميمنا |
|---|---|---|
| حد الكتابات في `writeBatch` | **500 عملية** (وحجم طلب ~10MB) | مُهيِّئ الشجرة ومسار الاستيراد يُجزِّئان على دفعات 450 بهامش أمان |
| حد الكتابات في `runTransaction` | **500 عملية** أيضاً | أكبر معاملة عندنا 9 كتابات (التعديل) — بعيدة جداً |
| **لا قراءة بعد الكتابة** داخل المعاملة | إلزامي | كل `tx.get()` في **مرحلة قراءة واحدة في الأعلى**، ثم كل `tx.set/update` بعدها. يُفرض بالبنية: الدالة مقسّمة `readPhase()` ثم `computePhase()` (نقية) ثم `writePhase()` |
| **لا استعلامات داخل المعاملة** في Web SDK (`tx.get` يقبل `DocumentReference` فقط) | إلزامي | **هذا القيد شكّل التصميم كله:** كل المعرّفات حتمية (`accountPeriods/{accountId}__{periodKey}`، `periods/{periodKey}`، `budgetPeriods/{periodKey}`، `journalEntries/{opId}`) فلا نحتاج استعلاماً داخل المعاملة أبداً |
| إعادة محاولة المعاملة | ~5 محاولات افتراضياً (`runTransaction(db, fn, { maxAttempts })`) | دالة المعاملة **نقية**: لا `Date.now()`، لا `randomUUID()`، لا `serverTimestamp()` محسوب خارجاً، لا دفع إلى مصفوفة خارجية، لا إرسال تحليلات. كل القيم المتغيرة تُحسب **قبل** `runTransaction` وتُمرَّر |
| المعاملة تفشل دون اتصال | إلزامي | الصندوق الصادر (4.6) |
| سقف كتابة المستند الواحد | ~1/ثانية مستدامة | `periods/{periodKey}` نقطة الازدحام ← مسار الاستيراد يتجنبها |
| حجم المستند | 1 ميغابايت | القيد بسطور مضمَّنة آمن؛ `periods.expenseByCategory` بـ 200 فئة ≈ 8KB آمن |

### 5.4 نمط الاستيراد الجَمْعي (لماذا لا معاملة)

```
المرحلة 1: writeBatch (دفعات 450) — كتابة القيود بـ status:'posted' و aggregatesApplied:false
           معرّفات حتمية imp:{batchId}:{row} ⇒ إعادة التشغيل آمنة
المرحلة 2: قراءة القيود غير المُجمَّعة، وتجميعها في الذاكرة لكل (حساب، فترة) و(فترة)
المرحلة 3: runTransaction واحدة لكل حساب/فترة تُطبّق الدلتا المُجمَّعة وتضع aggregatesApplied:true
           (أو writeBatch إن لم تكن هناك فحوص رصيد — والاستيراد التاريخي لا يفحص الرصيد السالب)
المرحلة 4: auditTrialBalance للتأكد
```
السبب: 2000 قيد × معاملة لكل قيد = 2000 رحلة شبكة + 2000 كتابة على `periods/{periodKey}` الواحد
(أي 2000 ثانية بسبب سقف الكتابة). النمط أعلاه يختصرها إلى ~5 دفعات + ~30 معاملة تجميع.

### 5.5 هيكل التنفيذ الإلزامي

```ts
// infra/firestore/postOperation.ts
export interface PostContext {
  uid: string;
  now: { iso: string; bookedAt: string; periodKey: string };   // محسوب قبل المعاملة
  deviceId: string;
}
export interface PostResult {
  opId: string;
  entryIds: string[];
  alreadyApplied: boolean;
  balancesAfter: Record<string, Minor>;
  warnings: DomainWarning[];        // تجاوز ميزانية، اقتراب من هدف…
}

/**
 * نقطة الكتابة المالية **الوحيدة** في النظام.
 * ثلاث مراحل صريحة: readPhase (كل tx.get) → plan (نقي، من طبقة النطاق) → writePhase (كل tx.set/update).
 * لا تستدعي أي شيء غير حتمي داخل المعاملة.
 */
export async function postOperation(
  ctx: PostContext,
  op: OperationRequest            // اتحاد مُميَّز (discriminated union) لكل أنواع العمليات
): Promise<PostResult>;
```

```ts
// domain/ops/plan.ts — طبقة النطاق: نقية، قابلة للاختبار بلا Firebase
export interface LedgerSnapshot {              // ما قرأته readPhase
  existingEntry: JournalEntry | null;
  accounts: Record<string, Account>;
  obligation?: Obligation;
  debt?: Debt;
  goal?: FinancialGoal;
  budgetPeriod?: BudgetPeriod;
  periodSummary?: PeriodSummary;
  accountPeriods: Record<string, AccountPeriod | null>;
}
export interface WritePlan {
  entries: JournalEntry[];
  accountUpdates: Array<{ id: string; debitDelta: Minor; creditDelta: Minor; lastEntryId: string }>;
  accountPeriodUpserts: Array<{ id: string; /* … */ }>;
  periodSummaryDelta: Partial<Record<keyof PeriodSummary, number>> & { expenseByCategory?: Record<string, number> };
  budgetDelta?: { categoryId: string; spentDelta: Minor };
  obligationUpdate?: { id: string; paidMinor: Minor; remainingMinor: Minor; status: Obligation['status'] };
  debtUpdate?: { id: string; settledMinor: Minor; remainingMinor: Minor; status: Debt['status'] };
  goalUpdate?: { id: string; savedMinor: Minor; status: FinancialGoal['status'] };
  operationRecord?: OperationRecord;
  auditLog?: AuditLogEntry;
  warnings: DomainWarning[];
}

/** الدالة المركزية: تحوّل طلباً + لقطة إلى خطة كتابة، أو ترمي خطأ نطاق. نقية 100%. */
export function planOperation(op: OperationRequest, snap: LedgerSnapshot, ctx: PostContext): WritePlan | AlreadyApplied;
```

**هذا التقسيم هو جوهر الالتزام بالقسم 2 («فصل منطق الأعمال عن الواجهات وعن الوصول إلى Firebase»)
والقسم 23 بند 1:** `planOperation` تُختبر بالكامل كدالة نقية دون محاكي Firebase، و`postOperation` تُختبر
بمحاكي Firestore للتحقق من المعاملة والقواعد فقط.

---

## 6. التعديل والإلغاء مع حفظ الأثر التاريخي

### 6.1 القاعدة الأساسية

> **القيد المرحَّل غير قابل للتغيير (immutable). لا تُعدَّل سطوره ولا مبالغه ولا تاريخه ولا حساباته أبداً.**

الحقول الوحيدة القابلة للتحديث على قيد مرحَّل: `status`، `reversedByEntryId`، `replacedByEntryId`،
`updatedAt`. وتُفرض هذه الحصرية في Firestore Rules (القسم 12.2)، لا في الكود وحده.

الحقول «الوصفية» غير المحاسبية (`description`، `tags`، `attachmentIds`، `notes`) — **قرار:** قابلة للتعديل
دون عكس، لأن تعديلها لا يحرّك ريالاً واحداً، ومنعه يدفع المستخدم إلى إلغاء قيد سليم لمجرد تصحيح إملاء.
**لكن** كل تعديل وصفي يُسجَّل في `auditLogs` بالقيمة القديمة والجديدة. أما `bookedAt` و`amountMinor`
و`accountId` و`categoryId` فمحاسبية ⇒ تمرّ بالعكس والاستبدال.

### 6.2 الإلغاء (عكس قيد)

```ts
export interface ReverseEntryRequest {
  type: 'reverseEntry';
  opId: string;                      // = `rev:${originalEntryId}` (حتمي ⇒ لا عكس مزدوج)
  originalEntryId: string;
  reason: string;                    // إلزامي، غير فارغ — القسم 18 بند 9
  reversalDatePolicy: 'originalDate' | 'today';
}
```

**بناء قيد العكس:** نفس السطور بالمبالغ نفسها مع **قلب الجانب** (`debit ↔ credit`)، و`kind:'reversal'`،
و`reversesEntryId`. لا سطور بمبالغ سالبة — القلب يحفظ الثابت I2 ويبقي الإجماليات التاريخية ظاهرة.

**سياسة التاريخ (قرار صريح):**

| الحالة | `bookedAt` قيد العكس | السبب |
|---|---|---|
| فترة القيد الأصلي **مفتوحة** (`budgetPeriods/{k}.isLocked == false`) | **نفس تاريخ الأصل** | الشهر يعود إلى حالته الصحيحة؛ مصروف مارس الخاطئ لا يلوّث أبريل |
| فترة القيد الأصلي **مُقفلة** | **تاريخ اليوم** | تقرير مُقفل سُلِّم/صُدِّر لا يُغيَّر بأثر رجعي؛ ويُعرض كتصحيح في الفترة الحالية |

**الأثر على الكيانات المرافقة (إلزامي داخل نفس المعاملة):**

| القيد الأصلي | ما يُعكس أيضاً |
|---|---|
| `expense` | `periods.totalExpenseMinor -= X`، `expenseByCategory[cat] -= X`، `budgetPeriods.categories[cat].spentMinor -= X` و**إعادة ضبط `alertFiredAtPercent`** إن هبطت النسبة تحته، `householdExpenseMinor -= X` إن كان موسوماً |
| `income` | `periods.totalIncomeMinor -= X`، `incomeBySource -= X`، وحالة `incomeSchedules` تعود `expected` |
| `obligationPayment` | `obligation.paidMinor -= X`، `remainingMinor += X`، **إعادة حساب** `status` من التاريخ والمبلغ، `paymentCount -= 1` |
| `debtRepayment` / `debtCollection` | `debt.settledMinor -= X`، `remainingMinor += X`، `status` يُعاد حسابه، `settlementCount -= 1` |
| `borrow` / `lend` | **ممنوع العكس إن وُجدت تسويات لاحقة** (`settlementCount > 0`) ⇒ خطأ `DEBT_HAS_SETTLEMENTS`: «ألغِ الدفعات أولاً». وإلا: عكس القيد + `debt.status='cancelled'` |
| `earmark` | `goal.savedMinor -= X`، `status` يعود `active` إن كان `achieved` |
| `transfer` | رصيدا الحسابين، و`transferVolumeMinor -= X` |
| `opening` | **ممنوع العكس** إن وُجد أي قيد لاحق على الحساب ⇒ يُستخدم `adjustAccount` بدلاً منه |
| `reversal` | **ممنوع عكس العكس.** لإعادة الحالة الأصلية: قيد جديد عبر `amendEntry` |

**منع تضارب الأرصدة:** لأن المُجمَّعات كلها تُحدَّث في **نفس المعاملة** مع كتابة قيد العكس، فلا توجد لحظة
يرى فيها أي قارئ قيداً معكوساً وأثره باقياً، أو العكس. وبسبب `opId` الحتمي `rev:{id}` لا يمكن تطبيق العكس مرتين.

### 6.3 التعديل (استبدال)

```ts
export interface AmendEntryRequest {
  type: 'amendEntry';
  opId: string;                      // = `amd:${originalEntryId}:${amendCount}`
  originalEntryId: string;
  reason: string;
  replacement: Omit<EntryDraft, 'opId'>;   // المسودة الجديدة كاملة
}
```

**التنفيذ: معاملة واحدة، ثلاثة قيود منطقية:**

```
tx:
  1) اقرأ: الأصل، الحسابات المتأثرة (القديمة + الجديدة)، الالتزام/الدين إن وُجد،
          الميزانية، مُجمَّع الفترة (القديمة + الجديدة إن تغيّر التاريخ)، ووجود opId
  2) تحقّق: الأصل status === 'posted'،
            لا يحمل reversedByEntryId،
            الفترة غير مُقفلة (أو السياسة تسمح)،
            المسودة الجديدة متوازنة، والفحوص المعتادة (رصيد سالب/سداد زائد) **على الصافي**
  3) اكتب:
     - journalEntries/{opId}__1   ← قيد العكس  (kind:'reversal', reversesEntryId=original)
     - journalEntries/{opId}__2   ← القيد البديل (replacesEntryId=original, correctionGroupId)
     - journalEntries/{original}  ← { status:'replaced', replacedByEntryId:`${opId}__2`,
                                      reversedByEntryId:`${opId}__1` }
     - الحسابات: دلتا **صافية** (العكس + البديل معاً، لا خطوتين)
     - accountPeriods / periods / budgetPeriods: دلتا صافية
     - obligations / debts / goals: دلتا صافية
     - operations/{opId} + auditLogs/{autoId}
```

**لماذا الدلتا الصافية لا خطوتين متتاليتين؟** لأن الفحوص (الرصيد السالب، السداد الزائد) يجب أن تُطبَّق على
**النتيجة النهائية**. تعديل مصروف من 500 إلى 480 لا يجوز أن يفشل بسبب حدٍّ تجاوزه الأصل أصلاً.
مثال: تعديل دفعة التزام من 200 إلى 300 على التزام 800 متبقٍّ منه 600 ⇒ الصافي `+100` ⇒ `300 ≤ 800` ✓.

**سلسلة القابلية للتتبع:** `correctionGroupId` = `originalEntryId` للقيد الأول في السلسلة، ويبقى نفسه
في كل تعديل لاحق. استعلام واحد (`where correctionGroupId == X order by createdAt`) يعطي تاريخ العملية كاملاً.

### 6.4 ما تراه الواجهة وما يراه التقرير

| السياق | المرشّح (filter) | السبب |
|---|---|---|
| قائمة العمليات للمستخدم | `status == 'posted'` و `kind != 'reversal'` | المستخدم يرى العمليات السارية فقط، لا ضجيج التصحيحات |
| «سجل التعديلات» لعملية | `correctionGroupId == X` بلا مرشّح | الأثر التاريخي كاملاً — القاعدة 19.10 |
| كشف حركة حساب | **كل** القيود `posted` و `replaced` **بما فيها** `reversal` | الكشف يجب أن يطابق الرصيد؛ إخفاء العكس يجعل مجموع الكشف ≠ الرصيد |
| التقارير والمُجمَّعات | لا مرشّح أصلاً — المُجمَّعات مُحدَّثة مُسبقاً | العكس والبديل ألغيا أثرهما في المُجمَّع لحظة الكتابة |
| التصدير (Excel/CSV/PDF) | كل القيود + أعمدة `status`, `reversesEntryId`, `replacesEntryId` | قابلية التدقيق الكاملة — القسم 16 |

**ملاحظة بالغة الأهمية:** لأن `reversal + original = 0` رياضياً، فإن **أي** مجموع يُحسب على كل القيود
المرحَّلة يعطي الرقم الصحيح تلقائياً دون أي منطق استبعاد. هذه أكبر فائدة عملية للقيد المزدوج في هذا المشروع،
وهي ما يُنجِّينا من عيب «التقارير لا تطابق العمليات» (القسم 23 بند 12).

### 6.5 إقفال الفترة

```ts
// users/{uid}/periodLocks/{periodKey}
export interface PeriodLock {
  id: string;                 // 'YYYY-MM'
  lockedAt: Timestamp; lockedBy: string; reason: string;
  allowBackdatedCorrections: boolean;    // false افتراضياً
}
```
بعد الإقفال: **ممنوع** أي قيد بـ `bookedAt` داخل الفترة (يُفرض في المعاملة وفي Rules). التصحيح يُرحَّل
بتاريخ اليوم. الغرض: تثبيت التقارير المُصدَّرة والميزانيات المُغلقة، وهو ما يجعل «حفظ الأثر التاريخي» حقيقياً.

---

## 7. تطبيق قواعد الأعمال في القسم 19 — واحدة واحدة

**الرموز:** `X` = المبلغ بالدرهم. `A` = حساب نقدي/مصرفي/محفظة. `C` = حساب فئة المصروف.
`Dr` = مدين، `Cr` = دائن. «✗» = لا أثر. كل الأسطر تُكتب في **معاملة واحدة**.

### R1 — «المصروف المدفوع يخفض رصيد الحساب»

**القيد:** `Dr expense.{categoryId} X` / `Cr asset.{A} X` — `kind:'expense'`

| الكيان | الأثر الدقيق |
|---|---|
| الحسابات | `A`: `creditTotalMinor += X` ⇒ `balanceMinor -= X`. `C`: `debitTotalMinor += X` ⇒ `balanceMinor += X`. كلاهما `entryCount += 1`, `balanceVersion += 1`, `lastEntryId = entryId` |
| النقد المتاح | `-X` (لأن `A.isCashLike = true`) |
| صافي الثروة | `-X` (أصل ينقص مقابل مصروف) |
| `accountPeriods` | `{A}__{pk}`: `creditMinor += X`, `closingBalance -= X`. `{C}__{pk}`: `debitMinor += X` |
| `periods/{pk}` | `totalExpenseMinor += X`، `expenseByCategory[categoryId] += X`، `netCashFlowMinor -= X`، `entryCount += 1` |
| مصاريف المنزل | إن `tags ∋ 'household'`: `householdExpenseMinor += X` — **مجموع فرعي من نفس الرقم، لا قيمة مضافة** (القسم 11) |
| الميزانيات | `budgetPeriods/{pk}.categories[cat].spentMinor += X`, `overallSpentMinor += X`. إن تجاوزت النسبة `alertAtPercent` ولم تُطلَق بعد ⇒ تحذير في `PostResult.warnings` + إشعار + `alertFiredAtPercent` يُحدَّث (منع التكرار — القسم 17) |
| الالتزامات | ✗ (إلا إذا `refs.obligationId` ⇒ انظر R5) |
| الديون | ✗ |
| الأهداف | ✗ |
| التقارير | يظهر في: المصروفات، اليومي/الشهري/السنوي، التدفق النقدي، حركة الحساب، الميزانية والانحرافات |
| الفحوص | `X > 0`؛ `A.allowNegative || A.balance - X ≥ 0`؛ `A.isPostable`؛ `C.type === 'expense'`؛ الفترة غير مُقفلة |

### R2 — «الدخل المستلم يرفع رصيد الحساب»

**القيد:** `Dr asset.{A} X` / `Cr income.{sourceId} X` — `kind:'income'`

| الكيان | الأثر |
|---|---|
| الحسابات | `A`: `debitTotal += X` ⇒ `+X`. `income.{s}`: `creditTotal += X` ⇒ `+X` |
| النقد المتاح | `+X` | 
| صافي الثروة | `+X` |
| `periods/{pk}` | `totalIncomeMinor += X`، `incomeBySource[s] += X`، `netCashFlowMinor += X` |
| الدخل المتوقع | إن `refs.incomeScheduleId`: `incomeSchedules/{id}.occurrences[key] = { status:'received', entryId, receivedMinor: X }`. **الدخل المتوقع لا يولّد قيداً أبداً** ⇒ تطبيق مباشر للقسم 7 سطر 84 |
| الميزانيات | ✗ (ميزانيات المصروف فقط) |
| الالتزامات / الديون | ✗ |
| الأهداف | ✗ إلا عبر `earmarkToGoal` منفصلة |
| الفحوص | `X > 0`؛ `A.isPostable`؛ `income.{s}.type === 'income'`؛ لا فحص رصيد سالب (الرصيد يزيد) |

### R3 — «التحويل بين حسابين لا يغيّر إجمالي الأموال المملوكة»

**القيد (بلا عمولة):** `Dr asset.{to} X` / `Cr asset.{from} X` — `kind:'transfer'`
**القيد (بعمولة `f`):** `Dr asset.{to} X` / `Dr expense.fees f` / `Cr asset.{from} (X+f)` — ثلاثة سطور، قيد واحد

| الكيان | الأثر |
|---|---|
| الحسابات | `from`: `-(X+f)`. `to`: `+X`. `expense.fees`: `+f` |
| النقد المتاح | `-f` فقط (صفر إن لا عمولة) ⇒ **القاعدة محقَّقة بنيوياً** |
| `periods/{pk}` | `totalIncomeMinor`: **لا يتغير**. `totalExpenseMinor += f` فقط. `transferVolumeMinor += X` |
| لماذا مضمون؟ | التقارير تشتق الدخل والمصروف من **نوع الحساب** في السطر (`accountType`)، لا من حقل `kind`. ولأن طرفي التحويل كلاهما `asset`، **من المستحيل بنيوياً** أن يدخل التحويل في الدخل أو المصروف. هذا جواب مباشر على القاعدة 19.11 |
| الفحوص | `from !== to`؛ `from.allowNegative \|\| from.balance - (X+f) ≥ 0`؛ كلاهما `type === 'asset'` و `isPostable`؛ `X > 0`, `f ≥ 0` |
| العرض | عملية واحدة في السجل (لا عمليتان)، بـ `transferPairKey` للتوافق مع التصدير |

### R4 — «إنشاء التزام غير مدفوع لا يخفض الرصيد النقدي»

**القرار المعماري (نقطة الخلاف الأهم في هذا المنظور):**

| الوضع | القيد عند الإنشاء | النتيجة على الرصيد | متى يُستخدم |
|---|---|---|---|
| `accounting: 'cash'` ← **الافتراضي** | **لا قيد إطلاقاً**. يُنشأ مستند `obligations/{id}` فقط | **بلا تغيير** ✓ | إيجار، كهرباء، إنترنت، اشتراكات، التزامات عائلية — أي التزام دوري يفكّر فيه المستخدم نقدياً |
| `accounting: 'accrual'` ← اختياري لكل التزام | `Dr expense.{cat} X` / `Cr liability.obligation.{id} X` | **بلا تغيير للنقد** ✓ (الخصوم ترتفع، لا الأصول تنقص) | قسط شراء، التزام تعاقدي يريد المستخدم رؤيته كدين حقيقي |

| الكيان | `cash` | `accrual` |
|---|---|---|
| الحسابات | ✗ | `expense.{cat} +X`، `liability.obligation.{id} +X` |
| النقد المتاح | ✗ | ✗ |
| صافي الثروة | ✗ (الالتزام يُعرض كمعلومة التزام، لا كخصم) | `-X` |
| `periods/{pk}` | ✗ | `totalExpenseMinor += X` في **شهر الاستحقاق** لا شهر الدفع |
| الميزانيات | ✗ حتى الدفع | `spentMinor += X` عند الإنشاء |
| لوحة التحكم | «الالتزامات القادمة/المتأخرة» تقرأ `obligations` مباشرة | نفسه + «إجمالي الخصوم» يرتفع |

**لماذا `cash` افتراضياً؟ نقد صريح لمنظور القيد المزدوج:**
الاستحقاق هو الصواب المحاسبي، لكنه يعطي المستخدم الشخصي رقماً **لا يفهمه ولا يريده**: إنشاء التزام إيجار
سنوي يجعل «مصروفات هذا الشهر» ترتفع 9,600 د.ل بلا أي مال خرج. وهذا يناقض روح القسم 4 («ملخص حي للوضع المالي»)
والقسم 12 («فصل واضح بين البيانات الفعلية والتوقعات»). الالتزام **توقّع**، فمكانه قسم التوقعات لا قائمة المصروفات.
**المقابل المدفوع صراحةً:** تقاريرنا نقدية الأساس، فالتزام ديسمبر المدفوع في يناير يظهر مصروف يناير.
وهذا مقبول ومُوثَّق، والوضع `accrual` متاح لمن يريد غير ذلك.

**الفحوص عند الإنشاء:** `totalMinor > 0`؛ `dueDate` صالح؛ `categoryId` موجود ونشط؛
`accounting:'accrual'` يستلزم إنشاء `liability.obligation.{id}` في نفس الدفعة.

### R5 — «دفع التزام يخفض الرصيد ويسجل الدفعة المرتبطة»

**القيد (`cash`):** `Dr expense.{obligation.categoryId} X` / `Cr asset.{A} X` — `kind:'obligationPayment'`،
`refs.obligationId = id`، و`refs.obligationInstallmentIndex` إن كان قسطاً.
**القيد (`accrual`):** `Dr liability.obligation.{id} X` / `Cr asset.{A} X` — **بلا سطر مصروف** (اعتُرف به سابقاً).

| الكيان | الأثر الدقيق |
|---|---|
| الحسابات | `A`: `-X`. و`C` (`cash`) أو `liability.obligation.{id}` (`accrual`): `+X` / `-X` |
| النقد المتاح | `-X` |
| الالتزام | `paidMinor += X`؛ `remainingMinor = totalMinor - paidMinor` **(يُعاد حسابه من الطرفين، لا يُطرح من المخزَّن)**؛ `paymentCount += 1`؛ `lastPaymentEntryId = entryId`؛ `status = computeObligationStatus(...)` |
| حالة الالتزام | `remaining === 0` ⇒ `paid`. `0 < paid < total` و `dueDate ≥ today` ⇒ `partiallyPaid`. `0 < paid < total` و `dueDate < today` ⇒ `overdue`. `paid === 0` ⇒ `upcoming`/`due`/`overdue` حسب التاريخ |
| سجل الدفعات | **لا مجموعة `obligationPayments` منفصلة** — سجل الدفعات = استعلام `journalEntries where refs.obligationId == id order by bookedAtTs`. يمنع ازدواج مصدر الحقيقة (انحراف من القسم 18 مع تبرير) |
| التكرار | إن كان للالتزام `recurrence` و`remaining === 0` ⇒ إنشاء الدورة التالية بـ `opId` حتمي `` `obl:${obligationId}:${nextDueDate}` `` في **نفس المعاملة** ⇒ لا دورة مكرّرة ولا دورة مفقودة |
| `periods/{pk}` | `obligationPaidMinor += X`. و(`cash`) `totalExpenseMinor += X` و`expenseByCategory[cat] += X`؛ (`accrual`) لا تغيير على المصروف |
| الميزانيات | (`cash`) `spentMinor += X` كأي مصروف؛ (`accrual`) ✗ |
| الأهداف | ✗ |
| التنبيهات | `notifications`: إشعار «سُدِّد بالكامل» أو «سُدِّد جزئياً، المتبقي Y»؛ وإلغاء تنبيه الاستحقاق المعلّق |
| الفحوص | **`X ≤ obligation.remainingMinor`** إلا إذا `isVariableAmount && userConfirmedOverpay` (وقتها يُرفع `totalMinor` إلى `paidMinor` ويُسجَّل في `auditLogs`)؛ `X > 0`؛ رصيد `A`؛ `obligation.status !== 'cancelled' && !== 'paid'` |

### R6 — «تسجيل دين على المستخدم لا يعني بالضرورة حركة نقدية»

ثلاث حالات مختلفة تماماً، ولكل منها قيد مختلف — وهذا بالضبط ما يبرّر القيد المزدوج:

| الحالة | القيد | `kind` | النقد المتاح | الخصوم |
|---|---|---|---|---|
| **(أ) قرض نقدي مستلم** | `Dr asset.{A} X` / `Cr liability.payable.{contactId} X` | `borrow` | **`+X`** | `+X` |
| **(ب) دين بلا نقد** (شراء بالأجل) | `Dr expense.{cat} X` / `Cr liability.payable.{contactId} X` | `borrow` | ✗ | `+X` |
| **(ج) دين قائم سابقاً** (رصيد افتتاحي) | `Dr equity.opening X` / `Cr liability.payable.{contactId} X` | `opening` | ✗ | `+X` |

| الكيان | الأثر |
|---|---|
| الحسابات | `liability.payable.{contactId}`: `creditTotal += X` ⇒ `+X`. ويُنشأ الحساب تلقائياً عند أول دين لهذا الشخص |
| `periods/{pk}` | `borrowedMinor += X`. **`totalIncomeMinor` لا يتغير مطلقاً** — القرض ليس دخلاً (القاعدة 19.11) |
| لماذا مضمون؟ | الطرف المقابل حساب `liability` لا `income`. التقرير يشتق الدخل من نوع الحساب ⇒ **استحالة بنيوية** لتضخّم الدخل |
| الدين | `debts/{id}`: `direction:'payable'`, `principalMinor: X`, `settledMinor: 0`, `remainingMinor: X`, `createdCash: (الحالة أ)`, `accountId: liability.payable.{contactId}` |
| صافي الثروة | (أ) `0` (نقد ↑ وخصوم ↑). (ب) `-X` (مصروف). (ج) `-X` (يُصحِّح حقوق الملكية الافتتاحية) |
| التقارير | «الديون عليّ»، «الالتزامات»، صافي الثروة. **لا يظهر في المصروفات** إلا في الحالة (ب) حيث يوجد مصروف حقيقي |
| الميزانية | (ب) فقط: `spentMinor += X` |
| الفحوص | `X > 0`؛ وجود `contactId`؛ (أ) `A.isPostable` |

### R7 — «تحصيل دين يرفع رصيد الحساب المستلم»

**القيد:** `Dr asset.{A} X` / `Cr asset.receivable.{contactId} X` — `kind:'debtCollection'`

| الكيان | الأثر |
|---|---|
| الحسابات | `A`: `+X` (نقد). `asset.receivable.{contactId}`: `creditTotal += X` ⇒ **`-X`** |
| النقد المتاح | **`+X`** (لأن `A.isCashLike=true` و`receivable.isCashLike=false`) |
| صافي الثروة | **`0`** — أصل غير سائل تحوّل إلى سائل. وهذا صحيح تماماً ومطلب ضمني في القسم 10 |
| `periods/{pk}` | `collectedMinor += X`. **`totalIncomeMinor` لا يتغير** — التحصيل ليس دخلاً (القاعدة 19.11) |
| الدين | `debts/{id}`: `settledMinor += X`، `remainingMinor = principalMinor - settledMinor`، `settlementCount += 1`، `lastSettlementEntryId`، `status`: `remaining===0 ⇒ 'settled'` وإلا `'partiallySettled'` |
| سجل التحصيلات | استعلام `journalEntries where refs.debtId == id` |
| الأهداف | ✗ |
| التنبيهات | إلغاء تنبيه «حان التحصيل»؛ إشعار «حُصِّل بالكامل/جزئياً» |
| الفحوص | **`X ≤ debt.remainingMinor`** ⇒ خطأ `OVER_COLLECTION` وإلا؛ `X > 0`؛ `debt.direction === 'receivable'`؛ `debt.status ∉ {settled, cancelled, writtenOff}` |

**الإقراض (نشوء الدين لي):** `Dr asset.receivable.{contactId} X` / `Cr asset.{A} X` — `kind:'lend'`.
النقد المتاح `-X`، صافي الثروة `0`، **ولا مصروف** (القاعدة 19.11).
**شطب الدين (`writeOff`):** `Dr expense.baddebt X` / `Cr asset.receivable.{contactId} X` — هنا فقط يصبح مصروفاً.

### R8 — «سداد دين يخفض رصيد الحساب المستخدم للدفع»

**القيد:** `Dr liability.payable.{contactId} X` / `Cr asset.{A} X` — `kind:'debtRepayment'`

| الكيان | الأثر |
|---|---|
| الحسابات | `liability.payable.{contactId}`: `debitTotal += X` ⇒ **`-X`** (الخصم ينقص). `A`: `-X` |
| النقد المتاح | `-X` |
| صافي الثروة | **`0`** — نقد ينقص وخصم ينقص بالقدر نفسه |
| `periods/{pk}` | `repaidMinor += X`. **`totalExpenseMinor` لا يتغير** — السداد ليس مصروفاً (القاعدة 19.11) |
| الميزانيات | **✗ — السداد لا يستهلك الميزانية.** وهذا فرق جوهري عن R1 وسبب وجود `kind` منفصل |
| الدين | `settledMinor += X`، `remainingMinor` يُعاد حسابه، `status`، `settlementCount += 1` |
| الفوائد/الزيادة | إن وُجدت زيادة `i`: ثلاثة سطور — `Dr liability.payable X` / `Dr expense.finance i` / `Cr asset.{A} (X+i)`. الزيادة **مصروف حقيقي**، الأصل لا |
| الفحوص | **`X ≤ debt.remainingMinor`** ⇒ `OVERPAYMENT`؛ رصيد `A`؛ `debt.direction === 'payable'` |

### R9 — «المبالغ المستحقة للتحصيل لا تُعرض ضمن النقد المتاح»

**التطبيق:** حقل `isCashLike` على الحساب. `asset.receivable.*` ⇒ `isCashLike: false` **ويُفرض في Rules**
(لا يُسمح بإنشاء حساب `subtype:'receivable'` بـ `isCashLike: true`).

```ts
export const availableCashMinor = (accounts: Account[]): Minor =>
  sumMinor(accounts.filter(a => a.isCashLike && a.status === 'active' && a.isPostable)
                   .map(a => a.balanceMinor as Minor));

export const totalReceivablesMinor = (accounts: Account[]): Minor =>
  sumMinor(accounts.filter(a => a.subtype === 'receivable' && a.status === 'active')
                   .map(a => a.balanceMinor as Minor));

export const totalPayablesMinor = (accounts: Account[]): Minor =>
  sumMinor(accounts.filter(a => a.subtype === 'payable' && a.status === 'active')
                   .map(a => a.balanceMinor as Minor));

/** صافي الثروة = الأصول (بما فيها المستحق لي) − الخصوم. بطاقة مستقلة عن «النقد المتاح». */
export const netWorthMinor = (accounts: Account[]): Minor => /* … */;
```

لوحة التحكم (القسم 4) تعرض **ثلاثة أرقام منفصلة بوضوح**: «الأموال المتاحة»، «المستحق لي»، «الديون عليّ» —
ولا تجمعها في رقم واحد. والنصّ التوضيحي تحت «الأموال المتاحة» إلزامي: «لا يشمل المبالغ المستحقة لك».

### R10 — «تعديل/إلغاء عملية معتمدة بطريقة تحفظ الأثر التاريخي وتمنع تضارب الأرصدة»

مُطبَّقة بالكامل في القسم 6. الملخص الجدولي:

| المطلب في القاعدة | آلية التطبيق |
|---|---|
| حفظ الأثر التاريخي | القيد غير قابل للتغيير + قيد عكس + قيد بديل + `correctionGroupId` + `auditLogs` |
| منع تضارب الأرصدة | العكس والبديل وكل المُجمَّعات في **معاملة واحدة** بدلتا **صافية** |
| منع العكس المزدوج | `opId` حتمي `rev:{entryId}` |
| منع تعديل التصحيح نفسه | `kind:'reversal'` لا يُعكس ولا يُعدَّل (مفروض في Rules وفي النطاق) |
| منع التصحيح بأثر رجعي على فترة مُقفلة | `periodLocks` + سياسة `today` |

### R11 — «التمييز بين التحويلات والاقتراض والسداد والدخل الحقيقي والمصروف الحقيقي»

**هذه القاعدة هي سبب اختيار القيد المزدوج، وتطبيقها بنيوي لا شرطي:**

```ts
/** الدخل والمصروف في كل التقارير يُشتقّان من **نوع الحساب في السطر**، لا من kind ولا من إشارة المبلغ. */
export function classifyLineForReports(line: JournalLine): 'income' | 'expense' | 'neutral' {
  if (line.accountType === 'income')  return 'income';    // دائماً دائن
  if (line.accountType === 'expense') return 'expense';   // دائماً مدين
  return 'neutral';                                       // asset | liability | equity
}
```

| نوع العملية | يمسّ `income`؟ | يمسّ `expense`؟ | النتيجة في التقرير |
|---|---|---|---|
| مصروف | لا | **نعم** | مصروف |
| دخل | **نعم** | لا | دخل |
| تحويل | لا | لا (إلا العمولة) | محيَّد |
| اقتراض (أ) | لا | لا | محيَّد — نقد ↑ وخصوم ↑ |
| اقتراض (ب) | لا | نعم | مصروف حقيقي بالفعل |
| سداد دين | لا | لا (إلا الفوائد) | محيَّد |
| إقراض | لا | لا | محيَّد |
| تحصيل | لا | لا | محيَّد |
| دفع التزام (`cash`) | لا | نعم | مصروف |
| دفع التزام (`accrual`) | لا | لا (اعتُرف سابقاً) | محيَّد |
| تخصيص لهدف | لا | لا | محيَّد (داخل حقوق الملكية) |
| تسوية | لا | لا | محيَّد (مقابل `equity.adjustment`) |
| احتساب زكاة | لا | لا | محيَّد — خصم مستحق فقط (القسم 15.4) |
| دفع زكاة | لا | نعم (`expense.charity`) | مصروف |
| عكس | يعكس الأصل | يعكس الأصل | يُصفِّر أثر الأصل |

**الضمان:** لا يوجد في النظام أي شرط `if (kind === 'transfer') skip` في منطق التقارير. استبعاد التحويل
من المصروفات ليس قراراً برمجياً بل **نتيجة لعدم وجود حساب مصروف في القيد**. حقل `kind` للعرض والتصفية
والتدقيق فقط، **ولا يُستخدم أبداً في حساب رقم**.

---

## 8. منع الرصيد السالب والسداد الزائد والحركة اليتيمة

### 8.1 أخطاء النطاق (بالعربية، في مكان واحد)

```ts
// domain/errors.ts
export type DomainErrorCode =
  | 'UNBALANCED_ENTRY' | 'TOO_FEW_LINES' | 'NON_POSITIVE_AMOUNT' | 'NON_INTEGER_AMOUNT'
  | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_NOT_POSTABLE' | 'ACCOUNT_ARCHIVED' | 'ACCOUNT_TYPE_MISMATCH'
  | 'NEGATIVE_BALANCE_NOT_ALLOWED'
  | 'OVERPAYMENT' | 'OVER_COLLECTION'
  | 'ORPHAN_REFERENCE' | 'OP_ID_CONFLICT' | 'ENTRY_NOT_POSTED' | 'ENTRY_ALREADY_REVERSED'
  | 'CANNOT_REVERSE_REVERSAL' | 'DEBT_HAS_SETTLEMENTS'
  | 'PERIOD_LOCKED' | 'SAME_ACCOUNT_TRANSFER' | 'CURRENCY_MISMATCH'
  | 'SCHEMA_VERSION_AHEAD';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly messageAr: string,
    readonly details?: Record<string, unknown>,
    readonly retryable: boolean = false
  ) { super(code); }
}
```

جدول الرسائل العربية (القسم 25 بند 18) — نماذج:
`NEGATIVE_BALANCE_NOT_ALLOWED` → «رصيد الحساب «{accountName}» لا يكفي. المتاح {available} والمطلوب {required}.»
`OVERPAYMENT` → «المبلغ أكبر من المتبقي. المتبقي على «{name}» هو {remaining}.»

### 8.2 الرصيد السالب غير المسموح

| الطبقة | الإجراء |
|---|---|
| الواجهة (استباقي) | عرض الرصيد المتاح بجانب حقل المبلغ، وتحذير لحظي عند التجاوز. **ليست حماية** (القسم 20) |
| طبقة النطاق | `assertSufficientBalance(account, requiredMinor)` داخل `planOperation` على **الدلتا الصافية** |
| المعاملة | الفحص يتم على القيمة المقروءة **داخل** `runTransaction` ⇒ لا سبق شرطي (race) بين جهازين |
| Firestore Rules | **لا تستطيع** الفحص (يحتاج حساباً عبر مستندين). دور Rules: منع الكتابة من غير المسار المعتمد (12.2) |

```ts
export function assertSufficientBalance(acc: Account, outflowMinor: Minor): void {
  if (acc.allowNegative) return;
  const after = (acc.balanceMinor - outflowMinor) as Minor;
  if (after < 0) throw new DomainError('NEGATIVE_BALANCE_NOT_ALLOWED', /* … */);
}
```

**ما يُفحص وما لا يُفحص:**
- يُفحص: `asset` بـ `isCashLike === true` و`allowNegative === false` (النقد، المصرف، المحفظة).
- لا يُفحص: حسابات `expense`/`income`/`equity` (لا معنى لسلبها)، و`receivable`/`payable` (سلبها يُمنع بفحص
  السداد الزائد لا بفحص الرصيد)، والحسابات بـ `allowNegative: true` (بطاقة ائتمانية أو سحب على المكشوف).
- **الاستيراد التاريخي** يتخطى الفحص (`skipBalanceGuard: true`) لأن ترتيب الإدخال قد يخالف ترتيب التاريخ،
  ويُشغَّل `auditAccount` بعده مع تقرير بأي لحظة سلبية تاريخية — إبلاغ لا منع.

### 8.3 السداد/التحصيل الزائد عن المستحق

```ts
export function assertNotOverSettled(
  target: { nameAr: string; totalMinor: Minor; settledMinor: Minor; allowOver: boolean },
  deltaMinor: Minor
): void {
  const remaining = (target.totalMinor - target.settledMinor) as Minor;
  if (!target.allowOver && deltaMinor > remaining) throw new DomainError('OVERPAYMENT', /* … */);
}
```

**القواعد الصلبة:**
1. `remainingMinor` **لا يُقرأ من المستند للفحص**، بل يُحسب `totalMinor - paidMinor` من نفس اللقطة المقروءة
   في المعاملة. المخزَّن للعرض والاستعلام فقط. (يُحصِّن ضد انحراف المشتق المخزَّن.)
2. الديون (`payable` و`receivable`): `allowOverSettle = false` **ثابت غير قابل للتفعيل**. دفع أكثر من الدين
   ليس سداداً زائداً بل عمليتان (سداد + إقراض جديد)، وعلى الواجهة أن تقترح ذلك صراحةً.
3. الالتزامات: `allowOver` مسموح **فقط** عند `isVariableAmount === true` (كهرباء/ماء) **وبإقرار المستخدم
   في نفس الطلب** (`confirmOverpay: true`)، ووقتها يُرفع `totalMinor` إلى المبلغ الفعلي
   ويُسجَّل `auditLogs` بسبب التغيير. هذا يمنع «تجاوز صامت» ويحترم القسم 19.
4. السداد الصفري أو السالب مرفوض (`NON_POSITIVE_AMOUNT`).
5. أقساط: `X ≤ installment.amountMinor - installment.paidMinor` بالإضافة إلى فحص الإجمالي.

### 8.4 الحركة اليتيمة (orphan) — خمس طبقات

| # | نوع اليُتم | المنع |
|---|---|---|
| 1 | سطر بلا قيد / قيد بلا سطور | **مستحيل بنيوياً**: السطور مضمَّنة في المستند (2.4) |
| 2 | قيد غير متوازن | `assertBalanced()` في النطاق + فحص `totalDebitMinor == totalCreditMinor` و`lines.size() >= 2` في Rules |
| 3 | سطر يشير إلى حساب غير موجود/مؤرشف/غير قابل للترحيل | كل الحسابات المرجوّة تُقرأ في `readPhase` وتُفحَص؛ غيابها ⇒ `ACCOUNT_NOT_FOUND`. ولأن `tx.get` لا يقبل استعلامات، المعرّفات تأتي من لقطة الحسابات الحيّة (`onSnapshot`) ثم **تُعاد قراءتها** في المعاملة |
| 4 | قيد يشير إلى التزام/دين/هدف غير موجود (`refs`) | المرجع يُقرأ في `readPhase` إلزامياً؛ غيابه ⇒ `ORPHAN_REFERENCE` |
| 5 | التزام/دين «مسدَّد» بلا قيود تدعمه، أو قيود بلا أثر في المُجمَّع | فاحص الاتساق الدوري (3.5) + `balanceVersion`/`entryCount` + ميزان المراجعة I4 |

**عملية غير مكتملة (القسم 19 سطر 209):** غير ممكنة لأن الترحيل كله في معاملة ذرّية واحدة.
الحالة الوحيدة المتبقية هي عملية **لم تُرسَل** (في الصندوق الصادر)، وهي معروضة بوضوح كـ«بانتظار المزامنة»
ومستبعدة من كل الأرصدة والتقارير.

---

## 9. تكلفة Firestore

### 9.1 تسجيل مصروف واحد (الحالة الأكثر تكراراً)

**قبل المعاملة:** 0 قراءات — الحسابات والفئات والميزانية الحالية مُحمَّلة عبر `onSnapshot` عند بدء التطبيق
(قراءات مدفوعة مرة واحدة في الجلسة، ثم دلتا فقط).

**داخل المعاملة:**

| # | القراءة (`tx.get`) | ضرورية لماذا |
|---|---|---|
| 1 | `journalEntries/{opId}` | منع الازدواج |
| 2 | `accounts/{cashAccountId}` | فحص الرصيد + تحديث ذرّي |
| 3 | `accounts/{expenseAccountId}` | تحديث ذرّي + التحقق من النوع والحالة |
| 4 | `budgetPeriods/{periodKey}` | حدّ الفئة + منع تكرار التنبيه |
| **4 قراءات** | | |

| # | الكتابة | ملاحظة |
|---|---|---|
| 1 | `journalEntries/{opId}` (create) | القيد بسطوره |
| 2 | `accounts/{cashAccountId}` (update) | |
| 3 | `accounts/{expenseAccountId}` (update) | |
| 4 | `accountPeriods/{cash}__{pk}` (set merge) | |
| 5 | `accountPeriods/{expense}__{pk}` (set merge) | |
| 6 | `periods/{pk}` (set merge) | نقطة الازدحام |
| 7 | `budgetPeriods/{pk}` (update) | يُحذف إن لا ميزانية للفئة |
| **7 كتابات** (6 بلا ميزانية) | | |

**المقارنة الصادقة بتصميم أحادي الجانب** (`transactions` بـ `accountId` و`amount` موقَّع):
3 قراءات / **4 كتابات** (عملية + حساب + فترة + ميزانية).
⇒ **القيد المزدوج يضيف ~3 كتابات وقراءة واحدة لكل مصروف (+75% كتابات).**

**هل هذا مقبول؟**
- Spark: 20,000 كتابة/يوم ⇒ **~2,850 مصروف/يوم** لمستخدم واحد. الاستخدام الواقعي 5–20 يومياً = **0.7‰**.
- لو صار النظام متعدد المستخدمين: 10,000 مستخدم × 10 عمليات = 700,000 كتابة/يوم
  ≈ **1.26 دولار/يوم** بسعر 0.18 دولار/100,000 كتابة. الفارق عن التصميم الأحادي ≈ 0.54 دولار/يوم.
- **الحكم:** تكلفة القيد المزدوج في Firestore **غير ذات دلالة مالية**. من يرفضه فليرفضه لتعقيده، لا لتكلفته.

**تحسين اختياري (−2 كتابات):** الاستغناء عن `accountPeriods` لحسابات المصروف والدخل والاعتماد على
`periods.expenseByCategory` للتحليل الشهري. يبقى `accountPeriods` للحسابات النقدية (لازم لرسم اتجاه الرصيد).
⇒ **5 كتابات/مصروف**. موصى به للإصدار الأول.

### 9.2 بقية العمليات

| العملية | قراءات | كتابات |
|---|---|---|
| دخل مستلم | 3 (opId، حساب نقدي، حساب دخل) | 5 (+1 إن مرتبط بجدول دخل متوقع) |
| تحويل بين حسابين | 3 | 6 (قيد + حسابان + فترتا حساب + `periods`) |
| تحويل بعمولة | 4 | 8 |
| دفع التزام | 5 (opId، نقدي، مصروف، التزام، ميزانية) | 8 (+1 لإنشاء الدورة التالية) |
| تحصيل دين | 4 (opId، نقدي، مستحق، دين) | 7 |
| سداد دين | 4 | 7 |
| إنشاء دين (أ) | 3 | 6 (+1 إنشاء حساب الخصم عند أول مرة) |
| تعديل عملية (عكس+بديل) | 7–9 | 9–11 |
| إلغاء عملية | 5–7 | 7–9 |
| تخصيص لهدف | 4 | 6 |
| تهيئة شجرة الحسابات (مرة واحدة) | 0 | ~45 |

### 9.3 فتح لوحة التحكم (القسم 4)

| البطاقة/المصدر | قراءات |
|---|---|
| `accounts` (كل الشجرة، `onSnapshot`) — يغذّي: الأموال المتاحة، المستحق لي، الديون عليّ، صافي الثروة، أرصدة الحسابات | ~45 (مرة واحدة في الجلسة؛ لاحقاً دلتا فقط) |
| `periods/{currentPk}` — الدخل، المصروف، صافي التدفق، المصروف حسب الفئة، مصاريف المنزل | 1 |
| `periods` ×11 شهراً سابقاً — مخطط الاتجاه | 11 (يُخزَّن محلياً؛ الأشهر المنتهية لا تتغير ⇒ 0 لاحقاً) |
| `budgetPeriods/{currentPk}` — نسبة استهلاك الميزانية | 1 |
| `obligations where status in [due, overdue] order by dueDate limit 10` | ≤10 |
| `obligations where dueDate <= +7d limit 10` (القادمة) | ≤10 |
| `financialGoals where status == 'active' limit 5` | ≤5 |
| `tasks where dueDate == today limit 10` | ≤10 |
| `notifications where read == false order by createdAt desc limit 10` | ≤10 |
| `settings/dashboard` (ترتيب البطاقات) | 1 |
| **الإجمالي: أول فتحة ≈ 104 قراءة. الفتحات التالية في نفس الجلسة ≈ 0–5** | |

على Spark (50,000 قراءة/يوم) ⇒ **~480 فتحة باردة يومياً**. مريح جداً.
**لو حُسبت الأرصدة من القيود بدلاً من المُجمَّع:** ~3,000+ قراءة للفتحة الواحدة ⇒ 16 فتحة/يوم. **مرفوض.**

### 9.4 تكلفة التقارير

| التقرير | قراءات |
|---|---|
| ملخص شهري | 1 (`periods/{pk}`) |
| ملخص سنوي | 12 |
| كشف حركة حساب (صفحة 25) | 25 |
| تقرير مصروفات مُفصَّل لشهر | عدد قيود الشهر (~150–500) |
| تقرير مصروفات مُفصَّل لسنة | عدد قيود السنة (~1,800–6,000) ⇒ **يُنصح بالتجميع من `periods` والتنقّل للتفصيل** |
| عدد القيود في نطاق | `getCountFromServer()` = قراءة واحدة لكل 1,000 مُدخل فهرس (متاح على Spark) |

**تذكير بالعيب:** `sum()` aggregation لا يعمل على `lines` المضمَّنة ⇒ لا مجموع خادمي للمبالغ.
`count()` يعمل. هذا هو الثمن الذي قبلناه في 2.4.

### 9.5 الفهارس المركَّبة المطلوبة

```
journalEntries:  accountIds (array-contains) + bookedAtTs DESC
journalEntries:  status (==) + bookedAtTs DESC
journalEntries:  periodKey (==) + kind (==) + bookedAtTs DESC
journalEntries:  refs.obligationId (==) + bookedAtTs DESC
journalEntries:  refs.debtId (==) + bookedAtTs DESC
journalEntries:  refs.goalId (==) + bookedAtTs DESC
journalEntries:  correctionGroupId (==) + createdAt ASC
journalEntries:  tags (array-contains) + bookedAtTs DESC
journalEntries:  accountIds (array-contains) + periodKey (==) + bookedAtTs DESC
accounts:        type (==) + status (==) + sortOrder ASC
accounts:        isCashLike (==) + status (==) + sortOrder ASC
accountPeriods:  accountId (==) + periodKey DESC
obligations:     status (==) + dueDate ASC
obligations:     dueDate ASC + status (==)
debts:           direction (==) + status (==) + expectedSettleAt ASC
operations:      kind (==) + createdAt DESC
```
**استثناءات الفهرسة الأحادية (لتقليل تكلفة الكتابة):** إلغاء فهرسة `lines` و`description`
و`attachmentIds` و`payloadHash` و`ancestorIds` — لا نستعلم عليها، وكل حقل مفهرس يزيد تكلفة الكتابة.

---

## 10. أمثلة ملموسة: تسلسل الكتابات بالضبط

**الثوابت في الأمثلة:** `uid = U`، التاريخ `2026-10-09`، `periodKey = '2026-10'`، الفترة غير مُقفلة.

### (أ) مصروف 25.500 د.ل من حساب نقدي

**المدخل:** `25500` درهم، الفئة «الطعام والمشروبات» (`cat_food` → `acc_exp_food`)، الحساب `acc_cash_main`
(رصيده قبل العملية `340000` = 340.000 د.ل)، الوصف «غداء»، وسم `personal`.
`opId = '7f3c…a91'` (مُولَّد عند تركيب النموذج)، ميزانية الطعام `limit=200000`, `spent=118000`.

```
قبل المعاملة (لا قراءات مدفوعة):
  bookedAt = '2026-10-09'; periodKey = '2026-10'; payloadHash = sha256(canonicalize(payload))
  entry = buildEntry({...})   // في طبقة النطاق، مع assertBalanced

runTransaction:
  ── readPhase ──
  R1 get journalEntries/7f3c…a91              → غير موجود ✓
  R2 get accounts/acc_cash_main               → { balanceMinor: 340000, allowNegative: false, isPostable: true }
  R3 get accounts/acc_exp_food                → { type:'expense', status:'active', isPostable: true }
  R4 get budgetPeriods/2026-10                → { categories: { cat_food: { limitMinor:200000, spentMinor:118000,
                                                   alertAtPercent:80, alertFiredAtPercent: null } } }
  R5 get accountPeriods/acc_cash_main__2026-10 → { closingBalanceMinor: 340000, debitMinor: 500000, creditMinor: 160000 }

  ── plan (نقي) ──
  assertSufficientBalance(340000, 25500) → 314500 ≥ 0 ✓
  spentAfter = 118000 + 25500 = 143500 ; 143500/200000 = 71.75% < 80% ⇒ لا تنبيه

  ── writePhase ──
  W1 set journalEntries/7f3c…a91 {
       id:'7f3c…a91', opId:'7f3c…a91', schemaVersion:1, ownerUid:'U',
       kind:'expense', status:'posted',
       bookedAt:'2026-10-09', bookedAtTs:<2026-10-09T12:00Z>, periodKey:'2026-10',
       description:'غداء',
       lines:[
         { lineNo:1, accountId:'acc_exp_food',  accountType:'expense', accountCode:'expense.food',
           side:'debit',  amountMinor:25500, categoryId:'cat_food' },
         { lineNo:2, accountId:'acc_cash_main', accountType:'asset',   accountCode:'asset.cash.main',
           side:'credit', amountMinor:25500 }
       ],
       accountIds:['acc_exp_food','acc_cash_main'], accountTypes:['expense','asset'],
       totalDebitMinor:25500, totalCreditMinor:25500, amountMinor:25500, currency:'LYD',
       tags:['personal'], refs:{}, payloadHash:'…',
       createdAt: serverTimestamp(), createdBy:'U', clientCreatedAt:'2026-10-09T…', deviceId:'dev_a'
     }
  W2 update accounts/acc_cash_main {
       creditTotalMinor: increment(25500), balanceMinor: increment(-25500),
       entryCount: increment(1), balanceVersion: increment(1),
       lastEntryId:'7f3c…a91', lastPostedAt: serverTimestamp(), updatedAt: serverTimestamp() }
     // الرصيد بعدها: 314500
  W3 update accounts/acc_exp_food {
       debitTotalMinor: increment(25500), balanceMinor: increment(25500),
       entryCount: increment(1), balanceVersion: increment(1), lastEntryId:'7f3c…a91', … }
  W4 set accountPeriods/acc_cash_main__2026-10 (merge) {
       accountId:'acc_cash_main', accountType:'asset', periodKey:'2026-10',
       openingBalanceMinor: 0 /* موجود مسبقاً، لا يُلمس */,
       creditMinor: increment(25500), closingBalanceMinor: increment(-25500),
       entryCount: increment(1), updatedAt: serverTimestamp() }
  W5 set accountPeriods/acc_exp_food__2026-10 (merge) {
       debitMinor: increment(25500), closingBalanceMinor: increment(25500), entryCount: increment(1), … }
       // (قابلة للإلغاء وفق تحسين 9.1)
  W6 set periods/2026-10 (merge) {
       periodKey:'2026-10',
       totalExpenseMinor: increment(25500),
       'expenseByCategory.cat_food': increment(25500),
       netCashFlowMinor: increment(-25500),
       entryCount: increment(1), lastEntryAt:'2026-10-09', updatedAt: serverTimestamp() }
       // لا تحديث على householdExpenseMinor لأن الوسم 'personal'
  W7 update budgetPeriods/2026-10 {
       'categories.cat_food.spentMinor': increment(25500),
       overallSpentMinor: increment(25500), updatedAt: serverTimestamp() }

النتيجة: 5 قراءات / 7 كتابات.  النقد المتاح: 340.000 → 314.500 د.ل.
PostResult = { opId, entryIds:['7f3c…a91'], alreadyApplied:false,
               balancesAfter:{ acc_cash_main: 314500 }, warnings: [] }
```

> **الضغط مرتين:** المحاولة الثانية تتوقف عند `R1` (القيد موجود، `payloadHash` مطابق) وتُرجع
> `{ alreadyApplied: true }` بـ **0 كتابات**. لا رسالة خطأ، لا قيد ثانٍ.

### (ب) سداد جزئي 200 د.ل لالتزام إيجار قيمته 800

**المدخل:** `obl_rent` بـ `totalMinor=800000`, `paidMinor=0`, `remainingMinor=800000`,
`categoryId='cat_home_rent'` (→ `acc_exp_rent`), `dueDate='2026-10-05'` (⇒ متأخر اليوم),
`accounting:'cash'`, `recurrence: monthly`. الدفع `200000` من `acc_bank_jm` (رصيده `1500000`).
`opId = 'c21b…04f'`.

```
runTransaction:
  ── readPhase ──
  R1 get journalEntries/c21b…04f                 → غير موجود ✓
  R2 get accounts/acc_bank_jm                    → { balanceMinor: 1500000, allowNegative:false }
  R3 get accounts/acc_exp_rent                   → { type:'expense', status:'active' }
  R4 get obligations/obl_rent                    → { totalMinor:800000, paidMinor:0, status:'overdue',
                                                     isVariableAmount:false, recurrence:{freq:'monthly'} }
  R5 get budgetPeriods/2026-10                   → { categories:{ cat_home_rent:{limitMinor:800000, spentMinor:0,
                                                       alertAtPercent:80, alertFiredAtPercent:null} } }
  R6 get accountPeriods/acc_bank_jm__2026-10     → موجود

  ── plan ──
  remaining = 800000 - 0 = 800000
  assertNotOverSettled: 200000 ≤ 800000 ✓          ← منع السداد الزائد
  assertSufficientBalance: 1500000 - 200000 = 1300000 ≥ 0 ✓
  paidAfter = 200000 ; remainingAfter = 600000 ⇒ status: dueDate(2026-10-05) < today ⇒ 'overdue'
     (جزئي + متأخر ⇒ 'overdue' له الأسبقية في العرض، و partiallyPaid يُعرض كشارة ثانية)
  budget: 200000/800000 = 25% < 80% ⇒ لا تنبيه
  recurrence: remainingAfter > 0 ⇒ **لا تُنشأ الدورة التالية الآن** (تُنشأ عند اكتمال السداد)

  ── writePhase ──
  W1 set journalEntries/c21b…04f {
       kind:'obligationPayment', status:'posted', bookedAt:'2026-10-09', periodKey:'2026-10',
       description:'سداد جزئي — إيجار المنزل',
       lines:[
         { lineNo:1, accountId:'acc_exp_rent', accountType:'expense', side:'debit',
           amountMinor:200000, categoryId:'cat_home_rent' },
         { lineNo:2, accountId:'acc_bank_jm',  accountType:'asset',   side:'credit', amountMinor:200000 }
       ],
       accountIds:['acc_exp_rent','acc_bank_jm'],
       totalDebitMinor:200000, totalCreditMinor:200000, amountMinor:200000,
       tags:['household'],                              ← الإيجار مصروف منزلي
       refs:{ obligationId:'obl_rent' },  payloadHash:'…', … }
  W2 update accounts/acc_bank_jm   { creditTotalMinor:+200000, balanceMinor:-200000, entryCount:+1, … }
     // 1,500.000 → 1,300.000
  W3 update accounts/acc_exp_rent  { debitTotalMinor:+200000, balanceMinor:+200000, entryCount:+1, … }
  W4 set accountPeriods/acc_bank_jm__2026-10 (merge) { creditMinor:+200000, closingBalanceMinor:-200000, … }
  W5 set accountPeriods/acc_exp_rent__2026-10 (merge){ debitMinor:+200000,  closingBalanceMinor:+200000, … }
  W6 set periods/2026-10 (merge) {
       totalExpenseMinor:+200000,
       'expenseByCategory.cat_home_rent':+200000,
       householdExpenseMinor:+200000,      ← مجموع فرعي من نفس المبلغ، لا إضافة ثانية (القسم 11)
       obligationPaidMinor:+200000,
       netCashFlowMinor:-200000, entryCount:+1, … }
  W7 update budgetPeriods/2026-10 {
       'categories.cat_home_rent.spentMinor':+200000, overallSpentMinor:+200000, … }
  W8 update obligations/obl_rent {
       paidMinor: 200000, remainingMinor: 600000,       ← قيم مطلقة محسوبة، لا increment
       paymentCount: increment(1), lastPaymentEntryId:'c21b…04f',
       status:'overdue', statusComputedFor:'2026-10-09', updatedAt: serverTimestamp() }
  W9 set notifications/{autoId} {
       type:'obligationPartiallyPaid', severity:'info', read:false,
       titleAr:'سُدِّد جزئياً: إيجار المنزل',
       bodyAr:'سُدِّد 200.000 د.ل، والمتبقي 600.000 د.ل.',
       linkRef:{ collection:'obligations', id:'obl_rent' }, createdAt: serverTimestamp() }

النتيجة: 6 قراءات / 9 كتابات.
لو كان المبلغ 900.000 ⇒ خطأ OVERPAYMENT قبل أي كتابة: «المبلغ أكبر من المتبقي. المتبقي 800.000 د.ل.»
لو أُكمل السداد لاحقاً (600.000) ⇒ status:'paid' + كتابة إضافية تُنشئ دورة نوفمبر بـ opId حتمي
   'obl:obl_rent:2026-11-05' ⇒ لا دورة مكرَّرة مهما تكرر التنفيذ.
```

**ملاحظة مهمة على `paidMinor`:** تُكتب كقيمة **مطلقة محسوبة** (`200000`) لا كـ `increment(200000)`،
لأننا قرأنا القيمة داخل المعاملة وحسبنا عليها الفحص؛ استخدام `increment` هنا يفتح فجوة بين
القيمة التي فُحصت والقيمة التي كُتبت. أما `periods` و`accounts` فيستخدمان `increment` **لأننا لا نفحص
قيمتها** (عدا الرصيد الذي نقرأه ونفحصه، ثم `increment` آمن لأن المعاملة تُعيد المحاولة عند أي تغيّر).

### (ج) تحصيل 150 د.ل من دين لي قيمته 400 إلى حساب مصرفي

**المدخل:** `debt_ahmed` بـ `direction:'receivable'`, `principalMinor=400000`, `settledMinor=0`,
`accountId='acc_recv_ahmed'` (رصيده `400000`), `status:'open'`.
التحصيل `150000` إلى `acc_bank_jm` (رصيده `1300000` بعد المثال ب). `opId = '9ad0…77e'`.

```
runTransaction:
  ── readPhase ──
  R1 get journalEntries/9ad0…77e               → غير موجود ✓
  R2 get accounts/acc_bank_jm                  → { balanceMinor: 1300000, isCashLike:true }
  R3 get accounts/acc_recv_ahmed               → { type:'asset', subtype:'receivable',
                                                   isCashLike:false, balanceMinor: 400000 }
  R4 get debts/debt_ahmed                      → { direction:'receivable', principalMinor:400000,
                                                   settledMinor:0, status:'open', allowOverSettle:false }
  R5 get accountPeriods/acc_bank_jm__2026-10   → موجود

  ── plan ──
  remaining = 400000 - 0 = 400000
  assertNotOverSettled: 150000 ≤ 400000 ✓            ← منع التحصيل الزائد
  لا فحص رصيد سالب على acc_bank_jm (يزيد)
  فحص إضافي: acc_recv_ahmed.balanceMinor (400000) ≥ 150000 ✓   ← يمنع حساب مستحق سالب
  settledAfter = 150000 ; remainingAfter = 250000 ⇒ status:'partiallySettled'
  لا مساس بالميزانية ولا بالدخل                       ← القاعدة 19.7 و 19.11

  ── writePhase ──
  W1 set journalEntries/9ad0…77e {
       kind:'debtCollection', status:'posted', bookedAt:'2026-10-09', periodKey:'2026-10',
       description:'تحصيل من أحمد',
       lines:[
         { lineNo:1, accountId:'acc_bank_jm',    accountType:'asset', accountCode:'asset.bank.jm',
           side:'debit',  amountMinor:150000 },
         { lineNo:2, accountId:'acc_recv_ahmed', accountType:'asset', accountCode:'asset.receivable.ahmed',
           side:'credit', amountMinor:150000, contactId:'ct_ahmed' }
       ],
       accountIds:['acc_bank_jm','acc_recv_ahmed'], accountTypes:['asset'],
       totalDebitMinor:150000, totalCreditMinor:150000, amountMinor:150000,
       tags:[], refs:{ debtId:'debt_ahmed', debtDirection:'receivable' }, payloadHash:'…', … }
  W2 update accounts/acc_bank_jm    { debitTotalMinor:+150000,  balanceMinor:+150000, entryCount:+1, … }
     // 1,300.000 → 1,450.000
  W3 update accounts/acc_recv_ahmed { creditTotalMinor:+150000, balanceMinor:-150000, entryCount:+1, … }
     // 400.000 → 250.000
  W4 set accountPeriods/acc_bank_jm__2026-10    (merge) { debitMinor:+150000,  closingBalanceMinor:+150000, … }
  W5 set accountPeriods/acc_recv_ahmed__2026-10 (merge) { creditMinor:+150000, closingBalanceMinor:-150000, … }
  W6 set periods/2026-10 (merge) {
       collectedMinor:+150000, entryCount:+1, … }
       // **totalIncomeMinor بلا تغيير** و **netCashFlowMinor بلا تغيير**:
       //   التحصيل ليس دخلاً، وصافي التدفق التشغيلي لا يتضمنه.
       //   (بطاقة «الأموال المتاحة» ترتفع 150.000 من لقطة الحسابات، لا من periods)
  W7 update debts/debt_ahmed {
       settledMinor: 150000, remainingMinor: 250000,      ← قيم مطلقة
       settlementCount: increment(1), lastSettlementEntryId:'9ad0…77e',
       status:'partiallySettled', updatedAt: serverTimestamp() }
  W8 set notifications/{autoId} {
       type:'debtCollected', severity:'info', read:false,
       titleAr:'تحصيل من أحمد', bodyAr:'حُصِّل 150.000 د.ل، والمتبقي 250.000 د.ل.',
       linkRef:{ collection:'debts', id:'debt_ahmed' }, createdAt: serverTimestamp() }

النتيجة: 5 قراءات / 8 كتابات.
الأثر الكلي:  الأموال المتاحة +150.000 | المستحق لي −150.000 | صافي الثروة **بلا تغيير**
              الدخل بلا تغيير | المصروف بلا تغيير | الميزانية بلا تغيير
```

**هذا المثال هو البرهان العملي على قيمة القيد المزدوج:** في تصميم أحادي الجانب كان لا بد من حقل
`excludeFromIncome: true` على العملية وشرط في كل تقرير يحترمه. هنا، لأن طرفي القيد كلاهما `asset`،
**لا يوجد حساب دخل في القيد أصلاً**، فاستبعاده من الدخل ليس قراراً بل حقيقة بنيوية.

---

## 11. العمل على خطة Spark، والتحسينات عند الترقية إلى Blaze

### 11.1 ما يتطلب Blaze، والبديل على Spark

| القدرة | يتطلب Blaze؟ | البديل على Spark (المعتمد في الإصدار الأول) | الخسارة المقبولة |
|---|---|---|---|
| تنفيذ المصروف/الدخل المتكرر | Cloud Scheduler + Functions ⇒ **نعم** | **مُشغِّل استدراك في العميل** (`runRecurringCatchUp`) يعمل عند كل تسجيل دخول وعند تغيّر اليوم، بـ `opId` حتمي `rec:{id}:{date}` | القيد لا يُنشأ إلا عند فتح التطبيق. التاريخ المحاسبي `bookedAt` = تاريخ الاستحقاق الصحيح لا تاريخ التنفيذ ⇒ **التقارير سليمة**، والتأخير في الظهور فقط |
| فحص الاتساق وميزان المراجعة | Scheduled Function ⇒ نعم | تشغيل في العميل عند تسجيل الدخول (`auditTrialBalance`، رخيص) + فحص كامل بطلب المستخدم | لا شيء جوهري لمستخدم واحد |
| تذكيرات الاستحقاق المجدولة (Push) | FCM من الخادم ⇒ نعم | حساب التنبيهات في العميل عند فتح التطبيق + `Notification API` للمتصفح عند منح الإذن (القسم 14) | لا تنبيه والتطبيق مغلق |
| التحقق الموثوق من صحة العمليات على الخادم | Functions ⇒ نعم | **Firestore Rules تحمل أكبر حمل ممكن** (12.2) + طبقة النطاق في العميل | عميل متلاعب نظرياً قادر على كتابة قيد متوازن بقيم خاطئة محاسبياً (مثلاً مصروف من حساب بلا رصيد). **المخاطرة مقبولة لأن المستخدم هو المالك الوحيد لبياناته؛ لكنها غير مقبولة عند تعدد المستخدمين** |
| مرفقات الإيصالات (Storage) | **نعم** (Storage يتطلب Blaze في المشاريع الحديثة) | **تأجيل الميزة** مع زر معطّل وشرح عربي: «يتطلب ترقية الخطة». حل بديل مؤقت: حقل `receiptNote` نصي + رابط خارجي يُدخله المستخدم | لا صور إيصالات. **يُرفض** حفظ Base64 في Firestore (سقف 1MB، تضخيم القراءات، تكلفة فهرسة) |
| تصدير PDF من الخادم | Functions ⇒ نعم | توليد في العميل (`jsPDF`/`print`) و CSV/Excel في العميل | جودة أقل في التنسيق المعقّد |
| Cloud Tasks (مهام مؤجلة) | نعم | غير مطلوب في هذا التصميم إطلاقاً | — |
| `count()` / نطاقات الاستعلام / المعاملات / القواعد / الفهارس المركَّبة | **لا** — متاحة على Spark | — | — |

### 11.2 طبقة التحسين عند الترقية (بلا إعادة تصميم)

التصميم أعلاه **لا يتغير** عند الترقية؛ تُضاف طبقة فقط:

1. `onDocumentCreated('users/{uid}/journalEntries/{id}')` **مُراقِب تحقّق** (لا يكتب الأرصدة): يعيد فحص
   التوازن والمراجع ويضع `verifiedAt` أو يرفع `integrityAlerts`. **مهم:** لا يُحوَّل تحديث الأرصدة إلى
   وظيفة سحابية، لأن ذلك يُدخل حالة وسطى (قيد مكتوب وأثره لم يُطبَّق) تناقض القسم 18.
2. `onSchedule('every day 00:05')`: تنفيذ المتكررات + تحديث حالات الالتزامات + ميزان المراجعة + تنبيهات FCM.
3. Storage + Rules للمرفقات (حد 5MB، أنواع `image/jpeg|png|webp|application/pdf`، التحقق من الملكية).
4. `postOperation` خلف `onCall` موثوق (للنشر متعدد المستخدمين) مع إبقاء نفس `planOperation` النقية
   **كملف مشترك** بين العميل والخادم ⇒ لا تكرار منطق (القسم 25 بند 7).
5. اختيارياً: مجموعة `postings` المسطَّحة للاستفادة من `sum()` (انظر 2.4).

### 11.3 مُشغِّل الاستدراك — التوقيع

```ts
// domain/recurring/catchUp.ts
export interface CatchUpPlanItem {
  recurringId: string;
  occurrenceKey: string;      // 'YYYY-MM-DD' تاريخ الاستحقاق
  opId: string;               // `rec:${recurringId}:${occurrenceKey}`
  request: OperationRequest;
}
/** نقية: تحسب كل المواعيد المستحقة حتى today، بحد أقصى maxBackfillDays لتجنب فيضان بعد غياب طويل. */
export function planCatchUp(
  recurrings: RecurringRule[], today: string, maxBackfillDays?: number
): CatchUpPlanItem[];

/** يُنفِّذ تسلسلياً عبر postOperation. alreadyApplied متوقَّع وطبيعي ولا يُعرض كخطأ. */
export async function runCatchUp(ctx: PostContext, items: CatchUpPlanItem[]): Promise<CatchUpReport>;
```
**حد الاستدراك:** `maxBackfillDays = 120` افتراضياً. ما قبله يُعرض للمستخدم كقائمة «مواعيد فائتة»
يختار منها، لأن إنشاء 300 قيد صامت بعد غياب شهور سلوك سيئ.

---

## 12. الأمان: قواعد تفرض الثوابت المحاسبية

### 12.1 الهيكل

كل شيء تحت `users/{uid}/…` ⇒ عزل بيانات المستخدم بشرط واحد في الجذر. والهيكل جاهز لتعدد المستخدمين
دون إعادة تصميم (القسم 20): إضافة `households/{hid}` بعضوية صريحة لاحقاً لا تمسّ شكل القيود.

### 12.2 قواعد Firestore (مسوّدة للمراجعة — لا تُنشر قبل الاختبار بالمحاكي والموافقة، القسم 25 بند 10)

```javascript
rules_version = '2';
service cloud.firestore {
  function isOwner(uid) { return request.auth != null && request.auth.uid == uid; }

  function isPosInt(v) { return v is int && v > 0; }

  function entryShapeOk(d) {
    return d.keys().hasAll(['opId','kind','status','bookedAt','periodKey','lines',
                            'accountIds','totalDebitMinor','totalCreditMinor','currency',
                            'ownerUid','schemaVersion','payloadHash','description'])
      && d.currency == 'LYD'
      && d.schemaVersion is int && d.schemaVersion >= 1
      && d.status == 'posted'                                   // لا يُنشأ قيد بأي حالة أخرى
      && d.lines is list && d.lines.size() >= 2 && d.lines.size() <= 50
      && isPosInt(d.totalDebitMinor)
      && d.totalDebitMinor == d.totalCreditMinor                // ← الثابت I1 مفروض من الخادم
      && d.accountIds is list && d.accountIds.size() >= 2
      && d.description is string && d.description.size() > 0 && d.description.size() <= 500
      && d.bookedAt is string && d.bookedAt.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      && d.periodKey is string && d.periodKey.matches('^[0-9]{4}-[0-9]{2}$')
      && d.periodKey == d.bookedAt[0:7];                        // تماسك الفترة مع التاريخ
  }

  match /databases/{database}/documents {

    match /users/{uid} {
      allow read, write: if isOwner(uid);

      // ── القيود: إنشاء بشروط، تحديث محصور، لا حذف أبداً ──
      match /journalEntries/{entryId} {
        allow read:   if isOwner(uid);
        allow create: if isOwner(uid)
                      && request.resource.data.ownerUid == uid
                      && entryId == request.resource.data.opId.split('__')[0] ||
                         entryId == request.resource.data.opId          // المعرّف = opId (أو فرعه)
                      && entryShapeOk(request.resource.data)
                      && !exists(/databases/$(database)/documents/users/$(uid)/periodLocks/$(request.resource.data.periodKey));
        // لا تعديل محاسبي: المبالغ والسطور والحسابات والتاريخ والنوع ثابتة إلى الأبد
        allow update: if isOwner(uid)
                      && request.resource.data.diff(resource.data).affectedKeys()
                           .hasOnly(['status','reversedByEntryId','replacedByEntryId',
                                     'correctionGroupId','updatedAt',
                                     'description','tags','attachmentIds'])
                      && request.resource.data.totalDebitMinor == resource.data.totalDebitMinor
                      && request.resource.data.lines == resource.data.lines
                      && request.resource.data.bookedAt == resource.data.bookedAt
                      && request.resource.data.kind == resource.data.kind
                      && resource.data.kind != 'reversal';       // قيد العكس غير قابل للتعديل
        allow delete: if false;                                   // **لا حذف مالي مطلقاً**
      }

      // ── الحسابات: لا حذف، وحقول الأرصدة لا تُكتب إلا مع تقدّم balanceVersion ──
      match /accounts/{accountId} {
        allow read:   if isOwner(uid);
        allow create: if isOwner(uid)
                      && request.resource.data.ownerUid == uid
                      && request.resource.data.currency == 'LYD'
                      && request.resource.data.debitTotalMinor == 0
                      && request.resource.data.creditTotalMinor == 0
                      && request.resource.data.balanceMinor == 0
                      && request.resource.data.entryCount == 0
                      && request.resource.data.balanceVersion == 0
                      // المستحق لي لا يُعدّ نقداً متاحاً — القاعدة 19.9 مفروضة من الخادم
                      && (request.resource.data.subtype != 'receivable'
                          || request.resource.data.isCashLike == false);
        allow update: if isOwner(uid)
                      && request.resource.data.debitTotalMinor is int
                      && request.resource.data.creditTotalMinor is int
                      && request.resource.data.debitTotalMinor >= resource.data.debitTotalMinor
                      && request.resource.data.creditTotalMinor >= resource.data.creditTotalMinor
                      && request.resource.data.balanceVersion > resource.data.balanceVersion
                      && request.resource.data.type == resource.data.type
                      && request.resource.data.code == resource.data.code;
        allow delete: if false;                                   // الأرشفة بدل الحذف
      }

      match /periodLocks/{pk} {
        allow read:   if isOwner(uid);
        allow create: if isOwner(uid);
        allow update, delete: if false;                           // الإقفال نهائي
      }

      match /auditLogs/{logId} {
        allow read:   if isOwner(uid);
        allow create: if isOwner(uid) && request.resource.data.ownerUid == uid;
        allow update, delete: if false;                           // سجل تدقيق غير قابل للتلاعب
      }

      match /obligations/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.totalMinor is int && request.resource.data.totalMinor > 0
          && request.resource.data.paidMinor is int && request.resource.data.paidMinor >= 0
          && request.resource.data.paidMinor <= request.resource.data.totalMinor   // ← منع السداد الزائد
          && request.resource.data.remainingMinor ==
             request.resource.data.totalMinor - request.resource.data.paidMinor;    // ← الثابت I5
        allow delete: if false;
      }

      match /debts/{id} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && request.resource.data.principalMinor is int && request.resource.data.principalMinor > 0
          && request.resource.data.settledMinor is int && request.resource.data.settledMinor >= 0
          && request.resource.data.settledMinor <= request.resource.data.principalMinor  // ← I6
          && request.resource.data.remainingMinor ==
             request.resource.data.principalMinor - request.resource.data.settledMinor
          && request.resource.data.allowOverSettle == false;
        allow delete: if false;
      }
    }
  }
}
```

**ما تفرضه القواعد فعلاً (مهم جداً):** I1 (التوازن)، I2 (عدد السطور والأعداد الصحيحة الموجبة)،
I5 و I6 (منع السداد/التحصيل الزائد كثابت مستند، **من الخادم**)، عدم قابلية القيد للتغيير، منع الحذف المالي،
إقفال الفترات، و`isCashLike=false` للمستحقات.
**ما لا تستطيعه:** فحص الرصيد السالب، وصحة اتجاه القيد محاسبياً، وصحة تحديث المُجمَّعات — فهذه عبر
المعاملة في العميل اليوم، وعبر وظيفة موثوقة عند الترقية (11.2).
**ما لا يُفحَص في القواعد لعدم الجدوى:** المرور على `lines` حساباً حساباً (لغة القواعد بلا حلقات)؛
نكتفي بفحص الإجماليات المخزَّنة ونقبل أن يكون حسابها مسؤولية طبقة النطاق.

### 12.3 سجل التدقيق

```ts
// users/{uid}/auditLogs/{autoId}  — غير قابل للتعديل أو الحذف
export interface AuditLogEntry {
  id: string; ownerUid: string; schemaVersion: number;
  action: 'entryReversed' | 'entryAmended' | 'accountArchived' | 'accountCreated'
        | 'openingBalanceSet' | 'obligationTotalChanged' | 'overpayApproved'
        | 'balanceRepaired' | 'periodLocked' | 'descriptiveEditOnPostedEntry'
        | 'allowNegativeToggled' | 'dataExported' | 'migrationApplied';
  targetCollection: string; targetId: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
  reason?: string; opId?: string;
  at: Timestamp; by: string; deviceId?: string;
}
```
**قرار مبرَّر (انحراف عن القسم 18 بند 9):** لا نكتب `auditLogs` لكل عملية مالية، لأن **دفتر القيود نفسه
سجل تدقيق كامل** (غير قابل للتغيير، مُرقَّم بالوقت، له `createdBy` و`deviceId` و`payloadHash`).
`auditLogs` مقصور على ما **لا يمر** عبر القيود: التصحيحات، وتغيير قيم الالتزامات، والموافقات الاستثنائية،
وإصلاح الأرصدة، وأرشفة الحسابات. هذا يوفّر كتابة لكل عملية ويمنع ازدواج مصدر الحقيقة.

### 12.4 الترحيل (migration)

`schemaVersion` على كل مستند + `users/{uid}/meta/schema` بـ `{ currentVersion, appliedMigrations[] }`.
الترحيل يعمل عند تسجيل الدخول: إن كان `meta.currentVersion < APP_SCHEMA_VERSION` ⇒ تشغيل المُرحِّلات
المتدرّجة بـ `writeBatch` مجزَّأ + تسجيل `auditLogs:'migrationApplied'`.
إن كان `meta.currentVersion > APP_SCHEMA_VERSION` (جهاز بنسخة أقدم) ⇒ **منع الكتابة** بخطأ
`SCHEMA_VERSION_AHEAD` ورسالة «حدِّث التطبيق للمتابعة» — يمنع تلف البيانات من جهاز قديم.

---

## 13. الاختبارات الإلزامية للنواة (القسم 23)

| المجموعة | محتوى الاختبار | البيئة |
|---|---|---|
| المال | الجدول في 1.4 + `parseAmountToMinor` بمدخلات عربية/أوروبية/خاطئة + `applyRatio` بكل أنماط التقريب | وحدة، بلا Firebase |
| التوازن | رفض قيد غير متوازن، بسطر واحد، بمبلغ 0 أو سالب أو كسري | وحدة |
| `planOperation` | **اختبار جدولي (table-driven) لكل صف في القسم 7**: المدخل → `WritePlan` متوقَّع بالكامل | وحدة |
| منع الازدواج | نفس `opId` ×2 ⇒ قيد واحد و`alreadyApplied`؛ نفس `opId` بحمولة مختلفة ⇒ `OP_ID_CONFLICT`؛ استدراك متكرر ×50 ⇒ قيد واحد | محاكي |
| التزامن | معاملتان متنافستان على نفس الحساب ⇒ الرصيد النهائي صحيح؛ جهازان بنفس `opId` الحتمي ⇒ قيد واحد | محاكي |
| السداد الزائد | `X = remaining` ✓، `X = remaining+1` ✗، التزام متغير بإقرار ✓، دين دائماً ✗ | وحدة + محاكي |
| الرصيد السالب | حساب `allowNegative:false` ✗، `true` ✓، تخطّي الفحص في الاستيراد | وحدة |
| العكس والتعديل | العكس يصفّر كل المُجمَّعات بالضبط؛ العكس المزدوج ممنوع؛ التعديل بدلتا صافية؛ تعديل تاريخ يُنقل بين فترتين | محاكي |
| الفترة المُقفلة | قيد داخل فترة مُقفلة مرفوض من **القواعد** لا من الكود فقط | محاكي |
| القواعد | قيد غير متوازن مرفوض؛ تعديل مبلغ قيد مرفوض؛ حذف قيد مرفوض؛ `paidMinor > totalMinor` مرفوض؛ قراءة مستخدم آخر مرفوضة | محاكي |
| سلامة المُجمَّع | توليد 500 عملية عشوائية ⇒ `auditTrialBalance` متوازن و`auditAccount` بلا انحراف لكل حساب | خاصيّة (property) + محاكي |
| مطابقة التقارير | مجموع `periods` لسنة = مجموع القيود المحسوب من الصفر (القسم 23 بند 12) | محاكي |
| الصندوق الصادر | وضع offline ⇒ العملية تُطابَر ولا تظهر في أي رصيد؛ عند العودة تُرحَّل مرة واحدة | محاكي + محاكاة الشبكة |

---

## 14. نقد صريح لهذا المنظور (لا بيع له)

### 14.1 عيوب حقيقية — وما يُفعل بها

| # | العيب | الشدّة | المعالجة في هذا التصميم | هل بقيت خسارة؟ |
|---|---|---|---|---|
| 1 | **`runTransaction` لا يعمل دون اتصال** — وهو عمود هذا التصميم كله، ويصطدم بمتطلب PWA | **عالية** | الصندوق الصادر (4.6) + معرّفات حتمية | نعم: لا ترحيل فوري دون اتصال. المستخدم يرى «بانتظار المزامنة». مقبول ومتوافق مع القسم 22 |
| 2 | **خسارة `sum()` من الخادم** بسبب السطور المضمَّنة | متوسطة | مُجمَّعات مخزَّنة + `periods` + `accountPeriods` | نعم: التقارير الحرّة غير المُجمَّعة مسبقاً تُحسب في العميل بقراءة القيود |
| 3 | **التعقيد الذهني**: debit/credit، شجرة حسابات، عكس القيود — مفاهيم لا تخص مستخدماً شخصياً | **عالية** | إخفاء كامل: 13 عملية مُسمَّاة، لا مكوّن يبني `lines`، لا كلمة «مدين/دائن» في أي واجهة مستخدم (تظهر في شاشة «دفتر القيود» المتقدمة فقط، اختيارية) | نعم: تكلفة صيانة أعلى على المطوّر، ومنحنى تعلّم لأي مطوّر جديد |
| 4 | **المُجمَّع المخزَّن قابل للانحراف** | متوسطة | معاملة ذرّية + `balanceVersion` + `entryCount` + ميزان المراجعة + مسار إصلاح | نعم: احتمال نظري عند كتابة من خارج المسار. القواعد تضيّقه لا تُلغيه |
| 5 | **كلمة «حساب» بمعنيين** (حساب نقدي للمستخدم / حساب في الشجرة) | متوسطة | تسمية الواجهة: «مصادر الأموال» للنقدية، «شجرة الحسابات» للمتقدمة؛ وتسمية الكود `Account` للشجرة و`fundingSource` للعرض | نعم: التباس محتمل في المصطلح العربي |
| 6 | **فئات المصروف صارت حسابات** ⇒ تعديل شجرة الفئات صار تعديل شجرة حسابات | منخفضة | ربط 1:1 وإنشاء تلقائي وأرشفة لا حذف | لا تقريباً |
| 7 | **الالتزامات والميزانيات والأهداف خارج الشجرة** ⇒ النظام ليس «قيداً مزدوجاً نقياً» | متوسطة | قرار مقصود ومبرَّر (R4، 2.5)، وتحديثها ذرّي مع القيد | نعم: من يتوقع دفتراً محاسبياً كاملاً سيجد مستندات حالة مرافقة. **هذا تنازل واعٍ لصالح المستخدم** |
| 8 | **ازدحام `periods/{pk}`** (كتابة/ثانية) | منخفضة لمستخدم واحد | مسار استيراد منفصل (5.4) | تظهر فقط في الاستيراد الجَمْعي، ومعالَجة |
| 9 | **احتمال خطأ اتجاه القيد** (مدين/دائن معكوسان) — صنف أخطاء جديد لم يكن موجوداً | متوسطة | `planOperation` هي **المكان الوحيد** الذي يبني السطور، مع اختبار جدولي لكل سطر في القسم 7؛ والخطأ لا يُسقِط التوازن فلا يكشفه I1 — يكشفه الاختبار فقط | نعم: يعتمد على جودة الاختبارات لا على ثابت بنيوي |
| 10 | **الرصيد الافتتاحي وحقوق الملكية** مفهوم مربك للمستخدم | منخفضة | `equity.opening` حساب نظام مخفي؛ المستخدم يرى «الرصيد الافتتاحي» حقلاً في نموذج الحساب فقط | لا |
| 11 | **كتابات أكثر بـ 75%** لكل مصروف | منخفضة جداً | قياس في 9.1؛ تحسين اختياري يخفضها إلى 5 | لا |
| 12 | **لا تحقّق موثوق على الخادم على Spark** | **عالية عند تعدد المستخدمين، منخفضة لمستخدم واحد** | القواعد تحمل I1/I2/I5/I6 | نعم: فحص الرصيد السالب في العميل. يُعالَج بالترقية (11.2) |

### 14.2 متى يكون هذا المنظور خياراً خاطئاً؟

**ارفض القيد المزدوج إن كانت كل الشروط التالية صحيحة:**
1. لا ديون (عليّ ولا لي)، ولا تحويلات بين حسابات، ولا التزامات بأقساط.
2. حساب واحد فقط لمصادر الأموال.
3. لا حاجة إلى تقرير «صافي الثروة» ولا إلى التمييز بين الاقتراض والدخل.
4. لا تعديل بأثر رجعي على عمليات قديمة.

**وثيقة متطلبات «رصيد» تنقض الشروط الأربعة صراحةً** (الأقسام 5، 8، 9، 10، 19). ولذلك: المنظور صحيح هنا.
لكن لو كان المشروع «تطبيق تسجيل مصروفات» كما نفت الوثيقة في القسم 1، لكان القيد المزدوج **هندسة زائدة
بلا مقابل**.

### 14.3 البديل الوسط الذي قيّمته ورفضته

**«عملية بطرفين» (two-sided transaction) بلا شجرة حسابات:** مستند واحد بـ
`{ fromAccountId?, toAccountId?, categoryId?, amountMinor, kind }`.
- **المزية:** أبسط بكثير، كتابات أقل، لا debit/credit.
- **سبب الرفض:** يحتاج منطق تصنيف شرطياً على `kind` في **كل** تقرير (`if kind==='transfer' skip`)،
  وهذا بالضبط مصدر العيب الذي تخشاه الوثيقة في القاعدة 19.11 («حتى لا تتضخم التقارير»). وكل نوع عملية
  جديد (شطب دين، عمولة، فائدة، تخصيص هدف، زكاة مستحقة) يفرض تعديل كل التقارير.
  التصميم المختار يجعل التقرير دالّة من **نوع الحساب** فقط ⇒ إضافة نوع عملية جديد **لا تمسّ أي تقرير**.
- **اعتراف:** للفريق الذي لا يتقن المحاسبة، البديل الوسط أسلم عملياً. القرار النهائي يعتمد على
  قبول مالك المشروع لتكلفة التعقيد مقابل متانة الثوابت.

### 14.4 الانحرافات عن القسم 18 — موثَّقة كما يطلب سطر 176

| الانحراف | السبب |
|---|---|
| `transactions` → **`journalEntries`** بسطور مضمَّنة | الاسم يعبّر عن دفتر قيود لا عن «عمليات»؛ والبنية تمنع القيد اليتيم |
| `debtPayments` → **لا مجموعة**؛ سجل الدفعات = استعلام على `journalEntries.refs.debtId` | مصدر حقيقة واحد؛ أي مجموعة موازية تنحرف عن الدفتر |
| **إضافة:** `operations`, `accountPeriods`, `periods`, `budgetPeriods`, `periodLocks`, `meta` | منع الازدواج، والتجميعات التي تُبقي لوحة التحكم عند ~104 قراءة بدل آلاف |
| `accounts` تشمل الآن **فئات المصروف ومصادر الدخل والديون** كحسابات | شرط القيد المزدوج؛ و`categories` تبقى مجموعة واجهة مرتبطة 1:1 |
| `auditLogs` لا تُكتب لكل عملية مالية | الدفتر نفسه سجل تدقيق (12.3) |
| `attachments` مؤجلة | Storage يتطلب Blaze (11.1) |

---

## 15. ملخص واجهة النطاق (ما تناديه الواجهة فقط)

```ts
// domain/api.ts — السطح الكامل المتاح للواجهة. لا شيء غيره يكتب مالاً.
export type OperationRequest =
  | RecordExpenseRequest | RecordIncomeRequest | TransferRequest
  | PayObligationRequest | CreateObligationRequest
  | CreateDebtRequest | RepayDebtRequest | CollectReceivableRequest | WriteOffDebtRequest
  | SetOpeningBalanceRequest | AdjustAccountRequest
  | ReverseEntryRequest | AmendEntryRequest
  | EarmarkToGoalRequest | AccrueZakatRequest | PayZakatRequest;

export interface RecordExpenseRequest {
  type: 'recordExpense';
  opId: string;
  amountMinor: Minor;
  bookedAt: string;              // 'YYYY-MM-DD'
  categoryId: string;
  fromAccountId: string;
  description: string;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'wallet' | 'other';
  payeeContactId?: string;
  tags?: string[];               // 'household' | 'personal' | …
  notes?: string;
  attachmentIds?: string[];
  refs?: Partial<EntryRefs>;
}
// … بقية الطلبات بنفس النمط (مبلغ + تاريخ + أطراف + opId)

/** نقطة الدخول الوحيدة. تُغلّف الصندوق الصادر ثم postOperation. */
export async function execute(req: OperationRequest): Promise<PostResult>;

/** محدِّدات القراءة — كل رقم مالي في الواجهة يأتي من هنا. */
export const selectors = {
  availableCashMinor, totalReceivablesMinor, totalPayablesMinor, netWorthMinor,
  monthIncomeMinor, monthExpenseMinor, netCashFlowMinor,
  expenseByCategory, householdExpenseMinor,
  budgetUtilizationPercent, goalProgressPercent,
  upcomingObligations, overdueObligations,
  accountStatementPage,
};
```

**ثلاث قواعد تنفيذية تُحرس في مراجعة الكود (code review):**
1. لا استيراد لـ `firebase/firestore` خارج `infra/firestore/**`.
2. لا `lines:` حرفية خارج `domain/ops/**`.
3. لا حساب مبالغ (`+ - * /` على مبالغ) خارج `domain/**`. يُفرض بقاعدة ESLint مخصّصة.

---

## 16. أسئلة مفتوحة تحتاج قرار المالك

1. **عدد الخانات في العرض:** 3 خانات في كل مكان، أم 3 في التفصيل و2 في الملخصات؟ (التخزين 3 بلا جدال).
2. **أسلوب الالتزامات:** قبول النقدي افتراضياً (R4) أم الاستحقاق؟ يؤثر مباشرة على رقم «مصروفات الشهر».
3. **بداية الشهر المالي:** يوم 1 ميلادي، أم يوم استلام الراتب؟ (القسم 21 يذكر «بداية الشهر المالي» —
   يحدد `periodKey` لكل قيد، وتغييره لاحقاً يستلزم ترحيلاً لإعادة حساب `periods`).
4. **المرفقات:** تأجيلها حتى Blaze، أم الاكتفاء بملاحظة نصية مؤقتاً؟
5. **إقفال الفترات:** تفعيله في الإصدار الأول أم تأجيله؟
6. **شاشة «دفتر القيود» المتقدمة:** تُعرض للمالك (مفيدة للتدقيق) أم تُخفى تماماً؟

