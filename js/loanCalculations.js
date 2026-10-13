// loanCalculations.js
//
// Bug fixes: calculatePaymentAmount() previously always used a hard-coded
// monthly rate (interestRate/100/12) and the loan's full original term
// regardless of paymentFrequency, so it silently returned the MONTHLY
// payment amount even for a weekly/fortnightly/quarterly loan, and never
// changed if you edited the frequency. calculateAmortizationSchedule()
// always replayed from originalAmount/startDate, so it looked "frozen" —
// it never reflected any payments actually made since. Both are fixed to
// work in the loan's own payment period (not just months) and to project
// forward from the loan's CURRENT balance and today's date, so they stay
// accurate as the loan gets paid down and respond correctly to a
// frequency change.
//
// Note: elapsed periods are approximated from the loan's startDate and
// today's date (assuming payments happened on schedule), not from a count
// of actually recorded payments. For a loan being paid exactly on time
// this is exact; for one with irregular extra/missed payments it's a
// reasonable approximation rather than a perfectly precise figure.
//
// Bug fix: calculatePaymentAmount() used to ignore loan.interestOnlyMonths
// completely and always return a full P&I payment — even while a loan was
// still inside its interest-only window. That silently disagreed with the
// amortization schedule (which does honor interestOnlyMonths) and made
// every "current payment due" figure derived from this function wrong for
// interest-only loans (recurring-transaction auto-fill, loan card "next
// payment", total monthly payments). It now returns the interest-only
// amount while isInterestOnlyPeriod(loan) is true, and falls back to the
// normal amortized payment once that window has passed.

export function isInterestOnlyPeriod(loan, asOfDateStr = new Date().toISOString().split('T')[0]) {
  if (!loan.interestOnlyMonths) return false;
  // Interest-only windows are always specified in months, regardless of
  // the loan's paymentFrequency, so elapsed time is measured in months.
  return getElapsedPeriods(loan.startDate, 'monthly', asOfDateStr) < loan.interestOnlyMonths;
}

// ---------------------------------------------------------------------------
// Rate history
// ---------------------------------------------------------------------------
// A loan's rateHistory (optional) is a list of { date: 'YYYY-MM-DD', rate: N }
// entries — one per time the rate changed. This lets a loan whose rate has
// moved over its life be replayed accurately instead of assuming a single
// flat rate the whole way, while staying fully backward compatible: a loan
// with no rateHistory (or an empty one) just falls back to its plain
// interestRate field everywhere, exactly as before.

// The rate that was/is in effect on a given date, per the loan's
// rateHistory. Falls back to loan.interestRate if there's no history, or
// if every entry is dated after the date in question (i.e. before the
// loan's first recorded rate).
export function getRateForDate(loan, dateStr) {
  const history = Array.isArray(loan.rateHistory) ? loan.rateHistory : [];
  if (history.length === 0) return loan.interestRate;

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  let applicable = null;
  for (const entry of sorted) {
    if (entry.date <= dateStr) {
      applicable = entry;
    } else {
      break;
    }
  }
  return applicable ? applicable.rate : loan.interestRate;
}

// The rate in effect today — used anywhere that previously read
// loan.interestRate directly for a "current" figure, so a loan with a
// rateHistory stays correct even if its flat interestRate field is stale.
export function getCurrentRate(loan) {
  return getRateForDate(loan, new Date().toISOString().split('T')[0]);
}

function getPaymentsPerYear(frequency) {
  const frequencies = {
    weekly: 52,
    fortnightly: 26,
    monthly: 12,
    quarterly: 4
  };
  return frequencies[frequency] || 12;
}

function getElapsedPeriods(startDate, frequency, asOfDateStr) {
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return 0; // no/invalid start date — treat as not yet started
  const now = asOfDateStr ? new Date(asOfDateStr) : new Date();
  const daysElapsed = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));

  switch (frequency) {
    case 'weekly':
      return Math.floor(daysElapsed / 7);
    case 'fortnightly':
      return Math.floor(daysElapsed / 14);
    case 'quarterly': {
      const monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      return Math.floor(monthsElapsed / 3);
    }
    case 'monthly':
    default:
      return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  }
}

