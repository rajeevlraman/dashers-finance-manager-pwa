// ============================================================================
// 🔄 recategorizeTool.js — Re-check and fill in transaction categories
// ============================================================================
//
// The auto-categorization logic (categoryRules.js / categoryMapper.js) gets
// tweaked over time as real-world miscategorizations turn up. Each fix only
// changes how FUTURE imports get categorized — it does nothing for
// transactions that were already saved under the old, buggier logic.
//
// This tool re-runs the CURRENT categorization logic against two groups of
// transactions, and shows a single review list of proposed changes so the
// user can apply just the ones they agree with:
//
//   1. Previously AUTO-categorized transactions (have a categorySource) -
//      re-checked in case the current logic would now assign something
//      different. Never touches anything the user categorized by hand
//      (see the categorySource note below).
//   2. Currently UNCATEGORIZED transactions (categoryId is null) - checked
//      to see if the current logic can now suggest something for them.
//      There's no "undo a human choice" risk here, since a blank category
//      isn't a deliberate choice the way picking a specific category is.
//
// Both groups only ever produce a PROPOSED change - nothing is written to
// the database until the user reviews and applies it. It's meant to be run
// again after any future categorization change, not just once.
//
// A transaction only counts as an auto-categorized candidate (group 1) if
// it has a categorySource field (meaning the import pipeline assigned it)
// — a transaction the user manually picked a category for (via the
// transaction form) never gets a categorySource, so it's never touched
// here. This is a deliberate, conservative safety rule: this tool must
// never override a human's deliberate choice, only re-check the tool's own
// past guesses (group 1) or fill in genuine gaps (group 2).
// ============================================================================

import { getAllItems, updateItem, STORE_NAMES } from './db.js';
import { buildCategoryIndex, autoAssignCategory } from './import/categoryRules.js';
import { suggestCategoryForTransaction } from './import/categoryMapper.js';
import { extractMerchant, extractCategoryText, normaliseDescription } from './import/parser.js';
import { escapeHtml } from './sanitize.js';

// Bug-proofing: a transaction's merchant/categoryText/cleanDescription
// fields are normally derived once at import time and stored permanently.
// If the extraction logic itself changes later (e.g. stripping a bank's
// boilerplate phrase), those stored fields go stale - matching against
// them would silently miss exactly that class of fix. This rebuilds all
// three fresh from the transaction's original raw text before matching,
// so a re-scan reflects the CURRENT parser as well as the current matcher.
function withFreshDerivedFields(tx) {
  const raw = tx.rawDescription || tx.description || '';
  return {
    ...tx,
    merchant: extractMerchant(raw),
    categoryText: extractCategoryText(raw),
    cleanDescription: normaliseDescription(raw)
  };
}

// Mirrors the exact decision tree saver.js uses when importing a new
// transaction, so "what would this be categorized as today" means the same
// thing here as it does at import time. { dryRun: true } skips the
// learned-rule/auto-learning side effects, since this is a read-only scan.
function computeSuggestedCategory(tx, categories, categoryIndex) {
  const bankId = (tx.source || '').split(' ')[0].toLowerCase();
  const { categoryId: vendorCategoryId, source } = suggestCategoryForTransaction(
    tx,
    tx.bankCategory || null,
    { dryRun: true, bankId }
  );

  if (vendorCategoryId && source !== 'fallback') {
    return { categoryId: vendorCategoryId, source };
  }

  if (categories.length && categoryIndex.length) {
    // autoAssignCategory() deliberately won't touch a transaction that
    // already has a categoryId (correct for its real caller in saver.js,
    // which only ever runs it on uncategorized transactions) - but this
    // tool's entire purpose is re-evaluating transactions that already
    // have one. Clear it on this throwaway copy only.
    const autoCatId = autoAssignCategory({ ...tx, categoryId: null }, categories, categoryIndex);
    if (autoCatId) {
      return { categoryId: autoCatId, source: 'category_name_match' };
    }
  }

  return { categoryId: null, source: null };
}

