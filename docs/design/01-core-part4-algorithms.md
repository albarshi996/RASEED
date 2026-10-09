## 12. خوارزميات كل العمليات

### 12.1 القالب الموحَّد — العقد المشترك لكل عملية

لا تُعاد كتابة هذا العقد في كل خوارزمية. كل عملية في 12.2…12.17 تُقرأ **فوق** هذا القالب،
وما لا تذكره الخوارزمية صراحةً يعني «كما في 12.1 بلا تغيير».

#### 12.1.1 السياق والنتيجة

```ts
// domain/ops/context.ts
export interface OpContext {
  readonly uid: string;
  readonly opId: string;            // = entryId للعمليات أحادية القيد (ADR-004)
  readonly payloadHash: string;     // SHA-256 لحمولة مُقنَّنة، محسوب **قبل** runTransaction
  readonly bookedAt: string;        // 'YYYY-MM-DDTHH:mm:ss+02:00' — بتوقيت ليبيا الثابت
  readonly periodKey: string;       // 'YYYY-MM' ≡ bookedAt.slice(0,7)  (ADR-008)
  readonly todayLibya: string;      // 'YYYY-MM-DD' — ليبيا UTC+2 بلا توقيت صيفي
  readonly deviceId: string;
  readonly confirmToken?: string;   // يُمرَّر لتجاوز تحذير التشابه (G11)
}

export interface OpResult {
  readonly opId: string;
  readonly entryIds: readonly string[];
  readonly alreadyApplied: boolean;             // true ⇒ لم تُكتب أي كتابة
  readonly balancesAfter: Readonly<Record<string, Minor>>;
  readonly warnings: readonly DomainWarning[];
}

export interface DomainError {
  readonly code: ErrCode;           // الجدول في 12.1.7
  readonly messageAr: string;       // عربي واضح، يُعرض كما هو (القسم 25 بند 18)
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;      // يحدّد هل يُعاد المحاولة من الطابور (12.1.8)
}

export interface DomainWarning {
  readonly code: WarnCode;
  readonly messageAr: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type OpOutcome =
  | { ok: true;  value: OpResult }
  | { ok: false; error: DomainError };
```

**مرجع الوقت — ليبيا UTC+2 ثابتة، بلا توقيت صيفي:**

```ts
// domain/time/libya.ts
export const LIBYA_OFFSET_MINUTES = 120;   // ثابت. لا DST. لا قراءة من المتصفح.

export function libyaNow(nowMs: number = Date.now()): {
  iso: string; date: string; periodKey: string;
} {
  const shifted = new Date(nowMs + LIBYA_OFFSET_MINUTES * 60_000);
  const date = shifted.toISOString().slice(0, 10);     // 'YYYY-MM-DD'
  const time = shifted.toISOString().slice(11, 19);    // 'HH:mm:ss'
  return { iso: `${date}T${time}+02:00`, date, periodKey: date.slice(0, 7) };
}

/** يُنادى في كل بناء قيد. خرقه = عيب برمجي، لا خطأ مستخدم. */
export function assertPeriodKey(bookedAt: string, periodKey: string): void {
  invariant(bookedAt.slice(0, 7) === periodKey, 'I13', { bookedAt, periodKey });
}
```

`Date.now()` لا يُنادى **داخل** `runTransaction` أبداً (دالة المعاملة تُعاد تنفيذاً عند التعارض ويجب أن تكون
نقية): كل قيم `OpContext` تُحسب مرة واحدة قبل المعاملة وتُمرَّر.

#### 12.1.2 المراحل الثلاث الإلزامية

```ts
// infra/firestore/postOperation.ts
export async function postOperation(ctx: OpContext, req: OpRequest): Promise<OpOutcome> {
  return runTransaction(db, async (tx) => {
    const snap = await readPhase(tx, ctx, req);     // كل tx.get() هنا، ولا شيء غيره
    const plan = planOperation(req, snap, ctx);     // نقية 100%، صفر استيراد firebase
    if (plan.kind === 'alreadyApplied') return okAlreadyApplied(plan);
    writePhase(tx, ctx, plan);                      // كل tx.set/update هنا
    return ok(plan.result);
  }, { maxAttempts: 5 });
}
```

ثلاثة قيود تفرضها بنية Firestore ولا نقاش فيها:

1. **لا قراءة بعد كتابة** داخل المعاملة ⇒ التقسيم أعلاه إجباري.
2. **لا استعلامات داخل المعاملة** (`tx.get` يقبل `DocumentReference` فقط) ⇒ كل معرّف مستند تلمسه
   خوارزمية مالية **حتمي**: `journalEntries/{opId}`، `postings/{entryId}__{lineNo}`،
   `accounts/{accountId}`، `accountPeriods/{accountId}__{periodKey}`،
   `obligations/{templateId}__{occurrenceKey}`، `entryCorrections/{originalEntryId}`.
3. **`runTransaction` لا يعمل دون اتصال** (ADR-007) ⇒ مسار الطابور في 12.1.8.

كل المسارات تحت `users/{uid}/…`؛ تُحذف البادئة في بقية القسم اختصاراً.

**تكلفة مخفية تُحسب مرة:** بوابة الصيانة (12.1.6 / G2) تُفرض في القواعد بـ `get()` على
`maintenance/rebuild`، وهذه **قراءة مفوترة إضافية واحدة لكل كتابة مالية**. تُقبل صراحةً لأن البديل
(بوابة في الكود وحده) لا تمنع جهازاً ثانياً من الكتابة أثناء إعادة البناء.

#### 12.1.3 حسابات النظام التي تستخدمها هذه الخوارزميات

شجرة الحسابات **ثابتة الحجم (~45 حساباً)** — وهذا شرط الحجّة الثالثة في 1.2 (ميزان المراجعة بـ ~45 قراءة).
لذلك **لا حساب لكل دائن ولا لكل مدين**: الديون تمرّ على **حسابَي ضبط (control accounts)**،
والتفصيل لكل شخص يأتي من `postings.refs.debtId` باستعلام مفهرس (ADR-005).

| المفتاح في الكود | `accountId` | `code` | `type` | `normalBalance` | `cashLike` |
|---|---|---|---|---|---|
| `SYS.OPENING_EQUITY` | `acc_eq_opening` | `equity.opening` | `equity` | `credit` | ✗ |
| `SYS.ADJUSTMENT` | `acc_eq_adjust` | `equity.adjustment` | `equity` | `credit` | ✗ |
| `SYS.DEBTS_PAYABLE` | `acc_liab_debts` | `liability.debts.control` | `liability` | `credit` | ✗ |
| `SYS.DEBTS_RECEIVABLE` | `acc_asset_recv` | `asset.receivable.control` | `asset` | `debit` | **✗** |
| `SYS.INTEREST_EXPENSE` | `acc_exp_interest` | `expense.finance.interest` | `expense` | `debit` | ✗ |
| `SYS.FEES_EXPENSE` | `acc_exp_fees` | `expense.finance.fees` | `expense` | `debit` | ✗ |
| `SYS.OTHER_INCOME` | `acc_inc_other` | `income.other` | `income` | `credit` | ✗ |

`cashLike === false` على `acc_asset_recv` هو ما يُنفِّذ القاعدة 19.9 («المبالغ المستحقة للتحصيل لا تُعرض
ضمن النقد المتاح») **بنيوياً**:

```ts
// domain/ledger/selectors.ts
export const availableCashMinor = (accs: readonly Account[]): Minor =>
  sumMinor(accs.filter(a => a.type === 'asset' && a.cashLike && a.status === 'active')
               .map(a => a.balanceMinor));
```

**الفئات حسابات، لا حقول وصفية.** `categoryId` في كل طلب هو **`accountId` لحساب من نوع `expense`**،
و`incomeSourceId` هو `accountId` لحساب من نوع `income`. هذا ما يجعل التقرير دالّة في نوع الحساب
(الحجّة الأولى في 1.2) ويجعل `where type == 'income'` مستحيلاً أن يتضخّم بأصل القرض.
`postings.categoryId` تكرار مقصود للتقارير فقط.

#### 12.1.4 صيغة الرصيد وإشارة السطر

```ts
export type Side = 'debit' | 'credit';

export const normalSideOf = (t: AccountType): Side =>
  (t === 'asset' || t === 'expense') ? 'debit' : 'credit';

/** إشارة السطر بمنظور المدين دائماً: المدين +، الدائن −. */
export const signedOf = (side: Side, amountMinor: Minor): Minor =>
  (side === 'debit' ? amountMinor : negateMinor(amountMinor)) as Minor;

/** الرصيد الظاهر للمستخدم: موجب للأصل الممتلئ، وموجب للالتزام المستحق عليه. */
export const balanceFromTotals = (a: {
  type: AccountType; debitTotalMinor: Minor; creditTotalMinor: Minor;
}): Minor => normalSideOf(a.type) === 'debit'
  ? subMinor(a.debitTotalMinor, a.creditTotalMinor)
  : subMinor(a.creditTotalMinor, a.debitTotalMinor);
```

**`debitTotalMinor` و `creditTotalMinor` إجماليات خام (gross):** تشمل قيود العكس ولا تُنقَّص منها.
`balanceMinor` يُكتب **قيمةً مطلقة محسوبة** من اللقطة المقروءة، لا بـ `increment()` — لأن ADR-022
وفحوص `getAfter()` تحتاج قيمة نهائية معروفة، ولأن القيمة المطلقة تكشف الانحراف بينما `increment` يخفيه.
`accountPeriods` وحدها تُكتب بـ `increment()` (لا تحتاج قراءة، انظر 12.1.5).

#### 12.1.5 مجموعة الكتابة المعيارية — `emitEntry`

```ts
// domain/ledger/emit.ts
export type EntryKind = 'normal' | 'reversal' | 'replacement' | 'opening' | 'adjustment';

export interface PostingRefs {
  obligationId?: string; debtId?: string; goalId?: string;
  templateId?: string; occurrenceKey?: string; contactId?: string;
}

export interface LineDraft {
  accountId: string;
  side: Side;
  amountMinor: Minor;                  // > 0 دائماً. لا سطر بمبلغ سالب في النظام كله.
  categoryId?: string | null;
  settlementDeltaMinor?: Minor;        // ADR-021 — افتراضي 0
  refs?: PostingRefs;
  memo?: string;
}

export interface EntryDraft {
  entryId: string;                     // = opId أو `${opId}__k`
  kind: EntryKind;
  bookedAt: string; periodKey: string;
  description: string;
  lines: readonly LineDraft[];         // ≥ 2
  refs: PostingRefs;                   // اتحاد مراجع السطور، للاستعلام على مستوى القيد
  reversalOf?: string;                 // على قيد العكس فقط
  replaces?: string;                   // على القيد البديل فقط
  reason?: string;                     // إلزامي لـ reversal / replacement / adjustment
  reversed: boolean;                   // يبدأ false إلا على طرفَي زوج العكس (12.11)
}
```

مستند القيد المكتوب:

```ts
// journalEntries/{entryId}
{
  entryId, ownerUid, schemaVersion: 1,
  kind, bookedAt, periodKey, description, reason: reason ?? null,
  lines: [{ lineNo, accountId, accountType, side, amountMinor, categoryId,
            settlementDeltaMinor, refs, memo }],
  debitTotalMinor, creditTotalMinor,          // متساويان — I1
  accountIds: string[], accountTypes: AccountType[],
  refs, reversalOf: reversalOf ?? null, reversedBy: null, replaces: replaces ?? null,
  reversed, status: 'posted',
  opId: ctx.opId, payloadHash: ctx.payloadHash,
  deviceId, createdAt: serverTimestamp(), clientCreatedAt: ctx.bookedAt,
}
```

مستند الترحيل المسطَّح (ADR-002) — **نسخة واحدة لكل سطر**، معرّفه حتمي:

```ts
// postings/{entryId}__{lineNo}        lineNo من 1
{
  postingId, entryId, lineNo, ownerUid, schemaVersion: 1,
  accountId, accountType, side,
  amountMinor,                          // موجب دائماً
  signedMinor,                          // = signedOf(side, amountMinor)
  bookedAt, periodKey, categoryId,
  entryKind: kind,
  reversed,                             // انظر التحذير أدناه
  settlementDeltaMinor,                 // ADR-021
  refs,
}
```

> **معنى `reversed` على `postings` بالضبط — هذا مربط الفرس:**
> `reversed === true` تعني «هذا الترحيل **خارج المجموعة الفعّالة**». تُضبط على `true` على
> **طرفَي زوج العكس معاً**: ترحيلات القيد الأصلي *وترحيلات قيد العكس نفسه*.
> السبب رياضي لا ذوقي: لو استُبعد الأصل (Dr 100) وبقي العكس (Cr 100) لأعطى المجموع `−100`.
> باستبعاد الزوج كاملاً يكون صافي أثره صفراً، فيتساوى **المجموع الخام** و**المجموع الفعّال**:
> `Σ signedMinor (الكل) === Σ signedMinor (reversed === false)` — وهذه نفسها ثابتة I17.
> ⇒ `reconcileAccount` تستخدم المجموع الخام (أرخص، بلا مرشِّح)، والتقارير تستخدم `reversed == false`.
>
> **استثناء واحد:** `settlementDeltaMinor` يُجمع **خاماً دائماً** (بما فيه ترحيلات العكس التي تحمل
> دلتا سالبة)، وإلا انكسرت I6.

`settlementDeltaMinor` **لا يُوضع إلا على سطر واحد لكل كيان مُسوَّى في القيد**، وموضعه:
سطر حساب الضبط إن كان للكيان حساب ضبط (`acc_liab_debts` / `acc_asset_recv`)، وإلا **سطر النقد**.
ويحمل ذلك السطر `refs` الكيان. فينتج ثابتان مستقلان بلا ازدواج حساب:
`Σ{refs.obligationId == O} settlementDeltaMinor === obligations/O.paidMinor` و
`Σ{refs.debtId == D} settlementDeltaMinor === debts/D.settledMinor`.

الكتابات التي يولّدها قيد بـ `n` سطراً على `m` حساباً مميَّزاً:

| # | المستند | الأسلوب | ما يُكتب |
|---|---|---|---|
| 1 | `journalEntries/{entryId}` | `tx.set` | المستند أعلاه كاملاً |
| 2…n+1 | `postings/{entryId}__{lineNo}` | `tx.set` | ترحيل لكل سطر |
| n+2…n+m+1 | `accounts/{accountId}` | `tx.update` | `debitTotalMinor`, `creditTotalMinor`, `balanceMinor` **قيماً مطلقة** + `lastEntryId`, `updatedAt` |
| …+m | `accountPeriods/{accountId}__{periodKey}` | `tx.set({merge:true})` | `increment(debitMinor)`, `increment(creditMinor)`, `accountId`, `accountType`, `periodKey`, `ownerUid` |

`accountPeriods` **لا تُقرأ أبداً**: `increment` على حقل غير موجود يُنشئه بالقيمة نفسها، و`merge:true`
يُنشئ المستند إن غاب. وهي تحفظ **الحركة فقط** (ADR-009) — لا `openingBalanceMinor` ولا
`closingBalanceMinor`، فأرصدة البداية/النهاية مشتقّة تراكمياً عند العرض.

تجميع الدلتا على الحسابات يحدث **مرة واحدة لكل عملية** (لا لكل قيد): عملية تولّد قيدين على نفس الحساب
(التعديل = عكس + بديل) تكتب مستند الحساب **كتابة واحدة بالدلتا الصافية** (ADR-006).

#### 12.1.6 سلسلة الحوارس — بهذا الترتيب حرفياً

الترتيب ليس تجميلاً: الحوارس الأرخص والأكثر حسماً أولاً، وأي حارس يفشل يُنهي العملية فوراً بلا كتابة.

