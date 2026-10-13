// ============================================================================
// 💰 superannuation.js — Superannuation Tracker
// ============================================================================
// A dedicated page for tracking super, deliberately separate from
// accounts/loans/properties: super isn't a bank account (no transactions to
// import/reconcile), isn't a loan, and isn't a property expense — it's its
// own asset class with its own shape of data (a fund per member, balance
// snapshots over time, contributions, insurance held inside the fund).
//
// Supports multiple funds/members (e.g. one per spouse, or multiple funds
// per person). Three record types per fund, each its own store:
//   - super_balance_history: manually-entered {date, balance} snapshots —
//     there's no live feed, so the user updates this whenever they check
//     their fund's balance (e.g. each statement).
//   - super_contributions: employer/personal/salary-sacrifice contributions,
//     grouped by Australian financial year (Jul–Jun) using the same
//     getFinancialYear() helper the ATO Reports/Cost Base pages already use.
//   - super_premiums: insurance held inside the fund (life/TPD/income
//     protection) — a small set of ongoing amount+frequency facts rather
//     than a dated log, so they're summarised as an annualised total.
//
// List view shows all funds with headline numbers; clicking into a fund
// shows its balance chart, contribution log, and insurance premiums —
// the same "selectedX drills into detail" pattern cost_base_tracker.js
// uses for properties.

import {
  getAllItems, addItem, updateItem, deleteItem, STORE_NAMES,
  getFinancialYear, getCurrentFinancialYear
} from './db.js';
import { escapeHtml } from './sanitize.js';
import { processSuperRecurringContributions } from './superRecurringJob.js';

import { formatMoney } from './utils/currency.js';
let superChart = null; // Chart.js instance for the selected fund's balance history — destroyed/recreated on re-render
let superSummaryChart = null; // Chart.js instance for the fund-list summary donut — same destroy/recreate pattern

// Module state, loaded fresh on every initSuperannuationUI() call
let funds = [];
let balanceHistory = [];
let contributions = [];
let premiums = [];
let fees = [];
let recurringContribs = []; // Recurring contribution schedules (see superRecurringJob.js)
let selectedFundId = null; // null = list view; a fund id = that fund's detail view
let contribFYFilter = null; // financial year string, or 'all' — set to the current FY the first time a fund is opened

const PERIODS_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, halfyearly: 2, annual: 1, annually: 1 };

function formatCurrency(amount) {
  return formatMoney(amount, 'AUD');
}

