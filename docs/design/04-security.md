<div dir="rtl">

# الأمان والخصوصية — رصيد | RASEED

> **حالة الوثيقة:** تصميم مُكتمل، قابل للنشر بعد اختبار المحاكي وموافقة المالك.
> **المرجع المُلزِم:** `docs/00-REQUIREMENTS.md` (القسم 20 خاصة)، `docs/01-OWNER-DECISIONS.md` (ق-1، ق-2، ق-3)،
> `docs/design/01-financial-core.md` (القسم 14 خاصة — **عقد مُلزِم لا يُعاد تعريفه هنا**).
> **المشروع:** `raseed-2fac1` — خطة Spark. **المالك:** محمد إبراهيم البرشي — `albarshi.96@gmail.com`.

---

## 1. الملخص التنفيذي

### 1.1 القرارات المعتمدة في سطر واحد لكل قرار

| # | القرار | البديل المرفوض | سبب الرفض |
|---|---|---|---|
| **أ-1** | **الإغلاق في القواعد على UID واحد** (`uid in allowedUids()`)، لا على البريد ولا على الواجهة | `isOwner = request.auth.uid == uid` وحده | يسمح لأي شخص يسجّل بحساب Google بإنشاء شجرته تحت `users/{uidهو}` والكتابة فيها — **خرق مباشر لق-2** (مُشخَّص في 14.1 من النواة) |
| **أ-2** | مزوّد وحيد **Google Sign-In**، وبقية المزوّدين مُعطَّلة في Console | Email/Password | ق-2 مُلزِم؛ ويُضيف سطح هجوم (كلمة مرور تُسرَّب/تُنسى، تدفق إعادة التعيين، حاجة إلى تحقق البريد) بلا أي مكسب لمستخدم واحد |
| **أ-3** | **منع إنشاء الحسابات الجديدة** بعد تثبيت UID المالك: إيقاف `Enable create (sign-up)` + تقليص `Authorized domains` + القواعد المغلقة | الاعتماد على القواعد وحدها | القواعد تكفي لمنع الوصول للبيانات، لكنها لا تمنع تضخّم جدول المستخدمين ولا استهلاك حصص المصادقة. طبقتان أرخص من طبقة واحدة |
| **أ-4** | **حارس حداثة المصادقة في القواعد** (`auth_time` ≤ 10 دقائق) على العمليات المدمِّرة فقط: إقفال فترة، تشغيل إعادة البناء، إضافة UID احتياطي | إعادة مصادقة في الواجهة فقط | «عدم اعتبار إخفاء عناصر الواجهة حماية» (القسم 20). الواجهة قابلة للتجاوز؛ الحارس في القواعد لا |
| **أ-5** | **المرفقات غير قابلة للحذف** في Storage (`allow delete: if false`) | السماح بالحذف | الحذف يُنتج مرجعاً معلّقاً في قيد غير قابل للتغيير، **ويسمح بإتلاف إثبات سجل مالي**. الفصل: «فكّ الربط» في Firestore، والملف يبقى |
| **أ-6** | **حد 5MB** للمرفق و4 أنواع MIME فقط | 10MB (كما ورد في طلب المهمة) | **النواة (14.5) نصّت على 5MB وهي العقد المُلزِم.** مذكور في الأسئلة المفتوحة كطلب تغيير صريح لا كقرار منّي |
| **أ-7** | **تأجيل App Check** مع توثيق سبب التأجيل وشرط إعادة النظر | تفعيله الآن | القيمة الحدّية شبه صفرية مع نظام مغلق على UID واحد، والتكلفة حقيقية: مزوّد reCAPTCHA Enterprise يحتاج تحقّقاً من توافقه مع مشروع بلا فاتورة، + رموز تصحيح لكل جهاز وCI، + خطر إغلاق المالك خارج تطبيقه |
| **أ-8** | **تقييد مفتاح API بـ HTTP referrers + تقييد APIs** — مع إعلان صريح أنه **ضبط حصص لا حدّ أمني** | اعتباره حماية | ترويسة `Referer` قابلة للتلفيق؛ ومفتاح Firebase للويب **عام بالتصميم**. الحماية الحقيقية في القواعد وحدها |
| **أ-9** | **التصدير اليدوي JSON بلا تشفير افتراضياً** + تحذير صريح + خيار تشفير AES-GCM | تشفير إلزامي | النسخة الاحتياطية **الوحيدة** على Spark (ق-1)؛ ونسخة مشفّرة بعبارة مرور منسيّة = لا نسخة احتياطية. الخطر المُعلَن: الملف يحمل بيانات شخصية |
| **أ-10** | **الاستعادة تستورد الدفتر فقط ثم تُعيد البناء** | استيراد المُجمَّعات | عقد النواة 17.3: المُجمَّعات مشتقة، واستيرادها يُدخل انحرافاً لا يكشفه ميزان المراجعة |
| **أ-11** | «الخروج من كل الأجهزة» = **سكربت محلي بـ Admin SDK** (`revokeRefreshTokens`) + بديل بلا مفتاح: تعطيل المستخدم من Console | وعد بزر في التطبيق | إبطال رموز التحديث يحتاج صلاحية إدارية؛ وضعها في الواجهة = وضع سرّ إداري في الواجهة (القسم 25 بند 9). **لا زر كاذب** |

### 1.2 ثلاثة عيوب حقيقية اكتُشفت في مسوّدة القواعد (النواة 14.3) — مُشخَّصة بالتفصيل في القسم 7

1. **ع-أمن-1 (قاتل، يُوقف النظام):** في `accountPeriods` و`obligations` تُقرأ `resource.data` داخل تعبير **يُقيَّم أيضاً عند الإنشاء**، و`resource` عند الإنشاء `null` ⇒ **خطأ تقييم ⇒ رفض**. الأثر: **أول مصروف في أي شهر جديد يُرفض**، وإنشاء أي التزام جديد يُرفض. الإصلاح: `resource == null ||` أولاً.
2. **ع-أمن-2 (خطر تشغيلي):** ميزانية استدعاءات `get`/`exists` في المعاملة الواحدة. `payObligation` تلمس 9–11 مستنداً، وبوابة إعادة البناء تُستدعى من قاعدة **كل** مستند ⇒ تقدير 17–21 استدعاء مقابل **حدّ 20** للمعاملة. الإصلاح المقترح: بوابة بمستند **ذو وجود** (`meta/rebuildLock`) بدل حقل ⇒ النصف. **يجب القياس في المحاكي قبل النشر.**
3. **ع-أمن-3 (ثقب في إقفال الفترات):** `priorPeriodCorrectionOk` تفحص `kind == 'reversal' && isPriorPeriodCorrection == true` فقط، **ولا تفحص تاريخ القيد** مع أن تعليق النواة يقول «بتاريخ اليوم» ⇒ عميل يستطيع ترحيل قيد عكس **داخل فترة مُقفلة أخرى**. الإصلاح: حارس `bookedAtTs` ضمن ±36 ساعة من `request.time`.

### 1.3 الحقيقة غير المريحة التي يجب أن تُقال للمالك

على Spark **لا يوجد فرض خادمي لمقدار تغيّر الرصيد** (النواة 18.4). القواعد تُقيَّم **لكل مستند منفصلاً**
ولا ترى بقية مستندات المعاملة. فما نملكه هو:

> **مسار كتابة وحيد** + **توازن مفروض من الخادم على كل قيد** + **مشتقات مفروضة من الخادم**
> (`balanceMinor`, `remainingMinor`) + **حدّ رصيد مطلق** + **فاحص دوري رخيص** + **عدم قابلية الدفتر للتغيير والحذف**.

وما لا نملكه: منع عميل متلاعب من كتابة `balanceMinor` **متسق داخلياً لكن خاطئ**.
**تقييم المخاطرة:** مقبول اليوم لأن المتلاعب الوحيد الممكن هو **المالك نفسه على بياناته**،
و«العميل الموثوق» هنا هو جهاز المالك بحساب Google الخاص به. يصبح **غير مقبول** في ثلاث حالات بالاسم:
(1) إضافة مستخدم ثانٍ، (2) أي استخدام للبيانات في إقرار ضريبي/زكوي رسمي يحتاج سجلاً غير قابل للطعن،
(3) تشغيل التطبيق على جهاز مشترك أو من ملحق متصفح غير موثوق. التفصيل والتوصية في القسم 8.

---

## 2. نموذج التهديد — من نحمي، من ماذا، بماذا

| # | التهديد | الاحتمال | الأثر | الضابط المعتمد | الضابط المتبقي الناقص |
|---|---|---|---|---|---|
| **T1** | شخص آخر يسجّل دخولاً بحساب Google ويحاول قراءة بيانات المالك | **عالٍ** (المفتاح عام، الرابط قد يُشارَك) | كارثي | `uid in allowedUids()` في **كل** قاعدة + إيقاف التسجيل | — (مُغلق تماماً) |
| **T2** | طلب غير مُصادق (curl/سكربت) على REST API لـ Firestore | عالٍ | كارثي | `request.auth != null` في كل قاعدة | الطلبات المرفوضة تستهلك حصصاً هامشية |
| **T3** | **المالك على جهاز بنسخة تطبيق قديمة/معطوبة** يكتب بياناً مُشوَّهاً | **متوسط** (سيناريو واقعي: هاتف + حاسوب) | عالٍ (تلف الدفتر) | `entryShapeOk` + I1/I3/I5/I6/I17/I18/I22 من الخادم + حارس `SCHEMA_VERSION_AHEAD` | مقدار الدلتا غير مفروض (18.4) |
| **T4** | XSS أو ملحق متصفح خبيث على نطاق التطبيق | منخفض–متوسط | كارثي (يرث جلسة المالك كاملة) | CSP صارمة (3.6)، لا `dangerouslySetInnerHTML` بلا تنقية، لا سرّ إداري في الواجهة، **حارس حداثة المصادقة على المدمِّرات** | الدفتر غير قابل للحذف ⇒ الضرر الأقصى = قيود زائفة **مكشوفة** في الفاحص، لا محو |
| **T5** | **فقدان الوصول لحساب Google** للمالك | منخفض | كارثي (فقدان كل البيانات) | تصدير JSON دوري (ق-1) + إجراء UID احتياطي موثَّق (3.3) | **لا UID احتياطي مُثبَّت الآن** ⇒ سؤال مفتوح رقم 1 |
| **T6** | سرقة/ضياع جهاز بجلسة مفتوحة | متوسط | عالٍ | إبطال رموز التحديث بسكربت Admin (3.5) + تعطيل المستخدم من Console + حارس الحداثة | رمز هوية قائم يبقى صالحاً حتى ساعة |
| **T7** | تسريب ملف تصدير JSON غير مشفّر | متوسط | عالٍ (بيانات شخصية: أسماء وهواتف جهات) | تحذير إلزامي + تسمية ملف واضحة + خيار تشفير + منع التصدير إلى Storage | سلوك المستخدم لا يُفرَض |
| **T8** | رفع ملف خبيث كمرفق (عند الترقية) | منخفض | متوسط | قائمة MIME مغلقة + تطابق الامتداد مع النوع + 5MB + `Content-Disposition` عند التنزيل + عدم تنفيذ أي HTML/SVG | **`image/svg+xml` مستبعد عمداً** (ناقل XSS) |
| **T9** | محو/تحريف سجل التدقيق لإخفاء عملية | منخفض | متوسط | `auditLogs`: `create` فقط، و`at == request.time` (يفرض `serverTimestamp`)، و`update, delete: if false` | — |
| **T10** | استنزاف حصة Spark المجانية (قراءات/كتابات) | منخفض | متوسط (توقّف الخدمة يوماً) | التقييد بـ referrers + القواعد المغلقة + تصميم القراءات في النواة (15) | لا App Check (أ-7) |
| **T11** | رفع `rebuildStatus = 'running'` من عميل مخترق لفتح باب تنقيص الإجماليات | منخفض | عالٍ | حارس حداثة المصادقة على `meta/integrity` + `auditLogs` إلزامي + الفاحص | التفصيل في 7.4 |

**ما هو خارج النطاق صراحةً:** حماية من Google نفسها (مُشغّل البنية التحتية)، ومن اختراق جهاز المالك على
مستوى نظام التشغيل، ومن إكراه قانوني. لا ندّعي ضدّها شيئاً.

---

## 3. المصادقة وإدارة الجلسات

### 3.1 المزوّد: Google فقط (ق-2)

```ts
// infra/firebase/auth.ts — السطح الكامل. لا مزوّد آخر في الكود إطلاقاً.
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect,
         reauthenticateWithPopup, signOut, onIdTokenChanged,
         indexedDBLocalPersistence, setPersistence } from 'firebase/auth';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export async function signIn(): Promise<void> { /* popup على الحاسوب، redirect على الهاتف */ }
export async function reauthenticate(): Promise<void>;   // قبل كل عملية مدمِّرة — 3.4
export async function signOutHere(): Promise<void>;      // هذا الجهاز فقط
```

**إجراءات Firebase Console الإلزامية (تُنفَّذ يدوياً مرة واحدة وتُسجَّل في `docs/runbook`):**

1. **Authentication ← Sign-in method:** تمكين **Google** فقط. **Anonymous مُعطَّل**، **Email/Password مُعطَّل**،
   وبقية المزوّدين مُعطَّلة. (Anonymous خطر مضاعف: يُنتج UID لا يطابق `allowedUids()` فيُرفض من القواعد،
   لكنه يُنتج مستخدمين في الجدول ويُربك التشخيص.)
2. **Authentication ← Settings ← Authorized domains:** تبقى **فقط**:
   `raseed-2fac1.web.app`، `raseed-2fac1.firebaseapp.com`، و`localhost` **في التطوير فقط**.
   يُحذف أي نطاق آخر. (نطاق مأذون = نطاق يستطيع إكمال تدفق Google Sign-In بمفتاحك.)
3. **Authentication ← Settings ← User actions:** إيقاف **`Enable create (sign-up)`** — **بعد** الخطوة 3.3،
   لا قبلها، وإلا مُنع المالك نفسه من إنشاء حسابه الأول.
   > يجب **التحقق من وجود هذا الخيار فعلاً** في واجهة Console الحالية لمشروع Firebase Auth أساسي
   > (قد يكون محصوراً بـ Identity Platform). إن لم يوجد: **الإغلاق في القواعد يبقى كافياً لمنع الوصول**،
   > وتُسجَّل الحالة كخطر مقبول (T1 يبقى مُغلقاً، ويبقى تضخّم جدول المستخدمين فقط). → سؤال مفتوح رقم 2.
4. **Authentication ← Settings ← User account linking:** «حساب واحد لكل بريد» (الافتراضي) — يُترك كما هو.

### 3.2 لماذا رُفض Email/Password

| البديل | سبب الرفض |
|---|---|
| Email/Password | ق-2 مُلزِم. وموضوعياً: يُضيف تدفق «نسيت كلمة المرور» (بريد قابل للانتحال)، وتخزين كلمة مرور ضعيفة محتملة، وشاشة تسجيل جديدة = سطح تسجيل غير مرغوب. والمقابل صفر لمستخدم واحد له حساب Google أصلاً |
| رابط سحري (Email Link) | يُحوّل أمان النظام كله إلى أمان صندوق البريد، ويحتاج قوالب بريد وتحقّق نطاق |
| مزوّد + Anonymous للتجربة | يُنتج UIDs لا نهائية ويُربك `allowedUids()` والتشخيص |
| مجهول الهوية مع ترقية لاحقة | لا معنى له في نظام شخصي مغلق |

**الخطر المعترف به (ق-2):** فقدان حساب Google = فقدان البيانات. **التخفيف المُلزِم:**
(أ) تفعيل 2FA على `albarshi.96@gmail.com` — خارج نطاق الكود لكنه **شرط تشغيلي يُسجَّل في الـ runbook**،
(ب) التصدير اليدوي الدوري (القسم 11)، (ج) إجراء UID الاحتياطي (3.3).

### 3.3 إجراء تثبيت UID المالك — الترتيب غير قابل للتبديل

```
1) نشر قواعد "مرحلة التهيئة" المؤقتة:
   allowedUids() = []                     ← لا أحد يكتب شيئاً
   + قاعدة واحدة مؤقتة: match /users/{uid}/bootstrap/{d}
       allow create: if request.auth != null && request.auth.uid == uid
                     && request.auth.token.email == 'albarshi.96@gmail.com'
                     && request.auth.token.email_verified == true;
       allow read:   if request.auth != null && request.auth.uid == uid;
   2) تسجيل الدخول بحساب Google للمالك من نطاق مأذون.
   3) قراءة UID من الواجهة (أو Console ← Authentication ← Users).
   4) وضعه في allowedUids() في firestore.rules و storage.rules.
   5) حذف قاعدة bootstrap نهائياً + حذف مجموعة bootstrap.
   6) نشر القواعد النهائية. ثم إيقاف Enable create (sign-up).
   7) تشغيل سكربت التهيئة (seed) من 3.3 في النواة.
```

**لماذا `email` في قاعدة التهيئة المؤقتة ولا نعتمد عليه بعدها:** البريد **قابل للتغيير** و`uid` ثابت
(ق-2 نصّاً). البريد يُستخدم **مرة واحدة فقط** في نافذة التهيئة لتضييق من يستطيع إنشاء مستند الـ bootstrap،
ثم يُحذف المسار بالكامل. **لا قاعدة إنتاجية واحدة تعتمد على `token.email`.**

**UID احتياطي (قرار المالك مطلوب — النواة 22.2 سؤال 1):** إن أراد المالك، يُنشأ حساب Google ثانٍ
(مثلاً على مفتاح أمان مادي) ويُضاف UID إلى `allowedUids()`. **الأثر الأمني الصريح:**
UID احتياطي = **صلاحية كاملة على كل البيانات**، لا صلاحية قراءة فقط — لأن القواعد لا تفرّق بين UIDs
في القائمة. لتمييز «احتياطي للقراءة فقط» يحتاج الأمر حقلاً ثانياً:

```javascript
function fullAccessUids()  { return ['OWNER_UID']; }
function readOnlyUids()    { return ['BACKUP_UID']; }   // اختياري
function canRead(uid)  { return isSignedIn() && request.auth.uid == uid
                             && (uid in fullAccessUids() || uid in readOnlyUids()); }
function canWrite(uid) { return isSignedIn() && request.auth.uid == uid && uid in fullAccessUids(); }
```

> **تنبيه:** هذا النمط يفترض أن الـ UID الاحتياطي يقرأ **شجرته هو** (`users/{backupUid}/…`) — وهي فارغة.
> ليقرأ بيانات المالك يجب أن تصبح القواعد `canRead(OWNER_UID)` من `request.auth.uid` **المختلف** عن `{uid}`،
> أي **فكّ ارتباط «مالك المسار» عن «المستخدم الحالي»** — وهو بالضبط التغيير البنيوي الذي يفتح الباب
> لتعدد المستخدمين (القسم 13). **لا يُنفَّذ إلا بقرار المالك**، ولا يُخترع هنا. → سؤال مفتوح رقم 1.

### 3.4 إعادة المصادقة للعمليات الحسّاسة — مفروضة في القواعد لا في الواجهة

**القائمة النهائية للعمليات التي تتطلب مصادقة حديثة (≤ 10 دقائق):**

| العملية | المسار | لماذا |
|---|---|---|
| إقفال فترة | `periodLocks/{pk}` create | **نهائي ولا يُلغى** (`update, delete: if false`) |
| تشغيل إعادة بناء الإسقاطات | `meta/integrity` ← `rebuildStatus: 'running'` | يفتح باب **تنقيص** إجماليات الحسابات (7.4) |
| أرشفة حساب / تغيير `minBalanceMinor` | `accounts/{id}` update على هذين الحقلين | يُسقط حاجز الرصيد أو يُخفي حساباً |
| تصدير كل البيانات | عملية قراءة + `auditLogs{dataExported}` | إخراج بيانات شخصية كاملة من النظام |
| إضافة UID احتياطي | تعديل القواعد + نشر | يحتاج صلاحية مشروع أصلاً |

```javascript
// الحارس في القواعد — بلا أي استدعاء get/exists، تكلفته صفر قراءات
function hasAuthTime() { return 'auth_time' in request.auth.token; }
function freshAuth() {
  return hasAuthTime()
      && request.time.toMillis() - request.auth.token.auth_time * 1000 < 600000;  // 10 دقائق
}
```

```ts
// الواجهة: تُستدعى قبل أي عملية من القائمة أعلاه
export async function ensureFreshAuth(maxAgeSec = 540): Promise<void> {
  const u = auth.currentUser!;
  const res = await u.getIdTokenResult();           // لا يُحدِّث auth_time
  const ageSec = (Date.now() - Date.parse(res.authTime)) / 1000;
  if (ageSec > maxAgeSec) await reauthenticateWithPopup(u, provider);  // ← يُحدِّث auth_time
}
```

> **لماذا 540 في الواجهة و600 في القواعد:** هامش 60 ثانية يمنع الحالة المحبِطة
> «الواجهة قالت إن المصادقة حديثة، والخادم رفض» بسبب زمن الشبكة وفرق الساعات.
> **البديل المرفوض:** إعادة مصادقة في الواجهة فقط — مخالف للقسم 20 نصّاً («إخفاء عناصر الواجهة ليس حماية»).

### 3.5 مدة الجلسة، والخروج من كل الأجهزة

**الحقائق التي يجب ألّا تُلطَّف:**

