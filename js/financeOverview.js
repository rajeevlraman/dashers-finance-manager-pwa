// financeOverview.js
//
// "Finance Overview" — a dark, chart-dense dashboard styled after a
// reference infographic (deep navy background, teal/cyan accents, glowing
// rounded cards). Every number is computed from real data already in the
// app rather than the infographic's placeholder figures:
//
//   - Featured account card: your highest-balance non-credit account,
//     rendered with the same bank-card visual language as the Accounts
//     page (js/accounts.js), so it's recognisably "the same card".
//   - Budget Load ring: this month's spend against your configured
//     budgets (falls back to spend-vs-income if no budgets exist yet).
//   - Total Flow / Actual Change: total money moved (income+expenses) and
//     net change, year-to-date.
//   - Goals: the same local goals list as the Wealth Overview page
//     (js/wealthOverview.js) — edited there, just displayed here.
//   - Inflow / Compare Costs: real monthly income, expense, and
//     "goals contribution" (Savings/Investments/Super category) totals
//     for the current calendar year.
//   - Budget donut + 4 categories: this month's spend split into
//     Savings, Loan Repayments, Kids & Education, and everything else.
//   - Structure radar: your actual balance spread across account types.
//   - Costs donut: this month's top spending categories.
//   - Annual Plans: net savings (income − expenses) per calendar year,
//     using whatever years you actually have transaction history for
//     (not fabricated future years).
//
// Charts use the Chart.js instance already loaded globally by index.html.

import { getAllItems, STORE_NAMES, getFinancialYear, getCurrentFinancialYear } from './db.js';
import { getGatedItems, hasFeature } from './features.js';
import { escapeHtml } from './sanitize.js';
import { getDisplayName } from './userName.js';
import { computeAccountBalanceAsOf, computeAccountBalance } from './accountBalance.js';
import { loadGoals, computeWealthData } from './wealthOverview.js';
import { institutionDisplayName, renderInstitutionMark, pseudoLast4 } from './institutions.js';
import { getBillStatus, markBillPaid, getNextBillDueDate } from './bills.js';
import { getInsuranceRenewalStatus, annualPremium, POLICY_TYPES } from './insurance.js';
import { getRegoStatus } from './vehicles.js';
import { getNextDayOfMonthOccurrence } from './quickLook.js';
import { isInterestOnlyPeriod, calculateMinimumRepayment } from './loanCalculations.js';
import { getConnectionInfo } from './familySync.js';
import { chartInk, chartTextInk } from './chartTheme.js';
import { getRatesAndTaxEntries } from './ratesAndTax.js';

import { baseEquivalent, currencySymbol, formatMoney, getBaseCurrency, hasRate, toBase, toBaseTransactions } from './utils/currency.js';
let charts = {}; // keyed by canvas id, so re-renders destroy the right instance
let selectedInflowTab = 'inflow'; // 'costs' | 'goals' | 'inflow'
// Structure/Costs card merge — which of the two views is showing.
let selectedStructureTab = 'structure'; // 'structure' | 'costs'
// Compare Costs/Annual Plans card merge — which of the two views is showing.
let selectedBottomTab = 'compare'; // 'compare' | 'annual'
let compareShowGoals = true;
let compareShowInflow = true;
// The page-wide "which month am I looking at" control. Previously only the
// Compare Costs card had any month state (selectedCompareMonth), and even
// that only changed its own header numbers — every other card (Budget,
// Costs, Structure, the Budget Load ring, Total Flow/Actual Change,
// account balances) silently always used *today's* real month with no way
// to change it at all. selectedYear/selectedMonth is now read by
// computeFinanceOverviewData() for every one of those figures, and the
// prev/‹month›/next control rendered by renderPeriodNav() (plus the
// existing Compare Costs month chips, which now drive the same state) are
// the only things that change it. null = not yet initialized; set to the
// real current year/month the first time the page renders.
let selectedYear = null;
let selectedMonth = null; // 0-11
let selectedAnnualYear = null;
// Property Rates & Taxes card's own FY selector — independent of the
// page-wide selectedYear/selectedMonth above, since rates/land tax are
// billed annually rather than monthly. null = viewing the real current
// FY; set via the card's prev/next buttons to step through past years.
let selectedRatesTaxFY = null;
// Master-detail list card (Bills / Recurring / Loans / Accounts tabs):
// which tab is active, and which row is selected in the detail pane.
// selectedListKey is `${type}:${id}` so ids from different stores never
// collide; null defaults to the first row of whichever tab is active.
let selectedListTab = 'overdue'; // 'overdue' | 'upcoming' | 'paid' | 'recurring' | 'loans' | 'insurance' | 'rates' | 'vehicles' | 'accounts'
let selectedListKey = null;
// Which account (by id) is pinned to the front of the Balance card's
// stack. null means "use the default, highest-balance-first order". Set
// when the person taps a peek to bring it to the front (see the
// .fo-balance-peek click handler below) — deliberately just the id, not
// a full remembered order, so it only ever depends on live data computed
// fresh at click time (see the click handler for why that matters).
let pinnedBalanceAccountId = null;
// Same idea, but for the Credit Card card's own stack — which credit
// card (by id) is pinned to the front. null = default order (whatever
// order accounts.js/the accounts store returns them in).
let pinnedCreditAccountId = null;
// One-shot flag: true for exactly the render right after a peek tap, so
// that render's front card and peeks get an entrance animation. Cleared
// as soon as renderBalanceStack reads it, so ordinary re-renders (month
// nav, tab switches) don't replay the animation.
let balanceStackSwapAnimate = false;
// Same one-shot animation flag, for the Credit Card stack.
let creditStackSwapAnimate = false;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// `currency` is optional: pass an account's own currency for per-account
// figures; omit it for totals, which are already in the base currency.
function money(n, currency) {
  const num = Number(n) || 0;
  return formatMoney(num, currency, { digits: 0 });
}