function advanceDateByFrequency(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'fortnightly':
      d.setDate(d.getDate() + 14);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

// The periodic payment amount (in whatever unit paymentFrequency is —
// weekly/fortnightly/monthly/quarterly), calculated from the loan's
// CURRENT remaining balance and remaining term rather than its original
// amount and full original term. For a loan being paid exactly on
// schedule this returns the same figure calculateAmortizationSchedule
// would have projected from day one (the math works out identically) —
// the difference shows up once real payments (extra, missed, or
// interest-only periods) have actually happened, or when the frequency
// itself is edited.
export function calculatePaymentAmount(loan, asOfDateStr = new Date().toISOString().split('T')[0]) {
  const { currentBalance, originalAmount, termMonths, startDate, paymentFrequency } = loan;
  const periodsPerYear = getPaymentsPerYear(paymentFrequency);
  // Uses whichever rate is in effect today per rateHistory (falls back to
  // the plain interestRate field when there's no history), so a loan whose
  // rate has changed doesn't keep quoting a stale payment amount.
  const periodRate = (getRateForDate(loan, asOfDateStr) / 100) / periodsPerYear;
  const balance = currentBalance ?? originalAmount;

  // While the loan is inside its interest-only window, the payment
  // actually due is just interest on the current balance — there's no
  // principal component to amortize yet.
  if (isInterestOnlyPeriod(loan, asOfDateStr)) {
    return balance * periodRate;
  }

  const totalTermPeriods = Math.max(Math.round((termMonths / 12) * periodsPerYear), 1);
  const elapsedPeriods = getElapsedPeriods(startDate, paymentFrequency, asOfDateStr);
  const remainingPeriods = Math.max(totalTermPeriods - elapsedPeriods, 1);

  if (periodRate === 0) {
    return balance / remainingPeriods;
  }

  return balance * periodRate * Math.pow(1 + periodRate, remainingPeriods) /
         (Math.pow(1 + periodRate, remainingPeriods) - 1);
}

// The actual minimum a bank would require for this loan on a given due
// date — the number "Always pay the loan's current minimum" on a Recurring
// entry uses, so a linked recurring payment tracks reality instead of a
// number typed in once when the entry was created and never revisited.
//
// Interest-only: the minimum is just that period's accrued interest — and
// unlike a fixed P&I payment, this genuinely is reduced by a linked offset
// account, since the offset account lowers the interest that actually
// accrues. Pass offsetBalance to reflect that.
//
// Principal & Interest: the minimum is the loan's contractual level
// payment (calculatePaymentAmount) — NOT reduced by an offset account.
// Having money in offset doesn't lower the required repayment on a P&I
// loan, it just means more of that same fixed payment goes to principal
// instead of interest each period (see processLoanPayment's split) — so
// offsetBalance is deliberately not applied here.
export function calculateMinimumRepayment(loan, { asOfDateStr = new Date().toISOString().split('T')[0], offsetBalance = 0 } = {}) {
  if (isInterestOnlyPeriod(loan, asOfDateStr)) {
    const periodsPerYear = getPaymentsPerYear(loan.paymentFrequency);
    const periodRate = (getRateForDate(loan, asOfDateStr) / 100) / periodsPerYear;
    const balance = loan.currentBalance ?? loan.originalAmount;
    const interestBearingBalance = Math.max(balance - offsetBalance, 0);
    return interestBearingBalance * periodRate;
  }
  return calculatePaymentAmount(loan, asOfDateStr);
}

// Projects the schedule forward from the loan's CURRENT balance and
// today's date (not the original amount/start date), advancing by however
// many periods remain in the term at the loan's own paymentFrequency.
export function calculateAmortizationSchedule(loan) {
  const { termMonths, startDate, paymentFrequency } = loan;
  const periodsPerYear = getPaymentsPerYear(paymentFrequency);
  const periodRate = (getCurrentRate(loan) / 100) / periodsPerYear;
  const payment = calculatePaymentAmount(loan);

  const totalTermPeriods = Math.max(Math.round((termMonths / 12) * periodsPerYear), 1);
  const elapsedPeriods = getElapsedPeriods(startDate, paymentFrequency);
  const remainingPeriods = Math.max(totalTermPeriods - elapsedPeriods, 1);

  const schedule = [];
  let balance = loan.currentBalance ?? loan.originalAmount;
  let currentDate = new Date();

  for (let i = 1; i <= remainingPeriods; i++) {
    if (balance <= 0) break;

    const interest = balance * periodRate;
    const principal = Math.min(payment - interest, balance);

    schedule.push({
      period: i,
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      balance: Math.max(0, balance - principal)
    });

    balance -= principal;
    currentDate = advanceDateByFrequency(currentDate, paymentFrequency);
  }

  return schedule;
}

export function calculateNextPayment(loan) {
  const schedule = calculateAmortizationSchedule(loan);
  const nextPayment = schedule.find(p => p.balance >= 0);

  if (!nextPayment) {
    return { amount: 0, dueDate: 'Paid off' };
  }

  return {
    amount: nextPayment.payment,
    dueDate: formatDate(nextPayment.date)
  };
}

// Total interest remaining to be paid from today through payoff, based on
// the loan's current balance — not the total interest over its entire
// original life (which stayed fixed and wouldn't reflect any payments
// made since the loan started).
export function calculateTotalInterest(loan) {
  const schedule = calculateAmortizationSchedule(loan);
  return schedule.reduce((total, payment) => total + payment.interest, 0);
}

// Replays a loan's entire life from startDate through today, one payment
// period at a time, using whichever rate was actually in effect for each
// period per rateHistory — rather than assuming a single flat rate the
// whole way. This is what powers "backfill my transaction history".
//
// Behaviour when the rate changes mid-loan: like a real bank does, the
// payment amount is recalculated at that point to fully amortize the
// remaining balance over the remaining term at the new rate — so the
// payment can step up/down at each rate-change boundary rather than
// staying fixed at the original figure.
//
// Assumes every period was paid on schedule in full (no missed/extra
// payments) — the same assumption calculateAmortizationSchedule already
// makes for the future. Returns only PAST periods (startDate..today), not
// a future projection.
export function calculateHistoricalSchedule(loan) {
  const { originalAmount, termMonths, startDate, paymentFrequency } = loan;
  const periodsPerYear = getPaymentsPerYear(paymentFrequency);
  const totalTermPeriods = Math.max(Math.round((termMonths / 12) * periodsPerYear), 1);

  const start = new Date(startDate);
  if (isNaN(start.getTime())) return [];
  const elapsedPeriods = Math.min(getElapsedPeriods(startDate, paymentFrequency), totalTermPeriods);
  if (elapsedPeriods <= 0) return [];

  const startDateStr = start.toISOString().split('T')[0];
  let balance = originalAmount;
  let remainingPeriods = totalTermPeriods;
  let currentRate = getRateForDate(loan, startDateStr);
  let periodRate = (currentRate / 100) / periodsPerYear;
  let payment = isInterestOnlyPeriod(loan)
    ? balance * periodRate
    : computeLevelPayment(balance, periodRate, remainingPeriods);

  const schedule = [];
  let periodDate = new Date(start);

  for (let i = 1; i <= elapsedPeriods; i++) {
    if (balance <= 0) break;
    const dateStr = periodDate.toISOString().split('T')[0];

    const inInterestOnly = loan.interestOnlyMonths &&
      ((periodDate.getFullYear() - start.getFullYear()) * 12 + (periodDate.getMonth() - start.getMonth())) < loan.interestOnlyMonths;

    const rateToday = getRateForDate(loan, dateStr);
    if (rateToday !== currentRate) {
      // Rate changed as of this period — re-amortize the payment over
      // whatever term remains, at the new rate.
      currentRate = rateToday;
      periodRate = (currentRate / 100) / periodsPerYear;
      if (!inInterestOnly) {
        payment = computeLevelPayment(balance, periodRate, remainingPeriods);
      }
    }

    const interest = balance * periodRate;
    let principal;
    let actualPayment;
    if (inInterestOnly) {
      principal = 0;
      actualPayment = interest;
    } else {
      principal = Math.min(payment - interest, balance);
      actualPayment = payment;
    }

    balance = Math.max(0, balance - principal);
    remainingPeriods = Math.max(remainingPeriods - 1, 1);

    schedule.push({
      period: i,
      date: dateStr,
      rate: currentRate,
      payment: actualPayment,
      principal,
      interest,
      balance,
      isInterestOnly: !!inInterestOnly
    });

    periodDate = advanceDateByFrequency(periodDate, paymentFrequency);
  }

  return schedule;
}

// Standard level-payment formula for a given balance/period-rate/number-of-
// remaining-periods — the same formula calculatePaymentAmount uses, factored
// out so calculateHistoricalSchedule can re-run it at each rate change.
function computeLevelPayment(balance, periodRate, remainingPeriods) {
  if (remainingPeriods <= 0) return balance;
  if (periodRate === 0) return balance / remainingPeriods;
  return balance * periodRate * Math.pow(1 + periodRate, remainingPeriods) /
         (Math.pow(1 + periodRate, remainingPeriods) - 1);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// ---------------------------------------------------------------------------
// What-If Payoff Modeler (Loans page)
// ---------------------------------------------------------------------------
// Separate from the functions above on purpose: those work off a *saved*
// loan record (currentBalance, elapsed periods from startDate, its own
// paymentFrequency). This modeler takes plain, freely-editable inputs —
// which may have been pre-filled from a saved loan, or typed from scratch
// for a loan that doesn't exist yet — and always projects in calendar
// months, since "an extra $X a month" is naturally a monthly concept
// regardless of what frequency the underlying loan actually bills on.

// Standard fully-amortizing monthly P&I payment for a fresh balance/rate/
// term combination (i.e. what calculatePaymentAmount would return for a
// brand-new monthly loan with no payments made yet).
export function calculateMonthlyPayment(balance, annualRatePct, termMonths) {
  const monthlyRate = (annualRatePct / 100) / 12;
  if (termMonths <= 0) return Math.max(balance, 0);
  if (monthlyRate === 0) return balance / termMonths;
  return balance * monthlyRate * Math.pow(1 + monthlyRate, termMonths) /
         (Math.pow(1 + monthlyRate, termMonths) - 1);
}

// Projects one month-by-month schedule at a fixed payment (the standard
// P&I amount plus whatever flat extraMonthly is passed, 0 for the
// "standard" line). Stops the moment the balance is paid off rather than
// marching out to the full term, so payoffMonths naturally comes out
// shorter when extraMonthly > 0. The termMonths*2 cap is just a safety
// net against a pathological input (e.g. a rate that would never
// amortize) — real schedules always finish well before that.
function buildWhatIfSchedule(balance, annualRatePct, termMonths, extraMonthly, startDate) {
  const monthlyRate = (annualRatePct / 100) / 12;
  const basePayment = calculateMonthlyPayment(balance, annualRatePct, termMonths);
  const payment = basePayment + Math.max(extraMonthly, 0);

  const schedule = [];
  let remaining = Math.max(balance, 0);
  let cumulativeInterest = 0;
  const date = new Date(startDate);
  const safetyCap = Math.max(termMonths * 2, 12);

  for (let i = 1; i <= safetyCap && remaining > 0.005; i++) {
    const interest = remaining * monthlyRate;
    let principal = payment - interest;
    let actualPayment = payment;
    if (principal >= remaining) {
      principal = remaining;
      actualPayment = principal + interest;
    }
    remaining = Math.max(0, remaining - principal);
    cumulativeInterest += interest;
    schedule.push({
      period: i,
      date: new Date(date),
      payment: actualPayment,
      principal,
      interest,
      balance: remaining,
      cumulativeInterest
    });
    date.setMonth(date.getMonth() + 1);
  }

  return { schedule, basePayment, effectivePayment: payment };
}

// Runs both the standard schedule (extraMonthly forced to 0, over the
// entered term) and the with-extra-payment schedule side by side, so the
// UI can show payoff time / total interest for each and the difference
// between them. startDate can be a Date or an ISO-ish "YYYY-MM(-DD)"
// string; only its year/month are used.
export function calculateWhatIf({ balance, annualRatePct, termYears, extraMonthly = 0, startDate }) {
  const safeBalance = Math.max(parseFloat(balance) || 0, 0);
  const safeRate = Math.max(parseFloat(annualRatePct) || 0, 0);
  const termMonths = Math.max(Math.round((parseFloat(termYears) || 0) * 12), 1);
  const safeExtra = Math.max(parseFloat(extraMonthly) || 0, 0);
  const start = startDate ? new Date(startDate) : new Date();

  const standard = buildWhatIfSchedule(safeBalance, safeRate, termMonths, 0, start);
  const withExtra = safeExtra > 0
    ? buildWhatIfSchedule(safeBalance, safeRate, termMonths, safeExtra, start)
    : standard;

  const totalInterestStandard = standard.schedule.reduce((sum, p) => sum + p.interest, 0);
  const totalInterestExtra = withExtra.schedule.reduce((sum, p) => sum + p.interest, 0);

  return {
    balance: safeBalance,
    monthlyPayment: standard.basePayment,
    effectivePayment: withExtra.effectivePayment,
    standardSchedule: standard.schedule,
    extraSchedule: withExtra.schedule,
    payoffMonthsStandard: standard.schedule.length,
    payoffMonthsExtra: withExtra.schedule.length,
    totalInterestStandard,
    totalInterestExtra,
    interestSaved: Math.max(totalInterestStandard - totalInterestExtra, 0),
    monthsSaved: Math.max(standard.schedule.length - withExtra.schedule.length, 0)
  };
}

// ============================================================================
// 💰 Offset Savings — pure calculation, used by the Tax page's Offset
// Savings calculator (js/tax_compliance.js). Split out here (rather than
// inlined in the UI module) so it can be unit tested the same way as the
// other loan math in this file.
// ============================================================================
export function calculateOffsetSavings({ balance, rate, offsetAmount }) {
  const safeBalance = Math.max(parseFloat(balance) || 0, 0);
  const safeRate = Math.max(parseFloat(rate) || 0, 0);
  const safeOffset = Math.max(parseFloat(offsetAmount) || 0, 0);

  const effectiveOffset = Math.min(safeOffset, safeBalance);
  const monthlyRate = safeRate / 100 / 12;
  const monthlySaving = effectiveOffset * monthlyRate;

  return {
    interestBearingBalance: Math.max(safeBalance - effectiveOffset, 0),
    monthlySaving,
    annualSaving: monthlySaving * 12,
    offsetExceedsBalance: safeOffset > safeBalance
  };
}

// ============================================================================
// 🔁 Refinance Break-Even — pure calculation, used by the Tax page's
// Refinance Break-Even calculator (js/tax_compliance.js). Current and new
// rate use the same remaining term, since a refinance against the same
// balance/term isolates the rate's effect on repayment.
// ============================================================================
export function calculateRefinanceBreakEven({ balance, currentRate, remainingYears, newRate, exitFee = 0, newFees = 0, cashback = 0 }) {
  const safeBalance = Math.max(parseFloat(balance) || 0, 0);
  const safeCurrentRate = Math.max(parseFloat(currentRate) || 0, 0);
  const safeNewRate = Math.max(parseFloat(newRate) || 0, 0);
  const safeYears = Math.max(parseFloat(remainingYears) || 0, 1 / 12);

  const currentRepayment = calculateMonthlyPayment(safeBalance, safeCurrentRate, safeYears * 12);
  const newRepayment = calculateMonthlyPayment(safeBalance, safeNewRate, safeYears * 12);
  const monthlySaving = currentRepayment - newRepayment;
  const switchingCost = (parseFloat(exitFee) || 0) + (parseFloat(newFees) || 0) - (parseFloat(cashback) || 0);
  const breakEvenMonths = monthlySaving > 0 ? switchingCost / monthlySaving : null;

  return { currentRepayment, newRepayment, monthlySaving, switchingCost, breakEvenMonths };
}

// ============================================================================
// 🎯 Debt Payoff Order — pure calculation, used by the Tax page's Debt
// Payoff Order calculator (js/tax_compliance.js). Takes a plain array of
// debts (already resolved from real loans/credit accounts by the caller,
// since that resolution needs IndexedDB/account data this module doesn't
// have) and returns both orderings — no DOM, no fetching, easy to test.
// ============================================================================
export function rankDebtPayoffOrder(debts) {
  const safeDebts = (debts || []).map(d => ({
    ...d,
    balance: parseFloat(d.balance) || 0,
    rate: parseFloat(d.rate) || 0,
    minPayment: parseFloat(d.minPayment) || 0
  }));

  const avalanche = [...safeDebts].sort((a, b) => b.rate - a.rate);
  const snowball = [...safeDebts].sort((a, b) => a.balance - b.balance);
  const totalMinPayments = safeDebts.reduce((sum, d) => sum + d.minPayment, 0);

  return {
    avalanche,
    snowball,
    totalMinPayments,
    topAvalanche: avalanche[0] || null,
    topSnowball: snowball[0] || null
  };
}
