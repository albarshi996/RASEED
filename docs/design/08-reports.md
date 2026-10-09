# نظام التقارير والتحليلات والتصدير — رصيد | RASEED

> **المسار:** `docs/design/08-reports.md`
> **الحالة:** تصميم مقترح للاعتماد. لا كود تطبيقي، لا تهيئة npm، لا لمس Firebase.
> **المراجع الأعلى (بهذا الترتيب):** `docs/00-REQUIREMENTS.md` ← `docs/01-OWNER-DECISIONS.md` (ق-1، ق-2، ق-3)
> ← `docs/design/01-financial-core.md` (**العقد المُلزِم**).
> **قاعدة الالتزام:** كل ما في هذه الوثيقة مبني على النواة ولا يخالفها. أي ثغرة وجدتها في النواة تخص
> التقارير سُجِّلت في «الأسئلة المفتوحة» (القسم 15) ولم أغيّر ملف النواة.
> **النطاق:** القسم 16 من المتطلبات (التقارير والتحليلات) + القسم 4 (بطاقات لوحة التحكم ورسومها)
> + التصدير Excel/PDF/CSV + استراتيجية التجميع المسبق + آلية مطابقة التقارير للعمليات الأصلية.

---

## 0. ملخص تنفيذي

عشرة قرارات تحكم هذه الوثيقة كلها:

| # | القرار | البديل الذي رُفض، والسبب في سطر |
|---|---|---|
| **1** | **التقرير دالّة في نوع الحساب لا في `kind`** (R11 من النواة). الاستثناء هيكلي: التحويل والاقتراض والسداد والتحصيل والتخصيص **لا تملك سطر مصروف ولا سطر دخل**، فلا تحتاج أي `if` لاستبعادها | «مرشّح استبعاد في كل تقرير» — مرفوض: ينسى أحدهم مرشّحاً فيتضخم رقم ولا يكشفه شيء |
| **2** | **ثلاث طبقات تجميع فقط:** `periods` (شهري، موجود في النواة)، `dailyRollups` (يومي، **مقترح ADR-023**)، و`postings` للتجميع الخادمي بأي بُعد بقراءتين. لا طبقة رابعة | «جدول تقارير مُسبَق لكل تقرير» — مرفوض: كل إسقاط إضافي سطح انحراف إضافي |
| **3** | **التقرير السنوي = 12 قراءة** (`periods` ×12)، لا قراءة كل الحركات. والمصروف حسب الفئة سنوياً = دمج 12 خريطة `expenseByCategory` في العميل | قراءة قيود السنة (~2,000–6,000 قراءة) — مرفوض على Spark |
| **4** | **كل رقم مُجمَّع له معادلة واحدة مكتوبة هنا، وتُنفَّذ في `src/domain/reports/**` مرة واحدة**. الواجهة لا تجمع ولا تطرح ولا تقسم | تكرار المعادلة في المكوّن — مرفوض بالقسم 25 بند 7 وبقاعدة البناء B4 |
| **5** | **التسوية ثنائية الاتجاه ومعروضة**: كل تقرير يحمل «بصمة سلامة» (`ReportIntegrityStamp`) تُقارن المُجمَّع بالخام عبر `postings`، والانحراف **يُعرض في رأس التقرير ويُوسَم في الملف المُصدَّر** ولا يُصحَّح صامتاً ولا يُخفى | «تحقق في الخلفية بصمت» — مرفوض بالقسم 25 بند 15 |
| **6** | **الرسوم: Recharts** مع طبقة تغليف `src/ui/charts/**` لا تستورد من المكتبة إلا داخلها | ECharts (نصّ Canvas غير قابل للتحديد، أثقل، إمبراطيفي)، visx (نكتب المحاور والتلميحات وRTL بأنفسنا = مكتبة رسوم خاصة) |
| **7** | **PDF عبر HTML + طباعة المتصفح**، لا مكتبة PDF في الواجهة | pdfmake / jsPDF — **مرفوضان رفضاً قاطعاً**: لا يملكان تشكيل العربية (Arabic shaping) ولا bidi، فتخرج الحروف منفصلة ومعكوسة. محرّك تشكيل العربية الوحيد الموثوق المتاح لنا هو المتصفح نفسه |
| **8** | **Excel عبر exceljs** (محمَّل عند الطلب)، بورقة RTL وتنسيق رقمي `#,##0.000` | SheetJS — بُنية المجتمع لم تبقَ منشورة على npm بشكل موثوق، ودعم التنسيقات أضعف |
| **9** | **CSV = UTF-8 مع BOM + فاصلة + CRLF + تهريب RFC 4180 + تحييد حقن الصيغ**، وخيار الفاصلة المنقوطة في حوار التصدير | CSV بلا BOM (Excel العربي على Windows يقرؤه محارف مشوَّهة)، وسطر `sep=;` كافتراضي (يكسر كل مُحلِّل آخر) |
| **10** | **المبالغ تبقى `Minor` (درهم، عدد صحيح) حتى حدود التصدير**، والتحويل إلى الوحدة الكبرى يحدث **مرة واحدة** في دالة واحدة لكل صيغة. 3 خانات عشرية في كل جدول وتصدير، و(0/2/3) في البطاقات والمخططات فقط | تمرير أعداد عشرية عائمة بين الطبقات — مرفوض: «الإجمالي ≠ مجموع الصفوف» |

**ما تُسلِّمه هذه الوثيقة:** 17 تقريراً بمصدر بيانات محدَّد واستعلام مكتوب، 14 بطاقة لوحة تحكم بمعادلاتها
وتكلفتها، 18 معادلة رياضية مع استثناءاتها الصريحة، إسقاط `dailyRollups` كامل، 9 ثوابت تقارير قابلة
للاختبار، آلية تسوية معروضة للمستخدم، 11 رسماً بيانياً، وثلاث مسارات تصدير بكود فعلي.

---

## 1. المبادئ الحاكمة

### 1.1 الاستثناء هيكلي لا شرطي — إعادة تأكيد مع الأثر على التقارير

النواة (R11، §9) تجعل التصنيف دالّة في `line.accountType`. أثره المباشر على كل معادلة في القسم 3:

```ts
// domain/rules/classify.ts  — موجود في النواة، يُعاد استخدامه حرفياً
classifyLineForReports(line): 'income' | 'expense' | 'neutral'
```

| ما يجب استثناؤه من «المصروفات» و«الدخل» | كيف يُستثنى فعلاً | هل يحتاج شرطاً في التقرير؟ |
|---|---|---|
| التحويل بين الحسابات | لا سطر `expense` ولا `income` في القيد (`asset`↔`asset`) | **لا** |
| الاقتراض النقدي (`borrow` النقدي) | `asset` مدين + `liability` دائن | **لا** |
| سداد دين عليّ (`debtRepayment`) | `liability` مدين + `asset` دائن | **لا** |
| الإقراض (`lend`) والتحصيل (`debtCollection`) | `asset`↔`asset` | **لا** |
| **أصل** دفع التزام `nature='financing'` | `liability` مدين + `asset` دائن (ADR-011) | **لا** |
| التخصيص لهدف (`earmark`) | `equity`↔`equity` | **لا** |
| التسوية (`adjustment`) | الطرف المقابل `equity.adjustment` | **لا** |
| احتساب الزكاة (`zakatAccrual`) | `equity` مدين + `liability.zakat` دائن | **لا** |
| الرصيد الافتتاحي (`opening`) | `asset`/`liability` مقابل `equity.opening` | **لا** |
| **قيود العكس** (`reversal`) | قلب الجانب يقلب `signedAmountMinor` ⇒ **يتصافر المجموع رياضياً** | **لا** |
| العمليات المعلّقة `pendingCommands` | ليست في `journalEntries` ولا `postings` أصلاً (ADR-007) | **لا** |

**ثلاثة بنود تدخل فعلاً وتُذكر صراحةً لأنها تُنسى:**

1. **عمولة التحويل** تدخل المصروفات (لها سطر `expense.fees`) — وهذا صحيح.
2. **فوائد/تكاليف التمويل** تدخل المصروفات (`expense.finance`) بينما **أصل القسط لا يدخل**.
3. **شطب مستحق** (`debtWriteOff`) يدخل المصروفات (`expense.baddebt`) — خسارة حقيقية.
4. **شراء بالأجل** (`borrow` بسطر `expense`) يدخل المصروفات **ولا يخفض النقد** ⇒ يظهر كفرق في تقرير
   التدفق النقدي (القسم 3.6)، ويُعرض لا يُخفى.

### 1.2 سبع قواعد صارمة على طبقة التقارير

| # | القاعدة | فرضها |
|---|---|---|
| **P1** | كل رقم في كل تقرير وبطاقة يأتي من دالة في `src/domain/reports/**` تُرجع `Minor` أو `Bps`، وتُنسَّق **مرة واحدة** عند العرض | قاعدة البناء B4/B8 + مراجعة الأنواع |
| **P2** | **مجموع الصفوف المعروضة = الإجمالي المعروض، دائماً.** إن كان الجدول مُقطَّعاً (pagination) فالإجمالي يأتي من المُجمَّع لا من الصفحة، **ويُوسَم صريحاً**: «الإجمالي لكل الفترة (الصفحة تعرض 25 من 312)» | ثابت R-I7 + اختبار T-RPT-TOTALS |
| **P3** | **لا تقرير بلا `sources: DataSourceRef[]`** يُعرض للمستخدم في لوحة «مصدر هذا الرقم» (أيقونة ⓘ على كل بطاقة وكل إجمالي) | نوع `ReportResult` يفرضه عند الترجمة |
| **P4** | **لا رقم تقديري مُقدَّم كرقم فعلي.** التوقعات والمتوسطات والإسقاطات بلون وشارة «تقديري» منفصلة (القسم 12 من المتطلبات) | نوع `MetricValue` يحمل `basis: 'actual' \| 'derived' \| 'projected'` |
| **P5** | **القسمة على صفر ليست صفراً.** `null` ⇒ تُعرض «—» مع نصّ السبب («لم تُحدَّد ميزانية لهذا الشهر»، «لا دخل في الفترة») | `safeRatioBps` تُرجع `Bps \| null` |
| **P6** | **لا تخزين نتائج تقارير في Firestore.** الذاكرة المؤقتة للأشهر المنتهية في IndexedDB فقط، بمفتاح `(periodKey, projectionVersion)` | القسم 4.6 |
| **P7** | التقرير الذي يفشل في المطابقة **يُعرض مع شريط أحمر ويُصدَّر بعلامة مائية**، ولا يُحجب ولا يُصحَّح صامتاً | `ReportIntegrityStamp.verdict` |

---

## 2. طبقة التقارير — الأنواع وتواقيع الدوال

المسار: `src/domain/reports/**` (نقية: صفر استيراد من `data/` و`ui/` و`firebase/*` — قاعدة B1).
الوصول إلى Firestore عبر منفذ واحد `ReportIO` تُنفِّذه `src/data/reports/reportIo.ts`.

```ts
// src/domain/reports/types.ts
import type { Minor, Bps, DateKey, PeriodKey } from '../types/common';
import type { EntryKind, AccountType, EntryStatus } from '../types/JournalEntry';

export type ReportId =
  | 'daily' | 'weekly' | 'monthly' | 'yearly'
  | 'income' | 'expenses'
  | 'debtsPayable' | 'debtsReceivable'
  | 'obligationsUpcoming' | 'obligationsOverdue'
  | 'household' | 'budgetVariance' | 'savingsGoals'
  | 'accountStatement' | 'cashFlow'
  | 'tasks' | 'worship';

/**
 * نطاق شامل الطرفين، بنفس دلالة `bookedAt` في النواة.
 * **تصحيح (م-1):** المنطقة الزمنية **ليست** «توقيت المستخدم المحلي» بل **`Africa/Tripoli` مثبَّتة**
 * (ADR-033 في `02-architecture.md` §11.5 و`05-design-system.md` ت-7). كل `DateKey` و`PeriodKey`
 * و`today` في هذه الوثيقة تُشتق بـ `APP_TIME_ZONE` حصراً — انظر 17.2.
 */
export interface DateRange { fromDate: DateKey; toDate: DateKey; }

/**
 * **م-2 — تصنيف النطاق.** كل معادلة في القسم 3 دالّة في هذا التصنيف، لا في النطاق الخام.
 * `wholeMonths` : fromDate = أول يوم شهر و toDate = آخر يوم شهر ⇒ `periods` صالحة.
 * `partial`     : غير ذلك ⇒ **`periods` ممنوعة**، والمصدر `dailyRollups` أو `postings` (17.1).
 */
export type RangeShape = 'wholeMonths' | 'partial';
export function rangeShape(r: DateRange): RangeShape;

/** **م-3** — كل تقرير يعلن أي مرشّحات تؤثر في صفوفه، لتُحسب الإجماليات بنفسها (17.1). */
export type RowLevelFilterKey =
  | 'accountIds' | 'categoryIds' | 'tags' | 'contactIds' | 'kinds'
  | 'accountTypes' | 'minAmountMinor' | 'maxAmountMinor' | 'statuses';

export interface ReportFilters {
  range: DateRange;
  /** ≤ 10 عناصر — حدّ Firestore على `in` / `array-contains-any`. أكثر من ذلك ⇒ تصفية في العميل بعد التحميل. */
  accountIds?: string[];
  categoryIds?: string[];
  tags?: string[];
  contactIds?: string[];
  kinds?: EntryKind[];                 // للعرض والتصفية فقط — **لا يُستخدم في أي معادلة** (B10)
  accountTypes?: AccountType[];
  minAmountMinor?: Minor;              // يُقارن بـ `entry.totalDebitMinor` — انظر 17.1 قاعدة 6
  maxAmountMinor?: Minor;
  /**
   * **م-4 — مطلب مفقود عُولج:** القسم 16 من المتطلبات ينص على «التصفية حسب الحساب والفئة
   * **والحالة**»، ولم يكن في النوع أي مرشّح حالة. القيم المسموحة لكل تقرير معلنة في سجله:
   * قيد ⇒ `EntryStatus` · التزام ⇒ `ObligationStatus` · دين ⇒ `DebtStatus` · مهمة ⇒ `TaskStatus`.
   */
  statuses?: string[];
  /** الكشوف التدقيقية فقط: تُظهر `reversal` و`reversed`/`replaced`. الافتراضي في الشاشات العادية `false`. */
  includeCorrections?: boolean;
  /** ترتيب الصفوف. القيمة الافتراضية لكل تقرير معلنة في سجله (القسم 6). */
  sort?: { field: string; dir: 'asc' | 'desc' };
  /** **تصحيح (م-6):** الحد الأعلى **100** لا 250 — تناقض مع جدول 10.2 («حجم الصفحة ≤100»). */
  page?: { cursor: string | null; size: 25 | 50 | 100 };
}

/** يُعرض حرفياً للمستخدم في لوحة «مصدر هذا الرقم» — تطبيق القسم 25 بند 5. */
export interface DataSourceRef {
  collection:
    | 'periods' | 'dailyRollups' | 'accountPeriods' | 'budgetPeriods'
    | 'postings' | 'journalEntries' | 'accounts'
    | 'obligations' | 'debts' | 'financialGoals'
    | 'tasks' | 'worshipDays' | 'quranSessions';          // م-16: المجموعتان الفعليتان من `09` §5.1 و§6.1
  /** نصّ الاستعلام كما يُنفَّذ، للعرض والتوثيق. */
  query: string;
  aggregate: 'none' | 'sum' | 'count';
  estimatedReads: number;
}

export type MetricBasis = 'actual' | 'derived' | 'projected';

/** كل رقم معروض في التقارير من هذا النوع — P4. */
export interface MetricValue {
  valueMinor: Minor | null;
  basis: MetricBasis;
  /** سبب `null` بالعربية، إلزامي عند `valueMinor === null` — P5. */
  nullReasonAr?: string;
  sourceIndex: number;                  // فهرس في ReportResult.sources
}

export interface RatioValue {
  bps: Bps | null;
  basis: MetricBasis;
  nullReasonAr?: string;
  sourceIndex: number;
}

/**
 * **م-5 — فجوة أنواع عُولجت:** `MetricValue.valueMinor` من نوع `Minor`، لكن تقارير R16/R17 و
 * `entryCount` و«صفحات القرآن» و«عدد الدائنين» **ليست مبالغ**. تقديمها كـ `Minor` يجعل منسّق
 * العملة يطبع «200.000 د.ل» لعدد مهام = 200. لذلك كل رقم غير نقدي من هذا النوع، ومنسّقه
 * `formatCount` لا `formatLYD`.
 */
export interface CountValue {
  count: number | null;                 // عدد صحيح ≥ 0
  unitAr: 'عملية' | 'مهمة' | 'يوم' | 'صلاة' | 'صفحة' | 'آية' | 'جهة' | 'التزام' | 'دين' | 'هدف';
  basis: MetricBasis;
  nullReasonAr?: string;
  sourceIndex: number;
}

export type ReportCell = MetricValue | RatioValue | CountValue;

export interface ReportDriftRow {
  scope: 'period' | 'day' | 'account' | 'budget' | 'obligation' | 'debt' | 'goal';
  key: string;                          // periodKey | dateKey | accountId …
  field: string;
  storedMinor: Minor;
  computedMinor: Minor;
  deltaMinor: Minor;
}

export interface ReportIntegrityStamp {
  checkedAt: string;                    // ISO
  projectionVersion: number;
  ledgerFingerprint: { sumTotalDebitMinor: Minor; entryCount: number };
  verdict: 'matched' | 'drift' | 'notChecked';
  /**
   * **م-7 — سبب `notChecked` كان غير معرَّف** (غموض يمنع التنفيذ). القيم الحصرية:
   *  'offline'        : لا اتصال ⇒ `getAggregateFromServer` **غير متاح أصلاً** (17.3)
   *  'aggregateError' : فشل التجميع (فهرس ناقص، مهلة، حصة)
   *  'rebuildRunning' : `meta/integrity.rebuildStatus === 'running'` ⇒ الأرقام في طور الإصلاح
   *  'userDeferred'   : المستخدم اختار [تجاهل مؤقتاً] في هذه الجلسة
   *  'notApplicable'  : تقرير لا مُجمَّع له (R16/R17) ⇒ لا ثابت يُفحص
   */
  notCheckedReason?: 'offline' | 'aggregateError' | 'rebuildRunning' | 'userDeferred' | 'notApplicable';
  /** **م-8** — بصمة ثانية بعد الفحص؛ اختلافها عن الأولى ⇒ كتابة تزامنت مع الفحص ⇒ إعادة محاولة (17.4). */
  fingerprintAfter?: { sumTotalDebitMinor: Minor; entryCount: number };
  driftRows: ReportDriftRow[];
  /** تُطبع في تذييل كل ملف مُصدَّر. */
  stampTextAr: string;
}

export interface ReportResult<Row, Totals> {
  reportId: ReportId;
  titleAr: string;
  filters: ReportFilters;
  generatedAt: string;                  // ISO
  rows: Row[];
  /** إجماليات الفترة كاملةً — **لا إجماليات الصفحة** (P2). */
  totals: Totals;
  /**
   * **م-9 — أخطر ثغرة في النسخة السابقة:** الإجماليات كانت تُقرأ من `periods` دائماً، بينما
   * الصفوف تُصفَّى بـ `categoryIds`/`tags`/`accountIds`/`kinds`/`statuses`/`minAmountMinor`.
   * الأثر: **تقرير مُصفَّى يعرض إجمالي غير مُصفَّى** ⇒ خرق مباشر لـ P2 و R-I7 و«مطابقة التقارير
   * للعمليات» (القسم 23 بند 12). القاعدة الحاسمة في 17.1.
   */
  totalsStrategy: 'aggregateDocs' | 'serverAggregate' | 'loadedRows';
  /** المرشّحات النشطة التي أثّرت في اختيار الاستراتيجية — تُعرض في رأس التقرير. */
  activeRowFilters: RowLevelFilterKey[];
  charts: ChartSpec[];
  sources: DataSourceRef[];
  integrity: ReportIntegrityStamp;
  pagination: { cursor: string | null; shownRows: number; estimatedTotalRows: number; isTruncated: boolean };
  /** تحذيرات عرض بالعربية (فترة مُقفلة، تصحيحات فترات سابقة، فروق غير مُصنَّفة…). */
  noticesAr: string[];
}

export interface ReportDefinition<Row, Totals> {
  id: ReportId;
  titleAr: string;
  descriptionAr: string;
  availableFilters: Array<keyof ReportFilters>;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  exportFormats: Array<'xlsx' | 'csv' | 'pdf'>;
  /** **نقية.** تُعرض خطة القراءة للمستخدم قبل التشغيل (تقدير التكلفة — القسم 10.3). */
  plan(filters: ReportFilters): DataSourceRef[];
  /** غير نقية (تنادي ReportIO)، لكنها **لا تحسب**: تجمع البيانات ثم تستدعي reduce. */
  load(filters: ReportFilters, io: ReportIO): Promise<ReportResult<Row, Totals>>;
  /** **نقية وقابلة للاختبار وحدةً بلا أي I/O** — هنا كل الرياضيات. */
  reduce(input: ReportInput): { rows: Row[]; totals: Totals; charts: ChartSpec[]; noticesAr: string[] };
}
```

```ts
// src/domain/reports/io.ts — المنفذ. التنفيذ في src/data/reports/**
export interface PostingAggSpec {
  periodKey?: PeriodKey;
  bookedAtFrom?: DateKey; bookedAtTo?: DateKey;
  accountType?: AccountType;
  accountId?: string;
  categoryId?: string;
  tag?: string;
  contactId?: string;
  obligationId?: string; debtId?: string; goalId?: string;
  isCashLike?: boolean;
  side?: 'debit' | 'credit';
}

export interface ReportIO {
  getPeriods(keys: readonly PeriodKey[]): Promise<Map<PeriodKey, PeriodSummary>>;
  getBudgetPeriods(keys: readonly PeriodKey[]): Promise<Map<PeriodKey, BudgetPeriod>>;
  getDailyRollups(range: DateRange): Promise<DailyRollup[]>;
  getAccountPeriods(spec: { accountId?: string; periodKey?: PeriodKey; from?: PeriodKey; to?: PeriodKey })
    : Promise<AccountPeriod[]>;
  /** getAggregateFromServer — قراءتان لكل نداء. */
  sumPostings(spec: PostingAggSpec): Promise<{ sumSignedMinor: Minor; sumAmountMinor: Minor; count: number }>;
  pageEntries(spec: EntryPageSpec): Promise<{ rows: JournalEntry[]; cursor: string | null }>;
  countEntries(spec: EntryPageSpec): Promise<number>;
  ledgerFingerprint(): Promise<{ sumTotalDebitMinor: Minor; entryCount: number }>;
  getIntegrityMeta(): Promise<IntegrityMeta>;
  /** لقطة `accounts` الحيّة من مخزن التطبيق — **0 قراءات إضافية**. */
  accountsSnapshot(): readonly Account[];
  listObligations(spec: ObligationQuerySpec): Promise<Obligation[]>;
  listDebts(spec: DebtQuerySpec): Promise<Debt[]>;
  listGoals(): Promise<FinancialGoal[]>;
  listTasks(spec: TaskQuerySpec): Promise<TaskDoc[]>;
  /** م-16: `worshipDays/{dateKey}` و`quranSessions/{id}` — لا `worshipRecords`/`quranProgress`. */
  listWorship(range: DateRange): Promise<{ worshipDays: WorshipDay[]; quranSessions: QuranSession[] }>;
}
```