function compactMoney(n, currency) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1000) return `${sign}${currencySymbol(currency)}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
  return `${sign}${formatMoney(abs, currency, { digits: 0 })}`;
}

// Base-currency (e.g. AUD) equivalent of an overseas account's balance, for the
// Balance card. '' for base-currency accounts. When the account's currency has
// no rate on file, says so instead of silently showing nothing.
function balanceEquivalent(amount, currency) {
  if (!currency || currency === getBaseCurrency()) return '';
  if (!hasRate(currency)) return `No ${currency}\u2192${getBaseCurrency()} rate set (Settings)`;
  return baseEquivalent(amount, currency);
}

function monthlyAmount(amount, frequency) {  const n = parseFloat(amount) || 0;
  switch (frequency) {
    case 'weekly': return n * 52 / 12;
    case 'fortnightly': return n * 26 / 12;
    case 'quarterly': return n / 3;
    case 'yearly': return n / 12;
    default: return n; // monthly
  }
}

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function topLevelCategoryId(categoryId, parentMap) {
  let id = categoryId;
  let guard = 0;
  while (parentMap.get(id) && guard < 10) {
    id = parentMap.get(id);
    guard++;
  }
  return id;
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

// Steps a recurring entry's last-processed/start date forward by its
// frequency until it's in the future — same frequency math as bills
// (bills.js's getNextBillDueDate), just looped for display purposes. This
// does not touch the actual catch-up/processing logic in recurringJob.js;
// it's only used to show "next due" on the Finance Overview list.
function nextRecurringDate(rec) {
  let d = rec.lastProcessed || rec.startDate;
  if (!d) return null;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 500 && d <= today; i++) {
    d = getNextBillDueDate(d, rec.frequency);
  }
  return d;
}

function computeFinanceOverviewData({ accounts, transactions, categories, budgets, loans, bills, properties, recurringTransactions, insurancePolicies, expenses, vehicles, selectedYear, selectedMonth }) {
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const monthKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
  const parentMap = new Map(categories.map(c => [c.id, c.parentId]));
  const categoryById = new Map(categories.map(c => [c.id, c]));

  // Balances "as of" the end of the selected month (capped at today, so a
  // past month shows what you actually had then, and the current month
  // shows the live figure) rather than always the live-right-now balance —
  // otherwise Structure/Balance/the featured card would never move when
  // you change month.
  const lastDayOfSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0);
  const today = new Date(todayYear, todayMonth, now.getDate());
  const asOfDate = (lastDayOfSelectedMonth < today ? lastDayOfSelectedMonth : today).toISOString().slice(0, 10);

  const accountBalances = accounts.map(a => ({ ...a, balance: computeAccountBalanceAsOf(a, transactions, asOfDate) }));
  // Aggregate cash-flow figures use base-currency amounts; per-account cards keep raw ones.
  const flowTx = toBaseTransactions(transactions, accounts);
  const totalAccountBalance = accountBalances.reduce((sum, a) => sum + toBase(a.balance, a.currency), 0);

  // --- Featured account (Card 1) — the highest-balance non-credit
  // account, shown as the front card of the Balance stack, with every
  // other eligible account peeking out behind it (tap one to bring it to
  // the front — see the .fo-balance-peek click handler). ---
  const featuredEligibleByBalance = accountBalances
    .filter(a => a.type !== 'credit')
    .sort((a, b) => toBase(b.balance, b.currency) - toBase(a.balance, a.currency));

  // Tapping a peek pins that account to the front; every other account
  // then falls back to balance order behind it. Pinning only the id (not
  // a whole remembered order) means this always recomputes correctly
  // from the CURRENT account list on every render — no stale ordering
  // left over from earlier taps. If the pinned account no longer exists
  // (e.g. deleted), this just falls back to the plain by-balance order.
  let featuredEligible = featuredEligibleByBalance;
  const pinned = pinnedBalanceAccountId && featuredEligibleByBalance.find(a => a.id === pinnedBalanceAccountId);
  if (pinned) {
    featuredEligible = [pinned, ...featuredEligibleByBalance.filter(a => a.id !== pinnedBalanceAccountId)];
  }

  const featured = featuredEligible[0] || null;

  // Every other eligible account peeks out behind the featured one in the
  // Balance card's stacked visual — not just the top few, so a person
  // with several accounts can still tap through to any of them.
  const balanceStackPeeks = featuredEligible.slice(1);

  // --- Selected month's income/expense (for Budget Load + Card 4, and
  // the Income/Expense cards) ---
  const monthTx = flowTx.filter(t => t.date?.startsWith(monthKey) && !t.isTransfer);
  const monthIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthExpense = Math.abs(monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const monthIncomeCount = monthTx.filter(t => t.type === 'income').length;
  const monthExpenseCount = monthTx.filter(t => t.type === 'expense').length;

  // --- Credit card summary (Quick Look's Credit Card card, reused here
  // so debt/utilization is visible without leaving Finance Overview).
  // Balance is already resolved to the selected month via accountBalances
  // above; charges/payments use this page's own calendar-month unit
  // (monthTx) rather than Quick Look's per-card statement-cycle window,
  // since this page doesn't track each card's own statement close day. ---
  const creditAccounts = accountBalances.filter(a => a.type === 'credit').map(a => {
    const owed = Math.abs(Math.min(a.balance, 0));
    const available = a.creditLimit > 0 ? Math.max(a.creditLimit + a.balance, 0) : null;
    // Pulled from the unfiltered transaction list (not monthTx, which
    // already drops isTransfer rows above) since a card payment is a
    // transfer — chargesThisCycle excludes transfers, paymentsThisCycle
    // is nothing but transfers, same distinction Quick Look's credit
    // card card makes.
    const cardMonthTx = transactions.filter(t => t.accountId === a.id && t.date?.startsWith(monthKey));
    const chargesThisCycle = Math.abs(cardMonthTx.filter(t => t.type === 'expense' && !t.isTransfer).reduce((s, t) => s + t.amount, 0));
    const paymentsThisCycle = cardMonthTx.filter(t => t.isTransfer && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const nextDueDate = a.statementDueDay ? getNextDayOfMonthOccurrence(a.statementDueDay, asOfDate) : null;
    return { ...a, owed, available, chargesThisCycle, paymentsThisCycle, nextDueDate };
  });
  const totalCreditOwed = creditAccounts.reduce((sum, a) => sum + toBase(a.owed, a.currency), 0);
  const totalCreditLimit = creditAccounts.reduce((sum, a) => sum + toBase(a.creditLimit || 0, a.currency), 0);
  const totalCreditAvailable = creditAccounts.reduce((sum, a) => sum + toBase(a.available || 0, a.currency), 0);
  const creditUtilizationPct = totalCreditLimit > 0 ? Math.min(100, (totalCreditOwed / totalCreditLimit) * 100) : 0;

  // --- Featured credit card (front of the Credit Card card's own
  // stack) — same pin-to-front pattern as the Balance card's featured
  // account above, just with its own pinned id (pinnedCreditAccountId)
  // and its own peek class (.fo-credit-peek) so tapping a Balance peek
  // and a Credit peek can never cross-wire which stack gets updated.
  // Default order (no pin) is whatever order the accounts store
  // returns credit accounts in, not sorted by owed/available — there's
  // no obviously "right" default ordering for credit cards the way
  // highest-balance-first is for the Balance stack. ---
  let creditOrdered = creditAccounts;
  const pinnedCredit = pinnedCreditAccountId && creditAccounts.find(a => a.id === pinnedCreditAccountId);
  if (pinnedCredit) {
    creditOrdered = [pinnedCredit, ...creditAccounts.filter(a => a.id !== pinnedCreditAccountId)];
  }
  const featuredCredit = creditOrdered[0] || null;
  const creditStackPeeks = creditOrdered.slice(1);
  const featuredCreditUtilizationPct = featuredCredit && featuredCredit.creditLimit > 0
    ? Math.min(100, (featuredCredit.owed / featuredCredit.creditLimit) * 100)
    : 0;

  // 6 months of the featured credit card's OWN net spend (charges minus
  // payments), ending at the selected month — same shape as
  // featuredSparkline above for the Balance card, just charges/payments
  // instead of income/expense since a card doesn't have "income".
  const featuredCreditSparkline = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selectedYear, selectedMonth - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const tx = featuredCredit
      ? transactions.filter(t => t.date?.startsWith(key) && t.accountId === featuredCredit.id)
      : [];
    const charges = Math.abs(tx.filter(t => t.type === 'expense' && !t.isTransfer).reduce((s, t) => s + t.amount, 0));
    const payments = tx.filter(t => t.isTransfer && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    featuredCreditSparkline.push(charges - payments);
  }

  const totalMonthlyBudget = budgets.reduce((sum, b) => {
    const cat = categoryById.get(b.categoryId);
    const isExpenseCat = cat ? cat.type !== 'income' : true;
    return isExpenseCat ? sum + monthlyAmount(b.amount, b.frequency) : sum;
  }, 0);

  // --- Per-category budget performance, for the pulse header's "N
  // budgets over limit" flag — distinct from totalMonthlyBudget above
  // (one combined ceiling): this checks each budget individually, so a
  // single blown category surfaces even if total spend is still under
  // the combined budget. A transaction counts toward a budget if it's
  // tagged with that exact category, or one of its subcategories, so a
  // budget on a parent category rolls up spend from its children. ---
  const matchesBudgetCategory = (t, budgetCategoryId) => {
    if (t.categoryId === budgetCategoryId) return true;
    const txCat = categoryById.get(t.categoryId);
    return !!(txCat && txCat.parentId === budgetCategoryId);
  };
  const overBudgetCount = budgets.filter(b => {
    const spent = Math.abs(monthTx
      .filter(t => t.type === 'expense' && matchesBudgetCategory(t, b.categoryId))
      .reduce((sum, t) => sum + t.amount, 0));
    return spent > monthlyAmount(b.amount, b.frequency);
  }).length;

  // --- Card 1 (Balance stack) metrics — Budget Load, Total Flow, Actual
  // Change and the sparkline all scope to whichever account is currently
  // featured in the stack, so tapping a peek updates these to that
  // account's own numbers rather than the whole portfolio's. (Budgets
  // themselves aren't tracked per account, so Budget Load here reads as
  // "this account's spend against its own income this month", falling
  // back to the whole-portfolio monthly budget if it had no income to
  // compare against.) monthIncome/monthExpense above stay portfolio-wide
  // — the Income/Expense cards and the budget donut still need those. ---
  const featuredAccountId = featured ? featured.id : null;
  const featuredMonthTx = featuredAccountId ? monthTx.filter(t => t.accountId === featuredAccountId) : [];
  const featuredMonthIncome = featuredMonthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const featuredMonthExpense = Math.abs(featuredMonthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const budgetLoadPct = featuredMonthIncome > 0
    ? Math.min(100, (featuredMonthExpense / featuredMonthIncome) * 100)
    : (totalMonthlyBudget > 0 ? Math.min(100, (featuredMonthExpense / totalMonthlyBudget) * 100) : 0);

  // --- Year-to-date Total Flow / Actual Change, through the selected
  // month, for the featured account (Card 1) — e.g. picking June shows
  // Jan-Jun, not the full year. ---
  const featuredYtdTx = transactions.filter(t => {
    if (!t.date || t.isTransfer || !t.date.startsWith(String(selectedYear))) return false;
    if (featuredAccountId && t.accountId !== featuredAccountId) return false;
    const txMonth = parseInt(t.date.slice(5, 7), 10) - 1;
    return txMonth <= selectedMonth;
  });
  const ytdIncome = featuredAccountId ? featuredYtdTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) : 0;
  const ytdExpense = featuredAccountId ? Math.abs(featuredYtdTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)) : 0;
  const totalFlow = ytdIncome + ytdExpense;
  const actualChange = ytdIncome - ytdExpense;

  // --- 6 months of the featured account's own net flow ending at the
  // selected month, for the Card 1 sparkline. ---
  const featuredSparkline = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selectedYear, selectedMonth - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const tx = featuredAccountId
      ? transactions.filter(t => t.date?.startsWith(key) && !t.isTransfer && t.accountId === featuredAccountId)
      : [];
    const inc = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = Math.abs(tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    featuredSparkline.push(inc - exp);
  }

  // --- Same 6-month window, but whole-portfolio — kept separately for
  // the Credit Card twin (renderCreditCard), which is a visual twin of
  // Card 1 but tracks credit accounts, not the Balance stack's featured
  // account. ---
  const sparkline = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selectedYear, selectedMonth - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const tx = flowTx.filter(t => t.date?.startsWith(key) && !t.isTransfer);
    const inc = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = Math.abs(tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    sparkline.push(inc - exp);
  }

  // --- Goals (shared with Wealth Overview) ---
  const goals = loadGoals().map(g => ({ ...g, percent: Math.max(0, Math.min(100, (g.current / (g.target || 1)) * 100)) }));
  const goalsTotalCurrent = goals.reduce((s, g) => s + (g.current || 0), 0);
  const goalsTotalTarget = goals.reduce((s, g) => s + (g.target || 0), 0);
  const goalsOverallPct = goalsTotalTarget > 0 ? (goalsTotalCurrent / goalsTotalTarget) * 100 : 0;

  // --- Monthly series for the selected year: income, expenses,
  // goals-contribution (Cards 3 & 7) ---
  const monthlySeries = MONTH_LABELS.map((label, idx) => {
    const key = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
    const tx = flowTx.filter(t => t.date?.startsWith(key) && !t.isTransfer);
    const inflow = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const costs = Math.abs(tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    const goalsAmt = Math.abs(tx
      .filter(t => t.type === 'expense' && topLevelCategoryId(t.categoryId, parentMap) === 'cat_savings')
      .reduce((s, t) => s + t.amount, 0));
    const monthDate = new Date(selectedYear, idx, 1);
    return { label, monthIndex: idx, inflow, costs, goals: goalsAmt, hasData: monthDate <= new Date(todayYear, todayMonth, 1) };
  });

  // --- Budget card: Top 15 / Lowest 6 categories by this month's spend.
  // Exact category/subcategory level (same granularity as Top Spending
  // Categories), each with its monthly budget when one exists for that
  // exact category. Lowest 6 are taken from what's left after the top 15
  // so a category never appears in both lists; with fewer than 21
  // spending categories the lowest list simply shows what remains. ---
  const budgetByCategory = new Map();
  budgets.forEach(b => {
    budgetByCategory.set(b.categoryId, (budgetByCategory.get(b.categoryId) || 0) + monthlyAmount(b.amount, b.frequency));
  });
  const budgetSpendByCategory = new Map();
  monthTx.filter(t => t.type === 'expense').forEach(t => {
    const key = t.categoryId || 'uncategorized';
    budgetSpendByCategory.set(key, (budgetSpendByCategory.get(key) || 0) + Math.abs(t.amount));
  });
  const budgetRanked = [...budgetSpendByCategory.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([catId, amount]) => {
      const cat = categoryById.get(catId);
      const budget = budgetByCategory.get(catId) || 0;
      return {
        name: cat?.name || 'Uncategorized',
        icon: cat?.icon || '🏷️',
        amount,
        budget,
        usedPct: budget > 0 ? (amount / budget) * 100 : null
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const budgetTop15 = budgetRanked.slice(0, 15);
  const budgetSpendTotal = budgetRanked.reduce((sum, c) => sum + c.amount, 0);
  const budgetSpendShare = budgetRanked.slice(0, 8).map(c => ({ ...c, percent: budgetSpendTotal > 0 ? (c.amount / budgetSpendTotal) * 100 : 0 }));
  const budgetSpendRest = budgetRanked.slice(8);
  if (budgetSpendRest.length > 0) {
    const otherAmount = budgetSpendRest.reduce((sum, c) => sum + c.amount, 0);
    budgetSpendShare.push({ name: `Other (${budgetSpendRest.length} more)`, icon: '🔹', amount: otherAmount, budget: 0, usedPct: null, percent: budgetSpendTotal > 0 ? (otherAmount / budgetSpendTotal) * 100 : 0 });
  }
  const budgetLowest5 = budgetRanked.slice(15).sort((a, b) => a.amount - b.amount).slice(0, 5);

  // "No spend": expense categories that have a budget but nothing spent
  // against it this month (a budget on a parent counts spend in its
  // subcategories too, so those aren't falsely flagged). Biggest unused
  // budget first, capped at 5.
  const budgetNoSpend = [...budgetByCategory.entries()]
    .filter(([catId, budget]) => {
      const cat = categoryById.get(catId);
      if (!cat || cat.type === 'income' || budget <= 0) return false;
      return !monthTx.some(t => t.type === 'expense' && (t.categoryId === catId || categoryById.get(t.categoryId)?.parentId === catId));
    })
    .map(([catId, budget]) => {
      const cat = categoryById.get(catId);
      return { name: cat.name, icon: cat.icon || '🏷️', amount: 0, budget, usedPct: 0 };
    })
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 5);

  // --- Budget donut + 4 categories (Card 4) ---
  const monthExpenseTx = monthTx.filter(t => t.type === 'expense');
  const spendByTopCategory = new Map();
  monthExpenseTx.forEach(t => {
    const top = topLevelCategoryId(t.categoryId, parentMap);
    spendByTopCategory.set(top, (spendByTopCategory.get(top) || 0) + Math.abs(t.amount));
  });
  const savingsSpend = spendByTopCategory.get('cat_savings') || 0;
  // Loans = the Debt Repayments group PLUS mortgage/loan-style repayments
  // that live under other parents (Home/Equity Mortgage and Home Building
  // sit under Housing & Living; Investment Mortgage under Investment
  // Property). Counting only cat_debt made this row read $0 while
  // thousands of mortgage repayments sat in "All Other".
  const LOAN_REPAYMENT_SUBCATEGORY_IDS = new Set(['sub_mortgage_home', 'sub_home_equity_mortgage', 'sub_inv_mortgage', 'sub_home_building']);
  const extraLoanSpend = monthExpenseTx
    .filter(t => LOAN_REPAYMENT_SUBCATEGORY_IDS.has(t.categoryId) && topLevelCategoryId(t.categoryId, parentMap) !== 'cat_debt')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const loansSpend = (spendByTopCategory.get('cat_debt') || 0) + extraLoanSpend;
  const kidsEduSpend = (spendByTopCategory.get('cat_kids') || 0) + (spendByTopCategory.get('cat_education') || 0);
  const allOtherSpend = Math.max(0, monthExpense - savingsSpend - loansSpend - kidsEduSpend);
  const budgetDonutTotal = totalMonthlyBudget > 0 ? totalMonthlyBudget : monthExpense;
  const inflowPct = (monthIncome + monthExpense) > 0 ? (monthIncome / (monthIncome + monthExpense)) * 100 : 50;

  // --- Structure radar: balance by account type, as of the selected
  // month (Card 5) ---
  const typeLabels = { bank: 'Checking', savings: 'Savings', investment: 'Investments', offset: 'Offset', cash: 'Cash' };
  const structureAxes = Object.keys(typeLabels).map(type => ({
    label: typeLabels[type],
    value: Math.max(0, accountBalances.filter(a => a.type === type).reduce((s, a) => s + toBase(a.balance, a.currency), 0))
  }));

  // --- Costs donut: top spending categories in the selected month (Card 6) ---
  const sortedCategorySpend = [...spendByTopCategory.entries()].sort((a, b) => b[1] - a[1]);
  const topN = sortedCategorySpend.slice(0, 6);
  const remainder = sortedCategorySpend.slice(6).reduce((s, [, v]) => s + v, 0);
  const costsBreakdown = topN.map(([catId, amt]) => {
    const cat = categoryById.get(catId);
    return { name: cat?.name || 'Other', icon: cat?.icon || '📦', amount: amt };
  });
  if (remainder > 0) costsBreakdown.push({ name: 'Other', icon: '📦', amount: remainder });
  const costsTotal = costsBreakdown.reduce((s, c) => s + c.amount, 0);

  // --- My Cards stack: top 3 accounts by balance magnitude, any type,
  // as-of the selected month — the front card doubles as "featured" above. ---
  const stackedAccounts = accountBalances
    .slice()
    .sort((a, b) => Math.abs(toBase(b.balance, b.currency)) - Math.abs(toBase(a.balance, a.currency)))
    .slice(0, 3);

  // --- Annual Plans: net savings per year, using real years present (Card 8) ---
  const yearsWithData = new Set(transactions.map(t => t.date?.slice(0, 4)).filter(Boolean));
  yearsWithData.add(String(todayYear));
  const years = [...yearsWithData].sort().slice(-3);
  const annualData = years.map(year => {
    const tx = flowTx.filter(t => t.date?.startsWith(year) && !t.isTransfer);
    const inc = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = Math.abs(tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    return { year, netSavings: inc - exp, income: inc, expense: exp };
  });

  // --- Bills card: real bills, sorted overdue-first then soonest-due,
  // matching the same status logic as the dedicated Bills page. ---
  const todayStr = new Date().toISOString().slice(0, 10);
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const propertyById = new Map((properties || []).map(p => [p.id, p]));
  const billsList = (bills || [])
    .map(b => ({
      ...b,
      currency: b.currency || accountById.get(b.accountId)?.currency,
      status: getBillStatus(b, todayStr),
      payeeLabel: (b.propertyId && propertyById.get(b.propertyId)?.name) || accountById.get(b.accountId)?.name || 'No account set',
      categoryName: categoryById.get(b.categoryId)?.name || 'Uncategorized'
    }))
    .sort((a, b) => {
      // Overdue bills first (most overdue first), then everything else
      // by soonest due date, unpaid before paid.
      if (a.paid !== b.paid) return a.paid ? 1 : -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  const overdueBillsCount = billsList.filter(b => b.status.class === 'overdue').length;

  // --- "At a glance" strip: the four numbers that answer "where do I
  // stand" without opening another page. ---
  // Debt: loan balances + what's owed on credit cards.
  const totalLoanDebt = (loans || []).reduce((sum, l) => sum + toBase(parseFloat(l.currentBalance) || 0, l.currency), 0);
  const totalDebt = totalLoanDebt + totalCreditOwed;
  // Runway: spendable cash (everyday, savings, offset, cash — not
  // investments, not credit) divided by average monthly spend over the
  // three months BEFORE the selected one. Null when there's no history.
  const liquidCash = accountBalances
    .filter(a => ['bank', 'savings', 'offset', 'cash'].includes(a.type))
    .reduce((sum, a) => sum + toBase(a.balance, a.currency), 0);
  const priorMonthSpends = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(selectedYear, selectedMonth - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const spend = Math.abs(flowTx
      .filter(t => t.date?.startsWith(key) && t.type === 'expense' && !t.isTransfer)
      .reduce((sum, t) => sum + t.amount, 0));
    if (spend > 0) priorMonthSpends.push(spend);
  }
  const avgMonthlySpend = priorMonthSpends.length > 0 ? priorMonthSpends.reduce((a, b) => a + b, 0) / priorMonthSpends.length : 0;
  const runwayMonths = avgMonthlySpend > 0 ? Math.max(0, liquidCash) / avgMonthlySpend : null;
  // Bills: unpaid bills falling due in the next 7 days (overdue ones are
  // already flagged in the headline above).
  const weekAhead = new Date(); weekAhead.setDate(weekAhead.getDate() + 7);
  const weekAheadStr = `${weekAhead.getFullYear()}-${String(weekAhead.getMonth() + 1).padStart(2, '0')}-${String(weekAhead.getDate()).padStart(2, '0')}`;
  const nowLocal = new Date();
  const todayLocalStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
  const billsDueSoon = billsList.filter(b => !b.paid && b.dueDate >= todayLocalStr && b.dueDate <= weekAheadStr);
  const billsDueSoonTotal = billsDueSoon.reduce((sum, b) => sum + toBase(parseFloat(b.amount) || 0, b.currency), 0);

  // --- Recent Activity (Card 1 area): last 6 real transactions across
  // every account, most recent first. Deliberately not scoped to the
  // selected month/account — this is "what just happened", not a report. ---
  const recentActivity = flowTx
    .filter(t => !t.isTransfer && t.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
    .map(t => ({
      date: t.date,
      type: t.type,
      amount: t.amount,
      // flowTx is converted to base; keep the transaction's own figure so a ₹ row reads ₹ (+ base equivalent).
      nativeAmount: t.amountOriginal ?? t.amount,
      currency: t.amountOriginal !== undefined ? t.currency : undefined,
      label: t.merchant || t.description || categoryById.get(t.categoryId)?.name || 'Transaction',
      accountName: accountById.get(t.accountId)?.name || 'Unknown account'
    }));

  // --- Recurring / Loans / Accounts tabs on the same master-detail card:
  // normalized just enough (category/account/property names resolved) so
  // the render layer doesn't need to know about other stores. ---
  const recurringList = (recurringTransactions || []).map(r => ({
    ...r,
    currency: r.currency || accountById.get(r.accountId)?.currency,
    categoryName: categoryById.get(r.categoryId)?.name || '',
    accountName: accountById.get(r.accountId)?.name || '',
    linkedLoanName: r.loanId ? (loans || []).find(l => l.id === r.loanId)?.name : null,
    nextDate: nextRecurringDate(r)
  }));

  const loansList = (loans || []).map(l => ({
    ...l,
    lenderName: institutionDisplayName(l.institution, l.institutionName),
    propertyName: l.propertyId ? propertyById.get(l.propertyId)?.name : null,
    payoffPct: l.originalAmount > 0 ? Math.min(100, ((l.originalAmount - l.currentBalance) / l.originalAmount) * 100) : 0
  }));

  const accountsListFull = accountBalances.map(a => ({
    ...a,
    instName: institutionDisplayName(a.institution, a.institutionName)
  }));

  // Insurance tab/mini-card — see js/insurance.js for the policy record
  // shape and getInsuranceRenewalStatus's wider (30/60d) thresholds, which
  // this list is sorted/statused by rather than bill due-date urgency.
  const insuranceList = (insurancePolicies || []).map(p => ({
    ...p,
    propertyName: p.linkedPropertyId ? propertyById.get(p.linkedPropertyId)?.name : null,
    typeLabel: (POLICY_TYPES[p.policyType] || POLICY_TYPES.other).label,
    status: getInsuranceRenewalStatus(p)
  }));
  const totalAnnualPremium = insuranceList.reduce((sum, p) => sum + annualPremium(p), 0);
  const policiesRenewingSoonCount = insuranceList.filter(p => p.status.class === 'overdue' || p.status.class === 'due-soon').length;

  // Property Rates & Taxes card — Council Rates and Land Tax are two
  // distinct buckets (see propertyExpenseCategories.js; previously land
  // tax was silently folded into Council Rates). Sourced from BOTH direct
  // Expenses-page entries AND property-linked transactions (paid bills,
  // bank-imported/auto-flagged property expenses) via ratesAndTax.js,
  // de-duplicated against each other. Rates/land tax are billed annually
  // by local/state government rather than on a premium-style renewal
  // date, so this is scoped to a financial year rather than the page's
  // month picker — defaulting to the real current FY, but browsable via
  // the card's own prev/next buttons (selectedRatesTaxFY), independent of
  // selectedYear/selectedMonth above.
  const currentFY = getCurrentFinancialYear();
  const ratesAndTaxAllEntries = getRatesAndTaxEntries({ expenses, transactions, bills });
  const ratesAndTaxFY = selectedRatesTaxFY || currentFY;
  const ratesAndTaxEarliestFY = ratesAndTaxAllEntries.length
    ? ratesAndTaxAllEntries.map(e => getFinancialYear(e.date)).sort()[0]
    : ratesAndTaxFY;
  const ratesAndTaxExpenses = ratesAndTaxAllEntries.filter(e => getFinancialYear(e.date) === ratesAndTaxFY);
  const totalCouncilRatesFY = ratesAndTaxExpenses
    .filter(e => e.category === 'Council Rates')
    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalLandTaxFY = ratesAndTaxExpenses
    .filter(e => e.category === 'Land Tax')
    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const unpaidRatesAndTax = ratesAndTaxExpenses.filter(e => e.status === 'Unpaid');
  const unpaidRatesAndTaxTotal = unpaidRatesAndTax.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  // Rates & Tax tab on the master-detail list card — every entry across
  // all financial years (not just ratesAndTaxFY above), so browsing the
  // tab shows full history the same way the Loans/Insurance/Accounts tabs
  // do, rather than being tied to the mini-card's own FY picker.
  const ratesAndTaxList = ratesAndTaxAllEntries
    .map(e => ({
      ...e,
      propertyName: e.propertyId ? propertyById.get(e.propertyId)?.name : null
    }))
    .sort((a, b) => {
      if ((a.status === 'Unpaid') !== (b.status === 'Unpaid')) return a.status === 'Unpaid' ? -1 : 1;
      return (b.date || '').localeCompare(a.date || '');
    });

  // Registration tab on the master-detail list card — see js/vehicles.js
  // for the record shape; a vehicle isn't linked to a property (it can
  // optionally link to a car insurance policy instead), so no
  // propertyName resolution is needed here the way loans/insurance get.
  const vehiclesList = (vehicles || []).map(v => ({
    ...v,
    displayName: v.nickname || [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
    makeModel: [v.year, v.make, v.model].filter(Boolean).join(' '),
    regoStatus: getRegoStatus(v)
  }));

  // Loan Totals card (left column, below Income/Expense) — same
  // Principal & Interest vs Interest-Only split as Quick Look's "Card H",
  // reusing loans.js/loanCalculations.js so the two stay consistent. Like
  // Quick Look, this ignores the page's month picker: loan balances are
  // always their own live currentBalance, and the offset lookup below
  // uses computeAccountBalance (all transactions), not the as-of/selected-
  // month accountBalances used elsewhere on this page.
  const monthlyRepaymentEquivalent = (loan) => {
    const periodsPerYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 }[loan.paymentFrequency] || 12;
    let offsetBalance = 0;
    if (loan.linkedOffsetId) {
      const offsetAccount = accounts.find(a => a.id === loan.linkedOffsetId);
      if (offsetAccount) offsetBalance = computeAccountBalance(offsetAccount, transactions);
    }
    return calculateMinimumRepayment(loan, { offsetBalance }) * periodsPerYear / 12;
  };
  const piLoans = (loans || []).filter(l => !isInterestOnlyPeriod(l));
  const ioLoans = (loans || []).filter(l => isInterestOnlyPeriod(l));
  const totalPiLoanBalance = piLoans.reduce((sum, l) => sum + toBase(l.currentBalance || 0, l.currency), 0);
  const totalPiLoanRepayment = piLoans.reduce((sum, l) => sum + toBase(monthlyRepaymentEquivalent(l), l.currency), 0);
  const totalIoLoanBalance = ioLoans.reduce((sum, l) => sum + toBase(l.currentBalance || 0, l.currency), 0);
  const totalIoLoanRepayment = ioLoans.reduce((sum, l) => sum + toBase(monthlyRepaymentEquivalent(l), l.currency), 0);

  return {
    selectedYear, selectedMonth,
    isCurrentRealMonth: selectedYear === todayYear && selectedMonth === todayMonth,
    isFutureOfReal: selectedYear > todayYear || (selectedYear === todayYear && selectedMonth >= todayMonth),
    featured, balanceStackPeeks, totalAccountBalance,
    budgetLoadPct, totalMonthlyBudget, overBudgetCount, monthIncome, monthExpense,
    monthIncomeCount, monthExpenseCount, featuredSparkline,
    creditAccounts, totalCreditOwed, totalCreditLimit, totalCreditAvailable, creditUtilizationPct,
    featuredCredit, creditStackPeeks, featuredCreditUtilizationPct, featuredCreditSparkline,
    totalFlow, actualChange, sparkline,
    goals, goalsTotalCurrent, goalsTotalTarget, goalsOverallPct,
    monthlySeries,
    savingsSpend, loansSpend, kidsEduSpend, allOtherSpend, budgetDonutTotal, inflowPct,
    budgetTop15, budgetLowest5, budgetNoSpend, budgetSpendShare, budgetSpendTotal,
    totalDebt, runwayMonths, liquidCash, avgMonthlySpend, billsDueSoonCount: billsDueSoon.length, billsDueSoonTotal,
    structureAxes,
    costsBreakdown, costsTotal,
    annualData,
    stackedAccounts,
    billsList, overdueBillsCount, recentActivity,
    recurringList,
    loansList,
    insuranceList, totalAnnualPremium, policiesRenewingSoonCount,
    currentFY, ratesAndTaxFY, totalCouncilRatesFY, totalLandTaxFY, unpaidRatesAndTax, unpaidRatesAndTaxTotal,
    canGoEarlierRatesTaxFY: ratesAndTaxFY > ratesAndTaxEarliestFY,
    canGoLaterRatesTaxFY: ratesAndTaxFY !== currentFY,
    ratesAndTaxList,
    vehiclesList,
    accountsListFull,
    loans,
    piLoans, ioLoans,
    totalPiLoanBalance, totalPiLoanRepayment,
    totalIoLoanBalance, totalIoLoanRepayment
  };
}

// ---------------------------------------------------------------------------
// Small SVG helpers (sparkline, mini card)
// ---------------------------------------------------------------------------

function renderSparkline(values, color) {
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

function renderMiniBankCard(account) {
  if (!account) {
    return `<div class="fo-mini-card fo-mini-card-empty">No account yet</div>`;
  }
  const instName = institutionDisplayName(account.institution, account.institutionName);
  const masked = `•••• •••• •••• ${account.last4 || pseudoLast4(account.id)}`;
  return `
    <div class="fo-mini-card type-${account.type}">
      <div class="fo-mini-card-top">
        ${renderInstitutionMark(account.institution, account.institutionName)}
        <span class="fo-mini-card-chip" aria-hidden="true"></span>
      </div>
      <div class="fo-mini-card-number">${masked}</div>
      <div class="fo-mini-card-bottom">
        <span>${escapeHtml(instName || account.name)}</span>
      </div>
    </div>
  `;
}

function guessGoalIcon(name) {
  const n = (name || '').toLowerCase();
  if (/house|home|property|mortgage/.test(n)) return '🏠';
  if (/travel|trip|holiday|vacation/.test(n)) return '✈️';
  if (/car|vehicle/.test(n)) return '🚗';
  if (/kid|school|education|uni/.test(n)) return '🎓';
  if (/wedding/.test(n)) return '💍';
  return '🎯';
}

// ---------------------------------------------------------------------------
// Card renderers
// ---------------------------------------------------------------------------

// Distance (px) between each peek's top edge and the next — also used as
// the gap between the top peek and the front card. Equal for every step,
// so the stack reads as evenly spaced cards rather than a tight fan.
const BALANCE_PEEK_STEP = 34;

// Renders the front (featured) mini bank card with every other eligible
// account peeking out behind it, like cards tucked into a wallet — closer
// accounts (by balance, or whichever one the person last tapped to the
// front) sit nearer the front, in front of accounts further back. Each
// peek is tappable: tapping one brings it to the front (see the
// .fo-balance-peek click handler in attachFinanceOverviewBehavior), and
// that render gets a brief entrance animation (balanceStackSwapAnimate).
function renderBalanceStack(featured, peeks = []) {
  const peekCount = peeks.length;
  const animate = balanceStackSwapAnimate;
  balanceStackSwapAnimate = false; // one-shot — don't replay on the next unrelated re-render
  const peekHtml = peeks.map((a, i) => {
    const top = (peekCount - 1 - i) * BALANCE_PEEK_STEP; // further-back accounts sit higher
    const z = peekCount - i; // and behind (lower z-index)
    const delay = animate ? `; animation-delay: ${i * 25}ms` : '';
    return `
      <button type="button" class="fo-balance-peek type-${a.type}" style="top: ${top}px; z-index: ${z}${delay};" data-account-id="${a.id}" aria-label="Bring ${escapeHtml(a.name)} to front">
        <span class="fo-balance-peek-name">${escapeHtml(a.name)}</span>
        <span class="fo-balance-peek-amount">${compactMoney(a.balance, a.currency)}${a.currency && a.currency !== getBaseCurrency() && hasRate(a.currency) ? ` <small class="fo-balance-peek-equiv">\u2248 ${compactMoney(toBase(a.balance, a.currency), getBaseCurrency())}</small>` : ''}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="fo-balance-stack${animate ? ' fo-balance-stack--swap' : ''}" style="padding-top: ${peekCount * BALANCE_PEEK_STEP}px;">
      ${peekHtml}
      <div class="fo-balance-stack-front">${renderMiniBankCard(featured)}</div>
    </div>
  `;
}

// Same stacked-cards visual as renderBalanceStack above (reuses its
// .fo-balance-stack/.fo-balance-stack-front/.fo-balance-peek CSS
// wholesale — this is purely a different data source, not a different
// look), but for the Credit Card card, so with more than one credit
// card each one's own data is a tap away instead of only ever showing
// the first. Kept as a separate function (rather than a parameter on
// renderBalanceStack) because the click handler needs to tell a Balance
// peek and a Credit peek apart — see .fo-credit-peek below, which is
// checked in addition to .fo-balance-peek precisely so the delegated
// listener can route each to its own pinned-id state.
function renderCreditStack(featured, peeks = []) {
  const peekCount = peeks.length;
  const animate = creditStackSwapAnimate;
  creditStackSwapAnimate = false; // one-shot — don't replay on the next unrelated re-render
  const peekHtml = peeks.map((a, i) => {
    const top = (peekCount - 1 - i) * BALANCE_PEEK_STEP;
    const z = peekCount - i;
    const delay = animate ? `; animation-delay: ${i * 25}ms` : '';
    return `
      <button type="button" class="fo-balance-peek fo-credit-peek type-${a.type}" style="top: ${top}px; z-index: ${z}${delay};" data-credit-account-id="${a.id}" aria-label="Bring ${escapeHtml(a.name)} to front">
        <span class="fo-balance-peek-name">${escapeHtml(a.name)}</span>
        <span class="fo-balance-peek-amount">${compactMoney(a.owed, a.currency)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="fo-balance-stack${animate ? ' fo-balance-stack--swap' : ''}" style="padding-top: ${peekCount * BALANCE_PEEK_STEP}px;">
      ${peekHtml}
      <div class="fo-balance-stack-front">${renderMiniBankCard(featured)}</div>
    </div>
  `;
}

function renderFeaturedCard(data) {
  const changeColor = data.actualChange >= 0 ? '#3ddc97' : '#ff6b7a';
  return `
    <div class="fo-card fo-card-featured">
      <div class="fo-featured-top">
        <span class="fo-featured-label">Balance</span>
        <span class="fo-featured-balance">${data.featured ? money(data.featured.balance, data.featured.currency) : money(0)}</span>
        ${data.featured && balanceEquivalent(data.featured.balance, data.featured.currency) ? `<span class="fo-featured-equiv">${escapeHtml(balanceEquivalent(data.featured.balance, data.featured.currency))}</span>` : ''}
      </div>

      <div class="fo-featured-row">
        ${renderBalanceStack(data.featured, data.balanceStackPeeks)}
        <div class="fo-budget-ring-wrap">
          <svg viewBox="0 0 80 80" class="fo-budget-ring">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="#c9a227" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 34}" stroke-dashoffset="${2 * Math.PI * 34 * (1 - data.budgetLoadPct / 100)}"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="fo-budget-ring-label">
            <span>${Math.round(data.budgetLoadPct)}%</span>
          </div>
          <div class="fo-budget-ring-caption">Budget used</div>
        </div>
      </div>

      <div class="fo-featured-flow">
        <div class="fo-flow-total">${money(data.totalFlow, data.featured?.currency)}</div>
        <div class="fo-flow-caption">Money in &amp; out (YTD)</div>
      </div>

      <div class="fo-featured-sparkline">
        ${renderSparkline(data.featuredSparkline, changeColor)}
      </div>

      <div class="fo-featured-change" style="color: ${changeColor};">
        ${data.actualChange >= 0 ? 'Up' : 'Down'} ${compactMoney(Math.abs(data.actualChange), data.featured?.currency)} this year
      </div>
    </div>
  `;
}

// Card A: Credit Card — deliberately built to be a visual twin of the
// Balance card above (renderFeaturedCard): same .fo-card-featured shell,
// same mini bank card (with the masked last-4-digits number) + ring row,
// same flow-figure + sparkline + signed-change stack underneath — just
// with credit-card-flavored numbers standing in for the account ones
// (utilization instead of Budget Load, balance owing instead of Total
// Flow, this cycle's net charges-minus-payments instead of Actual
// Change). No Quick Look hero-card styling or per-card breakdown grid
// here on purpose, so the two cards read as one matched pair.
function renderCreditCard(data) {
  const featured = data.featuredCredit;
  const netSpend = featured
    ? featured.chargesThisCycle - featured.paymentsThisCycle
    : 0;
  const netColor = netSpend > 0 ? '#ff9aa5' : '#3ddc97'; // charging more than you're paying down = red, same "bad direction" red the Balance card uses for a negative Actual Change

  return `
    <div class="fo-card fo-card-featured">
      <div class="fo-featured-top">
        <span class="fo-featured-label">Credit Card</span>
        <span class="fo-featured-balance">${featured ? money(featured.available, featured.currency) : '—'}</span>
      </div>

      <div class="fo-featured-row">
        ${renderCreditStack(featured, data.creditStackPeeks)}
        <div class="fo-budget-ring-wrap">
          <svg viewBox="0 0 80 80" class="fo-budget-ring">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="#c9a227" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 34}" stroke-dashoffset="${2 * Math.PI * 34 * (1 - data.featuredCreditUtilizationPct / 100)}"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="fo-budget-ring-label">
            <span>${Math.round(data.featuredCreditUtilizationPct)}%</span>
          </div>
          <div class="fo-budget-ring-caption">Utilization</div>
        </div>
      </div>

      <div class="fo-featured-flow">
        <div class="fo-flow-total">${featured ? money(featured.owed, featured.currency) : money(0)}</div>
        <div class="fo-flow-caption">Balance Owing</div>
      </div>

      <div class="fo-featured-sparkline">
        ${renderSparkline(data.featuredCreditSparkline, netColor)}
      </div>

      <div class="fo-featured-change" style="color: ${netColor};">
        Net Spend ${netSpend >= 0 ? '+' : '-'}${compactMoney(Math.abs(netSpend), featured?.currency)}
      </div>
    </div>
  `;
}

// Cash Flow — merges what used to be three separate cards (Income,
// Expenses, Savings Rate) into one, since all three are really one
// "how did this month go" figure with three facets. Cuts two card
// borders/headers/padding blocks worth of height for the same three
// numbers.
function renderCashFlowCard(data) {
  const monthLabel = data.isCurrentRealMonth ? 'This month' : MONTH_LABELS[data.selectedMonth];
  const rate = data.monthIncome > 0 ? ((data.monthIncome - data.monthExpense) / data.monthIncome) * 100 : 0;
  const saved = data.monthIncome - data.monthExpense;
  return `
    <div class="fo-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Cash Flow</span>
        <span class="fo-card-subtitle">${monthLabel}</span>
      </div>
      <div class="fo-cashflow-stats">
        <div class="fo-cashflow-stat">
          <span class="fo-cashflow-stat-value positive">${money(data.monthIncome)}</span>
          <span class="fo-cashflow-stat-label">Income</span>
        </div>
        <div class="fo-cashflow-stat">
          <span class="fo-cashflow-stat-value negative">${money(data.monthExpense)}</span>
          <span class="fo-cashflow-stat-label">Expenses</span>
        </div>
        <div class="fo-cashflow-stat">
          <span class="fo-cashflow-stat-value ${rate >= 0 ? 'positive' : 'negative'}">${Math.round(rate)}%</span>
          <span class="fo-cashflow-stat-label">Savings Rate</span>
        </div>
      </div>
      <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${Math.max(0, Math.min(100, rate))}%;background:${rate >= 0 ? '#3ddc97' : '#ff6b7a'}"></div></div>
      <div class="fo-simple-figure-caption">${saved >= 0 ? money(saved) + ' saved' : money(Math.abs(saved)) + ' over income'} · ${data.monthIncomeCount + data.monthExpenseCount} transaction${(data.monthIncomeCount + data.monthExpenseCount) === 1 ? '' : 's'}</div>
    </div>
  `;
}

// Loan Totals — fills the void the left column used to leave below
// Income/Expense (that column was shorter than the Inflow/Budget and
// Structure/Costs columns beside it). Same P&I vs Interest-Only split as
// the Dashboard Quick Look's "Loan Totals" card, just laid out as a plain
// .fo-card to match Income/Expense above it rather than that card's
// dark hero-card treatment.
function renderLoanTotalsCard(data) {
  const { piLoans, ioLoans, totalPiLoanBalance, totalPiLoanRepayment, totalIoLoanBalance, totalIoLoanRepayment } = data;
  const totalLoans = piLoans.length + ioLoans.length;
  return `
    <div class="fo-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Loan Totals</span>
        <span class="fo-card-subtitle">${totalLoans} loan${totalLoans === 1 ? '' : 's'}</span>
      </div>
      ${totalLoans === 0
        ? `<div class="fo-empty-note">No loans set up yet — add some on the Loans page.</div>`
        : `
        <div class="fo-loan-split">
          <div class="fo-loan-split-block">
            <div class="fo-loan-split-label">Principal &amp; Interest</div>
            <div class="fo-simple-figure">${piLoans.length > 0 ? money(totalPiLoanBalance) : '—'}</div>
            <div class="fo-simple-figure-caption">${piLoans.length} loan${piLoans.length === 1 ? '' : 's'}${piLoans.length > 0 ? ` · ${money(totalPiLoanRepayment)}/mo` : ''}</div>
          </div>
          <div class="fo-loan-split-divider" aria-hidden="true"></div>
          <div class="fo-loan-split-block">
            <div class="fo-loan-split-label">Interest-Only</div>
            <div class="fo-simple-figure">${ioLoans.length > 0 ? money(totalIoLoanBalance) : '—'}</div>
            <div class="fo-simple-figure-caption">${ioLoans.length} loan${ioLoans.length === 1 ? '' : 's'}${ioLoans.length > 0 ? ` · ${money(totalIoLoanRepayment)}/mo` : ''}</div>
          </div>
        </div>
      `}
    </div>
  `;
}

// Insurance Totals — sits beside Loan Totals in the left column so a
// glance answers "what's about to renew" alongside "what's still owed".
// Uses the same annualised-premium normalisation as js/insurance.js so a
// monthly-paid policy isn't compared 1:1 against an annually-paid one.
function renderInsuranceTotalsCard(data) {
  const { insuranceList, totalAnnualPremium, policiesRenewingSoonCount } = data;
  const count = (insuranceList || []).length;
  return `
    <div class="fo-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Insurance Totals</span>
        <span class="fo-card-subtitle">${count} polic${count === 1 ? 'y' : 'ies'}</span>
      </div>
      ${count === 0
        ? `<div class="fo-empty-note">No policies set up yet — add some on the Insurance page.</div>`
        : `
        <div class="fo-loan-split">
          <div class="fo-loan-split-block">
            <div class="fo-loan-split-label">Total Annual Premium</div>
            <div class="fo-simple-figure">${money(totalAnnualPremium)}</div>
            <div class="fo-simple-figure-caption">${count} polic${count === 1 ? 'y' : 'ies'}</div>
          </div>
          <div class="fo-loan-split-divider" aria-hidden="true"></div>
          <div class="fo-loan-split-block">
            <div class="fo-loan-split-label">Renewing ≤30 Days</div>
            <div class="fo-simple-figure ${policiesRenewingSoonCount > 0 ? 'negative' : ''}">${policiesRenewingSoonCount}</div>
            <div class="fo-simple-figure-caption">Time to shop around</div>
          </div>
        </div>
      `}
    </div>
  `;
}

// Council Rates + Land Tax, current FY — see the computation above for why
// these are FY totals rather than an annualised "premium" figure the way
// Insurance is. Mirrors renderInsuranceTotalsCard's split-figure layout.
function renderRatesAndTaxCard(data) {
  const {
    totalCouncilRatesFY, totalLandTaxFY, unpaidRatesAndTax, unpaidRatesAndTaxTotal,
    ratesAndTaxFY, canGoEarlierRatesTaxFY, canGoLaterRatesTaxFY
  } = data;
  const hasAny = totalCouncilRatesFY > 0 || totalLandTaxFY > 0 || unpaidRatesAndTax.length > 0;
  return `
    <div class="fo-card" data-feature="property">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Property Rates & Taxes</span>
        <div class="fo-mini-period-nav">
          <button class="fo-mini-period-btn" id="foRatesTaxPrevFY" ${canGoEarlierRatesTaxFY ? '' : 'disabled'} aria-label="Previous financial year">‹</button>
          <span class="fo-mini-period-label">FY ${ratesAndTaxFY}</span>
          <button class="fo-mini-period-btn" id="foRatesTaxNextFY" ${canGoLaterRatesTaxFY ? '' : 'disabled'} aria-label="Next financial year">›</button>
        </div>
      </div>
      ${!hasAny
        ? `<div class="fo-empty-note">No rates or land tax recorded for FY ${ratesAndTaxFY}${canGoEarlierRatesTaxFY ? ' — use ‹ to check earlier years' : ''}.</div>`
        : `
        <div class="fo-loan-split">
          <div class="fo-loan-split-block">
            <div class="fo-loan-split-label">Council Rates</div>
            <div class="fo-simple-figure">${money(totalCouncilRatesFY)}</div>
            <div class="fo-simple-figure-caption">FY ${ratesAndTaxFY}</div>
          </div>
          <div class="fo-loan-split-divider" aria-hidden="true"></div>
          <div class="fo-loan-split-block">
            <div class="fo-loan-split-label">Land Tax</div>
            <div class="fo-simple-figure">${money(totalLandTaxFY)}</div>
            <div class="fo-simple-figure-caption">FY ${ratesAndTaxFY}</div>
          </div>
        </div>
        ${unpaidRatesAndTax.length > 0 ? `
          <div class="fo-empty-note negative">⚠️ ${unpaidRatesAndTax.length} unpaid (${money(unpaidRatesAndTaxTotal)}) — see the Expenses page</div>
        ` : ''}
      `}
    </div>
  `;
}

function renderGoalsCard(data) {
  return `
    <div class="fo-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Goals</span>
        <span class="fo-goals-summary">${money(data.goalsTotalCurrent)} / ${money(data.goalsTotalTarget)}</span>
        <span class="fo-goals-pct">${Math.round(data.goalsOverallPct)}%</span>
      </div>
      <div class="fo-progress-track"><div class="fo-progress-fill" style="width:${Math.min(100, data.goalsOverallPct)}%"></div></div>

      <div class="fo-goals-list">
        ${data.goals.length === 0
          ? `<div class="fo-empty-note">No goals set yet — add some on the Wealth Overview page.</div>`
          : data.goals.slice(0, 4).map(g => `
            <div class="fo-goal-row">
              <span class="fo-goal-icon">${guessGoalIcon(g.name)}</span>
              <div class="fo-goal-mid">
                <div class="fo-goal-name">${escapeHtml(g.name)}</div>
                <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${g.percent}%"></div></div>
                <div class="fo-goal-amounts">${money(g.current)} / ${money(g.target)}</div>
              </div>
              <span class="fo-goal-pct">${Math.round(g.percent)}%</span>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;
}

function renderInflowCard(data) {
  const totalsByTab = {
    inflow: data.monthlySeries.reduce((s, m) => s + m.inflow, 0),
    costs: data.monthlySeries.reduce((s, m) => s + m.costs, 0),
    goals: data.monthlySeries.reduce((s, m) => s + m.goals, 0)
  };
  return `
    <div class="fo-card fo-card-wide">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Inflow</span>
        <div class="fo-tabgroup" id="foInflowTabs">
          <button class="fo-tab ${selectedInflowTab === 'costs' ? 'active' : ''}" data-tab="costs">Costs</button>
          <button class="fo-tab ${selectedInflowTab === 'goals' ? 'active' : ''}" data-tab="goals">Goals</button>
          <button class="fo-tab ${selectedInflowTab === 'inflow' ? 'active' : ''}" data-tab="inflow">Inflow</button>
        </div>
        <span class="fo-card-total" id="foInflowTotal">${money(totalsByTab[selectedInflowTab])}</span>
      </div>
      <div class="fo-chart-wrap fo-chart-tall">
        <canvas id="foInflowChart"></canvas>
      </div>
    </div>
  `;
}

// Four-tile "where do I stand" strip under the headline. Tiles hide
// themselves when their data doesn't exist yet (e.g. no history for
// runway) rather than showing a misleading zero.
function renderGlanceStrip(data) {
  const tiles = [];
  if (data.netWorth !== null && data.netWorth !== undefined) {
    tiles.push({ icon: '🏦', label: 'Net worth', value: money(data.netWorth), tone: data.netWorth < 0 ? 'negative' : '', caption: hasFeature('property') ? 'Cash + property equity + super, today' : 'Cash + super − loans, today' });
  }
  tiles.push({
    icon: '💳', label: 'Total debt', value: money(data.totalDebt), tone: '',
    caption: data.totalDebt > 0 ? 'Loans + credit cards' : 'No debt recorded'
  });
  if (data.runwayMonths !== null) {
    const m = data.runwayMonths;
    tiles.push({
      icon: '🛟', label: 'Cash runway', value: `${m.toFixed(1)} mo`,
      tone: m < 1 ? 'negative' : (m < 3 ? 'caution' : 'positive'),
      caption: `${money(Math.max(0, data.liquidCash))} cash at ${money(data.avgMonthlySpend)}/mo avg spend`
    });
  }
  tiles.push({
    icon: '🗓️', label: 'Bills due (7 days)',
    value: data.billsDueSoonCount > 0 ? money(data.billsDueSoonTotal) : '—',
    tone: '',
    caption: data.billsDueSoonCount > 0 ? `${data.billsDueSoonCount} bill${data.billsDueSoonCount === 1 ? '' : 's'} coming up` : 'Nothing due this week'
  });
  return `
    <div class="fo-glance">
      ${tiles.map(t => `
        <div class="fo-glance-tile">
          <span class="fo-glance-label">${t.icon} ${t.label}</span>
          <span class="fo-glance-value ${t.tone}">${t.value}</span>
          <span class="fo-glance-caption">${escapeHtml(t.caption)}</span>
        </div>`).join('')}
    </div>
  `;
}

function renderBudgetCard(data) {
  const rows = [
    { label: 'Savings', value: data.savingsSpend, color: '#c9a227' },
    { label: 'Loans', value: data.loansSpend, color: '#5b8def' },
    { label: 'Kids & Education', value: data.kidsEduSpend, color: '#a06bff' },
    { label: 'All Other', value: data.allOtherSpend, color: '#3a4a63' }
  ];
  return `
    <div class="fo-card fo-card-wide">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Budget</span>
      </div>
      <div class="fo-budget-layout">
        <div class="fo-chart-wrap fo-donut-wrap">
          <canvas id="foBudgetDonut"></canvas>
          <div class="fo-donut-center">
            <span class="fo-donut-center-value">${compactMoney(data.budgetDonutTotal)}</span>
            <span class="fo-donut-center-label">${data.totalMonthlyBudget > 0 ? 'Budgeted' : 'Spent'}</span>
          </div>
        </div>
        <div class="fo-budget-mid">
          <div class="fo-flow-bar-row">
            <span>↙️ Inflow</span>
            <div class="fo-progress-track"><div class="fo-progress-fill" style="width:${data.inflowPct}%"></div></div>
            <span>${Math.round(data.inflowPct)}%</span>
          </div>
          <div class="fo-flow-bar-row">
            <span>↗️ Outflow</span>
            <div class="fo-progress-track"><div class="fo-progress-fill outflow" style="width:${100 - data.inflowPct}%"></div></div>
            <span>${Math.round(100 - data.inflowPct)}%</span>
          </div>
          ${rows.map(r => `
            <div class="fo-legend-row">
              <span class="fo-legend-dot" style="background:${r.color};"></span>
              <span class="fo-legend-label">${r.label}</span>
              <span class="fo-legend-value">${money(r.value)}</span>
            </div>
          `).join('')}
        </div>
        <div class="fo-balance-box">
          <span class="fo-balance-box-value">${money(data.totalAccountBalance)}</span>
          <span class="fo-balance-box-label">Balance</span>
        </div>
      </div>
      <div class="fo-budget-ranked">
        ${renderBudgetRankList('Top 15 spending', data.budgetTop15, '#c9a227')}
        <div class="fo-budget-rank-col">
          ${renderBudgetRankList('Lowest 5 spending', data.budgetLowest5, '#3ddc97', data.budgetNoSpend)}
          ${renderBudgetSpendShare(data)}
        </div>
      </div>
    </div>
  `;
}

// Share-of-spend donut (top 8 categories + Other) with a compact legend —
// sits under the "No spend" list, where the column has spare height.
const BUDGET_SHARE_PALETTE = ['#c9a227', '#5b8def', '#a06bff', '#3ddc97', '#ffb454', '#ff6b7a', '#3a4a63', '#e879f9', '#94a3b8'];
function renderBudgetSpendShare(data) {
  if (!data.budgetSpendShare.length) return '';
  return `
    <div class="fo-budget-rank-title fo-budget-rank-sub">Where it went</div>
    <div class="fo-budget-share">
      <div class="fo-chart-wrap fo-donut-wrap">
        <canvas id="foBudgetSpendDonut"></canvas>
        <div class="fo-donut-center">
          <span class="fo-donut-center-value">${compactMoney(data.budgetSpendTotal)}</span>
          <span class="fo-donut-center-label">Total</span>
        </div>
      </div>
      <div class="fo-budget-share-legend">
        ${data.budgetSpendShare.map((c, i) => `
          <div class="fo-budget-share-row">
            <span class="fo-legend-dot" style="background:${BUDGET_SHARE_PALETTE[i % BUDGET_SHARE_PALETTE.length]};"></span>
            <span class="fo-legend-label">${c.icon} ${escapeHtml(c.name)}</span>
            <span class="fo-legend-pct">${Math.round(c.percent)}%</span>
          </div>`).join('')}
      </div>
    </div>`;
}

// One ranked list inside the Budget card. Each row is "icon name — spent
// (of budget)"; when the category has a budget the bar shows spend against
// it and turns red once over, otherwise the bar is share-of-list-max.
function renderBudgetRankList(title, items, color, noSpendItems = []) {
  const max = items.reduce((m, c) => Math.max(m, c.amount), 0);
  const rows = (list, numbered) => list.map((c, i) => {
    const over = c.usedPct !== null && c.usedPct > 100;
    const width = c.usedPct !== null ? Math.min(100, c.usedPct) : (max > 0 ? (c.amount / max) * 100 : 0);
    return `
      <div class="fo-legend-row">
        <span class="fo-legend-label">${numbered ? (i + 1) + '. ' : ''}${c.icon} ${escapeHtml(c.name)}</span>
        <span class="fo-legend-pct">${c.usedPct !== null ? Math.round(c.usedPct) + '%' : ''}</span>
        <span class="fo-legend-value${over ? ' negative' : ''}">${money(c.amount)}${c.budget > 0 ? ` <small class="fo-budget-of">/ ${money(c.budget)}</small>` : ''}</span>
      </div>
      <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${width}%;background:${over ? 'var(--danger)' : color}"></div></div>`;
  }).join('');
  return `
    <div class="fo-budget-rank-col">
      <div class="fo-budget-rank-title">${title}</div>
      ${items.length === 0
        ? '<div class="fo-empty-note">Nothing to show for this month yet.</div>'
        : rows(items, true)}
      ${noSpendItems.length > 0 ? `
        <div class="fo-budget-rank-title fo-budget-rank-sub">No spend this month</div>
        ${rows(noSpendItems, false)}` : ''}
    </div>`;
}

