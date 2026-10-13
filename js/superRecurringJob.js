// ============================================================================
// 🔁 superRecurringJob.js — Recurring super contribution/premium/fee processor
// ============================================================================
// Mirrors the catch-up engine in recurringJob.js (same due-period stepping,
// same "lastProcessed / catchUpFrom / startDate" anchor logic) but is
// self-contained to superannuation: it never touches STORE_NAMES.accounts or
// STORE_NAMES.transactions.
//
// Three kinds of schedule feed the same fund balance:
//   - super_recurring_contributions (+amount) — employer/salary-sacrifice/personal
//   - super_premiums (-amount)                — insurance held inside the fund
//   - super_fees (-amount)                     — admin/investment/other fees
//
// All of a fund's due events, across all three schedule types, are merged
// into one chronological list before processing — otherwise a monthly
// contribution and a quarterly premium would each compound off a stale
// balance instead of off each other. For each due event, in date order:
//   1. compound the fund's most recent balance forward to the event's date
//      at that schedule's assumed annual growth rate (0% if unset — only
//      contribution schedules carry a growth rate; premiums/fees don't grow
//      anything, they just apply on their own date), then
//   2. add (contribution) or subtract (premium/fee) the amount, and
//   3. write a new super_balance_history entry reflecting the result.
// Contribution events also get a super_contributions log entry (used for FY
// contribution-cap tracking elsewhere in the app); premium/fee events don't,
// since they're deductions, not contributions.
//
// Run automatically on app load (see app.js) alongside the bills/recurring
// job, and also available as an on-demand "Run Catch-up Now" action from the
// Superannuation page.
// ============================================================================

import { getAllItems, addItem, updateItem, STORE_NAMES, getFinancialYear } from './db.js';