**لماذا هذا الفصل بالضبط:** `reduce` نقية ⇒ **كل معادلة في القسم 3 تُختبر بلا محاكي وبلا شبكة**،
وهو شرط القسم 23 بند 1 و12 من المتطلبات. و`plan` نقية ⇒ نعرض تكلفة القراءة **قبل** تنفيذها.

---

## 3. المعادلات — المرجع الوحيد

> كل معادلة أدناه تُنفَّذ **مرة واحدة** في `src/domain/reports/formulas/*.ts`، وتُستدعى من التقارير
> والبطاقات والتصدير. **تكرارها في أي ملف آخر عيب يُصلَح.**
> كل الحساب على `Minor` (عدد صحيح). النسب بـ `Bps` (أساس النقطة، عدد صحيح). لا عدد عشري عائم
> في أي خطوة وسيطة.

### 3.0 دوال مساعدة مطلوبة (إضافات على `domain/money`، لا تعديل على الموجود)

```ts
// domain/money/arithmetic.ts  (إضافات)
/** قسمة بتقريب نصف-بعيداً-عن-الصفر، بـ BigInt. للمتوسطات فقط — نتيجتها عرضية لا تُخزَّن ولا تُجمَع. */
export function divRoundMinor(a: Minor, n: number): Minor {
  invariant(Number.isInteger(n) && n > 0, 'DIV_BY_NONPOSITIVE');
  const A = BigInt(a), N = BigInt(n);
  const q = (A < 0n ? 2n * A - N : 2n * A + N) / (2n * N);
  return Number(q) as Minor;
}

/** قسمة لأعلى — للأقساط المطلوبة شهرياً (لا نُقلِّل المطلوب أبداً). */
export function divCeilMinor(a: Minor, n: number): Minor {
  invariant(Number.isInteger(n) && n > 0, 'DIV_BY_NONPOSITIVE');
  const A = BigInt(a), N = BigInt(n);
  const q = A >= 0n ? (A + N - 1n) / N : -((-A) / N);
  return Number(q) as Minor;
}

// domain/money/rate.ts  (إضافة — غلاف آمن حول ratioBps من النواة)
/**
 * يُرجع null عند مقام صفري أو مفقود — P5. **لا يُرجع 0 ولا Infinity.**
 * **تصحيح (م-10):** المقام **السالب** كان يمرّ فينتج نسبة مقلوبة الإشارة بلا أي كشف
 * (مثال: `householdShareBps` على فترة مقلوبة الإشارة، أو سقف ميزانية تالف). المقام السالب
 * **ليس حالة مشروعة في أي معادلة من القسم 3** ⇒ `null` + سبب يُعرض، ويُرفع كانحراف.
 */
export function safeRatioBps(part: Minor, whole: Minor | null | undefined): Bps | null {
  if (whole === null || whole === undefined || whole === 0) return null;
  if (whole < 0) return null;          // ← م-10
  return ratioBps(part, whole);
}

// domain/money/format.ts  (إضافة)
/** 8450 bps → "84.5%" — أرقام لاتينية (ق-3). */
export function formatPercentBps(b: Bps | null, decimals: 0 | 1 = 1): string;
```

### 3.1 إجمالي المصروفات

```
E(P)        = periods[P].totalExpenseMinor
E(range)    = Σ_{P ∈ months(range)} periods[P].totalExpenseMinor        // نطاق شهري كامل
E(range)    = Σ_{d ∈ days(range)}  dailyRollups[d].expenseMinor         // نطاق جزئي (يومي/أسبوعي)
```

**ما يُستثنى — صريحاً:** التحويلات، الاقتراض النقدي، سداد الديون، الإقراض، التحصيل،
**أصل** أقساط التمويل (`nature='financing'`)، التخصيص لهدف، التسويات، احتساب الزكاة،
الأرصدة الافتتاحية، والعمليات المعلّقة.
**ما يُدخَل عن قصد:** عمولات التحويل، فوائد التمويل، شطب المستحق، الزكاة **المدفوعة**،
ومصروفات الشراء بالأجل.
**قيود العكس:** لا تُستثنى ولا تُصفَّى — أثرها مطبَّق على `periods` لحظة الكتابة.

> **تحذير إلزامي:** `E(P)` هو **نشاط الفترة** ولا يضم `priorPeriodExpenseCorrectionMinor`.
> التقرير يعرض **سطرين منفصلين** (شرط النواة §4.7):
> «مصروفات الفترة» و «تصحيحات فترات سابقة» — ولا يُجمعان في رقم واحد.

### 3.2 إجمالي الدخل

```
I(P)  = periods[P].totalIncomeMinor
```
**ما يُستثنى:** الاقتراض (ليس دخلاً — R6)، التحصيل (ليس دخلاً — R7)، التحويلات الداخلية،
**الدخل المتوقع غير المستلم** (القسم 7: لا يُسجَّل قيداً أصلاً)، والعمليات المعلّقة.
**ما يُدخَل:** الراتب، المكافآت، الأعمال الإضافية، الإيرادات الاستثمارية، الهدايا المالية، وأخرى.

### 3.3 صافي التدفق (الفائض التشغيلي)

```
NetOp(P) = periods[P].netCashFlowMinor
         = I(P) − E(P) + ppIncCorr(P) − ppExpCorr(P)                     // ثابت I9 من النواة
```
حيث `ppIncCorr = priorPeriodIncomeCorrectionMinor` و`ppExpCorr = priorPeriodExpenseCorrectionMinor`
(دلتا **موقَّعة**: سالبة عند عكس عملية).

> **تنبيه دلالي مهم جداً:** هذا الرقم **ليس** التغيّر في النقد. انظر 3.6.
> بطاقة لوحة التحكم «صافي التدفق النقدي» تُسمَّى في الواجهة **«صافي التدفق (دخل − مصروف)»**
> ويُعرض `ΔCash` بجانبها في تقرير التدفق النقدي. (سؤال مفتوح رقم 2.)

### 3.4 نسبة استهلاك الميزانية والانحراف

```
// عام
budgetUtilBps(P)      = safeRatioBps(budgetPeriods[P].overallSpentMinor,
                                     budgetPeriods[P].overallLimitMinor)
budgetVarianceMinor(P)= overallSpentMinor − overallLimitMinor            // موجب = تجاوز
budgetRemainingMinor(P)= max(0, overallLimitMinor − overallSpentMinor)

// لكل فئة c
catUtilBps(P,c)       = safeRatioBps(categories[c].spentMinor, categories[c].limitMinor)
catVarianceMinor(P,c) = categories[c].spentMinor − categories[c].limitMinor
```

**قواعد إلزامية:**
1. `overallLimitMinor === null` أو الفئة غير موجودة في `categories` ⇒ النسبة `null`
   والعرض **«لم تُحدَّد ميزانية لهذا الشهر»** — لا 0% ولا 100% ولا «∞» (قاعدة النواة الصلبة على `budgetPeriods`).
2. **لا تقليم (clamp) للنسبة عند 100%.** 112% تُعرض 112% بلون التجاوز؛ شريط التقدم هو ما يُقلَّم بصرياً.
3. **ما يُستثنى من `spentMinor` هيكلياً:** أقساط التمويل (`nature='financing'` لا تلمس `budgetPeriods`
   إطلاقاً)، والتحويلات (إلا العمولة) **والاقتراض النقدي** والسداد والإقراض والتحصيل،
   **وتصحيحات الفترات المُقفلة** (النواة: `budgetPeriods` لا تُلمس في تصحيح فترة مُقفلة).
   ⇒ **نتيجة مُعلَنة:** ميزانية شهر مُقفل لا تتغير بعد إقفاله، وهذا مقصود، ويُكتب في تذييل تقرير
   الميزانية.
   > **تصحيح اتساق (تدقيق مالي):** كانت العبارة «والاقتراض» مُطلَقة، وهي **تخالف جدول الحقيقة
   > R6 في النواة §9**: حالة (ب) «شراء بالأجل» قيدها `Dr expense.{cat} / Cr liability.payable`
   > ⇒ النواة تنصّ صريحاً على `budgetPeriods: (ب) فقط: spentMinor += X`. فالمستبعَد هو
   > **الاقتراض النقدي (حالة أ)** الذي لا سطر مصروف فيه، لا الاقتراض بإطلاقه. والقاعدة الحاكمة
   > واحدة في الحالتين: **الاستهلاك يتبع وجود سطر على حساب `expense`، لا `kind`** (R11).
4. `spentMinor ≥ 0` دائماً (ثابت النواة I16). قيمة سالبة ⇒ انحراف يُعرض لا يُخفى.
5. **م-11 — نتيجة حاسمة كانت غائبة: `overallSpentMinor ≠ E(P)`.** قاعدة النواة الصلبة على
   `budgetPeriods` (§4.7) تمنع أي كتابة ميزانية لفئة بلا `limitMinor` ⇒ `overallSpentMinor`
   **لا يضم إلا إنفاق الفئات المسقوفة**. فـ «نسبة استهلاك الميزانية» **ليست** «نسبة ما أنفقته من
   مصروف الشهر»، والفرق إنفاق خارج أي سقف. المعادلتان الجديدتان (ثابت جديد R-I10):
```
unbudgetedSpendMinor(P) = E(P) − budgetPeriods[P].overallSpentMinor        // ≥ 0 دائماً
unbudgetedByCategory(P) = { c: periods[P].expenseByCategory[c]
                            | c ∉ keys(budgetPeriods[P].categories) }
```
   **R-I10:** `0 ≤ overallSpentMinor ≤ E(P)`، و`unbudgetedSpendMinor === Σ unbudgetedByCategory`.
   القيمة السالبة أو التجاوز ⇒ انحراف يُعرض. وبطاقة C12 تحمل نصاً إلزامياً تحتها:
   **«محسوبة على الفئات المسقوفة فقط — إنفاق بلا سقف: … د.ل»**.
   (قبل هذا التصحيح كان المستخدم يقرأ «استهلاك 45%» وقد أنفق ضعف ذلك في فئات لا سقف لها.)

### 3.5 نسبة تقدم الهدف والمطلوب شهرياً

```
goalSavedMinor(g, accounts) =
    g.mode === 'virtualEarmark' ? g.savedMinor
  : /* backedAccount */           accounts[g.backingAccountId].balanceMinor      // ← انظر السؤال المفتوح 1

goalProgressBps(g)   = safeRatioBps(goalSavedMinor(g), g.targetMinor)
goalRemainingMinor(g)= max(0, g.targetMinor − goalSavedMinor(g))
monthsLeft(g, today) = max(1, fullMonthsBetween(today, g.targetDate))            // targetDate غائب ⇒ null
requiredPerMonth(g)  = g.targetDate ? divCeilMinor(goalRemainingMinor(g), monthsLeft(g, today)) : null
```
**تصحيح (م-12) — `targetDate` في الماضي:** `fullMonthsBetween` يعطي عدداً **سالباً**، و`max(1, …)`
كان يحوّله إلى 1 ⇒ التقرير يعرض «المطلوب شهرياً = كل المتبقي» كأن الهدف يستحق هذا الشهر، **ويُخفي
أن موعد الهدف مضى**. القاعدة المعتمدة:
```
monthsLeft(g, today) = g.targetDate == null        ? null
                     : g.targetDate <  today       ? 0        // ← حالة ثالثة صريحة
                     : max(1, fullMonthsBetween(today, g.targetDate))
requiredPerMonth(g)  = monthsLeft == null ? null
                     : monthsLeft === 0   ? null              // + نصّ «تجاوز تاريخ الهدف بـ N يوماً»
                     : divCeilMinor(goalRemainingMinor(g), monthsLeft)
```
و`monthsLeft === 0` ⇒ شارة **«متأخر عن موعده»** في R13 و C11، وإدخاله في إجمالي «الأهداف المتأخرة».

**استثناءات:** `targetMinor === 0` ⇒ `null` + «الهدف بلا قيمة محدَّدة».
`status ∈ {paused, cancelled}` ⇒ يُعرض لكن يُستثنى من إجمالي «المبالغ المخصصة للادخار».
**تنبيه عرض إلزامي (من النواة):** في `virtualEarmark`: «مخصص دفترياً، والمال لا يزال في حسابك».
وفي `backedAccount`: «هذا المبلغ مشمول في الأموال المتاحة» — لمنع العدّ المزدوج ذهنياً.

### 3.6 التدفق النقدي الحقيقي وجسر المطابقة

```
ΔCash(P) = Σ_{a ∈ cashLikeAccounts} accountPeriods[`${a.id}__${P}`].netMinor
           // cashLikeAccounts = accounts.filter(spendableSet)   ← **نفس مجموعة 06 §8.1 حرفياً**
           //   spendableSet(a) = a.isCashLike && a.isPostable && !a.excludeFromNetWorth
           //   **بلا أي مرشّح `status`** — انظر التصحيح أدناه
```

> **تصحيح اتساق (تدقيق مالي) — مرشّح واحد لا ثلاثة:** كانت المجموعة تُكتب بثلاث صور مختلفة:
> النواة §R9 و§5.3 و§3.9 هنا بـ `isCashLike && status==='active' && isPostable`، وهذه المعادلة بـ
> `isCashLike && isPostable && !excludeFromNetWorth`، وجدول 3.13 يُضيف «الحسابات المؤرشفة» إلى
> المستبعَد. **والمرشّح `status==='active'` هنا يكسر الجسر:** حساب مصرفي فيه حركة في الفترة ثم
> أُرشف ⇒ حركته تختفي من `ΔCash` ⇒ `UnclassifiedMinor` يصير **غير صفري بلا سبب حقيقي** ويبقى كذلك
> في كل تقرير لاحق. والأرشفة **قرار عرض لا قرار محاسبي** (العقد §11.5: «الأرشفة لا تمسّ الرصيد»)،
> ولهذا حسمها `06-module-map.md` §8.1/ر-8: **المرشّح الوحيد المسموح في أي رقم ثروة أو حركة هو
> `excludeFromNetWorth`**. فوُحِّدت 3.6 و3.9 و3.13 على `spendableSet` من 06 §8.1.
`netMinor` للحساب الأصل = `debitMinor − creditMinor` ⇒ `ΔCash` **دقيق ورخيص** (قراءة واحدة لكل حساب نقدي).

**الجسر المُصنَّف (من `periods`، بقراءة واحدة):**

```
ClassifiedIn(P)  = I(P) + borrowedMinor(P) + collectedMinor(P)
ClassifiedOut(P) = E(P) + repaidMinor(P) + lentMinor(P) + financingPaidMinor(P)
ClassifiedNet(P) = ClassifiedIn − ClassifiedOut + ppIncCorr(P) − ppExpCorr(P)

UnclassifiedMinor(P) = ΔCash(P) − ClassifiedNet(P)      ← **يُعرض دائماً كسطر مستقل**
```

**لا تطرح `obligationPaidMinor` في الجسر:** الجزء `nature='expense'` منه **داخل `E(P)` أصلاً**،
والجزء التمويلي هو `financingPaidMinor` وهو مطروح مرة واحدة. الطرح مرتين خطأ شائع — ممنوع.

**ما يُنتج فرقاً غير مُصنَّف (كل الحالات معروفة ومُعلَنة):**
شراء بالأجل (مصروف بلا نقد — R6/ب)، **شطب مستحق (`debtWriteOff`: مصروف `expense.baddebt` بلا أي
حركة نقدية — R7)**، قيد افتتاحي داخل الفترة، تسوية جرد على حساب نقدي، مصروف مدفوع من حساب غير
نقدي، دخل مُسجَّل على حساب `receivable`.

> **تصحيح اتساق (تدقيق مالي):** كان **شطب المستحق** غائباً عن هذه القائمة مع أن النواة §9/R7
> تنصّ عليه صريحاً: `Dr expense.baddebt / Cr asset.receivable` ⇒ `E(P) += X` و`ΔCash = 0`
> ⇒ `UnclassifiedMinor = +X` حتماً. وغيابه يجعل سطر «فرق غير مُصنَّف» يظهر بلا تفسير مُعلَن
> في أول شهر فيه شطب، وهو بالضبط ما تمنعه القاعدة أدناه.

**القاعدة:** `UnclassifiedMinor ≠ 0` ⇒ سطر «فرق غير مُصنَّف» + زر **[فسِّر هذا الفرق]** يقرأ قيود
الفترة (تكلفة معروضة مسبقاً) ويعرض القيود المسؤولة. **لا إخفاء ولا ضمّ للفرق في سطر آخر.**

### 3.7 متوسط الإنفاق اليومي والإسقاط

```
// م-13: الفترة المستقبلية كانت تقسم على daysInMonth فتُنتج «متوسطاً» و«توقعاً» = 0 بثقة.
daysElapsed(P, today) = P >  currentPeriodKey ? null                    // فترة مستقبلية
                      : P === currentPeriodKey ? dayOfMonth(today)      // بتوقيت Africa/Tripoli
                      : daysInMonth(P)
avgDailyExpense(P)    = divRoundMinor(E(P), daysElapsed(P, today))          // basis: 'derived'
projectedMonthEnd(P)  = avgDailyExpense(P) × daysInMonth(P)                 // basis: 'projected'
avgDailyExpense(range)= divRoundMinor(E(range), inclusiveDayCount(range))
```
**استثناءات:** نفس استثناءات 3.1 بالكامل. **والمقام أيام تقويمية لا «أيام فيها حركة»** —
لأن يوماً بلا إنفاق إنفاقه صفر، وحذفه من المقام يرفع المتوسط كذباً.
**قاعدة:** `projectedMonthEnd` **لا تُجمَع مع أي رقم فعلي ولا تُصدَّر في جدول الحركات**؛
مكانها بطاقة أو خط منقّط في المخطط بشارة «تقديري».
**م-13 (تكملة):** `daysElapsed === null` ⇒ المتوسط والتوقع `null` بسبب «الفترة لم تبدأ بعد»،
**لا صفر**. وفي الشهر الجاري يوم 1: المقام = 1 (لا صفر) فلا قسمة على صفر.

### 3.8 معدل الادخار

```
// التعريف الأساسي (الفائض)
savingsRateBps(P)  = safeRatioBps(I(P) − E(P), I(P))                    // سالب مسموح = عجز

// التعريف الثاني (المخصَّص فعلاً) — يُعرض بجانبه لا بدلاً منه
// م-14: `PostingAggSpec.accountId` حقل **مفرد** لا مصفوفة ⇒ النداء التالي كان غير قابل للتنفيذ.
// الصيغة الصحيحة: نداء لكل حساب حجز (≤10 أهداف ⇒ ≤20 قراءة)، أو نداء واحد بـ goalId.
allocatedSavingsMinor(P) =
      Σ_{a ∈ earmarkAccountIds} sumPostings({ periodKey: P, accountId: a }).sumSignedMinor
    + Σ_{g.mode==='backedAccount'} accountPeriods[`${g.backingAccountId}__${P}`].netMinor
allocatedSavingsRateBps(P) = safeRatioBps(allocatedSavingsMinor(P), I(P))
```
**استثناءات:** `I(P) === 0` ⇒ `null` + «لا دخل مُسجَّل في هذه الفترة».
الاقتراض والتحصيل **ليسا دخلاً** فلا يكبّران المقام.
**تنبيه:** التحويل إلى حساب توفير **ليس ادخاراً محاسبياً** (التحويل محيَّد)، لكنه **ادخار سلوكي** —
ولهذا هو في التعريف الثاني وحده، وبوسم «مخصَّص» لا «فائض».

### 3.9 صافي الثروة والأرصدة (من لقطة `accounts`، 0 قراءات إضافية)

```
spendableSet(a)      = a.isCashLike && a.isPostable && !a.excludeFromNetWorth
availableCashMinor   = Σ balanceMinor  where spendableSet(a) && (a.status==='active' || a.balanceMinor !== 0)
spendableCashMinor   = Σ (balanceMinor − earmarkedMinor)  لنفس المجموعة
totalReceivablesMinor= Σ balanceMinor  where subtype==='receivable' && !excludeFromNetWorth
totalPayablesMinor   = Σ balanceMinor  where type==='liability'    && !excludeFromNetWorth
netWorthMinor        = Σ assets − Σ liabilities   (باستثناء excludeFromNetWorth، وبلا أي مرشّح status)
```
**المصدر المُلزِم:** هذه الخمس **مُعرَّفة في `06-module-map.md` §8.1** (`domain/selectors/wealth.ts`)،
وهي **النسخة المصحَّحة** لدوال النواة §R9، وتُستدعى كما هي — لا إعادة تعريف ولا نسخة ثانية هنا.

> **تصحيح اتساق (تدقيق مالي):** كانت هذه الكتلة تُنسَخ من النواة §R9 مع جملة «موجودة في النواة
> §R9 حرفياً»، **وهي لم تكن حرفية ولا مطابقة**: 06 §8.1 حسم بـ(ر-8) أن **المرشّح `status==='active'`
> يُسقط رصيد حساب مؤرشف من «الأموال المتاحة» وصافي الثروة بلا أي قيد** ويكسر الثابت M-I9، فأبدله
> بـ`excludeFromNetWorth` وحده. وحسم بـ(ر-9) أن `totalPayablesMinor` يشمل `zakatDue` (كل
> `type==='liability'`) وإلا تناقضت بطاقة «الديون عليّ» مع مكوّن الخصوم في «صافي الثروة» في شاشة
> واحدة — **وهذا الانحراف عن §5.3 من العقد ينتظر إقرار المالك (06 §17.2/ي)**، وحتى الإقرار تُعرض
> الزكاة في سطر فرعي داخل البطاقة.

### 3.10 مصاريف المنزل