| الحقيقة | الأثر العملي |
|---|---|
| رمز الهوية (ID token) صالح **ساعة واحدة** ويُجدَّد تلقائياً | أي إبطال لا يسري فوراً، بل **خلال ساعة كحد أقصى** |
| رمز التحديث (refresh token) **لا ينتهي** إلا بالإبطال أو حذف/تعطيل المستخدم أو تغييرات كبرى على الحساب | «جلسة أبدية» على أي جهاز سجّل دخولاً — **هذا هو السلوك الافتراضي ويجب أن يعرفه المالك** |
| `signOut()` في العميل يمحو الرمز **محلياً فقط** | لا يُنهي جلسة أي جهاز آخر |
| إبطال رموز التحديث لكل الأجهزة يحتاج **صلاحية إدارية** (Admin SDK / REST بمفتاح خدمة) | **لا يمكن فعله من الواجهة**، وأي زر يَعِد بذلك = كذب أو سرّ إداري في الواجهة (ممنوع — القسم 25 بند 9) |
| Admin SDK **يعمل على Spark** محلياً (القيد على Spark هو نشر Functions، لا استخدام Admin SDK) | ⇒ الحل سكربت محلي، لا Cloud Function |

**الحل المعتمد — سكربت تشغيلي محلي (لا يُنشر، لا يُرفع إلى المستودع):**

```js
// tools/ops/revoke-sessions.mjs   — يُشغَّل من جهاز المالك فقط:
//   node tools/ops/revoke-sessions.mjs
// المفتاح يُقرأ من متغير بيئة، ولا يُكتب في أي ملف داخل المستودع.
// .gitignore يحتوي: *serviceAccount*.json  و  .env*
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const keyPath = process.env.RASEED_SA_KEY_PATH;   // مسار خارج المستودع
const uid     = process.env.RASEED_OWNER_UID;
if (!keyPath || !uid) throw new Error('RASEED_SA_KEY_PATH و RASEED_OWNER_UID مطلوبان');

initializeApp({ credential: cert(keyPath) });
await getAuth().revokeRefreshTokens(uid);
const user = await getAuth().getUser(uid);
console.log('tokensValidAfterTime =', user.tokensValidAfterTime);
console.log('تم إبطال رموز التحديث. الرموز القائمة تنتهي خلال ساعة كحد أقصى.');
```

**البديل بلا مفتاح خدمة (الأسرع عند ضياع الجهاز):**
Firebase Console ← Authentication ← Users ← المستخدم ← **Disable account**.
يمنع كل تجديد فوراً. ثم **Enable** وتسجيل دخول جديد. الأثر نفسه، بخطوة واحدة في المتصفح.

**تشديد الفجوة الزمنية (الساعة) في القواعد — خيار مُعلَن لا مُطبَّق افتراضياً:**

```javascript
// لو أراد المالك سريان الإبطال فوراً على الكتابة (لا القراءة):
// يُضاف إلى كل قاعدة كتابة مالية — وتكلفته صفر قراءات لكنه يفرض إعادة مصادقة كل 12 ساعة.
function sessionNotStale() {
  return hasAuthTime()
      && request.time.toMillis() - request.auth.token.auth_time * 1000 < 43200000;  // 12 ساعة
}
```
**غير مُفعَّل افتراضياً** لأنه يُجبر المالك على إعادة تسجيل الدخول كل 12 ساعة على كل جهاز، وهي تكلفة
استخدام يومي حقيقية مقابل تقليص نافذة خطر ساعة واحدة في سيناريو ضياع جهاز. → سؤال مفتوح رقم 3.

**الاستمرارية (persistence) المعتمدة:** `indexedDBLocalPersistence` — لأن PWA والعمل دون اتصال (ق-1)
يحتاجان جلسة تنجو من إغلاق المتصفح. `browserSessionPersistence` **مرفوض**: يقطع العمل دون اتصال
ويُجبر على تسجيل دخول متكرر بلا مكسب (الخطر الحقيقي هو ضياع الجهاز، وعلاجه الإبطال لا انتهاء التبويب).

### 3.6 ضوابط الواجهة المرافقة (ضد T4)

```
# firebase.json ← hosting.headers  (قيم تُراجَع عند إضافة أي مكتبة خارجية)
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://apis.google.com https://www.gstatic.com;
  connect-src 'self' https://*.googleapis.com https://*.firebaseio.com
              https://firestore.googleapis.com https://securetoken.googleapis.com
              https://identitytoolkit.googleapis.com;
  frame-src 'self' https://raseed-2fac1.firebaseapp.com https://accounts.google.com;
  img-src 'self' data: blob: https://lh3.googleusercontent.com;
  style-src 'self' 'unsafe-inline';
  object-src 'none'; base-uri 'none'; form-action 'none';
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

- `frame-src` يشمل `firebaseapp.com` و`accounts.google.com` لأن تدفق Google Sign-In يحتاجهما.
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` **ضروري** لعمل `signInWithPopup`؛
  `same-origin` الصارمة تكسره. (على الهاتف يُستخدم `signInWithRedirect` أصلاً.)
- `style-src 'unsafe-inline'` تنازل مُعلَن لـ Tailwind/مكتبة المكوّنات؛ يُراجَع إذا أمكن nonce لاحقاً.
- `form-action 'none'`: التطبيق لا يُرسل أي نموذج HTML تقليدي — كل الكتابة عبر SDK.
- **لا `dangerouslySetInnerHTML`** إلا على خرج محرر الملاحظات بعد تنقية (`DOMPurify`) — وهذا الموضع
  الوحيد المسموح، ويُفرض بقاعدة ESLint مع استثناء واحد موسوم بتعليق.
- محرر الملاحظات (القسم 13) **لا يسمح بـ SVG مُضمَّن ولا `<iframe>` ولا `on*`** في الخرج المنقّى.

### 3.7 أسرار البيئة — ما يُنشر وما لا يُنشر

| القيمة | تُنشر في الواجهة؟ | التبرير |
|---|---|---|
| `firebaseConfig` (apiKey, authDomain, projectId, appId, messagingSenderId) | **نعم — بالتصميم** | مُعرّف مشروع عام لا سرّ. الحماية في القواعد. **توثيق هذه الحقيقة إلزامي** حتى لا يُعتبر «سرّاً مكشوفاً» في مراجعة لاحقة |
| مفتاح حساب الخدمة (service account JSON) | **لا، مطلقاً** | صلاحية كاملة تتجاوز كل القواعد. يبقى خارج المستودع، في مسار يُشار إليه بمتغير بيئة |
| `allowedUids` (UID المالك) | موجود في `firestore.rules` **وهي ملف منشور لكن غير مقروء من العميل** | UID ليس سرّاً بحد ذاته (معرّف غير قابل للتخمين عملياً)، والقواعد لا تُسلَّم للعميل |
| رموز تصحيح App Check (لو فُعِّل) | **لا** | تتجاوز التحقق؛ تبقى في `.env.local` فقط |

`.gitignore` الإلزامي: `.env*`، `*serviceAccount*.json`، `*-key.json`، `/tools/ops/secrets/`،
`firebase-debug.log`، `.firebase/`.

---

## 4. من المتطلبات إلى المجموعات — لا مجموعة مطلوبة بلا قاعدة

القسم 18 من المتطلبات ذكر 20 مجموعة. الجدول يُظهر **أين ذهبت كل واحدة** حتى لا تبقى مجموعة بلا قاعدة
ولا قاعدة بلا مجموعة.

| في المتطلبات | في التنفيذ | ملاحظة |
|---|---|---|
| `profiles` | `settings/profile` | **مستند `users/{uid}` نفسه غير قابل للكتابة** (`allow write: if false` في النواة) ⇒ الملف الشخصي **لا يمكن** أن يسكن هناك. مُوثَّق في 7.5 |
| `accounts` | `accounts` | كما هو (شجرة الحسابات، النواة 3) |
| `transactions` | `journalEntries` + `postings` | قيد مزدوج (النواة 1). «الحركة» = `postings` |
| `categories` | `categories` (+ حساب `expense` 1:1) | النواة 3.4 |
| `obligations` | `obligations` | النواة 4.5 |
| `debts` | `debts` (الاتجاهان) | النواة 4.6 |
| `debtPayments` | **لا توجد** — `journalEntries where refs.debtId == id` | ADR-005 |
| `contacts` | `contacts` | كما هو |
| `budgets` | `budgetPeriods/{periodKey}` | ميزانية لكل شهر، لا مستند «ميزانية» مستقل |
| `financialGoals` | `financialGoals` | النواة 4.8 |
| `notes` | `notes` + `notebooks` | **جديد في هذه الوثيقة** — النواة لا تغطّيها |
| `tasks` | `tasks` + `taskLists` | **جديد** |
| `reminders` | `reminders` | **جديد** |
| `notifications` | `notifications` | النواة 14.3 |
| `worshipRecords` | `worshipRecords/{YYYY-MM-DD}` | **جديد** |
| `quranProgress` | `quranProgress/{YYYY-MM-DD}` | **جديد** |
| `zakatRecords` | `zakatRecords` | **جديد** — بقاعدة تفصل الاحتساب عن الدفع (القسم 15.4 من المتطلبات) |
| `attachments` | `attachments` (وصفية) + Storage | مؤجَّلة بق-1، **والقواعد مكتوبة من الآن** |
| `auditLogs` | `auditLogs` | النواة 4.10 |
| `settings` | `settings/{app\|profile\|notifications\|dashboard\|security}` | قائمة مغلقة |
| — | `recurrences`, `incomeSchedules`, `operations`, `entryCorrections`, `periodLocks`, `pendingCommands`, `meta`, `accountPeriods`, `periods` | من النواة |

**كل مجموعة غير مذكورة في القواعد = مرفوضة بالكامل** (الافتراضي في Firestore هو الرفض).
وهذا مقصود: إضافة مجموعة جديدة في الكود **تفشل** حتى تُضاف قاعدتها — وهي بوابة مراجعة أمنية مجانية.

---

## 5. مبدأ تصميم القواعد — خمس قواعد مُلزِمة

1. **الشروط الأساسية مشتركة لا بديلة.** كل `||` بين فرعين يُحاط بأقواس صريحة، وكل شرط هوية/ملكية
   يبقى **خارج** الأقواس. (هذا إصلاح العيب المُشخَّص في النواة 14.2، وهو أخطر صنف أخطاء في القواعد.)
2. **لا `resource.data` في تعبير يُقيَّم عند الإنشاء** — إلا بعد استبعاد الإنشاء صراحةً. (ع-أمن-1.)
3. **`create` و`update` قاعدتان منفصلتان دائماً** في كل مجموعة لها مشتقات أو حقول ثابتة.
   دمجهما في `allow create, update` هو ما أنتج ع-أمن-1 في المسوّدة.
4. **الحذف ممنوع افتراضياً.** يُسمح به صراحةً في مجموعات غير محاسبية فقط
   (`notifications`, `reminders`, `pendingCommands`, `notes`, `notebooks`, `tasks`, `taskLists`).
5. **كل قاعدة إنشاء تُثبّت `ownerUid` و`schemaVersion`**، وكل قاعدة تحديث تُجمّد `ownerUid` و`createdAt`.
   بدون ذلك يستطيع عميل معطوب كتابة مستند بـ `ownerUid` غير صحيح **داخل شجرة المالك** ⇒ التصدير
   والفاحص والتقارير تتعامل معه كأنه ليس له — **انحراف صامت لا يكشفه ميزان المراجعة**.

**قاعدة تشغيلية:** الملف يُحفظ في جذر المستودع باسم `firestore.rules`، ويُستبدل
`REPLACE_WITH_OWNER_UID` بالقيمة الحقيقية قبل أول نشر (3.3). النشر:
`firebase deploy --only firestore:rules` **بعد** `npm run test:rules` الأخضر (القسم 10)،
ولا نشر قبل موافقة المالك (المتطلبات، القسم 25 بند 10).

---

## 6. `firestore.rules` — المحتوى الكامل القابل للنشر

