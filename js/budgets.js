import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId } from './db.js';
import { escapeHtml } from './sanitize.js';

import { currencySymbol, formatMoney, toBaseTransactions } from './utils/currency.js';
// --- STARTER BUDGET TEMPLATE ---
// Creates budgets at the SUBCATEGORY level (e.g. Electricity, Gas, Water)
// rather than one budget per top-level category. Thanks to the
// parent/child rollup fix, each top-level category's total (e.g.
// "Utilities") is automatically the sum of its budgeted subcategories —
// you don't budget the parent directly, you budget its children and the
// parent total comes along for free. The Budgets page groups these under
// their parent category header so you can see both levels at once.
//
// Curated to 2-3 of the most commonly-relevant subcategories per category
// rather than mechanically taking "the first N in the list", since a
// couple of categories have subcategories that don't make sense together
// as starter defaults (e.g. Housing has both "Home Mortgage" and "Rent
// Payment" — most people only need one). Categories with fewer than 3
// meaningful subcategories (or none suited to budgeting, like Transfers,
// Tax, Cash) just get however many make sense, including zero.
const SUBCATEGORY_BUDGET_TEMPLATE = {
  cat_income: [['sub_salary', 4500], ['sub_spouse_salary', 1500], ['sub_business_income', 500]],
  cat_housing: [['sub_mortgage_home', 1800], ['sub_council_rates', 100], ['sub_home_repairs', 100]],
  cat_utilities: [['sub_electricity', 150], ['sub_gas', 80], ['sub_water_usage', 60]],
  cat_groceries: [['sub_supermarket', 600], ['sub_fresh_produce', 100], ['sub_meat_seafood', 100]],
  cat_dining: [['sub_restaurants', 100], ['sub_fast_food', 80], ['sub_cafes_coffee', 60]],
  cat_transport: [['sub_fuel', 200], ['sub_car_service', 80], ['sub_tolls_parking', 40]],
  cat_health: [['sub_gp', 50], ['sub_pharmacy', 40], ['sub_health_insurance', 150]],
  cat_insurance: [['sub_home_ins', 80], ['sub_life_ins', 60], ['sub_landlord_ins', 40]],
  cat_education: [['sub_school_fees', 250], ['sub_childcare', 300], ['sub_books_courses', 30]],
  cat_personal: [['sub_clothing', 100], ['sub_grooming', 60], ['sub_fitness', 50]],
  cat_entertainment: [['sub_streaming', 40], ['sub_software_cloud', 30], ['sub_gaming', 20]],
  cat_shopping: [['sub_general_retail', 100], ['sub_electronics', 50], ['sub_online_shopping', 50]],
  cat_travel: [['sub_flights', 100], ['sub_accommodation', 100], ['sub_travel_food', 50]],
  cat_kids: [['sub_kids_activities', 80], ['sub_kids_clothing', 40], ['sub_kids_toys', 30]],
  cat_pets: [['sub_pet_food', 40], ['sub_vet', 30], ['sub_pet_supplies', 20]],
  cat_fees: [['sub_bank_fees', 20], ['sub_interest_charged', 20], ['sub_card_fees', 10]],
  cat_savings: [['sub_high_interest_savings', 300], ['sub_shares_etf', 150], ['sub_super_contributions', 50]],
  cat_debt: [['sub_credit_card_payment', 200], ['sub_car_loan', 200], ['sub_personal_loan', 100]],
  cat_investment_property: [['sub_inv_mortgage', 800], ['sub_property_management', 80], ['sub_inv_council_rates', 60]],
  cat_business: [['sub_business_supplies', 100], ['sub_business_software', 50], ['sub_business_services', 100]],
  cat_gifts_donations: [['sub_charities', 30], ['sub_gifts_given', 30]],
  cat_misc: [['sub_misc_items', 50]],
  // Deliberately no entries for cat_transfers, cat_tax, cat_cash — moving
  // your own money or paying tax isn't really something to "budget"
  // against the way a spending category is.
};

