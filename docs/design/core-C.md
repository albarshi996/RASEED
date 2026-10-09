# النواة المحاسبية لمشروع رصيد — المنظور (C): سجل أحداث غير قابل للتعديل + إسقاطات محسوبة

> **المنظور:** Event‑sourced core with materialized projections.
> **الملف:** `docs/design/core-C.md` — مرحلة تصميم فقط، لا كود تطبيقي.
> **المرجع:** `docs/00-REQUIREMENTS.md` (الأقسام 2، 5–12، 18، 19، 20، 22، 23).
> **المنصة المستهدفة:** Firebase على خطة Spark أولاً (بدون Cloud Functions)، مع طبقة تحسين اختيارية على Blaze.

---

## 0. الخلاصة التنفيذية (قبل التفاصيل)

- **مصدر الحقيقة الوحيد:** مجموعة `financialEvents` — سجل إضافي فقط (append‑only)، كل مستند فيه غير قابل للتعديل أو الحذف، ومعرّفه هو **نفسه** معرّف العملية (`opId`) ⇒ منع الازدواج مبني في المخطط لا مضاف إليه.
- **كل حدث يحمل أرجلاً محاسبية مزدوجة** (`legs`) بشرط ثابت `Σ debit = Σ credit`، وأثراً على السجلات التشغيلية (`registerEffects`) للالتزامات والديون والأهداف.
- **كل الأرصدة والملخصات إسقاطات (projections)** تُكتب في **نفس الـ `runTransaction`** الذي يكتب الحدث ⇒ لا توجد نافذة زمنية يكون فيها الحدث مسجّلاً والرصيد غير محدّث.
- **التصحيح بحدث عكسي** (`reversal`) محمي بمستند قفل فريد `eventReversals/{originalEventId}` يمنع العكس المزدوج ذرّياً.
- **المال عدد صحيح بالدرهم** (1 د.ل = 1000 درهم، 3 خانات عشرية)، والقسمة بطريقة أكبر البواقي (largest remainder) فلا تضيع وحدة واحدة.
- **التكلفة:** ~2–3 قراءات و5 كتابات لكل مصروف؛ ~9–11 قراءة لفتح لوحة التحكم.
- **أهم عيب في هذا المنظور (أعلنه مقدماً):** تضخيم الكتابة (write amplification) 5× لكل مصروف، ومستند `projections/checkpoint` نقطة تنازع واحدة، وإعادة بناء الإسقاطات على Spark **ليست ذرّية** لأنها تُنفَّذ من العميل. التفاصيل والنقد الصريح في القسم 13.

---

## 1. تمثيل المال

### 1.1 القرار

| البند | القرار | المبرر |
|---|---|---|
| الوحدة الصغرى | **الدرهم الليبي** (1 د.ل = 1000 درهم) | التقسيم الرسمي للدينار الليبي ألفي، لا مئوي |
| عدد الخانات العشرية | **3** (ثابت، في التخزين والعرض المحاسبي) | كشوف الحسابات المصرفية وفواتير الوقود والخدمات في ليبيا تُصدر بثلاث خانات؛ ومثال المتطلبات نفسه `25.500 د.ل` بثلاث خانات. اعتماد خانتين يجعل `0.250` غير قابل للتمثيل |
| نوع التخزين في Firestore | `number` **عدد صحيح** (Firestore يخزّنه كـ int64 متى كانت القيمة صحيحة) | يدعم `FieldValue.increment()` مع الحفاظ على نوع العدد الصحيح |
| نوع TypeScript | `Minor` = نوع موسوم (branded) | يمنع تمرير دينار مكان درهم بخطأ وقت الترجمة |
| الحد الأعلى العملي | `Number.MAX_SAFE_INTEGER` = 9,007,199,254,740,991 درهم ≈ 9.007 × 10¹² د.ل | أكثر من كافٍ؛ يُفرض حد أدنى صلابة عند 10¹² درهم (10⁹ د.ل) في التحقق لرفض المدخلات الخاطئة |

> **لا تُستخدم `float` إطلاقاً** في التخزين ولا في الحساب. العشرية تظهر فقط في طبقة العرض (formatter) وفي طبقة تحليل المدخل (parser).

### 1.2 الأنواع والدوال (التواقيع الفعلية)

```ts
// domain/money.ts — الطبقة الوحيدة المسموح لها بالتعامل مع تمثيل المال

declare const MINOR_BRAND: unique symbol;
/** مبلغ بالدرهم الليبي، عدد صحيح موقّع. */
export type Minor = number & { readonly [MINOR_BRAND]: 'LYD' };

export const MINOR_SCALE = 1000 as const;   // درهم لكل دينار
export const MINOR_DIGITS = 3 as const;
export const MAX_MINOR = 1_000_000_000_000;  // 10⁹ د.ل — حد صلابة

export function toMinor(n: number): Minor;                 // يرفض غير الصحيح
export function isMinor(n: unknown): n is Minor;

/** تحليل مدخل المستخدم نصّياً — لا parseFloat، لا ضرب في 1000. */
export function parseMinor(input: string): Result<Minor, MoneyParseError>;

/** تنسيق للعرض: "25.500 د.ل" / "٢٥٫٥٠٠ د.ل" حسب locale. */
export function formatMinor(
  v: Minor,
  opts?: { digits?: 0 | 1 | 2 | 3; withSymbol?: boolean; locale?: 'ar-LY' | 'en' }
): string;

/** ضرب بنسبة بالعشرة آلاف (basis points) بحساب BigInt ثم تقريب نصف‑لأعلى. */
export function mulRate(v: Minor, rateBps: number): Minor;

/** تقسيم بالتساوي على n مع توزيع البواقي — المجموع يساوي الأصل بالضبط. */
export function splitEven(total: Minor, n: number): Minor[];

/** تقسيم بأوزان صحيحة — largest remainder. المجموع يساوي الأصل بالضبط. */
export function allocate(total: Minor, weights: number[]): Minor[];
```

### 1.3 تحليل المدخل (`parseMinor`) — السلوك المحدد

1. تطبيع الأرقام العربية‑الهندية `٠١٢٣٤٥٦٧٨٩` → `0123456789`، والفاصلة العربية `٫` و`,` → `.`.
2. إزالة فواصل الآلاف (` `، `,`، `٬`) ورمز العملة.
3. تقسيم على `.` → `[intPart, fracPart?]`.
4. إذا كان طول `fracPart` > 3 ⇒ **رفض** بخطأ عربي: «أقصى دقة للمبلغ ثلاث خانات عشرية (درهم)». لا تقريب صامت.
5. حشو `fracPart` إلى 3 خانات من اليمين: `"5"` → `"500"`, `"25"` → `"250"`, `"025"` → `"025"`.
6. النتيجة = `Number(intPart + fracPart)` كعدد صحيح.

| المدخل | الناتج (درهم) |
|---|---|
| `"25.5"` | `25500` |
| `"25.500"` | `25500` |
| `"25.05"` | `25050` |
| `"٢٥٫٠٥٠"` | `25050` |
| `"0.001"` | `1` |
| `"25.5001"` | **خطأ** `PRECISION_EXCEEDED` |

### 1.4 القسمة والضرب دون ضياع وحدات

**`mulRate` — الضرب بنسبة (الزكاة 2.5٪، رسوم، نِسَب السيناريوهات):**

```
mulRate(v, bps) = Number( (BigInt(v) * BigInt(bps) + 5000n) / 10000n )
```
استخدام `BigInt` ضروري: `10¹² × 10⁴ = 10¹⁶ > 2⁵³`، فالحساب بـ `number` يفقد الدقة. التقريب نصف‑لأعلى (half‑up) لأنه ما يتوقعه المستخدم في السياق المالي الشخصي، وليس banker's rounding — وهذا قرار موثّق لأن الفرق يظهر في حاسبة الزكاة.

**`splitEven` — توزيع الأقساط (المثال الحرج):**

مبلغ 1000.000 د.ل = `1_000_000` درهم على 3 أقساط:
```
base      = floor(1_000_000 / 3) = 333_333
remainder = 1_000_000 - 3 × 333_333 = 1
النتيجة  = [333_334, 333_333, 333_333]     // المجموع = 1_000_000 بالضبط
```
الباقي (`remainder` وحدة) يوزّع وحدة واحدة على أول `remainder` قسطاً. **الناتج يُخزَّن كأقساط صريحة** في `obligations.schedule[]` عند الإنشاء، ولا يُحسب عند كل قراءة — وإلا اختلف التوزيع بين شاشة وأخرى.

**`allocate` — التوزيع بأوزان (largest remainder):**

```
exact_i   = total × w_i / Σw          (بحساب BigInt)
floor_i   = ⌊exact_i⌋
left      = total − Σ floor_i
رتّب التنازلي حسب (exact_i − floor_i)، ثم أضف وحدة واحدة لأول `left` عنصراً
```
يُستخدم في: تقسيم مصروف مشترك بين فئتين، توزيع دفعة واحدة على عدة التزامات، توزيع مبلغ ادخار على عدة أهداف.

**قاعدة ثابتة:** كل دالة توزيع في النظام **تُعيد مصفوفة مجموعها يساوي الأصل بالضبط**، ويوجد اختبار وحدة لكل منها يفحص `Σ result === total` على 10 آلاف حالة عشوائية (property‑based test) — متطلب §23.1.

---

## 2. نموذج البيانات الدقيق للنواة

### 2.1 شجرة المجموعات

```
users/{uid}
├── financialEvents/{opId}              ← سجل الأحداث، append-only، immutable
├── eventReversals/{originalEventId}     ← قفل العكس (منع العكس المزدوج)
├── accounts/{accountId}                 ← إسقاط: رصيد + تهيئة الحساب
├── categories/{categoryId}              ← مرجعي (ليس إسقاطاً)
├── obligations/{obligationId}           ← إسقاط: مسدَّد/متبقٍ/حالة + جدول الأقساط
├── debts/{debtId}                       ← إسقاط: ديون عليّ وديون لي (direction)
├── budgets/{YYYY-MM}                    ← إسقاط: سقوف + منصرف لكل فئة
├── goals/{goalId}                       ← إسقاط: المُخصَّص للهدف
├── monthlySummaries/{YYYY-MM}           ← إسقاط: دخل/مصروف/صافي + تفصيل بالفئة
├── projections/dashboard                ← إسقاط مركّب خفيف (اختياري، المستوى 2)
├── projections/liabilities              ← إسقاط: إجماليات الالتزامات والديون
├── projections/checkpoint               ← حالة الإسقاطات + بصمة تحقق
├── recurringTemplates/{templateId}      ← قوالب المصروف/الدخل المتكرر
├── pendingCommands/{opId}               ← طابور الأوامر المؤجلة (وضع عدم الاتصال)
└── auditLogs/{logId}                    ← تدقيق العمليات الحساسة (§18.9)
```

> **لماذا `financialEvents` بدل `transactions` الواردة في §18؟** الاسم في المتطلبات مسموح بتعديله بشرط التوثيق (§18). الفرق جوهري: `transactions` في التصميم التقليدي مستند **قابل للتعديل** يمثل الحالة الحالية؛ أما `financialEvents` فسجل وقائع لا يُعدَّل. تبقى واجهة القراءة في التطبيق باسم «الحركات» عربياً. **بديل الاسم المقبول** إن أصرّ المالك: `transactions` بنفس العقد (immutable).

### 2.2 الحدث المالي — `financialEvents/{opId}`

```ts
// domain/types/event.ts

export type EventKind =
  | 'opening_balance'        // رصيد افتتاحي للحساب
  | 'expense'                // مصروف مدفوع فعلاً
  | 'income'                 // دخل مستلم فعلاً
  | 'transfer'               // تحويل بين حسابين
  | 'obligation_opened'      // إنشاء التزام (بلا أثر نقدي)
  | 'obligation_payment'     // دفع (جزئي/كامل) لالتزام
  | 'obligation_cancelled'   // إلغاء التزام (بلا أثر نقدي)
  | 'debt_opened'            // نشوء دين عليّ
  | 'debt_payment'           // سداد دين عليّ
  | 'receivable_opened'      // نشوء دين لي
  | 'receivable_collection'  // تحصيل دين لي
  | 'receivable_write_off'   // إعدام دين لي
  | 'goal_allocation'        // تخصيص مبلغ لهدف ادخاري (بلا أثر نقدي)
  | 'goal_release'           // تحرير تخصيص
  | 'adjustment'             // تسوية رصيد مبرَّرة (§5)
  | 'reversal';              // عكس حدث سابق

/** طبيعة الطرف المحاسبي — تحدد اتجاهه الطبيعي. */
export type LegNature =
  | 'asset'        // حساب نقدي/مصرفي/محفظة — الاتجاه الطبيعي: debit
  | 'liability'    // دين عليّ                 — الاتجاه الطبيعي: credit
  | 'receivable'   // دين لي (أصل غير نقدي)    — الاتجاه الطبيعي: debit
  | 'expense'      // فئة مصروف               — الاتجاه الطبيعي: debit
  | 'income'       // مصدر دخل                — الاتجاه الطبيعي: credit
  | 'equity';      // افتتاحي/تسوية/إعدام      — الاتجاه الطبيعي: credit

export type LegTarget =
  | { nature: 'asset';      accountId: string }
  | { nature: 'liability';  debtId: string }
  | { nature: 'receivable'; debtId: string }
  | { nature: 'expense';    categoryId: string; subCategoryId?: string }
  | { nature: 'income';     incomeSourceId: string }
  | { nature: 'equity';     equityKind: 'opening' | 'adjustment' | 'write_off' };

export interface EventLeg {
  readonly target: LegTarget;
  readonly side: 'debit' | 'credit';
  /** موجب دائماً (> 0). الاتجاه يحدده `side`. */
  readonly amountMinor: Minor;
}

/** أثر على سجل تشغيلي لا يدخل الميزان المحاسبي. */
export type RegisterEffect =
  | { register: 'obligation'; obligationId: string; paidDeltaMinor: Minor;
      cancelled?: boolean }
  | { register: 'debt';       debtId: string; settledDeltaMinor: Minor }
  | { register: 'receivable'; debtId: string; collectedDeltaMinor: Minor;
      writtenOffDeltaMinor?: Minor }
  | { register: 'goal';       goalId: string; allocatedDeltaMinor: Minor };

export interface FinancialEvent {
  /** = معرّف المستند = opId. ثابت، يولّده العميل، لا يتغير بين المحاولات. */
  readonly opId: string;
  readonly uid: string;
  readonly kind: EventKind;
  readonly schemaVersion: 1;

  /** تاريخ العملية كما يراها المستخدم (قابل لأن يكون في الماضي). */
  readonly occurredAt: Timestamp;
  /** لحظة التسجيل على الخادم — serverTimestamp(). مفتاح ترتيب الإعادة. */
  readonly recordedAt: Timestamp;
  /** مفتاح الشهر المالي المحتسب من occurredAt + settings.fiscalMonthStartDay. */
  readonly periodKey: string;            // "2026-10"

  readonly legs: readonly EventLeg[];    // 0..8، الشرط: Σdebit = Σcredit
  readonly registerEffects: readonly RegisterEffect[];  // 0..4

  /** إجماليات معلنة — تُستخدم في قواعد الأمان وفي بصمة التحقق. */
  readonly totals: { debitMinor: Minor; creditMinor: Minor };

  /** الحسابات المتأثرة — لاستعلام array-contains لكشف حركة الحساب. */
  readonly accountIds: readonly string[];
  readonly categoryIds: readonly string[];

  // حقول وصفية (§6، §7)
  readonly description: string;          // 1..200
  readonly notes?: string;               // 0..1000
  readonly scope: 'personal' | 'household';   // §11 — عرض فقط، لا تكرار
  readonly paymentMethod?: 'cash' | 'card' | 'transfer' | 'wallet' | 'other';
  readonly payeeContactId?: string;
  readonly attachmentIds?: readonly string[];
  readonly tags?: readonly string[];

  // الأصل والتصحيح
  readonly source: 'manual' | 'recurring' | 'import' | 'reversal' | 'system';
  readonly recurringTemplateId?: string;
  readonly occurrenceKey?: string;       // "2026-10" أو "2026-10-09"
  readonly reversesEventId?: string;     // في حدث reversal فقط
  readonly supersedesEventId?: string;   // في حدث تصحيح بعد عكس
  readonly reason?: string;              // إلزامي في reversal و adjustment

  readonly clientInfo: { deviceId: string; appVersion: string };
}
```

