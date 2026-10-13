// ============================================================================
// 💰 Dashers Finance Manager – Service Worker
// ----------------------------------------------------------------------------
// Full offline support with enhanced iOS compatibility and error handling
// ============================================================================

//const CACHE_NAME = 'budget-tracker-v35-debug'; // 🚨 Added -debug suffix commented to use import cache version form version.js

const CACHE_VERSION = "v1.15.55";   // Bumped specifically to force this file's own bytes to change: browsers only re-check/update a service worker when the SW script itself differs, so any change to precached assets (settings.js, familySync.js, etc.) never reaches an already-visited browser without this. This was very likely the real cause of a long debugging session where JS-level fixes appeared to have zero effect no matter how thoroughly the browser's storage/cache was cleared — the old SW registration and its cache can survive a normal clear. Bumped again (v1.13.0 -> v1.14.0) when js/heroDashboard.js + the toolbar's "New look" toggle were added to dashboard.js/styles.css, for the exact same reason — this cache-first SW would otherwise keep serving the pre-hero-dashboard bytes of those files forever to anyone who'd already loaded the app once. Bumped again (v1.14.1 -> v1.14.2) for the Quick Look credit card's restyle to the hero-net-card look (js/quickLook.js + css/styles.css), same reason. Bumped again (v1.14.2 -> v1.14.3) to align the credit card's mini-card/ring/sparkline colours to the hero card's actual accent/success/danger theme tokens instead of the old Finance Overview palette. Bumped again (v1.14.3 -> v1.14.4) to drop the nested mini-card tile from the Quick Look credit card entirely, so balance/ring/owing/breakdown/sparkline all sit directly inside the single hero-net-card container instead of one card holding another. Bumped again (v1.14.4 -> v1.14.5) because the app was completely broken offline: js/app.js (the entry point) statically imports js/superRecurringJob.js, and js/ui.js (the page router) statically imports js/superannuation.js and, transitively, js/loanWhatIf.js (via loans.js) and js/investmentCalculations.js (via tax_compliance.js) - none of those four files were in PRECACHE_URLS. An uncached script gets served the fetch handler's exports-free stub when offline, so importing named exports from it throws, which means app.js/ui.js themselves failed to resolve and the whole app failed to boot offline, not just those individual features - same class of bug as the exportimport.js/costbase.js/maskable_icon.png fixes above, just in the static import graph instead of a filename typo. Bumped again (v1.14.11 -> v1.14.12) for the Rates & Land Tax fix: added js/ratesAndTax.js (now also added to PRECACHE_URLS below) and changed bills.js/financeOverview.js/properties.js — without this bump, every one of those JS-level fixes keeps being served from the old cached bytes indefinitely, no matter how the app-level storage is cleared, per the note above. Bumped again (v1.14.12 -> v1.14.13) for the Rates & Taxes card's own FY prev/next nav (financeOverview.js + the new .fo-mini-period-nav/.fo-mini-period-btn/.fo-mini-period-label rules in styles.css), same reason as every bump above. Bumped again (v1.14.13 -> v1.14.14) to fold unpaid Bills into the Rates & Land Tax figures too (ratesAndTax.js/financeOverview.js/properties.js), same reason as every bump above. Bumped again (v1.14.14 -> v1.14.15) to fold unpaid property-linked Bills (any category, not just Rates/Land Tax) into the Property Expenses page's "Unpaid Bills" summary and expense list (expenses.js's getAllPropertyExpenses()), same reason as every bump above. Bumped again (v1.14.15 -> v1.14.16) for the new Vehicle Rego Matching feature: added js/vehicleMatchTool.js (now also added to PRECACHE_URLS below) and changed transactions.js/vehicles.js/settings.js — without this bump, an already-visited browser keeps running the old bytes of all three indefinitely, and (worse) would never even learn vehicleMatchTool.js exists, since a file missing from precache doesn't get fetched proactively — same reason as every bump above. Bumped again (v1.14.16 -> v1.14.17) for the "Check for Updates" button in Settings: it used to report its result as a bottom toast, which auto-dismissed after 5s and was easy to miss/dismiss without reading (looked like "does nothing"). Replaced with a centered modal (settings.js's new showInfoModal) that has to be explicitly dismissed with OK, or with an "Update" button when a new version genuinely is available. Same reason as every bump above: without this, an already-visited browser keeps the old toast-only behaviour indefinitely. Bumped again (v1.14.17 -> v1.14.18) for the long-press debug console (js/debugConsole.js): it was positioned with a flat bottom:10px/60px that put the 🪵 button right on top of .bottom-nav on any phone (a fixed 54px bar) and ignored the iOS safe-area inset, it only ever listened for touch events (so it silently could never fire on a mouse-driven desktop browser), the header's <h1> had no protection against iOS's own long-press text-selection callout stealing the gesture, and revealing the button was a separate step from opening the panel. All fixed — same reason as every bump above: without this bump, an already-visited browser keeps running the old broken version of this file indefinitely. Bumped again (v1.14.18 -> v1.14.19) because the debug console panel only ever intercepted console.log to display in-app — and this codebase has zero console.log call sites; its actual diagnostics are 76 console.error and 25 console.warn calls, none of which were being captured, so the panel showed essentially nothing (looked like an empty single line). It now mirrors console.log/warn/error plus uncaught window 'error'/'unhandledrejection' events, colour-codes them, and gives the panel a real header/Clear button/min-height instead of collapsing to its padding when near-empty. Same reason as every bump above. Bumped again (v1.14.19 -> v1.14.20) for vehicle fuel tracking: added js/vehicleFuelStats.js (also added to PRECACHE_URLS below, since vehicles.js and transactions.js now import it) and changed transactions.js/vehicles.js/vehicleMatchTool.js/settings.js. Same reason as every bump above. Bumped again (v1.14.20 -> v1.14.21) for the Transactions page: filters/search/sort/quick Year-Month jump/scroll now survive a save, edit, delete or import (transactions.js), and the phone search box gets its own full-width row instead of a tiny sliver (styles.css). Same reason as every bump above. Bumped again (v1.14.21 -> v1.14.22) because the Transactions search box was still a ~180px sliver above 768px wide (styles.css: new min-width:769px rules give it a real width and height). Same reason as every bump above. Bumped again (v1.14.22 -> v1.14.23) for fuel vehicle learning (vehicleFuelStats.js suggestVehicleForFuel, used by transactions.js and vehicleMatchTool.js). Same reason as every bump above. Bumped again (v1.14.23 -> v1.14.24) so older imported fuel/rego transactions can be assigned a vehicle in bulk from the Review tool (vehicleMatchTool.js). Same reason as every bump above. Bumped again (v1.14.24 -> v1.14.27) for the new Expenses by Category chart on the Reports page (reports.js + css/styles.css). Same reason as every bump above. Bumped again (v1.14.25 -> v1.14.27) for named budget templates (js/budgets.js, js/db.js DB_VERSION 27, js/familySync.js, family-server/permissions.js, css/styles.css). Bumped again (v1.14.26 -> v1.14.27) for the two demo budget templates (js/budgets.js). Bumped again (v1.14.27 -> v1.14.28) for budget templates loading as Add-to-existing or Replace (with a save-current-as-template step and a new Remove All Budgets button, js/budgets.js), and the Finance Overview changes: Budget card Top 15 / Lowest 5 / No-spend lists plus a spend-share donut, removal of the separate Top Spending Categories card, the new at-a-glance strip (net worth, debt, cash runway, bills due), and a local-timezone fix for the sparkline month keys (js/financeOverview.js, css/styles.css). Same reason as every bump above. Bumped again (v1.14.28 -> v1.14.29) for the Finance Overview layout fix (every grid track is now minmax(0, ...) so a chart canvas or long row can no longer blow one column out and push the right column off-screen on wide displays), the Budget card Loans row now counting mortgage/loan repayments filed under Housing and Investment Property, and a Budgeted/Spent label on the Budget donut (css/styles.css, js/financeOverview.js). Bumped again (v1.14.29 -> v1.14.30) for removing the built-in demo "Bank Account" / "Wallet" accounts and the demo "Family Home" / "Investment Apartment" properties from the new-database seed, plus a guarded startup cleanup of unused leftover copies (js/db.js, js/app.js). Bumped again (v1.15.21 -> v1.15.22) for the updated Help guide (js/help.js), the "Budget Tracker" -> "Dashers Finance Manager" wording fixes (index.html, app.js, settings.js, ui.js), same reason as every bump above. Bumped again (v1.15.39 -> v1.15.40) because backup files are now named dashers-backup-YYYY-MM-DD.json instead of budget-backup-... (js/backupTools.js), same reason as every bump above. Bumped again (v1.15.48 -> v1.15.49) for the safer restore (new js/restoreItem.js), the status-bar colour that now follows the in-app theme toggle (new js/themeColors.js, themeToggle.js, index.html, manifest.json), same reason as every bump above. Bumped again (v1.15.46 -> v1.15.47) so the import label, file picker and help text no longer promise OFX or Excel files (js/import/modal.js, js/help.js, js/onboarding.js), same reason as every bump above. Bumped again (v1.15.45 -> v1.15.46) for the brand-coloured theme-color/manifest colours (index.html, manifest.json), same reason as every bump above. Bumped again (v1.15.44 -> v1.15.45) to bring the licensing work (post-trial grace, key ids, cancelled-key handling, optional device limit: new js/licenceActivation.js plus licence.js, licenceGate.js, licenceConfig.js, settings.js, help.js) together with the setup-guide polish (js/records.js), same reason as every bump above. Bumped again (v1.15.50 -> v1.15.51) for the page coach: opening a page from the tour now shows a short insight and a "Got it" box that moves around the page's main items (new js/pageCoach.js + js/pageInsights.js, both added to PRECACHE_URLS below; changed js/onboarding.js, js/ui.js, css/styles.css), same reason as every bump above. Bumped again (v1.15.52 -> v1.15.53) for the full-width layout (css/styles.css only): the main area no longer has a 1100-1400px cap or the stray 240px left margin, so it fills the screen on iPad and desktop, same reason as every bump above.
const CACHE_NAME = `dfm-cache-${CACHE_VERSION}`;