```
HouseholdE(P)       = periods[P].householdExpenseMinor                  // مجموع فرعي من E(P)
householdShareBps(P)= safeRatioBps(HouseholdE(P), E(P))
```
**ثابت النواة I15:** `HouseholdE(P) ≤ E(P)` دائماً. **ممنوع جمعه مع `E(P)`** — هو جزء منه
(القسم 11: «تظهر مصاريف المنزل في التقارير العامة دون تكرار قيمتها»).
ميزانية المنزل = مجموع سقوف الفئات تحت `expense.home` من `budgetPeriods[P].categories`:
```
householdLimitMinor(P) = Σ_{c ∈ homeCategoryIds} budgetPeriods[P].categories[c]?.limitMinor ?? 0
householdSpentMinor(P) = Σ_{c ∈ homeCategoryIds} budgetPeriods[P].categories[c]?.spentMinor ?? 0
```
**م-15 — `homeCategoryIds` كان غير معرَّف** (جملة لا يستطيع مبرمج تنفيذها). التعريف المعتمد،
من لقطة الفئات الحيّة بـ **0 قراءات إضافية**:
```ts
// src/domain/reports/formulas/household.ts
/** فئة منزلية = حسابها تحت شجرة `expense.home.` (النواة §3.4: لكل فئة حساب، و§3.5 لشجرة المنزل). */
export function homeCategoryIds(categories: readonly Category[]): string[] {
  return categories.filter((c) => c.accountCode.startsWith('expense.home.')).map((c) => c.id);
}
```
**لا قائمة مُثبَّتة في الكود ولا وسم ثانٍ:** إضافة فئة منزلية جديدة تدخل التقرير تلقائياً،
وفئة أُعيد تصنيفها تخرج منه **من تاريخ إعادة التصنيف فقط** — وهذا قصور مُعلَن (القسم 13 بند 11).
> **تنبيه دقيق:** `householdSpentMinor` (من الميزانية) قد يختلف عن `HouseholdE` (من الوسم `household`)
> لأن الأول بالفئة والثاني بالوسم، ومصروف موسوم `household` في فئة «الصحة» يدخل الثاني لا الأول.
> **الحل المعتمد:** تقرير المنزل يعرض **محورين معنونين**: «بالوسم» و«بفئات المنزل»، ويشرح الفرق
> في تذييله. لا نوحّدهما كذباً.

### 3.11 الديون والالتزامات

```
// التزامات
obligationDueMinor(o)   = o.totalMinor + o.extraChargesMinor − o.paidMinor   // == o.remainingMinor (I5)
obligationPaidPctBps(o) = safeRatioBps(o.paidMinor, o.totalMinor + o.extraChargesMinor)
upcomingTotalMinor(range)= Σ o.remainingMinor  where status ∈ {upcoming, due, partiallyPaid}
                                              && dueDate ∈ range
overdueTotalMinor(today) = Σ o.remainingMinor  where status==='overdue' (أو dueDate < today && remaining>0)
daysOverdue(o, today)    = diffDays(today, o.dueDate)                        // > 0 فقط

// ديون
debtRemainingMinor(d)   = d.principalMinor − d.settledMinor − d.writtenOffMinor   // == d.remainingMinor (I6)
debtSettledPctBps(d)    = safeRatioBps(d.settledMinor, d.principalMinor)
totalPayableDebtsMinor  = Σ remainingMinor where direction==='payable'    && status ∈ {open, partiallySettled}
totalReceivableDebtsMinor= Σ remainingMinor where direction==='receivable' && status ∈ {open, partiallySettled}
expectedCollection(n days)= Σ remainingMinor where direction==='receivable'
                                              && expectedSettleAt ≤ today+n && status ∈ {open, partiallySettled}
```
**استثناءات:** `status ∈ {settled, cancelled}` خارج كل الإجماليات؛ `writtenOff` خارج «المستحق لي»
**وداخل** مصروف `expense.baddebt` في فترة الشطب. و**المستحق لي لا يدخل النقد المتاح** (R9).
**التحقق المستقل (I5b/I6b):** `paidMinor === Σ settlementDeltaMinor` على `postings` بقراءتين —
يُشغَّل عند فتح شاشة الالتزام/الدين وفي التسوية الشاملة.

### 3.12 المهام والعبادات

> **⚠ م-16 — هذا القسم كان مبنياً على عقد مُتخيَّل.** صدرت `docs/design/09-personal-worship.md`
> وثبَّتت النماذج الفعلية، وهي **مختلفة في المجموعة والحقول والقيم**. الصيغ أدناه **مُصحَّحة
> ومُلزِمة**، والنسخة القديمة (`worshipRecords`، `state:'performed'|'missed'|'unrecorded'`،
> `quranProgress.pages`، `status:'doing'`) **باطلة ولا تُنفَّذ**. التفصيل الكامل في 17.6.

```
// ── مهام (users/{uid}/tasks) — العقد من 09 §4.1 ──
// TaskStatus = 'todo' | 'inProgress' | 'done' | 'cancelled'      ← **لا 'doing'**
// completedOn: DateKey | null  ← اليوم المحلي للإكمال، **وهو مفتاح تقرير الإنجازات** لا completedAt
// trashed: boolean             ← **إلزامي في كل مرشّح**، وإلا حُسبت مهام السلة
completedCount(range)   = count(tasks where !trashed && status=='done' && completedOn ∈ range)
openCount(today)        = count(tasks where !trashed && status ∈ {todo, inProgress})
overdueCount(today)     = count(tasks where !trashed && status ∈ {todo, inProgress}
                                       && dueDate != null && dueDate < today)
dueInRangeOpenCount(range) = count(tasks where !trashed && status ∈ {todo, inProgress}
                                            && dueDate ∈ range)
// م-17: المقام القديم خلط عدّاً لحظياً (overdueCount بتاريخ اليوم) بعدٍّ على نطاق ⇒ نسبة
// تتغيّر بمرور اليوم على نطاق مُقفل. المقام الآن **كله على النطاق**:
dueInRange(range)       = count(tasks where !trashed && dueDate ∈ range
                                       && status ∈ {todo, inProgress, done})
completionRateBps(range)= safeRatioBps(count(done && dueDate ∈ range), dueInRange(range))
onTimeRateBps(range)    = safeRatioBps(count(done && completedOn ≤ dueDate && dueDate ∈ range),
                                       count(done && dueDate ∈ range))
// م-18: mean على مهام dueDate === null كان يُنتج NaN (خرق T-RPT-EMPTY). المقام مُقيَّد صريحاً:
avgLagDays(range)       = let S = tasks where done && completedOn ∈ range && dueDate != null in
                          S.length === 0 ? null : divRoundMinor(Σ diffDays(completedOn, dueDate), S.length)
// المهام بلا موعد («يوماً ما») تُعرض بعددها ولا تدخل أي نسبة التزام بالموعد.

// ── عبادات (users/{uid}/worshipDays/{dateKey}) — العقد من 09 §5.1 ──
// PrayerRecord = { state: 'unset' | 'onTime' | 'qada'; jamaah: boolean; ... }
// **لا 'performed' ولا 'missed'.** غياب المستند = «لم تُسجَّل» (09 §5.3) — وهو المعنى المعتمد.
recordedPrayers(range)  = count(prayers where state != 'unset')
onTimePrayers(range)    = count(state === 'onTime')
qadaPrayers(range)      = count(state === 'qada')
jamaahPrayers(range)    = count(state != 'unset' && jamaah === true)
// المقام **المسجَّل فقط** — ولا لفظ تقييمي:
onTimeShareBps(range)   = safeRatioBps(onTimePrayers, recordedPrayers)
recordedDays(range)     = count(أيام لها مستند worshipDays فيه صلاة واحدة state != 'unset')
unrecordedDays(range)   = inclusiveDayCount(range) − recordedDays(range)   // يُعرض بعدده

// ── القرآن (users/{uid}/quranSessions) — العقد من 09 §6.1، سجل **جلسات** لا مستند يومي ──
// لا حقل pages ولا dailyGoalPages على المستند؛ الموجود: ayahCount, pagesTouched, minutes, mode
quranAyahs(range)       = Σ_{s ∈ sessions(range)} s.ayahCount
quranPages(range)       = Σ_{s ∈ sessions(range)} s.pagesTouched   // **عدد صحيح عادي لا Minor**
quranSessionCount(range)= count(sessions(range))
// الهدف من `QuranGoal` (09 §6.4) لا من حقل على الجلسة، وبوحدته المعلنة:
quranGoalBps(range)     = goal == null ? null
                        : safeRatioBps(goal.unit === 'pages' ? quranPages : quranAyahs,
                                       goal.amount × inclusiveDayCount(range))
// م-19: «pagesTouched» مُعلَن أنه **صفحات ملموسة لا صفحات مقروءة كاملة**: جلستان في نفس الصفحة
// تُحسبان 1+1. ⇒ `quranPages` **مقياس جهد لا مسافة مقطوعة**، ويُكتب ذلك حرفياً في تذييل R17.
// وحساب «المسافة الفعلية» الصحيح هو `quranAyahs` ⇒ **هو العمود الأساسي، والصفحات ثانوية.**

// م-20: «سجل مكتمل» كان غير معرَّف. التعريف المعتمد والوحيد:
completeDay(d)          = الصلوات الخمس كلها state != 'unset' في worshipDays/{d}
streakDays(today)       = أطول تتابع أيام متصلة ينتهي عند today أو today−1 ويتحقق فيه completeDay
// (السماح بالانتهاء عند today−1 مقصود: لا نكسر السلسلة قبل انتهاء يوم المستخدم.)
```
**ثلاث قواعد غير قابلة للتفاوض في تقرير العبادات:**
1. **المقام = المسجَّل فقط.** «غير مسجَّل» حالة ثالثة تُعرض بعددها، **ولا تُحسب تقصيراً**.
2. **لا مصطلح تقييمي:** لا «نسبة التقصير» ولا «ضعيف/جيد». الكلمات المعتمدة: «مسجَّل»، «غير مسجَّل»،
   «متابعة». (القسم 15: متابعة شخصية دون أحكام.)
3. **لا تنبيه مقارنة** («أقل من الشهر الماضي») إلا بتفعيل صريح من المستخدم في الإعدادات.

### 3.13 جدول الاستثناءات المُوحَّد — مرجع سريع

| المعادلة | يُستثنى منها صريحاً |
|---|---|
| `E(P)` إجمالي المصروفات | التحويلات (إلا العمولة)، **الاقتراض النقدي (R6/أ) لا الشراء بالأجل (R6/ب)**، سداد الديون (إلا الفوائد)، الإقراض، التحصيل، **أصل** أقساط التمويل، التخصيص، التسويات، احتساب الزكاة، الافتتاحي، المعلّقة، **وتصحيحات الفترات السابقة (سطر منفصل)** |
| `I(P)` إجمالي الدخل | الاقتراض، التحصيل، التحويلات، **الدخل المتوقع غير المستلم**، المعلّقة، تصحيحات الفترات السابقة |
| `NetOp(P)` | كل ما سبق (يضم التصحيحات عن قصد — I9) |
| `ΔCash(P)` | الحسابات `isCashLike == false` (ومنها `receivable`)، غير القابل للترحيل، `excludeFromNetWorth`. **ولا تُستثنى الحسابات المؤرشفة** — استبعادها يُنتج `UnclassifiedMinor` كاذباً (3.6 و `06` §8.1/ر-8) |
| `budgetUtil` / `spent` | أقساط التمويل، تصحيحات الفترات المُقفلة، كل المحيَّدات، **والفئات بلا `limitMinor` (م-11)**. و**الشراء بالأجل داخل الاستهلاك لا خارجه** (R6/ب من النواة) |
| `goalProgress` | أهداف `paused`/`cancelled` من الإجمالي |
| `savingsRate` | الاقتراض والتحصيل من المقام |
| `availableCash` | **المستحق لي**، غير القابل للترحيل، `excludeFromNetWorth`، المحجوز (في «المتاح بعد الحجز»). **والمؤرشف رصيده `≠ 0` يُحتسب** (مال موجود فعلاً — `06` §8.1) |
| `HouseholdE` | لا يُجمع مع `E` — هو جزء منه. **وتجميعه من `postings` يلزمه `accountType=='expense'`** وإلا كان صفراً (`06` §5.4/ر-2) |
| إجماليات الديون | `settled`، `cancelled`، والمشطوب من «المستحق لي» |
| تقارير المهام | مهمة `trashed == true` **خارج كل عدّ**؛ ومفتاح تقرير الإنجازات **`completedOn` (`DateKey`) لا `completedAt`** — 3.12 و `09` §4.1 |
| تقرير العبادات | الأيام غير المسجَّلة من **المقام** (تُعرض بعددها) |

---

## 4. استراتيجية التجميع المسبق

### 4.1 الطبقات الثلاث ولماذا ثلاث بالضبط

| الطبقة | المستند | الحبّة | من يكتبها | ما تحلّه |
|---|---|---|---|---|
| **شهرية** | `users/{uid}/periods/{periodKey}` (**موجودة في النواة §4.7**) | شهر ميلادي | معاملة الترحيل (`increment`) | التقرير الشهري بقراءة واحدة، والسنوي بـ12 |
| **يومية** | `users/{uid}/dailyRollups/{dateKey}` (**جديدة — ADR-023 مقترح**) | يوم | معاملة الترحيل (`increment`) | التقرير اليومي والأسبوعي، ومخطط السنة باليوم (365 نقطة) |
| **خادمية بأي بُعد** | `postings` + `getAggregateFromServer` | أي مرشّح مفهرس | لا أحد — تُحسب عند الطلب | أي قطع عرضي (فئة/وسم/جهة/حساب/نطاق) بقراءتين، **وهي مرجع المطابقة** |

**لماذا لا طبقة رابعة** (`categoryPeriods`, `contactPeriods`, `fiscalPeriods` الآن):
كل إسقاط مكتوب على المسار الساخن = سطح انحراف جديد + كتابة إضافية + بند جديد في إعادة البناء.
والقطع العرضي **محلول فعلاً** بـ `postings` بقراءتين. `fiscalPeriods` (محور الشهر المالي، ADR-008)
تبقى **مؤجَّلة** وتُبنى بإعادة البناء عند تفعيل الميزة، بلا أي كتابة على قيد.

### 4.2 `DailyRollup` — المستند الكامل

```ts
// users/{uid}/dailyRollups/{dateKey}        dateKey = 'YYYY-MM-DD' = entry.bookedAt
export interface DailyRollup {
  id: DateKey;
  ownerUid: string;
  schemaVersion: number;
  dateKey: DateKey;
  periodKey: PeriodKey;                 // == dateKey.slice(0,7) — نفس منطق ADR-008

  // ── نشاط اليوم ──
  expenseMinor: number;
  incomeMinor: number;
  householdExpenseMinor: number;         // مجموع فرعي من expenseMinor
  transferVolumeMinor: number;
  obligationPaidMinor: number;
  financingPaidMinor: number;
  borrowedMinor: number;
  repaidMinor: number;
  lentMinor: number;
  collectedMinor: number;

  // ── تصحيحات فترات سابقة مُقفلة (دلتا موقَّعة) — نفس منطق periods تماماً ──
  priorPeriodExpenseCorrectionMinor: number;
  priorPeriodIncomeCorrectionMinor: number;

  /** = incomeMinor − expenseMinor + ppIncCorr − ppExpCorr   (ثابت R-I6) */
  netFlowMinor: number;

  entryCount: number;
  updatedAt: Timestamp;
}
```

**ما لا يُخزَّن فيه عن قصد، وبيان السبب:**

| حقل مرفوض | السبب |
|---|---|
| `expenseByCategory` خريطة | نمو غير محدود لكل يوم بلا فائدة: تفصيل الفئات سؤال شهري لا يومي، وهو موجود في `periods` |
| **أي رصيد (opening/closing)** | **نفس العيب القاتل الذي حسمه ADR-009:** قيد بتاريخ ماضٍ يُبطل كل اللقطات اللاحقة. الحركة فقط |
| `weekKey` | «بداية الأسبوع» إعداد عرض قابل للتغيير؛ تخزينه على مستند يجعل تغييره لاحقاً ترحيلاً. الأسبوع **نطاق على `dateKey`** |
| `balanceVersion` / بصمة | `dailyRollups` ليست مصدر حقيقة؛ المطابقة عبر `postings` |

### 4.3 متى يُكتب، وبأي أسلوب

**أسلوب الكتابة:** `set(..., { merge: true })` مع `increment` على كل الحقول الرقمية، والحقول الثابتة
(`dateKey`, `periodKey`, `ownerUid`, `schemaVersion`) تُكتب كقيم.
**مسموح بـ `increment` بلا قراءة** تطبيقاً لقاعدة النواة الفاصلة (§5.4): **لا قرار يعتمد على النتيجة**
— لا تنبيه ولا حارس يقرأ `dailyRollups`. (وهذا بخلاف `budgetPeriods.spentMinor` الذي يقرأه تنبيه التجاوز.)

**المفتاح = `entry.bookedAt` دائماً** (لا `createdAt`) ⇒ قيد بتاريخ ماضٍ يهبط على يومه الصحيح.

| الحالة | ما يُكتب في `dailyRollups` |
|---|---|
| مصروف/دخل/تحويل/اقتراض/سداد/إقراض/تحصيل/دفع التزام | الحقل المقابل + `entryCount +1` + `netFlowMinor` |
| مصروف موسوم `household` | `expenseMinor +X` **و** `householdExpenseMinor +X` (مجموع فرعي) |
| دفع التزام `nature='expense'` | `expenseMinor +X` + `obligationPaidMinor +X` |
| دفع التزام `nature='financing'` | `obligationPaidMinor +X` + `financingPaidMinor +X` — **`expenseMinor` لا يتغير** |
| عكس قيد من فترة **مفتوحة** | دلتا سالبة على **نفس `dateKey` الأصلي** (سياسة تاريخ النواة §8.3) ⇒ اليوم يعود صحيحاً تلقائياً |
| عكس قيد من فترة **مُقفلة** | `bookedAt = اليوم` و**فقط** `priorPeriod*CorrectionMinor` تتحرك ⇒ لا تلوّث نشاط اليوم |
| تعديل (عكس + بديل) | دلتا **صافية** في نفس المعاملة؛ تعديل التاريخ يُنقل بين يومين (يومان يُكتبان) |
| `earmark` / `adjustment` / `zakatAccrual` / `opening` | **لا شيء** — لا حقل لها في الإسقاط اليومي (محيَّدة)؛ أثرها في `accountPeriods` و`accounts` |

**أثر التكلفة:** تسجيل مصروف ينتقل من **9 كتابات إلى 10** (وإلى 11 لو مسّ يومين في التعديل).
الكتابة العاشرة = **0.005% من حصة Spark اليومية** (20,000 كتابة/يوم) ⇒ الحدّ النظري ينتقل من
~2,200 إلى ~2,000 مصروف/يوم. غير ذي دلالة.
**⚠ هذا انحراف عن جدول النواة §15.1 الذي يُعدّ 9 كتابات ⇒ يحتاج ADR-023 وموافقة المالك (سؤال مفتوح 3).**

### 4.4 خطة بديلة إن رُفض `dailyRollups` (مصمَّمة بالكامل، لا مجرد ذكر)

| التقرير | البديل بلا `dailyRollups` | التكلفة |
|---|---|---|
| اليومي | قراءة قيود اليوم: `journalEntries where bookedAt == D` | 5–25 قراءة |
| الأسبوعي | `journalEntries where bookedAt >= A && bookedAt <= B order by bookedAt` | 35–180 قراءة |
| خط الإنفاق اليومي داخل شهر (30 نقطة) | قيود الشهر (مقروءة أصلاً للتفصيل) ثم تجميع في العميل | 150–500 قراءة |
| **خريطة السنة باليوم (365 نقطة)** | **تتدهور إلى حبّة شهرية (12 نقطة)** من `periods`، مع نصّ صريح: «العرض اليومي يتطلب تفعيل التجميع اليومي» | 12 قراءة |

⇒ **كل التقارير الـ17 تعمل بلا `dailyRollups`؛ الخاسر الوحيد هو مخطط السنة باليوم.**
هذا يجعل ADR-023 تحسيناً لا شرطاً، ولا يُعطَّل أي تسليم في انتظار القرار.

### 4.5 إعادة البناء عند تصحيح عملية قديمة

> **الخبر الجيد المقصود في التصميم: تصحيح عملية قديمة لا يحتاج إعادة بناء إطلاقاً.**

| السبب | التفسير |
|---|---|
| العكس في فترة مفتوحة يحمل **تاريخ الأصل** | الدلتا السالبة تهبط على نفس اليوم ونفس الشهر ⇒ `dailyRollups` و`periods` و`accountPeriods` تعود صحيحة في **نفس المعاملة** |
| العكس في فترة مُقفلة يحمل **تاريخ اليوم** + `isPriorPeriodCorrection` | حقول التصحيح وحدها تتحرك ⇒ تقرير الشهر المُقفل **لا يتغير** (وهو المطلوب: تقرير سُلِّم لا يُعدَّل بأثر رجعي) |
| كل الإسقاطات **تجميعية** | غير حساسة للترتيب (جدول النواة §16.3) ⇒ لا حالة «ترتيب خاطئ ⇒ رقم خاطئ» |
| لا أرصدة مخزونية في أي إسقاط تقارير | لا لقطات تُبطَل (ADR-009) |

**إعادة البناء مطلوبة في أربع حالات فقط** (نفس حالات النواة §16.2):
1. عيب في منطق المُسقِط استمر فترة. 2. إضافة حقل إلى إسقاط قائم بعد تراكم القيود.
3. انحراف كشفته التسوية. 4. إسقاط جديد كلياً (`dailyRollups` نفسه عند اعتماده، أو `fiscalPeriods`).

**إجراء إعادة بناء `dailyRollups`** — يندرج في إجراء النواة ذاته، بإضافة سطر إلى `RebuildPlan.projections`:

```
المرحلة 0 (البوابة)  : meta/integrity.rebuildStatus = 'running'  ⇒ القواعد تمنع أي قيد جديد
المرحلة 1 (التهيئة) : state.dailyRollups = {}        // لا سقوف ولا مُدخلات مستخدم فيها ⇒ تُمسح كلها
المرحلة 2 (التشغيل) : لكل قيد بترتيب (createdAt ASC, __name__ ASC) صفحات 500:
                        d = entry.bookedAt
                        طبّق **نفس** دالة النطاق المستخدمة في المسار الساخن:
                          applyEntryToDailyRollup(state.dailyRollups[d], entry)
                        (دالة واحدة لا نسخة ثانية — القسم 25 بند 7)
المرحلة 3           : لا حقول دالّة في الوقت في هذا الإسقاط ⇒ لا شيء
المرحلة 4 (الكتابة) : writeBatch ≤450 بقيم **مطلقة**: نحو 365 مستنداً/سنة ⇒ سنتان = 730 ⇒ دفعتان
                      + حذف مستندات الأيام التي لم يبق فيها قيد (**مطلوب صريح**: يوم أُلغيت كل قيوده
                      يجب أن يختفي لا أن يبقى بأصفار — وإلا بقيت مستندات ميتة تُقرأ في النطاقات)
المرحلة 5 (التحقق)  : runReportReconciliation(كل الفترات) + auditLogs { action:'projectionsRebuilt' }
```

