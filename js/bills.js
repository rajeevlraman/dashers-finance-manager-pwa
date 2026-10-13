import { addItem, deleteItem, getAllItems, updateItem, STORE_NAMES, generateId } from './db.js';
import { getGatedItems } from './features.js';
import { addItem as addTransaction } from './db.js';
import { escapeHtml } from './sanitize.js';
import { getNotificationPermissionState, requestBillNotifications, exportBillsToICS } from './billReminders.js';
import { getExpenseCategoryBucket } from './propertyExpenseCategories.js';
import { syncToExpenses } from './transactions.js';

import { baseEquivalent, formatMoney, getBaseCurrency, recordCurrency, toBase, transferLegs } from './utils/currency.js';
// ---------------------------------------------------------------------------
// Standalone helpers (no `this`) — extracted so other pages (e.g. the Bills
// card on Finance Overview) can reuse the exact same status/pay logic
// instead of re-implementing it. BillsManager methods below just delegate
// to these.
// ---------------------------------------------------------------------------

export function getBillStatus(bill, today) {
    if (bill.paid) return { text: 'Paid', class: 'paid', icon: '✅' };

    const daysUntilDue = Math.floor((new Date(bill.dueDate) - new Date(today)) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) return { text: `${Math.abs(daysUntilDue)}d overdue`, class: 'overdue', icon: '🚨' };
    if (daysUntilDue === 0) return { text: 'Due today', class: 'due-today', icon: '⚠️' };
    if (daysUntilDue <= 3) return { text: `Due in ${daysUntilDue}d`, class: 'due-soon', icon: '⏰' };

    return { text: 'Upcoming', class: 'upcoming', icon: '📅' };
}

// Vehicle's regoFrequency uses 'annual'/'six_monthly'; getNextBillDueDate's
// freq switch uses 'annually'/'halfyearly' (bill.recurring's vocabulary) —
// translate rather than adding a third near-duplicate date-rolling function.
const VEHICLE_ROGO_FREQ_TO_BILL_FREQ = { annual: 'annually', six_monthly: 'halfyearly' };
// Inverse of the above, used to pull the vehicle's regoFrequency INTO line
// with the bill's own Recurring cadence on each payment — see the bug-fix
// comment in syncVehicleRegoFromBill below.
const BILL_FREQ_TO_VEHICLE_REGO_FREQ = { annually: 'annual', halfyearly: 'six_monthly' };

export function getNextBillDueDate(currentDateStr, freq) {
    const d = new Date(currentDateStr);
    switch (freq) {
        case 'weekly': d.setDate(d.getDate() + 7); break;
        case 'fortnightly': d.setDate(d.getDate() + 14); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'quarterly': d.setMonth(d.getMonth() + 3); break;
        case 'halfyearly': d.setMonth(d.getMonth() + 6); break;
        case 'annually': d.setFullYear(d.getFullYear() + 1); break;
    }
    return d.toISOString().slice(0, 10);
}

async function resolveBillCategoryId(billName) {
    const categories = await getAllItems(STORE_NAMES.categories);
    const name = billName.toLowerCase();

    if (name.includes('electric') || name.includes('power') || name.includes('utility'))
        return categories.find(c => c.name.toLowerCase().includes('utility'))?.id;
    if (name.includes('water') || name.includes('gas'))
        return categories.find(c => c.name.toLowerCase().includes('utility'))?.id;
    if (name.includes('internet') || name.includes('phone') || name.includes('mobile'))
        return categories.find(c => c.name.toLowerCase().includes('utility'))?.id;
    if (name.includes('rent') || name.includes('mortgage'))
        return categories.find(c => c.name.toLowerCase().includes('rent'))?.id;
    // Bug fix: this fallback (only used when a bill is saved/paid with no
    // categoryId already set) had no idea "registration"/"rego"/"vicroads"
    // existed, so every such bill silently landed on "Other" instead of
    // the dedicated sub_rego category the import engine already knows
    // about (see categoryMapper.js's KEYWORD_CATEGORY_MAP). Matched
    // directly against the known category id rather than a name substring
    // like the others above, since 'sub_rego's display name ("Registration")
    // is exactly the word we're matching anyway.
    if (name.includes('rego') || name.includes('registration') || name.includes('vicroads'))
        return categories.find(c => c.id === 'sub_rego')?.id || categories.find(c => c.name.toLowerCase().includes('registration'))?.id;

    return categories.find(c => c.name.toLowerCase().includes('other'))?.id;
}

