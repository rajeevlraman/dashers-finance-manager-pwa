import { restoreOneItem } from './restoreItem.js';
import { deleteTransactionsBulk, findOrphanedTransactionRecords, deleteRecordsBulk, clearAllData as dbClearAllData, getAllItems, STORE_NAMES, addItem, updateItem, deleteItem } from './db.js';
import { isDuplicateTransaction } from './import/saver.js';
import { findDuplicateGroups, getDefaultDeletionIds } from './import/duplicateFinder.js';
import { runRecategorizeCheck } from './recategorizeTool.js';
import { runFixCreditCardTransfers } from './fixCreditCardTransfers.js';
import { runPropertyMatchCheck } from './propertyMatchTool.js';
import { runVehicleMatchCheck } from './vehicleMatchTool.js';
import { clearLearnedMerchantRules, clearLearnedPropertyRules } from './import/categoryMapper.js';
import { runMergeCategoriesCheck } from './mergeCategoriesTool.js';
import { isLockConfigured, isSupported as isLockSupported, setupPin, changePin, removeLock } from './appLock.js';
import { encryptJSON, decryptJSON, isSupported as isEncryptionSupported } from './backupCrypto.js';
import {
  recordBackup, getLastBackup, describeLastBackup, inspectBackup, backupFilename,
  canShareFile, shareBackupFile
} from './backupTools.js';
import {
  isConnected, isAdmin, getConnectionInfo, checkSetupStatus, setupAdminAccount, loginToServer,
  disconnect, syncNow, listFamilyMembers, createFamilyMember, updateFamilyMember, deleteFamilyMember,
  updateFamilySyncIndicator
} from './familySync.js';
import { applyPermittedSections } from './navigation.js';
import { ALL_SECTIONS_LABELS } from './familySyncSections.js';
import { hasFeature, viewReleased, STORE_FEATURE } from './features.js';
import { escapeHtml } from './sanitize.js';
import { applyChartTheme } from './chartTheme.js';
import { APP_VERSION } from './version.js';
import { applyUpdateAndReload, isPageStale } from './swUpdate.js';

