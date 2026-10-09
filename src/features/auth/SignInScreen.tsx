import { useState } from 'react'

import { SIGN_IN_ERROR_AR, signInWithGoogle, type SignInFailure } from '@/data/firebase/auth'
import { env } from '@/lib/env'

/**
 * شاشة تسجيل الدخول — ق-2: حساب Google فقط.
 *
 * لا حقل بريد ولا كلمة مرور، ولا «إنشاء حساب»: النظام شخصي ومغلق على UID معتمد
 * في قواعد Firestore. من يسجّل دخولًا بحساب آخر يصل إلى واجهة فارغة ترفضها القواعد.
 */
export function SignInScreen(): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<SignInFailure | null>(null)

  async function handleSignIn(): Promise<void> {
    setBusy(true)
    setFailure(null)
    const result = await signInWithGoogle()
    if (!result.ok) setFailure(result.reason)
    setBusy(false)
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div
        className="w-full max-w-sm rounded-2xl border p-8 text-center"
        style={{
          background: 'var(--surface-card)',
          borderColor: 'var(--border-subtle)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          className="mx-auto grid size-14 place-items-center rounded-2xl"
          style={{ background: 'var(--accent)' }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 64 64" className="size-9" fill="none">
            <path
              d="M20 44V20h12a8 8 0 0 1 0 16h-4l9 8"
              stroke="var(--text-on-accent)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="mt-5 text-2xl font-bold">رَصيد</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          كل مصاريفك تحت السيطرة
        </p>

        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={busy}
          className="mt-7 flex w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          {busy ? (
            <span>جارٍ فتح نافذة Google…</span>
          ) : (
            <>
              <GoogleMark />
              <span>الدخول بحساب Google</span>
            </>
          )}
        </button>

        {failure !== null && (
          <div
            role="alert"
            className="mt-4 rounded-lg border p-3 text-right text-xs leading-relaxed"
            style={{
              background: 'var(--fin-expense-bg)',
              borderColor: 'var(--fin-expense-border)',
              color: 'var(--fin-expense)',
            }}
          >
            <p>{SIGN_IN_ERROR_AR[failure]}</p>
            {failure === 'PROVIDER_DISABLED' && (
              <a
                href="https://console.firebase.google.com/project/raseed-2fac1/authentication/providers"
                target="_blank"
                rel="noreferrer"
                className="mt-2 block rounded-lg px-3 py-2 text-center font-semibold underline"
                style={{ background: 'var(--surface-card)' }}
              >
                افتح صفحة التفعيل ← Google ← Enable ← Save
              </a>
            )}
          </div>
        )}

        <p className="mt-6 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          نظام شخصي مغلق. الحساب المعتمد:
          <br />
          <span dir="ltr" className="inline-block font-medium">
            {env.VITE_OWNER_EMAIL}
          </span>
        </p>
      </div>
    </main>
  )
}

function GoogleMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M17.6 7.4H9v3.3h4.9A4.9 4.9 0 0 1 4.1 9 4.9 4.9 0 0 1 9 4.1c1.2 0 2.3.5 3.2 1.2l2.4-2.4A8.2 8.2 0 0 0 9 .8a8.2 8.2 0 1 0 8.6 6.6Z"
      />
      <path
        fill="#FF3D00"
        d="m1.7 4.8 2.7 2a4.9 4.9 0 0 1 4.6-3.2c1.2 0 2.3.5 3.2 1.2l2.4-2.4A8.2 8.2 0 0 0 1.7 4.8Z"
      />
      <path
        fill="#4CAF50"
        d="M9 17.2a8.2 8.2 0 0 0 5.5-2.1l-2.5-2.2A4.9 4.9 0 0 1 4.3 11l-2.7 2A8.2 8.2 0 0 0 9 17.2Z"
      />
      <path
        fill="#1976D2"
        d="M17.6 7.4H9v3.3h4.9a5 5 0 0 1-1.7 2.3l2.5 2.1a8 8 0 0 0 2.9-6.1c0-.6-.1-1.1-.2-1.6Z"
      />
    </svg>
  )
}
