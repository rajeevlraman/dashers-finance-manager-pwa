// ============================================================================
// 💸 expenses.js — Enhanced Unified Expense Manager with Transaction Integration
// ============================================================================

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES } from './db.js';
import { generateId, getFinancialYear } from './db.js';
import { syncAllPropertyExpenses } from './transactions.js';
import { escapeHtml } from './sanitize.js';
// Bug fix: this used to be a second, independently-hardcoded copy of the
// exact same bucket definitions already in propertyExpenseCategories.js —
// two sources of truth for the same data that could silently drift apart
// (e.g. a color or deductibility tweak made in one place but not the
// other). Now this file just re-exports the shared definitions.
import { PROPERTY_EXPENSE_CATEGORIES, getExpenseCategoryBucket } from './propertyExpenseCategories.js';
// Council Rates / Land Tax specifically don't require a propertyId to
// count (see ratesAndTax.js's own reasoning) — most bank-imported
// rates/land-tax transactions, and plenty of hand-entered bills, never
// get linked to a property. Reusing the same merge function the Finance
// Overview "Property Rates & Taxes" card uses keeps this page's totals
// (and its Unpaid Bills count) in lockstep with that card instead of
// silently under-counting against it.
import { getRatesAndTaxEntries } from './ratesAndTax.js';

import { formatMoney, toAudTransactions } from './utils/currency.js';
const EXPENSE_CATEGORIES = PROPERTY_EXPENSE_CATEGORIES;

// ============================================================================
// 🏗️ Initialize Enhanced Expenses UI
// ============================================================================
export async function initExpensesUI() {
  const main = document.getElementById('mainContent');

  main.innerHTML = `
    <div class="page-header">
      <div class="header-content">
        <h1>💸 Property Expense Management</h1>
        <p>Track, analyze, and optimize your property expenses (Auto-synced from Transactions)</p>
      </div>
      <div class="header-actions">
        <button id="btnSyncExpenses" class="btn btn-outline">🔄 Sync from Transactions</button>
        <button id="btnQuickExpense" class="btn btn-outline">⚡ Quick Add</button>
        <button id="btnNewExpense" class="btn btn-primary">➕ Add Expense</button>
        <button id="btnExportExpenses" class="btn btn-secondary">📤 Export</button>
      </div>
    </div>

    <!-- Sync Status Banner -->
    <div id="syncStatusBanner" class="sync-banner" style="display: none;">
      <span id="syncStatusText"></span>
      <button id="btnDismissSync" class="btn btn-text">✕</button>
    </div>

    <!-- Enhanced Filters -->
    <div class="filters-card">
      <div class="filter-group">
        <label>Property</label>
        <select id="filterProperty" class="form-select">
          <option value="">All Properties</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Category</label>
        <select id="filterCategory" class="form-select">
          <option value="">All Categories</option>
          ${Object.keys(EXPENSE_CATEGORIES).map(cat => 
            `<option value="${cat}">${cat}</option>`
          ).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Date Range</label>
        <select id="filterPeriod" class="form-select">
          <option value="all">All Time</option>
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
          <option value="year">This Financial Year</option>
          <option value="custom">Custom Range</option>
        </select>
      </div>
      <div class="filter-group" id="customDateRange" style="display: none;">
        <label>From</label>
        <input type="date" id="filterDateFrom" class="form-input">
        <label>To</label>
        <input type="date" id="filterDateTo" class="form-input">
      </div>
      <div class="filter-group">
        <label>Source</label>
        <select id="filterSource" class="form-select">
          <option value="">All Sources</option>
          <option value="transaction">📊 From Transactions</option>
          <option value="expense">💸 Direct Entry</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Status</label>
        <select id="filterStatus" class="form-select">
          <option value="">All Status</option>
          <option value="Paid">Paid</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Reimbursed">Reimbursed</option>
        </select>
      </div>
      <button id="btnApplyFilters" class="btn btn-primary">Apply Filters</button>
      <button id="btnResetFilters" class="btn btn-outline">Reset</button>
    </div>

    <!-- Enhanced Summary Dashboard -->
    <div class="dashboard-grid page-compact-cards" id="expensesDashboard">
      <div class="summary-card highlight">
        <div class="summary-icon">💰</div>
        <div class="summary-content">
          <div class="summary-value" id="totalExpenses">$0</div>
          <div class="summary-label">Total Expenses</div>
          <div class="summary-trend" id="expenseTrend">Loading...</div>
        </div>
      </div>
      
      <div class="summary-card">
        <div class="summary-icon">📊</div>
        <div class="summary-content">
          <div class="summary-value" id="avgMonthly">$0</div>
          <div class="summary-label">Avg Monthly</div>
        </div>
      </div>
      
      <div class="summary-card warning">
        <div class="summary-icon">⏰</div>
        <div class="summary-content">
          <div class="summary-value" id="unpaidCount">0</div>
          <div class="summary-label">Unpaid Bills</div>
          <div class="summary-trend" id="unpaidDetail">Loading...</div>
        </div>
      </div>
      
      <div class="summary-card success">
        <div class="summary-icon">🎯</div>
        <div class="summary-content">
          <div class="summary-value" id="taxDeductions">$0</div>
          <div class="summary-label">Tax Deductible</div>
        </div>
      </div>
    </div>

    <!-- Source Distribution -->
    <div class="dashboard-grid page-compact-cards">
      <div class="summary-card">
        <div class="summary-icon">📊</div>
        <div class="summary-content">
          <div class="summary-value" id="fromTransactions">0</div>
          <div class="summary-label">From Transactions</div>
        </div>
      </div>
      
      <div class="summary-card">
        <div class="summary-icon">💸</div>
        <div class="summary-content">
          <div class="summary-value" id="directEntries">0</div>
          <div class="summary-label">Direct Entries</div>
        </div>
      </div>
    </div>

    <!-- Charts Section -->
    <div class="charts-container">
      <div class="chart-card">
        <div class="chart-header">
          <h3>📊 Expenses by Category</h3>
          <select id="chartType" class="form-select">
            <option value="pie">Pie Chart</option>
            <option value="bar">Bar Chart</option>
            <option value="line">Trend Line</option>
          </select>
        </div>
        <canvas id="expenseChart" height="300"></canvas>
      </div>
      
      <div class="chart-card">
        <div class="chart-header">
          <h3>📊 Expenses by Source</h3>
          <button id="btnToggleSource" class="btn btn-outline">Show Details</button>
        </div>
        <canvas id="sourceChart" height="300"></canvas>
      </div>
    </div>

    <!-- Enhanced Expenses List -->
    <div class="section-card">
      <div class="section-header">
        <h3>🧾 Property Expense Records</h3>
        <div class="section-actions">
          <span class="record-count" id="expenseCount">0 expenses</span>
          <div class="source-filter">
            <span class="filter-label">Show:</span>
            <button class="filter-btn active" data-source="">All</button>
            <button class="filter-btn" data-source="transaction">📊 Transactions</button>
            <button class="filter-btn" data-source="expense">💸 Direct</button>
          </div>
          <button id="btnBulkActions" class="btn btn-outline">🔄 Bulk Actions</button>
        </div>
      </div>
      <div id="expensesList" class="expenses-list">
        <div class="loading-state">Loading expenses...</div>
      </div>
    </div>

    <!-- Sync Info Card -->
    <div class="section-card info-card">
      <div class="info-header">
        <h3>🔄 How It Works</h3>
      </div>
      <div class="info-content">
        <p><strong>Auto-Sync Feature:</strong></p>
        <ul>
          <li>✅ When you mark a transaction as a "Property Expense", it automatically appears here</li>
          <li>✅ Click "Sync from Transactions" to import existing property expenses</li>
          <li>✅ Expenses from transactions are read-only (edit them in Transactions page)</li>
          <li>✅ Direct entries here don't create transactions automatically</li>
        </ul>
        <div class="info-actions">
          <button class="btn btn-primary" onclick="window.loadView('transactions')">
            ➕ Add Property Expense via Transactions
          </button>
        </div>
      </div>
    </div>
  `;

  setupEventListeners();
  await populateFilters();
  await refreshExpensesDashboard();
}

