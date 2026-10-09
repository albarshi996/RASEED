# المعمارية البرمجية وهيكل المشروع — رصيد | RASEED

> **المسار:** `docs/design/02-architecture.md`
> **الحالة:** **معتمدة للتنفيذ.** هذه الوثيقة هي العقد المعماري الذي تُبنى عليه كل الوحدات.
> **المرجع الأعلى:** `docs/00-REQUIREMENTS.md` ثم `docs/01-OWNER-DECISIONS.md` (ق-1، ق-2، ق-3)
> ثم `docs/design/01-financial-core.md` (**النواة المحاسبية — عقد مُلزِم لا يُخالَف**).
> **النطاق:** المعمارية، الطبقات، شجرة الملفات، إدارة الحالة، الأخطاء، التحقق، PWA، البيئة، الأدوات.
> **ما ليس في نطاقها:** المنطق المحاسبي (في النواة)، قواعد الأمان التفصيلية (في النواة §14)،
> نظام التصميم البصري، ومخطط قاعدة البيانات (في النواة §4).
> **المرحلة:** تصميم. هذه الوثيقة لا تُنشئ كوداً تطبيقياً.

---

## 0. كيف تُقرأ هذه الوثيقة

| القسم | ما فيه | من يقرؤه |
|---|---|---|
| 1 | الملخص التنفيذي — القرارات العشرة في صفحة واحدة | المالك + أي مطوّر جديد |
| 2 | حالة البيئة الفعلية مقابل ما ورد في التكليف | **يُقرأ أولاً — المشروع ليس فارغاً** |
| 3 | ADR-023: Vite + React 19 + TS مقابل Next.js | المالك + المعماري |
| 4 | الطبقات السبع ومصفوفة الاستيراد وكيف تُفرض آلياً | الجميع — هذا جدول الحقيقة |
| 5 | شجرة الملفات الكاملة | من يكتب أول ملف |
| 6 | إدارة الحالة: TanStack Query + Zustand + سجل الاشتراكات الحيّة | `data/live/**` + `features/**` |
| 7 | معالجة الأخطاء المركزية: `AppError`، Boundary، toast، السجل | `domain/errors/**` + `app/errors/**` |
| 8 | التحقق بـ Zod: الحدّان بالضبط ومشاركة المخططات | `domain/contracts/**` + `data/codecs/**` |
| 9 | PWA والعمل دون اتصال و`persistentLocalCache` | `data/firebase/**` + `app/boot/**` |
| 10 | إعداد البيئة والأسرار وتقييد المفاتيح | المالك + النشر |
| 11 | التوجيه والمصادقة وتسلسل الإقلاع | `app/**` |
| 12 | الأدوات والإصدارات وسكربتات `package.json` و CI | المطوّر + CI |
| 13 | RTL والسمات والأداء | `ui/**` |
| 14 | ثغرات مكتشفة في العقد تخصّ هذه الطبقة | المراجعة الهندسية |
| 15 | مصفوفة تتبّع المتطلبات (1→26) | المالك — إثبات التغطية |
| 16 | فهرس ADR وما بقي للمالك | المالك |
| 17 | خلاصة العقد المعماري في عشر جُمل | الجميع |

**اصطلاحات ثابتة:**

- كل اسم مجلد أو ملف أو دالة أو نوع مكتوب بالإنجليزية = **اسمه النهائي في الكود**، لا اقتراح.
- «النواة §N» = القسم N في `docs/design/01-financial-core.md`.
- «المتطلبات §N» = القسم N في `docs/00-REQUIREMENTS.md`.
- `B#` = قاعدة حدود مفروضة بأداة البناء (جدول 4.4).
- أي قرار يخالف النواة = **عيب يُصلَح**، لا خيار. وأي ثغرة في النواة تُرفع في القسم 14 ولا تُعدَّل في مكانها.

---

## 1. الملخص التنفيذي

**القرارات العشرة التي تُحدِّد شكل الكود كله:**

1. **Vite 8 + React 19 + TypeScript 6، تطبيق صفحة واحدة (SPA)، ينشر على Firebase Hosting.**
   لا Next.js: كل البيانات خاصة وخلف المصادقة فلا قيمة لـ SSR، ولا خادم يمكن تشغيله على Spark
   (ق-1). التفصيل والبدائل المرفوضة في ADR-023.
2. **سبع طبقات باتجاه اعتماد واحد لا يُنقض:**
   `app → features → {stores, data, ui} → domain → lib`.
   `domain` نقية 100% (صفر `firebase`)، و`data` هي **الطبقة الوحيدة** التي تلمس Firestore،
   و`ui` مكوّنات غبية لا تعرف كلمة `debit`. الاتجاه مفروض **بأداة البناء** لا بمراجعة الكود (§4).
3. **TanStack Query هي الذاكرة الوحيدة لحالة الخادم، و Zustand للحالة المحلية فقط.**
   **لا مبلغ (`*Minor`) يُخزَّن في Zustand إطلاقاً** — مفروض بقاعدة بناء (B14).
4. **اشتراكات `onSnapshot` تُدار في سجل مركزي بعدّاد مراجع (ref-counted registry)**
   يكتب في ذاكرة Query عبر `setQueryData`، بمهلة سماح 30 ثانية قبل إلغاء الاشتراك.
   هذا يحلّ: تسريب الاشتراكات، ازدواجها عند تعدّد المكوّنات، و`StrictMode` المزدوج في التطوير (§6.4).
5. **`AppError` مغلّف أخطاء واحد** بحقل `messageAr` جاهز للعرض، ينتج من ثلاثة مصادر
   (`DomainError`، أخطاء Firestore، أخطاء Zod) بجدول تحويل واحد في `domain/errors` **نقي بلا firebase** (§7).
6. **Zod على حدّين بالضبط:** حدّ الإدخال (نموذج → `OperationRequest`) وحدّ القراءة
   (`DocumentSnapshot` → كيان مُتحقَّق). المخطط **واحد مشترك** بين النموذج والمستودع في
   `domain/contracts/**`. وفشل فكّ ترميز **إسقاط مالي** = خطأ سلامة حاجب، لا صفّ مكسور (§8).
7. **`persistentLocalCache` مُفعَّل** بمدير التبويبات المتعدد — **ولا يُهدِّد صحة الأرصدة إطلاقاً**،
   لأن `runTransaction` **لا يقرأ من الكاش أبداً** (قراءاته خادمية حصراً). الخطر الحقيقي الوحيد
   هو **عرض** رصيد قديم، ويُعالَج بوسم نضارة مشتق من `snapshot.metadata.fromCache` + حجب أزرار
   العمليات المالية دون اتصال وتحويلها إلى طابور `pendingCommands` بوسم «بانتظار المزامنة» (§9.3).
8. **عامل الخدمة يخزّن قوقعة التطبيق فقط. صفر تخزين مؤقت لبيانات Firestore** (`runtimeCaching: []`).
   تحديث التطبيق **إجباري غير قابل للتجاهل** عند `meta/schema.currentVersion > APP_SCHEMA_VERSION` (§9.4).
9. **التاريخ المحاسبي يُحسب بتوقيت `Africa/Tripoli` الثابت (UTC+2 بلا توقيت صيفي)** لا بتوقيت
   المتصفح — وإلا تغيّر `bookedAt` و`periodKey` بتغيّر منطقة الجهاز (ADR-033، ويُرفع في §14).
10. **بوابات الإقلاع الست** (بيئة → مصادقة → ملكية → تهيئة → نسخة مخطط → سلامة/إعادة بناء) تعمل
    **بترتيب مُلزِم** قبل أي كتابة مالية، ثم تُفرَّغ الطوابير ويُشغَّل الاستدراك (§11.4).

**ما لا تفعله هذه المعمارية، صراحةً:** لا تُضيف خادماً، ولا طبقة BFF، ولا GraphQL، ولا Redux،
ولا state machine عامة، ولا monorepo. كل واحدة منها حُسمت بسبب مذكور لا بتفضيل.

---

## 2. حالة البيئة الفعلية — تصحيح إلزامي لما ورد في التكليف

> **التكليف الذي وصلني يقول «مجلد العمل فارغ تماماً… مشروع جديد من الصفر (greenfield)».
> هذا غير صحيح عند كتابة هذه الوثيقة.** والمتطلبات §25 بند 2 تُلزم: «فحص الملفات الحالية قبل
> إنشاء بدائل أو تغيير الهيكل». فحصتُها، وهذه الحالة الفعلية:

| البند | ما ورد في التكليف | **الواقع المفحوص** |
|---|---|---|
| المستودع | 0 commits | **2 commits** (`dc9e6af`, `a90c637`) |
| المشروع | لا يوجد | `package.json` + `package-lock.json` + `node_modules` **موجودة ومثبَّتة** |
| الحزمة التقنية | غير محسومة | **محسومة فعلاً في `package.json`:** Vite 8 + React 19 + TS 6 + Tailwind 4 + TanStack Query 5 + Zustand 5 + Zod 4 + firebase 13 + react-router 8 |
| `vite.config.ts` | — | **موجود** بإعداد PWA كامل (`registerType: 'prompt'`, `runtimeCaching: []`) |
| `tsconfig.json` | — | **موجود** بصرامة كاملة (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) |
| `eslint.config.js` | — | **موجود** بحدود طبقات مُنفَّذة بقواعد ESLint الأصلية |
| الكود | لا شيء | `src/domain/money/{types,arithmetic,rate,allocate}.ts` **مكتوبة** |
| `.env.example` / `.env.local` / `.firebaserc` | — | **موجودة** (`default: raseed-2fac1`) |
| سكربتات `package.json` | — | **لا يوجد أي سكربت** — `"scripts"` غائب كلياً |

**أثر ذلك على هذه الوثيقة — ثلاث قواعد التزمتها:**

1. **لا أعيد تأسيس ما تأسّس.** قرار الحزمة التقنية مُنفَّذ بالفعل، ودوري **تبريره كـ ADR وإكماله**،
   لا نقضه. ADR-023 يُدوِّن القرار القائم بأدلته ويرفض Next.js صراحةً.
2. **كل ما أقترحه إمّا موجود ويُوثَّق، أو ناقص ويُسمّى «يُنشأ»**. الجدول في §12.3 يفصل الحزم
   **المثبَّتة فعلاً** (بإصداراتها الحقيقية من `package-lock.json`) من **المطلوب إضافتها**.
3. **الانحرافات القائمة في الكود عن نص النواة أُقرّها أو أرفعها، ولا أسكت عنها** — جدول §14.1.

---

## 3. ADR-023 — Vite + React 19 + TypeScript (SPA) وليس Next.js

### 3.1 القرار

> **تطبيق صفحة واحدة (SPA) مبني بـ Vite 8، React 19، TypeScript 6، يُنشر كملفات ساكنة على
> Firebase Hosting. لا عرض من الخادم (SSR)، ولا توليد ساكن (SSG)، ولا مسارات API.**

### 3.2 الأدلة الخمسة — كل واحد منها كافٍ وحده

| # | الدليل | التفصيل |
|---|---|---|
| **1** | **لا صفحة عامة واحدة في النظام** | ق-2: مزوّد وحيد Google، والقواعد تُغلق النظام على UID واحد. **كل** بايت بيانات خلف المصادقة. قيمة SSR الأساسية (HTML أولي ذو معنى + SEO) = **صفر**: ما يمكن عرضه بلا مصادقة هو شاشة «سجّل الدخول» فقط |
| **2** | **SSR على Spark مستحيل** | عرض الخادم في Next.js يحتاج Cloud Functions / Cloud Run، وكلاهما **يتطلب Blaze** (ق-1). أي معمارية Next.js على Spark تهبط إلى `output: 'export'` — أي **SPA بتكلفة إطار كامل وبلا مزاياه** |
| **3** | **بيانات المستخدم لا تُعرض من الخادم أصلاً** | النواة §5.3: كل رقم مالي يأتي من `onSnapshot` حيّ على `accounts` و`periods`. HTML مُعرَّض من الخادم سيكون **قديماً لحظة وصوله**، ويحتاج إعادة ترطيب (hydration) تُعيد نفس القراءات ⇒ **قراءات مفوترة مضاعفة** على Spark |
| **4** | **PWA أبسط وأصلب في Vite** | `vite-plugin-pwa` يعطي precache للقوقعة بسطرين. PWA في Next.js App Router يحتاج ترتيبات إضافية حول التوجيه والترطيب، وأي خطأ فيه يصطدم مباشرة بأخطر نقطة في تصميمنا: **تخزين مؤقت لبيانات مالية** (§9) |
| **5** | **النشر وسطح العمليات** | `npm run build` ⇒ `dist/` ⇒ `firebase deploy --only hosting`. لا خادم يُراقَب، لا بداية باردة (cold start)، لا نسخة Node على الخادم تُحدَّث. لمشروع بمطوّر واحد هذا فرق جوهري في كلفة الصيانة |

**نقطة حُسمت بالقياس لا بالرأي:** الحجة الوحيدة الجدية لـ Next.js هنا كانت «مسارات API لإخفاء
منطق موثوق». وهي **ساقطة على Spark** (لا مسارات API)، **ومُعالَجة في النواة §18.4**: الفرض الخادمي
الحقيقي يبدأ عند Blaze مع Cloud Function كاتب وحيد، و`planOperation` النقية **تُشارَك كملف واحد**
بين العميل والخادم. أي أن الترقية المستقبلية **تفعيل ميزة لا إعادة بناء** — وهو شرط ق-1 الصريح.

### 3.3 البدائل المرفوضة

| البديل | المزية المفقودة | سبب الرفض الحاسم |
|---|---|---|
| **Next.js 15 (App Router) بـ SSR** | HTML أولي، RSC، مسارات API | **يتطلب Blaze** (ق-1 يمنعه). ولو تُرقّي: لا قيمة لـ SSR لبيانات كلها خلف المصادقة، ويضاعف القراءات المفوترة بالترطيب |
| **Next.js بـ `output: 'export'`** | توافق مستقبلي مع SSR | **أسوأ الخيارين معاً**: كلفة إطار كامل (توجيه الملفات، حدود server/client، تعقيد البناء) **بلا أي** من مزاياه. و`next/image` و`revalidate` و`middleware` **كلها معطَّلة** في هذا الوضع |
| **Remix / React Router v7 framework mode** | تحميل البيانات في المسار (loaders) | نفس مشكلة الخادم. و`loader` المبني على `fetch` يتعارض مع نموذجنا: مصدر الحقيقة اشتراك حيّ لا طلب واحد. (نستخدم react-router **كموجِّه بيانات في المتصفح فقط** — ADR-040) |
| **Vite + TanStack Start** | SSR اختياري | إطار حديث سطحه غير مستقر بالقدر الكافي لنظام مالي شخصي يُفترض أن يعمل سنوات بصيانة فرد واحد، ويتطلب خادماً للاستفادة منه |
| **تطبيق أصلي (React Native / Flutter)** | تجربة هاتف أفضل، إشعارات والتطبيق مغلق | المتطلبات §1 تنصّ على **تطبيق ويب** قابل للتطوير لاحقاً. وإشعارات الدفع تتطلب خادماً (ق-1). PWA مثبَّتة تغطّي المطلوب الآن |
| **Astro / HTML+Alpine** | حجم أصغر | واجهة غنية الحالة (لوحة تحكم حيّة، نماذج مركّبة، تقارير تفاعلية) ليست موقعاً بمحتوى. تُخسر منظومة React وTanStack Query بلا مقابل |

### 3.4 كيف نعرف أننا أخطأنا

| المؤشر | ماذا يعني | الإجراء |
|---|---|---|
| أول فتحة باردة > 3 ثوانٍ على 4G بعد التحسين | حجم الحزمة لا التقديم هو المشكلة | تقسيم أدق للمسارات، لا الانتقال إلى SSR |
| ظهور حاجة حقيقية لصفحة عامة (مشاركة تقرير برابط) | فرضية «كل البيانات خاصة» سقطت | صفحة واحدة مُعرَّضة عبر Cloud Function عند Blaze، **لا** إعادة بناء التطبيق |
| إضافة مستخدم ثانٍ | النواة §18.4: شرط الترقية الحقيقي | Blaze + Cloud Function كاتب وحيد، و`planOperation` تُشارَك كما هي |

---

## 4. الطبقات وحدود الاستيراد

### 4.1 الطبقات السبع — وما يُسمح لكل واحدة بالوصول إليه

> **ملاحظة توافق مع النواة:** النواة §21.1 تُحدِّد ثلاث طبقات (`domain`, `data`, `ui`). هذه الوثيقة
> **تُوسِّعها ولا تنقضها**: `domain` و`data` كما هما حرفياً، و`ui` تبقى «لا تحسب شيئاً»، ويُضاف
> `app` و`features` و`stores` و`lib` لأن النواة لم تتناول قوقعة التطبيق. أي تعارض = خطأ في
> هذه الوثيقة يُصلَح لصالح النواة.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ app/        الإقلاع، الموفِّرون (providers)، الموجِّه، حدود الأخطاء، البوابات.   │
│             الطبقة الوحيدة التي تُنشئ QueryClient وتربط Firebase بـ React.      │
├──────────────────────────────────────────────────────────────────────────────┤
│ features/   شاشة لكل وحدة في المتطلبات: مكوّنات الشاشة + hooks + نماذج.        │
│             تنادي domain.execute() و domain.selectors، وتقرأ عبر data/live.    │
│             **لا تستورد firebase. لا تحسب مبلغاً.**                            │
├───────────────────────────┬──────────────────────┬───────────────────────────┤
│ stores/                   │ data/                │ ui/                       │
│ حالة محلية فقط (Zustand): │ **الطبقة الوحيدة**    │ مكوّنات غبية + نظام التصميم│
│ سمة، تخطيط، مرشّحات،      │ التي تلمس Firestore:  │ props داخلة، أحداث خارجة. │
│ toasts، نضارة، بوابات.    │ repos, codecs, tx,    │ **لا بيانات، لا عمليات،**  │
│ **لا مبالغ (B14).**        │ live, outbox, auth.   │ **لا debit/credit.**      │
├───────────────────────────┴──────────────────────┴───────────────────────────┤
│ domain/     المنطق المحاسبي النقي + الأنواع + مخططات Zod + المحدِّدات.          │
│             **صفر استيراد من firebase و data و ui و features و stores.**       │
│             المكان **الوحيد** الذي يبني lines و side (النواة §1.1).            │
├──────────────────────────────────────────────────────────────────────────────┤
│ lib/        أدوات عامة بلا أي معرفة بالمجال: الوقت، IndexedDB، Result،         │
│             المعرّفات، التسجيل، env. **لا تستورد أي طبقة داخلية.**             │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 مصفوفة الاستيراد — جدول الحقيقة

`✓` = مسموح. `✗` = **خطأ بناء**. `T` = الأنواع فقط (`import type`).

| من ↓ / إلى → | `app` | `features` | `stores` | `data` | `ui` | `domain` | `lib` | `firebase/*` |
|---|---|---|---|---|---|---|---|---|
| **`app`** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ *(عبر `data/firebase` فقط)* |
| **`features`** | ✗ | ✓ *(داخل نفس الميزة)* | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** |
| **`stores`** | ✗ | ✗ | ✓ | ✗ | ✗ | `T` + `domain/errors` | ✓ | ✗ |
| **`data`** | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | **✓ (حصراً)** |
| **`ui`** | ✗ | ✗ | ✗ | ✗ | ✓ | `T` من `domain/types` فقط | ✓ | ✗ |
| **`domain`** | ✗ | ✗ | ✗ | **✗** | ✗ | ✓ | ✓ | **✗** |
| **`lib`** | ✗ | ✗ | ✗ | ✗ | ✗ | **✗** | ✓ | ✗ |

**خمسة قرارات في هذه المصفوفة تحتاج تبريراً صريحاً:**

1. **`features → data` مباشرة (لا `features → domain → data`).**
   اتجاه التكليف المقترح كان `ui → features → domain → data`. **هذا الاتجاه غير قابل للتنفيذ:**
   `domain` نقية ولا تعرف Firestore (النواة §1.1 نصّاً)، فلا يمكن أن تكون وسيطاً للوصول إلى
   البيانات. الاتجاه الصحيح: `features` تنادي `data` للقراءة والكتابة، و`data` تنادي `domain`
   للتخطيط والتحقق. و**المنطق المحاسبي يبقى حصراً في `domain`** — وهو جوهر الشرط لا شكل السهم.
2. **`ui` تستورد الأنواع فقط من `domain/types`.**
   بطاقة تعرض حساباً تحتاج `Account` كنوع. منعها كلياً يُنتج تكرار أنواع — وهو أسوأ. والحدّ الصارم:
   `import type` فقط (`verbatimModuleSyntax: true` في tsconfig يجعل الاستيراد التنفيذي مرئياً ومرفوضاً).
3. **`ui` لا تستورد `stores` إطلاقاً.** مكوّن يقرأ متجراً عالمياً ليس غبياً ولا قابلاً لإعادة
   الاستخدام ولا للاختبار بلا سياق. السمة (theme) تُمرَّر عبر CSS variables على `<html>` لا عبر hook.
4. **`stores` تستورد من `domain` الأنواع و`domain/errors` فقط.** متجر الـ toasts يحتاج
   `DomainErrorCode` لإلغاء التكرار، ومتجر البوابات يحتاج أنواع السلامة. ولا يحقّ له استيراد
   `domain/ops` ولا `domain/ledger` — **المتاجر لا تخطّط عمليات**.
5. **`lib` لا تستورد `domain`.** هذا ما يجعل `lib/time` و`lib/idb` قابلة للاختبار والنقل، ويمنع
   تسلّل منطق مالي إلى أدوات عامة. وعكسها مسموح: `domain → lib` (مثلاً `domain/period` تستخدم
   `lib/time/tripoli`).

### 4.3 طبقة `data` بالتفصيل — من يكتب ماذا

```
features  ──(OperationRequest)──►  data/ledger/postOperation  ──►  domain/ops/planOperation  (نقية)
                                            │                               │
                                            │◄────── WritePlan ─────────────┘
                                            ▼
                                   data/tx/runPlan (reads → decide → writes)
                                            ▼
                                        Firestore
```

| الوحدة في `data` | مسؤوليتها الوحيدة | ما يُحرَّم عليها |
|---|---|---|
| `data/firebase/**` | تهيئة `app`/`auth`/`firestore`، المحاكي، النضارة | أي منطق مجال |
| `data/tx/runPlan.ts` | فرض `reads → decide → writes` بالتوقيع (النواة §7.2) | أي قراءة بعد كتابة، أي استعلام داخل معاملة |
| `data/ledger/postOperation.ts` | **نقطة الكتابة المالية الوحيدة** (النواة §7.3) | بناء `lines` أو `side` — ذلك لـ `domain/ops` |
| `data/codecs/**` | فكّ ترميز المستندات والتحقق منها + الترحيل البطيء | رمي أخطاء خام إلى الواجهة |
| `data/live/**` | سجل الاشتراكات الحيّة وربطها بذاكرة Query | تخزين مبالغ في Zustand |
| `data/repos/**` | استعلامات مقروءة مُسمّاة + كتابات غير مالية | أي كتابة تمسّ `balanceMinor`/`paidMinor`/`settledMinor`/`spentMinor`/`savedMinor` |
| `data/outbox/**` | طابور `pendingCommands` وتفريغه تسلسلياً (النواة §6.6) | تنفيذ متوازٍ |
| `data/export/**` | تصدير JSON الكامل واستعادته (ق-1) | استيراد المُجمَّعات (الدفتر فقط ثم إعادة بناء) |

### 4.4 كيف تُفرض الحدود آلياً — `B1…B16`

> **القاعدة الحاكمة (النواة §21): مراجعة الكود ليست حاجزاً. الأداة هي الحاجز.**
> مراجعة الكود لمطوّر واحد = لا مراجعة.

**ADR-025 — الفرض بقواعد ESLint الأصلية، لا بـ `eslint-plugin-boundaries`.**
هذا **تثبيت لانحراف قائم ومبرَّر في `eslint.config.js`**: الإضافة تجرّ `handlebars@4.7.9` بثغرتين
حرجتين و`braces@3.0.3` بثغرة عالية. البديل المعتمد (`no-restricted-imports` بمجموعات
+ `no-restricted-syntax` بمحدِّدات AST) **يحقق نفس الفرض بصفر اعتماديات إضافية**، والمحصّلة
`npm audit` = 0 ثغرات. **القرار: يبقى.** والثمن المعلن: رسائل الخطأ أقل تفصيلاً من الإضافة
المتخصّصة، وكل طبقة جديدة تحتاج كتلة `files` جديدة يدوياً.

