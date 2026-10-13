import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES } from './db.js';
import { buildAccountRecord } from './records.js';
import { getGatedItems } from './features.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalance, computeAccountBalanceAsOf, migrateAccountsToOpeningBalance } from './accountBalance.js';
import { institutionOptions, institutionDisplayName, renderInstitutionMark, pseudoLast4 } from './institutions.js';

import { baseEquivalent, formatMoney, getBaseCurrency, getCurrencies, hasRate, stampAud, toBase } from './utils/currency.js';
// Default demo accounts
const DEFAULT_ACCOUNTS = [
  { id: 'bank1', name: 'Main Checking', type: 'bank', openingBalance: 0, currency: 'AUD' },
  { id: 'bank2', name: 'Savings Account', type: 'bank', openingBalance: 0, currency: 'AUD' },
  { id: 'credit1', name: 'Visa Credit Card', type: 'credit', openingBalance: 0, currency: 'AUD', creditLimit: 5000 },
  { id: 'credit2', name: 'MasterCard', type: 'credit', openingBalance: 0, currency: 'AUD', creditLimit: 3000 },
  { id: 'offset', name: 'Mortgage Offset', type: 'offset', openingBalance: 0, currency: 'AUD', linkedLoanId: '' }
];

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper functions moved to top
function formatCurrency(amount, currency) {
  return formatMoney(amount, currency);
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
}

// Given a "day of month" a statement closes (e.g. 15), returns the most
// recent occurrence of that day that has already happened — this month if
// it's already passed, otherwise last month. This is the closing date of
// the statement that's currently due, as opposed to getNextStatementDueDate
// below, which looks forward for the payment deadline.
function getLastStatementCloseDate(closeDay, todayStr) {
  const today = new Date(todayStr);
  let candidate = new Date(today.getFullYear(), today.getMonth(), closeDay);
  if (candidate > today) {
    candidate = new Date(today.getFullYear(), today.getMonth() - 1, closeDay);
  }
  return candidate;
}

// Given a "day of month" a card's statement/payment is due (e.g. 15),
// returns the next occurrence of that day from today — this month if it
// hasn't passed yet, otherwise next month. Same logic as quickLook.js's
// getNextStatementDueDate, duplicated locally since that one isn't
// exported and this page has no reason to import the whole Quick Look
// module just for one date helper.
function getNextStatementDueDate(dueDay, todayStr) {
  const today = new Date(todayStr);
  let candidate = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (candidate < today) {
    candidate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
  }
  return candidate;
}

// 12 monthly totals of this account's real spend (expense transactions,
// transfers excluded) across the current Australian financial year
// (1 Jul - 30 Jun), oldest to newest, plus short month labels for the
// x-axis. "Current" FY is whichever one today falls in.
function computeFYExpenseTrend(accountId, transactions) {
  const today = new Date();
  const fyStartYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1; // getMonth() 6 = July
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStartYear, 6 + i, 1); // Jul, Aug, ... next Jun
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-US', { month: 'short' }) });
  }
  const values = months.map(m => {
    const spend = transactions
      .filter(t => t.accountId === accountId && !t.isTransfer && t.type === 'expense' && t.date?.startsWith(m.key))
      .reduce((sum, t) => sum + t.amount, 0);
    return Math.abs(spend);
  });
  return { values, labels: months.map(m => m.label) };
}

// Small inline line-trend, same visual approach as Quick Look's
// renderQLSparkline — a light line so it reads at a glance inside a
// dark bank-card without competing with the balance figures above it.
function renderCardTrendSparkline(values) {
  const w = 260, h = 40, pad = 3;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <svg viewBox="0 0 ${w} ${h}" class="bank-card-trend-svg" preserveAspectRatio="none">
      <polyline points="${points.join(' ')}" fill="none" stroke="rgba(244,247,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function getAccountIcon(type) {
  const icons = {
    bank: '🏦',
    credit: '💳',
    cash: '💵',
    savings: '💰',
    investment: '📈',
    offset: '⚖️',
    other: '📁'
  };
  return icons[type] || '📁';
}

function getAccountTypeLabel(type) {
  const labels = {
    bank: 'Bank Account',
    credit: 'Credit Card',
    cash: 'Cash',
    savings: 'Savings',
    investment: 'Investment',
    offset: 'Offset Account',
    other: 'Other'
  };
  return labels[type] || 'Account';
}

// Add default accounts
// Removes demo accounts: the "Add Defaults" set and Settings demo-dataset
// accounts (ids starting "demo_"). An account is only removed if nothing of
// yours is attached to it — demo_ accounts take their own demo_ transactions
// with them, but an account holding any other transaction is kept and listed.
async function removeDemoAccounts() {
  const defaultIds = new Set(DEFAULT_ACCOUNTS.map(a => a.id));
  const isDemoId = id => typeof id === 'string' && (defaultIds.has(id) || id.startsWith('demo_'));
  const accounts = (await getAllItems(STORE_NAMES.accounts)).filter(a => isDemoId(a.id));
  if (!accounts.length) { alert('No demo accounts found.'); return; }
  const txs = await getAllItems(STORE_NAMES.transactions).catch(() => []);
  const removable = [], kept = [];
  for (const a of accounts) {
    const own = txs.filter(t => (t.accountId === a.id || t.toAccountId === a.id) && !String(t.id).startsWith('demo_'));
    (own.length ? kept : removable).push(a);
  }
  if (!removable.length) { alert(`Nothing removed: ${kept.map(a => a.name).join(', ')} still ${kept.length === 1 ? 'has' : 'have'} your own transactions.`); return; }
  if (!confirm(`Remove ${removable.length} demo account(s) (${removable.map(a => a.name).join(', ')}) and their demo transactions?` + (kept.length ? `\n\nKept because they hold your own transactions: ${kept.map(a => a.name).join(', ')}.` : '') + '\n\nYour own accounts are not touched.')) return;
  const ids = new Set(removable.map(a => a.id));
  for (const t of txs) {
    if (String(t.id).startsWith('demo_') && (ids.has(t.accountId) || ids.has(t.toAccountId))) await deleteItem(STORE_NAMES.transactions, t.id);
  }
  for (const a of removable) await deleteItem(STORE_NAMES.accounts, a.id);
  initAccountsUI();
}