// ============================================================================
// 🎛️ Setup Event Listeners
// ============================================================================
function setupEventListeners() {
  document.getElementById('btnNewExpense').addEventListener('click', () => openExpenseForm());
  document.getElementById('btnQuickExpense').addEventListener('click', () => openQuickExpenseForm());
  document.getElementById('btnExportExpenses').addEventListener('click', exportExpenses);
  document.getElementById('btnApplyFilters').addEventListener('click', refreshExpensesDashboard);
  document.getElementById('btnResetFilters').addEventListener('click', resetFilters);
  document.getElementById('btnBulkActions').addEventListener('click', () => window.showBulkActions());
  document.getElementById('btnSyncExpenses').addEventListener('click', syncFromTransactions);
  document.getElementById('btnDismissSync').addEventListener('click', () => {
    document.getElementById('syncStatusBanner').style.display = 'none';
  });
  
  document.getElementById('filterPeriod').addEventListener('change', function() {
    document.getElementById('customDateRange').style.display = 
      this.value === 'custom' ? 'grid' : 'none';
  });
  
  document.getElementById('chartType').addEventListener('change', refreshExpensesDashboard);

  document.getElementById('btnToggleSource').addEventListener('click', async () => {
    // Bug fix: this button rendered but had no listener at all - clicking
    // it did nothing. It now resets the source filter to "All" and jumps
    // down to the always-visible transactions list below (see
    // renderEnhancedExpenseList) rather than opening a separate popup -
    // the list already shows every underlying transaction/expense record.
    try {
      await applySourceFilter('');
    } catch (err) {
      console.error('[Expenses] Failed to refresh from Show Details', err);
    }
    jumpToExpensesList();
  });
  
  // Source filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('filterSource').value = this.dataset.source;
      refreshExpensesDashboard();
    });
  });
}

// ============================================================================
// 🧩 Enhanced Filter Population
// ============================================================================
async function populateFilters() {
  const properties = await getAllItems(STORE_NAMES.properties || 'properties').catch(() => []);
  const propertySelect = document.getElementById('filterProperty');
  propertySelect.innerHTML =
    `<option value="">All Properties</option>` +
    properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  // Default to All Time. This used to default to "This Financial Year",
  // which silently filtered the transactions list AND the category pie
  // chart down to nothing whenever a property's expenses were dated
  // before the current FY start (1 July) - which is most of the time,
  // since the FY window is only a few weeks old for most of the year.
  // Both empty views trace back to this one filter, since
  // refreshExpensesDashboard() feeds the same filteredExpenses into the
  // chart, the list, and the summary cards. "All Time" is a safer
  // default; people who want the current FY can still pick it from the
  // dropdown.
  document.getElementById('filterPeriod').value = 'all';
}

