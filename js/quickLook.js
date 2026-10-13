// quickLook.js
//
// The "Quick Look" welcome experience: a fixed banner (greeting, live
// date/time) plus a collapsible at-a-glance panel
// (bills due this week, account/loan balances, rent overdue, insurance/
// rego status, credit card balance) shown at the top of the Dashboard.
//
import { getDisplayName, greetWithName } from './userName.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalance, computeAccountBalanceAsOf } from './accountBalance.js';
import { institutionDisplayName, renderInstitutionMark, pseudoLast4 } from './institutions.js';
import { getLoanPayoffStatus } from './loans.js';
import { isInterestOnlyPeriod, calculateMinimumRepayment } from './loanCalculations.js';

import { baseEquivalent, currencySymbol, formatMoney, toBase, toBaseTransactions, recordCurrency } from './utils/currency.js';
const COLLAPSE_STORAGE_KEY = 'dfm_quicklook_collapsed';

let qlCharts = {}; // keyed by canvas id, so re-renders destroy the right instance
let selectedBillTab = null; // 'overdue' | 'upcoming' | 'paid' | null (not yet defaulted) — persists across dashboard re-renders
let qlLastBalancesForChart = []; // set by renderQuickLookHTML, read by attachQuickLookBehavior for the pie chart

function destroyQLChart(id) {
  if (qlCharts[id]) {
    qlCharts[id].destroy();
    delete qlCharts[id];
  }
}

function compactMoney(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1000) return `${sign}${currencySymbol()}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
  return `${sign}${formatMoney(abs, undefined, { digits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Panel-wide "As of" period
// ---------------------------------------------------------------------------
// One shared period selector drives every BALANCE figure in the panel
// (regular accounts, credit card) — not the whole panel. Bill Reminders,
// overdue/upcoming items, and the outlook gauge stay tied to real "today"
// regardless of the selected period, since "bills due this week" isn't a
// historical fact the way a balance is — it's a live to-do list, and
// showing it for a past month would just be empty or misleading.
//
// Loans are a documented exception: their balance is a manually-tracked
// `currentBalance` field, not derived from transaction history the way
// account balances are (see accountBalance.js), so there's no way to ask
// "what did this loan owe as of August" without separately tracked loan
// balance history. Loan figures always show live regardless of the
// selected period — the UI notes this rather than silently ignoring it.
let selectedPeriodOffset = 0; // 0 = current, 1 = one month back, etc. Persists across re-renders, same pattern as selectedBillTab.
let quickLookPeriodChangeCallback = null; // set by attachQuickLookBehavior's caller (dashboard.js) — see setQuickLookPeriodChangeHandler

// dashboard.js calls this once, passing a function that re-renders the
// dashboard (it already owns that logic and re-runs it on its own refresh
// timer) — done this way instead of quickLook.js importing dashboard.js
// directly, which would create a circular import between the two modules.
export function setQuickLookPeriodChangeHandler(callback) {
  quickLookPeriodChangeCallback = callback;
}

function lastDayOfMonthStr(year, monthIndex) {
  // Day 0 of the *next* month is the last day of monthIndex.
  return new Date(year, monthIndex + 1, 0).toISOString().slice(0, 10);
}

// Builds the last `count` selectable periods, most recent (current) first.
// Each is a calendar month; for the current one, "asOf" for regular
// accounts is today (not the future month-end) so it's always live rather
// than artificially truncated.
function getGlobalPeriodOptions(todayStr, count = 6) {
  const today = new Date(todayStr);
  const options = [];
  for (let i = 0; i < count; i++) {
    const year = today.getFullYear();
    const month = today.getMonth() - i;
    const isCurrent = i === 0;
    const monthDate = new Date(year, month, 1);
    const label = isCurrent
      ? 'Current month'
      : monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const accountAsOfStr = isCurrent ? todayStr : lastDayOfMonthStr(monthDate.getFullYear(), monthDate.getMonth());
    options.push({ offset: i, label, isCurrent, monthYear: monthDate.getFullYear(), monthIndex: monthDate.getMonth(), accountAsOfStr });
  }
  return options;
}

// Resolves a credit card's "as of" date for a given period option. If the
// card has its own statement closing date (statementCloseDay), its
// balance is pegged to that day within the period's month (e.g. picking
// "August" resolves to the cycle closing Aug 7, not Aug 31) rather than
// the generic calendar month-end used for regular accounts, since that's
// what actually determines what a person owes on their statement — the
// bill DUE date is a separate, later day and has no bearing on which
// transactions belong to the statement. Cards without a statementCloseDay
// set fall back to the same month-end logic as regular accounts.
export function resolveCreditAsOfStr(periodOpt, closeDay, todayStr) {
  if (!closeDay) return periodOpt.accountAsOfStr;
  if (periodOpt.isCurrent) {
    // "Current" cycle = the in-progress one, same definition as before:
    // the next occurrence of closeDay from today. If that date hasn't
    // arrived yet, filtering transactions by date naturally can't include
    // ones that haven't happened, so this is equivalent to "live" without
    // any special-casing. (getNextDayOfMonthOccurrence is a generic "next
    // time this day-of-month comes up" helper, reused here for the close
    // day rather than the due day.)
    return getNextDayOfMonthOccurrence(closeDay, todayStr);
  }
  const candidate = new Date(periodOpt.monthYear, periodOpt.monthIndex, closeDay);
  return candidate.toISOString().slice(0, 10);
}

// The day AFTER the previous cycle's close - i.e. the first day of the
// cycle that ends on asOfStr. Used to show what actually happened WITHIN
// this one statement cycle (new charges, payments made) rather than just
// the cumulative closing balance, which on its own doesn't say how much
// of what's owed is new spending from this cycle vs carried over from
// before.
//
// closeDay is optional - a card with no closing day set falls back to the
// calendar month containing asOfStr, same as how regular accounts are
// already treated elsewhere in this file.
function getCyclePeriodStartStr(closeDay, asOfStr) {
  const asOf = new Date(asOfStr);
  if (!closeDay) {
    return new Date(asOf.getFullYear(), asOf.getMonth(), 1).toISOString().slice(0, 10);
  }
  const prevCycleEnd = new Date(asOf.getFullYear(), asOf.getMonth() - 1, closeDay);
  prevCycleEnd.setDate(prevCycleEnd.getDate() + 1);
  return prevCycleEnd.toISOString().slice(0, 10);
}

// Given a "day of month" (a statement close day OR a bill due day —
// purely a calendar helper, agnostic to which), returns the next
// occurrence of that day from today: this month if it hasn't passed yet,
// otherwise next month. Purely a display convenience; doesn't create or
// touch any Bill by itself. (Named generically since both
// resolveCreditAsOfStr and the "next payment due" display below share
// this same "next day-of-month" arithmetic against two different fields.)
export function getNextDayOfMonthOccurrence(day, todayStr) {
  const today = new Date(todayStr);
  let candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) {
    candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
  }
  return candidate.toISOString().slice(0, 10);
}

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return { text: 'Good night', icon: '🌙' };
  if (hour < 12) return { text: 'Good morning', icon: '🌅' };
  if (hour < 17) return { text: 'Good afternoon', icon: '☀️' };
  if (hour < 21) return { text: 'Good evening', icon: '🌆' };
  return { text: 'Good night', icon: '🌙' };
}

function loadCollapsedState() {
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
}

function saveCollapsedState(collapsed) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  } catch {
    // not fatal — just won't remember the toggle state
  }
}