**idempotent:** قيم مطلقة لا زيادات ⇒ انقطاع ثم استئناف من `rebuildCursor` يُنتج نفس النتيجة.
**غير ذرّية إن تجاوزت دفعة** — مُعلَن، والمعالجة هي البوابة (نفس موقف النواة §18.5).

### 4.6 الذاكرة المؤقتة للتقارير (العميل فقط)

```ts
// src/data/reports/cache.ts
/** مفتاح الذاكرة المؤقتة. تغيّر projectionVersion يُبطل كل شيء فوراً. */
type ReportCacheKey = `${ReportId}|${string}|pv${number}`;   // pv = projectionVersion
```

| ما يُخزَّن محلياً (IndexedDB) | الشرط | الإبطال |
|---|---|---|
| `periods/{pk}` لأشهر **منتهية** | `pk < currentPeriodKey` | تغيّر `projectionVersion` أو وجود `priorPeriod*Correction` جديد على ذلك الشهر |
| `dailyRollups` لأيام **ماضية** | `dateKey < today` | نفس الشرطين |
| نتيجة تقرير سنوي مُحتسبة | السنة منتهية + `projectionVersion` ثابت | نفسه |
| **الشهر الجاري واليوم الجاري** | **لا يُخزَّن أبداً** | — |
| **بصمة السلامة** | **لا تُخزَّن أبداً** — تُحسب عند كل فتح تقرير | — |

**ما رُفض:** ذاكرة مؤقتة بمدة صلاحية زمنية (TTL). السبب: تصحيح عملية قديمة يغيّر شهراً ماضياً،
و TTL تعرض رقماً قديماً **بثقة** حتى تنتهي مدته. الإبطال يكون بـ `projectionVersion` وبعلامة التصحيح،
لا بالساعة.

---

## 5. مطابقة التقارير للعمليات الأصلية (reconciliation)

> مطلب صريح: القسم 23 بند 12 من المتطلبات، والقسم 16.1 من النواة.
> **الفكرة الحاكمة:** المُجمَّعات تُقارن بمصدر **مستقل محمي بالتوازن** هو `postings`،
> لا بنفسها، ولا بإعادة حسابها من نفس الكود الذي كتبها.

### 5.1 ثوابت التقارير القابلة للاختبار (R-I1 … R-I9)

| # | الثابت | الوسيلة | التكلفة |
|---|---|---|---|
| **R-I1** | `Σ signedAmountMinor [postings: periodKey==P, accountType=='expense']` **===** `periods[P].totalExpenseMinor + periods[P].priorPeriodExpenseCorrectionMinor` | `sum()` خادمي | **2 قراءات/شهر** |
| **R-I2** | المِثل للدخل: `… accountType=='income'` **===** `totalIncomeMinor + priorPeriodIncomeCorrectionMinor` (بإشارة الدخل الطبيعية) | `sum()` خادمي | 2/شهر |
| **R-I3** | `Σ_{d ∈ P} dailyRollups[d].F` **===** `periods[P].F` لكل حقل `F` من الحقول الاثني عشر المشتركة | قراءة أيام الشهر | ≤31/شهر |
| **R-I4** | `Σ_{d ∈ P} dailyRollups[d].entryCount` **===** `periods[P].entryCount` | نفس القراءة | 0 إضافية |
| **R-I5** | `ΔCash(P)` من `accountPeriods` **===** `Σ signedAmountMinor [postings: periodKey==P, isCashLike==true]` | `sum()` خادمي + أرصدة | 2 + عدد الحسابات النقدية |
| **R-I6** | لكل يوم: `netFlowMinor === incomeMinor − expenseMinor + ppIncCorr − ppExpCorr` | حسابي محلي | 0 |
| **R-I7** | **لكل تقرير: الإجمالي المعروض === `sumMinor(الصفوف)`** عند عدم وجود تقطيع؛ وعند التقطيع === المُجمَّع المُعلن ومعه وسم «الصفحة تعرض N من M» | اختبار وحدة لكل تقرير | 0 |
| **R-I8** | لكل شهر: `Σ periods[P].expenseByCategory[*] === totalExpenseMinor` (= I14 من النواة) و`householdExpenseMinor ≤ totalExpenseMinor` (= I15) | قراءة واحدة | 1 |
| **R-I9** | **الملف المُصدَّر === الشاشة:** إجماليات XLSX و CSV و PDF لنفس المرشّحات متطابقة حرفياً مع `ReportResult.totals` | اختبار على تجهيزة ثابتة | 0 |

### 5.2 دالة التسوية وواجهتها

```ts
// src/domain/reports/reconcile.ts
export interface ReportReconciliationRequest {
  periods: PeriodKey[];                 // غالباً: الشهر الجاري + الشهر السابق، أو سنة كاملة بطلب المستخدم
  checkDailyRollups: boolean;
  checkCashBridge: boolean;
}

export interface ReportReconciliationReport {
  ranAt: string;
  projectionVersion: number;
  ledgerFingerprint: { sumTotalDebitMinor: Minor; entryCount: number };
  checks: Array<{
    id: 'R-I1' | 'R-I2' | 'R-I3' | 'R-I4' | 'R-I5' | 'R-I6' | 'R-I8';
    scopeKey: string;
    passed: boolean;
    storedMinor: Minor; computedMinor: Minor; deltaMinor: Minor;
  }>;
  verdict: 'matched' | 'drift';
  recommendation: 'ok' | 'rebuildDailyRollups' | 'rebuildProjections' | 'contactOwner';
  estimatedReads: number;
}

export function runReportReconciliation(
  req: ReportReconciliationRequest, io: ReportIO
): Promise<ReportReconciliationReport>;
```

### 5.3 متى تُشغَّل وما يحدث عند الانحراف

| التوقيت | ما يُفحص | التكلفة |
|---|---|---|
| **عند فتح أي تقرير** | بصمة الدفتر (`sum('totalDebitMinor')` + `count()`) + `projectionVersion` + R-I8 للفترة المعروضة | **3–4 قراءات** |
| عند فتح التقرير الشهري/السنوي | R-I1 + R-I2 لكل شهر معروض | 2/شهر (24 للسنة) |
| عند فتح تقرير التدفق النقدي | R-I5 | ~12 |
| عند فتح شاشة التزام/دين | I5b / I6b (النواة) | 2/كيان |
| كل 30 يوماً، وبطلب المستخدم | كل الثوابت على آخر 12 شهراً | ~350 قراءة |
| بعد كل إعادة بناء أو استيراد | الكل | نفسها |

**عند `verdict === 'drift'` — أربعة إجراءات إلزامية ولا خامس:**

1. **شريط أحمر في رأس التقرير** بالنص المعتمد حرفياً:
   > «الأرقام في هذا التقرير لا تطابق دفتر العمليات. الفرق في «مصروفات 2026-09»: 120.000 د.ل.
   > لا تعتمد هذا التقرير حتى إعادة حساب الأرصدة.»
   > [اعرض التفاصيل] [إعادة حساب الأرصدة] [تجاهل مؤقتاً]
2. **إشعار حرج** في مركز التنبيهات (`severity:'critical'`) مرتبط بشاشة «سلامة البيانات».
3. **التصدير يبقى متاحاً** لكن الملف يُوسَم: علامة مائية في PDF، صف أحمر في أول ورقة Excel،
   وسطر `# تحذير: بيانات غير مطابقة — دلتا = …` في أعلى CSV. **لا ملف نظيف من بيانات مشكوك فيها.**
4. **لا تصحيح صامت إطلاقاً.** الخياران: إعادة البناء (المسار الصحيح) أو حركة تسوية مبرَّرة
   عبر `equity.adjustment` بسبب إلزامي — وكلاهما من النواة (§12.10)، ولا ثالث.

**لماذا المطابقة ثنائية الاتجاه ولماذا هذا يكفي:** `postings` محمي بالتوازن (I1 مفروض من الخادم)
وغير قابل للتعديل أو الحذف، و`sum(signedAmountMinor)` يتصافر تلقائياً مع قيود العكس.
⇒ **انحراف في المُجمَّع** يكشفه R-I1/R-I2، و**انحراف في الدفتر نفسه** (كتابة التفّت على المسار)
تكشفه بصمة I10. الجانبان مغطّيان، والتكلفة 3 قراءات لكل فتح تقرير.

---

## 6. سجل التقارير السبعة عشر

### 6.0 كيف وصلنا إلى 17

نصّ القسم 16 يذكر: «يومي، أسبوعي، شهري، سنوي، الدخل، المصروفات، الديون عليّ، الديون لي،
**الالتزامات القادمة والمتأخرة**، مصاريف المنزل، الميزانية والانحرافات، الادخار والأهداف،
حركة الحسابات، التدفق النقدي، المهام والإنجازات، متابعة العبادات».
«الالتزامات القادمة والمتأخرة» **تقريران** لا واحد: مرشّحاتهما وأعمدتهما وترتيبهما وتنبيهاتهما مختلفة
(«المتأخر» يحتاج عمود «أيام التأخير» وترتيباً تنازلياً، و«القادم» يحتاج أفقاً زمنياً وترتيباً تصاعدياً).
⇒ **16 بنداً نصياً = 17 تقريراً**. وتقرير الزكاة **ليس** من هذه السبعة عشر؛ هو شاشة في وحدة العبادات
(القسم 15.4) وتظهر أرقامه في R06 (`expense.charity`) وفي الخصوم (`liability.zakat`).

### 6.1 الجدول الرئيسي

| # | المعرّف | الاسم | مصدر البيانات الأساسي | التجميعات | قراءات (تقدير) | التصدير |
|---|---|---|---|---|---|---|
| R01 | `daily` | التقرير اليومي | `dailyRollups/{D}` + `journalEntries where bookedAt==D` | دخل، مصروف، صافي، عدد العمليات، أعلى فئة | 1 + 5–25 | XLSX, CSV, PDF |
| R02 | `weekly` | التقرير الأسبوعي | `dailyRollups where dateKey ∈ [A..B]` (7) + قيود الأسبوع عند طلب التفصيل | نفسها + متوسط يومي + مقارنة بالأسبوع السابق | 7 (+14 للمقارنة) | XLSX, CSV, PDF |
| R03 | `monthly` | التقرير الشهري | `periods/{P}` + `budgetPeriods/{P}` + `dailyRollups` للشهر | كل مجمَّعات `periods` + الفئات + المنزل + التصحيحات | 1 + 1 + ≤31 | XLSX, CSV, PDF |
| R04 | `yearly` | التقرير السنوي | `periods` ×12 | إجماليات السنة + دمج 12 خريطة فئات + أعلى/أدنى شهر | **12** | XLSX, CSV, PDF |
| R05 | `income` | تقرير الدخل | `periods[*].incomeBySource` + `postings{accountType:'income'}` + قيود الدخل للتفصيل | إجمالي، حسب المصدر، حسب الحساب المستلم، متوسط شهري | 12 + 2/مصدر | XLSX, CSV, PDF |
| R06 | `expenses` | تقرير المصروفات | `periods[*].expenseByCategory` + `postings{categoryId/tag/contactId}` + قيود الفترة | إجمالي، حسب الفئة/الفئة الفرعية/الحساب/الوسم/الجهة، أعلى 10 عمليات | 12 + 2/بُعد | XLSX, CSV, PDF |
| R07 | `debtsPayable` | الديون المستحقة عليّ | `debts where direction=='payable'` + `journalEntries where refs.debtId==X` | إجمالي المتبقي، المسدَّد، حسب الدائن، حسب الاستحقاق، نسبة السداد | ≤50 + 25/دين | XLSX, CSV, PDF |
| R08 | `debtsReceivable` | الديون المطلوب تحصيلها | `debts where direction=='receivable'` + `followUps` + القيود | إجمالي المستحق، المحصَّل، المشطوب، المتأخر، المتوقع تحصيله (7/30 يوماً) | ≤50 + 25/دين | XLSX, CSV, PDF |
| R09 | `obligationsUpcoming` | الالتزامات القادمة | `obligations where status in [upcoming,due,partiallyPaid] && dueDate ≤ today+N order by dueDate` | إجمالي المستحق في الأفق، حسب الأولوية، حسب الجهة، حسب الطبيعة (مصروف/تمويل) | ≤100 | XLSX, CSV, PDF |
| R10 | `obligationsOverdue` | الالتزامات المتأخرة | `obligations where status=='overdue' order by dueDate asc` | إجمالي المتأخر، أقدم تأخير، متوسط أيام التأخير، حسب الجهة | ≤100 | XLSX, CSV, PDF |
| R11 | `household` | مصاريف المنزل | `periods[*].householdExpenseMinor` + `postings{tag:'household', accountType:'expense'}` + `budgetPeriods` لفئات المنزل + قيود موسومة | بالوسم، بفئات المنزل، نسبة من المصروف الكلي، الميزانية مقابل الفعلي | 12 + 2 + 1 + التفصيل | XLSX, CSV, PDF |
| R12 | `budgetVariance` | الميزانية والانحرافات | `budgetPeriods/{P}` + `periods/{P}` | استهلاك عام ولكل فئة، الانحراف، المتبقي، الفئات المتجاوزة، الاتجاه ×12 | 1 + 1 (+12 للاتجاه) | XLSX, CSV, PDF |
| R13 | `savingsGoals` | الادخار والأهداف | `financialGoals` + لقطة `accounts` + `postings{goalId}` + `periods` | إجمالي المخصَّص، التقدم لكل هدف، المطلوب شهرياً، معدَّل الادخار ×12 | ≤10 + 0 + 2/هدف | XLSX, CSV, PDF |
| R14 | `accountStatement` | حركة الحسابات (كشف الحساب) | `journalEntries where accountIds array-contains A && bookedAt ∈ [range] order by bookedAt` + `accountPeriods` للاتجاه | مدين، دائن، الصافي، الرصيد الجاري (الصفحة الأولى فقط)، الحركة الشهرية | 25/صفحة + ≤12 | XLSX, CSV, PDF |
| R15 | `cashFlow` | التدفق النقدي | `accountPeriods where periodKey==P` (نقدية) + `periods/{P}` | ΔCash، الجسر المُصنَّف، **الفرق غير المُصنَّف**، الاتجاه ×12 | ≤10/شهر + 1/شهر | XLSX, CSV, PDF |
| R16 | `tasks` | المهام والإنجازات | `tasks where trashed==false && status=='done' && completedOn ∈ range` + `tasks where trashed==false && status in [todo,inProgress]` | المكتملة، المتأخرة، نسبة الإنجاز، نسبة الالتزام بالموعد، حسب القائمة والأولوية | ≤200 | XLSX, CSV, PDF |
| R17 | `worship` | متابعة العبادات | `worshipDays where periodKey==pk order by dateKey` + `quranSessions where periodKey==pk order by dateKey` | المسجَّل، غير المسجَّل، نسبة على المسجَّل، آيات القرآن (أساسي) وصفحاته (ثانوي)، نسبة الورد، السلسلة | ≤2×أيام النطاق | XLSX, CSV, PDF |

> **قاعدة التصدير الموحَّدة:** الصيغ الثلاث متاحة لكل التقارير الـ17. الاستثناء الوحيد:
> **PDF لا يُصدَّر لجدول > 2,000 صف** (يُقترح XLSX بدلاً منه برسالة صريحة) — القسم 9.5.

### 6.2 تفاصيل كل تقرير: الأعمدة والمرشّحات والاستعلامات

#### R01 — التقرير اليومي

```
الاستعلامات:
  1) dailyRollups/{D}                                                        → 1 قراءة
  2) journalEntries
       where bookedAt == D
       order by bookedAtTs desc
       limit 100                                                             → 5–25 قراءة
     (المرشّح الافتراضي للعرض: status=='posted' && kind!='reversal' — النواة §8.6،
      ويُلغى عند تفعيل includeCorrections)
```
**الأعمدة:** الوقت | النوع | الوصف | الفئة | الحساب | الجهة | الوسوم | المبلغ (3 خانات) | الحالة.
**الإجماليات:** دخل اليوم، مصروف اليوم، الصافي، عدد العمليات، أعلى فئة إنفاقاً، مقارنة بمتوسط
الشهر اليومي (`basis: 'derived'`).
**المرشّحات:** التاريخ (إلزامي)، الحساب، الفئة، الوسم، النوع، نطاق المبلغ، `includeCorrections`.
**الرسوم:** حلقة «مصروف اليوم حسب الفئة» (donut)، شريط أفقي «أعلى 5 عمليات».
**تحذيرات:** إن كان اليوم داخل فترة مُقفلة ⇒ «هذه الفترة مُقفلة؛ أي تصحيح يظهر في الفترة الحالية».

#### R02 — التقرير الأسبوعي

```
حدود الأسبوع: weekStart = settings.display.weekStartsOn  (افتراضي **السبت** = 6)
  from = startOfWeek(anchorDate, weekStart);  to = from + 6 أيام
الاستعلامات:
  1) dailyRollups where dateKey >= from && dateKey <= to order by dateKey     → ≤7
  2) (مقارنة) نفس الاستعلام للأسبوع السابق                                    → ≤7
  3) (تفصيل بطلب المستخدم) journalEntries where bookedAt >= from && <= to
       order by bookedAt limit 250                                            → 35–250
```
**لماذا لا نخزّن `weekKey`:** «بداية الأسبوع» إعداد عرض قابل للتغيير؛ تخزينه على مستند يجعل تغييره
ترحيلاً على بيانات — نفس منطق ADR-008 حرفياً. الأسبوع **نطاق على `dateKey`** ولا شيء غير ذلك.
**الأعمدة (ملخص):** اليوم | التاريخ | الدخل | المصروف | الصافي | عدد العمليات.
**الإجماليات:** إجماليات الأسبوع + متوسط يومي + أعلى يوم إنفاقاً + فرق النسبة عن الأسبوع السابق.
**الرسوم:** أعمدة «الإنفاق لكل يوم» (7 أعمدة، RTL من اليمين)، خط مزدوج دخل/مصروف.

#### R03 — التقرير الشهري

```
  1) periods/{P}                                                              → 1
  2) budgetPeriods/{P}                                                        → 1
  3) dailyRollups where periodKey == P order by dateKey                        → ≤31
  4) (تفصيل) journalEntries where periodKey == P order by bookedAtTs desc
       limit 100 ثم ترقيم بالمؤشر                                              → 100/صفحة
  5) (مطابقة) sumPostings({periodKey:P, accountType:'expense'})                → 2
     sumPostings({periodKey:P, accountType:'income'})                          → 2
```
**الإجماليات المعروضة بالترتيب الإلزامي:**
1) دخل الفترة 2) مصروفات الفترة 3) **تصحيحات فترات سابقة (سطر منفصل)**
4) صافي التدفق (دخل − مصروف ± التصحيحات) 5) مصاريف المنزل (مجموع فرعي، بوسم «منه»)
6) حجم التحويلات (للرقابة، **غير داخل** الدخل أو المصروف) 7) استهلاك الميزانية
8) متوسط الإنفاق اليومي (تقديري) 9) معدل الادخار.
**الأعمدة (جدول الفئات):** الفئة | المصروف | % من الإجمالي | سقف الميزانية | الانحراف | الحالة.
**الرسوم:** حلقة الفئات، أعمدة دخل/مصروف، خط الإنفاق اليومي داخل الشهر، شريط استهلاك الميزانية.
**تحذير إلزامي:** إن وُجد `priorPeriod*CorrectionMinor ≠ 0` ⇒ «يضم هذا الشهر تصحيحات لفترات سابقة
بقيمة …، معروضة في سطر مستقل ولا تدخل نشاط الفترة».

#### R04 — التقرير السنوي

```
  1) periods/{Y}-01 … {Y}-12   (getAll / in-query بدفعتين من 10 و2)            → **12 قراءة**
  2) (اختياري) budgetPeriods ×12                                               → 12
  3) (مطابقة) sumPostings لكل شهر (expense + income)                           → 24
```
**الأعمدة (جدول الأشهر):** الشهر | الدخل | المصروف | الصافي | المنزل | التحويلات | عدد العمليات |
استهلاك الميزانية.
**الإجماليات:** مجاميع السنة، المتوسط الشهري، أعلى/أدنى شهر دخلاً وإنفاقاً، معدّل الادخار السنوي،
المصروف حسب الفئة للسنة (دمج 12 خريطة):
```
yearExpenseByCategory[c] = Σ_{P ∈ 12} (periods[P].expenseByCategory[c] ?? 0)
```
**الرسوم:** أعمدة مكدَّسة بالفئة ×12 شهراً، خط الاتجاه، حلقة الفئات السنوية، خريطة حرارية
بالأيام (365 نقطة — **تتطلب `dailyRollups`**، وإلا تتدهور إلى 12 نقطة برسالة صريحة).
**تحذير إلزامي:** «مجاميع السنة = **نشاط** الأشهر. تصحيحات الفترات المُقفلة تظهر في شهر وقوعها
لا في الشهر الذي تصحّحه.»

#### R05 — تقرير الدخل

```
  1) periods/{P} لكل شهر في النطاق → incomeBySource                            → عدد الأشهر
  2) sumPostings({ bookedAtFrom, bookedAtTo, accountType:'income' })            → 2
  3) لكل مصدر دخل (حساب income، عددها ≤ 10–15):
       sumPostings({ accountId: srcId, bookedAtFrom, bookedAtTo })              → 2/مصدر
  4) (تفصيل) journalEntries where accountIds array-contains {incomeAccountId}
       && bookedAt ∈ range order by bookedAt desc                               → 25/صفحة
```
**الأعمدة:** التاريخ | المصدر | الوصف | الحساب المستلم | المبلغ | مرتبط بجدول دخل؟ | الحالة.
**الإجماليات:** الإجمالي، حسب المصدر (مع %)، حسب الحساب المستلم، المتوسط الشهري،
أعلى مصدر، عدد الدفعات.
**الاستثناء المكتوب في رأس التقرير:** «لا يضم الاقتراض ولا تحصيل الديون ولا التحويلات الداخلية
ولا الدخل المتوقع غير المستلم.»
**الرسوم:** حلقة المصادر، أعمدة الدخل الشهري، خط «الراتب مقابل الدخل الآخر».

#### R06 — تقرير المصروفات