```javascript
rules_version = '2';

// ════════════════════════════════════════════════════════════════════════════
//  رصيد | RASEED — firestore.rules
//  المشروع: raseed-2fac1   |   العملة: LYD (التخزين بالدرهم، عدد صحيح)
//
//  عقود مُلزِمة:
//   ق-2      : النظام مغلق على UID المالك المعتمد — في القواعد لا في الواجهة.
//   النواة 13: I1, I3, I5, I6, I15, I17, I18, I22, I24 مفروضة من الخادم.
//   النواة 18.4: مقدار تغيّر الرصيد **غير مفروض** على Spark. مُعلَن لا مُخفى.
//
//  قبل النشر:
//   1) استبدال REPLACE_WITH_OWNER_UID بالـ UID الحقيقي (إجراء 3.3).
//   2) نجاح npm run test:rules بالكامل (القسم 10) — بما فيه اختبار ميزانية
//      استدعاءات الوصول لعملية payObligation (ع-أمن-2).
//   3) موافقة المالك (المتطلبات، القسم 25 بند 10).
// ════════════════════════════════════════════════════════════════════════════

service cloud.firestore {
  match /databases/{database}/documents {

    // ══════════════════════════════════════════════════════════════════════
    //  0 — الهوية والإغلاق (ق-2)
    // ══════════════════════════════════════════════════════════════════════

    // UID المالك المعتمد. البريد قابل للتغيير و UID ثابت ⇒ لا قاعدة إنتاجية
    // واحدة تعتمد على request.auth.token.email.
    function allowedUids() {
      return ['REPLACE_WITH_OWNER_UID'];   // + UID احتياطي عند قرار المالك (3.3)
    }

    function isSignedIn() {
      return request.auth != null;
    }

    // الإغلاق الفعلي: الشرط الثاني هو ما يمنع أي شخص سجّل دخولاً بحساب Google
    // من بناء شجرته الخاصة تحت users/{uidهو} والكتابة فيها.
    function isOwner(uid) {
      return isSignedIn()
          && request.auth.uid == uid
          && uid in allowedUids();
    }

    // حارس حداثة المصادقة — للعمليات المدمِّرة فقط. تكلفته صفر قراءات.
    function hasAuthTime() {
      return 'auth_time' in request.auth.token;
    }
    function freshAuth() {
      return hasAuthTime()
          && request.time.toMillis() - request.auth.token.auth_time * 1000 < 600000;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  1 — المال: عدد صحيح بالدرهم. لا كسر عائم في أي حقل مالي.
    //      MAX_ABS_MINOR = 1_000_000_000_000 (النواة 2.1)
    // ══════════════════════════════════════════════════════════════════════

    function isValidMoney(v) {
      return v is int && v >= -1000000000000 && v <= 1000000000000;
    }
    function isPosInt(v) {
      return v is int && v > 0 && v <= 1000000000000;
    }
    function isNonNegInt(v) {
      return v is int && v >= 0 && v <= 1000000000000;
    }
    // أسماء مرادفة للوضوح في قواعد الكيانات
    function isPosMoney(v)    { return isPosInt(v); }
    function isNonNegMoney(v) { return isNonNegInt(v); }

    // ══════════════════════════════════════════════════════════════════════
    //  2 — أدوات الحقول
    // ══════════════════════════════════════════════════════════════════════

    function unchanged(f) {
      return request.resource.data[f] == resource.data[f];
    }
    function hasOnly(keys) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys);
    }
    function touchedOnly(keys) {   // مرادف لاسم النواة 14.3
      return hasOnly(keys);
    }
    function requires(keys) {
      return request.resource.data.keys().hasAll(keys);
    }
    function noExtraKeys(keys) {
      return request.resource.data.keys().hasOnly(keys);
    }
    // يفرض استخدام serverTimestamp() بدل ساعة الجهاز.
    function serverTime(f) {
      return request.resource.data[f] == request.time;
    }
    function strMax(f, n) {
      return request.resource.data[f] is string
          && request.resource.data[f].size() <= n;
    }
    function strBetween(f, lo, hi) {
      return request.resource.data[f] is string
          && request.resource.data[f].size() >= lo
          && request.resource.data[f].size() <= hi;
    }
    function dateKeyOk(f) {
      return request.resource.data[f] is string
          && request.resource.data[f].matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    }
    function periodKeyFieldOk(f) {
      return request.resource.data[f] is string
          && request.resource.data[f].matches('^[0-9]{4}-[0-9]{2}$');
    }
    function listMax(f, n) {
      return request.resource.data[f] is list && request.resource.data[f].size() <= n;
    }

    // كل إنشاء يثبّت المالك والنسخة. كل تحديث يجمّدهما مع createdAt.
    function ownedNew(uid) {
      return request.resource.data.ownerUid == uid
          && request.resource.data.schemaVersion is int
          && request.resource.data.schemaVersion >= 1;
    }
    function ownerFrozen() {
      return unchanged('ownerUid') && unchanged('createdAt');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  3 — البوابات
    //      تحذير تشغيلي: كل exists/get هنا يُحسب ضمن حدّ استدعاءات الوصول
    //      للمعاملة (20). قياس الميزانية إلزامي قبل النشر — انظر 7.3.
    // ══════════════════════════════════════════════════════════════════════

    function integrityDoc(uid) {
      return /databases/$(database)/documents/users/$(uid)/meta/integrity;
    }
    // نمط آمن: غياب المستند لا يُوقف النظام (النواة 3.3، العيب ع-ج-5)
    function rebuildNotRunning(uid) {
      return !exists(integrityDoc(uid))
          || get(integrityDoc(uid)).data.rebuildStatus != 'running';
    }
    function rebuildRunning(uid) {
      return exists(integrityDoc(uid))
          && get(integrityDoc(uid)).data.rebuildStatus == 'running';
    }
    function periodNotLocked(uid, pk) {
      return !exists(/databases/$(database)/documents/users/$(uid)/periodLocks/$(pk));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  4 — شكل القيد: I1 و I2 و I18 مفروضة من الخادم
    //      (منقول حرفياً من النواة 14.3 — لا يُعاد تعريفه هنا)
    // ══════════════════════════════════════════════════════════════════════

    function entryShapeOk(d) {
      return d.keys().hasAll(['opId','kind','status','bookedAt','periodKey','lines',
                              'accountIds','accountTypes','totalDebitMinor','totalCreditMinor',
                              'amountMinor','currency','ownerUid','schemaVersion',
                              'payloadHash','description','tags','refs'])
        && d.currency == 'LYD'
        && d.schemaVersion is int && d.schemaVersion >= 1
        && d.status == 'posted'                                    // لا يُنشأ قيد بحالة أخرى
        && d.lines is list && d.lines.size() >= 2 && d.lines.size() <= 50
        && isPosInt(d.totalDebitMinor)
        && d.totalDebitMinor == d.totalCreditMinor                 // I1
        && d.amountMinor == d.totalDebitMinor
        && d.accountIds is list && d.accountIds.size() >= 2 && d.accountIds.size() <= 50
        && d.accountTypes is list
        && d.description is string && d.description.size() > 0 && d.description.size() <= 500
        && d.bookedAt is string && d.bookedAt.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && d.periodKey is string && d.periodKey.matches('^[0-9]{4}-[0-9]{2}$')
        && d.periodKey == d.bookedAt[0:7]                          // I18 (ADR-008)
        && d.payloadHash is string && d.payloadHash.size() == 64
        && d.tags is list && d.tags.size() <= 20;
    }

    // ── تشديد على مسوّدة النواة (ع-أمن-3): تصحيح الفترة المُقفلة مسموح فقط
    //    لقيد عكس **بتاريخ اليوم فعلاً**، لا بأي تاريخ.
    //    bookedAtTs = منتصف نهار UTC ليوم bookedAt ⇒ نافذة ±36 ساعة تغطّي كل
    //    المناطق الزمنية بلا حساب تقويم داخل القواعد.
    function bookedWithin36h(d) {
      return 'bookedAtTs' in d
          && d.bookedAtTs is timestamp
          && request.time.toMillis() - d.bookedAtTs.toMillis() < 129600000
          && d.bookedAtTs.toMillis() - request.time.toMillis() < 129600000;
    }
    function priorPeriodCorrectionOk(d) {
      return d.kind == 'reversal'
          && d.isPriorPeriodCorrection == true
          && bookedWithin36h(d);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  5 — الشجرة
    // ══════════════════════════════════════════════════════════════════════

    match /users/{uid} {

      // مستند المستخدم نفسه: يُقرأ ولا يُكتب أبداً.
      // ⇒ الملف الشخصي يسكن settings/profile لا هنا (انظر 7.5).
      allow read:  if isOwner(uid);
      allow write: if false;

      // ────────────────────────────────────────────────────────────────────
      //  5.1 — الإعدادات والملف الشخصي (قائمة مستندات مغلقة)
      // ────────────────────────────────────────────────────────────────────
      match /settings/{docId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && docId in ['app','profile','notifications','dashboard','security']
          && (!('currency' in request.resource.data)
              || request.resource.data.currency == 'LYD');
        allow update: if isOwner(uid) && ownerFrozen()
          && docId in ['app','profile','notifications','dashboard','security']
          && (!('currency' in request.resource.data)
              || request.resource.data.currency == 'LYD')
          && (!('displayDecimals' in request.resource.data)
              || request.resource.data.displayDecimals in [0, 2, 3]);
        allow delete: if false;
      }

      // ────────────────────────────────────────────────────────────────────
      //  5.2 — الفئات وجهات التعامل والتكرار وجدولة الدخل
      //        أرشفة بدل حذف (المتطلبات، القسم 6)
      // ────────────────────────────────────────────────────────────────────
      match /categories/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('name', 1, 120)
          && request.resource.data.status in ['active','archived']
          && request.resource.data.expenseAccountId is string;
        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('expenseAccountId')          // الربط 1:1 مع الحساب لا يُنقل
          && strBetween('name', 1, 120)
          && request.resource.data.status in ['active','archived'];
        allow delete: if false;
      }

      match /contacts/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('name', 1, 160)
          && (!('phone' in request.resource.data) || strMax('phone', 32));
        allow update: if isOwner(uid) && ownerFrozen()
          && strBetween('name', 1, 160)
          && (!('phone' in request.resource.data) || strMax('phone', 32));
        allow delete: if false;
      }

      match /recurrences/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.kind in ['expense','income','obligation']
          && request.resource.data.frequency in
               ['daily','weekly','biweekly','monthly','quarterly','yearly']
          && request.resource.data.interval is int
          && request.resource.data.interval >= 1
          && request.resource.data.interval <= 52
          && dateKeyOk('startDate')
          && request.resource.data.dayOfMonthPolicy in ['clampToEndOfMonth','exact']
          && request.resource.data.status in ['active','paused','ended'];
        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('kind')
          && request.resource.data.status in ['active','paused','ended'];
        allow delete: if false;
      }

      match /incomeSchedules/{id} {
        allow read: if isOwner(uid);
        // المتوقع لا يُخلط بالمستلم (المتطلبات، القسم 7): لا حقل رصيد هنا إطلاقاً
        allow create: if isOwner(uid) && ownedNew(uid)
          && isPosMoney(request.resource.data.expectedAmountMinor)
          && dateKeyOk('expectedAt')
          && request.resource.data.status in ['expected','received','cancelled'];
        allow update: if isOwner(uid) && ownerFrozen()
          && request.resource.data.status in ['expected','received','cancelled'];
        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.3 — الدفتر: لا تعديل محاسبي، ولا حذف، أبداً
      // ══════════════════════════════════════════════════════════════════
      match /journalEntries/{entryId} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.createdBy == request.auth.uid
          && serverTime('createdAt')                                 // لا تاريخ إنشاء من الجهاز
          && entryShapeOk(request.resource.data)                     // ← مشترك، لا بديل
          && (                                                       // ← أقواس صريحة (14.2)
                entryId == request.resource.data.opId
             || entryId == request.resource.data.opId + '__1'
             || entryId == request.resource.data.opId + '__2'
             || entryId == request.resource.data.opId + '__3'
             )
          && rebuildNotRunning(uid)                                  // I24
          && (
                periodNotLocked(uid, request.resource.data.periodKey) // I17
             || priorPeriodCorrectionOk(request.resource.data)
             );

        // الحقول المحاسبية ثابتة إلى الأبد. المسموح: الحالة وسلسلة التصحيح والوصف.
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
          && request.resource.data.status in ['posted','reversed','replaced']
          && resource.data.kind != 'reversal'          // قيد العكس غير قابل للتعديل
          && strBetween('description', 1, 500)
          && listMax('tags', 20);

        allow delete: if false;                        // لا حذف مالي مطلقاً
      }

      // postings: تُكتب مع القيد، ولا تُعدَّل ولا تُحذف أبداً
      match /postings/{postingId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid)
          && request.resource.data.ownerUid == uid
          && request.resource.data.entryId is string
          && request.resource.data.lineNo is int
          && request.resource.data.lineNo >= 1
          && postingId == request.resource.data.entryId + '__'
                        + string(request.resource.data.lineNo)
          && isPosInt(request.resource.data.amountMinor)
          && isValidMoney(request.resource.data.signedAmountMinor)
          && isValidMoney(request.resource.data.settlementDeltaMinor)
          && (   request.resource.data.signedAmountMinor ==  request.resource.data.amountMinor
              || request.resource.data.signedAmountMinor == -request.resource.data.amountMinor )
          && request.resource.data.entryStatus == 'posted'        // لقطة لحظة الكتابة
          && request.resource.data.side in ['debit','credit']
          && request.resource.data.accountType in
               ['asset','liability','income','expense','equity']
          && request.resource.data.periodKey == request.resource.data.bookedAt[0:7]
          && rebuildNotRunning(uid);
        allow update, delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.4 — الحسابات: I3 و I22 وحدّ الرصيد مفروضة من الخادم
      // ══════════════════════════════════════════════════════════════════
      match /accounts/{accountId} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.currency == 'LYD'
          && request.resource.data.type in
               ['asset','liability','income','expense','equity']
          && request.resource.data.debitTotalMinor == 0
          && request.resource.data.creditTotalMinor == 0
          && request.resource.data.balanceMinor == 0
          && request.resource.data.openingBalanceMinor == 0
          && request.resource.data.earmarkedMinor == 0
          && request.resource.data.entryCount == 0
          && request.resource.data.balanceVersion == 0
          && request.resource.data.minBalanceMinor is int
          && request.resource.data.minBalanceMinor <= 0
          && request.resource.data.minBalanceMinor >= -1000000000000
          && request.resource.data.normalSide ==
               ((request.resource.data.type == 'asset'
                 || request.resource.data.type == 'expense') ? 'debit' : 'credit')
          && request.resource.data.status in ['active','archived']
          // I22 — القاعدة 19.9: المستحق لي ليس نقداً متاحاً
          && (request.resource.data.subtype != 'receivable'
              || request.resource.data.isCashLike == false);

        allow update: if isOwner(uid)
          && ownerFrozen() && unchanged('type') && unchanged('code')
          && unchanged('normalSide') && unchanged('currency')
          && unchanged('openingBalanceMinor')     // مرآة القيد الافتتاحي: لا تُكتب يدوياً
          && request.resource.data.debitTotalMinor is int
          && request.resource.data.creditTotalMinor is int
          && request.resource.data.debitTotalMinor >= 0
          && request.resource.data.creditTotalMinor >= 0
          && request.resource.data.earmarkedMinor is int
          && request.resource.data.earmarkedMinor >= 0
          && request.resource.data.balanceVersion > resource.data.balanceVersion
          && request.resource.data.status in ['active','archived']
          && request.resource.data.minBalanceMinor is int
          && request.resource.data.minBalanceMinor <= 0

          // I3 — الرصيد مشتق من الإجماليين (ممكن لأن normalSide مخزَّن)
          && request.resource.data.balanceMinor ==
               (resource.data.normalSide == 'debit'
                 ? request.resource.data.debitTotalMinor - request.resource.data.creditTotalMinor
                 : request.resource.data.creditTotalMinor - request.resource.data.debitTotalMinor)

          // حدّ الرصيد المطلق — شبكة أمان ضد أي مسار التفّ على postOperation
          && request.resource.data.balanceMinor >= request.resource.data.minBalanceMinor

          // I22 يبقى مفروضاً على التحديث أيضاً، لا على الإنشاء وحده
          && (request.resource.data.subtype != 'receivable'
              || request.resource.data.isCashLike == false)

          // التزايد إلا في الإصلاح (ع-أ-4): يحفظ إمكان إعادة البناء
          && (
               (    request.resource.data.debitTotalMinor  >= resource.data.debitTotalMinor
                 && request.resource.data.creditTotalMinor >= resource.data.creditTotalMinor )
               || rebuildRunning(uid)
             )

          // تغيير حدّ الرصيد أو الأرشفة = عملية مدمِّرة ⇒ مصادقة حديثة (أ-4)
          && (
               (    unchanged('minBalanceMinor')
                 && request.resource.data.status == resource.data.status )
               || freshAuth()
             );

        allow delete: if false;                     // أرشفة بدل حذف
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.5 — المُجمَّعات المشتقة: قابلة لإعادة البناء، غير قابلة للحذف
      //        إصلاح ع-أمن-1: create و update قاعدتان منفصلتان، فلا تُقرأ
      //        resource.data في تعبير يُقيَّم عند الإنشاء.
      // ══════════════════════════════════════════════════════════════════
      match /accountPeriods/{id} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid) && ownedNew(uid)
          && id == request.resource.data.accountId + '__' + request.resource.data.periodKey
          && isNonNegMoney(request.resource.data.debitMinor)
          && isNonNegMoney(request.resource.data.creditMinor)
          && isValidMoney(request.resource.data.netMinor)
          && periodKeyFieldOk('periodKey')
          && request.resource.data.entryCount is int
          && request.resource.data.entryCount >= 0;

        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('accountId') && unchanged('periodKey')
          && isNonNegMoney(request.resource.data.debitMinor)
          && isNonNegMoney(request.resource.data.creditMinor)
          && isValidMoney(request.resource.data.netMinor)
          && (
               (    request.resource.data.debitMinor  >= resource.data.debitMinor
                 && request.resource.data.creditMinor >= resource.data.creditMinor )
               || rebuildRunning(uid)
             );

        allow delete: if false;
      }

      match /periods/{pk} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid) && ownedNew(uid)
          && pk == request.resource.data.periodKey
          && periodKeyFieldOk('periodKey')
          && isNonNegMoney(request.resource.data.totalIncomeMinor)
          && isNonNegMoney(request.resource.data.totalExpenseMinor)
          && isValidMoney(request.resource.data.netCashFlowMinor)
          && isValidMoney(request.resource.data.priorPeriodExpenseCorrectionMinor)
          && isValidMoney(request.resource.data.priorPeriodIncomeCorrectionMinor)
          && isNonNegMoney(request.resource.data.householdExpenseMinor)
          && request.resource.data.householdExpenseMinor <=
             request.resource.data.totalExpenseMinor;                // I15

        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('periodKey')
          && isNonNegMoney(request.resource.data.totalIncomeMinor)
          && isNonNegMoney(request.resource.data.totalExpenseMinor)
          && isValidMoney(request.resource.data.netCashFlowMinor)
          && isValidMoney(request.resource.data.priorPeriodExpenseCorrectionMinor)
          && isValidMoney(request.resource.data.priorPeriodIncomeCorrectionMinor)
          && isNonNegMoney(request.resource.data.householdExpenseMinor)
          && request.resource.data.householdExpenseMinor <=
             request.resource.data.totalExpenseMinor;                // I15

        allow delete: if false;
      }

      match /budgetPeriods/{pk} {
        allow read: if isOwner(uid);

        // ممنوع إنشاء مستند ميزانية بلا سقف معرَّف (القاعدة الصلبة على النواة 4.7):
        // إما سقف عام رقمي، أو null صريح — لا حقل غائب.
        allow create: if isOwner(uid) && ownedNew(uid)
          && pk == request.resource.data.periodKey
          && periodKeyFieldOk('periodKey')
          && isNonNegMoney(request.resource.data.overallSpentMinor)
          && 'overallLimitMinor' in request.resource.data
          && (   request.resource.data.overallLimitMinor == null
              || isNonNegMoney(request.resource.data.overallLimitMinor) );

        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('periodKey')
          && isNonNegMoney(request.resource.data.overallSpentMinor)
          && 'overallLimitMinor' in request.resource.data
          && (   request.resource.data.overallLimitMinor == null
              || isNonNegMoney(request.resource.data.overallLimitMinor) );

        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.6 — الالتزامات: I5 مفروض من الخادم (منع السداد الزائد)
      // ══════════════════════════════════════════════════════════════════
      match /obligations/{id} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('name', 1, 200)
          && request.resource.data.nature in ['expense','financing']
          && request.resource.data.status in
               ['upcoming','due','overdue','partiallyPaid','paid','cancelled']
          && request.resource.data.priority in [1, 2, 3]
          && dateKeyOk('dueDate')
          && isPosMoney(request.resource.data.totalMinor)
          && isNonNegMoney(request.resource.data.extraChargesMinor)
          && isNonNegMoney(request.resource.data.paidMinor)
          && isValidMoney(request.resource.data.remainingMinor)
          // I5 — منع السداد الزائد + صحة المشتق
          && request.resource.data.paidMinor <=
               request.resource.data.totalMinor + request.resource.data.extraChargesMinor
          && request.resource.data.remainingMinor ==
               request.resource.data.totalMinor + request.resource.data.extraChargesMinor
               - request.resource.data.paidMinor
          // كل زيادة لها سبب مكتوب (ADR-012)
          && (   request.resource.data.extraChargesMinor == 0
              || strBetween('extraChargesReason', 5, 500) );

        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('nature')
          && request.resource.data.status in
               ['upcoming','due','overdue','partiallyPaid','paid','cancelled']
          && isPosMoney(request.resource.data.totalMinor)
          && isNonNegMoney(request.resource.data.extraChargesMinor)
          && isNonNegMoney(request.resource.data.paidMinor)
          && request.resource.data.paidMinor <=
               request.resource.data.totalMinor + request.resource.data.extraChargesMinor
          && request.resource.data.remainingMinor ==
               request.resource.data.totalMinor + request.resource.data.extraChargesMinor
               - request.resource.data.paidMinor
          && (   request.resource.data.extraChargesMinor == 0
              || strBetween('extraChargesReason', 5, 500) )
          // ADR-012: القيمة الأصلية المتعاقد عليها لا تُرفع لاستيعاب تجاوز
          && (   unchanged('totalMinor')
              || rebuildRunning(uid) );

        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.7 — الديون: I6 مفروض من الخادم (منع السداد/التحصيل الزائد)
      // ══════════════════════════════════════════════════════════════════
      match /debts/{id} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.direction in ['payable','receivable']
          && request.resource.data.status in
               ['open','partiallySettled','settled','writtenOff','cancelled']
          && request.resource.data.accountId is string
          && request.resource.data.counterpartyContactId is string
          && strBetween('counterpartyName', 1, 160)
          && dateKeyOk('originatedAt')
          && request.resource.data.createdCash is bool
          && isPosMoney(request.resource.data.principalMinor)
          && isNonNegMoney(request.resource.data.settledMinor)
          && isNonNegMoney(request.resource.data.writtenOffMinor)
          && isValidMoney(request.resource.data.remainingMinor)
          // I6
          && request.resource.data.settledMinor + request.resource.data.writtenOffMinor
               <= request.resource.data.principalMinor
          && request.resource.data.remainingMinor ==
               request.resource.data.principalMinor - request.resource.data.settledMinor
               - request.resource.data.writtenOffMinor
          && request.resource.data.allowOverSettle == false
          // الشطب للمستحق لي فقط — لا يُشطب دين عليّ
          && (   request.resource.data.writtenOffMinor == 0
              || request.resource.data.direction == 'receivable' );

        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('direction') && unchanged('accountId')
          && unchanged('principalMinor')      // أصل الدين لا يتغير؛ التصحيح بدين جديد
          && request.resource.data.status in
               ['open','partiallySettled','settled','writtenOff','cancelled']
          && isNonNegMoney(request.resource.data.settledMinor)
          && isNonNegMoney(request.resource.data.writtenOffMinor)
          && request.resource.data.settledMinor + request.resource.data.writtenOffMinor
               <= request.resource.data.principalMinor
          && request.resource.data.remainingMinor ==
               request.resource.data.principalMinor - request.resource.data.settledMinor
               - request.resource.data.writtenOffMinor
          && request.resource.data.allowOverSettle == false
          && (   request.resource.data.writtenOffMinor == 0
              || request.resource.data.direction == 'receivable' );

        allow delete: if false;
      }

      match /debts/{debtId}/followUps/{fid} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.debtId == debtId
          && strBetween('note', 1, 1000)
          && serverTime('createdAt');
        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('debtId')
          && strBetween('note', 1, 1000);
        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.8 — الأهداف المالية
      // ══════════════════════════════════════════════════════════════════
      match /financialGoals/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('name', 1, 200)
          && request.resource.data.mode in ['backedAccount','virtualEarmark']
          && request.resource.data.status in ['active','achieved','paused','cancelled']
          && isPosMoney(request.resource.data.targetMinor)
          && isNonNegMoney(request.resource.data.savedMinor);
        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('mode')                // تغيير النمط = هدف جديد، لا تعديل
          && request.resource.data.status in ['active','achieved','paused','cancelled']
          && isPosMoney(request.resource.data.targetMinor)
          && isNonNegMoney(request.resource.data.savedMinor);
        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.9 — التحكم والتدقيق
      // ══════════════════════════════════════════════════════════════════

      // قفل التصحيح (ADR-014): الوجود ذرّي ونهائي
      match /entryCorrections/{originalEntryId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.reversalEntryId is string
          && strBetween('reason', 5, 500)
          && request.resource.data.by == request.auth.uid
          && serverTime('at');
        allow update, delete: if false;
      }

      match /operations/{opId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && opId == request.resource.data.id
          && request.resource.data.status in ['committed','compensated']
          && request.resource.data.payloadHash is string
          && request.resource.data.payloadHash.size() == 64
          && serverTime('createdAt');
        allow update: if isOwner(uid)
          && touchedOnly(['status','resultSummary','updatedAt'])
          && request.resource.data.status in ['committed','compensated'];
        allow delete: if false;
      }

      // الإقفال نهائي ولا يُلغى ⇒ مصادقة حديثة إلزامية (أ-4)
      match /periodLocks/{pk} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && freshAuth()
          && request.resource.data.ownerUid == uid
          && pk.matches('^[0-9]{4}-[0-9]{2}$')
          && strBetween('reason', 5, 500)
          && request.resource.data.lockedBy == request.auth.uid
          && serverTime('lockedAt');
        allow update, delete: if false;
      }

      // سجل تدقيق غير قابل للتلاعب: إنشاء فقط، بوقت الخادم، وبهوية الكاتب
      match /auditLogs/{logId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.action in [
               'entryReversed','entryAmended','descriptiveEditOnPostedEntry',
               'accountCreated','accountArchived','minBalanceChanged',
               'openingBalanceSet','balanceAdjusted',
               'extraChargesAdded','obligationCancelled',
               'debtWrittenOff','periodLocked',
               'projectionsRebuilt','migrationApplied','dataExported']
          && request.resource.data.targetCollection is string
          && request.resource.data.targetId is string
          && request.resource.data.by == request.auth.uid
          && serverTime('at')
          && (!('reason' in request.resource.data) || strMax('reason', 1000));
        allow update, delete: if false;
      }

      // بوابة إعادة البناء وحارس النسخة. التحويل إلى running عملية مدمِّرة.
      match /meta/{docId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && docId in ['integrity','schema']
          && (   docId != 'integrity'
              || request.resource.data.rebuildStatus == 'idle' );
        allow update: if isOwner(uid) && ownerFrozen()
          && docId in ['integrity','schema']
          && (
               docId != 'integrity'
               || (
                    request.resource.data.rebuildStatus in ['idle','running','failed']
                    // فتح باب تنقيص الإجماليات يحتاج مصادقة حديثة (T11)
                    && (   request.resource.data.rebuildStatus != 'running'
                        || freshAuth() )
                  )
             );
        allow delete: if false;        // غيابه يُربك البوابة (النواة 3.3)
      }

      // طابور العمل دون اتصال — المجموعة المالية الوحيدة القابلة للحذف
      match /pendingCommands/{opId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && opId == request.resource.data.id
          && request.resource.data.status == 'queued'
          && request.resource.data.payloadHash is string
          && request.resource.data.payloadHash.size() == 64
          && request.resource.data.attemptCount is int
          && request.resource.data.attemptCount >= 0;
        allow update: if isOwner(uid)
          && touchedOnly(['status','attemptCount','rejectionCode',
                          'rejectionMessageAr','updatedAt'])
          && request.resource.data.status in ['queued','applied','rejected'];
        allow delete: if isOwner(uid);
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.10 — التنبيهات والتذكيرات
      // ══════════════════════════════════════════════════════════════════
      match /notifications/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('titleAr', 1, 200)
          && request.resource.data.severity in ['info','warning','critical']
          && request.resource.data.read is bool
          && request.resource.data.kind is string;
        allow update: if isOwner(uid)
          && touchedOnly(['read','readAt','updatedAt'])
          && request.resource.data.read is bool;
        allow delete: if isOwner(uid);       // ليست سجلاً محاسبياً
      }

      match /reminders/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('titleAr', 1, 200)
          && dateKeyOk('remindOn')
          && request.resource.data.status in ['scheduled','fired','dismissed'];
        allow update: if isOwner(uid) && ownerFrozen()
          && request.resource.data.status in ['scheduled','fired','dismissed'];
        allow delete: if isOwner(uid);
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.11 — التنظيم الشخصي: المفكرة والمهام
      //         (غير محاسبية ⇒ الحذف الفعلي مسموح)
      // ══════════════════════════════════════════════════════════════════
      match /notebooks/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid) && strBetween('name', 1, 120);
        allow update: if isOwner(uid) && ownerFrozen() && strBetween('name', 1, 120);
        allow delete: if isOwner(uid);
      }

      match /notes/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && strMax('title', 200)
          && strMax('bodyHtml', 100000)         // سقف حجم يمنع تفخيم المستند
          && request.resource.data.pinned is bool
          && request.resource.data.archived is bool
          && listMax('tags', 20);
        allow update: if isOwner(uid) && ownerFrozen()
          && strMax('title', 200)
          && strMax('bodyHtml', 100000)
          && request.resource.data.pinned is bool
          && request.resource.data.archived is bool
          && listMax('tags', 20);
        allow delete: if isOwner(uid);
      }

      match /taskLists/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid) && strBetween('name', 1, 120);
        allow update: if isOwner(uid) && ownerFrozen() && strBetween('name', 1, 120);
        allow delete: if isOwner(uid);
      }

      match /tasks/{id} {
        allow read: if isOwner(uid);
        // «لا تُعرض مهمة كمكتملة دون إجراء إكمال صريح» (المتطلبات، القسم 14)
        // ⇒ done يستلزم completedAt غير فارغ، مفروضاً من الخادم.
        allow create: if isOwner(uid) && ownedNew(uid)
          && strBetween('title', 1, 300)
          && request.resource.data.status in ['todo','doing','done','cancelled']
          && request.resource.data.priority in [1, 2, 3]
          && (!('dueDate' in request.resource.data)
              || request.resource.data.dueDate == null
              || dateKeyOk('dueDate'))
          && (   request.resource.data.status != 'done'
              || (   'completedAt' in request.resource.data
                  && request.resource.data.completedAt != null ) );
        allow update: if isOwner(uid) && ownerFrozen()
          && strBetween('title', 1, 300)
          && request.resource.data.status in ['todo','doing','done','cancelled']
          && request.resource.data.priority in [1, 2, 3]
          && (   request.resource.data.status != 'done'
              || (   'completedAt' in request.resource.data
                  && request.resource.data.completedAt != null ) );
        allow delete: if isOwner(uid);
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.12 — العبادات: سجلات شخصية بمعرّف = يوم تقويمي
      //         لا حذف (السجل التاريخي الشخصي يُحترم كالدفتر)
      // ══════════════════════════════════════════════════════════════════
      match /worshipRecords/{dateKey} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && dateKey.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
          && request.resource.data.dateKey == dateKey
          && request.resource.data.prayers is map
          && request.resource.data.prayers.keys().hasOnly(
               ['fajr','dhuhr','asr','maghrib','isha'])
          && (!('fastingVoluntary' in request.resource.data)
              || request.resource.data.fastingVoluntary is bool)
          && (!('notes' in request.resource.data) || strMax('notes', 1000));
        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('dateKey')
          && request.resource.data.prayers is map
          && request.resource.data.prayers.keys().hasOnly(
               ['fajr','dhuhr','asr','maghrib','isha'])
          && (!('notes' in request.resource.data) || strMax('notes', 1000));
        allow delete: if false;
      }

      match /quranProgress/{dateKey} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && dateKey.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
          && request.resource.data.dateKey == dateKey
          && request.resource.data.pagesRead is int
          && request.resource.data.pagesRead >= 0
          && request.resource.data.pagesRead <= 604      // سقف مصحف المدينة
          && (!('dailyTargetPages' in request.resource.data)
              || (   request.resource.data.dailyTargetPages is int
                  && request.resource.data.dailyTargetPages >= 0
                  && request.resource.data.dailyTargetPages <= 604 ));
        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('dateKey')
          && request.resource.data.pagesRead is int
          && request.resource.data.pagesRead >= 0
          && request.resource.data.pagesRead <= 604;
        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.13 — الزكاة: الاحتساب مفصول عن الدفع (المتطلبات، القسم 15.4)
      //         «لا يُخصم مبلغ دون دفع فعلي» ⇒ مفروض من الخادم:
      //         status='paid' يستلزم قيد دفع فعلي مرجعياً.
      // ══════════════════════════════════════════════════════════════════
      match /zakatRecords/{id} {
        allow read: if isOwner(uid);

        allow create: if isOwner(uid) && ownedNew(uid)
          && dateKeyOk('hawlDate')
          && isNonNegMoney(request.resource.data.zakatableAssetsMinor)
          && isNonNegMoney(request.resource.data.deductibleLiabilitiesMinor)
          && isNonNegMoney(request.resource.data.nisabMinor)
          && isNonNegMoney(request.resource.data.zakatDueMinor)
          && isNonNegMoney(request.resource.data.paidMinor)
          && request.resource.data.status in ['computed','accrued','partiallyPaid','paid']
          && request.resource.data.paidMinor <= request.resource.data.zakatDueMinor
          // الاحتساب لا يُنتج حالة «مدفوع» ولا قيد دفع من تلقاء نفسه
          && (   request.resource.data.status != 'paid'
              || (   request.resource.data.paidMinor == request.resource.data.zakatDueMinor
                  && request.resource.data.paymentEntryIds is list
                  && request.resource.data.paymentEntryIds.size() > 0 ) )
          && (   request.resource.data.status != 'computed'
              || request.resource.data.paidMinor == 0 )
          // طريقة الحساب والمصدر إلزاميان: حاسبة إرشادية لا فتوى
          && strBetween('methodNote', 5, 2000);

        allow update: if isOwner(uid) && ownerFrozen()
          && unchanged('hawlDate')
          && isNonNegMoney(request.resource.data.zakatDueMinor)
          && isNonNegMoney(request.resource.data.paidMinor)
          && request.resource.data.status in ['computed','accrued','partiallyPaid','paid']
          && request.resource.data.paidMinor <= request.resource.data.zakatDueMinor
          && (   request.resource.data.status != 'paid'
              || (   request.resource.data.paidMinor == request.resource.data.zakatDueMinor
                  && request.resource.data.paymentEntryIds is list
                  && request.resource.data.paymentEntryIds.size() > 0 ) );

        allow delete: if false;
      }

      // ══════════════════════════════════════════════════════════════════
      //  5.14 — المرفقات (وصفية). ق-1: الواجهة معطَّلة، والقواعد جاهزة.
      //         الملف نفسه في Storage — انظر القسم 9.
      // ══════════════════════════════════════════════════════════════════
      match /attachments/{id} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && ownedNew(uid)
          && request.resource.data.storagePath ==
               'users/' + uid + '/attachments/' + id
          && request.resource.data.contentType in
               ['image/jpeg','image/png','image/webp','application/pdf']
          && request.resource.data.sizeBytes is int
          && request.resource.data.sizeBytes > 0
          && request.resource.data.sizeBytes <= 5242880            // 5MB — النواة 14.5
          && request.resource.data.status in ['uploaded','detached']
          && serverTime('createdAt');
        // فكّ الربط فقط. لا تغيير للمسار ولا للنوع ولا للحجم.
        allow update: if isOwner(uid)
          && touchedOnly(['status','detachedAt','updatedAt','caption'])
          && request.resource.data.status in ['uploaded','detached']
          && (!('caption' in request.resource.data) || strMax('caption', 300));
        allow delete: if false;        // المرفق دليل على قيد غير قابل للتغيير (أ-5)
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  6 — توثيق النية: كل ما ليس أعلاه مرفوض.
    //      ملاحظة: قواعد Firestore تُجمع بـ OR، فهذه الكتلة **لا تُلغي** شيئاً
    //      مما سُمح أعلاه؛ قيمتها توثيقية فقط. الأمان الحقيقي = غياب allow.
    // ══════════════════════════════════════════════════════════════════════
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 7. الفروقات عن مسوّدة النواة 14.3 — وثلاثة عيوب حقيقية

> **لم يُعدَّل ملف النواة.** هذه الوثيقة تنفّذ مسوّدة 14.3 وتبقي كل ثابت وكل صيغة فيها كما هي.
> ما يلي **إضافات وتشديدات وإصلاحات شكل**، وكل بند منها مُدرَج في الأسئلة المفتوحة ليُصادق عليه المالك
> قبل النشر. **لا بند منها يُرخّص ما كانت المسوّدة تمنعه.**

### 7.1 ع-أمن-1 — عيب قاتل: قراءة `resource.data` في قاعدة إنشاء (يُوقف النظام)

**الموضع 1 — `accountPeriods` في المسوّدة:**

```javascript
allow create, update: if isOwner(uid) && …
  && (rebuildRunning(uid)
      || (   request.resource.data.debitMinor  >= resource.data.debitMinor
          && request.resource.data.creditMinor >= resource.data.creditMinor )
      || !exists(/…/accountPeriods/$(id)));
