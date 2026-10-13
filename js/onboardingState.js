// onboardingState.js
//
// The brains of the first-run setup guide, kept free of any DOM so it can be
// unit-tested: when to show the guide, which steps there are, and how the
// answers to each short form become the same records the full pages save.

import { buildAccountRecord, buildPropertyRecord } from './records.js';

export const STORAGE_KEY = 'dfm_onboarding';

// Order matters: accounts first (everything refers to them); insurance last so a
// policy can link to the property or vehicle added just before it.
export const ALL_STEPS = ['welcome', 'currency', 'accounts', 'budgets', 'bills', 'recurring', 'subscriptions', 'loans', 'properties', 'tenants', 'vehicles', 'super', 'insurance', 'tour', 'finish'];

// Steps that collect records (everything between the welcome and the tour).
export const DATA_STEPS = ['accounts', 'budgets', 'bills', 'recurring', 'subscriptions', 'loans', 'properties', 'tenants', 'vehicles', 'super', 'insurance'];
const PROPERTY_STEPS = ['properties', 'tenants'];

export const STEP_NAMES = {
  accounts: 'Accounts', budgets: 'Budgets', bills: 'Bills', recurring: 'Recurring', subscriptions: 'Subscriptions',
  loans: 'Loans', properties: 'Properties', tenants: 'Tenants', vehicles: 'Vehicles', super: 'Super', insurance: 'Insurance',
};

export function freshState() {
  return { v: 1, status: 'in_progress', step: 'welcome', added: [], forced: false, tourOnly: false, skipped: [], drafts: {}, lastStep: 'welcome', nudgeOff: false };
}

export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || !ALL_STEPS.includes(s.step)) return null;
    return { ...freshState(), ...s, added: Array.isArray(s.added) ? s.added : [], skipped: Array.isArray(s.skipped) ? s.skipped.filter(x => DATA_STEPS.includes(x)) : [], drafts: s.drafts && typeof s.drafts === 'object' && !Array.isArray(s.drafts) ? s.drafts : {} };
  } catch {
    return null;
  }
}

export function saveState(storage, state) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: guide just won't remember */ }
}

// existingCount = records already in the app that the guide did NOT add.
// A brand-new install has none. Anyone with data (an upgrade, a restored
// backup, the demo data) never sees the guide unless they ask for it.
export function shouldShowOnboarding({ state, existingCount, connectedToFamily = false }) {
  if (connectedToFamily) return false;                 // data will arrive by sync
  if (state && (state.status === 'done' || state.status === 'dismissed')) return false;
  if (existingCount > 0) return false;
  return true;
}

// tourOnly: the standalone "Take the tour" mode, which is just the tour step.
export function stepsFor({ propertiesAllowed = true, tourOnly = false } = {}) {
  if (tourOnly) return ['tour'];
  return ALL_STEPS.filter(s => propertiesAllowed || !PROPERTY_STEPS.includes(s));
}

export function stepIndex(steps, step) {
  const i = steps.indexOf(step);
  return i < 0 ? 0 : i;
}

export function nextStep(steps, step) { return steps[Math.min(stepIndex(steps, step) + 1, steps.length - 1)]; }
export function prevStep(steps, step) { return steps[Math.max(stepIndex(steps, step) - 1, 0)]; }

export function progress(steps, step) {
  // Welcome is step 0; the bar fills as you move through the rest.
  const i = stepIndex(steps, step);
  return { index: i, total: steps.length, percent: steps.length <= 1 ? 100 : Math.round((i / (steps.length - 1)) * 100) };
}

// ---------------------------------------------------------------------------
// Remembering where the person got to
// ---------------------------------------------------------------------------
// Has the person done anything in the guide worth resuming?
export function hasProgress(state) {
  if (!state) return false;
  return (state.added?.length || 0) > 0 || (state.skipped?.length || 0) > 0 ||
    Object.keys(state.drafts || {}).length > 0 || (state.lastStep && state.lastStep !== 'welcome');
}