**الشروط الثابتة (invariants) التي تفرضها طبقة الـ domain قبل أي كتابة:**

| # | الشرط | الخطأ عند الفشل |
|---|---|---|
| I1 | `Σ legs[side='debit'].amountMinor === Σ legs[side='credit'].amountMinor` | `LEDGER_UNBALANCED` |
| I2 | `totals.debitMinor === totals.creditMinor === Σ debit` | `TOTALS_MISMATCH` |
| I3 | كل `amountMinor` عدد صحيح `> 0` و `≤ MAX_MINOR` | `INVALID_AMOUNT` |
| I4 | `legs.length ≤ 8` و `registerEffects.length ≤ 4` | `TOO_MANY_LEGS` |
| I5 | `accountIds` = مجموعة `accountId` المستخرجة من الأرجل بالضبط | `DENORM_MISMATCH` |
| I6 | `kind` متوافق مع توليفة طبائع الأرجل المسموحة لها (جدول §7) | `KIND_LEGS_MISMATCH` |
| I7 | `periodKey` = `fiscalPeriodOf(occurredAt, settings)` | `PERIOD_MISMATCH` |

### 2.3 الحساب — `accounts/{accountId}`

```ts
export interface Account {
  readonly id: string;
  readonly uid: string;
  name: string;
  type: 'cash' | 'bank' | 'wallet' | 'other';
  currency: 'LYD';                       // محجوز للتوسع، LYD فقط حالياً
  openingBalanceMinor: Minor;            // يُسجَّل أيضاً كحدث opening_balance
  /** ======== إسقاط ======== */
  balanceMinor: Minor;                   // openingBalance + Σ آثار الأحداث المعتمدة
  earmarkedMinor: Minor;                 // محجوز لأهداف ادخارية (§12) — ليس خصماً
  /** متاح للإنفاق = balanceMinor − earmarkedMinor (محسوب، غير مخزّن) */
  lastEventId: string | null;
  eventCount: number;
  /** ======== تهيئة الحمايات ======== */
  allowNegative: boolean;                // افتراضي false
  overdraftLimitMinor: Minor;            // افتراضي 0
  status: 'active' | 'archived';
  includeInNetWorth: boolean;
  sortOrder: number;
  createdAt: Timestamp; updatedAt: Timestamp; schemaVersion: 1;
}
```

### 2.4 الالتزام — `obligations/{obligationId}`

```ts
export type ObligationStatus =
  | 'upcoming' | 'due' | 'overdue' | 'partially_paid' | 'paid' | 'cancelled';

export interface Obligation {
  readonly id: string; readonly uid: string;
  name: string;
  payeeContactId?: string;
  defaultCategoryId: string;             // فئة المصروف عند الدفع
  totalMinor: Minor;
  dueDate: Timestamp;
  recurrence: Recurrence | null;         // §8
  priority: 1 | 2 | 3;
  /** ======== إسقاط ======== */
  paidMinor: Minor;                      // Σ paidDeltaMinor للأحداث غير المعكوسة
  remainingMinor: Minor;                 // totalMinor − paidMinor (مخزّن للاستعلام)
  status: ObligationStatus;              // دالة من (paid, remaining, dueDate, now)
  paymentEventIds: string[];             // ≤ 50، ثم ترحيل إلى مجموعة فرعية
  lastPaymentAt: Timestamp | null;
  /** جدول الأقساط المحسوب مرة واحدة بـ splitEven (لا يُعاد حسابه) */
  schedule: Array<{ seq: number; dueDate: Timestamp; amountMinor: Minor }>;
  notes?: string; attachmentIds?: string[];
  createdAt: Timestamp; updatedAt: Timestamp; schemaVersion: 1;
}
```

**شرط ثابت:** `0 ≤ paidMinor ≤ totalMinor` و `remainingMinor === totalMinor − paidMinor`.

### 2.5 الدين (الاتجاهان) — `debts/{debtId}`

```ts
export interface Debt {
  readonly id: string; readonly uid: string;
  /** owed_by_me = دين عليّ (§9) | owed_to_me = دين لي (§10) */
  readonly direction: 'owed_by_me' | 'owed_to_me';
  counterpartyName: string;
  counterpartyContactId?: string;
  counterpartyPhone?: string;
  principalMinor: Minor;                 // أصل الدين
  originatedAt: Timestamp;
  expectedSettlementAt: Timestamp | null;
  installments: Array<{ seq: number; dueDate: Timestamp; amountMinor: Minor }> | null;
  /** ======== إسقاط ======== */
  settledMinor: Minor;                   // المسدَّد (عليّ) أو المحصَّل (لي)
  writtenOffMinor: Minor;                // المعدوم (لي فقط)
  outstandingMinor: Minor;               // principal − settled − writtenOff
  status: 'open' | 'partially_settled' | 'settled' | 'written_off' | 'cancelled';
  paymentEventIds: string[];
  followUps?: Array<{ at: Timestamp; note: string; nextContactAt?: Timestamp }>;
  notes?: string; attachmentIds?: string[];
  createdAt: Timestamp; updatedAt: Timestamp; schemaVersion: 1;
}
```

**لماذا مجموعة واحدة بحقل `direction` وليس مجموعتين؟** المنطق المحاسبي متماثل تماماً (دين = مبلغ أصل + دفعات + متبقٍ + حالة)، وتوحيدها يجعل منطق «منع السداد الزائد» دالة واحدة لا اثنتين (§25.7). الفصل البصري يتم بفهرس على `direction` (شاشتان، مجموعة واحدة). مستند `debts/{id}` من اتجاه `owed_by_me` يقابل طرف `liability` في الأرجل، ومن اتجاه `owed_to_me` يقابل طرف `receivable`.

### 2.6 الملخص الشهري — `monthlySummaries/{YYYY-MM}`

```ts
export interface MonthlySummary {
  readonly id: string;                   // "2026-10"
  readonly uid: string;
  /** يُحتسب من الأرجل ذات الطبيعة expense/income فقط ⇒ لا تضخّم (§19) */
  expenseMinor: Minor;
  incomeMinor: Minor;
  netMinor: Minor;                       // income − expense
  householdExpenseMinor: Minor;          // §11 — مجموع جزئي، ليس مضاعفاً
  personalExpenseMinor: Minor;
  expenseByCategory: Record<string, Minor>;   // ≤ ~150 مفتاحاً
  incomeBySource: Record<string, Minor>;
  /** حركات لا تُحتسب دخلاً ولا مصروفاً — للتدقيق والتسوية */
  transferVolumeMinor: Minor;
  debtPaymentMinor: Minor;               // سداد ديون عليّ (ليس مصروفاً)
  receivableCollectionMinor: Minor;      // تحصيل ديون لي (ليس دخلاً)
  obligationPaymentMinor: Minor;         // مجموع جزئي داخل expenseMinor
  eventCount: number;
  firstEventAt: Timestamp; lastEventAt: Timestamp;
  schemaVersion: 1;
}
```

> `obligationPaymentMinor` **مجموع جزئي داخل** `expenseMinor` لا إضافة عليه — موثَّق صريحاً لتفادي الجمع المزدوج في التقارير (§16).

### 2.7 الميزانية والهدف

```ts
export interface Budget {
  readonly id: string;                   // "2026-10"
  readonly uid: string;
  totalCapMinor: Minor | null;           // سقف عام
  capByCategory: Record<string, Minor>;  // سقف لكل فئة
  /** ======== إسقاط ======== */
  spentMinor: Minor;
  spentByCategory: Record<string, Minor>;
  alertThresholdPct: number;             // 80 افتراضياً
  schemaVersion: 1;
}

export interface Goal {
  readonly id: string; readonly uid: string;
  name: string;
  targetMinor: Minor;
  targetDate: Timestamp | null;
  linkedAccountId: string | null;        // الحساب الذي يُحجز منه earmarked
  /** ======== إسقاط ======== */
  allocatedMinor: Minor;                 // Σ goal_allocation − goal_release
  progressBps: number;                   // allocated × 10000 / target (محسوب ومخزّن)
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
  schemaVersion: 1;
}
```

### 2.8 إسقاطات المستوى الثاني

```ts
/** projections/liabilities — لبطاقات لوحة التحكم (§4) بقراءة واحدة */
export interface LiabilityRollup {
  obligationsRemainingMinor: Minor;      // Σ remaining للالتزامات غير الملغاة
  obligationsOverdueMinor: Minor;
  obligationsDueNext7dMinor: Minor;
  debtsOwedByMeMinor: Minor;             // Σ outstanding حيث direction=owed_by_me
  debtsOwedToMeMinor: Minor;             // §19: لا تدخل النقد المتاح
  goalsAllocatedMinor: Minor;
  /** حقول حسّاسة للوقت تُحدَّث عند الكتابة + عند أول فتح يومي */
  staleAfter: Timestamp;
  schemaVersion: 1;
}

/** projections/checkpoint — حالة السجل وبصمة التحقق */
export interface ProjectionCheckpoint {
  eventsApplied: number;
  reversalsApplied: number;
  lastEventId: string | null;
  lastRecordedAt: Timestamp | null;
  /** Σ totals.debitMinor لكل الأحداث — بصمة كشف الانحراف */
  debitChecksumMinor: Minor;
  projectionVersion: number;             // يُزاد عند كل إعادة بناء
  rebuildStatus: 'idle' | 'running' | 'failed';
  schemaVersion: 1;
}
```

### 2.9 الأمر المؤجل (وضع عدم الاتصال) — `pendingCommands/{opId}`

```ts
export interface PendingCommand {
  readonly opId: string;                 // = معرّف المستند، نفس opId النهائي
  readonly uid: string;
  readonly intent: CommandIntent;        // الأمر الخام قبل التحقق من الحالة
  readonly createdAtClient: Timestamp;
  status: 'queued' | 'applied' | 'rejected';
  rejectionCode?: DomainErrorCode;
  attemptCount: number;
}
```

### 2.10 الفهارس المطلوبة (`firestore.indexes.json`)

| المجموعة | الحقول | الاستعلام المخدوم |
|---|---|---|
| `financialEvents` | `accountIds` ASC (array), `occurredAt` DESC | كشف حركة حساب (§5) |
| `financialEvents` | `periodKey` ASC, `kind` ASC, `occurredAt` DESC | تقارير الفترة (§16) |
| `financialEvents` | `categoryIds` ASC (array), `occurredAt` DESC | تقرير الفئة |
| `financialEvents` | `recordedAt` ASC, `__name__` ASC | إعادة بناء الإسقاطات |
| `financialEvents` | `source` ASC, `recurringTemplateId` ASC, `occurrenceKey` ASC | كشف تنفيذ متكرر سابق |
| `obligations` | `status` ASC, `dueDate` ASC | الالتزامات القادمة/المتأخرة (§4) |
| `debts` | `direction` ASC, `status` ASC, `expectedSettlementAt` ASC | شاشتا الديون (§9/§10) |
| `auditLogs` | `targetEventId` ASC, `at` DESC | أثر التدقيق |

### 2.11 الترحيل (§18.8)

كل مستند يحمل `schemaVersion`. الترحيل في طبقة القراءة (`lazy read‑time migration`): `migrate(doc)` يحوّل من أي نسخة أقدم إلى النسخة الحالية في الذاكرة، ويُكتب المستند المُرحَّل عند أول كتابة طبيعية عليه. **الأحداث لا تُرحَّل أبداً** (غير قابلة للتعديل) — بل يحوي المُسقِط (`reducer`) معالجاً لكل `schemaVersion` من الأحداث. هذا من أقوى مزايا سجل الأحداث: تغيير شكل الإسقاط لا يحتاج ترحيل بيانات، بل إعادة بناء.

---

## 3. حساب الرصيد: متى، كيف، ومن أين يُقرأ

### 3.1 القرار: **مجمّع مخزّن (stored aggregate) يُحدَّث داخل نفس الـ transaction**

`accounts/{id}.balanceMinor` حقل مخزّن، لا يُحسب عند القراءة.