const DEBUG = false; // set true for verbose install/fetch logging while developing
const swLog = (...args) => { if (DEBUG) console.log(...args); };

// 🎯 CRITICAL FIX: Expanded cache list with all required files
// NOTE: every entry below was checked against the actual filenames on disk.
// The previous list had several typos (wrong case / wrong name) which meant
// those files silently 404'd during install and were NEVER cached, so the
// app broke for those modules the moment it went offline:
//   './js/exportimport.js'        -> real file is 'exportImport.js' (case)
//   './js/costbase.js'            -> real file is 'cost_base_tracker.js'
//   './assets/icons/maskable_icon.png' -> real file is 'icon-maskable.png'
// It also only listed a subset of the app's JS modules - anything not
// listed relied on being fetched once online before it would work offline.
// The list below includes every module the app actually ships so a fresh
// install is fully offline-capable immediately.
const PRECACHE_URLS = [
  // Root and core files
  './',
  './index.html',
  './manifest.json',

  // CSS (single bundled stylesheet - components/layouts/themes are
  // pre-merged into this file, not loaded separately)
  './css/styles.css',

  // Core Application JS
  './js/app.js',
  './js/dialogs.js',
  './js/features.js',
  './js/releaseConfig.js',
  './js/ui.js',
  './js/db.js',
  './js/debugConsole.js',
  './js/recurringJob.js',
  './js/exportImport.js',
  './js/loanCalculations.js',
  './js/reports.js',
  './js/settings.js',
  './js/emojiPicker.js',
  './js/layoutManager.js',
  './js/version.js',
  './js/chartTheme.js',
  './js/themeToggle.js',
  './js/onboarding.js',
  './js/onboardingState.js',
  './js/restoreItem.js',
  './js/themeColors.js',
  './js/records.js',
  './js/tourContent.js',
  './js/pageInsights.js',
  './js/pageCoach.js',
  './js/userName.js',
  './js/heroDashboard.js',
  './js/navigation.js',
  './js/navItems.js',
  './js/renderNav.js',
  './js/mobileNavDrawer.js',
  './js/mergeCategoriesTool.js',
  './js/appLock.js',
  './js/auth-flow.js',
  './js/sanitize.js',
  './js/merchantRules.js',
  './js/bankCategoryMap.js',
  './js/backupCrypto.js',
  './js/backupTools.js',
  './js/backupReminder.js',
  './js/licence.js',
  './js/licenceActivation.js',
  './js/licenceConfig.js',
  './js/licenceGate.js',
  './js/familySync.js',
  './js/familySyncSections.js',
  './js/charts.js',
  './js/utils/html.js',
  // fixCreditCardTransfers.js was missing here despite being a static
  // top-level import in settings.js ("import { runFixCreditCardTransfers }
  // from './fixCreditCardTransfers.js'") - same class of bug as the four
  // below: on a fresh install, if the device went offline before this one
  // file happened to be fetched online first, the Settings page's module
  // graph would fail to resolve and the whole page would break, not just
  // that one feature.
  './js/fixCreditCardTransfers.js',
  // These four were missing entirely, which is a much bigger problem than
  // "that one feature is unavailable offline": billReminders.js is a
  // static top-level import in app.js itself (the app's core entry
  // point), and accountBalance.js is a static import in nearly every
  // financial page (accounts, dashboard, financeOverview,
  // financialDashboard, loans, quickLook, recurringJob, wealthOverview).
  // The fetch handler's offline fallback for an uncached script returns a
  // stub file with no exports at all - so on a fresh install, if the
  // device ever goes offline before these two specific files happened to
  // be fetched online first, the ES module graph fails to resolve and
  // the app can fail to boot, not just degrade. financialDashboard.js
  // (imported by ui.js, the view router) and propertyMatchTool.js
  // (imported by settings.js) had the same gap for their pages.
  './js/accountBalance.js',
  './js/billReminders.js',
  './js/financialDashboard.js',
  './js/propertyMatchTool.js',

  // The vehicle-side equivalent of propertyMatchTool.js above (added for
  // "Review & Fix Vehicle Rego Matches" in Settings) - same static-import
  // gap if left out: settings.js imports it at the top of the file, so an
  // offline Settings page would fail to load at all, not just be missing
  // that one button.
  './js/vehicleMatchTool.js',

  // Fuel / mileage maths for the Vehicles page (imported by vehicles.js and
  // transactions.js — missing from precache would break both offline).
  './js/vehicleFuelStats.js',

  // Same gap, found later: app.js's own static import of
  // superRecurringJob.js, and ui.js's static import of superannuation.js
  // (plus, transitively through ui.js's own imports of loans.js and
  // tax_compliance.js, loanWhatIf.js and investmentCalculations.js)
  // weren't listed either. Since app.js and ui.js are the entry point and
  // the page router, a missing file anywhere in *their* static import
  // graph broke the whole app offline, not just the Super or Tax pages.
  './js/superRecurringJob.js',
  './js/superannuation.js',
  './js/loanWhatIf.js',
  './js/investmentCalculations.js',

  // Feature Modules
  './js/budgets.js',
  './js/transactions.js',
  './js/accounts.js',
  './js/categories.js',
  './js/defaultCategories.js',
  './js/dashboard.js',
  './js/dashboardTabs.js',
  './js/insurance.js',
  './js/insuranceLinkCheck.js',
  './js/swUpdate.js',
  './js/vehicles.js',
  './js/utils/currency.js',
  './js/quickLook.js',
  './js/wealthOverview.js',
  './js/financeOverview.js',
  './js/institutions.js',
  './js/bills.js',
  './js/calendar.js',
  './js/recurring.js',
  './js/subscriptions.js',
  './js/loans.js',
  './js/properties.js',
  './js/propertyExpenseCategories.js',
  './js/ratesAndTax.js',
  './js/help.js',
  './demo/dasher-demo-data.json',
  './js/recategorizeTool.js',
  './js/tenants.js',
  './js/maintenance.js',
  './js/expenses.js',
  './js/cost_base_tracker.js',
  './js/taxCalculations.js',
  './js/costBaseCalculations.js',
  './js/tax_compliance.js',

  // Import subsystem
  './js/import/bankFormats.js',
  './js/import/categoryMapper.js',
  './js/import/categoryRules.js',
  './js/import/debug.js',
  './js/import/duplicateFinder.js',
  './js/import/merchantCategories.js',
  './js/import/merchantLogos.js',
  './js/import/modal.js',
  './js/import/parser.js',
  './js/import/saver.js',

  // Vendor Libraries
  './js/vendor/chart.umd.min.js',
  './js/vendor/pdfjs/pdf.min.mjs',
  './js/vendor/pdfjs/pdf.worker.min.mjs',
  './js/import/pdfStatement.js',
  './js/recurringMatch.js',

  // Fonts (self-hosted, no external font CDN)
  './assets/fonts/inter-latin-400-normal.woff2',
  './assets/fonts/inter-latin-500-normal.woff2',
  './assets/fonts/inter-latin-600-normal.woff2',
  './assets/fonts/inter-latin-700-normal.woff2',
  './assets/fonts/fraunces-latin-600-normal.woff2',

  // Icons and Assets
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-167.png',
  './assets/icons/icon-180.png',
  './assets/icons/splash/splash-1125x2436.png',
  './assets/icons/splash/splash-1170x2532.png',
  './assets/icons/splash/splash-1179x2556.png',
  './assets/icons/splash/splash-1284x2778.png',
  './assets/icons/splash/splash-1290x2796.png',
  './assets/icons/splash/splash-750x1334.png',
  // Merchant logos (js/import/merchantLogos.js) so they also show on a fresh offline install.
  './assets/logos/711.png',
  './assets/logos/ANZ.png',
  './assets/logos/KFC.png',
  './assets/logos/NAB.png',
  './assets/logos/aami.png',
  './assets/logos/aangan.png',
  './assets/logos/aldi.png',
  './assets/logos/aliexpress.png',
  './assets/logos/amazon.png',
  './assets/logos/amazonmusic.jpeg',
  './assets/logos/amazonprimevideo.jpg',
  './assets/logos/amazonwebservices.png',
  './assets/logos/ambulancevictoria.jpeg',
  './assets/logos/apcofuel.png',
  './assets/logos/apple.jpeg',
  './assets/logos/ato.png',
  './assets/logos/aupost.png',
  './assets/logos/bigw.jpg',
  './assets/logos/boostjuice.jpeg',
  './assets/logos/bunnings.png',
  './assets/logos/caseyKebab.png',
  './assets/logos/chemistWarehouse.png',
  './assets/logos/coles.png',
  './assets/logos/disneyplus.jpeg',
  './assets/logos/dominos.png',
  './assets/logos/ebGames.png',
  './assets/logos/globird.png',
  './assets/logos/goodguys.png',
  './assets/logos/guzmanygomez.jpeg',
  './assets/logos/hannover-real-insurance.jpeg',
  './assets/logos/harveynorman.jpg',
  './assets/logos/hrblock.png',
  './assets/logos/hungryjacks.jpeg',
  './assets/logos/iga.png',
  './assets/logos/jbhifi.jpeg',
  './assets/logos/kmart.jpeg',
  './assets/logos/linkt.jpeg',
  './assets/logos/macDonalds.png',
  './assets/logos/macquaire.jpeg',
  './assets/logos/malaysianairlines.jpeg',
  './assets/logos/malvic.png',
  './assets/logos/marketplace.jpeg',
  './assets/logos/medicare.png',
  './assets/logos/mego.png',
  './assets/logos/microsoft.png',
  './assets/logos/myer.png',
  './assets/logos/myki.jpeg',
  './assets/logos/nandos.jpg',
  './assets/logos/orde.png',
  './assets/logos/originEnergy.png',
  './assets/logos/paypal.png',
  './assets/logos/petstock.jpeg',
  './assets/logos/ptv.jpeg',
  './assets/logos/rebelsports.jpeg',
  './assets/logos/reddyfuel.png',
  './assets/logos/schoolpix.jpeg',
  './assets/logos/sealifeaquarium.jpeg',
  './assets/logos/shell.jpeg',
  './assets/logos/shelly.png',
  './assets/logos/sonoff.png',
  './assets/logos/southeastwater.jpg',
  './assets/logos/specsavers.jpg',
  './assets/logos/sro.png',
  './assets/logos/superloop.png',
  './assets/logos/target.jpeg',
  './assets/logos/temu.png',
  './assets/logos/thelott.jpg',
  './assets/logos/ubereats.jpeg',
  './assets/logos/uniqlo.png',
  './assets/logos/unitedfuel.png',
  './assets/logos/velspices.png',
  './assets/logos/vicroads.png',
  './assets/logos/westfield.jpeg',
  './assets/logos/woolworths.png',
  './assets/logos/xbos.png'
];

