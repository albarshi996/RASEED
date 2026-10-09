import type {
  AccountId,
  ContactId,
  DebtId,
  EntryId,
  EpochMs,
  ISODate,
  Minor,
  ObligationId,
} from './primitives'

/** ADR-011: قسط القرض ليس مصروفاً. هذا الحقل وحده يمنع تضخيم تقرير المصروفات. */
export type ObligationNature = 'expense' | 'financing'

export type ObligationStatus = 'upcoming' | 'due' | 'overdue' | 'partiallyPaid' | 'paid' | 'cancelled'

export interface Installment {
  readonly index: number // 1-based، ثابت إلى الأبد
  readonly dueDate: ISODate
  /** من `splitEven` ويُخزَّن صريحاً (القسم 2.6) — لا يُعاد حسابه عند القراءة أبداً. */
  readonly amountMinor: Minor
  paidMinor: Minor
  status: ObligationStatus
}

export type Recurrence = {
  readonly frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
  readonly anchorDate: ISODate // نقطة بدء التوليد
  readonly dayOfMonthPolicy: 'clampToEndOfMonth' | 'exact'
  readonly until: ISODate | null
  /** آخر دورة ولّدها مُشغِّل الاستدراك. مفتاح عدم التكرار الحتمي (ADR-013). */
  lastGeneratedOccurrenceKey: string | null
}

/** users/{uid}/obligations/{obligationId} — القسم 8 من المتطلبات. */
export interface Obligation {
  readonly obligationId: ObligationId
  schemaVersion: number
  readonly ownerUid: string

  name: string // «إيجار المنزل»
  payeeContactId?: ContactId
  /** حساب المصروف الذي يُحمَّل عليه الدفع. `null` إلزاماً عند `nature === 'financing'`. */
  categoryId: AccountId | null
  /** ADR-011. `'financing'` ⇒ الدفع يخصم خصماً ولا يلمس أي حساب مصروف. */
  readonly nature: ObligationNature
  /** هل للالتزام حساب خصم مستقل؟ `false` = نقدي بحت ولا يلمس الدفتر قبل الدفع (19.4). */
  readonly accrualEnabled: boolean
  /** `liability.obligation.{id}` — موجود فقط عند `accrualEnabled`. */
  readonly liabilityAccountId: AccountId | null

  /** القيمة الإجمالية الأصلية. **لا تُرفع أبداً** (ADR-012). */
  totalMinor: Minor
  /** الغرامات والرسوم الإضافية، منفصلة عن الأصل (ADR-012) ⇒ تاريخ الالتزام يبقى صادقاً. */
  extraChargesMinor: Minor
  /** المسدَّد. يُحدَّث في نفس معاملة الدفع، ويُتحقَّق منه بـ `Σ settlementDeltaMinor` (ADR-021). */
  paidMinor: Minor
  /** مشتق مخزَّن = `totalMinor + extraChargesMinor − paidMinor` (الثابت I5). */
  remainingMinor: Minor
  /** فواتير متغيرة (كهرباء): تسمح بدفع يتجاوز التقدير بإقرار صريح من المستخدم. */
  readonly isVariableAmount: boolean

  dueDate: ISODate
  recurrence: Recurrence | null
  installments: readonly Installment[] | null
  priority: 1 | 2 | 3
  status: ObligationStatus
  /** تاريخ حساب الحالة: الحالة مشتقة من (التاريخ + المسدَّد)، فنعرف متى حُسبت. */
  statusComputedFor: ISODate

  /**
   * الحساب النقدي الذي يُحجَز منه `remainingMinor` كمرآة `earmarkedMinor` (5.6).
   * `null` = لا حجز لهذا الالتزام. **لا أثر محاسبي إطلاقاً**؛ تحذير واجهة فقط (ADR-017).
   */
  earmarkFromAccountId: AccountId | null

  paymentCount: number
  lastPaymentEntryId: EntryId | null
  attachments?: readonly string[] // معطَّل على Spark (ق-1)
  notes?: string
  readonly createdAt: EpochMs
  updatedAt: EpochMs
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
  readonly debtId: DebtId
  schemaVersion: number
  readonly ownerUid: string

  /** `'payable'` = عليّ (القسم 9) · `'receivable'` = لي (القسم 10). لا يتغير بعد الإنشاء. */
  readonly direction: 'payable' | 'receivable'
  readonly counterpartyContactId: ContactId
  /** لقطة الاسم للتصدير ولعرض الدين إن حُذفت جهة الاتصال. */
  counterpartyName: string
  /** `liability.payable.c_*` أو `asset.receivable.c_*` — علاقة 1:1 مع الدين. */
  readonly accountId: AccountId

  /** قيمة الدين الأصلية. */
  principalMinor: Minor
  /** المسدَّد (payable) أو المحصَّل (receivable). المصدر المستقل: ADR-021. */
  settledMinor: Minor
  /** مشتق مخزَّن = `principalMinor − settledMinor` (الثابت I6). */
  remainingMinor: Minor

  /**
   * هل نشأ الدين بحركة نقدية فعلية؟ يحدد شكل قيد النشوء:
   * `true` ⇒ قيد `borrow`/`lend` كامل. `false` ⇒ خصم/أصل مقابل `equity.opening` بلا مسّ النقد
   * (تطبيق القاعدة 19.6: «تسجيل دين لا يعني بالضرورة حركة نقدية»).
   */
  readonly createdCash: boolean

  originatedAt: ISODate
  expectedSettleAt: ISODate | null
  installments: readonly Installment[] | null
  status: 'open' | 'partiallySettled' | 'settled' | 'writtenOff' | 'cancelled'
  /** ثابت نوعي: السداد/التحصيل الزائد ممنوع دائماً (القسم 19). ليس إعداداً. */
  readonly allowOverSettle: false

  settlementCount: number
  lastSettlementEntryId: EntryId | null
  /** سجل متابعة التحصيل (القسم 10): ملاحظة + موعد تواصل. لا أثر مالي. */
  followUps?: readonly { at: ISODate; note: string; nextContactAt: ISODate | null }[]
  attachments?: readonly string[] // معطَّل على Spark (ق-1)
  notes?: string
  readonly createdAt: EpochMs
  updatedAt: EpochMs
}

/** اسمان مريحان للقراءة فقط — لا مجموعتان ولا مستندان. */
export type DebtPayable = Debt & { readonly direction: 'payable' }
export type DebtReceivable = Debt & { readonly direction: 'receivable' }
