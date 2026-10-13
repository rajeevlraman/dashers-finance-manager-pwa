// ============================================================================
// 🏦 loans.js — Enhanced Loans Module with Interest-Only Support
// ============================================================================

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId } from './db.js';
import { getGatedItems } from './features.js';
import { calculateAmortizationSchedule, calculatePaymentAmount, calculateTotalInterest, calculateHistoricalSchedule, getCurrentRate, getRateForDate, calculateMinimumRepayment } from './loanCalculations.js';
import { escapeHtml } from './sanitize.js';
import { computeAccountBalance } from './accountBalance.js';
import { institutionOptions, institutionDisplayName, renderInstitutionMark, pseudoLast4 } from './institutions.js';
import { renderLoanWhatIfHTML, attachLoanWhatIfBehavior } from './loanWhatIf.js';
import { amountsMatch, dayGap, findRealLoanPaymentFor, findRecordedLoanPaymentFor, isUncategorised } from './recurringMatch.js';

import { formatMoney, stampAud, toBase } from './utils/currency.js';
// ============================================================================
// 🔹 Default Demo Loans
// ============================================================================
const DEFAULT_LOANS = [
  { 
    id: 'loan1', 
    name: 'Home Mortgage', 
    type: 'mortgage', 
    originalAmount: 300000, 
    currentBalance: 300000, 
    interestRate: 4.5, 
    currency: 'AUD', 
    startDate: new Date().toISOString().split('T')[0], 
    termMonths: 360, 
    paymentFrequency: 'monthly',
    icon: '🏠'
  },
  { 
    id: 'loan2', 
    name: 'Car Loan', 
    type: 'vehicle', 
    originalAmount: 25000, 
    currentBalance: 25000, 
    interestRate: 6.2, 
    currency: 'AUD', 
    startDate: new Date().toISOString().split('T')[0], 
    termMonths: 60, 
    paymentFrequency: 'monthly',
    icon: '🚗'
  },
  { 
    id: 'loan3', 
    name: 'Personal Loan', 
    type: 'personal', 
    originalAmount: 10000, 
    currentBalance: 10000, 
    interestRate: 8.0, 
    currency: 'AUD', 
    startDate: new Date().toISOString().split('T')[0], 
    termMonths: 36, 
    paymentFrequency: 'monthly',
    icon: '👤'
  },
  { 
    id: 'loan4', 
    name: 'Student Loan', 
    type: 'education', 
    originalAmount: 15000, 
    currentBalance: 15000, 
    interestRate: 3.5, 
    currency: 'AUD', 
    startDate: new Date().toISOString().split('T')[0], 
    termMonths: 120, 
    paymentFrequency: 'monthly',
    icon: '🎓'
  },
  { 
    id: 'loan5', 
    name: 'Investment Property Loan', 
    type: 'investment', 
    originalAmount: 500000, 
    currentBalance: 500000, 
    interestRate: 5.2, 
    currency: 'AUD', 
    startDate: new Date().toISOString().split('T')[0], 
    termMonths: 360,
    interestOnlyMonths: 24, // 2 years interest-only period
    paymentFrequency: 'monthly',
    icon: '🏢'
  },
  {
    // Staged-drawdown demo: nothing drawn yet, so it shows the "drawing"
    // phase (interest-only on drawn balance, facility progress bar).
    // Figures are illustrative round numbers, not a real contract.
    id: 'loan6',
    name: 'Construction Loan (Demo)',
    type: 'construction',
    originalAmount: 600000,       // facility limit
    currentBalance: 0,            // nothing drawn yet
    contractPrice: 600000,
    constructionFees: 5000,       // net available = 595,000
    netAvailable: 595000,
    interestRate: 6.5,
    termMonths: 360,
    interestOnlyMonths: 12,
    currency: 'AUD',
    startDate: new Date().toISOString().split('T')[0],
    paymentFrequency: 'monthly',
    icon: '🏗️',
    stages: [
      { name: 'Deposit', percent: 5, amount: 30000, drawn: false, drawnDate: '' },
      { name: 'Base / Slab', percent: 15, amount: 90000, drawn: false, drawnDate: '' },
      { name: 'Frame', percent: 25, amount: 150000, drawn: false, drawnDate: '' },
      { name: 'Lock Up', percent: 25, amount: 150000, drawn: false, drawnDate: '' },
      { name: 'Fixing', percent: 20, amount: 120000, drawn: false, drawnDate: '' },
      { name: 'Practical Completion', percent: 10, amount: 60000, drawn: false, drawnDate: '' }
    ]
  }
];

// ============================================================================
// 🎨 Helper Functions
// ============================================================================
function getLoanIcon(type) { 
  const icons = {
    mortgage: '🏠', 
    vehicle: '🚗', 
    personal: '👤', 
    education: '🎓', 
    business: '💼',
    investment: '🏢',
    construction: '🏗️'
  };
  return icons[type] || '🏦'; 
}

function getLoanTypeLabel(type) { 
  const labels = {
    mortgage: 'Mortgage', 
    vehicle: 'Vehicle', 
    personal: 'Personal', 
    education: 'Education', 
    business: 'Business',
    investment: 'Investment',
    construction: 'Construction'
  };
  return labels[type] || 'Loan'; 
}

// ============================================================================
// 🏗️ Construction Loan Helpers
// ============================================================================
// A construction loan draws down in stages instead of being disbursed in
// full on day one. currentBalance/originalAmount are kept as the source of
// truth everywhere else in the app (dashboard totals, net worth, offset
// calc, amortization) — these helpers just derive them FROM the stages
// list so the rest of the codebase never needs to know a loan is staged.
export function sumDrawnStages(stages) {
  return (stages || []).reduce((sum, s) => sum + (s.drawn ? (parseFloat(s.amount) || 0) : 0), 0);
}

export function isConstructionLoan(loan) {
  return loan && loan.type === 'construction';
}

// Shared payoff-progress math for a single loan, covering the staged
// construction-loan drawdown case as well as an ordinary loan. Reused by
// the Dashboard's Loan Payoff Progress widget (dashboard.js's
// getLoanProgressList) and Quick Look's copy of the same widget, so the
// two can't drift apart the way they used to.
//
// Bug this fixes: a construction loan's currentBalance starts at $0
// before its first stage is drawn (nothing owed yet, because nothing's
// been released) and then GROWS as each stage draws down — the opposite
// direction from a normal loan's balance, which only ever falls toward
// zero as it's repaid. Feeding that straight into the ordinary "percent
// paid off = (original - current) / original" formula reads a fresh,
// undrawn loan as ~100% paid off (current is $0, so "original minus
// current" is nearly the whole original amount) and currentBalance <= 0
// as "paid off" — both exactly backwards for a loan that hasn't even
// settled yet. This only kicks in for type:'construction' loans that
// still have an undrawn stage; everything else (a fully-drawn
// construction loan, or any non-construction loan) keeps behaving
// exactly as before.
export function getLoanPayoffStatus(loan) {
  const original = parseFloat(loan.originalAmount) || 0;
  const current = parseFloat(loan.currentBalance) || 0;

  if (isConstructionLoan(loan)) {
    const stages = loan.stages || [];
    const hasStages = stages.length > 0;
    const allDrawn = hasStages && stages.every(s => s.drawn);
    const drawnTotal = sumDrawnStages(stages);

    if (!allDrawn) {
      // Still under construction — draws so far are progress toward the
      // facility being fully released, not toward being paid off, and
      // this is never "paid off" no matter how low currentBalance is
      // (including the seeded $0 before the first drawdown).
      return {
        phase: 'drawing',
        percent: original > 0 ? Math.min(Math.max((drawnTotal / original) * 100, 0), 100) : 0,
        isPaidOff: false,
        drawnTotal,
        facilityLimit: original
      };
    }
    // Every stage has drawn — it now amortizes like a normal loan, but
    // "percent paid off" has to be measured against what was actually
    // ever drawn (the fully-drawn total), not the facility limit, since
    // the two can differ (undrawn contingency, rounding across stages).
    const fullyDrawnAmount = drawnTotal || original;
    return {
      phase: 'amortizing',
      percent: fullyDrawnAmount > 0 ? Math.min(Math.max(((fullyDrawnAmount - current) / fullyDrawnAmount) * 100, 0), 100) : 0,
      isPaidOff: current <= 0,
      drawnTotal,
      facilityLimit: original
    };
  }

  return {
    phase: 'standard',
    percent: original > 0 ? Math.min(Math.max(((original - current) / original) * 100, 0), 100) : 0,
    isPaidOff: current <= 0,
    drawnTotal: current,
    facilityLimit: original
  };
}

// Net funds actually available to draw once the lender's own fees are
// taken out of the facility limit — separate from originalAmount because
// originalAmount (== facilityLimit) is what the rest of the app treats as
// "the loan", while this is the smaller figure that determines whether the
// contract price is fully covered.
function constructionNetAvailable(loan) {
  const facility = loan.originalAmount || 0;
  const fees = loan.constructionFees || 0;
  return facility - fees;
}

function formatCurrency(amount, currency) {
  return formatMoney(amount, currency);
}

// ============================================================================
// 🧮 Helper function for P&I payment calculation
// ============================================================================
function calculatePAndIPayment(balance, monthlyRate, remainingMonths) {
  if (monthlyRate === 0) return balance / remainingMonths;
  if (remainingMonths === 0) return balance;
  return balance * monthlyRate * Math.pow(1 + monthlyRate, remainingMonths) / 
         (Math.pow(1 + monthlyRate, remainingMonths) - 1);
}

// ============================================================================
// 🧹 Utility Functions
// ============================================================================
async function addDefaultLoans() {
  const existing = await getAllItems(STORE_NAMES.loans);
  const ids = existing.map(l => l.id);
  for (const loan of DEFAULT_LOANS) {
    if (!ids.includes(loan.id)) {
      await addItem(STORE_NAMES.loans, { 
        ...loan, 
        createdAt: new Date().toISOString(), 
        updatedAt: new Date().toISOString() 
      });
    }
  }
  await refreshLoansList();
}

// Removes only demo loans: the built-in "Add Demo Loans" set (ids loan1..loan6)
// and any loan from the Settings demo dataset (ids starting "demo_"). Payment
// records tied to those loans go with them; your own loans are never touched.
async function removeDemoLoans() {
  const demoIds = new Set(DEFAULT_LOANS.map(l => l.id));
  const isDemo = id => typeof id === 'string' && (demoIds.has(id) || id.startsWith('demo_'));
  const loans = (await getAllItems(STORE_NAMES.loans)).filter(l => isDemo(l.id));
  if (!loans.length) { alert('No demo loans found.'); return; }
  if (!confirm(`Remove ${loans.length} demo loan(s) (${loans.map(l => l.name).join(', ')}) and any payment records recorded against them?\n\nYour own loans are not touched.`)) return;
  const ids = new Set(loans.map(l => l.id));
  const payments = (await getAllItems(STORE_NAMES.loanTransactions).catch(() => [])).filter(t => ids.has(t.loanId));
  for (const t of payments) await deleteItem(STORE_NAMES.loanTransactions, t.id);
  for (const l of loans) await deleteItem(STORE_NAMES.loans, l.id);
  await refreshLoansList();
}

