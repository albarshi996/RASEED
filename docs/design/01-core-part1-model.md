## 3. شجرة الحسابات والتهيئة الأولى

### 3.1 الأنواع الخمسة وقاعدة الإشارة الطبيعية

`AccountType` خمس قيم فقط، مغلقة إلى الأبد. لا نوع سادس ولا نوع «مختلط».
**الجانب الطبيعي (`normalSide`) دالّة صافية في النوع** — لا يُدخله المستخدم ولا يُحرِّره:

| النوع | العربية | `normalSide` | يزيد بـ | ينقص بـ | الرصيد الظاهر للمستخدم | يدخل «النقد المتاح»؟ |
|---|---|---|---|---|---|---|
| `asset` | أصل | `debit` | `Dr` | `Cr` | `debitTotal − creditTotal` | فقط إن `isCashLike` |
| `liability` | خصم (التزام/دين عليّ) | `credit` | `Cr` | `Dr` | `creditTotal − debitTotal` | ✗ |
| `income` | دخل | `credit` | `Cr` | `Dr` | `creditTotal − debitTotal` | ✗ |
| `expense` | مصروف | `debit` | `Dr` | `Cr` | `debitTotal − creditTotal` | ✗ |
| `equity` | حقوق ملكية | `credit` | `Cr` | `Dr` | `creditTotal − debitTotal` | ✗ |

```ts
// domain/coa/normalSide.ts
export function normalSideOf(t: AccountType): Side {
  return (t === 'asset' || t === 'expense') ? 'debit' : 'credit';
}

/** رصيد الحساب في اتجاهه الطبيعي. موجب = الحساب في وضعه الطبيعي. */
export function naturalBalanceMinor(
  a: Pick<Account, 'type' | 'debitTotalMinor' | 'creditTotalMinor'>,
): Minor {
  const raw = a.debitTotalMinor - a.creditTotalMinor;   // صحيح − صحيح = صحيح
  return (normalSideOf(a.type) === 'debit' ? raw : -raw) as Minor;
}
```

**قرار صريح: لا يُخزَّن `balanceMinor` على الحساب.** يُخزَّن `debitTotalMinor` و`creditTotalMinor` فقط،
والرصيد مشتق بالدالة أعلاه. السبب هو نفس الحجة التي رفضت `deltaSumMinor` في القسم 1.3: رقم ثالث يُكتب
من نفس القيمتين في نفس العبارة **لا يمكنه كشف أي خطأ حسابي**، ويزيد سطح الانحراف بثلاثة أضعاف.
`debitTotalMinor` و`creditTotalMinor` ليسا تكراراً لأن كلاً منهما يحمل معلومة لا تُستخرج من الآخر
(حركة مدينة/دائنة مدى الحياة)، وبهما وحدهما يعمل ميزان المراجعة `Σ debitTotalMinor = Σ creditTotalMinor`.

**لا قيود إقفال سنوية.** حسابات `income` و`expense` تراكمية من بداية العمر، والتقارير تُقطَّع بـ `periodKey`
لا بإقفال. السبب: الإقفال السنوي يُدخل قيوداً لا معنى لها لمستخدم شخصي، ويجعل «مجموع دخل 2026» دالّة في
وجود قيد إقفال صحيح بدل أن يكون مجموعاً مباشراً على `postings`.

### 3.2 معرّف الحساب = رمزه (`accountId === code`)

لا حقل `code` منفصل. **`AccountId` نصّ هرمي منقَّط هو نفسه معرّف المستند**:
`users/{uid}/accounts/asset.cash.main`.

| القاعدة | التفصيل |
|---|---|
| حسابات النظام (seed) | معرّف ثابت دلالي: `asset.cash.main`, `expense.food`, `equity.opening` |
| حساب ينشئه المستخدم | `${parentId}.u_${ulid26}` — مثال `asset.bank.u_01JB8Z7Q4K9M3P6R2T5V8W1X4Y` |
| حساب مرتبط بجهة | `asset.receivable.c_{contactId}` / `liability.payable.c_{contactId}` |
| حساب مرتبط بالتزام مستحق | `liability.obligation.{obligationId}` |
| حساب مرتبط بهدف | `equity.earmark.g_{goalId}` |

**ثلاثة مكاسب ملموسة، لا تجميل:**
1. **التهيئة عديمة التكرار بنيوياً** (idempotent by construction): إعادة تشغيل `seed` تكتب على نفس
   المعرّفات، فلا تُنشأ شجرة ثانية مهما تعدّدت الأجهزة أو انقطع الاتصال — نفس خصيصة ADR-004 مطبَّقة على
   التهيئة بدل القيود.
2. **التصدير مقروء بلا انضمام**: صفّ CSV فيه `expense.food` يُفهَم بلا جدول حسابات.
3. **البادئة = النوع**: `accountId.split('.')[0]` يساوي `type` دائماً (ثابت I-COA-1 مفروض في القواعد
   وفي طبقة النطاق)، فأي سطر يمكن تصنيفه بلا قراءة مستند الحساب.

**الثمن المُعلَن:** المعرّف لا يتغير أبداً حتى لو أعاد المستخدم تسمية الحساب. الاسم المعروض
(`name`) حقل عرض حرّ، والمعرّف هوية. إعادة التسمية تنعكس على كل التاريخ — **وهذا مقصود**: «الحساب
المصرفي» الذي صار «مصرف الجمهورية» هو الحساب نفسه، ولا نُجمِّد الاسم في القيود.

### 3.3 البنود التجميعية (`isPostable: false`)

بعض عقد الشجرة **لا يُسجَّل عليها**، وجودها للتجميع والعرض فقط: `expense.home`, `asset.receivable`,
`liability.payable`, `liability.obligation`, `equity.earmark`.
محاولة الترحيل عليها = `DomainError('ACCOUNT_NOT_POSTABLE')` قبل بناء أي سطر.
فائدتها الملموسة: «إجمالي الديون عليّ» في لوحة التحكم = مجموع الأبناء المباشرين لـ `liability.payable`،
بلا تخمين ولا وسوم.

### 3.4 قائمة التهيئة الأولى (seed) — الحسابات الفعلية

تُنشأ عند **أول تسجيل دخول ناجح** في `writeBatch` واحد (التفاصيل في 3.6).

#### الأصول

| `accountId` | الاسم العربي | `type` | `isPostable` | `isCashLike` | `minBalanceMinor` |
|---|---|---|---|---|---|
| `asset.cash.main` | النقد الشخصي | `asset` | ✓ | ✓ | `0` |
| `asset.bank.main` | الحساب المصرفي | `asset` | ✓ | ✓ | `0` |
| `asset.wallet.main` | المحفظة الإلكترونية | `asset` | ✓ | ✓ | `0` |
| `asset.receivable` | ديون لي (مستحق لي لدى الآخرين) | `asset` | ✗ | ✗ | `0` |

`asset.receivable.c_{contactId}` «مستحق لي — {اسم الجهة}» يُنشأ **عند أول إقراض لتلك الجهة**، لا في التهيئة.
`isCashLike: false` على كل الشجرة المدينة تطبيقاً للقاعدة 19.9 («المبالغ المستحقة للتحصيل لا تُعرض ضمن النقد المتاح»).

#### الدخل

| `accountId` | الاسم العربي | `type` |
|---|---|---|
| `income.salary` | الراتب الشهري | `income` |
| `income.bonus` | المكافآت | `income` |
| `income.sideWork` | الأعمال الإضافية | `income` |
| `income.investment` | الإيرادات الاستثمارية | `income` |
| `income.gift` | الهدايا المالية | `income` |
| `income.other` | دخل آخر | `income` |

كلها `isPostable: true`, `isCashLike: false`, `minBalanceMinor: 0`.
**لا حساب `income` للمبالغ المتوقعة** — تطبيق القسم 7 من المتطلبات: الدخل المتوقع يعيش في
`incomeSchedules` كقالب توقّع، ولا يلمس الدفتر قبل الاستلام الفعلي.

#### المصروف (فئات القسم 6 من المتطلبات)

| `accountId` | الاسم العربي | `isPostable` |
|---|---|---|
| `expense.food` | الطعام والمشروبات | ✓ |
| `expense.transport` | المواصلات والوقود | ✓ |
| `expense.home` | مصاريف المنزل | **✗ (تجميعي)** |
| `expense.home.utilities` | فواتير الخدمات (كهرباء/مياه) | ✓ |
| `expense.home.cleaning` | مستلزمات التنظيف | ✓ |
| `expense.home.maintenance` | الصيانة | ✓ |
| `expense.home.furniture` | الأثاث والأجهزة | ✓ |
| `expense.home.family` | الاحتياجات العائلية | ✓ |
| `expense.home.seasonal` | المصاريف الموسمية | ✓ |
| `expense.shopping` | المشتريات | ✓ |
| `expense.telecom` | الاتصالات والإنترنت | ✓ |
| `expense.health` | الصحة | ✓ |
| `expense.entertainment` | الترفيه | ✓ |
| `expense.gifts` | الهدايا | ✓ |
| `expense.subscriptions` | الاشتراكات | ✓ |
| `expense.travel` | السفر | ✓ |
| `expense.emergency` | المصروفات الطارئة | ✓ |
| `expense.zakatCharity` | الزكاة والصدقات | ✓ |
| `expense.financeCharges` | فوائد وغرامات ورسوم | ✓ |
| `expense.other` | مصروفات أخرى | ✓ |

ثلاثة حسابات ليست في قائمة المتطلبات وأُضيفت بسبب تقني مُعلَن:
- `expense.zakatCharity` — القسم 15.4 يفصل احتساب الزكاة عن دفعها؛ الدفع يحتاج حساب مصروف حقيقياً.
- `expense.financeCharges` — مقصد `extraChargesMinor` في ADR-012: الغرامة مصروف، وليست زيادة في `totalMinor`.
- `expense.other` — صمّام: لا تُحجَب عملية على المستخدم لعدم وجود فئة. وجوده يمنع «إنشاء فئة على عجل» وقت الإدخال.

**«المواد الغذائية» في القسم 11 ليست حساباً جديداً** — هي `expense.food` بـ `scope: 'household'`.
هذا هو التطبيق الحرفي لنص القسم 11: «تظهر مصاريف المنزل في التقارير العامة دون تكرار قيمتها».

#### الخصوم

| `accountId` | الاسم العربي | `type` | `isPostable` |
|---|---|---|---|
| `liability.payable` | ديون عليّ | `liability` | ✗ |
| `liability.obligation` | التزامات مستحقة | `liability` | ✗ |

الأبناء يُنشَأون عند الحاجة: `liability.payable.c_{contactId}` «دين لـ {اسم الدائن}»،
و`liability.obligation.{obligationId}` **فقط** إذا كان الالتزام `nature: 'financing'` أو مُستحقاً بأسلوب
الاستحقاق (`accrualEnabled: true`). الالتزام النقدي العادي (إيجار، كهرباء) **لا حساب خصم له**
تطبيقاً للقاعدة 19.4 — إنشاء التزام غير مدفوع لا يلمس الدفتر إطلاقاً.

#### حقوق الملكية

| `accountId` | الاسم العربي | `type` | `isPostable` | سبب وجوده |
|---|---|---|---|---|
| `equity.opening` | حقوق الملكية الافتتاحية | `equity` | ✓ | الطرف المقابل لكل رصيد افتتاحي (3.5) |
| `equity.unallocated` | غير مخصص | `equity` | ✓ | الطرف المقابل لتخصيص الأهداف (ADR-017) |
| `equity.adjustment` | تسويات الأرصدة | `equity` | ✓ | الطرف المقابل لعملية `Adjust` |
| `equity.earmark` | مخصصات الأهداف | `equity` | ✗ | أب تجميعي لـ `equity.earmark.g_{goalId}` |

**لماذا طرف `Adjust` هو `equity.adjustment` لا `expense.other`/`income.other`؟**
لأن التسوية ليست مصروفاً ولا دخلاً: هي إقرار بأن القياس كان خاطئاً. توجيهها إلى حساب مصروف
**يضخّم تقرير المصروفات** — خرق مباشر للقاعدة 19.11. وبوجودها في حقوق الملكية يظل ميزان المراجعة
متوازناً، ويبقى مبلغ التسويات مرئياً وقابلاً للمراجعة في مستند واحد.

**العدد الإجمالي للتهيئة: 37 مستند حساب** (4 أصول + 6 دخل + 20 مصروف + 2 خصوم + 4 حقوق ملكية + مستند
`meta/coa`). هذا هو الرقم الذي تقوم عليه حجة «ميزان المراجعة بقراءة ~45 مستنداً» في القسم 1.2،
ويبقى صحيحاً حتى بإضافة ~8 جهات وأهداف.

### 3.5 الرصيد الافتتاحي: قيد متوازن، لا حقل حرّ

**لا يوجد حقل `openingBalanceMinor` على `Account`.** الرصيد الافتتاحي **عملية** لها قيد،
فهو مرئي في كشف الحساب وقابل للعكس والتعديل مثل أي قيد آخر. القاعدة 19 بند «لا يُسمح بتعديل الرصيد
الحالي يدوياً» تصبح مفروضة بنيوياً: لا سبيل إلى تغيير رصيد إلا بقيد.

