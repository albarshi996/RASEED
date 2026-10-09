import type { DomainError } from './errors'
import type { EpochMs, OpId } from './primitives'
import type { OperationRequest } from './operations'

export type PendingStatus =
  | 'queued' // في الطابور، لم تُحاوَل بعد
  | 'inflight' // runTransaction جارية الآن
  | 'failed' // فشلت فشلاً نهائياً (خطأ نطاق) وتنتظر قرار المستخدم
  | 'applied' // نجحت؛ تُحذف من الطابور بعد تأكيد وجود القيد

/**
 * users/{uid}/pendingCommands/{opId}
 * `runTransaction` لا تعمل دون اتصال (ADR-007) ⇒ الطلب يُسجَّل هنا ويُنفَّذ عند عودة الاتصال.
 * **المستندات هنا مستبعدة من كل رصيد وكل تقرير**، وتُعرض في الواجهة كـ «قيد الانتظار» فقط.
 */
export interface PendingCommand {
  readonly opId: OpId // = معرّف المستند ⇒ لا طلب مزدوج في الطابور
  readonly request: OperationRequest // الطلب كما بناه النطاق، مُقنَّن
  readonly payloadHash: string // يُقارَن بـ entry.payloadHash عند النجاح
  status: PendingStatus
  /** عدد المحاولات. بعد 5 محاولات متتالية بخطأ شبكة يُعرض للمستخدم بلا حذف. */
  attempts: number
  /** آخر خطأ: رمز نطاق أو رمز Firestore. يُعرض بالعربية. */
  lastError: DomainError | { code: 'INFRA'; detail: string } | null
  /** هل طُبِّقت المرآة المحلية؟ المرآة عرض فقط ولا تُجمَّع في أي رصيد. */
  mirrorApplied: boolean
  readonly createdAt: EpochMs
  readonly deviceId: string
  readonly ownerUid: string
  schemaVersion: number
}
