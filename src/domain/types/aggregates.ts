import type { AccountId, EpochMs, ISODate, Minor, PeriodKey } from './primitives'
import type { AccountType } from './account'

/**
 * users{uid}/accountPeriods/{accountId}__{periodKey}
 * **حركة فقط** (ADR-009). لا `openingBalanceMinor` ولا `closingBalanceMinor` — القسم 5.3.
 */
export interface AccountPeriod {
  readonly id: string // `${accountId}__${periodKey}` — حتمي
  readonly accountId: AccountId
  readonly accountType: AccountType // حتى يعمل تقرير «حركة كل حسابات المصروف» بلا انضمام
  readonly periodKey: PeriodKey
  schemaVersion: number
  readonly ownerUid: string

  /** حركة الفترة المدينة. `increment` فقط ⇒ قيد مؤرَّخ للماضي يمسّ مستنداً واحداً فقط. */
  debitMinor: Minor
  creditMinor: Minor
  /** عدد القيود في الفترة. لكشف الكتابة المفقودة ولعرض «عدد الحركات». */
  entryCount: number
  /** أول وآخر تاريخ حركة في الفترة. يُستخدم في كشف الحساب ورؤوس الجداول. */
  firstBookedAt: ISODate
  lastBookedAt: ISODate
  updatedAt: EpochMs
}

/** صفّ محسوب (لا يُخزَّن) تُنتجه `periodBalanceSeries` — القسم 5.3. */
export interface PeriodBalanceRow {
  readonly periodKey: PeriodKey
  readonly openingMinor: Minor // مشتق تراكمياً، غير مخزَّن
  readonly debitMinor: Minor
  readonly creditMinor: Minor
  readonly closingMinor: Minor // = opening ± الحركة بحسب normalSide
}
