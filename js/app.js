// ============================================================================
// app.js - Main Application Entry Point
// ============================================================================

// ✅ Enable debug console for testing; comment out for production
import { setupDebugConsole } from './debugConsole.js';
setupDebugConsole();

import './dialogs.js'; // in-app replacement for native alert()

import { initUI } from './ui.js';
import { renderSharedNav } from './renderNav.js';
import { initMobileNavDrawer } from './mobileNavDrawer.js';
import { processRecurringTransactions, processDueBills } from './recurringJob.js';
import { processSuperRecurringContributions } from './superRecurringJob.js';
import { getAllItems, STORE_NAMES, removeLeftoverDemoAccounts } from './db.js';
import { checkAndNotifyDueBills } from './billReminders.js';
import { applyLayoutChanges, LayoutModes } from './layoutManager.js';
import { requireUnlock, initAutoRelock } from './appLock.js';
import { syncNow, updateFamilySyncIndicator, startFamilySyncIndicatorPolling } from './familySync.js';
//version import 
import { APP_VERSION } from './version.js';
import { initSwUpdateTracking, applyUpdateAndReload, isPageStale } from './swUpdate.js';
import { applyChartTheme } from './chartTheme.js';
import { initThemeToggle } from './themeToggle.js';
import { initBackupReminder, wireBackupButtons } from './backupReminder.js';
import { requireLicence } from './licenceGate.js';

import { initCurrency, recordCurrency } from './utils/currency.js';
// Optional check: warn if not HTTPS (affects PWA install prompt)
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    console.warn('⚠️ PWA install prompt might not work when not served over HTTPS');
}

// --------------------------
// Persistent Storage Request
// --------------------------
async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        try {
            const isPersisted = await navigator.storage.persisted();
            if (!isPersisted) {
                const granted = await navigator.storage.persist();
                if (granted) {
                } else {
                    console.warn("⚠️ Persistent storage not granted");
                }
            } else {
            }
        } catch (err) {
            console.error("❌ Error requesting persistent storage:", err);
        }
    } else {
    }
}

// --------------------------
// PWA Install Banner Logic
// --------------------------
let deferredPrompt = null;

function showInstallBanner() {
    const banner = document.getElementById('installBanner');
    if (banner) {
        banner.classList.add('show');
    }
}

function hideInstallBanner() {
    const banner = document.getElementById('installBanner');
    if (banner) {
        banner.classList.remove('show');
    }
}

// Listen for the beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
});

