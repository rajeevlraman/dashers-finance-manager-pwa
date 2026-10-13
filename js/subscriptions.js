// js/subscriptions.js
//
// Subscription Tracker — a lighter-weight cousin of Recurring/Bills for
// personal subscriptions (Netflix, Adobe, Spotify, ...): a name, a free-text
// category, a billing day of month, a monthly cost, and an active/inactive
// status. Deliberately its own store (STORE_NAMES.subscriptions) rather than
// reusing recurringTransactions — that store's categories/accounts are the
// property-expense taxonomy and don't fit "Streaming"/"Software"/"Music",
// and recurring items don't have an active/inactive concept at all.

import { addItem, deleteItem, getAllItems, updateItem, STORE_NAMES, generateId } from './db.js';
import { escapeHtml } from './sanitize.js';

import { formatMoney, toBaseTransactions } from './utils/currency.js';
// Same delegated-listener pattern as calendar.js/recurring.js: one listener
// attached once, not re-stacked on every init().
let activeSubscriptionsManager = null;
let subsDelegatedListenerAttached = false;

function attachSubsDelegatedListener() {
    if (subsDelegatedListenerAttached) return;
    subsDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-sub-action]');
        if (!button || !activeSubscriptionsManager) return;
        activeSubscriptionsManager.handleAction(button.dataset.subAction, button.dataset.id);
    });
}

function formatCurrency(n) {
    return formatMoney(n);
}

function ordinalDay(day) {
    const d = Number(day);
    if (!d) return '';
    const suffix = (d % 10 === 1 && d !== 11) ? 'st'
        : (d % 10 === 2 && d !== 12) ? 'nd'
        : (d % 10 === 3 && d !== 13) ? 'rd' : 'th';
    return `Day ${d}${suffix}`;
}

// --- Detect recurring charges in Transactions that look like subscriptions ---
//
// A "subscription-shaped" group of transactions is: the same merchant (or,
// failing that, the same cleaned description), tagged as an expense and not
// a transfer, appearing in at least 3 distinct months with a fairly steady
// amount each time. That's deliberately stricter than Bills/Recurring's own
// detection — a one-off "Woolworths" charge repeating by coincidence isn't a
// subscription, but Netflix charging $23.00 in three separate months is.
const MIN_OCCURRENCES = 3;          // distinct months for an ordinary merchant
const MIN_OCCURRENCES_SUB_CATEGORY = 2; // ...when the category itself says "subscription/streaming"
const AMOUNT_TOLERANCE = 0.15;      // 15% spread between charges in the current price run
const SUB_CATEGORY_RE = /subscri|streaming/i;

