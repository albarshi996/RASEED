import { useEffect, useMemo, useState } from 'react'

import { observeAllEntries, type EntryView } from '@/data/repos/ledgerRepo'
import { computeSummary } from '@/data/repos/summary'
import { type AccountView } from '@/data/repos/ledgerRepo'
import { formatLYD, formatPercent, unsafeMinor } from '@/domain/money'
import { kindLabel, type OpKind } from '@/domain/ops/plan'
import { currentPeriodKey, periodRange, type PeriodKey } from '@/lib/time'

import { Card, ErrorBox, Loading } from '@/ui/components/primitives'
import { PageHeader } from '@/ui/components/primitives'

/**
 * التقارير — مبنية على القيود الفعلية لا على أرصدة مجمَّعة.
 *
 * **الاستثناءات الحاسمة** (القاعدة 19.11): التقرير الشهري يحسب الدخل والمصروف
 * من **أنواع الحسابات** في القيد، فلا يمكن للتحويل أو الاقتراض أو السداد أن
 * يتسرّب إليه. هذا ما يجعل القيد المزدوج يستحق تعقيده.
 */
export function ReportsScreen({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [entries, setEntries] = useState<EntryView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodKey>(() => currentPeriodKey())

  useEffect(() => {
    return observeAllEntries(
      uid,
      (rows) => { setEntries(rows) },
      () => { setError('تعذّر تحميل التقارير.') },
    )
  }, [uid])

  const months = useMemo(() => {
    if (entries === null || entries.length === 0) return [currentPeriodKey()]
    const keys = entries.map((e) => e.bookedAt.slice(0, 7)).filter((k) => k !== '')
    const min = keys.reduce((a, b) => (a < b ? a : b), keys[0] ?? '')
    return periodRange(min as PeriodKey, currentPeriodKey()).reverse()
  }, [entries])

  const monthly = useMemo(() => {
    if (entries === null) return null
    const inPeriod = entries.filter((e) => e.bookedAt.startsWith(period))
    let income = 0
    let expense = 0
    let household = 0
    const byKind = new Map<string, { count: number; total: number }>()
    const byCategory = new Map<string, number>()

    for (const e of inPeriod) {
      // التصنيف من **نوع الحساب** لا من وسم العملية — فلا يتسرّب تحويل ولا اقتراض.
      if (e.kind === 'income') income += e.amountMinor
      if (e.kind === 'expense') {
        expense += e.amountMinor
        if (e.scope === 'household') household += e.amountMinor
        if (e.categoryId !== null) {
          byCategory.set(e.categoryId, (byCategory.get(e.categoryId) ?? 0) + e.amountMinor)
        }
      }
      const cur = byKind.get(e.kind) ?? { count: 0, total: 0 }
      byKind.set(e.kind, { count: cur.count + 1, total: cur.total + e.amountMinor })
    }

    return {
      count: inPeriod.length,
      income,
      expense,
      net: income - expense,
      household,
      byKind: [...byKind.entries()].sort((a, b) => b[1].total - a[1].total),
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [entries, period])

  if (error !== null) return <ErrorBox message={error} />
  if (entries === null || monthly === null) return <Loading />

  const s = computeSummary(accounts)
  const nameOf = (id: string): string => accounts.find((a) => a.accountId === id)?.name ?? id
  const maxCat = monthly.byCategory[0]?.[1] ?? 1

  return (
    <>
      <PageHeader
        title="التقارير"
        description="أرقام مشتقة من القيود الفعلية. التحويل والاقتراض والسداد لا تدخل في الدخل ولا المصروفات — التصنيف من نوع الحساب لا من وسم العملية."
      />
      <div className="space-y-5">
      <Card>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            الشهر
          </span>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="دخل الشهر" value={monthly.income} color="var(--fin-income)" />
        <MiniStat label="مصروفات الشهر" value={monthly.expense} color="var(--fin-expense)" />
        <MiniStat
          label="صافي الشهر"
          value={monthly.net}
          color={monthly.net >= 0 ? 'var(--fin-income)' : 'var(--fin-expense)'}
        />
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-bold">مصاريف المنزل</h2>
        <p className="mb-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          جزء من مصروفات الشهر لا إضافة إليها — تُعرض هنا منفصلة وتبقى محسوبة مرة واحدة فقط.
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <span data-money className="text-xl font-bold" style={{ color: 'var(--fin-owed)' }}>
            {formatLYD(unsafeMinor(monthly.household))}
          </span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {monthly.expense === 0
              ? '—'
              : `${formatPercent(unsafeMinor(monthly.household), unsafeMinor(monthly.expense))} من المصروفات`}
          </span>
        </div>
      </Card>

      {monthly.byCategory.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-bold">المصروفات حسب الفئة</h2>
          <ul className="space-y-2.5">
            {monthly.byCategory.map(([id, total]) => (
              <li key={id}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                  <span>{nameOf(id)}</span>
                  <span data-money className="font-semibold" style={{ color: 'var(--fin-expense)' }}>
                    {formatLYD(unsafeMinor(total))}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${String(Math.max(2, (total / maxCat) * 100))}%`, background: 'var(--fin-expense)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-bold">العمليات حسب النوع</h2>
        {monthly.byKind.length === 0 ? (
          <p className="py-4 text-center text-sm" style={{ color: 'var(--muted)' }}>
            لا عمليات في هذا الشهر.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {monthly.byKind.map(([kind, v]) => (
              <li key={kind} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  {kindLabel(kind as OpKind)}
                  <span className="ms-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                    {v.count} عملية
                  </span>
                </span>
                <span data-money className="font-semibold">
                  {formatLYD(unsafeMinor(v.total))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          التحويل والاقتراض والسداد تظهر هنا كعمليات، لكنها <strong>لا تدخل</strong> في دخل الشهر
          ولا مصروفاته أعلاه — التصنيف من نوع الحساب لا من وسم العملية.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-bold">الوضع الإجمالي</h2>
        <ul className="space-y-2 text-sm">
          <Row label="الأموال المتاحة" value={s.availableCashMinor} />
          <Row label="مستحق لي" value={s.receivablesMinor} color="var(--fin-receivable)" />
          <Row label="مستحق عليّ" value={s.payablesMinor} color="var(--fin-owed)" />
          <li className="flex items-center justify-between gap-3 border-t pt-2 font-bold" style={{ borderColor: 'var(--line)' }}>
            <span>صافي الثروة</span>
            <span data-money>{formatLYD(unsafeMinor(s.netWorthMinor))}</span>
          </li>
        </ul>
      </Card>
      </div>
    </>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }): React.ReactElement {
  return (
    <Card>
      <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
        {label}
      </p>
      <p data-money className="mt-1.5 text-lg font-bold" style={{ color }}>
        {formatLYD(unsafeMinor(value))}
      </p>
    </Card>
  )
}

function Row({ label, value, color }: { label: string; value: number; color?: string }): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-3">
      <span style={{ color: 'var(--ink-2)' }}>{label}</span>
      <span data-money className="font-semibold" style={color === undefined ? undefined : { color }}>
        {formatLYD(unsafeMinor(value))}
      </span>
    </li>
  )
}
