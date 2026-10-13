// merchantCategories.js
// Maps merchant keywords → { categoryId, confidence }
//
// Bug fix: 9 of these 17 categoryId values pointed to categories that
// don't actually exist in defaultCategories.js (exp_takeaway, exp_cafe,
// exp_medical, exp_online_shopping, exp_gambling, exp_subscriptions,
// exp_transfers, inc_investment, uncategorised) — verified by
// cross-checking every reference against the real category ID list (see
// tests/merchantCategories.test.js). Transactions matched against those
// would have been silently tagged with a categoryId matching nothing in
// the UI. All corrected to real, existing category IDs below.

export const merchantCategories = {

  // Groceries
  "woolworths": { categoryId: 'cat_groceries', confidence: 0.95 },
  "coles": { categoryId: 'cat_groceries', confidence: 0.95 },
  "malvic": { categoryId: 'cat_groceries', confidence: 0.95 },
  "eve iga": { categoryId: 'cat_groceries', confidence: 0.9 },
  "marketplace fresh": { categoryId: 'cat_groceries', confidence: 0.9 },
  "fish pier": { categoryId: 'cat_groceries', confidence: 0.85 },
  "antony ivan francis angelo": { categoryId: 'cat_groceries', confidence: 0.7 },

  // Restaurants & Takeaway
  "casey kebab": { categoryId: 'cat_dining', confidence: 0.9 },
  "mcdonald": { categoryId: 'cat_dining', confidence: 0.95 },
  "kfc": { categoryId: 'cat_dining', confidence: 0.95 },
  "next mark": { categoryId: 'cat_dining', confidence: 0.7 },
  "domino": { categoryId: 'cat_dining', confidence: 0.9 },
  "walker's doughnuts": { categoryId: 'cat_dining', confidence: 0.85 },

  // Utilities
  "globird": { categoryId: 'cat_utilities', confidence: 0.95 },
  "origin energy": { categoryId: 'cat_utilities', confidence: 0.95 },
  "south east water": { categoryId: 'cat_utilities', confidence: 0.95 },

  // Fuel
  "united petroleum": { categoryId: 'sub_fuel', confidence: 0.9 },
  "7-eleven": { categoryId: 'sub_fuel', confidence: 0.85 },
  "shell reddy express": { categoryId: 'sub_fuel', confidence: 0.9 },

  // Medical
  "chemist warehouse": { categoryId: 'cat_health', confidence: 0.95 },
  "myhealth": { categoryId: 'cat_health', confidence: 0.9 },

  // Shopping / General
  "paypal": { categoryId: 'sub_general_retail', confidence: 0.8 },
  "square": { categoryId: 'cat_misc', confidence: 0.6 },
  "temu": { categoryId: 'sub_general_retail', confidence: 0.95 },
  "amazon": { categoryId: 'sub_general_retail', confidence: 0.95 },
  "uniqlo": { categoryId: 'sub_clothing', confidence: 0.9 },

  // Insurance
  "aami": { categoryId: 'cat_insurance', confidence: 0.95 },

  // Gaming
  "eb games": { categoryId: "sub_gaming", confidence: 0.9 },

  // Gambling (no dedicated category exists yet - falls back to misc
  // rather than guessing a wrong specific one)
  "the lott": { categoryId: 'cat_misc', confidence: 0.9 },

  // Subscriptions
  "apple": { categoryId: 'cat_entertainment', confidence: 0.95 },

  // Transfers / Investment
  "ray white": { categoryId: "sub_rental_income", confidence: 0.95 },
  "krithik": { categoryId: 'cat_misc', confidence: 0.8 },
  "dias maths": { categoryId: 'cat_education', confidence: 0.9 },

  // Uncategorized fallback
  "default": { categoryId: 'sub_uncategorised', confidence: 0.1 }
};
