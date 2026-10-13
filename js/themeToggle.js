// themeToggle.js
//
// One place for the app's light/dark theme. The header button (#btnTheme) and
// the Appearance card in Settings both use these functions, so they can never
// disagree about which theme is active.
//
// The theme itself is the data-theme attribute on <html> (set early by the
// inline script in index.html to avoid a flash). 'theme' in localStorage holds
// the resolved value (light | dark); 'themePreference' remembers what was
// chosen in Settings (light | dark | auto).

import { applyChartTheme } from './chartTheme.js';
import { themeColorFor } from './themeColors.js';

// Keep the browser/status-bar colour in step with the app's own light/dark toggle (the
// page's <meta> tags alone can only follow the phone's setting).
export function syncThemeColor(theme = document.documentElement.getAttribute('data-theme')) {
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const meta = metas[0] || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  metas.slice(1).forEach(m => m.remove());
  meta.removeAttribute('media');
  meta.setAttribute('content', themeColorFor(theme));
}

export function getTheme() {
  return localStorage.getItem('theme') || 'light';
}

export function setTheme(theme) {
  let actualTheme = theme;

  if (theme === 'auto') {
    actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  localStorage.setItem('theme', actualTheme);
  localStorage.setItem('themePreference', theme); // Store the preference
  document.documentElement.setAttribute('data-theme', actualTheme);
  syncThemeColor(actualTheme);
  applyChartTheme();
  syncThemeButton();
  window.dispatchEvent(new CustomEvent('dfm-theme-changed', { detail: { theme: actualTheme, preference: theme } }));
}

export function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

// Keep the header button's icon and spoken label in step with the real theme.
export function syncThemeButton() {
  const btn = document.getElementById('btnTheme');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  btn.setAttribute('aria-pressed', String(isDark));
  const icon = btn.querySelector('.theme-icon');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
}

export function initThemeToggle() {
  const btn = document.getElementById('btnTheme');
  if (!btn) return;
  if (!btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', toggleTheme);
  }
  syncThemeButton();
  syncThemeColor();
  // Another tab changed the theme: follow it.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'theme' || !e.newValue) return;
    document.documentElement.setAttribute('data-theme', e.newValue);
    syncThemeColor(e.newValue);
    applyChartTheme();
    syncThemeButton();
  });
}