| # | الحارس | المرحلة | رمز الفشل |
|---|---|---|---|
| G1 | `uid` مصادَق ويساوي المالك المعتمد (ق-2) | قبل المعاملة + القواعد | `AUTH_REQUIRED` / `NOT_OWNER` |
| G2 | بوابة الصيانة مفتوحة: `maintenance/rebuild.state !== 'running'` | القواعد (`get`) + فحص مسبق | `MAINTENANCE_RUNNING` |
| G3 | صحة الحمولة بنيوياً (Zod): كل `*Minor` **صحيح**، `0 < X ≤ MAX_ABS_MINOR`، التواريخ بالصيغة | قبل المعاملة | `AMOUNT_NOT_INTEGER` / `AMOUNT_NOT_POSITIVE` / `AMOUNT_OUT_OF_RANGE` / `BAD_DATE` |
| G4 | `bookedAt ≤ todayLibya` نهاية اليوم (لا قيد في المستقبل) | قبل المعاملة | `BOOKED_AT_FUTURE` |
| G5 | `periodKey === bookedAt.slice(0,7)` (ADR-008) | `invariant` | يرمي I13 — عيب برمجي |
| G6 | **منع الازدواج:** `journalEntries/{opId}` — غير موجود ⇒ امضِ؛ موجود و`payloadHash` مطابق ⇒ `alreadyApplied`؛ موجود ومختلف ⇒ فشل | قراءة | `OP_ID_CONFLICT` |
| G7 | كل حساب في السطور موجود، `status === 'active'`، ونوعه هو المتوقَّع للسطر | قراءة | `ACCOUNT_NOT_FOUND` / `ACCOUNT_CLOSED` / `ACCOUNT_TYPE_MISMATCH` |
| G8 | `bookedAt ≥ account.openedAt` لكل حساب في القيد | قراءة | `BOOKED_AT_BEFORE_OPENING` |
| G9 | الفترة غير مُقفلة: `periodKey ∉ settings.lockedPeriods` | قراءة | `PERIOD_LOCKED` |
| G10 | **حدّ الرصيد:** لكل حساب `asset`/`liability` متأثر: `balanceAfter ≥ minBalanceMinor` (موقَّع، افتراضي 0 — ADR-010) | حساب | `BALANCE_BELOW_MIN` |
| G11 | **منع السداد الزائد:** `paidAfter ≤ totalMinor + extraChargesMinor` (ADR-012) | حساب | `OVERPAYMENT` / `OVERCOLLECTION` |
| G12 | **توازن القيد:** `Σ debit === Σ credit` لكل قيد مولَّد | `invariant` | يرمي I1 — عيب برمجي |

حوارس تُنتج **تحذيراً لا منعاً** (تُرجَع في `warnings` ولا توقف الكتابة):

| # | الحارس | الرمز |
|---|---|---|
| W1 | `earmarkedMinor > balanceMinor` بعد العملية (ADR-017: الحجز تحذير، الرصيد منع) | `EARMARK_EXCEEDED` |
| W2 | استهلاك ميزانية الفئة بعد العملية ≥ `budgets/{pk}.alertAtBps` | `BUDGET_EXCEEDED` |
| W3 | تشابه: قيد آخر بنفس `accountId` و`amountMinor` و`categoryId` في آخر 10 دقائق ⇒ يُطلب `confirmToken` **قبل** المعاملة. بعد التأكيد يُسجَّل تحذيراً | `SIMILAR_ENTRY` |

#### 12.1.7 رموز الفشل — الجدول المرجعي

| الرمز | الرسالة العربية المعروضة | `retryable` |
|---|---|---|
| `AUTH_REQUIRED` | «يجب تسجيل الدخول لإتمام هذه العملية.» | ✗ |
| `NOT_OWNER` | «هذا الحساب غير مصرَّح له بالوصول إلى هذه البيانات.» | ✗ |
| `MAINTENANCE_RUNNING` | «جارٍ إعادة بناء البيانات. العمليات المالية متوقفة مؤقتاً.» | ✓ |
| `OFFLINE_QUEUED` | «لا يوجد اتصال. حُفظت العملية في قائمة الانتظار وستُنفَّذ عند عودة الشبكة.» | — |
| `OP_ID_CONFLICT` | «هذه العملية سُجّلت بمحتوى مختلف. لتغييرها استخدم التعديل.» | ✗ |
| `AMOUNT_NOT_POSITIVE` | «المبلغ يجب أن يكون أكبر من صفر.» | ✗ |
| `AMOUNT_NOT_INTEGER` | «المبلغ غير صالح (كسر في وحدة الدرهم).» | ✗ |
| `AMOUNT_OUT_OF_RANGE` | «المبلغ يتجاوز الحد الأقصى المسموح.» | ✗ |
| `BAD_DATE` | «التاريخ غير صالح.» | ✗ |
| `BOOKED_AT_FUTURE` | «لا يمكن تسجيل عملية بتاريخ مستقبلي.» | ✗ |
| `BOOKED_AT_BEFORE_OPENING` | «التاريخ أسبق من تاريخ فتح الحساب.» | ✗ |
| `PERIOD_LOCKED` | «شهر {periodKey} مُقفل. سجّل التصحيح في الشهر الحالي.» | ✗ |
| `ACCOUNT_NOT_FOUND` | «الحساب غير موجود.» | ✗ |
| `ACCOUNT_CLOSED` | «الحساب مغلق ولا يقبل حركات جديدة.» | ✗ |
| `ACCOUNT_TYPE_MISMATCH` | «نوع الحساب لا يناسب هذه العملية.» | ✗ |
| `SAME_ACCOUNT` | «لا يمكن التحويل من حساب إلى نفسه.» | ✗ |
| `BALANCE_BELOW_MIN` | «الرصيد لا يكفي. المتاح {available} والمطلوب {required}.» | ✗ |
| `OBLIGATION_NOT_FOUND` | «الالتزام غير موجود.» | ✗ |
| `OBLIGATION_CANCELLED` | «الالتزام ملغى ولا يقبل دفعات.» | ✗ |
| `OBLIGATION_IS_TEMPLATE` | «لا يمكن الدفع على قالب التكرار؛ اختر استحقاقاً محدداً.» | ✗ |
| `OVERPAYMENT` | «المبلغ يتجاوز المتبقي. المتبقي {remaining}.» | ✗ |
| `DEBT_NOT_FOUND` | «الدين غير موجود.» | ✗ |
| `DEBT_CLOSED` | «هذا الدين مُسدَّد بالكامل.» | ✗ |
| `OVERCOLLECTION` | «المبلغ المحصَّل يتجاوز المتبقي. المتبقي {remaining}.» | ✗ |
| `ENTRY_NOT_FOUND` | «العملية غير موجودة.» | ✗ |
| `ENTRY_NOT_POSTED` | «لا يمكن تعديل عملية غير مرحَّلة.» | ✗ |
| `ENTRY_ALREADY_REVERSED` | «هذه العملية ملغاة مسبقاً.» | ✗ |
| `ENTRY_IS_REVERSAL` | «لا يمكن إلغاء قيد إلغاء.» | ✗ |
| `AMEND_CONFLICT` | «عُدِّلت هذه العملية من جهاز آخر. أعد تحميلها ثم حاول.» | ✓ |
| `AMEND_NO_CHANGE` | «لا يوجد تغيير محاسبي لتسجيله.» | ✗ |
| `REASON_REQUIRED` | «السبب مطلوب لهذه العملية.» | ✗ |
| `ACCOUNT_NOT_EMPTY` | «لا يمكن إغلاق حساب رصيده {balance}. حوّل الرصيد أولاً.» | ✗ |
| `ACCOUNT_HAS_EARMARK` | «الحساب يحمل مبالغ محجوزة لأهداف. ألغِ الحجز أولاً.» | ✗ |
| `ACCOUNT_HAS_PENDING` | «هناك عمليات بانتظار المزامنة على هذا الحساب.» | ✓ |
| `OPENING_ALREADY_EXISTS` | «للحساب رصيد افتتاحي مسجَّل مسبقاً.» | ✗ |
| `TEMPLATE_PAUSED` | «قالب التكرار موقوف مؤقتاً.» | ✗ |
| `REBUILD_TOKEN_LOST` | «تولّى جهاز آخر عملية إعادة البناء.» | ✗ |
| `LEDGER_IMBALANCE` | «خلل في سلامة الدفتر. تم إيقاف العملية وتسجيل تقرير.» | ✗ |

`retryable === true` فقط تُعاد محاولتها من الطابور؛ البقية تُنقل إلى `failedPermanent` وتُعرض للمستخدم.

#### 12.1.8 الطابور — `pendingCommands` (ADR-007)

`runTransaction` لا يعمل دون اتصال، و`setDoc` يُطابَر محلياً. فكل عملية مُحوِّلة تمرّ بهذا المسار:

```ts
// data/queue/pendingCommands.ts
// pendingCommands/{opId}
export interface PendingCommand {
  opId: string; ownerUid: string; schemaVersion: 1;
  kind: OpKind;
  payload: unknown;                       // الطلب كما هو
  payloadHash: string;
  enqueuedAtClient: string;               // ISO ليبيا — للترتيب
  attempts: number;
  state: 'queued' | 'inFlight' | 'failedPermanent';
  lastError: { code: ErrCode; messageAr: string; at: string } | null;
}

export async function submit(ctx: OpContext, req: OpRequest): Promise<OpOutcome> {
  await setDoc(doc(db, pendingPath(ctx.uid, ctx.opId)), toPending(ctx, req));  // يعمل دون اتصال
  if (!navigator.onLine) return err('OFFLINE_QUEUED');
  return drainOne(ctx.opId);
}
```

قواعد الطابور:

1. العملية تدخل الطابور **قبل** أي محاولة ترحيل، متصلاً كان الجهاز أو لا.
2. المصرِّف (drainer) يعمل **تسلسلياً، واحدة في كل مرة**، بترتيب `enqueuedAtClient`.
   السبب: «حوّل ثم اسدد من نفس الحساب» قد يفشل الثاني على G10 إن انعكس الترتيب.
3. النجاح أو `alreadyApplied` ⇒ `deleteDoc(pendingCommands/{opId})`. نفس `opId` يُعاد إرساله
   فيُسقطه G6 ⇒ **مرة واحدة بالضبط** في كل الحالات.
4. إعادة المحاولة بتباطؤ أُسّي 1s, 2s, 4s… بسقف 5 دقائق، + محاولة فورية على حدث `online`.
5. **العمليات في الطابور لا تدخل أي رصيد ولا أي تقرير** (ثابتة I14). تُعرض بوسم
   «بانتظار المزامنة» بمعاملة بصرية مختلفة تماماً. لا «رصيد متوقّع» مخلوط بالرصيد الحقيقي.

#### 12.1.9 ما **لا** تكتبه أي خوارزمية في هذا القسم

| ما لا يُكتب | البديل المعتمد |
|---|---|
| عدّاد استهلاك ميزانية على `budgets` | `getAggregateFromServer(sum('signedMinor'))` على `postings` بمرشّح `accountType=='expense' && periodKey==pk && categoryId==c && reversed==false` (ADR-016). المستند `budgets/{periodKey}` يحمل **السقوف فقط**، لا المصروف الفعلي |
| عدّاد قيود/مبالغ عام | بصمة الدفتر عند الطلب (ADR-016) |
| قيد استحقاق عند إنشاء التزام | لا شيء. الالتزام كيان مرافق خارج الدفتر حتى الدفع (1.3، البديل المرفوض الثالث) |
| `status` محسوبة للاستحقاقات في كتابة دورية | تُشتق عند القراءة من `(dueDate, paidMinor, totalMinor, cancelledAt, todayLibya)` |
| `openingBalanceMinor`/`closingBalanceMinor` على `accountPeriods` | مشتقّة تراكمياً (ADR-009) |

---

### 12.2 `recordExpense` — تسجيل مصروف

```ts
export interface RecordExpenseReq {
  type: 'recordExpense';
  opId: string;
  accountId: string;                       // asset، cashLike عادةً
  bookedAt: string;
  description: string;
  amountMinor: Minor;                      // > 0 — يُتجاهل إن وُجد splits
  categoryId: string;                      // accountId لحساب expense — يُتجاهل إن وُجد splits
  splits?: ReadonlyArray<{ categoryId: string; weight: number }>;  // توزيع بالأوزان
  payeeContactId?: string;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'wallet' | 'other';
  isHousehold?: boolean;                   // عرض فقط (القسم 11): لا يكرّر القيمة
  notes?: string;
  confirmToken?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3 (بلا تقسيم) / `2 + k` (مع `k` فئة). الكتابات: 7 / `3 + 2(k+1)`.**

```
READ PHASE
  R1 journalEntries/{opId}
  R2 accounts/{accountId}
  R3..R(2+k) accounts/{each categoryId}            // k = splits?.length ?? 1

GUARDS (بالترتيب)
  G3  amountMinor صحيح و 0 < X ≤ MAX_ABS_MINOR ؛ splits: كل weight صحيح > 0
  G4  bookedAt ≤ todayLibya
  G5  assertPeriodKey(bookedAt, periodKey)
  G6  R1 موجود؟ hash مطابق ⇒ alreadyApplied | مختلف ⇒ OP_ID_CONFLICT
  G7  R2.type === 'asset' و status 'active' وإلا ACCOUNT_TYPE_MISMATCH / ACCOUNT_CLOSED
      كل فئة: type === 'expense' وإلا ACCOUNT_TYPE_MISMATCH
  G8  bookedAt ≥ R2.openedAt
  G9  periodKey غير مُقفل
  G10 balanceAfter = R2.balanceMinor − X ؛ balanceAfter ≥ R2.minBalanceMinor
      وإلا BALANCE_BELOW_MIN { available: R2.balanceMinor − R2.minBalanceMinor, required: X }
  G12 invariant(Σ debit === Σ credit)
  W1(تحذير) R2.earmarkedMinor > balanceAfter ⇒ EARMARK_EXCEEDED
  W2(تحذير) نسبة الميزانية بعد العملية (من lastKnownBudgetUse المُمرَّر في ctx) ⇒ BUDGET_EXCEEDED

COMPUTE
  parts = splits ? allocateByWeights(X, splits.map(s => s.weight)) : [X]
  invariant(sumMinor(parts) === X, 'I24')                        // لا وحدة ضائعة
  lines =
    parts.map((p, i) => ({ accountId: cat[i], side:'debit',  amountMinor:p, categoryId:cat[i] }))
    .concat([{ accountId, side:'credit', amountMinor:X, categoryId:null }])

WRITE PHASE
  W1 set journalEntries/{opId}             kind:'normal', lines, debitTotalMinor:X, creditTotalMinor:X
  W2 set postings/{opId}__1 … __(k+1)      ترحيل لكل سطر
  W3 update accounts/{accountId}           creditTotalMinor += X ، balanceMinor = balanceAfter (مطلق)
  W4 update accounts/{cat_i}               debitTotalMinor += p_i ، balanceMinor = مطلق
  W5 set   accountPeriods/{accountId}__{pk}  increment(creditMinor, X)
  W6 set   accountPeriods/{cat_i}__{pk}      increment(debitMinor, p_i)