// Structure + Costs merged into one card with a tab toggle, same
// .fo-tabgroup/.fo-tab pattern as the Inflow card's Costs/Goals/Inflow
// switcher above. Both cards were "one chart, one legend" size — small
// enough that two full separate .fo-card shells for them was mostly
// border/header overhead, not content.
function renderStructureCostsCard(data) {
  return `
    <div class="fo-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">${selectedStructureTab === 'structure' ? 'Structure' : 'Costs'}</span>
        <div class="fo-tabgroup" id="foStructureCostsTabs">
          <button class="fo-tab ${selectedStructureTab === 'structure' ? 'active' : ''}" data-tab="structure">Structure</button>
          <button class="fo-tab ${selectedStructureTab === 'costs' ? 'active' : ''}" data-tab="costs">Costs</button>
        </div>
      </div>
      ${selectedStructureTab === 'structure' ? `
        <div class="fo-chart-wrap fo-radar-wrap">
          <canvas id="foStructureRadar"></canvas>
        </div>
      ` : `
        <div class="fo-budget-layout fo-costs-layout">
          <div class="fo-chart-wrap fo-donut-wrap">
            <canvas id="foCostsDonut"></canvas>
            <div class="fo-donut-center">
              <span class="fo-donut-center-value">${compactMoney(data.costsTotal)}</span>
            </div>
          </div>
          <div class="fo-costs-legend">
            ${data.costsBreakdown.length === 0
              ? `<div class="fo-empty-note">No expenses recorded this month yet.</div>`
              : data.costsBreakdown.map(c => `
                <div class="fo-legend-row">
                  <span class="fo-legend-label">${c.icon} ${escapeHtml(c.name)}</span>
                  <span class="fo-legend-pct">${data.costsTotal > 0 ? Math.round((c.amount / data.costsTotal) * 100) : 0}%</span>
                  <span class="fo-legend-value">${money(c.amount)}</span>
                </div>
              `).join('')
            }
          </div>
        </div>
      `}
    </div>
  `;
}

