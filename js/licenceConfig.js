// ============================================================================
// 🔑 licenceConfig.js — the ONLY file you edit to turn licensing on
// ----------------------------------------------------------------------------
// LICENCE_PUBLIC_KEY = null  →  licensing is OFF. Nothing is locked, no trial,
//                               no licence screen. (This is how the beta ships.)
//
// To turn it on, run once on your own computer:
//     node tools/licence-keygen.mjs --write-config
// That creates your private signing key OUTSIDE the project folder and writes
// the matching PUBLIC key into this file. The public key is safe to ship; it
// can only check licence keys, never create them. See docs/LICENSING.md.
// ============================================================================

// Public verification key (JWK, ECDSA P-256) or null for "licensing off".
export const LICENCE_PUBLIC_KEY = null;

// Free trial length once licensing is on.
export const TRIAL_DAYS = 14;

// Where "Buy a licence" sends people (your Lemon Squeezy / Gumroad / Stripe
// payment link). Leave empty to hide the button.
export const PURCHASE_URL = '';

// Optional per-edition buy links (Core / Property / Property + Tax). Any left
// empty falls back to PURCHASE_URL above. These are what the upgrade screen
// shows when someone opens a page their edition doesn't include.
export const PURCHASE_URLS = { core: '', property: '', tax: '' };

// What the free trial unlocks: 'tax' = every released section (try before you
// buy), 'core' = Core only so the paid upgrades keep their pull. Always capped
// by RELEASE_STAGE in js/releaseConfig.js.
export const TRIAL_TIER = 'tax';

// Courtesy days AFTER the trial ends when everything still works (with a reminder) before the
// licence screen appears. Set 0 for no grace period.
export const GRACE_DAYS = 7;

// OPTIONAL licence server (see docs/LICENCE-SERVER.md). Empty string = off, and licensing stays fully
// offline. When set, e.g. 'https://dashers-licence.YOURNAME.workers.dev', a key is limited to a few
// devices, can be cancelled when refunded, and a device can be deactivated to move the licence.
// The app still works offline: the server is only contacted when a key is activated and now and then
// afterwards, and an unreachable server never locks anybody out.
export const ACTIVATION_URL = '';

// How often (days) to quietly ask the server whether the key is still valid. Only used with ACTIVATION_URL.
export const STATUS_CHECK_DAYS = 7;
