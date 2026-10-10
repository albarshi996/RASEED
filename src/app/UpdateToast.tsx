import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * شريط «نسخة جديدة متاحة» — نفس نمط بوابة BrandZo.
 *
 * **لماذا هذا ضروري لا تجميلي:** عامل الخدمة يخزّن التطبيق للعمل دون اتصال،
 * فالنسخة المنشورة حديثًا لا تصل للمستخدم حتى يُستبدل العامل القديم. حدث هذا
 * فعلًا: ظهرت شاشات قديمة بعد نشرات متتالية، والمستخدم لا يعرف أنه يرى نسخة قديمة.
 *
 * الحلّ طبقتان:
 * 1. `autoUpdate` + `skipWaiting` في vite.config — العامل الجديد يحلّ محلّ القديم فورًا.
 * 2. هذا الشريط — يُعلم المستخدم ويعيد التحميل بنقرة، فلا يبقى على نسخة قديمة صامتًا.
 *
 * وفي تطبيق مالي هذا ليس ترفًا: نسخة قديمة قد تحسب رصيدًا بمنطق قديم.
 */
export function UpdateToast(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // فحص دوري للتحديثات: المتصفح يفحص عند التنقل فقط، وتطبيق يبقى مفتوحًا
      // طوال اليوم قد لا يتنقّل أبدًا فيبقى على نسخة قديمة بلا سبب.
      if (!registration) return
      setInterval(
        () => {
          void registration.update()
        },
        60 * 60 * 1000,
      )
    },
  })

  // لا تأثير لإعادة الإظهار بعد الإخفاء: من أخفى الشريط أخفاه لهذه الجلسة،
  // وأي إعادة تحميل تُظهره مجددًا إن بقي تحديث معلّق. تأثيرٌ هنا كان سيُسبّب
  // عرضًا متتاليًا بلا فائدة حقيقية.
  if (!needRefresh || dismissed) return null

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border p-3 lg:bottom-6"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--accent)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <span className="size-5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2" />
          <path d="M19 3v5h-5M5 21v-5h5" />
        </svg>
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium">نسخة جديدة من «رصيد» متاحة</p>
      <button
        type="button"
        onClick={() => {
          void updateServiceWorker(true)
        }}
        className="shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        تحديث
      </button>
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
        }}
        className="shrink-0 rounded-lg px-2 py-2 text-xs"
        style={{ color: 'var(--muted)' }}
        aria-label="إخفاء"
      >
        ✕
      </button>
    </div>
  )
}
