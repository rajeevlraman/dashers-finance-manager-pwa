// ============================================================================
// 🏠 propertyMatchTool.js — Re-check existing transactions for property matches
// ============================================================================
//
// The property-matching logic in js/import/categoryMapper.js
// (matchPropertyByAccount / findLearnedPropertyForTransaction /
// matchPropertyForTransaction) only ever runs at CSV import time (see
// js/import/saver.js). Linking an account to a property, or teaching a
// merchant+account rule by manually tagging one transaction, does nothing
// for transactions that were already imported before that link/rule
// existed — this re-runs the current matching logic against existing
// transactions and shows a review list of proposed changes, the same
// pattern as js/recategorizeTool.js.
//
// Only ever proposes a match for a transaction that doesn't already have
// one (propertyId is unset) — never overrides a property a person already
// set themselves, by hand or via a previous run of this tool.
// ============================================================================

import { getAllItems, updateItem, STORE_NAMES } from './db.js';
import {
  matchPropertyByAccount,
  findLearnedPropertyForTransaction,
  matchPropertyForTransaction,
  isConfirmedNonPropertyExpense,
  getLearnedPropertyMatchWarning,
  resolveLearnedPropertyMatch
} from './import/categoryMapper.js';
import { getExpenseCategoryBucket } from './propertyExpenseCategories.js';
import { escapeHtml } from './sanitize.js';

function computePropertyMatch(tx, accounts, properties) {
  return (
    matchPropertyByAccount(tx, accounts, properties) ||
    findLearnedPropertyForTransaction(tx, properties) ||
    (!isConfirmedNonPropertyExpense(tx) ? matchPropertyForTransaction(tx, properties) : null)
  );
}

/**
 * Scans transactions that are eligible for property matching (real expenses
 * plus rental income, never transfers) but don't have a propertyId yet, and
 * returns the matches the CURRENT logic would now assign. Read-only - makes
 * no changes.
 */
