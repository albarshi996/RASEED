import { useEffect, useMemo, useState } from 'react'

import { observeRecentEntries, type AccountView, type EntryView } from '@/data/repos/ledgerRepo'
import { computeSummary, expensesByCategory } from '@/data/repos/summary'
import { formatLYD, formatPercent, unsafeMinor } from '@/domain/money'
import { kindLabel, type OpKind } from '@/domain/ops/plan'
import { availableToSpend } from '@/domain/planning/budget'
import { OperationForm } from '@/features/operations/OperationForm'
import {
  Alert,
  Card,
  Chip,
  EmptyState,
  PageHeader,
  Progress,
  SectionTitle,
} from '@/ui/components/primitives'
import { currentPeriodKey, today } from '@/lib/time'

export function Dashboard({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [entries, setEntries] = useState<EntryView[]>([])
  const [stale, setStale] = useState(false)

  useEffect(() => {
    return observeRecentEntries(
      uid,
      40,
      (rows, fromCache) => {
        setEntries(rows)
        setStale(fromCache)
      },
      () => {
        /* الخطأ يُعرض من App عبر اشتراك الحسابات — لا نكرّر الرسالة. */
      },
    )
  }, [uid])

  const s = computeSummary(accounts)
  const period = currentPeriodKey()
  const earmarked = accounts
    .filter((a) => a.isCashLike && a.status === 'active')
    .reduce((x, a) => x + a.earmarkedMinor, 0)

  const month = useMemo(() => {
    let income = 0
    let expense = 0
    for (const e of entries) {
      if (!e.bookedAt.startsWith(period)) continue
      if (e.kind === 'income') income += e.amountMinor
      if (e.kind === 'expense') expense += e.amountMinor
    }
    return { income, expense, net: income - expense }
  }, [entries, period])

  const byCategory = expensesByCategory(accounts).slice(0, 6)
  const maxCat = byCategory[0]?.amountMinor ?? 1
  const nameOf = (id: string | null): string =>
    id === null ? '' : (accounts.find((a) => a.accountId === id)?.name ?? id)
  const needsOpening = s.availableCashMinor === 0 && s.totalIncomeMinor === 0

  return (
    <>
      <PageHeader
        title="لوحة التحكم"
        subtitle={today()}
        description="نظرة واحدة على أموالك: ما تملكه، وما عليك، وما لك، وإلى أين يذهب إنفاقك."
      />

      {stale && (
        <div className="mb-4">
          <Alert tone="info">بيانات غير محدَّثة — معروضة من الذاكرة المؤقتة ريثما يعود الاتصال.</Alert>
        </div>
      )}

      {needsOpening && (
        <div className="mb-4">
          <Alert tone="info">
            ابدأ بتسجيل <strong>رصيد افتتاحي</strong> — كم معك الآن فعلًا. بدونه سيُرفض أي مصروف
            بحجّة عدم كفاية الرصيد، وهو رفض صحيح محاسبيًا.
          </Alert>
        </div>
      )}

      <SectionTitle icon={<IconWallet />}>الوضع المالي</SectionTitle>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BigStat
          label="الأموال المتاحة"
          value={s.availableCashMinor}
          color="var(--accent)"
          note={
            earmarked > 0
              ? `${formatLYD(unsafeMinor(availableToSpend(s.availableCashMinor, earmarked)))} متاح للإنفاق`
              : undefined
          }
        />
        <BigStat label="صافي الثروة" value={s.netWorthMinor} color="var(--ink)" />
        <SmallStat label="مستحق لي" value={s.receivablesMinor} color="var(--fin-receivable)" />
        <SmallStat label="مستحق عليّ" value={s.payablesMinor} color="var(--fin-owed)" />
      </div>

      <SectionTitle icon={<IconCalendar />} trailing={<Chip>{period}</Chip>}>
        هذا الشهر
      </SectionTitle>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <SmallStat label="الدخل" value={month.income} color="var(--fin-income)" />
        <SmallStat label="المصروفات" value={month.expense} color="var(--fin-expense)" />
        <SmallStat
          label="الصافي"
          value={month.net}
          color={month.net >= 0 ? 'var(--fin-income)' : 'var(--fin-expense)'}
        />
      </div>

      <SectionTitle icon={<IconPlus />}>عملية جديدة</SectionTitle>
      <div className="mb-6">
        <OperationForm uid={uid} accounts={accounts} initialKind={needsOpening ? 'opening' : 'expense'} />
      </div>

      {byCategory.length > 0 && (
        <>
          <SectionTitle icon={<IconChart />}>أين يذهب إنفاقك</SectionTitle>
          <div className="mb-6">
            <Card>
              <ul className="space-y-3">
                {byCategory.map((c) => (
                  <li key={c.accountId}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                      <span>{c.name}</span>
                      <span className="flex items-baseline gap-2">
                        <span style={{ color: 'var(--muted)' }}>
                          {formatPercent(
                            unsafeMinor(c.amountMinor),
                            unsafeMinor(s.totalExpensesMinor),
                          )}
                        </span>
                        <span data-money className="font-semibold" style={{ color: 'var(--fin-expense)' }}>
                          {formatLYD(unsafeMinor(c.amountMinor))}
                        </span>
                      </span>
                    </div>
                    <Progress percent={(c.amountMinor / maxCat) * 100} color="var(--fin-expense)" />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}

      <SectionTitle icon={<IconList />} trailing={<Chip>{String(entries.length)}</Chip>}>
        آخر العمليات
      </SectionTitle>
      <Card>
        {entries.length === 0 ? (
          <EmptyState>لا توجد عمليات بعد. سجّل أول عملية من النموذج أعلاه.</EmptyState>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {entries.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-3 py-3">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: colorFor(e.kind) }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.description}</p>
                  <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--muted)' }}>
                    <span dir="ltr">{e.bookedAt}</span>
                    {' · '}
                    {kindLabel(e.kind as OpKind)}
                    {e.categoryId !== null && e.kind === 'expense' && ` · ${nameOf(e.categoryId)}`}
                    {e.scope === 'household' && ' · منزلي'}
                  </p>
                </div>
                <span data-money className="shrink-0 text-sm font-semibold" style={{ color: colorFor(e.kind) }}>
                  {formatLYD(unsafeMinor(e.amountMinor))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function BigStat({
  label,
  value,
  color,
  note,
}: {
  label: string
  value: number
  color: string
  note?: string | undefined
}): React.ReactElement {
  return (
    <Card tone="warm">
      <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
        {label}
      </p>
      <p data-money className="mt-1.5 text-xl font-bold" style={{ color }} title={formatLYD(unsafeMinor(value))}>
        {formatLYD(unsafeMinor(value))}
      </p>
      {note !== undefined && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {note}
        </p>
      )}
    </Card>
  )
}

function SmallStat({ label, value, color }: { label: string; value: number; color: string }): React.ReactElement {
  return (
    <Card>
      <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
        {label}
      </p>
      <p data-money className="mt-1.5 text-base font-bold" style={{ color }}>
        {formatLYD(unsafeMinor(value))}
      </p>
    </Card>
  )
}

function colorFor(kind: string): string {
  switch (kind) {
    case 'income':
      return 'var(--fin-income)'
    case 'expense':
      return 'var(--fin-expense)'
    case 'borrow':
    case 'payDebt':
      return 'var(--fin-owed)'
    case 'lend':
    case 'collectDebt':
      return 'var(--fin-receivable)'
    case 'opening':
      return 'var(--accent)'
    default:
      return 'var(--fin-transfer)'
  }
}

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}
const IconWallet = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" className="size-full" {...S}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18M16 14h2" />
  </svg>
)
const IconCalendar = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" className="size-full" {...S}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
)
const IconPlus = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" className="size-full" {...S}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const IconChart = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" className="size-full" {...S}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)
const IconList = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" className="size-full" {...S}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)
