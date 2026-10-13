// ============================================================================
// 🧮 taxCalculations.js — Pure tax/CGT calculation logic
// ============================================================================
// Deliberately has ZERO dependency on window/document/DOM/IndexedDB, so it
// can be unit tested directly under Node (see tests/taxCalculations.test.js).
// tax_compliance.js imports from here for the actual numbers and only
// handles rendering/DOM.
// ============================================================================

// Resident individual tax rates by financial year (keyed by the year the FY
// STARTS, so 2026 = FY 2026-27). Source: ATO "Tax rates - Australian resident"
// (checked 11 Oct 2026): the $18,201-$45,000 bracket is 16c for 2024-25 and
// 2025-26, and 15c for 2026-27 (Treasury Laws Amendment (Cost of Living Tax
// Cuts) Act 2025). These rates EXCLUDE the 2% Medicare levy and any offsets.
// REVIEW EVERY NEW FINANCIAL YEAR - add a new key rather than editing an old one,
// so reports for past years keep using that year's rates.
const BRACKETS_2024_25 = [
  { threshold: 0, rate: 0.00 },
  { threshold: 18200, rate: 0.16 },
  { threshold: 45000, rate: 0.30 },
  { threshold: 135000, rate: 0.37 },
  { threshold: 190000, rate: 0.45 }
];
export const TAX_RATES_BY_FY = {
  2024: BRACKETS_2024_25,
  2025: BRACKETS_2024_25,
  2026: [
    { threshold: 0, rate: 0.00 },
    { threshold: 18200, rate: 0.15 },
    { threshold: 45000, rate: 0.30 },
    { threshold: 135000, rate: 0.37 },
    { threshold: 190000, rate: 0.45 }
  ]
};

// Brackets for the FY starting in `fyStartYear`. Years after the newest table
// reuse it (flagged by the caller via isRateTableKnown), years before the
// oldest table use the oldest.
export function getIndividualRates(fyStartYear) {
  const years = Object.keys(TAX_RATES_BY_FY).map(Number).sort((a, b) => a - b);
  const pick = [...years].reverse().find(y => y <= fyStartYear) ?? years[0];
  return TAX_RATES_BY_FY[pick];
}
export function isRateTableKnown(fyStartYear) {
  const years = Object.keys(TAX_RATES_BY_FY).map(Number);
  return fyStartYear >= Math.min(...years) && fyStartYear <= Math.max(...years);
}

// Kept for existing imports: the rates for the CURRENT financial year.
export const TAX_RATES = {
  get individual() { return getIndividualRates(getFYStartYear(new Date())); },
  corporate: 0.30,
  gst: 0.10
};

// Resident income tax (before Medicare levy and offsets) on a taxable income.
export function calculateIncomeTax(taxableIncome, fyStartYear) {
  const income = Math.max(Number(taxableIncome) || 0, 0);
  const brackets = getIndividualRates(fyStartYear);
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i].threshold;
    const upper = i + 1 < brackets.length ? brackets[i + 1].threshold : Infinity;
    if (income > lower) tax += (Math.min(income, upper) - lower) * brackets[i].rate;
  }
  return tax;
}

// Negative gearing: the reduction in income tax from a rental loss.
// If the taxable income BEFORE the loss is known, tax is worked out on the real
// brackets for that FY (so a loss that crosses a bracket edge is right).
// Otherwise falls back to loss x a flat marginal rate. Excludes Medicare levy.
export function calculateNegativeGearingEffect({ loss, taxableIncomeBefore, flatRatePercent, fyStartYear }) {
  const lossAmt = Math.max(Number(loss) || 0, 0);
  const hasIncome = taxableIncomeBefore !== null && taxableIncomeBefore !== undefined &&
    taxableIncomeBefore !== '' && Number.isFinite(Number(taxableIncomeBefore));
  if (hasIncome) {
    const before = Number(taxableIncomeBefore);
    const taxBefore = calculateIncomeTax(before, fyStartYear);
    const taxAfter = calculateIncomeTax(Math.max(before - lossAmt, 0), fyStartYear);
    const reduction = taxBefore - taxAfter;
    const usable = Math.min(lossAmt, Math.max(before, 0));
    return { method: 'brackets', loss: lossAmt, taxBefore, taxAfter, reduction,
      netCost: lossAmt - reduction, unusedLoss: lossAmt - usable,
      effectiveRate: lossAmt ? reduction / lossAmt : 0 };
  }
  const rate = (Number(flatRatePercent) || 0) / 100;
  const reduction = lossAmt * rate;
  return { method: 'flat', loss: lossAmt, reduction, netCost: lossAmt - reduction,
    unusedLoss: 0, effectiveRate: rate };
}