**المعادلة التعريفية (هي تعريف الصحة، ولا تُنفَّذ في زمن القراءة):**

```
balanceMinor(acc) =
    openingBalanceMinor(acc)
  + Σ { leg.amountMinor  | leg.target.accountId = acc ∧ leg.side = 'debit'  ∧ ¬reversed(evt) }
  − Σ { leg.amountMinor  | leg.target.accountId = acc ∧ leg.side = 'credit' ∧ ¬reversed(evt) }
```

### 3.2 لماذا مخزّن لا محسوب؟ (مقارنة صريحة)

| البديل | تكلفة القراءة | الصحة | الحكم |
|---|---|---|---|
| **محسوب من كل الأحداث عند كل قراءة** | O(n) قراءة؛ بعد سنة ≈ 2000 حدث ⇒ 2000 قراءة لفتح الشاشة | صحيح دائماً بالتعريف | **مرفوض** — يخالف §22 (مراعاة تكلفة القراءة) |
| **محسوب بـ aggregation query `sum()`** | ~1 قراءة لكل 1000 مدخلة فهرس ⇒ 2–3 قراءات | صحيح | **مرفوض كمصدر أساسي** لأنه: (أ) لا يعمل داخل `runTransaction` فلا يصلح لحاجز الرصيد السالب، (ب) لا يعطي تفصيل الفئات في استعلام واحد، (ج) لا يستثني الأحداث المعكوسة دون حقل `reversed` على الحدث — وهو ممنوع لأن الحدث غير قابل للتعديل. **لكنه يُستخدم كأداة تسوية ومراجعة** (§3.4) |
| **مخزّن ومحدَّث في نفس الـ transaction** | 1 قراءة | صحيح شرط عدم وجود كاتب خارج طبقة الـ domain | **المعتمد** |
| **مخزّن ومحدَّث بـ Cloud Function (trigger)** | 1 قراءة | يُنتج نافذة عدم تناسق (eventual) | **مرفوض على Spark** (غير متاح) ومرفوض على Blaze أيضاً لأن §22 يطلب «تحديث العرض بعد الحفظ دون إعادة تحميل» وهذا يتعارض مع تأخر المُشغِّل |

### 3.3 من أين تقرأ الواجهة؟

| الشاشة | المصدر | عدد القراءات |
|---|---|---|
| بطاقة «إجمالي الأموال المتاحة» | `accounts` حيث `status='active' ∧ includeInNetWorth` ⇒ `Σ(balance − earmarked)` | N (عدد الحسابات، ≈ 3–8) |
| شاشة الحسابات | نفس الاستعلام | N |
| بطاقات الدخل/المصروف/الصافي الشهري | `monthlySummaries/{periodKey}` | 1 |
| رسم «المصروفات حسب الفئة» | `monthlySummaries/{periodKey}.expenseByCategory` | 0 (نفس المستند) |
| رسم «اتجاهات الإنفاق 12 شهراً» | `monthlySummaries` where `id in [12 keys]` | 12 (مع تخزين مؤقت) |
| بطاقات الالتزامات والديون | `projections/liabilities` | 1 |
| نسبة استهلاك الميزانية | `budgets/{periodKey}` | 1 |
| كشف حركة حساب | استعلام `financialEvents` بـ `array-contains` + ترقيم 25 | 25 لكل صفحة |

**الرصيد الجاري (running balance) في كشف الحركة:** لا يُخزَّن على الحدث. يُحسب في العميل تنازلياً من `account.balanceMinor` الحالي بطرح آثار الأحداث الأحدث. **عيب صريح:** هذا صحيح فقط إذا كانت الصفحة متصلة بالصفحة الأحدث منها؛ عند الانتقال إلى صفحة في منتصف السجل لا يمكن عرض رصيد جارٍ دقيق دون قراءة كل ما بينهما. **القرار:** لا نعرض رصيداً جارياً إلا في الصفحة الأولى، ونعرض «أثر الحركة» (±) في بقية الصفحات. البديل (تخزين `balanceAfterMinor` على كل رجل) مرفوض لأنه يجعل السجل حساساً لترتيب الكتابة فيستحيل إعادة البناء وإدخال حدث بتاريخ ماضٍ.

### 3.4 التسوية وكشف الانحراف (reconciliation)

تشغيل اختياري من شاشة الإعدادات، وتلقائياً مرة كل 30 يوماً عند فتح التطبيق:

```ts
export interface ReconciliationReport {
  ranAt: Timestamp;
  ledgerBalanced: boolean;        // Σ debit(كل الأحداث) === Σ credit
  checksumMatches: boolean;       // checkpoint.debitChecksumMinor === sum() الفعلي
  accountDrift: Array<{ accountId: string; stored: Minor; replayed: Minor;
                        deltaMinor: Minor }>;
  obligationDrift: Array<{ obligationId: string; deltaMinor: Minor }>;
  debtDrift: Array<{ debtId: string; deltaMinor: Minor }>;
}

export function runReconciliation(uid: string): Promise<ReconciliationReport>;
```

يستخدم `getAggregateFromServer(query, { s: sum('totals.debitMinor') })` لمقارنة البصمة بتكلفة قراءتين، ثم — فقط إذا اختلفت — يُعيد تشغيل السجل بالكامل. هذا هو **المقابل العملي لميزة سجل الأحداث**: القدرة على إثبات أن الإسقاط صحيح، وهي قدرة لا يملكها تصميم المستند القابل للتعديل.

---

## 4. آلية منع الازدواج (Idempotency)

### 4.1 المبدأ: معرّف العملية هو معرّف المستند

لا يوجد «مستند مفاتيح تكرار» منفصل. `financialEvents/{opId}` نفسه هو القفل:

- داخل الـ transaction: نقرأ `financialEvents/{opId}` أولاً. إن وُجد ⇒ **إنهاء ناجح دون أي كتابة** وإرجاع الحدث الموجود.
- خارجياً: قواعد الأمان تمنع `update` و`delete` على `financialEvents` ⇒ أي محاولة لكتابة نفس المعرّف مرة ثانية تُرفض من الخادم حتى لو تجاوز العميل طبقة الـ domain.

### 4.2 كيف يُولَّد `opId`؟ جدول حسب الحالة

| الحالة | شكل `opId` | التوليد | لماذا يمنع الازدواج |
|---|---|---|---|
| **إدخال يدوي** (مصروف/دخل/دفعة) | UUIDv7 (`crypto.randomUUID()` + بادئة زمنية) | **عند فتح النموذج**، يُخزَّن في حالة النموذج ولا يُعاد توليده عند الإرسال | ضغط الزر مرتين = نفس `opId` ⇒ المحاولة الثانية تجد المستند موجوداً |
| **إعادة المحاولة بعد فشل الشبكة** | نفس `opId` المحفوظ | يُخزَّن في `localStorage` تحت `raseed.pendingOp.{formId}` قبل أول إرسال | الطلب الأول قد نجح على الخادم وفُقد الرد؛ الثاني يكتشف الوجود ويُرجع نجاحاً |
| **مصروف/دخل متكرر** | `rec_{templateId}_{occurrenceKey}` — مثال `rec_tmpl_rent_2026-10` | **محدد حسابياً** (deterministic) من القالب والدورية، لا عشوائية | أي عدد من محاولات التنفيذ لأي عدد من الأجهزة يولّد نفس المعرّف ⇒ حدث واحد |
| **جهازان في نفس اللحظة — عملية متكررة** | نفس المعرّف المحدد | — | الجهاز الأسرع يكتب؛ transaction الجهاز الثاني يفشل شرط ما قبل الكتابة، يعيد المحاولة، يقرأ المستند موجوداً، يُنهي بنجاح بلا كتابة |
| **جهازان في نفس اللحظة — إدخال يدوي** | معرّفان مختلفان | — | **حدثان، وهذا صحيح**: المستخدم أدخل فعلاً عمليتين. الحماية هنا تحذير واجهة (§4.4) لا منع |
| **عكس حدث (reversal)** | `rev_{originalEventId}` | محدد حسابياً | نفس الحدث لا يُعكس مرتين؛ ويُدعم بقفل `eventReversals/{originalEventId}` |
| **تسوية رصيد** | UUIDv7 + سبب إلزامي | عند فتح النموذج | — |
| **استيراد ملف** | `imp_{fileHash}_{rowIndex}` | من محتوى الصف | استيراد نفس الملف مرتين لا يضاعف |
| **أمر مؤجَّل (offline)** | نفس `opId` من لحظة الإنشاء في `pendingCommands` | — | التحويل من أمر مؤجّل إلى حدث يستخدم المعرّف نفسه |

### 4.3 ترتيب تنفيذ الأمر (الآلة الحالية)

```
فتح النموذج ──► توليد opId وتخزينه محلياً
      │
      ▼
التحقق (Zod + شروط الـ domain I1..I7)  ← لا شبكة
      │
      ▼
هل متصل؟ ── لا ──► set(pendingCommands/{opId}, intent)   [يُطابر محلياً]
      │                       │
      نعم                  عند العودة ──► نفس المسار أدناه
      ▼
runTransaction:
   1. get(financialEvents/{opId})           ← فحص الازدواج
      └─ موجود؟ أعد الحدث، اخرج (0 كتابة)
   2. get(المستندات اللازمة للحواجز)        ← account / obligation / debt
   3. افحص الحواجز (رصيد سالب، سداد زائد، يتيم)
   4. اكتب: الحدث + الإسقاطات              ← كل الكتابات بعد كل القراءات
      │
      ▼
نجاح ──► احذف opId من localStorage، حدّث pendingCommands.status='applied'
فشل مع رمز نهائي (مثل OVERPAYMENT) ──► pendingCommands.status='rejected' + رسالة عربية
```

### 4.4 ما لا تمنعه هذه الآلية (صراحة)

منع الازدواج التقني **لا يمنع الازدواج الدلالي**: مستخدم يسجّل نفس مصروف البقالة مرتين من نموذجين مختلفين ينتج `opId` مختلفين، والنظام محقّ في تسجيل حدثين. الحماية الوحيدة الممكنة هي تحذير واجهة:

```ts
export function detectSoftDuplicate(
  intent: CommandIntent,
  recentEvents: FinancialEvent[]
): { isSuspect: boolean; matchedEventId?: string };
// معيار: نفس kind + نفس accountId + نفس amountMinor + نفس categoryId
//        وفارق occurredAt ≤ 10 دقائق
```
يُعرض سؤال عربي: «سجّلت مصروفاً مشابهاً بقيمة 25.500 د.ل قبل 4 دقائق. هل هذه عملية جديدة؟» — **تحذير لا حجب**، لأن حجبه يمنع حالات مشروعة (قهوتان في ساعة).

---

## 5. `runTransaction` مقابل `writeBatch`

### 5.1 قاعدة الاختيار

| الحالة | الأداة | السبب |
|---|---|---|
| تسجيل أي حدث مالي يتأثر فيه رصيد أو متبقٍ أو متحصَّل | **`runTransaction`** | يحتاج قراءة الحالة الحالية لفحص الحواجز (رصيد سالب، سداد زائد) ولفحص الازدواج |
| عكس حدث / تصحيح (عكس + حدث جديد) | **`runTransaction`** | يقرأ الحدث الأصلي وقفل العكس والإسقاطات |
| تحويل بين حسابين | **`runTransaction`** | يحتاج قراءة الحساب المصدر لفحص كفاية الرصيد |
| إنشاء التزام/دين (بلا أثر نقدي) | **`runTransaction`** | يحتاج فحص الازدواج فقط، لكن يبقى transaction للاتساق مع `projections/liabilities` و`checkpoint` |
| تنفيذ دفعة واحدة موزّعة على 3 التزامات | **`runTransaction`** واحد | ذرّية إلزامية؛ 3 قراءات + ~9 كتابات، بعيد عن الحد |
| **إعادة بناء الإسقاطات** (كتابة الإسقاط النهائي بعد الإعادة) | **`writeBatch`** مقسّمة إلى دفعات ≤ 450 عملية | لا توجد قراءة؛ القيم محسوبة محلياً بالكامل |
| استيراد 2000 حدث تاريخي بمعرّفات محددة | **`writeBatch`** ≤ 450 لكل دفعة | لا حواجز تعتمد على الحالة (الاستيراد يسبق أي رصيد) |
| تعليم 40 تنبيهاً كمقروء | **`writeBatch`** | لا قراءة، لا تأثير مالي |
| كتابة أمر مؤجّل في وضع عدم الاتصال | **`setDoc`** مفرد | `runTransaction` **يفشل بلا اتصال** |

### 5.2 الحدود والسلوكيات التي يفرضها التصميم

**`runTransaction`:**
1. **500 عملية كتابة كحد أقصى** للـ commit. أقصى ما يصله تصميمنا هو 9 كتابات (تصحيح التزام = عكس + جديد). الحد غير ملموس — **ما عدا حالة واحدة:** «تسوية شاملة» تمس كل الحسابات. القرار: لا نسمح بأمر يمس أكثر من **8 حسابات** في حدث واحد، ونفرضه كشرط I4 موسّع.
2. **لا قراءة بعد الكتابة.** يُفرض معمارياً بتوقيع الدالة:
   ```ts
   type TxPlan<T> = {
     reads: (tx: Transaction) => Promise<T>;        // كل القراءات هنا
     decide: (state: T) => Result<TxWrites, DomainError>;  // نقي، بلا I/O
     writes: (tx: Transaction, w: TxWrites) => void;        // كل الكتابات هنا
   };
   export function runPlan<T>(plan: TxPlan<T>): Promise<Result<void, DomainError>>;
   ```
   فصل المراحل الثلاث يجعل خطأ «القراءة بعد الكتابة» غير قابل للتعبير في الكود.
3. **إعادة المحاولة (تلقائية، حتى 5 مرات في SDK الويب).** النتائج التصميمية الإلزامية:
   - دالة `decide` **نقية تماماً**: لا `Date.now()`، لا `crypto.randomUUID()`، لا تعديل حالة خارج النطاق، لا سجلّات تحليلية. كل القيم غير الحتمية (`opId`, `occurredAt`) تُحسب **قبل** بدء الـ transaction وتُمرَّر إليها.
   - `serverTimestamp()` مسموح داخل الكتابات (يُقيَّم على الخادم عند الـ commit).
   - **كل إعادة محاولة تُعيد القراءة وتُحاسب مالياً.** تنازع على `projections/checkpoint` يعني إعادة قراءة كل شيء. هذه تكلفة حقيقية في منظورنا (القسم 13).
