import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'

import { accountTypeOf, normalSideOf, SEED_ACCOUNTS, type AccountType } from '@/domain/ledger/chartOfAccounts'

import { db } from '../firebase/app'

/** حساب كما تعرضه الواجهة. */
export interface AccountView {
  accountId: string
  name: string
  type: AccountType
  subtype: string | null
  isCashLike: boolean
  balanceMinor: number
  earmarkedMinor: number
  minBalanceMinor: number
  status: 'active' | 'archived'
  sortOrder: number
}

/** قيد كما تعرضه الواجهة. */
export interface EntryView {
  entryId: string
  kind: string
  bookedAt: string
  amountMinor: number
  description: string
  scope: 'personal' | 'household'
  categoryId: string | null
  fromAccountId: string | null
  status: string
  /** هل جاءت هذه اللقطة من الكاش المحلي؟ تُعرض للمستخدم كوسم «غير محدَّثة». */
  fromCache: boolean
}

const path = (uid: string, rest: string): string => `users/${uid}/${rest}`

/**
 * ينشئ شجرة الحسابات عند أول تسجيل دخول.
 *
 * **عديم التكرار:** يفحص وجود الحسابات أولًا، والمعرّفات ثابتة (`accountId === code`)
 * فإعادة التشغيل تكتب نفس المستندات ولا تُنشئ نسخًا. يُستخدم `writeBatch` لا
 * `runTransaction` لأن لا قرار هنا يعتمد قيمة مقروءة لحظيًا.
 *
 * الأرصدة كلها تبدأ صفرًا — والقواعد تفرض ذلك. الرصيد الافتتاحي يُدخَل لاحقًا
 * كقيد متوازن مقابل `equity.opening`، لا كحقل حرّ (§3.5).
 */
export async function ensureSeedAccounts(uid: string, firestore: Firestore = db): Promise<number> {
  const existing = await getDocs(collection(firestore, path(uid, 'accounts')))
  if (existing.size >= SEED_ACCOUNTS.length) return 0

  const have = new Set(existing.docs.map((d) => d.id))
  const missing = SEED_ACCOUNTS.filter((a) => !have.has(a.id))
  if (missing.length === 0) return 0

  // سقف الدفعة 500 عملية، والبذرة أقل من 30 — لا حاجة لتقسيم.
  const batch = writeBatch(firestore)
  for (const a of missing) {
    batch.set(doc(firestore, path(uid, `accounts/${a.id}`)), {
      ownerUid: uid,
      code: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      isCashLike: a.isCashLike,
      normalSide: normalSideOf(a.type),
      currency: 'LYD',
      status: 'active',
      sortOrder: a.sortOrder,
      schemaVersion: 1,
      debitTotalMinor: 0,
      creditTotalMinor: 0,
      balanceMinor: 0,
      openingBalanceMinor: 0,
      earmarkedMinor: 0,
      entryCount: 0,
      balanceVersion: 0,
      minBalanceMinor: a.minBalanceMinor,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
  return missing.length
}

/** اشتراك حيّ بالحسابات. يعيد دالة إلغاء الاشتراك. */
export function observeAccounts(
  uid: string,
  cb: (accounts: AccountView[], fromCache: boolean) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  const q = query(collection(firestore, path(uid, 'accounts')), orderBy('sortOrder'))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const x = d.data()
        return {
          accountId: d.id,
          name: (x['name'] as string | undefined) ?? d.id,
          type: accountTypeOf(d.id),
          subtype: (x['subtype'] as string | null | undefined) ?? null,
          isCashLike: (x['isCashLike'] as boolean | undefined) ?? false,
          balanceMinor: (x['balanceMinor'] as number | undefined) ?? 0,
          earmarkedMinor: (x['earmarkedMinor'] as number | undefined) ?? 0,
          minBalanceMinor: (x['minBalanceMinor'] as number | undefined) ?? 0,
          status: (x['status'] as AccountView['status'] | undefined) ?? 'active',
          sortOrder: (x['sortOrder'] as number | undefined) ?? 0,
        }
      })
      cb(rows, snap.metadata.fromCache)
    },
    onError,
  )
}

/** اشتراك حيّ بآخر القيود. */
export function observeRecentEntries(
  uid: string,
  count: number,
  cb: (entries: EntryView[], fromCache: boolean) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  const q = query(
    collection(firestore, path(uid, 'journalEntries')),
    where('status', '==', 'posted'),
    orderBy('bookedAtTs', 'desc'),
    limit(count),
  )
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map(toEntryView(snap.metadata.fromCache)), snap.metadata.fromCache)
    },
    onError,
  )
}

/**
 * كل القيود — للتقارير.
 *
 * بلا ترقيم صفحات عمدًا في هذه المرحلة: نظام شخصي بعشرات العمليات شهريًا،
 * وقراءة بضع مئات المستندات أرخص وأبسط من تجميع مسبق يحتاج إعادة بناء عند كل
 * تصحيح. يُستبدل بـ monthlySummaries حين تتجاوز العمليات بضعة آلاف.
 */
export function observeAllEntries(
  uid: string,
  cb: (entries: EntryView[]) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  const q = query(
    collection(firestore, path(uid, 'journalEntries')),
    where('status', '==', 'posted'),
    orderBy('bookedAtTs', 'desc'),
    limit(2000),
  )
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map(toEntryView(snap.metadata.fromCache)))
    },
    onError,
  )
}

/** محوّل واحد من مستند Firestore إلى عرض القيد — لا يُكرَّر بين الاشتراكات. */
function toEntryView(fromCache: boolean) {
  return (d: QueryDocumentSnapshot): EntryView => {
    const x = d.data()
    const lines =
      (x['lines'] as { accountId: string; side: string; categoryId?: string | null }[] | undefined) ?? []
    const debitLine = lines.find((l) => l.side === 'debit')
    const creditLine = lines.find((l) => l.side === 'credit')
    return {
      entryId: d.id,
      kind: (x['kind'] as string | undefined) ?? 'expense',
      bookedAt: (x['bookedAt'] as string | undefined) ?? '',
      amountMinor: (x['amountMinor'] as number | undefined) ?? 0,
      description: (x['description'] as string | undefined) ?? '',
      scope: (x['scope'] as EntryView['scope'] | undefined) ?? 'personal',
      categoryId: debitLine?.accountId ?? null,
      fromAccountId: creditLine?.accountId ?? null,
      status: (x['status'] as string | undefined) ?? 'posted',
      fromCache,
    }
  }
}

/**
 * النقد المتاح = مجموع أرصدة الحسابات النشطة المصنَّفة نقدًا.
 *
 * **الديون المستحقة لي مستثناة عمدًا** (القاعدة 19.9): هي أصل لكنها ليست مالًا في يدك،
 * وعرضها ضمن المتاح يجعلك تُنفق ما لم تقبضه.
 */
export function availableCashMinor(accounts: readonly AccountView[]): number {
  return accounts
    .filter((a) => a.isCashLike && a.status === 'active')
    .reduce((sum, a) => sum + a.balanceMinor, 0)
}

/** إجمالي مصروفات فترة معيّنة، من أرصدة حسابات المصروف (تراكمية من بداية العمر). */
export function totalExpensesMinor(accounts: readonly AccountView[]): number {
  return accounts.filter((a) => a.type === 'expense').reduce((sum, a) => sum + a.balanceMinor, 0)
}
