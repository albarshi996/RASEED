import type { WritePlan } from './plan'

export type DomainErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'ACCOUNT_NOT_POSTABLE'
  | 'ACCOUNT_TYPE_MISMATCH'
  | 'SYSTEM_ACCOUNT_PROTECTED'
  | 'INSUFFICIENT_FUNDS'
  | 'MIN_BALANCE_BREACH'
  | 'NON_POSITIVE_AMOUNT'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'UNBALANCED_ENTRY'
  | 'SAME_ACCOUNT_TRANSFER'
  | 'FEE_CATEGORY_REQUIRED'
  | 'CATEGORY_MISMATCH'
  | 'CATEGORY_REQUIRED_FOR_EXPENSE_NATURE'
  | 'OVER_SETTLEMENT'
  | 'OBLIGATION_CLOSED'
  | 'DEBT_CLOSED'
  | 'INSTALLMENT_NOT_FOUND'
  | 'FUTURE_BOOKED_AT'
  | 'BOOKED_AT_TOO_OLD'
  | 'OP_ID_CONFLICT'
  | 'ENTRY_NOT_FOUND'
  | 'ENTRY_ALREADY_CORRECTED'
  | 'OPENING_ENTRY_EXISTS'
  | 'CANNOT_CORRECT_REVERSAL'
  | 'REQUIRES_CONNECTION'
  | 'CONFIRMATION_REQUIRED'

/** الرسائل العربية. **المصدر الوحيد** لنصوص أخطاء النواة (القسم 25 بند 18). */
export const DOMAIN_ERROR_AR: Readonly<Record<DomainErrorCode, string>> = {
  ACCOUNT_NOT_FOUND: 'الحساب غير موجود.',
  ACCOUNT_ARCHIVED: 'هذا الحساب معطَّل ولا يمكن التسجيل عليه. أعِد تنشيطه من إدارة الحسابات.',
  ACCOUNT_NOT_POSTABLE: 'هذا بند تجميعي ولا يُسجَّل عليه مباشرة. اختر بنداً فرعياً.',
  ACCOUNT_TYPE_MISMATCH: 'نوع الحساب لا يناسب هذه العملية.',
  SYSTEM_ACCOUNT_PROTECTED: 'هذا حساب نظام ولا يمكن تعديل نوعه أو موضعه في الشجرة.',
  INSUFFICIENT_FUNDS: 'الرصيد غير كافٍ: المتاح {available} والمطلوب {required}.',
  MIN_BALANCE_BREACH: 'هذه العملية تُخفض الرصيد تحت الحد المسموح ({minBalance}).',
  NON_POSITIVE_AMOUNT: 'المبلغ يجب أن يكون أكبر من صفر.',
  AMOUNT_OUT_OF_RANGE: 'المبلغ يتجاوز الحد الأقصى المسموح.',
  UNBALANCED_ENTRY: 'خطأ داخلي: القيد غير متوازن. لم يُحفَظ شيء.',
  SAME_ACCOUNT_TRANSFER: 'لا يمكن التحويل من الحساب إلى نفسه.',
  FEE_CATEGORY_REQUIRED: 'حدِّد فئة المصروف الخاصة بعمولة التحويل.',
  CATEGORY_MISMATCH: 'خطأ داخلي: تصنيف السطر لا يطابق حسابه. لم يُحفَظ شيء.',
  CATEGORY_REQUIRED_FOR_EXPENSE_NATURE: 'التزام من نوع «مصروف» يحتاج فئة مصروف.',
  OVER_SETTLEMENT: 'المبلغ يتجاوز المتبقي ({remaining}).',
  OBLIGATION_CLOSED: 'هذا الالتزام مسدَّد أو ملغى ولا يقبل دفعات جديدة.',
  DEBT_CLOSED: 'هذا الدين مغلق ولا يقبل حركات جديدة.',
  INSTALLMENT_NOT_FOUND: 'القسط المحدد غير موجود.',
  FUTURE_BOOKED_AT: 'لا يمكن التسجيل بتاريخ مستقبلي.',
  BOOKED_AT_TOO_OLD: 'التاريخ أقدم من المسموح ({minDate}).',
  OP_ID_CONFLICT: 'عملية بنفس المعرّف مسجَّلة ببيانات مختلفة. حدِّث الصفحة وأعد المحاولة.',
  ENTRY_NOT_FOUND: 'العملية المطلوبة غير موجودة.',
  ENTRY_ALREADY_CORRECTED: 'هذه العملية عُدِّلت أو أُلغيت من قبل.',
  OPENING_ENTRY_EXISTS: 'لهذا الحساب رصيد افتتاحي مسجَّل. عدِّله بدلاً من إضافة رصيد ثانٍ.',
  CANNOT_CORRECT_REVERSAL: 'لا يمكن تعديل قيد عكس. عدِّل العملية الأصلية.',
  REQUIRES_CONNECTION: 'تحتاج هذه العملية اتصالاً بالإنترنت. أُضيفت إلى الطابور وستُنفَّذ تلقائياً.',
  CONFIRMATION_REQUIRED: 'العملية تحتاج تأكيدك: {warning}',
}

export interface DomainError {
  readonly code: DomainErrorCode
  /** الرسالة بعد تعويض الوسائط، جاهزة للعرض. لا تُبنى رسالة في الواجهة. */
  readonly messageAr: string
  /** وسائط التعويض بعد التنسيق بـ `formatLYD` — لا `Minor` خام يُعرض للمستخدم. */
  readonly params?: Readonly<Record<string, string | number>>
  /** الحقل المسؤول في النموذج، لتوجيه التركيز في الواجهة. */
  readonly field?: string
}

/** ناتج طبقة النطاق الوحيد. لا استثناءات للأخطاء المتوقَّعة. */
export type PlanResult =
  { readonly ok: true; readonly plan: WritePlan } | { readonly ok: false; readonly error: DomainError }
