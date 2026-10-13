import { addItem, getAllItems, deleteItem, updateItem, STORE_NAMES } from './db.js';
import { setupEmojiPicker } from './emojiPicker.js';
import { generateId } from './db.js';
import { escapeHtml } from './sanitize.js';
import { addDefaultCategories, shouldAddDefaultCategories, DEFAULT_CATEGORIES } from './defaultCategories.js';
import { runRecategorizeCheck } from './recategorizeTool.js';

// Chart.js instance for the summary donut below — module-level so
// initCategoriesUI() can destroy the previous one before creating a new
// one on every re-render (same "destroy before recreate" pattern as the
// other pages' summary donuts).
let categoriesSummaryChart = null;

export async function initCategoriesUI() {
  const mainContent = document.getElementById('mainContent');
  mainContent.classList.add('page-transition');
  
  let categories = await getAllItems(STORE_NAMES.categories);

  // Add default categories if this is first time
  if (shouldAddDefaultCategories(categories)) {
    const addedCount = await addDefaultCategories({
      getAllItems,
      addItem, 
      STORE_NAMES
    });
    categories = await getAllItems(STORE_NAMES.categories);
  }

// In your categories.js, replace the summary cards section with this:
mainContent.innerHTML = `
  <div class="page-container">
    <div class="page-header">
      <h2>📂 Categories</h2>
      <div class="page-actions">
        <button id="btnNewCat" class="btn btn-primary">➕ Add Category</button>
        <button id="btnResetDefaults" class="btn btn-secondary">🔄 Reset to Simplified Defaults</button>
      </div>
    </div>

    <!-- Categories Summary — same fo-card donut + per-row progress bar
         treatment as the other pages, in place of the old plain compact
         cards. These are category counts rather than dollar amounts, but
         the same donut + legend + balance-box shape still fits: Income
         vs Expense counts make the donut, Subcategories gets the
         balance box since it's a cross-cutting count (a subcategory is
         also either income or expense) rather than a third slice. -->
    <div class="fo-card fo-card-wide">
      <div class="fo-card-header-row">
        <span class="fo-card-title">Categories Summary</span>
        <span class="fo-card-subtitle">${categories.length} total</span>
      </div>
      <div class="fo-budget-layout">
        <div class="fo-chart-wrap fo-donut-wrap">
          <canvas id="categoriesSummaryDonut"></canvas>
          <div class="fo-donut-center">
            <span class="fo-donut-center-value">${categories.length}</span>
            <span class="fo-donut-center-label">Total</span>
          </div>
        </div>
        <div class="fo-budget-mid">
          <div class="fo-legend-row">
            <span class="fo-legend-dot" style="background:#5b8def;"></span>
            <span class="fo-legend-label">Income</span>
            <span class="fo-legend-value">${categories.filter(c => c.type === 'income').length}</span>
          </div>
          <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${categories.length > 0 ? (categories.filter(c => c.type === 'income').length / categories.length) * 100 : 0}%;background:#5b8def"></div></div>
          <div class="fo-legend-row">
            <span class="fo-legend-dot" style="background:#ff6b7a;"></span>
            <span class="fo-legend-label">Expense</span>
            <span class="fo-legend-value">${categories.filter(c => c.type === 'expense').length}</span>
          </div>
          <div class="fo-progress-track thin"><div class="fo-progress-fill" style="width:${categories.length > 0 ? (categories.filter(c => c.type === 'expense').length / categories.length) * 100 : 0}%;background:#ff6b7a"></div></div>
        </div>
        <div class="fo-balance-box">
          <span class="fo-balance-box-value">${categories.filter(c => c.parentId).length}</span>
          <span class="fo-balance-box-label">Subcategories</span>
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="categories-controls">
        <div class="search-box">
          <input type="text" id="categorySearch" placeholder="🔍 Search categories..." class="form-input">
        </div>
        <div class="filter-controls">
          <select id="categoryTypeFilter" class="form-select">
            <option value="all">All Types</option>
            <option value="income">💰 Income</option>
            <option value="expense">💸 Expense</option>
            <option value="parent">📁 Main Categories</option>
            <option value="child">↪️ Subcategories</option>
          </select>
        </div>
      </div>
      <div id="catList" class="categories-container"></div>
    </div>
  </div>
`;

  setTimeout(() => mainContent.classList.remove('page-transition'), 400);

  const catList = document.getElementById('catList');
  renderCategoryList(categories);

  // Categories Summary donut — Income vs Expense counts. Same
  // destroy-before-recreate pattern as the other pages' summary donuts,
  // since initCategoriesUI() re-renders #mainContent's innerHTML (and
  // this canvas along with it) on every category add/edit/delete.
  const catsDonutCanvas = document.getElementById('categoriesSummaryDonut');
  if (catsDonutCanvas && typeof Chart !== 'undefined') {
    if (categoriesSummaryChart) { categoriesSummaryChart.destroy(); categoriesSummaryChart = null; }
    const incomeCount = categories.filter(c => c.type === 'income').length;
    const expenseCount = categories.filter(c => c.type === 'expense').length;
    categoriesSummaryChart = new Chart(catsDonutCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Income', 'Expense'],
        datasets: [{
          data: [incomeCount, expenseCount],
          backgroundColor: ['#5b8def', '#ff6b7a'],
          borderWidth: 0
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        cutout: '70%',
        maintainAspectRatio: false
      }
    });
  }

  document.getElementById('btnNewCat').addEventListener('click', () => openCatEditor());
  document.getElementById('btnResetDefaults').addEventListener('click', resetToDefaultCategories);
  
  // Add search and filter functionality
  document.getElementById('categorySearch').addEventListener('input', () => renderCategoryList(categories));
  document.getElementById('categoryTypeFilter').addEventListener('change', () => renderCategoryList(categories));

  // ========== BUDGETS-STYLE RENDER FUNCTION ==========
  function renderCategoryList(cats) {
    const searchTerm = document.getElementById('categorySearch').value.toLowerCase();
    const typeFilter = document.getElementById('categoryTypeFilter').value;

    if (cats.length === 0) {
      catList.innerHTML = `
        <div class="empty-state">
          <p>No categories yet.</p>
          <button class="btn btn-primary" onclick="openCatEditor()">➕ Add Your First Category</button>
        </div>
      `;
      return;
    }

    // Filter categories
    const filteredCats = cats.filter(cat => {
      const matchesSearch = cat.name.toLowerCase().includes(searchTerm);
      let matchesType = true;
      
      switch (typeFilter) {
        case 'income': matchesType = cat.type === 'income'; break;
        case 'expense': matchesType = cat.type === 'expense'; break;
        case 'parent': matchesType = !cat.parentId; break;
        case 'child': matchesType = !!cat.parentId; break;
      }
      
      return matchesSearch && matchesType;
    });

    if (filteredCats.length === 0) {
      catList.innerHTML = `
        <div class="empty-state">
          <p>No categories match your search criteria.</p>
          <button class="btn btn-secondary" onclick="document.getElementById('categorySearch').value=''; document.getElementById('categoryTypeFilter').value='all'; renderCategoryList(categories)">Clear Filters</button>
        </div>
      `;
      return;
    }

    const topCats = filteredCats.filter(c => !c.parentId);
    const subCats = filteredCats.filter(c => c.parentId);
    
    const incomeCats = topCats.filter(c => c.type === 'income');
    const expenseCats = topCats.filter(c => c.type === 'expense');

    catList.innerHTML = `
      <!-- Income Section -->
      ${incomeCats.length > 0 ? `
        <div class="budgets-section-header">
          <h3>💰 Income Categories</h3>
          <span class="section-count">${incomeCats.length}</span>
        </div>
        <div class="budgets-container">
          ${incomeCats.map(c => renderCategoryCard(c)).join('')}
        </div>
      ` : ''}

      <!-- Expense Section -->
      ${expenseCats.length > 0 ? `
        <div class="budgets-section-header">
          <h3>💸 Expense Categories</h3>
          <span class="section-count">${expenseCats.length}</span>
        </div>
        <div class="budgets-container">
          ${expenseCats.map(c => renderCategoryCard(c)).join('')}
        </div>
      ` : ''}

      <!-- Subcategories Only Section (when filtered) -->
      ${typeFilter === 'child' && subCats.length > 0 ? `
        <div class="budgets-section-header">
          <h3>↪️ Subcategories</h3>
          <span class="section-count">${subCats.length}</span>
        </div>
        <div class="budgets-container">
          ${subCats.map(sub => renderSubcategoryCard(sub, cats)).join('')}
        </div>
      ` : ''}
    `;

    // Add event listeners
    attachCategoryEventListeners();
  }

  function renderCategoryCard(category) {
    const children = categories.filter(s => s.parentId === category.id);
    const hasChildren = children.length > 0;

    return `
      <div class="budget-card ${category.type === 'income' ? 'income-budget' : 'expense-budget'}">
        <div class="budget-card-row1">
          <div class="budget-left">
            <span class="category-icon">${category.icon || guessCategoryIcon(category.name)}</span>
            <span class="category-name">
              ${escapeHtml(category.name)}
              ${hasChildren ? `<span class="subcount-badge">${children.length} sub</span>` : ''}
            </span>
          </div>

          <div class="budget-actions">
            <button class="action-btn add-btn" data-id="${category.id}" data-action="addSub" title="Add Subcategory">➕</button>
            <button class="action-btn edit-btn" data-id="${category.id}" data-action="edit" title="Edit">✏️</button>
            <button class="action-btn delete-btn" data-id="${category.id}" data-action="delete" title="Delete">🗑️</button>
          </div>
        </div>

        <div class="budget-card-row2">
          <div class="subcategories-toggle">
            ${hasChildren ? `
              <button class="btn btn-secondary toggle-subcategories" data-id="${category.id}">
                📂 Show ${children.length} Subcategor${children.length === 1 ? 'y' : 'ies'}
              </button>
            ` : '<span class="no-subcategories">No subcategories</span>'}
          </div>
        </div>

        ${hasChildren ? `
          <div class="subcategories-list" id="sub-${category.id}" style="display:none;">
            ${children.map(sub => renderSubcategoryCard(sub, categories)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderSubcategoryCard(subcategory, allCategories) {
    const parent = allCategories.find(c => c.id === subcategory.parentId);
    
    return `
      <div class="budget-card subcategory-card">
        <div class="budget-card-row1">
          <div class="budget-left">
            <span class="category-icon">${subcategory.icon || guessCategoryIcon(subcategory.name)}</span>
            <span class="category-name">
              ${escapeHtml(subcategory.name)}
              <small class="subcategory-parent">Under: ${escapeHtml(parent?.name) || 'Unknown'}</small>
            </span>
          </div>

          <div class="budget-actions">
            <button class="action-btn edit-btn" data-id="${subcategory.id}" data-action="edit" title="Edit">✏️</button>
            <button class="action-btn delete-btn" data-id="${subcategory.id}" data-action="delete" title="Delete">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  function attachCategoryEventListeners() {
    // Handle action buttons
    catList.querySelectorAll('.action-btn').forEach(btn => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (action === 'edit') {
          openCatEditor(id);
        } else if (action === 'delete') {
          const category = categories.find(c => c.id === id);
          const childCount = categories.filter(c => c.parentId === id).length;
          
          let message = `Delete category "${category?.name}"?`;
          if (childCount > 0) {
            message += ` This will also delete ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}.`;
          }
          
          if (confirm(message)) {
            await deleteItem(STORE_NAMES.categories, id);
            // Delete subcategories
            const subs = categories.filter(s => s.parentId === id);
            for (const sub of subs) await deleteItem(STORE_NAMES.categories, sub.id);
            initCategoriesUI();
          }
        } else if (action === 'addSub') {
          openCatEditor(null, id);
        }
      });
    });

    // Toggle subcategories
    catList.querySelectorAll('.toggle-subcategories').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const list = document.getElementById(`sub-${id}`);
        if (!list) return;

        const isOpening = list.style.display === 'none';
        
        if (isOpening) {
          list.style.display = 'block';
          btn.textContent = btn.textContent.replace('Show', 'Hide');
        } else {
          list.style.display = 'none';
          btn.textContent = btn.textContent.replace('Hide', 'Show');
        }
      });
    });
  }

  // ========== RESET TO DEFAULTS ==========
  // Wipes the current category list and reseeds the simplified default set.
  // Any transaction or budget pointing at a category that no longer exists
  // afterwards is safely detached (never deleted or corrupted) so the app
  // stays consistent, then the existing "recheck categories" tool is
  // launched automatically so those transactions get freshly (and more
  // precisely) categorized under the new list in one review pass.
  async function resetToDefaultCategories() {
    const warning = 'This will delete ALL your current categories and restore ' +
      'the simplified default set.\n\n' +
      '• Transactions using a removed category will be marked Uncategorised ' +
      '(their date/amount/description/vendor are untouched)\n' +
      '• Budgets pointing at a removed category will be deleted\n' +
      '• You\'ll get a one-click review to re-categorize affected transactions ' +
      'against the new, cleaner rules\n\n' +
      'This cannot be undone. Continue?';

    if (!confirm(warning)) return;

    // 1) Delete all existing categories
    const existingCategories = await getAllItems(STORE_NAMES.categories);
    for (const category of existingCategories) {
      await deleteItem(STORE_NAMES.categories, category.id);
    }

    // 2) Add the new simplified default set
    await addDefaultCategories({
      getAllItems,
      addItem,
      STORE_NAMES
    });

    const validIds = new Set(DEFAULT_CATEGORIES.map(c => c.id));

    // 3) Detach transactions pointing at a category that no longer exists
    //    (leave everything else about the transaction untouched)
    const transactions = await getAllItems(STORE_NAMES.transactions).catch(() => []);
    let detachedCount = 0;
    for (const tx of transactions) {
      if (tx.categoryId && !validIds.has(tx.categoryId)) {
        await updateItem(STORE_NAMES.transactions, {
          ...tx,
          categoryId: null,
          categorySource: null
        });
        detachedCount++;
      }
    }

    // 4) Remove budgets pointing at a category that no longer exists
    const budgets = await getAllItems(STORE_NAMES.budgets).catch(() => []);
    let removedBudgets = 0;
    for (const budget of budgets) {
      if (budget.categoryId && !validIds.has(budget.categoryId)) {
        await deleteItem(STORE_NAMES.budgets, budget.id);
        removedBudgets++;
      }
    }

    await initCategoriesUI();

    if (detachedCount > 0) {
      // Kick off the existing recategorize review so the user can bulk-apply
      // fresh, precise suggestions for everything that just got detached.
      setTimeout(() => runRecategorizeCheck(null), 300);
    }

    alert(
      `Categories reset to the simplified default set.\n` +
      `${detachedCount} transaction(s) were uncategorized and ${removedBudgets} budget(s) removed ` +
      `because they referenced categories that no longer exist.` +
      (detachedCount > 0 ? '\n\nOpening the re-categorize review now...' : '')
    );
  }

  // ========== BUDGETS-STYLE CATEGORY EDITOR ==========
  async function openCatEditor(id = null, parentId = null) {
    const allCats = await getAllItems(STORE_NAMES.categories);
    const cat = id
      ? allCats.find(c => c.id === id)
      : { name: '', type: 'expense', parentId: parentId || null, icon: '' };

    const isSubcategory = parentId || (cat && cat.parentId);
    
    mainContent.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <h2>${id ? '✏️ Edit' : isSubcategory ? '➕ Add Subcategory' : '➕ Add Category'}</h2>
        </div>

        <div class="section-card">
          <form id="catForm" class="styled-form">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" name="name" value="${escapeHtml(cat.name)}" class="form-input" required placeholder="Enter category name">
            </div>

            <div class="form-group">
              <label class="form-label">Type</label>
              <select name="type" class="form-select" ${isSubcategory ? 'disabled' : ''}>
                <option value="expense" ${cat.type === 'expense' ? 'selected' : ''}>💸 Expense</option>
                <option value="income" ${cat.type === 'income' ? 'selected' : ''}>💰 Income</option>
              </select>
              ${isSubcategory ? '<small class="form-hint">Subcategories inherit type from parent</small>' : ''}
            </div>

            <div class="form-group">
              <label class="form-label">Icon</label>
              <div class="icon-input-group">
                <input type="text" name="icon" value="${escapeHtml(cat.icon) || ''}" class="form-input icon-input" placeholder="💡" maxlength="2">
                <button type="button" id="emojiBtn" class="btn btn-secondary">😀 Pick Emoji</button>
              </div>
              <small class="form-hint">Leave empty for auto-suggestion</small>
            </div>

            ${!isSubcategory ? `
              <div class="form-group">
                <label class="form-label">Parent Category</label>
                <select name="parentId" class="form-select">
                  <option value="">None (Main Category)</option>
                  ${allCats
                    .filter(c => !c.parentId && c.id !== id)
                    .map(c => `<option value="${c.id}" ${c.id === cat.parentId ? 'selected' : ''}>${c.icon || guessCategoryIcon(c.name)} ${escapeHtml(c.name)}</option>`)
                    .join('')}
                </select>
                <small class="form-hint">Select to make this a subcategory</small>
              </div>
            ` : `<input type="hidden" name="parentId" value="${parentId || cat.parentId}">`}

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">💾 ${id ? 'Update' : 'Add'} Category</button>
              <button type="button" id="cancelBtn" class="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = document.getElementById('catForm');
    const iconInput = form.icon;
    const nameInput = form.name;

    // Auto-suggest icon
    nameInput.addEventListener('input', e => {
      if (!iconInput.value.trim()) {
        iconInput.value = guessCategoryIcon(e.target.value);
      }
    });

    // Emoji picker
    setupEmojiPicker('#emojiBtn', 'input[name="icon"]');

    document.getElementById('cancelBtn').addEventListener('click', initCategoriesUI);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const formData = new FormData(form);
      
      const newCat = {
        id: cat.id || generateId(),
        name: formData.get('name').trim(),
        type: isSubcategory ? allCats.find(c => c.id === (parentId || cat.parentId))?.type || 'expense' : formData.get('type'),
        icon: formData.get('icon').trim() || guessCategoryIcon(formData.get('name')),
        parentId: isSubcategory ? (parentId || cat.parentId) : (formData.get('parentId') || null),
        createdAt: cat.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        if (id) {
          await updateItem(STORE_NAMES.categories, newCat);
        } else {
          await addItem(STORE_NAMES.categories, newCat);
        }
        initCategoriesUI();
      } catch (error) {
        alert('Error saving category: ' + error.message);
      }
    });
  }
}

// 🎨 Improved emoji guesser
function guessCategoryIcon(name = '') {
  const map = {
    // Income
    salary: '💵', income: '💰', business: '💼', freelance: '👨‍💻',
    investment: '📈', dividend: '📊', rental: '🏠', bonus: '🎁',
    refund: '🔄', gift: '🎁', government: '🏛️',
    
    // Expenses
    food: '🍽️', groceries: '🛒', restaurant: '🍕', coffee: '☕',
    utilities: '💡', electricity: '⚡', water: '💧', gas: '🔥',
    rent: '🏠', mortgage: '🏡', transport: '🚗', fuel: '⛽',
    car: '🚙', insurance: '🛡️', health: '⚕️', medical: '🏥',
    dental: '🦷', pharmacy: '💊', entertainment: '🎬', movies: '🎥',
    sports: '⚽', gym: '💪', shopping: '🛍️', clothes: '👕',
    electronics: '📱', gifts: '🎁', travel: '✈️', hotel: '🏨',
    education: '🎓', books: '📚', pets: '🐾', kids: '🧒',
    baby: '👶', maintenance: '🔧', fees: '💳', tax: '📝',
    charity: '❤️', savings: '💰', loan: '🏦'
  };
  
  const lowerName = name.toLowerCase();
  const key = Object.keys(map).find(k => lowerName.includes(k));
  return map[key] || (lowerName.includes('sub') ? '↪️' : '📁');
}

// ============================================================================
// CATEGORY HELPERS FOR UI
// ============================================================================

//import { getAllItems } from './db.js';

// Cache categories to avoid repeated DB calls
let _categoryCache = null;

async function loadCategoryCache() {
    if (_categoryCache === null) {
        _categoryCache = await getAllItems("categories");
    }
    return _categoryCache;
}

/**
 * Get a single category by ID
 */
export async function getCategoryById(id) {
    if (!id) return null;
    const cats = await loadCategoryCache();
    return cats.find(c => c.id === id) || null;
}

/**
 * Build full hierarchical path — e.g.:
 * Groceries → Indian Groceries → Malvic Grocery
 */
export async function getCategoryPath(id) {
    const cats = await loadCategoryCache();
    const path = [];

    let current = cats.find(c => c.id === id);
    while (current) {
        path.unshift(current.name);
        current = cats.find(c => c.id === current.parentId);
    }

    return path;
}

/**
 * The UI calls this — MUST exist.
 * Example output: "Groceries / Indian Groceries"
 */
export async function getFullCategoryName(id) {
    if (!id) return "Uncategorised";
    const path = await getCategoryPath(id);
    return path.length ? path.join(" / ") : "Uncategorised";
}
