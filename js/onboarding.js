// onboarding.js
//
// The optional first-run setup guide: one short step at a time, every step
// skippable, "Add another" on every list step. It appears only on a genuinely
// empty install (see shouldShowOnboarding) and can be run again from
// Settings. It saves through the same stores as the full pages, so anything it
// adds looks identical to anything added normally.

import { addItem, updateItem, deleteItem, getAllItems, STORE_NAMES } from './db.js';
import {
  getCurrencies, getBaseCurrency, setBaseCurrency, getRates, setRate, formatMoney, currencySymbol,
} from './utils/currency.js';
import * as S from './onboardingState.js';
import { getDisplayName, setDisplayName, MAX_NAME_LENGTH } from './userName.js';
import { tourGroups } from './tourContent.js';
import { queuePageCoach } from './pageCoach.js';
import { DEFAULT_CATEGORIES } from './defaultCategories.js';

const OVERLAY_ID = 'onboardingOverlay';
let state = null;
let overlay = null;
let lastFocus = null;
let busy = false;

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Short forms. `build` turns the answers into the same record the full page saves.
// ---------------------------------------------------------------------------
const money = (rec, key = 'currentBalance') => formatMoney(rec[key] ?? 0, rec.currency);

const FORMS = {
  accounts: {
    store: STORE_NAMES.accounts, icon: '🏦', noun: 'account',
    title: 'Add your accounts',
    intro: 'Start with the accounts you use every day: the bank account, a savings account, a credit card, or cash. Add as many as you like.',
    fields: ctx => [
      { name: 'name', label: 'Account name', type: 'text', required: true, placeholder: 'Everyday account' },
      { name: 'type', label: 'Type', type: 'select', options: [
        ['bank', '🏦 Bank account'], ['savings', '💰 Savings'], ['credit', '💳 Credit card'], ['cash', '💵 Cash'], ['investment', '📈 Investment'],
      ] },
      { name: 'currency', label: 'Currency', type: 'select', options: ctx.currencies.map(c => [c.code, `${c.code} · ${c.name}`]), value: ctx.base },
      { name: 'openingBalance', label: 'Balance today', type: 'money', placeholder: '0.00', help: values => values.type === 'credit' ? 'For a credit card, enter the amount you currently owe.' : '' },
      { name: 'creditLimit', label: 'Credit limit', type: 'money', placeholder: '0.00', showIf: v => v.type === 'credit' },
    ],
    build: (v, ctx) => S.buildAccount(v, { baseCurrency: ctx.base }),
    label: r => r.name,
    detail: r => `${r.type === 'credit' ? 'Credit card' : r.type} · ${formatMoney(r.openingBalance, r.currency)}`,
  },
  loans: {
    store: STORE_NAMES.loans, icon: '🏠', noun: 'loan',
    title: 'Add your loans',
    intro: 'A home loan, car loan or personal loan. An approximate figure is fine; you can refine it on the Loans page later.',
    fields: () => [
      { name: 'name', label: 'Loan name', type: 'text', required: true, placeholder: 'Home loan' },
      { name: 'type', label: 'Type', type: 'select', options: [
        ['mortgage', '🏠 Mortgage'], ['vehicle', '🚗 Vehicle'], ['personal', '👤 Personal'], ['education', '🎓 Education'], ['business', '💼 Business'], ['investment', '🏢 Investment'],
      ] },
      { name: 'currentBalance', label: 'Amount you still owe', type: 'money', required: true, placeholder: '0.00' },
      { name: 'interestRate', label: 'Interest rate (% a year)', type: 'money', required: true, placeholder: '6.2' },
      { name: 'termYears', label: 'Loan term (years)', type: 'money', required: true, placeholder: '25' },
      { name: 'startDate', label: 'Start date', type: 'date', help: 'Roughly when the loan began. Leave it for today if you are not sure.' },
      { name: 'originalAmount', label: 'Amount first borrowed (optional)', type: 'money', placeholder: 'Same as above' },
      { name: 'paymentFrequency', label: 'Repayments', type: 'select', options: [['monthly', 'Monthly'], ['fortnightly', 'Fortnightly'], ['weekly', 'Weekly']] },
    ],
    build: (v, ctx) => S.buildLoan(v, { baseCurrency: ctx.base }),
    label: r => r.name,
    detail: r => `${money(r)} owing · ${r.interestRate}%`,
  },
  properties: {
    store: STORE_NAMES.properties, icon: '🏡', noun: 'property',
    title: 'Add your properties',
    intro: 'Your home, or an investment property. Tenants, expenses and tax records can be added later on the Properties page.',
    fields: ctx => [
      { name: 'name', label: 'Property name', type: 'text', required: true, placeholder: 'Family home' },
      { name: 'propertyType', label: 'Type', type: 'select', options: [['primary', '🏠 Where I live'], ['investment', '💰 Investment property']] },
      { name: 'address', label: 'Address (optional)', type: 'text', placeholder: '12 Example St' },
      { name: 'currency', label: 'Currency', type: 'select', options: ctx.currencies.map(c => [c.code, c.code]), value: ctx.base },
      { name: 'purchasePrice', label: 'Purchase price', type: 'money', placeholder: '0.00' },
      { name: 'currentValue', label: 'Estimated value today', type: 'money', placeholder: 'Same as purchase price' },
      { name: 'rent', label: 'Rent per month', type: 'money', placeholder: '0.00', showIf: v => v.propertyType === 'investment' },
    ],
    build: (v, ctx) => S.buildProperty(v, { baseCurrency: ctx.base }),
    label: r => r.name,
    detail: r => `${r.propertyType === 'investment' ? 'Investment' : 'Home'} · ${formatMoney(r.currentValue, r.currency)}`,
  },
  vehicles: {
    store: STORE_NAMES.vehicles, icon: '🚗', noun: 'vehicle',
    title: 'Add your vehicles',
    intro: 'Add a car or ute to get a reminder before the registration runs out.',
    fields: () => [
      { name: 'nickname', label: 'Vehicle name', type: 'text', required: true, placeholder: 'Family car' },
      { name: 'rego', label: 'Registration plate', type: 'text', placeholder: 'ABC123' },
      { name: 'make', label: 'Make', type: 'text', placeholder: 'Toyota' },
      { name: 'model', label: 'Model', type: 'text', placeholder: 'Corolla' },
      { name: 'year', label: 'Year', type: 'money', placeholder: '2019' },
      { name: 'regoExpiryDate', label: 'Registration expires', type: 'date' },
      { name: 'regoCost', label: 'Registration cost', type: 'money', placeholder: '0.00' },
      { name: 'regoFrequency', label: 'Paid', type: 'select', options: [['annual', 'Annually'], ['six_monthly', 'Every 6 months']] },
    ],
    build: v => S.buildVehicle(v),
    label: r => r.nickname,
    detail: r => [r.rego, r.regoExpiryDate && `rego ${r.regoExpiryDate}`].filter(Boolean).join(' · ') || 'Vehicle',
  },
  super: {
    store: STORE_NAMES.superFunds, icon: '💰', noun: 'super fund',
    title: 'Add your super',
    intro: 'Add each fund you belong to. A starting balance lets the app start tracking growth straight away.',
    fields: () => [
      { name: 'fundName', label: 'Fund name', type: 'text', required: true, placeholder: 'AustralianSuper' },
      { name: 'member', label: 'Member', type: 'text', required: true, placeholder: 'Your first name' },
      { name: 'balance', label: 'Current balance', type: 'money', placeholder: '0.00' },
      { name: 'memberNumber', label: 'Member number (optional)', type: 'text' },
    ],
    build: v => S.buildSuper(v),
    label: r => r.fundName,
    detail: (r, entry) => `${r.member}${entry?.balance ? ' · ' + formatMoney(entry.balance) : ''}`,
  },
  insurance: {
    store: STORE_NAMES.insurancePolicies, icon: '🛡️', noun: 'policy',
    title: 'Add your insurance',
    intro: 'Home, landlord or car cover. Add the renewal date and we will remind you before it is due.',
    fields: ctx => [
      { name: 'nickname', label: 'Policy name', type: 'text', required: true, placeholder: 'Home insurance' },
      { name: 'policyType', label: 'Type', type: 'select', options: Object.entries(S.POLICY_TYPE_LABELS).map(([k, l]) => [k, l]) },
      { name: 'linkedPropertyId', label: 'Covers which property?', type: 'select', showIf: v => v.policyType === 'home_contents' || v.policyType === 'landlord',
        options: [['', 'Not linked'], ...ctx.properties.map(p => [p.id, p.name])] },
      { name: 'vehicleId', label: 'Covers which vehicle?', type: 'select', showIf: v => v.policyType === 'car',
        options: [['', 'Not linked'], ...ctx.vehicles.map(x => [x.id, x.nickname])] },
      { name: 'provider', label: 'Insurer', type: 'text', placeholder: 'NRMA' },
      { name: 'premiumAmount', label: 'Premium', type: 'money', placeholder: '0.00' },
      { name: 'paymentFrequency', label: 'Paid', type: 'select', options: [['annual', 'Annually'], ['monthly', 'Monthly']] },
      { name: 'renewalDate', label: 'Renews on', type: 'date' },
    ],
    build: (v, ctx) => S.buildInsurance(v, { vehicle: ctx.vehicles.find(x => x.id === v.vehicleId) || null }),
    label: r => r.nickname,
    detail: r => [S.POLICY_TYPE_LABELS[r.policyType], r.renewalDate && `renews ${r.renewalDate}`].filter(Boolean).join(' · '),
  },
  budgets: {
    store: STORE_NAMES.budgets, icon: '\u{1F3AF}', noun: 'budget',
    title: 'Set a few budgets',
    intro: 'Pick a category and how much you want to spend on it. A few key categories is plenty to start with.',
    fields: ctx => [
      { name: 'categoryId', label: 'Category', type: 'select', required: true, options: categoryOptions(ctx.categories, { type: 'expense' }) },
      { name: 'amount', label: 'Budget amount', type: 'money', required: true, placeholder: '500' },
      { name: 'frequency', label: 'How often', type: 'select', value: 'monthly', options: [['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']] },
    ],
    build: (v, ctx) => S.buildBudget(v, { categories: ctx.categories, existing: ctx.budgets }),
    label: r => catNames.get(r.categoryId) || 'Budget',
    detail: r => `${formatMoney(r.amount)} ${r.frequency}`,
  },
  bills: {
    store: STORE_NAMES.bills, icon: '\u{1F9FE}', noun: 'bill', requires: 'accounts',
    title: 'Add your regular bills',
    intro: 'Electricity, internet, rates, insurance: anything you pay on a due date. The app reminds you before each one.',
    fields: ctx => [
      { name: 'name', label: 'Bill name', type: 'text', required: true, placeholder: 'Electricity' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, placeholder: '0.00' },
      { name: 'dueDate', label: 'Next due date', type: 'date', required: true },
      { name: 'recurring', label: 'Repeats', type: 'select', options: [['', 'One-time'], ...FREQ_OPTS], value: 'monthly' },
      { name: 'accountId', label: 'Paid from', type: 'select', required: true, options: accountOptions(ctx) },
      { name: 'categoryId', label: 'Category (optional)', type: 'select', options: categoryOptions(ctx.categories, { type: 'expense', blank: 'Not sure yet' }) },
    ],
    build: (v, ctx) => S.buildBill(v, { accounts: ctx.accounts }),
    label: r => r.name,
    detail: r => `${formatMoney(r.amount)} \u00B7 ${r.recurring || 'one-time'} \u00B7 due ${r.dueDate}`,
  },
  recurring: {
    store: STORE_NAMES.recurringTransactions, icon: '\u{1F501}', noun: 'recurring item', requires: 'accounts',
    title: 'Add money that moves on a schedule',
    intro: 'Salary, rent, or a regular transfer. The app records each one for you on its date, so you do not have to.',
    fields: ctx => [
      { name: 'type', label: 'Type', type: 'select', options: [['expense', 'Expense (money out)'], ['income', 'Income (money in)']] },
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Salary' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, placeholder: '0.00' },
      { name: 'frequency', label: 'Repeats', type: 'select', value: 'monthly', options: FREQ_OPTS },
      { name: 'startDate', label: 'Date of the next one', type: 'date', required: true },
      { name: 'accountId', label: 'Account', type: 'select', required: true, options: accountOptions(ctx) },
      { name: 'categoryId', label: 'Category', type: 'select', required: true, options: categoryOptions(ctx.categories) },
    ],
    build: (v, ctx) => S.buildRecurring(v, { accounts: ctx.accounts, categories: ctx.categories }),
    label: r => r.name,
    detail: r => `${r.type === 'income' ? 'Income' : 'Expense'} \u00B7 ${formatMoney(r.amount)} \u00B7 ${r.frequency}`,
  },
  subscriptions: {
    store: STORE_NAMES.subscriptions, icon: '\u{1F502}', noun: 'subscription',
    title: 'Add your subscriptions',
    intro: 'Streaming, software, memberships. Seeing them together makes forgotten ones easy to spot.',
    fields: () => [
      { name: 'name', label: 'Subscription', type: 'text', required: true, placeholder: 'Streaming service' },
      { name: 'amount', label: 'Price each time', type: 'money', required: true, placeholder: '0.00' },
      { name: 'billingDay', label: 'Day of the month it is charged', type: 'money', required: true, placeholder: '15' },
      { name: 'category', label: 'Type (optional)', type: 'text', placeholder: 'Entertainment' },
    ],
    build: v => S.buildSubscription(v),
    label: r => r.name,
    detail: r => `${formatMoney(r.amount)} on day ${r.billingDay}`,
  },
  tenants: {
    store: STORE_NAMES.tenants, icon: '\u{1F464}', noun: 'tenant', requires: 'properties',
    title: 'Add your tenants',
    intro: 'Who rents which property, and for how much. Rent and lease dates then show up across the app.',
    fields: ctx => [
      { name: 'name', label: 'Tenant name', type: 'text', required: true, placeholder: 'Alex Example' },
      { name: 'propertyId', label: 'Property', type: 'select', required: true, options: [['', 'Choose a property'], ...ctx.properties.map(p => [p.id, p.name])] },
      { name: 'rentAmount', label: 'Rent per month', type: 'money', placeholder: '0.00' },
      { name: 'leaseStart', label: 'Lease starts', type: 'date', value: todayIso() },
      { name: 'leaseEnd', label: 'Lease ends (optional)', type: 'date' },
      { name: 'phone', label: 'Phone (optional)', type: 'text' },
      { name: 'email', label: 'Email (optional)', type: 'text' },
    ],
    build: (v, ctx) => S.buildTenant(v, { properties: ctx.properties }),
    label: r => r.name,
    detail: r => `${formatMoney(r.rentAmount || 0)} a month`,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let catNames = new Map();
async function loadCtx() {
  const [properties, vehicles, accounts, storedCats, budgets] = await Promise.all([
    getAllItems(STORE_NAMES.properties).catch(() => []),
    getAllItems(STORE_NAMES.vehicles).catch(() => []),
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.categories).catch(() => []),
    getAllItems(STORE_NAMES.budgets).catch(() => []),
  ]);
  const categories = storedCats.length ? storedCats : DEFAULT_CATEGORIES;
  catNames = new Map(categories.map(c => [c.id, c.name]));
  return { base: getBaseCurrency(), currencies: getCurrencies(), properties, vehicles, accounts, categories, budgets };
}

// "Groceries \u203A Supermarket" style labels, sorted so each parent sits with its children.
function categoryOptions(categories, { type, blank = 'Choose a category' } = {}) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const opts = categories.filter(c => !type || c.type === type).map(c => {
    const parent = c.parentId && byId.get(c.parentId);
    return [c.id, `${c.icon || ''} ${parent ? parent.name + ' \u203A ' : ''}${c.name}`.trim()];
  }).sort((a, b) => a[1].localeCompare(b[1]));
  return [['', blank], ...opts];
}
const accountOptions = ctx => [['', 'Choose an account'], ...ctx.accounts.map(a => [a.id, a.name])];
const FREQ_OPTS = [['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['halfyearly', 'Half-yearly'], ['annually', 'Annually']];
const todayIso = () => new Date().toISOString().slice(0, 10);

async function countExisting() {
  const stores = [
    STORE_NAMES.accounts, STORE_NAMES.transactions, STORE_NAMES.loans, STORE_NAMES.properties, STORE_NAMES.vehicles,
    STORE_NAMES.superFunds, STORE_NAMES.insurancePolicies, STORE_NAMES.budgets, STORE_NAMES.bills,
    STORE_NAMES.subscriptions, STORE_NAMES.recurringTransactions,
  ];
  let total = 0;
  for (const s of stores) total += (await getAllItems(s).catch(() => [])).length;
  return total;
}

// The standalone tour never touches the saved setup state.
function save() {
  if (state?.tourOnly) return;
  const { resume, ...persist } = state;     // 'resume' only means "show the welcome-back screen now"
  S.saveState(localStorage, persist);
}

async function stepList(st = state) {
  let allowed = true;
  try { allowed = !(await import('./licenceGate.js')).isViewLocked('properties'); } catch { /* licensing module unavailable: allow */ }
  return S.stepsFor({ propertiesAllowed: allowed, tourOnly: !!st?.tourOnly });
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function fieldHtml(f, values) {
  const id = `ob_${f.name}`;
  const v = values[f.name] ?? f.value ?? '';
  const req = f.required ? ' <span class="ob-req" aria-hidden="true">*</span>' : '';
  let control;
  if (f.type === 'select') {
    control = `<select id="${id}" name="${f.name}" class="form-select">${f.options.map(([val, lab]) =>
      `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  } else if (f.type === 'date') {
    control = `<input id="${id}" name="${f.name}" type="date" class="form-input" value="${esc(v)}">`;
  } else {
    const inputmode = f.type === 'money' ? ' inputmode="decimal"' : '';
    control = `<input id="${id}" name="${f.name}" type="text"${inputmode} autocomplete="off" class="form-input" placeholder="${esc(f.placeholder || '')}" value="${esc(v)}"${f.required ? ' required' : ''}>`;
  }
  const help = typeof f.help === 'function' ? f.help(values) : f.help;
  const hidden = f.showIf && !f.showIf(values) ? ' hidden' : '';
  return `<div class="ob-field" data-field="${f.name}"${hidden}>
    <label for="${id}">${esc(f.label)}${req}</label>${control}
    <div class="ob-help" data-help-for="${f.name}">${help ? esc(help) : ''}</div>
    <div class="ob-error" data-error-for="${f.name}" role="alert"></div>
  </div>`;
}

function addedListHtml(step) {
  const items = state.added.filter(a => a.step === step);
  if (!items.length) return '';
  const cfg = FORMS[step];
  return `<div class="ob-added" aria-live="polite"><div class="ob-added-title">Added so far</div>
    <ul>${items.map(a => `<li><span class="ob-added-icon" aria-hidden="true">${cfg.icon}</span>
      <span class="ob-added-text"><strong>${esc(a.label)}</strong><small>${esc(a.detail)}</small></span>
      <button type="button" class="ob-link" data-action="remove" data-id="${esc(a.id)}" aria-label="Remove ${esc(a.label)}">Remove</button></li>`).join('')}</ul></div>`;
}

let formOpen = {};   // step -> bool: is the "add" form showing (true until the first one is saved)

async function renderStep() {
  const steps = await stepList();
  if (!steps.includes(state.step)) state.step = steps[0];
  const idx = S.stepIndex(steps, state.step);
  const p = S.progress(steps, state.step);
  const step = state.step;
  let body = '';
  let primary = 'Continue';
  let primaryAction = 'next';
  let secondary = 'Skip this step';

  if (step === 'welcome' && state.resume) {
    const sts = S.stepStatuses(state, steps);
    const todo = sts.filter(x => x.status !== 'done');
    const resumeStep = state.lastStep && steps.includes(state.lastStep) && !['welcome', 'finish'].includes(state.lastStep) ? state.lastStep : (todo[0]?.step || 'finish');
    const nick = getDisplayName();
    body = `<h2 id="ob_title">Welcome back${nick ? ', ' + esc(nick) : ''}</h2>
      <p class="ob-lead">Everything you added is saved. Pick up where you left off, or jump to any step.</p>
      <ul class="ob-check">${sts.map(x => {
        const n = state.added.filter(a => a.step === x.step).length;
        const note = x.status === 'done' ? `${n} added` : (state.drafts?.[x.step] ? 'draft saved' : (x.status === 'skipped' ? 'skipped' : 'not started'));
        const mark = x.status === 'done' ? '\u2713' : (x.status === 'skipped' ? '\u23ED' : '\u25CB');
        return `<li><button type="button" class="ob-check-item is-${x.status}" data-action="goto" data-step="${x.step}"><span class="ob-check-mark" aria-hidden="true">${mark}</span><span class="ob-check-name">${esc(S.STEP_NAMES[x.step])}</span><small>${esc(note)}</small></button></li>`;
      }).join('')}</ul>
      <div class="ob-choices">
        <button type="button" class="ob-choice" data-action="goto" data-step="${resumeStep}"><strong>Continue where I left off</strong><small>${esc(S.STEP_NAMES[resumeStep] || 'Almost done')}</small></button>
        <button type="button" class="ob-choice" data-action="tour-first"><strong>Take a quick tour</strong><small>See what is on every page</small></button>
        <button type="button" class="ob-choice" data-action="start-over"><strong>Start the checklist over</strong><small>Things you already added stay in the app</small></button>
      </div>`;
    primary = null; secondary = null;
  } else if (step === 'welcome') {
    body = `<h2 id="ob_title">Welcome to Dashers Finance Manager</h2>
      <p class="ob-lead">Let's set up the basics, one short step at a time. Everything stays on this device.</p>
      <p>Every step is optional, and nothing here is permanent: you can edit or delete anything later. Your progress is saved as you go, so you can stop and pick it up again from the \u{1F9ED} Guide button.</p>
      <div class="ob-field ob-name"><label for="ob_nick">What should we call you? <span class="ob-opt">(optional)</span></label>
        <input id="ob_nick" class="form-input" type="text" maxlength="${MAX_NAME_LENGTH}" autocomplete="nickname" placeholder="e.g. Sam" value="${esc(getDisplayName())}">
        <div class="ob-help">Just for your greeting. It stays on this device.</div></div>
      <div class="ob-choices">
        <button type="button" class="ob-choice" data-action="next"><strong>Start setup</strong><small>A few short steps, skip any you like</small></button>
        <button type="button" class="ob-choice" data-action="tour-first"><strong>Take a quick tour first</strong><small>See what is on every page</small></button>
        ${state.forced ? '' : `<button type="button" class="ob-choice" data-action="demo"><strong>Try the demo data first</strong><small>See the app filled with a sample household</small></button>
        <button type="button" class="ob-choice" data-action="restore"><strong>Restore a backup</strong><small>I already have a backup file</small></button>
        <button type="button" class="ob-choice" data-action="family"><strong>I'm joining a Family Sync server</strong><small>My data will come from the family server</small></button>`}
      </div>`;
    primary = null; secondary = null;
  } else if (step === 'currency') {
    const base = getBaseCurrency();
    const rates = Object.entries(getRates());
    const others = getCurrencies().filter(c => c.code !== base);
    body = `<h2 id="ob_title">Your currency</h2>
      <p>Totals and reports use this currency.</p>
      <div class="ob-field"><label for="ob_base">Main currency</label>
        <select id="ob_base" class="form-select">${getCurrencies().map(c => `<option value="${c.code}"${c.code === base ? ' selected' : ''}>${c.code} · ${esc(c.name)}</option>`).join('')}</select></div>
      <div class="ob-sub"><strong>Do you have accounts in another currency?</strong>
        <p class="ob-help">Add the exchange rate so those accounts count correctly in your totals. You can change it any time in Settings.</p>
        ${rates.length ? `<ul class="ob-chips">${rates.map(([c, r]) => `<li><span>1 ${c} = ${r} ${base}</span><button type="button" class="ob-link" data-action="rate-remove" data-code="${c}" aria-label="Remove ${c}">Remove</button></li>`).join('')}</ul>` : ''}
        <div class="ob-row">
          <select id="ob_cur" class="form-select" aria-label="Other currency">${others.map(c => `<option value="${c.code}">${c.code}</option>`).join('')}</select>
          <span class="ob-eq">1 = </span>
          <input id="ob_rate" class="form-input" type="text" inputmode="decimal" placeholder="rate" aria-label="Exchange rate into ${base}">
          <span class="ob-eq">${base}</span>
          <button type="button" class="btn btn-secondary" data-action="rate-add">Add</button>
        </div>
        <div class="ob-error" id="ob_rate_err" role="alert"></div>
      </div>`;
    secondary = 'Skip this step';
  } else if (FORMS[step]) {
    const cfg = FORMS[step];
    const ctx = await loadCtx();
    const hasItems = state.added.some(a => a.step === step);
    if (formOpen[step] === undefined) formOpen[step] = !hasItems;
    const fields = cfg.fields(ctx);
    const values = {};
    fields.forEach(f => { if (f.value !== undefined) values[f.name] = f.value; if (f.type === 'select' && f.options[0] && values[f.name] === undefined) values[f.name] = f.options[0][0]; });
    Object.assign(values, state.drafts?.[step] || {});      // what was typed last time
    body = `<h2 id="ob_title">${cfg.icon} ${esc(cfg.title)}</h2><p>${esc(cfg.intro)}</p>${addedListHtml(step)}`;
    if (step === 'accounts' && ctx.accounts.length) {
      body += `<div class="ob-sub"><strong>\u{1F4C1} Already have statements?</strong>
        <p class="ob-help">Import a bank CSV, TXT or PDF statement now. You review everything before it is saved. The guide waits and a <em>Continue setup</em> button brings you back.</p>
        <button type="button" class="btn btn-secondary" data-action="import-tx">Import transactions</button></div>`;
    }
    const need = cfg.requires === 'accounts' && !ctx.accounts.length ? { step: 'accounts', what: 'an account', why: 'a bill or scheduled payment needs an account to come from' }
      : cfg.requires === 'properties' && !ctx.properties.length ? { step: 'properties', what: 'a property', why: 'a tenant rents a property' } : null;
    if (need) {
      body += `<div class="ob-sub"><strong>Add ${need.what} first</strong><p class="ob-help">${esc(need.why.charAt(0).toUpperCase() + need.why.slice(1))}. It only takes a moment.</p>
        <button type="button" class="btn btn-secondary" data-action="goto" data-step="${need.step}">Go to ${esc(S.STEP_NAMES[need.step])}</button></div>`;
      secondary = 'Skip this step'; primary = null;
    } else if (formOpen[step]) {
      body += `<form id="ob_form" novalidate>${fields.map(f => fieldHtml(f, values)).join('')}
        <div class="ob-form-actions"><button type="submit" class="btn btn-primary">Save ${esc(cfg.noun)}</button></div></form>`;
      secondary = hasItems ? 'Continue' : 'Skip this step';
      primary = null;
    } else {
      body += `<button type="button" class="ob-add-another" data-action="add-another">＋ Add another ${esc(cfg.noun)}</button>`;
      primary = 'Continue'; secondary = null;
    }
  } else if (step === 'tour') {
    let lockedFn = () => false, editionOf = () => '';
    try {
      const gate = await import('./licenceGate.js');
      const feat = await import('./features.js');
      const lic = await import('./licence.js');
      lockedFn = v => gate.isViewLocked(v);
      editionOf = v => lic.TIER_LABELS[feat.requiredTierForView(v)] || '';
    } catch { /* licensing unavailable: show everything as included */ }
    const groups = tourGroups({ isLocked: lockedFn, editionOf });
    const hadProgress = S.hasProgress(S.loadState(localStorage));
    const shortcut = state.tourOnly ? `<div class="ob-shortcut"><div><strong>Ready to set up your own details?</strong>
        <small>${hadProgress ? 'Pick up where you left off.' : 'A few short questions about accounts, bills, budgets and more.'} Skip anything you like. It remembers where you stopped.</small></div>
        <button type="button" class="btn btn-primary" data-action="start-setup">${hadProgress ? 'Continue guided setup' : 'Start guided setup'}</button></div>` : '';
    body = `${shortcut}<h2 id="ob_title">${state.tourOnly ? '\u{1F9ED} Tour of the app' : 'What else is in the app'}</h2>
      <p class="ob-lead">Everything lives in the menu, grouped like this. Tap any page to open it.</p>
      <div class="ob-tour">${groups.map(g => `<section class="ob-tour-group"><h3>${esc(g.name)}</h3><ul>${g.items.map(i => `
        <li><button type="button" class="ob-tour-item${i.locked ? ' is-locked' : ''}" data-action="open-view" data-view="${esc(i.view)}">
          <span class="ob-tour-ic" aria-hidden="true">${i.icon}</span>
          <span class="ob-tour-tx"><strong>${esc(i.label)}${i.locked ? ` <span class="ob-tour-lock">\u{1F512} ${esc(i.edition)}</span>` : ''}</strong><small>${esc(i.blurb)}</small></span>
        </button></li>`).join('')}</ul></section>`).join('')}</div>`;
    if (state.tourOnly) { primary = 'Done'; primaryAction = 'finish-tour'; secondary = null; }
    else { primary = 'Continue'; secondary = null; }
  } else if (step === 'finish') {
    const counts = {};
    state.added.forEach(a => { counts[a.step] = (counts[a.step] || 0) + 1; });
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${FORMS[k].noun}${n === 1 ? '' : 's'}`);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    body = `<h2 id="ob_title">You're all set${getDisplayName() ? ', ' + esc(getDisplayName()) : ''}</h2>
      <p class="ob-lead">${parts.length ? `You added ${esc(parts.join(', '))}.` : 'You can add everything later from the menu.'}</p>
      <div class="ob-sub"><strong>Make a first backup</strong>
        <p class="ob-help">Your data lives only in this browser. A backup file is your safety net if you ever clear it or change phones.</p>
        <button type="button" class="btn btn-secondary" data-action="backup">Download a backup</button></div>
      ${isStandalone() ? '' : `<div class="ob-sub"><strong>Put it on your home screen</strong>
        <p class="ob-help">${ios ? 'In Safari, tap the Share button, then Add to Home Screen.' : 'In your browser menu, choose Install app or Add to Home screen.'} It then opens like any other app, even offline.</p></div>`}`;
    primary = 'Open my dashboard'; primaryAction = 'finish'; secondary = null;
  }

  const back = idx > 0 && step !== 'finish' && !state.tourOnly ? `<button type="button" class="ob-link" data-action="back">Back</button>` : '<span></span>';
  const skipSetup = step !== 'finish' && !state.tourOnly ? `<button type="button" class="ob-link ob-skip-all" data-action="dismiss">Skip setup</button>` : '';
  overlay.innerHTML = `<div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob_title">
    <div class="ob-top"><div class="ob-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}"><span style="width:${p.percent}%"></span></div>
      <div class="ob-stepcount">${state.tourOnly ? 'Tour' : (state.resume ? 'Your progress is saved' : `Step ${p.index + 1} of ${p.total}`)}</div></div>
    <div class="ob-body">${body}</div>
    <div class="ob-actions">
      ${back}
      <div class="ob-actions-right">
        ${secondary ? `<button type="button" class="btn btn-secondary" data-action="next">${esc(secondary)}</button>` : ''}
        ${primary ? `<button type="button" class="btn btn-primary" data-action="${primaryAction}">${esc(primary)}</button>` : ''}
      </div>
    </div>
    <div class="ob-foot">${skipSetup}</div>
  </div>`;
  wireForm();
  overlay.querySelector('.ob-body').scrollTop = 0;
  const first = overlay.querySelector('#ob_form input, #ob_form select, .ob-choice, #ob_base, .btn-primary') || overlay.querySelector('button');
  first?.focus({ preventScroll: true });
}

// show/hide conditional fields and live help text as the answers change
function readValues(form) {
  const v = {};
  new FormData(form).forEach((val, k) => { v[k] = val; });
  return v;
}

async function wireForm() {
  const form = overlay.querySelector('#ob_form');
  if (!form) return;
  const cfg = FORMS[state.step];
  const ctx = await loadCtx();
  const fields = cfg.fields(ctx);
  const refresh = (persist) => {
    const values = readValues(form);
    if (persist) {   // keep what was typed so closing the guide never loses it
      const typed = fields.some(f => f.type !== 'select' && String(values[f.name] ?? '').trim() !== '' && String(values[f.name]) !== String(f.value ?? ''));
      if (typed) S.setDraft(state, state.step, values); else S.clearDraft(state, state.step);
      save();
    }
    fields.forEach(f => {
      const wrap = form.querySelector(`[data-field="${f.name}"]`);
      if (f.showIf && wrap) wrap.hidden = !f.showIf(values);
      const help = form.querySelector(`[data-help-for="${f.name}"]`);
      if (help && typeof f.help === 'function') help.textContent = f.help(values);
    });
  };
  form.addEventListener('input', () => refresh(true));
  form.addEventListener('change', () => refresh(true));
  refresh(false);
  form.addEventListener('submit', async (e) => { e.preventDefault(); await submitForm(form, cfg, ctx); });
}

function showErrors(form, errors) {
  form.querySelectorAll('[data-error-for]').forEach(el => { el.textContent = ''; });
  errors.forEach(e => { const el = form.querySelector(`[data-error-for="${e.field}"]`); if (el) el.textContent = e.message; });
  const first = form.querySelector(`#ob_${errors[0]?.field}`);
  first?.focus();
}

async function submitForm(form, cfg, ctx) {
  if (busy) return;
  const values = readValues(form);
  const res = cfg.build(values, ctx);
  if (!res.ok) { showErrors(form, res.errors); return; }
  busy = true;
  try {
    const saved = await addItem(cfg.store, { ...res.record });
    const extras = [];
    if (state.step === 'super' && res.balanceEntry) {
      const h = await addItem(STORE_NAMES.superBalanceHistory, { fundId: saved.id, ...res.balanceEntry });
      extras.push({ store: STORE_NAMES.superBalanceHistory, id: h.id });
    }
    if (state.step === 'insurance' && values.policyType === 'car' && values.vehicleId) {
      const vehicle = ctx.vehicles.find(x => x.id === values.vehicleId);
      if (vehicle) {
        await updateItem(STORE_NAMES.vehicles, { ...vehicle, linkedInsurancePolicyId: saved.id });
        extras.push({ store: STORE_NAMES.vehicles, unlink: vehicle.id });
      }
    }
    state.added.push({ step: state.step, store: cfg.store, id: saved.id, label: cfg.label(saved), detail: cfg.detail(saved, res.balanceEntry), extras });
    S.clearDraft(state, state.step);
    S.unmarkSkipped(state, state.step);
    formOpen[state.step] = false;
    save();
  } catch (err) {
    console.error('[onboarding] could not save', err);
    showErrors(form, [{ field: Object.keys(readValues(form))[0], message: 'Sorry, that could not be saved. Please try again.' }]);
  } finally {
    busy = false;
  }
  await renderStep();
}

async function removeAdded(id) {
  const entry = state.added.find(a => a.id === id);
  if (!entry) return;
  try {
    for (const x of entry.extras || []) {
      if (x.unlink) {
        const vehicle = (await getAllItems(STORE_NAMES.vehicles)).find(v => v.id === x.unlink);
        if (vehicle) await updateItem(STORE_NAMES.vehicles, { ...vehicle, linkedInsurancePolicyId: null });
      } else {
        await deleteItem(x.store, x.id);
      }
    }
    await deleteItem(entry.store, entry.id);
  } catch (err) { console.warn('[onboarding] remove failed', err); }
  state.added = state.added.filter(a => a.id !== id);
  if (!state.added.some(a => a.step === entry.step)) formOpen[entry.step] = true;
  save();
  await renderStep();
}

// ---------------------------------------------------------------------------
// Navigation and actions
// ---------------------------------------------------------------------------
async function go(dir) {
  const steps = await stepList();
  if (dir === 'next' && FORMS[state.step] && !state.added.some(a => a.step === state.step)) S.markSkipped(state, state.step);
  state.step = dir === 'next' ? S.nextStep(steps, state.step) : S.prevStep(steps, state.step);
  state.lastStep = state.step;
  save();
  await renderStep();
}

// Hides the guide (keeping its state) while one of the app's own dialogs is open:
// the restore preview uses the app's modal layer, which sits under the guide.
async function withOverlayHidden(fn) {
  const el = overlay;
  if (el) el.style.visibility = 'hidden';
  try { return await fn(); }
  finally { if (el && overlay === el) el.style.visibility = ''; }
}

// Restore a backup without leaving the guide: cancelling the file picker or the
// restore preview simply returns to the welcome screen.
function restoreFromGuide() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.addEventListener('change', async (e) => {
    try {
      const { importData } = await import('./settings.js');
      const restored = await withOverlayHidden(() => importData(e));
      if (restored) close('done', 'finance-overview');
    } catch (err) {
      console.warn('[onboarding] restore failed', err);
      notice('That backup could not be restored. Nothing was changed.');
    } finally {
      input.remove();
    }
  });
  document.body.appendChild(input);
  input.click();
}

// Importing statements happens on the Transactions page, so the guide steps
// aside, opens the importer, and leaves a "Continue setup" button that brings
// the guide back to the Accounts step. Everything already added is kept.
async function importHandoff() {
  state.lastStep = 'accounts';
  close('dismissed');
  document.getElementById('setupNudge')?.remove();
  showImportPill();
  if (window.location.hash.replace('#', '') !== 'transactions') window.location.hash = 'transactions';
  else { const { loadView } = await import('./ui.js'); await loadView('transactions'); }
  // The Transactions page swaps its Import button for a fresh copy about 200ms
  // after drawing it, so wait for that before clicking.
  for (let i = 0; i < 40; i++) {
    if (document.getElementById('btnImportTx')) {
      await new Promise(r => setTimeout(r, 700));
      document.getElementById('btnImportTx')?.click();
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

function showImportPill() {
  document.getElementById('obImportPill')?.remove();
  const pill = document.createElement('div');
  pill.id = 'obImportPill';
  pill.className = 'ob-pill';
  pill.innerHTML = `<button type="button" class="ob-pill-main">Continue setup \u2192</button>
    <button type="button" class="ob-pill-x" aria-label="Dismiss">\u00D7</button>`;
  pill.querySelector('.ob-pill-main').addEventListener('click', () => { pill.remove(); startOnboarding({ resumeAt: 'accounts' }); });
  pill.querySelector('.ob-pill-x').addEventListener('click', () => pill.remove());
  document.body.appendChild(pill);
}

function close(status, hash) {
  if (status === 'in_progress_closed') status = 'dismissed';   // left the guide to look at a page
  state.status = status;
  save();
  overlay?.remove();
  overlay = null;
  document.documentElement.classList.remove('ob-open');
  document.removeEventListener('keydown', onKey, true);
  if (hash) window.location.hash = hash;
  try { lastFocus?.focus?.(); } catch { /* ignore */ }
  if (status === 'dismissed') setupNudge();
}

async function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || busy) return;
  const action = btn.dataset.action;
  if (state.step === 'welcome') saveNickname();
  switch (action) {
    case 'next': return go('next');
    case 'back': return go('back');
    case 'add-another': formOpen[state.step] = true; return renderStep();
    case 'remove': return removeAdded(btn.dataset.id);
    case 'dismiss': close('dismissed'); notice('Setup skipped. Reopen it any time from \u{1F9ED} Guide in the menu, or Settings.'); return;
    case 'finish-tour': return close('done');
    case 'goto': state.resume = false; state.step = btn.dataset.step || 'welcome'; state.lastStep = state.step; save(); return renderStep();
    case 'start-over': state.added = []; state.skipped = []; state.drafts = {}; state.lastStep = 'welcome'; state.resume = false; state.step = 'welcome'; formOpen = {}; save(); return renderStep();
    case 'tour-first': close('in_progress'); await startOnboarding({ tourOnly: true }); return;
    case 'start-setup': close('done'); await startOnboarding(); return;
    case 'open-view': {
      const v = btn.dataset.view;
      const locked = btn.classList.contains('is-locked');
      close(state.tourOnly ? 'done' : 'in_progress_closed');
      if (v) {
        // Open the page, then show a short insight about it with a "Got it" box that
        // moves around its main items. A page outside the edition just shows its upgrade screen.
        if (!locked) queuePageCoach(v, { onBackToTour: () => startOnboarding({ tourOnly: true }) });
        window.location.hash = v;
      }
      return;
    }
    case 'finish': return close('done', 'finance-overview');
    case 'family': close('dismissed', 'settings'); return;
    case 'demo': {
      busy = true;
      try {
        const { loadDemoData } = await import('./settings.js');
        const ok = await loadDemoData({ skipConfirm: true });
        if (ok !== false) { busy = false; close('done', 'financial-dashboard'); window.location.reload(); return; }
      } finally { busy = false; }
      return;
    }
    case 'restore': return restoreFromGuide();
    case 'import-tx': return importHandoff();
    case 'backup': { document.getElementById('btnExport')?.click(); return; }
    case 'rate-add': return addRate();
    case 'rate-remove': await setRate(btn.dataset.code, 0); return renderStep();
    default:
  }
}

function saveNickname() {
  const input = overlay?.querySelector('#ob_nick');
  if (input) setDisplayName(input.value);
}

async function addRate() {
  const code = overlay.querySelector('#ob_cur')?.value;
  const rate = S.num(overlay.querySelector('#ob_rate')?.value);
  const err = overlay.querySelector('#ob_rate_err');
  if (!code || !(rate > 0)) { err.textContent = 'Enter the exchange rate as a number above zero.'; return; }
  await setRate(code, rate);
  await renderStep();
}

function onChange(e) {
  if (e.target.id === 'ob_base') {
    setBaseCurrency(e.target.value).then(renderStep);
  }
}

function onKey(e) {
  if (!overlay) return;
  // The quick tour changes nothing, so Escape just closes it. (In the setup guide Escape does nothing, so a stray key never drops your answers.)
  if (S.escapeAction(e.key, state) === 'close') { e.preventDefault(); close('done'); return; }
  if (e.key === 'Tab') {                       // keep keyboard focus inside the guide
    const items = [...overlay.querySelectorAll('button, input, select, a[href]')].filter(el => !el.disabled && !el.closest('[hidden]') && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function openGuide() {
  if (overlay) return;
  lastFocus = document.activeElement;
  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'ob-overlay';
  document.body.appendChild(overlay);
  document.documentElement.classList.add('ob-open');
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('change', onChange);
  overlay.addEventListener('keydown', (e) => {          // Enter in the name box = Start setup
    if (e.key === 'Enter' && e.target.id === 'ob_nick') { e.preventDefault(); overlay.querySelector('[data-action="next"]')?.click(); }
  });
  document.addEventListener('keydown', onKey, true);
  formOpen = {};
  await renderStep();
}

// Called once at startup. Shows the guide only on a brand-new, empty install.
export async function initOnboarding() {
  try {
    await waitForSplash();
    const stored = S.loadState(localStorage);
    const existingCount = Math.max(0, (await countExisting()) - (stored?.added.length || 0));
    let connectedToFamily = false;
    try { connectedToFamily = await (await import('./familySync.js')).isConnected(); } catch { /* not connected */ }
    if (!S.shouldShowOnboarding({ state: stored, existingCount, connectedToFamily })) {
      if (!stored && existingCount > 0) S.saveState(localStorage, { ...S.freshState(), status: 'done' });   // upgraders: never ask
      setupNudge();
      return;
    }
    state = stored || S.freshState();
    if (S.hasProgress(stored)) { state.resume = true; state.step = 'welcome'; }
    await openGuide();
  } catch (err) {
    console.warn('[onboarding] skipped', err);
  }
}

// Called from Settings → "Run setup guide". Works on an app that already has data.
// Pass { tourOnly: true } for the quick tour of every page, with no setup questions.
export async function startOnboarding({ tourOnly = false, resumeAt = null } = {}) {
  if (overlay) return;
  if (tourOnly) {
    state = { ...S.freshState(), forced: true, tourOnly: true, step: 'tour' };
  } else {
    const saved = S.loadState(localStorage);          // keep what was filled in last time
    state = { ...S.freshState(), ...(saved || {}), forced: true, tourOnly: false, status: 'in_progress', step: 'welcome' };
    if (S.hasProgress(saved)) state.resume = true;
    if (resumeAt) { state.step = resumeAt; state.lastStep = resumeAt; state.resume = false; }   // e.g. back from the importer
  }
  formOpen = {};
  save();
  await openGuide();
}

// A small message that fades by itself (the guide has no access to the page toasts).
function notice(text) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.className = 'ob-notice';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('is-leaving'), 6000);
  setTimeout(() => el.remove(), 6600);
}

function waitForSplash() {
  return new Promise(resolve => {
    const t0 = Date.now();
    const tick = () => {
      const splash = document.getElementById('splashScreen');
      if (!splash || splash.classList.contains('hidden') || Date.now() - t0 > 5000) resolve();
      else setTimeout(tick, 150);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// "Finish setting up" reminder
// ---------------------------------------------------------------------------
// After someone skips or closes the guide part-way, a small pill on the home
// page says how many steps are left. It never blocks anything, and the x
// switches it off for good.
let nudgeWired = false;
export function setupNudge() {
  if (!nudgeWired) { nudgeWired = true; window.addEventListener('hashchange', () => { setupNudge(); }); }
  document.getElementById('setupNudge')?.remove();
  if (overlay) return;
  const saved = S.loadState(localStorage);
  if (!saved || saved.nudgeOff || saved.status !== 'dismissed') return;
  const onHome = (window.location.hash.slice(1) || 'finance-overview') === 'finance-overview';
  if (!onHome) return;
  stepList(saved).then(steps => {
    const left = S.remainingSteps(saved, steps);
    if (!left.length || document.getElementById('setupNudge') || overlay) return;
    const bar = document.createElement('div');
    bar.id = 'setupNudge';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>Finish setting up: <strong>${left.length}</strong> step${left.length === 1 ? '' : 's'} left</span>
      <button type="button" class="nudge-go">Continue</button><button type="button" class="nudge-x" aria-label="Don't remind me again">\u00D7</button>`;
    bar.querySelector('.nudge-go').addEventListener('click', () => { bar.remove(); startOnboarding(); });
    bar.querySelector('.nudge-x').addEventListener('click', () => {
      const cur = S.loadState(localStorage); if (cur) S.saveState(localStorage, { ...cur, nudgeOff: true });
      bar.remove();
    });
    document.body.appendChild(bar);
  }).catch(() => {});
}