| # | القاعدة | الآلية | الحالة |
|---|---|---|---|
| **B1** | `domain` لا تستورد `firebase`/`data`/`ui`/`features`/`stores`/`app` | `no-restricted-imports` | **مُنفَّذة** |
| **B2** | `ui` لا تستورد `firebase`/`data`/`features`/`app`/`domain/ops` | `no-restricted-imports` | **مُنفَّذة** |
| **B3** | لا `firebase/firestore` خارج `src/data/**` | `no-restricted-imports` في `features`+`ui`+`domain`+`stores`+`lib` | **مُنفَّذة جزئياً** — تُضاف إلى `stores` و`lib` |
| **B4** | `*` أو `/` على قيمة `Minor` خارج `domain/money/**` | `no-restricted-syntax` + حظر `Math.round/floor/ceil/trunc` | **مُنفَّذة** (شكل الحظر) |
| **B5** | حرفيات `lines:`/`side:`/`'debit'`/`'credit'` خارج `domain/{ops,ledger,coa,rules}` | `no-restricted-syntax` | **تُضاف** |
| **B6** | `increment()` على `paidMinor`/`settledMinor`/`spentMinor`/`savedMinor`/`earmarkedMinor` | `no-restricted-syntax` | **تُضاف** |
| **B7** | `writeBatch` يمسّ `balanceMinor`/`paidMinor`/`settledMinor`/`spentMinor` خارج `data/ledger/rebuild.ts` | `no-restricted-syntax` + مراجعة | **تُضاف** |
| **B8** | `toFixed(`/`toLocaleString(`/`Intl.NumberFormat` في `ui`/`features` | `no-restricted-syntax` | **تُضاف** |
| **B9** | `Date.now()`/`new Date()`/`crypto.randomUUID()`/`serverTimestamp()` داخل `decide` | حظر `new Date()` عام + مراجعة التوقيع | **مُنفَّذة** (`new Date()`) |
| **B10** | `entry.kind` داخل `domain/rules/classify.ts` أو أي محدِّد يحسب رقماً | `no-restricted-syntax` على `src/domain/selectors/**` | **تُضاف** |
| **B11** | `getDocFromCache`/`getDocsFromCache`/`getDocFromServer` ممنوعة **في كل المشروع** | `no-restricted-imports` على أسماء المصدَّرات | **تُضاف** — §9.3 |
| **B12** | `enableIndexedDbPersistence`/`enableMultiTabIndexedDbPersistence` (مهجورة) | `no-restricted-imports` | **تُضاف** |
| **B13** | أصناف Tailwind الاتجاهية (`ml-`,`mr-`,`pl-`,`pr-`,`text-left`,`text-right`,`left-`,`right-`) | `no-restricted-syntax` على `className` | **تُضاف** — §13.1 |
| **B14** | أي معرّف ينتهي بـ `Minor` داخل `src/stores/**` | `no-restricted-syntax` | **تُضاف** — ADR-039 |
| **B15** | `useQuery`/`useMutation` خارج `features/**/hooks/**` و`data/live/**` | `no-restricted-syntax` | **تُضاف** |
| **B16** | `any`/`as unknown as`/`@ts-expect-error` بلا سبب مكتوب في `domain` و`data` | `strictTypeChecked` + `no-restricted-syntax` على `TSAsExpression` | **مُنفَّذة جزئياً** |

**الإضافات الملموسة إلى `eslint.config.js`** (تُدمج مع الكتل القائمة لا تحلّ محلها):

```js
// ── B5 + B6 + B7 + B10: حماية جوهر التصميم ──────────────────────────────
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/domain/ops/**', 'src/domain/ledger/**', 'src/domain/coa/**', 'src/domain/rules/**'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "Literal[value='debit']",  message: 'B5: بناء lines و side حصراً في domain/{ops,ledger,coa,rules}. الواجهة لا تعرف مدين/دائن.' },
      { selector: "Literal[value='credit']", message: 'B5: نفس السبب.' },
      { selector: "Property[key.name='lines']", message: 'B5: مصفوفة السطور تُبنى في domain/ops/plan.ts فقط.' },
      { selector: "Property[key.name='side']",  message: 'B5: الجانب يُحدَّد في domain فقط.' },
    ],
  },
},
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/data/ledger/rebuild.ts'],
  rules: {
    'no-restricted-syntax': ['error',
      // B6 — جدول النواة §5.4: هذه الحقول «قراءة + قيمة مطلقة» لأن قراراً يعتمد على نتيجتها
      { selector: "CallExpression[callee.name='increment']",
        message: 'B6: increment ممنوع على paidMinor/settledMinor/spentMinor/savedMinor/earmarkedMinor (النواة §5.4). استخدم قراءة + قيمة مطلقة محسوبة.' },
      // B7 — writeBatch لا يكشف التنازع ⇒ آخر كتابة تفوز
      { selector: "CallExpression[callee.name='writeBatch']",
        message: 'B7: writeBatch ممنوع على حقول الأرصدة والمتبقّيات. الترحيل المالي عبر runTransaction حصراً (النواة §7.1).' },
    ],
  },
},
{
  // B10 — التقرير دالّة في نوع الحساب لا في kind (النواة R11)
  files: ['src/domain/selectors/**/*.ts', 'src/domain/rules/classify.ts', 'src/domain/reports/**/*.ts'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "MemberExpression[property.name='kind']",
        message: 'B10: يُحرَّم استخدام entry.kind في أي دالة تحسب رقماً. التصنيف من accountType (النواة R11).' },
    ],
  },
},
// ── B11 + B12: الكاش لا يُقرأ منه قرار مالي أبداً ───────────────────────
{
  files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: 'firebase/firestore',
        importNames: [
          'getDocFromCache', 'getDocsFromCache',       // B11 — قراءة مالية من كاش قديم
          'getDocFromServer', 'getDocsFromServer',     // B11 — قراءة مفوترة تتخطى الكاش بلا داعٍ
          'enableIndexedDbPersistence',                 // B12 — مهجورة
          'enableMultiTabIndexedDbPersistence',         // B12 — مهجورة
        ],
        message: 'B11/B12: الكاش لا يخدم قراراً مالياً، والقرار المالي داخل runTransaction (خادمي حتماً). التهيئة عبر persistentLocalCache في data/firebase/app.ts.',
      }],
    }],
  },
},
// ── B13: RTL حقيقي — لا أصناف اتجاهية فيزيائية ──────────────────────────
{
  files: ['src/{ui,features,app}/**/*.tsx'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-/]",
        message: 'B13: RTL حقيقي (المتطلبات §3). استخدم الخصائص المنطقية: ms/me/ps/pe/start/end/border-s/border-e.' },
      { selector: "JSXAttribute[name.name='className'] Literal[value=/text-(left|right)/]",
        message: 'B13: استخدم text-start / text-end.' },
    ],
  },
},
// ── B14: لا مال في المتاجر المحلية ──────────────────────────────────────
{
  files: ['src/stores/**/*.ts'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "Identifier[name=/Minor$/]",
        message: 'B14 (ADR-039): المتاجر المحلية لا تحمل مبالغ. كل مبلغ من ذاكرة TanStack Query عبر محدِّد في domain.' },
      { selector: "TSTypeReference[typeName.name='Minor']", message: 'B14: نفس السبب.' },
    ],
  },
},
// ── B8: التنسيق المالي في مكان واحد ─────────────────────────────────────
{
  files: ['src/{ui,features}/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "MemberExpression[property.name='toFixed']",
        message: 'B8: دالة تنسيق واحدة في النظام: domain/money/format.ts → formatLYD (النواة §2.2).' },
      { selector: "MemberExpression[property.name='toLocaleString']", message: 'B8: نفس السبب.' },
      { selector: "NewExpression[callee.object.name='Intl']",
        message: 'B8: Intl.NumberFormat يُنشأ مرة واحدة في domain/money/format.ts (ق-3: ar-LY-u-nu-latn).' },
    ],
  },
},
```

**شبكة أمان ثانية — `scripts/verify-layers.mjs`:**
سكربت Node بلا اعتماديات يمشي على `src/**/*.ts{,x}`، يستخرج كل `import`/`export … from` بتعبير نمطي،
ويقارنها بمصفوفة 4.2 المُقنَّنة في جدول داخله. يُشغَّل في CI وفي `pre-push`.
**لماذا طبقة ثانية؟** لأن `no-restricted-imports` لا يرى الاستيراد الديناميكي
(`await import('@/data/...')`) ولا `require` ولا المسارات النسبية الصاعدة
(`../../data/x` بدل `@/data/x`). السكربت يطبّع المسارات النسبية إلى طبقات ويكشف الحالتين.

---

## 5. شجرة الملفات الكاملة

### 5.1 الجذر

```
RASEED/
├─ .github/
│  └─ workflows/
│     ├─ ci.yml                        فحص + اختبارات + بناء (كل push و PR)
│     └─ deploy.yml                    نشر Hosting + القواعد + الفهارس (يدوي بموافقة)
├─ .husky/
│  ├─ pre-commit                       lint-staged
│  └─ pre-push                         tsc --noEmit + unit + eslint --max-warnings 0
├─ .vscode/
│  ├─ settings.json                    تنسيق عند الحفظ، eslint، RTL في المحرر
│  └─ extensions.json
├─ docs/
│  ├─ 00-REQUIREMENTS.md               ★ قائم
│  ├─ 01-OWNER-DECISIONS.md            ★ قائم
│  ├─ adr/
│  │  ├─ ADR-001-minor-unit-dirham.md … ADR-022-getafter-rule.md       (من النواة §1.4)
│  │  └─ ADR-023-vite-spa.md … ADR-040-router-data-mode.md             (من هذه الوثيقة §16.1)
│  ├─ design/
│  │  ├─ 01-financial-core.md          ★ قائم — **العقد المحاسبي المُلزِم**
│  │  ├─ 01-core-part1-model.md … 01-core-part5-ops.md   ★ قائمة — تفصيل النواة بأجزائها
│  │  ├─ 02-architecture.md            ★ هذه الوثيقة
│  │  ├─ 03-data-model.md              ★ قائم — مخطط Firestore الكامل والفهارس
│  │  ├─ 04-security.md                ★ قائم — قواعد Firestore/Storage والخصوصية
│  │  ├─ 05-design-system.md           ★ قائم — نظام التصميم والهوية البصرية و RTL
│  │  ├─ 06-module-map.md              ★ قائم — خريطة الوحدات والترابط
│  │  ├─ 07-recurrence-notifications.md ★ قائم — المتكررات والتنبيهات على Spark
│  │  ├─ 08-reports.md                 ★ قائم — التقارير والتحليلات والتصدير
│  │  ├─ 09-personal-worship.md        ★ قائم — المفكرة والمهام والعبادات والزكاة
│  │  ├─ core-A.md / core-B.md / core-C.md   ★ قائمة — أرشيف تقييم، لا مرجع تنفيذي
│  ├─ ops/
│  │  ├─ RUNBOOK.md                     دليل التشغيل والنشر والتراجع
│  │  ├─ FIREBASE-SETUP.md              خطوات الكونسول: Web App، Firestore، Auth، تقييد المفتاح
│  │  └─ BACKUP.md                      إجراء التصدير اليدوي والاستعادة (ق-1)
│  └─ qa/
│     ├─ BUGLOG.md                      سجل الأخطاء (النواة §20)
│     └─ TEST-PLAN.md                   خطة الاختبار ومصفوفة التغطية
├─ public/
│  ├─ favicon.svg
│  ├─ apple-touch-icon.png
│  ├─ pwa-192.png  pwa-512.png  pwa-512-maskable.png
│  ├─ robots.txt                        Disallow: /   (لا شيء عام — ق-2)
│  └─ fonts/
│     ├─ IBMPlexSansArabic-Regular.woff2
│     ├─ IBMPlexSansArabic-Medium.woff2
│     └─ IBMPlexSansArabic-SemiBold.woff2     مستضافة محلياً — ADR-035
├─ scripts/
│  ├─ verify-layers.mjs                 شبكة أمان حدود الطبقات (§4.4)
│  ├─ seed-chart-of-accounts.ts          تهيئة الشجرة والمستندات الإلزامية (النواة §3.3)
│  ├─ print-owner-uid.ts                 يطبع UID بعد أول تسجيل دخول لتثبيته في القواعد (ق-2)
│  ├─ export-backup.ts                   تصدير JSON من سطر الأوامر (ق-1)
│  └─ check-env.mjs                      يتحقق من .env.local قبل البناء
├─ tests/
│  ├─ setup/
│  │  ├─ vitest.unit.ts                  إعداد اختبارات الوحدة النقية
│  │  ├─ vitest.dom.ts                   jsdom + @testing-library/jest-dom + matchMedia
│  │  └─ emulator.ts                     initializeTestEnvironment + تنظيف بين الاختبارات
│  ├─ fixtures/
│  │  ├─ accounts.ts  entries.ts  obligations.ts  debts.ts
│  │  └─ scenarios.ts                    سيناريوهات القسم 9 في النواة كبيانات
│  ├─ unit/
│  │  ├─ money/           T-MONEY · T-MONEY-FMT · T-ALLOC
│  │  ├─ ledger/          T-BALANCE · T-PLAN · T-KIND · T-NATURE · T-EXTRA
│  │  ├─ rules/           T-STATUS · T-OVER · T-FLOOR · T-EARMARK
│  │  ├─ recurrence/      T-RECUR (planCatchUp النقية)
│  │  ├─ selectors/       محدِّدات لوحة التحكم والتقارير
│  │  ├─ errors/          جدول تحويل أخطاء Firestore → AppError (§7.3)
│  │  └─ contracts/       مخططات Zod: حدود الإدخال والقراءة (§8)
│  ├─ dom/
│  │  ├─ forms/           نماذج المصروف والدخل والدفع (RTL + رسائل عربية)
│  │  └─ live/            useLiveQuery: عدّاد المراجع، StrictMode، التنظيف (§6.4)
│  ├─ rules/
│  │  ├─ journalEntries.rules.test.ts     T-RULES-1..9 (عيب الأسبقية ع-أ-1)
│  │  ├─ accounts.rules.test.ts           I3 · حدّ الرصيد · T-REPAIR
│  │  ├─ obligations.rules.test.ts        I5 · ADR-012
│  │  ├─ debts.rules.test.ts              I6
│  │  ├─ periods.rules.test.ts            I15 · كتابة أول الشهر (§14.2)
│  │  ├─ locks.rules.test.ts              T-LOCK · T-VOID-LOCKED
│  │  ├─ gate.rules.test.ts               T-RULES-GATE
│  │  └─ isolation.rules.test.ts          T-ISOLATION · ق-2 (UID غير معتمد)
│  ├─ integration/
│  │  ├─ postOperation.test.ts            T-IDEM · T-CONC · T-VOID · T-EDIT
│  │  ├─ outbox.test.ts                   T-OUTBOX
│  │  ├─ rebuild.test.ts                  T-REBUILD
│  │  ├─ reconcile.test.ts                T-SETTLE-LINK · T-INTEGRITY
│  │  └─ reports.test.ts                  T-REPORTS
│  └─ e2e/
│     ├─ fixtures/auth.ts                 جلسة عبر محاكي المصادقة (لا Google حقيقي)
│     ├─ smoke.spec.ts                    إقلاع، تسجيل دخول، لوحة تحكم
│     ├─ expense-flow.spec.ts             تسجيل مصروف ⇒ انعكاسه في كل الشاشات
│     ├─ offline.spec.ts                  قطع الشبكة ⇒ «بانتظار المزامنة» ⇒ العودة
│     ├─ rtl-a11y.spec.ts                 RTL + axe + تباين الألوان
│     └─ responsive.spec.ts               هاتف + حاسوب (المتطلبات §23 بند 10)
├─ .env.example                        ★ قائم — يُوسَّع (§10.2)
├─ .env.local                          ★ قائم — غير متتبَّع
├─ .firebaserc                         ★ قائم — default: raseed-2fac1
├─ .gitattributes  .gitignore          ★ قائمان
├─ .prettierrc.json  .prettierignore    يُنشأان (§12.4)
├─ eslint.config.js                    ★ قائم — يُوسَّع بـ B3,B5–B8,B10–B16
├─ firebase.json                        يُنشأ — Hosting + المحاكيات + الترويسات (§10.4)
├─ firestore.rules                      يُنشأ — من النواة §14.3 (وحدة الأمان)
├─ firestore.indexes.json               يُنشأ — من النواة §15.5
├─ storage.rules                        يُنشأ — منع كامل حتى Blaze (ق-1)
├─ index.html                            يُنشأ — dir="rtl" lang="ar" + preload الخطوط
├─ package.json                        ★ قائم — **يُضاف إليه "scripts"** (§12.2)
├─ playwright.config.ts                 يُنشأ (§12.5)
├─ README.md                            ★ قائم
├─ tsconfig.json                        ★ قائم
├─ tsconfig.node.json                   يُنشأ — لملفات الأدوات (scripts/*.mjs, *.config.ts)
├─ vite.config.ts                      ★ قائم
└─ vitest.config.ts                     يُنشأ — مشاريع unit/dom/rules/integration (§12.5)
```

`★` = موجود فعلاً اليوم. ما عداه يُنشأ.

### 5.2 `src/` — الجذر والإقلاع

```
src/
├─ main.tsx                            نقطة الدخول: createRoot + onUncaughtError/onCaughtError
├─ index.css                           Tailwind 4 + @theme + متغيرات الألوان + الخطوط + tabular-nums
├─ vite-env.d.ts                       أنواع import.meta.env + vite-plugin-pwa/client
│
├─ app/
│  ├─ App.tsx                          RouterProvider + BootGate
│  ├─ boot/
│  │  ├─ bootstrap.ts                  تسلسل الإقلاع الست (§11.4) — دالة واحدة قابلة للاختبار
│  │  ├─ BootGate.tsx                  يعرض شاشة الحالة المناسبة لكل بوابة
│  │  ├─ registerSW.ts                 تسجيل عامل الخدمة + مطالبة التحديث (§9.4)
│  │  ├─ startupTasks.ts               flushOutbox → runCatchUp → statusSweep → notifySweep
│  │  └─ screens/
│  │     ├─ EnvErrorScreen.tsx          بيئة غير صالحة — شاشة ساكنة بلا اعتماد على شيء
│  │     ├─ SignInScreen.tsx            Google فقط (ق-2)
│  │     ├─ UnauthorizedScreen.tsx      «حساب غير مُصرَّح» + تسجيل خروج
│  │     ├─ SeedingScreen.tsx           «جارٍ تهيئة حسابك…»
│  │     ├─ ForcedUpdateScreen.tsx      SCHEMA_VERSION_AHEAD — غير قابلة للتجاهل
│  │     └─ RebuildingScreen.tsx        rebuildStatus === 'running' — قراءة فقط
│  ├─ providers/
│  │  ├─ AppProviders.tsx              تركيب الموفِّرين بالترتيب الصحيح
│  │  ├─ QueryProvider.tsx             QueryClient + initLiveRegistry + Devtools في التطوير
│  │  ├─ AuthProvider.tsx              onAuthStateChanged + disposeAllLive + queryClient.clear
│  │  ├─ ThemeProvider.tsx             data-theme على <html> + prefers-color-scheme
│  │  ├─ ToastHost.tsx                 منطقة aria-live للـ toasts
│  │  ├─ IntegrityProvider.tsx         ميزان المراجعة + شريط «سلامة البيانات» الأحمر
│  │  └─ ConnectivityProvider.tsx      online/offline + نضارة البيانات (§9.3)
│  ├─ router/
│  │  ├─ routes.tsx                    createBrowserRouter + lazy لكل ميزة
│  │  ├─ paths.ts                      مسارات مُقنَّنة — لا نصوص حرّة
│  │  ├─ AuthGuard.tsx                 مسجَّل دخول؟
│  │  ├─ OwnerGuard.tsx                UID معتمد؟ (تجربة استخدام — الحاجز الحقيقي في القواعد)
│  │  └─ AppLayout.tsx                 هيكل الصفحة: شريط جانبي (حاسوب) + شريط سفلي (هاتف)
│  └─ errors/
│     ├─ AppErrorBoundary.tsx          الحد الأعلى — شاشة كاملة + تسجيل + إعادة تحميل
│     ├─ RouteErrorBoundary.tsx        لكل مسار — يحفظ القوقعة والتنقل
│     └─ globalHandlers.ts             window error + unhandledrejection → errorLog
│
├─ stores/
│  ├─ index.ts
│  ├─ themeStore.ts                    'light' | 'dark' | 'system'  (مرآة لـ settings/app)
│  ├─ dashboardStore.ts                ترتيب البطاقات وإظهارها (مرآة — المتطلبات §4)
│  ├─ filtersStore.ts                  مرشّحات كل شاشة (فترة، حساب، فئة، حالة)
│  ├─ toastStore.ts                    طابور التنبيهات + إلغاء التكرار بـ (code+entityId) 5ث
│  ├─ freshnessStore.ts                خريطة نضارة لكل مفتاح + علم «أي بيانات من الكاش»
│  ├─ gateStore.ts                     حالة البوابات: schemaAhead · rebuilding · trialBalanceBroken
│  ├─ outboxStore.ts                   عدد المعلّق + حالة التفريغ (أرقام عدّ لا مبالغ)
│  └─ uiStore.ts                       فتح الأدراج، النوافذ، الشريط الجانبي
│
└─ lib/
   ├─ time/
   │  ├─ tripoli.ts                    todayDateKey() · nowIso() · toDateKey() — UTC+2 ثابت (ADR-033)
   │  ├─ dateFormat.ts                 عرض التاريخ الميلادي (ar-LY-u-nu-latn — ق-3)
   │  └─ hijri.ts                      التاريخ الهجري للعبادات (Intl + 'islamic-umalqura')
   ├─ result.ts                        Result<T,E> · ok() · err() · isOk()
   ├─ invariant.ts                      invariant() — يرمي خطأ نظام يُسجَّل ولا يُصطاد
   ├─ ids.ts                            newOpId() · deviceId() (مستقر في localStorage)
   ├─ hash.ts                           sha256Hex عبر Web Crypto
   ├─ storage/
   │  ├─ idb.ts                        غلاف IndexedDB صغير بلا اعتماديات
   │  └─ localPrefs.ts                 localStorage مُقنَّن (سمة، deviceId) — لا بيانات مالية
   ├─ logging/
   │  ├─ errorLog.ts                   حلقة 300 مُدخَل في IndexedDB + تصدير (§7.5)
   │  └─ traceId.ts
   ├─ env.ts                           قراءة import.meta.env + تحقق Zod + fail-fast (§10.3)
   └─ a11y/
      ├─ focusTrap.ts
      └─ announce.ts                   إعلان حيّ للقارئات الصوتية بالعربية
```

### 5.3 `src/domain/` — النواة النقية

> الكتل من `money` إلى `errors` **مُثبَّتة بالنواة §21.1 ولا تُعاد تسميتها**.
> ما بعدها (`selectors`, `contracts`, `reports`, `worship`, `tasks`, `notes`, `notify`, `integrity`)
> **توسيع** لتغطية وحدات المتطلبات غير المالية.

```
src/domain/
├─ money/
│  ├─ types.ts          ★ قائم — Minor · Bps · LYD_EXPONENT · MAX_ABS_MINOR · MoneyInvariantError
│  ├─ arithmetic.ts     ★ قائم — addMinor · subMinor · sumMinor · compareMinor · assertInRange
│  ├─ rate.ts           ★ قائم — mulRate (BigInt إلزامي) · percentOf · ratioBps
│  ├─ allocate.ts       ★ قائم — splitEven · allocateByWeights (largest remainder)
│  ├─ parse.ts            يُنشأ — parseAmountToMinor (النواة §2.2) — رفض لا تقريب صامت
│  ├─ format.ts           يُنشأ — formatLYD (ar-LY-u-nu-latn — ق-3) — **الدالة الوحيدة**
│  └─ installments.ts     يُنشأ — buildInstallmentPlan (النواة §2.6)
├─ coa/
│  ├─ sides.ts            normalSideOf · lineSign
│  ├─ codes.ts            رموز الشجرة الثابتة + accountIdOf(code) الحتمي
│  └─ seed.ts             شجرة النواة §3.2 كبيانات + الفئات المقترحة (§6)
├─ types/
│  ├─ common.ts           OwnedDoc · DateKey · PeriodKey · SCHEMA_VERSION
│  ├─ Account.ts  JournalEntry.ts  Posting.ts  Obligation.ts  Debt.ts
│  ├─ Period.ts   Budget.ts        Goal.ts     Recurrence.ts  Control.ts
│  ├─ Contact.ts  Category.ts      IncomeSchedule.ts
│  ├─ Note.ts     Task.ts          Notification.ts  Settings.ts
│  └─ Worship.ts                   WorshipRecord · QuranProgress · ZakatRecord
├─ ledger/
│  ├─ balances.ts         accountBalanceMinor · spendableMinor · closingBalanceAt
│  ├─ deltas.ts           deltaForAccount · signedDeltaFor
│  ├─ reverse.ts          بناء قيد العكس (قلب الجانب) + سياسة التاريخ (النواة §8.3)
│  ├─ amend.ts            الدلتا الصافية للتعديل (النواة §8.5)
│  ├─ verify.ts           auditTrialBalance · auditAccount · الثوابت I1…I24
│  └─ rebuild.ts          منطق إعادة البناء النقي (النواة §16.2) — **نفس دوال المسار الساخن**
├─ ops/
│  ├─ requests.ts         OperationRequest — الاتحاد المُميَّز (النواة §23)
│  ├─ plan.ts             planOperation — **الدالة المركزية النقية**
│  ├─ plans/              خطة لكل عملية: expense · income · transfer · payObligation ·
│  │                      payDebt · collectDebt · writeOffDebt · borrow · lend ·
│  │                      opening · adjust · earmark · zakat · void · edit
│  ├─ hash.ts             canonicalize · hashPayload
│  └─ nearDuplicate.ts    findNearDuplicates (تحذير لا حجب — النواة §6.5)
├─ rules/
│  ├─ guards.ts           assertBalanceFloor · assertNotOverSettled · assertBalanced · assertLinesValid
│  ├─ status.ts           obligationStatus · debtStatus · goalStatus · taskStatus
│  ├─ kindShape.ts        assertKindShape (I2b — النواة §13)
│  └─ classify.ts         classifyLineForReports (من accountType لا من kind)
├─ recurrence/
│  ├─ nextDate.ts         next(cursor, frequency, interval, dayOfMonthPolicy)
│  └─ materialize.ts      planCatchUp (نقية) + بناء opId الحتمي
├─ period/
│  ├─ periodKey.ts        periodKeyOf(bookedAt) ≡ bookedAt.slice(0,7)  (ADR-008)
│  └─ dateKey.ts          التحقق من صيغة 'YYYY-MM-DD' والمقارنات
├─ selectors/
│  ├─ cash.ts             availableCashMinor · spendableCashMinor · totalReceivables/Payables · netWorth
│  ├─ period.ts           monthIncome · monthExpense · netCashFlow · priorPeriodCorrections
│  ├─ budget.ts           budgetUtilizationPercent · overBudgetCategories
│  ├─ goals.ts            goalProgressPercent · projectedCompletionDate
│  ├─ obligations.ts      upcoming · overdue · dueMinor
│  ├─ debts.ts            payableDebts · receivableDebts · agingBuckets
│  ├─ statement.ts        accountStatementPage (رصيد جارٍ للصفحة الأولى فقط — النواة §18.2)
│  ├─ household.ts        مصاريف المنزل كمجموع فرعي (المتطلبات §11)
│  └─ dashboard.ts        تركيب بطاقات لوحة التحكم من اللقطات
├─ contracts/                مخططات Zod — المصدر الوحيد المشترك (§8)
│  ├─ primitives.ts       zMinorFromText · zDateKey · zPeriodKey · zTimestamp · zNonEmptyAr
│  ├─ requests/           مخطط لكل OperationRequest (حدّ الإدخال)
│  ├─ stored/             مخطط لكل مستند مخزَّن (حدّ القراءة) + النسخ التاريخية
│  └─ settings.ts         إعدادات المستخدم (المتطلبات §21)
├─ reports/
│  ├─ definitions.ts      تعريف كل تقرير: المصدر، الأبعاد، المرشّحات، الأعمدة
│  ├─ aggregate.ts        منطق التجميع النقي من اللقطات
│  └─ exportShape.ts      صفوف التصدير Excel/CSV/PDF (أرقام لاتينية — ق-3)
├─ worship/
│  ├─ prayer.ts           الصلوات الخمس: السجل والتجميع الأسبوعي/الشهري
│  ├─ quran.ts            الورد اليومي والتقدم
│  ├─ adhkar.ts           الأذكار والأعمال — متابعة بلا تقييم (المتطلبات §15)
│  └─ zakat.ts            حاسبة إرشادية: النصاب، الحول، الأصول الخاضعة (mulRate بـ BigInt)
├─ tasks/recurring.ts      تكرار المهام والتذكيرات
├─ notes/search.ts         بحث وفرز وتثبيت وأرشفة الملاحظات
├─ notify/
│  ├─ generate.ts          توليد التنبيهات الحتمي بمفاتيح idempotency (المتطلبات §17)
│  └─ dedupe.ts            منع التنبيهات المكرّرة وغير الضرورية
├─ integrity/
│  ├─ reconcile.ts         runReconciliation النقي + ReconciliationReport
│  └─ historicalNegatives.ts  scanHistoricalNegatives (النواة §18.1)
├─ migrate/
│  ├─ migrate.ts           migrateAccount · migrateObligation · … (ترحيل بطيء عند القراءة)
│  └─ versions.ts          APP_SCHEMA_VERSION + سجل المُرحِّلات
├─ errors/
│  ├─ DomainError.ts       DomainErrorCode + الصنف (النواة §11.1)
│  ├─ AppError.ts          **مغلّف الأخطاء الموحَّد** (§7.2)
│  ├─ fromFirestore.ts     جدول تحويل رموز Firestore → AppError (نقي: نصوص فقط)
│  ├─ fromZod.ts           ZodError → AppError برسائل عربية
│  └─ messages.ar.ts       جدول الرسائل العربية الكامل — **المصدر الوحيد للنص**
└─ api.ts                  السطح الكامل للواجهة: execute · selectors · integrity (النواة §23)
```

