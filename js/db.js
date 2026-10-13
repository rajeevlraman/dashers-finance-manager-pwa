// ============================================================================
// 💰 Dashers Finance Manager - IndexedDB Manager (Enhanced for Property & Tax System)
// ----------------------------------------------------------------------------
// Handles safe initialization, schema upgrades, and CRUD operations
// without version-change race conditions or retry loops.
// ============================================================================

import { DEFAULT_CATEGORIES } from './defaultCategories.js';

// 🔹 Database configuration
const DB_NAME = 'budgetTrackerDB';
const DB_VERSION = 27; // 🆙 27: added budget_templates — named, saveable/loadable sets of budgets
                        // (e.g. "Frugal Month", "Holiday Season") so you can swap your whole
                        // budget setup instead of editing every line by hand (see js/budgets.js).
                        // 26: added vehicles — registration renewal, odometer reading, and driver's
                        // licence tracking, one record per vehicle, optionally linked to a car
                        // insurance policy (see js/vehicles.js).
                        // 25: added insurance_policies — proper policy records (provider, policy
                        // number, coverage type, sum insured, excess, premium, renewal date) distinct
                        // from the old bill-category-based "insurance" tracking.

// 🔹 Centralized object store definitions
export const STORE_NAMES = {
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  budgetTemplates: 'budget_templates', // 📋 Named, saveable/loadable sets of budgets (e.g. "Frugal
                                        // Month") — each record holds a name + a snapshot of budget
                                        // line items (categoryId/amount/frequency/icon), independent
                                        // of the live `budgets` store so loading one replaces your
                                        // current budgets without touching the saved template
  bills: 'bills',
  recurringTransactions: 'recurringTransactions',
  meta: 'meta',
  loans: 'loans',
  loanTransactions: 'loanTransactions',
  properties: 'properties',           // 🏠 Property portfolio
  tenants: 'tenants',                 // 👤 Property tenants
  expenses: 'expenses',               // 📊 Property expenses (from transactions)
  maintenance: 'maintenance',         // 🧰 Property maintenance
  costbase: 'costbase',               // 🧱 Capital improvements & cost base tracking
  taxRecords: 'tax_records',          // 📋 ATO tax compliance records
  propertyExpenseCategories: 'property_expense_categories', // 🏷️ Property expense categories mapping
  subscriptions: 'subscriptions',     // 🔁 Personal subscriptions (Netflix, Adobe, etc.) — distinct from
                                       // recurringTransactions/bills, which are property/account-linked
  superFunds: 'super_funds',                       // 💰 Super funds/members (one record per fund membership)
  superBalanceHistory: 'super_balance_history',    // 📈 Manually-entered balance snapshots per fund
  superContributions: 'super_contributions',       // 🏦 Employer/personal contributions per fund
  superPremiums: 'super_premiums',                 // 🛡️ Insurance premiums held inside each fund — now a
                                                     // deduction schedule (startDate/frequency/active) processed
                                                     // by superRecurringJob.js the same way contributions are
  superFees: 'super_fees',                          // 🧾 Admin/investment/other fees charged inside each fund —
                                                     // same deduction-schedule shape as super_premiums
  superRecurring: 'super_recurring_contributions',  // 🔁 Recurring contribution schedules per fund — auto-generates
                                                     // balance history + contribution entries, optionally compounding
                                                     // an assumed growth rate between contributions (what-if simulation)
  syncTombstones: 'sync_tombstones',   // 🗑️🔄 Deletion records so family sync can propagate deletes
  insurancePolicies: 'insurance_policies', // 🛡️ Insurance policy records (home & contents, landlord, car,
                                           // other) — provider, policy number, coverage, sum insured,
                                           // excess, premium, renewal date; optionally linked to a
                                           // property and/or a bill/recurring entry for payment reminders
  vehicles: 'vehicles' // 🚗 Registration renewal, odometer reading, and driver's licence per vehicle;
                        // optionally linked to a car insurance policy for a combined status view
};

