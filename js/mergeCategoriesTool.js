// ============================================================================
// 🔀 mergeCategoriesTool.js — Merge duplicate-named categories
// ============================================================================
//
// The full default category list has two parallel taxonomies loaded
// together (an older flatter set and a newer, more nested set covering
// business/personal/pets/children/home separately), which produces 31 sets
// of categories sharing the exact same name under different IDs - e.g. two
// completely separate "Utilities" categories. Nothing in the UI
// distinguishes them (dropdowns show the bare name only), so a person can
// easily set a budget against one "Utilities" while transactions keep
// landing on the other - the budget looks permanently unused no matter how
// much is actually spent.
//
// This tool finds every such group, lets the user pick which ID should
// survive per group (defaulting to the "exp_*"-prefixed one, since that's
// the taxonomy this app's user described as their real/preferred
// categories), and on apply reassigns every record that referenced the
// losing ID - transactions, budgets, bills, and recurring transactions -
// before deleting the now-unused duplicate category.
// ============================================================================

import { getAllItems, updateItem, deleteItem, STORE_NAMES } from './db.js';
import { escapeHtml } from './sanitize.js';

const REFERENCING_STORES = [
  STORE_NAMES.transactions,
  STORE_NAMES.budgets,
  STORE_NAMES.bills,
  STORE_NAMES.recurringTransactions
];

function getCategoryPathSync(id, categoriesById) {
  const path = [];
  let current = categoriesById.get(id);
  let guard = 0;
  while (current && guard < 20) {
    path.unshift(current.name);
    current = current.parentId ? categoriesById.get(current.parentId) : null;
    guard++;
  }
  return path.join(' / ');
}

/**
 * Finds every group of 2+ categories sharing the same name (case-insensitive),
 * and counts how many records in each referencing store point at each ID -
 * both for display and to help pick a sensible default when neither ID has
 * an obvious preference.
 */
