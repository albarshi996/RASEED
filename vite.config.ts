import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'رصيد | RASEED',
        short_name: 'رصيد',
        description: 'منظومة الإدارة المالية والشخصية المتكاملة',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // التطبيق shell فقط. بيانات Firestore لا تُخزَّن هنا إطلاقًا —
        // الكاش الوحيد المسموح للبيانات هو كاش Firestore نفسه، وإلا ظهرت أرصدة قديمة.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // دالة لا كائن: Rollup الحديث يقبل ManualChunksFunction فقط.
        // الهدف فصل Firebase (ثقيل ونادر التغيير) عن كود التطبيق حتى لا يُبطل
        // كل تحديث للتطبيق كاش المكتبة في المتصفح.
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase')) {
            return 'firebase'
          }
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
})
