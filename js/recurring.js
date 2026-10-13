import { addItem, deleteItem, getAllItems, updateItem, STORE_NAMES, generateId } from './db.js';
import { escapeHtml } from './sanitize.js';
import { calculatePaymentAmount } from './loanCalculations.js';
import { processAllRecurring } from './recurringJob.js';

import { formatMoney, getBaseCurrency, recordCurrency, toBase } from './utils/currency.js';
// Bug fix: a new document-level click listener used to be attached every time
// init() ran, stacking duplicate listeners. Now we attach exactly one and
// delegate to whichever instance is active.
let activeRecurringManager = null;
let recurringDelegatedListenerAttached = false;

function attachRecurringDelegatedListener() {
    if (recurringDelegatedListenerAttached) return;
    recurringDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button || !activeRecurringManager) return;
        activeRecurringManager.handleRecurringAction(button.dataset.action, button.dataset.id);
    });
}

// Shows/hides the "Always pay the loan's current minimum" checkbox (only
// relevant once a loan is linked), and relaxes the Amount field's
// required-ness while that checkbox is on, since Amount becomes an
// optional extra-repayment floor rather than the exact figure charged.
function toggleAutoMinimumUI(loanLinked) {
    const group = document.getElementById('autoMinimumGroup');
    const amountField = document.getElementById('recurringAmount');
    const autoMinField = document.getElementById('recurringAutoMinimum');
    if (group) group.style.display = loanLinked ? 'block' : 'none';
    if (!loanLinked && autoMinField) autoMinField.checked = false;
    if (amountField) amountField.required = !(autoMinField && autoMinField.checked);
    if (autoMinField && !autoMinField._wired) {
        autoMinField._wired = true;
        autoMinField.addEventListener('change', () => {
            if (amountField) amountField.required = !autoMinField.checked;
        });
    }
}

export class RecurringManager {
    constructor() {
        this.recurring = [];
        this.accounts = [];
        this.categories = [];
        this.mainCategories = [];
        this.subCategories = [];
        this.loans = [];
    }

    async init() {
        await this.loadData();
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        const [recurring, accounts, categories, loans] = await Promise.all([
            getAllItems(STORE_NAMES.recurringTransactions),
            getAllItems(STORE_NAMES.accounts),
            getAllItems(STORE_NAMES.categories),
            getAllItems(STORE_NAMES.loans).catch(() => [])
        ]);

        this.recurring = recurring;
        this.accounts = accounts;
        this.categories = categories;
        this.loans = loans;
        this.mainCategories = categories.filter(c => !c.parentId);
        this.subCategories = categories.filter(c => c.parentId);
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');
        
        mainContent.innerHTML = `
            <div class="recurring-container">
                <div class="recurring-header">
                    <h2>🔄 Recurring Transactions</h2>
                </div>

                ${this.renderStatsCards()}

                ${this.renderHorizontalQuickActions()}

                <div class="recurring-content">
                    ${this.recurring.length === 0 ? this.renderEmptyState() : this.renderRecurringTable()}
                </div>

                ${this.renderRecurringModal()}
            </div>
        `;
    }