**القيد الدقيق لرصيد افتتاحي موجب على حساب أصل (1,250.500 د.ل في المصرف):**

```ts
{
  entryId: 'open:asset.bank.main',          // === opId، حتمي ⇒ لا رصيد افتتاحي مزدوج أبداً
  opId:    'open:asset.bank.main',
  kind:    'opening',
  bookedAt:  '2026-10-09',
  periodKey: '2026-10',                      // ≡ bookedAt[0:7] — ADR-008
  lines: [
    { lineNo: 1, accountId: 'asset.bank.main', accountType: 'asset',
      side: 'debit',  amountMinor: 1_250_500, scope: 'personal', categoryId: null },
    { lineNo: 2, accountId: 'equity.opening',  accountType: 'equity',
      side: 'credit', amountMinor: 1_250_500, scope: 'personal', categoryId: null },
  ],
  debitTotalMinor:  1_250_500,
  creditTotalMinor: 1_250_500,
  memo: 'رصيد افتتاحي — الحساب المصرفي',
  reversed: false, reversalOf: null,
}
```

| الحالة | `Dr` | `Cr` | مثال |
|---|---|---|---|
| رصيد موجب على `asset` | الحساب `X` | `equity.opening` `X` | نقد 500.000 |
| رصيد سالب على `asset` (سحب على المكشوف) | `equity.opening` `X` | الحساب `X` | محفظة بـ −25.000 |
| رصيد قائم على `liability` (دين سابق) | `equity.opening` `X` | حساب الخصم `X` | دين قديم 2,000.000 |
| حساب جديد برصيد صفر | **لا قيد إطلاقاً** | — | لا سطر بمبلغ صفر (ثابت I2) |

**`opId` حتمي: `open:{accountId}`.** لا UUID. هذا يجعل «رصيد افتتاحي مكرر» حالة مستحيلة لا حالة يجب
فحصها: الكتابة الثانية تفشل على شرط `exists == false` في القواعد وفي `runTransaction`.
وتعديل الرصيد الافتتاحي لاحقاً = `AmendEntry` على `open:{accountId}` (قسم 8)، لا كتابة ثانية.

### 3.6 سكربت التهيئة

```ts
// data/seed/seedChartOfAccounts.ts
/**
 * يُنفَّذ بعد أول تسجيل دخول ناجح، وعند كل تسجيل دخول يقرأ meta/coa فقط (قراءة واحدة).
 * عديم التكرار بثلاث طبقات: معرّفات ثابتة + حقل seedVersion + create-only في القواعد.
 */
export async function seedChartOfAccounts(uid: string): Promise<SeedResult> {
  const metaRef = doc(db, `users/${uid}/meta/coa`);
  const meta = await getDoc(metaRef);
  if (meta.exists() && meta.data().seedVersion >= CURRENT_SEED_VERSION) return { skipped: true };

  const batch = writeBatch(db);                      // 37 كتابة < 500 — دفعة واحدة ذرّية
  for (const a of SEED_ACCOUNTS) {                   // SEED_ACCOUNTS ثابت مُجمَّد في domain/coa
    batch.set(doc(db, `users/${uid}/accounts/${a.accountId}`), {
      ...a, ownerUid: uid, schemaVersion: 1,
      debitTotalMinor: 0, creditTotalMinor: 0,        // لا رصيد افتتاحي هنا — 3.5
      earmarkedMinor: 0, entryCount: 0,
      lastPostedEntryId: null, lastPostedAt: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: false });                             // merge:false مقصود — لا دمج على موجود
  }
  batch.set(metaRef, { seedVersion: CURRENT_SEED_VERSION, seededAt: serverTimestamp() });
  await batch.commit();
  return { skipped: false, created: SEED_ACCOUNTS.length };
}
```

**`writeBatch` لا `runTransaction`، ولماذا:** لا قراءة يعتمد عليها القرار داخل الدفعة (الحماية في
`merge: false` + قاعدة `create`-only + `seedVersion`)، و`writeBatch` أرخص وأبسط. العرَض الوحيد
(جهازان يُهيّئان في نفس اللحظة) ينتهي بنفس النتيجة بالضبط لأن المحتوى حتمي.
**التهيئة لا تحتاج اتصالاً** خلافاً للعمليات المالية (ADR-007) لأنها لا تستخدم `runTransaction`؛
الدفعة تُحفَظ محلياً وتُزامن لاحقاً، والشجرة تظهر للمستخدم فوراً.

**ترقية الشجرة لاحقاً (`CURRENT_SEED_VERSION = 2`):** تُضاف الحسابات الجديدة فقط ولا يُلمس الموجود،
ولا يُحذف حساب أبداً (ADR-019: الترحيل للمشتقات، والحسابات كيان دائم).

### 3.7 الفئات مقابل الحسابات — الحسم

> **القرار: كل فئة مصروف هي حساب `expense`. لا مجموعة `categories` في النظام.
> و`categoryId` على السطر هو اسم مستعار مُلزَم بثابت: `categoryId === accountId` لكل سطر نوعه `expense`.**

| البديل | ما يكسبه | سبب الرفض |
|---|---|---|
| **مجموعة `categories` منفصلة تشير إلى حساب** | فئات كثيرة تتشارك حساباً واحداً، وإعادة تصنيف تاريخية بتغيير إشارة واحدة | **مصدران للحقيقة لنفس السؤال.** «كم أنفقت على الطعام؟» يصبح جوابه دالّة في اتساق `categories→account`، وأول انحراف (فئة تشير إلى حساب معطَّل، أو حساب بلا فئة) يعطي تقريراً ناقصاً **بلا أي ثابت يكشفه** — وهذا بالضبط ما قتل البدائل في القسم 1.3. يُضاف: الميزانية تُجمَّع بـ `categoryId` والتقرير بـ `accountType` ⇒ رقمان مختلفان لنفس الشهر |
| **`categoryId` حرّ غير مربوط بالحساب** | مرونة إدخال | يسمح بمصروف على `expense.food` مصنَّف «سفر» ⇒ «مجموع الفئات ≠ مجموع المصروفات»، خرق القسم 23 بند 12 |

**لماذا نُبقي `categoryId` إذاً وهو مكرَّر؟** لسببين ملموسين، لا للتجميل:
1. **`postings` المسطَّحة تُجمَّع خادمياً بالاسم الذي يستخدمه النطاق.** استعلام الميزانية هو
   `where categoryId == 'expense.food' and periodKey == '2026-10'` ولا يحتاج معرفة أن الفئة = حساب.
   وهذا يسمح بتغيير القرار لاحقاً **بلا ترحيل**: لو أراد المالك يوماً علاقة «عدة فئات ← حساب واحد»،
   يُرخى الثابت ويبقى مخطط `postings` و`accounts` كما هو حرفياً.
2. **السطور غير المصروفية تحمل `categoryId: null` إلزاماً**، فأي مجموع على `categoryId` يستحيل أن
   يلتقط طرف النقد ويضاعف الرقم.

```ts
// domain/rules/invariants.ts
/** I-COA-2 — مفروض في planOperation وفي assertEntryInvariants وفي Firestore Rules. */
export function assertCategoryAlias(l: JournalLine): void {
  if (l.accountType === 'expense') invariant(l.categoryId === l.accountId, 'CATEGORY_MISMATCH');
  else                             invariant(l.categoryId === null,        'CATEGORY_MISMATCH');
}
```

**تعطيل فئة دون الإضرار بالسجلات (القسم 6 من المتطلبات):**

| الإجراء | الأثر |
|---|---|
| `status: 'active' → 'archived'` | كتابة واحدة على مستند الحساب. **لا شيء آخر يتغير** |
| قيود تاريخية تستخدمه | تبقى كما هي؛ تُقرأ وتُعرَض وتدخل كل مجموع — الحساب موجود، اسمه موجود |
| محاولة ترحيل جديد عليه | `DomainError('ACCOUNT_ARCHIVED')` من `planOperation`، **قبل** بناء السطور |
| ظهوره في قوائم الاختيار | مُخفى. يظهر في المرشِّحات والتقارير بوسم «معطَّل» إن كان له حركة في الفترة |
| إعادة التنشيط | `'archived' → 'active'`، كتابة واحدة، بلا أي أثر على التاريخ |
| الحذف | **ممنوع تماماً.** لا مسار في الواجهة ولا في القواعد. حساب له حركة لا يُحذف أبداً، وحساب بلا حركة يُؤرشَف لا يُحذف — لأن «بلا حركة» عند جهاز قد يكون «له حركة» عند آخر لم يُزامن |
| `isSystem: true` | يُمنع تغيير `type` و`parentId` و`isPostable`؛ تُسمح `name` و`sortOrder` و`status` فقط. الحسابات الأربعة في `equity` و`asset.receivable` و`liability.*` **لا تُؤرشَف** (`isArchivable: false`) لأن النواة تكتب عليها تلقائياً |

**الفئة الفرعية** = ابن في الشجرة (`expense.home.utilities`)، والأب تجميعي. لا حقل `subcategoryId`
منفصل: العمق في المعرّف، والتجميع بـ `where accountId >= 'expense.home.' and accountId < 'expense.home0'`
أو بقراءة الأبناء من لقطة الحسابات الحاضرة أصلاً في الذاكرة.

### 3.8 `scope: 'personal' | 'household'` — يعيش على **السطر**

> **القرار: `scope` حقل إلزامي على `JournalLine` (ومنه على `Posting`)، وليس على `JournalEntry`.**
> على القيد يوجد فقط `scopes: Scope[]` **مشتق** (قيم `lines[].scope` المميَّزة) لتصفية القوائم بـ `array-contains`.

**السبب الأول — الواقع ينقسم داخل القيد الواحد:** تسوّق واحد بـ 85.000 د.ل: 60.000 مواد منزلية
و25.000 شخصية. بـ `scope` على القيد يكون أمام المطوّر خيارَان كلاهما خاسر: تقسيمه إلى قيدين (كذب على
المستخدم: عملية واحدة تظهر عمليتين، وإلغاء أحدهما يترك الآخر) أو تصنيف الكل بتصنيف واحد (رقم المنزل خاطئ).
بـ `scope` على السطر القيد واحد وسطوره ثلاثة:

```ts
lines: [
  { lineNo: 1, accountId: 'expense.home.cleaning', accountType: 'expense',
    side: 'debit',  amountMinor: 60_000, scope: 'household', categoryId: 'expense.home.cleaning' },
  { lineNo: 2, accountId: 'expense.shopping',      accountType: 'expense',
    side: 'debit',  amountMinor: 25_000, scope: 'personal',  categoryId: 'expense.shopping' },
  { lineNo: 3, accountId: 'asset.cash.main',       accountType: 'asset',
    side: 'credit', amountMinor: 85_000, scope: 'personal',  categoryId: null },
]
```

**السبب الثاني — هو أساس منع الازدواج في تقرير المنزل، حرفياً.** تقرير المنزل ليس مجموعاً ثانياً بل
**مجموع فرعي بنفس الحبيبة التي تُجمَّع بها الأرقام العامة**، على نفس المجموعة وبنفس الدالة:

```ts
// مصروف الشهر الكلي
sum(postings where accountType=='expense' and periodKey==pk → debitMinor − creditMinor)
// مصروف المنزل: نفس الاستعلام + مرشِّح واحد
sum(postings where accountType=='expense' and scope=='household' and periodKey==pk → debitMinor − creditMinor)
```
فالعلاقة `مصروف المنزل ≤ المصروف الكلي` **صحيحة رياضياً لا بالاتفاق**، ولا سبيل إلى جمعهما لأنهما
مجموعان على نفس الصفوف. تصنيف على القيد كان سيجبر تقرير المنزل على المرور بالقيود وجمع
`entry.debitTotalMinor` — وهو يشمل **طرف النقد أيضاً**، فيعطي ضعف الرقم أو يخلط الفئات.

**السبب الثالث — القيد الصارم الذي يمنع الازدواج فعلاً:** مجاميع `scope` تُقرأ **فقط من سطور
`accountType === 'expense'`**. سطر النقد في المثال أعلاه `scope: 'personal'` وهو **مُهمَل تماماً** في كل
تقرير نطاق. هذا ثابت مكتوب ومُختبَر:

```ts
// domain/rules/invariants.ts
/** I-SCOPE-1: لا مجموع نطاق على سطر ليس expense. يُفرَض بأن الدالة الوحيدة المسموحة هي هذه. */
export function scopedExpenseMinor(ps: readonly Posting[], s: Scope): Minor {
  return sumMinor(ps.filter(p => p.accountType === 'expense' && p.scope === s)
                    .map(p => (p.debitMinor - p.creditMinor) as Minor));
}
```

