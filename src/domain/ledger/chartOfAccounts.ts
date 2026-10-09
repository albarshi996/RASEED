/**
 * شجرة الحسابات والتهيئة الأولى — عقد النواة §3.
 *
 * **القاعدة الحاكمة (I-COA-1):** `accountId` هو رمز الحساب نفسه، وبادئته تساوي نوعه دائمًا.
 * فـ `expense.food` حساب مصروف حتمًا. هذا يغني عن قراءة مستند الحساب لتصنيف أي سطر،
 * ويجعل التقرير دالّة في **نوع الحساب** لا في حقل وصفي قابل للخطأ.
 *
 * **الفئة = حساب مصروف** (§3.7). لا مجموعة `categories` منفصلة: الفئة الفرعية ابن في الشجرة.
 * تعطيل فئة = أرشفة حساب، فلا تتأثر السجلات التاريخية.
 */

export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity'
export type AccountSubtype = 'cash' | 'bank' | 'wallet' | 'payable' | 'receivable' | 'financing' | null

export interface SeedAccount {
  id: string
  name: string
  type: AccountType
  subtype: AccountSubtype
  /** هل يُحتسب ضمن «النقد المتاح»؟ الديون المستحقة لي ليست نقدًا (القاعدة 19.9). */
  isCashLike: boolean
  /** حدّ الرصيد الموقَّع. صفر = لا يُسمح بالسالب. */
  minBalanceMinor: number
  sortOrder: number
}

/** الجانب الطبيعي: الأصول والمصروفات تزيد بالمدين، والباقي بالدائن. */
export function normalSideOf(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit'
}

/** نوع الحساب من معرّفه — البادئة قبل أول نقطة. */
export function accountTypeOf(id: string): AccountType {
  const dot = id.indexOf('.')
  return (dot === -1 ? id : id.slice(0, dot)) as AccountType
}

const a = (
  id: string,
  name: string,
  type: AccountType,
  sortOrder: number,
  subtype: AccountSubtype = null,
  isCashLike = false,
): SeedAccount => ({ id, name, type, subtype, isCashLike, minBalanceMinor: 0, sortOrder })

/**
 * حسابات التهيئة الأولى — تُنشأ مرة واحدة عند أول تسجيل دخول.
 *
 * فئات المصروف مأخوذة من القسم 6 من المتطلبات حرفيًا، مع ثلاث إضافات تقنية مبرَّرة:
 * `expense.zakatCharity` (القسم 15.4)، و`expense.financeCharges` (مقصد `extraChargesMinor`
 * في ADR-012)، و`expense.other` (صمّام يمنع حجب عملية عن المستخدم).
 */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  // ── الأصول النقدية ──────────────────────────────────────────
  a('asset.cash', 'النقد الشخصي', 'asset', 10, 'cash', true),
  a('asset.bank', 'الحساب المصرفي', 'asset', 20, 'bank', true),
  a('asset.wallet', 'المحفظة الإلكترونية', 'asset', 30, 'wallet', true),
  // الديون المستحقة لي أصل، لكنه **ليس نقدًا متاحًا** (القاعدة 19.9 — مفروضة في القواعد)
  a('asset.receivable', 'مستحقات لي لدى الآخرين', 'asset', 40, 'receivable', false),

  // ── الخصوم ──────────────────────────────────────────────────
  a('liability.payable', 'ديون مستحقة عليّ', 'liability', 100, 'payable', false),
  a('liability.obligations', 'التزامات مستحقة', 'liability', 110, 'payable', false),
  a('liability.financing', 'أقساط وتمويل', 'liability', 120, 'financing', false),

  // ── الدخل ───────────────────────────────────────────────────
  a('income.salary', 'الراتب الشهري', 'income', 200),
  a('income.bonus', 'المكافآت', 'income', 210),
  a('income.freelance', 'أعمال إضافية', 'income', 220),
  a('income.investment', 'إيرادات استثمارية', 'income', 230),
  a('income.gift', 'هدايا مالية', 'income', 240),
  a('income.other', 'دخل آخر', 'income', 290),

  // ── المصروفات (= الفئات، القسم 6) ───────────────────────────
  a('expense.food', 'الطعام والمشروبات', 'expense', 300),
  a('expense.transport', 'المواصلات والوقود', 'expense', 310),
  a('expense.home', 'مصاريف المنزل', 'expense', 320),
  a('expense.shopping', 'المشتريات', 'expense', 330),
  a('expense.telecom', 'الاتصالات والإنترنت', 'expense', 340),
  a('expense.health', 'الصحة', 'expense', 350),
  a('expense.entertainment', 'الترفيه', 'expense', 360),
  a('expense.gifts', 'الهدايا', 'expense', 370),
  a('expense.subscriptions', 'الاشتراكات', 'expense', 380),
  a('expense.travel', 'السفر', 'expense', 390),
  a('expense.emergency', 'المصروفات الطارئة', 'expense', 400),
  a('expense.zakatCharity', 'الزكاة والصدقات', 'expense', 410),
  a('expense.financeCharges', 'غرامات ورسوم تمويل', 'expense', 420),
  a('expense.other', 'مصروفات أخرى', 'expense', 490),

  // ── حقوق الملكية ────────────────────────────────────────────
  a('equity.opening', 'الرصيد الافتتاحي', 'equity', 900),
  a('equity.adjustment', 'تسويات', 'equity', 910),
]

/** الحسابات التي تُحتسب ضمن «النقد المتاح». */
export const CASH_LIKE_IDS: readonly string[] = SEED_ACCOUNTS.filter((x) => x.isCashLike).map((x) => x.id)

/** فئات المصروف المعروضة في نموذج الإدخال. */
export const EXPENSE_CATEGORY_IDS: readonly string[] = SEED_ACCOUNTS.filter((x) => x.type === 'expense').map(
  (x) => x.id,
)

export function seedAccountById(id: string): SeedAccount | undefined {
  return SEED_ACCOUNTS.find((x) => x.id === id)
}
