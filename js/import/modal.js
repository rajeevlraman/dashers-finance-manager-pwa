// modal.js - Clean, working version

import { parseCSVFile, parseStatementText } from './parser.js';
import { baseEquivalent, formatMoney, getBaseCurrency, hasRate, toBase } from '../utils/currency.js';
import { saveImportedTransactions } from './saver.js';
import { BANK_FORMATS } from './bankFormats.js';
import { buildCategoryIndex, autoAssignCategory } from './categoryRules.js';
import { suggestCategoryForTransaction, resolveTransactionSemantics } from './categoryMapper.js';
import { getMerchantLogo } from './merchantLogos.js';

let modalInitialized = false;

// ============================================================================
// Helper Functions
// ============================================================================

function hideImportModal() {
  const modal = document.getElementById("importModal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "auto";
  }
}

async function handleParseData() {
  
  const parseBtn = document.getElementById("parseData");
  const saveBtn = document.getElementById("saveImport");
  
  if (!parseBtn || !saveBtn) {
    console.error("[MODAL] Parse or Save button not found");
    return;
  }
  
  parseBtn.disabled = true;
  parseBtn.textContent = "Parsing...";
  
  try {
    let transactions = [];
    const accountId = document.getElementById("importAccount").value;
    
    if (!accountId) {
      alert("⚠️ Please select an account first!");
      parseBtn.disabled = false;
      parseBtn.textContent = "Parse Data";
      return;
    }
    
    // Check which tab is active
    const isCSVTab = document.getElementById("csvTab").classList.contains("active");
    
    if (isCSVTab) {
      // Parse CSV
      const fileInput = document.getElementById("csvFile");
      const format = document.getElementById("csvFormat").value;
      
      if (!fileInput.files.length) {
        alert("⚠️ Please select a CSV or PDF file first!");
        parseBtn.disabled = false;
        parseBtn.textContent = "Parse Data";
        return;
      }
      
      if (!format) {
        alert("⚠️ Please select a bank format!");
        parseBtn.disabled = false;
        parseBtn.textContent = "Parse Data";
        return;
      }
      
      transactions = await parseCSVFile(fileInput.files[0], format);
      
    } else {
      // Parse text
      const text = document.getElementById("statementText").value;
      const format = document.getElementById("textFormat").value;
      
      if (!text.trim()) {
        alert("⚠️ Please enter statement text!");
        parseBtn.disabled = false;
        parseBtn.textContent = "Parse Data";
        return;
      }
      
      if (!format) {
        alert("⚠️ Please select a bank format!");
        parseBtn.disabled = false;
        parseBtn.textContent = "Parse Data";
        return;
      }
      
      transactions = await parseStatementText(text, format);
    }
    
    if (!transactions || transactions.length === 0) {
      alert("❌ No transactions found in the data!");
      parseBtn.disabled = false;
      parseBtn.textContent = "Parse Data";
      return;
    }
    
    // A statement in one currency imported into an account of another would record ₹398 as $398 (or
    // as whatever the account's currency is) — and every balance and total after that is quietly wrong.
    const importMeta = transactions.importMeta || null;
    const targetAccount = (window._importData?.accounts || []).find(a => a.id === accountId);
    const accountCurrency = targetAccount?.currency || getBaseCurrency();
    if (importMeta?.statementCurrency && importMeta.statementCurrency !== accountCurrency) {
      const go = confirm(
        `This statement looks like it's in ${importMeta.statementCurrency}, but "${targetAccount?.name || 'the selected account'}" is a ${accountCurrency} account.\n\n` +
        `Importing would record ${importMeta.statementCurrency} amounts as ${accountCurrency} (e.g. 398 rupees would become ${formatMoney(398, accountCurrency)}).\n\n` +
        `Press Cancel, then pick or create a ${importMeta.statementCurrency} account (Accounts → Add Account → Currency).\n` +
        `Press OK only if this really is a ${accountCurrency} statement.`);
      if (!go) { parseBtn.disabled = false; parseBtn.textContent = "Parse Data"; return; }
    }

    // Add accountId to all transactions
    transactions = transactions.map(tx => ({
      ...tx,
      accountId: accountId
    }));
    transactions.importMeta = importMeta;
    
    // Store for saving
    window._importData.pendingTransactions = transactions;
    
    // Show preview
    showImportPreview(transactions);
    
    
  } catch (error) {
    console.error("[MODAL] Parse error:", error);
    alert("❌ Error parsing data: " + error.message);
  } finally {
    parseBtn.disabled = false;
    parseBtn.textContent = "Parse Data";
  }
}

