import { useEffect, useState } from 'react'

import { connectEmulatorsOnce } from '@/data/firebase/app'
import { observeSession, signOut, type SessionUser } from '@/data/firebase/auth'
import { SignInScreen } from '@/features/auth/SignInScreen'
import { formatLYD, unsafeMinor } from '@/domain/money'
import { env } from '@/lib/env'
import { today } from '@/lib/time'

type SessionState = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: SessionUser }

export function App(): React.ReactElement {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    connectEmulatorsOnce()
    return observeSession((user) => {
      setSession(user ? { status: 'in', user } : { status: 'out' })
    })
  }, [])

  if (session.status === 'loading') return <Splash />
  if (session.status === 'out') return <SignInScreen />
  return <Shell user={session.user} />
}

function Splash(): React.ReactElement {
  return (
    <main className="grid min-h-dvh place-items-center">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        جارٍ التحقّق من الجلسة…
      </p>
    </main>
  )
}

/**
 * هيكل مؤقت لما بعد تسجيل الدخول.
 *
 * **لا يعرض أي رقم مالي مُختلَق.** المبالغ أدناه أصفار حقيقية لأن قاعدة البيانات فارغة
 * ولم تُبنَ طبقة القراءة بعد — عرض أرقام تجريبية هنا يخالف القسم 25 بند 4 من المتطلبات.
 */
function Shell({ user }: { user: SessionUser }): React.ReactElement {
  const isOwner = env.VITE_OWNER_UID === '' || user.uid === env.VITE_OWNER_UID

  return (
    <div className="min-h-dvh">
      <header
        className="flex items-center justify-between border-b px-5 py-4"
        style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
      >
        <div>
          <h1 className="text-lg font-bold">رَصيد</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {today()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
        >
          خروج
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        {!isOwner && (
          <p
            role="alert"
            className="mb-6 rounded-xl border p-4 text-sm leading-relaxed"
            style={{
              background: 'var(--fin-expense-bg)',
              borderColor: 'var(--fin-expense-border)',
              color: 'var(--fin-expense)',
            }}
          >
            هذا الحساب غير معتمد للوصول إلى بيانات «رصيد». قواعد الأمان سترفض أي قراءة أو كتابة.
          </p>
        )}

        <section
          className="rounded-2xl border p-6"
          style={{ background: 'var(--surface-warm)', borderColor: 'var(--border-subtle)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            أهلًا، {user.displayName ?? 'بك'}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            UID: <span dir="ltr">{user.uid}</span>
          </p>
          <p className="mt-4 text-3xl font-bold" data-money>
            {formatLYD(unsafeMinor(0))}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            إجمالي الأموال المتاحة — لا توجد حسابات بعد
          </p>
        </section>

        <section
          className="mt-6 rounded-2xl border p-6 text-sm leading-relaxed"
          style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="mb-3 font-semibold">حالة التأسيس</h2>
          <ul className="space-y-2" style={{ color: 'var(--text-secondary)' }}>
            <li>✅ المصادقة تعمل — أنت مسجَّل الدخول الآن.</li>
            <li>✅ وحدة المال والزمن ومُولِّد المعرّفات منفَّذة ومختبَرة.</li>
            <li>⏳ طبقة البيانات والشاشات المالية قيد البناء.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}