// ----------------------------------------------------------------------------
// Financial year helpers
// ----------------------------------------------------------------------------
// The most recently COMPLETED financial year is generally what you're
// reporting to the ATO on (e.g. in July 2026 you're lodging for FY2025-26,
// which just ended, not the brand-new FY2026-27 that just started).
// Local-time date from a "YYYY-MM-DD" string (avoids the UTC shift that
// new Date("YYYY-MM-DD") causes in Australian time zones).
export function parseLocalDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Year the financial year containing `date` STARTS (1 July).
export function getFYStartYear(date = new Date()) {
  const d = parseLocalDate(date) || new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

export function getFYRange(fyStartYear) {
  return {
    label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
    start: new Date(fyStartYear, 6, 1),
    end: new Date(fyStartYear + 1, 5, 30, 23, 59, 59)
  };
}

export function getMostRecentCompletedFYRange(now = new Date()) {
  const currentFYStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const completedFYStartYear = currentFYStartYear - 1;
  return {
    label: `FY ${completedFYStartYear}-${completedFYStartYear + 1}`,
    start: new Date(`${completedFYStartYear}-07-01T00:00:00`),
    end: new Date(`${completedFYStartYear + 1}-06-30T23:59:59`)
  };
}

// Months (as "YYYY-MM") a rental property overlaps with a date range, used
// to prorate rent for properties bought/sold partway through the period.
// `today` is injectable for deterministic testing.
export function monthsOverlapping(rangeStart, rangeEnd, propertyCreatedAt, today = new Date()) {
  const createdAt = propertyCreatedAt ? new Date(propertyCreatedAt) : rangeStart;
  const effectiveStart = createdAt > rangeStart ? createdAt : rangeStart;
  const effectiveEnd = today < rangeEnd ? today : rangeEnd; // never count future months
  if (effectiveEnd < effectiveStart) return [];

  const months = [];
  const cursor = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth(), 1);
  const endCursor = new Date(effectiveEnd.getFullYear(), effectiveEnd.getMonth(), 1);
  while (cursor <= endCursor) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

// ----------------------------------------------------------------------------
// Capital Gains Tax
// ----------------------------------------------------------------------------
// ATO rule: the 50% discount needs the asset owned for at least 12 months
// before the CGT event, EXCLUDING both the acquisition day and the CGT-event day.
// For property both dates are normally the CONTRACT dates, not settlement.
// Acquired 1 Jan 2025 -> the earliest qualifying event date is 2 Jan 2026.
export function isCGTDiscountEligible(acquisitionDate, eventDate) {
  const acq = parseLocalDate(acquisitionDate);
  const evt = parseLocalDate(eventDate);
  if (!acq || !evt) return null; // unknown
  const anniversary = new Date(acq.getFullYear() + 1, acq.getMonth(), acq.getDate());
  return evt > anniversary;
}

export function calculateCGTValues({ purchase, sell, improve, costs, years, taxRatePercent,
  acquisitionDate, eventDate, isResident = true }) {
  const costBase = purchase + improve + costs;
  const capitalGain = sell - costBase;
  // Prefer real dates; the old "years owned" input is only a fallback.
  let held12 = isCGTDiscountEligible(acquisitionDate, eventDate);
  if (held12 === null) held12 = years >= 1; // legacy fallback only (no dates given)
  // Discount only for Australian residents, only on a GAIN.
  const discount = (held12 && isResident && capitalGain > 0) ? 0.5 : 0;
  const taxableGain = capitalGain * (1 - discount);
  const taxPayable = Math.max(taxableGain, 0) * (taxRatePercent / 100);
  return { costBase, capitalGain, discount, taxableGain, taxPayable, held12, isResident };
}

// Division 43 first-year pro-rating: capital works are claimable from the day the
// property is first available for rent (never before construction finished).
export function calculateFirstYearDepreciation({ annualAmount, constructionDate, rentalDate }) {
  const rent = parseLocalDate(rentalDate);
  if (!rent || !annualAmount) return null;
  const fy = getFYStartYear(rent);
  const { end } = getFYRange(fy);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysInFY = Math.round((new Date(fy + 1, 5, 30) - new Date(fy, 6, 1)) / dayMs) + 1;
  const daysClaimable = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - rent) / dayMs) + 1;
  const cons = parseLocalDate(constructionDate);
  return {
    firstFY: fy,
    daysClaimable,
    daysInFY,
    amount: annualAmount * Math.min(daysClaimable, daysInFY) / daysInFY,
    rentalBeforeConstruction: !!(cons && rent < cons)
  };
}

