/** اختبارات منطق المصروف النقي — القاعدة 19.1 وحوارس القسم 11. */

import { describe, expect, it } from 'vitest'

import { unsafeMinor } from '@/domain/money'
import { planExpense, type AccountSnapshot, type ExpenseRequest } from '@/domain/ops/planExpense'
import { toISODate } from '@/lib/time'

const TODAY = toISODate('2026-03-20')

const cash = (over: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  accountId: 'asset.cash',
  type: 'asset',
  balanceMinor: 100_000,
  minBalanceMinor: 0,
  balanceVersion: 3,
  status: 'active',
  ...over,
})

const food = (over: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  accountId: 'expense.food',
  type: 'expense',
  balanceMinor: 0,
  minBalanceMinor: 0,
  balanceVersion: 0,
  status: 'active',
  ...over,
})

const req = (over: Partial<ExpenseRequest> = {}): ExpenseRequest => ({
  opId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  amountMinor: unsafeMinor(25_500),
  bookedAt: toISODate('2026-03-15'),
  categoryAccountId: 'expense.food',
  fromAccountId: 'asset.cash',
  description: 'غداء',
  scope: 'personal',
  ...over,
})

const plan = (r = req(), from = cash(), category = food()) => planExpense(r, { from, category }, TODAY)

describe('القيد الناتج — القاعدة 19.1', () => {
  it('Dr مصروف / Cr نقد بنفس المبلغ', () => {
    const r = plan()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [debit, credit] = r.plan.lines
    expect(debit).toMatchObject({ accountId: 'expense.food', side: 'debit', amountMinor: 25_500 })
    expect(credit).toMatchObject({ accountId: 'asset.cash', side: 'credit', amountMinor: 25_500 })
  })

  it('الثابت I1: مجموع المدين = مجموع الدائن', () => {
    const r = plan()
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.totalDebitMinor).toBe(r.plan.totalCreditMinor)
    const d = r.plan.lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amountMinor, 0)
    const c = r.plan.lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amountMinor, 0)
    expect(d).toBe(c)
  })

  it('entryId === opId — منع الازدواج (ADR-004)', () => {
    const r = plan()
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.entryId).toBe(r.plan.opId)
  })

  it('periodKey مشتق من bookedAt — ADR-008', () => {
    const r = plan(req({ bookedAt: toISODate('2026-02-28') }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.periodKey).toBe('2026-02')
  })

  it('أثر الرصيد: المصروف يزيد بالمدين والنقد ينقص بالدائن', () => {
    const r = plan()
    if (!r.ok) throw new Error('expected ok')
    const byId = Object.fromEntries(r.plan.deltas.map((d) => [d.accountId, d]))
    expect(byId['expense.food']?.balanceDeltaMinor).toBe(25_500)
    expect(byId['asset.cash']?.balanceDeltaMinor).toBe(-25_500)
  })

  it('الفئة = الحساب على سطر المصروف فقط (§3.7)', () => {
    const r = plan()
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.lines[0]?.categoryId).toBe('expense.food')
    expect(r.plan.lines[1]?.categoryId).toBeNull()
  })

  it('scope يعيش على السطر — أساس منع ازدواج تقرير المنزل', () => {
    const r = plan(req({ scope: 'household' }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.lines.every((l) => l.scope === 'household')).toBe(true)
  })
})

describe('الحوارس', () => {
  const rejects = (code: string, r: ExpenseRequest = req(), from = cash(), category = food()): void => {
    const out = planExpense(r, { from, category }, TODAY)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.code).toBe(code)
  }

  it('يرفض مبلغًا صفريًا أو سالبًا', () => {
    rejects('AMOUNT_NOT_POSITIVE', req({ amountMinor: unsafeMinor(0) }))
    rejects('AMOUNT_NOT_POSITIVE', req({ amountMinor: unsafeMinor(-1) }))
  })

  it('يرفض مبلغًا غير صحيح', () => {
    rejects('AMOUNT_NOT_POSITIVE', req({ amountMinor: unsafeMinor(25.5) }))
  })

  it('يرفض وصفًا فارغًا', () => {
    rejects('DESCRIPTION_REQUIRED', req({ description: '   ' }))
  })

  it('يرفض تاريخًا مستقبليًا', () => {
    rejects('FUTURE_DATE', req({ bookedAt: toISODate('2026-03-21') }))
  })

  it('يقبل تاريخ اليوم', () => {
    const r = plan(req({ bookedAt: TODAY }))
    expect(r.ok).toBe(true)
  })

  it('يرفض فئة ليست حساب مصروف', () => {
    rejects('CATEGORY_NOT_EXPENSE', req({ categoryAccountId: 'asset.bank' }), cash(), {
      ...food(),
      accountId: 'asset.bank',
      type: 'asset',
    })
  })

  it('يرفض مصدرًا ليس أصلًا', () => {
    rejects('SOURCE_NOT_ASSET', req({ fromAccountId: 'income.salary' }), {
      ...cash(),
      accountId: 'income.salary',
      type: 'income',
    })
  })

  it('يرفض حسابًا مؤرشفًا', () => {
    rejects('ACCOUNT_ARCHIVED', req(), cash({ status: 'archived' }))
  })

  it('يرفض حسابًا غير موجود', () => {
    const out = planExpense(req(), { from: undefined, category: food() }, TODAY)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.code).toBe('ACCOUNT_MISSING')
  })

  it('يرفض نفس الحساب في الطرفين', () => {
    rejects('SAME_ACCOUNT', req({ fromAccountId: 'expense.food' }))
  })

  it('يرفض تجاوز الحد الأدنى للرصيد، ويذكر العجز', () => {
    const out = planExpense(
      req({ amountMinor: unsafeMinor(150_000) }),
      { from: cash(), category: food() },
      TODAY,
    )
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.code).toBe('BALANCE_BELOW_MINIMUM')
      expect(out.error.detail?.['shortfall']).toBe(50_000)
    }
  })

  it('يسمح بالسالب إذا سمح حدّ الحساب صراحةً', () => {
    const r = plan(req({ amountMinor: unsafeMinor(150_000) }), cash({ minBalanceMinor: -100_000 }))
    expect(r.ok).toBe(true)
  })

  it('يقبل إنفاق كل الرصيد بالضبط', () => {
    const r = plan(req({ amountMinor: unsafeMinor(100_000) }))
    expect(r.ok).toBe(true)
  })

  it('كل رسائل الأخطاء بالعربية', () => {
    const out = planExpense(req({ amountMinor: unsafeMinor(0) }), { from: cash(), category: food() }, TODAY)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(/[؀-ۿ]/.test(out.error.message)).toBe(true)
  })
})
