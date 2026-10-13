// ============================================================================
// 🔑 licence.js — offline licence-key verification (no server)
// ----------------------------------------------------------------------------
// A licence key is   DFM1.<payload>.<signature>   (payload and signature are
// base64url). The payload is small JSON saying who it is for and which major
// version it covers; the signature is ECDSA P-256 / SHA-256 made with YOUR
// private key (tools/licence-issue.mjs). The app only contains the matching
// PUBLIC key, so it can check a key is genuine but cannot make one.
//
// HONEST LIMITS: this stops casual copying, not a determined person who edits
// the app's JavaScript in their browser, and a key that is shared still works
// (there is no server to count activations or revoke it). That is the normal
// trade-off for offline licensing.
//
// Pure logic + Web Crypto only (no DOM), so it runs in Node for tests and in
// the browser. Needs a secure context (https or localhost) for crypto.subtle.
// ============================================================================

export const KEY_PREFIX = 'DFM1';
export const LICENCE_STORAGE_KEY = 'dfm_licence';
export const TRIAL_START_KEY = 'dfm_trial_start';
export const REVOKED_KEY = 'dfm_revoked';       // id of a key the licence server says was cancelled/refunded
export const DEVICE_ID_KEY = 'dfm_device_id';   // random id for this device (only used when a licence server is configured)

// ---- tiers (each higher tier includes everything below it) ----
//   core     = everything except the Property and Tax sections
//   property = Core + Property section (js/features.js decides which pages)
//   tax      = Property + Tax section (ATO Reports, Cost Base)
export const TIERS = ['core', 'property', 'tax'];
export const TIER_LABELS = { core: 'Core', property: 'Property', tax: 'Property + Tax' };
export function isTier(t) { return TIERS.includes(t); }
export function tierRank(t) { return TIERS.indexOf(t); }
// Does a licence of tier `have` cover something that needs tier `need`?
export function tierAllows(have, need) { return tierRank(have) >= tierRank(need) && tierRank(have) >= 0; }

const DAY_MS = 24 * 60 * 60 * 1000;
const ECDSA = { name: 'ECDSA', hash: 'SHA-256' };
const CURVE = { name: 'ECDSA', namedCurve: 'P-256' };

// ---- base64url helpers (shared with tools/licenceSign.mjs) ----

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function majorOf(version) {
  return parseInt(String(version ?? '').split('.')[0], 10) || 0;
}

// Splits "DFM1.xxx.yyy" (whitespace/newlines from copy-paste tolerated).
export function parseLicenceKey(key) {
  if (typeof key !== 'string') return null;
  const parts = key.replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX || !parts[1] || !parts[2]) return null;
  try {
    const payloadBytes = b64urlDecode(parts[1]);
    const sigBytes = b64urlDecode(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!payload || typeof payload !== 'object') return null;
    return { payload, payloadBytes, sigBytes };
  } catch {
    return null;
  }
}

// Result: { valid: true, payload } or { valid: false, reason }
// reasons: 'unsupported' | 'malformed' | 'bad-signature' | 'wrong-product' | 'needs-upgrade'
export async function verifyLicenceKey(key, publicKeyJwk, { appVersion } = {}) {
  if (!globalThis.crypto?.subtle) return { valid: false, reason: 'unsupported' };
  const parsed = parseLicenceKey(key);
  if (!parsed) return { valid: false, reason: 'malformed' };

  let ok = false;
  try {
    const pub = await crypto.subtle.importKey('jwk', publicKeyJwk, CURVE, false, ['verify']);
    ok = await crypto.subtle.verify(ECDSA, pub, parsed.sigBytes, parsed.payloadBytes);
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'bad-signature' };

  const p = parsed.payload;
  if (p.p !== 'dfm' || p.v !== 1) return { valid: false, reason: 'wrong-product' };
  // Keys issued before tiers existed carry no tier: treat them as Core.
  if (p.tier !== undefined && !isTier(p.tier)) return { valid: false, reason: 'unknown-tier' };
  if (appVersion && majorOf(appVersion) > Number(p.major)) {
    return { valid: false, reason: 'needs-upgrade', payload: p };
  }
  return { valid: true, payload: p };
}

