// ============================================================================
// Mobile / tablet navigation drawer
//
// The app's original top nav only fits comfortably on desktop widths (it
// wraps to two rows on iPad), and the phone bottom-tab-bar only surfaces 5
// of the app's 17 sections. This drawer gives phone and iPad a single,
// full-coverage navigation surface: a hamburger button that slides out a
// list of every section. It's shown alongside the existing bottom tab bar
// on phone (quick access + full access), and replaces the cramped wrapped
// top nav on iPad (see the max-width: 1024px rules in styles.css).
// ============================================================================

export function initMobileNavDrawer() {
  const toggleBtn = document.getElementById('mobileNavToggle');
  const closeBtn = document.getElementById('mobileNavClose');
  const drawer = document.getElementById('mobileNavDrawer');
  const overlay = document.getElementById('mobileNavOverlay');

  if (!toggleBtn || !drawer || !overlay) return;

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggleBtn.addEventListener('click', () => {
    if (drawer.classList.contains('open')) closeDrawer();
    else openDrawer();
  });

  closeBtn?.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });

  // Close the drawer whenever a section link inside it is tapped.
  drawer.querySelectorAll('a[data-view]').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  // Backup Data / Restore Data — kept as one real set of buttons (in the
  // header, hidden on narrow screens rather than duplicated) with their
  // existing click handlers wired up elsewhere in app.js. These drawer
  // entries just forward a click to the real button rather than
  // reimplementing export/import here, so there's exactly one place that
  // needs to know how backup/restore actually works.
  const backupBtn = document.getElementById('btnExport');
  const restoreBtn = document.getElementById('btnImport');
  document.getElementById('mobileNavBackup')?.addEventListener('click', () => {
    closeDrawer();
    backupBtn?.click();
  });
  document.getElementById('mobileNavRestore')?.addEventListener('click', () => {
    closeDrawer();
    restoreBtn?.click();
  });

  // Close the drawer automatically if the viewport grows into the desktop
  // breakpoint while it's open (e.g. rotating an iPad or resizing a window).
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1025 && drawer.classList.contains('open')) closeDrawer();
  });

  function updateActiveDrawerLink() {
    const currentView = window.location.hash.replace('#', '') || 'finance-overview';
    drawer.querySelectorAll('a[data-view]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-view') === currentView);
    });
  }

  window.addEventListener('hashchange', updateActiveDrawerLink);
  updateActiveDrawerLink();
}
