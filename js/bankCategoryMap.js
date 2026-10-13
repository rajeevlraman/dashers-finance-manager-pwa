// bankCategoryMap.js
// ------------------------------------------------------------
// Map bank / CDR "category" labels to your internal categories.
// You can expand this over time as you see new labels.
// ------------------------------------------------------------

export const bankCategoryToCategoryId = {
  // Core from your Macquarie export:
  'Groceries': 'sub_supermarket',
  'Restaurants': 'sub_restaurants',
  'Fast Food': 'sub_fast_food',
  'Other Food Expenses': 'sub_restaurants',
  'Other Personal Expenses': 'sub_misc_items',
  'Other Home Expenses': 'sub_misc_items',
  'Games': 'sub_gaming',
  'Pay TV': 'sub_paytv',
  'Fun': 'sub_events_movies',
  'Charities': 'sub_charities',
  'Religion': 'sub_grooming',
  'Doctor': 'sub_gp',
  'Dentist': 'sub_dental',
  'Pharmacies': 'sub_pharmacy',
  'Eyes': 'sub_specialists',
  'Other Health Expenses': 'sub_gp',

  'Financial Insurance': 'sub_home_ins',
  'Insurance': 'sub_home_ins',

  'Phone': 'sub_mobile',
  'Internet': 'sub_internet',
  'Services': 'sub_misc_items',
  'Hardware': 'sub_electronics',
  'Software': 'sub_software_cloud',
  'Technology': 'sub_electronics',

  'Parking & Tolls': 'sub_tolls_parking',
  'Public Transit': 'sub_public_transport',
  'Fuel': 'sub_fuel',
  'Flights': 'sub_flights',
  'Travel Entertainment': 'sub_travel_food',
  'Movies': 'sub_events_movies',
  'Tuition & Fees': 'sub_uni_fees',
  'Education': 'cat_education',

  'Clothing': 'sub_clothing',
  'Shoes': 'sub_clothing',
  'Beauty': 'sub_grooming',
  'Furnishings': 'sub_home_furnishings',

  'BPAY Payments': 'sub_bpay',
  'BPAY Payment Reversals': 'sub_bpay',
  'Bill Payments': 'sub_business_services',
  'Transfers': 'sub_general_transfer',
  'Interest': 'sub_interest_charged',
  'Late Payment Fees': 'sub_misc_items',
  'Annual Cardholder Fees': 'sub_card_fees',
  'ATM Fees': 'sub_atm_fees',
  'Other Fees': 'sub_misc_items',

  'Government': 'sub_business_services',
  'Rates': 'sub_misc_items',
  'Home Loan': 'sub_mortgage_home',

  // Generic fallbacks:
  'Other': 'sub_general_retail',
  'Uncategorised': 'cat_misc'
};