async function refreshLoansList() {
  const [loans, accounts, properties] = await Promise.all([
    getAllItems(STORE_NAMES.loans),
    getAllItems(STORE_NAMES.accounts),
    getGatedItems(STORE_NAMES.properties)
  ]);
  renderLoansList(loans, accounts, properties);
}

// ============================================================================
// 💰 Process Loan Payment with Interest-Only Support
// ============================================================================
export async function processLoanPayment(loanId, paymentData) {
  const { fromAccountId, recurringId, categoryId, autoMinimum, existingTransactionId } = paymentData;
  let paymentDate = paymentData.paymentDate || new Date().toISOString().split('T')[0];
  // amount can be omitted entirely when autoMinimum is set — it then acts
  // as an optional floor ("pay at least this much, or the minimum,
  // whichever is higher") rather than the exact figure charged.
  let amount = paymentData.amount;

  const [loan, accounts, transactions, loanPayments] = await Promise.all([
    getAllItems(STORE_NAMES.loans).then(loans => loans.find(l => l.id === loanId)),
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.loanTransactions).catch(() => [])
  ]);

  if (!loan) throw new Error('Loan not found');
  const fromAccount = accounts.find(a => a.id === fromAccountId);
  if (!fromAccount) throw new Error('Source account not found');

  // The statement can be imported before the recurring job or before the
  // user records a payment manually. Adopt that bank row as the expense
  // transaction and add only the loan-ledger split; never create a second
  // account transaction for the same payment.
  let bankTransaction = null;
  if (existingTransactionId) {
    bankTransaction = transactions.find(t => t.id === existingTransactionId) || null;
    if (!bankTransaction ||
        bankTransaction.accountId !== fromAccountId ||
        bankTransaction.type !== 'expense' ||
        bankTransaction.isTransfer ||
        bankTransaction.reconciled ||
        Math.sign(Number(bankTransaction.amount) || 0) !== -1 ||
        (Number(amount) > 0 && !amountsMatch(bankTransaction.amount, amount))) {
      throw new Error('The selected imported transaction is no longer available as an unmatched loan payment.');
    }
  } else if (Number(amount) > 0) {
    const bankMatch = findRealLoanPaymentFor(
      { accountId: fromAccountId, amount, dueDate: paymentDate, categoryId },
      transactions
    );
    if (bankMatch.status === 'ambiguous') {
      throw new Error('More than one imported debit could match this loan payment. Review the matching transactions and try again; no payment was recorded.');
    }
    if (bankMatch.status === 'match') bankTransaction = bankMatch.transaction;
  }

  if (bankTransaction) {
    amount = Math.abs(Number(bankTransaction.amount));
    paymentDate = bankTransaction.date || paymentDate;
  }

  // A payment already linked to this loan must not be charged against the
  // balance a second time. A recurring run may attach its rule to that
  // existing payment; a second manual payment is stopped explicitly.
  const priorPayment = findRecordedLoanPaymentFor(
    { loanId, accountId: fromAccountId, amount, dueDate: paymentDate },
    transactions
  );
  if (priorPayment.status === 'ambiguous') {
    throw new Error('More than one payment is already linked to this loan for this date and amount. No second payment was recorded.');
  }
  if (priorPayment.status === 'match') {
    const prior = priorPayment.transaction;
    if (!recurringId) {
      throw new Error('This loan payment is already recorded. No duplicate payment was created.');
    }
    if (prior.recurringId && prior.recurringId !== recurringId) {
      throw new Error('This payment is already linked to a different recurring rule.');
    }
    const updatedPrior = { ...prior, recurringId, reconciled: true, updatedAt: new Date().toISOString() };
    await updateItem(STORE_NAMES.transactions, updatedPrior);
    const linkedPayment = loanPayments.find(p =>
      p.id === prior.loanTransactionId ||
      (p.loanId === loanId && p.fromAccountId === fromAccountId &&
        amountsMatch(p.amount, amount) && dayGap(p.date, paymentDate) <= 3)
    );
    if (linkedPayment) {
      await updateItem(STORE_NAMES.loanTransactions, {
        ...linkedPayment,
        recurringId,
        transactionId: prior.id,
        reconciled: true,
        updatedAt: new Date().toISOString()
      });
    }
    return {
      principal: linkedPayment?.principal || 0,
      interest: linkedPayment?.interest || 0,
      newBalance: loan.currentBalance,
      isInterestOnly: !!linkedPayment?.isInterestOnly,
      reconciled: true,
      transactionId: prior.id,
      loanTransactionId: prior.loanTransactionId || linkedPayment?.id || null
    };
  }

  // Calculate months passed since loan start
  const startDate = new Date(loan.startDate);
  const currentDate = new Date(paymentDate);
  const monthsPassed = (currentDate.getFullYear() - startDate.getFullYear()) * 12 + 
                      (currentDate.getMonth() - startDate.getMonth());
  
  const isInterestOnlyPeriod = loan.interestOnlyMonths && monthsPassed < loan.interestOnlyMonths;

  // Bug fix: this used a hard-coded monthly rate (interestRate/100/12)
  // regardless of the loan's actual paymentFrequency, so a weekly or
  // fortnightly loan had every real payment split using the wrong period
  // rate — overstating interest and understating principal reduction on
  // anything more frequent than monthly. Same underlying issue as
  // loanCalculations.js's calculatePaymentAmount, fixed the same way.
  const periodsPerYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 }[loan.paymentFrequency] || 12;
  // Bug fix: this read loan.interestRate directly, ignoring rateHistory —
  // so a loan with a recorded rate change kept charging interest at its
  // original flat rate on every real/recurring payment even after
  // calculatePaymentAmount and calculateAmortizationSchedule were fixed to
  // respect rateHistory. getRateForDate falls back to loan.interestRate
  // when there's no history, so this is safe for every existing loan.
  // Uses paymentDate (not "today") so catch-up processing of several
  // missed periods in sequence applies whichever rate was actually in
  // effect on each historical due date.
  const periodRate = getRateForDate(loan, paymentDate) / 100 / periodsPerYear;

  // Bug fix: interest was always charged on the loan's full currentBalance,
  // even for a loan with a linked offset account — completely ignoring the
  // offset benefit. An offset account's balance reduces the *interest-
  // bearing* portion of the loan (never the principal owed), so a real bank
  // charges interest on max(currentBalance - offsetBalance, 0), not
  // currentBalance outright. This reuses the same formula
  // calculateOffsetInterest already uses to show the "💰 Offset saving"
  // figure on the loan card — that figure was accurate; this calculation
  // just wasn't using it, so every real payment on an offset loan understated
  // how much of it should go to principal.
  let offsetBalance = 0;
  if (loan.linkedOffsetId) {
    const offsetAccount = accounts.find(a => a.id === loan.linkedOffsetId);
    if (offsetAccount) {
      offsetBalance = computeAccountBalance(offsetAccount, transactions);
    }
  }
  const interestBearingBalance = Math.max(loan.currentBalance - offsetBalance, 0);
  const interest = interestBearingBalance * periodRate;

  // "Always pay the loan's current minimum" mode (set on the Recurring
  // entry): rather than trusting a dollar figure that was only ever
  // correct on the day the recurring entry was created, recompute what's
  // actually owed for THIS due date — interest-only minimum offset-adjusted,
  // P&I minimum from the loan's real current balance/rate/remaining term —
  // and treat any amount the user did specify as a floor on top of that
  // (so "pay minimum + extra" still works).
  if (autoMinimum && !bankTransaction) {
    const requiredMinimum = calculateMinimumRepayment(loan, { asOfDateStr: paymentDate, offsetBalance });
    amount = Math.max(amount || 0, requiredMinimum);
  }
  
  let principal = 0;
  if (isInterestOnlyPeriod) {
    // Interest-only payment - principal remains the same
    principal = 0;
    if (amount < interest) {
      throw new Error(`Interest-only payment must be at least ${formatCurrency(interest, loan.currency)}`);
    }
    // Any amount over interest goes to principal (optional early repayment)
    principal = Math.min(amount - interest, loan.currentBalance);
  } else {
    // Standard P&I payment
    principal = Math.min(amount - interest, loan.currentBalance);
  }

  loan.currentBalance -= principal;
  loan.updatedAt = new Date().toISOString();
  // Note: fromAccount.balance is no longer mutated directly here — account
  // balances are now always computed live as openingBalance + the sum of
  // every transaction against that account (see js/accountBalance.js). The
  // paymentTransaction created below (with a negative amount, since it's
  // money leaving the account) is what moves the balance; mutating
  // fromAccount.balance here as well would double-count the payment.

  const loanTransactionId = generateId();
  const paymentTransactionId = bankTransaction?.id || generateId();
  const loanTransaction = {
    id: loanTransactionId,
    loanId,
    type: 'payment',
    amount,
    principal,
    interest,
    isInterestOnly: isInterestOnlyPeriod,
    date: paymentDate,
    fromAccountId,
    recurringId: recurringId || '',
    transactionId: paymentTransactionId,
    reconciled: !!bankTransaction,
    description: `Loan payment - ${loan.name}${isInterestOnlyPeriod ? ' (Interest Only)' : ''}`,
    createdAt: new Date().toISOString()
  };

  const resolvedCategoryId = categoryId || await getLoanExpenseCategoryId(loan);
  const paymentTransaction = {
    ...(bankTransaction || {}),
    id: paymentTransactionId,
    type: 'expense',
    // Negative because this is money leaving fromAccount — matches the
    // sign convention every other transaction in the app uses (expenses
    // are negative amounts). This used to be stored positive, which,
    // combined with the direct balance mutation above, happened to cancel
    // out visually but was inconsistent with account-balance calculation.
    amount: bankTransaction ? Number(bankTransaction.amount) : -amount,
    date: paymentDate,
    // Priority: an explicit override (e.g. the category chosen on the
    // linked Recurring entry's own form) beats the loan-specific lookup,
    // which beats the generic "some loan category" fallback. Without this,
    // every loan's payments — regardless of which loan — used to land in
    // whichever "*loan*"-named category happened to be first in the whole
    // category list, e.g. a home-equity payment filed under "Car Loan".
    categoryId: bankTransaction && !isUncategorised(bankTransaction.categoryId)
      ? bankTransaction.categoryId
      : resolvedCategoryId,
    accountId: fromAccountId,
    loanId,
    loanTransactionId,
    // Tagged with the recurring entry that generated this payment (when
    // called from the recurring job, not a manual "Make Payment") so a
    // catch-up rerun can tell "already recorded for this date" apart from
    // "still missing" without relying on fuzzy description/date matching.
    recurringId: recurringId || '',
    ...(bankTransaction ? { reconciled: true } : {}),
    description: bankTransaction.description || `Loan payment - ${loan.name}${isInterestOnlyPeriod ? ' (Interest Only)' : ''}`,
    createdAt: new Date().toISOString()
  };

  await updateItem(STORE_NAMES.loans, loan);
  await addItem(STORE_NAMES.loanTransactions, loanTransaction);
  if (bankTransaction) {
    await updateItem(STORE_NAMES.transactions, paymentTransaction);
  } else {
    await addItem(STORE_NAMES.transactions, await stampAud(paymentTransaction));
  }

  return { 
    principal, 
    interest, 
    newBalance: loan.currentBalance,
    isInterestOnly: isInterestOnlyPeriod,
    reconciled: !!bankTransaction,
    transactionId: paymentTransactionId,
    loanTransactionId
  };
}

