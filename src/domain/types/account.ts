import type {
  AccountId,
  ContactId,
  Currency,
  EntryId,
  EpochMs,
  GoalId,
  ISODate,
  Minor,
  ObligationId,
  Side,
} from './primitives'

export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity'

export type AccountStatus = 'active' | 'archived' // لا 'deleted' — الحذف غير موجود (3.7)

/** users/{uid}/accounts/{accountId} */
export interface Account {
  /** = معرّف المستند = الرمز الهرمي. بادئته تساوي `type` دائماً (ثابت I-COA-1). */
  readonly accountId: AccountId
  /** نسخة المخطط. تُقرأ عند القراءة للترحيل البطيء (ADR-019). */
  schemaVersion: number
  /** مالك المستند. مكرَّر عن قصد: تستخدمه القواعد وتستخدمه عملية التصدير/الاستيراد. */
  readonly ownerUid: string

  /** النوع. يحدد `normalSide` وكل سلوك التقارير. لا يتغير بعد الإنشاء أبداً. */
  readonly type: AccountType
  /** الجانب الطبيعي. مخزَّن مع أنه مشتق من `type`، لأن قواعد Firestore لا تستطيع استدعاء دالة. */
  readonly normalSide: Side
  /** الأب في الشجرة. `null` للجذور. يحدد التجميع في لوحة التحكم. */
  readonly parentId: AccountId | null
  /** العمق (0 للجذر). مخزَّن لتفادي حساب الشجرة عند كل رسم للقائمة. */
  readonly depth: number

  /** الاسم المعروض بالعربية. حقل عرض حرّ قابل للتغيير؛ الهوية في `accountId` (3.2). */
  name: string
  /** وصف اختياري يظهر في شاشة إدارة الحسابات. */
  description?: string
  /** أيقونة من مجموعة الأيقونات الموحدة. عرض فقط. */
  icon?: string
  /** رمز لون من نظام التصميم (لا قيمة hex) — ليعمل في الوضعين الفاتح والداكن. */
  colorToken?: string
  /** ترتيب العرض داخل الأب. يُحرِّره المستخدم بالسحب. */
  sortOrder: number

  /** هل يُسجَّل عليه مباشرة؟ `false` = بند تجميعي (3.3). */
  readonly isPostable: boolean
  /** هل يدخل «إجمالي الأموال المتاحة»؟ القاعدة 19.9 تمنعه على المستحقات. */
  readonly isCashLike: boolean
  /** حساب نظام: `type`/`parentId`/`isPostable` مقفلة، والاسم والترتيب مسموحان (3.7). */
  readonly isSystem: boolean
  /** هل يُسمح بأرشفته؟ `false` لحسابات تكتب عليها النواة تلقائياً. */
  readonly isArchivable: boolean

  /** العملة. دائماً 'LYD' في الإصدار الأول؛ موجود حتى لا يكون إضافته ترحيلاً لكل القيود. */
  readonly currency: Currency

  /**
   * أدنى رصيد مسموح، **موقَّع** (ADR-010). `0` = لا سالب. `-500_000` = سحب على المكشوف 500 د.ل.
   * حلّ محلّ `allowNegative` البولياني لأن البولياني لا يعرف «مسموح بسالب حتى حد».
   */
  minBalanceMinor: Minor

  /** المحجوز لأهداف والتزامات: مرآة مشتقة لا مصدر حقيقة (ADR-017، القسم 5.6). */
  earmarkedMinor: Minor

  /** مجموع السطور المدينة مدى العمر. أحد نصفَي مصدر الرصيد. يُزاد بـ increment فقط. */
  debitTotalMinor: Minor
  /** مجموع السطور الدائنة مدى العمر. النصف الثاني. `Σ debit = Σ credit` على كل الشجرة = ميزان المراجعة. */
  creditTotalMinor: Minor
  /** عدد القيود المؤثرة. يكشف «كتابة مفقودة» حين يطابق الرصيد بالمصادفة (الثابت I7). */
  entryCount: number
  /** آخر قيد أثّر عليه. للتشخيص ولعرض «آخر حركة» بلا استعلام. */
  lastPostedEntryId: EntryId | null
  /** تاريخ آخر حركة محاسبية (ISODate لا Timestamp) — يُعرض في قائمة الحسابات. */
  lastPostedAt: ISODate | null

  status: AccountStatus

  /** الجهة المرتبطة — موجود فقط على `asset.receivable.c_*` و`liability.payable.c_*`. */
  readonly linkedContactId?: ContactId
  /** الالتزام المرتبط — على `liability.obligation.*` فقط. */
  readonly linkedObligationId?: ObligationId
  /** الهدف المرتبط — على `equity.earmark.g_*` فقط. */
  readonly linkedGoalId?: GoalId

  /** لحظة الإنشاء (تدقيق). */
  readonly createdAt: EpochMs
  /** لحظة آخر تعديل على حقول الوصف أو الحالة — لا تتغير مع كل قيد (المجاميع لها حقولها). */
  updatedAt: EpochMs
}
