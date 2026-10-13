// ============================================================================
// 🚗 vehicleMatchTool.js — Re-check existing transactions for vehicle matches
// ============================================================================
//
// Picking a vehicle on a Registration transaction (see transactions.js's
// updateTxVehicleVisibility / syncVehicleRegoFromTransaction) only ever
// happens one transaction at a time, by hand, in the Add/Edit Transaction
// form. Every Registration expense that was imported or entered before a
// vehicle existed — or just never had one picked — sits there with
// categoryId 'sub_rego' and no vehicleId, and the Vehicles page's
// Registration card (which reads vehicle.regoCost/regoExpiryDate straight
// off the vehicle record, not off transactions) never learns about it.
//
// This scans those unlinked Registration transactions and proposes a
// vehicle for each one, using the same two signals a person would use by
// eye: how close the amount is to what this vehicle's rego actually costs
// (vehicle.regoCost, kept in sync by syncVehicleRegoFromTransaction), and
// how close the transaction's month is to the month this vehicle's rego is
// due (vehicle.regoExpiryDate, minus a cycle). Same pattern as
// js/propertyMatchTool.js and js/recategorizeTool.js: read-only scan,
// review modal, opt in per row.
//
// Only ever proposes a match for a transaction that doesn't already have
// one (vehicleId is unset) — never overrides a vehicle a person already
// picked themselves, by hand or via a previous run of this tool.
// ============================================================================

import { getAllItems, updateItem, STORE_NAMES } from './db.js';
import { syncVehicleRegoFromTransaction } from './transactions.js';
import { suggestVehicleForFuel } from './vehicleFuelStats.js';
import { escapeHtml } from './sanitize.js';

import { formatMoney } from './utils/currency.js';
// A rego amount rarely lands exactly on the last-paid amount (fees creep up
// a few dollars most years), so "close" means within this band, not exact.
const AMOUNT_CLOSE_ENOUGH = 20;
// Rego is due the same month every cycle; allow it landing the month either
// side too, since a transaction can be logged a little early or late.
const MONTH_CLOSE_ENOUGH = 1;

function monthDistance(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 12 - diff);
}

// Which calendar month(s) this vehicle's rego is due in, going by its
// current regoExpiryDate. A six-monthly vehicle is due twice a year, six
// months apart either side of that date.
function getVehicleDueMonths(vehicle) {
  if (!vehicle.regoExpiryDate) return [];
  const month = new Date(vehicle.regoExpiryDate).getMonth();
  return vehicle.regoFrequency === 'six_monthly' ? [month, (month + 6) % 12] : [month];
}

function scoreVehicleForTransaction(tx, vehicle) {
  const txAmount = Math.abs(Number(tx.amount) || 0);
  const txMonth = new Date(tx.date).getMonth();

  const amountDiff = vehicle.regoCost ? Math.abs(txAmount - vehicle.regoCost) : null;
  const dueMonths = getVehicleDueMonths(vehicle);
  const monthDiff = dueMonths.length ? Math.min(...dueMonths.map(m => monthDistance(m, txMonth))) : null;

  return { amountDiff, monthDiff };
}

// Picks the best vehicle for one transaction, or null if nothing lines up
// closely enough to be worth proposing. With only one vehicle on file
// there's nothing to disambiguate — same reasoning as propertyMatchTool's
// account-link match being treated as exact.
function bestVehicleMatch(tx, vehicles) {
  if (vehicles.length === 0) return null;
  if (vehicles.length === 1) {
    return { vehicle: vehicles[0], warning: null };
  }

  const scored = vehicles
    .map(vehicle => ({ vehicle, ...scoreVehicleForTransaction(tx, vehicle) }))
    .sort((a, b) => {
      const aAmount = a.amountDiff ?? Infinity;
      const bAmount = b.amountDiff ?? Infinity;
      if (aAmount !== bAmount) return aAmount - bAmount;
      return (a.monthDiff ?? Infinity) - (b.monthDiff ?? Infinity);
    });

  const [best, runnerUp] = scored;
  const strongAmount = best.amountDiff !== null && best.amountDiff <= AMOUNT_CLOSE_ENOUGH;
  const strongMonth = best.monthDiff !== null && best.monthDiff <= MONTH_CLOSE_ENOUGH;

  // Neither signal landed close enough on the best vehicle to be worth
  // guessing — leave this transaction for the person to pick by hand.
  if (!strongAmount && !strongMonth) return null;

  const runnerUpTooClose = runnerUp &&
    Math.abs((best.amountDiff ?? Infinity) - (runnerUp.amountDiff ?? Infinity)) <= AMOUNT_CLOSE_ENOUGH &&
    Math.abs((best.monthDiff ?? Infinity) - (runnerUp.monthDiff ?? Infinity)) <= MONTH_CLOSE_ENOUGH;

  const warning = runnerUpTooClose
    ? `Could also be "${runnerUp.vehicle.nickname || runnerUp.vehicle.rego || 'another vehicle'}" — check before applying`
    : (!strongAmount
      ? 'Matched by due month only — no rego amount on file yet for this vehicle'
      : (!strongMonth ? 'Matched by amount only — due month doesn\'t line up' : null));

  return { vehicle: best.vehicle, warning };
}

