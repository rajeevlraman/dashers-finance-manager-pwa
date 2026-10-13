// ============================================================================
// ❓ help.js — in-app Help & User Guide
// ----------------------------------------------------------------------------
// Static, searchable guide rendered into #mainContent (nav item "Help").
// Content lives in HELP_SECTIONS below: to add or edit a topic, change that
// array — each section is { id, icon, title, html }. No data is read or
// written; nothing here depends on the database.
// ============================================================================

import { LICENCE_PUBLIC_KEY } from './licenceConfig.js';

export const HELP_SECTIONS_ALL = [
  {
    id: 'start', icon: '🚀', title: 'Getting started',
    html: `
      <p>Dashers Finance Manager is a personal<span data-feature="property"> and property-investor</span> finance tracker that runs entirely in your browser. Your data is stored on your own device (IndexedDB) — there is no account and no cloud unless you choose to set up Family Sync.</p>
      <ol>
        <li><strong>Add your accounts</strong> (Money → Accounts) with an opening balance. Balances are then calculated as <em>opening balance + transactions</em>.</li>
        <li><strong>Bring in transactions</strong> by importing a bank file (Transactions → 📁 Import) or adding them by hand.</li>
        <li><strong>Set up budgets, bills and loans</strong> as you need them.</li>
        <li><strong>Back up</strong> regularly (Settings → Data Management → Export Data).</li>
      </ol>
      <p><strong>Just want to look around?</strong> Go to <em>Settings → Demo / Test Data → Load Demo Data</em> to fill the app with a sample household. You can remove it again with <em>Remove Demo Data</em>.</p>
      <p class="help-note">Keep a backup before updating or trying new features, and please report anything that looks wrong.</p>`
  },
  {
    id: 'install', icon: '📲', title: 'Installing as an app & offline use',
    html: `
      <p>The app is a Progressive Web App (PWA). Installing it gives you a home-screen icon and offline use.</p>
      <ul>
        <li><strong>It must be served over HTTPS</strong> (or <code>http://localhost</code> on the same device). Over a plain <code>http://</code> network address the browser will not register the service worker, so there is no offline mode or install option.</li>
        <li><strong>iPhone / iPad:</strong> open in Safari → Share → <em>Add to Home Screen</em>.</li>
        <li><strong>Android:</strong> open in Chrome → ⋮ menu → <em>Install app</em> / <em>Add to Home screen</em>.</li>
        <li><strong>Desktop Chrome / Edge:</strong> use the install icon in the address bar.</li>
      </ul>
      <p>Open the app once online after each update so the new version can cache itself. To check, use <em>Settings → About → Check for Updates</em>.</p>`
  },
  {
    id: 'dashboards', icon: '📊', title: 'Dashboards & overviews',
    html: `
      <p>Three pages sit under the <strong>Dashboard</strong> group in the menu:</p>
      <ul>
        <li><strong>Financial Dashboard</strong> — charts for income and expense trends, category breakdowns, budget vs actual, savings goals, cost comparisons, investments and portfolio allocation.</li>
        <li><strong>Wealth Overview</strong> — net worth across accounts, <span data-feature="property">property, </span>loans and super.</li>
        <li><strong>Finance Overview</strong> — your day-to-day home screen: an at-a-glance strip (net worth, debt, cash runway, bills due), budget summary, cards and bills.</li>
      </ul>
      <p>Figures in other currencies are shown with their base-currency equivalent when an exchange rate is set (see <em>Multiple currencies</em>).</p>`
  },
  {
    id: 'accounts', icon: '💳', title: 'Accounts',
    html: `
      <p>Account types: <strong>Bank, Credit Card, Savings, Investment, Offset, Cash</strong> and <strong>Other</strong>. Each account has an opening balance and its own currency. Only an optional last-4-digits is stored — never full account numbers.</p>
      <ul>
        <li><strong>Computed balances:</strong> current balance = opening balance + the sum of that account's transactions. Edit the opening balance, not the current balance.</li>
        <li><strong>⚖️ Reconcile Balance:</strong> if the app differs from your real bank or card statement, use Reconcile to correct it to the statement figure.</li>
        <li><strong>Credit cards</strong> can carry a credit limit and statement close/due days, which feed the credit card widgets.</li>
        <li><strong>Offset accounts</strong> can be linked to a loan (see <em>Loans</em>).</li>
        <li><strong>Transfers</strong> between your own accounts are recorded on both sides so totals are not distorted.</li>
      </ul>`
  },
  {
    id: 'setup', icon: '🧭', title: 'Setup guide',
    html: `
      <p>The first time you open the app with no data, a short <strong>setup guide</strong> walks you through the basics one step at a time: your currency, accounts, loans, properties, vehicles, super and insurance. Every step is optional.</p>
      <ul>
        <li><strong>Skip anything:</strong> use <em>Skip this step</em> to move on, or <em>Skip setup</em> to close the guide.</li>
        <li><strong>Add as many as you like:</strong> after saving one item, choose <em>Add another</em> or <em>Continue</em>. Mistake? Use <em>Remove</em> in the list.</li>
        <li><strong>Short forms:</strong> the guide asks only for the essentials. Add the rest later on each page.</li>
        <li><strong>Run it again:</strong> tap <em>🧭 Guide</em> in the top bar (or <em>Tour &amp; setup guide</em> in the phone menu), or use Settings. It never appears on its own once you have data, or after you skip it.</li>
        <li><strong>It remembers:</strong> if you skip a step or close the guide part-way, it keeps what you added and typed, and opens a checklist next time so you can continue or jump to any step.</li>
        <li><strong>Tour of every page:</strong> the tour lists every page in the app with a one-line description. Tap one to open it: a short insight about the page appears, then a small <em>Got it</em> box moves from item to item on the screen. Tap <em>Got it</em> for the next one, or <em>Skip</em> to stop.</li>
      </ul>
      <p><button type="button" class="btn btn-primary" data-open-guide="tour">Take the tour</button> <button type="button" class="btn btn-secondary" data-open-guide="setup">Run setup guide</button></p>
      <p>Properties appears only if your edition includes it.</p>`
  },
  {
    id: 'transactions', icon: '💸', title: 'Transactions & importing bank data',
    html: `
      <p>Add transactions by hand, or click <strong>📁 Import</strong> on the Transactions page to bring in a bank export.</p>
      <ul>
        <li><strong>Supported inputs:</strong> bank CSV and TXT exports, text-based PDF statements, and pasted text (the Import window has a <em>Text Import</em> tab).</li>
        <li><strong>PDF statements</strong> must have a text layer (the PDF you download from your bank's site or app). Every row is checked against the running balance, so a misread amount is flagged instead of silently imported. A page that is only an image (a scan or flattened export) can't be read; the app lists the skipped pages, so download the statement again from your bank.</li>
        <li><strong>Overseas accounts:</strong> pick the account in the matching currency before importing. Amounts are saved as they appear on the statement, with the base-currency value shown using your exchange rate.</li>
        <li>The importer detects the bank format, suggests a <strong>category and merchant</strong> for each line, and lets you review everything before saving.</li>
        <li><strong>Duplicates</strong> against what you already have are flagged so re-importing an overlapping statement does not double up.</li>
        <li>Corrections you make are learned as <strong>merchant rules</strong> for next time. If a rule is wrong, clear it under <em>Settings → Data Management → Clear Auto-Learned Merchant Rules</em>.</li>
        <li><strong>Filters, search and sort</strong> are kept after you edit, save, delete or import.</li>
        <li>Transactions can be linked to a <span data-feature="property"><strong>property</strong> (for rental deductions) or a </span><strong>vehicle</strong> (rego and fuel tracking).</li>
      </ul>
      <p>Cleanup tools live in <em>Settings → Data Management</em>: Find Duplicate Transactions, Review &amp; Fix Categories, Credit Card Payment Transfers, <span data-feature="property">Property Matches, </span>Vehicle Rego &amp; Fuel Matches, and Merge Duplicate Categories.</p>`
  },
  {
    id: 'categories', icon: '🗂️', title: 'Categories',
    html: `
      <p>Categories use a single taxonomy of <strong>parent categories with subcategories</strong>. Merchant/vendor names are stored separately in the transaction's <em>merchant</em> field, so you do not need a category per shop.</p>
      <p>Add, rename or merge categories on the Categories page. If you end up with near-duplicates, use <em>Settings → Merge Duplicate Categories</em>.</p>`
  },
  {
    id: 'budgets', icon: '🎯', title: 'Budgets & templates',
    html: `
      <p>Set a target amount per category and frequency; the Budgets page compares it with what you actually spent.</p>
      <ul>
        <li><strong>Templates:</strong> save your current budgets as a named template and load it later, either <em>added to</em> your existing budgets or <em>replacing</em> them. Saving the current set first is offered before a replace.</li>
        <li><strong>✨ Add Demo Templates</strong> installs two example household templates to try.</li>
        <li><strong>Remove All Budgets</strong> clears the live budgets (saved templates are untouched).</li>
      </ul>`
  },
  {
    id: 'reports', icon: '📈', title: 'Reports',
    html: `
      <p>The <strong>Reports</strong> page (Money group) turns your transactions into charts and tables:</p>
      <ul>
        <li><strong>Monthly Income vs Expenses</strong> and <strong>Expenses by Category</strong>.</li>
        <li><strong>Top Spending Categories</strong>, <strong>Spend by Account</strong> and <strong>Income Sources</strong>.</li>
        <li><strong>Category Breakdown by Month</strong> for spotting trends.</li>
      </ul>
      <p>Reports use the same date filters you pick on the page, and amounts are converted to your base currency. If a chart looks empty, check that you have transactions in the chosen period.</p>`
  },
  {
    id: 'bills', icon: '🧾', title: 'Bills, Calendar, Recurring & Subscriptions',
    html: `
      <ul>
        <li><strong>Bills</strong> — upcoming payments with a due date, amount, account and optional recurrence. Bills can be linked to a <span data-feature="property">property or </span>vehicle and to a destination account. Mark a bill as paid when settled. Browser reminders for overdue or soon-due bills need notification permission (opt in on the Bills page).</li>
        <li><strong>Calendar</strong> — a date view of bills, rent and loan events, with calendar export.</li>
        <li><strong>Recurring</strong> — templates that auto-create transactions on a schedule (salary, rent, transfers).</li>
        <li><strong>Subscriptions</strong> — personal subscriptions (streaming, software). Imports help detect them.</li>
      </ul>
      <p><strong>Bills vs Recurring:</strong> they are intentionally separate. A <em>bill</em> is something you still have to pay; a <em>recurring transaction</em> is money that moves automatically on a schedule.</p>`
  },
  {
    id: 'loans', icon: '🏦', title: 'Loans',
    html: `
      <p>Track mortgages, investment, vehicle, personal, education, business and <strong>construction</strong> loans. Each loan has a rate, term, start date and payment frequency (weekly, fortnightly or monthly).</p>
      <ul>
        <li><strong>Interest-only periods:</strong> set interest-only months for investment-style loans; repayments switch to principal &amp; interest afterwards. Rate changes can be recorded in the rate history.</li>
        <li><strong>Recording payments:</strong> payments update the loan balance and can post a transaction from the account you pay from.</li>
        <li><strong>Offset accounts:</strong> link an offset account to a loan to see the interest saving.</li>
        <li><strong>Construction loans:</strong> the facility is released in <em>stages</em> (deposit, slab, frame…). Tick a stage as drawn and the balance grows with each draw; you pay interest only on what has been drawn. Once every stage is drawn it converts to normal repayments.</li>
        <li><strong>🧮 Loan What-If</strong> (its own page in the menu): model extra repayments to see time and interest saved.</li>
        <li><strong>📦 Add Demo Loans</strong> adds example loans, including a staged construction loan, so you can see how each type behaves. Remove them again with <em>🧹 Remove Demo Loans</em>.</li>
      </ul>`
  },
  {
    id: 'property', feature: 'property', icon: '🏠', title: 'Properties, Tenants, Maintenance & Expenses',
    html: `
      <ul>
        <li><strong>Properties</strong> — your register: purchase price, current value, rent, linked loan and balance.</li>
        <li><strong>Tenants</strong> — lease and tenant records per property.</li>
        <li><strong>Maintenance</strong> — repairs and improvements, separated so repairs vs capital works are treated correctly for tax.</li>
        <li><strong>Expenses</strong> — property expenses pulled from your transactions and unpaid property-linked bills, with deductibility flags. Rates and Land Tax are summarised per financial year.</li>
      </ul>
      <p>Linking transactions to a property is what makes the property reports accurate. The Settings → <em>Review &amp; Fix Property Matches</em> tool helps catch ones that were missed.</p>`
  },
  {
    id: 'insurance', icon: '🛡️', title: 'Insurance & Vehicles',
    html: `
      <ul>
        <li><strong>Insurance</strong> — home &amp; contents, <span data-feature="property">landlord, </span>car and other policies: provider, policy number, cover, sum insured, excess, premium and renewal date. A policy can be linked to <span data-feature="property">a property and/or </span>a bill; the app warns if the premium and linked bill disagree.</li>
        <li><strong>Vehicles</strong> — registration renewal, odometer, licence, and linked car insurance. Fuel purchases linked to a vehicle give fuel spend, cost per km and actual or estimated mileage.</li>
      </ul>`
  },
  {
    id: 'super', icon: '💰', title: 'Superannuation',
    html: `
      <p>Record each super fund membership, balance snapshots over time, contributions, and (where used) insurance premiums and fees charged inside the fund. Recurring contribution schedules can generate entries automatically and project growth using an assumed rate — a what-if estimate, not a guarantee.</p>`
  },
  {
    id: 'tax', feature: 'tax', icon: '📘', title: 'ATO Reports & Cost Base',
    html: `
      <ul>
        <li><strong>ATO Reports</strong> — deduction tips, a record checklist (it checks what is recorded in the app, not ATO compliance), key dates, calculators (depreciation, GST, CGT, negative gearing) and rental schedule / deduction exports built from your recorded rent, expenses and loan interest.</li>
        <li><strong>Cost Base</strong> — pick a property to see how its cost base builds up (purchase price, buying costs, improvements) and a rough capital-gain estimate if you sold. Costs are grouped by how they're treated for tax.</li>
      </ul>
      <p class="help-note"><strong>Not tax advice.</strong> The calculators are deliberately simplified (they do not model main-residence exemptions, the six-year absence rule, pre-CGT assets or indexation). Tax and ATO figures are always in AUD. Confirm anything important with a registered tax agent.</p>`
  },
  {
    id: 'currency', icon: '💱', title: 'Multiple currencies & exchange rates',
    html: `
      <ul>
        <li>Choose your <strong>base currency</strong> in Settings (default AUD). Each account has its own currency.</li>
        <li>Exchange rates are a <strong>manual table</strong>: enter how many base-currency units one unit of the foreign currency is worth, e.g. USD = 0.65 means US$1 = A$0.65. The date of the last update is kept.</li>
        <li>Foreign balances then show a base-currency equivalent and roll into totals.</li>
        <li><strong>⚠️ Missing-rate warning:</strong> if you hold an account in a currency with no rate, a yellow banner appears and that account is counted 1:1 with your base currency until you add a rate. Fix it under <em>Settings → Preferences → Exchange rates</em>.</li>
        <li><strong>Transfers between accounts in different currencies</strong> ask for both amounts, so each side is recorded in its own account's currency.</li>
        <li><strong>Loans, bills, subscriptions, insurance, recurring items and vehicles</strong> have no currency of their own. They are treated as being in your base currency.</li>
        <li>Rates are stored with your data, so they are included in backups and sync with Family Sync. They are never updated automatically: refresh them when it matters.</li>
        <li>Changing the base currency clears the rate table, because rates only make sense against one base.</li>
        <li><span data-feature="tax">Tax, ATO, cost base and </span>super figures stay in AUD regardless.</li>
      </ul>
      <p>The demo data includes a USD and an INR account; only USD gets a sample rate so you can see the warning for INR.</p>`
  },
  {
    id: 'backup', icon: '💾', title: 'Backup, restore & security',
    html: `
      <ul>
        <li><strong>Backup Data</strong> (the header button, the menu, or Settings → Data Management) saves everything to a JSON file. Tick <em>Encrypt backup with a password</em> to protect it (PBKDF2 + AES-GCM). <strong>There is no password recovery.</strong></li>
        <li><strong>On iPhone</strong> you can choose <em>Save to Files / Share</em> and keep the backup in iCloud Drive, so it is not stored only on the phone.</li>
        <li>Settings shows <em>Last backup</em>, and the app reminds you if you have data but no backup in the last 30 days.</li>
        <li><strong>Restore Data</strong> opens a backup and first shows you what is inside (date, app version, record counts) so you can confirm. Nothing is deleted: records with the same ID are replaced by the backup's version and missing ones are added; transactions that look like duplicates are skipped. A backup from a newer app version is refused until you update the app.</li>
        <li><strong>App Lock</strong> adds a PIN screen. It is a screen lock only — it does <em>not</em> encrypt the data stored in the browser — and there is no PIN recovery.</li>
        <li><strong>Danger Zone</strong> wipes local data. Export first.</li>
      </ul>
      <p><strong>If your data is gone</strong> (cleared browser data, a reset or lost phone, a new device): open the app at the same address, choose <em>Restore Data</em> and pick your latest backup file. Without a backup file there is nothing to recover, because the data is stored only in this browser.</p>
      <p>Your data lives in this browser. Clearing site data or switching browsers/devices without a backup means starting empty.</p>`
  },
  {
    id: 'licence', licenceOnly: true, icon: '🔑', title: 'Licence & upgrades',
    html: `
      <p>Dashers Finance Manager is sold in three editions, each including the one before:</p>
      <ul>
        <li><strong>Core</strong> — everything except the Property and Tax sections.</li>
        <li><strong>Property</strong> — adds Properties, Tenants, Maintenance, Expenses, property fields and Rates &amp; Land Tax.</li>
        <li><strong>Property + Tax</strong> — adds ATO Reports and Cost Base.</li>
      </ul>
      <ul>
        <li>During the <strong>free trial</strong> every available section is unlocked so you can try them.</li>
        <li><strong>Activate or upgrade:</strong> Settings → Licence → paste your key → Activate. New sections unlock straight away. Sections outside your edition show a 🔒 in the menu and an upgrade screen when opened.</li>
        <li><strong>Your data is never deleted</strong> by a licence change. Anything from a section you haven't unlocked is just hidden, and it reappears when you upgrade. You can always export a backup, even when the trial has ended.</li>
        <li>Keys work offline and are tied to the major version (1.x). Your key is saved on this device and inside every backup you make, and <em>Copy my licence key</em> in Settings → Licence shows it again. Still keep the email you were sent.</li>
        <li><strong>After the free trial</strong> you get a few extra days with a reminder before the licence screen appears. <em>Export my data</em> is always available there.</li>
        <li><strong>New phone or computer?</strong> Restore a backup there (the licence comes back with it) or paste your key into Settings → Licence. If your key is limited to a number of devices, tap <em>Deactivate this device</em> on the old one first.</li>
      </ul>`
  },
  {
    id: 'sync', icon: '👨‍👩‍👧‍👦', title: 'Family Sync (optional)',
    html: `
      <p>Family Sync shares data between household devices through a small server you run yourself on your home network (see <code>family-server/README.md</code>). Nothing goes to the internet.</p>
      <ul>
        <li>The admin creates family members and chooses which sections each can see (e.g. Bills and Budgets but not Loans).</li>
        <li>Sync is last-write-wins per record, with deletions propagated.</li>
        <li>It is designed for a trusted local network — do not expose the server directly to the internet.</li>
      </ul>`
  },
  {
    id: 'demo', icon: '🧪', title: 'Demo / test data',
    html: `
      <ul>
        <li><strong>Settings → Demo / Test Data → Load Demo Data</strong> adds a sample household: accounts (including USD and INR), about 170 transactions, loans, <span data-feature="property">properties, </span>bills, recurring items, subscriptions, super, insurance and vehicles.</li>
        <li>All demo records have IDs starting with <code>demo_</code>, so <strong>Remove Demo Data</strong> deletes only those and leaves your own data alone.</li>
        <li>Smaller per-page demos can be added and removed on their own page: <strong>Loans</strong> (📦 Add / 🧹 Remove Demo Loans), <strong>Accounts</strong> (📦 Add Defaults / 🧹 Remove Demo Accounts) and <strong>Budgets</strong> (✨ Add / 🧹 Remove Demo Templates). Each Remove button only touches demo items; an account holding your own transactions is kept.</li>
        <li>Best used on a fresh install so you can tell demo and real data apart.</li>
      </ul>`
  },
  {
    id: 'troubleshoot', icon: '🛠️', title: 'Troubleshooting',
    html: `
      <ul>
        <li><strong>Changes or a new version aren't showing:</strong> Settings → About → <em>Check for Updates</em>, then reload. Updates need one online visit.</li>
        <li><strong>No install / offline option:</strong> the site is not on HTTPS (see <em>Installing</em>).</li>
        <li><strong>Yellow "No exchange rate" banner:</strong> add the rate under Settings → Preferences → Exchange rates.</li>
        <li><strong>Balance doesn't match my bank:</strong> use <em>Reconcile Balance</em> on the account, and check for duplicate transactions.</li>
        <li><strong>A PDF statement imports nothing or skips pages:</strong> the page is probably an image (scan or flattened export). Download the statement again from your bank's site or app, or paste the text into the <em>Text Import</em> tab.</li>
        <li><strong>Family Sync stopped working:</strong> check the server is running and on the same Wi-Fi, and that the <em>Server Address</em> in Settings still matches it. A changed IP address on the server machine is a common cause.</li>
        <li><strong>Wrong categories after import:</strong> use <em>Review &amp; Fix Transaction Categories</em>, and clear learned rules if a bad rule keeps repeating.</li>
        <li><strong>Something broke:</strong> long-press the app title to reveal the 🪵 debug console, which shows recent errors and warnings — include a screenshot when reporting.</li>
        <li><strong>Forgot PIN or backup password:</strong> neither can be recovered. A PIN reset means wiping local data and restoring from backup.</li>
      </ul>`
  },
  {
    id: 'about', icon: 'ℹ️', title: 'About this app',
    html: `
      <p>Dashers Finance Manager is provided as-is. It is a record-keeping aid, <strong>not financial, tax or legal advice</strong>. Always verify important figures against your bank, lender and the ATO.</p>
      <p>When reporting an issue, note the app version (Settings → About), the page you were on, what you expected, and what happened.</p>`
  }
];

