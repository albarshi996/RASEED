import { useEffect, useState } from 'react'

import { signOut, type SessionUser } from '@/data/firebase/auth'
import { today } from '@/lib/time'

/**
 * هيكل التطبيق — شريط جانبي على الحاسوب وشريط سفلي على الهاتف.
 *
 * **لماذا شريط سفلي لا قائمة هامبرغر على الهاتف:** تسجيل المصروف فعل يومي متكرر
 * يُنجز بيد واحدة أثناء الحركة. القائمة المطوية تُضيف نقرة قبل كل عملية، والشريط
 * السفلي في متناول الإبهام. (نفس منطق التثبيت في شريط BrandZo الجانبي.)
 */

export type Route = 'dashboard' | 'debts' | 'obligations' | 'planning' | 'accounts' | 'reports'

interface NavItem {
  key: Route
  label: string
  icon: React.ReactElement
}

const DESKTOP_ONLY: readonly NavItem[] = [{ key: 'accounts', label: 'الحسابات', icon: <IconWallet /> }]

const NAV: readonly NavItem[] = [
  { key: 'dashboard', label: 'الرئيسية', icon: <IconHome /> },
  { key: 'obligations', label: 'الالتزامات', icon: <IconCalendar /> },
  { key: 'debts', label: 'الديون', icon: <IconHandshake /> },
  { key: 'planning', label: 'التخطيط', icon: <IconTarget /> },
  { key: 'reports', label: 'التقارير', icon: <IconChart /> },
]

export function AppShell({
  user,
  route,
  onRoute,
  children,
}: {
  user: SessionUser
  route: Route
  onRoute: (r: Route) => void
  children: React.ReactNode
}): React.ReactElement {
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => readTheme())

  useEffect(() => {
    const el = document.documentElement
    if (theme === 'auto') el.removeAttribute('data-theme')
    else el.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('raseed:theme', theme)
    } catch {
      // التخزين قد يكون محجوبًا (نافذة خاصة) — التفضيل يضيع ولا يتعطّل شيء.
    }
  }, [theme])

  return (
    <div className="min-h-dvh lg:flex">
      {/* ── الشريط الجانبي: الحاسوب فقط ── */}
      <aside
        className="hidden w-60 shrink-0 flex-col border-s p-4 lg:flex"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span
            className="grid size-9 place-items-center rounded-xl"
            style={{ background: 'var(--accent)' }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 64 64" className="size-6" fill="none">
              <path
                d="M20 44V20h12a8 8 0 0 1 0 16h-4l9 8"
                stroke="#fff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">رَصيد</p>
            <p className="text-[11px]" style={{ color: 'var(--muted)' }} dir="ltr">
              {today()}
            </p>
          </div>
        </div>

        <nav className="flex-1">
          <ul className="space-y-1">
            {[...NAV, ...DESKTOP_ONLY].map((item) => (
              <li key={item.key}>
                <NavButton item={item} active={route === item.key} onClick={() => { onRoute(item.key) }} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <ThemeToggle theme={theme} onChange={setTheme} />
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="truncate text-xs" style={{ color: 'var(--muted)' }}>
              {user.displayName ?? user.email}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="shrink-0 rounded-lg border px-2 py-1 text-[11px]"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
            >
              خروج
            </button>
          </div>
        </div>
      </aside>

      {/* ── المحتوى ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ترويسة الهاتف */}
        <header
          className="flex items-center justify-between border-b px-4 py-3 lg:hidden"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <div>
            <h1 className="text-base font-bold leading-tight">رَصيد</h1>
            <p className="text-[11px]" style={{ color: 'var(--muted)' }} dir="ltr">
              {today()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onChange={setTheme} compact />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border px-2.5 py-1.5 text-xs"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
            >
              خروج
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      {/* ── الشريط السفلي: الهاتف فقط ── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t lg:hidden"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--line)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {NAV.map((item) => {
          const active = route === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => { onRoute(item.key) }}
              className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium"
              style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}
              aria-current={active ? 'page' : undefined}
            >
              <span className="size-5">{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
      style={{
        background: active ? 'var(--chip)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-2)',
      }}
      aria-current={active ? 'page' : undefined}
    >
      <span className="size-[18px]">{item.icon}</span>
      {item.label}
    </button>
  )
}

function ThemeToggle({
  theme,
  onChange,
  compact = false,
}: {
  theme: 'auto' | 'light' | 'dark'
  onChange: (t: 'auto' | 'light' | 'dark') => void
  compact?: boolean
}): React.ReactElement {
  const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto'
  const label = theme === 'auto' ? 'تلقائي' : theme === 'light' ? 'فاتح' : 'داكن'
  return (
    <button
      type="button"
      onClick={() => { onChange(next) }}
      className={`rounded-lg border text-xs ${compact ? 'px-2.5 py-1.5' : 'w-full px-3 py-2 text-start'}`}
      style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
      title={`المظهر: ${label} — اضغط للتبديل`}
    >
      {compact ? <span className="size-4 block"><IconTheme /></span> : `المظهر: ${label}`}
    </button>
  )
}

function readTheme(): 'auto' | 'light' | 'dark' {
  try {
    const v = localStorage.getItem('raseed:theme')
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {
    // محجوب — نعود إلى التلقائي.
  }
  return 'auto'
}

/* ── أيقونات مضمَّنة: لا مكتبة أيقونات خارجية لخمس أيقونات. ── */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IconHome(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  )
}
function IconCalendar(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}
function IconHandshake(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <path d="m7 11 3-3 4 4 3-3 4 4-5 5-3-3-3 3-5-5z" />
      <path d="M3 10h4" />
    </svg>
  )
}
function IconWallet(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14h2" />
    </svg>
  )
}
function IconChart(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}
function IconTarget(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function IconTheme(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-full" {...S}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}
