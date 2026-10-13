// ============================================================================
// 🔒 appLock.js — Local PIN lock for the app UI
// ============================================================================
//
// HONESTY NOTE (this matters, and is also shown in the Settings UI copy):
// This is a UI-level gate, not encryption. The data in IndexedDB is NOT
// encrypted by this feature — anyone with direct access to browser dev
// tools/storage can still read it. What this protects against is casual
// access: someone picking up your unlocked phone or laptop and opening the
// installed app. Treat it as a screen lock, not a vault. There is also no
// way to recover a forgotten PIN (there's no server to reset it against) —
// the only recovery path is wiping local app data.
// ============================================================================

import { getAllItems, updateItem, deleteItem, STORE_NAMES } from './db.js';

const META_ID = 'appLock';
const AUTO_LOCK_MINUTES = 5;
const LOCKOUT_AFTER_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

let lockRecordCache; // undefined = not loaded yet, null = no PIN configured
let hiddenAt = null;
let failedAttempts = 0;
let lockoutUntil = 0;

// ----------------------------------------------------------------------------
// Hashing helpers (Web Crypto SubtleCrypto — no external dependency, but
// requires a secure context: https or localhost)
// ----------------------------------------------------------------------------
function randomSaltHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  return sha256Hex(`${salt}:${pin}`);
}

export function isSupported() {
  return !!(window.crypto && window.crypto.subtle);
}

// ----------------------------------------------------------------------------
// Storage (reuses the existing generic `meta` store)
// ----------------------------------------------------------------------------
async function getLockRecord(forceRefresh = false) {
  if (lockRecordCache !== undefined && !forceRefresh) return lockRecordCache;
  const all = await getAllItems(STORE_NAMES.meta);
  lockRecordCache = all.find(r => r.id === META_ID) || null;
  return lockRecordCache;
}

export async function isLockConfigured() {
  return !!(await getLockRecord());
}

export async function setupPin(pin) {
  const salt = randomSaltHex();
  const hash = await hashPin(pin, salt);
  const record = { id: META_ID, salt, hash };
  await updateItem(STORE_NAMES.meta, record);
  lockRecordCache = record;
}

export async function verifyPin(pin) {
  const record = await getLockRecord();
  if (!record) return true; // nothing configured = nothing to check
  const hash = await hashPin(pin, record.salt);
  return hash === record.hash;
}

export async function changePin(oldPin, newPin) {
  const ok = await verifyPin(oldPin);
  if (!ok) return false;
  await setupPin(newPin);
  return true;
}

export async function removeLock(pin) {
  const ok = await verifyPin(pin);
  if (!ok) return false;
  await deleteItem(STORE_NAMES.meta, META_ID);
  lockRecordCache = null;
  return true;
}