// 🚨 DEBUG: Log all URLs that should be cached
swLog('🔍 [SW-DEBUG] PRECACHE_URLS to cache:', PRECACHE_URLS);
swLog(`🔍 [SW-DEBUG] Total URLs to cache: ${PRECACHE_URLS.length}`);



// ============================================================================
// 🏗️ INSTALL – Enhanced caching with comprehensive debugging
// ============================================================================
self.addEventListener('install', event => {
  swLog('📦 [SW] Installing and caching essential files...');
  swLog(`🔍 [SW-DEBUG] Install event triggered at: ${new Date().toISOString()}`);

  // 🚨 CRITICAL FIX: Use waitUntil to ensure installation completes
  event.waitUntil(
    (async () => {
      try {
        swLog('🔍 [SW-DEBUG] Opening cache:', CACHE_NAME);
        const cache = await caches.open(CACHE_NAME);
        swLog(`✅ Cache opened: ${CACHE_NAME}`);
        
        // 🚨 DEBUG: Check cache before adding
        const existingKeys = await cache.keys();
        swLog(`🔍 [SW-DEBUG] Existing cache entries before install: ${existingKeys.length}`);
        
        // Enhanced caching with individual error handling
        const cachePromises = PRECACHE_URLS.map(async (url, index) => {
          try {
            swLog(`🔍 [SW-DEBUG] Attempting to cache [${index + 1}/${PRECACHE_URLS.length}]: ${url}`);
            
            // Use 'no-cache' to ensure we get the latest version
            const fetchOptions = {
              cache: 'no-cache',
              headers: { 'Pragma': 'no-cache' }
            };
            
            swLog(`🔍 [SW-DEBUG] Fetching: ${url}`);
            const response = await fetch(url, fetchOptions);
            
            if (response.ok) {
              swLog(`🔍 [SW-DEBUG] Successfully fetched ${url}, status: ${response.status}`);
              await cache.put(url, response);
              swLog(`✅ Successfully cached: ${url}`);
              return { url, status: 'success', size: response.headers.get('content-length') };
            } else {
              console.warn(`⚠️ Failed to cache ${url}: HTTP ${response.status} - ${response.statusText}`);
              swLog(`🔍 [SW-DEBUG] Response headers:`, Object.fromEntries(response.headers.entries()));
              return { url, status: 'failed', reason: `HTTP ${response.status}` };
            }
          } catch (error) {
            console.warn(`⚠️ Could not cache ${url}:`, error.message);
            console.error(`🔍 [SW-DEBUG] Error details:`, error);
            return { url, status: 'failed', reason: error.message };
          }
        });

        swLog('🔍 [SW-DEBUG] Starting cache process...');
        const results = await Promise.allSettled(cachePromises);
        
        // 🚨 DEBUG: Analyze cache results
        const successful = results.filter(r => 
          r.status === 'fulfilled' && r.value.status === 'success'
        ).length;
        
        const failed = results.filter(r => 
          r.status === 'fulfilled' && r.value.status === 'failed'
        ).length;
        
        const rejected = results.filter(r => r.status === 'rejected').length;
        
        swLog(`📊 Cache Summary: ${successful} successful, ${failed} failed, ${rejected} rejected`);
        
        // 🚨 DEBUG: Log failed URLs
        if (failed > 0 || rejected > 0) {
          console.warn('🚨 FAILED/RESJECTED CACHE ATTEMPTS:');
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.warn(`❌ [${index}] ${PRECACHE_URLS[index]} - REJECTED:`, result.reason);
            } else if (result.value.status === 'failed') {
              console.warn(`❌ [${index}] ${PRECACHE_URLS[index]} - FAILED:`, result.value.reason);
            }
          });
        }

        // 🚨 DEBUG: Verify what's actually in cache
        const finalKeys = await cache.keys();
        swLog(`🔍 [SW-DEBUG] Final cache entries: ${finalKeys.length}`);
        finalKeys.forEach((request, index) => {
          swLog(`🔍 [SW-DEBUG] Cache entry ${index + 1}: ${request.url}`);
        });

        // 🚨 CRITICAL FIX: Force immediate activation (iOS compatibility)
        swLog('🔍 [SW-DEBUG] Skipping waiting phase...');
        await self.skipWaiting();
        swLog('✅ [SW] Installation completed - skipping waiting');
        
      } catch (error) {
        console.error('❌ [SW] Installation failed:', error);
        // Even if installation fails, we don't want to break the app
      }
    })()
  );
});