import { addCurrency, formatMoney, getBaseCurrency, getCurrencies, getRates, getRatesUpdated, hasRate, removeCurrency, setBaseCurrency, setRate } from './utils/currency.js';
import { getTheme, setTheme } from './themeToggle.js';
import { getDisplayName, setDisplayName, MAX_NAME_LENGTH } from './userName.js';
export async function initSettingsUI() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) {
    console.error('❌ mainContent is missing in DOM!');
    return;
  }

  mainContent.innerHTML = `
    <div class="settings-container">
      <div class="settings-header">
        <h2>⚙️ Settings</h2>
        <p class="settings-subtitle">Manage your application preferences and data</p>
      </div>
        <div class="section-card">

      <div class="settings-grid">
        <!-- Setup guide & tour -->
        <div class="settings-card">
          <div class="settings-card-header"><h3>🧭 Setup guide &amp; tour</h3></div>
          <p style="margin:0 0 .75rem;">New here, or skipped the setup? Take a quick tour of every page, or run the guided setup again to add your accounts, loans and more.</p>
          <div class="button-group">
            <button type="button" class="btn btn-primary" data-open-guide="tour">Take the tour</button>
            <button type="button" class="btn btn-secondary" data-open-guide="setup">Run setup guide</button>
          </div>
        </div>

        <!-- Preferences Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>🎯 Preferences</h3>
          </div>
          <div class="settings-card-body">
            <div class="form-group">
              <label class="form-label">Default Currency</label>
              <select id="currencySelect" class="form-select">
                <option value="">Loading currencies...</option>
              </select>
              <small class="form-hint">Base currency for totals, dashboards and reports. Changing it clears the exchange rates below.</small>
            </div>
            <div class="form-group" id="ratesSection">
              <label class="form-label">Exchange rates <small id="ratesUpdatedLabel"></small></label>
              <div id="ratesTable"></div>
              <div class="rate-add-row">
                <input id="newCurrencyCode" class="form-input" maxlength="3" placeholder="Code, e.g. CHF" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase">
                <button type="button" class="btn btn-secondary" id="btnAddCurrency">Add currency</button>
              </div>
              <small id="currencyEditorMsg" class="form-hint"></small>
              <small class="form-hint">Manual rates: how much 1 unit of each currency is worth in your base currency. Used to total accounts held in other currencies.</small>
            </div>
            <div class="form-group">
              <label class="form-label">Date Format</label>
              <select id="dateFormatSelect" class="form-select">
                <option value="en-AU">DD/MM/YYYY (Australian)</option>
                <option value="en-US">MM/DD/YYYY (US)</option>
                <option value="en-GB">DD/MM/YYYY (UK)</option>
                <option value="de-DE">DD.MM.YYYY (European)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="displayNameInput">Your name (optional)</label>
              <input type="text" id="displayNameInput" class="form-input" maxlength="${MAX_NAME_LENGTH}" autocomplete="nickname" placeholder="What should we call you?">
              <small class="form-hint">Used only to greet you, like “Good morning, Sam”. It stays on this device.</small>
            </div>
            <button class="btn btn-primary" id="savePreferences">
              💾 Save Preferences
            </button>
          </div>
        </div>

        <!-- Theme Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>🎨 Appearance</h3>
          </div>
          <div class="settings-card-body">
            <div class="form-group">
              <label class="form-label">Theme</label>
              <select id="themeSelect" class="form-select">
                <option value="light">☀️ Light</option>
                <option value="dark">🌙 Dark</option>
                <option value="auto">⚡ Auto (System)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Accent Color</label>
              <div class="color-picker-group">
                <input type="color" id="accentColor" value="#3498db" class="color-picker">
                <span class="color-value" id="accentColorValue">#3498db</span>
              </div>
            </div>
            <button class="btn btn-primary" id="applyTheme">
              🎨 Apply Appearance
            </button>
          </div>
        </div>

        <!-- App Lock Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>🔒 App Lock</h3>
          </div>
          <div class="settings-card-body">
            <p style="color:#64748b; font-size:0.85rem; margin-top:0;">
              A PIN screen that blocks the app UI when it's not you opening it.
              This is not encryption — the underlying data isn't encrypted by this —
              it just stops casual access to your unlocked device. There's no PIN
              recovery; forgetting it means wiping local data.
            </p>
            <div id="appLockStatus" style="margin-bottom:0.75rem; font-weight:600;">Loading…</div>
            <div class="button-group" id="appLockButtons"></div>
          </div>
        </div>

        <!-- Family Sync Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>👨‍👩‍👧‍👦 Family Sync</h3>
          </div>
          <div class="settings-card-body">
            <p style="color:#64748b; font-size:0.85rem; margin-top:0;">
              Share data with family on a local server on your home WiFi —
              no internet or cloud involved. Requires running the small
              server included in this project (see family-server/README.md).
            </p>
            <div id="familySyncStatus" style="margin-bottom:0.75rem; font-weight:600;">Loading…</div>
            <div class="button-group" id="familySyncButtons"></div>
          </div>
        </div>

        <!-- Licence (hidden unless licensing is turned on in js/licenceConfig.js) -->
        <div class="settings-card" id="licenceCard" style="display:none;"></div>

        <!-- Data Management Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>💾 Data Management</h3>
          </div>
          <div class="settings-card-body">
            <div class="data-stats" id="dataStats">
              <div class="loading-spinner">Loading data statistics...</div>
            </div>
            <div id="lastBackupInfo" style="font-size:0.85rem; margin-bottom:0.75rem;"></div>
            <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; color:var(--text-main); margin-bottom:0.75rem;">
              <input type="checkbox" id="encryptBackupCheckbox">
              🔒 Encrypt backup with a password
            </label>
            <div class="button-group">
              <button class="btn btn-secondary" id="exportData">
                📤 Export Data
              </button>
              <input type="file" id="importFile" style="display:none" accept=".json" />
              <button class="btn btn-secondary" id="importData">
                📥 Import Data
              </button>
              <button class="btn btn-secondary" id="findDuplicatesBtn">
                🔎 Find Duplicate Transactions
              </button>
              <button class="btn btn-secondary" id="recheckCategoriesBtn">
                🔄 Review & Fix Transaction Categories
              </button>
              <button class="btn btn-secondary" id="fixCreditCardTransfersBtn">
                💳 Review & Fix Credit Card Payment Transfers
              </button>
              <button class="btn btn-secondary" id="recheckPropertyMatchesBtn" data-feature="property">
                🏠 Review & Fix Property Matches
              </button>
              <button class="btn btn-secondary" id="recheckVehicleMatchesBtn">
                🚗 Review & Fix Vehicle Rego & Fuel Matches
              </button>
              <button class="btn btn-secondary" id="mergeCategoriesBtn">
                🔀 Merge Duplicate Categories
              </button>
              <button class="btn btn-secondary" id="clearLearnedRulesBtn">
                🧹 Clear Auto-Learned Merchant Rules
              </button>
              <button class="btn btn-secondary" id="clearLearnedPropertyRulesBtn" data-feature="property">
                🧹 Clear Auto-Learned Property Rules
              </button>
            </div>
          </div>
        </div>

        <!-- Demo / Test Data Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>🧪 Demo / Test Data</h3>
          </div>
          <div class="settings-card-body">
            <p style="color:#64748b; font-size:0.85rem; margin-top:0;">
              Load a ready-made sample household (accounts, transactions, loans,
              ${hasFeature('property') ? 'properties, ' : ''}bills, super, insurance, vehicles) to explore the app.
              Every demo record has an ID starting with <code>demo_</code>, so
              <strong>Remove Demo Data</strong> clears only the sample records and
              never touches your own. A sample USD exchange rate is added if you
              have none; INR is deliberately left unset so you can see the
              missing-rate warning.
            </p>
            <div class="button-group">
              <button class="btn btn-secondary" id="runSetupGuideBtn">🧭 Run setup guide</button>
              <button class="btn btn-secondary" id="loadDemoDataBtn">🧪 Load Demo Data</button>
              <button class="btn btn-secondary" id="removeDemoDataBtn">🧹 Remove Demo Data</button>
            </div>
          </div>
        </div>

        <!-- Database info (the "Migrate to Dexie" button that used to be here
             copied data into a second database the app never actually reads
             from, and silently skipped 3 stores while doing it — removed
             rather than fixed since the current IndexedDB layer works fine
             and there's no real benefit to finishing it right now). -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>🗄️ Database</h3>
          </div>
          <div class="settings-card-body">
            <div class="database-info">
              <p><strong>Current Database:</strong> <span id="currentDbType">IndexedDB</span></p>
              <p><strong>Status:</strong> <span id="dbStatus" class="status-badge">Operational</span></p>
            </div>
          </div>
        </div>

        <!-- Reset Section -->
        <div class="settings-card danger-zone">
          <div class="settings-card-header">
            <h3>🚨 Danger Zone</h3>
          </div>
          <div class="settings-card-body">
            <div class="warning-message">
              <p>⚠️ These actions cannot be undone. Proceed with caution.</p>
            </div>
            <div class="button-group">
              <button class="btn btn-danger" id="clearCache">
                🗑️ Clear Cache
              </button>
              <button class="btn btn-danger" id="cleanOrphansBtn" data-feature="property">
                🧽 Clean Up Property Records…
              </button>
              <button class="btn btn-danger" id="deleteTransactionsBtn">
                🧹 Delete Transactions…
              </button>
              <button class="btn btn-danger" id="clearAllDataBtn">
                💥 Clear All Data
              </button>
            </div>
          </div>
        </div>

        <!-- About Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>ℹ️ About</h3>
          </div>
          <div class="settings-card-body">
            <div class="about-info">
              <p><strong>Version:</strong> ${APP_VERSION}</p>
              <p><strong>Last Updated:</strong> ${new Date().toLocaleDateString()}</p>
              <p><strong>Storage:</strong> <span id="storageUsage">Calculating...</span></p>
            </div>
            <button class="btn btn-secondary" id="checkUpdates">
              🔍 Check for Updates
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- App Lock Modal -->
    <div class="modal" id="modalAppLock">
      <div class="modal-content" style="max-width:380px;">
        <h2 id="appLockModalTitle">🔒 Set Up App Lock</h2>
        <form id="formAppLock">
          <div class="form-group" id="appLockOldPinGroup" style="display:none;">
            <label class="form-label">Current PIN</label>
            <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" class="form-input" id="appLockOldPin" autocomplete="off">
          </div>
          <div class="form-group" id="appLockNewPinGroup">
            <label class="form-label">New PIN (4-8 digits)</label>
            <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" class="form-input" id="appLockNewPin" autocomplete="off">
          </div>
          <div class="form-group" id="appLockConfirmPinGroup">
            <label class="form-label">Confirm PIN</label>
            <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" class="form-input" id="appLockConfirmPin" autocomplete="off">
          </div>
          <div id="appLockModalError" style="color:#dc2626; font-size:0.85rem; min-height:1.2em; margin-bottom:0.5rem;"></div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="appLockModalSubmit">Save</button>
            <button type="button" class="btn btn-secondary" id="appLockModalCancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Family Sync: Connect/Login Modal -->
    <div class="modal" id="modalFamilyConnect">
      <div class="modal-content" style="max-width:400px;">
        <h2 id="familyConnectTitle">👨‍👩‍👧‍👦 Connect to Family Server</h2>
        <form id="formFamilyConnect">
          <div class="form-group" id="familyServerUrlGroup">
            <label class="form-label">Server Address</label>
            <input type="text" id="familyServerUrl" class="form-input" placeholder="https://192.168.1.42:4321 (or http:// if you haven't set up HTTPS)" autocomplete="off">
            <small class="form-hint">Find this in family-server/README.md on the server machine.</small>
          </div>
          <div class="form-group" id="familyCheckGroup">
            <button type="button" class="btn btn-secondary" id="familyCheckServerBtn" style="width:100%;">Check Server</button>
          </div>
          <div id="familyAuthFields" style="display:none;">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" id="familyUsername" class="form-input"
                     autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
                     data-lpignore="true" data-1p-ignore data-form-type="other" readonly
                     onfocus="this.removeAttribute('readonly')">
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="familyPassword" class="form-input"
                     autocomplete="new-password" data-lpignore="true" data-1p-ignore data-form-type="other"
                     readonly onfocus="this.removeAttribute('readonly')">
            </div>
            <div id="familyLoginAsPreview" style="font-size:0.85rem; color:var(--text-main); min-height:1.2em; margin-bottom:0.5rem;"></div>
            <div id="familySetupNotice" style="display:none; font-size:0.85rem; color:#0369a1; background:#f0f9ff; border-radius:8px; padding:0.5rem 0.75rem; margin-bottom:0.75rem;">
              No admin account exists yet on this server — this will create one and make you the admin.
            </div>
          </div>
          <div id="familyConnectError" style="color:#dc2626; font-size:0.85rem; min-height:1.2em; margin-bottom:0.5rem;"></div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="familyConnectSubmit" style="display:none;">Connect</button>
            <button type="button" class="btn btn-secondary" id="familyConnectCancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Family Sync: Manage Members Modal -->
    <div class="modal" id="modalFamilyMembers">
      <div class="modal-content" style="max-width:480px;">
        <h2>👨‍👩‍👧‍👦 Manage Family Members</h2>
        <div id="familyMembersList"></div>
        <hr style="margin:1rem 0; border:none; border-top:1px solid #e2e8f0;">
        <h3 style="font-size:1rem;">Add a Family Member</h3>
        <form id="formAddFamilyMember">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" id="newMemberUsername" class="form-input" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" id="newMemberPassword" class="form-input" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">Allowed Sections</label>
            <div id="newMemberSections" style="display:grid; grid-template-columns:1fr 1fr; gap:0.35rem; max-height:200px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:0.5rem;"></div>
          </div>
          <div id="addMemberError" style="color:#dc2626; font-size:0.85rem; min-height:1.2em; margin-bottom:0.5rem;"></div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Add Member</button>
            <button type="button" class="btn btn-secondary" id="familyMembersClose">Close</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Initialize all settings components
  await initializeSettings();
  setupEventListeners();
}

// ============================================================================
// 🏗️ INITIALIZATION FUNCTIONS
// ============================================================================

async function initializeSettings() {
  await loadCurrencySettings();
  await loadThemeSettings();
  await loadDateFormatSettings();
  import('./licenceGate.js').then(m => m.renderLicenceCard(document.getElementById('licenceCard'))).catch(err => console.warn('[settings] Licence card failed', err));
  await loadDataStatistics();
  await calculateStorageUsage();
  await renderAppLockStatus();
  await renderFamilySyncStatus();
}

function setupEventListeners() {
  // Preferences
  document.getElementById('savePreferences').addEventListener('click', savePreferences);
  
  // Theme
  document.getElementById('applyTheme').addEventListener('click', applyTheme);
  document.getElementById('accentColor').addEventListener('input', updateAccentColorPreview);
  
  // Data Management
  document.getElementById('exportData').addEventListener('click', exportData);
  document.getElementById('importData').addEventListener('click', triggerImport);
  document.getElementById('importFile').addEventListener('change', importData);
  document.getElementById('findDuplicatesBtn').addEventListener('click', handleFindDuplicates);
  document.getElementById('loadDemoDataBtn').addEventListener('click', loadDemoData);
  document.getElementById('runSetupGuideBtn')?.addEventListener('click', () => import('./onboarding.js').then(m => m.startOnboarding()));
  document.getElementById('removeDemoDataBtn').addEventListener('click', removeDemoData);
  document.getElementById('recheckCategoriesBtn').addEventListener('click', (e) => runRecategorizeCheck(e.target));
  document.getElementById('fixCreditCardTransfersBtn').addEventListener('click', (e) => runFixCreditCardTransfers(e.target));
  document.getElementById('recheckPropertyMatchesBtn').addEventListener('click', (e) => runPropertyMatchCheck(e.target));
  document.getElementById('recheckVehicleMatchesBtn').addEventListener('click', (e) => runVehicleMatchCheck(e.target));

  document.getElementById('clearLearnedRulesBtn').addEventListener('click', () => {
    const proceed = confirm(
      'This clears every auto-learned merchant categorization rule.\n\n' +
      'Why: a bug meant some learned rules were too broad — e.g. a rule ' +
      'learned from a bare "Woolworths" transaction ended up matching ' +
      '"Woolworths Insurance" too, silently overriding the correct category. ' +
      'There\'s no way to tell a good learned rule from a bad one after the ' +
      'fact, so this clears all of them.\n\n' +
      'Nothing about your transactions changes yet — after clearing, use ' +
      '"Review & Fix Transaction Categories" to re-categorize using the ' +
      'current (fixed) rules. Any manual corrections you make will be ' +
      'learned again normally after 3 repeats.\n\nContinue?'
    );
    if (!proceed) return;

    const count = clearLearnedMerchantRules();
    alert(`Cleared ${count} learned rule(s). Opening the category review now...`);
    runRecategorizeCheck(null);
  });

  document.getElementById('clearLearnedPropertyRulesBtn').addEventListener('click', () => {
    const proceed = confirm(
      'This clears every auto-learned merchant+account -> property rule ' +
      '(taught by manually tagging a transaction to a property).\n\n' +
      'Nothing about your transactions changes yet — after clearing, use ' +
      '"Review & Fix Property Matches" to re-check using account links and ' +
      'address matching only. Manual corrections you make going forward ' +
      'will be learned again normally.\n\nContinue?'
    );
    if (!proceed) return;

    const count = clearLearnedPropertyRules();
    alert(`Cleared ${count} learned property rule(s). Opening the property match review now...`);
    runPropertyMatchCheck(null);
  });
  document.getElementById('mergeCategoriesBtn').addEventListener('click', (e) => runMergeCategoriesCheck(e.target));
  
  // Reset - FIXED: Using unique function names
  document.getElementById('clearCache').addEventListener('click', clearCache);
  document.getElementById('clearAllDataBtn').addEventListener('click', handleClearAllData); // Fixed: unique function name
  document.getElementById('deleteTransactionsBtn').addEventListener('click', handleDeleteTransactions);
  document.getElementById('cleanOrphansBtn').addEventListener('click', handleCleanOrphans);
  
  // About
  document.getElementById('checkUpdates').addEventListener('click', checkForUpdates);

  // App Lock
  document.getElementById('appLockModalCancel').addEventListener('click', closeAppLockModal);
  document.getElementById('formAppLock').addEventListener('submit', handleAppLockFormSubmit);

  // Family Sync
  document.getElementById('familyCheckServerBtn').addEventListener('click', handleCheckServerClick);
  document.getElementById('familyConnectCancel').addEventListener('click', closeFamilyConnectModal);
  document.getElementById('formFamilyConnect').addEventListener('submit', handleFamilyConnectSubmit);
  document.getElementById('familyUsername').addEventListener('input', updateFamilyLoginPreview);
  document.getElementById('familyMembersClose').addEventListener('click', closeFamilyMembersModal);
  document.getElementById('formAddFamilyMember').addEventListener('submit', handleAddFamilyMemberSubmit);
}

// ============================================================================
// 🔒 APP LOCK FUNCTIONS
// ============================================================================

let appLockModalMode = 'setup'; // 'setup' | 'change' | 'remove'

async function renderAppLockStatus() {
  const statusEl = document.getElementById('appLockStatus');
  const buttonsEl = document.getElementById('appLockButtons');
  if (!statusEl || !buttonsEl) return;

  if (!isLockSupported()) {
    statusEl.textContent = '⚠️ Not available in this browser (requires a secure context).';
    statusEl.style.color = '#dc2626';
    buttonsEl.innerHTML = '';
    return;
  }

  const configured = await isLockConfigured();
  if (configured) {
    statusEl.textContent = '🟢 App Lock is ON';
    statusEl.style.color = '#16a34a';
    buttonsEl.innerHTML = `
      <button class="btn btn-secondary" id="btnChangePin">Change PIN</button>
      <button class="btn btn-danger" id="btnRemoveLock">Turn Off App Lock</button>
    `;
    document.getElementById('btnChangePin').addEventListener('click', () => openAppLockModal('change'));
    document.getElementById('btnRemoveLock').addEventListener('click', () => openAppLockModal('remove'));
  } else {
    statusEl.textContent = '⚪ App Lock is OFF';
    statusEl.style.color = '#64748b';
    buttonsEl.innerHTML = `<button class="btn btn-primary" id="btnEnableLock">Enable App Lock</button>`;
    document.getElementById('btnEnableLock').addEventListener('click', () => openAppLockModal('setup'));
  }
}

function openAppLockModal(mode) {
  appLockModalMode = mode;
  const modal = document.getElementById('modalAppLock');
  const title = document.getElementById('appLockModalTitle');
  const oldGroup = document.getElementById('appLockOldPinGroup');
  const newGroup = document.getElementById('appLockNewPinGroup');
  const confirmGroup = document.getElementById('appLockConfirmPinGroup');
  const submitBtn = document.getElementById('appLockModalSubmit');
  document.getElementById('appLockModalError').textContent = '';
  document.getElementById('formAppLock').reset();

  if (mode === 'setup') {
    title.textContent = '🔒 Set Up App Lock';
    oldGroup.style.display = 'none';
    newGroup.style.display = 'block';
    confirmGroup.style.display = 'block';
    submitBtn.textContent = 'Enable Lock';
  } else if (mode === 'change') {
    title.textContent = '🔒 Change PIN';
    oldGroup.style.display = 'block';
    newGroup.style.display = 'block';
    confirmGroup.style.display = 'block';
    submitBtn.textContent = 'Save New PIN';
  } else if (mode === 'remove') {
    title.textContent = '🔓 Turn Off App Lock';
    oldGroup.style.display = 'block';
    newGroup.style.display = 'none';
    confirmGroup.style.display = 'none';
    submitBtn.textContent = 'Turn Off';
  }

  modal.classList.add('active');
}

function closeAppLockModal() {
  document.getElementById('modalAppLock').classList.remove('active');
}

async function handleAppLockFormSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('appLockModalError');
  errorEl.textContent = '';

  const oldPin = document.getElementById('appLockOldPin').value;
  const newPin = document.getElementById('appLockNewPin').value;
  const confirmPin = document.getElementById('appLockConfirmPin').value;

  const pinPattern = /^\d{4,8}$/;

  if (appLockModalMode === 'setup') {
    if (!pinPattern.test(newPin)) {
      errorEl.textContent = 'PIN must be 4-8 digits.';
      return;
    }
    if (newPin !== confirmPin) {
      errorEl.textContent = 'PINs do not match.';
      return;
    }
    await setupPin(newPin);
    closeAppLockModal();
    await renderAppLockStatus();
    showToast('App Lock enabled', 'success');

  } else if (appLockModalMode === 'change') {
    if (!pinPattern.test(newPin)) {
      errorEl.textContent = 'PIN must be 4-8 digits.';
      return;
    }
    if (newPin !== confirmPin) {
      errorEl.textContent = 'PINs do not match.';
      return;
    }
    const ok = await changePin(oldPin, newPin);
    if (!ok) {
      errorEl.textContent = 'Current PIN is incorrect.';
      return;
    }
    closeAppLockModal();
    await renderAppLockStatus();
    showToast('PIN updated', 'success');

  } else if (appLockModalMode === 'remove') {
    const ok = await removeLock(oldPin);
    if (!ok) {
      errorEl.textContent = 'Current PIN is incorrect.';
      return;
    }
    closeAppLockModal();
    await renderAppLockStatus();
    showToast('App Lock turned off', 'success');
  }
}

// ============================================================================
// 👨‍👩‍👧‍👦 FAMILY SYNC FUNCTIONS
// ============================================================================

let familyConnectMode = 'setup'; // 'setup' | 'login'

async function renderFamilySyncStatus() {
  const statusEl = document.getElementById('familySyncStatus');
  const buttonsEl = document.getElementById('familySyncButtons');
  if (!statusEl || !buttonsEl) return;

  const connected = await isConnected();
  if (!connected) {
    statusEl.textContent = '⚪ Not connected';
    statusEl.style.color = '#64748b';
    buttonsEl.innerHTML = `<button class="btn btn-primary" id="btnFamilyConnect">Connect to Server</button>`;
    document.getElementById('btnFamilyConnect').addEventListener('click', openFamilyConnectModal);
    return;
  }

  const conn = await getConnectionInfo();
  const admin = await isAdmin();
  const lastSync = conn.lastSyncTime
    ? new Date(conn.lastSyncTime).toLocaleString()
    : 'Never';

  statusEl.innerHTML = `🟢 Connected as <strong>${conn.username}</strong> (${admin ? 'admin' : 'member'})<br>
    <span style="font-weight:400; font-size:0.8rem; color:#64748b;">Last synced: ${lastSync}</span>`;

  buttonsEl.innerHTML = `
    <button class="btn btn-secondary" id="btnSyncNow">🔄 Sync Now</button>
    ${admin ? '<button class="btn btn-secondary" id="btnManageFamily">Manage Family Members</button>' : ''}
    <button class="btn btn-danger" id="btnFamilyDisconnect">Disconnect</button>
  `;
  document.getElementById('btnSyncNow').addEventListener('click', handleSyncNowClick);
  document.getElementById('btnFamilyDisconnect').addEventListener('click', handleDisconnectClick);
  if (admin) {
    document.getElementById('btnManageFamily').addEventListener('click', openFamilyMembersModal);
  }
}

async function handleSyncNowClick() {
  showToast('🔄 Syncing…', 'info');
  const result = await syncNow();
  if (result.synced) {
    showToast(`✅ Synced (pulled ${result.pulled}, pushed ${result.pushed})`, 'success');
    await applyPermittedSections();
  } else if (result.reason === 'session-expired') {
    showToast('⚠️ Session expired — please reconnect', 'error');
  } else if (result.reason === 'unreachable') {
    showToast('⚠️ Could not reach the family server (check WiFi)', 'error');
  } else {
    showToast('⚠️ Sync failed', 'error');
  }
  await renderFamilySyncStatus();
  updateFamilySyncIndicator();
}

async function handleDisconnectClick() {
  if (!confirm('Disconnect from the family server? Your local data stays exactly as it is — this only stops syncing.')) return;
  await disconnect();
  await renderFamilySyncStatus();
  await applyPermittedSections();
  updateFamilySyncIndicator();
  showToast('Disconnected', 'info');
}

function openFamilyConnectModal() {
  const modal = document.getElementById('modalFamilyConnect');
  document.getElementById('formFamilyConnect').reset();
  document.getElementById('familyConnectError').textContent = '';
  document.getElementById('familyAuthFields').style.display = 'none';
  document.getElementById('familySetupNotice').style.display = 'none';
  document.getElementById('familyConnectSubmit').style.display = 'none';
  document.getElementById('familyServerUrl').disabled = false;
  document.getElementById('familyLoginAsPreview').textContent = '';
  modal.classList.add('active');
}

function closeFamilyConnectModal() {
  document.getElementById('modalFamilyConnect').classList.remove('active');
}

async function handleCheckServerClick() {
  const urlInput = document.getElementById('familyServerUrl');
  const errorEl = document.getElementById('familyConnectError');
  errorEl.textContent = '';
  const url = urlInput.value.trim();
  if (!url) {
    errorEl.textContent = 'Enter the server address first.';
    return;
  }

  try {
    const status = await checkSetupStatus(url);
    familyConnectMode = status.needsSetup ? 'setup' : 'login';
    document.getElementById('familyAuthFields').style.display = 'block';
    document.getElementById('familySetupNotice').style.display = familyConnectMode === 'setup' ? 'block' : 'none';
    document.getElementById('familyConnectSubmit').style.display = 'block';
    document.getElementById('familyConnectSubmit').textContent = familyConnectMode === 'setup' ? 'Create Admin Account' : 'Log In';
    urlInput.disabled = true;
    updateFamilyLoginPreview();
  } catch (err) {
    errorEl.textContent = `Couldn't reach that server: ${err.message}`;
  }
}