// Creates one budget per curated subcategory (see above) that doesn't
// already have one. Returns how many were created so the caller can tell
// the person what happened.
export async function loadStarterBudgetTemplate(categories) {
  const existingBudgets = await getAllItems(STORE_NAMES.budgets);
  const existingCategoryIds = new Set(existingBudgets.map(b => b.categoryId));
  const categoryById = new Map(categories.map(c => [c.id, c]));

  let created = 0;

  for (const [, subEntries] of Object.entries(SUBCATEGORY_BUDGET_TEMPLATE)) {
    for (const [subId, amount] of subEntries) {
      if (existingCategoryIds.has(subId)) continue; // don't duplicate
      const subCat = categoryById.get(subId);
      if (!subCat) continue; // category was renamed/removed — skip safely

      await addItem(STORE_NAMES.budgets, {
        id: generateId(),
        categoryId: subId,
        amount,
        icon: subCat.icon || '💰',
        frequency: 'monthly',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      created++;
    }
  }

  return created;
}

// --- NAMED BUDGET TEMPLATES ---
// Unlike the single hardcoded starter template above, these are user-saved
// snapshots of a whole budget set (e.g. "Frugal Month", "Holiday Season")
// that can be saved, listed, loaded, renamed and deleted. Loading one
// REPLACES the current budgets outright — that's the point of a named
// template you swap in and out, as opposed to the starter template above,
// which only ever fills gaps and never touches existing budgets.
export async function getAllBudgetTemplates() {
  const templates = await getAllItems(STORE_NAMES.budgetTemplates);
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

// Snapshots every current budget line (category/amount/frequency/icon —
// not id/createdAt, since those are re-generated on load) under `name`.
// If a template with the same name (case-insensitive) already exists, its
// contents are overwritten rather than creating a duplicate.
export async function saveBudgetsAsTemplate(name, budgets) {
  const items = budgets.map(b => ({
    categoryId: b.categoryId,
    amount: b.amount,
    frequency: b.frequency,
    icon: b.icon || '💰'
  }));

  const existing = (await getAllBudgetTemplates())
    .find(t => t.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    await updateItem(STORE_NAMES.budgetTemplates, {
      ...existing,
      items,
      updatedAt: new Date().toISOString()
    });
    return { overwritten: true, count: items.length };
  }

  await addItem(STORE_NAMES.budgetTemplates, {
    id: generateId(),
    name,
    items,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return { overwritten: false, count: items.length };
}

export async function renameBudgetTemplate(templateId, newName) {
  const template = (await getAllBudgetTemplates()).find(t => t.id === templateId);
  if (!template) return;
  await updateItem(STORE_NAMES.budgetTemplates, {
    ...template,
    name: newName,
    updatedAt: new Date().toISOString()
  });
}

export async function deleteBudgetTemplate(templateId) {
  await deleteItem(STORE_NAMES.budgetTemplates, templateId);
}

// Applies a template's saved lines to the live budgets. `mode` decides how:
//   'replace' (default) - deletes every current budget first, then loads the
//                         template's lines.
//   'add'               - keeps every current budget untouched and only adds
//                         template lines for categories that don't already
//                         have a budget (existing amounts always win).
// Categories that were renamed/removed since the template was saved are
// skipped (reported back so the caller can tell the person). Returns null if
// the template can't be found (e.g. deleted from another synced device).
export async function loadBudgetTemplate(templateId, categories, mode = 'replace') {
  const template = (await getAllBudgetTemplates()).find(t => t.id === templateId);
  if (!template) return null;

  const categoryIds = new Set(categories.map(c => c.id));
  const categoryById = new Map(categories.map(c => [c.id, c]));

  const currentBudgets = await getAllItems(STORE_NAMES.budgets);
  let replaced = 0;
  const alreadyBudgeted = new Set();

  if (mode === 'replace') {
    for (const b of currentBudgets) {
      await deleteItem(STORE_NAMES.budgets, b.id);
    }
    replaced = currentBudgets.length;
  } else {
    currentBudgets.forEach(b => alreadyBudgeted.add(b.categoryId));
  }

  let loaded = 0;
  let skipped = 0;          // category no longer exists
  let keptExisting = 0;     // 'add' mode: category already had a budget
  for (const item of template.items) {
    if (!categoryIds.has(item.categoryId)) { skipped++; continue; }
    if (alreadyBudgeted.has(item.categoryId)) { keptExisting++; continue; }
    const cat = categoryById.get(item.categoryId);
    await addItem(STORE_NAMES.budgets, {
      id: generateId(),
      categoryId: item.categoryId,
      amount: item.amount,
      icon: item.icon || cat?.icon || '💰',
      frequency: item.frequency || 'monthly',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    alreadyBudgeted.add(item.categoryId);
    loaded++;
  }

  return { name: template.name, mode, loaded, skipped, keptExisting, replaced };
}

// Removes every live budget (templates are never touched). Returns how many
// were removed.
export async function deleteAllBudgets() {
  const currentBudgets = await getAllItems(STORE_NAMES.budgets);
  for (const b of currentBudgets) {
    await deleteItem(STORE_NAMES.budgets, b.id);
  }
  return currentBudgets.length;
}

// --- CONFIRMATION DIALOGS ---
// A small promise-based modal (window.confirm can only offer OK/Cancel, but
// loading a template needs three choices: add / replace / cancel).
// Resolves to { action, text } for the clicked button (text = the optional
// input's value), or null if dismissed via Escape / clicking the backdrop.
function showBudgetDialog({ title, message, buttons, input = null, error = '' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'bt-dialog-overlay';
    overlay.innerHTML = `
      <div class="bt-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h3>${escapeHtml(title)}</h3>
        <p class="bt-dialog-message">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
        ${input ? `
          <label class="form-label" for="btDialogInput">${escapeHtml(input.label)}</label>
          <input id="btDialogInput" class="form-input" type="text" maxlength="80"
                 value="${escapeHtml(input.value || '')}" autocomplete="off">` : ''}
        ${error ? `<p class="bt-dialog-error">${escapeHtml(error)}</p>` : ''}
        <div class="bt-dialog-actions">
          ${buttons.map((b, i) =>
            `<button type="button" data-i="${i}" class="${b.variant === 'primary' ? 'btn-primary' : b.variant === 'danger' ? 'btn-danger' : 'btn-secondary'}">${escapeHtml(b.label)}</button>`
          ).join('')}
        </div>
      </div>`;

    const inputEl = overlay.querySelector('#btDialogInput');
    const finish = result => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) return finish(null);
      const btn = e.target.closest('button[data-i]');
      if (btn) finish({ action: buttons[Number(btn.dataset.i)].value, text: inputEl ? inputEl.value : '' });
    });

    document.body.appendChild(overlay);
    if (inputEl) { inputEl.focus(); inputEl.select(); }
    else overlay.querySelector('button')?.focus();
  });
}

// "Save your current budgets as a template first?" step, shared by
// Replace-on-load and Remove All. Resolves to:
//   'saved'     - saved as a template; safe to continue
//   'skipped'   - person chose to continue without saving
//   'cancelled' - person backed out; caller must do nothing
// `blockedNames` are template names the save may not use (e.g. the template
// that is about to be loaded, which would otherwise be overwritten by the
// very budgets it's about to replace).
async function offerSaveCurrentBudgets(budgets, { title, message, saveLabel, skipLabel, blockedNames = [] }) {
  if (budgets.length === 0) return 'skipped';

  const blocked = new Set(blockedNames.map(n => n.toLowerCase()));
  let name = `Previous budgets — ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  let error = '';

  while (true) {
    const res = await showBudgetDialog({
      title,
      message,
      input: { label: 'Template name', value: name },
      error,
      buttons: [
        { label: saveLabel, value: 'save', variant: 'primary' },
        { label: skipLabel, value: 'skip', variant: 'danger' },
        { label: 'Cancel', value: 'cancel' }
      ]
    });
    if (!res || res.action === 'cancel') return 'cancelled';
    if (res.action === 'skip') return 'skipped';

    name = res.text.trim();
    error = '';
    if (!name) { error = 'Please enter a name for the template.'; continue; }
    if (blocked.has(name.toLowerCase())) {
      error = `"${name}" is the template you're loading — pick a different name so it isn't overwritten.`;
      continue;
    }

    const existing = (await getAllBudgetTemplates()).find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const ow = await showBudgetDialog({
        title: 'Template name already in use',
        message: `A template called "${existing.name}" already exists. Overwrite it with your current ${budgets.length} budget(s)?`,
        buttons: [
          { label: 'Overwrite it', value: 'overwrite', variant: 'danger' },
          { label: 'Choose another name', value: 'rename', variant: 'primary' },
          { label: 'Cancel', value: 'cancel' }
        ]
      });
      if (!ow || ow.action === 'cancel') return 'cancelled';
      if (ow.action === 'rename') continue;
    }

    await saveBudgetsAsTemplate(name, budgets);
    return 'saved';
  }
}

// --- DEMO HOUSEHOLD TEMPLATES (based on a real property-investor budget
// sheet: Income, Loans, Credit, Utilities, Phone, Internet, Food, Homeware,
// Education, Transport, Misc, Emergency Fund, Medical, Insurance) ---
// These are installed straight into the budgetTemplates store — NOT into
// live budgets — so they just show up as two more options in "My
// Templates" ready to Load whenever you want. Loans/insurance/utilities
// are identical across both tiers (they're fixed obligations, not
// lifestyle choices); only the discretionary lines (groceries, dining,
// homeware, fuel, misc, emergency fund top-up) differ between them.
//
// Several of your original sheet's line items share one subcategory here
// (Phone 1-4 → one "Mobile Phone" line, Car + Car 1 insurance → one "Car
// Insurance" line, Home + Contents → the app's combined "Home & Contents
// Insurance" line) since budgets are tracked per subcategory, not per
// individual bill or asset — split them back out manually after loading
// if you'd rather track them separately.
const DEMO_FIXED_ITEMS = [
  ['sub_salary', 5000], ['sub_spouse_salary', 3000], ['sub_rental_income', 2000], // Income
  ['sub_mortgage_home', 2200],           // Loans: Home
  ['sub_home_equity_mortgage', 400],     // Loans: Equity Loan
  ['sub_inv_mortgage', 1800],            // Loans: Investment Loan
  ['sub_home_building', 500],            // Loans: Construction Loan
  ['sub_credit_card_payment', 300],      // Credit: Credit Card
  ['sub_gas', 80], ['sub_electricity', 200],                       // Utilities
  ['sub_water_usage', 70], ['sub_inv_water_rates', 60],            // Water / Water (inv property)
  ['sub_council_rates', 120], ['sub_inv_council_rates', 100],      // Council / Council (inv property)
  ['sub_land_tax', 150],                                           // Land Tax
  ['sub_mobile', 160],                   // Phone 1-4 (combined)
  ['sub_internet', 90],                  // Internet: NBN
  ['sub_school_fees', 300],              // Education
  ['sub_rego', 40], ['sub_car_service', 80],                       // Transport: Registration, Service
  ['sub_life_ins', 60], ['sub_car_insurance', 120],                // Insurance: Life, Car + Car 1 (combined)
  ['sub_home_ins', 90], ['sub_landlord_ins', 45]                   // Insurance: Home + Contents (combined), Landlord
];

const DEMO_TEMPLATE_DEFS = [
  {
    name: 'Household Budget — Essentials',
    items: [
      ...DEMO_FIXED_ITEMS,
      ['sub_specialty_groceries', 60], ['sub_supermarket', 500], ['sub_fresh_produce', 80], // Food: Indian, Supermarket, Vegetables
      ['sub_restaurants', 60],         // Food: Restaurant/Fastfood
      ['sub_home_furnishings', 30],    // Homeware
      ['sub_fuel', 150],               // Transport: Fuel
      ['sub_misc_items', 50],          // Misc
      ['sub_emergency_fund', 100],     // Emergency Fund
      ['sub_gp', 40]                   // Medical
    ]
  },
  {
    name: 'Household Budget — Comfortable',
    items: [
      ...DEMO_FIXED_ITEMS,
      ['sub_specialty_groceries', 120], ['sub_supermarket', 800], ['sub_fresh_produce', 150],
      ['sub_restaurants', 250],
      ['sub_home_furnishings', 150],
      ['sub_fuel', 250],
      ['sub_misc_items', 150],
      ['sub_emergency_fund', 400],
      ['sub_gp', 80]
    ]
  }
];

// Adds the two demo templates above to the budgetTemplates store (skipping
// any whose name already exists, so re-running this is harmless). Category
// icons are pulled live from `categories` so they stay correct even if
// you've changed an icon. Returns how many were added.
export async function installDemoBudgetTemplates(categories) {
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const existingNames = new Set((await getAllBudgetTemplates()).map(t => t.name.toLowerCase()));

  let added = 0;
  for (const def of DEMO_TEMPLATE_DEFS) {
    if (existingNames.has(def.name.toLowerCase())) continue;

    const items = def.items
      .filter(([categoryId]) => categoryById.has(categoryId))
      .map(([categoryId, amount]) => ({
        categoryId,
        amount,
        frequency: 'monthly',
        icon: categoryById.get(categoryId)?.icon || '💰'
      }));

    await addItem(STORE_NAMES.budgetTemplates, {
      id: generateId(),
      name: def.name,
      items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    added++;
  }
  return added;
}

// Deletes the demo templates by name. Live budgets are never affected.
// Returns how many were removed.
export async function removeDemoBudgetTemplates() {
  const names = new Set(DEMO_TEMPLATE_DEFS.map(d => d.name.toLowerCase()));
  const demo = (await getAllBudgetTemplates()).filter(t => names.has(String(t.name).toLowerCase()));
  for (const t of demo) await deleteItem(STORE_NAMES.budgetTemplates, t.id);
  return demo.length;
}

// --- HELPER FUNCTION ---
// A transaction counts toward a budget if it's tagged with that exact
// category, OR with one of that category's subcategories. This means a
// budget set on a parent category (e.g. "Transport") automatically rolls up
// spend from all its children (Fuel, Rego, Tolls...), while a budget set on
// a specific subcategory (e.g. "Transport / Fuel") still tracks only that
// one. Categories and their subcategories always stay linked for reporting.
export function transactionMatchesBudgetCategory(t, budgetCategoryId, categories) {
    if (t.categoryId === budgetCategoryId) return true;
    const txCat = categories.find(c => c.id === t.categoryId);
    return !!(txCat && txCat.parentId === budgetCategoryId);
}

// Returns the [start, end) date range for a given view mode, `offset`
// periods away from the current one. offset 0 is the period "now" sits
// in, -1 is the previous period, +1 is the next, etc. `end` is exclusive
// so callers can filter with `t.date >= start && t.date < end` and never
// pull in spend from an adjacent period.
export function getPeriodRange(viewMode, offset = 0) {
    const now = new Date();
    let start, end;

    switch (viewMode) {
        case 'weekly': {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7);
            end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
            break;
        }
        case 'fortnightly': {
            // Matches the original rolling-14-day-window behaviour (not
            // calendar-aligned to a fixed fortnight), just steps it by
            // 14 days per offset.
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14 + offset * 14);
            end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 14);
            break;
        }
        case 'quarterly': {
            const currentQuarter = Math.floor(now.getMonth() / 3);
            start = new Date(now.getFullYear(), (currentQuarter + offset) * 3, 1);
            end = new Date(now.getFullYear(), (currentQuarter + offset) * 3 + 3, 1);
            break;
        }
        case 'yearly': {
            start = new Date(now.getFullYear() + offset, 0, 1);
            end = new Date(now.getFullYear() + offset + 1, 0, 1);
            break;
        }
        case 'monthly':
        default: {
            start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
            break;
        }
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return { start, end };
}

// Human-readable label for the period nav control, e.g. "September 2026",
// "Q3 2026", "2026", or "27 Aug – 2 Sep 2026" for week/fortnight views.
export function formatPeriodLabel(viewMode, start, end) {
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);

    switch (viewMode) {
        case 'monthly':
            return start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
        case 'yearly':
            return String(start.getFullYear());
        case 'quarterly':
            return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
        case 'weekly':
        case 'fortnightly':
        default: {
            const shortDate = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
            const yearSuffix = start.getFullYear() === endInclusive.getFullYear()
                ? ` ${endInclusive.getFullYear()}`
                : ` ${start.getFullYear()} – ${shortDate(endInclusive)} ${endInclusive.getFullYear()}`;
            return start.getFullYear() === endInclusive.getFullYear()
                ? `${shortDate(start)} – ${shortDate(endInclusive)}${yearSuffix}`
                : `${shortDate(start)}${yearSuffix}`;
        }
    }
}

// Module-level so it survives across initBudgetsUI() re-renders (view
// mode change, prev/next clicks, budget add/edit/delete all re-call it).
// Resets to 0 whenever the view mode changes, since an offset meaningful
// for "weeks back" isn't meaningful for "quarters back".
let currentPeriodOffset = 0;
let lastViewModeForOffset = null;

// Chart.js instance for the summary donut below — module-level so
// initBudgetsUI() can destroy the previous one before creating a new one
// on every re-render (same pattern as the portfolio/trend charts in
// wealthOverview.js), otherwise Chart.js throws on a canvas that's
// already attached to a live chart.
let budgetsSummaryChart = null;

// Same formatting as the fo-card money helpers in financeOverview.js —
// kept as a local copy rather than imported, so this page's summary card
// doesn't depend on financeOverview.js's internals changing out from
// under it.
function money(n) {
    const num = Number(n) || 0;
    return formatMoney(num, undefined, { digits: 0 });
}

function compactMoney(n) {
    const num = Number(n) || 0;
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    if (abs >= 1000) return `${sign}${currencySymbol()}${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
    return `${sign}${formatMoney(abs, undefined, { digits: 0 })}`;
}

export async function initBudgetsUI() {
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) {
        console.error("No #mainContent element found");
        return;
    }

    const currentViewMode = document.getElementById('budgetViewMode')?.value || 'monthly';

    // Reset the period offset whenever the view mode changes (an offset of
    // "-2" means something different for weeks vs quarters), but preserve
    // it across re-renders triggered by the same view mode (prev/next
    // clicks, add/edit/delete of a budget).
    if (lastViewModeForOffset !== null && lastViewModeForOffset !== currentViewMode) {
        currentPeriodOffset = 0;
    }
    lastViewModeForOffset = currentViewMode;

    const { start: periodStart, end: periodEnd } = getPeriodRange(currentViewMode, currentPeriodOffset);
    const periodLabel = formatPeriodLabel(currentViewMode, periodStart, periodEnd);
    const isCurrentPeriod = currentPeriodOffset === 0;
    const budgetTemplates = await getAllBudgetTemplates();
    const liveBudgetCount = (await getAllItems(STORE_NAMES.budgets)).length;

    mainContent.innerHTML = `
        <div class="budgets-header">
            <h2>🎯 Budgets</h2>
            <div class="budgets-controls">
                <div class="view-mode">
                    <label class="form-label">View As:</label>
                    <select id="budgetViewMode" class="form-select">
                        <option value="weekly"${currentViewMode === 'weekly' ? ' selected' : ''}>Weekly</option>
                        <option value="fortnightly"${currentViewMode === 'fortnightly' ? ' selected' : ''}>Fortnightly</option>
                        <option value="monthly"${currentViewMode === 'monthly' ? ' selected' : ''}>Monthly</option>
                        <option value="quarterly"${currentViewMode === 'quarterly' ? ' selected' : ''}>Quarterly</option>
                        <option value="yearly"${currentViewMode === 'yearly' ? ' selected' : ''}>Yearly</option>
                    </select>
                </div>
                <div class="period-nav">
                    <button id="periodPrevBtn" class="btn-secondary" title="Previous period">‹</button>
                    <span id="periodLabel" class="period-label">${escapeHtml(periodLabel)}</span>
                    <button id="periodNextBtn" class="btn-secondary" title="Next period" ${isCurrentPeriod ? 'disabled' : ''}>›</button>
                    ${!isCurrentPeriod ? '<button id="periodTodayBtn" class="btn-secondary">Today</button>' : ''}
                </div>
                <button id="addBudgetBtn" class="btn-primary">➕ Add Budget</button>
                <button id="loadTemplateBtn" class="btn-secondary">📋 Load Starter Budget Template</button>
                <button id="addDemoTemplatesBtn" class="btn-secondary">✨ Add Demo Templates</button>
                <button id="removeDemoTemplatesBtn" class="btn-secondary">🧹 Remove Demo Templates</button>
                <button id="saveBudgetTemplateBtn" class="btn-secondary">💾 Save as Template</button>
                <button id="removeAllBudgetsBtn" class="btn-secondary" ${liveBudgetCount === 0 ? 'disabled' : ''}>🧹 Remove All Budgets</button>
                <div class="view-mode budget-template-picker">
                    <label class="form-label" for="budgetTemplateSelect">My Templates:</label>
                    <select id="budgetTemplateSelect" class="form-select" ${budgetTemplates.length === 0 ? 'disabled' : ''}>
                        ${budgetTemplates.length === 0
                            ? '<option value="">No saved templates</option>'
                            : budgetTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.items.length})</option>`).join('')}
                    </select>
                </div>
                <button id="loadBudgetTemplateBtn" class="btn-secondary" ${budgetTemplates.length === 0 ? 'disabled' : ''}>📂 Load</button>
                <button id="renameBudgetTemplateBtn" class="btn-secondary" ${budgetTemplates.length === 0 ? 'disabled' : ''}>✏️ Rename</button>
                <button id="deleteBudgetTemplateBtn" class="btn-secondary" ${budgetTemplates.length === 0 ? 'disabled' : ''}>🗑️ Delete</button>
                <button id="expandAllBudgetsBtn" class="btn-secondary">⬇️ Expand All</button>
                <button id="collapseAllBudgetsBtn" class="btn-secondary">⬆️ Collapse All</button>
            </div>
        </div>

        <div class="fo-card fo-card-wide">
            <div class="fo-card-header-row">
                <span class="fo-card-title">Budget Summary</span>
                <span class="fo-card-subtitle">${escapeHtml(periodLabel)}</span>
            </div>
            <div class="fo-budget-layout">
                <div class="fo-chart-wrap fo-donut-wrap">
                    <canvas id="budgetsSummaryDonut"></canvas>
                    <div class="fo-donut-center">
                        <span class="fo-donut-center-value" id="budgetsSummaryDonutCenter">$0</span>
                    </div>
                </div>
                <div class="fo-budget-mid">
                    <div class="fo-flow-bar-row">
                        <span>↙️ Actual Income</span>
                        <div class="fo-progress-track"><div class="fo-progress-fill" id="budgetsSummaryInflowFill" style="width:50%"></div></div>
                        <span id="budgetsSummaryInflowPct">0%</span>
                    </div>
                    <div class="fo-flow-bar-row">
                        <span>↗️ Actual Expenses</span>
                        <div class="fo-progress-track"><div class="fo-progress-fill outflow" id="budgetsSummaryOutflowFill" style="width:50%"></div></div>
                        <span id="budgetsSummaryOutflowPct">0%</span>
                    </div>
                    <div class="fo-legend-row">
                        <span class="fo-legend-dot" style="background:#5b8def;"></span>
                        <span class="fo-legend-label">Budgeted Income</span>
                        <span class="fo-legend-value" id="totalIncome">$0.00</span>
                    </div>
                    <div class="fo-progress-track thin"><div class="fo-progress-fill" id="budgetsSummaryIncomeBar" style="width:0%;background:#5b8def"></div></div>
                    <div class="fo-legend-row">
                        <span class="fo-legend-dot" style="background:#c9a227;"></span>
                        <span class="fo-legend-label">Budgeted Expenses</span>
                        <span class="fo-legend-value" id="totalExpenses">$0.00</span>
                    </div>
                    <div class="fo-progress-track thin"><div class="fo-progress-fill" id="budgetsSummaryExpensesBar" style="width:0%;background:#c9a227"></div></div>
                    <div class="fo-legend-row">
                        <span class="fo-legend-dot" style="background:#3ddc97;"></span>
                        <span class="fo-legend-label">Budgeted Surplus</span>
                        <span class="fo-legend-value" id="totalBudget">$0.00</span>
                    </div>
                    <div class="fo-progress-track thin"><div class="fo-progress-fill" id="budgetsSummarySurplusBar" style="width:0%;background:#3ddc97"></div></div>
                </div>
                <div class="fo-balance-box">
                    <span class="fo-balance-box-value" id="totalBalance">$0.00</span>
                    <span class="fo-balance-box-label">Actual Balance</span>
                </div>
            </div>
        </div>

        <div id="budgetContainer" class="budgets-container"></div>
    `;

    const viewModeSelect = document.getElementById('budgetViewMode');
    viewModeSelect.addEventListener('change', () => {
        currentPeriodOffset = 0; // switching modes starts back at the current period
        initBudgetsUI();
    });

    document.getElementById('periodPrevBtn').addEventListener('click', () => {
        currentPeriodOffset -= 1;
        initBudgetsUI();
    });
    document.getElementById('periodNextBtn').addEventListener('click', () => {
        // Capped at the current period — budgeting against the future
        // isn't meaningful, and it keeps "Next" from producing empty
        // periods with no transactions at all.
        currentPeriodOffset = Math.min(currentPeriodOffset + 1, 0);
        initBudgetsUI();
    });
    document.getElementById('periodTodayBtn')?.addEventListener('click', () => {
        currentPeriodOffset = 0;
        initBudgetsUI();
    });

    const viewMode = viewModeSelect.value;

    const [budgets, rawTransactions, categories, budgetAccounts] = await Promise.all([
        getAllItems(STORE_NAMES.budgets),
        getAllItems(STORE_NAMES.transactions),
        getAllItems(STORE_NAMES.categories),
        getAllItems(STORE_NAMES.accounts).catch(() => [])
    ]);
    // Budget vs actual is a flow comparison, so compare in one currency.
    const transactions = toBaseTransactions(rawTransactions, budgetAccounts);

    const container = document.getElementById('budgetContainer');
    container.innerHTML = '';

    // Get income categories dynamically from your categories data
    const incomeCategories = categories.filter(cat => 
        cat.type === 'income' || 
        cat.name?.toLowerCase().includes('salary') || 
        cat.name?.toLowerCase().includes('income')
    ).map(cat => cat.id);

    const expenseCategories = categories.filter(cat => 
        cat.type === 'expense' || 
        !incomeCategories.includes(cat.id)
    ).map(cat => cat.id);

    // Calculate totals with frequency conversion
    let totalIncome = 0;
    let totalExpenses = 0;

    budgets.forEach(budget => {
        const normalizedAmount = convertAmount(
            budget.amount || 0, 
            budget.frequency || 'monthly', 
            viewMode
        );

        if (incomeCategories.includes(budget.categoryId)) {
            totalIncome += normalizedAmount;
        } else if (expenseCategories.includes(budget.categoryId)) {
            totalExpenses += normalizedAmount;
        }
    });

    const budgetSurplus = totalIncome - totalExpenses;
    
    // Calculate actual balance from transactions in the selected period
    // (periodStart/periodEnd were resolved above from the nav control's
    // offset — end is exclusive, so this never leaks spend from an
    // adjacent period into the one being viewed).
    const periodStartISO = periodStart.toISOString();
    const periodEndISO = periodEnd.toISOString();
    
    // Transfers between your own accounts (isTransfer: true) aren't real
    // income or spending — excluded here so moving money to pay off a
    // credit card, for example, doesn't show up as fake income/expense.
    const actualIncome = transactions
        .filter(t => t.type === 'income' && !t.isTransfer && t.date >= periodStartISO && t.date < periodEndISO)
        .reduce((sum, t) => sum + t.amount, 0);
        
    const actualExpenses = transactions
        .filter(t => t.type === 'expense' && !t.isTransfer && t.date >= periodStartISO && t.date < periodEndISO)
        .reduce((sum, t) => sum + t.amount, 0);
        
    // actualExpenses is a sum of real expense transactions, which are stored
    // as negative amounts, so balance is the sum, not income minus expenses.
    const actualBalance = actualIncome + actualExpenses;

    // Update the totals on the UI. classList.toggle (not className =) here
    // because these spans now carry structural classes (fo-legend-value /
    // fo-balance-box-value) from the Budget Summary card — overwriting
    // className wholesale, like the old plain-number cards used to, would
    // wipe those layout classes along with setting the color.
    document.getElementById('totalIncome').textContent = `${formatMoney(totalIncome)}`;
    document.getElementById('totalExpenses').textContent = `${formatMoney(totalExpenses)}`;
    document.getElementById('totalBudget').textContent = `${formatMoney(budgetSurplus)}`;
    document.getElementById('totalBudget').classList.toggle('negative', budgetSurplus < 0);
    document.getElementById('totalBalance').textContent = `${formatMoney(actualBalance)}`;
    document.getElementById('totalBalance').classList.toggle('negative', actualBalance < 0);

    // Per-row progress bars under each legend line — relative magnitude
    // of that row against the other two (Income/Expenses/Surplus), not a
    // literal "percent of a whole" the way the donut above is. Purely a
    // proportional-feel visual, same idea as the donut but per-line.
    const legendRowTotal = Math.abs(totalIncome) + Math.abs(totalExpenses) + Math.abs(budgetSurplus);
    const pctOf = (n) => legendRowTotal > 0 ? Math.min(100, (Math.abs(n) / legendRowTotal) * 100) : 0;
    const incomeBarEl = document.getElementById('budgetsSummaryIncomeBar');
    const expensesBarEl = document.getElementById('budgetsSummaryExpensesBar');
    const surplusBarEl = document.getElementById('budgetsSummarySurplusBar');
    if (incomeBarEl) incomeBarEl.style.width = `${pctOf(totalIncome)}%`;
    if (expensesBarEl) expensesBarEl.style.width = `${pctOf(totalExpenses)}%`;
    if (surplusBarEl) surplusBarEl.style.width = `${pctOf(budgetSurplus)}%`;

    // Donut + flow bars for the new Budget Summary card. Donut is
    // Budgeted Expenses split into "Spent so far" vs "Remaining" for the
    // selected period (falls back to an even placeholder split when
    // there's no budgeted-expense figure yet, so the ring never renders
    // with a 0/0 NaN slice). Flow bars are actual income vs actual
    // expenses for the same period, mirroring the inflow/outflow bars on
    // the Finance Overview Budget card but with this page's own figures.
    const spentSoFar = Math.min(Math.abs(actualExpenses), totalExpenses > 0 ? totalExpenses : Math.abs(actualExpenses));
    const remaining = Math.max(0, totalExpenses - spentSoFar);
    const donutCenterEl = document.getElementById('budgetsSummaryDonutCenter');
    if (donutCenterEl) donutCenterEl.textContent = compactMoney(totalExpenses > 0 ? totalExpenses : Math.abs(actualExpenses));

    const flowTotal = actualIncome + Math.abs(actualExpenses);
    const inflowPct = flowTotal > 0 ? (actualIncome / flowTotal) * 100 : 50;
    const inflowFillEl = document.getElementById('budgetsSummaryInflowFill');
    const outflowFillEl = document.getElementById('budgetsSummaryOutflowFill');
    const inflowPctEl = document.getElementById('budgetsSummaryInflowPct');
    const outflowPctEl = document.getElementById('budgetsSummaryOutflowPct');
    if (inflowFillEl) inflowFillEl.style.width = `${inflowPct}%`;
    if (outflowFillEl) outflowFillEl.style.width = `${100 - inflowPct}%`;
    if (inflowPctEl) inflowPctEl.textContent = `${Math.round(inflowPct)}%`;
    if (outflowPctEl) outflowPctEl.textContent = `${Math.round(100 - inflowPct)}%`;

    const donutCanvas = document.getElementById('budgetsSummaryDonut');
    if (donutCanvas && typeof Chart !== 'undefined') {
        if (budgetsSummaryChart) { budgetsSummaryChart.destroy(); budgetsSummaryChart = null; }
        const overBudget = totalExpenses > 0 && spentSoFar > totalExpenses;
        budgetsSummaryChart = new Chart(donutCanvas, {
            type: 'doughnut',
            data: {
                labels: ['Spent so far', 'Remaining'],
                datasets: [{
                    data: [spentSoFar, remaining],
                    backgroundColor: [overBudget ? '#dc2626' : '#c9a227', '#3a4a63'],
                    borderWidth: 0
                }]
            },
            options: {
                plugins: { legend: { display: false } },
                cutout: '70%',
                maintainAspectRatio: false
            }
        });
    }

    if (budgets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No budgets yet. Click "Add Budget" to create one.</p>
            </div>
        `;
    } else {
        // Separate income and expense budgets
        const incomeBudgets = budgets.filter(budget => incomeCategories.includes(budget.categoryId));
        const expenseBudgets = budgets.filter(budget => expenseCategories.includes(budget.categoryId));

        // Add income section header if there are income budgets
        if (incomeBudgets.length > 0) {
            const incomeHeader = document.createElement('div');
            incomeHeader.className = 'budgets-section-header';
            incomeHeader.innerHTML = `<h3>💰 Income Budgets</h3>`;
            container.appendChild(incomeHeader);
        }

        renderBudgetsGroupedByCategory(incomeBudgets, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, container);

        // Add expense section header if there are expense budgets
        if (expenseBudgets.length > 0) {
            const expenseHeader = document.createElement('div');
            expenseHeader.className = 'budgets-section-header';
            expenseHeader.innerHTML = `<h3>💸 Expense Budgets</h3>`;
            container.appendChild(expenseHeader);
        }

        renderBudgetsGroupedByCategory(expenseBudgets, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, container);
    }

    document.getElementById('expandAllBudgetsBtn').addEventListener('click', () => {
        saveCollapsedGroups(new Set());
        initBudgetsUI();
    });

    document.getElementById('collapseAllBudgetsBtn').addEventListener('click', () => {
        saveCollapsedGroups(getCollapsibleGroupIds(budgets, categories));
        initBudgetsUI();
    });

    document.getElementById('addBudgetBtn').addEventListener('click', () => {
        showInlineEditor(null, categories);
    });

    document.getElementById('loadTemplateBtn').addEventListener('click', async () => {
        const proceed = confirm(
            'This will add starter budgets for 2-3 common subcategories under ' +
            'each main category (e.g. under Utilities: Electricity, Gas, Water), ' +
            'using placeholder amounts you can edit afterward. Each main ' +
            'category\'s total is automatically the sum of its budgeted ' +
            'subcategories — you\'ll see both on the Budgets page.\n\n' +
            'Existing budgets are left untouched. Continue?'
        );
        if (!proceed) return;

        const createdCount = await loadStarterBudgetTemplate(categories);
        if (createdCount === 0) {
            alert('No new budgets were added — every suggested subcategory already has one.');
        } else {
            alert(`Added ${createdCount} starter budget(s), grouped under their main category. ` +
                  `Edit any amount with the ✏️ button, then check the Dashboard to confirm spend ` +
                  `is populating from your transactions.`);
        }
        initBudgetsUI();
    });

    document.getElementById('addDemoTemplatesBtn').addEventListener('click', async () => {
        const proceed = confirm(
            'This adds two ready-made templates to "My Templates" below — ' +
            '"Household Budget — Essentials" and "— Comfortable" — covering loans, ' +
            'utilities, phone/internet, food, homeware, education, transport, insurance ' +
            'and an emergency fund, at two different spending levels. ' +
            'Your current live budgets are untouched until you choose to Load one.\n\n' +
            'Continue?'
        );
        if (!proceed) return;

        const addedCount = await installDemoBudgetTemplates(categories);
        alert(addedCount === 0
            ? 'Both demo templates already exist in "My Templates" — nothing new to add.'
            : `Added ${addedCount} demo template(s) to "My Templates". Select one below and hit Load ` +
              `to apply it — you'll be asked whether to add it to, or replace, your current budgets.`);
        initBudgetsUI();
    });

    document.getElementById('removeDemoTemplatesBtn').addEventListener('click', async () => {
        if (!confirm('Remove the demo templates ("Household Budget — Essentials" / "— Comfortable") from My Templates?\n\nYour live budgets and your own saved templates are not touched.')) return;
        const n = await removeDemoBudgetTemplates();
        alert(n ? `Removed ${n} demo template(s).` : 'No demo templates found.');
        initBudgetsUI();
    });

    document.getElementById('saveBudgetTemplateBtn').addEventListener('click', async () => {
        if (budgets.length === 0) {
            alert('There are no budgets to save yet — add some first, then save them as a template.');
            return;
        }
        const name = prompt('Name this template (e.g. "Frugal Month", "Holiday Season"):');
        if (!name || !name.trim()) return;

        const { overwritten, count } = await saveBudgetsAsTemplate(name.trim(), budgets);
        alert(overwritten
            ? `Updated the "${name.trim()}" template with your current ${count} budget(s).`
            : `Saved your current ${count} budget(s) as the "${name.trim()}" template.`);
        initBudgetsUI();
    });

    document.getElementById('loadBudgetTemplateBtn')?.addEventListener('click', async () => {
        const select = document.getElementById('budgetTemplateSelect');
        const templateId = select?.value;
        if (!templateId) return;
        const templateName = select.options[select.selectedIndex].textContent;
        const cleanName = templateName.replace(/\s*\(\d+\)$/, '');

        // Nothing to add to / replace -> just load it.
        let mode = 'replace';
        if (budgets.length > 0) {
            const choice = await showBudgetDialog({
                title: `Load "${cleanName}"`,
                message: `You currently have ${budgets.length} budget(s). How should this template be applied?\n\n` +
                         `• Add to existing — keeps all your current budgets and only adds lines for categories that don't have one yet.\n` +
                         `• Replace existing — removes all your current budgets and uses this template instead.`,
                buttons: [
                    { label: '➕ Add to existing', value: 'add', variant: 'primary' },
                    { label: '🔄 Replace existing', value: 'replace', variant: 'danger' },
                    { label: 'Cancel', value: 'cancel' }
                ]
            });
            if (!choice || choice.action === 'cancel') return;
            mode = choice.action;

            if (mode === 'replace') {
                const saved = await offerSaveCurrentBudgets(budgets, {
                    title: '💾 Save your current budgets first?',
                    message: `Replacing will remove your ${budgets.length} current budget(s). ` +
                             `Save them as a template so you can load them back later?`,
                    saveLabel: '💾 Save as template, then replace',
                    skipLabel: 'Replace without saving',
                    blockedNames: [cleanName]
                });
                if (saved === 'cancelled') return;
            }
        }

        const result = await loadBudgetTemplate(templateId, categories, mode);
        if (!result) {
            alert('That template could not be found — it may have just been deleted.');
        } else if (mode === 'add') {
            alert(
                `Added ${result.loaded} budget(s) from "${result.name}".` +
                (result.keptExisting ? ` ${result.keptExisting} categor${result.keptExisting === 1 ? 'y' : 'ies'} already had a budget, so your existing amounts were kept.` : '') +
                (result.skipped ? ` ${result.skipped} skipped (their category no longer exists).` : '')
            );
        } else {
            alert(
                `Loaded "${result.name}": ${result.loaded} budget(s) applied` +
                (result.skipped ? `, ${result.skipped} skipped (their category no longer exists)` : '') +
                (result.replaced ? `, replacing your previous ${result.replaced} budget(s).` : '.')
            );
        }
        initBudgetsUI();
    });

    document.getElementById('removeAllBudgetsBtn')?.addEventListener('click', async () => {
        if (budgets.length === 0) return;

        const outcome = await offerSaveCurrentBudgets(budgets, {
            title: '🧹 Remove all budgets?',
            message: `This removes all ${budgets.length} of your budget(s) and can't be undone. ` +
                     `Save them as a template first so you can load them back later?`,
            saveLabel: '💾 Save as template, then remove',
            skipLabel: 'Remove without saving',
        });
        if (outcome === 'cancelled') return;

        const removed = await deleteAllBudgets();
        alert(`Removed ${removed} budget(s)` +
              (outcome === 'saved' ? ' — your previous set was saved as a template under "My Templates".' : '.'));
        initBudgetsUI();
    });

    document.getElementById('renameBudgetTemplateBtn')?.addEventListener('click', async () => {
        const select = document.getElementById('budgetTemplateSelect');
        const templateId = select?.value;
        if (!templateId) return;
        const currentName = select.options[select.selectedIndex].textContent.replace(/\s*\(\d+\)$/, '');

        const newName = prompt('Rename template to:', currentName);
        if (!newName || !newName.trim() || newName.trim() === currentName) return;

        await renameBudgetTemplate(templateId, newName.trim());
        initBudgetsUI();
    });

    document.getElementById('deleteBudgetTemplateBtn')?.addEventListener('click', async () => {
        const select = document.getElementById('budgetTemplateSelect');
        const templateId = select?.value;
        if (!templateId) return;
        const templateName = select.options[select.selectedIndex].textContent;

        if (!confirm(`Delete the "${templateName}" template? This can't be undone. (Your current budgets are untouched.)`)) return;

        await deleteBudgetTemplate(templateId);
        initBudgetsUI();
    });
}

