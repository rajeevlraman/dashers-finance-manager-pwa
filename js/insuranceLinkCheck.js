// ============================================================================
// 🔗 insuranceLinkCheck.js — compare an insurance policy with its linked
// Bill / Recurring entry
// ============================================================================
// Pure functions (no DB, no DOM) so they can be unit-tested in node.
//
// A policy only stores a link id (policy.linkedRecurringId); its own premium,
// frequency and renewal date are separate fields. This module answers:
//   1. resolveLinkedItem  — which record does the link point at right now?
//   2. compareLinkedItem  — where do the two sides disagree?
//   3. the `sync` it returns — what the policy would become if the user
//      chooses "Sync from linked item".
//
// Vocabulary notes: policies use 'annual' | 'monthly'; bills use
// bill.recurring ('' = one-time, else weekly…annually); recurring entries use
// rec.frequency (weekly…annually).

const PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, halfyearly: 2, annually: 1 };
const FREQ_LABEL = {
    weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly',
    quarterly: 'quarterly', halfyearly: 'half-yearly', annually: 'annually'
};

const EPS = 0.005; // half a cent

const round2 = n => Math.round(n * 100) / 100;

// Finds the record the policy's link currently refers to.
// Paying a recurring Bill marks it paid and creates a NEW bill record for the
// next cycle (new id), so a link to a bill id goes stale after every payment.
// When the linked bill is paid and recurring, follow it to the live (unpaid)
// bill with the same name and cadence — the earliest due one.
// Returns { kind: 'recurring'|'bill'|null, item, followed } where `followed`
// is true when we hopped from a paid bill to its successor.
export function resolveLinkedItem(linkedId, recurringList = [], billList = []) {
    if (!linkedId) return { kind: null, item: null, followed: false };

    const rec = recurringList.find(r => r.id === linkedId);
    if (rec) return { kind: 'recurring', item: rec, followed: false };

    const bill = billList.find(b => b.id === linkedId);
    if (!bill) return { kind: null, item: null, followed: false };

    if (bill.paid && bill.recurring) {
        const successors = billList
            .filter(b => !b.paid && b.id !== bill.id && b.name === bill.name && b.recurring === bill.recurring)
            .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
        if (successors.length) return { kind: 'bill', item: successors[0], followed: true };
    }
    return { kind: 'bill', item: bill, followed: false };
}

function linkedFrequency(kind, item) {
    return kind === 'bill' ? (item.recurring || '') : (item.frequency || '');
}

