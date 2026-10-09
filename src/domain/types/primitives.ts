/**
 * الأنواع الأولية للنواة — عقد النواة §4.
 *
 * **توحيد مصدر الحقيقة:** عقد النواة يعرّف `Minor` و`Bps` و`ISODate` و`PeriodKey`
 * داخل هذا الملف، لكنها كانت قد نُفِّذت فعلًا في `@/domain/money` و`@/lib/time`.
 * الأنواع الموسومة بـ `unique symbol` **لا تتوافق إن أُعلنت مرتين**، فيُعاد تصديرها من
 * مصدرها الوحيد بدل إعلانها هنا. هذا يحفظ نص العقد ويمنع نوعين متطابقين شكلًا متنافرين فعلًا.
 */

export { MAX_ABS_MINOR, type Bps, type Minor } from '@/domain/money'
export {
  LIBYA_UTC_OFFSET_MINUTES,
  periodKeyOf,
  today as todayInLibya,
  type ISODate,
  type PeriodKey,
} from '@/lib/time'

import type { AccountType } from './account'

/** لحظة بالمللي ثانية منذ 1970 — للتدقيق والترتيب التشخيصي فقط، لا للمحاسبة. */
export type EpochMs = number & { readonly __epochMs: unique symbol }

/** معرّف الحساب = رمزه الهرمي = معرّف المستند. مثال: `expense.home.utilities` (§3.2). */
export type AccountId = string & { readonly __accountId: unique symbol }

/** معرّف العملية: يولّده العميل قبل أي اتصال (ULID). مفتاح منع الازدواج الوحيد (ADR-004). */
export type OpId = string & { readonly __opId: unique symbol }

/** معرّف القيد. ثابت ADR-004: `entryId === opId`. نوع منفصل لأن AmendEntry يشير إلى قيد لا إلى عملية. */
export type EntryId = string & { readonly __entryId: unique symbol }

export type ContactId = string & { readonly __contactId: unique symbol }
export type ObligationId = string & { readonly __obligationId: unique symbol }
export type DebtId = string & { readonly __debtId: unique symbol }
export type GoalId = string & { readonly __goalId: unique symbol }
export type BudgetId = string & { readonly __budgetId: unique symbol }

/** جانب القيد. لا قيمة ثالثة. */
export type Side = 'debit' | 'credit'

/** تصنيف النطاق (§3.8). يعيش على **السطر** لا على القيد — وهذا ما يمنع ازدواج تقرير المنزل. */
export type Scope = 'personal' | 'household'

/** العملة. محجوزة للتوسعة؛ لا تعدد عملات في الإصدار الأول (§2.1). */
export type Currency = 'LYD'

/**
 * نوع الحساب من معرّفه (ثابت I-COA-1: البادئة = النوع، §3.2).
 * تغني عن قراءة مستند الحساب في كل مكان يُبنى فيه مُجمَّع.
 */
export function typeOf(id: AccountId): AccountType {
  return id.slice(0, id.indexOf('.')) as AccountType
}
