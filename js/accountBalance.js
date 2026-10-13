// accountBalance.js
//
// Single source of truth for account balances.
//
// Previously `account.balance` was a static number the person typed in on
// the Accounts page and nothing else in the app ever changed it — importing
// a bank statement, adding a transaction, paying a bill, or making a loan
// payment all left it untouched. That meant Accounts showed a snapshot from
// whenever it was last manually edited, completely disconnected from the
// actual transaction history.
//
// Now `account.openingBalance` represents the balance *before* any tracked
// transactions, and the live balance is always calculated as:
//
//     openingBalance + sum of every transaction with that accountId
//
// This works for both regular accounts (positive = money you have) and
// credit cards (negative = money you owe) because expense amounts are
// already stored as negative numbers throughout the app — a card purchase
// (negative amount) makes a credit account's balance more negative (owe
// more), and a payment onto the card (positive amount) makes it less
// negative (owe less), with no special-casing needed.

export function computeAccountBalance(account, transactions) {
  const opening = account.openingBalance ?? account.balance ?? 0;
  const txTotal = transactions
    .filter(t => t.accountId === account.id)
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
  return opening + txTotal;
}

// Same as computeAccountBalance, but only counts transactions dated on or
// before asOfDateStr (a "YYYY-MM-DD" string) — i.e. "what did this account
// owe/hold as of the close of business on this date", rather than always
// the live-right-now figure. Used for statement-cycle balances (see
// quickLook.js's credit card month selector): a repayment made mid-cycle
// is a transaction on the account like any other, so it's automatically
// netted in correctly for any cycle whose end date is on or after it —
// no separate repayment-tracking logic needed.
export function computeAccountBalanceAsOf(account, transactions, asOfDateStr) {
  const opening = account.openingBalance ?? account.balance ?? 0;
  const txTotal = transactions
    .filter(t => t.accountId === account.id && t.date && t.date <= asOfDateStr)
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
  return opening + txTotal;
}

export function computeAllAccountBalances(accounts, transactions) {
  const map = {};
  for (const acc of accounts) {
    map[acc.id] = computeAccountBalance(acc, transactions);
  }
  return map;
}

// One-time migration: accounts created before this change only have
// `.balance` (which the person was manually keeping current, transactions
// and all). To avoid the balance visibly jumping the moment this ships, we
// back-calculate an opening balance such that
// openingBalance + sum(existing transactions so far) === the balance they
// last saw. From that point on, `openingBalance` is fixed and every new
// transaction naturally moves the live balance — no more manual upkeep.
//
// Returns the updated account list (accounts that already had an
// openingBalance are returned unchanged) and whether anything changed.
export function migrateAccountsToOpeningBalance(accounts, transactions) {
  let changed = false;
  const migrated = accounts.map(acc => {
    if (acc.openingBalance !== undefined && acc.openingBalance !== null) {
      return acc; // already migrated
    }
    const existingTxTotal = transactions
      .filter(t => t.accountId === acc.id)
      .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    changed = true;
    return {
      ...acc,
      openingBalance: (parseFloat(acc.balance) || 0) - existingTxTotal
    };
  });
  return { accounts: migrated, changed };
}
