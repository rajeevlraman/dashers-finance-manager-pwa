// ============================================================================
// 🧮 loanWhatIf.js — "What-If" Payoff Modeler for the Loans page
// ============================================================================
// A standalone amortization/extra-payment modeler, separate from the
// per-loan "View Schedule" modal (which always reflects a saved loan
// exactly as recorded). This one is meant for experimenting: balance,
// rate, term, and extra payment are all plain editable inputs, optionally
// pre-filled from an existing loan account via the picker at the top, but
// never written back to that loan — it's purely "what if I paid $X more
// a month", not an edit to the real record.
//
// Calculation lives in loanCalculations.js (calculateWhatIf); this module
// is just the form, the summary cards, the Chart.js line chart, and the
// schedule table, plus the glue that recomputes and re-renders all three
// whenever an input changes.

import { calculateWhatIf } from './loanCalculations.js';
import { escapeHtml } from './sanitize.js';

import { currencySymbol, formatMoney } from './utils/currency.js';
let lwiChart = null; // Chart.js instance — destroyed/recreated on every recompute
let lwiShowAll = false; // table toggle: first 24 months vs the full schedule
let lwiLoans = []; // stashed by attachLoanWhatIfBehavior so the picker's change handler can look loans up without a re-render

function formatCurrency(amount, currency = 'AUD') {
  return formatMoney(amount, currency);
}

function compactMoney(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1000) return `${sign}${currencySymbol()}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
  return `${sign}${formatMoney(abs, undefined, { digits: 0 })}`;
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM, matches <input type="month">
}

function yearsLabel(months) {
  const yrs = months / 12;
  const yrsStr = Number.isInteger(yrs) ? String(yrs) : yrs.toFixed(1);
  return `${months} month${months === 1 ? '' : 's'} (${yrsStr} yrs)`;
}

// How many years are left on a saved loan, given its own term and start
// date — used to pre-fill "Term (Years)" with the REMAINING term rather
// than the loan's full original one, since that's what actually determines
// payoff time from today. Same elapsed-months approximation used elsewhere
// in this app (loanCalculations.js's getElapsedPeriods) — assumes payments
// happened on schedule.
function remainingYearsForLoan(loan) {
  const start = new Date(loan.startDate);
  const monthsElapsed = isNaN(start.getTime())
    ? 0
    : Math.max(0, (new Date().getFullYear() - start.getFullYear()) * 12 + (new Date().getMonth() - start.getMonth()));
  const remainingMonths = Math.max((loan.termMonths || 0) - monthsElapsed, 1);
  return Math.round((remainingMonths / 12) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

export function renderLoanWhatIfHTML(loans) {
  const defaultLoan = loans[0] || null;
  const defaultBalance = defaultLoan ? defaultLoan.currentBalance : 300000;
  const defaultRate = defaultLoan ? defaultLoan.interestRate : 6.5;
  const defaultTerm = defaultLoan ? remainingYearsForLoan(defaultLoan) : 30;
  const defaultName = defaultLoan ? defaultLoan.name : 'My Loan';

  return `
    <div class="section-card lwi-card" id="loanWhatIfSection">
      <div class="transactions-header">
        <h3>🧮 What-If Payoff Modeler</h3>
      </div>
      <p class="form-hint lwi-intro">Pick one of your loan accounts to pre-fill it below, or enter any loan by hand. Every field stays editable — model an extra monthly payment to see how much faster it's paid off and how much interest that saves.</p>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Loan Account</label>
          <select id="lwiLoanPicker" class="form-select">
            <option value="">— Custom / enter manually —</option>
            ${loans.map((l, i) => `<option value="${l.id}" ${defaultLoan && l.id === defaultLoan.id ? 'selected' : ''}>${l.icon || '🏦'} ${escapeHtml(l.name)}</option>`).join('')}
          </select>
          <small class="form-hint">Populates the fields below from a saved loan — they stay editable after.</small>
        </div>
      </div>

      <div class="lwi-controls-grid">
        <div class="form-group">
          <label class="form-label">Loan Name / Label</label>
          <input type="text" id="lwiName" class="form-input" value="${escapeHtml(defaultName)}">
        </div>
        <div class="form-group">
          <label class="form-label">Loan Balance (${currencySymbol()})</label>
          <input type="number" id="lwiBalance" class="form-input" step="0.01" min="0" value="${defaultBalance}">
        </div>
        <div class="form-group">
          <label class="form-label">Annual Interest Rate (%)</label>
          <input type="number" id="lwiRate" class="form-input" step="0.01" min="0" value="${defaultRate}">
        </div>
        <div class="form-group">
          <label class="form-label">Term (Years)</label>
          <input type="number" id="lwiTerm" class="form-input" step="0.1" min="0.1" value="${defaultTerm}">
        </div>
        <div class="form-group">
          <label class="form-label">Extra Monthly Payment (${currencySymbol()})</label>
          <input type="number" id="lwiExtra" class="form-input" step="10" min="0" value="0">
        </div>
        <div class="form-group">
          <label class="form-label">Start Month</label>
          <input type="month" id="lwiStartMonth" class="form-input" value="${currentMonthValue()}">
        </div>
      </div>

      <div class="schedule-summary-cards lwi-summary-cards" id="lwiSummaryCards"></div>
    </div>

    <div class="section-card lwi-card">
      <div class="transactions-header">
        <h3>📉 Principal vs Interest — Standard vs Extra Payment</h3>
      </div>
      <div class="chart-container lwi-chart-wrap">
        <canvas id="lwiChartCanvas"></canvas>
      </div>
    </div>

    <div class="section-card lwi-card">
      <div class="transactions-header">
        <h3>📋 Amortization Table</h3>
        <div class="transactions-controls">
          <div class="fo-tabgroup" id="lwiTableToggle">
            <button class="fo-tab ${!lwiShowAll ? 'active' : ''}" data-lwi-range="24">Show 24 Months</button>
            <button class="fo-tab ${lwiShowAll ? 'active' : ''}" data-lwi-range="all">Show All</button>
          </div>
        </div>
      </div>
      <div class="table-container lwi-table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Payment</th>
              <th>Principal</th>
              <th>Interest</th>
              <th>Balance</th>
              <th>Cumul. Interest</th>
            </tr>
          </thead>
          <tbody id="lwiTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Read inputs → recompute → re-render (summary cards, chart, table)
