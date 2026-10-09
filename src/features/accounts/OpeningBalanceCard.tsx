import { useMemo, useState } from 'react'

import { postOpeningBalance } from '@/data/ledger/postOpeningBalance'
import { type AccountView } from '@/data/repos/ledgerRepo'
import { formatLYD, PARSE_ERROR_MESSAGES, parseAmountToMinor, unsafeMinor } from '@/domain/money'
import { nowMs, today, toISODate } from '@/lib/time'
import { ulid } from '@/lib/ulid'

/**
 * إدخال الرصيد الافتتاحي.
 *
 * تظهر هذه البطاقة عندما تكون كل الحسابات النقدية صفرًا، لأن النظام بلا رصيد
 * افتتاحي يرفض **كل** مصروف بحجّة عدم كفاية الرصيد — وهو رفض صحيح محاسبيًا
 * لكنه يبدو عطلًا للمستخدم. فالأولى أن نطلب الرصيد صراحةً.
 */
export function OpeningBalanceCard({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const sources = useMemo(() => accounts.filter((a) => a.isCashLike && a.status === 'active'), [accounts])
  const [accountId, setAccountId] = useState(sources[0]?.accountId ?? 'asset.cash')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function submit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setDone(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setError(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    const res = await postOpeningBalance(uid, {
      opId: ulid(nowMs()),
      accountId,
      amountMinor: parsed.value,
      bookedAt: toISODate(today()),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setDone(`أُضيف رصيد افتتاحي ${formatLYD(parsed.value)}`)
    setAmount('')
  }

  const field = 'w-full rounded-xl border px-3 py-2.5 text-sm outline-none'
  const fieldStyle = {
    background: 'var(--surface-page)',
    borderColor: 'var(--border-subtle)',
    color: 'var(--text-primary)',
  }

  return (
    <form
      onSubmit={(e) => {
        void submit(e)
      }}
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
    >
      <h2 className="text-base font-bold">الرصيد الافتتاحي</h2>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        كم معك الآن فعلًا؟ يُسجَّل كقيد متوازن مقابل «الرصيد الافتتاحي» لا كرقم حرّ، حتى يبقى كل دينار في
        النظام له مصدر مُسجَّل.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            الحساب
          </span>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value)
            }}
            className={field}
            style={fieldStyle}
          >
            {sources.map((s) => (
              <option key={s.accountId} value={s.accountId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            المبلغ (د.ل)
          </span>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
            }}
            inputMode="decimal"
            placeholder="1000.000"
            dir="ltr"
            className={`${field} tabular text-start`}
            style={fieldStyle}
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
        {busy ? 'جارٍ الحفظ…' : 'إضافة الرصيد الافتتاحي'}
      </button>

      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-lg border p-3 text-xs"
          style={{
            background: 'var(--fin-expense-bg)',
            borderColor: 'var(--fin-expense-border)',
            color: 'var(--fin-expense)',
          }}
        >
          {error}
        </p>
      )}
      {done !== null && (
        <p
          role="status"
          className="mt-3 rounded-lg border p-3 text-xs"
          style={{
            background: 'var(--fin-income-bg)',
            borderColor: 'var(--fin-income-border)',
            color: 'var(--fin-income)',
          }}
        >
          {done}
        </p>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        يمكنك إضافة رصيد لأي حساب في أي وقت — لا يقتصر على البداية.
      </p>
    </form>
  )
}

export { unsafeMinor }
