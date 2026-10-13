// ============================================================================
// records.js — the ONE place that builds an account / property record
// ----------------------------------------------------------------------------
// Used by the Accounts page, the Properties page AND the first-run setup
// guide (onboarding.js), so anything added through the guide is identical to
// anything added normally. Pure functions: no DOM, no database, so they are
// unit-tested in tests/records.test.js.
// ============================================================================

const nowIso = now => (now instanceof Date ? now : new Date()).toISOString();

// fields: name, type, openingBalance, currency, institution, institutionName,
//         last4, creditLimit, statementCloseDay, statementDueDay,
//         linkedLoanId, linkedPropertyId (all optional except name/type)
// opts:   id (required), createdAt (keep the original when editing), now
export function buildAccountRecord(fields, { id, createdAt, now } = {}) {
  const f = fields || {};
  const acc = {
    ...(id ? { id } : {}),   // the setup guide leaves it out and lets addItem() assign one
    name: String(f.name ?? '').trim(),
    type: f.type,
    openingBalance: parseFloat(f.openingBalance),
    currency: f.currency,
    institution: f.institution || '',
    institutionName: f.institution === 'other' ? String(f.institutionName ?? '').trim() : '',
    last4: String(f.last4 ?? '').replace(/\D/g, '').slice(0, 4),
    createdAt: createdAt || nowIso(now),
    updatedAt: nowIso(now)
  };

  if (acc.type === 'credit') {
    acc.creditLimit = parseFloat(f.creditLimit) || 0;
    const closeDay = parseInt(f.statementCloseDay, 10);
    acc.statementCloseDay = (closeDay >= 1 && closeDay <= 31) ? closeDay : null;
    const dueDay = parseInt(f.statementDueDay, 10);
    acc.statementDueDay = (dueDay >= 1 && dueDay <= 31) ? dueDay : null;
  }

  if (acc.type === 'offset') {
    acc.linkedLoanId = f.linkedLoanId || '';
  }

  acc.linkedPropertyId = f.linkedPropertyId || '';
  return acc;
}

// fields: name, address, propertyType, currency, purchasePrice, currentValue,
//         rent, mortgage, outstandingLoanBalance
// opts:   id (required), existing (the saved record when editing, so fields
//         set elsewhere are kept), isEdit, now
export function buildPropertyRecord(fields, { id, existing = {}, isEdit = false, now } = {}) {
  const f = fields || {};
  const type = f.propertyType;
  return {
    ...existing,
    ...(id ? { id } : {}),
    currency: f.currency || 'AUD',
    name: f.name,
    address: f.address,
    purchasePrice: parseFloat(f.purchasePrice) || 0,
    currentValue: parseFloat(f.currentValue) || 0,
    propertyType: type,
    rent: type !== 'primary' ? parseFloat(f.rent) || 0 : 0,
    mortgage: type === 'primary' ? parseFloat(f.mortgage) || 0 : 0,
    outstandingLoanBalance: type === 'primary' ? parseFloat(f.outstandingLoanBalance) || 0 : 0,
    createdAt: isEdit ? existing.createdAt : nowIso(now),
    updatedAt: nowIso(now)
  };
}
