import { useEffect, useState } from 'react'

import { connectEmulatorsOnce } from '@/data/firebase/app'
import { observeSession, type SessionUser } from '@/data/firebase/auth'
import { ensureSeedAccounts, observeAccounts, type AccountView } from '@/data/repos/ledgerRepo'
import { SignInScreen } from '@/features/auth/SignInScreen'
import { AccountsScreen } from '@/features/accounts/AccountsScreen'
import { DebtsScreen, ErrorBox, Loading } from '@/features/commitments/DebtsScreen'
import { ObligationsScreen } from '@/features/commitments/ObligationsScreen'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { ReportsScreen } from '@/features/reports/ReportsScreen'
import { env } from '@/lib/env'

import { AppShell, type Route } from './AppShell'

type SessionState = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: SessionUser }

export function App(): React.ReactElement {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    connectEmulatorsOnce()
    return observeSession((user) => {
      setSession(user ? { status: 'in', user } : { status: 'out' })
    })
  }, [])

  if (session.status === 'loading') {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          جارٍ التحقّق من الجلسة…
        </p>
      </main>
    )
  }
  if (session.status === 'out') return <SignInScreen />
  return <SignedIn user={session.user} />
}

/**
 * الحسابات تُحمَّل **مرة واحدة هنا** وتُمرَّر لكل الشاشات.
 *
 * السبب ليس الأداء وحده: اشتراك منفصل في كل شاشة يعني أن رصيدًا تغيّر قد يظهر
 * محدَّثًا في شاشة وقديمًا في أخرى خلال اللحظة نفسها — وهو أسوأ من بطء.
 */
function SignedIn({ user }: { user: SessionUser }): React.ReactElement {
  const [route, setRoute] = useState<Route>('dashboard')
  const [accounts, setAccounts] = useState<AccountView[] | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(true)

  const isOwner = env.VITE_OWNER_UID === '' || user.uid === env.VITE_OWNER_UID

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        await ensureSeedAccounts(user.uid)
      } catch (e: unknown) {
        if (!cancelled) setFatal(describe(e))
      }
      if (!cancelled) setSeeding(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [user.uid])

  useEffect(() => {
    return observeAccounts(
      user.uid,
      (rows) => { setAccounts(rows) },
      (e) => { setFatal(describe(e)) },
    )
  }, [user.uid])

  return (
    <AppShell user={user} route={route} onRoute={setRoute}>
      {!isOwner && (
        <div className="mb-5">
          <ErrorBox message="هذا الحساب غير معتمد للوصول إلى بيانات «رصيد». قواعد الأمان سترفض أي قراءة أو كتابة." />
        </div>
      )}

      {fatal !== null ? (
        <ErrorBox message={fatal} />
      ) : accounts === null || seeding ? (
        <Loading />
      ) : (
        <>
          {route === 'dashboard' && <Dashboard uid={user.uid} accounts={accounts} />}
          {route === 'obligations' && <ObligationsScreen uid={user.uid} accounts={accounts} />}
          {route === 'debts' && <DebtsScreen uid={user.uid} accounts={accounts} />}
          {route === 'accounts' && <AccountsScreen uid={user.uid} accounts={accounts} />}
          {route === 'reports' && <ReportsScreen uid={user.uid} accounts={accounts} />}
        </>
      )}
    </AppShell>
  )
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
