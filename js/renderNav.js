// js/renderNav.js
//
// Populates the desktop top nav (#mainNavList) and the mobile hamburger
// drawer (#mobileNavList) from the single NAV_ITEMS list in navItems.js.
// Produces exactly the same <li><a data-view=...><span class="icon">...
// </span><span class="label">...</span></a></li> markup that used to be
// hand-typed in index.html, so nothing downstream needs to change:
// ui.js's active-state handling, navigation.js's applyPermittedSections
// (family-sync permission filtering), and all existing CSS selectors
// (nav a, .mobile-nav-drawer a, etc.) all key off data-view / .icon /
// .label and don't care whether the <li> was typed by hand or generated.
//
// Must run before initUI() (js/ui.js) so its querySelectorAll('nav a')
// calls find real links — see the call in app.js's DOMContentLoaded
// handler, placed before initializeAppCore().
import { NAV_ITEMS } from './navItems.js';
import { viewReleased } from './features.js';

// Walks NAV_ITEMS in order, inserting a <li class="nav-group-label"> ahead
// of the first item whenever `group` changes from the previous item — so
// group headings follow the array's order/grouping with no separate list
// to keep in sync. Group-label <li>s have no <a data-view>, so
// navigation.js's applyPermittedSections (which queries a[data-view])
// leaves them alone untouched either way.
function navItemsMarkup() {
  let lastGroup = null;
  // Pages from a tier that isn't unlocked are left out entirely (and so is
  // their group heading, since headings are only drawn ahead of a real item).
  return NAV_ITEMS.filter(item => viewReleased(item.view)).map(item => {
    const heading = item.group !== lastGroup
      ? `<li class="nav-group-label">${item.group}</li>`
      : '';
    lastGroup = item.group;
    return heading + (
      `<li><a href="#${item.view}" data-view="${item.view}">` +
      `<span class="icon">${item.icon}</span>` +
      `<span class="label">${item.label}</span>` +
      `</a></li>`
    );
  }).join('');
}

export function renderSharedNav() {
  const markup = navItemsMarkup();

  const topNavList = document.getElementById('mainNavList');
  if (topNavList) topNavList.innerHTML = markup;

  const drawerList = document.getElementById('mobileNavList');
  if (drawerList) drawerList.innerHTML = markup;
}