// A quick "what's happened lately" feed — the last few real transactions
// across every account, most recent first. Deliberately just the last
// handful with a link to the full ledger, not a mini version of the
// Transactions page.
function renderRecentActivityCard(data) {
  return `
    <div class="fo-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Recent Activity</span>
        <a href="#transactions" class="fo-card-subtitle fo-card-link">See all</a>
      </div>
      <div class="fo-recent-activity-list">
        ${data.recentActivity.length === 0
          ? `<div class="fo-empty-note">No transactions recorded yet.</div>`
          : data.recentActivity.map(t => `
            <div class="fo-recent-activity-row">
              <div class="fo-recent-activity-main">
                <span class="fo-recent-activity-desc">${escapeHtml(t.label)}</span>
                <span class="fo-recent-activity-date">${formatListDate(t.date)} · ${escapeHtml(t.accountName)}</span>
              </div>
              <span class="fo-recent-activity-amount ${t.type === 'income' ? 'positive' : 'negative'}">
                ${t.type === 'income' ? '+' : '-'}${t.currency ? formatMoney(Math.abs(t.nativeAmount), t.currency, { digits: 0 }) : money(Math.abs(t.amount))}${t.currency ? `<small style="display:block;font-size:0.72rem;font-weight:400;opacity:0.65;">≈ ${money(Math.abs(t.amount))}</small>` : ''}
              </span>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;
}