```
  1) periods/{P} ×N  → expenseByCategory                                       → N
  2) sumPostings({ bookedAtFrom, bookedAtTo, accountType:'expense' })          → 2
  3) تفصيل بأي بُعد (أحدها في كل مرة، بحدّ 25 قيمة مفتاح):
       بالفئة  : sumPostings({ categoryId: c, periodKey: P })                   → 2/فئة
       بالوسم  : sumPostings({ tag: t, periodKey: P })                          → 2/وسم
       بالجهة  : sumPostings({ contactId: k, periodKey: P })                    → 2/جهة
       بالحساب : sumPostings({ accountId: a, periodKey: P })                    → 2/حساب
  4) (صفوف) journalEntries where periodKey == P [+ مرشّحات] order by bookedAtTs desc
```
**حدّ صريح على القطع العرضي:** عدد قيم المفتاح > 25 ⇒ **لا نُطلق 60 استعلاماً**؛ تُعرض رسالة
«هذا التفصيل يحتاج قراءة ~N مستنداً» مع [اختر قيماً محدَّدة] أو [تابع ومسح الفترة كاملةً].
**الأعمدة:** التاريخ | الفئة | الفئة الفرعية | الوصف | الحساب | طريقة الدفع | الجهة | الوسوم |
شخصي/منزلي | المبلغ.
**الإجماليات:** الإجمالي، حسب كل بُعد مع %، أعلى 10 عمليات، المتوسط اليومي،
المقارنة بالفترة السابقة بنفس الطول.
**الرسوم:** حلقة الفئات، شريط أفقي «أعلى 10 فئات»، أعمدة شهرية، شريط مكدَّس «شخصي/منزلي».

#### R07 — الديون المستحقة عليّ

```
  1) debts where direction=='payable' && status in ['open','partiallySettled']
       order by expectedSettleAt asc                                            → ≤50
     (فهرس النواة: direction + status + expectedSettleAt ASC — موجود)
  2) (سجل دفعات دين) journalEntries where refs.debtId == X order by bookedAtTs desc → 25
  3) (تحقق I6b) sumPostings({ debtId: X })                                      → 2/دين
```
**الأعمدة:** الدائن | قيمة الدين | المسدَّد | المتبقي | % السداد | تاريخ النشوء |
السداد المتوقع | أيام للاستحقاق | الأولوية | الحالة | نشأ بحركة نقدية؟
**الإجماليات:** إجمالي المتبقي، إجمالي المسدَّد خلال النطاق، عدد الدائنين،
أقرب استحقاق، المتأخر منها.
**المرشّحات:** الدائن، الحالة، نطاق تاريخ النشوء/الاستحقاق، نطاق المبلغ.
**الرسوم:** شريط أفقي «المتبقي لكل دائن»، خط «إجمالي الدين عبر الأشهر»
(من `accountPeriods` لحسابات `liability.payable.*` تراكمياً)، شريط تقدم لكل دين.
**تنبيه:** «تسجيل دين لا يخفض رصيدك النقدي؛ ما يخفضه هو دفعة سداد فعلية.» (R6)

#### R08 — الديون المطلوب تحصيلها

```
  1) debts where direction=='receivable' && status in ['open','partiallySettled']
       order by expectedSettleAt asc                                            → ≤50
  2) debts/{id}/followUps order by at desc limit 10                             → ≤10/دين (عند التوسيع)
  3) sumPostings({ debtId: X })                                                 → 2/دين
```
**الأعمدة:** المدين | الهاتف | قيمة الدين | المحصَّل | المشطوب | المتبقي | تاريخ الدين |
موعد التحصيل | أيام التأخير | آخر متابعة | موعد التواصل القادم | الحالة.
**الإجماليات:** إجمالي المستحق لي، المحصَّل في النطاق، المشطوب، المتأخر،
**المتوقع تحصيله خلال 7 أيام و30 يوماً**، عدد المدينين.
**الرسوم:** شريط أفقي بالمدين، حلقة «في الموعد / متأخر / مشطوب»، خط التحصيلات الشهرية.
**تنبيه إلزامي:** «المستحق لك **ليس** ضمن الأموال المتاحة.» (R9)

#### R09 — الالتزامات القادمة

```
  الأفق N ∈ {7, 30, 90} يوماً (افتراضي 30)
  obligations
    where status in ['upcoming','due','partiallyPaid']
      and dueDate <= addDays(today, N)
    order by dueDate asc
    limit 100                                                                   → ≤100
  (فهرس النواة: status (==) + dueDate ASC — موجود)
```
> **ملاحظة توافق مهمة:** استخدمنا `status in [...]` لا `remainingMinor > 0` **مع** `dueDate <= X`،
> لأن الجمع بين متباينتين على حقلين مختلفين مع `order by dueDate` قيدٌ حسّاس في Firestore،
> بينما `status in [...] + dueDate <=` متباينة واحدة وفهرسها **منصوص في النواة §15.5**.
> وتحديث `status` اليومي مضمون بالمهمة الخفيفة في النواة §10.2. (سؤال مفتوح 4.)

**الأعمدة:** الالتزام | الجهة المستفيدة | الطبيعة (مصروف/تمويل) | القيمة | رسوم إضافية |
المسدَّد | المتبقي | تاريخ الاستحقاق | أيام متبقية | الأولوية | الدورية | الحالة.
**الإجماليات:** إجمالي المستحق في الأفق، منه **تمويلي** (لا يستهلك الميزانية) ومنه **مصروف**،
حسب الأولوية، حسب الجهة، عدد الالتزامات.
**الرسوم:** شريط زمني (timeline) بالاستحقاقات، أعمدة «المستحق لكل أسبوع قادم»،
حلقة بالأولوية.
**تحذير إلزامي:** «الالتزامات ذات الطبيعة التمويلية لا تُحسب مصروفاً ولا تستهلك ميزانية الشهر.»

#### R10 — الالتزامات المتأخرة

```
  obligations where status == 'overdue' order by dueDate asc limit 100           → ≤100
  (أقدم تأخيراً أولاً — ترتيب مقصود: الأقدم أخطر)
```
**الأعمدة:** الالتزام | الجهة | المتبقي | تاريخ الاستحقاق | **أيام التأخير** | الرسوم الإضافية |
سبب الرسوم | الأولوية | آخر دفعة | الحالة الثانية (مسدَّد جزئياً؟).
**الإجماليات:** إجمالي المتأخر، أقدم تأخير (بالأيام)، متوسط أيام التأخير،
عدد الالتزامات المتأخرة، منها مسدَّدة جزئياً.
**قاعدة من النواة §10.2:** «مسدَّد جزئياً **ومتأخر**» يظهر هنا، و`partiallyPaid` **شارة ثانية**
لا حالة بديلة. تجاهل هذا يُخفي التزاماً من شاشة المتابعة.
**الرسوم:** شريط أفقي بأيام التأخير (تنازلي)، حلقة بالجهة.

#### R11 — مصاريف المنزل

```
  1) periods/{P} ×N → householdExpenseMinor, totalExpenseMinor, expenseByCategory → N
  2) sumPostings({ tag:'household', accountType:'expense', periodKey:P })        → ⌈n/1000⌉/شهر
     // **`accountType` شرط صحة لا تحسين:** وسوم القيد تُنسخ على **كل** سطوره، فالتجميع
     // بالوسم وحده يُرجع **صفراً دائماً** (رجل المصروف +X ورجل النقد −X)
     // — `06-module-map.md` §5.4/ر-2 والثابت M-I19 والاختبار T-HH-9؛ والفهرس `PG4`.
  3) budgetPeriods/{P} → سقوف فئات expense.home.*                                  → 1/شهر
  4) (صفوف) journalEntries where tags array-contains 'household' && periodKey == P
       order by bookedAtTs desc                                                    → 25/صفحة
     (فهرس النواة: tags array-contains + bookedAtTs DESC — موجود)
```
**محوران معنونان صريحاً** (لا يوحَّدان — انظر 3.10): «بالوسم `household`» و«بفئات المنزل».
**الأعمدة:** التاريخ | الفئة الفرعية | الوصف | الحساب | المبلغ | موسوم؟ | ضمن فئة منزل؟
**الإجماليات:** إجمالي المنزل، **% من المصروف الكلي**، ميزانية المنزل، الفعلي، المتبقي،
الانحراف، حسب الفئة الفرعية (غذائية/تنظيف/خدمات/صيانة/أثاث/عائلية/موسمية/طارئة).
**تحذير إلزامي (القسم 11):** «هذه الأرقام **مجموع فرعي** من مصروفات الفترة، ولا تُضاف إليها.»
**الرسوم:** حلقة الفئات الفرعية، أعمدة الميزانية مقابل الفعلي، خط اتجاه شهري،
شريط «نسبة المنزل من الإنفاق الكلي».

#### R12 — الميزانية والانحرافات

```
  1) budgetPeriods/{P}                                                            → 1
  2) periods/{P}                                                                  → 1
  3) (اتجاه) budgetPeriods ×12 + periods ×12                                      → 24
```
**الأعمدة:** الفئة | السقف | المصروف | المتبقي | % الاستهلاك | **الانحراف** (موجب = تجاوز) |
عتبة التنبيه | هل أُطلق التنبيه | الحالة (آمن/قريب/متجاوز/بلا ميزانية).
**الإجماليات:** السقف العام، المصروف العام، الاستهلاك %، الانحراف الكلي،
عدد الفئات المتجاوزة، أكبر تجاوز، الفئات بلا ميزانية (**وقيمة إنفاقها** — بند مهم: إنفاق خارج أي سقف).
**قواعد العرض الإلزامية:**
- فئة بلا `limitMinor` ⇒ صف بـ «—» في السقف و«لم تُحدَّد ميزانية» في الحالة، **لا 0 ولا ∞**.
- شهر بلا مستند ميزانية ⇒ شاشة كاملة بنص «لم تُحدَّد ميزانية لهذا الشهر» + [أنشئ ميزانية].
- تصحيح فترة مُقفلة **لا يظهر** في هذا التقرير (`budgetPeriods` لا تُلمس) + تذييل يوضّح ذلك.
**الرسوم:** أشرطة تقدم لكل فئة (أخضر/كهرماني/أحمر حسب العتبة)، أعمدة «سقف مقابل فعلي»،
خط «الاستهلاك عبر 12 شهراً»، شريط انحراف (مُنحرف موجب/سالب حول الصفر).

#### R13 — الادخار والأهداف

```
  1) financialGoals (كلها)                                                        → ≤10
  2) accountsSnapshot()  → أرصدة حسابات الدعم والحجز                              → **0**
  3) sumPostings({ goalId: g.id, bookedAtFrom, bookedAtTo })                       → 2/هدف
  4) periods ×N → I(P), E(P) لمعدَّل الادخار                                        → N
  5) accountPeriods where accountId == backingAccountId (للاتجاه)                   → ≤12/هدف
```
**الأعمدة:** الهدف | النوع (حساب مدعوم/حجز دفتري) | قيمة الهدف | المُدخَر | المتبقي |
% التقدم | تاريخ الهدف | أشهر متبقية | **المطلوب شهرياً** | الحالة.
**الإجماليات:** إجمالي المخصَّص للادخار (الأهداف النشطة)، إجمالي قيم الأهداف،
% التقدم الكلي، **معدَّل الادخار (الفائض)** و**الادخار المخصَّص** معاً، أقرب هدف للإنجاز.
**تنبيهان إلزاميان:** «حجز دفتري: المال لا يزال في حسابك» (`virtualEarmark`)،
و«مبالغ الحساب المدعوم مشمولة في الأموال المتاحة» (`backedAccount`) — لمنع العدّ المزدوج.
**الرسوم:** أشرطة تقدم لكل هدف، خط «المُدخَر عبر الأشهر»، أعمدة «الفائض مقابل المخصَّص»،
حلقة «توزيع المُدخَر بين الأهداف».

#### R14 — حركة الحسابات (كشف الحساب)

```
  1) journalEntries
       where accountIds array-contains {accountId}
         and bookedAt >= from and bookedAt <= to
       order by bookedAt desc
       limit 25  (ثم startAfter بالمؤشر)                                           → 25/صفحة
     (فهرس النواة: accountIds array-contains + bookedAt ASC — موجود، ويخدم الاتجاهين)
  2) accountPeriods where accountId == A order by periodKey asc                     → ≤12–24
  3) accountsSnapshot()[A]  → الرصيد الحالي والافتتاحي                              → 0
```
**مرشّح دورة الحياة هنا مختلف عن بقية الشاشات (النواة §8.6):** الكشف يعرض **كل** القيود
`posted` و`reversed` و`replaced` **بما فيها `reversal`**، لأن إخفاء العكس يجعل مجموع الكشف ≠ الرصيد.
**الأعمدة:** التاريخ | الوصف | الطرف المقابل | النوع | مدين | دائن | **الرصيد الجاري
(الصفحة الأولى فقط)** | الحالة | يعكس/استُبدل بـ | معرّف القيد.
**الرصيد الجاري (قصور مُعلَن، النواة §18.2):** يُحسب في العميل تنازلياً من `account.balanceMinor`
في الصفحة الأولى فقط. الصفحات الأعمق والتصدير الكامل **بلا عمود رصيد جارٍ**، ويُكتب ذلك في
رأس العمود وفي تذييل الملف المُصدَّر — لا عمود فارغ بلا تفسير.
**الإجماليات:** مدين الفترة، دائن الفترة، الصافي، الرصيد الافتتاحي المشتق للفترة
(`closingBalanceAt(P−1)`)، الرصيد الختامي، عدد الحركات.
**الرسوم:** خط «رصيد الحساب عبر الأشهر» (تجميع تراكمي من `accountPeriods`، ADR-009)،
أعمدة «مدين/دائن شهرياً».
**زر «فحص هذا الحساب»** ⇒ `reconcileAccount` من النواة (§12.10) بتكلفة معروضة.

#### R15 — التدفق النقدي

```
  1) accountPeriods where periodKey == P    (ثم تصفية isCashLike في العميل من لقطة accounts)
       → ΔCash(P)                                                                  → ≤10–45/شهر
  2) periods/{P}                                                                   → 1/شهر
  3) (مطابقة R-I5) sumPostings({ periodKey: P, isCashLike: true })                  → 2/شهر
  4) (تفسير الفرق، بطلب صريح) journalEntries where periodKey == P                   → 150–500
```
**الأعمدة (جسر الشهر):** البند | المبلغ | الاتجاه | المصدر.
الصفوف بالترتيب الإلزامي:
`+ الدخل المستلم` · `− المصروفات` · `+ الاقتراض النقدي` · `− سداد الديون` · `− الإقراض`
· `+ تحصيل الديون` · `− أصل أقساط التمويل` · `± تصحيحات فترات سابقة`
· `= صافي التغير المُصنَّف` · **`± فرق غير مُصنَّف`** · `= ΔCash الفعلي (من أرصدة الحسابات)`.
**قاعدة غير قابلة للتفاوض:** سطر «فرق غير مُصنَّف» **يُعرض دائماً حتى لو كان صفراً**
(وجوده الدائم هو ما يجعل ظهور قيمة فيه ذا معنى)، ومعه زر [فسِّر هذا الفرق] بتكلفته المعروضة.
**الرسوم:** شلال (waterfall) للجسر، خط ΔCash عبر 12 شهراً، أعمدة «داخل/خارج» شهرياً.
**تذييل إلزامي:** «صافي التدفق في لوحة التحكم = دخل − مصروف. التغيّر الفعلي في النقد يضم
الاقتراض والسداد والإقراض والتحصيل وأصل التمويل.»

#### R16 — المهام والإنجازات

```
م-21 — الاستعلامان القديمان باطلان: 'doing' ليست قيمة في TaskStatus، و completedAt طابع زمني
       (حدوده تختلف عن اليوم المحلي)، ولا مرشّح trashed ⇒ مهام السلة كانت تُحسب إنجازاً.
الاستعلامان المعتمدان (وفهرساهما **موجودان فعلاً** في 09 §12):
  1) tasks where trashed == false && status == 'done'
          && completedOn >= from && completedOn <= to
       order by completedOn desc                                                     → ≤200
     (فهرس 09: tasks: trashed (==) + status (==) + completedOn DESC — **موجود**)
  2) tasks where trashed == false && status in ['todo','inProgress']
          && dueDate <= to
       order by dueDate asc                                                          → ≤200
     (فهرس 09: tasks: trashed (==) + status (in) + dueDate ASC — **موجود**)
  3) (المهام بلا موعد) tasks where trashed == false && status in ['todo','inProgress']
          && dueDate == null  — تُعرض بعددها فقط                                      → ≤50
**لا فهارس جديدة مطلوبة من هذه الوثيقة لـ R16.** (التصريحان القديمان
 `tasks: completedAt ASC` و`tasks: status (==) + dueDate ASC` محذوفان: الأول فهرس أحادي
 تلقائي على حقل لم يبقَ مستخدماً، والثاني ينقصه `trashed` فلا يخدم الاستعلام المعتمد.)
```
**عقد القراءة** — **مُثبَّت الآن من `09-personal-worship.md` §4.1، لا مقترح:**
`status: 'todo'|'inProgress'|'done'|'cancelled'` · `dueDate: DateKey | null` ·
`dueTime: string | null` · `completedAt: Timestamp | null` · `completedOn: DateKey | null` ·
`priority: 1|2|3` · `listId: string | null` · `recurrenceId: string | null` ·
`occurrenceKey: DateKey | null` · `trashed: boolean` · `subtasks: Subtask[]`.
**ثابت P4 من 09:** `completedAt != null ⟺ status === 'done'` — وعليه تُبنى قاعدة «لا إكمال ضمني».
**الأعمدة:** المهمة | القائمة | الأولوية | تاريخ الاستحقاق | تاريخ الإكمال | التأخير (أيام) |
الحالة | ملاحظات التنفيذ.
**الإجماليات:** المكتملة، المفتوحة، المتأخرة، % الإنجاز، % الالتزام بالموعد،
متوسط التأخير (تقديري)، أكثر قائمة إنجازاً.
**قاعدة إلزامية (القسم 14):** مهمة بلا `completedAt` **ليست مكتملة** ولا تدخل البسط، مهما كانت
قيمة `status`. أي تناقض بين الاثنين يُعرض كصف «حالة غير متسقة» لا يُصحَّح صامتاً.
**م-22:** ومهمة `status === 'done'` بـ `completedOn === null` (مهمة أُكملت قبل إضافة الحقل، أو
كتابة من نسخة قديمة) **لا تدخل أي نطاق** ⇒ تُجمَع في سطر صريح «مكتملة بلا تاريخ إكمال: N»
داخل التقرير، لا تُحذف ولا تُنسب إلى النطاق المعروض اعتباطاً.
**م-23 — المهام المتكررة:** كل دورة مستند مستقل (`recurrenceId` + `occurrenceKey`، 09 §4.5)
⇒ «مهمة أسبوعية أُنجزت 4 مرات» تظهر **4 صفوف** لا صفاً واحداً. مقصود ومُعلَن في تذييل R16،
ومع عمود «الدورة» (`occurrenceKey`) حتى لا تُقرأ كأربع مهام مختلفة.
**الرسوم:** أعمدة «المكتملة لكل أسبوع»، حلقة بالأولوية، خط «المتأخرة عبر الزمن».

#### R17 — متابعة العبادات

```
م-24 — الاستعلامان القديمان باطلان: لا مجموعة `worshipRecords` ولا `quranProgress` في النظام.
المعتمد من 09 §5.1 و§6.1:
  1) worshipDays — مُعرّف المستند **هو** dateKey ⇒ الاستعلام بالمُعرّف لا بحقل:
       where documentId() >= from && documentId() <= to                               → ≤أيام
     (وللشهر الكامل: where periodKey == P order by dateKey — فهرس 09 **موجود**)
     غياب المستند = «لم تُسجَّل» ⇒ **لا تهيئة مسبقة ولا مستندات صفرية** (09 §5.3)
  2) quranSessions where dateKey >= from && dateKey <= to order by dateKey             → 0–4/يوم
     (وللشهر: where periodKey == P order by dateKey — فهرس 09 **موجود**)
     ⚠ **الحبّة «جلسة» لا «يوم»** ⇒ عدد القراءات **ليس** عدد الأيام بل عدد الجلسات
       (0–4 لليوم، 30–90 للشهر حسب 09 §6.2) ⇒ جدول 10.2 مُصحَّح.
  3) settings/quranGoal (أو مستند الهدف في 09 §6.4)                                     → 1
**لا فهارس جديدة مطلوبة من هذه الوثيقة لـ R17.**
```
**عقد القراءة — مُثبَّت من `09-personal-worship.md`:**
`worshipDays/{dateKey}`: `prayers: Record<'fajr'|'dhuhr'|'asr'|'maghrib'|'isha',
{ state: 'unset'|'onTime'|'qada'; jamaah: boolean; recordedAt: Timestamp|null; note?: string }>` ·
`fasting: { state: 'unset'|'fasted'|'notFasted'; kind?: FastingKind }` ·
`habits: Record<string, { value: number; updatedAt: Timestamp }>` · `hijriLabel: string` ·
`periodKey: PeriodKey` · `note?: string`.
`quranSessions/{sessionId}`: `dateKey` · `periodKey` · `mode: 'reading'|'memorizing'|'reviewing'|'listening'` ·
`from`/`to: QuranPosition` · `ayahCount: number` · `pagesTouched: number` · `minutes: number|null`.
**ثلاثة فروق لها أثر مباشر على التقرير:**
1. **`'qada'` ليست `'missed'`.** «قضاء» أداء، لا تفويت. ⇒ `onTimePrayers` و`qadaPrayers`
   عمودان مستقلان، و**لا عمود «فائتة» إطلاقاً** لأن النموذج لا يسجّل التفويت أصلاً.
2. **`jamaah` بُعد مستقل** ⇒ عمود/إجمالي إضافي («المسجَّل جماعةً»)، وهو مطلب القسم 15 بند 1.
3. **لا حقل `charity: boolean`.** الصدقة **عملية مالية في الدفتر** (`expense.charity`) وثابت P20
   في 09 يمنع أي حقل مبلغ في `worshipDays` ⇒ الصدقة تُقرأ في R06 لا في R17؛ وما يُعرض في R17
   هو عدّاد عادة (`habits`) إن أنشأه المستخدم، **بلا أي مبلغ**.