// ============================================================================
// 🔄 Backfill Historical Transactions
// ============================================================================
// Replays a loan's history (via calculateHistoricalSchedule, which honours
// rateHistory) and creates the same paired loanTransaction + expense
// transaction records processLoanPayment creates for a single live
// payment — just in bulk, dated historically. Safe to re-run: periods that
// already have a backfilled record (matched by loanId + date) are skipped
// rather than duplicated, so adding a new rate-history entry and running
// it again only fills in/corrects what's changed.
export async function backfillLoanTransactions(loanId, fromAccountId) {
  const [loans, existingLoanTransactions] = await Promise.all([
    getAllItems(STORE_NAMES.loans),
    getAllItems(STORE_NAMES.loanTransactions)
  ]);
  const loan = loans.find(l => l.id === loanId);
  if (!loan) throw new Error('Loan not found');
  if (!fromAccountId) throw new Error('An account is required to post backfilled payments against');

  const alreadyBackfilled = new Set(
    existingLoanTransactions
      .filter(t => t.loanId === loanId && t.isBackfill)
      .map(t => t.date)
  );

  const schedule = calculateHistoricalSchedule(loan);
  const categoryId = await getLoanExpenseCategoryId(loan);

  let created = 0;
  let skipped = 0;
  let totalPrincipal = 0;
  let totalInterest = 0;

  for (const period of schedule) {
    totalPrincipal += period.principal;
    totalInterest += period.interest;

    if (alreadyBackfilled.has(period.date)) {
      skipped++;
      continue;
    }

    const loanTransactionId = generateId();
    const paymentTransactionId = generateId();
    const loanTransaction = {
      id: loanTransactionId,
      loanId,
      type: 'payment',
      amount: period.payment,
      principal: period.principal,
      interest: period.interest,
      isInterestOnly: period.isInterestOnly,
      isBackfill: true,
      date: period.date,
      fromAccountId,
      transactionId: paymentTransactionId,
      description: `Loan payment - ${loan.name}${period.isInterestOnly ? ' (Interest Only)' : ''} (backfilled)`,
      createdAt: new Date().toISOString()
    };

    const paymentTransaction = {
      id: paymentTransactionId,
      type: 'expense',
      amount: -period.payment,
      date: period.date,
      categoryId,
      accountId: fromAccountId,
      loanId,
      loanTransactionId,
      isBackfill: true,
      description: `Loan payment - ${loan.name}${period.isInterestOnly ? ' (Interest Only)' : ''} (backfilled)`,
      createdAt: new Date().toISOString()
    };

    await addItem(STORE_NAMES.loanTransactions, loanTransaction);
    await addItem(STORE_NAMES.transactions, await stampAud(paymentTransaction));
    created++;
  }

  const finalBalance = schedule.length ? schedule[schedule.length - 1].balance : loan.currentBalance;
  loan.currentBalance = finalBalance;
  loan.updatedAt = new Date().toISOString();
  await updateItem(STORE_NAMES.loans, loan);

  return {
    periodsInSchedule: schedule.length,
    created,
    skipped,
    totalPrincipal,
    totalInterest,
    finalBalance
  };
}

function showBackfillModal(loanId) {
  getAllItems(STORE_NAMES.loans).then(loans => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    const preview = calculateHistoricalSchedule(loan);
    const previewInterest = preview.reduce((sum, p) => sum + p.interest, 0);
    const previewPrincipal = preview.reduce((sum, p) => sum + p.principal, 0);
    const previewBalance = preview.length ? preview[preview.length - 1].balance : loan.currentBalance;
    const rateChanges = (loan.rateHistory || []).length;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>🔄 Backfill Transactions - ${escapeHtml(loan.name)}</h3>
          <button class="btn btn-text close-modal">✕</button>
        </div>
        <form id="backfillForm" class="styled-form">
          <p class="form-hint">
            This will generate ${preview.length} historical payment${preview.length === 1 ? '' : 's'} from
            ${escapeHtml(loan.startDate)} to today${rateChanges ? `, using your ${rateChanges} recorded rate change${rateChanges === 1 ? '' : 's'}` : ' at the loan\'s single flat rate — add rate changes on the Edit form first if the rate has moved'}.
            Already-backfilled periods are skipped automatically, so this is safe to re-run.
          </p>

          <div class="payment-breakdown" style="display:block;">
            <h4>Preview</h4>
            <div class="breakdown-item"><span>Total principal:</span><strong>${formatCurrency(previewPrincipal, loan.currency)}</strong></div>
            <div class="breakdown-item"><span>Total interest:</span><strong>${formatCurrency(previewInterest, loan.currency)}</strong></div>
            <div class="breakdown-item total"><span>Resulting balance:</span><strong>${formatCurrency(previewBalance, loan.currency)}</strong></div>
          </div>

          <div class="form-group">
            <label class="form-label">Post payments from account</label>
            <select id="backfillAccount" class="form-select" required>
              <option value="">-- Select Account --</option>
            </select>
            <small class="form-hint">Each backfilled payment is recorded as an expense on this account, same as a real payment would be. Shows every bank/savings/cash/offset account regardless of its current balance — its linked offset account (if any) is pre-selected.</small>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">🔄 Run Backfill</button>
            <button type="button" class="btn btn-secondary" id="cancelBackfill">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    populateBackfillAccounts(loanId, loan);

    document.getElementById('cancelBackfill').onclick = () => modal.remove();
    document.querySelector('.close-modal').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('backfillForm').onsubmit = async (e) => {
      e.preventDefault();
      const fromAccountId = document.getElementById('backfillAccount').value;
      if (!fromAccountId) return alert('Select an account');
      try {
        const res = await backfillLoanTransactions(loanId, fromAccountId);
        alert(`✅ Backfill complete\nCreated: ${res.created} payment(s)\nAlready existed: ${res.skipped}\nNew balance: ${formatCurrency(res.finalBalance, loan.currency)}`);
        modal.remove();
        initLoansUI();
      } catch (err) {
        alert('❌ ' + err.message);
      }
    };
  });
}

// ============================================================================
// 🧮 Offset Interest Calculation
// ============================================================================
export async function calculateOffsetInterest(loanId) {
  const [loan, accounts, transactions] = await Promise.all([
    getAllItems(STORE_NAMES.loans).then(loans => loans.find(l => l.id === loanId)),
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions)
  ]);
  if (!loan?.linkedOffsetId) return 0;

  const offsetAccount = accounts.find(a => a.id === loan.linkedOffsetId);
  if (!offsetAccount) return 0;

  const offsetBalance = computeAccountBalance(offsetAccount, transactions);
  const monthlyRate = loan.interestRate / 100 / 12;
  const effectiveBalance = Math.max(loan.currentBalance - offsetBalance, 0);
  return (loan.currentBalance - effectiveBalance) * monthlyRate;
}

// ============================================================================
// 📂 Get or Create Loan Expense Category
// ============================================================================
// Matches on the SPECIFIC loan being paid (by its type and name), not just
// "any category with 'loan' in the name" — the old behavior meant every
// loan's payments piled into whichever loan-ish category happened to be
// first in the whole list (e.g. a home-equity payment filed under
// "Car Loan"). Callers that already know the right category (e.g. the
// Recurring entry's own category field) should pass it in directly instead
// of relying on this at all — see the categoryId param on processLoanPayment.
async function getLoanExpenseCategoryId(loan) {
  const categories = await getAllItems(STORE_NAMES.categories);
  const expenseCats = categories.filter(c => c.type === 'expense');

  const typeKeywords = {
    mortgage: ['mortgage', 'home loan', 'home equity', 'housing'],
    vehicle: ['car loan', 'vehicle', 'auto loan', 'car'],
    personal: ['personal loan'],
    education: ['education', 'student loan'],
    business: ['business loan'],
    investment: ['investment loan']
  };

  const loanName = (loan?.name || '').toLowerCase();
  const keywords = [...(typeKeywords[loan?.type] || []), loanName].filter(Boolean);

  let cat = expenseCats.find(c => {
    const name = c.name.toLowerCase();
    return keywords.some(kw => kw && (name.includes(kw) || kw.includes(name)));
  });

  // Fall back to any category that at least mentions "loan", same as
  // before, only if nothing more specific matched.
  if (!cat) {
    cat = expenseCats.find(c => c.name.toLowerCase().includes('loan'));
  }

  if (!cat) {
    cat = { 
      id: generateId(), 
      name: 'Loan Interest', 
      type: 'expense', 
      icon: '🏦', 
      createdAt: new Date().toISOString(), 
      updatedAt: new Date().toISOString() 
    };
    await addItem(STORE_NAMES.categories, cat);
  }
  return cat.id;
}

// ============================================================================
// 🧱 UI Initialization
// ============================================================================

// Chart.js instance for the summary donut below — module-level so
// initLoansUI() can destroy the previous one before creating a new one on
// every re-render (same "destroy before recreate" pattern used for the
// Budget/Transaction Summary donuts).
let loansSummaryChart = null;

