// ============================================================================
// 🏠 properties.js — FIXED VERSION
// ============================================================================

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId, getFinancialYear, getCurrentFinancialYear } from './db.js';
import { buildPropertyRecord } from './records.js';
import { initTenantsUI } from './tenants.js';
import { initMaintenanceUI } from './maintenance.js';
import { escapeHtml } from './sanitize.js';
import { POLICY_TYPES, getInsuranceRenewalStatus } from './insurance.js';
import { getRatesAndTaxEntriesForProperty } from './ratesAndTax.js';

import { baseEquivalent, formatMoney, getCurrencies, getBaseCurrency, hasRate, propertyAmountInBase, propertyCurrency, toAudTransactions } from './utils/currency.js';
// Bug fix: previously a new `document.addEventListener('click', ...)` was attached
// every time init() ran (i.e. every save/delete/navigation), stacking duplicate
// listeners for the life of the page and causing actions to fire multiple times.
// We now attach exactly one delegated listener and route clicks to whichever
// PropertiesManager instance is currently active.
let activePropertiesManager = null;
let propertiesDelegatedListenerAttached = false;

function attachPropertiesDelegatedListener() {
    if (propertiesDelegatedListenerAttached) return;
    propertiesDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button || !activePropertiesManager) return;
        activePropertiesManager.handlePropertyAction(button.dataset.action, button.dataset.id);
    });
}

export class PropertiesManager {
    constructor() {
        this.properties = [];
        this.tenants = [];
        this.maintenanceLogs = [];
        this.loans = [];
        this.loanTransactions = [];
        this.transactions = [];
        this.insurancePolicies = [];
        this.expenses = [];
        this.bills = [];
        this.currentFilter = 'all';
        this.currentSort = 'name';
        // null = "current FY, to date" (the default). Otherwise the July
        // start-year of a selected financial year, e.g. 2024 for FY24-25.
        this.selectedFY = null;
    }

    async init() {
        await this.loadData();
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        [this.properties, this.tenants, this.maintenanceLogs, this.loans, this.loanTransactions, this.transactions, this.insurancePolicies, this.expenses, this.bills] = await Promise.all([
            getAllItems(STORE_NAMES.properties),
            getAllItems(STORE_NAMES.tenants),
            getAllItems(STORE_NAMES.maintenance),
            getAllItems(STORE_NAMES.loans),
            getAllItems(STORE_NAMES.loanTransactions),
            getAllItems(STORE_NAMES.transactions),
            // Insurance is a newer store — .catch keeps older DBs / a not-yet-
            // upgraded schema from breaking the whole Properties page.
            getAllItems(STORE_NAMES.insurancePolicies).catch(() => []),
            // Direct Expenses-page entries — used for the Council Rates /
            // Land Tax block on the card (see renderRatesAndTaxInfo).
            getAllItems(STORE_NAMES.expenses).catch(() => []),
            // Unpaid bills — the only source of "owed but not yet paid"
            // Council Rates/Land Tax, since an unpaid bill has no
            // transactions/expenses representation at all (see
            // ratesAndTax.js).
            getAllItems(STORE_NAMES.bills).catch(() => [])
        ]);
        // Property figures feed the ATO pages, so use each transaction's AUD value.
        this.transactions = toAudTransactions(this.transactions, await getAllItems(STORE_NAMES.accounts).catch(() => []));
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');
        
        mainContent.innerHTML = `
            <div class="properties-container">
                <div class="properties-header">
                    <h2>🏠 Property Portfolio</h2>
                </div>

                ${this.renderPortfolioSummary()}

                ${this.renderQuickActions()}

                <div class="properties-controls">
                    <select id="filterPropertyType" class="form-select">
                        <option value="all">All Properties</option>
                        <option value="primary">🏠 Primary Residence</option>
                        <option value="investment">💰 Investment Properties</option>
                        <option value="vacation">🌴 Vacation Homes</option>
                        <option value="commercial">🏢 Commercial</option>
                    </select>
                    <select id="sortProperties" class="form-select">
                        <option value="name">Name A-Z</option>
                        <option value="value">Highest Value</option>
                        <option value="type">Property Type</option>
                        <option value="rent">Highest Rent</option>
                    </select>
                    <select id="filterPropertyFY" class="form-select">
                        ${this.renderFYOptions()}
                    </select>
                    <button id="btnNewProperty" class="btn btn-primary">➕ Add Property</button>
                </div>

                <div class="properties-content">
                    ${this.renderPropertiesGrid()}
                </div>

                ${this.renderPropertyModal()}
            </div>
        `;

        this.attachStaticEventListeners();
    }

    // Australian financial year (Jul 1 - Jun 30) helpers, shared by the FY
    // selector and every rental-income figure on a property card. Mirrors
    // the same July-cutover logic used in tax_compliance.js's Rental
    // Summary, so "this FY" means the same thing on both pages.
    getCurrentFYStartYear() {
        const now = new Date();
        return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    }

