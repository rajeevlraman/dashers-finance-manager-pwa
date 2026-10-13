// ============================================================================
// 💱 currency.js — single source of truth for money formatting + conversion
// ----------------------------------------------------------------------------
// - Base currency comes from Settings (default AUD). Records may override it
//   by passing their own currency code.
// - Exchange rates are a manual table: rates[CODE] = how many BASE units one
//   unit of CODE is worth. Stored in the `meta` store (which family sync
//   always syncs) with a last-updated date, and mirrored into localStorage so
//   formatting can stay synchronous.
// - Tax / ATO / cost base / super code should call formatMoney(x, 'AUD')
//   explicitly: those figures are AUD by definition.
// ============================================================================

import { getAllItems, updateItem, STORE_NAMES } from '../db.js';

export const CURRENCIES = [
  { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: '$' }
];

export const DEFAULT_BASE = 'AUD';
const META_ID = 'currencySettings';
const LS_BASE = 'currency';
const LS_RATES = 'currencyRates';
const LS_UPDATED = 'currencyRatesUpdated';
const LS_LIST = 'currencyList';

const fmtCache = new Map();
const state = { base: DEFAULT_BASE, rates: {}, updated: null, extra: [], hidden: [] };

function readLocal() {
  try {
    state.base = localStorage.getItem(LS_BASE) || DEFAULT_BASE;
    state.rates = JSON.parse(localStorage.getItem(LS_RATES) || '{}') || {};
    state.updated = localStorage.getItem(LS_UPDATED) || null;
    const l = JSON.parse(localStorage.getItem(LS_LIST) || '{}') || {};
    state.extra = l.extra || []; state.hidden = l.hidden || [];
  } catch { /* storage unavailable: keep defaults */ }
}
function writeLocal() {
  try {
    localStorage.setItem(LS_BASE, state.base);
    localStorage.setItem(LS_RATES, JSON.stringify(state.rates));
    if (state.updated) localStorage.setItem(LS_UPDATED, state.updated);
    localStorage.setItem(LS_LIST, JSON.stringify({ extra: state.extra, hidden: state.hidden }));
  } catch { /* ignore */ }
}
readLocal();

// Set state in memory only (used by initCurrency and tests).
export function configureCurrency({ base = DEFAULT_BASE, rates = {}, updated = null, extra = [], hidden = [] } = {}) {
  state.base = base; state.rates = { ...rates }; state.updated = updated;
  state.extra = [...extra]; state.hidden = [...hidden];
  fmtCache.clear();
}

// Load the synced copy (call once at startup, and after each sync pull).
export async function initCurrency() {
  try {
    const rec = (await getAllItems(STORE_NAMES.meta)).find(r => r.id === META_ID);
    if (rec) {
      configureCurrency({ base: rec.base, rates: rec.rates, updated: rec.ratesUpdated, extra: rec.extra, hidden: rec.hidden });
      writeLocal();
    }
  } catch (err) {
    console.warn('⚠️ Could not load currency settings, using local copy:', err);
  }
}

async function persist() {
  writeLocal();
  await updateItem(STORE_NAMES.meta, {
    id: META_ID,
    base: state.base,
    rates: state.rates,
    ratesUpdated: state.updated,
    extra: state.extra,
    hidden: state.hidden
  });
}

export const getBaseCurrency = () => state.base;
export const getRates = () => ({ ...state.rates });
export const getRatesUpdated = () => state.updated;

export async function setBaseCurrency(code) {
  if (code === state.base) return;
  // Rates are "base per 1 unit", so they mean nothing under a new base.
  state.base = code;
  state.rates = {};
  state.updated = null;
  await persist();
}

export async function setRate(code, rate) {
  const n = Number(rate);
  if (code === state.base) return;
  if (!(n > 0)) delete state.rates[code];
  else state.rates[code] = n;
  state.updated = new Date().toISOString().slice(0, 10);
  await persist();
}

