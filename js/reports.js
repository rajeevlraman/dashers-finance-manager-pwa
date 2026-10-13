import { getAllItems, STORE_NAMES } from './db.js';
import { escapeHtml } from './sanitize.js';

import { formatMoney, getBaseCurrency, toBaseTransactions } from './utils/currency.js';
// Aurora theme chart palette — teal/blue-led categorical colors that
// match the app's navy/teal surfaces, instead of Chart.js's default
// clashing rainbow. Used for all category (doughnut/pie/bar) charts.
const CHART_PALETTE = [
  '#14b8a6', '#0ea5e9', '#6366f1', '#f59e0b',
  '#f43f5e', '#10b981', '#8b5cf6', '#64748b'
];

let activeCharts = [];
let allTransactions = [];
let allCategories = [];
let allAccounts = [];

// Expenses-by-category chart state. Lives at module level so the toggles
// survive renderReportsGrid() rebuilding the card's HTML on refresh.
const catCost = { group: 'category', period: 'month', value: null, chart: null };
const CAT_COST_MAX_SUBCATEGORIES = 25;

export async function initReportsUI() {
  const mainContent = document.getElementById('mainContent');

  mainContent.innerHTML = `
    <div class="reports-container">
      <!-- Header — date range + refresh sit next to the title instead of
           in their own full-width banner row below it, since they're
           really just two controls, not enough to need a whole row. -->
      <div class="reports-header">
        <div class="reports-header-text">
          <h2>📊 Financial Reports & Analytics</h2>
          <p class="reports-subtitle">Comprehensive insights into your financial performance</p>
        </div>
        <div class="reports-header-controls">
          <select id="dateRange" class="form-select">
            <option value="all">All Time</option>
            <option value="year">This Year</option>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="custom">Custom Range</option>
          </select>
          <button class="btn btn-primary" id="refreshReports">🔄 Refresh</button>
        </div>
      </div>

      <!-- Only shown once "Custom Range" is picked above, so it doesn't
           cost space the rest of the time. -->
      <div class="form-group" id="customDateRange" style="display: none;">
        <label>Custom Range</label>
        <div class="date-inputs">
          <input type="date" id="startDate" class="form-input">
          <span>to</span>
          <input type="date" id="endDate" class="form-input">
        </div>
      </div>

      <!-- Quick Stats -->
      <div id="quickStats" class="quick-stats">
        <div class="loading-spinner">Loading financial statistics...</div>
      </div>

      <!-- Reports Grid -->
      <div class="reports-grid" id="reportsGrid">
        <div class="loading-spinner">Loading charts...</div>
      </div>
    </div>
  `;

  await initializeReports();
}

// ============================================================================
// 🏗️ INITIALIZATION
// ============================================================================

async function initializeReports() {
  try {
    [allTransactions, allCategories, allAccounts] = await Promise.all([
      getAllItems(STORE_NAMES.transactions),
      getAllItems(STORE_NAMES.categories),
      getAllItems(STORE_NAMES.accounts).catch(() => [])
    ]);
    allTransactions = toBaseTransactions(allTransactions, allAccounts);

    
    // Initialize date inputs after data is loaded
    initializeDateInputs();
    setupReportsEventListeners();
    
    await renderQuickStats();
    await renderReportsGrid();
    
  } catch (error) {
    console.error('❌ Failed to initialize reports:', error);
    showError('Failed to load reports data: ' + error.message);
  }
}

function initializeDateInputs() {
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  
  if (startDateInput) {
    startDateInput.value = oneYearAgo.toISOString().split('T')[0];
  }
  if (endDateInput) {
    endDateInput.value = now.toISOString().split('T')[0];
  }
}

function setupReportsEventListeners() {
  // Date range controls
  const dateRangeSelect = document.getElementById('dateRange');
  if (dateRangeSelect) {
    dateRangeSelect.addEventListener('change', function(e) {
      const customRange = document.getElementById('customDateRange');
      if (customRange) {
        customRange.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
      refreshAllCharts();
    });
  }

  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  if (startDateInput) startDateInput.addEventListener('change', refreshAllCharts);
  if (endDateInput) endDateInput.addEventListener('change', refreshAllCharts);

  // Action buttons
  const refreshBtn = document.getElementById('refreshReports');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshAllCharts);
}