// ============================================================================
// ♻️ ACTIVATE – Enhanced cleanup and client control with debugging
// ============================================================================
self.addEventListener('activate', event => {
  swLog('♻️ [SW] Activating service worker and cleaning old caches...');
  swLog(`🔍 [SW-DEBUG] Activate event at: ${new Date().toISOString()}`);

  event.waitUntil(
    (async () => {
      try {
        // Clean up old caches
        const cacheKeys = await caches.keys();
        swLog(`🔍 [SW-DEBUG] Found caches:`, cacheKeys);
        
        const deletePromises = cacheKeys.map(key => {
          if (key !== CACHE_NAME) {
            swLog(`🗑️ Deleting old cache: ${key}`);
            return caches.delete(key);
          }
        });
        
        await Promise.all(deletePromises);
        swLog('✅ Old caches cleaned up');
        
        // 🚨 DEBUG: Verify current cache contents
        const currentCache = await caches.open(CACHE_NAME);
        const currentKeys = await currentCache.keys();
        swLog(`🔍 [SW-DEBUG] Current cache "${CACHE_NAME}" has ${currentKeys.length} entries`);
        
        // 🚨 CRITICAL FIX: Take immediate control of all clients
        swLog('🔍 [SW-DEBUG] Claiming clients...');
        await self.clients.claim();
        swLog('✅ [SW] Now controlling all clients');
        
        // Notify all clients about activation
        const clients = await self.clients.matchAll();
        swLog(`🔍 [SW-DEBUG] Found ${clients.length} clients to notify`);
        
        clients.forEach(client => {
          client.postMessage({ 
            type: 'SW_ACTIVATED',
            version: CACHE_NAME,
            timestamp: new Date().toISOString(),
            cacheSize: currentKeys.length,
            debug: true
          });
        });
        
      } catch (error) {
        console.error('❌ [SW] Activation failed:', error);
      }
    })()
  );
});

