import { useEffect, useState } from 'react'

import { connectEmulatorsOnce } from '@/data/firebase/app'
import { observeSession, signOut, type SessionUser } from '@/data/firebase/auth'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { SignInScreen } from '@/features/auth/SignInScreen'
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
 * يعرض لوحة التحكم الحقيقية: الأرصدة من Firestore، ونموذج تسجيل المصروف،
 * وآخر العمليات. لا رقم واحد مُختلَق — كل مبلغ مشتق من قيود فعلية.
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

        <Dashboard uid={user.uid} />
      </main>
    </div>
  )
}