export async function scanForPropertyMatches() {
  const [transactions, accounts, properties] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.accounts).catch(() => []),
    getAllItems(STORE_NAMES.properties).catch(() => [])
  ]);

  const candidates = transactions.filter(tx =>
    !tx.isTransfer && !tx.propertyId &&
    (tx.categoryId === 'sub_rental_income' || tx.type === 'expense')
  );

  const changes = [];
  for (const tx of candidates) {
    const matched = computePropertyMatch(tx, accounts, properties);
    if (!matched) continue;

    const expenseCategory = tx.type === 'expense' ? getExpenseCategoryBucket(tx.categoryId) : null;
    // Only meaningful when the match came from the learned-rule signal
    // (an account-link match is exact; a fresh single learned rule with no
    // history yet has nothing to compare against and warns every time,
    // which isn't useful) - see getLearnedPropertyMatchWarning.
    const isAccountLinkMatch = !!matchPropertyByAccount(tx, accounts, properties);
    const warning = !isAccountLinkMatch ? getLearnedPropertyMatchWarning(tx) : null;
    const learnedBasis = !isAccountLinkMatch ? resolveLearnedPropertyMatch(tx).basis : null;
    const note = isAccountLinkMatch
      ? null
      : learnedBasis === 'reference-match'
        ? 'Matched by billing reference number (amount not used)'
        : null;

    changes.push({ tx, property: matched, expenseCategory, warning, note });
  }

  return {
    changes,
    scannedCount: candidates.length,
    totalCount: transactions.length,
    hasProperties: properties.length > 0
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

function showPropertyMatchReviewModal({ changes, scannedCount }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;

  const rowsHtml = changes.map((change, index) => {
    const desc = (change.tx.description || '(no description)').slice(0, 70);
    const bucketNote = change.expenseCategory ? ` · bucket: ${escapeHtml(change.expenseCategory)}` : '';
    const warningHtml = change.warning
      ? `<br><span style="color:#b45309; font-weight:600;">⚠️ ${escapeHtml(change.warning)}</span>`
      : '';
    const noteHtml = change.note
      ? `<br><span style="color:#0d9488; font-weight:600;">🔗 ${escapeHtml(change.note)}</span>`
      : '';
    return `
      <label style="display:flex; align-items:flex-start; gap:0.6rem; padding:0.55rem 0; border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
        <input type="checkbox" class="propmatch-row" data-index="${index}" ${change.warning ? '' : 'checked'} style="margin-top:0.2rem;">
        <span style="flex:1;">
          <strong>${escapeHtml(desc)}</strong><br>
          <span style="color:#64748b;">${formatTxSummary(change.tx)}</span><br>
          <span style="color:#16a34a; font-weight:600;">🏠 ${escapeHtml(change.property.name)}</span>
          <span style="color:#94a3b8;">${bucketNote}</span>${warningHtml}${noteHtml}
        </span>
      </label>
    `;
  }).join('');

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:1.75rem; max-width:600px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <h3 style="margin-top:0;">🏠 ${changes.length} proposed property match${changes.length === 1 ? '' : 'es'}</h3>
      <p style="color:#64748b; font-size:0.85rem; margin-top:-0.5rem;">
        Checked ${scannedCount} transaction${scannedCount === 1 ? '' : 's'} without a property set.
        Anything that already has a property is never touched.
        Uncheck any row you don't want changed.
      </p>
      <div style="overflow-y:auto; flex:1; margin:0.5rem 0 1rem;">
        ${rowsHtml}
      </div>
      <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-secondary" id="propmatchSelectNone" type="button">Select None</button>
        <button class="btn btn-primary" id="propmatchApplySelected" style="margin-left:auto;">
          ✅ Apply Selected
        </button>
        <button class="btn btn-secondary" id="propmatchCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#propmatchCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#propmatchSelectNone').addEventListener('click', () => {
    overlay.querySelectorAll('.propmatch-row').forEach(cb => { cb.checked = false; });
  });

  overlay.querySelector('#propmatchApplySelected').addEventListener('click', async () => {
    const applyBtn = overlay.querySelector('#propmatchApplySelected');
    const checkedIndexes = Array.from(overlay.querySelectorAll('.propmatch-row:checked'))
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
        const updated = {
          ...change.tx,
          propertyId: change.property.id,
          updatedAt: new Date().toISOString()
        };
        if (change.expenseCategory) {
          updated.isPropertyExpense = true;
          updated.expenseCategory = change.expenseCategory;
        }
        await updateItem(STORE_NAMES.transactions, updated);
        applied++;
      } catch (err) {
        console.error('[PropertyMatch] Failed to update transaction', change.tx.id, err);
        failed++;
      }
    }

    overlay.remove();
    if (failed > 0) {
      showToast(`⚠️ Updated ${applied}, ${failed} failed`, 'error');
    } else {
      showToast(`✅ Updated ${applied} transaction${applied === 1 ? '' : 's'} — remember to "Sync from Transactions" on the Expenses page`, 'success');
    }
  });
}

/**
 * Entry point for a button click: scans, then shows the review modal (or a
 * toast if nothing needs changing). Handles its own button disabled/loading
 * state so callers can just wire it up directly.
 */
export async function runPropertyMatchCheck(buttonEl) {
  const originalText = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '🔄 Scanning...';
  }

  try {
    const { changes, scannedCount, hasProperties } = await scanForPropertyMatches();

    if (!hasProperties) {
      showToast('No properties set up yet — add one on the Properties page first', 'error');
      return;
    }

    if (changes.length === 0) {
      showToast(
        `✅ Checked ${scannedCount} unmatched transaction${scannedCount === 1 ? '' : 's'} - nothing to match`,
        'success'
      );
      return;
    }

    showPropertyMatchReviewModal({ changes, scannedCount });
  } catch (err) {
    console.error('[PropertyMatch] Scan failed', err);
    showToast('❌ Could not scan transactions', 'error');
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}
