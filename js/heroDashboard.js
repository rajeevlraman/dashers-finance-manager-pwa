// heroDashboard.js
//
// An alternate, opt-in layout for the top of the Dashboard page.
// Top row: Net (this month), Credit Card, Budget pulse, Make a note.
// Bottom row: a category-tinted recent-activity list, and the full
// tabbed Bill Reminders card (same one Quick Look shows, reused here
// via renderQLBillRow from quickLook.js).
//
// This is a *layout and typography* upgrade only, ported from a design
// mockup a person shared (a separate React prototype with fake seed
// data) — every figure rendered here comes from this app's real
// transactions/budgets/bills, computed by dashboard.js's own
// initDashboardUI() and passed in. Nothing here talks to a network or
// invents data.
//
// Toggled on/off via the "✨ New look" / "↩ Classic view" button in the
// dashboard toolbar (see dashboard.js) — state persists in localStorage
// so it survives reloads, same pattern as the Quick Look collapse state.

import { escapeHtml } from './sanitize.js';
import { convertAmount } from './budgets.js';
import { renderQLBillRow } from './quickLook.js';

import { currencySymbol } from './utils/currency.js';
const HERO_MODE_KEY = 'dfm_dashboard_hero_mode';

// Which Bill Reminders tab is showing in this card. Kept separate from
// quickLook.js's own `selectedBillTab` (even though both cards can be on
// screen together while Quick Look is still around) so switching one
// doesn't jump the other.
let heroBillTab = null;

// A small fixed palette used purely to tint each category's activity-row
// icon consistently (categories in this app carry an emoji `icon`, not a
// stored color) — same hash-a-string-to-a-palette-slot approach already
// used by generateColorPalette() elsewhere in dashboard.js, just applied
// per-category instead of per-chart-series.
const ICON_PALETTE = ['#2f5943', '#c9a227', '#1b7a4d', '#3b6d99', '#8a4f9e', '#b3261e', '#2f6f6f', '#a15c1f'];

export function isHeroModeOn() {
  return localStorage.getItem(HERO_MODE_KEY) === '1';
}

export function setHeroMode(on) {
  localStorage.setItem(HERO_MODE_KEY, on ? '1' : '0');
}