// ----------------------------------------------------------------------------
// 🧠 Utility: Generate unique UUIDs (v4)
// ----------------------------------------------------------------------------
export function generateId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ----------------------------------------------------------------------------
// 🧩 Internal singletons
// ----------------------------------------------------------------------------
let dbInstance = null;
let dbPromise = null; // ensures multiple calls wait for same result

// ----------------------------------------------------------------------------
// 📦 Open Database – handles version upgrades, safe initialization
// ----------------------------------------------------------------------------
export function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // ------------------------------------------------------------------------
    // 🧱 Handle schema creation & upgrade
    // ------------------------------------------------------------------------
    request.onupgradeneeded = event => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      const tx = event.target.transaction;

      upgradeSchema(db, oldVersion, tx);

      // 🌱 Seed data for first-time DBs
      if (oldVersion === 0) {
        seedDemoData(tx);
      }
      
      // 🔄 Seed property expense categories on first creation
      if (oldVersion < 12) {
        seedPropertyExpenseCategories(tx);
      }
    };

    // ------------------------------------------------------------------------
    // ✅ Successfully opened database
    // ------------------------------------------------------------------------
    request.onsuccess = event => {
      dbInstance = event.target.result;
      dbPromise = null;
      resolve(dbInstance);
    };

    // ------------------------------------------------------------------------
    // ❌ Opening failed (permissions, blocked tab, etc.)
    // ------------------------------------------------------------------------
    request.onerror = event => {
      dbPromise = null;
      console.error("❌ DB open failed:", event.target.error);
      reject(event.target.error);
    };

    // ------------------------------------------------------------------------
    // ⚠️ Another tab still using old version
    // ------------------------------------------------------------------------
    request.onblocked = () => {
      console.warn("⚠️ DB upgrade blocked by another open session");
      reject(new Error('Database upgrade blocked'));
    };
  });

  return dbPromise;
}