export async function scanForDuplicateCategories() {
  const [categories, ...storeData] = await Promise.all([
    getAllItems(STORE_NAMES.categories),
    ...REFERENCING_STORES.map(s => getAllItems(s).catch(() => []))
  ]);

  const categoriesById = new Map(categories.map(c => [c.id, c]));

  // Usage counts per categoryId, summed across all referencing stores.
  const usageCount = new Map();
  storeData.forEach((records, storeIdx) => {
    records.forEach(rec => {
      if (!rec.categoryId) return;
      usageCount.set(rec.categoryId, (usageCount.get(rec.categoryId) || 0) + 1);
    });
  });

  const byName = new Map();
  categories.forEach(c => {
    const key = (c.name || '').trim().toLowerCase();
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(c);
  });

  const groups = [];
  for (const [name, cats] of byName) {
    if (cats.length < 2) continue;

    const options = cats.map(c => ({
      id: c.id,
      name: c.name,
      path: getCategoryPathSync(c.id, categoriesById),
      usageCount: usageCount.get(c.id) || 0
    }));

    // Default pick: prefer an "exp_" id (this app's primary/preferred
    // taxonomy per the user), otherwise whichever has more real usage.
    const expOption = options.find(o => o.id.startsWith('exp_') || o.id.startsWith('Exp_'));
    const defaultKeepId = expOption
      ? expOption.id
      : options.slice().sort((a, b) => b.usageCount - a.usageCount)[0].id;

    groups.push({ name, options, defaultKeepId });
  }

  groups.sort((a, b) =>
    (b.options.reduce((s, o) => s + o.usageCount, 0)) -
    (a.options.reduce((s, o) => s + o.usageCount, 0))
  );

  return { groups, totalCategories: categories.length };
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

function showMergeReviewModal(groups) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;

  const groupsHtml = groups.map((group, gi) => `
    <div style="border:1px solid #e5e7eb; border-radius:10px; padding:0.85rem; margin-bottom:0.75rem;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
        <strong>${escapeHtml(group.name)}</strong>
        <label style="font-size:0.8rem; color:#64748b; display:flex; align-items:center; gap:4px;">
          <input type="checkbox" class="merge-group-skip" data-group="${gi}"> Skip this one
        </label>
      </div>
      ${group.options.map((opt, oi) => `
        <label style="display:flex; align-items:flex-start; gap:0.5rem; padding:0.3rem 0; font-size:0.85rem;">
          <input type="radio" name="merge-group-${gi}" class="merge-keep-radio" data-group="${gi}" value="${opt.id}" ${opt.id === group.defaultKeepId ? 'checked' : ''}>
          <span>
            <strong>Keep this one</strong> — ${escapeHtml(opt.path)}
            <span style="color:#94a3b8;"> (${opt.id})</span><br>
            <span style="color:#64748b;">${opt.usageCount} record${opt.usageCount === 1 ? '' : 's'} currently use this</span>
          </span>
        </label>
      `).join('')}
    </div>
  `).join('');

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:1.75rem; max-width:640px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <h3 style="margin-top:0;">🔀 ${groups.length} duplicate-named categor${groups.length === 1 ? 'y' : 'ies'}</h3>
      <p style="color:#64748b; font-size:0.85rem; margin-top:-0.5rem;">
        Pick which one to keep for each name. Every transaction, budget, bill, and recurring
        transaction using the others will be moved to the one you keep, then the duplicates
        are removed. Check "Skip this one" to leave a group untouched.
      </p>
      <div style="overflow-y:auto; flex:1; margin:0.5rem 0 1rem;">
        ${groupsHtml}
      </div>
      <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-primary" id="mergeApplySelected" style="margin-left:auto;">
          ✅ Merge Selected
        </button>
        <button class="btn btn-secondary" id="mergeCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#mergeCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#mergeApplySelected').addEventListener('click', async () => {
    const applyBtn = overlay.querySelector('#mergeApplySelected');
    applyBtn.disabled = true;
    applyBtn.textContent = 'Merging...';

    let groupsMerged = 0;
    let recordsMoved = 0;
    let categoriesDeleted = 0;
    let failed = 0;

    for (let gi = 0; gi < groups.length; gi++) {
      const skip = overlay.querySelector(`.merge-group-skip[data-group="${gi}"]`).checked;
      if (skip) continue;

      const selectedRadio = overlay.querySelector(`input[name="merge-group-${gi}"]:checked`);
      if (!selectedRadio) continue;

      const keepId = selectedRadio.value;
      const group = groups[gi];
      const loseIds = group.options.map(o => o.id).filter(id => id !== keepId);

      try {
        for (const storeName of REFERENCING_STORES) {
          const records = await getAllItems(storeName);
          for (const rec of records) {
            if (loseIds.includes(rec.categoryId)) {
              await updateItem(storeName, { ...rec, categoryId: keepId, updatedAt: new Date().toISOString() });
              recordsMoved++;
            }
          }
        }

        for (const loseId of loseIds) {
          await deleteItem(STORE_NAMES.categories, loseId);
          categoriesDeleted++;
        }

        groupsMerged++;
      } catch (err) {
        console.error('[MergeCategories] Failed to merge group', group.name, err);
        failed++;
      }
    }

    overlay.remove();
    if (failed > 0) {
      showToast(`⚠️ Merged ${groupsMerged} groups, ${failed} failed - check console`, 'error');
    } else if (groupsMerged === 0) {
      showToast('No groups selected', 'error');
    } else {
      showToast(`✅ Merged ${groupsMerged} groups — moved ${recordsMoved} records, removed ${categoriesDeleted} duplicate categories`, 'success');
    }
  });
}

/**
 * Entry point for a button click: scans, then shows the review modal (or a
 * toast if nothing needs merging).
 */
export async function runMergeCategoriesCheck(buttonEl) {
  const originalText = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '🔀 Scanning...';
  }

  try {
    const { groups } = await scanForDuplicateCategories();

    if (groups.length === 0) {
      showToast('✅ No duplicate-named categories found', 'success');
      return;
    }

    showMergeReviewModal(groups);
  } catch (err) {
    console.error('[MergeCategories] Scan failed', err);
    showToast('❌ Could not scan categories', 'error');
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}
