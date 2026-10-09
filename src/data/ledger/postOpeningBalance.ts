import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'

import { accountTypeOf } from '@/domain/ledger/chartOfAccounts'
import { MAX_ABS_MINOR, type Minor } from '@/domain/money'
import { isValidISODate, libyaDateToUtcMs, periodKeyOf, today, type ISODate } from '@/lib/time'

import { db } from '../firebase/app'

/**
 * الرصيد الافتتاحي — عقد النواة §3.5.
 *
 * **ليس حقلًا حرًّا يُكتب على الحساب، بل قيد متوازن** مقابل `equity.opening`:
 *
 *     Dr  asset.cash        1,000.000
 *         Cr  equity.opening        1,000.000
 *
 * السبب جوهري: لو كان حقلًا حرًّا لانفصل الرصيد عن الدفتر، فلا يعود «الرصيد = مجموع
 * الحركات» ثابتًا قابلًا للفحص، ولانهار ميزان المراجعة. بهذه الصيغة يبقى كل دينار
 * في النظام له مصدر مُسجَّل.
 */

export type OpeningResult = { ok: true; entryId: string } | { ok: false; message: string }

export interface OpeningRequest {
  opId: string
  accountId: string
  amountMinor: Minor
  bookedAt: ISODate
}

const EQUITY_OPENING = 'equity.opening'

