import { getAllItems, addItem, deleteItem, updateItem, STORE_NAMES, generateId } from './db.js';
import { getGatedItems } from './features.js';
import { escapeHtml } from './sanitize.js';
// Remove this import if it's causing issues
// import { PROPERTY_EXPENSE_CATEGORIES } from './propertyExpenseCategories.js';
import { DEFAULT_CATEGORIES } from './defaultCategories.js';
import { initImportModal } from './import/modal.js';
import { saveImportedTransactions } from './import/saver.js';
import { parseCSVFile, parseStatementText } from './import/parser.js';
import { getMerchantLogo } from './import/merchantLogos.js';
import { learnFromManualCategory, learnPropertyForTransaction } from './import/categoryMapper.js';
import { getExpenseCategoryBucket } from './propertyExpenseCategories.js';
import { addOdometerReading, suggestVehicleForFuel } from './vehicleFuelStats.js';

import { baseEquivalent, currencySymbol, formatMoney, getBaseCurrency, hasRate, toAud, toBaseTransactions, transferLegs, txEquivalent } from './utils/currency.js';
// Which source tab is currently selected above the transaction list:
// "all" | "recurring" (tx.recurringId set) | "bills" (tx.billId set).
// Lets you quickly isolate auto-generated recurring/loan/bill payments —
// e.g. to verify a recurring catch-up run actually created records —
// without hunting through the full list.
let activeSourceTab = "all";
// Reset function for the quick Year/Month jump (set by setupQuickDateJump
// each render). Module-level because the Filter modal's submit handler
// lives in a separate function (setupFormHandlers) and needs to clear the
// quick pickers when a manual Start/End Date is applied instead.
let quickDateJumpReset = null;

// Quick Year/Month jump selection. Module-level (it used to be closure
// variables inside setupQuickDateJump) so it can survive a re-render — see
// captureTxViewState/restoreTxViewState below. null year = "All Time",
// null month = "Full Year".
let txQuickState = { year: null, month: null };

// What the Add Transaction form needs to suggest a vehicle for a fuel
// purchase (see maybeSuggestFuelVehicle). Refreshed on every page render.
let txFuelGuessContext = { transactions: [], vehicles: [] };

// ---------------------------------------------------------------------------
// Keeping the person's view across a re-render
//
// Saving, editing, deleting or importing a transaction all call
// initTransactionsUI(), which rebuilds the whole page from scratch — and
// with it every filter field, the search box, the Financial Year / sort
// dropdowns, the quick Year/Month jump and the scroll position all snapped
// back to their defaults. So filtering to a month and then fixing one
// transaction dumped you back at the full, unfiltered list. These two
// functions snapshot that state from the live DOM before the rebuild and
// put it back afterwards. Only used by internal refreshes (initTransactionsUI
// with { preserveView: true }); arriving on the page from the nav, or
// pressing "Clear Filters", still starts fresh.
// ---------------------------------------------------------------------------
function captureTxViewState() {
  const f = document.getElementById("filterForm");
  if (!f) return null;
  const mainContent = document.getElementById("mainContent");
  return {
    type: f.type?.value || "",
    accountId: f.accountId?.value || "",
    mainCategory: f.mainCategory?.value || "",
    subCategory: f.subCategory?.value || "",
    startDate: f.startDate?.value || "",
    endDate: f.endDate?.value || "",
    search: document.getElementById("txSearchInput")?.value || "",
    fy: document.getElementById("txFY")?.value || "",
    sort: document.getElementById("sortTransactions")?.value || "",
    quick: { ...txQuickState },
    scrollY: window.scrollY || 0,
    contentScrollTop: mainContent ? mainContent.scrollTop : 0
  };
}

function restoreTxViewState(state) {
  if (!state) return;
  const f = document.getElementById("filterForm");
  if (!f) return;

  f.type.value = state.type;
  f.accountId.value = state.accountId;
  f.startDate.value = state.startDate;
  f.endDate.value = state.endDate;
  // Subcategory options are built from the chosen main category (see
  // setupCategoryLinking), so set the main one, let that rebuild the
  // list, then set the sub.
  f.mainCategory.value = state.mainCategory;
  f.mainCategory.dispatchEvent(new Event("change"));
  f.subCategory.value = state.subCategory;

  const search = document.getElementById("txSearchInput");
  if (search) search.value = state.search;
  const fy = document.getElementById("txFY");
  if (fy) fy.value = state.fy;
  const sort = document.getElementById("sortTransactions");
  if (sort && state.sort) sort.value = state.sort;

  txQuickState = { ...state.quick };

  // The source tab (All / Recurring / Bills) is already remembered in
  // activeSourceTab, but the markup always renders "All" as the active one,
  // so the highlighted tab stopped matching what was actually filtered.
  document.querySelectorAll("#txSourceTabs .tx-source-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.source === activeSourceTab)
  );

  // Scroll back to where the person was, once the list has been drawn.
  requestAnimationFrame(() => {
    window.scrollTo(0, state.scrollY);
    const mainContent = document.getElementById("mainContent");
    if (mainContent) mainContent.scrollTop = state.contentScrollTop;
  });
}

// Chart.js instance for the summary donut below — module-level so
// initTransactionsUI() can destroy the previous one before creating a new
// one on every re-render (same "destroy before recreate" pattern as the
// Budget Summary donut in budgets.js and the charts in wealthOverview.js).
let txSummaryChart = null;

// Same formatting as the fo-card money helpers used elsewhere (Budgets'
// summary donut, Finance Overview) — kept as a local copy rather than
// imported, so this page doesn't depend on another page's internals.
function money(n) {
    const num = Number(n) || 0;
    return formatMoney(num, undefined, { digits: 0 });
}

