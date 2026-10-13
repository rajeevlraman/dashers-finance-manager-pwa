// ============================================================================
// 💾 backupReminder.js — "back up your data" nudge + header Backup/Restore buttons
// ----------------------------------------------------------------------------
// - Shows a dismissible banner when there is data but no recent backup.
// - Wires the header "Backup Data" / "Restore Data" buttons (and the mobile
//   drawer entries that forward clicks to them). These were previously not
//   connected to anything.
// All the actual backup logic lives in settings.js (export/import) and
// backupTools.js (reminder rules); this file is just the glue.
// ============================================================================
import { getAllItems, STORE_NAMES } from './db.js';
import { backupReminderState, snoozeReminder } from './backupTools.js';
import { escapeHtml } from './sanitize.js';

async function countRecords() {
  let n = 0;
  for (const store of [STORE_NAMES.transactions, STORE_NAMES.accounts]) {
    try { n += (await getAllItems(store)).length; } catch { /* ignore */ }
  }
  return n;
}

function removeBanner() {
  document.getElementById('backupReminder')?.remove();
}

export async function initBackupReminder() {
  removeBanner();
  const recordCount = await countRecords();
  const state = backupReminderState({ storage: localStorage, recordCount });
  if (!state.due) return;

  const text = state.never
    ? 'You have never backed up your data. It lives only in this browser.'
    : `Your last backup was ${state.days} days ago.`;

  const banner = document.createElement('div');
  banner.id = 'backupReminder';
  banner.className = 'backup-reminder';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span class="backup-reminder-text">💾 ${escapeHtml(text)}</span>
    <span class="backup-reminder-actions">
      <button type="button" class="btn btn-primary" id="backupReminderNow">Back up now</button>
      <button type="button" class="btn btn-secondary" id="backupReminderLater">Later</button>
    </span>`;
  document.body.appendChild(banner);

  banner.querySelector('#backupReminderNow').addEventListener('click', async () => {
    const { exportData } = await import('./settings.js');
    await exportData(); // removes the banner itself once a backup is really saved
  });
  banner.querySelector('#backupReminderLater').addEventListener('click', () => {
    snoozeReminder(localStorage);
    removeBanner();
  });
}

export function wireBackupButtons() {
  document.getElementById('btnExport')?.addEventListener('click', async () => {
    const { exportData } = await import('./settings.js');
    await exportData();
  });

  document.getElementById('btnImport')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
      const { importData } = await import('./settings.js');
      const restored = await importData(e);
      input.remove();
      if (restored) {
        // Refresh whatever page is open so restored data shows straight away.
        try {
          const { loadView } = await import('./ui.js');
          loadView(window.location.hash.replace('#', '') || 'finance-overview');
        } catch (err) {
          console.warn('[backup] Could not refresh the view after restore', err);
        }
      }
    });
    document.body.appendChild(input);
    input.click();
  });
}