export async function initLoansUI() {
  const mainContent = document.getElementById('mainContent');
  mainContent.classList.add('page-transition');

  const [loans, accounts, properties] = await Promise.all([
    getAllItems(STORE_NAMES.loans),
    getAllItems(STORE_NAMES.accounts),
    getGatedItems(STORE_NAMES.properties)
  ]);

  // Calculate summary stats
  // Loans can be in different currencies, so page-level totals are summed in the base currency
  // (each loan card keeps its own currency). Raw sums used to add rupees to dollars.
  const totalBalance = loans.reduce((sum, loan) => sum + toBase(loan.currentBalance, loan.currency), 0);
  // Bug fix: calculatePaymentAmount() returns the payment in the loan's
  // OWN frequency (weekly/fortnightly/monthly/quarterly) — summing those
  // directly would add a $200 weekly payment to a $2,000 monthly one as
  // if they were the same unit. Convert each to a monthly-equivalent
  // first so this total means what its label says.
  const PAYMENTS_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 };
  const totalMonthlyPayments = loans.reduce((sum, loan) => {
    const payment = calculatePaymentAmount(loan);
    const periodsPerYear = PAYMENTS_PER_YEAR[loan.paymentFrequency] || 12;
    const monthlyEquivalent = (payment || 0) * periodsPerYear / 12;
    return sum + toBase(monthlyEquivalent, loan.currency);
  }, 0);
  // A construction loan sitting at $0 before its first drawdown isn't
  // "paid off" — it hasn't started yet — so it's excluded from this count
  // (see getLoanPayoffStatus above for why).
  const paidOffLoans = loans.filter(loan => getLoanPayoffStatus(loan).isPaidOff).length;
  const interestOnlyLoans = loans.filter(loan => {
    if (!loan.interestOnlyMonths) return false;
    const startDate = new Date(loan.startDate);
    const now = new Date();
    const monthsPassed = (now.getFullYear() - startDate.getFullYear()) * 12 + 
                        (now.getMonth() - startDate.getMonth());
    return monthsPassed < loan.interestOnlyMonths;
  }).length;

  // Total Balance vs Paid Off, for the summary donut — same idea as the
  // Budgets page's Spent vs Remaining ring, just for loan payoff instead
  // of budget spend. originalAmount doubles as facilityLimit for
  // line-of-credit loans (see comment near that field above), so this
  // still means "how much of what was borrowed is left" for those too.
  const totalOriginal = loans.reduce((sum, loan) => sum + toBase(parseFloat(loan.originalAmount) || 0, loan.currency), 0);
  const totalPaidOff = Math.max(0, totalOriginal - totalBalance);
  const payoffPct = totalOriginal > 0 ? (totalPaidOff / totalOriginal) * 100 : 0;

  mainContent.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <h2>🏦 Loans</h2>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnNewLoan">➕ New Loan</button>
          <button class="btn btn-secondary" id="btnAddDefaultLoans">📦 Add Demo Loans</button>
          <button class="btn btn-secondary" id="btnRemoveDemoLoans">🧹 Remove Demo Loans</button>
          <button class="btn btn-secondary" id="btnJumpToWhatIf">🧮 What-If</button>
        </div>
      </div>

      <!-- Loan Summary — same fo-card donut + per-row progress bar
           treatment as Budgets/Transactions, in place of the old plain
           number cards. -->
      <div class="fo-card fo-card-wide">
        <div class="fo-card-header-row">
          <span class="fo-card-title">Loan Summary</span>
          <span class="fo-card-subtitle">${loans.length} loan${loans.length === 1 ? '' : 's'}</span>
        </div>
        <div class="fo-budget-layout">
          <div class="fo-chart-wrap fo-donut-wrap">
            <canvas id="loansSummaryDonut"></canvas>
            <div class="fo-donut-center">
              <span class="fo-donut-center-value">${Math.round(payoffPct)}%</span>
              <span class="fo-donut-center-label">Paid Off</span>
            </div>
          </div>
          <div class="fo-budget-mid">
            <div class="fo-legend-row">
              <span class="fo-legend-dot" style="background:#ff6b7a;"></span>
              <span class="fo-legend-label">Balance Remaining</span>
              <span class="fo-legend-value negative">${formatCurrency(totalBalance)}</span>
            </div>
            <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${totalOriginal > 0 ? Math.min(100, (totalBalance / totalOriginal) * 100) : 0}%;background:#ff6b7a"></div></div>
            <div class="fo-legend-row">
              <span class="fo-legend-dot" style="background:#3ddc97;"></span>
              <span class="fo-legend-label">Paid Off</span>
              <span class="fo-legend-value positive">${formatCurrency(totalPaidOff)}</span>
            </div>
            <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${Math.min(100, payoffPct)}%;background:#3ddc97"></div></div>
            <div class="fo-legend-row">
              <span class="fo-legend-dot" style="background:#5b8def;"></span>
              <span class="fo-legend-label">Monthly Payments</span>
              <span class="fo-legend-value">${formatCurrency(totalMonthlyPayments)}</span>
            </div>
          </div>
          <div class="fo-balance-box">
            <span class="fo-balance-box-value">${paidOffLoans}</span>
            <span class="fo-balance-box-label">Fully Paid Off</span>
          </div>
        </div>
        <div class="fo-empty-note">${interestOnlyLoans} loan${interestOnlyLoans === 1 ? '' : 's'} currently interest-only</div>
      </div>

      <!-- Forms Section -->
      <div class="forms-section">
        <div id="loanFormSection" class="section-card form-section" style="display: none;">
          <div class="form-header">
            <h3 id="loanFormTitle">➕ Add New Loan</h3>
            <button class="btn btn-text" id="closeLoanForm">✕</button>
          </div>
          <form id="loanForm" class="styled-form">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Loan Name</label>
                <input type="text" name="name" class="form-input" placeholder="e.g., Home Mortgage, Car Loan..." required>
              </div>
              <div class="form-group">
                <label class="form-label">Loan Type</label>
                <select name="type" class="form-select" required>
                  <option value="mortgage">🏠 Mortgage</option>
                  <option value="vehicle">🚗 Vehicle</option>
                  <option value="personal">👤 Personal</option>
                  <option value="education">🎓 Education</option>
                  <option value="business">💼 Business</option>
                  <option value="investment">🏢 Investment</option>
                  <option value="construction">🏗️ Construction</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" data-feature="property">
                <label class="form-label">Linked Property</label>
                <select name="propertyId" class="form-select">
                  <option value="">-- None --</option>
                  ${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name || p.address || 'Property')}</option>`).join('')}
                </select>
                <small class="form-hint">Ties this loan's balance/repayment progress to a property.</small>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Lender</label>
                <select name="institution" class="form-select">
                  <option value="">-- None --</option>
                  ${institutionOptions('')}
                </select>
              </div>
              <div id="customLenderField" class="form-group" style="display:none;">
                <label class="form-label">Lender Name</label>
                <input type="text" name="institutionName" class="form-input" placeholder="e.g. Community Credit Union">
              </div>
            </div>

            <div id="constructionFieldsSection" style="display:none;">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Contract Price</label>
                  <input type="number" name="contractPrice" class="form-input" step="0.01" placeholder="0.00">
                  <small class="form-hint">Total build contract price (all stages should add up to this)</small>
                </div>
                <div class="form-group">
                  <label class="form-label">Lender Fees (capitalised)</label>
                  <input type="number" name="constructionFees" class="form-input" step="0.01" placeholder="0.00">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Drawdown Stages</label>
                <div id="stagesContainer"></div>
                <button type="button" class="btn btn-secondary" id="btnAddStage">➕ Add Stage</button>
                <small class="form-hint">Tick "Drawn" once the lender has released that stage's payment. Current Balance below is calculated automatically from drawn stages, and interest is charged only on that drawn balance.</small>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <span class="form-label">Net Available After Fees</span>
                  <div id="netAvailableDisplay" class="form-hint" style="font-size:1rem;font-weight:600;">$0.00</div>
                </div>
                <div class="form-group">
                  <span class="form-label">Shortfall vs Contract Price</span>
                  <div id="shortfallDisplay" class="form-hint" style="font-size:1rem;font-weight:600;">$0.00</div>
                </div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" id="originalAmountLabel">Original Amount</label>
                <input type="number" name="originalAmount" class="form-input" step="0.01" placeholder="0.00" required>
                <small class="form-hint" id="originalAmountHint" style="display:none;">This is your Facility Limit for a construction loan</small>
              </div>
              <div class="form-group">
                <label class="form-label">Current Balance</label>
                <input type="number" name="currentBalance" class="form-input" step="0.01" placeholder="0.00" required>
                <small class="form-hint" id="currentBalanceHint" style="display:none;">Auto-calculated from drawn stages</small>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Interest Rate (%)</label>
                <input type="number" name="interestRate" class="form-input" step="0.01" placeholder="0.00" required>
                <small class="form-hint">The rate in effect right now. If the rate has changed since the loan started, add each change below instead of only editing this field.</small>
              </div>
              <div class="form-group">
                <label class="form-label">Term (months)</label>
                <input type="number" name="termMonths" class="form-input" placeholder="60" required>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Rate History (optional)</label>
              <div id="rateHistoryContainer"></div>
              <button type="button" class="btn btn-secondary" id="btnAddRateChange">➕ Add Rate Change</button>
              <small class="form-hint">Add one row per time your rate changed, with the date it took effect. Leave empty to treat the loan as one flat rate for its whole life. Used by "🔄 Backfill Transactions" to replay your payment history accurately.</small>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Start Date</label>
                <input type="date" name="startDate" class="form-input" required>
              </div>
              <div class="form-group">
                <label class="form-label">Payment Frequency</label>
                <select name="paymentFrequency" class="form-select" required>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly" selected>Monthly</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" id="interestOnlyLabel">Interest-Only Period (months)</label>
                <input type="number" name="interestOnlyMonths" class="form-input" placeholder="0" min="0" value="0">
                <small class="form-hint" id="interestOnlyHint">Set to 0 for Principal &amp; Interest from start</small>
              </div>
              <div class="form-group">
                <label class="form-label">Remaining Interest-Only</label>
                <input type="number" name="remainingInterestOnlyMonths" class="form-input" placeholder="Auto-calculated" readonly>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Fixed Rate End Date</label>
                <input type="date" name="fixedRateEndDate" class="form-input">
                <small class="form-hint">Leave blank for a variable-rate loan. Used to warn you before it reverts to the (usually higher) variable rate.</small>
              </div>
            </div>

            <div class="form-actions">
              <button class="btn btn-primary" type="submit">💾 Save Loan</button>
              <button class="btn btn-secondary" type="reset">🧹 Clear</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Loans List -->
      <div class="section-card">
        <div class="transactions-header">
          <h3>Your Loans</h3>
          <div class="transactions-controls">
            <span class="transactions-count" id="loansCount">${loans.length} loans</span>
            <select id="sortLoans" class="form-select">
              <option value="balance-desc">Highest Balance</option>
              <option value="balance-asc">Lowest Balance</option>
              <option value="interest-desc">Highest Interest</option>
              <option value="name-asc">Name A-Z</option>
              <option value="type-asc">Loan Type</option>
              <option value="interest-only">Interest Only First</option>
            </select>
          </div>
        </div>
        <div id="loansList"></div>
      </div>

      <!-- What-If Payoff Modeler -->
      ${renderLoanWhatIfHTML(loans)}
    </div>
  `;

  setTimeout(() => mainContent.classList.remove('page-transition'), 400);

  // Loan Summary donut — Balance Remaining vs Paid Off. Same
  // destroy-before-recreate pattern as the Budget/Transaction Summary
  // donuts, since initLoansUI() re-renders #mainContent's innerHTML (and
  // this canvas along with it) on every loan add/edit/delete.
  const loansDonutCanvas = document.getElementById('loansSummaryDonut');
  if (loansDonutCanvas && typeof Chart !== 'undefined') {
    if (loansSummaryChart) { loansSummaryChart.destroy(); loansSummaryChart = null; }
    loansSummaryChart = new Chart(loansDonutCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Balance Remaining', 'Paid Off'],
        datasets: [{
          data: [totalBalance, totalPaidOff],
          backgroundColor: ['#ff6b7a', '#3ddc97'],
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

  // Initialize
  renderLoansList(loans, accounts, properties);
  setupLoansEventListeners(loans, accounts, properties);
  attachLoanWhatIfBehavior(loans);
}

// ============================================================================
// 🔁 Refresh Loan Cards
// ============================================================================
async function renderLoansList(loans, accounts, properties) {
  const loansList = document.getElementById('loansList');
  const loansCount = document.getElementById('loansCount');

  if (!loans.length) {
    loansList.innerHTML = `
      <div class="empty-state">
        <p>No loans set up yet.</p>
        <button class="btn btn-primary" onclick="document.getElementById('btnAddDefaultLoans').click()">
          Add Demo Loans
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('btnNewLoan').click()">
          Create Your First Loan
        </button>
      </div>
    `;
    return;
  }

  // Apply sorting
  const sortBy = document.getElementById('sortLoans').value;
  const sortedLoans = [...loans].sort((a, b) => {
    switch (sortBy) {
      case 'balance-desc': return b.currentBalance - a.currentBalance;
      case 'balance-asc': return a.currentBalance - b.currentBalance;
      case 'interest-desc': return b.interestRate - a.interestRate;
      case 'name-asc': return a.name.localeCompare(b.name);
      case 'type-asc': return a.type.localeCompare(b.type);
      case 'interest-only':
        const aIsInterestOnly = isLoanInterestOnly(a);
        const bIsInterestOnly = isLoanInterestOnly(b);
        if (aIsInterestOnly && !bIsInterestOnly) return -1;
        if (!aIsInterestOnly && bIsInterestOnly) return 1;
        return b.currentBalance - a.currentBalance;
      default: return b.currentBalance - a.currentBalance;
    }
  });

  const loanCards = await Promise.all(sortedLoans.map(loan => renderLoanCard(loan, accounts, properties)));
  loansList.innerHTML = loanCards.join('');

  loansCount.textContent = `${loans.length} loan${loans.length !== 1 ? 's' : ''}`;

  // Attach event listeners
  attachLoanCardEventListeners(loans);
}

// Helper function to check if loan is in interest-only period
function isLoanInterestOnly(loan) {
  if (!loan.interestOnlyMonths) return false;
  const startDate = new Date(loan.startDate);
  const now = new Date();
  const monthsPassed = (now.getFullYear() - startDate.getFullYear()) * 12 + 
                      (now.getMonth() - startDate.getMonth());
  return monthsPassed < loan.interestOnlyMonths;
}

// ============================================================================
// 💳 Enhanced Loan Card with Interest-Only Support
// ============================================================================
async function renderLoanCard(loan, accounts, properties) {
  // A construction loan's balance GROWS over time as stages draw down,
  // rather than shrinking as it's paid off — the normal card's "% paid
  // off" progress bar (and its "Paid off" badge at $0 balance, which is
  // just true before settlement here) would be actively misleading, so
  // it gets its own renderer instead of branching the existing one apart.
  if (isConstructionLoan(loan)) {
    return renderConstructionLoanCard(loan, accounts, properties);
  }
  const progress = ((loan.originalAmount - loan.currentBalance) / loan.originalAmount * 100).toFixed(1);
  // Named periodicPayment (not monthlyPayment) since calculatePaymentAmount
  // now correctly returns the amount in the loan's OWN frequency, not
  // always monthly — see js/loanCalculations.js.
  const periodicPayment = calculatePaymentAmount(loan);
  const offsetSavings = await calculateOffsetInterest(loan.id);
  const isPaidOff = loan.currentBalance <= 0;
  const linkedProperty = loan.propertyId ? (properties || []).find(p => p.id === loan.propertyId) : null;
  
  // Calculate interest-only status
  const isInterestOnly = isLoanInterestOnly(loan);
  const remainingInterestOnlyMonths = isInterestOnly ? 
    Math.max(loan.interestOnlyMonths - calculateMonthsPassed(loan.startDate), 0) : 0;
  const nextPaymentDate = !isPaidOff ? getNextPaymentDate(loan).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const lenderName = institutionDisplayName(loan.institution, loan.institutionName);

  return `
    <div class="loan-card-wrap">
    <div class="bank-card type-loan ${isPaidOff ? '' : ''}" data-id="${loan.id}">
      <div class="bank-card-top">
        <div class="bank-card-issuer">
          ${renderInstitutionMark(loan.institution, loan.institutionName)}
          <div>
            <div class="bank-card-issuer-name">${escapeHtml(lenderName || getLoanTypeLabel(loan.type))}</div>
            <div class="bank-card-type-tag">${getLoanTypeLabel(loan.type)} ${isInterestOnly ? '· Interest Only' : ''}</div>
            ${linkedProperty ? `<div class="bank-card-type-tag">🏠 ${escapeHtml(linkedProperty.name || linkedProperty.address || 'Linked property')}</div>` : ''}
          </div>
        </div>
        <div class="bank-card-chip" aria-hidden="true"></div>
      </div>

      <div class="bank-card-number">•••• •••• •••• ${pseudoLast4(loan.id)}</div>

      <div class="bank-card-bottom">
        <div>
          <p class="bank-card-name">${escapeHtml(loan.name)}</p>
          <p class="bank-card-sub">${getCurrentRate(loan)}% APR ${remainingInterestOnlyMonths > 0 ? `· ${remainingInterestOnlyMonths} mo interest-only left` : ''}</p>
        </div>
        <div class="bank-card-balance ${isPaidOff ? 'positive' : 'negative'}">
          <span class="bank-card-balance-label">${isPaidOff ? 'Paid off' : 'Owing'}</span>
          ${isPaidOff ? '✅ ' : ''}${formatCurrency(loan.currentBalance, loan.currency)}
        </div>
      </div>

      <div class="bank-card-progress">
        <div class="progress-bar"><div class="progress-fill" style="width: ${progress}%"></div></div>
        <small>${progress}% paid${!isPaidOff ? ` · Next payment: ${formatCurrency(periodicPayment, loan.currency)} ${loan.paymentFrequency} · Due ${nextPaymentDate}` : ''}</small>
      </div>
      ${offsetSavings > 0 ? `<div class="bank-card-footnote">💰 Offset saving ${formatCurrency(offsetSavings, loan.currency)}/month</div>` : ''}
    </div>
    <div class="transaction-actions loan-card-actions">
      ${!isPaidOff ? `<button class="action-btn payment-btn" data-id="${loan.id}" title="Make Payment">💳</button>` : ''}
      <button class="action-btn schedule-btn" data-id="${loan.id}" title="View Schedule">📅</button>
      <button class="action-btn transactions-btn" data-id="${loan.id}" title="View Transactions">🧾</button>
      <button class="action-btn backfill-btn" data-id="${loan.id}" title="Backfill transaction history from loan start to today">🔄</button>
      <button class="action-btn edit-btn" data-id="${loan.id}" title="Edit">✏️</button>
      <button class="action-btn delete-btn" data-id="${loan.id}" title="Delete">🗑️</button>
    </div>
    </div>
  `;
}

async function renderConstructionLoanCard(loan, accounts, properties) {
  const stages = loan.stages || [];
  const drawnStages = stages.filter(s => s.drawn);
  const drawnTotal = sumDrawnStages(stages);
  const facilityLimit = loan.originalAmount || 0;
  const netAvailable = loan.netAvailable ?? constructionNetAvailable(loan);
  const contractPrice = loan.contractPrice || 0;
  const shortfall = Math.max(contractPrice - netAvailable, 0);
  const drawnPercent = facilityLimit > 0 ? (drawnTotal / facilityLimit * 100).toFixed(1) : '0.0';
  const nextStage = stages.find(s => !s.drawn);
  const constructionComplete = stages.length > 0 && drawnStages.length === stages.length;
  const isInterestOnly = isLoanInterestOnly(loan);
  const periodicPayment = calculatePaymentAmount(loan);
  const linkedProperty = loan.propertyId ? (properties || []).find(p => p.id === loan.propertyId) : null;
  const lenderName = institutionDisplayName(loan.institution, loan.institutionName);

  return `
    <div class="loan-card-wrap">
    <div class="bank-card type-loan" data-id="${loan.id}">
      <div class="bank-card-top">
        <div class="bank-card-issuer">
          ${renderInstitutionMark(loan.institution, loan.institutionName)}
          <div>
            <div class="bank-card-issuer-name">${escapeHtml(lenderName || getLoanTypeLabel(loan.type))}</div>
            <div class="bank-card-type-tag">${getLoanTypeLabel(loan.type)} ${isInterestOnly ? '· Interest Only' : constructionComplete ? '· Converted to P&I' : ''}</div>
            ${linkedProperty ? `<div class="bank-card-type-tag">🏠 ${escapeHtml(linkedProperty.name || linkedProperty.address || 'Linked property')}</div>` : ''}
          </div>
        </div>
        <div class="bank-card-chip" aria-hidden="true"></div>
      </div>

      <div class="bank-card-number">•••• •••• •••• ${pseudoLast4(loan.id)}</div>

      <div class="bank-card-bottom">
        <div>
          <p class="bank-card-name">${escapeHtml(loan.name)}</p>
          <p class="bank-card-sub">${loan.interestRate || 0}% APR · Facility ${formatCurrency(facilityLimit, loan.currency)}</p>
        </div>
        <div class="bank-card-balance negative">
          <span class="bank-card-balance-label">Drawn so far</span>
          ${formatCurrency(drawnTotal, loan.currency)}
        </div>
      </div>

      <div class="bank-card-progress">
        <div class="progress-bar"><div class="progress-fill" style="width: ${drawnPercent}%"></div></div>
        <small>${drawnPercent}% of facility drawn (${drawnStages.length}/${stages.length} stages)${nextStage ? ` · Next: ${escapeHtml(nextStage.name)} (${formatCurrency(nextStage.amount, loan.currency)})` : ' · All stages drawn'}</small>
      </div>
      ${!constructionComplete ? `<small class="form-hint" style="display:block;margin-top:0.25rem;">${drawnTotal > 0 ? `Interest-only ${formatCurrency(periodicPayment, loan.currency)} ${loan.paymentFrequency} on drawn balance` : 'No interest yet — nothing drawn'}</small>` : `<small class="form-hint" style="display:block;margin-top:0.25rem;">Next payment: ${formatCurrency(periodicPayment, loan.currency)} ${loan.paymentFrequency}</small>`}
      ${shortfall > 0 ? `<div class="bank-card-footnote">⚠️ Contract price exceeds net available funds by ${formatCurrency(shortfall, loan.currency)} — plan to top up from offset/savings</div>` : ''}
      <div class="construction-stage-list" style="margin-top:0.5rem;font-size:0.85rem;line-height:1.6;">
        ${stages.map(s => `<div>${s.drawn ? '✅' : '⏳'} ${escapeHtml(s.name)} — ${formatCurrency(s.amount, loan.currency)}${s.drawn && s.drawnDate ? ` (${s.drawnDate})` : ''}</div>`).join('')}
      </div>
    </div>
    <div class="transaction-actions loan-card-actions">
      ${drawnTotal > 0 ? `<button class="action-btn payment-btn" data-id="${loan.id}" title="Make Payment">💳</button>` : ''}
      <button class="action-btn schedule-btn" data-id="${loan.id}" title="View Schedule">📅</button>
      <button class="action-btn transactions-btn" data-id="${loan.id}" title="View Transactions">🧾</button>
      <button class="action-btn edit-btn" data-id="${loan.id}" title="Edit / Record Drawdown">✏️</button>
      <button class="action-btn delete-btn" data-id="${loan.id}" title="Delete">🗑️</button>
    </div>
    </div>
  `;
}

// Helper function to calculate months passed
function calculateMonthsPassed(startDateStr) {
  const startDate = new Date(startDateStr);
  const now = new Date();
  return (now.getFullYear() - startDate.getFullYear()) * 12 + 
         (now.getMonth() - startDate.getMonth());
}

// The date of the loan's next upcoming payment, anchored to the same
// day-of-month as loan.startDate (e.g. a loan that started on the 19th
// keeps billing on the 19th) — mirrors exactly how the amortization
// schedule computes its very first row's date, so the card and the
// schedule modal always agree. Monthly-cadence only, matching the same
// assumption the rest of the enhanced schedule already makes.
function getNextPaymentDate(loan) {
  const startDate = new Date(loan.startDate);
  const monthsPassed = calculateMonthsPassed(loan.startDate);
  const nextDate = new Date(startDate);
  nextDate.setMonth(nextDate.getMonth() + monthsPassed + 1);
  return nextDate;
}

// ============================================================================
// 🎯 Event Listeners Setup
// ============================================================================
// Default Victorian domestic-building-contract stages (deposit + the 5
// standard progress-payment stages) used to pre-fill a fresh construction
// loan. Percentages/amounts get overwritten with the real contract figures
// once the user edits the rows, but this saves typing the stage NAMES.
const DEFAULT_CONSTRUCTION_STAGES = [
  { name: 'Deposit', percent: 5 },
  { name: 'Base / Slab Down Complete', percent: 15 },
  { name: 'Frame Up Complete', percent: 25 },
  { name: 'Lock Up Complete', percent: 25 },
  { name: 'Fixing Complete', percent: 20 },
  { name: 'Practical Completion (QA)', percent: 10 }
];

let stageRowCounter = 0;

function stageRowHTML(stage = {}) {
  const idx = stageRowCounter++;
  return `
    <div class="form-row stage-row" data-index="${idx}" style="align-items:center;gap:0.5rem;">
      <input type="text" class="form-input stage-name" placeholder="Stage name" value="${escapeHtml(stage.name || '')}" style="flex:2;">
      <input type="number" class="form-input stage-percent" placeholder="%" step="0.01" value="${stage.percent ?? ''}" style="flex:1;">
      <input type="number" class="form-input stage-amount" placeholder="Amount" step="0.01" value="${stage.amount ?? ''}" style="flex:1;">
      <label style="display:flex;align-items:center;gap:0.25rem;white-space:nowrap;">
        <input type="checkbox" class="stage-drawn" ${stage.drawn ? 'checked' : ''}> Drawn
      </label>
      <input type="date" class="form-input stage-date" value="${stage.drawnDate || ''}" style="flex:1;">
      <button type="button" class="btn btn-text stage-remove" title="Remove stage">✕</button>
    </div>`;
}

function addStageRow(stage) {
  const container = document.getElementById('stagesContainer');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', stageRowHTML(stage));
  const rows = container.querySelectorAll('.stage-row');
  const newRow = rows[rows.length - 1];
  newRow.querySelector('.stage-remove').addEventListener('click', () => {
    newRow.remove();
    recalcConstructionFields();
  });
  newRow.querySelectorAll('.stage-amount, .stage-drawn').forEach(el => {
    el.addEventListener('input', recalcConstructionFields);
    el.addEventListener('change', recalcConstructionFields);
  });
  // Editing the % recalculates this stage's dollar amount from the
  // contract price (amount = contractPrice * percent / 100), then
  // cascades into the facility-limit-drawn total same as editing the
  // amount directly would.
  const percentInput = newRow.querySelector('.stage-percent');
  percentInput.addEventListener('input', () => {
    const form = document.getElementById('loanForm');
    const contractPrice = parseFloat(form?.contractPrice?.value) || 0;
    const percent = parseFloat(percentInput.value) || 0;
    newRow.querySelector('.stage-amount').value = (contractPrice * percent / 100).toFixed(2);
    recalcConstructionFields();
  });
}

function getStageRowsData() {
  const container = document.getElementById('stagesContainer');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.stage-row')).map(row => ({
    name: row.querySelector('.stage-name').value.trim(),
    percent: parseFloat(row.querySelector('.stage-percent').value) || 0,
    amount: parseFloat(row.querySelector('.stage-amount').value) || 0,
    drawn: row.querySelector('.stage-drawn').checked,
    drawnDate: row.querySelector('.stage-date').value || ''
  }));
}

