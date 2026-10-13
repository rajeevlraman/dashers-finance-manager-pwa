// ============================================================================
// 💾 backupTools.js — backup bookkeeping, restore pre-checks, share-sheet save
// ----------------------------------------------------------------------------
// Everything here is plain logic with no DOM access, so it can be unit-tested
// in Node (tests/backupTools.test.js). settings.js and backupReminder.js do
// the UI work and call into this file.
// ============================================================================

export const LAST_BACKUP_KEY = 'lastBackupAt';
export const REMINDER_SNOOZE_KEY = 'backupReminderSnoozedUntil';
export const REMINDER_AFTER_DAYS = 30;
export const SNOOZE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- localStorage wrappers (storage is injectable so tests don't need a DOM) ----

function safeGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage?.setItem(key, value); return true; } catch { return false; }
}

export function recordBackup(storage, now = new Date()) {
  return safeSet(storage, LAST_BACKUP_KEY, now.toISOString());
}

export function getLastBackup(storage) {
  const raw = safeGet(storage, LAST_BACKUP_KEY);
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

export function snoozeReminder(storage, now = new Date(), days = SNOOZE_DAYS) {
  return safeSet(storage, REMINDER_SNOOZE_KEY, new Date(now.getTime() + days * DAY_MS).toISOString());
}

// Whole days between two dates, never negative.
export function daysSince(date, now = new Date()) {
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

// Decides whether the "back up your data" nudge should show.
//  - never nag an empty app (nothing to lose)
//  - "never backed up" and "last backup is old" both count as due
//  - a snooze ("Later") hides it until the snooze date
export function backupReminderState({ storage, recordCount, now = new Date(), thresholdDays = REMINDER_AFTER_DAYS }) {
  const last = getLastBackup(storage);
  const days = daysSince(last, now);
  const base = { last, days, never: last === null, due: false };

  if (!recordCount || recordCount <= 0) return base;

  const overdue = last === null || days >= thresholdDays;
  if (!overdue) return base;

  const snoozedRaw = safeGet(storage, REMINDER_SNOOZE_KEY);
  const snoozedUntil = snoozedRaw ? Date.parse(snoozedRaw) : NaN;
  if (!Number.isNaN(snoozedUntil) && snoozedUntil > now.getTime()) return base;

  return { ...base, due: true };
}

export function describeLastBackup(last, now = new Date()) {
  if (!last) return 'No backup yet';
  const d = daysSince(last, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

// ---- version comparison ("1.9.0" vs "1.10.0") ----

export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b ?? '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// ---- restore pre-check ----
// Looks at a parsed (already decrypted) backup WITHOUT touching the database
// and says what it contains, or why it can't be restored.
//   knownStores: array of IndexedDB store names this app version understands
export function inspectBackup(data, { knownStores, appVersion }) {
  const fail = (error) => ({ ok: false, error });

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('This file is not a Dashers Finance Manager backup.');
  }
  const meta = data.metadata;
  if (!meta || typeof meta !== 'object') {
    return fail('This file has no backup details (metadata), so it is not a valid backup.');
  }

  const backupVersion = typeof meta.version === 'string' ? meta.version : null;
  if (backupVersion && appVersion && compareVersions(backupVersion, appVersion) > 0) {
    return {
      ok: false,
      newer: true,
      backupVersion,
      error: `This backup was made by a newer version of the app (${backupVersion}) than the one you are running (${appVersion}). ` +
             'Update the app first (Settings → Check for Updates), then try again.'
    };
  }

  const counts = {};
  let total = 0;
  for (const store of knownStores) {
    const v = data[store];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return fail(`The backup is damaged: "${store}" is not a list of records.`);
    if (v.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      return fail(`The backup is damaged: "${store}" contains an unreadable record.`);
    }
    if (v.length > 0) { counts[store] = v.length; total += v.length; }
  }

  if (total === 0) {
    return fail('This backup contains no records that this app recognises, so there is nothing to restore.');
  }

  const unknownStores = Object.keys(data).filter(k => k !== 'metadata' && k !== 'licence' && !knownStores.includes(k));
  const exportDate = meta.exportDate && !Number.isNaN(Date.parse(meta.exportDate)) ? new Date(meta.exportDate) : null;

  return { ok: true, counts, total, backupVersion, exportDate, unknownStores };
}

// ---- saving the backup file (iPhone share sheet vs plain download) ----

export function backupFilename(now = new Date(), encrypted = false) {
  const day = now.toISOString().split('T')[0];
  return `dashers-backup-${day}${encrypted ? '-encrypted' : ''}.json`;
}

// True when the browser can hand a file to the system share sheet
// (on iPhone this is what offers "Save to Files" / iCloud Drive / AirDrop).
export function canShareFile(file, nav = globalThis.navigator) {
  try {
    return !!(nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

// Returns 'shared' | 'cancelled' | 'failed'. Never throws.
// 'cancelled' means the person dismissed the share sheet: the backup was NOT saved.
export async function shareBackupFile(file, nav = globalThis.navigator) {
  try {
    await nav.share({ files: [file], title: 'Dashers Finance Manager backup' });
    return 'shared';
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}
