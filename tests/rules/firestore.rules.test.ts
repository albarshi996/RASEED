/**
 * اختبارات قواعد أمان Firestore — القسم 20.3 من عقد النواة، والقسم 23 بندَي 7 و8 من المتطلبات.
 *
 * **لماذا هذه الاختبارات ليست اختيارية:** قواعد Firestore تُجمَع بـ OR لا AND، ولا توجد فيها
 * قاعدة مقيِّدة. خطأ أسبقية واحد (`&&` تربط أقوى من `||`) يفتح الدفتر كله للإنترنت،
 * **ولا يظهر في أي اختبار «هل يعمل التطبيق؟»** لأن التطبيق يسلك دائمًا الفرع الصحيح.
 * القاعدة 10 في القسم 25: القواعد ليست جاهزة لمجرد كتابتها.
 */

import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

import { INTRUDER_UID, OTHER_UID, OWNER_UID, makeTestEnv, validEntry } from './helpers'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await makeTestEnv()
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

const owner = () => env.authenticatedContext(OWNER_UID).firestore()
const intruder = () => env.authenticatedContext(INTRUDER_UID).firestore()
const anon = () => env.unauthenticatedContext().firestore()

describe('ق-2 — النظام مغلق على UID معتمد', () => {
  it('غير المسجَّل لا يقرأ شيئًا', async () => {
    await assertFails(getDoc(doc(anon(), `users/${OWNER_UID}/accounts/asset.cash`)))
  })

  it('غير المسجَّل لا يكتب شيئًا', async () => {
    await assertFails(setDoc(doc(anon(), `users/${OWNER_UID}/settings/general`), { a: 1 }))
  })

  it('حساب Google صالح لكن غير معتمد لا يقرأ بيانات المالك', async () => {
    await assertFails(getDoc(doc(intruder(), `users/${OWNER_UID}/accounts/asset.cash`)))
  })

  it('حساب غير معتمد لا يكتب في بيانات المالك', async () => {
    await assertFails(setDoc(doc(intruder(), `users/${OWNER_UID}/settings/general`), { a: 1 }))
  })

  it('حساب غير معتمد لا يكتب حتى في نطاقه هو — الإغلاق على UID لا على المسار', async () => {
    await assertFails(setDoc(doc(intruder(), `users/${INTRUDER_UID}/settings/general`), { a: 1 }))
  })

  it('المالك لا يقرأ نطاق مستخدم آخر', async () => {
    await assertFails(getDoc(doc(owner(), `users/${OTHER_UID}/accounts/asset.cash`)))
  })

  it('المالك يقرأ نطاقه', async () => {
    await assertSucceeds(getDoc(doc(owner(), `users/${OWNER_UID}/settings/general`)))
  })

  it('المالك يكتب إعداداته', async () => {
    await assertSucceeds(setDoc(doc(owner(), `users/${OWNER_UID}/settings/general`), { theme: 'dark' }))
  })
})