// ----------------------------------------------------------------------------
// 🧱 Upgrade Schema – Create or migrate object stores
// ----------------------------------------------------------------------------
function upgradeSchema(db, oldVersion, tx) {
  const existingStores = Array.from(db.objectStoreNames);

  // Create any missing stores dynamically (safe on re-upgrade)
  for (const storeName of Object.values(STORE_NAMES)) {
    if (!existingStores.includes(storeName)) {
      const store = db.createObjectStore(storeName, { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });

      // Add any relevant extra indexes
      switch (storeName) {
        case STORE_NAMES.loans:
          store.createIndex('type', 'type', { unique: false });
          break;
          
        case STORE_NAMES.loanTransactions:
          store.createIndex('loanId', 'loanId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          break;
          
        case STORE_NAMES.properties:
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('propertyType', 'propertyType', { unique: false });
          break;
          
        case STORE_NAMES.tenants:
          store.createIndex('propertyId', 'propertyId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          break;
          
        case STORE_NAMES.expenses:
          store.createIndex('propertyId', 'propertyId', { unique: false });
          store.createIndex('transactionId', 'transactionId', { unique: true });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('taxDeductible', 'taxDeductible', { unique: false });
          store.createIndex('financialYear', 'financialYear', { unique: false });
          break;
          
        case STORE_NAMES.maintenance:
          store.createIndex('propertyId', 'propertyId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          break;
          
        case STORE_NAMES.costbase:
          store.createIndex('propertyId', 'propertyId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          break;
          
        case STORE_NAMES.taxRecords:
          store.createIndex('expenseId', 'expenseId', { unique: false });
          store.createIndex('transactionId', 'transactionId', { unique: false });
          store.createIndex('propertyId', 'propertyId', { unique: false });
          store.createIndex('financialYear', 'financialYear', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          break;
          
        case STORE_NAMES.propertyExpenseCategories:
          store.createIndex('categoryName', 'categoryName', { unique: true });
          store.createIndex('deductible', 'deductible', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          break;
          
        case STORE_NAMES.transactions:
          // Enhanced indexes for property expense tracking
          store.createIndex('propertyId', 'propertyId', { unique: false });
          store.createIndex('isPropertyExpense', 'isPropertyExpense', { unique: false });
          store.createIndex('expenseCategory', 'expenseCategory', { unique: false });
          store.createIndex('maintenanceId', 'maintenanceId', { unique: false });
          break;

        case STORE_NAMES.superFunds:
          store.createIndex('member', 'member', { unique: false });
          break;

        case STORE_NAMES.superBalanceHistory:
          store.createIndex('fundId', 'fundId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          break;

        case STORE_NAMES.superContributions:
          store.createIndex('fundId', 'fundId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('financialYear', 'financialYear', { unique: false });
          break;

        case STORE_NAMES.superPremiums:
          store.createIndex('fundId', 'fundId', { unique: false });
          break;

        case STORE_NAMES.superFees:
          store.createIndex('fundId', 'fundId', { unique: false });
          break;

        case STORE_NAMES.superRecurring:
          store.createIndex('fundId', 'fundId', { unique: false });
          store.createIndex('active', 'active', { unique: false });
          break;

        default:
      }
    }
  }

  // Placeholder for future migrations
  if (oldVersion < 10) {
  }

  // Existing super_premiums rows predate scheduling — give them a
  // startDate (today, so nothing backfills unexpectedly) and mark them
  // active so superRecurringJob.js can pick them up going forward.
  if (oldVersion > 0 && oldVersion < 24 && existingStores.includes(STORE_NAMES.superPremiums)) {
    const premiumStore = tx.objectStore(STORE_NAMES.superPremiums);
    const todayStr = new Date().toISOString().slice(0, 10);
    const cursorRequest = premiumStore.openCursor();
    cursorRequest.onsuccess = function(event) {
      const cursor = event.target.result;
      if (cursor) {
        const premium = cursor.value;
        if (!premium.startDate) {
          premium.startDate = todayStr;
          premium.active = premium.active !== false;
          premium.lastProcessed = premium.lastProcessed || null;
          cursor.update(premium);
        }
        cursor.continue();
      }
    };
  }
  
  if (oldVersion < 12) {
    
    // Add isPropertyExpense field to existing transactions
    if (existingStores.includes(STORE_NAMES.transactions)) {
      const transactionStore = tx.objectStore(STORE_NAMES.transactions);
      const cursorRequest = transactionStore.openCursor();
      
      cursorRequest.onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          const transaction = cursor.value;
          // Add missing fields if they don't exist
          if (transaction.propertyId && !transaction.isPropertyExpense) {
            transaction.isPropertyExpense = true;
            transaction.expenseCategory = transaction.expenseCategory || 'Other';
            transaction.expenseStatus = transaction.expenseStatus || 'Paid';
            cursor.update(transaction);
          }
          cursor.continue();
        }
      };
    }
  }
}

// ----------------------------------------------------------------------------
// 🌱 Seed Property Expense Categories
// ----------------------------------------------------------------------------
function seedPropertyExpenseCategories(tx) {
  try {
    const categoriesStore = tx.objectStore(STORE_NAMES.propertyExpenseCategories);
    const now = new Date().toISOString();
    
    const propertyExpenseCategories = [
      {
        id: generateId(),
        categoryName: 'Maintenance',
        defaultCategoryId: 'sub_property_maintenance',
        type: 'immediate',
        deductible: true,
        color: '#3B82F6',
        description: 'Routine maintenance and repairs',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Repairs',
        defaultCategoryId: 'sub_property_maintenance',
        type: 'immediate',
        deductible: true,
        color: '#EF4444',
        description: 'Property repairs and fixes',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Utilities',
        defaultCategoryId: 'sub_electricity',
        type: 'ongoing',
        deductible: true,
        color: '#10B981',
        description: 'Water, electricity, gas for rental property',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Insurance',
        defaultCategoryId: 'sub_landlord_ins',
        type: 'ongoing',
        deductible: true,
        color: '#F59E0B',
        description: 'Property insurance premiums',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Council Rates',
        defaultCategoryId: 'sub_inv_council_rates',
        type: 'ongoing',
        deductible: true,
        color: '#8B5CF6',
        description: 'Local government rates',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Property Management',
        defaultCategoryId: 'sub_property_management',
        type: 'ongoing',
        deductible: true,
        color: '#EC4899',
        description: 'Property management fees',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Loan Interest',
        defaultCategoryId: 'sub_inv_mortgage',
        type: 'ongoing',
        deductible: true,
        color: '#06B6D4',
        description: 'Interest on investment property loans',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Body Corporate',
        defaultCategoryId: 'sub_body_corporate',
        type: 'ongoing',
        deductible: true,
        color: '#84CC16',
        description: 'Strata/body corporate fees',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Capital Improvements',
        defaultCategoryId: 'sub_property_maintenance',
        type: 'capital',
        deductible: false,
        color: '#F97316',
        description: 'Capital works and improvements',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Travel',
        defaultCategoryId: 'sub_travel_food',
        type: 'immediate',
        deductible: false,
        color: '#6366F1',
        description: 'Travel to inspect/manage a residential rental property is not deductible for individuals since 1 July 2017 (narrow exceptions for a formal property business or commercial property)',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Legal Fees',
        defaultCategoryId: 'sub_legal_fees',
        type: 'immediate',
        deductible: true,
        color: '#8B5CF6',
        description: 'Legal and professional fees',
        createdAt: now,
        updatedAt: now
      },
      {
        id: generateId(),
        categoryName: 'Other',
        defaultCategoryId: 'sub_misc_items',
        type: 'other',
        deductible: true,
        color: '#6B7280',
        description: 'Other property expenses',
        createdAt: now,
        updatedAt: now
      }
    ];
    
    propertyExpenseCategories.forEach(cat => {
      categoriesStore.put(cat);
    });
    
  } catch (err) {
    console.error("❌ Error seeding property expense categories:", err);
  }
}

// ----------------------------------------------------------------------------
// 🌱 Seed Default Categories (runs only once on new DB creation)
// ----------------------------------------------------------------------------
// This used to also insert two demo accounts ("Bank Account" $1,000 and
// "Wallet" $200, both USD) and two demo properties ("Family Home" and
// "Investment Apartment"). Those were initial test data: they showed up
// on top of a real person's own accounts/properties whenever the browser
// handed the app a fresh database (and inflated net worth with made-up
// property values). Only the category list is seeded now — the app needs
// it to function; accounts and properties are left for the person to add
// (the Accounts page has an "Add Defaults" button).
function seedDemoData(tx) {
  try {
    const categoriesStore = tx.objectStore(STORE_NAMES.categories);
    const now = new Date().toISOString();

    // Demo categories — seeded from the same simplified taxonomy that
    // defaultCategories.js uses everywhere else in the app. This used to be
    // its own hand-maintained 6-entry list that had drifted out of sync
    // with the real category set (still using the old exp_/ms_ ids), which
    // meant a brand-new install got a completely different, much smaller
    // category list than an existing one that ran the Categories page's
    // "Reset to Defaults". Using DEFAULT_CATEGORIES directly means there's
    // only one place the category list is defined.
    const categories = DEFAULT_CATEGORIES.map(c => ({
      ...c,
      createdAt: now,
      updatedAt: now
    }));

    categories.forEach(cat => categoriesStore.add(cat));

  } catch (err) {
    console.error("❌ Error seeding default categories:", err);
  }
}

// ----------------------------------------------------------------------------
// 🧹 Remove leftover demo accounts from earlier builds
// ----------------------------------------------------------------------------
// Deletes an account ONLY when all of these hold:
//   - it is exactly one of the old seed accounts (name + type + USD +
//     the original $1,000 / $200 opening balance),
//   - the person has other accounts (never strips someone down to nothing),
//   - no transaction, bill, recurring item, loan or expense references it
//     (any string field on those records equal to the account's id).
// Anything that has been used, renamed or edited is left alone. Returns the
// number removed.
export async function removeLeftoverDemoAccounts() {
  const accounts = await getAllItems(STORE_NAMES.accounts);
  const isSeed = a =>
    a.currency === 'USD' &&
    ((a.name === 'Bank Account' && a.type === 'bank' && Number(a.openingBalance) === 1000) ||
     (a.name === 'Wallet' && a.type === 'cash' && Number(a.openingBalance) === 200));
  const candidates = accounts.filter(isSeed);
  if (candidates.length === 0 || accounts.length === candidates.length) return 0;

  const ids = new Set(candidates.map(a => a.id));
  const referencing = await Promise.all([
    STORE_NAMES.transactions, STORE_NAMES.bills, STORE_NAMES.recurringTransactions,
    STORE_NAMES.loans, STORE_NAMES.expenses
  ].map(name => getAllItems(name).catch(() => [])));
  const used = new Set();
  referencing.flat().forEach(record => {
    Object.values(record || {}).forEach(v => { if (typeof v === 'string' && ids.has(v)) used.add(v); });
  });

  let removed = 0;
  for (const acc of candidates) {
    if (used.has(acc.id)) continue;
    await deleteItem(STORE_NAMES.accounts, acc.id);
    removed++;
  }
  if (removed > 0) console.info(`[db] Removed ${removed} unused demo account(s) left over from earlier builds`);
  return removed;
}

// ----------------------------------------------------------------------------
// 📖 getStore() – Retrieve a store in a new transaction
// ----------------------------------------------------------------------------
function getStore(storeName, mode = 'readonly') {
  return openDb().then(db => {
    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`❌ Store "${storeName}" not found in DB.`);
    }
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  });
}

// ----------------------------------------------------------------------------
// ✏️ CRUD Operations – Add / Update / Delete / Fetch
// ----------------------------------------------------------------------------
export async function addItem(storeName, item) {
  const store = await getStore(storeName, 'readwrite');
  if (!item.id) item.id = generateId();
  const now = new Date().toISOString();
  item.createdAt = item.createdAt || now;
  item.updatedAt = now;

  return new Promise((resolve, reject) => {
    const req = store.add(item);
    req.onsuccess = () => resolve(item);
    req.onerror = e => reject(e.target.error);
  });
}

export async function updateItem(storeName, item) {
  const store = await getStore(storeName, 'readwrite');
  item.updatedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = e => reject(e.target.error);
  });
}

// Records that a record was deleted so family sync (see js/familySync.js) can
// propagate the deletion to other devices — a plain IndexedDB delete leaves
// no trace once it succeeds, so without this, deleted records would just
// silently reappear on the next sync pull from another device.
async function recordTombstone(storeName, id) {
  if (storeName === STORE_NAMES.syncTombstones) return; // avoid recursion
  try {
    const store = await getStore(STORE_NAMES.syncTombstones, 'readwrite');
    store.put({
      id: `${storeName}:${id}`,
      storeName,
      recordId: id,
      deletedAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn('⚠️ Could not record sync tombstone (deletion will still work locally):', err);
  }
}

// Used only by js/familySync.js when applying records pulled from the
// family server: a normal updateItem()/addItem() always stamps `updatedAt`
// with the current local time, which would break sync's last-write-wins
// comparison (a freshly-pulled record would look "newer" than the server's
// own copy on the very next sync). This preserves whatever timestamp the
// incoming record already has.
export async function putRawItem(storeName, item) {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = e => reject(e.target.error);
  });
}

// Used only by js/familySync.js when the current user's permitted sections
// change and a store they can no longer see needs to be wiped from this
// device. Deliberately does NOT record tombstones or cascade — the data
// still exists on the server (and for other family members); this is only
// removing this device's local copy.
export async function clearStoreLocal(storeName) {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

// Bulk-delete transactions in ONE database transaction (fast for thousands of
// rows) and record a sync tombstone for each so family sync removes them on
// other devices too. Unlike deleteItem(), this deliberately does NOT cascade
// into property expenses / tax records: the point is a clean slate for
// transactions while every other record stays exactly as it is.
// accountId: only that account's transactions; omit/null for all of them.
export async function deleteTransactionsBulk(accountId = null, options = {}) {
  const valid = options.orphansOnly ? new Set(options.validAccountIds || []) : null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAMES.transactions, STORE_NAMES.syncTombstones], 'readwrite');
    const txStore = tx.objectStore(STORE_NAMES.transactions);
    const tombStore = tx.objectStore(STORE_NAMES.syncTombstones);
    const now = new Date().toISOString();
    let removed = 0;
    const cursorReq = txStore.openCursor();
    cursorReq.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;
      const row = cursor.value;
      const hit = valid ? !valid.has(row.accountId) : (!accountId || row.accountId === accountId);
      if (hit) {
        tombStore.put({
          id: `${STORE_NAMES.transactions}:${row.id}`,
          storeName: STORE_NAMES.transactions,
          recordId: row.id,
          deletedAt: now
        });
        cursor.delete();
        removed++;
      }
      cursor.continue();
    };
    cursorReq.onerror = e => reject(e.target.error);
    tx.oncomplete = () => resolve(removed);
    tx.onerror = e => reject(e.target.error);
    tx.onabort = e => reject(e.target.error || new Error('Delete aborted'));
  });
}