```

**مثال بأرقام حقيقية** — مصروف 25.500 د.ل على «الطعام» من النقد، `pk = '2026-10'`:

| السطر | الحساب | الجانب | المبلغ (درهم) |
|---|---|---|---|
| 1 | `acc_exp_food` | `Dr` | 25500 |
| 2 | `acc_cash_main` | `Cr` | 25500 |

الرصيد قبل 340000 ⇒ بعد 314500. `accountPeriods/acc_cash_main__2026-10.creditMinor += 25500`.

**الفشل:** `AMOUNT_NOT_POSITIVE`, `AMOUNT_NOT_INTEGER`, `AMOUNT_OUT_OF_RANGE`, `BOOKED_AT_FUTURE`,
`OP_ID_CONFLICT`, `ACCOUNT_NOT_FOUND`, `ACCOUNT_CLOSED`, `ACCOUNT_TYPE_MISMATCH`,
`BOOKED_AT_BEFORE_OPENING`, `PERIOD_LOCKED`, `BALANCE_BELOW_MIN`.

**`isHousehold` لا يولّد سطراً ولا قيداً ثانياً** — وهذا ما يُنفِّذ القسم 11 («تظهر مصاريف المنزل في
التقارير العامة دون تكرار قيمتها»): وسم على القيد، ومرشِّح في الاستعلام، لا قيمة مكرَّرة.

---

### 12.3 `recordIncome` — تسجيل دخل مستلم

```ts
export interface RecordIncomeReq {
  type: 'recordIncome';
  opId: string;
  accountId: string;                 // asset المستلِم
  incomeSourceId: string;            // accountId لحساب income
  amountMinor: Minor;
  bookedAt: string;
  description: string;
  payerContactId?: string;
  notes?: string;
  confirmToken?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3. الكتابات: 7.**

```
READ   R1 journalEntries/{opId}  R2 accounts/{accountId}  R3 accounts/{incomeSourceId}
GUARDS G3 G4 G5 G6 G7(R2.type==='asset'، R3.type==='income') G8 G9 G12
       G10 **لا يُطبَّق**: الدخل يرفع الرصيد فلا يمكن أن يخرقه
LINES  1) Dr accounts/{accountId}      X
       2) Cr accounts/{incomeSourceId} X
WRITES W1 journalEntries/{opId} · W2 postings __1,__2 · W3 accounts×2 (مطلق)
       W4 accountPeriods×2 (increment)
FAIL   AMOUNT_* · BOOKED_AT_FUTURE · OP_ID_CONFLICT · ACCOUNT_* · PERIOD_LOCKED
```

**الدخل المتوقَّع لا يمرّ من هنا إطلاقاً.** القسم 7 يقول نصّاً: «لا تُضاف المبالغ المتوقعة إلى الرصيد
المتاح قبل تسجيل استلامها». التوقّع يُمثَّل كقالب تكرار (12.13) يولّد **استحقاق دخل** غير مرحَّل،
و`recordIncome` هي **فعل التأكيد** الذي يُنشئ القيد — بـ `opId = \`inc:${templateId}:${occurrenceKey}\``
ليستحيل تسجيل نفس الراتب مرتين.

---

### 12.4 `transfer` — تحويل بين حسابين

```ts
export interface TransferReq {
  type: 'transfer';
  opId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: Minor;                // المبلغ الواصل إلى الوجهة
  feeMinor?: Minor;                  // ≥ 0، يُخصم من المصدر زيادةً على amountMinor
  bookedAt: string;
  description: string;
  notes?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3 (بلا عمولة) / 4 (بعمولة). الكتابات: 7 / 10.**

```
READ   R1 journalEntries/{opId} · R2 accounts/{from} · R3 accounts/{to}
       R4 accounts/acc_exp_fees            (فقط إن feeMinor > 0)
GUARDS G3 (X>0، fee≥0) ؛ fromAccountId !== toAccountId وإلا SAME_ACCOUNT
       G4 G5 G6
       G7 كلاهما type ∈ {'asset','liability'} و status 'active'
       G8 G9
       G10 **على المصدر فقط**: R2.balanceMinor − (X + fee) ≥ R2.minBalanceMinor
       G12
LINES  1) Dr accounts/{to}         X
       2) Dr acc_exp_fees          fee          (يُحذف السطر إن fee === 0)
       3) Cr accounts/{from}       X + fee
WRITES قيد واحد + 2 أو 3 ترحيلات + 2 أو 3 حسابات (مطلق) + 2 أو 3 accountPeriods
FAIL   SAME_ACCOUNT · BALANCE_BELOW_MIN · ACCOUNT_* · PERIOD_LOCKED · OP_ID_CONFLICT · AMOUNT_*
```

**مثال:** تحويل 200.000 د.ل من المصرف إلى النقد بعمولة 1.500 د.ل:

| السطر | الحساب | الجانب | المبلغ |
|---|---|---|---|
| 1 | `acc_cash_main` | `Dr` | 200000 |
| 2 | `acc_exp_fees` | `Dr` | 1500 |
| 3 | `acc_bank_jm` | `Cr` | 201500 |

الثابت I18 (التحويل لا يغيّر Σ أرصدة الأصول) **يصدق هنا بدقة** لأن 1500 خرجت إلى حساب `expense`:
فَرْق Σ الأصول = `+200000 − 201500 = −1500` = قيمة العمولة، وهي مصروف حقيقي لا تحويل.
صيغة I18 لذلك: `ΔΣ asset === −Σ(سطور المصروف في القيد)`.

**لا يوجد في هذا القيد أي حساب `income` ولا `expense` من فئة تشغيلية** — فيستحيل بنيوياً أن يتضخّم
الدخل أو المصروف بالتحويلات (القاعدة 19.11).

---

### 12.5 `borrowMoney` — اقتراض (دين عليّ)

```ts
export type BorrowProceeds =
  | { kind: 'cash';    accountId: string }                 // استلمت نقداً
  | { kind: 'expense'; categoryId: string }                // شراء بالأجل، لا نقد
  ;

export interface BorrowMoneyReq {
  type: 'borrowMoney';
  opId: string;
  debtId: string;                    // حتمي: `debt:${opId}`
  creditorName: string;
  contactId?: string;
  principalMinor: Minor;             // أصل الدين
  proceeds: BorrowProceeds;
  bookedAt: string;
  expectedSettleDate?: string;       // 'YYYY-MM-DD'
  installmentPlan?: InstallmentPlanInput;
  description: string;
  notes?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3. الكتابات: 8.**

```
READ   R1 journalEntries/{opId}
       R2 accounts/acc_liab_debts
       R3 accounts/{proceeds.accountId أو proceeds.categoryId}
GUARDS G3 (principalMinor > 0) G4 G5 G6
       G7 R3.type === 'asset' إن kind==='cash' وإلا 'expense'
       G8 G9
       G10 **لا يُطبَّق على المصدر** (لا خروج نقد)؛ يُطبَّق على acc_liab_debts فقط إن له minBalanceMinor
       G12
LINES  kind === 'cash':
         1) Dr accounts/{accountId}   P                      refs:{}                     settlementDelta: 0
         2) Cr acc_liab_debts         P    refs:{debtId}      settlementDeltaMinor: 0     ← نشأة لا تسوية
       kind === 'expense':
         1) Dr accounts/{categoryId}  P    categoryId
         2) Cr acc_liab_debts         P    refs:{debtId}      settlementDeltaMinor: 0
WRITES W1 journalEntries/{opId}
       W2 postings __1,__2
       W3 accounts/acc_liab_debts (مطلق: creditTotal += P)
       W4 accounts/{R3} (مطلق)
       W5 accountPeriods ×2 (increment)
       W6 set debts/{debtId}:
            { debtId, ownerUid, schemaVersion:1, direction:'payable',
              creditorName, contactId: contactId ?? null,
              totalMinor: P, extraChargesMinor: 0, settledMinor: 0,
              openedAt: bookedAt, expectedSettleDate: expectedSettleDate ?? null,
              installments: installmentPlan ? buildInstallmentPlan(installmentPlan) : [],
              originEntryId: opId, status:'open', closedAt: null }
FAIL   AMOUNT_* · ACCOUNT_* · PERIOD_LOCKED · OP_ID_CONFLICT · BOOKED_AT_*
```

`remainingMinor` **لا يُخزَّن**: مشتق دائماً من `totalMinor + extraChargesMinor − settledMinor`
(ثابتة I27) — حقل مخزَّن ثالث لمعلومة مشتقة هو مصدر انحراف بلا مقابل.

**الاقتراض لا يغيّر صافي الثروة** (ثابتة I19): الأصل زاد `P` والالتزام زاد `P`.
وفي حالة `kind === 'expense'` صافي الثروة **ينقص** `P` لأن مصروفاً حقيقياً وقع — وذلك صحيح،
وصيغة I19 تُصاغ لذلك على فرع `cash` فقط.
وفي الحالتين **لا سطر على أي حساب `income`** ⇒ القرض المستلم لا يظهر دخلاً أبداً (القاعدة 19.11
والحجّة الأولى في 1.2).

---

### 12.6 `lendMoney` — إقراض (دين لي)

```ts
export interface LendMoneyReq {
  type: 'lendMoney';
  opId: string;
  debtId: string;                    // `debt:${opId}`
  debtorName: string;
  contactId?: string;
  phone?: string;
  principalMinor: Minor;
  fromAccountId: string;             // asset — المال يخرج فعلاً
  bookedAt: string;
  expectedCollectDate?: string;
  description: string;
  notes?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3. الكتابات: 8.**

```
READ   R1 journalEntries/{opId} · R2 accounts/{fromAccountId} · R3 accounts/acc_asset_recv
GUARDS G3 G4 G5 G6 G7 (R2.type==='asset' و cashLike) G8 G9
       G10 R2.balanceMinor − P ≥ R2.minBalanceMinor
       G12
LINES  1) Dr acc_asset_recv       P    refs:{debtId}   settlementDeltaMinor: 0
       2) Cr accounts/{from}      P
WRITES قيد + 2 ترحيلات + 2 حسابات + 2 accountPeriods + set debts/{debtId}
       { direction:'receivable', debtorName, phone, totalMinor:P, extraChargesMinor:0,
         settledMinor:0, openedAt:bookedAt, expectedCollectDate, originEntryId:opId,
         followUps:[], status:'open' }
FAIL   BALANCE_BELOW_MIN · ACCOUNT_* · AMOUNT_* · PERIOD_LOCKED · OP_ID_CONFLICT
```

`acc_asset_recv.cashLike === false` ⇒ المبلغ **خرج من النقد المتاح** وبقي داخل إجمالي الأصول.
فصافي الثروة لم يتغيّر (I19) لكن «الأموال المتاحة» في لوحة التحكم نقصت — وهو عين ما يطلبه القسم 10.
وليس هناك سطر `expense` ⇒ الإقراض ليس مصروفاً.

---

### 12.7 `payObligation` — سداد التزام (جزئي أو كامل)

```ts
export interface PayObligationReq {
  type: 'payObligation';
  opId: string;
  obligationId: string;              // استحقاق محدَّد، لا قالب
  fromAccountId: string;
  amountMinor: Minor;                // الأصل المسدَّد من totalMinor
  extraChargeMinor?: Minor;          // غرامة/فائدة/فرق فاتورة — ADR-012
  bookedAt: string;
  description?: string;
  notes?: string;
}
```

**الأداة: `runTransaction`. القراءات: 4 (أو 5 عند `nature==='financing'` مع دين مرتبط). الكتابات: 8…12.**

```
READ   R1 journalEntries/{opId}
       R2 obligations/{obligationId}
       R3 accounts/{fromAccountId}
       R4 accounts/{R2.nature === 'expense' ? R2.categoryId : 'acc_liab_debts'}
       R5 accounts/acc_exp_interest            (فقط إن extraChargeMinor > 0)
       R6 debts/{R2.debtId}                    (فقط إن nature==='financing' && R2.debtId)

GUARDS
  G3  amountMinor > 0 صحيح ؛ extraChargeMinor ≥ 0 صحيح
  G4 G5 G6
  G7a R2 موجود وإلا OBLIGATION_NOT_FOUND
  G7b R2.isTemplate !== true وإلا OBLIGATION_IS_TEMPLATE      ← يُدفع على الاستحقاق لا القالب
  G7c R2.cancelledAt === null وإلا OBLIGATION_CANCELLED
  G7d R3.type === 'asset' و 'active'
  G8 G9
  G11 **منع الزائد (ADR-012):**
        charges  = R2.extraChargesMinor + (extraChargeMinor ?? 0)
        paidAfter = R2.paidMinor + amountMinor + (extraChargeMinor ?? 0)
        ceiling   = R2.totalMinor + charges
        paidAfter ≤ ceiling وإلا OVERPAYMENT { remaining: ceiling − R2.paidMinor }
        **`totalMinor` لا يُرفع أبداً** — الزيادة تذهب إلى extraChargesMinor حصراً
  G10 cash = amountMinor + (extraChargeMinor ?? 0)
      R3.balanceMinor − cash ≥ R3.minBalanceMinor
  G12

LINES  nature === 'expense':
  1) Dr accounts/{R2.categoryId}  amountMinor      categoryId: R2.categoryId
  2) Dr acc_exp_interest          extraCharge      (يُحذف إن 0)
  3) Cr accounts/{from}           cash             refs:{obligationId}
                                                   settlementDeltaMinor: +cash

       nature === 'financing':   (ADR-011 — القسط ليس مصروفاً)
  1) Dr acc_liab_debts            amountMinor      refs:{debtId: R2.debtId}
                                                   settlementDeltaMinor: +amountMinor
  2) Dr acc_exp_interest          extraCharge      (الفائدة وحدها مصروف)
  3) Cr accounts/{from}           cash             refs:{obligationId}
                                                   settlementDeltaMinor: +cash

WRITES
  W1 set journalEntries/{opId}
  W2 set postings __1..__3
  W3 update accounts/{from} (مطلق)
  W4 update accounts/{R4} (مطلق)
  W5 update accounts/acc_exp_interest (مطلق، إن وُجد سطر)
  W6 set accountPeriods × 2..3 (increment)
  W7 update obligations/{obligationId}:
       paidMinor: paidAfter, extraChargesMinor: charges,
       lastPaymentEntryId: opId, lastPaymentAt: bookedAt, updatedAt: serverTimestamp()
       // **لا status مكتوبة**: مشتقّة عند القراءة. و**لا totalMinor تُلمس**.
  W8 update debts/{R2.debtId} (financing فقط): settledMinor += amountMinor

FAIL   OBLIGATION_NOT_FOUND · OBLIGATION_IS_TEMPLATE · OBLIGATION_CANCELLED · OVERPAYMENT
       BALANCE_BELOW_MIN · ACCOUNT_* · PERIOD_LOCKED · OP_ID_CONFLICT · AMOUNT_*
```

**لاحظ موضع `settlementDeltaMinor` في فرع `financing`:** سطر الضبط يحمل `refs.debtId` ودلتا الأصل،
وسطر النقد يحمل `refs.obligationId` ودلتا النقد الكامل. كل سطر يحمل **مرجع تسوية واحداً فقط**
⇒ `Σ{debtId}` = الأصل (= `debts.settledMinor`) و`Σ{obligationId}` = الكلي (= `obligations.paidMinor`)
**بلا ازدواج حساب** (I6 و I28).

**مثال:** إيجار 400.000، سُدِّد 250.000 مع غرامة تأخير 7.500 من المصرف:

| السطر | الحساب | الجانب | المبلغ | `settlementDeltaMinor` | `refs` |
|---|---|---|---|---|---|
| 1 | `acc_exp_rent` | `Dr` | 250000 | 0 | — |
| 2 | `acc_exp_interest` | `Dr` | 7500 | 0 | — |
| 3 | `acc_bank_jm` | `Cr` | 257500 | **+257500** | `{obligationId}` |

بعدها: `paidMinor = 257500`، `extraChargesMinor = 7500`، `totalMinor = 400000` (لم تُلمس)،
`remaining = 400000 + 7500 − 257500 = 150000`. والسقف في G11 لدفعة لاحقة = `407500`.

---

### 12.8 `payDebt` — سداد دين عليّ (بلا التزام وسيط)

```ts
export interface PayDebtReq {
  type: 'payDebt';
  opId: string;
  debtId: string;
  fromAccountId: string;
  principalMinor: Minor;             // ينقص من الدين
  interestMinor?: Minor;             // مصروف تمويل، لا ينقص الدين
  bookedAt: string;
  description?: string;
  installmentIndex?: number;         // إن كان من جدول أقساط
}
```

**الأداة: `runTransaction`. القراءات: 4 (أو 5 بفائدة). الكتابات: 8…11.**

```
READ   R1 journalEntries/{opId} · R2 debts/{debtId} · R3 accounts/{from}
       R4 accounts/acc_liab_debts · R5 accounts/acc_exp_interest (إن interest>0)
GUARDS G3 G4 G5 G6
       G7a R2 موجود وإلا DEBT_NOT_FOUND ؛ R2.direction === 'payable' وإلا ACCOUNT_TYPE_MISMATCH
       G7b R2.status !== 'closed' وإلا DEBT_CLOSED
       G7c R3.type === 'asset' و 'active'
       G8 G9
       G11 settledAfter = R2.settledMinor + principalMinor
           ceiling = R2.totalMinor + R2.extraChargesMinor
           settledAfter ≤ ceiling وإلا OVERPAYMENT { remaining: ceiling − R2.settledMinor }
       G10 cash = principalMinor + (interestMinor ?? 0) ؛ R3.balanceMinor − cash ≥ minBalanceMinor
       G12