// The licence topic only makes sense once licensing is switched on (js/licenceConfig.js).
export const HELP_SECTIONS = HELP_SECTIONS_ALL.filter(sec => !sec.licenceOnly || LICENCE_PUBLIC_KEY);

const esc = str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function initHelpUI() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;

  mainContent.innerHTML = `
    <div class="page-container help-page">
      <style>
        .help-page .help-search { width:100%; max-width:480px; padding:10px 14px; border-radius:8px;
          border:1px solid var(--border-color, #cbd5e1); background:var(--card-bg, transparent);
          color:var(--text-main, inherit); font-size:1rem; box-sizing:border-box; }
        .help-page .help-toc { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 16px; }
        .help-page .help-toc a { font-size:.82rem; padding:4px 10px; border-radius:999px; text-decoration:none;
          border:1px solid var(--border-color, #cbd5e1); color:var(--text-main, inherit); }
        .help-page details.help-sec { border:1px solid var(--border-color, #cbd5e1); border-radius:10px;
          margin:0 0 10px; padding:0 14px; background:var(--card-bg, transparent); }
        .help-page details.help-sec > summary { cursor:pointer; padding:12px 0; font-weight:600; font-size:1.02rem; }
        .help-page .help-body { padding:0 0 12px; line-height:1.55; font-size:.93rem; }
        .help-page .help-body ul, .help-page .help-body ol { padding-left:1.25rem; }
        .help-page .help-body li { margin:4px 0; }
        .help-page .help-note { padding:8px 12px; border-radius:8px; background:rgba(240,199,94,.18); border:1px solid rgba(240,199,94,.5); }
        .help-page code { font-size:.85em; padding:1px 5px; border-radius:4px; background:rgba(127,127,127,.18); }
        .help-page .help-empty { display:none; padding:16px; opacity:.7; }
      </style>
      <div class="page-header">
        <h2>❓ Help &amp; User Guide</h2>
      </div>
      <input type="search" id="helpSearch" class="help-search" placeholder="Search help (e.g. exchange rate, import, backup)…" aria-label="Search help">
      <div class="help-toc" id="helpToc">
        ${HELP_SECTIONS.map(s => `<a href="#" data-help-jump="${s.id}"${s.feature ? ` data-feature="${s.feature}"` : ''}>${s.icon} ${esc(s.title)}</a>`).join('')}
      </div>
      <div id="helpSections">
        ${HELP_SECTIONS.map(s => `
          <details class="help-sec" id="help-${s.id}" data-help-id="${s.id}"${s.feature ? ` data-feature="${s.feature}"` : ''}>
            <summary>${s.icon} ${esc(s.title)}</summary>
            <div class="help-body">${s.html}</div>
          </details>`).join('')}
      </div>
      <div class="help-empty" id="helpEmpty">No help topics match your search.</div>
    </div>`;

  const sections = [...mainContent.querySelectorAll('details.help-sec')];
  const toc = [...mainContent.querySelectorAll('[data-help-jump]')];
  const empty = mainContent.querySelector('#helpEmpty');

  // Open the first topic so the page never looks empty.
  if (sections[0]) sections[0].open = true;

  mainContent.querySelector('#helpToc').addEventListener('click', e => {
    const a = e.target.closest('[data-help-jump]');
    if (!a) return;
    e.preventDefault();
    const sec = mainContent.querySelector(`#help-${a.dataset.helpJump}`);
    if (!sec) return;
    sec.style.display = '';
    sec.open = true;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Lower-cased text per section, computed once instead of on every keystroke.
  // Text that belongs to a locked tier (hidden by CSS) must not be searchable either.
  const locked = ['property', 'tax'].filter(f => document.documentElement.classList.contains('no-' + f));
  const searchText = el => {
    if (!locked.length) return el.textContent.toLowerCase();
    const c = el.cloneNode(true);
    c.querySelectorAll(locked.map(f => `[data-feature="${f}"]`).join(',')).forEach(n => n.remove());
    return c.textContent.toLowerCase();
  };
  const haystacks = sections.map(sec => locked.includes(sec.dataset.feature) ? '' : searchText(sec));

  mainContent.querySelector('#helpSearch').addEventListener('input', e => {
    // Every word must appear somewhere in the topic, in any order, so
    // "rate exchange" finds the same topic as "exchange rate".
    const words = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    sections.forEach((sec, i) => {
      const hit = !locked.includes(sec.dataset.feature) && words.every(w => haystacks[i].includes(w));
      sec.style.display = hit ? '' : 'none';
      if (toc[i]) toc[i].style.display = hit ? '' : 'none';
      // Open matches while searching; put the page back as it was when cleared.
      sec.open = words.length ? hit : i === 0;
      if (hit) shown++;
    });
    empty.style.display = shown ? 'none' : 'block';
  });
}