**القيمة الافتراضية:** `scope` على سطور المصروف يأتي من الطلب (`RecordExpense.splits[].scope`)،
وعلى كل سطر آخر **يُكتب `'personal'` دائماً** ولا يُقرأ أبداً. لم نجعله `null` لأن حقلاً اختيارياً
يفتح الباب لمرشِّح `scope == 'household'` ينسى السطور `null` ويعطي رقماً ناقصاً صامتاً.
القاعدة أبسط: الحقل موجود دائماً، والدالة الوحيدة التي تقرؤه تُصفّي بـ `accountType` أولاً.

---

## 4. واجهات TypeScript الكاملة للنواة

> تُنسَخ حرفياً إلى `src/domain/types/`. صفر استيراد من `firebase` ومن `data` (ADR-018).
> `Timestamp` **لا يظهر هنا**: النطاق لا يعرف أنواع Firestore. كل زمن إمّا `ISODate` (محاسبي)
> أو `EpochMs` (تدقيق)، والتحويل إلى `Timestamp` مسؤولية `data/` وحدها.

```ts
/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/primitives.ts
   ═══════════════════════════════════════════════════════════════════════════ */

/** مبلغ بالوحدة الصغرى (الدرهم الليبي، أُسّ 3). عدد صحيح. موسوم حتى يستحيل خلطه بعدد عادي. */
export type Minor = number & { readonly __minor: unique symbol };

/** نسبة بأساس النقطة: 1 bps = 0.01%. عدد صحيح 0..1_000_000. */
export type Bps = number & { readonly __bps: unique symbol };

/** تاريخ محاسبي 'YYYY-MM-DD' بتوقيت ليبيا الثابت (UTC+2، لا توقيت صيفي). */
export type ISODate = string & { readonly __isoDate: unique symbol };

/** مفتاح الفترة 'YYYY-MM'. ثابت ADR-008: periodKey ≡ bookedAt[0:7] دائماً، بلا استثناء. */
export type PeriodKey = string & { readonly __periodKey: unique symbol };

/** لحظة بالمللي ثانية منذ 1970 — للتدقيق والترتيب التشخيصي فقط، لا للمحاسبة. */
export type EpochMs = number & { readonly __epochMs: unique symbol };

/** معرّف الحساب = رمزه الهرمي = معرّف المستند. مثال: 'expense.home.utilities' (3.2). */
export type AccountId = string & { readonly __accountId: unique symbol };

/** معرّف العملية: يولّده العميل قبل أي اتصال (ULID). مفتاح منع الازدواج الوحيد (ADR-004). */
export type OpId = string & { readonly __opId: unique symbol };

/** معرّف القيد. ثابت ADR-004: entryId === opId. نوع منفصل لأن AmendEntry يشير إلى قيد لا إلى عملية. */
export type EntryId = string & { readonly __entryId: unique symbol };

export type ContactId = string & { readonly __contactId: unique symbol };
export type ObligationId = string & { readonly __obligationId: unique symbol };
export type DebtId = string & { readonly __debtId: unique symbol };
export type GoalId = string & { readonly __goalId: unique symbol };
export type BudgetId = string & { readonly __budgetId: unique symbol };

/** جانب القيد. لا قيمة ثالثة. */
export type Side = 'debit' | 'credit';

/** تصنيف النطاق (3.8). يعيش على السطر، لا على القيد. */
export type Scope = 'personal' | 'household';

/** العملة. محجوزة للتوسعة؛ لا تعدد عملات في الإصدار الأول (القسم 2.1). */
export type Currency = 'LYD';

export const MAX_ABS_MINOR = 1_000_000_000_000;      // القسم 2.1
export const LIBYA_UTC_OFFSET_MINUTES = 120;         // ثابت، بلا توقيت صيفي

/** تاريخ اليوم بتوقيت ليبيا. الدالة الوحيدة المسموح لها إنتاج ISODate من زمن حقيقي. */
export function todayInLibya(now: number = Date.now()): ISODate {
  return new Date(now + LIBYA_UTC_OFFSET_MINUTES * 60_000)
    .toISOString().slice(0, 10) as ISODate;
}

/** ADR-008 مُجسَّداً في دالة واحدة. أي حساب آخر لـ periodKey في النظام = خطأ بناء. */
export function periodKeyOf(d: ISODate): PeriodKey {
  return d.slice(0, 7) as PeriodKey;
}

/**
 * نوع الحساب من معرّفه (ثابت I-COA-1: البادئة = النوع، القسم 3.2).
 * تغني عن قراءة مستند الحساب في كل مكان يُبنى فيه مُجمَّع.
 */
export function typeOf(id: AccountId): AccountType {
  return id.slice(0, id.indexOf('.')) as AccountType;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/account.ts
   ═══════════════════════════════════════════════════════════════════════════ */

export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export type AccountStatus = 'active' | 'archived';   // لا 'deleted' — الحذف غير موجود (3.7)

/** users/{uid}/accounts/{accountId} */
export interface Account {
  /** = معرّف المستند = الرمز الهرمي. بادئته تساوي `type` دائماً (ثابت I-COA-1). */
  readonly accountId: AccountId;
  /** نسخة المخطط. تُقرأ عند القراءة للترحيل البطيء (ADR-019). */
  schemaVersion: number;
  /** مالك المستند. مكرَّر عن قصد: تستخدمه القواعد وتستخدمه عملية التصدير/الاستيراد. */
  readonly ownerUid: string;

  /** النوع. يحدد `normalSide` وكل سلوك التقارير. لا يتغير بعد الإنشاء أبداً. */
  readonly type: AccountType;
  /** الجانب الطبيعي. مخزَّن مع أنه مشتق من `type`، لأن قواعد Firestore لا تستطيع استدعاء دالة. */
  readonly normalSide: Side;
  /** الأب في الشجرة. `null` للجذور. يحدد التجميع في لوحة التحكم. */
  readonly parentId: AccountId | null;
  /** العمق (0 للجذر). مخزَّن لتفادي حساب الشجرة عند كل رسم للقائمة. */
  readonly depth: number;

  /** الاسم المعروض بالعربية. حقل عرض حرّ قابل للتغيير؛ الهوية في `accountId` (3.2). */
  name: string;
  /** وصف اختياري يظهر في شاشة إدارة الحسابات. */
  description?: string;
  /** أيقونة من مجموعة الأيقونات الموحدة. عرض فقط. */
  icon?: string;
  /** رمز لون من نظام التصميم (لا قيمة hex) — ليعمل في الوضعين الفاتح والداكن. */
  colorToken?: string;
  /** ترتيب العرض داخل الأب. يُحرِّره المستخدم بالسحب. */
  sortOrder: number;

  /** هل يُسجَّل عليه مباشرة؟ `false` = بند تجميعي (3.3). */
  readonly isPostable: boolean;
  /** هل يدخل «إجمالي الأموال المتاحة»؟ القاعدة 19.9 تمنعه على المستحقات. */
  readonly isCashLike: boolean;
  /** حساب نظام: `type`/`parentId`/`isPostable` مقفلة، والاسم والترتيب مسموحان (3.7). */
  readonly isSystem: boolean;
  /** هل يُسمح بأرشفته؟ `false` لحسابات تكتب عليها النواة تلقائياً. */
  readonly isArchivable: boolean;

  /** العملة. دائماً 'LYD' في الإصدار الأول؛ موجود حتى لا يكون إضافته ترحيلاً لكل القيود. */
  readonly currency: Currency;

  /**
   * أدنى رصيد مسموح، **موقَّع** (ADR-010). `0` = لا سالب. `-500_000` = سحب على المكشوف 500 د.ل.
   * حلّ محلّ `allowNegative` البولياني لأن البولياني لا يعرف «مسموح بسالب حتى حد».
   */
  minBalanceMinor: Minor;

  /** المحجوز لأهداف والتزامات: مرآة مشتقة لا مصدر حقيقة (ADR-017، القسم 5.6). */
  earmarkedMinor: Minor;

  /** مجموع السطور المدينة مدى العمر. أحد نصفَي مصدر الرصيد. يُزاد بـ increment فقط. */
  debitTotalMinor: Minor;
  /** مجموع السطور الدائنة مدى العمر. النصف الثاني. `Σ debit = Σ credit` على كل الشجرة = ميزان المراجعة. */
  creditTotalMinor: Minor;
  /** عدد القيود المؤثرة. يكشف «كتابة مفقودة» حين يطابق الرصيد بالمصادفة (الثابت I7). */
  entryCount: number;
  /** آخر قيد أثّر عليه. للتشخيص ولعرض «آخر حركة» بلا استعلام. */
  lastPostedEntryId: EntryId | null;
  /** تاريخ آخر حركة محاسبية (ISODate لا Timestamp) — يُعرض في قائمة الحسابات. */
  lastPostedAt: ISODate | null;

  status: AccountStatus;

  /** الجهة المرتبطة — موجود فقط على `asset.receivable.c_*` و`liability.payable.c_*`. */
  readonly linkedContactId?: ContactId;
  /** الالتزام المرتبط — على `liability.obligation.*` فقط. */
  readonly linkedObligationId?: ObligationId;
  /** الهدف المرتبط — على `equity.earmark.g_*` فقط. */
  readonly linkedGoalId?: GoalId;

  /** لحظة الإنشاء (تدقيق). */
  readonly createdAt: EpochMs;
  /** لحظة آخر تعديل على حقول الوصف أو الحالة — لا تتغير مع كل قيد (المجاميع لها حقولها). */
  updatedAt: EpochMs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/journal.ts
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntryKind =
  | 'opening'            // رصيد افتتاحي (3.5)
  | 'expense'            // مصروف حقيقي
  | 'income'             // دخل حقيقي مستلم
  | 'transfer'           // تحويل: طرفاه asset ⇒ لا دخل ولا مصروف بنيوياً (19.3)
  | 'obligationPayment'  // دفع التزام (19.5)
  | 'borrow'             // استلام قرض: أصل ↑ وخصم ↑ — ليس دخلاً (19.6)
  | 'debtRepayment'      // سداد دين عليّ: خصم ↓ وأصل ↓ — ليس مصروفاً (19.8)
  | 'lend'               // إقراض: مستحق لي ↑ ونقد ↓ — ليس مصروفاً
  | 'debtCollection'     // تحصيل: نقد ↑ ومستحق لي ↓ — ليس دخلاً (19.7)
  | 'earmark'            // تخصيص لهدف داخل حقوق الملكية — لا يمس النقد (ADR-017)
  | 'adjustment'         // تسوية مبرَّرة مقابل equity.adjustment
  | 'reversal';          // قيد عكس (ADR-006)

/** سطر القيد. مُضمَّن في مستند القيد ⇒ «القيد اليتيم» مستحيل بنيوياً (القسم 1.3). */
export interface JournalLine {
  /** 1-based، ثابت إلى الأبد. مفتاح `Posting` و`EntryCorrection` يشير إليه. */
  readonly lineNo: number;
  readonly side: Side;
  readonly accountId: AccountId;
  /**
   * نوع الحساب، مكرَّر عن قصد: يجعل تصنيف دخل/مصروف دالّة في السطر وحده،
   * فلا تقرير يحتاج قراءة مستندات الحسابات، ولا نتيجة تتغير إن أُعيد تصنيف حساب.
   */
  readonly accountType: AccountType;
  /** **موجب دائماً وصحيح**. لا سطر بصفر ولا بسالب (ثابت I2). الإشارة في `side` لا في الرقم. */
  readonly amountMinor: Minor;
  /** النطاق (3.8). إلزامي على كل سطر؛ يُقرأ فقط على سطور `expense` (ثابت I-SCOPE-1). */
  readonly scope: Scope;
  /** === accountId على سطور expense، و null على غيرها (ثابت I-COA-2، القسم 3.7). */
  readonly categoryId: AccountId | null;
  /**
   * أثر هذا السطر على `paidMinor`/`settledMinor` للكيان في `refs` (ADR-021).
   * موجب = سداد/تحصيل، سالب = عكس سداد، `0` = لا أثر. **هو المصدر المستقل**
   * الذي يُتحقَّق به من مُجمَّعات الالتزام والدين بـ `sum()` خادمي بلا قراءة الدفعات.
   */
  readonly settlementDeltaMinor: Minor;
  /** روابط هذا السطر بالكيانات التشغيلية. على السطر لا على القيد: دفعة واحدة قد تمسّ التزامين. */
  readonly refs: LineRefs;
  /** ملاحظة سطر (مثل «حصة الكهرباء»). عرض وتصدير فقط. */
  readonly memo?: string;
}

export interface LineRefs {
  /** الالتزام الذي يسدّده هذا السطر. مفتاح استعلام سجل الدفعات (ADR-005: لا مجموعة دفعات). */
  readonly obligationId?: ObligationId;
  /** رقم القسط داخل الالتزام (1-based)، إن كان السداد مرتبطاً بقسط محدد. */
  readonly installmentIndex?: number;
  /** الدين (عليّ أو لي) الذي يمسّه السطر. */
  readonly debtId?: DebtId;
  /** الجهة (دائن/مدين/جهة مستفيدة). */
  readonly contactId?: ContactId;
  /** الهدف المالي — على سطور `earmark` وعلى تحويل إلى حساب هدف. */
  readonly goalId?: GoalId;
  /** قالب التكرار الذي ولّد القيد + مفتاح الدورة — يمنع التوليد المزدوج (ADR-013). */
  readonly recurringId?: string;
  readonly occurrenceKey?: string;      // 'YYYY-MM-DD' للدورة
}

/** users/{uid}/journalEntries/{entryId} — السطور مُضمَّنة (ADR-002). */
export interface JournalEntry {
  /** = معرّف المستند = `opId` (ADR-004). منع الازدواج خصيصة في المفتاح لا منطق تطبيقي. */
  readonly entryId: EntryId;
  /** نفس القيمة. موجود صريحاً حتى يعمل التصدير والتدقيق بلا الاعتماد على معرّف المستند. */
  readonly opId: OpId;
  /**
   * SHA-256 لحمولة الطلب المُقنَّنة. يكشف «نفس opId بحمولة مختلفة» = خطأ برمجي أو جهاز
   * أعاد إرسال طلب عُدِّل محلياً ⇒ `OP_ID_CONFLICT` بدل كتابة صامتة خاطئة.
   */
  readonly payloadHash: string;
  schemaVersion: number;
  readonly ownerUid: string;

  readonly kind: EntryKind;
  /** التاريخ المحاسبي بتوقيت ليبيا. هو وحده يحدد الفترة. */
  readonly bookedAt: ISODate;
  /** ≡ bookedAt[0:7]، بلا استثناء (ADR-008). مخزَّن ليُفهرَس ويُجمَّع خادمياً. */
  readonly periodKey: PeriodKey;

  /** السطور. الطول ≥ 2 دائماً (ثابت I2). */
  readonly lines: readonly JournalLine[];
  /** مجموع المدين. = `creditTotalMinor` دائماً (ثابت I1، مفروض في القواعد أيضاً). */
  readonly debitTotalMinor: Minor;
  readonly creditTotalMinor: Minor;

  /** الحسابات المتأثرة، مشتق ومميَّز — لاستعلام `array-contains` في كشف الحساب. */
  readonly accountIds: readonly AccountId[];
  /** أنواع الحسابات المتأثرة، مشتق ومميَّز — لتصفية القوائم بلا قراءة السطور. */
  readonly accountTypes: readonly AccountType[];
  /** قيم `lines[].scope` المميَّزة — لتصفية قائمة عمليات المنزل بـ `array-contains` (3.8). */
  readonly scopes: readonly Scope[];

  /** وصف عربي إلزامي غير فارغ — القسم 25 بند 18. */
  description: string;
  /** ملاحظة حرّة. الحقل الوحيد القابل للتعديل بلا قيد تصحيح (جدول القسم 8). */
  memo?: string;
  /** وسوم المستخدم الحرّة (ليست `scope`، وليست فئة). بحث وتصفية فقط. */
  tags?: readonly string[];

  /** معرّفات المرفقات. **الواجهة معطَّلة على Spark (ق-1)** والحقل موجود في المخطط من الآن. */
  attachments?: readonly string[];

  /** هل عُكس هذا القيد؟ للعرض وتصفية القوائم. **لا مجموع يحتاجه** (العكس يُصفِّر نفسه، القسم 1.2). */
  reversed: boolean;
  /** القيد الذي عكسه. */
  reversedByEntryId?: EntryId;
  /** إن كان هذا القيد نفسه قيد عكس: أي قيد يعكس. `null` لغير قيود العكس. */
  readonly reversalOf: EntryId | null;
  /** القيد البديل في عملية التعديل (ADR-006: عكس + بديل في معاملة واحدة). */
  replacedByEntryId?: EntryId;
  readonly replacesEntryId?: EntryId;
  /** سبب العكس/التعديل بالعربية. إلزامي على كل قيد `reversal` وكل قيد بديل. */
  readonly correctionReason?: string;

  /** لحظة الكتابة على الخادم (يُحوَّلها `data/` إلى serverTimestamp). للترتيب المستقر. */
  readonly createdAt: EpochMs;
  /** لحظة إنشاء الطلب على الجهاز. للتدقيق وكشف فجوات الطابور — لا للترتيب. */
  readonly clientCreatedAt: EpochMs;
  /** معرّف الجهاز. لتشخيص تعارضات التزامن بين الهاتف والحاسوب (القسم 23 بند 9). */
  readonly deviceId: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/posting.ts — الإسقاط المسطَّح (ADR-002)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * users/{uid}/postings/{entryId}:{lineNo}
 *
 * صفّ واحد لكل سطر قيد. **غير قابل للتعديل بعد الإنشاء** (القواعد: create فقط، لا update ولا delete).
 * سببه الوحيد: `getAggregateFromServer(sum())` لا يدخل داخل المصفوفات، وسطورنا مصفوفة.
 * لا يحمل أي حقل دورة حياة (`reversed`, `status`) لأن العكس يُنشئ صفوفاً معاكسة
 * ⇒ كل مجموع صحيح بلا منطق استبعاد، وكل عملية إلغاء تكتب ولا تُعدِّل.
 */
export interface Posting {
  /** = `${entryId}:${lineNo}` — حتمي ⇒ إعادة المحاولة لا تُنشئ صفاً ثانياً. */
  readonly postingId: string;
  readonly entryId: EntryId;
  readonly opId: OpId;                  // للربط بالطابور وبسجل التدقيق
  readonly lineNo: number;
  schemaVersion: number;
  readonly ownerUid: string;

  readonly accountId: AccountId;        // مرشِّح كشف الحساب والتجميع على مستوى الحساب
  readonly accountType: AccountType;    // مرشِّح تقارير الدخل/المصروف بلا انضمام
  readonly side: Side;                  // للعرض والتصدير؛ المجاميع تستخدم الحقلين التاليين
  /** المبلغ المدين، أو `0`. حقلان لا حقل واحد مع `side`: فـ `sum('debitMinor')` يعمل بفهرس واحد. */
  readonly debitMinor: Minor;
  /** المبلغ الدائن، أو `0`. أحدهما صفر دائماً وكلاهما غير سالب. */
  readonly creditMinor: Minor;

  readonly bookedAt: ISODate;           // نطاقات التاريخ (تقرير أسبوعي/نافذة الشهر المالي)
  readonly periodKey: PeriodKey;        // المرشِّح الأساسي لكل تقرير شهري (ADR-008)
  readonly kind: EntryKind;             // «حجم التحويلات»، «المقترض»، «المسدَّد» بمجموع واحد
  readonly scope: Scope;                // تقرير المنزل = نفس المجموع + مرشِّح واحد (3.8)
  readonly categoryId: AccountId | null;// استهلاك الميزانية بـ sum() خادمي

  /** ADR-021: `sum('settlementDeltaMinor')` = المصدر المستقل لـ `paidMinor`/`settledMinor`. */
  readonly settlementDeltaMinor: Minor;

  /** روابط مسطَّحة (لا داخل خريطة) لأن كلاً منها مفتاح استعلام مُجمَّع. */
  readonly obligationId: ObligationId | null;
  readonly debtId: DebtId | null;
  readonly contactId: ContactId | null;
  readonly goalId: GoalId | null;

  readonly createdAt: EpochMs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/aggregates.ts
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * users{uid}/accountPeriods/{accountId}__{periodKey}
 * **حركة فقط** (ADR-009). لا `openingBalanceMinor` ولا `closingBalanceMinor` — القسم 5.3.
 */
export interface AccountPeriod {
  readonly id: string;                  // `${accountId}__${periodKey}` — حتمي
  readonly accountId: AccountId;
  readonly accountType: AccountType;    // حتى يعمل تقرير «حركة كل حسابات المصروف» بلا انضمام
  readonly periodKey: PeriodKey;
  schemaVersion: number;
  readonly ownerUid: string;

  /** حركة الفترة المدينة. `increment` فقط ⇒ قيد مؤرَّخ للماضي يمسّ مستنداً واحداً فقط. */
  debitMinor: Minor;
  creditMinor: Minor;
  /** عدد القيود في الفترة. لكشف الكتابة المفقودة ولعرض «عدد الحركات». */
  entryCount: number;
  /** أول وآخر تاريخ حركة في الفترة. يُستخدم في كشف الحساب ورؤوس الجداول. */
  firstBookedAt: ISODate;
  lastBookedAt: ISODate;
  updatedAt: EpochMs;
}

/** صفّ محسوب (لا يُخزَّن) تُنتجه `periodBalanceSeries` — القسم 5.3. */
export interface PeriodBalanceRow {
  readonly periodKey: PeriodKey;
  readonly openingMinor: Minor;         // مشتق تراكمياً، غير مخزَّن
  readonly debitMinor: Minor;
  readonly creditMinor: Minor;
  readonly closingMinor: Minor;         // = opening ± الحركة بحسب normalSide
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/correction.ts
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * users/{uid}/entryCorrections/{originalEntryId}   (ADR-014)
 * **قفل**: وجود المستند يعني أن القيد الأصلي صُحِّح. معرّفه = معرّف القيد الأصلي،
 * فـ «تعديلان متزامنان لنفس القيد» يفشل ثانيهما على `exists == false` بدل أن ينتجا عكسين.
 */
export interface EntryCorrection {
  readonly originalEntryId: EntryId;    // = معرّف المستند
  readonly kind: 'void' | 'amend';
  readonly reversalEntryId: EntryId;    // قيد العكس المُنشأ في نفس المعاملة
  readonly replacementEntryId: EntryId | null;  // البديل عند 'amend'، و null عند 'void'
  readonly reason: string;              // عربي، إلزامي غير فارغ
  readonly correctedAt: EpochMs;
  readonly deviceId: string;
  readonly ownerUid: string;
  schemaVersion: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/pending.ts — ADR-007
   ═══════════════════════════════════════════════════════════════════════════ */

export type PendingStatus =
  | 'queued'     // في الطابور، لم تُحاوَل بعد
  | 'inflight'   // runTransaction جارية الآن
  | 'failed'     // فشلت فشلاً نهائياً (خطأ نطاق) وتنتظر قرار المستخدم
  | 'applied';   // نجحت؛ تُحذف من الطابور بعد تأكيد وجود القيد

/**
 * users/{uid}/pendingCommands/{opId}
 * `runTransaction` لا تعمل دون اتصال (ADR-007) ⇒ الطلب يُسجَّل هنا ويُنفَّذ عند عودة الاتصال.
 * **المستندات هنا مستبعدة من كل رصيد وكل تقرير**، وتُعرض في الواجهة كـ «قيد الانتظار» فقط.
 */
export interface PendingCommand {
  readonly opId: OpId;                  // = معرّف المستند ⇒ لا طلب مزدوج في الطابور
  readonly request: OperationRequest;   // الطلب كما بناه النطاق، مُقنَّن
  readonly payloadHash: string;         // يُقارَن بـ entry.payloadHash عند النجاح
  status: PendingStatus;
  /** عدد المحاولات. بعد 5 محاولات متتالية بخطأ شبكة يُعرض للمستخدم بلا حذف. */
  attempts: number;
  /** آخر خطأ: رمز نطاق أو رمز Firestore. يُعرض بالعربية. */
  lastError: DomainError | { code: 'INFRA'; detail: string } | null;
  /** هل طُبِّقت المرآة المحلية؟ المرآة عرض فقط ولا تُجمَّع في أي رصيد. */
  mirrorApplied: boolean;
  readonly createdAt: EpochMs;
  readonly deviceId: string;
  readonly ownerUid: string;
  schemaVersion: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/satellites.ts
   ═══════════════════════════════════════════════════════════════════════════ */

/** ADR-011: قسط القرض ليس مصروفاً. هذا الحقل وحده يمنع تضخيم تقرير المصروفات. */
export type ObligationNature = 'expense' | 'financing';

export type ObligationStatus =
  | 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled';

export interface Installment {
  readonly index: number;               // 1-based، ثابت إلى الأبد
  readonly dueDate: ISODate;
  /** من `splitEven` ويُخزَّن صريحاً (القسم 2.6) — لا يُعاد حسابه عند القراءة أبداً. */
  readonly amountMinor: Minor;
  paidMinor: Minor;
  status: ObligationStatus;
}

export type Recurrence = {
  readonly frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  readonly anchorDate: ISODate;         // نقطة بدء التوليد
  readonly dayOfMonthPolicy: 'clampToEndOfMonth' | 'exact';
  readonly until: ISODate | null;
  /** آخر دورة ولّدها مُشغِّل الاستدراك. مفتاح عدم التكرار الحتمي (ADR-013). */
  lastGeneratedOccurrenceKey: string | null;
};

/** users/{uid}/obligations/{obligationId} — القسم 8 من المتطلبات. */
export interface Obligation {
  readonly obligationId: ObligationId;
  schemaVersion: number;
  readonly ownerUid: string;

  name: string;                         // «إيجار المنزل»
  payeeContactId?: ContactId;
  /** حساب المصروف الذي يُحمَّل عليه الدفع. `null` إلزاماً عند `nature === 'financing'`. */
  categoryId: AccountId | null;
  /** ADR-011. `'financing'` ⇒ الدفع يخصم خصماً ولا يلمس أي حساب مصروف. */
  readonly nature: ObligationNature;
  /** هل للالتزام حساب خصم مستقل؟ `false` = نقدي بحت ولا يلمس الدفتر قبل الدفع (19.4). */
  readonly accrualEnabled: boolean;
  /** `liability.obligation.{id}` — موجود فقط عند `accrualEnabled`. */
  readonly liabilityAccountId: AccountId | null;

  /** القيمة الإجمالية الأصلية. **لا تُرفع أبداً** (ADR-012). */
  totalMinor: Minor;
  /** الغرامات والرسوم الإضافية، منفصلة عن الأصل (ADR-012) ⇒ تاريخ الالتزام يبقى صادقاً. */
  extraChargesMinor: Minor;
  /** المسدَّد. يُحدَّث في نفس معاملة الدفع، ويُتحقَّق منه بـ `Σ settlementDeltaMinor` (ADR-021). */
  paidMinor: Minor;
  /** مشتق مخزَّن = `totalMinor + extraChargesMinor − paidMinor` (الثابت I5). */
  remainingMinor: Minor;
  /** فواتير متغيرة (كهرباء): تسمح بدفع يتجاوز التقدير بإقرار صريح من المستخدم. */
  readonly isVariableAmount: boolean;

  dueDate: ISODate;
  recurrence: Recurrence | null;
  installments: readonly Installment[] | null;
  priority: 1 | 2 | 3;
  status: ObligationStatus;
  /** تاريخ حساب الحالة: الحالة مشتقة من (التاريخ + المسدَّد)، فنعرف متى حُسبت. */
  statusComputedFor: ISODate;

  /**
   * الحساب النقدي الذي يُحجَز منه `remainingMinor` كمرآة `earmarkedMinor` (5.6).
   * `null` = لا حجز لهذا الالتزام. **لا أثر محاسبي إطلاقاً**؛ تحذير واجهة فقط (ADR-017).
   */
  earmarkFromAccountId: AccountId | null;

  paymentCount: number;
  lastPaymentEntryId: EntryId | null;
  attachments?: readonly string[];      // معطَّل على Spark (ق-1)
  notes?: string;
  readonly createdAt: EpochMs;
  updatedAt: EpochMs;
}

/**
 * users/{uid}/debts/{debtId} — **نموذج موحَّد** للقسمين 9 و10.
 *
 * القرار: مجموعة واحدة بحقل `direction`، لا `DebtPayable` و`DebtReceivable` منفصلتين.
 * المبرر: دورة الحياة متطابقة حرفياً (نشوء، سداد/تحصيل جزئي، إغلاق، إعفاء)، والحوارس متطابقة
 * (منع الزائد، منع السالب، منع العمل على مغلق)، والفرق كله **دالّة سطرين**: اتجاه النقد ونوع
 * الحساب المقابل. فصلهما يعني تكرار 12 حقلاً ومجموعتَي فهارس وحارسَين متطابقَين — وأول تعديل
 * على قاعدة «منع السداد الزائد» سيُطبَّق على واحدة ويُنسى في الأخرى. والمكسب المضاف: «صافي
 * مركزي مع فلان» استعلام واحد بـ `where contactId == c` بدل استعلامين ودمج في العميل.
 */
export interface Debt {
  readonly debtId: DebtId;
  schemaVersion: number;
  readonly ownerUid: string;

  /** `'payable'` = عليّ (القسم 9) · `'receivable'` = لي (القسم 10). لا يتغير بعد الإنشاء. */
  readonly direction: 'payable' | 'receivable';
  readonly counterpartyContactId: ContactId;
  /** لقطة الاسم للتصدير ولعرض الدين إن حُذفت جهة الاتصال. */
  counterpartyName: string;
  /** `liability.payable.c_*` أو `asset.receivable.c_*` — علاقة 1:1 مع الدين. */
  readonly accountId: AccountId;

  /** قيمة الدين الأصلية. */
  principalMinor: Minor;
  /** المسدَّد (payable) أو المحصَّل (receivable). المصدر المستقل: ADR-021. */
  settledMinor: Minor;
  /** مشتق مخزَّن = `principalMinor − settledMinor` (الثابت I6). */
  remainingMinor: Minor;

  /**
   * هل نشأ الدين بحركة نقدية فعلية؟ يحدد شكل قيد النشوء:
   * `true` ⇒ قيد `borrow`/`lend` كامل. `false` ⇒ خصم/أصل مقابل `equity.opening` بلا مسّ النقد
   * (تطبيق القاعدة 19.6: «تسجيل دين لا يعني بالضرورة حركة نقدية»).
   */
  readonly createdCash: boolean;

  originatedAt: ISODate;
  expectedSettleAt: ISODate | null;
  installments: readonly Installment[] | null;
  status: 'open' | 'partiallySettled' | 'settled' | 'writtenOff' | 'cancelled';
  /** ثابت نوعي: السداد/التحصيل الزائد ممنوع دائماً (القسم 19). ليس إعداداً. */
  readonly allowOverSettle: false;

  settlementCount: number;
  lastSettlementEntryId: EntryId | null;
  /** سجل متابعة التحصيل (القسم 10): ملاحظة + موعد تواصل. لا أثر مالي. */
  followUps?: readonly { at: ISODate; note: string; nextContactAt: ISODate | null }[];
  attachments?: readonly string[];      // معطَّل على Spark (ق-1)
  notes?: string;
  readonly createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** اسمان مريحان للقراءة فقط — لا مجموعتان ولا مستندان. */
export type DebtPayable    = Debt & { readonly direction: 'payable' };
export type DebtReceivable = Debt & { readonly direction: 'receivable' };

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/operations.ts — واجهة العمليات المُسمّاة
   ═══════════════════════════════════════════════════════════════════════════ */

/** تأكيد صريح لتحذير غير مانع (مثل تجاوز الحجز — ADR-017). */
export type ConfirmationToken = 'EARMARK_EXCEEDED' | 'VARIABLE_AMOUNT_OVER' | 'BACKDATED_ENTRY';

/** الحقول المشتركة في كل طلب. */
export interface OpBase {
  /** يولّده العميل (ULID) **قبل** أي اتصال. مفتاح منع الازدواج الوحيد (ADR-004). */
  readonly opId: OpId;
  /** التاريخ المحاسبي. منه وحده يُحسب `periodKey` (ADR-008). */
  readonly bookedAt: ISODate;
  readonly memo?: string;
  readonly attachments?: readonly string[];   // معطَّل على Spark (ق-1)
  readonly tags?: readonly string[];
  /** تأكيدات المستخدم للتحذيرات غير المانعة. بلا التأكيد المطلوب يُرفض الطلب. */
  readonly confirmations?: readonly ConfirmationToken[];
  readonly clientCreatedAt: EpochMs;
  readonly deviceId: string;
}

/** جزء من مصروف: فئة + مبلغ + نطاق. يسمح بمصروف واحد موزَّع (3.8، والقسم 2.5). */
export interface ExpenseSplit {
  readonly categoryId: AccountId;       // حساب expense قابل للترحيل
  readonly amountMinor: Minor;          // موجب
  readonly scope: Scope;
  readonly memo?: string;
}

export interface RecordExpense extends OpBase {
  readonly type: 'RecordExpense';
  /** الحساب المدفوع منه. يجب أن يكون `asset` قابلاً للترحيل. */
  readonly fromAccountId: AccountId;
  /** جزء واحد على الأقل. المجموع هو مبلغ العملية. */
  readonly splits: readonly [ExpenseSplit, ...ExpenseSplit[]];
  readonly payeeContactId?: ContactId;
  /** طريقة الدفع — وصفية بحتة (نقد/بطاقة/تحويل)؛ الأثر المحاسبي في `fromAccountId` وحده. */
  readonly paymentMethod?: 'cash' | 'card' | 'transfer' | 'wallet' | 'other';
}

export interface RecordIncome extends OpBase {
  readonly type: 'RecordIncome';
  /** الحساب المستلم (`asset`). */
  readonly toAccountId: AccountId;
  /** حساب الدخل (`income.*`). ليس نصاً حرّاً: المصدر = حساب (3.4). */
  readonly sourceAccountId: AccountId;
  readonly amountMinor: Minor;
  readonly payerContactId?: ContactId;
}

export interface Transfer extends OpBase {
  readonly type: 'Transfer';
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;      // ≠ fromAccountId (حارس SAME_ACCOUNT_TRANSFER)
  readonly amountMinor: Minor;
  /** عمولة التحويل. تُرحَّل سطراً مستقلاً على حساب مصروف ⇒ التحويل يبقى محايداً والعمولة مصروف. */
  readonly feeMinor?: Minor;
  readonly feeCategoryId?: AccountId;   // إلزامي إن وُجد `feeMinor`
  /** الهدف المرتبط عند التحويل إلى حساب هدف `backedAccount`. */
  readonly goalId?: GoalId;
}

export interface PayObligation extends OpBase {
  readonly type: 'PayObligation';
  readonly obligationId: ObligationId;
  readonly fromAccountId: AccountId;
  readonly amountMinor: Minor;
  /** القسط المقصود، إن كان السداد مرتبطاً بقسط بعينه. */
  readonly installmentIndex?: number;
  /** غرامة/رسم مدفوع مع هذه الدفعة ⇒ سطر على `expense.financeCharges` ورفع `extraChargesMinor` (ADR-012). */
  readonly extraChargesMinor?: Minor;
}

export interface PayDebt extends OpBase {
  readonly type: 'PayDebt';             // سداد دين عليّ — القاعدة 19.8
  readonly debtId: DebtId;
  readonly fromAccountId: AccountId;
  readonly amountMinor: Minor;
  /** فائدة/رسم مدفوع فوق الأصل ⇒ مصروف، ولا يُرفع `principalMinor` أبداً. */
  readonly extraChargesMinor?: Minor;
}

export interface CollectDebt extends OpBase {
  readonly type: 'CollectDebt';         // تحصيل دين لي — القاعدة 19.7
  readonly debtId: DebtId;
  readonly toAccountId: AccountId;
  readonly amountMinor: Minor;
}

export interface BorrowMoney extends OpBase {
  readonly type: 'BorrowMoney';         // استلام قرض — ليس دخلاً (19.6)
  readonly counterpartyContactId: ContactId;
  readonly counterpartyName: string;
  readonly principalMinor: Minor;
  /** الحساب الذي دخل فيه المال. `null` ⇒ دين نشأ بلا حركة نقدية (`createdCash: false`). */
  readonly toAccountId: AccountId | null;
  readonly expectedSettleAt?: ISODate;
  readonly installmentCount?: number;   // ≥1 ⇒ يُبنى جدول أقساط بـ splitEven (القسم 2.6)
}

export interface LendMoney extends OpBase {
  readonly type: 'LendMoney';           // إقراض — ليس مصروفاً
  readonly counterpartyContactId: ContactId;
  readonly counterpartyName: string;
  readonly amountMinor: Minor;
  readonly fromAccountId: AccountId | null;
  readonly expectedSettleAt?: ISODate;
}

export interface Adjust extends OpBase {
  readonly type: 'Adjust';              // تسوية مبرَّرة — الطرف `equity.adjustment` (3.4)
  readonly accountId: AccountId;
  readonly direction: 'increase' | 'decrease';
  readonly amountMinor: Minor;
  /** سبب عربي إلزامي غير فارغ. بلا سبب لا تسوية (القسم 5 من المتطلبات). */
  readonly reason: string;
}

export interface VoidEntry extends OpBase {
  readonly type: 'VoidEntry';           // إلغاء = عكس كامل (ADR-006)؛ لا حذف مالي أبداً
  readonly targetEntryId: EntryId;
  readonly reason: string;
}

/** حذف مفاتيح من **كل** عضو في اتحاد مميَّز (Omit العادي لا يوزّع على الاتحاد). */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type AmendableRequest = Exclude<
  OperationRequest,
  { type: 'VoidEntry' } | { type: 'AmendEntry' }
>;

export interface AmendEntry extends OpBase {
  readonly type: 'AmendEntry';          // عكس + بديل في معاملة واحدة بدلتا صافية (ADR-006)
  readonly targetEntryId: EntryId;
  readonly reason: string;
  /** الطلب البديل بقيمه الجديدة. معرّفاته الزمنية تأتي من `AmendEntry` نفسه لا منه. */
  readonly replacement: DistributiveOmit<
    AmendableRequest,
    'opId' | 'clientCreatedAt' | 'deviceId' | 'confirmations'
  >;
}

/** الاتحاد المميَّز الكامل. `planOperation` تُطابق عليه بـ `switch` شامل (exhaustive). */
export type OperationRequest =
  | RecordExpense | RecordIncome | Transfer
  | PayObligation | PayDebt | CollectDebt
  | BorrowMoney | LendMoney
  | Adjust | VoidEntry | AmendEntry;

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/plan.ts — ناتج طبقة النطاق
   ═══════════════════════════════════════════════════════════════════════════ */

/** زيادة ذرّية على مُجمَّع. تُترجَم في `data/` إلى `increment()` حصراً. */
export interface AccountDelta {
  readonly accountId: AccountId;
  readonly debitDeltaMinor: Minor;      // ≥ 0
  readonly creditDeltaMinor: Minor;     // ≥ 0
  readonly entryCountDelta: number;     // 0 أو 1 (أو −1 عند إعادة البناء)
  readonly lastPostedEntryId: EntryId;
  readonly lastPostedAt: ISODate;
}

export interface AccountPeriodDelta {
  readonly id: string;                  // `${accountId}__${periodKey}`
  readonly accountId: AccountId;
  readonly accountType: AccountType;
  readonly periodKey: PeriodKey;
  readonly debitDeltaMinor: Minor;
  readonly creditDeltaMinor: Minor;
  readonly entryCountDelta: number;
  readonly bookedAt: ISODate;           // لتحديث first/lastBookedAt
}

/** تحديث مرآة الحجز (ADR-017). منفصل عن `AccountDelta` لأنه لا يمسّ المدين/الدائن. */
export interface EarmarkDelta {
  readonly accountId: AccountId;
  readonly earmarkedDeltaMinor: Minor;  // موقَّع
}

/** تحديث كيان تشغيلي. اتحاد مميَّز حتى لا تُكتب حقول كيان على كيان آخر. */
export type SatelliteDelta =
  | { readonly kind: 'obligation'; readonly obligationId: ObligationId;
      readonly paidDeltaMinor: Minor; readonly extraChargesDeltaMinor: Minor;
      readonly installmentIndex: number | null; readonly nextStatus: ObligationStatus;
      readonly lastPaymentEntryId: EntryId }
  | { readonly kind: 'debt'; readonly debtId: DebtId;
      readonly settledDeltaMinor: Minor; readonly nextStatus: Debt['status'];
      readonly lastSettlementEntryId: EntryId }
  | { readonly kind: 'budget'; readonly periodKey: PeriodKey;
      readonly categoryId: AccountId; readonly spentDeltaMinor: Minor }
  | { readonly kind: 'goal'; readonly goalId: GoalId; readonly savedDeltaMinor: Minor }
  | { readonly kind: 'accountCreate'; readonly account: Account };

export interface AuditLogDraft {
  readonly opId: OpId;
  readonly action: OperationRequest['type'];
  readonly entryIds: readonly EntryId[];
  readonly summaryAr: string;           // سطر عربي يُقرأ في سجل التدقيق بلا فكّ ترميز
  readonly deviceId: string;
  readonly at: EpochMs;
}

/** مسار مستند يجب على `data/` قراءته داخل `runTransaction` قبل التطبيق (النطاق لا يقرأ). */
export type DocPath =
  | { readonly col: 'accounts'; readonly id: AccountId }
  | { readonly col: 'obligations'; readonly id: ObligationId }
  | { readonly col: 'debts'; readonly id: DebtId }
  | { readonly col: 'journalEntries'; readonly id: EntryId }
  | { readonly col: 'entryCorrections'; readonly id: EntryId };

/** تحذير غير مانع. يُعرَض للمستخدم ويحتاج `ConfirmationToken` لإعادة الإرسال. */
export interface DomainWarning {
  readonly code: ConfirmationToken;
  readonly messageAr: string;
  readonly context: Readonly<Record<string, string | number>>;
}

/**
 * ناتج `planOperation`. **وصف كامل لما سيُكتب، ولا كتابة فيه.**
 * `data/postOperation()` تُنفّذه حرفياً ولا تتخذ أي قرار محاسبي.
 */
export interface WritePlan {
  readonly planVersion: 1;
  readonly opId: OpId;
  /** قيد أو قيدان (العكس + البديل في `AmendEntry`). لا أكثر. */
  readonly entries: readonly [JournalEntry, ...JournalEntry[]];
  readonly postings: readonly Posting[];
  readonly accountDeltas: readonly AccountDelta[];
  readonly periodDeltas: readonly AccountPeriodDelta[];
  readonly earmarkDeltas: readonly EarmarkDelta[];
  readonly satelliteDeltas: readonly SatelliteDelta[];
  readonly correctionLock: EntryCorrection | null;
  readonly audit: AuditLogDraft;
  /** ما يجب إعادة التحقق منه داخل المعاملة (أرصدة، حالات، أقفال). */
  readonly reads: readonly DocPath[];
  /** تحذيرات صدر الطلب بتأكيداتها؛ تُعرَض في شاشة التأكيد. */
  readonly warnings: readonly DomainWarning[];
  /** عدد الكتابات المتوقَّع. يُفحَص ضد سقف 500 قبل الإرسال. */
  readonly writeCount: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   src/domain/types/errors.ts — رسائل عربية، رموز إنجليزية
   ═══════════════════════════════════════════════════════════════════════════ */

export type DomainErrorCode =
  | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_ARCHIVED' | 'ACCOUNT_NOT_POSTABLE'
  | 'ACCOUNT_TYPE_MISMATCH' | 'SYSTEM_ACCOUNT_PROTECTED'
  | 'INSUFFICIENT_FUNDS' | 'MIN_BALANCE_BREACH'
  | 'NON_POSITIVE_AMOUNT' | 'AMOUNT_OUT_OF_RANGE' | 'UNBALANCED_ENTRY'
  | 'SAME_ACCOUNT_TRANSFER' | 'FEE_CATEGORY_REQUIRED'
  | 'CATEGORY_MISMATCH' | 'CATEGORY_REQUIRED_FOR_EXPENSE_NATURE'
  | 'OVER_SETTLEMENT' | 'OBLIGATION_CLOSED' | 'DEBT_CLOSED'
  | 'INSTALLMENT_NOT_FOUND'
  | 'FUTURE_BOOKED_AT' | 'BOOKED_AT_TOO_OLD'
  | 'OP_ID_CONFLICT' | 'ENTRY_NOT_FOUND' | 'ENTRY_ALREADY_CORRECTED'
  | 'OPENING_ENTRY_EXISTS' | 'CANNOT_CORRECT_REVERSAL'
  | 'REQUIRES_CONNECTION' | 'CONFIRMATION_REQUIRED';

/** الرسائل العربية. **المصدر الوحيد** لنصوص أخطاء النواة (القسم 25 بند 18). */
export const DOMAIN_ERROR_AR: Readonly<Record<DomainErrorCode, string>> = {
  ACCOUNT_NOT_FOUND:        'الحساب غير موجود.',
  ACCOUNT_ARCHIVED:         'هذا الحساب معطَّل ولا يمكن التسجيل عليه. أعِد تنشيطه من إدارة الحسابات.',
  ACCOUNT_NOT_POSTABLE:     'هذا بند تجميعي ولا يُسجَّل عليه مباشرة. اختر بنداً فرعياً.',
  ACCOUNT_TYPE_MISMATCH:    'نوع الحساب لا يناسب هذه العملية.',
  SYSTEM_ACCOUNT_PROTECTED: 'هذا حساب نظام ولا يمكن تعديل نوعه أو موضعه في الشجرة.',
  INSUFFICIENT_FUNDS:       'الرصيد غير كافٍ: المتاح {available} والمطلوب {required}.',
  MIN_BALANCE_BREACH:       'هذه العملية تُخفض الرصيد تحت الحد المسموح ({minBalance}).',
  NON_POSITIVE_AMOUNT:      'المبلغ يجب أن يكون أكبر من صفر.',
  AMOUNT_OUT_OF_RANGE:      'المبلغ يتجاوز الحد الأقصى المسموح.',
  UNBALANCED_ENTRY:         'خطأ داخلي: القيد غير متوازن. لم يُحفَظ شيء.',
  SAME_ACCOUNT_TRANSFER:    'لا يمكن التحويل من الحساب إلى نفسه.',
  FEE_CATEGORY_REQUIRED:    'حدِّد فئة المصروف الخاصة بعمولة التحويل.',
  CATEGORY_MISMATCH:        'خطأ داخلي: تصنيف السطر لا يطابق حسابه. لم يُحفَظ شيء.',
  CATEGORY_REQUIRED_FOR_EXPENSE_NATURE: 'التزام من نوع «مصروف» يحتاج فئة مصروف.',
  OVER_SETTLEMENT:          'المبلغ يتجاوز المتبقي ({remaining}).',
  OBLIGATION_CLOSED:        'هذا الالتزام مسدَّد أو ملغى ولا يقبل دفعات جديدة.',
  DEBT_CLOSED:              'هذا الدين مغلق ولا يقبل حركات جديدة.',
  INSTALLMENT_NOT_FOUND:    'القسط المحدد غير موجود.',
  FUTURE_BOOKED_AT:         'لا يمكن التسجيل بتاريخ مستقبلي.',
  BOOKED_AT_TOO_OLD:        'التاريخ أقدم من المسموح ({minDate}).',
  OP_ID_CONFLICT:           'عملية بنفس المعرّف مسجَّلة ببيانات مختلفة. حدِّث الصفحة وأعد المحاولة.',
  ENTRY_NOT_FOUND:          'العملية المطلوبة غير موجودة.',
  ENTRY_ALREADY_CORRECTED:  'هذه العملية عُدِّلت أو أُلغيت من قبل.',
  OPENING_ENTRY_EXISTS:     'لهذا الحساب رصيد افتتاحي مسجَّل. عدِّله بدلاً من إضافة رصيد ثانٍ.',
  CANNOT_CORRECT_REVERSAL:  'لا يمكن تعديل قيد عكس. عدِّل العملية الأصلية.',
  REQUIRES_CONNECTION:      'تحتاج هذه العملية اتصالاً بالإنترنت. أُضيفت إلى الطابور وستُنفَّذ تلقائياً.',
  CONFIRMATION_REQUIRED:    'العملية تحتاج تأكيدك: {warning}',
};

export interface DomainError {
  readonly code: DomainErrorCode;
  /** الرسالة بعد تعويض الوسائط، جاهزة للعرض. لا تُبنى رسالة في الواجهة. */
  readonly messageAr: string;
  /** وسائط التعويض بعد التنسيق بـ `formatLYD` — لا `Minor` خام يُعرض للمستخدم. */
  readonly params?: Readonly<Record<string, string | number>>;
  /** الحقل المسؤول في النموذج، لتوجيه التركيز في الواجهة. */
  readonly field?: string;
}

/** ناتج طبقة النطاق الوحيد. لا استثناءات للأخطاء المتوقَّعة. */
export type PlanResult =
  | { readonly ok: true;  readonly plan: WritePlan }
  | { readonly ok: false; readonly error: DomainError };
```