// Compare Costs + Annual Plans merged into one card with a tab toggle,
// same #foBottomTabs pattern as Structure/Costs above. Compare Costs
// keeps its own header row (figure + Goals/Inflow toggles) below the
// shared title+tab row, rather than crowding everything into one line.
function renderCompareAnnualCard(data) {
  const m = data.monthlySeries[data.selectedMonth];
  const activeYear = selectedAnnualYear || data.annualData[data.annualData.length - 1]?.year;
  const activeEntry = data.annualData.find(y => y.year === activeYear) || data.annualData[data.annualData.length - 1];
  return `
    <div class="fo-card fo-card-wide">
      <div class="fo-card-header-row">
        <span class="fo-card-title">${selectedBottomTab === 'compare' ? 'Compare Costs' : 'Annual Plans'}</span>
        <div class="fo-tabgroup" id="foBottomTabs">
          <button class="fo-tab ${selectedBottomTab === 'compare' ? 'active' : ''}" data-tab="compare">Compare</button>
          <button class="fo-tab ${selectedBottomTab === 'annual' ? 'active' : ''}" data-tab="annual">Annual</button>
        </div>
      </div>
      ${selectedBottomTab === 'compare' ? `
        <div class="fo-card-header-row fo-compare-header">
          <span class="fo-compare-figure">${money(m.costs)}</span>
          <label class="fo-toggle-label">
            <span>Goals</span>
            <input type="checkbox" id="foToggleGoals" ${compareShowGoals ? 'checked' : ''} />
          </label>
          <span class="fo-compare-figure fo-compare-figure-secondary">${money(m.goals)}</span>
          <label class="fo-toggle-label">
            <span>Inflow</span>
            <input type="checkbox" id="foToggleInflow" ${compareShowInflow ? 'checked' : ''} />
          </label>
          <span class="fo-compare-figure fo-compare-figure-secondary">${money(m.inflow)}</span>
        </div>
        <div class="fo-chart-wrap fo-chart-tall">
          <canvas id="foCompareChart"></canvas>
        </div>
        <div class="fo-month-chips" id="foMonthChips">
          ${data.monthlySeries.map(month => `
            <button class="fo-chip ${month.monthIndex === data.selectedMonth ? 'active' : ''}" data-month="${month.monthIndex}" ${!month.hasData ? 'disabled' : ''}>${month.label}</button>
          `).join('')}
        </div>
      ` : `
        <div class="fo-chart-wrap fo-annual-chart-wrap">
          <div class="fo-annual-figure">${activeEntry ? compactMoney(activeEntry.netSavings) : '—'}</div>
          <canvas id="foAnnualChart"></canvas>
        </div>
        <div class="fo-month-chips" id="foYearChips">
          ${data.annualData.map(y => `
            <button class="fo-chip ${y.year === activeYear ? 'active' : ''}" data-year="${y.year}">${y.year}</button>
          `).join('')}
        </div>
      `}
    </div>
  `;
}