// ============================================================================
// 🌍 FETCH – Enhanced caching strategy with detailed debugging
// ============================================================================
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  swLog(`🔍 [SW-FETCH] Intercepted: ${request.method} ${request.url}`);
  swLog(`🔍 [SW-FETCH] Destination: ${request.destination}, Mode: ${request.mode}`);

  // 🚫 Skip non-GET requests and cross-origin requests
  if (request.method !== 'GET') {
    swLog(`🔍 [SW-FETCH] Skipping non-GET request: ${request.method}`);
    return;
  }

    // 🚫 Block source map requests to avoid 404 errors
  if (request.url.endsWith('.map')) {
    event.respondWith(new Response('', { status: 204 }));
    return;
  }

  if (!request.url.startsWith(self.location.origin)) {
    swLog(`🔍 [SW-FETCH] Skipping cross-origin request: ${request.url}`);
    return;
  }

  // 🚫 Block source map requests
  if (request.url.endsWith('.map')) {
    swLog(`🔍 [SW-FETCH] Blocking source map: ${request.url}`);
    event.respondWith(new Response('', { status: 204 }));
    return;
  }

  // 🎯 STRATEGY: Cache-first with network fallback for optimal offline support
  event.respondWith(
    (async () => {
      swLog(`🔍 [SW-FETCH] Processing: ${request.url}`);
      const cache = await caches.open(CACHE_NAME);
      
      try {
        // First, try to get from cache
        swLog(`🔍 [SW-FETCH] Checking cache for: ${request.url}`);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
          swLog(`📂 Serving from cache: ${request.url}`);
          
          // Opportunistically refresh the cache in the background. This
          // used to be gated on navigator.onLine, but that only reflects
          // whether the network *interface* is up, not whether this
          // specific host is actually reachable (e.g. Netlify is down but
          // wifi is fine) - navigator.onLine would still read true, so the
          // gate did nothing useful. Just attempting the fetch and letting
          // the try/catch below absorb a failure is the only real test,
          // and either way this runs in the background and never blocks
          // the cached response from being returned immediately.
          event.waitUntil(
            (async () => {
              try {
                const networkResponse = await fetch(request);
                if (networkResponse.ok) {
                  await cache.put(request, networkResponse);
                  swLog(`🔄 Updated cache in background: ${request.url}`);
                } else {
                  console.warn(`🔍 [SW-FETCH] Background update failed: HTTP ${networkResponse.status}`);
                }
              } catch (error) {
                console.warn(`🔍 [SW-FETCH] Background update error (host unreachable):`, error.message);
              }
            })()
          );
          
          return cachedResponse;
        }

        swLog(`🔍 [SW-FETCH] Not in cache: ${request.url}`);
        
        // Not cached - try the network directly. Same reasoning as above:
        // no navigator.onLine gate, just attempt it and let the catch
        // below handle an unreachable host the same way it handles being
        // genuinely offline.
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
          // Clone response before caching (Response can only be read once)
          const responseClone = networkResponse.clone();
          await cache.put(request, responseClone);
          swLog(`✅ Fetched and cached: ${request.url}`);
          return networkResponse;
        } else {
          console.warn(`🔍 [SW-FETCH] Network response not OK: HTTP ${networkResponse.status}`);
          throw new Error(`HTTP ${networkResponse.status}`);
        }
        
      } catch (error) {
        console.warn(`📴 Offline/error for: ${request.url}`, error.message);
        
        // 🎯 Enhanced offline fallbacks based on file type
        const destination = request.destination || 'document';
        swLog(`🔍 [SW-FETCH] Using fallback for destination: ${destination}`);
        
        switch (destination) {
          case 'document':
          case '': // Some requests don't have destination
            // Try to return the main page for navigation requests
            swLog(`🔍 [SW-FETCH] Trying fallback HTML for: ${request.url}`);
            const fallbackHtml = await cache.match('./index.html');
            if (fallbackHtml) {
              swLog(`🔍 [SW-FETCH] Using HTML fallback for: ${request.url}`);
              return fallbackHtml;
            }
            break;
            
          case 'script':
            swLog(`🔍 [SW-FETCH] Using script fallback for: ${request.url}`);
            return new Response(
              `/* 📴 Script offline: ${request.url} */`,
              { headers: { 'Content-Type': 'application/javascript' } }
            );
            
          case 'style':
            swLog(`🔍 [SW-FETCH] Using style fallback for: ${request.url}`);
            return new Response(
              `/* 📴 Styles offline: ${request.url} */`,
              { headers: { 'Content-Type': 'text/css' } }
            );
            
          case 'image':
            swLog(`🔍 [SW-FETCH] Using image fallback for: ${request.url}`);
            // Return a transparent pixel for missing images
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
        }
        
        // Generic offline response
        console.warn(`🔍 [SW-FETCH] Using generic fallback for: ${request.url}`);
        return new Response(
          `📴 Offline - "${request.url}" not available`,
          { 
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-cache'
            }
          }
        );
      }
    })()
  );
});

