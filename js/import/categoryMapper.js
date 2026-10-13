// ============================================================================
// categoryMapper.js
// Smart category engine for imported transactions
// - Uses: merchant rules, bank category mappings, keyword matching
// - Auto-learns merchant rules after repeated consistent matches
// ============================================================================

//To activate logo + category matching in your app, add line 10 to 29 here inside categoryMapper.js:

import { getMerchantLogo } from "./merchantLogos.js";
import { merchantCategories } from "./merchantCategories.js";

// Bug fix: this used to do `Object.keys(merchantLogos)` where
// merchantLogos is an ARRAY of { keywords: [...], logo } entries, not a
// plain object — Object.keys() on an array returns numeric indices
// ("0", "1", "2"...), so this never actually matched any real merchant. It
// was also never called anywhere in the app. Now it delegates to the
// correct, tested implementation in merchantLogos.js.
export function resolveMerchantLogo(cleanDesc) {
  return getMerchantLogo(cleanDesc);
}

export function resolveMerchantCategory(cleanDesc) {
  for (const key of Object.keys(merchantCategories)) {
    if (key !== 'default' && hasWholeWord(cleanDesc, key)) {
      return merchantCategories[key];
    }
  }
  return merchantCategories["default"];
}

// ---------------------------------------------------------------------------
// Transaction type / transfer semantics (bug fix)
// ---------------------------------------------------------------------------
// Bug fix: CSV import used to set tx.type purely from the sign of the raw
// bank-feed amount (see parser.js buildTxObject: amount > 0 -> "income").
// That's unreliable for any account that's a loan/redraw/offset facility -
// a genuine expense drawn from one (a BPAY bill, a builder payment, school
// fees) still posts as a *credit* there, because paying it down reduces
// the facility balance. It was showing up as "income" for school fees,
// home-building payments, BPAY bills, and plain interbank transfers alike.
//
// The fix: once a category has actually been resolved for a transaction,
// its own declared `type` (see defaultCategories.js) is a far stronger
// signal of what the transaction really was than the sign of the number on
// that one account's feed - so trust the category's type over the raw
// sign. Confirmed against the user's own category list: every category
// with type:'income' is one of the 11 Income categories (the 10
// subcategories under Income, plus Income itself) - everything else is
// type:'expense', including Transfers and all its children.
//
// General transfers, transfers to savings/offset/investment-offset/person,
// and loan draws/repayments are the one exception even to THAT: they
// aren't income OR expense at all - they're money moving between your own
// accounts (or a loan facility), and the rest of the app already knows
// this and excludes isTransfer:true rows from every Income/Expense total
// (see dashboard.js, budgets.js, financeOverview.js, financialDashboard.js,
// wealthOverview.js, quickLook.js, accounts.js) - but that flag was only
// ever set when a transfer is created manually inside the app (accounts.js,
// bills.js, recurringJob.js). CSV import never set it. BPAY is deliberately
// NOT in this set - it's how a bill gets paid, a real expense, not a
// transfer between your own accounts.
export const TRANSFER_ONLY_CATEGORY_IDS = new Set([
  'cat_transfers',
  'sub_transfer_savings',
  'sub_transfer_offset',
  'sub_transfer_inv_offset',
  'sub_transfer_person',
  'sub_general_transfer'
]);

// Bug fix: BPAY payments and "Credit Card Payment" rows were always
// treated as real expenses (see the comment above) - correct for a bill
// (land tax, school fees) but wrong for the ONE case where the "biller"
// is actually your own tracked credit card. Paying your card down is
// money moving between your own accounts, not spending, and should be
// excluded from Income/Expense totals the same way sub_transfer_* is.
//
// Two ways this shows up, both handled below:
//   - sub_credit_card_payment only ever exists because of the
//     "MBL CARD SERVICES"-style biller-name match in categoryRules.js -
//     there's no other case that lands here, so it's always a self-payment.
//   - sub_bpay is genuinely ambiguous (a real bill most of the time) -
//     only treated as a transfer when the transaction is a POSITIVE amount
//     landing on one of your own type:'credit' accounts, i.e. the payment
//     arriving on the card's own feed rather than a bill leaving a bank
//     account. A card purchase (negative, even on a credit account) still
//     counts as a real expense.
const CREDIT_CARD_PAYMENT_CATEGORY_IDS = new Set(['sub_bpay', 'sub_credit_card_payment']);

// Pure function: given a resolved categoryId, the full categories list, and
// the type parser.js already derived from the raw amount sign, returns the
// corrected { type, isTransfer } for that transaction. Doesn't mutate
// anything, so it's safe to use for both the actual save (saver.js) and the
// read-only import preview (modal.js) - both need the same answer, or the
// preview lies about what's about to be saved.
//
// context is optional ({ amount, accountType }) - callers that can supply
// it (saver.js, modal.js, the fixCreditCardTransfers self-heal scan) get
// the credit-card-payment transfer detection above; callers that can't
// (none currently) just fall back to the pre-existing category-type logic.
export function resolveTransactionSemantics(categoryId, rawType, categories = [], context = {}) {
  if (TRANSFER_ONLY_CATEGORY_IDS.has(categoryId)) {
    return { type: rawType, isTransfer: true };
  }

  if (CREDIT_CARD_PAYMENT_CATEGORY_IDS.has(categoryId)) {
    const isOwnCardRepayment = categoryId === 'sub_credit_card_payment' ||
      (context.accountType === 'credit' && (context.amount ?? 0) > 0);
    if (isOwnCardRepayment) {
      return { type: rawType, isTransfer: true };
    }
  }

  const category = categories.find(c => c.id === categoryId);
  if (category && (category.type === 'income' || category.type === 'expense')) {
    return { type: category.type, isTransfer: false };
  }

  // No category resolved (or it has no recognized type) - nothing better
  // to go on than the raw sign.
  return { type: rawType, isTransfer: false };
}

// ---------------------------------------------------------------------------
// Property auto-matching (bug fix / feature)
// ---------------------------------------------------------------------------
// Property expenses and rental income sat as ordinary, unlinked
// transactions forever - the Expenses page's "Sync from Transactions"
// button only ever picks up rows already manually tagged
// isPropertyExpense:true + propertyId, and nothing set those during
// import, so every property transaction needed hand-tagging one at a time.
//
// Real bank data for rent typically includes the property's street address
// right in the description (e.g. a managing agent's deposit description:
// "17 Averne Street C Ray White Cranbo ..."), so matching on that is a
// strong, low-false-positive signal - much stronger than trying to match
// on category alone (property expense categories like "Legal Fees" or
// "Travel" are shared with plenty of non-property spending, so category
// alone would misfire constantly).
const STREET_TYPE_ALIASES = {
  street: 'st', st: 'st',
  road: 'rd', rd: 'rd',
  avenue: 'ave', ave: 'ave', av: 'ave',
  drive: 'dr', dr: 'dr',
  court: 'ct', ct: 'ct',
  place: 'pl', pl: 'pl',
  lane: 'ln', ln: 'ln',
  crescent: 'cres', cres: 'cres',
  boulevard: 'blvd', blvd: 'blvd',
  terrace: 'tce', tce: 'tce',
  parade: 'pde', pde: 'pde',
  close: 'cl'
};

function normalizeAddressText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => STREET_TYPE_ALIASES[word] || word)
    .join(' ');
}

// "123 Main St, Melbourne VIC 3000" -> "123 Main St" - the suburb/state/
// postcode after the first comma is unlikely to appear verbatim in a bank
// description and just adds noise to the match.
function streetPortion(address) {
  return (address || '').split(',')[0].trim();
}