// Same "next occurrence" logic dashboard.js uses for the Upcoming Recurring
// widget, duplicated locally so this module doesn't need to reach into
// dashboard.js internals for a small date calc.
function getNextRecurringOccurrence(dateStr, frequency) {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let guard = 0;
  while (d < today && guard < 1000) {
    switch (frequency) {
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'fortnightly': d.setDate(d.getDate() + 14); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'quarterly': d.setMonth(d.getMonth() + 3); break;
      case 'annually': d.setFullYear(d.getFullYear() + 1); break;
      default: return d;
    }
    guard++;
  }
  return d;
}

function getUpcomingRecurringWithin(recurringTx, daysAhead) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);
  return (recurringTx || [])
    .filter(r => r.startDate)
    .map(r => ({ ...r, nextDate: getNextRecurringOccurrence(r.startDate, r.frequency) }))
    .filter(r => r.nextDate >= today && r.nextDate <= horizon)
    .sort((a, b) => a.nextDate - b.nextDate);
}

// ---------------------------------------------------------------------------
// Data computation for the Quick Look panel
// ---------------------------------------------------------------------------

function computeQuickLookData({
  bills, accounts, loans, properties, transactions, categories, recurringTx,
  currentMonth, currentMonthIncome, currentMonthExpenses, currentMonthBalance,
  totalNetWorth, overBudgetCount, selectedMonthLabel, isCurrentCalendarMonth
}) {
  // Bills / recurring rules are paid from an account, so carry that account's
  // currency on each record (the renderers and sums below read it).
  bills = (bills || []).map(b => ({ ...b, currency: recordCurrency(b, accounts) }));
  recurringTx = (recurringTx || []).map(r => ({ ...r, currency: recordCurrency(r, accounts) }));
  const today = new Date().toISOString().slice(0, 10);
  const weekAhead = new Date();
  weekAhead.setDate(weekAhead.getDate() + 7);
  const weekAheadStr = weekAhead.toISOString().slice(0, 10);

  const categoryById = new Map(categories.map(c => [c.id, c]));
  const unpaidBills = bills.filter(b => !b.paid);

  // Items due within the week (includes anything already overdue)
  const dueThisWeek = unpaidBills
    .filter(b => b.dueDate <= weekAheadStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Quick balances: accounts (computed as of the selected period, see
  // getGlobalPeriodOptions/resolveCreditAsOfStr above) + loans (their own
  // tracked balance, always live — see the comment above
  // selectedPeriodOffset for why).
  //
  // Bug fix: this used to hard-cap at 6 months back regardless of actual
  // history, so anyone with older transactions (a full financial year
  // import, multiple years of data) simply couldn't select those months —
  // the dropdown only ever offered the most recent 6. Now spans back to
  // the earliest transaction across all accounts instead of a fixed
  // count, so every month that actually has data is selectable. Falls
  // back to just "Current month" when there's no transaction history yet
  // (a brand new setup) rather than generating a meaningless long list.
  const earliestTxDate = transactions.reduce(
    (earliest, t) => (t.date && (!earliest || t.date < earliest)) ? t.date : earliest,
    null
  );
  const monthsOfHistory = earliestTxDate
    ? (new Date(today).getFullYear() - new Date(earliestTxDate).getFullYear()) * 12
      + (new Date(today).getMonth() - new Date(earliestTxDate).getMonth())
      + 1
    : 1;
  const periodOptions = getGlobalPeriodOptions(today, Math.max(monthsOfHistory, 1));
  const selectedPeriod = periodOptions[Math.min(selectedPeriodOffset, periodOptions.length - 1)];

  // Budget Status (Quick Facts, Card E) — income vs expense for whichever
  // month is picked in qlPeriodSelect above, same panel-wide selector the
  // account/credit balances already follow. Unlike loan balances (always
  // live — see the note above selectedPeriodOffset), income/expense are
  // ordinary transaction-derived totals, so there's no reason not to let
  // them move with the picker like the rest of the panel does.
  const periodMonthKey = `${selectedPeriod.monthYear}-${String(selectedPeriod.monthIndex + 1).padStart(2, '0')}`;
  const flowTx = toBaseTransactions(transactions, accounts); // base-currency copy for flow maths
  const periodTx = flowTx.filter(t => t.date?.startsWith(periodMonthKey) && !t.isTransfer);
  const periodIncome = periodTx.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const periodExpense = Math.abs(periodTx.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0));
  const periodNet = periodIncome - periodExpense;
  const periodIncomePct = (periodIncome + periodExpense) > 0
    ? (periodIncome / (periodIncome + periodExpense)) * 100
    : 50;

  const accountBalances = accounts.map(a => {
    const asOfStr = a.type === 'credit'
      ? resolveCreditAsOfStr(selectedPeriod, a.statementCloseDay, today)
      : selectedPeriod.accountAsOfStr;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      // Bug fix: the account's currency was dropped when this object was built, so every
      // `a.currency` below (tiles, the credit-card card, and the toBase() totals) saw undefined —
      // a rupee account showed with a "$" and was added to net totals unconverted.
      currency: a.currency,
      // Bug fix / feature: this used to always call computeAccountBalance
      // (today, live) regardless of what period the panel was showing.
      // computeAccountBalanceAsOf with the resolved date is a strict
      // generalization of that — for the current period it resolves to
      // today anyway, so live behaviour is unchanged when nothing's been
      // selected.
      balance: computeAccountBalanceAsOf(a, transactions, asOfStr),
      creditLimit: a.creditLimit || 0,
      statementDueDay: a.statementDueDay || null,
      statementCloseDay: a.statementCloseDay || null,
      asOfStr
    };
  });
  const totalAccountBalance = accountBalances
    .filter(a => a.type !== 'credit')
    .reduce((sum, a) => sum + toBase(a.balance, a.currency), 0);
  // Loans can be in different currencies: this total is in the base currency (each loan shows its own below).
  const totalLoanBalance = loans.reduce((sum, l) => sum + toBase(l.currentBalance || 0, l.currency), 0);

  // Non-credit accounts and loans, individually — the credit ones get their
  // own "Credit Card Balance" section above, so they're excluded here to
  // avoid showing the same account twice.
  const nonCreditAccounts = accountBalances
    .filter(a => a.type !== 'credit')
    .sort((a, b) => toBase(b.balance, b.currency) - toBase(a.balance, a.currency));
  const loanBalances = loans
    .map(l => ({ name: l.name, type: l.type, balance: l.currentBalance || 0, currency: l.currency }))
    .sort((a, b) => b.balance - a.balance);

  // Loan payoff progress — same calculation as the Dashboard's "Loan
  // Payoff Progress" widget (js/dashboard.js's getLoanProgressList),
  // both now sharing loans.js's getLoanPayoffStatus() so a construction
  // loan's staged drawdown (percent tracks drawdown progress until every
  // stage is drawn, only then switches to real payoff progress, and is
  // never "paid off" while it's still mid-drawdown — see that function)
  // can't drift into disagreement between the two widgets the way the
  // two separate copies of this math used to. Sorted by furthest-along
  // first. Loans without a usable originalAmount (0 or missing) are
  // excluded — there's no payoff % to show without a starting balance.
  const loanPayoffs = loans
    .filter(l => (parseFloat(l.originalAmount) || 0) > 0)
    .map(l => {
      const original = parseFloat(l.originalAmount) || 0;
      const current = parseFloat(l.currentBalance) || 0;
      const status = getLoanPayoffStatus(l);
      let estPayoffDate = null;
      if (l.startDate && l.termMonths) {
        estPayoffDate = new Date(l.startDate);
        estPayoffDate.setMonth(estPayoffDate.getMonth() + parseInt(l.termMonths, 10));
      }
      return {
        name: l.name || 'Loan',
        icon: l.icon || '🏦',
        original,
        current,
        currency: l.currency,
        percent: status.percent,
        phase: status.phase,
        drawnTotal: status.drawnTotal,
        facilityLimit: status.facilityLimit,
        estPayoffDate,
        isPaidOff: status.isPaidOff
      };
    })
    .sort((a, b) => b.current - a.current);

  // Card H: Loan Totals — splits every loan into two repayment-structure
  // buckets: Principal & Interest vs currently Interest-Only. Whether a
  // loan is "interest-only" is a temporary PHASE (interestOnlyMonths
  // counted from its startDate — see isInterestOnlyPeriod in
  // loanCalculations.js), not a fixed loan type, so a construction/
  // investment loan moves itself from the Interest-Only bucket into the
  // P&I one the moment that window elapses, with nothing to
  // re-categorize by hand. Balances are loans' own always-live
  // currentBalance (same "loans ignore the panel's period picker" rule
  // documented above selectedPeriodOffset). Repayment amounts use
  // calculateMinimumRepayment (offset-aware, same helper the Loans page
  // itself uses) and are normalized to a monthly-equivalent figure so a
  // weekly loan's repayment can be added to a monthly one's without
  // silently understating either.
  const monthlyRepaymentEquivalent = (loan) => {
    const periodsPerYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 }[loan.paymentFrequency] || 12;
    let offsetBalance = 0;
    if (loan.linkedOffsetId) {
      const offsetAccount = accounts.find(a => a.id === loan.linkedOffsetId);
      if (offsetAccount) offsetBalance = computeAccountBalance(offsetAccount, transactions);
    }
    return calculateMinimumRepayment(loan, { offsetBalance }) * periodsPerYear / 12;
  };
  const piLoans = loans.filter(l => !isInterestOnlyPeriod(l));
  const ioLoans = loans.filter(l => isInterestOnlyPeriod(l));
  const totalPiLoanBalance = piLoans.reduce((sum, l) => sum + (l.currentBalance || 0), 0);
  const totalPiLoanRepayment = piLoans.reduce((sum, l) => sum + monthlyRepaymentEquivalent(l), 0);
  const totalIoLoanBalance = ioLoans.reduce((sum, l) => sum + (l.currentBalance || 0), 0);
  const totalIoLoanRepayment = ioLoans.reduce((sum, l) => sum + monthlyRepaymentEquivalent(l), 0);

  // Credit card balances — called out separately per the "Important" note.
  // Shows both what's owed AND what's still available against the limit,
  // since knowing you owe $1,200 means something different on a $2,000
  // limit vs a $10,000 one. Balance is already resolved to the selected
  // period above (accountBalances), pegged to the card's own bill date
  // within that period rather than a generic calendar month-end.
  //
  // Feature: cycle breakdown (charges vs payments). The closing balance
  // alone doesn't say how much of what's owed is NEW spending this cycle
  // vs carried over from before, or how much was paid off - "$1,055 owed"
  // is a fact but not an explanation. This adds, for whichever cycle is
  // selected: new charges (expense transactions dated within that cycle
  // on this account) and payments made (income-type transactions within
  // it, e.g. the transfer created by "Convert to Transfer") - so the
  // closing "amount owing" figure is traceable rather than opaque.
  const creditAccounts = accountBalances.filter(a => a.type === 'credit').map(a => {
    // Bug fix: owed used to double as "the debt", but a card that's had
    // more paid onto it than spent (a real, if unusual, in-credit state)
    // has a positive balance — owed correctly reads 0 there, but available
    // was still capped at the raw limit instead of adding the surplus on
    // top, same inconsistency fixed in accounts.js's account card.
    const owed = Math.abs(Math.min(a.balance, 0));
    const creditSurplus = Math.max(a.balance, 0);
    const available = a.creditLimit > 0 ? Math.max(a.creditLimit + a.balance, 0) : null;
    // Bug fix: this used to compute the due date from today's real-world
    // date regardless of which statement period was selected, so it never
    // changed when browsing to a past cycle via the period picker — it
    // just kept showing whatever's due next from right now. The due date
    // for a given statement always falls after that statement's own close
    // date (a.asOfStr, resolved above per-cycle for credit cards), so
    // anchoring to that instead makes it track the selected period, same
    // as every other figure on this card.
    const nextDueDate = a.statementDueDay ? getNextDayOfMonthOccurrence(a.statementDueDay, a.asOfStr) : null;

    const cycleStartStr = getCyclePeriodStartStr(a.statementCloseDay, a.asOfStr);
    const cycleTx = transactions.filter(t => t.accountId === a.id && t.date >= cycleStartStr && t.date <= a.asOfStr);
    // Bug fix: chargesThisCycle used to sum every type:'expense' row
    // regardless of isTransfer, so a BPAY payment onto this same card
    // landing inside the cycle window (positive amount, type still
    // 'expense') silently cancelled out real charges instead of being
    // excluded. paymentsThisCycle used to look for type:'income', but a
    // card repayment's type stays 'expense' (only isTransfer flips) - so
    // it never actually counted a real payment, always reading $0.00
    // whenever one occurred. Both now key off isTransfer instead.
    const chargesThisCycle = Math.abs(cycleTx.filter(t => t.type === 'expense' && !t.isTransfer).reduce((sum, t) => sum + t.amount, 0));
    const paymentsThisCycle = cycleTx.filter(t => t.isTransfer && t.amount > 0).reduce((sum, t) => sum + t.amount, 0);

    return { ...a, owed, creditSurplus, available, nextDueDate, chargesThisCycle, paymentsThisCycle };
  });
  const totalCreditOwed = creditAccounts.reduce((sum, a) => sum + toBase(a.owed, a.currency), 0);
  const totalCreditLimit = creditAccounts.reduce((sum, a) => sum + toBase(a.creditLimit || 0, a.currency), 0);
  const creditUtilizationPct = totalCreditLimit > 0 ? Math.min(100, (totalCreditOwed / totalCreditLimit) * 100) : 0;
  // Sum of every card's own available-against-its-limit figure, rather
  // than deriving one from the totals above — a card with no limit set
  // contributes `null` to its own `available` and must be skipped the
  // same way here as it is per-card, not treated as $0 available.
  const totalCreditAvailable = creditAccounts.reduce((sum, a) => sum + toBase(a.available || 0, a.currency), 0);

  // Overall net cash flow (income minus expenses), last 6 months — same
  // sparkline the old Finance Overview featured-balance card used.
  const flowNow = new Date();
  const netFlowSparkline = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(flowNow.getFullYear(), flowNow.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const monthTx = flowTx.filter(t => t.date?.startsWith(key) && !t.isTransfer);
    const inc = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = Math.abs(monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    netFlowSparkline.push(inc - exp);
  }

  // Rent overdue: for each investment property with an expected monthly
  // rent, look at the most recent rental-income transaction linked to it
  // (or any rental income transaction if none are property-linked) and
  // flag it if it's been more than ~35 days (a bit of grace past a
  // monthly cycle) since the last one came in.
  const rentalIncomeTx = flowTx.filter(t => t.categoryId === 'sub_rental_income');
  const investmentProperties = properties.filter(p => p.propertyType !== 'primary' && p.rent > 0);
  const rentOverdue = investmentProperties.map(property => {
    const propertyTx = rentalIncomeTx.filter(t => t.propertyId === property.id);
    const relevantTx = propertyTx.length > 0 ? propertyTx : rentalIncomeTx; // fall back if rent isn't tagged per-property
    const lastDate = relevantTx.length > 0
      ? relevantTx.map(t => t.date).sort().at(-1)
      : null;
    const daysSince = lastDate ? Math.floor((new Date(today) - new Date(lastDate)) / 86400000) : null;
    const isOverdue = daysSince === null || daysSince > 35;
    return { name: property.name, lastDate, daysSince, isOverdue };
  }).filter(r => r.isOverdue);

  // Insurance / rego / licence bills — grouped by what they are, showing
  // next due date and whether they're already overdue.
  const INSURANCE_CATEGORY_IDS = new Set([
    'sub_home_ins', 'sub_landlord_ins', 'sub_life_ins', 'sub_pet_ins',
    'sub_car_insurance', 'sub_health_insurance'
  ]);
  const insuranceBills = unpaidBills
    .filter(b => INSURANCE_CATEGORY_IDS.has(b.categoryId))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const regoBills = unpaidBills
    .filter(b => b.categoryId === 'sub_rego')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // No dedicated "licence" category exists — matched by name since it's
  // a less common, optional item per the design.
  const licenceBills = unpaidBills
    .filter(b => /licen[cs]e/i.test(b.name || ''))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // --- All bills, bucketed for the "Bill Reminders" tabbed card ---
  // (Same three-way split as the dedicated Bills page — Overdue / Upcoming
  // / Paid — but every bill, not just the ones due within a week.)
  const allOverdueBills = bills.filter(b => !b.paid && b.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const allUpcomingBills = bills.filter(b => !b.paid && b.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const allPaidBills = bills.filter(b => b.paid).sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  // === Forward-looking cash flow (30 days) ===
  // The single most useful thing a "quick look" widget can answer that a
  // static balance can't: am I on track, or heading for trouble, before
  // it actually happens. Combines the money already sitting in accounts
  // with what's scheduled to come in/go out over the next month.
  const upcoming30 = getUpcomingRecurringWithin(recurringTx, 30);
  const upcomingIncome30 = upcoming30.filter(r => r.type === 'income');
  const upcomingExpense30 = upcoming30.filter(r => r.type === 'expense');
  const upcomingIncomeTotal30 = upcomingIncome30.reduce((sum, r) => sum + toBase(parseFloat(r.amount) || 0, recordCurrency(r, accounts)), 0);
  const upcomingExpenseTotal30 = upcomingExpense30.reduce((sum, r) => sum + toBase(parseFloat(r.amount) || 0, recordCurrency(r, accounts)), 0);
  const billsDue30Total = unpaidBills
    .filter(b => b.dueDate <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
    .reduce((sum, b) => sum + toBase(parseFloat(b.amount) || 0, recordCurrency(b, accounts)), 0);
  const nextIncome = upcomingIncome30[0] || null;
  const projectedBalance30 = totalAccountBalance + upcomingIncomeTotal30 - upcomingExpenseTotal30 - billsDue30Total;
  const dueThisWeekTotal = dueThisWeek.reduce((sum, b) => sum + toBase(parseFloat(b.amount) || 0, recordCurrency(b, accounts)), 0);
  const overdueCount = dueThisWeek.filter(b => b.dueDate < today).length;
  const overdueTotal = dueThisWeek.filter(b => b.dueDate < today).reduce((sum, b) => sum + toBase(parseFloat(b.amount) || 0, recordCurrency(b, accounts)), 0);

  // === 30-Day Outlook score ===
  // Same gauge + factor-breakdown pattern as the Dashboard's Financial
  // Health score, but scoped to short-term liquidity — "can I comfortably
  // get through the next 30 days" — rather than the long-term picture the
  // Financial Health widget already covers. Deliberately a different
  // metric under the same visual language, not a duplicate score.
  //   - Covering this week's bills out of what's available now (35pts)
  //   - No overdue items (25pts) — binary-ish: overdue is bad regardless
  //     of the amount, so it's penalised per item rather than by $ size
  //   - 30-day forecast staying non-negative (40pts)
  const coverageRatio = dueThisWeekTotal > 0 ? clamp01(totalAccountBalance / dueThisWeekTotal) : 1;
  const coverageBar = coverageRatio * 100;
  const coveragePts = coverageBar / 100 * 35;

  const overdueBar = overdueCount === 0 ? 100 : Math.max(0, 100 - overdueCount * 30);
  const overduePts = overdueBar / 100 * 25;

  const forecastRatio = projectedBalance30 >= 0
    ? 1
    : clamp01(1 + projectedBalance30 / Math.max(totalAccountBalance, 1));
  const forecastBar = forecastRatio * 100;
  const forecastPts = forecastBar / 100 * 40;

  const outlookScore = Math.round(clamp01((coveragePts + overduePts + forecastPts) / 100) * 100);
  let outlookBand, outlookColor;
  if (outlookScore >= 80)      { outlookBand = 'Excellent'; outlookColor = 'var(--success)'; }
  else if (outlookScore >= 60) { outlookBand = 'Good'; outlookColor = 'var(--accent)'; }
  else if (outlookScore >= 40) { outlookBand = 'Fair'; outlookColor = '#ea7c1c'; }
  else if (outlookScore >= 20) { outlookBand = 'Needs Attention'; outlookColor = '#f59e0b'; }
  else                         { outlookBand = 'At Risk'; outlookColor = 'var(--danger)'; }

  return {
    today,
    dueThisWeek,
    dueThisWeekTotal,
    overdueCount,
    overdueTotal,
    categoryById,
    totalAccountBalance,
    totalLoanBalance,
    nonCreditAccounts,
    loanBalances,
    loanPayoffs,
    piLoans,
    ioLoans,
    totalPiLoanBalance,
    totalPiLoanRepayment,
    totalIoLoanBalance,
    totalIoLoanRepayment,
    totalCreditOwed,
    totalCreditLimit,
    totalCreditAvailable,
    creditUtilizationPct,
    netFlowSparkline,
    creditAccounts,
    periodOptions,
    selectedPeriod,
    rentOverdue,
    insuranceBills,
    regoBills,
    licenceBills,
    allOverdueBills,
    allUpcomingBills,
    allPaidBills,
    nextIncome,
    projectedBalance30,
    upcomingIncomeTotal30,
    upcomingExpenseTotal30,
    billsDue30Total,
    periodIncome,
    periodExpense,
    periodNet,
    periodIncomePct,
    // Passed straight through from dashboard.js's own calculations for
    // the "Net This Month" card — see computeQuickLookData's params.
    currentMonth,
    currentMonthIncome,
    currentMonthExpenses,
    currentMonthBalance,
    totalNetWorth,
    overBudgetCount,
    selectedMonthLabel,
    isCurrentCalendarMonth,
    outlook: { score: outlookScore, band: outlookBand, color: outlookColor, coverageBar, overdueBar, forecastBar }
  };
}

function clamp01(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function statusLine(bill, today, categoryById) {
  const cat = categoryById.get(bill.categoryId);
  const isOverdue = bill.dueDate < today;
  return `
    <div class="quicklook-line ${isOverdue ? 'overdue' : ''}">
      <span>${cat?.icon || '📄'} ${escapeText(bill.name)}</span>
      <span class="quicklook-line-value">${isOverdue ? 'Overdue' : 'Due'} ${bill.dueDate}</span>
    </div>
  `;
}

// Same SVG ring-gauge pattern as the Dashboard's Financial Health score
// (js/dashboard.js renderHealthGauge) — reused here via the same
// `.health-gauge-*` classes so the two widgets read as one visual family,
// even though this one scores a different thing (30-day liquidity, not
// overall financial health).
function renderOutlookGauge(outlook) {
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (outlook.score / 100) * circumference;
  return `
    <svg viewBox="0 0 120 120" class="health-gauge-svg" role="img" aria-label="30-day cash flow outlook score ${outlook.score} out of 100, ${outlook.band}">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="10" style="stroke: var(--bg-muted);" />
      <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="10" stroke-linecap="round"
        style="stroke: ${outlook.color}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transition: stroke-dashoffset 0.6s ease;"
        transform="rotate(-90 60 60)" />
    </svg>
    <div class="health-gauge-center">
      <span class="health-gauge-score">${outlook.score}</span>
      <span class="health-gauge-max">/100</span>
    </div>
  `;
}

function renderOutlookFactorRow(icon, label, valueText, barPct, barColor) {
  return `
    <div class="health-factor-row">
      <div class="health-factor-icon">${icon}</div>
      <div class="health-factor-main">
        <div class="health-factor-top">
          <span class="health-factor-label">${label}</span>
          <span class="health-factor-value">${valueText}</span>
        </div>
        <div class="health-factor-bar-track">
          <div class="health-factor-bar-fill" style="width: ${Math.max(0, Math.min(100, barPct))}%; background: ${barColor};"></div>
        </div>
      </div>
    </div>
  `;
}


// Small line-graph, used by the Credit Card card to show the last 6
// months of overall net cash flow (income minus expenses) — same visual
// as the old Finance Overview featured-balance card's sparkline.
function renderQLSparkline(values, color) {
  const w = 220, h = 46, pad = 4;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <svg viewBox="0 0 ${w} ${h}" class="fo-sparkline" preserveAspectRatio="none">
      <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${points.map(p => {
        const [x, y] = p.split(',');
        return `<circle cx="${x}" cy="${y}" r="2.5" fill="${color}" />`;
      }).join('')}
    </svg>
  `;
}

// Small tile for the Accounts & Loans card — deliberately lighter-weight
// than renderQLMiniCard (no masked number/chip) since several of these
// sit side by side in one card rather than being the sole focus.
function renderQLBalanceTile(item, kind) {
  const icon = kind === 'loan'
    ? { mortgage: '🏠', vehicle: '🚗', personal: '💵', education: '🎓' }[item.type] || '🏦'
    : { bank: '🏦', savings: '💰', investment: '📈', offset: '⚖️', cash: '💵' }[item.type] || '📁';
  return `
    <div class="ql-balance-tile ${kind === 'loan' ? 'is-loan' : ''}">
      <span class="ql-balance-tile-icon">${icon}</span>
      <span class="ql-balance-tile-name">${escapeText(item.name)}</span>
      <span class="ql-balance-tile-value">${formatCurrency(item.balance, item.currency)}${qlEquivalent(item.balance, item.currency)}</span>
    </div>
  `;
}

export function renderQLBillRow(bill, categoryById, mode) {
  const cat = categoryById.get(bill.categoryId);
  return `
    <div class="ql-bill-row">
      <span class="ql-bill-row-icon">${cat?.icon || '📄'}</span>
      <span class="ql-bill-row-name">${escapeText(bill.name)}</span>
      <span class="ql-bill-row-date">${mode === 'paid' ? 'Paid' : mode === 'overdue' ? 'Was due' : 'Due'} ${bill.dueDate}</span>
      <span class="ql-bill-row-amount ${mode === 'overdue' ? 'overdue' : ''}">${formatCurrency(bill.amount, bill.currency)}</span>
    </div>
  `;
}

function escapeText(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "≈ AUD 1,234" under a foreign-currency figure so it can be compared at a glance; empty for
// base-currency items or when no rate is on file.
function qlEquivalent(amount, currency) {
  const eq = baseEquivalent(Math.abs(Number(amount) || 0), currency);
  return eq ? `<small class="ql-equivalent" style="display:block;font-size:0.7rem;font-weight:400;opacity:0.65;">${eq}</small>` : '';
}

function formatCurrency(amount, currency) {
  return formatMoney(Math.abs(Number(amount) || 0), currency);
}

// Whole-dollar variant for the credit card hero card — that layout is
// all headline figures (Available, limit, balance owing, cycle
// charges/payments) sitting right next to each other, where cents on
// every one just adds visual noise without adding information.
function formatCurrencyWhole(amount, currency) {
  return formatMoney(Math.abs(Number(amount) || 0), currency, { digits: 0 });
}

// Signed whole-dollar variant for the "Net This Month" card — same
// figure heroDashboard.js's own Net card shows (a month's net cash flow
// can genuinely be negative), so unlike formatCurrencyWhole above this
// keeps the sign rather than always showing a magnitude.
function moneySigned(amount) {
  const n = Number(amount) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}${currencySymbol()}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Renders a 'YYYY-MM-DD' string as 'DD-MM-YYYY' for the "Payment due
// on" figure — matches the day-month-year convention used elsewhere in
// the app's date displays.
function formatDateDMY(isoDateStr) {
  const parts = String(isoDateStr).split('-');
  if (parts.length !== 3) return isoDateStr;
  const [year, month, day] = parts;
  return `${day}-${month}-${year}`;
}

function getAccountIcon(type) {
  const icons = { bank: '🏦', credit: '💳', cash: '💵', savings: '💰', investment: '📈', offset: '⚖️' };
  return icons[type] || '📁';
}

function getLoanIcon(type) {
  const icons = { mortgage: '🏠', vehicle: '🚗', personal: '💵', education: '🎓', investment: '📈' };
  return icons[type] || '🏦';
}

// ---------------------------------------------------------------------------
// Public: render + wire up
// ---------------------------------------------------------------------------

export function renderQuickLookHTML(data) {
  const greeting = getGreeting();
  const isCollapsed = loadCollapsedState();
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const {
    today, dueThisWeek, dueThisWeekTotal, overdueCount, overdueTotal, categoryById,
    totalAccountBalance, totalLoanBalance,
    nonCreditAccounts, loanBalances, loanPayoffs,
    piLoans, ioLoans, totalPiLoanBalance, totalPiLoanRepayment, totalIoLoanBalance, totalIoLoanRepayment,
    totalCreditOwed, totalCreditLimit, totalCreditAvailable, creditUtilizationPct, netFlowSparkline,
    creditAccounts, periodOptions, selectedPeriod, rentOverdue, insuranceBills, regoBills, licenceBills,
    allOverdueBills, allUpcomingBills, allPaidBills,
    nextIncome, projectedBalance30, outlook,
    periodIncome, periodExpense, periodNet, periodIncomePct,
    currentMonth, currentMonthIncome, currentMonthExpenses, currentMonthBalance,
    totalNetWorth, overBudgetCount, selectedMonthLabel, isCurrentCalendarMonth
  } = computeQuickLookData(data);

  // Default the Bill Reminders tab the first time it renders: overdue
  // items take priority when there are any, but with nothing overdue,
  // defaulting to "Overdue" would just show an empty panel — show
  // Upcoming instead so there's always something useful on screen.
  // Once the person picks a tab themselves, that choice sticks.
  if (selectedBillTab === null) {
    selectedBillTab = allOverdueBills.length > 0 ? 'overdue' : (allUpcomingBills.length > 0 ? 'upcoming' : 'paid');
  }

  // Stashed for attachQuickLookBehavior() to build the balances pie chart
  // from, without needing to change that function's (no-argument) signature.
  qlLastBalancesForChart = [
    ...nonCreditAccounts.map(a => ({ name: a.name, value: Math.abs(toBase(a.balance, a.currency)) })),
    ...loanBalances.map(l => ({ name: l.name, value: Math.abs(toBase(l.balance, l.currency)) }))
  ];

  return `
    <div class="quicklook-banner">
      <div class="quicklook-banner-row">
        <div class="quicklook-greeting">
          <span class="quicklook-greeting-icon">${greeting.icon}</span>
          <div>
            <div class="quicklook-greeting-text">${escapeHtml(greetWithName(greeting.text, getDisplayName()))}</div>
            <div class="quicklook-datetime">${dateStr} · <span id="quicklookClock">${timeStr}</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="quicklook-panel ${isCollapsed ? 'collapsed' : ''}" id="quicklookPanel">
      <div class="quicklook-panel-header" id="quicklookToggle" role="button" tabindex="0" aria-expanded="${!isCollapsed}">
        <span class="quicklook-chevron">${isCollapsed ? '▶' : '▼'}</span>
        <span><strong>🔍 Quick Look</strong></span>
        <div class="quicklook-header-right">
          ${overdueCount > 0 ? `<span class="quicklook-badge">${overdueCount} overdue</span>` : ''}
          <select id="qlPeriodSelect" class="ql-period-select" aria-label="Balances as of" onclick="event.stopPropagation()">
            ${periodOptions.map(opt => `
              <option value="${opt.offset}" ${opt.offset === selectedPeriod.offset ? 'selected' : ''}>${escapeText(opt.label)}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="quicklook-panel-body" style="display:${isCollapsed ? 'none' : ''}">
        <div class="fo-dashboard ql-fo-wrap">
        <div class="dash-bento ql-bento">

          <!-- Card A: Credit Card — matches the Hero Dashboard's
               "hero-net-card" shell (decorative gold rings + dark
               gradient, see js/heroDashboard.js) but laid out like a
               physical card "hero" statement: a month-nav header,
               utilization/limit in the top-right corner, a big
               "Available" headline figure with the sparkline sitting
               beside it, and a 4-up balance/due-date/charges/payments
               strip along the bottom. Balances reflect the panel-wide
               "as of" period (see qlPeriodSelect) — the prev/next
               arrows here just move that same selectedPeriodOffset
               (same pattern as heroDashboard's month nav), they don't
               give this card its own separate date, since accounts and
               the credit card should always show the same point in
               time as each other. -->
          <div class="fo-card fo-card-featured ql-card-a hero-net-card ql-hero-credit-card">
            <div class="hero-net-ring hero-net-ring-1" aria-hidden="true"></div>
            <div class="hero-net-ring hero-net-ring-2" aria-hidden="true"></div>
            <div class="hero-net-body">
              <div class="hero-net-top ql-card-a-top">
                <div class="hero-net-month-nav" onclick="event.stopPropagation()">
                  <button type="button" id="qlCreditPrevBtn" class="hero-month-nav-btn" title="Previous period">‹</button>
                  <span class="hero-net-label">Credit card ${selectedPeriod.isCurrent ? 'this month' : escapeText(selectedPeriod.label)}</span>
                  <button type="button" id="qlCreditNextBtn" class="hero-month-nav-btn" title="Next period" ${selectedPeriod.offset === 0 ? 'disabled' : ''}>›</button>
                </div>
                <div class="ql-card-a-topstat">
                  <span class="ql-card-a-topstat-pct ${creditUtilizationPct >= 90 ? 'over' : ''}">${Math.round(creditUtilizationPct)}% utilized</span>
                  <span class="ql-card-a-topstat-limit">credit limit - ${formatCurrencyWhole(totalCreditLimit)}</span>
                </div>
              </div>

              <div class="ql-card-a-main">
                <div class="ql-card-a-available">
                  <p class="hero-net-sub ql-card-a-available-label">Available</p>
                  <p class="hero-net-figure">${creditAccounts.length > 0 ? formatCurrencyWhole(totalCreditAvailable) : '—'}</p>
                </div>
                <div class="ql-card-a-spark">
                  ${renderQLSparkline(netFlowSparkline, netFlowSparkline.reduce((s, v) => s + v, 0) >= 0 ? '#4fae7e' : '#ef6f66')}
                </div>
              </div>

              <!-- Feature: breakdown so the headline "Available" figure
                   stays traceable rather than one opaque number. One
                   breakdown block per card (not just the first, with the
                   rest folded into a "+N more" note) so every card's own
                   balance/due-date/charges/payments is actually visible,
                   not just its contribution to the totals above. Each
                   block gets its own name/limit header once there's more
                   than one card, so it's clear whose figures they are;
                   with a single card that header is skipped since the
                   top-right "credit limit" stat already covers it. -->
              ${creditAccounts.map(a => `
                <div class="ql-card-a-percard">
                  ${creditAccounts.length > 1 ? `
                    <div class="ql-card-a-percard-head">
                      <span class="ql-card-a-percard-name">${escapeText(a.name)}</span>
                      <span class="ql-card-a-percard-limit">${formatCurrencyWhole(a.creditLimit || 0, a.currency)} limit</span>
                    </div>
                  ` : ''}
                  <div class="ql-card-a-breakdown ql-card-a-breakdown-4">
                    <div><span>Balance owing</span><strong>${formatCurrencyWhole(a.owed, a.currency)}${qlEquivalent(a.owed, a.currency)}</strong></div>
                    <div><span>Payment due on</span><strong>${a.nextDueDate ? formatDateDMY(a.nextDueDate) : '—'}</strong></div>
                    <div><span>Charges</span><strong class="negative">${formatCurrencyWhole(a.chargesThisCycle, a.currency)}</strong></div>
                    <div><span>Payments</span><strong class="positive">${formatCurrencyWhole(a.paymentsThisCycle, a.currency)}</strong></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Card A2: Net This Month — the same headline card
               heroDashboard.js's "New Look" toggle shows (gold-ring
               hero shell, month-nav header, big net figure, income/net
               worth footer), placed here so it's on screen even when
               New Look is off, right below the Credit Card card in the
               same column. Shares dashboardMonthOffset with that card's
               own nav (see qlNetMonthPrevBtn/NextBtn/TodayBtn wiring in
               dashboard.js) so the two can't disagree about which
               month they're each showing. -->
          <div class="fo-card fo-card-featured ql-card-a2 hero-net-card ql-hero-networth-card">
            <div class="hero-net-ring hero-net-ring-1" aria-hidden="true"></div>
            <div class="hero-net-ring hero-net-ring-2" aria-hidden="true"></div>
            <div class="hero-net-body">
              <div class="hero-net-top">
                <div class="hero-net-month-nav" onclick="event.stopPropagation()">
                  <button type="button" id="qlNetMonthPrevBtn" class="hero-month-nav-btn" title="Previous month">‹</button>
                  <span class="hero-net-label">Net · ${isCurrentCalendarMonth ? 'this month' : escapeText(selectedMonthLabel)}</span>
                  <button type="button" id="qlNetMonthNextBtn" class="hero-month-nav-btn" title="Next month" ${isCurrentCalendarMonth ? 'disabled' : ''}>›</button>
                  ${!isCurrentCalendarMonth ? '<button type="button" id="qlNetMonthTodayBtn" class="hero-month-nav-btn hero-month-today">Today</button>' : ''}
                </div>
                <span class="hero-status-pill ${overBudgetCount > 0 ? 'over' : ''}">${overBudgetCount > 0 ? `${overBudgetCount} OVER BUDGET` : 'ON TRACK'}</span>
              </div>
              <p class="hero-net-figure ${currentMonthBalance < 0 ? 'negative' : ''}">${moneySigned(currentMonthBalance)}</p>
              <p class="hero-net-sub">after ${moneySigned(Math.abs(currentMonthExpenses))} in expenses</p>
              <div class="hero-net-footer">
                <div><span>Income</span><strong>${moneySigned(currentMonthIncome)}</strong></div>
                <div><span>Net worth</span><strong>${moneySigned(totalNetWorth)}</strong></div>
              </div>
            </div>
          </div>

          <!-- Card H: Loan Totals — third hero card, same shell/size as
               Cards A and A2 so the panel opens on a clean row of three
               matched cards. Splits every loan by repayment structure
               (P&I vs currently Interest-Only — see the comment above
               piLoans/ioLoans in computeQuickLookData for why that's a
               phase, not a fixed type) and shows each bucket's total
               balance plus its monthly-equivalent repayment total. -->
          <div class="fo-card fo-card-featured ql-card-h hero-net-card ql-hero-loans-card">
            <div class="hero-net-ring hero-net-ring-1" aria-hidden="true"></div>
            <div class="hero-net-ring hero-net-ring-2" aria-hidden="true"></div>
            <div class="hero-net-body">
              <div class="hero-net-top">
                <span class="hero-net-label">🏦 Loan Totals</span>
              </div>
              <div class="ql-card-h-split">
                <div class="ql-card-h-block">
                  <p class="hero-net-sub">Principal &amp; Interest</p>
                  <p class="hero-net-figure ql-card-h-figure">${piLoans.length > 0 ? formatCurrencyWhole(totalPiLoanBalance) : '—'}</p>
                  <p class="ql-card-h-count">${piLoans.length} loan${piLoans.length === 1 ? '' : 's'}</p>
                </div>
                <div class="ql-card-h-divider" aria-hidden="true"></div>
                <div class="ql-card-h-block">
                  <p class="hero-net-sub">Interest-Only</p>
                  <p class="hero-net-figure ql-card-h-figure">${ioLoans.length > 0 ? formatCurrencyWhole(totalIoLoanBalance) : '—'}</p>
                  <p class="ql-card-h-count">${ioLoans.length} loan${ioLoans.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div class="hero-net-footer">
                <div><span>P&amp;I repay/mo</span><strong>${piLoans.length > 0 ? formatCurrencyWhole(totalPiLoanRepayment) : '—'}</strong></div>
                <div><span>IO repay/mo</span><strong>${ioLoans.length > 0 ? formatCurrencyWhole(totalIoLoanRepayment) : '—'}</strong></div>
              </div>
            </div>
          </div>

          <!-- Card B: Bill Reminders (tabbed) -->
          <div class="fo-card ql-card-b">
            <div class="fo-card-header-row">
              <span class="fo-card-title">📋 Bill Reminders</span>
              <div class="fo-tabgroup" id="qlBillTabs" data-bill-scope="ql">
                <button class="fo-tab ${selectedBillTab === 'overdue' ? 'active' : ''}" data-bill-tab="overdue">Overdue (${allOverdueBills.length})</button>
                <button class="fo-tab ${selectedBillTab === 'upcoming' ? 'active' : ''}" data-bill-tab="upcoming">Upcoming (${allUpcomingBills.length})</button>
                <button class="fo-tab ${selectedBillTab === 'paid' ? 'active' : ''}" data-bill-tab="paid">Paid (${allPaidBills.length})</button>
              </div>
            </div>
            <div class="ql-bill-panel" data-bill-scope="ql" data-bill-panel="overdue" style="display:${selectedBillTab === 'overdue' ? '' : 'none'}">
              ${allOverdueBills.length === 0 ? `<div class="fo-empty-note">Nothing overdue.</div>` : allOverdueBills.map(b => renderQLBillRow(b, categoryById, 'overdue')).join('')}
            </div>
            <div class="ql-bill-panel" data-bill-scope="ql" data-bill-panel="upcoming" style="display:${selectedBillTab === 'upcoming' ? '' : 'none'}">
              ${allUpcomingBills.length === 0 ? `<div class="fo-empty-note">Nothing upcoming.</div>` : allUpcomingBills.map(b => renderQLBillRow(b, categoryById, 'upcoming')).join('')}
            </div>
            <div class="ql-bill-panel" data-bill-scope="ql" data-bill-panel="paid" style="display:${selectedBillTab === 'paid' ? '' : 'none'}">
              ${allPaidBills.length === 0 ? `<div class="fo-empty-note">No paid bills yet.</div>` : allPaidBills.map(b => renderQLBillRow(b, categoryById, 'paid')).join('')}
            </div>
          </div>

          <!-- Card C: 30-Day Outlook -->
          <div class="fo-card ql-card-c">
            <div class="fo-card-title">30-Day Outlook</div>
            <div class="ql-outlook-gauge">${renderOutlookGauge(outlook)}</div>
            <div class="health-gauge-band ql-outlook-band" style="color: ${outlook.color};">${outlook.band}</div>
            <div class="ql-outlook-lines">
              <div class="ql-outlook-line"><span>Available</span><span>${formatCurrency(totalAccountBalance)}</span></div>
              <div class="ql-outlook-line"><span>Due this week</span><span class="${overdueCount > 0 ? 'negative' : ''}">${formatCurrency(dueThisWeekTotal)}</span></div>
              <div class="ql-outlook-line"><span>30-day forecast</span><span class="${projectedBalance30 < 0 ? 'negative' : 'positive'}">${formatCurrency(projectedBalance30)}</span></div>
            </div>
          </div>

          <!-- Card G: Loan Payoff Progress — same widget as the Dashboard/
               Wealth Overview page (icon, name, amount left of original,
               progress bar, percent paid off + estimated payoff date),
               just placed here too and sized to this card's column. -->
          <div class="fo-card ql-card-g">
            <div class="fo-card-header-row">
              <span class="fo-card-title">💳 Loan Payoff Progress</span>
              <span class="ql-loanpay-count">${loanPayoffs.length} loan${loanPayoffs.length === 1 ? '' : 's'}</span>
            </div>
            <div class="ql-loanpay-grid">
              ${loanPayoffs.length === 0 ? `<div class="fo-empty-note">No loans tracked.</div>` : loanPayoffs.map(loan => `
                <div class="budget-progress">
                  <div class="progress-header">
                    <span>${loan.icon} ${escapeText(loan.name)}</span>
                    <span>${loan.phase === 'drawing' ? `${formatCurrency(loan.drawnTotal, loan.currency)} drawn of ${formatCurrency(loan.facilityLimit, loan.currency)} facility` : `${formatCurrency(loan.current, loan.currency)} left of ${formatCurrency(loan.original, loan.currency)}`}</span>
                  </div>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: ${loan.percent}%"></div>
                  </div>
                  <div class="progress-status ${loan.isPaidOff ? 'on-track' : ''}">
                    ${loan.isPaidOff ? '✅ Paid Off' : loan.phase === 'drawing' ? `🏗️ ${loan.percent.toFixed(1)}% of facility drawn — construction in progress` : `${loan.percent.toFixed(1)}% paid off${loan.estPayoffDate ? ` · est. payoff ${loan.estPayoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}`}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Card D: Accounts & Loans -->
          <div class="fo-card ql-card-d">
            <div class="fo-card-header-row">
              <span class="fo-card-title">🏦 Accounts & Loans</span>
              ${!selectedPeriod.isCurrent && loanBalances.length > 0 ? `<span class="ql-period-tag" title="Loan balances are only tracked live, not per past period">Loans shown live</span>` : ''}
            </div>
            <div class="ql-accounts-layout">
              <div class="ql-balance-tile-grid">
                ${nonCreditAccounts.length === 0 && loanBalances.length === 0
                  ? `<div class="fo-empty-note">No accounts or loans yet.</div>`
                  : [
                      ...nonCreditAccounts.map(a => renderQLBalanceTile(a, 'account')),
                      ...loanBalances.map(l => renderQLBalanceTile(l, 'loan'))
                    ].join('')
                }
              </div>
              <div class="fo-donut-wrap ql-donut-wrap">
                <canvas id="qlBalancesPie"></canvas>
                <div class="fo-donut-center">
                  <span class="fo-donut-center-value">${compactMoney(totalAccountBalance)}</span>
                  <span class="fo-donut-center-label">Net</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Card E: Quick Facts -->
          <div class="fo-card ql-card-e">
            <div class="health-quickfacts ql-quickfacts">
              <div class="health-quickfact">
                <span class="health-quickfact-label">Loans Owing</span>
                <span class="health-quickfact-value">${formatCurrency(totalLoanBalance)}</span>
                <span class="health-quickfact-sub">${loanBalances.length} loan${loanBalances.length === 1 ? '' : 's'}</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">Next Income</span>
                <span class="health-quickfact-value">${nextIncome ? formatCurrency(nextIncome.amount) : '—'}</span>
                <span class="health-quickfact-sub">${nextIncome ? nextIncome.nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'None scheduled'}</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">Rent Status</span>
                <span class="health-quickfact-value ${rentOverdue.length > 0 ? 'negative' : 'positive'}">${rentOverdue.length > 0 ? `${rentOverdue.length} overdue` : 'Up to date'}</span>
                <span class="health-quickfact-sub">Rental properties</span>
              </div>
              <div class="health-quickfact ql-quickfact-budget" title="${escapeText(selectedPeriod.label)} · ${formatCurrency(periodIncome)} income, ${formatCurrency(periodExpense)} expenses">
                <span class="health-quickfact-label">Budget Status</span>
                <span class="health-quickfact-value ${periodNet >= 0 ? 'positive' : 'negative'}">${formatCurrency(periodNet)}</span>
                <div class="ql-budget-bar-track">
                  <div class="ql-budget-bar-fill income" style="width: ${periodIncomePct}%"></div>
                  <div class="ql-budget-bar-fill expense" style="width: ${100 - periodIncomePct}%"></div>
                </div>
                <span class="health-quickfact-sub">${formatCurrency(periodIncome)} in · ${formatCurrency(periodExpense)} out</span>
              </div>
            </div>
          </div>

          <!-- Card F: Renewals & Rent -->
          <div class="fo-card ql-card-f">
            <div class="fo-card-header-row"><span class="fo-card-title">🔔 Renewals</span></div>
            <div class="ql-renewals-list">
              ${[...insuranceBills, ...regoBills, ...licenceBills].length === 0 && rentOverdue.length === 0
                ? `<div class="fo-empty-note">Nothing due — all renewals up to date.</div>`
                : [
                    ...rentOverdue.map(r => `<div class="ql-bill-row"><span class="ql-bill-row-icon">🏘️</span><span class="ql-bill-row-name">${escapeText(r.name)} rent</span><span class="ql-bill-row-date negative">${r.lastDate ? `${r.daysSince}d overdue` : 'Never recorded'}</span></div>`),
                    ...[...insuranceBills, ...regoBills, ...licenceBills].slice(0, 5).map(b => renderQLBillRow(b, categoryById, b.dueDate < today ? 'overdue' : 'upcoming'))
                  ].join('')
              }
            </div>
          </div>

        </div>
        </div>
      </div>
    </div>
  `;
}

// Call after the HTML above has been inserted into the DOM — wires up the
// collapse toggle and the live clock
// fetch without blocking the initial render.
export function attachQuickLookBehavior() {
  const toggle = document.getElementById('quicklookToggle');
  const panel = document.getElementById('quicklookPanel');
  const body = panel?.querySelector('.quicklook-panel-body');
  const chevron = toggle?.querySelector('.quicklook-chevron');

  if (toggle && panel && body && chevron) {
    const doToggle = () => {
      const nowCollapsed = body.style.display !== 'none';
      body.style.display = nowCollapsed ? 'none' : '';
      panel.classList.toggle('collapsed', nowCollapsed);
      chevron.textContent = nowCollapsed ? '▶' : '▼';
      toggle.setAttribute('aria-expanded', String(!nowCollapsed));
      saveCollapsedState(nowCollapsed);
    };
    toggle.addEventListener('click', doToggle);
    toggle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        doToggle();
      }
    });
  }

  // Live clock — updates once a minute, no need for a full dashboard re-render
  const clockEl = document.getElementById('quicklookClock');
  if (clockEl) {
    // The dashboard can auto-refresh on a timer (see dashboard.js's "Live
    // Data" toggle), which re-runs this function each time — clear any
    // previous interval first so they don't stack up.
    if (window.__quicklookClockInterval) clearInterval(window.__quicklookClockInterval);
    window.__quicklookClockInterval = setInterval(() => {
      clockEl.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }, 60000);
  }

  // Bill Reminders tabs — all three panels are already in the DOM (see
  // renderQuickLookHTML), so switching tabs is just a show/hide + active
  // class toggle, no data recompute or re-render needed.
  const billTabGroup = document.getElementById('qlBillTabs');
  if (billTabGroup) {
    const billCard = billTabGroup.closest('.fo-card') || document;
    billTabGroup.querySelectorAll('.fo-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedBillTab = btn.dataset.billTab;
        billTabGroup.querySelectorAll('.fo-tab').forEach(b => b.classList.toggle('active', b === btn));
        // Scoped to this card (not document-wide) — the Dashboard's "New
        // look" mode can show its own Bill Reminders card at the same
        // time as this one, and each keeps its own selected tab.
        billCard.querySelectorAll('[data-bill-scope="ql"].ql-bill-panel').forEach(panel => {
          panel.style.display = panel.dataset.billPanel === selectedBillTab ? '' : 'none';
        });
      });
    });
  }

  // Panel-wide "as of" period selector — drives every balance figure in
  // the panel (accounts, credit card). Unlike the bill tabs above, this
  // genuinely needs a full recompute (different transactions get summed
  // for a different date), not just a DOM text swap, so it re-runs the
  // whole dashboard render via the callback dashboard.js registered with
  // setQuickLookPeriodChangeHandler — see the comment on
  // selectedPeriodOffset for why quickLook.js doesn't just import
  // dashboard.js directly to do this itself.
  const periodSelect = document.getElementById('qlPeriodSelect');
  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      selectedPeriodOffset = Number(periodSelect.value) || 0;
      if (quickLookPeriodChangeCallback) quickLookPeriodChangeCallback();
    });
  }

  // Credit Card hero card's own prev/next arrows — a second control
  // surface for the exact same selectedPeriodOffset the dropdown above
  // drives (see the comment on Card A in renderQuickLookHTML for why
  // this doesn't get its own independent date). Prev always has
  // somewhere to go within periodOptions' fixed length; Next is
  // disabled once already on the current period, same as the dropdown's
  // topmost option and heroDashboard's own month-nav.
  const creditPrevBtn = document.getElementById('qlCreditPrevBtn');
  const creditNextBtn = document.getElementById('qlCreditNextBtn');
  if (creditPrevBtn) {
    creditPrevBtn.addEventListener('click', () => {
      const periodSelectEl = document.getElementById('qlPeriodSelect');
      const maxOffset = periodSelectEl ? periodSelectEl.options.length - 1 : selectedPeriodOffset + 1;
      selectedPeriodOffset = Math.min(maxOffset, selectedPeriodOffset + 1);
      if (quickLookPeriodChangeCallback) quickLookPeriodChangeCallback();
    });
  }
  if (creditNextBtn) {
    creditNextBtn.addEventListener('click', () => {
      selectedPeriodOffset = Math.max(0, selectedPeriodOffset - 1);
      if (quickLookPeriodChangeCallback) quickLookPeriodChangeCallback();
    });
  }

  // Accounts & Loans balances pie — rebuilt every time this runs (the
  // dashboard can re-render on its own refresh timer), so the previous
  // Chart.js instance on this canvas is destroyed first or Chart.js throws
  // a "Canvas already in use" error.
  const pieCanvas = document.getElementById('qlBalancesPie');
  if (pieCanvas && typeof Chart !== 'undefined') {
    destroyQLChart('qlBalancesPie');
    const slices = qlLastBalancesForChart.filter(s => s.value > 0);
    if (slices.length > 0) {
      const palette = ['#c9a227', '#3ddc97', '#5b8def', '#a06bff', '#ffb454', '#ff6b7a', '#8c9bb5'];
      qlCharts.qlBalancesPie = new Chart(pieCanvas, {
        type: 'doughnut',
        data: {
          labels: slices.map(s => s.name),
          datasets: [{ data: slices.map(s => s.value), backgroundColor: palette, borderWidth: 0 }]
        },
        options: { maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
      });
    }
  }
}

export function cleanupQuickLook() {
  Object.keys(qlCharts).forEach(destroyQLChart);
}