// ----------------------------------------------------------------------------
// Lock screen overlay
// ----------------------------------------------------------------------------
function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'appLockOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.97);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:2rem; max-width:340px; width:100%; text-align:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <div style="font-size:2.5rem; margin-bottom:0.5rem;">🔒</div>
      <h2 style="margin:0 0 0.25rem;">Locked</h2>
      <p style="color:#64748b; margin:0 0 1.25rem; font-size:0.9rem;">Enter your PIN to continue</p>
      <input id="appLockPinInput" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8"
        autocomplete="off" placeholder="••••" class="form-input"
        style="text-align:center; font-size:1.5rem; letter-spacing:0.3em; margin-bottom:0.75rem;">
      <div id="appLockError" style="color:#dc2626; font-size:0.85rem; min-height:1.2em; margin-bottom:0.75rem;"></div>
      <button id="appLockSubmit" class="btn btn-primary" style="width:100%; margin-bottom:0.5rem;">Unlock</button>
      <button id="appLockForgot" class="btn btn-secondary" style="width:100%; background:transparent; border:none; color:#64748b; text-decoration:underline; font-size:0.85rem;">
        Forgot PIN?
      </button>
    </div>
  `;
  return overlay;
}

function buildForgotPanel(overlay, onWipe) {
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; inset: 0; z-index: 100000;
    background: rgba(15, 23, 42, 0.97);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;
  panel.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:2rem; max-width:360px; width:100%; text-align:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <div style="font-size:2.5rem; margin-bottom:0.5rem;">⚠️</div>
      <h2 style="margin:0 0 0.5rem; color:#dc2626;">Reset App Data</h2>
      <p style="color:#334155; font-size:0.9rem; margin-bottom:1rem;">
        There's no way to recover a forgotten PIN — this app has no server to reset it against.
        The only option is to <strong>permanently erase all local data</strong> (accounts, transactions,
        properties, everything) and start fresh.
      </p>
      <p style="color:#64748b; font-size:0.85rem; margin-bottom:0.75rem;">Type <strong>DELETE</strong> to confirm:</p>
      <input id="appLockWipeConfirm" type="text" class="form-input" style="text-align:center; margin-bottom:1rem;">
      <button id="appLockWipeBtn" class="btn btn-danger" style="width:100%; margin-bottom:0.5rem;">Erase All Data</button>
      <button id="appLockWipeCancel" class="btn btn-secondary" style="width:100%;">Cancel</button>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('#appLockWipeCancel').addEventListener('click', () => panel.remove());
  panel.querySelector('#appLockWipeBtn').addEventListener('click', async () => {
    const val = panel.querySelector('#appLockWipeConfirm').value.trim();
    if (val !== 'DELETE') {
      alert('Please type DELETE exactly to confirm.');
      return;
    }
    panel.remove();
    await onWipe();
  });
}

/**
 * Blocks with a full-screen PIN prompt until the correct PIN is entered
 * (or there's no PIN configured, in which case it resolves immediately).
 */
export function requireUnlock() {
  return new Promise(async (resolve) => {
    const configured = await isLockConfigured();
    if (!configured) {
      resolve();
      return;
    }

    if (Date.now() < lockoutUntil) {
      // Still in a post-failed-attempts cooldown; still show the screen,
      // the submit handler below will re-check and display the wait time.
    }

    const overlay = buildOverlay();
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#appLockPinInput');
    const errorEl = overlay.querySelector('#appLockError');
    const submitBtn = overlay.querySelector('#appLockSubmit');
    const forgotBtn = overlay.querySelector('#appLockForgot');

    input.focus();

    async function attemptUnlock() {
      const now = Date.now();
      if (now < lockoutUntil) {
        const waitSec = Math.ceil((lockoutUntil - now) / 1000);
        errorEl.textContent = `Too many attempts. Try again in ${waitSec}s.`;
        return;
      }

      const pin = input.value;
      if (!pin) return;

      const ok = await verifyPin(pin);
      if (ok) {
        failedAttempts = 0;
        overlay.remove();
        resolve();
        return;
      }

      failedAttempts++;
      input.value = '';
      input.focus();
      if (failedAttempts >= LOCKOUT_AFTER_ATTEMPTS) {
        lockoutUntil = Date.now() + LOCKOUT_SECONDS * 1000;
        failedAttempts = 0;
        errorEl.textContent = `Too many attempts. Try again in ${LOCKOUT_SECONDS}s.`;
      } else {
        errorEl.textContent = 'Incorrect PIN. Try again.';
      }
    }

    submitBtn.addEventListener('click', attemptUnlock);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attemptUnlock();
    });

    forgotBtn.addEventListener('click', () => {
      buildForgotPanel(overlay, async () => {
        const { clearAllData } = await import('./db.js');
        await clearAllData();
        lockRecordCache = null;
        overlay.remove();
        resolve();
        // A full reload gives every module a clean slate rather than trying
        // to reconcile already-rendered views against now-empty data.
        window.location.reload();
      });
    });
  });
}

/**
 * Call once at startup. Locks again automatically if the app was hidden
 * (backgrounded/screen off) for more than AUTO_LOCK_MINUTES. This is a
 * best-effort convenience, not a hard security boundary — see the note at
 * the top of this file.
 */
export function initAutoRelock() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (hiddenAt) {
      const elapsedMinutes = (Date.now() - hiddenAt) / 60000;
      hiddenAt = null;
      if (elapsedMinutes >= AUTO_LOCK_MINUTES) {
        requireUnlock();
      }
    }
  });
}
