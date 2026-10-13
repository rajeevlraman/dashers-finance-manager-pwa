// ============================================================================
// 🚗 vehicles.js — Vehicle Registration, Mileage & Licence Manager
// ============================================================================
// A vehicle record distinct from a car insurance policy (see js/insurance.js)
// — rego, odometer, and driver's licence are all things that renew/change on
// their own schedule, independent of the insurance renewal date. A vehicle
// can optionally link to a car insurance policy (linkedInsurancePolicyId) so
// its card can also show that policy's status, the same way a Property links
// to a Loan and to Insurance policies elsewhere in the app — the link lives
// on the vehicle side here since a policy already models "vehicle" as free
// text (make/model/rego) rather than a foreign key, and this avoids touching
// that already-working page.
//
// Two independent renewal clocks live on one record — registration and
// driver's licence — so getDateStatus() below is a small generic version of
// insurance.js's getInsuranceRenewalStatus, parametrised by which date to
// check, rather than two near-duplicate functions.

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId } from './db.js';
import { escapeHtml } from './sanitize.js';
import { getInsuranceRenewalStatus } from './insurance.js';
import { computeVehicleFuelStats, addOdometerReading } from './vehicleFuelStats.js';

import { formatMoney, toBaseTransactions } from './utils/currency.js';
// Same 30/60-day "time to act" windows as insurance renewals — enough lead
// time to book a rego renewal or a licence appointment before it lapses.
export function getDateStatus(dateStr, today = new Date().toISOString().slice(0, 10)) {
    if (!dateStr) return { text: 'Not set', class: 'upcoming', icon: '❔' };
    const daysUntil = Math.floor((new Date(dateStr) - new Date(today)) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return { text: `${Math.abs(daysUntil)}d overdue`, class: 'overdue', icon: '🚨', daysUntil };
    if (daysUntil <= 30) return { text: `Due in ${daysUntil}d`, class: 'due-soon', icon: '⏰', daysUntil };
    if (daysUntil <= 60) return { text: `Due in ${daysUntil}d`, class: 'upcoming', icon: '📅', daysUntil };
    return { text: 'Active', class: 'paid', icon: '🟢', daysUntil };
}

export function getRegoStatus(vehicle, today) {
    return getDateStatus(vehicle.regoExpiryDate, today);
}

export function getLicenceStatus(vehicle, today) {
    return getDateStatus(vehicle.licenceExpiryDate, today);
}


// Annualised rego cost, same reasoning as insurance.js's annualPremium — a
// 6-monthly-paid rego shouldn't be compared 1:1 against an annual one.
export function annualRegoCost(vehicle) {
    const amt = parseFloat(vehicle.regoCost) || 0;
    return vehicle.regoFrequency === 'six_monthly' ? amt * 2 : amt;
}

// All-time rego spend for one vehicle, straight from its linked
// Registration transactions — separate from vehicle.regoCost (which only
// ever reflects the single most recent payment, for the annualised figure
// above). Two vehicles paying the same current rate can still have very
// different lifetime totals (one's been on the books for years, the other
// just added), and that's only visible by actually summing the linked
// transactions rather than reading the vehicle record.
export function getVehicleRegoHistory(vehicleId, transactions) {
    const linked = transactions.filter(t =>
        t.vehicleId === vehicleId && t.categoryId === 'sub_rego' && !t.isTransfer
    );
    const totalPaid = linked.reduce((sum, t) => sum + (Math.abs(t.amount) || 0), 0);
    return { totalPaid, count: linked.length };
}

let activeVehiclesManager = null;
let vehiclesDelegatedListenerAttached = false;

function attachVehiclesDelegatedListener() {
    if (vehiclesDelegatedListenerAttached) return;
    vehiclesDelegatedListenerAttached = true;
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-vehicle-action]');
        if (!button || !activeVehiclesManager) return;
        activeVehiclesManager.handleVehicleAction(button.dataset.vehicleAction, button.dataset.id);
    });
}

export class VehiclesManager {
    constructor() {
        this.vehicles = [];
        this.insurancePolicies = [];
        this.transactions = [];
    }

    async init() {
        await this.loadData();
        this.renderUI();
        this.attachEventListeners();
    }

