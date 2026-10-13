// ============================================================================
// 🔑 licenceGate.js — licence screen + Settings card (DOM side of licence.js)
// ----------------------------------------------------------------------------
// With LICENCE_PUBLIC_KEY = null (js/licenceConfig.js) every function here is
// a no-op and the app is completely unrestricted.
//
// When licensing is on:
//   - during the free trial the app works fully; Settings shows days left
//   - after the trial a blocking screen asks for a licence key. It also offers
//     "Export my data", so nobody's data is ever held hostage.
// ============================================================================
import { LICENCE_PUBLIC_KEY, TRIAL_DAYS, GRACE_DAYS, TRIAL_TIER, PURCHASE_URL, PURCHASE_URLS, ACTIVATION_URL, STATUS_CHECK_DAYS } from './licenceConfig.js';
import { getLicenceStatus, activateLicence, reasonMessage, parseLicenceKey, TIERS, TIER_LABELS, tierRank, LICENCE_STORAGE_KEY } from './licence.js';
import { activateOnDevice, checkLicenceStatus, deactivateDevice, readActivationState } from './licenceActivation.js';
import { requiredTierForView, viewAllowed, viewReleased, setCurrentTier, getCurrentTier, releasedTier, cappedTier } from './features.js';
import { NAV_ITEMS } from './navItems.js';
import { APP_VERSION } from './version.js';
import { escapeHtml } from './sanitize.js';

function status() {
  return getLicenceStatus({
    storage: localStorage, publicKey: LICENCE_PUBLIC_KEY, appVersion: APP_VERSION, trialDays: TRIAL_DAYS, graceDays: GRACE_DAYS, trialTier: TRIAL_TIER
  });
}

function activate(key) {
  return activateLicence(key, {
    storage: localStorage, publicKey: LICENCE_PUBLIC_KEY, appVersion: APP_VERSION,
    // With a licence server configured, it may refuse the key (device limit / cancelled) before it is saved.
    check: ACTIVATION_URL ? (payload, clean) => activateOnDevice({ url: ACTIVATION_URL, key: clean, payload, storage: localStorage }) : undefined
  });
}

// The saved key and its payload (or null), for the Settings card and background checks.
function savedKey() {
  try {
    const raw = localStorage.getItem(LICENCE_STORAGE_KEY);
    const parsed = raw ? parseLicenceKey(raw) : null;
    return parsed ? { key: raw.replace(/\s+/g, ''), payload: parsed.payload } : null;
  } catch { return null; }
}

// Quiet check that the key hasn't been cancelled/refunded. Never blocks start-up and never
// complains when offline. If the server says the key is cancelled, the licence screen appears.
async function backgroundStatusCheck() {
  if (!ACTIVATION_URL) return;
  const saved = savedKey();
  if (!saved?.payload?.id) return;
  try {
    const r = await checkLicenceStatus({ url: ACTIVATION_URL, key: saved.key, payload: saved.payload, storage: localStorage, everyDays: STATUS_CHECK_DAYS });
    if (r.revoked) {
      const st = await status();
      if (st.state === 'expired') { await showLicenceScreen(st); }
      await refreshTier();
      applyTierLocks();
    }
  } catch (e) { console.warn('[licence] status check failed', e); }
}

// ---- licence in backups -----------------------------------------------------
// A backup file carries the licence key so a cleared browser or a new phone
// doesn't lose it. `on` is whether licensing is switched on in this build.
export async function backupLicenceInfo() {
  if (!LICENCE_PUBLIC_KEY) return { on: false, key: null };
  try {
    const st = await status();
    if (st.state !== 'licensed') return { on: true, key: null };
    return { on: true, key: localStorage.getItem(LICENCE_STORAGE_KEY) || null };
  } catch { return { on: true, key: null }; }
}

