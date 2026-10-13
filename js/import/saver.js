// ============================================================================
// 💾 import/saver.js — Save Imported Transactions with De-duplication
// ============================================================================

import { STORE_NAMES, addItem, getAllItems, updateItem } from '../db.js';
import { withAud } from '../utils/currency.js';
import { findGeneratedTransactionFor, findLegacyLoanPaymentFor } from '../recurringMatch.js';
import { logImportDebug } from './debug.js';
import { buildCategoryIndex, autoAssignCategory } from './categoryRules.js';
import {
  suggestCategoryForTransaction,
  resolveTransactionSemantics,
  matchPropertyForTransaction,
  matchPropertyByAccount,
  findLearnedPropertyForTransaction,
  isConfirmedNonPropertyExpense
} from './categoryMapper.js';
import { getExpenseCategoryBucket } from '../propertyExpenseCategories.js';

export async function saveImportedTransactions(transactions, options = {}) {
  const { dedupe = true } = options;

  logImportDebug('saveImportedTransactions: starting', {
    count: transactions.length,
    dedupe
  });

  if (!transactions.length) {
    return { saved: 0, skipped: 0 };
  }

  const accountId = transactions[0].accountId;

  // Load existing tx + categories + properties + accounts in parallel
  const [existing, categories, properties, accounts, loanPayments] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.categories).catch(() => []),
    getAllItems(STORE_NAMES.properties).catch(() => []),
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.loanTransactions).catch(() => [])
  ]);

  const existingForAccount = existing.filter(tx => tx.accountId === accountId);
  const categoryIndex = buildCategoryIndex(categories);

  logImportDebug('Existing transactions for account', existingForAccount.length);

  let saved = 0;
  let skipped = 0;
  let enriched = 0;
  let reconciledCount = 0;

  for (const tx of transactions) {
    // 🔹 Auto-assign category IF missing.
    //
    // Bug fix: this used to ONLY call autoAssignCategory() (categoryRules.js),
    // which matches your CATEGORY NAMES against the transaction text — that
    // only works if a category name like "groceries" literally appears in
    // the bank description, which real merchant names (Woolworths, KFC,
    // Bunnings...) essentially never do. The proper vendor-name-based
    // matcher (categoryMapper.js, mapping actual merchant keywords to
    // categories) existed but was never wired into the import flow at all.
    //
    // Now: try the vendor/merchant matcher FIRST (merchant rules → bank's
    // own category column if present → known merchant keywords), and only
    // fall back to the category-name matcher if that comes up empty —
    // best of both rather than replacing one with the other.
    if (!tx.categoryId) {
      // Bug fix: this always passed an empty options object, so
      // BANK_CATEGORY_MAP_BY_BANK (bank-specific overrides, as opposed to
      // the generic cross-bank map) was silently dead code - bankId was
      // always undefined. Deriving it from tx.source ("NAB Import" -> "nab")
      // lets bank-specific mappings actually take effect.
      const bankId = (tx.source || '').split(' ')[0].toLowerCase();
      const { categoryId: vendorCategoryId, source } = suggestCategoryForTransaction(
        tx,
        tx.bankCategory || null,
        { bankId }
      );

      if (vendorCategoryId && source !== 'fallback') {
        tx.categoryId = vendorCategoryId;
        tx.categorySource = source;
      } else if (categories.length && categoryIndex.length) {
        const autoCatId = autoAssignCategory(tx, categories, categoryIndex);
        if (autoCatId) {
          tx.categoryId = autoCatId;
          tx.categorySource = 'category_name_match';
        }
      }
    }

    // 🔹 Bug fix: transaction type used to be whatever parser.js derived
    // from the raw amount sign - see the comment above
    // resolveTransactionSemantics() in categoryMapper.js for why that's
    // unreliable for loan/redraw/offset accounts. Applied AFTER categoryId
    // is finalized above (whether it came from the vendor matcher, the
    // category-name fallback, or was already set) since the correction
    // depends on which category the transaction actually landed in.
    // accountType is passed so a BPAY payment landing on one of the user's
    // own tracked credit accounts can be recognized as a card repayment
    // (a transfer) rather than a bill (a real expense) - see
    // CREDIT_CARD_PAYMENT_CATEGORY_IDS in categoryMapper.js.
    const txAccount = accounts.find(a => a.id === tx.accountId);
    const semantics = resolveTransactionSemantics(tx.categoryId, tx.type, categories, {
      amount: tx.amount,
      accountType: txAccount?.type
    });
    tx.type = semantics.type;
    tx.isTransfer = semantics.isTransfer;

    // 🔹 Feature: auto-link rental income and property expenses to a
    // property. Only attempted for rental income (a specific, reliable
    // category) and for real expenses (never transfers - a transfer's
    // description is usually just "General Transfer" with nothing useful
    // to match on anyway). This is what lets the Expenses page's "Sync
    // from Transactions" button, and the property card's maintenance/
    // expense totals, actually find these without hand-tagging every row.
    //
    // Bug fix: this used to ONLY try matching the property's street
    // address against the transaction description
    // (matchPropertyForTransaction) - in practice almost no real bank
    // description contains a property's street address (a council rates
    // direct debit, a landlord insurance premium, a property manager's fee
    // statement all just show the payee's name), so this essentially never
    // fired for real imports. Now tries, in order of reliability:
    //   1. Dedicated account link (account.linkedPropertyId) - exact, no
    //      guessing, covers anyone with a separate loan/transaction
    //      account per property.
    //   2. Learned merchant+account rule - covers a shared account where
    //      the same merchant (e.g. one managing agent, one council) has
    //      previously been manually tagged to a specific property on this
    //      account; never applied if that combination has since proven
    //      ambiguous (tagged to more than one property).
    //   3. Address match (original behaviour) - kept as a fallback for the
    //      rare transaction that does spell out the address. Skipped
    //      entirely when this exact merchant+account(+amount) was already
    //      confirmed NOT a property expense (e.g. the same water corp also
    //      bills the person's own home) - see isConfirmedNonPropertyExpense
    //      in categoryMapper.js - so a corrected transaction can't get
    //      re-flagged by a weaker signal on the next import.
    if (properties.length && !tx.isTransfer && (tx.categoryId === 'sub_rental_income' || tx.type === 'expense')) {
      const matchedProperty =
        matchPropertyByAccount(tx, accounts, properties) ||
        findLearnedPropertyForTransaction(tx, properties) ||
        (!isConfirmedNonPropertyExpense(tx) ? matchPropertyForTransaction(tx, properties) : null);

      if (matchedProperty) {
        tx.propertyId = matchedProperty.id;
        if (tx.type === 'expense') {
          tx.isPropertyExpense = true;
          // Bug fix: isPropertyExpense used to get set with no
          // corresponding expenseCategory, so every auto-flagged property
          // expense landed in the Property Expenses page's "Other" bucket
          // until someone opened it and picked a bucket by hand. Derives
          // it from whatever category the transaction already resolved to
          // above (see getExpenseCategoryBucket in
          // propertyExpenseCategories.js).
          tx.expenseCategory = getExpenseCategoryBucket(tx.categoryId);
        }
      }
    }

    // 🔹 De-duplication
    if (dedupe) {
      // A recurring rule / bill may already have generated a row for this very
      // payment. Keep that one (it has the rule's category) and attach the
      // bank's details to it, instead of adding a second copy.
      const generatedMatch = findGeneratedTransactionFor(tx, existingForAccount);
      const legacyLoanMatch = generatedMatch
        ? null
        : findLegacyLoanPaymentFor(tx, loanPayments, existingForAccount);
      const generated = generatedMatch || legacyLoanMatch?.transaction;
      if (generated) {
        try {
          const relatedLoanPayment = generated.loanTransactionId
            ? loanPayments.find(payment => payment.id === generated.loanTransactionId)
            : legacyLoanMatch?.loanPayment;
          const merged = {
            ...generated,
            ...(relatedLoanPayment ? {
              loanId: generated.loanId || relatedLoanPayment.loanId,
              loanTransactionId: generated.loanTransactionId || relatedLoanPayment.id
            } : {}),
            reconciled: true,
            bankDate: tx.date,
            bankDescription: tx.rawDescription || tx.description || '',
            ...(tx.reference ? { bankReference: tx.reference } : {}),
            ...(tx.balance !== undefined ? { balance: tx.balance } : {}),
            updatedAt: new Date().toISOString()
          };
          await updateItem(STORE_NAMES.transactions, merged);
          Object.assign(generated, merged);
          if (relatedLoanPayment) {
            const updatedPayment = {
              ...relatedLoanPayment,
              transactionId: generated.id,
              reconciled: true,
              bankDate: tx.date,
              bankDescription: tx.rawDescription || tx.description || '',
              ...(tx.reference ? { bankReference: tx.reference } : {}),
              updatedAt: new Date().toISOString()
            };
            await updateItem(STORE_NAMES.loanTransactions, updatedPayment);
            Object.assign(relatedLoanPayment, updatedPayment);
          }
          reconciledCount++;
        } catch (e) {
          console.error('[IMPORT] Failed to reconcile with generated transaction', generated, e);
        }
        skipped++;
        continue;
      }
      const match = findDuplicateTransaction(tx, existingForAccount);
      if (match) {
        // The earlier copy has no details but this import does: fill them in
        // on the existing row (keeps its category/links) rather than adding
        // a second copy.
        if (!(match.description || '').trim() && (tx.description || '').trim()) {
          try {
            const filledRow = {
              ...match,
              description: tx.description,
              ...(tx.rawDescription ? { rawDescription: tx.rawDescription } : {}),
              updatedAt: new Date().toISOString()
            };
            await updateItem(STORE_NAMES.transactions, filledRow);
            Object.assign(match, filledRow);
            enriched++;
          } catch (e) {
            console.error('[IMPORT] Failed to enrich existing transaction', match, e);
          }
        }
        skipped++;
        continue;
      }
    }

    try {
      withAud(tx, txAccount?.currency);
      await addItem(STORE_NAMES.transactions, tx);
      existingForAccount.push(tx); // add to in-memory for further dedupe
      saved++;
    } catch (e) {
      console.error('[IMPORT] Failed to save transaction', tx, e);
      skipped++;
    }
  }

  logImportDebug('saveImportedTransactions: finished', { saved, skipped, enriched, reconciled: reconciledCount });
  return { saved, skipped, enriched, reconciled: reconciledCount };
}