    renderStatsCards() {
        const stats = this.calculateStats();
        
        return `
            <div class="stats-cards page-compact-cards">
                <div class="stat-card info">
                    <div class="stat-icon">🔄</div>
                    <div class="stat-content">
                        <div class="stat-value">${stats.activeCount}</div>
                        <div class="stat-label">Active</div>
                        <div class="stat-subtext">${stats.incomeCount} income, ${stats.expenseCount} expense</div>
                    </div>
                </div>
                <div class="stat-card ${stats.netMonthly >= 0 ? 'positive' : 'negative'}">
                    <div class="stat-icon">💰</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.formatCurrency(Math.abs(stats.netMonthly))}</div>
                        <div class="stat-label">Net Monthly</div>
                        <div class="stat-subtext">${stats.netMonthly >= 0 ? 'Surplus' : 'Deficit'}</div>
                    </div>
                </div>
                <div class="stat-card secondary">
                    <div class="stat-icon">📊</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.formatCurrency(stats.totalMonthly)}</div>
                        <div class="stat-label">Monthly Total</div>
                        <div class="stat-subtext">All transactions</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderHorizontalQuickActions() {
        return `
            <div class="horizontal-quick-actions">
                <div class="quick-action-item primary" id="quickAddRecurring">
                    <span class="quick-action-icon">➕</span>
                    <span class="quick-action-text">Add Recurring</span>
                </div>
                
                <div class="quick-action-item success" id="quickAddIncome">
                    <span class="quick-action-icon">📥</span>
                    <span class="quick-action-text">Add Income</span>
                </div>
                
                <div class="quick-action-item warning" id="quickAddExpense">
                    <span class="quick-action-icon">📤</span>
                    <span class="quick-action-text">Add Expense</span>
                </div>
                
                <div class="quick-action-item secondary" id="quickSimulate">
                    <span class="quick-action-icon">🔮</span>
                    <span class="quick-action-text">Simulate</span>
                </div>

                <div class="quick-action-item info" id="quickRunCatchUp">
                    <span class="quick-action-icon">⏩</span>
                    <span class="quick-action-text">Run Catch-Up Now</span>
                </div>
            </div>
        `;
    }

    renderRecurringTable() {
        return `
            <div class="section-card">
                <div class="table-header">
                    <h3>Active Recurring Transactions</h3>
                    <div class="table-controls">
                        <span class="table-count">${this.recurring.length} recurring</span>
                        <select id="filterRecurring" class="form-select">
                            <option value="all">All Types</option>
                            <option value="income">Income Only</option>
                            <option value="expense">Expenses Only</option>
                        </select>
                    </div>
                </div>
                
                <div class="recurring-list">
                    ${this.recurring.map(rec => this.renderRecurringRow(rec)).join('')}
                </div>
            </div>
        `;
    }

    renderRecurringRow(rec) {
        const account = this.accounts.find(a => a.id === rec.accountId);
        const category = this.categories.find(c => c.id === rec.categoryId);
        const mainCategory = category?.parentId ? 
            this.categories.find(c => c.id === category.parentId) : category;

        const frequencyIcons = {
            weekly: '📅',
            fortnightly: '📆',
            monthly: '🗓️',
            quarterly: '📊',
            halfyearly: '🌗',
            annually: '🎯'
        };

        const typeIcons = {
            income: '📥',
            expense: '📤'
        };

        return `
            <div class="recurring-row ${rec.type}" data-rec-id="${rec.id}">
                <div class="recurring-main">
                    <div class="recurring-icon">${mainCategory?.icon || typeIcons[rec.type]}</div>
                    <div class="recurring-details">
                        <div class="recurring-name">${escapeHtml(rec.name)}</div>
                        <div class="recurring-meta">
                            <span class="recurring-type ${rec.type}">
                                ${typeIcons[rec.type]} ${rec.type === 'income' ? 'Income' : 'Expense'}
                            </span>
                            <span class="recurring-frequency">
                                ${frequencyIcons[rec.frequency]} ${rec.frequency}
                            </span>
                            ${account ? `
                                <span class="recurring-account">
                                    ${this.getAccountIcon(account.type)} ${escapeHtml(account.name)}
                                </span>
                            ` : ''}
                            ${rec.loanId ? `
                                <span class="recurring-loan-tag">🏦 ${escapeHtml(this.loans.find(l => l.id === rec.loanId)?.name || 'Loan')}</span>
                            ` : ''}
                        </div>
                        ${category ? `
                            <div class="recurring-category">
                                ${category.icon || '📁'} ${escapeHtml(category.name)}
                            </div>
                        ` : ''}
                    </div>
                    <div class="recurring-amount ${rec.type}">
                        ${rec.type === 'income' ? '+' : '-'}${this.formatCurrency(rec.amount, recordCurrency(rec, this.accounts))}
                    </div>
                </div>
                <div class="recurring-next">
                    <span class="next-date">Next: ${this.formatDateDisplay(this.getNextScheduledDate(rec))}</span>
                    ${this.countOverduePeriods(rec) > 0 ? `
                        <span class="next-date-overdue">${this.countOverduePeriods(rec)} overdue — will catch up automatically</span>
                    ` : ''}
                </div>
                <div class="recurring-actions">
                    <button class="btn-action edit" data-action="edit" data-id="${rec.id}" title="Edit">
                        ✏️ Edit
                    </button>
                    <button class="btn-action delete" data-action="delete" data-id="${rec.id}" title="Delete">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
    }

