import { useMemo, useState } from 'react'

import { postOperation } from '@/data/ledger/postOperation'
import { type AccountView } from '@/data/repos/ledgerRepo'
import { formatLYD, PARSE_ERROR_MESSAGES, parseAmountToMinor, unsafeMinor } from '@/domain/money'
import { type OpKind, type Scope } from '@/domain/ops/plan'
import { nowMs, today, toISODate } from '@/lib/time'
import { ulid } from '@/lib/ulid'

/**
 * نموذج العمليات الموحَّد.
 *
 * نموذج واحد لكل أنواع الحركات، يتكيّف عنوانه وحقوله بحسب النوع المختار.
 * السبب ليس الاختصار بل الاتساق: سبعة نماذج منفصلة تعني سبع فرص لاختلاف
 * التحقق أو تسمية الحقول أو ترتيب الطرفين — وهو أول مصدر لقيود مقلوبة الاتجاه.
 */

interface KindUi {
  key: OpKind
  label: string
  /** تسمية الطرف المدين كما يفهمها المستخدم (لا «مدين»). */
  debitLabel: string
  creditLabel: string
  debitFilter: (a: AccountView) => boolean
  creditFilter: (a: AccountView) => boolean
  hint: string
  color: string
  hasScope?: boolean
  hasCounterparty?: boolean
}

const cashLike = (a: AccountView): boolean => a.isCashLike && a.status === 'active'
const ofType = (t: string) => (a: AccountView): boolean => a.type === t && a.status === 'active'
const receivable = (a: AccountView): boolean => a.accountId === 'asset.receivable'
const payable = (a: AccountView): boolean =>
  a.type === 'liability' && a.status === 'active' && a.accountId !== 'liability.obligations'

const KINDS: readonly KindUi[] = [
  {
    key: 'expense',
    label: 'مصروف',
    debitLabel: 'الفئة',
    creditLabel: 'الدفع من',
    debitFilter: ofType('expense'),
    creditFilter: cashLike,
    hint: 'ينقص رصيدك ويزيد مصروفاتك.',
    color: 'var(--fin-expense)',
    hasScope: true,
  },
  {
    key: 'income',
    label: 'دخل',
    debitLabel: 'إلى حساب',
    creditLabel: 'المصدر',
    debitFilter: cashLike,
    creditFilter: ofType('income'),
    hint: 'يزيد رصيدك ويُحتسب دخلًا.',
    color: 'var(--fin-income)',
  },
  {
    key: 'transfer',
    label: 'تحويل',
    debitLabel: 'إلى حساب',
    creditLabel: 'من حساب',
    debitFilter: cashLike,
    creditFilter: cashLike,
    hint: 'لا يغيّر إجمالي أموالك، ولا يُحتسب دخلًا ولا مصروفًا.',
    color: 'var(--fin-transfer)',
  },
  {
    key: 'borrow',
    label: 'اقتراض',
    debitLabel: 'إلى حساب',
    creditLabel: 'الدين الناشئ',
    debitFilter: cashLike,
    creditFilter: payable,
    hint: 'يرفع رصيدك ويُنشئ دينًا عليك. ليس دخلًا ولن يظهر في تقرير الدخل.',
    color: 'var(--fin-owed)',
    hasCounterparty: true,
  },
  {
    key: 'lend',
    label: 'إقراض',
    debitLabel: 'إلى مستحقاتي',
    creditLabel: 'الدفع من',
    debitFilter: receivable,
    creditFilter: cashLike,
    hint: 'ينقص نقدك ويُنشئ مستحقًا لك. ليس مصروفًا ولن يظهر في تقرير المصروفات.',
    color: 'var(--fin-receivable)',
    hasCounterparty: true,
  },
  {
    key: 'collectDebt',
    label: 'تحصيل دين',
    debitLabel: 'إلى حساب',
    creditLabel: 'من مستحقاتي',
    debitFilter: cashLike,
    creditFilter: receivable,
    hint: 'يرفع رصيدك وينقص ما لك عند الآخرين.',
    color: 'var(--fin-receivable)',
    hasCounterparty: true,
  },
  {
    key: 'payDebt',
    label: 'سداد دين',
    debitLabel: 'الدين المسدَّد',
    creditLabel: 'الدفع من',
    debitFilter: payable,
    creditFilter: cashLike,
    hint: 'ينقص رصيدك وينقص ما عليك. ليس مصروفًا — المال خرج عند الاقتراض لا الآن.',
    color: 'var(--fin-owed)',
    hasCounterparty: true,
  },
  {
    key: 'opening',
    label: 'رصيد افتتاحي',
    debitLabel: 'الحساب',
    creditLabel: 'المقابل',
    debitFilter: cashLike,
    creditFilter: (a) => a.accountId === 'equity.opening',
    hint: 'كم معك الآن فعلًا. يُسجَّل كقيد متوازن لا كرقم حرّ.',
    color: 'var(--accent)',
  },
]