// Runs the same Category → Subcategory → Vendor resolution saver.js uses at
// save time, but read-only (dryRun: true, nothing written/learned), purely
// so the preview table can show the person what they're about to get.
function computePreviewCategorization(tx, categories, categoryIndex, accounts = []) {
  const bankId = (tx.source || '').split(' ')[0].toLowerCase();
  let categoryId = null;
  let source = null;

  const { categoryId: vendorCategoryId, source: vendorSource } = suggestCategoryForTransaction(
    tx,
    tx.bankCategory || null,
    { dryRun: true, bankId }
  );

  if (vendorCategoryId && vendorSource !== 'fallback') {
    categoryId = vendorCategoryId;
    source = vendorSource;
  } else if (categories.length && categoryIndex.length) {
    const autoCatId = autoAssignCategory(tx, categories, categoryIndex);
    if (autoCatId) {
      categoryId = autoCatId;
      source = 'category_name_match';
    }
  }

  const category = categories.find(c => c.id === categoryId) || null;
  const parent = category?.parentId ? categories.find(c => c.id === category.parentId) : null;

  const vendor = tx.merchant || tx.cleanDescription || tx.description || '';
  const logoPath = getMerchantLogo(tx.description || tx.rawDescription || vendor || '');

  // Same correction saver.js applies at save time (see
  // resolveTransactionSemantics in categoryMapper.js) - computed here too
  // so the preview's stats and labels match what Save actually produces,
  // instead of showing every transfer/BPAY/loan-drawn-expense row as
  // raw-sign "income". accountType lets a BPAY payment onto the user's
  // own credit card preview correctly as a transfer, not an expense.
  const txAccount = accounts.find(a => a.id === tx.accountId);
  const semantics = resolveTransactionSemantics(categoryId, tx.type, categories, {
    amount: tx.amount,
    accountType: txAccount?.type
  });

  return {
    categoryId,
    categoryLabel: category
      ? (parent ? `${parent.name} › ${category.name}` : category.name)
      : null,
    vendor,
    logoPath,
    matched: !!categoryId,
    previewType: semantics.type,
    isTransfer: semantics.isTransfer
  };
}

function renderPreviewCategoryCell(info) {
  const vendorHtml = info.logoPath
    ? `<img src="${info.logoPath}" alt="" style="width:16px;height:16px;vertical-align:-3px;border-radius:3px;margin-right:5px;" onerror="this.style.display='none'">${escapeForPreview(info.vendor)}`
    : escapeForPreview(info.vendor);

  const categoryHtml = info.matched
    ? `<span style="color:#0369a1;font-weight:600;">${escapeForPreview(info.categoryLabel)}</span>`
    : `<span style="color:#b45309;">❓ Uncategorised</span>`;

  return `
    <td style="padding: 10px 12px; border: 1px solid #e5e7eb; vertical-align: top;">${categoryHtml}</td>
    <td style="padding: 10px 12px; border: 1px solid #e5e7eb; vertical-align: top;">${vendorHtml}</td>
  `;
}