    getFYRange(fyStartYear) {
        return {
            fyStart: new Date(fyStartYear, 6, 1),
            fyEnd: new Date(fyStartYear + 1, 5, 30, 23, 59, 59)
        };
    }

    // Feature: without this, rental income figures were always "current FY
    // to date" with no way to look back at a completed year - useful for
    // reconciling against a return already lodged, or just checking last
    // year's numbers. Offers every FY that has at least one transaction,
    // plus the current FY even if it's empty so far.
    renderFYOptions() {
        const currentFYStart = this.getCurrentFYStartYear();
        const years = new Set([currentFYStart]);
        this.transactions.forEach(t => {
            if (!t || !t.date) return;
            const d = new Date(t.date);
            if (isNaN(d.getTime())) return;
            years.add(d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
        });
        const sortedYears = Array.from(years).sort((a, b) => b - a);
        return sortedYears.map(y => `
            <option value="${y}" ${this.selectedFY === y ? 'selected' : (this.selectedFY === null && y === currentFYStart ? 'selected' : '')}>
                FY ${y}-${String(y + 1).slice(-2)}${y === currentFYStart ? ' (current)' : ''}
            </option>
        `).join('');
    }

    renderPortfolioSummary() {
        // Ensure we have actual numbers, not promises
        const investmentProps = this.properties.filter(p => p.propertyType === 'investment');
        const primaryProps = this.properties.filter(p => p.propertyType === 'primary');
        const vacationProps = this.properties.filter(p => p.propertyType === 'vacation');
        const commercialProps = this.properties.filter(p => p.propertyType === 'commercial');
        
        // Properties can be in different currencies (an overseas property is priced in its own), so the
        // portfolio totals are summed in the base currency; each property card keeps its own currency.
        const totalPortfolioValue = this.properties.reduce((sum, p) => sum + propertyAmountInBase(p, 'currentValue'), 0);
        const investmentValue = investmentProps.reduce((sum, p) => sum + propertyAmountInBase(p, 'currentValue'), 0);
        const monthlyRent = investmentProps.reduce((sum, p) => sum + propertyAmountInBase(p, 'rent'), 0);
        const totalMortgage = primaryProps.reduce((sum, p) => sum + propertyAmountInBase(p, 'mortgage'), 0);

        return `
            <div class="portfolio-summary">
                <div class="stats-cards page-compact-cards">
                    <div class="stat-card primary">
                        <div class="stat-icon">🏠</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.properties.length}</div>
                            <div class="stat-label">Total Properties</div>
                            <div class="stat-breakdown">
                                <span>${primaryProps.length} Primary</span>
                                <span>${investmentProps.length} Investment</span>
                            </div>
                        </div>
                    </div>
                    <div class="stat-card investment">
                        <div class="stat-icon">💰</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.formatCurrency(totalPortfolioValue)}</div>
                            <div class="stat-label">Portfolio Value</div>
                            <div class="stat-breakdown">
                                <span>${this.formatCurrency(investmentValue)} Investments</span>
                            </div>
                        </div>
                    </div>
                    <div class="stat-card success">
                        <div class="stat-icon">📥</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.formatCurrency(monthlyRent)}</div>
                            <div class="stat-label">Monthly Rent</div>
                            <div class="stat-subtext">From ${investmentProps.length} properties</div>
                        </div>
                    </div>
                    <div class="stat-card warning">
                        <div class="stat-icon">🏦</div>
                        <div class="stat-content">
                            <div class="stat-value">${this.formatCurrency(totalMortgage)}</div>
                            <div class="stat-label">Monthly Mortgage</div>
                            <div class="stat-subtext">Primary residence</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderQuickActions() {
        return `
            <div class="horizontal-quick-actions">
                <div class="quick-action-item primary" id="quickAddProperty">
                    <span class="quick-action-icon">➕</span>
                    <span class="quick-action-text">Add Property</span>
                </div>
                <div class="quick-action-item investment" id="quickAddInvestment">
                    <span class="quick-action-icon">💰</span>
                    <span class="quick-action-text">Add Investment</span>
                </div>
                <div class="quick-action-item secondary" id="quickExport">
                    <span class="quick-action-icon">📤</span>
                    <span class="quick-action-text">Export</span>
                </div>
            </div>
        `;
    }

    renderPropertiesGrid() {
        if (this.properties.length === 0) {
            return this.renderEmptyState();
        }

        const filteredProperties = this.getFilteredProperties();
        const sortedProperties = this.getSortedProperties(filteredProperties);
        
        // Render cards synchronously - no async operations in render
        const cardsHtml = sortedProperties.map(property => this.renderPropertyCard(property)).join('');
        
        return `<div class="properties-grid">${cardsHtml}</div>`;
    }

    renderPropertyCard(p) {
        // Use pre-loaded data instead of async calls
        const tenant = this.tenants.find(t => t.propertyId === p.id);
        
        const currentYear = new Date().getFullYear();
        const propertyLogs = this.maintenanceLogs.filter(
            log => log.propertyId === p.id && new Date(log.date).getFullYear() === currentYear
        );
        const totalMaintenanceYTD = propertyLogs.reduce((sum, log) => sum + (parseFloat(log.cost) || 0), 0);

        const typeInfo = this.getPropertyTypeInfo(p.propertyType || 'primary');
        const metrics = this.calculatePropertyMetrics(p, tenant, totalMaintenanceYTD);
        // Real balance/repayment progress from the linked Loan record (see
        // loans.js — a loan can be linked to a property via loan.propertyId),
        // instead of the flat one-off `mortgage` number that used to be the
        // only mortgage info a property card could show.
        const linkedLoan = this.loans.find(l => l.propertyId === p.id) || null;
        // A property can have more than one policy linked to it (e.g. home
        // & contents plus a separate landlord policy on the same address),
        // so this is a list, not a single lookup like linkedLoan.
        const linkedPolicies = this.insurancePolicies.filter(pol => pol.linkedPropertyId === p.id);
        // Merged with property-linked transactions (paid bills, bank-
        // imported/auto-flagged property expenses) and unpaid bills, and
        // de-duplicated against `expenses` — see ratesAndTax.js — so a
        // rates/land tax bill paid straight from the Bills page shows up
        // here too, not just ones entered directly on the Expenses page,
        // and an unpaid one still counts as owed rather than disappearing
        // until it's paid.
        const ratesAndTaxExpenses = getRatesAndTaxEntriesForProperty(p.id, {
            expenses: this.expenses,
            transactions: this.transactions,
            bills: this.bills
        });

        return `
            <div class="property-card ${typeInfo.class}">
                <div class="property-header">
                    <div class="property-type-badge ${typeInfo.class}">
                        <span class="type-icon">${typeInfo.icon}</span>
                        <span class="type-label">${typeInfo.label}</span>
                    </div>
                    <h3 class="property-name">${escapeHtml(p.name) || 'Unnamed Property'}</h3>
                    <p class="property-address">${escapeHtml(p.address) || 'No address provided'}</p>
                </div>

                <div class="property-values">
                    <div class="value-item">
                        <span class="value-label">Current Value:</span>
                        <span class="value-amount">${this.formatCurrency(p.currentValue, p)}</span>${this.equivalentHtml(p.currentValue, p)}
                    </div>
                    ${p.purchasePrice ? `
                        <div class="value-item">
                            <span class="value-label">Purchase Price:</span>
                            <span class="value-amount">${this.formatCurrency(p.purchasePrice, p)}</span>
                        </div>
                    ` : ''}
                </div>

                ${linkedLoan ? this.renderLoanInfo(linkedLoan) : ''}

                ${linkedPolicies.length ? this.renderInsuranceInfo(linkedPolicies, p) : ''}

                ${ratesAndTaxExpenses.length ? this.renderRatesAndTaxInfo(ratesAndTaxExpenses, p) : ''}

                ${this.renderPropertyTypeContent(p, tenant, metrics, linkedLoan)}

                <div class="property-maintenance">
                    <div class="maintenance-header">
                        <span class="maintenance-icon">🧾</span>
                        <span class="maintenance-label">Maintenance YTD:</span>
                        <span class="maintenance-amount">${this.formatCurrency(totalMaintenanceYTD, p)}</span>
                    </div>
                </div>

                <div class="property-actions">
                    ${p.propertyType === 'investment' ? `
                        <button class="btn-action tenants" data-action="view-tenants" data-id="${p.id}">
                            👤 Tenants
                        </button>
                    ` : ''}
                    <button class="btn-action maintenance" data-action="view-maintenance" data-id="${p.id}">
                        🧰 Maintenance
                    </button>
                    <button class="btn-action edit" data-action="edit" data-id="${p.id}">
                        ✏️ Edit
                    </button>
                    <button class="btn-action delete" data-action="delete" data-id="${p.id}">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
    }

    renderLoanInfo(loan) {
        const progress = loan.originalAmount > 0
            ? Math.min(100, Math.max(0, ((loan.originalAmount - loan.currentBalance) / loan.originalAmount) * 100))
            : 0;
        const isPaidOff = loan.currentBalance <= 0;
        // Principal/interest paid to date, from every recorded payment
        // against this loan (manual "Make Payment" and auto recurring
        // payments both write here — see processLoanPayment in loans.js).
        const loanPayments = this.loanTransactions.filter(lt => lt.loanId === loan.id);
        const totalPrincipalPaid = loanPayments.reduce((sum, lt) => sum + (parseFloat(lt.principal) || 0), 0);
        const totalInterestPaid = loanPayments.reduce((sum, lt) => sum + (parseFloat(lt.interest) || 0), 0);
        return `
            <div class="property-loan-info">
                <div class="value-item">
                    <span class="value-label">${escapeHtml(loan.name || 'Loan')} Amount:</span>
                    <span class="value-amount">${this.formatCurrency(loan.originalAmount, loan.currency || 'AUD')}</span>
                </div>
                <div class="value-item">
                    <span class="value-label">Current Balance:</span>
                    <span class="value-amount ${isPaidOff ? 'positive' : ''}">${isPaidOff ? '✅ Paid off' : this.formatCurrency(loan.currentBalance)}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress.toFixed(1)}%"></div>
                </div>
                <small>${progress.toFixed(1)}% repaid${!isPaidOff ? ` · ${loan.interestRate}% ${loan.paymentFrequency}` : ''}</small>
                ${loanPayments.length ? `
                    <div class="value-item">
                        <span class="value-label">Principal Paid:</span>
                        <span class="value-amount">${this.formatCurrency(totalPrincipalPaid, loan.currency || 'AUD')}</span>
                    </div>
                    <div class="value-item">
                        <span class="value-label">Interest Paid:</span>
                        <span class="value-amount">${this.formatCurrency(totalInterestPaid, loan.currency || 'AUD')}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Mirrors renderLoanInfo's card-within-a-card pattern, but for every
    // insurance policy linked to this property (see js/insurance.js — a
    // policy links to a property the same way a loan does).
    //
    // Originally this was just a row of small value-item lines, which read
    // as another line of text rather than something you'd notice — unlike
    // the property-type-badge / owner-occupied-badge pills up top, which
    // are the whole point of "glanceable" status. So the coverage + renewal
    // status now leads as a solid badge in that same visual language
    // (renderInsuranceBadge), colored by urgency the same way the
    // Insurance page colors its policy cards, with the detail lines
    // (provider, sum insured, excess) kept underneath for when you want
    // them.
    renderInsuranceInfo(policies, p) {
        return policies.map(policy => {
            const typeInfo = POLICY_TYPES[policy.policyType] || POLICY_TYPES.other;
            const sumInsuredLines = [];
            if (policy.policyType === 'landlord') {
                if (policy.sumInsuredBuilding) sumInsuredLines.push(['Building', policy.sumInsuredBuilding]);
                if (policy.sumInsuredOther) sumInsuredLines.push(['Loss of rent', policy.sumInsuredOther]);
            } else {
                if (policy.sumInsuredBuilding) sumInsuredLines.push(['Building', policy.sumInsuredBuilding]);
                if (policy.sumInsuredOther) sumInsuredLines.push(['Contents', policy.sumInsuredOther]);
            }
            return `
                <div class="property-insurance-info">
                    ${this.renderInsuranceBadge(policy, typeInfo)}
                    <div class="value-item">
                        <span class="value-label">Provider:</span>
                        <span class="value-amount">${escapeHtml(policy.provider) || 'Not set'}</span>
                    </div>
                    ${sumInsuredLines.map(([label, amount]) => `
                        <div class="value-item">
                            <span class="value-label">${label} sum insured:</span>
                            <span class="value-amount">${this.formatCurrency(amount, p)}</span>
                        </div>
                    `).join('')}
                    ${policy.excess ? `
                        <div class="value-item">
                            <span class="value-label">Excess:</span>
                            <span class="value-amount">${this.formatCurrency(policy.excess, p)}</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    // The prominent pill: "🏠 Building + Contents Insured" plus a status
    // line underneath ("Renews 15 Jun 2027" / "Renews in 12d" / "12d
    // overdue" / "No renewal date set"). Solid background colored by
    // urgency (green = comfortably covered, amber/red = needs attention
    // soon) rather than the neutral light chips used elsewhere, so it reads
    // the same way the type/owner-occupied badges do at the top of the card.
    renderInsuranceBadge(policy, typeInfo) {
        const status = getInsuranceRenewalStatus(policy);
        const label = policy.coverageType || typeInfo.label;
        const dateText = policy.renewalDate
            ? new Date(policy.renewalDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
            : null;
        const statusLine = !policy.renewalDate
            ? 'No renewal date set'
            : status.class === 'overdue'
                ? `⚠️ Renewal overdue by ${Math.abs(status.daysUntil)}d`
                : `Covered to ${dateText}${status.class !== 'paid' ? ` (${status.text.toLowerCase()})` : ''}`;

        return `
            <div class="insurance-status-badge ${status.class}">
                <div class="insurance-badge-title">
                    <span class="insurance-badge-icon">${typeInfo.icon}</span>
                    <span>${escapeHtml(label)} Insured</span>
                </div>
                <div class="insurance-badge-status">${statusLine}</div>
            </div>
        `;
    }

    // Council Rates and Land Tax entries for this property, from the
    // Expenses page (STORE_NAMES.expenses, bucketed via
    // propertyExpenseCategories.js — the two are separate buckets, not
    // merged, so a property with land tax but no rates entries yet still
    // shows correctly). Each bucket shows the current-FY total plus the
    // most recent payment, with an unpaid flag if anything's outstanding —
    // "their payments etc" rather than just a running total.
    renderRatesAndTaxInfo(expenseEntries, p) {
        const currentFY = getCurrentFinancialYear();
        const renderBucket = (label, icon, entries) => {
            if (entries.length === 0) return '';
            const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
            const latest = sorted[0];
            const fyTotal = entries
                .filter(e => getFinancialYear(e.date) === currentFY)
                .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
            const unpaidCount = entries.filter(e => e.status === 'Unpaid').length;
            return `
                <div class="value-item">
                    <span class="value-label">${icon} ${label} (this FY):</span>
                    <span class="value-amount">${this.formatCurrency(fyTotal, p)}</span>
                </div>
                <div class="value-item">
                    <span class="value-label">Last payment:</span>
                    <span class="value-amount">
                        ${this.formatCurrency(latest.amount, p)} on ${new Date(latest.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        ${unpaidCount > 0
                            ? `<span class="status-badge overdue">⚠️ ${unpaidCount} unpaid</span>`
                            : `<span class="status-badge paid">✅ Paid</span>`}
                    </span>
                </div>
            `;
        };
        return `
            <div class="property-rates-tax-info">
                ${renderBucket('Council Rates', '📄', expenseEntries.filter(e => e.category === 'Council Rates'))}
                ${renderBucket('Land Tax', '🏛️', expenseEntries.filter(e => e.category === 'Land Tax'))}
            </div>
        `;
    }

    renderPropertyTypeContent(p, tenant, metrics, linkedLoan) {
        switch (p.propertyType) {
            case 'investment':
                return this.renderInvestmentContent(p, tenant, metrics);
            case 'primary':
                return this.renderPrimaryContent(p, metrics, linkedLoan);
            default:
                return this.renderOtherContent(p, metrics);
        }
    }

    renderInvestmentContent(p, tenant, metrics) {
        // Rental income actually received, aggregated from transactions
        // matched to this property (see matchPropertyByAccount /
        // findLearnedPropertyForTransaction / matchPropertyForTransaction
        // in js/import/categoryMapper.js).
        const rentalTx = this.transactions.filter(t => t.propertyId === p.id && t.categoryId === 'sub_rental_income');
        const totalRentalIncome = rentalTx.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

        // Feature: respects the FY picker at the top of the page (defaults
        // to the current FY, to date) instead of always showing a fixed
        // "current FY to date" figure with no way to look back.
        const fyStartYear = this.selectedFY ?? this.getCurrentFYStartYear();
        const { fyStart, fyEnd } = this.getFYRange(fyStartYear);
        const isCurrentFY = fyStartYear === this.getCurrentFYStartYear();
        const rentalIncomeFY = rentalTx
            .filter(t => { const d = new Date(t.date); return d >= fyStart && d <= fyEnd; })
            .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
        const fyLabel = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}${isCurrentFY ? ' to date' : ''}`;

        return `
            <div class="investment-content">
                <div class="rental-info">
                    <div class="rent-amount">
                        <span class="rent-label">Monthly Rent:</span>
                        <span class="rent-value">${this.formatCurrency(p.rent, p)}</span>
                    </div>
                    ${tenant ? `
                        <div class="tenant-status occupied">
                            <span class="tenant-icon">👤</span>
                            <span class="tenant-name">${escapeHtml(tenant.name)}</span>
                            ${tenant.startDate ? `
                                <span class="tenant-since">Since ${new Date(tenant.startDate).toLocaleDateString('en-AU')}</span>
                            ` : ''}
                        </div>
                    ` : `
                        <div class="tenant-status vacant">
                            <span class="vacant-icon">🏠</span>
                            <span class="vacant-text">Vacant - No Tenant</span>
                        </div>
                    `}
                    ${rentalTx.length ? `
                        <div class="rent-amount">
                            <span class="rent-label">Rental Income (${fyLabel}):</span>
                            <span class="rent-value">${this.formatCurrency(rentalIncomeFY, 'AUD')}</span>
                        </div>
                        <div class="rent-amount">
                            <span class="rent-label">Rental Income (All Time):</span>
                            <span class="rent-value">${this.formatCurrency(totalRentalIncome, 'AUD')}</span>
                        </div>
                    ` : `
                        <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0.5rem 0 0;">
                            No rental income transactions linked to this property yet.
                            If a rent deposit's description mentions the property address, this
                            usually resolves after running <strong>Settings → Review & Fix Property Matches</strong> -
                            check the property's Address field matches what appears in the transaction if it still doesn't.
                        </p>
                    `}
                </div>
                <div class="investment-metrics">
                    <div class="metric-item">
                        <span class="metric-label">ROI:</span>
                        <span class="metric-value ${parseFloat(metrics.roi) > 5 ? 'positive' : ''}">${metrics.roi}%</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">Value Change:</span>
                        <span class="metric-value ${parseFloat(metrics.valueChange) > 0 ? 'positive' : 'negative'}">${metrics.valueChange}%</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderPrimaryContent(p, metrics, linkedLoan) {
        return `
            <div class="primary-content">
                <div class="residence-info">
                    <div class="owner-occupied-badge">
                        <span class="owner-icon">👨‍👩‍👧‍👦</span>
                        <span class="owner-text">Owner Occupied</span>
                    </div>
                    ${(p.mortgage && !linkedLoan) ? `
                        <div class="mortgage-info">
                            <span class="mortgage-label">Monthly Mortgage:</span>
                            <span class="mortgage-amount">${this.formatCurrency(p.mortgage, p)}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="equity-info">
                    <div class="equity-item">
                        <span class="equity-label">Home Equity:</span>
                        <span class="equity-value">${this.formatCurrency(metrics.equity, p)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderOtherContent(p, metrics) {
        const typeLabel = p.propertyType === 'vacation' ? '🌴 Vacation & Personal Use' : '🏢 Business & Commercial';
        return `
            <div class="other-content">
                <div class="property-purpose">
                    ${typeLabel}
                </div>
                ${p.rent ? `
                    <div class="rental-potential">
                        <span>Potential Rent: ${this.formatCurrency(p.rent, p)}/mo</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderPropertyModal() {
        return `
            <div id="propertyModal" class="modal-overlay" style="display: none;">
                <div class="modal">
                    <div class="modal-header">
                        <h3 id="modalTitle">Add New Property</h3>
                        <button class="btn-close" id="closeModal">✕</button>
                    </div>
                    <form id="propertyForm" class="modal-form">
                        <input type="hidden" id="editPropertyId" value="">
                        
                        <div class="form-group">
                            <label>Property Type</label>
                            <select id="propertyType" class="form-select" required>
                                <option value="primary">🏠 Primary Residence</option>
                                <option value="investment">💰 Investment Property</option>
                                <option value="vacation">🌴 Vacation Home</option>
                                <option value="commercial">🏢 Commercial Property</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Property Name</label>
                            <input type="text" id="propertyName" class="form-input" 
                                   placeholder="e.g., Family Home, City Apartment" required>
                        </div>

                        <div class="form-group">
                            <label>Address</label>
                            <input type="text" id="propertyAddress" class="form-input" 
                                   placeholder="Full property address" required>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Purchase Price</label>
                                <input type="number" id="purchasePrice" class="form-input" step="0.01" min="0" required>
                            </div>
                            <div class="form-group">
                                <label>Current Market Value</label>
                                <input type="number" id="currentValue" class="form-input" step="0.01" min="0" required>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Property Currency</label>
                            <select id="propertyCurrency" class="form-select">
                                ${getCurrencies().map(c => `<option value="${c.code}">${c.code} — ${c.name}</option>`).join('')}
                            </select>
                            <small class="form-hint">The currency its price, value, rent and mortgage are in (an overseas property is priced in its own currency).</small>
                        </div>

                        <div class="form-group" id="rentField">
                            <label>Monthly Rent</label>
                            <input type="number" id="propertyRent" class="form-input" step="0.01" min="0" value="0">
                        </div>

                        <div class="form-group" id="mortgageField" style="display: none;">
                            <label>Monthly Mortgage Payment</label>
                            <input type="number" id="propertyMortgage" class="form-input" step="0.01" min="0" value="0">
                        </div>

                        <div class="form-group" id="loanBalanceField" style="display: none;">
                            <label>Outstanding Loan Balance</label>
                            <input type="number" id="propertyOutstandingLoanBalance" class="form-input" step="0.01" min="0" value="0">
                            <small class="form-hint">Used to calculate your equity (current value − outstanding balance)</small>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">💾 Save Property</button>
                            <button type="button" class="btn btn-secondary" id="cancelProperty">Cancel</button>
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
                    <div class="empty-icon">🏠</div>
                    <h3>No Properties Yet</h3>
                    <p>Start by adding your first property to track your real estate portfolio.</p>
                    <button class="btn btn-primary" id="emptyAddProperty">Add Your First Property</button>
                </div>
            </div>
        `;
    }

    attachStaticEventListeners() {
        // Quick actions
        document.getElementById('quickAddProperty')?.addEventListener('click', () => this.openPropertyForm());
        document.getElementById('quickAddInvestment')?.addEventListener('click', () => this.openPropertyForm('investment'));
        document.getElementById('quickExport')?.addEventListener('click', () => this.exportPortfolio());
        document.getElementById('emptyAddProperty')?.addEventListener('click', () => this.openPropertyForm());
        document.getElementById('btnNewProperty')?.addEventListener('click', () => this.openPropertyForm());

        // Filters and sorting
        document.getElementById('filterPropertyType')?.addEventListener('change', (e) => {
            this.currentFilter = e.target.value;
            this.renderUI();
        });

        document.getElementById('sortProperties')?.addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.renderUI();
        });

        document.getElementById('filterPropertyFY')?.addEventListener('change', (e) => {
            const y = parseInt(e.target.value, 10);
            this.selectedFY = isNaN(y) ? null : y;
            this.renderUI();
        });
    }

    attachEventListeners() {
        this.attachStaticEventListeners();

        // Property actions - use a single delegated listener shared across instances
        // (fixes duplicate-listener bug where re-init() on every save/delete/nav
        // stacked a new document-level listener without removing the old one)
        activePropertiesManager = this;
        attachPropertiesDelegatedListener();

        // Modal events
        this.setupModalEvents();
    }

    handlePropertyAction(action, propertyId) {
        const property = this.properties.find(p => p.id === propertyId);
        if (!property) return;

        switch (action) {
            case 'edit':
                this.openPropertyForm(null, property);
                break;
            case 'delete':
                this.deleteProperty(property);
                break;
            case 'view-tenants':
                initTenantsUI(propertyId);
                break;
            case 'view-maintenance':
                initMaintenanceUI(propertyId);
                break;
        }
    }

    setupModalEvents() {
        const modal = document.getElementById('propertyModal');
        const form = document.getElementById('propertyForm');
        const closeBtn = document.getElementById('closeModal');
        const cancelBtn = document.getElementById('cancelProperty');
        const typeSelect = document.getElementById('propertyType');

        // Toggle rent/mortgage fields based on property type
        typeSelect?.addEventListener('change', (e) => {
            const type = e.target.value;
            const rentField = document.getElementById('rentField');
            const mortgageField = document.getElementById('mortgageField');
            const loanBalanceField = document.getElementById('loanBalanceField');
            
            if (type === 'primary') {
                rentField.style.display = 'none';
                mortgageField.style.display = 'block';
                loanBalanceField.style.display = 'block';
            } else {
                rentField.style.display = 'block';
                mortgageField.style.display = 'none';
                loanBalanceField.style.display = 'none';
            }
        });

        [closeBtn, cancelBtn].forEach(btn => {
            btn?.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveProperty();
            modal.style.display = 'none';
        });

        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    // Core functionality methods
    async openPropertyForm(prefillType = null, property = null) {
        const modal = document.getElementById('propertyModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('propertyForm');
        const typeSelect = document.getElementById('propertyType');

        if (property) {
            title.textContent = 'Edit Property';
            document.getElementById('editPropertyId').value = property.id;
            document.getElementById('propertyName').value = property.name || '';
            document.getElementById('propertyAddress').value = property.address || '';
            document.getElementById('purchasePrice').value = property.purchasePrice || '';
            document.getElementById('currentValue').value = property.currentValue || '';
            document.getElementById('propertyCurrency').value = propertyCurrency(property);
            document.getElementById('propertyRent').value = property.rent || '0';
            document.getElementById('propertyMortgage').value = property.mortgage || '0';
            document.getElementById('propertyOutstandingLoanBalance').value = property.outstandingLoanBalance || '0';
            typeSelect.value = property.propertyType || 'primary';
        } else {
            title.textContent = 'Add New Property';
            form.reset();
            document.getElementById('editPropertyId').value = '';
            document.getElementById('propertyCurrency').value = 'AUD'; // new properties default to AUD; pick another for an overseas one
            document.getElementById('propertyRent').value = '0';
            document.getElementById('propertyMortgage').value = '0';
            document.getElementById('propertyOutstandingLoanBalance').value = '0';
            if (prefillType) {
                typeSelect.value = prefillType;
            }
        }

        // Trigger field visibility
        typeSelect.dispatchEvent(new Event('change'));
        modal.style.display = 'flex';
    }

    async saveProperty() {
        const form = document.getElementById('propertyForm');
        const propertyId = document.getElementById('editPropertyId').value;
        const type = document.getElementById('propertyType').value;

        // Start from the saved record so fields set elsewhere (links, notes) aren't wiped by an edit.
        const existing = propertyId ? (this.properties.find(p => p.id === propertyId) || {}) : {};
        // Built by the shared records.js so the setup guide (onboarding.js)
        // creates properties identical to ones added here.
        const propertyData = buildPropertyRecord({
            currency: document.getElementById('propertyCurrency').value,
            name: document.getElementById('propertyName').value,
            address: document.getElementById('propertyAddress').value,
            purchasePrice: document.getElementById('purchasePrice').value,
            currentValue: document.getElementById('currentValue').value,
            propertyType: type,
            rent: type !== 'primary' ? document.getElementById('propertyRent').value : 0,
            mortgage: type === 'primary' ? document.getElementById('propertyMortgage').value : 0,
            outstandingLoanBalance: type === 'primary' ? document.getElementById('propertyOutstandingLoanBalance').value : 0
        }, { id: propertyId || generateId(), existing, isEdit: !!propertyId });

        try {
            if (propertyId) {
                await updateItem(STORE_NAMES.properties, propertyData);
            } else {
                await addItem(STORE_NAMES.properties, propertyData);
            }
            await this.init(); // Refresh UI
        } catch (error) {
            console.error('Error saving property:', error);
            alert('Error saving property. Please try again.');
        }
    }

    async deleteProperty(property) {
        if (!confirm(`Delete "${property.name}"? This will also remove related tenants and maintenance records.`)) return;

        try {
            await deleteItem(STORE_NAMES.properties, property.id);
            await this.init(); // Refresh UI
        } catch (error) {
            console.error('Error deleting property:', error);
            alert('Error deleting property.');
        }
    }

    // Helper methods
    getFilteredProperties() {
        if (this.currentFilter === 'all') return this.properties;
        return this.properties.filter(p => p.propertyType === this.currentFilter);
    }

    getSortedProperties(properties) {
        return [...properties].sort((a, b) => {
            switch (this.currentSort) {
                case 'name': return (a.name || '').localeCompare(b.name || '');
                case 'value': return (parseFloat(b.currentValue) || 0) - (parseFloat(a.currentValue) || 0);
                case 'rent': return (parseFloat(b.rent) || 0) - (parseFloat(a.rent) || 0);
                case 'type': return (a.propertyType || 'primary').localeCompare(b.propertyType || 'primary');
                default: return (a.name || '').localeCompare(b.name || '');
            }
        });
    }

    getPropertyTypeInfo(propertyType) {
        const types = {
            primary: { icon: '🏠', label: 'Primary Home', class: 'primary' },
            investment: { icon: '💰', label: 'Investment', class: 'investment' },
            vacation: { icon: '🌴', label: 'Vacation', class: 'vacation' },
            commercial: { icon: '🏢', label: 'Commercial', class: 'commercial' }
        };
        return types[propertyType] || types.primary;
    }

    calculatePropertyMetrics(p, tenant, maintenanceYTD) {
        const annualRent = (parseFloat(p.rent) || 0) * 12;
        const netOperatingIncome = annualRent - maintenanceYTD;
        
        const roi = p.purchasePrice && p.rent
            ? ((annualRent) / parseFloat(p.purchasePrice) * 100).toFixed(1)
            : '0.0';

        const valueChange = p.currentValue && p.purchasePrice
            ? (((parseFloat(p.currentValue) - parseFloat(p.purchasePrice)) / parseFloat(p.purchasePrice)) * 100).toFixed(1)
            : '0.0';

        // Bug fix: equity was previously calculated as
        // currentValue - (monthlyMortgagePayment * 12 * 30), which wrongly assumes
        // 30 years of repayments equal the outstanding loan balance (ignores
        // interest/principal split and how far into the loan you actually are).
        // We now use an explicit "outstanding loan balance" field the user enters.
        const outstandingLoan = parseFloat(p.outstandingLoanBalance) || 0;
        const equity = Math.max(0, (parseFloat(p.currentValue) || 0) - outstandingLoan);

        return {
            roi,
            valueChange,
            equity: equity
        };
    }

    exportPortfolio() {
        const csv = this.convertToCSV(this.properties);
        this.downloadCSV(csv, 'property-portfolio.csv');
    }

    convertToCSV(properties) {
        const headers = ['Name', 'Type', 'Address', 'Currency', 'Purchase Price', 'Current Value', 'Rent', 'Mortgage', 'Outstanding Loan Balance', 'Equity'];
        const rows = properties.map(p => [
            p.name,
            this.getPropertyTypeInfo(p.propertyType).label,
            p.address,
            propertyCurrency(p),
            p.purchasePrice,
            p.currentValue,
            p.rent || '',
            p.mortgage || '',
            p.outstandingLoanBalance || '',
            Math.max(0, (parseFloat(p.currentValue) || 0) - (parseFloat(p.outstandingLoanBalance) || 0))
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

    // "≈ AUD 1,234" under a foreign property's value so it can be compared with the rest of the portfolio.
    // Empty for properties already in the base currency, or when no rate is on file.
    equivalentHtml(amount, p) {
        const cur = propertyCurrency(p);
        if (cur === getBaseCurrency() || !hasRate(cur)) return '';
        return `<small class="value-equivalent" style="display:block;font-size:0.75rem;opacity:0.65;">${baseEquivalent(amount, cur)}</small>`;
    }

    // Second argument: a property (uses its currency), a currency code, or nothing (= base currency, which
    // is what the portfolio totals are in).
    formatCurrency(amount, currencyOrProperty) {
        const code = typeof currencyOrProperty === 'string' ? currencyOrProperty
            : currencyOrProperty ? propertyCurrency(currencyOrProperty) : undefined;
        return formatMoney(amount, code);
    }
}

// Backwards compatibility
export async function initPropertiesUI() {
    const manager = new PropertiesManager();
    await manager.init();
}