import { readFileSync } from 'node:fs'

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'

/**
 * بيئة اختبار قواعد Firestore.
 *
 * القواعد تحمل `REPLACE_WITH_OWNER_UID` كعنصر نائب يُثبَّت عند النشر.
 * الاختبارات تستبدله بـ UID اختباري حتى نفحص **السلوك** لا القيمة.
 * هذا مقصود: لو جرّبنا القواعد بقيمة الإنتاج لما اكتشفنا أن الإغلاق يعمل أصلًا.
 */

export const OWNER_UID = 'owner-test-uid'
export const INTRUDER_UID = 'intruder-test-uid'
export const OTHER_UID = 'other-test-uid'

export async function makeTestEnv(projectId = 'raseed-rules-test'): Promise<RulesTestEnvironment> {
  const rules = readFileSync('firestore.rules', 'utf8').replace(/'[A-Za-z0-9]{20,}'/, "'" + OWNER_UID + "'")
  return initializeTestEnvironment({
    projectId,
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
}

/** قيد متوازن صالح الشكل — الأساس الذي تُشتق منه حالات الفشل بتغيير حقل واحد. */
export function validEntry(opId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    opId,
    ownerUid: OWNER_UID,
    kind: 'expense',
    status: 'posted',
    bookedAt: '2026-03-15',
    // قاعدة التحديث تفرض unchanged('bookedAtTs')، فغيابه يجعل أي تحديث مشروع يفشل.
    bookedAtTs: 1773532800000,
    periodKey: '2026-03',
    currency: 'LYD',
    schemaVersion: 1,
    description: 'مصروف اختباري',
    tags: [],
    refs: {},
    lines: [
      { accountId: 'expense.food', side: 'debit', amountMinor: 25500, scope: 'personal' },
      { accountId: 'asset.cash', side: 'credit', amountMinor: 25500, scope: 'personal' },
    ],
    accountIds: ['expense.food', 'asset.cash'],
    accountTypes: ['expense', 'asset'],
    totalDebitMinor: 25500,
    totalCreditMinor: 25500,
    amountMinor: 25500,
    payloadHash: 'a'.repeat(64),
    createdAt: 1,
    createdBy: OWNER_UID,
    ...overrides,
  }
}

export function path(uid: string, rest: string): string {
  return `users/${uid}/${rest}`
}
