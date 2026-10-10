import { useEffect, useMemo, useState } from 'react'

import { postOperation } from '@/data/ledger/postOperation'
import {
  createDebt,
  observeDebts,
  type DebtDirection,
  type DebtView,
} from '@/data/repos/commitmentsRepo'
import { type AccountView } from '@/data/repos/ledgerRepo'
import { formatLYD, PARSE_ERROR_MESSAGES, parseAmountToMinor, unsafeMinor } from '@/domain/money'
import { nowMs, today, toISODate } from '@/lib/time'
import { ulid } from '@/lib/ulid'

/**
 * شاشة الديون — ما عليّ وما لي.
 *
 * الدين كيان بعلاقته (اسم الطرف، تاريخ الاستحقاق، المتبقي)، والدفعات عليه
 * **ليست مجموعة منفصلة** بل قيود في الدفتر تحمل `refs.debtId`. فلا يوجد سجلّان
 * يمكن أن ينحرف أحدهما عن الآخر.
 */
export function DebtsScreen({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [debts, setDebts] = useState<DebtView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DebtDirection>('payable')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    return observeDebts(
      uid,
      (rows) => { setDebts(rows) },
      () => { setError('تعذّر تحميل الديون.') },
    )
  }, [uid])

  const rows = useMemo(
    () => (debts ?? []).filter((d) => d.direction === tab && d.status !== 'cancelled'),
    [debts, tab],
  )
  const openTotal = rows.filter((d) => d.status === 'open').reduce((s, d) => s + d.remainingMinor, 0)

  if (error !== null) return <ErrorBox message={error} />
  if (debts === null) return <Loading />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {([
          ['payable', 'عليّ', 'var(--fin-owed)'],
          ['receivable', 'لي', 'var(--fin-receivable)'],
        ] as const).map(([k, label, color]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTab(k) }}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{
              background: tab === k ? color : 'transparent',
              borderColor: tab === k ? color : 'var(--line-strong)',
              color: tab === k ? '#fff' : 'var(--ink-2)',
            }}
          >
            ديون {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v) }}
          className="ms-auto rounded-xl px-4 py-2 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {showForm ? 'إغلاق' : '+ دين جديد'}
        </button>
      </div>

      <Card>
        <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
          إجمالي المتبقي {tab === 'payable' ? 'عليّ' : 'لي'}
        </p>
        <p
          data-money
          className="mt-1.5 text-2xl font-bold"
          style={{ color: tab === 'payable' ? 'var(--fin-owed)' : 'var(--fin-receivable)' }}
        >
          {formatLYD(unsafeMinor(openTotal))}
        </p>
      </Card>

      {showForm && (
        <NewDebtForm
          uid={uid}
          accounts={accounts}
          direction={tab}
          onDone={() => { setShowForm(false) }}
        />
      )}

      {rows.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
            لا توجد ديون {tab === 'payable' ? 'عليك' : 'لك'}.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((d) => (
            <DebtCard key={d.id} uid={uid} debt={d} accounts={accounts} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DebtCard({
  uid,
  debt,
  accounts,
}: {
  uid: string
  debt: DebtView
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')
  const [cashId, setCashId] = useState('asset.cash')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const pct = debt.principalMinor === 0 ? 0 : (debt.settledMinor / debt.principalMinor) * 100
  const settled = debt.status === 'settled'
  const cashAccounts = accounts.filter((a) => a.isCashLike && a.status === 'active')
  const overdue = debt.dueDate !== null && debt.dueDate < today() && !settled

  async function pay(): Promise<void> {
    setMsg(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setMsg(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    const isPayable = debt.direction === 'payable'
    const res = await postOperation(uid, {
      opId: ulid(nowMs()),
      kind: isPayable ? 'payDebt' : 'collectDebt',
      amountMinor: parsed.value,
      bookedAt: toISODate(today()),
      debitAccountId: isPayable ? 'liability.payable' : cashId,
      creditAccountId: isPayable ? cashId : 'asset.receivable',
      description: `${isPayable ? 'سداد' : 'تحصيل'} — ${debt.counterpartyName}`,
      counterpartyName: debt.counterpartyName,
      settlement: { kind: 'debt', id: debt.id },
    })
    setBusy(false)
    if (!res.ok) {
      setMsg(res.error.message)
      return
    }
    setAmount('')
    setPaying(false)
  }

  return (
    <li>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{debt.counterpartyName}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              <span dir="ltr">{debt.startedAt}</span>
              {debt.dueDate !== null && (
                <>
                  {' · يستحق '}
                  <span dir="ltr" style={overdue ? { color: 'var(--fin-expense)', fontWeight: 600 } : undefined}>
                    {debt.dueDate}
                  </span>
                  {overdue && ' (متأخر)'}
                </>
              )}
            </p>
          </div>
          <div className="shrink-0 text-end">
            <p
              data-money
              className="font-bold"
              style={{ color: debt.direction === 'payable' ? 'var(--fin-owed)' : 'var(--fin-receivable)' }}
            >
              {formatLYD(unsafeMinor(debt.remainingMinor))}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
              من <span data-money>{formatLYD(unsafeMinor(debt.principalMinor))}</span>
            </p>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${String(Math.min(100, pct))}%`,
              background: settled ? 'var(--fin-income)' : 'var(--accent)',
            }}
          />
        </div>

        {debt.notes !== '' && (
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
            {debt.notes}
          </p>
        )}

        {settled ? (
          <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--fin-income)' }}>
            ✓ مسدَّد بالكامل
          </p>
        ) : paying ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => { setAmount(e.target.value) }}
                inputMode="decimal"
                placeholder={`حتى ${formatLYD(unsafeMinor(debt.remainingMinor), { withSymbol: false })}`}
                dir="ltr"
                className="tabular w-full rounded-lg border px-3 py-2 text-sm text-start outline-none"
                style={{ background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
              />
              <select
                value={cashId}
                onChange={(e) => { setCashId(e.target.value) }}
                className="rounded-lg border px-2 py-2 text-xs outline-none"
                style={{ background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
              >
                {cashAccounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void pay()}
                disabled={busy}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {busy ? 'جارٍ…' : debt.direction === 'payable' ? 'تسجيل السداد' : 'تسجيل التحصيل'}
              </button>
              <button
                type="button"
                onClick={() => { setPaying(false); setMsg(null) }}
                className="rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
              >
                إلغاء
              </button>
            </div>
            {msg !== null && (
              <p className="text-xs" style={{ color: 'var(--fin-expense)' }}>
                {msg}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setPaying(true) }}
            className="mt-3 w-full rounded-lg border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            {debt.direction === 'payable' ? 'تسجيل سداد' : 'تسجيل تحصيل'}
          </button>
        )}
      </Card>
    </li>
  )
}

function NewDebtForm({
  uid,
  accounts,
  direction,
  onDone,
}: {
  uid: string
  accounts: readonly AccountView[]
  direction: DebtDirection
  onDone: () => void
}): React.ReactElement {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [startedAt, setStartedAt] = useState<string>(() => today())
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [cashMoved, setCashMoved] = useState(true)
  const [cashId, setCashId] = useState('asset.cash')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const cashAccounts = accounts.filter((a) => a.isCashLike && a.status === 'active')

  async function submit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault()
    setMsg(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setMsg(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    const res = await createDebt(uid, {
      direction,
      counterpartyName: name,
      principalMinor: parsed.value,
      startedAt: toISODate(startedAt),
      dueDate: dueDate === '' ? null : toISODate(dueDate),
      notes,
      cashAccountId: cashMoved ? cashId : null,
    })
    setBusy(false)
    if (!res.ok) {
      setMsg(res.message)
      return
    }
    onDone()
  }

  const field = 'w-full rounded-xl border px-3 py-2.5 text-sm outline-none'
  const fs = { background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }

  return (
    <form onSubmit={(e) => { void submit(e) }}>
      <Card>
        <h2 className="mb-1 text-base font-bold">
          {direction === 'payable' ? 'دين جديد عليّ' : 'دين جديد لي'}
        </h2>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          {direction === 'payable'
            ? 'مبلغ اقترضتَه أو تدين به لشخص أو جهة.'
            : 'مبلغ أقرضتَه أو مستحق لك عند شخص أو جهة.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <Lbl>{direction === 'payable' ? 'الدائن' : 'المدين'}</Lbl>
            <input value={name} onChange={(e) => { setName(e.target.value) }} className={field} style={fs} required />
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
          <label className="block">
            <Lbl>تاريخ النشوء</Lbl>
            <input
              type="date"
              value={startedAt}
              max={today()}
              onChange={(e) => { setStartedAt(e.target.value) }}
              dir="ltr"
              className={`${field} text-start`}
              style={fs}
              required
            />
          </label>
          <label className="block">
            <Lbl>موعد السداد (اختياري)</Lbl>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value) }}
              dir="ltr"
              className={`${field} text-start`}
              style={fs}
            />
          </label>
          <label className="block sm:col-span-2">
            <Lbl>ملاحظات</Lbl>
            <input value={notes} onChange={(e) => { setNotes(e.target.value) }} className={field} style={fs} />
          </label>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed">
          <input
            type="checkbox"
            checked={cashMoved}
            onChange={(e) => { setCashMoved(e.target.checked) }}
            className="mt-0.5 size-4"
          />
          <span style={{ color: 'var(--ink-2)' }}>
            {direction === 'payable' ? 'استلمتُ المبلغ نقدًا' : 'دفعتُ المبلغ نقدًا'}
            <span className="block" style={{ color: 'var(--muted)' }}>
              إن ألغيتَ التحديد يُسجَّل الدين بلا حركة نقدية — مثل أن يشتري لك شيئًا وتردّ لاحقًا.
            </span>
          </span>
        </label>

        {cashMoved && (
          <label className="mt-3 block">
            <Lbl>{direction === 'payable' ? 'إلى حساب' : 'من حساب'}</Lbl>
            <select value={cashId} onChange={(e) => { setCashId(e.target.value) }} className={field} style={fs}>
              {cashAccounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {busy ? 'جارٍ الحفظ…' : 'حفظ الدين'}
        </button>

        {msg !== null && (
          <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--fin-expense)' }}>
            {msg}
          </p>
        )}
      </Card>
    </form>
  )
}

export function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-md)' }}
    >
      {children}
    </div>
  )
}

export function Lbl({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
      {children}
    </span>
  )
}

export function Loading(): React.ReactElement {
  return (
    <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
      جارٍ التحميل…
    </p>
  )
}

export function ErrorBox({ message }: { message: string }): React.ReactElement {
  return (
    <div
      role="alert"
      className="rounded-2xl border p-5 text-sm leading-relaxed"
      style={{
        background: 'var(--fin-expense-bg)',
        borderColor: 'var(--fin-expense-border)',
        color: 'var(--fin-expense)',
      }}
    >
      {message}
    </div>
  )
}