// Returns the single best-matching property for a transaction's
// description, or null. Deliberately conservative: only a real street
// number + street name match counts, so an unrelated transaction that
// happens to share one common word with an address won't match.
export function matchPropertyForTransaction(tx, properties = []) {
  const haystack = normalizeAddressText(tx.description || tx.rawDescription || '');
  if (!haystack) return null;

  for (const property of properties) {
    const needle = normalizeAddressText(streetPortion(property.address));
    // Require at least "<number> <name>" (2+ tokens) so a one-word street
    // name paired with a common number ("1", "2"...) can't match on its own.
    if (needle && needle.split(' ').length >= 2 && haystack.includes(needle)) {
      return property;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Property matching, signal #2: dedicated account link
// ---------------------------------------------------------------------------
// Address matching above only ever fires for the rare transaction that
// happens to spell out the property's street in the bank description — in
// practice almost none do (a council rates direct debit, a landlord
// insurance premium, a property manager's fee statement, a tradesperson's
// invoice all just show the payee's name). For a portfolio with more than
// one property, the type of expense (rates/insurance/utilities/repairs)
// can't disambiguate WHICH property either, since the same category covers
// all of them.
//
// The reliable signal available in this app is the bank ACCOUNT the
// transaction came through. Many landlords keep a dedicated loan and/or
// transaction account per property (this is standard practice for keeping
// ATO-deductible interest and expenses cleanly separated) — see
// account.linkedPropertyId, set on the Accounts page. Where that's set,
// every transaction on that account belongs to that property, full stop —
// no per-transaction guessing needed. This is deliberately NOT exclusive
// with a property having more than one linked account (e.g. an original
// loan plus a later equity-release/redraw loan drawn against the same
// property) — both accounts can carry the same linkedPropertyId.
export function matchPropertyByAccount(tx, accounts = [], properties = []) {
  if (!tx || !tx.accountId) return null;
  const account = accounts.find(a => a.id === tx.accountId);
  if (!account || !account.linkedPropertyId) return null;
  return properties.find(p => p.id === account.linkedPropertyId) || null;
}

// ---------------------------------------------------------------------------
// Property matching, signal #3: learned merchant+account rules, with
// amount-based disambiguation
// ---------------------------------------------------------------------------
// For anyone whose property expenses run through a SHARED account rather
// than a dedicated one per property (e.g. one everyday account pays the
// council, the insurer, and the property manager for every property), an
// account link alone can't disambiguate. Mirrors the existing merchant ->
// category auto-learn approach: once a person manually tags a transaction
// from a given merchant, on a given account, as belonging to a specific
// property (or explicitly NOT a property expense, e.g. their own home),
// that combination is remembered for next time.
//
// Deliberately scoped to merchant+account together, not merchant alone —
// the same managing agent often handles more than one property, and if
// their rent deposits land in different accounts per property, the account
// is exactly what disambiguates them.
//
// Bug fix / feature: the exact same biller regularly serves more than one
// property (e.g. one council or water corp covering several suburbs, or a
// water/insurance/rates provider that also bills the person's own home) -
// confirmed with user this is the common case, not the exception. The old
// version of this rule could only ever remember ONE property per
// merchant+account and flagged everything else "ambiguous", permanently
// giving up on auto-matching for that biller. Now it remembers one rule
// PER property (propertyId: null stands for "confirmed not a property
// expense"), plus a rolling window of the amounts seen for each - a
// recurring bill for one property tends to land in a fairly narrow band
// each period (indexed rates, similar seasonal usage), while a different
// property/home on the same biller usually differs more than that. See
// resolveLearnedPropertyMatch() below for exactly how ties are broken.
const PROPERTY_RULES_STORAGE_KEY = 'dfm_property_merchant_rules_v1';
let propertyRules = [];

// How many past amounts to remember per rule - enough to smooth out a
// season's water-usage swing or a rates indexation bump without the array
// growing forever.
const MAX_REMEMBERED_AMOUNTS = 8;
// A candidate has to be within this fraction of at least one remembered
// amount to be considered a match at all.
const AMOUNT_MATCH_TOLERANCE = 0.25;
// When more than one property (or "home") shares a merchant+account, the
// best-matching candidate must be at least this much closer than the
// runner-up to auto-apply. A same-biller, similarly-priced bill for two
// properties is exactly the case that should fall through to manual
// tagging rather than a coin-flip guess.
const AMOUNT_MATCH_MARGIN = 0.5;

function loadPropertyRulesFromStorage() {
  try {
    const raw = localStorage.getItem(PROPERTY_RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Migrates rules saved by the old single-rule-per-merchant+account
    // format (no `amounts` array, `propertyId` always truthy, an
    // `ambiguous` flag) - those still load fine, they just start with no
    // remembered amounts, which is harmless: a merchant+account with only
    // one rule for it still matches unconditionally regardless of amount
    // (see resolveLearnedPropertyMatch). The old `ambiguous` flag is no
    // longer used and is simply dropped.
    return parsed
      .filter(r => r && r.merchantKey && r.accountId)
      .map(r => ({
        merchantKey: r.merchantKey,
        accountId: r.accountId,
        propertyId: r.propertyId === undefined ? null : r.propertyId,
        amounts: Array.isArray(r.amounts) ? r.amounts.slice(-MAX_REMEMBERED_AMOUNTS) : [],
        // References are exact identifiers, not a rolling sample like
        // amounts, so every one ever taught is kept (capped generously
        // just as a sanity bound, not a "recent window" like amounts).
        references: Array.isArray(r.references) ? r.references.slice(-50) : [],
        hitCount: typeof r.hitCount === 'number' ? r.hitCount : 1,
        lastUsed: r.lastUsed || null
      }));
  } catch (err) {
    console.warn('[CategoryMapper] Failed to load property rules from storage', err);
    return [];
  }
}

function savePropertyRulesToStorage() {
  try {
    localStorage.setItem(PROPERTY_RULES_STORAGE_KEY, JSON.stringify(propertyRules));
  } catch (err) {
    console.warn('[CategoryMapper] Failed to save property rules to storage', err);
  }
}

export function initPropertyMapper() {
  propertyRules = loadPropertyRulesFromStorage();
}

export function getPropertyRules() {
  return [...propertyRules];
}

export function clearLearnedPropertyRules() {
  const count = propertyRules.length;
  propertyRules = [];
  try {
    localStorage.removeItem(PROPERTY_RULES_STORAGE_KEY);
  } catch (err) {
    console.warn('[CategoryMapper] Failed to clear property rules from storage', err);
  }
  return count;
}

function propertyRuleKey(tx) {
  const merchantKey = normaliseKey(tx.merchant) || normaliseKey(tx.cleanDescription || tx.description);
  if (!merchantKey || !tx.accountId) return null;
  return { merchantKey, accountId: tx.accountId };
}

function candidateRulesForKey(key) {
  return propertyRules.filter(r => r.merchantKey === key.merchantKey && r.accountId === key.accountId);
}

// Smallest relative distance between tx's amount and any amount previously
// remembered for this rule. Returns null (not Infinity) when the rule has
// no remembered amounts at all, so callers can tell "no signal" apart from
// "signal, but far off".
function closestAmountDistance(rule, txAmount) {
  if (!rule.amounts || !rule.amounts.length) return null;
  let best = null;
  for (const a of rule.amounts) {
    if (!a) continue;
    const dist = Math.abs(txAmount - a) / a;
    if (best === null || dist < best) best = dist;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Payment reference extraction — a stronger property-disambiguation signal
// than amount when two properties' bills from the same biller are close in
// value (e.g. council rates or insurance premiums on similarly-valued
// properties often land within a few dollars of each other, which is
// exactly where amount-based matching below gives up as "too close to
// call"). A BPAY customer reference number is tied to one specific
// account/policy/rates assessment and stays exact and distinct per
// property even when the dollar amount doesn't.
//
// ANZ's BPAY lines wrap it in curly braces, e.g. "ANZ INTERNET BANKING
// BPAY SROVIC LAND TAX {822746}". Falls back to a trailing long digit run
// for formats that don't use braces - only tried when nothing more
// explicit is present, since a bare trailing number is a weaker signal
// (could be a suburb postcode or similar).
// ---------------------------------------------------------------------------
export function extractPaymentReference(rawDescription) {
  if (!rawDescription) return null;
  const braced = rawDescription.match(/\{(\d{3,})\}/);
  if (braced) return braced[1];
  const trailing = rawDescription.trim().match(/(\d{5,})\s*$/);
  if (trailing) return trailing[1];
  return null;
}

// Core resolver shared by findLearnedPropertyForTransaction() and
// isConfirmedNonPropertyExpense(). Returns { matched:false } when nothing
// applies, or { matched:true, propertyId } where propertyId is either a
// real property id or null (confidently learned as NOT a property expense
// - e.g. this exact biller+amount was previously corrected because it was
// actually a bill for the person's own home).
export function resolveLearnedPropertyMatch(tx) {
  const key = propertyRuleKey(tx);
  if (!key) return { matched: false };

  const candidates = candidateRulesForKey(key);
  if (!candidates.length) return { matched: false };

  // Only one property (or "home") has ever been taught for this exact
  // merchant+account - it wins outright, regardless of amount. This is
  // the common case (a dedicated managing agent/insurer/council for a
  // single property) and bill amounts routinely drift with
  // usage/indexation, so requiring a close amount match here would just
  // break the easy case for no benefit.
  //
  // Caveat surfaced to callers via `basis`/`amountDeviation`: this branch
  // cannot tell "dedicated biller for one property" apart from "biller
  // that actually serves more than one property/home, but only one side
  // has been manually taught so far" - a real case (e.g. one water corp
  // billing two properties on the same account, where only one has ever
  // been hand-corrected). It still auto-applies either way, but flags a
  // large deviation from every previously seen amount so review tools
  // (propertyMatchTool.js) can warn instead of silently trusting it.
  if (candidates.length === 1) {
    const dist = closestAmountDistance(candidates[0], Math.abs(Number(tx.amount) || 0));
    return {
      matched: true,
      propertyId: candidates[0].propertyId,
      basis: 'single-rule',
      amountDeviation: dist
    };
  }

  // Reference-number disambiguation, tried before amount. A BPAY customer
  // reference is exact and per-account, so it settles cases amount alone
  // can't - e.g. two properties' council rates or insurance both billing
  // ~$950 this quarter, which the amount check below would correctly
  // refuse to guess between.
  const txRef = extractPaymentReference(tx.rawDescription);
  if (txRef) {
    const refMatches = candidates.filter(r => r.references && r.references.includes(txRef));
    // Only trust this when exactly one candidate has ever seen this
    // reference - if more than one somehow has (shouldn't normally
    // happen), that's a sign the reference isn't as unique as assumed
    // here, so fall through to amount instead of guessing.
    if (refMatches.length === 1) {
      return { matched: true, propertyId: refMatches[0].propertyId, basis: 'reference-match' };
    }
  }

  // More than one property/home shares this exact biller+account - amount
  // is the only signal left. Score every candidate by how close the new
  // transaction's amount is to what's been seen for it before.
  const txAmount = Math.abs(Number(tx.amount) || 0);
  const scored = candidates
    .map(rule => ({ rule, dist: closestAmountDistance(rule, txAmount) }))
    .filter(s => s.dist !== null && s.dist <= AMOUNT_MATCH_TOLERANCE)
    .sort((a, b) => a.dist - b.dist);

  if (!scored.length) return { matched: false };
  if (scored.length === 1) return { matched: true, propertyId: scored[0].rule.propertyId, basis: 'amount-match' };

  const [best, runnerUp] = scored;
  if (best.dist <= runnerUp.dist * AMOUNT_MATCH_MARGIN) {
    return { matched: true, propertyId: best.rule.propertyId, basis: 'amount-match' };
  }
  // Too close to call (e.g. near-identical rates bills for two similarly
  // valued properties) - leave it for manual tagging rather than guess.
  return { matched: false };
}

// Looks up a previously-learned property for this merchant+account
// combination (see resolveLearnedPropertyMatch above for how ties between
// more than one property/home are broken). Returns null if nothing
// confidently applies.
export function findLearnedPropertyForTransaction(tx, properties = []) {
  const result = resolveLearnedPropertyMatch(tx);
  if (!result.matched || !result.propertyId) return null;
  return properties.find(p => p.id === result.propertyId) || null;
}

// Like resolveLearnedPropertyMatch, but for callers (propertyMatchTool.js)
// that want to warn the person before auto-applying a match rather than
// just silently using it. Only the 'single-rule' basis needs a warning -
// it's the one case where the property was chosen without any amount
// check at all. AMOUNT_MATCH_TOLERANCE is reused as the deviation
// threshold so "large deviation" means the same thing here as it does for
// the multi-candidate amount comparison.
export function getLearnedPropertyMatchWarning(tx) {
  const result = resolveLearnedPropertyMatch(tx);
  if (!result.matched || result.basis !== 'single-rule') return null;
  if (result.amountDeviation === null || result.amountDeviation === undefined) {
    return 'Only one property has been taught for this biller — not yet verified by amount.';
  }
  if (result.amountDeviation > AMOUNT_MATCH_TOLERANCE) {
    return `Only one property has been taught for this biller, and this amount differs ${Math.round(result.amountDeviation * 100)}% from what's been seen before for it — double-check this isn't actually a different property.`;
  }
  return null;
}

// True when this exact merchant+account (and, if it shares the biller with
// a property, this amount) was previously confirmed to NOT be a property
// expense - e.g. the same water corp also bills the person's own home.
// Lets saver.js/propertyMatchTool.js skip weaker fallback signals (like
// address text matching) instead of risking a false positive on something
// already corrected once.
export function isConfirmedNonPropertyExpense(tx) {
  const result = resolveLearnedPropertyMatch(tx);
  return result.matched && result.propertyId === null;
}

// Call when a person manually assigns a property to a transaction, or
// manually confirms a transaction is NOT a property expense
// (propertyId: null) after the app had auto-flagged it as one (see
// transactions.js form save handler). Records the amount alongside the
// merchant+account+property combination, so that if this exact biller ever
// turns out to serve more than one property (or a property AND the
// person's own home), future imports can tell them apart by how much each
// one typically bills - see resolveLearnedPropertyMatch above.
export function learnPropertyForTransaction(tx, propertyId) {
  const key = propertyRuleKey(tx);
  if (!key || propertyId === undefined) return;

  const amount = Math.abs(Number(tx.amount) || 0);
  let existing = propertyRules.find(
    r => r.merchantKey === key.merchantKey && r.accountId === key.accountId && r.propertyId === propertyId
  );

  if (!existing) {
    existing = {
      merchantKey: key.merchantKey,
      accountId: key.accountId,
      propertyId,
      amounts: [],
      references: [],
      hitCount: 0,
      lastUsed: null
    };
    propertyRules.push(existing);
  }

  existing.hitCount = (existing.hitCount || 0) + 1;
  existing.lastUsed = new Date().toISOString();
  if (amount > 0) {
    existing.amounts = [...existing.amounts, amount].slice(-MAX_REMEMBERED_AMOUNTS);
  }
  const ref = extractPaymentReference(tx.rawDescription);
  if (ref) {
    existing.references = existing.references || [];
    if (!existing.references.includes(ref)) {
      existing.references = [...existing.references, ref].slice(-50);
    }
  }

  savePropertyRulesToStorage();
}


// Where we persist auto-learned merchant rules
const LOCAL_STORAGE_KEY = 'dfm_category_rules_v1';

// In-memory rule list
let merchantRules = [];

// Auto-learn threshold (how many consistent matches before we save a rule)
const AUTO_LEARN_THRESHOLD = 3;

// For counting repeated matches during a session
// key = `${field}:${pattern}:${categoryId}`
const pendingStats = {};

// ---------------------------------------------------------------------------
// Normalisation helpers (must be consistent with parser.js behaviour)
// ---------------------------------------------------------------------------
function normaliseKey(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bug fix: every keyword match in this file used to be a raw substring
// check (text.includes(keyword)), which lets a short or generic keyword
// match inside an unrelated longer word - e.g. "food" inside "seafood", or
// "car" inside "card". This checks for the keyword as a whole word/phrase
// instead, using \b boundaries, so it only matches when the keyword isn't
// glued to other letters.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWord(text, keyword) {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text);
}

// ---------------------------------------------------------------------------
// LocalStorage load/save
// ---------------------------------------------------------------------------
function loadRulesFromStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(r => ({
      pattern: r.pattern || '',
      field: r.field || 'merchant',
      categoryId: r.categoryId,
      confidence: typeof r.confidence === 'number' ? r.confidence : 1,
      hitCount: typeof r.hitCount === 'number' ? r.hitCount : 0,
      lastUsed: r.lastUsed || null
    })).filter(r => r.pattern && r.categoryId);
  } catch (err) {
    console.warn('[CategoryMapper] Failed to load rules from storage', err);
    return [];
  }
}

function saveRulesToStorage() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merchantRules));
  } catch (err) {
    console.warn('[CategoryMapper] Failed to save rules to storage', err);
  }
}

