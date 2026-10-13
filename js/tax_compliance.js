// ============================================================================
// 📘 tax_compliance.js — Australian ATO Compliance & Reporting Hub
// ============================================================================

import { getAllItems, STORE_NAMES } from './db.js';
import {
  getMostRecentCompletedFYRange,
  calculateCGTValues,
  getAssumedMarginalRate,
  getFYRange,
  getFYStartYear,
  getIndividualRates,
  isRateTableKnown,
  calculateNegativeGearingEffect,
  calculateFirstYearDepreciation,
  computeRentalFigures,
  getTaxDeadlines,
  parseLocalDate
} from './taxCalculations.js';
import { PROPERTY_EXPENSE_CATEGORIES, getExpenseCategoryBucket } from './propertyExpenseCategories.js';
import { escapeHtml } from './sanitize.js';
import { calculatePaymentAmount, calculateOffsetSavings, calculateRefinanceBreakEven, rankDebtPayoffOrder } from './loanCalculations.js';
import { calculateRentalYield as calcRentalYield, calculatePropertyCashFlow } from './investmentCalculations.js';
import { computeAccountBalance } from './accountBalance.js';

import { propertyCurrency, toAud, toAudTransactions } from './utils/currency.js';
// Real-data cache for the Offset/Rental Yield/Cash Flow/Debt Payoff
// calculators — populated once in initTaxComplianceUI, read by their
// show*Modal functions on demand (see the note above createOffsetModal).
let cachedLoans = [];
let cachedAccounts = [];
let cachedProperties = [];
let cachedTransactions = [];
let cachedRawTransactions = [];   // per-account (native currency) amounts, for balances
let cachedLoanTransactions = [];  // loan payment records (interest portion feeds rental deductions)
let cachedCostbase = [];          // cost-base records (capitalised transactions are not deductions)
let cachedDirectExpenses = [];    // property expenses entered by hand in the Expenses page
let cachedMaintenance = [];

// Feature: lets the Rental Summary card look at a financial year other than
// "current FY, to date" (e.g. reconciling against an already-lodged
// return) without re-fetching from IndexedDB on every change - the data
// loaded once in initTaxComplianceUI is cached here so the FY dropdown's
// change handler can just re-render with a different year.
let rentalSummaryData = null;
let selectedRentalFY = null; // null = current FY, to date

function currentFYStartYear() {
  return getFYStartYear(new Date());
}

// Small per-device settings (marginal rate, GST-registered). Wrapped in
// try/catch because storage can be unavailable (private mode, blocked).
function loadSetting(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* non-fatal */ }
}
function getAssumedRatePercent() {
  const v = parseFloat(loadSetting('dfm_tax_assumedRate', ''));
  return Number.isFinite(v) && v >= 0 && v <= 60 ? v : Math.round(getAssumedMarginalRate() * 100);
}

function renderRentalFYOptions(transactions, selected = selectedRentalFY) {
  const thisFY = currentFYStartYear();
  const years = new Set([thisFY, thisFY - 1]);
  (transactions || []).forEach(t => {
    const d = t && t.date ? parseLocalDate(t.date) : null;
    if (d) years.add(getFYStartYear(d));
  });
  return Array.from(years).sort((a, b) => b - a).map(y => `
    <option value="${y}" ${(selected ?? thisFY) === y ? 'selected' : ''}>
      FY ${y}-${String(y + 1).slice(-2)}${y === thisFY ? ' (current, to date)' : ''}
    </option>
  `).join('');
}

// One call that feeds the header, Rental Summary, checklist and exports so
// they can never disagree with each other.
function getRentalFigures(fyStartYear) {
  const capitalizedTxIds = new Set(
    cachedCostbase.filter(r => r && r.transactionId && r.classification === 'Capital').map(r => r.transactionId)
  );
  return computeRentalFigures({
    transactions: cachedTransactions,
    loanTransactions: cachedLoanTransactions,
    loans: cachedLoans,
    properties: cachedProperties,
    directExpenses: cachedDirectExpenses,
    capitalizedTxIds,
    fyStartYear,
    bucketOf: t => getExpenseCategoryBucket(t.categoryId),
    isBucketDeductible: b => PROPERTY_EXPENSE_CATEGORIES[b]?.deductible !== false,
    toAudFn: toAud
  });
}

