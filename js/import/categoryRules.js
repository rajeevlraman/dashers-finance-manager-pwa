// ============================================================================
// 🧠 categoryRules.js — Auto-category engine (Option C)
// ----------------------------------------------------------------------------
// Builds a lightweight keyword index from your existing categories and uses
// it to auto-assign categoryId for imported transactions.
// ============================================================================

import { logImportDebug } from './debug.js';

// Some words are too generic to be useful as category keywords
const GENERIC_WORDS = new Set([
  'expense', 'expenses', 'income', 'other', 'misc', 'miscellaneous',
  'general', 'uncategorised', 'uncategorized', 'bills', 'bill',
  // Bug fix: these describe the MECHANISM of a transaction (how/where it
  // happened), not its purpose, and they appear in near-universal bank
  // transaction boilerplate regardless of what the transaction is
  // actually for. A category named "Rent Payment" indexes "payment" as a
  // keyword (weight 4, since longer words score higher) - and "payment"
  // appears in almost every ANZ transaction ("ANZ MOBILE BANKING PAYMENT
  // TO ..."), so it was mass-matching personal transfers, salary
  // deposits, and BPAY bills to "Rent Payment" purely because they all
  // share the word "payment", regardless of actual purpose.
  'payment', 'payments', 'transfer', 'transfers', 'deposit', 'deposits',
  'banking', 'internet', 'mobile', 'online', 'direct', 'purchase', 'purchases',
  // Bug fix: found via real ANZ data - "TAX OFFICE PAYMENT" was matching
  // "Home Office Gear" because "office" is a subcategory-name fragment
  // shared by several unrelated categories, and "MBL CARD SERVICES" was
  // matching a bare "Services" category for the same reason (it's the
  // literal name of five different unrelated subcategories: Business,
  // Home, Legal, Cleaning, and Online Services).
  // Bug fix: found via real data - "TRANSFER FROM WESTERN UNION..." (a
  // genuine incoming payment) was matching the "Union / Membership Fees"
  // category purely because "union" is a whole word inside "Western
  // Union", the money-transfer company - nothing to do with union dues.
  // The real "teachers'/education union" case is already covered by an
  // explicit, more specific keyword rule in categoryMapper.js (which runs
  // before this generic fallback ever gets a chance), so dropping the
  // bare word here loses no real coverage.
  'union',
  'office', 'services'
]);

// Bug fix: matching used to be `desc.includes(keyword)`, a raw substring
// search. That let short keywords pulled from category names match
// completely unrelated transactions whenever the keyword happened to appear
// inside a longer word - e.g. a category named "2nd Car Service" indexes
// the keyword "car", which matched a BPAY credit-card payment described as
// "...MBL CARD SERVICES..." because "card" contains "car" and "services"
// contains "service". This checks for the keyword as a whole word instead,
// so "car" no longer matches inside "card", "cargo", "scared", etc.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWord(text, keyword) {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text);
}

// ----------------------------------------------------------------------------
// Build a keyword index from your categories
// ----------------------------------------------------------------------------
export function buildCategoryIndex(categories = []) {
  const index = [];

  categories.forEach(cat => {
    if (!cat || !cat.name) return;

    const isSub = !!cat.parentId;
    const baseWeight = isSub ? 3 : 1; // prefer subcategories

    const raw = String(cat.name).toLowerCase();

    const tokens = raw
      .split(/[^a-z0-9]+/i)
      .map(t => t.trim())
      .filter(t => t.length >= 3 && !GENERIC_WORDS.has(t));

    const uniqueTokens = new Set(tokens);

    uniqueTokens.forEach(word => {
      index.push({
        keyword: word,
        categoryId: cat.id,
        weight: baseWeight + (word.length >= 6 ? 1 : 0)
      });
    });
  });

  logImportDebug('buildCategoryIndex()', {
    categoryCount: categories.length,
    ruleCount: index.length
  });

  return index;
}

// ----------------------------------------------------------------------------
// Auto-assign a categoryId based on description & keyword index
// ----------------------------------------------------------------------------
export function autoAssignCategory(tx, categories = [], index = []) {
  // Do NOT override existing categoryId
  if (tx.categoryId) return tx.categoryId;

  const desc = (tx.categoryText || tx.description || '').toLowerCase().trim();
  if (!desc || !index.length) return null;

  // Collect scores per category
  const scores = new Map(); // categoryId -> score

  index.forEach(rule => {
    if (hasWholeWord(desc, rule.keyword)) {
      const prev = scores.get(rule.categoryId) || 0;
      scores.set(rule.categoryId, prev + rule.weight);
    }
  });

  if (scores.size === 0) return null;

  // Pick best scoring category, tie-breaker prefers subcategories
  let bestCatId = null;
  let bestScore = 0;

  scores.forEach((score, catId) => {
    if (score > bestScore) {
      bestScore = score;
      bestCatId = catId;
    } else if (score === bestScore && bestCatId) {
      const existing = categories.find(c => c.id === bestCatId);
      const candidate = categories.find(c => c.id === catId);

      if (candidate && candidate.parentId && !existing?.parentId) {
        bestCatId = catId; // prefer subcategory in tie
      }
    }
  });

  // Require at least a minimal confidence
  if (!bestCatId || bestScore < 2) {
    return null;
  }

  const chosen = categories.find(c => c.id === bestCatId);
  logImportDebug('autoAssignCategory(): chosen category', {
    txDescription: tx.description,
    categoryId: bestCatId,
    categoryName: chosen?.name,
    score: bestScore
  });

  return bestCatId;
}
