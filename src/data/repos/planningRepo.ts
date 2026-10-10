import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore'

import { type CategoryBudget } from '@/domain/planning/budget'
import { type Minor } from '@/domain/money'
import { nowMs, type ISODate, type PeriodKey } from '@/lib/time'
import { ulid } from '@/lib/ulid'

import { db } from '../firebase/app'

const p = (uid: string, rest: string): string => `users/${uid}/${rest}`

// ──────────────────────────── الميزانيات ────────────────────────────

export interface BudgetDoc {
  periodKey: string
  overallCapMinor: number
  categories: CategoryBudget[]
}

/**
 * الميزانية مستند واحد لكل شهر، معرّفه هو مفتاح الفترة.
 *
 * **لماذا مستند واحد لا مستند لكل فئة:** سقوف الفئات تُقرأ وتُحرَّر معًا دائمًا،
 * وعددها عشرات لا آلاف. مستند واحد = قراءة واحدة لكل شاشة ميزانية بدل 25،
 * وتحرير ذرّي بلا تعارض جزئي.
 */
export async function saveBudget(
  uid: string,
  budget: BudgetDoc,
  firestore: Firestore = db,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await setDoc(
      doc(firestore, p(uid, `budgetPeriods/${budget.periodKey}`)),
      {
        ownerUid: uid,
        schemaVersion: 1,
        periodKey: budget.periodKey,
        overallCapMinor: budget.overallCapMinor,
        categories: budget.categories.filter((c) => c.capMinor > 0),
        // القواعد تفرض وجود هذا الحقل. الفعلي يُحسب من الدفتر لا منه،
        // لكنه يبقى صفرًا هنا كي لا يُقرأ خطأً كمصدر للفعلي.
        overallSpentMinor: 0,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
    return { ok: true }
  } catch {
    return { ok: false, message: 'تعذّر حفظ الميزانية.' }
  }
}

export function observeBudget(
  uid: string,
  periodKey: PeriodKey,
  cb: (b: BudgetDoc | null) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  return onSnapshot(
    doc(firestore, p(uid, `budgetPeriods/${periodKey}`)),
    (snap) => {
      if (!snap.exists()) {
        cb(null)
        return
      }
      const x = snap.data()
      cb({
        periodKey,
        overallCapMinor: (x['overallCapMinor'] as number | undefined) ?? 0,
        categories: (x['categories'] as CategoryBudget[] | undefined) ?? [],
      })
    },
    onError,
  )
}

// ────────────────────────── الأهداف المالية ──────────────────────────

export interface GoalView {
  id: string
  name: string
  targetMinor: number
  savedMinor: number
  deadline: string | null
  /** الحساب الذي يُحجَز منه المبلغ. */
  fundingAccountId: string
  status: 'active' | 'reached' | 'cancelled'
  notes: string
}

export interface NewGoalInput {
  name: string
  targetMinor: Minor
  deadline: ISODate | null
  fundingAccountId: string
  notes: string
}

export async function createGoal(
  uid: string,
  input: NewGoalInput,
  firestore: Firestore = db,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (input.name.trim() === '') return { ok: false, message: 'اكتب اسم الهدف.' }
  const target = input.targetMinor as number
  if (!Number.isInteger(target) || target <= 0) {
    return { ok: false, message: 'قيمة الهدف يجب أن تكون أكبر من صفر.' }
  }
  const id = ulid(nowMs())
  try {
    await setDoc(doc(firestore, p(uid, `financialGoals/${id}`)), {
      ownerUid: uid,
      schemaVersion: 1,
      name: input.name.trim(),
      targetMinor: target,
      savedMinor: 0,
      deadline: input.deadline,
      fundingAccountId: input.fundingAccountId,
      status: 'active',
      notes: input.notes.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return { ok: true, id }
  } catch {
    return { ok: false, message: 'تعذّر حفظ الهدف.' }
  }
}

/**
 * تخصيص مبلغ لهدف — **حجز لا حركة مالية**.
 *
 * لا قيد ولا تغيّر في الرصيد: المال ما زال في الحساب. ما يتغيّر هو
 * `earmarkedMinor` على الحساب و`savedMinor` على الهدف، ذرّيًا معًا.
 *
 * الحجز يُطرح من «المتاح للإنفاق» لا من الرصيد، فيبقى ميزان المراجعة سليمًا
 * ويرى المالك في الوقت نفسه أن هذا المال موعود لشيء.
 */
export async function allocateToGoal(
  uid: string,
  goalId: string,
  amountMinor: Minor,
  firestore: Firestore = db,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const amount = amountMinor as number
  if (!Number.isInteger(amount) || amount === 0) {
    return { ok: false, message: 'المبلغ غير صالح.' }
  }
  try {
    await runTransaction(firestore, async (tx) => {
      const goalRef = doc(firestore, p(uid, `financialGoals/${goalId}`))
      const goalSnap = await tx.get(goalRef)
      if (!goalSnap.exists()) throw new Error('GOAL_MISSING')
      const g = goalSnap.data()

      const accountId = g['fundingAccountId'] as string
      const acctRef = doc(firestore, p(uid, `accounts/${accountId}`))
      const acctSnap = await tx.get(acctRef)
      if (!acctSnap.exists()) throw new Error('ACCOUNT_MISSING')
      const a = acctSnap.data()

      const saved = (g['savedMinor'] as number) + amount
      if (saved < 0) throw new Error('NEGATIVE_SAVED')
      const earmarked = (a['earmarkedMinor'] as number) + amount
      if (earmarked < 0) throw new Error('NEGATIVE_EARMARK')
      if (earmarked > (a['balanceMinor'] as number)) throw new Error('EXCEEDS_BALANCE')

      tx.update(goalRef, {
        savedMinor: saved,
        status: saved >= (g['targetMinor'] as number) ? 'reached' : 'active',
        updatedAt: serverTimestamp(),
      })
      tx.update(acctRef, {
        earmarkedMinor: earmarked,
        balanceVersion: (a['balanceVersion'] as number) + 1,
        updatedAt: serverTimestamp(),
      })
    })
    return { ok: true }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (m === 'EXCEEDS_BALANCE') {
      return { ok: false, message: 'لا يمكن حجز أكثر من رصيد الحساب.' }
    }
    if (m === 'NEGATIVE_SAVED') {
      return { ok: false, message: 'لا يمكن سحب أكثر مما خُصِّص للهدف.' }
    }
    if (m === 'NEGATIVE_EARMARK') return { ok: false, message: 'لا يمكن إلغاء حجز أكبر من المحجوز.' }
    if (m === 'GOAL_MISSING' || m === 'ACCOUNT_MISSING') {
      return { ok: false, message: 'السجل غير موجود. أعد تحميل الصفحة.' }
    }
    return { ok: false, message: 'تعذّر تحديث الهدف.' }
  }
}

export function observeGoals(
  uid: string,
  cb: (rows: GoalView[]) => void,
  onError: (e: unknown) => void,
  firestore: Firestore = db,
): () => void {
  const q = query(collection(firestore, p(uid, 'financialGoals')), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const x = d.data()
          return {
            id: d.id,
            name: (x['name'] as string | undefined) ?? '',
            targetMinor: (x['targetMinor'] as number | undefined) ?? 0,
            savedMinor: (x['savedMinor'] as number | undefined) ?? 0,
            deadline: (x['deadline'] as string | null | undefined) ?? null,
            fundingAccountId: (x['fundingAccountId'] as string | undefined) ?? 'asset.cash',
            status: (x['status'] as GoalView['status'] | undefined) ?? 'active',
            notes: (x['notes'] as string | undefined) ?? '',
          }
        }),
      )
    },
    onError,
  )
}