// Property expense / tax records that were CREATED FROM a transaction carry
// that transaction's id (`transactionId`). When the transaction is gone they
// are left behind ("orphans"). Records entered directly on the property pages
// have no transactionId and are never reported here.
export async function findOrphanedTransactionRecords() {
  const [txs, expenses, taxRecords] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.expenses).catch(() => []),
    getAllItems(STORE_NAMES.taxRecords).catch(() => [])
  ]);
  const live = new Set(txs.map(t => t.id));
  const orphan = r => r && r.transactionId && !live.has(r.transactionId);
  const directExpenses = expenses.filter(e => !e.transactionId).length;
  return {
    expenses: expenses.filter(orphan),
    taxRecords: taxRecords.filter(orphan),
    directExpensesKept: directExpenses
  };
}

// Delete the given ids from one store in a single transaction, with sync
// tombstones. No cascade.
export async function deleteRecordsBulk(storeName, ids) {
  if (!ids.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, STORE_NAMES.syncTombstones], 'readwrite');
    const store = tx.objectStore(storeName);
    const tombs = tx.objectStore(STORE_NAMES.syncTombstones);
    const now = new Date().toISOString();
    ids.forEach(id => {
      store.delete(id);
      tombs.put({ id: `${storeName}:${id}`, storeName, recordId: id, deletedAt: now });
    });
    tx.oncomplete = () => resolve(ids.length);
    tx.onerror = e => reject(e.target.error);
    tx.onabort = e => reject(e.target.error || new Error('Delete aborted'));
  });
}