---

## 5. الأرصدة والمُجمَّعات

### 5.1 ما يُخزَّن بالضبط وأين ومتى وبأي أسلوب كتابة

| ما يُخزَّن | المجموعة | يُحدَّث متى | أسلوب الكتابة | لماذا هذا الأسلوب |
|---|---|---|---|---|
| القيد كاملاً بسطوره | `journalEntries/{entryId}` | إنشاء واحد، ثم وسم `reversed` فقط | `runTransaction` (`create` بشرط عدم الوجود) | الذرّية مع المُجمَّعات شرط وجودي: قيد بلا أثر = رصيد خاطئ |
| صفّ لكل سطر | `postings/{entryId}:{lineNo}` | إنشاء واحد. **لا تعديل ولا حذف أبداً** | نفس المعاملة، `create` | يجب أن يرى الخادم نفس ما يراه الحساب في اللحظة نفسها |
| `debitTotalMinor` · `creditTotalMinor` · `entryCount` | `accounts/{accountId}` | كل قيد يمسّ الحساب | نفس المعاملة، `increment()` | ADR-003؛ و`increment` يجعل كتابات الأجهزة تبادلية فلا تُفقد واحدة |
| `earmarkedMinor` | `accounts/{accountId}` | عمليات الحجز/الإفراج فقط | نفس المعاملة، `increment()` | مرآة مشتقة (5.6) |
| حركة الفترة فقط | `accountPeriods/{accountId}__{pk}` | كل قيد | نفس المعاملة، `set(..., {merge:true})` + `increment()` | ADR-009؛ `merge` يُنشئ المستند عند أول قيد في الفترة بلا قراءة مسبقة |
| `paidMinor`/`settledMinor`/`status` | `obligations` · `debts` | عند الدفع/التحصيل | نفس المعاملة، قراءة ثم كتابة قيمة مطلقة | الحارس (منع الزائد) يحتاج القيمة المقروءة ⇒ لا `increment` أعمى |
| قفل التصحيح | `entryCorrections/{originalEntryId}` | عند الإلغاء/التعديل | نفس المعاملة، `create` بشرط عدم الوجود | ADR-014: القفل هو المفتاح |
| استهلاك الميزانية | `budgets/{pk}` | كل مصروف في فترة لها ميزانية | نفس المعاملة، `increment()` | مشتق قابل لإعادة البناء من `postings` |
| سطر التدقيق | `auditLogs/{opId}` | كل عملية | نفس المعاملة، `create` | القسم 18 بند 9 |
| **لا شيء** | — | — | — | **لا `balanceMinor` ولا `openingBalanceMinor` ولا `closingBalanceMinor`** (3.1، 5.3) |