// Assumed marginal rate used for the "quick estimate" savings figure. Reads
// from TAX_RATES rather than a separate hardcoded number, so both stay in
// sync automatically when the ATO updates rates each financial year.
export function getAssumedMarginalRate() {
  return getIndividualRates(getFYStartYear(new Date())).find(b => b.threshold === 45000)?.rate ?? 0.30;
}

// ----------------------------------------------------------------------------
// Rental figures for ONE financial year (single source of truth for the
// header metrics, Rental Summary card and the exported reports)
// ----------------------------------------------------------------------------
// Everything here is ACTUAL recorded data for the chosen FY:
//  - rent = income transactions in the Rental Income category
//  - expenses = expense transactions linked to a non-primary property, minus
//    capital items, non-deductible buckets (e.g. Travel), loan repayments
//    (only the interest part is deductible - taken from loan payment records)
//  - interest = interest portion of loan payments on loans linked to a rental
// It does NOT apportion private use, joint ownership or investment/personal
// loan splits - those need the owner's / a tax agent's judgement, so they are
// surfaced as warnings instead of being silently guessed.
export function computeRentalFigures({
  transactions = [], loanTransactions = [], loans = [], properties = [],
  directExpenses = [], capitalizedTxIds = new Set(), fyStartYear,
  bucketOf = () => 'Other', isBucketDeductible = () => true,
  toAudFn = (amount) => amount
}) {
  const { label, start, end } = getFYRange(fyStartYear);
  const inFY = (value) => {
    const d = parseLocalDate(value);
    return !!d && d >= start && d <= end;
  };
  const abs = (n) => Math.abs(parseFloat(n) || 0);
  const rentalProps = properties.filter(p => p && p.propertyType !== 'primary');
  const byId = new Map(rentalProps.map(p => [p.id, {
    propertyId: p.id,
    property: p.name || p.address || 'Property',
    propertyType: p.propertyType,
    rentReceived: 0,
    rentPayments: 0,
    deductibleExpenses: 0,
    expensesByCategory: {},
    loanInterest: 0,
    excludedCapital: 0,
    excludedNonDeductible: 0
  }]));

  const warnings = [];
  const unallocatedRent = { amount: 0, count: 0 };
  const loanRepaymentsExcluded = { amount: 0, count: 0 };

  transactions.forEach(t => {
    if (!t || t.isTransfer || !inFY(t.date)) return;
    if (t.type === 'income' && t.categoryId === 'sub_rental_income') {
      const row = byId.get(t.propertyId);
      if (row) { row.rentReceived += abs(t.amount); row.rentPayments += 1; }
      else { unallocatedRent.amount += abs(t.amount); unallocatedRent.count += 1; }
      return;
    }
    if (t.type !== 'expense' || !byId.has(t.propertyId)) return;
    const row = byId.get(t.propertyId);
    const amt = abs(t.amount);
    const bucket = t.expenseCategory || bucketOf(t);
    if (t.loanId || bucket === 'Loan Interest') {
      // Whole repayment includes principal - not deductible. Interest comes
      // from the loan's own payment records below.
      loanRepaymentsExcluded.amount += amt; loanRepaymentsExcluded.count += 1;
      return;
    }
    if (capitalizedTxIds.has(t.id) || bucket === 'Capital Improvements') {
      row.excludedCapital += amt; return;
    }
    if (!isBucketDeductible(bucket)) { row.excludedNonDeductible += amt; return; }
    row.deductibleExpenses += amt;
    row.expensesByCategory[bucket] = (row.expensesByCategory[bucket] || 0) + amt;
  });

  // Manually entered property expenses that never came from a transaction/bill
  directExpenses.forEach(e => {
    if (!e || e.transactionId || e.billId || !byId.has(e.propertyId) || !inFY(e.date)) return;
    const row = byId.get(e.propertyId);
    const amt = abs(e.amount);
    const bucket = e.category || 'Other';
    if (bucket === 'Capital Improvements') { row.excludedCapital += amt; return; }
    if (e.taxDeductible === false || !isBucketDeductible(bucket)) { row.excludedNonDeductible += amt; return; }
    if (bucket === 'Loan Interest') { row.loanInterest += amt; return; }
    row.deductibleExpenses += amt;
    row.expensesByCategory[bucket] = (row.expensesByCategory[bucket] || 0) + amt;
  });

  // Interest portion of loan repayments, for loans linked to a rental property
  const loanById = new Map(loans.map(l => [l.id, l]));
  loanTransactions.forEach(lt => {
    const loan = loanById.get(lt?.loanId);
    if (!loan || !byId.has(loan.propertyId) || !inFY(lt.date)) return;
    const interest = parseFloat(lt.interest) || 0;
    if (interest > 0) byId.get(loan.propertyId).loanInterest += toAudFn(interest, loan.currency || 'AUD');
  });

  const rows = [...byId.values()].map(r => {
    const totalDeductions = r.deductibleExpenses + r.loanInterest;
    return { ...r, totalDeductions, net: r.rentReceived - totalDeductions };
  });
  const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
  const totals = {
    rentReceived: sum('rentReceived') ,
    deductibleExpenses: sum('deductibleExpenses'),
    loanInterest: sum('loanInterest'),
    totalDeductions: sum('totalDeductions'),
    excludedCapital: sum('excludedCapital'),
    excludedNonDeductible: sum('excludedNonDeductible')
  };
  totals.net = totals.rentReceived - totals.totalDeductions;

  if (unallocatedRent.count) warnings.push(`${unallocatedRent.count} rent payment(s) totalling ${Math.round(unallocatedRent.amount)} are not linked to a property and are NOT included above. Link them to a property to include them.`);
  if (loanRepaymentsExcluded.count) warnings.push(`${loanRepaymentsExcluded.count} loan repayment transaction(s) on rental properties were left out because repayments include non-deductible principal. Interest is taken from loan payment records instead - check each loan is linked to its property.`);
  if (rows.some(r => r.propertyType === 'vacation')) warnings.push('A holiday/vacation property is included. Deductions must be apportioned for any private use - none has been applied here.');
  warnings.push('Not applied: private-use apportionment, joint-ownership share, and whether loan interest relates to the rental (redraws/split loans). Confirm these with a registered tax agent.');
  if (totals.excludedCapital) warnings.push('Capital items were excluded from deductions (they may be claimable as capital works / add to cost base).');

  return { fyStartYear, label, rows, totals, unallocatedRent, loanRepaymentsExcluded, warnings };
}