/**
 * Scans Registration transactions that don't have a vehicle linked yet and
 * returns the matches the CURRENT amount/due-month logic would now assign.
 * Read-only - makes no changes.
 */
export async function scanForVehicleMatches() {
  const [transactions, vehicles] = await Promise.all([
    getAllItems(STORE_NAMES.transactions),
    getAllItems(STORE_NAMES.vehicles).catch(() => [])
  ]);

  const candidates = transactions.filter(tx =>
    !tx.isTransfer && !tx.vehicleId && tx.type === 'expense' &&
    (tx.categoryId === 'sub_rego' || tx.categoryId === 'sub_fuel')
  );

  const changes = [];
  for (const tx of candidates) {
    if (tx.categoryId === 'sub_fuel') {
      // Fuel amounts vary every fill, so the amount/due-month scoring used
      // for rego says nothing about which vehicle bought it. Instead this
      // learns from fuel fills already linked by hand: which account/card
      // pays for which vehicle, typical fill size per vehicle, and servo —
      // see suggestVehicleForFuel in vehicleFuelStats.js. Uncertain
      // suggestions carry a warning (and start unticked in the modal).
      const guess = suggestVehicleForFuel(tx, transactions, vehicles);
      // No suggestion (e.g. nothing linked yet to learn from) still gets a
      // row, with the vehicle left blank, so older imported fills can be
      // assigned right here instead of editing each transaction by hand.
      changes.push(guess
        ? { tx, vehicle: guess.vehicle, warning: guess.warning, reasons: guess.reasons }
        : { tx, vehicle: null, warning: null, reasons: null });
      continue;
    }
    const match = bestVehicleMatch(tx, vehicles);
    changes.push(match
      ? { tx, vehicle: match.vehicle, warning: match.warning }
      : { tx, vehicle: null, warning: null, reasons: null });
  }

  // Newest first, so the fills you remember are at the top.
  changes.sort((a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : 0));

  return {
    vehicles,
    changes,
    scannedCount: candidates.length,
    totalCount: transactions.length,
    hasVehicles: vehicles.length > 0
  };
}

