import { useMemo, useState } from 'react'

import { postOperation } from '@/data/ledger/postOperation'
import { type AccountView } from '@/data/repos/ledgerRepo'
import { computeSummary } from '@/data/repos/summary'
import { formatLYD, PARSE_ERROR_MESSAGES, parseAmountToMinor, unsafeMinor } from '@/domain/money'
import { type AccountType } from '@/domain/ledger/chartOfAccounts'
import { nowMs, today, toISODate } from '@/lib/time'
import { ulid } from '@/lib/ulid'

import { Card, Lbl } from '@/ui/components/primitives'
import { PageHeader } from '@/ui/components/primitives'

const TYPE_AR: Record<AccountType, string> = {
  asset: 'الأصول',
  liability: 'الخصوم',
  income: 'الدخل',
  expense: 'المصروفات',
  equity: 'حقوق الملكية',
}

const TYPE_ORDER: readonly AccountType[] = ['asset', 'liability', 'income', 'expense', 'equity']

/**
 * شاشة الحسابات — شجرة الحسابات بأرصدتها، وإضافة رصيد لأي حساب نقدي.
 *
 * تُعرض أرصدة كل الأنواع بما فيها الدخل والمصروف، لأنها **ميزان مراجعة مصغّر**:
 * لو انحرف الرصيد عن الحركات يظهر الخلل هنا قبل أن يظهر في أي تقرير.
 */
export function AccountsScreen({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const grouped = useMemo(() => {
    const map = new Map<AccountType, AccountView[]>()
    for (const t of TYPE_ORDER) map.set(t, [])
    for (const a of accounts) map.get(a.type)?.push(a)
    return map
  }, [accounts])

  const s = computeSummary(accounts)
  const trialDebit = accounts
    .filter((a) => a.type === 'asset' || a.type === 'expense')
    .reduce((x, a) => x + a.balanceMinor, 0)
  const trialCredit = accounts
    .filter((a) => a.type === 'liability' || a.type === 'income' || a.type === 'equity')
    .reduce((x, a) => x + a.balanceMinor, 0)
  const balanced = trialDebit === trialCredit

  return (
    <>
      <PageHeader
        title="الحسابات"
        description="شجرة الحسابات بأرصدتها، وميزان مراجعة حيّ يكشف أي انحراف بين الرصيد والحركات."
      />
      <div className="space-y-5">
      <AddFundsCard uid={uid} accounts={accounts} />

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">ميزان المراجعة</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              مجموع الأصول والمصروفات مقابل الخصوم والدخل وحقوق الملكية
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: balanced ? 'var(--fin-income-bg)' : 'var(--fin-expense-bg)',
              color: balanced ? 'var(--fin-income)' : 'var(--fin-expense)',
            }}
          >
            {balanced ? '✓ متوازن' : '✗ منحرف'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              مدين
            </p>
            <p data-money className="font-semibold">
              {formatLYD(unsafeMinor(trialDebit))}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              دائن
            </p>
            <p data-money className="font-semibold">
              {formatLYD(unsafeMinor(trialCredit))}
            </p>
          </div>
        </div>
        {!balanced && (
          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--fin-expense)' }}>
            انحراف قدره <span data-money>{formatLYD(unsafeMinor(trialDebit - trialCredit))}</span>.
            هذا يعني خللًا في البيانات لا في العرض — أبلغني فورًا.
          </p>
        )}
      </Card>

      <Card>
        <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
          الأموال المتاحة
        </p>
        <p data-money className="mt-1.5 text-2xl font-bold" style={{ color: 'var(--accent)' }}>
          {formatLYD(unsafeMinor(s.availableCashMinor))}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          الحسابات النقدية النشطة فقط. المستحق لك عند الآخرين
          (<span data-money>{formatLYD(unsafeMinor(s.receivablesMinor))}</span>) مستثنى عمدًا —
          ليس مالًا في يدك.
        </p>
      </Card>

      {TYPE_ORDER.map((t) => {
        const list = (grouped.get(t) ?? []).filter((a) => a.status === 'active')
        if (list.length === 0) return null
        const total = list.reduce((x, a) => x + a.balanceMinor, 0)
        return (
          <section key={t}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-bold">{TYPE_AR[t]}</h2>
              <span data-money className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                {formatLYD(unsafeMinor(total))}
              </span>
            </div>
            <Card>
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {list.map((a) => (
                  <li key={a.accountId} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{a.name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--muted)' }} dir="ltr">
                        {a.accountId}
                      </p>
                    </div>
                    <span
                      data-money
                      className="shrink-0 text-sm font-semibold"
                      style={{ color: a.balanceMinor === 0 ? 'var(--muted)' : 'var(--ink)' }}
                    >
                      {formatLYD(unsafeMinor(a.balanceMinor))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )
      })}
      </div>
    </>
  )
}

function AddFundsCard({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const cash = accounts.filter((a) => a.isCashLike && a.status === 'active')
  const [accountId, setAccountId] = useState(cash[0]?.accountId ?? 'asset.cash')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault()
    setMsg(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setMsg({ ok: false, text: PARSE_ERROR_MESSAGES[parsed.code] })
      return
    }
    setBusy(true)
    const res = await postOperation(uid, {
      opId: ulid(nowMs()),
      kind: 'opening',
      amountMinor: parsed.value,
      bookedAt: toISODate(today()),
      debitAccountId: accountId,
      creditAccountId: 'equity.opening',
      description: 'رصيد افتتاحي',
    })
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: res.error.message })
      return
    }
    setMsg({ ok: true, text: `أُضيف ${formatLYD(parsed.value)}` })
    setAmount('')
  }

  const field = 'w-full rounded-xl border px-3 py-2.5 text-sm outline-none'
  const fs = { background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }

  return (
    <form onSubmit={(e) => { void submit(e) }}>
      <Card>
        <h2 className="text-base font-bold">إضافة رصيد</h2>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          يُسجَّل كقيد متوازن مقابل «الرصيد الافتتاحي»، فيبقى لكل دينار في النظام مصدر مُسجَّل.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <Lbl>الحساب</Lbl>
            <select
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value) }}
              className={field}
              style={fs}
            >
              {cash.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Lbl>المبلغ (د.ل)</Lbl>
            <input
              value={amount}
              onChange={(e) => { setAmount(e.target.value) }}
              inputMode="decimal"
              placeholder="1000.000"
              dir="ltr"
              className={`${field} tabular text-start`}
              style={fs}
              required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
        >
          {busy ? 'جارٍ الحفظ…' : 'إضافة'}
        </button>
        {msg !== null && (
          <p
            className="mt-3 text-xs"
            style={{ color: msg.ok ? 'var(--fin-income)' : 'var(--fin-expense)' }}
          >
            {msg.text}
          </p>
        )}
      </Card>
    </form>
  )
}
