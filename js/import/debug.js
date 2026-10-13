// ============================================================================
// 🪲 import/debug.js — Import Debug Toggle & Logger
// ============================================================================

const IMPORT_DEBUG_KEY = 'dfm_import_debug'; // localStorage key

export function isImportDebugEnabled() {
  try {
    // URL override for quick dev use: ?importDebug=1
    const params = new URLSearchParams(globalThis.window?.location?.search || '');
    if (params.get('importDebug') === '1') return true;

    const storage = globalThis.localStorage;
    if (!storage) return false;
    const raw = storage.getItem(IMPORT_DEBUG_KEY);
    return raw === '1';
  } catch (e) {
    console.warn('[IMPORT-DEBUG] Failed to read debug flag', e);
    return false;
  }
}

export function setImportDebugEnabled(enabled) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(IMPORT_DEBUG_KEY, enabled ? '1' : '0');
  } catch (e) {
    console.warn('[IMPORT-DEBUG] Failed to persist debug flag', e);
  }
}

export function logImportDebug(...args) {
  if (!isImportDebugEnabled()) return;
  console.debug('[IMPORT-DEBUG]', ...args);
}