function escapeForPreview(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showImportPreview(transactions) {
  
  const previewDiv = document.getElementById("importPreview");
  const headersDiv = document.getElementById("previewHeaders");
  const rowsDiv = document.getElementById("previewRows");
  const statsDiv = document.getElementById("previewStats");
  
  if (!previewDiv || !headersDiv || !rowsDiv || !statsDiv) {
    console.error("[MODAL] Preview elements not found");
    return;
  }
  
  if (transactions.length === 0) {
    alert("No transactions found in the data!");
    return;
  }
  
  // Show preview section
  previewDiv.style.display = "block";

  // What the PDF reader could and couldn't read: unreadable (scanned) pages, balance mismatches, a
  // missing opening balance. Previously these only went to the console, so a partial import looked complete.
  let notices = document.getElementById("importNotices");
  if (!notices) {
    notices = document.createElement("div");
    notices.id = "importNotices";
    previewDiv.insertBefore(notices, document.getElementById("previewTable"));
  }
  const meta = transactions.importMeta || {};
  const box = (bg, border, fg, html) => `<div style="padding:10px 12px;margin-bottom:10px;background:${bg};border:1px solid ${border};border-radius:6px;color:${fg};">${html}</div>`;
  const noticeHtml = (meta.warnings || []).map(w => box('#fef3c7', '#f59e0b', '#92400e', `⚠️ ${w}`));
  if (meta.openingBalance != null && meta.closingBalance != null && meta.checked > 0 && !meta.mismatched && !(meta.warnings || []).length) {
    noticeHtml.push(box('#ecfdf5', '#6ee7b7', '#065f46', `✅ Reconciled: every row's running balance matches (${meta.checked} checked).`));
  }
  notices.innerHTML = noticeHtml.join('');
  
  // Create table headers from first transaction keys
  const firstTx = transactions[0];
  const headers = Object.keys(firstTx);

  const categories = window._importData?.categories || [];
  const accounts = window._importData?.accounts || [];
  // Amounts are in the target account's currency (not necessarily dollars), with the base-currency
  // equivalent underneath when they differ — e.g. "-₹398.00  ≈ AUD 7.16".
  const importAccountId = document.getElementById("importAccount")?.value;
  const acctCur = accounts.find(a => a.id === importAccountId)?.currency || getBaseCurrency();
  const baseCur = getBaseCurrency();
  const eqHtml = n => (acctCur !== baseCur && hasRate(acctCur))
    ? `<div style="font-size:0.75rem;color:#6b7280;">${baseEquivalent(Math.abs(n), acctCur)}</div>` : '';
  const categoryIndex = buildCategoryIndex(categories);
  
  headersDiv.innerHTML = `
    <tr>
      ${headers.map(h => `<th style="padding: 12px; border: 1px solid #bae6fd; text-align: left; font-weight: 600;">${formatHeader(h)}</th>`).join('')}
      <th style="padding: 12px; border: 1px solid #bae6fd; text-align: left; font-weight: 600;">Category › Subcategory</th>
      <th style="padding: 12px; border: 1px solid #bae6fd; text-align: left; font-weight: 600;">Vendor</th>
    </tr>
  `;
  
  // Run categorization once per transaction and reuse it for the row
  // rendering below and for every stat, instead of recomputing it
  // separately per stat (as before) or falling back to raw amount sign
  // (which mislabels every transfer/BPAY row - see resolveTransactionSemantics
  // in categoryMapper.js).
  const fullCategorization = transactions.map(tx =>
    computePreviewCategorization(tx, categories, categoryIndex, accounts)
  );

  // Show first 5 transactions
  const previewRows = transactions.slice(0, 5);
  let matchedCount = 0;
  rowsDiv.innerHTML = previewRows.map((tx, idx) => {
    const catInfo = fullCategorization[idx];
    if (catInfo.matched) matchedCount++;
    return `
      <tr>
        ${headers.map(h => {
          let value = tx[h] || '';
          if (h === 'amount' || h === 'Amount') {
            const num = parseFloat(value);
            value = num.toFixed(2);
            if (num < 0) {
              value = `<span style="color: #dc2626;">-${formatMoney(Math.abs(num), acctCur)}</span>${eqHtml(num)}`;
            } else if (num > 0) {
              value = `<span style="color: #059669;">+${formatMoney(num, acctCur)}</span>${eqHtml(num)}`;
            }
          }
          return `<td style="padding: 10px 12px; border: 1px solid #e5e7eb; vertical-align: top;">${value}</td>`;
        }).join('')}
        ${renderPreviewCategoryCell(catInfo)}
      </tr>
    `;
  }).join('');

  const fullMatchCount = fullCategorization.filter(info => info.matched).length;

  // Calculate stats
  const totalCount = transactions.length;
  const transferCount = fullCategorization.filter(info => info.isTransfer).length;
  const incomeCount = fullCategorization.filter(info => info.previewType === 'income' && !info.isTransfer).length;
  const expenseCount = fullCategorization.filter(info => info.previewType === 'expense' && !info.isTransfer).length;
  // Net total still reflects every dollar moving through the account
  // (transfers included) - it's a cash-flow check against your bank
  // statement, not an income/expense figure.
  const totalAmount = transactions.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
  
  statsDiv.innerHTML = `
    <div style="padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #bae6fd;">
      <div style="font-size: 0.875rem; color: #6b7280;">Total Transactions</div>
      <div style="font-size: 1.25rem; font-weight: 700; color: #0369a1;">${totalCount}</div>
    </div>
    <div style="padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #bae6fd;">
      <div style="font-size: 0.875rem; color: #6b7280;">Income</div>
      <div style="font-size: 1.25rem; font-weight: 700; color: #059669;">${incomeCount}</div>
    </div>
    <div style="padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #bae6fd;">
      <div style="font-size: 0.875rem; color: #6b7280;">Expenses</div>
      <div style="font-size: 1.25rem; font-weight: 700; color: #dc2626;">${expenseCount}</div>
    </div>
    <div style="padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #bae6fd;">
      <div style="font-size: 0.875rem; color: #6b7280;">Transfers</div>
      <div style="font-size: 1.25rem; font-weight: 700; color: #6b7280;">${transferCount}</div>
    </div>
    <div style="padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #bae6fd;">
      <div style="font-size: 0.875rem; color: #6b7280;">Net Total</div>
      <div style="font-size: 1.25rem; font-weight: 700; color: ${totalAmount >= 0 ? '#059669' : '#dc2626'};">${formatMoney(Math.abs(totalAmount), acctCur)}</div>
    </div>
    <div style="padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #bae6fd;">
      <div style="font-size: 0.875rem; color: #6b7280;">Will Auto-Categorize</div>
      <div style="font-size: 1.25rem; font-weight: 700; color: ${fullMatchCount === totalCount ? '#059669' : '#b45309'};">${fullMatchCount} / ${totalCount}</div>
    </div>
  `;
  
  // Show save button and hide parse button
  document.getElementById("saveImport").style.display = "inline-block";
  document.getElementById("parseData").style.display = "none";
  
}

function formatHeader(header) {
  // Convert camelCase or snake_case to Title Case
  return header
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

async function handleSaveImport() {

  const saveBtn = document.getElementById("saveImport");
  if (!saveBtn) {
    console.error("[MODAL] Save button not found");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const transactions = window._importData?.pendingTransactions;

    if (!transactions || transactions.length === 0) {
      alert("❌ No transactions to save!");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Transactions";
      return;
    }

    const selectedAccountId = document.getElementById("importAccount").value;

    if (!selectedAccountId) {
      alert("⚠️ Please select an account!");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Transactions";
      return;
    }

    // Normalise transactions before saving
    const normalisedTx = transactions.map(tx => ({
      ...tx,
      id: crypto.randomUUID(),
      accountId: selectedAccountId,
      categoryId: tx.categoryId ?? null,   // Keep null instead of undefined
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    // ⛔️ FIXED: ONLY ONE SAVE CALL
    const { saved, skipped, enriched = 0, reconciled = 0 } = await saveImportedTransactions(normalisedTx);

    if (saved > 0) {
      alert(`✅ Successfully saved ${saved} transactions (${skipped} skipped as duplicates${enriched ? `, ${enriched} existing rows had their details filled in` : ''}${reconciled ? `, ${reconciled} matched recurring/bill payments already recorded` : ''}).`);

      // Trigger callback to refresh UI
      if (window._importData?.onImported) {
        await window._importData.onImported(saved);
      }

      hideImportModal();
    } else {
      console.warn("[MODAL] No transactions saved");
      alert("⚠️ No transactions were saved. Please check the data format or duplicates.");
    }

  } catch (error) {
    console.error("[MODAL] Save error:", error);
    alert("❌ Error saving transactions: " + error.message);

  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Transactions";
  }
}

// Helper function to get bank options
function getBankOptions() {
  
  // If BANK_FORMATS is an array (from your structure)
  const bankOptions = [];
  
  if (Array.isArray(BANK_FORMATS)) {
    // Your format: array of objects with id and label
    BANK_FORMATS.forEach(format => {
      bankOptions.push({
        value: format.id,
        name: format.label,
        description: `Auto-detects ${format.label} format`
      });
    });
  }
  
  // Add an auto-detect option
  bankOptions.unshift({
    value: 'auto',
    name: 'Auto-detect',
    description: 'Automatically detect bank format from file headers'
  });
  
  // Add generic fallback options.
  // NAB is no longer listed here manually — it's now a real entry in
  // BANK_FORMATS (see bankFormats.js), added above via the forEach loop.
  // Leaving both would have shown two identical "NAB" options.
  bankOptions.push(
    {
      value: 'generic_csv',
      name: 'Generic CSV',
      description: 'Standard CSV with Date,Description,Amount columns'
    },
    {
      value: 'anz',
      name: 'ANZ Bank',
      description: 'ANZ bank statement format (no header row)'
    },
    {
      value: 'commbank',
      name: 'Commonwealth Bank',
      description: 'CommBank CSV export'
    },
    {
      value: 'westpac',
      name: 'Westpac',
      description: 'Westpac CSV format'
    }
  );
  
  return bankOptions;
}

// ============================================================================
// Modal Setup Functions
// ============================================================================

function setupModalEvents() {
  
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      // Update tab buttons
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.style.background = '#6b7280';
        b.classList.remove('active');
      });
      this.style.background = '#3b82f6';
      this.classList.add('active');
      
      // Show corresponding tab content
      const tabId = this.getAttribute('data-tab') + 'Tab';
      document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
      });
      const targetTab = document.getElementById(tabId);
      if (targetTab) {
        targetTab.style.display = 'block';
        targetTab.classList.add('active');
      }
    });
  });
  
  // Close modal events
  const closeBtn = document.getElementById('closeImportModal');
  const cancelBtn = document.getElementById('cancelImport');
  const overlay = document.getElementById('importModalOverlay');
  
  if (closeBtn) closeBtn.addEventListener('click', hideImportModal);
  if (cancelBtn) cancelBtn.addEventListener('click', hideImportModal);
  if (overlay) overlay.addEventListener('click', hideImportModal);
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideImportModal();
    }
  });
  
  // Parse button
  const parseBtn = document.getElementById('parseData');
  if (parseBtn) {
    parseBtn.addEventListener('click', handleParseData);
  }
  
  // Save button
  const saveBtn = document.getElementById('saveImport');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleSaveImport);
  }
  
  // Style file input on change
  const fileInput = document.getElementById('csvFile');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      if (this.files.length > 0) {
        this.style.borderColor = '#10b981';
        this.style.backgroundColor = 'rgba(16,185,129,0.16)';
      } else {
        this.style.borderColor = 'var(--border)';
        this.style.backgroundColor = 'var(--bg-card)';
      }
    });
  }
  
}