// ============================================================================
// 📨 MESSAGE HANDLING – Enhanced communication with main app
// ============================================================================
self.addEventListener('message', event => {
  swLog('📨 [SW] Received message:', event.data);
  swLog(`🔍 [SW-DEBUG] Message event at: ${new Date().toISOString()}`, event.data);
  
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      swLog('⚡ [SW] Skip waiting triggered');
      self.skipWaiting();
      break;
      
    case 'UPDATE_CACHE':
      swLog('🔄 [SW] Manual cache update requested');
      updateSpecificCache(data?.urls);
      break;
      
    case 'GET_CACHE_STATUS':
      swLog('🔍 [SW] Cache status requested');
      event.ports[0]?.postMessage({
        type: 'CACHE_STATUS',
        cacheName: CACHE_NAME,
        cachedUrls: PRECACHE_URLS,
        debug: true,
        timestamp: new Date().toISOString()
      });
      break;
      
    case 'CLEAR_CACHE':
      swLog('🗑️ [SW] Clear cache requested');
      clearOldCaches();
      break;
      
    case 'DEBUG_CACHE_CONTENTS':
      swLog('🔍 [SW] Debug cache contents requested');
      debugCacheContents(event);
      break;
  }
});

// ============================================================================
// 🛠️ UTILITY FUNCTIONS
// ============================================================================

