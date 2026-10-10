import { useEffect, useMemo, useState } from 'react'

import { observeAllEntries, type AccountView, type EntryView } from '@/data/repos/ledgerRepo'
import {
  allocateToGoal,
  createGoal,
  observeBudget,
  observeGoals,
  saveBudget,
  type BudgetDoc,
  type GoalView,
} from '@/data/repos/planningRepo'
import {
  formatLYD,
  formatPercent,
  PARSE_ERROR_MESSAGES,
  parseAmountToMinor,
  unsafeMinor,
} from '@/domain/money'
import {
  availableToSpend,
  evaluateBudget,
  goalProgress,
  type BudgetHealth,
} from '@/domain/planning/budget'
import { currentPeriodKey, periodRange, toISODate, type PeriodKey } from '@/lib/time'

import { Card, ErrorBox, Lbl, Loading } from '../commitments/DebtsScreen'

const HEALTH_COLOR: Record<BudgetHealth, string> = {
  safe: 'var(--fin-income)',
  warning: 'var(--accent)',
  exceeded: 'var(--fin-expense)',
  none: 'var(--muted)',
}

const HEALTH_AR: Record<BudgetHealth, string> = {
  safe: 'ضمن الحد',
  warning: 'اقترب من الحد',
  exceeded: 'تجاوز الحد',
  none: 'بلا سقف',
}

/**
 * التخطيط المالي — الميزانيات والأهداف.
 *
 * **الفصل بين الفعلي والخطة** (القسم 12): الميزانية خطة لا حركة. وضع سقف
 * لا يُنشئ قيدًا ولا يحجز مالًا. والفعلي يُقرأ من الدفتر وحده. لا يختلطان
 * في رقم واحد أبدًا — وإلا لم يعد للمقارنة معنى.
 */