// Bank text for the same service differs by month and by channel:
// "Disney Plus (via PayPal)", "PAYPAL *DISNEYPLUS 4029357733", "DISNEY PLUS".
// Reduce all of those to one stable key ("disney plus").
export function normaliseMerchantKey(raw) {
    let s = String(raw || '').toLowerCase();
    s = s.replace(/\([^)]*\)/g, ' ');                        // "(via paypal)", "(monthly)"
    s = s.replace(/\b(via|thru|through)\s+paypal\b/g, ' ');
    s = s.replace(/\bpaypal\b\s*\*?/g, ' ').replace(/\bpp\s*\*/g, ' ');
    s = s.replace(/\b(visa|eftpos|card|purchase|payment|recurring|direct debit|dd)\b/g, ' ');
    s = s.replace(/\bwww\.|\.(com|com\.au|au|net|tv)\b/g, ' ');
    s = s.replace(/[*#_\/\\.,:;'"-]/g, ' ');
    s = s.replace(/\b\d[\w]*\b/g, ' ');                     // reference numbers, card digits, dates
    s = s.replace(/\b(au|aus|nsw|vic|qld|wa|sa|tas|nt|act)\b/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

function subscriptionKeyFor(tx) {
    const raw = (tx.merchant && tx.merchant.trim()) || (tx.description && tx.description.trim()) || '';
    return normaliseMerchantKey(raw);
}

function titleCase(s) {
    return s.replace(/\b\w/g, c => c.toUpperCase());
}

function categoryLooksLikeSubscription(cat, categoryById) {
    if (!cat) return false;
    const parent = cat.parentId ? categoryById.get(cat.parentId) : null;
    return SUB_CATEGORY_RE.test(cat.name || '') || SUB_CATEGORY_RE.test(parent?.name || '');
}

// Latest run of charges (newest first) that sit within AMOUNT_TOLERANCE of the
// newest charge. Earlier charges at an old price (a price rise) end the run
// instead of disqualifying the whole merchant.
function currentPriceRun(sortedNewestFirst) {
    const latest = Math.abs(sortedNewestFirst[0].amount);
    if (!latest) return [];
    const run = [];
    for (const t of sortedNewestFirst) {
        const amt = Math.abs(t.amount);
        if (Math.abs(amt - latest) / latest <= AMOUNT_TOLERANCE) run.push(t);
        else break;
    }
    return run;
}

export function detectSubscriptionCandidates(transactions, categories, existingSubscriptions) {
    const existingNames = new Set(
        existingSubscriptions.map(s => normaliseMerchantKey(s.name)).filter(Boolean)
    );
    const categoryById = new Map(categories.map(c => [c.id, c]));

    const groups = new Map(); // key -> [tx]
    transactions
        .filter(t => t.type === 'expense' && !t.isTransfer && t.date)
        .forEach(t => {
            const key = subscriptionKeyFor(t);
            if (!key) return;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t);
        });

    const candidates = [];
    for (const [key, txs] of groups.entries()) {
        if (existingNames.has(key)) continue; // already tracked

        const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));
        const run = currentPriceRun(sorted);
        if (!run.length) continue;

        const latest = sorted[0];
        const cat = categoryById.get(latest.categoryId);
        const needed = categoryLooksLikeSubscription(cat, categoryById)
            ? MIN_OCCURRENCES_SUB_CATEGORY : MIN_OCCURRENCES;

        const monthsSeen = new Set(run.map(t => t.date.slice(0, 7)));
        if (monthsSeen.size < needed) continue;

        // The current price is what the next charge will be, so use the latest
        // charge rather than an average dragged down by older, cheaper ones.
        const currentAmount = Math.abs(latest.amount);
        const billingDay = Number(latest.date.slice(8, 10)) || new Date(latest.date).getDate();

        candidates.push({
            key,
            name: titleCase(key),
            category: cat?.name || '',
            amount: Math.round(currentAmount * 100) / 100,
            billingDay,
            occurrences: monthsSeen.size,
            lastDate: latest.date
        });
    }

    // Most-frequently-seen first, so the clearest subscriptions surface first.
    candidates.sort((a, b) => b.occurrences - a.occurrences || b.lastDate.localeCompare(a.lastDate));
    return candidates;
}

export class SubscriptionsManager {
    constructor() {
        this.subscriptions = [];
        this.candidates = [];
        this.dismissedKeys = new Set(); // session-only: cleared on page reload
        this.showCandidates = false;
    }

