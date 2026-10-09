import type {
  AccountId,
  ContactId,
  DebtId,
  EntryId,
  EpochMs,
  GoalId,
  ISODate,
  Minor,
  ObligationId,
  OpId,
  Scope,
} from './primitives'

/** تأكيد صريح لتحذير غير مانع (مثل تجاوز الحجز — ADR-017). */
export type ConfirmationToken = 'EARMARK_EXCEEDED' | 'VARIABLE_AMOUNT_OVER' | 'BACKDATED_ENTRY'

/** الحقول المشتركة في كل طلب. */
export interface OpBase {
  /** يولّده العميل (ULID) **قبل** أي اتصال. مفتاح منع الازدواج الوحيد (ADR-004). */
  readonly opId: OpId
  /** التاريخ المحاسبي. منه وحده يُحسب `periodKey` (ADR-008). */
  readonly bookedAt: ISODate
  readonly memo?: string
  readonly attachments?: readonly string[] // معطَّل على Spark (ق-1)
  readonly tags?: readonly string[]
  /** تأكيدات المستخدم للتحذيرات غير المانعة. بلا التأكيد المطلوب يُرفض الطلب. */
  readonly confirmations?: readonly ConfirmationToken[]
  readonly clientCreatedAt: EpochMs
  readonly deviceId: string
}

/** جزء من مصروف: فئة + مبلغ + نطاق. يسمح بمصروف واحد موزَّع (3.8، والقسم 2.5). */
export interface ExpenseSplit {
  readonly categoryId: AccountId // حساب expense قابل للترحيل
  readonly amountMinor: Minor // موجب
  readonly scope: Scope
  readonly memo?: string
}

export interface RecordExpense extends OpBase {
  readonly type: 'RecordExpense'
  /** الحساب المدفوع منه. يجب أن يكون `asset` قابلاً للترحيل. */
  readonly fromAccountId: AccountId
  /** جزء واحد على الأقل. المجموع هو مبلغ العملية. */
  readonly splits: readonly [ExpenseSplit, ...ExpenseSplit[]]
  readonly payeeContactId?: ContactId
  /** طريقة الدفع — وصفية بحتة (نقد/بطاقة/تحويل)؛ الأثر المحاسبي في `fromAccountId` وحده. */
  readonly paymentMethod?: 'cash' | 'card' | 'transfer' | 'wallet' | 'other'
}

export interface RecordIncome extends OpBase {
  readonly type: 'RecordIncome'
  /** الحساب المستلم (`asset`). */
  readonly toAccountId: AccountId
  /** حساب الدخل (`income.*`). ليس نصاً حرّاً: المصدر = حساب (3.4). */
  readonly sourceAccountId: AccountId
  readonly amountMinor: Minor
  readonly payerContactId?: ContactId
}

export interface Transfer extends OpBase {
  readonly type: 'Transfer'
  readonly fromAccountId: AccountId
  readonly toAccountId: AccountId // ≠ fromAccountId (حارس SAME_ACCOUNT_TRANSFER)
  readonly amountMinor: Minor
  /** عمولة التحويل. تُرحَّل سطراً مستقلاً على حساب مصروف ⇒ التحويل يبقى محايداً والعمولة مصروف. */
  readonly feeMinor?: Minor
  readonly feeCategoryId?: AccountId // إلزامي إن وُجد `feeMinor`
  /** الهدف المرتبط عند التحويل إلى حساب هدف `backedAccount`. */
  readonly goalId?: GoalId
}

export interface PayObligation extends OpBase {
  readonly type: 'PayObligation'
  readonly obligationId: ObligationId
  readonly fromAccountId: AccountId
  readonly amountMinor: Minor
  /** القسط المقصود، إن كان السداد مرتبطاً بقسط بعينه. */
  readonly installmentIndex?: number
  /** غرامة/رسم مدفوع مع هذه الدفعة ⇒ سطر على `expense.financeCharges` ورفع `extraChargesMinor` (ADR-012). */
  readonly extraChargesMinor?: Minor
}

export interface PayDebt extends OpBase {
  readonly type: 'PayDebt' // سداد دين عليّ — القاعدة 19.8
  readonly debtId: DebtId
  readonly fromAccountId: AccountId
  readonly amountMinor: Minor
  /** فائدة/رسم مدفوع فوق الأصل ⇒ مصروف، ولا يُرفع `principalMinor` أبداً. */
  readonly extraChargesMinor?: Minor
}

export interface CollectDebt extends OpBase {
  readonly type: 'CollectDebt' // تحصيل دين لي — القاعدة 19.7
  readonly debtId: DebtId
  readonly toAccountId: AccountId
  readonly amountMinor: Minor
}

export interface BorrowMoney extends OpBase {
  readonly type: 'BorrowMoney' // استلام قرض — ليس دخلاً (19.6)
  readonly counterpartyContactId: ContactId
  readonly counterpartyName: string
  readonly principalMinor: Minor
  /** الحساب الذي دخل فيه المال. `null` ⇒ دين نشأ بلا حركة نقدية (`createdCash: false`). */
  readonly toAccountId: AccountId | null
  readonly expectedSettleAt?: ISODate
  readonly installmentCount?: number // ≥1 ⇒ يُبنى جدول أقساط بـ splitEven (القسم 2.6)
}

export interface LendMoney extends OpBase {
  readonly type: 'LendMoney' // إقراض — ليس مصروفاً
  readonly counterpartyContactId: ContactId
  readonly counterpartyName: string
  readonly amountMinor: Minor
  readonly fromAccountId: AccountId | null
  readonly expectedSettleAt?: ISODate
}

export interface Adjust extends OpBase {
  readonly type: 'Adjust' // تسوية مبرَّرة — الطرف `equity.adjustment` (3.4)
  readonly accountId: AccountId
  readonly direction: 'increase' | 'decrease'
  readonly amountMinor: Minor
  /** سبب عربي إلزامي غير فارغ. بلا سبب لا تسوية (القسم 5 من المتطلبات). */
  readonly reason: string
}

export interface VoidEntry extends OpBase {
  readonly type: 'VoidEntry' // إلغاء = عكس كامل (ADR-006)؛ لا حذف مالي أبداً
  readonly targetEntryId: EntryId
  readonly reason: string
}

/** حذف مفاتيح من **كل** عضو في اتحاد مميَّز (Omit العادي لا يوزّع على الاتحاد). */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

export type AmendableRequest = Exclude<OperationRequest, { type: 'VoidEntry' } | { type: 'AmendEntry' }>

export interface AmendEntry extends OpBase {
  readonly type: 'AmendEntry' // عكس + بديل في معاملة واحدة بدلتا صافية (ADR-006)
  readonly targetEntryId: EntryId
  readonly reason: string
  /** الطلب البديل بقيمه الجديدة. معرّفاته الزمنية تأتي من `AmendEntry` نفسه لا منه. */
  readonly replacement: DistributiveOmit<
    AmendableRequest,
    'opId' | 'clientCreatedAt' | 'deviceId' | 'confirmations'
  >
}

/** الاتحاد المميَّز الكامل. `planOperation` تُطابق عليه بـ `switch` شامل (exhaustive). */
export type OperationRequest =
  | RecordExpense
  | RecordIncome
  | Transfer
  | PayObligation
  | PayDebt
  | CollectDebt
  | BorrowMoney
  | LendMoney
  | Adjust
  | VoidEntry
  | AmendEntry