### 5.4 `src/data/` — الطبقة الوحيدة التي تلمس Firestore

```
src/data/
├─ firebase/
│  ├─ app.ts               initializeApp + getAuth + initializeFirestore(persistentLocalCache) (§9.2)
│  ├─ emulators.ts         connectAuthEmulator + connectFirestoreEmulator عند VITE_USE_EMULATORS
│  ├─ paths.ts             بُناة المسارات المُقنَّنة: col(uid,'accounts') · doc(uid,'periods',pk)
│  ├─ errors.ts            isFirebaseError + تحويل إلى AppError عبر domain/errors/fromFirestore
│  └─ freshness.ts         قراءة metadata.fromCache/hasPendingWrites ودفعها إلى freshnessStore
├─ auth/
│  ├─ googleSignIn.ts      signInWithPopup + تراجع إلى signInWithRedirect على iOS/داخل PWA
│  ├─ session.ts           onAuthStateChanged + تسجيل الخروج الكامل (تنظيف الاشتراكات والذاكرة)
│  └─ ownerCheck.ts        مقارنة UID بالمعتمد — **تجربة استخدام لا أمان**
├─ tx/
│  ├─ runPlan.ts           TxPlan<TState,TWrites> + runPlan (النواة §7.2)
│  └─ retry.ts             تصنيف أخطاء المعاملة: قابل للإعادة مقابل نهائي
├─ ledger/
│  ├─ postOperation.ts     **نقطة الكتابة المالية الوحيدة** (النواة §7.3)
│  ├─ writers/             تحويل WritePlan إلى كتابات: entries · postings · accounts ·
│  │                       accountPeriods · periods · budgets · obligations · debts · goals
│  ├─ readers.ts           مرحلة القراءة: بناء LedgerSnapshot بـ tx.get فقط
│  ├─ reconcile.ts         تشغيل التسوية + التجميع الخادمي (sum/count)
│  └─ rebuild.ts           إجراء إعادة البناء بمراحله الست (النواة §16.2) — **الاستثناء الوحيد لـ B7**
├─ codecs/
│  ├─ decode.ts            decodeDoc<T>(snap, schema, migrate) — حدّ القراءة (§8.3)
│  ├─ encode.ts            encodeForWrite<T>(value, schema) — حدّ الكتابة
│  ├─ account.ts  entry.ts  posting.ts  obligation.ts  debt.ts  period.ts
│  ├─ budget.ts   goal.ts   recurrence.ts  contact.ts  category.ts  settings.ts
│  └─ note.ts     task.ts   notification.ts  worship.ts  zakat.ts
├─ live/
│  ├─ queryKeys.ts         مفاتيح مُقنَّنة تبدأ بـ ['uid', uid, …]  (§6.3)
│  ├─ liveRegistry.ts      **سجل الاشتراكات بعدّاد المراجع** (§6.4) — ADR-027
│  ├─ subscriptions.ts     بُناة الاشتراكات لكل مجموعة (accounts, periods, obligations, …)
│  └─ queryClient.ts       إعداد QueryClient الافتراضي (§6.2)
├─ repos/
│  ├─ accountRepo.ts       قراءة الشجرة، إنشاء/أرشفة حساب، الرصيد الافتتاحي
│  ├─ entryRepo.ts         كشف الحركة بالصفحات، سجل التصحيحات، سجل دفعات التزام/دين
│  ├─ obligationRepo.ts    قوائم القادم/المتأخر، مسح الحالات اليومي (writeBatch)
│  ├─ debtRepo.ts          الاتجاهان + followUps
│  ├─ budgetRepo.ts        سقوف الميزانية (مُدخَلات مستخدم — لا تُلمس في إعادة البناء)
│  ├─ goalRepo.ts  categoryRepo.ts  contactRepo.ts  recurrenceRepo.ts
│  ├─ noteRepo.ts  taskRepo.ts      notificationRepo.ts  worshipRepo.ts  zakatRepo.ts
│  ├─ settingsRepo.ts  metaRepo.ts  auditRepo.ts
│  └─ aggregateRepo.ts     getAggregateFromServer(sum/count) — تقارير بقراءتين
├─ outbox/
│  ├─ queue.ts             إدخال في pendingCommands قبل كل محاولة ترحيل
│  ├─ flush.ts             تفريغ **تسلسلي** بتباطؤ أُسّي (النواة §6.6)
│  └─ mirror.ts            مرآة IndexedDB المحلية
├─ seed/
│  └─ ensureSeed.ts        التهيئة idempotent بـ writeBatch ≤450 (النواة §3.3)
└─ export/
   ├─ exportAllJson.ts     تصدير كامل مع schemaVersion و projectionVersion (ق-1)
   └─ importJson.ts        استيراد الدفتر فقط ثم إعادة بناء (النواة §17.3)
```

### 5.5 `src/ui/` — نظام التصميم والمكوّنات الغبية

```
src/ui/
├─ primitives/     Button · IconButton · Input · NumberInput · Textarea · Select ·
│                  Combobox · Checkbox · Radio · Switch · Slider · DatePicker ·
│                  Label · FieldError · Hint · Badge · Chip · Avatar · Divider · Spinner
├─ layout/         Page · PageHeader · Section · Card · Grid · Stack · Sidebar ·
│                  BottomNav · TopBar · Drawer · Modal · Sheet · Tabs · Accordion
├─ data-display/   Table · DataTable · SortableHeader · Pagination · EmptyState ·
│                  Skeleton · ErrorState · StatTile · KpiRow · Timeline · DescriptionList
├─ money/          Amount · AmountInput · SignedAmount · BalanceBadge · ProgressBar
│                  (كلها تنادي formatLYD — لا تنسيق محلي · tabular-nums — ق-3)
├─ charts/         BarChart · LineChart · DonutChart · ChartTooltip · ChartLegend ·
│                  ChartEmptyState   (SVG داخلي، بلا مكتبة خارجية — قرار §13.3)
├─ feedback/       Toast · ToastRegion · ConfirmDialog · DestructiveConfirm ·
│                  InlineWarning · StaleDataBadge · PendingSyncBadge · IntegrityBanner
├─ nav/            NavItem · Breadcrumb · QuickAddMenu (المتطلبات §4)
├─ icons/          index.ts  — تصدير موحَّد من lucide-react (أيقونات موحَّدة — المتطلبات §3)
└─ tokens/         theme.css.ts · spacing.ts · typography.ts · zIndex.ts
```

**قاعدتان على `ui`:** (أ) كل مكوّن يستقبل `props` ويُصدِر أحداثاً، بلا `useQuery` ولا متجر؛
(ب) كل مكوّن مالي يستقبل `Minor` ويُنسِّق بـ `formatLYD` — **لا يحسب ولا يجمع**.

### 5.6 `src/features/` — شاشة لكل وحدة في المتطلبات

**الشكل الداخلي الموحَّد لكل ميزة** (يُطبَّق على كل مجلد أدناه):

```
features/<name>/
├─ routes/<Name>Page.tsx            الشاشة — تركيب فقط
├─ components/                      مكوّنات خاصة بهذه الميزة
├─ hooks/use<Name>*.ts              useLiveQuery + useMutation + محدِّدات
├─ forms/<Name>Form.tsx             نموذج يستهلك مخطط Zod من domain/contracts
└─ index.ts                         التصدير الوحيد للخارج (حدّ الميزة)
```

```
src/features/
├─ auth/            routes/SignInPage · hooks/useSession · components/GoogleButton
├─ dashboard/       المتطلبات §4
│  ├─ routes/DashboardPage.tsx
│  ├─ components/ AvailableCashCard · SpendableCard · MonthIncomeCard · MonthExpenseCard ·
│  │              NetCashFlowCard · UpcomingObligationsCard · OverdueObligationsCard ·
│  │              PayablesCard · ReceivablesCard · HouseholdCard · SavingsCard ·
│  │              BudgetUtilizationCard · TodayTasksCard · AlertsCard ·
│  │              PriorPeriodCorrectionsRow · ExpenseByCategoryChart ·
│  │              IncomeVsExpenseChart · SpendingTrendChart · CardLayoutEditor
│  └─ hooks/ useDashboardData · useCardLayout
├─ accounts/        المتطلبات §5
│  ├─ routes/ AccountsPage · AccountDetailPage · AccountStatementPage
│  ├─ components/ AccountList · AccountCard · BalanceHeader · StatementTable ·
│  │              RunningBalanceColumn · ArchiveAccountDialog
│  └─ forms/ AccountForm · OpeningBalanceForm · AdjustAccountForm · TransferForm
├─ transactions/    المتطلبات §6 + §7 — مصروف ودخل وتحويل في محرّك نموذج واحد
│  ├─ routes/ TransactionsPage · TransactionDetailPage
│  ├─ components/ TransactionList · TransactionRow · FilterBar · NearDuplicateDialog ·
│  │              CorrectionHistory · PendingSyncList
│  └─ forms/ ExpenseForm · IncomeForm · TransferForm · VoidDialog · EditTransactionForm
├─ categories/      المتطلبات §6 — إنشاء/تعديل/تعطيل بلا إضرار بالتاريخ
├─ contacts/        جهات ومستفيدون ومدينون/دائنون
├─ obligations/     المتطلبات §8
│  ├─ routes/ ObligationsPage · ObligationDetailPage
│  ├─ components/ ObligationList · StatusBadge · InstallmentTable · PaymentHistory ·
│  │              ExtraChargesPanel · DueAlertsPanel
│  └─ forms/ ObligationForm · PayObligationForm · OverpayDecisionDialog · CancelDialog
├─ debts/           المتطلبات §9 + §10 — الاتجاهان في شاشتين على مجموعة واحدة
│  ├─ routes/ PayableDebtsPage · ReceivableDebtsPage · DebtDetailPage
│  ├─ components/ DebtList · AgingTable · SettlementHistory · FollowUpTimeline · CollectionForecast
│  └─ forms/ DebtForm · PayDebtForm · CollectDebtForm · WriteOffForm · FollowUpForm
├─ household/       المتطلبات §11 — **عرض مُصفّى على نفس القيود، لا بيانات ثانية**
│  ├─ routes/HouseholdPage.tsx
│  └─ components/ HouseholdBudgetVsActual · HouseholdCategoryBreakdown · SeasonalExpenses
├─ budgets/         المتطلبات §12
│  ├─ routes/ BudgetsPage · BudgetDetailPage
│  ├─ components/ OverallBudgetCard · CategoryLimitRow · VarianceTable · AlertThresholdEditor
│  └─ forms/ BudgetForm · CategoryLimitForm
├─ goals/           المتطلبات §12 — الأهداف والادخار
│  ├─ routes/ GoalsPage · GoalDetailPage
│  ├─ components/ GoalCard · ProgressRing · EarmarkNotice (تنبيه «مخصص دفترياً») · ForecastPanel
│  └─ forms/ GoalForm · EarmarkToGoalForm
├─ planning/        المتطلبات §12 — التوقعات والسيناريوهات
│  ├─ routes/PlanningPage.tsx
│  └─ components/ CashFlowForecast · ScenarioEditor · ActualVsPlanTable · AssumptionsNotice
├─ notes/           المتطلبات §13
│  ├─ routes/ NotesPage · NoteEditorPage
│  ├─ components/ NoteList · NotebookSidebar · NoteSearch · PinnedNotes · LinkedEntityPicker
│  └─ forms/NoteForm.tsx            محرّر بسيط: عناوين وقوائم وتنسيق أساسي
├─ tasks/           المتطلبات §14
│  ├─ routes/ TasksPage · TaskCalendarPage
│  ├─ components/ TaskList · TaskRow · PriorityBadge · CalendarGrid · OverdueTasks
│  └─ forms/ TaskForm · CompleteTaskDialog (إكمال صريح — المتطلبات §14)
├─ worship/         المتطلبات §15
│  ├─ routes/ WorshipPage · PrayerPage · QuranPage · AdhkarPage · ZakatPage
│  ├─ components/ PrayerDayGrid · PrayerWeekSummary · QuranDailyTracker · QuranProgress ·
│  │              AdhkarChecklist · ZakatAssetsTable · ZakatMethodNotice · HijriDateLabel
│  └─ forms/ PrayerRecordForm · QuranGoalForm · ZakatCalculatorForm · PayZakatForm
├─ reports/         المتطلبات §16
│  ├─ routes/ ReportsPage · ReportViewPage
│  ├─ components/ ReportPicker · PeriodRangePicker · FilterPanel · ReportTable ·
│  │              ReportChart · ExportMenu · DataSourceNotice
│  └─ hooks/ useReportData (تجميع خادمي بقراءتين على postings)
├─ notifications/   المتطلبات §17
│  ├─ routes/NotificationCenterPage.tsx
│  └─ components/ NotificationList · SeverityBadge · ReadToggle · NotificationSettings
├─ settings/        المتطلبات §21
│  ├─ routes/ SettingsPage · ProfilePage · PreferencesPage · SecurityPage
│  └─ components/ ThemeSelector · NumberFormatNotice (ق-3 — بلا مفتاح تبديل) ·
│                 FiscalMonthNotice (مؤجَّلة — ADR-008) · AttachmentsDisabledNotice (ق-1) ·
│                 NotificationPrefs · DefaultAccountsPicker
├─ integrity/       النواة §12.10 + §16 — شاشة «سلامة البيانات»
│  ├─ routes/IntegrityPage.tsx
│  └─ components/ TrialBalancePanel · LedgerFingerprintPanel · DriftTable ·
│                 HistoricalNegativesPanel · RebuildWizard · AdjustmentForm · ErrorLogViewer
└─ backup/          ق-1 — النسخة الاحتياطية الوحيدة
   ├─ routes/BackupPage.tsx
   └─ components/ ExportJsonButton · ImportWizard · BackupReminderCard · LastBackupInfo
```

**تغطية صريحة:** كل وحدة من §4 إلى §21 في وثيقة المتطلبات لها مجلد ميزة واحد على الأقل.
مصفوفة التتبّع الكاملة في §15.

---

## 6. إدارة الحالة

### 6.1 ADR-026 — فصل حالة الخادم عن الحالة المحلية

> **TanStack Query 5 هي الذاكرة الوحيدة لحالة الخادم. Zustand 5 للحالة المحلية فقط.
> ولا مبلغ (`*Minor`) يُخزَّن في Zustand إطلاقاً (B14).**

| نوع الحالة | أين | أمثلة من «رصيد» |
|---|---|---|
| **حالة خادم** (مصدرها Firestore) | **TanStack Query** فقط | الحسابات، القيود، الالتزامات، الديون، الفترات، الميزانيات، الأهداف، الملاحظات، المهام، الإشعارات، الإعدادات |
| **حالة محلية عابرة** | **Zustand** | طابور الـ toasts، المرشّحات المختارة، فتح الأدراج، تخطيط البطاقات، خريطة النضارة، حالة البوابات |
| **حالة مشتقة** | **محدِّد نقي في `domain/selectors`** | الأموال المتاحة، نسبة الميزانية، تقدم الهدف، الديون المتأخرة |
| **حالة نموذج** | حالة المكوّن (`useState`) + Zod | قيم النموذج قبل الإرسال، و`opId` الثابت لعمر النموذج (النواة §6.2) |
| **حالة URL** | `react-router` (`searchParams`) | الفترة المختارة، معرّف العنصر المفتوح، التبويب النشط |

**ثلاثة قرارات صريحة:**

1. **لا تكرار.** قيمة من Firestore **لا تُنسخ** إلى Zustand أبداً. النسخ يُنتج نسختين تتباعدان،
   وهو بالضبط ما تحرّمه المتطلبات §18 («دون تكرار البيانات أو تضارب الحسابات»).
   `dashboardStore` و`themeStore` استثناء **ظاهري** فقط: هما **مرآة متفائلة** لـ `settings/app`،
   والمصدر يبقى Firestore، والكتابة تمرّ عبر `settingsRepo` ثم تعود باللقطة.
2. **لا مبالغ في المتاجر (ADR-039).** السبب ليس جمالياً: مبلغ في متجر محلي **ليس له اشتراك حيّ**،
   فلا يتحدّث عند وصول قيد من جهاز آخر ⇒ المستخدم يرى رصيداً قديماً **بلا أي وسم نضارة** يفسّره.
   ولأن الرقم مفصول عن ذاكرة Query، لا يصله إبطال (invalidation) ولا تنظيف عند تسجيل الخروج.
   مفروضة بـ B14 على كل معرّف ينتهي بـ `Minor` داخل `src/stores/**`.
3. **لا Redux ولا XState.** Redux: صندوق واحد لحالة خادم وحالة واجهة ⇒ يذوب الفصل أعلاه.
   XState: آلات الحالة الأربع في النواة §10 **دوال نقية حتمية** (`obligationStatus(o, today, cancelled)`)
   تُحسب من البيانات ولا تحمل حالة تشغيل ⇒ إضافة محرّك آلات حالة تكلفة بلا مقابل.

### 6.2 إعداد `QueryClient`

```ts
// data/live/queryClient.ts
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { toAppError } from '@/data/firebase/errors'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * **لا إعادة جلب تلقائية.** مصدر الحقيقة اشتراك onSnapshot حيّ، فأي refetch
         * = قراءات مفوترة مكرّرة على Spark بلا أي بيانات جديدة (النواة §15).
         */
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchInterval: false,

        /**
         * أطول من مهلة سماح إلغاء الاشتراك (30ث) حتى تبقى البيانات جاهزة عند
         * الرجوع لشاشة سابقة، وأقصر من أن تُعرض بيانات عمرها ساعات بعد عودة التبويب.
         */
        gcTime: 5 * 60_000,

        /** الاشتراكات لا تُعاد محاولتها هنا — إعادة المحاولة في liveRegistry بتباطؤ أُسّي. */
        retry: false,
        throwOnError: false,
      },
      mutations: {
        /** العمليات المالية idempotent بـ opId، لكن إعادة المحاولة تُدار في outbox لا هنا. */
        retry: false,
        throwOnError: false,
      },
    },
  })
}

/** مفتاح واحد لإبطال كل بيانات مستخدم عند تسجيل الخروج. */
export const uidScope = (uid: string): QueryKey => ['uid', uid]
```

**القاعدة التي تفسّر `staleTime: Infinity`:** في نموذجنا **البيانات لا تَبلى بمرور الوقت، بل
بوصول لقطة جديدة**. «قديمة» (stale) في TanStack Query تعني «يستحق إعادة الجلب»، ونحن لا نجلب أبداً —
نستقبل. ولهذا مفهوم النضارة الحقيقي عندنا مفصول تماماً ويأتي من
`snapshot.metadata.fromCache` (§9.3)، لا من `isStale`.

### 6.3 مفاتيح الاستعلام — مُقنَّنة وتبدأ بـ UID

```ts
// data/live/queryKeys.ts
export const qk = {
  // ── لقطات حيّة على مستوى الجلسة ──
  accounts:      (uid: string) => ['uid', uid, 'accounts'] as const,
  categories:    (uid: string) => ['uid', uid, 'categories'] as const,
  contacts:      (uid: string) => ['uid', uid, 'contacts'] as const,
  settings:      (uid: string) => ['uid', uid, 'settings', 'app'] as const,
  meta:          (uid: string, doc: 'integrity' | 'schema') => ['uid', uid, 'meta', doc] as const,

  // ── مُجمَّعات بالفترة ──
  period:        (uid: string, pk: string) => ['uid', uid, 'periods', pk] as const,
  periodsRange:  (uid: string, from: string, to: string) => ['uid', uid, 'periods', 'range', from, to] as const,
  budgetPeriod:  (uid: string, pk: string) => ['uid', uid, 'budgetPeriods', pk] as const,
  accountPeriods:(uid: string, accountId: string) => ['uid', uid, 'accountPeriods', accountId] as const,

  // ── كيانات تشغيلية ──
  obligations:   (uid: string, f: ObligationFilter) => ['uid', uid, 'obligations', f] as const,
  obligation:    (uid: string, id: string) => ['uid', uid, 'obligations', 'one', id] as const,
  debts:         (uid: string, dir: 'payable' | 'receivable') => ['uid', uid, 'debts', dir] as const,
  goals:         (uid: string) => ['uid', uid, 'financialGoals'] as const,
  outbox:        (uid: string) => ['uid', uid, 'pendingCommands'] as const,
  notifications: (uid: string) => ['uid', uid, 'notifications', 'unread'] as const,

  // ── صفحات (useInfiniteQuery) ──
  statement:     (uid: string, accountId: string) => ['uid', uid, 'statement', accountId] as const,
  entryHistory:  (uid: string, groupId: string) => ['uid', uid, 'correctionGroup', groupId] as const,

  // ── تجميع خادمي (لا اشتراك — طلب واحد) ──
  aggregate:     (uid: string, spec: AggregateSpec) => ['uid', uid, 'aggregate', spec] as const,
}
```

**`uid` في أول كل مفتاح ليس زينة:** المتطلبات §20 تُلزم بأن تدعم البنية إضافة مستخدمين لاحقاً دون
إعادة تصميم. وجود `uid` في المفتاح يجعل `queryClient.removeQueries({ queryKey: uidScope(oldUid) })`
عند تبديل الحساب **كافياً ومضموناً**، ويجعل تسرّب بيانات مستخدم إلى شاشة مستخدم آخر **مستحيلاً
في الذاكرة** لا مجرّد غير متوقَّع.

### 6.4 ADR-027 — سجل الاشتراكات الحيّة بعدّاد مراجع

**المشكلة بدقة.** ربط `onSnapshot` بـ React عبر `useEffect` مباشرة في كل مكوّن يُنتج **أربع
مشكلات حقيقية**، وكل واحدة منها تظهر في «رصيد» تحديداً:

| # | المشكلة | كيف تظهر عندنا |
|---|---|---|
| 1 | **ازدواج الاشتراكات** | لوحة التحكم تعرض 14 بطاقة، تسعٌ منها تحتاج لقطة `accounts`. تسعة `useEffect` ⇒ **تسعة اشتراكات على نفس المجموعة** ⇒ تسع مجموعات قراءات أولية مفوترة (~405 قراءة بدل 45) وتسعة مسارات تحديث |
| 2 | **التسريب** | انتقال سريع بين المسارات يترك اشتراكات قائمة إن أخطأ أحد التنظيفات مرة واحدة. على Spark هذا يُستهلك الحصة بصمت |
| 3 | **`StrictMode` المزدوج** | React 19 في التطوير يُركِّب/يفكّ/يُركِّب التأثيرات ⇒ اشتراك يُنشأ ويُلغى ويُنشأ ⇒ **قراءة أولية مفوترة مرتين** لكل مجموعة في كل تحميل صفحة أثناء التطوير |
| 4 | **الرفرفة عند التنقل** | الذهاب من «الحسابات» إلى «التقارير» والعودة يُلغي الاشتراك ويعيد إنشاءه ⇒ **قراءة كاملة جديدة** + وميض حالة تحميل في بيانات كانت حاضرة قبل ثانية |