const COLLAPSED_GROUPS_STORAGE_KEY = 'dfm_budget_collapsed_groups';

function loadCollapsedGroups() {
    try {
        return new Set(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) || '[]'));
    } catch {
        return new Set();
    }
}

function saveCollapsedGroups(set) {
    try {
        localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...set]));
    } catch {
        // localStorage unavailable — collapse state just won't persist, not fatal
    }
}

// Mirrors the grouping/showHeader logic inside renderBudgetsGroupedByCategory
// (kept separate rather than shared, so a future change to one doesn't have
// to worry about the other's call signature) — used by "Collapse All" to
// know which group ids are actually collapsible without re-deriving that
// while also rendering. Same category → topLevelId grouping applies
// regardless of income vs expense, so this runs once over every budget.
function getCollapsibleGroupIds(budgetList, categories) {
    const categoryById = new Map(categories.map(c => [c.id, c]));
    const groups = new Map(); // topLevelCategoryId -> budgets[]

    for (const budget of budgetList) {
        const cat = categoryById.get(budget.categoryId);
        const topLevelId = cat?.parentId || cat?.id || budget.categoryId;
        if (!groups.has(topLevelId)) groups.set(topLevelId, []);
        groups.get(topLevelId).push(budget);
    }

    const collapsibleIds = new Set();
    for (const [topLevelId, groupBudgets] of groups.entries()) {
        const topCategory = categoryById.get(topLevelId);
        const showHeader = topCategory && (groupBudgets.length > 1 || groupBudgets[0].categoryId !== topCategory.id);
        if (showHeader) collapsibleIds.add(topLevelId);
    }
    return collapsibleIds;
}

