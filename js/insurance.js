// ============================================================================
// 🛡️ insurance.js — Insurance Policy Manager
// ============================================================================
// A proper policy record — provider, policy number, coverage type, sum
// insured, excess, premium — distinct from the old approach of inferring
// "insurance" purely from bills tagged with an insurance category (see
// js/wealthOverview.js's insuranceBills / js/dashboardTabs.js's Bills &
// Insurance tab, which still work off unpaid bills and stay unchanged).
//
// A policy optionally links to a Property (home & contents / landlord) the
// same way js/loans.js links a loan to a property, and optionally links to
// a Bill/Recurring entry for the actual payment reminder — the policy
// record itself only carries the coverage facts and the renewal date.
//
// Status here is deliberately NOT the same as js/bills.js's getBillStatus:
// a bill's overdue/due-soon thresholds (today / ≤3 days) make sense for a
// payment, not for "when should I start shopping around for a renewal?" —
// see getInsuranceRenewalStatus below for the wider 30/60-day thresholds.

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId } from './db.js';
import { getGatedItems } from './features.js';
import { escapeHtml } from './sanitize.js';

import { formatMoney, propertyCurrency, toBase, recordCurrency } from './utils/currency.js';
import { resolveLinkedItem, compareLinkedItem } from './insuranceLinkCheck.js';
export const POLICY_TYPES = {
    home_contents: { label: 'Home & Contents', icon: '🏠' },
    landlord: { label: 'Landlord', icon: '🔑' },
    car: { label: 'Car', icon: '🚗' },
    other: { label: 'Other', icon: '🛡️' }
};

// Coverage options per policy type — feeds the Coverage Type dropdown so
// each type only offers choices that actually apply to it (see
// updateFormFieldsForType, which repopulates the <select> when the type
// changes). 'Other' is always included as an escape hatch, and an old
// free-text value that doesn't match any option here is preserved as an
// extra option so editing an existing policy never silently loses it.
export const COVERAGE_TYPES = {
    home_contents: ['Building + Contents', 'Building Only', 'Contents Only'],
    landlord: ['Landlord Comprehensive', 'Building Only', 'Building + Landlord Extras'],
    car: ['Comprehensive', 'Third Party Fire & Theft', 'Third Party Property Only'],
    other: ['Comprehensive', 'Basic']
};

// Wider thresholds than bill urgency (see file header) — 30/60 days gives
// enough lead time to actually compare quotes before a policy lapses.
export function getInsuranceRenewalStatus(policy, today = new Date().toISOString().slice(0, 10)) {
    if (!policy.renewalDate) return { text: 'No renewal date', class: 'upcoming', icon: '❔' };
    const daysUntil = Math.floor((new Date(policy.renewalDate) - new Date(today)) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return { text: `${Math.abs(daysUntil)}d overdue`, class: 'overdue', icon: '🚨', daysUntil };
    if (daysUntil <= 30) return { text: `Renews in ${daysUntil}d`, class: 'due-soon', icon: '⏰', daysUntil };
    if (daysUntil <= 60) return { text: `Renews in ${daysUntil}d`, class: 'upcoming', icon: '📅', daysUntil };
    return { text: 'Active', class: 'paid', icon: '🟢', daysUntil };
}

// Annualised premium, regardless of how it's actually paid — used for the
// "total annual premium" figure on this page and the Finance Overview
// mini-card, since a monthly-paid policy shouldn't be compared 1:1 against
// an annually-paid one without normalising first.
export function annualPremium(policy) {
    const amt = parseFloat(policy.premiumAmount) || 0;
    return policy.paymentFrequency === 'monthly' ? amt * 12 : amt;
}

let activeInsuranceManager = null;
let insuranceDelegatedListenerAttached = false;

function attachInsuranceDelegatedListener() {
    if (insuranceDelegatedListenerAttached) return;
    insuranceDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-insurance-action]');
        if (!button || !activeInsuranceManager) return;
        activeInsuranceManager.handlePolicyAction(button.dataset.insuranceAction, button.dataset.id);
    });
}

