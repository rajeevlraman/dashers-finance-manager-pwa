// ui.js
import { isViewLocked, renderUpgradePage } from './licenceGate.js';
import { initBudgetsUI } from './budgets.js';
import { getAllItems, STORE_NAMES } from './db.js';
import { unpricedCurrencies, getBaseCurrency } from './utils/currency.js';
import { initTransactionsUI } from './transactions.js';
import { initAccountsUI } from './accounts.js';
import { initCategoriesUI } from './categories.js';
import { initReportsUI } from './reports.js';
import { initDashboardUI, cleanupDashboard } from './dashboard.js';
import { initDashboardTabsUI, cleanupDashboardTabs } from './dashboardTabs.js';
import { initSettingsUI } from './settings.js';
import { initHelpUI } from './help.js';
import { initBillsUI } from './bills.js';
import { initCalendarUI } from './calendar.js';
import { initRecurringUI } from './recurring.js';
import { initSubscriptionsUI } from './subscriptions.js';
import { initLoansUI } from './loans.js'; // Add static import like others
import { initPropertiesUI } from './properties.js';
import { initTenantsUI } from './tenants.js';
import { initInsuranceUI } from './insurance.js';
import { initVehiclesUI } from './vehicles.js';
import { initMaintenanceUI } from './maintenance.js';
import { initExpensesUI } from './expenses.js';
import { initSuperannuationUI } from './superannuation.js';
//import { initPropertyDashboardUI } from './dashboardProperties.js';
//import { initDashboardMobileUI } from './dashboard_mobile.js';
//import { initDashboardMobileV2UI } from './dashboard_mobile_v2.js';
import { initTaxComplianceUI } from './tax_compliance.js';
import { initCostBaseTrackerUI } from './cost_base_tracker.js';
//import { initDashboardMobileV3UI } from './dashboard_mobile_v3_ui.js';
import { initCategoryMapper } from './import/categoryMapper.js';
import { initFinancialDashboardUI, cleanupFinancialDashboard } from './financialDashboard.js';
import { initWealthOverviewUI, cleanupWealthOverview } from './wealthOverview.js';
import { initFinanceOverviewUI, cleanupFinanceOverview } from './financeOverview.js';

initCategoryMapper();

// ============================================================================
// 📱 BOTTOM NAVIGATION ENHANCEMENTS
// ============================================================================