/**
 * Scans transactions for two things: previously auto-categorized
 * transactions where the current logic would now assign something
 * different, and currently-uncategorized transactions the current logic
 * can now assign something to. Read-only - makes no changes.
 */
export async function scanForRecategorization() {
  const [transactions, categories] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.categories).catch(() => [])
  ]);

  const categoryIndex = buildCategoryIndex(categories);

  // Group 1: re-check transactions the import pipeline categorized itself -
  // never touch manually-entered or manually-corrected ones (see file
  // header for why categorySource is the right signal for this).
  const recheckCandidates = transactions.filter(tx => tx.categorySource && tx.categoryId);

  // Group 2: currently uncategorized - safe to suggest for, since a blank
  // category was never a deliberate choice the way picking one is.
  const fillCandidates = transactions.filter(tx => !tx.categoryId);

  const changes = [];

  for (const tx of recheckCandidates) {
    const freshTx = withFreshDerivedFields(tx);
    const { categoryId: newCategoryId, source: newSource } = computeSuggestedCategory(
      freshTx, categories, categoryIndex
    );

    if (newCategoryId && newCategoryId !== tx.categoryId) {
      changes.push({
        tx,
        oldCategoryId: tx.categoryId,
        newCategoryId,
        newSource,
        kind: 'recheck'
      });
    }
  }

  for (const tx of fillCandidates) {
    const freshTx = withFreshDerivedFields(tx);
    const { categoryId: newCategoryId, source: newSource } = computeSuggestedCategory(
      freshTx, categories, categoryIndex
    );

    if (newCategoryId) {
      changes.push({
        tx,
        oldCategoryId: null,
        newCategoryId,
        newSource,
        kind: 'fill'
      });
    }
  }

  return {
    changes,
    scannedCount: recheckCandidates.length,
    fillScannedCount: fillCandidates.length,
    totalCount: transactions.length,
    categoryNameById: new Map(categories.map(c => [c.id, c.name]))
  };
}

function formatTxSummary(tx) {
  const amt = Number(tx.amount) || 0;
  const amtStr = (amt >= 0 ? '+' : '') + amt.toFixed(2);
  return `${tx.date || ''} · ${amtStr}`;
}