function relativeDayLabel(dateStr) {
  if (!dateStr) return '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays > 0) return `in ${diffDays}d`;
  return `${Math.abs(diffDays)}d overdue`;
}

function formatListDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function initialsAvatar(label) {
  const initials = (label || '?').trim().slice(0, 2).toUpperCase();
  return `<span class="fo-list-avatar">${escapeHtml(initials)}</span>`;
}

const LIST_TABS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'paid', label: 'Paid' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'loans', label: 'Loans' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'rates', label: 'Rates & Tax' },
  { key: 'vehicles', label: 'Registration' },
  { key: 'accounts', label: 'Accounts' }
];

// Normalizes every store's items into one row shape the list/detail
// markup doesn't need to special-case, keyed as `${type}:${id}` so ids
// from different stores can never collide once selected.
function rowsForListTab(tab, data) {
  const today = new Date().toISOString().slice(0, 10);

  if (tab === 'overdue' || tab === 'upcoming' || tab === 'paid') {
    const bills = (data.billsList || []).filter(b => {
      if (tab === 'paid') return b.paid;
      if (tab === 'overdue') return !b.paid && b.dueDate < today;
      return !b.paid && b.dueDate >= today;
    });
    return bills.map(b => ({
      key: `bill:${b.id}`, type: 'bill', id: b.id, raw: b,
      avatar: initialsAvatar(b.name),
      title: b.name,
      subtitle: b.payeeLabel,
      meta: relativeDayLabel(b.dueDate),
      statusText: b.status.text, statusClass: b.status.class,
      amount: b.amount
    }));
  }

  if (tab === 'recurring') {
    return (data.recurringList || []).map(r => ({
      key: `recurring:${r.id}`, type: 'recurring', id: r.id, raw: r,
      avatar: initialsAvatar(r.name),
      title: r.name,
      subtitle: r.categoryName || r.accountName || '',
      meta: relativeDayLabel(r.nextDate),
      statusText: r.nextDate && r.nextDate < today ? 'Overdue' : 'Scheduled',
      statusClass: r.nextDate && r.nextDate < today ? 'overdue' : 'upcoming',
      amount: r.amount
    }));
  }

  if (tab === 'loans') {
    return (data.loansList || []).map(l => ({
      key: `loan:${l.id}`, type: 'loan', id: l.id, raw: l,
      avatar: initialsAvatar(l.name),
      title: l.name,
      subtitle: l.lenderName || 'Loan',
      meta: `${Math.round(l.payoffPct)}% paid off`,
      statusText: l.currentBalance <= 0 ? 'Paid Off' : 'Active',
      statusClass: l.currentBalance <= 0 ? 'paid' : 'upcoming',
      amount: l.currentBalance
    }));
  }

  if (tab === 'insurance') {
    return (data.insuranceList || []).map(p => ({
      key: `insurance:${p.id}`, type: 'insurance', id: p.id, raw: p,
      avatar: initialsAvatar(p.nickname || p.typeLabel),
      title: p.nickname || p.typeLabel,
      subtitle: p.provider || p.typeLabel,
      meta: relativeDayLabel(p.renewalDate),
      statusText: p.status.text, statusClass: p.status.class,
      amount: p.premiumAmount
    }));
  }

  if (tab === 'rates') {
    return (data.ratesAndTaxList || []).map(e => ({
      key: `rates:${e.id}`, type: 'rates', id: e.id, raw: e,
      avatar: initialsAvatar(e.category),
      title: e.description || e.category,
      subtitle: e.propertyName || 'Not linked to a property',
      meta: e.status === 'Unpaid' ? relativeDayLabel(e.date) : formatListDate(e.date),
      statusText: e.status, statusClass: e.status === 'Unpaid' ? 'overdue' : 'paid',
      amount: e.amount
    }));
  }

  if (tab === 'vehicles') {
    return (data.vehiclesList || []).map(v => ({
      key: `vehicle:${v.id}`, type: 'vehicle', id: v.id, raw: v,
      avatar: initialsAvatar(v.displayName),
      title: v.displayName,
      subtitle: v.rego || 'No rego number set',
      meta: relativeDayLabel(v.regoExpiryDate),
      statusText: v.regoStatus.text, statusClass: v.regoStatus.class,
      amount: v.regoCost || 0
    }));
  }

  // accounts
  return (data.accountsListFull || []).map(a => ({
    key: `account:${a.id}`, type: 'account', id: a.id, raw: a,
    avatar: initialsAvatar(a.name),
    title: a.name,
    subtitle: a.instName || a.type,
    meta: a.type,
    statusText: a.balance < 0 ? 'Overdrawn' : 'In credit',
    statusClass: a.balance < 0 ? 'overdue' : 'paid',
    amount: a.balance
  }));
}

function renderListRow(row, isActive) {
  return `
    <div class="fo-list-row ${isActive ? 'active' : ''}" data-list-key="${row.key}">
      ${row.avatar}
      <div class="fo-list-row-main">
        <span class="fo-list-row-title">${escapeHtml(row.title)}</span>
        <span class="fo-list-row-subtitle">${escapeHtml(row.subtitle)}</span>
      </div>
      <div class="fo-list-row-meta">${escapeHtml(row.meta)}</div>
      <div class="fo-list-row-status status-${row.statusClass}">${escapeHtml(row.statusText)}</div>
      <div class="fo-list-row-amount">${money(row.amount, row.raw?.currency)}</div>
    </div>
  `;
}

function statBox(label, value) {
  return `
    <div class="fo-list-statbox">
      <span class="fo-list-statbox-arrow">↗</span>
      <span class="fo-list-statbox-value">${escapeHtml(String(value))}</span>
      <span class="fo-list-statbox-label">${escapeHtml(label)}</span>
    </div>
  `;
}

function bottomCol(label, value) {
  return `
    <div class="fo-list-bottomcol">
      <span class="fo-list-bottomcol-label">${escapeHtml(label)}</span>
      <span class="fo-list-bottomcol-value">${escapeHtml(String(value))}</span>
    </div>
  `;
}

// Builds the dark detail panel's content for whichever row is selected.
// Each type gets fields that actually make sense for it — a bill's three
// stat boxes aren't the same shape as a loan's or an account's — but the
// panel structure (header + code pill, meta row, 3 stat boxes, bottom
// row, optional action) stays consistent across all six tabs.
function renderListDetail(row, data) {
  if (row.type === 'bill') {
    const b = row.raw;
    return `
      <div class="fo-list-detail-header">
        <div>
          <div class="fo-list-detail-label">Bill details</div>
          <div class="fo-list-detail-title">${escapeHtml(b.name)}</div>
        </div>
        <span class="fo-list-detail-pill status-${b.status.class}">${escapeHtml(b.status.text)}</span>
      </div>
      <div class="fo-list-detail-meta">
        <div><span class="fo-list-detail-meta-label">Linked to</span><span>${escapeHtml(b.payeeLabel)}</span></div>
        <div><span class="fo-list-detail-meta-label">Recurring</span><span>${escapeHtml(b.recurring || 'One-time')}</span></div>
      </div>
      <div class="fo-list-statboxes">
        ${statBox('Amount', money(b.amount, b.currency))}
        ${statBox('Category', b.categoryName)}
        ${statBox('Frequency', b.recurring || 'One-time')}
      </div>
      <div class="fo-list-bottomrow">
        ${bottomCol('Due Date', formatListDate(b.dueDate))}
        ${bottomCol('Status', b.status.text)}
        ${bottomCol('Account', b.payeeLabel)}
        ${!b.paid ? `<button class="fo-bills-mark-paid" id="foMarkBillPaid" data-bill-id="${b.id}">Mark Paid</button>` : ''}
      </div>
    `;
  }

  if (row.type === 'recurring') {
    const r = row.raw;
    return `
      <div class="fo-list-detail-header">
        <div>
          <div class="fo-list-detail-label">Recurring transaction</div>
          <div class="fo-list-detail-title">${escapeHtml(r.name)}</div>
        </div>
        <span class="fo-list-detail-pill status-${row.statusClass}">${escapeHtml(r.frequency || '')}</span>
      </div>
      <div class="fo-list-detail-meta">
        <div><span class="fo-list-detail-meta-label">Category</span><span>${escapeHtml(r.categoryName || '—')}</span></div>
        <div><span class="fo-list-detail-meta-label">Account</span><span>${escapeHtml(r.accountName || '—')}</span></div>
      </div>
      <div class="fo-list-statboxes">
        ${statBox('Amount', money(r.amount, r.currency))}
        ${statBox('Next Due', formatListDate(r.nextDate))}
        ${statBox('Type', r.type === 'income' ? 'Income' : 'Expense')}
      </div>
      <div class="fo-list-bottomrow">
        ${bottomCol('Frequency', r.frequency || '—')}
        ${bottomCol('Started', formatListDate(r.startDate))}
        ${bottomCol('Linked Loan', r.linkedLoanName || '—')}
      </div>
    `;
  }

  if (row.type === 'loan') {
    const l = row.raw;
    return `
      <div class="fo-list-detail-header">
        <div>
          <div class="fo-list-detail-label">Loan details</div>
          <div class="fo-list-detail-title">${escapeHtml(l.name)}</div>
        </div>
        <span class="fo-list-detail-pill status-${row.statusClass}">${escapeHtml(row.statusText)}</span>
      </div>
      <div class="fo-list-detail-meta">
        <div><span class="fo-list-detail-meta-label">Lender</span><span>${escapeHtml(l.lenderName || '—')}</span></div>
        <div><span class="fo-list-detail-meta-label">Property</span><span>${escapeHtml(l.propertyName || '—')}</span></div>
      </div>
      <div class="fo-list-statboxes">
        ${statBox('Balance', money(l.currentBalance, l.currency))}
        ${statBox('Rate', `${l.interestRate}%`)}
        ${statBox('Original', money(l.originalAmount, l.currency))}
      </div>
      <div class="fo-list-bottomrow">
        ${bottomCol('Frequency', l.paymentFrequency || '—')}
        ${bottomCol('Started', formatListDate(l.startDate))}
        ${bottomCol('Paid Off', `${Math.round(l.payoffPct)}%`)}
      </div>
    `;
  }

  if (row.type === 'insurance') {
    const p = row.raw;
    return `
      <div class="fo-list-detail-header">
        <div>
          <div class="fo-list-detail-label">Insurance details</div>
          <div class="fo-list-detail-title">${escapeHtml(p.nickname || p.typeLabel)}</div>
        </div>
        <span class="fo-list-detail-pill status-${row.statusClass}">${escapeHtml(row.statusText)}</span>
      </div>
      <div class="fo-list-detail-meta">
        <div><span class="fo-list-detail-meta-label">Provider</span><span>${escapeHtml(p.provider || '—')}</span></div>
        <div><span class="fo-list-detail-meta-label">Type</span><span>${escapeHtml(p.typeLabel)}</span></div>
      </div>
      <div class="fo-list-statboxes">
        ${statBox('Premium', `${money(p.premiumAmount)}${p.paymentFrequency === 'monthly' ? '/mo' : '/yr'}`)}
        ${statBox('Excess', money(p.excess))}
        ${statBox('Coverage', p.coverageType || '—')}
      </div>
      <div class="fo-list-bottomrow">
        ${bottomCol('Renewal Date', formatListDate(p.renewalDate))}
        ${bottomCol('Policy #', p.policyNumber || '—')}
        ${bottomCol('Property', p.propertyName || '—')}
      </div>
    `;
  }

  if (row.type === 'rates') {
    const e = row.raw;
    return `
      <div class="fo-list-detail-header">
        <div>
          <div class="fo-list-detail-label">${escapeHtml(e.category)} details</div>
          <div class="fo-list-detail-title">${escapeHtml(e.description || e.category)}</div>
        </div>
        <span class="fo-list-detail-pill status-${row.statusClass}">${escapeHtml(row.statusText)}</span>
      </div>
      <div class="fo-list-detail-meta">
        <div><span class="fo-list-detail-meta-label">Property</span><span>${escapeHtml(e.propertyName || 'Not linked')}</span></div>
        <div><span class="fo-list-detail-meta-label">Financial Year</span><span>${escapeHtml(getFinancialYear(e.date) || '—')}</span></div>
      </div>
      <div class="fo-list-statboxes">
        ${statBox('Amount', money(e.amount))}
        ${statBox('Category', e.category)}
        ${statBox('Source', e.source === 'bill' ? 'Bill' : e.source === 'transaction' ? 'Transaction' : 'Direct entry')}
      </div>
      <div class="fo-list-bottomrow">
        ${bottomCol(e.status === 'Unpaid' ? 'Due Date' : 'Date', formatListDate(e.date))}
        ${bottomCol('Status', e.status)}
        ${bottomCol('Property', e.propertyName || 'Not linked')}
        ${e.status === 'Unpaid' && e.billId ? `<button class="fo-bills-mark-paid" id="foMarkBillPaid" data-bill-id="${e.billId}">Mark Paid</button>` : ''}
      </div>
    `;
  }

  if (row.type === 'vehicle') {
    const v = row.raw;
    return `
      <div class="fo-list-detail-header">
        <div>
          <div class="fo-list-detail-label">Vehicle registration</div>
          <div class="fo-list-detail-title">${escapeHtml(v.displayName)}</div>
        </div>
        <span class="fo-list-detail-pill status-${row.statusClass}">${escapeHtml(row.statusText)}</span>
      </div>
      <div class="fo-list-detail-meta">
        <div><span class="fo-list-detail-meta-label">Rego #</span><span>${escapeHtml(v.rego || '—')}</span></div>
        <div><span class="fo-list-detail-meta-label">Vehicle</span><span>${escapeHtml(v.makeModel || '—')}</span></div>
      </div>
      <div class="fo-list-statboxes">
        ${statBox('Rego Cost', money(v.regoCost || 0))}
        ${statBox('Frequency', v.regoFrequency === 'six_monthly' ? 'Six-monthly' : 'Annual')}
        ${statBox('Licence Expiry', v.licenceExpiryDate ? formatListDate(v.licenceExpiryDate) : '—')}
      </div>
      <div class="fo-list-bottomrow">
        ${bottomCol('Rego Expiry', formatListDate(v.regoExpiryDate))}
        ${bottomCol('Status', row.statusText)}
        ${bottomCol('Rego #', v.rego || '—')}
      </div>
    `;
  }

  // account
  const a = row.raw;
  return `
    <div class="fo-list-detail-header">
      <div>
        <div class="fo-list-detail-label">Account details</div>
        <div class="fo-list-detail-title">${escapeHtml(a.name)}</div>
      </div>
      <span class="fo-list-detail-pill status-${row.statusClass}">${escapeHtml(row.statusText)}</span>
    </div>
    <div class="fo-list-detail-meta">
      <div><span class="fo-list-detail-meta-label">Institution</span><span>${escapeHtml(a.instName || '—')}</span></div>
      <div><span class="fo-list-detail-meta-label">Type</span><span>${escapeHtml(a.type || '—')}</span></div>
    </div>
    <div class="fo-list-statboxes">
      ${statBox('Balance', money(a.balance, a.currency))}
      ${statBox('Type', a.type || '—')}
      ${statBox('Number', `•••• ${a.last4 || pseudoLast4(a.id)}`)}
    </div>
    <div class="fo-list-bottomrow">
      ${bottomCol('Institution', a.instName || '—')}
      ${bottomCol('Account Type', a.type || '—')}
      ${bottomCol('Number', `•••• ${a.last4 || pseudoLast4(a.id)}`)}
    </div>
  `;
}