describe('journalEntries — القيود تُنشأ ولا تُمسّ محاسبيًا', () => {
  it('ينشئ قيدًا متوازنًا صالحًا', async () => {
    await assertSucceeds(setDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/op1`), validEntry('op1')))
  })

  it('يرفض قيدًا غير متوازن — I1 مفروض من الخادم لا من العميل', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op2`),
        validEntry('op2', { totalCreditMinor: 20000 }),
      ),
    )
  })

  it('يرفض معرّف مستند لا يساوي opId — منع الازدواج خصيصة في المفتاح', async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/WRONG`), validEntry('op3')))
  })

  it('يرفض periodKey لا يطابق bookedAt — I18 / ADR-008', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op4`),
        validEntry('op4', { periodKey: '2026-04' }),
      ),
    )
  })

  it('يرفض مبلغًا سالبًا', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op5`),
        validEntry('op5', { totalDebitMinor: -1, totalCreditMinor: -1, amountMinor: -1 }),
      ),
    )
  })

  it('يرفض مبلغًا غير صحيح (كسر عشري)', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op6`),
        validEntry('op6', { totalDebitMinor: 25.5, totalCreditMinor: 25.5, amountMinor: 25.5 }),
      ),
    )
  })

  it('يرفض قيدًا بسطر واحد — لا قيد بلا طرفين', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op7`),
        validEntry('op7', {
          lines: [{ accountId: 'asset.cash', side: 'debit', amountMinor: 25500, scope: 'personal' }],
          accountIds: ['asset.cash'],
        }),
      ),
    )
  })

  it('يرفض عملة غير LYD', async () => {
    await assertFails(
      setDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/op8`), validEntry('op8', { currency: 'USD' })),
    )
  })

  it('يرفض ownerUid مزوَّرًا', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op9`),
        validEntry('op9', { ownerUid: OTHER_UID }),
      ),
    )
  })

  it('يرفض payloadHash بطول خاطئ', async () => {
    await assertFails(
      setDoc(
        doc(owner(), `users/${OWNER_UID}/journalEntries/op10`),
        validEntry('op10', { payloadHash: 'short' }),
      ),
    )
  })

  it('يرفض وصفًا فارغًا', async () => {
    await assertFails(
      setDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/op11`), validEntry('op11', { description: '' })),
    )
  })

  it('يرفض حالة غير posted عند الإنشاء', async () => {
    await assertFails(
      setDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/op12`), validEntry('op12', { status: 'draft' })),
    )
  })
})

describe('journalEntries — عدم القابلية للتعديل المحاسبي', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER_UID}/journalEntries/base`), validEntry('base'))
    })
  })

  it('يرفض تعديل المبلغ', async () => {
    await assertFails(updateDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/base`), { amountMinor: 1 }))
  })

  it('يرفض تعديل السطور', async () => {
    await assertFails(updateDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/base`), { lines: [] }))
  })

  it('يرفض تعديل التاريخ', async () => {
    await assertFails(
      updateDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/base`), { bookedAt: '2026-01-01' }),
    )
  })

  it('يرفض تعديل opId', async () => {
    await assertFails(updateDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/base`), { opId: 'other' }))
  })

  it('يسمح بتعديل الوصف والوسوم — بيانات وصفية لا محاسبية', async () => {
    await assertSucceeds(
      updateDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/base`), {
        description: 'وصف محدَّث',
        tags: ['طعام'],
      }),
    )
  })

  it('يرفض حذف قيد — لا حذف مالي أبدًا (ADR-006)', async () => {
    await assertFails(deleteDoc(doc(owner(), `users/${OWNER_UID}/journalEntries/base`)))
  })
})

describe('auditLogs — سجل التدقيق لا يُمسّ', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER_UID}/auditLogs/log1`), {
        ownerUid: OWNER_UID,
        action: 'test',
        at: 1,
      })
    })
  })

  it('المالك يقرأ سجل التدقيق', async () => {
    await assertSucceeds(getDoc(doc(owner(), `users/${OWNER_UID}/auditLogs/log1`)))
  })

  it('يرفض تعديل سجل تدقيق', async () => {
    await assertFails(updateDoc(doc(owner(), `users/${OWNER_UID}/auditLogs/log1`), { action: 'tampered' }))
  })

  it('يرفض حذف سجل تدقيق', async () => {
    await assertFails(deleteDoc(doc(owner(), `users/${OWNER_UID}/auditLogs/log1`)))
  })
})

describe('الحذف ممنوع حيث يجب', () => {
  it('لا حذف فئة — الأرشفة بدل الحذف', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER_UID}/categories/c1`), {
        ownerUid: OWNER_UID,
        name: 'طعام',
      })
    })
    await assertFails(deleteDoc(doc(owner(), `users/${OWNER_UID}/categories/c1`)))
  })

  it('لا حذف جهة اتصال', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER_UID}/contacts/p1`), {
        ownerUid: OWNER_UID,
        name: 'أحمد',
      })
    })
    await assertFails(deleteDoc(doc(owner(), `users/${OWNER_UID}/contacts/p1`)))
  })
})

describe('الحرّاسة الختامية — ما لم يُعدّ مرفوض', () => {
  it('مجموعة غير معرَّفة مرفوضة حتى للمالك', async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER_UID}/someUndeclaredCollection/x`), { a: 1 }))
  })

  it('مسار جذري خارج users مرفوض تمامًا', async () => {
    await assertFails(setDoc(doc(owner(), 'randomRoot/x'), { a: 1 }))
    await assertFails(getDoc(doc(owner(), 'randomRoot/x')))
  })
})

describe('عزل البيانات — استعلامات المجموعات', () => {
  it('المالك لا يسرد مجموعة مستخدم آخر', async () => {
    await assertFails(getDocs(collection(owner(), `users/${OTHER_UID}/journalEntries`)))
  })

  it('المتطفّل لا يسرد قيود المالك', async () => {
    await assertFails(getDocs(collection(intruder(), `users/${OWNER_UID}/journalEntries`)))
  })
})