/**
 * Update specific URLs in cache
 */
async function updateSpecificCache(urls = PRECACHE_URLS) {
  swLog(`🔍 [SW-DEBUG] updateSpecificCache called with ${urls.length} URLs`);
  
  try {
    const cache = await caches.open(CACHE_NAME);
    const updatePromises = urls.map(async url => {
      try {
        swLog(`🔍 [SW-DEBUG] Updating: ${url}`);
        const response = await fetch(url, { cache: 'no-cache' });
        if (response.ok) {
          await cache.put(url, response);
          swLog(`🔄 Updated: ${url}`);
          return { url, status: 'updated' };
        } else {
          console.warn(`⚠️ Update failed for ${url}: HTTP ${response.status}`);
          return { url, status: 'failed', error: `HTTP ${response.status}` };
        }
      } catch (error) {
        console.warn(`⚠️ Could not update ${url}:`, error.message);
        return { url, status: 'failed', error: error.message };
      }
    });
    
    const results = await Promise.allSettled(updatePromises);
    swLog('✅ Cache update completed', results);
    
    // Notify clients about update completion
    notifyClients({
      type: 'CACHE_UPDATE_COMPLETE',
      results: results
    });
    
  } catch (error) {
    console.error('❌ Cache update failed:', error);
  }
}

