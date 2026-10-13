// ============================================================================
// 🧰 maintenance.js — ENHANCED Property Maintenance Manager (FIXED)
// ============================================================================

import { getAllItems, addItem, updateItem, deleteItem, STORE_NAMES, generateId } from './db.js';
import { html } from './utils/html.js';
import { initPropertiesUI } from './properties.js';
import { escapeHtml } from './sanitize.js';

import { formatMoney, propertyCurrency, toBase } from './utils/currency.js';
// ============================================================================
// 🎯 Configuration
// ============================================================================
const MAINTENANCE_CATEGORIES = [
    'General', 'Plumbing', 'Electrical', 'Painting', 'Garden',
    'HVAC', 'Roofing', 'Appliances', 'Structural', 'Cleaning',
    'Pest Control', 'Landscaping', 'Security', 'Renovation', 'Other'
];

const MAINTENANCE_STATUSES = [
    'Reported', 'Scheduled', 'In Progress', 'Waiting Parts',
    'Completed', 'Cancelled', 'Follow-up Needed'
];

const PRIORITY_LEVELS = [
    { value: 'low', label: '🟢 Low', color: '#27ae60' },
    { value: 'medium', label: '🟡 Medium', color: '#f39c12' },
    { value: 'high', label: '🔴 High', color: '#e74c3c' },
    { value: 'emergency', label: '🚨 Emergency', color: '#c0392b' }
];

