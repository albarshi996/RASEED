import { useEffect, useState } from 'react'

import { observeRecentEntries, type AccountView, type EntryView } from '@/data/repos/ledgerRepo'
import { computeSummary, expensesByCategory } from '@/data/repos/summary'
import { formatLYD, unsafeMinor } from '@/domain/money'
import { kindLabel, type OpKind } from '@/domain/ops/plan'
import { OperationForm } from '@/features/operations/OperationForm'

export function Dashboard({
  uid,
  accounts,
}: {
  uid: string
  accounts: readonly AccountView[]
}): React.ReactElement {
  const [entries, setEntries] = useState<EntryView[]>([])
  const [stale, setStale] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    const off2 = observeRecentEntries(
      uid,
      30,
      (rows, fromCache) => {
        setEntries(rows)
        setStale(fromCache)
      },
      (e) => {
        setFatal(describe(e))
      },
    )
    return () => {
      off2()
    }
  }, [uid])

  if (fatal !== null) {
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
        {fatal}
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <p className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        جارٍ تجهيز حساباتك…
      </p>
    )
  }

  const s = computeSummary(accounts)
  const byCategory = expensesByCategory(accounts)
  const maxCategory = byCategory[0]?.amountMinor ?? 1
  const needsOpening = s.availableCashMinor === 0 && s.totalIncomeMinor === 0

  return (
    <div className="space-y-6">
      {stale && (
        <p
          className="rounded-xl border px-4 py-2.5 text-xs"
          style={{
            background: 'var(--fin-transfer-bg)',
            borderColor: 'var(--fin-transfer-border)',
            color: 'var(--fin-transfer)',
          }}
        >
          بيانات غير محدَّثة — معروضة من الذاكرة المؤقتة ريثما يعود الاتصال.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="الأموال المتاحة" value={s.availableCashMinor} color="var(--accent)" big />
        <Stat label="صافي الثروة" value={s.netWorthMinor} color="var(--text-primary)" big />
        <Stat label="مستحق لي" value={s.receivablesMinor} color="var(--fin-receivable)" />
        <Stat label="مستحق عليّ" value={s.payablesMinor} color="var(--fin-owed)" />
        <Stat label="إجمالي الدخل" value={s.totalIncomeMinor} color="var(--fin-income)" />
        <Stat label="إجمالي المصروفات" value={s.totalExpensesMinor} color="var(--fin-expense)" />
        <Stat
          label="صافي التدفق"
          value={s.netFlowMinor}
          color={s.netFlowMinor >= 0 ? 'var(--fin-income)' : 'var(--fin-expense)'}
        />
        <Stat label="عدد العمليات" value={null} text={String(entries.length)} color="var(--text-secondary)" />
      </div>

      {needsOpening && (
        <p
          className="rounded-xl border px-4 py-3 text-xs leading-relaxed"
          style={{
            background: 'var(--surface-warm)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          ابدأ بتسجيل <strong>رصيد افتتاحي</strong> من النموذج أدناه — كم معك الآن فعلًا. بدونه
          سيُرفض أي مصروف بحجّة عدم كفاية الرصيد، وهو رفض صحيح محاسبيًا.
        </p>
      )}

      <OperationForm uid={uid} accounts={accounts} initialKind={needsOpening ? 'opening' : 'expense'} />

      {byCategory.length > 0 && (
        <section
          className="rounded-2xl border p-5"
          style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="mb-4 text-base font-bold">المصروفات حسب الفئة</h2>
          <ul className="space-y-2.5">
            {byCategory.map((c) => (
              <li key={c.accountId}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                  <span>{c.name}</span>
                  <span data-money className="font-semibold" style={{ color: 'var(--fin-expense)' }}>
                    {formatLYD(unsafeMinor(c.amountMinor))}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full"
                  style={{ background: 'var(--surface-sunken)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${String(Math.max(2, (c.amountMinor / maxCategory) * 100))}%`,
                      background: 'var(--fin-expense)',
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="rounded-2xl border p-5"
        style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
      >
        <h2 className="mb-4 text-base font-bold">آخر العمليات</h2>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            لا توجد عمليات بعد.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {entries.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.description}</p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span dir="ltr">{e.bookedAt}</span>
                    {' · '}
                    {kindLabel(e.kind as OpKind)}
                    {e.scope === 'household' ? ' · منزلي' : ''}
                  </p>
                </div>
                <span data-money className="shrink-0 text-sm font-semibold" style={{ color: colorFor(e.kind) }}>
                  {formatLYD(unsafeMinor(e.amountMinor))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  color,
  big = false,
  text,
}: {
  label: string
  value: number | null
  color: string
  big?: boolean
  text?: string
}): React.ReactElement {
  const display = value === null ? (text ?? '') : formatLYD(unsafeMinor(value))
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        background: big ? 'var(--surface-warm)' : 'var(--surface-card)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <p
        className={`mt-1.5 font-bold ${big ? 'text-xl' : 'text-base'}`}
        style={{ color }}
        title={display}
        {...(value === null ? {} : { 'data-money': true })}
      >
        {display}
      </p>
    </div>
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

function describe(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : ''
  if (code === 'permission-denied') {
    return 'رفض الخادم القراءة. تأكّد أن حسابك هو المالك المعتمد وأن القواعد منشورة.'
  }
  if (code === 'failed-precondition') {
    return 'الاستعلام يحتاج فهرسًا لم يُنشر بعد. شغّل: npm run deploy:rules'
  }
  return 'تعذّر تحميل البيانات. تحقّق من الاتصال.'
}
