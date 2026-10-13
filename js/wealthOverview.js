// wealthOverview.js
//
// "Wealth Overview" — a second, visually distinct dashboard styled after a
// reference infographic (dark hero banner, top stat strip, numbered
// at-a-glance cards, a composite "Wealth Planning Progress" ring, and a
// closing banner). Unlike the infographic (which used placeholder numbers),
// every figure here is computed from real data already in the app:
//
//   - Net worth / cash / credit figures: same formula dashboard.js uses.
//   - Emergency Fund, Investment Contributions, Super Contributions:
//     summed from transactions tagged with the matching default category
//     (sub_emergency_fund / sub_shares_etf / sub_super_contributions).
//   - Debt Payoff: reuses dashboard.js's getLoanProgressList(), so it
//     always matches the Loans page.
//   - Insurance Review: same "is the next bill overdue" logic as the
//     Quick Look panel.
//
// A few things have no home anywhere else in the app yet (an emergency
// fund target, an annual investment/super contribution goal, a retirement
// age target, and a free-form list of savings goals like "Buy a House").
// Those are kept as lightweight, editable, local-only settings — clearly
// separate from the real ledger data — rather than inventing new IndexedDB
// stores for a first pass. They live in localStorage and only affect this
// view.

import { getAllItems, STORE_NAMES } from './db.js';
import { getGatedItems, hasFeature } from './features.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalance } from './accountBalance.js';
import { getLoanProgressList } from './dashboard.js';
import { getTotalSuperBalance } from './superannuation.js';

import { currencySymbol, formatMoney, toBase, toBaseTransactions, propertyAmountInBase } from './utils/currency.js';
const GOALS_KEY = 'dfm_wealth_goals';
const TARGETS_KEY = 'dfm_wealth_targets';

const DEFAULT_TARGETS = {
  emergencyFundGoal: 20000,
  investmentAnnualGoal: 15000,
  superAnnualGoal: 10000,
  currentAge: 35,
  retirementAge: 65
};

const INSURANCE_CATEGORY_IDS = new Set([
  'sub_home_ins', 'sub_landlord_ins', 'sub_life_ins', 'sub_pet_ins',
  'sub_car_insurance', 'sub_health_insurance'
]);

function getAccountIconLocal(type) {
  const icons = { bank: '🏦', credit: '💳', cash: '💵', savings: '💰', investment: '📈', offset: '⚖️' };
  return icons[type] || '📁';
}

let portfolioChart = null;
let netWorthTrendChart = null;
let wealthDelegatedListenerAttached = false;

// ---------------------------------------------------------------------------
// Local settings (targets + free-form goals) — see file header note above.
// ---------------------------------------------------------------------------

function loadTargets() {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGETS_KEY) || 'null');
    return { ...DEFAULT_TARGETS, ...(saved || {}) };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}

function saveTargets(targets) {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
  } catch { /* not fatal */ }
}

// Exported so other views (e.g. the Dashboard and Financial Dashboard) can
// show the same goals/targets and wealth figures without duplicating the
// localStorage read/write logic or the underlying computation.
export { loadGoals, loadTargets, saveGoals, saveTargets, computeWealthData };

