# النواة المحاسبية لمشروع رصيد | RASEED — منظور (ب)
## دفتر حركات أحادي مبسّط + أرصدة مجمّعة
### Single-Sided Transaction Log + Stored Derived Balances

> **الحالة:** مسوّدة تصميم (Design Only). لا يوجد كود تطبيقي بعد.
> **المرجع الإلزامي:** `docs/00-REQUIREMENTS.md` — خصوصاً الأقسام 5, 6, 7, 8, 9, 10, 11, 12, 16, 18, 19, 22, 23.
> **مالك المشروع:** محمد إبراهيم البرشي — **المشروع:** `raseed-2fac1` — **الخطة:** Spark (مجانية).
> **صاحب المنظور:** هذا المستند يدافع عن منظور واحد ثم ينقده بصراحة في القسم 12.

---

## 0. الفكرة في عشرة أسطر

1. مجموعة واحدة `transactions` هي **المصدر الوحيد للحقيقة المالية** (source of truth).
2. كل مستند فيها = **حدث مالي واحد كما يراه المستخدم** (مصروف، دخل، تحويل، دفعة…)، لا قيود مدين/دائن.
3. المبالغ أعداد صحيحة بالدرهم الليبي (1 د.ل = 1000 درهم). لا كسور عائمة أبداً.
4. **رصيد الحساب حقل مجمّع مخزّن** (`accounts/{id}.balanceMinor`) يُحدَّث داخل `runTransaction` مع الحركة نفسها.
5. **معرّف المستند = معرّف العملية** (`operationId`). وجود المستند هو بذاته سجل منع الازدواج.
6. الكيانات المرتبطة (`obligations`, `debts`, `goals`, `budgets`) **حالات مستقلة** تحمل مجمّعات خاصة
   (`paidMinor`, `collectedMinor`…) تُحدَّث في **نفس** الـ transaction التي تُنشئ الحركة.
7. لا تعديل في مكانه للحقول المالية: التصحيح = **حركة عكسية + حركة جديدة** مع سلسلة إحالة.
8. `reportClass` (وليس `type`) هو ما يحدد ظهور الحركة في تقارير الدخل/المصروف — لمنع تضخّم التقارير.
9. طبقة `domain/` خالصة (pure TypeScript، بلا Firebase) تحتوي كل الحساب؛ الواجهة تستدعي ولا تحسب.
10. على Spark: لا Cloud Functions ⇒ **Security Rules هي خط الدفاع الوحيد**، وتُستخدم `getAfter()`
    لربط تغيّر الرصيد بوجود حركة في نفس الـ commit.

---

## 1. تمثيل المال

### 1.1 الوحدة وعدد الخانات — القرار

| البند | القرار | المبرر |
|---|---|---|
| العملة الأساسية | `LYD` | متطلب §21 و §25.19 |
| الوحدة الصغرى (minor unit) | **الدرهم الليبي** | 1 دينار = 1000 درهم (التقسيم الرسمي) |
| عدد الخانات العشرية (scale) | **3** (`MINOR_PER_UNIT = 1000`) | المثال في المهمة نفسه `25.500 د.ل` ثلاث خانات؛ الفواتير الليبية (كهرباء/ماء/اتصالات) تُصدر بثلاث خانات |
| نوع الحقل في Firestore | `number` (عدد صحيح) | انظر 1.2 |
| نوع البيانات في TypeScript | `Minor` = نوع موسوم (branded number) | انظر 1.3 |
| العرض الافتراضي | 3 خانات دائماً: `25.500 د.ل` | لا نخفي خانة قد تحمل قيمة؛ الإخفاء يولّد شكوى "المجموع لا يطابق" |
| العرض المختصر (اختياري) | إعداد `settings.display.minorDigits ∈ {2,3}` **للعرض فقط** | بعض المستخدمين يفضلون `25.50`؛ لا يؤثر على التخزين ولا الحساب |
| الإدخال | يقبل حتى 3 خانات؛ `25.5` ⇒ `25500`، `25.55` ⇒ `25550` | تطبيع صريح، لا اعتماد على `parseFloat` |

**قرار مرفوض صراحةً:** استخدام خانتين (قياساً على الدولار). لو خزّنا بخانتين لصار 0.250 د.ل
(ربع دينار، وهو قيمة متداولة فعلياً) غير قابل للتمثيل الدقيق، وكل فاتورة كهرباء ستتعرض لتقريب.

**قرار مرفوض صراحةً:** تخزين `Decimal` كنص (`string`) أو `{ units, nanos }`.
السبب: نخسر `orderBy` و `where` و `FieldValue.increment` و aggregation queries (`sum()`) في Firestore،
مقابل مكسب صفري عملياً (انظر 1.2).

### 1.2 لماذا `number` آمن هنا بالضبط

Firestore يخزّن الأعداد كـ **IEEE-754 double (64-bit)**. الأعداد الصحيحة دقيقة تماماً داخل
`±(2^53 − 1) = ±9,007,199,254,740,991`.

- أقصى مبلغ قابل للتمثيل بدقة: `9,007,199,254,740,991 درهم ≈ 9.007 × 10^12 د.ل` (تسعة تريليونات دينار).
- أكبر رقم واقعي في النظام (رصيد، إجمالي سنوي، هدف ادخار) لا يتجاوز `10^10` درهم (عشرة ملايين دينار).
- الهامش: **ثلاث مراتب عشرية على الأقل من الأمان**.

**الشرط الذي يجعل هذا صحيحاً:** أن تكون **كل** العمليات الحسابية على أعداد صحيحة.
`a + b`, `a - b`, `a * k` (k صحيح) على أعداد صحيحة ضمن المدى الآمن = **نتيجة صحيحة بالضبط**، بلا أي خطأ.
الخطر الوحيد هو القسمة والنِّسب — ويُعالج في 1.4.

**حارس إلزامي:** كل قيمة تدخل أو تخرج تمرّ عبر `assertMinor()`:

```ts
// domain/money/Minor.ts
declare const MINOR_BRAND: unique symbol;

/** مبلغ بالدرهم الليبي، عدد صحيح، قد يكون سالباً (دلتا) أو موجباً (مبلغ). */
export type Minor = number & { readonly [MINOR_BRAND]: 'LYD' };

export const MINOR_PER_UNIT = 1000 as const;
export const MINOR_DIGITS = 3 as const;
/** سقف تشغيلي متحفّظ: 10^12 درهم = مليار دينار. أي شيء فوقه = خطأ إدخال. */
export const MAX_ABS_MINOR = 1_000_000_000_000;

export function assertMinor(v: unknown, field: string): asserts v is Minor {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new DomainError('MONEY_NOT_INTEGER', `الحقل ${field} يجب أن يكون عدداً صحيحاً بالدرهم`);
  }
  if (Math.abs(v) > MAX_ABS_MINOR) {
    throw new DomainError('MONEY_OUT_OF_RANGE', `الحقل ${field} خارج المدى المسموح`);
  }
}

export function minor(v: number): Minor { assertMinor(v, 'amount'); return v as Minor; }
export const ZERO = 0 as Minor;
```

### 1.3 التحويل من/إلى النص (الإدخال والعرض)

```ts
// domain/money/parse.ts

/**
 * يحوّل نص المستخدم إلى درهم. يقبل: "25.5" "25,500" "٢٥٫٥" "25" ".5" "-3.250"
 * يرفض: أكثر من 3 خانات، أكثر من فاصلة عشرية، حروف.
 * لا يستخدم parseFloat إطلاقاً.
 */
export function parseMinorInput(raw: string): Result<Minor, MoneyParseError> {
  const normalized = raw
    .trim()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)) // أرقام عربية-هندية
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)) // أرقام فارسية
    .replace(/[٫٬,\s]/g, m => (m === '٫' ? '.' : '')) // فاصلة عشرية عربية / فواصل آلاف
    .replace(/[٫]/g, '.');

  const m = /^(-)?(\d*)(?:\.(\d{0,3}))?$/.exec(normalized);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    return err({ code: 'MONEY_INVALID_FORMAT', ar: 'صيغة المبلغ غير صحيحة' });
  }
  if (/\.\d{4,}/.test(normalized)) {
    return err({ code: 'MONEY_TOO_MANY_DECIMALS', ar: 'الحد الأقصى ثلاث خانات عشرية (درهم)' });
  }
  const sign = m[1] ? -1 : 1;
  const whole = m[2] === '' ? 0 : Number(m[2]);
  const frac = Number(((m[3] ?? '') + '000').slice(0, 3)); // "5" -> 500، "55" -> 550
  const value = sign * (whole * MINOR_PER_UNIT + frac);
  assertMinor(value, 'input');
  return ok(value as Minor);
}

/** 25500 -> "25.500 د.ل"  (RTL-safe: الرقم LTR داخل سياق RTL) */
export function formatMinor(v: Minor, o: FormatOpts = {}): string {
  const digits = o.digits ?? 3;
  const neg = v < 0;
  const abs = Math.abs(v);
  const whole = Math.trunc(abs / MINOR_PER_UNIT);
  const fracFull = String(abs % MINOR_PER_UNIT).padStart(3, '0');
  const frac = digits === 3 ? fracFull : fracFull.slice(0, digits); // قصّ للعرض فقط
  const grouped = whole.toLocaleString('ar-LY', { useGrouping: o.grouping ?? true });
  const body = digits > 0 ? `${grouped}٫${frac}` : grouped;
  return `${neg ? '−' : ''}⁦${body}⁩ ${o.symbol ?? 'د.ل'}`;
}
```

> ملاحظة RTL: نلفّ الرقم بـ `U+2066 … U+2069` (Isolate) حتى لا ينقلب ترتيب `25٫500` داخل جملة عربية.
> هذا شرط عملي لـ §3 «RTL حقيقي».

### 1.4 القسمة والتوزيع — بلا ضياع وحدات

القاعدة الحاكمة: **مجموع الأجزاء يساوي الكل بالضبط، دائماً.**
نستخدم **طريقة أكبر الباقي (Largest Remainder)** بشكل حتمي (deterministic) لا عشوائي.

```ts
// domain/money/split.ts

/** يقسّم مبلغاً على n أجزاء متساوية قدر الإمكان. ∑ result === total دائماً. */
export function splitEven(total: Minor, n: number, carry: 'front' | 'back' = 'front'): Minor[] {
  if (!Number.isInteger(n) || n <= 0) throw new DomainError('SPLIT_BAD_N', 'عدد الأجزاء غير صالح');
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.trunc(abs / n);
  const rem = abs - base * n;              // 0 <= rem < n
  const out = Array.from({ length: n }, () => base);
  for (let i = 0; i < rem; i++) {
    const idx = carry === 'front' ? i : n - 1 - i;
    out[idx] += 1;
  }
  return out.map(x => (x * sign) as Minor);
}

/** توزيع بأوزان صحيحة (مثلاً: توزيع فاتورة مشتركة، أو تخصيص دفعة على عدة التزامات). */
export function allocateByWeights(total: Minor, weights: number[]): Minor[] {
  const W = weights.reduce((a, b) => a + b, 0);
  if (W <= 0) throw new DomainError('ALLOC_BAD_WEIGHTS', 'الأوزان غير صالحة');
  const raw = weights.map(w => ({ floor: Math.trunc((total * w) / W), rem: (total * w) % W }));
  let assigned = raw.reduce((a, r) => a + r.floor, 0);
  const order = raw.map((r, i) => ({ i, rem: r.rem })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  const out = raw.map(r => r.floor);
  let k = 0;
  while (assigned < total) { out[order[k % order.length].i] += 1; assigned += 1; k += 1; }
  return out as Minor[];
}

/** نسبة مئوية — للعرض فقط، لا يُعاد تخزينها ولا يُبنى عليها مبلغ. */
export function ratioPercent(part: Minor, whole: Minor): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}
```

**مثال تحقق (سيصير اختبار وحدة في §23.1):**
`splitEven(1000, 3) = [334, 333, 333]` ومجموعها `1000` بالضبط — لا `333.333 × 3 = 999.999`.
`splitEven(100_000, 7) = [14286, 14286, 14286, 14286, 14286, 14285, 14285]` ومجموعها `100000`.

**قاعدة الأقساط (§8, §9):** عند إنشاء التزام/دين بأقساط، **تُولَّد الأقساط مرة واحدة وتُخزَّن
مبالغها الصحيحة** في `installments[]` (لا تُحسب عند كل عرض). القسط الأخير يحمل الباقي
(`carry: 'back'`) لأن العُرف المحلي أن «الكسر يُسوّى في الأخير». هذا قرار قابل للتغيير بإعداد واحد.

**ممنوع صراحةً:** أي استخدام لـ `Math.round(x * 0.15)` على مبالغ، أو `amount / 2` بدون تمرير عبر `splitEven`.
يُفرض بقاعدة ESLint مخصصة: `no-raw-money-arithmetic` تمنع `*` و `/` على متغيرات نوعها `Minor`
خارج ملفات `domain/money/`.

---

## 2. نموذج البيانات الدقيق للنواة

### 2.1 شجرة المجموعات (النواة فقط)

```
users/{uid}
├── accounts/{accountId}                 ← الأرصدة المجمّعة
├── transactions/{operationId}           ← دفتر الحركات (المصدر الوحيد للحقيقة)
├── categories/{categoryId}
├── obligations/{obligationId}           ← حالة مستقلة + مجمّعات
├── debts/{debtId}                       ← يشمل النوعين (عليّ / لي) بحقل direction
├── budgets/{periodKey}_{scopeKey}       ← معرّف حتمي
├── financialGoals/{goalId}
├── rollups/{periodKey}                  ← مجمّع شهري للوحة التحكم والتقارير السريعة
├── auditLogs/{operationId}              ← إنشاء فقط، لا تعديل ولا حذف
└── settings/app                         ← مستند واحد
```

**قرار:** لا مجموعة `debtPayments` منفصلة (خلافاً للاقتراح في §18).
الدفعات **هي** حركات في `transactions` بـ `link.kind = 'debt'`. المبرر: §18 «أهم شرط» يطلب عدم الازدواج،
ومجموعة دفعات منفصلة تعني مصدرين للحقيقة لنفس الحدث. سجل دفعات أي دين = استعلام مفهرس:
`where('link.kind','==','debt').where('link.id','==',debtId).orderBy('occurredAt','desc')`.
يُوثَّق هذا الانحراف في `docs/adr/ADR-00X-no-separate-debtPayments.md`.

### 2.2 `accounts/{accountId}`

