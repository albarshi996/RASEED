## 14. قواعد الأمان الكاملة

### 14.1 عيب الأسبقية — ما هو بالضبط وكيف يُصلح

قواعد Firestore **تُجمَع بـ OR لا بـ AND**. كل قاعدة `allow` تطابق مسار الطلب تُقيَّم، ويُمنح الوصول
إن سمحت **أيُّ واحدة** منها. **لا توجد «قاعدة مقيِّدة» في Firestore**: القاعدة اللاحقة لا تضيّق قاعدة
سابقة أوسع منها، والقاعدة الأعمق لا تتجاوز قاعدة أعلى منها. هذا يُنتج عيبين مختلفين، كلاهما كان حاضراً
في مسوّدات التقييم، وكلاهما يُلغي الأمان بالكامل.

#### العيب الأول — منح عام بـ `{document=**}` يسبق قاعدة مقيِّدة

```javascript
// ✗ خطأ قاتل — لا يُكتب هذا أبداً
match /users/{uid}/{document=**} {
  allow read, write: if isOwner(uid);          // (1) منح عام على كل ما تحت المستخدم
}
match /users/{uid}/journalEntries/{entryId} {
  allow update: if false;                      // (2) **بلا أي أثر**
  allow delete: if false;                      // (3) **بلا أي أثر**
}
```

القاعدة (1) تطابق `users/U/journalEntries/E` لأن `{document=**}` تطابق أي عمق. فالمالك يستطيع تعديل
أي قيد مرحَّل وحذفه ومحو `auditLogs` بالكامل. القاعدتان (2) و(3) **تجميل**: `false` لا تطرح شيئاً من OR.

#### العيب الثاني — أسبقية `&&` على `||` داخل شرط واحد

```javascript
// ✗ خطأ قاتل
allow create: if isOwner(uid)
              && request.resource.data.ownerUid == uid
              && entryId == request.resource.data.opId.split('__')[0] ||
                 entryId == request.resource.data.opId
              && entryShapeOk(request.resource.data);
```

`&&` تربط أقوى من `||`، فالشرط يُقرأ فعلياً:

```
( isOwner(uid) && ownerUid == uid && entryId == opId.split('__')[0] )
||
( entryId == opId && entryShapeOk(d) )
```

**الفرع الثاني لا يفحص `isOwner` ولا `ownerUid` إطلاقاً.** أي شخص على الإنترنت، بأي حساب Google،
يستطيع إنشاء قيود في دفتر المالك شرط أن يُسمّي المستند باسم `opId` ويمرّر فحص الشكل. هذا ينسف ق-2
نسفاً كاملاً، ولا يظهر في أي اختبار «هل يعمل التطبيق؟» لأن التطبيق يسلك دائماً الفرع الأول.

#### الإصلاح المعتمد — ثلاث قواعد بناء إلزامية

1. **لا منح عام أبداً.** لا توجد في `firestore.rules` أي قاعدة `allow write` على `{document=**}`.
   كل مجموعة نواة تُعدّ صراحةً بقواعدها الخاصة، وما لم يُعدّ **مرفوض افتراضياً** (default deny).
2. **كل شرط `allow` يبدأ بـ `isOwner(uid) &&` ثم `(` … `)`.** أي `||` داخل شرط يُغلَّف بأقواس صريحة
   إلزامياً، ويُفحَص وجودها في اختبار نصّي على الملف نفسه (`20.3 / every allow condition starts with isOwner`).
3. **كتلة حرّاسة في نهاية الملف** تُطابق كل ما لم يُعدّ وتُرفض — قيمتها توثيقية وتشغيلية (تُجبر أي
   مجموعة جديدة على المرور بمراجعة أمنية)، لا منطقية، لأن `false` لا يطرح من OR.

### 14.2 `firestore.rules` — كامل وقابل للنشر

