// ============================================================================
// 🔄 swUpdate.js — reliable "update available → apply → reload" handling
// ============================================================================
// Why this exists: serviceWorker.js calls self.skipWaiting() at the end of its
// own install, so a new version never sits in the `waiting` state — it installs,
// activates and claims the open page straight away. The page, however, is still
// running the OLD JavaScript it loaded at startup (so Settings still says the
// old version). The old Update buttons posted SKIP_WAITING and then waited for a
// `controllerchange` event that had ALREADY fired, so nothing reloaded until the
// person hard-refreshed; and "Check for Updates" saw no waiting/installing
// worker and reported "up to date" while the page was stale.
//
// Fix: remember at startup whether a worker was already controlling the page
// (i.e. this is an update, not a first install) and flag any later
// controllerchange as "newer code is active, this page is stale". Applying the
// update then just reloads when that flag is set, and otherwise asks a waiting
// worker to activate and reloads on its controllerchange (with a fallback).

let tracking = false;
let hadController = false;
let staleSinceControllerChange = false;

// Call once, as early as possible (before the service worker is registered).
export function initSwUpdateTracking() {
    if (tracking || !('serviceWorker' in navigator)) return;
    tracking = true;
    hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // First-ever install (no controller before) isn't an update: the page's
        // code is already what was just fetched. Only flag real updates.
        if (hadController) staleSinceControllerChange = true;
        hadController = true; // a later change is another update
    });
}

// True when a newer worker has already taken over but this page still runs
// the code it loaded earlier — a reload is all that's needed.
export function isPageStale() {
    return staleSinceControllerChange;
}

// Applies an update and reloads. `worker` is an optional waiting/installed
// ServiceWorker to activate first. Safe to call whether or not the new worker
// has already taken over.
export function applyUpdateAndReload(worker) {
    if (staleSinceControllerChange) {
        window.location.reload();
        return;
    }
    let reloaded = false;
    const reload = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
    };
    // Listen BEFORE asking the worker to activate, so we can't miss the event.
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    try {
        (worker || null)?.postMessage({ type: 'SKIP_WAITING' });
    } catch { /* worker may already be redundant — the fallback below covers it */ }
    // If nothing changes (worker already active, event already fired, or no
    // worker given), reload anyway so the person never taps Update for nothing.
    setTimeout(reload, 2500);
}
