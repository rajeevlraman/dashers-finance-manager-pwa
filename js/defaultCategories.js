// defaultCategories.js
//
// SIMPLIFIED CATEGORY TAXONOMY (single system, 2-level: Category → Subcategory)
// ----------------------------------------------------------------------------
// This replaces the old dual exp_*/ms_* system (394 categories across two
// overlapping, near-duplicate taxonomies) with one clean list of ~25
// categories and ~100 subcategories.
//
// Key design change: vendor/brand names (Coles, Aldi, KFC, Netflix...) are
// NOT categories anymore. Which vendor a transaction belongs to is tracked
// separately on the transaction itself (the `merchant` field, populated
// automatically by the importer — see js/import/parser.js) so you can still
// report/filter by vendor without it bloating the category list or breaking
// budget matching. See js/import/merchantCategories.js, js/merchantRules.js
// and js/import/categoryMapper.js for the vendor → subcategory rules.
export const DEFAULT_CATEGORIES = [

// =====================================================================
// Income
// =====================================================================
{ id: 'cat_income', name: 'Income', type: 'income', icon: '💰', parentId: null },
{ id: 'sub_salary', name: 'Salary / Wages', type: 'income', icon: '🧾', parentId: 'cat_income' },
{ id: 'sub_spouse_salary', name: 'Spouse Salary / Wages', type: 'income', icon: '🧾', parentId: 'cat_income' },
{ id: 'sub_business_income', name: 'Business Income', type: 'income', icon: '🏢', parentId: 'cat_income' },
{ id: 'sub_investment_income', name: 'Investment Income', type: 'income', icon: '📈', parentId: 'cat_income' },
{ id: 'sub_rental_income', name: 'Rental Income', type: 'income', icon: '🏘️', parentId: 'cat_income' },
{ id: 'sub_interest_income', name: 'Interest Earned', type: 'income', icon: '💲', parentId: 'cat_income' },
{ id: 'sub_dividends', name: 'Dividends', type: 'income', icon: '📊', parentId: 'cat_income' },
{ id: 'sub_government_payments', name: 'Government Payments', type: 'income', icon: '🏛️', parentId: 'cat_income' },
{ id: 'sub_tax_refund', name: 'Tax Refund', type: 'income', icon: '💵', parentId: 'cat_income' },
{ id: 'sub_other_income', name: 'Other Income', type: 'income', icon: '💰', parentId: 'cat_income' },

// =====================================================================
// Housing
// =====================================================================
{ id: 'cat_housing', name: 'Housing & Living', type: 'expense', icon: '🏡', parentId: null },
{ id: 'sub_mortgage_home', name: 'Home Mortgage', type: 'expense', icon: '💸', parentId: 'cat_housing' },
{ id: 'sub_home_equity_mortgage', name: 'Home Equity Mortgage', type: 'expense', icon: '💸', parentId: 'cat_housing' },
{ id: 'sub_rent_payment', name: 'Rent Payment', type: 'expense', icon: '💰', parentId: 'cat_housing' },
{ id: 'sub_council_rates', name: 'Council Rates', type: 'expense', icon: '📄', parentId: 'cat_housing' },
{ id: 'sub_body_corporate', name: 'Body Corporate', type: 'expense', icon: '🏘️', parentId: 'cat_housing' },
{ id: 'sub_home_repairs', name: 'Repairs & Maintenance', type: 'expense', icon: '🛠️', parentId: 'cat_housing' },
{ id: 'sub_home_building', name: 'Home Building / Land Payments', type: 'expense', icon: '🏗️', parentId: 'cat_housing' },
{ id: 'sub_home_furnishings', name: 'Furnishings', type: 'expense', icon: '🛋️', parentId: 'cat_housing' },

// =====================================================================
// Utilities
// =====================================================================
{ id: 'cat_utilities', name: 'Utilities', type: 'expense', icon: '💡', parentId: null },
{ id: 'sub_electricity', name: 'Electricity', type: 'expense', icon: '⚡', parentId: 'cat_utilities' },
{ id: 'sub_gas', name: 'Gas', type: 'expense', icon: '🔥', parentId: 'cat_utilities' },
{ id: 'sub_water_usage', name: 'Water Usage', type: 'expense', icon: '🚿', parentId: 'cat_utilities' },
{ id: 'sub_internet', name: 'Internet / NBN', type: 'expense', icon: '🌐', parentId: 'cat_utilities' },
{ id: 'sub_mobile', name: 'Mobile Phone', type: 'expense', icon: '📱', parentId: 'cat_utilities' },
{ id: 'sub_paytv', name: 'Pay TV', type: 'expense', icon: '📺', parentId: 'cat_utilities' },

// =====================================================================
// Groceries
// =====================================================================
{ id: 'cat_groceries', name: 'Groceries & Household', type: 'expense', icon: '🛒', parentId: null },
{ id: 'sub_supermarket', name: 'Supermarket', type: 'expense', icon: '🛍️', parentId: 'cat_groceries' },
{ id: 'sub_fresh_produce', name: 'Fruits & Vegetables', type: 'expense', icon: '🥬', parentId: 'cat_groceries' },
{ id: 'sub_meat_seafood', name: 'Meat & Seafood', type: 'expense', icon: '🥩', parentId: 'cat_groceries' },
{ id: 'sub_specialty_groceries', name: 'Specialty / Ethnic Groceries', type: 'expense', icon: '🧺', parentId: 'cat_groceries' },
{ id: 'sub_household_supplies', name: 'Household Supplies', type: 'expense', icon: '🧽', parentId: 'cat_groceries' },

// =====================================================================
// Dining & Takeaway
// =====================================================================
{ id: 'cat_dining', name: 'Dining & Takeaway', type: 'expense', icon: '🍽️', parentId: null },
{ id: 'sub_restaurants', name: 'Restaurants', type: 'expense', icon: '🍽️', parentId: 'cat_dining' },
{ id: 'sub_fast_food', name: 'Fast Food', type: 'expense', icon: '🍔', parentId: 'cat_dining' },
{ id: 'sub_cafes_coffee', name: 'Cafes & Coffee', type: 'expense', icon: '☕', parentId: 'cat_dining' },
{ id: 'sub_delivery_apps', name: 'Delivery Apps', type: 'expense', icon: '🛵', parentId: 'cat_dining' },
{ id: 'sub_alcohol_bars', name: 'Alcohol & Bars', type: 'expense', icon: '🍺', parentId: 'cat_dining' },

// =====================================================================
// Transport
// =====================================================================
{ id: 'cat_transport', name: 'Transport', type: 'expense', icon: '🚗', parentId: null },
{ id: 'sub_fuel', name: 'Fuel / Petrol', type: 'expense', icon: '⛽', parentId: 'cat_transport' },
{ id: 'sub_ev_charge', name: 'EV Charging', type: 'expense', icon: '🔌', parentId: 'cat_transport' },
{ id: 'sub_car_service', name: 'Car Service & Repairs', type: 'expense', icon: '🛠️', parentId: 'cat_transport' },
{ id: 'sub_rego', name: 'Registration', type: 'expense', icon: '📄', parentId: 'cat_transport' },
{ id: 'sub_car_insurance', name: 'Car Insurance', type: 'expense', icon: '🚗💼', parentId: 'cat_transport' },
{ id: 'sub_tolls_parking', name: 'Tolls & Parking', type: 'expense', icon: '🅿️', parentId: 'cat_transport' },
{ id: 'sub_public_transport', name: 'Public Transport', type: 'expense', icon: '🚆', parentId: 'cat_transport' },
{ id: 'sub_rideshare_taxi', name: 'Rideshare & Taxis', type: 'expense', icon: '🚕', parentId: 'cat_transport' },

// =====================================================================
// Health & Medical
// =====================================================================
{ id: 'cat_health', name: 'Health & Medical', type: 'expense', icon: '🩺', parentId: null },
{ id: 'sub_gp', name: 'GP Visits', type: 'expense', icon: '👨‍⚕️', parentId: 'cat_health' },
{ id: 'sub_dental', name: 'Dental', type: 'expense', icon: '🦷', parentId: 'cat_health' },
{ id: 'sub_pharmacy', name: 'Pharmacy / Medicine', type: 'expense', icon: '💊', parentId: 'cat_health' },
{ id: 'sub_specialists', name: 'Specialists (incl. Eyes)', type: 'expense', icon: '🏥', parentId: 'cat_health' },
{ id: 'sub_health_insurance', name: 'Health Insurance', type: 'expense', icon: '⚕️', parentId: 'cat_health' },
{ id: 'sub_ambulance_cover', name: 'Ambulance Cover', type: 'expense', icon: '🚑', parentId: 'cat_health' },

// =====================================================================
// Insurance (non health / non auto — those live under Health & Transport)
// =====================================================================
{ id: 'cat_insurance', name: 'Insurance', type: 'expense', icon: '🛡️', parentId: null },
{ id: 'sub_home_ins', name: 'Home & Contents Insurance', type: 'expense', icon: '🏠', parentId: 'cat_insurance' },
{ id: 'sub_landlord_ins', name: 'Landlord Insurance', type: 'expense', icon: '🏘️', parentId: 'cat_insurance' },
{ id: 'sub_life_ins', name: 'Life Insurance', type: 'expense', icon: '❤️', parentId: 'cat_insurance' },
{ id: 'sub_pet_ins', name: 'Pet Insurance', type: 'expense', icon: '🐶', parentId: 'cat_insurance' },

// =====================================================================
// Education
// =====================================================================
{ id: 'cat_education', name: 'Education', type: 'expense', icon: '📚', parentId: null },
{ id: 'sub_school_fees', name: 'School Fees', type: 'expense', icon: '🏫', parentId: 'cat_education' },
{ id: 'sub_uni_fees', name: 'University / TAFE', type: 'expense', icon: '🎓', parentId: 'cat_education' },
{ id: 'sub_books_courses', name: 'Books, Stationery & Courses', type: 'expense', icon: '📘', parentId: 'cat_education' },
{ id: 'sub_childcare', name: 'Childcare', type: 'expense', icon: '🍼', parentId: 'cat_education' },

// =====================================================================
// Personal & Lifestyle
// =====================================================================
{ id: 'cat_personal', name: 'Personal & Lifestyle', type: 'expense', icon: '🧍', parentId: null },
{ id: 'sub_clothing', name: 'Clothing & Shoes', type: 'expense', icon: '👕', parentId: 'cat_personal' },
{ id: 'sub_grooming', name: 'Grooming / Salon', type: 'expense', icon: '💇', parentId: 'cat_personal' },
{ id: 'sub_fitness', name: 'Fitness / Gym', type: 'expense', icon: '🏋️', parentId: 'cat_personal' },
{ id: 'sub_gambling', name: 'Gambling / Lottery', type: 'expense', icon: '🎰', parentId: 'cat_personal' },
{ id: 'sub_hobbies', name: 'Hobbies & Sport', type: 'expense', icon: '🎨', parentId: 'cat_personal' },

// =====================================================================
// Entertainment & Subscriptions
// =====================================================================
{ id: 'cat_entertainment', name: 'Entertainment & Subscriptions', type: 'expense', icon: '🎬', parentId: null },
{ id: 'sub_streaming', name: 'Streaming (Video)', type: 'expense', icon: '🎥', parentId: 'cat_entertainment' },
{ id: 'sub_music_subs', name: 'Music Streaming', type: 'expense', icon: '🎵', parentId: 'cat_entertainment' },
{ id: 'sub_software_cloud', name: 'Software & Cloud', type: 'expense', icon: '☁️', parentId: 'cat_entertainment' },
{ id: 'sub_gaming', name: 'Gaming', type: 'expense', icon: '🎮', parentId: 'cat_entertainment' },
{ id: 'sub_events_movies', name: 'Movies & Events', type: 'expense', icon: '🎬', parentId: 'cat_entertainment' },

// =====================================================================
// Shopping
// =====================================================================
{ id: 'cat_shopping', name: 'Shopping', type: 'expense', icon: '🛍️', parentId: null },
{ id: 'sub_general_retail', name: 'General Retail', type: 'expense', icon: '🛍️', parentId: 'cat_shopping' },
{ id: 'sub_electronics', name: 'Electronics & Tech', type: 'expense', icon: '📱', parentId: 'cat_shopping' },
{ id: 'sub_online_shopping', name: 'Online Shopping', type: 'expense', icon: '📦', parentId: 'cat_shopping' },
{ id: 'sub_gifts', name: 'Gifts', type: 'expense', icon: '🎁', parentId: 'cat_shopping' },

// =====================================================================
// Travel
// =====================================================================
{ id: 'cat_travel', name: 'Travel', type: 'expense', icon: '✈️', parentId: null },
{ id: 'sub_flights', name: 'Flights', type: 'expense', icon: '🛫', parentId: 'cat_travel' },
{ id: 'sub_accommodation', name: 'Accommodation', type: 'expense', icon: '🏨', parentId: 'cat_travel' },
{ id: 'sub_car_rental', name: 'Car Rental', type: 'expense', icon: '🚘', parentId: 'cat_travel' },
{ id: 'sub_tours', name: 'Tours & Activities', type: 'expense', icon: '🗺️', parentId: 'cat_travel' },
{ id: 'sub_travel_food', name: 'Travel Food', type: 'expense', icon: '🍱', parentId: 'cat_travel' },

// =====================================================================
// Kids & Family
// =====================================================================
{ id: 'cat_kids', name: 'Kids & Family', type: 'expense', icon: '🧸', parentId: null },
{ id: 'sub_kids_activities', name: 'Kids Activities', type: 'expense', icon: '🤸', parentId: 'cat_kids' },
{ id: 'sub_kids_clothing', name: 'Kids Clothing', type: 'expense', icon: '🩳', parentId: 'cat_kids' },
{ id: 'sub_kids_toys', name: 'Toys', type: 'expense', icon: '🧩', parentId: 'cat_kids' },
{ id: 'sub_kids_school_items', name: 'School Items', type: 'expense', icon: '🎒', parentId: 'cat_kids' },

// =====================================================================
// Pets
// =====================================================================
{ id: 'cat_pets', name: 'Pets', type: 'expense', icon: '🐶', parentId: null },
{ id: 'sub_pet_food', name: 'Pet Food', type: 'expense', icon: '🥫', parentId: 'cat_pets' },
{ id: 'sub_vet', name: 'Vet Bills', type: 'expense', icon: '⚕️', parentId: 'cat_pets' },
{ id: 'sub_pet_supplies', name: 'Pet Supplies', type: 'expense', icon: '🦴', parentId: 'cat_pets' },
{ id: 'sub_pet_grooming', name: 'Pet Grooming', type: 'expense', icon: '✂️', parentId: 'cat_pets' },

// =====================================================================
// Fees & Charges
// =====================================================================
{ id: 'cat_fees', name: 'Fees & Charges', type: 'expense', icon: '💳', parentId: null },
{ id: 'sub_bank_fees', name: 'Bank / Account Fees', type: 'expense', icon: '🏦', parentId: 'cat_fees' },
{ id: 'sub_atm_fees', name: 'ATM Fees', type: 'expense', icon: '🏧', parentId: 'cat_fees' },
{ id: 'sub_late_fees', name: 'Late / Dishonour Fees', type: 'expense', icon: '⏰', parentId: 'cat_fees' },
{ id: 'sub_card_fees', name: 'Card Fees', type: 'expense', icon: '💳', parentId: 'cat_fees' },
{ id: 'sub_interest_charged', name: 'Interest Charged', type: 'expense', icon: '💲', parentId: 'cat_fees' },
{ id: 'sub_union_fees', name: 'Union / Membership Fees', type: 'expense', icon: '🪪', parentId: 'cat_fees' },
{ id: 'sub_legal_fees', name: 'Legal / Professional Fees', type: 'expense', icon: '⚖️', parentId: 'cat_fees' },

// =====================================================================
// Savings, Investments & Super
// =====================================================================
{ id: 'cat_savings', name: 'Savings, Investments & Super', type: 'expense', icon: '📈', parentId: null },
{ id: 'sub_emergency_fund', name: 'Emergency Fund', type: 'expense', icon: '🚑', parentId: 'cat_savings' },
{ id: 'sub_high_interest_savings', name: 'High Interest Savings', type: 'expense', icon: '🏦', parentId: 'cat_savings' },
{ id: 'sub_shares_etf', name: 'Shares / ETFs', type: 'expense', icon: '📊', parentId: 'cat_savings' },
{ id: 'sub_super_contributions', name: 'Super Contributions', type: 'expense', icon: '🏦', parentId: 'cat_savings' },

// =====================================================================
// Debt Repayments
// =====================================================================
{ id: 'cat_debt', name: 'Debt Repayments', type: 'expense', icon: '💸', parentId: null },
{ id: 'sub_car_loan', name: 'Car Loan', type: 'expense', icon: '🚗', parentId: 'cat_debt' },
{ id: 'sub_personal_loan', name: 'Personal Loan', type: 'expense', icon: '💵', parentId: 'cat_debt' },
{ id: 'sub_credit_card_payment', name: 'Credit Card Payment', type: 'expense', icon: '💳', parentId: 'cat_debt' },
{ id: 'sub_student_loan', name: 'Student Loan', type: 'expense', icon: '🎓', parentId: 'cat_debt' },

// =====================================================================
// Investment Property (kept separate from Housing since it's investment,
// not a living expense — matters for tax/reporting purposes)
// =====================================================================
{ id: 'cat_investment_property', name: 'Investment Property', type: 'expense', icon: '🏘️', parentId: null },
{ id: 'sub_inv_mortgage', name: 'Investment Mortgage', type: 'expense', icon: '💸', parentId: 'cat_investment_property' },
{ id: 'sub_property_management', name: 'Property Management Fees', type: 'expense', icon: '🏢', parentId: 'cat_investment_property' },
{ id: 'sub_land_tax', name: 'Land Tax', type: 'expense', icon: '🏛️', parentId: 'cat_investment_property' },
{ id: 'sub_inv_water_rates', name: 'Investment Water Rates', type: 'expense', icon: '💧', parentId: 'cat_investment_property' },
{ id: 'sub_inv_council_rates', name: 'Investment Council Rates', type: 'expense', icon: '📄', parentId: 'cat_investment_property' },
{ id: 'sub_property_maintenance', name: 'Property Maintenance', type: 'expense', icon: '🛠️', parentId: 'cat_investment_property' },

// =====================================================================
// Business
// =====================================================================
{ id: 'cat_business', name: 'Business', type: 'expense', icon: '💼', parentId: null },
{ id: 'sub_business_supplies', name: 'Supplies', type: 'expense', icon: '📦', parentId: 'cat_business' },
{ id: 'sub_business_equipment', name: 'Equipment', type: 'expense', icon: '🧰', parentId: 'cat_business' },
{ id: 'sub_business_meals', name: 'Meals', type: 'expense', icon: '🍽️', parentId: 'cat_business' },
{ id: 'sub_business_services', name: 'Professional Services', type: 'expense', icon: '🧾', parentId: 'cat_business' },
{ id: 'sub_business_software', name: 'Software & Hosting', type: 'expense', icon: '💻', parentId: 'cat_business' },
{ id: 'sub_business_marketing', name: 'Marketing', type: 'expense', icon: '📣', parentId: 'cat_business' },
{ id: 'sub_business_other', name: 'Other Business Expenses', type: 'expense', icon: '📦', parentId: 'cat_business' },

// =====================================================================
// Gifts & Donations
// =====================================================================
{ id: 'cat_gifts_donations', name: 'Gifts & Donations', type: 'expense', icon: '🎁', parentId: null },
{ id: 'sub_charities', name: 'Charities', type: 'expense', icon: '❤️', parentId: 'cat_gifts_donations' },
{ id: 'sub_gifts_given', name: 'Gifts Given', type: 'expense', icon: '🎁', parentId: 'cat_gifts_donations' },

// =====================================================================
// Transfers (kept separate & specific — tracked by which of your own
// accounts/people the money went to)
// =====================================================================
{ id: 'cat_transfers', name: 'Transfers', type: 'expense', icon: '🔄', parentId: null },
{ id: 'sub_transfer_savings', name: 'Transfer to Savings', type: 'expense', icon: '🔁', parentId: 'cat_transfers' },
{ id: 'sub_transfer_offset', name: 'Transfer to Offset Account', type: 'expense', icon: '🔁', parentId: 'cat_transfers' },
{ id: 'sub_transfer_inv_offset', name: 'Transfer to Investment Offset', type: 'expense', icon: '🔁', parentId: 'cat_transfers' },
{ id: 'sub_transfer_person', name: 'Transfer to Person', type: 'expense', icon: '🔁', parentId: 'cat_transfers' },
{ id: 'sub_general_transfer', name: 'General Transfer', type: 'expense', icon: '🔄', parentId: 'cat_transfers' },
{ id: 'sub_bpay', name: 'BPAY Payments', type: 'expense', icon: '💱', parentId: 'cat_transfers' },

// =====================================================================
// Tax
// =====================================================================
{ id: 'cat_tax', name: 'Tax', type: 'expense', icon: '🧾', parentId: null },
{ id: 'sub_personal_tax', name: 'Personal Tax', type: 'expense', icon: '💵', parentId: 'cat_tax' },
{ id: 'sub_business_tax', name: 'Business Tax', type: 'expense', icon: '🏢', parentId: 'cat_tax' },

// =====================================================================
// Cash
// =====================================================================
{ id: 'cat_cash', name: 'Cash', type: 'expense', icon: '💵', parentId: null },
{ id: 'sub_cash_withdrawal', name: 'Cash Withdrawal', type: 'expense', icon: '🏧', parentId: 'cat_cash' },
{ id: 'sub_cash_deposit', name: 'Cash Deposit', type: 'expense', icon: '💵', parentId: 'cat_cash' },

// =====================================================================
// Miscellaneous
// =====================================================================
{ id: 'cat_misc', name: 'Miscellaneous', type: 'expense', icon: '🧩', parentId: null },
{ id: 'sub_misc_items', name: 'Misc Items', type: 'expense', icon: '📦', parentId: 'cat_misc' },
{ id: 'sub_uncategorised', name: 'Uncategorised', type: 'expense', icon: '❓', parentId: 'cat_misc' },

];

export function shouldAddDefaultCategories(existingCategories) {
  return existingCategories.length === 0;
}

export async function addDefaultCategories(dbFunctions) {
  const { getAllItems, addItem, STORE_NAMES } = dbFunctions;

  const existingCategories = await getAllItems(STORE_NAMES.categories);
  const existingIds = existingCategories.map(c => c.id);

  let addedCount = 0;
  for (const category of DEFAULT_CATEGORIES) {
    if (!existingIds.includes(category.id)) {
      await addItem(STORE_NAMES.categories, {
        ...category,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      addedCount++;
    }
  }

  return addedCount;
}