export async function deleteItem(storeName, id, options = {}) {
  const store = await getStore(storeName, 'readwrite');

  return new Promise(async (resolve, reject) => {
    const req = store.delete(id);

    req.onsuccess = async () => {
      if (!options.skipTombstone) {
        await recordTombstone(storeName, id);
      }

      // 🔄 Cascade cleanup if deleting a property
      // (Cascade-deleted children below don't need their own tombstones:
      // when another device pulls the property's tombstone, it re-runs
      // deleteItem() for that property locally too, which re-triggers this
      // exact same cascade on that device.)
      if (storeName === STORE_NAMES.properties) {
        const db = await openDb();

        // Delete all tenants linked to this property
        const tenantTx = db.transaction(STORE_NAMES.tenants, 'readwrite');
        const tenantStore = tenantTx.objectStore(STORE_NAMES.tenants);
        const tenantIndex = tenantStore.index('propertyId');
        const tenantReq = tenantIndex.getAll(id);

        tenantReq.onsuccess = () => {
          tenantReq.result.forEach(t => tenantStore.delete(t.id));
        };

        // Delete all maintenance linked to this property
        const maintTx = db.transaction(STORE_NAMES.maintenance, 'readwrite');
        const maintStore = maintTx.objectStore(STORE_NAMES.maintenance);
        const maintIndex = maintStore.index('propertyId');
        const maintReq = maintIndex.getAll(id);

        maintReq.onsuccess = () => {
          maintReq.result.forEach(m => maintStore.delete(m.id));
        };
        
        // Delete all expenses linked to this property
        const expenseTx = db.transaction(STORE_NAMES.expenses, 'readwrite');
        const expenseStore = expenseTx.objectStore(STORE_NAMES.expenses);
        const expenseIndex = expenseStore.index('propertyId');
        const expenseReq = expenseIndex.getAll(id);
        
        expenseReq.onsuccess = () => {
          expenseReq.result.forEach(e => expenseStore.delete(e.id));
        };
        
        // Delete all costbase items linked to this property
        const costbaseTx = db.transaction(STORE_NAMES.costbase, 'readwrite');
        const costbaseStore = costbaseTx.objectStore(STORE_NAMES.costbase);
        const costbaseIndex = costbaseStore.index('propertyId');
        const costbaseReq = costbaseIndex.getAll(id);
        
        costbaseReq.onsuccess = () => {
          costbaseReq.result.forEach(c => costbaseStore.delete(c.id));
        };
        
        // Delete all tax records linked to this property
        const taxTx = db.transaction(STORE_NAMES.taxRecords, 'readwrite');
        const taxStore = taxTx.objectStore(STORE_NAMES.taxRecords);
        const taxIndex = taxStore.index('propertyId');
        const taxReq = taxIndex.getAll(id);
        
        taxReq.onsuccess = () => {
          taxReq.result.forEach(t => taxStore.delete(t.id));
        };
      }
      
      // 🔄 Cascade cleanup if deleting a transaction
      if (storeName === STORE_NAMES.transactions) {
        const db = await openDb();
        
        // Delete linked expense
        const expenseTx = db.transaction(STORE_NAMES.expenses, 'readwrite');
        const expenseStore = expenseTx.objectStore(STORE_NAMES.expenses);
        const expenseIndex = expenseStore.index('transactionId');
        const expenseReq = expenseIndex.get(id);
        
        expenseReq.onsuccess = () => {
          if (expenseReq.result) {
            expenseStore.delete(expenseReq.result.id);
          }
        };
        
        // Delete linked tax record
        const taxTx = db.transaction(STORE_NAMES.taxRecords, 'readwrite');
        const taxStore = taxTx.objectStore(STORE_NAMES.taxRecords);
        const taxIndex = taxStore.index('transactionId');
        const taxReq = taxIndex.get(id);
        
        taxReq.onsuccess = () => {
          if (taxReq.result) {
            taxStore.delete(taxReq.result.id);
          }
        };
      }
      
      // 🔄 Cascade cleanup if deleting an expense
      if (storeName === STORE_NAMES.expenses) {
        const db = await openDb();
        
        // Delete linked tax record
        const taxTx = db.transaction(STORE_NAMES.taxRecords, 'readwrite');
        const taxStore = taxTx.objectStore(STORE_NAMES.taxRecords);
        const taxIndex = taxStore.index('expenseId');
        const taxReq = taxIndex.get(id);
        
        taxReq.onsuccess = () => {
          if (taxReq.result) {
            taxStore.delete(taxReq.result.id);
          }
        };
      }

      resolve();
    };

    req.onerror = e => reject(e.target.error);
  });
}