function money(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  return `${sign}${currencySymbol()}${Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function hashColor(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[h % ICON_PALETTE.length];
}

// Total spend vs total (monthly-normalized) budget across every
// *expense* budget for the selected month — deliberately excludes
// income-style budgets (e.g. a Salary target), which measure "did I earn
// enough" rather than spending pressure and don't belong in the same bar.
// Mirrors the matching logic calculateBudgetPerformance() already uses
// (exact category OR one of its subcategories) so this never disagrees
// with the rest of the dashboard about which transactions count.
function computeBudgetPulse(budgets, transactions, currentMonth, categories) {
  if (!budgets || !budgets.length) return null;
  let spentTotal = 0;
  let goalTotal = 0;
  budgets.forEach(budget => {
    const budgetCat = categories.find(c => c.id === budget.categoryId);
    if (budgetCat?.type === 'income') return;
    const spent = Math.abs(transactions
      .filter(t => {
        if (t.type !== 'expense' || !t.date?.startsWith(currentMonth)) return false;
        if (t.categoryId === budget.categoryId) return true;
        const txCat = categories.find(c => c.id === t.categoryId);
        return !!(txCat && txCat.parentId === budget.categoryId);
      })
      .reduce((sum, t) => sum + t.amount, 0));
    spentTotal += spent;
    goalTotal += convertAmount(budget.amount || 0, budget.frequency || 'monthly', 'monthly');
  });
  if (goalTotal <= 0) return null;
  return { spentTotal, goalTotal, pct: (spentTotal / goalTotal) * 100 };
}

// Scoped to the selected month (currentMonth), not just "whatever's most
// recent overall" — otherwise this list never visibly changes when the
// month prev/next controls are used, which is exactly what made the hero
// dashboard look like the month selector wasn't doing anything.
function renderActivityRows(transactions, categories, currentMonth) {
  const monthTx = (transactions || []).filter(t => t.date?.startsWith(currentMonth));
  const rows = monthTx
    .filter(t => !t.isTransfer)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(t => {
      const cat = categories.find(c => c.id === t.categoryId);
      const color = hashColor(t.categoryId || 'none');
      const icon = cat?.icon || (t.type === 'income' ? '💹' : '💸');
      return `
        <div class="hero-activity-row">
          <span class="hero-activity-icon" style="background:${color}2e;color:${color}">${icon}</span>
          <div class="hero-activity-mid">
            <span class="hero-activity-desc">${escapeHtml(t.description || (t.type === 'income' ? 'Income' : 'Expense'))}</span>
            <span class="hero-activity-date">${new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${escapeHtml(cat?.name || 'Uncategorised')}</span>
          </div>
          <span class="hero-activity-amount ${t.amount >= 0 ? 'positive' : ''}">${t.amount >= 0 ? '+' : '-'}${money(Math.abs(t.amount))}</span>
        </div>`;
    }).join('');
  return rows || '<div class="hero-empty">No transactions this period.</div>';
}

export function renderHeroSection({
  transactions, categories, budgets, bills, currentMonth,
  currentMonthIncome, currentMonthExpenses, currentMonthBalance,
  totalNetWorth, overBudgetCount, selectedMonthLabel, isCurrentCalendarMonth,
  totalCreditOwed, totalCreditLimit, totalCreditAvailable, creditUtilizationPct, creditCardCount
}) {
  const expensesAbs = Math.abs(currentMonthExpenses);
  const pulse = computeBudgetPulse(budgets, transactions, currentMonth, categories);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Full Bill Reminders card (same tabbed overdue/upcoming/paid view as
  // Quick Look's Card B, reusing its row renderer) — replaces the old
  // "Bills on your radar" single-number metric card now that this view
  // shows the actual list, not just a count.
  const todayStr = today.toISOString().split('T')[0];
  const categoryById = new Map((categories || []).map(c => [c.id, c]));
  const allOverdueBills = (bills || []).filter(b => !b.paid && b.dueDate < todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const allUpcomingBills = (bills || []).filter(b => !b.paid && b.dueDate >= todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const allPaidBills = (bills || []).filter(b => b.paid).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  if (heroBillTab === null) {
    heroBillTab = allOverdueBills.length > 0 ? 'overdue' : (allUpcomingBills.length > 0 ? 'upcoming' : 'paid');
  }

  const billsCardHtml = `
    <div class="fo-card hero-bills-card">
      <div class="fo-card-header-row">
        <span class="fo-card-title">📋 Bill Reminders</span>
        <div class="fo-tabgroup" id="heroBillTabs" data-bill-scope="hero">
          <button class="fo-tab ${heroBillTab === 'overdue' ? 'active' : ''}" data-bill-tab="overdue">Overdue (${allOverdueBills.length})</button>
          <button class="fo-tab ${heroBillTab === 'upcoming' ? 'active' : ''}" data-bill-tab="upcoming">Upcoming (${allUpcomingBills.length})</button>
          <button class="fo-tab ${heroBillTab === 'paid' ? 'active' : ''}" data-bill-tab="paid">Paid (${allPaidBills.length})</button>
        </div>
      </div>
      <div class="ql-bill-panel" data-bill-scope="hero" data-bill-panel="overdue" style="display:${heroBillTab === 'overdue' ? '' : 'none'}">
        ${allOverdueBills.length === 0 ? `<div class="fo-empty-note">Nothing overdue.</div>` : allOverdueBills.map(b => renderQLBillRow(b, categoryById, 'overdue')).join('')}
      </div>
      <div class="ql-bill-panel" data-bill-scope="hero" data-bill-panel="upcoming" style="display:${heroBillTab === 'upcoming' ? '' : 'none'}">
        ${allUpcomingBills.length === 0 ? `<div class="fo-empty-note">Nothing upcoming.</div>` : allUpcomingBills.map(b => renderQLBillRow(b, categoryById, 'upcoming')).join('')}
      </div>
      <div class="ql-bill-panel" data-bill-scope="hero" data-bill-panel="paid" style="display:${heroBillTab === 'paid' ? '' : 'none'}">
        ${allPaidBills.length === 0 ? `<div class="fo-empty-note">No paid bills yet.</div>` : allPaidBills.map(b => renderQLBillRow(b, categoryById, 'paid')).join('')}
      </div>
    </div>
  `;

  return `
    <div class="hero-dashboard">
      <div class="hero-top-grid">
        <div class="hero-net-card">
          <div class="hero-net-ring hero-net-ring-1" aria-hidden="true"></div>
          <div class="hero-net-ring hero-net-ring-2" aria-hidden="true"></div>
          <div class="hero-net-body">
            <div class="hero-net-top">
              <div class="hero-net-month-nav" onclick="event.stopPropagation()">
                <button type="button" id="heroMonthPrevBtn" class="hero-month-nav-btn" title="Previous month">‹</button>
                <span class="hero-net-label">Net · ${isCurrentCalendarMonth ? 'this month' : escapeHtml(selectedMonthLabel)}</span>
                <button type="button" id="heroMonthNextBtn" class="hero-month-nav-btn" title="Next month" ${isCurrentCalendarMonth ? 'disabled' : ''}>›</button>
                ${!isCurrentCalendarMonth ? '<button type="button" id="heroMonthTodayBtn" class="hero-month-nav-btn hero-month-today">Today</button>' : ''}
              </div>
              <span class="hero-status-pill ${overBudgetCount > 0 ? 'over' : ''}">${overBudgetCount > 0 ? `${overBudgetCount} OVER BUDGET` : 'ON TRACK'}</span>
            </div>
            <p class="hero-net-figure ${currentMonthBalance < 0 ? 'negative' : ''}">${money(currentMonthBalance)}</p>
            <p class="hero-net-sub">after ${money(expensesAbs)} in expenses</p>
            <div class="hero-net-footer">
              <div><span>Income</span><strong>${money(currentMonthIncome)}</strong></div>
              <div><span>Net worth</span><strong>${money(totalNetWorth)}</strong></div>
            </div>
          </div>
        </div>

        <!-- Credit Card — a duplicate of the Net card above (same shell:
             gold rings, gradient, label/pill row, big figure, sub-caption,
             two-stat footer), with credit card figures in place of the
             cash-flow ones. Uses the accounts' live balances (see
             dashboard.js), not the selected month above, since a credit
             balance is a running total rather than something that resets
             each month the way income/expenses do. Omitted entirely when
             there's no credit account yet, rather than showing an
             all-zeros card. -->
        ${creditCardCount > 0 ? `
        <div class="hero-net-card hero-credit-card">
          <div class="hero-net-ring hero-net-ring-1" aria-hidden="true"></div>
          <div class="hero-net-ring hero-net-ring-2" aria-hidden="true"></div>
          <div class="hero-net-body">
            <div class="hero-net-top">
              <span class="hero-net-label">Credit Card${creditCardCount > 1 ? ` · ${creditCardCount} cards` : ''}</span>
              <span class="hero-status-pill ${creditUtilizationPct >= 90 ? 'over' : ''}">${Math.round(creditUtilizationPct)}% UTILIZED</span>
            </div>
            <p class="hero-net-figure ${totalCreditOwed > 0 ? 'negative' : ''}">${money(-totalCreditOwed)}</p>
            <p class="hero-net-sub">owed of ${money(totalCreditLimit)} limit</p>
            <div class="hero-net-footer">
              <div><span>Available</span><strong>${money(totalCreditAvailable)}</strong></div>
              <div><span>Limit</span><strong>${money(totalCreditLimit)}</strong></div>
            </div>
          </div>
        </div>
        ` : ''}

        <div class="hero-metric-card">
          <div class="hero-metric-top"><span class="hero-metric-label">Budget pulse</span><span class="hero-metric-icon">🎯</span></div>
          <p class="hero-metric-value">${pulse ? Math.round(pulse.pct) + '%' : '—'}</p>
          <p class="hero-metric-note">${pulse ? `${money(Math.max(0, pulse.goalTotal - pulse.spentTotal))} left this month` : 'No budgets set yet'}</p>
          ${pulse ? `<div class="hero-metric-bar-track"><div class="hero-metric-bar-fill ${pulse.pct >= 100 ? 'over' : ''}" style="width:${Math.min(100, pulse.pct)}%"></div></div>` : ''}
        </div>

        <!-- "Make a note" — moved up from the bottom row into this row's
             4th slot, in place of the old "Bills on your radar" count
             (which just duplicated, in one number, what the full Bill
             Reminders card below now shows in full). -->
        <div class="hero-quickadd-card">
          <div class="hero-card-heading"><h3>Make a note</h3></div>
          <div class="hero-quickadd-grid">
            <button type="button" class="hero-quickadd-btn" data-hero-quickadd="expense">💸 Expense</button>
            <button type="button" class="hero-quickadd-btn" data-hero-quickadd="income">💹 Income</button>
          </div>
          <a href="#transactions" class="hero-import-btn">⬆ Import a statement</a>
        </div>
      </div>

      <div class="hero-bottom-grid">
        <div class="hero-activity-card">
          <div class="hero-card-heading"><h3>Recent activity</h3><a href="#transactions">See all ›</a></div>
          ${renderActivityRows(transactions, categories, currentMonth)}
        </div>
        ${billsCardHtml}
      </div>
    </div>
  `;
}

// Wires the quick-add grid to the same Add Transaction modal/form the
// dashboard toolbar button already opens (#addTxForm / #txType from
// transactions.js's shared renderTransactionFormHTML) — no separate form,
// just a shortcut that opens it pre-set to the right type.
export function attachHeroBehavior() {
  document.querySelectorAll('[data-hero-quickadd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-hero-quickadd');
      const addTxForm = document.getElementById('addTxForm');
      const txType = document.getElementById('txType');
      if (txType) {
        txType.value = type;
        txType.dispatchEvent(new Event('change'));
      }
      if (addTxForm) {
        addTxForm.style.display = 'block';
        document.body.classList.add('tx-modal-open');
        const box = addTxForm.querySelector('.tx-modal-box');
        if (box) box.scrollTop = 0;
      }
    });
  });

  // Bill Reminders tabs on the "New look" card — same show/hide pattern
  // as Quick Look's own bill tabs (js/quickLook.js), but scoped to this
  // card's own panels via data-bill-scope="hero" so it never touches
  // Quick Look's copy of the same tabs, and vice versa.
  const heroBillTabGroup = document.getElementById('heroBillTabs');
  if (heroBillTabGroup) {
    const billCard = heroBillTabGroup.closest('.fo-card') || document;
    heroBillTabGroup.querySelectorAll('.fo-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        heroBillTab = btn.dataset.billTab;
        heroBillTabGroup.querySelectorAll('.fo-tab').forEach(b => b.classList.toggle('active', b === btn));
        billCard.querySelectorAll('[data-bill-scope="hero"].ql-bill-panel').forEach(panel => {
          panel.style.display = panel.dataset.billPanel === heroBillTab ? '' : 'none';
        });
      });
    });
  }
}