    renderRecurringModal() {
        return `
            <div id="recurringModal" class="modal-overlay" style="display: none;">
                <div class="modal">
                    <div class="modal-header">
                        <h3 id="modalTitle">Add Recurring Transaction</h3>
                        <button class="btn-close" id="closeModal">✕</button>
                    </div>
                    <form id="recurringForm" class="modal-form">
                        <input type="hidden" id="editRecurringId" value="">
                        
                        <div class="form-group">
                            <label>Transaction Name</label>
                            <input type="text" id="recurringName" class="form-input" placeholder="e.g., Salary, Netflix, Rent" required>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Type</label>
                                <select id="recurringType" class="form-select" required>
                                    <option value="expense">📤 Expense</option>
                                    <option value="income">📥 Income</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label id="recurringAmountLabel">Amount</label>
                                <input type="number" id="recurringAmount" class="form-input" step="0.01" placeholder="0.00" required>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Frequency</label>
                                <select id="recurringFrequency" class="form-select" required>
                                    <option value="weekly">📅 Weekly</option>
                                    <option value="fortnightly">📆 Fortnightly</option>
                                    <option value="monthly" selected>🗓️ Monthly</option>
                                    <option value="quarterly">📊 Quarterly</option>
                                    <option value="halfyearly">🌗 Half-Yearly</option>
                                    <option value="annually">🎯 Annually</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Start Date</label>
                                <input type="date" id="recurringStartDate" class="form-input" required>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Account</label>
                                <select id="recurringAccount" class="form-select" required>
                                    <option value="">Select Account</option>
                                    ${this.accounts.map(acc => `
                                        <option value="${acc.id}">${this.getAccountIcon(acc.type)} ${escapeHtml(acc.name)}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Main Category</label>
                                <select id="recurringMainCategory" class="form-select" required>
                                    <option value="">Select Category</option>
                                    ${this.mainCategories.map(cat => `
                                        <option value="${cat.id}">${cat.icon || '📁'} ${escapeHtml(cat.name)}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Subcategory</label>
                            <select id="recurringSubCategory" class="form-select">
                                <option value="">-- None --</option>
                            </select>
                        </div>

                        ${this.loans.length > 0 ? `
                        <div class="form-group">
                            <label>Link to Loan (optional)</label>
                            <select id="recurringLoan" class="form-select">
                                <option value="">-- Not a loan repayment --</option>
                                ${this.loans.map(loan => `
                                    <option value="${loan.id}">🏦 ${escapeHtml(loan.name)}</option>
                                `).join('')}
                            </select>
                            <small class="form-hint">
                                For a real loan repayment (e.g. a direct debit from your offset
                                account). When set, each payment properly splits principal vs
                                interest and reduces the loan's own balance — not just the
                                account it's paid from — the same way the Loans page's "Make
                                Payment" button does. Account above is used as the account the
                                payment comes from.
                            </small>
                        </div>
                        <div class="form-group" id="autoMinimumGroup" style="display:none;">
                            <label style="display:flex;align-items:center;gap:0.5rem;">
                                <input type="checkbox" id="recurringAutoMinimum">
                                Always pay the loan's current minimum
                            </label>
                            <small class="form-hint">
                                Recalculates the real minimum each time this runs — that period's
                                interest for an interest-only loan (offset-adjusted if this loan
                                has a linked offset account), or the current P&amp;I amount for a
                                principal &amp; interest loan — instead of reusing the Amount
                                below forever. This matches how your bank recalculates it, rather
                                than charging whatever figure was true the day you set this up.
                                Amount above becomes optional: leave it at 0 to always pay exactly
                                the minimum, or set it to pay extra on top of the minimum each time.
                            </small>
                        </div>
                        ` : ''}

                        <div class="form-group">
                            <label>Already recorded up to (optional)</label>
                            <input type="date" id="recurringCatchUpFrom" class="form-input">
                            <small class="form-hint">
                                If the start date above is in the past, missed payments between
                                it and today are automatically caught up and added next time the
                                app runs. If some of those payments already exist — e.g. you've
                                imported past bank transactions that cover this — set this to the
                                date you're already covered up to, so it only backfills from there
                                forward instead of duplicating them. Leave blank to backfill
                                everything since the start date.
                            </small>
                        </div>
                        
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">💾 Save</button>
                            <button type="button" class="btn btn-secondary" id="cancelRecurring">Cancel</button>
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
                    <div class="empty-icon">🔄</div>
                    <h3>No Recurring Transactions</h3>
                    <p>Set up recurring transactions to automate your income and expenses tracking.</p>
                    <button class="btn btn-primary" id="emptyAddRecurring">Add Your First Recurring Transaction</button>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Quick actions
        document.getElementById('quickAddRecurring')?.addEventListener('click', () => this.openRecurringForm());
        document.getElementById('quickAddIncome')?.addEventListener('click', () => this.openRecurringForm('income'));
        document.getElementById('quickAddExpense')?.addEventListener('click', () => this.openRecurringForm('expense'));
        document.getElementById('quickSimulate')?.addEventListener('click', () => this.simulateRecurring());
        document.getElementById('quickRunCatchUp')?.addEventListener('click', () => this.runCatchUpNow());
        document.getElementById('emptyAddRecurring')?.addEventListener('click', () => this.openRecurringForm());

        // Filtering
        document.getElementById('filterRecurring')?.addEventListener('change', (e) => {
            this.filterRecurring(e.target.value);
        });

        // Recurring actions
        activeRecurringManager = this;
        attachRecurringDelegatedListener();

        // Modal events
        this.setupModalEvents();
    }

    handleRecurringAction(action, recId) {
        const rec = this.recurring.find(r => r.id === recId);
        if (!rec) return;

        switch (action) {
            case 'edit':
                this.openRecurringForm(null, rec);
                break;
            case 'delete':
                this.deleteRecurring(rec);
                break;
        }
    }

    setupModalEvents() {
        const modal = document.getElementById('recurringModal');
        const form = document.getElementById('recurringForm');
        const closeBtn = document.getElementById('closeModal');
        const cancelBtn = document.getElementById('cancelRecurring');
        const mainSelect = document.getElementById('recurringMainCategory');
        const subSelect = document.getElementById('recurringSubCategory');

        // Category linking
        mainSelect?.addEventListener('change', () => {
            const parentId = mainSelect.value;
            const filteredSubs = this.subCategories.filter(s => s.parentId === parentId);
            subSelect.innerHTML = `<option value="">-- None --</option>` +
                filteredSubs.map(s => `<option value="${s.id}">${s.icon || '📄'} ${escapeHtml(s.name)}</option>`).join('');
        });

        // Open/close modal
        [closeBtn, cancelBtn].forEach(btn => {
            btn?.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        });

        // Form submission
        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveRecurring();
            modal.style.display = 'none';
        });

        // Close modal on backdrop click
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    // Core functionality methods
    async deleteRecurring(rec) {
        if (!confirm(`Delete recurring "${rec.name}"?`)) return;
        
        await deleteItem(STORE_NAMES.recurringTransactions, rec.id);
        await this.init(); // Refresh UI
    }

    openRecurringForm(type = null, rec = null) {
        const modal = document.getElementById('recurringModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('recurringForm');
        const mainSelect = document.getElementById('recurringMainCategory');
        const subSelect = document.getElementById('recurringSubCategory');

        if (rec) {
            // Edit mode
            title.textContent = 'Edit Recurring Transaction';
            document.getElementById('editRecurringId').value = rec.id;
            document.getElementById('recurringName').value = rec.name;
            document.getElementById('recurringType').value = rec.type;
            document.getElementById('recurringAmount').value = rec.amount;
            document.getElementById('recurringFrequency').value = rec.frequency;
            document.getElementById('recurringStartDate').value = rec.startDate;
            document.getElementById('recurringCatchUpFrom').value = rec.catchUpFrom || '';
            document.getElementById('recurringAccount').value = rec.accountId;
            const loanField = document.getElementById('recurringLoan');
            if (loanField) loanField.value = rec.loanId || '';
            const autoMinField = document.getElementById('recurringAutoMinimum');
            if (autoMinField) autoMinField.checked = !!rec.autoMinimum;
            toggleAutoMinimumUI(!!rec.loanId);

            // Set categories
            const category = this.categories.find(c => c.id === rec.categoryId);
            const mainCategoryId = category?.parentId || rec.categoryId;
            mainSelect.value = mainCategoryId;
            mainSelect.dispatchEvent(new Event('change'));
            
            setTimeout(() => {
                if (category?.parentId) {
                    subSelect.value = rec.categoryId;
                }
            }, 100);
        } else {
            // Add mode
            title.textContent = 'Add Recurring Transaction';
            form.reset();
            document.getElementById('editRecurringId').value = '';
            document.getElementById('recurringStartDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('recurringCatchUpFrom').value = '';
            
            if (type) {
                document.getElementById('recurringType').value = type;
            }
            toggleAutoMinimumUI(false);
        }

        const loanSelect = document.getElementById('recurringLoan');
        if (loanSelect) {
            loanSelect.onchange = async () => {
                if (!loanSelect.value) {
                    toggleAutoMinimumUI(false);
                    return;
                }
                // Bug fix: this used to read from this.loans, a snapshot
                // fetched once when the Recurring page first loaded. If a
                // loan's currentBalance changed since then (a payment
                // logged, a balance correction on the Loans page, all in
                // the same session), the amortization math here was
                // silently run against the stale old balance, disagreeing
                // with the always-fresh figure shown on the loan's
                // amortization schedule. Re-fetch the loans fresh from the
                // DB so this always matches the current balance.
                const loans = await getAllItems(STORE_NAMES.loans).catch(() => this.loans);
                this.loans = loans;
                const loan = loans.find(l => l.id === loanSelect.value);
                if (!loan) return;
                // Pre-fill the amount with the loan's actual calculated
                // payment for ITS OWN frequency (correctly interest-only
                // during an interest-only window — see
                // calculatePaymentAmount in loanCalculations.js), and
                // match the recurring entry's frequency to the loan's so
                // they stay in sync — both remain editable if you want to
                // pay something different (e.g. rounding up, or extra
                // repayments).
                document.getElementById('recurringAmount').value = calculatePaymentAmount(loan).toFixed(2);
                document.getElementById('recurringFrequency').value = loan.paymentFrequency || 'monthly';
                document.getElementById('recurringType').value = 'expense';
                toggleAutoMinimumUI(true);

                // Auto-select this loan's linked offset account as the
                // paying account, since that's overwhelmingly the real
                // source for a loan repayment set up this way — still
                // editable if it's actually paid from somewhere else.
                if (loan.linkedOffsetId) {
                    const accountSelect = document.getElementById('recurringAccount');
                    const hasOption = accountSelect && Array.from(accountSelect.options).some(o => o.value === loan.linkedOffsetId);
                    if (accountSelect && hasOption) {
                        accountSelect.value = loan.linkedOffsetId;
                    }
                }
            };
        }

        this.updateRecurringAmountLabel();
        const acctSel = document.getElementById('recurringAccount');
        if (acctSel && !acctSel.dataset.fxWired) {
            acctSel.dataset.fxWired = '1';
            acctSel.addEventListener('change', () => this.updateRecurringAmountLabel());
        }

        modal.style.display = 'flex';
    }

    // The amount is in the payment account's currency; say so on the form.
    updateRecurringAmountLabel() {
        const label = document.getElementById('recurringAmountLabel');
        if (!label) return;
        const accountId = document.getElementById('recurringAccount')?.value;
        const code = recordCurrency({ accountId }, this.accounts);
        label.textContent = accountId && code !== getBaseCurrency() ? `Amount (${code})` : 'Amount';
    }

    async saveRecurring() {
        const form = document.getElementById('recurringForm');
        const recId = document.getElementById('editRecurringId').value;
        const subCategoryId = document.getElementById('recurringSubCategory').value;
        const mainCategoryId = document.getElementById('recurringMainCategory').value;
        const categoryId = subCategoryId || mainCategoryId;

        if (!categoryId) {
            alert('Please select a category.');
            return;
        }

        const recData = {
            name: document.getElementById('recurringName').value,
            type: document.getElementById('recurringType').value,
            amount: parseFloat(document.getElementById('recurringAmount').value) || 0,
            frequency: document.getElementById('recurringFrequency').value,
            startDate: document.getElementById('recurringStartDate').value,
            catchUpFrom: document.getElementById('recurringCatchUpFrom').value || '',
            accountId: document.getElementById('recurringAccount').value,
            categoryId: categoryId,
            loanId: document.getElementById('recurringLoan')?.value || '',
            autoMinimum: document.getElementById('recurringAutoMinimum')?.checked || false
        };

        if (recId) {
            // Update existing
            recData.id = recId;
            await updateItem(STORE_NAMES.recurringTransactions, recData);
        } else {
            // Add new
            recData.id = generateId();
            await addItem(STORE_NAMES.recurringTransactions, recData);
        }

        await this.init(); // Refresh UI
    }

    filterRecurring(filter) {
        let filteredRecurring = this.recurring;
        
        if (filter === 'income') {
            filteredRecurring = this.recurring.filter(r => r.type === 'income');
        } else if (filter === 'expense') {
            filteredRecurring = this.recurring.filter(r => r.type === 'expense');
        }

        this.renderFilteredRecurring(filteredRecurring, filter);
    }

    renderFilteredRecurring(filteredRecurring, filter) {
        const recurringContent = document.querySelector('.recurring-content');
        const filterText = filter === 'all' ? 'All' : filter === 'income' ? 'Income' : 'Expenses';
        
        recurringContent.innerHTML = `
            <div class="section-card">
                <div class="table-header">
                    <h3>${filterText} Recurring Transactions (${filteredRecurring.length})</h3>
                    <button class="btn btn-secondary" id="clearFilter">Show All</button>
                </div>
                <div class="recurring-list">
                    ${filteredRecurring.map(rec => this.renderRecurringRow(rec)).join('')}
                </div>
            </div>
        `;

        document.getElementById('clearFilter')?.addEventListener('click', () => {
            this.renderUI();
        });
    }

    async runCatchUpNow() {
        const button = document.getElementById('quickRunCatchUp');
        if (button) button.style.pointerEvents = 'none';

        try {
            const result = await processAllRecurring();

            const recSummary = result.details?.recurringTransactions;
            const billSummary = result.details?.dueBills;
            const recCount = recSummary?.processed || 0;
            const billCount = billSummary?.processed || 0;

            let message;
            if (recCount === 0 && billCount === 0 && result.errors.length === 0) {
                message = '✅ Nothing to catch up — everything is already up to date.';
            } else {
                message = `✅ Catch-up complete.\n\n` +
                    `Recurring transactions created: ${recCount}\n` +
                    `Bills paid: ${billCount}`;
                if (result.errors.length > 0) {
                    message += `\n\n⚠️ ${result.errors.length} error(s):\n` + result.errors.join('\n');
                }
            }
            alert(message);

            await this.init(); // Refresh so "Next" dates and overdue counts reflect the run
        } catch (error) {
            alert('❌ Catch-up failed: ' + error.message);
        } finally {
            if (button) button.style.pointerEvents = '';
        }
    }

    simulateRecurring() {        const monthlyImpact = this.calculateStats().netMonthly;
        const impactType = monthlyImpact >= 0 ? 'positive' : 'negative';
        const impactText = monthlyImpact >= 0 ? 'surplus' : 'deficit';
        
        alert(`💰 Monthly Impact Simulation:\n\nNet Monthly: ${this.formatCurrency(Math.abs(monthlyImpact))} ${impactText}\n\nThis is your projected monthly cash flow from all recurring transactions.`);
    }

    // Helper methods
    calculateStats() {
        const incomeRecurring = this.recurring.filter(r => r.type === 'income');
        const expenseRecurring = this.recurring.filter(r => r.type === 'expense');
        
        const monthlyIncome = incomeRecurring.reduce((sum, r) => {
            const multiplier = r.frequency === 'weekly' ? 4.33 : r.frequency === 'annually' ? 1/12 : 1;
            return sum + (toBase(r.amount, recordCurrency(r, this.accounts)) * multiplier);
        }, 0);

        const monthlyExpense = expenseRecurring.reduce((sum, r) => {
            const multiplier = r.frequency === 'weekly' ? 4.33 : r.frequency === 'annually' ? 1/12 : 1;
            return sum + (toBase(r.amount, recordCurrency(r, this.accounts)) * multiplier);
        }, 0);

        return {
            activeCount: this.recurring.length,
            incomeCount: incomeRecurring.length,
            expenseCount: expenseRecurring.length,
            netMonthly: monthlyIncome - monthlyExpense,
            totalMonthly: monthlyIncome + monthlyExpense
        };
    }

    getAccountIcon(type) {
        const icons = {
            bank: '🏦', credit: '💳', cash: '💵', savings: '💰',
            investment: '📈', offset: '⚖️', loan: '🏠'
        };
        return icons[type] || '📁';
    }

    formatCurrency(amount, currency) {
        return formatMoney(amount, currency);
    }

    // Mirrors the advance-by-one-period logic in recurringJob.js so the
    // dates shown here match what the catch-up job will actually do.
    advanceDate(date, freq) {
        switch (freq) {
            case 'weekly': date.setDate(date.getDate() + 7); break;
            case 'fortnightly': date.setDate(date.getDate() + 14); break;
            case 'monthly': date.setMonth(date.getMonth() + 1); break;
            case 'quarterly': date.setMonth(date.getMonth() + 3); break;
            case 'halfyearly': date.setMonth(date.getMonth() + 6); break;
            case 'annually': date.setFullYear(date.getFullYear() + 1); break;
            default: date.setMonth(date.getMonth() + 1);
        }
    }

    // Every scheduled date from this entry's anchor point up to (and
    // including the first one past) today — same schedule the recurring
    // job's catch-up run will use.
    schedulePeriods(rec) {
        const today = new Date();
        const anchor = rec.lastProcessed || rec.catchUpFrom || rec.startDate;
        const dates = [];
        let cursor = new Date(anchor);
        if (!rec.lastProcessed && !rec.catchUpFrom) {
            dates.push(new Date(cursor));
        }
        for (let i = 0; i < 1000; i++) {
            const next = new Date(cursor);
            this.advanceDate(next, rec.frequency);
            dates.push(next);
            cursor = next;
            if (next > today) break;
        }
        return dates;
    }

    getNextScheduledDate(rec) {
        const periods = this.schedulePeriods(rec);
        const today = new Date();
        return (periods.find(d => d > today) || periods[periods.length - 1]).toISOString().slice(0, 10);
    }

    countOverduePeriods(rec) {
        const today = new Date();
        return this.schedulePeriods(rec).filter(d => d <= today).length;
    }

    formatDateDisplay(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
    }
}

// Backwards compatibility
export async function initRecurringUI() {
    const manager = new RecurringManager();
    await manager.init();
}