LINES  1) Dr acc_liab_debts     principalMinor   refs:{debtId, installmentIndex}
                                                 settlementDeltaMinor: +principalMinor
       2) Dr acc_exp_interest   interestMinor    (يُحذف إن 0)
       3) Cr accounts/{from}    cash
WRITES قيد + 2..3 ترحيلات + 2..3 حسابات + 2..3 accountPeriods
       update debts/{debtId}: settledMinor: settledAfter, lastPaymentEntryId: opId,
         installments[installmentIndex].paidMinor += principalMinor (إن مُرَّر),
         status: settledAfter === ceiling ? 'closed' : 'open',
         closedAt: settledAfter === ceiling ? bookedAt : null
FAIL   DEBT_NOT_FOUND · DEBT_CLOSED · OVERPAYMENT · BALANCE_BELOW_MIN · ACCOUNT_* · PERIOD_LOCKED
```

`status` **تُخزَّن هنا** على `debts` (بخلاف الاستحقاقات) لأن قوائم «الديون المفتوحة» تحتاج استعلاماً
مفهرساً، و`closed` تُشتق من مقارنة مبلغين داخل نفس المعاملة التي تغيّرهما ⇒ لا انحراف ممكن.

---

### 12.9 `collectDebt` — تحصيل دين لي

```ts
export interface CollectDebtReq {
  type: 'collectDebt';
  opId: string;
  debtId: string;
  toAccountId: string;
  principalMinor: Minor;
  lateFeeMinor?: Minor;              // رسم تأخير محصَّل = دخل
  bookedAt: string;
  description?: string;
}
```

**الأداة: `runTransaction`. القراءات: 4 (أو 5 برسم). الكتابات: 8…11.**

```
READ   R1 journalEntries/{opId} · R2 debts/{debtId} · R3 accounts/{to}
       R4 accounts/acc_asset_recv · R5 accounts/acc_inc_other (إن lateFee>0)
GUARDS G3 G4 G5 G6
       G7 R2.direction === 'receivable' ؛ R2.status !== 'closed' وإلا DEBT_CLOSED
          R3.type === 'asset' و 'active'
       G8 G9
       G11 collectedAfter = R2.settledMinor + principalMinor ≤ R2.totalMinor + R2.extraChargesMinor
           وإلا OVERCOLLECTION { remaining: … }
       G10 **لا يُطبَّق على الوجهة** (الرصيد يزيد). يُطبَّق على acc_asset_recv:
           balanceAfter(recv) = balance − principalMinor ≥ minBalanceMinor(= 0)
           ⇒ حارس بنيوي ثانٍ ضد التحصيل الزائد
       G12
LINES  1) Dr accounts/{to}        principal + lateFee
       2) Cr acc_asset_recv       principalMinor   refs:{debtId}  settlementDeltaMinor: +principalMinor
       3) Cr acc_inc_other        lateFeeMinor     (يُحذف إن 0 — رسم محصَّل دخل حقيقي)
WRITES قيد + 2..3 ترحيلات + 2..3 حسابات + 2..3 accountPeriods
       update debts/{debtId}: settledMinor, lastCollectionEntryId, status/closedAt