// Global modal creation functions
function createCGTModal() {
  return `
    <div class="modal" id="modalCGT">
      <div class="modal-content">
        <h2>📈 Capital Gains Tax Calculator</h2>
        <form id="formCGT">
          <div class="form-group">
            <label class="form-label">Purchase Price (AUD)</label>
            <input type="number" class="form-input" name="purchase" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Sale Price (AUD)</label>
            <input type="number" class="form-input" name="sell" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Capital Improvements (AUD)</label>
            <input type="number" class="form-input" name="improve" value="0">
          </div>
          
          <div class="form-group">
            <label class="form-label">Selling Costs (AUD)</label>
            <input type="number" class="form-input" name="costs" value="0">
          </div>
          
          <div class="form-group">
            <label class="form-label">Acquisition Date (contract date)</label>
            <input type="date" class="form-input" name="acquisitionDate" required>
          </div>

          <div class="form-group">
            <label class="form-label">Sale Date (contract date — the CGT event, not settlement)</label>
            <input type="date" class="form-input" name="eventDate" required>
          </div>

          <div class="form-group">
            <label class="form-label">Tax residency</label>
            <select class="form-input" name="residency">
              <option value="resident">Australian resident for tax purposes</option>
              <option value="nonresident">Foreign or temporary resident (discount generally not available)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Your Marginal Tax Rate (%)</label>
            <input type="number" class="form-input" name="taxRate" value="30" required>
          </div>
          
          <button type="submit" class="btn btn-primary">Calculate CGT</button>
        </form>
        
        <div id="cgtResult" class="calculator-result" style="display: none;"></div>
        
        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;" 
                onclick="document.getElementById('modalCGT').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createNegGearingModal() {
  return `
    <div class="modal" id="modalNeg">
      <div class="modal-content">
        <h2>📉 Negative Gearing Calculator</h2>
        <form id="formNeg">
          <div class="form-group">
            <label class="form-label">Net rental loss for the year (AUD)</label>
            <input type="number" class="form-input" name="loss" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Taxable income before the loss (AUD) — optional</label>
            <input type="number" class="form-input" name="taxableIncome" min="0" placeholder="e.g. 85000">
            <small class="form-hint">If filled in, tax is worked out on the actual tax brackets. Leave blank to use the flat rate below.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Financial year</label>
            <select class="form-input" name="fyStart" id="negFYSelect"></select>
          </div>

          <div class="form-group">
            <label class="form-label">Flat marginal rate (%) — used only when taxable income is blank</label>
            <input type="number" class="form-input" name="taxRate" value="30" min="0" max="60" step="0.5">
          </div>
          
          <button type="submit" class="btn btn-primary">Estimate Tax Effect</button>
        </form>
        
        <div id="negResult" class="calculator-result" style="display: none;"></div>
        
        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;" 
                onclick="document.getElementById('modalNeg').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createDepreciationModal() {
  return `
    <div class="modal" id="modalDepreciation">
      <div class="modal-content">
        <h2>🏠 Depreciation Calculator</h2>
        <form id="formDepreciation">
          <div class="form-group">
            <label class="form-label">Building Cost (AUD)</label>
            <input type="number" class="form-input" name="buildingCost" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Plant & Equipment Value (AUD)</label>
            <input type="number" class="form-input" name="plantValue" value="0">
          </div>
          
          <div class="form-group">
            <label class="form-label">Construction Date</label>
            <input type="date" class="form-input" name="constructionDate" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Date first available for rent</label>
            <input type="date" class="form-input" name="rentalDate" required>
            <small class="form-hint">Used to pro-rate the first year's deduction.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Plant & equipment purchased</label>
            <select class="form-input" name="plantCondition">
              <option value="new">Brand new (bought new by you, or you're an excluded entity)</option>
              <option value="secondhand">Second-hand / already installed when you bought an established residential property</option>
            </select>
          </div>
          
          <button type="submit" class="btn btn-primary">Calculate Depreciation</button>
        </form>
        
        <div id="depreciationResult" class="calculator-result" style="display: none;"></div>
        
        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;" 
                onclick="document.getElementById('modalDepreciation').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createGSTModal() {
  return `
    <div class="modal" id="modalGST">
      <div class="modal-content">
        <h2>💰 GST Calculator</h2>
        <form id="formGST">
          <div class="form-group">
            <label class="form-label">Amount (AUD)</label>
            <input type="number" class="form-input" name="amount" required>
          </div>
          
          <div class="form-group">
            <label class="form-label">Calculation Type</label>
            <select class="form-input" name="calculationType">
              <option value="add">Add GST to Amount</option>
              <option value="extract">Extract GST from Amount</option>
            </select>
          </div>
          
          <button type="submit" class="btn btn-primary">Calculate GST</button>
        </form>
        
        <div id="gstResult" class="calculator-result" style="display: none;"></div>
        
        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;" 
                onclick="document.getElementById('modalGST').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createMortgagePIModal() {
  return `
    <div class="modal" id="modalMortgagePI">
      <div class="modal-content">
        <h2>🏠 Mortgage Calculator (Principal &amp; Interest)</h2>
        <form id="formMortgagePI">
          <div class="form-group">
            <label class="form-label">Loan Amount (AUD)</label>
            <input type="number" class="form-input" name="loanAmount" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Interest Rate (% p.a.)</label>
            <input type="number" class="form-input" name="interestRate" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Loan Term (years)</label>
            <input type="number" class="form-input" name="termYears" min="1" step="1" value="30" required>
          </div>

          <div class="form-group">
            <label class="form-label">Payment Frequency</label>
            <select class="form-input" name="paymentFrequency">
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly" selected>Monthly</option>
            </select>
          </div>

          <button type="submit" class="btn btn-primary">Calculate Repayment</button>
        </form>

        <div id="mortgagePIResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalMortgagePI').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createMortgageIOModal() {
  return `
    <div class="modal" id="modalMortgageIO">
      <div class="modal-content">
        <h2>🏗️ Mortgage Calculator (Interest-Only)</h2>
        <form id="formMortgageIO">
          <div class="form-group">
            <label class="form-label">Loan Amount (AUD)</label>
            <input type="number" class="form-input" name="loanAmount" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Interest Rate (% p.a.)</label>
            <input type="number" class="form-input" name="interestRate" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Interest-Only Period (years)</label>
            <input type="number" class="form-input" name="ioYears" min="1" step="1" value="5" required>
          </div>

          <div class="form-group">
            <label class="form-label">Remaining Term After Interest-Only (years)</label>
            <input type="number" class="form-input" name="remainingYears" min="1" step="1" value="25" required>
            <small class="form-hint">Used to estimate the step-up P&amp;I repayment once the interest-only period ends.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Payment Frequency</label>
            <select class="form-input" name="paymentFrequency">
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly" selected>Monthly</option>
            </select>
          </div>

          <button type="submit" class="btn btn-primary">Calculate Repayment</button>
        </form>

        <div id="mortgageIOResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalMortgageIO').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

// Feature: four new "real data" calculators — Offset Savings, Rental Yield,
// Property Cash Flow, and Debt Payoff Order — added to the Calculators tab
// alongside the existing ones. Unlike the calculators above (which are pure
// manual-entry what-ifs), these pre-fill from real loans/accounts/properties/
// transactions already in the app via the selects below, wired up in
// populateOffsetModal/populateYieldModal/populateCashFlowModal/
// populateDebtPayoffModal. Values stay editable after prefill so they still
// work as what-if tools.
function createOffsetModal() {
  return `
    <div class="modal" id="modalOffset">
      <div class="modal-content">
        <h2>💰 Offset Savings Calculator</h2>
        <form id="formOffset">
          <div class="form-group">
            <label class="form-label">Loan</label>
            <select class="form-input" name="loanId" id="offsetLoanSelect"></select>
            <small class="form-hint">Selecting a loan pre-fills its balance, rate, and current offset balance (if linked) below — all still editable.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Loan Balance (AUD)</label>
            <input type="number" class="form-input" name="balance" id="offsetBalanceField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Interest Rate (% p.a.)</label>
            <input type="number" class="form-input" name="rate" id="offsetRateField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Offset Balance to Model (AUD)</label>
            <input type="number" class="form-input" name="offsetAmount" id="offsetAmountField" min="0" step="0.01" value="0" required>
          </div>

          <button type="submit" class="btn btn-primary">Calculate Savings</button>
        </form>

        <div id="offsetResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalOffset').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createRentalYieldModal() {
  return `
    <div class="modal" id="modalRentalYield">
      <div class="modal-content">
        <h2>📐 Rental Yield Calculator</h2>
        <form id="formRentalYield">
          <div class="form-group">
            <label class="form-label">Property</label>
            <select class="form-input" name="propertyId" id="yieldPropertySelect"></select>
            <small class="form-hint">Pre-fills purchase price, monthly rent, and last 12 months' actual holding costs for this property — all still editable.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Purchase Price (AUD)</label>
            <input type="number" class="form-input" name="purchasePrice" id="yieldPurchasePriceField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Monthly Rent (AUD)</label>
            <input type="number" class="form-input" name="monthlyRent" id="yieldMonthlyRentField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Annual Holding Costs (AUD)</label>
            <input type="number" class="form-input" name="annualCosts" id="yieldAnnualCostsField" min="0" step="0.01" value="0">
            <small class="form-hint">Rates, insurance, strata, management fees etc. — excludes mortgage repayments.</small>
          </div>

          <button type="submit" class="btn btn-primary">Calculate Yield</button>
        </form>

        <div id="rentalYieldResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalRentalYield').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createCashFlowModal() {
  return `
    <div class="modal" id="modalCashFlow">
      <div class="modal-content">
        <h2>💵 Property Cash Flow Calculator</h2>
        <form id="formCashFlow">
          <div class="form-group">
            <label class="form-label">Property</label>
            <select class="form-input" name="propertyId" id="cashFlowPropertySelect"></select>
            <small class="form-hint">Pre-fills monthly rent, the linked loan's actual repayment, and average monthly holding costs from the last 12 months of tagged transactions — all still editable.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Monthly Rent (AUD)</label>
            <input type="number" class="form-input" name="monthlyRent" id="cfMonthlyRentField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Monthly Mortgage Repayment (AUD)</label>
            <input type="number" class="form-input" name="mortgageRepayment" id="cfMortgageField" min="0" step="0.01" value="0">
          </div>

          <div class="form-group">
            <label class="form-label">Other Monthly Holding Costs (AUD)</label>
            <input type="number" class="form-input" name="otherCosts" id="cfOtherCostsField" min="0" step="0.01" value="0">
            <small class="form-hint">Rates, insurance, strata, management fees etc.</small>
          </div>

          <button type="submit" class="btn btn-primary">Calculate Cash Flow</button>
        </form>

        <div id="cashFlowResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalCashFlow').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createDebtPayoffModal() {
  return `
    <div class="modal" id="modalDebtPayoff">
      <div class="modal-content">
        <h2>🎯 Debt Payoff Order Calculator</h2>
        <form id="formDebtPayoff">
          <div class="form-group">
            <label class="form-label">Extra Monthly Payment Available (AUD)</label>
            <input type="number" class="form-input" name="extraPayment" id="debtExtraPaymentField" min="0" step="0.01" value="0">
            <small class="form-hint">On top of everything's minimum — this is what gets funnelled to your top-priority debt.</small>
          </div>

          <div id="debtPayoffList"></div>

          <button type="submit" class="btn btn-primary">Show Payoff Order</button>
        </form>

        <div id="debtPayoffResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalDebtPayoff').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createRefinanceModal() {
  return `
    <div class="modal" id="modalRefinance">
      <div class="modal-content">
        <h2>🔁 Refinance Break-Even Calculator</h2>
        <form id="formRefinance">
          <div class="form-group">
            <label class="form-label">Current Loan</label>
            <select class="form-input" name="loanId" id="refiLoanSelect"></select>
            <small class="form-hint">Pre-fills balance and current rate below — still editable.</small>
          </div>

          <div class="form-group">
            <label class="form-label">Current Loan Balance (AUD)</label>
            <input type="number" class="form-input" name="balance" id="refiBalanceField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Current Interest Rate (% p.a.)</label>
            <input type="number" class="form-input" name="currentRate" id="refiCurrentRateField" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Remaining Term (years)</label>
            <input type="number" class="form-input" name="remainingYears" id="refiTermField" min="1" step="1" value="25" required>
          </div>

          <div class="form-group">
            <label class="form-label">New Offer — Interest Rate (% p.a.)</label>
            <input type="number" class="form-input" name="newRate" min="0" step="0.01" required>
          </div>

          <div class="form-group">
            <label class="form-label">Exit / Discharge Fee (current lender, AUD)</label>
            <input type="number" class="form-input" name="exitFee" min="0" step="0.01" value="0">
          </div>

          <div class="form-group">
            <label class="form-label">New Loan Establishment / Application Fees (AUD)</label>
            <input type="number" class="form-input" name="newFees" min="0" step="0.01" value="0">
          </div>

          <div class="form-group">
            <label class="form-label">Cashback Offered (AUD)</label>
            <input type="number" class="form-input" name="cashback" min="0" step="0.01" value="0">
          </div>

          <button type="submit" class="btn btn-primary">Calculate Break-Even</button>
        </form>

        <div id="refinanceResult" class="calculator-result" style="display: none;"></div>

        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;"
                onclick="document.getElementById('modalRefinance').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

function createDeductionWizard() {
  return `
    <div class="modal" id="modalDeductionWizard">
      <div class="modal-content">
        <h2>💡 Deduction Maximization Wizard</h2>
        
        <div style="margin-bottom: 1.5rem;">
          <p>Let's optimize your tax deductions for rental properties:</p>
        </div>
        
        <form id="formDeductionWizard">
          <div class="form-group">
            <label class="form-label">Property Type</label>
            <select class="form-input" name="propertyType">
              <option value="house">House</option>
              <option value="apartment">Apartment</option>
              <option value="townhouse">Townhouse</option>
              <option value="commercial">Commercial</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Construction Year</label>
            <input type="number" class="form-input" name="constructionYear" min="1900" max="2024">
          </div>
          
          <div class="form-group">
            <label class="form-label">Recent Renovations (AUD)</label>
            <input type="number" class="form-input" name="renovations" value="0">
          </div>
          
          <div class="form-group">
            <label class="form-label">Furniture & Appliances (AUD)</label>
            <input type="number" class="form-input" name="furniture" value="0">
          </div>
          
          <button type="submit" class="btn btn-primary">Optimize Deductions</button>
        </form>
        
        <div id="deductionWizardResult" class="calculator-result" style="display: none;"></div>
        
        <button class="btn btn-outline" style="margin-top: 1rem; width: 100%;" 
                onclick="document.getElementById('modalDeductionWizard').classList.remove('active')">
          Close
        </button>
      </div>
    </div>
  `;
}

export async function initTaxComplianceUI() {

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="tax-container pfd-page">
      <!-- Header: title + a single row of key metrics, not 3 separate cards -->
      <div class="tax-header">
        <h1>📘 ATO Compliance & Tax Hub</h1>
        <p>Tax calculators, deduction tracking, and compliance tools for Australian property investors</p>
        <p class="tax-disclaimer">
          General information only, not tax advice. Figures are estimates from the records in this app,
          not ATO-ready totals. Confirm your specific situation with a registered tax agent.
        </p>
        <div class="tax-metrics">
          <div class="tax-metric">
            <div class="tax-metric-value" id="totalDeductions">$0</div>
            <div class="tax-metric-label" id="deductionsLabel">Recorded Rental Deductions</div>
          </div>
          <div class="tax-metric">
            <div class="tax-metric-value" id="taxSavings">$0</div>
            <div class="tax-metric-label" id="taxEffectLabel">Indicative Tax Effect</div>
          </div>
          <div class="tax-metric">
            <div class="tax-metric-value" id="complianceScore">–</div>
            <div class="tax-metric-label">Record Checks (not an ATO score)</div>
          </div>
        </div>
        <p class="tax-fine-print" id="taxMetricsNote"></p>
        <label class="tax-fine-print" style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          Assumed marginal tax rate for the indicative figure:
          <input type="number" id="assumedRateInput" class="form-input" min="0" max="60" step="0.5" style="width:5.5rem;">
          <span>%</span>
        </label>
      </div>

      <!-- Single tab strip replaces the old separate "dashboard overview
           grid" + "tabbed interface" (which duplicated the same layout
           twice). Overview leads with the deadline tracker since that's
           the most time-sensitive thing here. -->
      <div class="tax-tabs" role="tablist">
        <button type="button" class="tax-tab active" onclick="switchTab('overview', this)">🏠 Overview</button>
        <button type="button" class="tax-tab" onclick="switchTab('records', this)">📋 Records</button>
        <button type="button" class="tax-tab" onclick="switchTab('calculators', this)">🧮 Calculators</button>
        <button type="button" class="tax-tab" onclick="switchTab('reports', this)">📊 Reports</button>
        <button type="button" class="tax-tab" onclick="switchTab('compliance', this)">🛡️ Compliance</button>
      </div>

      <!-- Overview -->
      <div class="tax-tab-panel active" id="overview-tab">
        <div class="card highlight">
          <h3>📅 Tax Deadline Tracker</h3>
          <div id="taxDeadlines"></div>
        </div>

        <div class="tax-stack" style="margin-top: 1.25rem;">
          <div class="card">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap;">
              <h3 style="margin:0;">💰 Rental Summary</h3>
              <select id="rentalSummaryFY" class="form-select" style="width:auto;"></select>
            </div>
            <div id="rentalSummary"></div>
          </div>

          <div class="card">
            <h3>🧾 Deduction Optimizer</h3>
            <div id="deductionTips"></div>
            <button class="btn btn-outline" style="margin-top: 1rem;" onclick="showDeductionWizard()">
              💡 Maximize Deductions
            </button>
          </div>
        </div>
      </div>

      <!-- Records -->
      <div class="tax-tab-panel" id="records-tab">
        <div class="tax-stack">
          <div class="card">
            <h3>💰 Income & Expenses</h3>
            <div id="incomeExpenseRecords"></div>
          </div>

          <div class="card">
            <h3>🏦 Loan Interest</h3>
            <div id="loanRecords"></div>
          </div>
        </div>

        <div class="card" style="margin-top: 1.25rem;">
          <h3>🧰 Capital Works</h3>
          <div id="maintenanceRecords"></div>
        </div>
      </div>

      <!-- Calculators -->
      <div class="tax-tab-panel" id="calculators-tab">
        <div class="tax-stack">
          <div class="card">
            <h3>📈 Capital Gains Tax</h3>
            <p class="text-muted">Estimate CGT liability on property sales</p>
            <button class="btn btn-primary" onclick="showCGTModal()">Calculate CGT</button>
          </div>

          <div class="card">
            <h3>📉 Negative Gearing</h3>
            <p class="text-muted">Calculate tax benefits from rental losses</p>
            <button class="btn btn-primary" onclick="showNegGearingModal()">Calculate Benefits</button>
          </div>

          <div class="card">
            <h3>🏠 Depreciation Schedule</h3>
            <p class="text-muted">Estimate property depreciation deductions</p>
            <button class="btn btn-primary" onclick="showDepreciationModal()">Calculate Depreciation</button>
          </div>

          <div class="card">
            <h3>💰 GST Calculator</h3>
            <p class="text-muted">Calculate GST on property transactions</p>
            <button class="btn btn-primary" onclick="showGSTModal()">Calculate GST</button>
          </div>

          <div class="card">
            <h3>🏠 Mortgage Calculator (P&amp;I)</h3>
            <p class="text-muted">Estimate principal &amp; interest repayments on a loan</p>
            <button class="btn btn-primary" onclick="showMortgagePIModal()">Calculate Repayment</button>
          </div>

          <div class="card">
            <h3>🏗️ Mortgage Calculator (Interest-Only)</h3>
            <p class="text-muted">Estimate interest-only repayments, plus the step-up once P&amp;I begins</p>
            <button class="btn btn-primary" onclick="showMortgageIOModal()">Calculate Repayment</button>
          </div>

          <div class="card">
            <h3>💰 Offset Savings</h3>
            <p class="text-muted">Model how much interest you'd save keeping a balance in offset</p>
            <button class="btn btn-primary" onclick="showOffsetModal()">Calculate Savings</button>
          </div>

          <div class="card">
            <h3>📐 Rental Yield</h3>
            <p class="text-muted">Gross and net yield from purchase price, rent, and holding costs</p>
            <button class="btn btn-primary" onclick="showRentalYieldModal()">Calculate Yield</button>
          </div>

          <div class="card">
            <h3>💵 Property Cash Flow</h3>
            <p class="text-muted">See if a property is cash-flow positive or negative after all holding costs</p>
            <button class="btn btn-primary" onclick="showCashFlowModal()">Calculate Cash Flow</button>
          </div>

          <div class="card">
            <h3>🎯 Debt Payoff Order</h3>
            <p class="text-muted">Avalanche vs snowball order for your real loans and credit cards</p>
            <button class="btn btn-primary" onclick="showDebtPayoffModal()">Show Payoff Order</button>
          </div>

          <div class="card">
            <h3>🔁 Refinance Break-Even</h3>
            <p class="text-muted">See how many months until a refinance offer pays for itself</p>
            <button class="btn btn-primary" onclick="showRefinanceModal()">Calculate Break-Even</button>
          </div>
        </div>
      </div>

      <!-- Reports -->
      <div class="tax-tab-panel" id="reports-tab">
        <div class="card">
          <h3>📤 ATO Report Generator</h3>
          <p class="text-muted">Working papers built from the rent, expenses and loan interest recorded in this app (actual figures, not estimates). Not an ATO lodgment format.</p>
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap; margin:0.75rem 0;">
            <label for="reportFY" style="font-weight:600;">Financial year</label>
            <select id="reportFY" class="form-select" style="width:auto;"></select>
          </div>

          <div class="tax-report-actions">
            <button class="btn btn-outline" onclick="generateRentalSchedule()">
              📄 Rental Schedule
            </button>
            <button class="btn btn-outline" onclick="generateDeductionReport()">
              💰 Deduction Report
            </button>
            <button class="btn btn-outline" onclick="generateCGTReport()">
              📈 CGT Report
            </button>
            <button class="btn btn-success" onclick="exportAllReports()">
              📦 Export All Reports
            </button>
          </div>

          <div id="reportOutput"></div>
        </div>
      </div>

      <!-- Compliance: risk assessment pulled out full-width below since
           it's the one that most needs attention, not squeezed into the
           same-size grid as the other two. -->
      <div class="tax-tab-panel" id="compliance-tab">
        <div class="tax-stack">
          <div class="card">
            <h3>🛡️ Record Checklist</h3>
            <div id="complianceChecklist"></div>
          </div>

          <div class="card">
            <h3>📚 Record Keeping Requirements</h3>
            <div id="recordKeeping"></div>
          </div>
        </div>

        <div class="card warning" style="margin-top: 1.25rem;">
          <h3>⚠️ Risk Assessment</h3>
          <div id="riskAssessment"></div>
        </div>
      </div>
    </div>

    <!-- Modal Components -->
    ${createCGTModal()}
    ${createNegGearingModal()}
    ${createDepreciationModal()}
    ${createGSTModal()}
    ${createMortgagePIModal()}
    ${createMortgageIOModal()}
    ${createOffsetModal()}
    ${createRentalYieldModal()}
    ${createCashFlowModal()}
    ${createDebtPayoffModal()}
    ${createRefinanceModal()}
    ${createDeductionWizard()}
  `;

  // Load data and initialize
  const [rawTransactions, loans, maintenance, properties, tenants, costbase, accounts, loanTransactions, directExpenses] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.loans),
    getAllItems(STORE_NAMES.maintenance),
    getAllItems(STORE_NAMES.properties),
    getAllItems(STORE_NAMES.tenants),
    getAllItems(STORE_NAMES.costbase).catch(() => []),
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.loanTransactions).catch(() => []),
    getAllItems(STORE_NAMES.expenses).catch(() => [])
  ]);
  // ATO figures are AUD: swap in each transaction's AUD value (explicit or converted).
  const transactions = toAudTransactions(rawTransactions, accounts);

  // Cached for the four "real data" calculators (Offset/Yield/Cash Flow/Debt
  // Payoff) — their show*Modal functions run later, on button click, so they
  // read from these module-level vars rather than re-fetching from IndexedDB.
  cachedLoans = loans;
  cachedAccounts = accounts;
  cachedProperties = properties;
  cachedTransactions = transactions;
  cachedRawTransactions = rawTransactions;
  cachedLoanTransactions = loanTransactions;
  cachedCostbase = costbase;
  cachedDirectExpenses = directExpenses;
  cachedMaintenance = maintenance;

  initializeTaxDashboard(transactions, loans, maintenance, properties, tenants, costbase);
  setupEventListeners();
}

