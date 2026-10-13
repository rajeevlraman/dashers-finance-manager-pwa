import { getAllItems, STORE_NAMES } from './db.js';
import {
  renderTransactionFormHTML,
  setupCategoryLinking,
  setupFormHandlers,
  togglePropertyExpenseFields
} from './transactions.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalance, computeAccountBalanceAsOf } from './accountBalance.js';
import { renderQuickLookHTML, attachQuickLookBehavior, cleanupQuickLook, setQuickLookPeriodChangeHandler, resolveCreditAsOfStr, getNextDayOfMonthOccurrence } from './quickLook.js';
import { computeAccountsHealth, renderAccountsHealthGauge, renderAccountsFactorRow } from './accounts.js';
import { computeWealthData, loadTargets, saveTargets } from './wealthOverview.js';
import { transactionMatchesBudgetCategory, getPeriodRange, formatPeriodLabel, convertAmount } from './budgets.js';
import { renderHeroSection, attachHeroBehavior, isHeroModeOn, setHeroMode } from './heroDashboard.js';
import { getLoanPayoffStatus } from './loans.js';
import { getTotalSuperBalance } from './superannuation.js';

import { currencySymbol, formatMoney, getBaseCurrency, recordCurrency, toBase, toBaseTransactions, propertyAmountInBase, propertyCurrency } from './utils/currency.js';
// Chart instances stored globally
let catChart = null;
let trendChart = null;
let summaryChart = null;
let netWorthChart = null;
let autoRefreshInterval = null;

// Period-nav state for the "Budget Performance" section — module-level so
// it survives across initDashboardTabsUI() re-renders (view mode change,
// prev/next clicks, and any of the dashboard's other re-render triggers
// like Live Refresh or the wealth-target editor), the same pattern used
// on the Budgets page. Resets to 0 whenever the view mode changes, since
// an offset meaningful for "weeks back" isn't meaningful for "quarters
// back".
let budgetPanelPeriodOffset = 0;
let lastBudgetPanelViewMode = null;

// Month offset for the dashboard's own "current period" stats (Financial
// Health, Cash Flow, Savings Rate, Top Spending Categories, the toolbar's
// "This Month" figure). Previously these were always hardcoded to the
// real calendar month with no way to look back — this lets the whole
// dashboard step to a prior month the same way the Budget Performance
// panel already could. 0 = the real current month. Module-level so it
// survives re-renders, same pattern as budgetPanelPeriodOffset above.
let dashboardMonthOffset = 0;

// Global functions for HTML interactions

// Collapsed-section state persisted to localStorage (same pattern as
// 'dashboardFilters' below) — without this, every re-render (month/year
// change, filter change, or Live Refresh's 30s interval, which calls
// initDashboardTabsUI() wholesale) rebuilds every .expandable-section from
// scratch with no memory of what the user had collapsed, silently
// re-expanding all 8 sections. That's what made this "already an
// accordion" page still feel like the longest scroll in the app.
const DASHBOARD_COLLAPSED_SECTIONS_KEY = 'dashboardCollapsedSections';

function getCollapsedSections() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DASHBOARD_COLLAPSED_SECTIONS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function setSectionCollapsed(sectionId, collapsed) {
  const set = getCollapsedSections();
  if (collapsed) set.add(sectionId); else set.delete(sectionId);
  localStorage.setItem(DASHBOARD_COLLAPSED_SECTIONS_KEY, JSON.stringify([...set]));
}

window.toggleSection = function(header) {
  const content = header.nextElementSibling;
  const icon = header.querySelector('.toggle-icon');
  const collapsing = content.style.display !== 'none';
  content.style.display = collapsing ? 'none' : 'block';
  icon.textContent = collapsing ? '▼' : '▲';

  const sectionId = header.closest('.expandable-section')?.dataset.sectionId;
  if (sectionId) setSectionCollapsed(sectionId, collapsing);
};

// Tab switching for the grouped-tabs comparison layout. Persisted
// separately from the accordion page's collapsed-section state (different
// key) so the two pages can be compared without one page's navigation
// affecting the other's remembered state.
const DASHBOARD_TABS_ACTIVE_KEY = 'dashboardTabsActiveTab';

window.switchDashboardTab = function(btn) {
  const target = btn.dataset.tabTarget;
  const bar = btn.closest('.dashboard-tab-bar');
  bar.querySelectorAll('.dashboard-tab-btn').forEach(b => b.classList.toggle('active', b === btn));

  const container = bar.parentElement;
  container.querySelectorAll('.tab-panel').forEach(panel => {
    panel.style.display = panel.dataset.tabPanel === target ? 'block' : 'none';
  });

  localStorage.setItem(DASHBOARD_TABS_ACTIVE_KEY, target);
};

window.showDrillDownModal = function(label, data) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Details: ${label}</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <pre>${JSON.stringify(data, null, 2)}</pre>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