function compactMoney(n) {
    const num = Number(n) || 0;
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    if (abs >= 1000) return `${sign}${currencySymbol()}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
    return `${sign}${formatMoney(abs, undefined, { digits: 0 })}`;
}

// ============================================================================
//  Transactions UI Initialization (FIXED VERSION)
// ============================================================================

// Define property expense categories locally if import fails
const PROPERTY_EXPENSE_CATEGORIES = [
  "Mortgage", "Rates", "Insurance", "Repairs", "Maintenance",
  "Utilities", "Strata Fees", "Property Management", "Advertising",
  "Legal Fees", "Council Rates", "Water Rates", "Gardening",
  "Cleaning", "Security", "Other"
];

// Jul 1 - Jun 30, same definition used on the Properties/Tenants pages.
function getCurrentFYStartYear() {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function getFYRange(fyStartYear) {
  return {
    fyStart: new Date(fyStartYear, 6, 1),
    fyEnd: new Date(fyStartYear + 1, 5, 30, 23, 59, 59)
  };
}

// Feature: FY filter for the transaction list, matching the picker already
// on the Properties/Tenants pages. Offers every FY that actually has a
// transaction, newest first, plus the current FY even if it's empty so far.
function renderTxFYOptions(transactions) {
  const currentFYStart = getCurrentFYStartYear();
  const years = new Set([currentFYStart]);
  transactions.forEach(t => {
    if (!t || !t.date) return;
    const d = new Date(t.date);
    if (isNaN(d.getTime())) return;
    years.add(d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
  });
  const sortedYears = Array.from(years).sort((a, b) => b - a);
  return sortedYears.map(y => `
    <option value="${y}">FY ${y}-${String(y + 1).slice(-2)}${y === currentFYStart ? ' (current)' : ''}</option>
  `).join('');
}

// ============================================================================
// Add/Edit Transaction modal — full markup (category + subcategory pickers,
// Property Expense / Rental Income section). Exported so any page that
// needs to let someone log a transaction can render the exact same form
// instead of a cut-down duplicate that drifts out of sync with it (used by
// this page's own "Add Transaction" button and by the Dashboard's
// quick-add button — see dashboard.js).
// ============================================================================
export function renderTransactionFormHTML({ categories, accounts, properties, vehicles = [], today }) {
  const mainCats = categories.filter(c => !c.parentId);
  return `
      <div id="addTxForm" class="tx-modal-overlay" style="display: none;">
        <div class="tx-modal-box section-card">
        <div class="form-header">
          <h3 id="txFormTitle">Add Transaction</h3>
          <button id="closeAddForm" class="btn-close">✕</button>
        </div>
        <form id="txForm" class="styled-form">
          <div class="form-row">
            <div class="form-group">
              <label>Type</label>
              <select name="type" id="txType" class="form-select" onchange="togglePropertyExpenseFields()">
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div class="form-group">
              <label>Amount</label>
              <input type="number" name="amount" class="form-input" placeholder="0.00" step="0.01" required>
            </div>
            <div class="form-group" id="audValueGroup" style="display:none">
              <label id="audValueLabel">AUD value (for tax)</label>
              <input type="number" name="amountAUD" class="form-input" placeholder="0.00" step="0.01" min="0">
              <small class="form-hint" id="audValueHint">Foreign-currency account: enter the AUD value on the day. Used for ATO, property and cost base figures.</small>
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" name="date" class="form-input" value="${today}" required>
            </div>
            <div class="form-group">
              <label>Account</label>
              <select name="accountId" class="form-select" required>
                <option value="">Select Account</option>
                ${accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}${a.currency ? ' (' + a.currency + ')' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Description</label>
              <input type="text" name="description" class="form-input" placeholder="e.g. Woolworths">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <select id="mainCategory" name="mainCategory" class="form-select" required>
                <option value="">Select Category</option>
                ${mainCats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
                <option value="__add_new_category__">➕ Add New Category...</option>
              </select>
            </div>
            <div class="form-group">
              <label>Subcategory</label>
              <select id="subCategory" name="subCategory" class="form-select">
                <option value="">-- None --</option>
              </select>
            </div>
          </div>

          <!-- Vehicle Link (Registration or Fuel expense linked to a specific
               vehicle) — mirrors the Property Expense section below in look,
               but its visibility is gated purely on the chosen Category being
               Registration (sub_rego) or Fuel / Petrol (sub_fuel), same idea
               as the Bills form's own vehicle picker (see
               updateBillVehicleVisibility in bills.js), rather than a
               separate checkbox. The Fuel-only litres/odometer fields sit in
               their own group underneath. -->
          ${vehicles.length > 0 ? `
          <div class="form-row" id="vehicleLinkGroup" style="display: none;">
            <div class="form-group">
              <label>Vehicle</label>
              <select name="vehicleId" class="form-select">
                <option value="">-- Select vehicle --</option>
                ${vehicles.map(v => `<option value="${v.id}">🚗 ${escapeHtml(v.nickname || v.rego || `${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle')}</option>`).join('')}
              </select>
              <small class="form-hint" id="vehicleLinkHint">
                Link this Registration expense to a specific vehicle so it's reflected on that vehicle's record on the Vehicles page.
              </small>
            </div>
          </div>
          <div id="fuelDetailsGroup" style="display: none;">
            <div class="form-row">
              <div class="form-group">
                <label>Litres (optional)</label>
                <input type="number" name="fuelLitres" class="form-input" step="0.01" min="0" inputmode="decimal" placeholder="e.g. 45.20">
              </div>
              <div class="form-group">
                <label>Odometer, km (optional)</label>
                <input type="number" name="fuelOdometer" class="form-input" step="1" min="0" inputmode="numeric" placeholder="e.g. 48250">
              </div>
            </div>
            <div class="form-row">
              <label class="checkbox-label">
                <input type="checkbox" name="fuelFullTank" checked>
                <span>Filled to full</span>
              </label>
            </div>
            <small class="form-hint">
              Litres and odometer give an accurate L/100km on the Vehicles page (fill to full each time). Leave them blank and it estimates from the amount instead.
            </small>
          </div>
          ` : ''}

          <!-- Property Link Section (Property Expense for expenses, Rental Income for income) -->
          <div id="propertyExpenseSection" data-feature="property" style="display: none;">
            <div class="form-row">
              <label class="checkbox-label">
                <input type="checkbox" id="isPropertyExpense" onchange="togglePropertyExpenseCheckbox()">
                <span id="propertyCheckboxLabel">Property Expense</span>
              </label>
            </div>
            <div id="propertyExpenseFields" style="display: none;">
              <div class="form-row">
                <div class="form-group">
                  <label>Property</label>
                  <select name="propertyId" class="form-select">
                    <option value="">Select Property</option>
                    ${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group" id="expenseCategoryGroup">
                  <label>Expense Category</label>
                  <select name="expenseCategory" class="form-select">
                    <option value="">Expense Category</option>
                    ${PROPERTY_EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group" id="expenseStatusGroup">
                  <label>Status</label>
                  <select name="expenseStatus" class="form-select">
                    <option value="Paid">Paid</option>
                    <option value="Pending">Pending</option>
                    <option value="Due">Due</option>
                  </select>
                </div>
              </div>
              <div class="form-row" id="expenseExtraRow">
                <div class="form-group">
                  <label>Receipt URL</label>
                  <input type="text" name="receiptUrl" class="form-input" placeholder="Receipt URL">
                </div>
                <div class="form-group">
                  <label>Notes</label>
                  <textarea name="expenseNotes" class="form-input" placeholder="Notes" rows="2"></textarea>
                </div>
              </div>
              <p id="rentalIncomeHint" style="display: none; font-size: 0.8rem; color: #64748b; margin: 0.25rem 0 0;">
                This will be categorized as <strong>Rental Income</strong> for this property so it shows up on the
                Property page, the Tenants page and the ATO Rental Income summary.
              </p>
            </div>
          </div>
          
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save Transaction</button>
            <button type="button" id="btnConvertToTransfer" class="btn btn-secondary" style="display:none;">
              🔁 Convert to Transfer...
            </button>
          </div>
        </form>
        </div>
      </div>
  `;
}

export async function initTransactionsUI(options = {}) {

  // Snapshot the current view BEFORE anything below rebuilds the DOM.
  const preservedView = options.preserveView ? captureTxViewState() : null;
  if (!options.preserveView) {
    // Fresh arrival (nav click) or an explicit reset (Clear Filters).
    activeSourceTab = "all";
    txQuickState = { year: null, month: null };
  }

  const mainContent = document.getElementById('mainContent');
  if (!mainContent) {
    console.error("[TX] mainContent element not found!");
    return;
  }
  
  mainContent.classList.add('page-transition');

  const [categories, accounts, transactions, properties, vehicles] = await Promise.all([
    getAllItems(STORE_NAMES.categories),
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions),
    getGatedItems(STORE_NAMES.properties).catch(() => []),
    getAllItems(STORE_NAMES.vehicles).catch(() => [])
  ]);

  const mainCats = categories.filter(c => !c.parentId);
  const subCats = categories.filter(c => c.parentId);
  const today = new Date().toISOString().split("T")[0];
  txFuelGuessContext = { transactions, vehicles };

  // Summary calculations
  // Bug fix: every other page in the app (dashboard.js, budgets.js,
  // financeOverview.js, financialDashboard.js, wealthOverview.js,
  // quickLook.js, accounts.js) excludes isTransfer:true transactions from
  // Income/Expense totals, since those are money moving between your own
  // accounts (or a loan draw/repayment), not real income or expense - this
  // page was the one place that forgot to, so a page of borrowed money or
  // BPAY bills inflated Total Income here even once isTransfer was set
  // correctly at import time.
  const flowTx = toBaseTransactions(transactions, accounts);
  const totalIncome = flowTx.filter(t => t.type === "income" && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  const totalExpenses = flowTx.filter(t => t.type === "expense" && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  // totalExpenses is already negative (expense amounts are stored negative),
  // so net flow is the sum, not income minus expenses.
  const netFlow = totalIncome + totalExpenses;

  // Per-row progress bars under each legend line — relative magnitude
  // against the other two rows (Income/Expenses/Net Flow), same "feel"
  // visual as the donut above but per-line, not a literal percent of a
  // fixed whole.
  const txLegendRowTotal = Math.abs(totalIncome) + Math.abs(totalExpenses) + Math.abs(netFlow);
  const txLegendPct = (n) => txLegendRowTotal > 0 ? Math.min(100, (Math.abs(n) / txLegendRowTotal) * 100) : 0;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthTotal = flowTx
    .filter(t => t.date.startsWith(thisMonth))
    .reduce((s, t) => s + (t.amount || 0), 0);

  // ========================================================================
  // HTML Rendering (COMPLETE with all required elements)
  // ========================================================================
  mainContent.innerHTML = `
    <div class="page-container">

      <div class="page-header">
        <h2>💸 Transactions</h2>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnAddTx">➕ Add Transaction</button>
          <button class="btn btn-secondary" id="btnFilterTx">🔍 Filter</button>
          <button class="btn btn-secondary" id="btnExportTx">📤 Export</button>
          <button class="btn btn-success" id="btnImportTx">📁 Import</button>
        </div>
      </div>

      <!-- Quick date jump — same Year/Month select pattern as the
           Financial Dashboard's filter bar (native <input type="month">/
           <input type="date"> rendered blank here), reusing its
           .pfd-filter-bar/.pfd-filter-select styling. Sets the same
           Start/End Date the Filter panel above uses, so it's just a
           fast way to fill that range in, not a second date filter. -->
      <div class="pfd-filter-bar">
        <div class="pfd-filter-group">
          <label for="txQuickYear">Year</label>
          <select id="txQuickYear" class="pfd-filter-select"></select>
        </div>
        <div class="pfd-filter-group">
          <label for="txQuickMonth">Month</label>
          <select id="txQuickMonth" class="pfd-filter-select"></select>
        </div>
      </div>

      <!-- Transaction Summary — same fo-card donut treatment as the
           Budgets page's Budget Summary card, in place of the old plain
           number cards. Income vs Expenses (all-time) makes the donut;
           This Month sits in the balance box since it's a different
           time window from the other three all-time figures. -->
      <div class="fo-card fo-card-wide">
          <div class="fo-card-header-row">
              <span class="fo-card-title">Transaction Summary</span>
              <span class="fo-card-subtitle">All Time</span>
          </div>
          <div class="fo-budget-layout">
              <div class="fo-chart-wrap fo-donut-wrap">
                  <canvas id="txSummaryDonut"></canvas>
                  <div class="fo-donut-center">
                      <span class="fo-donut-center-value">${compactMoney(netFlow)}</span>
                      <span class="fo-donut-center-label">Net Flow</span>
                  </div>
              </div>
              <div class="fo-budget-mid">
                  <div class="fo-legend-row">
                      <span class="fo-legend-dot" style="background:#3ddc97;"></span>
                      <span class="fo-legend-label">Total Income</span>
                      <span class="fo-legend-value positive">${formatMoney(totalIncome)}</span>
                  </div>
                  <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${txLegendPct(totalIncome)}%;background:#3ddc97"></div></div>
                  <div class="fo-legend-row">
                      <span class="fo-legend-dot" style="background:#ff6b7a;"></span>
                      <span class="fo-legend-label">Total Expenses</span>
                      <span class="fo-legend-value negative">${formatMoney(totalExpenses)}</span>
                  </div>
                  <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${txLegendPct(totalExpenses)}%;background:#ff6b7a"></div></div>
                  <div class="fo-legend-row">
                      <span class="fo-legend-dot" style="background:#5b8def;"></span>
                      <span class="fo-legend-label">Net Flow</span>
                      <span class="fo-legend-value ${netFlow >= 0 ? 'positive' : 'negative'}">${formatMoney(Math.abs(netFlow))}</span>
                  </div>
                  <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${txLegendPct(netFlow)}%;background:#5b8def"></div></div>
              </div>
              <div class="fo-balance-box">
                  <span class="fo-balance-box-value ${thisMonthTotal >= 0 ? 'positive' : 'negative'}">${formatMoney(Math.abs(thisMonthTotal))}</span>
                  <span class="fo-balance-box-label">This Month</span>
              </div>
          </div>
      </div>

      ${renderTransactionFormHTML({ categories, accounts, properties, vehicles, today })}

      <!-- Filter Form -->
      <div id="filterTxForm" class="tx-modal-overlay" style="display: none;">
        <div class="tx-modal-box section-card">
        <div class="form-header">
          <h3>Filter Transactions</h3>
          <button id="closeFilterForm" class="btn-close">✕</button>
        </div>
        <form id="filterForm" class="styled-form">
          <div class="form-row">
            <div class="form-group">
              <label>Type</label>
              <select name="type" class="form-select">
                <option value="">All Types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div class="form-group">
              <label>Account</label>
              <select name="accountId" class="form-select">
                <option value="">All Accounts</option>
                ${accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <select name="mainCategory" class="form-select">
                <option value="">All Categories</option>
                ${mainCats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Subcategory</label>
              <select name="subCategory" class="form-select">
                <option value="">All Subcategories</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Start Date</label>
              <input type="date" name="startDate" class="form-input">
            </div>
            <div class="form-group">
              <label>End Date</label>
              <input type="date" name="endDate" class="form-input">
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Apply Filters</button>
            <button type="button" id="clearFilters" class="btn btn-secondary">Clear Filters</button>
          </div>
        </form>
        </div>
      </div>

      <!-- Transactions List -->
      <div class="section-card">
        <div class="tx-source-tabs" id="txSourceTabs">
          <button type="button" class="tx-source-tab active" data-source="all">All</button>
          <button type="button" class="tx-source-tab" data-source="recurring">🔄 Recurring</button>
          <button type="button" class="tx-source-tab" data-source="bills">🧾 Bills</button>
        </div>
        <div class="transactions-header">
          <div class="transactions-title-row">
            <h3>Recent Transactions</h3>
            <span id="txCount">${transactions.length} transactions</span>
          </div>
          <div class="transactions-controls">
            <input type="search" id="txSearchInput" class="form-input tx-search-input"
              placeholder="🔍 Search description, category, account…" autocomplete="off">
            <select id="txFY" class="form-select" title="Filter by financial year">
              <option value="">All Time</option>
              ${renderTxFYOptions(transactions)}
            </select>
            <select id="sortTransactions" class="form-select">
              <option value="date-desc">Newest</option>
              <option value="date-asc">Oldest</option>
              <option value="amount-desc">Highest Amount</option>
              <option value="amount-asc">Lowest Amount</option>
            </select>
          </div>
        </div>
        <div id="txFilteredSummary" class="tx-filtered-summary"></div>
        <div id="txList"></div>
      </div>

    </div>
  `;

  // ========================================================================
  // ✔ FIX: Initialize Import Modal
  // ========================================================================
  setTimeout(() => {
    
    // Check if button exists before initializing
    const importBtn = document.getElementById("btnImportTx");
    if (importBtn) {
      initImportModal({
        accounts,
        categories,
        onImported: async (savedCount) => {
          await initTransactionsUI({ preserveView: true }); // reload transactions UI
        }
      });
    } else {
      console.warn("[IMPORT] btnImportTx not found in DOM");
    }
  }, 100);

  // ========================================================================
  // UI + Event setup (WITH SAFETY CHECKS)
  // ========================================================================
  setupCategoryLinking(categories, subCats);
  setupFormHandlers(categories, accounts, properties, transactions, subCats, today);
  restoreTxViewState(preservedView);
  applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today);

  // Transaction Summary donut — Income vs Expenses (all-time), same
  // destroy-before-recreate pattern as the Budget Summary donut in
  // budgets.js, since initTransactionsUI() re-renders #mainContent's
  // innerHTML (and this canvas along with it) on every filter/sort/
  // search/quick-date-jump change.
  const txDonutCanvas = document.getElementById('txSummaryDonut');
  if (txDonutCanvas && typeof Chart !== 'undefined') {
    if (txSummaryChart) { txSummaryChart.destroy(); txSummaryChart = null; }
    txSummaryChart = new Chart(txDonutCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Income', 'Expenses'],
        datasets: [{
          data: [totalIncome, Math.abs(totalExpenses)],
          backgroundColor: ['#3ddc97', '#ff6b7a'],
          borderWidth: 0
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        cutout: '70%',
        maintainAspectRatio: false
      }
    });
  }

  // SAFE event listener attachment
  safeAddEventListener("btnAddTx", "click", toggleAddForm);
  safeAddEventListener("btnFilterTx", "click", toggleFilterForm);
  safeAddEventListener("closeAddForm", "click", hideForms);
  safeAddEventListener("closeFilterForm", "click", hideForms);

  // Click on the dimmed backdrop (outside the modal box) closes it, same
  // as the ✕ button - but a click inside the box itself must not bubble
  // up and close the modal out from under whatever the person is doing.
  ["addTxForm", "filterTxForm"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      if (e.target.id === id) hideForms();
    });
  });
  safeAddEventListener("clearFilters", "click", clearFilterForm);
  
  const sortSelect = document.getElementById("sortTransactions");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today);
    });
  }

  // Live search — filters as you type, combined with whatever the
  // filter panel currently has set.
  const searchInput = document.getElementById("txSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today);
    });
  }

  // Financial year filter — same pattern as search/sort above.
  const fySelect = document.getElementById("txFY");
  if (fySelect) {
    fySelect.addEventListener("change", () => {
      applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today);
    });
  }

  // Quick date jump (Year/Month) — writes straight into the filter
  // panel's Start/End Date fields and reuses the exact same filtering
  // path as the Filter modal, rather than a second parallel date filter.
  setupQuickDateJump(transactions, fySelect, () =>
    applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today)
  );

  // Source tabs (All / Recurring / Bills) — swap the active tab and
  // re-render with the same combined filters/search/sort applied.
  const sourceTabs = document.getElementById("txSourceTabs");
  if (sourceTabs) {
    sourceTabs.querySelectorAll(".tx-source-tab").forEach(tabBtn => {
      tabBtn.addEventListener("click", () => {
        activeSourceTab = tabBtn.dataset.source;
        sourceTabs.querySelectorAll(".tx-source-tab").forEach(b =>
          b.classList.toggle("active", b === tabBtn)
        );
        applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today);
      });
    });
  }

  // Initialize property expense toggle
  togglePropertyExpenseFields();

  setTimeout(() => mainContent.classList.remove("page-transition"), 300);

  // ========================================================================