// Groups budgets by their top-level parent category (e.g. all of
// Electricity/Gas/Water under "Utilities") and renders a collapsible
// header per group showing the combined total, followed by each
// individual subcategory budget underneath it. A budget set directly on a
// top-level category (no parent) is its own group of one. This is what
// makes "you can see Utilities as well as Water/Gas/Electricity under it"
// work, and lets each main category be collapsed to just its total line.
function renderBudgetsGroupedByCategory(budgetList, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, container) {
    if (budgetList.length === 0) return;

    const categoryById = new Map(categories.map(c => [c.id, c]));
    const groups = new Map(); // topLevelCategoryId -> { topCategory, budgets: [] }

    for (const budget of budgetList) {
        const cat = categoryById.get(budget.categoryId);
        const topLevelId = cat?.parentId || cat?.id || budget.categoryId;
        if (!groups.has(topLevelId)) {
            groups.set(topLevelId, {
                topCategory: categoryById.get(topLevelId) || null,
                budgets: []
            });
        }
        groups.get(topLevelId).budgets.push(budget);
    }

    const collapsedGroups = loadCollapsedGroups();

    for (const [topLevelId, { topCategory, budgets: groupBudgets }] of groups.entries()) {
        // Only show a group header (and make it collapsible) when there's a
        // real parent to name and more than one budget under it — a lone
        // top-level-only budget doesn't need a redundant header repeating
        // its own name, and nothing to collapse.
        const showHeader = topCategory && (groupBudgets.length > 1 || groupBudgets[0].categoryId !== topCategory.id);

        if (!showHeader) {
            groupBudgets.forEach(budget => {
                renderBudgetCard(budget, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, container, false);
            });
            continue;
        }

        const isCollapsed = collapsedGroups.has(topLevelId);

        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'budget-group';
        groupWrapper.dataset.groupId = topLevelId;

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'budget-group-children';
        childrenContainer.style.display = isCollapsed ? 'none' : '';

        renderCategoryGroupHeader(
            topCategory, groupBudgets, categories, transactions, incomeCategories,
            periodStartISO, periodEndISO, viewMode, groupWrapper, isCollapsed,
            () => {
                const nowCollapsed = childrenContainer.style.display !== 'none';
                childrenContainer.style.display = nowCollapsed ? 'none' : '';
                if (nowCollapsed) collapsedGroups.add(topLevelId);
                else collapsedGroups.delete(topLevelId);
                saveCollapsedGroups(collapsedGroups);
            }
        );

        groupBudgets.forEach(budget => {
            renderBudgetCard(budget, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, childrenContainer, true);
        });

        groupWrapper.appendChild(childrenContainer);
        container.appendChild(groupWrapper);
    }
}

