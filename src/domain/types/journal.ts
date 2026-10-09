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
  PeriodKey,
  Scope,
  Side,
} from './primitives'
import type { AccountType } from './account'

export type EntryKind =
  | 'opening' // رصيد افتتاحي (3.5)
  | 'expense' // مصروف حقيقي
  | 'income' // دخل حقيقي مستلم
  | 'transfer' // تحويل: طرفاه asset ⇒ لا دخل ولا مصروف بنيوياً (19.3)
  | 'obligationPayment' // دفع التزام (19.5)
  | 'borrow' // استلام قرض: أصل ↑ وخصم ↑ — ليس دخلاً (19.6)
  | 'debtRepayment' // سداد دين عليّ: خصم ↓ وأصل ↓ — ليس مصروفاً (19.8)
  | 'lend' // إقراض: مستحق لي ↑ ونقد ↓ — ليس مصروفاً
  | 'debtCollection' // تحصيل: نقد ↑ ومستحق لي ↓ — ليس دخلاً (19.7)
  | 'earmark' // تخصيص لهدف داخل حقوق الملكية — لا يمس النقد (ADR-017)
  | 'adjustment' // تسوية مبرَّرة مقابل equity.adjustment
  | 'reversal' // قيد عكس (ADR-006)

/** سطر القيد. مُضمَّن في مستند القيد ⇒ «القيد اليتيم» مستحيل بنيوياً (القسم 1.3). */
export interface JournalLine {
  /** 1-based، ثابت إلى الأبد. مفتاح `Posting` و`EntryCorrection` يشير إليه. */
  readonly lineNo: number
  readonly side: Side
  readonly accountId: AccountId
  /**
   * نوع الحساب، مكرَّر عن قصد: يجعل تصنيف دخل/مصروف دالّة في السطر وحده،
   * فلا تقرير يحتاج قراءة مستندات الحسابات، ولا نتيجة تتغير إن أُعيد تصنيف حساب.
   */
  readonly accountType: AccountType
  /** **موجب دائماً وصحيح**. لا سطر بصفر ولا بسالب (ثابت I2). الإشارة في `side` لا في الرقم. */
  readonly amountMinor: Minor
  /** النطاق (3.8). إلزامي على كل سطر؛ يُقرأ فقط على سطور `expense` (ثابت I-SCOPE-1). */
  readonly scope: Scope
  /** === accountId على سطور expense، و null على غيرها (ثابت I-COA-2، القسم 3.7). */
  readonly categoryId: AccountId | null
  /**
   * أثر هذا السطر على `paidMinor`/`settledMinor` للكيان في `refs` (ADR-021).
   * موجب = سداد/تحصيل، سالب = عكس سداد، `0` = لا أثر. **هو المصدر المستقل**
   * الذي يُتحقَّق به من مُجمَّعات الالتزام والدين بـ `sum()` خادمي بلا قراءة الدفعات.
   */
  readonly settlementDeltaMinor: Minor
  /** روابط هذا السطر بالكيانات التشغيلية. على السطر لا على القيد: دفعة واحدة قد تمسّ التزامين. */
  readonly refs: LineRefs
  /** ملاحظة سطر (مثل «حصة الكهرباء»). عرض وتصدير فقط. */
  readonly memo?: string
}

export interface LineRefs {
  /** الالتزام الذي يسدّده هذا السطر. مفتاح استعلام سجل الدفعات (ADR-005: لا مجموعة دفعات). */
  readonly obligationId?: ObligationId
  /** رقم القسط داخل الالتزام (1-based)، إن كان السداد مرتبطاً بقسط محدد. */
  readonly installmentIndex?: number
  /** الدين (عليّ أو لي) الذي يمسّه السطر. */
  readonly debtId?: DebtId
  /** الجهة (دائن/مدين/جهة مستفيدة). */
  readonly contactId?: ContactId
  /** الهدف المالي — على سطور `earmark` وعلى تحويل إلى حساب هدف. */
  readonly goalId?: GoalId
  /** قالب التكرار الذي ولّد القيد + مفتاح الدورة — يمنع التوليد المزدوج (ADR-013). */
  readonly recurringId?: string
  readonly occurrenceKey?: string // 'YYYY-MM-DD' للدورة
}