// ============================================================================
// 🔄 REFRESH FUNCTIONS
// ============================================================================

async function refreshAllCharts() {
  try {
    await renderQuickStats();
    await renderReportsGrid();
  } catch (error) {
    console.error('Error refreshing charts:', error);
    showError('Failed to refresh reports: ' + error.message);
  }
}

// ============================================================================
// 📊 QUICK STATS DASHBOARD
// ============================================================================

async function renderQuickStats() {
  const filteredTransactions = getFilteredTransactions();
  const stats = calculateFinancialStats(filteredTransactions);

  const statsContainer = document.getElementById('quickStats');
  if (!statsContainer) return;

  statsContainer.innerHTML = `
    <div class="stats-grid page-compact-cards">
      <div class="stat-card total-income">
        <div class="stat-icon">💰</div>
        <div class="stat-content">
          <div class="stat-value">${formatCurrency(stats.totalIncome)}</div>
          <div class="stat-label">Total Income</div>
        </div>
      </div>

      <div class="stat-card total-expenses">
        <div class="stat-icon">💸</div>
        <div class="stat-content">
          <div class="stat-value">${formatCurrency(stats.totalExpenses)}</div>
          <div class="stat-label">Total Expenses</div>
        </div>
      </div>

      <div class="stat-card net-cashflow">
        <div class="stat-icon">📈</div>
        <div class="stat-content">
          <div class="stat-value ${stats.netCashFlow >= 0 ? 'positive' : 'negative'}">
            ${formatCurrency(stats.netCashFlow)}
          </div>
          <div class="stat-label">Net Cash Flow</div>
          <div class="stat-subtext">${stats.netCashFlow >= 0 ? 'Surplus' : 'Deficit'}</div>
        </div>
      </div>

      <div class="stat-card transaction-count">
        <div class="stat-icon">📝</div>
        <div class="stat-content">
          <div class="stat-value">${stats.transactionCount}</div>
          <div class="stat-label">Transactions</div>
          <div class="stat-subtext">${stats.incomeCount} income, ${stats.expenseCount} expense</div>
        </div>
      </div>

      <div class="stat-card savings-rate">
        <div class="stat-icon">🐷</div>
        <div class="stat-content">
          <div class="stat-value ${stats.savingsRate >= 0 ? 'positive' : 'negative'}">${stats.savingsRate.toFixed(1)}%</div>
          <div class="stat-label">Savings Rate</div>
        </div>
      </div>

      <div class="stat-card avg-monthly">
        <div class="stat-icon">📅</div>
        <div class="stat-content">
          <div class="stat-value">${formatCurrency(stats.avgMonthlyExpense)}</div>
          <div class="stat-label">Avg Monthly Spend</div>
        </div>
      </div>

      <div class="stat-card largest-expense">
        <div class="stat-icon">🔍</div>
        <div class="stat-content">
          <div class="stat-value">${formatCurrency(stats.largestExpense.amount)}</div>
          <div class="stat-label">Largest Expense</div>
          <div class="stat-subtext">${escapeHtml(stats.largestExpense.description || 'N/A')}</div>
        </div>
      </div>
    </div>
  `;
}

function calculateFinancialStats(transactions) {
  
  const income = transactions.filter(t => t.type === 'income' && !t.isTransfer);
  const expenses = transactions.filter(t => t.type === 'expense' && !t.isTransfer);
  
  const totalIncome = income.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
  const totalExpenses = expenses.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
  // totalExpenses is already a negative sum (expense amounts are stored as
  // negative numbers), so cash flow is income + expenses, not income - expenses.
  // Subtracting here was flipping the sign of every expense, turning real
  // deficits into inflated fake surpluses.
  const netCashFlow = totalIncome + totalExpenses;

  const savingsRate = totalIncome > 0 ? (netCashFlow / totalIncome) * 100 : 0;

  const monthsSpanned = new Set(
    transactions.filter(t => t.date).map(t => t.date.slice(0, 7))
  ).size || 1;
  const avgMonthlyExpense = Math.abs(totalExpenses) / monthsSpanned;

  const largestExpense = expenses.reduce((max, t) => {
    const amt = Math.abs(parseFloat(t.amount) || 0);
    return amt > max.amount ? { amount: amt, description: t.description || 'Expense' } : max;
  }, { amount: 0, description: '' });

  return {
    totalIncome,
    totalExpenses,
    netCashFlow,
    savingsRate,
    avgMonthlyExpense,
    largestExpense,
    transactionCount: transactions.length,
    incomeCount: income.length,
    expenseCount: expenses.length
  };
}