export function PlanningScreen({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [tab, setTab] = useState<'budget' | 'goals'>('budget')
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {([
          ['budget', 'الميزانية'],
          ['goals', 'الأهداف'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTab(k) }}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{
              background: tab === k ? 'var(--accent)' : 'transparent',
              borderColor: tab === k ? 'var(--accent)' : 'var(--line-strong)',
              color: tab === k ? '#fff' : 'var(--ink-2)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'budget' ? (
        <BudgetTab uid={uid} accounts={accounts} />
      ) : (
        <GoalsTab uid={uid} accounts={accounts} />
      )}
    </div>
  )
}

function BudgetTab({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [period, setPeriod] = useState<PeriodKey>(() => currentPeriodKey())
  const [budget, setBudget] = useState<BudgetDoc | null | undefined>(undefined)
  const [entries, setEntries] = useState<EntryView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [overall, setOverall] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return observeBudget(uid, period, (b) => { setBudget(b) }, () => { setError('تعذّر تحميل الميزانية.') })
  }, [uid, period])

  useEffect(() => {
    return observeAllEntries(uid, (rows) => { setEntries(rows) }, () => { setError('تعذّر تحميل العمليات.') })
  }, [uid])

  const categories = useMemo(
    () => accounts.filter((a) => a.type === 'expense' && a.status === 'active'),
    [accounts],
  )

  const actual = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries ?? []) {
      if (e.kind !== 'expense' || !e.bookedAt.startsWith(period) || e.categoryId === null) continue
      m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.amountMinor)
    }
    return m
  }, [entries, period])

  const months = useMemo(() => periodRange('2026-01' as PeriodKey, currentPeriodKey()).reverse(), [])

  if (error !== null) return <ErrorBox message={error} />
  if (budget === undefined || entries === null) return <Loading />

  const plan: BudgetDoc = budget ?? { periodKey: period, overallCapMinor: 0, categories: [] }
  const result = evaluateBudget(plan, actual)
  const nameOf = (id: string): string => accounts.find((a) => a.accountId === id)?.name ?? id

  function startEdit(): void {
    const d: Record<string, string> = {}
    for (const c of plan.categories) {
      d[c.categoryAccountId] = (c.capMinor / 1000).toString()
    }
    setDraft(d)
    setOverall(plan.overallCapMinor === 0 ? '' : (plan.overallCapMinor / 1000).toString())
    setEditing(true)
  }

  async function save(): Promise<void> {
    setBusy(true)
    const cats: { categoryAccountId: string; capMinor: number }[] = []
    for (const [id, raw] of Object.entries(draft)) {
      if (raw.trim() === '') continue
      const parsed = parseAmountToMinor(raw)
      if (!parsed.ok) {
        setError(`${nameOf(id)}: ${PARSE_ERROR_MESSAGES[parsed.code]}`)
        setBusy(false)
        return
      }
      if (parsed.value > 0) cats.push({ categoryAccountId: id, capMinor: parsed.value })
    }
    let overallCap = 0
    if (overall.trim() !== '') {
      const parsed = parseAmountToMinor(overall)
      if (!parsed.ok) {
        setError(PARSE_ERROR_MESSAGES[parsed.code])
        setBusy(false)
        return
      }
      overallCap = parsed.value
    }
    const res = await saveBudget(uid, { periodKey: period, overallCapMinor: overallCap, categories: cats })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setEditing(false)
  }

  return (
    <>
      <Card>
        <label className="block">
          <Lbl>الشهر</Lbl>
          <select
            value={period}
            onChange={(e) => { setPeriod(e.target.value as PeriodKey) }}
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
            dir="ltr"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
              المصروف من الميزانية
            </p>
            <p data-money className="mt-1.5 text-2xl font-bold" style={{ color: HEALTH_COLOR[result.overall] }}>
              {formatLYD(unsafeMinor(result.totalSpentMinor))}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              من <span data-money>{formatLYD(unsafeMinor(result.totalCapMinor))}</span>
              {result.totalCapMinor > 0 && (
                <>
                  {' · '}
                  {formatPercent(unsafeMinor(result.totalSpentMinor), unsafeMinor(result.totalCapMinor))}
                </>
              )}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: 'var(--chip)', color: HEALTH_COLOR[result.overall] }}
          >
            {HEALTH_AR[result.overall]}
          </span>
        </div>
        {result.totalCapMinor > 0 && (
          <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${String(Math.min(100, (result.totalSpentMinor / result.totalCapMinor) * 100))}%`,
                background: HEALTH_COLOR[result.overall],
              }}
            />
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          الميزانية <strong>خطة لا حركة</strong>: وضع سقف لا يُنشئ قيدًا ولا يحجز مالًا.
          الفعلي أعلاه مقروء من الدفتر وحده.
        </p>
      </Card>

      {editing ? (
        <Card>
          <h2 className="mb-3 text-sm font-bold">تعديل سقوف {period}</h2>
          <label className="mb-4 block">
            <Lbl>سقف كلي للشهر (اختياري — اتركه فارغًا ليكون مجموع الفئات)</Lbl>
            <input
              value={overall}
              onChange={(e) => { setOverall(e.target.value) }}
              inputMode="decimal"
              dir="ltr"
              placeholder="3000.000"
              className="tabular w-full rounded-xl border px-3 py-2.5 text-sm text-start outline-none"
              style={{ background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
            />
          </label>
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.accountId} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                <input
                  value={draft[c.accountId] ?? ''}
                  onChange={(e) => { setDraft((d) => ({ ...d, [c.accountId]: e.target.value })) }}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0"
                  className="tabular w-28 rounded-lg border px-2.5 py-1.5 text-sm text-start outline-none"
                  style={{ background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
                />
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {busy ? 'جارٍ الحفظ…' : 'حفظ الميزانية'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false) }}
              className="rounded-xl border px-4 py-2.5 text-sm"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
            >
              إلغاء
            </button>
          </div>
        </Card>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {plan.categories.length === 0 ? '+ وضع ميزانية لهذا الشهر' : 'تعديل السقوف'}
        </button>
      )}

      {result.lines.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-bold">الفئات</h2>
          <ul className="space-y-3">
            {result.lines.map((l) => (
              <li key={l.categoryAccountId}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                  <span>{nameOf(l.categoryAccountId)}</span>
                  <span>
                    <span data-money className="font-semibold" style={{ color: HEALTH_COLOR[l.health] }}>
                      {formatLYD(unsafeMinor(l.spentMinor))}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>
                      {' / '}
                      <span data-money>{formatLYD(unsafeMinor(l.capMinor), { withSymbol: false })}</span>
                    </span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${String(Math.min(100, l.usedPercent))}%`,
                      background: HEALTH_COLOR[l.health],
                    }}
                  />
                </div>
                {l.health === 'exceeded' && (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--fin-expense)' }}>
                    تجاوزتَ بـ <span data-money>{formatLYD(unsafeMinor(-l.remainingMinor))}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function GoalsTab({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [goals, setGoals] = useState<GoalView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    return observeGoals(uid, (r) => { setGoals(r) }, () => { setError('تعذّر تحميل الأهداف.') })
  }, [uid])

  if (error !== null) return <ErrorBox message={error} />
  if (goals === null) return <Loading />

  const cash = accounts.filter((a) => a.isCashLike && a.status === 'active')
  const totalEarmarked = cash.reduce((s, a) => s + a.earmarkedMinor, 0)
  const totalBalance = cash.reduce((s, a) => s + a.balanceMinor, 0)

  return (
    <>
      <Card>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
              المتاح للإنفاق
            </p>
            <p data-money className="mt-1 text-xl font-bold" style={{ color: 'var(--accent)' }}>
              {formatLYD(unsafeMinor(availableToSpend(totalBalance, totalEarmarked)))}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
              محجوز للأهداف
            </p>
            <p data-money className="mt-1 text-xl font-bold" style={{ color: 'var(--fin-receivable)' }}>
              {formatLYD(unsafeMinor(totalEarmarked))}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          الحجز <strong>نيّة لا حركة</strong>: المال ما زال في حسابك ورصيده لم ينقص.
          ولهذا تستطيع إنفاقه إن اضطررت — النظام ينبّهك ولا يمنعك من التصرّف في مالك.
        </p>
      </Card>

      <button
        type="button"
        onClick={() => { setShowForm((v) => !v) }}
        className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {showForm ? 'إغلاق' : '+ هدف جديد'}
      </button>

      {showForm && <NewGoalForm uid={uid} accounts={accounts} onDone={() => { setShowForm(false) }} />}

      {goals.filter((g) => g.status !== 'cancelled').length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
            لا أهداف بعد. حدّد هدفًا — سيارة، صندوق طوارئ، سفر.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {goals
            .filter((g) => g.status !== 'cancelled')
            .map((g) => (
              <GoalCard key={g.id} uid={uid} goal={g} accounts={accounts} />
            ))}
        </ul>
      )}
    </>
  )
}