/** users/{uid}/journalEntries/{entryId} — السطور مُضمَّنة (ADR-002). */
export interface JournalEntry {
  /** = معرّف المستند = `opId` (ADR-004). منع الازدواج خصيصة في المفتاح لا منطق تطبيقي. */
  readonly entryId: EntryId
  /** نفس القيمة. موجود صريحاً حتى يعمل التصدير والتدقيق بلا الاعتماد على معرّف المستند. */
  readonly opId: OpId
  /**
   * SHA-256 لحمولة الطلب المُقنَّنة. يكشف «نفس opId بحمولة مختلفة» = خطأ برمجي أو جهاز
   * أعاد إرسال طلب عُدِّل محلياً ⇒ `OP_ID_CONFLICT` بدل كتابة صامتة خاطئة.
   */
  readonly payloadHash: string
  schemaVersion: number
  readonly ownerUid: string

  readonly kind: EntryKind
  /** التاريخ المحاسبي بتوقيت ليبيا. هو وحده يحدد الفترة. */
  readonly bookedAt: ISODate
  /** ≡ bookedAt[0:7]، بلا استثناء (ADR-008). مخزَّن ليُفهرَس ويُجمَّع خادمياً. */
  readonly periodKey: PeriodKey

  /** السطور. الطول ≥ 2 دائماً (ثابت I2). */
  readonly lines: readonly JournalLine[]
  /** مجموع المدين. = `creditTotalMinor` دائماً (ثابت I1، مفروض في القواعد أيضاً). */
  readonly debitTotalMinor: Minor
  readonly creditTotalMinor: Minor

  /** الحسابات المتأثرة، مشتق ومميَّز — لاستعلام `array-contains` في كشف الحساب. */
  readonly accountIds: readonly AccountId[]
  /** أنواع الحسابات المتأثرة، مشتق ومميَّز — لتصفية القوائم بلا قراءة السطور. */
  readonly accountTypes: readonly AccountType[]
  /** قيم `lines[].scope` المميَّزة — لتصفية قائمة عمليات المنزل بـ `array-contains` (3.8). */
  readonly scopes: readonly Scope[]

  /** وصف عربي إلزامي غير فارغ — القسم 25 بند 18. */
  description: string
  /** ملاحظة حرّة. الحقل الوحيد القابل للتعديل بلا قيد تصحيح (جدول القسم 8). */
  memo?: string
  /** وسوم المستخدم الحرّة (ليست `scope`، وليست فئة). بحث وتصفية فقط. */
  tags?: readonly string[]

  /** معرّفات المرفقات. **الواجهة معطَّلة على Spark (ق-1)** والحقل موجود في المخطط من الآن. */
  attachments?: readonly string[]

  /** هل عُكس هذا القيد؟ للعرض وتصفية القوائم. **لا مجموع يحتاجه** (العكس يُصفِّر نفسه، القسم 1.2). */
  reversed: boolean
  /** القيد الذي عكسه. */
  reversedByEntryId?: EntryId
  /** إن كان هذا القيد نفسه قيد عكس: أي قيد يعكس. `null` لغير قيود العكس. */
  readonly reversalOf: EntryId | null
  /** القيد البديل في عملية التعديل (ADR-006: عكس + بديل في معاملة واحدة). */
  replacedByEntryId?: EntryId
  readonly replacesEntryId?: EntryId
  /** سبب العكس/التعديل بالعربية. إلزامي على كل قيد `reversal` وكل قيد بديل. */
  readonly correctionReason?: string

  /** لحظة الكتابة على الخادم (يُحوَّلها `data/` إلى serverTimestamp). للترتيب المستقر. */
  readonly createdAt: EpochMs
  /** لحظة إنشاء الطلب على الجهاز. للتدقيق وكشف فجوات الطابور — لا للترتيب. */
  readonly clientCreatedAt: EpochMs
  /** معرّف الجهاز. لتشخيص تعارضات التزامن بين الهاتف والحاسوب (القسم 23 بند 9). */
  readonly deviceId: string
}
