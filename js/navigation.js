// /js/navigation.js
// ============================================================================
// This file used to contain an entire second navigation system — a
// desktop/tablet sidebar with its own hamburger, overlay, and nav-item
// markup (buildNavigationStructure, populateSidebarNav, populateBottomNav,
// toggleSidebar, and the rest). None of it was ever wired up: nothing in
// the app calls initNavigation(), so it never ran. The actual, live
// navigation is the bottom tab bar and the hamburger drawer defined
// directly in index.html, driven by ui.js (setActiveNav) and
// mobileNavDrawer.js (open/close behavior).
//
// The one thing here that WAS genuinely used — applyPermittedSections,
// imported by settings.js — is kept, with a real bug fixed: it was
// querying for `.nav-item, .bottom-nav-item`, classes that only exist on
// the 5-item bottom tab bar. The full hamburger drawer's links (all 17+
// sections, including sensitive ones like Loans and Properties) have no
// class at all, so a restricted family member's drawer was never actually
// being filtered — they could see and open every section regardless of
// their permissions, even though the bottom tab bar correctly hid theirs.
// Querying by the data-view attribute instead — which every real nav link
// in both the bottom bar and the drawer consistently has — fixes both at
// once and doesn't depend on class names matching.
// ============================================================================

import { getPermittedSections } from './familySync.js';
import { viewReleased } from './features.js';

// Hide nav items outside a restricted family member's allowed sections.
// When not connected to a family server (getPermittedSections() returns
// null) or logged in as the admin (sections includes '*'), nothing is
// hidden. This is enforcement-in-depth alongside the server itself
// refusing to sync data for sections a user isn't permitted — hiding the
// nav item here is about a clean experience, not the actual security
// boundary (that's server-side).
export async function applyPermittedSections() {
  const sections = await getPermittedSections();
  const isRestricted = Array.isArray(sections) && !sections.includes('*');

  document.querySelectorAll('a[data-view]').forEach(item => {
    const view = item.getAttribute('data-view');
    // 'loans-whatif' is a nav shortcut into the Loans page (see
    // navItems.js / ui.js), not a distinct section with its own entry in
    // familySyncSections.js — a restricted member's access to it should
    // follow their 'loans' permission rather than requiring a separate,
    // nonexistent checkbox.
    const permissionKey = view === 'loans-whatif' ? 'loans' : view;
    // Help holds no personal data, so it is always visible.
    const allowed = viewReleased(view) &&
      (!isRestricted || view === 'help' || sections.includes(permissionKey));
    item.style.display = allowed ? '' : 'none';
    // For <li><a data-view>...</a></li> structures (the hamburger drawer),
    // hiding just the <a> still leaves an empty list item taking up space —
    // hide the parent <li> too when present.
    if (item.parentElement?.tagName === 'LI') {
      item.parentElement.style.display = allowed ? '' : 'none';
    }
  });
}
