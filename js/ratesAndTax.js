// ratesAndTax.js
//
// Council Rates and Land Tax entries can end up in three different
// stores depending on how they were recorded:
//
//   1. `expenses` — direct entries made on the Expenses page, or a
//      transaction that was explicitly synced there (see
//      transactions.js's syncToExpenses(), called from the manual
//      Transactions-page save flow, and from bills.js's markBillPaid()
//      for bills paid against a linked property).
//   2. `transactions` — every bank-imported or manually-entered
//      transaction that resolved to the Council Rates / Land Tax
//      category, whether or not it was ever synced into `expenses`, and
//      whether or not the import pipeline managed to auto-match a
//      property for it (see import/saver.js: property matching is
//      best-effort — most Council Rates/Land Tax bank transactions come
//      through with the right categoryId but no propertyId at all,
//      because nothing about a BPAY reference number tells the import
//      which of your properties it's for).
//   3. `bills` — an unpaid bill never produces a transaction at all (see
//      markBillPaid in bills.js), so it has no representation in either
//      of the stores above until it's actually paid. This is the only
//      source of "money owed but not yet paid" for rates/land tax.
//
// Anything paid before the markBillPaid() sync fix, any auto-imported
// transaction nobody opened and re-saved by hand, and any correctly-
// categorized bank transaction the importer couldn't confidently link to
// a property all only live in `transactions`, so reading `expenses`
// alone under-counts history. This merges all three, normalizing
// transaction- and bill-derived rows into the same shape as an
// `expenses` record, and de-duplicates transactions against `expenses`
// by transaction id so a bill payment that DOES have a synced `expenses`
// copy isn't counted twice. A bill itself needs no such de-duplication:
// it's either paid (and so already covered by its resulting transaction
// above) or unpaid (and so only ever represented here) — never both.
//
// Deliberately NOT required here: isPropertyExpense / propertyId. Those
// flags only get set when the importer found a confident property match
// (see import/saver.js), so requiring them would silently drop every
// correctly-categorized Council Rates/Land Tax transaction that simply
// isn't linked to a property yet — which, in practice, is most of them.
// The category itself (Council Rates vs Land Tax) is a strong enough
// signal on its own for the account-wide Finance Overview total; it's
// only the per-property breakdown (getRatesAndTaxEntriesForProperty)
// that needs propertyId, and unlinked entries correctly fall out of that
// one until the transaction/bill is linked to a property.
import { getExpenseCategoryBucket } from './propertyExpenseCategories.js';

const RATES_AND_TAX_BUCKETS = new Set(['Council Rates', 'Land Tax']);

function transactionToEntry(tx, bucket) {
  return {
    id: `tx:${tx.id}`,
    transactionId: tx.id,
    propertyId: tx.propertyId || '',
    category: bucket,
    amount: Math.abs(parseFloat(tx.amount) || 0),
    date: tx.date,
    status: tx.expenseStatus || 'Paid',
    description: tx.description || '',
    source: 'transaction'
  };
}

function billToEntry(bill, bucket) {
  return {
    id: `bill:${bill.id}`,
    billId: bill.id,
    propertyId: bill.propertyId || '',
    category: bucket,
    amount: Math.abs(parseFloat(bill.amount) || 0),
    // Bills only carry a single dueDate (recurring ones roll forward to
    // their next due date in place rather than keeping past instances -
    // see bills.js's markBillPaid), so this is always the *upcoming*
    // amount, not a paid-history record.
    date: bill.dueDate,
    status: 'Unpaid',
    description: bill.name || '',
    source: 'bill'
  };
}

// Returns every Council Rates / Land Tax entry across `expenses`,
// `transactions`, and unpaid `bills`, merged and de-duplicated, in the
// same shape as an `expenses` record
// ({ propertyId, category, amount, date, status, ... }).
// Pass the arrays you've already loaded — this does no fetching itself.
export function getRatesAndTaxEntries({ expenses, transactions, bills }) {
  const directEntries = (expenses || []).filter(e => RATES_AND_TAX_BUCKETS.has(e.category));

  // A transaction already represented by a synced `expenses` row (matched
  // by the transactionId that syncToExpenses() stamps on it) is skipped
  // here so it isn't counted a second time.
  const syncedTransactionIds = new Set(
    directEntries.filter(e => e.transactionId).map(e => e.transactionId)
  );

  const derivedEntries = (transactions || [])
    .filter(tx => tx.type === 'expense' && !tx.isTransfer && !syncedTransactionIds.has(tx.id))
    .map(tx => {
      // Anything auto-flagged as a property expense already carries
      // expenseCategory (see import/saver.js and the markBillPaid() fix).
      // Everything else — most bank-imported rates/land-tax transactions,
      // which resolved to the right categoryId but never got linked to a
      // property — falls back to the same bucket mapping everything else
      // uses.
      const bucket = RATES_AND_TAX_BUCKETS.has(tx.expenseCategory)
        ? tx.expenseCategory
        : getExpenseCategoryBucket(tx.categoryId);
      return { tx, bucket };
    })
    .filter(({ bucket }) => RATES_AND_TAX_BUCKETS.has(bucket))
    .map(({ tx, bucket }) => transactionToEntry(tx, bucket));

  // Unpaid bills never produce a transaction (markBillPaid() only creates
  // one once you actually pay it), so they'd otherwise be invisible here
  // entirely - there's no "unpaid" version of a transaction or expenses
  // row to fall back on. A *paid* bill is already fully covered by the
  // transaction/expenses paths above, so only unpaid ones are added here -
  // no dedup needed, a bill is either one or the other, never both.
  const billEntries = (bills || [])
    .filter(bill => !bill.paid)
    .map(bill => ({ bill, bucket: getExpenseCategoryBucket(bill.categoryId) }))
    .filter(({ bucket }) => RATES_AND_TAX_BUCKETS.has(bucket))
    .map(({ bill, bucket }) => billToEntry(bill, bucket));

  return [...directEntries, ...derivedEntries, ...billEntries];
}

// Convenience wrapper for a single property (used by properties.js). Only
// entries actually linked to this property (propertyId set on the
// transaction/bill, or on the direct expenses entry) are included — an
// unlinked bank transaction or bill correctly won't show under any
// property until it's linked to one, even though it already counts
// toward the account-wide total above.
export function getRatesAndTaxEntriesForProperty(propertyId, { expenses, transactions, bills }) {
  return getRatesAndTaxEntries({ expenses, transactions, bills }).filter(e => e.propertyId === propertyId);
}


