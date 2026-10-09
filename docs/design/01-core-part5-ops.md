## 14. قواعد الأمان الكاملة

### 14.1 عيب الأسبقية — ما هو بالضبط وكيف يُصلح

قواعد Firestore **تُجمَع بـ OR لا بـ AND**. كل قاعدة `allow` تطابق مسار الطلب تُقيَّم، ويُمنح الوصول
إن سمحت **أيُّ واحدة** منها. **لا توجد قاعدة مقيِّدة في Firestore**: القاعدة اللاحقة لا تضيّق قاعدة سابقة
أوسع منها، والقاعدة الأعمق لا تتجاوز قاعدة أعلى منها. هذا يُنتج عيبين مختلفين، كلاهما كان حاضراً في
المسوّدات السابقة، وكلاهما يُلغي الأمان بالكامل.

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
// ✗ خطأ قاتل — المسوّدة القديمة
allow create: if isOwner(uid)
              && request.resource.data.ownerUid == uid
              && entryId == request.resource.data.opId.split('__')[0] ||
                 entryId == request.resource.data.opId
              && entryShapeOk(request.resource.data)
              && !exists(/databases/$(database)/documents/users/$(uid)/periodLocks/$(pk));
```

`&&` تربط أقوى من `||`، فالشرط يُقرأ فعلياً:

```
( isOwner(uid) && ownerUid == uid && entryId == opId.split('__')[0] )
||
( entryId == opId && entryShapeOk(d) && !exists(periodLock) )
```

**الفرع الثاني لا يفحص `isOwner` ولا `ownerUid` إطلاقاً.** أي شخص على الإنترنت، بأي حساب Google،
يستطيع إنشاء قيود في دفتر المالك شرط أن يُسمّي المستند باسم `opId` ويمرّر فحص الشكل. هذا ينسف ق-2 نسفاً
كاملاً، ولا يظهر في أي اختبار «هل يعمل التطبيق؟» لأن التطبيق يسلك دائماً الفرع الأول.

#### الإصلاح المعتمد — ثلاث قواعد بناء إلزامية

1. **لا منح عام أبداً.** لا توجد في `firestore.rules` أي قاعدة `allow write` على `{document=**}`.
   كل مجموعة نواة تُعدّ صراحةً بقواعدها الخاصة، وما لم يُعدّ **مرفوض افتراضياً** (default deny).
2. **كل شرط `allow` يبدأ بـ `isOwner(uid) &&` ثم `(` … `)`.** أي `||` داخل شرط يُغلَّف بأقواس صريحة
   إلزامياً، ويُفحَص وجودها في مراجعة القواعد كبند قائمة تحقق.
3. **قاعدة حرّاسة (sentinel) في نهاية الملف** تُطابق كل ما لم يُعدّ وتُرفض — قيمتها توثيقية وتشغيلية
   (تُجبر أي مجموعة جديدة على المرور بمراجعة أمنية)، لا منطقية، لأن `false` لا يطرح من OR.

### 14.2 `firestore.rules` — كامل وقابل للنشر

> **ملاحظة تشغيل إلزامية (§25 بند 10):** لا يُنشر هذا الملف قبل اجتياز كل اختبارات القسم 20.3 على
> `firebase emulators:exec`. UID المالك يُلتقط من أول تسجيل دخول ثم يُثبَّت في `OWNER_UIDS` ويُنشر.
> **البريد لا يُستخدم في القواعد مطلقاً** — ق-2: البريد يتغيّر، UID ثابت.

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
        // ,'REPLACE_WITH_BACKUP_UID' // UID احتياطي (قرار مفتوح — القسم 22 بند م-3)
      ];
    }

    function isSignedIn() {
      return request.auth != null && request.auth.uid != null;
    }

    // المالك = موقَّع الدخول + UID معتمد + يكتب داخل نطاقه هو.
    // الشروط الثلاثة مجتمعة: أحدها وحده لا يكفي.
    function isOwner(uid) {
      return isSignedIn()
          && request.auth.uid == uid
          && request.auth.uid in approvedUids();
    }

    // MAX_ABS_MINOR = 1_000_000_000_000 (القسم 2.1). موقَّع: الأرصدة قد تكون سالبة (ADR-010).
    function isMoney(v) {
      return v is int && v >= -1000000000000 && v <= 1000000000000;
    }

    // مبلغ سطر/دفعة: عدد صحيح موجب حصراً (الثابت I2).
    function isPosMoney(v) {
      return v is int && v > 0 && v <= 1000000000000;
    }

    function isNonNegMoney(v) {
      return v is int && v >= 0 && v <= 1000000000000;
    }

    // المفاتيح التي تغيّرت في هذا التحديث لا تخرج عن القائمة المسموحة.
    function hasOnly(keys) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys);
    }

    // أيٌّ من هذه المفاتيح لم يتغيّر إطلاقاً. تُستخدم للحقول المحاسبية المحصّنة.
    function unchanged(keys) {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(keys);
    }

    // بوابة مستند جديد: لا مفاتيح مجهولة، وكل المفاتيح الإلزامية حاضرة.
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

    // ADR-015: بوابة إعادة البناء. تُستدعى **بعد** فشل المسار الطبيعي فقط (|| يقصّر دائرته)،
    // فلا تُحمَّل قراءة إضافية على كل عملية مالية عادية.
    function rebuildActive(uid) {
      return exists(/databases/$(database)/documents/users/$(uid)/rebuildJobs/active);
    }

    // ══════════════════════════════════════════════════════════════════
    // 1) مستند المستخدم نفسه — لا يحمل مالاً، ولا ينشر صلاحيته لما تحته
    // ══════════════════════════════════════════════════════════════════
    // هذه الكتلة تطابق مستند users/{uid} **وحده**. لا {document=**}، فلا انتشار.
    match /users/{uid} {
      allow get:    if isOwner(uid);
      allow create: if isOwner(uid) && request.resource.data.uid == uid;
      allow update: if isOwner(uid) && unchanged(['uid', 'createdAt']);
      allow delete: if false;                         // لا حذف حساب من العميل

      // ──────────────────────────────────────────────────────────────
      // 2) journalEntries — القيود. تُنشأ ولا تُمسّ محاسبياً ولا تُحذف.
      // ──────────────────────────────────────────────────────────────
      match /journalEntries/{entryId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && (
               // ADR-004: المعرّف = opId. منع الازدواج خصيصة في المفتاح لا منطق تطبيقي.
               entryId == request.resource.data.opId
            && request.resource.data.entryId == entryId
            && request.resource.data.payloadHash is string
            && request.resource.data.payloadHash.size() == 64
            && request.resource.data.currency == 'LYD'
            && request.resource.data.status == 'posted'        // لا تُنشأ قيود بحالة أخرى
            && request.resource.data.reversed == false         // قيد جديد غير معكوس بحكم التعريف
            && request.resource.data.kind is string
            && periodMatchesDate(request.resource.data)        // ← ADR-008 مفروض من الخادم
            && request.resource.data.lines is list
            && request.resource.data.lines.size() >= 2
            && request.resource.data.lines.size() <= 20
            && request.resource.data.lineCount == request.resource.data.lines.size()
            && isPosMoney(request.resource.data.debitTotalMinor)
            // ← الثابت I1 مفروض من الخادم: Σ Dr = Σ Cr
            && request.resource.data.debitTotalMinor == request.resource.data.creditTotalMinor
            && request.resource.data.accountIds is list
            && request.resource.data.accountIds.size() >= 2
            && request.resource.data.accountIds.size() <= 20
            && request.resource.data.description is string
            && request.resource.data.description.size() > 0
            && request.resource.data.description.size() <= 500
            // ADR-010: لا أثر لـ allowNegative في المخطط. مستند يحمله = مستند من إصدار محظور.
            && !request.resource.data.keys().hasAny(['allowNegative'])
            // ADR-015: لا تُنشأ قيود أثناء إعادة البناء — تُغلق نافذة الكتابة المفقودة.
            && !rebuildActive(uid)
          );

        // التعديل المسموح وحيد الاتجاه: وسم القيد معكوساً، ووصف/وسوم غير محاسبية.
        allow update: if isOwner(uid)
          && hasOnly(['reversed', 'reversedByEntryId', 'replacedByEntryId',
                      'correctionGroupId', 'description', 'tags', 'attachmentIds', 'updatedAt'])
          && unchanged(['entryId', 'opId', 'payloadHash', 'kind', 'status', 'bookedAt',
                        'periodKey', 'lines', 'lineCount', 'accountIds',
                        'debitTotalMinor', 'creditTotalMinor', 'currency',
                        'ownerUid', 'createdAt'])
          // `reversed` بوابة أحادية: false → true فقط. لا «فكّ عكس».
          && (!request.resource.data.reversed || resource.data.reversed == false)
          && (resource.data.reversed == false || request.resource.data.reversed == true)
          // قيد العكس نفسه لا يُعكَس (منعاً لسلاسل العكس اللانهائية)
          && resource.data.kind != 'reversal';

        allow delete: if false;                       // **لا حذف مالي مطلقاً**
      }

      // ──────────────────────────────────────────────────────────────
      // 3) postings — الإسقاط المسطَّح. المعرّف مشتق من القيد ⇒ idempotent.
      // ──────────────────────────────────────────────────────────────
      match /postings/{postingId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && (
               // postingId = `${entryId}__${lineIndex}` — إعادة المحاولة تكتب نفس المستند.
               postingId.split('__')[0] == request.resource.data.entryId
            && request.resource.data.lineIndex is int
            && request.resource.data.lineIndex >= 0
            && postingId == request.resource.data.entryId + '__' + string(request.resource.data.lineIndex)
            && request.resource.data.accountId is string
            && request.resource.data.side in ['debit', 'credit']
            && isPosMoney(request.resource.data.amountMinor)
            && periodMatchesDate(request.resource.data)
            && request.resource.data.reversed == false
            // ADR-021: الدلتا التشغيلية موقَّعة وقد تكون صفراً (قيد لا يسوّي شيئاً).
            && isMoney(request.resource.data.settlementDeltaMinor)
            && !request.resource.data.keys().hasAny(['allowNegative'])
            && !rebuildActive(uid)
          );

        allow update: if isOwner(uid)
          && hasOnly(['reversed', 'reversedByEntryId', 'updatedAt'])
          && unchanged(['entryId', 'lineIndex', 'accountId', 'side', 'amountMinor',
                        'bookedAt', 'periodKey', 'settlementDeltaMinor', 'ownerUid'])
          && (!request.resource.data.reversed || resource.data.reversed == false);

        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 4) accounts — المُجمَّع. الإجماليات تنامٍ محض، والرصيد متماسك معها.
      // ──────────────────────────────────────────────────────────────
      match /accounts/{accountId} {

        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && (
               request.resource.data.type in ['asset', 'liability', 'equity', 'income', 'expense']
            && request.resource.data.currency == 'LYD'
            && request.resource.data.code is string
            && request.resource.data.debitTotalMinor == 0
            && request.resource.data.creditTotalMinor == 0
            && isMoney(request.resource.data.openingBalanceMinor)
            && request.resource.data.balanceMinor == request.resource.data.openingBalanceMinor
            && request.resource.data.earmarkedMinor == 0
            // ADR-010: حدّ موقَّع، افتراضي 0. ولا وجود لـ allowNegative في المخطط.
            && isMoney(request.resource.data.minBalanceMinor)
            && !request.resource.data.keys().hasAny(['allowNegative'])
          );

        allow update: if isOwner(uid)
          && unchanged(['type', 'code', 'currency', 'openingBalanceMinor', 'ownerUid', 'createdAt'])
          && isMoney(request.resource.data.balanceMinor)
          && isNonNegMoney(request.resource.data.debitTotalMinor)
          && isNonNegMoney(request.resource.data.creditTotalMinor)
          && isNonNegMoney(request.resource.data.earmarkedMinor)
          && isMoney(request.resource.data.minBalanceMinor)
          // ثابت داخل المستند تفرضه القواعد فعلاً (I5): الرصيد = الافتتاحي ± الإجماليات
          && request.resource.data.balanceMinor == (
               request.resource.data.type in ['asset', 'expense']
                 ? request.resource.data.openingBalanceMinor
                   + request.resource.data.debitTotalMinor - request.resource.data.creditTotalMinor
                 : request.resource.data.openingBalanceMinor
                   + request.resource.data.creditTotalMinor - request.resource.data.debitTotalMinor
             )
          // حارس الرصيد (I21) — مفروض من الخادم لأن الطرفين في نفس المستند
          && request.resource.data.balanceMinor >= request.resource.data.minBalanceMinor
          && (
               // المسار الطبيعي: الإجماليات لا تنقص أبداً (حتى العكس يضيف سطراً مقابلاً)
               (   request.resource.data.debitTotalMinor  >= resource.data.debitTotalMinor
                && request.resource.data.creditTotalMinor >= resource.data.creditTotalMinor )
               // ADR-015: مسار إعادة البناء بقيم مطلقة — مسموح بالنقصان ببوابة صريحة فقط.
               // `||` تقصّر دائرتها ⇒ exists() لا يُستدعى في المسار الطبيعي ⇒ لا قراءة إضافية.
            || rebuildActive(uid)
          );

        allow delete: if false;                       // الأرشفة بـ status لا الحذف
      }

      // ──────────────────────────────────────────────────────────────
      // 5) accountPeriods — حركة فقط (ADR-009). لا رصيد بداية ولا نهاية.
      //    المعرّف: `${accountId}__${periodKey}`
      // ──────────────────────────────────────────────────────────────
      match /accountPeriods/{apId} {

        allow get, list: if isOwner(uid);

        // قائمة المفاتيح البيضاء هي **الآلية التي تمنع عودة العيب القاتل**:
        // أي مستند يحمل openingBalanceMinor أو closingBalanceMinor يُرفض من الخادم.
        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && shapeIs(['ownerUid', 'schemaVersion', 'accountId', 'periodKey',
                      'debitMinor', 'creditMinor', 'entryCount'],
                     ['updatedAt', 'createdAt'])
          && apId == request.resource.data.accountId + '__' + request.resource.data.periodKey
          && isPeriodKey(request.resource.data.periodKey)
          && isNonNegMoney(request.resource.data.debitMinor)
          && isNonNegMoney(request.resource.data.creditMinor)
          && request.resource.data.entryCount is int
          && request.resource.data.entryCount >= 0;

        allow update: if isOwner(uid)
          && hasOnly(['debitMinor', 'creditMinor', 'entryCount', 'updatedAt'])
          && isNonNegMoney(request.resource.data.debitMinor)
          && isNonNegMoney(request.resource.data.creditMinor)
          && (
               (   request.resource.data.debitMinor  >= resource.data.debitMinor
                && request.resource.data.creditMinor >= resource.data.creditMinor )
            || rebuildActive(uid)
          );

        allow delete: if isOwner(uid) && rebuildActive(uid);   // تنظيف فترة شاذة أثناء البناء فقط
      }

      // ──────────────────────────────────────────────────────────────
      // 6) entryCorrections/{originalEntryId} — قفل تصحيح. مرة واحدة إلى الأبد (ADR-014).
      // ──────────────────────────────────────────────────────────────
      match /entryCorrections/{originalEntryId} {
        allow get, list: if isOwner(uid);
        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && shapeIs(['ownerUid', 'schemaVersion', 'originalEntryId', 'reversalEntryId',
                      'replacementEntryId', 'correctionGroupId', 'reason', 'at'],
                     [])
          && request.resource.data.originalEntryId == originalEntryId
          && request.resource.data.reason is string
          && request.resource.data.reason.size() > 0;
        allow update, delete: if false;               // القفل لا يُفتح ولا يُحدَّث
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
          // ADR-011: قسط القرض ليس مصروفاً — الطبيعة إلزامية عند الإنشاء ولا افتراضي لها.
          && request.resource.data.nature in ['expense', 'financing']
          && isDate(request.resource.data.dueDate);

        allow update: if isOwner(uid)
          // ADR-012: totalMinor **لا يُرفع أبداً**. الزيادة تذهب إلى extraChargesMinor.
          && unchanged(['totalMinor', 'nature', 'ownerUid', 'createdAt'])
          && isNonNegMoney(request.resource.data.extraChargesMinor)
          && isNonNegMoney(request.resource.data.paidMinor)
          // منع السداد الزائد (I17) — مفروض من الخادم
          && request.resource.data.paidMinor <=
             request.resource.data.totalMinor + request.resource.data.extraChargesMinor
          && request.resource.data.remainingMinor ==
             request.resource.data.totalMinor + request.resource.data.extraChargesMinor
             - request.resource.data.paidMinor
          // paidMinor لا ينقص إلا بإلغاء دفعة (عكس) — والعكس يمرّ من نفس المسار بدلتا سالبة،
          // فلا نفرض التنامي هنا؛ نفرض السقف والمعادلة فقط.
          && request.resource.data.status in
             ['upcoming', 'due', 'overdue', 'partiallyPaid', 'paid', 'cancelled'];

        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 8) debts
      // ──────────────────────────────────────────────────────────────
      match /debts/{debtId} {
        allow get, list: if isOwner(uid);

        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && isPosMoney(request.resource.data.principalMinor)
          && request.resource.data.settledMinor == 0
          && request.resource.data.remainingMinor == request.resource.data.principalMinor
          && request.resource.data.direction in ['payable', 'receivable'];

        allow update: if isOwner(uid)
          && unchanged(['principalMinor', 'direction', 'ownerUid', 'createdAt'])
          && isNonNegMoney(request.resource.data.settledMinor)
          && request.resource.data.settledMinor <= request.resource.data.principalMinor
          && request.resource.data.remainingMinor ==
             request.resource.data.principalMinor - request.resource.data.settledMinor
          && !request.resource.data.keys().hasAny(['allowOverSettle']);

        allow delete: if false;
      }

      // ──────────────────────────────────────────────────────────────
      // 9) budgets / financialGoals — توقعات، لا مال فعلي
      // ──────────────────────────────────────────────────────────────
      match /budgets/{budgetId} {
        allow get, list: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && baseDocOk(uid)
          && isNonNegMoney(request.resource.data.limitMinor)
          && isNonNegMoney(request.resource.data.spentMinor)
          && isPeriodKey(request.resource.data.periodKey);
        allow delete: if isOwner(uid);                // الميزانية ليست قيداً مالياً
      }

      match /financialGoals/{goalId} {
        allow get, list: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && baseDocOk(uid)
          && isPosMoney(request.resource.data.targetMinor)
          && isNonNegMoney(request.resource.data.savedMinor)
          && isNonNegMoney(request.resource.data.earmarkedMinor);
        allow delete: if isOwner(uid);
      }

      // ──────────────────────────────────────────────────────────────
      // 10) pendingCommands — طابور محلي (ADR-007). ليس دفتراً ⇒ الحذف مسموح.
      // ──────────────────────────────────────────────────────────────
      match /pendingCommands/{opId} {
        allow get, list: if isOwner(uid);
        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && opId == request.resource.data.opId
          && request.resource.data.status in ['queued', 'inflight', 'failed']
          && request.resource.data.payloadHash is string;
        allow update: if isOwner(uid)
          && unchanged(['opId', 'payloadHash', 'ownerUid', 'createdAt'])
          && request.resource.data.status in ['queued', 'inflight', 'failed'];
        allow delete: if isOwner(uid);                // يُحذف عند نجاح الترحيل
      }

      // ──────────────────────────────────────────────────────────────
      // 11) rebuildJobs — بوابة ADR-015. `active` معرّف محجوز.
      // ──────────────────────────────────────────────────────────────
      match /rebuildJobs/{jobId} {
        allow get, list: if isOwner(uid);
        allow create: if isOwner(uid)
          && baseDocOk(uid)
          && shapeIs(['ownerUid', 'schemaVersion', 'jobId', 'scope', 'startedAt',
                      'cursorPostingId', 'processedCount', 'phase'], ['note'])
          && request.resource.data.phase in ['scanning', 'applying'];
        allow update: if isOwner(uid)
          && hasOnly(['cursorPostingId', 'processedCount', 'phase', 'note']);
        allow delete: if isOwner(uid);                // الحذف = إغلاق البوابة وإنهاء الإجراء
      }

      // ──────────────────────────────────────────────────────────────
      // 12) auditLogs — إلحاق فقط. لا تحديث ولا حذف، للمالك أيضاً.
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
      // 13) settings — إعدادات عرض، لا مال
      // ──────────────────────────────────────────────────────────────
      match /settings/{docId} {
        allow get, list: if isOwner(uid);
        allow create, update: if isOwner(uid) && baseDocOk(uid);
        allow delete: if false;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 14) حرّاسة نهائية — توثيقية وتشغيلية (14.1 قاعدة 3)
    // أي مسار لم يُعدّ أعلاه مرفوض افتراضياً. هذه الكتلة تجعل الرفض **مقصوداً ومرئياً**،
    // وتُجبر أي مجموعة جديدة على المرور بمراجعة أمنية قبل أن تعمل.
    // ══════════════════════════════════════════════════════════════════
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 14.3 ما تفرضه القواعد فعلاً

| # | الثابت المفروض من الخادم | موضع الفرض |
|---|---|---|
| 1 | الإغلاق على UIDs معتمدة (ق-2) | `isOwner()` في كل شرط |
| 2 | `debitTotalMinor === creditTotalMinor` لكل قيد (I1) | `journalEntries` create |
| 3 | `lines.size() >= 2` وكل مبلغ صحيح موجب (I2) | `journalEntries` + `postings` create |
| 4 | `periodKey === bookedAt[0:7]` (ADR-008، I7) | `periodMatchesDate()` على القيود والـ postings |
| 5 | `entryId === opId` (ADR-004، I10) | `journalEntries` create |
| 6 | `postingId === entryId__lineIndex` (I24 جزئياً) | `postings` create |
| 7 | `balanceMinor` متماسك مع الإجماليات والافتتاحي (I5) | `accounts` update — تعبير شرطي على `type` |
| 8 | `balanceMinor >= minBalanceMinor` (I21) | `accounts` update |
| 9 | الإجماليات لا تنقص خارج إعادة البناء | `accounts` + `accountPeriods` update |
| 10 | `accountPeriods` لا تحمل رصيد بداية/نهاية (ADR-009، I8) | قائمة مفاتيح بيضاء في `shapeIs()` |
| 11 | `obligation.totalMinor` لا يتغيّر أبداً (ADR-012، I18) | `obligations` update `unchanged()` |
| 12 | منع السداد الزائد على الالتزام والدين (I17، I19) | `obligations` + `debts` update |
| 13 | `nature` إلزامية ولا تتغيّر (ADR-011) | `obligations` |
| 14 | لا حذف مالي ولا تعديل محاسبي ولا كتابة على `auditLogs` (I12، I13) | `allow delete: if false` + `hasOnly()` |
| 15 | `reversed` بوابة أحادية `false → true` | `journalEntries` + `postings` update |
| 16 | قفل التصحيح يُنشأ مرة واحدة (ADR-014، I16) | `entryCorrections` create-only |
| 17 | اختفاء `allowNegative` و`allowOverSettle` من المخطط (ADR-010) | `hasAny()` نافية |
| 18 | لا كتابة مالية أثناء إعادة البناء | `!rebuildActive(uid)` على create |

### 14.4 ما **لا** تستطيع القواعد فرضه — وما البديل (ADR-020)

لغة القواعد تُقيّم **كل مستند على حدة**، بلا حلقات، وبلا رؤية لبقية مستندات نفس الـ batch
(عدا `getAfter()` — بند 14.5). النتيجة سبعة ثقوب معلنة:

| # | ما لا تستطيعه القاعدة | لماذا | البديل المعتمد (ADR-020) |
|---|---|---|---|
| 1 | **ميزان المراجعة عبر الحسابات**: `Σ debitTotalMinor = Σ creditTotalMinor` على ~45 مستند حساب | ثابت عبر مستندات متعددة؛ القاعدة ترى مستنداً واحداً | فاحص `ledgerFingerprint()` بـ `getAggregateFromServer` (16.2) + الثابت I4 كاختبار |
| 2 | **صحة المُجمَّعات**: أن تكون زيادة `account.debitTotalMinor` مساوية لمجموع سطور القيد المدينة على ذلك الحساب | يتطلب قراءة `lines` والمرور عليها — لا حلقات في اللغة | مسار كتابة وحيد (`postOperation`) + اختبار جدولي لكل نوع عملية (20.2) + `reconcileAccount` (16.1) |
| 3 | **اكتمال الـ batch**: batch يكتب القيد ويُغفل تحديث `accountPeriods` **يُقبَل بالكامل** | كل كتابة تُقيَّم مستقلة | ذرّية `runTransaction` (الطبقة `data` هي الكاتب الوحيد) + `reconcileAccount` يكشف الانحراف لاحقاً |
| 4 | **تطابق `postings` مع `lines`** | مقارنة عبر مستندات + حلقة | `lineCount` على القيد + فاحص `orphanScan` (16.3) على الثابت I24 |
| 5 | **اتجاه القيد محاسبياً** (مدين/دائن معكوسان) | معكوس الاتجاه **متوازن تماماً**؛ لا ثابت رياضي يكشفه | اختبار جدولي لكل سطر في جدول القسم 9 — الحماية **اختبارية لا بنيوية**. قصور معلن (18 بند 6) |
| 6 | **صحة الدلتا التشغيلية**: أن تكون زيادة `obligation.paidMinor` = مبلغ الدفعة في القيد | ثابت عبر مستندين | ADR-021: `Σ settlementDeltaMinor` على `postings` مصدر **مستقل** يُقارَن بـ `paidMinor` في `reconcileObligations` (16.4) |
| 7 | **أن القيد ليس يتيماً**: قيد بلا `postings` | القاعدة لا ترى الكتابات الأخرى | `postings` مسطَّحة في نفس المعاملة + `orphanScan` |

**الخلاصة المعلنة للمالك:** القواعد على Spark تحمي **شكل كل مستند وثوابته الداخلية** وتمنع الحذف
والتعديل المحاسبي والوصول غير المصرَّح. **الثوابت العرضية بين المستندات محمية بمسار كتابة وحيد
واختبارات وفاحص دوري، لا بالخادم.** الفرض الخادمي الحقيقي يحتاج Cloud Functions ⇒ **Blaze** (القسم 18 بند 1).

### 14.5 ADR-022 — `getAfter()` — **مقترح غير معتمد**

**الفكرة:** إلزام أن كل تحديث لرصيد حساب يكون مصحوباً بقيد في **نفس** الـ transaction/batch.
`getAfter()` تقرأ حالة المستند **بعد** الـ commit المقترح، فتستطيع رؤية مستند القيد الذي يُكتب معها.

```javascript
// مقترح — لا يُضاف إلى firestore.rules قبل الإثبات في المحاكي
match /accounts/{accountId} {
  allow update: if isOwner(uid)
    && /* … كل شروط 14.2 … */
    && (
         // كل تحديث رصيد يحمل معرّف القيد المصاحب
         getAfter(/databases/$(database)/documents/users/$(uid)/journalEntries/$(request.resource.data.lastEntryId))
           .data.ownerUid == uid
      && getAfter(/databases/$(database)/documents/users/$(uid)/journalEntries/$(request.resource.data.lastEntryId))
           .data.accountIds.hasAny([accountId])     // القيد يمسّ هذا الحساب فعلاً
      || rebuildActive(uid)
    );
}
```

يتطلب حقلاً جديداً على الحساب: `lastEntryId: string`.

**ما يُضيفه فعلاً:** يُغلق الثقب رقم 3 جزئياً — لم يبقَ ممكناً تحديث رصيد **بلا قيد** ولا بقيد
**لا يمسّ هذا الحساب**. لا يُغلق الثقب رقم 2 (قيمة الزيادة) ولا رقم 5 (الاتجاه).

**مخاطره وتكلفته — سبب عدم الاعتماد قبل الإثبات:**

1. **حدّ استدعاءات الوصول:** 10 لكل طلب مستند واحد، **20 لكل transaction/batch**. مصروف واحد يكتب
   8 مستندات؛ لو حمل كل تحديث حساب وفترة `getAfter` واحداً = 4 استدعاءات → داخل الحد. تعديل
   (عكس + بديل، 12–16 مستنداً) قد يبلغ 8 استدعاءات → ما زال داخل الحد لكن الهامش يضيق.
   **عملية تقسيم مصروف على 6 فئات قد تتجاوز 20 فجأةً** فتفشل العملية بـ `PERMISSION_DENIED` غامض.
2. **التكلفة:** كل `getAfter` قراءة محسوبة. +2 إلى +4 قراءات لكل عملية. بـ 15 عملية/يوم = 60 قراءة
   = 0.12% من الحصة ⇒ **التكلفة ليست العقبة**.
3. **الهشاشة:** يربط صحة الكتابة بحقل `lastEntryId` يكتبه العميل. عميل خاطئ يكتب `lastEntryId` لقيد
   قديم يمسّ نفس الحساب ⇒ **يمرّ**. أي أن الحماية أضعف ممّا تبدو.
4. **تعطيل إعادة البناء:** إعادة البناء تحدّث الحسابات بلا قيد مصاحب ⇒ تحتاج فرع `rebuildActive` —
   وهو ما يفتح بوابة واسعة أثناء البناء. مقايضة صريحة.

**كيف يُثبَت في المحاكي قبل الاعتماد** (ملف `tests/rules/getafter.proposal.test.ts`، لا يُنشر معه الإنتاج):

| الاختبار | المتوقع |
|---|---|
| `accounts.update` منفرد بلا قيد في نفس الـ batch | `PERMISSION_DENIED` |
| `batch { accounts.update + journalEntries.create }` و`lastEntryId` يطابق القيد | **يُقبل** |
| نفس الـ batch لكن `accountIds` في القيد لا تحتوي `accountId` | `PERMISSION_DENIED` |
| كتابتان منفصلتان (قيد أولاً ثم الحساب في طلب ثانٍ) | `PERMISSION_DENIED` ← **هذا هو بيت القصيد** |
| `batch` يمسّ 7 حسابات (14 `getAfter`) + 7 فترات | قياس: هل يُرفض بـ `resource exhausted`؟ **إن رُفض ⇒ المقترح مرفوض** |
| إعادة بناء بوجود `rebuildJobs/active` | **يُقبل** بلا `lastEntryId` صحيح |
| قياس القراءات المحسوبة في 100 عملية | ≤ 400 قراءة إضافية |

**قرار البوابة:** يُعتمد ADR-022 **فقط** إن نجحت الصفوف الستة الأولى **و** لم يفشل صف الحد الأقصى.
إن فشل صف الحد ⇒ يُرفض نهائياً ويُسجَّل سبب الرفض في `docs/adr/ADR-022-*.md`.

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

**قواعد الفوترة التي تحكم كل الأرقام أدناه:**
- كل مستند يُعاد من استعلام = قراءة واحدة. **الاستعلام الفارغ = قراءة واحدة** (الحد الأدنى).
- `count()` / `sum()` / `average()` عبر `getAggregateFromServer` = **قراءة واحدة لكل 1,000 مدخلة فهرس
  ممسوحة**، بحد أدنى 1. هذا سبب ADR-016: بصمة الدفتر على 13,000 posting = **14 قراءة لا 13,000**.
- القراءة من الذاكرة المؤقتة المحلية (`source: 'cache'`) **غير محسوبة**. المستمع (`onSnapshot`)
  يُحسب مرة لكل مستند في اللقطة الأولى، ثم لكل مستند **متغيّر** فقط.
- كل مستند يُكتب = كتابة واحدة. الـ transaction لا تُخفّض العدد.

### 15.2 القراءات/الكتابات لكل عملية

الأرقام أدناه لشجرة حسابات نموذجية: **45 حساباً**، منها ~8 نقدية و~12 مصروف/دخل ورقية.

| العملية | القراءات داخل المعاملة | الكتابات | التفصيل |
|---|---|---|---|
| **مصروف نقدي بسيط** | **6** | **8** | قراءة: `journalEntries/{opId}` (فحص الازدواج) 1 + `accounts` 2 + `accountPeriods` 2 + `rebuildJobs/active` (من القاعدة) 1 — كتابة: `journalEntries` 1 + `postings` 2 + `accounts` 2 + `accountPeriods` 2 + `auditLogs` 1 |
| **دخل مستلم** | 6 | 8 | مطابق للمصروف |
| **تحويل بين حسابين** | 6 | 8 | الطرفان `asset` ⇒ لا حساب دخل/مصروف أصلاً |
| **دفع التزام** | **7** | **9** | +`obligations/{id}` قراءةً وكتابةً |
| **دفع التزام `financing`** | 7 | 9 | نفس العدد، أطراف مختلفة (ADR-011) |
| **تحصيل دين** | 7 | 9 | +`debts/{id}` |
| **مصروف مقسَّم على 3 فئات** | 8 | **12** | 4 سطور ⇒ `postings` 4 + `accounts` 4 + `accountPeriods` 4 |
| **تعديل (عكس + بديل)** | **12** | **16** | قيدان + 4 postings جديدة + وسم 2 postings أصلية + وسم القيد الأصلي + `accounts` 2 + `accountPeriods` 2 + `entryCorrections` 1 + `auditLogs` 1 |
| **إلغاء (عكس فقط)** | 9 | 11 | قيد عكس + 2 postings + وسم الأصل + `accounts` 2 + `accountPeriods` 2 + `entryCorrections` 1 + `auditLogs` 1 |
| **إعادة الضغط على الزر (نفس `opId`)** | **1** | **0** | `journalEntries/{opId}` موجود ⇒ `alreadyApplied` ⇒ خروج فوري |
| **ترحيل أمر معلّق من `pendingCommands`** | 6 | 9 | +حذف مستند الطابور (حذف لا كتابة) |

### 15.3 القراءات لكل فتح لوحة تحكم

| البطاقة/الرسم | المصدر | قراءات (باردة) | قراءات (ساخنة، مع الذاكرة المؤقتة) |
|---|---|---|---|
| إجمالي الأموال المتاحة + شاشة الحسابات | استعلام `accounts` حيث `status == 'active'` | **8** | 0–2 (المتغيّر فقط) |
| الدخل/المصروف/الصافي لهذا الشهر | `accountPeriods` حيث `periodKey == pk` | **20** | 0–4 |
| الالتزامات القادمة والمتأخرة | `obligations` حيث `status in [...]` مرتَّباً بـ `dueDate` بحد 10 | **10** | 0–1 |
| الديون عليّ / لي | `debts` حيث `direction` + `status` بحد 10 لكل اتجاه | **20** | 0–1 |
| نسبة استهلاك الميزانية | `budgets` حيث `periodKey == pk` | **6** | 0–1 |
| الأهداف المالية | `financialGoals` حيث `status == 'active'` | **5** | 0–1 |
| عمليات معلّقة (ADR-007) | `pendingCommands` حيث `status != 'done'` | **1** (فارغ عادةً) | 1 |
| **المجموع الأساسي** | | **70** | **2–10** |
| رسم «اتجاهات الإنفاق 12 شهراً» | `accountPeriods` حيث `accountId in [12 حساب مصروف/دخل]` و`periodKey >= pk-11` | **+144** | 0 بعد أول تحميل |
| **المجموع مع الرسم السنوي** | | **214** | **2–10** |

**الاستهلاك الواقعي اليومي لمستخدم واحد:**

| السلوك | الحساب | النتيجة | % من الحصة |
|---|---|---|---|
| 15 عملية مالية/يوم | 15 × (6 قراءة + 8.5 كتابة) | 90 قراءة + 128 كتابة | **0.18%** قراءة · **0.64%** كتابة |
| 20 فتحة لوحة تحكم (أول واحدة باردة) | 214 + 19 × 8 | 366 قراءة | **0.73%** |
| كشف حركة حساب 3 صفحات × 25 | 75 | 75 قراءة | 0.15% |
| تقرير شهري | `postings` حيث `periodKey == pk` و`!reversed` ≈ 400 posting | 400 قراءة | 0.80% |
| **إجمالي يوم كثيف** | | **~930 قراءة · ~130 كتابة** | **1.9%** · **0.65%** |

**الهامش: ~53 ضعفاً في القراءة و~150 ضعفاً في الكتابة.** التكلفة الكمّية **ليست قيداً**.
القيد الحقيقي على Spark هو **غياب Cloud Functions وStorage** (القسم 18)، لا الحصة.

### 15.4 متى نقترب من الحصة **واقعياً** — أربعة سيناريوهات فقط

| السيناريو | الحساب | الحصة المستهلكة | الحكم والعلاج |
|---|---|---|---|
| **1. إعادة بناء إسقاطات كاملة** بعد 3 سنوات (~6,000 قيد، ~14,000 posting) | مسح 14,000 posting + كتابة 45 حساب + ~1,600 `accountPeriods` | **14,000 قراءة (28%)** + 1,645 كتابة (8%) | **سيناريو حقيقي.** ثلاث عمليات بناء في يوم واحد = 84% ⇒ العلاج: مؤشر استئناف (16.5) + **منع أكثر من بناءين يومياً** بفحص `rebuildJobs` السابقة |
| **2. تصدير JSON كامل** (ق-1، النسخة الاحتياطية الوحيدة) | قراءة كل مستند: 6,000 + 14,000 + 45 + 1,600 + 200 ≈ **21,850 قراءة (44%)** | 44% | **سيناريو حقيقي وشهري.** العلاج: تصدير **تزايدي** بـ `where bookedAt > lastExportAt` ⇒ أقل من 500 قراءة شهرياً بعد النسخة الأولى. النسخة الكاملة مرة واحدة سنوياً |
| **3. تقرير «كل الأوقات» بلا حد** | مسح `postings` كاملاً | 14,000 قراءة (28%) | **منع معماري:** كل استعلام تقرير **ملزَم بـ `periodKey` أو نطاق `bookedAt`**، ومجال «كل الأوقات» يُخدَم من `accountPeriods` المُجمَّعة (1,600 مستند) لا من `postings`. تُفرَض هذه القاعدة في مراجعة الكود للطبقة `data` |
| **4. استعلام بلا فهرس مركَّب** | Firestore يرفضه بـ `FAILED_PRECONDITION` ولا يهدر حصة | 0 | **ليس خطر تكلفة بل خطر إيقاف.** العلاج: كل استعلام في `data` له فهرس في 15.5، واختبار محاكي يمرّ على كل استعلام (20.2) |

**الاستهلاك غير الواقعي (يُستبعد صريحاً):** 2,850 عملية مالية يومياً (= سقف الكتابة) يعني 118 عملية
في الساعة بلا توقف. 233 فتحة لوحة تحكم باردة يومياً. **لا سيناريو شخصي يقاربهما.**

### 15.5 التخزين والنمو

| الكيان | حجم المستند المقدَّر | العدد بعد 3 سنوات | الحجم |
|---|---|---|---|
| `journalEntries` (سطور مضمَّنة) | ~1.2 KB | 6,000 | 7.2 MB |
| `postings` | ~0.45 KB | 14,000 | 6.3 MB |
| `accountPeriods` | ~0.2 KB | 1,620 | 0.3 MB |
| `auditLogs` | ~0.4 KB | 6,500 | 2.6 MB |
| الباقي (`accounts`, `obligations`, `debts`, `budgets`, `financialGoals`) | — | ~400 | 0.3 MB |
| **البيانات** | | | **~17 MB** |
| **الفهارس** (≈ 2.5× بعد الاستثناءات في 15.6) | | | **~43 MB** |
| **الإجمالي** | | | **~60 MB من 1 GiB = 6%** |

بلا استثناءات الفهرسة في 15.6، فهرسة `lines` (مصفوفة خرائط) وحدها تضاعف الحجم وتزيد تكلفة الكتابة
الزمنية؛ **الاستثناءات ليست تحسيناً اختيارياً.**

### 15.6 `firestore.indexes.json`

```jsonc
{
  "indexes": [
    // ── postings: الإسقاط المسطَّح — هو مصدر كل تجميع وكل كشف ──

    // كشف حركة حساب (القسم 5): where accountId == X && reversed == false order by bookedAt desc
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId", "order": "ASCENDING" },
      { "fieldPath": "reversed",  "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    // reconcileAccount + sum(amountMinor) لكل جانب (16.1)
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId",   "order": "ASCENDING" },
      { "fieldPath": "reversed",    "order": "ASCENDING" },
      { "fieldPath": "side",        "order": "ASCENDING" },
      { "fieldPath": "amountMinor", "order": "ASCENDING" } ] },

    // إعادة بناء accountPeriods: where periodKey == pk && reversed == false
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "reversed",  "order": "ASCENDING" },
      { "fieldPath": "accountId", "order": "ASCENDING" },
      { "fieldPath": "side",      "order": "ASCENDING" } ] },

    // تقرير الفئة الشهري
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey",  "order": "ASCENDING" },
      { "fieldPath": "categoryId", "order": "ASCENDING" },
      { "fieldPath": "reversed",   "order": "ASCENDING" },
      { "fieldPath": "bookedAt",   "order": "DESCENDING" } ] },

    // مصاريف المنزل (§11): نفس المصروفات بعدسة scope — لا تكرار قيمة
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "scope",     "order": "ASCENDING" },
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "reversed",  "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    // ADR-005: سجل دفعات الالتزام = استعلام على الدفتر، لا مجموعة موازية
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "refs.obligationId", "order": "ASCENDING" },
      { "fieldPath": "reversed",          "order": "ASCENDING" },
      { "fieldPath": "bookedAt",          "order": "DESCENDING" } ] },

    // ADR-021: Σ settlementDeltaMinor للالتزام — المصدر المستقل لصحة paidMinor
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "refs.obligationId",      "order": "ASCENDING" },
      { "fieldPath": "reversed",               "order": "ASCENDING" },
      { "fieldPath": "settlementDeltaMinor",   "order": "ASCENDING" } ] },

    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "refs.debtId",          "order": "ASCENDING" },
      { "fieldPath": "reversed",             "order": "ASCENDING" },
      { "fieldPath": "settlementDeltaMinor", "order": "ASCENDING" } ] },

    // بصمة الدفتر (ADR-016): sum(amountMinor) حيث reversed == false لكل جانب
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "reversed",    "order": "ASCENDING" },
      { "fieldPath": "side",        "order": "ASCENDING" },
      { "fieldPath": "amountMinor", "order": "ASCENDING" } ] },

    // مؤشر استئناف إعادة البناء (ADR-015): ترتيب كلي مستقر لا يتغيّر بإدخال قيد بتاريخ ماضٍ
    { "collectionGroup": "postings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "entryId",   "order": "ASCENDING" },
      { "fieldPath": "lineIndex", "order": "ASCENDING" } ] },

    // ── journalEntries ──
    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "reversed",  "order": "ASCENDING" },
      { "fieldPath": "bookedAt",  "order": "DESCENDING" } ] },

    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "kind",     "order": "ASCENDING" },
      { "fieldPath": "reversed", "order": "ASCENDING" },
      { "fieldPath": "bookedAt", "order": "DESCENDING" } ] },

    // التصدير التزايدي (15.4 سيناريو 2)
    { "collectionGroup": "journalEntries", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "createdAt", "order": "ASCENDING" },
      { "fieldPath": "__name__",  "order": "ASCENDING" } ] },

    // ── accountPeriods: ADR-009 — الحركة فقط ──
    { "collectionGroup": "accountPeriods", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "periodKey", "order": "ASCENDING" },
      { "fieldPath": "accountId", "order": "ASCENDING" } ] },

    // الرصيد التراكمي المشتق: كل فترات حساب واحد مرتَّبة (ADR-009)
    { "collectionGroup": "accountPeriods", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "accountId", "order": "ASCENDING" },
      { "fieldPath": "periodKey", "order": "ASCENDING" } ] },

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
      { "fieldPath": "direction", "order": "ASCENDING" },
      { "fieldPath": "status",    "order": "ASCENDING" },
      { "fieldPath": "dueDate",   "order": "ASCENDING" } ] },

    // ── auditLogs / pendingCommands ──
    { "collectionGroup": "auditLogs", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "targetEntryId", "order": "ASCENDING" },
      { "fieldPath": "at",            "order": "DESCENDING" } ] },

    { "collectionGroup": "pendingCommands", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status",    "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "ASCENDING" } ] }
  ],

  "fieldOverrides": [
    // `lines` مصفوفة خرائط مضمَّنة: فهرستها الأحادية تُنتج مدخلة لكل حقل في كل سطر
    // ⇒ تضخّم الفهارس وتُبطئ كل كتابة قيد. لا يُستعلم عنها بـ where أبداً (الاستعلام على postings).
    { "collectionGroup": "journalEntries", "fieldPath": "lines",
      "indexes": [] },

    { "collectionGroup": "journalEntries", "fieldPath": "description",
      "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "payloadHash",
      "indexes": [] },
    { "collectionGroup": "journalEntries", "fieldPath": "tags",
      "indexes": [] },

    // accountIds تُستعلم بـ array-contains فقط ⇒ نُبقي ARRAY_CONFIG ونُلغي الترتيبين
    { "collectionGroup": "journalEntries", "fieldPath": "accountIds",
      "indexes": [ { "queryScope": "COLLECTION", "arrayConfig": "CONTAINS" } ] },

    { "collectionGroup": "obligations", "fieldPath": "notes",       "indexes": [] },
    { "collectionGroup": "debts",       "fieldPath": "notes",       "indexes": [] },
    { "collectionGroup": "auditLogs",   "fieldPath": "beforeAfter", "indexes": [] }
  ]
}
```

**البحث النصي** (وصف، ملاحظات، وسوم) يتم **محلياً على النتائج المحمَّلة** في نطاق فترة محدَّدة.
Firestore لا يملك بحثاً نصياً، والبديل (Algolia/Typesense) يحتاج خادماً ⇒ **Blaze**. قصور معلن (18 بند 10).
