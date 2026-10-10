/**
 * اختبار تكامل حقيقي على المحاكي: من البذر إلى رصيد صحيح.
 *
 * هذا هو الاختبار الذي يثبت أن النظام **يعمل فعلًا** لا أنه مكتوب فقط:
 * يُنشئ الحسابات، يسجّل مصاريف عبر مسار الكتابة الحقيقي `postExpense`،
 * ثم يتحقق من الأرصدة والمجمَّعات وميزان المراجعة.
 */

import { type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { postExpense } from '@/data/ledger/postExpense'
import { ensureSeedAccounts } from '@/data/repos/ledgerRepo'
import { SEED_ACCOUNTS } from '@/domain/ledger/chartOfAccounts'
import { unsafeMinor } from '@/domain/money'
import { toISODate } from '@/lib/time'

import { makeTestEnv, OWNER_UID } from './helpers'

let env: RulesTestEnvironment
let db: Firestore

beforeAll(async () => {
  env = await makeTestEnv('raseed-flow-test')
  db = env.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await ensureSeedAccounts(OWNER_UID, db)
})

const balanceOf = async (id: string): Promise<number> => {
  const s = await getDoc(doc(db, `users/${OWNER_UID}/accounts/${id}`))
  return (s.data()?.['balanceMinor'] as number | undefined) ?? NaN
}

const expense = (over: Record<string, unknown> = {}) => ({
  opId: `op-${String(Math.abs(Date.now() % 1e9))}-${String(Object.keys(over).length)}`,
  amountMinor: unsafeMinor(25_500),
  bookedAt: toISODate('2026-03-15'),
  categoryAccountId: 'expense.food',
  fromAccountId: 'asset.cash',
  description: 'غداء',
  scope: 'personal' as const,
  ...over,
})

describe('البذر', () => {
  it('ينشئ كل حسابات شجرة الحسابات بأرصدة صفرية', async () => {
    const snap = await getDocs(collection(db, `users/${OWNER_UID}/accounts`))
    expect(snap.size).toBe(SEED_ACCOUNTS.length)
    expect(await balanceOf('asset.cash')).toBe(0)
  })

  it('عديم التكرار — إعادة التشغيل لا تُنشئ نسخًا', async () => {
    await ensureSeedAccounts(OWNER_UID, db)
    await ensureSeedAccounts(OWNER_UID, db)
    const snap = await getDocs(collection(db, `users/${OWNER_UID}/accounts`))
    expect(snap.size).toBe(SEED_ACCOUNTS.length)
  })
})

describe('تسجيل مصروف — الأثر الكامل', () => {
  it('يرفض أول مصروف لعدم كفاية الرصيد (الحسابات تبدأ صفرًا)', async () => {
    const res = await postExpense(OWNER_UID, expense(), db)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('BALANCE_BELOW_MINIMUM')
  })

  it('بعد السماح بالسالب: يخفض النقد ويرفع المصروف بنفس المبلغ', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc: d, updateDoc } = await import('firebase/firestore')
      await updateDoc(d(ctx.firestore(), `users/${OWNER_UID}/accounts/asset.cash`), {
        minBalanceMinor: -1_000_000,
      })
    })

    const res = await postExpense(OWNER_UID, expense(), db)
    expect(res.ok).toBe(true)

    expect(await balanceOf('asset.cash')).toBe(-25_500)
    expect(await balanceOf('expense.food')).toBe(25_500)
  })

  it('مصروفان يتراكمان بدقة — لا ضياع وحدات', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc: d, updateDoc } = await import('firebase/firestore')
      await updateDoc(d(ctx.firestore(), `users/${OWNER_UID}/accounts/asset.cash`), {
        minBalanceMinor: -1_000_000,
      })
    })

    await postExpense(OWNER_UID, expense({ opId: 'e1', amountMinor: unsafeMinor(25_500) }), db)
    await postExpense(OWNER_UID, expense({ opId: 'e2', amountMinor: unsafeMinor(1_750) }), db)

    expect(await balanceOf('asset.cash')).toBe(-27_250)
    expect(await balanceOf('expense.food')).toBe(27_250)
  })

  it('منع الازدواج: نفس opId مرتين لا يسجّل العملية مرتين', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc: d, updateDoc } = await import('firebase/firestore')
      await updateDoc(d(ctx.firestore(), `users/${OWNER_UID}/accounts/asset.cash`), {
        minBalanceMinor: -1_000_000,
      })
    })

    const req = expense({ opId: 'duplicate-op' })
    const first = await postExpense(OWNER_UID, req, db)
    const second = await postExpense(OWNER_UID, req, db)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('DUPLICATE')

    // الأثر مرة واحدة فقط — هذا هو بيت القصيد
    expect(await balanceOf('asset.cash')).toBe(-25_500)
    const entries = await getDocs(collection(db, `users/${OWNER_UID}/journalEntries`))
    expect(entries.size).toBe(1)
  })

  it('يكتب سطري postings ومجمَّعَي الفترة', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc: d, updateDoc } = await import('firebase/firestore')
      await updateDoc(d(ctx.firestore(), `users/${OWNER_UID}/accounts/asset.cash`), {
        minBalanceMinor: -1_000_000,
      })
    })
    await postExpense(OWNER_UID, expense({ opId: 'p1' }), db)

    const postings = await getDocs(collection(db, `users/${OWNER_UID}/postings`))
    expect(postings.size).toBe(2)

    const cashPeriod = await getDoc(doc(db, `users/${OWNER_UID}/accountPeriods/asset.cash__2026-03`))
    expect(cashPeriod.data()?.['creditMinor']).toBe(25_500)
    expect(cashPeriod.data()?.['netMinor']).toBe(-25_500)
  })

  it('ميزان المراجعة متوازن: Σ مدين = Σ دائن عبر كل الحسابات', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc: d, updateDoc } = await import('firebase/firestore')
      await updateDoc(d(ctx.firestore(), `users/${OWNER_UID}/accounts/asset.cash`), {
        minBalanceMinor: -1_000_000,
      })
    })
    await postExpense(OWNER_UID, expense({ opId: 't1', amountMinor: unsafeMinor(12_345) }), db)
    await postExpense(OWNER_UID, expense({ opId: 't2', amountMinor: unsafeMinor(999) }), db)
    await postExpense(
      OWNER_UID,
      expense({ opId: 't3', amountMinor: unsafeMinor(7), categoryAccountId: 'expense.transport' }),
      db,
    )

    const snap = await getDocs(collection(db, `users/${OWNER_UID}/accounts`))
    let debit = 0
    let credit = 0
    snap.forEach((d) => {
      debit += (d.data()['debitTotalMinor'] as number | undefined) ?? 0
      credit += (d.data()['creditTotalMinor'] as number | undefined) ?? 0
    })
    expect(debit).toBe(credit)
    expect(debit).toBe(12_345 + 999 + 7)
  })

  it('الرصيد = مجموع الحركات: لا انحراف بين المجمَّع والقيود', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc: d, updateDoc } = await import('firebase/firestore')
      await updateDoc(d(ctx.firestore(), `users/${OWNER_UID}/accounts/asset.cash`), {
        minBalanceMinor: -1_000_000,
      })
    })
    const amounts = [25_500, 1_750, 333, 10_000]
    for (const [i, a] of amounts.entries()) {
      await postExpense(OWNER_UID, expense({ opId: `b${String(i)}`, amountMinor: unsafeMinor(a) }), db)
    }

    const postings = await getDocs(collection(db, `users/${OWNER_UID}/postings`))
    let cashMovement = 0
    postings.forEach((p) => {
      if (p.data()['accountId'] === 'asset.cash') {
        cashMovement += p.data()['signedAmountMinor'] as number
      }
    })

    expect(await balanceOf('asset.cash')).toBe(cashMovement)
    expect(cashMovement).toBe(-amounts.reduce((s, x) => s + x, 0))
  })
})

