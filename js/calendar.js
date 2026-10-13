// calendar.js - ENHANCED VERSION v2
// Adds: account filter, per-transaction day pills, Month/Week view toggle,
// Monday-start weeks, and an account-specific analytics panel (monthly
// balance high/low, negative-balance days, budget vs actual, net surplus).
import { getAllItems, STORE_NAMES } from './db.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalanceAsOf } from './accountBalance.js';

import { formatMoney, recordCurrency, toBase, toBaseTransactions } from './utils/currency.js';
// Bug fix: a new document-level click listener used to be attached every time
// init() ran, stacking duplicate listeners. Now we attach exactly one and
// delegate to whichever instance is active.
let activeCalendarManager = null;
let calendarDelegatedListenerAttached = false;

function attachCalendarDelegatedListener() {
    if (calendarDelegatedListenerAttached) return;
    calendarDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        const dayCell = e.target.closest('.calendar-day');
        if (dayCell && activeCalendarManager) {
            activeCalendarManager.showDayDetails(dayCell.getAttribute('data-date'));
        }
    });
}

// Budgets store category → monthly amount, same conversion used by the
// Financial Dashboard, so "monthly" figures mean the same thing everywhere.
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

const MAX_VISIBLE_BILL_TAGS = 2;

export class CalendarManager {
    constructor() {
        const today = new Date();
        this.currentYear = today.getFullYear();
        this.currentMonth = today.getMonth();

        // Week view is tracked independently by the Monday of the visible
        // week, so switching Month <-> Week doesn't lose your place.
        this.currentWeekStart = this.mondayOf(today);

        this.viewMode = 'month'; // 'month' | 'week'
        this.selectedAccountId = ''; // '' = All accounts

        this.bills = [];
        this.transactions = [];
        this.accounts = [];
        this.categories = [];
        this.budgets = [];

        // Tracks which day (if any) the sidebar is currently showing details
        // for, so we know whether to fall back to the Month/Account Pulse
        // overview.
        this.selectedDate = null;
    }

    async init() {
        await this.loadData();
        this.renderUI(); // attaches its own listeners at the end — see renderUI()
    }

    async loadData() {
        [this.bills, this.transactions, this.accounts, this.categories, this.budgets] = await Promise.all([
            getAllItems(STORE_NAMES.bills).catch(() => []),
            getAllItems(STORE_NAMES.transactions).catch(() => []),
            getAllItems(STORE_NAMES.accounts).catch(() => []),
            getAllItems(STORE_NAMES.categories).catch(() => []),
            getAllItems(STORE_NAMES.budgets).catch(() => [])
        ]);
    }

    // ------------------------------------------------------------------
    // Date helpers — weeks start Monday throughout (grid header, weekend
    // shading, and the week view all agree on the same 0=Mon..6=Sun index).
    // ------------------------------------------------------------------
    mondayIndex(date) {
        return (date.getDay() + 6) % 7; // 0=Mon, 1=Tue, ..., 6=Sun
    }