4. **الصيام:** `fasting.state` ثلاثي + `kind` ⇒ العمود «صيام» ثلاثي القيم ومعه نوعه، لا نعم/لا.
**الأعمدة (مُصحَّحة، م-24):** التاريخ (ميلادي + `hijriLabel` المخزَّن) | الفجر | الظهر | العصر |
المغرب | العشاء (كل خلية: الحالة + شارة «جماعة») | آيات القرآن | صفحات ملموسة | دقائق |
الصيام (الحالة + النوع) | عدّادات العادات | ملاحظات.
**الإجماليات:** الأيام في النطاق، **الأيام المسجَّلة**، **الأيام غير المسجَّلة**،
الصلوات المسجَّلة، منها **في وقتها** ومنها **قضاءً** ومنها **جماعةً** (أعمدة لا نسب حكمية)،
نسبة «في وقتها» **من المسجَّل**، آيات القرآن (الأساسي)، الصفحات الملموسة (ثانوي)،
نسبة الورد من الهدف، أطول سلسلة أيام مكتملة.
**الثلاثة الممنوعة:** لا مقام يضم غير المسجَّل، لا لفظ تقييمي («تقصير/ضعيف»)،
لا مقارنة بفترة سابقة إلا بتفعيل المستخدم.
**التقويم:** الميلادي افتراضاً والهجري بجانبه (القسم 3 من المتطلبات)،
والهجري **عرض فقط** ولا يُستخدم مفتاحاً ولا في أي استعلام.
**م-25 — مصدر التاريخ الهجري كان غير محدَّد:** التقرير **لا يحسب** الهجري، بل يقرأ
`worshipDays.hijriLabel` **المخزَّن لقطةً** (09 §2.2) ⇒ التقرير والشاشة والملف المُصدَّر تتطابق
دائماً ولو تغيّر محرّك التحويل أو نسخة `Intl`. ولليوم بلا مستند (غير مسجَّل) يُحسب العنوان عرضاً
بـ `Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura')` **بتقويم أم القرى حصراً**، ومعه تذييل:
«التاريخ الهجري للعرض فقط وقد يختلف يوماً عن الرؤية المحلية».
**الرسوم:** خريطة حرارية بالأيام (مسجَّل/غير مسجَّل)، أعمدة «صفحات القرآن أسبوعياً»،
خط السلسلة. **بلا أي ترميز لوني يحمل حكماً** (لا أحمر للفائت؛ رمادي = غير مسجَّل).

---

## 7. لوحة التحكم — كل بطاقة ومصدرها ومعادلتها وتكلفتها

> كل البطاقات تقرأ من **لقطة واحدة حيّة** (`onSnapshot` على `accounts` + 4 مستندات)،
> فتكلفة الفتحة الباردة ≈ 120 قراءة (جدول النواة §15.3) والفتحات التالية في الجلسة ≈ 0–5.

| # | البطاقة | المصدر بالضبط | المعادلة | قراءات إضافية | الأساس |
|---|---|---|---|---|---|
| **C01** | إجمالي الأموال المتاحة | لقطة `accounts` | `Σ balanceMinor where isCashLike && active && isPostable` | **0** | actual |
| **C02** | المتاح بعد حجز الأهداف | لقطة `accounts` | `Σ (balanceMinor − earmarkedMinor)` لنفس المجموعة | **0** | actual |
| **C03** | إجمالي الدخل الشهري | `periods/{P}` | `I(P) = totalIncomeMinor` | 1 (مشتركة) | actual |
| **C04** | إجمالي المصروفات الشهرية | `periods/{P}` | `E(P) = totalExpenseMinor` | 0 (نفس المستند) | actual |
| **C05** | صافي التدفق (دخل − مصروف) | `periods/{P}` | `NetOp(P)` — معادلة 3.3 | 0 | actual |
| **C06** | الالتزامات القادمة | `obligations status in [upcoming,due,partiallyPaid] && dueDate ≤ +30d limit 10` | `Σ remainingMinor` + العدد | ≤10 | actual |
| **C07** | الالتزامات المتأخرة | `obligations status=='overdue' order by dueDate limit 10` | `Σ remainingMinor` + العدد + أقدم تأخير | ≤10 | actual |
| **C08** | إجمالي الديون المستحقة عليّ | لقطة `accounts` (`subtype ∈ {payable, financing}`) | `totalPayablesMinor` | **0** | actual |
| **C09** | إجمالي المستحق لي | لقطة `accounts` (`subtype=='receivable'`) | `totalReceivablesMinor` | **0** | actual |
| **C10** | إجمالي مصروفات المنزل | `periods/{P}` | `HouseholdE(P)` + `householdShareBps(P)` | 0 | actual |
| **C11** | المبالغ المخصصة للادخار | `financialGoals` + لقطة `accounts` | `Σ goalSavedMinor(g)` حيث `status=='active'` | ≤10 | actual |
| **C12** | نسبة استهلاك الميزانية | `budgetPeriods/{P}` | `budgetUtilBps(P)` — `null` ⇒ «لم تُحدَّد ميزانية» | 1 | actual |
| **C13** | مهام اليوم | `tasks where dueDate == today limit 10` | العدد + المتأخرة منها | ≤10 | actual |
| **C14** | التنبيهات المهمة | `notifications where read==false order by createdAt desc limit 10` | العدد حسب الأهمية | ≤10 | actual |
| — | *(اختيارية، خلف إعداد)* صافي الثروة | لقطة `accounts` | `netWorthMinor` | 0 | actual |
| — | *(اختيارية)* متوسط الإنفاق اليومي | `periods/{P}` | `avgDailyExpense(P)` | 0 | **derived** |
| — | *(اختيارية)* المتوقع لنهاية الشهر | `periods/{P}` | `projectedMonthEnd(P)` | 0 | **projected** |

**قواعد البطاقات الإلزامية:**
1. **C01 يحمل نصاً ثابتاً تحته:** «لا يشمل المبالغ المستحقة لك» (R9 من النواة).
2. **C01 و C02 و C08 و C09 لا تُجمَع في رقم واحد أبداً** (قرار النواة الصريح).
3. **C05 اسمه في الواجهة «صافي التدفق (دخل − مصروف)»** لا «صافي التدفق النقدي» المطلق —
   التغيّر الفعلي في النقد في R15. (سؤال مفتوح 2.)
4. **C12 عند `overallLimitMinor === null`** ⇒ «لم تُحدَّد ميزانية لهذا الشهر» + [أنشئ ميزانية].
   **لا 0% ولا شريط فارغ.**
5. **سطر «تصحيحات فترات سابقة»** يظهر **تحت C03/C04** عند `priorPeriod*Correction ≠ 0`،
   بشارة منفصلة، ولا يُدمج في رقم البطاقة.
6. **كل بطاقة لها أيقونة ⓘ** تفتح لوحة «مصدر هذا الرقم» تعرض `DataSourceRef` حرفياً + المعادلة.
7. التخصيص (ترتيب/إظهار/إخفاء) في `settings/dashboard` (قراءة واحدة) — لا يغيّر أي معادلة.
8. **الأزرار السريعة** (مصروف/دخل/دين/مهمة) تفتح النماذج التي تولّد `opId` عند التركيب (النواة §6.2).

**رسوم لوحة التحكم الثلاثة (القسم 4 من المتطلبات):**

| الرسم | المصدر | قراءات |
|---|---|---|
| المصروفات حسب الفئة (حلقة) | `periods/{P}.expenseByCategory` + أسماء الفئات من مخزن الفئات | 0 إضافية |
| مقارنة الإيرادات بالمصروفات (أعمدة مزدوجة ×6 أشهر) | `periods` ×6 (الأشهر المنتهية من الذاكرة المحلية) | ≤6 أول مرة، ثم 1 |
| اتجاهات الإنفاق عبر الأشهر (خط ×12) | `periods` ×12 | ≤12 أول مرة، ثم 1 |

---

## 8. الرسوم البيانية

### 8.1 القرار: Recharts — والبدائل المرفوضة

| المعيار | **Recharts (المختار)** | ECharts | visx | Chart.js |
|---|---|---|---|---|
| تقنية الرسم | **SVG في DOM** | Canvas (افتراضياً) | SVG | Canvas |
| **تشكيل العربية و bidi** | **يرثه من المتصفح على عقد `<text>`** ⇒ سليم تماماً، قابل للتحديد والنسخ والترجمة | المتصفح يرسم النصّ في Canvas (التشكيل سليم) لكن **لا تحكّم CSS ولا تحديد ولا نسخ** | مثل Recharts | مثل ECharts |
| قلب المحاور لـ RTL | `<XAxis reversed />` + `<YAxis orientation="right" />` | `inverse: true` + محاذاة | يدوي بالكامل | إضافات/حلول جزئية |
| الحجم (تقريبي بعد gzip، **يجب التحقق ببناء فعلي**) | متوسط (عشرات الكيلوبايتات مع اعتماديات d3 الجزئية) | **الأكبر** حتى مع الاستيراد الانتقائي | **الأصغر** (استيراد ذرّي) | متوسط |
| ما نكتبه بأنفسنا | غلاف + منسّقات | غلاف + إدارة دورة الحياة الإمبراطيفية | **المحاور والتلميحات والمفاتيح والشبكة و RTL = مكتبة رسوم خاصة** | غلاف + إضافات |
| ملاءمة React 19 | تصريحية أصلاً | `useEffect` + `dispose` + تسريبات محتملة | تصريحية | وسيط إلزامي |
| أداؤنا المطلوب (≤ 365 نقطة، ≤ 12 سلسلة) | **كافٍ تماماً** | أفضل عند عشرات الآلاف (**لا نحتاجه**) | كافٍ | كافٍ |

**الحسم:** حجّتنا الأولى **RTL والعربية**، والثانية **عدم كتابة مكتبة رسوم**. `SVG` في DOM يعطينا
التشكيل العربي الصحيح مجاناً + تحكّم CSS كامل + طباعة PDF نظيفة (القسم 9.3) + إمكانية تحديد النصّ.
Canvas يُفقدنا الثلاثة. و visx يُحمّلنا كتابة المحاور والتلميحات بأنفسنا لأحد عشر رسماً.
**الشرط المرافق:** كل الرسوم خلف طبقة `src/ui/charts/**`، و**لا مكوّن تقرير يستورد من `recharts`
مباشرة** (قاعدة بناء B11 المقترحة) ⇒ تبديل المكتبة لاحقاً تغييرٌ في ملف أو اثنين لا في ثلاثين شاشة.

### 8.2 عقد طبقة الرسوم

```ts
// src/ui/charts/types.ts  — **الأرقام تدخل Minor وتخرج منسَّقة؛ الرسم لا يحسب شيئاً**
export type ChartKind = 'bar' | 'groupedBar' | 'stackedBar' | 'line' | 'area'
                      | 'donut' | 'hBar' | 'waterfall' | 'progress' | 'heatmap' | 'timeline';

export interface ChartSeriesPoint {
  key: string;                 // categoryId | dateKey | periodKey …
  labelAr: string;             // نصّ عربي جاهز (لا ترجمة في طبقة الرسم)
  valueMinor: Minor;
  /** للتقديرات فقط: يُرسم منقّطاً وبشارة «تقديري» — P4. */
  basis?: MetricBasis;
}

export interface ChartSpec {
  id: string;
  kind: ChartKind;
  titleAr: string;
  series: Array<{ id: string; nameAr: string; points: ChartSeriesPoint[] }>;
  /** دالة التنسيق الممرَّرة من النطاق — **لا toLocaleString داخل الرسم** (B8). */
  formatValue: (m: Minor) => string;
  formatAxisTick?: (m: Minor) => string;    // مختصر: "1,250" أو "1.2K"
  rtl: true;                                 // ثابت — لا رسم LTR في هذا النظام
  emptyStateAr: string;                      // «لا بيانات في هذه الفترة»
  sourceIndex: number;                       // ربط بـ ReportResult.sources — P3
}
```

**مقتطف التهيئة RTL المعتمد (يُكتب مرة واحدة في `ChartFrame.tsx`):**

```tsx
// src/ui/charts/ChartFrame.tsx
<div dir="rtl" className="h-[320px] w-full [&_text]:fill-[var(--chart-text)]">
  <ResponsiveContainer>
    <BarChart data={data} margin={{ top: 8, left: 8, right: 8, bottom: 24 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      {/* RTL: الفئة الأولى على اليمين، وقيم المحور على اليمين */}
      <XAxis dataKey="labelAr" reversed tickMargin={8} interval="preserveStartEnd" />
      <YAxis orientation="right" tickFormatter={spec.formatAxisTick} width={72} />
      <Tooltip content={<RtlTooltip format={spec.formatValue} />} />
      <Legend align="right" verticalAlign="top" />
      <Bar dataKey="valueMinor" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
</div>
```

**خمس قواعد إلزامية على كل رسم:**
1. `reversed` على المحور الفئوي و`orientation="right"` على المحور الرقمي — وإلا قُرئ الزمن معكوساً.
2. **التلميح (Tooltip) مكوّن خاص** بـ `dir="rtl"` ويستدعي `spec.formatValue` — لا تنسيق افتراضي.
3. **الأرقام لاتينية** (ق-3): كل منسّق يمرّ بـ `formatLYD`/`formatPercentBps`.
4. **حالة فارغة نصية** لا مخطط فارغ: «لا بيانات في هذه الفترة» (القسم 25 بند 4).
5. **تحميل متأخر:** `const Charts = lazy(() => import('./charts'))` لكل مسار تقرير، مع هيكل عظمي
   (skeleton) أثناء التحميل — حتى لا يدفع فاتح لوحة التحكم ثمن حزمة الرسوم كلها مرة واحدة.

### 8.3 الرسوم المطلوبة لكل شاشة

| الشاشة | الرسوم |
|---|---|
| لوحة التحكم | حلقة الفئات · أعمدة مزدوجة دخل/مصروف ×6 · خط اتجاه الإنفاق ×12 |
| R01 اليومي | حلقة فئات اليوم · شريط أفقي أعلى 5 عمليات |
| R02 الأسبوعي | أعمدة الأيام السبعة · خط مزدوج دخل/مصروف |
| R03 الشهري | حلقة الفئات · أعمدة دخل/مصروف · خط الإنفاق اليومي · شريط استهلاك الميزانية |
| R04 السنوي | أعمدة مكدَّسة بالفئة ×12 · خط الاتجاه · حلقة الفئات السنوية · **خريطة حرارية 365 يوماً** |
| R05 الدخل | حلقة المصادر · أعمدة شهرية · خط «راتب مقابل غيره» |
| R06 المصروفات | حلقة الفئات · شريط أفقي أعلى 10 · أعمدة شهرية · مكدَّس شخصي/منزلي |
| R07 ديون عليّ | شريط أفقي بالدائن · خط إجمالي الدين ×12 · أشرطة تقدم |
| R08 ديون لي | شريط أفقي بالمدين · حلقة حالات التحصيل · خط التحصيلات |
| R09 القادمة | شريط زمني · أعمدة «المستحق لكل أسبوع» · حلقة الأولوية |
| R10 المتأخرة | شريط أفقي بأيام التأخير · حلقة بالجهة |
| R11 المنزل | حلقة الفئات الفرعية · أعمدة ميزانية/فعلي · خط شهري · شريط النسبة من الكل |
| R12 الميزانية | أشرطة تقدم بالعتبات · أعمدة سقف/فعلي · خط الاستهلاك ×12 · شريط الانحراف |
| R13 الأهداف | أشرطة تقدم · خط المُدخَر · أعمدة فائض/مخصَّص · حلقة التوزيع |
| R14 كشف الحساب | خط رصيد الحساب ×12 (تراكمي) · أعمدة مدين/دائن شهرياً |
| R15 التدفق | **شلال الجسر** · خط ΔCash ×12 · أعمدة داخل/خارج |
| R16 المهام | أعمدة المكتملة أسبوعياً · حلقة الأولوية · خط المتأخرة |
| R17 العبادات | خريطة حرارية بالأيام (رمادي = غير مسجَّل) · أعمدة صفحات القرآن · خط السلسلة |

**11 نوعاً للرسم** (`ChartKind`) تغطي الجدول كله — والتزامنا ألّا يزيد النوع الثاني عشر بلا مبرر مكتوب.

---

## 9. التصدير

### 9.1 الهندسة المشتركة

```ts
// src/domain/reports/export/contract.ts  — **نقي**: يُنتج نموذجاً مجرَّداً لا ملفاً
export interface ExportTable {
  titleAr: string;
  subtitleAr: string;                 // الفترة والمرشّحات بنصّ عربي مقروء
  columns: Array<{
    key: string;
    headerAr: string;
    type: 'text' | 'date' | 'money' | 'int' | 'percent' | 'status';
    widthHint?: number;
    /** للمبالغ فقط. */
    align?: 'start' | 'end';
  }>;
  rows: Array<Record<string, string | number | Minor | null>>;
  /** صفوف الإجماليات — **قيم محسوبة من Minor**، لا صيغ. */
  totals: Array<{ labelAr: string; values: Record<string, Minor | number | null> }>;
  /** تذييل إلزامي: البصمة، الاستثناءات، القصور المُعلَن. */
  footerAr: string[];
  integrity: ReportIntegrityStamp;
}

/** نقية وقابلة للاختبار: تحويل ReportResult إلى جدول مجرَّد. */
export function toExportTable<R, T>(result: ReportResult<R, T>, def: ReportDefinition<R, T>): ExportTable;
```

ثم ثلاثة مُحوِّلات في `src/data/reports/export/`: `toXlsx.ts` و`toCsv.ts` و`toPrintHtml.ts`.
**كلها تعمل في المتصفح؛ لا بيانات تُرسل إلى أي خادم** (مكسب خصوصية مباشر على Spark، القسم 20).

**تذييل إلزامي في كل ملف مُصدَّر (الصيغ الثلاث):**

```
رصيد | RASEED — <اسم التقرير>
الفترة: 2026-09-01 إلى 2026-09-30   |   أُنشئ: 2026-10-09 14:22
المالك: محمد إبراهيم البرشي   |   العملة: الدينار الليبي (LYD)، 3 خانات عشرية (الدرهم)
بصمة الدفتر: مجموع المدين = 128,450.750 د.ل   |   عدد القيود = 1,284   |   إصدار الإسقاط = 7
نتيجة المطابقة: مطابق ✓     (أو: ⚠ غير مطابق — الفرق: …)
مستثنى من هذا التقرير: التحويلات الداخلية، الاقتراض والسداد، الإقراض والتحصيل،
أصل أقساط التمويل، التخصيص لأهداف، التسويات، العمليات بانتظار المزامنة.
```

**اسم الملف (ASCII مقصوداً):**
`RASEED-monthly-2026-09-01_2026-09-30-20261009-1422.xlsx`
**السبب:** أسماء الملفات العربية تُشوَّه في بعض أنظمة الملفات وخدمات المشاركة وسجلات التنزيل.
**العنوان العربي داخل الملف** في الخلية A1 وفي عنوان الصفحة، فلا يفقد المستخدم شيئاً.

### 9.2 Excel — `exceljs`

**القرار: `exceljs` محمَّلاً عند الطلب.** ما رُفض: SheetJS (توزيع بُنية المجتمع على npm غير موثوق،
ودعم التنسيقات والعرض RTL أضعف)، و«CSV فقط» (يُفقدنا التنسيق الرقمي وتجميد الرؤوس والمرشّحات).

```ts
// src/data/reports/export/toXlsx.ts
export async function exportXlsx(table: ExportTable): Promise<Blob> {
  const ExcelJS = await import('exceljs');                 // تحميل متأخر — لا ثمن على الفتحة الأولى
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RASEED';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName(table.titleAr), {   // ≤31 محرفاً، بلا [ ] : * ? / \
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],   // ← ورقة RTL حقيقية
    properties: { defaultRowHeight: 18 },
  });

  // 1) ترويسة
  ws.mergeCells(1, 1, 1, table.columns.length);
  ws.getCell('A1').value = table.titleAr;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = table.subtitleAr;
  if (table.integrity.verdict === 'drift') {
    const c = ws.getCell('A3');
    c.value = `⚠ بيانات غير مطابقة لدفتر العمليات — ${table.integrity.stampTextAr}`;
    c.font = { bold: true, color: { argb: 'FFB00020' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7E9' } };
  }

  // 2) رؤوس الأعمدة
  const headerRow = ws.getRow(4);
  table.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.headerAr;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };
    ws.getColumn(i + 1).width = col.widthHint ?? (col.type === 'money' ? 16 : 22);
  });
  headerRow.commit();

  // 3) الصفوف — **التحويل إلى الوحدة الكبرى يحدث هنا فقط، في دالة واحدة**
  for (const r of table.rows) {
    const row = ws.addRow(table.columns.map((c) => cellValue(r[c.key], c.type)));
    table.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.type === 'money') { cell.numFmt = '#,##0.000'; cell.alignment = { horizontal: 'right' }; }
      if (c.type === 'percent') cell.numFmt = '0.0%';
      if (c.type === 'date') cell.numFmt = 'yyyy-mm-dd';
      if (c.type === 'text' || c.type === 'status')
        cell.alignment = { horizontal: 'right', readingOrder: 'rtl', wrapText: true };
    });
  }

  // 4) صفوف الإجماليات — **قيم محسوبة من Minor، لا صيغ SUM**
  for (const t of table.totals) {
    const row = ws.addRow(totalsToArray(t, table.columns));
    row.font = { bold: true };
    row.eachCell((cell, i) => {
      if (table.columns[i - 1]?.type === 'money') cell.numFmt = '#,##0.000';
    });
    row.border = { top: { style: 'double' } };
  }

  ws.autoFilter = { from: { row: 4, column: 1 },
                    to: { row: 4, column: table.columns.length } };

  // 5) ورقة «المصدر والتدقيق»
  const meta = wb.addWorksheet('المصدر والتدقيق', { views: [{ rightToLeft: true }] });
  meta.addRows(table.footerAr.map((line) => [line]));
  meta.addRow([]);
  meta.addRow(['المجموعة', 'الاستعلام', 'نوع التجميع', 'قراءات مقدَّرة']);
  // … صفوف sources

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** **نقطة التحويل الوحيدة** من Minor إلى رقم Excel. لا تُكرَّر في أي مكان آخر. */
export function minorToSheetNumber(m: Minor): number { return m / MINOR_PER_UNIT; }
```

**ثلاثة قرارات صريحة في تصدير Excel:**

1. **الإجماليات قيم لا صيغ.** السبب: الإجمالي المعروض على الشاشة مُحتسب على `Minor` (عدد صحيح)،
   وصيغة `SUM` في Excel تجمع أعداداً عشرية مزدوجة. لو اختلفا في الخانة الثالثة لظهر «الملف لا يطابق
   الشاشة» — وهو خرق R-I9. **الملف يطابق الشاشة حرفياً.**
2. **حدّ دقّة مُعلَن:** الأعمدة المالية تُكتب بالوحدة الكبرى (`minor/1000`) كأعداد مزدوجة. تجميع
   المستخدم بنفسه في Excel **قد** ينحرف في منازل بعيدة جداً عن الخانة الثالثة في مجاميع ضخمة
   (آلاف الصفوف × ملايين الدنانير). للأحجام الواقعية في هذا النظام الفرق **صفر عملياً**.
   ولمن يحتاج دقّة مطلقة: ورقة **«أعداد صحيحة (درهم)»** اختيارية تحمل `amountMinor` صحيحاً
   بتنسيق `#,##0` — جمعها في Excel **مضبوط بالوحدة**.
3. **حدّ الحجم:** > 100,000 صف ⇒ رفض صريح برسالة «حجم كبير جداً لصيغة Excel — استخدم CSV أو
   قسّم الفترة»، مع عرض عدد الصفوف المقدَّر **قبل** بدء التوليد. التوليد يعمل في Web Worker
   مع شريط تقدم؛ لا تجميد للواجهة.

### 9.3 PDF — HTML + طباعة المتصفح

