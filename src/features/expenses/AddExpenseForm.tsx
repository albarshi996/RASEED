import { useMemo, useState } from 'react'

import { type AccountView } from '@/data/repos/ledgerRepo'
import { formatLYD, PARSE_ERROR_MESSAGES, parseAmountToMinor, unsafeMinor } from '@/domain/money'
import { type ExpenseRequest, type Scope } from '@/domain/ops/planExpense'
import { today, toISODate } from '@/lib/time'
import { nowMs } from '@/lib/time'
import { ulid } from '@/lib/ulid'

interface Props {
  accounts: readonly AccountView[]
  onSubmit: (req: ExpenseRequest) => Promise<string | null>
  busy: boolean
}

/**
 * نموذج تسجيل مصروف.
 *
 * **`opId` يُولَّد مرة واحدة عند فتح النموذج ويُثبَّت** حتى يُحفظ بنجاح.
 * إعادة المحاولة بعد انقطاع ترسل نفس المعرّف، فلا يتضاعف المصروف (ADR-004).
 * بعد النجاح يُولَّد معرّف جديد للمصروف التالي.
 */
export function AddExpenseForm({ accounts, onSubmit, busy }: Props): React.ReactElement {
  const [opId, setOpId] = useState(() => ulid(nowMs()))
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState<string>(() => today())
  const [category, setCategory] = useState('expense.food')
  const [from, setFrom] = useState('asset.cash')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<Scope>('personal')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const categories = useMemo(
    () => accounts.filter((a) => a.type === 'expense' && a.status === 'active'),
    [accounts],
  )
  const sources = useMemo(() => accounts.filter((a) => a.isCashLike && a.status === 'active'), [accounts])
  const parsed = useMemo(() => parseAmountToMinor(amount), [amount])
  const sourceBalance = accounts.find((a) => a.accountId === from)?.balanceMinor ?? 0

  async function handleSubmit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setDone(null)

    if (!parsed.ok) {
      setError(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    const message = await onSubmit({
      opId,
      amountMinor: parsed.value,
      bookedAt: toISODate(date),
      categoryAccountId: category,
      fromAccountId: from,
      description,
      scope,
    })
    if (message !== null) {
      setError(message)
      return
    }
    setDone(`سُجِّل ${formatLYD(parsed.value)}`)
    setAmount('')
    setDescription('')
    setOpId(ulid(nowMs())) // معرّف جديد للعملية التالية
  }

  const field = 'w-full rounded-xl border px-3 py-2.5 text-sm outline-none'
  const fieldStyle = {
    background: 'var(--surface-page)',
    borderColor: 'var(--border-subtle)',
    color: 'var(--text-primary)',
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
    >
      <h2 className="mb-4 text-base font-bold">تسجيل مصروف</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            المبلغ (د.ل)
          </span>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
            }}
            inputMode="decimal"
            placeholder="25.500"
            dir="ltr"
            className={`${field} tabular text-start text-lg font-semibold`}
            style={fieldStyle}
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            الفئة
          </span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
            }}
            className={field}
            style={fieldStyle}
          >
            {categories.map((c) => (
              <option key={c.accountId} value={c.accountId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            الدفع من
          </span>
          <select
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
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
            التاريخ
          </span>
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => {
              setDate(e.target.value)
            }}
            dir="ltr"
            className={`${field} text-start`}
            style={fieldStyle}
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            النوع
          </span>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope)
            }}
            className={field}
            style={fieldStyle}
          >
            <option value="personal">شخصي</option>
            <option value="household">منزلي</option>
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            الوصف
          </span>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
            }}
            placeholder="غداء، بنزين، فاتورة…"
            className={field}
            style={fieldStyle}
            required
          />
        </label>
      </div>

      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        رصيد {accounts.find((a) => a.accountId === from)?.name ?? ''}:{' '}
        <span data-money className="font-medium">
          {formatLYD(unsafeMinor(sourceBalance))}
        </span>
      </p>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60"
        style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
      >
        {busy ? 'جارٍ الحفظ…' : 'حفظ المصروف'}
      </button>

      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-lg border p-3 text-xs leading-relaxed"
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
    </form>
  )
}