const EXPENSE_KIND: KindUi = KINDS[0] as KindUi

export function OperationForm({
  uid,
  accounts,
  initialKind = 'expense',
}: {
  uid: string
  accounts: readonly AccountView[]
  initialKind?: OpKind
}): React.ReactElement {
  const [kindKey, setKindKey] = useState<OpKind>(initialKind)
  const [opId, setOpId] = useState(() => ulid(nowMs()))
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState<string>(() => today())
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<Scope>('personal')
  const [counterparty, setCounterparty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const kind: KindUi = KINDS.find((k) => k.key === kindKey) ?? EXPENSE_KIND
  const debitOptions = useMemo(() => accounts.filter(kind.debitFilter), [accounts, kind])
  const creditOptions = useMemo(() => accounts.filter(kind.creditFilter), [accounts, kind])

  const [debitId, setDebitId] = useState('')
  const [creditId, setCreditId] = useState('')
  const debitAccountId = debitOptions.some((a) => a.accountId === debitId)
    ? debitId
    : (debitOptions[0]?.accountId ?? '')
  const creditAccountId = creditOptions.some((a) => a.accountId === creditId)
    ? creditId
    : (creditOptions[0]?.accountId ?? '')

  const sourceBalance = accounts.find((a) => a.accountId === creditAccountId)?.balanceMinor ?? 0

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
    const res = await postOperation(uid, {
      opId,
      kind: kindKey,
      amountMinor: parsed.value,
      bookedAt: toISODate(date),
      debitAccountId,
      creditAccountId,
      description,
      scope,
      ...(counterparty.trim() === '' ? {} : { counterpartyName: counterparty }),
    })
    setBusy(false)

    if (!res.ok) {
      setError(res.error.message)
      return
    }
    setDone(`سُجِّل ${kind.label}: ${formatLYD(parsed.value)}`)
    setAmount('')
    setDescription('')
    setCounterparty('')
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
      onSubmit={(e) => {
        void submit(e)
      }}
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {KINDS.map((k) => {
          const active = k.key === kindKey
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => {
                setKindKey(k.key)
                setError(null)
                setDone(null)
              }}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: active ? k.color : 'transparent',
                borderColor: active ? k.color : 'var(--border-subtle)',
                color: active ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {k.label}
            </button>
          )
        })}
      </div>

      <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {kind.hint}
      </p>

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
            {kind.debitLabel}
          </span>
          <select
            value={debitAccountId}
            onChange={(e) => {
              setDebitId(e.target.value)
            }}
            className={field}
            style={fieldStyle}
          >
            {debitOptions.map((o) => (
              <option key={o.accountId} value={o.accountId}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {kind.creditLabel}
          </span>
          <select
            value={creditAccountId}
            onChange={(e) => {
              setCreditId(e.target.value)
            }}
            className={field}
            style={fieldStyle}
          >
            {creditOptions.map((o) => (
              <option key={o.accountId} value={o.accountId}>
                {o.name}
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

        {kind.hasScope === true && (
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
        )}

        {kind.hasCounterparty === true && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              الطرف الآخر
            </span>
            <input
              value={counterparty}
              onChange={(e) => {
                setCounterparty(e.target.value)
              }}
              placeholder="اسم الشخص أو الجهة"
              className={field}
              style={fieldStyle}
            />
          </label>
        )}

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            الوصف
          </span>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
            }}
            placeholder="غداء، راتب، تحويل للمصرف…"
            className={field}
            style={fieldStyle}
            required
          />
        </label>
      </div>

      {creditAccountId !== '' && kindKey !== 'opening' && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          رصيد {accounts.find((a) => a.accountId === creditAccountId)?.name ?? ''}:{' '}
          <span data-money className="font-medium">
            {formatLYD(unsafeMinor(sourceBalance))}
          </span>
        </p>
      )}

      <button
        type="submit"
        disabled={busy || debitAccountId === '' || creditAccountId === ''}
        className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60"
        style={{ background: kind.color, color: '#fff' }}
      >
        {busy ? 'جارٍ الحفظ…' : `حفظ ${kind.label}`}
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