**القرار: لا مكتبة PDF في الواجهة. التوليد عبر مسار طباعة مخصَّص + `window.print()`.**

**لماذا رُفض كل بديل، صريحاً:**

| البديل | سبب الرفض |
|---|---|
| **pdfmake + خط عربي مُضمَّن** | pdfmake **لا يملك محرّك تشكيل (shaping)** ولا bidi. تضمين خط عربي يحل مشكلة *المحارف* لا مشكلة *التشكيل*: تخرج الحروف **منفصلة** («ا ل ر ص ي د») وبترتيب معكوس في النصّ المختلط. مرفوض نهائياً — ومصيبة أن يُسلَّم تقرير مالي عربي بهذا الشكل |
| **jsPDF (+ خط)** | نفس العيب جوهرياً؛ دعم RTL جزئي وغير موثوق للنص المختلط عربي/أرقام لاتينية — وحالتنا **كلها** نصّ مختلط (ق-3) |
| **pdf-lib** | بلا تشكيل كذلك؛ أدنى مستوى |
| **@react-pdf/renderer** | محرّك تخطيط خاص بلا تشكيل عربي موثوق |
| **Puppeteer/Chromium على الخادم** | **الحل الأمثل تقنياً، لكنه يتطلب Blaze** (ق-1) ⇒ يُبنى خلف منفذ `PdfPort` ويُفعَّل عند الترقية بلا إعادة بناء |

**ما نفعله فعلاً:**

```
المسار: /print/report/:reportId?<نفس مرشّحات التقرير>
 1) الشاشة تفتح نافذة/إطاراً على هذا المسار (نفس الأصل، نفس الجلسة، نفس البيانات)
 2) الصفحة تُعيد استخدام **نفس** ReportResult (تُمرَّر عبر sessionStorage بمفتاح مؤقت
    لتجنّب إعادة القراءة من Firestore ⇒ **0 قراءات إضافية للطباعة**)
 3) بعد اكتمال الرسم (requestAnimationFrame ×2 + انتهاء رسوم SVG) ⇒ window.print()
 4) المستخدم يختار «الحفظ كـ PDF» من حوار الطباعة
```

```css
/* src/ui/print/print.css — يُحمَّل في مسار الطباعة فقط */
@page { size: A4; margin: 14mm 12mm 16mm 12mm; }

html[dir="rtl"] body.print-root {
  direction: rtl;
  font-family: 'Noto Naskh Arabic', 'Cairo', 'Segoe UI', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;     /* ق-3 — محاذاة الخانات */
  color: #111;
  background: #fff;
}

@media print {
  .no-print, nav, aside, button, .app-shell { display: none !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* تكرار رؤوس الجدول على كل صفحة — بديل مضمون عن ترقيم CSS غير المدعوم */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr, .chart-block, .totals-block { break-inside: avoid; page-break-inside: avoid; }
  h2, h3 { break-after: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; }
  th { text-align: right; background: #eff3f8; }
  td.money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  svg { max-width: 100%; height: auto; }          /* الرسوم SVG تُطبع نظيفة */
  .drift-banner { border: 2px solid #b00020; color: #b00020; padding: 6px; }
  .watermark { position: fixed; inset: 40% 0 auto 0; text-align: center;
               font-size: 48pt; color: rgba(176,0,32,.12); transform: rotate(-18deg); }
}
```

**ثلاثة قصور مُعلَنة في مسار PDF (لا نخفيها):**
1. **لا ترقيم صفحات داخل المحتوى.** صناديق هوامش CSS (`@page { @bottom-center }`) غير مدعومة في
   متصفحات Chromium. المعالجة: ترويسة/تذييل المتصفح نفسه (يعرض رقم الصفحة والتاريخ) + تكرار رأس
   الجدول على كل صفحة. والتذييل الإلزامي (البصمة) يُطبع **في أول صفحة وآخرها** لا في كل صفحة.
2. **خطوة يدوية واحدة:** على المستخدم اختيار «الحفظ كـ PDF» في الحوار. نعرض تعليمة واحدة بالعربية.
   لا نَعِد بزر «نزّل PDF» ينتج ملفاً فوراً — **وعدٌ لا نستطيع الوفاء به على Spark**.
3. **الخطوط:** نضمّن خطاً عربياً واحداً (`Noto Naskh Arabic` أو `Cairo`) في أصول التطبيق
   (لا من شبكة خارجية وقت الطباعة)، وإلا اختلف المظهر بين الأجهزة.
**عند الترقية إلى Blaze:** `PdfPort` ينتقل من `BrowserPrintPdfAdapter` إلى `ServerRenderPdfAdapter`
(Puppeteer على نفس HTML) ⇒ **زر واحد وملف فوري بلا تغيير في أي تقرير**.

### 9.4 CSV — BOM و UTF-8 والفواصل

```ts
// src/data/reports/export/toCsv.ts
export interface CsvOptions {
  delimiter: ',' | ';';        // الافتراضي ','
  includeSepLine: boolean;     // الافتراضي false
  numbersAs: 'major' | 'minor';// الافتراضي 'major' (وحدة كبرى بثلاث خانات)
}

const BOM = '﻿';
const CRLF = '\r\n';

/** تحييد حقن الصيغ: خلية تبدأ بـ = + - @ أو TAB/CR قد تُنفَّذ كصيغة في Excel. */
function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvCell(v: string): string {
  const s = neutralizeFormula(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(table: ExportTable, o: CsvOptions): Blob {
  const d = o.delimiter;
  const lines: string[] = [];

  if (o.includeSepLine) lines.push(`sep=${d}`);              // Excel فقط — غير افتراضي
  lines.push(csvCell(`# ${table.titleAr}`));
  lines.push(csvCell(`# ${table.subtitleAr}`));
  if (table.integrity.verdict === 'drift')
    lines.push(csvCell(`# تحذير: بيانات غير مطابقة — ${table.integrity.stampTextAr}`));

  lines.push(table.columns.map((c) => csvCell(c.headerAr)).join(d));
  for (const r of table.rows)
    lines.push(table.columns.map((c) => csvCell(csvValue(r[c.key], c.type, o))).join(d));
  for (const t of table.totals)
    lines.push(table.columns.map((c) => csvCell(csvTotal(t, c, o))).join(d));
  for (const f of table.footerAr) lines.push(csvCell(`# ${f}`));

  // BOM إلزامي: Excel على Windows بلا BOM يفترض ترميز النظام ⇒ «ÙØµØ±ÙˆÙ»
  return new Blob([BOM + lines.join(CRLF) + CRLF], { type: 'text/csv;charset=utf-8' });
}
```

**القرارات الخمسة في CSV، كل منها لحل مشكلة معروفة:**

| المشكلة | الحل المعتمد | ما رُفض ولماذا |
|---|---|---|
| **العربية تظهر محارف مشوَّهة في Excel** | **BOM (`﻿`) في بداية الملف** + `charset=utf-8` في نوع الـ Blob | UTF-16LE بمفصل TAB (أكثر «ضماناً» في Excel لكنه يكسر `git`/Python/أي مُحلِّل آخر) |
| **الفاصلة مقابل الفاصلة المنقوطة** حسب إعدادات Windows الإقليمية | الافتراضي `,` (قياسي RFC 4180) + **خيار `;` في حوار التصدير** + خيار سطر `sep=;` لمن يحتاجه | `sep=` كافتراضي: يُظهره كل مُحلِّل آخر كصف بيانات |
| **حقن الصيغ** (خلية تبدأ بـ `=`) | تصدير مسبوقة بعلامة اقتباس فردية | تجاهل المشكلة — خطر تنفيذ أوامر عند فتح الملف |
| **الأرقام** | الوحدة الكبرى بثلاث خانات ونقطة عشرية `.` **وبلا فواصل آلاف** (الفواصل تكسر CSV وتُربك التحليل) + خيار «درهم صحيح» للتدقيق | تنسيق معروض بفواصل آلاف داخل CSV |
| **الاتجاه** | **لا محارف تحكّم bidi (RLM/LRM) في البيانات** | إدراج `U+200F` في كل خلية: يلوّث البيانات لكل مستهلك آخر، والاتجاه مسؤولية العارض |

**التواريخ:** `YYYY-MM-DD` دائماً (ISO)، وهو ما تفهمه Excel وأي أداة. **لا تنسيق محلي في CSV.**

### 9.5 مصفوفة الصيغ لكل تقرير

| التقرير | XLSX | CSV | PDF | ملاحظة |
|---|---|---|---|---|
| R01–R04 (زمنية) | ✓ | ✓ | ✓ | PDF هو الشكل المُعتاد للتسليم الشهري/السنوي |
| R05, R06 | ✓ | ✓ | ✓ | CSV مفضَّل عند > 2,000 صف |
| R07, R08 | ✓ | ✓ | ✓ | PDF مناسب للمشاركة مع الطرف الآخر |
| R09, R10 | ✓ | ✓ | ✓ | — |
| R11–R13 | ✓ | ✓ | ✓ | — |
| **R14 كشف الحساب** | ✓ | ✓ | ✓ (≤2,000 صف) | **عمود الرصيد الجاري غائب في التصدير** (قصور النواة §18.2) ويُكتب في التذييل |
| R15 التدفق | ✓ | ✓ | ✓ | يتضمن سطر «فرق غير مُصنَّف» إلزاماً |
| R16, R17 | ✓ | ✓ | ✓ | R17 يحمل تنبيه خصوصية في التذييل |
| **النسخة الاحتياطية الكاملة** | — | — | — | **JSON فقط** عبر `integrity.exportAllJson` من النواة (§17.3) — **ليست تقريراً** |

**حدّ PDF المعلن:** جدول > 2,000 صف ⇒ رسالة «هذا التقرير كبير للطباعة؛ استخدم Excel أو قلّص الفترة»
مع الخيارين. لا توليد ملف ضخم يُجمّد المتصفح.

---

## 10. الأداء والفهارس والتكلفة

### 10.1 الفهارس الجديدة التي تطلبها طبقة التقارير

> **إضافات على جدول النواة §15.5، لا تعديلاً عليه.** كلها إضافية ولا تكسر فهرساً قائماً.
>
> **تصحيح اتساق (تدقيق مالي) — مرجع واحد للفهارس:** الملف المنشور هو
> `firestore.indexes.json`، ومصدره الوحيد هو **`03-data-model.md` §10.1 و§10.2** (96 فهرساً
> و55 استثناءً). فهارس هذا القسم **مُدمَجة هناك بالفعل** بالرموز `AP2`, `JE16`, `JE17`,
> `PO16`, `PO17`, `PG1…PG12`. **ولا يُنشر فهرس من هذه الوثيقة مباشرة.**

```
# ── تجميعات خادمية (الحقل المُجمَّع آخرُ حقل في الفهرس — شرط sum، انظر 03 §9.1(هـ)) ──
postings:  periodKey (==) + isCashLike (==) + signedAmountMinor      ← R-I5            = PG5
postings:  isCashLike (==) + bookedAt ASC + signedAmountMinor        ← ΔCash نطاق جزئي  = PG9
postings:  contactId (==) + periodKey (==) + signedAmountMinor       ← R07/R08         = PG7
postings:  goalId (==) + periodKey (==) + signedAmountMinor          ← R13             = PG8
postings:  periodKey (==) + accountType (==) + signedAmountMinor     ← R-I1/R-I2/Q61   = PG3
postings:  categoryId (==) + periodKey (==) + signedAmountMinor      ← Q62             = PG6
postings:  periodKey (==) + accountType (==) + tags (◇) + signedAmountMinor ← M-I6/R11 = PG4

# ── صفوف ونطاقات ──
postings:  accountType (==) + bookedAt ASC + signedAmountMinor       ← R06 نطاق جزئي  = PO5 (مُلحَق)
postings:  categoryId (==)  + bookedAt ASC + signedAmountMinor       ← R06 بالفئة     = PO7 (مُلحَق)
postings:  contactId (==)   + bookedAt ASC + signedAmountMinor       ← م-26           = PO13 (مُلحَق)
postings:  goalId (==)      + bookedAtTs ASC + signedAmountMinor     ← R13 خطوة 3     = PO12 (مُلحَق)
postings:  tags (◇) + accountType (==) + bookedAt ASC + signedAmountMinor ← R11 نطاق جزئي = PO17
postings:  accountId (==) + accountType (==) + periodKey (==)        ← R05 لكل مصدر   = PO16
accountPeriods:  periodKey (==) + accountId ASC                      ← R15 (ΔCash)    = AP2
journalEntries:  tags (◇) + periodKey (==) + bookedAtTs DESC         ← R11 خطوة 4     = JE16
journalEntries:  periodKey (==) + accountTypes (◇) + bookedAtTs DESC ← R05/R06 بالنوع = JE17

# ── م-27 مُصحَّحة: ما كان مطلوباً هنا موجود أصلاً في 03 §10، وسطران كانا خطأً ──
# `journalEntries: periodKey (==) + bookedAtTs DESC`  ⇐ **موجود**: الفهرس `JE6`
#   (periodKey ASC + bookedAtTs ASC) يخدمه، لأن الفهرس المركَّب يخدم الاتجاهين لآخر حقل (م-28).
# `journalEntries: accountIds (◇) + bookedAt ASC + __name__ ASC` ⇐ **زائد**: Firestore يُلحق
#   `__name__` تلقائياً باتجاه آخر حقل ⇒ الفهرس `JE2` يعطي الترقيم الحتمي نفسه.
# `journalEntries: bookedAt (==) + bookedAtTs DESC` ⇐ **فهرس بلا معنى يُحذف**: العقد §4.3 يعرّف
#   `bookedAtTs` بأنه **منتصف نهار UTC لذلك اليوم** ⇒ كل قيود اليوم الواحد لها **نفس القيمة**
#   بالضبط، فالترتيب بها داخل `bookedAt ==` لا يرتّب شيئاً. R01 (التقرير اليومي) يكفيه
#   `where bookedAt == D` بالفهرس الأحادي التلقائي، والترتيب الحتمي بـ `__name__`.

# الإسقاط اليومي: **لا يُنشر حتى إقرار ADR-023** (القسم 14: «مقترح — يحتاج موافقة المالك»)
# dailyRollups:  periodKey (==) + dateKey ASC        ← يُضاف إلى 03 §10.2 عند الإقرار فقط

# ── م-21/م-24: وحدتا المهام والعبادات — **لا فهرس جديد من هذه الوثيقة** ──
# كل ما تحتاجه R16 و R17 منصوص في 09-personal-worship.md §12 ومملوك لها:
#   tasks:          trashed (==) + status (==) + completedOn DESC
#   tasks:          trashed (==) + status (in) + dueDate ASC
#   tasks:          trashed (==) + listId (==) + status (in) + orderKey ASC
#   worshipDays:    periodKey (==) + dateKey ASC
#   quranSessions:  periodKey (==) + dateKey ASC
#   quranSessions:  dateKey (==)   + createdAt DESC
# (المحذوف من النسخة السابقة: tasks: completedAt ASC ، tasks: status (==) + dueDate ASC ،
#  worshipRecords: dateKey ASC ، quranProgress: dateKey ASC — ثلاثة منها على مجموعات لا وجود لها،
#  والرابع فهرس أحادي تلقائي لا يُصرَّح به.)
```

**م-28 — قاعدة فهرسة صريحة لمنع التكهّن:** Firestore يُنشئ **تلقائياً** فهرساً أحادياً تصاعدياً
وتنازلياً لكل حقل غير مستثنى ⇒ **كل سطر في `firestore.indexes.json` لا بد أن يكون مركَّباً
(حقلان أو أكثر) أو على مصفوفة**. أي سطر أحادي في هذه الوثيقة خطأ تحرير يُحذف.
وفهرس مركَّب واحد **يخدم الاتجاهين** (تصاعدي وتنازلي) لآخر حقل في الترتيب — فلا نكرره بالاتجاهين.

**استثناءات الفهرسة الأحادية المقترحة (لتقليل تكلفة الكتابة):**
على `dailyRollups` تُلغى فهرسة كل الحقول الرقمية (`expenseMinor`, `incomeMinor`, … `netFlowMinor`,
`entryCount`) — لا نستعلم عليها أبداً، والاستعلام دائماً بالمفتاح أو بنطاق `dateKey`/`periodKey`.
هذا يخفض تكلفة الكتابة العاشرة إلى أدناها.

### 10.2 تكلفة كل تقرير — جدول الحكم

| التقرير | قراءات الفتحة الأولى | التالية في الجلسة | الحكم على Spark (50,000/يوم) |
|---|---|---|---|
| لوحة التحكم | ~120 | 0–5 | ~410 فتحة باردة/يوم |
| R01 اليومي | 7–30 | ≤3 | مريح جداً |
| R02 الأسبوعي | 8–25 (+تفصيل) | ≤7 | مريح |
| R03 الشهري | ~37 (+100/صفحة تفصيل) | ≤5 | مريح |
| **R04 السنوي** | **12 (+24 للمطابقة)** | **≤4** | **هذا هو المكسب الأساسي: 36 قراءة لتقرير سنة كاملة** |
| R05 الدخل (سنة) | 12 + 2×عدد المصادر ≈ 42 | ≤4 | مريح |
| R06 المصروفات (سنة، بُعد واحد) | 12 + 2×عدد الفئات ≈ 50 | ≤4 | مريح — والحدّ 25 مفتاحاً يحمي من الانفجار |
| R07/R08 | ≤50 (+2/كيان عند التحقق) | ≤10 | مريح |
| R09/R10 | ≤100 | ≤10 | مريح |
| R11 المنزل (سنة) | 12 + 24 + 12 ≈ 48 | ≤5 | مريح |
| R12 الميزانية (مع الاتجاه) | 26 | ≤2 | مريح |
| R13 الأهداف | ≤30 | ≤5 | مريح |
| R14 كشف الحساب | 25/صفحة + ≤24 | 25/صفحة | **التكلفة بالتصفّح** — حجم الصفحة ≤100 |
| R15 التدفق (سنة) | ≤120 + 12 + 24 ≈ 156 | ≤12 | مريح؛ «تفسير الفرق» وحده مكلف وبإذن صريح |
| R16 المهام | ≤200 | ≤20 | مريح |
| R17 العبادات (شهر) | ≤62 | ≤10 | مريح |
| **تصدير تفصيلي لسنة** | **عدد قيود السنة (2,000–6,000)** | — | **يحتاج موافقة صريحة بالتكلفة** (10.3) |

### 10.3 حارس ميزانية القراءة

```ts
// src/data/reports/readBudget.ts
export interface ReadEstimate { reads: number; docs: number; aggregates: number; }

/** يُعرض **قبل** التنفيذ. يستخدم ReportDefinition.plan() النقية. */
export function estimateReads(def: ReportDefinition<any, any>, f: ReportFilters): ReadEstimate;