**`runTransaction` هي القاعدة، و`writeBatch` الاستثناء المحدَّد في موضعين فقط:**

```
runTransaction  ⟸  كل عملية مالية ينشئها المستخدم.
                   السبب: كل واحدة فيها حارس يعتمد على قيمة مقروءة
                   (الرصيد ≥ minBalance، المتبقي ≥ المبلغ، القفل غير موجود).
                   قراءة ثم كتابة بلا معاملة = شرط-ثم-عمل (TOCTOU) ⇒ سداد زائد مُمكن.

writeBatch      ⟸  (1) تهيئة شجرة الحسابات (3.6): لا قرار يعتمد على قراءة.
                   (2) مُشغِّل الاستدراك الجَمْعي (5.5): الحوارس تُقيَّم مرة على لقطة
                       واحدة، والدفعة ذرّية، والمستند الواحد يُكتب مرة واحدة في الدفعة.
```

**ADR-007 والعاقبة الصادقة:** `runTransaction` لا تعمل دون اتصال. فالعملية المالية دون اتصال
**لا تُنفَّذ**: تُسجَّل في `pendingCommands` وتُعرض كـ «قيد الانتظار» بمرآة محلية **لا تدخل أي رصيد
ولا أي تقرير**. هذا وعد صادق للمستخدم بدل رقم يتحرك ثم يرتد.