// --------------------------
// Development Branch Indicator Logic
// --------------------------
function checkBranchIndicator() {
    const indicator = document.getElementById('branchIndicator');
    if (!indicator) return;

    // Same rules as before: localhost host, or an explicit /dev/ in the URL.
    // (The old extra "contains 'dashers-finance-manager' AND 'dev' anywhere" rule is
    // removed: it matched ordinary URLs such as *.pages.dev or develop-- branch links.)
    const isDevEnvironment = location.host.includes('localhost') ||
                             location.href.includes('/dev/');

    indicator.style.display = isDevEnvironment ? 'block' : 'none';
}
// --------------------------
// Auxiliary UI Helpers (Toast, Offline Banner, Connection Icon)
// --------------------------
export function showUpdateToast(worker) {
    if (document.getElementById('updateToast')) return;
    const toast = document.createElement('div');
    toast.id = 'updateToast';
    toast.innerHTML = `
        <div class="toast-content">
            <span>🚀 A new version of <strong>Dashers Finance Manager</strong> is available!</span>
            <div class="toast-buttons">
                <button id="btnReload" class="button">Update</button>
                <button id="btnDismiss" class="button red">Dismiss</button>
            </div>
        </div>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    toast.querySelector('#btnReload').addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
        // See js/swUpdate.js: the new worker usually has ALREADY taken over by now
        // (serviceWorker.js skipWaiting()s in install), so waiting for a fresh
        // controllerchange here never fired and nothing reloaded.
        applyUpdateAndReload(worker);
    });

    toast.querySelector('#btnDismiss').addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    });
}

function showOfflineBanner() {
    if (document.getElementById('offlineBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.textContent = '📴 You\'re offline — viewing cached data';
    banner.className = 'offline-banner';   // styles live in css/styles.css (slim strip above the tab bar)
    // The header dot still shows the offline state, so let the strip get out of the way.
    setTimeout(() => { banner.style.transform = 'translateY(200%)'; }, 4000);
    document.body.appendChild(banner);

    window.addEventListener('online', () => {
        banner.style.transform = 'translateY(100%)';
        setTimeout(() => banner.remove(), 300);
    }, { once: true });
}

function updateConnectionIcon() {
    const icon = document.getElementById('connectionStatus');
    if (!icon) return;
    if (navigator.onLine) {
        icon.textContent = '🟢';
        icon.title = 'Online';
        icon.classList.remove('offline');
        icon.classList.add('online', 'syncing');
        setTimeout(() => icon.classList.remove('syncing'), 1500);
    } else {
        icon.textContent = '🔴';
        icon.title = 'Offline';
        icon.classList.remove('online');
        icon.classList.add('offline');
    }
}

// --------------------------
// Enhanced App Initialization
// --------------------------
async function initializeAppCore() {
    await initCurrency();
    
    // Layout detection
/*
    applyLayoutChanges(mode => {
        if (mode === LayoutModes.MOBILE) {
            document.body.classList.add('is-mobile');
            document.body.classList.remove('is-desktop');
            initDashboardMobileV2UI();
        } else {
            document.body.classList.add('is-desktop');
            document.body.classList.remove('is-mobile');
            initDashboardDesktopUI();
        }
    });
*/    
    // Initialize UI
    initUI();
    initMobileNavDrawer();

    // Clear out the old built-in demo accounts ("Bank Account" / "Wallet")
    // that earlier builds seeded — only unused, unedited copies, and only
    // when the person has other accounts (see removeLeftoverDemoAccounts).
    try {
        await removeLeftoverDemoAccounts();
    } catch (err) {
        console.warn('[app] Demo account cleanup failed', err);
    }

    
    // Run automation
    await processRecurringTransactions();
    await processDueBills();
    try {
        await processSuperRecurringContributions();
    } catch (err) {
        console.warn('[app] Super recurring contribution processing failed', err);
    }

    // Show a reminder notification for overdue/soon-due bills, if the
    // person has granted notification permission (see js/billReminders.js
    // and the Bills page for the opt-in button). No-op if not granted.
    try {
        const accountsForFx = await getAllItems(STORE_NAMES.accounts).catch(() => []);
        const bills = (await getAllItems(STORE_NAMES.bills)).map(b => ({ ...b, currency: recordCurrency(b, accountsForFx) }));
        checkAndNotifyDueBills(bills);
    } catch (err) {
        console.warn('[app] Bill reminder check failed', err);
    }
    
    // Request persistent storage
    await requestPersistentStorage();
    
}

// ============================================================================
// --------------------------
// Main Initialization Block (Single DOMContentLoaded Event)
// --------------------------
document.addEventListener('DOMContentLoaded', async () => {
    
    // --- 0. Development Branch Check ---
    checkBranchIndicator();

    // Set Chart.js's global default text/grid colors to match whichever
    // theme index.html's inline boot script just restored, so the very
    // first chart drawn (Dashboard, Financial Dashboard, Reports, etc.)
    // already has legible axis/legend text instead of Chart.js's default
    // grey — previously this only ever got set from inside the Settings
    // page's own code, so nothing else was colored correctly until a
    // user happened to open Settings first.
    applyChartTheme();
    initThemeToggle();

    // Populate the top nav + drawer nav from the shared list (js/navItems.js)
    // before initUI() below, which queries for nav links to wire up active
    // states and click handling.
    renderSharedNav();

    // --- 2. Splash screen fade‐out ---
    const splash = document.getElementById("splashScreen");
    if (!splash) return;

    // Minimum splash duration
    setTimeout(() => {
        splash.classList.add("fade-out");
        
        // Ensure complete removal
        setTimeout(() => {
            splash.classList.add("hidden");
        }, 700); // fade-out duration
    }, 1500); // overall time on screen

    // --- 3. App Lock (only blocks if the user has set up a PIN in Settings) ---
    await requireUnlock();
    initAutoRelock();

    // --- 3b. Licence (no-op unless licensing is switched on in js/licenceConfig.js) ---
    await requireLicence();

    // --- 4. Initialize core application ---
    await initializeAppCore();
    import('./licenceGate.js').then(m => m.applyTierLocks()); // 🔒 on nav items outside the edition (no-op when licensing is off)

    // --- 4a. Backup safety net: header Backup/Restore buttons + "no recent backup" nudge ---
    wireBackupButtons();
    initBackupReminder().catch(err => console.warn('[app] Backup reminder failed', err));

    // --- 4a2. First-run setup guide (optional and skippable; only on a brand-new, empty install) ---
    import('./onboarding.js').then(m => m.initOnboarding()).catch(err => console.warn('[app] Setup guide failed', err));
    // Ask the browser to keep this app's data (and licence) through low-storage clean-ups, mainly on iPhone.
    try { navigator.storage?.persisted?.().then(ok => { if (!ok) navigator.storage.persist?.(); }).catch(() => {}); } catch { /* not supported */ }
    // Any element with data-open-guide="setup" or "tour" (header, menu, Settings, Help) reopens it.
    document.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-open-guide]');
      if (!b) return;
      e.preventDefault();
      document.getElementById('mobileNavClose')?.click();   // close the phone menu if it is open
      import('./onboarding.js').then(m => m.startOnboarding({ tourOnly: b.dataset.openGuide === 'tour' }))
        .catch(err => console.warn('[app] Guide failed', err));
    });

    // --- 4b. Family Sync (if connected to a local family server) ---
    // Runs in the background — never blocks app startup. If the server is
    // unreachable (not on the home WiFi, server off, etc), this fails
    // quietly and the app just keeps working fully offline.
    syncNow().then(async (result) => {
        if (result.synced && (result.pulled > 0 || result.pushed > 0)) {
            // Refresh the currently visible view and nav so any newly
            // synced/removed data (or a permission change) shows up
            // immediately rather than only after the next navigation.
            await initCurrency();
            const { loadView } = await import('./ui.js');
            const { applyPermittedSections, updateActiveNav } = await import('./navigation.js');
            const currentView = window.location.hash.replace('#', '') || 'finance-overview';
            await applyPermittedSections();
            updateActiveNav(currentView);
            loadView(currentView);
        }
        updateFamilySyncIndicator();
    });
    // Keeps the header's 🟢/⚪ family-sync badge reasonably fresh (a cheap
    // reachability ping, not a full sync) — hidden entirely if not
    // connected to a family server at all.
    startFamilySyncIndicatorPolling();

    // --- 5. Register Service Worker for PWA ---
    if ('serviceWorker' in navigator) {
            initSwUpdateTracking(); // must run before register() so no controllerchange is missed
            navigator.serviceWorker.register('serviceWorker.js', { scope: './' })
            .then(reg => {
                if (reg.waiting) {
                    showUpdateToast(reg.waiting);
                }
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        // 'installed' fires only if the worker waits; this app's worker skips
                        // waiting, so also offer the toast once it has activated and taken over.
                        if ((newWorker.state === 'installed' || newWorker.state === 'activated') && (navigator.serviceWorker.controller || isPageStale())) {
                            showUpdateToast(newWorker);
                        }
                    });
                });
            })
            .catch(err => console.error('❌ Service Worker registration failed:', err));
    }

    // --- 6. Setup connection monitoring ---
    window.addEventListener('online', updateConnectionIcon);
    window.addEventListener('offline', () => {
        updateConnectionIcon();
        showOfflineBanner();
    });
    updateConnectionIcon();

    // --- 7. If offline at startup, show offline banner ---
    if (!navigator.onLine) {
        showOfflineBanner();
    }

    // --- 8. Setup Install / Dismiss button handlers ---
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) {
                console.warn('⚠️ Install prompt event not available');
                hideInstallBanner();
                return;
            }
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hideInstallBanner();
        });
    }
    
    const installDismissBtn = document.getElementById('installDismiss');
    if (installDismissBtn) {
        installDismissBtn.addEventListener('click', () => {
            hideInstallBanner();
        });
    }

});
// --------------------------
// Service Worker Debugging
// --------------------------
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(registration => {
        if (registration) {
            
            // Request cache status from SW
            if (registration.active) {
                registration.active.postMessage({ type: 'GET_CACHE_STATUS' });
            }
        } else {
        }
    });

    // Listen for messages from Service Worker
    navigator.serviceWorker.addEventListener('message', event => {
    });
}


// ---------------------------------------------------------------------------
// Phone header auto-hide: slide the top bar away while scrolling down and
// bring it back on any scroll up (or at the top of the page), so reading
// screens get the full height. Pairs with header.header-hidden in styles.css.
// ---------------------------------------------------------------------------
(function initHeaderAutoHide() {
    const header = document.querySelector('header');
    if (!header) return;
    const isPhone = () => window.matchMedia('(max-width: 768px)').matches;
    // In this app <body> (not the window) is the element that scrolls, and
    // scroll events don't bubble, so listen in the capture phase and read
    // whichever of window/html/body actually moved. Inner scrollers (tables,
    // modals, drawers) are ignored.
    const pageY = (t) => (t === document || t === window)
        ? window.scrollY
        : (t === document.body || t === document.documentElement) ? t.scrollTop : null;
    let lastY = 0;
    let ticking = false;
    let latest = 0;

    const show = () => header.classList.remove('header-hidden');
    const hide = () => header.classList.add('header-hidden');

    function update() {
        ticking = false;
        const y = Math.max(0, latest);
        const dy = y - lastY;
        if (!isPhone() || y < 24) { show(); lastY = y; return; }
        if (document.getElementById('mobileNavDrawer')?.classList.contains('open')) { show(); lastY = y; return; }
        if (dy > 10 && y > 80) { hide(); lastY = y; }
        else if (dy < -6) { show(); lastY = y; }
    }

    window.addEventListener('scroll', (e) => {
        const y = pageY(e.target);
        if (y === null) return;
        latest = y;
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true, capture: true });
    window.addEventListener('hashchange', () => { show(); lastY = 0; });
    window.addEventListener('resize', show);
})();
