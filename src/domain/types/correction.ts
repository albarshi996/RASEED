import type { EntryId, EpochMs } from './primitives'

/**
 * users/{uid}/entryCorrections/{originalEntryId}   (ADR-014)
 * **قفل**: وجود المستند يعني أن القيد الأصلي صُحِّح. معرّفه = معرّف القيد الأصلي،
 * فـ «تعديلان متزامنان لنفس القيد» يفشل ثانيهما على `exists == false` بدل أن ينتجا عكسين.
 */
export interface EntryCorrection {
  readonly originalEntryId: EntryId // = معرّف المستند
  readonly kind: 'void' | 'amend'
  readonly reversalEntryId: EntryId // قيد العكس المُنشأ في نفس المعاملة
  readonly replacementEntryId: EntryId | null // البديل عند 'amend'، و null عند 'void'
  readonly reason: string // عربي، إلزامي غير فارغ
  readonly correctedAt: EpochMs
  readonly deviceId: string
  readonly ownerUid: string
  schemaVersion: number
}