function renderCategoryGroupHeader(topCategory, groupBudgets, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, container, isCollapsed, onToggle) {
    const isIncomeGroup = incomeCategories.includes(topCategory.id) ||
        groupBudgets.some(b => incomeCategories.includes(b.categoryId));

    let groupGoal = 0;
    let groupSpent = 0;
    for (const budget of groupBudgets) {
        groupGoal += convertAmount(budget.amount || 0, budget.frequency || 'monthly', viewMode);
        groupSpent += transactions
            .filter(t => {
                const isCorrectType = isIncomeGroup ? t.type === 'income' : t.type === 'expense';
                return isCorrectType &&
                    transactionMatchesBudgetCategory(t, budget.categoryId, categories) &&
                    t.date >= periodStartISO && t.date < periodEndISO;
            })
            // Bug fix: expense transactions are stored as NEGATIVE amounts
            // (see transactions.js, amount = -1 * value for type "expense"),
            // but a budget's goal is always entered/stored as a positive
            // number. Summing the raw signed amount here made "spent" come
            // out negative for every expense group (e.g. "$-80.00 /
            // $150.00"), which in turn made the percent negative, the
            // progress bar width negative (invalid CSS - renders as an
            // empty/invisible bar), "remaining" add instead of subtract,
            // and over-budget detection never fire - all of which looked
            // to a user like the values simply weren't populating. Using
            // the absolute value here (income transactions are already
            // positive, so this is a no-op for those) makes "spent" match
            // what the goal amount and progress bar expect.
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    }

    const percent = groupGoal > 0 ? Math.min((groupSpent / groupGoal) * 100, 100) : 0;
    const isOverBudget = isIncomeGroup ? groupSpent < groupGoal : groupSpent > groupGoal;

    const header = document.createElement('div');
    header.className = `budget-group-header ${isOverBudget ? 'over-budget' : ''}`;
    header.innerHTML = `
        <div class="budget-group-header-row" role="button" tabindex="0" aria-expanded="${!isCollapsed}">
            <div class="budget-left">
                <span class="budget-group-chevron">${isCollapsed ? '▶' : '▼'}</span>
                <span class="category-icon">${topCategory.icon || '📁'}</span>
                <span class="category-name"><strong>${escapeHtml(topCategory.name)}</strong></span>
            </div>
            <span class="budget-values">
                ${formatMoney(groupSpent)} / ${formatMoney(groupGoal)} · ${percent.toFixed(0)}%
            </span>
        </div>
        <div class="sub-progress-bar-container">
            <div class="sub-progress-bar" style="width:${percent}%"></div>
        </div>
    `;
    container.appendChild(header);

    const headerRow = header.querySelector('.budget-group-header-row');
    const chevron = header.querySelector('.budget-group-chevron');
    headerRow.addEventListener('click', () => {
        const nowExpanded = headerRow.getAttribute('aria-expanded') === 'true';
        headerRow.setAttribute('aria-expanded', String(!nowExpanded));
        chevron.textContent = nowExpanded ? '▶' : '▼';
        onToggle();
    });
    headerRow.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            headerRow.click();
        }
    });
}