```

**ما يحدث عند أول مصروف في شهر جديد** (المستند غير موجود، إعادة البناء متوقفة):
`rebuildRunning(uid)` ⇒ `false`. يُقيَّم الفرع الثاني ⇒ `resource` عند الإنشاء **`null`** ⇒
`resource.data.debitMinor` **خطأ تقييم**. و`||` في لغة القواعد يُقيَّم بالترتيب بقصر الدائرة، فالخطأ
يقع **قبل** الوصول إلى الفرع الثالث `!exists(...)` الذي كان الغرض منه تغطية حالة الإنشاء.

**الأثر الدقيق:** `runTransaction` لتسجيل أول مصروف في أي شهر جديد **تُرفض بـ `permission-denied`**.
أي: **النظام يتوقف عن قبول أي عملية مالية في اليوم الأول من كل شهر** — وكل الاختبارات التي تُنشئ
بيانات داخل شهر واحد تمرّ بنجاح فلا تكشفه.

**الموضع 2 — `obligations` في المسوّدة:**

```javascript
&& (!('totalMinor' in resource.data.keys()) || … )
```
عند الإنشاء `resource == null` ⇒ `resource.data.keys()` خطأ تقييم ⇒ **إنشاء أي التزام جديد مرفوض**.
(ويُلاحظ أن `'x' in resource.data.keys()` أصلاً نمط غير صحيح: `keys()` تُعيد قائمة، والصحيح
`'x' in resource.data` أو `resource.data.keys().hasAny(['x'])`.)

**الإصلاح المعتمد في القسم 6:** **فصل `create` عن `update`**. فالتعبير الذي يقرأ `resource.data`
لا يُقيَّم إلا في قاعدة `update` — حيث `resource` موجود دائماً. وهذا أنظف من `resource == null ||`
لأنه يحذف الشرط من مسار الإنشاء بالكامل بدل الاعتماد على ترتيب قصر الدائرة.

**البديل المرفوض:** إبقاء `allow create, update` مع `resource == null ||` في المقدمة — يعمل، لكنه
يُخفي أن القاعدتين لهما عقدان مختلفان، ويُعيد إنتاج العيب عند أي تعديل لاحق على الشرط.

### 7.2 ع-أمن-4 — عيب شكل: دوال تشير إلى `$(database)` خارج نطاقه

في المسوّدة، `rebuildNotRunning` و`periodNotLocked` و`accountExists` **مُعرَّفة قبل**
`match /databases/{database}/documents` (أي في نطاق `service`)، وهي تستخدم
`/databases/$(database)/documents/...`. المتغير `database` **لا يكون مرتبطاً** في ذلك النطاق ⇒
**الملف لا يُترجَم** (`firebase deploy` يفشل بخطأ بناء).

**الإصلاح:** كل الدوال نُقلت إلى داخل `match /databases/{database}/documents` (القسم 6).
وهذا يفسّر ضرورة البند 2 من قائمة ما قبل النشر: **ملف قواعد لم يُترجَم في المحاكي ليس قواعد.**

### 7.3 ع-أمن-2 — ميزانية استدعاءات الوصول: خطر رفض معاملات كاملة

الحدّ المعلن من Firestore: **10 استدعاءات `get`/`exists`/`getAfter` لطلب المستند الواحد، و20 لطلب
متعدد المستندات (معاملة أو دفعة)**. وقواعدنا تستدعي البوابة من قاعدة **كل** مستند.

**الحساب لكل عملية (الحد الأقصى، بافتراض عدم وجود تخزين مؤقت للاستدعاءات المتطابقة):**

| العملية | مستندات المعاملة | استدعاءات البوابة | إجمالي تقديري | الهامش حتى 20 |
|---|---|---|---|---|
| `recordExpense` | قيد 1، postings 2، accounts 2، accountPeriods 2، periods 1، budgetPeriods 0–1، operations 0 | قيد: `exists+get` للبوابة (2) + `exists` للإقفال (1) = 3؛ postings: 2×2 = 4؛ accounts: 2×2 = 4؛ accountPeriods: تحديث 2×2 = 4 | **15** | 5 |
| `transfer` | قيد 1، postings 2، accounts 2، accountPeriods 2، periods 1 | مثل أعلاه بلا ميزانية | **15** | 5 |
| `payObligation` (`nature='expense'`) | قيد 1، postings 3، accounts 3، accountPeriods 3، periods 1، budgetPeriods 1، obligations 1 | 3 + 6 + 6 + 6 + 2 = | **23** | **تجاوز** |
| `voidTransaction` | قيد عكس 1، postings 2–3، accounts 2–3، accountPeriods 2–3، periods 1، entryCorrections 1، قيد أصلي (تحديث حالة) 1 | 3 + 6 + 6 + 6 = | **21** | **تجاوز** |

**الأثر لو صحّ التقدير:** `payObligation` — وهي عملية يومية عادية — **تُرفض دائماً** بـ
`permission-denied` بلا أي رسالة مفهومة، ويبدو العيب كأنه خطأ في القواعد المنطقية لا في عدّ الاستدعاءات.

**ملاحظة أمانة:** سلوك **تخزين الاستدعاءات المتطابقة مؤقتاً** داخل تقييم الطلب الواحد قد يجعل
`get(integrityDoc(uid))` المتكرر يُحسب **مرة واحدة**، فينزل الإجمالي إلى 5–7. **لا أؤكد ذلك هنا**،
لأنه فرق بين «النظام يعمل» و«النظام لا يعمل». ⇒ **قياس إلزامي في المحاكي قبل النشر**
(حالة الاختبار ح-38 في القسم 10).

**الإصلاح المقترح إن أثبت القياس التجاوز — بوابة بالوجود لا بالقيمة:**

```javascript
// بدل قراءة حقل rebuildStatus (exists + get = استدعاءان):
// مستند خفيف يوجد **فقط** أثناء إعادة البناء ⇒ استدعاء واحد، وبلا هشاشة «غيابه يُربك البوابة».
function rebuildNotRunning(uid) {
  return !exists(/databases/$(database)/documents/users/$(uid)/meta/rebuildLock);
}
function rebuildRunning(uid) {
  return exists(/databases/$(database)/documents/users/$(uid)/meta/rebuildLock);
}
```

| المعيار | البوابة بالحقل (المسوّدة) | البوابة بالوجود (المقترح) |
|---|---|---|
| استدعاءات لكل مستند | **2** | **1** |
| `payObligation` تقديرياً | 23 | **12** |
| هشاشة «غياب المستند» | قائمة، وتحتاج نمط `!exists \|\| get` الآمن | **منتفية بنيوياً** |
| حالة `failed` | محفوظة في الحقل | تبقى في `meta/integrity.rebuildStatus` للعرض والتشخيص، والبوابة لا تقرؤها |
| التكلفة | — | كتابة/حذف مستند واحد عند بدء/انتهاء إعادة البناء |

**هذا تغيير في آلية من النواة ⇒ لا يُطبَّق من تلقاء هذه الوثيقة.** → سؤال مفتوح رقم 4.

### 7.4 ع-أمن-3 — ثقب في إقفال الفترات

`priorPeriodCorrectionOk` في المسوّدة تفحص `kind == 'reversal' && isPriorPeriodCorrection == true`
**ولا تفحص التاريخ**، مع أن تعليق النواة نفسه يقول «مسموح **فقط** لقيد عكس **بتاريخ اليوم**».

**السيناريو:** عميل معطوب (أو جهاز بنسخة قديمة) يكتب قيد عكس بـ
`periodKey = '2025-03'` (فترة مُقفلة) و`isPriorPeriodCorrection = true` ⇒ **الخادم يقبله**
⇒ قيد جديد **داخل** فترة مُقفلة، وينكسر I17 وينهار معنى الإقفال، ويصير تقرير 2025-03 المُقفل قابلاً
للتغيير بعد اعتماده.

**الإصلاح المعتمد:** `bookedWithin36h(d)` في القسم 6 — نافذة ±36 ساعة على `bookedAtTs`.
لماذا 36 ساعة وليس «اليوم» بالضبط: `bookedAtTs` منتصف نهار UTC، وفرق المناطق الزمنية ±14 ساعة،
وحساب «تاريخ اليوم» نصّياً داخل القواعد يحتاج تجميع `request.time.year()/month()/day()` مع حشو أصفار
شرطي — تعبير طويل هشّ. النافذة الزمنية تحقّق الغرض نفسه بسطرين.

**الخسارة الباقية:** يمكن للمالك تسجيل تصحيح فترة سابقة بتاريخ أمس أو غد. **مقبول** لأنه لا يسمح
بالوصول إلى فترة مُقفلة أخرى (الفترات شهرية، والنافذة 36 ساعة لا تعبر شهرين إلا في ليلة آخر الشهر —
وفي تلك الحالة الفترة المجاورة هي الشهر الجاري غير المُقفل عادة). **يُسجَّل كقصور مُعلَن.**

### 7.5 التشديدات الإضافية — الجدول الكامل

| # | التشديد | الموضع | التبرير | خطر الانحدار |
|---|---|---|---|---|
| ت-1 | `create` و`update` مفصولتان في كل مجموعة | كل المجموعات | إصلاح ع-أمن-1 | لا |
| ت-2 | `serverTime('createdAt')` على القيد | `journalEntries` create | يمنع تاريخ إنشاء مُلفَّق في سلسلة التدقيق | **نعم**: يُلزم كاتب القيد باستخدام `serverTimestamp()`. يجب التأكد أن `postOperation` تفعل ذلك |
| ت-3 | `createdBy == request.auth.uid` | `journalEntries` create | يمنع نسب قيد إلى هوية أخرى (مهم عند تعدد المستخدمين) | لا |
| ت-4 | `entryStatus == 'posted'` | `postings` create | النواة 4.4: اللقطة لا تُحدَّث، وكل posting يُكتب من قيد مُرحَّل | منخفض |
| ت-5 | `unchanged('openingBalanceMinor')` | `accounts` update | «مرآة القيد الافتتاحي لا تُكتب يدوياً أبداً» (النواة 4.2) | **نعم**: مسار «تعيين رصيد افتتاحي» يجب أن يكتبه في نفس عملية **إنشاء** الحساب أو عبر إعادة البناء. يحتاج تأكيداً من وثيقة العمليات |
| ت-6 | `freshAuth()` على `minBalanceMinor` و`status` | `accounts` update | أ-4 | نعم (تجربة استخدام): أرشفة حساب تطلب إعادة مصادقة |
| ت-7 | `freshAuth()` على `periodLocks` create و`rebuildStatus='running'` | — | أ-4، T11 | نعم (تجربة استخدام) |
| ت-8 | `I22` مفروض على **التحديث** أيضاً | `accounts` update | المسوّدة تفرضه على الإنشاء فقط ⇒ يمكن قلب `isCashLike` لحساب مستحق بعد إنشائه ⇒ المستحق يدخل «النقد المتاح» ويُكسر 19.9 | لا |
| ت-9 | `I15` مفروض على الإنشاء أيضاً | `periods` create | المسوّدة تفرضه في `create, update` المدمجة لكن بلا تحقق من نوع `householdExpenseMinor` | لا |
| ت-10 | `'overallLimitMinor' in request.resource.data` | `budgetPeriods` | يفرض القاعدة الصلبة: لا مستند ميزانية بلا سقف معرَّف (حتى لو `null`) ⇒ بطاقة «نسبة استهلاك الميزانية» لا تقسم على سقف غائب | متوسط: كاتب الميزانية يجب أن يُمرِّر `null` صريحاً |
| ت-11 | `extraChargesMinor > 0 ⇒ extraChargesReason` | `obligations` | ADR-012: «إلزامي عند أي زيادة > 0» — المسوّدة لم تفرضه | لا |
| ت-12 | `unchanged('principalMinor')` | `debts` update | أصل الدين قيمة متعاقد عليها؛ تغييره يُتلف I6 تاريخياً | متوسط: تصحيح أصل الدين يصير «دين جديد + إلغاء» |
| ت-13 | `writtenOffMinor > 0 ⇒ direction == 'receivable'` | `debts` | الشطب للمستحق لي فقط (النواة 4.6) | لا |
| ت-14 | `serverTime('at')` + قائمة `action` المغلقة | `auditLogs` create | T9: سجل تدقيق بوقت جهاز قابل للتلفيق ليس سجل تدقيق | نعم: يُلزم `serverTimestamp()` |
| ت-15 | `docId in ['integrity','schema']` | `meta` | يمنع إنشاء مستندات meta عشوائية تُربك البوابة والترحيل | لا |
| ت-16 | قائمة `settings` المغلقة | `settings` | يمنع استخدام `settings` كمخزن عام غير مُتحقَّق منه | متوسط |
| ت-17 | `status != 'done' \|\| completedAt != null` | `tasks` | المتطلبات القسم 14: «لا تُعرض مهمة كمكتملة دون إجراء إكمال صريح» | لا |
| ت-18 | `status == 'paid' ⇒ paymentEntryIds` غير فارغ | `zakatRecords` | المتطلبات 15.4: **فصل الاحتساب عن الدفع** — مفروض من الخادم لا بالواجهة | لا |
| ت-19 | `storagePath == 'users/{uid}/attachments/{id}'` | `attachments` | يمنع مستند مرفق يشير إلى ملف مستخدم آخر | لا |
| ت-20 | `allow write: if false` على `users/{uid}` يبقى ⇒ الملف الشخصي في `settings/profile` | — | مُوثَّق في القسم 4 | نعم: توثيقي |

**قاعدة مُلزِمة على ت-2 و ت-5 و ت-10 و ت-14:** هذه الأربعة **تفشل فشلاً صاخباً** إن لم يطابقها
كاتب البيانات. وهذا مقصود (خير من انحراف صامت)، لكنه يستوجب تشغيل حزمة اختبارات القواعد **قبل**
أي نشر، لأن اختبار الوحدة لطبقة النطاق لا يكشفها.

---

## 8. ما لا تستطيعه قواعد Firestore — بالصراحة الكاملة

### 8.1 الجدول الفاصل

| ما تفرضه القواعد (يستحيل خرقه من أي عميل) | ما **لا** تفرضه (يُكشف لاحقاً فقط) |
|---|---|
| **I1** توازن كل قيد | **أن الرصيد = مجموع الحركات.** القواعد تفرض أن `balanceMinor` **متسق مع الإجماليين**، لا أن الإجماليين يطابقان مجموع سطور القيود |
| **I3** الرصيد مشتق من الإجماليين | أن الإجماليين زادا **بمقدار سطور هذا القيد بالضبط** |
| **I5/I6** منع السداد والتحصيل الزائد، وصحة المشتقات | أن `paidMinor` يطابق مجموع الدفعات الفعلية (⇐ I5b بالتجميع الخادمي، **كشف لا منع**) |
| **I15** مصاريف المنزل مجموع فرعي لا إضافة | أن القيد الموسوم `household` فئته فعلاً تحت `expense.home` |
| **I17** لا ترحيل في فترة مُقفلة (+ إصلاح 7.4) | — |
| **I18** تماسك `periodKey` مع `bookedAt` | — |
| **I22** المستحق ليس نقداً متاحاً | **صحة اتجاه القيد محاسبياً** (قلب مدين/دائن متوازن يمرّ) |
| **I24** بوابة إعادة البناء | محتويات `lines` حساباً حساباً (لغة القواعد بلا حلقات) |
| حدّ الرصيد المطلق `balanceMinor >= minBalanceMinor` | حدّ الرصيد **المشروط على الدلتا** |
| عدم قابلية الدفتر و`postings` للتغيير، ومنع الحذف المالي | — |
| **ق-2** إغلاق النظام على UID المالك | — |

### 8.2 السؤال المطروح صراحةً: هل نقبل أن العميل الموثوق هو من يحسب؟

**الجواب: نعم، بشروط، ومع إعلان الحدّ.**

**لماذا يُقبل اليوم — أربعة أسباب موضوعية لا تبريرية:**

1. **الخصم الوحيد الممكن هو المالك نفسه.** ق-2 يُغلق النظام على UID واحد. من يستطيع كتابة رقم
   خاطئ هو من يملك البيانات ويتضرر وحده. **تهديد «المستخدم الخبيث» غير موجود هنا** — والتهديد الواقعي
   هو **الخطأ البرمجي** (T3)، وضدّه القواعد تعمل فعلاً: بيان مُشوَّه يُرفض.
2. **ما يُفلت ليس «رقماً عشوائياً» بل رقماً متسقاً داخلياً.** لإفلات انحراف يجب أن يكتب العميل
   `debitTotalMinor` و`creditTotalMinor` و`balanceMinor` **متوافقة مع I3**، و`balanceVersion` متزايداً،
   وقيداً متوازناً، و`postings` مطابقة لشكلها. هذا نمط خطأ **ضيق جداً**: خطأ في **مقدار** الدلتا
   مع صحة **كل شكل** آخر.
3. **ذلك النمط بالضبط مكشوف بأربعة ثوابت رخيصة:** I4 (ميزان المراجعة، ~45 قراءة عند كل تسجيل دخول)،
   I11 (`Σ signedAmountMinor` من `postings` مقابل رصيد الحساب، قراءتان)، I5b/I6b
   (`Σ settlementDeltaMinor` مقابل `paidMinor`/`settledMinor`، قراءتان). `postings` **مصدر مستقل**
   عن `accounts`، فانحراف المقدار يُظهر فرقاً بينهما.
4. **لا شيء يُمحى.** الدفتر غير قابل للحذف والتعديل المحاسبي. فأي خطأ **قابل للإصلاح بإعادة البناء من
   الدفتر** — والدفتر هو ما تفرض القواعد شكله فرضاً كاملاً. أي: **نحمي المصدر فرضاً، ونكشف المشتق كشفاً.**
   وهذه قسمة صحيحة تقنياً لا تنازل.

**المخاطر الحقيقية الباقية في نظام أحادي المستخدم — بالاسم:**

| الخطر | الاحتمال | الكاشف | زمن الكشف |
|---|---|---|---|
| خطأ برمجي يُضاعف دلتا رصيد | متوسط | I11 / I4 | أول تسجيل دخول بعد الخطأ |
| جهاز بنسخة قديمة يكتب مُجمَّعاً بمعنى قديم | متوسط | حارس `SCHEMA_VERSION_AHEAD` يمنعه **مسبقاً** | — |
| تعارض تزامن يُفقد تحديثاً | منخفض (`runTransaction` + `balanceVersion`) | I7 / I8 | الفاحص الشهري |
| XSS يكتب قيوداً زائفة متوازنة | منخفض | تظهر في «دفتر القيود» وفي I5b إن مسّت كياناً | قد يتأخر |
| المالك يكتب يدوياً من Console | منخفض | الفاحص | متغيّر |

### 8.3 متى يصبح هذا **غير مقبول** — ثلاثة شروط بالاسم

1. **إضافة مستخدم ثانٍ** (موقف النواة 18.4، وأتبنّاه). عندها يصير «العميل الموثوق» عميل **شخص آخر**،
   ويصبح انحراف المقدار **تهديداً لا خطأً**. ⇒ شرط الترقية الحقيقي.
2. **استخدام الأرقام في التزام تجاه الغير**: إقرار زكوي/ضريبي، أو اتفاق مع دائن، أو أي سياق يحتاج
   سجلاً لا يُطعَن فيه. عندها يلزم فرض خادمي.
3. **تشغيل التطبيق في بيئة لا يملكها المالك**: جهاز مشترك، متصفح بملحقات غير موثوقة، أو شبكة تُحقن
   فيها السكربتات. عندها T4 يصير مرجَّحاً، والكتابة الزائفة المتوازنة تمرّ.

### 8.4 التوصية الواضحة

> **اعتمد التصميم الحالي الآن، وثبّت أربعة شروط تشغيلية غير قابلة للتفاوض:**
>
> 1. **الفاحص الرخيص يعمل عند كل تسجيل دخول** (I4 ميزان المراجعة، ~45 قراءة). وإذا انكسر:
>    **إيقاف تسجيل العمليات** بـ `TRIAL_BALANCE_BROKEN` — لا تحذير يُتجاهل، بل **منع**.
> 2. **الفاحص الكامل شهرياً** (I7, I11, I5b, I6b, I13) من شاشة «الإعدادات ← سلامة البيانات»،
>    بتذكير داخل التطبيق لا بجدولة (Spark، ق-1).
> 3. **تصدير JSON شهري** يُحفَظ خارج الجهاز. فهو ما يحوّل «انحراف مكتشف» إلى «انحراف قابل للإصلاح».
> 4. **اختبار جدولي لكل صف في القسم 19** من المتطلبات (الاتجاه والمبلغ والحساب) + `assertKindShape`،
>    مفروضاً في CI. هذا هو **البديل الفعلي** عن الفرض الخادمي للمقدار، وليس تحسيناً اختيارياً.
>
> **وخطة الترقية جاهزة من الآن:** عند Blaze ⇒ `allow create, update: if false` على
> `journalEntries`/`postings`/`accounts` من العميل، وCloud Function كاتب وحيد يستدعي **نفس**
> `planOperation` النقية. **تفعيل ميزة لا إعادة بناء** (ق-1). لا سطر في النواة يحتاج تغييراً لذلك.

---

## 9. `storage.rules` — المحتوى الكامل

### 9.1 الحالة والعقد

**ق-1: Firebase Storage يتطلب Blaze ⇒ المرفقات مؤجَّلة.** والقواعد تُكتب وتُراجَع **من الآن**
لثلاثة أسباب: (1) الحقل `attachmentIds` و مجموعة `attachments` الوصفية موجودة في المخطط من الإصدار
الأول، (2) التفعيل عند الترقية يصير **خطوة نشر واحدة** لا تصميماً جديداً، (3) مراجعة أمنية مؤجَّلة
هي مراجعة لا تحدث.

**حدّ الحجم المعتمد: 5MB** (النواة 14.5) — **لا 10MB** كما ورد في صياغة المهمة؛ النواة هي العقد.
→ سؤال مفتوح رقم 5.

```javascript
rules_version = '2';

