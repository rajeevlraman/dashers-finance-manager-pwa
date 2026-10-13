// ============================================================================
// 🧱 cost_base_tracker.js — Cost Base page
// ============================================================================
// Layout: pick a property -> see how its cost base is built up -> see what a
// sale would roughly look like -> a short, grouped list of the costs behind it.
// Pure maths lives in costBaseCalculations.js (unit-tested).

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId } from './db.js';
import { escapeHtml } from './sanitize.js';
import { initPropertiesUI } from './properties.js';
import { formatMoney, propertyCurrency, toAud, toAudTransactions } from './utils/currency.js';
import { getExpenseCategoryBucket } from './propertyExpenseCategories.js';
import {
  COST_KINDS,
  COST_BUCKETS,
  kindOfRecord,
  bucketOfRecord,
  summarisePropertyCostBase,
  estimateSale,
  csvCell,
  parseLocalDate
} from './costBaseCalculations.js';

// Running costs that repeat every year are almost never capital, so they
// aren't offered as "possible cost base items".
const RECURRING_BUCKETS = new Set([
  'Council Rates', 'Land Tax', 'Insurance', 'Utilities', 'Property Management',
  'Body Corporate', 'Loan Interest', 'Maintenance', 'Repairs', 'Travel'
]);

// Starting guess for a suggested transaction — always confirmed by the person.
function guessKind(tx) {
  const bucket = tx.expenseCategory || getExpenseCategoryBucket(tx.categoryId);
  if (tx.categoryId === 'sub_legal_fees' || bucket === 'Legal Fees') return 'legalBuying';
  if (tx.categoryId === 'sub_home_building' || bucket === 'Capital Improvements') return 'improvement';
  return '';
}

const PROPERTY_TYPE_LABEL = { primary: 'Home', investment: 'Investment', vacation: 'Holiday', commercial: 'Commercial' };

export class CostBaseTracker {
    constructor() {
        this.records = [];
        this.properties = [];
        this.transactions = [];
        this.selectedProperty = null;
        this.editingRecord = null;
        // Set when "Add" is used on a suggested transaction, so the saved record
        // remembers which transaction it came from. tax_compliance.js uses that
        // link to keep a capital cost from also being claimed as a deduction.
        this.prefillFromTransaction = null;
        this.salePrices = {}; // per-property "if sold for" input, kept while on the page
        this.saleDates = {};  // per-property sale contract date for the estimate (default today)
    }

    async init(propertyId = null) {
        await this.loadData();
        this.selectedProperty = propertyId;
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        try {
            const [records, properties, transactions, accounts] = await Promise.all([
                getAllItems(STORE_NAMES.costbase),
                getAllItems(STORE_NAMES.properties),
                getAllItems(STORE_NAMES.transactions),
                getAllItems(STORE_NAMES.accounts).catch(() => [])
            ]);
            this.records = Array.isArray(records) ? records.filter(r => r && r.id) : [];
            this.properties = Array.isArray(properties) ? properties : [];
            this.transactions = Array.isArray(transactions) ? toAudTransactions(transactions, accounts) : [];
        } catch (error) {
            console.error('Error loading cost base data:', error);
            this.records = [];
            this.properties = [];
            this.transactions = [];
        }
    }

    // ---------------------------------------------------------------- helpers
    todayString() {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }

    formatCurrency(amount) {
        return formatMoney(parseFloat(amount) || 0, 'AUD');
    }

    formatDate(value) {
        const d = parseLocalDate(value);
        return d ? d.toLocaleDateString('en-AU') : '';
    }

    getFilteredRecords() {
        return this.selectedProperty
            ? this.records.filter(r => r.propertyId === this.selectedProperty)
            : this.records;
    }

    // Purchase price converted to AUD (an overseas property's price is in its own currency).
    purchasePriceAud(property) {
        return toAud(property?.purchasePrice || 0, propertyCurrency(property));
    }