function createImportModal() {
  
  // Remove existing modal if it exists
  const existingModal = document.getElementById("importModal");
  if (existingModal) {
    existingModal.remove();
  }
  
  const modalHTML = `
    <div id="importModal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999;">
      <div class="modal-overlay" id="importModalOverlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);"></div>
      <div class="modal-content" style="position: relative; background: white; border-radius: 12px; max-width: 800px; width: 90%; margin: 5vh auto; padding: 0; z-index: 10000; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;">
        
        <div class="modal-header" style="padding: 24px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb;">
          <h3 style="margin: 0; font-size: 1.5rem; font-weight: 600; color: #111827;">📁 Import Transactions</h3>
          <button id="closeImportModal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280; padding: 4px 8px; border-radius: 6px; line-height: 1;">&times;</button>
        </div>
        
        <div class="modal-body" style="padding: 24px; overflow-y: auto; flex: 1;">
          
          <div class="import-tabs" style="display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
            <button class="tab-btn active" data-tab="csv" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s;">CSV File</button>
            <button class="tab-btn" data-tab="text" style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s;">Text Import</button>
          </div>
          
          <!-- CSV Tab -->
          <div id="csvTab" class="tab-content active">
            <div style="margin-bottom: 20px;">
              <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">Select CSV File</label>
              <input type="file" id="csvFile" accept=".csv,.txt,.pdf" style="width: 100%; padding: 10px; border: 2px solid #d1d5db; border-radius: 8px; background: white; cursor: pointer; transition: border-color 0.2s;">
              <small style="display: block; margin-top: 6px; color: #6b7280; font-size: 0.875rem;">Supported: CSV, TXT and text-based PDF statements (PDFs are read on this device — nothing is uploaded)</small>
            </div>
            <div style="margin-bottom: 20px;">
              <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">Bank Format</label>
              <select id="csvFormat" style="width: 100%; padding: 10px; border: 2px solid #d1d5db; border-radius: 8px; background: white; cursor: pointer;">
                <option value="">-- Auto-detect from file --</option>
                <!-- Bank options will be populated dynamically -->
              </select>
            </div>
          </div>
          
          <!-- Text Tab -->
          <div id="textTab" class="tab-content" style="display: none;">
            <div style="margin-bottom: 20px;">
              <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">Paste Bank Statement Text</label>
              <textarea id="statementText" rows="6" style="width: 100%; padding: 12px; border: 2px solid #d1d5db; border-radius: 8px; font-family: monospace; resize: vertical;" placeholder="Paste your bank statement text here..."></textarea>
            </div>
            <div style="margin-bottom: 20px;">
              <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">Bank</label>
              <select id="textFormat" style="width: 100%; padding: 10px; border: 2px solid #d1d5db; border-radius: 8px; background: white; cursor: pointer;">
                <option value="">-- Select format --</option>
                <!-- Bank options will be populated dynamically -->
              </select>
            </div>
          </div>
          
          <!-- Account Selection -->
          <div style="margin-bottom: 24px; padding: 20px; background: #f3f4f6; border-radius: 8px;">
            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #111827;">Default Account for Import</label>
            <select id="importAccount" style="width: 100%; padding: 12px; border: 2px solid #9ca3af; border-radius: 8px; background: white; font-weight: 500;">
              <option value="">-- Select Account --</option>
              <!-- Accounts will be populated dynamically -->
            </select>
            <small style="display: block; margin-top: 8px; color: #6b7280;">All imported transactions will be assigned to this account</small>
          </div>
          
          <!-- Preview Area -->
          <div id="importPreview" style="display: none; margin-top: 24px; padding: 20px; background: #f0f9ff; border: 2px solid #bae6fd; border-radius: 8px;">
            <h4 style="margin-top: 0; margin-bottom: 16px; color: #0369a1; font-size: 1.125rem;">Preview (First 5 transactions)</h4>
            <div id="previewTable" style="overflow-x: auto; margin-bottom: 16px;">
              <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden;">
                <thead id="previewHeaders" style="background: #e0f2fe;">
                  <!-- Headers will be populated -->
                </thead>
                <tbody id="previewRows" style="font-family: monospace; font-size: 0.875rem;">
                  <!-- Rows will be populated -->
                </tbody>
              </table>
            </div>
            <div id="previewStats" style="display: flex; gap: 24px; font-weight: 500; color: #0c4a6e;">
              <!-- Stats will be populated -->
            </div>
          </div>
          
        </div>
        
        <div class="modal-footer" style="padding: 20px 24px; border-top: 1px solid #e5e7eb; background: #f9fafb; display: flex; gap: 12px; justify-content: flex-end;">
          <button id="parseData" style="padding: 12px 24px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 1rem; transition: background 0.2s;">Parse Data</button>
          <button id="saveImport" style="padding: 12px 24px; background: #10b981; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 1rem; transition: background 0.2s; display: none;">💾 Save Transactions</button>
          <button id="cancelImport" style="padding: 12px 24px; background: #6c757d; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 1rem; transition: background 0.2s;">Cancel</button>
        </div>
        
      </div>
    </div>
  `;
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Setup event listeners
  setupModalEvents();
}