export class InsuranceManager {
    constructor() {
        this.policies = [];
        this.properties = [];
        this.recurringTransactions = [];
        this.bills = [];
        this.accounts = [];
        this.typeFilter = 'all';
    }

    async init() {
        await this.loadData();
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        [this.policies, this.properties, this.recurringTransactions, this.bills, this.accounts] = await Promise.all([
            getAllItems(STORE_NAMES.insurancePolicies),
            getGatedItems(STORE_NAMES.properties).catch(() => []),
            getAllItems(STORE_NAMES.recurringTransactions).catch(() => []),
            getAllItems(STORE_NAMES.bills).catch(() => []),
            getAllItems(STORE_NAMES.accounts).catch(() => [])
        ]);
    }

    refreshUI() {
        this.renderUI();
        this.attachEventListeners();
    }

    getFilteredPolicies() {
        const list = this.typeFilter === 'all'
            ? this.policies
            : this.policies.filter(p => p.policyType === this.typeFilter);
        // Soonest renewal first — the whole point of the page is "what needs
        // attention next".
        return [...list].sort((a, b) => (a.renewalDate || '9999').localeCompare(b.renewalDate || '9999'));
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');
        mainContent.innerHTML = `
            <div class="tenants-container insurance-container">
                <div class="tenants-header">
                    <div class="header-main">
                        <h2>🛡️ Insurance</h2>
                        <button id="btnNewPolicy" class="btn btn-primary">➕ Add Policy</button>
                    </div>
                </div>

                ${this.renderStats()}

                <div class="horizontal-quick-actions">
                    ${['all', ...Object.keys(POLICY_TYPES)].map(key => `
                        <div class="quick-action-item ${this.typeFilter === key ? 'primary' : 'secondary'}" data-filter-type="${key}">
                            <span class="quick-action-icon">${key === 'all' ? '🗂️' : POLICY_TYPES[key].icon}</span>
                            <span class="quick-action-text">${key === 'all' ? 'All' : POLICY_TYPES[key].label}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="tenants-content">
                    ${this.renderPoliciesList()}
                </div>

                ${this.renderPolicyModal()}
            </div>
        `;
    }

    renderStats() {
        const totalAnnual = this.policies.reduce((sum, p) => sum + toBase(annualPremium(p), this.policyCurrency(p)), 0); // base currency
        const renewingSoon = this.policies.filter(p => {
            const s = getInsuranceRenewalStatus(p);
            return s.class === 'overdue' || s.class === 'due-soon';
        });
        return `
            <div class="tenant-stats page-compact-cards">
                <div class="stat-card">
                    <div class="stat-icon">🛡️</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.policies.length}</div>
                        <div class="stat-label">Policies</div>
                        <div class="stat-subtext">Across all types</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💰</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.formatCurrency(totalAnnual)}</div>
                        <div class="stat-label">Total Annual Premium</div>
                        <div class="stat-subtext">Normalised to yearly cost</div>
                    </div>
                </div>
                <div class="stat-card ${renewingSoon.length > 0 ? 'overdue' : ''}">
                    <div class="stat-icon">⏰</div>
                    <div class="stat-content">
                        <div class="stat-value">${renewingSoon.length}</div>
                        <div class="stat-label">Renewing ≤30 Days</div>
                        <div class="stat-subtext">Time to shop around</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderPoliciesList() {
        const filtered = this.getFilteredPolicies();
        if (filtered.length === 0) return this.renderEmptyState();
        return `<div class="tenants-grid">${filtered.map(p => this.renderPolicyCard(p)).join('')}</div>`;
    }

    // A policy linked to a property is in that property's currency (an overseas property is insured locally);
    // everything else (car, health, unlinked) is AUD.
    policyCurrency(policy) {
        const prop = policy?.linkedPropertyId ? this.properties.find(pr => pr.id === policy.linkedPropertyId) : null;
        return prop ? propertyCurrency(prop) : 'AUD';
    }

    renderPolicyCard(policy) {
        const status = getInsuranceRenewalStatus(policy);
        const cur = this.policyCurrency(policy);
        const typeInfo = POLICY_TYPES[policy.policyType] || POLICY_TYPES.other;
        const property = policy.linkedPropertyId ? this.properties.find(pr => pr.id === policy.linkedPropertyId) : null;
        // The picker lists both Bills and Recurring entries. A paid recurring bill is
        // followed to its next-cycle successor (paying creates a new bill record).
        const link = resolveLinkedItem(policy.linkedRecurringId, this.recurringTransactions, this.bills);
        const linkedRecurring = link.item;
        const linkMissing = !!policy.linkedRecurringId && !link.item;
        const comparison = link.item
            ? compareLinkedItem(policy, link.kind, link.item, {
                policyCurrency: cur,
                linkedCurrency: recordCurrency(link.item, this.accounts),
                formatMoney: (n, c) => this.formatCurrency(n, c),
                formatDate: d => this.formatDate(d)
            })
            : { issues: [], sync: null };
        const linkNotice = this.renderLinkNotice(policy, linkMissing, comparison);

        const sumInsuredLines = [];
        if (policy.policyType === 'home_contents') {
            if (policy.sumInsuredBuilding) sumInsuredLines.push(`Building: ${this.formatCurrency(policy.sumInsuredBuilding, cur)}`);
            if (policy.sumInsuredContents) sumInsuredLines.push(`Contents: ${this.formatCurrency(policy.sumInsuredContents, cur)}`);
        } else if (policy.policyType === 'landlord') {
            if (policy.sumInsuredBuilding) sumInsuredLines.push(`Building: ${this.formatCurrency(policy.sumInsuredBuilding, cur)}`);
            if (policy.sumInsuredOther) sumInsuredLines.push(`Loss of rent: ${this.formatCurrency(policy.sumInsuredOther, cur)}`);
        } else if (policy.policyType === 'car') {
            if (policy.sumInsuredOther) sumInsuredLines.push(`Agreed value: ${this.formatCurrency(policy.sumInsuredOther, cur)}`);
        } else if (policy.sumInsuredOther) {
            sumInsuredLines.push(`Sum insured: ${this.formatCurrency(policy.sumInsuredOther, cur)}`);
        }

        return `
            <div class="tenant-card ${status.class}">
                <div class="tenant-header">
                    <div class="tenant-status ${status.class}">
                        <span class="status-icon">${status.icon}</span>
                        <span class="status-text">${status.text}</span>
                    </div>
                    <h3 class="tenant-name">${typeInfo.icon} ${escapeHtml(policy.nickname || typeInfo.label)}</h3>
                </div>

                <div class="tenant-details">
                    <div class="detail-item">
                        <span class="detail-label">🏢 Provider:</span>
                        <span class="detail-value">${escapeHtml(policy.provider) || 'Not set'}</span>
                    </div>
                    ${policy.policyNumber ? `
                        <div class="detail-item">
                            <span class="detail-label">🔢 Policy #:</span>
                            <span class="detail-value">${escapeHtml(policy.policyNumber)}</span>
                        </div>
                    ` : ''}
                    ${policy.coverageType ? `
                        <div class="detail-item">
                            <span class="detail-label">📋 Coverage:</span>
                            <span class="detail-value">${escapeHtml(policy.coverageType)}</span>
                        </div>
                    ` : ''}
                    ${sumInsuredLines.map(line => `
                        <div class="detail-item">
                            <span class="detail-label">💵 ${escapeHtml(line.split(':')[0])}:</span>
                            <span class="detail-value">${escapeHtml(line.split(':')[1].trim())}</span>
                        </div>
                    `).join('')}
                    ${policy.excess ? `
                        <div class="detail-item">
                            <span class="detail-label">🧾 Excess:</span>
                            <span class="detail-value">${this.formatCurrency(policy.excess, cur)}</span>
                        </div>
                    ` : ''}
                    <div class="detail-item">
                        <span class="detail-label">💰 Premium:</span>
                        <span class="detail-value rent-amount">${this.formatCurrency(policy.premiumAmount, cur)} ${policy.paymentFrequency === 'monthly' ? '/mo' : '/yr'}</span>
                    </div>
                    ${property ? `
                        <div class="detail-item">
                            <span class="detail-label">🏠 Property:</span>
                            <span class="detail-value property-name">${escapeHtml(property.name)}</span>
                        </div>
                    ` : ''}
                    ${(policy.vehicleMake || policy.vehicleModel || policy.vehicleRego) ? `
                        <div class="detail-item">
                            <span class="detail-label">🚗 Vehicle:</span>
                            <span class="detail-value">${escapeHtml([policy.vehicleMake, policy.vehicleModel].filter(Boolean).join(' '))}${policy.vehicleRego ? ` (${escapeHtml(policy.vehicleRego)})` : ''}</span>
                        </div>
                    ` : ''}
                    ${linkedRecurring ? `
                        <div class="detail-item">
                            <span class="detail-label">🔁 Payment reminder:</span>
                            <span class="detail-value">${escapeHtml(linkedRecurring.name)}</span>
                        </div>
                    ` : ''}
                    ${policy.notes ? `
                        <div class="detail-item">
                            <span class="detail-label">📝 Notes:</span>
                            <span class="detail-value">${escapeHtml(policy.notes)}</span>
                        </div>
                    ` : ''}
                </div>

                ${linkNotice}

                <div class="lease-info">
                    <div class="lease-dates">
                        <span class="lease-start">📅 Renews ${this.formatDate(policy.renewalDate)}</span>
                    </div>
                </div>

                <div class="tenant-actions">
                    <button class="btn-action edit" data-insurance-action="edit" data-id="${policy.id}">✏️ Edit</button>
                    <button class="btn-action delete" data-insurance-action="delete" data-id="${policy.id}">🗑️ Delete</button>
                </div>
            </div>
        `;
    }

    // Warning box under the details: missing link, or where policy and linked
    // item disagree, with Sync / Unlink buttons.
    renderLinkNotice(policy, linkMissing, comparison) {
        if (linkMissing) {
            return `
                <div class="insurance-link-notice warn">
                    <div class="insurance-link-title">⚠️ Linked bill/recurring no longer exists</div>
                    <div class="insurance-link-line">It was probably deleted. Unlink it, or edit the policy to pick a new one.</div>
                    <div class="insurance-link-actions">
                        <button class="btn-action" data-insurance-action="unlink" data-id="${policy.id}">🔓 Unlink</button>
                    </div>
                </div>`;
        }
        const { issues, sync } = comparison;
        if (!issues.length) return '';
        const hasWarn = issues.some(i => i.level === 'warn');
        return `
            <div class="insurance-link-notice ${hasWarn ? 'warn' : 'info'}">
                <div class="insurance-link-title">${hasWarn ? '⚠️ Doesn\u2019t match the linked bill/recurring' : 'ℹ️ Linked bill/recurring differs'}</div>
                ${issues.map(i => `<div class="insurance-link-line">${escapeHtml(i.text)}</div>`).join('')}
                ${sync ? `
                    <div class="insurance-link-actions">
                        <button class="btn-action" data-insurance-action="sync" data-id="${policy.id}">🔄 Sync from linked item</button>
                    </div>` : ''}
            </div>`;
    }

    renderEmptyState() {
        return `
            <div class="section-card">
                <div class="empty-state">
                    <div class="empty-icon">🛡️</div>
                    <h3>No Policies Found</h3>
                    <p>${this.typeFilter === 'all' ? 'Add your home & contents, landlord, or car policies to track cover, excess, and renewal dates properly.' : `No ${POLICY_TYPES[this.typeFilter]?.label || ''} policies yet.`}</p>
                    <button class="btn btn-primary" id="emptyAddPolicy">Add Your First Policy</button>
                </div>
            </div>
        `;
    }

    renderPolicyModal() {
        const propertyOptions = this.properties.map(p =>
            `<option value="${p.id}">${escapeHtml(p.name)}</option>`
        ).join('');
        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
        const optionList = list => [...list].sort(byName).map(r =>
            `<option value="${r.id}">${escapeHtml(r.name || 'Unnamed')}</option>`
        ).join('');
        // Paying a recurring bill leaves the old record behind as 'paid' — hide those
        // unless a policy is still linked to one, so the list isn't full of duplicates.
        const linkedIds = new Set(this.policies.map(p => p.linkedRecurringId).filter(Boolean));
        const billChoices = [...this.bills]
            .filter(b => !b.paid || linkedIds.has(b.id))
            .sort(byName);
        const recurringOptions = `
            ${billChoices.length ? `<optgroup label="Bills">${billChoices.map(b => `<option value="${b.id}">${escapeHtml(b.name || 'Unnamed')}${b.dueDate ? ` — due ${escapeHtml(this.formatDate(b.dueDate))}` : ''}${b.paid ? ' (paid)' : ''}</option>`).join('')}</optgroup>` : ''}
            ${this.recurringTransactions.length ? `<optgroup label="Recurring">${optionList(this.recurringTransactions)}</optgroup>` : ''}
        `;

        return `
            <div id="policyModal" class="modal-overlay" style="display: none;">
                <div class="modal">
                    <div class="modal-header">
                        <h3 id="policyModalTitle">Add New Policy</h3>
                        <button class="btn-close" id="closePolicyModal">✕</button>
                    </div>
                    <form id="policyForm" class="modal-form">
                        <input type="hidden" id="editPolicyId" value="">

                        <div class="form-row">
                            <div class="form-group">
                                <label>Nickname</label>
                                <input type="text" id="policyNickname" class="form-input" placeholder="e.g. Home &amp; Contents — 12 Smith St" required>
                            </div>
                            <div class="form-group">
                                <label>Type</label>
                                <select id="policyType" class="form-select">
                                    ${Object.entries(POLICY_TYPES).map(([key, t]) => `<option value="${key}">${t.icon} ${t.label}</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="form-row" id="policyPropertyRow" data-feature="property">
                            <div class="form-group">
                                <label>Linked Property (optional)</label>
                                <select id="policyProperty" class="form-select">
                                    <option value="">None</option>
                                    ${propertyOptions}
                                </select>
                            </div>
                        </div>

                        <div class="form-row" id="policyVehicleRow" style="display:none;">
                            <div class="form-group">
                                <label>Vehicle Make/Model</label>
                                <input type="text" id="policyVehicleMake" class="form-input" placeholder="Make">
                                <input type="text" id="policyVehicleModel" class="form-input" placeholder="Model" style="margin-top:0.4rem;">
                            </div>
                            <div class="form-group">
                                <label>Rego</label>
                                <input type="text" id="policyVehicleRego" class="form-input" placeholder="Registration">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Provider</label>
                                <input type="text" id="policyProvider" class="form-input" placeholder="e.g. NRMA, AAMI, Allianz" required>
                            </div>
                            <div class="form-group">
                                <label>Policy Number</label>
                                <input type="text" id="policyNumber" class="form-input">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Coverage Type</label>
                                <select id="policyCoverageType" class="form-select"></select>
                            </div>
                            <div class="form-group">
                                <label>Excess</label>
                                <input type="number" id="policyExcess" class="form-input" step="0.01" min="0">
                            </div>
                        </div>

                        <div class="form-row" id="sumInsuredRow">
                            <div class="form-group">
                                <label id="sumInsuredBuildingLabel">Sum Insured — Building</label>
                                <input type="number" id="policySumBuilding" class="form-input" step="0.01" min="0">
                            </div>
                            <div class="form-group">
                                <label id="sumInsuredOtherLabel">Sum Insured — Contents</label>
                                <input type="number" id="policySumOther" class="form-input" step="0.01" min="0">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Premium Amount</label>
                                <input type="number" id="policyPremium" class="form-input" step="0.01" min="0" required>
                            </div>
                            <div class="form-group">
                                <label>Paid</label>
                                <select id="policyFrequency" class="form-select">
                                    <option value="annual">Annually</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Renewal Date</label>
                                <input type="date" id="policyRenewalDate" class="form-input" required>
                            </div>
                            <div class="form-group">
                                <label>Linked Bill/Recurring (optional)</label>
                                <select id="policyLinkedRecurring" class="form-select">
                                    <option value="">None</option>
                                    ${recurringOptions}
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Notes (inclusions/exclusions, extra excesses, etc.)</label>
                            <textarea id="policyNotes" class="form-input" rows="2"></textarea>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">💾 Save Policy</button>
                            <button type="button" class="btn btn-secondary" id="cancelPolicy">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        document.getElementById('btnNewPolicy')?.addEventListener('click', () => this.openPolicyForm());
        document.getElementById('emptyAddPolicy')?.addEventListener('click', () => this.openPolicyForm());

        document.querySelectorAll('[data-filter-type]').forEach(el => {
            el.addEventListener('click', () => {
                this.typeFilter = el.dataset.filterType;
                this.refreshUI();
            });
        });

        activeInsuranceManager = this;
        attachInsuranceDelegatedListener();

        this.setupModalEvents();
    }

    handlePolicyAction(action, policyId) {
        const policy = this.policies.find(p => p.id === policyId);
        if (!policy) return;
        if (action === 'edit') this.openPolicyForm(policy);
        if (action === 'delete') this.deletePolicy(policy);
        if (action === 'sync') this.syncFromLinked(policy);
        if (action === 'unlink') this.unlinkPolicy(policy);
    }

    // Copies premium / frequency (and renewal date for an annual bill) from the
    // linked item onto the policy, after showing exactly what will change.
    async syncFromLinked(policy) {
        const link = resolveLinkedItem(policy.linkedRecurringId, this.recurringTransactions, this.bills);
        if (!link.item) return;
        const { sync } = compareLinkedItem(policy, link.kind, link.item, {
            policyCurrency: this.policyCurrency(policy),
            linkedCurrency: recordCurrency(link.item, this.accounts),
            formatMoney: (n, c) => this.formatCurrency(n, c),
            formatDate: d => this.formatDate(d)
        });
        if (!sync) { alert('Nothing to sync — the policy already matches the linked item.'); return; }
        const msg = `Update "${policy.nickname || policy.provider}" from "${link.item.name}"?\n\n`
            + sync.summary.join('\n')
            + (sync.note ? `\n\n${sync.note}` : '');
        if (!confirm(msg)) return;
        try {
            const updated = { ...policy, premiumAmount: sync.premiumAmount, paymentFrequency: sync.paymentFrequency, updatedAt: new Date().toISOString() };
            if (sync.renewalDate) updated.renewalDate = sync.renewalDate;
            await updateItem(STORE_NAMES.insurancePolicies, updated);
            await this.init();
        } catch (error) {
            console.error('Error syncing policy from linked item:', error);
            alert('Error syncing policy.');
        }
    }

    async unlinkPolicy(policy) {
        if (!confirm('Remove the link from this policy? The policy itself is kept.')) return;
        try {
            await updateItem(STORE_NAMES.insurancePolicies, { ...policy, linkedRecurringId: null, updatedAt: new Date().toISOString() });
            await this.init();
        } catch (error) {
            console.error('Error unlinking policy:', error);
            alert('Error unlinking policy.');
        }
    }

    setupModalEvents() {
        const modal = document.getElementById('policyModal');
        const form = document.getElementById('policyForm');
        const closeBtn = document.getElementById('closePolicyModal');
        const cancelBtn = document.getElementById('cancelPolicy');
        const typeSelect = document.getElementById('policyType');

        [closeBtn, cancelBtn].forEach(btn => {
            btn?.addEventListener('click', () => { modal.style.display = 'none'; });
        });

        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        // A manual type change means "start fresh" for coverage options —
        // don't carry the old type's coverage value across (e.g. switching
        // Home & Contents → Car shouldn't leave "Building Only" selected).
        typeSelect?.addEventListener('change', () => this.updateFormFieldsForType(typeSelect.value));

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.savePolicy();
            modal.style.display = 'none';
        });
    }

    // Shows/hides the vehicle vs property fields, relabels the sum-
    // insured inputs so they mean the right thing per type (see file
    // header — building+contents / building+loss-of-rent / agreed value),
    // and repopulates the Coverage Type dropdown with the options that
    // actually apply to this type. currentValue lets openPolicyForm carry
    // an existing policy's coverage type across into the new option list
    // (added as an extra option if it doesn't match one already).
    updateFormFieldsForType(type, currentValue = '') {
        const vehicleRow = document.getElementById('policyVehicleRow');
        const propertyRow = document.getElementById('policyPropertyRow');
        const sumRow = document.getElementById('sumInsuredRow');
        const buildingLabel = document.getElementById('sumInsuredBuildingLabel');
        const otherLabel = document.getElementById('sumInsuredOtherLabel');
        const buildingInput = document.getElementById('policySumBuilding');
        const coverageSelect = document.getElementById('policyCoverageType');

        if (coverageSelect) {
            const options = COVERAGE_TYPES[type] || COVERAGE_TYPES.other;
            const allOptions = (currentValue && !options.includes(currentValue))
                ? [...options, currentValue]
                : options;
            coverageSelect.innerHTML = '<option value="">Not set</option>' +
                allOptions.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
            coverageSelect.value = currentValue || '';
        }

        if (vehicleRow) vehicleRow.style.display = type === 'car' ? 'flex' : 'none';
        if (propertyRow) propertyRow.style.display = type === 'car' ? 'none' : 'flex';
        if (sumRow) sumRow.style.display = 'flex';

        if (type === 'home_contents') {
            if (buildingLabel) buildingLabel.textContent = 'Sum Insured — Building';
            if (otherLabel) otherLabel.textContent = 'Sum Insured — Contents';
            if (buildingInput) buildingInput.parentElement.style.display = '';
        } else if (type === 'landlord') {
            if (buildingLabel) buildingLabel.textContent = 'Sum Insured — Building';
            if (otherLabel) otherLabel.textContent = 'Loss of Rent Cover';
            if (buildingInput) buildingInput.parentElement.style.display = '';
        } else if (type === 'car') {
            if (otherLabel) otherLabel.textContent = 'Agreed/Market Value';
            if (buildingInput) buildingInput.parentElement.style.display = 'none';
        } else {
            if (otherLabel) otherLabel.textContent = 'Sum Insured';
            if (buildingInput) buildingInput.parentElement.style.display = 'none';
        }
    }

    openPolicyForm(policy = null) {
        const modal = document.getElementById('policyModal');
        const title = document.getElementById('policyModalTitle');
        const form = document.getElementById('policyForm');

        if (policy) {
            title.textContent = 'Edit Policy';
            document.getElementById('editPolicyId').value = policy.id;
            document.getElementById('policyNickname').value = policy.nickname || '';
            document.getElementById('policyType').value = policy.policyType || 'home_contents';
            document.getElementById('policyProperty').value = policy.linkedPropertyId || '';
            document.getElementById('policyVehicleMake').value = policy.vehicleMake || '';
            document.getElementById('policyVehicleModel').value = policy.vehicleModel || '';
            document.getElementById('policyVehicleRego').value = policy.vehicleRego || '';
            document.getElementById('policyProvider').value = policy.provider || '';
            document.getElementById('policyNumber').value = policy.policyNumber || '';
            document.getElementById('policyExcess').value = policy.excess ?? '';
            document.getElementById('policySumBuilding').value = policy.sumInsuredBuilding ?? '';
            document.getElementById('policySumOther').value = policy.sumInsuredOther ?? '';
            document.getElementById('policyPremium').value = policy.premiumAmount ?? '';
            document.getElementById('policyFrequency').value = policy.paymentFrequency || 'annual';
            document.getElementById('policyRenewalDate').value = policy.renewalDate || '';
            document.getElementById('policyLinkedRecurring').value = policy.linkedRecurringId || '';
            document.getElementById('policyNotes').value = policy.notes || '';
            this.updateFormFieldsForType(policy.policyType || 'home_contents', policy.coverageType || '');
        } else {
            title.textContent = 'Add New Policy';
            form.reset();
            document.getElementById('editPolicyId').value = '';
            document.getElementById('policyFrequency').value = 'annual';
            this.updateFormFieldsForType('home_contents');
        }

        modal.style.display = 'flex';
    }

    async savePolicy() {
        const policyId = document.getElementById('editPolicyId').value;
        const policyData = {
            id: policyId || generateId(),
            nickname: document.getElementById('policyNickname').value,
            policyType: document.getElementById('policyType').value,
            linkedPropertyId: document.getElementById('policyProperty').value || null,
            vehicleMake: document.getElementById('policyVehicleMake').value,
            vehicleModel: document.getElementById('policyVehicleModel').value,
            vehicleRego: document.getElementById('policyVehicleRego').value,
            provider: document.getElementById('policyProvider').value,
            policyNumber: document.getElementById('policyNumber').value,
            coverageType: document.getElementById('policyCoverageType').value,
            excess: parseFloat(document.getElementById('policyExcess').value) || 0,
            sumInsuredBuilding: parseFloat(document.getElementById('policySumBuilding').value) || 0,
            sumInsuredOther: parseFloat(document.getElementById('policySumOther').value) || 0,
            premiumAmount: parseFloat(document.getElementById('policyPremium').value) || 0,
            paymentFrequency: document.getElementById('policyFrequency').value,
            renewalDate: document.getElementById('policyRenewalDate').value,
            linkedRecurringId: document.getElementById('policyLinkedRecurring').value || null,
            notes: document.getElementById('policyNotes').value,
            createdAt: policyId ? this.policies.find(p => p.id === policyId)?.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            if (policyId) {
                await updateItem(STORE_NAMES.insurancePolicies, policyData);
            } else {
                await addItem(STORE_NAMES.insurancePolicies, policyData);
            }
            await this.init();
        } catch (error) {
            console.error('Error saving policy:', error);
            alert('Error saving policy. Please try again.');
        }
    }

    async deletePolicy(policy) {
        if (!confirm(`Delete policy "${policy.nickname || policy.provider}"?`)) return;
        try {
            await deleteItem(STORE_NAMES.insurancePolicies, policy.id);
            await this.init();
        } catch (error) {
            console.error('Error deleting policy:', error);
            alert('Error deleting policy.');
        }
    }

    formatCurrency(amount, currency) {
        return formatMoney(amount, currency); // no currency → base (used for the totals)
    }

    formatDate(date) {
        if (!date) return 'Not set';
        return new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    }
}

export async function initInsuranceUI() {
    const manager = new InsuranceManager();
    await manager.init();
}