// True when amounts in `code` can be converted to base.
export const hasRate = code => !code || code === state.base || state.rates[code] > 0;

// Convert an amount in `code` to the base currency. With no rate on file the
// amount is returned unchanged; use hasRate() to warn the user.
export function toBase(amount, code) {
  const n = Number(amount) || 0;
  if (!code || code === state.base) return n;
  const r = state.rates[code];
  return r > 0 ? n * r : n;
}

// Rupees print the way an Indian bank statement does (₹2,34,726.00 — lakh/crore
// grouping and the ₹ sign). en-AU would give "INR 234,726.00", which doesn't match
// what's on the person's own statements.
const LOCALE_BY_CURRENCY = { INR: 'en-IN' };

// opts: digits (fixed decimals) | whole (no decimals) | abs (magnitude only) |
//       display ('code' -> "AUD 1,234.00")
export function formatMoney(amount, currency, opts = {}) {
  const code = currency || state.base;
  const digits = opts.whole ? 0 : opts.digits;
  const display = opts.display;
  const key = `${code}|${digits ?? ''}|${display ?? ''}`;
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE_BY_CURRENCY[code] || 'en-AU', {
        style: 'currency',
        currency: code,
        ...(display ? { currencyDisplay: display } : {}),
        ...(digits !== undefined ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {})
      });
    } catch {
      // Not a valid currency code (corrupt/legacy data): fall back to the base rather than throw mid-render.
      f = new Intl.NumberFormat('en-AU', { style: 'currency', currency: state.base,
        ...(digits !== undefined ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}) });
    }
    fmtCache.set(key, f);
  }
  let n = Number(amount);
  if (!Number.isFinite(n)) n = 0;
  return f.format(opts.abs ? Math.abs(n) : n);
}

// Compact figure for chart axes / tiles: ₹2.3L-style isn't used; "k" matches the rest of the app.
export function formatCompact(amount, currency, { upperK = false } = {}) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  let sym = currencySymbol(currency);
  if (/[A-Za-z]$/.test(sym)) sym += ' '; // code-style symbols (KWD, USD) read better with a space
  const k = upperK ? 'K' : 'k';
  if (abs >= 1000) return `${sign}${sym}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}${k}`;
  return `${sign}${sym}${abs.toFixed(0)}`;
}

// "A$1,234.00 ≈ US$…" helper: the base equivalent of a foreign amount, or ''
// when the amount is already in base (or no rate is set).
export function baseEquivalent(amount, code) {
  if (!code || code === state.base || !hasRate(code)) return '';
  return `≈ ${formatMoney(toBase(amount, code), undefined, { display: 'code' })}`;
}

// ---- Cross-currency (transfers between accounts in different currencies) ------
// Units of `to` you get for 1 unit of `from`, derived via the base-currency rates.
// null when either currency has no rate on file.
export function crossRate(from, to) {
  if (!from || !to || from === to) return 1;
  if (!hasRate(from) || !hasRate(to)) return null;
  const rf = from === state.base ? 1 : state.rates[from];
  const rt = to === state.base ? 1 : state.rates[to];
  return rf / rt;
}

// Round to the currency's own minor-unit precision (2 for AUD/USD/INR, 3 for KWD, 0 for JPY).
export function roundForCurrency(amount, currency) {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en-AU', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch { /* keep 2 */ }
  const f = 10 ** digits;
  return Math.round((Number(amount) || 0) * f) / f;
}

// Amount in `from` -> amount in `to` at the stored rates; null if no rate.
export function convertBetween(amount, from, to) {
  const rate = crossRate(from, to);
  return rate === null ? null : roundForCurrency(Number(amount) * rate, to);
}