4. **يفشل بلا اتصال** — لا يُطابَر محلياً. هذا أهم قيد عملي ويتعارض ظاهرياً مع متطلب PWA/عدم الاتصال (§2.8، §22). الحل: طابور `pendingCommands` في §2.9 و§4.3.
5. **عدم ضمان الترتيب بين transactions متزامنة** — غير مهم لأن جميع إسقاطاتنا الحسابية تجميعية (الجمع تبادلي) والحواجز تُفحص داخل الـ transaction ذاتها.

**`writeBatch`:**
1. **500 عملية كحد أقصى** — نستخدم 450 هامشَ أمان.
2. **لا قراءة، لا كشف تنازع** ⇒ آخر كتابة تفوز. **ممنوع استخدامها لأي حقل رصيد أو متبقٍ** تحت أي ظرف. تُفرض هذه القاعدة بمراجعة كود: أي `writeBatch` تمس `balanceMinor` أو `paidMinor` أو `outstandingMinor` مرفوضة.
3. **تعمل بلا اتصال** وتُطابَر، ولا تُؤكَّد إلا بعد الاتصال ⇒ §22 «لا تُعتبر العملية محفوظة إلا بعد تأكيد نجاح الكتابة»: الواجهة لا تُظهر «تم الحفظ» إلا بعد `await` الناتج، لا عند تحديث الذاكرة المؤقتة المحلية.
4. **ذرّية** — كل أو لا شيء. مناسبة لمقطع واحد من إعادة البناء، لكن **إعادة البناء كلها ليست ذرّية** إذا احتاجت أكثر من دفعة (القسم 12).

### 5.3 حدود قواعد الأمان في الطلبات المركّبة

قواعد Firestore تُقيَّم **لكل مستند على حدة** ولا ترى بقية مستندات نفس الـ transaction/batch. النتائج:

- **لا يمكن** للقواعد التحقق من أن الحدث المكتوب يطابق تغيّر الرصيد المكتوب في نفس الـ transaction.
- **يمكن** للقواعد فرض: الملكية، عدم قابلية الحدث للتعديل، `totals.debitMinor == totals.creditMinor`، `balanceMinor ≥ 0` أو الحساب يسمح بالسالب، `paidMinor ≤ totalMinor`، `paidMinor` لا ينقص إلا في حدث عكس، حدود الأحجام والأطوال.
- دالة `exists()` / `get()` في القواعد تُحاسب كقراءة، والحد **10 لكل طلب مستند واحد و20 لكل طلب مركّب (batch/transaction)**. تصميمنا يستهلك 2–4 منها لكل حدث (فحص وجود الحساب والفئة والالتزام) — داخل الحد، لكن هذا يقيّد الأحداث متعددة الأرجل: حدث بثمانية أرجل مع فحص وجود لكل طرف = 8 استدعاءات + 4 لمستندات الإسقاط = 12، ما يزال داخل الـ20 لكن الهامش ضيق. **قرار:** نفحص وجود الحسابات والالتزامات والديون بالقواعد، ونفحص وجود الفئات في طبقة الـ domain فقط (الفئات مُخزَّنة مؤقتاً في العميل ومستند `categories` غير حسّاس مالياً).

**الاستنتاج الصريح:** على Spark، الضمان النهائي لاتساق الإسقاط مع السجل هو **انضباط معماري** (طبقة domain هي الكاتب الوحيد) + **قدرة إثبات لاحقة** (التسوية في §3.4)، وليس فرضاً من الخادم. من يريد فرضاً خادمياً حقيقياً عليه الترقية إلى Blaze وجعل Cloud Function هي الكاتب الوحيد مع `allow write: if false` من العميل (القسم 11).

---

## 6. التعديل والإلغاء

### 6.1 المبدأ: لا حذف ولا تعديل — عكس ثم إعادة تسجيل

| الطلب | التنفيذ |
|---|---|
| **إلغاء عملية** | حدث `reversal` واحد، أرجله مرآة الحدث الأصلي (تبديل `debit`↔`credit`)، وأثره على السجلات التشغيلية معكوس الإشارة |
| **تعديل عملية** | في **transaction واحد**: حدث `reversal` للأصل + حدث جديد بالقيم المصحّحة يحمل `supersedesEventId = originalEventId` |
| **حذف نهائي** | غير موجود. القواعد تمنع `delete` على `financialEvents`. الأرشفة تكون بعلم على مستند الكيان لا بحذف الأحداث |

### 6.2 منع العكس المزدوج — مستند القفل

الحدث غير قابل للتعديل، فلا يمكن وسم الأصل بـ `reversed: true`. الحل: مستند منفصل معرّفه هو معرّف الحدث الأصلي:

```ts
/** eventReversals/{originalEventId} — وجوده يعني أن الأصل معكوس */
export interface EventReversal {
  readonly originalEventId: string;      // = معرّف المستند
  readonly reversalEventId: string;      // = "rev_" + originalEventId
  readonly uid: string;
  readonly reason: string;               // إلزامي، 5..500 حرفاً
  readonly reversedAt: Timestamp;
  readonly replacedByEventId: string | null;  // في حالة التعديل
}
```

داخل الـ transaction: قراءة `eventReversals/{originalEventId}` ⇒ إن وُجد، إيقاف بخطأ `ALREADY_REVERSED` (أو نجاح صامت إن كان `reversalEventId` مطابقاً — حالة إعادة المحاولة). إنشاء المستند في نفس الـ transaction يجعل «الحدث معكوس مرة واحدة فقط» شرطاً ذرّياً مفروضاً من قاعدة البيانات، لا من المنطق.

### 6.3 دالة العكس (التوقيع والسلوك)

```ts
export function buildReversal(
  original: FinancialEvent,
  reason: string,
  now: { opId: string; occurredAt: Timestamp }
): FinancialEvent;

/** قلب الرجل */
function mirrorLeg(l: EventLeg): EventLeg {
  return { ...l, side: l.side === 'debit' ? 'credit' : 'debit' };
}
```

**قواعد العكس المحددة:**
1. `periodKey` لحدث العكس = **فترة لحظة العكس** لا فترة الحدث الأصلي. السبب: التقارير الشهرية المقفلة لا تتغير أثر رجعياً، ويظهر التصحيح في شهره. **عيب هذا الخيار وأعلنه:** مصروف شهر 9 يُعكس في شهر 10 يجعل مصروف شهر 10 سالباً جزئياً. **المعالجة:** حقل `monthlySummaries.priorPeriodCorrectionMinor` يفصل تصحيحات الفترات السابقة عن مصروف الشهر الجاري، والتقارير تعرض السطرين منفصلين. البديل (إعادة فتح الشهر السابق) مرفوض لأنه يجعل تقريراً صُدِّر سابقاً مخالفاً للنظام.
2. أثر العكس على `obligations.paidMinor` **ينقص** — وهذا الاستثناء الوحيد الذي تسمح به القواعد لنقص `paidMinor`، ويُشترط فيه أن يكون الكاتب في نفس الـ transaction الذي يُنشئ `eventReversals`. (ولأن القواعد لا ترى مستندات أخرى في الطلب، تتحقق القاعدة فقط من أن النقص لا يُنتج قيمة سالبة؛ الربط الكامل يبقى مسؤولية طبقة الـ domain + التسوية.)
3. عكس حدث العكس **ممنوع** (`kind === 'reversal'` ⇒ خطأ `CANNOT_REVERSE_REVERSAL`). التصحيح على حدث معكوس يكون بإنشاء حدث جديد.

### 6.4 منع تضارب الأرصدة عند التعديل

حالة خطرة: تعديل مصروف من 25.500 إلى 400.000 د.ل والرصيد الحالي 100.000.
- **لا** نطبّق العكس ثم ننظر؛ بل نحسب **الأثر الصافي** داخل `decide`:
  ```
  netDelta(acc) = Σ(أرجل الحدث الجديد) + Σ(أرجل العكس)
  balanceAfter  = balanceNow + netDelta
  if (balanceAfter < −overdraftLimit && !allowNegative) → خطأ INSUFFICIENT_FUNDS
  ```
- الفحص على **الأثر الصافي** يمنع رفض تعديلات مشروعة كان الرصيد يسمح بها (مثل تخفيض مصروف) ويمنع قبول تعديل يجعل الرصيد سالباً.

### 6.5 أثر التدقيق (§18.9)

كل `reversal` و`adjustment` و`obligation_cancelled` يكتب `auditLogs/{logId}` في نفس الـ transaction:

```ts
export interface AuditLog {
  readonly id: string; readonly uid: string;
  readonly action: 'reversal' | 'adjustment' | 'cancel' | 'rebuild' |
                   'overpay_attempt' | 'negative_attempt';
  readonly targetEventId: string | null;
  readonly targetDocPath: string | null;
  readonly beforeSnapshot: Record<string, number> | null;  // حقول مالية فقط
  readonly afterSnapshot: Record<string, number> | null;
  readonly reason: string;
  readonly at: Timestamp;                 // serverTimestamp
  readonly deviceId: string;
}
```
محاولات الفشل (سداد زائد، رصيد سالب) تُسجَّل أيضاً — **لكن خارج الـ transaction** (لأنها فشلت)، بكتابة مفردة، وبصمت لا يعطّل تجربة المستخدم.

---

## 7. تطبيق قواعد الأعمال في §19 — الجدول المرجعي

### 7.1 الجدول الرئيسي: كل قاعدة ← الأرجل ← الأثر على كل كيان

الرموز: `↑` زيادة، `↓` نقص، `—` لا أثر، `(ج)` مجموع جزئي لا يضاف.

| # | قاعدة §19 | `kind` | الأرجل (`legs`) | `accounts` | `monthlySummaries` | `budgets` | `obligations` | `debts (owed_by_me)` | `debts (owed_to_me)` | `goals` | `projections/liabilities` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | المصروف المدفوع يخفض رصيد الحساب | `expense` | `debit expense(cat)` / `credit asset(acc)` | `balance ↓` بالمبلغ | `expenseMinor ↑`، `expenseByCategory[cat] ↑`، `personal/householdExpense ↑` | `spentMinor ↑`، `spentByCategory[cat] ↑` | — | — | — | — | — |
| 2 | الدخل المستلم يرفع رصيد الحساب | `income` | `debit asset(acc)` / `credit income(src)` | `balance ↑` | `incomeMinor ↑`، `incomeBySource[src] ↑`، `netMinor ↑` | — | — | — | — | — | — |
| 3 | التحويل لا يغيّر إجمالي الأموال | `transfer` | `debit asset(B)` / `credit asset(A)` | `A.balance ↓`، `B.balance ↑`، **Σ ثابت** | `transferVolumeMinor ↑` فقط؛ `expense/income` **لا تتغير** | — | — | — | — | — | — |
| 4 | إنشاء التزام غير مدفوع لا يخفض النقد | `obligation_opened` | **`legs = []`** | — | — | — | مستند جديد: `total`, `paid=0`, `remaining=total`, `status='upcoming'` | — | — | — | `obligationsRemaining ↑`، و`DueNext7d/Overdue` حسب التاريخ |
| 5 | دفع التزام يخفض الرصيد ويسجّل الدفعة | `obligation_payment` | `debit expense(cat)` / `credit asset(acc)` + `registerEffects: [{obligation, paidDelta:+x}]` | `balance ↓` | `expenseMinor ↑`، `expenseByCategory[cat] ↑`، `obligationPaymentMinor ↑ (ج)` | `spentMinor ↑`، `spentByCategory[cat] ↑` | `paid ↑`، `remaining ↓`، `status` يُعاد حسابه، `paymentEventIds += opId` | — | — | — | `obligationsRemaining ↓`، `Overdue/DueNext7d` يُعاد حسابه |
| 6 | تسجيل دين عليّ لا يعني حركة نقدية | `debt_opened` (`direction='owed_by_me'`) | **أ) استُلم نقد:** `debit asset(acc)` / `credit liability(debt)`<br>**ب) بلا نقد (شراء مؤجل):** `debit expense(cat)` / `credit liability(debt)` | أ) `balance ↑` بالمبلغ<br>ب) — | أ) `expense/income` **لا تتغير** (اقتراض ليس دخلاً)<br>ب) `expenseMinor ↑`، `expenseByCategory[cat] ↑` | أ) —<br>ب) `spentMinor ↑` | — | مستند جديد: `principal`, `settled=0`, `outstanding=principal`, `status='open'` | — | — | `debtsOwedByMe ↑` |
| 7 | تحصيل دين لي يرفع رصيد الحساب | `receivable_collection` | `debit asset(acc)` / `credit receivable(debt)` + `registerEffects: [{receivable, collectedDelta:+x}]` | `balance ↑` | `receivableCollectionMinor ↑` فقط؛ `incomeMinor` **لا يتغير** (ليس دخلاً) | — | — | — | `settled ↑`، `outstanding ↓`، `status` يُعاد حسابه | — | `debtsOwedToMe ↓` |
| 8 | سداد دين عليّ يخفض رصيد الحساب | `debt_payment` | `debit liability(debt)` / `credit asset(acc)` + `registerEffects: [{debt, settledDelta:+x}]` | `balance ↓` | `debtPaymentMinor ↑` فقط؛ `expenseMinor` **لا يتغير** (المصروف اعتُرف به عند النشوء، أو لم يكن مصروفاً أصلاً) | — | — | `settled ↑`، `outstanding ↓`، `status` يُعاد حسابه | — | — | `debtsOwedByMe ↓` |
| 9 | المستحق للتحصيل لا يُعرض ضمن النقد المتاح | — (قاعدة عرض) | — | `availableCash = Σ(balance − earmarked)` لحسابات `asset` فقط؛ `receivable` **ليست** `asset` في هذا التجميع | — | — | — | — | يُعرض في بطاقة «المستحق لي» المنفصلة من `liabilities.debtsOwedToMe` | — | فصل تام |
| 10 | تعديل/إلغاء يحفظ الأثر ويمنع التضارب | `reversal` (+ حدث جديد) | مرآة أرجل الأصل (تبديل الاتجاه) | `balance` بالأثر **الصافي** (§6.4) | عكس إسهامات الأصل؛ تصحيحات الفترات السابقة في `priorPeriodCorrectionMinor` | عكس `spent` | عكس `paid`/`remaining`، وإعادة حساب `status` | عكس `settled`/`outstanding` | عكس `settled`/`outstanding` | عكس `allocated` | إعادة حساب كامل للإجماليات المتأثرة |
| 11 | التمييز بين التحويل والاقتراض والسداد والدخل والمصروف الحقيقي | ثابت معماري | `nature` على كل رجل | — | **`expenseMinor` و`incomeMinor` يتغذيان حصراً من أرجل `nature='expense'` و`nature='income'`**. `transfer`, `debt_opened(أ)`, `debt_payment`, `receivable_collection`, `goal_allocation` لا تملك أرجلاً من هاتين الطبيعتين ⇒ **لا تضخّم ممكن بنيوياً** | يتغذى من `nature='expense'` فقط | — | — | — | — | — |

