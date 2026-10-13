// propertyExpenseCategories.js
export const PROPERTY_EXPENSE_CATEGORIES = {
  // Map to your existing categories
  'Maintenance': { 
    type: 'immediate', 
    deductible: true, 
    color: '#3B82F6',
    defaultCategoryId: 'sub_misc_items'  // Links to your "Repairs & Maintenance"
  },
  'Repairs': { 
    type: 'immediate', 
    deductible: true, 
    color: '#EF4444',
    defaultCategoryId: 'sub_misc_items'
  },
  'Utilities': { 
    type: 'ongoing', 
    deductible: true, 
    color: '#10B981',
    defaultCategoryId: 'cat_utilities'
  },
  'Insurance': { 
    type: 'ongoing', 
    deductible: true, 
    color: '#F59E0B',
    defaultCategoryId: 'cat_insurance'
  },
  'Council Rates': { 
    type: 'ongoing', 
    deductible: true, 
    color: '#8B5CF6',
    defaultCategoryId: 'sub_council_rates'
  },
  // Split out from Council Rates (see CATEGORY_ID_TO_BUCKET below) — the
  // ATO's rental property schedule lists rates and land tax as separate
  // deduction line items, and they're billed by different levels of
  // government (local council vs. state revenue office) on their own
  // schedules, so merging them hid that distinction on both the Finance
  // Overview and the Deduction Report.
  'Land Tax': {
    type: 'ongoing',
    deductible: true,
    color: '#0EA5E9',
    defaultCategoryId: 'sub_land_tax'
  },
  'Property Management': { 
    type: 'ongoing', 
    deductible: true, 
    color: '#EC4899',
    defaultCategoryId: 'cat_housing'  // No direct match, use housing
  },
  'Loan Interest': { 
    type: 'ongoing', 
    deductible: true, 
    color: '#06B6D4',
    defaultCategoryId: 'cat_housing'  // Could map to mortgage or create new
  },
  'Body Corporate': { 
    type: 'ongoing', 
    deductible: true, 
    color: '#84CC16',
    defaultCategoryId: 'cat_housing'
  },
  'Capital Improvements': { 
    type: 'capital', 
    deductible: false, 
    color: '#F97316',
    defaultCategoryId: 'cat_housing'
  },
  'Travel': { 
    // Not deductible for individuals on a residential rental property since
    // 1 July 2017 (narrow exceptions only for a formal property business or
    // commercial property).
    type: 'immediate', 
    deductible: false, 
    color: '#6366F1',
    defaultCategoryId: 'cat_travel'
  },
  'Legal Fees': { 
    type: 'immediate', 
    deductible: true, 
    color: '#8B5CF6',
    defaultCategoryId: 'cat_fees'
  },
  'Other': { 
    type: 'other', 
    deductible: true, 
    color: '#6B7280',
    defaultCategoryId: 'cat_misc'
  }
};

// ---------------------------------------------------------------------------
// Reverse lookup: transaction categoryId -> Property Expenses bucket.
//
// The forward map above (bucket -> defaultCategoryId) already encodes which
// transaction category each bucket corresponds to; this just inverts it
// once so the import pipeline can go the other way — "this transaction was
// already categorized as sub_council_rates, so on the Property Expenses
// page it belongs in the Council Rates bucket" — instead of leaving every
// auto-flagged property transaction to fall back to "Other" until someone
// opens it and picks a bucket by hand.
//
// Maps the REAL category ids from defaultCategories.js — checked against
// the actual taxonomy rather than guessed. Two groups matter here:
//
// 1. The dedicated `cat_investment_property` subcategories (sub_inv_mortgage,
//    sub_property_management, sub_land_tax, sub_inv_water_rates,
//    sub_inv_council_rates, sub_property_maintenance) exist in the taxonomy
//    but nothing in the auto-categorization engine (bankCategoryMap.js,
//    merchantRules.js, categoryRules.js) ever assigns them — they're only
//    reachable by picking them manually from the category dropdown. Mapped
//    here so that if/when a transaction does carry one, it lands in the
//    right bucket instead of "Other".
// 2. The general household equivalents (sub_council_rates, sub_electricity,
//    sub_home_ins, etc.) are what the auto-categorizer actually produces
//    today, for BOTH home and investment-property bills alike — a landlord
//    insurance premium and a home insurance premium both just say
//    "insurance" as far as keyword/merchant matching is concerned. These
//    are mapped too, since once something is already confirmed to be a
//    property expense (by account link, learned rule, or address match —
//    see categoryMapper.js), its existing category still tells us which
//    bucket it belongs in even though the category itself doesn't know it's
//    investment-related.
const CATEGORY_ID_TO_BUCKET = {
  // Dedicated investment-property subcategories (not yet auto-assigned by
  // anything, but mapped for correctness if the taxonomy or rules change)
  sub_inv_mortgage: 'Loan Interest',
  sub_property_management: 'Property Management',
  sub_land_tax: 'Land Tax',
  sub_inv_water_rates: 'Utilities',
  sub_inv_council_rates: 'Council Rates',
  sub_property_maintenance: 'Maintenance',
  // General household equivalents the auto-categorizer actually produces
  sub_home_repairs: 'Maintenance',
  sub_misc_items: 'Repairs',
  sub_electricity: 'Utilities',
  sub_gas: 'Utilities',
  sub_water_usage: 'Utilities',
  sub_home_ins: 'Insurance',
  sub_landlord_ins: 'Insurance',
  sub_council_rates: 'Council Rates',
  sub_body_corporate: 'Body Corporate',
  sub_mortgage_home: 'Loan Interest',
  sub_home_equity_mortgage: 'Loan Interest',
  sub_legal_fees: 'Legal Fees',
  sub_uncategorised: 'Other',
  cat_travel: 'Travel'
  // Deliberately no entry for Capital Improvements: it has no dedicated
  // category id of its own (defaults to the broad 'cat_housing', shared
  // with several other buckets), so it can only be set explicitly, either
  // by hand or by a future dedicated category — mapping the whole of
  // cat_housing to it here would wrongly reclassify ordinary housing
  // transactions.
};

// Given a transaction's categoryId, returns the matching Property Expenses
// bucket name (a key of PROPERTY_EXPENSE_CATEGORIES), or 'Other' if there's
// no known mapping. Never returns null/undefined so callers can assign it
// straight to tx.expenseCategory.
export function getExpenseCategoryBucket(categoryId) {
  if (!categoryId) return 'Other';
  return CATEGORY_ID_TO_BUCKET[categoryId] || 'Other';
}