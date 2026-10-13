// ============================================================================
// 🌐 licenceActivation.js — talks to the OPTIONAL licence server
// ----------------------------------------------------------------------------
// Off unless ACTIVATION_URL is set in js/licenceConfig.js. Pure logic with the
// network and storage passed in, so it runs in Node for tests. No DOM.
//
// Design rule: the app must keep working offline and must never lock someone
// out because a server is slow, down or misconfigured. So:
//   - only an EXPLICIT answer from the server can refuse a key
//     ("device-limit" or "revoked"); anything else (offline, timeout, 5xx,
//     unexpected reply) is treated as "fine, try again later";
//   - keys issued before key ids existed have no id and skip all of this.
// ============================================================================
import { b64urlEncode, DEVICE_ID_KEY, REVOKED_KEY } from './licence.js';

export const ACTIVATION_STATE_KEY = 'dfm_activation'; // JSON: { keyId, status: 'ok'|'pending', checkedAt }
const DAY_MS = 24 * 60 * 60 * 1000;

function safeGet(storage, key) { try { return storage?.getItem(key) ?? null; } catch { return null; } }
function safeSet(storage, key, value) { try { storage?.setItem(key, value); return true; } catch { return false; } }

// A random id for this browser/device. It identifies the device to the licence
// server (so the same device re-activating is not counted twice). Not tied to
// anything about the person or the hardware.
export function getDeviceId(storage, cryptoObj = globalThis.crypto) {
  let id = safeGet(storage, DEVICE_ID_KEY);
  if (id && /^[A-Za-z0-9_-]{16,64}$/.test(id)) return id;
  id = b64urlEncode(cryptoObj.getRandomValues(new Uint8Array(16)));
  safeSet(storage, DEVICE_ID_KEY, id);
  return id;
}

export function readActivationState(storage) {
  try { return JSON.parse(safeGet(storage, ACTIVATION_STATE_KEY) || 'null'); } catch { return null; }
}

function trimSlash(url) { return String(url || '').replace(/\/+$/, ''); }

// POST JSON. Returns { status, data } or null when the server could not be
// reached or did not answer with JSON in time.
async function post(url, path, body, fetchFn, timeoutMs = 8000) {
  if (!url || typeof fetchFn !== 'function') return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(trimSlash(url) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl?.signal,
      cache: 'no-store'
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Called when a key is being activated on this device (before it is saved).
// Returns { ok: true, ... } to go ahead, or { ok: false, reason, limit, devices } to refuse.
export async function activateOnDevice({ url, key, payload, storage, fetchFn = globalThis.fetch?.bind(globalThis), now = new Date() }) {
  if (!url || !payload?.id) return { ok: true, skipped: true };
  const deviceId = getDeviceId(storage);
  const res = await post(url, '/activate', { key, deviceId }, fetchFn);
  const d = res?.data;
  if (d && d.ok === false && d.reason === 'device-limit') return { ok: false, reason: 'device-limit', limit: d.limit, devices: d.devices };
  if (d && d.ok === false && d.reason === 'revoked') return { ok: false, reason: 'revoked' };
  const confirmed = !!(d && d.ok === true);
  safeSet(storage, ACTIVATION_STATE_KEY, JSON.stringify({ keyId: payload.id, status: confirmed ? 'ok' : 'pending', checkedAt: confirmed ? now.toISOString() : null }));
  // A fresh, accepted activation clears any older "revoked" mark for this same key.
  if (confirmed && safeGet(storage, REVOKED_KEY) === payload.id) safeSet(storage, REVOKED_KEY, '');
  return { ok: true, pending: !confirmed, devices: d?.devices, limit: d?.limit };
}

// Quiet background check, at most every `everyDays`. Records a revocation so
// getLicenceStatus() stops honouring the key. An unreachable server changes nothing.
// Also records a device activation that could not be sent earlier (was offline).
export async function checkLicenceStatus({ url, key, payload, storage, fetchFn = globalThis.fetch?.bind(globalThis), now = new Date(), everyDays = 7, force = false }) {
  if (!url || !payload?.id || !key) return { checked: false, skipped: true };
  const state = readActivationState(storage);
  const last = state?.keyId === payload.id && state.checkedAt ? Date.parse(state.checkedAt) : NaN;
  const due = force || state?.status === 'pending' || Number.isNaN(last) || (now.getTime() - last) >= everyDays * DAY_MS;
  if (!due) return { checked: false, skipped: true };

  const deviceId = getDeviceId(storage);
  // /activate is idempotent for a device already counted, so it doubles as the status check
  // and also registers this device if an earlier activation was offline.
  const res = await post(url, '/activate', { key, deviceId }, fetchFn);
  const d = res?.data;
  if (!d) return { checked: false, offline: true };
  if (d.ok === false && d.reason === 'revoked') {
    safeSet(storage, REVOKED_KEY, payload.id);
    safeSet(storage, ACTIVATION_STATE_KEY, JSON.stringify({ keyId: payload.id, status: 'ok', checkedAt: now.toISOString() }));
    return { checked: true, revoked: true };
  }
  if (d.ok === false && d.reason === 'device-limit') {
    // This device was never counted (e.g. activated offline) and the key is now full elsewhere.
    return { checked: true, deviceLimit: true, limit: d.limit, devices: d.devices };
  }
  if (d.ok === true) {
    if (safeGet(storage, REVOKED_KEY) === payload.id) safeSet(storage, REVOKED_KEY, ''); // reinstated
    safeSet(storage, ACTIVATION_STATE_KEY, JSON.stringify({ keyId: payload.id, status: 'ok', checkedAt: now.toISOString() }));
    return { checked: true, revoked: false };
  }
  return { checked: false };
}

// Frees this device's place on the key so it can be used on another device.
// Returns { ok: true } or { ok: false, reason: 'offline' | 'refused' }.
export async function deactivateDevice({ url, key, payload, storage, fetchFn = globalThis.fetch?.bind(globalThis) }) {
  if (!url || !payload?.id) return { ok: true, skipped: true };
  const res = await post(url, '/deactivate', { key, deviceId: getDeviceId(storage) }, fetchFn);
  if (!res) return { ok: false, reason: 'offline' };
  if (res.data?.ok === true) {
    safeSet(storage, ACTIVATION_STATE_KEY, '');
    return { ok: true };
  }
  return { ok: false, reason: 'refused' };
}