export const READ_CONFIRM_THRESHOLD = 1_000;   // فوقها: تأكيد صريح
export const READ_HARD_CAP          = 20_000;  // فوقها: رفض + اقتراح تقسيم الفترة
```

نص التأكيد العربي المعتمد:
> «سيقرأ هذا التقرير نحو 3,400 مستنداً من قاعدة البيانات. المشروع على الخطة المجانية
> (حدّ تقريبي 50,000 قراءة يومياً). متابعة؟»
> [متابعة] [قلّص الفترة] [إلغاء]

**عدّاد الاستهلاك المحلي:** عدّاد تقديري في IndexedDB يجمع القراءات المنفَّذة في اليوم،
ويُعرض في شاشة «سلامة البيانات».
**الصدق المطلوب:** Firestore **لا يُتيح للعميل قراءة حصّته الفعلية** ⇒ هذا **تقدير** مبني على
ما نفّذناه نحن، ولا يحتسب قراءات القواعد (`exists()`/`get()`) ولا قراءات أجهزة أخرى.
يُكتب ذلك حرفياً تحت العدّاد. **لا نعرض رقماً موثوقاً على أنه حصة حقيقية.**

### 10.4 قواعد الأداء السبع

1. **التجميعات الخادمية قبل المسح.** أي سؤال «ما مجموع X؟» يُجاب بـ `getAggregateFromServer`
   (قراءتان) لا بتنزيل الصفوف.
2. **الصفوف تُنزَّل فقط حين تُعرض أو تُصدَّر.** لا تقرير يقرأ الصفوف ليحسب إجمالياً له مُجمَّع.
3. **الترقيم بالمؤشر** (`startAfter(docSnapshot)`) لا بالإزاحة (`offset` يُحاسَب على المستندات المتخطَّاة).
4. **`onSnapshot` واحد للحسابات** على مستوى التطبيق، ويُعاد استخدامه في كل تقرير بـ 0 قراءات.
5. **الأشهر المنتهية غير قابلة للتغيير عملياً** ⇒ تُخزَّن محلياً بمفتاح `projectionVersion` (4.6).
6. **الرسوم محمَّلة متأخراً** لكل مسار تقرير (8.2 قاعدة 5).
7. **التصدير في Web Worker** مع شريط تقدم وإمكانية إلغاء؛ لا تجميد للواجهة ولو لثانية.

---

## 11. الأمان والخصوصية في التقارير والتصدير

| البند | التطبيق |
|---|---|
| عزل البيانات | كل استعلام تحت `users/{uid}/**` وقواعد النواة تحصره على UID المعتمد (ق-2). **لا استعلام مجموعة فرعية عابر للمستخدمين (`collectionGroup`) في أي تقرير** — ممنوع بقاعدة بناء مقترحة B12 |
| القراءة فقط | طبقة التقارير **لا تكتب في Firestore إطلاقاً**، باستثناء `auditLogs { action:'dataExported' }` عند التصدير (مطلب النواة §17.3). لا كتابة مُجمَّعات من مسار قراءة |
| الأسرار | لا مفاتيح ولا إعدادات إدارية في أي ملف مُصدَّر. التذييل يحمل بصمة الدفتر و`projectionVersion` فقط — لا `uid` ولا رموز وصول |
| توليد محلي | الملفات الثلاثة تُولَّد **في المتصفح**؛ لا خادم وسيط ولا خدمة تحويل خارجية ⇒ البيانات المالية لا تترك الجهاز |
| البيانات الحسّاسة في R17 | تذييل إلزامي: «يتضمن هذا الملف بيانات متابعة شخصية. تعامل معه كبيانات خاصة.» |
| هواتف المدينين (R08) | عمود الهاتف **مُستبعَد افتراضياً** من التصدير، ويُضاف بخيار صريح في حوار التصدير |
| التنزيل | `Blob` + `URL.createObjectURL` ثم `revokeObjectURL` فوراً — لا رفع ولا مشاركة تلقائية |
| سجل التدقيق | كل تصدير ⇒ `auditLogs { action:'dataExported', targetCollection:'reports', targetId: reportId, reason: نطاق المرشّحات }` |

---

## 12. الاختبارات الإلزامية لطبقة التقارير

| المجموعة | المحتوى | البيئة |
|---|---|---|
| **T-RPT-FORMULA** | جدول لكل معادلة في القسم 3: مدخلات ⇒ ناتج متوقَّع بالضبط، مع حالات `null` (مقام صفري، ميزانية غير محدَّدة، هدف بلا قيمة، لا دخل) | وحدة |
| **T-RPT-EXCLUDE** | **صفّ لكل صف في جدول 3.13**: تسجيل تحويل/اقتراض/سداد/إقراض/تحصيل/قسط تمويلي/تخصيص/تسوية/احتساب زكاة ⇒ **`E` و`I` لا تتغير** و`budgetPeriods` لا تُلمس | وحدة + محاكي |
| **T-RPT-TOTALS** | ثابت R-I7 لكل التقارير الـ17: الإجمالي === `sumMinor(الصفوف)`؛ وعند التقطيع: الإجمالي من المُجمَّع + وسم «N من M» موجود | وحدة |
| **T-RPT-RECON** | ثوابت R-I1…R-I6 و R-I8 على بيانات **فيها إلغاءات وتعديلات وقيود بتاريخ ماضٍ وتصحيحات فترات مُقفلة** — **وهذا هو اختبار «التقارير تطابق العمليات»** (القسم 23 بند 12) | محاكي |
| **T-RPT-DRIFT** | زرع انحراف يدوي في `periods.totalExpenseMinor` ⇒ R-I1 يكتشفه، **والشريط الأحمر يظهر، والملف المُصدَّر يحمل الوسم**، ولا تصحيح صامت | محاكي |
| **T-RPT-DAILY** | `Σ dailyRollups` لشهر === `periods` لكل الحقول الاثني عشر، مع: قيد بتاريخ ماضٍ، عكس في فترة مفتوحة، عكس في فترة مُقفلة، تعديل ينقل التاريخ بين يومين | محاكي |
| **T-RPT-REBUILD** | إعادة بناء `dailyRollups` من الصفر تُنتج نفس المستندات بالضبط؛ خلط ترتيب التشغيل ⇒ نفس النتيجة؛ انقطاع واستئناف ⇒ نفس النتيجة؛ **يوم أُلغيت كل قيوده يُحذف مستنده** | محاكي |
| **T-RPT-YEAR** | التقرير السنوي = **12 قراءة** (يُقاس فعلياً بعدّاد قراءات المحاكي، والاختبار يفشل إن زاد)؛ ومجاميعه = مجموع الأشهر = `sum('signedAmountMinor')` على `postings` | محاكي |
| **T-RPT-BRIDGE** | جسر التدفق النقدي: شراء بالأجل ⇒ **«فرق غير مُصنَّف» يظهر بقيمته الصحيحة** ولا يُخفى؛ وبلا حالات شاذة ⇒ الفرق = 0 والسطر **موجود** | وحدة + محاكي |
| **T-RPT-EMPTY** | كل تقرير على بيانات فارغة ⇒ نصّ «لا بيانات» المحدَّد، **لا أصفار مُقدَّمة كحقائق**، ولا قسمة على صفر، ولا `NaN` ولا `Infinity` في أي مخرج | وحدة |
| **T-RPT-BUDGET-NULL** | شهر بلا ميزانية ⇒ «لم تُحدَّد ميزانية»؛ فئة بلا سقف ⇒ «—»؛ تجاوز 112% ⇒ **يُعرض 112% لا 100%** | وحدة |
| **T-RPT-RTL** | كل رسم: المحور الفئوي `reversed`، المحور الرقمي يميناً، التلميح `dir="rtl"`، و**لا محرف هندي-عربي في أي مخرج** (ق-3) | وحدة + لقطات |
| **T-XLSX** | ورقة `rightToLeft: true`؛ `numFmt === '#,##0.000'` على الأعمدة المالية؛ **صف الإجماليات قيمة لا صيغة**؛ قراءة الملف المُولَّد وتأكيد تطابق الإجماليات مع `ReportResult.totals` (R-I9) | وحدة |
| **T-CSV** | أول بايتات = BOM؛ تهريب الاقتباس المزدوج؛ `=cmd()` تخرج مسبوقة بعلامة اقتباس؛ CRLF؛ خيار `;`؛ **لا محرف bidi في البيانات**؛ الإجماليات = الشاشة | وحدة |
| **T-PDF** | مسار الطباعة يُولِّد DOM بـ `thead` مكرَّر و`break-inside: avoid` و`dir="rtl"`؛ **0 قراءات Firestore إضافية** (يُقاس)؛ العلامة المائية تظهر عند `verdict==='drift'`؛ جدول > 2,000 صف ⇒ رسالة الرفض | وحدة + لقطات |
| **T-RPT-COST** | `estimateReads` لكل تقرير **لا يقل** عن القراءات المقيسة فعلياً في المحاكي (تقدير متحفّظ لا متفائل) | محاكي |
| **T-RPT-WORSHIP** | المقام = المسجَّل فقط؛ الأيام غير المسجَّلة تُعرض بعددها ولا تدخل البسط ولا المقام؛ **لا لفظ تقييمي في أي نصّ مخرج** (فحص قائمة كلمات ممنوعة) | وحدة |
| **T-RPT-TASKS** | مهمة بلا `completedAt` **ليست مكتملة** مهما كانت `status`؛ تناقض الحالتين ⇒ صف «حالة غير متسقة» يُعرض | وحدة |

**سجل الأخطاء:** كل خطأ يُكتشف في التقارير ⇒ سطر في `docs/qa/BUGLOG.md` + **اختبار آلي** قبل اعتبار
الإصلاح مكتملاً (نفس قاعدة النواة §20).

---

## 13. القصور المُعلَن صراحةً في طبقة التقارير

| # | القصور | العلاج المعتمد | ما يبقى من خسارة |
|---|---|---|---|
| **1** | **لا بحث نصّي حرّ في الوصف.** `description` مستثنى من الفهرسة (النواة §15.5)، ولا بحث نصّي في Firestore | تصفية بالحقول (فئة/حساب/وسم/جهة/نطاق مبلغ/نطاق تاريخ) + بحث نصّي **داخل الصفحة المحمَّلة فقط** بوسم صريح: «البحث داخل النتائج المعروضة» | لا «ابحث عن كلمة في كل تاريخي» بلا مسح كامل. (مقترح مستقبلي: `descriptionTokens: string[]` مفهرس — يحتاج ADR وترحيلاً) |
| **2** | **لا عمود رصيد جارٍ في التصدير ولا في الصفحات العميقة** | قصور موروث من النواة §18.2؛ الرصيد الجاري في الصفحة الأولى فقط، ومكتوب في رأس العمود والتذييل | تصدير كشف الحساب بلا «الرصيد بعد الحركة» |
| **3** | **تقرير السنة لا يضم تصحيحات الفترات المُقفلة في مجاميعه** | سطر مستقل «تصحيحات فترات سابقة» + تذييل يشرح أن مجاميع السنة = النشاط | قارئ عجول قد يجمع الرقمين. المعالجة عرضية (عنونة واضحة) لا رياضية |
| **4** | **ميزانية شهر مُقفل لا تتغير بعد إقفاله** | مقصود (النواة: `budgetPeriods` لا تُلمس في تصحيح فترة مُقفلة) + تذييل صريح في R12 | «استهلاك الميزانية» لشهر مُقفل يبقى كما كان وقت الإقفال |
| **5** | **الفرق غير المُصنَّف في R15 لا يُصنَّف تلقائياً** | يُعرض دائماً + زر «فسِّر هذا الفرق» يقرأ قيود الفترة بتكلفة معروضة | تفسير الفرق عملية مكلفة بإذن المستخدم، لا تصنيف مجاني |
| **6** | **تقرير PDF بخطوة يدوية وبلا ترقيم صفحات داخلي** | تعليمة عربية واحدة + ترويسة/تذييل المتصفح + رأس جدول مكرَّر؛ و`PdfPort` جاهز لـ Blaze | لا زر «نزّل PDF» فورياً قبل الترقية |
| **7** | **عدّاد القراءات تقديري لا حقيقي** | يُكتب تحته أنه تقدير ولا يحتسب قراءات القواعد ولا الأجهزة الأخرى | قد يُقلّل التقدير الفعلي |
| **8** | **محور «الشهر المالي» غير متاح في الإصدار الأول** | قرار النواة (ADR-008): الشهر الميلادي أولاً، والشهر المالي إسقاط `fiscalPeriods` يُبنى بإعادة البناء | من يستلم راتبه يوم 25 يقرأ تقاريره بالشهر الميلادي حتى تُفعَّل الميزة |
| **9** | **لا مقارنة تلقائية عبر فترات غير متماثلة** (أسبوع مقابل شهر) | المقارنة مسموحة فقط بين فترتين **بنفس عدد الأيام**، وإلا رسالة «الفترتان غير متماثلتين» | لا نسب مقارنة مضلِّلة |
| **10** | **خريطة السنة باليوم تتطلب `dailyRollups`** | عند عدم اعتماد ADR-023 تتدهور إلى 12 نقطة برسالة صريحة | رسم واحد يفقد حبّته |

---

## 14. سجل القرارات المعمارية لهذه الوثيقة

| # | القرار | الحالة | البدائل المرفوضة |
|---|---|---|---|
| **ADR-023** | **`dailyRollups/{dateKey}`** إسقاط يومي يُكتب على المسار الساخن (الكتابة العاشرة)، ويُضاف إلى `RebuildPlan.projections` | **مقترح — يحتاج موافقة المالك** | (أ) ذاكرة مؤقتة محلية تُبنى بالقراءة: لا تحل مخطط السنة باليوم؛ (ب) 365 تجميعاً خادمياً = 730 قراءة؛ (ج) قراءة قيود السنة = 2,000–6,000 قراءة |
| **ADR-024** | **Recharts** مع طبقة تغليف إلزامية `src/ui/charts/**` وقاعدة بناء تمنع الاستيراد المباشر | **معتمد** | ECharts (Canvas: لا تحكّم CSS ولا تحديد نصّ ولا طباعة نظيفة)، visx (نكتب مكتبة رسوم)، Chart.js (Canvas + وسيط) |
| **ADR-025** | **PDF عبر HTML + طباعة المتصفح**، و`PdfPort` مجرَّد للترقية إلى تصيير خادمي عند Blaze | **معتمد** | pdfmake/jsPDF/pdf-lib/@react-pdf: **لا تشكيل عربي ولا bidi** ⇒ مخرج غير مقبول؛ Puppeteer: يتطلب Blaze (ق-1) |
| **ADR-026** | **exceljs** محمَّلاً عند الطلب، ورقة RTL، **إجماليات كقيم لا صيغ** | **معتمد** | SheetJS (توزيع npm غير موثوق ودعم تنسيقات أضعف)، CSV فقط (بلا تنسيق ولا تجميد ولا مرشّحات) |
| **ADR-027** | **CSV = UTF-8 + BOM + `,` + CRLF + RFC 4180 + تحييد الصيغ**، والفاصلة المنقوطة وسطر `sep=` خيارَين | **معتمد** | UTF-16LE/TAB (يكسر كل أداة غير Excel)، `sep=` افتراضياً (يُفسد كل مُحلِّل آخر)، لا BOM (محارف مشوَّهة في Excel العربي) |
| **ADR-028** | **بصمة سلامة في كل تقرير وكل ملف مُصدَّر**، والانحراف يُعرض ويُوسَم ولا يُحجب ولا يُصحَّح صامتاً | **معتمد** | فحص صامت في الخلفية (يخالف القسم 25 بند 15)، حجب التقرير (يترك المستخدم بلا بيانات بلا فائدة) |
| **ADR-029** | **لا تخزين نتائج تقارير في Firestore**؛ الذاكرة المؤقتة محلية بمفتاح `projectionVersion` | **معتمد** | مجموعة `reportCache` (إسقاط رابع، سطح انحراف، وكتابات بلا داعٍ)، ذاكرة بمدة صلاحية زمنية (تعرض رقماً قديماً بثقة) |
| **ADR-030** | **الأسبوع نطاق على `dateKey` ولا `weekKey` مخزَّن**، وبداية الأسبوع إعداد عرض (السبت افتراضاً) | **معتمد** | تخزين `weekKey` على الإسقاط: تغيير بداية الأسبوع يصير ترحيلاً على بيانات — نفس منطق ADR-008 |
| **ADR-031** | **حدّ 25 مفتاحاً للقطع العرضي** على `postings`، وما زاد يحتاج اختيار قيم أو موافقة صريحة بالتكلفة | **معتمد** | إطلاق استعلام تجميعي لكل قيمة بلا حدّ (انفجار قراءات صامت) |

---

## 15. الأسئلة المفتوحة — تحتاج قرار المالك أو تعديلاً على النواة

> لم أخترع لها جواباً، ولم أعدّل ملف النواة.

| # | السؤال / الثغرة | الأثر | الحلّ المقترح |
|---|---|---|---|
| **1** | **`financialGoal.savedMinor` في وضع `backedAccount` بلا كاتب معرَّف في النواة.** النواة تجعله «مشتقاً مخزَّناً»، لكن التحويل العادي إلى حساب التوفير **لا يمرّ** بـ `earmarkToGoal` ⇒ الحقل قد يبقى صفراً أو قديماً، فيعرض تقرير الأهداف تقدماً خاطئاً | R13 + بطاقة C11 | **المقترح (ومُطبَّق في هذه الوثيقة):** التقرير يقرأ `accounts[backingAccountId].balanceMinor` ويتجاهل `savedMinor` في هذا الوضع (صفر كتابات جديدة). **البديل:** صيانة `savedMinor` في مسار التحويل (كتابة إضافية + سطح انحراف + ثابت جديد). القرار للمالك |
| **2** | **معنى بطاقة «صافي التدفق النقدي» (القسم 4).** حقل النواة `netCashFlowMinor = دخل − مصروف`، وهو **ليس** التغيّر الفعلي في النقد | بطاقة C05 + R15 | سمّيناها «صافي التدفق (دخل − مصروف)» وأضفنا `ΔCash` في R15. **السؤال:** هل يريد المالك البطاقة الرئيسية `ΔCash` بدلاً من ذلك؟ |
| **3** | **اعتماد ADR-023 (`dailyRollups`).** يرفع كتابات المصروف من **9 إلى 10**، وهو انحراف عن جدول النواة §15.1، ويضيف بنداً إلى `RebuildPlan.projections` في §16.2 | التقرير اليومي/الأسبوعي ومخطط السنة باليوم | الموافقة ⇒ تعديل §15.1 و§16.2 في النواة بـ ADR جديد. الرفض ⇒ تعمل التقارير كلها بالبديل في 4.4، ويفقد مخطط السنة حبّته اليومية |
| **4** | **تصحيح استعلام في النواة §15.3:** `obligations where remainingMinor > 0 && dueDate <= today order by dueDate` يجمع متباينتين على حقلين مع ترتيب بالثاني؛ والفهرس المنصوص `remainingMinor (>) + dueDate ASC` لا يخدمه كما هو مكتوب | لوحة التحكم C06/C07 + R09/R10 | استخدمنا `status in ['upcoming','due','partiallyPaid'] && dueDate <= X order by dueDate` (فهرس `status + dueDate ASC` منصوص في النواة). **المقترح:** تصحيح نصّ §15.3 إلى الصيغة المعتمدة على `status`، أو تثبيت الصيغة الأولى بعد إثباتها في المحاكي |
| **5** | **محور «الشهر المالي»** (ADR-008): هل يُفعَّل في الإصدار الأول لأن المالك يتقاضى راتبه في يوم محدَّد؟ | إسقاط `fiscalPeriods` + كل التقارير الزمنية | الإصدار الأول بالشهر الميلادي. التفعيل لاحقاً = إسقاط إضافي + إعادة بناء، بلا أي كتابة على قيد |
| **6** | **عتبة تأكيد تكلفة القراءة** `READ_CONFIRM_THRESHOLD = 1,000` والحدّ الصلب `20,000`: مناسبان؟ | تجربة التصدير الكبير | قابلان للضبط في الإعدادات دون أثر على البيانات |
| **7** | **بداية الأسبوع**: اعتمدنا **السبت** افتراضاً (العُرف الليبي). تأكيد أو تغيير؟ | R02 + مخططات الأسابيع | إعداد عرض في `settings.display.weekStartsOn`، بلا أثر على التخزين |
| **8** | ~~**عقد وحدتي المهام والعبادات** (R16/R17)~~ **حُسم — صدرت `09-personal-worship.md`** وثبّتت `tasks` (بـ`trashed` و`orderKey` و`completedOn`) و`worshipDays/{dateKey}` و`quranSessions`. الصيغ في 3.12 مُصحَّحة عليها (م-16)، وأُصلحت في تدقيق الاتساق المالي بقيّةُ المواضع التي بقيت على الأسماء الباطلة: `DataSourceRef.collection` و`ReportIO.listWorship` في القسم 2، وصفّا «تقارير المهام» و«تقرير العبادات» في 3.13. | — | **لا سؤال مفتوح.** و`09` هو المرجع لمجموعاته، و`07` لمجموعة `notifications` |
| **9** | **تصدير هواتف المدينين (R08)** مُستبعَد افتراضياً: مناسب أم يُضمَّن؟ | خصوصية الأطراف الأخرى | الاستبعاد افتراضاً + خيار صريح في حوار التصدير |
| **10** | **حدّ PDF = 2,000 صف**: مناسب أم يُرفع؟ | R06/R14 خاصة | قابل للضبط؛ ما فوقه يُقترح XLSX |

---

## 16. خلاصة العقد

1. **17 تقريراً**، لكل منها مصدر بيانات مكتوب واستعلام فعلي وأعمدة ومرشّحات ورسوم وصيغ تصدير
   وتكلفة قراءة مقدَّرة. **لا تقرير بلا مصدر.**
2. **18 معادلة** في مكان واحد (`src/domain/reports/formulas/**`)، ولكل منها **استثناءاتها مكتوبة**،
   والاستثناء **هيكلي** لأن التقرير دالّة في نوع الحساب لا في `kind`.
3. **ثلاث طبقات تجميع فقط**: `periods` شهرياً، `dailyRollups` يومياً (ADR-023 مقترح)،
   و`postings` لأي بُعد بقراءتين. **التقرير السنوي 12 قراءة.**
4. **تصحيح عملية قديمة لا يحتاج إعادة بناء** — سياسة تاريخ العكس في النواة تجعل الدلتا تهبط على
   نفس اليوم ونفس الشهر؛ وإعادة البناء إجراء كامل ببوابة واستئناف وقيم مطلقة عند الحاجة.
5. **المطابقة ثنائية الاتجاه ومعروضة**: 9 ثوابت تقارير، 3–4 قراءات لكل فتح تقرير،
   والانحراف **يُعرض في الشاشة ويُوسَم في الملف** — ولا يُصحَّح صامتاً ولا يُخفى.
6. **Recharts (SVG)** لأن العربية و RTL والطباعة تحتاج نصاً في DOM لا في Canvas،
   وخلف طبقة تغليف تجعل التبديل ملفاً واحداً.
7. **PDF عبر طباعة المتصفح** لأن المتصفح هو محرّك تشكيل العربية الوحيد الموثوق المتاح لنا؛
   وكل مكتبة PDF في الواجهة **مرفوضة** لأنها تُخرج حروفاً منفصلة معكوسة.
8. **Excel بـ exceljs** بورقة RTL وتنسيق `#,##0.000` و**إجماليات كقيم لا صيغ**،
   و**CSV بـ BOM** لأن Excel العربي بلا BOM يُشوّه كل حرف.
9. **كل رقم `Minor`** حتى حدود التصدير، والتحويل في دالة واحدة لكل صيغة،
   والتنسيق **مرة واحدة** عند العرض — فلا «الإجمالي ≠ مجموع الصفوف» أبداً.
10. **القصور مُعلَن** في القسم 13 (عشرة بنود)، و**عشرة أسئلة** تنتظر قرار المالك في القسم 15.

> هذه الوثيقة تخضع للنواة. أي تعارض بينها وبين `01-financial-core.md` ⇒ **النواة تفوز**،
> وهذه الوثيقة تُصحَّح.

---

> تعديل اتساق (تدقيق مالي): §3.4/٣ و§3.13 كانتا تستثنيان **الاقتراض** مطلقاً من `spentMinor`
> و`E(P)`، وهذا يخالف جدول الحقيقة R6 في النواة §9 الذي ينصّ على أن **الشراء بالأجل (حالة ب)**
> يزيد `totalExpenseMinor` و`budgetPeriods.spentMinor`؛ فصار المستبعَد **الاقتراض النقدي (حالة أ)**
> وحده. · و§3.6 كانت تُسقط الحسابات المؤرشفة من `ΔCash` بمرشّح `status`، فتُنتج «فرقاً غير
> مُصنَّف» كاذباً ودائماً؛ ووُحِّدت مجموعة الحسابات النقدية في §3.6 و§3.9 و§3.13 على `spendableSet`
> من `06` §8.1 (المرشّح الوحيد `excludeFromNetWorth`). · و§3.9 كانت تُعلن دوال الثروة «حرفية من
> النواة §R9» وهي **ليست كذلك** بعد تصحيحَي ر-8 ور-9 في `06` §8.1، فصارت تُحيل إليها وتُظهر
> انحراف `totalPayablesMinor` (ضمّ `zakatDue`) المنتظِر إقرار المالك. · وأُضيف **شطب المستحق**
> (`debtWriteOff`: مصروف بلا نقد) إلى قائمة ما يُنتج `UnclassifiedMinor` في §3.6 بعد أن كان
> غائباً مع أنه حالة حتمية في R7. · وأُضيف `accountType=='expense'` إلى تجميع المنزل في R11
> (السجل §6 والخطوة 2) لأن التصفية بالوسم وحده على `postings` تُرجع **صفراً دائماً**
> (`06` §5.4/ر-2 · M-I19 · T-HH-9). · ووُحِّدت أسماء مجموعتَي العبادات على `09`
> (`worshipDays`/`quranSessions` بدل `worshipRecords`/`quranProgress`) في §2 و§3.13، ومفتاح تقرير
> الإنجازات على `completedOn` بدل `completedAt`، وأُغلق السؤال المفتوح رقم 8. · و§10.1 صارت
> **مُحيلة إلى `03` §10 كمرجع وحيد للفهارس**، وحُذف منها فهرسان زائدان (`periodKey+bookedAtTs`
> يخدمه `JE6`، و`accountIds+bookedAt+__name__` يخدمه `JE2`) وفهرس **بلا معنى**
> (`bookedAt (==) + bookedAtTs DESC`: `bookedAtTs` دالّة في `bookedAt` وحده ⇒ قيمة واحدة لكل
> قيود اليوم)، وبقي `dailyRollups` غير منشور حتى إقرار ADR-023.