// ============================================================================
// 🎯 INITIALIZE DASHBOARD
// ============================================================================

function initializeTaxDashboard(transactions, loans, maintenance, properties, tenants, costbase) {
  renderTaxDeadlines();
  renderRentalSummary(transactions, properties, tenants, costbase);
  renderDeductionTips(transactions, maintenance);
  renderFinancialRecords(transactions, loans, maintenance);
  renderComplianceChecklist();
  renderRecordKeeping();
  renderRiskAssessment(transactions, properties);
  calculateTaxMetrics();

  const rateInput = document.getElementById('assumedRateInput');
  if (rateInput) {
    rateInput.value = getAssumedRatePercent();
    rateInput.onchange = () => {
      const v = parseFloat(rateInput.value);
      if (Number.isFinite(v) && v >= 0 && v <= 60) saveSetting('dfm_tax_assumedRate', v);
      rateInput.value = getAssumedRatePercent();
      calculateTaxMetrics();
    };
  }
  const reportFY = document.getElementById('reportFY');
  if (reportFY) {
    reportFY.innerHTML = renderRentalFYOptions(transactions, getMostRecentCompletedFYRange().start.getFullYear());
  }
}

// ============================================================================
// 📅 TAX DEADLINES & COMPLIANCE
// ============================================================================

function renderTaxDeadlines() {
  const gstRegistered = loadSetting('dfm_tax_gstRegistered', '0') === '1';
  const deadlines = getTaxDeadlines(new Date(), { gstRegistered }).slice(0, 5);

  const cards = deadlines.map(d => {
    let statusClass = '';
    let statusText;
    if (d.daysUntil < 0) {
      statusClass = 'urgent';
      statusText = '<span class="compliance-status status-overdue">DATE PASSED</span>';
    } else if (d.daysUntil === 0) {
      statusClass = 'upcoming';
      statusText = '<span class="compliance-status status-pending">DUE TODAY</span>';
    } else if (d.daysUntil <= 30) {
      statusClass = 'upcoming';
      statusText = `<span class="compliance-status status-pending">DUE IN ${d.daysUntil} DAYS</span>`;
    } else {
      statusText = '<span class="compliance-status status-compliant">UPCOMING</span>';
    }
    return `
      <div class="tax-date-card ${statusClass}">
        <div style="display: flex; justify-content: space-between; align-items: start; gap: 0.75rem;">
          <div>
            <strong>${escapeHtml(d.name)}</strong>
            <div class="text-muted" style="font-size: 0.875rem;">
              Due: ${d.date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(d.note)}</div>
          </div>
          ${statusText}
        </div>
      </div>`;
  }).join('');

  document.getElementById('taxDeadlines').innerHTML = `
    ${cards || '<p class="text-muted">No upcoming dates.</p>'}
    <div class="tax-date-card">
      <strong>Land tax</strong>
      <div class="text-muted" style="font-size: 0.75rem;">
        Due dates, thresholds and assessments are set by your state or territory revenue office — check your assessment notice.
      </div>
    </div>
    <label class="tax-fine-print" style="display:flex; align-items:center; gap:0.5rem; margin-top:0.75rem;">
      <input type="checkbox" id="gstRegisteredToggle" ${gstRegistered ? 'checked' : ''}>
      I'm registered for GST (show quarterly BAS dates)
    </label>
    <p class="tax-fine-print">
      Dates move to the next business day when they fall on a weekend (public holidays aren't modelled).
      Your own due dates can differ — e.g. lodging through a registered tax or BAS agent, or ATO-granted extensions.
      Most residential landlords aren't GST-registered and don't lodge a BAS.
    </p>`;

  const toggle = document.getElementById('gstRegisteredToggle');
  if (toggle) toggle.onchange = () => { saveSetting('dfm_tax_gstRegistered', toggle.checked ? '1' : '0'); renderTaxDeadlines(); };
}

// ============================================================================
// 💰 RENTAL INCOME & DEDUCTIONS
// ============================================================================

function renderRentalSummary(transactions, properties, tenants, costbase = []) {
  rentalSummaryData = { transactions, properties, tenants, costbase };

  const thisFYStartYear = currentFYStartYear();
  const fyStartYear = selectedRentalFY ?? thisFYStartYear;
  const isCurrentFY = fyStartYear === thisFYStartYear;
  const figures = getRentalFigures(fyStartYear);
  const t = figures.totals;

  const fySelect = document.getElementById('rentalSummaryFY');
  if (fySelect) {
    fySelect.innerHTML = renderRentalFYOptions(transactions);
    fySelect.onchange = (e) => {
      const y = parseInt(e.target.value, 10);
      selectedRentalFY = isNaN(y) ? null : y;
      renderRentalSummary(transactions, properties, tenants, costbase);
      renderComplianceChecklist();
      calculateTaxMetrics();
    };
  }

  const hasRentals = figures.rows.length > 0;
  document.getElementById('rentalSummary').innerHTML = `
    <div class="stat-row">
      <div class="stat">
        <div class="stat-value">${fmt(t.rentReceived)}</div>
        <div class="stat-label">Rent Received</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmt(t.deductibleExpenses)}</div>
        <div class="stat-label">Deductible Expenses</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmt(t.loanInterest)}</div>
        <div class="stat-label">Loan Interest</div>
      </div>
      <div class="stat">
        <div class="stat-value ${t.net >= 0 ? 'text-success' : 'text-danger'}">${fmt(t.net)}</div>
        <div class="stat-label">Net Rental Result</div>
      </div>
    </div>
    <div class="text-muted" style="margin-top: 1rem; font-size: 0.875rem;">
      ${figures.label}${isCurrentFY ? ' to date' : ''} (Jul 1 - Jun 30). Recorded figures only
      ${hasRentals ? '' : ' — no rental/investment properties found.'}
    </div>
    <details style="margin-top: 0.75rem;">
      <summary class="tax-fine-print" style="cursor:pointer;">What's included, and what isn't (${figures.warnings.length})</summary>
      <ul class="tax-list">${figures.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
    </details>
  `;
}

