import type { Account, AccountType } from './account'
import type {
  AccountId,
  DebtId,
  EntryId,
  EpochMs,
  GoalId,
  ISODate,
  Minor,
  ObligationId,
  OpId,
  PeriodKey,
} from './primitives'
import type { ConfirmationToken, OperationRequest } from './operations'
import type { Debt, ObligationStatus } from './satellites'
import type { EntryCorrection } from './correction'
import type { JournalEntry } from './journal'
import type { Posting } from './posting'

/** زيادة ذرّية على مُجمَّع. تُترجَم في `data/` إلى `increment()` حصراً. */
export interface AccountDelta {
  readonly accountId: AccountId
  readonly debitDeltaMinor: Minor // ≥ 0
  readonly creditDeltaMinor: Minor // ≥ 0
  readonly entryCountDelta: number // 0 أو 1 (أو −1 عند إعادة البناء)
  readonly lastPostedEntryId: EntryId
  readonly lastPostedAt: ISODate
}

export interface AccountPeriodDelta {
  readonly id: string // `${accountId}__${periodKey}`
  readonly accountId: AccountId
  readonly accountType: AccountType
  readonly periodKey: PeriodKey
  readonly debitDeltaMinor: Minor
  readonly creditDeltaMinor: Minor
  readonly entryCountDelta: number
  readonly bookedAt: ISODate // لتحديث first/lastBookedAt
}

/** تحديث مرآة الحجز (ADR-017). منفصل عن `AccountDelta` لأنه لا يمسّ المدين/الدائن. */
export interface EarmarkDelta {
  readonly accountId: AccountId
  readonly earmarkedDeltaMinor: Minor // موقَّع
}

/** تحديث كيان تشغيلي. اتحاد مميَّز حتى لا تُكتب حقول كيان على كيان آخر. */
export type SatelliteDelta =
  | {
      readonly kind: 'obligation'
      readonly obligationId: ObligationId
      readonly paidDeltaMinor: Minor
      readonly extraChargesDeltaMinor: Minor
      readonly installmentIndex: number | null
      readonly nextStatus: ObligationStatus
      readonly lastPaymentEntryId: EntryId
    }
  | {
      readonly kind: 'debt'
      readonly debtId: DebtId
      readonly settledDeltaMinor: Minor
      readonly nextStatus: Debt['status']
      readonly lastSettlementEntryId: EntryId
    }
  | {
      readonly kind: 'budget'
      readonly periodKey: PeriodKey
      readonly categoryId: AccountId
      readonly spentDeltaMinor: Minor
    }
  | { readonly kind: 'goal'; readonly goalId: GoalId; readonly savedDeltaMinor: Minor }
  | { readonly kind: 'accountCreate'; readonly account: Account }

export interface AuditLogDraft {
  readonly opId: OpId
  readonly action: OperationRequest['type']
  readonly entryIds: readonly EntryId[]
  readonly summaryAr: string // سطر عربي يُقرأ في سجل التدقيق بلا فكّ ترميز
  readonly deviceId: string
  readonly at: EpochMs
}

/** مسار مستند يجب على `data/` قراءته داخل `runTransaction` قبل التطبيق (النطاق لا يقرأ). */
export type DocPath =
  | { readonly col: 'accounts'; readonly id: AccountId }
  | { readonly col: 'obligations'; readonly id: ObligationId }
  | { readonly col: 'debts'; readonly id: DebtId }
  | { readonly col: 'journalEntries'; readonly id: EntryId }
  | { readonly col: 'entryCorrections'; readonly id: EntryId }

/** تحذير غير مانع. يُعرَض للمستخدم ويحتاج `ConfirmationToken` لإعادة الإرسال. */
export interface DomainWarning {
  readonly code: ConfirmationToken
  readonly messageAr: string
  readonly context: Readonly<Record<string, string | number>>
}

/**
 * ناتج `planOperation`. **وصف كامل لما سيُكتب، ولا كتابة فيه.**
 * `data/postOperation()` تُنفّذه حرفياً ولا تتخذ أي قرار محاسبي.
 */
export interface WritePlan {
  readonly planVersion: 1
  readonly opId: OpId
  /** قيد أو قيدان (العكس + البديل في `AmendEntry`). لا أكثر. */
  readonly entries: readonly [JournalEntry, ...JournalEntry[]]
  readonly postings: readonly Posting[]
  readonly accountDeltas: readonly AccountDelta[]
  readonly periodDeltas: readonly AccountPeriodDelta[]
  readonly earmarkDeltas: readonly EarmarkDelta[]
  readonly satelliteDeltas: readonly SatelliteDelta[]
  readonly correctionLock: EntryCorrection | null
  readonly audit: AuditLogDraft
  /** ما يجب إعادة التحقق منه داخل المعاملة (أرصدة، حالات، أقفال). */
  readonly reads: readonly DocPath[]
  /** تحذيرات صدر الطلب بتأكيداتها؛ تُعرَض في شاشة التأكيد. */
  readonly warnings: readonly DomainWarning[]
  /** عدد الكتابات المتوقَّع. يُفحَص ضد سقف 500 قبل الإرسال. */
  readonly writeCount: number
}