// Called after a restore. Re-activates the key from the backup if it is valid
// (and not lower than a key already on this device).
export async function restoreLicenceFromBackup(key) {
  if (!LICENCE_PUBLIC_KEY || typeof key !== 'string' || !key.trim()) return { applied: false };
  const r = await activate(key);
  if (!r.valid) return { applied: false, reason: r.reason, detail: r.detail };
  await refreshTier(); applyTierLocks(); removeTrialBanner();
  return { applied: true, tier: (await status()).tier };
}

// ---- current edition (what is unlocked right now) ----
// The state itself lives in features.js (so shared pages can ask hasFeature()
// without importing this file). It is everything while licensing is off or
// during the trial, then capped by RELEASE_STAGE (js/releaseConfig.js).
export { getCurrentTier };

async function refreshTier() {
  if (!LICENCE_PUBLIC_KEY) { setCurrentTier('tax'); return; }
  const st = await status();
  setCurrentTier(st.tier || 'tax');
}

function buyUrlFor(tier) { return PURCHASE_URLS?.[tier] || PURCHASE_URL || ''; }

// Awaited during startup. Resolves immediately unless the trial has ended.
export async function requireLicence() {
  if (!LICENCE_PUBLIC_KEY) { setCurrentTier('tax'); return; } // licensing off: everything released is available
  const st = await status();
  if (st.state === 'expired') {
    await showLicenceScreen(st);
    await refreshTier();
  } else {
    setCurrentTier(st.tier || 'tax');
    if (st.state === 'trial' || st.state === 'grace') showTrialBanner(st); else removeTrialBanner();
    if (st.state === 'licensed') backgroundStatusCheck();   // not awaited: start-up never waits on the network
  }
}

// ---- trial reminder ---------------------------------------------------------
// A small bar so people can see they're on a free trial without opening
// Settings. Dismiss hides it until the next time the app is opened.
let trialBannerWatcher = null;

function removeTrialBanner() {
  document.getElementById('trialBanner')?.remove();
  if (trialBannerWatcher) { trialBannerWatcher.disconnect(); trialBannerWatcher = null; }
  window.removeEventListener('resize', placeTrialBanner);
}

// The backup reminder is also a fixed bar at the bottom of the screen. When both
// are showing, sit the trial pill just above it instead of on top of it (it used
// to cover the reminder's lower edge and block taps on its own buttons).
function placeTrialBanner() {
  const bar = document.getElementById('trialBanner');
  if (!bar) return;
  const reminder = document.getElementById('backupReminder');
  const r = reminder && reminder.getBoundingClientRect();
  const base = 'env(safe-area-inset-bottom, 0px)';
  const b = bar.getBoundingClientRect();
  const sideBySide = r && (r.left >= b.right || r.right <= b.left);   // wide screens: no clash, stay put
  if (r && r.height > 0 && r.top > 0 && !sideBySide) {
    bar.style.bottom = `calc(${base} + ${Math.ceil(window.innerHeight - r.top) + 8}px)`;
  } else {
    bar.style.bottom = `calc(${base} + 64px)`;
  }
}

