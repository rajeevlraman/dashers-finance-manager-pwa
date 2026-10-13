// ============================================================================
// recurringMatch.js — reconcile recurring rules / bills with real bank rows
// ----------------------------------------------------------------------------
// Every payment ends up on a bank statement. A recurring rule or bill that
// also auto-generates its own transaction would therefore double-count: one
// generated row plus one imported row for the same payment. These helpers let
// the job and the importer recognise "that's the same payment" so only ONE
// transaction survives, carrying the rule's category and the bank's details.
//
// A match needs the same account, the same direction (in/out), an amount within
// 2% (or 1 cent), and a date within 3 days of the due date. Pure functions, no
// database access.
// ============================================================================

export const MATCH_DAY_WINDOW = 3;
export const MATCH_AMOUNT_TOLERANCE = 0.02;

export function isUncategorised(categoryId) {
  return !categoryId || /uncategori[sz]ed/i.test(String(categoryId));
}

export function dayGap(a, b) {
  const pa = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const pb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (isNaN(pa) || isNaN(pb)) return Infinity;
  return Math.abs(Math.round((pa - pb) / 86400000));
}

export function amountsMatch(a, b) {
  const x = Math.abs(Number(a) || 0);
  const y = Math.abs(Number(b) || 0);
  if (!x || !y) return false;
  return Math.abs(x - y) <= Math.max(0.01, y * MATCH_AMOUNT_TOLERANCE);
}

const signOf = (type, amount) => (type ? (type === 'income' ? 1 : -1) : Math.sign(Number(amount) || 0));

function closest(cands, date) {
  return cands.sort((p, q) => dayGap(p.date, date) - dayGap(q.date, date))[0] || null;
}

// A real (bank-imported / hand-entered) transaction that already covers a
// scheduled payment. `due` = { accountId, type: 'income'|'expense', amount, dueDate }.
export function findRealTransactionFor(due, transactions) {
  const sign = signOf(due.type, null);
  return closest((transactions || []).filter(t =>
    !t.recurringId && !t.billId && !t.isTransfer && !t.reconciled &&
    t.accountId === due.accountId &&
    Math.sign(Number(t.amount) || 0) === sign &&
    amountsMatch(t.amount, due.amount) &&
    dayGap(t.date, due.dueDate) <= MATCH_DAY_WINDOW
  ), due.dueDate);
}

// A loan payment is also entered in the Loans page, which creates both a
// loan-ledger row and an expense transaction. If the bank statement arrives
// first, the loan workflow must adopt that imported row rather than create a
// second expense. Only consider unmistakably imported, unlinked expense rows.
// Ties are reported as ambiguous instead of guessing between same-day charges.
export function findRealLoanPaymentFor(due, transactions) {
  const amount = Math.abs(Number(due?.amount) || 0);
  if (!due?.accountId || !due?.dueDate || !amount) return { status: 'none', transaction: null };

  let candidates = (transactions || []).filter(t =>
    !t.recurringId && !t.billId && !t.loanId && !t.loanTransactionId &&
    !t.isTransfer && !t.reconciled &&
    t.accountId === due.accountId &&
    t.type === 'expense' &&
    Math.sign(Number(t.amount) || 0) === -1 &&
    amountsMatch(t.amount, amount) &&
    dayGap(t.date, due.dueDate) <= MATCH_DAY_WINDOW &&
    !!(String(t.rawDescription || '').trim() || String(t.source || '').trim() ||
      t.originalLine !== undefined || String(t.reference || '').trim())
  );

  if (!candidates.length) return { status: 'none', transaction: null };

  // A matching loan category is a stronger signal than amount/date alone.
  if (due.categoryId) {
    const categoryMatches = candidates.filter(t => t.categoryId === due.categoryId);
    if (categoryMatches.length === 1) return { status: 'match', transaction: categoryMatches[0] };
    if (categoryMatches.length > 1) candidates = categoryMatches;
  }

  const ranked = candidates
    .map(transaction => ({
      transaction,
      days: dayGap(transaction.date, due.dueDate),
      cents: Math.round(Math.abs(Math.abs(Number(transaction.amount)) - amount) * 100)
    }))
    .sort((a, b) => a.days - b.days || a.cents - b.cents);

  if (ranked.length > 1 &&
      ranked[0].days === ranked[1].days &&
      ranked[0].cents === ranked[1].cents) {
    return { status: 'ambiguous', transaction: null, candidates: ranked.map(x => x.transaction) };
  }
  return { status: 'match', transaction: ranked[0].transaction };
}

