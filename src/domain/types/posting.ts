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
import type { EntryKind } from './journal'

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
  readonly postingId: string
  readonly entryId: EntryId
  readonly opId: OpId // للربط بالطابور وبسجل التدقيق
  readonly lineNo: number
  schemaVersion: number
  readonly ownerUid: string

  readonly accountId: AccountId // مرشِّح كشف الحساب والتجميع على مستوى الحساب
  readonly accountType: AccountType // مرشِّح تقارير الدخل/المصروف بلا انضمام
  readonly side: Side // للعرض والتصدير؛ المجاميع تستخدم الحقلين التاليين
  /** المبلغ المدين، أو `0`. حقلان لا حقل واحد مع `side`: فـ `sum('debitMinor')` يعمل بفهرس واحد. */
  readonly debitMinor: Minor
  /** المبلغ الدائن، أو `0`. أحدهما صفر دائماً وكلاهما غير سالب. */
  readonly creditMinor: Minor

  readonly bookedAt: ISODate // نطاقات التاريخ (تقرير أسبوعي/نافذة الشهر المالي)
  readonly periodKey: PeriodKey // المرشِّح الأساسي لكل تقرير شهري (ADR-008)
  readonly kind: EntryKind // «حجم التحويلات»، «المقترض»، «المسدَّد» بمجموع واحد
  readonly scope: Scope // تقرير المنزل = نفس المجموع + مرشِّح واحد (3.8)
  readonly categoryId: AccountId | null // استهلاك الميزانية بـ sum() خادمي

  /** ADR-021: `sum('settlementDeltaMinor')` = المصدر المستقل لـ `paidMinor`/`settledMinor`. */
  readonly settlementDeltaMinor: Minor

  /** روابط مسطَّحة (لا داخل خريطة) لأن كلاً منها مفتاح استعلام مُجمَّع. */
  readonly obligationId: ObligationId | null
  readonly debtId: DebtId | null
  readonly contactId: ContactId | null
  readonly goalId: GoalId | null

  readonly createdAt: EpochMs
}