function GoalCard({
  uid,
  goal,
  accounts,
}: {
  uid: string
  goal: GoalView
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const prog = goalProgress(goal.savedMinor, goal.targetMinor)
  const account = accounts.find((a) => a.accountId === goal.fundingAccountId)

  async function move(sign: 1 | -1): Promise<void> {
    setMsg(null)
    const parsed = parseAmountToMinor(amount)
    if (!parsed.ok) {
      setMsg(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    const res = await allocateToGoal(uid, goal.id, unsafeMinor(sign * parsed.value))
    setBusy(false)
    if (!res.ok) {
      setMsg(res.message)
      return
    }
    setAmount('')
  }

  return (
    <li>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{goal.name}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              من {account?.name ?? goal.fundingAccountId}
              {goal.deadline !== null && (
                <>
                  {' · '}
                  <span dir="ltr">{goal.deadline}</span>
                </>
              )}
            </p>
          </div>
          <div className="shrink-0 text-end">
            <p data-money className="font-bold" style={{ color: prog.reached ? 'var(--fin-income)' : 'var(--accent)' }}>
              {formatLYD(unsafeMinor(prog.savedMinor))}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
              من <span data-money>{formatLYD(unsafeMinor(prog.targetMinor))}</span>
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${String(prog.percent)}%`,
              background: prog.reached ? 'var(--fin-income)' : 'var(--accent)',
            }}
          />
        </div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {prog.reached ? (
            <span style={{ color: 'var(--fin-income)', fontWeight: 600 }}>✓ تحقّق الهدف</span>
          ) : (
            <>
              باقٍ <span data-money>{formatLYD(unsafeMinor(prog.remainingMinor))}</span>
              {' · '}
              {formatPercent(unsafeMinor(prog.savedMinor), unsafeMinor(prog.targetMinor))}
            </>
          )}
        </p>

        <div className="mt-3 flex gap-2">
          <input
            value={amount}
            onChange={(e) => { setAmount(e.target.value) }}
            inputMode="decimal"
            placeholder="المبلغ"
            dir="ltr"
            className="tabular w-full rounded-lg border px-3 py-2 text-sm text-start outline-none"
            style={{ background: 'var(--surface-page)', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
          />
          <button
            type="button"
            onClick={() => void move(1)}
            disabled={busy}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            حجز
          </button>
          <button
            type="button"
            onClick={() => void move(-1)}
            disabled={busy}
            className="shrink-0 rounded-lg border px-3 py-2 text-xs disabled:opacity-60"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
          >
            سحب
          </button>
        </div>
        {msg !== null && (
          <p className="mt-2 text-xs" style={{ color: 'var(--fin-expense)' }}>
            {msg}
          </p>
        )}
      </Card>
    </li>
  )
}

function NewGoalForm({
  uid,
  accounts,
  onDone,
}: {
  uid: string
  accounts: readonly AccountView[]
  onDone: () => void
}): React.ReactElement {
  const cash = accounts.filter((a) => a.isCashLike && a.status === 'active')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [accountId, setAccountId] = useState(cash[0]?.accountId ?? 'asset.cash')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault()
    setMsg(null)
    const parsed = parseAmountToMinor(target)
    if (!parsed.ok) {
      setMsg(PARSE_ERROR_MESSAGES[parsed.code])
      return
    }
    setBusy(true)
    const res = await createGoal(uid, {
      name,
      targetMinor: parsed.value,
      deadline: deadline === '' ? null : toISODate(deadline),
      fundingAccountId: accountId,
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
        <h2 className="mb-4 text-base font-bold">هدف مالي جديد</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <Lbl>الاسم</Lbl>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              placeholder="صندوق طوارئ"
              className={field}
              style={fs}
              required
            />
          </label>
          <label className="block">
            <Lbl>المبلغ المستهدف (د.ل)</Lbl>
            <input
              value={target}
              onChange={(e) => { setTarget(e.target.value) }}
              inputMode="decimal"
              placeholder="5000.000"
              dir="ltr"
              className={`${field} tabular text-start`}
              style={fs}
              required
            />
          </label>
          <label className="block">
            <Lbl>الموعد المستهدف (اختياري)</Lbl>
            <input
              type="date"
              value={deadline}
              onChange={(e) => { setDeadline(e.target.value) }}
              dir="ltr"
              className={`${field} text-start`}
              style={fs}
            />
          </label>
          <label className="block">
            <Lbl>يُحجَز من حساب</Lbl>
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value) }} className={field} style={fs}>
              {cash.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
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
          {busy ? 'جارٍ الحفظ…' : 'حفظ الهدف'}
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