// For code that creates BOTH sides of a transfer (bill payments, recurring auto-pay,
// "convert to transfer"): given the amount leaving `fromCur`, work out what arrives in
// `toCur`. Falls back to the same figure when no rate exists (the old behaviour) and says so.
export function transferLegs(amount, fromCur, toCur) {
  const cross = !!fromCur && !!toCur && fromCur !== toCur;
  if (!cross) return { sent: amount, received: amount, cross: false, estimated: false, fx: {} };
  const converted = convertBetween(amount, fromCur, toCur);
  const received = converted ?? amount;
  return {
    sent: amount,
    received,
    cross: true,
    estimated: converted === null ? 'no-rate' : 'stored-rate',
    // same field names the manual transfer form in accounts.js writes
    fx: { fxRate: received / amount, fxFrom: fromCur, fxTo: toCur }
  };
}

// Short symbol for compact displays ("$12k"): the base currency by default.
export function currencySymbol(currency) {
  const code = currency || state.base;
  const part = new Intl.NumberFormat('en-AU', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0).find(p => p.type === 'currency');
  return part ? part.value : code;
}

// Aggregate views (reports, budgets, cash-flow) want every transaction in ONE
// currency. Returns copies with `amount` converted to base using the owning
// account's currency; the untouched figures stay on `amountOriginal` /
// `currency`. Do NOT feed the result to computeAccountBalance() — balances
// need the raw per-account amounts.
export function toBaseTransactions(transactions, accounts) {
  const cur = new Map((accounts || []).map(a => [a.id, a.currency]));
  return (transactions || []).map(t => {
    const code = t.currency || cur.get(t.accountId);
    if (!code || code === state.base) return t;
    return { ...t, amount: toBase(t.amount, code), amountOriginal: t.amount, currency: code };
  });
}

// Currencies in use that have no rate on file (to warn the user).
export function unpricedCurrencies(accounts) {
  return [...new Set((accounts || []).map(a => a.currency).filter(c => c && !hasRate(c)))];
}

// ---- Editable currency list ------------------------------------------------
// Built-in CURRENCIES can be hidden, and any valid ISO 4217 code can be added.
export function getCurrencies() {
  const all = [...CURRENCIES, ...state.extra.filter(e => !CURRENCIES.some(c => c.code === e.code))];
  return all.filter(c => !state.hidden.includes(c.code) || c.code === state.base);
}

export async function addCurrency(rawCode, name) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Use a 3-letter currency code, e.g. CHF');
  try { new Intl.NumberFormat('en-AU', { style: 'currency', currency: code }); }
  catch { throw new Error(`${code} is not a recognised currency code`); }
  if (getCurrencies().some(c => c.code === code)) return;
  state.hidden = state.hidden.filter(h => h !== code);
  if (!CURRENCIES.some(c => c.code === code)) {
    state.extra.push({ code, name: name || code, symbol: currencySymbol(code) });
  }
  await persist();
}

// accounts: the current accounts list; blocks removal while any use the code.
export async function removeCurrency(code, accounts = []) {
  if (code === state.base) throw new Error('Change the base currency before removing it');
  const users = accounts.filter(a => a.currency === code);
  if (users.length) throw new Error(`${users.length} account(s) still use ${code}: ${users.map(a => a.name).join(', ')}`);
  state.extra = state.extra.filter(e => e.code !== code);
  if (CURRENCIES.some(c => c.code === code) && !state.hidden.includes(code)) state.hidden.push(code);
  delete state.rates[code];
  await persist();
}

// ---- AUD values for tax / ATO / cost base -----------------------------------
// The ATO needs AUD. A transaction entered in a foreign-currency account can
// carry an explicit `amountAUD` (signed like `amount`); otherwise it is
// converted with the current manual rates.
export function toAud(amount, code) {
  const n = Number(amount) || 0;
  if (!code || code === 'AUD') return n;
  const inBase = toBase(n, code);
  if (state.base === 'AUD') return inBase;
  const audRate = state.rates.AUD;            // AUD -> base
  return audRate > 0 ? inBase / audRate : n;  // no AUD rate: leave as is
}