    summaryFor(property) {
        return summarisePropertyCostBase({
            purchasePrice: this.purchasePriceAud(property),
            records: this.records.filter(r => r.propertyId === property.id)
        });
    }

    // ----------------------------------------------------------------- layout
    renderUI() {
        const mainContent = document.getElementById('mainContent');
        mainContent.innerHTML = `
            <div class="costbase-container cb-page">
                <div class="cb-header">
                    <div>
                        <h2>🧱 Cost Base</h2>
                        <p class="cb-sub">What you've spent on each property. When you sell, this is subtracted from the sale price to work out your capital gain.</p>
                    </div>
                    <div class="cb-actions">
                        ${this.selectedProperty && this.cameFromProperties ? `<button class="btn btn-secondary" id="btnBackToProperties">⬅️ Properties</button>` : ''}
                        <button class="btn btn-primary" id="btnAddRecord">➕ Add a cost</button>
                        <button class="btn btn-secondary" id="btnExportReport">📊 Export</button>
                    </div>
                </div>

                <div id="cbPropertyChips" class="cb-chips" role="group" aria-label="Choose a property"></div>
                <div id="cbOverview"></div>
                <div id="costBaseSuggestions"></div>
                <div id="costBaseList" class="cb-groups"></div>

                <details class="cb-learn">
                    <summary>How cost base works</summary>
                    <div class="cb-learn-body">
                        <p><strong>Counts toward cost base:</strong> the purchase price, stamp duty, legal and conveyancing fees when buying, other costs of buying, and capital improvements (e.g. a new extension or kitchen).</p>
                        <p><strong>Doesn't count:</strong> repairs, rates, insurance and loan interest, which are claimed as deductions instead. Loan fees (like LMI) are usually deducted over 5 years. Don't claim the same cost both ways.</p>
                        <p><strong>Selling costs</strong> (agent commission, marketing, legal fees on the sale) aren't part of the cost base. They're taken off the sale price when you sell.</p>
                        <p><strong>12-month discount:</strong> if you've owned the property for at least 12 months before the contract date of the sale (not counting the day you bought or the day you sold), an Australian-resident individual can generally reduce the gain by 50%. The dates are the contract dates, not settlement.</p>
                        <p><strong>Not worked out here:</strong> the main residence exemption (including the 6-year rule), properties bought before 20 September 1985, and capital losses. If any applies, ask a registered tax agent.</p>
                    </div>
                </details>
                ${this.renderModal()}
            </div>
        `;
        this.refreshAll();
    }

    refreshAll() {
        this.refreshChips();
        this.refreshOverview();
        this.refreshSuggestions();
        this.refreshRecordsList();
    }

    refreshChips() {
        const el = document.getElementById('cbPropertyChips');
        if (!el) return;
        const chip = (id, label, active) => `
            <button type="button" class="cb-chip ${active ? 'active' : ''}" data-prop="${escapeHtml(id)}" aria-pressed="${active}">
                ${label}
            </button>`;
        el.innerHTML = chip('', 'All properties', !this.selectedProperty) +
            this.properties.map(p => chip(p.id, escapeHtml(p.name || 'Property'), this.selectedProperty === p.id)).join('');
    }

    // ---------------------------------------------------------------- overview
    refreshOverview() {
        const el = document.getElementById('cbOverview');
        if (!el) return;

        if (!this.properties.length) {
            el.innerHTML = `
                <div class="cb-empty">
                    <div class="cb-empty-icon">🏠</div>
                    <h3>Add a property first</h3>
                    <p>Cost base is tracked per property. Add one on the Properties page, then come back to record what it cost.</p>
                </div>`;
            return;
        }

        const property = this.properties.find(p => p.id === this.selectedProperty);
        if (!property) {
            el.innerHTML = `<div class="cb-grid">${this.properties.map(p => this.renderPropertyCard(p)).join('')}</div>`;
            return;
        }
        el.innerHTML = this.renderHero(property);
        this.updateSaleResult();
    }