// ---------------------------------------------------------------------------

function readInputs() {
  const val = (id) => document.getElementById(id)?.value;
  return {
    name: val('lwiName') || 'My Loan',
    balance: parseFloat(val('lwiBalance')) || 0,
    annualRatePct: parseFloat(val('lwiRate')) || 0,
    termYears: parseFloat(val('lwiTerm')) || 0,
    extraMonthly: parseFloat(val('lwiExtra')) || 0,
    startDate: val('lwiStartMonth') ? `${val('lwiStartMonth')}-01` : new Date().toISOString().slice(0, 10)
  };
}

function renderSummaryCards(result) {
  const el = document.getElementById('lwiSummaryCards');
  if (!el) return;
  const cards = [
    { label: 'Monthly Payment', value: formatCurrency(result.monthlyPayment), variant: '' },
    { label: 'Total With Extra Payment', value: formatCurrency(result.effectivePayment), variant: 'success' },
    { label: 'Payoff (Standard)', value: yearsLabel(result.payoffMonthsStandard), variant: '' },
    { label: 'Payoff (With Extra)', value: yearsLabel(result.payoffMonthsExtra), variant: 'success' },
    { label: 'Total Interest (Standard)', value: formatCurrency(result.totalInterestStandard), variant: 'expense' },
    { label: 'Total Interest (With Extra)', value: formatCurrency(result.totalInterestExtra), variant: 'success' },
    { label: 'Interest Saved', value: formatCurrency(result.interestSaved), variant: 'warning' },
    { label: 'Months Saved', value: `${result.monthsSaved} months`, variant: 'warning' }
  ];
  el.innerHTML = cards.map(c => `
    <div class="summary-card ${c.variant}">
      <span class="summary-label">${c.label}</span>
      <span class="summary-value">${c.value}</span>
    </div>
  `).join('');
}

