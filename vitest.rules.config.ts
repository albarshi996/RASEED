import { defineConfig } from 'vitest/config'

/**
 * اختبارات قواعد الأمان — تحتاج محاكي Firestore (ومنه Java).
 * تُشغَّل عبر: npm run test:rules  (يُشغّل المحاكي ثم ينفّذ)
 * مفصولة عن vitest.config.ts حتى لا يتعطّل `npm test` على جهاز بلا Java.
 */
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