```ts
// domain/types/Account.ts
export type AccountType = 'cash' | 'bank' | 'ewallet' | 'other';
export type AccountStatus = 'active' | 'archived';

export interface AccountDoc {
  id: string;
  ownerUid: string;
  name: string;                     // "النقد الشخصي"، "مصرف الجمهورية"
  type: AccountType;
  currency: 'LYD';

  /** الرصيد الافتتاحي — يُكتب مرة واحدة عند الإنشاء، immutable بعدها (تُفرض في Rules). */
  openingBalanceMinor: number;
  /** الرصيد الحالي المجمّع. = openingBalanceMinor + Σ deltas للحركات غير الملغاة. */
  balanceMinor: number;

  /** حارس الرصيد السالب (§19 "المبالغ السالبة غير المسموح بها"). */
  allowNegative: boolean;           // افتراضي false
  minBalanceMinor: number;          // افتراضي 0؛ لبطاقة ائتمان مثلاً: -500000

  /** مجمّعات مساعدة لكشف الانحراف بلا مسح كامل. */
  txCount: number;                  // عدد الحركات المؤثرة (يزيد/ينقص مع العكس)
  deltaSumMinor: number;            // Σ deltas فقط (بدون الافتتاحي) — تكرار متعمّد للتحقق
  lastTxOperationId: string | null;
  lastPostedAt: Timestamp | null;

  /** المطابقة الدورية (reconciliation). */
  lastVerifiedAt: Timestamp | null;
  lastVerifiedBalanceMinor: number | null;
  lastVerifiedThroughBookedAt: Timestamp | null;

  status: AccountStatus;
  sortOrder: number;
  icon: string | null;
  excludeFromNetWorth: boolean;     // لحساب وهمي/تجريبي

  schemaVersion: number;            // = 1
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**ثابت (invariant) يجب أن يصحّ دائماً:**
`balanceMinor === openingBalanceMinor + deltaSumMinor`
وكذلك `deltaSumMinor === Σ accountDeltas(tx)` على كل الحركات الفعّالة. الحقل `deltaSumMinor`
تكرار متعمّد لأنه يجعل كشف الانحراف **عملية محلية بمستند واحد** بدل مسح الدفتر.

### 2.3 `transactions/{operationId}` — قلب النظام

```ts
// domain/types/Transaction.ts

export type TxType =
  | 'expense'            // مصروف حقيقي
  | 'income'             // دخل مستلم فعلياً
  | 'transfer'           // تحويل داخلي بين حسابين
  | 'debtPayment'        // سداد دين عليّ (لدائن)
  | 'debtCollection'     // تحصيل دين لي (من مدين)
  | 'obligationPayment'  // دفع التزام (إيجار/كهرباء/قسط)
  | 'adjustment';        // تسوية/تصحيح/عكس

/** يفصل "الشكل" عن "المعنى" — ضروري لمنع تضخّم التقارير (§19 القاعدة 11). */
export type TxSubtype =
  | 'plain'
  | 'debtDrawdown'       // اقترضتُ مالاً ⇒ نقد يدخل، ليس دخلاً
  | 'receivableFunding'  // أقرضتُ مالاً ⇒ نقد يخرج، ليس مصروفاً
  | 'goalFunding'        // تحويل إلى حساب/مظروف ادخار
  | 'reversal'           // عكس حركة سابقة
  | 'reconciliation'     // تسوية فرق جرد نقدي
  | 'openingCorrection';

/** هذا — لا type — هو ما تقرأه التقارير. */
export type ReportClass =
  | 'expense'            // يدخل "إجمالي المصروفات" ويستهلك الميزانية
  | 'income'             // يدخل "إجمالي الدخل"
  | 'internal'           // تحويل: لا دخل ولا مصروف، يظهر في حركة الحساب فقط
  | 'financing'          // اقتراض/إقراض/سداد أصل الدين: تدفق نقدي بلا دخل/مصروف
  | 'adjustment';        // تسوية: خارج الدخل والمصروف، داخل الرصيد

export type TxLifecycle =
  | 'posted'             // فعّالة ومؤثرة على الأرصدة
  | 'reversed'           // عُكست بحركة عكسية (تبقى في السجل، أثرها صفر صافياً)
  | 'void';              // أُبطلت قبل أن تؤثر (حالة نادرة: فشل جزئي مُكتشف)

export type LinkKind = 'obligation' | 'debt' | 'goal' | 'budget' | 'none';

export interface TxLink {
  kind: LinkKind;
  id: string | null;
  /** رقم القسط/الدفعة داخل الكيان المرتبط — للعرض والتتبع. */
  installmentNo: number | null;
}

export interface TransactionDoc {
  /** = معرّف المستند = operationId. انظر §4. */
  id: string;
  ownerUid: string;
  schemaVersion: number;            // = 1

  // --- المعنى المالي ---
  type: TxType;
  subtype: TxSubtype;
  reportClass: ReportClass;         // مشتق عند الكتابة، مخزّن لتمكين الاستعلام
  lifecycle: TxLifecycle;

  /** دائماً موجب. الاتجاه يُستخرج من type/direction لا من إشارة المبلغ. */
  amountMinor: number;
  currency: 'LYD';
  /** اتجاه الأثر على accountId. 'internal' للتحويل (له حسابان). */
  direction: 'in' | 'out' | 'internal';

  // --- الحسابات المتأثرة ---
  /** الحساب الأساسي: مصدر الخروج، أو وجهة الدخول. مطلوب دائماً. */
  accountId: string;
  /** حساب الوجهة — فقط عند type==='transfer'، وإلا null. */
  counterAccountId: string | null;

  // --- التصنيف والتقارير ---
  categoryId: string | null;        // مطلوب لـ expense و obligationPayment ذي الطبيعة expense
  subcategoryId: string | null;
  scope: 'personal' | 'household';  // §11 — عرض متخصص، لا تكرار قيمة
  paymentMethod: 'cash' | 'card' | 'transfer' | 'cheque' | 'ewallet' | 'other';
  payee: string | null;
  description: string;
  notes: string | null;
  tags: string[];
  attachmentIds: string[];          // مراجع إلى Storage (يتطلب Blaze — انظر §11)

  // --- الزمن ---
  /** التاريخ المحاسبي الذي يختاره المستخدم (قد يكون في الماضي). */
  occurredAt: Timestamp;
  /** لحظة الترحيل الفعلي — serverTimestamp. ترتيب الدفتر الحقيقي. */
  bookedAt: Timestamp;
  /** 'YYYY-MM' محسوب من occurredAt وفق settings.financialMonthStartDay. مخزّن. */
  periodKey: string;
  /** 'YYYY-MM-DD' بتوقيت Africa/Tripoli — لتقارير اليوم بلا حسابات منطقة زمنية في الاستعلام. */
  dayKey: string;

  // --- الربط بالكيانات ---
  link: TxLink;

  // --- سلسلة التصحيح (§6) ---
  reversesTxId: string | null;      // في حركة العكس: معرّف الأصل
  reversedByTxId: string | null;    // في الأصل: معرّف العكس
  supersedesTxId: string | null;    // في البديل بعد التعديل
  supersededByTxId: string | null;  // في الأصل بعد التعديل
  correctionReason: string | null;  // إلزامي عند العكس/التعديل (نص عربي من المستخدم)

  // --- منع الازدواج والتدقيق (§4) ---
  operationId: string;              // = id (تكرار متعمّد ليُقرأ داخل Rules بسهولة)
  clientRequestId: string;          // UUID يُولَّد عند فتح النموذج
  deviceId: string;                 // معرّف جهاز ثابت محلياً
  idempotencySource: 'user' | 'recurrence' | 'system';
  recurrenceId: string | null;
  occurrenceKey: string | null;     // 'rec_<id>#2026-10-01'

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**حقول مشتقة ومخزّنة عمداً** (`reportClass`, `periodKey`, `dayKey`, `direction`):
Firestore لا يملك computed columns ولا استعلاماً على دالة. تخزينها هو الفرق بين
«تقرير شهري = استعلام واحد مفهرس» و«تقرير شهري = تنزيل كل الحركات وتصفيتها في المتصفح».
الثمن: لو تغيّرت قاعدة الاشتقاق لزم **ترحيل** (§18.8) — يُوثَّق في `migrations/`.

### 2.4 `obligations/{obligationId}`

```ts
export type ObligationStatus =
  | 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';

/** يحسم: هل دفعُه مصروفٌ حقيقي أم تمويل؟ (إيجار = مصروف، قسط قرض = تمويل) */
export type ObligationNature = 'expense' | 'financing';

export interface ObligationDoc {
  id: string;
  ownerUid: string;
  schemaVersion: number;

  name: string;                     // "إيجار المنزل"
  beneficiary: string | null;
  nature: ObligationNature;         // افتراضي 'expense'
  categoryId: string | null;        // الفئة التي تُحمَّل بها الدفعات

  totalMinor: number;               // القيمة الإجمالية المستحقة
  paidMinor: number;                // مجمّع — يُحدَّث داخل نفس الـ transaction
  /** مشتق للعرض فقط، لكنه مخزّن لتمكين where('remainingMinor','>',0) */
  remainingMinor: number;           // = totalMinor + extraChargesMinor − paidMinor
  extraChargesMinor: number;        // غرامات/رسوم تأخير تُضاف بعد الإنشاء (بسجل منفصل)

  dueDate: Timestamp;
  recurrence: RecurrenceRule | null;
  priority: 1 | 2 | 3;
  status: ObligationStatus;

  paymentCount: number;             // عدد دفعات غير ملغاة
  lastPaymentAt: Timestamp | null;
  lastPaymentOperationId: string | null;

  allowOverpayment: boolean;        // افتراضي false (§19 "السداد الزائد")
  notes: string | null;
  attachmentIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2.5 `debts/{debtId}` — النوعان في مجموعة واحدة

```ts
/** 'payable' = دين عليّ (§9) | 'receivable' = دين لي (§10) */
export type DebtDirection = 'payable' | 'receivable';
export type DebtStatus =
  | 'open' | 'partiallySettled' | 'settled' | 'writtenOff' | 'cancelled';

export interface DebtDoc {
  id: string;
  ownerUid: string;
  schemaVersion: number;

  direction: DebtDirection;
  counterpartyName: string;         // اسم الدائن أو المدين
  counterpartyPhone: string | null;
  contactId: string | null;

  principalMinor: number;           // أصل الدين
  settledMinor: number;             // المسدَّد (payable) أو المحصَّل (receivable)
  remainingMinor: number;           // = principalMinor − settledMinor
  writtenOffMinor: number;          // §10 ديون ميؤوس منها

  /** هل صاحَب نشوءَ الدين حركةٌ نقدية؟ (§19 القاعدتان 6 و 9) */
  cashMovedOnCreation: boolean;
  originTxId: string | null;        // الحركة التي أنشأت التدفق النقدي، إن وُجدت

  incurredAt: Timestamp;
  dueDate: Timestamp | null;
  installments: InstallmentPlan | null;
  status: DebtStatus;

  settlementCount: number;
  lastSettlementAt: Timestamp | null;
  allowOverpayment: boolean;        // افتراضي false

