import { useEffect, useMemo, useState } from 'react'

import { postOperation } from '@/data/ledger/postOperation'
import {
  cancelObligation,
  createObligation,
  observeObligations,
  type ObligationNature,
  type ObligationStatus,
  type ObligationView,
  type Recurrence,
} from '@/data/repos/commitmentsRepo'
import { type AccountView } from '@/data/repos/ledgerRepo'
import { formatLYD, PARSE_ERROR_MESSAGES, parseAmountToMinor, unsafeMinor } from '@/domain/money'
import { diffDays, nowMs, today, toISODate } from '@/lib/time'
import { ulid } from '@/lib/ulid'

import { Card, ErrorBox, Lbl, Loading } from '@/ui/components/primitives'
import { PageHeader } from '@/ui/components/primitives'

/**
 * شاشة الالتزامات — الإيجار والفواتير والأقساط والاشتراكات.
 *
 * **القاعدة 19.4 مُجسَّدة هنا:** إنشاء التزام **لا يُنشئ أي قيد ولا يخفض أي رصيد**.
 * الالتزام غير المدفوع وعدٌ بالدفع لا دفعة. القيد يُنشأ عند السداد الفعلي وحده.
 *
 * **ADR-011:** الالتزام نوعان. `expense` (إيجار، فاتورة) سداده مصروف.
 * `financing` (قسط قرض) سداده **ليس مصروفًا** — المال خرج عند الاقتراض،
 * والقسط يخفض الدين. خلطهما يضخّم تقرير المصروفات بأصل القرض.
 */

const STATUS_AR: Record<ObligationStatus, string> = {
  upcoming: 'قادم',
  due: 'مستحق اليوم',
  overdue: 'متأخر',
  partiallyPaid: 'مسدَّد جزئيًا',
  paid: 'مسدَّد',
  cancelled: 'ملغى',
}

const STATUS_COLOR: Record<ObligationStatus, string> = {
  upcoming: 'var(--fin-transfer)',
  due: 'var(--accent)',
  overdue: 'var(--fin-expense)',
  partiallyPaid: 'var(--fin-owed)',
  paid: 'var(--fin-income)',
  cancelled: 'var(--muted)',
}

export function ObligationsScreen({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [rows, setRows] = useState<ObligationView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showPaid, setShowPaid] = useState(false)

  useEffect(() => {
    return observeObligations(
      uid,
      (r) => { setRows(r) },
      () => { setError('تعذّر تحميل الالتزامات.') },
    )
  }, [uid])

  const visible = useMemo(
    () => (rows ?? []).filter((o) => (showPaid ? true : o.status !== 'paid' && o.status !== 'cancelled')),
    [rows, showPaid],
  )
  const upcoming = (rows ?? []).filter((o) => o.status === 'upcoming' || o.status === 'due')
  const overdue = (rows ?? []).filter((o) => o.status === 'overdue' || o.status === 'partiallyPaid')
  const sum = (list: ObligationView[]): number => list.reduce((s, o) => s + o.remainingMinor, 0)

  if (error !== null) return <ErrorBox message={error} />
  if (rows === null) return <Loading />

  return (
    <>
      <PageHeader
        title="الالتزامات"
        description="إيجار وفواتير وأقساط واشتراكات. إنشاء التزام لا يخفض رصيدك — الرصيد ينقص عند السداد الفعلي وحده."
      />
      <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
            قادم ومستحق
          </p>
          <p data-money className="mt-1.5 text-xl font-bold" style={{ color: 'var(--accent)' }}>
            {formatLYD(unsafeMinor(sum(upcoming)))}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
            {upcoming.length} التزام
          </p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
            متأخر
          </p>
          <p data-money className="mt-1.5 text-xl font-bold" style={{ color: 'var(--fin-expense)' }}>
            {formatLYD(unsafeMinor(sum(overdue)))}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
            {overdue.length} التزام
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v) }}
          className="rounded-xl px-4 py-2 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {showForm ? 'إغلاق' : '+ التزام جديد'}
        </button>
        <label className="ms-auto flex items-center gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>
          <input
            type="checkbox"
            checked={showPaid}
            onChange={(e) => { setShowPaid(e.target.checked) }}
            className="size-4"
          />
          إظهار المسدَّد والملغى
        </label>
      </div>

      {showForm && (
        <NewObligationForm uid={uid} accounts={accounts} onDone={() => { setShowForm(false) }} />
      )}

      {visible.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
            لا توجد التزامات.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((o) => (
            <ObligationCard key={o.id} uid={uid} obligation={o} accounts={accounts} />
          ))}
        </ul>
      )}
      </div>
    </>
  )
}