### 7.2 قواعد §19 الإضافية: الأحداث المساندة

| القاعدة / المتطلب | `kind` | الأرجل | الأثر الدقيق |
|---|---|---|---|
| نشوء دين لي (أقرضت نقداً) — §10 | `receivable_opened` | `debit receivable(debt)` / `credit asset(acc)` | `account.balance ↓`؛ `expense/income` **لا تتغير** (إقراض ليس مصروفاً)؛ `debts` مستند جديد `direction='owed_to_me'`؛ `liabilities.debtsOwedToMe ↑` |
| إعدام دين لي | `receivable_write_off` | `debit expense(cat='ديون معدومة')` / `credit receivable(debt)` | `expenseMinor ↑` (اعتراف بالخسارة)؛ `debt.writtenOff ↑`، `outstanding ↓`، `status='written_off'`؛ `liabilities.debtsOwedToMe ↓` |
| إلغاء التزام — §8 | `obligation_cancelled` | `legs = []` | `obligation.status='cancelled'`، `remaining` يُجمَّد ويُستثنى من الإجماليات؛ `liabilities.obligationsRemaining ↓` بالمتبقي. **الدفعات السابقة تبقى** أحداثاً ومصروفاً فعلياً |
| تخصيص ادخار — §12 | `goal_allocation` | `legs = []` | `goal.allocated ↑`، `progressBps` يُعاد حسابه؛ `account.earmarked ↑` للحساب المرتبط؛ `balanceMinor` **لا يتغير** (حجز لا إنفاق)؛ `liabilities.goalsAllocated ↑` |
| الرصيد الافتتاحي — §5 | `opening_balance` | `debit asset(acc)` / `credit equity('opening')` | `account.balance = openingBalance`؛ `expense/income` **لا تتغير**. مرة واحدة لكل حساب (`opId = 'open_' + accountId`) |
| تسوية رصيد مبرَّرة — §5 | `adjustment` | `debit/credit asset(acc)` / الطرف المقابل `equity('adjustment')` | `account.balance ±`؛ `expense/income` **لا تتغير**؛ `reason` إلزامي؛ `auditLogs` إلزامي. **الطريق الوحيد** لتغيير رصيد بغير حركة حقيقية |
| الزكاة: فصل الاحتساب عن الدفع — §15.4 | `expense` عادي | `debit expense(cat='زكاة وصدقات')` / `credit asset(acc)` | حاسبة الزكاة **لا تنتج أي حدث**؛ نتيجتها في `zakatRecords` فقط. الخصم يحدث فقط بحدث `expense` صريح |
| الدخل المتوقع — §7 | **لا حدث** | — | يبقى في `recurringTemplates` / `expectedIncome` كتوقّع؛ `accounts` و`monthlySummaries` **لا تتأثر** حتى يُسجَّل `income` فعلي |
| مصاريف المنزل — §11 | `expense` بـ `scope='household'` | كالمصروف العادي | حدث **واحد**؛ شاشة المنزل تقرأ `monthlySummaries.householdExpenseMinor` وتستعلم الأحداث بـ `scope`. **لا تكرار للقيمة** في التقارير العامة |

### 7.3 الإثبات البنيوي لقاعدة 3 وقاعدة 11

**قاعدة 3 (التحويل لا يغيّر الإجمالي):** إجمالي النقد = `Σ balance` للحسابات ذات الطبيعة `asset`. حدث `transfer` أرجله `{debit asset(B), credit asset(A)}` بنفس المبلغ ⇒ `Δ Σ balance = +x − x = 0`. مبرهَن من بنية الأرجل، لا من اختبار.

**قاعدة 11 (منع تضخّم التقارير):** المُسقِط الشهري معرّف هكذا:
```ts
function applyToMonthly(e: FinancialEvent, m: MonthlySummary): MonthlySummary {
  for (const leg of e.legs) {
    if (leg.target.nature === 'expense')
      m.expenseMinor += signFor(leg);        // + إن debit، − إن credit
    else if (leg.target.nature === 'income')
      m.incomeMinor += signFor(leg) * -1;    // + إن credit
  }
  // لا فرع آخر يمس expenseMinor أو incomeMinor — إطلاقاً
}
```
لأن `transfer` و`debt_payment` و`receivable_collection` و`goal_allocation` **لا تحوي أرجلاً** بطبيعة `expense` أو `income`، فمن المستحيل بنيوياً أن تدخل التقرير. هذا أقوى من قاعدة مكتوبة في التوثيق: إنها خاصية من النوع (type‑level property).

### 7.4 جدول دالة الحالة (status) — دالة نقية لا حقل يُكتب يدوياً

```ts
export function obligationStatus(
  o: Pick<Obligation, 'paidMinor' | 'totalMinor' | 'dueDate'>,
  now: Date, cancelled: boolean
): ObligationStatus;
```

| الشرط (بالترتيب) | الحالة |
|---|---|
| `cancelled` | `cancelled` |
| `paidMinor >= totalMinor` | `paid` |
| `paidMinor > 0 && now > dueDate` | `overdue` *(متأخر يغلب مسدَّد جزئياً — أولوية التنبيه)* |
| `paidMinor > 0` | `partially_paid` |
| `now > dueDate` | `overdue` |
| `isSameDay(now, dueDate)` | `due` |
| غير ذلك | `upcoming` |

الحالة **تُخزَّن** (للفهرسة والاستعلام §4) لكنها **تُحسب دائماً بهذه الدالة** — في كل transaction يمس الالتزام، وفي مهمة تحديث خفيفة عند أول فتح للتطبيق كل يوم (لأن `overdue` دالة في الوقت لا في الأحداث). هذه المهمة اليومية تكتب فقط المستندات التي تغيّرت حالتها، باستعلام `where status in ['upcoming','due','partially_paid'] and dueDate < today`.

---

## 8. الحمايات: الرصيد السالب، السداد الزائد، الحركة اليتيمة

### 8.1 الرصيد السالب غير المسموح

**ثلاث طبقات:**
1. **طبقة الـ domain داخل الـ transaction** (الطبقة الفعّالة):
   ```ts
   export function assertSufficientFunds(
     acc: Account, netDeltaMinor: Minor
   ): Result<void, DomainError> {
     const after = acc.balanceMinor + netDeltaMinor;
     if (after < 0 && !acc.allowNegative) return err('INSUFFICIENT_FUNDS', {...});
     if (after < -acc.overdraftLimitMinor) return err('OVERDRAFT_EXCEEDED', {...});
     return ok();
   }
   ```
   الرسالة العربية: «رصيد حساب «نقد شخصي» 100.000 د.ل لا يكفي لمصروف 400.000 د.ل. المتاح للإنفاق 100.000 د.ل بعد حجز الأهداف.»
2. **قواعد الأمان** (شبكة أمان ضد كاتب يتجاوز الطبقة):
   ```
   allow update: if request.resource.data.balanceMinor >= 0
                 || resource.data.allowNegative == true;
   ```
3. **التسوية** (§3.4) تكشف أي رصيد سالب غير مبرَّر نشأ من خطأ برمجي، وتعرضه في شاشة «سلامة البيانات».

**التمييز المهم:** المتاح للإنفاق = `balanceMinor − earmarkedMinor`. تجاوز `earmarked` **تحذير لا منع** (المال ملك المستخدم وله تعطيل حجز هدفه)، وتجاوز `balanceMinor` **منع**. هذا فرق دلالي يجب ألا يُدمج.

### 8.2 السداد الزائد عن المستحق

```ts
export function assertNotOverpaid(
  outstandingMinor: Minor, paymentMinor: Minor, allowExcess: false
): Result<void, DomainError> {
  if (paymentMinor > outstandingMinor)
    return err('OVERPAYMENT', { outstandingMinor, paymentMinor,
                                excessMinor: paymentMinor - outstandingMinor });
  return ok();
}
```
- يُطبَّق على: `obligation_payment` (مقابل `obligation.remainingMinor`)، `debt_payment` و`receivable_collection` (مقابل `debt.outstandingMinor`).
- القراءة **داخل الـ transaction** إلزامية — القراءة قبلها تسمح بسداد زائد عند دفعتين متزامنتين من جهازين.
- عند `OVERPAYMENT` تعرض الواجهة خياراً صريحاً: «المتبقي 150.000 د.ل فقط. هل تريد: (أ) سداد 150.000 وإنهاء الالتزام، أم (ب) سداد 150.000 وتسجيل 50.000 كمصروف منفصل؟» — **لا قبول صامت للزيادة**.
- شبكة أمان في القواعد: `request.resource.data.paidMinor <= resource.data.totalMinor`.

### 8.3 الحركة اليتيمة (orphan)

| نوع اليُتم | المنع |
|---|---|
| رجل تشير إلى `accountId` غير موجود | **قواعد الأمان:** `exists(/databases/$(db)/documents/users/$(uid)/accounts/$(accId))` على كتابة الحدث + فحص في طبقة الـ domain |
| رجل تشير إلى `categoryId` غير موجود | فحص في طبقة الـ domain مقابل ذاكرة الفئات المؤقتة؛ إن فُقدت الفئة لاحقاً، الفئة **تُعطَّل لا تُحذف** (§6) فلا يتيم |
| `registerEffect` تشير إلى التزام/دين غير موجود | **التزام ذرّي:** المستند يُقرأ في نفس الـ transaction؛ عدم وجوده ⇒ `REFERENCED_DOC_MISSING` |
| إسقاط محدَّث بلا حدث مقابل (اليتم المعاكس — الأخطر) | لا كتابة على أي إسقاط إلا من دالة `writes` في `TxPlan` التي تكتب الحدث في نفس الـ transaction. القواعد تمنع كتابة `accounts.balanceMinor` من أي مسار آخر غير الذي يحمل `lastEventId` جديداً: `request.resource.data.lastEventId != resource.data.lastEventId` |
| حدث موجود بلا أثر على الإسقاط (فشل جزئي) | **مستحيل** — ذرّية الـ transaction. هذه هي الميزة المركزية لهذا المنظور |
| حذف حساب له حركات | ممنوع. الحساب يُؤرشف فقط (`status='archived'`)، والقواعد تمنع `delete` على `accounts` إذا `eventCount > 0` |

### 8.4 العمليات غير المكتملة

- لا توجد حالة «قيد التنفيذ» في `financialEvents` — الحدث موجود ومُطبَّق، أو غير موجود. طابور `pendingCommands` هو المكان الوحيد للحالة الوسطية، وهو **ليس** مصدر حقيقة مالياً ولا يُقرأ في أي تقرير.
- أمر يبقى `queued` أكثر من 7 أيام يُعرض في شاشة «عمليات معلّقة» مع زر إعادة محاولة أو إلغاء.

---

## 9. تكلفة Firestore

### 9.1 لكل مصروف مسجَّل (الحالة الشائعة)

| العملية | قراءات | كتابات |
|---|---|---|
| `get(financialEvents/{opId})` — فحص الازدواج (غير موجود) | 1 | — |
| `get(accounts/{accId})` — حاجز الرصيد | 1 | — |
| `exists()` في القواعد — الحساب | 1 | — |
| `set(financialEvents/{opId})` | — | 1 |
| `update(accounts/{accId})` — رصيد صريح (لا `increment`، لأنه محروس) | — | 1 |
| `set(monthlySummaries/{p}, merge)` — `increment` بلا قراءة | — | 1 |
| `set(budgets/{p}, merge)` — `increment` بلا قراءة | — | 1 |
| `set(projections/checkpoint, merge)` — `increment` بلا قراءة | — | 1 |
| **المجموع** | **3** | **5** |

> **تحسين مقصود:** الإسقاطات غير المحروسة (`monthlySummaries`, `budgets`, `checkpoint`) تُحدَّث بـ `FieldValue.increment()` مع `{merge:true}` ⇒ **لا تُقرأ أصلاً**، وتُنشأ تلقائياً إن لم تكن موجودة. هذا يوفّر 3 قراءات من 6. **المقابل:** لا يمكن فحص نتيجة الزيادة داخل الـ transaction (مثل «هل تجاوزنا سقف الميزانية؟»)، فيتم فحص التنبيه بقراءة **خارج** الـ transaction بعد النجاح (قراءة إضافية واحدة، غير حرجة، ومُخزَّنة مؤقتاً).

### 9.2 التكلفة لكل نوع حدث

| الحدث | قراءات | كتابات | المستندات المكتوبة |
|---|---|---|---|
| `expense` / `income` | 3 | 5 | event, account, monthly, budget, checkpoint |
| `expense` بلا ميزانية للشهر | 3 | 4 | event, account, monthly, checkpoint |
| `transfer` | 4 | 5 | event, accountA, accountB, monthly, checkpoint |
| `obligation_payment` | 4 | 7 | event, account, obligation, monthly, budget, liabilities, checkpoint |
| `debt_payment` | 4 | 6 | event, account, debt, monthly, liabilities, checkpoint |
| `receivable_collection` | 4 | 5 | event, account, debt, liabilities, checkpoint |
| `obligation_opened` | 2 | 4 | event, obligation, liabilities, checkpoint |
| `goal_allocation` | 3 | 5 | event, goal, account(earmark), liabilities, checkpoint |
| `reversal` (لمصروف) | 5 | 7 | revEvent, eventReversals, account, monthly, budget, auditLog, checkpoint |
| `تعديل` = عكس + جديد | 6 | 10 | ما سبق + الحدث الجديد وآثاره |