// Marks a bill paid, records the resulting transaction(s) (handling the
// transfer-pair case for bills that credit another of your own accounts),
// and rolls a recurring bill forward to its next due date. Shared by
// BillsManager.payBill and the Finance Overview Bills card so there's one
// source of truth for what "paying a bill" actually does.
export async function markBillPaid(bill, accounts) {
    bill.paid = true;
    bill.paidDate = new Date().toISOString().slice(0, 10);
    await updateItem(STORE_NAMES.bills, bill);

    if (bill.accountId) {
        const today = new Date().toISOString().slice(0, 10);
        const categoryId = bill.categoryId || await resolveBillCategoryId(bill.name);

        if (bill.destinationAccountId) {
            const transferGroupId = generateId();
            const destAccount = accounts.find(a => a.id === bill.destinationAccountId);
            // Cross-currency: the receiving side gets the amount converted at the stored rate
            // (it used to be credited the same figure — A$300 became +300 USD).
            const srcAccount = accounts.find(a => a.id === bill.accountId);
            const legs = transferLegs(bill.amount, srcAccount?.currency, destAccount?.currency);
            const outTx = {
                id: generateId(),
                type: 'expense',
                amount: -bill.amount,
                date: today,
                categoryId,
                accountId: bill.accountId,
                description: `Bill: ${bill.name}${destAccount ? ` (to ${destAccount.name})` : ''}`,
                billId: bill.id,
                isTransfer: true,
                transferGroupId,
                transferDirection: 'out',
                ...legs.fx
            };
            const inTx = {
                id: generateId(),
                type: 'income',
                amount: legs.received,
                date: today,
                categoryId,
                accountId: bill.destinationAccountId,
                description: `Bill: ${bill.name} (payment received)`,
                billId: bill.id,
                isTransfer: true,
                transferGroupId,
                transferDirection: 'in',
                ...legs.fx
            };
            await addTransaction(STORE_NAMES.transactions, outTx);
            await addTransaction(STORE_NAMES.transactions, inTx);
        } else {
            const isPropertyExpense = !!bill.propertyId;
            const transaction = {
                type: 'expense',
                amount: -bill.amount,
                date: today,
                categoryId,
                accountId: bill.accountId,
                description: `Bill: ${bill.name}`,
                billId: bill.id,
                propertyId: bill.propertyId || '',
                isPropertyExpense,
                // Mirrors the fields the manual Transactions-page save flow sets
                // when its "This is a property expense" checkbox is ticked — see
                // syncToExpenses() below. Without these, a paid bill (e.g.
                // Council Rates or Land Tax) is correctly tagged on the
                // transaction itself but never reaches the `expenses` store, so
                // it's invisible to the Finance Overview Property Rates & Taxes
                // card, the Property Expenses page, and the Deduction Report
                // until someone re-enters it by hand.
                ...(isPropertyExpense ? {
                    expenseCategory: getExpenseCategoryBucket(categoryId),
                    expenseStatus: 'Paid'
                } : {})
            };
            await addTransaction(STORE_NAMES.transactions, transaction);
            if (isPropertyExpense) {
                // Same sync the Transactions page uses — keeps `expenses` (and
                // everything reading from it) in lockstep with bill payments
                // instead of requiring a duplicate, hand-maintained entry.
                await syncToExpenses(transaction).catch(err =>
                    console.error('❌ Failed to sync paid bill to expenses store:', err)
                );
            }
        }
    }

    // Registration bill linked to a vehicle: mirrors the isPropertyExpense
    // sync above, but for vehicles.js's own regoCost/regoExpiryDate fields
    // instead of the expenses store, since the Vehicles page reads those
    // fields directly rather than querying bills/transactions itself.
    if (bill.vehicleId) {
        await syncVehicleRegoFromBill(bill).catch(err =>
            console.error('❌ Failed to sync paid rego bill to vehicle:', err)
        );
    }

    if (bill.recurring) {
        const nextDate = getNextBillDueDate(bill.dueDate, bill.recurring);
        const newBill = {
            name: bill.name,
            amount: bill.amount,
            dueDate: nextDate,
            paid: false,
            recurring: bill.recurring,
            accountId: bill.accountId,
            categoryId: bill.categoryId,
            propertyId: bill.propertyId || '',
            vehicleId: bill.vehicleId || '',
            destinationAccountId: bill.destinationAccountId || ''
        };
        await addItem(STORE_NAMES.bills, newBill);
    }

    return bill;
}

// Advances the linked vehicle's rego expiry forward by its own renewal
// frequency from this bill's paid date (rather than just copying the
// bill's dueDate across) so a late payment doesn't shorten the next
// renewal window, and updates regoCost to what was actually just paid.
async function syncVehicleRegoFromBill(bill) {
    const vehicles = await getAllItems(STORE_NAMES.vehicles);
    const vehicle = vehicles.find(v => v.id === bill.vehicleId);
    if (!vehicle) return;

    // Bug fix ("rego doesn't tally"): vehicle.regoFrequency is what
    // annualRegoCost() (vehicles.js) uses to decide whether to double
    // regoCost into an annual figure — but it was a separately-maintained
    // field on the vehicle, never updated from how the linked bill
    // actually recurs. A Registration bill set to "Half-Yearly" but linked
    // to a vehicle still sitting on its default "Annually" (or vice versa)
    // would silently halve or double the vehicle's true annual rego cost
    // every time it was paid. The bill's own Recurring cadence is the
    // actual source of truth for how rego gets paid, so adopt it here
    // instead of trusting a field that can silently drift out of sync.
    // Falls back to the vehicle's existing value for a bill recurring on
    // some other cadence (weekly/monthly/etc.) — not a real rego pattern,
    // so there's nothing sensible to translate it to.
    const regoFrequency = BILL_FREQ_TO_VEHICLE_REGO_FREQ[bill.recurring] || vehicle.regoFrequency;
    const freq = VEHICLE_ROGO_FREQ_TO_BILL_FREQ[regoFrequency] || 'annually';
    const fromDate = bill.paidDate || new Date().toISOString().slice(0, 10);

    await updateItem(STORE_NAMES.vehicles, {
        ...vehicle,
        regoCost: bill.amount,
        regoFrequency,
        regoExpiryDate: getNextBillDueDate(fromDate, freq),
        updatedAt: new Date().toISOString()
    });
}