function showTrialBanner(st) {
  try { if (sessionStorage.getItem('dfm_trial_banner_dismissed') === '1') return; } catch { /* ignore */ }
  if (!document.body) return;
  removeTrialBanner();
  const grace = st.state === 'grace';
  const urgent = grace || st.daysLeft <= 3;
  const bar = document.createElement('div');
  bar.id = 'trialBanner';
  bar.setAttribute('role', 'status');
  // Slim one-line pill, centred just above the phone tab bar.
  bar.style.cssText = 'position:fixed; left:50%; transform:translateX(-50%); bottom:calc(env(safe-area-inset-bottom, 0px) + 64px); z-index:1500; ' +
    'display:inline-flex; align-items:center; gap:0.5rem; white-space:nowrap; max-width:calc(100vw - 16px); padding:3px 6px 3px 12px; border-radius:999px; ' +
    'font-size:0.75rem; line-height:1.4; color:#fff; box-shadow:0 2px 10px rgba(0,0,0,.25); background:' + (urgent ? 'rgba(180,83,9,.95)' : 'rgba(30,41,59,.92)') + ';';
  bar.innerHTML =
    (grace
      ? '<span>Trial ended: <strong>' + st.graceDaysLeft + '</strong> day' + (st.graceDaysLeft === 1 ? '' : 's') + ' to enter a key</span>'
      : '<span>Trial: <strong>' + st.daysLeft + '</strong> day' + (st.daysLeft === 1 ? '' : 's') + ' left</span>') +
    '<button type="button" class="trial-key" style="background:rgba(255,255,255,.18); border:0; color:#fff; font-size:0.75rem; padding:2px 10px; border-radius:999px; cursor:pointer;">Enter key</button>' +
    '<button type="button" class="trial-x" aria-label="Dismiss" style="background:transparent; border:0; color:#fff; font-size:1rem; line-height:1; cursor:pointer; padding:0 4px;">\u00D7</button>';
  bar.querySelector('.trial-x').addEventListener('click', () => {
    try { sessionStorage.setItem('dfm_trial_banner_dismissed', '1'); } catch { /* ignore */ }
    removeTrialBanner();
  });
  bar.querySelector('.trial-key').addEventListener('click', goToLicenceCard);
  document.body.appendChild(bar);
  placeTrialBanner();
  window.addEventListener('resize', placeTrialBanner);
  if (typeof MutationObserver !== 'undefined') {
    trialBannerWatcher = new MutationObserver(placeTrialBanner);   // reminder appears / is dismissed
    trialBannerWatcher.observe(document.body, { childList: true });
  }
}