function updateFamilyLoginPreview() {
  const previewEl = document.getElementById('familyLoginAsPreview');
  const username = document.getElementById('familyUsername').value.trim();
  if (!username) {
    previewEl.textContent = '';
    return;
  }
  previewEl.innerHTML = familyConnectMode === 'setup'
    ? `Will create the admin account as: <strong>${escapeHtml(username)}</strong>`
    : `Will log in as: <strong>${escapeHtml(username)}</strong> — double check this is right before continuing (autofill can silently swap this).`;
}

async function handleFamilyConnectSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('familyConnectError');
  errorEl.textContent = '';
  const url = document.getElementById('familyServerUrl').value.trim();
  const username = document.getElementById('familyUsername').value.trim();
  const password = document.getElementById('familyPassword').value;

  if (!username || !password) {
    errorEl.textContent = 'Username and password are required.';
    return;
  }

  try {
    if (familyConnectMode === 'setup') {
      await setupAdminAccount(url, username, password);
    } else {
      await loginToServer(url, username, password);
    }
    closeFamilyConnectModal();
    await renderFamilySyncStatus();
    await applyPermittedSections();
    showToast('✅ Connected! Syncing now…', 'success');
    await handleSyncNowClick();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// --- Manage Family Members ---

function renderSectionCheckboxes(container, selectedSections = []) {
  container.innerHTML = ALL_SECTIONS_LABELS.filter(({ key }) => viewReleased(key)).map(({ key, label }) => `
    <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.85rem;">
      <input type="checkbox" value="${key}" ${selectedSections.includes(key) ? 'checked' : ''}>
      ${label}
    </label>
  `).join('');
}

async function openFamilyMembersModal() {
  const modal = document.getElementById('modalFamilyMembers');
  renderSectionCheckboxes(document.getElementById('newMemberSections'), []);
  document.getElementById('formAddFamilyMember').reset();
  document.getElementById('addMemberError').textContent = '';
  modal.classList.add('active');
  await refreshFamilyMembersList();
}

function closeFamilyMembersModal() {
  document.getElementById('modalFamilyMembers').classList.remove('active');
}

async function refreshFamilyMembersList() {
  const listEl = document.getElementById('familyMembersList');
  listEl.innerHTML = '<p style="color:#64748b; font-size:0.85rem;">Loading…</p>';
  try {
    const { users } = await listFamilyMembers();
    if (!users.length) {
      listEl.innerHTML = '<p style="color:#64748b; font-size:0.85rem;">No family members yet.</p>';
      return;
    }
    listEl.innerHTML = users.map(u => `
      <div class="family-member-row" data-user-id="${u.id}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
          <strong>${escapeHtml(u.username)}</strong>
          <span style="font-size:0.8rem; color:#64748b;">${u.role}</span>
        </div>
        ${u.role === 'admin' ? '<p style="font-size:0.8rem; color:#64748b; margin:0;">Full access (admin)</p>' : `
          <div class="member-sections">
            ${ALL_SECTIONS_LABELS.filter(({ key }) => viewReleased(key)).map(({ key, label }) => `
              <label style="display:flex; align-items:center; gap:0.3rem; font-size:0.8rem;">
                <input type="checkbox" class="member-section-cb" value="${key}" ${u.sections.includes(key) ? 'checked' : ''}>
                ${label}
              </label>
            `).join('')}
          </div>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-save-sections">Save Sections</button>
            <button class="btn btn-secondary btn-reset-password">Reset Password</button>
            <button class="btn btn-danger btn-delete-member">Delete</button>
          </div>
        `}
      </div>
    `).join('');

    listEl.querySelectorAll('.family-member-row').forEach(row => {
      const userId = row.dataset.userId;
      row.querySelector('.btn-save-sections')?.addEventListener('click', async () => {
        const sections = [...row.querySelectorAll('.member-section-cb:checked')].map(cb => cb.value);
        try {
          await updateFamilyMember(userId, { sections });
          showToast('Sections updated', 'success');
        } catch (err) {
          showToast(`❌ ${err.message}`, 'error');
        }
      });
      row.querySelector('.btn-reset-password')?.addEventListener('click', async () => {
        const newPassword = prompt('Enter a new password for this family member (8+ characters):');
        if (!newPassword) return;
        try {
          await updateFamilyMember(userId, { password: newPassword });
          showToast('Password reset', 'success');
        } catch (err) {
          showToast(`❌ ${err.message}`, 'error');
        }
      });
      row.querySelector('.btn-delete-member')?.addEventListener('click', async () => {
        if (!confirm('Remove this family member? They will no longer be able to sync.')) return;
        try {
          await deleteFamilyMember(userId);
          await refreshFamilyMembersList();
          showToast('Family member removed', 'success');
        } catch (err) {
          showToast(`❌ ${err.message}`, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:#dc2626; font-size:0.85rem;">${err.message}</p>`;
  }
}

async function handleAddFamilyMemberSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('addMemberError');
  errorEl.textContent = '';
  const username = document.getElementById('newMemberUsername').value.trim();
  const password = document.getElementById('newMemberPassword').value;
  const sections = [...document.querySelectorAll('#newMemberSections input:checked')].map(cb => cb.value);

  if (!username || !password) {
    errorEl.textContent = 'Username and password are required.';
    return;
  }

  try {
    await createFamilyMember(username, password, sections);
    document.getElementById('formAddFamilyMember').reset();
    renderSectionCheckboxes(document.getElementById('newMemberSections'), []);
    await refreshFamilyMembersList();
    showToast('Family member added', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ============================================================================
// 🎯 PREFERENCES FUNCTIONS
// ============================================================================

async function loadCurrencySettings() {
  const currencySelect = document.getElementById('currencySelect');
  currencySelect.innerHTML = getCurrencies().map(c =>
    `<option value="${c.code}" ${c.code === getBaseCurrency() ? 'selected' : ''}>${c.symbol} ${c.name} (${c.code})</option>`
  ).join('');
  renderRatesTable();
  currencySelect.addEventListener('change', () => renderRatesTable(currencySelect.value));
}

function renderRatesTable(pendingBase) {
  const base = pendingBase || getBaseCurrency();
  const rates = pendingBase && pendingBase !== getBaseCurrency() ? {} : getRates();
  const updated = pendingBase && pendingBase !== getBaseCurrency() ? null : getRatesUpdated();
  const label = document.getElementById('ratesUpdatedLabel');
  if (label) label.textContent = updated ? `(last updated ${updated})` : '(not set)';
  document.getElementById('ratesTable').innerHTML = getCurrencies().filter(c => c.code !== base).map(c => `
    <div class="rate-row">
      <span class="rate-label">1 ${c.code} =</span>
      <input type="number" inputmode="decimal" step="any" min="0" class="form-input rate-input" data-code="${c.code}"
             value="${rates[c.code] ?? ''}" placeholder="rate" aria-label="Exchange rate: 1 ${c.code} in ${base}">
      <span class="rate-base">${base}</span>
      <button type="button" class="btn btn-secondary rate-remove" data-code="${c.code}" title="Remove ${c.code}" aria-label="Remove ${c.code}">✕</button>
    </div>`).join('');
  wireCurrencyEditor();
}

async function loadDateFormatSettings() {
  const dateFormatSelect = document.getElementById('dateFormatSelect');
  const savedDateFormat = localStorage.getItem('dateFormat') || 'en-AU';
  dateFormatSelect.value = savedDateFormat;
  const nameInput = document.getElementById('displayNameInput');
  if (nameInput) nameInput.value = getDisplayName();
}

async function savePreferences() {
  const currency = document.getElementById('currencySelect').value;
  const dateFormat = document.getElementById('dateFormatSelect').value;
  
  if (currency !== getBaseCurrency()) await setBaseCurrency(currency);
  for (const input of document.querySelectorAll('.rate-input')) {
    const code = input.dataset.code;
    const next = Number(input.value) || 0;
    if (next !== (getRates()[code] || 0)) await setRate(code, next);
  }
  renderRatesTable();
  localStorage.setItem('dateFormat', dateFormat);
  const nameInput = document.getElementById('displayNameInput');
  if (nameInput) nameInput.value = setDisplayName(nameInput.value);
  
  showToast('✅ Preferences saved successfully!', 'success');
}

// ============================================================================
// 🎨 THEME FUNCTIONS
// ============================================================================

async function loadThemeSettings() {
  const themeSelect = document.getElementById('themeSelect');
  const currentTheme = getTheme();
  themeSelect.value = currentTheme;
  
  const accentColor = localStorage.getItem('accentColor') || '#3498db';
  document.getElementById('accentColor').value = accentColor;
  document.getElementById('accentColorValue').textContent = accentColor;
  
  setTheme(currentTheme);

  // The header button can change the theme while this page is open.
  if (!window.__dfmThemeSelectSync) {
    window.__dfmThemeSelectSync = true;
    window.addEventListener('dfm-theme-changed', (e) => {
      const sel = document.getElementById('themeSelect');
      if (sel) sel.value = e.detail.theme;
    });
  }
}

function updateAccentColorPreview(e) {
  const color = e.target.value;
  document.getElementById('accentColorValue').textContent = color;
  
  // Preview the color change
  document.documentElement.style.setProperty('--accent-color', color);
}

function applyTheme() {
  const theme = document.getElementById('themeSelect').value;
  const accentColor = document.getElementById('accentColor').value;
  
  setTheme(theme);
  localStorage.setItem('accentColor', accentColor);
  document.documentElement.style.setProperty('--accent-color', accentColor);
  
  showToast('🎨 Appearance updated!', 'success');
}

// ============================================================================
// 💾 DATA MANAGEMENT FUNCTIONS
// ============================================================================

// Bug fixes:
// 1. This card only ever showed Total/Transactions/Properties/Budgets —
//    Loans, Accounts, Bills, and Subscriptions were counted into the total
//    but never broken out, so e.g. a newly added loan just moved a number
//    you couldn't otherwise see. Added the stores people actually care
//    about seeing a count of.
// 2. The whole loop was wrapped in one try/catch, so a single store
//    failing to read (e.g. one added by a not-yet-migrated version) blanked
//    the entire card with a generic error instead of showing every count
//    that DID succeed. Each store is now fetched independently.
function updateLastBackupLabel() {
  const el = document.getElementById('lastBackupInfo');
  if (!el) return;
  const last = getLastBackup(localStorage);
  el.textContent = `🕒 Last backup: ${describeLastBackup(last)}`;
  el.style.color = last ? 'var(--text-main)' : '#dc2626';
}

async function loadDataStatistics() {
  updateLastBackupLabel();
  const dataStats = document.getElementById('dataStats');
  if (!dataStats) return; // called from the header Restore button while Settings isn't open

  const displayedStores = [
    { key: STORE_NAMES.transactions, label: 'Transactions' },
    { key: STORE_NAMES.accounts, label: 'Accounts' },
    { key: STORE_NAMES.loans, label: 'Loans' },
    ...(hasFeature('property') ? [{ key: STORE_NAMES.properties, label: 'Properties' }] : []),
    { key: STORE_NAMES.budgets, label: 'Budgets' },
    { key: STORE_NAMES.bills, label: 'Bills' },
    { key: STORE_NAMES.subscriptions, label: 'Subscriptions' }
  ];

  let totalRecords = 0;
  let anySucceeded = false;
  const rows = [];

  for (const store of Object.values(STORE_NAMES)) {
    try {
      const items = await getAllItems(store);
      totalRecords += items.length;
      anySucceeded = true;
      const displayed = displayedStores.find(d => d.key === store);
      if (displayed) displayed.count = items.length;
    } catch (error) {
      console.warn(`Failed to read store "${store}" for data stats:`, error);
      const displayed = displayedStores.find(d => d.key === store);
      if (displayed) displayed.count = null; // null = "couldn't load", not 0
    }
  }

  if (!anySucceeded) {
    dataStats.innerHTML = `<div class="error-message">Failed to load data statistics</div>`;
    return;
  }

  dataStats.innerHTML = `
    <div class="stat-item">
      <span class="stat-label">Total Records:</span>
      <span class="stat-value">${totalRecords}</span>
    </div>
    ${displayedStores.map(d => `
      <div class="stat-item">
        <span class="stat-label">${d.label}:</span>
        <span class="stat-value">${d.count === null ? '—' : (d.count || 0)}</span>
      </div>
    `).join('')}
  `;
}

async function calculateStorageUsage() {
  // The Settings page can be left before the browser answers, so look the element
  // up each time and quietly stop if it is gone (used to throw "Cannot set properties of null").
  const show = (text) => {
    const el = document.getElementById('storageUsage');
    if (el) el.textContent = text;
  };
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = (estimate.usage / (1024 * 1024)).toFixed(2);
      const quota = (estimate.quota / (1024 * 1024)).toFixed(2);
      show(`${usage} MB / ${quota} MB`);
    } else {
      show('Not available');
    }
  } catch (error) {
    show('Error calculating');
  }
}

function promptForPassword({ title, confirmRequired }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(15, 23, 42, 0.6);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    `;
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:16px; padding:2rem; max-width:340px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
        <h3 style="margin-top:0;">${title}</h3>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="bkPass1" class="form-input" autocomplete="off">
        </div>
        ${confirmRequired ? `
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" id="bkPass2" class="form-input" autocomplete="off">
        </div>` : ''}
        <div id="bkPassError" style="color:#dc2626; font-size:0.85rem; min-height:1.2em; margin-bottom:0.5rem;"></div>
        <div class="form-actions">
          <button class="btn btn-primary" id="bkPassOk">OK</button>
          <button class="btn btn-secondary" id="bkPassCancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const pass1 = overlay.querySelector('#bkPass1');
    pass1.focus();

    overlay.querySelector('#bkPassCancel').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    function submit() {
      const p1 = overlay.querySelector('#bkPass1').value;
      const p2 = confirmRequired ? overlay.querySelector('#bkPass2').value : p1;
      if (!p1) {
        overlay.querySelector('#bkPassError').textContent = 'Password required.';
        return;
      }
      if (confirmRequired && p1 !== p2) {
        overlay.querySelector('#bkPassError').textContent = 'Passwords do not match.';
        return;
      }
      overlay.remove();
      resolve(p1);
    }

    overlay.querySelector('#bkPassOk').addEventListener('click', submit);
    overlay.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    });
  });
}

// Asks how to save the finished backup file (phones only): the share sheet is
// what offers "Save to Files" / iCloud Drive on iPhone. Resolves to
// 'share' | 'download' | null (cancelled).
function promptSaveChoice(filename) {
  return new Promise((resolve) => {
    document.getElementById('saveChoiceOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'saveChoiceOverlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <div class="modal-header"><h3>💾 Your backup is ready</h3></div>
        <div style="padding:1.25rem 1.5rem 1.5rem;">
          <p style="margin:0 0 1rem; line-height:1.5;">Save <strong>${escapeHtml(filename)}</strong> somewhere safe — ideally <em>Files → iCloud Drive</em> — not just on this phone.</p>
          <div style="display:flex; flex-direction:column; gap:0.5rem;">
            <button class="btn btn-primary" id="saveChoiceShare">📲 Save to Files / Share</button>
            <button class="btn btn-secondary" id="saveChoiceDownload">⬇️ Download instead</button>
            <button class="btn btn-secondary" id="saveChoiceCancel">Cancel</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#saveChoiceShare').addEventListener('click', () => done('share'));
    overlay.querySelector('#saveChoiceDownload').addEventListener('click', () => done('download'));
    overlay.querySelector('#saveChoiceCancel').addEventListener('click', () => done(null));
  });
}

function downloadBackupFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Returns true only if the file was actually handed off (downloaded or shared).
async function saveBackupFile(body, filename) {
  const file = new File([body], filename, { type: 'application/json' });
  const isPhone = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  if (isPhone && canShareFile(file)) {
    const choice = await promptSaveChoice(filename);
    if (choice === null) return false;
    if (choice === 'share') {
      const result = await shareBackupFile(file);
      if (result === 'shared') return true;
      if (result === 'cancelled') return false; // sheet dismissed = nothing saved
      // 'failed' (browser refused) -> fall through to a normal download
    }
  }
  downloadBackupFile(file);
  return true;
}

// Returns true if a backup was actually saved, false if cancelled or failed.
async function exportData() {
  try {
    const wantsEncryption = document.getElementById('encryptBackupCheckbox')?.checked && isEncryptionSupported();
    let password = null;
    if (wantsEncryption) {
      password = await promptForPassword({ title: '🔒 Set a Backup Password', confirmRequired: true });
      if (!password) return false; // user cancelled
    }

    showToast('📤 Preparing export...', 'info');
    
    const allData = {};
    for (const store of Object.values(STORE_NAMES)) {
      allData[store] = await getAllItems(store);
    }
    
    // The licence key travels with the backup so clearing the browser or
    // moving to a new device doesn't lose it.
    let licenceInfo = { on: false, key: null };
    try { licenceInfo = await (await import('./licenceGate.js')).backupLicenceInfo(); } catch { /* licensing unavailable */ }

    // Add metadata
    allData.metadata = {
      exportDate: new Date().toISOString(),
      version: APP_VERSION,
      recordCount: Object.values(allData).reduce((sum, items) => sum + items.length, 0)
    };

    if (licenceInfo.key) allData.licence = { key: licenceInfo.key };

    // If a password was set, encrypt the whole payload (metadata included)
    // into a self-describing envelope; otherwise export plain JSON as before.
    const fileBody = password
      ? JSON.stringify(await encryptJSON(allData, password), null, 2)
      : JSON.stringify(allData, null, 2);

    const saved = await saveBackupFile(fileBody, backupFilename(new Date(), !!password));
    if (!saved) {
      showToast('⚠️ Backup was not saved.', 'warning');
      return false;
    }

    recordBackup(localStorage);
    updateLastBackupLabel();
    document.getElementById('backupReminder')?.remove();
    showToast(password ? '✅ Encrypted backup exported!' : '✅ Data exported successfully!', 'success');
    if (licenceInfo.on && !licenceInfo.key) {
      showToast('This backup has no licence key (you are on the free trial). After you activate a key, back up again so it is saved too.', 'info');
    } else if (licenceInfo.key && !password) {
      showToast('This backup includes your licence key. Keep the file private, or tick the password option to encrypt it.', 'info');
    }
    return true;
  } catch (error) {
    console.error('Export failed:', error);
    showToast('❌ Export failed!', 'error');
    return false;
  }
}

function triggerImport() {
  document.getElementById('importFile').click();
}

// Writes every store array in a backup-format object (same shape the Export
// button produces) into IndexedDB: update-by-id, else add, with transactions
// also getting the content-based duplicate check. Shared by Import Data and
// Load Demo Data so both behave identically.
async function restoreBackupData(data) {
    let totalImported = 0;
    let totalSkippedDuplicates = 0;
    let errors = 0;

    // Bug fix: restore only ever matched backup items to existing records
    // by `id`. That's correct for restoring your own exact backup (ids
    // line up, so updateItem() cleanly overwrites), but it meant a
    // transaction added some other way — e.g. a CSV import done since the
    // backup was taken — got a freshly-generated id that never matches
    // anything in the backup file, even if it's the exact same real-world
    // purchase (same date/amount/description/account). Restore would then
    // just add it as a second, visually-identical row. Transactions now
    // get the same content-based duplicate check CSV import already uses
    // (see saver.js) before being written, in addition to the existing
    // id-based update-or-add for every other store.
    const existingTransactions = await getAllItems(STORE_NAMES.transactions).catch(() => []);

    for (const store of Object.values(STORE_NAMES)) {
      if (Array.isArray(data[store])) {
        console.group(`📂 Importing ${store}`);
        for (const item of data[store]) {
          try {
            if (store === STORE_NAMES.transactions) {
              const idMatch = existingTransactions.some(e => e.id === item.id);
              if (!idMatch && isDuplicateTransaction(item, existingTransactions)) {
                totalSkippedDuplicates++;
                continue;
              }
            }

            // Update by id, else add (with the seeded-default-category clash handled): see restoreItem.js
            await restoreOneItem({ updateItem, addItem, getAllItems, deleteItem, STORE_NAMES }, store, item);
            if (store === STORE_NAMES.transactions) {
              existingTransactions.push(item); // keep in-memory list current for further dedupe within this restore
            }
            totalImported++;
          } catch (err) {
            console.error(`Failed to import item in ${store}:`, err);
            errors++;
          }
        }
        console.groupEnd();
      }
    }

  return { totalImported, totalSkippedDuplicates, errors };
}

const STORE_LABELS = Object.fromEntries(
  Object.values(STORE_NAMES).map(n => [n, n.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase())])
);

// Shows what is in the backup and waits for the person to confirm. Resolves true/false.
function confirmRestorePreview(info) {
  return new Promise((resolve) => {
    document.getElementById('restorePreviewOverlay')?.remove();
    const rows = Object.entries(info.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([store, n]) => `<li>${escapeHtml(STORE_LABELS[store] || store)}: <strong>${n}</strong></li>`)
      .join('');
    const when = info.exportDate ? info.exportDate.toLocaleString() : 'unknown date';
    const overlay = document.createElement('div');
    overlay.id = 'restorePreviewOverlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <div class="modal-header"><h3>📥 Restore this backup?</h3></div>
        <div style="padding:1.25rem 1.5rem 1.5rem;">
          <p style="margin:0 0 0.75rem; line-height:1.5;">Backup made <strong>${escapeHtml(when)}</strong>${info.backupVersion ? ` (app version ${escapeHtml(info.backupVersion)})` : ''} — <strong>${info.total}</strong> records:</p>
          <ul style="margin:0 0 1rem; padding-left:1.25rem; max-height:180px; overflow:auto; line-height:1.6;">${rows}</ul>
          <p style="margin:0 0 1.25rem; font-size:0.85rem; line-height:1.5;">Nothing is deleted. Records with the same ID are replaced by the backup's version, and anything missing is added. Take a fresh backup first if your current data is newer.</p>
          <div class="modal-actions" style="display:flex; gap:0.5rem; justify-content:flex-end;">
            <button class="btn btn-secondary" id="restorePreviewCancel">Cancel</button>
            <button class="btn btn-primary" id="restorePreviewOk">Restore</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#restorePreviewOk').addEventListener('click', () => done(true));
    overlay.querySelector('#restorePreviewCancel').addEventListener('click', () => done(false));
  });
}

// Returns true if a restore was carried out.
async function importData(e) {
  const file = e.target.files[0];
  if (!file) return false;

  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('That file is not a readable backup (it is not valid JSON).');
    }

    if (data && data.encrypted === true) {
      // Up to 3 tries so one typo doesn't force starting over.
      let decrypted = null;
      for (let attempt = 1; attempt <= 3 && !decrypted; attempt++) {
        const password = await promptForPassword({
          title: attempt === 1 ? '🔒 Enter Backup Password' : `🔒 Wrong password — try again (${attempt}/3)`,
          confirmRequired: false
        });
        if (!password) { e.target.value = ''; return false; }
        try {
          decrypted = await decryptJSON(data, password);
        } catch (decryptErr) {
          if (attempt === 3) throw decryptErr;
        }
      }
      data = decrypted;
    }

    const info = inspectBackup(data, { knownStores: Object.values(STORE_NAMES), appVersion: APP_VERSION });
    if (!info.ok) throw new Error(info.error);

    if (!(await confirmRestorePreview(info))) {
      e.target.value = '';
      return false;
    }

    showToast('📥 Importing data...', 'info');
    const { totalImported, totalSkippedDuplicates, errors } = await restoreBackupData(data);

    // Reset file input
    e.target.value = '';

    // Bring the licence back too, if the backup carries one.
    if (data.licence && typeof data.licence.key === 'string') {
      try {
        const res = await (await import('./licenceGate.js')).restoreLicenceFromBackup(data.licence.key);
        if (res.applied) showToast('Licence restored from the backup.', 'success');
        else if (res.reason === 'device-limit') showToast('The licence in this backup is already active on the maximum number of devices. Deactivate it on another device first (Settings → Licence).', 'warning');
        else if (res.reason === 'revoked') showToast('The licence in this backup has been cancelled or refunded.', 'warning');
      } catch (licErr) { console.warn('[restore] Could not restore the licence', licErr); }
    }

    if (errors > 0) {
      showToast(`⚠️ Imported ${totalImported} records with ${errors} errors` + (totalSkippedDuplicates ? ` (${totalSkippedDuplicates} duplicates skipped)` : ''), 'warning');
    } else if (totalSkippedDuplicates > 0) {
      showToast(`✅ Imported ${totalImported} records (${totalSkippedDuplicates} duplicates skipped)`, 'success');
    } else {
      showToast(`✅ Successfully imported ${totalImported} records!`, 'success');
    }
    
    // Reload statistics
    await loadDataStatistics();
    return true;
    
  } catch (err) {
    console.error('Import failed:', err);
    if (e.target) e.target.value = '';
    showToast(`❌ Import failed: ${escapeHtml(err.message || 'Invalid file format')}`, 'error');
    return false;
  }
}

// Used by the header "Backup Data" / "Restore Data" buttons (backupReminder.js),
// which work from any page, not just Settings.
export { exportData, importData, loadDemoData };

// ============================================================================
// 🧪 DEMO / TEST DATA
// ----------------------------------------------------------------------------
// demo/dasher-demo-data.json is a normal backup-format file whose record IDs
// all start with "demo_". Loading it goes through the same restore path as
// Import Data; removing it deletes only records with that ID prefix.
// ============================================================================
const DEMO_ID_PREFIX = 'demo_';
const DEMO_SAMPLE_RATES = { USD: 0.65 }; // INR intentionally absent -> shows the missing-rate warning

// Demo records for a tier that isn't unlocked are left out, and links from
// other records to those (e.g. a bill's propertyId) are cleared, so the demo
// household matches what this version of the app actually shows.
function filterDemoForTier(data) {
  const out = { ...data };
  for (const [store, feature] of Object.entries(STORE_FEATURE)) {
    if (!hasFeature(feature)) delete out[store];
  }
  if (!hasFeature('property')) {
    const LINKS = ['propertyId', 'linkedPropertyId'];
    for (const [store, rows] of Object.entries(out)) {
      if (!Array.isArray(rows)) continue;
      out[store] = rows.map(r => {
        if (!r || typeof r !== 'object' || !LINKS.some(k => k in r)) return r;
        const c = { ...r };
        for (const k of LINKS) if (k in c) c[k] = '';
        if ('isPropertyExpense' in c) c.isPropertyExpense = false;
        return c;
      });
    }
  }
  return out;
}

async function loadDemoData({ skipConfirm = false } = {}) {
  // The setup guide has already explained the demo on its button, so it skips the confirm box.
  if (!skipConfirm && !confirm('Load the sample demo household into this app?\n\nIt is added alongside your existing data (all demo records start with "demo_" and can be removed later). Best tried on a fresh install.')) return false;
  try {
    showToast('🧪 Loading demo data...', 'info');
    const res = await fetch('./demo/dasher-demo-data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Demo file not found (HTTP ${res.status})`);
    const data = filterDemoForTier(await res.json());
    const { totalImported, errors } = await restoreBackupData(data);

    // Sample exchange rates: only fill gaps, never overwrite the person's own.
    for (const [code, rate] of Object.entries(DEMO_SAMPLE_RATES)) {
      if (!hasRate(code)) await setRate(code, rate);
    }

    await loadDataStatistics();
    showToast(errors
      ? `⚠️ Loaded ${totalImported} demo records with ${errors} errors`
      : `✅ Loaded ${totalImported} demo records`, errors ? 'warning' : 'success');
    return true;
  } catch (err) {
    console.error('Load demo data failed:', err);
    showToast('❌ Could not load demo data: ' + err.message, 'error');
    return false;
  }
}

async function removeDemoData() {
  if (!confirm('Remove all demo records (IDs starting with "demo_")?\n\nYour own data is not touched.')) return;
  try {
    let removed = 0;
    for (const store of Object.values(STORE_NAMES)) {
      const items = await getAllItems(store).catch(() => []);
      for (const item of items) {
        if (typeof item?.id === 'string' && item.id.startsWith(DEMO_ID_PREFIX)) {
          try { await deleteItem(store, item.id); removed++; } catch (e) { console.warn('Demo remove failed', store, item.id, e); }
        }
      }
    }
    await loadDataStatistics();
    showToast(removed ? `🧹 Removed ${removed} demo records` : 'No demo records found', removed ? 'success' : 'info');
  } catch (err) {
    console.error('Remove demo data failed:', err);
    showToast('❌ Could not remove demo data', 'error');
  }
}

// ============================================================================
// 🔎 DUPLICATE TRANSACTION FINDER
// ----------------------------------------------------------------------------
// Scans existing transactions for likely duplicates (same account, amount,
// description, date within +/- 2 days — the exact same rule CSV import and
// backup restore use to PREVENT new duplicates) and lets you review and
// delete ones that already exist, e.g. left over from before the backup
// restore dedup fix.
// ============================================================================

async function handleFindDuplicates() {
  const btn = document.getElementById('findDuplicatesBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '🔎 Scanning...';

  try {
    const transactions = await getAllItems(STORE_NAMES.transactions);
    const groups = findDuplicateGroups(transactions);

    if (groups.length === 0) {
      showToast('✅ No duplicate transactions found!', 'success');
      return;
    }

    const categories = await getAllItems(STORE_NAMES.categories).catch(() => []);
    const categoryNameById = new Map(categories.map(c => [c.id, c.name]));
    showDuplicateReviewModal(groups, categoryNameById);
  } catch (err) {
    console.error('Duplicate scan failed:', err);
    showToast('❌ Could not scan for duplicates', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function formatTxSummary(tx, categoryNameById) {
  const amt = Number(tx.amount) || 0;
  const amtStr = (amt >= 0 ? '+' : '') + amt.toFixed(2);
  const catName = categoryNameById.get(tx.categoryId) || 'Uncategorised';
  return `${tx.date} · ${amtStr} · ${catName}`;
}

function showDuplicateReviewModal(groups, categoryNameById) {
  const totalDuplicateRows = getDefaultDeletionIds(groups).length;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(15, 23, 42, 0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  `;

  const groupsHtml = groups.map((group, gi) => {
    const rowsHtml = group.map((tx, ti) => `
      <label style="display:flex; align-items:flex-start; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
        <input type="radio" name="dupKeep_${gi}" value="${ti}" ${ti === 0 ? 'checked' : ''} style="margin-top:0.2rem;">
        <span>
          <strong>${(tx.description || '(no description)').slice(0, 60)}</strong><br>
          <span style="color:#64748b;">${formatTxSummary(tx, categoryNameById)}${ti === 0 ? ' — <em>oldest copy, kept by default</em>' : ''}</span>
        </span>
      </label>
    `).join('');

    return `
      <div class="settings-card" style="margin-bottom:1rem;">
        <div class="settings-card-body" style="padding:0.85rem 1rem;">
          <div style="font-weight:600; margin-bottom:0.35rem; font-size:0.85rem;">
            Group ${gi + 1} of ${groups.length} — ${group.length} copies found
          </div>
          <div data-group="${gi}">${rowsHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:16px; padding:1.75rem; max-width:560px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
      <h3 style="margin-top:0;">🔎 ${groups.length} likely duplicate ${groups.length === 1 ? 'group' : 'groups'} found</h3>
      <p style="color:#64748b; font-size:0.85rem; margin-top:-0.5rem;">
        Grouped by same account, amount, description and a nearby date.
        The oldest copy in each group is kept by default — pick a different
        one to keep if you'd rather.
      </p>
      <div style="overflow-y:auto; flex:1; margin:0.5rem 0 1rem;">
        ${groupsHtml}
      </div>
      <div class="form-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button class="btn btn-danger" id="dupDeleteSelected">
          🗑️ Delete ${totalDuplicateRows} Duplicate${totalDuplicateRows === 1 ? '' : 's'} (Keep Selected)
        </button>
        <button class="btn btn-secondary" id="dupCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#dupCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#dupDeleteSelected').addEventListener('click', async () => {
    const idsToDelete = [];
    groups.forEach((group, gi) => {
      const checked = overlay.querySelector(`input[name="dupKeep_${gi}"]:checked`);
      const keepIndex = checked ? Number(checked.value) : 0;
      group.forEach((tx, ti) => {
        if (ti !== keepIndex) idsToDelete.push(tx.id);
      });
    });

    const deleteBtn = overlay.querySelector('#dupDeleteSelected');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    let deleted = 0;
    let failed = 0;
    for (const id of idsToDelete) {
      try {
        await deleteItem(STORE_NAMES.transactions, id);
        deleted++;
      } catch (err) {
        console.error('Failed to delete duplicate transaction', id, err);
        failed++;
      }
    }

    overlay.remove();
    if (failed > 0) {
      showToast(`⚠️ Deleted ${deleted} duplicates, ${failed} failed`, 'warning');
    } else {
      showToast(`✅ Deleted ${deleted} duplicate transaction${deleted === 1 ? '' : 's'}`, 'success');
    }
    await loadDataStatistics();
  });
}

// ============================================================================
// 🗑️ RESET FUNCTIONS (FIXED NAMING CONFLICT)
// ============================================================================

// Bug fix: the old confirm() dialog promised this only clears "temporary
// files" and explicitly said data stays intact — true — but it never
// mentioned that caches.delete() also wipes the entire offline app-shell
// cache the Service Worker relies on, and it never rebuilt that cache
// afterwards. Clicking this used to silently leave the app with NO offline
// fallback until it happened to be reopened online again. The dialog now
// says so plainly, blocks the action if we're offline (clearing it then
// would strand the app with nothing to fall back on), and re-triggers the
// Service Worker's precache immediately after clearing so offline support
// comes back right away instead of eventually.
async function clearCache() {
  if (!navigator.onLine) {
    alert('⚠️ You\'re offline right now.\n\nClearing the cache while offline would remove the files the app needs to keep working without a connection, with no way to get them back until you\'re online again. Please try this once you\'re back online.');
    return;
  }

  if (!confirm('🗑️ Clear application cache?\n\nThis will:' +
               '\n• Clear temporary files and UI preferences' +
               '\n• Delete the offline app cache (it will be rebuilt right away since you\'re online now)' +
               '\n• Keep your actual data (transactions, loans, etc.) intact')) {
    return;
  }

  try {
    // Clear localStorage except for data
    const keysToKeep = ['currency', 'currencyRates', 'currencyRatesUpdated', 'theme', 'themePreference', 'dateFormat', 'accentColor'];
    const allKeys = Object.keys(localStorage);
    
    for (const key of allKeys) {
      if (!keysToKeep.includes(key)) {
        localStorage.removeItem(key);
      }
    }
    
    // Clear sessionStorage
    sessionStorage.clear();
    
    // Clear any caches if using Cache API
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }

    // Rebuild the offline cache immediately rather than leaving the app
    // with none until its next lucky online visit. unregister() + a fresh
    // register() forces the install event (and its full PRECACHE_URLS
    // pass) to run again right now, while we know we're online.
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.unregister();
      }
      await navigator.serviceWorker.register('serviceWorker.js', { scope: './' });
    }
    
    showToast('✅ Cache cleared and offline files rebuilt!', 'success');
    
  } catch (error) {
    console.error('Cache clearing failed:', error);
    showToast('❌ Failed to clear cache', 'error');
  }
}

// Shows a modal requiring the person to type an exact phrase before
// resolving true. Used in front of irreversible actions where a reflexive
// tap on an OK button (the previous confirm()-only flow) is too easy to
// do by accident on a permanent, all-data wipe.
function promptTypedConfirmation({ title, message, phrase }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(15, 23, 42, 0.6);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    `;
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:16px; padding:2rem; max-width:400px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);">
        <h3 style="margin-top:0; color:#dc2626;">${title}</h3>
        <p style="white-space:pre-line; font-size:0.9rem; color:var(--text-main);">${message}</p>
        <div class="form-group">
          <label class="form-label">Type <strong>${phrase}</strong> to confirm</label>
          <input type="text" id="typedConfirmInput" class="form-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="form-actions">
          <button class="btn btn-danger" id="typedConfirmOk" disabled>Delete Everything</button>
          <button class="btn btn-secondary" id="typedConfirmCancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#typedConfirmInput');
    const okBtn = overlay.querySelector('#typedConfirmOk');
    input.focus();

    input.addEventListener('input', () => {
      okBtn.disabled = input.value !== phrase;
    });

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    okBtn.addEventListener('click', () => {
      if (input.value === phrase) close(true);
    });
    overlay.querySelector('#typedConfirmCancel').addEventListener('click', () => close(false));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value === phrase) close(true);
    });
  });
}

// Bug fix: this used to gate a permanent, irreversible wipe of every
// transaction/property/budget/loan behind nothing but browser confirm()
// popups — a reflexive "OK" tap (easy to do on mobile) was all it took.
// It now requires typing "DELETE" in a real confirmation modal, matching
// the weight of the action, before anything is touched.
async function handleClearAllData() {
  // First, offer to backup data
  const backupChoice = confirm(
    '💾 BACKUP YOUR DATA FIRST?\n\n' +
    'Would you like to create a backup before clearing all data?\n\n' +
    'Click OK to create a backup, or Cancel to proceed without backup.'
  );

  if (backupChoice) {
    // User wants to backup first
    const saved = await exportData();
    if (!saved && !confirm('The backup was NOT saved. Continue to clear data without a backup?')) return;
  }

  const confirmed = await promptTypedConfirmation({
    title: '💥 Clear All Data',
    message: '⚠️ THIS ACTION CANNOT BE UNDONE!\n\nThis will permanently delete ALL transactions, properties, loans, budgets, settings, and preferences, and reset the application.' +
      (backupChoice ? '' : '\n\nYou chose NOT to create a backup — this data will be unrecoverable.'),
    phrase: 'DELETE'
  });

  if (!confirmed) {
    showToast('Data clearing cancelled', 'info');
    return;
  }

  try {
    showToast('🗑️ Clearing all data...', 'info');
    
    // Use the imported function with alias to avoid naming conflict
    await dbClearAllData();
    localStorage.clear();
    sessionStorage.clear();
    
    showToast('✅ All data cleared! Reloading application...', 'success');
    
    // Reload after a short delay
    setTimeout(() => {
      location.reload();
    }, 3000);
    
  } catch (error) {
    console.error('Data clearing failed:', error);
    showToast('❌ Failed to clear data', 'error');
  }
}

// ============================================================================
// 🔍 ABOUT FUNCTIONS
// ============================================================================

// Small centered modal for the result of a "Check for Updates" click — a
// bottom toast was easy to miss/dismiss without reading, and didn't give a
// clear action to take when an update actually was found. actionLabel/
// onAction are only passed for the "update available" case; every other
// outcome (up to date, offline, unsupported, error) just gets a plain OK.
function showInfoModal({ icon = 'ℹ️', title, message, actionLabel, onAction }) {
  document.getElementById('infoModalOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'infoModalOverlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <div class="modal-header">
        <h3>${icon} ${escapeHtml(title)}</h3>
      </div>
      <div style="padding:1.25rem 1.5rem 1.5rem;">
        <p style="margin:0 0 1.25rem; line-height:1.5;">${escapeHtml(message)}</p>
        <div class="modal-actions" style="display:flex; gap:0.5rem; justify-content:flex-end;">
          ${actionLabel ? '<button class="btn btn-secondary" id="infoModalCancel">Not Now</button>' : ''}
          <button class="btn btn-primary" id="infoModalOk">${escapeHtml(actionLabel || 'OK')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#infoModalOk').addEventListener('click', () => {
    close();
    if (onAction) onAction();
  });
  overlay.querySelector('#infoModalCancel')?.addEventListener('click', close);
  // Click on the dimmed backdrop itself (not the box) dismisses, same as
  // every other modal-overlay in the app.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// Bug fix: this used to be a fake setTimeout that always claimed "you are
// running the latest version" regardless of reality. It now actually asks
// the Service Worker to check the network for a new version
// (registration.update()) and reports the real outcome — including telling
// the person plainly when the check itself couldn't run (offline, or SW
// unsupported) instead of pretending everything's current.
//
// Bug fix #2: the result used to be a bottom toast, which auto-dismissed
// after 5s and was very easy to miss entirely, so clicking the button could
// genuinely look like "does not do anything". It's now a centered modal
// the person has to explicitly dismiss (OK), or, when an update actually
// is available, a clear "Update" button that installs it and reloads.
async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) {
    showInfoModal({ icon: '⚠️', title: 'Updates Not Supported', message: 'Updates aren\'t supported in this browser.' });
    return;
  }

  showToast('🔍 Checking for updates...', 'info');

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      showInfoModal({ icon: '⚠️', title: 'Not Registered', message: 'No service worker is registered, so updates can\'t be checked from here.' });
      return;
    }

    // update() re-fetches serviceWorker.js from the network (bypassing the
    // HTTP cache) and, if its bytes differ from the currently installed
    // worker, starts installing it as reg.installing. If we're offline,
    // this fetch fails and rejects — that's a real "couldn't check", not
    // "you're up to date".
    await registration.update();

    // A newer worker may have installed, activated and taken over while we
    // awaited update() (this app's worker skips the waiting phase). In that case
    // there is no installing/waiting worker left to find — but this page is
    // still running the old JS, so it must NOT be reported as up to date.
    const pendingWorker = registration.waiting || registration.installing;
    if (registration.waiting || isPageStale()) {
      showInfoModal({
        icon: '🚀',
        title: 'Update Available',
        message: 'A new version of Dashers Finance Manager is ready. Tap Update to reload and apply it.',
        actionLabel: 'Update',
        onAction: () => applyUpdateAndReload(registration.waiting)
      });
    } else if (registration.installing) {
      // Still downloading — wait for it to finish (it activates on its own),
      // then offer the reload with the same Update button.
      showInfoModal({
        icon: '⬇️',
        title: 'Downloading Update',
        message: 'A new version is downloading. Tap OK, then check again in a few seconds to apply it.'
      });
    } else {
      showInfoModal({
        icon: '✅',
        title: "You're Up To Date",
        message: `You are running the latest version (v${APP_VERSION}).`
      });
    }
  } catch (error) {
    console.error('Update check failed:', error);
    showInfoModal({ icon: '❌', title: 'Check Failed', message: 'Couldn\'t check for updates — are you online?' });
  }
}

// ============================================================================
// 🎪 TOAST NOTIFICATION SYSTEM
// ============================================================================

function showToast(message, type = 'info') {
  // Remove existing toasts
  const existingToasts = document.querySelectorAll('.toast');
  existingToasts.forEach(toast => toast.remove());
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-message">${message}</span>
      <button class="toast-close">&times;</button>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Add show class after a frame
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 5000);
  
  // Close on button click
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  });
}

function wireCurrencyEditor() {
  const msg = document.getElementById('currencyEditorMsg');
  const say = t => { if (msg) msg.textContent = t; };
  const refresh = () => {
    const sel = document.getElementById('currencySelect');
    const cur = sel.value;
    sel.innerHTML = getCurrencies().map(c => `<option value="${c.code}" ${c.code === cur ? 'selected' : ''}>${c.symbol} ${c.name} (${c.code})</option>`).join('');
    renderRatesTable(sel.value !== getBaseCurrency() ? sel.value : undefined);
  };
  const addBtn = document.getElementById('btnAddCurrency');
  if (addBtn) addBtn.onclick = async () => {
    try { await addCurrency(document.getElementById('newCurrencyCode').value); refresh(); say('Added.'); }
    catch (e) { say(e.message); }
  };
  document.querySelectorAll('.rate-remove').forEach(b => b.onclick = async () => {
    try {
      const accounts = await getAllItems(STORE_NAMES.accounts);
      await removeCurrency(b.dataset.code, accounts);
      refresh(); say(`${b.dataset.code} removed.`);
    } catch (e) { say(e.message); }
  });
}


// ============================================================================
// 🧹 DELETE TRANSACTIONS ONLY (clean slate before a re-import)
// ============================================================================
// Removes transactions (all, or one account's) and nothing else: accounts,
// bills, loans, properties, budgets, categories and settings are untouched.
// A backup download runs first, and the person must type DELETE.
async function handleDeleteTransactions() {
  try {
    const [accounts, transactions] = await Promise.all([
      getAllItems(STORE_NAMES.accounts),
      getAllItems(STORE_NAMES.transactions)
    ]);
    if (!transactions.length) { alert('There are no transactions to delete.'); return; }

    const counts = new Map();
    transactions.forEach(t => counts.set(t.accountId, (counts.get(t.accountId) || 0) + 1));
    const withTx = accounts.filter(a => counts.get(a.id));
    const orphanCount = transactions.filter(t => !accounts.some(a => a.id === t.accountId)).length;

    document.getElementById('deleteTxOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'deleteTxOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--card-bg,#fff);color:var(--text,#222);max-width:460px;width:100%;border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3)">
        <h3 style="margin:0 0 8px">🧹 Delete transactions</h3>
        <label for="delTxAccount" style="display:block;font-weight:600;margin:12px 0 4px">Which account?</label>
        <select id="delTxAccount" class="form-select" style="width:100%">
          <option value="__all__">All accounts (${transactions.length} transactions)</option>
          ${withTx.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.currency || 'AUD')}) · ${counts.get(a.id)} transactions</option>`).join('')}
          ${orphanCount ? `<option value="__orphans__">No longer linked to an account · ${orphanCount}</option>` : ''}
        </select>
        <p id="delTxSummary" style="margin:12px 0;font-size:.9rem"></p>
        <p style="margin:0 0 12px;font-size:.85rem;opacity:.8">
          Kept: accounts, bills, loans, properties, budgets, categories, subscriptions, settings.
          Balances fall back to opening balances until you re-import.
          If Family Sync is connected, the deletions sync to your other devices.
          A backup downloads first.
        </p>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:0 0 12px;font-size:.9rem">
          <input type="checkbox" id="delTxAlsoProps" checked style="margin-top:3px">
          <span>Also remove property expense &amp; tax records that were created from these transactions.
          Records you entered directly on the property pages are kept.</span>
        </label>
        <label for="delTxConfirm" style="display:block;font-weight:600;margin-bottom:4px">Type DELETE to confirm</label>
        <input id="delTxConfirm" class="form-input" autocomplete="off" style="width:100%" placeholder="DELETE">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button type="button" class="btn btn-secondary" id="delTxCancel">Cancel</button>
          <button type="button" class="btn btn-danger" id="delTxGo" disabled>Back up &amp; delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const sel = overlay.querySelector('#delTxAccount');
    const confirmInput = overlay.querySelector('#delTxConfirm');
    const goBtn = overlay.querySelector('#delTxGo');
    const summary = overlay.querySelector('#delTxSummary');
    const close = () => overlay.remove();

    const selectedCount = () =>
      sel.value === '__all__' ? transactions.length
        : sel.value === '__orphans__' ? orphanCount
        : (counts.get(sel.value) || 0);
    const refresh = () => {
      const name = sel.options[sel.selectedIndex].text.split(' · ')[0].replace(/ \(\d+ transactions\)$/, '');
      summary.innerHTML = `This will permanently delete <strong>${selectedCount()}</strong> transactions${sel.value === '__all__' ? ' from every account' : ` from <strong>${name}</strong>`}.`;
      goBtn.disabled = confirmInput.value.trim() !== 'DELETE';
    };
    sel.addEventListener('change', refresh);
    confirmInput.addEventListener('input', refresh);
    overlay.querySelector('#delTxCancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    refresh();

    goBtn.addEventListener('click', async () => {
      const chosen = sel.value;
      const count = selectedCount();
      goBtn.disabled = true;
      goBtn.textContent = 'Backing up…';
      try {
        const backedUp = await exportData(); // backup before anything is removed
        if (!backedUp) { showToast('⚠️ No backup was saved, so nothing was deleted.', 'warning'); goBtn.disabled = false; goBtn.textContent = 'Back up & delete'; return; }
        if (!confirm(`Backup saved? Press OK to delete ${count} transactions now, or Cancel to stop.`)) { close(); return; }
        goBtn.textContent = 'Deleting…';
        const removed = chosen === '__orphans__'
          ? await deleteTransactionsBulk(null, { orphansOnly: true, validAccountIds: accounts.map(a => a.id) })
          : await deleteTransactionsBulk(chosen === '__all__' ? null : chosen);
        let extra = '';
        if (overlay.querySelector('#delTxAlsoProps')?.checked) {
          const cleaned = await removeOrphanedPropertyRecords();
          extra = ` Also removed ${cleaned.expenses} property expense and ${cleaned.taxRecords} tax records that came from them.`;
        }
        close();
        alert(`Deleted ${removed} transactions.${extra} You can now import your CSV/PDF.`);
        loadDataStatistics();
      } catch (err) {
        console.error('Delete transactions failed:', err);
        alert('Could not delete transactions: ' + err.message);
        close();
      }
    });
    confirmInput.focus();
  } catch (error) {
    console.error('Delete transactions failed:', error);
    alert('Could not delete transactions: ' + error.message);
  }
}


// Removes expense / tax records left behind by deleted transactions. Records
// entered directly (no transactionId) are never touched.
async function removeOrphanedPropertyRecords() {
  const found = await findOrphanedTransactionRecords();
  const e = await deleteRecordsBulk(STORE_NAMES.expenses, found.expenses.map(x => x.id));
  const t = await deleteRecordsBulk(STORE_NAMES.taxRecords, found.taxRecords.map(x => x.id));
  return { expenses: e, taxRecords: t, directExpensesKept: found.directExpensesKept };
}

async function handleCleanOrphans() {
  try {
    const found = await findOrphanedTransactionRecords();
    const n = found.expenses.length + found.taxRecords.length;
    if (!n) {
      alert('Nothing to clean up. No property expense or tax records are pointing at missing transactions.' +
            `\n\n(${found.directExpensesKept} directly-entered property expenses are untouched.)`);
      return;
    }
    const total = found.expenses.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
    if (!confirm(
      `Found records left behind by deleted transactions:\n\n` +
      `• ${found.expenses.length} property expenses (total ${formatMoney(total, 'AUD')})\n` +
      `• ${found.taxRecords.length} tax records\n\n` +
      `Kept: ${found.directExpensesKept} property expenses you entered directly, and everything else.\n\n` +
      `A backup downloads first. Continue?`)) return;
    if (!(await exportData())) { showToast('⚠️ No backup was saved, so nothing was deleted.', 'warning'); return; }
    if (!confirm('Backup saved? Press OK to delete these records now.')) return;
    const done = await removeOrphanedPropertyRecords();
    alert(`Removed ${done.expenses} property expenses and ${done.taxRecords} tax records. Direct entries were left alone.`);
    loadDataStatistics();
  } catch (error) {
    console.error('Clean up failed:', error);
    alert('Could not clean up: ' + error.message);
  }
}
