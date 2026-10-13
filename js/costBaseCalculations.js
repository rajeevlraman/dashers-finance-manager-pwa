// ============================================================================
// costBaseCalculations.js — pure logic behind the Cost Base page (no DOM)
// ============================================================================
// Cost base = what you paid for the property, in the ATO's terms:
//   purchase price + buying costs (stamp duty, conveyancing...) + capital improvements
// Selling costs are NOT part of the cost base: they come off the sale proceeds
// when you sell. Loan fees, repairs, rates etc. are claimed as deductions, so
// they are not part of it either (and must never be claimed both ways).

import { isCGTDiscountEligible, parseLocalDate } from './taxCalculations.js';

// One plain-English choice per kind of cost. The old form asked for three
// overlapping dropdowns (Type, Classification, ATO Category); each kind below
// fixes all three so they can't contradict each other. The saved record keeps
// the same fields as before, so existing data and tax_compliance.js (which
// looks at classification === 'Capital' to avoid double-counting) still work.
export const COST_KINDS = {
  stampDuty: {
    label: 'Stamp duty', type: 'StampDuty', classification: 'Capital', atoCategory: 'Stamp Duty', bucket: 'buying',
    hint: 'Added to your cost base.'
  },
  legalBuying: {
    label: 'Legal / conveyancing when buying', type: 'Legal', classification: 'Capital', atoCategory: 'Legal Fees', bucket: 'buying',
    hint: 'Added to your cost base.'
  },
  otherBuying: {
    label: "Other buying cost (buyer's agent, inspections, searches)", type: 'Purchase', classification: 'Capital', atoCategory: 'Agent Commission', bucket: 'buying',
    hint: 'Added to your cost base.'
  },
  improvement: {
    label: 'Renovation or capital improvement', type: 'Improvement', classification: 'Capital', atoCategory: 'Renovation', bucket: 'improvements',
    hint: 'Added to your cost base. Ordinary repairs are different — choose "Repairs, rates or other running cost" for those.'
  },
  selling: {
    label: 'Selling cost (agent commission, marketing, legal on sale)', type: 'Selling', classification: 'Capital', atoCategory: 'Agent Commission', bucket: 'selling',
    hint: 'Not part of the cost base. It reduces your capital gain when you sell.'
  },
  borrowing: {
    label: 'Loan fees or borrowing cost (e.g. LMI, establishment fee)', type: 'Borrowing', classification: 'Expense', atoCategory: 'Borrowing Costs', bucket: 'deductible',
    hint: 'Not added to your cost base. Usually claimed as a deduction, spread over 5 years.'
  },
  holding: {
    label: 'Repairs, rates, insurance or other running cost', type: 'Other', classification: 'Expense', atoCategory: '', bucket: 'deductible',
    hint: 'Not added to your cost base. Claimed as a deduction instead.'
  }
};

export const COST_BUCKETS = [
  { id: 'buying', title: 'Buying costs', note: 'Added to your cost base', icon: '🧾' },
  { id: 'improvements', title: 'Improvements', note: 'Added to your cost base', icon: '🔨' },
  { id: 'selling', title: 'Selling costs', note: 'Come off your gain when you sell — not part of the cost base', icon: '🏷️' },
  { id: 'deductible', title: 'Claimed as deductions', note: 'Not part of the cost base', icon: '📎' }
];

// Which kind does a saved record represent? Works for records saved by the
// old three-dropdown form too.
export function kindOfRecord(record) {
  const type = record?.type;
  const cls = record?.classification;
  if (type === 'Selling') return 'selling';
  if (cls === 'Expense') return type === 'Borrowing' ? 'borrowing' : 'holding';
  if (type === 'Improvement') return 'improvement';
  if (type === 'StampDuty') return 'stampDuty';
  if (type === 'Legal') return 'legalBuying';
  return 'otherBuying';
}

export function bucketOfRecord(record) {
  return COST_KINDS[kindOfRecord(record)].bucket;
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// purchasePrice must already be in AUD.
export function summarisePropertyCostBase({ purchasePrice = 0, records = [] }) {
  const sums = { buying: 0, improvements: 0, selling: 0, deductible: 0 };
  const counts = { buying: 0, improvements: 0, selling: 0, deductible: 0 };
  records.forEach(r => {
    if (!r) return;
    const b = bucketOfRecord(r);
    sums[b] += num(r.amount);
    counts[b] += 1;
  });
  const price = num(purchasePrice);
  return {
    purchasePrice: price,
    buying: sums.buying,
    improvements: sums.improvements,
    selling: sums.selling,
    deductible: sums.deductible,
    costBase: price + sums.buying + sums.improvements,
    counts
  };
}

// "If I sold on <saleDate> for <salePrice>" — an estimate, not a tax return.
// The 12-month discount is checked from real contract dates when both are
// known; otherwise both outcomes are returned so the page can show a range.
export function estimateSale({ summary, salePrice, acquisitionDate, saleDate, isResident = true }) {
  const sale = num(salePrice);
  // Selling costs come off the proceeds; buying costs are already in the cost base.
  const gain = sale - summary.selling - summary.costBase;
  const discountKnown = isCGTDiscountEligible(acquisitionDate, saleDate); // true | false | null
  // The 50% discount is only for a GAIN, only for Australian residents.
  const canDiscount = gain > 0 && isResident;
  const taxableGainBest = canDiscount ? gain * 0.5 : gain;
  const taxableGainWorst = gain;
  const applies = discountKnown === true && canDiscount;
  return {
    gain,
    discountKnown,
    taxableGainBest,
    taxableGainWorst,
    // exact figure only when both contract dates are known
    taxableGain: discountKnown === null ? null : (applies ? taxableGainBest : taxableGainWorst),
    discountAmount: discountKnown === null ? null : (applies ? gain * 0.5 : 0),
    isResident
  };
}

// CSV cell: quotes doubled, and a leading = + - @ neutralised so a description
// such as "=HYPERLINK(...)" can't run as a formula when opened in Excel.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export { parseLocalDate };