function renderMasterListCard(data) {
  const rows = rowsForListTab(selectedListTab, data);
  const visibleTabs = LIST_TABS.filter(t => t.key !== 'rates' || hasFeature('property'));
  const tabCounts = Object.fromEntries(visibleTabs.map(t => [t.key, rowsForListTab(t.key, data).length]));

  let selected = rows.find(r => r.key === selectedListKey);
  if (!selected) selected = rows[0];

  return `
    <div class="fo-card fo-card-wide fo-list-card">
      <div class="fo-list-tabs" id="foListTabs">
        ${visibleTabs.map(t => `
          <button class="fo-list-tab ${selectedListTab === t.key ? 'active' : ''}" data-list-tab="${t.key}">
            ${t.label}${tabCounts[t.key] ? `<span class="fo-list-tab-count">${tabCounts[t.key]}</span>` : ''}
          </button>
        `).join('')}
      </div>
      <div class="fo-list-layout">
        <div class="fo-list-rows">
          ${rows.length === 0
            ? `<div class="fo-empty-note">Nothing here.</div>`
            : rows.map(r => renderListRow(r, selected && r.key === selected.key)).join('')
          }
        </div>
        <div class="fo-list-detail-panel">
          ${!selected ? `<div class="fo-empty-note">Select a row to see details.</div>` : renderListDetail(selected, data)}
        </div>
      </div>
    </div>
  `;
}

// Time-of-day greeting, used by renderPulseHeader below.
function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Turns this month's numbers into one plain-language verdict — the thing
// a person actually wants to know at a glance ("am I okay?") instead of
// making them read five separate cards and do the math themselves.
// Portfolio-wide on purpose (unlike the featured-account figures in Card
// 1 above): this is meant to answer "how am I doing overall", not "how's
// this one account doing".
function buildFinancialPulse(data) {
  const surplus = data.monthIncome - data.monthExpense;
  const overBudget = data.totalMonthlyBudget > 0 && data.monthExpense > data.totalMonthlyBudget;

  let tone = 'good';
  let headline;
  if (data.overdueBillsCount > 0) {
    tone = 'caution';
    headline = data.overdueBillsCount === 1
      ? "You've got a bill overdue."
      : `You've got ${data.overdueBillsCount} bills overdue.`;
  } else if (data.overBudgetCount > 0) {
    tone = 'watch';
    headline = data.overBudgetCount === 1
      ? "One budget's gone over this month."
      : `${data.overBudgetCount} budgets have gone over this month.`;
  } else if (surplus < 0) {
    tone = 'caution';
    headline = "You've spent more than you've brought in this month.";
  } else if (overBudget) {
    tone = 'watch';
    headline = "You're a little over budget this month.";
  } else {
    tone = 'good';
    headline = "You're in good shape this month.";
  }

  const detail = surplus >= 0
    ? `${money(data.monthExpense)} spent of ${money(data.monthIncome)} in — ${money(surplus)} left over. ${money(data.totalAccountBalance)} across your accounts.`
    : `${money(data.monthExpense)} spent of ${money(data.monthIncome)} in — ${money(Math.abs(surplus))} over. ${money(data.totalAccountBalance)} across your accounts.`;

  return { tone, headline, detail };
}

// The greeting + plain-language verdict that sits above everything else
// on the page — the one place that actually talks to the person, rather
// than just presenting numbers for them to interpret themselves.
// greetingName comes from the (optional) family-sync login — solo/local
// use has no name to greet, so it falls back to a plain "Good afternoon."
function renderPulseHeader(data, greetingName) {
  const pulse = buildFinancialPulse(data);
  return `
    <div class="fo-pulse fo-pulse--${pulse.tone}">
      <div class="fo-pulse-greeting">${getTimeOfDayGreeting()}${greetingName ? `, ${escapeHtml(greetingName)}` : ''}.</div>
      <div class="fo-pulse-headline">${escapeHtml(pulse.headline)}</div>
      <div class="fo-pulse-detail">${pulse.detail}</div>
    </div>
  `;
}