// Bug fix: a new document-level click listener used to be attached every time
// init() ran (i.e. every save/delete/navigation), stacking duplicate listeners.
// Now we attach exactly one and delegate to whichever instance is active.
let activeBillsManager = null;
let billsDelegatedListenerAttached = false;

function attachBillsDelegatedListener() {
    if (billsDelegatedListenerAttached) return;
    billsDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        if (!activeBillsManager) return;

        const tabButton = e.target.closest('[data-bills-tab]');
        if (tabButton) {
            activeBillsManager.setBillsTab(tabButton.dataset.billsTab);
            return;
        }

        const button = e.target.closest('[data-action]');
        if (!button) return;
        activeBillsManager.handleBillAction(button.dataset.action, button.dataset.id);
    });
}

export class BillsManager {
    constructor() {
        this.bills = [];
        this.accounts = [];
        this.categories = [];
        this.properties = [];
        this.vehicles = [];
        this.currentSort = 'dueDate-asc';
        // Overdue bills take priority on open — reset once per fresh
        // load in init(), but preserved across re-renders triggered by
        // actions (pay/sort/etc.) so switching tabs doesn't get undone.
        this.activeBillsTab = 'overdue';
    }

    async init() {
        await this.loadData();
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        [this.bills, this.accounts, this.categories, this.properties, this.vehicles] = await Promise.all([
            getAllItems(STORE_NAMES.bills),
            getAllItems(STORE_NAMES.accounts),
            getAllItems(STORE_NAMES.categories),
            getGatedItems(STORE_NAMES.properties).catch(() => []),
            // Only used for the optional vehicle picker on a Registration
            // bill — .catch keeps this page working even pre-migration.
            getAllItems(STORE_NAMES.vehicles).catch(() => [])
        ]);
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');
        const today = new Date().toISOString().slice(0, 10);
        
        mainContent.innerHTML = `
            <div class="bills-container">
                <div class="bills-header">
                    <h2>📋 Bills Manager</h2>
                </div>

                ${this.renderStatsCards(today)}

                ${this.renderHorizontalQuickActions(today)}

                <div class="bills-content">
                    ${this.bills.length === 0 ? this.renderEmptyState() : this.renderBillsTable(today)}
                </div>

                ${this.renderBillModal()}
            </div>
        `;
    }