    renderBar(s) {
        const total = s.costBase;
        if (total <= 0) return '<div class="cb-bar cb-bar-empty" aria-hidden="true"></div>';
        const pct = v => Math.max((v / total) * 100, 0).toFixed(2);
        return `
            <div class="cb-bar" aria-hidden="true">
                <span class="cb-seg cb-seg-price" style="width:${pct(s.purchasePrice)}%"></span>
                <span class="cb-seg cb-seg-buying" style="width:${pct(s.buying)}%"></span>
                <span class="cb-seg cb-seg-improve" style="width:${pct(s.improvements)}%"></span>
            </div>`;
    }

    renderPropertyCard(p) {
        const s = this.summaryFor(p);
        const n = s.counts.buying + s.counts.improvements + s.counts.selling + s.counts.deductible;
        return `
            <button type="button" class="cb-card" data-prop="${escapeHtml(p.id)}">
                <div class="cb-card-top">
                    <strong>${escapeHtml(p.name || 'Property')}</strong>
                    <span class="cb-tag">${PROPERTY_TYPE_LABEL[p.propertyType] || 'Property'}</span>
                </div>
                <div class="cb-card-label">Cost base</div>
                <div class="cb-card-value">${this.formatCurrency(s.costBase)}</div>
                ${this.renderBar(s)}
                <div class="cb-card-foot">${n ? `${n} cost${n === 1 ? '' : 's'} recorded` : 'No costs recorded yet'}${s.purchasePrice ? '' : ' · purchase price missing'}</div>
            </button>`;
    }

