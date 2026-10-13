// ============================================================================
// features.js — which licence edition unlocks which page, and what is released
// ----------------------------------------------------------------------------
// Editions (see js/licence.js): core < property < tax. Each includes the ones
// below it. This file is the ONE place that decides what each edition gets.
//
// By default a page's edition comes from its group in js/navItems.js:
//   group "Property" -> property      group "Tax" -> tax      anything else -> core
// To move a single page add it to VIEW_TIER_OVERRIDES below, e.g.
//   vehicles: 'property'   (and see the "Loans & Assets" group in navItems.js).
//
// Two independent ideas, don't mix them up:
//   * RELEASED  — js/releaseConfig.js RELEASE_STAGE: the highest edition you have
//                 SHIPPED. Pages above it are hidden entirely (no menu item, no
//                 lock) and nothing above it can be unlocked yet, not even by a
//                 key, the trial, or licensing being off.
//   * UNLOCKED  — what the buyer's licence key (or trial) grants, capped by the
//                 released stage. A released page the buyer hasn't paid for stays
//                 in the menu with a 🔒 and opens an upgrade screen.
//
// Hidden data is never deleted: a backup from a higher edition restores fully and
// simply stays out of sight until that edition is unlocked. Hidden is not secure
// (the code is in the download); this is a product-staging tool.
// ============================================================================
import { NAV_ITEMS } from './navItems.js';
import { TIERS, tierAllows, tierRank } from './licence.js';
import { RELEASE_STAGE } from './releaseConfig.js';
import { getAllItems, STORE_NAMES } from './db.js';

const GROUP_TIER = { Property: 'property', Tax: 'tax' };

export const VIEW_TIER_OVERRIDES = {
  // vehicles: 'property',
};

export function requiredTierForView(view) {
  if (VIEW_TIER_OVERRIDES[view]) return VIEW_TIER_OVERRIDES[view];
  const item = NAV_ITEMS.find(i => i.view === view);
  return GROUP_TIER[item?.group] || 'core';
}

// ---- released stage --------------------------------------------------------
export function releasedTier(stage = RELEASE_STAGE) {
  return TIERS[Math.max(0, Math.min(Number(stage) || 1, TIERS.length) - 1)];
}
export function tierReleased(tier, stage = RELEASE_STAGE) {
  return tierRank(tier) <= tierRank(releasedTier(stage));
}
// Highest edition that can actually be unlocked right now.
export function cappedTier(tier, stage = RELEASE_STAGE) {
  if (!tier || tierRank(tier) < 0) return null;
  return tierRank(tier) > tierRank(releasedTier(stage)) ? releasedTier(stage) : tier;
}
export function viewReleased(view, stage = RELEASE_STAGE) {
  return tierReleased(requiredTierForView(view), stage);
}

// ---- unlocked by licence ---------------------------------------------------
// True when `currentTier` (what the licence grants) covers the page and the page is released.
export function viewAllowed(view, currentTier, stage = RELEASE_STAGE) {
  return viewReleased(view, stage) && tierAllows(cappedTier(currentTier, stage), requiredTierForView(view));
}

// ---- current edition (set by licenceGate.js once the licence is read) -------
let currentTier = 'tax'; // what the licence grants (everything while off / in trial)

export function setCurrentTier(tier) {
  currentTier = tier;
  applyFeatureClasses();
}
export function getCurrentTier() { return currentTier; }
export function getEffectiveTier() { return cappedTier(currentTier); }
// Same as viewAllowed() for the current edition.
export function viewAvailable(view) { return viewAllowed(view, currentTier); }

// Feature flags used inside shared pages (form fields, dashboard cards...).
// 'property' / 'tax' are on once the edition is both paid for and released.
export const FEATURE_TIER = { property: 'property', tax: 'tax' };
export function hasFeature(feature) {
  const need = FEATURE_TIER[feature];
  return !need || tierAllows(getEffectiveTier(), need);
}

// IndexedDB stores that belong to an edition. Reads on SHARED pages (dashboards,
// transactions, loans...) go through getGatedItems() so a locked edition behaves
// as if it has no property/tax data. Never use it for backup, export or sync.
export const STORE_FEATURE = {
  [STORE_NAMES.properties]: 'property',
  [STORE_NAMES.tenants]: 'property',
  [STORE_NAMES.maintenance]: 'property',
  [STORE_NAMES.expenses]: 'property',
  [STORE_NAMES.costbase]: 'tax',
  [STORE_NAMES.taxRecords]: 'tax'
};
export async function getGatedItems(storeName) {
  const f = STORE_FEATURE[storeName];
  if (f && !hasFeature(f)) return [];
  return getAllItems(storeName);
}

// <html> gets .no-property / .no-tax; css/styles.css hides anything tagged
// data-feature="property" | "tax" while the class is present.
export function applyFeatureClasses() {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  for (const f of Object.keys(FEATURE_TIER)) root.classList.toggle('no-' + f, !hasFeature(f));
}