// ============================================================================
// Public Functions
// ============================================================================

export function initImportModal({ accounts, categories, onImported }) {
  
  const btnImportTx = document.getElementById("btnImportTx");
  
  if (!btnImportTx) {
    console.error("[MODAL] btnImportTx not found!");
    return;
  }
  
  // Remove any existing click handlers first
  const newBtn = btnImportTx.cloneNode(true);
  btnImportTx.parentNode.replaceChild(newBtn, btnImportTx);
  
  // Create modal HTML if it doesn't exist
  if (!document.getElementById("importModal")) {
    createImportModal();
  }
  
  // Add click handler to the new button
  newBtn.addEventListener("click", () => {
    showImportModal({ accounts, categories, onImported });
  });
  
  modalInitialized = true;
}

export function showImportModal({ accounts, categories, onImported }) {
  
  const modal = document.getElementById("importModal");
  
  if (!modal) {
    console.error("[MODAL] Modal not found in DOM!");
    return;
  }
  
  // Get bank options
  const bankOptions = getBankOptions();
  
  // Populate bank format dropdowns
  const csvFormatSelect = document.getElementById("csvFormat");
  const textFormatSelect = document.getElementById("textFormat");
  
  if (csvFormatSelect && bankOptions.length > 0) {
    csvFormatSelect.innerHTML = bankOptions.map(bank => 
      `<option value="${bank.value}" title="${bank.description}">${bank.name}</option>`
    ).join('');
  }
  
  if (textFormatSelect && bankOptions.length > 0) {
    // For text import, show all options except auto-detect
    const textFormats = bankOptions.filter(bank => bank.value !== 'auto');
    textFormatSelect.innerHTML = textFormats.map(bank => 
      `<option value="${bank.value}" title="${bank.description}">${bank.name}</option>`
    ).join('');
  }
  
  // Populate account dropdown
  const accountSelect = document.getElementById("importAccount");
  
  if (accountSelect && accounts && accounts.length > 0) {
    accountSelect.innerHTML = '<option value="">-- Select Account --</option>' +
      accounts.map(acc => `<option value="${acc.id}">${acc.name}</option>`).join('');
  } else if (accountSelect) {
    accountSelect.innerHTML = '<option value="">No accounts available</option>';
    console.warn("[MODAL] No accounts available for import");
  }
  
  // Reset form
  document.getElementById("csvFile").value = "";
  document.getElementById("statementText").value = "";
  document.getElementById("importPreview").style.display = "none";
  document.getElementById("saveImport").style.display = "none";
  document.getElementById("parseData").style.display = "block";
  
  // Store data for later use
  window._importData = {
    accounts,
    categories,
    onImported,
    pendingTransactions: null,
    bankOptions
  };
  
  // Show modal
  modal.style.display = "block";
  document.body.style.overflow = "hidden";
  
  // Focus on first input
  setTimeout(() => {
    const firstInput = document.querySelector('#importModal input, #importModal select, #importModal textarea');
    if (firstInput) {
      firstInput.focus();
    }
  }, 100);
  
}

// Make hideImportModal available globally if needed
window.hideImportModal = hideImportModal;