// ============================================================================
// 📈 REPORTS GRID
// ============================================================================

async function renderReportsGrid() {
  const filteredTransactions = getFilteredTransactions();

  const reportsGrid = document.getElementById('reportsGrid');
  if (!reportsGrid) return;

  // Show message if no transactions
  if (filteredTransactions.length === 0) {
    reportsGrid.innerHTML = `
      <div class="report-card full-width">
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h3>No Data Available</h3>
          <p>No transactions found for the selected date range.</p>
          <p>Add some transactions to see reports and analytics.</p>
        </div>
      </div>
    `;
    return;
  }

  reportsGrid.innerHTML = `
    <div class="report-card full-width">
      <div class="report-header">
        <h3>📈 Monthly Income vs Expenses</h3>
      </div>
      <div class="chart-container" style="height: 300px;">
        <canvas id="monthlyChart"></canvas>
      </div>
    </div>

    <div class="report-card full-width">
      <div class="report-header">
        <h3>🧾 Expenses by Category</h3>
        <div class="report-header-controls">
          <div class="view-toggle" role="group" aria-label="Group by" id="catCostGroupToggle">
            <button type="button" class="view-toggle-btn ${catCost.group === 'category' ? 'active' : ''}" data-group="category">Categories</button>
            <button type="button" class="view-toggle-btn ${catCost.group === 'subcategory' ? 'active' : ''}" data-group="subcategory">Subcategories</button>
          </div>
          <div class="view-toggle" role="group" aria-label="Period" id="catCostPeriodToggle">
            <button type="button" class="view-toggle-btn ${catCost.period === 'month' ? 'active' : ''}" data-period="month">Month</button>
            <button type="button" class="view-toggle-btn ${catCost.period === 'year' ? 'active' : ''}" data-period="year">Year</button>
          </div>
          <select id="catCostPeriodSelect" class="form-select" aria-label="Select period"></select>
        </div>
      </div>
      <div class="chart-container" style="height: 300px;">
        <canvas id="categoryCostChart"></canvas>
        <p class="no-data" id="categoryCostEmpty" style="display: none;">No expenses for this period</p>
      </div>
    </div>

    <div class="report-card">
      <div class="report-header">
        <h3>💰 Expense Categories</h3>
      </div>
      <div class="chart-container" style="height: 250px;">
        <canvas id="expenseChart"></canvas>
      </div>
    </div>

    <div class="report-card">
      <div class="report-header">
        <h3>🏆 Top Spending Categories</h3>
      </div>
      <div id="topCategoriesList" class="recent-activity"></div>
    </div>

    <div class="report-card">
      <div class="report-header">
        <h3>🏦 Spend by Account</h3>
      </div>
      <div class="chart-container" style="height: 250px;">
        <canvas id="accountChart"></canvas>
      </div>
    </div>

    <div class="report-card">
      <div class="report-header">
        <h3>💸 Income Sources</h3>
      </div>
      <div class="chart-container" style="height: 250px;">
        <canvas id="incomeChart"></canvas>
      </div>
    </div>

    <div class="report-card full-width">
      <div class="report-header">
        <h3>🗓️ Category Breakdown by Month</h3>
        <span class="month-badge">All main categories · follows Date Range above</span>
      </div>
      <div id="categoryMonthTable"></div>
    </div>
  `;

  // Render charts with a small delay to ensure DOM is ready
  setTimeout(() => {
    renderAllCharts(filteredTransactions);
  }, 500);
}

// ============================================================================
// 🎨 CHART RENDERING - SIMPLIFIED AND DEBUGGED
// ============================================================================