// ✔ FIX: Initialize Import Modal
// ========================================================================
// In transactions.js, replace the setTimeout section with this:

// ========================================================================
// Initialize Import Modal
// ========================================================================
setTimeout(() => {
  
  const importBtn = document.getElementById("btnImportTx");
  if (importBtn) {
    
    // Remove any existing event listeners by cloning
    const newBtn = importBtn.cloneNode(true);
    importBtn.parentNode.replaceChild(newBtn, importBtn);
    
    try {
      // Initialize the modal
      initImportModal({
        accounts,
        categories,
        onImported: async (savedCount) => {
          await initTransactionsUI({ preserveView: true }); // Refresh the view
        }
      });
    } catch (error) {
      console.error("[TX] Failed to initialize import modal:", error);
      
      // Fallback simple handler
      newBtn.addEventListener("click", () => {
        alert("Import feature is currently unavailable. Please check console for errors.");
      });
    }
  } else {
    console.debug("[TX] Import button not found (page was changed before it finished loading)");
  }
}, 200);
}

// ============================================================================
// Helper: Safe Event Listener
// ============================================================================
function safeAddEventListener(id, event, handler) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener(event, handler);
  } else {
    console.warn(`[TX] Element #${id} not found for event ${event}`);
  }
}

// ============================================================================
// Category Linking (FIXED)
// ============================================================================
// Prompts for a name, creates the category/subcategory in the DB, adds it
// to the in-memory categories/mainCats/subCats arrays (so the rest of this
// page's already-open selects see it immediately without a full reload),
// and returns the new category object — or null if the person cancelled.
async function quickAddCategory(categories, mainCats, subCats, parentId = null) {
  const label = parentId ? 'subcategory' : 'category';
  const name = prompt(`Name for the new ${label}:`);
  if (!name || !name.trim()) return null;

  const newCat = {
    id: generateId(),
    name: name.trim(),
    type: 'expense',
    icon: parentId ? '↪️' : '📁',
    parentId: parentId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await addItem(STORE_NAMES.categories, newCat);

  categories.push(newCat);
  if (parentId) {
    subCats.push(newCat);
  } else {
    mainCats.push(newCat);
  }

  return newCat;
}

// Rolls a vehicle's rego expiry forward by its own renewal frequency from
// the given date (rather than just copying the transaction's date across),
// so logging a late payment doesn't shorten the next renewal window. Local
// copy of the same date-math as getNextBillDueDate in bills.js — kept local
// rather than imported, matching this file's own convention (see money()
// above) of not reaching into another page's internals for a small utility.
// vehicle.regoFrequency only ever uses 'annual' / 'six_monthly'.
// Exported so vehicleMatchTool.js's bulk "review & fix" pass can drive a
// vehicle's regoCost/regoExpiryDate the exact same way a single manual save
// here does, rather than re-implementing the date math a second time.
export function getNextRegoExpiryDate(fromDateStr, regoFrequency) {
  const d = new Date(fromDateStr);
  if (regoFrequency === 'six_monthly') {
    d.setMonth(d.getMonth() + 6);
  } else {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

// Registration expense linked to a vehicle: mirrors bills.js's
// syncVehicleRegoFromBill, but for a manually-entered/imported Transaction
// instead of a paid Bill. The Vehicles page's Registration card reads
// vehicle.regoCost/regoExpiryDate directly off the vehicle record, so
// without this a rego transaction's vehicleId link was recorded but never
// actually reflected there. Exported for vehicleMatchTool.js — see note on
// getNextRegoExpiryDate above.
//
// Bug fix ("card only shows the amount from one transaction, not
// necessarily the current one"): a vehicle can end up with several rego
// transactions linked to it over the years, and this used to blindly
// overwrite regoCost/regoExpiryDate with whichever transaction happened to
// save/sync last. That's fine one at a time in the Add/Edit form (you're
// always saving the newest payment), but vehicleMatchTool.js's bulk "Review
// & Fix" pass applies rows in list order, not date order — so bulk-matching
// two years of back-dated rego transactions could leave the vehicle record
// reflecting an old year's amount, not the current one. Now it only writes
// through when tx is actually the most recent linked rego transaction on
// file, so the shown cost/expiry always tracks the latest payment
// regardless of what order transactions get saved or matched in.
function getRegoTxDate(t) {
  return new Date(t.date);
}

// Infers annual vs six-monthly straight from the actual gaps between a
// vehicle's linked rego payments, rather than trusting the "Paid" dropdown
// on the vehicle record — that field defaults to "Annually" when a vehicle
// is first created and nothing ever corrected it, so a vehicle that's
// actually paid half-yearly could sit showing the wrong frequency (and the
// wrong doubled/non-doubled annual total) indefinitely. Needs at least two
// linked payments to have a gap to measure; one payment alone can't tell
// you the cycle length.
function inferRegoFrequencyFromHistory(linkedRegoTxs) {
  if (linkedRegoTxs.length < 2) return null;
  const sorted = [...linkedRegoTxs].sort((a, b) => a.date > b.date ? 1 : -1);
  const gapsInDays = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = (getRegoTxDate(sorted[i]) - getRegoTxDate(sorted[i - 1])) / 86400000;
    if (days > 0) gapsInDays.push(days);
  }
  if (gapsInDays.length === 0) return null;
  const avgDays = gapsInDays.reduce((a, b) => a + b, 0) / gapsInDays.length;
  // Six-monthly rego lands ~150-210 days apart; annual ~330-400 days apart.
  // Anything outside both bands (a one-off gap, or too little history yet)
  // is too ambiguous to guess from — leave the existing field alone.
  if (avgDays >= 150 && avgDays <= 210) return 'six_monthly';
  if (avgDays >= 330 && avgDays <= 400) return 'annual';
  return null;
}

export async function syncVehicleRegoFromTransaction(tx) {
  // vehicleId is also used by Fuel transactions now — only a Registration
  // one may touch the vehicle's rego cost/expiry.
  if (!tx.vehicleId || tx.categoryId !== 'sub_rego') return;
  const [vehicles, transactions] = await Promise.all([
    getAllItems(STORE_NAMES.vehicles),
    getAllItems(STORE_NAMES.transactions)
  ]);
  const vehicle = vehicles.find(v => v.id === tx.vehicleId);
  if (!vehicle) return;

  const linkedRegoTxs = transactions.filter(t =>
    t.vehicleId === tx.vehicleId && t.categoryId === 'sub_rego' && !t.isTransfer
  );
  const mostRecent = linkedRegoTxs.reduce((latest, t) =>
    (!latest || t.date > latest.date) ? t : latest, null);
  // A more recent rego payment already exists for this vehicle — leave the
  // vehicle record showing that one, not this older transaction.
  if (mostRecent && mostRecent.id !== tx.id) return;

  const inferredFrequency = inferRegoFrequencyFromHistory(linkedRegoTxs);
  const regoFrequency = inferredFrequency || vehicle.regoFrequency;

  await updateItem(STORE_NAMES.vehicles, {
    ...vehicle,
    regoCost: Math.abs(tx.amount) || vehicle.regoCost,
    regoFrequency,
    regoExpiryDate: getNextRegoExpiryDate(tx.date, regoFrequency),
    updatedAt: new Date().toISOString()
  });
}

// Fuel fill linked to a vehicle: if the fill recorded an odometer, and it's
// the newest reading on file, make it the vehicle's current odometer (and
// keep the previous reading in the vehicle's odometerHistory so distance
// between readings can still be worked out for cost per km / mileage).
export async function syncVehicleFuelFromTransaction(tx) {
  if (!tx.vehicleId || tx.categoryId !== 'sub_fuel') return;
  const odo = parseFloat(tx.fuelOdometer);
  if (!(odo > 0)) return;
  const vehicles = await getAllItems(STORE_NAMES.vehicles);
  const vehicle = vehicles.find(v => v.id === tx.vehicleId);
  if (!vehicle) return;
  // An older fill (e.g. back-dated or imported later) must not roll the
  // vehicle's current odometer backwards.
  if (vehicle.odometerDate && tx.date < vehicle.odometerDate) return;

  let history = addOdometerReading(vehicle.odometerHistory, vehicle.odometerReading, vehicle.odometerDate);
  history = addOdometerReading(history, odo, tx.date);
  await updateItem(STORE_NAMES.vehicles, {
    ...vehicle,
    odometerReading: odo,
    odometerDate: tx.date,
    odometerHistory: history,
    updatedAt: new Date().toISOString()
  });
}

const FUEL_VEHICLE_HINT = "Link this fuel purchase to a vehicle to track its fuel spend, cost per km and mileage on the Vehicles page.";

// Pre-selects the vehicle on a NEW fuel purchase when past fuel fills make
// it clear which vehicle it is (see suggestVehicleForFuel: the account/card,
// typical fill size and servo, learned from fills already linked by hand).
// Only ever fills an empty picker or replaces its own earlier suggestion —
// never a vehicle the person picked — and only when the guess is confident;
// a shaky guess is left blank rather than risk a wrong default slipping by.
function maybeSuggestFuelVehicle() {
  const txForm = document.getElementById('txForm');
  const vehicleField = txForm?.querySelector('[name="vehicleId"]');
  if (!txForm || !vehicleField || txForm.dataset.id) return; // new transactions only
  const chosen = document.getElementById('subCategory')?.value || document.getElementById('mainCategory')?.value;
  if (chosen !== 'sub_fuel') return;
  if (vehicleField.value && vehicleField.dataset.suggested !== '1') return; // person's own pick

  const hint = document.getElementById('vehicleLinkHint');
  const guess = suggestVehicleForFuel(
    {
      id: '',
      accountId: txForm.accountId?.value || '',
      amount: parseFloat(txForm.amount?.value) || 0,
      description: txForm.description?.value || ''
    },
    txFuelGuessContext.transactions,
    txFuelGuessContext.vehicles
  );

  if (guess && guess.confident) {
    vehicleField.value = guess.vehicle.id;
    vehicleField.dataset.suggested = '1';
    if (hint && guess.reasons[0] !== 'only vehicle') {
      hint.textContent = `Suggested from your past fuel fills (${guess.reasons.join(' + ')}) — change it if it's a different vehicle.`;
    }
  } else {
    if (vehicleField.dataset.suggested === '1') vehicleField.value = '';
    vehicleField.dataset.suggested = '';
    if (hint) hint.textContent = FUEL_VEHICLE_HINT;
  }
}

// Vehicle picker only makes sense for a Registration or Fuel expense — hidden the
// rest of the time so it doesn't clutter the form for every other category.
// Category ids are stable app-wide (see defaultCategories.js), so matching
// directly on 'sub_rego' is safe here. Mirrors updateBillVehicleVisibility
// in bills.js. No-ops safely if the form has no vehicles to link (the
// #vehicleLinkGroup markup is only rendered when there's at least one).
function updateTxVehicleVisibility(categoryId) {
  const group = document.getElementById("vehicleLinkGroup");
  if (!group) return;
  const isRego = categoryId === 'sub_rego';
  const isFuel = categoryId === 'sub_fuel';
  group.style.display = (isRego || isFuel) ? '' : 'none';

  // Fuel fill details (litres / odometer / full tank) only apply to Fuel.
  const fuelGroup = document.getElementById('fuelDetailsGroup');
  if (fuelGroup) fuelGroup.style.display = isFuel ? '' : 'none';
  const hint = document.getElementById('vehicleLinkHint');
  if (hint) {
    hint.textContent = isFuel
      ? FUEL_VEHICLE_HINT
      : "Link this Registration expense to a specific vehicle so it's reflected on that vehicle's record on the Vehicles page.";
  }

  if (!isRego && !isFuel) {
    const vehicleField = document.querySelector('#txForm [name="vehicleId"]');
    if (vehicleField) vehicleField.value = '';
  }
  if (!isFuel) {
    // Don't leave stale litres/odometer behind when the category changes.
    const litres = document.querySelector('#txForm [name="fuelLitres"]');
    const odo = document.querySelector('#txForm [name="fuelOdometer"]');
    const full = document.querySelector('#txForm [name="fuelFullTank"]');
    if (litres) litres.value = '';
    if (odo) odo.value = '';
    if (full) full.checked = true;
  }

  if (isFuel) maybeSuggestFuelVehicle();
}

export function setupCategoryLinking(categories, subCats) {
  const mainSelect = document.getElementById("mainCategory");
  const subSelect = document.getElementById("subCategory");
  // The Filter Form's own category pickers are optional here — pages that
  // reuse just the Add Transaction modal (see dashboard.js's quick-add)
  // don't render a Filter Form at all. Bug fix: this used to require ALL
  // four elements to exist before wiring anything, so on a page without a
  // Filter Form the Add form's own Category -> Subcategory linking (and
  // "Add New Category/Subcategory") silently never worked either.
  const filterMain = document.querySelector("#filterForm [name='mainCategory']");
  const filterSub = document.querySelector("#filterForm [name='subCategory']");
  const mainCats = categories.filter(c => !c.parentId);

  if (!mainSelect || !subSelect) {
    console.warn("[TX] Category linking skipped — missing elements: mainCategory/subCategory");
    return;
  }

  function updateSubs(source, target, includeAddOption = false) {
    const parentId = source.value;
    const subs = subCats.filter(s => s.parentId === parentId);
    target.innerHTML =
      `<option value="">-- None --</option>` +
      subs.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("") +
      (includeAddOption && parentId && parentId !== '__add_new_category__'
        ? `<option value="__add_new_subcategory__">➕ Add New Subcategory...</option>`
        : '');
  }

  mainSelect.addEventListener("change", async () => {
    if (mainSelect.value === '__add_new_category__') {
      const created = await quickAddCategory(categories, mainCats, subCats, null);
      if (created) {
        const opt = document.createElement('option');
        opt.value = created.id;
        opt.textContent = created.name;
        mainSelect.insertBefore(opt, mainSelect.lastElementChild);
        mainSelect.value = created.id;
      } else {
        mainSelect.value = "";
      }
    }
    updateSubs(mainSelect, subSelect, true);
    updateTxVehicleVisibility(subSelect.value || mainSelect.value);
  });

  subSelect.addEventListener("change", async () => {
    if (subSelect.value === '__add_new_subcategory__') {
      const created = await quickAddCategory(categories, mainCats, subCats, mainSelect.value);
      if (created) {
        const opt = document.createElement('option');
        opt.value = created.id;
        opt.textContent = created.name;
        subSelect.insertBefore(opt, subSelect.lastElementChild);
        subSelect.value = created.id;
      } else {
        subSelect.value = "";
      }
    }
    updateTxVehicleVisibility(subSelect.value || mainSelect.value);
  });

  if (filterMain && filterSub) {
    filterMain.addEventListener("change", () => updateSubs(filterMain, filterSub, false));
    updateSubs(filterMain, filterSub, false);
  }

  // Initial update
  updateSubs(mainSelect, subSelect, true);
  updateTxVehicleVisibility(subSelect.value || mainSelect.value);

}

//fix for editing-
function rebuildSubcategoriesForEdit(mainCategoryId, subCats) {
  const subSelect = document.getElementById("subCategory");
  if (!subSelect) return;

  const subs = subCats.filter(s => s.parentId === mainCategoryId);

  subSelect.innerHTML =
    `<option value="">-- None --</option>` +
    subs.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("") +
    (mainCategoryId ? `<option value="__add_new_subcategory__">➕ Add New Subcategory...</option>` : '');
}

// ============================================================================
// Form Handlers (FIXED with safety checks)
// ============================================================================
export function setupFormHandlers(categories, accounts, properties, transactions, subCats, today, onSaved) {
  // Default preserves this page's own behaviour exactly (close the modal,
  // full page re-render). Callers that reuse this form elsewhere (e.g. the
  // Dashboard's quick-add button) pass their own onSaved instead — e.g.
  // closing their own copy of the modal and re-rendering themselves rather
  // than navigating to the Transactions page.
  const handleSaved = onSaved || (() => { hideForms(); initTransactionsUI({ preserveView: true }); });
  const txForm = document.getElementById("txForm");
  const filterForm = document.getElementById("filterForm");

  if (!txForm) {
    console.warn("[TX] Transaction form not found");
    return;
  }

  // Re-check the fuel vehicle suggestion when the account or amount changes
  // (the account/card is the strongest signal), and stop treating the
  // picker's value as a suggestion once the person changes it themselves.
  txForm.accountId?.addEventListener("change", maybeSuggestFuelVehicle);
  txForm.amount?.addEventListener("change", maybeSuggestFuelVehicle);
  txForm.querySelector('[name="vehicleId"]')?.addEventListener("change", e => {
    e.target.dataset.suggested = "";
  });

  // Foreign-currency accounts: ask for the AUD value, prefilled from the manual
  // rate until the person types their own figure.
  const audGroup = document.getElementById("audValueGroup");
  const audInput = txForm.querySelector('[name="amountAUD"]');
  const acctCurrency = () => accounts.find(a => a.id === txForm.accountId.value)?.currency || getBaseCurrency();
  const refreshAudField = () => {
    const cur = acctCurrency();
    const foreign = !!txForm.accountId.value && cur !== "AUD";
    audGroup.style.display = foreign ? "" : "none";
    audInput.required = foreign;
    if (!foreign) { audInput.value = ""; audInput.dataset.manual = ""; return; }
    document.getElementById("audValueLabel").textContent = `AUD value of ${cur} amount (for tax)`;
    const amt = parseFloat(txForm.amount.value);
    if (audInput.dataset.manual !== "1" && amt > 0 && hasRate(cur)) {
      audInput.value = toAud(amt, cur).toFixed(2);
    }
  };
  audInput.addEventListener("input", () => { audInput.dataset.manual = "1"; });
  txForm.accountId.addEventListener("change", refreshAudField);
  txForm.amount.addEventListener("input", refreshAudField);
  txForm._refreshAudField = refreshAudField;

  txForm.addEventListener("submit", async e => {
    e.preventDefault();

    const mainCat = document.getElementById("mainCategory");
    const subCat = document.getElementById("subCategory");
    const chosenCategory = subCat.value || mainCat.value;

    const tx = {
      id: txForm.dataset.id || generateId(),
      type: txForm.type.value,
      amount: (txForm.type.value === "expense" ? -1 : 1) * parseFloat(txForm.amount.value),
      date: txForm.date.value,
      accountId: txForm.accountId.value,
      description: txForm.description.value || "",
      categoryId: chosenCategory,
      createdAt: txForm.dataset.id ? undefined : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    // Foreign-currency account: keep the AUD value (same sign as amount) for tax.
    const audEntered = parseFloat(audInput.value);
    if (acctCurrency() !== "AUD" && audEntered > 0) {
      tx.amountAUD = (tx.amount < 0 ? -1 : 1) * audEntered;
      tx.fxRateAUD = audEntered / Math.abs(tx.amount);
    } else {
      tx.amountAUD = null;
      tx.fxRateAUD = null;
    }

    // Bug fix: rebuilding tx from scratch out of form fields silently
    // dropped every import-derived field that has no form field of its
    // own - rawDescription, cleanDescription, merchant, bankCategory,
    // originalLine, source, createdAt. That's more than a display nit:
    // rawDescription is what property-matching's reference-number check
    // (extractPaymentReference, see categoryMapper.js) reads, and editing
    // a transaction to correct its property - right here - is exactly the
    // moment learnPropertyForTransaction needs that reference in order to
    // learn it. Carry forward whatever the original record had that this
    // form doesn't overwrite.
    if (txForm.dataset.id) {
      const original = transactions.find(t => t.id === txForm.dataset.id);
      if (original) {
        tx.rawDescription = original.rawDescription;
        tx.cleanDescription = original.cleanDescription;
        tx.merchant = original.merchant;
        tx.categoryText = original.categoryText;
        tx.bankCategory = original.bankCategory;
        tx.originalLine = original.originalLine;
        tx.source = original.source;
        tx.createdAt = original.createdAt;
      }
    }

    // Property link (Property Expense for expenses, Rental Income for income)
    const isIncomeTx = txForm.type.value === "income";
    const isProp = document.getElementById("isPropertyExpense").checked;
    // isPropertyExpense stays specifically about expenses - it's read
    // elsewhere (expenses.js sync, property card expense totals) as "this
    // is a property expense row", so an income row linked to a property
    // must not set it.
    tx.isPropertyExpense = isProp && !isIncomeTx;
    if (isProp) {
      tx.propertyId = txForm.propertyId.value;
      if (isIncomeTx) {
        // Bug fix: linking an income transaction to a property is only
        // useful if it also gets recognised as rental income - the
        // Property page, Tenants page and ATO Rental Income summary all
        // key off categoryId === 'sub_rental_income', not just propertyId.
        // Force it here so ticking the box is enough on its own, even if
        // the person left the category dropdown on something generic.
        tx.categoryId = 'sub_rental_income';
      } else {
        // Falls back to a bucket derived from the chosen category (see
        // getExpenseCategoryBucket) if the person left the expense-category
        // dropdown on its default, rather than always landing in "Other".
        tx.expenseCategory = txForm.expenseCategory.value || getExpenseCategoryBucket(chosenCategory);
        tx.expenseStatus = txForm.expenseStatus.value;
        tx.receiptUrl = txForm.receiptUrl.value;
        tx.notes = txForm.expenseNotes.value;
      }
    }

    // Vehicle link — only meaningful for a Registration expense (see
    // updateTxVehicleVisibility above); cleared otherwise so switching the
    // category away from Registration doesn't leave a stale vehicleId.
    // Fuel purchases can be linked to a vehicle too (fuel spend / mileage on
    // the Vehicles page), with optional litres + odometer + full-tank flag
    // for accurate fill-to-fill mileage — see vehicleFuelStats.js.
    tx.vehicleId = (chosenCategory === 'sub_rego' || chosenCategory === 'sub_fuel')
      ? (document.querySelector('#txForm [name="vehicleId"]')?.value || '')
      : '';
    if (chosenCategory === 'sub_fuel' && tx.vehicleId) {
      const litres = parseFloat(document.querySelector('#txForm [name="fuelLitres"]')?.value);
      const odo = parseFloat(document.querySelector('#txForm [name="fuelOdometer"]')?.value);
      if (litres > 0) tx.fuelLitres = litres;
      if (odo > 0) tx.fuelOdometer = odo;
      if (document.querySelector('#txForm [name="fuelFullTank"]')?.checked === false) {
        tx.fuelFullTank = false;
      }
    }

    try {
      // Bug fix: manual category choices never fed back into the
      // auto-learning system (learnFromManualCategory existed but was
      // never called anywhere) — the more you corrected categories by
      // hand, the smarter future imports were supposed to get, but that
      // loop was disconnected. tx.merchant is populated by the parser at
      // import time; for manually-entered transactions it'll be undefined
      // and learnFromManualCategory() falls back to the description.
      if (chosenCategory) {
        learnFromManualCategory(tx, chosenCategory);
      }

      // Bug fix: manually tagging a transaction to a property never fed
      // back into anything either — every future import of a bill from the
      // same merchant on the same account had to be tagged by hand all
      // over again. This teaches the merchant+account -> property rule
      // (see learnPropertyForTransaction in categoryMapper.js) so imports
      // going forward can auto-flag it.
      if (isProp && tx.propertyId) {
        learnPropertyForTransaction(tx, tx.propertyId);
      } else if (!isProp && txForm.dataset.wasPropertyLinked === "1") {
        // The app (or a previous manual tag) had flagged this transaction
        // as a property expense and the person just unchecked it - teach
        // this exact merchant+account+amount as confirmed NOT a property
        // expense (propertyId: null), so future imports of the same bill
        // (e.g. the same water corp also billing this person's own home)
        // don't get wrongly re-flagged. See isConfirmedNonPropertyExpense
        // in categoryMapper.js / saver.js.
        learnPropertyForTransaction(tx, null);
      }

      if (txForm.dataset.id) {
        await updateItem(STORE_NAMES.transactions, tx);
      } else {
        await addItem(STORE_NAMES.transactions, tx);
      }

      // Sync property expenses if needed (income never syncs here - it's
      // not a property "expense" row, and belongs on the Property/Tenants
      // pages and the ATO Rental Income summary instead, which read
      // straight off the transaction's propertyId/categoryId).
      if (tx.isPropertyExpense) {
        await syncToExpenses(tx);
      }

      // Registration expense linked to a vehicle: mirrors bills.js's
      // syncVehicleRegoFromBill (a paid Registration bill updates the
      // vehicle's own regoCost/regoExpiryDate) — without this, picking a
      // vehicle here only ever recorded vehicleId on the transaction
      // itself, and the Vehicles page's Registration card (which reads
      // vehicle.regoExpiryDate/regoCost directly, not transactions) kept
      // showing "not set" no matter how many rego transactions you logged.
      // Runs on every save (not just a newly-added/changed link) so the
      // Vehicles page is always in sync with whatever this transaction
      // currently says — safe to re-run because getNextRegoExpiryDate is
      // computed from this transaction's own date each time, not chained
      // off the vehicle's last stored value, so saving the same rego
      // transaction twice lands on the same expiry date rather than
      // drifting further out with every save.
      if (tx.vehicleId && tx.categoryId === 'sub_rego') {
        await syncVehicleRegoFromTransaction(tx).catch(err =>
          console.error('❌ Failed to sync rego transaction to vehicle:', err)
        );
      }

      // Fuel fill with an odometer: keep the vehicle's own "current
      // odometer" in step with the latest fill.
      if (tx.vehicleId && tx.categoryId === 'sub_fuel') {
        await syncVehicleFuelFromTransaction(tx).catch(err =>
          console.error('❌ Failed to sync fuel transaction to vehicle:', err)
        );
      }

      hideForms();
      handleSaved();
    } catch (error) {
      console.error("[TX] Failed to save transaction:", error);
      alert("Failed to save transaction. Please try again.");
    }
  });

  if (filterForm) {
    filterForm.addEventListener("submit", e => {
      e.preventDefault();
      // Manual Start/End Date in the modal now takes precedence — reset
      // the quick Year/Month pickers so they don't keep showing a value
      // that no longer matches what's actually applied.
      quickDateJumpReset?.();
      applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today);
      hideForms();
    });
  }
}

// ============================================================================
// Filtering (search box + filter panel)
// ------------------------------------------------------------------------
// Previously the filter form's submit handler only called preventDefault()
// and logged to the console — "Apply filters logic here" was left as a
// comment and nothing ever actually filtered the list. These two functions
// are the real implementation, shared by the filter panel, the sort
// dropdown, and the new search box so all three combine correctly.
// ============================================================================
function getFilteredTransactions(transactions, categories, accounts) {
  const filterForm = document.getElementById("filterForm");
  const searchInput = document.getElementById("txSearchInput");
  const searchTerm = (searchInput?.value || "").trim().toLowerCase();
  const fySelect = document.getElementById("txFY");
  const fyValue = fySelect?.value || "";

  let type = "", accountId = "", mainCategory = "", subCategory = "", startDate = "", endDate = "";
  if (filterForm) {
    type = filterForm.type.value;
    accountId = filterForm.accountId.value;
    mainCategory = filterForm.mainCategory.value;
    subCategory = filterForm.subCategory.value;
    startDate = filterForm.startDate.value;
    endDate = filterForm.endDate.value;
  }

  // Financial year filter (Jul 1 - Jun 30). Independent of the Start/End
  // Date fields in the filter panel - picking a FY here is the fast path,
  // Start/End Date is still there for anyone who wants an arbitrary range.
  let fyStart = null, fyEnd = null;
  if (fyValue) {
    const range = getFYRange(parseInt(fyValue, 10));
    fyStart = range.fyStart;
    fyEnd = range.fyEnd;
  }

  return transactions.filter(tx => {
    if (activeSourceTab === "recurring" && !tx.recurringId) return false;
    if (activeSourceTab === "bills" && !tx.billId) return false;

    if (type && tx.type !== type) return false;
    if (accountId && tx.accountId !== accountId) return false;
    if (startDate && tx.date < startDate) return false;
    if (endDate && tx.date > endDate) return false;
    if (fyStart && fyEnd) {
      const d = new Date(tx.date);
      if (isNaN(d.getTime()) || d < fyStart || d > fyEnd) return false;
    }

    if (subCategory) {
      if (tx.categoryId !== subCategory) return false;
    } else if (mainCategory) {
      const cat = categories.find(c => c.id === tx.categoryId);
      const belongsToMain = tx.categoryId === mainCategory || (cat && cat.parentId === mainCategory);
      if (!belongsToMain) return false;
    }

    if (searchTerm) {
      const cat = categories.find(c => c.id === tx.categoryId);
      const account = accounts.find(a => a.id === tx.accountId);
      const haystack = [
        tx.description,
        cat?.name,
        tx.bankCategory,
        tx.merchant,
        tx.notes,
        account?.name,
        String(Math.abs(tx.amount || 0))
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    return true;
  });
}

// ============================================================================
// Quick Date Jump (Year/Month selects next to Add Transaction/Filter)
// ------------------------------------------------------------------------
// Same Year/Month <select> pattern as the Financial Dashboard's filter bar
// (js/financialDashboard.js renderFilterBar) — native <input type="month">
// rendered blank in this app's theme, so this mirrors that page's working
// approach instead. Sets filterForm's Start/End Date fields (used by
// getFilteredTransactions above) directly, so it's just a fast way to fill
// in that same range — it doesn't add a second, separately-maintained date
// filter.
// ============================================================================
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function setupQuickDateJump(transactions, fySelect, rerender) {
  const yearSelect = document.getElementById("txQuickYear");
  const monthSelect = document.getElementById("txQuickMonth");
  const filterForm = document.getElementById("filterForm");
  if (!yearSelect || !monthSelect || !filterForm) return;

  const now = new Date();
  // Every calendar year that actually has transaction history, plus the
  // current year even if it's empty yet — same rule the Financial
  // Dashboard's Year select uses, so a year with nothing in it never
  // shows up as an option here either.
  const yearsAvailable = [...new Set(transactions.map(t => t.date?.slice(0, 4)).filter(Boolean))]
    .map(Number)
    .concat(now.getFullYear())
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => b - a);

  // Backed by module-level txQuickState so a re-render can restore it.
  let quickYear = txQuickState.year;   // null = "All Time" (no quick filter applied)
  let quickMonth = txQuickState.month; // null = "Full Year"

  function render() {
    txQuickState = { year: quickYear, month: quickMonth };
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth();
    yearSelect.innerHTML = `
      <option value="all">All Time</option>
      ${yearsAvailable.map(y => `<option value="${y}" ${quickYear === y ? 'selected' : ''}>${y}${y === currentYear ? ' (current)' : ''}</option>`).join('')}
    `;
    monthSelect.innerHTML = `
      <option value="all" ${quickMonth === null ? 'selected' : ''}>Full Year</option>
      ${MONTH_LABELS.map((m, idx) => {
        const isCurrent = idx === currentMonthIdx && quickYear === currentYear;
        return `<option value="${idx}" ${quickMonth === idx ? 'selected' : ''}>${m}${isCurrent ? ' (current)' : ''}</option>`;
      }).join('')}
    `;
    monthSelect.disabled = quickYear === null;
  }

  function apply() {
    if (fySelect) fySelect.value = ""; // avoid narrowing against FY too
    if (quickYear === null) {
      filterForm.startDate.value = "";
      filterForm.endDate.value = "";
    } else if (quickMonth === null) {
      filterForm.startDate.value = `${quickYear}-01-01`;
      filterForm.endDate.value = `${quickYear}-12-31`;
    } else {
      const start = `${quickYear}-${String(quickMonth + 1).padStart(2, '0')}-01`;
      const end = new Date(quickYear, quickMonth + 1, 0).toISOString().split("T")[0]; // last day of month
      filterForm.startDate.value = start;
      filterForm.endDate.value = end;
    }
    render();
    rerender();
  }

  yearSelect.addEventListener("change", () => {
    quickYear = yearSelect.value === "all" ? null : parseInt(yearSelect.value, 10);
    quickMonth = null; // reset to Full Year whenever the year changes
    apply();
  });

  monthSelect.addEventListener("change", () => {
    quickMonth = monthSelect.value === "all" ? null : parseInt(monthSelect.value, 10);
    apply();
  });

  render();

  quickDateJumpReset = () => {
    quickYear = null;
    quickMonth = null;
    render();
  };
}

function applyFiltersAndRender(transactions, categories, accounts, properties, subCats, today) {
  const filtered = getFilteredTransactions(transactions, categories, accounts);
  const isFiltered = filtered.length !== transactions.length;

  const txCountEl = document.getElementById("txCount");
  if (txCountEl) {
    txCountEl.textContent = isFiltered
      ? `${filtered.length} of ${transactions.length} transactions`
      : `${transactions.length} transactions`;
  }

  // Totals for whatever is currently on screen — the full list when no
  // search/filter is active, or just the matching subset when one is. This
  // intentionally does NOT touch the summary cards at the top of the page
  // (Total Income / Total Expenses / Net Flow / This Month) — those are
  // meant to stay fixed, overall reference numbers regardless of what
  // you're searching for in the list below.
  const summaryEl = document.getElementById("txFilteredSummary");
  if (summaryEl) {
    const { code, income, expenses, net } = listTotals(filtered, accounts);
    // Filtered to one foreign-currency account: show its own currency, with the
    // base-currency equivalent of the net alongside.
    const netEq = code && hasRate(code) ? ` <small style="opacity:.7">${baseEquivalent(Math.abs(net), code)}</small>` : "";

    summaryEl.innerHTML = `
      <span class="positive">Income ${formatMoney(income, code || undefined)}</span>
      <span class="negative">Expenses ${formatMoney(Math.abs(expenses), code || undefined)}</span>
      <span class="${net >= 0 ? "positive" : "negative"}">Net ${formatMoney(Math.abs(net), code || undefined)}${netEq}</span>
    `;
  }

  renderTransactions(filtered, categories, accounts, properties, subCats, today);
}

// If every transaction in the list sits in ONE non-base currency (e.g. the list is
// filtered to an INR account), totals are shown in that currency rather than
// converted. Returns the currency code, or null for mixed / base-currency lists.
function singleForeignCurrency(txs, accounts) {
  const byId = new Map(accounts.map(a => [a.id, a.currency || getBaseCurrency()]));
  const codes = new Set(txs.map(t => t.currency || byId.get(t.accountId) || getBaseCurrency()));
  if (codes.size !== 1) return null;
  const [code] = codes;
  return code !== getBaseCurrency() ? code : null;
}

// Sum of amounts in the list's own currency when single-foreign, else in base.
function listTotals(txs, accounts) {
  const code = singleForeignCurrency(txs, accounts);
  const useTx = code ? txs : toBaseTransactions(txs, accounts);
  const inc = useTx.filter(t => t.type === "income" && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  const exp = useTx.filter(t => t.type === "expense" && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  return { code, income: inc, expenses: exp, net: inc + exp };
}

// ============================================================================
// Transactions Renderer
// ============================================================================
function renderTransactions(transactions, categories, accounts, properties, subCats, today) {
  const list = document.getElementById("txList");
  if (!list) {
    console.warn("[TX] txList element not found");
    return;
  }

  const sortSelect = document.getElementById("sortTransactions");
  const sort = sortSelect ? sortSelect.value : "date-desc";

  let txs = [...transactions];

  if (sort === "date-desc") txs.sort((a, b) => b.date.localeCompare(a.date));
  if (sort === "date-asc") txs.sort((a, b) => a.date.localeCompare(b.date));
  if (sort === "amount-desc") txs.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  if (sort === "amount-asc") txs.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));

  if (txs.length === 0) {
    list.innerHTML = `<div class="empty-state">No transactions found. Add your first transaction!</div>`;
    return;
  }

  const groups = {};
  txs.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));

  list.innerHTML = Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map(date => {
      const dayTxs = groups[date];
      const dayCode = singleForeignCurrency(dayTxs, accounts);
      const total = (dayCode ? dayTxs : toBaseTransactions(dayTxs, accounts)).reduce((sum, t) => sum + t.amount, 0);

      return `
        <div class="transaction-day-group">
          <div class="transaction-date-header">
            <span>${formatDate(date)}</span>
            <span class="${total >= 0 ? "positive" : "negative"}">${formatMoney(Math.abs(total), dayCode || undefined)}</span>
          </div>
          ${dayTxs.map(t => renderTransactionCard(t, categories, accounts, properties)).join("")}
        </div>
      `;
    })
    .join("");

  attachTxEvents(txs, categories, accounts, properties, subCats, today, transactions);
}

// ============================================================================
// Smart Category Name Resolver
// ============================================================================
function getCategoryDisplayName(tx, categories) {

  // 1️⃣ Internal category match via categoryId
  if (tx.categoryId) {
    const cat = categories.find(c => c.id === tx.categoryId);
    if (cat) return cat.name;
  }

  // 2️⃣ NAB/Bank-provided category
  if (tx.bankCategory && tx.bankCategory.trim() !== "") {
    return tx.bankCategory;
  }

  // 3️⃣ Cleaned keyword text extracted from description
  if (tx.categoryText && tx.categoryText.trim() !== "") {
    return tx.categoryText;
  }

  // 4️⃣ Merchant name
  if (tx.merchant && tx.merchant.trim() !== "") {
    return tx.merchant;
  }

  // 5️⃣ Fallback
  return "Uncategorized";
}

function renderTransactionCard(tx, categories, accounts, properties) {
  const category = categories.find(c => c.id === tx.categoryId);
  const account = accounts.find(a => a.id === tx.accountId);
  const property = properties.find(p => p.id === tx.propertyId);
  const isIncome = tx.amount > 0;
  // Bug fix: this card used to color/label every row purely off the raw
  // amount sign, so a general transfer or loan draw - amount:true credit
  // to this account, but isTransfer:true because it's not real income
  // (see resolveTransactionSemantics in categoryMapper.js) - still showed
  // up green with a "+" like ordinary income, directly contradicting the
  // Income/Expense totals right above it on this same page, which already
  // exclude it. Transfers now get a neutral card class/icon and a small
  // badge instead.
  const isTransfer = !!tx.isTransfer;

  // Show bank category if no category assigned
  const displayCategory = getFullCategoryName(tx.categoryId, categories);
  const displayName = displayCategory === "Uncategorized" && tx.bankCategory 
    ? `[Bank: ${escapeHtml(tx.bankCategory)}] ${escapeHtml(tx.description)}`
    : displayCategory;

  // Retailer/bank logo matched from the transaction description (see
  // js/import/merchantLogos.js). Falls back to the category emoji if no
  // merchant is recognized, or if the image itself fails to load — a
  // mismatched/missing logo should never show a broken-image icon.
  const fallbackIcon = category?.icon || (isTransfer ? "🔄" : (isIncome ? "💰" : "💸"));
  const logoPath = getMerchantLogo(tx.description || '');
  const iconHtml = logoPath
    ? `<img src="${logoPath}" alt="${escapeHtml(displayCategory)} logo" class="merchant-logo"
         onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
       <span style="display:none;">${fallbackIcon}</span>`
    : fallbackIcon;

  return `
    <div class="transaction-card ${isTransfer ? "transfer" : (isIncome ? "income" : "expense")}" data-id="${tx.id}">
      <div class="transaction-main">
        <div class="transaction-icon">${iconHtml}</div>
        <div class="transaction-details">
          <!-- Show bank category hint if not categorized -->
          <div class="transaction-title">${displayName}</div>
          ${isTransfer ?
            `<div class="transaction-hint" style="font-size: 0.8em; color: #6b7280;">
              🔄 Transfer — excluded from Income/Expense totals
            </div>`
            : ''}
          ${!tx.categoryId && tx.bankCategory ? 
            `<div class="transaction-hint" style="font-size: 0.8em; color: #666;">
              Bank categorized as: ${escapeHtml(tx.bankCategory)}
            </div>` 
            : ''}
          <div class="transaction-meta">
            <span>${escapeHtml(account?.name) || "Unknown Account"}</span>
            ${tx.isPropertyExpense && property ? `<span class="property-tag">🏠 ${escapeHtml(property.name)}</span>` : ""}
            ${!tx.isPropertyExpense && isIncome && tx.propertyId && property ? `<span class="property-tag">🏠 ${escapeHtml(property.name)} · Rental Income</span>` : ""}
          </div>
          ${tx.description ? `<div class="transaction-description">${escapeHtml(tx.description)}</div>` : ""}
        </div>
        <div class="transaction-amount ${isTransfer ? "" : (isIncome ? "positive" : "negative")}" style="${isTransfer ? 'color:#6b7280;' : ''}">
          ${isIncome ? "+" : "-"}${formatMoney(Math.abs(tx.amount), account?.currency)}
          ${txEquivalent(tx, account?.currency) ? `<div class="tx-equivalent" style="font-size:0.75rem;font-weight:400;opacity:0.7">${txEquivalent(tx, account?.currency)}</div>` : ""}
        </div>
      </div>
      <div class="transaction-actions">
        <button class="edit-btn" data-id="${tx.id}" title="Edit">✏️</button>
        <button class="delete-btn" data-id="${tx.id}" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Event Handlers
// ============================================================================
function attachTxEvents(transactions, categories, accounts, properties, subCats, today, allTransactions) {
  document.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tx = transactions.find(t => t.id === btn.dataset.id);
      if (tx) {
        loadTransactionIntoForm(tx, categories, properties);
      }
    });
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Delete this transaction?")) {
        try {
          await deleteItem(STORE_NAMES.transactions, btn.dataset.id);
          initTransactionsUI({ preserveView: true });
        } catch (error) {
          console.error("[TX] Failed to delete transaction:", error);
          alert("Failed to delete transaction. Please try again.");
        }
      }
    });
  });
}

function loadTransactionIntoForm(tx, categories, properties) {
  const form = document.getElementById("txForm");
  if (!form) return;

  form.dataset.id = tx.id;
  // Remembered so the submit handler can tell "was linked to a property,
  // now being unchecked" apart from "never was one" - only the former
  // should teach the merchant+account+amount combination as confirmed NOT
  // a property transaction (see learnPropertyForTransaction call below
  // and isConfirmedNonPropertyExpense in categoryMapper.js). Covers both
  // property expenses and property-linked (rental) income.
  form.dataset.wasPropertyLinked = tx.propertyId ? "1" : "0";

  form.type.value = tx.amount > 0 ? "income" : "expense";
  form.amount.value = Math.abs(tx.amount);
  form.date.value = tx.date;
  form.accountId.value = tx.accountId || "";
  form.description.value = tx.description || "";
  {
    const aud = form.querySelector('[name="amountAUD"]');
    if (aud) {
      aud.value = tx.amountAUD ? Math.abs(tx.amountAUD) : "";
      aud.dataset.manual = tx.amountAUD ? "1" : "";
      form._refreshAudField?.();
    }
  }

  // Set category
  const mainCat = document.getElementById("mainCategory");
  const subCat = document.getElementById("subCategory");
  if (tx.categoryId) {
    const category = categories.find(c => c.id === tx.categoryId);
    if (category) {
      if (category.parentId) {
        // Set main category
        mainCat.value = category.parentId;

        // Rebuild subcategory list BEFORE selecting
        rebuildSubcategoriesForEdit(category.parentId, categories);

        // Select subcategory
        subCat.value = tx.categoryId;
      } else {
        // No subcategory
        mainCat.value = tx.categoryId;

        rebuildSubcategoriesForEdit(tx.categoryId, categories);
      }
    }

  }

  // Vehicle link (Registration expense linked to a specific vehicle) —
  // show/hide first based on the category just set, then restore the
  // saved value if the section is relevant.
  updateTxVehicleVisibility(tx.categoryId || '');
  const vehicleField = document.querySelector('#txForm [name="vehicleId"]');
  if (vehicleField) { vehicleField.value = tx.vehicleId || ''; vehicleField.dataset.suggested = ''; }
  const fuelLitresField = document.querySelector('#txForm [name="fuelLitres"]');
  if (fuelLitresField) fuelLitresField.value = tx.fuelLitres ?? '';
  const fuelOdoField = document.querySelector('#txForm [name="fuelOdometer"]');
  if (fuelOdoField) fuelOdoField.value = tx.fuelOdometer ?? '';
  const fuelFullField = document.querySelector('#txForm [name="fuelFullTank"]');
  if (fuelFullField) fuelFullField.checked = tx.fuelFullTank !== false;

  // Property link fields (property expense OR property-linked rental income)
  // Sets up the section's labels/sub-fields for the transaction's type first...
  togglePropertyExpenseFields();

  const isPropertyExpense = document.getElementById("isPropertyExpense");
  const propertyExpenseFields = document.getElementById("propertyExpenseFields");

  // Bug fix: this used to only ever check tx.isPropertyExpense, so an
  // income transaction that already had a propertyId (e.g. set by the
  // import auto-matcher) opened in Edit with the box unchecked and the
  // property dropdown blank - looking exactly like it was never linked.
  const isLinked = tx.isPropertyExpense || (tx.type === "income" && !!tx.propertyId);

  if (isLinked) {
    isPropertyExpense.checked = true;
    propertyExpenseFields.style.display = "block";

    form.propertyId.value = tx.propertyId || "";
    form.expenseCategory.value = tx.expenseCategory || "";
    form.expenseStatus.value = tx.expenseStatus || "Paid";
    form.receiptUrl.value = tx.receiptUrl || "";
    form.expenseNotes.value = tx.notes || "";
  } else {
    isPropertyExpense.checked = false;
    propertyExpenseFields.style.display = "none";
  }

  // Editing an existing transaction - swap the modal's title so it's clear
  // this isn't a blank "Add" form.
  const formTitle = document.getElementById("txFormTitle");
  if (formTitle) formTitle.textContent = "Edit Transaction";

  // "Convert to Transfer" — for a transaction that's actually one side of
  // moving your own money between your own accounts (the most common
  // real case: paying off a credit card via BPAY from an everyday
  // account), but got imported as a plain one-sided expense because the
  // credit card's own statement was never imported to match it against.
  // Left as-is, that payment only ever reduces the source account's
  // balance - the credit card account gets no corresponding transaction
  // at all, so its balance never reflects the payment (or, if that's its
  // only activity, shows nothing/zero, looking "not populated"). This
  // creates the missing other-side transaction retroactively rather than
  // requiring the person to delete this row and re-enter it from scratch
  // via Accounts > Transfer Between Accounts.
  const convertBtn = document.getElementById("btnConvertToTransfer");
  if (convertBtn) {
    convertBtn.style.display = tx.isTransfer ? "none" : "inline-flex";
    convertBtn.onclick = () => openConvertToTransferPrompt(tx);
  }

  showEditForm();
}

// Handles the "Convert to Transfer" button: asks which of the person's OWN
// accounts this transaction was really moving money to/from, then creates
// the missing other-side transaction and marks both as a linked transfer -
// same data shape as accounts.js's openTransferForm (shared category,
// transferGroupId, transferDirection), so account balances, budgets, and
// income/expense totals all treat it consistently either way it was
// created. The original transaction keeps its id, date, and account -
// only its isTransfer/transferGroupId/transferDirection/category get set,
// so nothing else referencing it (property links, learned merchant rules)
// gets disturbed.
async function openConvertToTransferPrompt(tx) {
  const [accounts, categories] = await Promise.all([
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.categories)
  ]);

  const otherAccounts = accounts.filter(a => a.id !== tx.accountId);
  if (otherAccounts.length === 0) {
    alert('You need at least one other account to convert this into a transfer.');
    return;
  }

  const isOutgoing = tx.amount < 0; // expense on this account = money leaving it
  const directionLabel = isOutgoing ? 'paid TO' : 'received FROM';
  const listText = otherAccounts.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
  const choice = prompt(
    `Which account was this ${directionLabel}?\n\n${listText}\n\n` +
    `Enter the number (e.g. for a credit card payment, pick the credit card account):`
  );
  if (choice === null) return;

  const idx = parseInt(choice, 10) - 1;
  const otherAccount = otherAccounts[idx];
  if (!otherAccount) {
    alert('Not a valid choice - nothing was changed.');
    return;
  }

  const transferCategory = categories.find(c => c.id === 'sub_general_transfer');
  const transferGroupId = generateId();
  const now = new Date().toISOString();

  // Update the existing transaction in place to be the "out" or "in" side,
  // whichever it already naturally is (an expense here is money leaving
  // this account, so it's the "out" side; an income here is money
  // arriving, so it's the "in" side) - this account and this amount/date
  // don't change, only how it's categorized and linked.
  const updatedOriginal = {
    ...tx,
    categoryId: transferCategory?.id || 'sub_general_transfer',
    isTransfer: true,
    transferGroupId,
    transferDirection: isOutgoing ? 'out' : 'in',
    updatedAt: now
  };
  await updateItem(STORE_NAMES.transactions, updatedOriginal);

  // Create the missing other-side transaction on the OTHER account, with
  // the opposite sign - this is the transaction that was never created
  // when this was a plain one-sided import, which is exactly why that
  // other account's balance never moved to reflect it.
  // Cross-currency: the other side is the same value expressed in the OTHER account's currency at
  // the stored rate (it used to copy the figure across: A$300 out became +300 USD in). Direction
  // doesn't change the maths — it's this row's amount, re-denominated.
  const thisAccount = accounts.find(a => a.id === tx.accountId);
  const conv = transferLegs(Math.abs(tx.amount), thisAccount?.currency, otherAccount.currency);
  const legs = {
    received: conv.received,
    fx: !conv.cross ? {} : {
      fxRate: isOutgoing ? conv.fx.fxRate : Math.abs(tx.amount) / conv.received,
      fxFrom: isOutgoing ? thisAccount.currency : otherAccount.currency,
      fxTo: isOutgoing ? otherAccount.currency : thisAccount.currency
    }
  };
  const otherMagnitude = legs.received;
  const otherTx = {
    id: generateId(),
    accountId: otherAccount.id,
    amount: isOutgoing ? otherMagnitude : -otherMagnitude,
    type: isOutgoing ? 'income' : 'expense',
    categoryId: transferCategory?.id || 'sub_general_transfer',
    date: tx.date,
    description: isOutgoing
      ? `Transfer from ${accounts.find(a => a.id === tx.accountId)?.name || 'account'}`
      : `Transfer to ${accounts.find(a => a.id === tx.accountId)?.name || 'account'}`,
    isTransfer: true,
    transferGroupId,
    transferDirection: isOutgoing ? 'in' : 'out',
    ...legs.fx,
    createdAt: now,
    updatedAt: now
  };
  await addItem(STORE_NAMES.transactions, otherTx);
  if (legs.fx.fxFrom) await updateItem(STORE_NAMES.transactions, { ...updatedOriginal, ...legs.fx, updatedAt: new Date().toISOString() });

  alert(`Converted to a transfer with ${otherAccount.name}. ${otherAccount.name}'s balance now reflects it.`);
  document.getElementById('closeAddForm')?.click();
  initTransactionsUI({ preserveView: true });
}

// Always shows (never toggles/hides) the transaction form - used
// specifically for editing, where the modal must end up open regardless of
// whatever state it was already in. Now a fixed, centered overlay (see
// .tx-modal-overlay in styles.css) instead of an inline section further
// down the page, so it always appears in the same place - centered in the
// viewport - no matter which transaction (or how far down the list) you
// clicked Edit on, and no scrolling is needed to bring it into view.
function showEditForm() {
  const addForm = document.getElementById("addTxForm");
  const filterForm = document.getElementById("filterTxForm");
  if (!addForm) return;

  addForm.style.display = "block";
  if (filterForm) filterForm.style.display = "none";
  document.body.classList.add("tx-modal-open");

  // Reset any scroll position left over from a previous, longer form.
  const box = addForm.querySelector(".tx-modal-box");
  if (box) box.scrollTop = 0;

  // Focus the first meaningful field once it's in view, so keyboard users
  // can start editing immediately without hunting for the form.
  setTimeout(() => {
    document.getElementById("mainCategory")?.focus();
  }, 150);
}
// UI helpers
// ============================================================================
function toggleAddForm() {
  const addForm = document.getElementById("addTxForm");
  const filterForm = document.getElementById("filterTxForm");
  
  if (addForm && filterForm) {
    const opening = addForm.style.display === "none";
    addForm.style.display = opening ? "block" : "none";
    filterForm.style.display = "none";
    document.body.classList.toggle("tx-modal-open", opening);

    // Starting a fresh Add (not editing) - make sure the title and form
    // state left over from a previous Edit don't leak in.
    if (opening) {
      const formTitle = document.getElementById("txFormTitle");
      if (formTitle) formTitle.textContent = "Add Transaction";
      const txForm = document.getElementById("txForm");
      if (txForm) {
        delete txForm.dataset.id;
        delete txForm.dataset.wasPropertyLinked;
      }
    }
  }
}

function toggleFilterForm() {
  const addForm = document.getElementById("addTxForm");
  const filterForm = document.getElementById("filterTxForm");
  
  if (addForm && filterForm) {
    const opening = filterForm.style.display === "none";
    filterForm.style.display = opening ? "block" : "none";
    addForm.style.display = "none";
    document.body.classList.toggle("tx-modal-open", opening);
  }
}

function hideForms() {
  const addForm = document.getElementById("addTxForm");
  const filterForm = document.getElementById("filterTxForm");
  
  if (addForm) addForm.style.display = "none";
  if (filterForm) filterForm.style.display = "none";
  document.body.classList.remove("tx-modal-open");
}

function clearFilterForm() {
  const filterForm = document.getElementById("filterForm");
  if (filterForm) {
    filterForm.reset();
    initTransactionsUI();
  }
}

// ============================================================================
// Property Expense Toggle Functions
// ============================================================================
export function togglePropertyExpenseFields() {
  const typeSelect = document.querySelector("[name='type']");
  const section = document.getElementById("propertyExpenseSection");
  if (!typeSelect || !section) return;

  // Bug fix: this used to only show the property-link section for
  // "expense" transactions, so a rent deposit imported/entered as
  // "income" had no way to be tagged to a property at all - not on
  // import (no checkbox existed) and not after the fact via Edit. That's
  // why rental income never showed up on the Property page or the
  // Tenants page, even when the ATO Rental Income summary (which only
  // needs the category, not a property) picked it up fine. Both income
  // and expense now get the section, just with a different label and
  // different sub-fields (see below).
  const isIncome = typeSelect.value === "income";
  section.style.display = "block";

  const label = document.getElementById("propertyCheckboxLabel");
  if (label) label.textContent = isIncome ? "Rental Income" : "Property Expense";

  // Expense-only sub-fields (category/status/receipt/notes) don't apply
  // to a rent deposit - hide them for income, and swap in a short
  // explanation of what checking the box does instead.
  const expenseOnlyIds = ["expenseCategoryGroup", "expenseStatusGroup", "expenseExtraRow"];
  expenseOnlyIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isIncome ? "none" : "";
  });
  const hint = document.getElementById("rentalIncomeHint");
  if (hint) hint.style.display = isIncome ? "block" : "none";
}