    renderStatsCards(today) {
        const stats = this.calculateStats(today);
        
        return `
            <div class="stats-cards page-compact-cards">
                <div class="stat-card ${stats.overdue.count > 0 ? 'overdue' : 'normal'}">
                    <div class="stat-icon">🚨</div>
                    <div class="stat-content">
                        <div class="stat-value">${stats.overdue.count}</div>
                        <div class="stat-label">Overdue</div>
                        ${stats.overdue.count > 0 ? `
                            <div class="stat-amount">${this.formatCurrency(stats.overdue.amount)}</div>
                        ` : ''}
                    </div>
                </div>
                <div class="stat-card ${stats.dueSoon.count > 0 ? 'warning' : 'normal'}">
                    <div class="stat-icon">⏰</div>
                    <div class="stat-content">
                        <div class="stat-value">${stats.dueSoon.count}</div>
                        <div class="stat-label">Due This Week</div>
                        <div class="stat-amount">${this.formatCurrency(stats.dueSoon.amount)}</div>
                    </div>
                </div>
                <div class="stat-card info">
                    <div class="stat-icon">💰</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.formatCurrency(stats.totalDue)}</div>
                        <div class="stat-label">Total Due</div>
                        <div class="stat-subtext">${stats.upcoming.count} upcoming</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderHorizontalQuickActions(today) {
        const stats = this.calculateStats(today);
        const canPayAll = stats.unpaid.count > 0 && this.bills.filter(b => !b.paid && b.accountId).length === stats.unpaid.count;

        return `
            <div class="horizontal-quick-actions">
                <div class="quick-action-item primary" id="quickAddBill">
                    <span class="quick-action-icon">➕</span>
                    <span class="quick-action-text">Add Bill</span>
                </div>
                
                ${canPayAll ? `
                    <div class="quick-action-item success" id="quickPayAll">
                        <span class="quick-action-icon">💳</span>
                        <span class="quick-action-text">Pay All</span>
                        <span class="quick-action-badge">${stats.unpaid.count}</span>
                    </div>
                ` : ''}
                
                ${stats.overdue.count > 0 ? `
                    <div class="quick-action-item warning" id="quickViewOverdue">
                        <span class="quick-action-icon">🚨</span>
                        <span class="quick-action-text">Overdue</span>
                        <span class="quick-action-badge">${stats.overdue.count}</span>
                    </div>
                ` : ''}
                
                <div class="quick-action-item secondary" id="quickExport">
                    <span class="quick-action-icon">📤</span>
                    <span class="quick-action-text">Export</span>
                </div>

                <div class="quick-action-item secondary" id="quickCalendarExport">
                    <span class="quick-action-icon">📅</span>
                    <span class="quick-action-text">Add to Calendar</span>
                </div>

                <div class="quick-action-item ${this.getNotificationButtonClass()}" id="quickToggleNotifications">
                    <span class="quick-action-icon">${this.getNotificationButtonIcon()}</span>
                    <span class="quick-action-text">${this.getNotificationButtonText()}</span>
                </div>
            </div>
        `;
    }

    getNotificationButtonClass() {
        const state = getNotificationPermissionState();
        if (state === 'granted') return 'success';
        if (state === 'denied' || state === 'unsupported') return 'secondary';
        return 'warning';
    }

    getNotificationButtonIcon() {
        const state = getNotificationPermissionState();
        if (state === 'granted') return '🔔';
        if (state === 'denied') return '🔕';
        if (state === 'unsupported') return '🚫';
        return '🔔';
    }

    getNotificationButtonText() {
        const state = getNotificationPermissionState();
        if (state === 'granted') return 'Reminders On';
        if (state === 'denied') return 'Reminders Blocked';
        if (state === 'unsupported') return 'Not Supported';
        return 'Enable Reminders';
    }

    renderBillsTable(today) {
        const sortedBills = this.getSortedBills();

        const groups = {
            overdue: sortedBills.filter(b => !b.paid && b.dueDate < today),
            upcoming: sortedBills.filter(b => !b.paid && b.dueDate >= today),
            paid: sortedBills.filter(b => b.paid)
        };

        // If the tab someone was on no longer makes sense to land on (e.g.
        // it was empty and things changed), overdue still takes priority.
        if (!groups[this.activeBillsTab]) {
            this.activeBillsTab = 'overdue';
        }

        const tabDefs = [
            { key: 'overdue', icon: '🚨', label: 'Overdue' },
            { key: 'upcoming', icon: '📅', label: 'Upcoming' },
            { key: 'paid', icon: '✅', label: 'Paid' }
        ];

        const activeBills = groups[this.activeBillsTab];
        const activeTotal = activeBills.reduce((sum, b) => sum + toBase(b.amount, this.billCurrency(b)), 0);

        return `
            <div class="section-card">
                <div class="table-header">
                    <h3>Your Bills</h3>
                    <div class="table-controls">
                        <span class="table-count">${this.bills.length} bill${this.bills.length !== 1 ? 's' : ''}</span>
                        <select id="sortBills" class="form-select">
                            <option value="dueDate-asc" ${this.currentSort === 'dueDate-asc' ? 'selected' : ''}>Due Date (Soonest)</option>
                            <option value="dueDate-desc" ${this.currentSort === 'dueDate-desc' ? 'selected' : ''}>Due Date (Latest)</option>
                            <option value="amount-desc" ${this.currentSort === 'amount-desc' ? 'selected' : ''}>Highest Amount</option>
                            <option value="amount-asc" ${this.currentSort === 'amount-asc' ? 'selected' : ''}>Lowest Amount</option>
                            <option value="name-asc" ${this.currentSort === 'name-asc' ? 'selected' : ''}>Name A-Z</option>
                        </select>
                    </div>
                </div>

                <div class="bills-tabs" role="tablist">
                    ${tabDefs.map(tab => `
                        <button
                            type="button"
                            class="bills-tab bills-tab-${tab.key} ${this.activeBillsTab === tab.key ? 'active' : ''}"
                            data-bills-tab="${tab.key}"
                            role="tab"
                            aria-selected="${this.activeBillsTab === tab.key}"
                        >
                            <span class="bills-tab-label">${tab.icon} ${tab.label}</span>
                            <span class="bills-tab-count">${groups[tab.key].length}</span>
                        </button>
                    `).join('')}
                </div>

                ${activeBills.length > 0 ? `<div class="bills-tab-total">${this.formatCurrency(activeTotal)} ${this.activeBillsTab}</div>` : ''}

                <div class="bills-list">
                    ${activeBills.length === 0
                        ? `<div class="bill-column-empty">Nothing here.</div>`
                        : activeBills.map(bill => this.renderBillRow(bill, today)).join('')
                    }
                </div>
            </div>
        `;
    }

    setBillsTab(tab) {
        if (this.activeBillsTab === tab) return;
        this.activeBillsTab = tab;
        this.renderUI();
        this.attachEventListeners();
    }

    renderBillRow(bill, today) {
        const account = this.accounts.find(a => a.id === bill.accountId);
        const destAccount = this.accounts.find(a => a.id === bill.destinationAccountId);
        const category = this.categories.find(c => c.id === bill.categoryId);
        const property = this.properties.find(p => p.id === bill.propertyId);
        const status = this.getBillStatus(bill, today);
        
        return `
            <div class="bill-row ${status.class}" data-bill-id="${bill.id}">
                <div class="bill-main">
                    <div class="bill-icon">${category?.icon || '🧾'}</div>
                    <div class="bill-details">
                        <div class="bill-name">${escapeHtml(bill.name)}</div>
                        <div class="bill-meta">
                            <span class="due-date">Due: ${this.formatDateDisplay(bill.dueDate)}</span>
                            ${bill.recurring ? `<span class="recurring-tag">🔄 ${escapeHtml(bill.recurring)}</span>` : ''}
                            ${account ? `<span class="account-tag">${this.getAccountIcon(account.type)} ${escapeHtml(account.name)}</span>` : ''}
                            ${destAccount ? `<span class="account-tag">➡️ ${this.getAccountIcon(destAccount.type)} ${escapeHtml(destAccount.name)}</span>` : ''}
                            ${property ? `<span class="property-tag">🏠 ${escapeHtml(property.name)}</span>` : ''}
                        </div>
                    </div>
                    <div class="bill-amount ${bill.paid ? 'paid' : 'unpaid'}">
                        ${this.formatCurrency(bill.amount, this.billCurrency(bill))}${this.billCurrency(bill) !== getBaseCurrency() && baseEquivalent(bill.amount, this.billCurrency(bill)) ? ` <small class="bill-equivalent" style="opacity:.7">${baseEquivalent(bill.amount, this.billCurrency(bill))}</small>` : ''}
                    </div>
                </div>
                <div class="bill-status">
                    <span class="status-badge ${status.class}">
                        ${status.icon} ${status.text}
                    </span>
                </div>
                <div class="bill-actions">
                    ${!bill.paid ? `
                        <button class="btn-action pay" data-action="pay" data-id="${bill.id}" title="Mark as paid">
                            💳 Pay
                        </button>
                    ` : ''}
                    <button class="btn-action edit" data-action="edit" data-id="${bill.id}" title="Edit bill">
                        ✏️ Edit
                    </button>
                    <button class="btn-action delete" data-action="delete" data-id="${bill.id}" title="Delete bill">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
    }