function renderBudgetCard(budget, categories, transactions, incomeCategories, periodStartISO, periodEndISO, viewMode, container, isGrouped = false) {
    const cat = categories.find(c => c.id === budget.categoryId);
    const icon = budget.icon || guessCategoryIcon(cat?.name);
    const goal = budget.amount || 0;

    // Filter transactions to the selected period AND category
    const spentInPeriod = transactions
        .filter(t => {
            // For income budgets, track income transactions; for expense budgets, track expense transactions
            const isCorrectType = incomeCategories.includes(budget.categoryId) 
                ? t.type === 'income' 
                : t.type === 'expense';
            
            return isCorrectType && 
                   transactionMatchesBudgetCategory(t, budget.categoryId, categories) &&
                   t.date >= periodStartISO && t.date < periodEndISO;
        })
        // Bug fix: see matching comment in renderCategoryGroupHeader above -
        // expense amounts are stored negative, so summing the raw signed
        // amount made every expense budget's "spent" show as a negative
        // number, broke the percent/progress-bar/remaining/over-budget
        // calculations below, and made the page look like values weren't
        // populating at all.
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Normalize both goal and spent to current view mode
    const normalizedGoal = convertAmount(goal, budget.frequency || 'monthly', viewMode);
    const normalizedSpent = spentInPeriod; 
    
    // For income budgets, we want to track how much we've earned vs goal
    // For expense budgets, we track how much we've spent vs goal
    const remaining = incomeCategories.includes(budget.categoryId) 
        ? Math.max(normalizedGoal - normalizedSpent, 0)
        : Math.max(normalizedGoal - normalizedSpent, 0);
    
    const percent = normalizedGoal > 0 ? Math.min((normalizedSpent / normalizedGoal) * 100, 100) : 0;
    const isOverBudget = incomeCategories.includes(budget.categoryId) 
        ? normalizedSpent < normalizedGoal // For income, we're "over" if we earned less than goal
        : normalizedSpent > normalizedGoal; // For expenses, we're over if we spent more than goal

    const budgetCard = document.createElement('div');
    budgetCard.className = `budget-card ${isOverBudget ? 'over-budget' : ''} ${incomeCategories.includes(budget.categoryId) ? 'income-budget' : 'expense-budget'} ${isGrouped ? 'subcategory-card' : ''}`;
    budgetCard.setAttribute('data-id', budget.id); // Add data-id for finding the card later
    budgetCard.innerHTML = `
        <div class="budget-card-row1">
            <div class="budget-left">
                <span class="category-icon">${icon}</span>
                <span class="category-name">${escapeHtml(cat?.name) || 'Unknown'}</span>

                <span class="budget-values">
                    ${formatMoney(normalizedSpent)} / ${formatMoney(normalizedGoal)} 
                    · ${percent.toFixed(0)}%
                </span>
            </div>

            <div class="budget-actions">
                <button class="action-btn edit-btn" data-id="${budget.id}" title="Edit">✏️</button>
                <button class="action-btn delete-btn" data-id="${budget.id}" title="Delete">🗑️</button>
            </div>
        </div>

        <div class="budget-card-row2">
            <div class="sub-progress-bar-container">
                <div class="sub-progress-bar" style="width:${percent}%"></div>
            </div>

            <div class="budget-status">
                ${formatMoney(remaining)} ${incomeCategories.includes(budget.categoryId) ? 'to earn' : 'remaining'} — 
                ${isOverBudget 
                    ? '<span class="status-over">⚠️ ' + (incomeCategories.includes(budget.categoryId) ? 'Behind' : 'Over') + '</span>' 
                    : '<span class="status-good">On Track</span>'
                }
            </div>
        </div>
    `;

    budgetCard.querySelector('.delete-btn').addEventListener('click', async () => {
        if (confirm(`Delete budget for "${cat?.name}"?`)) {
            await deleteItem(STORE_NAMES.budgets, budget.id);
            initBudgetsUI();
        }
    });

    budgetCard.querySelector('.edit-btn').addEventListener('click', () => {
        showInlineEditor(budget, categories, true); // Pass true to scroll to form
    });

    container.appendChild(budgetCard);
}

