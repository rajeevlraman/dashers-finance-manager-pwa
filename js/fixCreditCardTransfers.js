// ============================================================================
// 🔧 fixCreditCardTransfers.js — Fix mislabeled credit-card-payment rows
// ============================================================================
//
// resolveTransactionSemantics() (categoryMapper.js) now recognizes a BPAY
// payment landing on one of the user's own credit accounts, and any
// "Credit Card Payment" (sub_credit_card_payment) row, as a transfer rather
// than a real expense - paying your own card down is money moving between
// your own accounts, not spending. That fix only applies to NEW imports.
//
// Transactions saved before this fix still have isTransfer:false and
// type:'expense', which silently cancels out real spend in every
// Income/Expense total that excludes transfers (Dashboard, Budgets,
// Finance Overview, the Transactions page's own summary bar, etc.) - e.g.
// a $1,000 card payment showing as a positive "expense" makes that
// period's total look $1,000 lower than what was actually spent.
//
// This scans existing transactions for exactly the categories/conditions
// resolveTransactionSemantics treats as a card-repayment transfer, and
// shows a review list of proposed isTransfer/type corrections so the user
// can apply just the ones they agree with - same reviewable pattern as
// recategorizeTool.js, but correcting type/isTransfer instead of category.
// ============================================================================

import { getAllItems, updateItem, STORE_NAMES } from './db.js';
import { resolveTransactionSemantics } from './import/categoryMapper.js';
import { escapeHtml } from './sanitize.js';

/**
 * Scans transactions for BPAY/credit-card-payment rows where the current
 * semantics logic would now flag isTransfer differently than what's stored.
 * Read-only - makes no changes.
 */
export async function scanForCreditCardTransferFixes() {
  const [transactions, accounts] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.accounts).catch(() => [])
  ]);

  const accountById = new Map(accounts.map(a => [a.id, a]));
  const candidates = transactions.filter(
    tx => tx.categoryId === 'sub_bpay' || tx.categoryId === 'sub_credit_card_payment'
  );

  const changes = [];
  for (const tx of candidates) {
    const account = accountById.get(tx.accountId);
    const semantics = resolveTransactionSemantics(tx.categoryId, tx.type, [], {
      amount: tx.amount,
      accountType: account?.type
    });

    if (semantics.isTransfer !== !!tx.isTransfer) {
      changes.push({
        tx,
        account,
        newType: semantics.type,
        newIsTransfer: semantics.isTransfer
      });
    }
  }

  return { changes, scannedCount: candidates.length, totalCount: transactions.length };
}

function formatTxSummary(tx, account) {
  const amt = Number(tx.amount) || 0;
  const amtStr = (amt >= 0 ? '+' : '') + amt.toFixed(2);
  return `${tx.date || ''} · ${amtStr} · ${account?.name || 'Unknown account'}`;
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

function showReviewModal({ changes, scannedCount }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;

  function renderRow(change, index) {
    const desc = (change.tx.description || '(no description)').slice(0, 70);
    const fromLabel = change.tx.isTransfer ? 'Transfer' : 'Expense';
    const toLabel = change.newIsTransfer ? 'Transfer' : 'Expense';
    return `
      <label style="display:flex; align-items:flex-start; gap:0.6rem; padding:0.55rem 0; border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
        <input type="checkbox" class="cctf-row" data-index="${index}" checked style="margin-top:0.2rem;">
        <span style="flex:1;">
          <strong>${escapeHtml(desc)}</strong><br>
          <span style="color:#64748b;">${formatTxSummary(change.tx, change.account)}</span><br>
          <span style="color:#dc2626;">${escapeHtml(fromLabel)}</span>
          <span style="color:#94a3b8;"> → </span>
          <span style="color:#16a34a; font-weight:600;">${escapeHtml(toLabel)}</span>
        </span>
      </label>
    `;
  }

  const rowsHtml = changes.map((c, i) => renderRow(c, i)).join('');

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:1.75rem; max-width:600px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <h3 style="margin-top:0;">💳 ${changes.length} card-payment${changes.length === 1 ? '' : 's'} to fix</h3>
      <p style="color:#64748b; font-size:0.85rem; margin-top:-0.5rem;">
        Checked ${scannedCount} BPAY / Credit Card Payment transaction${scannedCount === 1 ? '' : 's'}.
        These are currently counted as expenses, which understates real
        spend in any period they land in. Uncheck any row you don't want changed.
      </p>
      <div style="overflow-y:auto; flex:1; margin:0.5rem 0 1rem;">
        ${rowsHtml}
      </div>
      <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-secondary" id="cctfSelectNone" type="button">Select None</button>
        <button class="btn btn-primary" id="cctfApplySelected" style="margin-left:auto;">
          ✅ Apply Selected
        </button>
        <button class="btn btn-secondary" id="cctfCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cctfCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#cctfSelectNone').addEventListener('click', () => {
    overlay.querySelectorAll('.cctf-row').forEach(cb => { cb.checked = false; });
  });

  overlay.querySelector('#cctfApplySelected').addEventListener('click', async () => {
    const applyBtn = overlay.querySelector('#cctfApplySelected');
    const checkedIndexes = Array.from(overlay.querySelectorAll('.cctf-row:checked'))
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
          type: change.newType,
          isTransfer: change.newIsTransfer,
          updatedAt: new Date().toISOString()
        });
        applied++;
      } catch (err) {
        console.error('[FixCreditCardTransfers] Failed to update transaction', change.tx.id, err);
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
 * toast if nothing needs fixing). Handles its own button disabled/loading
 * state so callers can just wire it up directly.
 */
export async function runFixCreditCardTransfers(buttonEl) {
  const originalText = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '🔄 Scanning...';
  }

  try {
    const { changes, scannedCount } = await scanForCreditCardTransferFixes();

    if (changes.length === 0) {
      showToast(`✅ Checked ${scannedCount} BPAY / Credit Card Payment transactions - nothing to fix`, 'success');
      return;
    }

    showReviewModal({ changes, scannedCount });
  } catch (err) {
    console.error('[FixCreditCardTransfers] Scan failed', err);
    showToast('❌ Could not scan transactions', 'error');
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}
