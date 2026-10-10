/**
 * اختبارات المُخطِّط الموحَّد — قواعد القسم 19 من المتطلبات.
 *
 * التركيز على القواعد التي تُسقط معظم الأنظمة المالية الشخصية:
 * الاقتراض ليس دخلًا، الإقراض ليس مصروفًا، التحويل ليس أيًّا منهما،
 * والسداد الزائد مرفوض.
 */

import { describe, expect, it } from 'vitest'

import { unsafeMinor } from '@/domain/money'
import {
  planOperation,
  type AccountSnapshot,
  type OperationRequest,
  type OpKind,
} from '@/domain/ops/plan'
import { toISODate } from '@/lib/time'

const TODAY = toISODate('2026-03-20')

const acct = (
  accountId: string,
  over: Partial<AccountSnapshot> = {},
): AccountSnapshot => ({
  accountId,
  type: accountId.split('.')[0] as AccountSnapshot['type'],
  balanceMinor: 0,
  minBalanceMinor: 0,
  status: 'active',
  isCashLike: accountId === 'asset.cash' || accountId === 'asset.bank' || accountId === 'asset.wallet',
  ...over,
})

const run = (
  kind: OpKind,
  debit: AccountSnapshot,
  credit: AccountSnapshot,
  over: Partial<OperationRequest> = {},
) =>
  planOperation(
    {
      opId: 'op1',
      kind,
      amountMinor: unsafeMinor(100_000),
      bookedAt: toISODate('2026-03-15'),
      debitAccountId: debit.accountId,
      creditAccountId: credit.accountId,
      description: 'عملية',
      ...over,
    },
    { debit, credit },
    TODAY,
  )

/** أثر العملية على الرصيد، مفهرسًا بالحساب. */
const deltas = (r: ReturnType<typeof run>): Record<string, number> => {
  if (!r.ok) throw new Error('expected ok, got ' + r.error.code)
  return Object.fromEntries(r.plan.deltas.map((d) => [d.accountId, d.balanceDeltaMinor]))
}

describe('القاعدة 19.1/19.2 — المصروف والدخل', () => {
  it('المصروف: ينقص النقد ويزيد المصروف', () => {
    const d = deltas(run('expense', acct('expense.food'), acct('asset.cash', { balanceMinor: 500_000 })))
    expect(d['expense.food']).toBe(100_000)
    expect(d['asset.cash']).toBe(-100_000)
  })

  it('الدخل: يزيد النقد ويزيد الدخل', () => {
    const d = deltas(run('income', acct('asset.cash'), acct('income.salary')))
    expect(d['asset.cash']).toBe(100_000)
    expect(d['income.salary']).toBe(100_000)
  })
})