// ============================================================================
// 🔁 Enhanced Dashboard Refresh
// ============================================================================
async function refreshExpensesDashboard() {
  const allExpenses = await getAllPropertyExpenses();
  const properties = await getAllItems(STORE_NAMES.properties || 'properties').catch(() => []);
  const budgets = await getAllItems(STORE_NAMES.budgets).catch(() => []);

  const filteredExpenses = applyFilters(allExpenses);
  renderEnhancedSummary(filteredExpenses, allExpenses, budgets);
  renderEnhancedCharts(filteredExpenses, properties);
  renderEnhancedExpenseList(filteredExpenses, properties);
  renderSourceDistribution(allExpenses);
}

// ============================================================================
// 🔍 Apply Enhanced Filters
// ============================================================================
function applyFilters(expenses) {
  const filterProperty = document.getElementById('filterProperty').value;
  const filterCategory = document.getElementById('filterCategory').value;
  const filterPeriod = document.getElementById('filterPeriod').value;
  const filterStatus = document.getElementById('filterStatus').value;
  const filterSource = document.getElementById('filterSource').value;
  
  let filtered = [...expenses];
  
  if (filterProperty) filtered = filtered.filter(e => e.propertyId === filterProperty);
  if (filterCategory) filtered = filtered.filter(e => e.category === filterCategory);
  if (filterStatus) filtered = filtered.filter(e => e.status === filterStatus);
  if (filterSource) filtered = filtered.filter(e => e.source === filterSource);
  
  // Date filtering
  const now = new Date();
  switch(filterPeriod) {
    case 'month':
      filtered = filtered.filter(e => {
        const expenseDate = new Date(e.date);
        return expenseDate.getMonth() === now.getMonth() && 
               expenseDate.getFullYear() === now.getFullYear();
      });
      break;
    case 'quarter':
      const quarter = Math.floor(now.getMonth() / 3);
      filtered = filtered.filter(e => {
        const expenseDate = new Date(e.date);
        return Math.floor(expenseDate.getMonth() / 3) === quarter && 
               expenseDate.getFullYear() === now.getFullYear();
      });
      break;
    case 'year':
      const fyStart = new Date(now.getFullYear() - (now.getMonth() < 6 ? 1 : 0), 6, 1);
      const fyEnd = new Date(fyStart.getFullYear() + 1, 5, 30);
      filtered = filtered.filter(e => {
        const expenseDate = new Date(e.date);
        return expenseDate >= fyStart && expenseDate <= fyEnd;
      });
      break;
    case 'custom':
      const from = document.getElementById('filterDateFrom').value;
      const to = document.getElementById('filterDateTo').value;
      if (from) filtered = filtered.filter(e => e.date >= from);
      if (to) filtered = filtered.filter(e => e.date <= to);
      break;
  }
  
  return filtered;
}