export function togglePropertyExpenseCheckbox() {
  const checkbox = document.getElementById("isPropertyExpense");
  const propertyFields = document.getElementById("propertyExpenseFields");
  
  if (checkbox && propertyFields) {
    propertyFields.style.display = checkbox.checked ? "block" : "none";
  }
}

// Make functions available globally for inline onclick handlers
window.togglePropertyExpenseFields = togglePropertyExpenseFields;
window.togglePropertyExpenseCheckbox = togglePropertyExpenseCheckbox;

// ============================================================================
// Helper Functions
// ============================================================================
function formatDate(date) {
  try {
    const d = new Date(date);
    return d.toLocaleDateString("en-AU", { weekday: "short", month: "short", day: "numeric" });
  } catch (e) {
    return date;
  }
}

// ============================================================================
// 🏠 SYNC: Push Property-Related Transactions → Expenses Store
// ============================================================================
export async function syncToExpenses(transaction) {
  try {
    const expenses = await getGatedItems(STORE_NAMES.expenses).catch(() => []);

    const existingExpense = expenses.find(e => e.transactionId === transaction.id);

    const expenseData = {
      id: existingExpense ? existingExpense.id : generateId(),
      transactionId: transaction.id,
      propertyId: transaction.propertyId || "",
      category: transaction.expenseCategory || "Other",
      description: transaction.description || "Property Expense",
      amount: Math.abs(transaction.amount),
      date: transaction.date,
      status: transaction.expenseStatus || "Paid",
      receiptUrl: transaction.receiptUrl || "",
      notes: transaction.notes || "",
      taxDeductible: true,
      recurring: false,
      frequency: "monthly",
      nextDue: transaction.date,
      createdAt: existingExpense ? existingExpense.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingExpense) {
      await updateItem(STORE_NAMES.expenses, expenseData);
    } else {
      await addItem(STORE_NAMES.expenses, expenseData);
    }

    return expenseData;
  } catch (err) {
    console.error("❌ syncToExpenses() failed:", err);
    throw err;
  }
}