function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: ${type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#334155'};
    color: #fff; padding: 0.65rem 1.1rem; border-radius: 8px; font-size: 0.9rem;
    z-index: 100000; box-shadow: 0 10px 25px rgba(0,0,0,0.25);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/**
 * Shows the review modal for a set of proposed changes, letting the user
 * check/uncheck individual rows before applying. Mirrors the look of the
 * duplicate-transaction review modal elsewhere in Settings.
 */
function showRecategorizeReviewModal({ changes, categoryNameById, scannedCount, fillScannedCount }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;

  const rechecks = changes.filter(c => c.kind === 'recheck');
  const fills = changes.filter(c => c.kind === 'fill');

  function renderRow(change, globalIndex) {
    const oldName = change.kind === 'fill'
      ? 'Uncategorized'
      : (categoryNameById.get(change.oldCategoryId) || 'Uncategorised');
    const newName = categoryNameById.get(change.newCategoryId) || 'Uncategorised';
    const desc = (change.tx.description || '(no description)').slice(0, 70);
    return `
      <label style="display:flex; align-items:flex-start; gap:0.6rem; padding:0.55rem 0; border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
        <input type="checkbox" class="recat-row" data-index="${globalIndex}" checked style="margin-top:0.2rem;">
        <span style="flex:1;">
          <strong>${escapeHtml(desc)}</strong><br>
          <span style="color:#64748b;">${formatTxSummary(change.tx)}</span><br>
          <span style="color:${change.kind === 'fill' ? '#94a3b8' : '#dc2626'};">${escapeHtml(oldName)}</span>
          <span style="color:#94a3b8;"> → </span>
          <span style="color:#16a34a; font-weight:600;">${escapeHtml(newName)}</span>
        </span>
      </label>
    `;
  }

  // Index rows against the original `changes` array (not per-section), so
  // the apply handler's dataset.index lookups stay correct regardless of
  // which section a row is rendered in.
  const rechecksHtml = rechecks.map(c => renderRow(c, changes.indexOf(c))).join('');
  const fillsHtml = fills.map(c => renderRow(c, changes.indexOf(c))).join('');

  const sectionsHtml = `
    ${rechecks.length > 0 ? `
      <h4 style="margin: 0.75rem 0 0.25rem;">✏️ Corrections (${rechecks.length})</h4>
      <p style="color:#64748b; font-size:0.8rem; margin: 0 0 0.5rem;">Previously auto-categorized - the current logic now disagrees.</p>
      ${rechecksHtml}
    ` : ''}
    ${fills.length > 0 ? `
      <h4 style="margin: 0.75rem 0 0.25rem;">➕ New suggestions (${fills.length})</h4>
      <p style="color:#64748b; font-size:0.8rem; margin: 0 0 0.5rem;">Currently uncategorized - the current logic can now suggest one.</p>
      ${fillsHtml}
    ` : ''}
  `;

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:1.75rem; max-width:600px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <h3 style="margin-top:0;">🔄 ${changes.length} proposed categor${changes.length === 1 ? 'y' : 'ies'}</h3>
      <p style="color:#64748b; font-size:0.85rem; margin-top:-0.5rem;">
        Checked ${scannedCount} auto-categorized transaction${scannedCount === 1 ? '' : 's'} and ${fillScannedCount} uncategorized transaction${fillScannedCount === 1 ? '' : 's'}.
        Anything you categorized by hand is never touched.
        Uncheck any row you don't want changed.
      </p>
      <div style="overflow-y:auto; flex:1; margin:0.5rem 0 1rem;">
        ${sectionsHtml}
      </div>
      <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-secondary" id="recatSelectNone" type="button">Select None</button>
        <button class="btn btn-primary" id="recatApplySelected" style="margin-left:auto;">
          ✅ Apply Selected
        </button>
        <button class="btn btn-secondary" id="recatCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#recatCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#recatSelectNone').addEventListener('click', () => {
    overlay.querySelectorAll('.recat-row').forEach(cb => { cb.checked = false; });
  });

  overlay.querySelector('#recatApplySelected').addEventListener('click', async () => {
    const applyBtn = overlay.querySelector('#recatApplySelected');
    const checkedIndexes = Array.from(overlay.querySelectorAll('.recat-row:checked'))
      .map(cb => Number(cb.dataset.index));

    if (checkedIndexes.length === 0) {
      showToast('No rows selected', 'error');
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';

    let applied = 0;
    let failed = 0;
    for (const idx of checkedIndexes) {
      const change = changes[idx];
      try {
        await updateItem(STORE_NAMES.transactions, {
          ...change.tx,
          categoryId: change.newCategoryId,
          categorySource: change.newSource,
          updatedAt: new Date().toISOString()
        });
        applied++;
      } catch (err) {
        console.error('[Recategorize] Failed to update transaction', change.tx.id, err);
        failed++;
      }
    }

    overlay.remove();
    if (failed > 0) {
      showToast(`⚠️ Updated ${applied}, ${failed} failed`, 'error');
    } else {
      showToast(`✅ Updated ${applied} transaction${applied === 1 ? '' : 's'}`, 'success');
    }
  });
}

/**
 * Entry point for a button click: scans, then shows the review modal (or a
 * toast if nothing needs changing). Handles its own button disabled/loading
 * state so callers can just wire it up directly.
 */
export async function runRecategorizeCheck(buttonEl) {
  const originalText = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '🔄 Scanning...';
  }

  try {
    const { changes, categoryNameById, scannedCount, fillScannedCount } = await scanForRecategorization();

    if (changes.length === 0) {
      showToast(
        `✅ Checked ${scannedCount} categorized + ${fillScannedCount} uncategorized transactions - nothing to change`,
        'success'
      );
      return;
    }

    showRecategorizeReviewModal({ changes, categoryNameById, scannedCount, fillScannedCount });
  } catch (err) {
    console.error('[Recategorize] Scan failed', err);
    showToast('❌ Could not scan transactions', 'error');
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}