    async init() {
        await this.loadData();
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        this.subscriptions = await getAllItems(STORE_NAMES.subscriptions);
        this.subscriptions.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    async detectCandidates() {
        const [rawTransactions, categories, accounts] = await Promise.all([
            getAllItems(STORE_NAMES.transactions),
            getAllItems(STORE_NAMES.categories),
            getAllItems(STORE_NAMES.accounts).catch(() => [])
        ]);
        // Subscriptions are tracked in the base currency, so compare and
        // total transactions from foreign-currency accounts after converting.
        const transactions = toBaseTransactions(rawTransactions, accounts);
        this.candidates = detectSubscriptionCandidates(transactions, categories, this.subscriptions)
            .filter(c => !this.dismissedKeys.has(c.key));
    }

    getStats() {
        const active = this.subscriptions.filter(s => s.isActive !== false);
        const monthlyTotal = active.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
        const highest = active.reduce((max, s) => (parseFloat(s.amount) || 0) > (parseFloat(max?.amount) || 0) ? s : max, null);
        return {
            monthlyTotal,
            yearlyTotal: monthlyTotal * 12,
            activeCount: active.length,
            totalCount: this.subscriptions.length,
            highest
        };
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');
        const stats = this.getStats();

        mainContent.innerHTML = `
            <div class="subscriptions-container">
                <div class="page-header">
                    <h2>🔁 Subscription Tracker</h2>
                    <div class="page-actions">
                        <button class="btn btn-secondary" id="detectSubsBtn">🔍 Detect from Transactions</button>
                        <button class="btn btn-primary" id="addSubscriptionBtn">+ Add Subscription</button>
                    </div>
                </div>

                <div class="calendar-stats page-compact-cards">
                    <div class="stat-card primary">
                        <div class="stat-icon">🔁</div>
                        <div class="stat-content">
                            <div class="stat-value">${formatCurrency(stats.monthlyTotal)}</div>
                            <div class="stat-label">Monthly Total</div>
                        </div>
                    </div>
                    <div class="stat-card info">
                        <div class="stat-icon">📅</div>
                        <div class="stat-content">
                            <div class="stat-value">${formatCurrency(stats.yearlyTotal)}</div>
                            <div class="stat-label">Yearly Total — projected spend</div>
                        </div>
                    </div>
                    <div class="stat-card success">
                        <div class="stat-icon">✅</div>
                        <div class="stat-content">
                            <div class="stat-value">${stats.activeCount}</div>
                            <div class="stat-label">Active — ${stats.totalCount} total</div>
                        </div>
                    </div>
                    <div class="stat-card warning">
                        <div class="stat-icon">⚠️</div>
                        <div class="stat-content">
                            <div class="stat-value">${stats.highest ? formatCurrency(stats.highest.amount) : '—'}</div>
                            <div class="stat-label">Highest Cost${stats.highest ? ' — ' + escapeHtml(stats.highest.name) : ''}</div>
                        </div>
                    </div>
                </div>

                <div id="subscriptionCandidatesWrap">${this.showCandidates ? this.renderCandidates() : ''}</div>

                <div id="subscriptionFormWrap"></div>

                <div class="section-card">
                    <h3 style="margin-bottom: 1rem;">Your subscriptions</h3>
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Bills on</th>
                                    <th>Monthly</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>${this.renderRows()}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    renderRows() {
        if (this.subscriptions.length === 0) {
            return `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No subscriptions yet — add your first one above.</td></tr>`;
        }

        return this.subscriptions.map(s => `
            <tr>
                <td>${escapeHtml(s.name)}</td>
                <td><span class="source-badge source-transaction">${escapeHtml(s.category || 'Other')}</span></td>
                <td>${ordinalDay(s.billingDay)}</td>
                <td class="amount">${formatCurrency(s.amount)}</td>
                <td>
                    <span class="badge-status ${s.isActive !== false ? 'status-active' : 'status-inactive'}"
                          data-sub-action="toggle-status" data-id="${s.id}" style="cursor:pointer;">
                        ${s.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <button class="btn-icon" data-sub-action="edit" data-id="${s.id}" title="Edit">✏️</button>
                    <button class="btn-icon" data-sub-action="delete" data-id="${s.id}" title="Delete">🗑️</button>
                </td>
            </tr>
        `).join('');
    }

    renderCandidates() {
        if (this.candidates.length === 0) {
            return `
                <div class="section-card" id="subscriptionCandidates">
                    <h3 style="margin-bottom: 0.5rem;">🔍 Found in your transactions</h3>
                    <p class="no-data">No new subscription-shaped charges found — anything already tracked below is excluded, and a charge needs to repeat with a steady amount across at least 3 different months to show up here.</p>
                </div>
            `;
        }
        return `
            <div class="section-card" id="subscriptionCandidates">
                <h3 style="margin-bottom: 0.5rem;">🔍 Found in your transactions</h3>
                <p class="no-data" style="margin-bottom: 1rem;">These charges repeated with a steady amount across ${MIN_OCCURRENCES}+ months. Review and add the ones that are real subscriptions.</p>
                <div class="recent-activity">
                    ${this.candidates.map(c => `
                        <div class="activity-item">
                            <span class="activity-icon">🔁</span>
                            <div class="activity-details">
                                <div class="activity-desc">${escapeHtml(c.name)}${c.category ? ` <span class="no-data" style="font-weight:normal;">(${escapeHtml(c.category)})</span>` : ''}</div>
                                <div class="activity-date">Seen ${c.occurrences} months · ~${ordinalDay(c.billingDay)} · last ${new Date(c.lastDate).toLocaleDateString()}</div>
                            </div>
                            <span class="activity-amount negative">${formatCurrency(c.amount)}</span>
                            <div style="display:flex; gap:0.4rem; margin-left:0.75rem;">
                                <button class="btn btn-primary btn-sm" data-sub-action="add-candidate" data-id="${escapeHtml(c.key)}">+ Add</button>
                                <button class="btn-icon" data-sub-action="dismiss-candidate" data-id="${escapeHtml(c.key)}" title="Not a subscription">✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderForm(existing = null) {
        const wrap = document.getElementById('subscriptionFormWrap');
        if (!wrap) return;

        if (!existing) { wrap.innerHTML = ''; return; }

        const isEdit = !!existing.id;
        wrap.innerHTML = `
            <div class="section-card" id="subscriptionForm">
                <h3>${isEdit ? 'Edit' : 'Add'} Subscription</h3>
                <form id="subForm">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="subName" class="form-input" required value="${existing.name ? escapeHtml(existing.name) : ''}" placeholder="e.g. Netflix">
                        </div>
                        <div class="form-group">
                            <label>Category</label>
                            <input type="text" id="subCategory" class="form-input" value="${existing.category ? escapeHtml(existing.category) : ''}" placeholder="e.g. Streaming">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Billing day of month</label>
                            <input type="number" id="subBillingDay" class="form-input" min="1" max="31" required value="${existing.billingDay || ''}">
                        </div>
                        <div class="form-group">
                            <label>Monthly amount</label>
                            <input type="number" id="subAmount" class="form-input" step="0.01" min="0" required value="${existing.amount || ''}">
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select id="subStatus" class="form-select">
                                <option value="active" ${existing.isActive !== false ? 'selected' : ''}>Active</option>
                                <option value="inactive" ${existing.isActive === false ? 'selected' : ''}>Inactive</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Subscription'}</button>
                        <button type="button" class="btn btn-secondary" id="cancelSubForm">Cancel</button>
                    </div>
                </form>
            </div>
        `;

        document.getElementById('subForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveSubscription(existing.id, {
                name: document.getElementById('subName').value.trim(),
                category: document.getElementById('subCategory').value.trim(),
                billingDay: parseInt(document.getElementById('subBillingDay').value, 10),
                amount: parseFloat(document.getElementById('subAmount').value),
                isActive: document.getElementById('subStatus').value === 'active'
            });
        });

        document.getElementById('cancelSubForm').addEventListener('click', () => this.renderForm(null));
        document.getElementById('subscriptionForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async saveSubscription(id, data) {
        if (!data.name || !data.billingDay || isNaN(data.amount)) {
            alert('Please fill in name, billing day, and amount.');
            return;
        }
        if (id) {
            await updateItem(STORE_NAMES.subscriptions, { id, ...data });
        } else {
            await addItem(STORE_NAMES.subscriptions, { id: generateId(), ...data });
        }
        await this.loadData();
        // Drop it from any still-visible candidate list now that it's tracked.
        this.candidates = this.candidates.filter(c =>
            !this.subscriptions.some(s => normaliseMerchantKey(s.name) === c.key)
        );
        this.renderUI();
    }

    async handleAction(action, id) {
        // Candidate actions are keyed by the detected merchant key, not a
        // stored subscription id — handle them before the subscription lookup.
        if (action === 'add-candidate') {
            const candidate = this.candidates.find(c => c.key === id);
            if (candidate) {
                this.renderForm({
                    name: candidate.name,
                    category: candidate.category,
                    billingDay: candidate.billingDay,
                    amount: candidate.amount,
                    isActive: true
                });
            }
            return;
        }
        if (action === 'dismiss-candidate') {
            this.dismissedKeys.add(id);
            this.candidates = this.candidates.filter(c => c.key !== id);
            const wrap = document.getElementById('subscriptionCandidatesWrap');
            if (wrap) wrap.innerHTML = this.renderCandidates();
            return;
        }

        const sub = this.subscriptions.find(s => s.id === id);
        if (!sub) return;

        switch (action) {
            case 'edit':
                this.renderForm(sub);
                break;
            case 'delete':
                if (confirm(`Delete ${sub.name}?`)) {
                    await deleteItem(STORE_NAMES.subscriptions, id);
                    await this.loadData();
                    this.renderUI();
                }
                break;
            case 'toggle-status':
                await updateItem(STORE_NAMES.subscriptions, { ...sub, isActive: sub.isActive === false });
                await this.loadData();
                this.renderUI();
                break;
        }
    }

    attachEventListeners() {
        activeSubscriptionsManager = this;
        attachSubsDelegatedListener();

        const addBtn = document.getElementById('addSubscriptionBtn');
        addBtn?.addEventListener('click', () => this.renderForm({}));

        const detectBtn = document.getElementById('detectSubsBtn');
        detectBtn?.addEventListener('click', async () => {
            detectBtn.disabled = true;
            detectBtn.textContent = 'Scanning…';
            await this.detectCandidates();
            this.showCandidates = true;
            const wrap = document.getElementById('subscriptionCandidatesWrap');
            if (wrap) wrap.innerHTML = this.renderCandidates();
            detectBtn.disabled = false;
            detectBtn.textContent = '🔍 Detect from Transactions';
            document.getElementById('subscriptionCandidates')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }
}

export async function initSubscriptionsUI() {
    const manager = new SubscriptionsManager();
    await manager.init();
}

export function cleanupSubscriptions() {
    activeSubscriptionsManager = null;
}
