// js/navItems.js
//
// Single source of truth for the main app navigation. Both the desktop top
// nav (the plain <nav> in index.html) and the mobile hamburger drawer
// (#mobileNavDrawer) used to be two separately hand-typed copies of this
// same 18-item list — any time a section was added, renamed, or reordered,
// both copies had to be updated by hand. They'd already drifted apart
// before this file existed: Settings sat last in the top nav but was
// tucked in right after Bills in the drawer. Both are now generated from
// this one array by js/renderNav.js, so they can't diverge again.
//
// The bottom tab bar (.bottom-nav in index.html) is intentionally NOT
// generated from this list — it's a deliberately smaller, curated set of
// primary destinations for the mobile tab bar, not a duplicate of the full
// section list, so it stays hand-authored on its own.
// Each item now carries a `group` label. renderNav.js inserts a heading
// before the first item of each new group as it walks the array in order
// — so group membership AND ordering both come from this one array; to
// reorder a group, or move an item into a different one, just edit its
// position/group here. Nothing downstream (ui.js active-state handling,
// navigation.js's applyPermittedSections, existing CSS) reads `group` or
// cares about it — they still key off data-view / .icon / .label exactly
// as before, so this is additive.
export const NAV_ITEMS = [
  { view: 'financial-dashboard', icon: '📊', label: 'Financial Dashboard', group: 'Dashboard' },
  { view: 'wealth-overview', icon: '💎', label: 'Wealth Overview', group: 'Dashboard' },
  { view: 'finance-overview', icon: '🌌', label: 'Finance Overview', group: 'Dashboard' },

  { view: 'transactions', icon: '💸', label: 'Transactions', group: 'Money' },
  { view: 'budgets', icon: '🎯', label: 'Budgets', group: 'Money' },
  { view: 'accounts', icon: '💳', label: 'Accounts', group: 'Money' },
  { view: 'categories', icon: '🗂️', label: 'Categories', group: 'Money' },
  { view: 'reports', icon: '📊', label: 'Reports', group: 'Money' },

  { view: 'bills', icon: '🧾', label: 'Bills', group: 'Bills & Recurring' },
  { view: 'calendar', icon: '📅', label: 'Calendar', group: 'Bills & Recurring' },
  { view: 'recurring', icon: '🔁', label: 'Recurring', group: 'Bills & Recurring' },
  { view: 'subscriptions', icon: '🔂', label: 'Subscriptions', group: 'Bills & Recurring' },

  { view: 'loans', icon: '🏦', label: 'Loans', group: 'Loans & Assets' },
  { view: 'loans-whatif', icon: '🧮', label: 'Loan What-If', group: 'Loans & Assets' },
  { view: 'superannuation', icon: '💰', label: 'Superannuation', group: 'Loans & Assets' },
  { view: 'insurance', icon: '🛡️', label: 'Insurance', group: 'Loans & Assets' },
  { view: 'vehicles', icon: '🚗', label: 'Vehicles', group: 'Loans & Assets' },

  // Property tier (paid upgrade 2) — see js/features.js / releaseConfig.js
  { view: 'properties', icon: '🏠', label: 'Properties', group: 'Property' },
  { view: 'tenants', icon: '👤', label: 'Tenants', group: 'Property' },
  { view: 'maintenance', icon: '🧰', label: 'Maintenance', group: 'Property' },
  { view: 'expenses', icon: '💸', label: 'Expenses', group: 'Property' },

  // Tax tier (paid upgrade 3)
  { view: 'tax', icon: '📘', label: 'ATO Reports', group: 'Tax' },
  { view: 'costbase', icon: '🧱', label: 'Cost Base', group: 'Tax' },

  { view: 'settings', icon: '⚙️', label: 'Settings', group: 'More' },
  { view: 'help', icon: '❓', label: 'Help', group: 'More' },
];