### 5.2 الدالة الوحيدة التي تبني الدلتا

```ts
// domain/ledger/deltas.ts
/** أثر قيد على المُجمَّعات. نقية، حتمية، قابلة للاختبار بلا Firestore. */
export function deltasForEntry(e: JournalEntry): {
  accounts: AccountDelta[]; periods: AccountPeriodDelta[];
} {
  const byAccount = new Map<AccountId, { d: number; c: number }>();
  for (const l of e.lines) {
    const cur = byAccount.get(l.accountId) ?? { d: 0, c: 0 };
    if (l.side === 'debit') cur.d += l.amountMinor; else cur.c += l.amountMinor;
    byAccount.set(l.accountId, cur);                  // سطران على نفس الحساب ⇒ كتابة واحدة
  }
  const accounts: AccountDelta[] = [];
  const periods: AccountPeriodDelta[] = [];
  for (const [accountId, v] of byAccount) {
    accounts.push({ accountId, debitDeltaMinor: v.d as Minor, creditDeltaMinor: v.c as Minor,
                    entryCountDelta: 1, lastPostedEntryId: e.entryId, lastPostedAt: e.bookedAt });
    periods.push({ id: `${accountId}__${e.periodKey}`, accountId, periodKey: e.periodKey,
                   accountType: typeOf(accountId), debitDeltaMinor: v.d as Minor,
                   creditDeltaMinor: v.c as Minor, entryCountDelta: 1, bookedAt: e.bookedAt });
  }
  invariant(sum(accounts.map(a => a.debitDeltaMinor)) === e.debitTotalMinor, 'UNBALANCED_ENTRY');
  invariant(sum(accounts.map(a => a.creditDeltaMinor)) === e.creditTotalMinor, 'UNBALANCED_ENTRY');
  return { accounts, periods };
}
```