function showInlineEditor(existing, categories, scrollToForm = true) {
    const container = document.getElementById('budgetContainer');
    container.querySelectorAll('.budget-editor').forEach(el => el.remove());

    const form = document.createElement('div');
    form.className = 'budget-editor';
    form.innerHTML = `
        <div class="budget-form-card">
            <h3>${existing ? 'Edit Budget' : 'Add New Budget'}</h3>
            <div class="form-row">
                <div class="form-group">
                    <label>Icon:</label>
                    <div class="icon-input">
                        <input type="text" id="iconInput" value="${existing?.icon || ''}" placeholder="💡" maxlength="2">
                    </div>
                </div>
                <div class="form-group">
                    <label>Category:</label>
                    <select id="categoryInput" class="form-select">
                        <option value="">-- Select Category --</option>
                        ${categories.map(c => {
                            const icon = c.icon || guessCategoryIcon(c.name || '');
                            const type = c.type === 'income' ? '💰 Income' : '💸 Expense';
                            return `<option value="${c.id}" ${c.id === existing?.categoryId ? 'selected' : ''}>${icon} ${escapeHtml(c.name)} (${type})</option>`;
                        }).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Goal Amount:</label>
                    <input type="number" id="goalInput" class="form-input" placeholder="0.00" value="${existing?.amount || ''}" min="0" step="0.01">
                </div>
                <div class="form-group">
                    <label>Frequency:</label>
                    <select id="frequencyInput" class="form-select">
                        <option value="weekly"${existing?.frequency==='weekly'?' selected':''}>Weekly</option>
                        <option value="fortnightly"${existing?.frequency==='fortnightly'?' selected':''}>Fortnightly</option>
                        <option value="monthly"${existing?.frequency==='monthly'?' selected':''}>Monthly</option>
                        <option value="quarterly"${existing?.frequency==='quarterly'?' selected':''}>Quarterly</option>
                        <option value="yearly"${existing?.frequency==='yearly'?' selected':''}>Yearly</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button id="saveBudgetBtn" class="btn-primary">💾 Save</button>
                    <button id="cancelBudgetBtn" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;

    // Insert form at the right position
    if (existing) {
        // Find the budget card being edited and insert form after it
        const budgetCard = container.querySelector(`.budget-card[data-id="${existing.id}"]`);
        if (budgetCard) {
            budgetCard.insertAdjacentElement('afterend', form);
        } else {
            container.prepend(form);
        }
    } else {
        // For new budgets, insert at the top
        container.prepend(form);
    }

    // Scroll to form if requested
    if (scrollToForm) {
        setTimeout(() => {
            form.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
        }, 100);
    }

    const catInput = document.getElementById('categoryInput');
    const iconInput = document.getElementById('iconInput');
    catInput.addEventListener('change', () => {
        if (!iconInput.value.trim()) {
            const selected = categories.find(c => c.id === catInput.value);
            iconInput.value = selected?.icon || guessCategoryIcon(selected?.name);
        }
    });

    document.getElementById('saveBudgetBtn').addEventListener('click', async () => {
        const categoryId = document.getElementById('categoryInput').value;
        const amount = parseFloat(document.getElementById('goalInput').value);
        const icon = document.getElementById('iconInput').value || '💰';
        const frequency = document.getElementById('frequencyInput').value;

        if (!categoryId || isNaN(amount)) {
            alert('Please select a category and enter a goal amount.');
            return;
        }

        const existingBudgets = await getAllItems(STORE_NAMES.budgets);
        const duplicate = existingBudgets.some(budget => 
            budget.categoryId === categoryId && 
            budget.frequency === frequency &&
            budget.id !== existing?.id
        );

        if (duplicate) {
            alert('A budget for this category and frequency already exists!');
            return;
        }

        const safeId = existing?.id || generateId();

        const budgetData = {
            id: safeId,
            categoryId,
            amount,
            icon,
            frequency,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            if (existing) {
                await updateItem(STORE_NAMES.budgets, budgetData);
            } else {
                await addItem(STORE_NAMES.budgets, budgetData);
            }
            initBudgetsUI();
        } catch (err) {
            console.error('❌ Error saving budget:', err);
            alert('Error saving budget: ' + err.message);
        }
    });

    document.getElementById('cancelBudgetBtn').addEventListener('click', () => {
        form.remove();
    });
}

export function convertAmount(amount, fromFreq, toFreq) {
    const multipliers = {
        weekly: { 
            weekly: 1,     
            fortnightly: 2,   
            monthly: 4.33,     
            quarterly: 13,    
            yearly: 52 
        },
        fortnightly: { 
            weekly: 0.5,     
            fortnightly: 1,     
            monthly: 2.17,  
            quarterly: 6.5,   
            yearly: 26 
        },
        monthly: { 
            weekly: 1/4.33,  
            fortnightly: 1/2.17,  
            monthly: 1,       
            quarterly: 3,    
            yearly: 12 
        },
        quarterly: { 
            weekly: 1/13,    
            fortnightly: 1/6.5,   
            monthly: 1/3,       
            quarterly: 1,      
            yearly: 4 
        }, 
        yearly: { 
            weekly: 1/52,    
            fortnightly: 1/26,    
            monthly: 1/12,      
            quarterly: 1/4,      
            yearly: 1 
        }
    };
    
    const map = multipliers[fromFreq];
    
    if (!map) {
        console.warn('Unknown fromFreq:', fromFreq, '– using no conversion');
        return amount;
    }
    
    const factor = map[toFreq];
    
    if (factor === undefined) {
        console.warn('Cannot convert from', fromFreq, 'to', toFreq, '– using no conversion');
        return amount;
    }
    
    return amount * factor; 
}

function guessCategoryIcon(name = '') {
    const map = {
        food: '🍽️', groceries: '🛒', utilities: '💡', rent: '🏠',
        transport: '🚗', travel: '✈️', entertainment: '🎬',
        savings: '💰', salary: '💵', health: '⚕️', shopping: '🛍️',
        pets: '🐾', kids: '🧒', gifts: '🎁', income: '💰',
        business: '💼', government: '🏛️', investment: '📈',
        rental: '🏠', tax: '📝'
    };
    const key = Object.keys(map).find(k => name?.toLowerCase().includes(k));
    return map[key] || '💼';
}