/**
 * Clear all old caches except current
 */
async function clearOldCaches() {
  try {
    const cacheKeys = await caches.keys();
    swLog(`🔍 [SW-DEBUG] Clearing caches. Found:`, cacheKeys);
    
    const deletePromises = cacheKeys.map(key => {
      if (key !== CACHE_NAME) {
        swLog(`🗑️ Deleting cache: ${key}`);
        return caches.delete(key);
      }
    });
    
    await Promise.all(deletePromises);
    swLog('✅ All old caches cleared');
    
  } catch (error) {
    console.error('❌ Error clearing caches:', error);
  }
}

/**
 * Debug: Get current cache contents
 */
async function debugCacheContents(event) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const contents = await Promise.all(
      keys.map(async (request, index) => {
        const response = await cache.match(request);
        return {
          url: request.url,
          status: response?.status || 'no-response',
          size: response?.headers.get('content-length') || 'unknown',
          type: response?.headers.get('content-type') || 'unknown'
        };
      })
    );
    
    event.ports[0]?.postMessage({
      type: 'DEBUG_CACHE_CONTENTS',
      cacheName: CACHE_NAME,
      totalEntries: contents.length,
      entries: contents,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Debug cache contents failed:', error);
    event.ports[0]?.postMessage({
      type: 'DEBUG_CACHE_ERROR',
      error: error.message
    });
  }
}

/**
 * Notify all clients about updates
 */
async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll();
    swLog(`🔍 [SW-DEBUG] Notifying ${clients.length} clients:`, message);
    
    clients.forEach(client => {
      client.postMessage({
        type: 'SW_MESSAGE',
        timestamp: new Date().toISOString(),
        ...message
      });
    });
  } catch (error) {
    console.error('❌ Failed to notify clients:', error);
  }
}

// ============================================================================
// 📡 LIFECYCLE EVENT LISTENERS
// ============================================================================

self.addEventListener('controllerchange', () => {
  swLog('🔁 [SW] Controller changed - new service worker activated');
  swLog(`🔍 [SW-DEBUG] Controller change at: ${new Date().toISOString()}`);
  
  notifyClients({
    type: 'CONTROLLER_CHANGED',
    message: 'New service worker is now active',
    version: CACHE_NAME
  });
});

self.addEventListener('waiting', (event) => {
  swLog('🕓 [SW] Update waiting - notify clients to reload');
  swLog(`🔍 [SW-DEBUG] Waiting event at: ${new Date().toISOString()}`);
  
  notifyClients({
    type: 'UPDATE_AVAILABLE',
    message: 'A new version is available. Please reload.',
    version: CACHE_NAME
  });
});

// Periodic cache validation (every 24 hours)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cache-validation') {
    swLog('🔄 [SW] Periodic sync triggered for cache validation');
    event.waitUntil(updateSpecificCache());
  }
});

swLog('✅ Service Worker loaded');
swLog(`🔍 [SW-DEBUG] Service Worker scope: ${self.registration?.scope || 'unknown'}`);
swLog(`🔍 [SW-DEBUG] Service Worker state: ${self.state || 'unknown'}`);