export async function postOpeningBalance(
  uid: string,
  req: OpeningRequest,
  firestore: Firestore = db,
): Promise<OpeningResult> {
  const amount = req.amountMinor as number
  if (!Number.isInteger(amount) || amount <= 0)
    return { ok: false, message: 'المبلغ يجب أن يكون أكبر من صفر.' }
  if (amount > MAX_ABS_MINOR) return { ok: false, message: 'المبلغ يتجاوز الحد المسموح.' }
  if (!isValidISODate(req.bookedAt)) return { ok: false, message: 'التاريخ غير صالح.' }
  if (req.bookedAt > today()) return { ok: false, message: 'لا يمكن أن يكون التاريخ مستقبليًا.' }
  if (accountTypeOf(req.accountId) !== 'asset') {
    return { ok: false, message: 'الرصيد الافتتاحي يُسجَّل على حساب نقدي فقط.' }
  }

  const path = (rest: string): string => `users/${uid}/${rest}`
  const entryRef = doc(firestore, path(`journalEntries/${req.opId}`))

  const existing = await getDoc(entryRef).catch(() => null)
  if (existing?.exists() === true) return { ok: false, message: 'هذه العملية مسجَّلة بالفعل.' }

  const periodKey = periodKeyOf(req.bookedAt)
  const bookedAtTs = libyaDateToUtcMs(req.bookedAt)

  try {
    await runTransaction(firestore, async (tx) => {
      const assetRef = doc(firestore, path(`accounts/${req.accountId}`))
      const equityRef = doc(firestore, path(`accounts/${EQUITY_OPENING}`))
      const [assetSnap, equitySnap] = await Promise.all([tx.get(assetRef), tx.get(equityRef)])
      if (!assetSnap.exists() || !equitySnap.exists()) throw new Error('ACCOUNT_MISSING')

      const periodRefs = [
        doc(firestore, path(`accountPeriods/${req.accountId}__${periodKey}`)),
        doc(firestore, path(`accountPeriods/${EQUITY_OPENING}__${periodKey}`)),
      ] as const
      const periodSnaps = await Promise.all(periodRefs.map((r) => tx.get(r)))

      const lines = [
        {
          lineNo: 0,
          accountId: req.accountId,
          accountType: 'asset',
          side: 'debit',
          amountMinor: amount,
          signedAmountMinor: amount,
          scope: 'personal',
          categoryId: null,
          settlementDeltaMinor: 0,
        },
        {
          lineNo: 1,
          accountId: EQUITY_OPENING,
          accountType: 'equity',
          side: 'credit',
          amountMinor: amount,
          signedAmountMinor: -amount,
          scope: 'personal',
          categoryId: null,
          settlementDeltaMinor: 0,
        },
      ]

      tx.set(entryRef, {
        opId: req.opId,
        ownerUid: uid,
        kind: 'opening',
        status: 'posted',
        bookedAt: req.bookedAt,
        bookedAtTs,
        periodKey,
        currency: 'LYD',
        schemaVersion: 1,
        description: 'رصيد افتتاحي',
        tags: [],
        refs: {},
        scope: 'personal',
        lines,
        accountIds: [req.accountId, EQUITY_OPENING],
        accountTypes: ['asset', 'equity'],
        totalDebitMinor: amount,
        totalCreditMinor: amount,
        amountMinor: amount,
        payloadHash: `opening${req.opId}`.padEnd(64, '0').slice(0, 64),
        createdAt: serverTimestamp(),
        createdBy: uid,
      })

      for (const line of lines) {
        tx.set(doc(firestore, path(`postings/${req.opId}__${String(line.lineNo)}`)), {
          ownerUid: uid,
          entryId: req.opId,
          lineNo: line.lineNo,
          accountId: line.accountId,
          accountType: line.accountType,
          side: line.side,
          amountMinor: line.amountMinor,
          signedAmountMinor: line.signedAmountMinor,
          settlementDeltaMinor: 0,
          scope: 'personal',
          categoryId: null,
          bookedAt: req.bookedAt,
          bookedAtTs,
          periodKey,
          kind: 'opening',
        })
      }

      // الأصل يزيد بالمدين، وحقوق الملكية تزيد بالدائن — كلاهما موجب على جانبه الطبيعي.
      const targets = [
        { ref: assetRef, snap: assetSnap, debit: amount, credit: 0, delta: amount },
        { ref: equityRef, snap: equitySnap, debit: 0, credit: amount, delta: amount },
      ]

      targets.forEach((t, i) => {
        // الوجود مفحوص أعلاه بـ exists()، فالبيانات مضمونة هنا.
        const cur = t.snap.data()
        tx.update(t.ref, {
          debitTotalMinor: (cur['debitTotalMinor'] as number) + t.debit,
          creditTotalMinor: (cur['creditTotalMinor'] as number) + t.credit,
          balanceMinor: (cur['balanceMinor'] as number) + t.delta,
          openingBalanceMinor:
            i === 0
              ? (cur['openingBalanceMinor'] as number) + amount
              : (cur['openingBalanceMinor'] as number),
          entryCount: (cur['entryCount'] as number) + 1,
          balanceVersion: (cur['balanceVersion'] as number) + 1,
          earmarkedMinor: cur['earmarkedMinor'] as number,
          updatedAt: serverTimestamp(),
        })

        const ps = periodSnaps[i]
        const ref = periodRefs[i]
        if (ref === undefined) throw new Error('PERIOD_REF_MISSING')
        const prev = ps?.exists() === true ? ps.data() : undefined
        const debitMinor = ((prev?.['debitMinor'] as number | undefined) ?? 0) + t.debit
        const creditMinor = ((prev?.['creditMinor'] as number | undefined) ?? 0) + t.credit
        tx.set(ref, {
          ownerUid: uid,
          accountId: i === 0 ? req.accountId : EQUITY_OPENING,
          periodKey,
          debitMinor,
          creditMinor,
          netMinor: debitMinor - creditMinor,
          updatedAt: serverTimestamp(),
        })
      })
    })
    return { ok: true, entryId: req.opId }
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : ''
    if (code === 'permission-denied') {
      return { ok: false, message: 'رفض الخادم العملية. تأكّد أن حسابك هو المالك المعتمد.' }
    }
    if (err instanceof Error && err.message === 'ACCOUNT_MISSING') {
      return { ok: false, message: 'الحساب غير موجود. أعد تحميل الصفحة.' }
    }
    return { ok: false, message: 'تعذّر حفظ الرصيد الافتتاحي. لم يُسجَّل شيء.' }
  }
}