// Opens Settings and scrolls to the Licence card. Works whether or not the
// person is already on Settings (where a plain link would do nothing).
async function goToLicenceCard() {
  try {
    const { loadView } = await import('./ui.js');
    const already = window.location.hash.replace('#', '') === 'settings';
    window.location.hash = 'settings';
    if (already) await loadView('settings');
  } catch (e) { window.location.hash = 'settings'; }
  for (let i = 0; i < 30; i++) {            // wait up to ~3s for the card to render
    const card = document.getElementById('licenceCard');
    if (card && card.style.display !== 'none' && card.innerHTML.trim()) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.querySelector('textarea')?.focus({ preventScroll: true });
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

// True when this page can't be opened: either it isn't released yet (see
// RELEASE_STAGE in js/releaseConfig.js) or it needs a higher edition than the
// one activated. Released-but-unpaid pages show an upgrade screen.
export function isViewLocked(view) {
  if (!viewReleased(view)) return true;
  if (!LICENCE_PUBLIC_KEY) return false;
  return !viewAllowed(view, getCurrentTier());
}

// Adds a 🔒 to nav links the current edition doesn't include (kept visible so
// people can see what an upgrade adds). Safe to call repeatedly.
export function applyTierLocks() {
  document.querySelectorAll('a[data-view]').forEach(a => {
    const view = a.getAttribute('data-view');
    // Pages from an edition that hasn't shipped yet are not shown at all (not
    // even with a 🔒). The generated menus already leave them out; this also
    // catches hand-written links such as the mobile bottom tab bar.
    if (!viewReleased(view)) { a.style.display = 'none'; return; }
    const label = a.querySelector('.label');
    if (!label) return;
    const locked = isViewLocked(view);
    a.classList.toggle('tier-locked', locked);
    label.textContent = label.textContent.replace(/\s*🔒$/, '') + (locked ? ' 🔒' : '');
  });
}

// Shown in place of a page the current edition doesn't include.
// Shown on the upgrade screen so people can see what an edition adds.
const EDITION_FEATURES = {
  property: [
    'Properties, tenants and rent tracking',
    'Property maintenance and expense records',
    'Link bills and transactions to each property',
    'Rates and land tax on your dashboards'
  ],
  tax: [
    'ATO tax reports for your properties',
    'Cost base tracker for capital gains',
    'Everything in the Property edition'
  ]
};

export function renderUpgradePage(view, container) {
  const need = requiredTierForView(view);
  const item = NAV_ITEMS.find(i => i.view === view);
  const name = item ? `${item.icon} ${item.label}` : 'This page';
  if (!viewReleased(view)) {
    // Typed link or old bookmark to a section that hasn't shipped yet.
    container.innerHTML = `
    <div class="page-container">
      <div class="section-card" style="max-width:520px; margin:2rem auto; text-align:center;">
        <h2 style="margin-top:0;">🚧 ${escapeHtml(name)}</h2>
        <p style="line-height:1.5;">This part of the app isn't available yet. It's coming in a future update.</p>
        <a class="btn btn-secondary" href="#finance-overview">← Back to the app</a>
      </div>
    </div>`;
    return;
  }
  const url = buyUrlFor(need);
  container.innerHTML = `
    <div class="page-container">
      <div class="section-card" style="max-width:520px; margin:2rem auto; text-align:center;">
        <h2 style="margin-top:0;">🔒 ${escapeHtml(name)}</h2>
        <p style="line-height:1.5;">This part of the app is included in the <strong>${escapeHtml(TIER_LABELS[need])}</strong> edition.</p>
        ${(EDITION_FEATURES[need] || []).length ? `
        <div style="text-align:left; margin:1rem auto; max-width:360px;">
          <div style="font-weight:600; margin-bottom:0.35rem;">What the ${escapeHtml(TIER_LABELS[need])} edition adds</div>
          <ul style="margin:0; padding-left:1.2rem; line-height:1.6;">${EDITION_FEATURES[need].map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        </div>` : ''}
        <p style="line-height:1.5; font-size:0.9rem;">Everything else you have keeps working, and your data is untouched.</p>
        <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:1rem;">
          ${url ? `<a class="btn btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener">Upgrade to ${escapeHtml(TIER_LABELS[need])}</a>` : ''}
          <a class="btn btn-secondary" href="#settings">🔑 I have an upgrade key (Settings → Licence)</a>
        </div>
      </div>
    </div>`;
}

function showLicenceScreen(st) {
  return new Promise((resolve) => {
    document.getElementById('licenceGate')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'licenceGate';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2000000;
      background: var(--bg-main, #f8fafc); color: var(--text-main, #0f172a);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem; overflow: auto;
      padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
      padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
    `;
    const intro = st.problem === 'needs-upgrade'
      ? 'Your saved licence covers an earlier version of the app. Enter a licence key for this version to continue.'
      : st.problem === 'revoked'
        ? 'This licence was cancelled or refunded. Enter a different licence key to keep using Dashers Finance Manager, or export your data below.'
        : 'Your free trial has ended. Enter your licence key to keep using Dashers Finance Manager.';
    overlay.innerHTML = `
      <div style="max-width:440px; width:100%;">
        <h2 style="margin-top:0;">🔑 Licence needed</h2>
        <p style="line-height:1.5;">${escapeHtml(intro)}</p>
        <p style="line-height:1.5; font-size:0.9rem;"><strong>Your data is safe</strong> and untouched on this device. You can export it at any time below.</p>
        <textarea id="licenceKeyInput" class="form-input" rows="4" placeholder="Paste your licence key (starts with DFM1.)" autocapitalize="off" autocomplete="off" spellcheck="false" style="width:100%; font-family:monospace; font-size:0.8rem;"></textarea>
        <div id="licenceKeyError" style="color:#dc2626; font-size:0.85rem; min-height:1.3em; margin:0.4rem 0;"></div>
        <div style="display:flex; flex-direction:column; gap:0.5rem;">
          <button type="button" class="btn btn-primary" id="licenceActivate">Activate</button>
          ${PURCHASE_URL ? `<a class="btn btn-secondary" id="licenceBuy" href="${escapeHtml(PURCHASE_URL)}" target="_blank" rel="noopener" style="text-align:center;">Buy a licence</a>` : ''}
          <button type="button" class="btn btn-secondary" id="licenceExport">💾 Export my data</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#licenceKeyInput');
    const err = overlay.querySelector('#licenceKeyError');
    const btn = overlay.querySelector('#licenceActivate');

    btn.addEventListener('click', async () => {
      err.textContent = '';
      btn.disabled = true;
      const r = await activate(input.value);
      btn.disabled = false;
      if (r.valid) {
        overlay.remove();
        resolve();
      } else {
        err.textContent = r.reason === 'storage'
          ? 'Could not save the licence on this device (is private browsing on?).'
          : reasonMessage(r.reason, r.payload, r.detail);
      }
    });

    overlay.querySelector('#licenceExport').addEventListener('click', async () => {
      const { exportData } = await import('./settings.js');
      await exportData();
    });
  });
}

// Settings page card. Does nothing (card stays empty) when licensing is off.
export async function renderLicenceCard(container) {
  if (!container) return;
  if (!LICENCE_PUBLIC_KEY) { container.style.display = 'none'; return; }
  container.style.display = '';
  const st = await status();

  const keyBox = (label) => `
      <textarea id="settingsLicenceKey" class="form-input" rows="3" placeholder="Paste your licence key (starts with DFM1.)" autocapitalize="off" autocomplete="off" spellcheck="false" style="width:100%; font-family:monospace; font-size:0.8rem;"></textarea>
      <div id="settingsLicenceError" style="color:#dc2626; font-size:0.85rem; min-height:1.3em; margin:0.4rem 0;"></div>
      <div class="button-group">
        <button type="button" class="btn btn-primary" id="settingsLicenceActivate">${label}</button>
        ${buyUrlFor(TIERS[Math.min(tierRank(st.tier || 'core') + 1, TIERS.length - 1)]) ? `<a class="btn btn-secondary" href="${escapeHtml(buyUrlFor(TIERS[Math.min(tierRank(st.tier || 'core') + 1, TIERS.length - 1)]))}" target="_blank" rel="noopener">Buy a licence</a>` : ''}
      </div>`;

  const movingNote = `<details style="margin-top:0.75rem; font-size:0.9rem;"><summary style="cursor:pointer; font-weight:600;">Moving to a new phone or computer?</summary>
      <p style="margin:0.5rem 0 0;">Your licence is saved on this device and is included in every backup you make. To move it: restore your backup on the new device, or paste the same key into Settings \u2192 Licence there. Use <em>Copy my licence key</em> above, or the email you were sent. If you can't find your key, contact support with the email you bought with.</p></details>`;
  let body;
  if (st.state === 'licensed') {
    const top = st.tier === TIERS[TIERS.length - 1];
    body = `<p style="margin:0;">✅ <strong>${escapeHtml(TIER_LABELS[st.tier] || 'Core')}</strong> edition${st.email ? ` licensed to <strong>${escapeHtml(st.email)}</strong>` : ''}${st.issued ? ` (issued ${escapeHtml(st.issued)})` : ''}. Thank you!</p>`
      + (tierRank(st.tier) > tierRank(releasedTier()) ? `<p style="margin:0.5rem 0 0; font-size:0.85rem; opacity:0.85;">Your edition also covers sections that aren't released yet. They'll appear automatically in a future update.</p>` : '')
      + (ACTIVATION_URL && st.keyId ? `<p style="margin:0.5rem 0 0; font-size:0.9rem;">This device: ${readActivationState(localStorage)?.status === 'ok' ? 'registered with the licence server.' : 'will be registered the next time you are online.'}</p>` : '')
      + `<p style="margin:0.5rem 0 0; font-size:0.9rem;">Covers version ${escapeHtml(String(st.major ?? 1))} and every update to it.</p>
         <div class="button-group" style="margin-top:0.6rem;"><button type="button" class="btn btn-secondary" id="settingsLicenceCopy">Copy my licence key</button>${ACTIVATION_URL && st.keyId ? '<button type="button" class="btn btn-secondary" id="settingsLicenceDeactivate">Deactivate this device</button>' : ''}</div>
         <div id="settingsLicenceCopied" style="font-size:0.85rem; min-height:1.2em; margin-top:0.3rem;"></div>`
      + movingNote
      + (top ? '' : `<p style="margin:0.75rem 0 0.5rem; font-size:0.9rem;">Want more? Paste an upgrade key to unlock the next edition.</p>${keyBox('Activate upgrade')}`);
  } else if (st.state === 'grace') {
    body = `<p style="margin:0 0 0.75rem;">⏳ Your free trial has ended. Everything still works for <strong>${st.graceDaysLeft}</strong> more day${st.graceDaysLeft === 1 ? '' : 's'}. Enter a licence key to keep going.</p>${keyBox('Activate')}${movingNote}`;
  } else {
    const trialScope = cappedTier(st.tier) === 'tax' ? 'all features' : `${TIER_LABELS[cappedTier(st.tier)] || 'Core'} features`;
    body = `<p style="margin:0 0 0.75rem;">⏳ Free trial (${trialScope}): <strong>${st.daysLeft}</strong> day${st.daysLeft === 1 ? '' : 's'} left.</p>${keyBox('Activate')}${movingNote}`;
  }
  container.innerHTML = `
    <div class="settings-card-header"><h3>🔑 Licence</h3></div>
    <div class="settings-card-body">${body}</div>`;

  container.querySelector('#settingsLicenceCopy')?.addEventListener('click', async () => {
    const out = container.querySelector('#settingsLicenceCopied');
    const key = localStorage.getItem(LICENCE_STORAGE_KEY) || '';
    try { await navigator.clipboard.writeText(key); out.textContent = 'Copied. Keep it somewhere safe.'; }
    catch { out.textContent = 'Could not copy automatically. Your key: ' + key; }
  });
  container.querySelector('#settingsLicenceDeactivate')?.addEventListener('click', async () => {
    const out = container.querySelector('#settingsLicenceCopied');
    const saved = savedKey();
    if (!saved) return;
    if (!confirm('Deactivate this device?\n\nThe licence key is removed from this device so you can use it on another one. Your data stays here. You can enter the key again later.')) return;
    const r = await deactivateDevice({ url: ACTIVATION_URL, key: saved.key, payload: saved.payload, storage: localStorage });
    if (!r.ok) {
      out.style.color = '#dc2626';
      out.textContent = r.reason === 'offline' ? 'You need to be online to deactivate this device. Please connect and try again.' : 'The licence server did not accept that. Please try again, or contact support.';
      return;
    }
    try { localStorage.removeItem(LICENCE_STORAGE_KEY); } catch { /* ignore */ }
    const st2 = await status();
    await refreshTier(); applyTierLocks();
    if (st2.state === 'expired') { await showLicenceScreen(st2); await refreshTier(); applyTierLocks(); }
    else if (st2.state === 'trial' || st2.state === 'grace') showTrialBanner(st2);
    renderLicenceCard(container);
  });
  container.querySelector('#settingsLicenceActivate')?.addEventListener('click', async () => {
    const err = container.querySelector('#settingsLicenceError');
    const r = await activate(container.querySelector('#settingsLicenceKey').value);
    if (r.valid) { await refreshTier(); applyTierLocks(); removeTrialBanner(); renderLicenceCard(container); }
    else err.textContent = r.reason === 'storage' ? 'Could not save the licence on this device.' : reasonMessage(r.reason, r.payload, r.detail);
  });
}