function formatTxSummary(tx) {
  const amt = Math.abs(Number(tx.amount) || 0);
  return `${tx.date || ''} · ${formatMoney(amt)}`;
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

function showVehicleMatchReviewModal({ changes, scannedCount, vehicles }) {
  const vehicleName = (v) => v.nickname || v.rego || [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
  const optionsHtml = (selectedId) =>
    `<option value="">— choose vehicle —</option>` +
    vehicles.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === selectedId ? 'selected' : ''}>${escapeHtml(vehicleName(v))}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;

  const rowsHtml = changes.map((change, index) => {
    const desc = (change.tx.description || '(no description)').slice(0, 70);
    const learnedHtml = (!change.warning && change.reasons && change.reasons[0] !== 'only vehicle')
      ? ` <span style="color:#64748b; font-weight:400;">· learned from ${escapeHtml(change.reasons.join(' + '))}</span>`
      : '';
    const warningHtml = change.warning
      ? `<br><span style="color:#b45309; font-weight:600;">⚠️ ${escapeHtml(change.warning)}</span>`
      : '';
    return `
      <label style="display:flex; align-items:flex-start; gap:0.6rem; padding:0.55rem 0; border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
        <input type="checkbox" class="vehiclematch-row" data-index="${index}" ${(change.vehicle && !change.warning) ? 'checked' : ''} style="margin-top:0.2rem;">
        <span style="flex:1;">
          <strong>${escapeHtml(desc)}</strong><br>
          <span style="color:#64748b;">${change.tx.categoryId === 'sub_fuel' ? '⛽ Fuel · ' : '📄 Registration · '}${formatTxSummary(change.tx)}</span><br>
          <select class="vehiclematch-vehicle form-input" data-index="${index}" style="margin-top:0.25rem; max-width:100%; padding:0.25rem 0.4rem; font-size:0.85rem;">${optionsHtml(change.vehicle ? change.vehicle.id : '')}</select>${learnedHtml}${warningHtml}
        </span>
      </label>
    `;
  }).join('');

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:1.75rem; max-width:600px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <h3 style="margin-top:0;">🚗 ${changes.length} transaction${changes.length === 1 ? '' : 's'} without a vehicle</h3>
      <p style="color:#64748b; font-size:0.85rem; margin-top:-0.5rem;">
        Registration / Fuel transactions with no vehicle set. Suggestions are pre-filled and ticked when the app is confident;
        pick a vehicle for any other row to assign it. Anything that already has a vehicle is never touched.
      </p>
      <p style="color:#64748b; font-size:0.8rem; margin:0 0 0.5rem;">
        Tip: assign a batch by hand, then run this again — it learns which card and fill size go with which vehicle and fills in the rest.
      </p>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center; margin-bottom:0.25rem; font-size:0.85rem;">
        <span>Set every blank row to:</span>
        <select id="vehiclematchBulkVehicle" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.85rem;">${optionsHtml('')}</select>
        <button class="btn btn-secondary" id="vehiclematchBulkApply" type="button">Fill blanks</button>
      </div>
      <div style="overflow-y:auto; flex:1; margin:0.5rem 0 1rem;">
        ${rowsHtml}
      </div>
      <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-secondary" id="vehiclematchSelectNone" type="button">Select None</button>
        <button class="btn btn-primary" id="vehiclematchApplySelected" style="margin-left:auto;">
          ✅ Apply Selected
        </button>
        <button class="btn btn-secondary" id="vehiclematchCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#vehiclematchCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#vehiclematchSelectNone').addEventListener('click', () => {
    overlay.querySelectorAll('.vehiclematch-row').forEach(cb => { cb.checked = false; });
  });

  // Choosing a vehicle on a row ticks it; clearing the choice unticks it.
  overlay.querySelectorAll('.vehiclematch-vehicle').forEach(sel => {
    sel.addEventListener('change', () => {
      const cb = overlay.querySelector(`.vehiclematch-row[data-index="${sel.dataset.index}"]`);
      if (cb) cb.checked = !!sel.value;
    });
  });

  // Fill every row that has no vehicle yet with one choice (handy when most
  // old fills were one vehicle), leaving rows that already have one alone.
  overlay.querySelector('#vehiclematchBulkApply').addEventListener('click', () => {
    const chosen = overlay.querySelector('#vehiclematchBulkVehicle').value;
    if (!chosen) { showToast('Pick a vehicle first', 'error'); return; }
    overlay.querySelectorAll('.vehiclematch-vehicle').forEach(sel => {
      if (sel.value) return;
      sel.value = chosen;
      const cb = overlay.querySelector(`.vehiclematch-row[data-index="${sel.dataset.index}"]`);
      if (cb) cb.checked = true;
    });
  });

  overlay.querySelector('#vehiclematchApplySelected').addEventListener('click', async () => {
    const applyBtn = overlay.querySelector('#vehiclematchApplySelected');
    // A row is applied only if it's ticked AND has a vehicle chosen.
    const chosenVehicleFor = (idx) =>
      overlay.querySelector(`.vehiclematch-vehicle[data-index="${idx}"]`)?.value || '';
    const checkedIndexes = Array.from(overlay.querySelectorAll('.vehiclematch-row:checked'))
      .map(cb => Number(cb.dataset.index))
      .filter(idx => chosenVehicleFor(idx));

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
          vehicleId: chosenVehicleFor(idx),
          updatedAt: new Date().toISOString()
        };
        await updateItem(STORE_NAMES.transactions, updated);
        // Same as saving the transaction form by hand — keeps the
        // vehicle's own regoCost/regoExpiryDate in sync so the Vehicles
        // page card is accurate without needing a second pass. (Fuel
        // links need no sync: the Vehicles page reads them straight off
        // the transactions.)
        if (updated.categoryId === 'sub_rego') {
          await syncVehicleRegoFromTransaction(updated);
        }
        applied++;
      } catch (err) {
        console.error('[VehicleMatch] Failed to update transaction', change.tx.id, err);
        failed++;
      }
    }

    overlay.remove();
    if (failed > 0) {
      showToast(`⚠️ Updated ${applied}, ${failed} failed`, 'error');
    } else {
      showToast(`✅ Updated ${applied} transaction${applied === 1 ? '' : 's'} — check the Vehicles page`, 'success');
    }
  });
}

/**
 * Entry point for a button click: scans, then shows the review modal (or a
 * toast if nothing needs changing). Handles its own button disabled/loading
 * state so callers can just wire it up directly.
 */
export async function runVehicleMatchCheck(buttonEl) {
  const originalText = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '🔄 Scanning...';
  }

  try {
    const { changes, scannedCount, hasVehicles, vehicles } = await scanForVehicleMatches();

    if (!hasVehicles) {
      showToast('No vehicles set up yet — add one on the Vehicles page first', 'error');
      return;
    }

    if (changes.length === 0) {
      showToast(
        '✅ Every Registration / Fuel transaction already has a vehicle',
        'success'
      );
      return;
    }

    showVehicleMatchReviewModal({ changes, scannedCount, vehicles });
  } catch (err) {
    console.error('[VehicleMatch] Scan failed', err);
    showToast('❌ Could not scan transactions', 'error');
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}