// 'done' (something added), 'skipped' (passed over), or 'todo' for each data step.
export function stepStatuses(state, steps) {
  return steps.filter(s => DATA_STEPS.includes(s)).map(step => ({
    step,
    status: state?.added?.some(a => a.step === step) ? 'done' : (state?.skipped?.includes(step) ? 'skipped' : 'todo'),
  }));
}

export function remainingSteps(state, steps) {
  return stepStatuses(state, steps).filter(x => x.status !== 'done').map(x => x.step);
}

export function markSkipped(state, step) {
  if (!DATA_STEPS.includes(step) || state.added.some(a => a.step === step) || state.skipped.includes(step)) return;
  state.skipped.push(step);
}

export function unmarkSkipped(state, step) { state.skipped = state.skipped.filter(x => x !== step); }

// Drafts: what was typed in a short form but not saved yet.
export function setDraft(state, step, values) {
  const kept = {};
  for (const [k, v] of Object.entries(values || {})) if (String(v ?? '').trim() !== '') kept[k] = String(v);
  if (Object.keys(kept).length) state.drafts[step] = kept; else delete state.drafts[step];
}
export function clearDraft(state, step) { delete state.drafts[step]; }

// ---------------------------------------------------------------------------
// Small form helpers
// ---------------------------------------------------------------------------
export function num(v) {
  if (v === undefined || v === null) return NaN;
  const s = String(v).replace(/[,\s$\u00A3\u20AC\u20B9]/g, '').trim();   // people type "$1,200"
  if (s === '') return NaN;
  return Number(s);
}

const clean = v => String(v ?? '').trim();
const today = (now = new Date()) => now.toISOString().slice(0, 10);

function result(errors, record, extras = {}) {
  return errors.length ? { ok: false, errors } : { ok: true, record, ...extras };
}

// ---------------------------------------------------------------------------
// Builders: each takes the raw form values and returns {ok, record} or {ok:false, errors}
// ---------------------------------------------------------------------------
export function buildAccount(v, { baseCurrency = 'AUD' } = {}) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Give the account a name.' });
  const type = clean(v.type) || 'bank';
  let opening = v.openingBalance === '' || v.openingBalance == null ? 0 : num(v.openingBalance);
  if (Number.isNaN(opening)) errors.push({ field: 'openingBalance', message: 'Enter the balance as a number.' });
  if (type === 'credit') opening = -Math.abs(opening || 0);           // the app stores what you owe as negative
  // Validation stays here; the record itself comes from the same builder the
  // Accounts page uses (records.js), so the two cannot drift apart.
  let creditLimit = 0;
  if (type === 'credit') {
    creditLimit = v.creditLimit === '' || v.creditLimit == null ? 0 : num(v.creditLimit);
    if (Number.isNaN(creditLimit) || creditLimit < 0) errors.push({ field: 'creditLimit', message: 'Enter the credit limit as a number.' });
  }
  const record = buildAccountRecord({
    name, type,
    openingBalance: opening || 0,
    currency: clean(v.currency) || baseCurrency,
    creditLimit: creditLimit || 0,
  });
  return result(errors, record);
}