### 9.3 لكل فتح للوحة التحكم

| المصدر | قراءات |
|---|---|
| `accounts` (نشطة، ≈ 4) | 4 |
| `monthlySummaries/{current}` | 1 |
| `budgets/{current}` | 1 |
| `projections/liabilities` | 1 |
| `settings` | 1 |
| الالتزامات القادمة (استعلام `limit 5`) | 5 |
| مهام اليوم (استعلام `limit 5`) | 5 |
| التنبيهات غير المقروءة (استعلام `limit 5`) | 5 |
| **المجموع (أول فتح، بلا ذاكرة مؤقتة)** | **≈ 23** |
| **المجموع (فتح لاحق مع `cache-first` لـ settings/accounts)** | **≈ 10** |

رسم «اتجاهات 12 شهراً» يُحمَّل **عند الطلب فقط** (lazy) بـ 12 قراءة، ويُخزَّن مؤقتاً مع إبطال عند أي حدث يمس شهراً من الاثني عشر.

### 9.4 الحجم السنوي المتوقع (تقدير واقعي لمستخدم واحد)

| البند | العدد السنوي | القراءات | الكتابات |
|---|---|---|---|
| مصروفات (6/يوم) | 2190 | 6570 | 10950 |
| أحداث أخرى (دخل، التزامات، ديون، تحويلات) | 300 | 1200 | 1800 |
| فتح لوحة التحكم (5/يوم) | 1825 | ~18250 | — |
| تقارير وكشوف | — | ~15000 | — |
| مهمة تحديث الحالات اليومية | 365 | 1825 | ~730 |
| **الإجمالي** | | **≈ 43 ألف** | **≈ 13.5 ألف** |

حدود Spark اليومية المجانية: **50 ألف قراءة** و**20 ألف كتابة** يومياً. الاستهلاك المتوقع **سنوياً** أقل من حد **يوم واحد** ⇒ التكلفة ليست قيداً فعلياً لمستخدم واحد. **القيد الحقيقي على Spark هو غياب Cloud Functions و Storage، لا التكلفة.**

---

## 10. أمثلة ملموسة: تسلسل الكتابات بالضبط

> الفرضيات المشتركة: `uid = "u_mohamed"`، `P = "2026-10"`، `today = 2026-10-09`.

### (أ) مصروف 25.500 د.ل من حساب نقدي

**المدخل:** `25.500 د.ل` ⇒ `parseMinor("25.5") = 25500` درهم. الحساب `acc_cash` رصيده `400000` (400.000 د.ل)، `allowNegative=false`, `overdraftLimit=0`, `earmarked=0`. الفئة `cat_food`. `opId = "01JA7X...K2"` (UUIDv7، تولَّد عند فتح النموذج).

**الحدث المُبنى (نقي، قبل أي I/O):**
```json
{
  "opId": "01JA7X...K2", "uid": "u_mohamed", "kind": "expense", "schemaVersion": 1,
  "occurredAt": "2026-10-09T18:20:00Z", "recordedAt": "<serverTimestamp>",
  "periodKey": "2026-10",
  "legs": [
    { "target": { "nature": "expense", "categoryId": "cat_food" },
      "side": "debit",  "amountMinor": 25500 },
    { "target": { "nature": "asset", "accountId": "acc_cash" },
      "side": "credit", "amountMinor": 25500 }
  ],
  "registerEffects": [],
  "totals": { "debitMinor": 25500, "creditMinor": 25500 },
  "accountIds": ["acc_cash"], "categoryIds": ["cat_food"],
  "description": "غداء", "scope": "personal", "paymentMethod": "cash",
  "source": "manual", "clientInfo": { "deviceId": "dev_pc", "appVersion": "1.0.0" }
}
```
الشروط: I1 `25500 = 25500` ✅ · I2 ✅ · I5 `["acc_cash"]` ✅ · I6 (`expense` تسمح بـ `expense/asset`) ✅

**`runTransaction` — المرحلة 1: القراءات (بالترتيب، قبل أي كتابة)**
```
R1  get users/u_mohamed/financialEvents/01JA7X...K2   → exists = false
R2  get users/u_mohamed/accounts/acc_cash             → { balanceMinor: 400000,
                                                          earmarkedMinor: 0,
                                                          allowNegative: false,
                                                          eventCount: 311 }
```

**المرحلة 2: القرار (`decide`، دالة نقية)**
```
netDelta(acc_cash) = −25500
balanceAfter       = 400000 − 25500 = 374500   ≥ 0  ✅
availableAfter     = 374500 − 0 = 374500       (لا تحذير حجز)
```

**المرحلة 3: الكتابات (5 كتابات، بالترتيب)**
```
W1  create users/u_mohamed/financialEvents/01JA7X...K2
      ← مستند الحدث أعلاه (recordedAt = serverTimestamp())

W2  update users/u_mohamed/accounts/acc_cash
      balanceMinor = 374500            ← قيمة صريحة محسوبة (محروسة، لا increment)
      lastEventId  = "01JA7X...K2"
      eventCount   = 312
      updatedAt    = serverTimestamp()

W3  set users/u_mohamed/monthlySummaries/2026-10   { merge: true }
      expenseMinor                    = increment(+25500)
      netMinor                        = increment(−25500)
      personalExpenseMinor            = increment(+25500)
      expenseByCategory.cat_food      = increment(+25500)
      eventCount                      = increment(1)
      lastEventAt                     = serverTimestamp()
      schemaVersion                   = 1

W4  set users/u_mohamed/budgets/2026-10            { merge: true }
      spentMinor                      = increment(+25500)
      spentByCategory.cat_food        = increment(+25500)

W5  set users/u_mohamed/projections/checkpoint     { merge: true }
      eventsApplied                   = increment(1)
      debitChecksumMinor              = increment(+25500)
      lastEventId                     = "01JA7X...K2"
      lastRecordedAt                  = serverTimestamp()
```

**بعد الـ commit (خارج الـ transaction، غير حرج):**
- حذف `opId` من `localStorage`.
- قراءة واحدة لـ `budgets/2026-10` لفحص `spentByCategory.cat_food ≥ capByCategory.cat_food × 80%` ⇒ إنشاء تنبيه إن تجاوز (§17).
- **إجمالي: 3 قراءات (R1, R2, + `exists()` في القواعد)، 5 كتابات.**

**لو ضغط المستخدم الزر مرة ثانية:** نفس `opId` ⇒ `R1.exists = true` ⇒ `decide` يُرجع «لا كتابات» ⇒ **0 كتابة**، والواجهة تعرض نجاحاً بالحدث الموجود. التكلفة: قراءة واحدة.

---

### (ب) سداد جزئي 200.000 د.ل لالتزام إيجار قيمته 800.000

**الحالة الابتدائية:** `obligations/obl_rent` = `{ totalMinor: 800000, paidMinor: 0, remainingMinor: 800000, status: 'due', dueDate: 2026-10-05, defaultCategoryId: 'cat_rent' }` (متأخر). الحساب `acc_bank` رصيده `1500000`. `opId = "01JA7Y...M9"`.

**الحدث:**
```json
{
  "opId": "01JA7Y...M9", "kind": "obligation_payment", "periodKey": "2026-10",
  "legs": [
    { "target": { "nature": "expense", "categoryId": "cat_rent" },
      "side": "debit",  "amountMinor": 200000 },
    { "target": { "nature": "asset", "accountId": "acc_bank" },
      "side": "credit", "amountMinor": 200000 }
  ],
  "registerEffects": [
    { "register": "obligation", "obligationId": "obl_rent", "paidDeltaMinor": 200000 }
  ],
  "totals": { "debitMinor": 200000, "creditMinor": 200000 },
  "accountIds": ["acc_bank"], "categoryIds": ["cat_rent"],
  "description": "سداد جزئي — إيجار أكتوبر", "scope": "household",
  "paymentMethod": "transfer", "source": "manual"
}
```

**القراءات (3):**
```
R1  get financialEvents/01JA7Y...M9        → exists = false
R2  get accounts/acc_bank                  → { balanceMinor: 1500000, allowNegative: false }
R3  get obligations/obl_rent               → { totalMinor: 800000, paidMinor: 0,
                                                remainingMinor: 800000,
                                                paymentEventIds: [] }
```

**القرار:**
```
حاجز الرصيد:       1500000 − 200000 = 1300000 ≥ 0                      ✅
حاجز السداد الزائد: 200000 ≤ remainingMinor 800000                      ✅
paidAfter      = 0 + 200000 = 200000
remainingAfter = 800000 − 200000 = 600000
statusAfter    = obligationStatus({paid:200000, total:800000,
                                   dueDate:2026-10-05}, 2026-10-09, false)
               = 'overdue'     ← (paid>0 ∧ now>dueDate) يغلب 'partially_paid'
```

**الكتابات (7):**
```
W1  create financialEvents/01JA7Y...M9        ← الحدث أعلاه

W2  update accounts/acc_bank
      balanceMinor = 1300000                  ← صريح (محروس)
      lastEventId  = "01JA7Y...M9"
      eventCount   = increment(1)
      updatedAt    = serverTimestamp()

W3  update obligations/obl_rent
      paidMinor       = 200000                ← صريح (محروس بحاجز السداد الزائد)
      remainingMinor  = 600000                ← صريح
      status          = "overdue"
      paymentEventIds = arrayUnion("01JA7Y...M9")
      lastPaymentAt   = serverTimestamp()
      updatedAt       = serverTimestamp()

W4  set monthlySummaries/2026-10        { merge: true }
      expenseMinor                 = increment(+200000)
      netMinor                     = increment(−200000)
      householdExpenseMinor        = increment(+200000)      ← §11، لا تكرار
      expenseByCategory.cat_rent   = increment(+200000)
      obligationPaymentMinor       = increment(+200000)      ← مجموع جزئي (ج)
      eventCount                   = increment(1)

W5  set budgets/2026-10                 { merge: true }
      spentMinor                   = increment(+200000)
      spentByCategory.cat_rent     = increment(+200000)

W6  set projections/liabilities         { merge: true }
      obligationsRemainingMinor    = increment(−200000)
      obligationsOverdueMinor      = increment(−200000)   ← كان متأخراً بالكامل
      staleAfter                   = <نهاية اليوم>

W7  set projections/checkpoint          { merge: true }
      eventsApplied      = increment(1)
      debitChecksumMinor = increment(+200000)
      lastEventId        = "01JA7Y...M9"
```

**لو حاول سداد 900.000:** `R3` يُظهر `remaining = 800000` ⇒ `decide` يُرجع `OVERPAYMENT { excessMinor: 100000 }` ⇒ **0 كتابة** في الـ transaction، ورسالة عربية مع الخيارين في §8.2، و`auditLog` بكتابة مفردة خارج الـ transaction.

**ملاحظة على `W6`:** `obligationsOverdueMinor` تعتمد على الحالة **قبل** الدفعة. اعتماد `increment` هنا صحيح فقط لأننا قرأنا الالتزام في `R3` وعرفنا حالته السابقة. لو لم نقرأه لكانت `increment` خطأ — وهذا مثال دقيق على متى يصلح `increment` ومتى لا يصلح: **يصلح متى كان المقدار المُزاد معلوماً يقيناً من قراءة داخل الـ transaction أو من الحدث نفسه، ولا يصلح متى اعتمد على نتيجة الزيادة.**

---

### (ج) تحصيل 150.000 د.ل من دين لي قيمته 400.000 إلى حساب مصرفي

**الحالة الابتدائية:** `debts/dbt_ali` = `{ direction: 'owed_to_me', counterpartyName: 'علي', principalMinor: 400000, settledMinor: 0, writtenOffMinor: 0, outstandingMinor: 400000, status: 'open' }`. `accounts/acc_bank` رصيده `1300000` (بعد المثال ب). `opId = "01JA7Z...Q4"`.

**الحدث:**
```json
{
  "opId": "01JA7Z...Q4", "kind": "receivable_collection", "periodKey": "2026-10",
  "legs": [
    { "target": { "nature": "asset", "accountId": "acc_bank" },
      "side": "debit",  "amountMinor": 150000 },
    { "target": { "nature": "receivable", "debtId": "dbt_ali" },
      "side": "credit", "amountMinor": 150000 }
  ],
  "registerEffects": [
    { "register": "receivable", "debtId": "dbt_ali", "collectedDeltaMinor": 150000 }
  ],
  "totals": { "debitMinor": 150000, "creditMinor": 150000 },
  "accountIds": ["acc_bank"], "categoryIds": [],
  "description": "تحصيل جزئي من علي", "scope": "personal",
  "paymentMethod": "transfer", "source": "manual"
}
```

**القراءات (3):**
```
R1  get financialEvents/01JA7Z...Q4   → exists = false
R2  get accounts/acc_bank             → { balanceMinor: 1300000 }
R3  get debts/dbt_ali                 → { outstandingMinor: 400000, settledMinor: 0,
                                           principalMinor: 400000, direction: 'owed_to_me' }
```

**القرار:**
```
حاجز التحصيل الزائد: 150000 ≤ outstandingMinor 400000                   ✅
(لا حاجز رصيد سالب — الحساب يزيد)
settledAfter     = 0 + 150000     = 150000
outstandingAfter = 400000 − 150000 = 250000
statusAfter      = 'partially_settled'
```

**الكتابات (5):**
```
W1  create financialEvents/01JA7Z...Q4        ← الحدث أعلاه

W2  update accounts/acc_bank
      balanceMinor = 1450000                  ← 1300000 + 150000، صريح
      lastEventId  = "01JA7Z...Q4"
      eventCount   = increment(1)

W3  update debts/dbt_ali
      settledMinor     = 150000               ← صريح (محروس)
      outstandingMinor = 250000               ← صريح
      status           = "partially_settled"
      paymentEventIds  = arrayUnion("01JA7Z...Q4")
      updatedAt        = serverTimestamp()

W4  set projections/liabilities         { merge: true }
      debtsOwedToMeMinor = increment(−150000)

W5  set projections/checkpoint          { merge: true }
      eventsApplied      = increment(1)
      debitChecksumMinor = increment(+150000)
      lastEventId        = "01JA7Z...Q4"
```