function compactMoney(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function annualisedPremium(premium) {
  const periods = PERIODS_PER_YEAR[premium.frequency] || 1;
  return (Number(premium.amount) || 0) * periods;
}

function contributionTypeLabel(type) {
  return { employer: '🏢 Employer', personal: '👤 Personal', 'salary-sacrifice': '💼 Salary Sacrifice' }[type] || type;
}

function frequencyLabel(freq) {
  return {
    weekly: '📅 Weekly', fortnightly: '📆 Fortnightly', monthly: '🗓️ Monthly',
    quarterly: '📊 Quarterly', halfyearly: '🌗 Half-Yearly', annually: '🎯 Annually'
  }[freq] || freq;
}

// Next due date for a recurring contribution schedule, for display only —
// the actual processing engine (superRecurringJob.js) recomputes this from
// scratch using the same anchor logic, this is just a preview.
function nextDueDateFor(rec) {
  const anchor = rec.lastProcessed || rec.catchUpFrom || rec.startDate;
  if (!anchor) return null;
  const d = new Date(anchor);
  if (rec.lastProcessed || rec.catchUpFrom) {
    switch (rec.frequency) {
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'fortnightly': d.setDate(d.getDate() + 14); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'quarterly': d.setMonth(d.getMonth() + 3); break;
      case 'halfyearly': d.setMonth(d.getMonth() + 6); break;
      case 'annually': case 'annual': d.setFullYear(d.getFullYear() + 1); break;
    }
  }
  return d.toISOString().slice(0, 10);
}

function premiumTypeLabel(type) {
  return { life: '🛡️ Life', tpd: '🛡️ TPD', income_protection: '🛡️ Income Protection', other: '🛡️ Other' }[type] || type;
}

function feeTypeLabel(type) {
  return { admin: '🧾 Administration', investment: '📈 Investment', other: '🧾 Other' }[type] || type;
}

// Latest balance snapshot for a fund (or null if none entered yet)
function latestBalanceFor(fundId) {
  const entries = balanceHistory
    .filter(b => b.fundId === fundId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return entries[0] || null;
}

// Total current super balance across all funds — each fund's most recent
// balance_history snapshot, summed. Exported so net-worth calculations
// elsewhere (dashboard.js, wealthOverview.js) can include super without
// duplicating the "latest snapshot per fund" logic, and without needing
// this module's own module-level funds/balanceHistory state, which is
// only populated after initSuperannuationUI() has run.
export function getTotalSuperBalance(funds, allBalanceHistory) {
  return (funds || []).reduce((sum, f) => {
    const entries = (allBalanceHistory || [])
      .filter(b => b.fundId === f.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sum + (entries[0]?.balance || 0);
  }, 0);
}

function contributionsTotalFor(fundId, financialYear) {
  return contributions
    .filter(c => c.fundId === fundId && (!financialYear || financialYear === 'all' || c.financialYear === financialYear))
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

function annualisedPremiumsTotalFor(fundId) {
  return premiums.filter(p => p.fundId === fundId).reduce((sum, p) => sum + annualisedPremium(p), 0);
}

function annualisedFeesTotalFor(fundId) {
  return fees.filter(f => f.fundId === fundId).reduce((sum, f) => sum + annualisedPremium(f), 0);
}

// ============================================================================
// 🚀 Entry point
// ============================================================================
export async function initSuperannuationUI(fundId = null) {
  const mainContent = document.getElementById('mainContent');
  mainContent.classList.add('page-transition');

  [funds, balanceHistory, contributions, premiums, recurringContribs, fees] = await Promise.all([
    getAllItems(STORE_NAMES.superFunds),
    getAllItems(STORE_NAMES.superBalanceHistory),
    getAllItems(STORE_NAMES.superContributions),
    getAllItems(STORE_NAMES.superPremiums),
    getAllItems(STORE_NAMES.superRecurring),
    getAllItems(STORE_NAMES.superFees)
  ]);

  selectedFundId = fundId && funds.some(f => f.id === fundId) ? fundId : null;
  if (selectedFundId && contribFYFilter === null) {
    contribFYFilter = getCurrentFinancialYear();
  }

  render();
  setTimeout(() => mainContent.classList.remove('page-transition'), 400);
}

function render() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = selectedFundId ? renderFundDetailPage() : renderFundListPage();

  if (selectedFundId) {
    attachFundDetailListeners();
    renderBalanceChart();
  } else {
    attachFundListListeners();
    renderSuperSummaryDonut();
  }
}

// Fund-list summary donut — per-fund balance breakdown. Same
// destroy-before-recreate pattern as renderBalanceChart below (this
// module already had one Chart.js instance to manage; now it has two).
function renderSuperSummaryDonut() {
  const canvas = document.getElementById('superSummaryDonut');
  if (!canvas || typeof Chart === 'undefined') return;
  if (superSummaryChart) {
    superSummaryChart.destroy();
    superSummaryChart = null;
  }
  if (funds.length === 0) return;
  const palette = ['#c9a227', '#5b8def', '#a06bff', '#3ddc97', '#ffb454', '#ff6b7a', '#3a4a63'];
  superSummaryChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: funds.map(f => f.fundName),
      datasets: [{
        data: funds.map(f => latestBalanceFor(f.id)?.balance || 0),
        backgroundColor: funds.map((_, i) => palette[i % palette.length]),
        borderWidth: 0
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      cutout: '70%',
      maintainAspectRatio: false
    }
  });
}

// ============================================================================
// 📋 List view — all funds + portfolio-wide summary
// ============================================================================
function renderFundListPage() {
  const totalBalance = funds.reduce((sum, f) => sum + (latestBalanceFor(f.id)?.balance || 0), 0);
  const currentFY = getCurrentFinancialYear();
  const totalContribsThisFY = funds.reduce((sum, f) => sum + contributionsTotalFor(f.id, currentFY), 0);
  const totalAnnualPremiums = funds.reduce((sum, f) => sum + annualisedPremiumsTotalFor(f.id), 0);

  return `
    <div class="page-container">
      <div class="page-header">
        <h2>💰 Superannuation</h2>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnNewFund">➕ Add Fund</button>
        </div>
      </div>

      <!-- Superannuation Summary — same fo-card donut + per-row progress
           bar treatment as Budgets/Transactions/Loans, in place of the
           old plain number cards. Donut breaks total balance down by
           fund (a portfolio-allocation view, same idea as Wealth
           Overview's Portfolio Review), since "Total Balance" on its own
           doesn't have a natural spent/remaining split the way a budget
           or a loan does. -->
      <div class="fo-card fo-card-wide">
        <div class="fo-card-header-row">
          <span class="fo-card-title">Superannuation Summary</span>
          <span class="fo-card-subtitle">${funds.length} fund${funds.length === 1 ? '' : 's'}</span>
        </div>
        <div class="fo-budget-layout fo-costs-layout">
          <div class="fo-chart-wrap fo-donut-wrap">
            <canvas id="superSummaryDonut"></canvas>
            <div class="fo-donut-center">
              <span class="fo-donut-center-value">${compactMoney(totalBalance)}</span>
              <span class="fo-donut-center-label">Total Balance</span>
            </div>
          </div>
          <div class="fo-costs-legend">
            ${funds.length === 0
              ? `<div class="fo-empty-note">No funds added yet.</div>`
              : funds.map((f, i) => {
                  const bal = latestBalanceFor(f.id)?.balance || 0;
                  const pct = totalBalance > 0 ? (bal / totalBalance) * 100 : 0;
                  const palette = ['#c9a227', '#5b8def', '#a06bff', '#3ddc97', '#ffb454', '#ff6b7a', '#3a4a63'];
                  const color = palette[i % palette.length];
                  return `
                    <div class="fo-legend-row">
                      <span class="fo-legend-dot" style="background:${color};"></span>
                      <span class="fo-legend-label">${escapeHtml(f.fundName)}</span>
                      <span class="fo-legend-pct">${Math.round(pct)}%</span>
                      <span class="fo-legend-value">${formatCurrency(bal)}</span>
                    </div>
                    <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${Math.min(100, pct)}%;background:${color}"></div></div>
                  `;
                }).join('')
            }
          </div>
        </div>
        <div class="fo-budget-mid" style="margin-top:0.75rem;">
          <div class="fo-legend-row">
            <span class="fo-legend-dot" style="background:#5b8def;"></span>
            <span class="fo-legend-label">Contributions ${escapeHtml(currentFY)}</span>
            <span class="fo-legend-value">${formatCurrency(totalContribsThisFY)}</span>
          </div>
          <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${(totalContribsThisFY + totalAnnualPremiums) > 0 ? Math.min(100, (totalContribsThisFY / (totalContribsThisFY + totalAnnualPremiums)) * 100) : 0}%;background:#5b8def"></div></div>
          <div class="fo-legend-row">
            <span class="fo-legend-dot" style="background:#ffb454;"></span>
            <span class="fo-legend-label">Insurance (per year)</span>
            <span class="fo-legend-value">${formatCurrency(totalAnnualPremiums)}</span>
          </div>
          <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${(totalContribsThisFY + totalAnnualPremiums) > 0 ? Math.min(100, (totalAnnualPremiums / (totalContribsThisFY + totalAnnualPremiums)) * 100) : 0}%;background:#ffb454"></div></div>
        </div>
      </div>

      <!-- Add Fund Form -->
      <div class="forms-section">
        <div id="fundFormSection" class="section-card form-section" style="display: none;">
          <div class="form-header">
            <h3 id="fundFormTitle">➕ Add Super Fund</h3>
            <button class="btn btn-text" id="closeFundForm">✕</button>
          </div>
          <form id="fundForm" class="styled-form">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Member</label>
                <input type="text" name="member" class="form-input" placeholder="e.g. Sam, Jamie..." required>
              </div>
              <div class="form-group">
                <label class="form-label">Fund Name</label>
                <input type="text" name="fundName" class="form-input" placeholder="e.g. AustralianSuper" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Member Number</label>
                <input type="text" name="memberNumber" class="form-input" placeholder="Optional">
              </div>
              <div class="form-group">
                <label class="form-label">Investment Option</label>
                <input type="text" name="investmentOption" class="form-input" placeholder="e.g. Balanced, High Growth (optional)">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex: 1 1 100%;">
                <label class="form-label">Notes</label>
                <input type="text" name="notes" class="form-input" placeholder="Optional">
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">💾 Save Fund</button>
              <button class="btn btn-secondary" type="reset">🧹 Clear</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Fund Cards -->
      <div class="section-card">
        <div class="transactions-header">
          <h3>Your Super Funds</h3>
          <span class="transactions-count">${funds.length} fund${funds.length === 1 ? '' : 's'}</span>
        </div>
        <div id="fundsList">${renderFundCards()}</div>
      </div>
    </div>
  `;
}

function renderFundCards() {
  if (!funds.length) {
    return `
      <div class="empty-state">
        <p>No super funds added yet.</p>
        <button class="btn btn-primary" onclick="document.getElementById('btnNewFund').click()">➕ Add Your First Fund</button>
      </div>
    `;
  }

  return funds.map(fund => {
    const latest = latestBalanceFor(fund.id);
    const currentFY = getCurrentFinancialYear();
    const fyContribs = contributionsTotalFor(fund.id, currentFY);
    const annualPremiums = annualisedPremiumsTotalFor(fund.id);

    return `
      <div class="section-card" data-fund-id="${fund.id}" style="margin-bottom: 1rem;">
        <div class="transactions-header">
          <div>
            <h3 style="margin-bottom: 0.15rem;">${escapeHtml(fund.fundName)}</h3>
            <p class="form-hint" style="margin: 0;">${escapeHtml(fund.member)}${fund.memberNumber ? ` · Member #${escapeHtml(fund.memberNumber)}` : ''}${fund.investmentOption ? ` · ${escapeHtml(fund.investmentOption)}` : ''}</p>
          </div>
          <div class="transactions-controls">
            <button class="btn btn-text btn-edit-fund" data-id="${fund.id}" title="Edit">✏️</button>
            <button class="btn btn-text btn-delete-fund" data-id="${fund.id}" title="Delete">🗑️</button>
          </div>
        </div>

        <div class="form-row" style="margin: 0.75rem 0;">
          <div class="form-group">
            <span class="form-hint">Balance</span>
            <div class="${latest ? '' : 'text-muted'}" style="font-size: 1.2rem; font-weight: 600;">
              ${latest ? formatCurrency(latest.balance) : 'Not recorded yet'}
            </div>
            ${latest ? `<span class="form-hint">As of ${formatDate(latest.date)}</span>` : ''}
          </div>
          <div class="form-group">
            <span class="form-hint">Contributions ${escapeHtml(currentFY)}</span>
            <div style="font-size: 1.2rem; font-weight: 600;">${formatCurrency(fyContribs)}</div>
          </div>
          <div class="form-group">
            <span class="form-hint">Insurance (per year)</span>
            <div style="font-size: 1.2rem; font-weight: 600;">${formatCurrency(annualPremiums)}</div>
          </div>
        </div>

        <button class="btn btn-secondary btn-manage-fund" data-id="${fund.id}">📊 Manage Balance, Contributions &amp; Insurance</button>
      </div>
    `;
  }).join('');
}

function attachFundListListeners() {
  const btnNewFund = document.getElementById('btnNewFund');
  const fundFormSection = document.getElementById('fundFormSection');
  const closeFundForm = document.getElementById('closeFundForm');
  const fundForm = document.getElementById('fundForm');

  btnNewFund.addEventListener('click', () => {
    const isVisible = fundFormSection.style.display === 'block';
    fundFormSection.style.display = isVisible ? 'none' : 'block';
    fundForm.reset();
    fundForm.dataset.id = '';
    document.getElementById('fundFormTitle').textContent = '➕ Add Super Fund';
    if (!isVisible) {
      fundFormSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  closeFundForm.addEventListener('click', () => {
    fundFormSection.style.display = 'none';
  });

  fundForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(fundForm);
    const fundData = {
      member: formData.get('member').trim(),
      fundName: formData.get('fundName').trim(),
      memberNumber: formData.get('memberNumber').trim(),
      investmentOption: formData.get('investmentOption').trim(),
      notes: formData.get('notes').trim()
    };

    if (fundForm.dataset.id) {
      fundData.id = fundForm.dataset.id;
      await updateItem(STORE_NAMES.superFunds, { ...funds.find(f => f.id === fundForm.dataset.id), ...fundData });
    } else {
      await addItem(STORE_NAMES.superFunds, fundData);
    }

    await initSuperannuationUI();
  });

  document.querySelectorAll('.btn-edit-fund').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fund = funds.find(f => f.id === btn.dataset.id);
      if (!fund) return;
      fundForm.dataset.id = fund.id;
      fundForm.member.value = fund.member || '';
      fundForm.fundName.value = fund.fundName || '';
      fundForm.memberNumber.value = fund.memberNumber || '';
      fundForm.investmentOption.value = fund.investmentOption || '';
      fundForm.notes.value = fund.notes || '';
      document.getElementById('fundFormTitle').textContent = '✏️ Edit Super Fund';
      fundFormSection.style.display = 'block';
      fundFormSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.querySelectorAll('.btn-delete-fund').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fund = funds.find(f => f.id === btn.dataset.id);
      if (!fund) return;
      if (!confirm(`Delete "${fund.fundName}"? This will also remove its balance history, contributions, and insurance records.`)) return;

      const relatedBalances = balanceHistory.filter(b => b.fundId === fund.id);
      const relatedContribs = contributions.filter(c => c.fundId === fund.id);
      const relatedPremiums = premiums.filter(p => p.fundId === fund.id);
      await Promise.all([
        ...relatedBalances.map(b => deleteItem(STORE_NAMES.superBalanceHistory, b.id)),
        ...relatedContribs.map(c => deleteItem(STORE_NAMES.superContributions, c.id)),
        ...relatedPremiums.map(p => deleteItem(STORE_NAMES.superPremiums, p.id)),
        deleteItem(STORE_NAMES.superFunds, fund.id)
      ]);

      await initSuperannuationUI();
    });
  });

  document.querySelectorAll('.btn-manage-fund').forEach(btn => {
    btn.addEventListener('click', () => {
      contribFYFilter = null; // reset to "current FY" default when opening a fund fresh
      initSuperannuationUI(btn.dataset.id);
    });
  });
}

// ============================================================================
// 🔍 Detail view — one fund's balance history, contributions, insurance
// ============================================================================
function renderFundDetailPage() {
  const fund = funds.find(f => f.id === selectedFundId);
  if (!fund) return renderFundListPage();

  const entries = balanceHistory.filter(b => b.fundId === fund.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const fundContribs = contributions.filter(c => c.fundId === fund.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const fundPremiums = premiums.filter(p => p.fundId === fund.id);
  const fundFees = fees.filter(f => f.fundId === fund.id);
  const latest = entries[0] || null;

  const fyOptions = Array.from(new Set(fundContribs.map(c => c.financialYear))).sort().reverse();
  const currentFY = getCurrentFinancialYear();
  if (!fyOptions.includes(currentFY)) fyOptions.unshift(currentFY);
  const activeFY = contribFYFilter || currentFY;
  const filteredContribs = fundContribs.filter(c => activeFY === 'all' || c.financialYear === activeFY);
  const fyTotal = filteredContribs.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const annualPremiumsTotal = fundPremiums.reduce((sum, p) => sum + annualisedPremium(p), 0);
  const annualFeesTotal = fundFees.reduce((sum, f) => sum + annualisedPremium(f), 0);

  return `
    <div class="page-container">
      <div class="page-header">
        <h2>💰 ${escapeHtml(fund.fundName)}</h2>
        <div class="page-actions">
          <button class="btn btn-secondary" id="btnBackToFunds">⬅️ Back to Super Funds</button>
        </div>
      </div>
      <p class="form-hint">${escapeHtml(fund.member)}${fund.memberNumber ? ` · Member #${escapeHtml(fund.memberNumber)}` : ''}${fund.investmentOption ? ` · ${escapeHtml(fund.investmentOption)}` : ''}</p>

      <div class="compact-summary-cards page-compact-cards">
        <div class="compact-card teal">
          <div class="compact-icon">💰</div>
          <div class="compact-content">
            <div class="compact-value">${latest ? formatCurrency(latest.balance) : '—'}</div>
            <div class="compact-label">${latest ? `Balance as of ${formatDate(latest.date)}` : 'No balance yet'}</div>
          </div>
        </div>
        <div class="compact-card blue">
          <div class="compact-icon">🏦</div>
          <div class="compact-content">
            <div class="compact-value">${formatCurrency(fyTotal)}</div>
            <div class="compact-label">Contributions ${activeFY === 'all' ? '(all years)' : escapeHtml(activeFY)}</div>
          </div>
        </div>
        <div class="compact-card orange">
          <div class="compact-icon">🛡️</div>
          <div class="compact-content">
            <div class="compact-value">${formatCurrency(annualPremiumsTotal)}</div>
            <div class="compact-label">Insurance (per year)</div>
          </div>
        </div>
      </div>

      <!-- Balance History -->
      <div class="section-card">
        <div class="transactions-header">
          <h3>📈 Balance History</h3>
        </div>
        <form id="balanceForm" class="styled-form">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Date</label>
              <input type="date" name="date" class="form-input" required value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label class="form-label">Balance</label>
              <input type="number" name="balance" class="form-input" step="0.01" placeholder="0.00" required>
            </div>
            <div class="form-group">
              <label class="form-label">Note</label>
              <input type="text" name="note" class="form-input" placeholder="Optional, e.g. from statement">
            </div>
            <div class="form-group">
              <button class="btn btn-primary" type="submit">➕ Add Entry</button>
            </div>
          </div>
        </form>

        ${entries.length ? '<div class="chart-container" style="margin: 1rem 0;"><canvas id="superBalanceChartCanvas"></canvas></div>' : ''}

        <div class="table-responsive">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Balance</th><th>Note</th><th></th></tr></thead>
          <tbody>
            ${entries.length ? entries.map(entry => `
              <tr>
                <td>${formatDate(entry.date)}</td>
                <td>${formatCurrency(entry.balance)}</td>
                <td>${escapeHtml(entry.note || '')}</td>
                <td><button class="btn btn-text btn-delete-balance" data-id="${entry.id}" title="Delete">🗑️</button></td>
              </tr>
            `).join('') : `<tr><td colspan="4" class="text-center">No balance entries yet — add one above whenever you check a statement.</td></tr>`}
          </tbody>
        </table>
        </div>
      </div>

      <!-- Contributions -->
      <div class="section-card">
        <div class="transactions-header">
          <h3>🏦 Contributions</h3>
          <div class="transactions-controls">
            <select id="contribFYSelect" class="form-select">
              ${fyOptions.map(fy => `<option value="${fy}" ${fy === activeFY ? 'selected' : ''}>${fy}</option>`).join('')}
              <option value="all" ${activeFY === 'all' ? 'selected' : ''}>All Years</option>
            </select>
          </div>
        </div>
        <form id="contribForm" class="styled-form">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Date</label>
              <input type="date" name="date" class="form-input" required value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label class="form-label">Type</label>
              <select name="type" class="form-select" required>
                <option value="employer">🏢 Employer</option>
                <option value="salary-sacrifice">💼 Salary Sacrifice</option>
                <option value="personal">👤 Personal</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Amount</label>
              <input type="number" name="amount" class="form-input" step="0.01" placeholder="0.00" required>
            </div>
            <div class="form-group">
              <label class="form-label">Note</label>
              <input type="text" name="note" class="form-input" placeholder="Optional">
            </div>
            <div class="form-group">
              <button class="btn btn-primary" type="submit">➕ Add Contribution</button>
            </div>
          </div>
        </form>

        <div class="table-responsive">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>
            ${filteredContribs.length ? filteredContribs.map(c => `
              <tr>
                <td>${formatDate(c.date)}</td>
                <td>${contributionTypeLabel(c.type)}</td>
                <td>${formatCurrency(c.amount)}</td>
                <td>${escapeHtml(c.note || '')}</td>
                <td><button class="btn btn-text btn-delete-contrib" data-id="${c.id}" title="Delete">🗑️</button></td>
              </tr>
            `).join('') : `<tr><td colspan="5" class="text-center">No contributions logged for this period yet.</td></tr>`}
          </tbody>
          ${filteredContribs.length ? `<tfoot><tr><td colspan="2"><strong>Total</strong></td><td><strong>${formatCurrency(fyTotal)}</strong></td><td colspan="2"></td></tr></tfoot>` : ''}
        </table>
        </div>
      </div>

      <!-- Recurring Contributions -->
      ${renderRecurringContribSection(fund)}

      <!-- Insurance Premiums -->
      ${renderDeductionSection({
        fund,
        title: '🛡️ Insurance Premiums',
        formId: 'premiumForm',
        addLabel: '➕ Add Premium',
        typeOptions: [
          { value: 'life', label: '🛡️ Life' },
          { value: 'tpd', label: '🛡️ TPD' },
          { value: 'income_protection', label: '🛡️ Income Protection' },
          { value: 'other', label: '🛡️ Other' }
        ],
        items: fundPremiums,
        typeLabelFn: premiumTypeLabel,
        annualTotal: annualPremiumsTotal,
        toggleClass: 'btn-toggle-premium',
        deleteClass: 'btn-delete-premium',
        emptyText: 'No insurance premiums recorded for this fund.',
        hint: 'Each premium now deducts from this fund\'s balance on schedule, the same way recurring contributions add to it — see Balance History for the auto-generated entries.'
      })}

      <!-- Fees -->
      ${renderDeductionSection({
        fund,
        title: '🧾 Fees',
        formId: 'feeForm',
        addLabel: '➕ Add Fee',
        typeOptions: [
          { value: 'admin', label: '🧾 Administration' },
          { value: 'investment', label: '📈 Investment' },
          { value: 'other', label: '🧾 Other' }
        ],
        items: fundFees,
        typeLabelFn: feeTypeLabel,
        annualTotal: annualFeesTotal,
        toggleClass: 'btn-toggle-fee',
        deleteClass: 'btn-delete-fee',
        emptyText: 'No fees recorded for this fund.',
        hint: 'Admin/investment fees deduct from this fund\'s balance on schedule, same as premiums.'
      })}
    </div>
  `;
}

// Auto-pay balance simulation: schedules that, on each due date, compound
// the fund's latest balance at an assumed growth rate and add the
// contribution amount — see superRecurringJob.js for the processing engine.
function renderRecurringContribSection(fund) {
  const schedules = recurringContribs
    .filter(r => r.fundId === fund.id)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  return `
    <div class="section-card">
      <div class="transactions-header">
        <h3>🔁 Recurring Contributions <span class="form-hint">(auto-pay balance simulation)</span></h3>
        <div class="transactions-controls">
          <button class="btn btn-secondary" id="btnRunSuperCatchUp">▶️ Run Catch-up Now</button>
        </div>
      </div>
      <p class="form-hint">
        Set up a recurring contribution to simulate this fund growing over time without manually
        entering every statement. Each time it's due, it adds the contribution amount to the
        fund's most recent balance and — if you set a growth rate — compounds that balance
        forward at that annual rate first. This writes real Balance History and Contribution
        entries below, tagged as auto-generated.
      </p>
      <form id="superRecurringForm" class="styled-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Type</label>
            <select name="type" class="form-select" required>
              <option value="employer">🏢 Employer</option>
              <option value="salary-sacrifice">💼 Salary Sacrifice</option>
              <option value="personal">👤 Personal</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Amount</label>
            <input type="number" name="amount" class="form-input" step="0.01" placeholder="0.00" required>
          </div>
          <div class="form-group">
            <label class="form-label">Frequency</label>
            <select name="frequency" class="form-select" required>
              <option value="weekly">📅 Weekly</option>
              <option value="fortnightly">📆 Fortnightly</option>
              <option value="monthly" selected>🗓️ Monthly</option>
              <option value="quarterly">📊 Quarterly</option>
              <option value="halfyearly">🌗 Half-Yearly</option>
              <option value="annually">🎯 Annually</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date</label>
            <input type="date" name="startDate" class="form-input" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Assumed Growth Rate (% p.a., optional)</label>
            <input type="number" name="growthRatePercent" class="form-input" step="0.01" placeholder="e.g. 7.00">
          </div>
          <div class="form-group">
            <label class="form-label">Already recorded up to (optional)</label>
            <input type="date" name="catchUpFrom" class="form-input">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Note</label>
          <input type="text" name="note" class="form-input" placeholder="Optional">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" type="submit">➕ Add Recurring Contribution</button>
        </div>
      </form>

      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Type</th><th>Amount</th><th>Frequency</th><th>Growth</th><th>Next Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${schedules.length ? schedules.map(rec => `
            <tr>
              <td>${contributionTypeLabel(rec.type)}</td>
              <td>${formatCurrency(rec.amount)}</td>
              <td>${frequencyLabel(rec.frequency)}</td>
              <td>${rec.growthRatePercent ? `${rec.growthRatePercent}% p.a.` : '—'}</td>
              <td>${formatDate(nextDueDateFor(rec))}</td>
              <td>${rec.active === false ? '⏸️ Paused' : '▶️ Active'}</td>
              <td>
                <button class="btn btn-text btn-toggle-super-recurring" data-id="${rec.id}" title="${rec.active === false ? 'Resume' : 'Pause'}">${rec.active === false ? '▶️' : '⏸️'}</button>
                <button class="btn btn-text btn-delete-super-recurring" data-id="${rec.id}" title="Delete">🗑️</button>
              </td>
            </tr>
          `).join('') : `<tr><td colspan="7" class="text-center">No recurring contributions set up for this fund.</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
  `;
}

// Shared renderer for the Insurance Premiums and Fees sections — both are
// now deduction schedules (startDate/frequency/active) processed by
// superRecurringJob.js exactly like recurring contributions, just with the
// sign flipped, so they share one form/table layout.
function renderDeductionSection({ fund, title, formId, addLabel, typeOptions, items, typeLabelFn, annualTotal, toggleClass, deleteClass, emptyText, hint }) {
  const sorted = items.slice().sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return `
    <div class="section-card">
      <div class="transactions-header">
        <h3>${title}</h3>
      </div>
      <p class="form-hint">${hint}</p>
      <form id="${formId}" class="styled-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Type</label>
            <select name="type" class="form-select" required>
              ${typeOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Amount</label>
            <input type="number" name="amount" class="form-input" step="0.01" placeholder="0.00" required>
          </div>
          <div class="form-group">
            <label class="form-label">Frequency</label>
            <select name="frequency" class="form-select" required>
              <option value="annual">Annual</option>
              <option value="halfyearly">Half-Yearly</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly" selected>Monthly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date</label>
            <input type="date" name="startDate" class="form-input" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Already recorded up to (optional)</label>
            <input type="date" name="catchUpFrom" class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">Note</label>
            <input type="text" name="note" class="form-input" placeholder="Optional">
          </div>
        </div>
        <div class="form-group">
          <button class="btn btn-primary" type="submit">${addLabel}</button>
        </div>
      </form>

      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Type</th><th>Amount</th><th>Frequency</th><th>Per Year</th><th>Next Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${sorted.length ? sorted.map(item => `
            <tr>
              <td>${typeLabelFn(item.type)}</td>
              <td>${formatCurrency(item.amount)}</td>
              <td>${item.frequency}</td>
              <td>${formatCurrency(annualisedPremium(item))}</td>
              <td>${formatDate(nextDueDateFor(item))}</td>
              <td>${item.active === false ? '⏸️ Paused' : '▶️ Active'}</td>
              <td>
                <button class="btn btn-text ${toggleClass}" data-id="${item.id}" title="${item.active === false ? 'Resume' : 'Pause'}">${item.active === false ? '▶️' : '⏸️'}</button>
                <button class="btn btn-text ${deleteClass}" data-id="${item.id}" title="Delete">🗑️</button>
              </td>
            </tr>
          `).join('') : `<tr><td colspan="7" class="text-center">${emptyText}</td></tr>`}
        </tbody>
        ${sorted.length ? `<tfoot><tr><td><strong>Total</strong></td><td colspan="2"></td><td><strong>${formatCurrency(annualTotal)}</strong></td><td colspan="3"></td></tr></tfoot>` : ''}
      </table>
      </div>
    </div>
  `;
}

function renderBalanceChart() {
  const canvas = document.getElementById('superBalanceChartCanvas');
  if (!canvas) return;
  if (superChart) {
    superChart.destroy();
    superChart = null;
  }

  const entries = balanceHistory
    .filter(b => b.fundId === selectedFundId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!entries.length) return;

  superChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: entries.map(e => formatDate(e.date)),
      datasets: [{
        label: 'Balance',
        data: entries.map(e => e.balance),
        borderColor: '#3ddc97',
        backgroundColor: 'rgba(61,220,151,0.12)',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.25,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => formatCurrency(ctx.parsed.y) } }
      },
      scales: {
        y: { ticks: { callback: (v) => formatCurrency(v) } }
      }
    }
  });
}

function attachFundDetailListeners() {
  document.getElementById('btnBackToFunds').addEventListener('click', () => {
    selectedFundId = null;
    initSuperannuationUI();
  });

  // Balance History
  const balanceForm = document.getElementById('balanceForm');
  balanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(balanceForm);
    await addItem(STORE_NAMES.superBalanceHistory, {
      fundId: selectedFundId,
      date: formData.get('date'),
      balance: parseFloat(formData.get('balance')) || 0,
      note: formData.get('note').trim()
    });
    await initSuperannuationUI(selectedFundId);
  });

  document.querySelectorAll('.btn-delete-balance').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this balance entry?')) return;
      await deleteItem(STORE_NAMES.superBalanceHistory, btn.dataset.id);
      await initSuperannuationUI(selectedFundId);
    });
  });

  // Contributions
  const contribForm = document.getElementById('contribForm');
  contribForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(contribForm);
    const date = formData.get('date');
    await addItem(STORE_NAMES.superContributions, {
      fundId: selectedFundId,
      date,
      type: formData.get('type'),
      amount: parseFloat(formData.get('amount')) || 0,
      note: formData.get('note').trim(),
      financialYear: getFinancialYear(date)
    });
    await initSuperannuationUI(selectedFundId);
  });

  document.getElementById('contribFYSelect').addEventListener('change', (e) => {
    contribFYFilter = e.target.value;
    render();
  });

  document.querySelectorAll('.btn-delete-contrib').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this contribution?')) return;
      await deleteItem(STORE_NAMES.superContributions, btn.dataset.id);
      await initSuperannuationUI(selectedFundId);
    });
  });

  // Recurring Contributions (auto-pay balance simulation)
  const superRecurringForm = document.getElementById('superRecurringForm');
  superRecurringForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(superRecurringForm);
    await addItem(STORE_NAMES.superRecurring, {
      fundId: selectedFundId,
      type: formData.get('type'),
      amount: parseFloat(formData.get('amount')) || 0,
      frequency: formData.get('frequency'),
      startDate: formData.get('startDate'),
      growthRatePercent: formData.get('growthRatePercent') ? parseFloat(formData.get('growthRatePercent')) : null,
      catchUpFrom: formData.get('catchUpFrom') || null,
      note: formData.get('note').trim(),
      active: true,
      lastProcessed: null
    });
    // Run the job immediately so a schedule starting today (or catching up
    // from the past) reflects in the balance/contribution logs right away,
    // rather than waiting for the next app load.
    await processSuperRecurringContributions();
    await initSuperannuationUI(selectedFundId);
  });

  document.getElementById('btnRunSuperCatchUp')?.addEventListener('click', async (btn_e) => {
    const button = document.getElementById('btnRunSuperCatchUp');
    if (button) button.style.pointerEvents = 'none';
    const result = await processSuperRecurringContributions();
    if (button) button.style.pointerEvents = '';
    if (result.errors.length) {
      alert(`⚠️ Ran with ${result.errors.length} error(s):\n` + result.errors.join('\n'));
    }
    await initSuperannuationUI(selectedFundId);
  });

  document.querySelectorAll('.btn-toggle-super-recurring').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rec = recurringContribs.find(r => r.id === btn.dataset.id);
      if (!rec) return;
      rec.active = rec.active === false ? true : false;
      await updateItem(STORE_NAMES.superRecurring, rec);
      await initSuperannuationUI(selectedFundId);
    });
  });

  document.querySelectorAll('.btn-delete-super-recurring').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this recurring contribution? Past auto-generated balance/contribution entries it already created are kept.')) return;
      await deleteItem(STORE_NAMES.superRecurring, btn.dataset.id);
      await initSuperannuationUI(selectedFundId);
    });
  });

  // Insurance Premiums (deducts from balance on schedule — see superRecurringJob.js)
  const premiumForm = document.getElementById('premiumForm');
  premiumForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(premiumForm);
    await addItem(STORE_NAMES.superPremiums, {
      fundId: selectedFundId,
      type: formData.get('type'),
      amount: parseFloat(formData.get('amount')) || 0,
      frequency: formData.get('frequency'),
      startDate: formData.get('startDate'),
      catchUpFrom: formData.get('catchUpFrom') || null,
      note: formData.get('note').trim(),
      active: true,
      lastProcessed: null
    });
    await processSuperRecurringContributions();
    await initSuperannuationUI(selectedFundId);
  });

  document.querySelectorAll('.btn-toggle-premium').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = premiums.find(p => p.id === btn.dataset.id);
      if (!item) return;
      item.active = item.active === false ? true : false;
      await updateItem(STORE_NAMES.superPremiums, item);
      await initSuperannuationUI(selectedFundId);
    });
  });

  document.querySelectorAll('.btn-delete-premium').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this insurance premium? Past auto-generated balance entries it already created are kept.')) return;
      await deleteItem(STORE_NAMES.superPremiums, btn.dataset.id);
      await initSuperannuationUI(selectedFundId);
    });
  });

  // Fees (same deduction-schedule shape as premiums)
  const feeForm = document.getElementById('feeForm');
  feeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(feeForm);
    await addItem(STORE_NAMES.superFees, {
      fundId: selectedFundId,
      type: formData.get('type'),
      amount: parseFloat(formData.get('amount')) || 0,
      frequency: formData.get('frequency'),
      startDate: formData.get('startDate'),
      catchUpFrom: formData.get('catchUpFrom') || null,
      note: formData.get('note').trim(),
      active: true,
      lastProcessed: null
    });
    await processSuperRecurringContributions();
    await initSuperannuationUI(selectedFundId);
  });

  document.querySelectorAll('.btn-toggle-fee').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = fees.find(f => f.id === btn.dataset.id);
      if (!item) return;
      item.active = item.active === false ? true : false;
      await updateItem(STORE_NAMES.superFees, item);
      await initSuperannuationUI(selectedFundId);
    });
  });

  document.querySelectorAll('.btn-delete-fee').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this fee? Past auto-generated balance entries it already created are kept.')) return;
      await deleteItem(STORE_NAMES.superFees, btn.dataset.id);
      await initSuperannuationUI(selectedFundId);
    });
  });
}