export async function initDashboardTabsUI() {
  const mainContent = document.getElementById('mainContent');

  // Preserve scroll position across re-renders. Every nav click (month
  // picker, budget period, filters, Live Refresh's 30s interval) calls
  // this same function and rebuilds the whole page's HTML from scratch —
  // previously that always snapped the user back to the top, which was
  // especially jarring for Live Refresh firing under someone's thumb.
  const isInitialRender = !mainContent.dataset.dashboardRendered;
  const scrollPos = window.scrollY;

  mainContent.classList.add('page-transition');
  // Only show the spinner on the very first load. On a re-render the old
  // content is still valid to look at while fresh data loads (usually a
  // few ms from IndexedDB) — replacing it with a much-shorter spinner div
  // was what collapsed the page height and threw scroll position away in
  // the first place.
  if (isInitialRender) {
    mainContent.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading dashboard...</p></div>';
  }

  try {
    // === Fetch all core + property data ===
    let [transactionsRaw, bills, categories, properties, tenants, loans, maintenance, accounts, budgets, recurringTx, superFunds, superBalanceHistory] = await Promise.all([
      getAllItems(STORE_NAMES.transactions),
      getAllItems(STORE_NAMES.bills),
      getAllItems(STORE_NAMES.categories),
      getAllItems(STORE_NAMES.properties || 'properties').catch(() => []),
      getAllItems(STORE_NAMES.tenants || 'tenants').catch(() => []),
      getAllItems(STORE_NAMES.loans || 'loans').catch(() => []),
      getAllItems(STORE_NAMES.maintenance || 'maintenance').catch(() => []),
      getAllItems(STORE_NAMES.accounts).catch(() => []),
      getAllItems(STORE_NAMES.budgets).catch(() => []),
      getAllItems(STORE_NAMES.recurringTransactions).catch(() => []),
      getAllItems(STORE_NAMES.superFunds).catch(() => []),
      getAllItems(STORE_NAMES.superBalanceHistory).catch(() => [])
    ]);
    // Bills / recurring rules are paid from an account: carry its currency.
    bills = bills.map(b => ({ ...b, currency: recordCurrency(b, accounts) }));
    recurringTx = recurringTx.map(r => ({ ...r, currency: recordCurrency(r, accounts) }));

    // Apply any saved dashboard filters (property/category/date range).
    // Previously "Apply Filters" saved these to localStorage and then did
    // a full location.reload() — a jarring full app restart — and even
    // after reloading, nothing ever actually read this saved value back
    // out, so the filters never did anything either. Now they're read
    // here and applied to the transaction list every time the dashboard
    // renders, no reload needed.
    const dashboardFilters = JSON.parse(localStorage.getItem('dashboardFilters') || 'null');
    const transactions = !dashboardFilters ? transactionsRaw : transactionsRaw.filter(t => {
      if (dashboardFilters.propertyFilter && dashboardFilters.propertyFilter !== 'all' && t.propertyId !== dashboardFilters.propertyFilter) return false;
      if (dashboardFilters.categoryFilter && dashboardFilters.categoryFilter !== 'all' && t.categoryId !== dashboardFilters.categoryFilter) return false;
      if (dashboardFilters.dateFrom && t.date < dashboardFilters.dateFrom) return false;
      if (dashboardFilters.dateTo && t.date > dashboardFilters.dateTo) return false;
      return true;
    });
    // Flow figures (income/expense/budgets/trends) are summed in the base currency;
    // balances keep using the raw `transactions` so each account stays in its own.
    const flowTx = toBaseTransactions(transactions, accounts);

    // === Current period calculations ===
    // "currentMonth" is really "the selected month" — offset from today by
    // dashboardMonthOffset via the Financial Health section's ‹ › nav.
    const dashboardMonthDate = new Date();
    dashboardMonthDate.setDate(1); // avoid month-length skew (e.g. Mar 31 - 1 month)
    dashboardMonthDate.setMonth(dashboardMonthDate.getMonth() + dashboardMonthOffset);
    const currentMonth = `${dashboardMonthDate.getFullYear()}-${String(dashboardMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const isCurrentCalendarMonth = dashboardMonthOffset === 0;
    const selectedMonthLabel = dashboardMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const currentMonthIncome = flowTx
      .filter(t => t.type === 'income' && !t.isTransfer && t.date?.startsWith(currentMonth))
      .reduce((sum, t) => sum + t.amount, 0);
    const currentMonthExpenses = flowTx
      .filter(t => t.type === 'expense' && !t.isTransfer && t.date?.startsWith(currentMonth))
      .reduce((sum, t) => sum + t.amount, 0);
    // currentMonthExpenses is already negative (expense amounts are stored
    // negative), so balance is the sum, not income minus expenses.
    const currentMonthBalance = currentMonthIncome + currentMonthExpenses;

    // === Financial totals ===
    // Transfers between your own accounts (isTransfer: true) are excluded
    // here — they're not real income or spending, just money moving from
    // one of your accounts to another, and would otherwise double-count.
    const income = flowTx.filter(t => t.type === 'income' && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
    const expenses = flowTx.filter(t => t.type === 'expense' && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
    const balance = income + expenses;

    // === Account balances ===
    // Computed live from each account's opening balance + its transaction
    // history (see js/accountBalance.js) rather than a static stored
    // number, so this reflects real activity including transfers, bill
    // auto-pay, and loan payments.
    const totalCashBalance = accounts.reduce((sum, acc) => sum + toBase(computeAccountBalance(acc, transactions), acc.currency), 0);
    const totalCreditBalance = accounts
      .filter(acc => acc.type === 'credit')
      .reduce((sum, acc) => sum + toBase(computeAccountBalance(acc, transactions), acc.currency), 0);

    // === Credit card summary (for the Hero Dashboard's Credit Card card) ===
    // Balances "as of" the selected month, resolved the exact same way as
    // Quick Look's credit card (see resolveCreditAsOfStr in
    // js/quickLook.js): pegged to each card's own statement-close day
    // within the selected month, not the generic calendar month-end.
    // These used to disagree — this card was using plain month-end for
    // every account type including credit, so "March" here and "March" in
    // Quick Look silently meant two different closing dates and produced
    // two different balances for what looked like the same selection.
    // Reusing the one shared function keeps them in agreement. Per-account
    // owed/available first, then summed — same approach as Quick Look's
    // creditAccounts — rather than deriving owed straight from
    // totalCreditBalance above, so a card that's in credit (paid more than
    // it owes, a positive balance) can't silently offset a different
    // card's real debt when there's more than one.
    const todayStr = new Date().toISOString().slice(0, 10);
    const dashboardMonthAsOfStr = isCurrentCalendarMonth
      ? todayStr
      : new Date(dashboardMonthDate.getFullYear(), dashboardMonthDate.getMonth() + 1, 0).toISOString().slice(0, 10);
    const dashboardPeriodOpt = {
      isCurrent: isCurrentCalendarMonth,
      monthYear: dashboardMonthDate.getFullYear(),
      monthIndex: dashboardMonthDate.getMonth(),
      accountAsOfStr: dashboardMonthAsOfStr
    };
    const creditCardAccounts = accounts.filter(acc => acc.type === 'credit');
    const totalCreditOwed = creditCardAccounts
      .reduce((sum, acc) => {
        const asOfStr = resolveCreditAsOfStr(dashboardPeriodOpt, acc.statementCloseDay, todayStr);
        return sum + Math.abs(Math.min(computeAccountBalanceAsOf(acc, transactions, asOfStr), 0));
      }, 0);
    const totalCreditLimit = creditCardAccounts.reduce((sum, acc) => sum + (parseFloat(acc.creditLimit) || 0), 0);
    const totalCreditAvailable = creditCardAccounts
      .reduce((sum, acc) => {
        const asOfStr = resolveCreditAsOfStr(dashboardPeriodOpt, acc.statementCloseDay, todayStr);
        const bal = computeAccountBalanceAsOf(acc, transactions, asOfStr);
        const limit = parseFloat(acc.creditLimit) || 0;
        return sum + (limit > 0 ? Math.max(limit + bal, 0) : 0);
      }, 0);
    const creditUtilizationPct = totalCreditLimit > 0 ? Math.min(100, (totalCreditOwed / totalCreditLimit) * 100) : 0;

    // === Property-specific calculations ===
    const totalValue = properties.reduce((sum, p) => sum + propertyAmountInBase(p, 'currentValue'), 0);
    const totalLoan = loans.reduce((sum, l) => sum + (parseFloat(l.currentBalance) || 0), 0);
    // A tenant's rent is in its property's currency (an overseas property is priced in its own).
    const totalRent = tenants.reduce((sum, t) => sum + toBase(parseFloat(t.rentAmount) || 0, propertyCurrency(properties.find(p => p.id === t.propertyId))), 0);
    // Actual rent received in the selected month (vs. totalRent above,
    // which is the agreed/expected rent from tenant records and doesn't
    // move with the month picker) — same category used by Quick Look's
    // "rent overdue" check, so the two stay consistent.
    const rentReceivedThisMonth = flowTx
      .filter(t => t.categoryId === 'sub_rental_income' && !t.isTransfer && t.date?.startsWith(currentMonth))
      .reduce((sum, t) => sum + t.amount, 0);
    const maintCost = maintenance.reduce((sum, m) => sum + (parseFloat(m.cost) || 0), 0);
    const avgROI = calcAvgROI(properties, tenants);
    const netPropertyWorth = totalValue - totalLoan;
    const totalSuperBalance = getTotalSuperBalance(superFunds, superBalanceHistory);
    // Bug fix: totalCashBalance is a sum over ALL accounts (see above),
    // which already includes credit accounts' negative balances — so
    // subtracting Math.abs(totalCreditBalance) again here was double-
    // counting every dollar of credit card debt. Also folds in super,
    // which used to be tracked on its own page and never reached net
    // worth at all, understating it for anyone with a super balance.
    const totalNetWorth = totalCashBalance + netPropertyWorth + totalSuperBalance;

    // === Budget performance ===
    const budgetPerformance = calculateBudgetPerformance(budgets, flowTx, currentMonth, categories);

    // === Budget Performance panel (period nav) ===
    // Reads the view-mode select from the previous render the same way
    // budgets.js does, so the choice survives across the re-renders this
    // page does constantly (Live Refresh, filters, wealth-target edits).
    // Without a period picker this panel only ever looked at the current
    // calendar month, so imported/historical transactions outside that
    // month never showed up and every budget just read $0.00 — the same
    // "amounts don't populate" bug the Budgets page had before its own
    // period nav was added.
    const budgetPanelViewMode = document.getElementById('budgetPanelViewMode')?.value || 'monthly';
    if (lastBudgetPanelViewMode !== null && lastBudgetPanelViewMode !== budgetPanelViewMode) {
      budgetPanelPeriodOffset = 0;
    }
    lastBudgetPanelViewMode = budgetPanelViewMode;

    const { start: budgetPanelPeriodStart, end: budgetPanelPeriodEnd } = getPeriodRange(budgetPanelViewMode, budgetPanelPeriodOffset);
    const budgetPanelPeriodLabel = formatPeriodLabel(budgetPanelViewMode, budgetPanelPeriodStart, budgetPanelPeriodEnd);
    const budgetPanelIsCurrentPeriod = budgetPanelPeriodOffset === 0;
    const budgetPanelPeriodStartISO = budgetPanelPeriodStart.toISOString();
    const budgetPanelPeriodEndISO = budgetPanelPeriodEnd.toISOString();

    // Same dynamic income-category detection the Budgets page uses, so an
    // income budget (e.g. Salary) is judged by "did I earn enough" rather
    // than "did I overspend".
    const budgetPanelIncomeCategoryIds = categories.filter(cat =>
      cat.type === 'income' ||
      cat.name?.toLowerCase().includes('salary') ||
      cat.name?.toLowerCase().includes('income')
    ).map(cat => cat.id);

    const budgetPanelRows = budgets.map(budget => {
      const isIncomeBudget = budgetPanelIncomeCategoryIds.includes(budget.categoryId);
      const spent = Math.abs(flowTx
        .filter(t => {
          const isCorrectType = isIncomeBudget ? t.type === 'income' : t.type === 'expense';
          return isCorrectType &&
            transactionMatchesBudgetCategory(t, budget.categoryId, categories) &&
            t.date >= budgetPanelPeriodStartISO && t.date < budgetPanelPeriodEndISO;
        })
        .reduce((sum, t) => sum + t.amount, 0));

      // Budgets are stored at whatever frequency they were set at (weekly,
      // monthly, yearly...) — normalize to the period currently being
      // viewed so a weekly grocery budget compares correctly against a
      // month's worth of spending, etc.
      const normalizedGoal = convertAmount(budget.amount || 0, budget.frequency || 'monthly', budgetPanelViewMode);
      const percentage = normalizedGoal > 0 ? Math.min((spent / normalizedGoal) * 100, 100) : 0;
      const onTrack = isIncomeBudget ? spent >= normalizedGoal : spent <= normalizedGoal;
      const budgetCategory = categories.find(c => c.id === budget.categoryId);
      const budgetLabel = budget.name || budgetCategory?.name || 'Unknown';

      return {
        label: budgetLabel, icon: budgetCategory?.icon || '🎯', onTrack,
        row: renderHealthFactorRow(
          budgetCategory?.icon || '🎯', budgetLabel,
          `${formatMoney(spent)} / ${formatMoney(normalizedGoal)}`,
          percentage, onTrack ? 'var(--success)' : 'var(--danger)'
        )
      };
    });

    // === Bill alerts (overdue + due within 7 days) ===
    const { overdueBills, dueSoonBills } = getBillAlerts(bills, 7);

    // === Upcoming recurring transactions (next 30 days) ===
    const upcomingRecurring = getUpcomingRecurring(recurringTx, 30);

    // === Top spending categories this month (feeds the merged
    // Top Spending Categories list + Expense Categories doughnut) ===
    const topCategories = getTopSpendingCategories(flowTx, categories, currentMonth, 8);

    // === Savings rate (this month) ===
    const savingsRate = currentMonthIncome > 0
      ? ((currentMonthBalance / currentMonthIncome) * 100)
      : 0;

    // === Month-over-month comparison ===
    const momChange = getMonthOverMonthChange(flowTx, currentMonth);

    // === Financial Health Score ===
    // A single composite 0-100 score blending four signals a real personal
    // finance app cares about: are you saving enough (guideline: ~20% of
    // income), are your budgets under control, is this month cash-flow
    // positive, and is your net worth in the black. Weighted so savings
    // habit + budget discipline (things you control month to month) count
    // for more than the net worth snapshot (which moves slowly).
    const financialHealth = computeFinancialHealthScore({
      savingsRate, budgetPerformance, currentMonthBalance, currentMonthIncome, totalNetWorth
    });

    // === Wealth data (retirement, insurance, goals composite) — reuses
    // the exact same computation as the Financial Dashboard so the two
    // pages never disagree. ===
    const wealthData = computeWealthData({ accounts, transactions, loans, properties, bills, categories });

    // === Next tax deadline ===
    const nextTaxDeadline = getNextTaxDeadline();

    // === Net worth trend (last 6 months; property/loan equity held at current value) ===
    const netWorthTrend = getNetWorthTrendSeries(flowTx, netPropertyWorth, totalCashBalance, 6, totalSuperBalance);

    // Default date for the Quick Add Transaction modal below.
    const today = new Date().toISOString().split('T')[0];

    // Read once per render so every .expandable-section below can check
    // synchronously whether it should render pre-collapsed.
    const collapsedSections = getCollapsedSections();

    // === Main HTML Layout ===
    mainContent.innerHTML = `
      <div class="pfd-page">
      <div class="dt-quicklook-peek" id="dtQuickLookPeek">
      ${renderQuickLookHTML({
        bills, accounts, loans, properties, transactions, categories, recurringTx,
        // Feeds Quick Look's own "Net This Month" card (same figures,
        // computed once above, that the New Look hero dashboard's Net
        // card uses) — reusing dashboardMonthOffset via the same
        // qlNetMonthPrevBtn/NextBtn/TodayBtn wiring as heroMonthPrevBtn
        // below, so the two controls (wherever both happen to be on
        // screen) always agree on which month they're showing.
        currentMonth, currentMonthIncome, currentMonthExpenses, currentMonthBalance,
        totalNetWorth, overBudgetCount: budgetPerformance.overBudgetCount,
        selectedMonthLabel, isCurrentCalendarMonth
      })}
      </div>
      <button type="button" class="dt-quicklook-peek-toggle" id="dtQuickLookPeekToggle" aria-expanded="false">Show all Quick Look cards ▾</button>
      <div class="page-container">
        <!-- Compact toolbar: key figures + actions in one slim row. No
             separate "Dashboard" title or date line here — the Quick Look
             banner above already shows the greeting and full date, so
             repeating a title only to it costs a whole row for zero new
             information. -->
        <div class="dashboard-toolbar">
          ${isHeroModeOn() ? '' : `
          <div class="dashboard-toolbar-stats">
            <div class="dashboard-toolbar-stat"><span class="dashboard-toolbar-stat-label">Net Worth</span><span class="dashboard-toolbar-stat-value">${formatMoney(totalNetWorth)}</span></div>
            <div class="dashboard-toolbar-stat"><span class="dashboard-toolbar-stat-label">Income</span><span class="dashboard-toolbar-stat-value">${formatMoney(income)}</span></div>
            <div class="dashboard-toolbar-stat"><span class="dashboard-toolbar-stat-label">Expenses</span><span class="dashboard-toolbar-stat-value">${formatMoney(Math.abs(expenses))}</span></div>
            <div class="dashboard-toolbar-stat"><span class="dashboard-toolbar-stat-label">${isCurrentCalendarMonth ? 'This Month' : escapeHtml(selectedMonthLabel)}</span><span class="dashboard-toolbar-stat-value ${currentMonthBalance >= 0 ? 'positive' : 'negative'}">${formatMoney(currentMonthBalance)}</span></div>
            ${budgetPerformance.overBudgetCount > 0 ? `
              <a href="#budgets" class="dashboard-toolbar-flag">🎯 ${budgetPerformance.overBudgetCount} budget${budgetPerformance.overBudgetCount > 1 ? 's' : ''} over limit</a>
            ` : ''}
          </div>
          `}
          <div class="dashboard-toolbar-actions">
            <button id="dashAddTxBtn" class="btn btn-primary btn-sm" title="Add Transaction">➕ Add Transaction</button>
            <button id="exportDashboard" class="btn btn-outline btn-sm" title="Export Data">📊 Export</button>
            <button id="liveRefresh" class="btn btn-outline btn-sm" title="Live Refresh">🔄 Live</button>
            <button id="heroModeToggle" class="btn btn-outline btn-sm" title="Toggle dashboard layout">${isHeroModeOn() ? '↩ Classic view' : '✨ New look'}</button>
          </div>
        </div>

        ${isHeroModeOn() ? renderHeroSection({
          flowTx, categories, budgets, bills, currentMonth,
          currentMonthIncome, currentMonthExpenses, currentMonthBalance,
          totalNetWorth, overBudgetCount: budgetPerformance.overBudgetCount,
          selectedMonthLabel, isCurrentCalendarMonth,
          totalCreditOwed, totalCreditLimit, totalCreditAvailable, creditUtilizationPct,
          creditCardCount: creditCardAccounts.length
        }) : ''}

        <!-- Add Transaction modal — the exact same form as the Transactions
             page (category + subcategory pickers, Property Expense/Rental
             Income section), not a cut-down duplicate, so property-linked
             entries and subcategories work identically from here. -->
        ${renderTransactionFormHTML({ categories, accounts, properties, today })}

        <!-- (Welcome banner removed — the Quick Look banner above already
             shows the greeting and date/time; this block's ids
             were never populated by any script.)

             (Alerts Banner removed — overdue/due-this-week bills already
             surface via Quick Look's "overdue" badge and Bill Reminders
             card right above; repeating them here was the same two facts
             twice. The one alert that had no home elsewhere — budgets
             over limit — moved into the toolbar row above instead of
             being dropped.) -->

        <!-- Filter Controls — collapsed by default so it's a single line
             ("🔍 Filters") until you actually need it, same space-saving
             dropdown idea as the Financial Dashboard's filter bar. Stays
             open automatically whenever a filter is already active. -->
        <details class="dashboard-filter-bar" ${dashboardFilters ? 'open' : ''}>
          <summary class="dashboard-filter-summary">
            <span>🔍 Filters</span>
            ${dashboardFilters ? '<span class="filter-active-badge">Filtered view</span>' : ''}
          </summary>
          <div class="dashboard-filter-body">
            <select id="propertyFilter">
              <option value="all">All Properties</option>
              ${properties.map(p => `<option value="${p.id}" ${dashboardFilters?.propertyFilter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>

            <select id="categoryFilter">
              <option value="all">All Categories</option>
              ${categories.map(c => `<option value="${c.id}" ${dashboardFilters?.categoryFilter === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>

            <input type="date" id="dateFrom" placeholder="From Date" value="${dashboardFilters?.dateFrom || ''}">
            <input type="date" id="dateTo" placeholder="To Date" value="${dashboardFilters?.dateTo || ''}">

            <button id="applyFilters" class="btn btn-primary">Apply Filters</button>
            <button id="resetFilters" class="btn btn-secondary">Reset</button>
          </div>
        </details>

        <div class="dashboard-compare-link">
          <a href="#dashboard">← Back to accordion layout</a>
        </div>
        <div class="dashboard-tab-bar" role="tablist">
          <button type="button" class="dashboard-tab-btn active" data-tab-target="overview" onclick="switchDashboardTab(this)">Overview</button>
          <button type="button" class="dashboard-tab-btn" data-tab-target="charts" onclick="switchDashboardTab(this)">Charts</button>
          <button type="button" class="dashboard-tab-btn" data-tab-target="bills-insurance" onclick="switchDashboardTab(this)">Bills &amp; Insurance</button>
          <button type="button" class="dashboard-tab-btn" data-tab-target="financial-overview" onclick="switchDashboardTab(this)">Financial Overview</button>
          <button type="button" class="dashboard-tab-btn" data-tab-target="property-retirement" onclick="switchDashboardTab(this)">Property &amp; Retirement</button>
          <button type="button" class="dashboard-tab-btn" data-tab-target="budget-spending" onclick="switchDashboardTab(this)">Budget &amp; Spending</button>
        </div>

        <!-- Bills, Recurring & Insurance — the two "things that need action
             soon" panels, promoted up to right after the filters instead
             of being buried below Financial Health/Accounts/Property/Loan/
             Retirement. Quick Look above already gives a compact glance at
             overdue bills and renewals; these are the fuller lists (5 items
             deep, with links to the full pages) so nothing shown there is
             lost — it's just given more room right where it's easy to spot. -->
<div class="tab-panel" data-tab-panel="bills-insurance" style="display:none">
        <div class="dashboard-two-col">
        <div class="expandable-section" data-section-id="bills-recurring">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🧾 Bills & Recurring</h3>
            <span class="toggle-icon">${collapsedSections.has('bills-recurring') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('bills-recurring') ? ' style="display:none"' : ''}>
            <h4 style="margin: 0 0 8px;">Upcoming Bills</h4>
            <div class="recent-activity">
              ${[...overdueBills, ...dueSoonBills].slice(0, 5).map(bill => {
                const isOverdue = new Date(bill.dueDate) < new Date(new Date().toDateString());
                return `
                  <div class="activity-item">
                    <span class="activity-icon">${isOverdue ? '⚠️' : '📄'}</span>
                    <div class="activity-details">
                      <div class="activity-desc">${escapeHtml(bill.name)}</div>
                      <div class="activity-date">${isOverdue ? 'Overdue: ' : 'Due: '}${new Date(bill.dueDate).toLocaleDateString()}</div>
                    </div>
                    <span class="activity-amount negative">-${formatMoney(bill.amount, bill.currency)}</span>
                  </div>
                `;
              }).join('')}
              ${(overdueBills.length + dueSoonBills.length) === 0 ? '<p class="no-data">No bills due soon</p>' : ''}
            </div>
            <div style="text-align: right; margin: 4px 0 16px;"><a href="#bills">View all bills →</a></div>

            <h4 style="margin: 0 0 8px;">Upcoming Recurring Transactions</h4>
            <div class="recent-activity">
              ${upcomingRecurring.slice(0, 5).map(rec => `
                <div class="activity-item">
                  <span class="activity-icon">${rec.type === 'income' ? '💹' : '🔁'}</span>
                  <div class="activity-details">
                    <div class="activity-desc">${escapeHtml(rec.name)}</div>
                    <div class="activity-date">Next: ${rec.nextDate.toLocaleDateString()} · ${escapeHtml(rec.frequency || '')}</div>
                  </div>
                  <span class="activity-amount ${rec.type === 'income' ? 'positive' : 'negative'}">
                    ${rec.type === 'income' ? '+' : '-'}${formatMoney(rec.amount, rec.currency)}
                  </span>
                </div>
              `).join('')}
              ${upcomingRecurring.length === 0 ? '<p class="no-data">No recurring transactions due in the next 30 days</p>' : ''}
            </div>
            <div style="text-align: right; margin-top: 4px;"><a href="#recurring">View all recurring →</a></div>
          </div>
        </div>

        <div class="expandable-section" data-section-id="insurance-review">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🛡️ Insurance Review</h3>
            <span class="toggle-icon">${collapsedSections.has('insurance-review') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('insurance-review') ? ' style="display:none"' : ''}>
            <div class="insurance-list">
              ${wealthData.insuranceBills.length === 0
                ? '<p class="no-data">No insurance bills on record yet</p>'
                : wealthData.insuranceBills.map(b => `
                  <div class="insurance-card ${b.isOverdue ? 'is-overdue' : 'is-covered'}">
                    <div class="insurance-card-top">
                      <div class="insurance-card-identity">
                        <span class="insurance-card-icon">${b.icon || '🛡️'}</span>
                        <div class="insurance-card-titles">
                          <span class="insurance-card-name">${escapeHtml(b.name)}</span>
                          ${b.subcategoryName ? `<span class="insurance-card-type">${escapeHtml(b.subcategoryName)}</span>` : ''}
                        </div>
                      </div>
                      <div class="insurance-card-right">
                        <span class="insurance-card-amount">${formatMoney(b.amount, b.currency)}</span>
                        <span class="insurance-card-status ${b.isOverdue ? 'status-overdue' : 'status-covered'}">
                          ${b.isOverdue ? '⚠️ Renewal Due' : '✅ Covered'}
                        </span>
                      </div>
                    </div>
                    <div class="insurance-card-details">
                      <div class="insurance-detail">
                        <span class="insurance-detail-label">Renewal Date</span>
                        <span class="insurance-detail-value">📅 ${new Date(b.dueDate).toLocaleDateString()}</span>
                      </div>
                      ${b.recurring ? `
                        <div class="insurance-detail">
                          <span class="insurance-detail-label">Frequency</span>
                          <span class="insurance-detail-value">🔄 ${escapeHtml(b.recurring)}</span>
                        </div>
                      ` : ''}
                      ${b.accountName ? `
                        <div class="insurance-detail">
                          <span class="insurance-detail-label">Account</span>
                          <span class="insurance-detail-value">${b.accountIcon || '🏦'} ${escapeHtml(b.accountName)}</span>
                        </div>
                      ` : ''}
                      ${b.propertyName ? `
                        <div class="insurance-detail">
                          <span class="insurance-detail-label">Property</span>
                          <span class="insurance-detail-value">🏠 ${escapeHtml(b.propertyName)}</span>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `).join('')
              }
            </div>
            ${wealthData.insuranceBills.length > 0 ? `
              <p class="no-data" style="margin-top: 12px;">${wealthData.insuranceBills.some(b => b.isOverdue) ? 'Renew overdue policies to stay protected.' : 'Well protected today, secure tomorrow.'}</p>
            ` : ''}
          </div>
        </div>
        </div>
        </div><!-- /tab-panel bills-insurance -->

        <!-- Financial Health + Accounts side by side (see Bills & Recurring
             / Insurance Review above for the same dashboard-two-col
             pattern) — each keeps its own header and independently
             collapses via toggleSection, they're just laid out as two
             columns instead of stacked one after another. -->
<div class="tab-panel" data-tab-panel="financial-overview" style="display:none">
        <div class="dashboard-two-col">
        <div class="expandable-section" data-section-id="financial-health">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>💰 Financial Health</h3>
            <span class="toggle-icon">${collapsedSections.has('financial-health') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('financial-health') ? ' style="display:none"' : ''}>
            <div class="period-nav" onclick="event.stopPropagation()">
              <button id="dashboardMonthPrevBtn" class="btn-secondary" title="Previous month">‹</button>
              <span id="dashboardMonthLabel" class="period-label">${escapeHtml(selectedMonthLabel)}</span>
              <button id="dashboardMonthNextBtn" class="btn-secondary" title="Next month" ${isCurrentCalendarMonth ? 'disabled' : ''}>›</button>
              ${!isCurrentCalendarMonth ? '<button id="dashboardMonthTodayBtn" class="btn-secondary">This Month</button>' : ''}
            </div>
            <div class="health-panel">
              <div class="health-gauge-wrap">
                ${renderHealthGauge(financialHealth)}
                <div class="health-gauge-band" style="color: ${financialHealth.color};">${financialHealth.band}</div>
                <div class="health-gauge-caption">Financial Health Score</div>
              </div>

              <div class="health-factors">
                ${renderHealthFactorRow('💵', 'Cash Flow', `${currentMonthBalance >= 0 ? '+' : ''}${formatMoney(currentMonthBalance)} in ${selectedMonthLabel}`, financialHealth.cashflowBar, financialHealth.cashflowBar >= 50 ? 'var(--success)' : 'var(--danger)')}
                ${renderHealthFactorRow('🐷', 'Savings Rate', `${savingsRate.toFixed(1)}% ${savingsRate >= 0 ? '(target 20%)' : ''}`, financialHealth.savingsBar, financialHealth.savingsBar >= 60 ? 'var(--success)' : financialHealth.savingsBar >= 25 ? '#ea7c1c' : 'var(--danger)')}
                ${renderHealthFactorRow('🎯', 'Budgets On Track', financialHealth.hasBudgets ? `${budgetPerformance.onTrackCount}/${budgetPerformance.totalBudgets}` : 'No budgets set', financialHealth.budgetBar, financialHealth.budgetBar >= 60 ? 'var(--success)' : '#ea7c1c')}
                ${renderHealthFactorRow('🏦', 'Net Worth', `${formatMoney(totalNetWorth)}`, totalNetWorth >= 0 ? 100 : 15, totalNetWorth >= 0 ? 'var(--success)' : 'var(--danger)')}
                ${renderHealthFactorRow('🎯', 'Wealth Goals', `${wealthData.overallPercent.toFixed(0)}% of plan complete`, wealthData.overallPercent, wealthData.overallPercent >= 60 ? 'var(--success)' : wealthData.overallPercent >= 30 ? '#ea7c1c' : 'var(--danger)')}
              </div>
            </div>

            <div class="health-quickfacts">
              <div class="health-quickfact">
                <span class="health-quickfact-label">Monthly Rent</span>
                <span class="health-quickfact-value">${formatMoney(totalRent)}</span>
                <span class="health-quickfact-sub">${tenants.length} tenants · ${properties.length} properties</span>
                <span class="health-quickfact-sub">Received in ${escapeHtml(selectedMonthLabel)}: ${formatMoney(rentReceivedThisMonth)}</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">Cash / Property</span>
                <span class="health-quickfact-value">${formatMoney(totalCashBalance)}</span>
                <span class="health-quickfact-sub">Property equity: ${formatMoney(netPropertyWorth)}</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">${escapeHtml(nextTaxDeadline.name)}</span>
                <span class="health-quickfact-value">${nextTaxDeadline.daysUntil}d</span>
                <span class="health-quickfact-sub">Due ${nextTaxDeadline.date.toLocaleDateString()}</span>
              </div>
              ${momChange.hasPrevData ? `
                <div class="health-quickfact">
                  <span class="health-quickfact-label">Vs ${new Date(momChange.prevMonth + '-01').toLocaleDateString('en-US', { month: 'long' })}</span>
                  <span class="health-quickfact-value ${currentMonthBalance >= momChange.prevBalance ? 'positive' : 'negative'}">
                    ${currentMonthBalance >= momChange.prevBalance ? '▲' : '▼'} ${formatMoney(Math.abs(currentMonthBalance - momChange.prevBalance))}
                  </span>
                  <span class="health-quickfact-sub">Monthly balance</span>
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Accounts -->
        <div class="expandable-section" data-section-id="accounts">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🏦 Accounts</h3>
            <span class="toggle-icon">${collapsedSections.has('accounts') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('accounts') ? ' style="display:none"' : ''}>
            ${renderDashboardAccountsHealth(accounts, transactions)}

            <!-- Quick Stats — moved in from its own standalone section
                 further down the page, styled as a health-quickfacts row
                 (same pattern as Financial Health's own footer row to
                 its left) instead of the old stat-item cards, so the two
                 panels read as a matching pair. -->
            <div class="health-quickfacts">
              <div class="health-quickfact">
                <span class="health-quickfact-label">Total Income</span>
                <span class="health-quickfact-value">${formatMoney(income)}</span>
                <span class="health-quickfact-sub">All-time</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">Total Expenses</span>
                <span class="health-quickfact-value">${formatMoney(expenses)}</span>
                <span class="health-quickfact-sub">All-time</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">Cash Balance</span>
                <span class="health-quickfact-value">${formatMoney(totalCashBalance)}</span>
                <span class="health-quickfact-sub">Across all accounts</span>
              </div>
              <div class="health-quickfact">
                <span class="health-quickfact-label">Credit Balance</span>
                <span class="health-quickfact-value">${formatMoney(totalCreditBalance)}</span>
                <span class="health-quickfact-sub">Across all cards</span>
              </div>
            </div>
          </div>
        </div>
        </div>
        </div><!-- /tab-panel financial-overview -->

<div class="tab-panel" data-tab-panel="property-retirement" style="display:none">
        <!-- Property Portfolio -->
        <div class="expandable-section" data-section-id="property-portfolio" data-feature="property">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🏠 Property Portfolio</h3>
            <span class="toggle-icon">${collapsedSections.has('property-portfolio') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('property-portfolio') ? ' style="display:none"' : ''}>
            <div class="compact-summary-cards page-compact-cards">
              <div class="compact-card teal">
                <div class="compact-icon">🏘️</div>
                <div class="compact-content">
                  <div class="compact-value">${properties.length}</div>
                  <div class="compact-label">Properties</div>
                  <div class="compact-subtext">Value: ${formatMoney(totalValue)}</div>
                </div>
              </div>
              
              <div class="compact-card gold">
                <div class="compact-icon">👥</div>
                <div class="compact-content">
                  <div class="compact-value">${tenants.length}</div>
                  <div class="compact-label">Tenants</div>
                  <div class="compact-subtext">Rent: ${formatMoney(totalRent)}/mo</div>
                </div>
              </div>
              
              <div class="compact-card ${avgROI > 5 ? 'green' : 'orange'}">
                <div class="compact-icon">📊</div>
                <div class="compact-content">
                  <div class="compact-value">${avgROI}%</div>
                  <div class="compact-label">Avg ROI</div>
                  <div class="compact-subtext">Property Returns</div>
                </div>
              </div>
              
              <div class="compact-card ${netPropertyWorth >= 0 ? 'blue' : 'red'}">
                <div class="compact-icon">💎</div>
                <div class="compact-content">
                  <div class="compact-value">${formatMoney(netPropertyWorth)}</div>
                  <div class="compact-label">Equity</div>
                  <div class="compact-subtext">Loans: ${formatMoney(totalLoan)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Loan Payoff Progress now lives only in Quick Look's own card
             (Card G) at the top of the page — this was rendering the
             exact same loanProgress list a second time. -->

        <!-- Retirement Timeline -->
        <div class="expandable-section" data-section-id="retirement-timeline">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🌴 Retirement Timeline</h3>
            <span class="toggle-icon">${collapsedSections.has('retirement-timeline') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('retirement-timeline') ? ' style="display:none"' : ''}>
            <div class="budgets-grid">
              <div class="budget-progress">
                <div class="progress-header">
                  <span>Super Contributions This Year</span>
                  <span>${formatMoney(wealthData.superContributionsYTD)} / ${formatMoney(wealthData.targets.superAnnualGoal)}</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width: ${wealthData.superPercent}%"></div>
                </div>
                <div class="progress-status ${wealthData.superPercent >= 100 ? 'on-track' : ''}">
                  ${wealthData.superPercent.toFixed(0)}% of annual goal
                </div>
              </div>
              <div class="budget-progress">
                <div class="progress-header">
                  <span>Years to Retirement</span>
                  <span>Age ${wealthData.targets.currentAge} → ${wealthData.targets.retirementAge}</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width: ${wealthData.retirementProgressPercent}%"></div>
                </div>
                <div class="progress-status">${wealthData.yearsToGo} years to go</div>
              </div>
            </div>
            <p class="no-data" style="margin-top: 10px;">Est. monthly income in retirement: ${formatMoney(wealthData.estMonthlyRetirementIncome)} (rough estimate only, not advice)</p>
            <div style="text-align: right;"><button class="wealth-edit-link" data-action="edit-wealth-target" data-key="retirementAge">Edit targets</button></div>
          </div>
        </div>
        </div><!-- /tab-panel property-retirement -->
<div class="tab-panel" data-tab-panel="budget-spending" style="display:none">
        <div class="expandable-section" data-section-id="budget-performance">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🎯 Budget Performance</h3>
            <span class="toggle-icon">${collapsedSections.has('budget-performance') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('budget-performance') ? ' style="display:none"' : ''}>
            <div class="budgets-controls" style="margin-bottom: 12px;">
              <div class="view-mode">
                <label class="form-label">View As:</label>
                <select id="budgetPanelViewMode" class="form-select">
                  <option value="weekly"${budgetPanelViewMode === 'weekly' ? ' selected' : ''}>Weekly</option>
                  <option value="fortnightly"${budgetPanelViewMode === 'fortnightly' ? ' selected' : ''}>Fortnightly</option>
                  <option value="monthly"${budgetPanelViewMode === 'monthly' ? ' selected' : ''}>Monthly</option>
                  <option value="quarterly"${budgetPanelViewMode === 'quarterly' ? ' selected' : ''}>Quarterly</option>
                  <option value="yearly"${budgetPanelViewMode === 'yearly' ? ' selected' : ''}>Yearly</option>
                </select>
              </div>
              <div class="period-nav">
                <button id="budgetPanelPrevBtn" class="btn-secondary" title="Previous period">‹</button>
                <span id="budgetPanelPeriodLabel" class="period-label">${escapeHtml(budgetPanelPeriodLabel)}</span>
                <button id="budgetPanelNextBtn" class="btn-secondary" title="Next period" ${budgetPanelIsCurrentPeriod ? 'disabled' : ''}>›</button>
                ${!budgetPanelIsCurrentPeriod ? '<button id="budgetPanelTodayBtn" class="btn-secondary">Today</button>' : ''}
              </div>
            </div>
            ${(() => {
              if (budgets.length === 0) return '<p class="no-data">No budgets configured</p>';
              const rows = budgetPanelRows;
              const onTrackCount = rows.filter(r => r.onTrack).length;
              const gaugePct = Math.round((onTrackCount / rows.length) * 100);
              const gauge = {
                score: gaugePct,
                band: gaugePct >= 80 ? 'Great' : gaugePct >= 50 ? 'Good' : 'Needs Attention',
                color: gaugePct >= 80 ? 'var(--success)' : gaugePct >= 50 ? '#ea7c1c' : 'var(--danger)'
              };
              return `
                <div class="health-panel">
                  <div class="health-gauge-wrap">
                    ${renderHealthGauge(gauge)}
                    <div class="health-gauge-band" style="color: ${gauge.color};">${gauge.band}</div>
                    <div class="health-gauge-caption">${onTrackCount}/${rows.length} On Track</div>
                  </div>
                  <div class="health-factors">
                    ${rows.map(r => r.row).join('')}
                  </div>
                </div>
              `;
            })()}
          </div>
        </div>

        <!-- Top Spending Categories — merged with the old separate
             "Expense Categories" doughnut card below (same data, same
             month, shown twice back to back before); the chart and the
             list are now one card, side by side, sharing topCategories
             so they can't disagree with each other. -->
        <div class="expandable-section" data-section-id="top-spending">
          <div class="section-header" onclick="toggleSection(this)">
            <h3>🏆 Top Spending Categories — ${escapeHtml(selectedMonthLabel)}</h3>
            <span class="toggle-icon">${collapsedSections.has('top-spending') ? '▼' : '▲'}</span>
          </div>
          <div class="section-content"${collapsedSections.has('top-spending') ? ' style="display:none"' : ''}>
            <div class="spending-categories-layout">
              <div class="spending-categories-chart">
                <canvas id="expenseByCatChart" height="220"></canvas>
              </div>
              <div class="recent-activity spending-categories-list">
                ${topCategories.map(cat => `
                  <div class="activity-item">
                    <span class="activity-icon">${cat.icon}</span>
                    <div class="activity-details">
                      <div class="activity-desc">${escapeHtml(cat.name)}</div>
                      <div class="activity-date">${cat.percent.toFixed(1)}% of ${escapeHtml(selectedMonthLabel)}'s spending</div>
                    </div>
                    <span class="activity-amount negative">-${formatMoney(cat.amount)}</span>
                  </div>
                `).join('')}
                ${topCategories.length === 0 ? `<p class="no-data">No expenses recorded in ${escapeHtml(selectedMonthLabel)}</p>` : ''}
              </div>
            </div>
          </div>
        </div>
        </div><!-- /tab-panel budget-spending -->

        <!-- Quick Stats now lives inside the Accounts panel above, as a
             health-quickfacts row — see the Accounts section-content. -->

<div class="tab-panel" data-tab-panel="charts" style="display:none">
        <!-- Charts Section — all the same size (2 per row on desktop,
             matching charts-container's existing auto-fit grid). Expense
             Categories moved into Top Spending Categories above, and its
             month dropdown (which never actually drove this Monthly
             Overview card despite living in its header — it only ever
             re-rendered the other doughnut) went with it. Split out into
             its own tab (rather than stacked under Overview) so landing
             on Overview on a phone isn't three full-size charts deep
             before you even reach Recent Activity. -->
        <div class="charts-container">
          <div class="section-card">
            <div class="chart-header">
              <h4>📅 Monthly Overview</h4>
            </div>
            <canvas id="summaryChart" height="220"></canvas>
          </div>

          <div class="section-card">
            <div class="chart-header">
              <h4>📈 Income vs Expenses Trend</h4>
              <button id="toggleTrend" class="btn btn-secondary">📉 Hide Chart</button>
            </div>
            <canvas id="trendChart" height="220"></canvas>
          </div>

          <div class="section-card">
            <div class="chart-header">
              <h4>💎 Net Worth Trend (Last 6 Months)</h4>
            </div>
            <canvas id="netWorthChart" height="220"></canvas>
            <p class="no-data" style="font-size: 0.8rem; margin-top: 4px;">Property and loan equity are held at today's values across this trend — only cash movement is historical.</p>
          </div>
        </div>
        </div><!-- /tab-panel charts -->

<div class="tab-panel" data-tab-panel="overview">
        <!-- Recent Activity -->
        <div class="section-card">
          <div class="transactions-header">
            <h3>📝 Recent Activity</h3>
            <span class="transactions-count">Last ${Math.min(getRecentActivity(flowTx, bills, maintenance).length, 5)} activities</span>
          </div>
          <div class="recent-activity">
            ${getRecentActivity(flowTx, bills, maintenance).slice(0, 5).map(item => `
              <div class="activity-item">
                <span class="activity-icon">${item.icon}</span>
                <div class="activity-details">
                  <div class="activity-desc">${escapeHtml(item.description)}</div>
                  <div class="activity-date">${item.date}</div>
                </div>
                <span class="activity-amount ${item.amount < 0 ? 'negative' : 'positive'}">
                  ${item.amount < 0 ? '-' : '+'}${formatMoney(Math.abs(item.amount))}
                </span>
              </div>
            `).join('')}
            ${getRecentActivity(flowTx, bills, maintenance).length === 0 ? `
              <div class="empty-state">
                <p>No recent activity found</p>
              </div>
            ` : ''}
          </div>
        </div>
        </div><!-- /tab-panel overview -->
      </div>
      </div>
    `;

    setTimeout(() => mainContent.classList.remove('page-transition'), 400);

    // Restore whichever tab was last active (falls back to the template's
    // default-visible "overview" panel if nothing saved yet, or on first
    // visit).
    const savedTab = localStorage.getItem(DASHBOARD_TABS_ACTIVE_KEY) || 'overview';
    const tabBar = mainContent.querySelector('.dashboard-tab-bar');
    if (tabBar) {
      const savedBtn = tabBar.querySelector(`[data-tab-target="${savedTab}"]`) || tabBar.querySelector('[data-tab-target="overview"]');
      if (savedBtn) window.switchDashboardTab(savedBtn);
    }

    if (typeof Chart === 'undefined') throw new Error('Chart.js not loaded');

    // === IMPROVED CHARTS WITH INTERACTIVITY ===
    
    // Destroy existing charts before creating new ones
    if (summaryChart) {
      summaryChart.destroy();
      summaryChart = null;
    }

    // Summary Chart (Bar)
    const summaryCtx = document.getElementById('summaryChart');
    if (summaryCtx) {
      summaryChart = new Chart(summaryCtx, {
        type: 'bar',
        data: {
          labels: ['Income', 'Expenses', 'Balance', 'Rent Income'],
          datasets: [{
            label: `Amount (${getBaseCurrency()})`,
            data: [currentMonthIncome, currentMonthExpenses, currentMonthBalance, totalRent],
            backgroundColor: ['#10b981', '#f43f5e', '#0ea5e9', '#f59e0b'],
            borderColor: ['#0d9668', '#e11d48', '#0284c7', '#d97706'],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          interaction: {
            intersect: false,
            mode: 'index'
          },
          plugins: {
            legend: { display: false },
            tooltip: { 
              callbacks: { 
                label: (ctx) => `${formatMoney(ctx.raw)}` 
              } 
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: (value) => currencySymbol() + value }
            }
          },
          onClick: (event, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              const labels = ['Income', 'Expenses', 'Balance', 'Rent Income'];
              const values = [currentMonthIncome, currentMonthExpenses, currentMonthBalance, totalRent];
              window.showDrillDownModal(labels[index], values[index]);
            }
          }
        }
      });
    }

    // Category Chart (Doughnut) — now driven by the same topCategories
    // used by the Top Spending Categories list right next to it (see
    // getTopSpendingCategories above), instead of its own separate
    // month-dropdown-driven computation, so the two can't disagree.
    function renderCategoryChart() {
      if (catChart) {
        catChart.destroy();
        catChart = null;
      }

      const catCtx = document.getElementById('expenseByCatChart');
      const catLabels = topCategories.map(c => c.name);
      const catData = topCategories.map(c => c.amount);

      if (catCtx && catData.length > 0) {
        catChart = new Chart(catCtx, {
          type: 'doughnut',
          data: {
            labels: catLabels,
            datasets: [{
              data: catData,
              backgroundColor: generateColorPalette(catLabels.length),
              borderWidth: 2,
              borderColor: '#fff'
            }]
          },
          options: {
            responsive: true,
            interaction: {
              intersect: false,
              mode: 'index'
            },
            plugins: {
              legend: { position: 'right' },
              tooltip: { 
                callbacks: { 
                  label: (ctx) => `${ctx.label}: ${formatMoney(ctx.raw)}`,
                  afterLabel: function(context) {
                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = ((context.parsed / total) * 100).toFixed(1);
                    return `(${percentage}% of total)`;
                  }
                } 
              }
            },
            onClick: (event, elements) => {
              if (elements.length > 0) {
                const index = elements[0].index;
                const label = catLabels[index];
                const value = catData[index];
                window.showDrillDownModal(label, value);
              }
            }
          }
        });
      } else if (catCtx) {
        // Show message if no data
        catCtx.parentElement.innerHTML += '<p class="no-data">No expense data for this month</p>';
      }
    }

    // Trend Chart (Line)
    function renderTrendChart() {
      const monthly = {};
      flowTx.forEach(t => {
        if (!t.date) return;
        const key = t.date.slice(0, 7);
        if (!monthly[key]) monthly[key] = { income: 0, expense: 0, net: 0 };
        monthly[key][t.type] += t.amount;
        monthly[key].net = monthly[key].income + monthly[key].expense;
      });

      const months = Object.keys(monthly).sort();
      const incomeData = months.map(m => monthly[m].income);
      const expenseData = months.map(m => monthly[m].expense);
      const netData = months.map(m => monthly[m].net);

      // Destroy existing chart
      if (trendChart) {
        trendChart.destroy();
        trendChart = null;
      }

      const trendCtx = document.getElementById('trendChart');
      if (trendCtx && months.length > 0) {
        trendChart = new Chart(trendCtx, {
          type: 'line',
          data: {
            labels: months.map(m => formatMonthLabel(m)),
            datasets: [
              {
                label: 'Income',
                data: incomeData,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                fill: true,
                tension: 0.4
              },
              {
                label: 'Expenses',
                data: expenseData,
                borderColor: '#f43f5e',
                backgroundColor: 'rgba(244, 63, 94, 0.12)',
                fill: true,
                tension: 0.4
              },
              {
                label: 'Net',
                data: netData,
                borderColor: '#0ea5e9',
                borderDash: [5, 5],
                fill: false,
                tension: 0.4
              }
            ]
          },
          options: {
            responsive: true,
            interaction: {
              intersect: false,
              mode: 'index'
            },
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return `${context.dataset.label}: ${formatMoney(context.parsed.y)}`;
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { callback: (value) => currencySymbol() + value }
              }
            },
            onClick: (event, elements) => {
              if (elements.length > 0) {
                const index = elements[0].index;
                const label = months[index];
                const income = incomeData[index];
                const expense = expenseData[index];
                window.showDrillDownModal(`Month: ${formatMonthLabel(label)}`, { income, expense });
              }
            }
          }
        });
      } else if (trendCtx) {
        // Show message if no data
        trendCtx.parentElement.innerHTML += '<p class="no-data">No trend data available</p>';
      }
    }

    // Net Worth Trend Chart (Line)
    function renderNetWorthChart() {
      if (netWorthChart) {
        netWorthChart.destroy();
        netWorthChart = null;
      }

      const nwCtx = document.getElementById('netWorthChart');
      if (nwCtx && netWorthTrend.length > 0) {
        netWorthChart = new Chart(nwCtx, {
          type: 'line',
          data: {
            labels: netWorthTrend.map(p => formatMonthLabel(p.month)),
            datasets: [{
              label: 'Net Worth',
              data: netWorthTrend.map(p => p.netWorth),
              borderColor: '#8b5cf6',
              backgroundColor: 'rgba(139, 92, 246, 0.12)',
              fill: true,
              tension: 0.4
            }]
          },
          options: {
            responsive: true,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => `Net Worth: ${formatMoney(ctx.parsed.y)}`
                }
              }
            },
            scales: {
              y: { ticks: { callback: (value) => currencySymbol() + value } }
            }
          }
        });
      } else if (nwCtx) {
        nwCtx.parentElement.innerHTML += '<p class="no-data">No net worth trend data available</p>';
      }
    }

    // === NEW EVENT LISTENERS FOR TWEAKS ===

    attachQuickLookBehavior();
    // Registered every render (cheap — just a function reference) so the
    // Quick Look period selector always re-triggers the CURRENT render
    // cycle's initDashboardTabsUI, not a stale one from an earlier call.
    setQuickLookPeriodChangeHandler(() => initDashboardTabsUI());

    // Quick Look "peek" — on narrow (phone-width) screens this tabbed
    // layout is compared against, Quick Look's 9 cards plus a whole tab
    // panel below it was adding up to several screens of scroll before
    // you reached any tab content. On wide screens the CSS cap this
    // toggles is a no-op (see .dt-quicklook-peek in styles.css), so this
    // only changes anything on phone-width viewports. Not persisted —
    // each visit starts folded, same as it would on first load.
    const dtPeekToggle = document.getElementById('dtQuickLookPeekToggle');
    const dtPeekWrap = document.getElementById('dtQuickLookPeek');
    if (dtPeekToggle && dtPeekWrap) {
      dtPeekToggle.addEventListener('click', () => {
        const expanded = dtPeekWrap.classList.toggle('dt-quicklook-peek--expanded');
        dtPeekToggle.setAttribute('aria-expanded', String(expanded));
        dtPeekToggle.textContent = expanded ? 'Show fewer Quick Look cards ▴' : 'Show all Quick Look cards ▾';
      });
    }

    // Add Transaction (dashboard toolbar) — reuses the exact same modal
    // and save logic as the Transactions page (see renderTransactionFormHTML/
    // setupCategoryLinking/setupFormHandlers in transactions.js), just with
    // its own open/close button and its own onSaved (re-render the
    // Dashboard instead of navigating to Transactions).
    const dashAddTxBtn = document.getElementById('dashAddTxBtn');
    const addTxForm = document.getElementById('addTxForm');
    const closeAddForm = document.getElementById('closeAddForm');
    const dashSubCats = categories.filter(c => c.parentId);

    // display:"block" + body.tx-modal-open matches the exact pattern the
    // Transactions page's own modal uses (see transactions.js showEditForm/
    // toggleAddForm) — same centered-overlay CSS, same scroll lock.
    if (dashAddTxBtn && addTxForm) {
      dashAddTxBtn.addEventListener('click', () => {
        addTxForm.style.display = 'block';
        document.body.classList.add('tx-modal-open');
        const box = addTxForm.querySelector('.tx-modal-box');
        if (box) box.scrollTop = 0;
      });
    }
    const closeDashAddTx = () => {
      if (addTxForm) addTxForm.style.display = 'none';
      document.body.classList.remove('tx-modal-open');
    };
    if (closeAddForm) closeAddForm.addEventListener('click', closeDashAddTx);
    if (addTxForm) {
      // Click on the overlay itself (outside the box) also closes it,
      // matching the behaviour of this same modal on the Transactions page.
      addTxForm.addEventListener('click', e => {
        if (e.target === addTxForm) closeDashAddTx();
      });
    }

    setupCategoryLinking(categories, dashSubCats);
    setupFormHandlers(categories, accounts, properties, transactions, dashSubCats, today, () => {
      // Full re-render so the new transaction is reflected everywhere on
      // the dashboard (toolbar totals, charts, recent activity, budget
      // performance) rather than patching each spot in place.
      initDashboardTabsUI();
    });

    // "✨ New look" / "↩ Classic view" — swaps the toolbar stat row for
    // the hero net-figure card (see js/heroDashboard.js). Persisted in
    // localStorage so the choice survives reloads, same pattern as the
    // Quick Look panel's collapsed state.
    const heroModeToggle = document.getElementById('heroModeToggle');
    if (heroModeToggle) {
      heroModeToggle.addEventListener('click', () => {
        setHeroMode(!isHeroModeOn());
        initDashboardTabsUI();
      });
    }
    if (isHeroModeOn()) {
      attachHeroBehavior();
    }
    // Sets the Property Expense/Rental Income section's initial
    // label/visibility for the default Type selection — same call the
    // Transactions page makes right after its own render.
    togglePropertyExpenseFields();

    // Export Dashboard Data
    const exportBtn = document.getElementById('exportDashboard');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        const dashboardData = {
          summary: {
            currentMonthIncome,
            currentMonthExpenses,
            currentMonthBalance,
            totalNetWorth,
            totalCashBalance,
            totalCreditBalance
          },
          charts: {
            categories: getChartData(catChart),
            trend: getChartData(trendChart),
            summary: getChartData(summaryChart)
          },
          portfolio: {
            properties: properties.length,
            tenants: tenants.length,
            totalValue,
            totalLoan,
            netPropertyWorth,
            avgROI
          },
          timestamp: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(dashboardData, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dashboard-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Live Refresh Toggle
    const liveRefreshBtn = document.getElementById('liveRefresh');
    if (liveRefreshBtn) {
      liveRefreshBtn.addEventListener('click', function() {
        this.classList.toggle('active');
        if (this.classList.contains('active')) {
          autoRefreshInterval = setInterval(initDashboardTabsUI, 30000); // 30 seconds
          this.innerHTML = '⏸️ Pause Auto-Refresh';
        } else {
          clearInterval(autoRefreshInterval);
          this.innerHTML = '🔄 Live';
        }
      });
    }

    // Filter Controls
    const applyFiltersBtn = document.getElementById('applyFilters');
    const resetFiltersBtn = document.getElementById('resetFilters');
    
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener('click', applyFilters);
    }
    
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', resetFilters);
    }

    // Retirement targets editor (Retirement Timeline section)
    mainContent.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="edit-wealth-target"]');
      if (!btn) return;
      const targets = loadTargets();
      const currentAge = prompt('Your current age:', targets.currentAge);
      if (currentAge === null) return;
      const retirementAge = prompt('Target retirement age:', targets.retirementAge);
      if (retirementAge === null) return;
      targets.currentAge = parseFloat(currentAge) || targets.currentAge;
      targets.retirementAge = parseFloat(retirementAge) || targets.retirementAge;
      saveTargets(targets);
      initDashboardTabsUI();
    });

    // Budget Performance panel — period nav
    const budgetPanelViewModeSelect = document.getElementById('budgetPanelViewMode');
    if (budgetPanelViewModeSelect) {
      budgetPanelViewModeSelect.addEventListener('change', () => {
        budgetPanelPeriodOffset = 0; // switching modes starts back at the current period
        initDashboardTabsUI();
      });
    }
    document.getElementById('budgetPanelPrevBtn')?.addEventListener('click', () => {
      budgetPanelPeriodOffset -= 1;
      initDashboardTabsUI();
    });
    document.getElementById('budgetPanelNextBtn')?.addEventListener('click', () => {
      // Capped at the current period, same as the Budgets page — budgeting
      // against the future isn't meaningful.
      budgetPanelPeriodOffset = Math.min(budgetPanelPeriodOffset + 1, 0);
      initDashboardTabsUI();
    });
    document.getElementById('budgetPanelTodayBtn')?.addEventListener('click', () => {
      budgetPanelPeriodOffset = 0;
      initDashboardTabsUI();
    });

    document.getElementById('dashboardMonthPrevBtn')?.addEventListener('click', () => {
      dashboardMonthOffset -= 1;
      initDashboardTabsUI();
    });
    document.getElementById('dashboardMonthNextBtn')?.addEventListener('click', () => {
      // Capped at the current month — same reasoning as the Budget
      // Performance panel: there's no "future" data to look ahead to.
      dashboardMonthOffset = Math.min(dashboardMonthOffset + 1, 0);
      initDashboardTabsUI();
    });
    document.getElementById('dashboardMonthTodayBtn')?.addEventListener('click', () => {
      dashboardMonthOffset = 0;
      initDashboardTabsUI();
    });

    // Hero dashboard's own month nav (same dashboardMonthOffset var as the
    // Financial Health section's ‹ › above) — added because that control
    // lives in a collapsible section further down the page, so someone
    // using only the hero card had no visible, obvious way to change the
    // period and assumed the month selector just didn't work.
    document.getElementById('heroMonthPrevBtn')?.addEventListener('click', () => {
      dashboardMonthOffset -= 1;
      initDashboardTabsUI();
    });
    document.getElementById('heroMonthNextBtn')?.addEventListener('click', () => {
      dashboardMonthOffset = Math.min(dashboardMonthOffset + 1, 0);
      initDashboardTabsUI();
    });
    document.getElementById('heroMonthTodayBtn')?.addEventListener('click', () => {
      dashboardMonthOffset = 0;
      initDashboardTabsUI();
    });

    // Quick Look's own copy of the same month nav, on its "Net This
    // Month" card — same dashboardMonthOffset var and same reasoning as
    // heroMonthPrevBtn above, just for the control that's always on
    // screen (Quick Look isn't gated behind the New Look toggle).
    document.getElementById('qlNetMonthPrevBtn')?.addEventListener('click', () => {
      dashboardMonthOffset -= 1;
      initDashboardTabsUI();
    });
    document.getElementById('qlNetMonthNextBtn')?.addEventListener('click', () => {
      dashboardMonthOffset = Math.min(dashboardMonthOffset + 1, 0);
      initDashboardTabsUI();
    });
    document.getElementById('qlNetMonthTodayBtn')?.addEventListener('click', () => {
      dashboardMonthOffset = 0;
      initDashboardTabsUI();
    });

    // Existing Event Listeners
    const toggleBtn = document.getElementById('toggleTrend');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const trendChartEl = document.getElementById('trendChart');
        if (trendChartEl) {
          const isHidden = trendChartEl.style.display === 'none';
          trendChartEl.style.display = isHidden ? 'block' : 'none';
          toggleBtn.textContent = isHidden ? '📉 Hide Chart' : '📈 Show Chart';
        }
      });
    }

    // === Initial Render ===
    renderCategoryChart();
    renderTrendChart();
    renderNetWorthChart();

    mainContent.dataset.dashboardRendered = 'true';
    if (!isInitialRender) {
      // Restore the scroll position captured above. Deferred a frame so
      // it applies after the browser has laid out the new content
      // (including the charts just kicked off above) — restoring
      // immediately can still get clobbered by that layout pass.
      requestAnimationFrame(() => window.scrollTo(0, scrollPos));
    }

  } catch (err) {
    console.error("❌ Dashboard failed:", err);
    mainContent.innerHTML = `
      <div class="error-state">
        <h3>⚠️ Dashboard Error</h3>
        <p>${err.message}</p>
        <button onclick="initDashboardTabsUI()" class="btn btn-primary">Retry</button>
      </div>
    `;
  }
}

// Filter Functions
function applyFilters() {
  const propertyFilter = document.getElementById('propertyFilter').value;
  const categoryFilter = document.getElementById('categoryFilter').value;
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  
  localStorage.setItem('dashboardFilters', JSON.stringify({
    propertyFilter,
    categoryFilter,
    dateFrom,
    dateTo
  }));

  initDashboardTabsUI();
}

function resetFilters() {
  document.getElementById('propertyFilter').value = 'all';
  document.getElementById('categoryFilter').value = 'all';
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  
  localStorage.removeItem('dashboardFilters');
  initDashboardTabsUI();
}

// Chart Data Export Helper
function getChartData(chart) {
  if (!chart) return null;
  return {
    labels: chart.data.labels,
    datasets: chart.data.datasets.map(dataset => ({
      label: dataset.label,
      data: dataset.data
    }))
  };
}

// === EXISTING HELPER FUNCTIONS ===

function calculateBudgetPerformance(budgets, flowTx, currentMonth, categories = []) {
  if (!budgets || !budgets.length) return { onTrackCount: 0, overBudgetCount: 0, totalBudgets: 0 };
  
  let onTrackCount = 0;
  let overBudgetCount = 0;

  // A transaction counts toward a budget if it's tagged with that exact
  // category, OR with one of that category's subcategories, so a budget on
  // a parent category (e.g. "Transport") rolls up spend from its children
  // (Fuel, Rego, Tolls...) instead of requiring an exact ID match.
  const matchesBudget = (t, budgetCategoryId) => {
    if (t.categoryId === budgetCategoryId) return true;
    const txCat = categories.find(c => c.id === t.categoryId);
    return !!(txCat && txCat.parentId === budgetCategoryId);
  };

  budgets.forEach(budget => {
    const spent = Math.abs(flowTx
      .filter(t => matchesBudget(t, budget.categoryId) && t.date?.startsWith(currentMonth))
      .reduce((sum, t) => sum + t.amount, 0));
    
    if (spent <= budget.amount) {
      onTrackCount++;
    } else {
      overBudgetCount++;
    }
  });

  return {
    onTrackCount,
    overBudgetCount,
    totalBudgets: budgets.length
  };
}

function getAccountTypeIcon(type) {
  const icons = { bank: '🏛️', savings: '🐷', cash: '💵', offset: '⚖️', credit: '💳' };
  return icons[type] || '🏦';
}

function getBillAlerts(bills, daysAhead = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);

  const unpaid = (bills || []).filter(b => !b.paid);
  const overdueBills = unpaid
    .filter(b => new Date(b.dueDate) < today)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const dueSoonBills = unpaid
    .filter(b => {
      const d = new Date(b.dueDate);
      return d >= today && d <= horizon;
    })
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  return { overdueBills, dueSoonBills };
}

function getNextOccurrence(dateStr, frequency) {
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
      default: return d; // one-off / unrecognized frequency, don't loop forever
    }
    guard++;
  }
  return d;
}

function getUpcomingRecurring(recurringTx, daysAhead = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);

  return (recurringTx || [])
    .filter(r => r.startDate)
    .map(r => ({ ...r, nextDate: getNextOccurrence(r.startDate, r.frequency) }))
    .filter(r => r.nextDate >= today && r.nextDate <= horizon)
    .sort((a, b) => a.nextDate - b.nextDate);
}

// Now feeds both the "Top Spending Categories" list AND the Expense
// Categories doughnut in the same merged card (see dashboard.js's
// template below) — previously the doughnut had its own completely
// separate computation (renderCategoryChart) driven by its own month
// dropdown, so the two could show different months' numbers at the
// same time despite sitting one below the other. One data source now,
// so list and chart can't disagree. Anything past `limit` is folded
// into a single "Other" slice rather than silently dropped, so the
// doughnut's slices still add up to the real total.
function getTopSpendingCategories(flowTx, categories, currentMonth, limit = 5) {
  const totals = {};
  flowTx
    .filter(t => t.type === 'expense' && !t.isTransfer && t.date?.startsWith(currentMonth))
    .forEach(t => {
      const key = t.categoryId || 'uncategorized';
      totals[key] = (totals[key] || 0) + Math.abs(t.amount);
    });

  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  const ranked = Object.entries(totals)
    .map(([categoryId, amount]) => ({
      name: categories.find(c => c.id === categoryId)?.name || 'Uncategorized',
      icon: categories.find(c => c.id === categoryId)?.icon || '🏷️',
      amount,
      percent: grandTotal > 0 ? (amount / grandTotal) * 100 : 0
    }))
    .sort((a, b) => b.amount - a.amount);

  const top = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  if (rest.length > 0) {
    const otherAmount = rest.reduce((sum, c) => sum + c.amount, 0);
    top.push({
      name: `Other (${rest.length} more)`,
      icon: '🔹',
      amount: otherAmount,
      percent: grandTotal > 0 ? (otherAmount / grandTotal) * 100 : 0
    });
  }
  return top;
}

export function getLoanProgressList(loans) {
  return (loans || []).map(loan => {
    const original = parseFloat(loan.originalAmount) || 0;
    const current = parseFloat(loan.currentBalance) || 0;
    // Handles the staged-drawdown case for construction loans (percent
    // trends with drawdown progress until every stage is drawn, then
    // switches to real payoff progress against the fully-drawn amount)
    // — see getLoanPayoffStatus in loans.js for why this can't just be
    // (original - current) / original the way an ordinary loan is.
    const status = getLoanPayoffStatus(loan);

    let estPayoffDate = null;
    if (loan.startDate && loan.termMonths) {
      estPayoffDate = new Date(loan.startDate);
      estPayoffDate.setMonth(estPayoffDate.getMonth() + parseInt(loan.termMonths, 10));
    }

    return {
      name: loan.name || 'Loan',
      type: loan.type,
      icon: loan.icon || '🏦',
      original,
      current,
      percent: status.percent,
      phase: status.phase,
      drawnTotal: status.drawnTotal,
      facilityLimit: status.facilityLimit,
      estPayoffDate,
      isPaidOff: status.isPaidOff
    };
  }).sort((a, b) => b.current - a.current);
}

function getMonthOverMonthChange(flowTx, currentMonth) {
  const [y, m] = currentMonth.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1); // m is 1-indexed; m-2 (0-indexed) is the prior month
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const prevIncome = flowTx
    .filter(t => t.type === 'income' && !t.isTransfer && t.date?.startsWith(prevMonth))
    .reduce((s, t) => s + t.amount, 0);
  const prevExpenses = flowTx
    .filter(t => t.type === 'expense' && !t.isTransfer && t.date?.startsWith(prevMonth))
    .reduce((s, t) => s + t.amount, 0);

  return {
    prevMonth,
    prevBalance: prevIncome + prevExpenses,
    hasPrevData: prevIncome !== 0 || prevExpenses !== 0
  };
}

function getNextTaxDeadline() {
  const now = new Date();
  const year = now.getFullYear();
  const deadlines = [
    { name: 'Quarterly BAS (Jan–Mar)', date: new Date(year, 3, 28) },
    { name: 'Income Tax Return', date: new Date(year, 9, 31) },
    { name: 'Land Tax Assessment', date: new Date(year, 5, 30) }
  ];

  // Roll any already-passed deadline forward a year so we always find "next".
  deadlines.forEach(d => {
    if (d.date < now) d.date = new Date(d.date.getFullYear() + 1, d.date.getMonth(), d.date.getDate());
  });
  deadlines.sort((a, b) => a.date - b.date);

  const next = deadlines[0];
  const daysUntil = Math.ceil((next.date - now) / (1000 * 60 * 60 * 24));
  return { name: next.name, date: next.date, daysUntil };
}

function getNetWorthTrendSeries(flowTx, netPropertyWorth, currentCashBalance, months = 6, superBalance = 0) {
  // Builds a monthly net-worth approximation by walking the current cash
  // balance backward using each month's real net cash flow. Property value,
  // loan balances, and super balance are held at their current levels
  // across the series, since this app doesn't keep historical property
  // valuations (and super balance history is sparse, manually-entered
  // snapshots rather than a monthly series) - so this trend mainly
  // reflects real cash movement month to month, not historical property
  // appreciation or super contributions/returns.
  const today = new Date();
  const monthKeys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const netByMonth = {};
  monthKeys.forEach(k => { netByMonth[k] = 0; });
  flowTx.forEach(t => {
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

function getRecentActivity(flowTx, bills, maintenance) {
  const activities = [];
  
  // Recent transactions
  if (flowTx && flowTx.length > 0) {
    flowTx.slice(-10).forEach(t => {
      // Bug fix: this labelled every transaction "Income:" or "Expense:"
      // straight from t.type, ignoring isTransfer entirely - so a general
      // transfer or loan draw (isTransfer:true, but t.type left as
      // whatever the raw bank sign was - see resolveTransactionSemantics
      // in categoryMapper.js) still showed up here explicitly labelled
      // "Income: <description>", even though every total on the app
      // already excludes it as one. Labelled "Transfer:" instead so this
      // feed doesn't contradict the totals right next to it.
      const label = t.isTransfer ? 'Transfer' : (t.type === 'income' ? 'Income' : 'Expense');
      const icon = t.isTransfer ? '🔄' : (t.type === 'income' ? '💹' : '💸');
      activities.push({
        icon,
        description: `${label}: ${t.description || 'Transaction'}`,
        amount: t.amount,
        date: new Date(t.date).toLocaleDateString(),
        timestamp: new Date(t.date).getTime()
      });
    });
  }

  // Recent bills
  if (bills && bills.length > 0) {
    bills.slice(-5).forEach(bill => {
      activities.push({
        icon: '📄',
        description: `Bill: ${bill.name}`,
        amount: -toBase(bill.amount, bill.currency),
        date: new Date(bill.dueDate).toLocaleDateString(),
        timestamp: new Date(bill.dueDate).getTime()
      });
    });
  }

  // Recent maintenance
  if (maintenance && maintenance.length > 0) {
    maintenance.slice(-5).forEach(maint => {
      activities.push({
        icon: '🔧',
        description: `Maintenance: ${maint.description}`,
        amount: -maint.cost,
        date: new Date(maint.date).toLocaleDateString(),
        timestamp: new Date(maint.date).getTime()
      });
    });
  }

  // Sort by date and return
  return activities.sort((a, b) => b.timestamp - a.timestamp);
}

function formatMonthLabel(monthString) {
  const [year, month] = monthString.split('-');
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function generateColorPalette(count) {
  const baseColors = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#FF6384', '#C9CBCF', '#7CFFB2', '#F465C5'
  ];
  return Array.from({ length: count }, (_, i) => baseColors[i % baseColors.length]);
}

function calcAvgROI(properties, tenants) {
  if (!properties || !properties.length) return 0;
  const rois = properties.map(p => {
    const t = tenants.find(t => t.propertyId === p.id);
    if (!p.purchasePrice || !t?.rentAmount) return 0;
    return ((t.rentAmount * 12) / p.purchasePrice * 100);
  });
  return (rois.reduce((a, b) => a + b, 0) / rois.length).toFixed(1);
}

// Dashboard's own compact "Accounts" summary — same Accounts Health gauge
// + factor rows + quick-facts pattern as the dedicated Accounts page
// (js/accounts.js), reusing that page's exact scoring function so the two
// never disagree about the same underlying data. Doesn't repeat the
// per-account listing here — that's what the dedicated Accounts page (and
// Quick Look's own balances breakdown) are for; this is the at-a-glance
// summary for someone who hasn't left the Dashboard.
function renderDashboardAccountsHealth(accounts, transactions) {
  if (accounts.length === 0) {
    return '<p class="no-data">No accounts added yet</p>';
  }

  const liveBalance = acc => computeAccountBalance(acc, transactions);
  const liabilities = accounts.filter(acc => acc.type === 'credit');
  const totalCreditLimit = liabilities.reduce((sum, acc) => sum + (acc.creditLimit || 0), 0);
  const usedCredit = liabilities.reduce((sum, acc) => sum + Math.abs(Math.min(liveBalance(acc), 0)), 0);
  const utilizationPct = totalCreditLimit > 0 ? (usedCredit / totalCreditLimit) * 100 : 0;

  const health = computeAccountsHealth(accounts, transactions, { totalCreditLimit, usedCredit, utilizationPct });

  return `
    <div class="health-panel">
      <div class="health-gauge-wrap">
        ${renderAccountsHealthGauge(health)}
        <div class="health-gauge-band" style="color: ${health.color};">${health.band}</div>
        <div class="health-gauge-caption">Accounts Health</div>
      </div>

      <div class="health-factors">
        ${renderAccountsFactorRow('💳', 'Credit Utilization', totalCreditLimit > 0 ? `${formatMoney(usedCredit)} of ${formatMoney(totalCreditLimit)} (${utilizationPct.toFixed(0)}%)` : 'No credit cards', health.utilizationBar, health.utilizationBar >= 70 ? 'var(--success)' : health.utilizationBar >= 30 ? '#ea7c1c' : 'var(--danger)')}
        ${renderAccountsFactorRow('🐷', 'Cash Buffer', health.monthlyExpenseEstimate > 0 ? `${health.monthsOfCoverage.toFixed(1)} months of expenses` : `${formatMoney(health.liquidCash)} available`, health.bufferBar, health.bufferBar >= 60 ? 'var(--success)' : health.bufferBar >= 25 ? '#ea7c1c' : 'var(--danger)')}
        ${renderAccountsFactorRow('🗂️', 'Account Mix', `${health.distinctTypes} account type${health.distinctTypes === 1 ? '' : 's'}`, health.diversificationBar, health.diversificationBar >= 100 ? 'var(--success)' : health.diversificationBar >= 60 ? '#ea7c1c' : 'var(--danger)')}
        ${renderAccountsFactorRow('⏱️', 'Recent Activity', `${health.activeCount}/${accounts.length} active in 60d`, health.activityBar, health.activityBar >= 70 ? 'var(--success)' : health.activityBar >= 35 ? '#ea7c1c' : 'var(--danger)')}
      </div>
    </div>
  `;
  // Total Accounts and Available Credit quickfacts were removed here —
  // Available Credit now lives on Quick Look's Credit Card card (with a
  // breakdown per card, not just a combined total), and Total Accounts
  // duplicated info the Accounts page itself already shows.
}

function safe(num) {
  const n = isNaN(num) || num == null ? 0 : parseFloat(num);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Blends savings habit, budget discipline, this-month cash flow and net
// worth into one 0-100 financial health score, plus the raw 0-100 bar
// widths used to visualize each contributing factor.
function computeFinancialHealthScore({ savingsRate, budgetPerformance, currentMonthBalance, currentMonthIncome, totalNetWorth }) {
  // Savings rate: full marks at a 20%+ savings rate (a common budgeting
  // guideline), 35 of the 100 points.
  const savingsBar = clamp((savingsRate / 20) * 100, 0, 100);
  const savingsPts = (savingsBar / 100) * 35;

  // Budget adherence: share of budgets currently on track, 25 points.
  // No budgets set yet reads as neutral rather than a failing score.
  const hasBudgets = budgetPerformance.totalBudgets > 0;
  const budgetBar = hasBudgets ? (budgetPerformance.onTrackCount / budgetPerformance.totalBudgets) * 100 : 0;
  const budgetPts = hasBudgets ? (budgetBar / 100) * 25 : 20;

  // This month's cash flow as a share of income, 25 points. A ratio of 0
  // (broke even) sits at the middle of the bar/points range.
  const cashflowRatio = currentMonthIncome > 0
    ? clamp(currentMonthBalance / currentMonthIncome, -1, 1)
    : (currentMonthBalance >= 0 ? 1 : -1);
  const cashflowBar = (cashflowRatio + 1) * 50;
  const cashflowPts = (cashflowBar / 100) * 25;

  // Net worth in the black, 15 points. Scaled against a $50k band purely
  // as a heuristic so a deeply negative net worth doesn't zero out
  // instantly, not a claim about what "enough" net worth is.
  const netWorthPts = totalNetWorth >= 0 ? 15 : clamp(15 + (totalNetWorth / 50000) * 15, 0, 15);

  const score = Math.round(clamp(savingsPts + budgetPts + cashflowPts + netWorthPts, 0, 100));

  let band, color;
  if (score >= 80)      { band = 'Excellent'; color = 'var(--success)'; }
  else if (score >= 60) { band = 'Good';      color = 'var(--accent)'; }
  else if (score >= 40) { band = 'Fair';      color = '#ea7c1c'; }
  else if (score >= 20) { band = 'Needs Attention'; color = '#f59e0b'; }
  else                  { band = 'At Risk';   color = 'var(--danger)'; }

  return { score, band, color, savingsBar, budgetBar, cashflowBar, hasBudgets };
}

// Renders the score as an SVG ring gauge — a big centered number with a
// colored arc showing progress out of 100, the pattern used by most
// consumer finance apps (credit-score dials, "financial wellness" scores).
function renderHealthGauge(health) {
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (health.score / 100) * circumference;
  return `
    <svg viewBox="0 0 120 120" class="health-gauge-svg" role="img" aria-label="Financial health score ${health.score} out of 100, ${health.band}">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="10" style="stroke: var(--bg-muted);" />
      <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="10" stroke-linecap="round"
        style="stroke: ${health.color}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transition: stroke-dashoffset 0.6s ease;"
        transform="rotate(-90 60 60)" />
    </svg>
    <div class="health-gauge-center">
      <span class="health-gauge-score">${health.score}</span>
      <span class="health-gauge-max">/100</span>
    </div>
  `;
}

function renderHealthFactorRow(icon, label, valueText, barPct, barColor) {
  return `
    <div class="health-factor-row">
      <div class="health-factor-icon">${icon}</div>
      <div class="health-factor-main">
        <div class="health-factor-top">
          <span class="health-factor-label">${label}</span>
          <span class="health-factor-value">${valueText}</span>
        </div>
        <div class="health-factor-bar-track">
          <div class="health-factor-bar-fill" style="width: ${clamp(barPct, 0, 100)}%; background: ${barColor};"></div>
        </div>
      </div>
    </div>
  `;
}

// Cleanup function to stop auto-refresh when leaving dashboard
export function cleanupDashboardTabs() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  cleanupQuickLook();

  // Reset the "already rendered" flag initDashboardTabsUI() uses to decide
  // whether a call is an in-place refresh (preserve scroll position) or a
  // fresh navigation into the page (behave as before: show the spinner,
  // let the router's own scroll-to-top stand). The router calls this on
  // every navigation away from Dashboard, so the next time someone
  // navigates back in, it's treated as fresh again rather than as a
  // continuation of the scroll position from whatever page they were on.
  const mainContent = document.getElementById('mainContent');
  if (mainContent) delete mainContent.dataset.dashboardRendered;
}