    renderHero(p) {
        const s = this.summaryFor(p);
        const propCur = propertyCurrency(p);
        const purchaseNote = propCur !== 'AUD' && p.purchasePrice
            ? `<small>${formatMoney(p.purchasePrice, propCur)} at today's rate</small>` : '';
        const row = (cls, label, value, extra = '') => `
            <div class="cb-row-line"><span class="cb-dot ${cls}"></span><span class="cb-row-label">${label}${extra}</span><span class="cb-row-value">${value}</span></div>`;
        const isHome = p.propertyType === 'primary';
        const salePrice = this.salePrices[p.id] ?? Math.round(toAud(p.currentValue || 0, propCur));
        const saleDate = this.saleDates[p.id] || this.todayString();

        return `
            <section class="cb-hero" aria-label="Cost base for ${escapeHtml(p.name || 'property')}">
                <div class="cb-hero-main">
                    <div class="cb-hero-title">
                        <h3>${escapeHtml(p.name || 'Property')}</h3>
                        <span class="cb-tag">${PROPERTY_TYPE_LABEL[p.propertyType] || 'Property'}</span>
                    </div>
                    ${p.address ? `<div class="cb-address">${escapeHtml(p.address)}</div>` : ''}
                    <div class="cb-big-label">Your cost base</div>
                    <div class="cb-big">${this.formatCurrency(s.costBase)}</div>
                    ${this.renderBar(s)}
                    <div class="cb-lines">
                        ${row('cb-seg-price', 'Purchase price', this.formatCurrency(s.purchasePrice), purchaseNote ? ' ' + purchaseNote : '')}
                        ${row('cb-seg-buying', 'Buying costs', '+ ' + this.formatCurrency(s.buying), ` <small>${s.counts.buying} recorded</small>`)}
                        ${row('cb-seg-improve', 'Improvements', '+ ' + this.formatCurrency(s.improvements), ` <small>${s.counts.improvements} recorded</small>`)}
                    </div>
                    ${s.purchasePrice ? '' : `<p class="cb-warn">No purchase price on this property yet. Add it on the Properties page so the cost base is complete.</p>`}
                    ${s.selling ? `<p class="cb-muted">Selling costs of ${this.formatCurrency(s.selling)} are kept separate and only matter when you sell.</p>` : ''}
                </div>

                <div class="cb-hero-sale">
                    <h4>If you sold</h4>
                    ${isHome ? `<p class="cb-note cb-note-info">This is your home. If it's been your main residence the whole time, the gain is usually exempt from CGT. This estimate ignores that.</p>` : ''}
                    <label class="cb-field">
                        <span>Sale price (AUD)</span>
                        <input type="number" id="cbSalePrice" class="form-input" min="0" step="1000" value="${salePrice || ''}" inputmode="numeric">
                    </label>
                    <label class="cb-field">
                        <span>Date you'd sign the sale contract</span>
                        <input type="date" id="cbSaleDate" class="form-input" value="${escapeHtml(saleDate)}">
                    </label>
                    <label class="cb-field">
                        <span>Date you signed the purchase contract</span>
                        <input type="date" id="cbPurchaseDate" class="form-input" value="${escapeHtml(p.purchaseDate || '')}">
                    </label>
                    <div id="cbSaleResult" aria-live="polite"></div>
                </div>
            </section>`;
    }

    // Recomputes only the result box so typing in the inputs never loses focus.
    updateSaleResult() {
        const box = document.getElementById('cbSaleResult');
        const p = this.properties.find(x => x.id === this.selectedProperty);
        if (!box || !p) return;
        const s = this.summaryFor(p);
        const priceInput = document.getElementById('cbSalePrice');
        const sale = parseFloat(priceInput?.value);
        if (!Number.isFinite(sale) || sale <= 0) {
            box.innerHTML = `<p class="cb-muted">Enter a sale price to see a rough capital gain.</p>`;
            return;
        }
        const saleDate = document.getElementById('cbSaleDate')?.value || this.todayString();
        const purchase = parseLocalDate(p.purchaseDate || '');
        const saleOn = parseLocalDate(saleDate);
        if (purchase && saleOn && saleOn < purchase) {
            box.innerHTML = `<p class="cb-note cb-note-warn">The sale date is before the purchase date. Check both dates.</p>`;
            return;
        }
        const r = estimateSale({ summary: s, salePrice: sale, acquisitionDate: p.purchaseDate || '', saleDate });
        const line = (label, value, cls = '') => `<div class="cb-calc ${cls}"><span>${label}</span><strong>${value}</strong></div>`;

        let discountHtml;
        if (r.gain <= 0) {
            discountHtml = `<p class="cb-note cb-note-info">That's a ${r.gain === 0 ? 'break-even sale' : 'capital loss'}, so no discount applies. A capital loss can only be used against capital gains.</p>`;
        } else if (r.discountKnown === null) {
            discountHtml = `
                ${line('Taxable gain if you held it 12+ months', this.formatCurrency(r.taxableGainBest))}
                ${line('Taxable gain if you held it under 12 months', this.formatCurrency(r.taxableGainWorst))}
                <p class="cb-note cb-note-warn">Add the purchase contract date above to see which one applies.</p>`;
        } else if (r.discountKnown) {
            discountHtml = `
                ${line('50% discount (held over 12 months)', '− ' + this.formatCurrency(r.discountAmount))}
                ${line('Taxable gain', this.formatCurrency(r.taxableGain), 'cb-calc-total')}`;
        } else {
            discountHtml = `
                ${line('Taxable gain', this.formatCurrency(r.taxableGain), 'cb-calc-total')}
                <p class="cb-note cb-note-warn">Owned for under 12 months, so the 50% discount doesn't apply.</p>`;
        }