// ════════════════════════════════════════════════════════════════════════════
//  رصيد | RASEED — storage.rules
//  الحالة: جاهز، غير مُفعَّل (ق-1: Storage يتطلب Blaze).
//  عند التفعيل: firebase deploy --only storage
//  مُلزِم: نفس allowedUids الموجودة في firestore.rules — تُحدَّثان معاً دائماً.
// ════════════════════════════════════════════════════════════════════════════

service firebase.storage {
  match /b/{bucket}/o {

    // ── الهوية (ق-2) ───────────────────────────────────────────────────
    function allowedUids() {
      return ['REPLACE_WITH_OWNER_UID'];
    }
    function isSignedIn() {
      return request.auth != null;
    }
    function isOwner(uid) {
      return isSignedIn()
          && request.auth.uid == uid
          && uid in allowedUids();
    }

    // ── الحجم والنوع ───────────────────────────────────────────────────
    // 5MB = 5 * 1024 * 1024 (النواة 14.5). رفض الملف الفارغ أيضاً.
    function sizeOk() {
      return request.resource.size > 0
          && request.resource.size <= 5 * 1024 * 1024;
    }

    // قائمة مغلقة. **image/svg+xml مستبعد عمداً**: SVG مستند XML ينفّذ سكربتاً
    // عند عرضه من نفس الأصل ⇒ ناقل XSS مباشر على نطاق التطبيق (T8).
    function allowedType() {
      return request.resource.contentType in [
        'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
      ];
    }

    // تطابق الامتداد مع النوع المُعلَن: يمنع PDF يحمل اسم .png (والعكس)،
    // وهو ما يُربك العارض ويفتح باب تحميل مُضلِّل.
    function extMatchesType(name) {
      return (request.resource.contentType == 'application/pdf'
              && name.matches('.*\\.pdf$'))
          || (request.resource.contentType == 'image/png'
              && name.matches('.*\\.png$'))
          || (request.resource.contentType == 'image/webp'
              && name.matches('.*\\.webp$'))
          || (request.resource.contentType == 'image/jpeg'
              && name.matches('.*\\.(jpg|jpeg)$'));
    }

    // اسم الملف = معرّف المرفق + الامتداد. لا مسارات فرعية، ولا أسماء من
    // إدخال المستخدم (تمنع العبور بالمسار وأسماء Windows المحجوزة).
    function nameOk(name) {
      return name.matches('^[A-Za-z0-9_-]{8,64}\\.(jpg|jpeg|png|webp|pdf)$');
    }

    // الوصفية الإلزامية: تربط الملف بمالكه وبالقيد الذي يُثبته.
    function metaOk(uid) {
      return request.resource.metadata != null
          && request.resource.metadata.ownerUid == uid
          && request.resource.metadata.attachmentId is string;
    }

    // ── المرفقات: المسار الوحيد المسموح ────────────────────────────────
    match /users/{uid}/attachments/{attachmentFile} {

      allow read: if isOwner(uid);

      allow create: if isOwner(uid)
          && sizeOk()
          && allowedType()
          && nameOk(attachmentFile)
          && extMatchesType(attachmentFile)
          && metaOk(uid);

      // الملف غير قابل للاستبدال: إعادة الرفع على نفس المسار تُغيّر دليلاً
      // مرتبطاً بقيد غير قابل للتغيير. التصحيح = مرفق جديد + فكّ ربط القديم.
      allow update: if false;

      // أ-5: لا حذف. حذف الملف يُنتج مرجعاً معلّقاً في قيد لا يُعدَّل،
      // ويسمح بإتلاف إثبات سجل مالي. «فكّ الربط» يحدث في Firestore
      // (attachments.status = 'detached') والملف يبقى.
      allow delete: if false;
    }

    // ── كل ما سوى ذلك مرفوض صراحةً ─────────────────────────────────────
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

### 9.2 ضوابط مرافقة لا تُفرَض بالقواعد

| الضابط | التنفيذ | لماذا لا يكفي القواعد |
|---|---|---|
| `Content-Disposition: attachment` على التنزيل | يُضبط في `customMetadata` عند الرفع، أو `contentDisposition` في `uploadBytes` | يمنع عرض PDF/HTML مُضمَّناً في نطاق التطبيق |
| عرض الصور في `<img>` فقط، لا `<object>`/`<embed>` | مراجعة كود + CSP `object-src 'none'` | قواعد Storage لا تعرف كيف يُعرض الملف |
| PDF يُعرض في `<iframe sandbox>` أو يُنزَّل | مكوّن واحد مخصص | عارض PDF الأصلي قوي الصلاحيات |
| التحقق من الرأس السحري (magic bytes) | على العميل قبل الرفع | القواعد تثق بـ `contentType` المُعلَن من العميل — **حدّ معلن** |
| تنظيف المرفقات المعلّقة (status='detached') | سكربت محلي بـ Admin SDK عند الحاجة | `allow delete: if false` تمنع الحذف من العميل بقصد |

> **حدّ معلن:** `request.resource.contentType` **يُعلنه العميل**. قواعد Storage لا تفحص محتوى الملف.
> ملف تنفيذي مُسمّى `x.png` بنوع مُعلَن `image/png` **يُقبَل**. وهو غير خطير هنا لأن: (أ) الرافع
> الوحيد هو المالك، (ب) القراءة محصورة بالمالك، (ج) `object-src 'none'` و`Content-Disposition`
> يمنعان التنفيذ في سياق التطبيق. يصبح خطيراً **لو** شُورك رابط عام — ولذلك **لا رابط عام إطلاقاً**:
> لا `makePublic`، ولا قواعد `allow read: if true`، ولا روابط تنزيل مُشارَكة.

---

## 10. خطة اختبار القواعد — `@firebase/rules-unit-testing`

### 10.1 المبدأ

> «Security Rules ليست جاهزة لمجرد كتابتها؛ تُختبر وتُنشر بعد الموافقة» — المتطلبات، القسم 25 بند 10.

**ثلاث قواعد على الحزمة:**

1. **كل حالة تُنفَّذ على المحاكي**، لا على المشروع الحقيقي. `firebase emulators:exec`.
2. **لكل ثابت مفروض من الخادم حالة سلبية واحدة على الأقل.** ثابت بلا حالة سلبية = ثابت غير مُختبَر.
3. **الحزمة بوابة CI**: الفشل يمنع النشر. `firebase deploy --only firestore:rules` لا يُنفَّذ إلا بعد الأخضر.

```jsonc
// package.json
{
  "scripts": {
    "test:rules": "firebase emulators:exec --only firestore,storage \"vitest run tests/rules\""
  }
}
```

```jsonc
// firebase.json (المقاطع المتعلقة بالاختبار)
{
  "emulators": {
    "firestore": { "port": 8080 },
    "storage":   { "port": 9199 },
    "auth":      { "port": 9099 },
    "ui":        { "enabled": true }
  },
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage":   { "rules": "storage.rules" }
}
```

### 10.2 المهاد المشترك

```ts
// tests/rules/harness.ts
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment, type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc,
         serverTimestamp, Timestamp } from 'firebase/firestore';

export const OWNER  = 'owner-uid-fixed';      // == allowedUids() في ملف الاختبار
export const OTHER  = 'intruder-uid';         // مستخدم مُصادق لكنه غير مُعتمد
export const SECOND = 'second-owner-uid';     // مالك شجرة أخرى

let env: RulesTestEnvironment;

export async function setup() {
  // UID المالك يُستبدل في نسخة الاختبار من الملف — لا تعديل يدوي ولا ملف مكرر.
  const rules = readFileSync('firestore.rules', 'utf8')
                  .replace('REPLACE_WITH_OWNER_UID', OWNER);
  env = await initializeTestEnvironment({
    projectId: 'raseed-rules-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
    storage:   { rules: readFileSync('storage.rules', 'utf8')
                   .replace('REPLACE_WITH_OWNER_UID', OWNER),
                 host: '127.0.0.1', port: 9199 },
  });
  return env;
}

/** جلسة المالك بمصادقة **حديثة** (auth_time = الآن). */
export function ownerFresh(): RulesTestContext {
  return env.authenticatedContext(OWNER, {
    email: 'albarshi.96@gmail.com', email_verified: true,
    auth_time: Math.floor(Date.now() / 1000),
  });
}

/** جلسة المالك بمصادقة **قديمة** (قبل ساعتين) — لاختبار حارس أ-4. */
export function ownerStale(): RulesTestContext {
  return env.authenticatedContext(OWNER, {
    email: 'albarshi.96@gmail.com', email_verified: true,
    auth_time: Math.floor(Date.now() / 1000) - 7200,
  });
}

export function intruder(): RulesTestContext {
  return env.authenticatedContext(OTHER, {
    email: 'someone@example.com', email_verified: true,
    auth_time: Math.floor(Date.now() / 1000),
  });
}

export function anon(): RulesTestContext { return env.unauthenticatedContext(); }

/** بذر بيانات بتجاوز القواعد — للتحضير فقط، لا للتأكيد. */
export async function seed(fn: (db: any) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

export const P = {
  entry:   (id: string) => `users/${OWNER}/journalEntries/${id}`,
  posting: (id: string) => `users/${OWNER}/postings/${id}`,
  account: (id: string) => `users/${OWNER}/accounts/${id}`,
  accPer:  (id: string) => `users/${OWNER}/accountPeriods/${id}`,
  period:  (pk: string) => `users/${OWNER}/periods/${pk}`,
  budget:  (pk: string) => `users/${OWNER}/budgetPeriods/${pk}`,
  oblig:   (id: string) => `users/${OWNER}/obligations/${id}`,
  debt:    (id: string) => `users/${OWNER}/debts/${id}`,
  audit:   (id: string) => `users/${OWNER}/auditLogs/${id}`,
  lock:    (pk: string) => `users/${OWNER}/periodLocks/${pk}`,
  meta:    (id: string) => `users/${OWNER}/meta/${id}`,
  task:    (id: string) => `users/${OWNER}/tasks/${id}`,
  zakat:   (id: string) => `users/${OWNER}/zakatRecords/${id}`,
  attach:  (id: string) => `users/${OWNER}/attachments/${id}`,
};

/** قيد مصروف صحيح بالكامل — نقطة البداية لكل حالة سلبية (تُفسد حقلاً واحداً). */
export function validExpenseEntry(over: Record<string, unknown> = {}) {
  const opId = over.opId as string ?? 'exp_2026-03-11_abc123';
  return {
    opId, kind: 'expense', status: 'posted',
    bookedAt: '2026-03-11', bookedAtTs: Timestamp.fromDate(new Date('2026-03-11T12:00:00Z')),
    periodKey: '2026-03',
    description: 'وقود',
    lines: [
      { lineNo: 1, accountId: 'acc_exp_transport', accountType: 'expense',
        accountCode: 'expense.transport', side: 'debit',  amountMinor: 25500 },
      { lineNo: 2, accountId: 'acc_cash_main',     accountType: 'asset',
        accountCode: 'asset.cash.main',   side: 'credit', amountMinor: 25500 },
    ],
    accountIds: ['acc_exp_transport', 'acc_cash_main'],
    accountTypes: ['expense', 'asset'],
    totalDebitMinor: 25500, totalCreditMinor: 25500, amountMinor: 25500,
    currency: 'LYD', ownerUid: OWNER, schemaVersion: 1,
    payloadHash: 'a'.repeat(64),
    tags: ['personal'], refs: {},
    createdBy: OWNER, createdAt: serverTimestamp(),
    clientCreatedAt: '2026-03-11T14:03:00.000Z',
    ...over,
  };
}
```

### 10.3 قائمة حالات الاختبار — 44 حالة

**العزل والهوية (ق-2)**

| # | الحالة | المتوقع |
|---|---|---|
| ح-1 | غير المسجّل يقرأ `users/{OWNER}/journalEntries/*` | **رفض** |
| ح-2 | غير المسجّل يقرأ `users/{OWNER}/accounts/*` | **رفض** |
| ح-3 | غير المسجّل يكتب أي مستند في أي مجموعة | **رفض** |
| ح-4 | المستخدم ب (مُصادق، غير مُعتمد) يقرأ بيانات المالك | **رفض** |
| ح-5 | المستخدم ب يكتب في `users/{OWNER}/...` | **رفض** |
| ح-6 | **المستخدم ب يكتب في شجرته `users/{OTHER}/accounts/x`** ← جوهر ق-2 | **رفض** (لولا `uid in allowedUids()` لكان مسموحاً) |
| ح-7 | المستخدم ب يقرأ شجرته هو `users/{OTHER}/...` | **رفض** |
| ح-8 | المالك يقرأ `users/{SECOND}/...` (شجرة غيره) | **رفض** |
| ح-9 | المالك يكتب على مستند `users/{OWNER}` نفسه | **رفض** (`write: if false`) |
| ح-10 | المالك يقرأ ويكتب في مجموعاته | **نجاح** |
| ح-11 | كتابة في مجموعة غير معرَّفة في القواعد (`users/{OWNER}/randomStuff/x`) | **رفض** |

**بنية القيد — I1, I2, I18**

| # | الحالة | المتوقع |
|---|---|---|
| ح-12 | قيد صحيح بالكامل، `entryId == opId` | **نجاح** |
| ح-13 | `totalDebitMinor != totalCreditMinor` (25500 / 1) ← **I1** | **رفض** |
| ح-14 | قيد بسطر واحد (`lines.size() == 1`) | **رفض** |
| ح-15 | `lines.size() == 51` | **رفض** |
| ح-16 | **`totalDebitMinor` سالب (-25500)** | **رفض** |
| ح-17 | **`totalDebitMinor` كسر عشري (25.5)** ← `is int` | **رفض** |
| ح-18 | `totalDebitMinor` يتجاوز `MAX_ABS_MINOR` | **رفض** |
| ح-19 | `periodKey = '2026-04'` مع `bookedAt = '2026-03-11'` ← **I18** | **رفض** |
| ح-20 | `status = 'reversed'` عند الإنشاء | **رفض** |
| ح-21 | `currency = 'USD'` | **رفض** |
| ح-22 | `description` فارغ | **رفض** |
| ح-23 | `payloadHash` بطول 10 بدل 64 | **رفض** |
| ح-24 | `entryId` لا يساوي `opId` ولا `opId__1..3` | **رفض** |
| ح-25 | `ownerUid = OTHER` داخل شجرة المالك | **رفض** |
| ح-26 | `createdBy = OTHER` (ت-3) | **رفض** |
| ح-27 | `createdAt` بوقت الجهاز لا `serverTimestamp()` (ت-2) | **رفض** |

**عدم قابلية الدفتر للتغيير**

| # | الحالة | المتوقع |
|---|---|---|
| ح-28 | تعديل `amountMinor` على قيد مُرحَّل | **رفض** |
| ح-29 | تعديل `lines` على قيد مُرحَّل | **رفض** |
| ح-30 | تعديل `bookedAt` أو `periodKey` | **رفض** |
| ح-31 | تعديل `description` و`tags` فقط | **نجاح** |
| ح-32 | تعديل `status` إلى `'reversed'` + `reversedByEntryId` | **نجاح** |
| ح-33 | **حذف قيد** | **رفض** |
| ح-34 | تعديل قيد `kind='reversal'` | **رفض** |
| ح-35 | **تعديل `postings`** | **رفض** |
| ح-36 | **حذف `postings`** | **رفض** |
| ح-37 | `postingId` لا يطابق `entryId__lineNo` | **رفض** |
| ح-38 | `signedAmountMinor` لا يساوي `±amountMinor` | **رفض** |

**الحسابات — I3, I22, حدّ الرصيد**

| # | الحالة | المتوقع |
|---|---|---|
| ح-39 | إنشاء حساب برصيد ابتدائي غير صفري | **رفض** |
| ح-40 | إنشاء حساب `normalSide='credit'` ونوعه `asset` | **رفض** |
| ح-41 | إنشاء حساب `subtype='receivable'` و`isCashLike=true` ← **I22** | **رفض** |
| ح-42 | **قلب `isCashLike` إلى `true` على حساب مستحق قائم** (ت-8) | **رفض** |
| ح-43 | تحديث `balanceMinor` لا يطابق الإجماليين ← **I3** | **رفض** |
| ح-44 | تحديث يُنزل `balanceMinor` دون `minBalanceMinor` | **رفض** |
| ح-45 | تحديث بـ `balanceVersion` غير متزايد | **رفض** |
| ح-46 | **تنقيص `debitTotalMinor` وإعادة البناء متوقفة** | **رفض** |
| ح-47 | تنقيص `debitTotalMinor` و`rebuildStatus='running'` | **نجاح** |
| ح-48 | تغيير `type` أو `code` أو `normalSide` | **رفض** |
| ح-49 | تغيير `openingBalanceMinor` (ت-5) | **رفض** |
| ح-50 | **حذف حساب** | **رفض** |
| ح-51 | تغيير `minBalanceMinor` بمصادقة **قديمة** (ت-6) | **رفض** |
| ح-52 | تغيير `minBalanceMinor` بمصادقة **حديثة** | **نجاح** |

**المُجمَّعات — ع-أمن-1 و I15**

| # | الحالة | المتوقع |
|---|---|---|
| ح-53 | **إنشاء `accountPeriods` لشهر جديد وإعادة البناء متوقفة** ← **اختبار الانحدار لـ ع-أمن-1** | **نجاح** |
| ح-54 | `accountPeriods` بمعرّف لا يطابق `accountId__periodKey` | **رفض** |
| ح-55 | تنقيص `debitMinor` في `accountPeriods` بلا إعادة بناء | **رفض** |
| ح-56 | `periods.householdExpenseMinor > totalExpenseMinor` ← **I15** (إنشاء) | **رفض** |
| ح-57 | `periods.householdExpenseMinor > totalExpenseMinor` (تحديث) | **رفض** |
| ح-58 | `periods` بمعرّف لا يساوي `periodKey` | **رفض** |
| ح-59 | إنشاء `budgetPeriods` بلا حقل `overallLimitMinor` (ت-10) | **رفض** |
| ح-60 | إنشاء `budgetPeriods` بـ `overallLimitMinor: null` صريح | **نجاح** |
| ح-61 | `overallSpentMinor` سالب | **رفض** |
| ح-62 | **حذف أي مُجمَّع** | **رفض** |

**الالتزامات والديون — I5, I6**

| # | الحالة | المتوقع |
|---|---|---|
| ح-63 | **إنشاء التزام جديد وإعادة البناء متوقفة** ← **اختبار الانحدار الثاني لـ ع-أمن-1** | **نجاح** |
| ح-64 | `paidMinor > totalMinor + extraChargesMinor` ← **I5** | **رفض** |
| ح-65 | `remainingMinor` لا يطابق المشتق | **رفض** |
| ح-66 | رفع `totalMinor` على التزام قائم (ADR-012) | **رفض** |
| ح-67 | `extraChargesMinor > 0` بلا `extraChargesReason` (ت-11) | **رفض** |
| ح-68 | `nature` بقيمة غير `expense\|financing` | **رفض** |
| ح-69 | `paidMinor` سالب | **رفض** |
| ح-70 | `settledMinor + writtenOffMinor > principalMinor` ← **I6** | **رفض** |
| ح-71 | `allowOverSettle = true` | **رفض** |
| ح-72 | `writtenOffMinor > 0` على دين `payable` (ت-13) | **رفض** |
| ح-73 | تغيير `principalMinor` (ت-12) أو `direction` | **رفض** |
| ح-74 | **حذف التزام أو دين** | **رفض** |

**الفترات المُقفلة — I17 و ع-أمن-3**

| # | الحالة | المتوقع |
|---|---|---|
| ح-75 | ترحيل قيد بـ `periodKey` لفترة لها `periodLocks/{pk}` | **رفض** |
| ح-76 | قيد عكس `isPriorPeriodCorrection=true` بتاريخ **اليوم** في فترة مُقفلة | **نجاح** |
| ح-77 | **قيد عكس `isPriorPeriodCorrection=true` بتاريخ قديم (قبل شهرين) في فترة مُقفلة** ← ع-أمن-3 | **رفض** |
| ح-78 | قيد `kind='expense'` بـ `isPriorPeriodCorrection=true` في فترة مُقفلة | **رفض** |
| ح-79 | إنشاء `periodLocks` بمصادقة قديمة (ت-7) | **رفض** |
| ح-80 | **تعديل أو حذف `periodLocks`** | **رفض** |
| ح-81 | `periodLocks` بـ `reason` أقل من 5 أحرف | **رفض** |

**البوابة وسجل التدقيق — I24 و T9 و T11**

| # | الحالة | المتوقع |
|---|---|---|
| ح-82 | ترحيل قيد و`rebuildStatus='running'` ← **I24** | **رفض** |
| ح-83 | ترحيل قيد و`meta/integrity` **غير موجود** (النمط الآمن) | **نجاح** |
| ح-84 | **حذف `meta/integrity`** | **رفض** |
| ح-85 | `rebuildStatus = 'weird'` | **رفض** |
| ح-86 | `rebuildStatus = 'running'` بمصادقة **قديمة** (T11) | **رفض** |
| ح-87 | `rebuildStatus = 'running'` بمصادقة **حديثة** | **نجاح** |
| ح-88 | إنشاء `auditLogs` | **نجاح** |
| ح-89 | **تعديل `auditLogs`** | **رفض** |
| ح-90 | **حذف `auditLogs`** | **رفض** |
| ح-91 | `auditLogs.action` بقيمة خارج القائمة (ت-14) | **رفض** |
| ح-92 | `auditLogs.at` بوقت الجهاز لا `serverTimestamp()` | **رفض** |
| ح-93 | `auditLogs.by != request.auth.uid` | **رفض** |
| ح-94 | **تعديل أو حذف `entryCorrections`** (ADR-014) | **رفض** |
| ح-95 | `entryCorrections.reason` أقل من 5 أحرف | **رفض** |

**غير المالي**

| # | الحالة | المتوقع |
|---|---|---|
| ح-96 | مهمة بـ `status='done'` و`completedAt=null` (ت-17) | **رفض** |
| ح-97 | مهمة بـ `status='done'` و`completedAt` موجود | **نجاح** |
| ح-98 | حذف مهمة أو ملاحظة | **نجاح** |
| ح-99 | ملاحظة بـ `bodyHtml` يتجاوز 100,000 حرف | **رفض** |
| ح-100 | `zakatRecords` بـ `status='paid'` و`paymentEntryIds=[]` (ت-18) | **رفض** |
| ح-101 | `zakatRecords` بـ `status='computed'` و`paidMinor > 0` | **رفض** |
| ح-102 | `zakatRecords` بلا `methodNote` | **رفض** |
| ح-103 | **حذف `zakatRecords` أو `worshipRecords`** | **رفض** |
| ح-104 | `worshipRecords` بمفتاح صلاة غير معروف (`'tahajjud'` في `prayers`) | **رفض** |
| ح-105 | `worshipRecords` بمعرّف لا يطابق `dateKey` | **رفض** |
| ح-106 | `quranProgress.pagesRead = 700` | **رفض** |
| ح-107 | `settings/{docId}` بمعرّف خارج القائمة (ت-16) | **رفض** |
| ح-108 | `settings/app` بـ `currency='USD'` | **رفض** |
| ح-109 | `attachments.storagePath` يشير إلى `users/{OTHER}/...` (ت-19) | **رفض** |
| ح-110 | `attachments.sizeBytes = 6291456` (6MB) | **رفض** |
| ح-111 | **حذف `attachments`** (أ-5) | **رفض** |

**Storage (تُنفَّذ عند التفعيل، ومحاكي Storage يسمح بتشغيلها من الآن)**

| # | الحالة | المتوقع |
|---|---|---|
| ح-112 | المالك يرفع `abc12345.jpg` بنوع `image/jpeg` وحجم 1MB ووصفية صحيحة | **نجاح** |
| ح-113 | رفع ملف 6MB | **رفض** |
| ح-114 | رفع ملف بحجم 0 | **رفض** |
| ح-115 | رفع `x.svg` بنوع `image/svg+xml` | **رفض** |
| ح-116 | رفع بنوع `application/pdf` واسم `.png` (`extMatchesType`) | **رفض** |
| ح-117 | رفع على مسار `users/{OTHER}/attachments/...` | **رفض** |
| ح-118 | رفع باسم يحتوي `../` أو مسافات | **رفض** |
| ح-119 | رفع بلا `metadata.ownerUid` | **رفض** |
| ح-120 | المستخدم ب يقرأ مرفق المالك | **رفض** |
| ح-121 | **استبدال ملف قائم (update)** | **رفض** |
| ح-122 | **حذف ملف** | **رفض** |

**ميزانية استدعاءات الوصول (ع-أمن-2) — حالة إلزامية قبل النشر**

| # | الحالة | المتوقع |
|---|---|---|
| ح-123 | `runTransaction` تحاكي `payObligation` كاملة: قيد + 3 postings + 3 accounts + 3 accountPeriods + periods + budgetPeriods + obligations | **نجاح**. أي فشل بـ `permission-denied` مع صحة كل الشروط منطقياً ⇒ **تجاوز حدّ الاستدعاءات** ⇒ تطبيق بوابة الوجود (7.3) |
| ح-124 | `runTransaction` تحاكي `voidTransaction` كاملة | **نجاح** (نفس المعيار) |

> **المجموع: 124 حالة** (المطلوب كان 25 على الأقل). الحالات **ح-53 و ح-63 و ح-77 و ح-123**
> هي اختبارات انحدار للعيوب الثلاثة المُشخَّصة في القسم 7 — **لا تُحذف من الحزمة أبداً.**

### 10.4 نماذج تنفيذ فعلية

```ts
// tests/rules/isolation.spec.ts
import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { setup, ownerFresh, intruder, anon, P, OTHER, validExpenseEntry } from './harness';

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.cleanup(); });

describe('ق-2 — عزل البيانات وإغلاق النظام', () => {

  it('ح-1: غير المسجّل لا يقرأ الدفتر', async () => {
    await assertFails(getDoc(doc(anon().firestore(), P.entry('any'))));
  });

  it('ح-4: المستخدم ب لا يقرأ بيانات المالك', async () => {
    await assertFails(getDoc(doc(intruder().firestore(), P.account('acc_cash_main'))));
  });

  // ★ جوهر ق-2: لولا الشرط الثاني في isOwner لكانت هذه الحالة ناجحة.
  it('ح-6: المستخدم ب لا يكتب حتى في شجرته هو', async () => {
    await assertFails(setDoc(
      doc(intruder().firestore(), `users/${OTHER}/accounts/acc_x`),
      { ownerUid: OTHER, schemaVersion: 1, type: 'asset', currency: 'LYD' },
    ));
  });

  it('ح-11: مجموعة غير معرَّفة في القواعد مرفوضة', async () => {
    await assertFails(setDoc(
      doc(ownerFresh().firestore(), 'users/owner-uid-fixed/randomStuff/x'),
      { ownerUid: 'owner-uid-fixed', schemaVersion: 1 },
    ));
  });
});

describe('I1 — توازن القيد مفروض من الخادم', () => {

  it('ح-12: قيد صحيح يُقبَل', async () => {
    const db = ownerFresh().firestore();
    await assertSucceeds(setDoc(
      doc(db, P.entry('exp_2026-03-11_abc123')), validExpenseEntry()));
  });

  // ★ هذه الحالة هي التي كان عيب الأسبقية (14.2) يُسقطها
  it('ح-13: قيد غير متوازن يُرفض', async () => {
    const db = ownerFresh().firestore();
    await assertFails(setDoc(
      doc(db, P.entry('exp_unbal')),
      validExpenseEntry({ opId: 'exp_unbal', totalCreditMinor: 1 })));
  });

  it('ح-16: مبلغ سالب يُرفض', async () => {
    const db = ownerFresh().firestore();
    await assertFails(setDoc(
      doc(db, P.entry('exp_neg')),
      validExpenseEntry({ opId: 'exp_neg',
        totalDebitMinor: -25500, totalCreditMinor: -25500, amountMinor: -25500 })));
  });

  it('ح-17: مبلغ عشري يُرفض (is int)', async () => {
    const db = ownerFresh().firestore();
    await assertFails(setDoc(
      doc(db, P.entry('exp_float')),
      validExpenseEntry({ opId: 'exp_float',
        totalDebitMinor: 25.5, totalCreditMinor: 25.5, amountMinor: 25.5 })));
  });
});

describe('ع-أمن-1 — انحدار: المُجمَّعات تُنشأ في شهر جديد', () => {

  // ★ هذه الحالة تفشل على مسوّدة النواة 14.3 كما هي، وتنجح بعد فصل create/update.
  it('ح-53: إنشاء accountPeriods لشهر جديد بلا إعادة بناء', async () => {
    const db = ownerFresh().firestore();
    await assertSucceeds(setDoc(
      doc(db, P.accPer('acc_cash_main__2026-04')),
      { ownerUid: 'owner-uid-fixed', schemaVersion: 1,
        accountId: 'acc_cash_main', accountType: 'asset', periodKey: '2026-04',
        debitMinor: 0, creditMinor: 25500, netMinor: -25500, entryCount: 1 }));
  });

  it('ح-63: إنشاء التزام جديد بلا إعادة بناء', async () => {
    const db = ownerFresh().firestore();
    await assertSucceeds(setDoc(
      doc(db, P.oblig('obl_rent_2026-04')),
      { ownerUid: 'owner-uid-fixed', schemaVersion: 1,
        name: 'إيجار المنزل', nature: 'expense', categoryId: 'cat_home',
        totalMinor: 800000, extraChargesMinor: 0, paidMinor: 0,
        remainingMinor: 800000, paymentCount: 0, lastPaymentEntryId: null,
        dueDate: '2026-04-01', priority: 1, status: 'upcoming',
        statusComputedFor: '2026-03-11', isVariableAmount: false }));
  });
});

describe('ع-أمن-3 — انحدار: تاريخ تصحيح الفترة المُقفلة', () => {

  it('ح-77: عكس بتاريخ قديم داخل فترة مُقفلة يُرفض', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), P.lock('2026-01')),
        { ownerUid: 'owner-uid-fixed', reason: 'إقفال يناير', lockedBy: 'owner-uid-fixed' });
    });
    const db = ownerFresh().firestore();
    await assertFails(setDoc(
      doc(db, P.entry('rev_old')),
      validExpenseEntry({
        opId: 'rev_old', kind: 'reversal', isPriorPeriodCorrection: true,
        bookedAt: '2026-01-15', periodKey: '2026-01',
        bookedAtTs: Timestamp.fromDate(new Date('2026-01-15T12:00:00Z')),
      })));
  });
});

describe('أ-4 — حارس حداثة المصادقة', () => {

  it('ح-79: إقفال فترة بمصادقة قديمة يُرفض', async () => {
    const db = ownerStale().firestore();
    await assertFails(setDoc(doc(db, P.lock('2026-02')),
      { ownerUid: 'owner-uid-fixed', reason: 'إقفال فبراير',
        lockedBy: 'owner-uid-fixed', lockedAt: serverTimestamp() }));
  });

  it('ح-86: تشغيل إعادة البناء بمصادقة قديمة يُرفض', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), P.meta('integrity')),
        { ownerUid: 'owner-uid-fixed', schemaVersion: 1, projectionVersion: 1,
          rebuildStatus: 'idle', rebuildCursor: null });
    });
    await assertFails(updateDoc(
      doc(ownerStale().firestore(), P.meta('integrity')),
      { rebuildStatus: 'running' }));
  });
});
```

```ts
// tests/rules/access-call-budget.spec.ts  — ح-123 (إلزامية قبل النشر)
import { runTransaction, doc, setDoc } from 'firebase/firestore';

it('ح-123: معاملة payObligation كاملة لا تتجاوز حدّ استدعاءات الوصول', async () => {
  const db = ownerFresh().firestore();
  // تُكتب كل مستندات payObligation في معاملة واحدة بقيم صحيحة منطقياً.
  // الفشل هنا مع صحة كل الشروط = تجاوز الحدّ (20) لا خطأ منطقي.
  await assertSucceeds(runTransaction(db, async (tx) => {
    tx.set(doc(db, P.entry('obp_1')), payObligationEntry());      // 1
    tx.set(doc(db, P.posting('obp_1__1')), postingFor('obp_1', 1)); // 2
    tx.set(doc(db, P.posting('obp_1__2')), postingFor('obp_1', 2)); // 3
    tx.set(doc(db, P.posting('obp_1__3')), postingFor('obp_1', 3)); // 4
    tx.set(doc(db, P.account('acc_cash_main')), accountAfter(), { merge: true });
    tx.set(doc(db, P.account('acc_exp_home')),  accountAfter(), { merge: true });
    tx.set(doc(db, P.account('acc_liab_fin')),  accountAfter(), { merge: true });
    tx.set(doc(db, P.accPer('acc_cash_main__2026-03')), accPerAfter(), { merge: true });
    tx.set(doc(db, P.accPer('acc_exp_home__2026-03')),  accPerAfter(), { merge: true });
    tx.set(doc(db, P.accPer('acc_liab_fin__2026-03')),  accPerAfter(), { merge: true });
    tx.set(doc(db, P.period('2026-03')), periodAfter(), { merge: true });
    tx.set(doc(db, P.budget('2026-03')), budgetAfter(), { merge: true });
    tx.set(doc(db, P.oblig('obl_rent_2026-03')), obligAfter(), { merge: true });
  }));
});
```

> **ملاحظة على `assertFails`:** تنجح الحالة إذا رُفض الطلب **لأي سبب**. لذلك كل حالة سلبية هنا
> تبدأ من `validExpenseEntry()` وتُفسد **حقلاً واحداً** — وإلا صار الاختبار «أخضر» لسبب غير السبب
> المقصود، وهو أخطر أنواع الاختبارات الزائفة. **قاعدة مُلزِمة على كل حالة سلبية تُضاف لاحقاً.**

---

## 11. تصدير البيانات الشخصية واستعادتها

### 11.1 لماذا هذه الميزة أمنية لا رفاهية

على Spark **لا نسخ احتياطي مجدول** (ق-1) ⇒ التصدير اليدوي JSON هو **النسخة الاحتياطية الوحيدة**،
وهو أيضاً الحل لثلاثة مخاطر: T5 (فقدان حساب Google)، وانحراف المُجمَّعات غير القابل للإصلاح،
وحق المستخدم في الحصول على بياناته وحملها.

### 11.2 الشكل — `raseed-export-v1`

```jsonc
{
  "meta": {
    "format": "raseed-export",
    "formatVersion": 1,                 // نسخة ملف التصدير نفسه
    "appVersion": "1.0.3",
    "schemaVersion": 1,                 // نسخة مخطط البيانات (meta/schema)
    "projectionVersion": 3,             // من meta/integrity — تُقرأ عند الاستعادة
    "exportedAt": "2026-10-09T18:22:41.123Z",
    "exportedAtTz": "Africa/Tripoli",
    "ownerUid": "owner-uid-fixed",
    "ownerEmail": "albarshi.96@gmail.com",
    "currency": "LYD",
    "minorPerUnit": 1000,               // ← يجعل الملف مقروءاً بعد سنوات بلا الكود
    "displayDecimals": 3,
    "timestampEncoding": "{\"__ts\":\"<ISO-8601 UTC>\"}",
    "counts": { "journalEntries": 1842, "postings": 3684, "accounts": 47,
                "obligations": 12, "debts": 5, "notes": 88, "tasks": 213 },
    "ledgerFingerprint": {              // ← ما تتحقق منه الاستعادة بعد إعادة البناء
      "sumTotalDebitMinor": 184250500,
      "entryCount": 1842,
      "sumPostingDebitMinor": 184250500,
      "sha256OfSortedOpIds": "9f2c…"
    },
    "integrityAtExport": {              // لقطة حالة الفاحص لحظة التصدير
      "trialBalanceOk": true,
      "lastReconciledAt": "2026-10-01T06:10:00.000Z"
    },
    "warningAr": "هذا الملف يحتوي بياناتك المالية الكاملة وأسماء وأرقام هواتف جهات التعامل. احفظه في مكان آمن ولا تشاركه."
  },

  // ═══ 1) الدفتر — مصدر الحقيقة الوحيد. يُستورَد كما هو. ═══
  "ledger": {
    "journalEntries": [ { "id": "exp_2026-03-11_abc123", "opId": "…", "kind": "expense",
                          "status": "posted", "bookedAt": "2026-03-11",
                          "bookedAtTs": { "__ts": "2026-03-11T12:00:00.000Z" },
                          "periodKey": "2026-03", "lines": [ /* … */ ],
                          "totalDebitMinor": 25500, "totalCreditMinor": 25500,
                          "createdAt": { "__ts": "2026-03-11T14:03:02.117Z" }
                          /* كل الحقول حرفياً */ } ],
    "postings": [ /* كل المستندات حرفياً */ ]
  },

  // ═══ 2) المستندات المرجعية — تُستورَد، وليست مشتقة من الدفتر ═══
  "authoritative": {
    "accounts":         [ /* بنية الشجرة فقط — انظر 11.4 */ ],
    "categories":       [], "contacts": [], "recurrences": [], "incomeSchedules": [],
    "obligations":      [], "debts": [], "debtFollowUps": [], "financialGoals": [],
    "periodLocks":      [], "entryCorrections": [], "operations": [], "auditLogs": [],
    "settings":         [], "attachments": [],
    "notes":            [], "notebooks": [], "tasks": [], "taskLists": [], "reminders": [],
    "worshipRecords":   [], "quranProgress": [], "zakatRecords": [],
    "meta":             [ { "id": "schema", "currentVersion": 1, "appliedMigrations": [] } ]
  },

  // ═══ 3) المشتقات — **للتشخيص والمقارنة فقط، لا تُستورَد أبداً** (عقد النواة 17.3) ═══
  "derivedSnapshotDoNotImport": {
    "accountBalances":  [ { "id": "acc_cash_main", "balanceMinor": 340000,
                            "debitTotalMinor": 1200000, "creditTotalMinor": 860000,
                            "balanceVersion": 412 } ],
    "accountPeriods":   [], "periods": [], "budgetPeriods": []
  },

  // ═══ 4) الطابور غير المُفرَّغ — يُصدَّر للعلم ولا يُستورَد ═══
  "pendingCommandsDoNotImport": []
}
```

**قرارات الشكل، وبدائلها المرفوضة:**

| القرار | البديل المرفوض | السبب |
|---|---|---|
| JSON واحد غير مضغوط | NDJSON أو ZIP متعدد الملفات | ملف واحد قابل للقراءة بأي محرر بعد سنوات. الحجم المتوقع لثلاث سنوات (~6000 قيد + 12000 posting) ≈ 12–18MB — مقبول |
| `{"__ts": "ISO"}` للطوابع | ISO نصّي خام | يميّز الطابع عن نص يشبه التاريخ، فالاستعادة تُعيد بناء `Timestamp` بلا تخمين. والخام يُفقد النوع صامتاً |
| `minorPerUnit` و`displayDecimals` في الرأس | الاعتماد على معرفة القارئ | يجعل الملف **مكتفياً بنفسه**: من يقرؤه بعد خمس سنوات يعرف أن 25500 = 25.500 د.ل |
| `ledgerFingerprint` | لا بصمة | الاستعادة بلا بصمة لا تستطيع إثبات أنها نجحت. البصمة = **شرط قبول الاستعادة** |
| المشتقات مُصدَّرة لكن موسومة `DoNotImport` | عدم تصديرها | تُفيد في **تشخيص الانحراف**: مقارنة رصيد ما قبل الكارثة بالرصيد المُعاد بناؤه |
| `auditLogs` مُصدَّرة | إهمالها | هي سجل القرارات غير المالية (شطب، تسوية، إقفال)؛ فقدانها يُفقد «لماذا» |

### 11.3 التصدير — التنفيذ

```ts
// app/features/settings/export/exportAll.ts
// القراءة فقط. تُستدعى من «الإعدادات ← البيانات والنسخ الاحتياطي».
export interface ExportOptions {
  /** تشفير اختياري بعبارة مرور (AES-GCM عبر WebCrypto). الافتراضي false — أ-9. */
  encryptWithPassphrase?: string;
  /** استبعاد المحتوى الشخصي غير المالي (ملاحظات/عبادات) لنسخة «مالية فقط». */
  scope?: 'full' | 'financialOnly';
}

export async function exportAllJson(opts?: ExportOptions): Promise<Blob>;
```

**الخصائص الإلزامية:**

1. **الكلفة والتجزئة:** القراءة بـ `pagination` (500 مستند/صفحة) مع شريط تقدم، لا استعلام واحد ضخم.
   تقدير ثلاث سنوات: ~20,000 قراءة ⇒ **40% من حصة Spark اليومية (50,000)** ⇒ **تحذير صريح في الواجهة:
   «لا تُصدِّر أكثر من مرة في اليوم»**، وتعطيل الزر 6 ساعات بعد تصدير ناجح.
2. **لقطة متسقة:** لا معاملة تشمل كل البيانات. فالتصدير يُسجّل `exportedAt` ويُحسب
   `ledgerFingerprint` **بعد** قراءة الدفتر بـ `getAggregateFromServer`؛ أي عدم تطابق ⇒
   **إعادة المحاولة**، وبعد ثلاث محاولات ⇒ رسالة «سُجِّلت عمليات أثناء التصدير — أعِد المحاولة».
3. **اسم الملف:** `raseed-backup-2026-10-09T18-22-41Z-fp9f2c.json` (التاريخ + أول 4 من البصمة)
   ⇒ لا لبس بين نسختين، والترتيب الأبجدي = ترتيب زمني.
4. **`auditLogs { action: 'dataExported' }`** إلزامي مع كل تصدير ناجح (كتابة واحدة).
5. **لا رفع إلى أي خدمة.** `Blob` ⇒ `URL.createObjectURL` ⇒ تنزيل محلي. **لا Storage، لا بريد، لا مشاركة.**
6. **التذكير الدوري:** إشعار داخل التطبيق إذا مضى > 30 يوماً على آخر `dataExported` (ق-1).

### 11.4 الاستعادة — الإجراء الكامل بالترتيب الإلزامي

> **المبدأ (عقد النواة 17.3):** تُستورَد **الدفتر والمرجعيات فقط**، ثم **تُعاد بناء كل المشتقات**.
> **لا يُستورَد رصيد ولا مُجمَّع إطلاقاً.**

```
المرحلة 0 — الفحص المسبق (بلا أي كتابة)
  0.1 التحقق من meta.format == 'raseed-export' و formatVersion مدعومة.
  0.2 إن كان meta.schemaVersion > APP_SCHEMA_VERSION ⇒ إيقاف بـ SCHEMA_VERSION_AHEAD:
      «الملف أحدث من نسخة التطبيق. حدِّث التطبيق أولاً.»
  0.3 إعادة حساب ledgerFingerprint من محتوى الملف نفسه ومقارنته بالمعلن
      ⇒ عدم التطابق = ملف تالف أو مُعدَّل ⇒ إيقاف.
  0.4 التحقق من ownerUid: إن اختلف عن المستخدم الحالي ⇒ تحذير صريح وإلزام بـ
      «إعادة النسب» (كل ownerUid يُعاد كتابته إلى UID الحالي) — قرار يأخذه المستخدم لا الكود.
  0.5 فحص حالة الهدف: إن وُجد قيد واحد في users/{uid}/journalEntries ⇒
      وضع «دمج» لا «استعادة» (انظر أدناه).

المرحلة 1 — التهيئة (إن كانت الشجرة فارغة)
  1.1 meta/schema  = { currentVersion: ملف.schemaVersion, appliedMigrations: [...] }
  1.2 meta/integrity = { rebuildStatus: 'idle', projectionVersion: 1, ... }   ← إلزامي قبل أي كتابة مالية

المرحلة 2 — المرجعيات **بأرصدة مُصفَّرة**
  2.1 accounts: تُكتب بـ debitTotalMinor = creditTotalMinor = balanceMinor =
      openingBalanceMinor = earmarkedMinor = entryCount = balanceVersion = 0
      (قاعدة الإنشاء تفرض ذلك أصلاً — فالاستيراد لا يستطيع تزييف رصيد. **ميزة لا عقبة**.)
  2.2 categories, contacts, recurrences, incomeSchedules, financialGoals (savedMinor = 0)
  2.3 obligations, debts (paidMinor/settledMinor = 0، remainingMinor = المشتق)
      ← تُصحَّح قيمها الحقيقية في المرحلة 5 بإعادة البناء، لا بالاستيراد.

المرحلة 3 — الدفتر (الكتلة الأكبر)
  3.1 journalEntries بـ writeBatch مجزَّأ ≤ 450 عملية، **بمعرّفها الأصلي** (= opId)
      ⇒ إعادة تشغيل الاستعادة بعد انقطاع **idempotent بالبنية**، لا بعلامة تقدّم.
  3.2 postings بنفس الطريقة.
  3.3 ملاحظة إلزامية: قاعدة الإنشاء تفرض serverTime('createdAt') ⇒ **createdAt المُستعاد
      يصير وقت الاستعادة لا وقت الإنشاء الأصلي.** الحل المعتمد: حقل إضافي
      originalCreatedAt يُكتب من الملف، و createdAt = serverTimestamp().
      ← هذا تنازل مُعلَن: ترتيب الكتابة الأصلي يبقى محفوظاً في bookedAt و clientCreatedAt
        و originalCreatedAt، ولا شيء محاسبي يعتمد على createdAt (النواة 5.2).
  3.4 entryCorrections, operations, periodLocks ← **periodLocks في النهاية**، وإلا
      رفضت القواعد (I17) ترحيل قيود الفترات المُقفلة المُستعادة.

المرحلة 4 — المحتوى الشخصي
  notes, notebooks, tasks, taskLists, reminders, worshipRecords, quranProgress,
  zakatRecords, settings, attachments (الوصفية؛ الملفات لا تُستعاد — ق-1), auditLogs.

المرحلة 5 — إعادة البناء (القسم 16 من النواة)
  5.1 meta/integrity.rebuildStatus = 'running'    ← يحتاج freshAuth() (أ-4)
  5.2 rebuildProjections(): accounts, accountPeriods, periods, budgetPeriods,
      obligations.paidMinor, debts.settledMinor, financialGoals.savedMinor,
      accounts.earmarkedMinor — كلها من الدفتر.
  5.3 meta/integrity.rebuildStatus = 'idle'، projectionVersion += 1

المرحلة 6 — الإثبات (لا تُعتبر الاستعادة ناجحة قبلها)
  6.1 I4  ميزان المراجعة متوازن.
  6.2 البصمة المُعاد حسابها من الخادم == meta.ledgerFingerprint.
  6.3 مقارنة الأرصدة المُعاد بناؤها بـ derivedSnapshotDoNotImport:
      كل فرق يُعرض في جدول «فروق الاستعادة» — **لا يُخفى ولا يُصلَح تلقائياً**.
      (الفرق المشروع الوحيد: انحراف كان موجوداً قبل الكارثة، وهذا بالضبط ما نريد رؤيته.)
  6.4 auditLogs { action: 'migrationApplied', reason: 'restoreFromExport <fileName>' }
```

**وضع «الدمج» (الشجرة غير فارغة):** يُسمح به **فقط** لأن معرّف كل قيد = `opId` حتمي ⇒ إعادة كتابة
نفس القيد **لا تُنتج ازدواجاً** (النواة 6). والقيود الموجودة التي لا توجد في الملف **تبقى**.
بعد الدمج: **إعادة بناء إلزامية**. وتحذير صريح: «الدمج لا يحذف شيئاً؛ العمليات المسجَّلة بعد تاريخ
النسخة ستبقى.»

**ما لا تستعيده الاستعادة — مُعلَن:**

| العنصر | السبب |
|---|---|
| ملفات المرفقات | ق-1: Storage غير مُفعَّل. الوصفية تُستعاد بحالة `detached` |
| `pendingCommands` | أوامر غير مُفرَّغة من سياق جهاز آخر؛ إعادة بثها خطر ازدواج دلالي |
| `createdAt` الأصلي للقيود | قاعدة `serverTime` (ت-2) — محفوظ في `originalCreatedAt` |
| كل المُجمَّعات | عقد النواة 17.3 — تُعاد بناءً |
| الجلسات والأجهزة | لا معنى لها |

### 11.5 التشفير الاختياري

```ts
// WebCrypto، بلا أي مكتبة خارجية. PBKDF2-SHA256 (210,000 دورة) ⇒ AES-GCM-256.
interface EncryptedEnvelope {
  format: 'raseed-export-encrypted'; formatVersion: 1;
  kdf: 'PBKDF2-SHA256'; iterations: 210000;
  saltB64: string; ivB64: string; cipherTextB64: string;
  // الرأس meta يبقى **بالنص الواضح** ليعرف المستعيد ما الملف وتاريخه دون فك التشفير.
  plainMeta: { exportedAt: string; counts: Record<string, number>; formatVersion: 1 };
}
```

**تحذير إلزامي في الواجهة قبل التشفير:** «لا توجد طريقة لاستعادة هذا الملف إذا نسيت عبارة المرور.
لا نحتفظ بها ولا يمكن إعادة تعيينها.» وزر «تصدير بلا تشفير» يبقى **الافتراضي** (أ-9).

---

## 12. تقييد مفتاح API و App Check

### 12.1 الحقيقة أولاً

> **مفتاح Firebase للويب ليس سرّاً.** هو معرّف مشروع يُشحن داخل حزمة الواجهة ويُقرأ من أي متصفح.
> **لا يمنح أي صلاحية على البيانات** — الصلاحية تأتي من رمز هوية المستخدم ومن قواعد الأمان.
> ⇒ تقييد المفتاح **ضبط حصص ومنع إساءة استخدام، لا حدّ أمني**. ومن يعتبره حماية يبني على رمل:
> ترويسة `Referer` **يُلفّقها** أي `curl` بسطر واحد.

**ما يمنعه التقييد فعلاً:** أن يبني شخص آخر موقعاً على نطاقه يستخدم مفتاحك فيستهلك حصص **مشروعك**
في المصادقة. وهذا سبب كافٍ لتنفيذه، لا أكثر.

### 12.2 الخطوات بالتفصيل

```
Google Cloud Console  →  المشروع raseed-2fac1  →  APIs & Services  →  Credentials

1) اختيار المفتاح: "Browser key (auto created by Firebase)".
   [تحذير] لا تُقيَّد المفاتيح الأخرى (Android/iOS/Server) بالنفس الطريقة — لها ضوابط مختلفة.

2) Application restrictions  →  HTTP referrers (web sites)  →  إضافة:
      https://raseed-2fac1.web.app/*
      https://raseed-2fac1.firebaseapp.com/*
   وفي التطوير فقط (يُفضَّل مفتاح منفصل لا نفس المفتاح):
      http://localhost:5173/*
      http://127.0.0.1:5173/*

3) API restrictions  →  Restrict key  →  تحديد **هذه فقط**:
      • Identity Toolkit API            (تسجيل الدخول — إلزامي)
      • Token Service API               (تجديد الرمز — إلزامي؛ إسقاطه يكسر الجلسات بعد ساعة)
      • Cloud Firestore API             (إلزامي)
      • Firebase Installations API      (إلزامي لتهيئة SDK)
      • Firebase Management API         ← لا تُضَف. غير مطلوبة للعميل
      • Cloud Storage for Firebase API  ← تُضاف **فقط** عند تفعيل المرفقات
      • Firebase App Check API          ← تُضاف **فقط** عند تفعيل App Check
      • FCM Registration API            ← تُضاف **فقط** عند تفعيل إشعارات الويب

4) Save. الانتشار يأخذ **حتى 5 دقائق**.

5) التحقق الإلزامي بعد الحفظ (لا يُقفَل التاب قبل اجتيازها كلها):
   أ) تسجيل خروج ثم تسجيل دخول كامل من النطاق الإنتاجي.
   ب) الانتظار حتى تجديد الرمز (أو إجباره بـ getIdToken(true)) ⇒ لا خطأ 403.
   ج) تسجيل مصروف واحد ⇒ نجاح.
   د) فتح لوحة التحكم ⇒ كل الأرقام تظهر.

6) خطة التراجع: عند أي خطأ 403 أو api-key-not-valid ⇒ إعادة
   Application restrictions إلى "None" فوراً، ثم تشخيص أي API كان ناقصاً من القائمة.
```

**أخطر خطأ في هذا الإجراء:** إسقاط **Token Service API**. الأثر مُخاتِل: تسجيل الدخول ينجح،
والتطبيق يعمل، ثم **بعد ساعة بالضبط** يفشل كل شيء بأخطاء مصادقة غامضة على كل الأجهزة.

**نطاقات مأذونة مقابل مقيّدات المفتاح — فرق لا يُخلَط:**
`Authorized domains` في Firebase Auth تُحدد من يُكمل **تدفق تسجيل الدخول**؛
`HTTP referrers` على المفتاح تُحدد من يستخدم **المفتاح** في نداءات API.
**الاثنان مطلوبان، وكلٌّ يُضبط في مكانه** (3.1 بند 2، و12.2 بند 2).

### 12.3 App Check — التوصية: **التأجيل**

**ما يفعله App Check:** يُثبت أن الطلب جاء من **تطبيقك** لا من سكربت، بمزوّد تحقّق في المتصفح
(reCAPTCHA) يُصدر رمزاً يُفحَص على الخادم قبل الوصول إلى Firestore/Storage/Auth.

**القيمة الحدّية في مشروعنا — صريحة:**

| ما يحميه App Check | الحالة في «رصيد» |
|---|---|
| قراءة البيانات من سكربت خارجي | **محمي أصلاً وبالكامل** بـ ق-2: السكربت يحتاج رمز هوية لـ UID المالك. بلا ذلك يُرفض |
| كتابة بيانات مزيَّفة | **محمي أصلاً** بنفس السبب |
| استنزاف حصة القراءة/الكتابة | **غير محمي** — تبقى هذه القيمة الوحيدة الحقيقية (T10) |
| إساءة استخدام مفتاح API في موقع آخر | يُغطّيه تقييد الـ referrers جزئياً (12.1) |

**التكلفة والتعقيد — بالتفصيل:**

| البند | التفصيل |
|---|---|
| تكلفة App Check نفسه | **لا تكلفة** للخدمة ولفرضها على Firestore/Storage |
| تكلفة المزوّد | مزوّد reCAPTCHA Enterprise هو المُوصى به للويب حالياً. **يجب التحقق من إمكان تمكينه على مشروع بلا حساب فاتورة (Spark)** — خدمات Google Cloud عادةً تطلب ربط فاتورة لتمكين واجهتها، وهذا يتعارض مع ق-1. المزوّد الأقدم (reCAPTCHA v3) لا يطلب فاتورة لكنه مسار قديم. **لا أؤكد أياً من الحالتين بلا تحقق في Console.** → سؤال مفتوح رقم 6 |
| تعقيد التطوير | رمز تصحيح (`FIREBASE_APPCHECK_DEBUG_TOKEN`) لكل متصفح وكل جهاز وكل بيئة CI، يُسجَّل في Console ويُدار كسرّ. ونسيانه = فشل اختبارات لا يُفهم سببه |
| تعقيد PWA/دون اتصال | رمز App Check له عمر محدود ويحتاج تجديداً؛ سلوكه مع الكتابة المؤجَّلة بعد عودة الاتصال يحتاج اختباراً إضافياً — بينما `pendingCommands` (ADR-007) حساس لهذا بالضبط |
| **خطر إغلاق المالك خارج تطبيقه** | **الأهم.** الفرض (`enforce`) يرفض كل طلب بلا رمز صالح. فشل مزوّد التحقق أو حجب reCAPTCHA على شبكة المالك ⇒ **التطبيق المالي يتوقف كلياً**، ولا مسار بديل لمستخدم واحد |

**التوصية:**

> **لا يُفعَّل App Check الآن.** النظام مغلق على UID واحد في القواعد، فالمكسب الوحيد هو حماية الحصة
> من إساءة استخدام غير مُستهدِفة — وهو خطر منخفض الاحتمال (T10) مقابل خطر توقّف تشغيلي حقيقي.
>
> **شرط إعادة النظر (أيٌّ منها يكفي):** (1) الترقية إلى Blaze — عندها الإنفاق مرتبط بالاستخدام
> فتصبح حماية الحصة حماية مال، (2) إضافة مستخدم ثانٍ، (3) رصد استهلاك غير مُفسَّر للحصة.
>
> **عند التفعيل، الترتيب الإلزامي:** تمكين المزوّد ← تشغيل App Check في **وضع المراقبة (monitor)
> أسبوعاً كاملاً** ومراجعة نسبة الطلبات غير المُتحقَّقة ← ثم الفرض على Firestore ← ثم على Storage.
> **لا فرض مباشر بلا أسبوع مراقبة.**

---

## 13. الخصوصية، وتعدد المستخدمين لاحقاً

### 13.1 ضوابط الخصوصية المعتمدة

| الضابط | التنفيذ |
|---|---|
| **لا تحليلات ولا تتبّع** | لا Google Analytics، لا `measurementId` في `firebaseConfig`، لا أي SDK تتبّع. نظام مالي شخصي لا يُقاس سلوك مالكه |
| **لا خطوط ولا أصول من CDN خارجي** | كل الخطوط والأيقونات محلية في الحزمة ⇒ لا تسريب عنوان IP ولا نمط استخدام لطرف ثالث، وCSP تبقى ضيقة |
| **لا بيانات شخصية في URL** | المبالغ والأسماء والمعرّفات **لا تُوضع في query string**؛ التنقل بمعرّفات مستندات فقط، والمرشّحات في حالة التطبيق لا في الرابط |
| **لا تسجيل أخطاء خارجي** | لا Sentry ولا ما يشبهه في الإصدار الأول. الأخطاء تُعرض للمستخدم وتُسجَّل محلياً. (إن طُلب لاحقاً: تنقية إلزامية للمبالغ والأسماء قبل الإرسال) |
| **`console.log` ممنوع في الإنتاج** | قاعدة ESLint + حذف عند البناء — المبالغ وأسماء جهات التعامل لا تُكتب في سجل المتصفح |
| **حقول حسّاسة في الملاحظات** | تحذير في الواجهة: «الملاحظات ليست مكاناً لكلمات المرور وأرقام البطاقات» — ولا نُشفّرها بمفتاح مشتق من الحساب (وهم أمان: المفتاح سيكون في الواجهة نفسها) |
| **أرقام هواتف جهات التعامل** | بيانات شخصية **لأشخاص آخرين**. تُصدَّر ضمن النسخة الاحتياطية ⇒ التحذير في `meta.warningAr` (11.2) إلزامي، وخيار `scope: 'financialOnly'` متاح |
| **الحذف الكامل** | شاشة «الإعدادات ← حذف كل البيانات» **غير موجودة في الإصدار الأول**: قواعدنا تمنع الحذف المالي بقصد. الحذف الحقيقي = حذف المستخدم من Console + حذف الشجرة بسكربت Admin محلي، بعد تصدير. **وهذا مُعلَن لا مُخفى** |

### 13.2 الجاهزية لتعدد المستخدمين — بلا إعادة تصميم (المتطلبات، القسم 20)

**ما يجعلها جاهزة اليوم:** كل مستند تحت `users/{uid}/…` وكل مستند يحمل `ownerUid` مُثبَّتاً
في القواعد. ⇒ العزل شرط واحد في الجذر.

**مسار الترقية عند إضافة مستخدم ثانٍ (ثلاث خطوات، بلا تغيير شكل أي قيد):**

```javascript
// 1) مجموعة عضوية صريحة: households/{hid}/members/{uid}
//    مستند العضوية يحمل الدور: { role: 'owner' | 'editor' | 'viewer' }
function memberDoc(hid, uid) {
  return /databases/$(database)/documents/households/$(hid)/members/$(uid);
}
function isMember(hid)  { return isSignedIn() && exists(memberDoc(hid, request.auth.uid)); }
function canWriteIn(hid) {
  return isMember(hid)
      && get(memberDoc(hid, request.auth.uid)).data.role in ['owner','editor'];
}

// 2) الشجرة تبقى users/{uid} للبيانات الشخصية (ملاحظات، عبادات)،
//    وتُضاف households/{hid} للبيانات المالية المشتركة — نفس أسماء المجموعات ونفس الحقول.
// 3) allowedUids() تُحذف، ويحلّ محلها isMember/canWriteIn.
```

**ثلاثة تحذيرات صريحة على هذا المسار:**

1. **تكلفة استدعاءات الوصول تتضاعف:** `canWriteIn` تُضيف `exists + get` لكل مستند ⇒ ع-أمن-2
   يصير **حاجزاً قاطعاً**، و«بوابة الوجود» (7.3) تصير **إلزامية لا مقترحة**.
2. **«العميل الموثوق» ينتهي:** عند مستخدم ثانٍ يصبح انحراف المقدار (18.4) تهديداً لا خطأً
   ⇒ **Blaze + Cloud Function كاتب وحيد شرطٌ لا خيار** (8.3 بند 1).
3. **القيود التاريخية:** `ownerUid` على القيود القديمة يبقى UID المالك. ⇒ عند الترقية **لا يُعاد
   كتابة أي قيد** (عقد النواة 17.1)؛ القارئ يفهم `ownerUid` القديم كعضو في المنزل.
   ⇒ هذا يُحسم **قبل** إضافة المستخدم الثاني لا بعدها.

---

## 14. إجراءات التشغيل والاستجابة للحوادث

### 14.1 نشر القواعد

```bash
# 1) التحقق من الترجمة والاختبارات (لا تخطّي، لا --force)
npm run test:rules                      # 124 حالة — القسم 10

# 2) مراجعة الفرق قبل النشر (ما يُنشر فعلاً، لا ما في الذاكرة)
git diff --stat firestore.rules storage.rules
grep -n "REPLACE_WITH_OWNER_UID" firestore.rules storage.rules   # يجب ألّا يُطابق شيئاً

# 3) النشر — قواعد Firestore فقط
firebase deploy --only firestore:rules --project raseed-2fac1

# 4) التحقق بعد النشر (من المتصفح، على بيانات حقيقية، بعمليات قابلة للعكس)
#    أ) تسجيل مصروف 1.000 د.ل ⇒ نجاح وظهور الأثر.
#    ب) عكسه ⇒ نجاح.
#    ج) محاولة قراءة من نافذة متصفح أخرى بحساب Google مختلف ⇒ permission-denied.
```

**قاعدة صلبة:** `firestore.rules` و`storage.rules` **تُنشران معاً** عند أي تغيير في `allowedUids()`.
بقاء UID قديم في أحدهما = ثقب صامت.

**لا نشر للقواعد قبل:** (أ) تثبيت UID المالك (3.3)، (ب) قرار المالك في الأسئلة المفتوحة 1 و4 و5،
(ج) موافقته الصريحة (المتطلبات، القسم 25 بند 10).

### 14.2 المراجعة الدورية

| الدورية | الإجراء |
|---|---|
| **كل تسجيل دخول** | الفاحص الرخيص: I4 ميزان المراجعة (~45 قراءة). الانكسار ⇒ **إيقاف تسجيل العمليات** بـ `TRIAL_BALANCE_BROKEN` |
| **شهرياً** | الفاحص الكامل (I7, I11, I5b, I6b, I13) + تصدير JSON + مراجعة `auditLogs` لآخر 30 يوماً |
| **ربع سنوياً** | مراجعة قائمة المستخدمين في Console (يجب أن تحتوي حساباً واحداً)، ومراجعة `Authorized domains`، ومراجعة مقيّدات المفتاح |
| **عند كل إصدار** | تشغيل `npm run test:rules`، ومراجعة أي مجموعة جديدة في الكود بلا قاعدة |

### 14.3 الاستجابة للحوادث — ثلاثة سيناريوهات بخطوات مُرقَّمة

**س-1: ضياع أو سرقة جهاز بجلسة مفتوحة**

```
1) Firebase Console → Authentication → Users → المالك → Disable account   [فوري]
2) تشغيل tools/ops/revoke-sessions.mjs إن توفّر مفتاح الخدمة (3.5)
3) الانتظار ساعة (انتهاء رموز الهوية القائمة) أو الاعتماد على التعطيل
4) Enable account + تسجيل دخول من جهاز موثوق + تغيير كلمة مرور حساب Google وتفعيل 2FA
5) مراجعة auditLogs ودفتر القيود لآخر 72 ساعة بحثاً عن عمليات غير معروفة
6) أي عملية مشبوهة ⇒ عكس (لا حذف) مع correctionReason يذكر الحادث
```

**س-2: اكتشاف انحراف في الأرصدة (`TRIAL_BALANCE_BROKEN` أو فرق في I11)**

```
1) **لا تُصلِح يدوياً من Console.** أي كتابة يدوية تُفسد مسار التشخيص.
2) تصدير JSON فوراً — لقطة ما قبل الإصلاح (لا تُحذف أبداً).
3) تشغيل الفاحص الكامل وتحديد الحساب/الكيان المنحرف بالاسم والمقدار.
4) قراءة dفتر القيود لذلك الحساب للفترة المشتبهة ⇒ تحديد القيد أو العملية المسببة.
5) إن كان السبب قيداً خاطئاً  ⇒ عكس + بديل (مسار النواة 8).
   إن كان السبب مُجمَّعاً منحرفاً ⇒ إعادة بناء الإسقاطات (النواة 16.2) بـ freshAuth.
6) كتابة السبب الجذري في docs/testing/defects.md: ما حدث، لماذا، الإصلاح، نتيجة إعادة الاختبار
   (المتطلبات، القسم 23 والقسم 25 بند 15). **لا إخفاء لرسالة الخطأ.**
```

**س-3: فقدان الوصول لحساب Google (T5)**

```
1) استرجاع الحساب بإجراءات Google (الهاتف/البريد البديل/رموز الاحتياط).
2) إن تعذّر نهائياً، والبيانات مطلوبة:
   أ) إنشاء حساب Google جديد.
   ب) تسجيل دخول أول لالتقاط UID الجديد.
   ج) إضافته إلى allowedUids() ونشر القواعد (يحتاج صلاحية مشروع Firebase —
      وهي مرتبطة بحساب Google **القديم**  ← ★ نقطة الفشل الحقيقية).
3) ⇒ **التخفيف الاستباقي الوحيد الفعّال:** إضافة حساب Google ثانٍ كـ Owner على **مشروع
   Firebase نفسه** (IAM) من الآن. هذا منفصل تماماً عن allowedUids في القواعد:
   الأول صلاحية إدارة المشروع، والثاني صلاحية قراءة البيانات.
   ← بلا هذه الخطوة، فقدان الحساب = فقدان المشروع لا البيانات فقط،
     والنسخة الاحتياطية JSON تبقى **الملاذ الأخير** (مشروع جديد + استعادة).
4) ⇒ سؤال مفتوح رقم 1 يشمل هذين القرارين المنفصلين.
```

---

## 15. سجل القرارات الأمنية (ADR-SEC)

| المعرّف | القرار | البدائل المرفوضة | الحالة |
|---|---|---|---|
| **ADR-SEC-01** | الإغلاق على `allowedUids()` في كل قاعدة، لا على البريد | `auth.uid == uid` وحده (يسمح بشجرة لكل زائر)؛ التحقق من `token.email` (البريد قابل للتغيير)؛ الإغلاق في الواجهة (مخالف للقسم 20) | **معتمد** |
| **ADR-SEC-02** | فصل `create` من `update` في كل مجموعة | `allow create, update` مع `resource == null \|\|` (يعمل لكنه يُعيد إنتاج ع-أمن-1) | **معتمد** (إصلاح ع-أمن-1) |
| **ADR-SEC-03** | حارس حداثة المصادقة في القواعد على 5 عمليات مدمِّرة | إعادة مصادقة في الواجهة فقط؛ فرضها على كل كتابة (تجربة استخدام غير مقبولة) | **معتمد** |
| **ADR-SEC-04** | `bookedWithin36h` على تصحيح الفترة المُقفلة | حساب «تاريخ اليوم» نصّياً في القواعد (تعبير هشّ)؛ ترك الثقب (يُسقط معنى الإقفال) | **معتمد** (إصلاح ع-أمن-3) |
| **ADR-SEC-05** | `serverTime()` على `createdAt` للقيد و`at` لسجل التدقيق | الثقة بساعة الجهاز (سجل تدقيق قابل للتلفيق) | **معتمد**، بتنازل مُعلَن في الاستعادة (11.4 بند 3.3) |
| **ADR-SEC-06** | المرفقات غير قابلة للحذف والاستبدال في Storage | السماح بالحذف (مرجع معلّق + إتلاف إثبات)؛ حذف ناعم في Storage (غير موجود) | **معتمد** |
| **ADR-SEC-07** | استبعاد `image/svg+xml` من أنواع المرفقات | السماح به مع تنقية (تنقية SVG على العميل غير موثوقة) | **معتمد** |
| **ADR-SEC-08** | تأجيل App Check مع شروط إعادة نظر صريحة | تفعيله الآن (خطر توقف تشغيلي > المكسب)؛ إهمال الموضوع (قرار غير موثَّق) | **معتمد** |
| **ADR-SEC-09** | تقييد المفتاح بـ referrers مع إعلانه **ضبط حصص لا حدّ أمني** | عدم التقييد؛ اعتباره حماية (بناء على رمل) | **معتمد** |
| **ADR-SEC-10** | التصدير JSON واحد غير مشفّر افتراضياً + خيار AES-GCM | تشفير إلزامي (عبارة منسيّة = لا نسخة)؛ ZIP متعدد (أقل قابلية للقراءة بعد سنوات) | **معتمد** |
| **ADR-SEC-11** | الاستعادة تستورد الدفتر والمرجعيات فقط ثم تُعيد البناء، ولا تُعتبر ناجحة قبل مطابقة البصمة | استيراد المُجمَّعات (يُدخل انحرافاً غير مكشوف) | **معتمد** (تنفيذ لعقد النواة 17.3) |
| **ADR-SEC-12** | «الخروج من كل الأجهزة» سكربت محلي بـ Admin SDK + تعطيل من Console | زر في الواجهة (يحتاج سرّاً إدارياً — ممنوع)؛ عدم توفير الميزة (لا علاج لضياع جهاز) | **معتمد** |
| **ADR-SEC-13** | بوابة إعادة البناء بالوجود (`meta/rebuildLock`) بدل الحقل | البوابة بالحقل (استدعاءان لكل مستند ⇒ خطر تجاوز الحدّ) | **مقترح — ينتظر قياس المحاكي وقرار المالك** (سؤال 4) |
| **ADR-SEC-14** | لا تحليلات ولا أصول CDN خارجية ولا تسجيل أخطاء خارجي | Analytics (قياس سلوك مالي شخصي)؛ خطوط Google (تسريب IP ونمط استخدام) | **معتمد** |

---

## 16. قائمة التحقق قبل النشر — لا يُعلَن الأمان جاهزاً قبل اكتمالها

**القواعد والاختبار**

- [ ] `firestore.rules` يُترجَم بلا خطأ في المحاكي (يكشف ع-أمن-4).
- [ ] `storage.rules` يُترجَم بلا خطأ.
- [ ] 124 حالة اختبار **كلها خضراء**، وفيها ح-53 و ح-63 و ح-77 و ح-123 و ح-124.
- [ ] **ح-123 و ح-124 قياس حقيقي** لميزانية استدعاءات الوصول، والنتيجة مُسجَّلة في الوثيقة.
- [ ] `grep REPLACE_WITH_OWNER_UID` لا يُطابق شيئاً في أي ملف قواعد.
- [ ] كل مجموعة في الكود لها قاعدة (جدول القسم 4 مُحدَّث).

**المصادقة**

- [ ] Google هو المزوّد الوحيد المُمكَّن؛ Anonymous و Email/Password **مُعطَّلان**.
- [ ] `Authorized domains` تحتوي النطاقين الإنتاجيين فقط (و`localhost` في التطوير وحده).
- [ ] `Enable create (sign-up)` موقوف — أو مُسجَّل أنه غير متاح، مع قبول الخطر.
- [ ] UID المالك مُثبَّت في **كلا** ملفي القواعد، ومجموعة/قاعدة `bootstrap` **محذوفة**.
- [ ] 2FA مُفعَّل على `albarshi.96@gmail.com` (شرط تشغيلي).
- [ ] حساب Google ثانٍ كـ Owner على مشروع Firebase (IAM) — أو قرار صريح بعدمه (س-3).

**الواجهة والأسرار**

- [ ] ترويسات CSP وHSTS وبقية الترويسات منشورة ومُختبَرة (تسجيل الدخول يعمل مع `frame-src`).
- [ ] `.gitignore` يشمل `.env*` و`*serviceAccount*.json`؛ ولا سرّ في تاريخ Git.
- [ ] لا `console.log` في حزمة الإنتاج؛ قاعدة ESLint مُفعَّلة.
- [ ] `measurementId` غائب من `firebaseConfig`؛ لا SDK تحليلات.
- [ ] لا خط ولا أيقونة من CDN خارجي.

**البيانات**

- [ ] سكربت التهيئة يكتب `meta/integrity` و`meta/schema` و`settings/app` في **نفس الدفعة** (النواة 3.3).
- [ ] `exportAllJson` يعمل ويُنتج ملفاً تتحقق بصمته.
- [ ] الاستعادة مُختبَرة على **مشروع محاكي فارغ** من ملف تصدير حقيقي، وتنتهي بمطابقة البصمة.
- [ ] الفاحص الرخيص يعمل عند تسجيل الدخول، ويُوقف العمليات عند انكسار I4.

**مفتاح API**

- [ ] `HTTP referrers` مضبوطة، و`API restrictions` تضم **Token Service API** (أخطر إسقاط).
- [ ] اجتياز خطوات التحقق 5-أ..د في 12.2، بما فيها تجديد الرمز بعد ساعة.

---

## 17. ما يحتاج قرار المالك

> موضوعة في `openQuestions` أيضاً. **لا يُنشر شيء قبل 1 و4 و5.**

1. **UID احتياطي، وحساب إداري ثانٍ** — وهما قراران منفصلان: (أ) UID احتياطي في `allowedUids()`
   يُعطي **صلاحية كاملة** على البيانات (نمط «قراءة فقط» يحتاج تغييراً بنيوياً — 3.3)،
   (ب) حساب Google ثانٍ كـ Owner على مشروع Firebase (IAM) وهو **التخفيف الفعلي** لفقدان الوصول (س-3).
   **السؤال: أيّهما يُفعَّل الآن؟**
2. **`Enable create (sign-up)`** — هل يوجد الخيار في Console لمشروعنا؟ إن لم يوجد، هل يُقبل الخطر
   (تضخّم جدول المستخدمين دون أي وصول للبيانات) أم يُطلب بديل؟
3. **`sessionNotStale` (إعادة مصادقة كل 12 ساعة للكتابة)** — تقليص نافذة خطر ضياع الجهاز من
   «أبدية» إلى 12 ساعة، مقابل إعادة تسجيل دخول دورية على كل جهاز. **مُعطَّل افتراضياً.**
4. **ADR-SEC-13 — بوابة إعادة البناء بالوجود** — تغيير في آلية من النواة. القياس في المحاكي (ح-123)
   قد يُثبت أنه **ضروري لعمل `payObligation` أصلاً**. هل يُصادق عليه مسبقاً إن أثبت القياس الحاجة؟
5. **حد حجم المرفق: 5MB (النواة) أم 10MB (صياغة المهمة)؟** الوثيقة اعتمدت 5MB لأن النواة هي العقد.
   تغييره يحتاج قراراً صريحاً (الأثر: صور إيصالات من كاميرات حديثة قد تتجاوز 5MB قبل الضغط —
   والعلاج المقترح: ضغط على العميل قبل الرفع، وهو أفضل من رفع الحد).
6. **App Check** — التوصية التأجيل (12.3). والمطلوب قرار على: هل نتحقق الآن من إمكان تمكين مزوّد
   reCAPTCHA على مشروع Spark بلا فاتورة (لتوثيق الجدوى)، أم نؤجّل الموضوع كاملاً حتى Blaze؟
7. **حذف كل البيانات** — لا توجد شاشة له في الإصدار الأول (13.1). هل يُقبل ذلك، أم يُطلب مسار
   «حذف كامل» موثَّق (تصدير إلزامي ← سكربت Admin محلي ← حذف المستخدم)؟
8. **شاشة «دفتر القيود»** (النواة 22.2 سؤال 2) — لها أثر أمني: هي **أداة الكشف البشرية** لقلب
   الاتجاه (النواة 18.3) وللقيود الزائفة بعد حادث XSS. **توصيتي: تُعرض.** والقرار للمالك.

---

## 18. خلاصة العقد الأمني

1. **الإغلاق في القواعد على UID واحد** — لا في الواجهة، ولا على البريد. وهذا ما يجعل ق-2 **حقيقة**.
2. **الدفتر مفروض شكله فرضاً كاملاً من الخادم**: توازن، أعداد صحيحة موجبة، تماسك الفترة،
   عدم قابلية للتعديل المحاسبي، **ولا حذف مالي مطلقاً**.
3. **المشتقات مفروضة اتساقاً (I3, I5, I6, I15, I22) ومكشوفة انحرافاً** (I4, I7, I11, I5b, I6b).
   **نحمي المصدر فرضاً، ونكشف المشتق كشفاً** — وهذه هي القسمة الصحيحة على Spark.
4. **ما لا تستطيعه القواعد مُعلَن في جدول صريح** (8.1)، وأهمه: **لا فرض خادمي لمقدار تغيّر الرصيد**.
   مقبول لمستخدم واحد هو المالك، **غير مقبول** عند مستخدم ثانٍ أو التزام تجاه الغير أو بيئة غير مملوكة.
5. **ثلاثة عيوب حقيقية في مسوّدة النواة 14.3 مُشخَّصة ومُصلَحة** (ع-أمن-1 يُوقف النظام في أول يوم
   من كل شهر، ع-أمن-3 يثقب إقفال الفترات، ع-أمن-4 يمنع ترجمة الملف)، **وعيب رابع يحتاج قياساً**
   (ع-أمن-2 ميزانية استدعاءات الوصول).
6. **الأمان المُدمِّر خلف مصادقة حديثة** مفروضة في القواعد: إقفال فترة، إعادة بناء، حدّ الرصيد، الأرشفة.
7. **سجل التدقيق غير قابل للتلاعب**: إنشاء فقط، بوقت الخادم، بهوية الكاتب، وبقائمة أفعال مغلقة.
8. **التصدير JSON ميزة أمنية أولى لا رفاهية**، والاستعادة **لا تُعتبر ناجحة قبل مطابقة البصمة**.
9. **مفتاح API عام بالتصميم**، وتقييده ضبط حصص. **وApp Check مؤجَّل بقرار موثَّق لا بإهمال.**
10. **124 حالة اختبار بوابة للنشر**، وفيها اختبارات انحدار صريحة لكل عيب من عيوب القسم 7.

> **القواعد ليست جاهزة لمجرد كتابتها.** هذه الوثيقة تصميم مكتمل وملف قابل للنشر،
> لكن **لا نشر قبل: ترجمة نظيفة، 124 حالة خضراء، قياس ميزانية الاستدعاءات، وقرارات المالك 1 و4 و5.**

</div>