  followUps: FollowUpNote[];        // §10 سجل المتابعات (مصفوفة مضمّنة، حدّها 50)
  notes: string | null;
  attachmentIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**لماذا مجموعة واحدة بحقل `direction` بدل مجموعتين؟**
لوحة التحكم (§4) تحتاج «إجمالي الديون عليّ» و«إجمالي المستحق لي» معاً؛ مجموعة واحدة تعني فهرساً
واحداً واستعلامين بسيطين، وقواعد أمان واحدة، ومنطق سداد/تحصيل مشتركاً في دالة واحدة
(`settleDebt(direction, …)`) بدل تكراره مرتين — وهذا شرط §25.7.

### 2.6 `budgets`, `financialGoals`, `rollups` (مختصرة — النواة فقط)

```ts
/** معرّف حتمي: `${periodKey}__${scopeKey}` حيث scopeKey = 'ALL' أو categoryId */
export interface BudgetDoc {
  id: string; ownerUid: string; schemaVersion: number;
  periodKey: string;                // '2026-10'
  scopeKey: string;                 // 'ALL' | categoryId
  scope: 'personal' | 'household' | 'all';
  limitMinor: number;
  /** مجمّع — يُحدَّث في نفس الـ transaction مع الحركة. */
  spentMinor: number;
  remainingMinor: number;           // = limitMinor − spentMinor (قد يكون سالباً = تجاوز)
  alertThresholdPercent: number;    // 80 افتراضياً (§12 تنبيه الاقتراب)
  alertedAt: Timestamp | null;      // لمنع تكرار التنبيه (§17)
  createdAt: Timestamp; updatedAt: Timestamp;
}

export interface FinancialGoalDoc {
  id: string; ownerUid: string; schemaVersion: number;
  name: string;                     // "صندوق الطوارئ"
  targetMinor: number;
  savedMinor: number;               // مجمّع
  /** 'account' = المال في حساب ادخار حقيقي | 'envelope' = تخصيص داخل حساب قائم */
  mode: 'account' | 'envelope';
  linkedAccountId: string | null;   // إلزامي عند mode==='account'
  targetDate: Timestamp | null;
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
  contributionCount: number;
  createdAt: Timestamp; updatedAt: Timestamp;
}

/** مجمّع شهري — يقلّل قراءات لوحة التحكم من ~المئات إلى 1. انظر §9. */
export interface RollupDoc {
  id: string;                       // = periodKey '2026-10'
  ownerUid: string; schemaVersion: number;
  periodKey: string;
  incomeMinor: number;              // Σ reportClass==='income'
  expenseMinor: number;             // Σ reportClass==='expense'
  financingInMinor: number;
  financingOutMinor: number;
  householdExpenseMinor: number;    // §11 — جزء من expenseMinor لا إضافة إليه
  byCategoryMinor: Record<string, number>;  // حدّ 60 مفتاحاً
  txCount: number;
  /** للتحقق من الانحراف: آخر حركة أثّرت على هذا المجمّع. */
  lastOperationId: string | null;
  recomputedAt: Timestamp | null;
  createdAt: Timestamp; updatedAt: Timestamp;
}
```

---

## 3. حساب الرصيد: متى، وأين، ولماذا مخزّن

### 3.1 القرار

| السؤال | القرار |
|---|---|
| مجمّع مخزّن أم محسوب عند القراءة؟ | **مجمّع مخزّن** في `accounts/{id}.balanceMinor` |
| متى يُحدَّث؟ | داخل **نفس** `runTransaction` التي تُنشئ/تعكس الحركة. لا مسار آخر |
| من أين تقرأه الواجهة؟ | من مستند الحساب مباشرة عبر `onSnapshot` — لا تجميع في الواجهة |
| هل يُحسب من الدفتر أحياناً؟ | نعم، في **المدقّق** (verifier) فقط: عند الطلب، وشهرياً، وبعد أي استيراد |

### 3.2 لماذا لا نحسبه من الدفتر عند كل قراءة

الحساب من الدفتر يعني: `openingBalanceMinor + Σ deltas` على كل حركات الحساب.
بعد سنتين من الاستخدام اليومي (≈ 8 حركات/يوم) = **~5800 حركة لكل حساب**.
فتح لوحة التحكم مع 5 حسابات = **~29,000 قراءة مستند**. تجاوز حصة Spark اليومية (50,000 قراءة)
في **أقل من جلستين**. هذا ليس تحسيناً مبكراً، بل شرط صلاحية على الخطة المجانية (§22).

البديل «aggregation query» (`sum()`) موجود في Firestore ويُحاسَب بـ قراءة واحدة لكل 1000 مستند
مُجمَّع — أي ~6 قراءات لكل حساب — لكنه **لا يعمل دون اتصال**، ولا يمكن استخدامه داخل
`runTransaction` كشرط حارس (لا يمكن قراءة مجموع ثم الكتابة عليه ذرّياً). فيبقى مفيداً
**للمدقّق فقط**، لا لمسار الكتابة.

### 3.3 دالة الاشتقاق — المصدر الوحيد لمعنى «الأثر»

هذه الدالة هي **الطبقة المشتركة** المطلوبة في §25.7. أي شاشة تحسب أثراً بنفسها = مخالفة.

```ts
// domain/ledger/effects.ts
export interface AccountDelta { readonly accountId: string; readonly deltaMinor: Minor; }

/**
 * الأثر على الأرصدة. هذه الدالة خالصة (pure) وقابلة لاختبار الوحدة بالكامل.
 * ملاحظة صريحة: 'transfer' هو الحالة الوحيدة التي تُرجع عنصرين — وهو بالضبط
 * المكان الذي يتسرّب منه "أحادي الجانب". انظر النقد في §12.
 */
export function accountDeltas(tx: TxCore): readonly AccountDelta[] {
  if (tx.lifecycle === 'void') return [];
  const a = tx.amountMinor as Minor;
  switch (tx.type) {
    case 'expense':
    case 'debtPayment':
    case 'obligationPayment':
      return [{ accountId: tx.accountId, deltaMinor: -a as Minor }];
    case 'income':
    case 'debtCollection':
      return [{ accountId: tx.accountId, deltaMinor: a }];
    case 'transfer':
      if (!tx.counterAccountId) throw new DomainError('TRANSFER_NO_COUNTER', 'التحويل بلا حساب وجهة');
      if (tx.counterAccountId === tx.accountId)
        throw new DomainError('TRANSFER_SAME_ACCOUNT', 'لا يمكن التحويل إلى نفس الحساب');
      return [
        { accountId: tx.accountId,        deltaMinor: -a as Minor },
        { accountId: tx.counterAccountId, deltaMinor:  a },
      ];
    case 'adjustment':
      return [{ accountId: tx.accountId, deltaMinor: (tx.direction === 'in' ? a : -a) as Minor }];
  }
}

/** تصنيف التقارير — مشتق عند الكتابة ومخزّن. (§19 القاعدة 11) */
export function deriveReportClass(
  tx: Pick<TxCore, 'type' | 'subtype'>,
  ctx: { obligationNature?: ObligationNature } = {},
): ReportClass {
  if (tx.subtype === 'reversal')       return 'adjustment'; // يحمل reportClass الأصل فعلياً — انظر ملاحظة أدناه
  if (tx.subtype === 'debtDrawdown')   return 'financing';
  if (tx.subtype === 'receivableFunding') return 'financing';
  if (tx.subtype === 'goalFunding')    return 'internal';
  switch (tx.type) {
    case 'expense':  return 'expense';
    case 'income':   return 'income';
    case 'transfer': return 'internal';
    case 'debtPayment':
    case 'debtCollection': return 'financing';   // سداد/تحصيل أصل الدين ليس مصروفاً ولا دخلاً
    case 'obligationPayment':
      return ctx.obligationNature === 'financing' ? 'financing' : 'expense';
    case 'adjustment': return 'adjustment';
  }
}
```

> **تصحيح مهم على `deriveReportClass`:** حركة العكس **ترث `reportClass` الأصل**، لا `'adjustment'`.
> وإلا لن يُطرح المصروف الملغى من إجمالي المصروفات. القاعدة النهائية:
> `reversal.reportClass = original.reportClass` و `reversal.amountMinor = original.amountMinor`
> مع `direction` معكوس، والتقارير تجمع بإشارة مستمدة من `direction`. هذا مكتوب في §6.3.

### 3.4 المدقّق (Balance Verifier) — كشف الانحراف

```ts
// domain/ledger/verify.ts
export interface BalanceAudit {
  accountId: string;
  storedBalanceMinor: Minor;
  computedBalanceMinor: Minor;
  driftMinor: Minor;                 // stored − computed. يجب أن يكون 0
  txCountStored: number;
  txCountComputed: number;
  verifiedThroughBookedAt: Timestamp;
}

export function auditAccount(
  account: AccountDoc, txs: readonly TxCore[],
): BalanceAudit;
```

**متى يُشغَّل:**
1. **عند الطلب** من شاشة «تفاصيل الحساب» بزر «تدقيق الرصيد».
2. **تلقائياً عند أول فتح للتطبيق في كل شهر** — يدقّق الشهر المنصرم فقط
   (`where('bookedAt','>=',monthStart)`) ويحدّث `lastVerifiedBalanceMinor` و `lastVerifiedThroughBookedAt`.
   بذلك لا يُعاد مسح التاريخ كله أبداً: نثق بنقطة التحقق الأخيرة ونجمع ما بعدها فقط.
3. بعد أي استيراد بيانات أو ترحيل مخطط.

عند `driftMinor !== 0`: **لا يُصحَّح الرصيد صامتاً**. تُنشأ تنبيهة حمراء + سجل في `auditLogs`،
ويُعرض على المستخدم خيار «تسجيل حركة تسوية» (`adjustment / reconciliation`) بقيمة الفرق
مع سبب إلزامي. هذا يحترم §5 «لا يُسمح بتعديل الرصيد الحالي يدوياً دون تسجيل عملية تسوية واضحة ومبررة».

### 3.5 أين يمكن أن تنحرف الأرصدة فعلاً — جرد صادق

| # | مصدر الانحراف | الاحتمال | الحاجز |
|---|---|---|---|
| 1 | كتابة حركة بدون تحديث الحساب (مسار كتابة ثانٍ) | **عالٍ** إن لم يُمنع | Rules: `getAfter()` تربط الحركة بالرصيد في نفس الـ commit (§8.4). وفي الكود: مستودع واحد `ledgerRepo` هو **المسار الوحيد** للكتابة |
| 2 | تحديث الرصيد بدون حركة (تعديل يدوي من Console أو من الواجهة) | **عالٍ** | Rules تمنع `update` على `balanceMinor` ما لم تُكتب حركة معه؛ وصول Console يبقى ثغرة بشرية تُوثَّق |
| 3 | `FieldValue.increment` خارج `runTransaction` فلا يمكن فحص السالب | متوسط | ممنوع بقاعدة مراجعة: `increment` على `balanceMinor` غير مسموح إطلاقاً؛ نستخدم read+set داخل transaction |
| 4 | عكس حركة مرتين (double reversal) | متوسط | `original.reversedByTxId !== null` ⇒ رفض؛ ويُفحص **داخل** الـ transaction |
| 5 | تعديل `amountMinor` في مكانه | متوسط | Rules: الحقول المالية immutable بعد الإنشاء |
| 6 | تغيير `openingBalanceMinor` بعد وجود حركات | منخفض | Rules: immutable؛ التصحيح عبر `adjustment/openingCorrection` |
| 7 | فشل جزئي: الحركة كُتبت والحساب لا | **منخفض جداً** | `runTransaction` ذرّية: إما الكل أو لا شيء. هذا هو المكسب الأساسي |
| 8 | تعارض كتابة من جهازين | منخفض | `runTransaction` تعيد المحاولة وتقرأ القيمة الحديثة؛ الخاسر يرى المستند موجوداً فيتوقف |
| 9 | ترحيل مخطط يغيّر `reportClass` دون إعادة حساب `rollups` | متوسط | كل ترحيل يستدعي إعادة بناء `rollups` إلزامياً؛ `rollups` قابلة للاشتقاق دائماً فإعادة بنائها رخيصة |
| 10 | أرشفة حساب فيه حركات | منخفض | الأرشفة لا تمسّ الرصيد ولا تحذف الحركات؛ `status='archived'` فقط |

**الخلاصة الصادقة:** المخاطر 1 و 2 و 3 كلها من نوع «مسار كتابة التفّ على القاعدة». هذا هو
الضعف البنيوي لمنظور المجمّع المخزّن: **لا شيء في بنية البيانات نفسها يمنعه** — فقط الانضباط
وقواعد الأمان. (قارن بالقيد المزدوج حيث يختلّ التوازن فوراً ويُكتشف آلياً.) انظر §12.

---

## 4. منع الازدواج (Idempotency)

### 4.1 المبدأ: معرّف المستند هو مفتاح منع الازدواج

لا مجموعة منفصلة لمفاتيح الـ idempotency. **`transactions/{operationId}`**.
Firestore يضمن أن `create` على معرّف موجود يفشل، وأن قراءة المستند داخل `runTransaction`
تعطي رؤية متسقة. وجود المستند = العملية نُفِّذت = لا تُنفَّذ ثانية.

الفائدة مقابل مجموعة `operations/` منفصلة: **قراءة أقل وكتابة أقل** (−1 قراءة و−1 كتابة لكل عملية)،
وصفر احتمال لتباعد المفتاح عن الحركة.

### 4.2 كيف يُولَّد `operationId`

```ts
// domain/idempotency/operationId.ts

/** (أ) عملية يبدأها المستخدم: يُولَّد مرة واحدة عند **فتح النموذج**، لا عند الضغط. */
export function newUserOperationId(): string {
  return `op_${crypto.randomUUID().replace(/-/g, '')}`;   // op_ + 32 hex
}

/** (ب) حركة مولَّدة من تكرار: حتمية بالكامل — نفس المدخلات ⇒ نفس المعرّف. */
export function recurrenceOperationId(recurrenceId: string, occurrenceKey: string): string {
  return `rec_${recurrenceId}_${occurrenceKey}`;          // rec_abc123_2026-10-01
}

/** (ج) حركة عكس: حتمية مشتقة من الأصل ⇒ لا يمكن عكس نفس الحركة مرتين بمعرّفين. */
export function reversalOperationId(originalTxId: string): string {
  return `rev_${originalTxId}`;
}

/** (د) حركة بديلة بعد تعديل: حتمية مشتقة من الأصل + رقم النسخة. */
export function amendmentOperationId(originalTxId: string, revision: number): string {
  return `amd_${originalTxId}_r${revision}`;
}
```

**أهم نقطة في البند كله:** في الحالة (أ) يُولَّد المعرّف **عند تركيب النموذج (`useState` initializer
أو `useRef` عند mount)** ويُعاد استخدامه في كل محاولة إرسال. لو وُلِّد عند الضغط لصارت الضغطة
الثانية عمليةً جديدةً مشروعةً تماماً — ولانهار كل البناء. هذه سطر واحد في الكود وهو نقطة الفشل الأخطر.

```tsx
// ui/forms/useOperationId.ts
export function useOperationId(): string {
  const ref = useRef<string>();
  if (!ref.current) ref.current = newUserOperationId();   // مرة واحدة لعمر النموذج
  return ref.current;
}
// يُعاد التوليد فقط عند "حفظ وإضافة أخرى" أو بعد نجاح مؤكَّد.
```

### 4.3 السيناريوهات الأربعة المطلوبة

#### (1) ضغط الزر مرتين

ثلاث طبقات متتالية، كل واحدة تكفي وحدها:

| الطبقة | الآلية | ما تمنعه |
|---|---|---|
| واجهة | `disabled` + حالة `submitting` + منع الإرسال خلال 400ms | 95% من الحالات |
| معرّف | نفس `operationId` من `useOperationId` | الضغطتان تحملان نفس المعرّف |
| خادم | `tx.get(txRef)` داخل `runTransaction`: إن وُجد ⇒ `return { status:'duplicate' }` بلا كتابة | الحالة الحقيقية |

النتيجة للمستخدم: رسالة نجاح واحدة، حركة واحدة. لا رسالة خطأ — الازدواج **ليس خطأً**، بل
نتيجة متوقعة تُعالَج بصمت وتُرجع نفس النتيجة الأصلية (semantics: at-most-once effect, idempotent result).

#### (2) إعادة المحاولة بعد فشل الشبكة

العميل لا يعرف إن كانت الكتابة وصلت أم لا. لذا:
- يُعاد الإرسال بنفس `operationId` (محفوظ في **outbox** محلي، انظر 4.4).
- إن كانت قد نجحت ⇒ `duplicate` ⇒ نعرض نجاحاً.
- إن لم تكن ⇒ تُنفَّذ الآن.
- إعادة المحاولة بتراجع أسّي: `1s, 2s, 4s, 8s, 16s` بحدّ 5 محاولات ثم «فشل — أعد المحاولة يدوياً».

#### (3) تنفيذ المصروف المتكرر (§6)

لا Cloud Scheduler على Spark. الحل: **التحقق اللاحق عند فتح التطبيق (catch-up on open)**.

```ts
// domain/recurrence/materialize.ts

/** يولّد مفاتيح التكرارات المستحقة بين آخر تنفيذ والآن — حتمية تماماً. */
export function dueOccurrences(
  rule: RecurrenceRule, lastMaterializedKey: string | null, now: Date, tz: 'Africa/Tripoli',
): readonly string[];   // ['2026-09-01','2026-10-01']
```

لكل مفتاح: `operationId = recurrenceOperationId(recurrenceId, occurrenceKey)`.
افتح التطبيق من الهاتف والحاسوب في نفس اللحظة، أو عشر مرات في اليوم ⇒ **نفس المعرّفات**
⇒ المحاولة الأولى تكتب والبقية تقرأ «موجود» وتتوقف. صفر ازدواج، بلا قفل ولا طابور ولا دالة سحابية.

ضوابط إضافية:
- حدّ أقصى 12 تكراراً تُولَّد في الجلسة الواحدة؛ ما زاد يُعرض للمستخدم كـ«تكرارات متأخرة» ليؤكدها.
- التكرارات التي تمسّ المال **لا تُنشأ تلقائياً دون إشعار**: تُنشأ بحالة `posted` لكن تُدرج في
  مركز التنبيهات (§17) «نُفِّذت 2 حركات متكررة». هذا أقل مفاجأة من الخصم الصامت.
- `recurrences/{id}.lastMaterializedKey` يُحدَّث في نفس الـ transaction ⇒ لا يُعاد المسح من البداية.

#### (4) فتح التطبيق من جهازين في نفس الوقت

| الحالة | السلوك |
|---|---|
| نفس العملية المنطقية بنفس `operationId` (تكرار، عكس، تعديل) | `runTransaction` تُسلسِل الوصول؛ الأول يكتب، الثاني يقرأ «موجود» ويتوقف. **صفر ازدواج** |
| حركتان مختلفتان على نفس الحساب في نفس اللحظة | كلاهما ينجح؛ الثانية تُعيد المحاولة تلقائياً وتقرأ الرصيد بعد الأولى. **الرصيد صحيح** |
| نفس المصروف يُدخله المستخدم يدوياً من الجهازين بمعرّفين مختلفين | **لا يمكن منعه تقنياً** — هما عمليتان مشروعتان شكلاً |

للحالة الثالثة: **كاشف التشابه** (near-duplicate detector) — ليس حاجزاً بل تنبيه:
```ts
export function findNearDuplicates(
  candidate: TxCore, recent: readonly TxCore[],
): readonly TxCore[];  // نفس accountId + نفس amountMinor + نفس dayKey + نفس categoryId
                       // + فارق bookedAt < 10 دقائق
```
يُعرض حوار: «يوجد مصروف مطابق سُجّل قبل 3 دقائق — هل هذا مصروف آخر؟ [نعم، سجّله] [إلغاء]».
صادق: هذا حلّ تجربة استخدام، لا ضمانة. الضمانة التقنية مستحيلة هنا.

### 4.4 الطابور المحلي (Outbox) — ولماذا هو ضروري

**حقيقة فنية حاسمة:** `runTransaction` في Firestore **تفشل دون اتصال** — لا تُطابر محلياً
(بخلاف `setDoc`/`writeBatch` اللذين يُطابران في ذاكرة الـ offline persistence).
ولأن كل عملياتنا المالية مشروطة بقراءة (فحص السالب، فحص السداد الزائد) فهي كلها `runTransaction`.

القرار: **العمليات المالية تتطلب اتصالاً**، وتُحفظ دون اتصال في طابور محلي بحالة صريحة.
هذا يحترم §22 «عدم اعتبار العملية محفوظة إلا بعد تأكيد نجاح الكتابة» حرفياً.

```ts
// data/outbox/types.ts  (IndexedDB عبر idb)
export interface OutboxEntry {
  operationId: string;              // المفتاح الأساسي
  kind: 'postTransaction' | 'reverseTransaction' | 'amendTransaction';
  payload: PostTxInput;
  status: 'queued' | 'inflight' | 'confirmed' | 'failed';
  attempts: number;
  lastError: { code: string; ar: string } | null;
  createdAt: number;
  confirmedAt: number | null;
}
```

الواجهة تعرض الحركة بشارة «بانتظار الإرسال» بلون محايد، **ولا تُحتسب في الرصيد المعروض**.
عند عودة الاتصال يُفرَّغ الطابور بالترتيب، بنفس المعرّفات، فلا ازدواج مهما تكرر التفريغ.

---

## 5. `runTransaction` مقابل `writeBatch`

### 5.1 القاعدة الفاصلة

> **إن كان القرار بالكتابة يعتمد على قيمة مقروءة ⇒ `runTransaction`. وإلا ⇒ `writeBatch`.**
> كل عملية تمسّ `balanceMinor` أو `paidMinor` أو `settledMinor` أو `spentMinor` تعتمد على قراءة.
> **إذن: كل العمليات المالية `runTransaction` بلا استثناء.**

### 5.2 جدول الاستخدام الدقيق

| العملية | الأداة | القراءات | الكتابات | السبب |
|---|---|---|---|---|
| تسجيل مصروف | `runTransaction` | tx, account, (budget), (rollup) | 4–5 | فحص السالب + فحص الازدواج |
| تسجيل دخل | `runTransaction` | tx, account, rollup | 4 | فحص الازدواج |
| تحويل بين حسابين | `runTransaction` | tx, acctFrom, acctTo | 4 | ذرّية الطرفين + فحص السالب |
| دفع التزام | `runTransaction` | tx, account, obligation, budget, rollup | 6 | فحص السداد الزائد |
| تحصيل دين | `runTransaction` | tx, account, debt, rollup | 5 | فحص التحصيل الزائد |
| عكس/تعديل حركة | `runTransaction` | original, account(s), linked, rollup | 5–7 | فحص «لم تُعكس من قبل» |
| إنشاء التزام/دين (بلا نقد) | `setDoc` عادي | — | 1 | لا أثر على رصيد |
| إنشاء 12 قسطاً مجدولاً | `writeBatch` | — | 12 | كتابات غير مشروطة |
| أرشفة 30 فئة | `writeBatch` | — | 30 | لا علاقة بالمال |
| كتابة 20 تنبيهاً | `writeBatch` | — | 20 | غير مالي |
| إعادة بناء `rollups` لسنة | `writeBatch` ×N | قراءة منفصلة أولاً | 12 | اشتقاق محض |
| تعديل وصف/ملاحظة/مرفق | `updateDoc` | — | 1 | حقول غير مالية (§6.2) |

### 5.3 حدود يجب احترامها حرفياً

| الحد | القيمة | أثره على التصميم |
|---|---|---|
| كتابات الـ transaction/batch | **500 مستند** | أعلى عدد كتابات في عملياتنا = 7. هامش ضخم. الخطر الوحيد: إعادة بناء `rollups` أو استيراد ⇒ تُقطَّع إلى دفعات 450 |
| **لا قراءة بعد كتابة** داخل transaction | قاعدة صارمة | بنية الكود: `// === مرحلة القراءة ===` ثم `// === مرحلة التحقق ===` ثم `// === مرحلة الكتابة ===`. يُفرض بمراجعة ومراجعة ESLint |
| إعادة محاولة الـ transaction | تلقائية، حتى 5 مرات افتراضياً | **دالة الـ callback يجب أن تكون خالصة**: لا `console.log` معتمد عليه، لا تعديل متغيرات خارجية، لا `Date.now()` يدخل البيانات، لا `crypto.randomUUID()` داخلها. كل ما يجب أن يكون ثابتاً يُحسب **قبل** الاستدعاء |
| `serverTimestamp()` داخل transaction | مسموح | يُقيَّم عند الـ commit النهائي، فلا يتأثر بإعادة المحاولة |
| حجم المستند | 1 MiB | `rollups.byCategoryMinor` محدود بـ 60 مفتاحاً؛ `debts.followUps` بـ 50 عنصراً — وإلا تُنقل لمجموعة فرعية |
| معدل الكتابة على مستند واحد | ~1/ثانية مستدام | `rollups/{periodKey}` هو المستند الأسخن. بمستخدم واحد لا مشكلة إطلاقاً. **لكنه يصير عنق زجاجة لو صار النظام متعدد المستخدمين داخل نطاق واحد** — بنيتنا `users/{uid}/rollups` تعزل هذا بالكامل (§20) |
| `runTransaction` دون اتصال | **تفشل** | سبب وجود الـ outbox (§4.4) |
| `get()` داخل Rules | محاسَب كقراءة | استخدام `getAfter()` له ثمن: +1 قراءة لكل كتابة رصيد. مقبول ومحسوب في §9 |

### 5.4 الهيكل الإلزامي لأي عملية مالية

```ts
// data/ledger/postTransaction.ts
export async function postTransaction(input: PostTxInput): Promise<PostTxResult> {
  // (0) خارج الـ transaction: كل ما هو غير حتمي يُثبَّت الآن
  const validated = validatePostInput(input);              // Zod + قواعد domain
  if (!validated.ok) return { status: 'invalid', errors: validated.errors };
  const opId = input.operationId;                           // ثابت، من النموذج
  const periodKey = toPeriodKey(input.occurredAt, settings.financialMonthStartDay);
  const dayKey = toDayKey(input.occurredAt, 'Africa/Tripoli');

  const db = getFirestore();
  const txRef      = doc(db, `users/${uid}/transactions/${opId}`);
  const acctRef    = doc(db, `users/${uid}/accounts/${input.accountId}`);
  const counterRef = input.counterAccountId
    ? doc(db, `users/${uid}/accounts/${input.counterAccountId}`) : null;
  const linkRef    = refForLink(db, uid, input.link);       // obligation | debt | goal | null
  const budgetRef  = refForBudget(db, uid, periodKey, input.categoryId, input.scope);
  const rollupRef  = doc(db, `users/${uid}/rollups/${periodKey}`);
  const auditRef   = doc(db, `users/${uid}/auditLogs/${opId}`);

  return runTransaction(db, async (t) => {
    // === (1) مرحلة القراءة — كل القراءات أولاً، بلا استثناء ===
    const [txSnap, acctSnap, counterSnap, linkSnap, budgetSnap, rollupSnap] = await Promise.all([
      t.get(txRef), t.get(acctRef),
      counterRef ? t.get(counterRef) : Promise.resolve(null),
      linkRef ? t.get(linkRef) : Promise.resolve(null),
      budgetRef ? t.get(budgetRef) : Promise.resolve(null),
      t.get(rollupRef),
    ]);

    // === (2) مرحلة التحقق — دوال domain خالصة، صفر وصول لشبكة ===
    if (txSnap.exists()) return { status: 'duplicate', operationId: opId } as const;   // ← منع الازدواج
    if (!acctSnap.exists()) throw new DomainError('ACCOUNT_NOT_FOUND', 'الحساب غير موجود');
    if (acctSnap.data().status !== 'active')
      throw new DomainError('ACCOUNT_ARCHIVED', 'لا يمكن التسجيل على حساب مؤرشف');
    if (linkRef && !linkSnap!.exists())
      throw new DomainError('ORPHAN_LINK', 'الكيان المرتبط غير موجود');                // ← منع اليتم

    const txDoc = buildTransactionDoc({ ...validated.value, opId, periodKey, dayKey,
      obligationNature: linkSnap?.data()?.nature });
    const deltas = accountDeltas(txDoc);
    const guard = checkGuards({ deltas, accounts: [acctSnap, counterSnap], link: linkSnap, txDoc });
    if (!guard.ok) throw new DomainError(guard.code, guard.ar);   // سالب / سداد زائد / حالة مغلقة

    // === (3) مرحلة الكتابة — ولا قراءة بعد هذا السطر ===
    t.set(txRef, { ...txDoc, bookedAt: serverTimestamp(), createdAt: serverTimestamp() });
    for (const d of deltas) {
      const snap = d.accountId === input.accountId ? acctSnap : counterSnap!;
      t.update(doc(db, `users/${uid}/accounts/${d.accountId}`), {
        balanceMinor:  snap.data().balanceMinor  + d.deltaMinor,
        deltaSumMinor: snap.data().deltaSumMinor + d.deltaMinor,
        txCount:       snap.data().txCount + 1,
        lastTxOperationId: opId,
        lastPostedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (linkRef) t.update(linkRef, linkedEntityPatch(linkSnap!, txDoc));   // §7
    if (budgetRef && txDoc.reportClass === 'expense')
      t.set(budgetRef, budgetPatch(budgetSnap, txDoc), { merge: true });
    t.set(rollupRef, rollupPatch(rollupSnap, txDoc), { merge: true });
    t.set(auditRef, buildAuditEntry(txDoc, 'post'));

    return { status: 'posted', operationId: opId, balanceAfter: /* … */ } as const;
  });
}
```

**ملاحظة على `Promise.all` داخل transaction:** مسموح ومستحسن — القراءات المتوازية تقلّل زمن
الذهاب والإياب. الممنوع هو قراءة **بعد** أول كتابة.

---

## 6. التعديل والإلغاء

### 6.1 المبدأ: الدفتر لا يُمحى

> **لا يُحذف مستند حركة أبداً. ولا يُعدَّل حقل مالي في مكانه أبداً.**

هذا يحقق §19 «تعديل/إلغاء عملية معتمدة يتم بطريقة تحفظ الأثر التاريخي وتمنع تضارب الأرصدة»
و §18.9 «سجلات تدقيق للتعديلات المالية الحساسة».

### 6.2 تصنيف الحقول — ما يُعدَّل في مكانه وما لا يُعدَّل

| الحقل | التعديل | السبب |
|---|---|---|
| `description`, `notes`, `payee`, `tags` | **في مكانه** + سجل تدقيق | لا أثر على أي مجمّع |
| `attachmentIds` | **في مكانه** | لا أثر محاسبي |
| `amountMinor` | **عكس + إعادة ترحيل** | يغيّر الرصيد والميزانية والمجمّعات |
| `accountId` / `counterAccountId` | **عكس + إعادة ترحيل** | ينقل الأثر بين حسابين |
| `occurredAt` (إن غيّر `periodKey`) | **عكس + إعادة ترحيل** | ينقل الحركة بين تقريرين شهريين |
| `occurredAt` (داخل نفس الشهر واليوم) | في مكانه + تحديث `dayKey` | أثر على تقرير يومي فقط؛ قرار مُيسِّر مُوثَّق |
| `categoryId` / `subcategoryId` | **عكس + إعادة ترحيل** | ينقل الاستهلاك بين ميزانيتين |
| `scope` (شخصي/منزلي) | **عكس + إعادة ترحيل** | يغيّر `householdExpenseMinor` |
| `type` / `subtype` / `link` | **عكس + إعادة ترحيل** | يغيّر المعنى المحاسبي كلياً |
| `lifecycle`, `reversedByTxId`, … | النظام فقط | لا تُعرض للتعديل |

### 6.3 الإلغاء (Reversal)

```ts
// domain/ledger/reverse.ts
export function buildReversal(original: TxCore, reason: string, at: Date): TxCore {
  return {
    ...original,
    id: reversalOperationId(original.id),      // rev_<originalId> — حتمي
    operationId: reversalOperationId(original.id),
    subtype: 'reversal',
    reportClass: original.reportClass,          // ← يرث، لا 'adjustment' (انظر §3.3)
    amountMinor: original.amountMinor,          // نفس المبلغ
    direction: flipDirection(original.direction),
    // التحويل: نبدّل الحسابين بدل قلب الاتجاه
    accountId:        original.type === 'transfer' ? original.counterAccountId! : original.accountId,
    counterAccountId: original.type === 'transfer' ? original.accountId : null,
    lifecycle: 'posted',
    reversesTxId: original.id,
    reversedByTxId: null,
    correctionReason: reason,                   // إلزامي، نص عربي
    occurredAt: original.occurredAt,            // ← التاريخ المحاسبي للأصل
    periodKey: original.periodKey,              // ← يُعكَس في فترة الأصل (انظر 6.5)
    bookedAt: at,                               // ← لكن تاريخ الترحيل هو الآن
    idempotencySource: 'system',
  };
}
```

تسلسل العملية في `runTransaction` واحدة:

1. اقرأ الأصل. إن `lifecycle !== 'posted'` ⇒ خطأ `ALREADY_REVERSED` «الحركة معكوسة أصلاً».
2. اقرأ `rev_<id>`. إن وُجد ⇒ `duplicate` (عكس مكرر، بلا أثر).
3. اقرأ الحساب/الحسابات + الكيان المرتبط + الميزانية + المجمّع.
4. تحقق من الحوارس على الأثر المعكوس (قد يجعل عكسُ **دخلٍ** الرصيدَ سالباً! انظر 8.1).
5. اكتب: حركة العكس، تحديث الرصيد/الأرصدة بالدلتا المعكوسة، `original.lifecycle='reversed'`
   و `original.reversedByTxId`, تراجع `paidMinor`/`settledMinor`/`spentMinor`, تراجع `rollup`, سجل تدقيق.

### 6.4 التعديل (Amendment) — عملية ذرّية واحدة

التعديل = **عكس + ترحيل بديل، في نفس الـ `runTransaction`**. ليس عمليتين متتاليتين.
لو كانتا عمليتين لظهر للمستخدم رصيد وسيط خاطئ لو فشلت الثانية.

```ts
export interface AmendResult {
  reversalId: string;      // rev_<original>
  replacementId: string;   // amd_<original>_r<n>
}
```

- `replacement.supersedesTxId = original.id` و `original.supersededByTxId = replacement.id`.
- `original.lifecycle = 'reversed'`.
- `revision` = `original.revisionCount + 1` ⇒ تعديل التعديل يولّد `amd_<original>_r2` وهكذا،
  والسلسلة كلها تعود إلى الأصل ⇒ شجرة تدقيق كاملة.
- **عدد الكتابات:** الأصل(1) + العكس(1) + البديل(1) + الحسابات(1–2) + المرتبط(1) + الميزانية(1)
  + المجمّع(1) + التدقيق(1) = **8–9 كتابات**. ضمن حد الـ500 براحة.

### 6.5 الفترات المغلقة

عند إغلاق شهر (`rollups/{periodKey}.closedAt !== null`، إغلاق اختياري يبدأه المستخدم):
- **يُمنع** الترحيل أو العكس بـ `periodKey` مغلق.
- العكس يحدث في **الفترة الجارية** مع `originalPeriodKey` محفوظاً، ويُعرض في التقرير كـ
  «تصحيحات عن فترات سابقة» بنداً منفصلاً.
- لماذا الخيار متاح أصلاً؟ لأن §16 يطلب تقارير سنوية ثابتة؛ تقرير يتغيّر بعد تصديره = فقدان ثقة.
- افتراضياً **لا شهر مغلق** — الإغلاق ميزة متقدمة، لا سلوك افتراضي.

### 6.6 الحذف

`delete` على `transactions` **ممنوع في Security Rules نهائياً** (`allow delete: if false`).
زر «حذف» في الواجهة يُسمّى **«إلغاء الحركة»** وينفّذ عكساً. هذا نص عربي مقصود (§25.18).
الاستثناء الوحيد: حذف حساب المستخدم كاملاً (§20 «تصدير واستعادة البيانات») — مسار منفصل بتأكيد مزدوج.

---

## 7. تطبيق قواعد الأعمال — القسم 19 من وثيقة المتطلبات

> هذا أهم جزء. كل قاعدة ⇒ الأثر الدقيق على كل كيان.
> الرموز: `↑` زيادة، `↓` نقص، `—` لا أثر، `Δ` أثر مشروط.

### 7.1 الجدول الرئيسي: 11 قاعدة × 6 كيانات

| # | القاعدة (§19) | النوع/النمط | **الحسابات** | **التقارير** | **الالتزامات** | **الديون** | **الميزانيات** | **الأهداف** |
|---|---|---|---|---|---|---|---|---|
| 1 | المصروف المدفوع يخفض رصيد الحساب | `expense/plain`<br>`reportClass='expense'` | `accountId.balanceMinor ↓ amountMinor`<br>`deltaSumMinor ↓`, `txCount ↑1` | مصروفات ↑<br>صافي التدفق ↓<br>`rollup.expenseMinor ↑`<br>`byCategoryMinor[cat] ↑`<br>إن `scope='household'`: `householdExpenseMinor ↑` **ولا يُضاف ثانيةً** (§11) | — | — | `budgets['<period>__<cat>'].spentMinor ↑`<br>+ `budgets['<period>__ALL'].spentMinor ↑`<br>`remainingMinor ↓` | — |
| 2 | الدخل المستلم يرفع رصيد الحساب | `income/plain`<br>`reportClass='income'` | `accountId.balanceMinor ↑ amountMinor` | دخل ↑<br>صافي التدفق ↑<br>`rollup.incomeMinor ↑` | — | — | — (الميزانية تقيس الإنفاق) | — |
| 2ب | **المتوقع لا يُضاف قبل الاستلام** (§7) | لا حركة | **—** | يظهر في «الدخل المتوقع» بقسم منفصل تماماً عن الفعلي | — | — | — | — |
| 3 | التحويل لا يغيّر إجمالي الأموال | `transfer/plain`<br>`reportClass='internal'` | `accountId ↓ amount`<br>`counterAccountId ↑ amount`<br>**Σ الأرصدة ثابت** | **لا دخل ولا مصروف**<br>`rollup` لا يتغيّر إطلاقاً<br>يظهر في «حركة الحساب» فقط | — | — | **— (حاسم: التحويل لا يستهلك ميزانية)** | `Δ` إن `link.kind='goal'`: `savedMinor ↑` و `subtype='goalFunding'` |
| 4 | إنشاء التزام غير مدفوع لا يخفض الرصيد | **لا حركة** | **—** | يظهر في «الالتزامات القادمة» لا في المصروفات | مستند جديد: `paidMinor=0`, `remainingMinor=totalMinor`, `status='upcoming'` | — | **— (لا استهلاك قبل الدفع)** | — |
| 5 | دفع التزام يخفض الرصيد ويسجل الدفعة | `obligationPayment`<br>`reportClass` = من `obligation.nature` | `accountId ↓ amountMinor` | إن `nature='expense'`: مصروفات ↑ و `byCategoryMinor[obligation.categoryId] ↑`<br>إن `nature='financing'`: `financingOutMinor ↑` **ولا يدخل المصروفات** | `paidMinor ↑ amount`<br>`remainingMinor ↓`<br>`paymentCount ↑1`<br>`status` يُعاد حسابه (7.3)<br>`lastPaymentOperationId` | — | إن `nature='expense'`: `spentMinor ↑`<br>إن `financing`: **—** | — |
| 6 | تسجيل دين عليّ لا يعني حركة نقدية | **حالتان** | إن `cashMovedOnCreation=false`: **—**<br>إن `true`: حركة `income/debtDrawdown` ⇒ `balanceMinor ↑` | إن لا نقد: — (يظهر في «الديون عليّ»)<br>إن نقد: `financingInMinor ↑` **وليس دخلاً** | — | مستند `direction='payable'`<br>`settledMinor=0`<br>`remainingMinor=principalMinor` | **—** | — |
| 7 | تحصيل دين يرفع رصيد الحساب المستلم | `debtCollection`<br>`reportClass='financing'` | `accountId ↑ amountMinor` | `financingInMinor ↑`<br>**ليس دخلاً** ⇒ لا يتضخم «إجمالي الدخل» | — | `debt(receivable).settledMinor ↑`<br>`remainingMinor ↓`<br>`settlementCount ↑1`<br>`status` يُعاد حسابه | — | `Δ` إن مرتبط بهدف |
| 8 | سداد دين يخفض رصيد حساب الدفع | `debtPayment`<br>`reportClass='financing'` | `accountId ↓ amountMinor` | `financingOutMinor ↑`<br>**ليس مصروفاً** ⇒ لا يتضخم «إجمالي المصروفات» | — | `debt(payable).settledMinor ↑`<br>`remainingMinor ↓` | **— (سداد أصل الدين لا يستهلك ميزانية الإنفاق)** | — |
| 9 | المستحق للتحصيل لا يُعرض ضمن النقد المتاح | قاعدة عرض | `totalAvailable = Σ accounts.balanceMinor` **فقط** | بطاقة «المستحق لي» منفصلة بصرياً ولوناً عن «الأموال المتاحة» | — | `Σ debts(receivable).remainingMinor` يُعرض كصف مستقل | — | — |
| 10 | التعديل/الإلغاء يحفظ الأثر ويمنع التضارب | `*/reversal` + `*/amendment` | العكس يطبّق الدلتا المعاكسة؛ البديل يطبّق الجديدة — **في transaction واحدة** | الأصل + العكس يتصافران؛ البديل يظهر بقيمته | تراجع `paidMinor` ثم إعادة تطبيقه | تراجع `settledMinor` ثم إعادة تطبيقه | تراجع `spentMinor` ثم إعادة تطبيقه | تراجع `savedMinor` ثم إعادة تطبيقه |
| 11 | التمييز بين التحويل/الاقتراض/السداد/الدخل/المصروف | `reportClass` هو الفاصل | كلها تمسّ الرصيد | **«إجمالي المصروفات» = Σ(reportClass==='expense') فقط**<br>**«إجمالي الدخل» = Σ(reportClass==='income') فقط**<br>`internal` و `financing` و `adjustment` خارج الاثنين تماماً<br>كلها داخل «التدفق النقدي» | — | — | الميزانية تقرأ `expense` فقط | — |

### 7.2 مصفوفة `type × subtype ⇒ reportClass` — الجدول المرجعي الوحيد

| `type` | `subtype` | `direction` | `reportClass` | يدخل المصروفات؟ | يدخل الدخل؟ | يستهلك ميزانية؟ | يمسّ الرصيد؟ |
|---|---|---|---|---|---|---|---|
| `expense` | `plain` | out | `expense` | ✔ | ✘ | ✔ | ✔ |
| `expense` | `receivableFunding` | out | `financing` | ✘ | ✘ | ✘ | ✔ |
| `income` | `plain` | in | `income` | ✘ | ✔ | ✘ | ✔ |
| `income` | `debtDrawdown` | in | `financing` | ✘ | ✘ | ✘ | ✔ |
| `transfer` | `plain` | internal | `internal` | ✘ | ✘ | ✘ | ✔ (حسابان) |
| `transfer` | `goalFunding` | internal | `internal` | ✘ | ✘ | ✘ | ✔ (حسابان) |
| `obligationPayment` | `plain` (nature=expense) | out | `expense` | ✔ | ✘ | ✔ | ✔ |
| `obligationPayment` | `plain` (nature=financing) | out | `financing` | ✘ | ✘ | ✘ | ✔ |
| `debtPayment` | `plain` | out | `financing` | ✘ | ✘ | ✘ | ✔ |
| `debtCollection` | `plain` | in | `financing` | ✘ | ✘ | ✘ | ✔ |
| `adjustment` | `reconciliation` | in/out | `adjustment` | ✘ | ✘ | ✘ | ✔ |
| `adjustment` | `openingCorrection` | in/out | `adjustment` | ✘ | ✘ | ✘ | ✔ |
| `*` | `reversal` | معكوس | **يرث من الأصل** | يرث | يرث | يرث | ✔ |

**لماذا `debtDrawdown` و `receivableFunding` كـ `subtype` لا كـ `type` جديد؟**
لأن قائمة الأنواع محدّدة في منظوري ولا أريد كسرها، ولأن الاتجاه النقدي (`in`/`out`) يُلتقط فعلاً
بـ `income`/`expense`، بينما المعنى يُلتقط بـ `subtype` ⇒ `reportClass`.
**وهذا بالضبط عيب:** النوع يعني «الشكل» والـ subtype يعني «المعنى»، وهذا التباس حقيقي.
التوصية البديلة (مُقيَّمة ومرفوضة الآن): توسيع الـ enum إلى `borrow` و `lend`. ترفضه
«الحد الأدنى من الأنواع» لكنه أوضح. يُسجَّل كـ ADR مفتوح.

### 7.3 إعادة حساب الحالات — دوال خالصة

```ts
// domain/rules/status.ts
export function obligationStatusOf(o: ObligationCore, now: Date): ObligationStatus {
  if (o.status === 'cancelled') return 'cancelled';
  const due = o.totalMinor + o.extraChargesMinor;
  if (o.paidMinor >= due) return 'paid';
  if (o.paidMinor > 0)  return 'partiallyPaid';
  if (isAfterDay(now, o.dueDate)) return 'overdue';
  if (isSameDay(now, o.dueDate))  return 'due';
  return 'upcoming';
}

export function debtStatusOf(d: DebtCore): DebtStatus {
  if (d.status === 'cancelled') return 'cancelled';
  const effective = d.settledMinor + d.writtenOffMinor;
  if (effective >= d.principalMinor) return d.writtenOffMinor > 0 ? 'writtenOff' : 'settled';
  if (effective > 0) return 'partiallySettled';
  return 'open';
}
```

> ملاحظة: `overdue` و `due` تعتمدان على الزمن، فلا يمكن تخزينهما نهائياً بدقة بلا دالة مجدولة
> (غير متاحة على Spark). الحل: تُخزَّن `status` المالية (`paid`/`partiallyPaid`/`open`) ويُشتق
> البعد الزمني عند العرض من `dueDate` بدالة خالصة. الاستعلام «المتأخرة» = `where('remainingMinor','>',0)`
> + `where('dueDate','<',now)` — مفهرس ودقيق بلا جدولة. **هذه إحدى نقاط Spark المحلولة بلا Blaze.**

### 7.4 قواعد §19 الوقائية — انظر §8

---

## 8. الحوارس (منع السالب، السداد الزائد، اليتم)

### 8.1 الرصيد السالب غير المسموح

```ts
// domain/rules/guards.ts
export function guardNegativeBalance(
  account: Pick<AccountDoc, 'balanceMinor'|'allowNegative'|'minBalanceMinor'|'name'>,
  deltaMinor: Minor,
): GuardResult {
  const after = account.balanceMinor + deltaMinor;
  if (account.allowNegative) {
    if (after < account.minBalanceMinor)
      return fail('BALANCE_BELOW_FLOOR',
        `الرصيد سيتجاوز الحد الأدنى المسموح لحساب «${account.name}»`);
    return pass();
  }
  if (after < 0)
    return fail('BALANCE_NEGATIVE',
      `الرصيد غير كافٍ في حساب «${account.name}». المتاح ${formatMinor(account.balanceMinor)}`);
  return pass();
}
```

نقاط دقيقة:
- الفحص يتم على القيمة **المقروءة داخل الـ transaction**، لا على القيمة المعروضة في الواجهة.
  هذا هو كل الفرق: جهازان يصرفان معاً من رصيد 100 ⇒ أحدهما يُرفض فعلاً.
- **الفحص يُطبَّق أيضاً على التحويل** لحساب المصدر، **وعلى العكس**: عكس **دخلٍ** قد يجعل الرصيد
  سالباً. في هذه الحالة نرفض العكس برسالة «لا يمكن إلغاء هذا الدخل لأن المبلغ أُنفق — ألغِ المصروفات
  المرتبطة أولاً أو فعّل السماح بالسالب لهذا الحساب». هذه حالة حقيقية تُنسى عادةً.
- حركات بتاريخ ماضٍ (`occurredAt` قديم): الفحص على الرصيد **الحالي** لا التاريخي. أي أن النظام
  لا يضمن عدم وجود سالب في منتصف التاريخ. **هذا قصور مُعلن**: المجمّع المخزّن لا يعرف الرصيد
  التاريخي. من أراد ذلك فعليه حساب الرصيد التراكمي من الدفتر في شاشة الكشف (وهذا ما نفعله هناك فعلاً).

### 8.2 السداد الزائد عن المستحق

```ts
export function guardOverpayment(
  entity: { dueMinor: Minor; settledMinor: Minor; allowOverpayment: boolean; label: string },
  paymentMinor: Minor,
): GuardResult {
  if (paymentMinor <= 0) return fail('AMOUNT_NOT_POSITIVE', 'المبلغ يجب أن يكون أكبر من صفر');
  const remaining = entity.dueMinor - entity.settledMinor;
  if (remaining <= 0)
    return fail('ALREADY_SETTLED', `«${entity.label}» مسدَّد بالكامل`);
  if (paymentMinor > remaining && !entity.allowOverpayment)
    return fail('OVERPAYMENT',
      `المبلغ يتجاوز المتبقي (${formatMinor(remaining as Minor)}) على «${entity.label}»`);
  return pass();
}
```

- `dueMinor` للالتزام = `totalMinor + extraChargesMinor`؛ للدين = `principalMinor`.
- الفحص **داخل** الـ transaction على `settledMinor`/`paidMinor` المقروء ⇒ دفعتان متزامنتان
  بـ 500 على متبقٍّ 600: الأولى تمر، الثانية تُرفض بعد إعادة المحاولة. **لا تجاوز.**
- عند التجاوز تعرض الواجهة خيارين صريحين بالعربية: «سدّد المتبقي فقط (600.000)» أو
  «سجّل الزائد كرسوم إضافية على الالتزام» (يرفع `extraChargesMinor` بسجل سبب). لا سماح صامت.
- `allowOverpayment` يبقى موجوداً للحالات الواقعية (دفع مقدّم للمالك)، لكنه **إقرار صريح من المستخدم
  على مستوى الكيان**، لا إعداد عام.

### 8.3 الحركة اليتيمة (Orphan)

«اليتم» له اتجاهان، وكلاهما مُعالَج:

| الاتجاه | المعنى | الحاجز |
|---|---|---|
| حركة ⟶ كيان مفقود | `link.kind='obligation'` و الالتزام محذوف/غير موجود | قراءة `linkRef` **داخل** الـ transaction؛ عدم وجوده ⇒ `ORPHAN_LINK`. وفي Rules: `exists()` على مسار الربط عند الإنشاء |
| كيان ⟶ حركة مفقودة | `obligation.paidMinor` تغيّر بلا حركة | **مستحيل بنيوياً**: التحديثان في نفس الـ transaction. وتُعزَّز بـ Rules: تحديث `paidMinor` مرفوض ما لم تُكتب حركة في نفس الـ commit (`getAfter`) |
| حذف كيان له حركات | حذف التزام مدفوع جزئياً | `delete` ممنوع على `obligations`/`debts` إن `paymentCount > 0`؛ البديل `status='cancelled'` |
| مرفق بلا حركة | رُفع إيصال ثم فشلت الحركة | مرفق «معلّق» بـ TTL؛ تنظيف دوري عند فتح التطبيق (انظر §11 — Storage يتطلب Blaze أصلاً) |
| حركة بلا حساب | الحساب مؤرشف أو محذوف | `delete` على `accounts` ممنوع إن `txCount > 0`؛ الأرشفة فقط |

### 8.4 قواعد الأمان — ربط الرصيد بالحركة (`getAfter`)

على Spark لا توجد Cloud Functions ⇒ **كل الكتابات من العميل** ⇒ القواعد هي الحاجز الوحيد.
المفتاح: `getAfter()` تقرأ حالة مستند **بعد** تطبيق نفس الـ commit، فتصلح لربط مستندين.

```javascript
rules_version = '2';
service cloud.firestore {
  function isOwner(uid) { return request.auth != null && request.auth.uid == uid; }
  function unchanged(f) { return request.resource.data[f] == resource.data[f]; }
  function isPosInt(v) { return v is int && v > 0 && v <= 1000000000000; }

  match /databases/{database}/documents/users/{uid} {

    match /transactions/{opId} {
      allow read: if isOwner(uid);

      allow create: if isOwner(uid)
        && request.resource.data.ownerUid == uid
        && request.resource.data.operationId == opId            // المعرّف = معرّف المستند
        && isPosInt(request.resource.data.amountMinor)          // صحيح وموجب دائماً
        && request.resource.data.currency == 'LYD'
        && request.resource.data.type in ['expense','income','transfer','debtPayment',
             'debtCollection','obligationPayment','adjustment']
        && request.resource.data.lifecycle == 'posted'
        && request.resource.data.bookedAt == request.time
        // منع اليتم: الكيان المرتبط موجود فعلاً
        && (request.resource.data.link.kind == 'none'
            || exists(/databases/$(database)/documents/users/$(uid)/$(linkCol(request.resource.data.link.kind))/$(request.resource.data.link.id)))
        // الحساب موجود ونشط
        && exists(/databases/$(database)/documents/users/$(uid)/accounts/$(request.resource.data.accountId));

      // تعديل مسموح فقط للحقول غير المالية + لحقول دورة الحياة التي يكتبها النظام
      allow update: if isOwner(uid)
        && unchanged('amountMinor') && unchanged('accountId') && unchanged('counterAccountId')
        && unchanged('type') && unchanged('subtype') && unchanged('reportClass')
        && unchanged('periodKey') && unchanged('operationId') && unchanged('currency')
        && unchanged('direction') && unchanged('bookedAt');

      allow delete: if false;                                    // الدفتر لا يُحذف (§6.6)
    }

    match /accounts/{accountId} {
      allow read: if isOwner(uid);
      allow create: if isOwner(uid)
        && request.resource.data.balanceMinor == request.resource.data.openingBalanceMinor
        && request.resource.data.deltaSumMinor == 0
        && request.resource.data.txCount == 0;

      // أي تغيّر في الرصيد يجب أن يرافقه كتابة حركة في نفس الـ commit
      allow update: if isOwner(uid)
        && unchanged('openingBalanceMinor')                      // الافتتاحي ثابت
        && unchanged('ownerUid') && unchanged('currency')
        && (
             // (أ) تعديل غير مالي: الرصيد لم يتغيّر
             (unchanged('balanceMinor') && unchanged('deltaSumMinor'))
             ||
             // (ب) تعديل مالي: يرافقه حركة بنفس operationId في نفس الـ commit
             (request.resource.data.lastTxOperationId != resource.data.lastTxOperationId
              && getAfter(/databases/$(database)/documents/users/$(uid)/transactions/$(request.resource.data.lastTxOperationId)).data.ownerUid == uid)
           );

      allow delete: if isOwner(uid) && resource.data.txCount == 0;
    }

    match /obligations/{obligationId} {
      allow read, create: if isOwner(uid);
      allow update: if isOwner(uid)
        && unchanged('ownerUid')
        && (
             unchanged('paidMinor')                               // تعديل غير مالي
             || getAfter(/databases/$(database)/documents/users/$(uid)/transactions/$(request.resource.data.lastPaymentOperationId)).data.link.id == obligationId
           )
        && request.resource.data.paidMinor >= 0
        && request.resource.data.paidMinor <=
             request.resource.data.totalMinor + request.resource.data.extraChargesMinor;  // منع السداد الزائد في القاعدة نفسها
      allow delete: if isOwner(uid) && resource.data.paymentCount == 0;
    }

    match /auditLogs/{logId} {
      allow read: if isOwner(uid);
      allow create: if isOwner(uid) && request.resource.data.ownerUid == uid;
      allow update, delete: if false;                             // أرشيف غير قابل للعبث
    }
  }
}
```

**تحفّظات صادقة على هذه القواعد:**
1. `getAfter()` موثّقة للعمل ضمن batched writes و transactions، لكن سلوكها عند تعدد المستندات
   **يجب أن يُختبر في Emulator قبل الاعتماد** (§23.7 و §25.10). لا نعتبرها عاملة لمجرد كتابتها.
2. كل `exists()`/`getAfter()` **تُحاسَب كقراءة مستند** ⇒ تضيف تكلفة (محسوبة في §9).
3. القواعد **لا تستطيع** التحقق من أن `balanceMinor` الجديد = القديم + مبلغ الحركة بالإشارة الصحيحة
   في كل الحالات (التحويل يمسّ حسابين بحركة واحدة، والدلتا تعتمد على `type`). يمكن تقريبها لكن
   التعقيد يصير هشاً. **القرار:** القاعدة تضمن «لا تغيّر رصيد بلا حركة مصاحبة»، ولا تضمن
   «المقدار صحيح». ضمان المقدار = `runTransaction` + المدقّق (§3.4). **هذه ثغرة حقيقية ومُعلنة**،
   وحلّها الكامل يتطلب Cloud Functions ⇒ Blaze.
4. حدّ 10 استدعاءات `get`/`exists`/`getAfter` لكل طلب في Rules — عملياتنا تحت الحد (≤4).

### 8.5 العمليات غير المكتملة (§19)

| الحالة | المعالجة |
|---|---|
| المستخدم أغلق النافذة أثناء الإرسال | الـ transaction إما تمّت أو لا؛ الـ outbox يعيد المحاولة بنفس المعرّف |
| فشل بعد الكتابة وقبل وصول التأكيد | التفريغ التالي يرى `duplicate` ⇒ حالة متسقة |
| الحركة في الطابور ولم تُرسل | تُعرض بشارة «بانتظار الإرسال»، **خارج الرصيد وخارج التقارير** |
| فشل دائم (رُفضت بقاعدة) | تنتقل إلى `failed` مع رسالة عربية؛ تُعرض في «عمليات لم تكتمل» مع زر «تعديل وإعادة المحاولة» |

---

## 9. تكلفة Firestore

افتراضات: مستخدم واحد، 5 حسابات، ~12 فئة، ~6 ميزانيات نشطة، ~8 حركات/يوم.
الحصة اليومية المجانية (Spark): **50,000 قراءة، 20,000 كتابة، 20,000 حذف**.

### 9.1 تكلفة تسجيل مصروف واحد

| الخطوة | قراءات | كتابات |
|---|---|---|
| `t.get(transactions/{opId})` — فحص الازدواج | 1 | — |
| `t.get(accounts/{id})` | 1 | — |
| `t.get(budgets/{period}__{cat})` | 1 | — |
| `t.get(budgets/{period}__ALL)` | 1 | — |
| `t.get(rollups/{period})` | 1 | — |
| `exists()` داخل Rules: الحساب | 1 | — |
| `getAfter()` داخل Rules: الحركة | 1 | — |
| كتابة الحركة | — | 1 |
| تحديث الحساب | — | 1 |
| تحديث ميزانية الفئة | — | 1 |
| تحديث الميزانية العامة | — | 1 |
| تحديث المجمّع الشهري | — | 1 |
| سجل التدقيق | — | 1 |
| **الإجمالي** | **7** | **6** |

- بـ 8 مصروفات يومياً: **56 قراءة + 48 كتابة** ⇒ **0.11% و 0.24%** من الحصة. مريح جداً.
- عند إعادة محاولة الـ transaction (تعارض): تُعاد محاسبة القراءات. بمستخدم واحد، نادر.
- **تحسين اختياري** إن ضاقت الحصة لاحقاً: دمج ميزانية الفئة والميزانية العامة في مستند واحد
  `budgets/{periodKey}` يحوي `byCategory: Record<catId, {limit, spent}>` ⇒ −1 قراءة و −1 كتابة.
  الثمن: مستند أسخن وحجم أكبر. **لا يُعتمد الآن** لأنه لا حاجة.

### 9.2 تكلفة العمليات الأخرى

| العملية | قراءات | كتابات |
|---|---|---|
| دخل | 4 (tx, account, rollup, +rules 2) = 6 | 4 |
| تحويل بين حسابين | tx, acct×2, (goal؟) + rules 3 = **7** | tx, acct×2, audit = **4** |
| دفع التزام | tx, account, obligation, budget×2, rollup + rules 3 = **9** | tx, account, obligation, budget×2, rollup, audit = **7** |
| تحصيل دين | tx, account, debt, rollup + rules 3 = **7** | tx, account, debt, rollup, audit = **5** |
| عكس حركة | original, rev, acct, linked, budget, rollup + rules = **9** | rev, original, acct, linked, budget, rollup, audit = **7** |
| تعديل (عكس+بديل) | **10** | **9** |

### 9.3 تكلفة فتح لوحة التحكم (§4)

**مع المجمّعات (التصميم المعتمد):**

| البطاقة | المصدر | قراءات |
|---|---|---|
| إجمالي الأموال المتاحة + الحسابات | `accounts where status='active'` | 5 |
| دخل/مصروف الشهر + صافي التدفق + الرسوم حسب الفئة | `rollups/{currentPeriod}` | **1** |
| اتجاه الإنفاق (6 أشهر) | `rollups where periodKey in [6 keys]` | 6 |
| الالتزامات القادمة | `obligations where remainingMinor>0 orderBy dueDate limit 5` | 5 |
| الالتزامات المتأخرة (عدّاد) | `getCountFromServer()` على نفس الاستعلام | **1** |
| إجمالي الديون عليّ / لي | `debts where remainingMinor>0` (≈10 مستندات) | 10 |
| نسبة استهلاك الميزانية | `budgets where periodKey=current` | 6 |
| مصروفات المنزل | من `rollups.householdExpenseMinor` | 0 |
| الادخار والأهداف | `financialGoals where status='active'` | 3 |
| مهام اليوم | `tasks where dayKey=today limit 10` | 10 |
| التنبيهات غير المقروءة | `notifications where read=false limit 10` | 10 |
| الإعدادات | `settings/app` | 1 |
| **الإجمالي** | | **≈58 قراءة** |

**بدون المجمّعات** (حساب الشهر من الدفتر): +~240 حركة شهرياً × 7 أشهر = **+1,700 قراءة لكل فتح**.
بـ 20 فتحة يومياً ⇒ **34,000 قراءة/يوم** ⇒ 68% من الحصة على لوحة التحكم وحدها. **غير مقبول.**

**مع التخزين المؤقت:** `onSnapshot` + `enableIndexedDbPersistence` يجعل الفتحات التالية في
نفس الجلسة شبه مجانية (قراءات محلية لا تُحاسَب؛ تُحاسَب فقط المستندات المتغيّرة).
20 فتحة/يوم ⇒ **~58 قراءة أولى + دلتا** ⇒ أقل من **500 قراءة/يوم** واقعياً = **1% من الحصة**.

### 9.4 الفهارس المركّبة المطلوبة (§18.7)

```jsonc
// firestore.indexes.json (النواة فقط)
[
  { "collectionGroup": "transactions", "fields": [
    { "fieldPath": "accountId", "order": "ASCENDING" },
    { "fieldPath": "lifecycle", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "DESCENDING" } ] },          // كشف حساب

  { "collectionGroup": "transactions", "fields": [
    { "fieldPath": "periodKey", "order": "ASCENDING" },
    { "fieldPath": "reportClass", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "DESCENDING" } ] },          // تقرير شهري

  { "collectionGroup": "transactions", "fields": [
    { "fieldPath": "link.kind", "order": "ASCENDING" },
    { "fieldPath": "link.id", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "DESCENDING" } ] },          // دفعات التزام/دين

  { "collectionGroup": "transactions", "fields": [
    { "fieldPath": "categoryId", "order": "ASCENDING" },
    { "fieldPath": "periodKey", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "DESCENDING" } ] },          // تقرير فئة

  { "collectionGroup": "transactions", "fields": [
    { "fieldPath": "scope", "order": "ASCENDING" },
    { "fieldPath": "periodKey", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "DESCENDING" } ] },          // مصاريف المنزل §11

  { "collectionGroup": "obligations", "fields": [
    { "fieldPath": "remainingMinor", "order": "ASCENDING" },
    { "fieldPath": "dueDate", "order": "ASCENDING" } ] },              // القادمة/المتأخرة

  { "collectionGroup": "debts", "fields": [
    { "fieldPath": "direction", "order": "ASCENDING" },
    { "fieldPath": "remainingMinor", "order": "ASCENDING" },
    { "fieldPath": "dueDate", "order": "ASCENDING" } ] }
]
```

استثناءات الفهرسة الأحادية (توفير تكلفة كتابة): إلغاء فهرسة `notes`, `description`, `tags`,
`attachmentIds` — لا يُستعلم عنها بـ `where` (البحث النصي يتم محلياً على النتائج المحمّلة).

---

## 10. أمثلة ملموسة: تسلسل الكتابات بالضبط

> في الأمثلة: `uid = U`، `settings.financialMonthStartDay = 1`، المنطقة `Africa/Tripoli`،
> التاريخ `2026-10-09`، `periodKey = '2026-10'`، `dayKey = '2026-10-09'`.

### 10.1 (أ) مصروف 25.500 د.ل من حساب نقدي

**المدخلات:** `amountMinor = 25500` (= 25 × 1000 + 500)، `accountId = 'acc_cash'`،
`categoryId = 'cat_food'`، `scope = 'personal'`، `operationId = 'op_7f3a…'`.
**الحالة قبل:** `acc_cash.balanceMinor = 1_000_000` (1000.000 د.ل)، `deltaSumMinor = 0`، `txCount = 0`.
`budgets/2026-10__cat_food.spentMinor = 180_000`, `limitMinor = 400_000`.

**القراءات (بالترتيب، متوازية):**
```
R1  users/U/transactions/op_7f3a…            → غير موجود  ✔ ليست مكررة
R2  users/U/accounts/acc_cash                → balanceMinor=1000000, allowNegative=false, status=active
R3  users/U/budgets/2026-10__cat_food        → spentMinor=180000, limitMinor=400000
R4  users/U/budgets/2026-10__ALL             → spentMinor=742000, limitMinor=2500000
R5  users/U/rollups/2026-10                  → expenseMinor=742000, incomeMinor=3000000, txCount=31
```

**التحقق:**
```
accountDeltas(tx) = [{ accountId:'acc_cash', deltaMinor: -25500 }]
guardNegativeBalance: 1000000 + (−25500) = 974500 ≥ 0            ✔
deriveReportClass({type:'expense', subtype:'plain'}) = 'expense'
```

**الكتابات (5 مستندات):**
```
W1  SET    users/U/transactions/op_7f3a…
    { id:'op_7f3a…', operationId:'op_7f3a…', ownerUid:'U', schemaVersion:1,
      type:'expense', subtype:'plain', reportClass:'expense', lifecycle:'posted',
      amountMinor:25500, currency:'LYD', direction:'out',
      accountId:'acc_cash', counterAccountId:null,
      categoryId:'cat_food', subcategoryId:null, scope:'personal',
      paymentMethod:'cash', payee:'مطعم المدينة', description:'غداء',
      occurredAt:2026-10-09T13:20:00+02, bookedAt:serverTimestamp(),
      periodKey:'2026-10', dayKey:'2026-10-09',
      link:{kind:'none', id:null, installmentNo:null},
      reversesTxId:null, reversedByTxId:null, supersedesTxId:null, supersededByTxId:null,
      clientRequestId:'…', deviceId:'dev_pc01', idempotencySource:'user',
      recurrenceId:null, occurrenceKey:null, createdAt:serverTimestamp() }

W2  UPDATE users/U/accounts/acc_cash
    { balanceMinor: 974500,          // 1000000 − 25500
      deltaSumMinor: −25500,
      txCount: 1,
      lastTxOperationId: 'op_7f3a…',
      lastPostedAt: serverTimestamp(), updatedAt: serverTimestamp() }

W3  SET(merge) users/U/budgets/2026-10__cat_food
    { spentMinor: 205500,            // 180000 + 25500
      remainingMinor: 194500,        // 400000 − 205500
      updatedAt: serverTimestamp() } // 51.4% — دون عتبة التنبيه 80%، لا تنبيه

W4  SET(merge) users/U/budgets/2026-10__ALL
    { spentMinor: 767500, remainingMinor: 1732500, updatedAt: serverTimestamp() }

W5  SET(merge) users/U/rollups/2026-10
    { expenseMinor: 767500,
      byCategoryMinor: { ...prev, cat_food: <prev+25500> },
      txCount: 32, lastOperationId:'op_7f3a…', updatedAt: serverTimestamp() }

W6  SET    users/U/auditLogs/op_7f3a…
    { ownerUid:'U', action:'post', entity:'transaction', entityId:'op_7f3a…',
      amountMinor:25500, accountId:'acc_cash',
      balanceBefore:1000000, balanceAfter:974500,
      deviceId:'dev_pc01', at:serverTimestamp() }
```

**الأثر النهائي:** رصيد النقد `974.500 د.ل`. «إجمالي المصروفات» للشهر ↑ 25.500.
الالتزامات والديون والأهداف: **بلا أثر**. استهلاك ميزانية الطعام: 51.4%.

**ملاحظة على الدقة:** لو خُزِّن المبلغ كـ `25.5` عائم، لكان `1000.0 − 25.5 = 974.5` سليماً هنا،
لكن `0.1 + 0.2 = 0.30000000000000004` تظهر بعد عشرات العمليات. بـ `25500` العدد الصحيح،
الخطأ **صفر رياضياً** بعد أي عدد من العمليات.

### 10.2 (ب) سداد جزئي 200.000 د.ل لالتزام إيجار قيمته 800.000

**الحالة قبل:** `obligations/obl_rent`: `totalMinor = 800_000`, `paidMinor = 0`,
`remainingMinor = 800_000`, `extraChargesMinor = 0`, `nature = 'expense'`,
`categoryId = 'cat_housing'`, `status = 'due'`, `paymentCount = 0`, `allowOverpayment = false`.
`acc_bank.balanceMinor = 3_500_000`.
**المدخلات:** `amountMinor = 200_000`, `accountId = 'acc_bank'`, `link = {kind:'obligation', id:'obl_rent', installmentNo:1}`,
`operationId = 'op_b21c…'`.

**القراءات:**
```
R1  users/U/transactions/op_b21c…      → غير موجود  ✔
R2  users/U/accounts/acc_bank          → balanceMinor=3500000, allowNegative=false
R3  users/U/obligations/obl_rent       → total=800000, paid=0, extra=0, nature='expense',
                                          categoryId='cat_housing', allowOverpayment=false
R4  users/U/budgets/2026-10__cat_housing → spentMinor=0, limitMinor=800000
R5  users/U/budgets/2026-10__ALL         → spentMinor=767500
R6  users/U/rollups/2026-10              → expenseMinor=767500
```

**التحقق:**
```
guardNegativeBalance: 3500000 − 200000 = 3300000 ≥ 0                       ✔
guardOverpayment: due = 800000 + 0 = 800000; remaining = 800000 − 0 = 800000
                  200000 ≤ 800000                                          ✔
deriveReportClass({type:'obligationPayment'}, {obligationNature:'expense'}) = 'expense'
obligationStatusOf({paid: 200000, total: 800000}) = 'partiallyPaid'
categoryId للحركة = obligation.categoryId = 'cat_housing'   (موروث، لا يختاره المستخدم)
```

**الكتابات (7 مستندات):**
```
W1  SET    users/U/transactions/op_b21c…
    { type:'obligationPayment', subtype:'plain', reportClass:'expense', lifecycle:'posted',
      amountMinor:200000, direction:'out', accountId:'acc_bank', counterAccountId:null,
      categoryId:'cat_housing', scope:'household', paymentMethod:'transfer',
      payee:'المالك — أبو سالم', description:'سداد جزئي من إيجار أكتوبر',
      link:{kind:'obligation', id:'obl_rent', installmentNo:1},
      periodKey:'2026-10', dayKey:'2026-10-09',
      occurredAt:…, bookedAt:serverTimestamp(), operationId:'op_b21c…', … }

W2  UPDATE users/U/accounts/acc_bank
    { balanceMinor: 3300000, deltaSumMinor: <prev−200000>, txCount: <prev+1>,
      lastTxOperationId:'op_b21c…', lastPostedAt:serverTimestamp() }

W3  UPDATE users/U/obligations/obl_rent
    { paidMinor: 200000,              // 0 + 200000
      remainingMinor: 600000,         // (800000 + 0) − 200000
      paymentCount: 1,
      status: 'partiallyPaid',
      lastPaymentAt: serverTimestamp(),
      lastPaymentOperationId: 'op_b21c…',    // ← تقرؤها Rules عبر getAfter
      updatedAt: serverTimestamp() }

W4  SET(merge) users/U/budgets/2026-10__cat_housing
    { spentMinor: 200000, remainingMinor: 600000 }        // 25% من سقف السكن

W5  SET(merge) users/U/budgets/2026-10__ALL
    { spentMinor: 967500, remainingMinor: 1532500 }

W6  SET(merge) users/U/rollups/2026-10
    { expenseMinor: 967500,
      householdExpenseMinor: <prev + 200000>,   // scope='household' — لا يُضاف إلى expenseMinor ثانيةً
      byCategoryMinor: { …, cat_housing: 200000 }, txCount: <prev+1>,
      lastOperationId:'op_b21c…' }

W7  SET    users/U/auditLogs/op_b21c…
    { action:'post', entity:'transaction', linkedEntity:'obligation/obl_rent',
      obligationPaidBefore:0, obligationPaidAfter:200000,
      balanceBefore:3500000, balanceAfter:3300000, at:serverTimestamp() }
```

**الأثر النهائي:** الالتزام `مسدد جزئياً`، المتبقي `600.000 د.ل`.
رصيد المصرف `3,300.000`. إجمالي المصروفات ↑ 200.000 (لأن `nature='expense'`).
مصاريف المنزل ↑ 200.000 — **وهي نفس المبلغ لا مبلغ إضافي** (§11).
لو كان الالتزام قسط قرض (`nature='financing'`) لكان `reportClass='financing'` ولما تغيّر
`expenseMinor` ولا `budgets` إطلاقاً، بل `financingOutMinor ↑` فقط.

**حالة الرفض:** لو أدخل المستخدم `900_000` ⇒ `guardOverpayment` يفشل بـ
«المبلغ يتجاوز المتبقي (800.000) على «إيجار المنزل»» ⇒ **صفر كتابة**، الـ transaction تُلغى كاملة.

### 10.3 (ج) تحصيل 150.000 د.ل من دين لي قيمته 400.000 إلى حساب مصرفي

**الحالة قبل:** `debts/debt_ali`: `direction='receivable'`, `counterpartyName='علي محمد'`,
`principalMinor = 400_000`, `settledMinor = 0`, `remainingMinor = 400_000`, `writtenOffMinor = 0`,
`status='open'`, `cashMovedOnCreation = true` (أقرضتُه نقداً عند النشوء).
`acc_bank.balanceMinor = 3_300_000` (بعد المثال ب).
**المدخلات:** `amountMinor = 150_000`, `accountId = 'acc_bank'`,
`link = {kind:'debt', id:'debt_ali', installmentNo:1}`, `operationId = 'op_c90d…'`.

**القراءات:**
```
R1  users/U/transactions/op_c90d…   → غير موجود  ✔
R2  users/U/accounts/acc_bank       → balanceMinor=3300000, status='active'
R3  users/U/debts/debt_ali          → direction='receivable', principal=400000, settled=0,
                                       writtenOff=0, allowOverpayment=false
R4  users/U/rollups/2026-10         → financingInMinor=0, incomeMinor=3000000
```
> **لا قراءة للميزانيات** — التحصيل `financing` ولا يمسّ الميزانية إطلاقاً (§7.1 القاعدة 7).
> هذا فرق تكلفة ملموس: 4 قراءات بدل 6.

**التحقق:**
```
accountDeltas = [{ accountId:'acc_bank', deltaMinor: +150000 }]
guardNegativeBalance: 3300000 + 150000 = 3450000 ≥ 0                        ✔ (دخول، لا خطر)
guardOverpayment: due = 400000; settled+writtenOff = 0; remaining = 400000
                  150000 ≤ 400000                                            ✔
debtStatusOf({ settled:150000, writtenOff:0, principal:400000 }) = 'partiallySettled'
deriveReportClass({type:'debtCollection', subtype:'plain'}) = 'financing'    ← ليس دخلاً
```

**الكتابات (5 مستندات):**
```
W1  SET    users/U/transactions/op_c90d…
    { type:'debtCollection', subtype:'plain', reportClass:'financing', lifecycle:'posted',
      amountMinor:150000, direction:'in', accountId:'acc_bank', counterAccountId:null,
      categoryId:null, scope:'personal', paymentMethod:'transfer',
      payee:'علي محمد', description:'تحصيل دفعة أولى',
      link:{kind:'debt', id:'debt_ali', installmentNo:1},
      periodKey:'2026-10', dayKey:'2026-10-09', bookedAt:serverTimestamp(),
      operationId:'op_c90d…', … }

W2  UPDATE users/U/accounts/acc_bank
    { balanceMinor: 3450000,          // 3300000 + 150000
      deltaSumMinor: <prev+150000>, txCount: <prev+1>,
      lastTxOperationId:'op_c90d…', lastPostedAt:serverTimestamp() }

W3  UPDATE users/U/debts/debt_ali
    { settledMinor: 150000,
      remainingMinor: 250000,         // 400000 − 150000
      settlementCount: 1,
      status: 'partiallySettled',
      lastSettlementAt: serverTimestamp(),
      lastSettlementOperationId: 'op_c90d…',
      updatedAt: serverTimestamp() }

W4  SET(merge) users/U/rollups/2026-10
    { financingInMinor: 150000,       // ← هنا، لا في incomeMinor
      txCount: <prev+1>, lastOperationId:'op_c90d…' }
    // incomeMinor يبقى 3000000 بلا تغيير — هذا جوهر القاعدة 11

W5  SET    users/U/auditLogs/op_c90d…
    { action:'post', entity:'transaction', linkedEntity:'debt/debt_ali',
      debtSettledBefore:0, debtSettledAfter:150000,
      balanceBefore:3300000, balanceAfter:3450000, at:serverTimestamp() }
```

**الأثر النهائي على لوحة التحكم:**

| البطاقة | قبل | بعد | ملاحظة |
|---|---|---|---|
| إجمالي الأموال المتاحة | 4,300.000 | **4,450.000** | ↑ 150.000 |
| إجمالي المستحق لي | 400.000 | **250.000** | ↓ 150.000 |
| **إجمالي الدخل الشهري** | 3,000.000 | **3,000.000** | **بلا تغيير** ← القاعدة 11 |
| إجمالي المصروفات الشهرية | 967.500 | 967.500 | بلا تغيير |
| صافي التدفق النقدي (دخل − مصروف) | 2,032.500 | 2,032.500 | بلا تغيير |
| التدفق النقدي الفعلي (كل الحركات) | — | ↑ 150.000 | مؤشر منفصل |
| نسبة استهلاك الميزانية | 38.7% | 38.7% | بلا تغيير |

> **لاحظ:** مجموع الثروة (`أموال متاحة + مستحق لي`) بقي `4,700.000` قبل وبعد.
> هذا هو التحقق البصري لكون التحصيل **نقلاً** لا دخلاً. ولو عُومل دخلاً لتضخّم دخل أكتوبر
> بنسبة 5% وهمية ولانهارت كل مقارنات §16.

---

## 11. ما الذي يتطلب Blaze، وما البديل على Spark

| الميزة | على Spark | البديل المعتمد | عند الترقية إلى Blaze |
|---|---|---|---|
| المصروفات المتكررة (§6) | ✘ لا Scheduled Functions | **التنفيذ اللاحق عند فتح التطبيق** بمعرّفات حتمية (§4.3) — يعمل بالكامل | Scheduled Function يومية تنفّذ المستحق حتى لو لم يُفتح التطبيق |
| حالة «متأخر» للالتزامات | ✘ لا دالة تحدّث الحالة | **اشتقاق عند العرض** من `dueDate` + `remainingMinor` مع فهرس مركّب (§7.3) — دقيق تماماً | تحديث `status` مخزّناً + إشعارات push |
| تنبيهات قبل الاستحقاق (§8, §17) | جزئياً | توليد التنبيهات محلياً عند فتح التطبيق + Notification API في المتصفح | FCM + Scheduled Function ⇒ تنبيه دون فتح التطبيق |
| مرفقات الإيصالات (§6) | ✘ Storage يتطلب Blaze في المشاريع الحديثة | **المرحلة 1: بلا مرفقات.** حقل `attachmentIds` موجود في المخطط وفارغ. بديل مؤقت: ضغط الصورة إلى ≤ 200KB وتخزينها base64 في مجموعة `attachments` منفصلة (حد مستند 1MiB) — **يُعتمد بحذر وبحد 3 صور/حركة** | Storage + Rules حسب الحجم والنوع |
| التحقق من المنطق على الخادم | ✘ | **Security Rules فقط** (§8.4) — تضمن «لا رصيد بلا حركة» ولا تضمن صحة المقدار | Cloud Function كبوابة وحيدة للكتابة ⇒ ضمان كامل |
| التحقق الدوري من الانحراف | ✘ | مدقّق يعمل في العميل شهرياً (§3.4) | دالة مجدولة تدقّق كل الحسابات وتنبّه |
| تصدير PDF/Excel (§16) | ✔ | توليد في المتصفح (`exceljs`, `pdfmake`) — يعمل تماماً | نفسه؛ لا حاجة للخادم |
| النسخ الاحتياطي (§20) | ✘ لا تصدير مجدول | زر «تصدير كل البيانات JSON» يدوي + تذكير شهري | تصدير مجدول إلى Storage/GCS |

**الخلاصة:** **النواة المالية كاملة تعمل على Spark بلا نقص وظيفي.** ما ينقص هو
**الأتمتة في غياب المستخدم** (تنبيهات، تنفيذ متكرر دون فتح، تدقيق مجدول) و**المرفقات**.
وهذا يطابق مرحلتَي §24.2 و §24.3 بالكامل.

---

## 12. نقد صريح لهذا المنظور

> المطلوب: ألّا أبيع المنظور، بل أقيّمه. هذه عيوبه الحقيقية.

### 12.1 العيب الأكبر: لا ثابت رياضي داخلي يكشف الخطأ

في **القيد المزدوج** (double-entry) كل حركة تولّد قيوداً مجموعها صفر، فأي خلل يظهر فوراً في
ميزان المراجعة (`Σ all entries == 0`) بلا معرفة بالدفتر أصلاً. **في منظوري لا يوجد هذا.**
الثابت الوحيد لديّ هو `balanceMinor == openingBalanceMinor + Σ deltas` — وللتحقق منه
**يجب مسح الدفتر**. أي أن الكشف **مكلف ومؤجل**، لا فوري ومجاني.

النتيجة العملية: لو تسرّبت كتابة واحدة التفّت على `ledgerRepo` (سكربت ترحيل، تعديل من Console،
خطأ برمجي في مسار جديد)، **فلن يلاحظ أحد حتى يشتكي المستخدم أن الرصيد خطأ**.
التخفيف (المدقّق الشهري + `getAfter` + `deltaSumMinor`) يقلّل الاحتمال ولا يلغيه.

### 12.2 «أحادي الجانب» ليس أحادياً فعلاً

`transfer` يمسّ حسابين بمستند واحد، و `adjustment` قد يمسّ حسابين عند تصحيح حساب خاطئ،
وكل عملية مرتبطة تمسّ كياناً ثانياً (`obligation`/`debt`) وثالثاً (`budget`) ورابعاً (`rollup`).
فالمستند **أحادي الجانب في التمثيل فقط، ومتعدد الأطراف في الأثر**.
وهذا يعني أن `accountDeltas()` و `linkedEntityPatch()` و `budgetPatch()` و `rollupPatch()` صارت
**أربع دوال يجب أن تتفق**؛ أي تناقض بينها = انحراف صامت. القيد المزدوج يجعل هذا بنيةً واحدة.

### 12.3 المجمّعات تتكاثر

`accounts.balanceMinor`, `accounts.deltaSumMinor`, `obligations.paidMinor`, `obligations.remainingMinor`,
`debts.settledMinor`, `debts.remainingMinor`, `budgets.spentMinor`, `financialGoals.savedMinor`,
`rollups.*`. **تسعة أسطح انحراف**، كل واحد منها قابل لأن يختلف عن الدفتر.
`remainingMinor` تحديداً تكرار محض لـ `total − paid` خزّنتُه **فقط** لأن Firestore لا يستعلم على
تعبير محسوب. هذا دَين فني مقصود ومُعلن، لا ضرورة محاسبية.

### 12.4 الـ enum يخلط الشكل بالمعنى

«اقترضتُ مالاً» هو `type:'income'` بـ `subtype:'debtDrawdown'`. أي أن سطراً نوعه `income`
ليس دخلاً. هذا **فخ مضمون** لأي مطوّر يكتب استعلاماً مستقبلاً بـ `where('type','==','income')`
بدل `where('reportClass','==','income')`. التخفيف الوحيد: **منع `type` من الظهور في أي استعلام
تقارير** بقاعدة مراجعة، وتسمية الحقل `reportClass` بوضوح. الحل الأنظف المرفوض الآن:
توسيع الـ enum بـ `borrow`/`lend` — أوصي بإعادة النظر فيه قبل المرحلة 3 (§24.3).

### 12.5 لا رصيد تاريخي

المجمّع يعرف «الآن» فقط. سؤال «كم كان رصيدي في 15 أغسطس؟» يتطلب مسح الدفتر من البداية
أو من نقطة تحقق. ولأننا لا نخزّن `balanceAfterMinor` على كل حركة، فإن كشف الحساب يحسب
الرصيد التراكمي في العميل — وهو صحيح لكنه يعني أن **شاشة الكشف هي المكان الوحيد الذي يُحسب
فيه الرصيد مرتين بطريقتين مختلفتين**. (بدّلتُ عمداً: لم أخزّن `balanceAfterMinor` لأن أي حركة
بتاريخ ماضٍ تُبطل كل القيم التالية لها وتتطلب إعادة كتابة تسلسلية — وهي عملية O(n) هشة.)

### 12.6 الميزانيات والمجمّع الشهري يضاعفان تكلفة الكتابة

6 كتابات لمصروف واحد بدل 2. على Spark الهامش ضخم فلا ضرر، لكن لو صار النظام
متعدد المستخدمين بكثافة فإن `rollups/{periodKey}` يصير مستنداً ساخناً. **مُعزول حالياً** بنطاق
`users/{uid}` فلا تعارض بين مستخدمين، لكن مستخدماً واحداً نشطاً على جهازين يمكن أن يلامس
حد الكتابة على المستند الواحد. التخفيف المستقبلي: تجزئة المجمّع (`rollups/{period}/shards/{n}`).

### 12.7 ما الذي يبرّر اختياره رغم ذلك

| المعيار | هذا المنظور | القيد المزدوج |
|---|---|---|
| قابلية الفهم للمالك (غير محاسب) | **عالية** — مستند واحد = حدث واحد مقروء | منخفضة — كل مصروف قيدان |
| تكلفة Firestore لكل حركة | **6 كتابات** | 8–10 (قيدان + سطور) |
| تكلفة لوحة التحكم | **منخفضة** (مجمّعات جاهزة) | تتطلب نفس المجمّعات أصلاً |
| كشف الخطأ آلياً | **ضعيف** ← العيب الرئيسي | قوي |
| تعقيد الكود | **منخفض** | مرتفع |
| ملاءمة §19 حرفياً | **عالية** — القواعد مكتوبة بلغة الأحداث لا القيود | تحتاج ترجمة |
| التوسع لمتعدد العملات | ضعيف | قوي |

**الحكم:** مناسب لنطاق المشروع المعلن (مالي شخصي، مستخدم واحد، Spark، §24 بثماني مراحل)،
**بشرط** تنفيذ ثلاثة أشياء بلا تهاون: (1) مستودع كتابة وحيد `ledgerRepo`، (2) المدقّق الشهري،
(3) قواعد `getAfter` مُختبَرة في Emulator. **إن سقط أيٌّ من الثلاثة يصير هذا المنظور خطراً**،
ويصير القيد المزدوج هو الخيار الصحيح.

---

## 13. ملخّص الواجهات البرمجية للطبقة المشتركة (§25.7)

```
src/domain/                       ← خالصة، صفر استيراد من firebase
├── money/{Minor.ts, parse.ts, split.ts, format.ts}
├── types/{Account.ts, Transaction.ts, Obligation.ts, Debt.ts, Budget.ts, Goal.ts, Rollup.ts}
├── ledger/{effects.ts, reverse.ts, amend.ts, verify.ts}
├── rules/{guards.ts, status.ts, reportClass.ts}
├── recurrence/{materialize.ts, rrule.ts}
├── period/{periodKey.ts, dayKey.ts}
└── errors/{DomainError.ts, messages.ar.ts}

src/data/                         ← الطبقة الوحيدة التي تلمس Firestore
├── ledger/{postTransaction.ts, reverseTransaction.ts, amendTransaction.ts}
├── outbox/{queue.ts, flush.ts}
└── repos/{accountRepo.ts, obligationRepo.ts, debtRepo.ts, rollupRepo.ts}

src/ui/                           ← لا تحسب شيئاً، تستدعي فقط
```

**قاعدة معمارية مفروضة بأداة** (`eslint-plugin-boundaries`):
- `domain/` لا تستورد من `data/` ولا `ui/` ولا `firebase/*`.
- `ui/` لا تستورد `firebase/firestore` مباشرة.
- أي حساب مالي خارج `domain/` = خطأ بناء، لا مجرد ملاحظة مراجعة.

---

## 14. ما يجب اختباره قبل اعتماد هذا التصميم (§23)

1. `splitEven` و `allocateByWeights`: مجموع الأجزاء = الكل، على 10,000 حالة عشوائية (property test).
2. `parseMinorInput`: الأرقام العربية والفارسية، 4 خانات ⇒ رفض، الفواصل.
3. `accountDeltas`: كل `type` × `subtype`، بما فيها العكس والتحويل.
4. `deriveReportClass`: المصفوفة في §7.2 كاملة كجدول اختبار.
5. **ازدواج**: استدعاء `postTransaction` مرتين بنفس `operationId` ⇒ حركة واحدة، رصيد واحد.
6. **تزامن**: عميلان في Emulator يكتبان على نفس الحساب ⇒ الرصيد النهائي صحيح.
7. **سالب**: رصيد 100، مصروفان 60 متزامنان ⇒ أحدهما يُرفض.
8. **سداد زائد**: متبقٍّ 600، دفعتان 500 متزامنتان ⇒ الثانية تُرفض.
9. **عكس**: عكس مصروف ⇒ الرصيد والميزانية والمجمّع تعود تماماً إلى ما قبل.
10. **عكس مزدوج**: عكس نفس الحركة مرتين ⇒ أثر واحد.
11. **تكرار**: تنفيذ التكرار من جهازين ⇒ حركة واحدة لكل `occurrenceKey`.
12. **Rules في Emulator**: محاولة تغيير `balanceMinor` بلا حركة ⇒ رفض. محاولة حذف حركة ⇒ رفض.
    محاولة كتابة حركة بـ `ownerUid` مختلف ⇒ رفض.
13. **المدقّق**: زرع انحراف يدوي في Emulator ⇒ المدقّق يكتشفه ولا يصحّحه صامتاً.
14. **تطابق التقارير**: مجموع `rollup.expenseMinor` = مجموع الدفتر المستقل لنفس الفترة.

---

## 15. قرارات معمارية تحتاج توثيقاً في `docs/adr/`

| الرقم | القرار | الحالة |
|---|---|---|
| ADR-001 | الدرهم الليبي وحدة صغرى بثلاث خانات، `number` صحيح في Firestore | مقترح |
| ADR-002 | رصيد الحساب مجمّع مخزّن لا محسوب | مقترح |
| ADR-003 | معرّف المستند = `operationId` بدل مجموعة idempotency منفصلة | مقترح |
| ADR-004 | لا مجموعة `debtPayments` منفصلة (انحراف عن §18) | مقترح |
| ADR-005 | `reportClass` منفصل عن `type` لمنع تضخّم التقارير | مقترح |
| ADR-006 | التعديل = عكس + ترحيل بديل في transaction واحدة؛ لا حذف | مقترح |
| ADR-007 | العمليات المالية تتطلب اتصالاً (outbox بدل الكتابة دون اتصال) | مقترح |
| ADR-008 | `getAfter()` في Rules لربط الرصيد بالحركة — بديل Cloud Functions على Spark | مقترح، **يحتاج إثباتاً في Emulator** |
| ADR-009 | إبقاء `type` enum كما هو وإضافة `subtype` بدل `borrow`/`lend` | مقترح، **مفتوح لإعادة النظر** |