**ما لا يُكتب — وهذا جوهر القاعدة 7 في §19:**
- ❌ `monthlySummaries.incomeMinor` **لا يزيد.** التحصيل ليس دخلاً؛ المال كان ملك المستخدم أصلاً وسُجِّل كأصل `receivable` عند الإقراض. لو زاد `incomeMinor` لتضخّم «إجمالي الدخل الشهري» في لوحة التحكم بمبلغ ليس دخلاً.
- ✅ يزيد `monthlySummaries.receivableCollectionMinor` فقط — حقل تدقيقي لا يدخل أي مجموع في التقارير.
- ❌ `budgets` لا تتأثر (لا رجل بطبيعة `expense`).

**أثر المثالين (ج) و(أ) على بطاقات لوحة التحكم:**

| البطاقة | القيمة | المصدر |
|---|---|---|
| إجمالي الأموال المتاحة | `374500 + 1450000 = 1824500` = **1,824.500 د.ل** | `Σ(accounts.balance − earmarked)` |
| إجمالي المصروفات الشهرية | `25500 + 200000 = 225500` = **225.500 د.ل** | `monthlySummaries.expenseMinor` |
| إجمالي الدخل الشهري | **0.000 د.ل** | `monthlySummaries.incomeMinor` — التحصيل لم يدخل |
| إجمالي المستحق لي | **250.000 د.ل** | `projections/liabilities.debtsOwedToMeMinor` — منفصل تماماً عن النقد (§19 قاعدة 9) |
| الالتزامات المتأخرة | **600.000 د.ل** | `projections/liabilities.obligationsOverdueMinor` |
| مصاريف المنزل | **200.000 د.ل** | `monthlySummaries.householdExpenseMinor` — مجموع جزئي داخل 225.500، لا إضافة عليها |

---

## 11. Spark مقابل Blaze: ما يعمل وما يتطلب ترقية

| القدرة | على Spark | على Blaze (تحسين اختياري) |
|---|---|---|
| تسجيل الأحداث والإسقاطات ذرّياً | ✅ `runTransaction` من العميل | نفسه، أو عبر Callable Function |
| منع الازدواج | ✅ معرّف المستند = `opId` + قواعد تمنع `update` | نفسه |
| **تنفيذ المصروف المتكرر** | ✅ **لحاق من العميل** عند فتح التطبيق: استعلام القوالب المستحقة، وتوليد `opId` محدد لكل مناسبة فائتة. آمن متعدد الأجهزة بفضل التحديد الحسابي. **العيب:** لا يُنفَّذ إن لم يُفتح التطبيق | ⭐ `onSchedule` (Cloud Scheduler) ينفّذ يومياً بلا فتح التطبيق |
| **إعادة بناء الإسقاطات** | ⚠️ من العميل، بدفعات `writeBatch`، **غير ذرّية** إجمالاً | ⭐ Callable Function طويلة الأمد + ذرّية أفضل، أو Dataflow |
| **التسوية الدورية** | ✅ عند فتح التطبيق + `getAggregateFromServer` | ⭐ `onSchedule` أسبوعياً + تنبيه عند الانحراف |
| **فرض خادمي كامل للاتساق** | ❌ مستحيل — القواعد لا ترى مستندات أخرى في نفس الطلب | ⭐ `allow write: if false` على `financialEvents` و`accounts` من العميل، وCloud Function هي الكاتب الوحيد ⇒ الشرط `Σdebit=Σcredit` والربط بين الحدث والإسقاط **مفروضان خادمياً** |
| **مرفقات الإيصالات** (§6) | ❌ Firebase Storage يتطلب Blaze في المشاريع الحديثة. **البديل على Spark:** صورة مضغوطة (JPEG، عرض ≤ 1280px، ≤ 180 KB) مخزَّنة كـ `base64` في مستند `attachments/{id}` منفصل (حد المستند 1 MiB). **لا تُخزَّن في مستند الحدث** لئلا تثقل كل قراءة | ⭐ Storage مع قواعد حجم ونوع + روابط موقَّعة |
| تصدير PDF/Excel (§16) | ✅ في العميل (`xlsx`, `jspdf`) | ⭐ توليد خادمي للملفات الكبيرة |
| إشعارات الدفع (§14، §17) | ⚠️ إشعارات المتصفح المحلية فقط عند فتح التطبيق | ⭐ FCM مع Function مجدولة |
| النسخ الاحتياطي (§20) | ⚠️ تصدير JSON من العميل بطلب المستخدم | ⭐ `gcloud firestore export` مجدول |

**الخلاصة:** النواة المحاسبية الموصوفة هنا **تعمل بكاملها على Spark** — الذرّية والمنع المزدوج والحواجز كلها من `runTransaction` في العميل. ما يتطلب Blaze هو: الجدولة المستقلة عن فتح التطبيق، المرفقات كملفات، والفرض الخادمي الكامل للاتساق. ولا شيء من هذه الثلاثة يغيّر المخطط أو نموذج الأحداث — الترقية طبقة إضافية لا إعادة تصميم.

---

## 12. إعادة بناء الإسقاطات عند اكتشاف خطأ

### 12.1 متى نحتاجها؟

1. خطأ في منطق المُسقِط (`reducer`) أدّى إلى أرصدة خاطئة.
2. تغيير شكل إسقاط (إضافة `householdExpenseMinor` بعد تسجيل 2000 حدث).
3. انحراف كشفته التسوية (§3.4).
4. إضافة إسقاط جديد كلياً (تقرير سنوي، تحليل جديد).

**هذه القدرة هي المكسب الأكبر لهذا المنظور:** في تصميم بمستندات قابلة للتعديل، خطأ منطقي استمر شهرين **غير قابل للإصلاح** — لا توجد بيانات تكفي لاستنتاج الحالة الصحيحة. هنا السجل كامل والإسقاط مشتق ⇒ كل خطأ في الإسقاط قابل للإصلاح بإعادة التشغيل.

### 12.2 الإجراء على Spark (محدد وواقعي)

```ts
export interface RebuildPlan {
  projections: Array<'accounts' | 'monthlySummaries' | 'budgets' |
                     'obligations' | 'debts' | 'goals' | 'liabilities'>;
  fromScratch: true;
  pageSize: 500;
}
export function rebuildProjections(uid: string, plan: RebuildPlan):
  Promise<ReconciliationReport>;
```

```
المرحلة 0  اكتب projections/checkpoint.rebuildStatus = 'running'
           ⇒ الواجهة تدخل وضع «قراءة فقط» وتمنع تسجيل أحداث جديدة
           ⇒ قواعد الأمان تفرضه: allow create on financialEvents
              if get(projections/checkpoint).data.rebuildStatus != 'running'

المرحلة 1  اقرأ كل eventReversals (مجموعة صغيرة) → Set<originalEventId>

المرحلة 2  استعلم financialEvents مرتَّبة بـ (recordedAt ASC, __name__ ASC)
           بصفحات 500، وطبّق reduceAll() في ذاكرة العميل:
             state = reducers.reduce(state, event)  لكل حدث غير معكوس
           (الأحداث المعكوسة تُطبَّق هي وحدث عكسها معاً — المحصلة صفر —
            ولا تُحذف، فيبقى عدد الأحداث والبصمة صحيحين)

المرحلة 3  أعِد حساب الحقول الدالّة في الوقت: obligation.status, debt.status,
           goal.progressBps, liabilities.*Overdue/*DueNext7d

المرحلة 4  اكتب النتيجة بدفعات writeBatch ≤ 450 عملية
           (ترتيب مقصود: الكيانات أولاً، ثم projections/liabilities،
            ثم projections/checkpoint أخيراً مع projectionVersion += 1
            و rebuildStatus = 'idle')

المرحلة 5  شغّل runReconciliation() وتحقق من تطابق البصمة
           اكتب auditLogs { action: 'rebuild', before, after }
```

### 12.3 المشكلة الحقيقية: الذرّية (ولا أخفيها)

إذا احتاجت المرحلة 4 أكثر من دفعة واحدة (أكثر من 450 مستند إسقاط)، **فالإعادة ليست ذرّية**: انقطاع الاتصال في منتصفها يترك إسقاطات مختلطة بين النسختين.

**المعالجات المعتمدة:**
1. **`rebuildStatus = 'running'`** يُقرأ في القواعد ويُقرأ في الواجهة ⇒ لا أحداث جديدة أثناء الإعادة، ورسالة عربية صريحة «جارٍ إعادة حساب الأرصدة — لا يمكن تسجيل عمليات الآن».
2. **استئناف لا استعادة:** `checkpoint.rebuildStatus='failed'` مع `rebuildCursor` ⇒ المحاولة التالية تكمل من نفس الموضع بنفس الترتيب الحتمي (نفس مفتاح الترتيب، نفس `pageSize`) فتُنتج نفس النتيجة. العملية **قابلة للتكرار بأمان (idempotent)** لأنها كتابة قيم مطلقة محسوبة لا زيادات.
3. **عدد مستندات الإسقاط صغير بطبيعته** في تطبيق شخصي: ≈ 8 حسابات + 24 ملخصاً شهرياً + 24 ميزانية + 60 التزاماً + 80 ديناً + 10 أهداف + 2 إسقاط مركّب ≈ **210 مستنداً** ⇒ **دفعة واحدة تكفي** ⇒ **ذرّية فعلياً في الحالة الواقعية**. العدد يتجاوز 450 فقط بعد ~15 سنة استخدام أو مع مئات الالتزامات.

### 12.4 الترتيب وإعادة التشغيل

**هل الإعادة حساسة للترتيب؟** تحليل صريح:

| الإسقاط | حساس للترتيب؟ | السبب |
|---|---|---|
| `accounts.balanceMinor` | **لا** | مجموع جبري — الجمع تبادلي |
| `monthlySummaries.*` | **لا** | مجاميع تجميعية |
| `obligations.paidMinor` | **لا** | مجموع |
| `obligation.status` | **لا** | دالة في (`paid` النهائي، `dueDate`، `now`) لا في المسار |
| حاجز الرصيد السالب | **غير معنيّ** | حاجز **زمن‑كتابة** لا إسقاط. الإعادة لا تفحصه ولا تفشل بسببه |
| رصيد جارٍ على كل حركة | **نعم** — ولذلك **لا نخزّنه** (§3.3) |

**النتيجة المعمارية المقصودة:** باستثناء ما استبعدناه عن قصد، **جميع الإسقاطات تجميعية وبالتالي إعادة البناء مستقلة عن الترتيب**. هذا يعني أن `recordedAt` غير دقيق المزامنة بين الأجهزة **لا يُفسد** الإعادة؛ الترتيب مطلوب فقط لعرض السجل الزمني للمستخدم وللاستئناف الحتمي.

**حالة حدّية حقيقية:** حدث بتاريخ ماضٍ (`occurredAt` في سبتمبر، `recordedAt` في أكتوبر) يُطبَّق على `monthlySummaries/2026-09` لأن `periodKey` يُحتسب من `occurredAt`. هذا يغيّر تقرير شهر مُقفل. **القرار:** يُسمح به مع تحذير عربي صريح «هذه العملية ستؤثر على تقرير شهر 9 المُقفل»، ويُسجَّل في `auditLogs`. **لا نمنعه** لأن إدخال فاتورة متأخرة حالة مشروعة متكررة.

---

## 13. النقد الصريح لهذا المنظور (لا أبيعه، أقيّمه)

### 13.1 أربع نقاط ضعف حقيقية

**(1) تضخيم الكتابة: 5 كتابات لكل مصروف.**
المنظور البسيط (مستند حركة قابل للتعديل + حساب الأرصدة بـ `sum()` عند القراءة) يكتب **1** مستند لكل مصروف. نحن نكتب **5**. الفارق 5× في الكتابات، و~3× في زمن الـ commit الملحوظ للمستخدم (transaction بـ 5 كتابات على شبكة ليبية بطيئة = 400–900 مللي ثانية مقابل ~200 لكتابة واحدة). للمستخدم الواحد التكلفة المالية صفر (قسم 9.4)، لكن **زمن الاستجابة ليس صفراً**، والمعالجة (تحديث متفائل في الواجهة ثم تأكيد) تخالف حرفياً §22 «لا تُعتبر العملية محفوظة إلا بعد تأكيد نجاح الكتابة». القرار المتَّبع: نُظهر حالة «جارٍ الحفظ» حقيقية ولا ندّعي النجاح مبكراً، ونقبل 400–900 مللي ثانية كتكلفة معلنة.

**(2) `projections/checkpoint` نقطة تنازع واحدة.**
كل حدث يكتب هذا المستند. حد Firestore الناعم **كتابة واحدة في الثانية المستدامة لكل مستند**. لمستخدم واحد لا مشكلة (~7 كتابات/يوم). لكن: (أ) استيراد 2000 حدث تاريخياً سيصطدم بالحد ⇒ **الاستيراد يتجاوز `checkpoint` ويُحدّثه مرة واحدة في النهاية**؛ (ب) عند التوسّع لمستخدمين متعددين، `checkpoint` لكل مستخدم فلا يتفاقم. **لكن** لو أردنا يوماً إسقاطاً عالمياً مشتركاً، سيحتاج عدّادات مُشرَّحة (sharded counters) بتكلفة تعقيد حقيقية. البديل المطروح والمرفوض: إلغاء `checkpoint` بالكلية وحساب البصمة بـ `getAggregateFromServer` عند الحاجة — يوفّر كتابة لكل حدث مقابل فقدان الكشف الفوري للانحراف. **قرار مراجَع:** إن قاس القياس أن الكتابة الخامسة تضر زمن الاستجابة، يُحذف `checkpoint` من مسار الكتابة الساخن ويُحسب بالتجميع عند الطلب.

