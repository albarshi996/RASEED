import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude: ['tests/rules/**', 'tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // المنطق المالي النقي لا يُقبل فيه أقل من تغطية شبه كاملة.
      include: ['src/domain/**', 'src/lib/**'],
      // ملفات الأنواع لا تحمل كودًا تنفيذيًا — إدراجها يشوّه الرقم بلا فائدة.
      exclude: ['src/domain/types/**', '**/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
    // ملاحظة: `environmentMatchGlobs` أُزيل في Vitest 5.
    // اختبارات الواجهة تعلن بيئتها بنفسها بسطر في رأس الملف:
    //   /** @vitest-environment jsdom */
    // وهذا أوضح من قاعدة مسار خفية في ملف التهيئة.
  },
})