    async loadData() {
        let rawTransactions;
        let accounts;
        [this.vehicles, this.insurancePolicies, rawTransactions, accounts] = await Promise.all([
            getAllItems(STORE_NAMES.vehicles),
            // Insurance is only used here for the optional "linked policy"
            // status shown on a vehicle card — .catch keeps this page
            // working even if that store isn't there yet.
            getAllItems(STORE_NAMES.insurancePolicies).catch(() => []),
            // Only used for the all-time rego total per vehicle — see
            // getVehicleRegoHistory above.
            getAllItems(STORE_NAMES.transactions).catch(() => []),
            getAllItems(STORE_NAMES.accounts).catch(() => [])
        ]);
        // Rego totals sum across accounts, so put every transaction in the base currency.
        this.transactions = toBaseTransactions(rawTransactions, accounts);
    }

    refreshUI() {
        this.renderUI();
        this.attachEventListeners();
    }

    getSortedVehicles() {
        // Whichever of rego/licence is closer to needing attention floats
        // to the top — the whole point of the page is "what needs
        // attention next", same as the Insurance page.
        const soonest = (v) => Math.min(
            v.regoExpiryDate ? getRegoStatus(v).daysUntil ?? Infinity : Infinity,
            v.licenceExpiryDate ? getLicenceStatus(v).daysUntil ?? Infinity : Infinity
        );
        return [...this.vehicles].sort((a, b) => soonest(a) - soonest(b));
    }

    renderUI() {
        const mainContent = document.getElementById('mainContent');
        mainContent.innerHTML = `
            <div class="tenants-container vehicles-container">
                <div class="tenants-header">
                    <div class="header-main">
                        <h2>🚗 Vehicles</h2>
                        <button id="btnNewVehicle" class="btn btn-primary">➕ Add Vehicle</button>
                    </div>
                </div>

                ${this.renderStats()}

                <div class="tenants-content">
                    ${this.renderVehiclesList()}
                </div>

                ${this.renderVehicleModal()}
            </div>
        `;
    }