function loadGoals() {
  try {
    return JSON.parse(localStorage.getItem(GOALS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveGoals(goals) {
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
  } catch { /* not fatal */ }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function money(n, { compact = false } = {}) {
  const num = Number(n) || 0;
  if (compact && Math.abs(num) >= 1000) {
    return `${currencySymbol()}${(num / 1000).toFixed(num >= 100000 ? 0 : 1)}k`;
  }
  return formatMoney(num, undefined, { digits: 0 });
}

function pct(n) {
  return `${Math.round(Math.max(0, Math.min(100, n)))}%`;
}

function clampPercent(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

function sumByCategory(transactions, categoryId, { yearOnly = null } = {}) {
  const rows = transactions.filter(t => t.categoryId === categoryId && (!yearOnly || (t.date || '').startsWith(yearOnly)));
  // Contribution categories are logged as expenses (money leaving the main
  // account), so amounts are negative — take the absolute value so goal
  // progress reads as a positive "amount saved so far".
  return Math.abs(rows.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0));
}

// Builds a monthly net-worth approximation by walking the current cash
// balance backward using each month's real net cash flow. Property value,
// loan balances, and super balance are held at their current levels
// across the series, since this app doesn't keep historical property
// valuations (and super balance history is sparse, manually-entered
// snapshots rather than a monthly series) — so this trend mainly reflects
// real cash movement month to month, not historical property appreciation
// or super contributions/returns.
function getNetWorthTrendSeries(transactions, netPropertyWorth, currentCashBalance, months = 6, superBalance = 0) {
  const today = new Date();
  const monthKeys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const netByMonth = {};
  monthKeys.forEach(k => { netByMonth[k] = 0; });
  transactions.forEach(t => {
    if (!t.date) return;
    const key = t.date.slice(0, 7);
    if (key in netByMonth) netByMonth[key] += t.amount;
  });

  let runningCash = currentCashBalance;
  const cashAtMonthEnd = {};
  for (let i = monthKeys.length - 1; i >= 0; i--) {
    cashAtMonthEnd[monthKeys[i]] = runningCash;
    runningCash -= netByMonth[monthKeys[i]];
  }

  return monthKeys.map(k => ({
    month: k,
    netWorth: cashAtMonthEnd[k] + netPropertyWorth + superBalance
  }));
}

function computeWealthData({ accounts, transactions, loans, properties, bills, categories, superFunds = [], superBalanceHistory = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = today.slice(0, 4);
  const targets = loadTargets();
  const goals = loadGoals();

  // --- Core balances (same formula as the main Dashboard, so the two
  // views never disagree with each other) ---
  const accountBalances = accounts.map(a => ({ ...a, balance: computeAccountBalance(a, transactions) }));
  const flowTx = toBaseTransactions(transactions, accounts); // base-currency copy for cash-flow maths
  const totalCashBalance = accountBalances.reduce((sum, a) => sum + toBase(a.balance, a.currency), 0);
  const totalCreditBalance = accountBalances.filter(a => a.type === 'credit').reduce((sum, a) => sum + toBase(a.balance, a.currency), 0);
  const investmentValue = accountBalances.filter(a => a.type === 'investment').reduce((sum, a) => sum + toBase(a.balance, a.currency), 0);

  const totalPropertyValue = properties.reduce((sum, p) => sum + propertyAmountInBase(p, 'currentValue'), 0);
  const totalLoanBalance = loans.reduce((sum, l) => sum + (parseFloat(l.currentBalance) || 0), 0);
  const netPropertyWorth = totalPropertyValue - totalLoanBalance;
  const totalSuperBalance = getTotalSuperBalance(superFunds, superBalanceHistory);
  // Bug fix: totalCashBalance already sums every account including credit
  // (whose balance is negative — see accountBalance.js), so subtracting
  // Math.abs(totalCreditBalance) again here double-counted credit card
  // debt. Also now folds in super, which previously had no path into net
  // worth anywhere in the app.
  const netWorth = totalCashBalance + netPropertyWorth + totalSuperBalance;

  // --- Net worth trend (last 6 months) — approximated by walking the
  // current cash balance backward using each month's real net cash flow.
  // Property value, loan balances, and super balance are held at their
  // current levels across the series (this app doesn't keep historical
  // property valuations, and super balance history is sparse manually-
  // entered snapshots rather than a monthly series), so this mainly
  // reflects real cash movement month to month, not property appreciation
  // or super contributions/returns. Same approach as the old Dashboard's
  // equivalent chart, so the two never disagree if both exist for a
  // while during the transition. ---
  const netWorthTrend = getNetWorthTrendSeries(flowTx, netPropertyWorth, totalCashBalance, 6, totalSuperBalance);

  // --- This month's savings rate ---
  const currentMonth = today.slice(0, 7);
  const monthIncome = flowTx.filter(t => t.type === 'income' && !t.isTransfer && t.date?.startsWith(currentMonth)).reduce((s, t) => s + t.amount, 0);
  const monthExpenses = flowTx.filter(t => t.type === 'expense' && !t.isTransfer && t.date?.startsWith(currentMonth)).reduce((s, t) => s + t.amount, 0);
  const monthSavings = monthIncome + monthExpenses; // expenses stored negative
  const savingsRate = monthIncome > 0 ? (monthSavings / monthIncome) * 100 : 0;

  // --- Emergency fund (cumulative, all-time — it's a "have I built this
  // up" number, not a per-year one) ---
  const emergencyFundSaved = sumByCategory(flowTx, 'sub_emergency_fund');
  const emergencyFundPercent = clampPercent((emergencyFundSaved / targets.emergencyFundGoal) * 100);

  // --- Investment & super contributions, this calendar year ---
  const investmentContributionsYTD = sumByCategory(flowTx, 'sub_shares_etf', { yearOnly: currentYear });
  const investmentPercent = clampPercent((investmentContributionsYTD / targets.investmentAnnualGoal) * 100);

  const superContributionsYTD = sumByCategory(flowTx, 'sub_super_contributions', { yearOnly: currentYear });
  const superPercent = clampPercent((superContributionsYTD / targets.superAnnualGoal) * 100);
  const superContributionsAllTime = sumByCategory(flowTx, 'sub_super_contributions');

  // --- Debt payoff — reuses the exact same per-loan math as the Loans
  // page / main Dashboard ---
  const loanProgress = getLoanProgressList(loans);
  // A construction loan still mid-drawdown doesn't have an established
  // "debt" to measure payoff progress against yet (see
  // getLoanPayoffStatus in loans.js) — folding its full facility limit
  // in here would count the undrawn balance as if it were already
  // nearly paid off, the same bug this composite would otherwise
  // inherit from the per-loan widgets it's built from. Excluded until
  // every stage has drawn, same cutoff those widgets use.
  const debtLoans = loanProgress.filter(l => l.phase !== 'drawing');
  const totalOriginal = debtLoans.reduce((s, l) => s + l.original, 0);
  const totalCurrent = debtLoans.reduce((s, l) => s + l.current, 0);
  const debtPayoffPercent = totalOriginal > 0 ? clampPercent(((totalOriginal - totalCurrent) / totalOriginal) * 100) : null;

  // --- Retirement timeline (rough, clearly-labeled estimate) ---
  const yearsToGo = Math.max(0, targets.retirementAge - targets.currentAge);
  const retirementProgressPercent = clampPercent((targets.currentAge / targets.retirementAge) * 100);
  // 4%-rule ballpark using current investment value + all-time super
  // contributions — an estimate, not a projection of future growth.
  const estRetirementPot = investmentValue + superContributionsAllTime;
  const estMonthlyRetirementIncome = (estRetirementPot * 0.04) / 12;

  // --- Insurance status (same "next bill overdue?" logic as Quick Look) ---
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const propertyById = new Map(properties.map(p => [p.id, p]));
  const unpaidBills = bills.filter(b => !b.paid);
  const today8601 = today; // already YYYY-MM-DD

  // Loans with a fixed-rate period ending soon (or already ended) — flags
  // the switch to a variable rate before it happens, same "don't let this
  // surprise you" spirit as the Insurance Review card below.
  const fixedRateAlerts = loans
    .filter(l => l.fixedRateEndDate)
    .map(l => {
      const daysUntil = Math.round((new Date(l.fixedRateEndDate) - new Date(today8601)) / (1000 * 60 * 60 * 24));
      const property = properties.find(p => p.id === l.propertyId);
      return {
        name: l.name || l.type || 'Loan',
        propertyName: property?.name || property?.address || '',
        fixedRateEndDate: l.fixedRateEndDate,
        daysUntil,
        isExpired: daysUntil < 0,
        isSoon: daysUntil >= 0 && daysUntil <= 90
      };
    })
    .filter(l => l.isExpired || l.isSoon)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const insuranceBills = unpaidBills
    .filter(b => INSURANCE_CATEGORY_IDS.has(b.categoryId))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(b => {
      const account = accountById.get(b.accountId);
      const property = propertyById.get(b.propertyId);
      const category = categoryById.get(b.categoryId);
      return {
        name: b.name,
        icon: category?.icon || '🛡️',
        subcategoryName: category?.name || '',
        amount: b.amount,
        currency: b.currency || account?.currency,
        dueDate: b.dueDate,
        isOverdue: b.dueDate < today,
        recurring: b.recurring || '',
        accountName: account?.name || '',
        accountIcon: account ? getAccountIconLocal(account.type) : '',
        propertyName: property?.name || ''
      };
    });

  // --- Financial goals (user-managed, local list) ---
  const goalsWithPercent = goals.map(g => ({ ...g, percent: clampPercent((g.current / (g.target || 1)) * 100) }));
  const goalsAveragePercent = goalsWithPercent.length > 0
    ? goalsWithPercent.reduce((s, g) => s + g.percent, 0) / goalsWithPercent.length
    : null;

  // --- Overall wealth-planning composite ---
  const planningItems = [
    { label: 'Build Emergency Fund', percent: emergencyFundPercent, done: emergencyFundPercent >= 100 },
    { label: 'Eliminate Debt', percent: debtPayoffPercent ?? 100, done: (debtPayoffPercent ?? 100) >= 100 },
    { label: 'Grow Investments', percent: investmentPercent, done: investmentPercent >= 100 },
    { label: 'Plan for Retirement', percent: superPercent, done: superPercent >= 100 },
    { label: 'Personal Goals', percent: goalsAveragePercent ?? 0, done: (goalsAveragePercent ?? 0) >= 100 }
  ];
  const overallPercent = clampPercent(planningItems.reduce((s, i) => s + i.percent, 0) / planningItems.length);

  // Asset allocation for the portfolio doughnut — by account type, plus
  // property equity if any properties are tracked.
  const allocation = {};
  accountBalances.forEach(a => {
    if (a.balance <= 0) return;
    allocation[a.type] = (allocation[a.type] || 0) + toBase(a.balance, a.currency);
  });
  if (netPropertyWorth > 0) allocation.property = (allocation.property || 0) + netPropertyWorth;
  if (totalSuperBalance > 0) allocation.super = (allocation.super || 0) + totalSuperBalance;

  return {
    today, targets, goals: goalsWithPercent,
    netWorth, totalCashBalance, investmentValue, monthSavings, savingsRate,
    totalSuperBalance,
    emergencyFundSaved, emergencyFundPercent,
    investmentContributionsYTD, investmentPercent,
    superContributionsYTD, superPercent,
    loanProgress, totalOriginal, totalCurrent, debtPayoffPercent,
    yearsToGo, retirementProgressPercent, estMonthlyRetirementIncome,
    insuranceBills,
    fixedRateAlerts,
    netWorthTrend,
    goalsAveragePercent, overallPercent, planningItems,
    allocation
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHero(data) {
  return `
    <div class="wealth-hero">
      <div class="wealth-hero-text">
        <div class="wealth-hero-eyebrow">WEALTH OVERVIEW</div>
        <h1>Your money,<br>at a glance.</h1>
        <p class="wealth-hero-tagline">Plan today. Build tomorrow. <span class="wealth-hero-accent">Live your dreams.</span></p>
      </div>
      <div class="wealth-hero-stat">
        <div class="wealth-hero-stat-label">Net Worth</div>
        <div class="wealth-hero-stat-value ${data.netWorth < 0 ? 'negative' : ''}">${money(data.netWorth)}</div>
        <div class="wealth-hero-stat-sub">${data.savingsRate >= 0 ? 'Saving' : 'Overspending'} ${pct(Math.abs(data.savingsRate))} of income this month</div>
      </div>
    </div>

    <div class="wealth-stat-strip">
      <div class="wealth-stat-pill">
        <span class="wealth-stat-pill-icon">💰</span>
        <div>
          <div class="wealth-stat-pill-value">${money(data.netWorth, { compact: true })}</div>
          <div class="wealth-stat-pill-label">Net Worth</div>
        </div>
      </div>
      <div class="wealth-stat-pill">
        <span class="wealth-stat-pill-icon">📈</span>
        <div>
          <div class="wealth-stat-pill-value">${money(data.investmentValue, { compact: true })}</div>
          <div class="wealth-stat-pill-label">Investment Value</div>
        </div>
      </div>
      <div class="wealth-stat-pill">
        <span class="wealth-stat-pill-icon">🐷</span>
        <div>
          <div class="wealth-stat-pill-value ${data.monthSavings < 0 ? 'negative' : ''}">${money(data.monthSavings, { compact: true })}</div>
          <div class="wealth-stat-pill-label">This Month's Savings</div>
        </div>
      </div>
      <div class="wealth-stat-pill">
        <span class="wealth-stat-pill-icon">🎯</span>
        <div>
          <div class="wealth-stat-pill-value">${pct(data.overallPercent)}</div>
          <div class="wealth-stat-pill-label">Wealth Plan Progress</div>
        </div>
      </div>
    </div>
  `;
}

function renderSavingsTracker(data) {
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">1</span>🐷 Savings Tracker</div>
      <div class="wealth-card-title-sub">Emergency Fund</div>
      <div class="wealth-card-bignum">${money(data.emergencyFundSaved)}</div>
      <div class="wealth-progress-track"><div class="wealth-progress-fill" style="width:${data.emergencyFundPercent}%"></div></div>
      <div class="wealth-card-footrow">
        <span>Goal: ${money(data.targets.emergencyFundGoal)}</span>
        <span>${pct(data.emergencyFundPercent)} of goal</span>
      </div>
      <div class="wealth-card-note">${data.emergencyFundPercent >= 100
        ? 'Fully funded — great work.'
        : 'Every contribution to Emergency Fund counts toward this.'}</div>
      <button class="wealth-edit-link" data-action="edit-target" data-key="emergencyFundGoal">Edit goal</button>
    </div>
  `;
}

function renderInvestmentContributions(data) {
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">2</span>📊 Investment Contributions</div>
      <div class="wealth-card-title-sub">This Year (Shares / ETFs)</div>
      <div class="wealth-card-bignum">${money(data.investmentContributionsYTD)}</div>
      <div class="wealth-progress-track"><div class="wealth-progress-fill" style="width:${data.investmentPercent}%"></div></div>
      <div class="wealth-card-footrow">
        <span>Annual Goal: ${money(data.targets.investmentAnnualGoal)}</span>
        <span>${pct(data.investmentPercent)}</span>
      </div>
      <div class="wealth-card-note">Consistency is the key to long-term wealth.</div>
      <button class="wealth-edit-link" data-action="edit-target" data-key="investmentAnnualGoal">Edit goal</button>
    </div>
  `;
}

function renderRetirementTimeline(data) {
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">3</span>🌴 Retirement Timeline</div>
      <div class="wealth-card-title-sub">Super Contributions This Year</div>
      <div class="wealth-card-bignum">${money(data.superContributionsYTD)}</div>
      <div class="wealth-progress-track"><div class="wealth-progress-fill" style="width:${data.superPercent}%"></div></div>
      <div class="wealth-card-footrow">
        <span>Retirement Age: ${data.targets.retirementAge}</span>
        <span>${data.yearsToGo} years to go</span>
      </div>
      <div class="wealth-card-note">
        Est. monthly income in retirement: ${money(data.estMonthlyRetirementIncome)}
        <span class="wealth-estimate-tag">estimate only, not advice</span>
      </div>
      <button class="wealth-edit-link" data-action="edit-target" data-key="retirementAge">Edit targets</button>
    </div>
  `;
}

function renderFinancialGoals(data) {
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">4</span>🎯 Financial Goals</div>
      <div class="wealth-goals-list">
        ${data.goals.length === 0
          ? `<div class="wealth-card-note">No goals yet — add your first one (a house, travel, anything you're saving toward).</div>`
          : data.goals.map(g => `
            <div class="wealth-goal-row">
              <div class="wealth-goal-row-top">
                <span>${escapeHtml(g.name)}</span>
                <span>${pct(g.percent)}</span>
              </div>
              <div class="wealth-progress-track thin"><div class="wealth-progress-fill" style="width:${g.percent}%"></div></div>
              <div class="wealth-goal-row-bottom">
                <span>${money(g.current)} of ${money(g.target)}</span>
                <span class="wealth-goal-actions">
                  <button class="wealth-edit-link" data-action="edit-goal" data-id="${g.id}">Edit</button>
                  <button class="wealth-edit-link danger" data-action="delete-goal" data-id="${g.id}">Remove</button>
                </span>
              </div>
            </div>
          `).join('')
        }
      </div>
      <button class="wealth-edit-link" data-action="add-goal">+ Add a goal</button>
    </div>
  `;
}

function renderInsuranceReview(data) {
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">5</span>🛡️ Insurance Review</div>
      <div class="wealth-insurance-list">
        ${data.insuranceBills.length === 0
          ? `<div class="wealth-card-note">No insurance bills on record yet.</div>`
          : data.insuranceBills.map(b => `
            <div class="wealth-insurance-row">
              <span>
                ${b.isOverdue ? '⚠️' : '✅'} ${escapeHtml(b.name)}
                <br><small>
                  ${new Date(b.dueDate).toLocaleDateString()} · ${formatMoney(Number(b.amount || 0), b.currency)}
                  ${b.recurring ? ` · 🔄 ${escapeHtml(b.recurring)}` : ''}
                  ${b.accountName ? ` · ${b.accountIcon} ${escapeHtml(b.accountName)}` : ''}
                  ${b.propertyName ? ` · 🏠 ${escapeHtml(b.propertyName)}` : ''}
                </small>
              </span>
              <span class="${b.isOverdue ? 'wealth-tag-overdue' : 'wealth-tag-covered'}">${b.isOverdue ? 'Renewal Due' : 'Covered'}</span>
            </div>
          `).join('')
        }
      </div>
      <div class="wealth-card-note">${data.insuranceBills.some(b => b.isOverdue) ? 'Renew overdue policies to stay protected.' : 'Well protected today, secure tomorrow.'}</div>
    </div>
  `;
}

function renderPortfolioReview(data) {
  const hasAllocation = Object.keys(data.allocation).length > 0;
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">6</span>🥧 Annual Portfolio Review</div>
      <div class="wealth-card-title-sub">Investment Value</div>
      <div class="wealth-card-bignum">${money(data.investmentValue)}</div>
      ${hasAllocation ? `<div class="wealth-chart-wrap"><canvas id="wealthPortfolioChart" height="140"></canvas></div>` : `<div class="wealth-card-note">Add account balances to see your allocation.</div>`}
      <div class="wealth-card-note">Contributions this year (investments + super): ${money(data.investmentContributionsYTD + data.superContributionsYTD)}</div>
    </div>
  `;
}

function renderNetWorthTrend(data) {
  const hasSeries = data.netWorthTrend && data.netWorthTrend.length > 0;
  return `
    <div class="wealth-card wealth-card-wide">
      <div class="wealth-card-header"><span class="wealth-card-num">7</span>💎 Net Worth Trend</div>
      <div class="wealth-card-title-sub">Last 6 Months</div>
      ${hasSeries
        ? `<div class="wealth-chart-wrap"><canvas id="wealthNetWorthTrendChart" height="160"></canvas></div>`
        : `<div class="wealth-card-note">Not enough transaction history yet to chart a trend.</div>`
      }
      <div class="wealth-card-note">${hasFeature('property') ? 'Property, loan' : 'Loan'} and super balances are held at today's values across this trend — only cash movement is historical, so this reflects real cash flow month to month, not property appreciation or investment returns.</div>
    </div>
  `;
}

function renderFixedRateAlerts(data) {
  return `
    <div class="wealth-card">
      <div class="wealth-card-header"><span class="wealth-card-num">8</span>📅 Fixed Rate Watch</div>
      <div class="wealth-insurance-list">
        ${data.fixedRateAlerts.length === 0
          ? `<div class="wealth-card-note">No fixed-rate loans expiring soon.</div>`
          : data.fixedRateAlerts.map(l => `
            <div class="wealth-insurance-row">
              <span>
                ${l.isExpired ? '⚠️' : '⏳'} ${escapeHtml(l.name)}
                <br><small>
                  Fixed rate ${l.isExpired ? 'ended' : 'ends'} ${new Date(l.fixedRateEndDate).toLocaleDateString()}
                  ${l.propertyName ? ` · 🏠 ${escapeHtml(l.propertyName)}` : ''}
                </small>
              </span>
              <span class="${l.isExpired ? 'wealth-tag-overdue' : 'wealth-tag-covered'}">
                ${l.isExpired ? `${Math.abs(l.daysUntil)}d overdue` : `${l.daysUntil}d left`}
              </span>
            </div>
          `).join('')
        }
      </div>
      <div class="wealth-card-note">${data.fixedRateAlerts.some(l => l.isExpired) ? 'Check whether you\u2019ve rolled onto a variable rate you didn\u2019t choose.' : 'Review refinance options before any fixed period ends.'}</div>
    </div>
  `;
}

function renderWealthPlanningProgress(data) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - data.overallPercent / 100);
  return `
    <div class="wealth-card wealth-card-wide">
      <div class="wealth-card-header">9. Wealth Planning Progress</div>
      <div class="wealth-progress-layout">
        <div class="wealth-ring-wrap">
          <svg viewBox="0 0 120 120" class="wealth-ring">
            <circle cx="60" cy="60" r="54" class="wealth-ring-track" />
            <circle cx="60" cy="60" r="54" class="wealth-ring-fill"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" />
          </svg>
          <div class="wealth-ring-label">
            <div class="wealth-ring-percent">${pct(data.overallPercent)}</div>
            <div class="wealth-ring-caption">Overall Progress</div>
          </div>
        </div>
        <div class="wealth-progress-items">
          ${data.planningItems.map(item => `
            <div class="wealth-progress-item">
              <span class="wealth-progress-item-label">${escapeHtml(item.label)}</span>
              <div class="wealth-progress-track thin"><div class="wealth-progress-fill" style="width:${item.percent}%"></div></div>
              <span class="wealth-progress-item-status">${item.done ? 'Completed' : pct(item.percent)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderClosingBanner() {
  return `
    <div class="wealth-closing-banner">
      <div>
        <div class="wealth-closing-title">💎 WEALTH IS A JOURNEY, NOT A DESTINATION.</div>
        <div class="wealth-closing-sub">Stay disciplined, stay patient, stay focused.</div>
      </div>
      <div class="wealth-closing-links">
        <span>📋 Plan Your Future</span>
        <span>💰 Save Consistently</span>
        <span>📈 Invest Wisely</span>
        <span>🏡 Live Your Dreams</span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function initWealthOverviewUI() {
  const mainContent = document.getElementById('mainContent');
  mainContent.classList.add('page-transition');
  mainContent.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading wealth overview...</p></div>';

  const [accounts, transactions, loans, properties, bills, categories, superFunds, superBalanceHistory] = await Promise.all([
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.transactions).catch(() => []),
    getAllItems(STORE_NAMES.loans).catch(() => []),
    getGatedItems(STORE_NAMES.properties).catch(() => []),
    getAllItems(STORE_NAMES.bills).catch(() => []),
    getAllItems(STORE_NAMES.categories).catch(() => []),
    getAllItems(STORE_NAMES.superFunds).catch(() => []),
    getAllItems(STORE_NAMES.superBalanceHistory).catch(() => [])
  ]);

  const data = computeWealthData({ accounts, transactions, loans, properties, bills, categories, superFunds, superBalanceHistory });

  mainContent.innerHTML = `
    <div class="wealth-overview">
      ${renderHero(data)}
      <div class="wealth-grid">
        ${renderSavingsTracker(data)}
        ${renderInvestmentContributions(data)}
        ${renderRetirementTimeline(data)}
        ${renderFinancialGoals(data)}
        ${renderInsuranceReview(data)}
        ${renderPortfolioReview(data)}
        ${renderNetWorthTrend(data)}
        ${renderFixedRateAlerts(data)}
      </div>
      ${renderWealthPlanningProgress(data)}
      ${renderClosingBanner()}
    </div>
  `;

  attachWealthOverviewBehavior(data);
}

function attachWealthOverviewBehavior(data) {
  const main = document.getElementById('mainContent');

  // Portfolio allocation doughnut
  const chartCanvas = document.getElementById('wealthPortfolioChart');
  if (chartCanvas && typeof Chart !== 'undefined') {
    if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
    const labels = Object.keys(data.allocation).map(k => k.charAt(0).toUpperCase() + k.slice(1));
    const values = Object.values(data.allocation);
    portfolioChart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ['#2563eb', '#059669', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2'],
          borderWidth: 0
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        maintainAspectRatio: false
      }
    });
  }

  // Net worth trend (last 6 months) — same "destroy before re-create"
  // pattern as the portfolio doughnut above, since re-rendering this view
  // (editing a goal, etc.) rebuilds #mainContent's innerHTML and would
  // otherwise leave the old Chart.js instance attached to a canvas that
  // no longer exists.
  const trendCanvas = document.getElementById('wealthNetWorthTrendChart');
  if (trendCanvas && typeof Chart !== 'undefined' && data.netWorthTrend?.length) {
    if (netWorthTrendChart) { netWorthTrendChart.destroy(); netWorthTrendChart = null; }
    netWorthTrendChart = new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: data.netWorthTrend.map(p => {
          const [y, m] = p.month.split('-');
          return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
        }),
        datasets: [{
          label: 'Net Worth',
          data: data.netWorthTrend.map(p => p.netWorth),
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        maintainAspectRatio: false,
        scales: { y: { ticks: { callback: v => money(v, { compact: true }) } } }
      }
    });
  }

  // Delegated on document, attached exactly once for the lifetime of the
  // page — re-rendering this view (e.g. after editing a goal) replaces
  // #mainContent's innerHTML but not the element itself, so a listener
  // attached directly to it on every render would stack duplicates. The
  // `.wealth-overview` check scopes this to only fire while this view is
  // the one actually on screen.
  if (wealthDelegatedListenerAttached) return;
  wealthDelegatedListenerAttached = true;

  document.addEventListener('click', async e => {
    if (!e.target.closest('.wealth-overview')) return;
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'edit-target') {
      const targets = loadTargets();
      const key = btn.dataset.key;
      if (key === 'retirementAge') {
        const currentAge = prompt('Your current age:', targets.currentAge);
        if (currentAge === null) return;
        const retirementAge = prompt('Target retirement age:', targets.retirementAge);
        if (retirementAge === null) return;
        targets.currentAge = parseFloat(currentAge) || targets.currentAge;
        targets.retirementAge = parseFloat(retirementAge) || targets.retirementAge;
      } else {
        const label = key === 'emergencyFundGoal' ? 'Emergency fund goal'
          : key === 'investmentAnnualGoal' ? 'Annual investment contribution goal'
          : 'Annual super contribution goal';
        const value = prompt(label, targets[key]);
        if (value === null) return;
        targets[key] = parseFloat(value) || targets[key];
      }
      saveTargets(targets);
      initWealthOverviewUI();
      return;
    }

    if (action === 'add-goal') {
      const name = prompt('Goal name (e.g. Buy a House):');
      if (!name) return;
      const target = parseFloat(prompt('Target amount:', '10000'));
      if (!target || target <= 0) return;
      const current = parseFloat(prompt('Current amount saved toward this goal:', '0')) || 0;
      const goals = loadGoals();
      goals.push({ id: `goal_${Date.now()}`, name, target, current });
      saveGoals(goals);
      initWealthOverviewUI();
      return;
    }

    if (action === 'edit-goal') {
      const goals = loadGoals();
      const goal = goals.find(g => g.id === btn.dataset.id);
      if (!goal) return;
      const current = prompt(`Current amount saved toward "${goal.name}":`, goal.current);
      if (current === null) return;
      const target = prompt(`Target amount for "${goal.name}":`, goal.target);
      if (target === null) return;
      goal.current = parseFloat(current) || goal.current;
      goal.target = parseFloat(target) || goal.target;
      saveGoals(goals);
      initWealthOverviewUI();
      return;
    }

    if (action === 'delete-goal') {
      if (!confirm('Remove this goal?')) return;
      const goals = loadGoals().filter(g => g.id !== btn.dataset.id);
      saveGoals(goals);
      initWealthOverviewUI();
      return;
    }
  }, { once: false });
}

export function cleanupWealthOverview() {
  if (portfolioChart) {
    portfolioChart.destroy();
    portfolioChart = null;
  }
  if (netWorthTrendChart) {
    netWorthTrendChart.destroy();
    netWorthTrendChart = null;
  }
}