**الحل: سجل وحيد خارج React، مفتاحه هو مفتاح الاستعلام نفسه، بعدّاد مراجع ومهلة سماح.**

```ts
// data/live/liveRegistry.ts
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'
import type { AppError } from '@/domain/errors/AppError'

/** مهلة السماح: تمنع إلغاء/إعادة اشتراك عند التنقل السريع و StrictMode المزدوج. */
const DISPOSE_GRACE_MS = 30_000
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

export interface LiveHandlers<TRaw> {
  readonly next: (raw: TRaw) => void
  readonly error: (e: AppError) => void
}

export interface LiveSpec<TRaw> {
  readonly key: QueryKey
  /** يُنادى مرة واحدة لكل مفتاح. يُعيد دالة إلغاء الاشتراك. */
  readonly subscribe: (h: LiveHandlers<TRaw>) => () => void
}

interface Entry {
  refCount: number
  unsubscribe: () => void
  disposeTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  attempt: number
  /** يُحَل عند أول لقطة، ويُرفَض عند أول خطأ قبل أي لقطة. */
  readonly first: Promise<void>
  settle: (e?: AppError) => void
  settled: boolean
}

const entries = new Map<string, Entry>()
let client: QueryClient | null = null

/** يُنادى مرة واحدة من app/providers/QueryProvider.tsx — data لا تستورد app. */
export function initLiveRegistry(qc: QueryClient): void {
  client = qc
}

export function retainLive<TRaw>(spec: LiveSpec<TRaw>): {
  readonly first: Promise<void>
  readonly release: () => void
} {
  const qc = client
  if (!qc) throw new Error('liveRegistry غير مُهيَّأ: نادِ initLiveRegistry عند الإقلاع.')
  const hash = hashKey(spec.key)

  let entry = entries.get(hash)
  if (entry) {
    // ── اشتراك قائم: ارفع العدّاد وألغِ أي مهلة إلغاء جارية ──
    entry.refCount += 1
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer)
      entry.disposeTimer = null
    }
  } else {
    entry = createEntry(qc, spec, hash)
    entries.set(hash, entry)
  }

  const held = entry
  let released = false
  return {
    first: held.first,
    release: () => {
      if (released) return          // حصانة ضد release مزدوج
      released = true
      held.refCount -= 1
      if (held.refCount > 0) return
      // ── آخر مُستهلِك خرج: لا تُلغِ فوراً ──
      held.disposeTimer = setTimeout(() => dispose(hash), DISPOSE_GRACE_MS)
    },
  }
}

function createEntry<TRaw>(qc: QueryClient, spec: LiveSpec<TRaw>, hash: string): Entry {
  let resolveFirst!: () => void
  let rejectFirst!: (e: AppError) => void
  const first = new Promise<void>((res, rej) => { resolveFirst = res; rejectFirst = rej })

  const entry: Entry = {
    refCount: 1, unsubscribe: () => {}, disposeTimer: null, retryTimer: null,
    attempt: 0, first, settled: false,
    settle: (e) => {
      if (entry.settled) return
      entry.settled = true
      if (e) rejectFirst(e); else resolveFirst()
    },
  }

  const open = (): void => {
    entry.unsubscribe = spec.subscribe({
      next: (raw) => {
        entry.attempt = 0
        // اللقطة تُكتب في ذاكرة Query. كل المكوّنات المشتركة في المفتاح تُحدَّث مرة واحدة.
        qc.setQueryData(spec.key, raw)
        entry.settle()
      },
      error: (e) => {
        if (!entry.settled) { entry.settle(e); return }   // خطأ قبل أي لقطة ⇒ حالة خطأ للاستعلام
        if (!e.retryable) return                          // permission-denied / unauthenticated: لا تُعِد أبداً
        // بيانات آخر لقطة **تبقى معروضة** مع وسم «انقطع البث»، وإعادة الاتصال بتباطؤ أُسّي.
        const delay = BACKOFF_MS[Math.min(entry.attempt, BACKOFF_MS.length - 1)]!
        entry.attempt += 1
        entry.retryTimer = setTimeout(() => { entry.unsubscribe(); open() }, delay)
      },
    })
  }

  open()
  return entry
}

function dispose(hash: string): void {
  const e = entries.get(hash)
  if (!e || e.refCount > 0) return
  if (e.retryTimer) clearTimeout(e.retryTimer)
  e.unsubscribe()
  entries.delete(hash)
}

/** إلزامي عند تغيّر UID أو تسجيل الخروج — وإلا بقيت المستمعات تُصدِر permission-denied. */
export function disposeAllLive(): void {
  for (const [hash, e] of entries) {
    if (e.disposeTimer) clearTimeout(e.disposeTimer)
    if (e.retryTimer) clearTimeout(e.retryTimer)
    e.unsubscribe()
    entries.delete(hash)
  }
}

/** للاختبار والتشخيص فقط — يُستخدم في tests/dom/live. */
export function liveDebugSnapshot(): Array<{ hash: string; refCount: number }> {
  return [...entries].map(([hash, e]) => ({ hash, refCount: e.refCount }))
}
```

### 6.5 الخطّاف الذي تستهلكه الشاشات

```ts
// data/live/useLiveQuery.ts
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import { retainLive, type LiveSpec } from './liveRegistry'
import type { AppError } from '@/domain/errors/AppError'

export function useLiveQuery<TRaw, TOut = TRaw>(
  spec: LiveSpec<TRaw> & { readonly enabled?: boolean; readonly select?: (raw: TRaw) => TOut },
): UseQueryResult<TOut, AppError> {
  const qc = useQueryClient()
  const enabled = spec.enabled !== false

  // الاشتراك يُحجَز في تأثير، ويُحرَّر في تنظيفه. العدّاد + مهلة السماح يتولّيان الباقي.
  useEffect(() => {
    if (!enabled) return
    const handle = retainLive(spec)
    return handle.release
    // eslint-disable-next-line react-hooks/exhaustive-deps -- المفتاح هو هوية الاشتراك
  }, [enabled, hashOf(spec.key)])

  return useQuery<TRaw, AppError, TOut>({
    queryKey: spec.key,
    enabled,
    /**
     * لا تجلب شيئاً: انتظر أول لقطة من السجل ثم اقرأ ما كتبه في الذاكرة.
     * `retainLive` هنا idempotent (يرفع العدّاد ويُحرِّره فوراً) فلا ينشئ اشتراكاً ثانياً.
     */
    queryFn: async () => {
      const handle = retainLive(spec)
      try {
        await handle.first
        return qc.getQueryData<TRaw>(spec.key) as TRaw
      } finally {
        handle.release()
      }
    },
    select: spec.select,
  })
}
```

**لماذا هذا التركيب صحيح — خمس نقاط يجب أن تصحّ كلها:**

1. **اشتراك واحد لكل مفتاح، كم ما بلغ عدد المكوّنات.** تسع بطاقات على `qk.accounts(uid)` ⇒
   `refCount = 9` و**اشتراك واحد** ⇒ 45 قراءة أولية لا 405.
2. **`StrictMode` المزدوج لا يُنشئ شيئاً.** التركيب الثاني يجد المُدخَل قائماً (المهلة ألغت
   الإلغاء) ⇒ صفر قراءات إضافية في التطوير.
3. **التنقل السريع لا يُعيد الجلب.** الخروج يبدأ مهلة 30ث؛ العودة خلالها تُلغيها.
   و`gcTime: 5 دقائق` أطول من المهلة ⇒ البيانات حاضرة فوراً بلا وميض تحميل.
4. **حالات التحميل والخطأ صحيحة بلا كود إضافي.** `queryFn` ينتظر أول لقطة ⇒ `isPending` حقيقي؛
   وخطأ قبل أول لقطة ⇒ `isError` بـ `AppError` جاهز للعرض.
5. **لا ضياع لقطة بعد الاستقرار.** `setQueryData` يكتب مباشرة في الذاكرة، و`select` تُحوِّل
   بذاكرة مؤقتة (memoized) ⇒ إعادة التصيير تقع مرة واحدة لكل لقطة.

**خمس قواعد إلزامية مرافقة:**

| القاعدة | السبب |
|---|---|
| `includeMetadataChanges` **يبقى غير مُفعَّل** | تفعيله يُصدِر لقطة ثانية لكل كتابة (تغيّر `hasPendingWrites` فقط) ⇒ إعادة تصيير مزدوجة بلا بيانات جديدة. النضارة تُقرأ من اللقطة الطبيعية (§9.3) |
| اشتراك **المجموعة** لا المستند للحسابات | `onSnapshot` على `accounts` كاملة = اشتراك واحد و~45 قراءة أولية، ثم **دلتا فقط**. 45 اشتراك مستند = 45 مستمعاً |
| كل اشتراك يمرّ بـ `decodeDoc` قبل `setQueryData` | حدّ القراءة (§8.3). لا مستند خام يدخل الذاكرة |
| `disposeAllLive()` + `queryClient.clear()` عند تغيّر UID | وإلا بقيت المستمعات على UID قديم تُصدِر `permission-denied` دورياً |
| الصفحات تستخدم `useInfiniteQuery` **بلا اشتراك** | كشف الحركة بالصفحات (25/صفحة) لا يحتاج بثاً حيّاً، والبث عليه يعني إعادة تحميل الصفحة كلها عند أي قيد جديد |

### 6.6 الكتابة: `useMutation` فوق `execute()`

```ts
// features/transactions/hooks/useRecordExpense.ts
export function useRecordExpense() {
  const { uid } = useSession()
  const qc = useQueryClient()
  const pushToast = useToastStore((s) => s.push)

  return useMutation<PostResult, AppError, RecordExpenseRequest>({
    mutationFn: (req) => execute(req),           // domain/api.ts → outbox → postOperation
    onSuccess: (res) => {
      if (res.alreadyApplied) {
        pushToast({ kind: 'info', code: 'ALREADY_APPLIED',
                    messageAr: 'هذه العملية مسجَّلة مسبقاً — لم يُكرَّر تسجيلها.' })
        return
      }
      for (const w of res.warnings) pushToast({ kind: 'warning', code: w.code, messageAr: w.messageAr })
      // **لا invalidateQueries للأرصدة**: الاشتراكات الحيّة ستوصل اللقطة الجديدة تلقائياً.
      // الإبطال مقصور على ما لا يُشترَك فيه حيّاً: صفحات الكشف والتجميعات الخادمية.
      void qc.invalidateQueries({ queryKey: qk.statement(uid, req.fromAccountId) })
      void qc.invalidateQueries({ queryKey: ['uid', uid, 'aggregate'] })
    },
    onError: (e) => pushToast({ kind: 'error', code: e.code, messageAr: e.messageAr }),
  })
}
```

**قرار صريح: لا تحديث متفائل (optimistic update) لأي رقم مالي.**
السبب ليس الراحة: التحديث المتفائل يعني **عرض رصيد لم يُكتب بعد كأنه مكتوب**، وهو خرق مباشر
للمتطلبات §22 («عدم اعتبار العملية محفوظة إلا بعد تأكيد نجاح الكتابة») وللنواة ADR-007
(«المعلّقة مستبعدة من كل رصيد وتقرير»). الزمن المكتسب (~300 مللي ثانية) لا يُقارَن برؤية
المستخدم رقماً خاطئاً. **البديل المعتمد:** زر مُعطَّل مع مؤشر أثناء الوعد، ثم اللقطة الحقيقية.
والتحديث المتفائل **مسموح** في غير المالي فقط: تعليم إشعار مقروءاً، تثبيت ملاحظة، ترتيب بطاقات.

---

## 7. معالجة الأخطاء المركزية

### 7.1 الخريطة الكاملة

```
                        ┌──────────────────────────────────────────┐
   DomainError  ───────►│                                          │
   (planOperation)      │                                          │
                        │   domain/errors/AppError.ts              │
   FirestoreError ─────►│   toAppError(unknown) → AppError         │──┐
   (code نصّي)          │   { kind, code, messageAr, retryable }   │  │
                        │                                          │  │
   ZodError  ──────────►│                                          │  │
   (حدّ الإدخال/القراءة)└──────────────────────────────────────────┘  │
                                                                      │
        ┌─────────────────────────────┬───────────────────────────────┤
        ▼                             ▼                               ▼
   errorLog (IndexedDB)        قناة العرض المناسبة            gateStore (حاجب)
   دائماً، بلا استثناء         (جدول 7.4)                     I4 · إعادة بناء · نسخة مخطط
```

### 7.2 نوع `AppError`

```ts
// domain/errors/AppError.ts — **نقي: لا استيراد من firebase ولا من data**
import type { DomainErrorCode } from './DomainError'

export type AppErrorKind =
  | 'domain'        // خطأ قاعدة أعمال — رسالة واضحة وخطوة تالية
  | 'validation'    // مدخل غير صالح — يُعرض على الحقل لا كـ toast
  | 'permission'    // permission-denied — قد يعني UID غير معتمد (ق-2) أو عيب قواعد
  | 'auth'          // انتهاء الجلسة أو إلغاء تسجيل الدخول
  | 'network'       // انقطاع أو مهلة — قابل لإعادة المحاولة
  | 'conflict'      // تنازع كتابة أو تعارض محتوى على نفس opId
  | 'quota'         // resource-exhausted — حصة Spark اليومية (ق-1)
  | 'notFound'
  | 'schema'        // نسخة بيانات أحدث من التطبيق
  | 'integrity'     // ميزان مراجعة مختلّ أو فشل فكّ ترميز إسقاط مالي — **حاجب**
  | 'bug'           // انتهاك ثابت داخلي — عيب برمجي لا خطأ مستخدم
  | 'unknown'

export interface AppError {
  readonly kind: AppErrorKind
  /** `DomainErrorCode` أو رمز Firestore أو `'ZOD_INVALID'` — يُستخدم لإلغاء تكرار الـ toast. */
  readonly code: DomainErrorCode | string
  /** **عربية، جاهزة للعرض، تذكر الرقم والسبب والخطوة التالية** (المتطلبات §25 بند 18). */
  readonly messageAr: string
  /** هل تُعرض إعادة المحاولة للمستخدم؟ */
  readonly retryable: boolean
  /** هل يحجب هذا الخطأ الترحيل المالي كلياً؟ (integrity · schema · rebuild) */
  readonly blocking: boolean
  /** معرّفات وسياق تشخيصي. **لا أسرار ولا رموز وصول.** */
  readonly context?: Readonly<Record<string, string | number | boolean | null>>
  readonly traceId: string
  readonly occurredAtIso: string
  readonly cause?: unknown
}

export function appError(init: Omit<AppError, 'traceId' | 'occurredAtIso'> &
                               Partial<Pick<AppError, 'traceId' | 'occurredAtIso'>>): AppError

/** محوّل عام: يتعرّف على DomainError و ZodError و{code:string} ويُسقط الباقي إلى unknown. */
export function toAppError(e: unknown): AppError

/** حراسة نوع للاستخدام في الواجهة. */
export function isAppError(e: unknown): e is AppError
```

**لماذا `AppError` في `domain` وليس في `data` أو `lib`؟**
لأن **الرسالة العربية جزء من المجال لا من النقل**: نصّ «المتبقي على «إيجار المنزل» هو 600.000 د.ل»
يحتاج معرفة الكيان والمبلغ وقواعد التنسيق — وكلها في `domain`. ولأن التحويل من رموز Firestore
**لا يحتاج `firebase` إطلاقاً**: `FirestoreError.code` سلسلة نصية، فجدول التحويل نقي 100%
وقابل للاختبار بلا محاكي. التعرّف على الصنف (`isFirebaseError`) وحده يبقى في
`data/firebase/errors.ts` حيث يُسمح باستيراد firebase.

### 7.3 جدول تحويل أخطاء Firestore — كامل ومُلزِم

```ts
// domain/errors/fromFirestore.ts  (نقي: نصوص فقط)
const MAP: Record<string, { kind: AppErrorKind; retryable: boolean; blocking: boolean; ar: string }> = {
  'unavailable':        { kind: 'network',   retryable: true,  blocking: false,
    ar: 'لا يوجد اتصال بالخدمة الآن. حُفظت العملية في قائمة الانتظار وستُرسَل تلقائياً عند عودة الاتصال.' },
  'deadline-exceeded':  { kind: 'network',   retryable: true,  blocking: false,
    ar: 'انتهت مهلة الاتصال قبل تأكيد الحفظ. لم يُسجَّل شيء مكرَّر — أعد المحاولة.' },
  'aborted':            { kind: 'conflict',  retryable: true,  blocking: false,
    ar: 'جرى تعديل البيانات من جهاز آخر أثناء الحفظ. أعد المحاولة.' },
  'already-exists':     { kind: 'conflict',  retryable: false, blocking: false,
    ar: 'هذه العملية مسجَّلة مسبقاً.' },
  'failed-precondition':{ kind: 'domain',    retryable: false, blocking: false,
    ar: 'لا يمكن إكمال العملية في الحالة الحالية. حدِّث الصفحة ثم أعد المحاولة.' },
  'permission-denied':  { kind: 'permission',retryable: false, blocking: false,
    ar: 'لا تملك صلاحية هذه العملية. إن كنت المالك فتأكّد من تسجيل الدخول بحساب Google المعتمد.' },
  'unauthenticated':    { kind: 'auth',      retryable: false, blocking: false,
    ar: 'انتهت جلستك. سجّل الدخول من جديد للمتابعة.' },
  'not-found':          { kind: 'notFound',  retryable: false, blocking: false,
    ar: 'السجل المطلوب غير موجود — ربما حُذف أو أُرشف من جهاز آخر.' },
  'resource-exhausted': { kind: 'quota',     retryable: false, blocking: false,
    ar: 'تجاوزت الحصة اليومية المجانية لقاعدة البيانات. لن تُفقد بياناتك — أعد المحاولة غداً، أو راجع ترقية الخطة.' },
  'invalid-argument':   { kind: 'bug',       retryable: false, blocking: false,
    ar: 'رُفضت العملية لبيانات غير صالحة. هذا عيب برمجي — سُجِّل التفصيل في سجل الأخطاء.' },
  'cancelled':          { kind: 'network',   retryable: true,  blocking: false,
    ar: 'أُلغيت العملية قبل اكتمالها. أعد المحاولة.' },
  'internal':           { kind: 'network',   retryable: true,  blocking: false,
    ar: 'حدث خلل مؤقت في الخدمة. أعد المحاولة بعد لحظات.' },
  'unimplemented':      { kind: 'bug',       retryable: false, blocking: false,
    ar: 'عملية غير مدعومة في هذه النسخة. حدِّث التطبيق.' },
  'data-loss':          { kind: 'integrity', retryable: false, blocking: true,
    ar: 'اكتُشف خلل في البيانات المستلمة. تسجيل العمليات موقوف — افتح «الإعدادات ← سلامة البيانات».' },
}
```

**ثلاث حالات تحتاج معالجة خاصة لا يكفيها الجدول:**

1. **`permission-denied` في مسار كتابة مالية** ليس خطأ مستخدم بالضرورة: قد يكون **عيباً في قواعد
   الأمان** (مثل كتابة `periods` أول الشهر — §14.2) أو **UID غير معتمد** (ق-2). القاعدة:
   يُسجَّل دائماً في `errorLog` بـ `context.collection` و`context.docId`، ويُعرض مع رابط
   «أرسل تفاصيل الخطأ» الذي يفتح شاشة سجل الأخطاء — لا رسالة مبهمة.
2. **`failed-precondition` برسالة تحوي `index`** = فهرس مركّب ناقص (النواة §15.5). في التطوير:
   `console.error` بالرابط الذي يرسله Firestore لإنشاء الفهرس. في الإنتاج: رسالة
   «هذا التقرير غير متاح مؤقتاً» + تسجيل حرج — **لا تُخفى** (المتطلبات §25 بند 15).
3. **`aborted` المتكرر** يعني تنازعاً حقيقياً. SDK يعيد المحاولة ~5 مرات داخلياً؛ وصوله إلينا
   يعني استنفادها ⇒ يُسجَّل بـ `context.attempts` ويُعرض للمستخدم بإعادة محاولة واحدة.

### 7.4 قنوات العرض — أي خطأ يظهر أين

**القاعدة الحاكمة: لكل صنف خطأ قناة واحدة. خطأ يظهر في قناتين = ضجيج، وخطأ بلا قناة = إخفاء.**

| الصنف | القناة | الشكل | يُسجَّل؟ |
|---|---|---|---|
| `validation` | **تحت الحقل** (`FieldError`) + تركيز عليه | نص أحمر دائم حتى التصحيح | لا (ضجيج) |
| `domain` غير حاجب | **toast خطأ** + نص داخل النموذج إن كان مرتبطاً بحقل | 8 ثوانٍ، قابل للإغلاق | نعم |
| `domain` بخيارات (تجاوز السداد §11.3) | **نافذة قرار** (`ConfirmDialog`) بخيارين صريحين | حاجبة للنموذج | نعم |
| `network` | **toast** + وسم «بانتظار المزامنة» على العملية | مع زر «أعد المحاولة» | نعم |
| `conflict` | **toast** | مع زر «أعد المحاولة» | نعم |
| `quota` | **شريط علوي** + toast | يبقى طوال الجلسة | نعم |
| `permission` / `auth` | **توجيه**: `auth` ⇒ شاشة تسجيل الدخول · `permission` ⇒ toast + رابط سجل الأخطاء | — | نعم |
| `schema` | **`ForcedUpdateScreen` غير قابلة للتجاهل** | شاشة كاملة | نعم |
| `integrity` | **`IntegrityBanner` أحمر ثابت + تعطيل كل أزرار الترحيل** | شاشة كاملة للحالات القاتلة | نعم، بـ `severity: critical` |
| `bug` | **toast مقتضب** + تسجيل كامل + (في التطوير) شاشة تفصيل | — | نعم، دائماً |
| غير مُصطاد (render) | **`AppErrorBoundary` / `RouteErrorBoundary`** | شاشة بديلة + «إعادة تحميل» | نعم |

**إلغاء تكرار الـ toast (تطبيق مباشر للمتطلبات §17 «منع التنبيهات المكررة»):**

```ts
// stores/toastStore.ts
const DEDUPE_WINDOW_MS = 5_000
push(t: ToastInput): void {
  const fingerprint = `${t.code}|${t.entityId ?? ''}`
  const prev = get().recent.get(fingerprint)
  if (prev && Date.now() - prev < DEDUPE_WINDOW_MS) return   // نفس الخطأ خلال 5ث ⇒ يُهمَل
  // … إدراج + aria-live="assertive" للأخطاء و"polite" للمعلومات
}
```

### 7.5 حدود الأخطاء (Error Boundaries)

**ثلاث طبقات، بلا اعتمادية خارجية** (React 19 لا يوفّر خطّافاً لحدود الأخطاء، فالمكوّن الصنفي
هو الطريق الوحيد؛ `react-error-boundary` حزمة إضافية لا تضيف شيئاً نحتاجه):

```tsx
// app/errors/AppErrorBoundary.tsx — الحد الأعلى
export class AppErrorBoundary extends Component<Props, { error: AppError | null }> {
  override state = { error: null as AppError | null }
  static getDerivedStateFromError(e: unknown) { return { error: toAppError(e) } }
  override componentDidCatch(e: unknown, info: ErrorInfo) {
    void logError(toAppError(e), { componentStack: info.componentStack ?? '' })
  }
  override render() {
    return this.state.error
      ? <FullScreenError error={this.state.error} onReload={() => location.reload()} />
      : this.props.children
  }
}
```

| الطبقة | الموضع | ما تحفظه عند السقوط |
|---|---|---|
| `AppErrorBoundary` | حول `RouterProvider` في `App.tsx` | لا شيء — شاشة كاملة + «إعادة تحميل» + «تصدير سجل الأخطاء» |
| `RouteErrorBoundary` | `errorElement` لكل مسار في `routes.tsx` | القوقعة والتنقل: المستخدم ينتقل لشاشة أخرى بلا إعادة تحميل |
| حدّ بطاقة | حول كل بطاقة في لوحة التحكم | بطاقة واحدة تُعرض بحالة خطأ و**بقية اللوحة سليمة** — مهم: بطاقة واحدة لا تُسقط 14 بطاقة |

**المُصطادات العامة** (`app/errors/globalHandlers.ts`): `window.addEventListener('error')`
و`'unhandledrejection'`، إضافة إلى `onUncaughtError` و`onCaughtError` في `createRoot` (React 19).
كلها تُغذِّي `logError` فقط ولا تعرض شيئاً — العرض مسؤولية القنوات أعلاه.

### 7.6 سجل الأخطاء

**القرار: السجل محلي في IndexedDB، ولا مجموعة Firestore جديدة له.**

| البديل | سبب الرفض |
|---|---|
| مجموعة `users/{uid}/errorLogs` | تحتاج قاعدة أمان جديدة (والنواة §14.3 لا تملكها)، وتستهلك كتابات من حصة Spark في أسوأ اللحظات (انقطاع ⇒ أخطاء ⇒ كتابات ⇒ أخطاء)، وقد تُكتب أثناء `rebuildStatus === 'running'` فتُرفض |
| خدمة خارجية (Sentry) | يخرج بيانات مالية شخصية إلى طرف ثالث بلا مبرّر لمستخدم واحد. مرفوض بالخصوصية (المتطلبات §20) |

```ts
// lib/logging/errorLog.ts
const MAX_ENTRIES = 300          // حلقة: الأقدم يُستبعد
export interface ErrorLogRecord {
  traceId: string; occurredAtIso: string
  kind: AppErrorKind; code: string; messageAr: string
  context?: Record<string, string | number | boolean | null>
  opId?: string; route?: string; deviceId: string
  appVersion: string; schemaVersion: number
  online: boolean; fromCache: boolean          // سياق النضارة لحظة الخطأ
}
export async function logError(e: AppError, extra?: Partial<ErrorLogRecord>): Promise<void>
export async function readErrorLog(limit?: number): Promise<ErrorLogRecord[]>
export async function exportErrorLog(): Promise<Blob>      // JSON — من شاشة «سلامة البيانات»
export async function clearErrorLog(): Promise<void>
```

