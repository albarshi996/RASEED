import { useCallback, useEffect, useState } from 'react'

import { postExpense } from '@/data/ledger/postExpense'
import {
  availableCashMinor,
  ensureSeedAccounts,
  observeAccounts,
  observeRecentEntries,
  totalExpensesMinor,
  type AccountView,
  type EntryView,
} from '@/data/repos/ledgerRepo'
import { OpeningBalanceCard } from '@/features/accounts/OpeningBalanceCard'
import { AddExpenseForm } from '@/features/expenses/AddExpenseForm'
import { formatLYD, type Minor } from '@/domain/money'
import { type ExpenseRequest } from '@/domain/ops/planExpense'

export function Dashboard({ uid }: { uid: string }): React.ReactElement {
  const [accounts, setAccounts] = useState<AccountView[] | null>(null)
  const [entries, setEntries] = useState<EntryView[]>([])
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        await ensureSeedAccounts(uid)
      } catch (e: unknown) {
        if (!cancelled) setFatal(describe(e))
      }
      if (!cancelled) setSeeding(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [uid])

  useEffect(() => {
    const off1 = observeAccounts(
      uid,
      (rows, fromCache) => {
        setAccounts(rows)
        setStale(fromCache)
      },
      (e) => {
        setFatal(describe(e))
      },
    )
    const off2 = observeRecentEntries(
      uid,
      25,
      (rows) => {
        setEntries(rows)
      },
      (e) => {
        setFatal(describe(e))
      },
    )
    return () => {
      off1()
      off2()
    }
  }, [uid])

  const submit = useCallback(
    async (req: ExpenseRequest): Promise<string | null> => {
      setBusy(true)
      try {
        const res = await postExpense(uid, req)
        return res.ok ? null : res.error.message
      } finally {
        setBusy(false)
      }
    },
    [uid],
  )

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

  if (accounts === null || seeding) {
    return (
      <p className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        جارٍ تجهيز حساباتك…
      </p>
    )
  }

  const cash = availableCashMinor(accounts) as Minor
  const spent = totalExpensesMinor(accounts) as Minor

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

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="الأموال المتاحة" value={cash} accent="var(--accent)" />
        <StatCard label="إجمالي المصروفات" value={spent} accent="var(--fin-expense)" />
      </div>

      {cash === 0 && <OpeningBalanceCard uid={uid} accounts={accounts} />}

      <AddExpenseForm accounts={accounts} onSubmit={submit} busy={busy} />

      {cash !== 0 && (
        <details
          className="rounded-2xl border p-5"
          style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
        >
          <summary className="cursor-pointer text-sm font-semibold">إضافة رصيد إلى حساب</summary>
          <div className="mt-4">
            <OpeningBalanceCard uid={uid} accounts={accounts} />
          </div>
        </details>
      )}

      <section
        className="rounded-2xl border p-5"
        style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
      >
        <h2 className="mb-4 text-base font-bold">آخر العمليات</h2>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            لا توجد عمليات بعد. سجّل أول مصروف من النموذج أعلاه.
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
                    {nameOf(accounts, e.categoryId)}
                    {e.scope === 'household' ? ' · منزلي' : ''}
                  </p>
                </div>
                <span
                  data-money
                  className="shrink-0 text-sm font-semibold"
                  style={{ color: 'var(--fin-expense)' }}
                >
                  {formatLYD(e.amountMinor as Minor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: Minor
  accent: string
}): React.ReactElement {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-warm)', borderColor: 'var(--border-subtle)' }}
    >
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <p data-money className="mt-2 text-2xl font-bold" style={{ color: accent }} title={formatLYD(value)}>
        {formatLYD(value)}
      </p>
    </div>
  )
}

function nameOf(accounts: readonly AccountView[], id: string | null): string {
  if (id === null) return ''
  return accounts.find((a) => a.accountId === id)?.name ?? id
}

function describe(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : ''
  if (code === 'permission-denied') {
    return 'رفض الخادم القراءة. غالبًا لم تُنشر قواعد الأمان بعد، أو حسابك ليس المالك المعتمد.'
  }
  if (code === 'failed-precondition') {
    return 'الاستعلام يحتاج فهرسًا لم يُنشر بعد. شغّل: npm run deploy:rules'
  }
  return 'تعذّر تحميل البيانات. تحقّق من الاتصال.'
}
