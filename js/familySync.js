// ============================================================================
// 👨‍👩‍👧‍👦 familySync.js — Client side of the local family sync server
// ============================================================================
// Talks to the family-server/ Node server over your home WiFi (never the
// internet). Sync is pull-then-push, triggered manually or on app open —
// not live/websocket-based, per the "fine if it syncs when the app opens"
// requirement this was built for.
//
// Conflict resolution is last-write-wins by `updatedAt`, applied
// symmetrically on both the server (family-server/server.js) and here.
// ============================================================================

import { getAllItems, putRawItem, deleteItem, clearStoreLocal, getTombstonesSince, STORE_NAMES } from './db.js';

const META_ID = 'familySync';

// Keep this in sync with family-server/permissions.js SECTION_STORES.
// Duplicated (rather than imported cross-folder) so the app's js/ folder
// stays fully self-contained and deployable on its own.
const SECTION_STORES = {
  dashboard: [],
  transactions: ['transactions'],
  budgets: ['budgets', 'budget_templates'],
  accounts: ['accounts'],
  categories: ['categories'],
  reports: [],
  bills: ['bills'],
  calendar: [],
  recurring: ['recurringTransactions'],
  subscriptions: ['subscriptions'],
  loans: ['loans', 'loanTransactions'],
  properties: ['properties'],
  tenants: ['tenants'],
  maintenance: ['maintenance'],
  expenses: ['expenses', 'propertyExpenseCategories'],
  tax: ['tax_records'],
  costbase: ['costbase'],
  superannuation: ['super_funds', 'super_balance_history', 'super_contributions', 'super_premiums', 'super_fees', 'super_recurring_contributions'],
  insurance: ['insurance_policies'],
  vehicles: ['vehicles'],
  settings: []
};
const ALWAYS_SYNCED_STORES = ['meta'];

export function storesForSections(sections) {
  if (sections.includes('*')) {
    const all = new Set(ALWAYS_SYNCED_STORES);
    Object.values(SECTION_STORES).forEach(stores => stores.forEach(s => all.add(s)));
    return [...all];
  }
  const set = new Set(ALWAYS_SYNCED_STORES);
  for (const section of sections) {
    (SECTION_STORES[section] || []).forEach(s => set.add(s));
  }
  return [...set];
}

// ----------------------------------------------------------------------------
// Connection state (persisted in the existing `meta` store)
// ----------------------------------------------------------------------------
async function getConnection() {
  const all = await getAllItems(STORE_NAMES.meta);
  return all.find(r => r.id === META_ID) || null;
}

async function saveConnection(patch) {
  const existing = await getConnection();
  const merged = { id: META_ID, ...existing, ...patch };
  await putRawItem(STORE_NAMES.meta, merged);
  return merged;
}

export async function getConnectionInfo() {
  return getConnection();
}

export async function isConnected() {
  const conn = await getConnection();
  return !!(conn && conn.serverUrl && conn.token);
}

export async function isAdmin() {
  const conn = await getConnection();
  return !!(conn && conn.role === 'admin');
}

export async function getPermittedSections() {
  const conn = await getConnection();
  if (!conn) return null; // not connected: no restriction, everything visible
  return conn.sections || [];
}

export async function disconnect() {
  const conn = await getConnection();
  if (conn && conn.serverUrl && conn.token) {
    try {
      await fetch(`${conn.serverUrl}/api/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${conn.token}` }
      });
    } catch (err) {
      // Server unreachable — fine, we're disconnecting locally regardless.
    }
  }
  await putRawItem(STORE_NAMES.meta, { id: META_ID, serverUrl: null, token: null, sections: null });
}

// ----------------------------------------------------------------------------
// Setup / login
// ----------------------------------------------------------------------------
function normalizeServerUrl(url) {
  return url.replace(/\/+$/, '');
}

