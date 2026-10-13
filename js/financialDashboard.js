// financialDashboard.js
//
// "Financial Dashboard" — a light-themed, widget-dense view modelled on a
// reference infographic (navy banner, circular KPI badges, a filter rail
// down the left, and a grid of charts). Unlike the infographic, every
// figure here is computed from real data already in the app:
//
//   - Banner: app name, a time-of-day greeting and live date/time,
//     rendered as its own container at the top of the page.
//   - 6 KPI badges: total income, total expenses, net savings, savings
//     rate, budget utilisation and current balance for the selected
//     period (a single month, or the full year).
//   - Filter rail: click a month to scope the KPIs / category breakdowns
//     / budget comparison to that month; click an account type to
//     include/exclude it everywhere on the page.
//   - Monthly Income vs Expense: full calendar year, line chart.
//   - Expense by Category / Income by Category: this period's spend and
//     income split by top-level category.
//   - Savings Goal by Amount: target amount of each goal from the
//     Wealth Overview goals list (js/wealthOverview.js).
//   - Savings Progress: current balance of every non-credit account,
//     smallest to largest.
//   - By Account: balance split across accounts.
//   - Budget vs Actual: this period's budgeted vs actually-spent amount
//     per category that has a configured budget.
//   - Payment Method (Expenses): this period's spend grouped by the
//     account type it came out of (Credit Card / Bank Account / Savings
//     / Cash / Offset) — the closest real equivalent to "payment method"
//     the data model tracks.
//
// Charts use the Chart.js instance already loaded globally by index.html.

import { getAllItems, STORE_NAMES } from './db.js';
import { getGatedItems } from './features.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalance } from './accountBalance.js';
import { institutionDisplayName } from './institutions.js';
import { loadGoals, loadTargets, saveGoals, saveTargets, computeWealthData } from './wealthOverview.js';
import { getGreeting } from './quickLook.js';
import { getDisplayName, greetWithName } from './userName.js';

import { currencySymbol, formatMoney, toBase, toBaseTransactions } from './utils/currency.js';
let pfdCharts = {}; // keyed by canvas id, so re-renders destroy the right instance
let pfdClockTimer = null;
let pfdRaw = null; // last-fetched { accounts, transactions, categories, budgets }
let selectedMonth = new Date().getMonth(); // 0-11, or null for "full year"
let selectedYear = new Date().getFullYear(); // which calendar year the Month/Full Year filter applies to
let excludedAccountTypes = new Set(); // account types toggled OFF in the filter rail

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ACCOUNT_TYPE_LABELS = { bank: 'Bank Account', savings: 'Savings', cash: 'Cash', credit: 'Credit Card', offset: 'Offset Account' };
const PALETTE = ['#1d4ed8', '#0ea5b7', '#16a34a', '#dc2626', '#ca8a04', '#7c3aed', '#64748b', '#0f766e', '#c2410c', '#4338ca'];