let rateRowCounter = 0;

function rateRowHTML(entry = {}) {
  const idx = rateRowCounter++;
  return `
    <div class="form-row rate-row" data-index="${idx}" style="align-items:center;gap:0.5rem;">
      <input type="date" class="form-input rate-date" value="${entry.date || ''}" style="flex:1;">
      <input type="number" class="form-input rate-value" placeholder="Rate %" step="0.01" value="${entry.rate ?? ''}" style="flex:1;">
      <button type="button" class="btn btn-text rate-remove" title="Remove rate change">✕</button>
    </div>`;
}

function addRateRow(entry) {
  const container = document.getElementById('rateHistoryContainer');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', rateRowHTML(entry));
  const rows = container.querySelectorAll('.rate-row');
  const newRow = rows[rows.length - 1];
  newRow.querySelector('.rate-remove').addEventListener('click', () => newRow.remove());
}

function getRateRowsData() {
  const container = document.getElementById('rateHistoryContainer');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.rate-row'))
    .map(row => ({
      date: row.querySelector('.rate-date').value,
      rate: parseFloat(row.querySelector('.rate-value').value)
    }))
    .filter(r => r.date && !isNaN(r.rate))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Recomputes Original Amount (= Facility Limit), Current Balance (= sum
// of drawn stage amounts), Net Available, and the Shortfall banner
// whenever a stage, the facility limit, fees, or the contract price
// changes, so the read-only fields never go stale while the form is open.
function recalcConstructionFields() {
  const form = document.getElementById('loanForm');
  if (!form || form.type.value !== 'construction') return;
  const stages = getStageRowsData();
  const drawn = sumDrawnStages(stages);
  const facilityLimit = parseFloat(form.originalAmount.value) || 0;
  const fees = parseFloat(form.constructionFees.value) || 0;
  const contractPrice = parseFloat(form.contractPrice.value) || 0;
  const netAvailable = facilityLimit - fees;
  const shortfall = Math.max(contractPrice - netAvailable, 0);

  form.currentBalance.value = drawn.toFixed(2);
  document.getElementById('netAvailableDisplay').textContent = formatCurrency(netAvailable, 'AUD');
  const shortfallEl = document.getElementById('shortfallDisplay');
  shortfallEl.textContent = formatCurrency(shortfall, 'AUD');
  shortfallEl.style.color = shortfall > 0 ? 'var(--danger, #d33)' : '';
}

function toggleConstructionFields(isConstruction, prefillDefaults) {
  const section = document.getElementById('constructionFieldsSection');
  const form = document.getElementById('loanForm');
  section.style.display = isConstruction ? 'block' : 'none';

  form.originalAmount.readOnly = isConstruction;
  form.currentBalance.readOnly = isConstruction;
  document.getElementById('originalAmountLabel').textContent = isConstruction ? 'Facility Limit' : 'Original Amount';
  document.getElementById('originalAmountHint').style.display = isConstruction ? 'block' : 'none';
  document.getElementById('currentBalanceHint').style.display = isConstruction ? 'block' : 'none';
  document.getElementById('interestOnlyLabel').textContent = isConstruction
    ? 'Interest-Only Until Construction Complete (months)'
    : 'Interest-Only Period (months)';
  document.getElementById('interestOnlyHint').textContent = isConstruction
    ? 'Roughly how many months from settlement until the final stage — converts to Principal & Interest after that'
    : 'Set to 0 for Principal & Interest from start';

  if (isConstruction && prefillDefaults) {
    document.getElementById('stagesContainer').innerHTML = '';
    DEFAULT_CONSTRUCTION_STAGES.forEach(s => addStageRow(s));
    recalcConstructionFields();
  }
}

function setupLoansEventListeners(loans, accounts, properties) {
  const btnNewLoan = document.getElementById('btnNewLoan');
  const btnAddDefaultLoans = document.getElementById('btnAddDefaultLoans');
  const loanFormSection = document.getElementById('loanFormSection');
  const closeLoanForm = document.getElementById('closeLoanForm');
  const loanForm = document.getElementById('loanForm');
  const sortSelect = document.getElementById('sortLoans');

  // Form toggle
  btnNewLoan.addEventListener('click', () => {
    const isVisible = loanFormSection.style.display === 'block';
    loanFormSection.style.display = isVisible ? 'none' : 'block';
    loanForm.reset();
    loanForm.dataset.id = '';
    document.getElementById('loanFormTitle').textContent = '➕ Add New Loan';
    const today = new Date().toISOString().split('T')[0];
    loanForm.startDate.value = today;
    
    // Setup interest-only calculation
    setupInterestOnlyCalculation();
    document.getElementById('stagesContainer').innerHTML = '';
    document.getElementById('rateHistoryContainer').innerHTML = '';
    toggleConstructionFields(loanForm.type.value === 'construction', true);
    
    if (!isVisible) {
      loanFormSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // Construction loan fields: show/hide + keep derived fields in sync
  const typeSelect = loanForm.querySelector('select[name="type"]');
  typeSelect.addEventListener('change', () => {
    toggleConstructionFields(typeSelect.value === 'construction', typeSelect.value === 'construction' && !document.getElementById('stagesContainer').children.length);
  });
  const btnAddStage = document.getElementById('btnAddStage');
  if (btnAddStage) btnAddStage.addEventListener('click', () => addStageRow({}));
  ['originalAmount', 'constructionFees'].forEach(fieldName => {
    const el = loanForm.querySelector(`[name="${fieldName}"]`);
    if (el) el.addEventListener('input', recalcConstructionFields);
  });
  // Contract price additionally drives every stage's dollar amount, since
  // each stage's amount = contractPrice * stage percent / 100.
  const contractPriceEl = loanForm.querySelector('[name="contractPrice"]');
  if (contractPriceEl) {
    contractPriceEl.addEventListener('input', () => {
      const contractPrice = parseFloat(contractPriceEl.value) || 0;
      document.querySelectorAll('#stagesContainer .stage-row').forEach(row => {
        const percent = parseFloat(row.querySelector('.stage-percent').value) || 0;
        if (percent > 0) {
          row.querySelector('.stage-amount').value = (contractPrice * percent / 100).toFixed(2);
        }
      });
      recalcConstructionFields();
    });
  }

  closeLoanForm.addEventListener('click', () => {
    loanFormSection.style.display = 'none';
  });

  // Add default loans
  btnAddDefaultLoans.addEventListener('click', addDefaultLoans);
  document.getElementById('btnRemoveDemoLoans').addEventListener('click', removeDemoLoans);

  const btnAddRateChange = document.getElementById('btnAddRateChange');
  if (btnAddRateChange) {
    btnAddRateChange.addEventListener('click', () => addRateRow());
  }

  // Jump to the What-If Payoff Modeler section further down this same page
  const btnJumpToWhatIf = document.getElementById('btnJumpToWhatIf');
  if (btnJumpToWhatIf) {
    btnJumpToWhatIf.addEventListener('click', () => {
      document.getElementById('loanWhatIfSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Form submission
  loanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const isConstruction = formData.get('type') === 'construction';
    // For a construction loan, Original Amount/Current Balance are
    // read-only in the form and kept in sync by recalcConstructionFields()
    // as stages are ticked drawn — re-derive them here too rather than
    // trusting the (possibly stale) field values, since JS could be
    // slower than the submit in edge cases.
    const stages = isConstruction ? getStageRowsData() : undefined;
    const facilityLimit = parseFloat(formData.get('originalAmount'));
    const constructionFees = parseFloat(formData.get('constructionFees')) || 0;

    const loanData = {
      name: formData.get('name'),
      type: formData.get('type'),
      originalAmount: facilityLimit,
      currentBalance: isConstruction ? sumDrawnStages(stages) : parseFloat(formData.get('currentBalance')),
      interestRate: parseFloat(formData.get('interestRate')),
      termMonths: parseInt(formData.get('termMonths')),
      startDate: formData.get('startDate'),
      paymentFrequency: formData.get('paymentFrequency'),
      interestOnlyMonths: parseInt(formData.get('interestOnlyMonths')) || 0,
      fixedRateEndDate: formData.get('fixedRateEndDate') || '',
      rateHistory: getRateRowsData(),
      currency: 'AUD',
      icon: getLoanIcon(formData.get('type')),
      institution: formData.get('institution') || '',
      institutionName: formData.get('institution') === 'other' ? (formData.get('institutionName') || '').trim() : '',
      propertyId: formData.get('propertyId') || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (isConstruction) {
      loanData.contractPrice = parseFloat(formData.get('contractPrice')) || 0;
      loanData.constructionFees = constructionFees;
      loanData.netAvailable = facilityLimit - constructionFees;
      loanData.stages = stages;
    }

    if (form.dataset.id) {
      // Editing existing loan
      loanData.id = form.dataset.id;
      await updateItem(STORE_NAMES.loans, loanData);
    } else {
      // Adding new loan
      loanData.id = generateId();
      await addItem(STORE_NAMES.loans, loanData);
    }

    loanFormSection.style.display = 'none';
    initLoansUI();
  });

  // Sorting
  sortSelect.addEventListener('change', () => {
    renderLoansList(loans, accounts, properties);
  });

  // Setup interest-only calculation
  setupInterestOnlyCalculation();

  const lenderSelect = document.querySelector('select[name="institution"]');
  if (lenderSelect) {
    lenderSelect.addEventListener('change', function() {
      document.getElementById('customLenderField').style.display = this.value === 'other' ? 'block' : 'none';
    });
  }
}

function setupInterestOnlyCalculation() {
  const interestOnlyInput = document.querySelector('input[name="interestOnlyMonths"]');
  const startDateInput = document.querySelector('input[name="startDate"]');
  const remainingInput = document.querySelector('input[name="remainingInterestOnlyMonths"]');

  if (interestOnlyInput && startDateInput && remainingInput) {
    const calculateRemaining = () => {
      const startDate = startDateInput.value;
      const interestOnlyMonths = parseInt(interestOnlyInput.value) || 0;
      
      if (startDate && interestOnlyMonths > 0) {
        const start = new Date(startDate);
        const now = new Date();
        const monthsPassed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
        const remaining = Math.max(interestOnlyMonths - monthsPassed, 0);
        remainingInput.value = remaining;
      } else {
        remainingInput.value = interestOnlyMonths;
      }
    };

    interestOnlyInput.addEventListener('input', calculateRemaining);
    startDateInput.addEventListener('change', calculateRemaining);
    
    // Calculate initial value
    calculateRemaining();
  }
}

function attachLoanCardEventListeners(loans) {
  // Payment button
  document.querySelectorAll('.payment-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const loanId = e.target.closest('.payment-btn').dataset.id;
      showPaymentModal(loanId);
    });
  });

  // Schedule button
  document.querySelectorAll('.schedule-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const loanId = e.target.closest('.schedule-btn').dataset.id;
      viewAmortizationSchedule(loanId);
    });
  });

  // Transactions button
  document.querySelectorAll('.transactions-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const loanId = e.target.closest('.transactions-btn').dataset.id;
      viewLoanTransactions(loanId);
    });
  });

  // Backfill button
  document.querySelectorAll('.backfill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const loanId = e.target.closest('.backfill-btn').dataset.id;
      showBackfillModal(loanId);
    });
  });

  // Edit button
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const loanId = e.target.closest('.edit-btn').dataset.id;
      openLoanEditor(loanId);
    });
  });

  // Delete button
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const loanId = e.target.closest('.delete-btn').dataset.id;
      const loan = loans.find(l => l.id === loanId);
      if (loan && confirm(`Are you sure you want to delete "${loan.name}"?`)) {
        await deleteItem(STORE_NAMES.loans, loanId);
        initLoansUI();
      }
    });
  });
}

