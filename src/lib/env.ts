import { z } from 'zod'

/**
 * متغيرات البيئة — يُتحقَّق منها **مرة واحدة عند الإقلاع**.
 *
 * **لماذا التحقق أصلًا:** متغير Firebase ناقص لا يُنتج خطأ مفهومًا، بل فشلًا غامضًا
 * في أول استدعاء شبكة بعد دقائق من الاستخدام. الفشل هنا فوري وبرسالة تقول أي متغير ناقص.
 *
 * **`apiKey` ليس سرًّا.** هو معرّف عام يظهر في أي تطبيق ويب Firebase، وأي شخص يفتح
 * أدوات المطوّر يراه. الحماية الفعلية طبقتان: Security Rules (تغلق النظام على UID معتمد)
 * وتقييد المفتاح على نطاقات محدّدة في Google Cloud Console. وجوده في `.env` تنظيم لا إخفاء.
 */

const schema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1, 'مفتاح Firebase مفقود'),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1, 'نطاق المصادقة مفقود'),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1, 'معرّف المشروع مفقود'),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().default(''),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1, 'معرّف المُرسِل مفقود'),
  VITE_FIREBASE_APP_ID: z.string().min(1, 'معرّف التطبيق مفقود'),
  VITE_FIREBASE_MEASUREMENT_ID: z.string().optional(),

  /** البريد المعتمد — للعرض وللرسائل فقط. **القواعد تعتمد UID لا البريد** (ق-2). */
  VITE_OWNER_EMAIL: z.email('بريد المالك غير صالح'),

  /**
   * UID المالك. فارغ قبل أول تسجيل دخول، ويُملأ بعده ثم يُثبَّت في القواعد.
   * الواجهة تستخدمه للعرض فقط — **الإغلاق الحقيقي في Security Rules**، لأن أي فحص
   * في الواجهة يلتفّ عليه أي شخص بأدوات المطوّر.
   */
  VITE_OWNER_UID: z.string().default(''),

  VITE_USE_EMULATORS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
})

export type Env = z.infer<typeof schema>

function load(): Env {
  const parsed = schema.safeParse(import.meta.env)
  if (parsed.success) return parsed.data

  const missing = parsed.error.issues.map((i) => `• ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(
    `تهيئة البيئة ناقصة أو غير صالحة.\n${missing}\n\nانسخ .env.example إلى .env.local واملأ القيم.`,
  )
}

export const env: Env = load()

/** هل نعمل على محاكي محلي؟ يُستخدم لمنع أي اتصال بمشروع الإنتاج أثناء الاختبار. */
export const usingEmulators = env.VITE_USE_EMULATORS

export const isDev = import.meta.env.DEV