    renderBillModal() {
        return `
            <div id="billModal" class="modal-overlay" style="display: none;">
                <div class="modal">
                    <div class="modal-header">
                        <h3 id="modalTitle">Add New Bill</h3>
                        <button class="btn-close" id="closeModal">✕</button>
                    </div>
                    <form id="billForm" class="modal-form">
                        <input type="hidden" id="editBillId" value="">
                        
                        <div class="form-group">
                            <label>Bill Name</label>
                            <input type="text" id="billName" class="form-input" placeholder="e.g., Electricity Bill" required>
                            <small class="form-hint">Free text — picking a category below fills this in automatically if it's still empty, but you can always type your own.</small>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label id="billAmountLabel">Amount</label>
                                <input type="number" id="billAmount" class="form-input" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="form-group">
                                <label>Due Date</label>
                                <input type="date" id="billDueDate" class="form-input" required>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Payment Account</label>
                                <select id="billAccount" class="form-select">
                                    <option value="">Select Account</option>
                                    ${this.accounts.map(acc => `
                                        <option value="${acc.id}">${this.getAccountIcon(acc.type)} ${escapeHtml(acc.name)}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Category</label>
                                <select id="billCategory" class="form-select">
                                    <option value="">Auto-detect</option>
                                    ${this.categories.filter(c => !c.parentId).map(cat => `
                                        <option value="${cat.id}">${cat.icon || '📁'} ${escapeHtml(cat.name)}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Subcategory</label>
                            <select id="billSubCategory" class="form-select">
                                <option value="">-- None --</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Also credits another account (optional)</label>
                            <select id="billDestinationAccount" class="form-select">
                                <option value="">-- Not a transfer --</option>
                                ${this.accounts.map(acc => `
                                    <option value="${acc.id}">${this.getAccountIcon(acc.type)} ${escapeHtml(acc.name)}</option>
                                `).join('')}
                            </select>
                            <small class="form-hint">
                                For bills that are really a transfer between two of your own
                                accounts — e.g. a monthly credit card payment from your offset
                                account. When set, paying this bill debits the Payment Account
                                above AND credits this account (so a credit card's balance drops
                                correctly), instead of only affecting one side.
                            </small>
                        </div>

                        ${this.properties.length > 0 ? `
                        <div class="form-group">
                            <label>Property (optional)</label>
                            <select id="billProperty" class="form-select">
                                <option value="">-- Not property-specific --</option>
                                ${this.properties.map(p => `
                                    <option value="${p.id}">🏠 ${escapeHtml(p.name)}${p.propertyType && p.propertyType !== 'primary' ? ' (Investment)' : ''}</option>
                                `).join('')}
                            </select>
                            <small class="form-hint">
                                Link this bill to a specific property (e.g. Land Tax, Landlord
                                Insurance, or a per-property share of Water/Council Rates) so it
                                flows into that property's own expense tracking and tax reporting.
                            </small>
                        </div>
                        ` : ''}

                        ${this.vehicles.length > 0 ? `
                        <div class="form-group" id="billVehicleGroup" style="display: none;">
                            <label>Vehicle</label>
                            <select id="billVehicle" class="form-select">
                                <option value="">-- Select vehicle --</option>
                                ${this.vehicles.map(v => `
                                    <option value="${v.id}">🚗 ${escapeHtml(v.nickname || v.rego || `${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle')}</option>
                                `).join('')}
                            </select>
                            <small class="form-hint">
                                Link this Registration bill to a specific vehicle. Paying it will
                                update that vehicle's rego cost and roll its expiry date forward
                                by its renewal frequency, instead of you having to update the
                                Vehicles page by hand.
                            </small>
                        </div>
                        ` : ''}
                        
                        <div class="form-group">
                            <label>Recurring</label>
                            <select id="billRecurring" class="form-select">
                                <option value="">One-time</option>
                                <option value="weekly">Weekly</option>
                                <option value="fortnightly">Fortnightly</option>
                                <option value="monthly">Monthly</option>
                                <option value="quarterly">Quarterly</option>
                                <option value="halfyearly">Half-Yearly</option>
                                <option value="annually">Annually</option>
                            </select>
                        </div>
                        
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">💾 Save Bill</button>
                            <button type="button" class="btn btn-secondary" id="cancelBill">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    renderEmptyState() {
        return `
            <div class="section-card">
                <div class="empty-state">
                    <div class="empty-icon">🧾</div>
                    <h3>No Bills Yet</h3>
                    <p>Start by adding your first bill to track your expenses.</p>
                    <button class="btn btn-primary" id="emptyAddBill">Add Your First Bill</button>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Quick actions
        document.getElementById('quickAddBill')?.addEventListener('click', () => this.openBillForm());
        document.getElementById('quickPayAll')?.addEventListener('click', () => this.payAllBills());
        document.getElementById('quickViewOverdue')?.addEventListener('click', () => this.filterOverdue());
        document.getElementById('quickExport')?.addEventListener('click', () => this.exportBills());
        document.getElementById('quickCalendarExport')?.addEventListener('click', () => exportBillsToICS(this.bills.map(x => ({ ...x, currency: this.billCurrency(x) })), this.properties));
        document.getElementById('quickToggleNotifications')?.addEventListener('click', () => this.handleNotificationToggle());
        document.getElementById('emptyAddBill')?.addEventListener('click', () => this.openBillForm());

        // Sorting
        document.getElementById('sortBills')?.addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.renderUI();
        });

        // Bill actions
        activeBillsManager = this;
        attachBillsDelegatedListener();

        // Modal events
        this.setupModalEvents();
    }

    handleBillAction(action, billId) {
        const bill = this.bills.find(b => b.id === billId);
        if (!bill) return;

        switch (action) {
            case 'pay':
                this.payBill(bill);
                break;
            case 'edit':
                this.openBillForm(bill);
                break;
            case 'delete':
                this.deleteBill(bill);
                break;
        }
    }

    setupModalEvents() {
        const modal = document.getElementById('billModal');
        const form = document.getElementById('billForm');
        const closeBtn = document.getElementById('closeModal');
        const cancelBtn = document.getElementById('cancelBill');

        // Open/close modal
        [closeBtn, cancelBtn].forEach(btn => {
            btn?.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        });

        // Form submission
        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveBill();
            modal.style.display = 'none';
        });

        // Close modal on backdrop click
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    // Core functionality methods (same as before)
    async handleNotificationToggle() {
        const state = getNotificationPermissionState();
        if (state === 'unsupported') {
            alert('Your browser doesn\'t support notifications.');
            return;
        }
        if (state === 'denied') {
            alert(
                'Notifications are blocked for this app in your browser settings.\n\n' +
                'To re-enable: open your browser\'s site settings for this page and ' +
                'change Notifications to "Allow", then reload.'
            );
            return;
        }
        if (state === 'granted') {
            alert(
                'Reminders are already on — you\'ll get a notification for overdue ' +
                'and soon-due bills each time you open the app (checked once per day, ' +
                'no spam on every reload).\n\n' +
                'Note: this only works while the app is actually open in a tab. For ' +
                'reminders that work even when the app is closed, use "Add to Calendar" ' +
                'to import your bills into your phone/Google/Outlook calendar instead.'
            );
            return;
        }

        const result = await requestBillNotifications();
        if (result === 'granted') {
            alert('Reminders enabled! You\'ll be notified about overdue and soon-due bills when you open the app.');
        } else {
            alert('Permission not granted — reminders stay off.');
        }
        this.renderUI();
        this.attachEventListeners();
    }

    async payBill(bill) {
        if (!confirm(`Mark "${bill.name}" as paid?`)) return;

        await markBillPaid(bill, this.accounts);

        await this.init();
    }

    async payAllBills() {
        const unpaidBills = this.bills.filter(b => !b.paid && b.accountId);
        
        if (unpaidBills.length === 0) {
            alert('No payable bills found!');
            return;
        }

        if (!confirm(`Pay all ${unpaidBills.length} due bills?`)) return;

        for (const bill of unpaidBills) {
            await this.payBill(bill);
        }
    }

    async deleteBill(bill) {
        if (!confirm(`Delete "${bill.name}"?`)) return;
        await deleteItem(STORE_NAMES.bills, bill.id);
        await this.init();
    }

    openBillForm(bill = null) {
        const modal = document.getElementById('billModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('billForm');

        this.setupBillCategoryCascade();

        if (bill) {
            title.textContent = 'Edit Bill';
            document.getElementById('editBillId').value = bill.id;
            document.getElementById('billName').value = bill.name;
            document.getElementById('billAmount').value = bill.amount;
            document.getElementById('billDueDate').value = bill.dueDate;
            document.getElementById('billAccount').value = bill.accountId || '';
            document.getElementById('billRecurring').value = bill.recurring || '';
            const propertyField = document.getElementById('billProperty');
            if (propertyField) propertyField.value = bill.propertyId || '';
            const vehicleField = document.getElementById('billVehicle');
            if (vehicleField) vehicleField.value = bill.vehicleId || '';
            document.getElementById('billDestinationAccount').value = bill.destinationAccountId || '';

            // Figure out whether the bill's saved category is itself a
            // top-level category or a subcategory, and populate both
            // dropdowns accordingly (mirrors the Transactions/Recurring
            // pattern instead of Bills' old single flat category list).
            const savedCategory = this.categories.find(c => c.id === bill.categoryId);
            if (savedCategory?.parentId) {
                document.getElementById('billCategory').value = savedCategory.parentId;
                this.updateBillSubCategoryOptions(savedCategory.parentId);
                document.getElementById('billSubCategory').value = savedCategory.id;
            } else {
                document.getElementById('billCategory').value = bill.categoryId || '';
                this.updateBillSubCategoryOptions(bill.categoryId || '');
            }
            this.updateBillVehicleVisibility(bill.categoryId || '');
        } else {
            title.textContent = 'Add New Bill';
            form.reset();
            document.getElementById('editBillId').value = '';
            document.getElementById('billDueDate').value = new Date().toISOString().slice(0, 10);
            this.updateBillSubCategoryOptions('');
            this.updateBillVehicleVisibility('');
        }

        this.updateBillAmountLabel();
        const acctSel = document.getElementById('billAccount');
        if (acctSel && !acctSel.dataset.fxWired) {
            acctSel.dataset.fxWired = '1';
            acctSel.addEventListener('change', () => this.updateBillAmountLabel());
        }

        modal.style.display = 'flex';
    }

    // The amount is in the payment account's currency; say so on the form.
    updateBillAmountLabel() {
        const label = document.getElementById('billAmountLabel');
        if (!label) return;
        const accountId = document.getElementById('billAccount')?.value;
        const code = recordCurrency({ accountId }, this.accounts);
        label.textContent = accountId && code !== getBaseCurrency() ? `Amount (${code})` : 'Amount';
    }

    // Wires the Category -> Subcategory cascade and the "fill in the Bill
    // Name from the category if it's still empty" convenience — called
    // once each time the form opens (openBillForm rebuilds the modal
    // content fresh each time it's shown).
    setupBillCategoryCascade() {
        const categorySelect = document.getElementById('billCategory');
        const subCategorySelect = document.getElementById('billSubCategory');
        const nameInput = document.getElementById('billName');
        if (!categorySelect || !subCategorySelect) return;

        categorySelect.onchange = () => {
            this.updateBillSubCategoryOptions(categorySelect.value);
            this.maybeAutoFillBillName(nameInput, categorySelect.value);
            this.updateBillVehicleVisibility(categorySelect.value);
        };
        subCategorySelect.onchange = () => {
            this.maybeAutoFillBillName(nameInput, subCategorySelect.value || categorySelect.value);
            this.updateBillVehicleVisibility(subCategorySelect.value || categorySelect.value);
        };
    }

    updateBillSubCategoryOptions(mainCategoryId) {
        const subCategorySelect = document.getElementById('billSubCategory');
        if (!subCategorySelect) return;
        const subs = this.categories.filter(c => c.parentId === mainCategoryId);
        subCategorySelect.innerHTML =
            `<option value="">-- None --</option>` +
            subs.map(s => `<option value="${s.id}">${s.icon || '📁'} ${escapeHtml(s.name)}</option>`).join('');
    }

    // Vehicle picker only makes sense for a Registration bill — hidden the
    // rest of the time so it doesn't clutter the form for every other
    // category. Category ids are stable app-wide (see defaultCategories.js),
    // so matching directly on 'sub_rego' is safe here.
    updateBillVehicleVisibility(categoryId) {
        const group = document.getElementById('billVehicleGroup');
        if (!group) return;
        const isRego = categoryId === 'sub_rego';
        group.style.display = isRego ? '' : 'none';
        if (!isRego) {
            const vehicleField = document.getElementById('billVehicle');
            if (vehicleField) vehicleField.value = '';
        }
    }

    // Only fills the Name field if it's currently empty — never overwrites
    // something the person already typed, per "the naming can still be
    // free or from dropdown... it should still be editable."
    maybeAutoFillBillName(nameInput, categoryId) {
        if (!nameInput || nameInput.value.trim() !== '') return;
        const cat = this.categories.find(c => c.id === categoryId);
        if (cat) nameInput.value = cat.name;
    }

    async saveBill() {
        const form = document.getElementById('billForm');
        const billId = document.getElementById('editBillId').value;

        const accountId = document.getElementById('billAccount').value;
        const destinationAccountId = document.getElementById('billDestinationAccount').value;

        if (destinationAccountId && destinationAccountId === accountId) {
            alert('The "Also credits another account" field must be different from the Payment Account.');
            return;
        }

        const mainCategoryId = document.getElementById('billCategory').value;
        const subCategoryId = document.getElementById('billSubCategory').value;

        const billData = {
            name: document.getElementById('billName').value,
            amount: parseFloat(document.getElementById('billAmount').value),
            dueDate: document.getElementById('billDueDate').value,
            accountId,
            categoryId: subCategoryId || mainCategoryId,
            recurring: document.getElementById('billRecurring').value,
            propertyId: document.getElementById('billProperty')?.value || '',
            vehicleId: document.getElementById('billVehicle')?.value || '',
            destinationAccountId: destinationAccountId || '',
            paid: false
        };

        if (billId) {
            billData.id = billId;
            await updateItem(STORE_NAMES.bills, billData);
        } else {
            billData.id = generateId();
            await addItem(STORE_NAMES.bills, billData);
        }

        await this.init();
    }

    filterOverdue() {
        const today = new Date().toISOString().slice(0, 10);
        const overdueBills = this.bills.filter(b => !b.paid && b.dueDate < today);
        
        if (overdueBills.length === 0) {
            alert('No overdue bills found!');
            return;
        }

        this.renderFilteredBills(overdueBills, 'Overdue Bills');
    }

    renderFilteredBills(filteredBills, title) {
        const today = new Date().toISOString().slice(0, 10);
        const billsContent = document.querySelector('.bills-content');
        
        billsContent.innerHTML = `
            <div class="section-card">
                <div class="table-header">
                    <h3>${title} (${filteredBills.length})</h3>
                    <button class="btn btn-secondary" id="clearFilter">Show All Bills</button>
                </div>
                <div class="bills-list">
                    ${filteredBills.map(bill => this.renderBillRow(bill, today)).join('')}
                </div>
            </div>
        `;

        document.getElementById('clearFilter')?.addEventListener('click', () => {
            this.renderUI();
        });
    }

    exportBills() {
        const csv = this.convertToCSV(this.bills);
        this.downloadCSV(csv, 'bills-export.csv');
    }

    // Helper methods (same as before)
    calculateStats(today) {
        const overdue = this.bills.filter(b => !b.paid && b.dueDate < today);
        const dueSoon = this.bills.filter(b => {
            if (b.paid) return false;
            const daysUntilDue = Math.floor((new Date(b.dueDate) - new Date(today)) / (1000 * 60 * 60 * 24));
            return daysUntilDue <= 7 && daysUntilDue >= 0;
        });
        const upcoming = this.bills.filter(b => !b.paid && b.dueDate >= today);
        const unpaid = this.bills.filter(b => !b.paid);

        return {
            overdue: {
                count: overdue.length,
                amount: overdue.reduce((sum, b) => sum + toBase(b.amount, this.billCurrency(b)), 0)
            },
            dueSoon: {
                count: dueSoon.length,
                amount: dueSoon.reduce((sum, b) => sum + toBase(b.amount, this.billCurrency(b)), 0)
            },
            upcoming: {
                count: upcoming.length,
                amount: upcoming.reduce((sum, b) => sum + toBase(b.amount, this.billCurrency(b)), 0)
            },
            unpaid: {
                count: unpaid.length
            },
            totalDue: unpaid.reduce((sum, b) => sum + toBase(b.amount, this.billCurrency(b)), 0)
        };
    }

    getSortedBills() {
        return [...this.bills].sort((a, b) => {
            switch (this.currentSort) {
                case 'dueDate-asc': return a.dueDate.localeCompare(b.dueDate);
                case 'dueDate-desc': return b.dueDate.localeCompare(a.dueDate);
                case 'amount-desc': return b.amount - a.amount;
                case 'amount-asc': return a.amount - b.amount;
                case 'name-asc': return a.name.localeCompare(b.name);
                default: return a.dueDate.localeCompare(b.dueDate);
            }
        });
    }

    getBillStatus(bill, today) {
        return getBillStatus(bill, today);
    }

    getAccountIcon(type) {
        const icons = { bank: '🏦', credit: '💳', cash: '💵', savings: '💰', investment: '📈', offset: '⚖️', loan: '🏠' };
        return icons[type] || '📁';
    }

    billCurrency(bill) {
        return recordCurrency(bill, this.accounts);
    }

    formatCurrency(amount, currency) {
        return formatMoney(amount, currency);
    }

    formatDateDisplay(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
        
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    getNextDueDate(currentDateStr, freq) {
        return getNextBillDueDate(currentDateStr, freq);
    }

    async getBillCategoryId(billName) {
        return resolveBillCategoryId(billName);
    }

    convertToCSV(bills) {
        const headers = ['Name', 'Amount', 'Due Date', 'Status', 'Recurring', 'Account'];
        const rows = bills.map(bill => [
            bill.name,
            bill.amount,
            bill.dueDate,
            bill.paid ? 'Paid' : 'Unpaid',
            bill.recurring || 'One-time',
            this.accounts.find(a => a.id === bill.accountId)?.name || 'Not set'
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
    }
}

export async function initBillsUI() {
    const manager = new BillsManager();
    await manager.init();
}