export function toAudTransactions(transactions, accounts) {
  const cur = new Map((accounts || []).map(a => [a.id, a.currency]));
  return (transactions || []).map(t => {
    if (t.amountAUD !== undefined && t.amountAUD !== null && t.amountAUD !== '') {
      return { ...t, amount: Number(t.amountAUD), amountOriginal: t.amount };
    }
    const code = t.currency || cur.get(t.accountId);
    if (!code || code === 'AUD') return t;
    return { ...t, amount: toAud(t.amount, code), amountOriginal: t.amount, currency: code };
  });
}

// Stamp a transaction with its AUD value at creation time (best effort). Use
// for transactions created by code (recurring jobs, loan payments, imports)
// where the person isn't asked for an AUD figure. The AUD value uses the
// manual rate on file *now*; it is left off if the account is AUD or no rate
// exists, and never overwrites a value the person entered.
export function withAud(tx, accountCurrency) {
  if (!tx || (tx.amountAUD !== undefined && tx.amountAUD !== null)) return tx;
  if (!accountCurrency || accountCurrency === 'AUD') return tx;
  if (!hasRate(accountCurrency) || (state.base !== 'AUD' && !(state.rates.AUD > 0))) return tx;
  const aud = toAud(tx.amount, accountCurrency);
  tx.amountAUD = Math.round(aud * 100) / 100;
  tx.fxRateAUD = tx.amount ? Math.abs(aud / tx.amount) : null;
  return tx;
}

// Same, looking the account's currency up by tx.accountId.
export async function stampAud(tx) {
  if (!tx || !tx.accountId) return tx;
  const acct = (await getAllItems(STORE_NAMES.accounts)).find(a => a.id === tx.accountId);
  return withAud(tx, acct?.currency);
}

// The line shown under a foreign-account transaction: its AUD value when one
// was saved (entered or stamped), else the base-currency equivalent at today's
// rate. Empty for base-currency accounts, or when no rate exists.
export function txEquivalent(tx, accountCurrency) {
  if (!accountCurrency || accountCurrency === state.base) return '';
  if (state.base === 'AUD' && tx.amountAUD !== undefined && tx.amountAUD !== null && tx.amountAUD !== '') {
    return `≈ ${formatMoney(Math.abs(tx.amountAUD), 'AUD', { display: 'code' })}`;
  }
  return baseEquivalent(Math.abs(tx.amount), accountCurrency);
}

// ---- Properties ---------------------------------------------------------------
// A property's price, value, rent, mortgage and loan balance are in the property's own
// currency. Properties saved before the field existed were all Australian, so a missing
// currency means AUD — NOT the base currency (changing the base must not silently
// re-label an Australian house as rupees).
export function propertyCurrency(p) {
  return p?.currency || 'AUD';
}

// A property money field converted to the base currency (for portfolio / net-worth totals).
export function propertyAmountInBase(p, field) {
  return toBase(parseFloat(p?.[field]) || 0, propertyCurrency(p));
}

// ---- Bills, recurring items and other records that belong to an account -------
// A bill / recurring rule is paid from an account, so its amount is in that
// account's currency unless the record carries its own `currency`. Records with
// no account use the base currency.
export function recordCurrency(rec, accounts) {
  if (!rec) return state.base;
  if (rec.currency) return rec.currency;
  const acct = (accounts || []).find(a => a.id === rec.accountId);
  return acct?.currency || state.base;
}

// Copies with `amount` converted to base (originals on amountOriginal/currency),
// for totals. Display individual items with their own currency instead.
export function toBaseRecords(records, accounts, amountKey = 'amount') {
  return (records || []).map(r => {
    const code = recordCurrency(r, accounts);
    if (code === state.base) return r;
    return { ...r, [amountKey]: toBase(parseFloat(r[amountKey]) || 0, code), amountOriginal: r[amountKey], currency: code };
  });
}