// Prevent a second "Make Payment" or recurring run from recording a loan
// payment that is already linked to the same loan.
export function findRecordedLoanPaymentFor(due, transactions) {
  const amount = Math.abs(Number(due?.amount) || 0);
  if (!due?.loanId || !due?.accountId || !due?.dueDate || !amount) {
    return { status: 'none', transaction: null };
  }
  const candidates = (transactions || []).filter(t =>
    t.loanId === due.loanId &&
    t.accountId === due.accountId &&
    !t.isTransfer &&
    Math.sign(Number(t.amount) || 0) === -1 &&
    amountsMatch(t.amount, amount) &&
    dayGap(t.date, due.dueDate) <= MATCH_DAY_WINDOW
  );
  if (!candidates.length) return { status: 'none', transaction: null };
  const ranked = candidates
    .map(transaction => ({
      transaction,
      days: dayGap(transaction.date, due.dueDate),
      cents: Math.round(Math.abs(Math.abs(Number(transaction.amount)) - amount) * 100)
    }))
    .sort((a, b) => a.days - b.days || a.cents - b.cents);
  if (ranked.length > 1 &&
      ranked[0].days === ranked[1].days &&
      ranked[0].cents === ranked[1].cents) {
    return { status: 'ambiguous', transaction: null, candidates: ranked.map(x => x.transaction) };
  }
  return { status: 'match', transaction: ranked[0].transaction };
}

// A previously GENERATED transaction (from a recurring rule or bill) that an
// incoming imported row is really the same payment as.
export function findGeneratedTransactionFor(imported, transactions) {
  const sign = Math.sign(Number(imported.amount) || 0);
  return closest((transactions || []).filter(t =>
    (t.recurringId || t.billId || t.loanId || t.loanTransactionId) && !t.isTransfer && !t.reconciled &&
    t.accountId === imported.accountId &&
    Math.sign(Number(t.amount) || 0) === sign &&
    amountsMatch(t.amount, imported.amount) &&
    dayGap(t.date, imported.date) <= MATCH_DAY_WINDOW
  ), imported.date);
}

// Compatibility path for loan payments saved by older app versions before
// ordinary transaction rows carried loanId/loanTransactionId. Match only
// when the ledger row and its paired expense transaction form one clear pair.
export function findLegacyLoanPaymentFor(imported, loanPayments, transactions) {
  const payments = (loanPayments || []).filter(payment =>
    !payment.reconciled &&
    payment.fromAccountId === imported.accountId &&
    amountsMatch(payment.amount, imported.amount) &&
    dayGap(payment.date, imported.date) <= MATCH_DAY_WINDOW
  );

  const pairs = [];
  for (const payment of payments) {
    const expectedDescription = String(payment.description || '').trim().toLowerCase();
    const matches = (transactions || []).filter(t =>
      !t.loanId && !t.loanTransactionId && !t.recurringId && !t.billId &&
      !t.isTransfer && !t.reconciled &&
      t.accountId === imported.accountId &&
      Math.sign(Number(t.amount) || 0) === Math.sign(Number(imported.amount) || 0) &&
      amountsMatch(t.amount, imported.amount) &&
      dayGap(t.date, imported.date) <= MATCH_DAY_WINDOW &&
      ((payment.transactionId && t.id === payment.transactionId) ||
       (expectedDescription && String(t.description || '').trim().toLowerCase() === expectedDescription))
    );
    if (matches.length === 1) pairs.push({ transaction: matches[0], loanPayment: payment });
  }

  return pairs.length === 1 ? pairs[0] : null;
}