function renderDeductionTips(transactions, maintenance) {
  const tips = [
    "📝 Keep all receipts for 5 years",
    "🏠 Capital works (2.5%/yr) are claimed as depreciation, not an immediate deduction",
    "🔧 Genuine repairs to wear-and-tear during your ownership are deductible — repairs that existed when you bought the property must be capitalised instead",
    "🚫 Travel to inspect, maintain, or collect rent from a residential rental property is NOT deductible for individuals (since 1 July 2017) — narrow exceptions only for a formal property business or commercial property",
    "📦 Plant & equipment depreciation (carpets, appliances etc.) is only claimable on second-hand residential properties if you're an excluded entity — otherwise only applies to items you bought new",
    "💳 Borrowing costs over $100 (loan fees, LMI) are spread over 5 years, not deducted upfront — this is separate from loan interest, which is fully deductible each year",
    "💼 Professional fees (accountants, quantity surveyors, property lawyers) are deductible"
  ];
  
  document.getElementById('deductionTips').innerHTML = `
    <ul class="tax-list">
      ${tips.map(tip => `<li>${tip}</li>`).join('')}
    </ul>
    <p class="tax-fine-print">
      General information only, not tax advice — confirm your specific situation with a registered tax agent.
    </p>
  `;
}

function renderFinancialRecords(transactions, loans, maintenance) {
  const incomeDiv = document.getElementById('incomeExpenseRecords');
  const loanDiv = document.getElementById('loanRecords');
  const maintDiv = document.getElementById('maintenanceRecords');

  const incomeTx = transactions.filter(t => t.type === 'income' && !t.isTransfer).slice(-5);
  const expenseTx = transactions.filter(t => t.type === 'expense' && !t.isTransfer).slice(-5);

  incomeDiv.innerHTML = `
    <h4 style="margin-bottom: 0.75rem;">Recent Income</h4>
    ${incomeTx.length > 0 ? incomeTx.map(t => `
      <div class="record-item">
        <span>${t.description || 'Income'}</span>
        <span class="text-success" style="font-weight: 600;">${fmt(t.amount)}</span>
      </div>
    `).join('') : '<p class="text-muted" style="font-style: italic;">No recent income</p>'}

    <h4 style="margin: 1.5rem 0 0.75rem 0;">Recent Expenses</h4>
    ${expenseTx.length > 0 ? expenseTx.map(t => `
      <div class="record-item">
        <span>${t.description || 'Expense'}</span>
        <span class="text-danger" style="font-weight: 600;">${fmt(t.amount)}</span>
      </div>
    `).join('') : '<p class="text-muted" style="font-style: italic;">No recent expenses</p>'}
  `;

  loanDiv.innerHTML = loans.length > 0 ? `
    ${loans.slice(-5).map(loan => `
      <div class="record-item">
        <span>${loan.name || 'Loan'}</span>
        <span style="font-weight: 600;">${fmt(loan.currentBalance)}</span>
      </div>
    `).join('')}
  ` : '<p class="text-muted" style="font-style: italic;">No loan data</p>';

  maintDiv.innerHTML = maintenance.length > 0 ? `
    ${maintenance.slice(-5).map(maint => `
      <div class="record-item">
        <span>${maint.title || 'Maintenance'}</span>
        <span class="text-warning" style="font-weight: 600;">${fmt(maint.cost)}</span>
      </div>
    `).join('')}
  ` : '<p class="text-muted" style="font-style: italic;">No maintenance data</p>';
}

// Record checks: do the records an ATO rental schedule is built from exist in
// this app for the selected FY? This is NOT a measure of ATO compliance - it
// can't see paper/PDF receipts, leases, logbooks, etc.
function getRecordChecks() {
  const fy = selectedRentalFY ?? currentFYStartYear();
  const figures = getRentalFigures(fy);
  const { start, end } = getFYRange(fy);
  const rentalProps = cachedProperties.filter(p => p.propertyType !== 'primary');
  const rentalIds = new Set(rentalProps.map(p => p.id));
  const inFY = d => { const x = parseLocalDate(d); return x && x >= start && x <= end; };
  const checks = [];

  if (rentalProps.length === 0) {
    checks.push({ task: 'Rental property added', ok: false, detail: 'No investment/rental property found', requirement: 'Add one under Properties to enable the rental checks' });
  } else {
    const withRent = figures.rows.filter(r => r.rentPayments > 0).length;
    checks.push({ task: 'Rent recorded for each rental property', ok: withRent === rentalProps.length,
      detail: `${withRent} of ${rentalProps.length} properties have rent recorded in ${figures.label}`,
      requirement: 'Keep rent records for 5 years from lodgment' });
    checks.push({ task: 'No unlinked rent payments', ok: figures.unallocatedRent.count === 0,
      detail: figures.unallocatedRent.count ? `${figures.unallocatedRent.count} rent payment(s) not linked to a property` : 'All rent payments are linked',
      requirement: 'Unlinked rent is left out of the schedule' });
    const withExpenses = figures.rows.filter(r => r.deductibleExpenses > 0 || r.loanInterest > 0).length;
    checks.push({ task: 'Expenses recorded against each rental property', ok: withExpenses === rentalProps.length,
      detail: `${withExpenses} of ${rentalProps.length} properties have deductible expenses or interest in ${figures.label}`,
      requirement: 'Keep invoices/receipts for 5 years from lodgment' });
    const rentalLoans = cachedLoans.filter(l => l.propertyId && rentalIds.has(l.propertyId));
    const unlinkedLoans = cachedLoans.filter(l => !l.propertyId && /mortgage|investment|property/i.test(`${l.type || ''} ${l.name || ''}`));
    checks.push({ task: 'Rental loans linked to their property', ok: unlinkedLoans.length === 0 && rentalLoans.length > 0,
      detail: rentalLoans.length ? (unlinkedLoans.length ? `${unlinkedLoans.length} property-type loan(s) have no property linked` : `${rentalLoans.length} loan(s) linked`) : 'No loan is linked to a rental property',
      requirement: 'Needed so loan interest reaches the schedule' });
  }

  const periodExpenses = cachedDirectExpenses.filter(e => rentalIds.has(e.propertyId) && inFY(e.date));
  if (periodExpenses.length) {
    const withReceipt = periodExpenses.filter(e => e.receiptUrl).length;
    checks.push({ task: 'Receipt attached to recorded property expenses', ok: withReceipt === periodExpenses.length,
      detail: `${withReceipt} of ${periodExpenses.length} expense records in ${figures.label} have a receipt link`,
      requirement: 'You must be able to substantiate each claim' });
  }
  return checks;
}

function renderComplianceChecklist() {
  const checks = getRecordChecks();
  const passed = checks.filter(c => c.ok).length;
  const scoreEl = document.getElementById('complianceScore');
  if (scoreEl) scoreEl.textContent = `${passed} of ${checks.length}`;

  const html = checks.map(item => `
    <div class="record-item">
      <div>
        <strong>${escapeHtml(item.task)}</strong>
        <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(item.detail)}</div>
        <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(item.requirement)}</div>
      </div>
      <span class="compliance-status ${item.ok ? 'status-compliant' : 'status-pending'}">
        ${item.ok ? '✓ FOUND' : '⏳ CHECK'}
      </span>
    </div>
  `).join('') + `
    <p class="tax-fine-print">
      These checks only look at what's recorded in this app. They can't confirm your receipts, lease,
      bank statements or logbooks meet ATO record-keeping rules, so passing them doesn't mean you're compliant.
      Most residential landlords don't need to lodge a BAS — GST/BAS applies mainly to commercial property
      or a GST-registered enterprise.
    </p>
  `;

  document.getElementById('complianceChecklist').innerHTML = html;
}

