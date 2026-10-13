// ============================================================================
// 🚦 releaseConfig.js — which paid stages this build is allowed to unlock
// ----------------------------------------------------------------------------
// RELEASE_STAGE is the HIGHEST stage you have shipped:
//     1 = Core                       (everything except Property and Tax)
//     2 = Core + Property            (properties, tenants, maintenance, expenses,
//                                     property fields, Rates & Land Tax)
//     3 = Core + Property + Tax      (ATO Reports, Cost Base)
//
// A licence key carries its own tier (see tools/licence-issue.mjs --tier). What
// a person actually gets is the LOWER of their key's tier and RELEASE_STAGE,
// so a Property key does nothing until you raise this to 2, and a Tax key does
// nothing until you raise it to 3. Raise it (and bump CACHE_VERSION in
// serviceWorker.js) when you release the next stage.
//
// With licensing OFF (LICENCE_PUBLIC_KEY = null in licenceConfig.js) there are
// no keys, so everyone gets RELEASE_STAGE. Handy for your own copy: set this
// to 3 locally to use every feature. Never ship a build you intend to sell with
// licensing off.
// ============================================================================
//
// Current setting: 3 = every edition is shown. Pages a buyer hasn't unlocked stay
// in the menu with a lock and open an upgrade screen that lists what the edition
// adds, so people can see the Property and Tax features exist. Set this lower
// only if you want to hide an edition completely until it is ready.
export const RELEASE_STAGE = 3;