describe('الرصيد الافتتاحي ثم الإنفاق — الرحلة الكاملة كما سيعيشها المالك', () => {
  it('يضيف رصيدًا افتتاحيًا ثم يسجّل مصاريف، والأرصدة تصحّ في كل خطوة', async () => {
    const { postOpeningBalance } = await import('@/data/ledger/postOpeningBalance')

    // 1) الرصيد الافتتاحي: Dr نقد / Cr حقوق ملكية
    const open = await postOpeningBalance(
      OWNER_UID,
      {
        opId: 'open-1',
        accountId: 'asset.cash',
        amountMinor: unsafeMinor(1_000_000),
        bookedAt: toISODate('2026-03-01'),
      },
      db,
    )
    expect(open.ok).toBe(true)
    expect(await balanceOf('asset.cash')).toBe(1_000_000)
    expect(await balanceOf('equity.opening')).toBe(1_000_000)

    // 2) مصروف عادي — يُقبل الآن لأن الرصيد يكفي
    const e1 = await postExpense(OWNER_UID, expense({ opId: 'x1', amountMinor: unsafeMinor(25_500) }), db)
    expect(e1.ok).toBe(true)
    expect(await balanceOf('asset.cash')).toBe(974_500)

    // 3) مصروف بكسور — لا ضياع وحدات
    await postExpense(
      OWNER_UID,
      expense({ opId: 'x2', amountMinor: unsafeMinor(1_750), categoryAccountId: 'expense.transport' }),
      db,
    )
    expect(await balanceOf('asset.cash')).toBe(972_750)
    expect(await balanceOf('expense.transport')).toBe(1_750)

    // 4) محاولة إنفاق أكثر من المتاح — مرفوضة ولا أثر لها
    const tooMuch = await postExpense(
      OWNER_UID,
      expense({ opId: 'x3', amountMinor: unsafeMinor(5_000_000) }),
      db,
    )
    expect(tooMuch.ok).toBe(false)
    expect(await balanceOf('asset.cash')).toBe(972_750)

    // 5) ميزان المراجعة ما زال متوازنًا بعد كل ذلك
    const snap = await getDocs(collection(db, `users/${OWNER_UID}/accounts`))
    let debit = 0
    let credit = 0
    snap.forEach((d) => {
      debit += (d.data()['debitTotalMinor'] as number | undefined) ?? 0
      credit += (d.data()['creditTotalMinor'] as number | undefined) ?? 0
    })
    expect(debit).toBe(credit)

    // 6) النقد المتاح = الافتتاحي − المصروفات
    expect(972_750).toBe(1_000_000 - 25_500 - 1_750)
  })
})