function initBottomNavigation() {
  const bottomNav = document.querySelector('.bottom-nav');
  const mainContent = document.getElementById('mainContent');
  
  if (!bottomNav) {
    return;
  }
  
  
  // Update active state based on current view
  function updateActiveNav() {
    const currentView = window.location.hash.replace('#', '') || 'finance-overview';
    const navLinks = bottomNav.querySelectorAll('a');
    
    navLinks.forEach(link => {
      const view = link.getAttribute('data-view');
      if (view === currentView) {
        link.classList.add('active');
        // Add loading animation
        link.classList.add('nav-loading');
        setTimeout(() => {
          link.classList.remove('nav-loading');
        }, 600);
      } else {
        link.classList.remove('active');
        link.classList.remove('nav-loading');
      }
    });
    
    // Also update sidebar nav if it exists
    const sidebarLinks = document.querySelectorAll('nav:not(.bottom-nav) a[data-view]');
    sidebarLinks.forEach(link => {
      const view = link.getAttribute('data-view');
      link.classList.toggle('active', view === currentView);
    });
  }
  
  // Add enhanced click handlers
  bottomNav.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    
    e.preventDefault();
    const view = link.getAttribute('data-view');
    
    if (!view) return;
    
    // Add immediate visual feedback
    link.classList.add('nav-tap');
    
    // Update URL and load view
    window.location.hash = view;
    
    // Remove tap effect after animation
    setTimeout(() => {
      link.classList.remove('nav-tap');
    }, 300);
  });
  
  // Add glass effect on scroll for modern look
  let lastScrollTop = 0;
  const scrollHandler = () => {
    if (window.innerWidth > 768) return; // Only on mobile
    
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    if (scrollTop > lastScrollTop && scrollTop > 50) {
      // Scrolling down - add glass effect
      bottomNav.classList.add('glass');
    } else {
      // Scrolling up - remove glass effect
      bottomNav.classList.remove('glass');
    }
    
    lastScrollTop = scrollTop;
  };
  
  // Use passive scroll listener for performance
  window.addEventListener('scroll', scrollHandler, { passive: true });
  
  // Update active state on hash change
  window.addEventListener('hashchange', updateActiveNav);
  
  // Handle responsive behavior
  function handleResponsiveNav() {
    if (window.innerWidth <= 768) {
      // Mobile - show bottom nav, hide sidebar
      bottomNav.style.display = 'flex';
      const sidebar = document.querySelector('nav:not(.bottom-nav)');
      if (sidebar) sidebar.style.display = 'none';
      
      // Ensure main content has bottom padding
      mainContent.style.paddingBottom = '80px';
    } else {
      // Desktop - hide bottom nav, show sidebar
      bottomNav.style.display = 'none';
      const sidebar = document.querySelector('nav:not(.bottom-nav)');
      if (sidebar) sidebar.style.display = 'block';
      
      // Remove bottom padding
      mainContent.style.paddingBottom = '0';
    }
  }
  
  // Initial setup
  handleResponsiveNav();
  updateActiveNav();
  
  // Handle window resize
  window.addEventListener('resize', handleResponsiveNav);

  // `position: fixed; bottom: 0` is supposed to sit flush against the
  // true bottom of the screen, but on many mobile browsers it's actually
  // pinned to a layout viewport that lags behind the real, currently
  // visible one — most noticeably while the address bar is animating
  // open/closed, and in some in-app/WebView browsers all the time. The
  // symptom is a strip of page background revealed under the bar instead
  // of the bar sliding down with it. window.visualViewport reports the
  // real visible area in real time regardless of that lag, so use it to
  // actively hold the bar flush against the true bottom edge.
  if (window.visualViewport) {
    const pinToVisualViewport = () => {
      if (window.innerWidth > 768) {
        bottomNav.style.transform = '';
        return;
      }
      const vv = window.visualViewport;
      const gap = window.innerHeight - (vv.height + vv.offsetTop);
      bottomNav.style.transform = gap > 0.5 ? `translateY(-${gap}px)` : '';
    };
    window.visualViewport.addEventListener('resize', pinToVisualViewport);
    window.visualViewport.addEventListener('scroll', pinToVisualViewport);
    pinToVisualViewport();
  }
}

// ============================================================================
// 🎯 NAVIGATION FUNCTIONS
// ============================================================================