function advance(date, freq) {
  switch (freq) {
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'fortnightly': date.setDate(date.getDate() + 14); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
    case 'quarterly': date.setMonth(date.getMonth() + 3); break;
    case 'halfyearly': date.setMonth(date.getMonth() + 6); break;
    case 'annually': case 'annual': date.setFullYear(date.getFullYear() + 1); break;
    default: date.setMonth(date.getMonth() + 1);
  }
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

// Every due date (oldest first) between this schedule's anchor and today.
// Same three-tier anchor as the general recurring engine: lastProcessed
// (steady state) > catchUpFrom (user says "already covered up to here") >
// startDate (never processed).
function getDuePeriods(rec, todayStr) {
  const dates = [];
  if (!rec.startDate && !rec.lastProcessed && !rec.catchUpFrom) return dates;
  const today = new Date(todayStr);
  const anchor = rec.lastProcessed || rec.catchUpFrom || rec.startDate;
  let cursor = new Date(anchor);
  if (isNaN(cursor.getTime())) return dates;

  if (!rec.lastProcessed && !rec.catchUpFrom && anchor === rec.startDate) {
    if (cursor <= today) dates.push(toDateStr(cursor));
  }

  for (let i = 0; i < 1000; i++) {
    const next = new Date(cursor);
    advance(next, rec.frequency);
    if (next > today) break;
    dates.push(toDateStr(next));
    cursor = next;
  }

  return dates;
}

// Compound `balance` forward from `fromDate` to `toDate` at `annualRatePct`
// per year, using elapsed days / 365. A 0 or missing rate is a no-op.
function compoundGrowth(balance, annualRatePct, fromDate, toDate) {
  const rate = Number(annualRatePct) || 0;
  if (!rate || !fromDate) return balance;
  const days = (new Date(toDate) - new Date(fromDate)) / 86400000;
  if (days <= 0) return balance;
  return balance * Math.pow(1 + rate / 100, days / 365);
}

export async function processSuperRecurringContributions() {
  const [recurringSchedules, premiumSchedules, feeSchedules, balanceHistory, contributions] = await Promise.all([
    getAllItems(STORE_NAMES.superRecurring),
    getAllItems(STORE_NAMES.superPremiums),
    getAllItems(STORE_NAMES.superFees),
    getAllItems(STORE_NAMES.superBalanceHistory),
    getAllItems(STORE_NAMES.superContributions)
  ]);

  const todayStr = new Date().toISOString().slice(0, 10);
  let processedCount = 0;
  const errors = [];

  // Tag every schedule with its store + sign so they can be merged into one
  // per-fund timeline and written back to the right place afterwards.
  const allSchedules = [
    ...recurringSchedules.map(rec => ({ rec, store: STORE_NAMES.superRecurring, sign: 1, kind: 'contribution' })),
    ...premiumSchedules.map(rec => ({ rec, store: STORE_NAMES.superPremiums, sign: -1, kind: 'premium' })),
    ...feeSchedules.map(rec => ({ rec, store: STORE_NAMES.superFees, sign: -1, kind: 'fee' }))
  ].filter(s => s.rec.active !== false && s.rec.fundId);

  const schedulesByFund = new Map();
  for (const s of allSchedules) {
    if (!schedulesByFund.has(s.rec.fundId)) schedulesByFund.set(s.rec.fundId, []);
    schedulesByFund.get(s.rec.fundId).push(s);
  }

  const balanceHistoryByFund = new Map();
  for (const b of balanceHistory) {
    if (!balanceHistoryByFund.has(b.fundId)) balanceHistoryByFund.set(b.fundId, []);
    balanceHistoryByFund.get(b.fundId).push(b);
  }

  for (const [fundId, schedules] of schedulesByFund.entries()) {
    try {
      // Build one flat, date-ordered event list across all of this fund's
      // schedules (contribution/premium/fee alike) so growth compounds
      // correctly across schedule types, not just within one.
      const events = [];
      for (const s of schedules) {
        for (const dueDate of getDuePeriods(s.rec, todayStr)) {
          events.push({ ...s, date: dueDate });
        }
      }
      events.sort((a, b) => a.date.localeCompare(b.date));

      let entries = (balanceHistoryByFund.get(fundId) || []).slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      let latest = entries.length
        ? { balance: entries[entries.length - 1].balance, date: entries[entries.length - 1].date }
        : { balance: 0, date: null };

      for (const evt of events) {
        const { rec, sign, kind, store } = evt;

        // Idempotency: every auto entry this job writes is tagged with the
        // schedule id + date it was generated for, so re-running (e.g. the
        // on-demand "Run Catch-up Now" button right after adding a new
        // schedule) never double-applies the same period.
        const alreadyExists = entries.some(e => e.recurringId === rec.id && e.date === evt.date);
        if (alreadyExists) {
          rec.lastProcessed = evt.date;
          continue;
        }

        const growthRate = kind === 'contribution' ? rec.growthRatePercent : 0;
        const grown = compoundGrowth(latest.balance, growthRate, latest.date, evt.date);
        const amount = Number(rec.amount) || 0;
        const newBalance = grown + sign * amount;

        const noteBySource = {
          contribution: `Auto: ${rec.growthRatePercent ? `${rec.growthRatePercent}% growth + ` : ''}recurring contribution`,
          premium: `Auto: insurance premium (${rec.type || 'premium'})`,
          fee: `Auto: fee (${rec.type || 'fee'})`
        };

        const balanceEntry = await addItem(STORE_NAMES.superBalanceHistory, {
          fundId,
          date: evt.date,
          balance: newBalance,
          note: noteBySource[kind],
          recurringId: rec.id,
          auto: true
        });
        entries.push(balanceEntry);
        latest = { balance: newBalance, date: evt.date };

        if (kind === 'contribution') {
          const contribEntry = await addItem(STORE_NAMES.superContributions, {
            fundId,
            date: evt.date,
            type: rec.type,
            amount,
            note: rec.note || 'Auto-generated by recurring contribution',
            financialYear: getFinancialYear(evt.date),
            recurringId: rec.id,
            auto: true
          });
          contributions.push(contribEntry);
        }

        rec.lastProcessed = evt.date;
        await updateItem(store, rec);
        processedCount++;
      }
    } catch (error) {
      errors.push(`Fund ${fundId}: ${error.message}`);
      console.error(`❌ Failed to process super schedules for fund ${fundId}:`, error);
    }
  }

  return { processed: processedCount, errors };
}