**(3) القيد المحاسبي المزدوج أثقل مما يحتاجه تطبيق شخصي.**
`legs[]` بـ `side` و`nature` ترفع عتبة فهم الكود، وتجعل كل نوع حدث جديد قراراً محاسبياً. تصميم أبسط — `{ amountMinor, accountId, categoryId, type: 'in'|'out' }` — يغطي 80٪ من الحالات بـ20٪ من التعقيد. **ما نشتريه بالثقل:** (أ) القاعدة 11 في §19 (منع تضخّم التقارير) تصبح خاصية نوع لا قاعدة توثيقية؛ (ب) القاعدة 3 مبرهَنة لا مختبَرة؛ (ج) `Σdebit=Σcredit` يكشف فئة كاملة من الأخطاء البرمجية قبل وصولها للبيانات؛ (د) إضافة الديون والالتزامات والأهداف لا تحتاج أنواع حركات جديدة. **تقييمي:** الثقل مبرَّر **فقط** لأن المتطلبات تضم 6 كيانات مالية متشابكة (حسابات، التزامات، ديون عليّ، ديون لي، ميزانيات، أهداف). لو كان النظام مصروفات فقط، لكان هذا المنظور هندسة مفرطة واضحة.

**(4) `registerEffects` خارج الميزان — تنازل معماري صريح.**
الالتزامات والأهداف لها `legs = []` وأثرها في `registerEffects` فقط، فلا تحميها خاصية `Σdebit=Σcredit`. السبب: المحاسبة المستحقة (accrual) تعترف بمصروف الإيجار عند **إنشاء** الالتزام، ونحن نعترف به عند **الدفع** (أساس نقدي) لأن §12 يطلب «فصل الفعلي عن المتوقع» وبطاقات §4 تعرض «الالتزامات القادمة» منفصلة عن «مصروفات الشهر». **الثمن:** `obligations.paidMinor` و`goals.allocatedMinor` محميان بالحواجز والتسوية فقط، لا بشرط بنيوي. **هذا تنازل حقيقي**، والبديل الكامل (مزدوج مستحق) كان سيُظهر إيجاراً غير مدفوع داخل «مصروفات الشهر» ويخالف نموذج المستخدم الذهني ومتطلباته المعلنة.

### 13.2 نقطتا ضعف أصغر لكن مزعجتان

**(5) `runTransaction` لا يعمل بلا اتصال** ⇒ طابور `pendingCommands` كله تعقيد إضافي (مجموعة، آلة حالة، شاشة «عمليات معلّقة»، حالة `rejected`) لم يكن سيوجد لو كانت الكتابة مستنداً واحداً بـ `setDoc` (الذي يُطابَر محلياً). **هذه تكلفة مباشرة لاختيار الذرّية.**

**(6) لا رصيد جارٍ مخزَّن** ⇒ كشف الحركة لا يعرض رصيداً جارياً دقيقاً إلا في الصفحة الأولى (§3.3). مستخدم معتاد على كشف حساب مصرفي سيلاحظ الغياب. التنازل مقصود لأن تخزينه يُلغي إمكانية إدخال حدث بتاريخ ماضٍ وإعادة البناء.

### 13.3 متى يكون منظور آخر أفضل؟ (بصراحة)

| الشرط | المنظور الأفضل |
|---|---|
| مصروفات وحسابات فقط، بلا التزامات ولا ديون | مستند حركة قابل للتعديل + `sum()` aggregation عند القراءة. أبسط بكثير، صحيح بما يكفي |
| الترقية إلى Blaze محسومة من البداية | نفس نموذج الأحداث لكن Cloud Function كاتباً وحيداً ⇒ فرض خادمي كامل، وتختفي عيوب (5) و(1) جزئياً |
| تطبيق متعدد المستخدمين بحسابات مشتركة | سجل أحداث **مع** CQRS كامل وإسقاطات خادمية؛ الإسقاط من العميل لا يصلح مع كُتّاب متزامنين كثر |
| أولوية مطلقة للعمل بلا اتصال | مستند واحد لكل حركة بـ `setDoc` + إسقاطات محلية (IndexedDB) ومزامنة لاحقة. الذرّية تُستبدل بتسوية لاحقة |

### 13.4 ما يجعل هذا المنظور **الاختيار الصحيح** لمشروع رصيد تحديداً

1. **§18 «أهم شرط»** — أثر صحيح على الحسابات والتقارير والالتزامات والأهداف **دون ازدواج أو فقدان**. الذرّية في `runTransaction` تحقق «دون فقدان» بنيوياً، ومعرّف المستند = `opId` يحقق «دون ازدواج» بنيوياً. أي منظور آخر يحقق الشرطين بالانضباط لا بالبنية.
2. **§19 القاعدة 10** — تعديل/إلغاء يحفظ الأثر التاريخي. سجل الأحداث هو التحقيق الطبيعي لهذه القاعدة، لا إضافة عليها.
3. **§19 القاعدة 11** — منع تضخّم التقارير يصبح خاصية نوع لا قاعدة تُنسى عند إضافة ميزة.
4. **§23.12** — «مطابقة نتائج التقارير للعمليات الأصلية» قابلة للإثبات آلياً بالتسوية، لا بالفحص اليدوي.
5. **§20** — «الهيكل يسمح بإضافة مستخدمين دون إعادة تصميم» — كل شيء تحت `users/{uid}` والسجل مستقل لكل مستخدم.
6. **§12 و§16** — إسقاطات جديدة (سيناريوهات، توقعات، تقارير سنوية) تُبنى من السجل القائم دون أي ترحيل بيانات.

---

## 14. ملخص التواقيع الأساسية لطبقة الـ domain

> طبقة واحدة مشتركة (§25.7) — الواجهات **لا تحسب** شيئاً، تستدعي فقط.

```ts
// domain/commands.ts — البوابة الوحيدة للكتابة المالية
export type CommandIntent =
  | { type: 'recordExpense';  opId: string; accountId: string; categoryId: string;
      subCategoryId?: string; amountMinor: Minor; occurredAt: Date;
      scope: 'personal' | 'household'; description: string;
      paymentMethod?: PaymentMethod; payeeContactId?: string; notes?: string }
  | { type: 'recordIncome';   opId: string; accountId: string;
      incomeSourceId: string; amountMinor: Minor; occurredAt: Date;
      description: string }
  | { type: 'transfer';       opId: string; fromAccountId: string;
      toAccountId: string; amountMinor: Minor; occurredAt: Date;
      description: string }
  | { type: 'openObligation'; opId: string; obligation: NewObligationInput }
  | { type: 'payObligation';  opId: string; obligationId: string;
      accountId: string; amountMinor: Minor; occurredAt: Date;
      categoryId?: string }
  | { type: 'openDebt';       opId: string; debt: NewDebtInput;
      cashAccountId: string | null; expenseCategoryId: string | null }
  | { type: 'payDebt';        opId: string; debtId: string; accountId: string;
      amountMinor: Minor; occurredAt: Date }
  | { type: 'collectReceivable'; opId: string; debtId: string; accountId: string;
      amountMinor: Minor; occurredAt: Date }
  | { type: 'writeOffReceivable'; opId: string; debtId: string;
      amountMinor: Minor; categoryId: string; reason: string }
  | { type: 'allocateToGoal'; opId: string; goalId: string;
      amountMinor: Minor; accountId: string | null }
  | { type: 'adjustAccount';  opId: string; accountId: string;
      targetBalanceMinor: Minor; reason: string }
  | { type: 'reverseEvent';   opId: string; originalEventId: string;
      reason: string }
  | { type: 'amendEvent';     opId: string; originalEventId: string;
      replacement: CommandIntent; reason: string };

/** نقطة الدخول الوحيدة. لا كتابة مالية خارجها. */
export function executeCommand(
  uid: string, intent: CommandIntent
): Promise<Result<CommandOutcome, DomainError>>;

export interface CommandOutcome {
  eventId: string;
  wasDuplicate: boolean;                 // true ⇒ 0 كتابة، النتيجة موجودة سابقاً
  affected: { accountIds: string[]; obligationIds: string[];
              debtIds: string[]; goalIds: string[]; periodKeys: string[] };
  warnings: DomainWarning[];             // تجاوز حجز هدف، اقتراب سقف ميزانية،
                                         // تأثير على فترة مُقفلة، شبيه مكرر
}

// domain/reducers.ts — مُسقِط واحد لكل إسقاط، دوال نقية قابلة للاختبار والإعادة
export function applyToAccount(e: FinancialEvent, accountId: string,
                               s: Account): Account;
export function applyToMonthly(e: FinancialEvent, s: MonthlySummary): MonthlySummary;
export function applyToBudget(e: FinancialEvent, s: Budget): Budget;
export function applyToObligation(e: FinancialEvent, s: Obligation): Obligation;
export function applyToDebt(e: FinancialEvent, s: Debt): Debt;
export function applyToGoal(e: FinancialEvent, s: Goal): Goal;
export function applyToLiabilities(e: FinancialEvent, s: LiabilityRollup,
                                   ctx: RollupContext): LiabilityRollup;

// domain/errors.ts
export type DomainErrorCode =
  | 'LEDGER_UNBALANCED' | 'TOTALS_MISMATCH' | 'INVALID_AMOUNT' | 'TOO_MANY_LEGS'
  | 'DENORM_MISMATCH' | 'KIND_LEGS_MISMATCH' | 'PERIOD_MISMATCH'
  | 'INSUFFICIENT_FUNDS' | 'OVERDRAFT_EXCEEDED' | 'OVERPAYMENT'
  | 'REFERENCED_DOC_MISSING' | 'ALREADY_REVERSED' | 'CANNOT_REVERSE_REVERSAL'
  | 'ACCOUNT_ARCHIVED' | 'OBLIGATION_CANCELLED' | 'REBUILD_IN_PROGRESS'
  | 'PRECISION_EXCEEDED' | 'OFFLINE_QUEUED' | 'TRANSACTION_RETRY_EXHAUSTED';

/** كل رمز له رسالة عربية واحدة في domain/messages.ar.ts — لا نصوص في الواجهات */
export function messageFor(e: DomainError): string;
```

---

## 15. اختبارات القبول للنواة (§23)

| # | الاختبار | المعيار |
|---|---|---|
| 1 | `parseMinor` / `formatMinor` ذهاباً وإياباً | 10⁴ حالة عشوائية: `parse(format(v)) === v` |
| 2 | `splitEven` و`allocate` | `Σ result === total` في 10⁴ حالة، وفرق العناصر ≤ 1 درهم |
| 3 | `mulRate` بمبالغ قريبة من `MAX_MINOR` | مطابقة حساب `BigInt` مرجعي |
| 4 | منع الازدواج — نفس `opId` ×2 | حدث واحد، `wasDuplicate=true`، رصيد يتغير مرة واحدة |
| 5 | منع الازدواج — متكرر من جهازين متزامنين (Emulator) | حدث واحد، لا فقدان، لا ازدواج |
| 6 | توازن الميزان لكل أنواع الأحداث | `Σdebit === Σcredit` في 100٪ الحالات |
| 7 | التحويل لا يغيّر الإجمالي | `Σ balance` قبل = بعد |
| 8 | التحويل لا يظهر في الدخل أو المصروف | `expenseMinor` و`incomeMinor` ثابتان |
| 9 | تحصيل دين لا يزيد `incomeMinor` | ثابت |
| 10 | سداد دين عليّ لا يزيد `expenseMinor` | ثابت |
| 11 | سداد زائد مرفوض | `OVERPAYMENT`، 0 كتابة |
| 12 | رصيد سالب مرفوض | `INSUFFICIENT_FUNDS`، 0 كتابة |
| 13 | عكس مزدوج مرفوض | `ALREADY_REVERSED` بفضل قفل `eventReversals` |
| 14 | تعديل مبلغ لرقم أكبر من الرصيد | مرفوض بحساب الأثر **الصافي** |
| 15 | إعادة البناء تساوي الحالة الحالية | 500 حدث عشوائي ⇒ انحراف صفر في كل الحقول |
| 16 | إعادة البناء مستقلة عن الترتيب | خلط ترتيب الأحداث ⇒ نفس النتيجة في كل الحقول التجميعية |
| 17 | قواعد الأمان (Emulator) | مستخدم آخر لا يقرأ ولا يكتب؛ `update`/`delete` على حدث مرفوضان؛ `balanceMinor<0` مرفوض |
| 18 | التقرير الشهري = مجموع أحداثه | `monthlySummaries.expenseMinor === Σ` أرجل المصروف لأحداث الفترة |
| 19 | عدم الاتصال | الأمر يُطابَر، الواجهة لا تدّعي الحفظ، وعند العودة يُنفَّذ مرة واحدة |
| 20 | عدّ الكتابات الفعلي لمصروف | ≤ 5 كتابات، ≤ 3 قراءات (مقاس من Emulator) |

---

## 16. القرارات المعمارية التي تحتاج موافقة المالك (§25.14)

| # | القرار | الأثر إن رُفض |
|---|---|---|
| 1 | **3 خانات عشرية** (درهم) لا خانتين | خانتان تمنعان تمثيل `0.250` وتخالفان مثال المتطلبات `25.500` |
| 2 | تسمية `financialEvents` بدل `transactions` | الاسم قابل للتغيير بلا أثر على التصميم |
| 3 | **أساس نقدي** لاعتراف المصروف (الالتزام غير المدفوع ليس مصروفاً) | الأساس المستحق يُظهر إيجاراً غير مدفوع في «مصروفات الشهر» |
| 4 | عكس حدث من شهر ماضٍ يُسجَّل في **شهر العكس** مع فصله في `priorPeriodCorrectionMinor` | البديل يغيّر تقريراً صُدِّر سابقاً |
| 5 | **منع** الرصيد السالب افتراضياً، و**تحذير** عند تجاوز حجز الأهداف | — |
| 6 | **لا حذف نهائي** لأي حدث مالي، بأي حال | يخالف §19 القاعدة 10 |
| 7 | مجموعة `debts` واحدة بحقل `direction` لا مجموعتان | التكرار يضاعف منطق منع السداد الزائد |
| 8 | المرفقات `base64` في مستند منفصل على Spark، مع هجرة إلى Storage على Blaze | لا مرفقات على Spark |
| 9 | المصروف المتكرر يُنفَّذ بـ **لحاق عند فتح التطبيق** على Spark | لا تنفيذ تلقائي دون Blaze |
| 10 | قبول 400–900 مللي ثانية لزمن حفظ العملية مقابل الذرّية الكاملة | — |

---

*تمّ — `docs/design/core-C.md`. لا كود تطبيقي، لا مشروع npm، لا لمس لـ Firebase.*