FAIL   DEBT_NOT_FOUND · DEBT_CLOSED · OVERCOLLECTION · ACCOUNT_* · PERIOD_LOCKED · AMOUNT_*
```

`G10` على حساب الضبط هو حماية مزدوجة: حتى لو انحرف `debts.settledMinor` (مثلاً بعد ترحيل قديم)
فإن حساب المدينين لا يمكن أن يصبح سالباً ⇒ يستحيل تحصيل أكثر مما أُقرض إجمالاً.

---

### 12.10 `adjustBalance` — تسوية رصيد

```ts
export interface AdjustBalanceReq {
  type: 'adjustBalance';
  opId: string;
  accountId: string;
  targetBalanceMinor: Minor;         // الرصيد الصحيح كما جرده المستخدم (قد يكون سالباً للالتزام)
  reason: string;                    // إلزامي، غير فارغ بعد trim
  bookedAt: string;
  evidenceNote?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3. الكتابات: 8.**

```
READ   R1 journalEntries/{opId} · R2 accounts/{accountId} · R3 accounts/acc_eq_adjust
GUARDS G3 (targetBalanceMinor صحيح، |x| ≤ MAX_ABS_MINOR)
       reason.trim().length > 0 وإلا REASON_REQUIRED
       G4 G5 G6 G7 (R2 'active') G8 G9
       delta = targetBalanceMinor − R2.balanceMinor
       delta === 0 ⇒ AMEND_NO_CHANGE  (لا قيد بصفر)
       G10 **لا يُطبَّق**: التسوية هي تصحيح الرصيد نفسه، وفرضه عليها يجعل تصحيح
           رصيد سالب خاطئ مستحيلاً. البديل: تحذير W4 إن targetBalanceMinor < minBalanceMinor
       G12
COMPUTE  side = normalSideOf(R2.type) === 'debit'
           ? (delta > 0 ? 'debit' : 'credit')
           : (delta > 0 ? 'credit' : 'debit')
         amt = Math.abs(delta)
LINES  1) على accounts/{accountId}  side,            amt
       2) على acc_eq_adjust         الجانب المقابل,  amt
WRITES قيد kind:'adjustment' + reason + 2 ترحيلات + 2 حسابات + 2 accountPeriods
       + set auditLogs/{opId}:
         { opId, kind:'adjustBalance', accountId, beforeMinor: R2.balanceMinor,
           afterMinor: targetBalanceMinor, deltaMinor: delta, reason, evidenceNote,
           entryId: opId, deviceId, at: serverTimestamp(), ownerUid }
FAIL   REASON_REQUIRED · AMEND_NO_CHANGE · ACCOUNT_* · PERIOD_LOCKED · AMOUNT_* · OP_ID_CONFLICT
```

**لماذا الطرف المقابل `equity` وليس دخلاً/مصروفاً:** فروق الجرد ليست نشاطاً تشغيلياً، ووضعها على
`income`/`expense` يلوّث «مصروفات الشهر» و«دخل الشهر» برقم ليس مصروفاً ولا دخلاً — وهو ما ترفضه
القاعدة 19.11. بوضعها على `acc_eq_adjust` (حقوق ملكية) تبقى **داخل ميزان المراجعة** (I2 يصدق)
وتظهر في تقرير مخصّص «سجل التسويات» من `where kind == 'adjustment'`، ولا تدخل أي تقرير تشغيلي.

وهذا يُنفِّذ القسم 5 نصّاً: «لا يُسمح بتعديل الرصيد الحالي يدوياً دون تسجيل عملية تسوية واضحة ومبررة» —
فلا يوجد في النظام **أي** مسار يكتب `accounts.balanceMinor` دون قيد، إلا 12.14 و12.15 (وكلتاهما
تُعيد حساب القيمة من الدفتر نفسه ولا تخترع رقماً).

---

### 12.11 `voidEntry` — إلغاء قيد (عكس)

```ts
export interface VoidEntryReq {
  type: 'voidEntry';
  opId: string;                      // **حتمي**: `rev:${originalEntryId}` ⇒ لا عكس مزدوج ممكن
  originalEntryId: string;
  reason: string;                    // إلزامي
}
```

**الأداة: `runTransaction`. القراءات: `3 + m` (`m` = حسابات القيد الأصلي، عادة 2) + 1 عند وجود كيان
مرافق. الكتابات: `4 + 2n + 2m` + 1..2 (عادة **12** لقيد بسطرين).**

```
READ
  R1 journalEntries/{opId}                 // رمز العكس الحتمي — منع الازدواج
  R2 journalEntries/{originalEntryId}
  R3 settings/periods                      // الفترات المُقفلة
  R4..R(3+m) accounts/{each in R2.accountIds}
  R+ obligations/{R2.refs.obligationId} أو debts/{R2.refs.debtId}   إن وُجد

GUARDS
  G3  reason غير فارغ وإلا REASON_REQUIRED
  G6  R1 موجود ⇒ alreadyApplied (العكس تمّ) — **لا OP_ID_CONFLICT هنا لأن الحمولة حتمية**
  G7a R2 موجود وإلا ENTRY_NOT_FOUND
  G7b R2.status === 'posted' وإلا ENTRY_NOT_POSTED
  G7c R2.reversed === false وإلا ENTRY_ALREADY_REVERSED
  G7d R2.kind !== 'reversal' وإلا ENTRY_IS_REVERSAL
  G9  **سياسة التاريخ** (قرار صريح):
        فترة R2.periodKey غير مُقفلة ⇒ revBookedAt = R2.bookedAt   (الشهر يعود إلى صحته)
        فترة R2.periodKey مُقفلة      ⇒ revBookedAt = ctx.bookedAt  (لا تغيير بأثر رجعي لتقرير سُلِّم)
        revPeriodKey = revBookedAt.slice(0,7) ؛ وإن كانت هذه أيضاً مُقفلة ⇒ PERIOD_LOCKED
  G7e كل حساب في R2 موجود؛ **`ACCOUNT_CLOSED` لا يمنع العكس** (إلغاء خطأ على حساب أُغلق لاحقاً
      يجب أن يبقى ممكناً) — يُرفع تحذير فقط
  G10 يُطبَّق على كل حساب asset/liability بعد الدلتا؛ عكس دخل قد يُهبط الرصيد ⇒ BALANCE_BELOW_MIN ممكن
  G12

LINES  نفس سطور R2 بنفس المبالغ مع **قلب الجانب** فقط (debit ↔ credit).
       لا سطر بمبلغ سالب. و`settlementDeltaMinor` **يُقلب إشارةً**:
         rev.lines[i].settlementDeltaMinor = −R2.lines[i].settlementDeltaMinor
       وتُنسَخ refs كما هي.

WRITES
  W1 set journalEntries/{opId}
       { kind:'reversal', reversalOf: originalEntryId, reason,
         bookedAt: revBookedAt, periodKey: revPeriodKey,
         lines: flipped, reversed: **true** }
  W2 set postings/{opId}__1..__n       reversed: **true**     ← خارج المجموعة الفعّالة
  W3 update journalEntries/{originalEntryId}
       { reversed: true, reversedBy: opId, updatedAt: serverTimestamp() }
       // لا يُلمس أي حقل محاسبي آخر — القيد المرحَّل غير قابل للتغيير
  W4 update postings/{originalEntryId}__1..__n   { reversed: true }
  W5 update accounts/{each m}      (مطلق، بالدلتا المقلوبة)
  W6 set   accountPeriods/{each m}__{revPeriodKey}  (increment)
  W7 update الكيان المرافق إن وُجد:
       obligations: paidMinor −= Σ|settlementDelta على refs.obligationId| (تُطبَّق الدلتا السالبة)
                    extraChargesMinor −= الجزء المقابل إن وُجد
       debts:       settledMinor −= Σ على refs.debtId ؛ status ⇒ 'open' ؛ closedAt ⇒ null
  W8 set auditLogs/{opId}  { kind:'voidEntry', originalEntryId, reason, … }

FAIL  ENTRY_NOT_FOUND · ENTRY_NOT_POSTED · ENTRY_ALREADY_REVERSED · ENTRY_IS_REVERSAL
      REASON_REQUIRED · PERIOD_LOCKED · BALANCE_BELOW_MIN
```

**لماذا `reversed: true` على قيد العكس نفسه:** هو إعلان أن **الزوج كله خارج المجموعة الفعّالة**
(التفسير الرياضي في 12.1.5). وهذا ما يجعل `Σ(الكل) === Σ(reversed==false)` ثابتةً (I17) بدل أن يكون
فرقاً صامتاً بين تقرير وآخر. الفرق الوحيد: `debitTotalMinor`/`creditTotalMinor` **خام** فيزيدان،
وهو المطلوب لميزان المراجعة (I2) ولإظهار «الإجماليات التاريخية» في كشف الحساب.

**`opId` حتمي ⇒ حارس الازدواج هو الخصيصة البنيوية نفسها:** محاولة عكس نفس القيد من جهازين معاً
تنتهي بقيد عكس واحد، والثانية تُرجع `alreadyApplied` بلا رسالة خطأ للمستخدم.

---

### 12.12 `amendEntry` — تعديل قيد (ADR-006 + ADR-014)

```ts
export interface AmendEntryReq {
  type: 'amendEntry';
  opId: string;                      // **حتمي**: `amd:${originalEntryId}:${expectedAttempt}`
  originalEntryId: string;
  expectedAttempt: number;           // = entryCorrections.attempt المقروء في الواجهة (تحكّم تزامن)
  reason: string;
  patch: {                           // الحقول المحاسبية فقط. الوصفية لا تمرّ من هنا.
    bookedAt?: string;
    amountMinor?: Minor;
    accountId?: string;
    categoryId?: string;
    splits?: ReadonlyArray<{ categoryId: string; weight: number }>;
  };
}
```

**الأداة: `runTransaction` **واحدة**. القراءات: `4 + m∪m'` (عادة **6**). الكتابات: عادة **16**.**

قيد العكس والقيد البديل **ذرّيان معاً**. لو انقسمتا إلى معاملتين لظهر للمستخدم — ولو لثانية — رصيد
خاطئ، ولو فشلت الثانية لبقي القيد ملغىً بلا بديل.

```
READ
  R1 journalEntries/{opId}                     // `amd:{id}:{n}` — منع الازدواج
  R2 entryCorrections/{originalEntryId}        // قفل التصحيح (ADR-014)
  R3 journalEntries/{originalEntryId}
  R4 settings/periods
  R5..R(4+k) accounts/{union(حسابات الأصل، حسابات البديل)}
  R+ الكيان المرافق إن وُجد

GUARDS
  G3  reason غير فارغ ؛ patch غير فارغ ؛ كل مبلغ فيه صحيح وفي النطاق
  G6  R1 موجود و hash مطابق ⇒ alreadyApplied | مختلف ⇒ OP_ID_CONFLICT
  G7a R3 موجود، status 'posted'، reversed === false، kind ∉ {'reversal'}
  Gx  **قفل التصحيح:** attempt = R2?.attempt ?? 0
      attempt === expectedAttempt وإلا AMEND_CONFLICT
      (⇒ جهازان يعدّلان نفس القيد: الثاني يفشل برمز قابل لإعادة المحاولة بعد التحديث،
       ولا يُنتج سلسلتَي تصحيح متوازيتين. لهذا رُفض الاعتماد على `amd:{id}:{count}` وحده.)
  Gy  **لا تعديل بلا تغيير:** السطور الجديدة ≠ السطور القديمة وإلا AMEND_NO_CHANGE
  G9  سياسة التاريخ: فترة الأصل مُقفلة ⇒ revBookedAt = ctx.bookedAt ؛ وإلا = R3.bookedAt
      وفترة القيد البديل = (patch.bookedAt ?? R3.bookedAt) وتُفحص هي أيضاً
  G10 **على الدلتا الصافية** لكل حساب في الاتحاد — لا على كل قيد منفرداً.
      وإلا فشل تعديل «رفع مصروف من 100 إلى 120» على حساب رصيده 10 بينما الصافي −20 فقط.
  G11 إن كان الأصل دفعة التزام/دين: paidAfter بعد (−قديم +جديد) ≤ السقف وإلا OVERPAYMENT
  G12 على القيدين كليهما

COMPUTE
  revEntryId  = `${opId}__r`
  newEntryId  = `${opId}__n`
  revLines    = flip(R3.lines)            settlementDelta مقلوب الإشارة
  newLines    = planLinesFromPatch(R3, patch)
  netDelta[a] = Σ(newLines على a) − Σ(R3.lines على a)    // بمنظور الإشارة الطبيعية
  invariant(Σ netDelta بمنظور signedMinor === 0, 'I3')

WRITES  (كتابة واحدة لكل حساب، بالدلتا الصافية — ADR-006)
  W1 set journalEntries/{revEntryId}  kind:'reversal',   reversalOf: originalEntryId, reversed:true
  W2 set postings/{revEntryId}__*      reversed:true
  W3 set journalEntries/{newEntryId}  kind:'replacement', replaces: originalEntryId, reversed:false
  W4 set postings/{newEntryId}__*      reversed:false
  W5 update journalEntries/{originalEntryId}  { reversed:true, reversedBy: revEntryId,
                                                replacedBy: newEntryId }
  W6 update postings/{originalEntryId}__*     { reversed:true }
  W7 set entryCorrections/{originalEntryId} (merge):
       { originalEntryId, ownerUid, schemaVersion:1,
         attempt: attempt + 1,
         currentEntryId: newEntryId,
         chain: arrayUnion(revEntryId, newEntryId),
         lastReason: reason, lastAt: serverTimestamp() }
  W8 update accounts/{each in union}   (مطلق، بالدلتا الصافية)
  W9 set accountPeriods/{each}__{pk}   (increment — قد تكون فترتين مختلفتين إن تغيّر bookedAt)
  W10 update الكيان المرافق بالدلتا الصافية
  W11 set auditLogs/{opId}  { kind:'amendEntry', originalEntryId, patch, before, after, reason }

FAIL  AMEND_CONFLICT · AMEND_NO_CHANGE · ENTRY_NOT_FOUND · ENTRY_NOT_POSTED
      ENTRY_ALREADY_REVERSED · OVERPAYMENT · BALANCE_BELOW_MIN · PERIOD_LOCKED · OP_ID_CONFLICT
```

**الحقول الوصفية لا تمرّ من هنا:** `description`، `notes`، `tags`، `attachmentIds` تُعدَّل بـ
`tx.update` مباشر على القيد (لا تحرّك درهماً واحداً، ومنعها يدفع المستخدم إلى إلغاء قيد سليم لتصحيح
إملاء) — ويُسجَّل كل تعديل وصفي في `auditLogs` بالقيمة القديمة والجديدة. أما `bookedAt` و`amountMinor`
و`accountId` و`categoryId` فمحاسبية ⇒ لا تمرّ إلا من `amendEntry`. والقواعد (القسم 14) تحصر
حقول التحديث المسموحة على قيد مرحَّل في: `description`, `notes`, `tags`, `attachmentIds`,
`reversed`, `reversedBy`, `replacedBy`, `updatedAt` — ولا شيء غيرها.

---

### 12.13 `materializeRecurring` — مُشغِّل الاستدراك (ADR-013)

```ts
export interface RecurrenceSpec {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  anchorDate: string;                // 'YYYY-MM-DD' — أول استحقاق. **مرجع ثابت لا يتحرك**
  anchorDayOfMonth: number;          // 1..31 مشتق من anchorDate، يُخزَّن صريحاً
  dayOfMonthPolicy: 'clampToEndOfMonth' | 'skipIfMissing';
  interval: number;                  // ≥ 1 (كل كم وحدة)
  endDate: string | null;
  maxOccurrences: number | null;
  pauses: ReadonlyArray<{ from: string; to: string | null }>;   // نوافذ توقف مؤقت
  active: boolean;
}

export interface MaterializeRecurringReq {
  type: 'materializeRecurring';
  runId: string;                     // = `mat:${todayLibya}:${deviceId}` — للتدقيق فقط
  horizonDays?: number;              // افتراضي 62 — نافذة التوليد المستقبلية
  maxPerTemplate?: number;           // افتراضي 24 — سقف الاستدراك في تشغيل واحد
}
```

**الأداة: `writeBatch` (مُجزَّأ ≤ 450)، وليست `runTransaction`.**
**القراءات: `1 + T + E` (T = القوالب النشطة، E = الاستحقاقات الموجودة في النافذة).
الكتابات: `M + T` (M = الاستحقاقات الناقصة).**

#### القاعدة الحاكمة — ولا استثناء لها

> **التكرار يولّد استحقاقاً (`obligation occurrence`)، لا دفعةً، ولا قيداً، ولا سطراً في الدفتر.**

لذلك `materializeRecurring` **لا تلمس `journalEntries` ولا `postings` ولا `accounts` ولا
`accountPeriods` إطلاقاً** — فلا تحتاج معاملة ذرّية ولا فحص رصيد، وتعمل بـ `writeBatch`.
المال يتحرك فقط عند `payObligation` (12.7) أو `recordIncome` (12.3) بفعل بشري صريح.

سببان قاطعان:

1. **السبب المحاسبي:** توليد قيد استحقاق يعني أن إنشاء التزام إيجار سنوي يرفع «مصروفات هذا الشهر»
   9,600 د.ل بلا أن يخرج درهم — وهو عين البديل المرفوض الثالث في 1.3، ويخرق القسم 12
   («فصل واضح بين الفعلي والتوقعات»).
2. **السبب التشغيلي:** على Spark لا توجد جدولة خادمية (ق-1)، فالمُشغِّل يعمل عند فتح التطبيق.
   مُشغِّل يولّد **قيوداً** عند الفتح يعني أن رصيد المستخدم يتغيّر بمجرد أن يفتح التطبيق بعد غيبة —
   سلوك غير مقبول. مُشغِّل يولّد **استحقاقات** يعني أن المستخدم يرى قائمة «مستحق عليك سداده» وهو
   ما يريده بالضبط.

#### المفتاح الحتمي

```
occurrenceKey  = dueDate            // 'YYYY-MM-DD' — بلا وقت، بلا منطقة زمنية
occurrenceId   = `${templateId}__${occurrenceKey}`
المسار         = obligations/{templateId}__{occurrenceKey}
```

تشغيل المُشغِّل 50 مرة في اليوم نفسه، من 3 أجهزة معاً، ينتج **صفر استحقاقات مكرَّرة**:
المعرّف نفسه هو القفل. ولا حاجة إلى `lastRunAt` موثوق ولا إلى قفل موزَّع.
`lastMaterializedKey` على القالب **تحسين أداء فقط** (يقصّر نطاق البحث)، وفقدانه أو تأخّره
لا ينتج ازدواجاً — وهذا هو الفرق بين مفتاح حتمي وعدّاد.

#### خوارزمية الاستدراك

```
PHASE 0 — فحص مسبق
  if (maintenance/rebuild.state === 'running') return skipped('MAINTENANCE_RUNNING')

PHASE 1 — القوالب
  Q1 query obligations where isTemplate == true and recurrence.active == true
     → templates[]                                     // T قراءات

PHASE 2 — لكل قالب: حساب المواعيد المستحقة
  from = max(template.recurrence.anchorDate,
             template.lastMaterializedKey ? nextAfter(lastMaterializedKey) : anchorDate)
  to   = addDays(todayLibya, horizonDays)               // افتراضي +62 يوماً
  keys = enumerateDueDates(template.recurrence, from, to).slice(0, maxPerTemplate)

PHASE 3 — ما هو موجود فعلاً (استعلام نطاق، خارج أي معاملة)
  Q2 query obligations
       where templateId == template.id and dueDate >= keys[0] and dueDate <= keys.at(-1)
     → existing[]                                       // E قراءات
  missing = keys.filter(k => !existing.has(k))

PHASE 4 — writeBatch (دفعات ≤ 450)
  لكل k في missing:
    set obligations/{templateId}__{k} (merge: true):
      {
        obligationId: `${templateId}__${k}`, ownerUid, schemaVersion: 1,
        isTemplate: false, templateId: template.id, occurrenceKey: k,
        name: template.name, payeeName: template.payeeName,
        nature: template.nature,                        // 'expense' | 'financing' (ADR-011)
        categoryId: template.categoryId,
        debtId: template.debtId ?? null,
        totalMinor: template.totalMinor,                // من القالب. **لا يُرفع لاحقاً** (ADR-012)
        extraChargesMinor: increment(0),                // ← يُنشئ 0 إن غاب، ويحفظ القيمة إن وُجدت
        paidMinor: increment(0),                        // ← **الحارس الحقيقي ضد إتلاف دفعة قائمة**
        dueDate: k, priority: template.priority,
        cancelledAt: null,
        generatedBy: 'materializeRecurring', generatedAt: serverTimestamp(),
        payloadHash: hashOf(template.id, k, template.totalMinor),
      }
  وبعدها:
    update obligations/{template.id}:
      { lastMaterializedKey: keys.at(-1) ?? lastMaterializedKey,
        lastMaterializedAt: serverTimestamp(),
        materializedCount: increment(missing.length) }
```

> **`increment(0)` ليس حيلة ظريفة بل الحارس الأساسي:** لو كُتب `paidMinor: 0` حرفياً، فسباق بين
> جهازين (أحدهما يولّد والآخر دفع للتو) **يمحو دفعة حقيقية**. `increment(0)` على حقل موجود يُبقيه
> كما هو، وعلى حقل غائب يُنشئه صفراً. و`merge: true` يمنع مسح أي حقل لم نذكره.
> يُدعم هذا بقاعدة في القسم 14 تمنع أي كتابة تُنقص `paidMinor` إلا من مسار العكس.

#### الحالات الحدّية — كل واحدة بإجابة قاطعة

| الحالة | السلوك المحدَّد |
|---|---|
| **لم يُفتح التطبيق شهرين** | `from` يعود إلى `nextAfter(lastMaterializedKey)` فتُولَّد **كل** الاستحقاقات الفائتة بتواريخها الأصلية. استحقاقات مارس تظهر بتاريخ مارس وبحالة مشتقّة `overdue`، لا بتاريخ اليوم. السقف `maxPerTemplate = 24` يحمي من قالب يومي مهمل سنة؛ وعند بلوغ السقف يبقى `lastMaterializedKey` على آخر مولَّد فيكمل التشغيل التالي — **لا فقدان ولا ازدواج** |
| **31 في فبراير** | المرجع هو `anchorDayOfMonth` من القالب **لا تاريخ الدورة السابقة**. مثال `anchorDate = '2026-01-31'` بسياسة `clampToEndOfMonth`: `2026-01-31`, `2026-02-28`, `2026-03-31`, `2026-04-30`, `2026-05-31`. لاحظ عودة مارس إلى 31 — لأن المرجع ثابت. لو كان المرجع الدورة السابقة لانحدر إلى 28 ثم بقي 28 إلى الأبد (انزلاق تاريخي صامت) |
| **29 فبراير في سنة غير كبيسة** | نفس الآلية: `anchorDayOfMonth = 29` في فبراير 2027 ⇒ `2027-02-28` بسياسة `clamp`، أو **لا استحقاق** بسياسة `skipIfMissing` |
| **التوقف المؤقت** | `pauses: [{from, to}]`. أي `dueDate` يقع داخل نافذة توقف **لا يُولَّد**، ويُضاف مفتاحه إلى `template.skippedKeys` مع `reason:'paused'`. **وعند الاستئناف لا تُستدرَك فترة التوقف** — لأن المستخدم أوقفها قصداً (ألغى الاشتراك شهرين). `to: null` = توقف مفتوح. وقالب `active: false` لا يُولِّد شيئاً ولا يُستدرَك عند التفعيل |
| **تغيير مبلغ القالب** | الاستحقاقات **المولَّدة سابقاً لا تتغيّر** (`merge` لا يمسّ `totalMinor` لمستند قائم… فيجب استثناؤه صراحةً: `totalMinor` يُكتب فقط عند الإنشاء عبر فرع «موجود؟» من `existing[]`). الاستحقاقات الجديدة تأخذ المبلغ الجديد. الحجّة: تعديل الإيجار من مارس لا يُعيد كتابة فاتورة يناير |
| **إلغاء استحقاق واحد** | `cancelledAt` على مستند الاستحقاق. المُشغِّل **لا يُعيد توليده** لأن المستند موجود (`existing` يحتويه) |
| **انتهاء القالب** | `endDate` أو `maxOccurrences`: `enumerateDueDates` تتوقف، ويُضبط `recurrence.active = false` في نفس الدفعة |
| **تشغيل من جهازين في نفس اللحظة** | كلاهما يكتب نفس المعرّفات بنفس المحتوى ⇒ الكتابة الثانية متطابقة (`payloadHash` نفسه). `increment(0)` يحمي `paidMinor`. لا قفل مطلوب |

```ts
// domain/recurrence/dates.ts — بلا مكتبات تواريخ، بلا منطقة زمنية محلية
const pad2 = (n: number) => String(n).padStart(2, '0');

/** آخر يوم في شهر (month: 1..12) */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** تاريخ الدورة الشهرية رقم i اعتماداً على **مرجع القالب الثابت** لا على الدورة السابقة. */
export function monthlyOccurrence(
  anchorDayOfMonth: number, year: number, month: number,
  policy: 'clampToEndOfMonth' | 'skipIfMissing',
): string | null {
  const dim = daysInMonth(year, month);
  if (anchorDayOfMonth > dim) {
    if (policy === 'skipIfMissing') return null;
    return `${year}-${pad2(month)}-${pad2(dim)}`;
  }
  return `${year}-${pad2(month)}-${pad2(anchorDayOfMonth)}`;
}

export function enumerateDueDates(
  r: RecurrenceSpec, fromDate: string, toDate: string,
): string[];                        // نقية، حتمية، قابلة للاختبار بلا Firebase
```

**حالة الاستحقاق مشتقّة لا مخزَّنة:**

```ts
// domain/rules/obligationStatus.ts
export type ObligationStatus =
  'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';

export function obligationStatus(o: Obligation, todayLibya: string): ObligationStatus {
  if (o.cancelledAt) return 'cancelled';
  const ceiling = o.totalMinor + o.extraChargesMinor;
  if (o.paidMinor >= ceiling)  return 'paid';
  if (o.paidMinor > 0)         return 'partiallyPaid';
  if (o.dueDate < todayLibya)  return 'overdue';
  if (o.dueDate === todayLibya) return 'due';
  return 'upcoming';
}
```

فلا توجد وظيفة يومية تكتب `due → overdue` على مئات المستندات (مستحيلة على Spark أصلاً)، ولا تنشأ
حالة قديمة لأن المستخدم لم يفتح التطبيق. الاستعلامات تستخدم `dueDate` و`paidMinor` المفهرسين،
والحالة تُحسب عند العرض.

**الفشل:** `MAINTENANCE_RUNNING` (يُتخطّى بصمت ويُعاد لاحقاً)، `TEMPLATE_PAUSED` (لقالب محدَّد
عند تشغيل يدوي صريح). فشل دفعة واحدة لا يُفسد شيئاً: التشغيل التالي يستدرك ما نقص بنفس المفاتيح.

---

### 12.14 `reconcileAccount` — تسوية حساب واحد مع الدفتر (ADR-015)

```ts
export interface ReconcileAccountReq {
  type: 'reconcileAccount';
  accountId: string;
  mode: 'report' | 'repair';         // 'report' = قراءة فقط، 'repair' = تُصلح المُجمَّع
}

export interface ReconcileReport {
  accountId: string;
  storedDebitMinor: Minor;  storedCreditMinor: Minor;  storedBalanceMinor: Minor;
  ledgerDebitMinor: Minor;  ledgerCreditMinor: Minor;  ledgerBalanceMinor: Minor;
  driftMinor: Minor;                 // stored − ledger
  postingCount: number;
  periodsChecked: number;
  repaired: boolean;
  at: string;
}
```

**الأداة: استعلامات تجميعية خادمية + `runTransaction` واحدة للإصلاح.
القراءات: 1 (الحساب) + 3 استعلامات تجميعية + 1 (البوابة في القواعد). الكتابات: 0 في `report`،
2 في `repair`.**

#### الفرق القاطع بين `reconcileAccount` و `adjustBalance`

| | المشكلة | العلاج | يكتب قيداً؟ |
|---|---|---|---|
| `adjustBalance` (12.10) | **الواقع يخالف الدفتر** (جردت النقد فوجدت 10 د.ل أقل) | قيد تسوية حقيقي على `acc_eq_adjust` | **نعم** |
| `reconcileAccount` | **المُجمَّع يخالف الدفتر** (كتابة ناقصة، ترحيل قديم، عيب) | إعادة حساب المُجمَّع من الدفتر | **لا، أبداً** |

الدفتر هو الحقيقة. `reconcileAccount` **لا تخترع رقماً ولا تولّد قيداً** — تُعيد كتابة قيمة مشتقّة
انحرفت. ولهذا تكتب **قيماً مطلقة** لا دلتات (ADR-015).

```
PHASE 0 — البوابة
  G2 maintenance/rebuild.state !== 'running' وإلا MAINTENANCE_RUNNING
  set maintenance/reconcile__{accountId}:
     { kind:'reconcileAccount', state:'running', runToken: uuid, startedAt, ownerUid }

PHASE 1 — الحقيقة من الدفتر (تجميع خادمي، ADR-016)
  A1 getAggregateFromServer(
       query(postings, where accountId == a, where side == 'debit'),
       { s: sum('amountMinor'), n: count() })                → ledgerDebitMinor
  A2 نفس الشيء بـ side == 'credit'                           → ledgerCreditMinor
  ledgerBalanceMinor = balanceFromTotals({ type, ledgerDebitMinor, ledgerCreditMinor })
  // المجموع **خام**: يشمل قيود العكس. صحيح لأن زوج العكس صافيه صفر (I17)،
  // فلا حاجة إلى مرشِّح reversed ⇒ فهرس أبسط وتكلفة أقل.

PHASE 2 — المقارنة
  R1 get accounts/{accountId}
  driftMinor = storedBalanceMinor − ledgerBalanceMinor
  if (driftMinor === 0 && debit/credit متطابقان) → report نظيف، release، انتهِ

PHASE 3 — التحقق المضاعف قبل أي إصلاح (إلزامي)
  A3 getAggregateFromServer(sum('signedMinor')) على نفس الاستعلام
     invariant(signedSum === ledgerDebitMinor − ledgerCreditMinor, 'I3')
     // انحراف هنا يعني خللاً في الدفتر نفسه لا في المُجمَّع ⇒ LEDGER_IMBALANCE
     // ويُمنع الإصلاح: لا تُصلح مُجمَّعاً من دفتر مشكوك فيه.

PHASE 4 — الإصلاح (mode === 'repair' فقط)، runTransaction واحدة
  tx.get(accounts/{accountId})                      // إعادة قراءة داخل المعاملة
  if (نسخة الحساب تغيّرت عن PHASE 2: lastEntryId مختلف) → أعد التشغيل من PHASE 1
  tx.update accounts/{accountId}:
     { debitTotalMinor:  ledgerDebitMinor,          // قيم مطلقة
       creditTotalMinor: ledgerCreditMinor,
       balanceMinor:     ledgerBalanceMinor,
       reconciledAt: serverTimestamp(), reconciledDriftMinor: driftMinor }
  tx.set auditLogs/{`rec:${accountId}:${todayLibya}:${runToken}`}:
     { kind:'reconcileAccount', accountId, before:{…}, after:{…}, driftMinor,
       postingCount, runToken, at: serverTimestamp(), ownerUid }

PHASE 5 — تسوية الفترات (اختيارية، ضمن نفس التشغيل)
  لكل periodKey في [أول قيد .. الفترة الحالية]:
    A: getAggregateFromServer(sum('amountMinor')) على
       (accountId == a && periodKey == pk && side == 'debit')  ثم 'credit'
    set accountPeriods/{a}__{pk}: { debitMinor: ABS, creditMinor: ABS }   ← مطلق لا increment
  التكلفة: استعلامان تجميعيان وكتابة واحدة لكل فترة. 24 شهراً ⇒ 48 تجميعاً + 24 كتابة.

PHASE 6 — الإفراج
  set maintenance/reconcile__{accountId}: { state:'done', finishedAt, report }
```

**الاستئناف بعد انقطاع في المنتصف:** `reconcileAccount` **لا تحتاج مؤشر استئناف** لأن كل كتاباتها
**مطلقة وفردية (idempotent)**: الحساب يُكتب كتابة واحدة، وكل `accountPeriods` تُكتب مستقلة عن غيرها.
انقطاع في منتصف PHASE 5 يترك بعض الفترات مُسوّاة وبعضها لا — وإعادة التشغيل من الصفر تُنتج نفس
النتيجة بالضبط. والحارس على ذلك: مستند البوابة بحالة `running` قديمة (> 10 دقائق) يُعتبر متروكاً
ويُستولى عليه بـ `runToken` جديد.

**متى تُشغَّل:** زر صريح في «الإعدادات ← سلامة البيانات» لكل حساب، + تلقائياً في الفاحص الدوري
(13.2) عند اكتشاف خرق I2 أو I4 أو I5.

**الفشل:** `MAINTENANCE_RUNNING`, `ACCOUNT_NOT_FOUND`, `LEDGER_IMBALANCE`, `REBUILD_TOKEN_LOST`.

---

### 12.15 `rebuildProjections` — إعادة بناء كل المُجمَّعات (ADR-015)

```ts
export interface RebuildProjectionsReq {
  type: 'rebuildProjections';
  runToken: string;                  // uuid لصاحب التشغيل
  pageSize?: number;                 // افتراضي 300 ترحيل لكل صفحة
  resume?: boolean;                  // true ⇒ أكمل من المؤشر الموجود
}

// maintenance/rebuild  — مستند واحد: البوابة والمؤشر والمُركِّم معاً
export interface RebuildTask {
  taskId: 'rebuild'; ownerUid: string; schemaVersion: 1;
  kind: 'rebuildProjections';
  state: 'idle' | 'running' | 'verifying' | 'done' | 'failed';
  runToken: string;
  phase: 'accumulate' | 'write' | 'verify';
  periodQueue: string[];             // كل الفترات المكتشَفة، مرتبة تصاعدياً
  periodCursor: string | null;       // الفترة الجارية
  pageCursor: string | null;         // آخر postingId مُطبَّق في الفترة الجارية (ترتيب __name__)
  pagesApplied: number;
  grandTotals: Record<string, { d: number; c: number }>;        // لكل accountId — تراكمي كلي
  periodTotals: Record<string, { d: number; c: number }>;       // للفترة الجارية فقط، يُفرَّغ عند إتمامها
  periodsDone: string[];
  startedAt: string; updatedAt: string;
  lastError: { code: string; messageAr: string; at: string } | null;
}
```

**الأداة: إجراء متعدد الخطوات — استعلامات صفحية خارج المعاملات + `runTransaction` واحدة لكل صفحة
(تكتب مستند المؤشر فقط) + `writeBatch` للكتابة النهائية.
القراءات: `P × pageSize` ترحيل + معاملة لكل صفحة. الكتابات: `P` (المؤشر) + `A + A×K` (الحسابات
والفترات) + 1 (الإفراج)، حيث `A` = الحسابات و`K` = الفترات.**

#### البوابة في القواعد — السطر الذي يستهلكه القسم 14

```
function rebuildIdle() {
  let p = /databases/$(database)/documents/users/$(request.auth.uid)/maintenance/rebuild;
  return !exists(p) || get(p).data.state != 'running';
}
// يُضاف && rebuildIdle() إلى كل allow create/update على
// journalEntries, postings, accounts, accountPeriods, obligations, debts
```

بلا هذه البوابة، جهاز ثانٍ يسجّل مصروفاً في منتصف إعادة البناء فتُكتب القيم المطلقة فوق قيده
⇒ **يختفي مصروف بلا أي أثر**. البوابة في القواعد لا في الكود، لأن الكود على جهاز آخر لا يعرف
أن إعادة بناء تجري.

#### المراحل

```
PHASE A — الاستحواذ
  runTransaction:
    t = tx.get(maintenance/rebuild)
    if (t.exists && t.state === 'running' && t.runToken !== myToken
        && now − t.updatedAt < 10 دقائق)  → REBUILD_TOKEN_LOST
    if (resume && t.exists && t.runToken === myToken) → أكمل من t
    else tx.set(maintenance/rebuild, {
      state:'running', runToken: myToken, phase:'accumulate',
      periodQueue: [], periodCursor: null, pageCursor: null,
      grandTotals: {}, periodTotals: {}, periodsDone: [], pagesApplied: 0,
      startedAt, updatedAt })
  ← من هذه اللحظة كل كتابة مالية من أي جهاز مرفوضة بـ MAINTENANCE_RUNNING

PHASE B — اكتشاف الفترات (مرة واحدة)
  Q: query postings orderBy periodKey  → أول وآخر periodKey
  periodQueue = كل الأشهر بين الطرفين (توليد محلي، لا استعلام)
  update maintenance/rebuild { periodQueue, periodCursor: periodQueue[0] }

PHASE C — التراكم، صفحة صفحة (هنا تكمن الذرّية الحقيقية)
  while (periodCursor !== null):
    Q: query postings
         where periodKey == periodCursor
         orderBy __name__
         startAfter(pageCursor)                  // null ⇒ من البداية
         limit(pageSize)
       → page[]                                  // **استعلام، لذا خارج المعاملة إلزاماً**

    if (page.length === 0):
      runTransaction:                            // إتمام الفترة
        t = tx.get(maintenance/rebuild)
        assert t.runToken === myToken            وإلا REBUILD_TOKEN_LOST
        assert t.periodCursor === periodCursor   وإلا صفحة مكرَّرة ⇒ تخطَّ
        tx.update(maintenance/rebuild, {
          // اكتب accountPeriods للفترة المنتهية من periodTotals — قيم مطلقة
          periodsDone: arrayUnion(periodCursor),
          periodCursor: next(periodQueue, periodCursor),
          pageCursor: null,
          periodTotalsSnapshot: t.periodTotals,  // يُستهلك في PHASE D
          periodTotals: {},
          updatedAt })
      continue

    sums = aggregateInMemory(page)               // { [accountId]: {d, c} }
    lastId = page.at(-1).postingId

    runTransaction:                              // ← ذرّية التراكم + تقدّم المؤشر معاً
      t = tx.get(maintenance/rebuild)
      assert t.runToken === myToken              وإلا REBUILD_TOKEN_LOST
      if (t.pageCursor !== pageCursor) return 'alreadyApplied'
          // ← **هذا هو ضمان الاستئناف:** الصفحة طُبِّقت في محاولة سابقة. لا تُجمع مرتين.
      tx.update(maintenance/rebuild, {
        grandTotals:  mergeAdd(t.grandTotals,  sums),
        periodTotals: mergeAdd(t.periodTotals, sums),
        pageCursor: lastId,
        pagesApplied: increment(1),
        updatedAt })
    pageCursor = lastId

PHASE D — الكتابة المطلقة (writeBatch، دفعات ≤ 450)
  update maintenance/rebuild { phase: 'write' }
  لكل accountId في grandTotals:
    set accounts/{accountId} (merge):
      { debitTotalMinor:  grandTotals[a].d,              // **مطلق**
        creditTotalMinor: grandTotals[a].c,
        balanceMinor: balanceFromTotals({ type, ...grandTotals[a] }),
        rebuiltAt: serverTimestamp() }
  لكل (accountId, periodKey) من لقطات الفترات:
    set accountPeriods/{accountId}__{periodKey}:
      { accountId, accountType, periodKey, debitMinor: ABS, creditMinor: ABS, ownerUid }
  حساب ليس له أي ترحيل: debitTotalMinor = creditTotalMinor = 0, balanceMinor = 0
  ← **مهم:** الحسابات المفقودة من grandTotals تُصفَّر صراحةً، وإلا بقيت قيمة قديمة وهمية.

PHASE E — التحقق ثم الإفراج
  update maintenance/rebuild { phase: 'verify', state: 'verifying' }
  شغّل I2 (ميزان المراجعة)، I3، I10 على كل الحسابات
  نجاح ⇒ set maintenance/rebuild { state: 'done', finishedAt }
           + set auditLogs/{`rbd:${runToken}`} { kind:'rebuildProjections', pagesApplied,
               accountsWritten, periodsWritten, durationMs, at }
  فشل  ⇒ { state: 'failed', lastError } و**البوابة تبقى مغلقة** حتى قرار المالك:
           بيانات مشكوك فيها + كتابة مسموحة = فساد أسوأ.
           الواجهة تعرض: «فحص السلامة فشل. العمليات المالية موقوفة. راجع تقرير الفحص.»
```

#### الاستئناف بعد انقطاع في المنتصف — الإجابة الدقيقة

| لحظة الانقطاع | ما يحدث عند إعادة الفتح |
|---|---|
| في PHASE C بعد استعلام صفحة وقبل معاملتها | الصفحة لم تُجمع. `pageCursor` لم يتقدّم. إعادة التشغيل تقرأ نفس الصفحة وتجمعها. **لا ازدواج** |
| في PHASE C بعد المعاملة وقبل الصفحة التالية | `pageCursor` تقدّم مع التراكم **في نفس المعاملة**. إعادة التشغيل تكمل من بعده. **لا ازدواج** |
| في PHASE C أثناء إعادة محاولة معاملة نجحت فعلاً | `t.pageCursor !== pageCursor` ⇒ `alreadyApplied` ⇒ تُتخطّى. **لا ازدواج** |
| في PHASE D في منتصف الدفعات | الكتابة **مطلقة وفردية**: إعادة PHASE D من أولها تُنتج نفس القيم بالضبط. `grandTotals` محفوظة في مستند المؤشر |
| في PHASE E | يُعاد التحقق فقط |
| الجهاز لا يعود أبداً | `state: 'running'` و`updatedAt` أقدم من 10 دقائق ⇒ جهاز آخر يستولي بـ `runToken` جديد ويبدأ من PHASE A بـ `resume: false`. **البوابة لا تبقى مغلقة إلى الأبد** |

> **لماذا التراكم في مستند المؤشر وليس في ذاكرة الجهاز:** لأن الذاكرة تضيع مع إغلاق التبويب،
> فيستأنف الجهاز بمجاميع صفرية فوق مؤشر متقدّم ⇒ **قيم مطلقة ناقصة تُكتب على الحسابات**.
> حجم المستند: 45 حساباً × حقلين × فترتين (كلي + جارية) ≈ 6 كيلوبايت — بعيد جداً عن حد 1 ميغابايت.

**الفشل:** `REBUILD_TOKEN_LOST`, `LEDGER_IMBALANCE`, `MAINTENANCE_RUNNING`.

---

### 12.16 `openAccount` — فتح حساب برصيد افتتاحي

```ts
export interface OpenAccountReq {
  type: 'openAccount';
  opId: string;                      // **حتمي**: `open:${accountId}` ⇒ رصيد افتتاحي واحد للأبد
  accountId: string;                 // يولّده العميل: `acc_${slug}_${rand6}`
  name: string;
  type: AccountType;                 // 'asset' | 'liability' للحسابات المستخدمة
  subtype: 'cash' | 'bank' | 'wallet' | 'card' | 'other';
  cashLike: boolean;                 // يدخل «الأموال المتاحة»؟
  openingBalanceMinor: Minor;        // قد يكون 0، وقد يكون سالباً لبطاقة مدينة
  openedAt: string;                  // 'YYYY-MM-DD' — يصبح حدّ G8 لكل قيد لاحق
  minBalanceMinor?: Minor;           // موقَّع، افتراضي 0 (ADR-010)
  bankName?: string; iban?: string; colorToken?: string; icon?: string;
}
```

**الأداة: `runTransaction`. القراءات: 3. الكتابات: 8 (أو 1 إن كان الرصيد الافتتاحي صفراً).**

```
READ   R1 accounts/{accountId}              // يجب أن يكون غير موجود
       R2 journalEntries/{opId}             // `open:{accountId}`
       R3 accounts/acc_eq_opening

GUARDS G3 openingBalanceMinor صحيح، |x| ≤ MAX_ABS_MINOR ؛ name.trim() غير فارغ
       type ∈ {'asset','liability'} وإلا ACCOUNT_TYPE_MISMATCH
       R1 موجود ⇒ OPENING_ALREADY_EXISTS (الحساب موجود؛ التعديل مسار آخر)
       G6 R2 موجود و hash مطابق ⇒ alreadyApplied | مختلف ⇒ OP_ID_CONFLICT
       G4 openedAt ≤ todayLibya
       G5 G9 (فترة openedAt غير مُقفلة)
       G10 **لا يُطبَّق**: الرصيد الافتتاحي **هو** تعريف نقطة البداية
       G12

WRITES
  W1 set accounts/{accountId}:
     { accountId, ownerUid, schemaVersion:1, name, type, subtype, cashLike,
       code: `${type}.${subtype}.${slug}`,
       openingBalanceMinor,                       // أرشيفي: ما رُحِّل عبر القيد الافتتاحي
       debitTotalMinor: 0, creditTotalMinor: 0, balanceMinor: 0,   // ← تُحدَّثها W3
       minBalanceMinor: minBalanceMinor ?? 0,
       earmarkedMinor: 0,
       openedAt, closedAt: null, status:'active',
       lastEntryId: null, isSystem: false,
       bankName, iban, colorToken, icon, createdAt: serverTimestamp() }

  إن openingBalanceMinor === 0 → انتهِ. **كتابة واحدة، لا قيد بصفر.**

  وإلا (قيد افتتاحي kind:'opening', bookedAt = `${openedAt}T00:00:00+02:00`):
    openingBalanceMinor > 0 و type==='asset':
      1) Dr accounts/{accountId}   X
      2) Cr acc_eq_opening         X
    openingBalanceMinor > 0 و type==='liability':   (دين قائم عند بداية الاستخدام)
      1) Dr acc_eq_opening         X
      2) Cr accounts/{accountId}   X
    openingBalanceMinor < 0 و type==='asset':       (بطاقة مكشوفة)
      1) Dr acc_eq_opening         |X|
      2) Cr accounts/{accountId}   |X|
  W2 set journalEntries/{opId} · W3 set postings __1,__2
  W4 update accounts/{accountId} (مطلق) · W5 update accounts/acc_eq_opening (مطلق)
  W6 set accountPeriods ×2 (increment) بـ periodKey = openedAt.slice(0,7)

FAIL   OPENING_ALREADY_EXISTS · ACCOUNT_TYPE_MISMATCH · AMOUNT_* · PERIOD_LOCKED
       BOOKED_AT_FUTURE · OP_ID_CONFLICT
```

**الرصيد الافتتاحي قيد حقيقي، لا حقل:** لهذا يصدق I5 (`balanceMinor` = الافتتاحي + الحركات)
**تلقائياً** بلا استثناء في الصيغة: الافتتاحي **هو** أول ترحيل. ولهذا `reconcileAccount` تحسب
الرصيد من `postings` وحدها بلا إضافة حقل جانبي. و`opId = open:{accountId}` حتمي يجعل «رصيدان
افتتاحيان لحساب واحد» مستحيلاً بنيوياً لا بفحص.

---

### 12.17 `closeAccount` — إغلاق حساب

```ts
export interface CloseAccountReq {
  type: 'closeAccount';
  accountId: string;
  reason: string;
  closedAt: string;                  // 'YYYY-MM-DD'
  force?: boolean;                   // يسمح بالإغلاق مع وجود رصيد؟ **لا — غير مدعوم، انظر أدناه**
}
```

**الأداة: `runTransaction`. القراءات: 1 + استعلام عدّ واحد قبل المعاملة. الكتابات: 2.**

```
PRE    Q1 getAggregateFromServer(count()) على
          query(pendingCommands, where state in ['queued','inFlight'])
          ثم فحص محلي للحمولات المرجعة للحساب
          > 0 ⇒ ACCOUNT_HAS_PENDING (قابل لإعادة المحاولة بعد المزامنة)

READ   R1 accounts/{accountId}

GUARDS G3  reason غير فارغ وإلا REASON_REQUIRED
       G7  R1 موجود وإلا ACCOUNT_NOT_FOUND ؛ status === 'active' وإلا ACCOUNT_CLOSED
       Gz1 R1.isSystem === false وإلا ACCOUNT_TYPE_MISMATCH («حسابات النظام لا تُغلق»)
       Gz2 R1.balanceMinor === 0 وإلا ACCOUNT_NOT_EMPTY { balance }
       Gz3 R1.earmarkedMinor === 0 وإلا ACCOUNT_HAS_EARMARK
       G4  closedAt ≤ todayLibya و ≥ R1.openedAt

WRITES W1 update accounts/{accountId}:
          { status:'closed', closedAt, closeReason: reason, updatedAt: serverTimestamp() }
       W2 set auditLogs/{`cls:${accountId}:${closedAt}`}:
          { kind:'closeAccount', accountId, reason, balanceAtClose: 0,
            at: serverTimestamp(), ownerUid }

FAIL   ACCOUNT_NOT_FOUND · ACCOUNT_CLOSED · ACCOUNT_NOT_EMPTY · ACCOUNT_HAS_EARMARK
       ACCOUNT_HAS_PENDING · REASON_REQUIRED · ACCOUNT_TYPE_MISMATCH
```

**ثلاثة قرارات صريحة:**

1. **`closeAccount` لا تولّد قيداً إطلاقاً.** هي تغيير حالة بحت. وبهذا لا يمكن أن تُخلّ بأي ثابت.
2. **`force` غير مدعوم.** إغلاق حساب برصيد يعني إمّا إخفاء مال (الرصيد يختفي من «المتاح» وهو موجود)
   أو قيد ضمني يبتلعه — وكلاهما مرفوض. المسار الصحيح: `transfer` إلى حساب آخر أو `adjustBalance`
   بسبب مكتوب، ثم `closeAccount`. الحقل يبقى في الواجهة لرسالة إرشادية صريحة.
3. **الحساب المغلق قابل للقراءة إلى الأبد**، ويظهر في كل التقارير التاريخية وكشوف الحركة.
   القواعد تمنع `create` على `postings` بحساب `status === 'closed'` و`bookedAt > closedAt`،
   لكن **`voidEntry` يبقى مسموحاً** عليه (12.11 / G7e) — إلغاء خطأ قديم على حساب أُغلق حق لا استثناء.

**إعادة الفتح:** `status: 'active'` و`closedAt: null` عبر نفس المسار بـ `reason` جديد، ويُسجَّل في
`auditLogs`. لا قيد، ولا تغيير في `openedAt`.

---

### 12.18 الجدول الموجز — الأداة والقراءات والكتابات

| العملية | الأداة | قراءات | كتابات | يولّد قيداً؟ | كيانات مرافقة تُلمس |
|---|---|---|---|---|---|
| `recordExpense` | `runTransaction` | 3 (`2+k` بتقسيم) | 7 (`3+2(k+1)`) | ✓ 1 | ✗ |
| `recordIncome` | `runTransaction` | 3 | 7 | ✓ 1 | ✗ |
| `transfer` | `runTransaction` | 3 / 4 بعمولة | 7 / 10 | ✓ 1 | ✗ |
| `borrowMoney` | `runTransaction` | 3 | 8 | ✓ 1 | `debts` |
| `lendMoney` | `runTransaction` | 3 | 8 | ✓ 1 | `debts` |
| `payObligation` | `runTransaction` | 4 / 6 | 8…12 | ✓ 1 | `obligations` (+`debts`) |
| `payDebt` | `runTransaction` | 4 / 5 | 8…11 | ✓ 1 | `debts` |
| `collectDebt` | `runTransaction` | 4 / 5 | 8…11 | ✓ 1 | `debts` |
| `adjustBalance` | `runTransaction` | 3 | 8 | ✓ 1 | `auditLogs` |
| `voidEntry` | `runTransaction` | 4…6 | 10…12 | ✓ 1 (عكس) | الكيان المرتبط + `auditLogs` |
| `amendEntry` | `runTransaction` **واحدة** | ~6 | ~16 | ✓ 2 (عكس + بديل) | `entryCorrections` + المرتبط + `auditLogs` |
| `materializeRecurring` | `writeBatch` ≤450 | `1+T+E` | `M+T` | **✗ أبداً** | `obligations` فقط |
| `reconcileAccount` | تجميع + `runTransaction` | 1 + 3 تجميعات | 0 / 2 (+`K`) | **✗ أبداً** | `accounts`, `accountPeriods`, `auditLogs` |
| `rebuildProjections` | إجراء + معاملة/صفحة + `writeBatch` | `P×pageSize` | `P + A + A·K + 1` | **✗ أبداً** | `maintenance`, `accounts`, `accountPeriods`, `auditLogs` |
| `openAccount` | `runTransaction` | 3 | 1 / 8 | ✓ 1 إن ≠ 0 | ✗ |
| `closeAccount` | `runTransaction` | 1 + عدّ | 2 | **✗** | `auditLogs` |

أكبر معاملة في النظام = `amendEntry` بـ ~16 كتابة، أي **3%** من حدّ 500. لا خطر تجاوز.
وأكبر عدد قراءات = `amendEntry` بـ ~6، وكلها مستندات بمعرّفات حتمية (لا استعلام في معاملة).

---

## 13. الثوابت I1…I30

### 13.1 القائمة

كل ثابت: جملة واحدة قابلة للفحص آلياً، التعبير الذي يفحصه، اسم اختبار الوحدة الجاهز للنسخ إلى
`tests/`، ومتى يُفحص. مستويات الفحص الثلاثة مشروحة في 13.2.

---

**I1 — توازن القيد.** مجموع المدين في كل قيد يساوي مجموع الدائن فيه بالضبط، وكل قيد له سطران على الأقل.

```ts
const d = sumMinor(e.lines.filter(l => l.side === 'debit').map(l => l.amountMinor));
const c = sumMinor(e.lines.filter(l => l.side === 'credit').map(l => l.amountMinor));
d === c && d === e.debitTotalMinor && c === e.creditTotalMinor && e.lines.length >= 2
```

- **الاختبار:** `entry_is_balanced_for_every_generated_plan`
- **متى:** وقت التشغيل — `invariant()` داخل `emitEntry` قبل أي كتابة + في القواعد (القسم 14) +
  في الفاحص الدوري.

---

**I2 — ميزان المراجعة العام.** مجموع `debitTotalMinor` على كل الحسابات يساوي مجموع `creditTotalMinor` عليها.

```ts
sumMinor(accounts.map(a => a.debitTotalMinor)) === sumMinor(accounts.map(a => a.creditTotalMinor))
```

- **الاختبار:** `trial_balance_sums_to_zero_across_all_accounts`
- **متى:** الفاحص الدوري عند كل تسجيل دخول (~45 قراءة) + بعد `rebuildProjections` (PHASE E) + في CI
  بعد سيناريو جدولي يشغّل كل العمليات الستة عشر.

---

**I3 — صافي الترحيلات صفر.** مجموع `signedMinor` على كل مستندات `postings` صفر.

```ts
await getAggregateFromServer(query(postings), { s: sum('signedMinor') }) === 0
```

- **الاختبار:** `signed_postings_sum_to_zero`
- **متى:** الفاحص الدوري (تجميع خادمي واحد) + PHASE 3 في `reconcileAccount` + PHASE E في
  `rebuildProjections`.

---

**I4 — الرصيد دالّة في الإجماليات.** `balanceMinor` لكل حساب = `debitTotalMinor − creditTotalMinor`
بإشارة جانبه الطبيعي.

```ts
a.balanceMinor === balanceFromTotals(a)
```

- **الاختبار:** `balance_equals_totals_by_normal_side`
- **متى:** وقت التشغيل — `invariant()` قبل كل `tx.update` على `accounts` + الفاحص الدوري.

---

**I5 — الرصيد = الافتتاحي + الحركات المرحَّلة.** رصيد كل حساب يساوي مجموع ترحيلاته في الدفتر،
والرصيد الافتتاحي داخل هذا المجموع لأنه قيد حقيقي.

```ts
const s = await getAggregateFromServer(
  query(postings, where('accountId','==',a.accountId)), { s: sum('signedMinor') });
a.balanceMinor === (normalSideOf(a.type) === 'debit' ? s : negateMinor(s))
```

- **الاختبار:** `account_balance_matches_ledger_aggregate`
- **متى:** `reconcileAccount` (PHASE 2) + الفاحص الدوري لحساب واحد بالتناوب (يوماً بيوم) لتوزيع
  التكلفة على Spark.

---

**I6 — دفعات الالتزام = مجموع دلتا التسوية (ADR-021).** `paidMinor` لكل التزام يساوي مجموع
`settlementDeltaMinor` **الخام** على الترحيلات التي تحمل مرجعه.

```ts
await getAggregateFromServer(
  query(postings, where('refs.obligationId','==',o.obligationId)),
  { s: sum('settlementDeltaMinor') }) === o.paidMinor
```

- **الاختبار:** `obligation_paid_equals_sum_of_settlement_deltas`
- **متى:** في CI على سيناريو «دفعتان جزئيتان ثم إلغاء الأولى» + الفاحص الدوري على الالتزامات غير
  المسدَّدة فقط.

---

**I7 — دفعات الدين = مجموع دلتا التسوية.** `settledMinor` لكل دين يساوي مجموع
`settlementDeltaMinor` على الترحيلات التي تحمل `refs.debtId`.

```ts
await getAggregateFromServer(
  query(postings, where('refs.debtId','==',d.debtId)),
  { s: sum('settlementDeltaMinor') }) === d.settledMinor
```

- **الاختبار:** `debt_settled_equals_sum_of_settlement_deltas`
- **متى:** الفاحص الدوري على الديون المفتوحة + CI.

---

**I8 — دلتا التسوية تحمل مرجعاً واحداً بالضبط.** أي ترحيل دلتا تسويته ≠ 0 يحمل `refs.obligationId`
أو `refs.debtId` — **واحداً منهما لا كليهما** (وإلا ازدوج الحساب في I6 و I7).

```ts
p.settlementDeltaMinor !== 0
  ? (Number(!!p.refs?.obligationId) + Number(!!p.refs?.debtId)) === 1
  : true
```

- **الاختبار:** `settlement_delta_carries_exactly_one_settlement_ref`
- **متى:** وقت التشغيل — `invariant()` في `emitEntry` + القواعد + الفاحص الدوري.

---

**I9 — لا سداد زائد.** `paidMinor` لا يتجاوز `totalMinor + extraChargesMinor` أبداً، ولا ينزل
تحت الصفر.

```ts
0 <= o.paidMinor && o.paidMinor <= o.totalMinor + o.extraChargesMinor
```

- **الاختبار:** `paid_never_exceeds_total_plus_extra_charges`
- **متى:** وقت التشغيل (G11) + القواعد (`request.resource.data.paidMinor <= …`) + الفاحص الدوري.

---

**I10 — `totalMinor` لا يُرفع أبداً (ADR-012).** أي تحديث على التزام أو دين يُبقي `totalMinor`
كما هو؛ كل زيادة تذهب إلى `extraChargesMinor`.

```ts
request.resource.data.totalMinor == resource.data.totalMinor     // في القواعد
```

- **الاختبار:** `total_minor_is_immutable_after_creation`
- **متى:** القواعد (المصدر الوحيد الموثوق) + اختبار محاكي Firestore في CI.

---

**I11 — لا قيد مرحَّل بلا ترحيلات، ولا ترحيل يتيم.** عدد مستندات `postings` لكل قيد يساوي عدد
سطوره، وكل `posting.entryId` يشير إلى قيد موجود.

```ts
countOf(query(postings, where('entryId','==',e.entryId))) === e.lines.length
&& e.lines.every((_, i) => exists(`postings/${e.entryId}__${i + 1}`))
```

- **الاختبار:** `every_entry_has_exactly_its_postings_and_no_orphans`
- **متى:** ذرّية المعاملة تمنع الخرق بنيوياً ⇒ الفاحص الدوري (مسح صفحي) + CI. اليتم المعاكس
  (ترحيل بقيد محذوف) مستحيل لأن **لا قيد يُحذف أبداً** (ADR-006).

---

**I12 — مجموع الفترات = حركة الحساب الكلية.** لكل حساب، مجموع `debitMinor` على كل مستندات
`accountPeriods` الخاصة به يساوي `debitTotalMinor`، وكذلك الدائن.

```ts
sumMinor(periodsOf(a).map(p => p.debitMinor))  === a.debitTotalMinor &&
sumMinor(periodsOf(a).map(p => p.creditMinor)) === a.creditTotalMinor
```

- **الاختبار:** `account_periods_sum_to_account_totals`
- **متى:** الفاحص الدوري + PHASE E في `rebuildProjections` + CI على سيناريو يمتد 3 أشهر.

---

**I13 — `periodKey ≡ bookedAt[0:7]` (ADR-008).** لكل قيد وكل ترحيل، مفتاح الفترة هو أول سبعة
أحرف من تاريخ الترحيل، حرفياً.

```ts
e.periodKey === e.bookedAt.slice(0, 7) && p.periodKey === p.bookedAt.slice(0, 7)
```

- **الاختبار:** `period_key_always_equals_booked_at_prefix`
- **متى:** وقت التشغيل — `assertPeriodKey()` في كل بناء قيد + القواعد
  (`request.resource.data.periodKey == request.resource.data.bookedAt[0:7]`) + الفاحص الدوري.
  «بداية الشهر المالي» نافذة عرض على نطاق `bookedAt` ولا تمسّ هذا الثابت.

---

**I14 — العمليات المعلّقة خارج كل رصيد وتقرير (ADR-007).** لا قيمة من `pendingCommands` تدخل أي
مُجمَّع أو تقرير أو بطاقة.

```ts
// فحص بنيوي: دوال الاختيار لا تستورد طبقة الطابور إطلاقاً
selectorsModuleImports.every(m => !m.includes('queue') && !m.includes('pendingCommands'))
// وفحص سلوكي: رصيد قبل وبعد إدخال أمر الطابور متساويان
balanceAfterEnqueue === balanceBeforeEnqueue
```

- **الاختبار:** `pending_commands_never_affect_any_balance_or_report`
- **متى:** CI — قاعدة ESLint لحدود الطبقات (ADR-018) + اختبار سلوكي دون اتصال.

---

**I15 — الحجز لا يتجاوز الرصيد (تحذير لا منع، ADR-017).** `earmarkedMinor` لكل حساب ≤ `balanceMinor`،
وأي خرق يُرفع تحذيراً صريحاً للمستخدم ويُسجَّل.

```ts
a.earmarkedMinor <= a.balanceMinor || warnings.some(w => w.code === 'EARMARK_EXCEEDED')
```

- **الاختبار:** `earmark_over_balance_raises_explicit_warning_not_silence`
- **متى:** وقت التشغيل (W1 في كل عملية تُنقص رصيداً) + الفاحص الدوري.

---

**I16 — مرآة الحجز متوازنة.** مجموع `earmarkedMinor` على الحسابات يساوي مجموع المبالغ المخصَّصة
على `financialGoals`.

```ts
sumMinor(accounts.map(a => a.earmarkedMinor)) === sumMinor(goals.map(g => g.earmarkedMinor))
```

- **الاختبار:** `account_earmarks_mirror_goal_allocations`
- **متى:** الفاحص الدوري + CI بعد كل عملية تخصيص/إلغاء تخصيص.

---

**I17 — زوج العكس مزدوج ومتكامل.** كل قيد `reversed === true` له `reversedBy` يشير إلى قيد موجود
`kind === 'reversal'` يحمل `reversalOf` راجعاً إليه؛ وكل قيد عكس له `reversalOf` موجود؛
ومجموع الترحيلات الخام يساوي المجموع الفعّال.

```ts
(e.reversed === true) === (e.reversedBy !== null)
&& (e.kind === 'reversal') === (e.reversalOf !== null)
&& entryOf(e.reversedBy).reversalOf === e.entryId
&& entryOf(e.reversalOf).reversedBy === e.entryId
&& sumSigned(allPostings) === sumSigned(allPostings.filter(p => !p.reversed))
```

- **الاختبار:** `reversal_pairing_is_bidirectional_and_nets_to_zero`
- **متى:** وقت التشغيل — `invariant()` في `voidEntry`/`amendEntry` + الفاحص الدوري.
  الشطر الأخير هو ما يُجيز لـ `reconcileAccount` استخدام المجموع الخام (12.14 PHASE 1).

---

**I18 — لا عكس مزدوج.** لكل قيد **قيد عكس واحد على الأكثر**، ولا يُعكس قيد عكس.

```ts
countOf(query(journalEntries, where('reversalOf','==',e.entryId))) <= 1
&& !(e.kind === 'reversal' && e.reversed === true && e.reversedBy !== null)
```

- **الاختبار:** `entry_cannot_be_reversed_twice`
- **متى:** بنيوياً بـ `opId = rev:{entryId}` (G6) ⇒ CI (اختبار «اعكس مرتين من جهازين») + الفاحص الدوري.

---

**I19 — التحويل لا يغيّر إجمالي الأصول إلا بقيمة المصروف فيه.** قيد التحويل لا يحمل أي سطر على
حساب `income`، وفَرْق إجمالي الأصول يساوي سالب مجموع سطور المصروف فيه.

```ts
e.accountTypes.includes('income') === false
&& ΔsumMinor(assetBalances) === negateMinor(sumMinor(expenseLinesOf(e)))
// بلا عمولة: الفرق صفر بالضبط
```

- **الاختبار:** `transfer_preserves_total_assets_except_fees`
- **متى:** CI — اختبار جدولي لكل صف في 12.4 + خاصية (property) على 1000 تحويل عشوائي.

---

**I20 — الاقتراض والإقراض لا يغيّران صافي الثروة.** في `borrowMoney` بفرع `cash` وفي `lendMoney`،
`Σ assets − Σ liabilities` ثابت، ولا سطر على `income` ولا على `expense` تشغيلي.

```ts
netWorthAfter === netWorthBefore
&& e.accountTypes.includes('income') === false
&& e.accountTypes.filter(t => t === 'expense').length === 0
// netWorth = Σ balanceMinor(asset) − Σ balanceMinor(liability)
```

- **الاختبار:** `borrow_and_lend_preserve_net_worth`
- **متى:** CI — اختبار جدولي لـ 12.5 و12.6. وهو الثابت الذي يُبطل بنيوياً فخّ
  `type:'income'/subtype:'debtDrawdown'` المرفوض في 1.3.

---

**I21 — كل مبلغ عدد صحيح.** لا حقل ينتهي بـ `Minor` في أي مستند يحمل قيمة غير صحيحة، ولا `NaN`،
ولا `Infinity`، ولا `null` حيث يُتوقَّع رقم.

```ts
Object.entries(doc).filter(([k]) => k.endsWith('Minor'))
  .every(([, v]) => typeof v === 'number' && Number.isInteger(v))
```

- **الاختبار:** `no_non_integer_minor_field_in_any_document`
- **متى:** وقت التشغيل (Zod في G3) + القواعد (`is int` على كل حقل `*Minor`) + الفاحص الدوري
  (مسح صفحي على كل المجموعات) + CI.

---

**I22 — كل مبلغ داخل النطاق المعلن.** `|x| ≤ MAX_ABS_MINOR = 1_000_000_000_000` لكل حقل `*Minor`.

```ts
Math.abs(v) <= MAX_ABS_MINOR
```

- **الاختبار:** `every_minor_field_within_max_abs_minor`
- **متى:** وقت التشغيل (G3) + القواعد + الفاحص الدوري. هذا هو الحدّ الذي يجعل `mulRate` بـ `BigInt`
  كافياً ومُثبَتاً (2.4).

---

**I23 — `entryId === opId` (ADR-004).** معرّف مستند القيد هو معرّف العملية نفسه، وحقل `opId` داخله
يساويه.

```ts
e.entryId === e.opId && docPath.endsWith(`/journalEntries/${e.opId}`)
// للعمليات متعددة القيود: e.entryId === `${e.opId}__${suffix}` و suffix ∈ {'r','n','1','2',…}
```

- **الاختبار:** `entry_id_equals_op_id_or_deterministic_child`
- **متى:** وقت التشغيل + القواعد (`request.resource.id == request.resource.data.opId` للقيد الأحادي)
  + الفاحص الدوري.

---

**I24 — `payloadHash` حاسم للتعارض.** قيد موجود بنفس `opId` وبنفس `payloadHash` يُنتج
`alreadyApplied` بلا كتابة؛ وبـ `payloadHash` مختلف يُنتج `OP_ID_CONFLICT` بلا كتابة.

```ts
existing && existing.payloadHash === ctx.payloadHash ? writes.length === 0 && result.alreadyApplied
: existing                                           ? error.code === 'OP_ID_CONFLICT'
:                                                      true
```

- **الاختبار:** `same_op_id_different_payload_is_rejected_without_writes`
- **متى:** CI — اختبار محاكي لثلاث حالات (غير موجود / مطابق / مختلف) + خاصية: `canonicalize`
  مستقرة لترتيب مفاتيح مختلف.

---

**I25 — لا قيد في فترة مُقفلة.** لا يُنشأ قيد `periodKey` ضمن `settings.lockedPeriods`، ولا قيد عكس
يُرحَّل في فترة مُقفلة.

```ts
!lockedPeriods.includes(e.periodKey)
```

- **الاختبار:** `no_entry_posted_into_a_locked_period`
- **متى:** وقت التشغيل (G9) + القواعد + الفاحص الدوري.

---

**I26 — سلسلة التصحيح متّسقة (ADR-014).** `entryCorrections/{originalEntryId}.chain` تحتوي كل قيود
العكس والبدائل لذلك الأصل، و`currentEntryId` هو **القيد الوحيد غير المعكوس** في السلسلة،
و`attempt` = نصف طول السلسلة.

```ts
c.chain.length === c.attempt * 2
&& c.chain.filter(id => entryOf(id).reversed === false).length === 1
&& c.chain.filter(id => entryOf(id).reversed === false)[0] === c.currentEntryId
&& entryOf(c.currentEntryId).replaces !== null
```

- **الاختبار:** `amend_chain_has_exactly_one_live_entry`
- **متى:** وقت التشغيل — `invariant()` في `amendEntry` + CI على سيناريو «ثلاث تعديلات متتالية ثم إلغاء»
  + الفاحص الدوري.

---

**I27 — المتبقي مشتق لا مخزَّن.** لا حقل `remainingMinor` مخزَّن في أي مستند؛ والمتبقي المحسوب
لا يكون سالباً أبداً.

```ts
!('remainingMinor' in doc)
&& remainingOf(doc) >= 0
// remainingOf = totalMinor + extraChargesMinor − paidMinor (أو settledMinor)
```

- **الاختبار:** `remaining_is_derived_and_never_negative`
- **متى:** CI (فحص مخطط Zod يرفض الحقل) + الفاحص الدوري + وقت التشغيل عبر G11.

---

**I28 — حساب الضبط = مجموع الكيانات.** رصيد `acc_liab_debts` يساوي مجموع متبقّي كل الديون من نوع
`payable`، ورصيد `acc_asset_recv` يساوي مجموع متبقّي الديون `receivable`.

```ts
balanceOf('acc_liab_debts') === sumMinor(debts.filter(d => d.direction === 'payable')
                                              .map(remainingOf))
&& balanceOf('acc_asset_recv') === sumMinor(debts.filter(d => d.direction === 'receivable')
                                                 .map(remainingOf))
```

- **الاختبار:** `control_account_balances_match_satellite_remainders`
- **متى:** الفاحص الدوري + CI. هذا هو الثابت العرضي الذي **يكشف دفعة دين كُتبت على الدين ولم تُكتب
  على الدفتر أو العكس** — وهو عين ما يفتقده الدفتر الأحادي الجانب (1.3).

---

**I29 — لا كتابة مالية أثناء الصيانة (ADR-015).** أي محاولة إنشاء أو تحديث على
`journalEntries`/`postings`/`accounts`/`accountPeriods`/`obligations`/`debts` بينما
`maintenance/rebuild.state === 'running'` تُرفض من القواعد.

```ts
// في محاكي القواعد:
await assertFails(setDoc(entryRef, validEntry))      // مع البوابة 'running'
await assertSucceeds(setDoc(entryRef, validEntry))   // مع البوابة 'done'
```

- **الاختبار:** `maintenance_gate_blocks_all_financial_writes`
- **متى:** CI — محاكي القواعد حصراً. فحص في الكود وحده لا يُثبت شيئاً عن جهاز آخر.

---

**I30 — القيد المرحَّل غير قابل للتغيير محاسبياً.** لا تحديث على قيد `status === 'posted'` يغيّر
`lines` أو `bookedAt` أو `periodKey` أو `debitTotalMinor` أو `creditTotalMinor` أو `opId`
أو `payloadHash` أو `kind`.

```ts
IMMUTABLE_ENTRY_FIELDS.every(f =>
  deepEqual(request.resource.data[f], resource.data[f]))
// الحقول القابلة للتحديث حصراً: description, notes, tags, attachmentIds,
//   reversed, reversedBy, replacedBy, updatedAt
```

- **الاختبار:** `posted_entry_accounting_fields_are_immutable`
- **متى:** القواعد (المصدر الموثوق الوحيد) + CI بمحاكي القواعد على كل حقل محاسبي حقلاً حقلاً.

---

### 13.2 مستويات الفحص الثلاثة وكيف تُشغَّل

| المستوى | الأداة | ما يُفحص | الأثر عند الفشل |
|---|---|---|---|
| **وقت التشغيل** | `invariant(cond, id, data)` | I1, I4, I8, I13, I15, I17, I21, I22, I23, I25, I26 | يرمي `SystemError` **قبل أي كتابة**، يُسجَّل في `auditLogs` محلياً، ويُعرض «حدث خلل داخلي. لم تُسجَّل العملية.» — **لا يُصطاد إلى الواجهة كخطأ مستخدم** |
| **CI** | Vitest + `@firebase/rules-unit-testing` | I2, I6, I7, I10, I11, I12, I14, I18, I19, I20, I24, I26, I27, I29, I30 | البناء يفشل |
| **الفاحص الدوري** | `auditLedgerIntegrity()` عند تسجيل الدخول | I2, I3, I5 (حساب واحد بالتناوب), I6, I7, I9, I11, I12, I15, I16, I17, I21, I28 | تقرير في «الإعدادات ← سلامة البيانات» + عرض زر `reconcileAccount` / `rebuildProjections` |

```ts
// domain/rules/invariant.ts
export type InvariantId = `I${1|2|3|4|5|6|7|8|9|10|11|12|13|14|15
  |16|17|18|19|20|21|22|23|24|25|26|27|28|29|30}`;

export class InvariantViolation extends Error {
  constructor(readonly id: InvariantId, readonly data: Record<string, unknown>) {
    super(`INVARIANT_${id}`);
  }
}

/** خرق الثابت **عيب برمجي** لا خطأ مستخدم: يُرمى ولا يُصطاد إلى الواجهة. */
export function invariant(
  cond: unknown, id: InvariantId, data: Record<string, unknown> = {},
): asserts cond {
  if (!cond) throw new InvariantViolation(id, data);
}
```

```ts
// domain/ledger/audit.ts
export interface IntegrityFinding {
  invariantId: InvariantId;
  severity: 'info' | 'warning' | 'critical';
  messageAr: string;
  details: Record<string, unknown>;
  suggestedAction: 'none' | 'reconcileAccount' | 'rebuildProjections' | 'contactOwner';
  subjectId?: string;                 // accountId / entryId / obligationId
}

export interface IntegrityReport {
  runAt: string;                      // ISO ليبيا
  checked: InvariantId[];
  findings: IntegrityFinding[];
  readsUsed: number;                  // تكلفة Spark المعلنة لهذا التشغيل
  durationMs: number;
}

/**
 * يُشغَّل مرة عند أول تسجيل دخول في اليوم (مفتاح `audit:${todayLibya}` في IndexedDB).
 * تكلفة التشغيل الكامل: ~45 قراءة حساب + 4 استعلامات تجميعية + حساب واحد بالتناوب لـ I5.
 * I11 (مسح الترحيلات) يُشغَّل **أسبوعياً فقط** لأن تكلفته تتناسب مع حجم الدفتر.
 */
export async function auditLedgerIntegrity(
  scope: 'daily' | 'weekly' | 'full',
): Promise<IntegrityReport>;
```

**أي ثابت `critical` يُغلق مسار الكتابة المالية في الواجهة** ويعرض رسالة واحدة صريحة:
«اكتُشف خلل في سلامة البيانات ({invariantId}). العمليات المالية موقوفة حتى إعادة البناء.»
— تطبيقاً للقسم 25 بند 15: يُشرح السبب الجذري ولا تُخفى رسالة الخطأ.

**تغطية الاختبارات الإلزامية:** كل اسم اختبار في 13.1 ملف واحد أو حالة واحدة تحت
`tests/invariants/<test_name>.test.ts`، و**CI يفشل إن وُجد ثابت `I1…I30` بلا اختبار يحمل اسمه**
(فحص وجود بسيط على أسماء الملفات والحالات).