**ثلاث قواعد على ما يُسجَّل:**

1. **ممنوع تسجيل:** رموز مصادقة، `idToken`، محتوى `apiKey`، نصوص ملاحظات المستخدم، أسماء الجهات.
2. **مسموح ومطلوب:** `opId`، رموز الأخطاء، معرّفات المستندات، `amountMinor` المتعلق بالخطأ
   (لازم لتشخيص فروق الأرصدة، والجهاز جهاز المالك). شاشة التصدير تُنبِّه: «يحتوي معرّفات ومبالغ».
3. **كل خطأ يُسجَّل، بلا استثناء** — بما فيه ما لا يُعرض للمستخدم. المتطلبات §25 بند 15 تمنع إخفاء
   المشكلات، والسجل هو ما يجعل «السبب الجذري» قابلاً للمعرفة بعد أسبوع.

### 7.7 الرسائل العربية — مصدر واحد

`domain/errors/messages.ar.ts` هو **المصدر الوحيد لكل نص خطأ أو تحذير في النظام**.
لا نص خطأ حرفي (literal) في أي مكوّن — مفروض بالمراجعة وباختبار يمشي على `src/{ui,features}`
ويرفض أي سلسلة عربية تحتوي «لا يمكن» أو «خطأ» أو «فشل».
وكل رسالة تلتزم بقالب ثلاثي (المتطلبات §25 بند 18): **ما حدث + الرقم/السبب + الخطوة التالية**.
أمثلة مُلزِمة بنصّها من النواة §11.1، ومنها ما تمّ تثبيته حرفياً:

> «رصيد حساب «نقد المحفظة» 314.500 د.ل لا يكفي لمبلغ 400.000 د.ل.»
> «المبلغ أكبر من المتبقي. المتبقي على «إيجار المنزل» هو 600.000 د.ل.»
> «لا يمكن إلغاء هذا الدخل لأن المبلغ أُنفق — ألغِ المصروفات المرتبطة أولاً، أو فعّل السماح بالرصيد السالب لهذا الحساب.»

---

## 8. التحقق بـ Zod — الحدّان بالضبط

### 8.1 ADR-029 — حدّان لا أكثر ولا أقل

> **Zod يعمل في موضعين فقط: (أ) حدّ الإدخال: قيم النموذج ⇒ `OperationRequest`.
> (ب) حدّ القراءة: `DocumentSnapshot` ⇒ كيان مُتحقَّق. وبينهما `domain` تعمل على أنواع
> موثوقة بلا أي تحقق متكرر.**

```
         (أ) حدّ الإدخال                                    (ب) حدّ القراءة
   ┌───────────────────────────┐                   ┌─────────────────────────────────┐
   │ قيم النموذج (نصوص)        │                   │ DocumentSnapshot (unknown)      │
   │  ↓ zExpenseInput.safeParse │                   │  ↓ zStoredAccountVN.safeParse   │
   │  ↓ parseAmountToMinor      │                   │  ↓ migrateAccount (ADR-019)     │
   │ RecordExpenseRequest ✓     │                   │ Account ✓                       │
   └─────────────┬─────────────┘                   └─────────────┬───────────────────┘
                 │                                                │
                 └──────────────►  domain (أنواع موثوقة)  ◄───────┘
                                   لا تحقق · لا safeParse · لا حراسات تكرارية
                                            │
                                            ▼  (ج) حدّ الكتابة — تأكيد لا تحقق
                                   encodeForWrite (دائماً للدفتر، وفي التطوير للباقي)
```

**لماذا حدّان لا ثلاثة ولا واحد؟**

| البديل | سبب الرفض |
|---|---|
| **حدّ واحد (الإدخال فقط)** | يفترض أن Firestore يعيد ما كُتب. **غير صحيح:** جهاز بنسخة أقدم أو ترحيل ناقص أو كتابة يدوية من الكونسول تُعيد مستنداً بشكل مختلف. وبلا حدّ قراءة، `undefined` يتسلّل إلى حساب مبلغ فيصير `NaN` ويُعرض «NaN د.ل» — أو أسوأ، يُكتب |
| **تحقق في كل طبقة** | كلفة تشغيل وتكرار مخططات. و`domain` تُختبر كدوال نقية على أنواع؛ حقنها بـ `safeParse` يُحوِّل كل دالة إلى `Result` بلا فائدة لأن المدخل تحقَّق عند الحدّ |
| **`zod` في `data` فقط** | يُنتج مخططين منفصلين للنموذج والمستودع ⇒ **ينحرفان** ⇒ نموذج يقبل ما يرفضه المستودع |

### 8.2 الحدّ (أ) — الإدخال: مخطط واحد مشترك بين النموذج والمستودع

**المخططات تسكن `domain/contracts/` لا في `features/`.** `domain` يُسمح لها استيراد `zod`
(حزمة نقية، وB1 يمنع `firebase` و`data` فقط). هذا ما يجعل **المصدر واحداً فعلاً**:

```ts
// domain/contracts/primitives.ts
import { z } from 'zod'
import { parseAmountToMinor } from '@/domain/money/parse'
import type { Minor } from '@/domain/money/types'

/**
 * مبلغ من **نص المستخدم**. يمرّ بـ parseAmountToMinor (تجزئة نصية، بلا أي عشري عائم).
 * **يُحرَّم `z.coerce.number()` و`z.number()` على مدخل نصي**: كلاهما يمرّ بـ Number()
 * فيقبل '25.5055' ويُقرِّبه صامتاً — خرق مباشر للنواة §2.2 («رفض صريح لا تقريب صامت»).
 */
export const zMinorFromText = z.string().transform((raw, ctx): Minor => {
  const r = parseAmountToMinor(raw)
  if (r.ok) return r.value
  ctx.addIssue({ code: 'custom', params: { money: r.code }, message: MONEY_ERRORS_AR[r.code] })
  return z.NEVER
})

export const MONEY_ERRORS_AR = {
  EMPTY:              'أدخل المبلغ.',
  NOT_A_NUMBER:       'المبلغ غير صالح — أدخل رقماً.',
  TOO_MANY_DECIMALS:  'الحد الأقصى ثلاث خانات عشرية (الدرهم).',
  OUT_OF_RANGE:       'المبلغ أكبر من الحد المسموح.',
  NEGATIVE:           'المبلغ يجب أن يكون أكبر من صفر.',
} as const

export const zDateKey   = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح.')
export const zPeriodKey = z.string().regex(/^\d{4}-\d{2}$/, 'الفترة غير صالحة.')
export const zNonEmptyAr = (field: string, max = 500) =>
  z.string().trim().min(1, `${field} مطلوب.`).max(max, `${field} أطول من ${max} حرفاً.`)
export const zId = z.string().min(1).max(128)
export const zTags = z.array(z.string().min(1).max(40)).max(20).default([])
```

```ts
// domain/contracts/requests/recordExpense.ts
import { z } from 'zod'
import { zDateKey, zId, zMinorFromText, zNonEmptyAr, zTags } from '../primitives'

/** مخطط **النموذج**: ما يُدخله المستخدم (المبلغ نص). */
export const zExpenseInput = z.strictObject({
  amount:         zMinorFromText,
  bookedAt:       zDateKey,
  categoryId:     zId,
  fromAccountId:  zId,
  description:    zNonEmptyAr('الوصف', 500),
  paymentMethod:  z.enum(['cash', 'card', 'transfer', 'wallet', 'other']).optional(),
  payeeContactId: zId.optional(),
  tags:           zTags,
  notes:          z.string().trim().max(2000).optional(),
})
export type ExpenseInput = z.output<typeof zExpenseInput>

/** يبني الطلب النهائي. `opId` **لا يأتي من النموذج كقيمة مُدخلة** بل من حالته (النواة §6.2). */
export function toRecordExpenseRequest(input: ExpenseInput, opId: string): RecordExpenseRequest {
  return { type: 'recordExpense', opId, amountMinor: input.amount, /* … */ }
}

/**
 * مخطط **الطلب** (حدّ المستودع): نفس القواعد لكن المبلغ `Minor` صحيح لا نص.
 * `data/ledger/postOperation` يتحقق به **قبل** `planOperation` ⇒ أي مسار برمجي
 * يستدعي execute() مباشرة (استيراد، استدراك، سكربت) يُفحَص بنفس القواعد.
 */
export const zRecordExpenseRequest = z.strictObject({
  type:          z.literal('recordExpense'),
  opId:          zId,
  amountMinor:   zMinorInt,                 // عدد صحيح موجب ≤ MAX_ABS_MINOR
  bookedAt:      zDateKey,
  categoryId:    zId,
  fromAccountId: zId,
  description:   zNonEmptyAr('الوصف', 500),
  /* … بقية الحقول مطابقة لـ zExpenseInput */
})
```

**المشاركة الفعلية بين النموذج والمستودع — بثلاث وسائل مجتمعة:**

1. **البدائيات مشتركة حرفياً** (`zDateKey`, `zId`, `zNonEmptyAr`, `zTags`): أي تغيير في حدّ
   طول الوصف يسري على الاثنين من مكان واحد.
2. **اختبار تطابق إلزامي** (`tests/unit/contracts/parity.test.ts`): لكل عملية، يتحقق أن
   `Object.keys(zExpenseInput.shape)` و`Object.keys(zRecordExpenseRequest.shape)` متطابقان بعد
   استبعاد `{type, opId}` وإعادة تسمية `amount → amountMinor`. **انحراف حقل = اختبار يفشل.**
   هذا أهم من توليد أحدهما من الآخر، لأن الاختلاف الوحيد المشروع (نص ⇔ `Minor`) يجعل التوليد
   الآلي أعقد من قيمته.
3. **`z.strictObject` في الاثنين**: حقل زائد = خطأ، لا تجاهل صامت. وهذا ما يكشف انحراف
   النموذج عن الطلب لحظة التطوير.

**قاعدة إضافية:** `features/*/forms/*` **لا تُعرِّف مخططاً**. تستورد من `domain/contracts/requests/**`.
النموذج يربط المخطط بالحقول ويعرض `FieldError` من `z.treeifyError(result.error)`، ولا شيء غير ذلك.

### 8.3 الحدّ (ب) — القراءة: فكّ ترميز + ترحيل بطيء

```ts
// data/codecs/decode.ts
import type { DocumentSnapshot } from 'firebase/firestore'
import type { z } from 'zod'

export interface DecodeResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: AppError
}

/**
 * حدّ القراءة الوحيد في النظام.
 *   raw ⇒ (مخطط النسخة المخزَّنة) ⇒ migrate ⇒ (المخطط الحالي الصارم) ⇒ T
 *
 * **لماذا مخططان لا واحد؟** ADR-019: الدفتر لا يُرحَّل أبداً والمشتقات تُرحَّل بطيئاً عند القراءة.
 * فالمخطط الأول **متسامح** (يقبل نسخاً أقدم وحقولاً لم نعرفها بعد)، والثاني **صارم**
 * (يضمن أن ما يدخل `domain` مكتمل). التحقق بالمخطط الصارم وحده يرفض مستنداً سليماً بنسخة 1
 * بعد إصدار النسخة 2 ⇒ تطبيق لا يقرأ بياناته الخاصة.
 */
export function decodeDoc<TStored, TOut>(
  snap: DocumentSnapshot,
  storedSchema: z.ZodType<TStored>,
  migrate: (s: TStored) => TOut,
  currentSchema: z.ZodType<TOut>,
): DecodeResult<TOut>
```

```ts
// data/codecs/account.ts
export const zAccountStored = z.looseObject({        // متسامح: حقول مستقبلية تُمرَّر
  schemaVersion: z.number().int().min(1),
  ownerUid: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(['asset', 'liability', 'income', 'expense', 'equity']),
  normalSide: z.enum(['debit', 'credit']),
  // ── كل حقل مالي: **عدد صحيح إلزاماً** (ADR-001) ──
  debitTotalMinor:  z.number().int(),
  creditTotalMinor: z.number().int(),
  balanceMinor:     z.number().int(),
  openingBalanceMinor: z.number().int(),
  earmarkedMinor:   z.number().int().min(0),
  minBalanceMinor:  z.number().int().max(0),
  entryCount:       z.number().int().min(0),
  balanceVersion:   z.number().int().min(0),
  isCashLike: z.boolean(), isPostable: z.boolean(), isSystem: z.boolean(),
  status: z.enum(['active', 'archived']),
  createdAt: zTimestamp, updatedAt: zTimestamp,
  /* … */
}).superRefine((a, ctx) => {
  // ── I3 يُفحَص **عند القراءة أيضاً** لا عند الكتابة فقط ──
  const raw = a.debitTotalMinor - a.creditTotalMinor
  const expected = a.normalSide === 'debit' ? raw : -raw
  if (a.balanceMinor !== expected) {
    ctx.addIssue({ code: 'custom', params: { invariant: 'I3' },
      message: `رصيد الحساب «${a.code}» لا يطابق إجمالييه (I3).` })
  }
  // ── I22 (النواة R9): المستحق ليس نقداً ──
  if (a.subtype === 'receivable' && a.isCashLike) {
    ctx.addIssue({ code: 'custom', params: { invariant: 'I22' },
      message: `الحساب «${a.code}» مستحق ومُعلَّم كنقد (I22).` })
  }
})
```

**فحص الثوابت عند القراءة ليس تكراراً للقواعد — بل الطبقة التي تكشف ما لا تراه القواعد.**
النواة §18.4 تُعلن صراحةً: القواعد تُقيَّم لكل مستند على حدة ولا تفرض المقدار. ومستند حُدِّث من
مسار التفّ على `postOperation` (سكربت، كونسول، نسخة قديمة) قد يصل سليم الشكل خاطئ القيمة.
فحص I3 و I22 و I5 و I6 **عند كل فكّ ترميز** يحوّل ذلك إلى **إنذار فوري عند أول قراءة**
بتكلفة صفر قراءات إضافية.

### 8.4 سياسة فشل فكّ الترميز — قرار صريح يحتاج إقرار المالك

> **القاعدة: فشل فكّ ترميز إسقاط مالي = خطأ سلامة حاجب. فشل فكّ ترميز مستند غير مالي = صفّ
> بحالة خطأ، والتطبيق يستمر.**

| المجموعة | عند فشل الفكّ | السبب |
|---|---|---|
| `accounts`, `periods`, `accountPeriods`, `budgetPeriods`, `obligations`, `debts`, `financialGoals`, `journalEntries`, `postings`, `meta` | **`kind: 'integrity'`, `blocking: true`** ⇒ شريط أحمر + **تعطيل كل الترحيل** + شاشة «سلامة البيانات» | استبعاد حساب تالف من مجموع «الأموال المتاحة» يُنتج **رقماً خاطئاً معروضاً كصحيح** — وهذا أسوأ من التعطيل. والنواة §12.10 تتبع نفس المنطق عند اختلال I4 |
| `notes`, `tasks`, `notifications`, `worshipRecords`, `quranProgress`, `contacts`, `categories`, `recurrences`, `pendingCommands` | **صفّ واحد بحالة خطأ** + تسجيل + بقية الشاشة سليمة | لا رقم مالي يتأثر. وتعطيل التطبيق كله بسبب ملاحظة تالفة سلوك سيئ |
| `settings` | **القيم الافتراضية + toast** «تعذّر قراءة بعض الإعدادات، تُستخدم القيم الافتراضية» | الإعدادات ليست مصدر حقيقة مالياً، والتعطيل بسببها غير مبرَّر |

**هذا القرار يُرفَع للمالك** (§16.2 سؤال 3): مستند تالف واحد يُعطِّل تسجيل العمليات حتى
إعادة البناء. البديل (الاستمرار مع استبعاد التالف) **مرفوض هندسياً** لأنه يعرض أرقاماً خاطئة
بثقة. والمسار المعتمد يبقى سريعاً: شاشة «سلامة البيانات» تعرض المستند والسبب وزر «إعادة بناء».

### 8.5 الحدّ (ج) — الكتابة: تأكيد لا تحقق

```ts
// data/codecs/encode.ts
/**
 * يُطبَّق قبل كل tx.set/tx.update. ليس تحققاً من مدخل مستخدم (تحقَّق عند الحدّ أ) بل
 * **تأكيد ثابت**: ما تبنيه domain لا يُكتب إن خالف شكله.
 */
export function encodeForWrite<T>(value: T, schema: z.ZodType<T>, opts: { always: boolean }): T
```

| ما يُكتب | التحقق في الإنتاج | التحقق في التطوير |
|---|---|---|
| `journalEntries`, `postings` | **دائماً، مخطط كامل** | دائماً |
| `accounts`, `obligations`, `debts`, `periods`, `budgetPeriods`, `financialGoals` | **تأكيدات صحيحة رخيصة فقط** (`Number.isInteger`, الحدود، `remaining` مشتق) | مخطط كامل |
| غير المالي | لا شيء | مخطط كامل |

**لماذا الدفتر دائماً والباقي لا؟** `journalEntries` و`postings` **غير قابلة للتعديل أو الحذف**
(النواة §14.3: `allow update, delete: if false` على postings). كتابة خاطئة فيهما **لا تُصلَح أبداً**
إلا بقيد عكس — أي أن الخطأ يبقى محفوراً في السجل. أما المشتقات فكلها **قابلة لإعادة البناء**
(النواة §16.2) ⇒ تكلفة التحقق الكامل عليها في المسار الساخن لا تُشترى بفائدة.
والتأكيدات الرخيصة (صحّة العدد والحدود واشتقاق `remaining`) تبقى **دائماً** لأن كلفتها صفر عملياً.

### 8.6 قواعد Zod المُلزِمة

| # | القاعدة | السبب |
|---|---|---|
| 1 | **ممنوع `z.coerce.*`** في كل المشروع | تحويل صامت: `z.coerce.number()` يقبل `''` ⇒ `0`، و`'25.5055'` ⇒ تقريب. خرق النواة §2.2 |
| 2 | **ممنوع `z.number()` على مبلغ قادم من نص** | المسار الوحيد `zMinorFromText` ⇒ `parseAmountToMinor` |
| 3 | `z.strictObject` لكل مخطط **إدخال**، و`z.looseObject` لكل مخطط **قراءة** | الإدخال: حقل زائد عيب. القراءة: حقل مستقبلي يجب أن يمرّ |
| 4 | `zTimestamp = z.custom<Timestamp>(v => v instanceof Timestamp)` في `data/codecs` **لا** في `domain/contracts` | `Timestamp` نوع من `firebase/firestore`؛ `domain` تستورده كنوع فقط (النواة §4.1) ولا تفحصه تنفيذياً |
| 5 | كل رسالة خطأ في كل مخطط **عربية** ومن `messages.ar.ts` أو مكتوبة بالقالب الثلاثي | المتطلبات §25 بند 18 |
| 6 | `.default()` ممنوع على أي حقل مالي | قيمة افتراضية لمبلغ تُخفي حقلاً ناقصاً بدل كشفه |
| 7 | المخططات **لا تُنشأ داخل مكوّن أو دالة** | إنشاء مخطط في كل تصيير كلفة بلا داعٍ؛ كلها ثوابت على مستوى الوحدة |

---

## 9. PWA والعمل دون اتصال

### 9.1 ما يعمل دون اتصال وما لا يعمل — جدول صدق

> **المتطلبات §22 تُلزم: «عدم اعتبار العملية محفوظة إلا بعد تأكيد نجاح الكتابة».
> وق-1 يُلزم بألا نَعِد المستخدم بما لا نُوفي به. هذا الجدول هو الوعد، ولا نتجاوزه.**

| الوظيفة | دون اتصال | كيف |
|---|---|---|
| فتح التطبيق والتنقل | **✓ كاملاً** | قوقعة التطبيق مُخزَّنة مسبقاً بعامل الخدمة |
| قراءة الحسابات والأرصدة والتقارير الشهرية | **✓ من كاش Firestore** — **بوسم «بيانات غير محدَّثة»** | `persistentLocalCache` |
| كشف الحركة (صفحات) | ✓ للصفحات التي زُرتها في هذه الجلسة أو سابقاً | الكاش |
| الملاحظات والمهام والعبادات (قراءة) | ✓ بنفس الوسم | الكاش |
| **تسجيل عملية مالية** | **✗ لا تُرحَّل** — تدخل الطابور بوسم «بانتظار المزامنة» و**تُستبعد من كل رصيد وتقرير** | `runTransaction` يفشل دون اتصال (النواة §6.6) ⇒ `pendingCommands` |
| تعليم مهمة مكتملة / قراءة إشعار / تثبيت ملاحظة | **✓ تُطابَر محلياً وتُرسَل تلقائياً** | `setDoc`/`updateDoc` يُطابَران في Firestore |
| التقارير التجميعية الخادمية (`sum`/`count`) | **✗** | `getAggregateFromServer` يتطلب الخادم ⇒ رسالة «يتطلب اتصالاً» |
| التسوية وميزان المراجعة وإعادة البناء | **✗** | تتطلب تجميعاً خادمياً وكتابات ذرّية |
| إشعار يصل والتطبيق مغلق | **✗ ولا نَعِد به** (ق-1) | يتطلب خادماً |

### 9.2 ADR-030 — تهيئة Firestore: `persistentLocalCache` مُفعَّل

```ts
// data/firebase/app.ts
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore'
import { env } from '@/lib/env'

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})

export const auth = getAuth(firebaseApp)

/**
 * **قرار معتمد: الكاش الدائم مُفعَّل، بمدير التبويبات المتعدد.**
 *
 * `initializeFirestore` (لا `getFirestore`) لأن التهيئة يجب أن تسبق أي استخدام،
 * و`enableIndexedDbPersistence` **مهجورة** ومحظورة بـ B12.
 *
 * `persistentMultipleTabManager` لا `persistentSingleTabManager`: المالك يفتح التطبيق على
 * الحاسوب والهاتف **وقد يفتح تبويبين على الحاسوب**. المدير أحادي التبويب **يرمي استثناءً**
 * في التبويب الثاني ⇒ تطبيق لا يعمل بلا سبب مفهوم للمستخدم.
 *
 * `cacheSizeBytes` محدود بـ 40MB لا `CACHE_SIZE_UNLIMITED`: الكاش غير المحدود ينمو على
 * هاتف بسعة محدودة بلا سقف، ولا فائدة منه عندنا لأن الدفتر يُقرأ بالصفحات لا كاملاً.
 */
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: 40 * 1024 * 1024,
  }),
})
```

### 9.3 الخطر الحقيقي ولماذا لا يمسّ صحة الأرصدة

**السيناريو المخيف المطروح:** «قراءة رصيد قديم من الكاش ثم الكتابة عليه».
**تحليله ينتهي إلى أنه مستحيل في هذا التصميم، لسبب بنيوي واحد:**

> **`runTransaction` لا يقرأ من الكاش المحلي أبداً.** قراءات `tx.get()` **خادمية حصراً**،
> والمعاملة تحمل تحقّقاً تفاؤلياً من الإصدار: إن تغيّر أي مستند قرأته بين القراءة والالتزام،
> **تُجهَض المعاملة (`aborted`) وتُعاد** بقراءات جديدة. ولهذا تحديداً `runTransaction` **يفشل
> دون اتصال** بدل أن يعمل على بيانات قديمة.

ومنه تتفرّع ثلاث نتائج، كل واحدة منها تُسقط فرعاً من الخطر:

| الفرع | الحكم | الدليل |
|---|---|---|
| **قرار مالي مبني على رصيد من الكاش** | **مستحيل** | كل حوارس النواة (حدّ الرصيد، السداد الزائد، عتبة الميزانية، `payloadHash`) تُفحَص **داخل** `runTransaction` على قيم خادمية (النواة §11.2 و§5.4) |
| **كتابة مالية تُطابَر محلياً فتُطبَّق لاحقاً على بيانات تغيّرت** | **مستحيل** | المعاملات لا تُطابَر. والطابور عندنا (`pendingCommands`) **لا يحمل نتيجة محسوبة** بل **نيّة** (`OperationRequest`)؛ وعند التفريغ تُحسب الخطة من جديد بقراءات خادمية طازجة |
| **عرض رصيد قديم للمستخدم** | **ممكن وحقيقي** ⇒ **هذا هو الخطر الوحيد، ويُعالَج بالعرض لا بالتخزين** | `onSnapshot` يُصدِر لقطة من الكاش أولاً (`metadata.fromCache === true`) |

**المعالجة الإلزامية للخطر الوحيد الباقي — أربع طبقات:**

```ts
// data/firebase/freshness.ts
/**
 * كل اشتراك يمرّ من هنا. يُحدِّث freshnessStore ويفرض ثابتاً محلياً حاسماً.
 */
export function trackFreshness(keyHash: string, meta: SnapshotMetadata, collection: string): void {
  useFreshnessStore.getState().set(keyHash, {
    fromCache: meta.fromCache,
    hasPendingWrites: meta.hasPendingWrites,
    atIso: nowIso(),
  })

  /**
   * **الثابت A1 (جديد، خاص بهذه الطبقة):**
   * لا لقطة لإسقاط مالي يجوز أن تحمل hasPendingWrites === true.
   * السبب: كل كتابة مالية تمرّ بـ runTransaction الذي **لا يُطابَر محلياً** ⇒ لا كتابة
   * معلّقة ممكنة على هذه المجموعات. ظهورها يعني **مسار كتابة التفّ على postOperation**
   * (النواة §11.5 الصف 1: أعلى احتمال على الإطلاق) ⇒ إنذار سلامة فوري لا تجاهل.
   */
  if (meta.hasPendingWrites && FINANCIAL_COLLECTIONS.has(collection)) {
    void logError(appError({
      kind: 'integrity', blocking: true, code: 'A1_PENDING_WRITE_ON_PROJECTION',
      retryable: false, context: { collection },
      messageAr: 'اكتُشفت كتابة محلية معلّقة على بيانات مالية — تسجيل العمليات موقوف. '
               + 'افتح «الإعدادات ← سلامة البيانات».',
    }))
    useGateStore.getState().block('integrity')
  }
}

const FINANCIAL_COLLECTIONS = new Set([
  'accounts', 'journalEntries', 'postings', 'periods', 'accountPeriods',
  'budgetPeriods', 'obligations', 'debts', 'financialGoals',
])
```