export async function checkSetupStatus(serverUrl) {
  const base = normalizeServerUrl(serverUrl);
  const res = await fetch(`${base}/api/setup/status`);
  if (!res.ok) throw new Error(`Couldn't reach the server (HTTP ${res.status})`);
  return res.json(); // { needsSetup: boolean }
}

export async function setupAdminAccount(serverUrl, username, password) {
  const base = normalizeServerUrl(serverUrl);
  const res = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Setup failed');
  return loginToServer(serverUrl, username, password);
}

export async function loginToServer(serverUrl, username, password) {
  const base = normalizeServerUrl(serverUrl);
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Login failed');

  await saveConnection({
    serverUrl: base,
    token: body.token,
    username: body.user.username,
    role: body.user.role,
    sections: body.user.sections,
    lastSyncTime: null
  });
  return body.user;
}

// ----------------------------------------------------------------------------
// Family member management (admin only — server also enforces this)
// ----------------------------------------------------------------------------
async function authedFetch(path, options = {}) {
  const conn = await getConnection();
  if (!conn || !conn.serverUrl || !conn.token) {
    throw new Error('Not connected to a family server.');
  }
  const res = await fetch(`${conn.serverUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${conn.token}`,
      ...(options.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status})`);
  return body;
}

export async function listFamilyMembers() {
  return authedFetch('/api/users');
}

export async function createFamilyMember(username, password, sections) {
  return authedFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, sections })
  });
}

export async function updateFamilyMember(userId, { sections, password } = {}) {
  return authedFetch(`/api/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ sections, password })
  });
}

export async function deleteFamilyMember(userId) {
  return authedFetch(`/api/users/${userId}`, { method: 'DELETE' });
}