    renderStats() {
        const totalAnnualRego = this.vehicles.reduce((sum, v) => sum + annualRegoCost(v), 0);
        const totalPaidAllTime = this.vehicles.reduce(
            (sum, v) => sum + getVehicleRegoHistory(v.id, this.transactions).totalPaid, 0
        );
        const needsAttention = this.vehicles.filter(v => {
            const rego = getRegoStatus(v);
            const licence = getLicenceStatus(v);
            return ['overdue', 'due-soon'].includes(rego.class) || ['overdue', 'due-soon'].includes(licence.class);
        });
        return `
            <div class="tenant-stats page-compact-cards">
                <div class="stat-card">
                    <div class="stat-icon">🚗</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.vehicles.length}</div>
                        <div class="stat-label">Vehicles</div>
                        <div class="stat-subtext">Tracked</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💰</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.formatCurrency(totalAnnualRego)}</div>
                        <div class="stat-label">Total Annual Rego</div>
                        <div class="stat-subtext">Normalised to yearly cost, at current rates</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🧾</div>
                    <div class="stat-content">
                        <div class="stat-value">${this.formatCurrency(totalPaidAllTime)}</div>
                        <div class="stat-label">Total Rego Paid</div>
                        <div class="stat-subtext">All vehicles, all-time from linked transactions</div>
                    </div>
                </div>
                <div class="stat-card ${needsAttention.length > 0 ? 'overdue' : ''}">
                    <div class="stat-icon">⏰</div>
                    <div class="stat-content">
                        <div class="stat-value">${needsAttention.length}</div>
                        <div class="stat-label">Rego/Licence Due ≤30 Days</div>
                        <div class="stat-subtext">Time to renew</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderVehiclesList() {
        const sorted = this.getSortedVehicles();
        if (sorted.length === 0) return this.renderEmptyState();
        return `<div class="tenants-grid">${sorted.map(v => this.renderVehicleCard(v)).join('')}</div>`;
    }

    // The two things worth noticing at a glance — rego and licence renewal —
    // lead as solid colored pills (same visual language as the Insurance
    // badge on the Properties page: green = comfortably covered, amber/red
    // = needs attention), with the rest of the record underneath.
    renderStatusBadge(label, icon, dateStr, status) {
        const dateText = dateStr
            ? new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
            : null;
        const statusLine = !dateStr
            ? 'No date set'
            : status.class === 'overdue'
                ? `⚠️ Overdue by ${Math.abs(status.daysUntil)}d`
                : `Due ${dateText}${status.class !== 'paid' ? ` (${status.text.toLowerCase()})` : ''}`;
        return `
            <div class="insurance-status-badge ${status.class}">
                <div class="insurance-badge-title">
                    <span class="insurance-badge-icon">${icon}</span>
                    <span>${escapeHtml(label)}</span>
                </div>
                <div class="insurance-badge-status">${statusLine}</div>
            </div>
        `;
    }

    renderVehicleCard(vehicle) {
        const regoStatus = getRegoStatus(vehicle);
        const licenceStatus = getLicenceStatus(vehicle);
        const linkedPolicy = vehicle.linkedInsurancePolicyId
            ? this.insurancePolicies.find(p => p.id === vehicle.linkedInsurancePolicyId)
            : null;
        const makeModel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
        const regoHistory = getVehicleRegoHistory(vehicle.id, this.transactions);
        const fuel = computeVehicleFuelStats(vehicle, this.transactions);

        return `
            <div class="tenant-card">
                <div class="tenant-header">
                    <h3 class="tenant-name">🚗 ${escapeHtml(vehicle.nickname || makeModel || 'Vehicle')}</h3>
                </div>

                ${this.renderStatusBadge('Registration', '🪪', vehicle.regoExpiryDate, regoStatus)}
                ${vehicle.licenceExpiryDate || vehicle.licenceHolder ? this.renderStatusBadge(
                    vehicle.licenceHolder ? `${vehicle.licenceHolder}'s Licence` : 'Driver Licence',
                    '🛂', vehicle.licenceExpiryDate, licenceStatus
                ) : ''}

                <div class="tenant-details">
                    ${makeModel ? `
                        <div class="detail-item">
                            <span class="detail-label">🚙 Vehicle:</span>
                            <span class="detail-value">${escapeHtml(makeModel)}</span>
                        </div>
                    ` : ''}
                    ${vehicle.rego ? `
                        <div class="detail-item">
                            <span class="detail-label">🔢 Rego Plate:</span>
                            <span class="detail-value">${escapeHtml(vehicle.rego)}</span>
                        </div>
                    ` : ''}
                    ${vehicle.regoCost ? `
                        <div class="detail-item">
                            <span class="detail-label">💵 Rego Cost:</span>
                            <span class="detail-value">${this.formatCurrency(vehicle.regoCost)} ${vehicle.regoFrequency === 'six_monthly' ? '/ 6mo' : '/yr'} <span style="color:var(--text-muted, #94a3b8); font-weight:400;">(latest payment)</span></span>
                        </div>
                    ` : ''}
                    ${regoHistory.count > 0 ? `
                        <div class="detail-item">
                            <span class="detail-label">🧾 Total Rego Paid:</span>
                            <span class="detail-value">${this.formatCurrency(regoHistory.totalPaid)} across ${regoHistory.count} payment${regoHistory.count === 1 ? '' : 's'}</span>
                        </div>
                    ` : ''}
                    ${vehicle.odometerReading ? `
                        <div class="detail-item">
                            <span class="detail-label">🛣️ Odometer:</span>
                            <span class="detail-value">${Number(vehicle.odometerReading).toLocaleString('en-AU')} km${vehicle.odometerDate ? ` (as of ${this.formatDate(vehicle.odometerDate)})` : ''}</span>
                        </div>
                    ` : ''}
                    ${fuel ? `
                        <div class="detail-item">
                            <span class="detail-label">⛽ Fuel (12 mo):</span>
                            <span class="detail-value">${this.formatCurrency(fuel.spend12m)} across ${fuel.fills12m} fill${fuel.fills12m === 1 ? '' : 's'}${fuel.fills12m ? ` (avg ${this.formatCurrency(fuel.avgFill12m)})` : ''}</span>
                        </div>
                        ${fuel.spendThisMonth ? `
                        <div class="detail-item">
                            <span class="detail-label">📅 Fuel this month:</span>
                            <span class="detail-value">${this.formatCurrency(fuel.spendThisMonth)}</span>
                        </div>
                        ` : ''}
                        ${fuel.mileage ? `
                        <div class="detail-item">
                            <span class="detail-label">🚙 Mileage:</span>
                            <span class="detail-value">${fuel.mileage.kind === 'estimate' ? '≈ ' : ''}${fuel.mileage.lPer100.toFixed(1)} L/100km (${fuel.mileage.kmPerL.toFixed(1)} km/L) <span style="color:var(--text-muted, #94a3b8); font-weight:400;">${fuel.mileage.kind === 'actual' ? `actual, over ${Math.round(fuel.mileage.km).toLocaleString('en-AU')} km` : `estimate — litres guessed at ${fuel.mileage.price ? '$' + fuel.mileage.price.toFixed(2) + '/L' : 'a set price'}, over ${Math.round(fuel.mileage.km).toLocaleString('en-AU')} km`}</span></span>
                        </div>
                        ` : `
                        <div class="detail-item">
                            <span class="detail-label">🚙 Mileage:</span>
                            <span class="detail-value" style="color:var(--text-muted, #94a3b8); font-weight:400;">Needs two odometer readings — add the odometer (and litres) on fuel fills${vehicle.fuelPricePerLitre ? '' : ', or set a fuel price on this vehicle'}</span>
                        </div>
                        `}
                        ${fuel.costPerKm ? `
                        <div class="detail-item">
                            <span class="detail-label">📏 Fuel cost per km:</span>
                            <span class="detail-value">${formatMoney(fuel.costPerKm.value)}/km <span style="color:var(--text-muted, #94a3b8); font-weight:400;">(${this.formatCurrency(fuel.costPerKm.spend)} over ${Math.round(fuel.costPerKm.km).toLocaleString('en-AU')} km)</span></span>
                        </div>
                        ` : ''}
                    ` : ''}
                    ${vehicle.licenceNumber ? `
                        <div class="detail-item">
                            <span class="detail-label">🪪 Licence #:</span>
                            <span class="detail-value">${escapeHtml(vehicle.licenceNumber)}</span>
                        </div>
                    ` : ''}
                    ${linkedPolicy ? `
                        <div class="detail-item">
                            <span class="detail-label">🛡️ Insurance:</span>
                            <span class="detail-value">${escapeHtml(linkedPolicy.provider) || 'Linked policy'} · ${getInsuranceRenewalStatus(linkedPolicy).text}</span>
                        </div>
                    ` : ''}
                    ${vehicle.notes ? `
                        <div class="detail-item">
                            <span class="detail-label">📝 Notes:</span>
                            <span class="detail-value">${escapeHtml(vehicle.notes)}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="tenant-actions">
                    <button class="btn-action edit" data-vehicle-action="edit" data-id="${vehicle.id}">✏️ Edit</button>
                    <button class="btn-action delete" data-vehicle-action="delete" data-id="${vehicle.id}">🗑️ Delete</button>
                </div>
            </div>
        `;
    }

    renderEmptyState() {
        return `
            <div class="section-card">
                <div class="empty-state">
                    <div class="empty-icon">🚗</div>
                    <h3>No Vehicles Found</h3>
                    <p>Add a vehicle to track its registration renewal, odometer reading, and driver's licence in one place.</p>
                    <button class="btn btn-primary" id="emptyAddVehicle">Add Your First Vehicle</button>
                </div>
            </div>
        `;
    }

    renderVehicleModal() {
        // Only car policies make sense to link — home/contents/landlord
        // policies have no vehicle to attach to.
        const carPolicyOptions = this.insurancePolicies
            .filter(p => p.policyType === 'car')
            .map(p => `<option value="${p.id}">${escapeHtml(p.nickname || p.provider || 'Car Policy')}</option>`)
            .join('');

        return `
            <div id="vehicleModal" class="modal-overlay" style="display: none;">
                <div class="modal">
                    <div class="modal-header">
                        <h3 id="vehicleModalTitle">Add New Vehicle</h3>
                        <button class="btn-close" id="closeVehicleModal">✕</button>
                    </div>
                    <form id="vehicleForm" class="modal-form">
                        <input type="hidden" id="editVehicleId" value="">

                        <div class="form-row">
                            <div class="form-group">
                                <label>Nickname</label>
                                <input type="text" id="vehicleNickname" class="form-input" placeholder="e.g. Dad's Ute" required>
                            </div>
                            <div class="form-group">
                                <label>Rego Plate</label>
                                <input type="text" id="vehicleRego" class="form-input" placeholder="e.g. 1ABC234">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Make</label>
                                <input type="text" id="vehicleMake" class="form-input" placeholder="e.g. Toyota">
                            </div>
                            <div class="form-group">
                                <label>Model</label>
                                <input type="text" id="vehicleModel" class="form-input" placeholder="e.g. HiLux">
                            </div>
                            <div class="form-group">
                                <label>Year</label>
                                <input type="number" id="vehicleYear" class="form-input" placeholder="e.g. 2021">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Rego Expiry Date</label>
                                <input type="date" id="vehicleRegoExpiry" class="form-input">
                            </div>
                            <div class="form-group">
                                <label>Rego Cost</label>
                                <input type="number" id="vehicleRegoCost" class="form-input" step="0.01" min="0">
                                <small class="form-hint">The amount of ONE payment — e.g. $110 if you pay every 6 months, not the $220 yearly total. "Paid" below is what turns this into the annual figure shown in Total Annual Rego.</small>
                            </div>
                            <div class="form-group">
                                <label>Paid</label>
                                <select id="vehicleRegoFrequency" class="form-select">
                                    <option value="annual">Annually</option>
                                    <option value="six_monthly">Every 6 Months</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Odometer Reading (km)</label>
                                <input type="number" id="vehicleOdometer" class="form-input" step="1" min="0">
                            </div>
                            <div class="form-group">
                                <label>As Of Date</label>
                                <input type="date" id="vehicleOdometerDate" class="form-input">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Fuel Price ($/L, optional)</label>
                                <input type="number" id="vehicleFuelPrice" class="form-input" step="0.001" min="0" placeholder="e.g. 1.95">
                                <small class="form-hint">Only used to estimate mileage from fuel amounts when a fill has no litres recorded. Once fills with litres exist, the real average price is used instead.</small>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Licence Holder</label>
                                <input type="text" id="vehicleLicenceHolder" class="form-input" placeholder="Driver's name">
                            </div>
                            <div class="form-group">
                                <label>Licence Number</label>
                                <input type="text" id="vehicleLicenceNumber" class="form-input">
                            </div>
                            <div class="form-group">
                                <label>Licence Expiry Date</label>
                                <input type="date" id="vehicleLicenceExpiry" class="form-input">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Linked Insurance Policy (optional)</label>
                                <select id="vehicleLinkedPolicy" class="form-select">
                                    <option value="">None</option>
                                    ${carPolicyOptions}
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Notes</label>
                            <textarea id="vehicleNotes" class="form-input" rows="2"></textarea>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">💾 Save Vehicle</button>
                            <button type="button" class="btn btn-secondary" id="cancelVehicle">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        document.getElementById('btnNewVehicle')?.addEventListener('click', () => this.openVehicleForm());
        document.getElementById('emptyAddVehicle')?.addEventListener('click', () => this.openVehicleForm());

        activeVehiclesManager = this;
        attachVehiclesDelegatedListener();

        this.setupModalEvents();
    }

    handleVehicleAction(action, vehicleId) {
        const vehicle = this.vehicles.find(v => v.id === vehicleId);
        if (!vehicle) return;
        if (action === 'edit') this.openVehicleForm(vehicle);
        if (action === 'delete') this.deleteVehicle(vehicle);
    }

    setupModalEvents() {
        const modal = document.getElementById('vehicleModal');
        const form = document.getElementById('vehicleForm');
        const closeBtn = document.getElementById('closeVehicleModal');
        const cancelBtn = document.getElementById('cancelVehicle');

        [closeBtn, cancelBtn].forEach(btn => {
            btn?.addEventListener('click', () => { modal.style.display = 'none'; });
        });

        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveVehicle();
            modal.style.display = 'none';
        });
    }

    openVehicleForm(vehicle = null) {
        const modal = document.getElementById('vehicleModal');
        const title = document.getElementById('vehicleModalTitle');
        const form = document.getElementById('vehicleForm');

        if (vehicle) {
            title.textContent = 'Edit Vehicle';
            document.getElementById('editVehicleId').value = vehicle.id;
            document.getElementById('vehicleNickname').value = vehicle.nickname || '';
            document.getElementById('vehicleRego').value = vehicle.rego || '';
            document.getElementById('vehicleMake').value = vehicle.make || '';
            document.getElementById('vehicleModel').value = vehicle.model || '';
            document.getElementById('vehicleYear').value = vehicle.year || '';
            document.getElementById('vehicleRegoExpiry').value = vehicle.regoExpiryDate || '';
            document.getElementById('vehicleRegoCost').value = vehicle.regoCost ?? '';
            document.getElementById('vehicleRegoFrequency').value = vehicle.regoFrequency || 'annual';
            document.getElementById('vehicleOdometer').value = vehicle.odometerReading ?? '';
            document.getElementById('vehicleOdometerDate').value = vehicle.odometerDate || '';
            document.getElementById('vehicleFuelPrice').value = vehicle.fuelPricePerLitre ?? '';
            document.getElementById('vehicleLicenceHolder').value = vehicle.licenceHolder || '';
            document.getElementById('vehicleLicenceNumber').value = vehicle.licenceNumber || '';
            document.getElementById('vehicleLicenceExpiry').value = vehicle.licenceExpiryDate || '';
            document.getElementById('vehicleLinkedPolicy').value = vehicle.linkedInsurancePolicyId || '';
            document.getElementById('vehicleNotes').value = vehicle.notes || '';
        } else {
            title.textContent = 'Add New Vehicle';
            form.reset();
            document.getElementById('editVehicleId').value = '';
            document.getElementById('vehicleRegoFrequency').value = 'annual';
        }

        modal.style.display = 'flex';
    }

    async saveVehicle() {
        const vehicleId = document.getElementById('editVehicleId').value;
        const existing = vehicleId ? this.vehicles.find(v => v.id === vehicleId) : null;

        // Odometer history: this form rebuilds the whole record, so carry the
        // saved history forward, keep the previous reading (from before
        // history existed) and add the new one — distance between readings
        // is what cost per km / estimated mileage are worked out from.
        const newOdo = parseFloat(document.getElementById('vehicleOdometer').value) || 0;
        const newOdoDate = document.getElementById('vehicleOdometerDate').value || new Date().toISOString().slice(0, 10);
        let odometerHistory = existing?.odometerHistory || [];
        if (existing) odometerHistory = addOdometerReading(odometerHistory, existing.odometerReading, existing.odometerDate);
        odometerHistory = addOdometerReading(odometerHistory, newOdo, newOdoDate);

        const vehicleData = {
            id: vehicleId || generateId(),
            nickname: document.getElementById('vehicleNickname').value,
            rego: document.getElementById('vehicleRego').value,
            make: document.getElementById('vehicleMake').value,
            model: document.getElementById('vehicleModel').value,
            year: document.getElementById('vehicleYear').value,
            regoExpiryDate: document.getElementById('vehicleRegoExpiry').value,
            regoCost: parseFloat(document.getElementById('vehicleRegoCost').value) || 0,
            regoFrequency: document.getElementById('vehicleRegoFrequency').value,
            odometerReading: parseFloat(document.getElementById('vehicleOdometer').value) || 0,
            odometerDate: document.getElementById('vehicleOdometerDate').value,
            odometerHistory,
            fuelPricePerLitre: parseFloat(document.getElementById('vehicleFuelPrice').value) || 0,
            licenceHolder: document.getElementById('vehicleLicenceHolder').value,
            licenceNumber: document.getElementById('vehicleLicenceNumber').value,
            licenceExpiryDate: document.getElementById('vehicleLicenceExpiry').value,
            linkedInsurancePolicyId: document.getElementById('vehicleLinkedPolicy').value || null,
            notes: document.getElementById('vehicleNotes').value,
            createdAt: vehicleId ? this.vehicles.find(v => v.id === vehicleId)?.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            if (vehicleId) {
                await updateItem(STORE_NAMES.vehicles, vehicleData);
            } else {
                await addItem(STORE_NAMES.vehicles, vehicleData);
            }
            await this.init();
        } catch (error) {
            console.error('Error saving vehicle:', error);
            alert('Error saving vehicle. Please try again.');
        }
    }

    async deleteVehicle(vehicle) {
        if (!confirm(`Delete vehicle "${vehicle.nickname || vehicle.rego || 'this vehicle'}"?`)) return;
        try {
            await deleteItem(STORE_NAMES.vehicles, vehicle.id);
            await this.init();
        } catch (error) {
            console.error('Error deleting vehicle:', error);
            alert('Error deleting vehicle.');
        }
    }

    formatCurrency(amount) {
        return formatMoney(amount);
    }

    formatDate(date) {
        if (!date) return 'Not set';
        return new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    }
}

export async function initVehiclesUI() {
    const manager = new VehiclesManager();
    await manager.init();
}