export function reasonMessage(reason, payload, detail) {
  switch (reason) {
    case 'revoked': return 'This licence has been cancelled or refunded, so it can no longer be used. If you think this is a mistake, please contact support.';
    case 'device-limit': {
      const n = detail?.limit;
      return `That key is already active on the maximum number of devices${n ? ` (${n})` : ''}. Open Settings → Licence on one of your other devices and choose "Deactivate this device", then try again. Need help? Contact support.`;
    }
    case 'malformed': return "That doesn't look like a licence key. Paste the whole key, starting with DFM1.";
    case 'bad-signature': return 'That licence key is not valid.';
    case 'wrong-product': return 'That key is not for this app.';
    case 'needs-upgrade':
      return `That key covers version ${payload?.major ?? 'an earlier'}.x only. Please buy an upgrade for this version.`;
    case 'unknown-tier': return 'That key is for a different edition of the app. Please contact support.';
    case 'lower-tier': return 'You already have a higher edition activated on this device, so that key was not applied.';
    case 'unsupported': return 'Licence checking needs a secure (https) connection.';
    default: return 'That licence key could not be checked.';
  }
}

// ---- storage + trial ----

function safeGet(storage, key) { try { return storage?.getItem(key) ?? null; } catch { return null; } }
function safeSet(storage, key, value) { try { storage?.setItem(key, value); return true; } catch { return false; } }

// state: 'off' | 'licensed' | 'trial' | 'grace' | 'expired'
// `tier` = what is unlocked right now: everything while off, `trialTier` (default
// everything) during the trial, the key's
// tier when licensed, and null when expired.
export async function getLicenceStatus({ storage, publicKey, appVersion, trialDays = 14, graceDays = 0, trialTier = 'tax', now = new Date() }) {
  if (!publicKey) return { state: 'off', tier: 'tax' };

  let problem = null;
  const stored = safeGet(storage, LICENCE_STORAGE_KEY);
  if (stored) {
    const r = await verifyLicenceKey(stored, publicKey, { appVersion });
    if (r.valid) {
      if (r.payload.id && safeGet(storage, REVOKED_KEY) === r.payload.id) {
        problem = 'revoked'; // the licence server cancelled this key (refund etc.)
      } else {
        return { state: 'licensed', tier: r.payload.tier || 'core', major: r.payload.major, email: r.payload.email, issued: r.payload.issued, keyId: r.payload.id || null };
      }
    } else {
      problem = r.reason; // e.g. the saved key is for an older major version
    }
  }

  let start = Date.parse(safeGet(storage, TRIAL_START_KEY) || '');
  if (Number.isNaN(start)) {
    start = now.getTime();
    safeSet(storage, TRIAL_START_KEY, new Date(start).toISOString());
  }
  const used = Math.max(0, Math.floor((now.getTime() - start) / DAY_MS)); // clock set backwards never extends it
  const daysLeft = trialDays - used;
  const tier = isTier(trialTier) ? trialTier : 'tax';
  if (daysLeft > 0) return { state: 'trial', tier, daysLeft, problem };
  // A short courtesy period after the trial: everything still works, with a reminder.
  // Not offered to a cancelled/refunded key.
  const graceLeft = problem === 'revoked' ? 0 : trialDays + graceDays - used;
  if (graceLeft > 0) return { state: 'grace', tier, daysLeft: 0, graceDaysLeft: graceLeft, problem };
  return { state: 'expired', tier: null, daysLeft: 0, problem };
}

// Checks the key and, if genuine, saves it. Returns the verifyLicenceKey result.
// `check(payload, cleanKey)` is optional: an async hook (the licence server's device limit) that may
// answer { ok: false, reason, ... } to refuse the key BEFORE it is saved.
export async function activateLicence(key, { storage, publicKey, appVersion, check }) {
  const r = await verifyLicenceKey(key, publicKey, { appVersion });
  if (r.valid) {
    // Never let an older/lower-edition key overwrite a higher one already saved.
    const existing = safeGet(storage, LICENCE_STORAGE_KEY);
    if (existing && existing.replace(/\s+/g, '') !== key.replace(/\s+/g, '')) {
      const e = await verifyLicenceKey(existing, publicKey, { appVersion });
      if (e.valid && tierRank(e.payload.tier || 'core') > tierRank(r.payload.tier || 'core')) {
        return { valid: false, reason: 'lower-tier' };
      }
    }
    const clean = key.replace(/\s+/g, '');
    if (check) {
      const c = await check(r.payload, clean);
      if (c && c.ok === false) return { valid: false, reason: c.reason || 'refused', payload: r.payload, detail: c };
    }
    if (!safeSet(storage, LICENCE_STORAGE_KEY, clean)) return { valid: false, reason: 'storage' };
  }
  return r;
}