function renderAllCharts(transactions) {
  
  // Clear existing charts
  activeCharts.forEach(chart => {
    try { 
      chart.destroy(); 
    } catch (e) {
    }
  });
  activeCharts = [];

  // Render each chart individually with error handling
  try {
    renderMonthlyChart(transactions);
  } catch (error) {
    console.error('❌ Error rendering monthly chart:', error);
  }

  try {
    initCategoryCostChart();
  } catch (error) {
    console.error('❌ Error rendering expenses-by-category chart:', error);
  }

  try {
    renderExpenseCategoriesChart(transactions);
  } catch (error) {
    console.error('❌ Error rendering expense chart:', error);
  }

  try {
    renderIncomeSourcesChart(transactions);
  } catch (error) {
    console.error('❌ Error rendering income chart:', error);
  }

  try {
    renderTopCategoriesList(transactions);
  } catch (error) {
    console.error('❌ Error rendering top categories list:', error);
  }

  try {
    renderAccountChart(transactions);
  } catch (error) {
    console.error('❌ Error rendering account chart:', error);
  }

  try {
    renderCategoryMonthTable(transactions);
  } catch (error) {
    console.error('❌ Error rendering category/month table:', error);
  }

}

function renderMonthlyChart(transactions) {
  const monthlyData = getMonthlyData(transactions);
  const ctx = document.getElementById('monthlyChart');
  
  if (!ctx) {
    console.debug('[reports] Monthly chart skipped: the page was changed before it finished loading');
    return;
  }

  // Validate data
  if (!monthlyData.labels || monthlyData.labels.length === 0) {
    console.warn('⚠️ No monthly data available');
    ctx.parentElement.innerHTML = '<p class="no-data">No monthly data available</p>';
    return;
  }

  try { Chart.getChart(ctx)?.destroy(); } catch (e) { /* nothing to destroy */ }
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthlyData.labels,
      datasets: [
        {
          label: 'Income',
          data: monthlyData.income,
          backgroundColor: '#10b981',
          borderColor: '#10b981',
          borderWidth: 1
        },
        {
          label: 'Expenses',
          data: monthlyData.expenses,
          backgroundColor: '#f43f5e',
          borderColor: '#f43f5e',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: true,
          text: 'Monthly Income vs Expenses'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return formatCurrency(value);
            }
          },
          title: {
            display: true,
            text: `Amount (${getBaseCurrency()})`
          }
        },
        x: {
          title: {
            display: true,
            text: 'Month'
          }
        }
      }
    }
  });
  
  activeCharts.push(chart);
}

function renderExpenseCategoriesChart(transactions) {
  const expenseData = getExpenseCategoriesData(transactions);
  const ctx = document.getElementById('expenseChart');
  
  if (!ctx) {
    console.debug('[reports] Expense chart skipped: the page was changed before it finished loading');
    return;
  }

  if (!expenseData.labels || expenseData.labels.length === 0) {
    console.warn('⚠️ No expense data available');
    ctx.parentElement.innerHTML = '<p class="no-data">No expense data available</p>';
    return;
  }

  try { Chart.getChart(ctx)?.destroy(); } catch (e) { /* nothing to destroy */ }
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: expenseData.labels,
      datasets: [{
        data: expenseData.values,
        backgroundColor: CHART_PALETTE,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
        title: {
          display: true,
          text: 'Expense Categories'
        }
      }
    }
  });
  
  activeCharts.push(chart);
}

function renderIncomeSourcesChart(transactions) {
  const incomeData = getIncomeSourcesData(transactions);
  const ctx = document.getElementById('incomeChart');
  
  if (!ctx) {
    console.debug('[reports] Income chart skipped: the page was changed before it finished loading');
    return;
  }

  if (!incomeData.labels || incomeData.labels.length === 0) {
    console.warn('⚠️ No income data available');
    ctx.parentElement.innerHTML = '<p class="no-data">No income data available</p>';
    return;
  }

  try { Chart.getChart(ctx)?.destroy(); } catch (e) { /* nothing to destroy */ }
  const chart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: incomeData.labels,
      datasets: [{
        data: incomeData.values,
        backgroundColor: CHART_PALETTE,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
        title: {
          display: true,
          text: 'Income Sources'
        }
      }
    }
  });
  
  activeCharts.push(chart);
}

