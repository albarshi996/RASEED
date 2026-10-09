import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * حدود الطبقات (ADR-018).
 *
 * انحراف موثّق عن نص ADR-018: الوثيقة اقترحت `eslint-plugin-boundaries`، وقد رُفض
 * لأنه يجرّ `handlebars@4.7.9` بثغرتين حرجتين (GHSA-8r5x-fm3f-whwj و GHSA-p8wg-vrv2-v86f)
 * و`braces@3.0.3` بثغرة عالية. البديل المعتمد هنا يحقق نفس الفرض بقواعد ESLint الأصلية
 * وبصفر اعتماديات إضافية. المحصّلة: `npm audit` = 0 ثغرات.
 *
 * اتجاه الاعتماد المسموح، ولا شيء غيره:
 *
 *     app  →  features  →  ui
 *               ↓   ↘
 *             data  →  domain  →  lib
 *
 * القاعدة الذهبية: `domain` نقية 100% — صفر استيراد من firebase ومن data.
 * هي المكان الوحيد الذي يبني lines و side (عقد النواة §1.1).
 */

/**
 * أنماط no-restricted-imports تُطابَق بدلالات gitignore لا minimatch المثبّت:
 * النمط 'firebase/*' يطابق أي مسار يحوي المقطع، ومنه '@/data/firebase/auth' المشروع تمامًا.
 * لذلك تُستخدم regex مثبَّتة على بداية اسم الوحدة.
 * @param {string[]} specs @param {string} message
 */
const forbid = (specs, message) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: specs.map((s) => ({
        regex: '^' + s.replaceAll('/', '\\/').replaceAll('.', '\\.') + '(\\/|$)',
        message,
      })),
    },
  ],
})

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'dev-dist', 'node_modules', '.firebase'] },

  // ── الأساس ───────────────────────────────────────────────────────────────
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // نظام مالي: الأخطاء الصامتة ممنوعة.
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // المال عدد صحيح بالدرهم (ADR-001). الكسور العشرية في الحساب عيب، لا أسلوب.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name=/^(round|floor|ceil|trunc)$/]",
          message:
            'ممنوع التقريب المباشر على المبالغ. استخدم دوال src/domain/money (splitEven · allocateByWeights · mulRate) التي تضمن انعدام ضياع الوحدات.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'ممنوع new Date() المباشر. استخدم src/lib/time (توقيت ليبيا UTC+2 ثابت) وإلا انحرفت حدود الشهر المالي.',
        },
      ],
    },
  },

  // ── استثناء حظر التقريب ──
  // (أ) domain/money: الطبقة التي تُنفّذ التقريب الصحيح بنفسها — منعها يعني استحالة كتابتها.
  // (ب) lib: ممنوعة بقاعدة الطبقات من استيراد domain، فلا يصلها نوع Minor إطلاقًا.
  //     الاستثناء هنا مبدئي لا ترخيص: Math.floor على فهرس أو طابع زمني ليس تقريبًا على مال.
  // كلا المسارين مغطّى باختبارات خاصية.
  {
    files: ['src/domain/money/**/*.ts', 'src/lib/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // ── domain: نقية. لا firebase، لا data، لا واجهات. ───────────────────────
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: forbid(
      [
        'firebase',
        'firebase/*',
        '@firebase/*',
        '@/data',
        '@/data/*',
        '@/features',
        '@/features/*',
        '@/ui',
        '@/ui/*',
        '@/app',
        '@/app/*',
      ],
      'طبقة domain نقية: ممنوع استيراد firebase أو data أو ui أو features. المنطق المحاسبي لا يعرف أين تُخزَّن البيانات.',
    ),
  },

  // ── data: الطبقة الوحيدة التي تلمس Firestore. لا تعرف الواجهات. ──────────
  {
    files: ['src/data/**/*.{ts,tsx}'],
    rules: forbid(
      ['@/features', '@/ui', '@/app'],
      'طبقة data لا تستورد من الواجهات. الاتجاه دائمًا features → data، لا العكس.',
    ),
  },

  // ── ui: مكونات عرض غبية. لا بيانات ولا منطق أعمال. ───────────────────────
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: forbid(
      [
        'firebase',
        'firebase/*',
        '@firebase/*',
        '@/data',
        '@/data/*',
        '@/features',
        '@/features/*',
        '@/app',
        '@/app/*',
        '@/domain/ops',
        '@/domain/ops/*',
      ],
      'مكونات ui لا تجلب بيانات ولا تنفّذ عمليات. تستقبل props فقط (يُسمح باستيراد الأنواع من @/domain/types).',
    ),
  },

  // ── features: لا تلمس Firestore مباشرة. تمرّ عبر data. ───────────────────
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: forbid(
      ['firebase', '@firebase'],
      'الشاشات لا تستورد firebase مباشرة. كل وصول للبيانات يمرّ عبر @/data.',
    ),
  },

  // ── lib: أدوات عامة بلا أي معرفة بالمجال. ────────────────────────────────
  {
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: forbid(
      [
        '@/domain',
        '@/domain/*',
        '@/data',
        '@/data/*',
        '@/features',
        '@/features/*',
        '@/ui',
        '@/ui/*',
        '@/app',
        '@/app/*',
      ],
      'طبقة lib أدوات عامة: لا تعرف شيئًا عن المجال. أي منطق مالي مكانه domain.',
    ),
  },

  // ── الاختبارات: تُعفى من قيود الطبقات وتُسمح لها الأدوات. ────────────────
  {
    files: ['tests/**/*.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  // ── ملفات تهيئة Node ─────────────────────────────────────────────────────
  {
    files: ['*.config.{ts,js}', 'scripts/**/*.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
)