export function buildLoan(v, { baseCurrency = 'AUD', now = new Date() } = {}) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Give the loan a name.' });
  const type = clean(v.type) || 'personal';
  const balance = num(v.currentBalance);
  if (Number.isNaN(balance) || balance < 0) errors.push({ field: 'currentBalance', message: 'Enter how much you still owe.' });
  const rate = num(v.interestRate);
  if (Number.isNaN(rate) || rate < 0 || rate > 100) errors.push({ field: 'interestRate', message: 'Enter the yearly interest rate, e.g. 6.2.' });
  const years = num(v.termYears);
  if (Number.isNaN(years) || years <= 0 || years > 60) errors.push({ field: 'termYears', message: 'Enter the loan term in years, e.g. 25.' });
  const balanceOk = !Number.isNaN(balance) && balance >= 0;
  const original = v.originalAmount === '' || v.originalAmount == null ? (balanceOk ? balance : 0) : num(v.originalAmount);
  if (Number.isNaN(original) || original < 0) errors.push({ field: 'originalAmount', message: 'Enter the amount you first borrowed, or leave it blank.' });
  const startDate = clean(v.startDate) || today(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.push({ field: 'startDate', message: 'Pick the date the loan started.' });
  const icons = { mortgage: '🏠', vehicle: '🚗', personal: '👤', education: '🎓', business: '💼', investment: '🏢' };
  const record = {
    name, type,
    originalAmount: Math.max(original || 0, balance || 0),
    currentBalance: balance,
    interestRate: rate,
    termMonths: Math.round((years || 0) * 12),
    startDate,
    paymentFrequency: clean(v.paymentFrequency) || 'monthly',
    interestOnlyMonths: 0,
    fixedRateEndDate: '',
    rateHistory: [],
    currency: baseCurrency,
    icon: icons[type] || '🏦',
    institution: '', institutionName: '', propertyId: '',
  };
  return result(errors, record);
}

export function buildProperty(v, { baseCurrency = 'AUD' } = {}) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Give the property a name, e.g. Family home.' });
  const type = clean(v.propertyType) === 'investment' ? 'investment' : 'primary';
  const money = (key, label) => {
    if (v[key] === '' || v[key] == null) return 0;
    const n = num(v[key]);
    if (Number.isNaN(n) || n < 0) { errors.push({ field: key, message: `Enter ${label} as a number.` }); return 0; }
    return n;
  };
  const purchasePrice = money('purchasePrice', 'the purchase price');
  const currentValue = money('currentValue', 'the current value');
  const rent = type === 'investment' ? money('rent', 'the monthly rent') : 0;
  // Same builder as the Properties page (records.js). The guide's own defaults
  // (value falls back to the price) are applied before handing over.
  const record = buildPropertyRecord({
    currency: clean(v.currency) || baseCurrency,
    name, address: clean(v.address),
    purchasePrice, currentValue: currentValue || purchasePrice,
    propertyType: type,
    rent,
  });
  return result(errors, record);
}

export function buildVehicle(v) {
  const errors = [];
  const nickname = clean(v.nickname);
  if (!nickname) errors.push({ field: 'nickname', message: 'Give the vehicle a name, e.g. Family car.' });
  const regoCost = v.regoCost === '' || v.regoCost == null ? 0 : num(v.regoCost);
  if (Number.isNaN(regoCost) || regoCost < 0) errors.push({ field: 'regoCost', message: 'Enter the registration cost as a number.' });
  const year = clean(v.year);
  if (year && !/^(19|20)\d{2}$/.test(year)) errors.push({ field: 'year', message: 'Enter a 4-digit year, e.g. 2019.' });
  const record = {
    nickname,
    rego: clean(v.rego).toUpperCase(),
    make: clean(v.make), model: clean(v.model), year,
    regoExpiryDate: clean(v.regoExpiryDate),
    regoCost: regoCost || 0,
    regoFrequency: clean(v.regoFrequency) || 'annual',
    odometerReading: 0, odometerDate: '', odometerHistory: [],
    fuelPricePerLitre: 0,
    licenceHolder: '', licenceNumber: '', licenceExpiryDate: '',
    linkedInsurancePolicyId: null,
    notes: '',
  };
  return result(errors, record);
}