> **ملاحظة تشغيل إلزامية (§25 بند 10):** لا يُنشر هذا الملف قبل اجتياز كل اختبارات القسم 20.3 على
> `firebase emulators:exec`. UID المالك يُلتقط من أول تسجيل دخول ثم يُثبَّت في `approvedUids()` ويُنشر.
> **البريد لا يُستخدم في القواعد مطلقاً** — ق-2: البريد يتغيّر، UID ثابت.
>
> أسماء الحقول والمستندات هنا هي **نفسها** الواردة في القسم 4 (الأنواع) والقسم 12 (الخوارزميات):
> `postings/{entryId}:{lineNo}` بحقلَي `debitMinor`/`creditMinor` وبلا حقل دورة حياة ·
> `accounts` **بلا `balanceMinor` مخزَّن** (الرصيد مشتقّ من الإجماليين) · البوابة `maintenance/rebuild`.

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // ══════════════════════════════════════════════════════════════════
    // 0) دوال مساعدة — المصدر الوحيد لكل شرط في الملف
    // ══════════════════════════════════════════════════════════════════

    // ق-2: النظام مغلق على UIDs معتمدة. يُضاف UID احتياطي هنا عند الحاجة ثم يُعاد النشر.
    function approvedUids() {
      return [
        'REPLACE_WITH_OWNER_UID'      // محمد إبراهيم البرشي — albarshi.96@gmail.com
        // ,'REPLACE_WITH_BACKUP_UID' // UID احتياطي (قرار مفتوح — 22.2 بند م-3)
      ];
    }

    function isSignedIn() {
      return request.auth != null && request.auth.uid != null;
    }

    // المالك = موقَّع الدخول + UID معتمد + يكتب داخل نطاقه هو. الشروط الثلاثة مجتمعة.
    function isOwner(uid) {
      return isSignedIn()
          && request.auth.uid == uid
          && request.auth.uid in approvedUids();
    }

    // MAX_ABS_MINOR = 1_000_000_000_000 (القسم 2.1). موقَّع: الحدود والفروق قد تكون سالبة (ADR-010).
    function isMoney(v) {
      return v is int && v >= -1000000000000 && v <= 1000000000000;
    }

    function isPosMoney(v) { return v is int && v >  0 && v <= 1000000000000; }
    function isNonNeg(v)   { return v is int && v >= 0 && v <= 1000000000000; }

    // المفاتيح التي تغيّرت في هذا التحديث لا تخرج عن القائمة المسموحة.
    function hasOnly(keys) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys);
    }

    // أيٌّ من هذه المفاتيح لم يتغيّر إطلاقاً. تُستخدم للحقول المحاسبية المحصّنة.
    function unchanged(keys) {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(keys);
    }

    // بوابة شكل مستند جديد: كل المفاتيح الإلزامية حاضرة، ولا مفتاح مجهول.
    function shapeIs(required, optional) {
      return request.resource.data.keys().hasAll(required)
          && request.resource.data.keys().hasOnly(required.concat(optional));
    }

    function isDate(s)      { return s is string && s.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'); }
    function isPeriodKey(s) { return s is string && s.matches('^[0-9]{4}-[0-9]{2}$'); }

    // ADR-008: periodKey ≡ bookedAt[0:7] دائماً، بلا استثناء وبلا إعداد.
    function periodMatchesDate(d) {
      return isDate(d.bookedAt) && isPeriodKey(d.periodKey) && d.periodKey == d.bookedAt[0:7];
    }

    function baseDocOk(uid) {
      return request.resource.data.ownerUid == uid
          && request.resource.data.schemaVersion is int
          && request.resource.data.schemaVersion >= 1;
    }

    // ADR-015 — البوابة التي يسلّمها القسم 12: مستند واحد يحمل حالة الصيانة.
    // بلا هذه البوابة، جهاز ثانٍ يسجّل مصروفاً في منتصف إعادة البناء فتُكتب القيم المطلقة
    // فوق قيده ⇒ **يختفي مصروف بلا أي أثر**. تكلفتها: قراءة مفوترة واحدة لكل كتابة مالية،
    // وتُقبل صراحةً (15.2) لأن البديل فقدان بيانات صامت.
    function rebuildIdle(uid) {
      return !exists(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
          || get(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
               .data.state != 'running';
    }

    // ══════════════════════════════════════════════════════════════════
    // 1) مستند المستخدم نفسه — لا يحمل مالاً، ولا ينشر صلاحيته لما تحته
    // ══════════════════════════════════════════════════════════════════
    // هذه الكتلة تطابق مستند users/{uid} **وحده**. لا {document=**} ⇒ لا انتشار (14.1).
    match /users/{uid} {
      allow get:    if isOwner(uid);
      allow create: if isOwner(uid) && request.resource.data.uid == uid;
      allow update: if isOwner(uid) && unchanged(['uid', 'createdAt']);
      allow delete: if false;

      // ──────────────────────────────────────────────────────────────
      // 2) journalEntries — القيود. تُنشأ ولا تُمسّ محاسبياً ولا تُحذف.
      // ──────────────────────────────────────────────────────────────
      match /journalEntries/{entryId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && (
               // ADR-004: المعرّف = opId. منع الازدواج خصيصة في المفتاح لا منطق تطبيقي (I23).
               entryId == request.resource.data.opId
            && request.resource.data.entryId == entryId
            && request.resource.data.payloadHash is string
            && request.resource.data.payloadHash.size() == 64              // SHA-256 hex (I24)
            && request.resource.data.kind is string
            && request.resource.data.reversed == false                     // قيد جديد غير معكوس
            // قوسان صريحان إلزاماً (14.1 قاعدة 2): بلا القوسين يصبح الشرط فرعاً بلا isOwner.
            && ( request.resource.data.kind == 'reversal'
                   ? request.resource.data.reversalOf is string
                   : request.resource.data.reversalOf == null )
          )
          && (
               periodMatchesDate(request.resource.data)                    // ← ADR-008 / I13
            && request.resource.data.lines is list
            && request.resource.data.lines.size() >= 2                     // ← I1 (جزء السطور)
            && request.resource.data.lines.size() <= 20
            && isPosMoney(request.resource.data.debitTotalMinor)
            // ← I1 مفروض من الخادم: Σ Dr = Σ Cr
            && request.resource.data.debitTotalMinor == request.resource.data.creditTotalMinor
            && isMoney(request.resource.data.creditTotalMinor)
            && request.resource.data.accountIds is list
            && request.resource.data.accountIds.size() >= 2
            && request.resource.data.accountIds.size() <= 20
            && request.resource.data.accountTypes is list
            && request.resource.data.scopes is list
            && request.resource.data.description is string
            && request.resource.data.description.size() > 0
            && request.resource.data.description.size() <= 500             // §25 بند 18
            && request.resource.data.bookedAt is string
            // ADR-010: `allowNegative` محذوف من المخطط نهائياً. مستند يحمله = إصدار محظور.
            && !request.resource.data.keys().hasAny(['allowNegative', 'balanceMinor'])
            && rebuildIdle(uid)                                            // ← ADR-015 / I29
          );

        // التعديل المسموح: وسم القيد معكوساً/مستبدَلاً، وحقول غير محاسبية فقط.
        // `memo` هو الحقل الوحيد القابل للتعديل بلا قيد تصحيح (جدول القسم 8).
        allow update: if isOwner(uid)
          && hasOnly(['reversed', 'reversedByEntryId', 'replacedByEntryId',
                      'memo', 'tags', 'attachments', 'updatedAt'])
          && unchanged(['entryId', 'opId', 'payloadHash', 'kind', 'bookedAt', 'periodKey',
                        'lines', 'accountIds', 'accountTypes', 'scopes',
                        'debitTotalMinor', 'creditTotalMinor', 'reversalOf',
                        'replacesEntryId', 'correctionReason', 'description',
                        'ownerUid', 'createdAt', 'clientCreatedAt', 'deviceId'])
          // `reversed` بوابة أحادية: false → true فقط. لا «فكّ عكس» (I17/I18).
          && (!request.resource.data.reversed || resource.data.reversed == false)
          && (resource.data.reversed == false || request.resource.data.reversed == true)
          // I18: قيد العكس نفسه لا يُعكَس ⇒ لا سلاسل عكس لانهائية
          && resource.data.kind != 'reversal'
          && rebuildIdle(uid);

        allow delete: if false;                       // **لا حذف مالي مطلقاً** (I-NO-DELETE)
      }

      // ──────────────────────────────────────────────────────────────
      // 3) postings — الإسقاط المسطَّح. **create فقط**: لا update ولا delete.
      //    العكس يكتب صفوفاً معاكسة ⇒ كل مجموع صحيح بلا أي منطق استبعاد،
      //    ولهذا لا يحمل الصفّ أي حقل دورة حياة (`reversed` / `status`).
      //    المعرّف: `${entryId}:${lineNo}` — حتمي ⇒ إعادة المحاولة لا تُنشئ صفاً ثانياً.
      // ──────────────────────────────────────────────────────────────
      match /postings/{postingId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && (
               postingId == request.resource.data.entryId + ':' + string(request.resource.data.lineNo)
            && request.resource.data.lineNo is int
            && request.resource.data.lineNo >= 1                           // 1-based (القسم 4)
            && request.resource.data.entryId == request.resource.data.opId
            && request.resource.data.accountId is string
            && request.resource.data.accountType is string
            && request.resource.data.side in ['debit', 'credit']
            // حقلان لا حقل واحد: `sum('debitMinor')` يعمل بفهرس واحد بلا مرشّح جانب.
            && isNonNeg(request.resource.data.debitMinor)
            && isNonNeg(request.resource.data.creditMinor)
            // أحدهما صفر دائماً والآخر موجب ⇒ لا صفّ بصفرين ولا صفّ بمبلغين (I2)
            && (request.resource.data.debitMinor == 0)
                 != (request.resource.data.creditMinor == 0)
            && (request.resource.data.side == 'debit'
                  ? request.resource.data.debitMinor  > 0
                  : request.resource.data.creditMinor > 0)
            && periodMatchesDate(request.resource.data)                    // ← I13
            // ADR-021: الدلتا التشغيلية موقَّعة، وقد تكون صفراً (صفّ لا يسوّي شيئاً).
            && isMoney(request.resource.data.settlementDeltaMinor)
            // I8: دلتا ≠ 0 تحمل مرجعاً واحداً بالضبط من المرجعين التشغيليين
            && (request.resource.data.settlementDeltaMinor == 0
                || (request.resource.data.obligationId == null)
                     != (request.resource.data.debtId == null))
            && !request.resource.data.keys().hasAny(['allowNegative', 'reversed', 'status'])
            && rebuildIdle(uid)
          );

        allow update: if false;                       // ← صفّ الترحيل غير قابل للتعديل (I30)
        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 4) accounts — المُجمَّع. **لا `balanceMinor` مخزَّن**: الرصيد مشتقّ من
      //    `debitTotalMinor` و`creditTotalMinor` حسب `normalSide` (I4).
      //    `normalSide` مخزَّن مع أنه مشتقّ من `type`، لأن لغة القواعد لا تستدعي دوال النطاق.
      // ──────────────────────────────────────────────────────────────
      match /accounts/{accountId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && (
               request.resource.data.type in ['asset', 'liability', 'equity', 'income', 'expense']
            && request.resource.data.normalSide in ['debit', 'credit']
            // I-COA-1: بادئة المعرّف الهرمي تساوي النوع دائماً
            && accountId.split('\\.')[0] == request.resource.data.type
            && request.resource.data.accountId == accountId
            && request.resource.data.currency == 'LYD'
            && request.resource.data.debitTotalMinor == 0
            && request.resource.data.creditTotalMinor == 0
            && request.resource.data.entryCount == 0
            && request.resource.data.earmarkedMinor == 0
            // ADR-010: حدّ موقَّع، افتراضي 0. ولا وجود لـ allowNegative في المخطط.
            && isMoney(request.resource.data.minBalanceMinor)
            && !request.resource.data.keys().hasAny(['allowNegative', 'balanceMinor',
                                                     'openingBalanceMinor'])
            // القاعدة 19.9 مفروضة من الخادم: المستحق لي ليس نقداً متاحاً
            && (request.resource.data.accountId[0:17] != 'asset.receivable.'
                || request.resource.data.isCashLike == false)
          );

        allow update: if isOwner(uid)
          && unchanged(['accountId', 'type', 'normalSide', 'parentId', 'depth', 'currency',
                        'isPostable', 'isCashLike', 'isSystem', 'isArchivable', 'ownerUid',
                        'createdAt'])
          && !request.resource.data.keys().hasAny(['allowNegative', 'balanceMinor',
                                                   'openingBalanceMinor'])
          && isNonNeg(request.resource.data.debitTotalMinor)
          && isNonNeg(request.resource.data.creditTotalMinor)
          && isNonNeg(request.resource.data.earmarkedMinor)
          && isMoney(request.resource.data.minBalanceMinor)
          && request.resource.data.entryCount is int
          && request.resource.data.entryCount >= 0
          && (
               // ── المسار الطبيعي ──
               (
                    // الإجماليات لا تنقص أبداً: حتى العكس **يضيف** صفّاً مقابلاً (I4/I5)
                    request.resource.data.debitTotalMinor  >= resource.data.debitTotalMinor
                 && request.resource.data.creditTotalMinor >= resource.data.creditTotalMinor
                 && request.resource.data.entryCount       >= resource.data.entryCount
                    // ← I15/I21: حارس الرصيد مفروض من الخادم، لأن طرفَي المقارنة في نفس المستند.
                    //   الرصيد الموقَّع = الإجمالي على الجانب الطبيعي ناقص الجانب المقابل.
                 && (request.resource.data.normalSide == 'debit'
                       ? request.resource.data.debitTotalMinor - request.resource.data.creditTotalMinor
                       : request.resource.data.creditTotalMinor - request.resource.data.debitTotalMinor)
                    >= request.resource.data.minBalanceMinor
                 && rebuildIdle(uid)
               )
               // ── ADR-015: مسار إعادة البناء بقيم مطلقة — النقصان مسموح ببوابة صريحة فقط ──
               //   `||` تقصّر دائرتها ⇒ get() الثانية لا تُستدعى إلا إذا فشل المسار الطبيعي.
            || (
                    exists(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
                 && get(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
                      .data.state == 'running'
               )
          );

        allow delete: if false;                       // الأرشفة بـ status لا الحذف
      }

      // ──────────────────────────────────────────────────────────────
      // 5) accountPeriods — حركة فقط (ADR-009). لا رصيد بداية ولا نهاية.
      //    المعرّف: `${accountId}__${periodKey}`
      //    قائمة المفاتيح البيضاء هي **الآلية التي تمنع عودة العيب القاتل**: أي مستند
      //    يحمل openingBalanceMinor أو closingBalanceMinor أو balanceMinor يُرفض من الخادم.
      // ──────────────────────────────────────────────────────────────
      match /accountPeriods/{apId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && shapeIs(['id', 'ownerUid', 'schemaVersion', 'accountId', 'accountType',
                      'periodKey', 'debitMinor', 'creditMinor', 'entryCount'],
                     ['updatedAt', 'createdAt'])
          && apId == request.resource.data.accountId + '__' + request.resource.data.periodKey
          && request.resource.data.id == apId
          && isPeriodKey(request.resource.data.periodKey)
          && isNonNeg(request.resource.data.debitMinor)
          && isNonNeg(request.resource.data.creditMinor)
          && request.resource.data.entryCount is int
          && request.resource.data.entryCount >= 0;

        allow update: if isOwner(uid)
          && hasOnly(['debitMinor', 'creditMinor', 'entryCount', 'updatedAt'])
          && isNonNeg(request.resource.data.debitMinor)
          && isNonNeg(request.resource.data.creditMinor)
          && (
               (   request.resource.data.debitMinor  >= resource.data.debitMinor
                && request.resource.data.creditMinor >= resource.data.creditMinor
                && request.resource.data.entryCount  >= resource.data.entryCount
                && rebuildIdle(uid) )
            || (   exists(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
                && get(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
                     .data.state == 'running' )
          );

        // تنظيف مستند فترة شاذ أثناء إعادة البناء فقط (16.5.2 / 2.2)
        allow delete: if isOwner(uid)
          && exists(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
          && get(/databases/$(database)/documents/users/$(uid)/maintenance/rebuild)
               .data.state == 'running';
      }

      // ──────────────────────────────────────────────────────────────
      // 6) entryCorrections/{originalEntryId} — قفل التصحيح (ADR-014).
      //    يُنشأ مرة واحدة، ويُحدَّث بإلحاق على السلسلة فقط. لا حذف ولا إعادة فتح.
      // ──────────────────────────────────────────────────────────────
      match /entryCorrections/{originalEntryId} {
        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && request.resource.data.originalEntryId == originalEntryId
          && request.resource.data.chain is list
          && request.resource.data.chainLength is int
          && request.resource.data.chainLength == request.resource.data.chain.size()
          && request.resource.data.correctionReason is string
          && request.resource.data.correctionReason.size() > 0;

        // إلحاق فقط: السلسلة تطول ولا تقصر، و`voided` بوابة أحادية.
        allow update: if isOwner(uid)
          && hasOnly(['chain', 'chainLength', 'currentEntryId', 'voided', 'updatedAt'])
          && unchanged(['originalEntryId', 'ownerUid', 'createdAt'])
          && request.resource.data.chainLength > resource.data.chainLength
          && request.resource.data.chainLength == request.resource.data.chain.size()
          && (!resource.data.voided || request.resource.data.voided == true);

        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 7) obligations — ADR-011 / ADR-012
      // ──────────────────────────────────────────────────────────────
      match /obligations/{obligationId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && isPosMoney(request.resource.data.totalMinor)
          && request.resource.data.extraChargesMinor == 0
          && request.resource.data.paidMinor == 0
          && request.resource.data.remainingMinor == request.resource.data.totalMinor
          // ADR-011: الطبيعة إلزامية عند الإنشاء ولا افتراضي لها، و`financing` لا فئة مصروف له.
          && request.resource.data.nature in ['expense', 'financing']
          && (request.resource.data.nature != 'financing'
              || request.resource.data.categoryId == null)
          && isDate(request.resource.data.dueDate);

        allow update: if isOwner(uid)
          // ADR-012 / I10: totalMinor **لا يُرفع أبداً**. الزيادة تذهب إلى extraChargesMinor.
          && unchanged(['obligationId', 'nature', 'totalMinor', 'accrualEnabled',
                        'liabilityAccountId', 'isVariableAmount', 'ownerUid', 'createdAt'])
          && isNonNeg(request.resource.data.extraChargesMinor)
          && isNonNeg(request.resource.data.paidMinor)
          // I9: منع السداد الزائد — مفروض من الخادم
          && request.resource.data.paidMinor <=
             request.resource.data.totalMinor + request.resource.data.extraChargesMinor
          // I5: المتبقي مشتقّ مخزَّن ⇒ معادلته مفروضة لا مُفترضة
          && request.resource.data.remainingMinor ==
             request.resource.data.totalMinor + request.resource.data.extraChargesMinor
             - request.resource.data.paidMinor
          && request.resource.data.status in
             ['upcoming', 'due', 'overdue', 'partiallyPaid', 'paid', 'cancelled']
          && rebuildIdle(uid);

        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 8) debts — نموذج موحَّد بـ direction (القسمان 9 و10)
      // ──────────────────────────────────────────────────────────────
      match /debts/{debtId} {
        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && isPosMoney(request.resource.data.principalMinor)
          && request.resource.data.settledMinor == 0
          && request.resource.data.remainingMinor == request.resource.data.principalMinor
          && request.resource.data.direction in ['payable', 'receivable']
          // ثابت نوعي لا إعداد: السداد/التحصيل الزائد ممنوع دائماً
          && request.resource.data.allowOverSettle == false;

        allow update: if isOwner(uid)
          && unchanged(['debtId', 'direction', 'principalMinor', 'accountId', 'createdCash',
                        'counterpartyContactId', 'allowOverSettle', 'ownerUid', 'createdAt'])
          && isNonNeg(request.resource.data.settledMinor)
          && request.resource.data.settledMinor <= request.resource.data.principalMinor   // I9
          && request.resource.data.remainingMinor ==
             request.resource.data.principalMinor - request.resource.data.settledMinor    // I6
          && request.resource.data.status in
             ['open', 'partiallySettled', 'settled', 'writtenOff', 'cancelled']
          && rebuildIdle(uid);

        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 9) budgets / financialGoals — توقعات، لا مال فعلي
      // ──────────────────────────────────────────────────────────────
      match /budgets/{budgetId} {
        allow get, list: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && baseDocOk(uid)
          && isNonNeg(request.resource.data.limitMinor)
          && isNonNeg(request.resource.data.spentMinor)
          && isPeriodKey(request.resource.data.periodKey);
        allow delete: if isOwner(uid);                // الميزانية ليست قيداً مالياً
      }

      match /financialGoals/{goalId} {
        allow get, list: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && baseDocOk(uid)
          && isPosMoney(request.resource.data.targetMinor)
          && isNonNeg(request.resource.data.savedMinor)
          && isNonNeg(request.resource.data.earmarkedMinor);
        allow delete: if isOwner(uid);
      }

      // ──────────────────────────────────────────────────────────────
      // 10) pendingCommands/{opId} — طابور محلي (ADR-007). ليس دفتراً ⇒ الحذف مسموح،
      //     لأن **النجاح هو الحذف** (القسم 12): القيد كُتب والأمر خرج من الطابور.
      // ──────────────────────────────────────────────────────────────
      match /pendingCommands/{opId} {
        allow get, list: if isOwner(uid);
        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && opId == request.resource.data.opId
          && request.resource.data.payloadHash is string
          && request.resource.data.status in ['queued', 'inflight', 'failed'];
        allow update: if isOwner(uid)
          && unchanged(['opId', 'payloadHash', 'ownerUid', 'createdAt'])
          && request.resource.data.status in ['queued', 'inflight', 'failed'];
        allow delete: if isOwner(uid);
      }

      // ──────────────────────────────────────────────────────────────
      // 11) maintenance/{taskId} — بوابة ADR-015 ومؤشر الاستئناف.
      //     `rebuild` معرّف محجوز: وجوده بحالة 'running' يُقفل كل كتابة مالية.
      // ──────────────────────────────────────────────────────────────
      match /maintenance/{taskId} {
        allow get, list: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && baseDocOk(uid)
          && request.resource.data.taskId == taskId
          && request.resource.data.state in ['idle', 'running', 'verifying', 'done', 'failed']
          && request.resource.data.runToken is string;
        allow delete: if isOwner(uid);                // إنهاء الإجراء وفتح الكتابة
      }

      // ──────────────────────────────────────────────────────────────
      // 12) auditLogs/{opId} — إلحاق فقط. لا تحديث ولا حذف، **للمالك أيضاً**.
      //     المعرّف حتمي = opId ⇒ إعادة المحاولة لا تُنتج سجلين (القسم 12).
      // ──────────────────────────────────────────────────────────────
      match /auditLogs/{logId} {
        allow get, list: if isOwner(uid);
        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && request.resource.data.action is string
          && request.resource.data.at is string;
        allow update: if false;                       // ← لا يُكتب على سجل تدقيق
        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 13) settings — إعدادات عرض + `lockedPeriods` (I25).
      //     القفل يُضاف ولا يُرفع من العميل: `lockedPeriods` تطول ولا تقصر.
      // ──────────────────────────────────────────────────────────────
      match /settings/{docId} {
        allow get, list: if isOwner(uid);
        allow create: if isOwner(uid) && baseDocOk(uid);
        allow update: if isOwner(uid)
          && baseDocOk(uid)
          && (!('lockedPeriods' in resource.data)
              || request.resource.data.lockedPeriods.hasAll(resource.data.lockedPeriods));
        allow delete: if false;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 14) كتلة حرّاسة نهائية — توثيقية وتشغيلية (14.1 قاعدة 3).
    // أي مسار لم يُعدّ أعلاه مرفوض افتراضياً. هذه الكتلة تجعل الرفض **مقصوداً ومرئياً**
    // وتُجبر أي مجموعة جديدة على المرور بمراجعة أمنية قبل أن تعمل.
    // ══════════════════════════════════════════════════════════════════
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 14.3 ما تفرضه القواعد فعلاً

| # | الثابت المفروض من الخادم | موضع الفرض | الثابت |
|---|---|---|---|
| 1 | الإغلاق على UIDs معتمدة (ق-2) | `isOwner()` في كل شرط | — |
| 2 | `debitTotalMinor === creditTotalMinor` لكل قيد | `journalEntries` create | **I1** |
| 3 | `lines.size() >= 2`، وكل صفّ ترحيل بمبلغ واحد موجب صحيح | `journalEntries` + `postings` create | **I1، I2، I21، I22** |
| 4 | `periodKey === bookedAt[0:7]` على القيد والترحيل | `periodMatchesDate()` | **I13** |
| 5 | `entryId === opId` و`payloadHash` بطول 64 | `journalEntries` create | **I23، I24** |
| 6 | `postingId === entryId:lineNo` | `postings` create | **I11** |
| 7 | دلتا تسوية ≠ 0 تحمل مرجعاً تشغيلياً **واحداً بالضبط** | `postings` create | **I8** |
| 8 | الرصيد المشتقّ `≥ minBalanceMinor` حسب `normalSide` | `accounts` update | **I15، I21** |
| 9 | الإجماليات و`entryCount` لا تنقص خارج إعادة البناء | `accounts` + `accountPeriods` update | **I4، I5، I12** |
| 10 | `accountPeriods` لا تحمل رصيد بداية/نهاية/جارياً | قائمة مفاتيح بيضاء | **ADR-009** |
| 11 | `obligation.totalMinor` لا يتغيّر أبداً | `obligations` update | **I10** |
| 12 | منع السداد/التحصيل الزائد، ومعادلة المتبقي | `obligations` + `debts` update | **I5، I6، I9** |
| 13 | `nature` إلزامية ولا تتغيّر، و`financing` بلا فئة مصروف | `obligations` | **ADR-011** |
| 14 | `allowOverSettle === false` إلزامي على كل دين | `debts` | **I9** |
| 15 | لا حذف مالي، ولا تعديل محاسبي، و`postings` create-only | `allow delete: if false` + `hasOnly()` | **I30** |
| 16 | `reversed` و`voided` بوابتان أحاديتان، ولا عكس لقيد عكس | `journalEntries` + `entryCorrections` update | **I17، I18** |
| 17 | قفل التصحيح إلحاقي: `chainLength` يطول ولا يقصر | `entryCorrections` | **I26** |
| 18 | لا كتابة مالية أثناء إعادة البناء | `rebuildIdle()` على كل create/update مالي | **I29** |
| 19 | `lockedPeriods` تطول ولا تقصر | `settings` update | **I25** (جزئياً) |
| 20 | اختفاء `allowNegative` و`balanceMinor` و`openingBalanceMinor` من المخطط | `hasAny()` نافية | **ADR-009، ADR-010** |
| 21 | `isCashLike === false` على حسابات المستحق لي | `accounts` create | القاعدة 19.9 |
| 22 | بادئة `accountId` تساوي `type` | `accounts` create | **I-COA-1** |

### 14.4 ما **لا** تستطيع القواعد فرضه — وما البديل (ADR-020)

لغة القواعد تُقيّم **كل مستند على حدة**، بلا حلقات، وبلا رؤية لبقية مستندات نفس الـ batch
(عدا `getAfter()` — بند 14.5). النتيجة ثمانية ثقوب معلنة:

| # | ما لا تستطيعه القاعدة | لماذا | البديل المعتمد (ADR-020) |
|---|---|---|---|
| 1 | **ميزان المراجعة عبر الحسابات** (I2): `Σ debitTotalMinor = Σ creditTotalMinor` على ~45 مستند | ثابت عبر مستندات متعددة؛ القاعدة ترى مستنداً واحداً | بصمة الدفتر بـ `getAggregateFromServer` (16.2) + اختبار `integration/trial-balance` |
| 2 | **صحة المُجمَّعات** (I5، I12): أن تكون زيادة `account.debitTotalMinor` مساوية لمجموع سطور القيد المدينة على ذلك الحساب | يتطلب المرور على `lines` — **لا حلقات في اللغة** | مسار كتابة وحيد (`postOperation`) + اختبار جدولي لكل عملية (20.2) + `reconcileAccount` (16.1) |
| 3 | **اكتمال الـ batch**: batch يكتب القيد ويُغفل `accountPeriods` **يُقبَل بالكامل** | كل كتابة تُقيَّم مستقلة | ذرّية `runTransaction` في مسار الكتابة الوحيد + `reconcileAccount` يكشف الانحراف لاحقاً |
| 4 | **تطابق `postings` مع `lines`** (I11) | مقارنة عبر مستندات + حلقة | معرّف حتمي `entryId:lineNo` + فاحص `orphanScan` (16.3) |
| 5 | **اتجاه القيد محاسبياً** (مدين/دائن معكوسان) | معكوس الاتجاه **متوازن تماماً** ⇒ لا ثابت رياضي يكشفه | اختبار جدولي لكل سطر في جدول القسم 9. الحماية **اختبارية لا بنيوية**. قصور معلن (18.1 بند 6) |
| 6 | **صحة الدلتا التشغيلية** (I6، I7): أن تكون زيادة `paidMinor` = مبلغ الدفعة في القيد | ثابت عبر مستندين | ADR-021: `Σ settlementDeltaMinor` مصدر **مستقل** يُقارَن في `reconcileObligation` (16.4) |
| 7 | **صافي الترحيلات صفر** (I3) ومجموع الفترات = حركة الحساب (I12) | تجميع عبر مجموعة كاملة | `getAggregateFromServer` في الفاحص اليومي (16.2) |
| 8 | **الفترة المُقفلة** (I25) بالكامل | القاعدة تمنع **تقصير** `lockedPeriods`، ولا تقرأ القائمة لتمنع قيداً داخلها إلا بـ `get()` إضافية على `settings` | الحارس G9 في النطاق + الفحص المسبق. إضافة `get()` ثانية لكل قيد خيار مفتوح (22.2 بند م-4) |

**الخلاصة المعلنة للمالك:** القواعد على Spark تحمي **شكل كل مستند وثوابته الداخلية** وتمنع الحذف
والتعديل المحاسبي والوصول غير المصرَّح، **وتُقفل الكتابة أثناء الصيانة**. أما **الثوابت العرضية بين
المستندات** فمحميّة بمسار كتابة وحيد واختبارات وفاحص دوري، **لا بالخادم**. الفرض الخادمي الحقيقي
يحتاج Cloud Functions ⇒ **Blaze** (18.1 بند 1).

### 14.5 ADR-022 — `getAfter()` — **مقترح غير معتمد**

**الفكرة:** إلزام أن كل تحديث لمُجمَّعات حساب يكون مصحوباً بقيد في **نفس** الـ transaction/batch.
`getAfter()` تقرأ حالة المستند **بعد** الـ commit المقترح، فترى مستند القيد الذي يُكتب معها.

```javascript
// مقترح — لا يُضاف إلى firestore.rules قبل الإثبات في المحاكي
match /accounts/{accountId} {
  allow update: if isOwner(uid)
    && /* … كل شروط 14.2 … */
    && (
         getAfter(/databases/$(database)/documents/users/$(uid)/journalEntries/$(request.resource.data.lastPostedEntryId))
           .data.ownerUid == uid
      && getAfter(/databases/$(database)/documents/users/$(uid)/journalEntries/$(request.resource.data.lastPostedEntryId))
           .data.accountIds.hasAny([accountId])      // القيد يمسّ هذا الحساب فعلاً
      || /* فرع إعادة البناء */ false
    );
}
```

الحقل المطلوب موجود أصلاً في القسم 4: **`accounts.lastPostedEntryId`** ⇒ المقترح لا يضيف حقلاً.

**ما يُضيفه فعلاً:** يُغلق الثقب رقم 3 جزئياً — لم يبقَ ممكناً تحديث مُجمَّع **بلا قيد** ولا بقيد
**لا يمسّ هذا الحساب**. لا يُغلق الثقب 2 (قيمة الزيادة) ولا 5 (الاتجاه).

**مخاطره وتكلفته — سبب عدم الاعتماد قبل الإثبات:**

1. **حدّ استدعاءات الوصول:** 10 لكل طلب مستند واحد، **20 لكل transaction/batch**، وبوابة
   `rebuildIdle()` تستهلك منها أصلاً واحداً لكل كتابة. مصروف يكتب ~8 مستندات؛ مع `getAfter` على
   الحسابات والفترات = 4 استدعاءات إضافية ⇒ داخل الحد. **تعديل** (12–16 مستنداً) قد يبلغ 8، و**مصروف
   مقسَّم على 6 فئات** قد يتجاوز 20 فجأةً فتفشل العملية بـ `PERMISSION_DENIED` غامض.
2. **التكلفة:** كل `getAfter` قراءة مفوترة. +2 إلى +4 لكل عملية ⇒ بـ 15 عملية/يوم = 60 قراءة
   = 0.12% من الحصة ⇒ **التكلفة ليست العقبة**.
3. **الهشاشة:** يربط صحة الكتابة بحقل `lastPostedEntryId` يكتبه العميل. عميل مُعطوب يضع فيه معرّف
   قيد **قديم** يمسّ نفس الحساب ⇒ **يمرّ**. أي أن الحماية أضعف ممّا تبدو.
4. **تعطيل إعادة البناء:** إعادة البناء تحدّث المُجمَّعات بلا قيد مصاحب ⇒ تحتاج فرع استثناء، وهو ما
   يفتح بوابة واسعة أثناء الصيانة. مقايضة صريحة.

**كيف يُثبَت في المحاكي قبل الاعتماد** (`tests/rules/getafter.proposal.test.ts`، لا يُنشر معه الإنتاج):

| الاختبار | المتوقع |
|---|---|
| `accounts.update` منفرد بلا قيد في نفس الـ batch | `PERMISSION_DENIED` |
| `batch { accounts.update + journalEntries.create }` و`lastPostedEntryId` يطابق القيد | **يُقبل** |
| نفس الـ batch لكن `accountIds` في القيد لا تحتوي `accountId` | `PERMISSION_DENIED` |
| كتابتان منفصلتان (القيد في طلب ثم الحساب في طلب ثانٍ) | `PERMISSION_DENIED` ← **بيت القصيد** |
| `batch` يمسّ 6 حسابات و6 فترات (12 `getAfter` + 12 `rebuildIdle`) | قياس: هل يُرفض بـ `resource exhausted`؟ **إن رُفض ⇒ المقترح مرفوض** |
| إعادة بناء بحالة `maintenance/rebuild.state === 'running'` | **يُقبل** بلا `lastPostedEntryId` صحيح |
| قياس القراءات المفوترة في 100 عملية | ≤ 400 قراءة إضافية |

**قرار البوابة:** يُعتمد ADR-022 **فقط** إن نجحت الصفوف الستة الأولى **و** لم يفشل صف الحد الأقصى.
إن فشل صف الحد ⇒ **يُرفض نهائياً** ويُسجَّل سبب الرفض في `docs/adr/ADR-022-*.md`.


---

## 15. التكلفة على Spark والفهارس

### 15.1 أساس الحساب

| الحد اليومي المجاني على Spark | القيمة |
|---|---|
| قراءات مستندات | **50,000/يوم** |
| كتابات مستندات | **20,000/يوم** |
| حذف مستندات | 20,000/يوم |
| التخزين | 1 GiB |
| النطاق الصادر | 10 GiB/شهر |

**قواعد الفوترة التي تحكم كل الأرقام أدناه — خمس قواعد، كل رقم في هذا القسم مشتقّ منها:**

1. كل مستند يُعاد من استعلام = قراءة واحدة. **الاستعلام الفارغ = قراءة واحدة** (الحد الأدنى).
2. `count()` / `sum()` / `average()` عبر `getAggregateFromServer` = **قراءة واحدة لكل 1,000 مدخلة
   فهرس ممسوحة**، بحد أدنى 1. هذا سبب ADR-016: بصمة الدفتر على 14,000 ترحيل = **14 قراءة لا 14,000**.
3. **كل `exists()` و`get()` و`getAfter()` داخل القواعد = قراءة مفوترة.** بوابة `rebuildIdle()`
   تكلّف **قراءة واحدة لكل كتابة مالية** — تُحتسب صريحاً في 15.2 ولا تُخفى.
4. القراءة من الذاكرة المؤقتة المحلية **غير مفوترة**. المستمع `onSnapshot` يُحسب مرة لكل مستند في
   اللقطة الأولى، ثم لكل مستند **متغيّر** فقط.
5. كل مستند يُكتب = كتابة واحدة. الـ `runTransaction` و`writeBatch` **لا يُخفّضان العدد**.

### 15.2 القراءات/الكتابات لكل عملية

لشجرة حسابات نموذجية: **~45 حساباً**، منها ~8 نقدية و~12 ورقة مصروف/دخل.
«ق.قواعد» = القراءات التي تستهلكها بوابة `rebuildIdle()` في القواعد.

| العملية | ق. المعاملة | ق. القواعد | **الكتابات** | تفصيل الكتابات |
|---|---|---|---|---|
| **مصروف نقدي بسيط** | 5 | **1** | **8** | `journalEntries` 1 + `postings` 2 + `accounts` 2 + `accountPeriods` 2 + `auditLogs` 1 |
| **دخل مستلم** | 5 | 1 | 8 | مطابق |
| **تحويل بين حسابين** | 5 | 1 | 8 | الطرفان `asset` ⇒ لا حساب دخل/مصروف في القيد أصلاً |
| **دفع التزام `expense`** | 6 | 1 | **9** | +`obligations` 1 |
| **دفع التزام `financing`** | 6 | 1 | 9 | نفس العدد، أطراف مختلفة (ADR-011) |
| **تحصيل/سداد دين** | 6 | 1 | 9 | +`debts` 1 |
| **مصروف مقسَّم على 3 فئات** | 7 | 1 | **12** | 4 سطور ⇒ `postings` 4 + `accounts` 4 + `accountPeriods` 4 |
| **إلغاء (عكس)** | 8 | 1 | **11** | قيد عكس 1 + `postings` 2 معاكسة + وسم الأصل 1 + `accounts` 2 + `accountPeriods` 2 + `entryCorrections` 1 + `auditLogs` 1. **لا تعديل على `postings` الأصلية** — العكس يكتب صفوفاً جديدة |
| **تعديل (عكس + بديل)** | 10 | 1 | **16** | قيدان + 4 `postings` + وسم الأصل + `accounts` 2 + `accountPeriods` 2 + `entryCorrections` 1 + `auditLogs` 1 |
| **رصيد افتتاحي لحساب** | 5 | 1 | 8 | قيد `opening` مقابل `equity.opening` |
| **إعادة الضغط على الزر (نفس `opId`)** | **1** | 0 | **0** | `journalEntries/{opId}` موجود ⇒ `alreadyApplied` ⇒ خروج فوري بلا كتابة |
| **ترحيل أمر من `pendingCommands`** | 5 | 1 | 8 + حذف 1 | النجاح = حذف مستند الطابور |

**ملاحظة على بوابة القواعد:** القراءة الواحدة تُحتسب مرة لكل **طلب** لا مرة لكل مستند، لأن Firestore
يُخزّن نتيجة `get()` على نفس المسار داخل تقييم الطلب الواحد. المعاملة الواحدة = طلب واحد ⇒ **+1 لا +8**.

### 15.3 القراءات لكل فتح لوحة تحكم

| البطاقة/الرسم | المصدر | باردة | ساخنة (مع الذاكرة المؤقتة) |
|---|---|---|---|
| إجمالي الأموال المتاحة + شاشة الحسابات | `accounts` حيث `isCashLike == true` و`status == 'active'` | **8** | 0–2 (المتغيّر فقط) |
| الدخل/المصروف/الصافي لهذا الشهر | `accountPeriods` حيث `periodKey == pk` و`accountType in ['income','expense']` | **20** | 0–4 |
| الالتزامات القادمة والمتأخرة | `obligations` حيث `status in [...]` مرتَّباً بـ `dueDate`، حد 10 | **10** | 0–1 |
| الديون عليّ / لي | `debts` حيث `direction` + `status`، حد 10 لكل اتجاه | **20** | 0–1 |
| نسبة استهلاك الميزانية | `budgets` حيث `periodKey == pk` | **6** | 0–1 |
| الأهداف المالية | `financialGoals` حيث `status == 'active'` | **5** | 0–1 |
| عمليات معلّقة (ADR-007) | `pendingCommands` حيث `status != 'done'` | **1** (فارغ عادةً) | 1 |
| حالة الصيانة | `maintenance/rebuild` | **1** | 1 |
| **المجموع الأساسي** | | **71** | **3–11** |
| رسم «اتجاهات الإنفاق 12 شهراً» | `accountPeriods` حيث `accountType == 'expense'` و`periodKey >= pk-11` | **+144** | 0 بعد أول تحميل |
| **المجموع مع الرسم السنوي** | | **215** | **3–11** |

**الاستهلاك الواقعي اليومي لمستخدم واحد:**

| السلوك | الحساب | النتيجة | % من الحصة |
|---|---|---|---|
| 15 عملية مالية/يوم | 15 × (5.6 ق. معاملة + 1 ق. قواعد + 8.7 كتابة) | **99 قراءة · 131 كتابة** | 0.20% · 0.66% |
| 20 فتحة لوحة تحكم (الأولى باردة) | 215 + 19 × 9 | **386 قراءة** | 0.77% |
| كشف حركة حساب 3 صفحات × 25 | على `postings` بترقيم | **75 قراءة** | 0.15% |
| الفحص اليومي `runLedgerHealthCheck` | 3 تجميعات + استعلام `accounts` | **~90 قراءة** | 0.18% |
| تقرير شهري | `postings` حيث `periodKey == pk` ≈ 400 صفّ | **400 قراءة** | 0.80% |
| **إجمالي يوم كثيف** | | **~1,050 قراءة · ~132 كتابة** | **2.1% · 0.66%** |

**الهامش: ~47 ضعفاً في القراءة و~150 ضعفاً في الكتابة.** التكلفة الكمّية **ليست قيداً**.
القيد الحقيقي على Spark هو **غياب Cloud Functions وStorage** (القسم 18)، لا الحصة.

### 15.4 متى نقترب من الحصة **واقعياً** — أربعة سيناريوهات فقط

| السيناريو | الحساب | الحصة | الحكم والعلاج |
|---|---|---|---|
| **1. إعادة بناء إسقاطات كاملة** بعد 3 سنوات (~6,000 قيد، ~14,000 ترحيل) | مسح 14,000 ترحيل + كتابة 45 حساب + ~1,620 `accountPeriods` + مستند مؤشر لكل صفحة (~47) | **14,000 قراءة (28%)** + ~1,712 كتابة (8.6%) | **سيناريو حقيقي.** ثلاث عمليات في يوم = 84% ⇒ العلاج: مؤشر استئناف + **منع أكثر من بناءين يومياً** بفحص `maintenance/rebuild.startedAt` |
| **2. تصدير JSON كامل** (ق-1، النسخة الاحتياطية الوحيدة) | 6,000 + 14,000 + 45 + 1,620 + ~200 ≈ **21,900 قراءة (44%)** | 44% | **سيناريو حقيقي وشهري.** العلاج: تصدير **تزايدي** بـ `where createdAt > lastExportAt` ⇒ أقل من 500 قراءة شهرياً بعد النسخة الأولى. الكامل مرة سنوياً (22.2 بند م-9) |
| **3. تقرير «كل الأوقات» بلا حد** | مسح `postings` كاملاً | 14,000 (28%) | **منع معماري:** كل استعلام تقرير **ملزَم بـ `periodKey` أو نطاق `bookedAt`**، ومجال «كل الأوقات» يُخدَم من `accountPeriods` المُجمَّعة (1,620 مستنداً) لا من `postings`. تُفرَض القاعدة في مراجعة الطبقة `data` ويحرسها `integration/query-index-coverage` |
| **4. استعلام بلا فهرس مركَّب** | Firestore يرفضه بـ `FAILED_PRECONDITION` ولا يهدر حصة | 0 | **ليس خطر تكلفة بل خطر إيقاف.** العلاج: كل استعلام في `data` له فهرس في 15.6، واختبار محاكي يمرّ على كل استعلام (20.2) |

**الاستهلاك غير الواقعي (يُستبعد صريحاً):** 2,300 عملية مالية يومياً (= سقف الكتابة ÷ 8.7) يعني 96
عملية في الساعة بلا توقف. 232 فتحة لوحة تحكم باردة يومياً. **لا سيناريو شخصي يقاربهما.**

### 15.5 التخزين والنمو

| الكيان | حجم المستند المقدَّر | العدد بعد 3 سنوات | الحجم |
|---|---|---|---|
| `journalEntries` (سطور مضمَّنة، ~2.3 سطر/قيد) | ~1.2 KB | 6,000 | 7.2 MB |
| `postings` | ~0.45 KB | 14,000 | 6.3 MB |
| `accountPeriods` | ~0.2 KB | 1,620 | 0.3 MB |
| `auditLogs` | ~0.4 KB | 6,500 | 2.6 MB |
| الباقي (`accounts`, `obligations`, `debts`, `budgets`, `financialGoals`, `settings`) | — | ~400 | 0.3 MB |
| **البيانات** | | | **~17 MB** |
| **الفهارس** (≈ 2.5× بعد الاستثناءات في 15.6) | | | **~43 MB** |
| **الإجمالي** | | | **~60 MB من 1 GiB = 6%** |

بلا استثناءات الفهرسة في 15.6، فهرسة `lines` (مصفوفة خرائط بـ 11 حقلاً لكل سطر) وحدها تضاعف الحجم
وتُبطئ كل كتابة قيد. **الاستثناءات ليست تحسيناً اختيارياً.**

### 15.6 `firestore.indexes.json`

> **ملاحظتان بنيويتان تُفسّران غياب مرشّح `reversed` من كل فهارس `postings`:**
> (1) صفّ الترحيل **لا يحمل حقل دورة حياة**؛ العكس يكتب صفوفاً معاكسة ⇒ كل مجموع يُصفِّر نفسه
> رياضياً بلا أي منطق استبعاد. (2) المبلغ في حقلين (`debitMinor` / `creditMinor`) لا في حقل واحد
> مع `side` ⇒ `sum('debitMinor')` يعمل بفهرس واحد بلا مرشّح جانب.

```jsonc
{
  "indexes": [
    // ── postings: الإسقاط المسطَّح — مصدر كل تجميع وكل كشف ──

    // كشف حركة حساب (القسم 5): where accountId == X order by bookedAt desc
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId", "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    // reconcileAccount (16.1): sum('debitMinor') و sum('creditMinor') لحساب واحد
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId",   "order": "ASCENDING" },
      { "fieldPath": "debitMinor",  "order": "ASCENDING" } ] },
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId",   "order": "ASCENDING" },
      { "fieldPath": "creditMinor", "order": "ASCENDING" } ] },

    // إعادة بناء accountPeriods (16.5): فترة واحدة، مرتَّبة بالمعرّف لمؤشر الاستئناف
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "accountId", "order": "ASCENDING" },
      { "fieldPath": "__name__",  "order": "ASCENDING" } ] },

    // تقرير الدخل/المصروف الشهري بلا انضمام (accountType على الصفّ)
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey",   "order": "ASCENDING" },
      { "fieldPath": "accountType", "order": "ASCENDING" },
      { "fieldPath": "debitMinor",  "order": "ASCENDING" } ] },

    // استهلاك الميزانية بـ sum() خادمي (categoryId على الصفّ)
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey",  "order": "ASCENDING" },
      { "fieldPath": "categoryId", "order": "ASCENDING" },
      { "fieldPath": "debitMinor", "order": "ASCENDING" } ] },

    // مصاريف المنزل (§11): نفس المصروفات بعدسة scope — لا تكرار قيمة
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "scope",     "order": "ASCENDING" },
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    // «حجم التحويلات» و«المقترض» و«المسدَّد» بمجموع واحد (kind على الصفّ)
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "kind",       "order": "ASCENDING" },
      { "fieldPath": "periodKey",  "order": "ASCENDING" },
      { "fieldPath": "debitMinor", "order": "ASCENDING" } ] },

    // ADR-005: سجل دفعات الالتزام = استعلام على الدفتر، لا مجموعة موازية
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "obligationId", "order": "ASCENDING" },
      { "fieldPath": "bookedAt",     "order": "DESCENDING" } ] },

    // ADR-021 / I6: Σ settlementDeltaMinor للالتزام — المصدر المستقل لصحة paidMinor
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "obligationId",         "order": "ASCENDING" },
      { "fieldPath": "settlementDeltaMinor", "order": "ASCENDING" } ] },

    // ADR-021 / I7: نفسه للدين
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "debtId",               "order": "ASCENDING" },
      { "fieldPath": "settlementDeltaMinor", "order": "ASCENDING" } ] },

    // «صافي مركزي مع فلان» (القسم 10): استعلام واحد لا استعلامان
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "contactId", "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    // تقدّم الهدف المالي
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "goalId",     "order": "ASCENDING" },
      { "fieldPath": "bookedAt",   "order": "DESCENDING" } ] },

    // بصمة الدفتر (ADR-016 / I2، I3): sum على كل المجموعة لكل جانب
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "debitMinor",  "order": "ASCENDING" } ] },
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "creditMinor", "order": "ASCENDING" } ] },

    // ── journalEntries ──
    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "kind",     "order": "ASCENDING" },
      { "fieldPath": "reversed", "order": "ASCENDING" },
      { "fieldPath": "bookedAt", "order": "DESCENDING" } ] },

    // كشف حركة حساب على مستوى القيد (array-contains على accountIds) + ترتيب
    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountIds", "arrayConfig": "CONTAINS" },
      { "fieldPath": "bookedAt",   "order": "DESCENDING" } ] },

    // قائمة عمليات المنزل (3.8)
    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "scopes",   "arrayConfig": "CONTAINS" },
      { "fieldPath": "bookedAt", "order": "DESCENDING" } ] },

    // التصدير التزايدي (15.4 سيناريو 2) — ترتيب كلي مستقر
    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "createdAt", "order": "ASCENDING" },
      { "fieldPath": "__name__",  "order": "ASCENDING" } ] },

    // ── accountPeriods: ADR-009 — الحركة فقط ──
    // لوحة التحكم: حركة كل حسابات المصروف لهذه الفترة بلا انضمام
    { "collectionGroup": "accountPeriods", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey",   "order": "ASCENDING" },
      { "fieldPath": "accountType", "order": "ASCENDING" } ] },

    // الرصيد التراكمي المشتقّ: كل فترات حساب واحد مرتَّبة (ADR-009 / I12)
    { "collectionGroup": "accountPeriods", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId", "order": "ASCENDING" },
      { "fieldPath": "periodKey", "order": "ASCENDING" } ] },

    // رسم «12 شهراً» (15.3)
    { "collectionGroup": "accountPeriods", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountType", "order": "ASCENDING" },
      { "fieldPath": "periodKey",   "order": "ASCENDING" } ] },

    // ── accounts ──
    { "collectionGroup": "accounts", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "isCashLike", "order": "ASCENDING" },
      { "fieldPath": "status",     "order": "ASCENDING" },
      { "fieldPath": "sortOrder",  "order": "ASCENDING" } ] },

    { "collectionGroup": "accounts", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "type",      "order": "ASCENDING" },
      { "fieldPath": "status",    "order": "ASCENDING" },
      { "fieldPath": "sortOrder", "order": "ASCENDING" } ] },

    // ── obligations / debts ──
    { "collectionGroup": "obligations", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status",  "order": "ASCENDING" },
      { "fieldPath": "dueDate", "order": "ASCENDING" } ] },

    // ADR-011: فصل الالتزام التمويلي عن المصروف في كل تقرير
    { "collectionGroup": "obligations", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "nature",  "order": "ASCENDING" },
      { "fieldPath": "status",  "order": "ASCENDING" },
      { "fieldPath": "dueDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "debts", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "direction",       "order": "ASCENDING" },
      { "fieldPath": "status",          "order": "ASCENDING" },
      { "fieldPath": "expectedSettleAt","order": "ASCENDING" } ] },

    { "collectionGroup": "debts", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "counterpartyContactId", "order": "ASCENDING" },
      { "fieldPath": "status",                "order": "ASCENDING" } ] },

    // ── auditLogs / pendingCommands ──
    { "collectionGroup": "auditLogs", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "targetEntryId", "order": "ASCENDING" },
      { "fieldPath": "at",            "order": "DESCENDING" } ] },

    { "collectionGroup": "pendingCommands", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status",    "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "ASCENDING" } ] }
  ],

  "fieldOverrides": [
    // `lines` مصفوفة خرائط مضمَّنة بـ 11 حقلاً لكل سطر: فهرستها الأحادية تُنتج مدخلة لكل
    // حقل في كل سطر ⇒ تضخّم الفهارس وتُبطئ كل كتابة قيد. **ولا يُستعلم عنها بـ where أبداً**،
    // لأن كل استعلام مستوى-سطر يذهب إلى `postings` (وهو سبب وجودها).
    { "collectionGroup": "journalEntries", "fieldPath": "lines",       "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "description", "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "memo",        "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "payloadHash", "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "attachments", "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "deviceId",    "indexes": [] },

    // accountIds و accountTypes و scopes تُستعلم بـ array-contains فقط ⇒ نُلغي الترتيبين
    { "collectionGroup": "journalEntries", "fieldPath": "accountIds",
      "indexes": [ { "queryScope": "COLLECTION", "arrayConfig": "CONTAINS" } ] },
    { "collectionGroup": "journalEntries", "fieldPath": "accountTypes",
      "indexes": [ { "queryScope": "COLLECTION", "arrayConfig": "CONTAINS" } ] },
    { "collectionGroup": "journalEntries", "fieldPath": "scopes",
      "indexes": [ { "queryScope": "COLLECTION", "arrayConfig": "CONTAINS" } ] },

    { "collectionGroup": "obligations", "fieldPath": "notes",        "indexes": [] },
    { "collectionGroup": "obligations", "fieldPath": "installments", "indexes": [] },
    { "collectionGroup": "debts",       "fieldPath": "notes",        "indexes": [] },
    { "collectionGroup": "debts",       "fieldPath": "followUps",    "indexes": [] },
    { "collectionGroup": "debts",       "fieldPath": "installments", "indexes": [] },
    { "collectionGroup": "auditLogs",   "fieldPath": "before",       "indexes": [] },
    { "collectionGroup": "auditLogs",   "fieldPath": "after",        "indexes": [] },
    { "collectionGroup": "maintenance", "fieldPath": "grandTotals",  "indexes": [] },
    { "collectionGroup": "maintenance", "fieldPath": "periodTotals", "indexes": [] }
  ]
}
```

**الاستثناءان الأخيران مهمّان:** `maintenance/rebuild` يحمل خريطتَي تراكم قد تبلغا 45 مفتاحاً،
ويُكتب **مرة لكل صفحة** أثناء إعادة البناء (~47 كتابة). فهرستهما الأحادية تُنتج ~4,200 مدخلة فهرس
بلا أي استعلام يستفيد منها.

**البحث النصي** (وصف، ملاحظات، وسوم) يتم **محلياً على النتائج المحمَّلة** في نطاق فترة محدَّدة.
Firestore لا يملك بحثاً نصياً، والبديل (Algolia/Typesense) يحتاج خادماً ⇒ **Blaze**. قصور معلن (18.1 بند 10).


---

## 16. إعادة بناء الإسقاطات والتسوية

**المبدأ الحاكم:** `journalEntries` و`postings` هي **الحقيقة**. `accounts` و`accountPeriods`
و`obligations.paidMinor` و`debts.settledMinor` و`budgets.spentMinor` و`financialGoals.savedMinor`
**إسقاطات** قابلة للحساب من الحقيقة. أي تعارض بينهما ⇒ **الإسقاط خاطئ، لا الدفتر.**

القسم 12 يعطي **خوارزمية** `rebuildProjections` ومستند `maintenance/rebuild`. هذا القسم يعطي
**الإجراء التشغيلي**: الفحوص الأرخص التي تسبقه، ومتى يُشغَّل ومن يُشغّله، وكيف يُعرض، وماذا يحدث
عند كشف انحراف. ثلاثة إجراءات متدرِّجة التكلفة، لا إجراء واحد:

| الإجراء | ما يفعله | التكلفة | متى يُشغَّل | من يُشغّله |
|---|---|---|---|---|
| `runLedgerHealthCheck()` | **فحص** بصمة الدفتر وميزان المراجعة. **لا يكتب أي إسقاط** | **~90 قراءة + 1 كتابة** | تلقائياً عند أول فتح للتطبيق كل يوم | النظام، في الخلفية، غير حاجب |
| `reconcileAccount(id)` · `reconcileObligation(id)` · `reconcileDebt(id)` | **فحص** كيان واحد مقابل الدفتر | **~7 قراءات** للواحد | عند الطلب من شاشة الكيان، وتلقائياً لكل كيان منحرف يكشفه الفحص اليومي | المستخدم بزر، أو الفحص اليومي |
| `rebuildProjections(scope)` | **إصلاح**: يُعيد حساب الإسقاطات بقيم مطلقة من `postings` | **~14,000 قراءة** بعد 3 سنوات | **يدوياً فقط، بموافقة صريحة** | المالك وحده، من شاشة سلامة البيانات |

### 16.1 `reconcileAccount` — التسوية الرخيصة

```ts
// domain/ledger/reconcile.ts  —  نقية: تأخذ أرقاماً وتُعيد حكماً، لا تلمس Firestore
export interface AccountReconciliation {
  accountId: AccountId;
  normalSide: Side;
  storedDebitTotalMinor: Minor;      // من accounts/{id}
  storedCreditTotalMinor: Minor;
  ledgerDebitTotalMinor: Minor;      // من sum('debitMinor')  على postings
  ledgerCreditTotalMinor: Minor;     // من sum('creditMinor') على postings
  storedBalanceMinor: Minor;         // مشتقّ من المخزَّن (لا حقل مخزَّن — I4)
  ledgerBalanceMinor: Minor;         // مشتقّ من الدفتر
  debitDriftMinor: Minor;            // stored − ledger
  creditDriftMinor: Minor;
  balanceDriftMinor: Minor;
  verdict: 'clean' | 'drift';
}

/** الرصيد **دائماً** مشتقّ: لا حقل `balanceMinor` في أي مستند (I4). */
export function balanceOf(
  normalSide: Side, debitTotalMinor: Minor, creditTotalMinor: Minor,
): Minor {
  return normalSide === 'debit'
    ? subMinor(debitTotalMinor, creditTotalMinor)
    : subMinor(creditTotalMinor, debitTotalMinor);
}

export function judgeAccount(
  acc: Pick<Account, 'accountId' | 'normalSide' | 'debitTotalMinor' | 'creditTotalMinor'>,
  ledger: { debitMinor: Minor; creditMinor: Minor },
): AccountReconciliation;
```

```ts
// data/ledger/reconcile.ts  —  الطبقة الوحيدة التي تلمس Firestore
export async function reconcileAccount(
  ctx: DataContext, accountId: AccountId,
): Promise<AccountReconciliation> {
  const accRef = doc(db, `users/${ctx.uid}/accounts/${accountId}`);
  const rows   = query(
    collection(db, `users/${ctx.uid}/postings`),
    where('accountId', '==', accountId),
  );
  // لا مرشِّح `reversed`: صفّ الترحيل لا يحمل دورة حياة، والعكس يكتب صفوفاً معاكسة
  // ⇒ المجموع يُصفِّر نفسه رياضياً (القسم 1.2 حجة 2).
  //
  // ADR-016: لا مستند عدّاد ساخن. التجميع عند الطلب من الخادم.
  // getAggregateFromServer **لا يعمل داخل runTransaction ولا دون اتصال** — مقبول
  // لأنه أداة تسوية لا مسار كتابة.
  const [accSnap, agg] = await Promise.all([
    getDoc(accRef),
    getAggregateFromServer(rows, {
      debit:  sum('debitMinor'),
      credit: sum('creditMinor'),
    }),
  ]);

  return judgeAccount(accSnap.data() as Account, {
    debitMinor:  agg.data().debit  as Minor,
    creditMinor: agg.data().credit as Minor,
  });
}
```

**تكلفته:** 1 قراءة للحساب + قراءة واحدة لكل 1,000 مدخلة فهرس. حساب نقدي بـ 2,500 ترحيل ⇒
`ceil(2500/1000) = 3` لكل تجميع. والتجميعان في **طلب واحد** (`getAggregateFromServer` يقبل عدة
تجميعات) ⇒ **~7 قراءات إجمالاً**، لا 14.

**ثقب معلن:** `getAggregateFromServer` يتجاهل الذاكرة المؤقتة ⇒ **لا يعمل دون اتصال** ويرمي
`unavailable`. الواجهة تعرض: «لا يمكن فحص سلامة البيانات دون اتصال» — **ولا تعرض «سليم» أبداً.**

### 16.2 `runLedgerHealthCheck` — بصمة الدفتر (ADR-016)

```ts
export interface LedgerFingerprint {
  takenAt: ISODateTime;              // بتوقيت ليبيا UTC+2 الثابت
  postingCount: number;
  ledgerDebitSumMinor: Minor;        // Σ debitMinor  على كل postings
  ledgerCreditSumMinor: Minor;       // Σ creditMinor على كل postings
  ledgerSettlementSumMinor: Minor;   // Σ settlementDeltaMinor        (ADR-021)
  accountsDebitTotalMinor: Minor;    // Σ accounts.debitTotalMinor
  accountsCreditTotalMinor: Minor;
  accountsEntryCountSum: number;     // Σ accounts.entryCount
}

export type HealthVerdict =
  | { kind: 'clean' }
  | { kind: 'offline' }                                      // لا حكم — لا يُعرض «سليم»
  | { kind: 'unbalancedLedger'; driftMinor: Minor }          // I2/I3 مكسور في الدفتر نفسه
  | { kind: 'projectionDrift';  debitDriftMinor: Minor; creditDriftMinor: Minor };

export function judgeLedger(fp: LedgerFingerprint): HealthVerdict;
```

**الفحوص الثلاثة بترتيب الخطورة — الترتيب نفسه هو المعلومة:**

| # | الفحص | الثابت | ما يعنيه الفشل | الخطورة |
|---|---|---|---|---|
| 1 | `ledgerDebitSumMinor === ledgerCreditSumMinor` | **I2، I3** | **الدفتر نفسه غير متوازن.** لا تُصلحه إعادة البناء — المشكلة في الحقيقة لا في الإسقاط. يعني صفوف ترحيل ناقصة أو قيداً نصفه كُتب | **حرجة** |
| 2 | `accountsDebitTotalMinor === ledgerDebitSumMinor` (وكذلك الدائن) | **I5** | الإسقاط منحرف عن الدفتر. **تُصلحه إعادة البناء** | عالية |
| 3 | `accountsDebitTotalMinor === accountsCreditTotalMinor` | **I2** | ميزان المراجعة على المُجمَّعات. ينهار إن فُقد طرف تحويل | عالية |

**لماذا الترتيب مهم:** فشل (1) يجعل (2) و(3) بلا معنى، وإعادة البناء في تلك الحالة **تثبّت الخطأ**
في الإسقاطات بدل أن تُصلحه. لذلك الحكم يتوقف عند أول فشل ولا يتابع.

**التكلفة:** 3 تجميعات على `postings` في طلب واحد (~14 قراءة بعد 3 سنوات) + استعلام `accounts` (45)
≈ **~60–90 قراءة** + كتابة واحدة لطابع التشغيل. مرة يومياً = **0.18% من الحصة**.

**مُشغِّل التأطير:** يُستدعى من `AppBootstrap` بعد المصادقة بثلاثة شروط: وجود اتصال،
و`maintenance/rebuild.state !== 'running'`، و`settings/integrity.lastHealthCheckDay !== todayLibya()`.
يُكتب `lastHealthCheckDay` بعد الفحص. **غير حاجب**: ينفَّذ في الخلفية والتطبيق يعمل.

### 16.3 `orphanScan` — فحص اليتم (الثابت I11)

الفحص الذي لا يستطيع التجميع كشفه: قيد بلا صفوف ترحيل، أو صفّ بلا قيد.

```ts
/** يُشغَّل شهرياً أو عند طلب المالك. يمسح فترة واحدة فقط لتبقى التكلفة محدودة. */
export async function orphanScan(ctx: DataContext, periodKey: PeriodKey): Promise<OrphanReport>;

export interface OrphanReport {
  periodKey: PeriodKey;
  entriesScanned: number;
  postingsScanned: number;
  /** القيد يعلن عدد سطور لا يطابق عدد صفوف الترحيل الموجودة فعلاً */
  entriesWithWrongPostingCount: { entryId: EntryId; lineCount: number; postingCount: number }[];
  /** صفّ ترحيل معرّفه يشير إلى قيد غير موجود */
  postingsWithMissingEntry: string[];                 // postingId[]
  /** صفّ ترحيل مبلغه لا يطابق مبلغ السطر المقابل في القيد */
  postingsWithAmountMismatch: { postingId: string; postingMinor: Minor; lineMinor: Minor }[];
}
```

**الخوارزمية:** قراءة `journalEntries` حيث `periodKey == pk` (≈170 مستنداً/شهر)، وقراءة `postings`
حيث `periodKey == pk` (≈400 صفّ)، ثم تجميع محلي بـ `Map<entryId, Posting[]>` ومقارنة بـ
`entry.lines` حرفاً بحرف: `lines.length` مقابل عدد الصفوف، وكل `lines[i].amountMinor` مقابل
`debitMinor + creditMinor` للصفّ `${entryId}:${lines[i].lineNo}`.

**لماذا المقارنة بالمبلغ أيضاً؟** `lineCount` وحده يكشف الصفّ المفقود ولا يكشف الصفّ **الخاطئ**.
والمبلغ هو الحقل الذي تعتمد عليه كل التجميعات الخادمية.

**التكلفة: ~570 قراءة لشهر واحد (1.1%).** مسح سنة كاملة = 6,840 قراءة (13.7%) ⇒ يُعرض كإجراء منفصل
بتحذير تكلفة صريح، لا داخل الفحص اليومي.

### 16.4 `reconcileObligation` — ADR-021 كمصدر مستقل

هذا هو الفحص الذي يكشف **الحدث المتوازن بدلتا تشغيلية خاطئة** (19 عيب 7):

```ts
export async function reconcileObligation(
  ctx: DataContext, obligationId: ObligationId,
): Promise<{ storedPaidMinor: Minor; ledgerSettlementMinor: Minor;
             driftMinor: Minor; verdict: 'clean' | 'drift' }> {
  const [obSnap, agg] = await Promise.all([
    getDoc(doc(db, `users/${ctx.uid}/obligations/${obligationId}`)),
    getAggregateFromServer(
      query(collection(db, `users/${ctx.uid}/postings`),
            where('obligationId', '==', obligationId)),     // حقل مسطَّح لا داخل خريطة
      { total: sum('settlementDeltaMinor') },               // ← ADR-021 / I6
    ),
  ]);
  const storedPaidMinor       = (obSnap.data() as Obligation).paidMinor;
  const ledgerSettlementMinor = agg.data().total as Minor;
  const driftMinor            = subMinor(storedPaidMinor, ledgerSettlementMinor);
  return { storedPaidMinor, ledgerSettlementMinor, driftMinor,
           verdict: isZero(driftMinor) ? 'clean' : 'drift' };
}
```

`reconcileDebt` مطابقة حرفياً بـ `where('debtId', '==', debtId)` و`debt.settledMinor` (I7).

**لماذا هذا مصدر مستقل حقاً** — وهو الفرق الجوهري عن `deltaSumMinor` الوهمي المرفوض (القسم 1.3):
`settlementDeltaMinor` يُكتب على **مستند آخر** (`postings`) في **سطر آخر** من خطة الكتابة، ويُقرأ
بـ **مسار آخر** (تجميع خادمي على فهرس، لا قراءة مستند). كتابة ناقصة أو دلتا خاطئة في أحد المسارين
**لا يمكن أن تنتشر** إلى الآخر. أما `deltaSumMinor` فكان يُكتب في نفس عبارة الكتابة من نفس القيمة
المقروءة ⇒ لا يمكن أن يختلف إلا بخطأ كتابة حرفي.

**وفائدة I8:** القاعدة تفرض أن أي صفّ دلتاه ≠ 0 يحمل مرجعاً تشغيلياً **واحداً بالضبط**
(`obligationId` أو `debtId`، لا كليهما ولا لا شيء) ⇒ **لا دلتا تُحتسب مرتين ولا دلتا تضيع** من
التجميع. بلا I8 كان تجميعان مختلفان قد يَعُدّان نفس الصفّ.

**القيد الصادق:** الفحص يكشف **اختلاف** `paidMinor` عن مجموع الدلتا، ولا يكشف أن **الدلتا نفسها**
خاطئة إن كانت خاطئة في الموضعين (الواجهة أرسلت 200.000 بدلاً من 20.000 فذهبت إلى الطرفين).
هذا يكشفه **ثابت ثالث**: `|settlementDeltaMinor|` يجب أن يساوي `amountMinor` للسطر النقدي المقابل
في نفس القيد — يُفرَض في `planOperation` وقت التخطيط لا بعد الكتابة، ويُختبَر في
`unit/plan/obligation-payment / settlement-delta-matches-cash-leg`.

### 16.5 `rebuildProjections` — الإجراء التشغيلي (ADR-015)

**البوابة والمؤشر والمُركِّم في مستند واحد: `maintenance/rebuild`** — بحقول `state` و`runToken`
و`phase` و`periodQueue` و`periodCursor` و`pageCursor` و`grandTotals` و`periodTotals` (القسم 12).
القواعد تقرأ `state` وحده (14.2 `rebuildIdle`).

#### 16.5.1 شريط الإجراء من البداية إلى النهاية

```
المرحلة 0 — بوابة وموافقة (لا تلقائية أبداً)
  0.1  لا اتصال ⇒ ارفض: «إعادة البناء تحتاج اتصالاً» (getAggregateFromServer والاستعلامات الصفحية).
  0.2  maintenance/rebuild.state === 'running' و runToken ليس لي والطابع أحدث من 10 دقائق
       ⇒ REBUILD_TOKEN_LOST: «إعادة بناء تجري على جهاز آخر».
  0.3  runToken لي ⇒ اعرض «استئناف» لا «بدء جديد».
  0.4  بناءان في نفس اليوم (من startedAt التاريخي) ⇒ ارفض بتحذير حصة (15.4 سيناريو 1).
  0.5  **اعرض على المالك قبل أي كتابة:** النطاق · تقدير القراءات والنسبة من الحصة ·
       أن تسجيل العمليات **سيتوقف على كل الأجهزة** · المدة المتوقعة.
       تأكيد صريح مطلوب (§3 «رسائل تأكيد قبل العمليات الحساسة»).
  0.6  اقترح تصدير JSON قبل البدء (ق-1). إن قَبِل، نفّذه أولاً وانتظر نجاحه.
  0.7  خُذ fingerprintBefore = runLedgerHealthCheck()   ← **قبل** إقفال الكتابة
  0.8  الاستحواذ: set maintenance/rebuild { state:'running', runToken, phase:'accumulate', … }
       ⇒ من هذه اللحظة كل كتابة مالية من أي جهاز مرفوضة بـ MAINTENANCE_RUNNING.
  0.9  auditLogs: { action:'rebuildStarted', scope, fingerprintBefore, runToken }

المرحلة 1 — المراكمة (phase = 'accumulate')
  تُنفَّذ بخوارزمية القسم 12: استعلامات صفحية خارج المعاملات + runTransaction واحدة لكل صفحة
  تكتب **مستند المؤشر فقط**. التراكم في grandTotals و periodTotals على نفس المستند
  ⇒ انقطاع الاتصال أو إغلاق المتصفح يفقد **صفحة واحدة على الأكثر**.

المرحلة 2 — الكتابة (phase = 'write') — **قيم مطلقة لا increment**
  2.1  writeBatch بحجم ≤ 100: إحلال مطلق لـ debitTotalMinor/creditTotalMinor/entryCount
       على كل حساب في النطاق. **لا balanceMinor** — الرصيد مشتقّ (I4).
  2.2  إحلال مطلق لـ debitMinor/creditMinor/entryCount على كل accountPeriods في النطاق.
       مستند فترة موجود ولم تُنتجه المراكمة ⇒ **يُحذف** (مسموح أثناء الصيانة فقط، 14.2).
  2.3  obligations: paidMinor = Σ settlementDeltaMinor، ثم
       remainingMinor = totalMinor + extraChargesMinor − paidMinor
       debts: settledMinor = Σ settlementDeltaMinor، ثم
       remainingMinor = principalMinor − settledMinor
  2.4  أي قيمة تخرج عن حدود القواعد (سداد زائد) ⇒ **توقّف فوراً** واكتب تقريراً.
       **لا تقصّ القيمة ولا تُقرّبها** — قيمة خارج الحد دليل على خطأ في الدفتر لا في الإسقاط.

المرحلة 3 — التحقّق والإفراج (phase = 'verify')
  3.1  fingerprintAfter = runLedgerHealthCheck()
  3.2  إن بقي الحكم 'projectionDrift' بعد البناء ⇒ state:'failed' + lastError،
       **والبوابة تبقى مقفلة** ويُعرض للمالك: «الإصلاح لم ينجح. لا تسجّل عمليات.»
  3.3  auditLogs: { action:'rebuildFinished', fingerprintBefore, fingerprintAfter,
                    changedAccounts: [{ accountId, beforeBalanceMinor, afterBalanceMinor }] }
  3.4  state:'done' ثم حذف/تصفير المستند ⇒ تُفتح الكتابة المالية.
  3.5  اعرض تقرير «ما تغيّر».
```

**لماذا القيم المطلقة لا `increment()`؟** `increment()` غير idempotent: إعادة تشغيل بناء متعطّل
تُضاعف الأرقام. الإحلال المطلق idempotent بالتعريف ⇒ **استئناف آمن بلا سجل تنفيذ**، وهو السبب
الذي يجعل القواعد تحتاج فرع استثناء يسمح بـ **نقصان** الإجماليات (14.2).

**لماذا `fingerprintBefore` قبل الإقفال؟** `getAggregateFromServer` قراءة خادمية حرّة لا تمنعها
البوابة، لكن أخذها قبل الإقفال يضمن أنها تمثّل الحالة التي شكا منها المالك، لا حالة تغيّرت
بين الشكوى والإجراء.

**التكلفة لكل نطاق** (بعد 3 سنوات):

| النطاق | قراءات | كتابات |
|---|---|---|
| `allAccounts` | ~14,000 (**28%** من الحصة) | 45 حساب + ~1,620 فترة + ~47 مؤشر + 1 إفراج = **~1,713** (8.6%) |
| `account` واحد | ~2,500 | 1 + ~36 فترة |
| `period` واحد | ~400 | ~45 + ~45 |
| `obligations` | ~900 | ~40 |

#### 16.5.2 كيف يُعرض للمستخدم

| الشاشة | المحتوى |
|---|---|
| **الإعدادات › سلامة البيانات** | بطاقة «حالة الدفتر»: نتيجة آخر فحص وتاريخه وزر «فحص الآن». وزر «إعادة بناء الإسقاطات» **بلون تحذيري** ونص: «إجراء إصلاحي. يوقف تسجيل العمليات على كل أجهزتك. يستهلك ~28% من حصة القراءة اليومية.» |
| **عند كشف انحراف** | شريط ثابت أحمر على لوحة التحكم: «اكتُشف انحراف في الأرصدة بمقدار `1.500 د.ل`. الأرقام المعروضة قد تكون غير دقيقة.» + زر «التفاصيل». **لا يُخفى بزر «فهمت» ولا يزول إلا بفحص نظيف** (§25 بند 15) |
| **أثناء الإجراء** | شاشة حاجبة: المرحلة (`accumulate` / `write` / `verify`) · `periodCursor` و`pagesApplied` · نسبة مئوية · زر «إيقاف مؤقت» (يحفظ المؤشر ويترك `state:'running'`) · تحذير: «لا تسجّل عمليات الآن» |
| **على جهاز آخر أثناء الإجراء** | كل زر تسجيل معطَّل مع نص: «تجري صيانة للبيانات على جهاز آخر. حاول بعد قليل.» — لا رسالة `PERMISSION_DENIED` خامّة |
| **بعد الإجراء** | تقرير «ما تغيّر»: جدول (الحساب · الرصيد قبل · الرصيد بعد · الفرق) + «حفظ نسخة JSON من التقرير» |
| **إن بقي `state:'running'` من جلسة سابقة** | عند بدء التطبيق: «هناك إعادة بناء غير مكتملة بدأت في `…`. الكتابة المالية موقوفة.» خياران: **«استئناف»** أو **«إلغاء الإجراء»** (يكتب `auditLogs: rebuildAborted` ويُفرج عن البوابة ⇒ **الإسقاطات تبقى منحرفة والشريط الأحمر يبقى ظاهراً**) |

#### 16.5.3 ماذا يحدث لو اكتُشف انحراف — شجرة قرار

| الحكم | الفعل الآلي | الفعل البشري | هل تُصلحه إعادة البناء؟ |
|---|---|---|---|
| `offline` | لا شيء. يُعرض «تعذّر الفحص» لا «سليم» | — | — |
| `projectionDrift` (I5) | شريط أحمر + `auditLogs: driftDetected` بالأرقام + تشغيل `reconcileAccount` على كل حساب لتحديد المنحرف | يراجع الحسابات المنحرفة، يصدّر نسخة، ثم يُعيد البناء | **نعم** |
| `unbalancedLedger` (I2/I3) | شريط أحمر بنص **مختلف**: «الدفتر نفسه غير متوازن — إعادة البناء لا تُصلح هذا» + `auditLogs: ledgerUnbalanced` + **تعطيل زر إعادة البناء** | تصدير JSON فوراً · `orphanScan` على الفترات المشتبهة · ثم قيد `adjustment` موثَّق بعد تحديد السبب | **لا — وتعطيلها فعل متعمَّد** |
| انحراف التزام/دين (I6/I7) | شريط على شاشة الكيان + `auditLogs` | `rebuildProjections({kind:'obligations'})` | **نعم** |
| `postingsWithMissingEntry` غير فارغة | تنبيه حرج | **لا تُحذف صفوف الترحيل** — يُكتب قيد `adjustment` بعد المعاينة. الحذف المالي محرَّم | جزئياً |
| `postingsWithAmountMismatch` غير فارغة | تنبيه حرج | يعني أن الصفّ لا يمثّل سطره ⇒ **لا إصلاح آلي ممكن**: القيد والصفّ كلاهما غير قابل للتعديل. العلاج: عكس القيد كاملاً وإعادة تسجيله | **لا** |

**ثلاث قواعد مُلزِمة على كل مسار انحراف:**
1. **لا إصلاح صامت أبداً.** كل تعديل إسقاط يمرّ بموافقة صريحة ويُسجَّل في `auditLogs` بالقيم قبل وبعد.
2. **لا طمس للانحراف.** الشريط الأحمر لا يُخفى، ويزول فقط بفحص نظيف.
3. **التصدير قبل الإصلاح.** الإصلاح الوحيد الذي لا يمكن التراجع عنه هو الذي لم نأخذ نسخة قبله.

---

## 17. الترحيل (Migration)

### 17.1 القاعدة الحاكمة — ADR-019

> **`journalEntries` و`postings` و`entryCorrections` و`auditLogs` لا تُرحَّل أبداً.**
> الترحيل **بطيء عند القراءة** (lazy read-time) وللمستندات **المشتقّة فقط**.

**لماذا:** هذه المجموعات غير قابلة للتعديل بقرار معماري وبقواعد الخادم (14.2). أي ترحيل عليها يعني
إمّا نقض عدم القابلية للتعديل (⇒ انهيار I13 وكل ضمانات التدقيق)، أو مسحاً كاملاً بـ 14,000 قراءة
و14,000 كتابة (⇒ 28% و70% من الحصة لإصدار واحد). **كلاهما مرفوض.**
الثمن المقبول بدلاً عنه: **القارئ يحمل معالجاً لكل إصدار سابق، إلى الأبد.**

| المجموعة | سياسة الترحيل |
|---|---|
| `journalEntries`, `postings`, `entryCorrections`, `auditLogs` | **لا ترحيل.** قارئ متعدد الإصدارات (17.3) |
| `accounts`, `accountPeriods`, `obligations`, `debts`, `budgets`, `financialGoals`, `settings` | ترحيل بطيء عند القراءة + تثبيت عند أول كتابة طبيعية (17.4) |
| `pendingCommands` | **لا ترحيل** — يُفرَّغ قبل كل تحديث إصدار (17.6 بند 3) |
| `maintenance/{taskId}` | **لا ترحيل** — عمره دقائق |

### 17.2 `schemaVersion`

```ts
// domain/migrate/version.ts
export const SCHEMA_VERSION = 1 as const;          // تُرفع يداً بيد مع إضافة معالج ترحيل

/** كل مستند في النظام، بلا استثناء، يحمل هذا الحقل. تفرضه القواعد: baseDocOk() */
export interface Versioned { readonly schemaVersion: number }
```

**ثلاث قواعد على الرقم:**
1. **رقم واحد عالمي**، لا رقم لكل مجموعة. مجموعة لم يتغيّر شكلها تمرّ بمعالج `identity` — وهذا أرخص
   بكثير من تتبّع 12 رقماً متباينة.
2. **لا يُنقص أبداً.** مستند بـ `schemaVersion > SCHEMA_VERSION` = مستند كتبه إصدار **أحدث** من
   التطبيق الحالي (جهاز آخر لم يُحدَّث بعد) ⇒ انظر 17.6 بند 4.
3. القواعد تفرض `schemaVersion is int && >= 1` فقط — **ولا تفرض سقفاً** عن قصد، وإلا لزِم نشر قواعد
   جديدة قبل كل إصدار تطبيق وتعطَّلت الأجهزة القديمة.

### 17.3 القارئ متعدد الإصدارات (للدفتر غير القابل للترحيل)

```ts
// domain/migrate/readers.ts
import type { JournalEntry, Posting } from '../types';

/** يحوّل مستند دفتر بأي schemaVersion إلى شكل v(SCHEMA_VERSION) **في الذاكرة فقط**. */
export function readEntry(raw: Record<string, unknown>): JournalEntry {
  const v = (raw.schemaVersion as number) ?? 0;
  switch (v) {
    case 1:
      return raw as unknown as JournalEntry;
    // عند ترقية المخطط يُضاف معالج، ولا يُحذف أي معالج قديم أبداً:
    // case 1: return upgradeEntry_1_to_2(raw as never);
    default:
      // لا نُسقط الصمت: مستند لا نعرف إصداره يوقف الحساب بدل أن يُنتج رقماً خاطئاً.
      throw new DomainError('UNKNOWN_SCHEMA_VERSION',
        `قيد بإصدار مخطط غير معروف (${v}). حدِّث التطبيق.`);
  }
}

export function readPosting(raw: Record<string, unknown>): Posting { /* نفس النمط */ }
```

**القاعدة الصلبة:** **كل** قراءة لمستند دفتر في الطبقة `data` تمرّ عبر `readEntry` / `readPosting`.
لا يُسلَّم `snapshot.data()` خاماً إلى `domain` إطلاقاً. تُفرَض هذه القاعدة بقاعدة ESLint في 21.4.

### 17.4 الترحيل البطيء للمستندات المشتقّة

```ts
// domain/migrate/migrate.ts
export type Migrator = (d: Record<string, unknown>) => Record<string, unknown>;

/** الخريطة: المفتاح = الإصدار الذي يُرحَّل **منه**. تُقرأ تصاعدياً حتى SCHEMA_VERSION. */
export const MIGRATORS: Readonly<Record<number, Migrator>> = {
  // 1: (d) => ({ ...d, nature: d.nature ?? 'expense', schemaVersion: 2 }),
};

export interface MigrateResult<T> {
  value: T;
  migrated: boolean;        // true ⇒ يجب تثبيته عند أول كتابة طبيعية
  fromVersion: number;
}

export function migrateDoc<T>(raw: Record<string, unknown>): MigrateResult<T> {
  let v = (raw.schemaVersion as number) ?? 0;
  if (v > SCHEMA_VERSION) throw new DomainError('FUTURE_SCHEMA_VERSION', '…');
  let cur = raw, migrated = false;
  while (v < SCHEMA_VERSION) {
    const m = MIGRATORS[v];
    if (!m) throw new DomainError('MISSING_MIGRATOR', `لا معالج ترحيل من الإصدار ${v}.`);
    cur = m(cur); migrated = true; v = cur.schemaVersion as number;
  }
  return { value: cur as T, migrated, fromVersion: (raw.schemaVersion as number) ?? 0 };
}
```

**آلية التثبيت (`write-behind`، لا `write-through`):**

| الحالة | الفعل |
|---|---|
| قراءة للعرض فقط | يُرحَّل في الذاكرة. **لا كتابة.** صفر تكلفة، صفر مخاطرة |
| أول كتابة طبيعية على المستند (دفع التزام، تحديث رصيد) | الشكل المُرحَّل يُكتب كجزء من **نفس** `runTransaction` ⇒ **صفر كتابة إضافية** |
| مستند لم يُكتَب عليه منذ سنوات | يبقى بإصداره القديم إلى الأبد. **هذا مقبول ومقصود** — المعالج موجود |
| أداة اختيارية `migrateAllDerived()` | من الإعدادات، بموافقة: تمسح المشتقّات (≈2,100 مستند) وتكتب المُرحَّل منها. ~2,100 قراءة + حتى 2,100 كتابة (4% و11% من الحصة). **ليست إلزامية أبداً** |

**لماذا `write-behind` لا كتابة فورية عند القراءة؟** الكتابة عند القراءة تحوّل فتح لوحة تحكم واحدة
بعد إصدار جديد إلى ~2,100 كتابة، وتجعل شاشةً للعرض فقط تُعدّل البيانات — سلوك غير متوقَّع ويُفسد
اختبارات القراءة.

### 17.5 كيف يُختبَر الترحيل

ملفات ذهبية (golden fixtures) تحت `tests/fixtures/schema/v{N}/`، مستند واحد حقيقي لكل مجموعة لكل إصدار.
**لا تُحدَّث ملفات إصدار قديم أبداً** — هي سجل تاريخي لا عيّنة اختبار.

| الاختبار | ما يضمنه |
|---|---|
| `migrate/golden-v1-to-current.test.ts` | كل ملف في `v1/` يُرحَّل إلى الشكل المتوقَّع حرفياً (مقارنة deep-equal بملف في `expected/`) |
| `migrate/idempotent.test.ts` | `migrateDoc(migrateDoc(x).value).value === migrateDoc(x).value` لكل الملفات الذهبية |
| `migrate/every-version-has-a-migrator.test.ts` | لكل `v` في `1..SCHEMA_VERSION-1` يوجد `MIGRATORS[v]`، والسلسلة تصل إلى `SCHEMA_VERSION` بلا فجوة |
| `migrate/money-fields-are-integers.test.ts` | **property test:** بعد الترحيل، كل حقل ينتهي بـ `Minor` هو `Number.isInteger` وداخل `MAX_ABS_MINOR` |
| `migrate/reader-rejects-unknown-version.test.ts` | `readEntry({schemaVersion: 99})` يرمي `UNKNOWN_SCHEMA_VERSION`، **ولا يُعيد كائناً ناقصاً** |
| `migrate/ledger-is-never-written.test.ts` | **محاكي:** تشغيل `migrateAllDerived()` كاملاً ثم التأكّد أن عدد كتابات `journalEntries` و`postings` = **0** (ADR-019 كاختبار لا كنيّة) |
| `migrate/derived-migration-rides-natural-write.test.ts` | **محاكي:** مستند `obligations` بإصدار قديم، ثم دفعة واحدة ⇒ كتابة **واحدة** للالتزام تحمل الشكل الجديد (لا كتابتان) |
| `migrate/rules-accept-higher-version.test.ts` | **قواعد:** مستند بـ `schemaVersion: 7` يُقبل من القواعد (17.2 بند 3) |
| `migrate/invariants-hold-after-migration.test.ts` | كل ثابت من I5، I17، I19 يصحّ على ناتج ترحيل كل ملف ذهبي |

### 17.6 التغييرات الكاسرة للتوافق — خمس حالات وإجراء كل منها

جهاز المالك قد يكون هاتفاً بإصدار قديم وحاسوباً بإصدار جديد **في نفس اللحظة**. هذا هو الخطر الحقيقي،
لا الترحيل نفسه.

| # | نوع التغيير | هل كاسر؟ | الإجراء الإلزامي |
|---|---|---|---|
| 1 | **إضافة حقل اختياري** (`attachments`، حقل عرض جديد) | لا | أضف الحقل بقيمة افتراضية في القارئ. **لا ترفع `SCHEMA_VERSION`.** لا تضِفه إلى `shapeIs()` كإلزامي، وأضفه إلى قائمة `optional` في القواعد وانشرها **قبل** إصدار التطبيق |
| 2 | **إعادة تسمية حقل** على مستند مشتقّ | نعم | **ثلاث مراحل إلزامية:** (أ) إصدار يقرأ الاسمين ويكتب الاثنين، و`SCHEMA_VERSION` ترتفع. (ب) انتظار حتى تُحدَّث كل الأجهزة. (ج) إصدار يُسقط الاسم القديم. **تخطّي المرحلة (أ) = بيانات مفقودة على الجهاز القديم** |
| 3 | **تغيير شكل `pendingCommands`** | نعم | الطابور **يُفرَّغ قبل التحديث**: شاشة بدء التطبيق ترفض المتابعة وتطلب ترحيل الأوامر المعلّقة أولاً (يحتاج اتصالاً). أوامر عالقة لا تُفسَّر ⇒ تُعرض للمالك نصّاً خاماً ليُعيد إدخالها يدوياً. **لا تُنفَّذ أوامر بشكل غير مفهوم** |
| 4 | **قراءة مستند بـ `schemaVersion > SCHEMA_VERSION`** | نعم | `FUTURE_SCHEMA_VERSION` ⇒ شاشة حاجبة: «كُتبت بياناتك بإصدار أحدث من هذا التطبيق. حدِّث الصفحة.» + تعطيل كل الكتابة المالية. **الأسوأ المطلق هو تجاهل الحقول المجهولة والكتابة فوقها** — فذلك يمحو بيانات كتبها جهاز أحدث |
| 5 | **تغيير دلالة حقل في الدفتر** (مثال: `settlementDeltaMinor` من موقَّع إلى مطلق) | **محرَّم** | **لا يُفعَل.** الدفتر لا يُرحَّل (ADR-019) ⇒ حقل بدلالتين في نفس المجموعة = كل تجميع خادمي خاطئ، و`sum()` لا تستطيع التمييز. البديل الوحيد: **حقل جديد باسم جديد** + `kind` جديد للقيد + فرع في القارئ على `schemaVersion` |

**قاعدة إصدار موحِّدة:** لا يُنشر إصدار تطبيق يرفع `SCHEMA_VERSION` قبل نشر `firestore.rules`
المتوافقة معه ونجاح `tests/rules/**` عليها. ترتيب النشر: **القواعد والفهارس أولاً، ثم Hosting.**
العكس يُنتج `PERMISSION_DENIED` على كل عملية مالية لدقائق.

---

## 18. القصور المُعلَن صراحةً

> هذا القسم مكتوب للمالك لا للمطوّر. كل بند هنا **قرار واعٍ** لا سهو، وكل بند له ثمن حقيقي.
> العمود «متى يصبح غير مقبول» هو **شرط إعادة فتح القرار** — لا يُعاد فتحه قبل تحقّقه.

### 18.1 جدول القصور

| # | القصور | الأثر الواقعي الملموس | متى يصبح غير مقبول | ما الذي يحلّه |
|---|---|---|---|---|
| 1 | **لا فرض خادمي للثوابت العرضية** (ADR-020) | القواعد تحمي شكل كل مستند وثوابته الداخلية، ولا تحمي: ميزان المراجعة، صحة المُجمَّعات، اكتمال الـ batch، تطابق `postings` مع `lines`. عميل مُعطوب أو متصفّح يُقتل أثناء الـ commit قد يُنتج انحرافاً لا يمنعه الخادم | عند **مستخدم ثانٍ** (زوجة/شريك/محاسب) — فحينها «العميل الوحيد موثوق» تسقط فوراً. أو عند أول انحراف حقيقي غير مُفسَّر | **Blaze + Cloud Functions**: كتابة مالية عبر `httpsCallable` واحدة، والقواعد تمنع الكتابة المباشرة على `journalEntries`/`accounts` من العميل تماماً |
| 2 | **العميل موثوق في الحسابات** | كل اتجاه مدين/دائن، وكل مبلغ سطر، وكل دلتا تشغيلية، تُحسب في متصفّح المالك. خطأ برمجي في `planOperation` يُنتج **قيداً متوازناً وصحيح الشكل ومقبولاً من الخادم ورقمه خاطئ** | عند أول تقرير يُستخدم في قرار حقيقي (قرض، إيجار، زكاة) ويظهر خطؤه | **Blaze**: نفس `planOperation` تُشغَّل على الخادم كمصدر وحيد. حتى ذلك الحين: الحماية **اختبارية** (القسم 20) + `reconcileAccount` |
| 3 | **لا عمل مالي دون اتصال** (ADR-007) | `runTransaction` لا تعمل دون اتصال — تفشل أو تتعلّق. فالمالك في منطقة بلا شبكة **لا يستطيع تسجيل مصروف فوراً**؛ يُحفظ في `pendingCommands` ويظهر بوسم «معلّق» و**لا يدخل أي رصيد ولا تقرير** | إن أصبح الاستخدام الأساسي ميدانياً بلا شبكة (سفر طويل، سوق) فتراكم 20 أمراً معلّقاً يُفقد الثقة بالرصيد المعروض | **لا يحلّه Blaze.** قيد في Firestore SDK نفسه. البديل الحقيقي: دفتر محلي كامل (IndexedDB) بمزامنة ودمج تعارضات — **إعادة بناء للنواة** لا تفعيل ميزة. مرفوض حالياً بوعي |
| 4 | **لا مرفقات ولا صور إيصالات** (ق-1) | حقل `attachmentIds` موجود في المخطط والواجهة معطَّلة بوسم «يتطلب ترقية». لا إثبات سداد مرفق بدفعة دين (§9 يطلبه نصّاً)، ولا صورة فاتورة | عند أول خلاف فعلي على سداد دين يحتاج إثباتاً | **Blaze + Firebase Storage** عبر `StoragePort` الجاهز (ق-1). تفعيل، لا إعادة بناء |
| 5 | **لا إشعارات والتطبيق مغلق** (ق-1) | التنبيهات (التزام يستحق، دين تأخر) تظهر **فقط عند فتح التطبيق**. التزام استحق أمس ولم يُفتح التطبيق = **لا تنبيه**. §17 يطلب مركز تنبيهات، و§8 يطلب تنبيهاً «قبل الاستحقاق وفي يومه وبعد التأخر» — **الثالث يعمل دائماً، والأولان يعتمدان على الفتح** | عند تفويت التزام فعلي بسبب عدم الفتح | **Blaze + FCM خادمي** عبر `PushPort`. الحل الجزئي الحالي: Web Notifications والتطبيق مفتوح + ملخّص «ما فاتك» بارز عند كل فتح |
| 6 | **خطأ الاتجاه (Dr/Cr معكوسان) لا يكشفه أي ثابت** | قيد معكوس الاتجاه **متوازن تماماً** (I1 يمرّ)، وشكله صحيح (القواعد تمرّ)، ومُجمَّعاته متّسقة (I5، I6 تمرّ)، وميزان المراجعة سليم (I4 يمرّ). **يظهر فقط كرقم غريب في تقرير** | هو غير مقبول **الآن** إن كانت تغطية الاختبارات الجدولية ناقصة. لهذا القسم 20 يُلزم باختبار جدولي لكل سطر في جدول القسم 9 | لا شيء يحلّه بنيوياً — **لا ترقية ولا تصميم**. الحماية الوحيدة: اختبار جدولي شامل + مراجعة بصرية لكل سطر. **أصدق بند في هذه الوثيقة** |
| 7 | **الانحراف لا يُكتشف إلا بالفاحص الدوري** | بين كتابة خاطئة وفحص اليوم التالي، كل رقم على كل شاشة قد يكون خاطئاً، والمالك يراه صحيحاً | إن أصبح الفحص اليومي يفشل بصمت (دون اتصال مثلاً) لأسبوع | **Blaze**: `onWrite` trigger يفحص بعد كل كتابة. حالياً: `runLedgerHealthCheck` يومياً (16.2) + وضوح «تعذّر الفحص» لا «سليم» |
| 8 | **لا نسخ احتياطي تلقائي** (ق-1) | النسخة الاحتياطية الوحيدة = **تصدير JSON يدوي** يبدأه المالك. لا تصدير = لا نسخة | هو غير مقبول **الآن** إن لم يُنفَّذ التصدير فعلاً. لذلك ق-1 يُلزم بتذكير دوري داخل التطبيق، والتصدير ميزة مرحلة أولى لا تأجيل | **Blaze + Scheduled Export إلى GCS**. حالياً: تذكير بارز إن مضى > 14 يوماً على آخر تصدير |
| 9 | **لا جدولة خادمية** (ق-1، ADR-013) | المصروفات والالتزامات المتكررة تُولَّد **عند فتح التطبيق** عبر مُشغِّل الاستدراك. غياب شهر ⇒ عند الفتح تُولَّد الدورات الفائتة دفعة واحدة. سقف الاستدراك `maxBackfillDays` يمنع فيضاناً، وما قبله يُعرض قائمة اختيار | إن أصبح التطبيق يُفتح أقل من مرة شهرياً، فـ «الالتزامات القادمة» تفقد معناها | **Blaze + Scheduled Functions** عبر `SchedulerPort`. مفتاح idempotency حتمي (`rec:{id}:{occurrenceKey}`) يجعل التبديل آمناً |
| 10 | **لا بحث نصي خادمي** | البحث في الأوصاف والملاحظات يتم **محلياً على نتائج فترة محمَّلة**. لا بحث «كل الأوقات» عن كلمة | عند تجاوز الدفتر ~10,000 قيد وصيرورة البحث داخل فترة غير كافٍ | خادم بحث (Algolia / Typesense) ⇒ **Blaze**. حالياً: البحث مقيَّد بفترة وموصوف للمستخدم كذلك |
| 11 | **لا تعدد عملات** | الحقل `currency` محفوظ وقيمته `'LYD'` دائماً، وتفرضه القواعد. أي مبلغ بعملة أخرى يُدخَل مُحوَّلاً يدوياً، وسعر التحويل لا يُخزَّن ولا يُعاد تقييمه | عند أول حساب فعلي بعملة أجنبية يحتاج إعادة تقييم | إضافة `currency` فعلي + حسابات فروق تقييم. **تغيير نواة** لا تفعيل: كل ثابت توازن يصبح لكل عملة على حدة |
| 12 | **المنطقة الزمنية ثابتة UTC+2 بلا توقيت صيفي** | `bookedAt` تُحسب بتوقيت ليبيا دائماً. المالك في منطقة أخرى (UTC+5 مثلاً) يسجّل مصروفاً الساعة 1 صباحاً ⇒ يُنسب إلى **اليوم السابق** بتوقيت ليبيا ⇒ وقد ينتقل إلى **شهر سابق** في `periodKey` ليلة 1 الشهر | عند إقامة طويلة خارج ليبيا | إعداد منطقة زمنية صريح. مؤجَّل بوعي: ليبيا بلا توقيت صيفي يجعل `UTC+2` ثابتاً دقيقاً، وإضافة الإعداد تُدخل تعقيداً في `periodKey` بلا حاجة حالية |
| 13 | **فقدان حساب Google = فقدان كل البيانات** (ق-2) | مزوّد وحيد، وقائمة UIDs في القواعد. فقدان الحساب ⇒ لا استعادة من داخل النظام | هو خطر قائم **الآن**. التخفيف المُلزِم: تصدير JSON دوري + 2FA على حساب Google + توثيق إجراء إضافة UID احتياطي | UID احتياطي مُفعَّل في `approvedUids()` (قرار مفتوح — 22 بند م-3) |
| 14 | **تكلفة الرسم السنوي** | رسم «12 شهراً» يقرأ ~144 مستند `accountPeriods` في أول تحميل | إن تجاوزت شجرة الحسابات 40 حساب مصروف/دخل ورقياً | مستند إسقاط شهري مُجمَّع واحد — مؤجَّل لأن 144 قراءة = 0.3% من الحصة |
| 15 | **لا إقفال فترات** | لا يمنع شيء تسجيل قيد بتاريخ قبل سنتين، فيغيّر تقريراً صُدِّر سابقاً | عند استخدام التقارير خارجياً (محاسب، جهة رسمية) | مجموعة `periodLocks` + شرط `!exists(periodLock)` في قاعدة الإنشاء. **بنية جاهزة، قرار مفتوح** (22 بند م-5) |
| 16 | **لا تدقيق على القراءة** | `auditLogs` يسجّل التعديلات المالية فقط. لا سجل لمن قرأ ماذا | عند تعدد المستخدمين فقط | تدقيق القراءة يحتاج خادماً ⇒ **Blaze** |

### 18.2 ما **ليس** قصوراً — وإن بدا كذلك

| ما قد يُظَنّ قصوراً | لماذا ليس كذلك |
|---|---|
| «7–9 كتابات لمصروف واحد كثيرة» | 0.65% من حصة الكتابة اليومية في يوم كثيف (15.3). التكلفة **تعقيد ذهني لا فاتورة**، وهو الثمن المدفوع عن وعي مقابل ميزان المراجعة |
| «لا `debtPayments` ولا `obligationPayments`» | ADR-005: سجل الدفعات **استعلام مفهرس على الدفتر**. مجموعة موازية = مصدر حقيقة ثانٍ ينحرف. الانحراف عن §18 موثَّق ومقصود |
| «الرصيد مخزَّن لا محسوب» | ADR-003: الحساب عند القراءة = 3,000 قراءة لفتح واحد بعد سنتين = 16 فتحة/يوم. مرفوض بالأرقام |
| «`accountPeriods` لا تحفظ رصيد النهاية» | ADR-009: رصيد نهاية مخزَّن = حقل يمكن أن ينحرف عن الحركة التي أنتجته، ولا ثابت يمسكه. الاشتقاق التراكمي صحيح دائماً بالتعريف |
| «الالتزام لا يظهر كمصروف حتى يُدفع» | §12 يطلب فصلاً صريحاً بين الفعلي والتوقعات. التزام إيجار سنوي يرفع «مصروفات الشهر» 9,600 د.ل بلا مال خرج = رقم لا يريده المستخدم ولا يفهمه |
| «التأخير 400–900 مللي ثانية عند الحفظ» | §22 يمنع ادّعاء النجاح قبل تأكيد الكتابة. نعرض «جارٍ الحفظ» حقيقية ونقبل التأخير **معلناً** بدل تحديث متفائل يكذب |

### 18.3 شرط ق-1 المُلزِم على كل بند أعلاه

كل بند يُحلّ بـ Blaze **مبنيّ خلف منفذ مجرَّد الآن**: `StoragePort`, `SchedulerPort`, `PushPort`,
`SearchPort`, `ServerOpsPort`. لكل منفذ تطبيق `Disabled*` يُعيد `{ available: false, reason: 'requiresBlaze' }`
وتطبيق فعلي يُفعَّل بمتغيّر بيئة واحد. **الترقية تفعيل ميزة لا إعادة بناء** — وهذا شرط تصميم في ق-1،
ويُفرَض باختبار `tests/unit/ports/every-port-has-disabled-impl.test.ts`.

---

## 19. معالجة كل عيب قاتل باسمه

> كل سطر: العيب الذي رصده المحكّمون، أين عولج، وكيف — بما في ذلك **ما بقي غير محميّ** بعد المعالجة.

| # | العيب القاتل | ADR | أين عولج | كيف — بالضبط | ما بقي غير محميّ |
|---|---|---|---|---|---|
| 1 | **تناقض `periodKey`**: الوثائق تَعِد بـ «بداية شهر مالي» قابلة للتخصيص، والقيود تحمل `periodKey` مشتقاً من التاريخ. أي تغيير للإعداد يُفسد كل مستند فترة ماضٍ، ولا تعريف واحد لـ «هذا الشهر» | ADR-008 | **14.2** (`periodMatchesDate()` على `journalEntries` و`postings`) · **15.6** (كل فهرس فترة) · **16.5** (المسح يُجمّع على `periodKey` الدفتري) · **20.3** · **20.5** | `periodKey ≡ bookedAt[0:7]` **دائماً**، مفروض من **الخادم** في قاعدة الإنشاء. «بداية الشهر المالي» أُعيد تعريفها **نافذة عرض/تقرير** على نطاق `bookedAt`، في إسقاط منفصل، **لا تمسّ القيود ولا القواعد ولا `accountPeriods`**. تغيير الإعداد يُغيّر عدسة العرض فقط ⇒ **لا مستند يُفسد** | نافذة الشهر المالي، لأنها نطاق `bookedAt`، تقرأ من `postings` لا من `accountPeriods` ⇒ أغلى (~400 قراءة/شهر). مقبول ومعلَن (15.3) |
| 2 | **رصيد النهاية المخزَّن** في مستند الفترة: حقل مشتقّ يُخزَّن بجوار الحركة التي أنتجته، فينحرف عنها بلا أي ثابت يمسكه؛ وتعديل قيد في فترة ماضية يُلزم تحديث **كل** الفترات اللاحقة | ADR-009 | **14.2** (قائمة مفاتيح بيضاء في `shapeIs()` على `accountPeriods`) · **16.5.2/2.2** · **20.3** · **20.5** | `accountPeriods` تحفظ **الحركة فقط**: `debitMinor` و`creditMinor` و`entryCount`. **القواعد ترفض من الخادم** أي مستند يحمل مفتاحاً خارج القائمة — فعودة `openingBalanceMinor`/`closingBalanceMinor` **مستحيلة** لا مجرّد ممنوعة. أرصدة البداية/النهاية **مشتقّة تراكمياً** عند القراءة: مجموع حركات الفترات الأسبق على ذلك الحساب — ولا `openingBalanceMinor` على الحساب أصلاً، لأن الرصيد الافتتاحي **قيد** من نوع `opening` لا حقل | الاشتقاق التراكمي يقرأ كل فترات الحساب حتى الفترة المطلوبة (~36 مستنداً بعد 3 سنوات لحساب واحد). مقبول، وفهرسه في 15.6 |
| 3 | **توليد دورات التكرار من معاملة الدفع**: الدفع يُنشئ الدورة التالية ⇒ (أ) لا دورة بلا دفع فتختفي الالتزامات غير المدفوعة من «القادمة»، (ب) دفعتان جزئيتان تُنشئان دورتين، (ج) المعاملة تحمل مسؤوليتين | ADR-013 | **16** (مُشغِّل الاستدراك) · **20.2** · **20.4** | التوليد **من قالب التكرار عبر مُشغِّل الاستدراك** عند فتح التطبيق، بمفتاح idempotency حتمي `opId = rec:{recurringId}:{occurrenceKey}` ⇒ تعدّد الأجهزة والفتحات لا يُنتج تكراراً لأن `entryId === opId` (ADR-004). معاملة الدفع **لا تُنشئ أي دورة إطلاقاً** — ويُثبَّت ذلك باختبار يعدّ المستندات المكتوبة | لا توليد بلا فتح التطبيق (18 بند 9). و`maxBackfillDays` قيمته قرار مفتوح (22 بند م-1) |
| 4 | **قسط القرض كمصروف**: الالتزامات كلها «مصروف» ⇒ سداد أصل قرض يتضخّم كمصروف، فـ «مصروفات الشهر» تحمل مالاً لم يُستهلك، وهو عين ما تحرّمه القاعدة 19.11 | ADR-011 | **14.2** (`nature` إلزامية عند الإنشاء ولا تتغيّر) · **15.6** (فهرس `nature`) · **20.1** · **20.3** | `ObligationNature = 'expense' \| 'financing'`. الالتزام `expense` يُقيَّد `Dr expense / Cr cash`. الالتزام `financing` يُقيَّد `Dr liability / Cr cash` — **لا حساب مصروف في القيد أصلاً**، فلا يمكن بنيوياً أن يدخل تقرير المصروفات (القسم 1.2 حجة 1). القواعد تفرض `nature` ولا تسمح بتغييرها بعد الإنشاء | القواعد لا تستطيع التحقق أن قيد التزام `financing` لم يمسّ حساب مصروف (يحتاج حلقة على `lines`). يكشفه `20.2 / financing-payment-touches-no-expense-account` + استعلام تسوية على `postings` |
| 5 | **رفع `totalMinor`** لاستيعاب غرامة أو فاتورة متغيّرة: يُفقد المبلغ الأصلي، وتنقلب نسبة الإنجاز أثراً رجعياً، ويصير «المسدَّد بالكامل» غير قابل للتعريف | ADR-012 | **14.2** (`unchanged(['totalMinor', …])`) · **20.3** | `extraChargesMinor` حقل **منفصل** على الالتزام. `remainingMinor = totalMinor + extraChargesMinor − paidMinor`، وسقف السداد الزائد يُحسب على المجموع. القواعد تفرض `totalMinor` **ثابتاً إلى الأبد** من الخادم: محاولة تغييره ترتدّ بـ `PERMISSION_DENIED` | لا سجل تاريخي لتعاقب `extraChargesMinor` (من 0 إلى 50 إلى 75). مَن أراد التتبّع يقرأ `auditLogs`. مقبول |
| 6 | **`deltaSumMinor` الوهمي**: حقل تحقّق مُقترح يُكتب في **نفس** عبارة الكتابة من **نفس** القيمة المقروءة ⇒ لا يمكن أن يختلف عن الرصيد المشتقّ إلا بخطأ كتابة حرفي ⇒ **لا يكشف أي خطأ حسابي ولا أي كتابة ناقصة**، وإنما يمنح طمأنينة زائفة | ADR-021 | **1.3** (رُفض نصّاً) · **14.2** (غير موجود في المخطط) · **16.4** · **20.2** | الحقل **غير موجود** في أي مجموعة. بديله مصدر **مستقل حقاً**: `Σ settlementDeltaMinor` على `postings` — مستند آخر، سطر كتابة آخر، ومسار قراءة آخر (تجميع خادمي على فهرس). كتابة ناقصة في أحد المسارين **لا تنتشر** إلى الآخر | الفحص يكشف **اختلاف** الطرفين لا خطأً حاضراً في الطرفين معاً. يُغطّى بثابت ثالث: `\|settlementDeltaMinor\| === amountMinor` للسطر النقدي المقابل (16.4) |
| 7 | **الحدث المتوازن بدلتا تشغيلية خاطئة**: حدث دفعة التزام بأرجل 20.000 و`paidDeltaMinor: 200000` **متوازن تماماً**، يمرّ من كل ثابت وكل قاعدة، والرقم الخاطئ محفور في حدث غير قابل للتعديل ⇒ إعادة البناء تُعيد إنتاجه والتسوية تُبلّغ انحرافاً **صفر**. أقوى ميزة في سجل الأحداث عاجزة عن حماية أهم كيانات المتطلبات | ADR-002 + ADR-021 | **1.3** (سبب رفض event sourcing) · **16.4** · **20.1** · **20.2** | معالجة من ثلاث طبقات: (أ) الدلتا التشغيلية ليست حقلاً على الحدث بل **على `postings`**، أي على نفس المستند الذي يحمل المبلغ، فتُقارَن به مباشرة؛ (ب) ثابت في `planOperation`: `\|settlementDeltaMinor\| === amountMinor` للسطر النقدي المقابل في نفس القيد — يُرفض البناء وقت التخطيط لا بعد الكتابة؛ (ج) `reconcileObligation` يقارن `paidMinor` بمجموع الدلتا من مسار مستقل. و`reversed` موجود على القيد والـ posting ⇒ العكس يُستبعد من كل تجميع بلا منطق استثناء | إن أخطأت الواجهة في **المبلغ نفسه** (أرسلت 200.000 بدل 20.000) فكل الثوابت تمرّ: الرقم خاطئ **ودلالياً متّسق**. لا يكشفه إلا المستخدم. هذا هو بند 18.2 والقصور رقم 2 |
| 8 | **عيب الأسبقية في القواعد**: (أ) منح `allow write` عام على `{document=**}` يسبق قاعدة مقيِّدة فيُلغيها تماماً لأن القواعد تُجمَع بـ OR؛ (ب) أسبقية `&&` على `\|\|` في شرط `allow create` تُنتج فرعاً **لا يفحص `isOwner` إطلاقاً** ⇒ أي شخص على الإنترنت يكتب في دفتر المالك | — | **14.1** (شرح العيبين) · **14.2** (القواعد المُصلَحة) · **20.3** | (أ) **لا منح عام في الملف إطلاقاً**: كل مجموعة تُعدّ صراحةً، وما لم يُعدّ مرفوض افتراضياً، وكتلة `match /users/{uid}` تطابق مستند المستخدم **وحده** بلا `{document=**}`، وحرّاسة نهائية توثيقية. (ب) كل شرط يبدأ بـ `isOwner(uid) &&` ثم `(` … `)`، وكل `||` داخل شرط **مُغلَّف بأقواس صريحة إلزامياً**. ويُثبَّت كلاهما باختبارات محاكي بهوية غير معتمدة | القواعد لا تُنشر إلا بعد نجاح `tests/rules/**` — وهو شرط إجرائي لا تقني. يُفرَض بمراجعة ما قبل النشر (§25 بند 10) |
| 9 | **القيد اليتيم**: السطور في مجموعة فرعية ⇒ فشل جزئي يُنتج قيداً بلا سطور أو سطراً بلا قيد، وكلاهما يُفسد كل تجميع بصمت | ADR-002 | **14.2** (`postingId = entryId:lineNo` + فحص المبلغين) · **16.3** · **20.2** · **20.4** | السطور **مضمَّنة** في مستند القيد ⇒ القيد وسطوره **ذرّة واحدة لا تنقسم**. و`postings` **مسطَّحة** في نفس المعاملة لتعطي `sum()` الخادمي بلا التنازل عن الذرّية. `postingId` **مشتقّ حتماً** = `${entryId}:${lineNo}` ⇒ إعادة المحاولة تكتب نفس المستندات (idempotent) ولا تُنتج ازدواجاً. و`orphanScan` (16.3) يقارن `entry.lines.length` بعدد صفوف الترحيل الفعلي **وكل مبلغ سطر بمبلغ صفّه** | الـ batch قد يكتب القيد ويُغفل بعض الـ postings (القواعد تُقيّم كل كتابة مستقلة). تحميه ذرّية `runTransaction` في مسار الكتابة الوحيد، ويكشفه `orphanScan` (16.3). ADR-022 لو اعتُمد يضيّق الثقب أكثر |

### 19.1 ملخّص بمن يحمي من

| طبقة الحماية | العيوب التي تحميها بالكامل | العيوب التي تحميها جزئياً |
|---|---|---|
| **قواعد الخادم** (14.2) | 1، 2، 5، 8 | 4، 9 |
| **بنية الدفتر** (قيد مزدوج + `postings` مسطَّحة) | 9 | 4، 6، 7 |
| **مسار الكتابة الوحيد + `runTransaction`** | — | 9 |
| **ثوابت `planOperation`** | 3، 7 (جزء ب) | 6 |
| **الفاحص الدوري** (16) | — | 6، 7، 9 |
| **الاختبارات** (20) | 3، 4 | كلها |

**القراءة الصادقة لهذا الجدول:** العيوب 1 و2 و5 و8 **ميتة بنيوياً** — لا يمكن أن تعود دون تغيير
القواعد المنشورة. العيوب 3 و4 و9 **محكومة بقوة**. العيبان 6 و7 **مخفَّفان لا مقتولان**، وبقاؤهما
هو مضمون القصور 18 بند 2 و6، وحلّهما النهائي **Blaze**.

---

## 20. الاختبارات الإلزامية

### 20.0 البنية والأدوات

```
tests/
├── unit/            Vitest، منطق نقي، صفر شبكة، صفر Firebase.   هدف: < 3 ثوانٍ للمجموعة كلها
├── integration/     @firebase/rules-unit-testing على المحاكي + Firestore SDK حقيقي
├── rules/           @firebase/rules-unit-testing، firestore.rules الحقيقي، لا كود تطبيق
├── concurrency/     المحاكي + كُتّاب متزامنون
├── property/        fast-check، مدمج في Vitest
└── fixtures/
    ├── schema/v1/…           الملفات الذهبية (17.5)
    └── chart-of-accounts.ts  شجرة الحسابات المرجعية للاختبارات
```

| الأمر | ما يُشغَّل | البوابة |
|---|---|---|
| `npm run test:unit` | `tests/unit`, `tests/property` | **كل commit** (pre-commit hook) |
| `npm run test:rules` | `firebase emulators:exec --only firestore "vitest run tests/rules"` | **كل PR** |
| `npm run test:integration` | المحاكي + `tests/integration`, `tests/concurrency` | **كل PR** |
| `npm run test:all` | الكل + تغطية | **قبل كل نشر** |

**بوابات صلبة:** (1) لا يُنشر `firestore.rules` قبل نجاح `test:rules` كاملاً — §25 بند 10.
(2) تغطية `src/domain/**` ≥ 95% سطراً و≥ 90% فرعاً؛ أقل من ذلك **يفشل البناء**.
(3) `src/domain/money/**` تغطية **100%** بلا استثناء.

### 20.1 وحدة — منطق نقي (`tests/unit`)

| الملف | اسم الاختبار الفعلي | ما يضمنه |
|---|---|---|
| `money/split-even.test.ts` | `splitEven distributes remainder to the first buckets` | `[334,333,333]` لـ `(1000,3)` |
| | `splitEven(1,3) returns [1,0,0] not three zeros` | لا ضياع وحدة |
| | `splitEven(0,5) returns five zeros` | الحالة الصفرية |
| | `splitEven keeps the sign of a negative total` | `(-1000,3) → [-334,-333,-333]` |
| `money/allocate-by-weights.test.ts` | `allocateByWeights(1000,[2,1,1]) returns [500,250,250]` | توزيع دقيق |
| | `allocateByWeights(10,[1,1,1]) returns [4,3,3]` | أكبر الباقي |
| | `allocateByWeights breaks fractional ties by lowest index` | حتمية كاملة |
| `money/mul-rate.test.ts` | `mulRate uses BigInt and stays exact at MAX_ABS_MINOR` | `mulRate(1e12, 250)` = الصحيح — **يفشل لو استُخدم `number`** |
| | `mulRate rounds half-up not bankers` | `mulRate(2,5000)===1`, `mulRate(6,2500)===2` |
| | `mulRate rejects a non-integer bps` | حارس النوع |
| `money/parse-amount.test.ts` | `parseAmountToMinor rejects four decimals with TOO_MANY_DECIMALS` | لا تقريب صامت |
| | `parseAmountToMinor accepts arabic-indic digits in input` | لوحة المفاتيح العربية |
| | `parseAmountToMinor never uses floating point` | `"0.07"` → `70` بالضبط |
| | `parseAmountToMinor returns OUT_OF_RANGE above MAX_ABS_MINOR` | الحد |
| `money/format.test.ts` | `formatLYD emits latin digits only` | **ق-3** — لا حرف هندي-عربي في المخرج |
| | `formatLYD always shows three decimals in ledger context` | 3 خانات |
| `money/arithmetic.test.ts` | `addMinor throws above MAX_ABS_MINOR` | `assertInRange` |
| `installments/build-plan.test.ts` | `buildInstallmentPlan sums to the total and loads remainder on the first` | القرار 2.6/1 |
| | `buildInstallmentPlan clamps 31st to end of february` | `clampToEndOfMonth` |
| | `buildInstallmentPlan stores amounts explicitly` | القرار 2.6/2 |
| `period/period-key.test.ts` | `periodKeyOf always equals bookedAt slice 0..7` | **ADR-008 / I7** |
| | `periodKeyOf is unaffected by financialMonthStartDay` | ADR-008: الإعداد عدسة عرض |
| | `todayLibya returns UTC+2 date with no DST shift` | المنطقة ثابتة |
| `plan/expense.test.ts` | `planExpense debits the expense account and credits the cash account` | اتجاه القيد (القصور 6) |
| `plan/income.test.ts` | `planIncome debits the cash account and credits the income account` | اتجاه القيد |
| `plan/transfer.test.ts` | `planTransfer touches two asset accounts and no income or expense account` | **القسم 1.2 حجة 1** |
| `plan/obligation-payment.test.ts` | `planObligationPayment of nature expense debits an expense account` | ADR-011 |
| | `planObligationPayment of nature financing debits a liability account` | **ADR-011** |
| | `planObligationPayment of nature financing touches no expense account` | ADR-011 بنيوياً |
| | `settlement-delta-matches-cash-leg` | **ADR-021 / العيب 7** — `\|settlementDeltaMinor\| === amountMinor` للسطر النقدي |
| `plan/debt-drawdown.test.ts` | `planDebtDrawdown credits a liability account and debits cash, never an income account` | القاعدة 19.11 |
| `plan/reversal.test.ts` | `planReversal flips every side and carries no classification` | القسم 1.2 حجة 2 |
| | `planReversal of a reversal is rejected` | لا سلاسل عكس |
| `plan/amend.test.ts` | `planAmend emits a reversal and a replacement with a net delta` | ADR-006 |
| `plan/balance-guard.test.ts` | `plan is rejected when the resulting balance drops below minBalanceMinor` | **I21** |
| | `a signed minBalanceMinor of -500000 allows an overdraft to exactly that point` | **ADR-010** |
| `plan/earmark-guard.test.ts` | `exceeding earmarkedMinor yields a warning not a rejection` | **ADR-017** |
| | `exceeding the balance yields a rejection not a warning` | ADR-017 |
| `plan/over-settle-guard.test.ts` | `paying more than totalMinor plus extraChargesMinor is rejected` | **I17** |
| `plan/balanced.test.ts` | `every plan in the operations table is balanced` | **I1** جدولياً على كل نوع عملية |
| `plan/line-count.test.ts` | `every plan has at least two lines with positive integer amounts` | **I2** |
| `recurring/catch-up.test.ts` | `planCatchUp produces one deterministic opId per missed occurrence` | **ADR-013** |
| | `planCatchUp caps at maxBackfillDays and reports the rest for manual selection` | حد الاستدراك |
| | `a payment request never produces a catch-up item` | **ADR-013 / العيب 3** |
| `reconcile/judge-account.test.ts` | `judgeAccount reports drift when stored totals differ from the ledger` | I6 |
| `reconcile/judge-ledger.test.ts` | `judgeLedger returns unbalancedLedger not projectionDrift when sums differ` | **16.2** — التمييز بين الحالتين |
| | `judgeLedger never returns clean while offline` | 16.1 الثقب المعلن |
| `ports/every-port-has-disabled-impl.test.ts` | `every Port exposes a Disabled implementation returning requiresBlaze` | **ق-1 / 18.3** |

### 20.2 تكامل — محاكي Firestore (`tests/integration`)

| الملف | اسم الاختبار الفعلي | ما يضمنه |
|---|---|---|
| `post-expense.test.ts` | `posting an expense writes exactly 8 documents` | **15.2 كعقد لا كتقدير** |
| | `posting an expense moves the cash balance by exactly the amount` | الأثر |
| | `posting an expense creates two postings mirroring the entry lines` | I24 |
| | `the written accountPeriods doc holds movement only and no balance keys` | **ADR-009 / I8** |
| `idempotency.test.ts` | `replaying the same opId writes zero documents and reports alreadyApplied` | **ADR-004 / I10** |
| | `the same opId with a different payloadHash is rejected with OP_CONFLICT` | **I11** |
| | `a retried transaction produces the same postingIds` | 19 عيب 9 |
| `transfer.test.ts` | `a transfer leaves the sum of all asset balances unchanged` | القاعدة 19.3 |
| | `a transfer appears in no income or expense report query` | **القسم 1.2 حجة 1** |
| `obligation-payment.test.ts` | `a partial payment updates paidMinor and remainingMinor in the same transaction` | I17 |
| | `the full payment sequence lands on status paid exactly once` | آلة الحالة |
| | `obligation paidMinor equals the sum of settlementDeltaMinor on postings` | **ADR-021 / I20** |
| | `financing-payment-touches-no-expense-account` | **ADR-011 / العيب 4** |
| `obligation-extra-charges.test.ts` | `a late fee raises extraChargesMinor and leaves totalMinor untouched` | **ADR-012 / I18** |
| `debt-settlement.test.ts` | `collecting a receivable raises the cash balance and lowers remainingMinor` | القاعدة 19.5 |
| | `registering a debt with no cash movement leaves every balance unchanged` | §9 |
| `amend.test.ts` | `amending an entry writes a reversal and a replacement atomically` | **ADR-006 / I15** |
| | `amending marks the original reversed on both the entry and its postings` | I14 |
| | `the net effect of an amendment on the balance equals the delta only` | I15 |
| | `a second amendment of the same entry is rejected by the correction lock` | **ADR-014 / I16** |
| `reversal-excluded.test.ts` | `a reversed entry is excluded from every aggregate with no exclusion logic` | القسم 1.2 حجة 2 |
| `trial-balance.test.ts` | `sum of debitTotalMinor equals sum of creditTotalMinor after 200 random operations` | **I4** |
| `fingerprint.test.ts` | `runLedgerHealthCheck returns clean on a healthy ledger` | 16.2 |
| | `a manually corrupted account total is reported as projectionDrift` | 16.2 فحص 2 |
| | `a manually deleted posting is reported as unbalancedLedger` | 16.2 فحص 1 |
| `rebuild.test.ts` | `rebuildProjections restores every corrupted total to the ledger value` | **ADR-015** |
| | `rebuildProjections is idempotent when run twice` | قيم مطلقة لا increment |
| | `rebuildProjections resumes from cursorPostingId after an interruption` | مؤشر الاستئناف |
| | `rebuildProjections deletes an accountPeriods doc that the scan never produced` | 16.5.2/2.2 |
| | `rebuildProjections halts and reports when a value would break an over-settle rule` | لا قصّ قيم |
| `orphan-scan.test.ts` | `orphanScan finds an entry whose lineCount exceeds its posting count` | **I24 / العيب 9** |
| | `orphanScan finds a posting whose entry is missing` | I24 |
| `pending-commands.test.ts` | `a queued command is excluded from every balance and report` | **ADR-007 / I23** |
| | `flushing the queue posts each command exactly once` | ADR-007 |
| | `a financial write while offline lands in pendingCommands and never claims success` | §22 |
| `no-delete.test.ts` | `no code path deletes a journalEntry or a posting` | **I12** |
| `audit-log.test.ts` | `every financial operation appends exactly one auditLog` | §18 بند 9 |
| `query-index-coverage.test.ts` | `every query in the data layer runs without FAILED_PRECONDITION` | **15.4 سيناريو 4** — يمرّ على كل استعلام مُصرَّح |

### 20.3 قواعد أمان (`tests/rules`)

> تُشغَّل على `firestore.rules` الحقيقي بلا أي كود تطبيق. **هذه هي البوابة قبل النشر.**

| الملف | اسم الاختبار الفعلي | العيب/الثابت |
|---|---|---|
| `closed-system.test.ts` | `an unauthenticated request can read nothing` | ق-2 |
| | `a signed-in user with a non-approved uid can read nothing` | **ق-2** |
| | `a non-approved uid cannot create a journalEntry even with a perfect payload` | **العيب 8 ب** — الاختبار الذي كان يفشل |
| | `a non-approved uid cannot write to another uid subtree` | عزل |
| | `an approved uid cannot write outside its own uid subtree` | عزل |
| `no-blanket-grant.test.ts` | `the rules file contains no document wildcard write grant` | **العيب 8 أ** — فحص نصّي على `firestore.rules` يبحث `{document=**}` مع `allow write` |
| | `every allow condition starts with isOwner` | فحص نصّي — قاعدة بناء 14.1/2 |
| | `an undeclared collection is denied by default` | الحرّاسة النهائية |
| `entry-immutable.test.ts` | `updating lines on a posted entry is denied` | **I13** |
| | `updating debitTotalMinor on a posted entry is denied` | I13 |
| | `updating bookedAt or periodKey on a posted entry is denied` | I13 |
| | `deleting a journalEntry is denied` | **I12** |
| | `setting reversed from true back to false is denied` | بوابة أحادية |
| | `reversing an entry of kind reversal is denied` | لا سلاسل عكس |
| `entry-shape.test.ts` | `an unbalanced entry is denied` | **I1 من الخادم** |
| | `an entry with one line is denied` | **I2** |
| | `an entry with a zero or negative line total is denied` | I2 |
| | `an entry whose id differs from opId is denied` | **ADR-004 / I10** |
| | `an entry whose periodKey mismatches bookedAt is denied` | **ADR-008 / I7** |
| | `an entry whose lineCount mismatches lines size is denied` | I24 |
| | `an entry carrying an allowNegative key is denied` | **ADR-010** |
| | `an entry with currency other than LYD is denied` | 2.1 |
| `posting-shape.test.ts` | `a posting whose id is not entryId colon lineNo is denied` | العيب 9 |
| | `a posting with a non-integer amountMinor is denied` | I2 |
| | `updating amountMinor or settlementDeltaMinor on a posting is denied` | I13 |
| `account-rules.test.ts` | `lowering debitTotalMinor outside a rebuild is denied` | 14.3/9 |
| | `an update carrying a stored balanceMinor key is denied` | **I4 / ADR-009** |
| | `totals whose derived balance falls below minBalanceMinor are denied` | **I15، I21 من الخادم** |
| | `the same decreasing write is allowed while maintenance rebuild state is running` | **ADR-015 / I29** |
| | `deleting an account is denied` | الأرشفة لا الحذف |
| | `creating an account with a non-zero total is denied` | التهيئة |
| `account-periods-rules.test.ts` | `an accountPeriods doc carrying closingBalanceMinor is denied` | **ADR-009 / I8** |
| | `an accountPeriods doc carrying openingBalanceMinor is denied` | **ADR-009** |
| | `an accountPeriods id that is not accountId__periodKey is denied` | التماسك |
| `obligation-rules.test.ts` | `raising totalMinor is denied` | **ADR-012 / I18** |
| | `changing nature after create is denied` | **ADR-011** |
| | `creating an obligation without nature is denied` | ADR-011 |
| | `paidMinor above totalMinor plus extraChargesMinor is denied` | **I17** |
| | `a remainingMinor that breaks the equation is denied` | I17 |
| `debt-rules.test.ts` | `settledMinor above principalMinor is denied` | **I19** |
| | `a doc carrying allowOverSettle is denied` | ADR-010 |
| `audit-log-rules.test.ts` | `updating an auditLog is denied for the owner too` | §18 بند 9 |
| | `deleting an auditLog is denied` | عدم التلاعب |
| `correction-lock-rules.test.ts` | `creating entryCorrections twice for the same original is denied` | **ADR-014 / I16** |
| | `updating or deleting a correction lock is denied` | ADR-014 |
| `rebuild-gate.test.ts` | `creating a journalEntry while rebuildJobs active exists is denied` | 16.5 بوابة |
| | `the gate costs no extra read on the normal account update path` | قياس — `\|\|` تقصّر دائرتها |
| `migrate-rules.test.ts` | `a doc with a higher schemaVersion is accepted` | **17.2 بند 3** |

### 20.4 تزامن (`tests/concurrency`)

| الملف | اسم الاختبار الفعلي | ما يضمنه |
|---|---|---|
| `same-op-two-devices.test.ts` | `two devices posting the same opId in parallel produce one entry` | **ADR-004** |
| `two-ops-one-account.test.ts` | `two parallel operations on one account leave the balance exactly correct` | ذرّية `runTransaction` |
| | `fifty parallel operations on one account keep the trial balance intact` | **I4** تحت ضغط |
| `catch-up-two-devices.test.ts` | `two devices opening the app at once generate each occurrence once` | **ADR-013** |
| `amend-race.test.ts` | `two parallel amendments of the same entry leave exactly one correction lock` | **ADR-014 / I16** |
| `rebuild-vs-write.test.ts` | `a financial write launched during a rebuild is rejected not lost` | 16.5 |
| `flush-race.test.ts` | `flushing pendingCommands twice in parallel posts each command once` | ADR-007 |

### 20.5 خاصية — property-based (`tests/property`، `fast-check`)

| الملف | اسم الاختبار الفعلي | الخاصية |
|---|---|---|
| `split-even.property.ts` | `splitEven sums to the total for every x in 0..5000 and n in 1..24` | المجموع = الكل، والفرق بين أكبر وأصغر جزء ≤ 1 |
| `allocate.property.ts` | `allocateByWeights sums to the total over 10000 random cases` | `Σ result === total` |
| `mul-rate.property.ts` | `mulRate matches a BigInt reference for every random pair` | لا فقدان دقة |
| `parse-format.property.ts` | `parseAmountToMinor of formatLYD of x returns x` | **round-trip** |
| `period-key.property.ts` | `periodKeyOf equals the date slice for every date in 1970..2100` | **ADR-008 / I7** |
| `plan-balanced.property.ts` | `every generated operation request yields a balanced plan or a DomainError` | **I1** — لا خطة غير متوازنة أبداً |
| `ledger-replay.property.ts` | `replaying any random operation sequence then rebuilding reproduces the same projections` | **ADR-015 / I5 / I6** |
| `reversal-nets-to-zero.property.ts` | `a random operation followed by its reversal returns every projection to its prior value` | القسم 1.2 حجة 2 |
| `installments.property.ts` | `buildInstallmentPlan sums to the total for every count in 1..120` | 2.6 |
| `invariants-after-sequence.property.ts` | `I1 I2 I4 I5 I6 I9 I17 I19 I20 I21 hold after any random 100-operation sequence` | الفحص الشامل |

### 20.6 ربط الثوابت I1…I30 والحوارس G1…G12 باختباراتها

> نص الثوابت المُلزِم هو **القسم 13**، ونص الحوارس **القسم 11**. الجدول أدناه يعيد صياغة كل ثابت
> باختصار ليُقرأ مستقلاً، ويربطه بموضع فرضه وباختباره بالاسم الفعلي.
> **بوابة CI:** أي ثابت `I1…I30` أو حارس `G1…G12` بلا اختبار يحمل اسمه **يُفشل البناء** —
> الفحص يقرأ الجدول أدناه ويقارنه بقائمة الاختبارات المُجمَّعة.

| الثابت | صياغته المختصرة | أين يُفرَض | الاختبار (الاسم الفعلي) |
|---|---|---|---|
| **I1** | توازن القيد: `debitTotalMinor === creditTotalMinor` وسطران على الأقل | **القواعد** + `invariant` في `planOperation` | `rules/entry-shape / an unbalanced entry is denied` · `unit/plan/balanced` · `property/plan-balanced` |
| **I2** | ميزان المراجعة العام: `Σ debitTotalMinor === Σ creditTotalMinor` على كل الحسابات | الفاحص (16.2 فحص 3) | `integration/trial-balance` · `concurrency/two-ops-one-account / fifty parallel …` |
| **I3** | صافي الترحيلات صفر: `Σ debitMinor === Σ creditMinor` على كل `postings` | الفاحص (16.2 فحص 1) | `integration/fingerprint / a manually deleted posting is reported as unbalancedLedger` |
| **I4** | الرصيد دالّة في الإجماليين حسب `normalSide` — **لا حقل `balanceMinor` مخزَّن** | البنية + **القواعد** (رفض المفتاح) | `rules/account-rules / an update carrying a stored balanceMinor key is denied` · `unit/reconcile/balance-of` |
| **I5** | رصيد كل حساب = مجموع ترحيلاته في الدفتر؛ و`obligation.remainingMinor` = المعادلة | الفاحص (16.1) + **القواعد** (معادلة المتبقي) | `integration/fingerprint / a manually corrupted account total …` · `rules/obligation-rules / a remainingMinor that breaks the equation is denied` |
| **I6** | `obligation.paidMinor === Σ settlementDeltaMinor` (ADR-021) | الفاحص (16.4) | `integration/obligation-payment / obligation paidMinor equals the sum of settlementDeltaMinor on postings` |
| **I7** | `debt.settledMinor === Σ settlementDeltaMinor` | الفاحص (16.4) | `integration/debt-settlement / debt settledMinor equals the sum of settlementDeltaMinor on postings` |
| **I8** | صفّ دلتاه ≠ 0 يحمل مرجعاً تشغيلياً **واحداً بالضبط** | **القواعد** | `rules/posting-shape / a non-zero settlement delta with both obligationId and debtId is denied` · `… with neither is denied` |
| **I9** | لا سداد زائد: `paidMinor ≤ totalMinor + extraChargesMinor`، و`settledMinor ≤ principalMinor` | **القواعد** + الحارس G11 | `rules/obligation-rules / paidMinor above totalMinor plus extraChargesMinor is denied` · `rules/debt-rules / settledMinor above principalMinor is denied` · `unit/plan/over-settle-guard` |
| **I10** | `totalMinor` لا يُرفع أبداً (ADR-012) | **القواعد** | `rules/obligation-rules / raising totalMinor is denied` · `integration/obligation-extra-charges` |
| **I11** | لا قيد بلا ترحيلات ولا ترحيل يتيم: عدد الصفوف = `lines.length`، وكل مبلغ يطابق سطره | البنية (سطور مضمَّنة + معرّف حتمي) + `orphanScan` | `integration/orphan-scan / orphanScan finds an entry whose line count exceeds its posting count` · `… finds a posting whose entry is missing` · `… finds a posting whose amount mismatches its line` |
| **I12** | مجموع الفترات = حركة الحساب الكلية | الفاحص + إعادة البناء | `integration/rebuild / rebuildProjections restores every corrupted total` · `property/invariants-after-sequence` |
| **I13** | `periodKey ≡ bookedAt[0:7]` (ADR-008) | **القواعد** + الحارس G5 | `rules/entry-shape / an entry whose periodKey mismatches bookedAt is denied` · `unit/period/period-key` · `property/period-key` |
| **I14** | العمليات المعلّقة خارج كل رصيد وتقرير (ADR-007) | النطاق + الواجهة | `integration/pending-commands / a queued command is excluded from every balance and report` |
| **I15** | الحجز لا يتجاوز الرصيد — **تحذير لا منع** (ADR-017) | النطاق | `unit/plan/earmark-guard / exceeding earmarkedMinor yields a warning not a rejection` · `… exceeding the balance yields a rejection not a warning` |
| **I16** | مرآة الحجز متوازنة: `Σ accounts.earmarkedMinor` = مجموع المخصَّص للأهداف والالتزامات | الفاحص | `integration/earmark-mirror / the sum of earmarked equals the sum of active earmarks` |
| **I17** | زوج العكس مزدوج ومتكامل: `reversed === true` يقابله قيد `reversalOf` موجود | **القواعد** (بوابة أحادية) + النطاق | `rules/entry-immutable / setting reversed from true back to false is denied` · `integration/amend / … marks the original reversed` |
| **I18** | لا عكس مزدوج، ولا عكس لقيد عكس | **القواعد** + `entryCorrections` | `rules/entry-immutable / reversing an entry of kind reversal is denied` · `concurrency/amend-race` |
| **I19** | التحويل لا يحمل أي سطر على حساب دخل أو مصروف | النطاق + الاختبار الجدولي | `unit/plan/transfer / planTransfer touches two asset accounts and no income or expense account` · `integration/transfer / a transfer appears in no income or expense report query` |
| **I20** | الاقتراض والإقراض لا يغيّران صافي الثروة | النطاق + الاختبار الجدولي | `unit/plan/debt-drawdown / planDebtDrawdown credits a liability account and debits cash, never an income account` · `integration/debt-settlement / registering a debt with no cash movement leaves every balance unchanged` |
| **I21** | كل مبلغ عدد صحيح، ولا `NaN` ولا كسر عائم | **القواعد** (`is int`) + Zod (G3) | `rules/posting-shape / a posting with a non-integer amountMinor is denied` · `property/invariants-after-sequence` · `migrate/money-fields-are-integers` |
| **I22** | كل مبلغ داخل `MAX_ABS_MINOR` | **القواعد** + `assertInRange` | `unit/money/arithmetic / addMinor throws above MAX_ABS_MINOR` · `unit/money/parse-amount / … returns OUT_OF_RANGE above MAX_ABS_MINOR` |
| **I23** | `entryId === opId` (ADR-004) | **القواعد** | `rules/entry-shape / an entry whose id differs from opId is denied` · `integration/idempotency / replaying the same opId writes zero documents` |
| **I24** | `payloadHash` حاسم للتعارض: نفس `opId` بحمولة مختلفة ⇒ `OP_ID_CONFLICT` | النطاق + الحارس G6 | `integration/idempotency / the same opId with a different payloadHash is rejected with OP_ID_CONFLICT` |
| **I25** | لا قيد في فترة مُقفلة | الحارس G9 + **القواعد** (`lockedPeriods` تطول ولا تقصر) | `integration/period-lock / posting into a locked period is rejected with PERIOD_LOCKED` · `rules/settings-rules / shrinking lockedPeriods is denied` |
| **I26** | سلسلة التصحيح متّسقة (ADR-014): `chainLength === chain.length` وتطول ولا تقصر | **القواعد** | `rules/correction-lock-rules / shrinking the correction chain is denied` · `rules/correction-lock-rules / updating or deleting a correction lock is denied` |
| **I27** | `remainingMinor` مشتقّ: أي قراءة تحسبه ولا تثق بالمخزَّن وحده | **القواعد** (المعادلة) + الفاحص | `rules/obligation-rules / a remainingMinor that breaks the equation is denied` · `integration/rebuild / remaining is recomputed from the ledger` — **انظر ملاحظة التعارض أدناه** |
| **I28** | حساب الضبط = مجموع الكيانات: رصيد `acc_liab_debts` = مجموع متبقّي الديون من نوعه | الفاحص | `integration/control-account / the debts control account equals the sum of outstanding debts` |
| **I29** | لا كتابة مالية أثناء الصيانة (ADR-015) | **القواعد** (`rebuildIdle`) + الحارس G2 | `rules/rebuild-gate / creating a journalEntry while maintenance rebuild state is running is denied` · `concurrency/rebuild-vs-write` |
| **I30** | القيد المرحَّل غير قابل للتغيير محاسبياً، و`postings` create-only | **القواعد** | `rules/entry-immutable` (4 اختبارات) · `rules/posting-shape / updating a posting is denied` · `integration/no-delete` |

**الحوارس G1…G12 — اختبار لكل حارس بالاسم:**

| الحارس | رمز الخطأ | الاختبار |
|---|---|---|
| G1 | `AUTH_REQUIRED` / `NOT_OWNER` | `rules/closed-system / a signed-in user with a non-approved uid can read nothing` |
| G2 | `MAINTENANCE_RUNNING` | `integration/rebuild / a financial write during maintenance is rejected with MAINTENANCE_RUNNING` |
| G3 | `AMOUNT_NOT_INTEGER` / `AMOUNT_OUT_OF_RANGE` | `unit/validate/payload-schema` |
| G4 | `BOOKED_AT_FUTURE` | `unit/plan/booked-at-guard / a bookedAt after today in Libya time is rejected` |
| G5 | — (`invariant` ⇒ I13) | `unit/period/period-key` |
| G6 | `OP_ID_CONFLICT` | `integration/idempotency` (اختباران) |
| G7 | `ACCOUNT_NOT_FOUND` / `ACCOUNT_CLOSED` / `ACCOUNT_TYPE_MISMATCH` | `integration/account-guards` (ثلاثة اختبارات) |
| G8 | `BOOKED_AT_BEFORE_OPENING` | `integration/account-guards / posting before the account opening date is rejected` |
| G9 | `PERIOD_LOCKED` | `integration/period-lock` |
| G10 | `BALANCE_BELOW_MIN` | `rules/account-rules / totals whose derived balance falls below minBalanceMinor are denied` · `unit/plan/balance-guard` (اختباران) |
| G11 | `OVERPAYMENT` / `OVERCOLLECTION` | `unit/plan/over-settle-guard` · `rules/obligation-rules` · `rules/debt-rules` |
| G12 | — (`invariant` ⇒ I1) | `unit/plan/balanced` · `property/plan-balanced` |

**أربعة ثوابت لا يحميها إلا الاختبار** (لا قاعدة ولا بنية تمنعها): **I19، I20، I16، I24**.
يُضاف إليها **خطأ اتجاه القيد** الذي لا يحميه أي ثابت على الإطلاق (18.1 بند 6).
انخفاض التغطية عليها ليس «دَيناً تقنياً» بل **ثقب سلامة بيانات مباشر** — ولهذا بوابة التغطية
في 20.0 صلبة وليست توصية.

> **ملاحظة تعارض تُحسم عند الدمج (I27 مقابل القسم 4):**
> القسم 13 يقول «`remainingMinor` مشتق لا مخزَّن»، والقسم 4 يُعرّفه حقلاً **مشتقاً ومخزَّناً** على
> `Obligation` و`Debt`. هذا القسم يتبع القسم 4 (هو مرجع الحقول)، والقواعد في 14.2 **تفرض معادلته
> من الخادم** — وهو ما يجعل التخزين آمناً: حقل مخزَّن بمعادلة مفروضة ليس «مصدر حقيقة ثانياً».
> **المطلوب عند الدمج:** إعادة صياغة I27 إلى «`remainingMinor` مشتقّ مخزَّن ومعادلته مفروضة من
> الخادم؛ **يُحرَّم** الاعتماد عليه كمصدر مستقل في أي فحص سلامة» — أو حذف الحقل من القسم 4.
> **أحد الأمرين، لا الاثنان.**

---

## 21. فرض حدود الطبقات بأداة البناء

### 21.1 لماذا بالأداة لا بالمراجعة — ADR-018

حدود الطبقات في القسم 1.1 (`ui` لا تحسب · `domain` نقية صفر استيراد من `firebase` ومن `data` ·
`data` الوحيدة التي تلمس Firestore) **ليست توصية معمارية بل شرط صحة**: استيراد واحد من `firebase/firestore`
داخل `domain` يُدخل وقت الشبكة إلى منطق نقي، فتصير اختبارات الوحدة غير حتمية، وتصير `planOperation`
غير قابلة للتشغيل على الخادم عند الترقية إلى Blaze (شرط ق-1: «تفعيل ميزة لا إعادة بناء»).
المراجعة البشرية تنسى؛ **أداة البناء لا تنسى.**

### 21.2 الحزم

```jsonc
// package.json — devDependencies
{
  "eslint": "9.12.0",
  "typescript-eslint": "8.8.1",
  "eslint-plugin-boundaries": "5.0.1",
  "eslint-plugin-import": "2.31.0"
}
```

### 21.3 `eslint.config.js` — التهيئة الفعلية

```js
// eslint.config.js  (ESLint flat config)
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import noMinorArithmetic from './tools/eslint-rules/no-minor-arithmetic.js';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { boundaries, import: importPlugin, raseed: { rules: { 'no-minor-arithmetic': noMinorArithmetic } } },

    settings: {
      // كل ملف ينتمي إلى عنصر واحد بالضبط. ترتيب الأنماط مهم: الأخص أولاً.
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/*',       mode: 'folder' },
        { type: 'domain', pattern: 'src/domain/*',       mode: 'folder' },
        { type: 'data',   pattern: 'src/data/*',         mode: 'folder' },
        { type: 'ui',     pattern: 'src/ui/*',           mode: 'folder' },
        { type: 'app',    pattern: 'src/app/*',          mode: 'folder' },
      ],
      'boundaries/include': ['src/**/*.{ts,tsx}'],
      'boundaries/dependency-nodes': ['import', 'dynamic-import', 'require', 'export'],
    },

    rules: {
      // ── (1) كل ملف يجب أن ينتمي إلى عنصر معروف: لا مجلدات يتيمة خارج المعمارية ──
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown': 'error',

      // ── (2) الاستيراد الداخلي بين الطبقات ──
      'boundaries/element-types': ['error', {
        default: 'disallow',
        message: '${file.type} لا يجوز أن يستورد من ${dependency.type} — القسم 1.1 و ADR-018.',
        rules: [
          // shared: نقية تماماً، لا تستورد من أي طبقة
          { from: ['shared'], allow: ['shared'] },

          // domain: نقية 100% — domain + shared فقط. **لا data، ولا ui، ولا app.**
          { from: ['domain'], allow: ['domain', 'shared'],
            message: 'domain نقية: صفر استيراد من data أو ui أو app (القسم 1.1).' },

          // data: تلمس Firestore وتستورد أنواع وخطط domain — ولا تستورد ui أبداً
          { from: ['data'], allow: ['data', 'domain', 'shared'],
            message: 'data لا تستورد ui — الطبقة السفلى لا تعرف الطبقة العليا.' },

          // ui: تنادي execute() وتقرأ selectors من app؛ **لا تلمس data مباشرة**
          { from: ['ui'], allow: ['ui', 'domain', 'shared', 'app'],
            message: 'ui لا تستورد data مباشرة: نادِ execute(req) من app (القسم 1.1).' },

          // app: طبقة التركيب (composition root) — تربط data بـ ui وتُصدّر execute/selectors
          { from: ['app'], allow: ['app', 'ui', 'domain', 'data', 'shared'] },
        ],
      }],

      // ── (3) الاستيراد الخارجي: firebase محصور في data وحدها ──
      'boundaries/external': ['error', {
        default: 'allow',
        rules: [
          { from: ['domain'],
            disallow: ['firebase', 'firebase/*', '@firebase/*', 'firebase-admin', 'firebase-admin/*'],
            message: 'domain نقية: استيراد firebase فيها محرَّم (ADR-018 + شرط ق-1).' },
          { from: ['shared'],
            disallow: ['firebase', 'firebase/*', '@firebase/*', 'react', 'react-dom'],
            message: 'shared لا تعرف firebase ولا react.' },
          { from: ['ui'],
            disallow: ['firebase', 'firebase/*', '@firebase/*'],
            message: 'ui لا تلمس Firestore: كل وصول عبر app ← data.' },
          { from: ['domain'],
            disallow: ['decimal.js', 'big.js', 'currency.js', 'dinero.js'],
            message: 'المال يُمثَّل بـ Minor صحيح و BigInt (القسم 2) — لا مكتبة عشرية.' },
        ],
      }],

      // ── (4) لا استيراد من داخليات عنصر آخر: فقط عبر index.ts المُصدِّر ──
      'boundaries/no-private': ['error', { allowUncles: false }],
      'boundaries/entry-point': ['error', {
        default: 'disallow',
        rules: [
          { target: ['domain', 'data', 'shared', 'app'], allow: 'index.ts' },
          { target: ['ui'], allow: '*' },
        ],
      }],

      // ── (5) لا استيراد دائري، بأي عمق ──
      'import/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true,
                                     allowUnsafeDynamicCyclicDependency: false }],
      'import/no-self-import': 'error',

      // ── (6) حرمة الضرب/القسمة على Minor خارج domain/money (القسم 2.4) ──
      'raseed/no-minor-arithmetic': 'error',
    },
  },

  // ── استثناء واحد ووحيد: domain/money هي بيت حساب المال ──
  {
    files: ['src/domain/money/**/*.ts'],
    rules: { 'raseed/no-minor-arithmetic': 'off' },
  },

  // ── الاختبارات: تستورد كل شيء، والحدود لا تنطبق ──
  {
    files: ['tests/**/*.ts', '**/*.test.ts', '**/*.property.ts'],
    rules: {
      'boundaries/element-types': 'off',
      'boundaries/external': 'off',
      'boundaries/no-private': 'off',
      'boundaries/entry-point': 'off',
    },
  },
);
```

### 21.4 القاعدة المخصَّصة `no-minor-arithmetic`

القسم 2.4 يُحرّم `Math.round(minor * 0.025)` ويُلزم `mulRate` بـ `BigInt`. الحرمة تُفرَض بقاعدة
تستخدم **معلومات النوع** — لا نمطاً نصّياً، لأن `a * b` لا يُقال عنها شيء دون معرفة أن أحد طرفيها `Minor`.

```js
// tools/eslint-rules/no-minor-arithmetic.js
/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'يمنع * و / و % على قيمة من نوع Minor خارج domain/money (القسم 2.4).' },
    schema: [],
    messages: {
      banned:
        'عملية {{op}} على قيمة Minor محرَّمة خارج domain/money: تمرّ عبر عدد عشري عائم وتفقد الدقة. ' +
        'استخدم mulRate / splitEven / allocateByWeights من domain/money.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program) return {};                 // بلا معلومات نوع: لا تُقيَّم
    const checker = services.program.getTypeChecker();

    const isMinor = (node) => {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      if (!tsNode) return false;
      const name = checker.typeToString(checker.getTypeAtLocation(tsNode));
      return /\bMinor\b/.test(name) || /\bBps\b/.test(name);
    };

    const check = (node, op, left, right) => {
      if (!['*', '/', '%'].includes(op)) return;
      if (isMinor(left) || isMinor(right)) {
        context.report({ node, messageId: 'banned', data: { op } });
      }
    };

    return {
      BinaryExpression(node)   { check(node, node.operator, node.left, node.right); },
      AssignmentExpression(node) {
        const op = node.operator.replace('=', '');     // *= /= %=
        check(node, op, node.left, node.right);
      },
    };
  },
};
```

### 21.5 ما تمنعه هذه التهيئة فعلاً — جدول إثبات

| محاولة الاستيراد/الكتابة | القاعدة التي تُوقفها | رسالة الخطأ |
|---|---|---|
| `src/domain/ledger/post.ts` ← `import { doc } from 'firebase/firestore'` | `boundaries/external` | «domain نقية: استيراد firebase فيها محرَّم» |
| `src/domain/ops/expense.ts` ← `import { db } from '../../data/client'` | `boundaries/element-types` | «domain لا يجوز أن تستورد من data» |
| `src/ui/AccountCard.tsx` ← `import { reconcileAccount } from '../data/ledger/reconcile'` | `boundaries/element-types` | «ui لا تستورد data مباشرة: نادِ execute(req) من app» |
| `src/ui/Form.tsx` ← `import { getFirestore } from 'firebase/firestore'` | `boundaries/external` | «ui لا تلمس Firestore» |
| `src/domain/a.ts → b.ts → a.ts` | `import/no-cycle` | دورة استيراد |
| `src/domain/money/x.ts` ← `import Decimal from 'decimal.js'` | `boundaries/external` | «المال يُمثَّل بـ Minor صحيح و BigInt» |
| `src/ui/Zakat.tsx`: `Math.round(balanceMinor * 0.025)` | `raseed/no-minor-arithmetic` | «عملية \* على قيمة Minor محرَّمة» |
| `src/data/x.ts` ← `import Btn from '../ui/Btn'` | `boundaries/element-types` | «data لا تستورد ui» |
| ملف جديد في `src/helpers/` خارج العناصر الخمسة | `boundaries/no-unknown-files` | ملف لا ينتمي إلى أي عنصر |
| `import { migrateDoc } from '../../domain/migrate/migrate'` (تجاوز `index.ts`) | `boundaries/entry-point` + `no-private` | استيراد من داخليات عنصر |

### 21.6 البوابة في CI

```jsonc
// package.json — scripts
{
  "lint":        "eslint . --max-warnings=0",
  "lint:bounds": "eslint src --rule-filter boundaries --max-warnings=0",
  "typecheck":   "tsc --noEmit",
  "verify":      "npm run typecheck && npm run lint && npm run test:all"
}
```

`npm run verify` بوابة إلزامية قبل كل `git push` وكل نشر. `--max-warnings=0` يعني أن **أي** مخالفة
حدود توقف البناء — لا «تحذير يُؤجَّل». هذا معنى ADR-018 حرفياً: الحدود **مفروضة بالبناء لا بالمراجعة**.

---

## 22. ما حُسم وما بقي مفتوحاً

### 22.1 (أ) ما حُسم نهائياً — لا يُعاد فتحه

> أي تغيير في هذا الجدول يحتاج **موافقة مكتوبة جديدة من المالك** وتحديث ADR مقابل.
> إعادة الفتح بلا سبب جديد **مضيعة للوقت**: كل بند هنا حُسم بسيناريو أو برقم، لا برأي.

| # | ما حُسم | المرجع | سبب الإقفال بكلمة واحدة |
|---|---|---|---|
| 1 | الدرهم الليبي وحدة التخزين، أُسّ 3، `number` صحيح، `Minor` موسوم | ADR-001 · 2.1 | ISO 4217 + التحويل غير الفاقد |
| 2 | `BigInt` إلزامي في كل ضرب بنسبة (`mulRate`) | 2.4 | `10^16 > 2^53` |
| 3 | التقريب نصف-لأعلى لا banker's | 2.4 | توقّع المستخدم في الزكاة |
| 4 | أكبر الباقي في كل توزيع، والباقي على **القسط الأول** | 2.5 · 2.6 | مجموع الأجزاء = الكل |
| 5 | قيد مزدوج صارم + سطور مضمَّنة + `postings` مسطَّحة في نفس المعاملة | ADR-002 · 1.2 | ثابت `Σ Dr = Σ Cr` + لا قيد يتيم |
| 6 | الرصيد مُجمَّع مخزَّن يُحدَّث في نفس المعاملة | ADR-003 | 3,000 قراءة للفتحة مرفوضة |
| 7 | `entryId === opId` + `payloadHash` | ADR-004 | منع الازدواج خصيصة في المفتاح |
| 8 | لا `debtPayments` ولا `obligationPayments` — الدفعات استعلام على الدفتر | ADR-005 | مصدر حقيقة واحد |
| 9 | التعديل = عكس + بديل بدلتا صافية؛ **لا حذف مالي أبداً** | ADR-006 · I12 | الأثر التاريخي |
| 10 | لا عمل مالي دون اتصال؛ `pendingCommands` + استبعاد تام من كل رصيد | ADR-007 | `runTransaction` لا تعمل دون اتصال |
| 11 | `periodKey ≡ bookedAt[0:7]` دائماً؛ الشهر المالي **نافذة عرض** | ADR-008 | يحسم تناقضاً قاتلاً |
| 12 | `accountPeriods` حركة فقط؛ لا رصيد بداية/نهاية مخزَّن | ADR-009 | حقل مشتقّ بلا ثابت يمسكه |
| 13 | `minBalanceMinor` موقَّع؛ `allowNegative` محذوف من المخطط نهائياً | ADR-010 | بولياني لا يعبّر عن حدّ |
| 14 | `ObligationNature = 'expense' \| 'financing'` | ADR-011 | قسط القرض ليس مصروفاً |
| 15 | `extraChargesMinor` منفصل؛ `totalMinor` لا يُرفع أبداً | ADR-012 | حفظ المبلغ الأصلي |
| 16 | توليد الدورات من قالب التكرار عبر مُشغِّل الاستدراك، لا من الدفع | ADR-013 | يحسم عيبين |
| 17 | قفل التصحيح مستند `entryCorrections/{originalEntryId}` | ADR-014 | قفل ذرّي لا عدّاد |
| 18 | إعادة البناء إجراء كامل: بوابة في القواعد + مؤشر استئناف + قيم مطلقة | ADR-015 · 16.5 | idempotent بالتعريف |
| 19 | بصمة الدفتر بـ `getAggregateFromServer` عند الطلب — لا مستند عدّاد ساخن | ADR-016 · 16.2 | 14 قراءة لا 14,000 |
| 20 | `earmarkedMinor` مرآة مشتقة؛ تجاوز الحجز **تحذير** وتجاوز الرصيد **منع** | ADR-017 | فرق المعنى |
| 21 | حدود الطبقات مفروضة بأداة البناء لا بالمراجعة | ADR-018 · 21 | المراجعة تنسى |
| 22 | الدفتر لا يُرحَّل أبداً؛ الترحيل بطيء وللمشتقّات فقط | ADR-019 · 17 | عدم القابلية للتعديل |
| 23 | الضمان على Spark = مسار كتابة وحيد + اختبار جدولي + فاحص دوري، **والفرض الخادمي يبدأ عند Blaze** | ADR-020 · 14.4 · 18 | مُعلَن للمالك صريحاً |
| 24 | `Σ settlementDeltaMinor` على `postings` هو المصدر المستقل لصحة `paidMinor`/`settledMinor` | ADR-021 · 16.4 | مسار كتابة وقراءة مستقلان |
| 25 | لا منح `allow write` عام في القواعد؛ كل `\|\|` مُغلَّف بأقواس | 14.1 | عيب الأسبقية |
| 26 | الإغلاق على UIDs معتمدة في القواعد، لا على البريد | ق-2 · 14.2 | UID ثابت والبريد يتغيّر |
| 27 | أرقام لاتينية في كل الشاشات + `tabular-nums` | ق-3 · 2.2 | قرار مالك |
| 28 | دالة تنسيق واحدة `formatLYD`؛ يُحرَّم `toFixed`/`toLocaleString` في الواجهة | 2.2 | «الإجمالي ≠ مجموع الصفوف» |
| 29 | رفض الإدخال الخاطئ صريحاً لا تقريباً صامتاً | 2.2 | §25 بند 15 |
| 30 | كل ما يتطلب Blaze خلف منفذ مجرَّد له تطبيق `Disabled` | ق-1 · 18.3 | الترقية تفعيل لا بناء |
| 31 | التصدير اليدوي JSON ميزة مرحلة أولى لا تأجيل | ق-1 | النسخة الاحتياطية الوحيدة |
| 32 | العملة `'LYD'` فقط، والحقل محفوظ ومفروض من القواعد | 2.1 · 18.1/11 | لا تعدد عملات في الإصدار الأول |

### 22.2 (ب) ما يحتاج قرار المالك

> لكل بند: الخيارات، التوصية، وأثر كل خيار. **صيغة الإجابة المطلوبة: رقم البند + الخيار المختار.**
> كل بند له **افتراضي مُطبَّق** حتى يصل القرار، فلا شيء يتوقف انتظاراً.

| # | السؤال | الخيارات وأثر كل منها | **التوصية** | الافتراضي حتى القرار |
|---|---|---|---|---|
| **م-1** | سقف الاستدراك `maxBackfillDays` للمتكررات | **30:** غياب شهر فأكثر يُنتج قائمة اختيار يدوية — تحكّم أكبر، عمل يدوي أكثر. **120:** غياب 4 أشهر يُولَّد تلقائياً — أقل عملاً، واحتمال 300 قيد صامت بعد غياب طويل. **بلا سقف:** مرفوض (فيضان وتكلفة) | **120**، مع عرض قائمة بما سيُولَّد **قبل** التوليد وزر تأكيد — يجمع التلقائية والتحكّم | 120 + شاشة تأكيد |
| **م-2** | اعتماد **ADR-022** (`getAfter()`) | **نعم:** يُغلق جزئياً ثقب «تحديث رصيد بلا قيد»، +2..4 قراءات/عملية، وخطر فشل عمليات كثيرة الأرجل عند حد 20 استدعاء. **لا:** الثقب يبقى محكوماً بمسار الكتابة الوحيد والفاحص | **أثبته في المحاكي أولاً** (14.5) ثم قرّر. إن فشل صف الحد الأقصى ⇒ **لا** | غير مُعتمد (كما هو في ADR-022) |
| **م-3** | إضافة **UID احتياطي** الآن | **نعم:** يُلغي خطر «فقدان حساب Google = فقدان البيانات» (18.1/13)، ويوسّع سطح الوصول إلى حسابين. **لا:** سطح أصغر، والخطر قائم ومخفَّف بالتصدير فقط | **نعم** — حساب Google ثانٍ للمالك نفسه بـ 2FA، يُضاف إلى `approvedUids()` ولا يُستخدم إلا للاستعادة. الخطر الأكبر هو فقدان كل البيانات | معطَّل (سطر معلَّق في القواعد) |
| **م-4** | **إقفال الفترات** (`periodLocks`) | **الآن:** يمنع تغيير تقرير ماضٍ، ويمنعك أيضاً من تصحيح خطأ قديم بلا فتح القفل. **لاحقاً:** حرية تصحيح كاملة، وتقرير مُصدَّر قد يتغيّر | **لاحقاً** — لمستخدم واحد لا يُصدِّر لجهة رسمية، الإقفال يُضيّق أكثر مما يحمي. البنية جاهزة: شرط واحد في قاعدة الإنشاء | غير مُفعَّل |
| **م-5** | `settings.display.amountDecimals` الافتراضي للبطاقات | **0:** بطاقات أنظف، والمبلغ الكامل في `title` فقط. **2:** مألوف. **3:** مطابق للدفتر ولا تناقض بصري | **0 للبطاقات والمخططات، و3 في كل جدول وتقرير وتصدير** — الدقة حيث تُقرأ الأرقام، والنظافة حيث تُلمَح | 3 (كما في 2.2) |
| **م-6** | **بوابة إعادة البناء في القواعد** (`!rebuildActive` على كل create مالي) | **نعم:** تُغلق نافذة الكتابة المفقودة أثناء البناء، بتكلفة **قراءة واحدة محسوبة لكل عملية مالية** (~15/يوم = 0.03%). **لا:** صفر تكلفة، ونافذة انحراف حقيقية أثناء البناء | **نعم** — 15 قراءة يومياً مقابل إغلاق نافذة فقدان بيانات | مُفعَّل في 14.2 |
| **م-7** | **عدد الحسابات في الشجرة الافتراضية** | شجرة أوسع = تقارير أدقّ وقراءات أكثر للرسم السنوي (15.3). شجرة أضيق = أرخص وأقل تفصيلاً | يُحسم في القسم 3. أثره الوحيد هنا: **كل 10 حسابات مصروف/دخل إضافية = +120 قراءة** في أول تحميل للرسم السنوي | ~45 حساباً (أساس حسابات 15) |
| **م-8** | **تذكير التصدير**: كل كم يوم؟ | **7:** إزعاج أكبر، نسخة أحدث. **14:** توازن. **30:** قد تفقد شهراً كاملاً | **14 يوماً**، وتذكير **بارز غير قابل للإخفاء** بعد 30 يوماً — لأنها النسخة الاحتياطية الوحيدة (ق-1) | 14 يوماً |
| **م-9** | **التصدير الكامل أم التزايدي؟** | **كامل كل مرة:** نسخة مستقلة قابلة للاستعادة وحدها، 44% من حصة القراءة (15.4 سيناريو 2). **تزايدي:** <500 قراءة شهرياً، والاستعادة تحتاج كل الملفات بالترتيب | **تزايدي شهرياً + كامل مرة سنوياً** — مع وسم كل ملف بـ `exportKind` و`baseExportId` ليستحيل خلطهما | تزايدي + كامل سنوي |
| **م-10** | **مصير الأوامر الفاشلة في `pendingCommands`** | **احتفاظ دائم:** لا يضيع شيء، وتتراكم أوامر غير قابلة للتنفيذ. **حذف بعد 30 يوماً:** نظيف، وقد يضيع مصروف لم يُسجَّل | **احتفاظ دائم + شاشة «أوامر لم تُنفَّذ» بشارة عدد** — حذف أمر مالي فاشل بصمت مخالف لروح I12 | احتفاظ دائم |
| **م-11** | **أساس تاريخ الحول في الزكاة** | **هجري:** الصحيح شرعاً. **ميلادي:** أبسط، ويخالف الحول | **هجري للحول، وميلادي لكل ما سواه** — مع عرض التاريخين معاً وتوضيح الطريقة والافتراضات (§15/4: إرشادية لا فتوى) | هجري للحول |
| **م-12** | **إعداد منطقة زمنية صريح** | **الآن:** يحلّ القصور 18.1/12، ويُدخل تعقيداً في `periodKey` بلا حاجة حالية. **لاحقاً:** `UTC+2` ثابت ودقيق لليبيا بلا توقيت صيفي | **لاحقاً** — يُعاد فتحه عند إقامة خارج ليبيا تتجاوز شهراً | `Africa/Tripoli` ثابتة |
| **م-13** | **عتبة الترقية إلى Blaze** | بلا عتبة معلنة، القرار يُؤجَّل إلى ما بعد الضرر | **عتبة مكتوبة تُراجَع ربع سنوياً:** أيٌّ من الثلاثة يُلزم بالترقية — (أ) مستخدم ثانٍ، (ب) الحاجة الفعلية لمرفق إثبات سداد، (ج) انحراف حقيقي غير مُفسَّر | بلا عتبة — **يُطلب حسمها** |

### 22.3 ما يُعتبر خارج نطاق هذه الوثيقة

لتجنّب توقّع خاطئ: هذه الوثيقة عقد **النواة المحاسبية** فقط. التالي يُحسم في وثائق تصميم أخرى
ولا يُعدّ نقصاً فيها — شرط ألّا يخالف أي بند من 22.1:

المفكرة والمهام والتذكيرات (§13، §14) · قسم العبادات (§15) · شكل الشاشات ونظام التصميم (§3) ·
شكل التقارير والمخططات (§16) · مركز التنبيهات (§17) · جهات الاتصال (§10) · شكل ملف التصدير JSON
بالتفصيل · شجرة الحسابات النهائية (القسم 3 من هذه الوثيقة) · PWA والتثبيت.

**شرط واحد على كل وثيقة لاحقة:** لا تكتب في `journalEntries` ولا `postings` ولا `accounts` ولا
`accountPeriods` إلا عبر `execute(req)` من الطبقة `app`. أي وحدة تحتاج أثراً مالياً تطلب **عملية مُسمّاة
جديدة** في القسم 12، ولا تلمس الدفتر بنفسها. هذا الشرط مفروض بأداة البناء (21.3) لا بالثقة.
