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
│  │  ├─ 01-financial-core.md          ★ قائم — العقد المحاسبي
│  │  ├─ 02-architecture.md            ★ هذه الوثيقة
│  │  ├─ 03-security-rules.md           قواعد Firestore/Storage والفهارس (وحدة أخرى)
│  │  ├─ 04-design-system.md            نظام التصميم والهوية البصرية (وحدة أخرى)
│  │  ├─ 05-data-model.md               مخطط المجموعات غير المالية (وحدة أخرى)
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