// ============================================================================
// ✏️ Enhanced Loan Editor
// ============================================================================
function openLoanEditor(loanId) {
  getAllItems(STORE_NAMES.loans).then(loans => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    const loanFormSection = document.getElementById('loanFormSection');
    const loanForm = document.getElementById('loanForm');
    const loanFormTitle = document.getElementById('loanFormTitle');

    loanFormTitle.textContent = '✏️ Edit Loan';
    loanForm.name.value = loan.name;
    loanForm.type.value = loan.type;
    if (loanForm.institution) loanForm.institution.value = loan.institution || '';
    if (loanForm.institutionName) loanForm.institutionName.value = loan.institutionName || '';
    const customLenderField = document.getElementById('customLenderField');
    if (customLenderField) customLenderField.style.display = loan.institution === 'other' ? 'block' : 'none';
    loanForm.originalAmount.value = loan.originalAmount;
    loanForm.currentBalance.value = loan.currentBalance;
    loanForm.interestRate.value = loan.interestRate;
    loanForm.termMonths.value = loan.termMonths;
    loanForm.startDate.value = loan.startDate;
    loanForm.paymentFrequency.value = loan.paymentFrequency;
    loanForm.interestOnlyMonths.value = loan.interestOnlyMonths || 0;
    if (loanForm.fixedRateEndDate) loanForm.fixedRateEndDate.value = loan.fixedRateEndDate || '';
    if (loanForm.propertyId) loanForm.propertyId.value = loan.propertyId || '';
    loanForm.dataset.id = loan.id;

    const rateHistoryContainer = document.getElementById('rateHistoryContainer');
    if (rateHistoryContainer) rateHistoryContainer.innerHTML = '';
    (loan.rateHistory || []).forEach(r => addRateRow(r));

    const isConstruction = loan.type === 'construction';
    document.getElementById('stagesContainer').innerHTML = '';
    toggleConstructionFields(isConstruction, false);
    if (isConstruction) {
      loanForm.contractPrice.value = loan.contractPrice || '';
      loanForm.constructionFees.value = loan.constructionFees || '';
      (loan.stages || []).forEach(s => addStageRow(s));
      recalcConstructionFields();
    }

    // Calculate remaining interest-only months
    const remainingInput = document.querySelector('input[name="remainingInterestOnlyMonths"]');
    if (remainingInput && loan.interestOnlyMonths) {
      const monthsPassed = calculateMonthsPassed(loan.startDate);
      const remaining = Math.max(loan.interestOnlyMonths - monthsPassed, 0);
      remainingInput.value = remaining;
    }

    loanFormSection.style.display = 'block';
    loanFormSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ============================================================================
// 💳 Enhanced Payment Modal with Interest-Only Support
// ============================================================================
// Used by the live "Make Payment" modal — restricted to accounts that
// currently hold money, since you can't pay out of an empty account today.
async function populatePaymentAccounts(loanId) {
  const [accounts, transactions] = await Promise.all([
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions)
  ]);
  const select = document.getElementById('paymentAccount');
  select.innerHTML += accounts
    .map(a => ({ account: a, balance: computeAccountBalance(a, transactions) }))
    .filter(({ balance }) => balance > 0)
    .map(({ account: a, balance }) => `<option value="${a.id}">${escapeHtml(a.name)} (${formatCurrency(balance, a.currency)})</option>`)
    .join('');
}

// Used by the Backfill modal — deliberately NOT filtered by current
// balance, since we're recreating history: the account's balance *today*
// says nothing about whether it funded payments in the past (an offset
// account in particular is very often at or near $0 precisely because
// it's been funding the loan). Lists every cash-like account (bank,
// savings, cash, offset) and pre-selects the loan's own linked offset
// account when it has one, since that's almost always the right answer.
async function populateBackfillAccounts(loanId, loan) {
  const [accounts, transactions] = await Promise.all([
    getAllItems(STORE_NAMES.accounts),
    getAllItems(STORE_NAMES.transactions)
  ]);
  const select = document.getElementById('backfillAccount');
  const cashLike = accounts.filter(a => ['bank', 'savings', 'cash', 'offset'].includes(a.type));
  select.innerHTML += cashLike
    .map(a => {
      const balance = computeAccountBalance(a, transactions);
      const isOffsetForThisLoan = a.type === 'offset' && a.linkedLoanId === loanId;
      return `<option value="${a.id}" ${isOffsetForThisLoan ? 'selected' : ''}>${isOffsetForThisLoan ? '⚖️ ' : ''}${escapeHtml(a.name)} (${formatCurrency(balance, a.currency)})</option>`;
    })
    .join('');
}

async function calculatePaymentBreakdown(loanId, amount) {
  const loan = await getAllItems(STORE_NAMES.loans).then(ls => ls.find(l => l.id === loanId));
  if (!loan || amount <= 0) return;

  // Bug fix: this used a hard-coded monthly rate regardless of the loan's
  // actual paymentFrequency — same underlying bug as calculatePaymentAmount
  // in loanCalculations.js. A weekly/fortnightly/quarterly loan needs the
  // interest rate divided by ITS OWN number of periods per year, not 12.
  const periodsPerYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 }[loan.paymentFrequency] || 12;
  const periodRate = loan.interestRate / 100 / periodsPerYear;
  const interest = loan.currentBalance * periodRate;
  
  const principal = Math.min(amount - interest, loan.currentBalance);

  document.getElementById('paymentBreakdown').style.display = 'block';
  document.getElementById('breakdownPrincipal').textContent = formatCurrency(principal, loan.currency);
  document.getElementById('breakdownInterest').textContent = formatCurrency(interest, loan.currency);
  document.getElementById('breakdownTotal').textContent = formatCurrency(amount, loan.currency);
}