// ============================================================================
// 🏠 Get All Property Expenses (Combined from both sources)
// ============================================================================
async function getAllPropertyExpenses() {
  try {
    // Get expenses from expenses table
    const directExpenses = await getAllItems(STORE_NAMES.expenses || 'expenses').catch(() => []);
    
    // Get property-related transactions
    const fxAccounts = await getAllItems(STORE_NAMES.accounts).catch(() => []);
    const transactions = toAudTransactions(await getAllItems(STORE_NAMES.transactions).catch(() => []), fxAccounts);
    const propertyTransactions = transactions.filter(t => 
      t.type === 'expense' && t.propertyId && t.isPropertyExpense
    );
    
    // Convert property transactions to expense format
    const transactionExpenses = propertyTransactions.map(t => ({
      id: t.id,
      transactionId: t.id,
      propertyId: t.propertyId,
      category: t.expenseCategory || 'Other',
      description: t.description || 'Property Expense',
      amount: Math.abs(t.amount),
      date: t.date,
      status: t.expenseStatus || 'Paid',
      receiptUrl: t.receiptUrl || '',
      notes: t.notes || '',
      taxDeductible: true,
      recurring: false,
      frequency: 'monthly',
      nextDue: t.date,
      source: 'transaction', // Flag to identify source
      isReadOnly: true, // Can't edit these directly
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));

    // Unpaid bills linked to a property never produce a transaction at all
    // (markBillPaid() in bills.js only creates one once you actually pay
    // it), so without this they're invisible here no matter how the two
    // sources above are merged - there's no paid-side record for them to
    // ride in on. Bills use `!!bill.propertyId` as their own definition of
    // "this is a property expense" (see bills.js), so unpaid ones follow
    // the same rule here for consistency; category falls back through the
    // same bucket mapping the auto-import pipeline uses everywhere else.
    const bills = await getAllItems(STORE_NAMES.bills).catch(() => []);
    const unpaidBillExpenses = bills
      .filter(b => !b.paid && b.propertyId)
      .map(b => ({
        id: b.id,
        billId: b.id,
        propertyId: b.propertyId,
        category: getExpenseCategoryBucket(b.categoryId),
        description: b.name || 'Bill',
        amount: Math.abs(b.amount || 0),
        date: b.dueDate,
        status: 'Unpaid',
        receiptUrl: '',
        notes: '',
        taxDeductible: true,
        recurring: !!b.recurring,
        frequency: b.frequency || 'monthly',
        nextDue: b.dueDate,
        source: 'bill', // Flag to identify source
        isReadOnly: true, // Can't edit these directly - go to the Bills page
        createdAt: b.createdAt,
        updatedAt: b.updatedAt
      }));
    
    // Add source to direct expenses
    const directWithSource = directExpenses.map(e => ({
      ...e,
      source: 'expense',
      isReadOnly: false
    }));
    
    // Combine and deduplicate (favor expenses table over transactions;
    // a bill is either paid - already covered by its resulting
    // transaction/expense above - or unpaid - only ever represented by
    // unpaidBillExpenses - so no dedup is needed against it, but the
    // billId check below guards against any future path that might add
    // both).
    const allExpenses = [...directWithSource];
    
    transactionExpenses.forEach(te => {
      if (!allExpenses.find(e => e.transactionId === te.transactionId)) {
        allExpenses.push(te);
      }
    });

    unpaidBillExpenses.forEach(be => {
      if (!allExpenses.find(e => e.billId === be.billId)) {
        allExpenses.push(be);
      }
    });

    // Backfill any Council Rates / Land Tax entry the property-scoped
    // merge above missed because it had no propertyId (an unlinked paid
    // transaction with no isPropertyExpense flag, or an unlinked unpaid
    // bill) — see the import comment above for why this bucket alone
    // skips that requirement. Deduped the same way as everything else
    // here: by transactionId/billId first, falling back to the entry's
    // own id for a direct `expenses` row (which getRatesAndTaxEntries
    // already includes, so this only ever adds what's missing).
    const ratesAndTaxEntries = getRatesAndTaxEntries({ expenses: directExpenses, transactions, bills });
    ratesAndTaxEntries.forEach(e => {
      const alreadyIncluded = allExpenses.some(x =>
        (e.transactionId && x.transactionId === e.transactionId) ||
        (e.billId && x.billId === e.billId) ||
        (!e.transactionId && !e.billId && x.id === e.id)
      );
      if (alreadyIncluded) return;
      allExpenses.push({
        id: e.id,
        transactionId: e.transactionId,
        billId: e.billId,
        propertyId: e.propertyId,
        category: e.category,
        description: e.description || e.category,
        amount: e.amount,
        date: e.date,
        status: e.status,
        receiptUrl: '',
        notes: '',
        taxDeductible: true,
        recurring: false,
        frequency: 'monthly',
        nextDue: e.date,
        source: e.source === 'transaction' ? 'transaction' : (e.source === 'bill' ? 'bill' : 'expense'),
        isReadOnly: true
      });
    });

    return allExpenses;
  } catch (error) {
    console.error('❌ Error getting property expenses:', error);
    return [];
  }
}

// ============================================================================
// 💰 Enhanced Summary Dashboard
// ============================================================================
// Relative day label for the "next due" callout below — a small local
// copy of the same overdue/in-Nd formatting financeOverview.js's list
// tabs use, since this file has no existing shared import for it.
function relativeDueLabel(dateStr) {
  if (!dateStr) return '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays > 0) return `${diffDays}d`;
  return `${Math.abs(diffDays)}d overdue`;
}

function renderEnhancedSummary(filteredExpenses, allExpenses, budgets) {
  const total = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const unpaidItems = filteredExpenses.filter(e => e.status === 'Unpaid');
  const unpaid = unpaidItems.length;
  const unpaidTotal = unpaidItems.reduce((sum, e) => sum + (e.amount || 0), 0);
  const taxDeductible = filteredExpenses
    .filter(e => EXPENSE_CATEGORIES[e.category]?.deductible)
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  
  // Calculate average monthly
  const monthlyExpenses = calculateMonthlyAverage(allExpenses);
  
  // Calculate trend (compared to previous period)
  const trend = calculateExpenseTrend(allExpenses);
  
  document.getElementById('totalExpenses').textContent = formatCurrency(total);
  document.getElementById('avgMonthly').textContent = formatCurrency(monthlyExpenses);
  document.getElementById('unpaidCount').textContent = unpaid;
  document.getElementById('taxDeductions').textContent = formatCurrency(taxDeductible);

  // Summarised detail under the raw count — "9" on its own doesn't say
  // whether that's $80 or $8,000 owed, or which one needs attention
  // first, so surface the total owed, how many are already overdue, and
  // the soonest-due item, the same way the Bills page prioritises them.
  const unpaidDetailEl = document.getElementById('unpaidDetail');
  if (unpaid === 0) {
    unpaidDetailEl.innerHTML = `<span style="color: #10b981">All caught up</span>`;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const overdueCount = unpaidItems.filter(e => e.date && e.date < today).length;
    const nextDue = unpaidItems
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
    const parts = [`${formatCurrency(unpaidTotal)} owed`];
    if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
    if (nextDue) parts.push(`next: ${escapeHtml(nextDue.description || nextDue.category)} (${relativeDueLabel(nextDue.date)})`);
    unpaidDetailEl.innerHTML = `<span style="color: ${overdueCount > 0 ? '#ef4444' : 'inherit'}">${parts.join(' · ')}</span>`;
  }
  
  const trendElement = document.getElementById('expenseTrend');
  if (trend > 0) {
    trendElement.innerHTML = `<span style="color: #ef4444">↑ ${trend}% from last period</span>`;
  } else if (trend < 0) {
    trendElement.innerHTML = `<span style="color: #10b981">↓ ${Math.abs(trend)}% from last period</span>`;
  } else {
    trendElement.innerHTML = `<span style="color: #6b7280">No change</span>`;
  }
}

// ============================================================================
// 📊 Source Distribution
// ============================================================================
function renderSourceDistribution(expenses) {
  const fromTransactions = expenses.filter(e => e.source === 'transaction').length;
  const directEntries = expenses.filter(e => e.source === 'expense').length;
  
  document.getElementById('fromTransactions').textContent = fromTransactions;
  document.getElementById('directEntries').textContent = directEntries;
  
  // Update source chart
  const ctx = document.getElementById('sourceChart').getContext('2d');
  
  if (window.sourceChartInstance) window.sourceChartInstance.destroy();
  
  window.sourceChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['From Transactions', 'Direct Entries'],
      datasets: [{
        data: [fromTransactions, directEntries],
        backgroundColor: ['#3B82F6', '#10B981'],
        borderColor: ['#2563EB', '#059669'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      // Feature: clicking a segment (e.g. "Direct Entries") now filters
      // the always-visible transactions/expenses list below to just that
      // source and scrolls to it, instead of the chart being a dead end.
      //
      // Bug fix: see the matching comment on renderCategoryChart's onClick
      // - refreshing here also destroys/recreates THIS chart instance
      // synchronously inside its own click handler, which throws and
      // aborts the refresh before the list updates. Deferred for the same
      // reason.
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const source = elements[0].index === 0 ? 'transaction' : 'expense';
        setTimeout(async () => {
          try {
            await applySourceFilter(source);
          } catch (err) {
            console.error('[Expenses] Failed to refresh after chart click', err);
          }
          jumpToExpensesList();
        }, 0);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { 
          position: 'bottom',
          labels: { usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
              return `${context.label}: ${context.raw} expenses (${percentage}%) - click to view`;
            }
          }
        }
      }
    }
  });
}