// A super fund is one record, plus an optional starting balance snapshot.
export function buildSuper(v, { now = new Date() } = {}) {
  const errors = [];
  const fundName = clean(v.fundName);
  if (!fundName) errors.push({ field: 'fundName', message: 'Enter the name of the fund.' });
  const member = clean(v.member);
  if (!member) errors.push({ field: 'member', message: 'Whose super is this? A first name is fine.' });
  const balance = v.balance === '' || v.balance == null ? 0 : num(v.balance);
  if (Number.isNaN(balance) || balance < 0) errors.push({ field: 'balance', message: 'Enter the balance as a number.' });
  const record = { member, fundName, memberNumber: clean(v.memberNumber), investmentOption: '', notes: '' };
  const balanceEntry = balance > 0 ? { date: today(now), balance, note: 'Starting balance (from setup guide)' } : null;
  return result(errors, record, { balanceEntry });
}

export const POLICY_TYPE_LABELS = { home_contents: 'Home & Contents', landlord: 'Landlord', car: 'Car', other: 'Other' };

export function buildInsurance(v, { vehicle = null } = {}) {
  const errors = [];
  const nickname = clean(v.nickname);
  if (!nickname) errors.push({ field: 'nickname', message: 'Give the policy a name, e.g. Home insurance.' });
  const policyType = POLICY_TYPE_LABELS[v.policyType] ? v.policyType : 'other';
  const premium = v.premiumAmount === '' || v.premiumAmount == null ? 0 : num(v.premiumAmount);
  if (Number.isNaN(premium) || premium < 0) errors.push({ field: 'premiumAmount', message: 'Enter the premium as a number.' });
  const record = {
    nickname, policyType,
    linkedPropertyId: (policyType === 'home_contents' || policyType === 'landlord') && clean(v.linkedPropertyId) ? clean(v.linkedPropertyId) : null,
    vehicleMake: policyType === 'car' && vehicle ? vehicle.make || '' : '',
    vehicleModel: policyType === 'car' && vehicle ? vehicle.model || '' : '',
    vehicleRego: policyType === 'car' && vehicle ? vehicle.rego || '' : '',
    provider: clean(v.provider), policyNumber: '', coverageType: '',
    excess: 0, sumInsuredBuilding: 0, sumInsuredOther: 0,
    premiumAmount: premium || 0,
    paymentFrequency: clean(v.paymentFrequency) === 'monthly' ? 'monthly' : 'annual',
    renewalDate: clean(v.renewalDate),
    linkedRecurringId: null,
    notes: '',
  };
  return result(errors, record);
}

// ---------------------------------------------------------------------------
// Budgets, bills, recurring, subscriptions, tenants
// ---------------------------------------------------------------------------
const FREQ = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'halfyearly', 'annually'];
const BUDGET_FREQ = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function buildBudget(v, { categories = [], existing = [], now = new Date() } = {}) {
  const errors = [];
  const categoryId = clean(v.categoryId);
  const cat = categories.find(c => c.id === categoryId);
  if (!categoryId || !cat) errors.push({ field: 'categoryId', message: 'Pick a category.' });
  const amount = num(v.amount);
  if (Number.isNaN(amount) || amount <= 0) errors.push({ field: 'amount', message: 'Enter the budget amount as a number above zero.' });
  const frequency = BUDGET_FREQ.includes(clean(v.frequency)) ? clean(v.frequency) : 'monthly';
  if (categoryId && existing.some(b => b.categoryId === categoryId && b.frequency === frequency)) {
    errors.push({ field: 'categoryId', message: 'You already have a budget for that category and frequency.' });
  }
  const stamp = now.toISOString();
  const record = { categoryId, amount, icon: cat?.icon || '\u{1F4B0}', frequency, createdAt: stamp, updatedAt: stamp };
  return result(errors, record);
}