        box.innerHTML = `
            ${r.gain > 0 || r.gain < 0 ? line(r.gain >= 0 ? 'Capital gain' : 'Capital loss', this.formatCurrency(r.gain), 'cb-calc-main') : ''}
            ${line('Sale price', this.formatCurrency(sale))}
            ${line('− Cost base', this.formatCurrency(s.costBase))}
            ${s.selling ? line('− Selling costs', this.formatCurrency(s.selling)) : ''}
            ${discountHtml}
            <p class="cb-fine">A rough estimate for a sale on the date above, assuming you're an Australian tax resident. The taxable gain is added to your other income, so the tax depends on your total income, and it ignores the main residence exemption.</p>`;
    }

    // ------------------------------------------------------------ suggestions
    getSuggestedTransactions() {
        const linked = new Set(this.records.filter(r => r.transactionId).map(r => r.transactionId));
        return this.transactions
            .filter(t => t && t.type === 'expense' && !t.isTransfer && t.propertyId && !linked.has(t.id) && !t.loanId)
            .filter(t => !this.selectedProperty || t.propertyId === this.selectedProperty)
            .filter(t => !RECURRING_BUCKETS.has(t.expenseCategory || getExpenseCategoryBucket(t.categoryId)))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, 5);
    }

    refreshSuggestions() {
        const el = document.getElementById('costBaseSuggestions');
        if (!el) return;
        const list = this.getSuggestedTransactions();
        if (!list.length) { el.innerHTML = ''; return; }
        el.innerHTML = `
            <section class="cb-suggest">
                <h3>💡 Could any of these be part of the cost base?</h3>
                <p class="cb-muted">Transactions on your properties that look like one-off costs (not rates, insurance or regular repairs). Add the ones that are, or ignore the rest.</p>
                ${list.map(tx => {
                    const p = this.properties.find(x => x.id === tx.propertyId);
                    return `
                    <div class="cb-suggest-row">
                        <div class="cb-suggest-text">
                            <strong>${escapeHtml(tx.description) || 'Transaction'}</strong>
                            <span class="cb-muted">${this.formatDate(tx.date)}${p ? ' · ' + escapeHtml(p.name) : ''}</span>
                        </div>
                        <span class="cb-amt">${this.formatCurrency(Math.abs(tx.amount))}</span>
                        <button class="btn btn-outline btn-suggestion-add" data-tx-id="${escapeHtml(tx.id)}">Add</button>
                    </div>`;
                }).join('')}
            </section>`;
    }

    // ----------------------------------------------------------------- records
    refreshRecordsList() {
        const el = document.getElementById('costBaseList');
        if (!el) return;
        const records = this.getFilteredRecords();

        if (!records.length) {
            el.innerHTML = `
                <div class="cb-empty">
                    <div class="cb-empty-icon">🧾</div>
                    <h3>No costs recorded${this.selectedProperty ? ' for this property' : ''} yet</h3>
                    <p>Add stamp duty, legal fees and any renovations. The purchase price comes from the property itself.</p>
                    <button class="btn btn-primary" id="btnAddFirstRecord">➕ Add a cost</button>
                </div>`;
            return;
        }

        const showProperty = !this.selectedProperty;
        el.innerHTML = COST_BUCKETS.map(bucket => {
            const items = records.filter(r => bucketOfRecord(r) === bucket.id)
                .sort((a, b) => String(b.date).localeCompare(String(a.date)));
            if (!items.length) return '';
            const total = items.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
            return `
                <section class="cb-group">
                    <div class="cb-group-head">
                        <div>
                            <h3>${bucket.icon} ${bucket.title}</h3>
                            <div class="cb-muted">${bucket.note}</div>
                        </div>
                        <div class="cb-group-total">${this.formatCurrency(total)}</div>
                    </div>
                    ${items.map(r => this.renderRecordItem(r, showProperty)).join('')}
                </section>`;
        }).join('');
    }

    renderRecordItem(record, showProperty) {
        const p = this.properties.find(x => x.id === record.propertyId);
        const kind = COST_KINDS[kindOfRecord(record)];
        return `
            <div class="cb-item">
                <div class="cb-item-main">
                    <div class="cb-item-title">${escapeHtml(record.description) || 'No description'}</div>
                    <div class="cb-muted">
                        ${this.formatDate(record.date)} · ${escapeHtml(kind.label.split(' (')[0])}${showProperty && p ? ' · ' + escapeHtml(p.name) : ''}
                    </div>
                    ${record.notes ? `<div class="cb-item-notes">${escapeHtml(record.notes)}</div>` : ''}
                </div>
                <div class="cb-amt">${this.formatCurrency(record.amount)}</div>
                <div class="cb-item-actions">
                    <button class="record-action" data-action="edit" data-id="${escapeHtml(record.id)}" title="Edit" aria-label="Edit ${escapeHtml(record.description || 'cost')}">✏️</button>
                    <button class="record-action" data-action="delete" data-id="${escapeHtml(record.id)}" title="Delete" aria-label="Delete ${escapeHtml(record.description || 'cost')}">🗑️</button>
                </div>
            </div>`;
    }

    // ------------------------------------------------------------------- modal
    renderModal() {
        return `
            <div class="modal-overlay" id="costBaseModal" style="display: none;">
                <div class="modal">${this.renderModalContent()}</div>
            </div>`;
    }

    // Rendered separately so openModal() can refresh just the form with the
    // record being edited (or the transaction being added).
    renderModalContent() {
        const rec = this.editingRecord;
        const prefill = !rec ? this.prefillFromTransaction : null;
        const kindKey = rec ? kindOfRecord(rec) : (prefill ? guessKind(prefill) : '');
        const propertyId = rec?.propertyId || prefill?.propertyId || this.selectedProperty || (this.properties.length === 1 ? this.properties[0].id : '');
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const dateVal = rec?.date || (prefill?.date ? String(prefill.date).slice(0, 10) : todayStr);
        const amountVal = rec ? rec.amount : (prefill ? Math.abs(prefill.amount) : '');

        return `
            <div class="modal-header">
                <h3 id="modalTitle">${rec ? '✏️ Edit cost' : '➕ Add a cost'}</h3>
                <button class="btn-close" id="closeModal" aria-label="Close">✕</button>
            </div>
            ${prefill ? `<p class="cb-modal-note">Filled in from a transaction. Check what kind of cost it is before saving.</p>` : ''}
            <form id="costBaseForm" class="modal-form">
                <input type="hidden" id="recordId" value="${escapeHtml(rec?.id || '')}">
                <input type="hidden" id="recordTransactionId" value="${escapeHtml(rec?.transactionId || prefill?.id || '')}">

                <div class="form-group">
                    <label for="cbKind">What is this cost?</label>
                    <select name="kind" id="cbKind" class="form-select" required>
                        <option value="" ${kindKey ? '' : 'selected'} disabled>Choose one…</option>
                        ${Object.entries(COST_KINDS).map(([key, k]) =>
                            `<option value="${key}" ${kindKey === key ? 'selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}
                    </select>
                    <div class="cb-kind-hint" id="cbKindHint">${kindKey ? escapeHtml(COST_KINDS[kindKey].hint) : 'The purchase price itself comes from the property, so you don\'t add it here.'}</div>
                </div>

                <div class="form-group">
                    <label for="cbProperty">Property</label>
                    <select name="propertyId" id="cbProperty" class="form-select" required>
                        <option value="" disabled ${propertyId ? '' : 'selected'}>Choose a property…</option>
                        ${this.properties.map(p => `<option value="${escapeHtml(p.id)}" ${propertyId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="cbAmount">Amount (AUD)</label>
                        <input type="number" name="amount" id="cbAmount" step="0.01" min="0.01" class="form-input" value="${amountVal}" inputmode="decimal" required>
                    </div>
                    <div class="form-group">
                        <label for="cbDate">Date</label>
                        <input type="date" name="date" id="cbDate" class="form-input" value="${escapeHtml(dateVal)}" required>
                    </div>
                </div>

                <div class="form-group">
                    <label for="cbDescription">Description</label>
                    <input type="text" name="description" id="cbDescription" class="form-input"
                           value="${escapeHtml(rec?.description || prefill?.description || '')}" placeholder="e.g. Stamp duty, new kitchen" required>
                </div>

                <details class="cb-optional" ${rec?.notes ? 'open' : ''}>
                    <summary>Add a note (optional)</summary>
                    <textarea name="notes" rows="3" class="form-input" placeholder="Invoice number, who you paid, anything to remember">${escapeHtml(rec?.notes || '')}</textarea>
                </details>

                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${rec ? '💾 Update' : '💾 Save'}</button>
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
                    ${rec ? `<button type="button" class="btn btn-danger" id="deleteBtn">🗑️ Delete</button>` : ''}
                </div>
            </form>`;
    }

    openModal() {
        const modal = document.getElementById('costBaseModal');
        modal.style.display = 'flex';
        modal.querySelector('.modal').innerHTML = this.renderModalContent();
        this.attachModalHandlers();
        document.getElementById('cbKind')?.focus();
    }

    closeModal() {
        const modal = document.getElementById('costBaseModal');
        if (modal) modal.style.display = 'none';
        this.editingRecord = null;
        this.prefillFromTransaction = null;
    }

    attachModalHandlers() {
        const form = document.getElementById('costBaseForm');
        document.getElementById('closeModal')?.addEventListener('click', () => this.closeModal());
        document.getElementById('cancelBtn')?.addEventListener('click', () => this.closeModal());

        document.getElementById('cbKind')?.addEventListener('change', (e) => {
            const k = COST_KINDS[e.target.value];
            const hint = document.getElementById('cbKindHint');
            if (k && hint) hint.textContent = k.hint;
        });

        document.getElementById('deleteBtn')?.addEventListener('click', async () => {
            if (!this.editingRecord || !confirm('Delete this cost?')) return;
            await deleteItem(STORE_NAMES.costbase, this.editingRecord.id);
            this.closeModal();
            await this.loadData();
            this.refreshAll();
        });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const kind = COST_KINDS[fd.get('kind')];
            const amount = parseFloat(fd.get('amount'));
            if (!kind || !fd.get('propertyId') || !Number.isFinite(amount) || amount <= 0) return;

            const recordData = {
                id: document.getElementById('recordId').value || generateId(),
                transactionId: document.getElementById('recordTransactionId').value || null,
                propertyId: fd.get('propertyId'),
                date: fd.get('date'),
                description: String(fd.get('description') || '').trim(),
                // Each kind fixes these three so they can never contradict each other.
                type: kind.type,
                classification: kind.classification,
                atoCategory: kind.atoCategory,
                amount,
                notes: fd.get('notes') || '',
                updatedAt: new Date().toISOString()
            };

            if (this.editingRecord) {
                recordData.createdAt = this.editingRecord.createdAt;
                await updateItem(STORE_NAMES.costbase, recordData);
            } else {
                recordData.createdAt = new Date().toISOString();
                await addItem(STORE_NAMES.costbase, recordData);
            }
            // Show the property the cost was added to, so it's visibly there.
            if (this.selectedProperty && this.selectedProperty !== recordData.propertyId) {
                this.selectedProperty = recordData.propertyId;
            }
            this.closeModal();
            await this.loadData();
            this.refreshAll();
        });

        const modal = document.getElementById('costBaseModal');
        modal.onclick = (e) => { if (e.target === modal) this.closeModal(); };
    }

    // ------------------------------------------------------------------ events
    attachEventListeners() {
        // The page container is rebuilt on every render, so these listeners can't pile up
        // across visits the way listeners on #mainContent itself would.
        const root = document.querySelector('.cb-page');

        document.getElementById('btnAddRecord')?.addEventListener('click', () => {
            this.editingRecord = null;
            this.prefillFromTransaction = null;
            this.openModal();
        });
        document.getElementById('btnExportReport')?.addEventListener('click', () => this.exportReport());
        document.getElementById('btnBackToProperties')?.addEventListener('click', () => initPropertiesUI());

        // One delegated listener per area, so re-rendering never loses handlers.
        root.addEventListener('click', (e) => {
            const select = e.target.closest('[data-prop]');
            if (select && root.contains(select)) {
                this.selectedProperty = select.dataset.prop || null;
                this.refreshAll();
                return;
            }
            if (e.target.closest('#btnAddFirstRecord')) {
                this.editingRecord = null;
                this.prefillFromTransaction = null;
                this.openModal();
                return;
            }
            const sugg = e.target.closest('.btn-suggestion-add');
            if (sugg) {
                const tx = this.transactions.find(t => t.id === sugg.dataset.txId);
                if (!tx) return;
                this.editingRecord = null;
                this.prefillFromTransaction = tx;
                this.openModal();
                return;
            }
            const action = e.target.closest('.record-action');
            if (action) {
                const record = this.records.find(r => r.id === action.dataset.id);
                if (!record) return;
                if (action.dataset.action === 'edit') {
                    this.editingRecord = record;
                    this.prefillFromTransaction = null;
                    this.openModal();
                } else {
                    this.deleteRecord(record);
                }
            }
        });

        root.addEventListener('input', (e) => {
            if (e.target.id === 'cbSaleDate') {
                if (this.selectedProperty) this.saleDates[this.selectedProperty] = e.target.value;
                this.updateSaleResult();
                return;
            }
            if (e.target.id === 'cbSalePrice') {
                if (this.selectedProperty) this.salePrices[this.selectedProperty] = parseFloat(e.target.value) || 0;
                this.updateSaleResult();
            }
        });

        root.addEventListener('change', async (e) => {
            if (e.target.id !== 'cbPurchaseDate') return;
            const p = this.properties.find(x => x.id === this.selectedProperty);
            if (!p) return;
            // Saved on the property so the 12-month check uses the real date.
            const updated = { ...p, purchaseDate: e.target.value || '', updatedAt: new Date().toISOString() };
            try {
                await updateItem(STORE_NAMES.properties, updated);
                Object.assign(p, updated);
            } catch (err) {
                console.error('Could not save purchase date:', err);
            }
            this.updateSaleResult();
        });
    }

    async deleteRecord(record) {
        if (!confirm(`Delete "${record.description || 'this cost'}"?`)) return;
        await deleteItem(STORE_NAMES.costbase, record.id);
        await this.loadData();
        this.refreshAll();
    }

    // ------------------------------------------------------------------ export
    exportReport() {
        const records = this.getFilteredRecords();
        const props = this.selectedProperty
            ? this.properties.filter(p => p.id === this.selectedProperty)
            : this.properties;
        const money = (n) => (Math.round((parseFloat(n) || 0) * 100) / 100).toFixed(2);
        const lines = [];
        lines.push(csvCell('Cost Base Report (working paper, not tax advice)'));
        lines.push(`${csvCell('Prepared')},${csvCell(new Date().toLocaleDateString('en-AU'))}`);
        lines.push('');

        lines.push(['Property', 'Purchase price', 'Buying costs', 'Improvements', 'Cost base', 'Selling costs (not in cost base)', 'Claimed as deductions (not in cost base)', 'Purchase contract date']
            .map(csvCell).join(','));
        props.forEach(p => {
            const s = this.summaryFor(p);
            lines.push([csvCell(p.name), money(s.purchasePrice), money(s.buying), money(s.improvements), money(s.costBase),
                money(s.selling), money(s.deductible), csvCell(p.purchaseDate || '')].join(','));
        });
        lines.push('');

        lines.push(['Property', 'Date', 'Description', 'Kind of cost', 'Counts as', 'Amount', 'Notes'].map(csvCell).join(','));
        [...records].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(r => {
            const p = this.properties.find(x => x.id === r.propertyId);
            const bucket = COST_BUCKETS.find(b => b.id === bucketOfRecord(r));
            lines.push([csvCell(p?.name || ''), csvCell(r.date), csvCell(r.description),
                csvCell(COST_KINDS[kindOfRecord(r)].label), csvCell(bucket?.title || ''), money(r.amount), csvCell(r.notes || '')].join(','));
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cost-base-report-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }
}

// Backwards compatibility: ui.js and the Properties page call this.
export async function initCostBaseTrackerUI(propertyId = null) {
    const tracker = new CostBaseTracker();
    tracker.cameFromProperties = !!propertyId;
    await tracker.init(propertyId);
    return tracker;
}