| الطبقة | الإجراء الملموس |
|---|---|
| **1 — وسم على كل رقم** | كل بطاقة مالية تعرض `StaleDataBadge` حين `fromCache === true`: «آخر تحديث: قبل 12 دقيقة — غير متصل». **لا رقم مالي يُعرض بلا حالة نضارة** |
| **2 — شريط عام** | `ConnectivityProvider` يعرض شريطاً: «غير متصل — الأرقام المعروضة آخر ما وصل» عند `navigator.onLine === false` أو أي لقطة مالية `fromCache` |
| **3 — حجب الأزرار** | دون اتصال: أزرار العمليات المالية تتحوّل إلى «حفظ في قائمة الانتظار» بنص صريح، **لا «حفظ»**. والنتيجة تُعرض بوسم «بانتظار المزامنة» و**تُستبعد من كل رصيد** (النواة ADR-007) |
| **4 — حظر قراءة الكاش برمجياً** | `getDocFromCache` و`getDocsFromCache` **محظورتان في كل المشروع** (B11). لا مسار قراءة مالية من الكاش موجود أصلاً في الكود ليُسيء أحد استخدامه |

**قرار مرافق: فهارس الكاش المحلي مُفعَّلة.**

```ts
// data/firebase/app.ts (يُنادى مرة واحدة بعد الإقلاع)
getPersistentCacheIndexManager(db)?.enableIndexAutoCreation()
```
السبب: استعلامات كشف الحركة والالتزامات تعمل على الكاش أيضاً، وبلا فهارس محلية تُقيَّم بمسح كامل
⇒ تجمّد الواجهة على الهاتف بعد سنة من البيانات. التكلفة: مساحة قرص إضافية داخل سقف 40MB.

### 9.4 ADR-031 — عامل الخدمة: القوقعة فقط، صفر تخزين للبيانات

**الإعداد القائم في `vite.config.ts` صحيح ويُثبَّت**، وهذه هي الأسباب التي تجعل كل سطر فيه
**حمّالاً لوظيفة لا تجميلاً**:

| الإعداد القائم | لماذا هو كذلك بالضبط |
|---|---|
| `globPatterns: ['**/*.{js,css,html,svg,woff2}']` | قوقعة التطبيق والخطوط المستضافة محلياً فقط |
| **`runtimeCaching: []`** | **أهم سطر في الملف.** أي تخزين مؤقت لحركة Firestore يُنتج **طبقة كاش ثانية لا يراها SDK ولا تُبطَل بلقطة جديدة** ⇒ أرصدة قديمة بلا أي وسم نضارة، وخرق مباشر للنواة. الكاش المسموح الوحيد هو كاش Firestore نفسه (§9.2) |
| `navigateFallbackDenylist: [/^\/__/]` | **حمّال أمان لا تنظيف:** مسار `/__/auth/handler` هو معالج Google Sign-In على Firebase Hosting. اعتراض عامل الخدمة له **يُعطِّل تسجيل الدخول كلياً** — وهو المسار الوحيد للمصادقة (ق-2) |
| `registerType: 'prompt'` | التحديث الصامت قد يُبدِّل الكود تحت نموذج مفتوح نصف مملوء. المطالبة تُعرض كـ toast «نسخة جديدة متاحة — تحديث» |
| `display: 'standalone'`, `dir: 'rtl'`, `lang: 'ar'` | تثبيت على الهاتف باتجاه صحيح (المتطلبات §2 بند 8 و§3) |

**إضافة إلزامية — التحديث القسري:**

```ts
// app/boot/registerSW.ts
const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true })

/**
 * إن كانت نسخة المخطط على الخادم أحدث من نسخة هذا التطبيق (النواة §17.2)،
 * فالتحديث **ليس اقتراحاً**: التطبيق القديم ممنوع من الكتابة بـ SCHEMA_VERSION_AHEAD،
 * وتركه مفتوحاً يعني شاشات تعمل وأزرار ترفض بلا سبب مفهوم.
 */
if (gate === 'schemaAhead') {
  await updateServiceWorker(true)     // يُفعِّل النسخة الجديدة ويُعيد التحميل فوراً
}
```

**قرارات صريحة أخرى على PWA:**

| القرار | السبب |
|---|---|
| **لا `Background Sync API`** | غير مدعومة في Safari/iOS (منصة المالك محتملة)، وتفريغ الطابور يحدث عند فتح التطبيق وعند حدث `online` — وهو كافٍ وصريح. والوعد بمزامنة خلفية لا تعمل على iOS خرق لق-1 |
| **لا `Web Push`** | يتطلب خادماً (ق-1). إشعارات داخل التطبيق + `Notification` API عند الإذن **والتطبيق مفتوح** فقط |
| **لا `persistent storage` بلا طلب** | `navigator.storage.persist()` يُطلب **مرة واحدة** بعد أول عملية ناجحة مع شرح: «لحماية بياناتك المحلية من الحذف التلقائي». رفض المستخدم لا يُعطِّل شيئاً |
| **تنظيف الكاش عند تسجيل الخروج** | `clearIndexedDbPersistence(db)` بعد `signOut` و`terminate(db)` — وإلا بقيت بيانات مالية على جهاز قد يكون مشتركاً |

---

## 10. إعداد البيئة والأسرار

### 10.1 ADR-032 — ما هو سرّ وما ليس سرّاً

> **`apiKey` الخاص بتطبيق الويب في Firebase ليس سرّاً، ويجب تقييده.
> ولا يوجد في هذا المشروع أي سرّ حقيقي داخل كود الواجهة — ولا يجوز أن يوجد.**

**لماذا `apiKey` ليس سرّاً — بدقة:**

`apiKey` في Firebase Web **معرِّف مشروع عام لا رمز تخويل**. وظيفته توجيه الطلب إلى المشروع الصحيح
وربطه بالحصة (quota). يُشحَن حتماً في كل حزمة JavaScript تصل المتصفح، ويمكن لأي زائر استخراجه
بأداة المطوّر في ثانيتين. **فإخفاؤه مستحيل تقنياً، ومحاولة إخفائه وهم أمني.**
والحماية الحقيقية طبقتان لا علاقة لهما بالمفتاح:

1. **Firebase Authentication:** لا وصول بلا هوية مُوثَّقة من Google.
2. **Firestore Security Rules + ق-2:** النظام **مغلق على UID المالك المعتمد**. شخص يملك
   `apiKey` ويسجّل دخولاً بحساب Google الخاص به **لا يقرأ ولا يكتب بايتاً واحداً** —
   الإغلاق في القواعد لا في الواجهة (النواة §14.1).

**ولماذا يجب تقييده مع ذلك — ثلاثة أخطار حقيقية باقية:**

| الخطر الباقي | الأثر | التقييد المطلوب |
|---|---|---|
| **استهلاك الحصة** | طرف ثالث يستخدم مفتاحك لاستدعاء Identity Toolkit بكثافة ⇒ **تجاوز حصة Spark** ⇒ تعطّل تطبيقك (ق-1: لا ترقية) | **تقييد مفتاح API في Google Cloud Console** بـ HTTP referrers: نطاقات Hosting + `localhost` فقط |
| **تصيّد على نطاق غريب** | صفحة على نطاق آخر تستخدم مشروعك لتسجيل دخول Google يبدو شرعياً | **قائمة النطاقات المصرَّح بها** في Firebase Auth: `raseed-2fac1.firebaseapp.com`, `raseed-2fac1.web.app`, `localhost` — **ويُحذف ما عداها** |
| **تمكين خدمات غير مستخدمة** | مفتاح غير مقيَّد بالخدمات يصل إلى واجهات لم نستخدمها | **تقييد المفتاح بالواجهات (API restrictions):** Identity Toolkit, Firestore, Token Service فقط |

**ما يبقى سرّاً حقيقياً — ولا يوجد منه شيء في الواجهة:**

| السرّ | مكانه |
|---|---|
| حساب خدمة النشر (`FIREBASE_SERVICE_ACCOUNT`) | **GitHub Secrets فقط.** لا في المستودع ولا في `.env` ولا في الحزمة |
| مفتاح Admin SDK | **غير موجود في المشروع إطلاقاً** — لا كود خادمي (ق-1). المتطلبات §25 بند 9 |
| رموز الجلسة | تُدار من Firebase SDK في IndexedDB، لا تُقرأ ولا تُسجَّل (§7.6) |

**`VITE_OWNER_UID` — تحذير إلزامي:** هذا المتغيّر **ليس ضابطاً أمنياً**. وظيفته الوحيدة عرض
شاشة «حساب غير مُصرَّح» بلطف بدل سلسلة من `permission-denied`. **الحاجز الحقيقي وحده** هو
`allowedUids()` في `firestore.rules` (النواة §14.3). ويُمنع منعاً باتاً أي حراسة على **البريد**
(`VITE_OWNER_EMAIL`) لأن البريد قابل للتغيير بينما UID ثابت (ق-2 نصّاً).

### 10.2 ملفات البيئة

| الملف | متتبَّع في git؟ | المحتوى | الاستخدام |
|---|---|---|---|
| `.env.example` | **نعم** | المفاتيح بلا قيم + شرح عربي | قالب للمطوّر ومرجع للمتغيّرات المطلوبة |
| `.env.local` | **لا** (في `.gitignore`) | قيم مشروع `raseed-2fac1` الحقيقية | التطوير المحلي |
| `.env.test` | **نعم** | قيم المحاكي الثابتة لمشروع `demo-raseed` | الاختبارات و CI — **لا قيم حقيقية** |
| متغيّرات بيئة CI | — | من GitHub Variables/Secrets | بناء النشر |

`.env.example` القائم **يُوسَّع** بما يلي (الموجود يبقى كما هو):

```bash
# ── إضافات مطلوبة على .env.example القائم ─────────────────────────────
# نسخة التطبيق المعروضة في شاشة «حول» وفي سجل الأخطاء (تُولَّد في البناء من git)
VITE_APP_VERSION=dev

# منافذ المحاكي — تُطابق firebase.json
VITE_EMULATOR_AUTH_PORT=9099
VITE_EMULATOR_FIRESTORE_PORT=8080

# تفعيل أدوات التشخيص (TanStack Devtools، شاشة سجل الأخطاء الموسّعة)
VITE_ENABLE_DEVTOOLS=false
```

`.env.test` (جديد، متتبَّع — بلا أي سرّ):

```bash
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=localhost
VITE_FIREBASE_PROJECT_ID=demo-raseed
VITE_FIREBASE_STORAGE_BUCKET=demo-raseed.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
VITE_OWNER_EMAIL=owner@example.test
VITE_OWNER_UID=test-owner-uid
VITE_USE_EMULATORS=true
VITE_APP_VERSION=test
```

> **لماذا بادئة `demo-` في معرّف مشروع الاختبار ليست تفصيلاً:** محاكي Firestore يتعامل مع أي
> `projectId` يبدأ بـ `demo-` كمشروع **غير موجود فعلاً**، فيرفض أي محاولة اتصال بالسحابة.
> هذا يجعل **استحالة لمس البيانات الحقيقية من الاختبارات ضماناً تقنياً لا انتباهاً بشرياً** —
> وهو مطلب المتطلبات §25 بند 11 حرفياً.

### 10.3 كيف تُحقن المفاتيح ويُتحقَّق منها

**الحقن:** Vite يستبدل `import.meta.env.VITE_*` **وقت البناء** بقيم نصية ثابتة.
لا قراءة بيئة وقت التشغيل، ولا متغيّر بلا بادئة `VITE_` يصل المتصفح (حماية Vite الافتراضية
من تسريب أسرار الخادم).

**التحقق — بوابة الإقلاع الأولى، تفشل سريعاً:**

```ts
// lib/env.ts
import { z } from 'zod'

const zEnv = z.strictObject({
  VITE_FIREBASE_API_KEY:             z.string().min(10),
  VITE_FIREBASE_AUTH_DOMAIN:         z.string().min(3),
  VITE_FIREBASE_PROJECT_ID:          z.string().min(3),
  VITE_FIREBASE_STORAGE_BUCKET:      z.string().min(3),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().regex(/^\d+$/),
  VITE_FIREBASE_APP_ID:              z.string().min(10),
  VITE_FIREBASE_MEASUREMENT_ID:      z.string().optional(),
  VITE_OWNER_EMAIL:                  z.string().email(),
  VITE_OWNER_UID:                    z.string().min(1),
  VITE_USE_EMULATORS:                z.enum(['true', 'false']).transform((v) => v === 'true'),
  VITE_APP_VERSION:                  z.string().default('dev'),
  VITE_ENABLE_DEVTOOLS:              z.enum(['true', 'false']).default('false')
                                       .transform((v) => v === 'true'),
})

const parsed = zEnv.safeParse(import.meta.env)

/**
 * **فشل سريع مقصود.** تطبيق مالي يُقلع بإعداد ناقص يُنتج أخطاء `permission-denied` غامضة
 * أو — أسوأ — يتصل **بمشروع خاطئ**. البديل (قيم افتراضية) مرفوض: ليس هناك قيمة افتراضية
 * معقولة لمعرّف مشروع قاعدة بيانات مالية.
 */
export const env = parsed.success ? parsed.data : null
export const envErrors: readonly string[] = parsed.success
  ? []
  : Object.entries(z.flattenError(parsed.error).fieldErrors)
      .map(([k, v]) => `${k}: ${(v ?? []).join(', ')}`)
```

`src/main.tsx` يفحص `env === null` **قبل** `initializeApp` ويعرض `EnvErrorScreen` —
شاشة HTML ساكنة لا تعتمد على الموجِّه ولا على Firebase ولا على أي موفِّر.

**حارس إضافي في البناء** (`scripts/check-env.mjs` في `prebuild`): يرفض البناء إن كان
`VITE_FIREBASE_PROJECT_ID` يبدأ بـ `demo-` أو `VITE_USE_EMULATORS=true`
⇒ **استحالة نشر حزمة مُوجَّهة إلى المحاكي**.

### 10.4 `firebase.json` — الترويسات ومنافذ المحاكي

```jsonc
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage":   { "rules": "storage.rules" },           // منع كامل حتى Blaze (ق-1)
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        // index.html لا يُخزَّن أبداً: وإلا بقي المستخدم على نسخة قديمة بعد النشر
        "source": "/index.html",
        "headers": [{ "key": "Cache-Control", "value": "no-store, max-age=0" }]
      },
      {
        // الأصول مُبصَمة بالتجزئة من Vite ⇒ تخزين دائم آمن
        "source": "/assets/**",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      },
      {
        // عامل الخدمة لا يُخزَّن، وإلا لم يُكتشف التحديث
        "source": "/sw.js",
        "headers": [{ "key": "Cache-Control", "value": "no-store, max-age=0" }]
      },
      {
        "source": "**",
        "headers": [
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Referrer-Policy", "value": "no-referrer" },
          { "key": "Permissions-Policy",
            "value": "geolocation=(self), camera=(), microphone=(), payment=()" },
          { "key": "Strict-Transport-Security",
            "value": "max-age=31536000; includeSubDomains" },
          { "key": "Content-Security-Policy", "value":
            "default-src 'self'; "
            + "script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; "
            + "font-src 'self'; "
            + "img-src 'self' data: https://lh3.googleusercontent.com; "
            + "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com "
            +   "wss://*.firebaseio.com https://firestore.googleapis.com "
            +   "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; "
            + "frame-src https://raseed-2fac1.firebaseapp.com https://accounts.google.com; "
            + "frame-ancestors 'none'; base-uri 'self'; form-action 'none'; "
            + "object-src 'none'" }
        ]
      }
    ]
  },
  "emulators": {
    "auth":      { "port": 9099 },
    "firestore": { "port": 8080 },
    "hosting":   { "port": 5000 },
    "ui":        { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

**ثلاث نقاط في CSP تحتاج تبريراً:**

1. **`frame-src` يسمح بـ `raseed-2fac1.firebaseapp.com` و`accounts.google.com`**:
   تسجيل الدخول بـ Google يعمل عبر إطار/نافذة معالج المصادقة. حذفهما **يُعطِّل المصادقة كلياً** —
   وهي المسار الوحيد للنظام (ق-2).
2. **`img-src` يسمح بـ `lh3.googleusercontent.com`**: صورة ملف المستخدم من حساب Google
   (المتطلبات §21). ولا نطاق صور آخر.
3. **`style-src 'unsafe-inline'`**: Tailwind 4 + المتغيّرات الديناميكية للسمات تُنتج أنماطاً
   مضمَّنة. **انحراف معلن**، ومُخفَّف بأن `script-src` **لا يحتوي** `'unsafe-inline'` ولا
   `'unsafe-eval'` — وهي التي تُستغَل في XSS فعلاً. و`form-action 'none'` لأن النظام لا يُرسِل
   أي نموذج HTML تقليدي (كل الكتابات عبر SDK).

### 10.5 تهيئة Firebase — ما يجب على المالك فعله يدوياً مرة واحدة

> **حالة اليوم المفحوصة: لا تطبيق ويب مُسجَّل، ولا قاعدة Firestore مُنشأة** ⇒ لا `firebaseConfig`
> بعد. هذه الخطوات **تسبق أي كود**، وتُوثَّق في `docs/ops/FIREBASE-SETUP.md`.

| # | الخطوة | المخرَج |
|---|---|---|
| 1 | تسجيل تطبيق ويب في مشروع `raseed-2fac1` | `firebaseConfig` ⇒ يُنسَخ إلى `.env.local` |
| 2 | إنشاء قاعدة Firestore — **الوضع: Production** والموقع `europe-west*` (أقرب للمنطقة) | قاعدة فارغة بقواعد مُقيَّدة |
| 3 | تفعيل مزوّد Google في Authentication، **وتعطيل كل المزوّدين الآخرين** (ق-2) | مصادقة بمزوّد وحيد |
| 4 | أول تسجيل دخول بـ `albarshi.96@gmail.com` ⇒ `scripts/print-owner-uid.ts` | UID المالك ⇒ `allowedUids()` في القواعد + `.env.local` |
| 5 | تقييد مفتاح API (referrers + APIs) في Google Cloud Console | §10.1 |
| 6 | تقليص «النطاقات المصرَّح بها» في Auth إلى الثلاثة المذكورة | §10.1 |
| 7 | نشر القواعد والفهارس **بعد** اختبارها بالمحاكي والموافقة (المتطلبات §25 بند 10) | `firebase deploy --only firestore` |
| 8 | **لا إنشاء Storage bucket** (ق-1) — `storage.rules` بمنع كامل احتياطاً | المرفقات مؤجَّلة |

**ملاحظة على الخطوة 2:** اختيار **Production mode** لا Test mode ليس تفصيلاً: Test mode يفتح
القاعدة للعالم 30 يوماً، وأي بيانات مالية تُدخل خلالها تكون مكشوفة. والنواة §14.3 تبدأ بـ
`allow write: if false` افتراضياً — وهو ما يتوافق مع Production mode.

---

## 11. التوجيه والمصادقة وتسلسل الإقلاع

### 11.1 ADR-040 — `react-router` كموجِّه بيانات في المتصفح

**القرار:** `createBrowserRouter` مع `lazy` لكل مسار. **بلا `loader` يجلب بيانات.**

**لماذا بلا `loader`؟** `loader` يفترض «اجلب ثم اعرض»، ونموذجنا «اشترك ثم استقبل».
استخدامه يعني قراءة مفوترة إضافية قبل كل انتقال، ثم اشتراكاً يُعيد نفس البيانات.
المستخدم الصحيح لـ `loader` عندنا: **تهيئة لا بيانات** — التحقق من صلاحية المعرّف في المسار
(`/accounts/:id` بمعرّف غير موجود ⇒ `errorElement`) وذلك من لقطة الحسابات الحاضرة أصلاً، بصفر قراءات.

```tsx
// app/router/routes.tsx
export const router = createBrowserRouter([
  { path: '/login', element: <SignInScreen /> },
  {
    path: '/',
    element: <AuthGuard><OwnerGuard><AppLayout /></OwnerGuard></AuthGuard>,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true,              lazy: () => import('@/features/dashboard') },
      { path: 'accounts',         lazy: () => import('@/features/accounts') },
      { path: 'accounts/:id',     lazy: () => import('@/features/accounts/routes/detail') },
      { path: 'transactions',     lazy: () => import('@/features/transactions') },
      { path: 'obligations',      lazy: () => import('@/features/obligations') },
      { path: 'debts/payable',    lazy: () => import('@/features/debts/routes/payable') },
      { path: 'debts/receivable', lazy: () => import('@/features/debts/routes/receivable') },
      { path: 'household',        lazy: () => import('@/features/household') },
      { path: 'budgets',          lazy: () => import('@/features/budgets') },
      { path: 'goals',            lazy: () => import('@/features/goals') },
      { path: 'planning',         lazy: () => import('@/features/planning') },
      { path: 'notes',            lazy: () => import('@/features/notes') },
      { path: 'tasks',            lazy: () => import('@/features/tasks') },
      { path: 'worship/*',        lazy: () => import('@/features/worship') },
      { path: 'reports',          lazy: () => import('@/features/reports') },
      { path: 'notifications',    lazy: () => import('@/features/notifications') },
      { path: 'settings/*',       lazy: () => import('@/features/settings') },
      { path: 'integrity',        lazy: () => import('@/features/integrity') },
      { path: 'backup',           lazy: () => import('@/features/backup') },
      { path: '*',                element: <NotFoundPage /> },
    ],
  },
])
```

**تقسيم الحزمة الناتج:** حزمة أولى = القوقعة + المصادقة + لوحة التحكم. كل ميزة أخرى حزمة
مستقلة تُحمَّل عند أول زيارة. وحزمتا `firebase` و`react` مفصولتان أصلاً في `vite.config.ts` القائم
⇒ تُخزَّنان بالتجزئة ولا تتغيّران مع كل نشر.

### 11.2 المصادقة — Google فقط (ق-2)

```ts
// data/auth/googleSignIn.ts
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

/**
 * نافذة منبثقة افتراضاً، وتراجع إلى إعادة التوجيه عند فشلها.
 * **السبب عملي لا نظري:** داخل تطبيق PWA مثبَّت على iOS وفي بعض متصفحات الهاتف
 * تُحجب النوافذ المنبثقة ⇒ تسجيل دخول لا يعمل ⇒ **لا وصول للنظام إطلاقاً** (مزوّد وحيد).
 */
export async function signInWithGoogle(): Promise<void> {
  try {
    await signInWithPopup(auth, provider)
  } catch (e) {
    const code = isFirebaseError(e) ? e.code : ''
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment'
        || code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth, provider)
      return
    }
    if (code === 'auth/popup-closed-by-user') return      // إلغاء المستخدم ليس خطأ
    throw toAppError(e)
  }
}
```

**تسجيل الخروج الكامل — خمس خطوات بترتيب مُلزِم:**

```ts
// data/auth/session.ts
export async function signOutCompletely(): Promise<void> {
  disposeAllLive()                       // 1) أوقف كل المستمعات قبل فقد الهوية
  await signOut(auth)                    // 2) أسقط الجلسة
  queryClient.clear()                    // 3) امسح ذاكرة الاستعلامات
  resetAllStores()                       // 4) أعد المتاجر المحلية إلى حالتها الأولى
  await terminate(db)                     // 5) أغلق Firestore ثم
  await clearIndexedDbPersistence(db)     //    امسح الكاش المحلي (قد يكون الجهاز مشتركاً)
  location.replace('/login')              //    إعادة تحميل نظيفة
}
```

**الترتيب ليس اختيارياً:** إيقاف المستمعات **قبل** `signOut` يمنع موجة `permission-denied`
من كل اشتراك قائم. و`terminate` **قبل** `clearIndexedDbPersistence` شرط تقني (الأخيرة تفشل
على مثيل نشط).

**الحراستان — وما تفعله كل واحدة بالضبط:**

| الحراسة | تفحص | عند الفشل | **هل هي أمان؟** |
|---|---|---|---|
| `AuthGuard` | `uid !== null` | توجيه إلى `/login` | **لا** — تجربة استخدام |
| `OwnerGuard` | `uid === env.VITE_OWNER_UID` | `UnauthorizedScreen` + زر خروج | **لا** — رسالة لطيفة بدل سلسلة أخطاء |

> **تأكيد إلزامي (المتطلبات §20 و§25 بند 10):** إخفاء عنصر واجهة ليس حماية. الحاجز الوحيد
> هو `allowedUids()` في `firestore.rules`. ويُثبَت ذلك باختبار محاكي صريح
> (`tests/rules/isolation.rules.test.ts`): UID غير معتمد يُرفَض في **القراءة والكتابة معاً**،
> على كل مجموعة.

### 11.3 عرض ذرّية الملكية: التهيئة قبل أي كتابة

`data/seed/ensureSeed.ts` يُنفَّذ **مرة واحدة لكل حساب** ويجب أن يكون **idempotent** تماماً
(النواة §3.3): معرّفات الحسابات والفئات حتمية (`accountIdOf(code) = sha1(code).slice(0,20)`)،
والكتابة بـ `writeBatch` مجزَّأ ≤450.

```
ensureSeed(uid):
  schema = get meta/schema          (قراءة واحدة)
  if schema موجود:  return 'alreadySeeded'
  // ── الدفعة الأولى: المستندات التي يتوقف عليها عمل النظام ──
  batch1: meta/integrity { projectionVersion:1, rebuildStatus:'idle', rebuildCursor:null, … }
          settings/app    (الافتراضيات — المتطلبات §21)
          accounts × ~45  (شجرة النواة §3.2 بمعرّفات حتمية)
          categories × ~12 (فئات النواة §3.4 بربط 1:1 مع حسابات expense)
  batch2: meta/schema { currentVersion: APP_SCHEMA_VERSION, appliedMigrations: [] }   ← **آخر شيء**