describe('القاعدة 19.3 — التحويل لا يغيّر إجمالي الأموال', () => {
  it('مجموع أثر الطرفين على الأصول = صفر', () => {
    const d = deltas(
      run('transfer', acct('asset.bank'), acct('asset.cash', { balanceMinor: 500_000 })),
    )
    expect(d['asset.bank']).toBe(100_000)
    expect(d['asset.cash']).toBe(-100_000)
    expect((d['asset.bank'] ?? 0) + (d['asset.cash'] ?? 0)).toBe(0)
  })

  it('لا يمسّ أي حساب دخل أو مصروف — فلا يتضخم أي تقرير', () => {
    const r = run('transfer', acct('asset.bank'), acct('asset.cash', { balanceMinor: 500_000 }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.accountTypes).toEqual(['asset', 'asset'])
    expect(r.plan.accountTypes).not.toContain('income')
    expect(r.plan.accountTypes).not.toContain('expense')
  })
})

describe('القاعدة 19.7 — الاقتراض ليس دخلًا', () => {
  it('يرفع النقد وينشئ خصمًا، بلا أي حساب دخل', () => {
    const r = run('borrow', acct('asset.cash'), acct('liability.payable'))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.accountTypes).toEqual(['asset', 'liability'])
    expect(r.plan.accountTypes).not.toContain('income')
    const d = deltas(r)
    expect(d['asset.cash']).toBe(100_000)
    expect(d['liability.payable']).toBe(100_000) // الخصم يزيد بالدائن
  })

  it('يرفض اقتراضًا مقابل حساب دخل', () => {
    const r = run('borrow', acct('asset.cash'), acct('income.salary'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('WRONG_ACCOUNT_TYPE')
  })
})

describe('القاعدة 19.9 — الإقراض ليس مصروفًا، والمستحق ليس نقدًا', () => {
  it('يحوّل نقدًا إلى مستحق، بلا أي حساب مصروف', () => {
    const r = run('lend', acct('asset.receivable'), acct('asset.cash', { balanceMinor: 500_000 }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.accountTypes).not.toContain('expense')
    const d = deltas(r)
    expect(d['asset.receivable']).toBe(100_000)
    expect(d['asset.cash']).toBe(-100_000)
  })

  it('يرفض الإقراض من حساب غير نقدي', () => {
    const r = run('lend', acct('asset.receivable'), acct('asset.receivable2', { isCashLike: false }))
    expect(r.ok).toBe(false)
  })
})

describe('التحصيل والسداد', () => {
  it('تحصيل دين: يرفع النقد وينقص المستحق', () => {
    const d = deltas(
      run('collectDebt', acct('asset.cash'), acct('asset.receivable', { balanceMinor: 400_000 })),
    )
    expect(d['asset.cash']).toBe(100_000)
    expect(d['asset.receivable']).toBe(-100_000)
  })

  it('سداد دين: ينقص النقد وينقص الخصم، بلا حساب مصروف', () => {
    const r = run(
      'payDebt',
      acct('liability.payable', { balanceMinor: 300_000 }),
      acct('asset.cash', { balanceMinor: 500_000 }),
    )
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.accountTypes).not.toContain('expense')
    const d = deltas(r)
    expect(d['liability.payable']).toBe(-100_000)
    expect(d['asset.cash']).toBe(-100_000)
  })

  it('يرفض السداد الزائد عن المستحق — بلا منطق خاص، حارس الرصيد وحده', () => {
    const r = planOperation(
      {
        opId: 'op1',
        kind: 'payDebt',
        amountMinor: unsafeMinor(500_000),
        bookedAt: toISODate('2026-03-15'),
        debitAccountId: 'liability.payable',
        creditAccountId: 'asset.cash',
        description: 'سداد',
      },
      {
        debit: acct('liability.payable', { balanceMinor: 300_000 }),
        credit: acct('asset.cash', { balanceMinor: 900_000 }),
      },
      TODAY,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('OVERPAYMENT')
      expect(r.error.detail?.['shortfall']).toBe(200_000)
    }
  })

  it('يرفض تحصيلًا يتجاوز المستحق', () => {
    const r = planOperation(
      {
        opId: 'op1',
        kind: 'collectDebt',
        amountMinor: unsafeMinor(500_000),
        bookedAt: toISODate('2026-03-15'),
        debitAccountId: 'asset.cash',
        creditAccountId: 'asset.receivable',
        description: 'تحصيل',
      },
      { debit: acct('asset.cash'), credit: acct('asset.receivable', { balanceMinor: 400_000 }) },
      TODAY,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('OVERPAYMENT')
  })

  it('يسمح بالسداد الكامل بالضبط', () => {
    const r = run(
      'payDebt',
      acct('liability.payable', { balanceMinor: 100_000 }),
      acct('asset.cash', { balanceMinor: 500_000 }),
    )
    expect(r.ok).toBe(true)
  })
})

describe('الرصيد الافتتاحي', () => {
  it('Dr أصل / Cr حقوق ملكية', () => {
    const r = run('opening', acct('asset.cash'), acct('equity.opening'))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.accountTypes).toEqual(['asset', 'equity'])
    const d = deltas(r)
    expect(d['asset.cash']).toBe(100_000)
    expect(d['equity.opening']).toBe(100_000)
  })
})

describe('الثوابت العامة لكل العمليات', () => {
  const cases: [OpKind, string, string][] = [
    ['expense', 'expense.food', 'asset.cash'],
    ['income', 'asset.cash', 'income.salary'],
    ['transfer', 'asset.bank', 'asset.cash'],
    ['borrow', 'asset.cash', 'liability.payable'],
    ['lend', 'asset.receivable', 'asset.cash'],
    ['collectDebt', 'asset.cash', 'asset.receivable'],
    ['payDebt', 'liability.payable', 'asset.cash'],
    ['opening', 'asset.cash', 'equity.opening'],
  ]

  it.each(cases)('%s: التوازن I1 محفوظ', (kind, dId, cId) => {
    const r = run(kind, acct(dId, { balanceMinor: 900_000 }), acct(cId, { balanceMinor: 900_000 }))
    if (!r.ok) throw new Error(`${kind} rejected`)
    expect(r.plan.totalDebitMinor).toBe(r.plan.totalCreditMinor)
    expect(r.plan.lines).toHaveLength(2)
    expect(r.plan.lines[0]?.side).toBe('debit')
    expect(r.plan.lines[1]?.side).toBe('credit')
  })

  it.each(cases)('%s: entryId === opId', (kind, dId, cId) => {
    const r = run(kind, acct(dId, { balanceMinor: 900_000 }), acct(cId, { balanceMinor: 900_000 }))
    if (!r.ok) throw new Error(`${kind} rejected`)
    expect(r.plan.entryId).toBe(r.plan.opId)
  })

  it.each(cases)('%s: categoryId يُملأ على سطر المصروف فقط', (kind, dId, cId) => {
    const r = run(kind, acct(dId, { balanceMinor: 900_000 }), acct(cId, { balanceMinor: 900_000 }))
    if (!r.ok) throw new Error(`${kind} rejected`)
    for (const l of r.plan.lines) {
      if (l.accountType === 'expense') expect(l.categoryId).toBe(l.accountId)
      else expect(l.categoryId).toBeNull()
    }
  })
})

describe('الحوارس المشتركة', () => {
  const bad = (over: Partial<OperationRequest>, code: string): void => {
    const r = run('expense', acct('expense.food'), acct('asset.cash', { balanceMinor: 900_000 }), over)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(code)
  }

  it('مبلغ صفري أو سالب أو كسري', () => {
    bad({ amountMinor: unsafeMinor(0) }, 'AMOUNT_NOT_POSITIVE')
    bad({ amountMinor: unsafeMinor(-5) }, 'AMOUNT_NOT_POSITIVE')
    bad({ amountMinor: unsafeMinor(10.5) }, 'AMOUNT_NOT_POSITIVE')
  })

  it('وصف فارغ', () => {
    bad({ description: '   ' }, 'DESCRIPTION_REQUIRED')
  })

  it('تاريخ مستقبلي', () => {
    bad({ bookedAt: toISODate('2026-03-21') }, 'FUTURE_DATE')
  })

  it('الطرفان نفس الحساب', () => {
    const r = run('transfer', acct('asset.cash'), acct('asset.cash'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('SAME_ACCOUNT')
  })

  it('حساب مؤرشف', () => {
    const r = run('expense', acct('expense.food', { status: 'archived' }), acct('asset.cash', { balanceMinor: 900_000 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ACCOUNT_ARCHIVED')
  })

  it('حساب غير موجود', () => {
    const r = planOperation(
      {
        opId: 'op1',
        kind: 'expense',
        amountMinor: unsafeMinor(1),
        bookedAt: toISODate('2026-03-15'),
        debitAccountId: 'expense.food',
        creditAccountId: 'asset.cash',
        description: 'x',
      },
      { debit: undefined, credit: acct('asset.cash') },
      TODAY,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ACCOUNT_MISSING')
  })

  it('نوع حساب خاطئ للعملية', () => {
    const r = run('expense', acct('asset.bank'), acct('asset.cash', { balanceMinor: 900_000 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('WRONG_ACCOUNT_TYPE')
  })

  it('حساب غير نقدي حيث يلزم النقد', () => {
    const r = run('expense', acct('expense.food'), acct('asset.receivable', { balanceMinor: 900_000, isCashLike: false }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_CASH_ACCOUNT')
  })

  it('رصيد غير كافٍ، مع ذكر العجز', () => {
    const r = run('expense', acct('expense.food'), acct('asset.cash', { balanceMinor: 40_000 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('BALANCE_BELOW_MINIMUM')
      expect(r.error.detail?.['shortfall']).toBe(60_000)
    }
  })

  it('كل الرسائل بالعربية', () => {
    const r = run('expense', acct('expense.food'), acct('asset.cash', { balanceMinor: 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(/[؀-ۿ]/.test(r.error.message)).toBe(true)
  })
})