// ============================================================================
// 🧾 EXPENSES BY CATEGORY (bar chart with its own period + grouping toggles)
// ============================================================================

// This card has its own Month/Year picker, so it reads allTransactions
// directly instead of the page-level Date Range filter (otherwise picking
// "This Month" up top would leave nothing to choose from in here).
function getCategoryCostExpenses() {
  return allTransactions.filter(t =>
    t.type === 'expense' && !t.isTransfer && t.date && !isNaN(parseFloat(t.amount))
  );
}

function getCategoryCostPeriods(expenses, period) {
  const len = period === 'year' ? 4 : 7;
  return Array.from(new Set(expenses.map(t => t.date.slice(0, len)))).sort().reverse();
}

function formatCategoryCostPeriod(key, period) {
  if (period === 'year') return key;
  const [year, num] = key.split('-');
  return `${getMonthName(parseInt(num))} ${year}`;
}

function getCategoryCostData(expenses, group, period, value) {
  const len = period === 'year' ? 4 : 7;
  const totals = new Map(); // key -> { label, fullLabel, amount }

  expenses.forEach(t => {
    if (t.date.slice(0, len) !== value) return;
    const amount = Math.abs(parseFloat(t.amount) || 0);

    let key, label, fullLabel;
    if (group === 'subcategory') {
      const cat = allCategories.find(c => c.id === t.categoryId);
      if (!cat) { key = label = fullLabel = 'Uncategorized'; }
      else {
        key = cat.id;
        label = cat.name;
        const parent = cat.parentId ? allCategories.find(c => c.id === cat.parentId) : null;
        fullLabel = parent ? `${parent.name} › ${cat.name}` : cat.name;
      }
    } else {
      key = label = fullLabel = getTopLevelCategoryName(t.categoryId);
    }

    const entry = totals.get(key) || { label, fullLabel, amount: 0 };
    entry.amount += amount;
    totals.set(key, entry);
  });

  let entries = Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
  if (group === 'subcategory') entries = entries.slice(0, CAT_COST_MAX_SUBCATEGORIES);

  return {
    labels: entries.map(e => e.label),
    fullLabels: entries.map(e => e.fullLabel),
    values: entries.map(e => e.amount)
  };
}

function initCategoryCostChart() {
  const canvas = document.getElementById('categoryCostChart');
  if (!canvas) return;

  document.querySelectorAll('#catCostGroupToggle .view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      catCost.group = btn.dataset.group;
      syncCategoryCostControls();
      renderCategoryCostChart();
    });
  });

  document.querySelectorAll('#catCostPeriodToggle .view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (catCost.period === btn.dataset.period) return;
      catCost.period = btn.dataset.period;
      catCost.value = null; // re-default to the latest month/year
      syncCategoryCostControls();
      renderCategoryCostChart();
    });
  });

  const select = document.getElementById('catCostPeriodSelect');
  if (select) {
    select.addEventListener('change', () => {
      catCost.value = select.value;
      renderCategoryCostChart();
    });
  }

  syncCategoryCostControls();
  renderCategoryCostChart();
}

function syncCategoryCostControls() {
  document.querySelectorAll('#catCostGroupToggle .view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === catCost.group);
  });
  document.querySelectorAll('#catCostPeriodToggle .view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === catCost.period);
  });

  const select = document.getElementById('catCostPeriodSelect');
  if (!select) return;

  const periods = getCategoryCostPeriods(getCategoryCostExpenses(), catCost.period);
  if (!periods.includes(catCost.value)) catCost.value = periods[0] || null;

  select.innerHTML = periods.map(p =>
    `<option value="${p}"${p === catCost.value ? ' selected' : ''}>${formatCategoryCostPeriod(p, catCost.period)}</option>`
  ).join('');
  select.disabled = periods.length === 0;
}