// ---------------------------------------------------------------------------
// Simple duplicate detection: same date, amount, description, account
// within +/- 2 days considerate buffer
//
// Exported so other write paths — specifically backup restore in
// settings.js — can reuse the exact same check. See the bug fix note
// there: restore used to have NO content-based dedup at all, only an
// id match, so restoring a backup after a fresh CSV import (which
// generates brand-new ids for what might be the exact same real-world
// transactions) silently duplicated every one of them.
// ---------------------------------------------------------------------------
export function findDuplicateTransaction(tx, existingList) {
  const txAmt = roundAmount(tx.amount);
  const txDate = tx.date;
  const txDesc = (tx.description || '').trim().toLowerCase();

  // The bank's own reference (e.g. Canara's UPI ref / cheque no., stored as `reference`) is authoritative
  // when BOTH rows carry one: same reference on the same account = the same transaction, a different
  // reference = a different one even if date/amount/description are identical (two ₹49 recharges to the
  // same merchant on one day are two real payments, and used to be dropped as "duplicates"). Rows from
  // before references were stored, or from banks that don't give one, fall through to the check below.
  // "0"/blank are placeholders, not references.
  const refOf = r => { const v = String(r ?? '').trim(); return v && !/^0+$/.test(v) ? v : null; };
  const txRef = refOf(tx.reference);

  return existingList.find(e => {
    if (e === tx) return false;
    const eRef = refOf(e.bankReference) || refOf(e.reference);
    if (txRef && eRef) return txRef === eRef && e.accountId === tx.accountId;

    // A generated recurring/loan row keeps its own description and scheduled
    // date after reconciliation. Compare the saved bank-side values when the
    // same statement is imported again, or a different merchant description
    // / posting date would make an identical bank row look new.
    if (e.reconciled && e.bankDate && e.bankDescription !== undefined &&
        e.accountId === tx.accountId && roundAmount(e.amount) === txAmt) {
      const bankDesc = String(e.bankDescription || '').trim().toLowerCase();
      const incomingDesc = String(tx.rawDescription || tx.description || '').trim().toLowerCase();
      const bankDayGap = Math.abs(dayDiff(e.bankDate, txDate));
      if (bankDesc === incomingDesc && bankDayGap <= 2) return true;
      if (!bankDesc && !incomingDesc && bankDayGap === 0) return true;
    }

    const sameAmt = roundAmount(e.amount) === txAmt;
    const eDesc = (e.description || '').trim().toLowerCase();
    const sameAccount = e.accountId === tx.accountId;
    const dayGap = Math.abs(dayDiff(e.date, txDate));

    // Same description: allow for bank posting-date drift (+/- 2 days).
    // One side blank (e.g. an earlier import that didn't capture details):
    // there is nothing to compare, so require the exact same day instead.
    const sameDesc = eDesc === txDesc;
    const oneBlank = !sameDesc && (eDesc === '' || txDesc === '');
    const dateOk = sameDesc ? dayGap <= 2 : oneBlank ? dayGap === 0 : false;

    const dup = sameAmt && sameAccount && dateOk;
    if (dup) {
      logImportDebug('Duplicate detected, skipping:', { tx, existing: e });
    }
    return dup;
  });
}

export function isDuplicateTransaction(tx, existingList) {
  return !!findDuplicateTransaction(tx, existingList);
}

// Kept as a local alias so the existing internal call site above doesn't
// need to change.
function isDuplicate(tx, existingList) {
  return isDuplicateTransaction(tx, existingList);
}

function roundAmount(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dayDiff(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}