export function buildBill(v, { accounts = [] } = {}) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Give the bill a name, e.g. Electricity.' });
  const amount = num(v.amount);
  if (Number.isNaN(amount) || amount <= 0) errors.push({ field: 'amount', message: 'Enter the amount as a number above zero.' });
  const dueDate = clean(v.dueDate);
  if (!iso(dueDate)) errors.push({ field: 'dueDate', message: 'Pick the next due date.' });
  const accountId = clean(v.accountId);
  if (!accountId || !accounts.some(a => a.id === accountId)) errors.push({ field: 'accountId', message: 'Choose the account it is paid from.' });
  const recurring = clean(v.recurring);
  if (recurring && !FREQ.includes(recurring)) errors.push({ field: 'recurring', message: 'Pick how often it repeats.' });
  const record = {
    name, amount, dueDate, accountId, categoryId: clean(v.categoryId), recurring,
    propertyId: '', vehicleId: '', destinationAccountId: '', paid: false,
  };
  return result(errors, record);
}

export function buildRecurring(v, { accounts = [], categories = [] } = {}) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Give it a name, e.g. Salary.' });
  const type = clean(v.type) === 'income' ? 'income' : 'expense';
  const amount = num(v.amount);
  if (Number.isNaN(amount) || amount <= 0) errors.push({ field: 'amount', message: 'Enter the amount as a number above zero.' });
  const frequency = FREQ.includes(clean(v.frequency)) ? clean(v.frequency) : 'monthly';
  const startDate = clean(v.startDate);
  if (!iso(startDate)) errors.push({ field: 'startDate', message: 'Pick the date of the next one.' });
  const accountId = clean(v.accountId);
  if (!accountId || !accounts.some(a => a.id === accountId)) errors.push({ field: 'accountId', message: 'Choose the account it goes through.' });
  const categoryId = clean(v.categoryId);
  if (!categoryId || !categories.some(c => c.id === categoryId)) errors.push({ field: 'categoryId', message: 'Pick a category.' });
  const record = { name, type, amount, frequency, startDate, catchUpFrom: '', accountId, categoryId, loanId: '', autoMinimum: false };
  return result(errors, record);
}

export function buildSubscription(v) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Give the subscription a name, e.g. Streaming.' });
  const amount = num(v.amount);
  if (Number.isNaN(amount) || amount < 0) errors.push({ field: 'amount', message: 'Enter the price as a number.' });
  const billingDay = num(v.billingDay);
  if (Number.isNaN(billingDay) || !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) errors.push({ field: 'billingDay', message: 'Enter the day of the month it is charged (1 to 31).' });
  const record = { name, category: clean(v.category), billingDay, amount, isActive: true };
  return result(errors, record);
}

export function buildTenant(v, { properties = [], now = new Date() } = {}) {
  const errors = [];
  const name = clean(v.name);
  if (!name) errors.push({ field: 'name', message: 'Enter the tenant\'s name.' });
  const propertyId = clean(v.propertyId);
  if (!propertyId || !properties.some(p => p.id === propertyId)) errors.push({ field: 'propertyId', message: 'Choose which property they rent.' });
  const rent = v.rentAmount === '' || v.rentAmount == null ? 0 : num(v.rentAmount);
  if (Number.isNaN(rent) || rent < 0) errors.push({ field: 'rentAmount', message: 'Enter the rent as a number.' });
  const leaseStart = clean(v.leaseStart) || today(now);
  if (!iso(leaseStart)) errors.push({ field: 'leaseStart', message: 'Pick the lease start date.' });
  const leaseEnd = clean(v.leaseEnd);
  if (leaseEnd && !iso(leaseEnd)) errors.push({ field: 'leaseEnd', message: 'Pick the lease end date, or leave it blank.' });
  const stamp = now.toISOString();
  const record = { name, phone: clean(v.phone), email: clean(v.email), propertyId, leaseStart, leaseEnd, rentAmount: rent || 0, status: 'active', createdAt: stamp, updatedAt: stamp };
  return result(errors, record);
}

// Escape closes the quick tour (it changes nothing), but never the setup guide, so a
// stray key can't drop what someone has typed.
export function escapeAction(key, state) {
  return key === 'Escape' && state?.tourOnly ? 'close' : null;
}
