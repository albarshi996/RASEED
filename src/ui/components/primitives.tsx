/**
 * مكوّنات الواجهة المشتركة — مستوحاة من أسلوب بوابة BrandZo.
 *
 * **لماذا مكتبة مكوّنات لا أصناف مكرَّرة:** كانت الشاشات تكرّر نفس
 * `rounded-2xl border p-5 style={{...}}` في كل مكان، فأي تغيير في شكل البطاقة
 * يتطلب تعديل عشرات المواضع — وأولها يُنسى. المكوّن يجعل الشكل قرارًا واحدًا.
 */

export function Card({
  children,
  className = '',
  tone = 'default',
}: {
  children: React.ReactNode
  className?: string
  tone?: 'default' | 'warm' | 'sunken'
}): React.ReactElement {
  const bg =
    tone === 'warm' ? 'var(--surface-warm)' : tone === 'sunken' ? 'var(--surface-sunken)' : 'var(--surface)'
  return (
    <div
      className={`rounded-2xl border p-5 ${className}`}
      style={{ background: bg, borderColor: 'var(--line)', boxShadow: 'var(--shadow-md)' }}
    >
      {children}
    </div>
  )
}

/**
 * ترويسة الصفحة — عنوان عربي كبير، ترجمة لاتينية، وصف، وخط تمييز.
 * الخط المائل تحت العنوان هو ما يعطي الصفحة «بداية» بصرية بدل أن تبدأ فجأة.
 */
export function PageHeader({
  title,
  subtitle,
  description,
  action,
}: {
  title: string
  subtitle?: string
  description?: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {subtitle !== undefined && (
          <p className="mt-0.5 text-sm" style={{ color: 'var(--muted)' }} dir="ltr">
            {subtitle}
          </p>
        )}
        {description !== undefined && (
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {description}
          </p>
        )}
        <span
          className="mt-3 block h-[3px] w-20 rounded-full"
          style={{ background: 'linear-gradient(to left, var(--accent), transparent)' }}
        />
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </header>
  )
}

/** عنوان قسم مع خطّ متدرّج يملأ المسافة — يفصل الأقسام بلا صندوق إضافي. */
export function SectionTitle({
  children,
  icon,
  trailing,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  trailing?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="flex shrink-0 items-center gap-2 text-base font-bold">
        {icon !== undefined && <span className="size-[18px]" style={{ color: 'var(--accent)' }}>{icon}</span>}
        {children}
      </h2>
      <span
        className="h-px flex-1"
        style={{ background: 'linear-gradient(to left, var(--line-strong), transparent)' }}
      />
      {trailing !== undefined && <span className="shrink-0">{trailing}</span>}
    </div>
  )
}

/** صفّ قابل للنقر: أيقونة · عنوان · سهم. نمط التنقل الأساسي في بوابة BrandZo. */
export function RowButton({
  label,
  hint,
  icon,
  trailing,
  onClick,
  tone,
}: {
  label: string
  hint?: string
  icon?: React.ReactNode
  trailing?: React.ReactNode
  onClick: () => void
  tone?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
    >
      {icon !== undefined && (
        <span className="size-[18px] shrink-0" style={{ color: tone ?? 'var(--accent)' }}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {hint !== undefined && (
          <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        )}
      </span>
      {trailing}
      <svg
        viewBox="0 0 24 24"
        className="size-4 shrink-0 transition-transform group-hover:-translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--muted)' }}
        aria-hidden="true"
      >
        <path d="m14 6-6 6 6 6" />
      </svg>
    </button>
  )
}

export function Chip({
  children,
  tone = 'var(--muted)',
  title,
}: {
  children: React.ReactNode
  tone?: string
  title?: string
}): React.ReactElement {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: 'var(--chip)', color: tone }}
      title={title}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  tone,
  full = false,
}: {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'outline' | 'ghost'
  disabled?: boolean
  tone?: string
  full?: boolean
}): React.ReactElement {
  const color = tone ?? 'var(--accent)'
  const style =
    variant === 'primary'
      ? { background: color, color: '#fff', borderColor: color }
      : variant === 'outline'
        ? { background: 'transparent', color, borderColor: color }
        : { background: 'transparent', color: 'var(--ink-2)', borderColor: 'var(--line-strong)' }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${full ? 'w-full' : ''}`}
      style={style}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="mt-1 block text-[11px]" style={{ color: 'var(--muted)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

/** صنف موحَّد لكل حقول الإدخال — يمنع اختلاف ارتفاعات الحقول بين الشاشات. */
export const inputClass =
  'w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:border-current'
export const inputStyle = {
  background: 'var(--surface-page)',
  borderColor: 'var(--line-strong)',
  color: 'var(--ink)',
}
/** حقل المبالغ: لاتيني الاتجاه بأرقام جدولية دائمًا (ق-3). */
export const amountClass = `${inputClass} tabular text-start`

export function Alert({
  children,
  tone = 'danger',
}: {
  children: React.ReactNode
  tone?: 'danger' | 'success' | 'info'
}): React.ReactElement {
  const map = {
    danger: ['var(--fin-expense-bg)', 'var(--fin-expense-border)', 'var(--fin-expense)'],
    success: ['var(--fin-income-bg)', 'var(--fin-income-border)', 'var(--fin-income)'],
    info: ['var(--fin-transfer-bg)', 'var(--fin-transfer-border)', 'var(--fin-transfer)'],
  }[tone]
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className="rounded-xl border p-3 text-xs leading-relaxed"
      style={{ background: map[0], borderColor: map[1], color: map[2] }}
    >
      {children}
    </p>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
      {children}
    </p>
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
  return <Alert tone="danger">{message}</Alert>
}

/** شريط تقدّم — يُستخدم في الميزانيات والأهداف والديون، فلا يُرسم ثلاث مرات. */
export function Progress({
  percent,
  color,
  thick = false,
}: {
  percent: number
  color: string
  thick?: boolean
}): React.ReactElement {
  return (
    <div
      className={`overflow-hidden rounded-full ${thick ? 'h-2' : 'h-1.5'}`}
      style={{ background: 'var(--surface-sunken)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${String(Math.max(0, Math.min(100, percent)))}%`, background: color }}
      />
    </div>
  )
}

/** تسمية حقل مستقلة — لمن يحتاج التسمية بلا غلاف Field. */
export function Lbl({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
      {children}
    </span>
  )
}