**تجميع السطور بالحساب قبل الكتابة ليس تحسيناً:** قيد فيه سطران على نفس الحساب (مصروف مقسوم
على فئتين مدفوع نقداً، أو تحويل بعمولة من نفس الحساب) سيكتب على نفس المستند مرتين في معاملة واحدة.
Firestore ترفض كتابتين على نفس المستند في المعاملة الواحدة، فهذا **خطأ وقت تشغيل** لا مجرد بطء.

### 5.3 `accountPeriods` حركة فقط — ولماذا تخزين رصيد النهاية كان عيباً قاتلاً

```ts
// domain/ledger/periodBalances.ts

/**
 * يبني سلسلة أرصدة البداية/النهاية لفترات متصلة من **الحركة وحدها**.
 * الدخل: كل مستندات `accountPeriods` للحساب (استعلام واحد: `where accountId == id`).
 * الثابت: `closing(pk) === opening(pk+1)` لكل زوج متتالٍ، و`opening(أول فترة) === 0`.
 */
export function periodBalanceSeries(
  type: AccountType,
  allPeriods: readonly AccountPeriod[],       // بأي ترتيب
  from: PeriodKey,
  to: PeriodKey,
): PeriodBalanceRow[] {
  const sign = normalSideOf(type) === 'debit' ? 1 : -1;
  const byKey = new Map(allPeriods.map(p => [p.periodKey, p]));

  // 1) رصيد البداية = تراكم كل حركة في فترات **أسبق** من `from`. لا لقطة مخزَّنة.
  let running = 0;
  for (const p of allPeriods) {
    if (p.periodKey < from) running += sign * (p.debitMinor - p.creditMinor);
  }

  // 2) تمرير على الشهور المتصلة في [from, to]، والفترات الخالية حركتها صفر لا فراغ.
  const rows: PeriodBalanceRow[] = [];
  for (const pk of monthRange(from, to)) {            // monthRange: دالة تقويمية نقية
    const p = byKey.get(pk);
    const d = (p?.debitMinor ?? 0) as Minor;
    const c = (p?.creditMinor ?? 0) as Minor;
    const opening = running as Minor;
    running += sign * (d - c);
    rows.push({ periodKey: pk, openingMinor: opening, debitMinor: d, creditMinor: c,
                closingMinor: running as Minor });
  }
  return rows;
}

/** رصيد الحساب في نهاية فترة محددة — نفس المصدر، بلا أي رقم مخزَّن. */
export function balanceAtPeriodEnd(
  type: AccountType, allPeriods: readonly AccountPeriod[], pk: PeriodKey,
): Minor {
  const sign = normalSideOf(type) === 'debit' ? 1 : -1;
  let acc = 0;
  for (const p of allPeriods) if (p.periodKey <= pk) acc += sign * (p.debitMinor - p.creditMinor);
  return acc as Minor;
}
```

**تكلفة الاشتقاق:** مستند واحد لكل (حساب × شهر **له حركة**). حساب النقد بعد عشر سنوات متواصلة =
120 مستنداً؛ قراءة واحدة بـ `where accountId == id` تعطي السلسلة كلها، وتُخزَّن في ذاكرة الجلسة.
مقابل ذلك نكسب ثابتاً لا يمكن أن يختلّ: `closing(pk) ≡ opening(pk+1)` **بالبناء**، لا بالتزامن.

**لماذا كان تخزين `closingBalanceMinor` عيباً قاتلاً (ADR-009):**

1. **القيد المؤرَّخ للماضي يُبطل كل الفترات اللاحقة.** المستخدم في 2026-10 يسجّل مصروفاً تاريخه
   2026-03. بالحركة فقط: تُحدَّث **وثيقة واحدة** (`asset.cash.main__2026-03`) وكل رصيد نهاية من مارس
   إلى أكتوبر يصبح صحيحاً تلقائياً لأنه مشتق. بتخزين `closing`: يجب تحديث `closing` و`opening`
   لثمانية مستندات في **نفس المعاملة** وإلا ظهر رقمان متناقضان لنفس الشهر.
2. **والعدد غير محدود.** قيد تاريخه 2019 في نظام عمره 7 سنوات يلمس **84 مستنداً** لحساب واحد.
   ومعاملة Firestore سقفها 500 كتابة؛ فقيد واحد مؤرَّخ قديماً على ثلاثة حسابات (252 مستنداً) يقترب من
   السقف، وقيد أقدم يتجاوزه ⇒ **العملية تفشل فشلاً غير مفهوم للمستخدم**، أو — وهو الأسوأ — يُكتب
   المسار الطويل على دفعات فيبقى النظام فترةً وهو يعرض أرصدة شهرية خاطئة.
3. **والفشل صامت.** `closing` المخزَّن لا يتناقض مع شيء: لا ثابت يربطه بالحركة، فلا فاحص يكشف
   أنه قديم. التقرير السنوي يعرض 12 رقماً جميلاً، مجموع حركاتها لا يساوي فرق أرصدتها، ولا تحذير.
4. **والأرقام تتكاثر.** `opening` و`closing` معاً = رقمان مشتقان لكل شهر لكل حساب. بعد خمس سنوات
   على 40 حساباً = 4,800 رقم مخزَّن قابل للانحراف، كلها مشتقة من `debitMinor` و`creditMinor`.
   وهذا بالضبط الاعتراض الذي أسقط `deltaSumMinor` في القسم 1.3، مضروباً في عدد الشهور.

**القاعدة المستخلصة والمطبَّقة في كل الوثيقة:** يُخزَّن ما هو **تراكمي بالزيادة** (`increment`)، ويُشتَق
ما هو **تراكمي بالترتيب**. الحركة من النوع الأول، والرصيد من النوع الثاني.

### 5.4 `postings` المسطَّحة: لماذا وكيف وبكم

**لماذا:** `getAggregateFromServer(sum())` **لا يدخل داخل حقول المصفوفات**، وسطور القيد مصفوفة
مُضمَّنة (ADR-002) لأن التضمين يقتل «القيد اليتيم» بنيوياً. `postings` تستعيد `sum()` الخادمي
**بلا** التنازل عن ذرّية القيد: صفّ مسطَّح واحد لكل سطر، يُكتب في **نفس المعاملة**، فلا نافذة
يختلف فيها الاثنان.

**كيف — استعلامات فعلية:**

```ts
// data/reports/aggregates.ts
const P = collection(db, `users/${uid}/postings`);

/** مصروف الشهر الكلي = Σdebit − Σcredit على سطور حسابات المصروف. */
export async function monthExpenseMinor(pk: PeriodKey): Promise<Minor> {
  const q = query(P, where('accountType', '==', 'expense'), where('periodKey', '==', pk));
  const s = await getAggregateFromServer(q, { d: sum('debitMinor'), c: sum('creditMinor') });
  return (s.data().d - s.data().c) as Minor;          // الطرح يستوعب قيود العكس تلقائياً
}

/** مصروف المنزل: نفس الاستعلام + مرشِّح واحد ⇒ مجموع فرعي لا مجموع ثانٍ (3.8). */
export async function monthHouseholdExpenseMinor(pk: PeriodKey): Promise<Minor> {
  const q = query(P, where('accountType', '==', 'expense'),
                     where('scope', '==', 'household'), where('periodKey', '==', pk));
  const s = await getAggregateFromServer(q, { d: sum('debitMinor'), c: sum('creditMinor') });
  return (s.data().d - s.data().c) as Minor;
}

/** استهلاك فئة مقابل سقفها. */
export async function categorySpentMinor(pk: PeriodKey, categoryId: AccountId): Promise<Minor> {
  const q = query(P, where('categoryId', '==', categoryId), where('periodKey', '==', pk));
  const s = await getAggregateFromServer(q, { d: sum('debitMinor'), c: sum('creditMinor') });
  return (s.data().d - s.data().c) as Minor;
}

/** ADR-021: التحقق المستقل من `obligation.paidMinor` بلا قراءة أي دفعة. */
export async function obligationSettledFromLedger(id: ObligationId): Promise<Minor> {
  const q = query(P, where('obligationId', '==', id));
  const s = await getAggregateFromServer(q, { t: sum('settlementDeltaMinor') });
  return s.data().t as Minor;
}
```

**الفهارس المركَّبة المطلوبة** (`firestore.indexes.json`):
`(accountType, periodKey)` · `(accountType, scope, periodKey)` · `(categoryId, periodKey)` ·
`(accountId, periodKey)` · `(accountId, bookedAt)` · `(kind, periodKey)` · `(obligationId)` ·
`(debtId)` · `(goalId)`.

**التكلفة بالأرقام:**

| البند | الرقم |
|---|---|
| كتابات إضافية لمصروف بسيط | **+2** (سطران) ⇒ المصروف البسيط = 1 قيد + 2 postings + 2 حسابات + 2 فترات + 1 تدقيق = **8 كتابات** |
| سقف Spark اليومي | 20,000 كتابة ⇒ **~2,500 عملية/يوم**. مستخدم شخصي ~20 ⇒ استهلاك 0.8% |
| قراءات استعلام التجميع | **قراءة واحدة لكل 1000 مدخل فهرس مقروء، بحد أدنى قراءة واحدة** — لا قراءة لكل مستند |
| تقرير شهري (مصروف كلي + منزل + 20 فئة) | 22 استعلام تجميع × ~1 قراءة = **~22 قراءة**، مقابل ~400 قراءة لو قرأنا القيود |
| حجم `postings` بعد 5 سنوات (20 عملية/يوم) | ~73,000 قيد × 2.2 سطر ≈ **160,000 مستند** — لا سقف يُقارب |

**متى نقرأ `postings` ومتى نقرأ القيود:**