function renderCategoryCostChart() {
  const canvas = document.getElementById('categoryCostChart');
  const emptyMsg = document.getElementById('categoryCostEmpty');
  if (!canvas) return;

  if (catCost.chart) {
    try { catCost.chart.destroy(); } catch (e) {}
    activeCharts = activeCharts.filter(c => c !== catCost.chart);
    catCost.chart = null;
  }

  const data = catCost.value
    ? getCategoryCostData(getCategoryCostExpenses(), catCost.group, catCost.period, catCost.value)
    : { labels: [], fullLabels: [], values: [] };

  if (data.labels.length === 0) {
    canvas.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = '';
    return;
  }
  canvas.style.display = '';
  if (emptyMsg) emptyMsg.style.display = 'none';

  const isSub = catCost.group === 'subcategory';
  const periodLabel = formatCategoryCostPeriod(catCost.value, catCost.period);

  try { Chart.getChart(canvas)?.destroy(); } catch (e) { /* nothing to destroy */ }
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Expenses',
          data: data.values,
          backgroundColor: '#f43f5e',
          borderColor: '#f43f5e',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: true,
          text: `Expenses by ${isSub ? 'Subcategory' : 'Category'} — ${periodLabel}`
        },
        tooltip: {
          callbacks: {
            title: (items) => data.fullLabels[items[0].dataIndex],
            label: (item) => `${item.dataset.label}: ${formatCurrency(item.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return formatCurrency(value);
            }
          },
          title: {
            display: true,
            text: `Cost (${getBaseCurrency()})`
          }
        },
        x: {
          title: {
            display: true,
            text: isSub ? 'Subcategory' : 'Category'
          }
        }
      }
    }
  });

  catCost.chart = chart;
  activeCharts.push(chart);
}

// ============================================================================
// 🏆 TOP SPENDING CATEGORIES LIST
// ============================================================================

function renderTopCategoriesList(transactions) {
  const container = document.getElementById('topCategoriesList');
  if (!container) return;

  const expenseData = getExpenseCategoriesData(transactions);
  const total = expenseData.values.reduce((sum, v) => sum + v, 0);

  if (expenseData.labels.length === 0) {
    container.innerHTML = '<p class="no-data">No expense data available</p>';
    return;
  }

  container.innerHTML = expenseData.labels.map((label, i) => {
    const amount = expenseData.values[i];
    const percent = total > 0 ? (amount / total) * 100 : 0;
    return `
      <div class="activity-item">
        <span class="activity-icon">🏷️</span>
        <div class="activity-details">
          <div class="activity-desc">${escapeHtml(label)}</div>
          <div class="activity-date">${percent.toFixed(1)}% of total spending</div>
        </div>
        <span class="activity-amount negative">-${formatCurrency(amount)}</span>
      </div>
    `;
  }).join('');
}

// ============================================================================
// 🏦 SPEND BY ACCOUNT CHART
// ============================================================================

function getSpendByAccountData(transactions) {
  const expenses = transactions.filter(t => t.type === 'expense' && !t.isTransfer);
  const totals = {};

  expenses.forEach(t => {
    const account = allAccounts.find(a => a.id === t.accountId);
    const name = account?.name || 'Unassigned';
    totals[name] = (totals[name] || 0) + Math.abs(parseFloat(t.amount) || 0);
  });

  const sortedEntries = Object.entries(totals).sort(([, a], [, b]) => b - a);

  return {
    labels: sortedEntries.map(([name]) => name),
    values: sortedEntries.map(([, amount]) => amount)
  };
}

function renderAccountChart(transactions) {
  const accountData = getSpendByAccountData(transactions);
  const ctx = document.getElementById('accountChart');

  if (!ctx) {
    console.debug('[reports] Account chart skipped: the page was changed before it finished loading');
    return;
  }

  if (!accountData.labels || accountData.labels.length === 0) {
    ctx.parentElement.innerHTML = '<p class="no-data">No account data available</p>';
    return;
  }

  try { Chart.getChart(ctx)?.destroy(); } catch (e) { /* nothing to destroy */ }
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: accountData.labels,
      datasets: [{
        data: accountData.values,
        backgroundColor: CHART_PALETTE,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: 'Spend by Account' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}`
          }
        }
      }
    }
  });

  activeCharts.push(chart);
}

// ============================================================================
// ============================================================================
// 🗓️ CATEGORY BREAKDOWN BY MONTH TABLE
// ============================================================================