const RECURRENCE_OPTIONS = [
    { value: 'once', label: 'One-time' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' }
];

// ============================================================================
// 🔄 Data Migration for Existing Records
// ============================================================================
async function migrateMaintenanceData() {
    const logs = await getAllItems(STORE_NAMES.maintenance);
    let needsMigration = false;
    
    const migratedLogs = logs.map(log => {
        const migrated = { ...log };
        
        // Add missing fields with default values
        if (!migrated.category) {
            migrated.category = 'General';
            needsMigration = true;
        }
        if (!migrated.priority) {
            migrated.priority = 'medium';
            needsMigration = true;
        }
        if (!migrated.status) {
            migrated.status = 'Reported';
            needsMigration = true;
        }
        if (!migrated.cost) {
            migrated.cost = 0;
            needsMigration = true;
        }
        if (!migrated.date) {
            migrated.date = new Date().toISOString().split('T')[0];
            needsMigration = true;
        }
        if (!migrated.images) {
            migrated.images = [];
            needsMigration = true;
        }
        
        return migrated;
    });
    
    // Save migrated data back to database
    if (needsMigration) {
        for (const log of migratedLogs) {
            await updateItem(STORE_NAMES.maintenance, log);
        }
    }
    
    return migratedLogs;
}

// ============================================================================
// 🏗️ Initialize Enhanced Maintenance UI
// ============================================================================
export async function initMaintenanceUI(propertyId = null) {
    const main = document.getElementById('mainContent');

    // Migrate data first to ensure all records have required fields
    await migrateMaintenanceData();

    const properties = await getAllItems(STORE_NAMES.properties);
    const currentProperty = propertyId ? properties.find(p => p.id === propertyId) : null;

    main.innerHTML = `
        <div class="maintenance-container">
            <!-- Header -->
            <div class="maintenance-header">
                <div class="header-title">
                    <h2>🧰 Maintenance Manager</h2>
                    ${currentProperty ? `
                        <div class="property-context">
                            <span class="context-label">For:</span>
                            <span class="property-name">${escapeHtml(currentProperty.name)}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="header-actions">
                    <button id="btnNewMaintenance" class="btn btn-primary">
                        ➕ Add Maintenance
                    </button>
                    ${propertyId ? `
                        <button id="btnBackToProperties" class="btn btn-secondary">
                            ⬅️ Back to Property
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- Statistics Dashboard -->
            <div id="maintenanceStats" class="maintenance-stats"></div>

            <!-- Filters and Controls -->
            <div class="maintenance-controls">
                <div class="control-group">
                    <input type="text" id="searchMaintenance" class="form-input search-input" 
                           placeholder="🔍 Search maintenance records...">
                </div>
                <div class="control-group">
                    <select id="filterStatus" class="form-select">
                        <option value="all">All Status</option>
                        ${MAINTENANCE_STATUSES.map(status => 
                            `<option value="${status}">${status}</option>`
                        ).join('')}
                    </select>
                    <select id="filterCategory" class="form-select">
                        <option value="all">All Categories</option>
                        ${MAINTENANCE_CATEGORIES.map(cat => 
                            `<option value="${cat}">${cat}</option>`
                        ).join('')}
                    </select>
                    <select id="filterPriority" class="form-select">
                        <option value="all">All Priorities</option>
                        ${PRIORITY_LEVELS.map(p => 
                            `<option value="${p.value}">${p.label}</option>`
                        ).join('')}
                    </select>
                    <select id="sortMaintenance" class="form-select">
                        <option value="date-desc">Newest First</option>
                        <option value="date-asc">Oldest First</option>
                        <option value="cost-desc">Highest Cost</option>
                        <option value="cost-asc">Lowest Cost</option>
                        <option value="priority">Priority</option>
                    </select>
                </div>
            </div>

            <!-- Maintenance List -->
            <div id="maintenanceList" class="maintenance-list">
                <div class="loading-spinner">Loading maintenance records...</div>
            </div>
        </div>

        <!-- Maintenance Modal -->
        <div id="maintenanceModal" class="modal-overlay" style="display: none;">
            <div class="modal modal-large">
                <div class="modal-header">
                    <h3 id="modalTitle">Add Maintenance Record</h3>
                    <button class="btn-close" id="closeModal">✕</button>
                </div>
                <div class="modal-body">
                    <form id="maintenanceForm" class="modal-form"></form>
                </div>
            </div>
        </div>
    `;

    // Event Listeners
    if (propertyId) {
        document.getElementById('btnBackToProperties')?.addEventListener('click', () => initPropertiesUI());
    }

    document.getElementById('btnNewMaintenance')?.addEventListener('click', () => openMaintenanceModal(propertyId));
    
    // Filter and Search Events
    document.getElementById('filterStatus')?.addEventListener('change', () => refreshMaintenanceList(propertyId));
    document.getElementById('filterCategory')?.addEventListener('change', () => refreshMaintenanceList(propertyId));
    document.getElementById('filterPriority')?.addEventListener('change', () => refreshMaintenanceList(propertyId));
    document.getElementById('sortMaintenance')?.addEventListener('change', () => refreshMaintenanceList(propertyId));
    document.getElementById('searchMaintenance')?.addEventListener('input', debounce(() => refreshMaintenanceList(propertyId), 300));

    await refreshMaintenanceList(propertyId);
    setupModalEvents(propertyId);
}

// ============================================================================
// 📊 Statistics Dashboard
// ============================================================================
async function renderMaintenanceStats(propertyId = null) {
    let logs = await getAllItems(STORE_NAMES.maintenance);
    logs = await migrateMaintenanceData(); // Use migrated data
    
    const filtered = propertyId ? logs.filter(l => l.propertyId === propertyId) : logs;

    // A maintenance cost is in its property's currency. Across properties the totals are in the base
    // currency; filtered to one property they're in that property's own currency.
    const allProps = await getAllItems(STORE_NAMES.properties);
    const curOfLog = log => propertyCurrency(allProps.find(p => p.id === log.propertyId));
    const statCur = propertyId ? propertyCurrency(allProps.find(p => p.id === propertyId)) : undefined;
    const costOf = log => propertyId ? (parseFloat(log.cost) || 0) : toBase(parseFloat(log.cost) || 0, curOfLog(log));

    const totalCost = filtered.reduce((sum, log) => sum + costOf(log), 0);
    const completed = filtered.filter(log => (log.status || 'Reported') === 'Completed').length;
    const pending = filtered.filter(log => (log.status || 'Reported') !== 'Completed').length;
    const highPriority = filtered.filter(log => 
        (log.priority || 'medium') === 'high' || (log.priority || 'medium') === 'emergency'
    ).length;
    
    const thisYear = new Date().getFullYear();
    const ytdCost = filtered
        .filter(log => new Date(log.date || new Date()).getFullYear() === thisYear)
        .reduce((sum, log) => sum + costOf(log), 0);

    const statsContainer = document.getElementById('maintenanceStats');
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="stats-grid page-compact-cards">
                <div class="stat-card total">
                    <div class="stat-icon">📋</div>
                    <div class="stat-content">
                        <div class="stat-value">${filtered.length}</div>
                        <div class="stat-label">Total Records</div>
                    </div>
                </div>
                <div class="stat-card cost">
                    <div class="stat-icon">💰</div>
                    <div class="stat-content">
                        <div class="stat-value">${formatCurrency(totalCost, statCur)}</div>
                        <div class="stat-label">Total Maintenance</div>
                        <div class="stat-subtext">${formatCurrency(ytdCost, statCur)} YTD</div>
                    </div>
                </div>
                <div class="stat-card completed">
                    <div class="stat-icon">✅</div>
                    <div class="stat-content">
                        <div class="stat-value">${completed}</div>
                        <div class="stat-label">Completed</div>
                        <div class="stat-subtext">${pending} pending</div>
                    </div>
                </div>
                <div class="stat-card priority">
                    <div class="stat-icon">🚨</div>
                    <div class="stat-content">
                        <div class="stat-value">${highPriority}</div>
                        <div class="stat-label">High Priority</div>
                        <div class="stat-subtext">Needs attention</div>
                    </div>
                </div>
            </div>
        `;
    }
}

// ============================================================================
// 🔄 Refresh Maintenance List with Filtering
// ============================================================================
async function refreshMaintenanceList(propertyId = null) {
    let logs = await getAllItems(STORE_NAMES.maintenance);
    const properties = await getAllItems(STORE_NAMES.properties);
    
    // Migrate existing data if needed
    logs = await migrateMaintenanceData();
    
    let filtered = propertyId ? logs.filter(l => l.propertyId === propertyId) : logs;
    
    // Apply filters with safe property access
    const statusFilter = document.getElementById('filterStatus')?.value || 'all';
    const categoryFilter = document.getElementById('filterCategory')?.value || 'all';
    const priorityFilter = document.getElementById('filterPriority')?.value || 'all';
    const searchTerm = document.getElementById('searchMaintenance')?.value.toLowerCase() || '';
    const sortBy = document.getElementById('sortMaintenance')?.value || 'date-desc';

    if (statusFilter !== 'all') {
        filtered = filtered.filter(log => (log.status || 'Reported') === statusFilter);
    }
    
    if (categoryFilter !== 'all') {
        filtered = filtered.filter(log => (log.category || 'General') === categoryFilter);
    }
    
    if (priorityFilter !== 'all') {
        filtered = filtered.filter(log => (log.priority || 'medium') === priorityFilter);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(log => 
            (log.title || '').toLowerCase().includes(searchTerm) ||
            (log.description || '').toLowerCase().includes(searchTerm) ||
            (log.vendor || '').toLowerCase().includes(searchTerm)
        );
    }

    // Apply sorting
    filtered = sortMaintenanceRecords(filtered, sortBy);

    const list = document.getElementById('maintenanceList');

    if (!filtered.length) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔧</div>
                <h3>No Maintenance Records</h3>
                <p>No maintenance records found matching your criteria.</p>
                <button class="btn btn-primary" id="emptyAddMaintenance">Add First Maintenance Record</button>
            </div>
        `;
        document.getElementById('emptyAddMaintenance')?.addEventListener('click', () => openMaintenanceModal(propertyId));
        return;
    }

    list.innerHTML = `
        <div class="maintenance-grid">
            ${filtered.map(log => renderMaintenanceCard(log, properties)).join('')}
        </div>
    `;

    // Attach event listeners to action buttons
    list.querySelectorAll('.maintenance-action-btn').forEach(btn => {
        const { id, action } = btn.dataset;
        if (action === 'edit') btn.onclick = () => openMaintenanceModal(null, id);
        if (action === 'delete') btn.onclick = () => confirmDeleteMaintenance(id, propertyId);
    });

    // Update statistics
    await renderMaintenanceStats(propertyId);
}

// ============================================================================
// 🧾 Enhanced Maintenance Card (FIXED - Safe Property Access)
// ============================================================================
function renderMaintenanceCard(log, properties) {
    const property = properties.find(p => p.id === log.propertyId);
    const priorityConfig = PRIORITY_LEVELS.find(p => p.value === (log.priority || 'medium'));
    const statusConfig = getStatusConfig(log.status);
    
    // Safe category handling - FIXED THE ERROR HERE
    const category = log.category || 'General';
    const safeCategory = category.toLowerCase().replace(/[^a-z0-9]/g, '-');

    return html`
        <div class="maintenance-card priority-${log.priority || 'medium'}">
            <div class="maintenance-card-header">
                <div class="maintenance-title-section">
                    <h3 class="maintenance-title">${escapeHtml(log.title) || 'Untitled Maintenance'}</h3>
                    <div class="maintenance-meta">
                        <span class="maintenance-date">${new Date(log.date || new Date()).toLocaleDateString()}</span>
                        ${log.dueDate ? `
                            <span class="due-date ${isOverdue(log.dueDate) ? 'overdue' : ''}">
                                📅 Due: ${new Date(log.dueDate).toLocaleDateString()}
                            </span>
                        ` : ''}
                    </div>
                </div>
                <div class="maintenance-badges">
                    <span class="priority-badge" style="background: ${priorityConfig?.color || '#95a5a6'}">
                        ${priorityConfig?.label || '🟡 Medium'}
                    </span>
                    <span class="status-badge" style="color: ${statusConfig.color}">
                        ${statusConfig.icon} ${log.status || 'Reported'}
                    </span>
                </div>
            </div>

            <div class="maintenance-card-body">
                <div class="maintenance-details-grid">
                    <div class="detail-item">
                        <span class="detail-label">📍 Property:</span>
                        <span class="detail-value">${property ? escapeHtml(property.name) : 'Unknown Property'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">📂 Category:</span>
                        <span class="detail-value category-${safeCategory}">${escapeHtml(category)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">💰 Cost:</span>
                        <span class="detail-value cost">${formatCurrency(log.cost || 0, propertyCurrency(property))}</span>
                    </div>
                    ${log.vendor ? `
                        <div class="detail-item">
                            <span class="detail-label">👤 Vendor:</span>
                            <span class="detail-value">${escapeHtml(log.vendor)}</span>
                        </div>
                    ` : ''}
                    ${log.recurrence && log.recurrence !== 'once' ? `
                        <div class="detail-item">
                            <span class="detail-label">🔄 Recurrence:</span>
                            <span class="detail-value">${getRecurrenceLabel(log.recurrence)}</span>
                        </div>
                    ` : ''}
                </div>

                ${log.description ? `
                    <div class="maintenance-description">
                        <p>${escapeHtml(log.description)}</p>
                    </div>
                ` : ''}

                ${log.images && log.images.length > 0 ? `
                    <div class="maintenance-images-preview">
                        <div class="images-count">📷 ${log.images.length} photo(s)</div>
                    </div>
                ` : ''}
            </div>

            <div class="maintenance-card-actions">
                <button class="btn-action edit maintenance-action-btn" data-id="${log.id}" data-action="edit" title="Edit">
                    ✏️ Edit
                </button>
                <button class="btn-action delete maintenance-action-btn" data-id="${log.id}" data-action="delete" title="Delete">
                    🗑️ Delete
                </button>
            </div>
        </div>
    `;
}

// ============================================================================
// 🎪 Maintenance Modal Form
// ============================================================================
async function openMaintenanceModal(propertyId = null, maintenanceId = null) {
    const properties = await getAllItems(STORE_NAMES.properties);
    let log = maintenanceId ? 
        (await getAllItems(STORE_NAMES.maintenance)).find(l => l.id === maintenanceId) : null;

    if (!log) {
        log = {
            id: null,
            propertyId: propertyId || '',
            title: '',
            description: '',
            category: 'General',
            cost: 0,
            date: new Date().toISOString().split('T')[0],
            dueDate: '',
            status: 'Reported',
            priority: 'medium',
            vendor: '',
            vendorContact: '',
            recurrence: 'once',
            reminder: 'none',
            images: []
        };
    }

    const modal = document.getElementById('maintenanceModal');
    const form = document.getElementById('maintenanceForm');
    const title = document.getElementById('modalTitle');

    title.textContent = maintenanceId ? 'Edit Maintenance Record' : 'Add Maintenance Record';
    
    form.innerHTML = `
        <input type="hidden" id="editMaintenanceId" value="${log.id || ''}">
        
        <div class="form-row">
            <div class="form-group">
                <label>🏠 Property *</label>
                <select name="propertyId" class="form-select" required>
                    <option value="">-- Select Property --</option>
                    ${properties.map(p => 
                        `<option value="${p.id}" ${p.id === log.propertyId ? 'selected' : ''}>
                            ${escapeHtml(p.name)}
                        </option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>📂 Category</label>
                <select name="category" class="form-select">
                    ${MAINTENANCE_CATEGORIES.map(cat => 
                        `<option value="${cat}" ${cat === (log.category || 'General') ? 'selected' : ''}>
                            ${cat}
                        </option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <div class="form-group">
            <label>📝 Title *</label>
            <input type="text" name="title" value="${escapeHtml(log.title) || ''}" 
                   placeholder="Brief description of maintenance needed" required>
        </div>

        <div class="form-group">
            <label>📋 Description</label>
            <textarea name="description" rows="3" 
                      placeholder="Detailed description of the issue, work needed, etc.">${escapeHtml(log.description) || ''}</textarea>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label>💰 Cost (AUD)</label>
                <input type="number" step="0.01" name="cost" value="${log.cost || 0}" 
                       placeholder="0.00">
            </div>
            <div class="form-group">
                <label>📅 Date *</label>
                <input type="date" name="date" value="${log.date || new Date().toISOString().split('T')[0]}" required>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label>🚨 Priority</label>
                <select name="priority" class="form-select">
                    ${PRIORITY_LEVELS.map(p => 
                        `<option value="${p.value}" ${p.value === (log.priority || 'medium') ? 'selected' : ''}>
                            ${p.label}
                        </option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>📊 Status</label>
                <select name="status" class="form-select">
                    ${MAINTENANCE_STATUSES.map(status => 
                        `<option value="${status}" ${status === (log.status || 'Reported') ? 'selected' : ''}>
                            ${status}
                        </option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label>📅 Due Date</label>
                <input type="date" name="dueDate" value="${log.dueDate || ''}">
            </div>
            <div class="form-group">
                <label>🔄 Recurrence</label>
                <select name="recurrence" class="form-select">
                    ${RECURRENCE_OPTIONS.map(opt => 
                        `<option value="${opt.value}" ${opt.value === (log.recurrence || 'once') ? 'selected' : ''}>
                            ${opt.label}
                        </option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label>👤 Vendor/Contractor</label>
                <input type="text" name="vendor" value="${log.vendor || ''}" 
                       placeholder="Company or individual name">
            </div>
            <div class="form-group">
                <label>📞 Contact Info</label>
                <input type="text" name="vendorContact" value="${log.vendorContact || ''}" 
                       placeholder="Phone, email, or reference">
            </div>
        </div>

        <div class="form-group">
            <label>🖼️ Photos/Documents</label>
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx" 
                   id="maintenanceFiles" class="form-input">
            <div id="filePreview" class="file-preview-container"></div>
            <small class="form-help">Upload photos, receipts, or documents related to this maintenance</small>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary">
                💾 Save Maintenance Record
            </button>
            <button type="button" class="btn btn-secondary" id="cancelMaintenance">
                Cancel
            </button>
        </div>
    `;

    // Setup file preview
    setupFilePreview(log.images || []);

    modal.style.display = 'flex';
}

// ============================================================================
// 🎯 Helper Functions
// ============================================================================
function getStatusConfig(status) {
    const safeStatus = status || 'Reported';
    const configs = {
        'Reported': { icon: '📋', color: '#3498db' },
        'Scheduled': { icon: '📅', color: '#9b59b6' },
        'In Progress': { icon: '🔧', color: '#f39c12' },
        'Waiting Parts': { icon: '⏳', color: '#e67e22' },
        'Completed': { icon: '✅', color: '#27ae60' },
        'Cancelled': { icon: '❌', color: '#95a5a6' },
        'Follow-up Needed': { icon: '🔔', color: '#e74c3c' }
    };
    return configs[safeStatus] || configs.Reported;
}

function getRecurrenceLabel(recurrence) {
    const labels = {
        'once': 'One-time',
        'monthly': 'Monthly',
        'quarterly': 'Quarterly',
        'yearly': 'Yearly'
    };
    return labels[recurrence] || recurrence;
}

function isOverdue(dueDate) {
    return dueDate && new Date(dueDate) < new Date();
}

function sortMaintenanceRecords(records, sortBy) {
    return [...records].sort((a, b) => {
        switch (sortBy) {
            case 'date-desc':
                return new Date(b.date || new Date()) - new Date(a.date || new Date());
            case 'date-asc':
                return new Date(a.date || new Date()) - new Date(b.date || new Date());
            case 'cost-desc':
                return (parseFloat(b.cost) || 0) - (parseFloat(a.cost) || 0);
            case 'cost-asc':
                return (parseFloat(a.cost) || 0) - (parseFloat(b.cost) || 0);
            case 'priority':
                const priorityOrder = { emergency: 0, high: 1, medium: 2, low: 3 };
                return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
            default:
                return new Date(b.date || new Date()) - new Date(a.date || new Date());
        }
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================================================
// 🖼️ File Preview Handling
// ============================================================================
function setupFilePreview(existingImages = []) {
    const fileInput = document.getElementById('maintenanceFiles');
    const preview = document.getElementById('filePreview');
    
    if (!fileInput || !preview) return;
    
    // Show existing images
    preview.innerHTML = existingImages.map((img, index) => `
        <div class="file-preview-item">
            <img src="${img}" alt="Preview ${index + 1}">
            <button type="button" class="btn-remove-file" data-index="${index}">✕</button>
        </div>
    `).join('');

    fileInput.addEventListener('change', (e) => {
        Array.from(e.target.files).forEach(file => {
            if (!file.type.startsWith('image/')) {
                // Handle non-image files differently
                const fileItem = document.createElement('div');
                fileItem.className = 'file-preview-item document';
                fileItem.innerHTML = `
                    <div class="file-icon">📄</div>
                    <div class="file-name">${escapeHtml(file.name)}</div>
                    <button type="button" class="btn-remove-file">✕</button>
                `;
                preview.appendChild(fileItem);
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-preview-item';
                fileItem.innerHTML = `
                    <img src="${e.target.result}" alt="Preview">
                    <button type="button" class="btn-remove-file">✕</button>
                `;
                preview.appendChild(fileItem);
            };
            reader.readAsDataURL(file);
        });
    });

    // Remove file handler
    preview.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove-file')) {
            e.target.closest('.file-preview-item').remove();
        }
    });
}

// ============================================================================
// 💾 Save Maintenance Record
// ============================================================================
async function saveMaintenanceRecord(propertyId) {
    const form = document.getElementById('maintenanceForm');
    if (!form) return;

    const formData = new FormData(form);
    const maintenanceId = document.getElementById('editMaintenanceId')?.value;

    // Get files from preview
    const filePreviews = document.getElementById('filePreview');
    const imageElements = filePreviews?.querySelectorAll('.file-preview-item img') || [];
    const images = Array.from(imageElements).map(img => img.src);

    const maintenanceData = {
        id: maintenanceId || generateId(),
        propertyId: formData.get('propertyId'),
        title: formData.get('title').trim(),
        description: formData.get('description').trim(),
        category: formData.get('category'),
        cost: parseFloat(formData.get('cost') || 0),
        date: formData.get('date'),
        dueDate: formData.get('dueDate') || null,
        status: formData.get('status'),
        priority: formData.get('priority'),
        vendor: formData.get('vendor').trim() || null,
        vendorContact: formData.get('vendorContact').trim() || null,
        recurrence: formData.get('recurrence'),
        reminder: formData.get('reminder') || 'none',
        images: images,
        createdAt: maintenanceId ? 
            (await getAllItems(STORE_NAMES.maintenance)).find(m => m.id === maintenanceId)?.createdAt : 
            new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    try {
        if (maintenanceId) {
            await updateItem(STORE_NAMES.maintenance, maintenanceData);
        } else {
            await addItem(STORE_NAMES.maintenance, maintenanceData);
        }

        // Sync with transactions
        await syncMaintenanceToTransaction(maintenanceData);

        // Close modal and refresh
        document.getElementById('maintenanceModal').style.display = 'none';
        await refreshMaintenanceList(propertyId);
        
    } catch (err) {
        console.error('❌ Error saving maintenance:', err);
        alert('Error saving maintenance record. Please try again.');
    }
}

// ============================================================================
// 🔄 Sync Maintenance to Transactions
// ============================================================================
async function syncMaintenanceToTransaction(log) {
    if (!log.cost || log.cost <= 0) return;

    const txs = await getAllItems(STORE_NAMES.transactions);
    const existing = txs.find(t => t.maintenanceId === log.id);

    const transaction = {
        id: existing?.id || generateId(),
        maintenanceId: log.id,
        type: 'expense',
        categoryId: `maintenance-${(log.category || 'General').toLowerCase()}`,
        description: log.title,
        amount: parseFloat(log.cost) || 0,
        date: log.date,
        propertyId: log.propertyId,
        notes: `Maintenance: ${log.description || 'No description'}`,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (existing) {
        await updateItem(STORE_NAMES.transactions, transaction);
    } else {
        await addItem(STORE_NAMES.transactions, transaction);
    }
}

// ============================================================================
// ❌ Delete Maintenance
// ============================================================================
async function confirmDeleteMaintenance(id, propertyId = null) {
    if (!confirm('Are you sure you want to delete this maintenance record? This will also remove the linked transaction.')) {
        return;
    }

    try {
        await deleteItem(STORE_NAMES.maintenance, id);

        // Remove linked transaction
        const txs = await getAllItems(STORE_NAMES.transactions);
        const linked = txs.find(t => t.maintenanceId === id);
        if (linked) {
            await deleteItem(STORE_NAMES.transactions, linked.id);
        }

        await refreshMaintenanceList(propertyId);
    } catch (err) {
        console.error('❌ Error deleting maintenance:', err);
        alert('Error deleting maintenance record.');
    }
}

// ============================================================================
// 🎪 Modal Event Handling
// ============================================================================
function setupModalEvents(propertyId) {
    const modal = document.getElementById('maintenanceModal');
    const form = document.getElementById('maintenanceForm');
    const closeBtn = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelMaintenance');

    [closeBtn, cancelBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveMaintenanceRecord(propertyId);
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// ============================================================================
// 💰 Utility: Format Currency
// ============================================================================
function formatCurrency(amount, currency) {
    // no currency given → base (the cross-property totals); per-record callers pass the property's.
    return formatMoney(amount, currency);
}

// ============================================================================
// 📋 Export for Properties Integration
// ============================================================================
export async function getPropertyMaintenanceSummary(propertyId) {
    const logs = await getAllItems(STORE_NAMES.maintenance);
    const propertyLogs = logs.filter(log => log.propertyId === propertyId);
    
    const totalCost = propertyLogs.reduce((sum, log) => sum + (parseFloat(log.cost) || 0), 0);
    const pendingCount = propertyLogs.filter(log => log.status !== 'Completed').length;
    const currentYear = new Date().getFullYear();
    const ytdCost = propertyLogs
        .filter(log => new Date(log.date || new Date()).getFullYear() === currentYear)
        .reduce((sum, log) => sum + (parseFloat(log.cost) || 0), 0);

    return {
        totalRecords: propertyLogs.length,
        totalCost,
        ytdCost,
        pendingCount,
        recentLogs: propertyLogs.slice(0, 5) // Last 5 maintenance records
    };
}