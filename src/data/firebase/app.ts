import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { env, usingEmulators } from '@/lib/env'

/**
 * تهيئة Firebase — ADR-030.
 *
 * هذا الملف هو **المكان الوحيد** الذي يُنشئ فيه النظام اتصالًا بـ Firebase.
 * أي استيراد آخر لـ `firebase/*` خارج `src/data/**` خطأ بناء (قاعدة الطبقات).
 */

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})

export const auth = getAuth(firebaseApp)

/**
 * ق-2: مزوّد وحيد. لا بريد وكلمة مرور.
 * `prompt: 'select_account'` حتى لا يدخل المتصفح بحساب Google خاطئ صامتًا
 * عندما يكون المستخدم مسجّلًا بعدة حسابات.
 */
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

/**
 * **الكاش الدائم مُفعَّل، بمدير التبويبات المتعدد.**
 *
 * `initializeFirestore` لا `getFirestore`: التهيئة يجب أن تسبق أي استخدام.
 * `enableIndexedDbPersistence` مهجورة ومحظورة بقاعدة B12.
 *
 * `persistentMultipleTabManager` لا `persistentSingleTabManager`: المالك قد يفتح
 * تبويبين على الحاسوب، والمدير أحادي التبويب **يرمي استثناءً** في الثاني ⇒ تطبيق
 * لا يعمل بلا سبب مفهوم للمستخدم.
 *
 * `cacheSizeBytes` محدود بـ 40MB لا `CACHE_SIZE_UNLIMITED`: كاش بلا سقف ينمو على هاتف
 * محدود السعة، ولا فائدة منه هنا لأن الدفتر يُقرأ بالصفحات لا كاملًا.
 *
 * **لماذا هذا لا يهدّد صحة الأرصدة (ADR-030 §9.3):**
 * `runTransaction` **لا يقرأ من الكاش أبدًا** — قراءات `tx.get()` خادمية حصرًا مع تحقّق
 * تفاؤلي من الإصدار. ولهذا تحديدًا يفشل دون اتصال بدل أن يعمل على بيانات قديمة.
 * الخطر الوحيد الباقي هو **عرض** رصيد قديم، ويُعالَج بوسم «بيانات غير محدَّثة»
 * عبر `metadata.fromCache` لا بتعطيل الكاش.
 */
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: 40 * 1024 * 1024,
  }),
})

/**
 * ربط المحاكيات في التطوير والاختبار.
 *
 * يُستدعى مرة واحدة من نقطة الإقلاع قبل أي قراءة أو كتابة.
 * الحارس أدناه ليس تجميلًا: ربط محاكي على اتصال حيّ بمشروع الإنتاج يعني
 * كتابة بيانات اختبار في بيانات المالك الحقيقية.
 */
let emulatorsConnected = false

export function connectEmulatorsOnce(): void {
  if (!usingEmulators || emulatorsConnected) return
  emulatorsConnected = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