```

**`meta/schema` يُكتب أخيراً وليس أولاً — وهذا قرار يمنع عيباً حقيقياً:** لو كُتب أولاً وانقطع
الاتصال في منتصف التهيئة، لوجد التشغيل التالي `meta/schema` موجوداً فيُرجِع `alreadySeeded`
⇒ **نظام بلا شجرة حسابات ولا `meta/integrity`** — وهو بالضبط العيب ع-ج-5 الذي تعالجه النواة.
بكتابته أخيراً، أي انقطاع يُبقي الحالة «غير مُهيَّأ» فتُعاد التهيئة بأمان (المعرّفات حتمية ⇒
لا تكرار).

### 11.4 ADR-038 — تسلسل الإقلاع والبوابات الست

```
┌─ 0. تحقق البيئة (متزامن، بلا شبكة) ──────────────────────────────────────┐
│  env === null  ⇒  EnvErrorScreen  [نهاية — لا شيء آخر يُحمَّل]            │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 1. تهيئة Firebase ─────────▼───────────────────────────────────────────┐
│  initializeApp · getAuth · initializeFirestore(persistentLocalCache)     │
│  if VITE_USE_EMULATORS: connect*Emulator  (قبل أي استخدام)              │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 2. بوابة المصادقة ─────────▼───────────────────────────────────────────┐
│  onAuthStateChanged → uid | null                                        │
│  null ⇒ SignInScreen (Google فقط — ق-2)                                 │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 3. بوابة الملكية ──────────▼───────────────────────────────────────────┐
│  uid !== OWNER_UID ⇒ UnauthorizedScreen  [تجربة استخدام — القواعد هي الحاجز]│
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 4. بوابة التهيئة ──────────▼───────────────────────────────────────────┐
│  ensureSeed(uid)  ⇒  SeedingScreen أثناء التنفيذ                        │
│  فشل ⇒ شاشة خطأ + «أعد المحاولة» (لا يمضي أبداً بنصف تهيئة)             │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 5. بوابة نسخة المخطط ──────▼───────────────────────────────────────────┐
│  meta/schema.currentVersion > APP_SCHEMA_VERSION                        │
│     ⇒ ForcedUpdateScreen + updateServiceWorker(true)  [حاجب مطلق]       │
│  <  ⇒ وضع الترحيل البطيء (ADR-019) — يمضي                              │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 6. بوابة السلامة ──────────▼───────────────────────────────────────────┐
│  meta/integrity.rebuildStatus === 'running' ⇒ RebuildingScreen (قراءة فقط)│
│  auditTrialBalance(accounts)  [0 قراءات إضافية — من اللقطة]             │
│     غير متوازن ⇒ IntegrityBanner أحمر + **تعطيل كل الترحيل**            │
│  بصمة الدفتر I10  [2–3 قراءات]                                          │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─ 7. مهام بعد الإقلاع (بالترتيب، تسلسلياً) ──▼──────────────────────────┐
│  (أ) flushOutbox()        تفريغ pendingCommands واحدة واحدة            │
│  (ب) runCatchUp()         مادّية المتكرر بمعرّفات حتمية                 │
│  (ج) obligationStatusSweep()  due→overdue بـ writeBatch للمتغيّر فقط    │
│  (د) notificationSweep()  توليد التنبيهات بمفاتيح idempotency           │
│  (هـ) backupReminderCheck()  تذكير بأخذ نسخة (ق-1)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**لماذا هذا الترتيب بالضبط — خمس نقاط لا تُقلَب:**

| الترتيب | السبب |
|---|---|
| البيئة قبل كل شيء | تهيئة Firebase بإعداد ناقص قد تتصل **بمشروع خاطئ** |
| الملكية قبل التهيئة | وإلا أنشأ أي حساب Google شجرة حسابات في `users/{uidه}` — وهي كتابة ترفضها القواعد (ق-2) لكن محاولتها تُنتج أخطاء مُرْبِكة وتستهلك الحصة |
| التهيئة قبل بوابة المخطط | `meta/schema` لا يوجد قبل التهيئة ⇒ فحص النسخة على `null` |
| بوابتا المخطط وإعادة البناء **قبل** أي كتابة | كلتاهما حاجبة للكتابة (النواة §17.2 و I24). تشغيل التفريغ قبلهما يُنتج كتابات مرفوضة تُسجَّل كأخطاء |
| **(أ) قبل (ب)** | عملية دون اتصال من أمس يجب أن تُرحَّل **قبل** استدراك اليوم، وإلا اختلف ترتيب القيود عن ترتيب النيّة وقد يُرفَض أحدها بحدّ الرصيد لسبب مُصطنع (النواة §6.6 بند 6) |

**حراسة التكرار اليومي:** (ج) و(د) و(هـ) تعمل **مرة واحدة لكل يوم محلي** بحارس
`settings/app.lastSweepDateKey` (بتوقيت طرابلس — ADR-033). فتح التطبيق عشر مرات في اليوم
⇒ مسح واحد. وفشل أي مهمة منها **لا يحجب التطبيق**: تُسجَّل وتُعاد في الفتحة التالية.

### 11.5 ADR-033 — التاريخ المحاسبي بتوقيت طرابلس الثابت

```ts
// lib/time/tripoli.ts
/**
 * ليبيا على UTC+2 ثابتاً، **بلا توقيت صيفي**. هذا يجعل الإزاحة ثابتة ويُغني عن مكتبة مناطق زمنية.
 *
 * **لماذا لا نستخدم توقيت المتصفح:** bookedAt و periodKey يُخزَّنان على قيد **غير قابل للتغيير**
 * (النواة §4.3 و ADR-008). جهاز بمنطقة زمنية مختلفة (سفر، أو هاتف بإعداد خاطئ) يُنتج
 * **periodKey مختلفاً لنفس اللحظة** ⇒ مصروف ليلة 31 أكتوبر يهبط في نوفمبر على جهاز وأكتوبر
 * على آخر ⇒ ملخّصان شهريان متناقضان لا يكشفهما أي ثابت، ولا يُصلَحان إلا بقيد عكس.
 */
const TRIPOLI_OFFSET_MINUTES = 120

export function todayDateKey(): DateKey
export function toDateKey(instant: Date): DateKey
export function nowIso(): string
export function dateKeyToUtcNoon(dk: DateKey): Date      // bookedAtTs — منتصف نهار UTC
export function periodKeyOf(dk: DateKey): PeriodKey      // ≡ dk.slice(0,7)
```

**هذا انحراف لفظي عن النواة §4.3** («`bookedAt` بتوقيت المستخدم المحلي») **وتثبيت لما هو
مُنفَّذ فعلاً في `eslint.config.js`** (حظر `new Date()` مع توجيه إلى `lib/time`).
وهو **تضييق لا توسيع**: لمستخدم مقيم في ليبيا، «التوقيت المحلي» **هو** توقيت طرابلس، والفرق
يظهر فقط عند السفر — وهناك يكون الثبات هو الصواب. **يُرفَع في §14.1 و§16.2 لإقرار المالك.**

---

## 12. الأدوات والسكربتات و CI

### 12.1 ADR-036 — طوبولوجيا الاختبار

| الطبقة | الأداة | البيئة | المدى | متى تعمل |
|---|---|---|---|---|
| **وحدة نقية** | Vitest 5 + fast-check 4 | `node` | `src/domain/**` | `pre-push` + CI (ثوانٍ) |
| **مكوّنات** | Vitest + Testing Library + jsdom | `jsdom` | `src/{ui,features}/**` | CI |
| **قواعد الأمان** | `@firebase/rules-unit-testing` 6 | `node` + محاكي Firestore | `firestore.rules` | CI (محاكي) |
| **تكامل** | Vitest + محاكي | `node` + محاكي | `postOperation` والمعاملات | CI (محاكي) |
| **E2E** | Playwright 1.64 | متصفح + محاكي + `vite preview` | رحلات المستخدم | CI (مهمة منفصلة) |
| **إتاحة** | `@axe-core/playwright` 4.13 | متصفح | RTL + تباين + قارئات | CI مع E2E |

**عتبات تغطية مفروضة في CI** (لا للتجميل — `src/domain` هو ما لا يُسمح بخطئه):

| المسار | أسطر | فروع | دوال |
|---|---|---|---|
| `src/domain/money/**` | **100%** | **100%** | **100%** |
| `src/domain/{ledger,ops,rules}/**` | **95%** | **95%** | **95%** |
| `src/domain/**` (الباقي) | 90% | 85% | 90% |
| `src/data/**` | 70% | 60% | 70% |
| `src/{features,ui}/**` | 50% | 40% | 50% |

### 12.2 سكربتات `package.json` — تُضاف كاملة

> **`package.json` القائم لا يحتوي أي سكربت.** هذه الكتلة تُضاف كما هي.

```jsonc
{
  "scripts": {
    "dev":                "vite",
    "dev:emu":            "concurrently -k -n emu,vite \"npm:emu\" \"vite --mode test\"",
    "build":              "npm run check:env && tsc --noEmit && vite build",
    "preview":            "vite preview --port 4173 --strictPort",

    "check:env":          "node scripts/check-env.mjs",
    "typecheck":          "tsc --noEmit",
    "lint":               "eslint . --max-warnings 0",
    "lint:fix":           "eslint . --fix",
    "lint:layers":        "node scripts/verify-layers.mjs",
    "format":             "prettier --write .",
    "format:check":       "prettier --check .",

    "test":               "vitest run --project unit --project dom",
    "test:watch":         "vitest --project unit",
    "test:unit":          "vitest run --project unit",
    "test:dom":           "vitest run --project dom",
    "test:rules":         "firebase emulators:exec --only firestore --project demo-raseed \"vitest run --project rules\"",
    "test:integration":   "firebase emulators:exec --only firestore,auth --project demo-raseed \"vitest run --project integration\"",
    "test:coverage":      "vitest run --project unit --project dom --coverage",
    "test:all":           "npm run test && npm run test:rules && npm run test:integration",

    "e2e":                "playwright test",
    "e2e:ui":             "playwright test --ui",
    "e2e:install":        "playwright install --with-deps chromium",

    "emu":                "firebase emulators:start --project demo-raseed",
    "emu:export":         "firebase emulators:export tests/fixtures/emulator-data --project demo-raseed",
    "seed":               "tsx scripts/seed-chart-of-accounts.ts",
    "owner:uid":          "tsx scripts/print-owner-uid.ts",
    "backup":             "tsx scripts/export-backup.ts",

    "rules:deploy":       "firebase deploy --only firestore:rules",
    "indexes:deploy":     "firebase deploy --only firestore:indexes",
    "deploy":             "npm run verify && firebase deploy --only hosting,firestore",

    "verify":             "npm run format:check && npm run lint && npm run lint:layers && npm run typecheck && npm run test:all",
    "prepare":            "husky"
  }
}
```

**`npm run verify` هو البوابة الوحيدة المعتمدة قبل أي نشر** (المتطلبات §23 بند 15 و§25 بند 13)،
وهي نفسها التي يشغّلها CI — **لا يوجد فحص في CI غير موجود محلياً، ولا العكس**.

### 12.3 الحزم — المثبَّت فعلاً والمطلوب إضافته

**مثبَّت فعلاً** (من `package.json` و`package-lock.json` القائمين — هذه وقائع لا مقترحات):

| الحزمة | الإصدار | الدور |
|---|---|---|
| `react` · `react-dom` | `19.3.0` | الواجهة |
| `typescript` | `6.0.3` | الأنواع |
| `vite` · `@vitejs/plugin-react` | `8.3.4` · `6.1.2` | البناء |
| `firebase` | `13.0.0` | Firestore + Auth |
| `@tanstack/react-query` | `5.104.1` | حالة الخادم |
| `zustand` | `5.0.15` | الحالة المحلية |
| `zod` | `4.6.5` | التحقق |
| `react-router` | `8.4.0` | التوجيه |
| `tailwindcss` · `@tailwindcss/vite` | `4.3.3` | التنسيق |
| `vite-plugin-pwa` | `2.0.0` | PWA |
| `date-fns` | `4.4.0` | التواريخ |
| `lucide-react` | `1.54.0` | الأيقونات |
| `clsx` · `tailwind-merge` · `class-variance-authority` | `2.1.1` · `3.7.0` · `0.7.1` | تركيب الأصناف |
| `vitest` · `@vitest/coverage-v8` | `5.0.3` | الاختبار |
| `@firebase/rules-unit-testing` | `6.0.0` | اختبار القواعد |
| `fast-check` | `4.10.2` | اختبارات الخصائص |
| `@testing-library/react` · `jest-dom` | `16.3.3` · `7.0.1` | اختبار المكوّنات |
| `jsdom` | `30.1.2` | بيئة DOM |
| `eslint` · `typescript-eslint` | `10.12.0` · `8.71.1` | الفحص |
| `prettier` · `prettier-plugin-tailwindcss` | `3.9.9` · `0.8.1` | التنسيق |

**مطلوب إضافته** (إصدارات مُتحقَّق منها من مسجل npm):

| الحزمة | الإصدار | الدور | لماذا الآن |
|---|---|---|---|
| `@playwright/test` | `^1.64.0` | E2E | المتطلبات §23 بنود 10 و11 و13 |
| `@axe-core/playwright` | `^4.13.0` | إتاحة | RTL والتباين (§3) آلياً لا بالعين |
| `husky` | `^9.1.7` | خطّافات git | النواة §21.2: بوابة ما قبل الدفع |
| `lint-staged` | `^17.6.0` | فحص المُدرَج | تنسيق وفحص ما تغيّر فقط |
| `firebase-tools` | `^15.33.0` | محاكي ونشر | **كاعتمادية تطوير** لتثبيت الإصدار في CI ومحلياً |
| `eslint-config-prettier` | `^10.1.8` | توافق | يُلغي قواعد ESLint المتعارضة مع Prettier |
| `eslint-plugin-jsx-a11y` | `^6.10.2` | إتاحة | المتطلبات §3: `aria`، تسميات، أدوار |
| `@vitest/ui` | `^5.0.3` | تشخيص | اختياري للتطوير |
| `tsx` | `^4.x` | تشغيل سكربتات TS | `scripts/*.ts` |
| `concurrently` | `^9.x` | تشغيل متوازٍ | `dev:emu` |

> **قاعدة مُلزِمة على `firebase-tools`:** يُثبَّت **كاعتمادية تطوير** لا يُعتمد على نسخة مُثبَّتة
> عالمياً. السبب: نسخة المحاكي تؤثر في سلوك تقييم القواعد، واختبار قواعد ينجح محلياً ويفشل في CI
> (أو العكس) بسبب فرق إصدار هو أسوأ أنواع التعطّل — ويضرب مباشرة المتطلبات §25 بند 10.

### 12.4 Prettier و lint-staged و husky

```jsonc
// .prettierrc.json — يطابق النمط القائم في الكود المكتوب فعلاً
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "trailingComma": "all",
  "arrowParens": "always",
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

```jsonc
// package.json → "lint-staged"
{
  "lint-staged": {
    "*.{ts,tsx}":        ["eslint --fix --max-warnings 0", "prettier --write"],
    "*.{json,css,md}":   ["prettier --write"],
    "firestore.rules":   ["prettier --write --parser babel"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged

# .husky/pre-push  — النواة §21.2 حرفياً + حدود الطبقات
npm run typecheck
npm run lint
npm run lint:layers
npm run test:unit
```

**`pre-push` لا يشغّل اختبارات المحاكي عن قصد:** تشغيل المحاكي يستغرق ~20 ثانية، ودفع يستغرق
دقيقة يُغري بـ `--no-verify`. اختبارات القواعد والتكامل مكانها CI حيث **لا يمكن تخطّيها**.
وهذا توزيع واعٍ: السرعة محلياً، الصلابة في CI.

### 12.5 `vitest.config.ts` و `playwright.config.ts`

```ts
// vitest.config.ts
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      {
        test: {
          name: 'unit', environment: 'node', globals: false,
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/vitest.unit.ts'],
        },
      },
      {
        test: {
          name: 'dom', environment: 'jsdom', globals: false,
          include: ['tests/dom/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup/vitest.dom.ts'],
        },
      },
      {
        test: {
          name: 'rules', environment: 'node',
          include: ['tests/rules/**/*.test.ts'],
          setupFiles: ['tests/setup/emulator.ts'],
          // تسلسلي: كل الاختبارات تتشارك مثيل محاكي واحد وتنظيفه بين الحالات
          fileParallelism: false, testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'integration', environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/emulator.ts'],
          fileParallelism: false, testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8', reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/app/boot/screens/**'],
      thresholds: {
        'src/domain/money/**':   { lines: 100, branches: 100, functions: 100 },
        'src/domain/ledger/**':  { lines: 95,  branches: 95,  functions: 95 },
        'src/domain/ops/**':     { lines: 95,  branches: 95,  functions: 95 },
        'src/domain/rules/**':   { lines: 95,  branches: 95,  functions: 95 },
        'src/domain/**':         { lines: 90,  branches: 85,  functions: 90 },
        'src/data/**':           { lines: 70,  branches: 60,  functions: 70 },
      },
    },
  },
})
```

```ts
// playwright.config.ts
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,                 // محاكي واحد مشترك
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ar-LY',
    timezoneId: 'Africa/Tripoli',       // يطابق ADR-033 — وإلا اختلفت حدود الشهر في الاختبار
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile',  use: { ...devices['Pixel 7'] } },
  ],
  /**
   * **المحاكي إلزامي: لا اختبار E2E يلمس مشروعاً حقيقياً أبداً** (المتطلبات §25 بند 11).
   * ومعرّف demo-raseed يجعل ذلك ضماناً تقنياً (§10.2).
   */
  webServer: [
    { command: 'npm run emu', url: 'http://localhost:4000', reuseExistingServer: !process.env.CI,
      timeout: 60_000 },
    { command: 'npm run build -- --mode test && npm run preview', url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
})
```

**المصادقة في E2E:** لا تسجيل دخول Google حقيقي (غير قابل للأتمتة ويخالف شروط Google).
`tests/e2e/fixtures/auth.ts` يُنشئ مستخدماً في **محاكي المصادقة** عبر واجهته الإدارية
(`POST /identitytoolkit.googleapis.com/v1/accounts:signUp`) بـ `localId` يساوي
`VITE_OWNER_UID` في `.env.test`، ثم يحفظ `storageState` ويُعاد استخدامه في كل الاختبارات.

### 12.6 ADR-037 — CI و النشر

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run lint:layers          # شبكة أمان حدود الطبقات (§4.4)
      - run: npm run typecheck

  unit:
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run test:coverage        # يفشل عند هبوط التغطية عن العتبات (§12.1)
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }

  emulator:
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - uses: actions/setup-java@v4       # محاكي Firestore يحتاج JVM
        with: { distribution: 'temurin', java-version: '21' }
      - run: npm ci
      - run: npm run test:rules           # T-RULES-* — بما فيها عيب الأسبقية ع-أ-1
      - run: npm run test:integration     # T-IDEM · T-CONC · T-VOID · T-REBUILD · T-SETTLE-LINK

  e2e:
    runs-on: ubuntu-latest
    needs: [unit, emulator]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '21' }
      - run: npm ci
      - run: npm run e2e:install
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }

  build:
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run build
        env:
          VITE_FIREBASE_API_KEY:             ${{ vars.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN:         ${{ vars.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID:          ${{ vars.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET:      ${{ vars.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ vars.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID:              ${{ vars.VITE_FIREBASE_APP_ID }}
          VITE_OWNER_EMAIL:                  ${{ vars.VITE_OWNER_EMAIL }}
          VITE_OWNER_UID:                    ${{ vars.VITE_OWNER_UID }}
          VITE_USE_EMULATORS:                'false'
          VITE_APP_VERSION:                  ${{ github.sha }}
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/ }
```

**النشر في ملف منفصل ولا يعمل تلقائياً** (المتطلبات §25 بند 11):

```yaml
# .github/workflows/deploy.yml
name: Deploy
on: { workflow_dispatch: { inputs: { target: { type: choice, options: [hosting, rules, indexes, all] } } } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production        # ← يتطلب موافقة يدوية في إعدادات المستودع
    steps: [ ... npm ci · npm run verify · firebase deploy --only <target> ... ]
```

**ثلاثة قرارات على CI:**

1. **مفاتيح Firebase في `vars` لا `secrets`.** هي معرّفات عامة (§10.1)، ووضعها في `secrets`
   يُوهم بأنها أسرار فيُبنى على ذلك الوهم قرار أمني خاطئ لاحقاً. السرّ الوحيد هو حساب خدمة النشر.
2. **النشر `workflow_dispatch` + بيئة محمية.** المتطلبات §25 بند 11: لا نشر إنتاجي قبل مراجعة
   الأثر والموافقة. والنشر التلقائي على `main` يخالف ذلك نصّاً.
3. **نشر القواعد خطوة مستقلة.** النواة §22.2 سؤال 1: `allowedUids()` يحتاج UID المالك، ولا
   تُنشر القواعد قبل قراره. وخطأ في القواعد يُعطِّل النظام كلياً ⇒ تُنشر وحدها ويُتحقَّق منها فوراً.

---

## 13. RTL والسمات والأداء

### 13.1 RTL حقيقي — بنيوي لا مقلوب

> **المتطلبات §3 تُلزم بـ «RTL حقيقي في كل الصفحات والجداول والقوائم والنوافذ».
> «حقيقي» تعني: التصميم مبني على خصائص منطقية، لا تصميماً LTR مُقلوباً بـ `direction: rtl`.**