export async function getAllItems(storeName) {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

// ----------------------------------------------------------------------------
// 🔍 Advanced Query Functions
// ----------------------------------------------------------------------------
export async function getItemsByIndex(storeName, indexName, value) {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function getItemByIndex(storeName, indexName, value) {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const index = store.index(indexName);
    const req = index.get(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function getPropertyExpenses(propertyId) {
  return getItemsByIndex(STORE_NAMES.expenses, 'propertyId', propertyId);
}

export async function getTaxRecordsByFinancialYear(financialYear) {
  return getItemsByIndex(STORE_NAMES.taxRecords, 'financialYear', financialYear);
}

export async function getPropertyTransactions(propertyId) {
  return getItemsByIndex(STORE_NAMES.transactions, 'propertyId', propertyId);
}

export async function getPropertyMaintenance(propertyId) {
  return getItemsByIndex(STORE_NAMES.maintenance, 'propertyId', propertyId);
}

export async function getSuperBalanceHistory(fundId) {
  return getItemsByIndex(STORE_NAMES.superBalanceHistory, 'fundId', fundId);
}

export async function getSuperContributions(fundId) {
  return getItemsByIndex(STORE_NAMES.superContributions, 'fundId', fundId);
}

export async function getSuperPremiums(fundId) {
  return getItemsByIndex(STORE_NAMES.superPremiums, 'fundId', fundId);
}

// ----------------------------------------------------------------------------
// 📊 Financial Year Calculations
// ----------------------------------------------------------------------------
// Tombstones recorded since a given ISO timestamp — used by js/familySync.js
// to know what's been deleted locally since the last sync.
export async function getTombstonesSince(sinceIso) {
  const all = await getAllItems(STORE_NAMES.syncTombstones);
  if (!sinceIso) return all;
  return all.filter(t => t.deletedAt > sinceIso);
}

export function getFinancialYear(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  
  // Australian financial year: July 1 to June 30
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function getCurrentFinancialYear() {
  const now = new Date();
  return getFinancialYear(now.toISOString());
}

// ----------------------------------------------------------------------------
// 💰 Property Expense Calculations
// ----------------------------------------------------------------------------
export async function getPropertyExpenseSummary(propertyId, financialYear = null) {
  const expenses = await getPropertyExpenses(propertyId);
  
  let filteredExpenses = expenses;
  if (financialYear) {
    filteredExpenses = expenses.filter(e => e.financialYear === financialYear);
  }
  
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const deductibleExpenses = filteredExpenses
    .filter(e => e.taxDeductible)
    .reduce((sum, e) => sum + e.amount, 0);
  
  const byCategory = filteredExpenses.reduce((acc, expense) => {
    acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
    return acc;
  }, {});
  
  const byMonth = filteredExpenses.reduce((acc, expense) => {
    const date = new Date(expense.date);
    const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    acc[monthYear] = (acc[monthYear] || 0) + expense.amount;
    return acc;
  }, {});
  
  return {
    totalExpenses,
    deductibleExpenses,
    nonDeductibleExpenses: totalExpenses - deductibleExpenses,
    expenseCount: filteredExpenses.length,
    byCategory,
    byMonth
  };
}

// ----------------------------------------------------------------------------
// 🧹 clearAllData() – Wipe every store (use for "Reset" or import restore)
// ----------------------------------------------------------------------------
export async function clearAllData() {
  const db = await openDb();
  const promises = Object.values(STORE_NAMES).map(storeName => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  });
  return Promise.all(promises);
}

// ----------------------------------------------------------------------------
// 📤 exportAllData() – Backup to JSON (for manual sync/export)
// ----------------------------------------------------------------------------
export async function exportAllData() {
  const db = await openDb();
  const exportData = {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    stores: {}
  };

  for (const storeName of Object.values(STORE_NAMES)) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    exportData.stores[storeName] = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  return exportData;
}

// ----------------------------------------------------------------------------
// 📥 importAllData() – Restore from backup JSON
// ----------------------------------------------------------------------------
export async function importAllData(data) {
  const db = await openDb();

  // Clear existing data first
  await clearAllData();

  // Import new data
  for (const [storeName, items] of Object.entries(data.stores || data)) {
    if (!Object.values(STORE_NAMES).includes(storeName)) continue;
    
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    
    for (const item of items) {
      // Ensure items have required fields
      if (!item.id) item.id = generateId();
      const now = new Date().toISOString();
      item.createdAt = item.createdAt || now;
      item.updatedAt = item.updatedAt || now;
      
      store.put(item);
    }
  }

}

// ----------------------------------------------------------------------------
// 📊 Get Database Stats
// ----------------------------------------------------------------------------
export async function getDatabaseStats() {
  const stats = {};
  
  for (const storeName of Object.values(STORE_NAMES)) {
    const items = await getAllItems(storeName);
    stats[storeName] = {
      count: items.length,
      lastUpdated: items.length > 0 
        ? new Date(Math.max(...items.map(i => new Date(i.updatedAt || i.createdAt || 0).getTime())))
        : null
    };
  }
  
  return stats;
}