// Sets the Source filter (dropdown + matching pill button) to the given
// value and re-renders, shared by the source chart's onClick above and the
// filter-pill buttons already in the header.
async function applySourceFilter(source) {
  document.getElementById('filterSource').value = source;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.filter-btn[data-source="${source}"]`)?.classList.add('active');
  await refreshExpensesDashboard();
}

// Scrolls the always-visible "Property Expense Records" card into view and
// gives it a brief highlight flash, so a chart click has an obvious,
// visible result even when the list was already off-screen below the fold.
function jumpToExpensesList() {
  const section = document.getElementById('expensesList')?.closest('.section-card');
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const originalTransition = section.style.transition;
  const originalShadow = section.style.boxShadow;
  section.style.transition = 'box-shadow 0.3s ease';
  section.style.boxShadow = '0 0 0 3px #3B82F6';
  setTimeout(() => {
    section.style.boxShadow = originalShadow;
    setTimeout(() => { section.style.transition = originalTransition; }, 300);
  }, 900);
}

// ============================================================================
// 📊 Enhanced Charts
// ============================================================================
function renderEnhancedCharts(expenses, properties) {
  renderCategoryChart(expenses);
}

function renderCategoryChart(expenses) {
  const ctx = document.getElementById('expenseChart').getContext('2d');
  const chartType = document.getElementById('chartType').value;
  
  const categories = {};
  expenses.forEach(e => {
    categories[e.category] = (categories[e.category] || 0) + (e.amount || 0);
  });

  const labels = Object.keys(categories);
  const data = Object.values(categories);
  const backgroundColors = labels.map(cat => EXPENSE_CATEGORIES[cat]?.color || '#6B7280');

  if (window.expenseChartInstance) window.expenseChartInstance.destroy();
  
  window.expenseChartInstance = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: backgroundColors,
        borderColor: backgroundColors.map(color => color.replace('0.6', '1')),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      // Feature: clicking a category slice/bar (e.g. "Insurance") now
      // filters the always-visible transactions/expenses list below to
      // just that category and scrolls to it, so "which transactions made
      // up this $X" is one click away instead of a dead end.
      //
      // Bug fix: refreshExpensesDashboard() ends up destroying and
      // recreating THIS SAME chart instance (via renderEnhancedCharts),
      // and doing that synchronously from inside the chart's own onClick
      // handler throws inside Chart.js's event dispatch - which aborted
      // refreshExpensesDashboard() partway through, before it ever reached
      // renderEnhancedExpenseList(). The scroll still happened (a separate
      // statement, unaffected by the error), which is why the page jumped
      // down but the list never actually updated. Deferring to the next
      // tick lets Chart.js finish dispatching this click before its own
      // chart gets torn down.
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const category = labels[elements[0].index];
        if (!category) return;
        setTimeout(async () => {
          document.getElementById('filterCategory').value = category;
          try {
            await refreshExpensesDashboard();
          } catch (err) {
            console.error('[Expenses] Failed to refresh after chart click', err);
          }
          jumpToExpensesList();
        }, 0);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { 
          position: 'bottom',
          labels: { usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
              return `${context.label}: ${formatCurrency(context.raw)} (${percentage}%) - click to view`;
            }
          }
        }
      },
      scales: chartType === 'bar' ? {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => formatCurrency(value)
          }
        }
      } : undefined
    }
  });
}

// ============================================================================
// 🧾 Enhanced Expense List with Source Indicators
// ============================================================================
function renderEnhancedExpenseList(expenses, properties) {
  const list = document.getElementById('expensesList');
  const count = document.getElementById('expenseCount');

  count.textContent = `${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`;

  if (!expenses.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <h3>No property expenses found</h3>
        <p>No expenses match the current filters. This can happen if the date range (e.g. "This Financial Year") excludes older records.</p>
        <div class="empty-actions">
          <button class="btn btn-primary" onclick="resetFilters()">
            ↺ Reset Filters
          </button>
          <button class="btn btn-outline" onclick="window.loadView('transactions')">
            ➕ Add via Transactions
          </button>
          <button class="btn btn-outline" onclick="syncFromTransactions()">
            🔄 Sync Existing
          </button>
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Property</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Date</th>
            <th>Status</th>
            <th>Source</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${expenses.map(expense => {
            const property = properties.find(p => p.id === expense.propertyId);
            const categoryInfo = EXPENSE_CATEGORIES[expense.category];
            const isFromTransaction = expense.source === 'transaction';
            
            return `
              <tr class="expense-row ${expense.status === 'Unpaid' ? 'unpaid' : ''}">
                <td>
                  <div class="expense-description">
                    <strong>${escapeHtml(expense.description) || 'Unnamed Expense'}</strong>
                    ${expense.receiptUrl ? '<span class="receipt-badge">📎</span>' : ''}
                  </div>
                </td>
                <td>${property ? escapeHtml(property.name) : 'General'}</td>
                <td>
                  <span class="category-tag" style="background: ${categoryInfo?.color || '#6B7280'}22; color: ${categoryInfo?.color || '#6B7280'};">
                    ${expense.category}
                  </span>
                </td>
                <td class="amount-cell">${formatCurrency(expense.amount)}</td>
                <td>${new Date(expense.date).toLocaleDateString('en-AU')}</td>
                <td>
                  <span class="status-badge status-${expense.status?.toLowerCase()}">
                    ${expense.status}
                  </span>
                </td>
                <td>
                  <span class="source-badge ${isFromTransaction ? 'source-transaction' : 'source-direct'}">
                    ${isFromTransaction ? '📊 Transaction' : '💸 Direct'}
                  </span>
                </td>
                <td>
                  <div class="action-buttons">
                    ${isFromTransaction ? `
                      <button class="btn-icon" onclick="viewTransaction('${expense.transactionId}')" title="View Transaction">
                        👁️
                      </button>
                      <button class="btn-icon" disabled title="Edit in Transactions page">
                        ✏️
                      </button>
                    ` : `
                      <button class="btn-icon" onclick="openExpenseForm('${expense.id}')" title="Edit">
                        ✏️
                      </button>
                      <button class="btn-icon" onclick="duplicateExpense('${expense.id}')" title="Duplicate">
                        📋
                      </button>
                      <button class="btn-icon btn-danger" onclick="confirmDeleteExpense('${expense.id}')" title="Delete">
                        🗑️
                      </button>
                    `}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 🔄 Sync from Transactions
// ============================================================================
async function syncFromTransactions() {
  try {
    const btn = document.getElementById('btnSyncExpenses');
    const originalText = btn.textContent;
    btn.textContent = '🔄 Syncing...';
    btn.disabled = true;
    
    const result = await syncAllPropertyExpenses();
    
    // Show sync status banner
    const banner = document.getElementById('syncStatusBanner');
    const bannerText = document.getElementById('syncStatusText');
    
    banner.style.display = 'flex';
    banner.style.backgroundColor = result.synced > 0 ? '#10B981' : '#3B82F6';
    bannerText.textContent = result.message;
    
    // Refresh the dashboard
    await refreshExpensesDashboard();
    
    btn.textContent = originalText;
    btn.disabled = false;
    
    // Auto-hide banner after 5 seconds
    setTimeout(() => {
      banner.style.display = 'none';
    }, 5000);
    
  } catch (error) {
    console.error('❌ Error syncing from transactions:', error);
    alert('Error syncing from transactions: ' + error.message);
    
    const btn = document.getElementById('btnSyncExpenses');
    btn.textContent = '🔄 Sync from Transactions';
    btn.disabled = false;
  }
}

// ============================================================================
// 👁️ View Transaction
// ============================================================================
function viewTransaction(transactionId) {
  // Navigate to transactions page and highlight the transaction
  window.loadView('transactions');
  
  // Store the transaction ID to scroll to it
  setTimeout(() => {
    localStorage.setItem('highlightTransactionId', transactionId);
    // The transactions page should check for this and scroll to it
  }, 500);
}

// ============================================================================
// ➕ Enhanced Expense Form (Direct Entry)
// ============================================================================
async function openExpenseForm(id = null) {
  const main = document.getElementById('mainContent');
  const properties = await getAllItems(STORE_NAMES.properties || 'properties').catch(() => []);
  const existingExpenses = await getAllItems(STORE_NAMES.expenses || 'expenses').catch(() => []);
  const expense = id ? existingExpenses.find(e => e.id === id) : {
    id: null,
    propertyId: '',
    category: 'Other',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    recurring: false,
    frequency: 'monthly',
    status: 'Unpaid',
    receiptUrl: '',
    notes: ''
  };

  // Don't allow editing of transaction-based expenses
  if (expense.source === 'transaction') {
    alert('This expense came from a transaction. Please edit it in the Transactions page.');
    return;
  }

  main.innerHTML = `
    <div class="form-container">
      <div class="form-header">
        <h2>${id ? 'Edit Expense' : 'Add Direct Expense'}</h2>
        <div class="form-subheader">
          <span class="form-note">💡 Note: Direct expenses don't create transactions automatically</span>
          <button class="btn btn-outline" onclick="initExpensesUI()">← Back to Expenses</button>
        </div>
      </div>
      
      <form id="expenseForm" class="styled-form">
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Description *</label>
            <input type="text" name="description" value="${escapeHtml(expense.description) || ''}" 
                   class="form-input" placeholder="What was this expense for?" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Property</label>
            <select name="propertyId" class="form-select">
              <option value="">General (No Property)</option>
              ${properties.map(p => 
                `<option value="${p.id}" ${p.id === expense.propertyId ? 'selected' : ''}>
                  ${escapeHtml(p.name)}
                </option>`
              ).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Category *</label>
            <select name="category" class="form-select" required>
              ${Object.keys(EXPENSE_CATEGORIES).map(cat => 
                `<option value="${cat}" ${expense.category === cat ? 'selected' : ''}
                 style="color: ${EXPENSE_CATEGORIES[cat].color}">
                  ${cat} ${EXPENSE_CATEGORIES[cat].deductible ? '✓' : '✗'}
                </option>`
              ).join('')}
            </select>
            <div class="form-hint" id="categoryHint"></div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Amount (AUD) *</label>
            <input type="number" step="0.01" name="amount" value="${expense.amount}" 
                   class="form-input" placeholder="0.00" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input type="date" name="date" value="${expense.date}" class="form-input" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status" class="form-select">
              <option value="Paid" ${expense.status === 'Paid' ? 'selected' : ''}>Paid</option>
              <option value="Unpaid" ${expense.status === 'Unpaid' ? 'selected' : ''}>Unpaid</option>
              <option value="Reimbursed" ${expense.status === 'Reimbursed' ? 'selected' : ''}>Reimbursed</option>
            </select>
          </div>
        </div>
        
        <div class="form-section">
          <h3>Additional Details</h3>
          
          <div class="form-group">
            <label class="form-label">Receipt URL (optional)</label>
            <input type="url" name="receiptUrl" value="${escapeHtml(expense.receiptUrl) || ''}" 
                   class="form-input" placeholder="https://...">
          </div>
          
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea name="notes" class="form-input" rows="3" 
                      placeholder="Any additional notes about this expense">${escapeHtml(expense.notes) || ''}</textarea>
          </div>
        </div>
        
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">
            💾 ${id ? 'Update Expense' : 'Add Expense'}
          </button>
          <button type="button" class="btn btn-outline" onclick="initExpensesUI()">
            Cancel
          </button>
          ${id ? `
            <button type="button" class="btn btn-warning" onclick="duplicateExpense('${expense.id}')">
              📋 Duplicate
            </button>
          ` : ''}
        </div>
      </form>
    </div>
  `;

  // Add category hint
  const categorySelect = document.querySelector('[name="category"]');
  if (categorySelect) {
    categorySelect.addEventListener('change', function() {
      const category = EXPENSE_CATEGORIES[this.value];
      const hint = document.getElementById('categoryHint');
      if (category) {
        hint.innerHTML = `
          <span style="color: ${category.color}">
            ${category.type} expense • 
            ${category.deductible ? 'Tax deductible ✓' : 'Not tax deductible ✗'}
          </span>
        `;
      }
    });
    // Trigger change event to show initial hint
    categorySelect.dispatchEvent(new Event('change'));
  }

  document.getElementById('expenseForm').addEventListener('submit', async e => {
    e.preventDefault();
    await saveExpense(expense, new FormData(e.target));
  });
}

// ============================================================================
// 💾 Save Expense Function (Direct Entry Only)
// ============================================================================
async function saveExpense(originalExpense, formData) {
  const expenseDate = formData.get('date');
  const newExpense = {
    id: originalExpense.id || generateId(),
    propertyId: formData.get('propertyId'),
    category: formData.get('category'),
    description: formData.get('description').trim(),
    amount: parseFloat(formData.get('amount')),
    date: expenseDate,
    status: formData.get('status'),
    receiptUrl: formData.get('receiptUrl'),
    notes: formData.get('notes'),
    // Bug fix: `?? true` (not `|| true`) so an explicit `deductible: false`
    // (e.g. Capital Improvements) is respected instead of always being
    // overridden back to true.
    taxDeductible: EXPENSE_CATEGORIES[formData.get('category')]?.deductible ?? true,
    // Bug fix: this field was never populated even though expenses.js/db.js
    // both filter and index by it, silently breaking any financial-year
    // based expense lookup.
    financialYear: getFinancialYear(expenseDate),
    recurring: false,
    frequency: 'monthly',
    nextDue: expenseDate,
    source: 'expense', // Always mark as direct entry
    createdAt: originalExpense.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (originalExpense.id) {
      await updateItem(STORE_NAMES.expenses || 'expenses', newExpense);
    } else {
      await addItem(STORE_NAMES.expenses || 'expenses', newExpense);
    }
    initExpensesUI();
  } catch (err) {
    console.error('❌ Error saving expense:', err);
    alert('Error saving expense: ' + err.message);
  }
}

// ============================================================================
// ⚡ Quick Expense Form
// ============================================================================
async function openQuickExpenseForm() {
  const main = document.getElementById('mainContent');
  
  main.innerHTML = `
    <div class="quick-form-container">
      <div class="quick-form-header">
        <h2>⚡ Quick Expense (Direct Entry)</h2>
        <button class="btn btn-outline" onclick="initExpensesUI()">← Back</button>
      </div>
      
      <form id="quickExpenseForm" class="quick-form">
        <div class="quick-form-grid">
          <input type="text" name="description" placeholder="What was this for?" required
                 class="quick-input" autofocus>
          
          <input type="number" name="amount" placeholder="Amount" step="0.01" required
                 class="quick-input">
          
          <select name="category" class="quick-select" required>
            ${Object.keys(EXPENSE_CATEGORIES).map(cat => 
              `<option value="${cat}">${cat}</option>`
            ).join('')}
          </select>
          
          <button type="submit" class="btn btn-primary btn-lg">💾 Save Direct Expense</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('quickExpenseForm').addEventListener('submit', async e => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const expense = {
      id: generateId(),
      description: formData.get('description'),
      amount: parseFloat(formData.get('amount')),
      category: formData.get('category'),
      date: new Date().toISOString().split('T')[0],
      status: 'Paid',
      taxDeductible: EXPENSE_CATEGORIES[formData.get('category')]?.deductible || true,
      source: 'expense',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await addItem(STORE_NAMES.expenses || 'expenses', expense);
      initExpensesUI();
    } catch (err) {
      console.error('❌ Error saving quick expense:', err);
      alert('Error saving expense');
    }
  });
}

// ============================================================================
// 🗑️ Enhanced Delete with Confirmation
// ============================================================================
async function confirmDeleteExpense(id) {
  if (!confirm('Are you sure you want to delete this expense? This action cannot be undone.')) return;
  
  try {
    await deleteItem(STORE_NAMES.expenses || 'expenses', id);
    await refreshExpensesDashboard();
    showNotification('Expense deleted successfully', 'success');
  } catch (err) {
    console.error('❌ Error deleting expense:', err);
    showNotification('Error deleting expense', 'error');
  }
}

// ============================================================================
// 📤 Export Functionality
// ============================================================================
async function exportExpenses() {
  const expenses = await getAllPropertyExpenses();
  const properties = await getAllItems(STORE_NAMES.properties || 'properties').catch(() => []);
  
  const exportData = expenses.map(expense => {
    const property = properties.find(p => p.id === expense.propertyId);
    return {
      'Description': expense.description,
      'Property': property ? property.name : 'General',
      'Category': expense.category,
      'Amount': expense.amount,
      'Date': expense.date,
      'Status': expense.status,
      'Source': expense.source === 'transaction' ? 'Transaction' : 'Direct Entry',
      'Tax Deductible': EXPENSE_CATEGORIES[expense.category]?.deductible ? 'Yes' : 'No',
      'Receipt URL': expense.receiptUrl || '',
      'Notes': expense.notes || ''
    };
  });

  const csv = convertToCSV(exportData);
  downloadCSV(csv, `property-expenses-${new Date().toISOString().split('T')[0]}.csv`);
}

// ============================================================================
// 🛠️ Utility Functions
// ============================================================================
function formatCurrency(amount) {
  return formatMoney(amount, 'AUD');
}

function calculateMonthlyAverage(expenses) {
  if (!expenses.length) return 0;
  
  const monthlyTotals = {};
  expenses.forEach(expense => {
    const month = expense.date.substring(0, 7);
    monthlyTotals[month] = (monthlyTotals[month] || 0) + expense.amount;
  });
  
  const total = Object.values(monthlyTotals).reduce((sum, amount) => sum + amount, 0);
  return total / Object.keys(monthlyTotals).length;
}

function calculateExpenseTrend(expenses) {
  // Simplified trend calculation - compare current month with previous month
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  
  const currentMonthExpenses = expenses.filter(e => {
    const date = new Date(e.date);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  }).reduce((sum, e) => sum + e.amount, 0);
  
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  
  const prevMonthExpenses = expenses.filter(e => {
    const date = new Date(e.date);
    return date.getMonth() === prevMonth && date.getFullYear() === prevYear;
  }).reduce((sum, e) => sum + e.amount, 0);
  
  if (prevMonthExpenses === 0) return 0;
  return Math.round(((currentMonthExpenses - prevMonthExpenses) / prevMonthExpenses) * 100);
}

function convertToCSV(data) {
  if (!data.length) return '';
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
  ];
  return csv.join('\n');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};
    color: white;
    border-radius: 8px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function resetFilters() {
  document.getElementById('filterProperty').value = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterPeriod').value = 'all';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterSource').value = '';
  document.getElementById('customDateRange').style.display = 'none';
  document.querySelectorAll('.filter-btn').forEach((btn, index) => {
    btn.classList.toggle('active', index === 0);
  });
  refreshExpensesDashboard();
}

// ============================================================================
// 🌐 Global Function Exports
// ============================================================================
window.openExpenseForm = openExpenseForm;
window.openQuickExpenseForm = openQuickExpenseForm;
window.resetFilters = resetFilters;
window.confirmDeleteExpense = confirmDeleteExpense;
window.syncFromTransactions = syncFromTransactions;
window.viewTransaction = viewTransaction;
window.duplicateExpense = async function(id) {
  const expenses = await getAllItems(STORE_NAMES.expenses || 'expenses').catch(() => []);
  const original = expenses.find(e => e.id === id);
  if (original) {
    const duplicate = { ...original, id: generateId() };
    duplicate.description = `${duplicate.description} (Copy)`;
    duplicate.createdAt = new Date().toISOString();
    duplicate.updatedAt = new Date().toISOString();
    await addItem(STORE_NAMES.expenses || 'expenses', duplicate);
    refreshExpensesDashboard();
    showNotification('Expense duplicated successfully', 'success');
  }
};

window.showBulkActions = function() {
  const selected = document.querySelectorAll('.expense-checkbox:checked');
  if (selected.length === 0) {
    showNotification('Please select expenses first', 'error');
    return;
  }
  
  // Show bulk actions menu
  const action = prompt(`Bulk actions for ${selected.length} expenses:\n1. Mark as Paid\n2. Mark as Unpaid\n3. Delete\n\nEnter choice (1-3):`);
  
  if (action === '1') {
    selected.forEach(checkbox => markExpenseStatus(checkbox.value, 'Paid'));
  } else if (action === '2') {
    selected.forEach(checkbox => markExpenseStatus(checkbox.value, 'Unpaid'));
  } else if (action === '3') {
    if (confirm(`Delete ${selected.length} expenses?`)) {
      selected.forEach(checkbox => deleteItem(STORE_NAMES.expenses || 'expenses', checkbox.value));
      refreshExpensesDashboard();
    }
  }
};

async function markExpenseStatus(id, status) {
  const expenses = await getAllItems(STORE_NAMES.expenses || 'expenses').catch(() => []);
  const expense = expenses.find(e => e.id === id);
  if (expense && expense.source === 'expense') { // Only direct entries
    expense.status = status;
    expense.updatedAt = new Date().toISOString();
    await updateItem(STORE_NAMES.expenses || 'expenses', expense);
  }
}