// merchantRules.js
// ------------------------------------------------------------
// Brand / merchant-specific rules (AFTER normalisation).
// These are precise "if merchant name contains X" → category rules.
// ------------------------------------------------------------

export const merchantRules = [
  // ========= GROCERIES =========
  {
    id: 'mal_vic_groceries',
    includesAny: ['MAL VIC PTY LTD', 'MAL VIC PTY'],
    categoryId: 'sub_supermarket',
    confidence: 0.9
  },
  {
    id: 'marketplace_fresh',
    includesAny: ['MARKETPLACE FRESH'],
    categoryId: 'sub_supermarket',
    confidence: 0.9
  },
  {
    id: 'coles',
    includesAny: ['COLES (CASEY CENTRAL)', 'COLES CASEY CENTRAL', 'COLES'],
    categoryId: 'sub_supermarket',
    confidence: 0.9
  },
  {
    id: 'woolworths',
    includesAny: ['WOOLWORTHS (CASEY CENTRAL)', 'WOOLWORTHS (THE AVENUE)', 'WOOLWORTHS THE AVENUE', 'WOOLWORTHS'],
    categoryId: 'sub_supermarket',
    confidence: 0.9
  },
  {
    id: 'iga',
    includesAny: ['IGA (CRANBOURNE NORTH)', 'IGA CRANBOURNE NORTH', 'IGA'],
    categoryId: 'sub_supermarket',
    confidence: 0.9
  },
  {
    id: 'bakers_delight',
    includesAny: ['BAKERS DELIGHT'],
    categoryId: 'sub_supermarket',
    confidence: 0.8
  },

  // ========= FAST FOOD / RESTAURANTS =========
  {
    id: 'kfc',
    includesAny: ['KFC', 'CRANBOURNE NORTHKFC', '1735CRANBOURNENORTHKFC'],
    categoryId: 'sub_fast_food',
    confidence: 0.95
  },
  {
    id: 'mcdonalds',
    includesAny: ['MCDONALD', 'MC DONALD'],
    categoryId: 'sub_fast_food',
    confidence: 0.95
  },
  {
    id: 'hungry_jacks',
    includesAny: ['HUNGRY JACK'],
    categoryId: 'sub_fast_food',
    confidence: 0.95
  },
  {
    id: 'doordash',
    includesAny: ['DOORDASH'],
    categoryId: 'sub_restaurants',
    confidence: 0.9
  },
  {
    id: 'ubereats',
    includesAny: ['UBER EATS'],
    categoryId: 'sub_restaurants',
    confidence: 0.9
  },
  {
    id: 'aangan',
    includesAny: ['AANGAN'],
    categoryId: 'sub_restaurants',
    confidence: 0.9
  },
  {
    id: 'cafe_flavorage',
    includesAny: ['CAFE FLAVORAGE'],
    categoryId: 'sub_restaurants',
    confidence: 0.8
  },
  {
    id: 'queens_kebab',
    includesAny: ['QUEENS KEBAB'],
    categoryId: 'sub_fast_food',
    confidence: 0.8
  },
  {
    id: 'dominos',
    includesAny: ['DOMINOS PIZZA'],
    categoryId: 'sub_fast_food',
    confidence: 0.9
  },

  // ========= FUEL =========
  {
    id: 'fuel_7eleven',
    includesAny: ['7-ELEVEN', '7 ELEVEN'],
    categoryId: 'sub_fuel',
    confidence: 0.95
  },
  {
    id: 'fuel_apco',
    includesAny: ['APCO'],
    categoryId: 'sub_fuel',
    confidence: 0.9
  },
  {
    id: 'fuel_united',
    includesAny: ['UNITED PETROLEUM'],
    categoryId: 'sub_fuel',
    confidence: 0.9
  },
  {
    id: 'fuel_bp',
    includesAny: ['BP (BERWICK', 'BP CLYDE', 'BP CLAYTON'],
    categoryId: 'sub_fuel',
    confidence: 0.9
  },
  {
    id: 'fuel_eg_group',
    includesAny: ['EG GROUP'],
    categoryId: 'sub_fuel',
    confidence: 0.9
  },

  // ========= TOLLS / PARKING =========
  {
    id: 'linkt',
    includesAny: ['LINKT'],
    categoryId: 'sub_tolls_parking',
    confidence: 0.95
  },
  {
    id: 'parking_point',
    includesAny: ['POINT PARKING', 'WILSON PARKING', 'PARKING (CASEY HOSPITAL', 'WESTFIELD', 'MONASHKINGSTON'],
    categoryId: 'sub_tolls_parking',
    confidence: 0.85
  },

  // ========= UTILITIES / INTERNET / PHONE =========
  {
    id: 'optus',
    includesAny: ['OPTUS'],
    categoryId: 'sub_mobile',
    confidence: 0.95
  },
  {
    id: 'origin',
    includesAny: ['ORIGIN BROADBAND'],
    categoryId: 'sub_mobile',
    confidence: 0.9
  },
  {
    id: 'superloop',
    includesAny: ['SUPERLOOP'],
    categoryId: 'sub_internet',
    confidence: 0.9
  },

  // ========= TECH / DIGITAL / SUBSCRIPTIONS =========
  {
    id: 'amazon_web_services',
    includesAny: ['AMAZON WEB SERVICES'],
    categoryId: 'sub_software_cloud',
    confidence: 0.95
  },
  {
    id: 'amazon_general',
    includesAny: ['AMAZON'],
    categoryId: 'sub_online_shopping',
    confidence: 0.7
  },
  {
    id: 'microsoft_store',
    includesAny: ['MICROSOFT STORE', 'MSBILL.INFO', 'MICROSOFT'],
    categoryId: 'sub_software_cloud',
    confidence: 0.8
  },
  {
    id: 'xbox_games',
    includesAny: ['MICROSOFT XBOX'],
    categoryId: 'sub_gaming',
    confidence: 0.9
  },
  {
    id: 'disney_plus',
    includesAny: ['DISNEY PLUS'],
    categoryId: 'sub_paytv',
    confidence: 0.95
  },
  {
    id: 'netflix_generic',
    includesAny: ['NETFLIX'],
    categoryId: 'sub_paytv',
    confidence: 0.95
  },
  {
    id: 'google_gsuite',
    includesAny: ['GOOGLE G SUITE'],
    categoryId: 'sub_software_cloud',
    confidence: 0.9
  },
  {
    id: 'apple_hardware',
    includesAny: ['APPLE', 'APPLE ONLINE STORE'],
    categoryId: 'sub_electronics',
    confidence: 0.9
  },
  {
    id: 'temu',
    includesAny: ['TEMU'],
    categoryId: 'sub_online_shopping',
    confidence: 0.8
  },

  // ========= INSURANCE =========
  {
    id: 'hannover_life',
    includesAny: ['HANNOVER RE LIFE INSURANCE'],
    categoryId: 'sub_home_ins',
    confidence: 0.95
  },
  {
    id: 'woolworths_insurance',
    includesAny: ['WOOLWORTHS INSURANCE'],
    categoryId: 'sub_car_insurance',
    confidence: 0.9
  },

  // ========= HEALTH =========
  {
    id: 'chemist_warehouse',
    includesAny: ['CHEMIST WAREHOUSE'],
    categoryId: 'sub_pharmacy',
    confidence: 0.95
  },
  {
    id: 'doctors_general',
    includesAny: ['MYHEALTH', 'DERMATOLO', 'ORTHO SPORTS', 'COLLABORATIVE ORTHO', 'AVENUE FAMILY MEDI'],
    categoryId: 'sub_gp',
    confidence: 0.8
  },
  {
    id: 'dentist',
    includesAny: ['DENTAL', 'DENTIST'],
    categoryId: 'sub_dental',
    confidence: 0.9
  },
  {
    id: 'ambulance',
    includesAny: ['AMBULANCE VICTORIA'],
    categoryId: 'sub_gp',
    confidence: 0.9
  },

  // ========= EDUCATION / TUITION =========
  {
    id: 'holmesglen',
    includesAny: ['HOLMESGLEN'],
    categoryId: 'sub_uni_fees',
    confidence: 0.9
  },
  {
    id: 'campion_education',
    includesAny: ['CAMPION EDUCATION'],
    categoryId: 'sub_books_courses',
    confidence: 0.9
  },

  // ========= CHARITY / DONATIONS =========
  {
    id: 'gofundme',
    includesAny: ['GOFUNDME'],
    categoryId: 'sub_charities',
    confidence: 0.95
  },
  {
    id: 'shivavishnu_temple',
    includesAny: ['SHRI SHIVA VISHNU TEM'],
    categoryId: 'sub_grooming',
    confidence: 0.95
  }
];

/**
 * Try to find a rule that matches this cleaned merchant string.
 * @param {string} cleanedMerchant - uppercased, normalised merchant text
 * @returns {object|null}
 */
export function findMerchantRule(cleanedMerchant) {
  if (!cleanedMerchant) return null;
  const text = cleanedMerchant.toUpperCase();

  for (const rule of merchantRules) {
    const { includesAny = [] } = rule;
    if (includesAny.some(keyword => text.includes(keyword))) {
      return rule;
    }
  }

  return null;
}