function ObligationCard({
  uid,
  obligation: o,
  accounts,
}: {
  uid: string
  obligation: ObligationView
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')
  const [cashId, setCashId] = useState('asset.cash')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const total = o.totalMinor + o.extraChargesMinor
  const pct = total === 0 ? 0 : (o.paidMinor / total) * 100
  const done = o.status === 'paid' || o.status === 'cancelled'
  const cashAccounts = accounts.filter((a) => a.isCashLike && a.status === 'active')
  const daysLeft = o.dueDate === '' ? null : diffDays(toISODate(today()), toISODate(o.dueDate))

  async function pay(): Promise<void> {
    setMsg(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setMsg(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    // ADR-011: قسط التمويل يخفض الدين ولا يُقيَّد مصروفًا.
    const isFinancing = o.nature === 'financing'
    const res = await postOperation(uid, {
      opId: ulid(nowMs()),
      kind: isFinancing ? 'payDebt' : 'expense',
      amountMinor: parsed.value,
      bookedAt: toISODate(today()),
      debitAccountId: isFinancing ? 'liability.financing' : o.categoryAccountId,
      creditAccountId: cashId,
      description: `سداد — ${o.name}`,
      ...(o.payeeName === '' ? {} : { counterpartyName: o.payeeName }),
      settlement: { kind: 'obligation', id: o.id },
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
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold">{o.name}</p>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'var(--chip)', color: STATUS_COLOR[o.status] }}
              >
                {STATUS_AR[o.status]}
              </span>
              {o.nature === 'financing' && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px]"
                  style={{ background: 'var(--chip)', color: 'var(--muted)' }}
                  title="سداده يخفض الدين ولا يُحتسب مصروفًا"
                >
                  قسط تمويل
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              {o.payeeName !== '' && `${o.payeeName} · `}
              <span dir="ltr">{o.dueDate}</span>
              {daysLeft !== null && !done && (
                <> {daysLeft < 0 ? `· متأخر ${String(-daysLeft)} يومًا` : daysLeft === 0 ? '· اليوم' : `· بعد ${String(daysLeft)} يومًا`}</>
              )}
              {o.recurrence !== 'none' && ` · ${o.recurrence === 'monthly' ? 'شهري' : o.recurrence === 'quarterly' ? 'ربع سنوي' : 'سنوي'}`}
            </p>
          </div>
          <div className="shrink-0 text-end">
            <p data-money className="font-bold" style={{ color: STATUS_COLOR[o.status] }}>
              {formatLYD(unsafeMinor(o.remainingMinor))}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
              من <span data-money>{formatLYD(unsafeMinor(total))}</span>
            </p>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${String(Math.min(100, pct))}%`, background: STATUS_COLOR[o.status] }}
          />
        </div>

        {!done &&
          (paying ? (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value) }}
                  inputMode="decimal"
                  placeholder={`حتى ${formatLYD(unsafeMinor(o.remainingMinor), { withSymbol: false })}`}
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
                  {busy ? 'جارٍ…' : 'تسجيل السداد'}
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
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { setPaying(true) }}
                className="flex-1 rounded-lg border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              >
                تسجيل سداد
              </button>
              <button
                type="button"
                onClick={() => void cancelObligation(uid, o.id)}
                className="rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
              >
                إلغاء الالتزام
              </button>
            </div>
          ))}
      </Card>
    </li>
  )
}

function NewObligationForm({
  uid,
  accounts,
  onDone,
}: {
  uid: string
  accounts: readonly AccountView[]
  onDone: () => void
}): React.ReactElement {
  const [name, setName] = useState('')
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState<string>(() => today())
  const [nature, setNature] = useState<ObligationNature>('expense')
  const [recurrence, setRecurrence] = useState<Recurrence>('monthly')
  const [category, setCategory] = useState('expense.home')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const categories = accounts.filter((a) => a.type === 'expense' && a.status === 'active')

  async function submit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault()
    setMsg(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setMsg(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    const res = await createObligation(uid, {
      name,
      payeeName: payee,
      nature,
      totalMinor: parsed.value,
      dueDate: toISODate(dueDate),
      recurrence,
      priority,
      categoryAccountId: category,
      notes,
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
        <h2 className="mb-1 text-base font-bold">التزام جديد</h2>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          إيجار، فاتورة، قسط، اشتراك. <strong>لا يخفض رصيدك الآن</strong> — الرصيد ينقص
          عند تسجيل السداد الفعلي وحده.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <Lbl>الاسم</Lbl>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              placeholder="إيجار المنزل"
              className={field}
              style={fs}
              required
            />
          </label>
          <label className="block">
            <Lbl>الجهة المستفيدة</Lbl>
            <input value={payee} onChange={(e) => { setPayee(e.target.value) }} className={field} style={fs} />
          </label>
          <label className="block">
            <Lbl>المبلغ (د.ل)</Lbl>
            <input
              value={amount}
              onChange={(e) => { setAmount(e.target.value) }}
              inputMode="decimal"
              placeholder="800.000"
              dir="ltr"
              className={`${field} tabular text-start`}
              style={fs}
              required
            />
          </label>
          <label className="block">
            <Lbl>تاريخ الاستحقاق</Lbl>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value) }}
              dir="ltr"
              className={`${field} text-start`}
              style={fs}
              required
            />
          </label>
          <label className="block">
            <Lbl>الطبيعة</Lbl>
            <select
              value={nature}
              onChange={(e) => { setNature(e.target.value as ObligationNature) }}
              className={field}
              style={fs}
            >
              <option value="expense">مصروف (إيجار، فاتورة…)</option>
              <option value="financing">قسط تمويل (سداده ليس مصروفًا)</option>
            </select>
          </label>
          <label className="block">
            <Lbl>التكرار</Lbl>
            <select
              value={recurrence}
              onChange={(e) => { setRecurrence(e.target.value as Recurrence) }}
              className={field}
              style={fs}
            >
              <option value="none">مرة واحدة</option>
              <option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option>
              <option value="yearly">سنوي</option>
            </select>
          </label>
          {nature === 'expense' && (
            <label className="block">
              <Lbl>فئة المصروف عند السداد</Lbl>
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value) }}
                className={field}
                style={fs}
              >
                {categories.map((c) => (
                  <option key={c.accountId} value={c.accountId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <Lbl>الأولوية</Lbl>
            <select
              value={priority}
              onChange={(e) => { setPriority(e.target.value as 'low' | 'normal' | 'high') }}
              className={field}
              style={fs}
            >
              <option value="high">عالية</option>
              <option value="normal">عادية</option>
              <option value="low">منخفضة</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <Lbl>ملاحظات</Lbl>
            <input value={notes} onChange={(e) => { setNotes(e.target.value) }} className={field} style={fs} />
          </label>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {busy ? 'جارٍ الحفظ…' : 'حفظ الالتزام'}
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