function renderPeriodNav(data) {
  return `
    <div class="fo-period-nav">
      <button class="fo-period-btn" id="foPrevMonth" aria-label="Previous month">‹</button>
      <span class="fo-period-label">${MONTH_NAMES_FULL[data.selectedMonth]} ${data.selectedYear}</span>
      <button class="fo-period-btn" id="foNextMonth" aria-label="Next month" ${data.isCurrentRealMonth || data.isFutureOfReal ? 'disabled' : ''}>›</button>
      ${!data.isCurrentRealMonth ? `<button class="fo-period-today" id="foTodayMonth">Today</button>` : ''}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function initFinanceOverviewUI() {
  const mainContent = document.getElementById('mainContent');
  // Bug fix: every in-page interaction here (tab switch, month/year nav,
  // chip clicks, list row selection, mark-paid) calls this same function
  // to re-render with new state — not just the initial page load. This
  // used to unconditionally swap #mainContent for a tiny loading-state
  // placeholder first (before the async IndexedDB reads below), which
  // actually painted — collapsing the page's scrollable height for a
  // frame and snapping the browser's scroll position to (near) zero on
  // that collapse itself, on iOS in particular. A later window.scrollTo
  // restore could still land wrong if it fired before charts/canvases had
  // finished laying out, so the real content would render back in below
  // the fold with no way back to where the user actually was — any click
  // anywhere on this page looked like a full reload to the top.
  //
  // The actual fix is to not collapse the page at all for these re-renders:
  // the loading placeholder is only useful for the very first navigation
  // into this page (nothing to show yet), so it's now shown only when
  // #mainContent doesn't already contain a rendered .fo-dashboard. Every
  // later re-render keeps the current dashboard fully in place — same
  // height, nothing to clamp — while the (already-cached, effectively
  // instant) IndexedDB reads resolve, then swaps straight to the new
  // markup in one synchronous assignment. The scrollY capture/restore
  // below is kept as a harmless safety net for any layout shift that does
  // still occur (e.g. a list growing/shrinking), not as the primary fix.
  const isFirstRender = !mainContent.querySelector('.fo-dashboard');
  const scrollYBeforeRender = window.scrollY;
  mainContent.classList.add('page-transition');
  if (isFirstRender) {
    mainContent.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading finance overview...</p></div>';
  }

  const [accounts, transactions, categories, budgets, loans, bills, properties, recurringTransactions, insurancePolicies, expenses, vehicles, connectionInfo] = await Promise.all([
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.transactions).catch(() => []),
    getAllItems(STORE_NAMES.categories).catch(() => []),
    getAllItems(STORE_NAMES.budgets).catch(() => []),
    getAllItems(STORE_NAMES.loans).catch(() => []),
    getAllItems(STORE_NAMES.bills).catch(() => []),
    getGatedItems(STORE_NAMES.properties).catch(() => []),
    getAllItems(STORE_NAMES.recurringTransactions).catch(() => []),
    getAllItems(STORE_NAMES.insurancePolicies).catch(() => []),
    // Direct property expense entries (Expenses page) — used for the
    // Property Rates & Taxes card, bucketed via propertyExpenseCategories.js.
    getGatedItems(STORE_NAMES.expenses).catch(() => []),
    // Registration tab on the master-detail list card — see js/vehicles.js.
    getAllItems(STORE_NAMES.vehicles).catch(() => []),
    // Only present if the person's set up family sync and is logged in;
    // solo/local use has no name to greet with, and that's fine (see
    // renderPulseHeader's fallback).
    getConnectionInfo().catch(() => null)
  ]);
  // The person's own optional name wins; otherwise fall back to the Family Sync login name.
  const greetingName = getDisplayName() || connectionInfo?.username || null;

  if (selectedYear === null || selectedMonth === null) {
    const now = new Date();
    selectedYear = now.getFullYear();
    selectedMonth = now.getMonth();
  }

  const data = computeFinanceOverviewData({ accounts, transactions, categories, budgets, loans, bills, properties, recurringTransactions, insurancePolicies, expenses, vehicles, selectedYear, selectedMonth });

  // Net worth uses the Wealth Overview page's own formula (cash + property
  // equity + super) so the two pages can never disagree. It's "as of today"
  // by nature (property values and super aren't tracked by month).
  try {
    const [superFunds, superBalanceHistory] = await Promise.all([
      getAllItems(STORE_NAMES.superFunds).catch(() => []),
      getAllItems(STORE_NAMES.superBalanceHistory).catch(() => [])
    ]);
    data.netWorth = computeWealthData({ accounts, transactions, loans, properties, bills, categories, superFunds, superBalanceHistory }).netWorth;
  } catch (err) {
    console.warn('Net worth unavailable on Finance Overview:', err);
    data.netWorth = null;
  }

  if (selectedAnnualYear === null) selectedAnnualYear = data.annualData[data.annualData.length - 1]?.year;

  mainContent.innerHTML = `
    <div class="fo-dashboard">
      ${renderPulseHeader(data, greetingName)}
      ${renderGlanceStrip(data)}
      ${renderPeriodNav(data)}
      <div class="fo-grid fo-grid-top">
        ${renderFeaturedCard(data)}
        ${renderCreditCard(data)}
        ${renderMasterListCard(data)}
      </div>
      <div class="fo-grid">
        <div class="fo-col fo-col-left">
          ${renderGoalsCard(data)}
          ${renderCashFlowCard(data)}
          ${renderLoanTotalsCard(data)}
          ${renderInsuranceTotalsCard(data)}
          ${renderRatesAndTaxCard(data)}
        </div>
        <div class="fo-col fo-col-mid">
          ${renderInflowCard(data)}
          ${renderBudgetCard(data)}
        </div>
        <div class="fo-col fo-col-right">
          ${renderStructureCostsCard(data)}
          ${renderRecentActivityCard(data)}
        </div>
      </div>
      ${renderCompareAnnualCard(data)}
    </div>
  `;

  attachFinanceOverviewBehavior(data);

  // Restore the scroll position captured above, after the browser has had
  // a chance to lay out the real content (charts included) — a single
  // requestAnimationFrame can fire before canvas sizing settles, so wait
  // two frames.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollYBeforeRender, behavior: 'auto' });
    });
  });
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function buildInflowChart(data) {
  destroyChart('foInflowChart');
  const canvas = document.getElementById('foInflowChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const values = data.monthlySeries.map(m => m[selectedInflowTab]);
  // Colors are scriptable (functions) rather than fixed strings so they
  // re-resolve on every chart.update() — i.e. when the theme is flipped
  // live. They used to be hard-coded white-at-low-alpha (fine on the dark
  // card, but invisible on the light theme's white card: the inactive
  // bars, both axes' labels and the gridlines all vanished).
  const highlighted = data.monthlySeries.map(m => Math.abs(m.monthIndex - data.selectedMonth) <= 1);
  charts.foInflowChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.monthlySeries.map(m => m.label),
      datasets: [{
        data: values,
        backgroundColor: (ctx) => highlighted[ctx.dataIndex] ? '#c9a227' : chartInk(0.18),
        borderRadius: 4,
        maxBarThickness: 26
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => money(ctx.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: () => chartTextInk(0.5), font: { size: 10 } } },
        y: { grid: { color: () => chartInk(0.06) }, ticks: { color: () => chartTextInk(0.4), callback: v => compactMoney(v) } }
      }
    }
  });
}

function buildBudgetDonut(data) {
  destroyChart('foBudgetDonut');
  const canvas = document.getElementById('foBudgetDonut');
  if (!canvas || typeof Chart === 'undefined') return;
  charts.foBudgetDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Savings', 'Loans', 'Kids & Education', 'All Other'],
      datasets: [{
        data: [data.savingsSpend, data.loansSpend, data.kidsEduSpend, data.allOtherSpend],
        backgroundColor: ['#c9a227', '#5b8def', '#a06bff', '#3a4a63'],
        borderWidth: 0
      }]
    },
    options: { maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }
  });
}

function buildBudgetSpendDonut(data) {
  destroyChart('foBudgetSpendDonut');
  const canvas = document.getElementById('foBudgetSpendDonut');
  if (!canvas || typeof Chart === 'undefined' || !data.budgetSpendShare.length) return;
  charts.foBudgetSpendDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.budgetSpendShare.map(c => c.name),
      datasets: [{ data: data.budgetSpendShare.map(c => c.amount), backgroundColor: BUDGET_SHARE_PALETTE, borderWidth: 0 }]
    },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
  });
}

function buildStructureRadar(data) {
  destroyChart('foStructureRadar');
  const canvas = document.getElementById('foStructureRadar');
  if (!canvas || typeof Chart === 'undefined') return;
  charts.foStructureRadar = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: data.structureAxes.map(a => a.label),
      datasets: [{
        data: data.structureAxes.map(a => a.value),
        backgroundColor: 'rgba(61,218,251,0.2)',
        borderColor: '#c9a227',
        pointBackgroundColor: '#c9a227'
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          angleLines: { color: () => chartInk(0.08) },
          grid: { color: () => chartInk(0.08) },
          pointLabels: { color: () => chartTextInk(0.6), font: { size: 10 } },
          ticks: { display: false }
        }
      }
    }
  });
}

function buildCostsDonut(data) {
  destroyChart('foCostsDonut');
  const canvas = document.getElementById('foCostsDonut');
  if (!canvas || typeof Chart === 'undefined') return;
  const palette = ['#c9a227', '#5b8def', '#a06bff', '#3ddc97', '#ffb454', '#ff6b7a', '#3a4a63'];
  charts.foCostsDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.costsBreakdown.map(c => c.name),
      datasets: [{ data: data.costsBreakdown.map(c => c.amount), backgroundColor: palette, borderWidth: 0 }]
    },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
  });
}

// Draws a small rounded value bubble above each point in the highlighted
// month range, for the primary ("Costs") line only — matching the
// reference's floating "1800 / 2800 / 3240" labels that sit above the
// line instead of only appearing on hover. Built fresh per chart so it
// can close over that render's highlightRange directly, rather than
// reading a property stashed on the chart instance after construction
// (which would miss the plugin's first, synchronous draw pass).
function buildCompareCalloutPlugin(highlightRange) {
  return {
    id: 'foCompareCallouts',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      if (!highlightRange.length) return;
      const meta = chart.getDatasetMeta(0); // "Costs" — always dataset 0
      if (!meta || !meta.data) return;

      ctx.save();
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      highlightRange.forEach(idx => {
        const point = meta.data[idx];
        if (!point) return;
        const value = chart.data.datasets[0].data[idx];
        const label = compactMoney(value);
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 16;
        const boxH = 20;
        const boxX = point.x - boxW / 2;
        const boxY = point.y - boxH - 14;
        const r = 6;

        ctx.beginPath();
        ctx.moveTo(boxX + r, boxY);
        ctx.lineTo(boxX + boxW - r, boxY);
        ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
        ctx.lineTo(boxX + boxW, boxY + boxH - r);
        ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
        ctx.lineTo(boxX + r, boxY + boxH);
        ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
        ctx.lineTo(boxX, boxY + r);
        ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
        ctx.closePath();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(61, 218, 251, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#e8edf5';
        ctx.fillText(label, point.x, boxY + boxH / 2);
      });

      ctx.restore();
    }
  };
}

function buildCompareChart(data) {
  destroyChart('foCompareChart');
  const canvas = document.getElementById('foCompareChart');
  if (!canvas || typeof Chart === 'undefined') return;

  // The month chips below this chart (and the page-wide period nav) set
  // selectedMonth, which already drives the three header figures
  // (renderCompareAnnualCard). Rather than highlighting just the single
  // selected month, this now highlights a 3-month range centered on it
  // (matching the reference's APR/MAY/JUN multi-month highlight) — bigger
  // brighter points across the range, bold axis labels, and floating
  // value callouts above each highlighted point on the Costs line.
  const activeMonth = data.selectedMonth;
  const highlightRange = [activeMonth - 1, activeMonth, activeMonth + 1].filter(i => i >= 0 && i <= 11);
  const pointRadii = data.monthlySeries.map(m => highlightRange.includes(m.monthIndex) ? 5 : 2.5);
  const pointHoverRadii = data.monthlySeries.map(m => highlightRange.includes(m.monthIndex) ? 7 : 4);

  const datasets = [
    { label: 'Costs', data: data.monthlySeries.map(m => m.costs), borderColor: '#ff6b7a', backgroundColor: 'transparent', tension: 0.4, pointRadius: pointRadii, pointHoverRadius: pointHoverRadii, pointBackgroundColor: '#ff6b7a', pointBorderColor: '#ff6b7a' }
  ];
  if (compareShowGoals) datasets.push({ label: 'Goals', data: data.monthlySeries.map(m => m.goals), borderColor: '#a06bff', backgroundColor: 'transparent', tension: 0.4, pointRadius: pointRadii, pointHoverRadius: pointHoverRadii, pointBackgroundColor: '#a06bff', pointBorderColor: '#a06bff' });
  if (compareShowInflow) datasets.push({ label: 'Inflow', data: data.monthlySeries.map(m => m.inflow), borderColor: '#c9a227', backgroundColor: 'transparent', tension: 0.4, pointRadius: pointRadii, pointHoverRadius: pointHoverRadii, pointBackgroundColor: '#c9a227', pointBorderColor: '#c9a227' });

  charts.foCompareChart = new Chart(canvas, {
    type: 'line',
    data: { labels: data.monthlySeries.map(m => m.label), datasets },
    plugins: [buildCompareCalloutPlugin(highlightRange)],
    options: {
      maintainAspectRatio: false,
      // Extra top padding so the floating callout bubbles (drawn above
      // the highlighted points) don't get clipped by the canvas edge.
      layout: { padding: { top: 26 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${money(ctx.parsed.y)}` } } },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: (ctx) => highlightRange.includes(data.monthlySeries[ctx.index]?.monthIndex) ? '#c9a227' : chartTextInk(0.5),
            font: (ctx) => ({ size: 10, weight: highlightRange.includes(data.monthlySeries[ctx.index]?.monthIndex) ? 'bold' : 'normal' })
          }
        },
        y: { grid: { color: () => chartInk(0.06) }, ticks: { color: () => chartTextInk(0.4), callback: v => compactMoney(v) } }
      }
    }
  });
}

function buildAnnualChart(data) {
  destroyChart('foAnnualChart');
  const canvas = document.getElementById('foAnnualChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const isSelectedYear = data.annualData.map(y => y.year === selectedAnnualYear);
  charts.foAnnualChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: data.annualData.map(y => y.year), datasets: [{ data: data.annualData.map(y => y.netSavings), backgroundColor: (ctx) => isSelectedYear[ctx.dataIndex] ? '#c9a227' : chartInk(0.18), borderRadius: 4, maxBarThickness: 40 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => money(ctx.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: () => chartTextInk(0.5) } },
        y: { grid: { color: () => chartInk(0.06) }, ticks: { color: () => chartTextInk(0.4), callback: v => compactMoney(v) } }
      }
    }
  });
}

let delegatedListenerAttached = false;

function attachFinanceOverviewBehavior(data) {
  buildInflowChart(data);
  buildBudgetDonut(data);
  buildBudgetSpendDonut(data);
  buildStructureRadar(data);
  buildCostsDonut(data);
  buildCompareChart(data);
  buildAnnualChart(data);

  if (delegatedListenerAttached) return;
  delegatedListenerAttached = true;

  document.addEventListener('click', e => {
    if (!e.target.closest('.fo-dashboard')) return;

    const tabBtn = e.target.closest('#foInflowTabs .fo-tab');
    if (tabBtn) {
      selectedInflowTab = tabBtn.dataset.tab;
      initFinanceOverviewUI();
      return;
    }

    const structureTabBtn = e.target.closest('#foStructureCostsTabs .fo-tab');
    if (structureTabBtn) {
      selectedStructureTab = structureTabBtn.dataset.tab;
      initFinanceOverviewUI();
      return;
    }

    const bottomTabBtn = e.target.closest('#foBottomTabs .fo-tab');
    if (bottomTabBtn) {
      selectedBottomTab = bottomTabBtn.dataset.tab;
      initFinanceOverviewUI();
      return;
    }

    // Property Rates & Taxes card's own FY nav — steps selectedRatesTaxFY
    // by a year in either direction. FY strings are "YYYY-YYYY"; parsing
    // out the first year, shifting it, and re-deriving via getFinancialYear
    // keeps this in exactly the same format computeFinanceOverviewData
    // already produces/compares everywhere else.
    const ratesTaxPrevBtn = e.target.closest('#foRatesTaxPrevFY');
    if (ratesTaxPrevBtn && !ratesTaxPrevBtn.disabled) {
      const [startYear] = (selectedRatesTaxFY || getCurrentFinancialYear()).split('-').map(Number);
      selectedRatesTaxFY = getFinancialYear(`${startYear - 1}-07-01`);
      initFinanceOverviewUI();
      return;
    }
    const ratesTaxNextBtn = e.target.closest('#foRatesTaxNextFY');
    if (ratesTaxNextBtn && !ratesTaxNextBtn.disabled) {
      const [startYear] = (selectedRatesTaxFY || getCurrentFinancialYear()).split('-').map(Number);
      const nextFY = getFinancialYear(`${startYear + 1}-07-01`);
      // Stepping forward past the real current FY makes no sense (there's
      // nothing to show yet) - snap back to null (today's real FY) instead.
      selectedRatesTaxFY = nextFY === getCurrentFinancialYear() ? null : nextFY;
      initFinanceOverviewUI();
      return;
    }

    const prevBtn = e.target.closest('#foPrevMonth');
    if (prevBtn) {
      selectedMonth--;
      if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
      initFinanceOverviewUI();
      return;
    }

    const nextBtn = e.target.closest('#foNextMonth');
    if (nextBtn) {
      if (nextBtn.disabled) return; // never navigate into a month that hasn't happened yet
      selectedMonth++;
      if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
      initFinanceOverviewUI();
      return;
    }

    const todayBtn = e.target.closest('#foTodayMonth');
    if (todayBtn) {
      const now = new Date();
      selectedYear = now.getFullYear();
      selectedMonth = now.getMonth();
      initFinanceOverviewUI();
      return;
    }

    const monthChip = e.target.closest('#foMonthChips .fo-chip');
    if (monthChip) {
      if (monthChip.disabled) return; // future month within the selected year — no data yet
      selectedMonth = parseInt(monthChip.dataset.month, 10);
      initFinanceOverviewUI();
      return;
    }

    const yearChip = e.target.closest('#foYearChips .fo-chip');
    if (yearChip) {
      selectedAnnualYear = yearChip.dataset.year;
      initFinanceOverviewUI();
      return;
    }

    const listTabBtn = e.target.closest('#foListTabs .fo-list-tab');
    if (listTabBtn) {
      selectedListTab = listTabBtn.dataset.listTab;
      selectedListKey = null; // let it default to the first row of the new tab
      initFinanceOverviewUI();
      return;
    }

    const listRow = e.target.closest('.fo-list-row');
    if (listRow) {
      selectedListKey = listRow.dataset.listKey;
      initFinanceOverviewUI();
      return;
    }

    const balancePeek = e.target.closest('.fo-balance-peek');
    if (balancePeek) {
      const clickedCreditId = balancePeek.dataset.creditAccountId;
      if (clickedCreditId) {
        if (clickedCreditId !== pinnedCreditAccountId) {
          pinnedCreditAccountId = clickedCreditId;
          creditStackSwapAnimate = true;
          initFinanceOverviewUI();
        }
        return;
      }
      const clickedId = balancePeek.dataset.accountId;
      if (clickedId && clickedId !== pinnedBalanceAccountId) {
        pinnedBalanceAccountId = clickedId;
        balanceStackSwapAnimate = true;
        initFinanceOverviewUI();
      }
      return;
    }

    const markPaidBtn = e.target.closest('#foMarkBillPaid');
    if (markPaidBtn) {
      (async () => {
        const billId = markPaidBtn.dataset.billId;
        const [rawBills, rawAccounts] = await Promise.all([
          getAllItems(STORE_NAMES.bills).catch(() => []),
          getAllItems(STORE_NAMES.accounts).catch(() => [])
        ]);
        const bill = rawBills.find(b => b.id === billId);
        if (!bill) return;
        if (!confirm(`Mark "${bill.name}" as paid?`)) return;
        await markBillPaid(bill, rawAccounts);
        initFinanceOverviewUI();
      })();
      return;
    }
  });

  document.addEventListener('change', e => {
    if (!e.target.closest('.fo-dashboard')) return;
    if (e.target.id === 'foToggleGoals') {
      compareShowGoals = e.target.checked;
      initFinanceOverviewUI();
    } else if (e.target.id === 'foToggleInflow') {
      compareShowInflow = e.target.checked;
      initFinanceOverviewUI();
    }
  });
}

export function cleanupFinanceOverview() {
  Object.keys(charts).forEach(destroyChart);
}