function money(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  return `${sign}${currencySymbol()}${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function compactMoney(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1000) return `${sign}${currencySymbol()}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}K`;
  return `${sign}${formatMoney(abs, undefined, { digits: 0 })}`;
}

function monthlyAmount(amount, frequency) {
  const n = parseFloat(amount) || 0;
  switch (frequency) {
    case 'weekly': return n * 52 / 12;
    case 'fortnightly': return n * 26 / 12;
    case 'quarterly': return n / 3;
    case 'yearly': return n / 12;
    default: return n; // monthly
  }
}

function topLevelCategory(categoryId, categoryById) {
  let cat = categoryById.get(categoryId);
  let guard = 0;
  while (cat && cat.parentId && categoryById.get(cat.parentId) && guard < 10) {
    cat = categoryById.get(cat.parentId);
    guard++;
  }
  return cat || null;
}

function destroyPFDChart(id) {
  if (pfdCharts[id]) {
    pfdCharts[id].destroy();
    delete pfdCharts[id];
  }
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

function computePFDData({ accounts, transactions, categories, budgets, loans = [], properties = [], bills = [] }) {
  const now = new Date();
  const year = selectedYear;
  const categoryById = new Map(categories.map(c => [c.id, c]));

  // Every calendar year that actually has transaction history, so the
  // Year filter never offers a year with nothing in it. Always includes
  // the current year even if it's empty yet.
  const yearsAvailable = [...new Set(transactions.map(t => t.date?.slice(0, 4)).filter(Boolean))]
    .map(Number)
    .concat(now.getFullYear())
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => b - a);

  const accountBalances = accounts.map(a => ({ ...a, balance: computeAccountBalance(a, transactions) }));
  const flowTx = toBaseTransactions(transactions, accounts); // base-currency copy for flow maths
  const includedAccounts = accountBalances.filter(a => !excludedAccountTypes.has(a.type));
  const includedIds = new Set(includedAccounts.map(a => a.id));
  const accountTypesPresent = [...new Set(accountBalances.map(a => a.type))];

  const periodKey = selectedMonth !== null
    ? `${year}-${String(selectedMonth + 1).padStart(2, '0')}`
    : `${year}`;
  const periodMonths = selectedMonth !== null ? 1 : 12;

  const periodTx = flowTx.filter(t =>
    !t.isTransfer && t.date && t.date.startsWith(periodKey) && includedIds.has(t.accountId));

  const totalIncome = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = Math.abs(periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const netSavings = totalIncome - totalExpense;
  const savingsRatePct = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  const totalBudgeted = budgets.reduce((sum, b) => {
    const cat = categoryById.get(b.categoryId);
    const isExpenseCat = cat ? cat.type !== 'income' : true;
    return isExpenseCat ? sum + monthlyAmount(b.amount, b.frequency) * periodMonths : sum;
  }, 0);
  const budgetUtilPct = totalBudgeted > 0 ? (totalExpense / totalBudgeted) * 100 : 0;

  const currentBalance = includedAccounts.reduce((s, a) => s + toBase(a.balance, a.currency), 0);

  // --- Monthly Income vs Expense (full year, unaffected by month filter) ---
  const yearTx = flowTx.filter(t => !t.isTransfer && t.date && t.date.startsWith(String(year)) && includedIds.has(t.accountId));
  const monthlySeries = MONTH_LABELS.map((label, idx) => {
    const key = `${year}-${String(idx + 1).padStart(2, '0')}`;
    const mtx = yearTx.filter(t => t.date.startsWith(key));
    return {
      label,
      income: mtx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      expense: Math.abs(mtx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0))
    };
  });

  // --- Expense / Income by category (selected period) ---
  // Expenses group by top-level category (Housing, Food, Transport, ...
  // each its own top-level parent, so this is a real breakdown). Income
  // categories all sit under one single top-level parent ("Income" —
  // see js/defaultCategories.js), so grouping income the same way
  // always collapses every income transaction into that one bucket,
  // making the "breakdown" show a single 100%-Income bar. Income is
  // grouped by its own (leaf) category instead — Salary, Rental Income,
  // Dividends, etc. — which is the level that's actually distinct.
  function categoryBreakdown(type) {
    const totals = new Map();
    periodTx.filter(t => t.type === type).forEach(t => {
      const cat = type === 'income' ? categoryById.get(t.categoryId) : topLevelCategory(t.categoryId, categoryById);
      const key = cat ? cat.id : 'uncategorized';
      const name = cat ? cat.name : 'Uncategorized';
      const icon = cat ? (cat.icon || '') : '❔';
      const prev = totals.get(key) || { name, icon, amount: 0 };
      prev.amount += Math.abs(t.amount);
      totals.set(key, prev);
    });
    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  }
  const expenseBreakdown = categoryBreakdown('expense').slice(0, 8);
  const incomeBreakdown = categoryBreakdown('income').slice(0, 8);

  // --- Savings goals: user-managed goals + Emergency Fund as a built-in
  // goal, each shown as saved vs remaining (reuses Wealth Overview's data
  // so the two views can't disagree). ---
  const wealthData = computeWealthData({ accounts, transactions, loans, properties, bills, categories });
  const targets = loadTargets();
  const goals = [
    { id: '__emergency_fund', name: 'Emergency Fund', current: wealthData.emergencyFundSaved, target: targets.emergencyFundGoal, builtin: true },
    ...(loadGoals() || [])
  ].slice(0, 6).map(g => ({
    ...g,
    remaining: Math.max((g.target || 0) - (g.current || 0), 0),
    percent: Math.max(0, Math.min(100, ((g.current || 0) / (g.target || 1)) * 100))
  }));

  // --- Annual Plans: net savings per calendar year, last 3 years with data ---
  const yearsWithData = new Set(transactions.map(t => t.date?.slice(0, 4)).filter(Boolean));
  yearsWithData.add(String(year));
  const annualData = [...yearsWithData].sort().slice(-3).map(y => {
    const tx = flowTx.filter(t => !t.isTransfer && t.date && t.date.startsWith(y) && includedIds.has(t.accountId));
    const inc = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = Math.abs(tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    return { year: y, income: inc, expense: exp, netSavings: inc - exp };
  });

  // --- Investments & Retirement: contributions vs targets for the
  // selected year specifically (not wealthData's fixed "real current
  // year" YTD figures — those would silently ignore the Year filter). ---
  function sumByCategoryForYear(categoryId) {
    const rows = flowTx.filter(t => t.categoryId === categoryId && (t.date || '').startsWith(String(year)));
    return Math.abs(rows.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0));
  }
  const investmentContributionsForYear = sumByCategoryForYear('sub_shares_etf');
  const superContributionsForYear = sumByCategoryForYear('sub_super_contributions');
  const investments = {
    investmentContributionsYTD: investmentContributionsForYear,
    investmentAnnualGoal: targets.investmentAnnualGoal,
    superContributionsYTD: superContributionsForYear,
    superAnnualGoal: targets.superAnnualGoal,
    yearsToGo: wealthData.yearsToGo,
    retirementAge: targets.retirementAge,
    estMonthlyRetirementIncome: wealthData.estMonthlyRetirementIncome,
    allocation: wealthData.allocation
  };

  // --- Savings progress: non-credit account balances, smallest to largest ---
  const savingsProgress = includedAccounts
    .filter(a => a.type !== 'credit')
    .map(a => ({ label: institutionDisplayName(a.institution, a.institutionName) || a.name, value: toBase(a.balance, a.currency) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 6);

  // --- By account (balance split) ---
  const byAccount = includedAccounts
    .map(a => ({ label: a.name, value: toBase(a.balance, a.currency), type: a.type }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 6);

  // --- Budget vs Actual (this period, categories with a configured budget) ---
  const budgetVsActual = budgets.map(b => {
    const cat = categoryById.get(b.categoryId);
    if (!cat || cat.type === 'income') return null;
    const budgeted = monthlyAmount(b.amount, b.frequency) * periodMonths;
    const actual = Math.abs(periodTx
      .filter(t => t.type === 'expense' && (t.categoryId === b.categoryId || (categoryById.get(t.categoryId) || {}).parentId === b.categoryId))
      .reduce((s, t) => s + t.amount, 0));
    return { label: cat.name, icon: cat.icon || '', budgeted, actual };
  }).filter(Boolean).slice(0, 8);

  // --- Payment method proxy: expense split by account type ---
  const paymentMethod = new Map();
  periodTx.filter(t => t.type === 'expense').forEach(t => {
    const acc = accountBalances.find(a => a.id === t.accountId);
    const label = acc ? (ACCOUNT_TYPE_LABELS[acc.type] || acc.type) : 'Other';
    paymentMethod.set(label, (paymentMethod.get(label) || 0) + Math.abs(t.amount));
  });
  const paymentMethodRows = [...paymentMethod.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return {
    year, totalIncome, totalExpense, netSavings, savingsRatePct, budgetUtilPct, currentBalance,
    monthlySeries, expenseBreakdown, incomeBreakdown, goals, savingsProgress, byAccount,
    budgetVsActual, paymentMethodRows, accountTypesPresent, annualData, investments,
    planningItems: wealthData.planningItems, overallPercent: wealthData.overallPercent,
    yearsAvailable
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBanner() {
  const greeting = getGreeting();
  return `
    <div class="pfd-banner">
      <div class="pfd-banner-left">
        <div class="pfd-banner-badge">${greeting.icon}</div>
        <div class="pfd-banner-icon-box">💰</div>
        <div>
          <h1 class="pfd-banner-title">DASHERS FINANCE MANAGER</h1>
          <p class="pfd-banner-sub">Track your income, expenses, savings &amp; budget in one place</p>
        </div>
      </div>
      <div class="pfd-banner-right">
        <div class="pfd-banner-welcome">
          <span class="pfd-banner-greeting">${escapeHtml(greetWithName(greeting.text, getDisplayName(), '!'))}</span>
          <span class="pfd-banner-clock" id="pfdClock">—</span>
        </div>
        <button class="pfd-refresh-btn" id="pfdRefreshBtn" title="Refresh dashboard">🔄</button>
        <div class="pfd-banner-logo">📊</div>
      </div>
    </div>
  `;
}

function kpi(icon, colorClass, label, value, sublabel) {
  return `
    <div class="pfd-kpi">
      <div class="pfd-kpi-badge ${colorClass}">${icon}</div>
      <div class="pfd-kpi-body">
        <span class="pfd-kpi-label">${label}</span>
        <span class="pfd-kpi-value">${value}</span>
        <span class="pfd-kpi-sub">${sublabel}</span>
      </div>
    </div>
  `;
}

function renderKPIRow(data) {
  const periodLabel = selectedMonth !== null ? `${MONTH_LABELS[selectedMonth]} ${data.year}` : `${data.year} (full year)`;
  return `
    <div class="pfd-kpi-row">
      ${kpi('⬆️', 'pfd-badge-teal', 'Total Income', money(data.totalIncome), periodLabel)}
      ${kpi('⬇️', 'pfd-badge-green', 'Total Expenses', money(data.totalExpense), periodLabel)}
      ${kpi('➕', 'pfd-badge-blue', 'Net Savings', money(data.netSavings), 'Income minus expenses')}
      ${kpi('%', 'pfd-badge-darkteal', 'Savings Rate', `${data.savingsRatePct.toFixed(1)}%`, 'Of total income')}
      ${kpi('🎯', 'pfd-badge-orange', 'Budget Utilization', `${Math.min(999, data.budgetUtilPct).toFixed(1)}%`, 'Spent vs budgeted')}
      ${kpi('💰', 'pfd-badge-navy', 'Current Balance', money(data.currentBalance), 'All included accounts')}
    </div>
  `;
}

let accountsMenuOpen = false; // persists the Accounts dropdown's open/closed state across rerenders

function renderFilterBar(data) {
  const currentMonthIdx = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const includedCount = data.accountTypesPresent.filter(t => !excludedAccountTypes.has(t)).length;
  return `
    <div class="pfd-filter-bar">
      <div class="pfd-filter-group">
        <label for="pfdYearSelect">Year</label>
        <select id="pfdYearSelect" class="pfd-filter-select">
          ${data.yearsAvailable.map(y => `
            <option value="${y}" ${selectedYear === y ? 'selected' : ''}>${y}${y === currentYear ? ' (current)' : ''}</option>
          `).join('')}
        </select>
      </div>
      <div class="pfd-filter-group">
        <label for="pfdMonthSelect">Month</label>
        <select id="pfdMonthSelect" class="pfd-filter-select">
          <option value="all" ${selectedMonth === null ? 'selected' : ''}>Full Year</option>
          ${MONTH_LABELS.map((m, idx) => {
            const isCurrent = idx === currentMonthIdx && selectedYear === currentYear;
            return `<option value="${idx}" ${selectedMonth === idx ? 'selected' : ''}>${m}${isCurrent ? ' (current)' : ''}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="pfd-filter-group">
        <label>Accounts</label>
        <details class="pfd-accounts-dropdown" ${accountsMenuOpen ? 'open' : ''}>
          <summary class="pfd-filter-select pfd-accounts-summary">${includedCount}/${data.accountTypesPresent.length} shown</summary>
          <div class="pfd-accounts-menu">
            ${data.accountTypesPresent.map(t => `
              <label class="pfd-accounts-menu-item">
                <input type="checkbox" data-account-type="${t}" ${excludedAccountTypes.has(t) ? '' : 'checked'}>
                ${ACCOUNT_TYPE_LABELS[t] || t}
              </label>
            `).join('')}
          </div>
        </details>
      </div>
    </div>
  `;
}

function cardShell({ id, title, subtitle = '', canvasId, highlight = false, extraClass = '', footer = '' }) {
  return `
    <div class="pfd-card ${extraClass} ${highlight ? 'pfd-card-highlight' : ''}" ${id ? `id="${id}"` : ''}>
      <div class="pfd-card-header">
        <span class="pfd-card-title">${title}</span>
        ${subtitle ? `<span class="pfd-card-subtitle">${subtitle}</span>` : ''}
      </div>
      <div class="pfd-chart-wrap"><canvas id="${canvasId}"></canvas></div>
      ${footer}
    </div>
  `;
}

function emptyState(msg) {
  return `<div class="pfd-empty">${escapeHtml(msg)}</div>`;
}

// Wealth Planning Progress — ported from the old Wealth Overview page's
// "section 7": a composite ring (average of the 5 planning items below)
// plus each item's own thin progress bar. Not chart-based, so it's built
// as plain HTML rather than through cardShell()/Chart.js.
function renderWealthPlanningCard(data) {
  const circumference = 2 * Math.PI * 54;
  const pct = Math.max(0, Math.min(100, data.overallPercent));
  const offset = circumference * (1 - pct / 100);
  return `
    <div class="pfd-card pfd-item-wealth-planning">
      <div class="pfd-card-header">
        <span class="pfd-card-title">Wealth Planning Progress</span>
        <span class="pfd-card-subtitle">Emergency fund, debt, investments, retirement &amp; goals</span>
      </div>
      <div class="pfd-wealth-planning-layout">
        <div class="pfd-wealth-ring-wrap">
          <svg viewBox="0 0 120 120" class="pfd-wealth-ring">
            <circle cx="60" cy="60" r="54" class="pfd-wealth-ring-track" />
            <circle cx="60" cy="60" r="54" class="pfd-wealth-ring-fill"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" />
          </svg>
          <div class="pfd-wealth-ring-label">
            <div class="pfd-wealth-ring-percent">${Math.round(pct)}%</div>
            <div class="pfd-wealth-ring-caption">Overall Progress</div>
          </div>
        </div>
        <div class="pfd-wealth-items">
          ${data.planningItems.map(item => `
            <div class="pfd-wealth-item">
              <span class="pfd-wealth-item-label">${escapeHtml(item.label)}</span>
              <div class="pfd-progress-track thin"><div class="pfd-progress-fill" style="width:${Math.max(0, Math.min(100, item.percent))}%"></div></div>
              <span class="pfd-wealth-item-status">${item.done ? 'Completed' : Math.round(item.percent) + '%'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderCharts(data) {
  return `
    ${cardShell({ title: 'Monthly Income vs Expense', canvasId: 'pfdIncomeExpense', extraClass: 'pfd-item-income-expense' })}
    ${cardShell({ title: 'Expense by Category', canvasId: 'pfdExpenseDonut', extraClass: 'pfd-item-expense-donut' })}
    ${cardShell({
      title: 'Savings Goals', subtitle: 'Saved vs remaining', canvasId: 'pfdGoals', extraClass: 'pfd-item-goals',
      footer: `
        <div class="pfd-goal-manage-list">
          ${data.goals.map(g => `
            <span class="pfd-goal-manage-row">
              ${escapeHtml(g.name)}
              ${g.builtin
                ? `<button class="pfd-link-btn" data-action="pfd-edit-target" data-key="emergencyFundGoal">Edit goal</button>`
                : `<button class="pfd-link-btn" data-action="pfd-edit-goal" data-id="${g.id}">Edit</button><button class="pfd-link-btn danger" data-action="pfd-delete-goal" data-id="${g.id}">Remove</button>`
              }
            </span>
          `).join('')}
        </div>
        <div class="pfd-card-actions"><button class="pfd-link-btn" data-action="pfd-add-goal">+ Add a goal</button></div>
      `
    })}
    ${cardShell({ title: 'Savings Progress', canvasId: 'pfdSavingsProgress', extraClass: 'pfd-item-savings-progress' })}

    ${cardShell({ title: 'Income by Category', canvasId: 'pfdIncomeByCategory', extraClass: 'pfd-item-income-cat' })}
    ${cardShell({ title: 'By Account', canvasId: 'pfdByAccount', extraClass: 'pfd-item-by-account' })}
    ${cardShell({ title: 'Budget vs Actual', canvasId: 'pfdBudgetVsActual', extraClass: 'pfd-item-budget-actual', highlight: true })}
    ${cardShell({ title: 'Payment Method (Expenses)', canvasId: 'pfdPaymentMethod', extraClass: 'pfd-item-payment-method' })}

    ${cardShell({ title: 'Annual Net Savings', subtitle: 'Income minus expenses, by calendar year', canvasId: 'pfdAnnualPlans', extraClass: 'pfd-item-annual-plans' })}
    ${cardShell({
      title: 'Investments & Retirement', canvasId: 'pfdInvestments', extraClass: 'pfd-item-investments',
      footer: `
        <div class="pfd-investments-footer">
          <span>Retirement in ${data.investments.yearsToGo} yrs (age ${data.investments.retirementAge}) · est. ${money(data.investments.estMonthlyRetirementIncome)}/mo</span>
          <button class="pfd-link-btn" data-action="pfd-edit-target" data-key="retirementAge">Edit targets</button>
        </div>
      `
    })}
    ${renderWealthPlanningCard(data)}
  `;
}

function render(data) {
  const mainContent = document.getElementById('mainContent');
  mainContent.classList.add('page-transition');
  mainContent.innerHTML = `
    <div class="pfd-dashboard">
      ${renderBanner()}
      ${renderFilterBar(data)}
      ${renderKPIRow(data)}
      <div class="pfd-grid">
        ${renderCharts(data)}
      </div>
    </div>
  `;
  attachBehavior(data);
  renderAllCharts(data);
  startClock();
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function renderAllCharts(data) {
  Object.keys(pfdCharts).forEach(destroyPFDChart);

  // Monthly Income vs Expense
  const lineCanvas = document.getElementById('pfdIncomeExpense');
  if (lineCanvas) {
    pfdCharts.pfdIncomeExpense = new Chart(lineCanvas, {
      type: 'line',
      data: {
        labels: data.monthlySeries.map(m => m.label),
        datasets: [
          { label: 'Income', data: data.monthlySeries.map(m => m.income), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', tension: 0.35, fill: false },
          { label: 'Expense', data: data.monthlySeries.map(m => m.expense), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.35, fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => compactMoney(v) } } } }
    });
  }

  // Expense by Category (donut)
  const expenseCanvas = document.getElementById('pfdExpenseDonut');
  if (expenseCanvas) {
    if (data.expenseBreakdown.length === 0) {
      expenseCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No expenses recorded for this period.');
    } else {
      pfdCharts.pfdExpenseDonut = new Chart(expenseCanvas, {
        type: 'doughnut',
        data: {
          labels: data.expenseBreakdown.map(c => c.name),
          datasets: [{ data: data.expenseBreakdown.map(c => c.amount), backgroundColor: PALETTE }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }
  }

  // Savings Goals: saved vs remaining (stacked)
  const goalsCanvas = document.getElementById('pfdGoals');
  if (goalsCanvas) {
    if (data.goals.length === 0) {
      goalsCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No savings goals set yet.');
    } else {
      pfdCharts.pfdGoals = new Chart(goalsCanvas, {
        type: 'bar',
        data: {
          labels: data.goals.map(g => g.name),
          datasets: [
            { label: 'Saved', data: data.goals.map(g => g.current), backgroundColor: '#16a34a', borderRadius: 4, stack: 'g' },
            { label: 'Remaining', data: data.goals.map(g => g.remaining), backgroundColor: '#e2e6ee', borderRadius: 4, stack: 'g' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => compactMoney(v) } } }
        }
      });
    }
  }

  // Savings Progress
  const progressCanvas = document.getElementById('pfdSavingsProgress');
  if (progressCanvas) {
    if (data.savingsProgress.length === 0) {
      progressCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No non-credit accounts to show yet.');
    } else {
      pfdCharts.pfdSavingsProgress = new Chart(progressCanvas, {
        type: 'bar',
        data: {
          labels: data.savingsProgress.map(a => a.label),
          datasets: [{ label: 'Balance', data: data.savingsProgress.map(a => a.value), backgroundColor: '#0f766e', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => compactMoney(v) } } } }
      });
    }
  }

  // Income by Category
  const incomeCatCanvas = document.getElementById('pfdIncomeByCategory');
  if (incomeCatCanvas) {
    if (data.incomeBreakdown.length === 0) {
      incomeCatCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No income recorded for this period.');
    } else {
      pfdCharts.pfdIncomeByCategory = new Chart(incomeCatCanvas, {
        type: 'bar',
        data: {
          labels: data.incomeBreakdown.map(c => c.name),
          datasets: [{ label: 'Income', data: data.incomeBreakdown.map(c => c.amount), backgroundColor: '#16a34a', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => compactMoney(v) } } } }
      });
    }
  }

  // By Account (pie)
  const byAccountCanvas = document.getElementById('pfdByAccount');
  if (byAccountCanvas) {
    if (data.byAccount.length === 0) {
      byAccountCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No accounts to show yet.');
    } else {
      pfdCharts.pfdByAccount = new Chart(byAccountCanvas, {
        type: 'pie',
        data: {
          labels: data.byAccount.map(a => a.label),
          datasets: [{ data: data.byAccount.map(a => Math.abs(a.value)), backgroundColor: PALETTE }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }
  }

  // Budget vs Actual
  const budgetCanvas = document.getElementById('pfdBudgetVsActual');
  if (budgetCanvas) {
    if (data.budgetVsActual.length === 0) {
      budgetCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No budgets configured yet — set some up in Budgets.');
    } else {
      pfdCharts.pfdBudgetVsActual = new Chart(budgetCanvas, {
        type: 'bar',
        data: {
          labels: data.budgetVsActual.map(b => b.label),
          datasets: [
            { label: 'Actual Spent', data: data.budgetVsActual.map(b => b.actual), backgroundColor: '#1e3a5f', borderRadius: 4 },
            { label: 'Budget Allocated', data: data.budgetVsActual.map(b => b.budgeted), backgroundColor: '#eab308', borderRadius: 4 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => compactMoney(v) } } } }
      });
    }
  }

  // Payment Method (Expenses)
  const paymentCanvas = document.getElementById('pfdPaymentMethod');
  if (paymentCanvas) {
    if (data.paymentMethodRows.length === 0) {
      paymentCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('No expenses recorded for this period.');
    } else {
      pfdCharts.pfdPaymentMethod = new Chart(paymentCanvas, {
        type: 'bar',
        data: {
          labels: data.paymentMethodRows.map(r => r.label),
          datasets: [{ label: 'Spent', data: data.paymentMethodRows.map(r => r.value), backgroundColor: '#2563eb', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { callback: v => compactMoney(v) } } }
        }
      });
    }
  }

  // Annual Plans: net savings by year
  const annualCanvas = document.getElementById('pfdAnnualPlans');
  if (annualCanvas) {
    if (data.annualData.length === 0) {
      annualCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('Not enough transaction history yet.');
    } else {
      pfdCharts.pfdAnnualPlans = new Chart(annualCanvas, {
        type: 'bar',
        data: {
          labels: data.annualData.map(y => y.year),
          datasets: [{ label: 'Net Savings', data: data.annualData.map(y => y.netSavings), backgroundColor: data.annualData.map(y => y.netSavings >= 0 ? '#16a34a' : '#dc2626'), borderRadius: 4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            // A single bar per year with no axis title reads as an
            // unlabeled mystery figure — this spells out exactly what
            // it is on hover, matching the clearer card title/subtitle.
            tooltip: { callbacks: { label: ctx => `Net savings: ${money(ctx.parsed.y)}` } }
          },
          scales: { y: { title: { display: true, text: `Net savings (${currencySymbol()})` }, ticks: { callback: v => compactMoney(v) } } }
        }
      });
    }
  }

  // Investments & Retirement: contributions vs goals, plus portfolio split
  const investCanvas = document.getElementById('pfdInvestments');
  if (investCanvas) {
    const inv = data.investments;
    const hasAllocation = Object.keys(inv.allocation || {}).length > 0;
    if (!hasAllocation && inv.investmentContributionsYTD === 0 && inv.superContributionsYTD === 0) {
      investCanvas.closest('.pfd-chart-wrap').innerHTML = emptyState('Add investment/super contributions or account balances to see this.');
    } else if (hasAllocation) {
      pfdCharts.pfdInvestments = new Chart(investCanvas, {
        type: 'doughnut',
        data: {
          labels: Object.keys(inv.allocation).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
          datasets: [{ data: Object.values(inv.allocation), backgroundColor: PALETTE }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    } else {
      pfdCharts.pfdInvestments = new Chart(investCanvas, {
        type: 'bar',
        data: {
          labels: [`Investments (${data.year})`, `Super (${data.year})`],
          datasets: [
            { label: 'Contributed', data: [inv.investmentContributionsYTD, inv.superContributionsYTD], backgroundColor: '#16a34a', stack: 'g', borderRadius: 4 },
            { label: 'Remaining to goal', data: [Math.max(inv.investmentAnnualGoal - inv.investmentContributionsYTD, 0), Math.max(inv.superAnnualGoal - inv.superContributionsYTD, 0)], backgroundColor: '#e2e6ee', stack: 'g', borderRadius: 4 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => compactMoney(v) } } } }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

function attachBehavior() {
  const mainContent = document.getElementById('mainContent');

  const yearSelect = document.getElementById('pfdYearSelect');
  if (yearSelect) {
    yearSelect.addEventListener('change', () => {
      selectedYear = parseInt(yearSelect.value, 10);
      rerender();
    });
  }

  const monthSelect = document.getElementById('pfdMonthSelect');
  if (monthSelect) {
    monthSelect.addEventListener('change', () => {
      selectedMonth = monthSelect.value === 'all' ? null : parseInt(monthSelect.value, 10);
      rerender();
    });
  }

  // Tracked separately from a full rerender so opening the Accounts
  // dropdown to tick a box doesn't lose its own open state the moment
  // the checkbox change triggers a rerender.
  const accountsDetails = mainContent.querySelector('.pfd-accounts-dropdown');
  if (accountsDetails) {
    accountsDetails.addEventListener('toggle', () => {
      accountsMenuOpen = accountsDetails.open;
    });
  }

  mainContent.querySelectorAll('.pfd-accounts-menu input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const type = cb.getAttribute('data-account-type');
      if (cb.checked) excludedAccountTypes.delete(type);
      else excludedAccountTypes.add(type);
      rerender();
    });
  });

  const refreshBtn = document.getElementById('pfdRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => { initFinancialDashboardUI(); });
  }

  mainContent.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'pfd-add-goal') {
      const name = prompt('Goal name (e.g. Buy a House):');
      if (!name) return;
      const target = parseFloat(prompt('Target amount:', '10000'));
      if (!target || target <= 0) return;
      const current = parseFloat(prompt('Current amount saved toward this goal:', '0')) || 0;
      const goals = loadGoals();
      goals.push({ id: `goal_${Date.now()}`, name, target, current });
      saveGoals(goals);
      initFinancialDashboardUI();
      return;
    }

    if (action === 'pfd-edit-goal') {
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
      initFinancialDashboardUI();
      return;
    }

    if (action === 'pfd-delete-goal') {
      if (!confirm('Remove this goal?')) return;
      const goals = loadGoals().filter(g => g.id !== btn.dataset.id);
      saveGoals(goals);
      initFinancialDashboardUI();
      return;
    }

    if (action === 'pfd-edit-target') {
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
      initFinancialDashboardUI();
      return;
    }
  });
}

function rerender() {
  if (!pfdRaw) return;
  const data = computePFDData(pfdRaw);
  render(data);
}

function startClock() {
  if (pfdClockTimer) clearInterval(pfdClockTimer);
  const tick = () => {
    const el = document.getElementById('pfdClock');
    if (!el) { clearInterval(pfdClockTimer); return; }
    el.textContent = new Date().toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };
  tick();
  pfdClockTimer = setInterval(tick, 30000);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function initFinancialDashboardUI() {
  const mainContent = document.getElementById('mainContent');
  mainContent.classList.add('page-transition');
  mainContent.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading financial dashboard...</p></div>';

  const [accounts, transactions, categories, budgets, loans, properties, bills] = await Promise.all([
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.transactions).catch(() => []),
    getAllItems(STORE_NAMES.categories).catch(() => []),
    getAllItems(STORE_NAMES.budgets).catch(() => []),
    getAllItems(STORE_NAMES.loans).catch(() => []),
    getGatedItems(STORE_NAMES.properties).catch(() => []),
    getAllItems(STORE_NAMES.bills).catch(() => [])
  ]);

  pfdRaw = { accounts, transactions, categories, budgets, loans, properties, bills };
  const data = computePFDData(pfdRaw);
  render(data);
}

export function cleanupFinancialDashboard() {
  if (pfdClockTimer) { clearInterval(pfdClockTimer); pfdClockTimer = null; }
  Object.keys(pfdCharts).forEach(destroyPFDChart);
}