    mondayOf(date) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        d.setDate(d.getDate() - this.mondayIndex(d));
        return d;
    }

    toDateStr(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // ------------------------------------------------------------------
    // Account filtering — applied everywhere data is read for rendering.
    // ------------------------------------------------------------------
    getFilteredTransactions() {
        if (!this.selectedAccountId) return this.transactions;
        return this.transactions.filter(t => t.accountId === this.selectedAccountId);
    }

    getFilteredBills() {
        if (!this.selectedAccountId) return this.bills;
        return this.bills.filter(b => b.accountId === this.selectedAccountId);
    }

    getSelectedAccount() {
        return this.accounts.find(a => a.id === this.selectedAccountId) || null;
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');

        mainContent.innerHTML = `
            <div class="calendar-container">
                <div class="calendar-header">
                    <h2>📅 Financial Calendar</h2>
                    <div class="calendar-controls">
                        <button class="btn btn-secondary" id="prevPeriod">⬅️<span class="btn-label"> Previous</span></button>
                        <div class="calendar-title" id="calendarTitle"></div>
                        <button class="btn btn-secondary" id="nextPeriod"><span class="btn-label">Next </span>➡️</button>
                        <button class="btn btn-primary" id="todayBtn">Today</button>
                    </div>
                </div>

                <div class="calendar-filter-bar">
                    <div class="calendar-filter-group">
                        <label for="calendarAccountFilter">Account</label>
                        <select id="calendarAccountFilter" class="calendar-filter-select">
                            <option value="">All Accounts</option>
                            ${this.accounts.map(a => `<option value="${a.id}" ${a.id === this.selectedAccountId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="view-toggle" role="group" aria-label="Calendar view">
                        <button type="button" class="view-toggle-btn ${this.viewMode === 'month' ? 'active' : ''}" data-view="month">Month</button>
                        <button type="button" class="view-toggle-btn ${this.viewMode === 'week' ? 'active' : ''}" data-view="week">Week</button>
                    </div>
                </div>

                <div class="calendar-stats page-compact-cards">
                    <div class="stat-card">
                        <div class="stat-icon">💰</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.getMonthlyBillTotal()}</div>
                            <div class="stat-label">This Month's Bills</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">⏰</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.getUpcomingBillsCount()}</div>
                            <div class="stat-label">Upcoming Bills</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">🚨</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.getOverdueBillsCount()}</div>
                            <div class="stat-label">Overdue</div>
                        </div>
                    </div>
                </div>

                <div class="calendar-legend">
                    <div class="legend-item">
                        <span class="legend-color today"></span>
                        <span>Today</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color due"></span>
                        <span>Bills Due</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color overdue"></span>
                        <span>Overdue</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color paid"></span>
                        <span>Paid</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color income"></span>
                        <span>Income</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color expense"></span>
                        <span>Expense</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color transaction"></span>
                        <span>Transfer</span>
                    </div>
                </div>

                <div class="calendar-wrapper">
                    <table class="calendar-table">
                        <thead id="calendarHead"></thead>
                        <tbody id="calendarBody"></tbody>
                    </table>
                </div>

                <div class="calendar-sidebar" id="dayDetails"></div>
            </div>
        `;

        this.renderCalendar();
        this.renderPulse();

        // renderUI() just replaced the whole subtree via innerHTML above,
        // which wipes out any listeners bound to the old select/toggle/nav
        // buttons — re-attach fresh ones to the new DOM every time this
        // runs (attachEventListeners() itself is safe to call repeatedly;
        // see its own comment).
        this.attachEventListeners();
    }

    // ------------------------------------------------------------------
    // Grid rendering — dispatches to month or week layout. Both share the
    // same Monday-start header and the same per-day cell markup, so a click
    // handler and CSS only need to know about ".calendar-day".
    // ------------------------------------------------------------------
    renderCalendar() {
        const header = document.getElementById('calendarHead');
        header.innerHTML = `
            <tr>
                <th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th>
                <th>Fri</th><th>Sat</th><th>Sun</th>
            </tr>
        `;

        if (this.viewMode === 'week') {
            this.renderWeekGrid();
        } else {
            this.renderMonthGrid();
        }
    }

    renderMonthGrid() {
        const firstOfMonth = new Date(this.currentYear, this.currentMonth, 1);
        const lastOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0);
        const daysInMonth = lastOfMonth.getDate();
        const startIndex = this.mondayIndex(firstOfMonth); // 0=Mon..6=Sun

        document.getElementById('calendarTitle').textContent =
            `${firstOfMonth.toLocaleString('default', { month: 'long' })} ${this.currentYear}`;

        const body = document.getElementById('calendarBody');
        let html = '<tr>';

        for (let i = 0; i < startIndex; i++) {
            html += `<td class="empty"></td>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const weekday = (startIndex + day - 1) % 7;
            html += this.buildDayCellHtml(dateStr, day, weekday);

            if ((startIndex + day) % 7 === 0 && day < daysInMonth) {
                html += '</tr><tr>';
            }
        }

        const totalCells = Math.ceil((startIndex + daysInMonth) / 7) * 7;
        const remainingCells = totalCells - (startIndex + daysInMonth);
        for (let i = 0; i < remainingCells; i++) {
            html += `<td class="empty"></td>`;
        }

        html += '</tr>';
        body.innerHTML = html;
    }

    renderWeekGrid() {
        const weekStart = this.currentWeekStart;
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
        const startLabel = weekStart.toLocaleDateString('default', { month: 'short', day: 'numeric' });
        const endLabel = weekEnd.toLocaleDateString('default', sameMonth
            ? { day: 'numeric', year: 'numeric' }
            : { month: 'short', day: 'numeric', year: 'numeric' });
        document.getElementById('calendarTitle').textContent = `${startLabel} – ${endLabel}`;

        const body = document.getElementById('calendarBody');
        let html = '<tr class="week-row">';

        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const dateStr = this.toDateStr(d);
            html += this.buildDayCellHtml(dateStr, d.getDate(), i, true);
        }

        html += '</tr>';
        body.innerHTML = html;
    }

    buildDayCellHtml(dateStr, dayNumber, weekday, isWeekCell = false) {
        const dayBills = this.getFilteredBills().filter(b => b.dueDate === dateStr);
        const dayTransactions = this.getFilteredTransactions().filter(t => t.date === dateStr);
        const today = new Date().toISOString().slice(0, 10);
        const classes = this.getDayClasses(dateStr, dayBills, dayTransactions, today, weekday);
        if (isWeekCell) classes.push('week-cell');

        return `
            <td class="${classes.join(' ')}" data-date="${dateStr}">
                <div class="date-number">${dayNumber}</div>
                ${this.renderDayIndicators(dayBills, dayTransactions)}
            </td>
        `;
    }

    getDayClasses(dateStr, dayBills, dayTransactions, today, weekday) {
        const classes = ['calendar-day'];

        // Monday-start weekend: index 5 = Sat, 6 = Sun.
        if (weekday === 5 || weekday === 6) {
            classes.push('weekend');
        }

        if (dateStr === today) {
            classes.push('today');
        }

        if (dayBills.length > 0) {
            const hasOverdue = dayBills.some(b => !b.paid && b.dueDate < today);
            const allPaid = dayBills.every(b => b.paid);

            if (hasOverdue) {
                classes.push('overdue');
            } else if (!allPaid) {
                classes.push('due');
            } else {
                classes.push('paid');
            }
        }

        if (dayTransactions.length > 0) {
            classes.push('has-transactions');
        }

        return classes;
    }

    // Renders the actual list of what happened that day: bill-due tags
    // (name + status color, no amount — a bill isn't money moved yet) and
    // one pill per transaction (name + signed amount, colored by type),
    // matching how a reference "financial calendar" app lays out each day box.
    renderDayIndicators(dayBills, dayTransactions) {
        let indicators = '';

        if (dayBills.length > 0) {
            const today = new Date().toISOString().slice(0, 10);
            const visibleBills = dayBills.slice(0, MAX_VISIBLE_BILL_TAGS);
            const overflowCount = dayBills.length - visibleBills.length;

            let tags = visibleBills.map(b => {
                const status = b.paid ? 'paid' : (b.dueDate < today ? 'overdue' : 'due');
                return `<span class="day-bill-tag status-${status}">${escapeHtml(b.name || 'Bill')}</span>`;
            }).join('');

            if (overflowCount > 0) {
                tags += `<span class="day-bill-tag more">+${overflowCount} more bill${overflowCount > 1 ? 's' : ''}</span>`;
            }

            indicators += `<div class="day-bills">${tags}</div>`;
        }

        if (dayTransactions.length > 0) {
            const income = toBaseTransactions(dayTransactions, this.accounts).filter(t => t.type === 'income' && !t.isTransfer).reduce((sum, t) => sum + t.amount, 0);
            const expenses = toBaseTransactions(dayTransactions, this.accounts).filter(t => t.type === 'expense' && !t.isTransfer).reduce((sum, t) => sum + Math.abs(t.amount), 0);
            // Transfers move this account's real balance (computeAccountBalanceAsOf
            // sums every transaction, transfers included) but were excluded from
            // income/expenses above to match the original day-box format — so
            // without this, a transfer-tagged transaction could shift the
            // balance shown in the sidebar with nothing to show for it here.
            // Net rather than gross: an inbound + outbound transfer on the same
            // day should show their combined effect on the balance, not double
            // count.
            const transferNet = toBaseTransactions(dayTransactions, this.accounts).filter(t => t.isTransfer).reduce((sum, t) => sum + t.amount, 0);

            indicators += `
                <div class="day-transactions">
                    ${income > 0 ? `<span class="income-indicator">+${this.formatCurrency(income)}</span>` : ''}
                    ${expenses > 0 ? `<span class="expense-indicator">-${this.formatCurrency(expenses)}</span>` : ''}
                    ${transferNet !== 0 ? `<span class="transfer-indicator">⇄${transferNet > 0 ? '+' : '-'}${this.formatCurrency(Math.abs(transferNet))}</span>` : ''}
                </div>
            `;
        }

        return indicators;
    }

    attachEventListeners() {
        activeCalendarManager = this;
        attachCalendarDelegatedListener();

        // renderUI() rebuilds this whole subtree via innerHTML every time,
        // so listeners are re-attached fresh each render — no dedup guard
        // needed here (unlike the persistent document-level delegated
        // listener above).
        document.getElementById('prevPeriod')?.addEventListener('click', () => activeCalendarManager.navigate(-1));
        document.getElementById('nextPeriod')?.addEventListener('click', () => activeCalendarManager.navigate(1));

        document.getElementById('todayBtn')?.addEventListener('click', () => {
            const today = new Date();
            activeCalendarManager.currentYear = today.getFullYear();
            activeCalendarManager.currentMonth = today.getMonth();
            activeCalendarManager.currentWeekStart = activeCalendarManager.mondayOf(today);
            activeCalendarManager.selectedDate = null;
            activeCalendarManager.renderCalendar();
            activeCalendarManager.renderPulse();
        });

        document.getElementById('calendarAccountFilter')?.addEventListener('change', (e) => {
            activeCalendarManager.selectedAccountId = e.target.value;
            activeCalendarManager.selectedDate = null;
            // Stat cards and legend totals are account-scoped too, so the
            // whole page re-renders rather than just the grid.
            activeCalendarManager.renderUI();
        });

        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                if (view === activeCalendarManager.viewMode) return;
                activeCalendarManager.viewMode = view;
                if (view === 'week') {
                    activeCalendarManager.currentWeekStart = activeCalendarManager.mondayOf(
                        new Date(activeCalendarManager.currentYear, activeCalendarManager.currentMonth, 1)
                    );
                }
                // renderUI() rebuilds the sidebar's markup from scratch below,
                // so a day selected before switching views must be cleared
                // here too — otherwise renderPulse() sees a stale
                // selectedDate, bails out, and the sidebar is left empty
                // with no close button and no way back to the Pulse.
                activeCalendarManager.selectedDate = null;
                activeCalendarManager.renderUI();
            });
        });
    }

    navigate(direction) {
        if (this.viewMode === 'week') {
            this.navigateWeek(direction);
        } else {
            this.navigateMonth(direction);
        }
    }

    navigateMonth(direction) {
        this.currentMonth += direction;

        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        } else if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }

        // Switching months clears whatever day was selected — the sidebar
        // falls back to the Pulse overview for the new month rather than
        // showing stale details for a day that's no longer visible.
        this.selectedDate = null;
        this.renderCalendar();
        this.renderPulse();
    }

    navigateWeek(direction) {
        this.currentWeekStart.setDate(this.currentWeekStart.getDate() + direction * 7);
        // Keep month/year in sync with the visible week's Monday, so
        // month-scoped sidebar stats (bills this month, budget vs actual)
        // stay meaningful without a separate "which month is the sidebar
        // showing" concept.
        this.currentYear = this.currentWeekStart.getFullYear();
        this.currentMonth = this.currentWeekStart.getMonth();

        this.selectedDate = null;
        this.renderCalendar();
        this.renderPulse();
    }

    // ------------------------------------------------------------------
    // Sidebar — Month/Account Pulse (no day selected) or day drill-down.
    // ------------------------------------------------------------------
    renderPulse() {
        if (this.selectedDate) return; // a day is selected; leave its details in place
        if (this.selectedAccountId) {
            this.renderAccountPulse();
        } else {
            this.renderMonthPulse();
        }
    }

    renderMonthPulse() {
        const sidebar = document.getElementById('dayDetails');
        if (!sidebar) return;

        const monthStart = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-01`;
        const lastOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const monthEnd = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(lastOfMonth).padStart(2, '0')}`;
        const today = new Date().toISOString().slice(0, 10);

        const bills = this.getFilteredBills();
        const transactions = this.getFilteredTransactions();

        const monthBills = bills.filter(b => b.dueDate >= monthStart && b.dueDate <= monthEnd);
        const monthTransactions = transactions.filter(t => t.date >= monthStart && t.date <= monthEnd);

        const incomeDays = new Set(
            monthTransactions.filter(t => t.type === 'income' && !t.isTransfer).map(t => t.date)
        ).size;

        const activeDays = new Set([
            ...monthBills.map(b => b.dueDate),
            ...monthTransactions.map(t => t.date)
        ]).size;

        const nextBill = bills
            .filter(b => !b.paid && b.dueDate >= today)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

        const monthLabel = new Date(this.currentYear, this.currentMonth, 1)
            .toLocaleString('default', { month: 'long' });

        sidebar.innerHTML = `
            <div class="sidebar-header">
                <h3>${escapeHtml(monthLabel)} Pulse</h3>
            </div>
            <div class="sidebar-content month-pulse">
                <div class="pulse-stat">
                    <span class="pulse-icon">📥</span>
                    <span class="pulse-label">Income days</span>
                    <span class="pulse-value">${incomeDays}</span>
                </div>
                <div class="pulse-stat">
                    <span class="pulse-icon">📋</span>
                    <span class="pulse-label">Bills this month</span>
                    <span class="pulse-value">${monthBills.length}</span>
                </div>
                <div class="pulse-stat">
                    <span class="pulse-icon">🗓️</span>
                    <span class="pulse-label">Active days</span>
                    <span class="pulse-value">${activeDays}</span>
                </div>
                <div class="pulse-next">
                    ${nextBill
                        ? `<span class="pulse-next-label">Next bill</span>
                           <span class="pulse-next-detail">${escapeHtml(nextBill.name || 'Bill')} · ${new Date(nextBill.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${this.formatCurrency(nextBill.amount, recordCurrency(nextBill, this.accounts))}</span>`
                        : `<span class="pulse-next-label">No upcoming bills</span>`
                    }
                </div>
                <p class="pulse-hint">Pick an account above for balance &amp; budget tracking. Click any date for full details.</p>
            </div>
        `;
    }

    // Account Pulse: shown instead of Month Pulse once a specific account
    // is selected — a running balance only means something for one account
    // at a time, so this never tries to blend accounts together.
    renderAccountPulse() {
        const sidebar = document.getElementById('dayDetails');
        if (!sidebar) return;

        const account = this.getSelectedAccount();
        if (!account) { this.renderMonthPulse(); return; }

        const monthLabel = new Date(this.currentYear, this.currentMonth, 1)
            .toLocaleString('default', { month: 'long' });

        const balanceStats = this.computeMonthlyBalanceStats(account);
        const budgetStats = this.computeBudgetVsActual(account);

        const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        sidebar.innerHTML = `
            <div class="sidebar-header">
                <h3>${escapeHtml(account.name)}</h3>
            </div>
            <div class="sidebar-content account-pulse">
                <div class="pulse-section-label">${escapeHtml(monthLabel)} Balances</div>
                <div class="balance-row">
                    <span class="balance-label">High</span>
                    <span class="balance-value positive">${this.formatCurrency(balanceStats.high.value)}</span>
                    <span class="balance-date">${fmtDate(balanceStats.high.date)}</span>
                </div>
                <div class="balance-row">
                    <span class="balance-label">Low</span>
                    <span class="balance-value ${balanceStats.low.value < 0 ? 'negative' : ''}">${this.formatCurrency(balanceStats.low.value)}</span>
                    <span class="balance-date">${fmtDate(balanceStats.low.date)}</span>
                </div>

                <div class="pulse-section-label">Negative Balances</div>
                ${balanceStats.negativeDays.length === 0
                    ? `<p class="pulse-empty-note">None this month.</p>`
                    : `<ul class="negative-days-list">
                        ${balanceStats.negativeDays.slice(0, 5).map(nd => `
                            <li><span>${fmtDate(nd.date)}</span><span class="negative">${this.formatCurrency(nd.value)}</span></li>
                        `).join('')}
                        ${balanceStats.negativeDays.length > 5 ? `<li class="more-note">+${balanceStats.negativeDays.length - 5} more day(s)</li>` : ''}
                       </ul>`
                }

                <div class="pulse-section-label">When Did I Go Over Budget</div>
                ${budgetStats.overBudget.length === 0
                    ? `<p class="pulse-empty-note">No budgets exceeded this month.</p>`
                    : `<ul class="over-budget-list">
                        ${budgetStats.overBudget.map(b => `
                            <li>
                                <span class="over-budget-cat">${escapeHtml(b.icon || '')} ${escapeHtml(b.label)}</span>
                                <span class="over-budget-amount negative">${this.formatCurrency(b.actual - b.budgeted)}</span>
                            </li>
                        `).join('')}
                       </ul>`
                }

                <div class="pulse-section-label">Budget Surplus</div>
                ${budgetStats.surplusRows.length === 0
                    ? `<p class="pulse-empty-note">No budgets configured for this account's spending yet.</p>`
                    : `<ul class="surplus-list">
                        ${budgetStats.surplusRows.map(b => `
                            <li>
                                <span>${escapeHtml(b.icon || '')} ${escapeHtml(b.label)}</span>
                                <span class="${b.surplus >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(b.surplus)}</span>
                            </li>
                        `).join('')}
                       </ul>`
                }

                <div class="net-budget-surplus ${budgetStats.netSurplus >= 0 ? 'positive' : 'negative'}">
                    <span>Net Budget Surplus</span>
                    <span>${this.formatCurrency(budgetStats.netSurplus)}</span>
                </div>

                <p class="pulse-hint">Click any date for full details.</p>
            </div>
        `;
    }

    // High/low running balance for the currently-viewed month, plus every
    // day the balance dips below zero. Built on computeAccountBalanceAsOf,
    // the same "opening balance + transactions up to this date" logic the
    // Accounts page uses, so it always agrees with the real account balance.
    computeMonthlyBalanceStats(account) {
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const allTx = this.transactions; // balance must include ALL of the account's history, not just a filtered slice

        let high = { value: -Infinity, date: null };
        let low = { value: Infinity, date: null };
        const negativeDays = [];

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const balance = computeAccountBalanceAsOf(account, allTx, dateStr);

            if (balance > high.value) high = { value: balance, date: dateStr };
            if (balance < low.value) low = { value: balance, date: dateStr };
            if (balance < 0) negativeDays.push({ date: dateStr, value: balance });
        }

        if (high.date === null) high = { value: account.openingBalance || 0, date: `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-01` };
        if (low.date === null) low = high;

        return { high, low, negativeDays };
    }

    // Budget vs actual for this account's expense categories this month —
    // same monthlyAmount()/matching logic as the Financial Dashboard's
    // "Budget vs Actual" card, scoped down to one account and one month.
    computeBudgetVsActual(account) {
        const categoryById = new Map(this.categories.map(c => [c.id, c]));
        const monthStart = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-01`;
        const lastOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const monthEnd = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(lastOfMonth).padStart(2, '0')}`;

        const monthTx = this.transactions.filter(t =>
            t.accountId === account.id && !t.isTransfer && t.date >= monthStart && t.date <= monthEnd);

        const rows = this.budgets.map(b => {
            const cat = categoryById.get(b.categoryId);
            if (!cat || cat.type === 'income') return null;

            const budgeted = monthlyAmount(b.amount, b.frequency);
            const actual = Math.abs(toBaseTransactions(monthTx, this.accounts)
                .filter(t => t.type === 'expense' && (t.categoryId === b.categoryId || (categoryById.get(t.categoryId) || {}).parentId === b.categoryId))
                .reduce((sum, t) => sum + t.amount, 0));

            return { label: cat.name, icon: cat.icon || '', budgeted, actual, surplus: budgeted - actual };
        }).filter(Boolean);

        return {
            overBudget: rows.filter(r => r.actual > r.budgeted).sort((a, b) => (b.actual - b.budgeted) - (a.actual - a.budgeted)),
            surplusRows: rows,
            netSurplus: rows.reduce((sum, r) => sum + r.surplus, 0)
        };
    }

    showDayDetails(dateStr) {
        this.selectedDate = dateStr;
        const sidebar = document.getElementById('dayDetails');
        const dayBills = this.getFilteredBills().filter(b => b.dueDate === dateStr);
        const dayTransactions = this.getFilteredTransactions().filter(t => t.date === dateStr);

        let html = `
            <div class="sidebar-header">
                <h3>${new Date(dateStr).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })}</h3>
                <button class="btn-close" id="closeSidebar">✕</button>
            </div>
            <div class="sidebar-content">
        `;

        // Bills section
        if (dayBills.length > 0) {
            html += `
                <div class="detail-section">
                    <h4>📋 Bills Due (${dayBills.length})</h4>
                    <div class="bills-list">
                        ${dayBills.map(bill => `
                            <div class="bill-item ${bill.paid ? 'paid' : 'unpaid'}">
                                <div class="bill-info">
                                    <span class="bill-name">${escapeHtml(bill.name)}</span>
                                    <span class="bill-amount">${this.formatCurrency(bill.amount, recordCurrency(bill, this.accounts))}</span>
                                </div>
                                <div class="bill-status">
                                    ${bill.paid ?
                                        '<span class="status-badge paid">✅ Paid</span>' :
                                        '<span class="status-badge unpaid">⏰ Due</span>'
                                    }
                                </div>
                                ${bill.recurring ? `<div class="bill-recurring">🔄 ${bill.recurring}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Transactions section
        if (dayTransactions.length > 0) {
            const incomeTotal = toBaseTransactions(dayTransactions, this.accounts).filter(t => t.type === 'income' && !t.isTransfer).reduce((sum, t) => sum + t.amount, 0);
            const expenseTotal = toBaseTransactions(dayTransactions, this.accounts).filter(t => t.type === 'expense' && !t.isTransfer).reduce((sum, t) => sum + Math.abs(t.amount), 0);

            const accountById = new Map(this.accounts.map(a => [a.id, a]));
            const categoryById = new Map(this.categories.map(c => [c.id, c]));

            html += `
                <div class="detail-section">
                    <h4>💳 Transactions (${dayTransactions.length})</h4>
                    <div class="transaction-summary">
                        <div class="summary-item income">
                            <span>Income:</span>
                            <span>+${this.formatCurrency(incomeTotal)}</span>
                        </div>
                        <div class="summary-item expense">
                            <span>Expenses:</span>
                            <span>-${this.formatCurrency(expenseTotal)}</span>
                        </div>
                        <div class="summary-item net">
                            <span>Net:</span>
                            <span>${this.formatCurrency(incomeTotal - expenseTotal)}</span>
                        </div>
                    </div>
                    <div class="transactions-list">
                        ${dayTransactions.map(transaction => {
                            const account = accountById.get(transaction.accountId);
                            const category = categoryById.get(transaction.categoryId);
                            return `
                            <div class="transaction-item ${transaction.isTransfer ? 'transfer' : transaction.type}">
                                <div class="transaction-icon">
                                    ${transaction.isTransfer ? '🔄' : (transaction.type === 'income' ? '📥' : '📤')}
                                </div>
                                <div class="transaction-details">
                                    <div class="transaction-description">${escapeHtml(transaction.description || (transaction.isTransfer ? 'Transfer' : 'Transaction'))}</div>
                                    <div class="transaction-meta">
                                        ${transaction.isTransfer ? `<span class="transaction-category">Transfer</span>` : ''}
                                        ${category ? `<span class="transaction-category">${escapeHtml(category.name)}</span>` : ''}
                                        ${account ? `<span class="transaction-account">${escapeHtml(account.name)}</span>` : ''}
                                    </div>
                                </div>
                                <div class="transaction-amount ${transaction.isTransfer ? '' : transaction.type}" style="${transaction.isTransfer ? 'color:#6b7280;' : ''}">
                                    ${transaction.type === 'income' ? '+' : '-'}${this.formatCurrency(Math.abs(transaction.amount))}
                                </div>
                            </div>
                        `; }).join('')}
                    </div>
                </div>
            `;
        }

        // Empty state
        if (dayBills.length === 0 && dayTransactions.length === 0) {
            html += `
                <div class="empty-state">
                    <div class="empty-icon">📅</div>
                    <h4>No Activity</h4>
                    <p>No bills or transactions scheduled for this date${this.selectedAccountId ? ' on this account' : ''}.</p>
                </div>
            `;
        }

        html += `</div>`; // Close sidebar-content

        sidebar.innerHTML = html;

        // Add close button functionality
        document.getElementById('closeSidebar')?.addEventListener('click', () => {
            this.selectedDate = null;
            this.renderPulse();
        });
    }

    // Helper methods
    getMonthlyBillTotal() {
        const monthStart = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-01`;
        const monthEnd = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-31`;

        const monthlyBills = this.getFilteredBills().filter(b =>
            b.dueDate >= monthStart && b.dueDate <= monthEnd && !b.paid
        );

        return this.formatCurrency(monthlyBills.reduce((sum, b) => sum + toBase(b.amount, recordCurrency(b, this.accounts)), 0));
    }

    getUpcomingBillsCount() {
        const today = new Date().toISOString().slice(0, 10);
        return this.getFilteredBills().filter(b => !b.paid && b.dueDate >= today).length;
    }

    getOverdueBillsCount() {
        const today = new Date().toISOString().slice(0, 10);
        return this.getFilteredBills().filter(b => !b.paid && b.dueDate < today).length;
    }

    formatCurrency(amount, currency) {
        return formatMoney(amount, currency);
    }
}

// Backwards compatibility
export async function initCalendarUI(year = null, month = null) {
    const manager = new CalendarManager();
    if (year !== null) manager.currentYear = year;
    if (month !== null) manager.currentMonth = month;
    await manager.init();
}
