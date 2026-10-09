import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth'

import { auth, googleProvider } from './app'

/**
 * المصادقة — ق-2: Google فقط.
 *
 * **تنبيه معماري حاسم:** أي فحص هنا للمالك هو **عرض لا حماية**.
 * الإغلاق الحقيقي في `firestore.rules` عبر `approvedUids()`. من يعطّل جافاسكربت
 * أو يعدّل الحالة في أدوات المطوّر يتجاوز كل فحص في هذه الطبقة ولا يتجاوز القواعد.
 */

export interface SessionUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

function toSessionUser(u: User): SessionUser {
  return { uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL }
}

/** يشترك في تغيّر الجلسة. يعيد دالة إلغاء الاشتراك. */
export function observeSession(cb: (user: SessionUser | null) => void): () => void {
  return onAuthStateChanged(auth, (u) => {
    cb(u ? toSessionUser(u) : null)
  })
}

export type SignInFailure = 'POPUP_BLOCKED' | 'POPUP_CLOSED' | 'NETWORK' | 'PROVIDER_DISABLED' | 'UNKNOWN'

export const SIGN_IN_ERROR_AR: Record<SignInFailure, string> = {
  POPUP_BLOCKED: 'منع المتصفح نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.',
  POPUP_CLOSED: 'أُغلقت نافذة تسجيل الدخول قبل إتمامها.',
  NETWORK: 'تعذّر الاتصال. تحقّق من الإنترنت ثم أعد المحاولة.',
  PROVIDER_DISABLED:
    'تسجيل الدخول بحساب Google غير مُفعَّل في مشروع Firebase. فعِّله من: Authentication ← Sign-in method ← Google.',
  UNKNOWN: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
}

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; reason: SignInFailure }

/**
 * تسجيل الدخول بنافذة منبثقة.
 *
 * `signInWithPopup` لا `signInWithRedirect`: التوجيه يفقد حالة التطبيق ويتعطّل في
 * بعض المتصفحات التي تمنع كوكيز الطرف الثالث، والنافذة المنبثقة تُعطي خطأً واضحًا
 * يمكن عرضه بدل صفحة بيضاء بلا تفسير.
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  try {
    const cred = await signInWithPopup(auth, googleProvider)
    return { ok: true, user: toSessionUser(cred.user) }
  } catch (err: unknown) {
    return { ok: false, reason: classify(err) }
  }
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth)
}

function classify(err: unknown): SignInFailure {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : ''
  switch (code) {
    case 'auth/popup-blocked':
      return 'POPUP_BLOCKED'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'POPUP_CLOSED'
    case 'auth/network-request-failed':
      return 'NETWORK'
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return 'PROVIDER_DISABLED'
    default:
      return 'UNKNOWN'
  }
}