// ----------------------------------------------------------------------------
// Offline indicator
// ----------------------------------------------------------------------------
// Being "connected" (has stored credentials) and being "reachable right now"
// are different things — you can have valid saved login but be away from
// home WiFi, or the server machine could just be off. This is a lightweight
// ping (no auth, no data transfer) separate from a full sync, so the
// indicator can be refreshed often without the cost of a real sync.
export async function checkServerReachable(timeoutMs = 3000) {
  const conn = await getConnection();
  if (!conn || !conn.serverUrl) return null; // not connected at all
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${conn.serverUrl}/api/setup/status`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Updates the small 🟢/🔴 badge in the header next to the general
 * online/offline indicator. Hidden entirely when not connected to a family
 * server at all, since most people never use this feature.
 */
export async function updateFamilySyncIndicator() {
  const badge = document.getElementById('familySyncIndicator');
  if (!badge) return;

  const conn = await getConnection();
  if (!conn || !conn.serverUrl || !conn.token) {
    badge.style.display = 'none';
    return;
  }

  const reachable = await checkServerReachable();
  badge.style.display = 'inline';
  if (reachable) {
    badge.textContent = '👨‍👩‍👧‍👦🟢';
    badge.title = 'Family Sync: server reachable';
  } else {
    badge.textContent = '👨‍👩‍👧‍👦⚪';
    badge.title = 'Family Sync: server unreachable right now (changes will sync next time it is)';
  }
}

let indicatorIntervalId = null;

/** Call once at startup. Keeps the header badge reasonably fresh without
 * needing a full sync each time — just a cheap reachability ping. */
export function startFamilySyncIndicatorPolling(intervalMs = 60000) {
  updateFamilySyncIndicator();
  if (indicatorIntervalId) clearInterval(indicatorIntervalId);
  indicatorIntervalId = setInterval(updateFamilySyncIndicator, intervalMs);
}

// ----------------------------------------------------------------------------
// Sync
// ----------------------------------------------------------------------------
/**
 * Pulls remote changes (merging with last-write-wins), applies any
 * deletions, clears local data for sections no longer permitted, then
 * pushes local changes made since the last sync. Safe to call when not
 * connected (resolves immediately) or when the server is unreachable
 * (fails quietly — the app is fully usable offline regardless).
 */
export async function syncNow() {
  const conn = await getConnection();
  if (!conn || !conn.serverUrl || !conn.token) {
    return { synced: false, reason: 'not-connected' };
  }

  try {
    // --- Pull ---
    const since = conn.lastSyncTime ? `?since=${encodeURIComponent(conn.lastSyncTime)}` : '';
    const pullRes = await fetch(`${conn.serverUrl}/api/sync/pull${since}`, {
      headers: { Authorization: `Bearer ${conn.token}` }
    });
    if (pullRes.status === 401) {
      await saveConnection({ token: null });
      return { synced: false, reason: 'session-expired' };
    }
    if (!pullRes.ok) {
      return { synced: false, reason: `server-error-${pullRes.status}` };
    }
    const pullBody = await pullRes.json();

    // Apply remote records, but only where remote is at least as new as
    // whatever we already have locally (mirrors the server's own merge
    // logic, so neither side can silently clobber a newer local edit that
    // just hasn't been pushed yet).
    let pulledCount = 0;
    for (const [storeName, records] of Object.entries(pullBody.data || {})) {
      if (!Array.isArray(records) || records.length === 0) continue;
      const localRecords = await getAllItems(storeName).catch(() => []);
      const localById = new Map(localRecords.map(r => [r.id, r]));
      for (const record of records) {
        const local = localById.get(record.id);
        const remoteIsNewerOrEqual = !local || !local.updatedAt || !record.updatedAt || record.updatedAt >= local.updatedAt;
        if (remoteIsNewerOrEqual) {
          await putRawItem(storeName, record);
          pulledCount++;
        }
      }
    }

    // Apply remote deletions locally (skipTombstone: this deletion already
    // happened elsewhere — recording a fresh local tombstone would just
    // bounce it back to the server as if it were a new deletion).
    for (const tombstone of pullBody.tombstones || []) {
      await deleteItem(tombstone.storeName, tombstone.recordId, { skipTombstone: true }).catch(() => {});
    }

    // If our permitted sections shrank since last time, wipe the
    // now-unauthorized local data — the data still lives on the server,
    // this only removes this device's local copy.
    const previousStores = new Set(storesForSections(conn.sections || []));
    const currentStores = new Set(storesForSections(pullBody.sections || []));
    for (const storeName of previousStores) {
      if (!currentStores.has(storeName)) {
        await clearStoreLocal(storeName).catch(() => {});
      }
    }

    // --- Push ---
    const permittedStores = storesForSections(pullBody.sections || []);
    const pushData = {};
    for (const storeName of permittedStores) {
      const all = await getAllItems(storeName).catch(() => []);
      const changed = conn.lastSyncTime
        ? all.filter(r => r.updatedAt && r.updatedAt > conn.lastSyncTime)
        : all;
      if (changed.length) pushData[storeName] = changed;
    }
    const localTombstones = await getTombstonesSince(conn.lastSyncTime).catch(() => []);
    const pushTombstones = localTombstones.filter(t => permittedStores.includes(t.storeName));

    let pushBody = { serverTime: pullBody.serverTime };
    if (Object.keys(pushData).length || pushTombstones.length) {
      const pushRes = await fetch(`${conn.serverUrl}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
        body: JSON.stringify({ data: pushData, tombstones: pushTombstones })
      });
      if (pushRes.ok) {
        pushBody = await pushRes.json();
      }
    }

    await saveConnection({
      sections: pullBody.sections,
      lastSyncTime: pushBody.serverTime || pullBody.serverTime
    });

    return {
      synced: true,
      pulled: pulledCount,
      pushed: Object.values(pushData).reduce((sum, arr) => sum + arr.length, 0)
    };
  } catch (err) {
    // Server unreachable (not on the home WiFi, server off, etc). This is
    // expected and fine — the app keeps working fully offline.
    return { synced: false, reason: 'unreachable', error: err.message };
  }
}
