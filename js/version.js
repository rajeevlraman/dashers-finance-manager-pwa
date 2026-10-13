// js/version.js
// Human-facing app version, shown in Settings -> About. Only bumped
// deliberately when a change is worth surfacing to the person using the app.
//
// This is a SEPARATE number from serviceWorker.js's CACHE_VERSION, which
// exists purely to force the service worker's own bytes to change so an
// already-visited browser re-checks and refreshes its cache.
//
// Full release history lives in CHANGELOG.md.
export const APP_VERSION = "1.9.0";