| البند | القرار |
|---|---|
| `<html lang="ar" dir="rtl">` | ثابت في `index.html` — **لا تبديل اتجاه في الإصدار الأول** (لا تعدد لغات) |
| الخصائص | **المنطقية حصراً:** `margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `border-inline-start`, `text-align: start` |
| أصناف Tailwind | `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s-*`, `border-e-*` |
| الفيزيائية (`ml`, `mr`, `pl`, `pr`, `left`, `right`, `text-left`, `text-right`) | **خطأ بناء (B13)** |
| الأيقونات الاتجاهية | سهم «التالي» يُقلب بـ `rtl:-scale-x-100`؛ أيقونات غير اتجاهية (قلم، سلة) **لا تُقلب** |
| **الأرقام** | **لاتينية في كل مكان (ق-3)**، مع `font-variant-numeric: tabular-nums` في كل خلية مالية |
| اتجاه المبالغ | المبلغ كتلة `dir="ltr"` داخل نص عربي حتى لا يتشوّه ترتيب `1,250.500` بخلط الاتجاهات |
| الجداول | `text-align: start` افتراضاً، والأعمدة المالية `text-align: end` + `tabular-nums` |
| المخططات | المحور الأفقي يبدأ من **اليمين** (ترتيب زمني RTL) — إعداد صريح في كل مخطط |

```css
/* index.css — مقتطف مُلزِم */
@font-face {
  font-family: 'IBM Plex Sans Arabic';
  src: url('/fonts/IBMPlexSansArabic-Regular.woff2') format('woff2');
  font-weight: 400; font-display: swap;
}
:root {
  --font-ar: 'IBM Plex Sans Arabic', system-ui, sans-serif;
  /* ق-3: الأرقام اللاتينية مع محاذاة جدولية — شرط قراءة الأعمدة المالية */
  --num: tabular-nums;
}
.money, td.numeric, th.numeric {
  font-variant-numeric: var(--num);
  direction: ltr;              /* المبلغ وحده LTR داخل سياق RTL */
  text-align: end;
}
```

**ADR-035 — الخط مستضاف محلياً لا من Google Fonts.** ثلاثة أسباب: (أ) يعمل **دون اتصال**
وهو مطلب صريح (§22)؛ (ب) لا طلب لطرف ثالث ⇒ `font-src 'self'` في CSP يبقى مغلقاً و**لا تسريب
لعنوان IP** لكل زيارة (الخصوصية §20)؛ (ج) `IBM Plex Sans Arabic` يوفّر أرقاماً جدولية
(`tnum`) وهي شرط تقني لـ ق-3، وليست متاحة في كل الخطوط العربية.

### 13.2 السمات — فاتح وداكن

```css
/* Tailwind 4: المتغيّر لا الصنف — لأن السمة تُقرأ من data-theme على <html> */
@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));
```

| القرار | التفصيل |
|---|---|
| المصدر | `data-theme="light" | "dark"` على `<html>`، يُكتب من `ThemeProvider` |
| التفضيل | `'light' | 'dark' | 'system'` في `settings/app` (مزامن بين الأجهزة — §21) ومرآته في `themeStore` |
| وميض السمة (FOUC) | **سكربت مضمَّن صغير في `index.html`** يقرأ `localStorage` ويضع `data-theme` **قبل** أول رسم. وهذا الاستثناء الوحيد المسموح لتخزين تفضيل في `localStorage` |
| الألوان | رموز دلالية فقط (`--color-surface`, `--color-text`, `--color-positive`, `--color-negative`, `--color-warning`) — **لا لون حرفي في أي مكوّن** |
| الدلالة المالية | **الموجب والسالب لا يُفرَّقان باللون وحده**: إشارة + أيقونة + نص (`+` / `−`) — شرط إتاحة لعمى الألوان، ويُفحَص بـ axe |
| التباين | ≥ 4.5:1 للنص العادي و3:1 للكبير، **في السمتين**، مُختبَر آلياً في `rtl-a11y.spec.ts` |

### 13.3 المخططات — SVG داخلي بلا مكتبة

**القرار: مكوّنات مخططات مكتوبة في `ui/charts` بـ SVG، بلا Recharts/Chart.js/D3.**

| السبب | التفصيل |
|---|---|
| **الحجم** | ثلاثة أنواع مخططات فقط مطلوبة (أعمدة، خط، دائري — §4). مكتبة كاملة = 40–120KB لثلاثة أشكال |
| **RTL** | مكتبات المخططات تفترض LTR؛ قلب المحاور والتسميات فيها عملية ترقيع مستمرة مع كل ترقية |
| **الأرقام** | ق-3 يُلزم بأرقام لاتينية و`formatLYD`؛ المكتبات تُنسِّق داخلياً فتحتاج تجاوزاً في كل محور وتلميح |
| **التحكّم** | التلميح والتركيز ولوحة المفاتيح (إتاحة §3) تحت سيطرتنا مباشرة |

**الثمن المعلن:** لا مخططات متقدمة (شلال، شمعدان، تكبير وتحريك). عند الحاجة الحقيقية إلى واحد
منها، تُضاف مكتبة **لتلك الشاشة وحدها** بتحميل كسول — لا للنظام كله.

### 13.4 الأداء — القرارات القابلة للقياس

| البند | القرار | الأثر المقيس |
|---|---|---|
| تقسيم الحزمة | مسار لكل ميزة + حزمتا `firebase` و`react` منفصلتان (قائم في `vite.config.ts`) | الحزمة الأولى = القوقعة + المصادقة + اللوحة |
| قراءات أول فتحة | اشتراك `accounts` واحد (~45) + `periods` + `budgetPeriods` + قوائم محدودة ⇒ **≈120 قراءة** (النواة §15.3) | ~410 فتحة باردة/يوم على Spark |
| الفتحات التالية في الجلسة | **0–5 قراءات** — السجل يحفظ الاشتراكات (§6.4) | — |
| كشف الحركة | `useInfiniteQuery` بـ 25 صفّاً/صفحة و`startAfter` | 25 قراءة/صفحة |
| التقارير | `getAggregateFromServer(sum)` على `postings` | **قراءتان** لأي بُعد |
| الأشهر المنتهية | تُخزَّن محلياً بعد أول قراءة (**لا تتغيّر أبداً**) ⇒ `gcTime` طويل لمفاتيحها | 11 قراءة مرة واحدة |
| إعادة التصيير | `select` في TanStack Query (بذاكرة مؤقتة) + `useShallow` لـ Zustand + `React.memo` للصفوف | لقطة واحدة ⇒ تصيير واحد |
| القوائم الطويلة | **لا محاكاة افتراضية (virtualization) في الإصدار الأول** — الصفحات 25 صفّاً. العتبة المعلنة: إن احتاجت شاشة > 200 صفّاً مرئياً، يُضاف `@tanstack/react-virtual` لتلك الشاشة | — |
| الصور | لا صور مستخدم (المرفقات مؤجَّلة — ق-1). صورة الملف من Google بـ `loading="lazy"` | — |
| ميزانية الأداء | LCP < 2.5s و TBT < 200ms على 4G متوسط، **مقيسة في CI** عبر Lighthouse على `preview` | بوابة تحذير لا فشل في الإصدار الأول |

---

## 14. ثغرات مكتشفة في العقد تخصّ هذه الطبقة

> النواة §22 تطلب: «إن وجدت فيها ثغرة تخص مجالك، اذكرها واقترح الحل، لكن لا تغيّر الملف».
> هذه هي الثغرات التي ظهرت عند تفصيل **طبقة البيانات والواجهة**. لم أعدّل النواة ولا أي ملف آخر.

### 14.1 انحرافات قائمة في الكود عن نص النواة — موقفي من كل واحدة

| # | الانحراف | موقفي | يحتاج إقرار؟ |
|---|---|---|---|
| **د-1** | النواة §21.1 تسمّي `money/Minor.ts`، والكود كتب `money/types.ts` (يحمل `Minor` و`Bps` والثوابت) | **أُقِرّه.** ملف واحد لبدائيات المال أصحّ من ملف باسم نوع يحمل خمسة أنواع. **توصية: تُحدَّث §21.1 في النواة لتطابق الكود** | لا — تسمية |
| **د-2** | النواة §21.1 تذكر `domain`/`data`/`ui` فقط؛ هذه الوثيقة تضيف `app`/`features`/`stores`/`lib` | **توسيع لا نقض.** النواة لم تتناول قوقعة التطبيق، والمنطق المحاسبي يبقى حصراً في `domain` | لا |
| **د-3** | النواة ADR-018 تنصّ على `eslint-plugin-boundaries`؛ الكود رفضها لثغرات أمنية في اعتمادياتها | **أُقِرّ الرفض** وأُثبِّته في ADR-025 بنفس الفرض وبصفر ثغرات | لا — مبرَّر وموثَّق |
| **د-4** | النواة §4.3 تقول `bookedAt` «بتوقيت المستخدم المحلي»؛ الكود يفرض `Africa/Tripoli` ثابتاً | **أُقِرّ التثبيت** (ADR-033) لأن `periodKey` محفور على قيد غير قابل للتغيير، وتوقيت المتصفح يُنتج ملخّصين متناقضين لنفس اللحظة | **نعم — §16.2 سؤال 1** |
| **د-5** | النواة §21.2 B4 تمنع `*` و`/` على `Minor`؛ الكود منع `Math.round/floor/ceil/trunc` فقط | **ناقص.** يُستكمل بمحدِّد على عمليات الضرب/القسمة خارج `domain/money/**` — مُدرَج في §4.4 | لا — إكمال |

### 14.2 ثغرات في قواعد الأمان (النواة §14.3) تحجب طبقة البيانات

> **هذه ليست ملاحظات أسلوبية: كل واحدة منها تمنع عملية مشروعة من النجاح، وتظهر كـ
> `permission-denied` غامض. وهي من **نفس صنف** العيب ع-أ-9 الذي عالجته النواة بنفسها
> («لا `match` لمجموعات المُجمَّعات ⇒ كل `postOperation` يفشل»). لم أعدّل أي قاعدة.**

**حالة المراجعة:** قارنتُ كل ثغرة بـ **`docs/design/04-security.md`** القائم (مسوّدة وحدة الأمان
المتوازية)، لا بنصّ النواة §14.3 وحده. النتيجة: **ثلاث ثغرات عُولجت هناك، وواحدة التقت مع
قراري ADR-034، وواحدة ما زالت قائمة.**

| # | الثغرة | السيناريو الذي يفشل | الحالة بعد مقارنة `04-security.md` |
|---|---|---|---|
| **ق-1** | **لا `match` لمجموعات غير مالية مطلوبة:** `tasks` (§14)، `notes` (§13)، `worshipRecords`/`quranProgress`/`zakatRecords` (§15) — غائبة في النواة §14.3، والافتراضي `allow write: if false` | المفكرة والمهام والعبادات **غير قابلة للكتابة** ⇒ أربع وحدات لا تعمل | **✅ مُعالَجة في `04-security.md`:** يحتوي `match` لـ `notes`, `notebooks`, `tasks`, `taskLists`, `reminders`, `worshipRecords`, `quranProgress`, `zakatRecords`, `attachments`. **أرفع الملاحظة إلى النواة فقط:** §14.3 فيها ناقصة ويجب أن تُحيل إلى `04-security.md` كمرجع القواعد المعتمد، وإلا قرأها مطوّر لاحق كالقائمة الكاملة |
| **ق-2** | **`periods/{pk}` تشترط وجود `householdExpenseMinor`** (`isNonNegMoney(...)` + `<= totalExpenseMinor`)، و§12.1 في النواة لا تكتب الحقل إلا للقيود الموسومة `household` | **أول مصروف غير منزلي في كل شهر يُرفَض** — أكثر العمليات شيوعاً | **⚠️ التقاء مؤكَّد، والحلّ في طبقتي:** `04-security.md` فصل `create` عن `update` (فأزال خطأ التقييم)، لكنه **ما زال يشترط حضور الحقل في `create`**. ⇒ **ADR-034 ليس تحسيناً بل شرط صحة:** مُشفِّر `periodDelta` في `data/ledger/writers` **يكتب دائماً مجموعة الحقول العددية كاملة** بـ `increment(0)` لغير المتأثر. **بدونه ترفض القواعد أول عملية في كل شهر** |
| **ق-3** | ترتيب `||` في `accountPeriods` يُقيَّم خطأً عند الإنشاء (`resource.data` على مستند غير موجود) | أول حركة على أي (حساب، شهر) تُرفَض | **✅ مُعالَجة:** `04-security.md` فصل `allow create` عن `allow update` ⇒ لا وصول إلى `resource` في مسار الإنشاء |
| **ق-4** | نفس العيب في `obligations` (`resource.data.keys()` على `create`) | إنشاء أي التزام يُرفَض | **✅ مُعالَجة** بنفس الفصل |
| **ق-5** | **`accounts` مسار تحديث واحد يشترط `balanceVersion > resource.data.balanceVersion`** ويفرض `balanceMinor` مشتقاً. فتعديل **غير مالي** (`name`, `sortOrder`, `icon`, `colorToken`, `notes`) يُجبَر على تقديم `balanceVersion` | تعديل اسم حساب **يُلوِّث عدّاداً دلالته «تغيّر الرصيد»** ⇒ يفقد `balanceVersion` قيمته في كشف التحديثات المفقودة (النواة §4.2)، وهي الوظيفة الوحيدة التي بُرِّر بها الحقل | **❌ ما زالت قائمة في `04-security.md` (السطر ~729).** المقترح: مساران منفصلان — مسار وصفي بـ `touchedOnly(['name','nameLower','sortOrder','icon','colorToken','notes','updatedAt'])` **بلا** شرط `balanceVersion` ولا شرط I3، ومسار مالي بالشروط الكاملة الحالية. **أرفعه لوحدة الأمان** |
| **ق-6** | `attachments` مؤجَّلة (ق-1) لكن الحقل في المخطط | لا أثر الآن (الواجهة معطَّلة) | **✅ `04-security.md` يحتوي `match /attachments`** — يبقى التأكّد أنه بمنع كامل حتى Blaze |

**ملاحظة منهجية تبقى صالحة ومهمة:** ق-2 وق-3 وق-4 كانت من **نمط واحد**: الوصول إلى
`resource.data` في قاعدة تخدم `create` و`update` معاً، وهو خطأ **تقييم** لا خطأ منطق — فترفض
القواعد العملية برسالة لا تشرح شيئاً. ولأن النمط متكرر، أقترح على وحدة الأمان **فحصاً جدولياً
إلزامياً:** لكل مجموعة، اختبار `create` على مستند **غير موجود** واختبار `update` على مستند قائم.
وهذا يطابق `tests/rules/**` في §5.1، وأُدرجه في `tests/rules/periods.rules.test.ts` تحديداً
لأن ق-2 يمسّ أكثر العمليات تكراراً.

### 14.3 ثغرة في النواة تخصّ الواجهة

| # | الثغرة | المقترح |
|---|---|---|
| **ن-1** | النواة §23 تُعرِّف `selectors` وتذكر `monthIncomeMinor` وغيرها، لكنها **لا تحدّد سياسة عرض عند فشل القراءة أو قِدَم الكاش**. وهذا أثر مباشر على «لا شاشة بلا مصدر بيانات» (§25 بند 5) | **§8.4 و§9.3 في هذه الوثيقة يملآن الفراغ:** فشل فكّ ترميز إسقاط مالي = حاجب؛ وكل رقم مالي يحمل حالة نضارة. **يُرفَع للمالك في §16.2 سؤال 3** |
| **ن-2** | النواة ADR-007 تنصّ على استبعاد `pendingCommands` من كل رصيد وتقرير، ولا تحدّد **كيف تُعرَض** إن تجاوزت العشرات بعد انقطاع طويل | طابور مُرقَّم بشاشة مستقلة (`features/transactions/components/PendingSyncList`) مع عدّاد في الشريط العلوي، وتفريغ تسلسلي بشريط تقدّم. ولا عرض لمبالغها مجموعةً — **عدد فقط** حتى لا يُقرأ كرصيد |
| **ن-3** | النواة §20 تُلزم باختبار «التصفح على الهاتف والحاسوب» و«اللغة العربية واتجاه RTL» دون تحديد الأداة | `tests/e2e/responsive.spec.ts` و`rtl-a11y.spec.ts` بـ Playwright + axe على مقاسَي `Pixel 7` و`1440×900` (§12.5) |

---

## 15. مصفوفة تتبّع المتطلبات

**كل قسم في `00-REQUIREMENTS.md` ⇒ أين يُنفَّذ في هذه المعمارية.**

| § | المتطلب | الميزة | المنطق | البيانات |
|---|---|---|---|---|
| 1 | الرؤية: عملية واحدة تنعكس في كل مكان | — | `domain/ops/plan.ts` + معاملة ذرّية | `data/ledger/postOperation` |
| 2 | البنية التقنية وفصل المنطق | — | ADR-023 · §4 (الطبقات) | §4.3 |
| 3 | الهوية البصرية و RTL والسمات | `ui/**` | §13.1–13.2 | — |
| 4 | لوحة التحكم | `features/dashboard` | `domain/selectors/dashboard.ts` | `qk.accounts` · `qk.period` · `qk.budgetPeriod` |
| 5 | الحسابات والأرصدة والتحويل | `features/accounts` | `domain/ledger/balances.ts` · `ops/plans/transfer` | `accountRepo` |
| 6 | المصروفات والفئات والتكرار | `features/transactions` · `features/categories` | `ops/plans/expense` · `recurrence/**` | `entryRepo` · `categoryRepo` · `recurrenceRepo` |
| 7 | الدخل والمتوقَّع مقابل المستلم | `features/transactions` | `ops/plans/income` | `entryRepo` · `incomeSchedules` |
| 8 | الالتزامات والسداد الجزئي والتنبيهات | `features/obligations` | `ops/plans/payObligation` · `rules/status.ts` | `obligationRepo` |
| 9 | الديون عليّ | `features/debts/payable` | `ops/plans/payDebt` | `debtRepo` |
| 10 | الديون لي والمتابعات | `features/debts/receivable` | `ops/plans/collectDebt` · `writeOffDebt` | `debtRepo` + `followUps` |
| 11 | مصاريف المنزل بلا ازدواج | `features/household` | `selectors/household.ts` (مجموع فرعي) | **نفس القيود — استعلام مُصفّى** |
| 12 | الميزانيات والأهداف والتوقعات | `features/budgets` · `goals` · `planning` | `selectors/budget.ts` · `goals.ts` | `budgetRepo` · `goalRepo` |
| 13 | المفكرة | `features/notes` | `domain/notes/search.ts` | `noteRepo` — **تحتاج قاعدة أمان (§14.2 ق-1)** |
| 14 | المهام والتذكيرات | `features/tasks` | `domain/tasks/recurring.ts` · `rules/status.ts` | `taskRepo` — **تحتاج قاعدة أمان** |
| 15 | العبادات والزكاة | `features/worship` | `domain/worship/**` (`mulRate` بـ BigInt) | `worshipRepo` · `zakatRepo` — **تحتاج قاعدة أمان** |
| 16 | التقارير والتصدير | `features/reports` | `domain/reports/**` | `aggregateRepo` (`sum`/`count`) |
| 17 | التنبيهات الذكية بلا تكرار | `features/notifications` | `domain/notify/{generate,dedupe}.ts` | `notificationRepo` |
| 18 | مخطط قاعدة البيانات والثوابت | — | **النواة §4 و§13** | `data/codecs/**` (فحص الثوابت عند القراءة §8.3) |
| 19 | قواعد الأعمال والمحاسبة | — | **النواة §9 (R1…R11)** | — |
| 20 | الأمن والخصوصية والنسخ | `features/backup` · `integrity` | §10.1 (المفاتيح) · §11.2 (الجلسات) | `firestore.rules` · `data/export/**` |
| 21 | الإعدادات الشخصية | `features/settings` | `domain/contracts/settings.ts` | `settingsRepo` |
| 22 | الأداء والمزامنة ودون اتصال | — | §13.4 · §9 | `data/live/**` · `data/outbox/**` |
| 23 | الاختبارات | — | §12.1 | `tests/**` |
| 24 | خطة التنفيذ بالمراحل | — | **هذه الوثيقة = المرحلة 1 (التحليل والتأسيس)** | — |
| 25 | التعليمات التنفيذية الإلزامية | — | §2 (فحص القائم) · §4.4 (لا تكرار منطق) · §7 (لا إخفاء أخطاء) · §10.1 (لا أسرار) | — |
| 26 | المخرجات المطلوبة | — | هذه الوثيقة + `docs/design/03,04,05` + `docs/ops/**` | — |

**ثلاث فجوات معلنة في التغطية** (لا شيء منها خفيّ):

1. **الوحدات §13 و§14 و§15 لا قواعد أمان لها** في النواة §14.3 ⇒ غير قابلة للكتابة حتى تُضاف
   (§14.2 ق-1). **الكود لا يُكتب لها قبل ذلك**، وإلا بُنيت شاشات ترفض الحفظ.
2. **المرفقات (§6 و§18)** مؤجَّلة بق-1: الحقل في المخطط والواجهة معطَّلة بوسم «يتطلب ترقية».
3. **مواقيت الصلاة (§15 بند 1)** مؤجَّلة: المتطلبات نفسها تمنع «أوقات ثابتة أو تقديرية غير
   موثوقة»، وحسابها يحتاج مصدراً موثوقاً أو مكتبة فلكية — قرار مستقل لا يدخل المعمارية.

---

## 16. فهرس ADR وما بقي للمالك

### 16.1 سجل القرارات المعمارية — تكملة لترقيم النواة

تُنشأ كملفات مستقلة في `docs/adr/ADR-0NN-*.md`، كل واحد بالسياق والقرار والبدائل المرفوضة
والنتائج و«كيف نعرف أننا أخطأنا».

| # | القرار | القسم | الحالة |
|---|---|---|---|
| ADR-023 | **Vite 8 + React 19 + TS 6 كـ SPA**؛ رفض Next.js بـ SSR و`export` و Remix و TanStack Start | §3 | **معتمد** |
| ADR-024 | **سبع طبقات** `app → features → {stores, data, ui} → domain → lib` بمصفوفة استيراد صريحة | §4.1–4.2 | **معتمد** |
| ADR-025 | الفرض بقواعد ESLint الأصلية + `verify-layers.mjs`؛ **رفض `eslint-plugin-boundaries`** لثغرات اعتمادياتها | §4.4 | **معتمد** — يُثبِّت انحراف ADR-018 |
| ADR-026 | TanStack Query للخادم + Zustand للمحلي؛ رفض Redux و XState | §6.1 | **معتمد** |
| ADR-027 | **سجل اشتراكات حيّة بعدّاد مراجع** ومهلة سماح 30ث، يكتب بـ `setQueryData` | §6.4–6.5 | **معتمد** |
| ADR-028 | `AppError` مغلّف واحد بـ `messageAr`، والتحويل **نقي في `domain/errors`** | §7.2–7.3 | **معتمد** |
| ADR-029 | **Zod على حدّين**؛ المخططات في `domain/contracts` مشتركة؛ مخطط قراءة متسامح + صارم | §8 | **معتمد** |
| ADR-030 | **`persistentLocalCache` + `persistentMultipleTabManager` + سقف 40MB**؛ والكتابة لا تقرأ الكاش أبداً | §9.2–9.3 | **معتمد** |
| ADR-031 | عامل خدمة للقوقعة فقط، **`runtimeCaching: []`**، وتحديث قسري عند `schemaAhead` | §9.4 | **معتمد** |
| ADR-032 | `apiKey` ليس سرّاً **ويجب تقييده**؛ التحقق من البيئة بـ Zod وفشل سريع؛ UID في القواعد لا في البيئة | §10 | **معتمد** |
| ADR-033 | **`Africa/Tripoli` ثابتاً** لـ `DateKey`/`periodKey` — تضييق لنص النواة §4.3 | §11.5 | **معتمد مع رفع للمالك** |
| ADR-034 | **`periods` و`accountPeriods` تُكتبان بمجموعة الحقول العددية كاملة** (`increment(0)` لغير المتأثر) | §14.2 ق-2 | **معتمد** |
| ADR-035 | خط عربي مستضاف محلياً بأرقام جدولية؛ لا Google Fonts | §13.1 | **معتمد** |
| ADR-036 | طوبولوجيا الاختبار بأربعة مشاريع Vitest + Playwright على المحاكي حصراً | §12.1 · §12.5 | **معتمد** |
| ADR-037 | بوابة `verify` واحدة محلياً و CI؛ **النشر يدوي ببيئة محمية**؛ القواعد تُنشر وحدها | §12.6 | **معتمد** |
| ADR-038 | **تسلسل الإقلاع والبوابات الست** بترتيب مُلزِم، ثم مهام ما بعد الإقلاع | §11.4 | **معتمد** |
| ADR-039 | **لا مبالغ في المتاجر المحلية** (B14) | §6.1 | **معتمد** |
| ADR-040 | `react-router` كموجِّه متصفح بـ `lazy`، **بلا `loader` يجلب بيانات** | §11.1 | **معتمد** |

### 16.2 ما بقي يحتاج قرار المالك

| # | السؤال | الأثر |
|---|---|---|
| **1** | **تثبيت التاريخ المحاسبي على توقيت طرابلس (UTC+2) بدل توقيت الجهاز** (ADR-033). النتيجة: سجلتَ عملية من خارج ليبيا، فالتاريخ المحاسبي يبقى بتوقيت ليبيا لا بتوقيتك المحلي. البديل (توقيت الجهاز) يُنتج ملخّصين شهريين مختلفين لنفس العملية بين جهازين — وهو ما أرفضه هندسياً | يمسّ `bookedAt` و`periodKey` على قيود **غير قابلة للتغيير**. **القرار قبل أول قيد، لا بعده** |
| **2** | **مصير الوحدات غير المالية بلا قواعد أمان** (§14.2 ق-1): المفكرة (§13)، المهام (§14)، العبادات (§15). أُوقف بناء شاشاتها حتى تُضاف القواعد، أم تُبنى بالتوازي على أن تُنشر القواعد قبل التسليم؟ | أربع وحدات من المتطلبات. موقفي: **لا كود قبل القواعد** — شاشة ترفض الحفظ أسوأ من شاشة غير موجودة |
| **3** | **سياسة فشل فكّ ترميز مستند مالي** (§8.4): مستند تالف واحد **يُعطِّل تسجيل العمليات** حتى إعادة البناء. البديل (الاستمرار واستبعاد التالف) **أرفضه** لأنه يعرض رقماً خاطئاً بثقة | يحدد سلوك التطبيق في أسوأ الحالات. أوصي بالتعطيل الصارم |
| **4** | **عمق سجل الأخطاء ومحتواه** (§7.6): 300 مُدخَل محلي **يحتوي مبالغ ومعرّفات** (لازمة للتشخيص). مقبول؟ أم بلا مبالغ مع تشخيص أضعف؟ | يمسّ الخصوصية عند مشاركة ملف السجل |
| **5** | **التحديث القسري عند تقدّم نسخة البيانات** (§9.4): شاشة غير قابلة للتجاهل تُعيد التحميل تلقائياً. البديل (مطالبة قابلة للتجاهل) يُبقي جهازاً يعرض شاشات تعمل وأزراراً ترفض | تجربة الاستخدام عند النشر من جهاز ثانٍ |
| **6** | **حذف الملاحظات والمهام:** كل المجموعات المالية `delete: if false`. هل تُسمح بالحذف الفعلي للملاحظات والمهام، أم الأرشفة فقط اتساقاً مع بقية النظام؟ | يمسّ قواعد الأمان وواجهتَي §13 و§14 |
| **7** | **ميزانية الأداء كبوابة:** يفشل CI عند LCP > 2.5s، أم تحذير فقط في الإصدار الأول؟ | صرامة CI |

---

## 17. خلاصة العقد المعماري

1. **SPA بـ Vite + React 19 + TS**، ينشر ملفات ساكنة؛ لا خادم، ولا SSR بلا قيمة (ADR-023).
2. **سبع طبقات باتجاه واحد**، `domain` نقية و`data` وحدها تلمس Firestore، والحدود **مفروضة
   بأداة البناء** بستة عشر قاعدة لا بمراجعة الكود.
3. **TanStack Query للخادم، Zustand للمحلي، ولا مبلغ في متجر محلي.**
4. **اشتراك حيّ واحد لكل مفتاح** بعدّاد مراجع ومهلة سماح — يقتل الازدواج والتسريب و`StrictMode`.
5. **`AppError` واحد** برسالة عربية جاهزة، ولكل صنف خطأ **قناة عرض واحدة**، وكل خطأ يُسجَّل.
6. **Zod على حدّين فقط**، بمخططات مشتركة، وفحص الثوابت I3/I5/I6/I22 **عند القراءة أيضاً**.
7. **الكاش الدائم مُفعَّل بأمان**، لأن كل قرار مالي داخل `runTransaction` خادمي حتماً؛
   والخطر الوحيد (عرض رقم قديم) يُعالَج بوسم نضارة على **كل** رقم مالي.
8. **لا تحديث متفائل لأي رقم مالي**، ولا تخزين مؤقت لبيانات Firestore في عامل الخدمة.
9. **`apiKey` ليس سرّاً ومقيَّد؛ والإغلاق على UID المالك في القواعد لا في الواجهة.**
10. **بوابات إقلاع ست بترتيب مُلزِم**، وبوابة `verify` واحدة محلياً و CI، ونشر يدوي بموافقة.

> **هذه الوثيقة تخدم النواة المحاسبية ولا تنافسها.** أي تعارض بينهما = عيب في هذه الوثيقة
> يُصلَح لصالح النواة. وأي تغيير هنا يحتاج ADR جديداً.