function setActiveNav(view) {
  // Update bottom navigation
  document.querySelectorAll('.bottom-nav a').forEach(link => {
    const linkView = link.getAttribute('data-view');
    const isActive = linkView === view;
    link.classList.toggle('active', isActive);
    
    // Add pulse effect for active item
    if (isActive) {
      link.classList.add('nav-pulse');
      setTimeout(() => {
        link.classList.remove('nav-pulse');
      }, 1000);
    }
  });
  
  // Update sidebar navigation (if exists)
  document.querySelectorAll('nav:not(.bottom-nav) a[data-view]').forEach(link => {
    const isActive = link.getAttribute('data-view') === view;
    link.classList.toggle('active', isActive);
    // The bar scrolls horizontally now that every section is a flat,
    // single-row list, so keep whichever item is active scrolled into
    // view instead of leaving it hidden off to the side.
    if (isActive) {
      link.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  });
}

// ============================================================================
// 📄 VIEW LOADING
// ============================================================================

// Every navigation gets a number. If someone clicks page B while page A is still
// loading, A's late error must not paint "Error Loading A" over page B (and A's
// leftover script errors are just noise), so stale loads stay quiet.
let navToken = 0;

export async function loadView(view) {
  const myNav = ++navToken;
  const isStale = () => myNav !== navToken;

  // The dashboard's "Live Data" toggle starts a 30-second setInterval that
  // re-renders the dashboard into #mainContent. Nothing was ever stopping
  // that timer when you navigated away, so it kept firing in the
  // background and would silently overwrite whatever page you'd moved to
  // with the dashboard again. Stopping it here, unconditionally, on every
  // navigation (harmless no-op if it wasn't running) fixes that for good.
  cleanupDashboard();
  cleanupDashboardTabs();
  cleanupFinancialDashboard();
  cleanupWealthOverview();
  cleanupFinanceOverview();

  // Update navigation immediately for better UX
  setActiveNav(view);

  const main = document.getElementById('mainContent');

  // Edition gating: pages outside the activated licence edition show an
  // upgrade screen instead (no-op while licensing is off or in the trial).
  if (isViewLocked(view)) {
    renderUpgradePage(view, main);
    return;
  }
  
  // Show loading state with smooth transition
  main.style.opacity = '0.7';
  main.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading ${view.replace('-', ' ')}...</p>
    </div>
  `;

  try {
    // Add small delay for smooth transition
    await new Promise(resolve => setTimeout(resolve, 100));
    
    switch (view) {
      case 'dashboard': 
        await initDashboardUI(); 
        break;
      case 'dashboard-tabs':
        await initDashboardTabsUI();
        break;
      case 'financial-dashboard':
        await initFinancialDashboardUI();
        break;
      case 'wealth-overview':
        await initWealthOverviewUI();
        break;
      case 'finance-overview':
        await initFinanceOverviewUI();
        break;
      case 'transactions': 
        await initTransactionsUI(); 
        break;
      case 'budgets': 
        await initBudgetsUI(); 
        break;
      case 'accounts': 
        await initAccountsUI(); 
        break;
      case 'categories': 
        await initCategoriesUI(); 
        break;
      case 'reports': 
        await initReportsUI(); 
        break;
      case 'calendar': 
        await initCalendarUI(); 
        break;
      case 'bills': 
        await initBillsUI(); 
        break;
      case 'recurring': 
        await initRecurringUI(); 
        break;
      case 'subscriptions':
        await initSubscriptionsUI();
        break;
      case 'settings': 
        await initSettingsUI(); 
        break;
      case 'help':
        await initHelpUI();
        break;
      case 'loans': 
      case 'loans-whatif':
        // 'loans-whatif' is not a separate page — it's a nav shortcut that
        // renders the same Loans page and then jumps straight to the
        // What-If Payoff Modeler section further down it (see the
        // scroll-to-section handling below, which runs instead of the
        // usual scroll-to-top for this one view).
        await initLoansUI();
        break;
      case 'properties': 
        await initPropertiesUI(); 
        break;
      case 'tenants':
        await initTenantsUI();
        break;
      case 'insurance':
        await initInsuranceUI();
        break;
      case 'vehicles':
        await initVehiclesUI();
        break;
      case 'maintenance':
        await initMaintenanceUI();
        break;
      case 'expenses':
        await initExpensesUI();
        break;
      case 'tax':
        await initTaxComplianceUI();
        break;
      case 'costbase':
        await initCostBaseTrackerUI();
        break;
      case 'superannuation':
        await initSuperannuationUI();
        break;

      default:
        main.innerHTML = `
          <div class="page-container">
            <div class="page-header">
              <h2>Welcome to Dashers Finance Manager</h2>
            </div>
            <div class="section-card">
              <p>Select a tab to begin managing your finances.</p>
            </div>
          </div>
        `;
    }
    
    // Restore opacity
    main.style.opacity = '1';
    showMissingRateBanner(main);
    
  } catch (error) {
    if (isStale()) {
      console.debug(`[nav] ${view} stopped loading because another page was opened`, error);
      return;
    }
    console.error(`❌ Error loading view ${view}:`, error);
    main.style.opacity = '1';
    main.innerHTML = `
      <div class="error-state">
        <h2>⚠️ Error Loading ${view}</h2>
        <p>${error.message || 'There was a problem loading this section.'}</p>
        <div class="error-actions">
          <button class="btn btn-primary" onclick="loadView('${view}')">🔄 Retry</button>
          <button class="btn btn-secondary" onclick="loadView('finance-overview')">🏠 Go Home</button>
        </div>
      </div>
    `;
  }

  if (isStale()) return; // a newer page took over: don't scroll or banner for this one

  // Scroll to top on every view change (iPad-friendly) — except the
  // 'loans-whatif' nav shortcut, which should land on the What-If section
  // instead of the top of the Loans page it just rendered.
  if (view === 'loans-whatif') {
    const whatIfSection = document.getElementById('loanWhatIfSection');
    if (whatIfSection) {
      whatIfSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Tell anyone waiting (the tour's page coach) that this page is on screen.
  window.dispatchEvent(new CustomEvent('dfm:view-loaded', { detail: { view } }));
}

// ============================================================================
// 🚀 INITIALIZATION
// ============================================================================

export function initUI() {

  // Keep the top nav bar (the desktop/tablet view-links bar, not
  // .bottom-nav) pinned directly under the sticky <header> instead of
  // scrolling away with the page. The header's own height isn't a fixed
  // constant (it wraps, gets taller with safe-area insets, etc.), so we
  // measure it and publish it as a CSS var that the nav's `top` offset
  // reads, keeping the two stacked sticky bars aligned automatically.
  initStickyTopNav();

  // Initialize bottom navigation first
  initBottomNavigation();

  // Enhanced event delegation for sidebar and bottom nav.
  // Bug fix: this used to listen for BOTH 'click' and 'touchstart' on the
  // same element, and on touchscreens a single tap fires both events —
  // so every navigation tap ran this handler twice. 'click' alone already
  // fires reliably on tap in modern mobile browsers, so we only need one.
  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-view]');
    if (link) {
      e.preventDefault();
      const view = link.dataset.view;
      
      // Add visual feedback
      link.classList.add('nav-tap-feedback');
      setTimeout(() => {
        link.classList.remove('nav-tap-feedback');
      }, 300);
      
      if (view) {
        // Bug fix: this used to always set the hash AND call loadView()
        // directly, but changing the hash also fires the 'hashchange'
        // listener below which calls loadView() again — so every nav
        // click rendered the view twice. Now we only call loadView()
        // directly when the hash isn't actually changing (e.g. tapping
        // the tab you're already on, which wouldn't otherwise fire
        // 'hashchange' at all).
        const alreadyOnView = window.location.hash.replace('#', '') === view;
        window.location.hash = view;
        if (alreadyOnView) {
          loadView(view);
        }
      }
    }
  }, { passive: false });

  // Handle manual hash change (e.g. back button)
  window.addEventListener('hashchange', () => {
    const view = window.location.hash.slice(1) || 'finance-overview';
    loadView(view);
  });

  // Load initial view with a small delay for better UX
  setTimeout(() => {
    const initialView = window.location.hash.slice(1) || 'finance-overview';
    loadView(initialView);
  }, 100);
}

function initStickyTopNav() {
  const header = document.querySelector('header');
  if (!header || typeof ResizeObserver === 'undefined') return;

  const setHeaderHeightVar = () => {
    document.documentElement.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
  };

  setHeaderHeightVar();
  new ResizeObserver(setHeaderHeightVar).observe(header);
  window.addEventListener('resize', setHeaderHeightVar);
  window.addEventListener('orientationchange', setHeaderHeightVar);
}

// Make loadView available globally for error retry
window.loadView = loadView;

// Export for other modules
export { initBottomNavigation };

// Warn (on every page) when an account's currency has no exchange rate: its
// balance and transactions are otherwise counted at face value in the totals.
async function showMissingRateBanner(main) {
  try {
    main.querySelector('#missingRateBanner')?.remove();
    const accounts = await getAllItems(STORE_NAMES.accounts);
    const missing = unpricedCurrencies(accounts);
    if (!missing.length) return;
    const base = getBaseCurrency();
    const el = document.createElement('div');
    el.id = 'missingRateBanner';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'margin:0 0 12px;padding:10px 14px;border-radius:8px;background:#fff4d6;color:#5c4300;border:1px solid #f0c75e;font-size:0.9rem;cursor:pointer';
    el.textContent = `⚠️ No exchange rate set for ${missing.join(', ')}. Those accounts are counted 1:1 with ${base} in totals until you add a rate (Settings → Exchange rates).`;
    el.addEventListener('click', () => loadView('settings'));
    main.prepend(el);
  } catch (err) {
    console.warn('Missing-rate banner failed:', err);
  }
}