// opts: { policyCurrency, linkedCurrency, formatMoney(amount, currency), formatDate(isoDate) }
// Returns { issues: [{ level: 'warn'|'info', text }], sync: null | { premiumAmount, paymentFrequency, renewalDate?, summary: [string] } }
export function compareLinkedItem(policy, kind, item, opts = {}) {
    const fmt = opts.formatMoney || ((n) => String(round2(n)));
    const fmtDate = opts.formatDate || (d => d);
    const issues = [];
    if (!policy || !item || !kind) return { issues, sync: null };

    const premium = Number(policy.premiumAmount) || 0;
    const policyFreq = policy.paymentFrequency === 'monthly' ? 'monthly' : 'annually';
    const policyPerYear = PER_YEAR[policyFreq];
    const policyAnnual = premium * policyPerYear;

    const amount = Number(item.amount) || 0;
    const freq = linkedFrequency(kind, item);
    const linkedPerYear = PER_YEAR[freq] || null; // null = one-time
    const linkedAnnual = linkedPerYear ? amount * linkedPerYear : null;

    const sameCurrency = !opts.policyCurrency || !opts.linkedCurrency || opts.policyCurrency === opts.linkedCurrency;
    const pCur = opts.policyCurrency;
    const lCur = opts.linkedCurrency;
    let compareAmounts = true;

    if (kind === 'recurring' && item.type === 'income') {
        issues.push({ level: 'warn', text: 'The linked recurring entry is income, not an expense.' });
        compareAmounts = false;
    }

    if (!sameCurrency) {
        issues.push({ level: 'info', text: `Currencies differ (policy ${pCur}, linked ${lCur}) — amounts not compared.` });
        compareAmounts = false;
    }

    // --- Frequency -------------------------------------------------------
    let freqDiffers = false;
    if (!freq) {
        freqDiffers = true;
        issues.push({ level: 'warn', text: kind === 'bill'
            ? 'The linked bill is one-time, so it won\u2019t come around again next cycle.'
            : 'The linked entry has no frequency.' });
    } else if (freq !== policyFreq) {
        freqDiffers = true;
        let text = `Frequency differs: policy is ${FREQ_LABEL[policyFreq]}, linked item is ${FREQ_LABEL[freq] || freq}.`;
        const totalsMatch = compareAmounts && linkedAnnual !== null && Math.abs(linkedAnnual - policyAnnual) < EPS * 12;
        if (totalsMatch) text += ' (Yearly totals match.)';
        issues.push({ level: totalsMatch ? 'info' : 'warn', text });
    }

    // --- Amount ----------------------------------------------------------
    if (compareAmounts) {
        if (!freqDiffers) {
            if (Math.abs(amount - premium) >= EPS) {
                issues.push({ level: 'warn', text: `Amount differs: policy ${fmt(premium, pCur)}, linked item ${fmt(amount, lCur)}.` });
            }
        } else if (linkedAnnual !== null) {
            if (Math.abs(linkedAnnual - policyAnnual) >= EPS * 12) {
                issues.push({ level: 'warn', text: `Yearly cost differs: policy ${fmt(policyAnnual, pCur)}/yr, linked item ${fmt(linkedAnnual, lCur)}/yr.` });
            }
        } else if (Math.abs(amount - premium) >= EPS) {
            // one-time bill: compare the single payment with the policy premium
            issues.push({ level: 'warn', text: `Amount differs: policy ${fmt(premium, pCur)}, linked bill ${fmt(amount, lCur)}.` });
        }
    }

    // --- Renewal date (only meaningful for an annual policy + annual bill) -
    const billDate = kind === 'bill' ? item.dueDate : '';
    const dateComparable = kind === 'bill' && freq === 'annually' && policyFreq === 'annually' && policy.renewalDate && billDate;
    const dateDiffers = !!dateComparable && policy.renewalDate !== billDate;
    if (dateDiffers) {
        issues.push({ level: 'warn', text: `Renewal date differs: policy ${fmtDate(policy.renewalDate)}, bill due ${fmtDate(billDate)}.` });
    }

    // --- What "Sync from linked item" would do ---------------------------
    // Only offered when there's something to copy and it's safe to compare
    // (not income, same currency, has a frequency).
    let sync = null;
    if (compareAmounts && freq && amount > 0) {
        let newPremium, newFreq;
        if (freq === 'monthly') { newPremium = amount; newFreq = 'monthly'; }
        else if (freq === 'annually') { newPremium = amount; newFreq = 'annual'; }
        else { newPremium = round2(linkedAnnual); newFreq = 'annual'; } // weekly/fortnightly/quarterly/half-yearly → yearly total
        const newDate = dateDiffers ? billDate : null;

        const changes = [];
        if (Math.abs(newPremium - premium) >= EPS) changes.push(`Premium: ${fmt(premium, pCur)} → ${fmt(newPremium, pCur)}`);
        const oldFreqKey = policy.paymentFrequency === 'monthly' ? 'monthly' : 'annual';
        if (newFreq !== oldFreqKey) changes.push(`Frequency: ${oldFreqKey === 'monthly' ? 'monthly' : 'annual'} → ${newFreq === 'monthly' ? 'monthly' : 'annual'}`);
        if (newDate) changes.push(`Renewal date: ${fmtDate(policy.renewalDate)} → ${fmtDate(newDate)}`);

        if (changes.length) {
            sync = { premiumAmount: newPremium, paymentFrequency: newFreq, renewalDate: newDate, summary: changes };
            if (!['monthly', 'annually'].includes(freq)) {
                sync.note = `The linked item is ${FREQ_LABEL[freq]}; the policy can only be monthly or annual, so the yearly total is used.`;
            }
        }
    }

    return { issues, sync };
}