// ============================================================================
// 🔄 SYNC ALL: Ensure all property expenses appear in Expenses page
// ============================================================================
export async function syncAllPropertyExpenses() {
  try {
    const [transactions, expenses] = await Promise.all([
      getAllItems(STORE_NAMES.transactions),
      getGatedItems(STORE_NAMES.expenses).catch(() => [])
    ]);

    // Look for transactions marked as property expense
    const propertyTransactions = transactions.filter(
      t => t.type === "expense" && t.isPropertyExpense && t.propertyId
    );

    // Filter out ones already synced
    const unsynced = propertyTransactions.filter(
      t => !expenses.find(e => e.transactionId === t.id)
    );

    if (unsynced.length === 0) {
      return {
        synced: 0,
        total: 0,
        message: "All property expenses are already synced!"
      };
    }

    let syncedCount = 0;

    for (const tx of unsynced) {
      try {
        await syncToExpenses(tx);
        syncedCount++;
      } catch (syncErr) {
        console.error(`❌ Failed to sync transaction ${tx.id}`, syncErr);
      }
    }

    return {
      synced: syncedCount,
      total: unsynced.length,
      message: `Synced ${syncedCount} new property expenses.`
    };

  } catch (err) {
    console.error("❌ syncAllPropertyExpenses() error:", err);
    return {
      synced: 0,
      total: 0,
      message: "Sync failed due to an unexpected error."
    };
  }

}

function getFullCategoryName(categoryId, categories) {
  if (!categoryId) return "Uncategorized";

  const category = categories.find(c => c.id === categoryId);
  if (!category) return "Uncategorized";

  // If subcategory → show Parent › Child
  if (category.parentId) {
    const parent = categories.find(c => c.id === category.parentId);
    if (parent) return `${escapeHtml(parent.name)} › ${escapeHtml(category.name)}`;
  }

  // Main category only
  return escapeHtml(category.name);
}