function renderChart(result) {
  const canvas = document.getElementById('lwiChartCanvas');
  if (!canvas) return;
  if (lwiChart) {
    lwiChart.destroy();
    lwiChart = null;
  }

  const maxLen = result.standardSchedule.length;
  const labels = ['Mo 0', ...Array.from({ length: maxLen }, (_, i) => `Mo ${i + 1}`)];
  const standardBalances = [result.balance, ...result.standardSchedule.map(p => p.balance)];
  const extraBalances = [
    result.balance,
    ...Array.from({ length: maxLen }, (_, i) => (result.extraSchedule[i] ? result.extraSchedule[i].balance : 0))
  ];

  lwiChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Standard Balance',
          data: standardBalances,
          borderColor: '#ff6b7a',
          backgroundColor: 'rgba(255,107,122,0.12)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: true
        },
        {
          label: 'With Extra Payment',
          data: extraBalances,
          borderColor: '#3ddc97',
          backgroundColor: 'rgba(61,220,151,0.12)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, autoSkip: true } },
        y: { ticks: { callback: (v) => compactMoney(v) } }
      }
    }
  });
}

function renderTable(result) {
  const body = document.getElementById('lwiTableBody');
  if (!body) return;
  const rows = lwiShowAll ? result.extraSchedule : result.extraSchedule.slice(0, 24);
  body.innerHTML = rows.length ? rows.map(p => `
    <tr>
      <td>${p.period}</td>
      <td>${p.date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td>
      <td>${formatCurrency(p.payment)}</td>
      <td>${formatCurrency(p.principal)}</td>
      <td>${formatCurrency(p.interest)}</td>
      <td>${formatCurrency(p.balance)}</td>
      <td>${formatCurrency(p.cumulativeInterest)}</td>
    </tr>
  `).join('') : `
    <tr><td colspan="7" class="text-center">Enter a loan balance, rate, and term above to see the schedule.</td></tr>
  `;
}

function recomputeAndRender() {
  const inputs = readInputs();
  const result = calculateWhatIf(inputs);
  renderSummaryCards(result);
  renderChart(result);
  renderTable(result);
}

// ---------------------------------------------------------------------------
// Loan picker: prefill fields from a saved loan account, still editable
// ---------------------------------------------------------------------------

function applyLoanToFields(loan) {
  const set = (id, value) => { const input = document.getElementById(id); if (input) input.value = value; };
  if (loan) {
    set('lwiName', loan.name || 'My Loan');
    set('lwiBalance', loan.currentBalance || 0);
    set('lwiRate', loan.interestRate || 0);
    set('lwiTerm', remainingYearsForLoan(loan));
  } else {
    set('lwiName', 'My Loan');
    set('lwiBalance', '');
    set('lwiRate', '');
    set('lwiTerm', '');
  }
  // Always reset the start month to "now" on a fresh pick — modeling
  // "what if I started this today", regardless of when the loan itself
  // actually began.
  set('lwiStartMonth', currentMonthValue());
}

export function attachLoanWhatIfBehavior(loans) {
  lwiLoans = loans;
  lwiShowAll = false;

  const picker = document.getElementById('lwiLoanPicker');
  if (picker) {
    picker.addEventListener('change', () => {
      const loan = lwiLoans.find(l => l.id === picker.value) || null;
      applyLoanToFields(loan);
      recomputeAndRender();
    });
  }

  ['lwiName', 'lwiBalance', 'lwiRate', 'lwiTerm', 'lwiExtra', 'lwiStartMonth'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', recomputeAndRender);
  });

  const toggle = document.getElementById('lwiTableToggle');
  if (toggle) {
    toggle.querySelectorAll('[data-lwi-range]').forEach(btn => {
      btn.addEventListener('click', () => {
        lwiShowAll = btn.dataset.lwiRange === 'all';
        toggle.querySelectorAll('[data-lwi-range]').forEach(b => b.classList.toggle('active', b === btn));
        recomputeAndRender();
      });
    });
  }

  recomputeAndRender();
}