// ---------------------------------------------------------------------------
// Public: Initialise mapper (call once at app startup)
// ---------------------------------------------------------------------------
export function initCategoryMapper() {
  merchantRules = loadRulesFromStorage();
  initPropertyMapper();
}

// Optional: for debugging in your debug console
export function getMerchantRules() {
  return [...merchantRules];
}

// Wipes every auto-learned merchant rule (both genuinely manual corrections
// and the old self-cached keyword/bank-category echoes described above).
// Needed because rules already saved to localStorage before that fix are
// still sitting there and will keep overriding correct keyword matches
// until cleared - there's no way to tell a "good" learned rule apart from
// a "poisoned" one after the fact, since both were stored in the exact
// same format. After calling this, run "Review & Fix Transaction
// Categories" to re-categorize everything using the current (fixed)
// keyword rules; any genuine manual corrections you made will simply be
// re-learned again the normal way after 3 repeats.
export function clearLearnedMerchantRules() {
  const count = merchantRules.length;
  merchantRules = [];
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch (err) {
    console.warn('[CategoryMapper] Failed to clear rules from storage', err);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Rule finders
// ---------------------------------------------------------------------------
function findMerchantRuleForTransaction(tx) {
  if (!tx) return null;

  const merchantKey = normaliseKey(tx.merchant);
  const descKey = normaliseKey(tx.cleanDescription || tx.description);

  // Prioritise merchant-based rules first
  let bestRule = null;

  for (const rule of merchantRules) {
    const rulePattern = rule.pattern;
    if (!rulePattern) continue;

    if (rule.field === 'merchant') {
      if (!hasWholeWord(merchantKey, rulePattern)) continue;
    } else if (rule.field === 'description') {
      if (!hasWholeWord(descKey, rulePattern)) continue;
    } else {
      continue;
    }

    if (
      !bestRule ||
      (rule.confidence || 1) > (bestRule.confidence || 1) ||
      (rule.hitCount || 0) > (bestRule.hitCount || 0)
    ) {
      bestRule = rule;
    }
  }

  return bestRule;
}

// ---------------------------------------------------------------------------
// Bank category → categoryId mappings
// (NAB-specific strings + generic fallbacks)
// ---------------------------------------------------------------------------
const GENERIC_BANK_CATEGORY_MAP = {
  // Common high-level concepts
  'groceries': 'cat_groceries',
  'supermarket': 'sub_supermarket',
  'food': 'cat_groceries',
  'dining': 'cat_dining',
  'restaurants': 'cat_dining',
  'subscriptions': 'cat_entertainment',
  'fast food': 'cat_dining',
  'takeaway': 'cat_dining',
  // Bug fix: Macquarie's own CSV "Category" column uses "Food & Drink"
  // as a single combined label for cafes/takeaway/restaurants (see the
  // real sample row in this project's tests, where KFC is filed under
  // "Food & Drink"). Without this, the bare 'food' key below matched
  // first and mapped it to Groceries instead — see the length-sort
  // fix in resolveBankCategory() that makes this take priority.
  'food & drink': 'cat_dining',
  'food and drink': 'cat_dining',

  'medical': 'cat_health',
  'health': 'cat_health',

  'fuel': 'sub_fuel',
  'petrol': 'sub_fuel',
  'transport': 'cat_transport',
  // Bug fix: Macquarie's own CSV category column uses "Transportation",
  // which never matched the 'transport' key above for the same reason
  // "transfers" never matched "transfer" - there's no word boundary
  // between "transport" and the "ation" that follows it.
  'transportation': 'cat_transport',
  'tolls': 'sub_tolls_parking',
  'parking': 'sub_tolls_parking',
  'public transport': 'sub_public_transport',
  'transit': 'sub_public_transport',

  'insurance': 'cat_insurance',
  'home insurance': 'sub_home_ins',
  'car insurance': 'sub_car_insurance',
  'life insurance': 'sub_life_ins',
  'health insurance': 'sub_health_insurance',

  'utilities': 'cat_utilities',
  'electricity': 'sub_electricity',
  'gas': 'sub_gas',
  'water': 'sub_water_usage',
  'internet': 'sub_internet',
  'phone': 'sub_mobile',

  'education': 'cat_education',
  'school fees': 'sub_school_fees',
  'university': 'sub_uni_fees',

  'fees': 'cat_fees',
  'charges': 'cat_fees',

  'rent': 'sub_rent_payment',
  'mortgage': 'sub_mortgage_home',

  'travel': 'cat_travel',
  'flights': 'sub_flights',
  'accommodation': 'sub_accommodation',

  'savings': 'cat_savings',
  'investment': 'sub_shares_etf',
  'loan repayment': 'cat_debt',

  // Bug fix: NAB's own CSV "Category" column commonly says "Transfers
  // out"/"Transfers in" (see the real sample row in this project's
  // tests), which had no entry here, so every NAB transfer fell all the
  // way through to keyword matching (no match either) and then the
  // fallback — despite the bank having told us exactly what it was.
  'transfer': 'sub_general_transfer',
  // Bug fix: the bare 'transfer' key above never actually matched NAB's
  // real "Transfers in" / "Transfers out" labels, because whole-word
  // matching requires a boundary right after "transfer" - "transfers"
  // has an "s" glued straight on, so there's no boundary there. Adding
  // the plural forms explicitly (found in real NAB export data) instead
  // of trying to make "transfer" match its own plural.
  'transfers in': 'sub_general_transfer',
  'transfers out': 'sub_general_transfer',

  // Bug fix: also found in real NAB export data with no mapping at all,
  // so every ATM withdrawal and grooming/salon expense fell through to
  // "Uncategorised" despite NAB's own category column saying exactly
  // what they were.
  'cash': 'sub_cash_withdrawal',
  'personal care': 'sub_grooming'
};

const BANK_CATEGORY_MAP_BY_BANK = {
  // You can expand specific bank mappings here
  nab: {
    'groceries': 'cat_groceries',
    'supermarket': 'sub_supermarket',
    // Confirmed with user from real NAB export data.
    'gambling': 'sub_gambling',
    'electronics & technology': 'sub_electronics',
    'medical': 'cat_health',
    'health': 'cat_health',
    'fuel': 'sub_fuel',
    'petrol': 'sub_fuel',
    'transport': 'cat_transport',
    'tolls': 'sub_tolls_parking',
    'parking': 'sub_tolls_parking',
    'insurance': 'cat_insurance',
    'electricity': 'sub_electricity',
    'gas': 'sub_gas',
    'water': 'sub_water_usage',
    'internet': 'sub_internet',
    'phone': 'sub_mobile',
    'education': 'cat_education',
    'fees': 'cat_fees',
    'rent': 'sub_rent_payment',
    'mortgage': 'sub_mortgage_home',
    // Found in real NAB data: NAB's own label already tells us this
    // precisely, no need to guess from the merchant name.
    'restaurants & takeaway': 'sub_restaurants'
    // etc.
  },

  // Confirmed with user against real Macquarie export data. Keys here are
  // Macquarie's Subcategory column values (see the parser.js change that
  // now prefers Subcategory over the generic parent Category), scoped to
  // this bank specifically since some of these words (e.g. "services") are
  // too generic to risk applying to every bank's vocabulary.
  macquarie: {
    'groceries': 'cat_groceries',
    'fast food': 'sub_fast_food',
    'restaurants': 'cat_dining',
    'fuel': 'sub_fuel',
    // Confirmed with user: Public Transit here is really about vehicle
    // registration (the one real example was "Department of Transport"),
    // not train/bus fares.
    'public transit': 'sub_rego',
    'phone': 'sub_mobile',
    // No generic "Streaming" category exists (only provider-specific ones
    // like Netflix/Disney/Prime) and "Pay TV" doesn't tell us which
    // provider, so this goes to the generic Subscriptions category rather
    // than guessing a specific streaming service.
    'pay tv': 'cat_entertainment',
    'bpay payments': 'sub_bpay',
    'bpay payment reversals': 'sub_bpay',
    'annual cardholder fees': 'cat_fees',
    'hardware': 'sub_electronics',
    // Found via a full scan of real Macquarie category labels: these had
    // no mapping at all, so every transaction under them (439 in one real
    // export) fell all the way through to the generic Misc Items fallback
    // despite the bank already telling us exactly what they were.
    'charities': 'sub_charities',
    'clothing': 'sub_clothing',
    'shoes': 'sub_clothing',
    'furnishings': 'sub_home_furnishings',
    'doctor': 'sub_gp',
    'dentist': 'sub_dental',
    'pharmacies': 'sub_pharmacy',
    // Donations to a place of worship map alongside other donations.
    'religion': 'sub_charities',
    'music': 'sub_music_subs',
    'auto supplies': 'sub_car_service',
    'games': 'sub_gaming',
    'cleaning services': 'sub_household_supplies',
    'tours & cruises': 'sub_tours',
    'movies': 'sub_events_movies',
    'sporting events': 'sub_events_movies',
    'software': 'sub_software_cloud',
    'beauty': 'sub_grooming',
    'dance': 'sub_hobbies',
    'family & attractions': 'sub_kids_activities',
    'accounting': 'sub_business_services',
    'jewellery': 'sub_general_retail',
    'taxis': 'sub_rideshare_taxi',
    'gifts': 'sub_gifts',
    'alcohol & bars': 'sub_alcohol_bars',
    'books & news': 'sub_books_courses',
    'stationery': 'sub_books_courses',
    'uncategorised': 'sub_uncategorised',
    // Too broad/mixed to map to one specific subcategory precisely, but
    // still map to the right top-level category rather than nothing.
    'other personal expenses': 'cat_personal',
    'other home expenses': 'cat_housing',
    'other leisure expenses': 'cat_entertainment',
    'other financials': 'cat_fees',
    'entertainment': 'cat_entertainment',
    'fun': 'cat_entertainment',
    // Too ambiguous to guess a specific category (could be a fine,
    // license, rates notice, etc.) - explicit Misc rather than silently
    // falling through several layers to reach the same place.
    'government': 'sub_misc_items'
    // "Services" is deliberately left unmapped - confirmed with user this
    // one specifically mixes Amazon, union dues, Kmart, CoreLogic under
    // the same subcategory, so it's too mixed to map as a whole; left to
    // per-merchant matching instead.
  }
};

// Resolve bank category to a categoryId
function resolveBankCategory(bankCategoryRaw, opts = {}) {
  if (!bankCategoryRaw) return null;
  const bankId = (opts.bankId || '').toLowerCase();
  const raw = bankCategoryRaw.toLowerCase().trim();

  const bankMap = BANK_CATEGORY_MAP_BY_BANK[bankId] || {};
  // Bug fix: this used to check keys in plain object insertion order, so
  // a short generic key (e.g. "food") could match — and win — before a
  // more specific, more correct phrase (e.g. "food & drink", "fast
  // food") ever got checked, even though the more specific phrase was
  // right there in the list. Sorting longest-first means the most
  // specific applicable phrase always wins.
  const allKeys = [
    ...Object.keys(bankMap),
    ...Object.keys(GENERIC_BANK_CATEGORY_MAP)
  ].sort((a, b) => b.length - a.length);

  for (const key of allKeys) {
    if (!key) continue;
    if (hasWholeWord(raw, key)) {
      return bankMap[key] || GENERIC_BANK_CATEGORY_MAP[key] || null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Keyword → categoryId matching
// Uses cleanDescription / merchant keyword matches
// ---------------------------------------------------------------------------
const KEYWORD_CATEGORY_MAP = [
  // ---- Indian merchants & Indian-bank wording (Canara etc.) ------------------
  // Statements from an Indian bank are full of UPI/IMPS lines whose merchants the
  // Australian rules below never see. These use the same category ids as the
  // existing rules (sub_mobile, cat_dining, cat_groceries, ...). Deliberately
  // conservative: person-to-person UPI payments and "MB/" mobile-banking
  // transfers can't be guessed from the text, so they are left uncategorised
  // for the person to teach once (the app then learns that merchant).
  { pattern: /\bairte(?:l)?\b|\bjio\b(?!\s*mart)|\bbsnl\b|vodafone\s*idea/gi, categoryId: 'sub_mobile' },
  { pattern: /\bswiggy\b|\bzomato\b|\beatsure\b/gi, categoryId: 'cat_dining' },
  { pattern: /\bbigbasket\b|\bblinkit\b|\bzepto\b|\bdmart\b|\bd-mart\b|\bjio\s*mart\b|\bjiomart\b|\binstamart\b|\breliance\s+fresh\b/gi, categoryId: 'cat_groceries' },
  { pattern: /\birctc\b|\bredbus\b|\bbmtc\b|\bbmrcl\b/gi, categoryId: 'sub_public_transport' },
  { pattern: /\brapido\b|\bnamma\s*yatri\b|\buber\b(?!\s*eats)/gi, categoryId: 'sub_rideshare_taxi' },
  { pattern: /\bflipkart\b|\bmyntra\b|\bajio\b|\bmeesho\b|\bnykaa\b/gi, categoryId: 'sub_online_shopping' },
  { pattern: /book\s*bureau|\bbook\s*(?:store|house|stall)s?\b/gi, categoryId: 'sub_books_courses' },
  { pattern: /\bsms\s+charges\b|\bservice\s+charges?\b|\bannual\s+(?:maintenance|fee)\b|non[-\s]?maintenance/gi, categoryId: 'sub_bank_fees' },
  { pattern: /\bcheque\s+withdrawal\b|\bcash\s+withdrawal\b/gi, categoryId: 'sub_cash_withdrawal' },
  // Groceries & supermarkets
  // Bug fix: these three used to be bundled into one pattern pointing at
  // the generic Groceries & Household category, even though the user has
  // dedicated Coles/Aldi/Safeway categories that were sitting completely
  // unused as a result. Split out so each brand with its own category
  // reaches it, matching the same approach as the KFC/McDonald's split
  // below. Woolworths and IGA have no dedicated category, so they
  // correctly stay on the generic one.
  // Bug fix: "Woolworths Insurance" and "Woolworths Money" are Woolworths'
  // separate financial-products arm, unrelated to groceries - found in
  // real data being caught by this rule and landing in Groceries. The
  // negative lookahead excludes them so they fall through to a dedicated
  // rule (or bank category/HIGH_CONFIDENCE_OVERRIDES) instead.
  { pattern: /\bwoolworths\b(?!\s*(insurance|money))|\bwoolies\b|\biga\b/gi, categoryId: 'cat_groceries' },
  { pattern: /\bcoles\b/gi, categoryId: 'sub_supermarket' },
  { pattern: /\baldi\b/gi, categoryId: 'sub_supermarket' },
  { pattern: /\bsafeway\b/gi, categoryId: 'sub_supermarket' },
  { pattern: /indian\s+grocer|spice\s+house|mal\s*vic|dosa\s+hut\s+grocer|aangan|marketplace\s+fresh|vel\s*spices/gi, categoryId: 'sub_specialty_groceries' },
  // Found in real ANZ data: a local fruit & veg shop, not a supermarket.
  { pattern: /casey\s+fresh/gi, categoryId: 'sub_fresh_produce' },

  // Fast food / dining
  { pattern: /kfc/gi, categoryId: 'sub_fast_food' },
  { pattern: /mcdonald'?s|maccas/gi, categoryId: 'sub_fast_food' },
  { pattern: /hungry\s+jacks?/gi, categoryId: 'sub_fast_food' },
  { pattern: /nando'?s/gi, categoryId: 'sub_fast_food' },
  { pattern: /domino'?s/gi, categoryId: 'sub_fast_food' },
  { pattern: /pizza\s+hut/gi, categoryId: 'sub_fast_food' },
  // Found in real ANZ data: Wendy's here is the Australian ice creamery
  // chain, and Walker's Doughnuts is a doughnut shop — both dining/fast
  // food, not the generic fallback they were landing on.
  // No trailing \b: EFTPOS descriptions often run words together with no
  // separator (e.g. "WendysDandenongSouth"), and the haystack this is
  // tested against is already lowercased, so there's no case boundary
  // left to detect either — matching just the leading edge is enough.
  // Bug fix: found in real NAB data that a leading \b also fails here —
  // NAB's timestamp-in-description format ("18:03Wendys...") replaces
  // the colon with a space, leaving a digit glued directly onto "wendys"
  // ("03wendys"), and a digit-to-letter transition isn't a \b boundary
  // either (both are "word" characters). Dropped both boundaries; "wendys"
  // is distinctive enough as a substring that this is safe.
  { pattern: /wendys/gi, categoryId: 'sub_fast_food' },
  { pattern: /walker'?s\s+doughnuts/gi, categoryId: 'sub_fast_food' },
  // Found in real NAB data: DoorDash is a food delivery app (not a
  // restaurant itself), and La Porchetta is an Italian restaurant chain.
  { pattern: /doordash/gi, categoryId: 'sub_delivery_apps' },
  { pattern: /la\s+porchetta/gi, categoryId: 'sub_restaurants' },
  // Found in real NAB data: bakeries and a spice shop, previously landing
  // on the generic top-level Groceries bucket.
  { pattern: /breadtop/gi, categoryId: 'sub_specialty_groceries' },
  { pattern: /mks\s+spices/gi, categoryId: 'sub_specialty_groceries' },
  // Bug fix: added — no entry for these previously, despite logos
  // already existing in assets/logos for them.
  { pattern: /guzman\s*y?\s*gomez|\bgyg\b/gi, categoryId: 'cat_dining' },
  { pattern: /boost\s+juice/gi, categoryId: 'cat_dining' },
  { pattern: /uber\s*eats|menulog|doordash/gi, categoryId: 'cat_dining' },
  { pattern: /\brestaurant\b|\bdiner\b|\bbistro\b|\bcafe\b|\bcoffee\b/gi, categoryId: 'cat_dining' },

  // Fuel / transport
  // Bug fix: the old pattern required the literal word "fuel" to appear
  // right after "7-eleven" (e.g. it would only match "7-Eleven fuel"),
  // but real 7-Eleven transaction lines just say "7 ELEVEN 1306 NARRE
  // WARREN" — no "fuel" anywhere in the text — so this never actually
  // matched a real 7-Eleven transaction. Also added apco/reddy/united
  // petroleum, which have logos but weren't covered here.
  // Bug fix: "shell" (Shell fuel) used to match without a word boundary,
  // so it also matched "Shelly" (a smart-home hardware brand) as a
  // substring, silently miscategorizing Shelly purchases as fuel.
  { pattern: /\bbp\s+petrol\b|\bcaltex\b|\bshell\b|7[\s-]?eleven|\bampol\b|\bapco\b|reddy\s*(fuel|express)|united\s+petroleum/gi, categoryId: 'sub_fuel' },
  // Bug fix: "Department of Transport (Victoria)" found uncategorized in
  // real import data - VicRoads' vehicle registration functions were
  // absorbed into this department, so it belongs with the same rego
  // category as the other patterns here.
  { pattern: /rego|registration|vicroads|department\s+of\s+transport/gi, categoryId: 'sub_rego' },
  // Found in real ANZ data: a Toyota dealership charge (format "Toyota
  // (Suburb)") — dealership service/parts, not the "Toyota comp"-style
  // insurance premium some users track as a separate manual category.
  { pattern: /\btoyota\b/gi, categoryId: 'sub_car_service' },
  { pattern: /\bmyki\b|opal.*card|\bptv\b/gi, categoryId: 'sub_public_transport' },
  { pattern: /parking|parkmate|wilson\s+parking/gi, categoryId: 'sub_tolls_parking' },
  { pattern: /\bcitylink\b|\blinkt\b|\btoll\b/gi, categoryId: 'sub_tolls_parking' },
  { pattern: /malaysian?\s+airlines?|qantas|jetstar|virgin\s+australia/gi, categoryId: 'sub_flights' },

  // Utilities
  { pattern: /\bagl\b|origin\s+energy|simply\s+energy|red\s+energy|\bpowershop\b|\bglobird\b/gi, categoryId: 'sub_electricity' },
  { pattern: /south\s+east\s+water|yarra\s+valley\s+water|city\s+west\s+water/gi, categoryId: 'sub_water_usage' },
  { pattern: /\bnbn\b|\btelstra\b|\boptus\b|\bvocus\b|\btpg\b|aussie\s+broadband|\bsuperloop\b/gi, categoryId: 'sub_internet' },

  // Health & medical
  { pattern: /chemist\s*warehouse|\bpharmacy\b|\bamcal\b/gi, categoryId: 'sub_pharmacy' },
  { pattern: /gp\s+clinic|medical\s+centre|myhealth/gi, categoryId: 'sub_gp' },
  { pattern: /dental|dentist/gi, categoryId: 'sub_dental' },
  { pattern: /specsavers|spec\s*savers/gi, categoryId: 'sub_specialists' },
  { pattern: /medicare/gi, categoryId: 'cat_health' },
  { pattern: /ambulance\s+victoria/gi, categoryId: 'sub_ambulance_cover' },

  // Kids / school
  { pattern: /childcare|early\s+learning/gi, categoryId: 'sub_childcare' },
  { pattern: /school\s+fees|school\s+payment|schoolpix/gi, categoryId: 'sub_school_fees' },
  // Found in real NAB data: Flexischools is an Australian platform for
  // paying school lunch orders and other school-related costs online.
  { pattern: /flexischools/gi, categoryId: 'sub_school_fees' },
  // Found in real ANZ data: a BPAY payment to a specific school name.
  { pattern: /st\s+francis\s+xavier/gi, categoryId: 'sub_school_fees' },

  // Subscriptions & entertainment
  { pattern: /netflix|\bstan\b|binge/gi, categoryId: 'sub_streaming' },
  { pattern: /disney\+?/gi, categoryId: 'sub_streaming' },
  { pattern: /prime\s+video|amazon\s+prime/gi, categoryId: 'sub_streaming' },
  // Found in real NAB data: another specific streaming provider name, same
  // pattern as Netflix/Disney/Prime above.
  { pattern: /paramount\+?/gi, categoryId: 'sub_streaming' },
  { pattern: /spotify|apple\s+music|youtube\s+music|amazon\s+music/gi, categoryId: 'sub_music_subs' },
  { pattern: /\bxbox\b/gi, categoryId: 'sub_gaming' },
  { pattern: /eb\s*games/gi, categoryId: 'sub_gaming' },
  { pattern: /sea\s*life|sealife/gi, categoryId: 'sub_events_movies' },

  // Bug fix: Microsoft and generic Amazon had no keyword coverage at
  // all despite being two of the most common transactions (and both
  // explicitly called out as needing a real category, not
  // "Uncategorised"). Amazon Web Services gets its own tech/business
  // bucket since it's cloud infrastructure spend, not a retail purchase.
  { pattern: /microsoft|msbill\.info|office\s*365/gi, categoryId: 'sub_software_cloud' },
  { pattern: /amazon\s*web\s*services|\baws\b/gi, categoryId: 'sub_software_cloud' },
  { pattern: /amazon(?!\s*(web\s*services|music|prime))/gi, categoryId: 'sub_general_retail' },
  { pattern: /paypal/gi, categoryId: 'sub_general_retail' },
  // Bug fix: a bare "apple" keyword rule used to catch everything from a
  // $2.99 app purchase to a $2000 MacBook and dump it all in generic
  // Shopping — but since keyword matching runs before bank-category
  // matching, it was also silently overriding NAB's own much more useful
  // "Electronics & technology" label on the same transactions (found in
  // real data: "Apple" purchases stuck in generic Shopping despite NAB
  // already telling us they were electronics). Removed so "Apple" now
  // defers to whatever the bank's own category says.
  { pattern: /itunes/gi, categoryId: 'cat_shopping' },

  // General retail (bug fix: bunnings/kmart/target/myer/jb hi-fi's
  // sibling stores/westfield/uniqlo/temu/rebel/petstock had logos but
  // no category coverage)
  { pattern: /bunnings/gi, categoryId: 'sub_home_repairs' },
  { pattern: /\bkmart\b|\btarget\b|\bmyer\b|\bwestfield\b|\buniqlo\b|\btemu\b|big\s*w|\baliexpress\b/gi, categoryId: 'sub_general_retail' },
  // Bug fix: found in real data wrongly tagged "Home Equity Mortgage" -
  // almost certainly because a past broad rule matched the word "home" in
  // their store location suffix "(Cranbourne Home)", not because these
  // are actually mortgage-related. Spotlight is a fabric/homewares
  // retailer; Autobarn is a car parts/accessories chain.
  { pattern: /spotlight/gi, categoryId: 'sub_general_retail' },
  { pattern: /autobarn/gi, categoryId: 'sub_car_service' },
  // Confirmed with user: found in real NAB data mislabeled by the bank's
  // own category column as generic "Homeware" - Kathmandu sells outdoor
  // clothing and camping gear, not homeware.
  { pattern: /kathmandu/gi, categoryId: 'sub_clothing' },
  { pattern: /rebel\s+sport/gi, categoryId: 'sub_fitness' },
  { pattern: /petstock/gi, categoryId: 'cat_pets' },
  // Found in real Macquarie data: butcher/seafood shops and a bakery,
  // previously landing on the generic top-level Groceries bucket.
  { pattern: /fish\s+pier|the\s+butchers\s+club|\bmeat\b/gi, categoryId: 'sub_meat_seafood' },
  { pattern: /bakers\s+delight/gi, categoryId: 'sub_specialty_groceries' },
  { pattern: /amma\s+spices/gi, categoryId: 'sub_specialty_groceries' },
  // Found in real ANZ data: a hairdresser/barber.
  { pattern: /kingsmen\s+hair/gi, categoryId: 'sub_grooming' },

  // Insurance
  { pattern: /\ballianz\b|\baami\b|budget\s+direct|\bnrma\b|\bracv\b|\bbupa\b|\bmedibank\b|\bnib\b/gi, categoryId: 'cat_insurance' },
  { pattern: /hannover|real\s+insurance/gi, categoryId: 'sub_life_ins' },

  // Property / rates
  { pattern: /council\s+rates|city\s+of\s+/gi, categoryId: 'sub_council_rates' },
  { pattern: /body\s+corporate|owners\s+corp/gi, categoryId: 'sub_body_corporate' },
  // Found in real ANZ data: CoreLogic is a property data/valuation
  // subscription service, and Oliver Hume / Orbit Homes / Metricon Homes
  // are home builders/land estate agents — large progress-payment style
  // transactions, not a generic transfer.
  { pattern: /corelogic/gi, categoryId: 'sub_property_management' },
  { pattern: /oliver\s+hume|orbit\s+homes|metricon\s+homes/gi, categoryId: 'sub_home_building' },

  // Tech & home office
  // Bug fix: these are all dedicated electronics/appliance retailers -
  // found in real data landing on generic top-level Shopping instead of
  // Electronics & Tech.
  { pattern: /jb\s+hi-fi|harvey\s+norman|good\s+guys/gi, categoryId: 'sub_electronics' },
  { pattern: /officeworks/gi, categoryId: 'sub_electronics' },
  { pattern: /\bsonoff\b|\bshelly\b/gi, categoryId: 'sub_electronics' },

  // Tax / government
  { pattern: /land\s+tax|\bsro\b|state\s+revenue\s+office/gi, categoryId: 'sub_land_tax' },
  { pattern: /\bato\b|australian\s+taxation\s+office/gi, categoryId: 'sub_personal_tax' },
  { pattern: /h\s*&\s*r\s*block/gi, categoryId: 'sub_business_services' },
  // Bug fix: this was previously mapped to sub_rideshare_taxi, which
  // makes no sense for a postal service - looks like a leftover
  // copy-paste error. Postage/post-office purchases don't have a
  // dedicated subcategory, so Misc Items is the honest answer.
  { pattern: /australia\s*post|auspost/gi, categoryId: 'sub_misc_items' },
  // Found in real Macquarie data: home repair/trade services and a cloud
  // subscription that were falling through to Uncategorised entirely.
  { pattern: /budget\s+glass|local\s+plumbing|superior\s+gates/gi, categoryId: 'sub_home_repairs' },
  { pattern: /g\s*suite|google\s+workspace/gi, categoryId: 'sub_software_cloud' },
  { pattern: /\brsea\b/gi, categoryId: 'sub_clothing' },
  // Found in real ANZ data: a law firm refund/payment — legal fees when
  // money actually went TO them. Bug fix: this used to match regardless of
  // direction, so a transaction plainly described as "MADDOCKS REFUNDS" (a
  // credit coming back) was still forced into the Legal Fees expense
  // category. Gated to only fire for actual expenses; an incoming payment
  // from Maddocks now falls through to bank-category/fallback matching
  // instead (typically Other Income).
  { pattern: /maddocks/gi, categoryId: 'sub_legal_fees', type: 'expense' },
  // Found in real NAB data: a teachers' union — membership fees.
  { pattern: /education\s+union|teachers?\s+union|\baeu\b/gi, categoryId: 'sub_union_fees' },

  // Debt repayments
  // Bug fix: BPAY payments to a card provider's billing service were
  // falling through everything (no bank category, no merchant rule) all
  // the way to the last-resort category-name matcher, which then matched
  // the literal word "bpay" in the description against a category
  // *named* "BPAY Payments" — completely ignoring who the payment
  // actually went to. A BPAY payment to a credit card biller is a credit
  // card repayment, not an unlabelled transfer; "MBL" here is Macquarie
  // Bank Limited's card-services BPAY biller code, found repeatedly in
  // real ANZ export data.
  { pattern: /mbl\s+card\s+services/gi, categoryId: 'sub_credit_card_payment' },

  // Leisure
  { pattern: /the\s+lott\b/gi, categoryId: 'sub_gambling' },

  // Income — bug fix: previously there was no income-side keyword
  // coverage at all, so every salary/wage deposit that didn't happen
  // to match a bank-provided category fell straight through to the
  // (expense-typed) "Uncategorised" fallback. These match on the raw
  // description text before merchant-name cleanup strips the words
  // out, so they still catch "PAY/SALARY FROM GCP" style deposits.
  { pattern: /salary|wages?|payroll/gi, categoryId: 'sub_salary' },
  { pattern: /dividend/gi, categoryId: 'sub_dividends' }
];

function keywordCategoryMatch(tx) {
  if (!tx) return null;
  const haystack =
    `${tx.description || ''} ${tx.rawDescription || ''} ${tx.merchant || ''}`.toLowerCase();

  for (const rule of KEYWORD_CATEGORY_MAP) {
    // Bug fix: a merchant-name keyword match is direction-blind by
    // default (it fires on the merchant regardless of whether money went
    // to them or came from them), which is wrong for any merchant you
    // might plausibly both pay AND receive a refund/rebate from - e.g. a
    // "maddocks" hit blindly landing on Legal Fees even for a transaction
    // that says "REFUND" right in the description. An optional `type` on
    // a rule (mirroring the same field on HIGH_CONFIDENCE_OVERRIDES below)
    // lets a rule opt in to only firing for that direction, leaving the
    // other direction to fall through to bank-category/fallback matching
    // instead of a wrong forced category.
    if (rule.type && rule.type !== tx.type) continue;

    // Bug fix: every pattern here uses the /g flag, and a /g regex keeps
    // internal position state (lastIndex) across calls to .test() on the
    // same object. Since these patterns are shared module-level constants
    // reused for every transaction checked, a pattern that just matched
    // one transaction could leave lastIndex partway through that string -
    // then the very next transaction it's tested against starts searching
    // from that same offset instead of position 0, and can spuriously
    // fail to match even when the keyword is right there at the start.
    // Resetting lastIndex before every test makes each check independent
    // of whatever happened on the previous transaction.
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(haystack)) {
      return rule.categoryId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto-learning engine
// ---------------------------------------------------------------------------
function trackAutoLearning(field, patternRaw, categoryId) {
  const pattern = normaliseKey(patternRaw);
  if (!pattern || pattern.length < 3) return; // ignore tiny patterns

  const key = `${field}:${pattern}:${categoryId}`;
  const current = pendingStats[key] || 0;
  const next = current + 1;
  pendingStats[key] = next;

  if (next < AUTO_LEARN_THRESHOLD) return;

  // Already a rule?
  const existing = merchantRules.find(
    r => r.field === field && r.pattern === pattern && r.categoryId === categoryId
  );
  if (existing) {
    existing.hitCount = (existing.hitCount || 0) + 1;
    existing.lastUsed = new Date().toISOString();
  } else {
    merchantRules.push({
      field,
      pattern,
      categoryId,
      confidence: 1,
      hitCount: next,
      lastUsed: new Date().toISOString()
    });
  }

  saveRulesToStorage();
}

// ---------------------------------------------------------------------------
// Public: Learn from manual category choice
// Call this when user sets/changes a category in the UI
// ---------------------------------------------------------------------------
export function learnFromManualCategory(tx, categoryId, opts = {}) {
  if (!tx || !categoryId) return;

  // Prefer merchant-based learning
  if (tx.merchant) {
    trackAutoLearning('merchant', tx.merchant, categoryId);
  } else if (tx.cleanDescription || tx.description) {
    const keySource = tx.cleanDescription || tx.description;
    trackAutoLearning('description', keySource, categoryId);
  }

  if (opts.log !== false) {
  }
}

// ---------------------------------------------------------------------------
// Public: Suggest category for a transaction
// PRIORITY:
// 1) Explicit userCategoryId (if passed in)
// 2) High-confidence overrides (see HIGH_CONFIDENCE_OVERRIDES below)
// 3) Merchant rule (learned from manual corrections via learnFromManualCategory)
// 4) Keyword-based mapping from description/merchant
// 5) Bank category mapping (if provided)
// 6) Fallback: sub_uncategorised
// ---------------------------------------------------------------------------
// A small, deliberately short list of overrides that win even over the
// bank's own category label - reserved for cases where that label is
// actively misleading, not routine keyword matching (KEYWORD_CATEGORY_MAP
// is for that, and only runs after bank-category matching). Add to this
// list sparingly.
const HIGH_CONFIDENCE_OVERRIDES = [
  // Confirmed with user: NAB tags real estate agency rent distributions
  // as generic "Investment income", which the unrelated 'investment' ->
  // Investments mapping would otherwise catch first.
  { pattern: /ray\s+white/gi, categoryId: 'sub_rental_income' },

  // Confirmed with user: these two employers were being categorized
  // backwards (this account holder's own salary was landing on Spouse,
  // and vice versa) - almost certainly from a previously-learned
  // merchant rule set up the wrong way round. These overrides win
  // regardless of whatever a learned rule currently says.
  { pattern: /department\s+of\s+ed/gi, categoryId: 'sub_spouse_salary' },
  { pattern: /\bgcp\b/gi, categoryId: 'sub_salary' },

  // Confirmed with user: label money transfers by which of their own
  // accounts/people the description says it actually went to, rather
  // than a single generic "Transfer" bucket.
  { pattern: /nab\s+savings/gi, categoryId: 'sub_transfer_savings' },
  { pattern: /\binv\s+offset\s+account\b/gi, categoryId: 'sub_transfer_inv_offset' },
  { pattern: /\bme\s+offset\s+account\b/gi, categoryId: 'sub_transfer_offset' },
  { pattern: /\bto\s+rajeev\b|raman\s+rajeev\s+lakshmi/gi, categoryId: 'sub_transfer_person' },

  // Found via systematic scan: "interest" alone is ambiguous - could be
  // interest earned (income) or interest charged on a card/loan (an
  // expense) - and the old flat keyword rule always assumed income
  // regardless of transaction type. Splitting by type here instead.
  { pattern: /\binterest\b/gi, categoryId: 'sub_interest_income', type: 'income' },
  { pattern: /\binterest\b/gi, categoryId: 'sub_interest_charged', type: 'expense' },

  // Found in real Macquarie data: the exact same description "Late
  // Payment Fee Reversal" appears twice with two different bank category
  // labels ("Late Payment Fees" and "BPAY Payment Reversals") - Macquarie
  // itself is inconsistent here, so the actual description text is a more
  // reliable signal than either bank label.
  { pattern: /late\s+payment\s+fee/gi, categoryId: 'sub_late_fees' },

  // Found via real Macquarie data + a bug in the auto-learn system (see
  // the comment above trackAutoLearning): these specific merchant strings
  // got self-cached against the wrong category before that bug was fixed,
  // and a stale learned rule from before the fix would otherwise still
  // win over the correct keyword rule below. These force the correct
  // category regardless of whatever a leftover learned rule says. (Also
  // recommend using Settings → "Clear Auto-Learned Merchant Rules" once,
  // to remove any other similarly-poisoned rules this list doesn't cover.)
  { pattern: /woolworths\s+insurance/gi, categoryId: 'sub_home_ins' },
  { pattern: /amazon\s+web\s+services/gi, categoryId: 'sub_software_cloud' },
  { pattern: /st\s+francis\s+xavier/gi, categoryId: 'sub_school_fees' },
  { pattern: /courtenay\s+garden/gi, categoryId: 'sub_school_fees' },
  { pattern: /alkira\s+secondary/gi, categoryId: 'sub_school_fees' },
  { pattern: /holmesglen|chisholm\s+institute/gi, categoryId: 'sub_uni_fees' },

  // Found via real ANZ data: "BPAY TAX OFFICE PAYMENT" is a payment to the
  // Australian Taxation Office. Left ambiguous otherwise, since several
  // unrelated tax categories (Land Tax, Tax Refund, Other Tax Expenses)
  // all tie once "office"/"payment" are excluded as generic words.
  { pattern: /tax\s+office/gi, categoryId: 'sub_personal_tax' }
];

export function suggestCategoryForTransaction(tx, bankCategoryRaw = null, options = {}) {
  const dryRun = !!options.dryRun;

  // 1) User override (if importer already knows a manual choice)
  if (options.userCategoryId) {
    return {
      categoryId: options.userCategoryId,
      source: 'user_override',
      rule: null
    };
  }

  // 2) High-confidence overrides - a small, deliberately short list for
  // cases where a very specific signal should win even over the bank's
  // own category label, because that label is actively misleading rather
  // than just generic. Confirmed with user: NAB tags real estate agency
  // rent distributions as generic "Investment income", which would
  // otherwise be caught by the unrelated 'investment' -> Investments
  // mapping below before ever reaching keyword matching. This is NOT the
  // place for routine keyword rules - see KEYWORD_CATEGORY_MAP for those.
  const highConfidenceHaystack =
    `${tx.description || ''} ${tx.rawDescription || ''} ${tx.merchant || ''}`.toLowerCase();
  for (const rule of HIGH_CONFIDENCE_OVERRIDES) {
    if (rule.type && rule.type !== tx.type) continue;
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(highConfidenceHaystack)) {
      return { categoryId: rule.categoryId, source: 'keyword_match', rule: null };
    }
  }

  // 3) Merchant rule
  const merchantRule = findMerchantRuleForTransaction(tx);
  if (merchantRule) {
    if (!dryRun) {
      merchantRule.hitCount = (merchantRule.hitCount || 0) + 1;
      merchantRule.lastUsed = new Date().toISOString();
      saveRulesToStorage();
    }

    return {
      categoryId: merchantRule.categoryId,
      source: 'merchant_rule',
      rule: merchantRule
    };
  }

  // 4) Keyword-based mapping from description/merchant
  // Bug fix: this used to run AFTER bank-category matching, but a bank's
  // own category label is often much more generic than what keyword
  // matching on the actual merchant name can find - e.g. NAB labels both
  // "South East Water" and an electricity bill the same generic
  // "Utilities", while keyword matching on the merchant name itself can
  // tell them apart (Water Usage vs Electricity). Running keyword
  // matching first means a specific match here wins over a generic bank
  // label, while bank-category matching (next) still fills in the gaps
  // keyword matching can't cover (NAB's "Cash", "Personal care", etc.,
  // which have no reliable merchant-name keyword to match on).
  //
  // Bug fix: this used to also call trackAutoLearning() on every keyword
  // match, caching "this exact merchant string -> this category" as a
  // merchant_rule (which outranks keyword matching - see step 3 above).
  // Found via real data: a transaction with merchant "woolworths" (no
  // location suffix) got cached as merchant_rule "woolworths" -> Groceries.
  // Because merchant rules match as a whole word/phrase ANYWHERE in the
  // text, that single-word rule then silently caught every future
  // "Woolworths <anything>" transaction too, including "Woolworths
  // Insurance" - overriding both a correct insurance keyword match and
  // the bank's own "Financial Insurance" category label. Same pattern hit
  // "Amazon Web Services" (caught by a cached "amazon" -> General Retail
  // rule, bypassing the dedicated cloud-services keyword rule below it).
  // Keyword matching is already a fast lookup with no need for a cache,
  // so this just doesn't cache keyword results as merchant rules anymore
  // - manual corrections (learnFromManualCategory, called from the UI)
  // are unaffected and still learn normally.
  const catIdFromKeywords = keywordCategoryMatch(tx);
  if (catIdFromKeywords) {
    return {
      categoryId: catIdFromKeywords,
      source: 'keyword_match',
      rule: null
    };
  }

  // 5) Bank category mapping
  // Bug fix: same self-caching issue as step 4 above applied here too -
  // removed for the same reason (see the longer comment above).
  if (bankCategoryRaw) {
    const catIdFromBank = resolveBankCategory(bankCategoryRaw, {
      bankId: options.bankId
    });
    if (catIdFromBank) {
      return {
        categoryId: catIdFromBank,
        source: 'bank_category',
        rule: {
          bankCategory: bankCategoryRaw
        }
      };
    }
  }

  // 6) Fallback
  // Bug fix: this always returned 'cat_misc' — a category
  // explicitly typed 'expense' — regardless of what kind of
  // transaction it was. An unmatched salary deposit or refund would
  // get labelled as an "Uncategorised" expense, which is both an
  // unhelpful name and the wrong type. This now branches: an unmatched
  // income transaction goes to "Other Income", and an unmatched
  // expense goes to "Misc Items" — every transaction lands in a real,
  // sensibly-named category. (Genuinely unrecognised merchants will
  // still land here — the way to close that gap further is adding more
  // keyword/logo entries, or just categorizing it once yourself: after
  // 3 manual picks for the same merchant the app auto-learns the rule
  // going forward.)
  const fallback = (tx && tx.type === 'income') ? 'sub_other_income' : 'sub_misc_items';
  return {
    categoryId: fallback,
    source: 'fallback',
    rule: null
  };
}