async function addDefaultAccounts() {
  const existing = await getAllItems(STORE_NAMES.accounts);
  const existingIds = existing.map(a => a.id);

  let added = 0;
  for (const acc of DEFAULT_ACCOUNTS) {
    if (!existingIds.includes(acc.id)) {
      await addItem(STORE_NAMES.accounts, {
        ...acc,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      added++;
    }
  }

  initAccountsUI();
}
// this is the summary cards function option 1
/*
function updateSummaryCards(accounts, transactions) {
  // Calculate totals - FIXED LOGIC
  const totalBalance = accounts.reduce((sum, acc) => {
    // For credit cards, balance is negative (what you owe), so we add it as negative
    // For other accounts, balance is positive (what you have)
    return sum + acc.balance;
  }, 0);

  // Cash accounts: bank, savings, cash, offset (positive balances)
  const cashAccounts = accounts.filter(acc => 
    ['bank', 'savings', 'cash', 'offset'].includes(acc.type)
  ).length;

  // Credit cards count
  const creditCards = accounts.filter(acc => acc.type === 'credit').length;
  
  // Available credit calculation - FIXED
  const totalCreditLimit = accounts
    .filter(acc => acc.type === 'credit' && acc.creditLimit)
    .reduce((sum, acc) => sum + (acc.creditLimit || 0), 0);
  
  // For credit cards, balance is negative (what you owe), so used credit is the absolute value
  const usedCredit = accounts
    .filter(acc => acc.type === 'credit')
    .reduce((sum, acc) => sum + Math.abs(Math.min(acc.balance, 0)), 0);
  
  const availableCredit = Math.max(totalCreditLimit - usedCredit, 0);

  // Update summary cards
  document.getElementById('totalBalanceCard').querySelector('.summary-amount').textContent = 
    formatCurrency(totalBalance, 'AUD');
  document.getElementById('cashAccountsCard').querySelector('.summary-count').textContent = cashAccounts;
  document.getElementById('creditCardsCard').querySelector('.summary-count').textContent = creditCards;
  document.getElementById('totalCreditCard').querySelector('.summary-amount').textContent = 
    formatCurrency(availableCredit, 'AUD');
}
*/

// alternat to the above function
/*
function updateSummaryCards(accounts, transactions) {
  // Separate assets (positive) from liabilities (negative/credit cards)
  const assets = accounts.filter(acc => acc.type !== 'credit');
  const liabilities = accounts.filter(acc => acc.type === 'credit');
  
  const totalAssets = assets.reduce((sum, acc) => sum + acc.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  // Cash accounts count
  const cashAccounts = accounts.filter(acc => 
    ['bank', 'savings', 'cash', 'offset'].includes(acc.type)
  ).length;

  // Credit cards count
  const creditCards = liabilities.length;
  
  // Available credit
  const totalCreditLimit = liabilities.reduce((sum, acc) => sum + (acc.creditLimit || 0), 0);
  const usedCredit = liabilities.reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
  const availableCredit = Math.max(totalCreditLimit - usedCredit, 0);

  // Update summary cards - you might want to change the labels
  document.getElementById('totalBalanceCard').querySelector('.summary-amount').textContent = 
    formatCurrency(netWorth, 'AUD');
  document.getElementById('cashAccountsCard').querySelector('.summary-count').textContent = cashAccounts;
  document.getElementById('creditCardsCard').querySelector('.summary-count').textContent = creditCards;
  document.getElementById('totalCreditCard').querySelector('.summary-amount').textContent = 
    formatCurrency(availableCredit, 'AUD');
}

*/
  function updateSummaryCards(accounts, transactions) {
    const container = document.getElementById('accountsHealthCard');
    if (!container) return;

    if (accounts.length === 0) {
      container.innerHTML = '';
      return;
    }

    const liveBalance = acc => computeAccountBalance(acc, transactions);
    // Everything that gets summed goes through toBase() so mixed-currency accounts total correctly.
    const baseBal = acc => toBase(liveBalance(acc), acc.currency);
    const unpriced = [...new Set(accounts.filter(a => !hasRate(a.currency)).map(a => a.currency))];
    const liabilities = accounts.filter(acc => acc.type === 'credit');
    const assets = accounts.filter(acc => acc.type !== 'credit');

    const totalAssets = assets.reduce((sum, acc) => sum + baseBal(acc), 0);
    const totalLiabilities = liabilities.reduce((sum, acc) => sum + Math.abs(baseBal(acc)), 0);
    const netWorth = totalAssets - totalLiabilities;

    const totalCreditLimit = liabilities.reduce((sum, acc) => sum + toBase(acc.creditLimit || 0, acc.currency), 0);
    const usedCredit = liabilities.reduce((sum, acc) => sum + Math.abs(Math.min(baseBal(acc), 0)), 0);
    const availableCredit = Math.max(totalCreditLimit - usedCredit, 0);
    const utilizationPct = totalCreditLimit > 0 ? (usedCredit / totalCreditLimit) * 100 : 0;

    const health = computeAccountsHealth(accounts, transactions, { totalCreditLimit, usedCredit, utilizationPct });

    const cashAccounts = accounts.filter(acc => ['bank', 'savings', 'cash', 'offset'].includes(acc.type));
    const creditCards = liabilities.length;

    const largestAsset = assets.reduce((best, acc) => {
      const bal = baseBal(acc);
      return (!best || bal > best.balance) ? { name: acc.name, balance: bal } : best;
    }, null);

    container.innerHTML = `
      <div class="health-panel">
        <div class="health-gauge-wrap">
          ${renderAccountsHealthGauge(health)}
          <div class="health-gauge-band" style="color: ${health.color};">${health.band}</div>
          <div class="health-gauge-caption">Accounts Health</div>
        </div>

        <div class="health-factors">
          ${renderAccountsFactorRow('💳', 'Credit Utilization', totalCreditLimit > 0 ? `${formatCurrency(usedCredit)} of ${formatCurrency(totalCreditLimit)} (${utilizationPct.toFixed(0)}%)` : 'No credit cards', health.utilizationBar, health.utilizationBar >= 70 ? 'var(--success)' : health.utilizationBar >= 30 ? '#ea7c1c' : 'var(--danger)')}
          ${renderAccountsFactorRow('🐷', 'Cash Buffer', health.monthlyExpenseEstimate > 0 ? `${health.monthsOfCoverage.toFixed(1)} months of expenses` : `${formatCurrency(health.liquidCash)} available`, health.bufferBar, health.bufferBar >= 60 ? 'var(--success)' : health.bufferBar >= 25 ? '#ea7c1c' : 'var(--danger)')}
          ${renderAccountsFactorRow('🗂️', 'Account Mix', `${health.distinctTypes} account type${health.distinctTypes === 1 ? '' : 's'}`, health.diversificationBar, health.diversificationBar >= 100 ? 'var(--success)' : health.diversificationBar >= 60 ? '#ea7c1c' : 'var(--danger)')}
          ${renderAccountsFactorRow('⏱️', 'Recent Activity', `${health.activeCount}/${accounts.length} active in 60d`, health.activityBar, health.activityBar >= 70 ? 'var(--success)' : health.activityBar >= 35 ? '#ea7c1c' : 'var(--danger)')}
        </div>
      </div>

      <div class="health-quickfacts">
        <div class="health-quickfact">
          <span class="health-quickfact-label">Net Worth</span>
          <span class="health-quickfact-value ${netWorth >= 0 ? 'positive' : 'negative'}">${formatCurrency(netWorth)}</span>
          <span class="health-quickfact-sub">Assets: ${formatCurrency(totalAssets)}</span>
        </div>
        <div class="health-quickfact">
          <span class="health-quickfact-label">Total Accounts</span>
          <span class="health-quickfact-value">${accounts.length}</span>
          <span class="health-quickfact-sub">${cashAccounts.length} cash · ${creditCards} credit</span>
        </div>
        <div class="health-quickfact">
          <span class="health-quickfact-label">Available Credit</span>
          <span class="health-quickfact-value">${formatCurrency(availableCredit)}</span>
          <span class="health-quickfact-sub">Limit: ${formatCurrency(totalCreditLimit)}</span>
        </div>
        ${largestAsset ? `
          <div class="health-quickfact">
            <span class="health-quickfact-label">Largest Balance</span>
            <span class="health-quickfact-value">${formatCurrency(largestAsset.balance)}</span>
            <span class="health-quickfact-sub">${escapeHtml(largestAsset.name)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

// ============================================================================
// 🩺 Accounts Health score
// ----------------------------------------------------------------------------
// Same gauge + factor-breakdown pattern as the Dashboard's Financial Health
// score and the Dashboard Quick Look's 30-Day Outlook, applied to a third
// question: not "is my overall finances healthy" or "will I get through the
// next 30 days", but "is the shape of my accounts themselves in good order"
// — low revolving debt, a real cash buffer, spread across account types,
// nothing sitting forgotten. A heuristic for visual/motivational purposes,
// not financial advice.
// ============================================================================
function computeAccountsHealth(accounts, transactions, { totalCreditLimit, usedCredit, utilizationPct }) {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // Credit utilization (40pts) — full marks with no revolving debt at all,
  // scaling down to 0 as utilization approaches/exceeds 100% of the limit.
  const utilizationBar = totalCreditLimit > 0 ? clamp(100 - utilizationPct, 0, 100) : 100;
  const utilizationPts = (utilizationBar / 100) * 40;

  // Cash buffer (35pts) — liquid cash (bank/savings/cash) measured against
  // 3 months of average recent spending, a common emergency-fund benchmark.
  // Falls back to a neutral score if there isn't enough transaction history
  // to estimate monthly expenses.
  const liquidCash = accounts
    .filter(a => ['bank', 'savings', 'cash'].includes(a.type))
    .reduce((sum, a) => sum + toBase(computeAccountBalance(a, transactions), a.currency), 0);

  const now = new Date();
  const monthKeys = [0, 1, 2].map(i => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return d.toISOString().slice(0, 7);
  });
  const monthlyExpenseTotals = monthKeys.map(key =>
    Math.abs(transactions
      .filter(t => t.type === 'expense' && !t.isTransfer && t.date?.startsWith(key))
      .reduce((sum, t) => sum + t.amount, 0))
  ).filter(total => total > 0);
  const monthlyExpenseEstimate = monthlyExpenseTotals.length > 0
    ? monthlyExpenseTotals.reduce((a, b) => a + b, 0) / monthlyExpenseTotals.length
    : 0;
  const monthsOfCoverage = monthlyExpenseEstimate > 0 ? liquidCash / monthlyExpenseEstimate : 0;
  const bufferBar = monthlyExpenseEstimate > 0 ? clamp((monthsOfCoverage / 3) * 100, 0, 100) : 70;
  const bufferPts = (bufferBar / 100) * 35;

  // Diversification (15pts) — full marks at 3+ distinct account types.
  const distinctTypes = new Set(accounts.map(a => a.type)).size;
  const diversificationBar = clamp((distinctTypes / 3) * 100, 0, 100);
  const diversificationPts = (diversificationBar / 100) * 15;

  // Recent activity (10pts) — share of accounts with a transaction in the
  // last 60 days, so a forgotten/unused account pulls the score down a bit.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const activeCount = accounts.filter(a => transactions.some(t => t.accountId === a.id && new Date(t.date) >= cutoff)).length;
  const activityBar = accounts.length > 0 ? (activeCount / accounts.length) * 100 : 0;
  const activityPts = (activityBar / 100) * 10;

  const score = Math.round(clamp(utilizationPts + bufferPts + diversificationPts + activityPts, 0, 100));

  let band, color;
  if (score >= 80)      { band = 'Excellent'; color = 'var(--success)'; }
  else if (score >= 60) { band = 'Good'; color = 'var(--accent)'; }
  else if (score >= 40) { band = 'Fair'; color = '#ea7c1c'; }
  else if (score >= 20) { band = 'Needs Attention'; color = '#f59e0b'; }
  else                  { band = 'At Risk'; color = 'var(--danger)'; }

  return {
    score, band, color,
    utilizationBar, bufferBar, diversificationBar, activityBar,
    liquidCash, monthlyExpenseEstimate, monthsOfCoverage,
    distinctTypes, activeCount
  };
}

function renderAccountsHealthGauge(health) {
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (health.score / 100) * circumference;
  return `
    <svg viewBox="0 0 120 120" class="health-gauge-svg" role="img" aria-label="Accounts health score ${health.score} out of 100, ${health.band}">
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

function renderAccountsFactorRow(icon, label, valueText, barPct, barColor) {
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

// Exported for reuse by the Dashboard's own embedded Accounts summary
// (js/dashboard.js) so both places show the exact same score for the same
// data instead of drifting apart with duplicated logic.
export { computeAccountsHealth, renderAccountsHealthGauge, renderAccountsFactorRow };

function quickAddTransaction(accountId) {
  // Simple prompt for quick transaction addition
  const amount = prompt('Enter transaction amount (negative for expenses):');
  if (amount === null) return;
  
  const description = prompt('Enter description:');
  if (description === null) return;

  const transaction = {
    id: generateId(),
    accountId: accountId,
    amount: parseFloat(amount),
    description: description,
    date: new Date().toISOString().split('T')[0],
    type: parseFloat(amount) < 0 ? 'expense' : 'income',
    categoryId: '', // You might want to add category selection
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  stampAud(transaction).then(tx => addItem(STORE_NAMES.transactions, tx)).then(() => {
    alert('Transaction added successfully!');
    refreshAccountList();
  });
}

function toggleAccountDetails(accountId) {
  const details = document.getElementById(`details-${accountId}`);
  const container = document.getElementById(`recent-${accountId}`);

  const isOpening = details.style.display === "none";

  details.style.display = isOpening ? "block" : "none";

  if (!isOpening) return;

  // Load last 5 transactions for this account
  Promise.all([getAllItems(STORE_NAMES.transactions), getAllItems(STORE_NAMES.accounts)]).then(([allTx, allAccts]) => {
    const txCurrency = allAccts.find(a => a.id === accountId)?.currency;
    const tx = allTx
      .filter(t => t.accountId === accountId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    if (tx.length === 0) {
      container.innerHTML = `<p class="rt-none">No transactions yet.</p>`;
      return;
    }

    container.innerHTML = tx
      .map(t => `
        <div class="rt-item">
          <span class="rt-date">${formatDate(new Date(t.date))}</span>
          <span class="rt-desc">${escapeHtml(t.description) || 'No description'}</span>
          <span class="rt-amt ${t.amount < 0 ? 'neg' : 'pos'}">
            ${formatCurrency(t.amount, txCurrency)}
          </span>
        </div>
      `)
      .join('');
  });
}

export function initAccountsUI() {
  const main = document.getElementById('mainContent');
  main.classList.add('page-transition');

  main.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <h2>🏦 Accounts</h2>
        <div class="page-actions">
          <button id="btnNewAcc" class="btn btn-primary">➕ New Account</button>
          <button id="btnTransfer" class="btn btn-secondary">🔁 Transfer Between Accounts</button>
          <button id="btnAddDefaults" class="btn btn-secondary">📦 Add Defaults</button>
          <button id="btnRemoveDemoAccounts" class="btn btn-secondary">🧹 Remove Demo Accounts</button>
        </div>
      </div>

      <!-- Accounts Health -->
      <div class="section-card" id="accountsHealthCard">Loading…</div>

      <div class="section-card">
        <div class="accounts-controls">
          <div class="search-box">
            <input type="text" id="accountSearch" placeholder="🔍 Search accounts..." class="form-input">
          </div>
          <div class="filter-controls">
            <select id="accountTypeFilter" class="form-select">
              <option value="all">All Account Types</option>
              <option value="bank">🏦 Bank Accounts</option>
              <option value="credit">💳 Credit Cards</option>
              <option value="savings">💰 Savings</option>
              <option value="investment">📈 Investments</option>
              <option value="offset">⚖️ Offset Accounts</option>
              <option value="cash">💵 Cash</option>
              <option value="other">📁 Other</option>
            </select>
          </div>
        </div>
        <div id="accList" class="accounts-grid">Loading…</div>
      </div>
    </div>
  `;

  setTimeout(() => main.classList.remove('page-transition'), 400);

  document.getElementById('btnNewAcc').addEventListener('click', () => openAccountEditor());
  document.getElementById('btnAddDefaults').addEventListener('click', addDefaultAccounts);
  document.getElementById('btnRemoveDemoAccounts').addEventListener('click', removeDemoAccounts);
  document.getElementById('btnTransfer').addEventListener('click', () => openTransferForm());

  // Add search and filter functionality
  document.getElementById('accountSearch').addEventListener('input', refreshAccountList);
  document.getElementById('accountTypeFilter').addEventListener('change', refreshAccountList);

  refreshAccountList();
}

function refreshAccountList() {
  Promise.all([
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.loans),
    getAllItems(STORE_NAMES.transactions),
    getGatedItems(STORE_NAMES.properties).catch(() => [])
  ]).then(async ([accounts, loans, transactions, properties]) => {
    // One-time migration: give any account that predates this change an
    // openingBalance so its live balance (openingBalance + transactions)
    // matches what was already showing, then every future transaction
    // moves it automatically from here on.
    const { accounts: migratedAccounts, changed } = migrateAccountsToOpeningBalance(accounts, transactions);
    if (changed) {
      const originalById = new Map(accounts.map(a => [a.id, a]));
      for (const acc of migratedAccounts) {
        const original = originalById.get(acc.id);
        const wasUnmigrated = original?.openingBalance === undefined || original?.openingBalance === null;
        if (wasUnmigrated) {
          await updateItem(STORE_NAMES.accounts, acc);
        }
      }
      accounts = migratedAccounts;
    }

    const listEl = document.getElementById('accList');
    const searchTerm = document.getElementById('accountSearch').value.toLowerCase();
    const typeFilter = document.getElementById('accountTypeFilter').value;

    if (!accounts.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No accounts yet.</p>
          <button class="btn btn-primary" id="btnAddDefaultsEmpty">📦 Add Default Accounts</button>
        </div>
      `;
      document.getElementById('btnAddDefaultsEmpty').addEventListener('click', addDefaultAccounts);
      updateSummaryCards(accounts, transactions);
      return;
    }

    // Filter accounts based on search and type
    const filteredAccounts = accounts.filter(account => {
      const matchesSearch = account.name.toLowerCase().includes(searchTerm);
      const matchesType = typeFilter === 'all' || account.type === typeFilter;
      return matchesSearch && matchesType;
    });

    // Update summary cards
    updateSummaryCards(accounts, transactions);

    if (filteredAccounts.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No accounts match your search criteria.</p>
          <button class="btn btn-secondary" onclick="document.getElementById('accountSearch').value=''; document.getElementById('accountTypeFilter').value='all'; refreshAccountList();">Clear Filters</button>
        </div>
      `;
      return;
    }

    // Create a mapping of loan IDs to loan names
    const loanMap = {};
    loans.forEach(loan => {
      loanMap[loan.id] = loan.name;
    });

    // Create a mapping of property IDs to property names
    const propertyMap = {};
    properties.forEach(p => {
      propertyMap[p.id] = p.name;
    });

    listEl.innerHTML = filteredAccounts.map(account => {
      const liveBalance = computeAccountBalance(account, transactions);
      const isNegative = liveBalance < 0;
      const isCredit = account.type === 'credit';
      const balanceClass = isNegative ? 'negative' : 'positive';
      const icon = getAccountIcon(account.type);
      
      // Calculate account activity
      const accountTransactions = transactions.filter(t => t.accountId === account.id);
      const lastTransaction = accountTransactions.length > 0 
        ? new Date(Math.max(...accountTransactions.map(t => new Date(t.date))))
        : null;
      
      const daysSinceActivity = lastTransaction 
        ? Math.floor((new Date() - lastTransaction) / (1000 * 60 * 60 * 24))
        : null;

      // FIX: Look up the loan name instead of showing the ID
      let linkedLoanInfo = '';
      if (account.type === 'offset' && account.linkedLoanId) {
        const loanName = loanMap[account.linkedLoanId] || 'Unknown Loan';
        linkedLoanInfo = `<div class="linked-loan">Linked to: ${loanName}</div>`;
      }

      let linkedPropertyInfo = '';
      if (account.linkedPropertyId) {
        const propertyName = propertyMap[account.linkedPropertyId] || 'Unknown Property';
        linkedPropertyInfo = `<div class="linked-loan">🏠 ${escapeHtml(propertyName)}</div>`;
      }

      // Credit utilization for credit cards
      let creditUtilization = '';
      if (isCredit && account.creditLimit && account.creditLimit > 0) {
        const utilization = (Math.abs(liveBalance) / account.creditLimit) * 100;
        creditUtilization = `
          <div class="credit-utilization">
            <div class="utilization-bar">
              <div class="utilization-fill" style="width: ${Math.min(utilization, 100)}%"></div>
            </div>
            <small>${utilization.toFixed(1)}% used</small>
          </div>
        `;
      }

      const instName = institutionDisplayName(account.institution, account.institutionName);
      const maskedNumber = `•••• •••• •••• ${account.last4 || pseudoLast4(account.id)}`;

      // Owing / available split + FY spend trend, credit cards only.
      let creditBalanceBlock = '';
      let creditTrendBlock = '';
      if (isCredit) {
        const todayStr = new Date().toISOString().slice(0, 10);
        // Bug fix: owed used to be Math.abs(Math.min(liveBalance, 0)), which
        // is correct when the card owes money but silently reads as 0 the
        // moment the balance goes positive (more paid onto the card than
        // spent on it — a real, if unusual, "in credit" state). The
        // utilization bar below was separately computing straight off
        // Math.abs(liveBalance) regardless of sign, so the two numbers
        // disagreed: "Owing: $0.00" next to "151.7% of limit used" for the
        // exact same account. creditSurplus captures the in-credit case
        // explicitly so every figure on this card agrees with the others.
        const owed = Math.max(-liveBalance, 0);
        const creditSurplus = Math.max(liveBalance, 0);

        // "Owing" reflects the closed statement, not the live balance, when
        // a closing day is set — anything spent after the statement closed
        // belongs to next cycle and shouldn't inflate what's actually due.
        // Falls back to the live balance if no closing day is configured.
        let statementOwed = owed;
        let statementCloseDate = null;
        if (account.statementCloseDay) {
          statementCloseDate = getLastStatementCloseDate(account.statementCloseDay, todayStr);
          const closeDateStr = statementCloseDate.toISOString().slice(0, 10);
          const statementBalance = computeAccountBalanceAsOf(account, transactions, closeDateStr);
          statementOwed = Math.max(-statementBalance, 0);
        }

        // Real available spending power: your full limit, minus whatever's
        // owed, PLUS any credit surplus sitting on the card (a card that's
        // $3,185.93 in credit gives you that on top of the limit, not
        // instead of it) — same formula the "Available Credit" detail stat
        // below already used; this now matches it instead of quietly
        // capping at the raw limit.
        const available = account.creditLimit ? Math.max(account.creditLimit + liveBalance, 0) : null;
        const nextDueDate = account.statementDueDay ? getNextStatementDueDate(account.statementDueDay, todayStr) : null;

        const owingLine = statementOwed > 0
          ? `Owing${nextDueDate ? ` (due ${formatDate(nextDueDate)})` : ''}: ${formatCurrency(statementOwed, account.currency)}`
          : creditSurplus > 0
            ? `In credit: ${formatCurrency(creditSurplus, account.currency)}`
            : `Owing: ${formatCurrency(0, account.currency)}`;

        creditBalanceBlock = `
          <span class="bank-card-balance-label">Available to use</span>
          <div class="bank-card-balance-primary">${available !== null ? formatCurrency(available, account.currency) : '—'}</div>
          <div class="bank-card-balance-secondary">${owingLine}</div>
        `;

        const { values: trendValues, labels: trendLabels } = computeFYExpenseTrend(account.id, transactions);
        const hasSpend = trendValues.some(v => v > 0);
        creditTrendBlock = `
          <div class="bank-card-trend">
            <small>Card expenses this financial year</small>
            ${hasSpend ? renderCardTrendSparkline(trendValues) : '<div class="bank-card-trend-empty">No spend recorded yet</div>'}
            <div class="bank-card-trend-range"><span>${trendLabels[0]}</span><span>${trendLabels[trendLabels.length - 1]}</span></div>
          </div>
        `;
      }

      return `
        <div class="account-card-wrap">
        <div class="bank-card account-header type-${account.type} ${isNegative ? 'is-negative' : ''}" data-id="${account.id}">
          <div class="bank-card-top">
            <div class="bank-card-issuer">
              ${renderInstitutionMark(account.institution, account.institutionName)}
              <div>
                <div class="bank-card-issuer-name">${escapeHtml(instName || getAccountTypeLabel(account.type))}</div>
                <div class="bank-card-type-tag">${getAccountTypeLabel(account.type)}</div>
              </div>
            </div>
            <div class="bank-card-chip" aria-hidden="true"></div>
          </div>

          <div class="bank-card-number">${maskedNumber}</div>

          <div class="bank-card-bottom">
            <div>
              <p class="bank-card-name">${escapeHtml(account.name)}</p>
              <p class="bank-card-sub">${lastTransaction ? `Last activity: ${daysSinceActivity === 0 ? 'Today' : `${daysSinceActivity} days ago`}` : 'No transactions yet'}</p>
              ${linkedLoanInfo}
              ${linkedPropertyInfo}
            </div>
            <div class="bank-card-balance ${balanceClass}">
              ${isCredit ? creditBalanceBlock : `
                <span class="bank-card-balance-label">Balance</span>
                ${formatCurrency(liveBalance, account.currency)}
              `}
              ${account.currency && account.currency !== getBaseCurrency() ? `<small class="bank-card-base-equiv">${hasRate(account.currency) ? baseEquivalent(liveBalance, account.currency) : `No ${account.currency}→${getBaseCurrency()} rate set (Settings)`}</small>` : ''}
            </div>
          </div>
        </div>
          <div id="details-${account.id}" class="account-details" style="display: none;">
            <div class="account-actions">
              <button class="btn btn-secondary" data-id="${account.id}" data-action="edit">✏️ Edit</button>
              <button class="btn btn-danger" data-id="${account.id}" data-action="delete">🗑️ Delete</button>
              <button class="btn btn-primary" data-id="${account.id}" data-action="quick-add">💸 Quick Add Transaction</button>
              <button class="btn btn-secondary" data-id="${account.id}" data-action="reconcile" title="Fix the balance to match your real bank/card statement">⚖️ Reconcile Balance</button>
            </div>

            <div class="account-stats">
              <div class="stat">
                <span class="stat-label">Transactions</span>
                <span class="stat-value">${accountTransactions.length}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Last Activity</span>
                <span class="stat-value">${lastTransaction ? formatDate(lastTransaction) : 'Never'}</span>
              </div>
              ${isCredit && account.creditLimit ? `
                <div class="stat">
                  <span class="stat-label">Available Credit</span>
                  <span class="stat-value positive">${formatCurrency(account.creditLimit + liveBalance, account.currency)}</span>
                </div>
              ` : ''}
            </div>

            ${isCredit && account.creditLimit ? `
              <div class="bank-card-progress">
                <div class="utilization-bar"><div class="utilization-fill" style="width: ${Math.min((Math.max(-liveBalance, 0) / account.creditLimit) * 100, 100)}%"></div></div>
                <small>${((Math.max(-liveBalance, 0) / account.creditLimit) * 100).toFixed(1)}% of ${formatCurrency(account.creditLimit, account.currency)} limit used</small>
              </div>
            ` : ''}

            ${isCredit ? creditTrendBlock : ''}

            <div class="recent-transactions" id="recent-${account.id}">
              <p class="rt-title">Recent Transactions</p>
              <div class="rt-loading">Loading…</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners
    listEl.querySelectorAll('.account-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const id = e.target.closest('.account-header').dataset.id;
        toggleAccountDetails(id);
      });
    });

    listEl.querySelectorAll('.btn').forEach(btn => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action === 'edit') openAccountEditor(id);
        else if (action === 'delete') {
          if (confirm('Delete this account? This will also remove all associated transactions.')) {
            deleteItem(STORE_NAMES.accounts, id).then(refreshAccountList);
          }
        } else if (action === 'quick-add') {
          quickAddTransaction(id);
        } else if (action === 'reconcile') {
          reconcileAccountBalance(id);
        }
      });
    });
  });
}

// ============================================================================
// 🔁 Transfer Between Accounts
// ----------------------------------------------------------------------------
// Records money moving between two of your own accounts — e.g. paying off a
// credit card from savings — as a linked pair of transactions instead of two
// disconnected entries. Both sides use the "General Transfer" category and
// share a transferGroupId, and are flagged isTransfer so income/expense
// summaries (dashboard, budgets) don't mistake them for real income or
// spending, while account balances (which sum ALL transactions on an
// account) update correctly on both sides automatically.
// ============================================================================
function openTransferForm() {
  Promise.all([
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.categories)
  ]).then(([accounts, transactions, categories]) => {
    const main = document.getElementById('mainContent');
    main.classList.add('page-transition');

    if (accounts.length < 2) {
      alert('You need at least two accounts to record a transfer.');
      initAccountsUI();
      return;
    }

    const transferCategory = categories.find(c => c.id === 'sub_general_transfer');

    const accountOption = acc => {
      const bal = computeAccountBalance(acc, transactions);
      return `<option value="${acc.id}">${getAccountIcon(acc.type)} ${escapeHtml(acc.name)} (${formatCurrency(bal, acc.currency)})</option>`;
    };

    main.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <h2>🔁 Transfer Between Accounts</h2>
        </div>
        <div class="section-card">
          <form id="transferForm" class="styled-form">
            <div class="form-group">
              <label>From Account</label>
              <select name="fromAccountId" class="form-select" required>
                <option value="">-- Select Account --</option>
                ${accounts.map(accountOption).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>To Account</label>
              <select name="toAccountId" class="form-select" required>
                <option value="">-- Select Account --</option>
                ${accounts.map(accountOption).join('')}
              </select>
            </div>
            <div class="form-group">
              <label id="amountLabel">Amount</label>
              <input type="number" step="0.01" min="0.01" name="amount" class="form-input" placeholder="0.00" required>
            </div>
            <div class="form-group" id="receivedGroup" style="display:none">
              <label id="receivedLabel">Amount received</label>
              <input type="number" step="0.01" min="0.01" name="receivedAmount" class="form-input" placeholder="0.00">
              <small id="impliedRate"></small>
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" name="date" class="form-input" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
              <label>Description (optional)</label>
              <input type="text" name="description" class="form-input" placeholder="e.g. Credit card payment">
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">🔁 Record Transfer</button>
              <button class="btn btn-secondary" type="button" id="btnCancelTransfer">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    setTimeout(() => main.classList.remove('page-transition'), 400);

    document.getElementById('btnCancelTransfer').addEventListener('click', initAccountsUI);

    // Cross-currency transfers: ask for both amounts and show the implied rate.
    const tForm = document.getElementById('transferForm');
    const curOf = id => accounts.find(a => a.id === id)?.currency || getBaseCurrency();
    const refreshFx = () => {
      const from = tForm.elements.fromAccountId.value, to = tForm.elements.toAccountId.value;
      const fc = from ? curOf(from) : null, tc = to ? curOf(to) : null;
      const cross = fc && tc && fc !== tc;
      document.getElementById('receivedGroup').style.display = cross ? '' : 'none';
      document.getElementById('amountLabel').textContent = fc ? `Amount sent (${fc})` : 'Amount';
      if (cross) document.getElementById('receivedLabel').textContent = `Amount received (${tc})`;
      const sent = parseFloat(tForm.elements.amount.value), got = parseFloat(tForm.elements.receivedAmount.value);
      document.getElementById('impliedRate').textContent =
        cross && sent > 0 && got > 0 ? `Implied rate: 1 ${fc} = ${(got / sent).toFixed(4)} ${tc}` : '';
    };
    ['fromAccountId', 'toAccountId', 'amount', 'receivedAmount'].forEach(n =>
      tForm.elements[n].addEventListener('input', refreshFx));

    document.getElementById('transferForm').addEventListener('submit', async e => {
      e.preventDefault();
      const data = new FormData(e.target);
      const fromAccountId = data.get('fromAccountId');
      const toAccountId = data.get('toAccountId');
      const amount = parseFloat(data.get('amount'));
      const date = data.get('date');
      const note = data.get('description').trim();

      if (fromAccountId === toAccountId) {
        alert('From and To accounts must be different.');
        return;
      }
      if (isNaN(amount) || amount <= 0) {
        alert('Enter a valid amount greater than 0.');
        return;
      }

      const fromAccount = accounts.find(a => a.id === fromAccountId);
      const toAccount = accounts.find(a => a.id === toAccountId);
      const crossCurrency = (fromAccount.currency || getBaseCurrency()) !== (toAccount.currency || getBaseCurrency());
      const receivedAmount = crossCurrency ? parseFloat(data.get('receivedAmount')) : amount;
      if (crossCurrency && (isNaN(receivedAmount) || receivedAmount <= 0)) {
        alert(`These accounts use different currencies: enter the amount received in ${toAccount.currency}.`);
        return;
      }
      const transferGroupId = generateId();
      const now = new Date().toISOString();
      const label = note ? ` — ${note}` : '';

      const outTx = {
        id: generateId(),
        accountId: fromAccountId,
        amount: -amount,
        type: 'expense',
        categoryId: transferCategory?.id || 'sub_general_transfer',
        date,
        description: `Transfer to ${toAccount.name}${label}`,
        isTransfer: true,
        transferGroupId,
        transferDirection: 'out',
        ...(crossCurrency ? { fxRate: receivedAmount / amount, fxFrom: fromAccount.currency, fxTo: toAccount.currency } : {}),
        createdAt: now,
        updatedAt: now
      };

      const inTx = {
        id: generateId(),
        accountId: toAccountId,
        amount: receivedAmount,
        type: 'income',
        categoryId: transferCategory?.id || 'sub_general_transfer',
        date,
        description: `Transfer from ${fromAccount.name}${label}`,
        isTransfer: true,
        transferGroupId,
        transferDirection: 'in',
        ...(crossCurrency ? { fxRate: receivedAmount / amount, fxFrom: fromAccount.currency, fxTo: toAccount.currency } : {}),
        createdAt: now,
        updatedAt: now
      };

      await addItem(STORE_NAMES.transactions, outTx);
      await addItem(STORE_NAMES.transactions, inTx);

      alert(`Transfer recorded: ${formatCurrency(amount, fromAccount.currency)} from ${fromAccount.name}` + (crossCurrency ? ` (${formatCurrency(receivedAmount, toAccount.currency)} received)` : '') + ` to ${toAccount.name}.`);
      initAccountsUI();
    });
  });
}

// Lets the person type in their account's ACTUAL current balance (read
// straight off their real bank/card statement) and recalculates
// openingBalance so the app's computed balance matches it going forward:
//     openingBalance = realBalance - sum(every transaction on this account)
//
// This is the fix for the one-time migration producing a wrong number —
// that migration assumed the old "Starting Balance" field had always been
// kept in sync with reality. If it was actually just left at its default
// (commonly $0) while months of real transactions were already imported,
// the migration's math cancels itself out and shows a balance near zero
// regardless of real spending. Reconciling with a real, freshly-checked
// number breaks that self-cancellation for good.
async function reconcileAccountBalance(accountId) {
  const [accounts, transactions] = await Promise.all([
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions)
  ]);
  const account = accounts.find(a => a.id === accountId);
  if (!account) return;

  const currentComputed = computeAccountBalance(account, transactions);
  const isCredit = account.type === 'credit';

  const promptText = isCredit
    ? `What does your card statement/app currently say you owe (as a positive number, e.g. 1400.50)?\n\n` +
      `The app currently calculates: ${formatCurrency(currentComputed, account.currency)}`
    : `What's the current real balance shown on your bank statement/app?\n\n` +
      `The app currently calculates: ${formatCurrency(currentComputed, account.currency)}`;

  const input = prompt(promptText);
  if (input === null || input.trim() === '') return;

  let realBalance = parseFloat(input);
  if (isNaN(realBalance)) {
    alert('Please enter a valid number.');
    return;
  }
  // For credit cards, ask for the amount owed as a positive number (more
  // natural — "I owe $1,400") but store it the same way as everywhere
  // else in the app: negative = owed.
  if (isCredit && realBalance > 0) realBalance = -realBalance;

  const txTotal = transactions
    .filter(t => t.accountId === accountId)
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

  const newOpeningBalance = realBalance - txTotal;

  await updateItem(STORE_NAMES.accounts, {
    ...account,
    openingBalance: newOpeningBalance,
    updatedAt: new Date().toISOString()
  });

  alert(`Balance reconciled. ${account.name} now shows ${formatCurrency(realBalance, account.currency)}, and every transaction from here on will move it correctly.`);
  refreshAccountList();
}

function openAccountEditor(id) {
  if (id) {
    Promise.all([
      getAllItems(STORE_NAMES.accounts),
      getAllItems(STORE_NAMES.transactions)
    ]).then(([list, transactions]) => {
      const acc = list.find(x => x.id === id);
      const liveBalance = computeAccountBalance(acc, transactions);
      showAccountForm(acc, liveBalance);
    });
  } else {
    showAccountForm({ name: '', type: 'bank', openingBalance: 0, currency: getBaseCurrency() }, 0);
  }
}

function showAccountForm(acc, liveBalance = null) {
  const main = document.getElementById('mainContent');
  main.classList.add('page-transition');
  const isNew = !acc.id;
  const openingBalanceValue = acc.openingBalance ?? acc.balance ?? 0;

  // Fetch all loans + properties
  Promise.all([
    getAllItems(STORE_NAMES.loans),
    getGatedItems(STORE_NAMES.properties).catch(() => [])
  ]).then(([loans, properties]) => {
    const loanOptions = loans.map(loan => ` 
      <option value="${loan.id}" ${acc.linkedLoanId === loan.id ? 'selected' : ''}>
        ${escapeHtml(loan.name)}
      </option>
    `).join('');

    const propertyOptions = properties.map(p => `
      <option value="${p.id}" ${acc.linkedPropertyId === p.id ? 'selected' : ''}>
        ${escapeHtml(p.name)}
      </option>
    `).join('');

    main.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <h2>${acc.id ? '✏️ Edit' : '➕ New'} Account</h2>
        </div>

        <div class="section-card">
          <form id="accForm" class="styled-form">
            <div class="form-group">
              <label>Name</label>
              <input type="text" name="name" value="${escapeHtml(acc.name)}" class="form-input" required>
            </div>

            <div class="form-group">
              <label>Type</label>
              <select name="type" class="form-select" required>
                <option value="bank" ${acc.type === 'bank' ? 'selected' : ''}>🏦 Bank</option>
                <option value="credit" ${acc.type === 'credit' ? 'selected' : ''}>💳 Credit</option>
                <option value="cash" ${acc.type === 'cash' ? 'selected' : ''}>💵 Cash</option>
                <option value="investment" ${acc.type === 'investment' ? 'selected' : ''}>📈 Investment</option>
                <option value="savings" ${acc.type === 'savings' ? 'selected' : ''}>💰 Savings</option>
                <option value="offset" ${acc.type === 'offset' ? 'selected' : ''}>⚖️ Offset</option>
                <option value="other" ${acc.type === 'other' ? 'selected' : ''}>📁 Other</option>
              </select>
            </div>

            <div class="form-group">
              <label>Opening Balance</label>
              <input type="number" step="0.01" name="openingBalance" value="${openingBalanceValue}" class="form-input" required>
              <small class="form-hint">
                ${isNew
                  ? 'Balance before any transactions are recorded against this account. Use negative for owed balances (e.g. an existing credit card debt).'
                  : `Editing this shifts the current balance by the same amount. Current calculated balance: ${formatCurrency(liveBalance, acc.currency)} (opening balance + all transactions on this account).`}
              </small>
            </div>

            <div class="form-group">
              <label>Currency</label>
              <select name="currency" class="form-select" required>
                ${getCurrencies().map(c => c.code).map(cur => `
                  <option value="${cur}" ${acc.currency === cur ? 'selected' : ''}>${cur}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Bank / Institution</label>
              <select name="institution" class="form-select">
                <option value="">-- None / Cash --</option>
                ${institutionOptions(acc.institution)}
              </select>
              <small class="form-hint">Shown as the logo on the account card.</small>
            </div>

            <div id="customInstitutionField" class="form-group" style="display:${acc.institution === 'other' ? 'block' : 'none'};">
              <label>Institution Name</label>
              <input type="text" name="institutionName" value="${escapeHtml(acc.institutionName || '')}" class="form-input" placeholder="e.g. Community Credit Union">
            </div>

            <div class="form-group">
              <label>Card / Account Number — last 4 digits (optional)</label>
              <input type="text" name="last4" value="${escapeHtml(acc.last4 || '')}" maxlength="4" pattern="[0-9]{0,4}" inputmode="numeric" class="form-input" placeholder="e.g. 1234">
              <small class="form-hint">Cosmetic only, shown as •••• •••• •••• 1234 on the card. Leave blank to auto-generate a placeholder.</small>
            </div>

            <div id="creditFields" class="form-group" style="display:${acc.type === 'credit' ? 'block' : 'none'};">
              <label>Credit Limit</label>
              <input type="number" step="0.01" name="creditLimit" value="${acc.creditLimit || 0}" class="form-input">
              <label style="margin-top:0.75rem;">Statement Closing Day (optional)</label>
              <input type="number" min="1" max="31" name="statementCloseDay" value="${acc.statementCloseDay || ''}" class="form-input" placeholder="e.g. 15">
              <small class="form-hint">
                Day of the month your statement snapshot closes. Used to work
                out the actual "Owing" amount from that closed statement,
                rather than today's live running balance — anything you
                spend after this day counts toward next month's statement.
              </small>
              <label style="margin-top:0.75rem;">Bill Due Day (optional)</label>
              <input type="number" min="1" max="31" name="statementDueDay" value="${acc.statementDueDay || ''}" class="form-input" placeholder="e.g. 22">
              <small class="form-hint">
                Day of the month that closed statement is due to be paid by.
                Used to show "Next payment due" on the Dashboard Quick Look
                and on the account card — doesn't create a Bill by itself,
                so pair it with a recurring "Credit Card Payment" bill (see
                the Bills page) if you want it paid automatically.
              </small>
            </div>

            <div id="linkedLoan" class="form-group" style="display:${acc.type === 'offset' ? 'block' : 'none'};">
              <label>Linked Loan</label>
              <select name="linkedLoanId" class="form-select">
                <option value="">-- Select Loan --</option>
                ${loanOptions}
              </select>
              <small class="form-hint">Select the loan this account is linked to.</small>
            </div>

            <div class="form-group" data-feature="property">
              <label>Linked Property (optional)</label>
              <select name="linkedPropertyId" class="form-select">
                <option value="">-- None / Shared account --</option>
                ${propertyOptions}
              </select>
              <small class="form-hint">
                If this account is dedicated to one property — a property-specific loan,
                or a transaction account used only for that property's rent and bills —
                linking it here automatically flags every expense and rental income on
                this account for that property on import, no manual tagging needed. Two
                accounts (e.g. an original loan plus a later equity/redraw loan) can link
                to the same property. Leave as "None" for a shared everyday account used
                across multiple properties or personal spending.
              </small>
            </div>

            <div class="form-actions">
              <button class="btn btn-primary" type="submit">${acc.id ? '💾 Update' : '➕ Add'} Account</button>
              <button class="btn btn-secondary" type="button" id="btnCancel">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    setTimeout(() => main.classList.remove('page-transition'), 400);

    document.querySelector('select[name="type"]').addEventListener('change', function() {
      document.getElementById('creditFields').style.display = this.value === 'credit' ? 'block' : 'none';
      document.getElementById('linkedLoan').style.display = this.value === 'offset' ? 'block' : 'none';
    });

    document.querySelector('select[name="institution"]').addEventListener('change', function() {
      document.getElementById('customInstitutionField').style.display = this.value === 'other' ? 'block' : 'none';
    });

    document.getElementById('btnCancel').addEventListener('click', initAccountsUI);

    document.getElementById('accForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target;
      const data = new FormData(form);

      // Built by the shared records.js so the setup guide (onboarding.js)
      // creates accounts identical to ones added here.
      const newAcc = buildAccountRecord(Object.fromEntries(data), {
        id: acc.id || generateId(),
        createdAt: acc.createdAt
      });

      if (acc.id) await updateItem(STORE_NAMES.accounts, newAcc);
      else await addItem(STORE_NAMES.accounts, newAcc);

      initAccountsUI();
    });
  });
}