// Rolls a leaf category (e.g. "Groceries") up to its top-level parent
// (e.g. "Food") the same way financialDashboard.js's topLevelCategory
// does — this table groups by main category, not by every individual
// subcategory.
function getTopLevelCategoryName(categoryId) {
  let cat = allCategories.find(c => c.id === categoryId);
  if (!cat) return 'Uncategorized';
  let guard = 0;
  while (cat.parentId && guard < 10) {
    const parent = allCategories.find(c => c.id === cat.parentId);
    if (!parent) break;
    cat = parent;
    guard++;
  }
  return cat.name;
}

function renderCategoryMonthTable(transactions) {
  const container = document.getElementById('categoryMonthTable');
  if (!container) return;

  const expenses = transactions.filter(t => t.type === 'expense' && !t.isTransfer && t.date);
  if (expenses.length === 0) {
    container.innerHTML = '<p class="no-data">No expense data available</p>';
    return;
  }

  // Every month present in the transactions passed in, oldest to newest.
  // `transactions` here is already whatever the page's own Date Range
  // filter (getFilteredTransactions) selected — this used to re-narrow
  // that down to only the last 6 months regardless of what was picked
  // above, so "This Year" or "All Time" had no visible effect on this
  // particular table. It now just uses whatever range was already chosen.
  const monthSet = new Set(expenses.map(t => t.date.slice(0, 7)));
  const months = Array.from(monthSet).sort();

  // Every main (top-level) category with any spend in that range — not
  // just a top-N subset — so this is the full list of main categories,
  // not a partial one. "Uncategorized" naturally becomes its own row
  // for anything with no category (or an unmapped one), so there's no
  // separate "Other" bucket needed on top of that.
  const categoryTotals = {};
  expenses.forEach(t => {
    const name = getTopLevelCategoryName(t.categoryId);
    categoryTotals[name] = (categoryTotals[name] || 0) + Math.abs(parseFloat(t.amount) || 0);
  });
  const topCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);

  // Matrix: category -> month -> amount
  const matrix = {};
  topCategories.forEach(cat => { matrix[cat] = {}; months.forEach(m => matrix[cat][m] = 0); });
  expenses.forEach(t => {
    const month = t.date.slice(0, 7);
    const name = getTopLevelCategoryName(t.categoryId);
    if (matrix[name] && months.includes(month)) {
      matrix[name][month] += Math.abs(parseFloat(t.amount) || 0);
    }
  });

  const monthLabels = months.map(m => {
    const [year, num] = m.split('-');
    return `${getMonthName(parseInt(num))} ${year}`;
  });

  const columnTotals = months.map(m => topCategories.reduce((sum, cat) => sum + matrix[cat][m], 0));

  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>Category</th>
            ${monthLabels.map(m => `<th>${m}</th>`).join('')}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${topCategories.map(cat => {
            const rowTotal = months.reduce((sum, m) => sum + matrix[cat][m], 0);
            return `
              <tr>
                <td>${escapeHtml(cat)}</td>
                ${months.map(m => `<td>${matrix[cat][m] > 0 ? formatCurrency(matrix[cat][m]) : '–'}</td>`).join('')}
                <td><strong>${formatCurrency(rowTotal)}</strong></td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            ${columnTotals.map(t => `<td><strong>${formatCurrency(t)}</strong></td>`).join('')}
            <td><strong>${formatCurrency(columnTotals.reduce((a, b) => a + b, 0))}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

// ============================================================================
// 📊 DATA PROCESSING FUNCTIONS
// ============================================================================

function getMonthlyData(transactions) {
  
  const monthly = {};
  
  transactions.forEach(tx => {
    if (!tx.date) {
      console.warn('Transaction missing date:', tx);
      return;
    }
    // Bug fix: this monthly income/expense trend counted every transfer
    // and BPAY/loan-drawn transaction it saw, ignoring isTransfer entirely
    // - unlike getSpendByAccountData/getExpenseCategoriesData/
    // getIncomeSourcesData/calculateFinancialStats elsewhere in this same
    // file, which already exclude it.
    if (tx.isTransfer) return;
    
    try {
      const date = new Date(tx.date);
      if (isNaN(date.getTime())) {
        console.warn('Invalid date in transaction:', tx.date);
        return;
      }
      
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const amount = parseFloat(tx.amount) || 0;
      
      if (!monthly[monthKey]) {
        monthly[monthKey] = { income: 0, expenses: 0 };
      }
      
      if (tx.type === 'income') {
        monthly[monthKey].income += amount;
      } else if (tx.type === 'expense') {
        monthly[monthKey].expenses += Math.abs(amount);
      }
    } catch (error) {
      console.error('Error processing transaction:', tx, error);
    }
  });

  const sortedMonths = Object.keys(monthly).sort();
  
  const result = {
    labels: sortedMonths.map(month => {
      const [year, monthNum] = month.split('-');
      return `${getMonthName(parseInt(monthNum))} ${year}`;
    }),
    income: sortedMonths.map(month => monthly[month].income),
    expenses: sortedMonths.map(month => monthly[month].expenses)
  };
  
  return result;
}

function getExpenseCategoriesData(transactions) {
  const expenses = transactions.filter(t => t.type === 'expense' && !t.isTransfer);
  
  const categories = {};
  
  expenses.forEach(expense => {
    const categoryName = getCategoryName(expense.categoryId) || 'Uncategorized';
    const amount = Math.abs(parseFloat(expense.amount) || 0);
    categories[categoryName] = (categories[categoryName] || 0) + amount;
  });
  
  // Sort by amount descending and take top 6
  const sortedEntries = Object.entries(categories)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 6);
  
  const result = {
    labels: sortedEntries.map(([name]) => name),
    values: sortedEntries.map(([,amount]) => amount)
  };
  
  return result;
}

function getIncomeSourcesData(transactions) {
  const income = transactions.filter(t => t.type === 'income' && !t.isTransfer);
  
  const sources = {};
  
  income.forEach(incomeTx => {
    const source = getCategoryName(incomeTx.categoryId) || incomeTx.description || 'Other Income';
    const amount = parseFloat(incomeTx.amount) || 0;
    sources[source] = (sources[source] || 0) + amount;
  });
  
  // Sort by amount descending and take top 6
  const sortedEntries = Object.entries(sources)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 6);
  
  const result = {
    labels: sortedEntries.map(([name]) => name),
    values: sortedEntries.map(([,amount]) => amount)
  };
  
  return result;
}

// ============================================================================
// 🛠️ UTILITY FUNCTIONS
// ============================================================================

function getFilteredTransactions() {
  const dateRange = document.getElementById('dateRange')?.value || 'all';
  const startDate = document.getElementById('startDate')?.value;
  const endDate = document.getElementById('endDate')?.value;
  
  let filtered = allTransactions.filter(tx => {
    // Basic validation
    if (!tx.date || !tx.type) return false;
    if (isNaN(parseFloat(tx.amount))) return false;
    return true;
  });
  
  
  if (dateRange === 'custom' && startDate && endDate) {
    filtered = filtered.filter(t => t.date >= startDate && t.date <= endDate);
  } else if (dateRange === 'month') {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    filtered = filtered.filter(t => t.date >= monthStart);
  } else if (dateRange === 'year') {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    filtered = filtered.filter(t => t.date >= yearStart);
  } else if (dateRange === 'quarter') {
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().split('T')[0];
    filtered = filtered.filter(t => t.date >= quarterStart);
  }
  
  return filtered;
}

function getCategoryName(categoryId) {
  if (!categoryId) return 'Uncategorized';
  const category = allCategories.find(c => c.id === categoryId);
  return category ? category.name : 'Uncategorized';
}

function getMonthName(monthNumber) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return months[monthNumber - 1] || 'Unknown';
}

function formatCurrency(amount) {
  return formatMoney(amount, undefined, { digits: 0 });
}

function showError(message) {
  const reportsGrid = document.getElementById('reportsGrid');
  if (reportsGrid) {
    reportsGrid.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <h3>Report Error</h3>
        <p>${message}</p>
        <button class="btn btn-primary" onclick="initReportsUI()">🔄 Retry</button>
      </div>
    `;
  }
}

// ============================================================================
// 🌐 GLOBAL FUNCTIONS
// ============================================================================

window.initReportsUI = initReportsUI;