| السؤال | المصدر | السبب |
|---|---|---|
| مجموع على بعد مُفهرَس (شهر/فئة/نطاق/كيان) | `postings` + `sum()` | قراءة واحدة تقريباً بدل مئات |
| رصيد حساب الآن | `accounts` عبر `onSnapshot` | صفر قراءة إضافية؛ المجاميع حاضرة |
| أرصدة شهرية | `accountPeriods` + `periodBalanceSeries` | مستند لكل شهر لا لكل سطر |
| **قائمة عمليات للعرض** (كشف حساب، آخر 25 عملية، تفاصيل عملية) | `journalEntries` | المستخدم يرى **عمليات** لا سطوراً؛ والقيد يحمل الوصف ودورة الحياة |
| تصدير CSV سطراً سطراً | `postings` | مسطَّح أصلاً وجاهز للتصدير |
| إعادة بناء المُجمَّعات | `journalEntries` | القيد هو مصدر الحقيقة؛ `postings` إسقاط، ويُعاد بناؤه هو أيضاً منه |

**ثابت التسطيح (I-POST-1، يُفحَص في إعادة البناء):** لكل قيد، `postings` التي معرّفها يبدأ بـ
`${entryId}:` عددها = `lines.length`، ومجموع `debitMinor` فيها = `entry.debitTotalMinor`.

### 5.5 سقف الكتابة على المستند الواحد (~1/ثانية)

**هل مستند الحساب في خطر؟ لا — والحساب كالتالي:**

| السيناريو | كتابات على `asset.cash.main` | المعدل |
|---|---|---|
| استخدام واقعي: 20 عملية/يوم، نصفها من النقد | 10 كتابات/يوم | **0.00012 كتابة/ثانية** — أقل من السقف بأربع مراتب |
| أسوأ لحظة تفاعلية: المستخدم يسجّل 5 عمليات متتابعة بأسرع ما يستطيع | 5 كتابات في ~25 ثانية | 0.2/ثانية |
| هاتف وحاسوب يسجّلان في اللحظة نفسها | 2 كتابة في ثانية | على الحدّ؛ و`increment` تبادلية + إعادة محاولة `runTransaction` تلقائية ⇒ **لا فقدان** |

**الحكم:** في المسار التفاعلي السقف غير ذي صلة، وهو نظرياً **سقف معدَّل مستدام** لا منع لحظي؛
والذرّية مضمونة على أي حال بإعادة المحاولة التلقائية.

**الخطر الحقيقي الوحيد: الاستدراك الجَمْعي.** مستخدم غاب شهرين وعنده 3 التزامات شهرية ومصروف
متكرر أسبوعي ⇒ مُشغِّل الاستدراك يولّد ~60 قيداً، معظمها يمسّ `asset.cash.main` **ونفس
`accountPeriods` للشهرين**. 60 معاملة متتابعة على نفس المستندين = 60 كتابة في ثوانٍ ⇒ ازدحام
(`ABORTED`)، إعادة محاولات، وبطء يراه المستخدم كتعليق عند فتح التطبيق.

**الحل الملموس: `writeBatch` مُجمَّعة بكتابة واحدة لكل مستند ساخن، مع ترويق ومؤشر استئناف.**

```ts
// data/catchup/runCatchup.ts
const ENTRIES_PER_BATCH = 80;     // 80×(1 قيد + 2 postings) = 240 + ~60 مُجمَّع = ~300 < 500
const BATCH_PAUSE_MS    = 1200;   // > ثانية ⇒ المستند الساخن يُكتب مرة واحدة كل دفعة
const MAX_ENTRIES_PER_OPEN = 240; // 3 دفعات كأقصى حد لفتحة واحدة، ثم يُستأنف لاحقاً

export async function runCatchup(uid: string, now: ISODate): Promise<CatchupReport> {
  // 1) قراءة واحدة للقوالب واللقطة، وبناء كل الخطط في النطاق (نقي، بلا كتابة).
  const snapshot = await loadCatchupSnapshot(uid);          // قوالب + حسابات + التزامات
  const plans: WritePlan[] = planCatchup(snapshot, now);    // حتمي: opId = `rec:${recurringId}:${occurrenceKey}`

  let done = 0;
  for (const chunk of chunk(plans, ENTRIES_PER_BATCH)) {
    if (done >= MAX_ENTRIES_PER_OPEN) break;                // يُستأنف في فتحة تالية

    const batch = writeBatch(db);
    // 2) كل القيود و postings — معرّفات حتمية ⇒ إعادة التشغيل لا تُنشئ شيئاً مزدوجاً.
    for (const p of chunk) { writeEntryDocs(batch, uid, p); }

    // 3) **الدمج**: كل الدلتا لنفس المستند تُجمَع في كتابة **واحدة** لهذه الدفعة.
    for (const [accountId, d] of mergeAccountDeltas(chunk)) {
      batch.set(doc(db, `users/${uid}/accounts/${accountId}`), {
        debitTotalMinor:  increment(d.debitDeltaMinor),
        creditTotalMinor: increment(d.creditDeltaMinor),
        entryCount:       increment(d.entryCountDelta),     // 60 قيداً ⇒ كتابة واحدة
        lastPostedEntryId: d.lastPostedEntryId, lastPostedAt: d.lastPostedAt,
      }, { merge: true });
    }
    for (const [id, d] of mergePeriodDeltas(chunk)) { /* نفس الدمج على accountPeriods */ }
    for (const [id, d] of mergeSatelliteDeltas(chunk)) { /* نفس الدمج على obligations */ }

    await batch.commit();                                   // ذرّية: كل الدفعة أو لا شيء
    done += chunk.length;
    await sleep(BATCH_PAUSE_MS);                            // الترويق
  }
  return { generated: done, remaining: plans.length - done };
}
```

**أربع نقاط تجعل هذا صحيحاً لا مجرد أسرع:**

1. **لماذا `writeBatch` هنا و`runTransaction` في كل مكان آخر؟** لأن حوارس الاستدراك تُقيَّم مرة واحدة
   على لقطة واحدة في طبقة النطاق، والقيود المولَّدة **لا تخضع لحارس رصيد**: دفعة التزام مولَّدة آلياً
   لا تُحمَّل على حساب نقد، بل تُنشئ استحقاقاً (`liability.obligation.*`) أو تُسجَّل كـ «مستحقة» بلا
   قيد أصلاً (القاعدة 19.4). فلا قرار يعتمد على قيمة مقروءة لحظياً ⇒ لا حاجة إلى معاملة، و`writeBatch`
   **ذرّية هي أيضاً**. (وهي تعمل دون اتصال، فالاستدراك لا يُحجَب — خلافاً للعمليات التي يُنشئها المستخدم.)
2. **الدمج هو الحل، لا الترويق.** `mergeAccountDeltas` تُحوّل 60 كتابة على مستند الحساب إلى **واحدة**.
   الترويق (`sleep`) يحمي من تتابع الدفعات فقط، والسقف داخل الدفعة محلول بنيوياً.
3. **عدم التكرار حتمي، لا مبني على النجاح.** `opId = rec:{recurringId}:{occurrenceKey}` و
   `entryId === opId` و`postingId = ${entryId}:${lineNo}` ⇒ انقطاع في منتصف الدفعة الثالثة ثم إعادة
   فتح التطبيق يعيد بناء نفس الخطط ويكتب نفس المعرّفات: **الموجود يُكتب كما هو والناقص يُستكمل**.
   لكن `increment()` **ليست عديمة التكرار** ⇒ القاعدة الحاكمة: مستند القيد يُكتب بـ
   `create`-only في القواعد، فالدفعة المعادة **تفشل كلها** على القيد الموجود؛ والاستدراك لذلك
   **يسأل أولاً** أي `occurrenceKey` موجود (استعلام واحد `where kind in [...] and periodKey in [...]`
   يعيد المعرّفات فقط) ويبني الخطط للناقص وحده. هذا الاستعلام الواحد هو ثمن أمان `increment`.
4. **السقف المعلن للمستخدم:** الاستدراك يولّد 240 قيداً كأقصى حد لكل فتحة ويُظهر «تم توليد 240 حركة،
   وتبقّى 37 — ستُستكمل تلقائياً». لا شريط تقدم يدور إلى ما لا نهاية، ولا عمل خفي.

### 5.6 `earmarkedMinor` — مرآة مشتقة لا مصدر حقيقة (ADR-017)

**ما هو:** مبلغ من رصيد حساب نقدي **محجوز** لأهداف ادخار أو التزامات قريبة. يظهر للمستخدم كـ
«المتاح للإنفاق» مقابل «الرصيد».

```ts
// domain/ledger/earmark.ts
/** المتاح فعلاً للإنفاق. الدالة الوحيدة التي تُحتسب بها كل شاشة «المتاح». */
export function availableMinor(a: Account): Minor {
  const bal = naturalBalanceMinor(a);
  return (bal - a.earmarkedMinor - a.minBalanceMinor) as Minor;
}

/** ADR-017 حرفياً: تجاوز الحجز **تحذير**، وتجاوز الرصيد **منع**. */
export function guardSpend(a: Account, amount: Minor):
  { ok: true; warnings: DomainWarning[] } | { ok: false; error: DomainError } {
  const bal = naturalBalanceMinor(a);
  // منع: لا يُسمح بالنزول تحت minBalanceMinor الموقَّع (ADR-010)
  if (bal - amount < a.minBalanceMinor) {
    return { ok: false, error: err('INSUFFICIENT_FUNDS',
      { available: fmt((bal - a.minBalanceMinor) as Minor), required: fmt(amount) }) };
  }
  // تحذير: المبلغ يأكل من المحجوز — قرار المستخدم لا قرار النظام
  if (amount > availableMinor(a)) {
    return { ok: true, warnings: [{ code: 'EARMARK_EXCEEDED',
      messageAr: `هذا المبلغ يتجاوز المتاح (${fmt(availableMinor(a))}) ويستهلك من المحجوز `
               + `لأهدافك (${fmt(a.earmarkedMinor)}). هل تريد المتابعة؟`,
      context: {} }] };
  }
  return { ok: true, warnings: [] };
}
```

**متى يُحدَّث وكيف:** `increment()` موقَّع، **داخل نفس معاملة** الحدث الذي غيّر الحجز، ولا شيء غيره:

| الحدث | `earmarkedDeltaMinor` على الحساب |
|---|---|
| إنشاء هدف `virtualEarmark` بمبلغ شهري مخصَّص من `asset.bank.main` | `+ amount` |
| قيد `earmark` (Dr `equity.unallocated` / Cr `equity.earmark.g_{id}`) | `+ amount` على الحساب الممول |
| تحقّق الهدف أو إلغاؤه أو الإفراج اليدوي | `− remaining` |
| صرف من المحجوز (مصروف أُكِّد عليه `EARMARK_EXCEEDED`) | `− min(amount, earmarked)` |
| تسجيل مصروف/دخل/تحويل عادي | **`0` — لا أثر** |

**لماذا هو مرآة لا مصدر حقيقة، بالدليل:** مصدر الحقيقة هو مستندات الأهداف والالتزامات نفسها.
`earmarkedMinor` موجود **فقط** حتى تُحسَب «المتاح» من مستند الحساب الواحد الحاضر في `onSnapshot`،
بلا قراءة كل الأهداف والالتزامات مع كل حرف يكتبه المستخدم في خانة المبلغ. ولأنه مشتق:

```ts
/** يُعاد بناؤه من المصدر بلا أي اعتماد على القيمة المخزَّنة. */
export function recomputeEarmarked(
  accountId: AccountId,
  goals: readonly FinancialGoal[],
  obligations: readonly Obligation[],
): Minor {
  const g = sumMinor(goals
    .filter(x => x.status === 'active' && x.mode === 'virtualEarmark'
              && x.fundingAccountId === accountId)
    .map(x => clampAtZero((x.targetMinor - x.savedMinor) as Minor)));
  const o = sumMinor(obligations
    .filter(x => x.status !== 'paid' && x.status !== 'cancelled'
              && x.earmarkFromAccountId === accountId)
    .map(x => x.remainingMinor));
  return addMinor(g, o);
}
```

> `FinancialGoal` ليس من كيانات النواة، وواجهته تُعرَّف في قسم التخطيط المالي. النواة تفترض عليه
> ثلاثة حقول فقط وتستخدمها هنا حرفياً: `mode: 'backedAccount' | 'virtualEarmark'` ·
> `fundingAccountId: AccountId | null` · `savedMinor: Minor`. أي تعريف لاحق يخالفها يخرق 5.6.

**ثلاث نتائج مترتبة على كونه مرآة، وكلها مقصودة:**
1. **انحرافه لا يُفسد أي رقم محاسبي.** لا يدخل الرصيد ولا الدفتر ولا ميزان المراجعة ولا أي تقرير.
   أقصى أثر خطئه: رسالة «المتاح» غير دقيقة ⇒ تحذير زائد أو ناقص. لا دينار يضيع.
2. **إصلاحه كتابة واحدة بلا تأكيد ولا سجل تدقيق مالي:** `recomputeEarmarked` ثم `set` بقيمة مطلقة.
   يُشغَّل عند كل تسجيل دخول مع `auditTrialBalance` — رخيص لأن الأهداف والالتزامات مقروءة أصلاً
   لأجل لوحة التحكم.
3. **لا يُمنع بسببه أي ترحيل.** الحارس المانع الوحيد هو `minBalanceMinor`. هذا هو جوهر ADR-017:
   الحجز نية المستخدم، والنية لا تمنعه من التصرف في ماله — تُنبّهه فقط.