async function processLoanPaymentForm(loanId, modal) {
  const amount = parseFloat(document.getElementById('paymentAmount').value);
  const fromAccountId = document.getElementById('paymentAccount').value;
  const paymentDate = document.getElementById('paymentDate').value;
  if (!amount || !fromAccountId) return alert('Fill all fields');
  try {
    const res = await processLoanPayment(loanId, { amount, fromAccountId, paymentDate });
    const payLoan = (await getAllItems(STORE_NAMES.loans)).find(l => l.id === loanId);
    const message = `✅ Payment success!\nPrincipal: ${formatCurrency(res.principal, payLoan?.currency)}\nInterest: ${formatCurrency(res.interest, payLoan?.currency)}\nNew Balance: ${formatCurrency(res.newBalance, payLoan?.currency)}${res.isInterestOnly ? '\n(Interest Only Payment)' : ''}`;
    alert(message);
    modal.remove();
    initLoansUI();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function showPaymentModal(loanId) {
  getAllItems(STORE_NAMES.loans).then(loans => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    // Calculate interest-only status
    const isInterestOnly = isLoanInterestOnly(loan);
    const monthlyRate = loan.interestRate / 100 / 12;
    const interestOnlyPayment = loan.currentBalance * monthlyRate;
    const minimumPayment = isInterestOnly ? interestOnlyPayment : calculatePaymentAmount(loan);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>💳 Make Payment - ${escapeHtml(loan.name)}</h3>
          ${isInterestOnly ? '<div class="interest-only-alert">⚠️ This loan is in interest-only period</div>' : ''}
          <button class="btn btn-text close-modal">✕</button>
        </div>
        <form id="paymentForm" class="styled-form">
          <div class="form-group">
            <label class="form-label">Amount</label>
            <input type="number" id="paymentAmount" class="form-input" step="0.01" placeholder="0.00" value="${minimumPayment.toFixed(2)}" required min="${minimumPayment}">
            <small class="form-hint">Calculated ${loan.paymentFrequency || 'monthly'} payment: ${formatCurrency(minimumPayment, loan.currency)} ${isInterestOnly ? '(Interest Only)' : '(P&I)'} — pre-filled below, feel free to pay more.</small>
          </div>
          
          <div class="form-group">
            <label class="form-label">From Account</label>
            <select id="paymentAccount" class="form-select" required>
              <option value="">-- Select Account --</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Date</label>
            <input type="date" id="paymentDate" class="form-input" value="${new Date().toISOString().split('T')[0]}">
          </div>

          <div id="paymentBreakdown" class="payment-breakdown" style="display: none;">
            <h4>Payment Breakdown</h4>
            <div class="breakdown-item">
              <span>Principal:</span>
              <strong id="breakdownPrincipal">$0.00</strong>
            </div>
            <div class="breakdown-item">
              <span>Interest:</span>
              <strong id="breakdownInterest">$0.00</strong>
            </div>
            <div class="breakdown-item total">
              <span>Total Payment:</span>
              <strong id="breakdownTotal">$0.00</strong>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">💳 Process Payment</button>
            <button type="button" class="btn btn-secondary" id="cancelPayment">Cancel</button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);

    populatePaymentAccounts(loanId);

    // Event listeners
    document.getElementById('cancelPayment').onclick = () => modal.remove();
    document.querySelector('.close-modal').onclick = () => modal.remove();
    
    document.getElementById('paymentAmount').oninput = (e) =>
      calculatePaymentBreakdown(loanId, parseFloat(e.target.value) || 0);
    
    document.getElementById('paymentForm').onsubmit = async (e) => {
      e.preventDefault();
      await processLoanPaymentForm(loanId, modal);
    };

    // Close modal on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  });
}

// ============================================================================
// 📅 Enhanced Amortization Schedule with Interest-Only Support
// ============================================================================
function viewAmortizationSchedule(loanId) {
  getAllItems(STORE_NAMES.loans).then(loans => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    const schedule = calculateEnhancedAmortizationSchedule(loan);
    const totalInterest = schedule.reduce((sum, p) => sum + p.interest, 0);
    const totalPayments = schedule.reduce((sum, p) => sum + p.payment, 0);
    const finalPayment = schedule[schedule.length - 1];
    const payoffDate = finalPayment ? new Date(finalPayment.date).toLocaleDateString() : 'N/A';
    const interestOnlyPayments = schedule.filter(p => p.isInterestOnly).length;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content large">
        <div class="modal-header">
          <h3>📅 Amortization Schedule — ${escapeHtml(loan.name)}</h3>
          <button class="btn btn-text close-modal">✕</button>
        </div>

        <div class="schedule-summary-cards">
          <div class="summary-card">
            <div class="summary-value">${formatCurrency(loan.originalAmount, loan.currency)}</div>
            <div class="summary-label">Loan Amount</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${formatCurrency(totalInterest, loan.currency)}</div>
            <div class="summary-label">Total Interest</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${formatCurrency(totalPayments, loan.currency)}</div>
            <div class="summary-label">Total Payments</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${interestOnlyPayments}</div>
            <div class="summary-label">Interest-Only Payments</div>
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Payment</th>
                <th>Principal</th>
                <th>Interest</th>
                <th>Balance</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              ${schedule.slice(0, 12).map(p => `
                <tr class="${p.isInterestOnly ? 'interest-only-row' : ''}">
                  <td>${p.period}</td>
                  <td>${new Date(p.date).toLocaleDateString()}</td>
                  <td>${formatCurrency(p.payment, loan.currency)}</td>
                  <td>${formatCurrency(p.principal, loan.currency)}</td>
                  <td>${formatCurrency(p.interest, loan.currency)}</td>
                  <td>${formatCurrency(p.balance, loan.currency)}</td>
                  <td>${p.isInterestOnly ? 'Interest Only' : 'P&I'}</td>
                </tr>
              `).join('')}
              ${schedule.length > 12 ? `
                <tr class="schedule-more">
                  <td colspan="7" class="text-center">
                    ... and ${schedule.length - 12} more payments
                  </td>
                </tr>
              ` : ''}
            </tbody>
          </table>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" id="closeSchedule">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('closeSchedule').onclick = () => modal.remove();
    document.querySelector('.close-modal').onclick = () => modal.remove();
    
    // Close modal on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  });
}

// ============================================================================
// 🧾 Loan Transaction History (actual recorded payments, not a projection)
// ============================================================================
function viewLoanTransactions(loanId) {
  Promise.all([
    getAllItems(STORE_NAMES.loans),
    getAllItems(STORE_NAMES.loanTransactions)
  ]).then(([loans, allLoanTransactions]) => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    const payments = allLoanTransactions
      .filter(lt => lt.loanId === loanId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalPrincipal = payments.reduce((sum, p) => sum + (parseFloat(p.principal) || 0), 0);
    const totalInterest = payments.reduce((sum, p) => sum + (parseFloat(p.interest) || 0), 0);
    const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content large">
        <div class="modal-header">
          <h3>🧾 Transactions — ${escapeHtml(loan.name)}</h3>
          <button class="btn btn-text close-modal">✕</button>
        </div>

        <div class="schedule-summary-cards">
          <div class="summary-card">
            <div class="summary-value">${payments.length}</div>
            <div class="summary-label">Payments Made</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${formatCurrency(totalPrincipal, loan.currency)}</div>
            <div class="summary-label">Principal Paid</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${formatCurrency(totalInterest, loan.currency)}</div>
            <div class="summary-label">Interest Paid</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${formatCurrency(totalPaid, loan.currency)}</div>
            <div class="summary-label">Total Paid</div>
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Principal</th>
                <th>Interest</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              ${payments.length ? payments.map(p => `
                <tr class="${p.isInterestOnly ? 'interest-only-row' : ''}">
                  <td>${new Date(p.date).toLocaleDateString()}</td>
                  <td>${formatCurrency(p.amount, loan.currency)}</td>
                  <td>${formatCurrency(p.principal, loan.currency)}</td>
                  <td>${formatCurrency(p.interest, loan.currency)}</td>
                  <td>${p.isInterestOnly ? 'Interest Only' : 'P&I'}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="5" class="text-center">No payments recorded against this loan yet.</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" id="closeTransactions">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('closeTransactions').onclick = () => modal.remove();
    document.querySelector('.close-modal').onclick = () => modal.remove();

    // Close modal on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  });
}

// Enhanced amortization schedule with interest-only support
function calculateEnhancedAmortizationSchedule(loan) {
  const schedule = [];
  const monthlyRate = loan.interestRate / 100 / 12;
  let balance = loan.currentBalance;
  const startDate = new Date(loan.startDate);
  
  // Calculate months passed
  const now = new Date();
  const monthsPassed = (now.getFullYear() - startDate.getFullYear()) * 12 + 
                      (now.getMonth() - startDate.getMonth());
  
  const remainingInterestOnlyMonths = Math.max((loan.interestOnlyMonths || 0) - monthsPassed, 0);
  
  for (let period = 1; period <= loan.termMonths - monthsPassed; period++) {
    const periodDate = new Date(startDate);
    periodDate.setMonth(periodDate.getMonth() + monthsPassed + period);
    
    const interest = balance * monthlyRate;
    
    let principal, payment;
    const isInterestOnlyPeriod = period <= remainingInterestOnlyMonths;
    
    if (isInterestOnlyPeriod) {
      // Interest-only payment
      payment = interest;
      principal = 0;
    } else {
      // Standard P&I payment after interest-only period
      const remainingMonths = loan.termMonths - monthsPassed - remainingInterestOnlyMonths - (period - remainingInterestOnlyMonths - 1);
      payment = calculatePAndIPayment(balance, monthlyRate, remainingMonths);
      principal = payment - interest;
    }
    
    // Ensure we don't overpay in the final period
    if (principal > balance) {
      principal = balance;
      payment = principal + interest;
    }
    
    balance -= principal;
    
    schedule.push({
      period: monthsPassed + period,
      date: periodDate.toISOString().split('T')[0],
      payment,
      principal,
      interest,
      balance: Math.max(balance, 0),
      isInterestOnly: isInterestOnlyPeriod
    });
    
    if (balance <= 0) break;
  }
  
  return schedule;
}