// ----------------------------------------------------------------------------
// Key dates (computed for the real calendar, never hard-coded to a year)
// ----------------------------------------------------------------------------
// If a due date falls on a weekend the ATO allows the next business day. Public
// holidays are NOT modelled, so the result can be a day early in that case.
export function rollToBusinessDay(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

// Upcoming dates for the next ~14 months. BAS dates only when `gstRegistered`.
// Source: ATO "Due dates for lodging and paying your BAS" (quarterly: 28 Oct,
// 28 Feb, 28 Apr, 28 Jul) and ATO individual return due dates (31 Oct if
// self-lodging; a registered tax agent may give later dates).
export function getTaxDeadlines(today = new Date(), { gstRegistered = false } = {}) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  const nextYears = [t0.getFullYear() - 1, t0.getFullYear(), t0.getFullYear() + 1];
  nextYears.forEach(y => {
    out.push({ key: `ret-${y}`, name: `Individual tax return for FY ${y - 1}-${String(y).slice(-2)} (self-lodge)`,
      date: rollToBusinessDay(new Date(y, 9, 31)), kind: 'return',
      note: 'A registered tax agent may give you a later lodgment date.' });
    if (gstRegistered) {
      [[`BAS Q1 (Jul-Sep ${y})`, 9, 28], [`BAS Q2 (Oct-Dec ${y - 1})`, 1, 28],
       [`BAS Q3 (Jan-Mar ${y})`, 3, 28], [`BAS Q4 (Apr-Jun ${y})`, 6, 28]].forEach(([name, m, d]) => {
        out.push({ key: `bas-${name}`, name, date: rollToBusinessDay(new Date(y, m, d)), kind: 'bas',
          note: 'Quarterly reporting. Online lodgers may get 2 extra weeks (not Q2); agents may have later dates.' });
      });
    }
  });
  const horizon = new Date(t0); horizon.setMonth(horizon.getMonth() + 14);
  const lookBack = new Date(t0); lookBack.setDate(lookBack.getDate() - 14);
  return out
    .filter(x => x.date >= lookBack && x.date <= horizon)
    .map(x => ({ ...x, daysUntil: Math.round((x.date - t0) / 86400000) }))
    .sort((a, b) => a.date - b.date);
}