function renderRecordKeeping() {
  const items = [
    { label: "Income & expense records (rent, bills, invoices, receipts)", period: "5 years from the date you lodge your return" },
    { label: "Loan and interest records", period: "5 years after the loan is fully repaid" },
    { label: "Capital works & improvement records", period: "As long as you own the property, plus 5 years after you sell it (needed for your CGT cost base)" },
    { label: "Depreciation schedules (quantity surveyor reports)", period: "As long as you own the property, plus 5 years after you sell it" },
  ];

  document.getElementById('recordKeeping').innerHTML = `
    <ul class="tax-list">
      ${items.map(i => `
        <li>
          <strong>${i.label}</strong>
          <div class="text-muted" style="font-size: 0.75rem;">${i.period}</div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderRiskAssessment(transactions, properties) {
  const TRAVEL_CATEGORY_IDS = ['cat_travel', 'sub_flights', 'sub_accommodation', 'sub_car_rental', 'sub_travel_food', 'sub_tours'];
  const propertyIds = new Set(properties.filter(p => p.propertyType !== 'primary').map(p => p.id));

  const travelClaims = transactions.filter(t =>
    t.type === 'expense' &&
    t.propertyId && propertyIds.has(t.propertyId) &&
    TRAVEL_CATEGORY_IDS.includes(t.categoryId)
  );

  const risks = [];

  if (travelClaims.length > 0) {
    risks.push({
      level: 'overdue',
      text: `${travelClaims.length} travel-related expense${travelClaims.length > 1 ? 's are' : ' is'} linked to a rental property. Travel to inspect/maintain a residential rental property hasn't been deductible for individuals since 1 July 2017 — this is a known ATO audit trigger.`
    });
  }

  risks.push({
    level: 'pending',
    text: `From 1 July 2027 (subject to legislation passing), negative gearing losses on established residential properties are proposed to be limited to offsetting rental/capital gains income only, rather than all income. New builds are expected to be unaffected. Worth watching if you're relying on full offset against salary income.`
  });

  risks.push({
    level: 'pending',
    text: `If any property has private/holiday use, the ATO's TR 2025/D1 and TR 2026/1 guidance takes a stricter view on apportioning or denying deductions (interest, rates, land tax) for periods of private use — keep a log of private-use dates.`
  });

  document.getElementById('riskAssessment').innerHTML = `
    <div style="display: grid; gap: 0.75rem;">
      ${risks.map(r => `
        <div class="record-item" style="align-items: flex-start;">
          <span class="compliance-status status-${r.level}" style="flex-shrink: 0;">
            ${r.level === 'overdue' ? '⚠️ FLAGGED' : 'ℹ️ WATCH'}
          </span>
          <span style="font-size: 0.875rem; margin-left: 0.75rem;">${r.text}</span>
        </div>
      `).join('')}
    </div>
    <p class="tax-fine-print">
      General information only, not tax advice — confirm your specific situation with a registered tax agent.
    </p>
  `;
}

// ============================================================================
// 📈 TAX METRICS & SAVINGS
// ============================================================================

function calculateTaxMetrics() {
  const fy = selectedRentalFY ?? currentFYStartYear();
  const isCurrent = fy === currentFYStartYear();
  const f = getRentalFigures(fy);
  const rate = getAssumedRatePercent();
  const net = f.totals.net;
  const effect = Math.abs(net) * rate / 100;

  document.getElementById('totalDeductions').textContent = fmt(f.totals.totalDeductions);
  document.getElementById('deductionsLabel').textContent = `Recorded Rental Deductions · ${f.label}`;
  document.getElementById('taxSavings').textContent =
    net < 0 ? `${fmt(effect)} less tax` : net > 0 ? `${fmt(effect)} more tax` : fmt(0);
  document.getElementById('taxEffectLabel').textContent = `Indicative Tax Effect @ ${rate}%`;
  document.getElementById('taxMetricsNote').textContent =
    `${f.label}${isCurrent ? ' to date' : ''}: deductible expenses and loan interest recorded on rental properties, ` +
    `against rent received. The tax effect applies your assumed rate to the net rental result — it ignores your ` +
    `other income, offsets, the Medicare levy and private-use apportionment. Change the year on the Rental Summary card.`;
}

// ============================================================================
// 🧮 CALCULATOR FUNCTIONS
// ============================================================================

function calculateCGT(formData) {
  const purchase = parseFloat(formData.get('purchase')) || 0;
  const sell = parseFloat(formData.get('sell')) || 0;
  const improve = parseFloat(formData.get('improve')) || 0;
  const costs = parseFloat(formData.get('costs')) || 0;
  const taxRatePercent = parseFloat(formData.get('taxRate')) || 0;
  const acquisitionDate = formData.get('acquisitionDate');
  const eventDate = formData.get('eventDate');
  const isResident = formData.get('residency') !== 'nonresident';

  const acq = parseLocalDate(acquisitionDate);
  const evt = parseLocalDate(eventDate);
  if (!acq || !evt) {
    return `<div class="tax-callout danger"><p>Enter both the acquisition and sale contract dates.</p></div>`;
  }
  if (evt < acq) {
    return `<div class="tax-callout danger"><p>The sale date is before the acquisition date — check the dates.</p></div>`;
  }

  const { capitalGain, discount, taxableGain, taxPayable, held12 } =
    calculateCGTValues({ purchase, sell, improve, costs, taxRatePercent, acquisitionDate, eventDate, isResident });

  return `
    <h4>Capital Gains Tax Estimate</h4>
    <div class="calc-row">
      <span>${capitalGain >= 0 ? 'Capital Gain' : 'Capital Loss'}:</span>
      <strong>${fmt(capitalGain)}</strong>
    </div>
    <div class="calc-row">
      <span>CGT Discount (${discount * 100}%):</span>
      <strong>-${fmt(capitalGain * discount)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>${capitalGain >= 0 ? 'Net Capital Gain' : 'Net Capital Loss'}:</span>
      <strong>${fmt(taxableGain)}</strong>
    </div>
    <div class="calc-row">
      <span>Estimated Tax at ${taxRatePercent}%:</span>
      <strong class="text-danger">${fmt(taxPayable)}</strong>
    </div>

    ${capitalGain < 0 ? `
      <div class="tax-callout info">
        <p>A capital loss can't be deducted from other income. It's carried forward to offset future capital gains.</p>
      </div>
    ` : ''}

    ${!isResident ? `
      <div class="tax-callout warning">
        <strong>⚠️ Foreign / temporary resident</strong>
        <p>The CGT discount generally isn't available for gains made after 8 May 2012. A partial discount may apply if you were an Australian resident for part of the time you owned it — ask a tax agent.</p>
      </div>
    ` : !held12 ? `
      <div class="tax-callout warning">
        <strong>⚠️ Owned for less than 12 months</strong>
        <p>The 50% discount needs 12 months of ownership before the sale contract date, not counting the acquisition day or the sale day. Property dates are normally contract dates, not settlement.</p>
      </div>
    ` : ''}

    <div class="tax-callout info">
      <p>
        Estimate only. It adds the gain at one flat rate; in reality the net gain is added to your other
        taxable income for the year, after any capital losses. It doesn't consider the main residence
        exemption, indexation for assets held since before 21 September 1999, the affordable-housing
        discount, or Medicare levy.
      </p>
    </div>
  `;
}

function calculateNegativeGearing(formData) {
  const loss = parseFloat(formData.get('loss')) || 0;
  const flatRate = parseFloat(formData.get('taxRate'));
  const incomeRaw = formData.get('taxableIncome');
  const fyStart = parseInt(formData.get('fyStart'), 10) || currentFYStartYear();
  if (loss <= 0) {
    return `<div class="tax-callout danger"><p>Enter the net rental loss as a positive amount.</p></div>`;
  }
  const r = calculateNegativeGearingEffect({
    loss,
    taxableIncomeBefore: incomeRaw === '' || incomeRaw === null ? null : parseFloat(incomeRaw),
    flatRatePercent: flatRate,
    fyStartYear: fyStart
  });
  const fyLabel = getFYRange(fyStart).label;

  return `
    <h4>Estimated Tax Effect of a Rental Loss</h4>
    <div class="calc-row">
      <span>Rental Loss:</span>
      <strong class="text-danger">${fmt(r.loss)}</strong>
    </div>
    <div class="calc-row">
      <span>Estimated reduction in tax payable:</span>
      <strong class="text-success">${fmt(r.reduction)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Net cost after the tax effect:</span>
      <strong>${fmt(r.netCost)}</strong>
    </div>
    <div class="calc-row">
      <span>Effective tax benefit:</span>
      <strong>${(r.effectiveRate * 100).toFixed(1)}%</strong>
    </div>

    <div class="tax-callout info">
      <p>
        ${r.method === 'brackets'
          ? `Worked out on the ${fyLabel} resident tax brackets using the taxable income you entered.`
          : `Flat-rate estimate (loss × ${flatRate || 0}%). Enter your taxable income for a bracket-based figure.`}
        This is a reduction in your tax bill, not a separate refund. It excludes the Medicare levy,
        tax offsets, and any PAYG withholding timing.
        ${isRateTableKnown(fyStart) ? '' : ` No rate table is loaded for ${fyLabel}; the closest year's rates were used.`}
      </p>
    </div>
    ${r.unusedLoss > 0 ? `
      <div class="tax-callout warning">
        <p>${fmt(r.unusedLoss)} of the loss is more than your taxable income, so it would create or increase a tax loss carried forward rather than reducing tax this year.</p>
      </div>
    ` : ''}

    <div class="tax-callout warning">
      <strong>ℹ️ Proposed change from 1 July 2027</strong>
      <p>
        Under the 2026 Federal Budget announcement (subject to legislation passing),
        losses on established residential properties would only offset rental/capital
        gains income rather than all income (e.g. salary). New builds are expected to
        be unaffected. This calculator assumes the current, unrestricted rules.
      </p>
    </div>
  `;
}

function calculateDepreciation(formData) {
  const buildingCost = parseFloat(formData.get('buildingCost')) || 0;
  const plantValue = parseFloat(formData.get('plantValue')) || 0;
  const constructionDate = new Date(formData.get('constructionDate'));
  const rentalDate = new Date(formData.get('rentalDate'));
  const plantCondition = formData.get('plantCondition');

  // Division 43 capital works: 2.5% per year of construction cost, but only
  // for buildings where construction started after 15 September 1987.
  const CAPITAL_WORKS_CUTOFF = new Date('1987-09-15');
  const capitalWorksEligible = constructionDate >= CAPITAL_WORKS_CUTOFF;
  const capitalWorksAnnual = capitalWorksEligible ? buildingCost * 0.025 : 0;

  // Division 40 plant & equipment: since 9 May 2017, individuals can only
  // depreciate plant & equipment they bought new themselves - not items that
  // were already installed when they bought an established residential
  // property second-hand.
  const plantEligible = plantCondition === 'new';
  // Rough indicative figure only - actual claims need a professional
  // depreciation schedule with per-asset effective lives (ATO TR 2024/1),
  // since each item (carpet, blinds, appliances etc.) depreciates at a
  // different rate.
  const ASSUMED_AVG_RATE = 0.20;
  const plantAnnualEstimate = plantEligible ? plantValue * ASSUMED_AVG_RATE : 0;

  const totalAnnual = capitalWorksAnnual + plantAnnualEstimate;

  // First year: claimable from the date the property is first available for rent.
  const firstYear = calculateFirstYearDepreciation({
    annualAmount: totalAnnual,
    constructionDate: formData.get('constructionDate'),
    rentalDate: formData.get('rentalDate')
  });

  return `
    <h4>Depreciation Estimate</h4>
    <div class="calc-row">
      <span>Capital Works (Div 43, 2.5%/yr):</span>
      <strong>${fmt(capitalWorksAnnual)} / yr</strong>
    </div>
    <div class="calc-row">
      <span>Plant & Equipment (Div 40, indicative):</span>
      <strong>${fmt(plantAnnualEstimate)} / yr</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Estimated full-year total:</span>
      <strong>${fmt(totalAnnual)} / yr</strong>
    </div>
    ${firstYear ? `
      <div class="calc-row">
        <span>First-year amount (FY ${firstYear.firstFY}-${String(firstYear.firstFY + 1).slice(-2)}, ${firstYear.daysClaimable} of ${firstYear.daysInFY} days from the rental date):</span>
        <strong>${fmt(firstYear.amount)}</strong>
      </div>
    ` : ''}
    ${firstYear?.rentalBeforeConstruction ? `
      <div class="tax-callout danger">
        <p>The first-rental date is before the construction date — check both dates.</p>
      </div>
    ` : ''}

    ${!capitalWorksEligible ? `
      <div class="tax-callout warning">
        <strong>⚠️ No capital works deduction</strong>
        <p>
          Construction started before 15 September 1987, so Division 43 capital
          works deductions don't apply to the original building. Later
          renovations or additions carried out after that date may still
          separately qualify.
        </p>
      </div>
    ` : ''}

    ${!plantEligible ? `
      <div class="tax-callout danger">
        <strong>🚫 Plant & equipment not depreciable</strong>
        <p>
          Since 9 May 2017, individual investors can't claim depreciation on
          plant & equipment (carpets, appliances, blinds etc.) that was
          already installed when they bought an established residential
          property second-hand. Only items you buy new yourself (or that an
          excluded entity like a company owns) can be depreciated.
        </p>
      </div>
    ` : `
      <div class="tax-callout info">
        <p>
          This plant & equipment figure is a rough indicative estimate only.
          Actual claims require a quantity surveyor's depreciation schedule,
          since each asset type has its own effective life under ATO ruling
          TR 2024/1.
        </p>
      </div>
    `}
  `;
}

function calculateGST(formData) {
  const amount = parseFloat(formData.get('amount')) || 0;
  const calculationType = formData.get('calculationType');
  const GST_RATE = 0.10;

  let gstAmount, netAmount, grossAmount;
  if (calculationType === 'add') {
    netAmount = amount;
    gstAmount = amount * GST_RATE;
    grossAmount = amount + gstAmount;
  } else {
    grossAmount = amount;
    netAmount = amount / (1 + GST_RATE);
    gstAmount = grossAmount - netAmount;
  }

  return `
    <h4>GST Calculation</h4>
    <div class="calc-row">
      <span>Amount excluding GST:</span>
      <strong>${fmt(netAmount)}</strong>
    </div>
    <div class="calc-row">
      <span>GST (10%):</span>
      <strong>${fmt(gstAmount)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Amount including GST:</span>
      <strong>${fmt(grossAmount)}</strong>
    </div>
    <div class="tax-callout info">
      <p>
        Residential rent and sales of established residential property are input-taxed
        — which is not the same as GST-free. Input-taxed means no GST is charged and you can't
        claim GST credits on related costs; GST-free means no GST is charged but credits can be
        claimed. New residential premises sold by a GST-registered enterprise are generally taxable.
        This calculator is mainly useful for commercial property or GST-registered enterprises.
      </p>
    </div>
  `;
}

// Standard level-payment amortization formula: P * r * (1+r)^n / ((1+r)^n - 1),
// same formula loanCalculations.js's calculatePaymentAmount uses for tracked
// loans — this is the standalone, "before you've even taken the loan out"
// version of that, so the two are consistent with each other.
function getMortgagePeriodsPerYear(frequency) {
  return { weekly: 52, fortnightly: 26, monthly: 12 }[frequency] || 12;
}

function calculateLevelPayment(principal, annualRatePct, periodsPerYear, totalPeriods) {
  const periodRate = (annualRatePct / 100) / periodsPerYear;
  if (periodRate === 0) return principal / totalPeriods;
  return principal * periodRate * Math.pow(1 + periodRate, totalPeriods) /
         (Math.pow(1 + periodRate, totalPeriods) - 1);
}

const FREQUENCY_LABELS = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };

function calculateMortgagePI(formData) {
  const loanAmount = parseFloat(formData.get('loanAmount')) || 0;
  const interestRate = parseFloat(formData.get('interestRate')) || 0;
  const termYears = parseFloat(formData.get('termYears')) || 0;
  const paymentFrequency = formData.get('paymentFrequency');
  const periodsPerYear = getMortgagePeriodsPerYear(paymentFrequency);
  const totalPeriods = Math.max(Math.round(termYears * periodsPerYear), 1);

  const payment = calculateLevelPayment(loanAmount, interestRate, periodsPerYear, totalPeriods);
  const totalRepaid = payment * totalPeriods;
  const totalInterest = totalRepaid - loanAmount;

  return `
    <h4>Principal &amp; Interest Repayment</h4>
    <div class="calc-row">
      <span>${FREQUENCY_LABELS[paymentFrequency] || 'Monthly'} repayment:</span>
      <strong>${fmt(payment)}</strong>
    </div>
    <div class="calc-row">
      <span>Total repaid over ${termYears} year${termYears === 1 ? '' : 's'}:</span>
      <strong>${fmt(totalRepaid)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Total interest paid:</span>
      <strong>${fmt(totalInterest)}</strong>
    </div>
    <div class="tax-callout info">
      <p>
        Assumes a fixed rate and a level repayment for the full term, with no
        offset, redraw, or rate changes along the way — an estimate to compare
        scenarios, not a lender's formal quote.
      </p>
    </div>
  `;
}

function calculateMortgageIO(formData) {
  const loanAmount = parseFloat(formData.get('loanAmount')) || 0;
  const interestRate = parseFloat(formData.get('interestRate')) || 0;
  const ioYears = parseFloat(formData.get('ioYears')) || 0;
  const remainingYears = parseFloat(formData.get('remainingYears')) || 0;
  const paymentFrequency = formData.get('paymentFrequency');
  const periodsPerYear = getMortgagePeriodsPerYear(paymentFrequency);

  // Interest-only: the balance never reduces during this period, so every
  // period's payment is just that period's interest on the full loan amount.
  const ioPeriods = Math.max(Math.round(ioYears * periodsPerYear), 1);
  const periodRate = (interestRate / 100) / periodsPerYear;
  const ioPayment = loanAmount * periodRate;
  const totalIoInterest = ioPayment * ioPeriods;

  // After the interest-only window, the full loan amount (nothing's been
  // paid off it) amortizes over whatever term is left.
  const remainingPeriods = Math.max(Math.round(remainingYears * periodsPerYear), 1);
  const stepUpPayment = calculateLevelPayment(loanAmount, interestRate, periodsPerYear, remainingPeriods);
  const totalStepUpRepaid = stepUpPayment * remainingPeriods;
  const totalStepUpInterest = totalStepUpRepaid - loanAmount;

  return `
    <h4>Interest-Only Repayment</h4>
    <div class="calc-row">
      <span>${FREQUENCY_LABELS[paymentFrequency] || 'Monthly'} repayment (interest-only):</span>
      <strong>${fmt(ioPayment)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Total interest paid over ${ioYears} year${ioYears === 1 ? '' : 's'} interest-only:</span>
      <strong>${fmt(totalIoInterest)}</strong>
    </div>
    <div class="tax-callout warning" style="margin-top: 0.75rem;">
      <p>Once the interest-only period ends, the full ${fmt(loanAmount)} still needs to be repaid — none of it has gone to principal yet.</p>
    </div>
    <h4 style="margin-top: 1rem;">Step-Up Repayment (after interest-only ends)</h4>
    <div class="calc-row">
      <span>${FREQUENCY_LABELS[paymentFrequency] || 'Monthly'} repayment over ${remainingYears} year${remainingYears === 1 ? '' : 's'}:</span>
      <strong>${fmt(stepUpPayment)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Total interest paid after step-up:</span>
      <strong>${fmt(totalStepUpInterest)}</strong>
    </div>
    <div class="tax-callout info">
      <p>
        Assumes a fixed rate throughout and no extra repayments during the
        interest-only period — an estimate to compare scenarios, not a
        lender's formal quote.
      </p>
    </div>
  `;
}

// ============================================================================
// 💰 OFFSET SAVINGS CALCULATOR
// ============================================================================

function populateOffsetModal() {
  const sel = document.getElementById('offsetLoanSelect');
  if (cachedLoans.length) {
    sel.innerHTML = cachedLoans.map(l =>
      `<option value="${l.id}">${l.name || l.type} — ${fmt(l.currentBalance)} @ ${l.interestRate}%</option>`
    ).join('');
    fillOffsetFieldsFromLoan(cachedLoans[0].id);
  } else {
    sel.innerHTML = '<option value="">No loans found — enter figures manually below</option>';
  }
}

function fillOffsetFieldsFromLoan(loanId) {
  const loan = cachedLoans.find(l => l.id === loanId);
  if (!loan) return;
  document.getElementById('offsetBalanceField').value = loan.currentBalance || 0;
  document.getElementById('offsetRateField').value = loan.interestRate || 0;

  // Pre-fill the "what-if" offset amount with the loan's actual current
  // offset balance (if it has a linked offset account) as a sensible
  // starting point — still fully editable, since the point of this
  // calculator is to model a DIFFERENT offset balance, not just report
  // the current one.
  let currentOffset = 0;
  if (loan.linkedOffsetId) {
    const acc = cachedAccounts.find(a => a.id === loan.linkedOffsetId);
    if (acc) currentOffset = toAud(computeAccountBalance(acc, cachedRawTransactions), acc.currency);
  }
  document.getElementById('offsetAmountField').value = Math.max(Math.round(currentOffset), 0);
}

function calculateOffset(formData) {
  const balance = parseFloat(formData.get('balance')) || 0;
  const rate = parseFloat(formData.get('rate')) || 0;
  const offsetAmount = parseFloat(formData.get('offsetAmount')) || 0;

  const { interestBearingBalance, monthlySaving, annualSaving, offsetExceedsBalance } =
    calculateOffsetSavings({ balance, rate, offsetAmount });

  return `
    <h4>Offset Savings</h4>
    <div class="calc-row">
      <span>Interest-Bearing Balance After Offset:</span>
      <strong>${fmt(interestBearingBalance)}</strong>
    </div>
    <div class="calc-row">
      <span>Monthly Interest Saved:</span>
      <strong class="text-success">${fmt(monthlySaving)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Annual Interest Saved:</span>
      <strong class="text-success">${fmt(annualSaving)}</strong>
    </div>
    ${offsetExceedsBalance ? `
      <div class="tax-callout warning">
        <strong>ℹ️ Note</strong>
        <p>The offset balance modeled exceeds the loan balance — savings are capped, since interest can't go below zero.</p>
      </div>
    ` : ''}
  `;
}

// ============================================================================
// 📐 RENTAL YIELD CALCULATOR
// ============================================================================

function populateYieldModal() {
  const sel = document.getElementById('yieldPropertySelect');
  const investmentProps = cachedProperties.filter(p => p.propertyType !== 'primary');
  const list = investmentProps.length ? investmentProps : cachedProperties;
  if (list.length) {
    sel.innerHTML = list.map(p => `<option value="${p.id}">${p.name || p.address || 'Property'}</option>`).join('');
    fillYieldFieldsFromProperty(list[0].id);
  } else {
    sel.innerHTML = '<option value="">No properties found — enter figures manually below</option>';
  }
}

function fillYieldFieldsFromProperty(propertyId) {
  const property = cachedProperties.find(p => p.id === propertyId);
  if (!property) return;
  // These calculators work in AUD (holding costs come from AUD-converted transactions), so an overseas
  // property's price and rent are converted from its own currency first.
  const propCur = propertyCurrency(property);
  const aud2 = n => Math.round(toAud(n || 0, propCur) * 100) / 100;
  document.getElementById('yieldPurchasePriceField').value = aud2(property.purchasePrice);
  document.getElementById('yieldMonthlyRentField').value = aud2(property.rent);

  // Trailing-12-month actual holding costs for this property, from real
  // tagged expense transactions — not the property's mortgage repayments,
  // which live on the linked loan rather than as property-tagged expenses.
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const annualCosts = cachedTransactions
    .filter(t => t.propertyId === propertyId && t.type === 'expense' && !t.isTransfer && new Date(t.date) >= oneYearAgo)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0);
  document.getElementById('yieldAnnualCostsField').value = Math.round(annualCosts);
}

function calculateRentalYield(formData) {
  const purchasePrice = parseFloat(formData.get('purchasePrice')) || 0;
  const monthlyRent = parseFloat(formData.get('monthlyRent')) || 0;
  const annualCosts = parseFloat(formData.get('annualCosts')) || 0;

  const { annualRent, grossYield, netYield } = calcRentalYield({ purchasePrice, monthlyRent, annualCosts });

  return `
    <h4>Rental Yield</h4>
    <div class="calc-row">
      <span>Annual Rent:</span>
      <strong>${fmt(annualRent)}</strong>
    </div>
    <div class="calc-row">
      <span>Gross Yield:</span>
      <strong>${grossYield.toFixed(2)}%</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Net Yield (after holding costs):</span>
      <strong>${netYield.toFixed(2)}%</strong>
    </div>
    <div class="tax-callout info">
      <p>Net yield here excludes mortgage repayments and purchase costs (stamp duty, legal fees) — it's a holding-cost yield, not a full return-on-equity figure.</p>
    </div>
  `;
}

// ============================================================================
// 💵 PROPERTY CASH FLOW CALCULATOR
// ============================================================================

function populateCashFlowModal() {
  const sel = document.getElementById('cashFlowPropertySelect');
  const investmentProps = cachedProperties.filter(p => p.propertyType !== 'primary');
  const list = investmentProps.length ? investmentProps : cachedProperties;
  if (list.length) {
    sel.innerHTML = list.map(p => `<option value="${p.id}">${p.name || p.address || 'Property'}</option>`).join('');
    fillCashFlowFieldsFromProperty(list[0].id);
  } else {
    sel.innerHTML = '<option value="">No properties found — enter figures manually below</option>';
  }
}

function fillCashFlowFieldsFromProperty(propertyId) {
  const property = cachedProperties.find(p => p.id === propertyId);
  if (!property) return;
  document.getElementById('cfMonthlyRentField').value = Math.round(toAud(property.rent || 0, propertyCurrency(property)) * 100) / 100;

  // Pull the actual repayment from this property's linked loan (via
  // loan.propertyId) using the same formula the Loans page uses, rather
  // than trying to back it out of tagged transactions — avoids double
  // counting if repayments are ever also tagged with propertyId.
  const linkedLoan = cachedLoans.find(l => l.propertyId === propertyId);
  const mortgageRepayment = linkedLoan ? calculatePaymentAmount(linkedLoan) : 0;
  document.getElementById('cfMortgageField').value = Math.round(mortgageRepayment || 0);

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const annualOtherCosts = cachedTransactions
    .filter(t => t.propertyId === propertyId && t.type === 'expense' && !t.isTransfer && new Date(t.date) >= oneYearAgo)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0);
  document.getElementById('cfOtherCostsField').value = Math.round(annualOtherCosts / 12);
}

function calculateCashFlow(formData) {
  const monthlyRent = parseFloat(formData.get('monthlyRent')) || 0;
  const mortgageRepayment = parseFloat(formData.get('mortgageRepayment')) || 0;
  const otherCosts = parseFloat(formData.get('otherCosts')) || 0;

  const { monthlyCashFlow, annualCashFlow, isPositive } =
    calculatePropertyCashFlow({ monthlyRent, mortgageRepayment, otherCosts });

  return `
    <h4>Property Cash Flow</h4>
    <div class="calc-row">
      <span>Monthly Rent:</span>
      <strong class="text-success">${fmt(monthlyRent)}</strong>
    </div>
    <div class="calc-row">
      <span>Monthly Mortgage Repayment:</span>
      <strong class="text-danger">-${fmt(mortgageRepayment)}</strong>
    </div>
    <div class="calc-row">
      <span>Other Monthly Holding Costs:</span>
      <strong class="text-danger">-${fmt(otherCosts)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Monthly Cash Flow:</span>
      <strong class="${isPositive ? 'text-success' : 'text-danger'}">${isPositive ? '' : '-'}${fmt(Math.abs(monthlyCashFlow))}</strong>
    </div>
    <div class="calc-row">
      <span>Annualized:</span>
      <strong class="${isPositive ? 'text-success' : 'text-danger'}">${isPositive ? '' : '-'}${fmt(Math.abs(annualCashFlow))}</strong>
    </div>
    <div class="tax-callout ${isPositive ? 'info' : 'warning'}">
      <p>${isPositive
        ? 'This property is cash-flow positive on the figures entered — it puts more into your pocket than it costs to hold, before tax.'
        : 'This property is cash-flow negative on the figures entered — it costs more to hold than it brings in, before any tax benefit from negative gearing.'}</p>
    </div>
  `;
}

// ============================================================================
// 🎯 DEBT PAYOFF ORDER CALCULATOR
// ============================================================================

function getDebtList() {
  const loanDebts = cachedLoans
    .filter(l => (l.currentBalance || 0) > 0)
    .map(l => ({
      id: l.id,
      name: l.name || l.type || 'Loan',
      balance: l.currentBalance || 0,
      rate: l.interestRate || 0,
      minPayment: calculatePaymentAmount(l) || 0,
      rateIsEditable: false
    }));

  // Credit card accounts don't store an interest rate in this app, so it's
  // asked for here per card (defaulting to a typical AU card rate) rather
  // than silently assumed — everything else (balance) is real.
  const creditDebts = cachedAccounts
    .filter(a => a.type === 'credit')
    .map(a => {
      const balance = -toAud(computeAccountBalance(a, cachedRawTransactions), a.currency);
      return balance > 0 ? {
        id: a.id,
        name: a.name || 'Credit Card',
        balance,
        rate: a.interestRate || 19.99,
        minPayment: Math.max(balance * 0.02, 25),
        rateIsEditable: true
      } : null;
    })
    .filter(Boolean);

  return [...loanDebts, ...creditDebts];
}

function populateDebtPayoffModal() {
  const debts = getDebtList();
  const container = document.getElementById('debtPayoffList');
  if (!debts.length) {
    container.innerHTML = '<p class="text-muted">No outstanding loans or credit card balances found.</p>';
    return;
  }
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label">Debts (balance and minimum payment are pulled from your real accounts; edit rate for credit cards if known)</label>
      ${debts.map(d => `
        <div class="calc-row" style="align-items:center;">
          <span>${d.name} — ${fmt(d.balance)}</span>
          <span style="display:flex; align-items:center; gap:0.4rem;">
            <input type="number" class="form-input" style="width:80px;" data-debt-rate="${d.id}" value="${d.rate}" step="0.01" ${d.rateIsEditable ? '' : 'readonly'}>%
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

function calculateDebtPayoff(formData) {
  const extraPayment = parseFloat(formData.get('extraPayment')) || 0;
  const debts = getDebtList().map(d => {
    const rateInput = document.querySelector(`[data-debt-rate="${d.id}"]`);
    return { ...d, rate: rateInput ? parseFloat(rateInput.value) || d.rate : d.rate };
  });

  if (!debts.length) {
    return `<p class="text-muted">No outstanding debts to order.</p>`;
  }

  const { avalanche, snowball, totalMinPayments, topAvalanche, topSnowball } = rankDebtPayoffOrder(debts);

  const renderOrder = (list, label) => `
    <h4>${label}</h4>
    <ol style="padding-left:1.25rem; margin:0.5rem 0 1rem;">
      ${list.map(d => `<li>${d.name} — ${fmt(d.balance)} @ ${d.rate}% (min ${fmt(d.minPayment)}/mo)</li>`).join('')}
    </ol>
  `;

  return `
    ${renderOrder(avalanche, '🔺 Avalanche Order (highest rate first — least total interest)')}
    ${renderOrder(snowball, '❄️ Snowball Order (smallest balance first — fastest early wins)')}
    <div class="calc-row calc-total">
      <span>Total Minimum Payments:</span>
      <strong>${fmt(totalMinPayments)}/mo</strong>
    </div>
    <div class="calc-row">
      <span>Extra Payment Available:</span>
      <strong>${fmt(extraPayment)}/mo</strong>
    </div>
    <div class="tax-callout info">
      <p>
        Put the extra ${fmt(extraPayment)}/mo toward <strong>${topAvalanche.name}</strong> first under avalanche
        (saves the most interest overall), or <strong>${topSnowball.name}</strong> first under snowball
        (clears fastest for momentum) — keep paying minimums on everything else either way.
      </p>
    </div>
  `;
}

// ============================================================================
// 🔁 REFINANCE BREAK-EVEN CALCULATOR
// ============================================================================

function populateRefinanceModal() {
  const sel = document.getElementById('refiLoanSelect');
  if (cachedLoans.length) {
    sel.innerHTML = cachedLoans.map(l =>
      `<option value="${l.id}">${l.name || l.type} — ${fmt(l.currentBalance)} @ ${l.interestRate}%</option>`
    ).join('');
    fillRefinanceFieldsFromLoan(cachedLoans[0].id);
  } else {
    sel.innerHTML = '<option value="">No loans found — enter figures manually below</option>';
  }
}

function fillRefinanceFieldsFromLoan(loanId) {
  const loan = cachedLoans.find(l => l.id === loanId);
  if (!loan) return;
  document.getElementById('refiBalanceField').value = loan.currentBalance || 0;
  document.getElementById('refiCurrentRateField').value = loan.interestRate || 0;
}

function calculateRefinance(formData) {
  const balance = parseFloat(formData.get('balance')) || 0;
  const currentRate = parseFloat(formData.get('currentRate')) || 0;
  const remainingYears = parseFloat(formData.get('remainingYears')) || 25;
  const newRate = parseFloat(formData.get('newRate')) || 0;
  const exitFee = parseFloat(formData.get('exitFee')) || 0;
  const newFees = parseFloat(formData.get('newFees')) || 0;
  const cashback = parseFloat(formData.get('cashback')) || 0;

  const { currentRepayment, newRepayment, monthlySaving, switchingCost, breakEvenMonths } =
    calculateRefinanceBreakEven({ balance, currentRate, remainingYears, newRate, exitFee, newFees, cashback });

  return `
    <h4>Refinance Comparison</h4>
    <div class="calc-row">
      <span>Current Monthly Repayment (${currentRate}%):</span>
      <strong>${fmt(currentRepayment)}</strong>
    </div>
    <div class="calc-row">
      <span>New Monthly Repayment (${newRate}%):</span>
      <strong>${fmt(newRepayment)}</strong>
    </div>
    <div class="calc-row calc-total">
      <span>Monthly Saving:</span>
      <strong class="${monthlySaving >= 0 ? 'text-success' : 'text-danger'}">${monthlySaving >= 0 ? '' : '-'}${fmt(Math.abs(monthlySaving))}</strong>
    </div>
    <div class="calc-row">
      <span>Total Switching Cost (exit + new fees − cashback):</span>
      <strong>${fmt(switchingCost)}</strong>
    </div>
    ${breakEvenMonths !== null ? `
      <div class="calc-row calc-total">
        <span>Break-Even Point:</span>
        <strong>${breakEvenMonths <= 0 ? 'Immediate' : `${Math.ceil(breakEvenMonths)} months`}</strong>
      </div>
      <div class="tax-callout ${breakEvenMonths > 36 ? 'warning' : 'info'}">
        <p>${breakEvenMonths > 36
          ? `It takes over 3 years to recoup the switching cost — worth checking whether you're likely to stay in this loan that long before committing.`
          : `The switching cost is recovered in under 3 years — a reasonably strong case for refinancing on the numbers alone.`}</p>
      </div>
    ` : `
      <div class="tax-callout warning">
        <p>The new rate isn't lower than your current rate, so there's no ongoing saving to recoup the switching cost against.</p>
      </div>
    `}
  `;
}

function showRefinanceModal() {
  populateRefinanceModal();
  document.getElementById('modalRefinance').classList.add('active');
}

// ============================================================================
// 📊 REPORT GENERATION
// ============================================================================

// Stores the last generated report so the "Download PDF" (JSON) button can
// reference real data. Bug fix: the download buttons previously did
// onclick="downloadReport('rental-schedule', report)" where `report` was a
// local variable inside the generator function and didn't exist in the
// button's global scope — clicking Download threw a ReferenceError.
window.__lastGeneratedReport = null;

const REPORT_DISCLAIMER =
  'Working paper built from records in this app. Not an ATO lodgment format and not tax advice. ' +
  'Private-use apportionment, joint-ownership shares and loan-purpose splits are NOT applied. ' +
  'Confirm all figures with a registered tax agent before lodging.';

function getReportFY() {
  const sel = document.getElementById('reportFY');
  const y = sel ? parseInt(sel.value, 10) : NaN;
  return Number.isFinite(y) ? y : getMostRecentCompletedFYRange().start.getFullYear();
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function buildRentalSchedule(fyStartYear) {
  const f = getRentalFigures(fyStartYear);
  return {
    title: 'Rental Income Schedule (working paper)',
    period: f.label,
    generated: new Date().toLocaleDateString('en-AU'),
    basis: 'Actual rent received and expenses recorded in this app for the period. Nothing is estimated from the current rent setting.',
    summary: {
      totalRentReceived: round2(f.totals.rentReceived),
      totalDeductibleExpenses: round2(f.totals.deductibleExpenses),
      totalLoanInterest: round2(f.totals.loanInterest),
      totalDeductions: round2(f.totals.totalDeductions),
      netRentalResult: round2(f.totals.net),
      excludedCapitalItems: round2(f.totals.excludedCapital),
      excludedNonDeductibleItems: round2(f.totals.excludedNonDeductible)
    },
    byProperty: f.rows.map(r => ({
      property: r.property,
      rentReceived: round2(r.rentReceived),
      rentPaymentsRecorded: r.rentPayments,
      deductibleExpensesByCategory: Object.fromEntries(
        Object.entries(r.expensesByCategory).map(([k, v]) => [k, round2(v)])),
      loanInterest: round2(r.loanInterest),
      totalDeductions: round2(r.totalDeductions),
      netRentalResult: round2(r.net),
      excludedCapitalItems: round2(r.excludedCapital),
      excludedNonDeductibleItems: round2(r.excludedNonDeductible)
    })),
    unlinkedRentNotIncluded: f.unallocatedRent.count ? { payments: f.unallocatedRent.count, amount: round2(f.unallocatedRent.amount) } : undefined,
    warnings: f.warnings,
    disclaimer: REPORT_DISCLAIMER
  };
}

function buildDeductionReport(fyStartYear) {
  const f = getRentalFigures(fyStartYear);
  const deductions = {};
  f.rows.forEach(r => Object.entries(r.expensesByCategory).forEach(([k, v]) => {
    deductions[k] = (deductions[k] || 0) + v;
  }));
  if (f.totals.loanInterest) deductions['Loan Interest (from loan payment records)'] = f.totals.loanInterest;
  const rounded = Object.fromEntries(Object.entries(deductions).map(([k, v]) => [k, round2(v)]));
  return {
    title: 'Rental Deduction Report (working paper)',
    period: f.label,
    generated: new Date().toLocaleDateString('en-AU'),
    basis: 'Deductible items recorded against rental properties for the period. Capital items and non-deductible categories (e.g. travel) are excluded.',
    deductions: rounded,
    totalDeductions: round2(f.totals.totalDeductions),
    excluded: {
      capitalItems: round2(f.totals.excludedCapital),
      nonDeductibleItems: round2(f.totals.excludedNonDeductible),
      note: 'Capital items may be claimable as capital works or add to the CGT cost base instead of being an immediate deduction.'
    },
    warnings: f.warnings,
    disclaimer: REPORT_DISCLAIMER
  };
}

function renderReport(title, filename, report) {
  window.__lastGeneratedReport = report;
  document.getElementById('reportOutput').innerHTML = `
    <div class="card" style="margin-top: 1rem;">
      <h3>${title} — ${escapeHtml(report.period)}</h3>
      <pre class="tax-json-output">
${escapeHtml(JSON.stringify(report, null, 2))}
      </pre>
      <button class="btn btn-success" onclick="downloadReport('${filename}', window.__lastGeneratedReport)">
        📥 Download JSON
      </button>
    </div>
  `;
}

async function generateRentalSchedule() {
  const hasRentals = cachedProperties.some(p => p.propertyType !== 'primary');
  if (!hasRentals) {
    document.getElementById('reportOutput').innerHTML = `
      <div class="card" style="margin-top: 1rem;">
        <h3>📄 Rental Schedule Report</h3>
        <p class="text-muted">No investment/rental properties found. Add one under Properties to generate a schedule.</p>
      </div>`;
    return;
  }
  renderReport('📄 Rental Schedule', 'rental-schedule', buildRentalSchedule(getReportFY()));
}

async function generateDeductionReport() {
  const hasRentals = cachedProperties.some(p => p.propertyType !== 'primary');
  if (!hasRentals) {
    document.getElementById('reportOutput').innerHTML = `
      <div class="card" style="margin-top: 1rem;">
        <h3>💰 Deduction Report</h3>
        <p class="text-muted">No investment/rental properties found. Add one under Properties to generate a report.</p>
      </div>`;
    return;
  }
  renderReport('💰 Deduction Report', 'deduction-report', buildDeductionReport(getReportFY()));
}

function generateCGTReport() {
  document.getElementById('reportOutput').innerHTML = `
    <div class="card" style="margin-top: 1rem;">
      <h3>📈 CGT Report</h3>
      <p class="text-muted">Use the CGT calculator first to generate a report.</p>
      <button class="btn btn-primary" onclick="showCGTModal()">
        Open CGT Calculator
      </button>
    </div>
  `;
}

async function exportAllReports() {
  const fy = getReportFY();
  const reports = {
    period: getFYRange(fy).label,
    rentalSchedule: buildRentalSchedule(fy),
    deductionReport: buildDeductionReport(fy),
    exported: new Date().toISOString(),
    disclaimer: REPORT_DISCLAIMER
  };
  downloadReport('ato-reports-bundle', reports);
}

// ============================================================================
// 🎛️ UI CONTROLS & UTILITIES
// ============================================================================

function switchTab(tabName, btnEl) {
  // Hide all panels
  document.querySelectorAll('.tax-tab-panel').forEach(tab => {
    tab.classList.remove('active');
  });

  // Deactivate all tab buttons
  document.querySelectorAll('.tax-tab').forEach(btn => {
    btn.classList.remove('active');
  });

  // Activate the selected panel + the button that was actually clicked
  // (passed in explicitly now, rather than relying on the implicit
  // global `event` object, which breaks if this is ever called any
  // other way than a raw inline onclick).
  const panel = document.getElementById(`${tabName}-tab`);
  if (panel) panel.classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}

function showCGTModal() {
  document.getElementById('modalCGT').classList.add('active');
}

function showNegGearingModal() {
  const sel = document.getElementById('negFYSelect');
  if (sel) {
    const cur = currentFYStartYear();
    sel.innerHTML = [cur, cur - 1].map(y =>
      `<option value="${y}">${getFYRange(y).label}${y === cur ? ' (current)' : ''}</option>`).join('');
  }
  document.getElementById('modalNeg').classList.add('active');
}

function showDepreciationModal() {
  document.getElementById('modalDepreciation').classList.add('active');
}

function showGSTModal() {
  document.getElementById('modalGST').classList.add('active');
}

function showMortgagePIModal() {
  document.getElementById('modalMortgagePI').classList.add('active');
}

function showMortgageIOModal() {
  document.getElementById('modalMortgageIO').classList.add('active');
}

function showDeductionWizard() {
  document.getElementById('modalDeductionWizard').classList.add('active');
}

function showOffsetModal() {
  populateOffsetModal();
  document.getElementById('modalOffset').classList.add('active');
}

function showRentalYieldModal() {
  populateYieldModal();
  document.getElementById('modalRentalYield').classList.add('active');
}

function showCashFlowModal() {
  populateCashFlowModal();
  document.getElementById('modalCashFlow').classList.add('active');
}

function showDebtPayoffModal() {
  populateDebtPayoffModal();
  document.getElementById('modalDebtPayoff').classList.add('active');
}

function setupEventListeners() {
  // CGT Calculator
  const cgtForm = document.getElementById('formCGT');
  if (cgtForm) {
    cgtForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateCGT(formData);
      document.getElementById('cgtResult').style.display = 'block';
      document.getElementById('cgtResult').innerHTML = result;
    });
  }
  
  // Negative Gearing Calculator
  const negForm = document.getElementById('formNeg');
  if (negForm) {
    negForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateNegativeGearing(formData);
      document.getElementById('negResult').style.display = 'block';
      document.getElementById('negResult').innerHTML = result;
    });
  }
  
  // Depreciation Calculator
  const depreciationForm = document.getElementById('formDepreciation');
  if (depreciationForm) {
    depreciationForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateDepreciation(formData);
      document.getElementById('depreciationResult').style.display = 'block';
      document.getElementById('depreciationResult').innerHTML = result;
    });
  }

  // GST Calculator
  const gstForm = document.getElementById('formGST');
  if (gstForm) {
    gstForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateGST(formData);
      document.getElementById('gstResult').style.display = 'block';
      document.getElementById('gstResult').innerHTML = result;
    });
  }

  // Mortgage Calculator (P&I)
  const mortgagePIForm = document.getElementById('formMortgagePI');
  if (mortgagePIForm) {
    mortgagePIForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateMortgagePI(formData);
      document.getElementById('mortgagePIResult').style.display = 'block';
      document.getElementById('mortgagePIResult').innerHTML = result;
    });
  }

  // Mortgage Calculator (Interest-Only)
  const mortgageIOForm = document.getElementById('formMortgageIO');
  if (mortgageIOForm) {
    mortgageIOForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateMortgageIO(formData);
      document.getElementById('mortgageIOResult').style.display = 'block';
      document.getElementById('mortgageIOResult').innerHTML = result;
    });
  }

  // Offset Savings Calculator
  const offsetForm = document.getElementById('formOffset');
  if (offsetForm) {
    offsetForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateOffset(formData);
      document.getElementById('offsetResult').style.display = 'block';
      document.getElementById('offsetResult').innerHTML = result;
    });
  }
  document.getElementById('offsetLoanSelect')?.addEventListener('change', e => fillOffsetFieldsFromLoan(e.target.value));

  // Rental Yield Calculator
  const yieldForm = document.getElementById('formRentalYield');
  if (yieldForm) {
    yieldForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateRentalYield(formData);
      document.getElementById('rentalYieldResult').style.display = 'block';
      document.getElementById('rentalYieldResult').innerHTML = result;
    });
  }
  document.getElementById('yieldPropertySelect')?.addEventListener('change', e => fillYieldFieldsFromProperty(e.target.value));

  // Property Cash Flow Calculator
  const cashFlowForm = document.getElementById('formCashFlow');
  if (cashFlowForm) {
    cashFlowForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateCashFlow(formData);
      document.getElementById('cashFlowResult').style.display = 'block';
      document.getElementById('cashFlowResult').innerHTML = result;
    });
  }
  document.getElementById('cashFlowPropertySelect')?.addEventListener('change', e => fillCashFlowFieldsFromProperty(e.target.value));

  // Debt Payoff Order Calculator
  const debtPayoffForm = document.getElementById('formDebtPayoff');
  if (debtPayoffForm) {
    debtPayoffForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateDebtPayoff(formData);
      document.getElementById('debtPayoffResult').style.display = 'block';
      document.getElementById('debtPayoffResult').innerHTML = result;
    });
  }

  // Refinance Break-Even Calculator
  const refinanceForm = document.getElementById('formRefinance');
  if (refinanceForm) {
    refinanceForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const result = calculateRefinance(formData);
      document.getElementById('refinanceResult').style.display = 'block';
      document.getElementById('refinanceResult').innerHTML = result;
    });
  }
  document.getElementById('refiLoanSelect')?.addEventListener('change', e => fillRefinanceFieldsFromLoan(e.target.value));

  // Close modals when clicking outside
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) {
        this.classList.remove('active');
      }
    });
  });
}

// ============================================================================
// 💰 UTILITY FUNCTIONS
// ============================================================================

function fmt(amount, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', { 
    style: 'currency', 
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount || 0);
}

function downloadReport(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// 🌐 GLOBAL FUNCTION EXPORTS
// ============================================================================

window.switchTab = switchTab;
window.showCGTModal = showCGTModal;
window.showNegGearingModal = showNegGearingModal;
window.showDepreciationModal = showDepreciationModal;
window.showGSTModal = showGSTModal;
window.showMortgagePIModal = showMortgagePIModal;
window.showMortgageIOModal = showMortgageIOModal;
window.showDeductionWizard = showDeductionWizard;
window.showOffsetModal = showOffsetModal;
window.showRentalYieldModal = showRentalYieldModal;
window.showCashFlowModal = showCashFlowModal;
window.showDebtPayoffModal = showDebtPayoffModal;
window.showRefinanceModal = showRefinanceModal;
window.generateRentalSchedule = generateRentalSchedule;
window.generateDeductionReport = generateDeductionReport;
window.generateCGTReport = generateCGTReport;
window.exportAllReports = exportAllReports;
window.downloadReport = downloadReport;