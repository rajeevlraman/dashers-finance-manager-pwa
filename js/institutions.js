// Shared list of financial institutions used to render realistic
// "plastic card" visuals on account and loan cards. Where we have an
// actual logo asset it's used; otherwise we fall back to a generated
// initials badge in the institution's brand-ish colors.

export const INSTITUTIONS = [
  { id: 'anz',       name: 'ANZ',              logo: 'assets/logos/ANZ.png' },
  { id: 'nab',       name: 'NAB',              logo: 'assets/logos/NAB.png' },
  { id: 'macquarie', name: 'Macquarie',        logo: 'assets/logos/macquaire.jpeg' },
  { id: 'cba',       name: 'CommBank',         initials: 'CBA',  badgeA: '#f7c948', badgeB: '#caa23a' },
  { id: 'westpac',   name: 'Westpac',          initials: 'WBC',  badgeA: '#d8102c', badgeB: '#8a0f22' },
  { id: 'bendigo',   name: 'Bendigo Bank',     initials: 'BEN',  badgeA: '#7a3a9c', badgeB: '#4a1f61' },
  { id: 'ing',       name: 'ING',              initials: 'ING',  badgeA: '#ff6a00', badgeB: '#cc4e00' },
  { id: 'ubank',     name: 'UBank',            initials: 'UB',   badgeA: '#14b8a6', badgeB: '#0d7d70' },
  { id: 'up',        name: 'Up',               initials: 'UP',   badgeA: '#ff4d8d', badgeB: '#e0246b' },
  { id: 'bankwest',  name: 'Bankwest',         initials: 'BW',   badgeA: '#2166ac', badgeB: '#123f73' },
  { id: 'suncorp',   name: 'Suncorp',          initials: 'SUN',  badgeA: '#f37021', badgeB: '#b8541a' },
  { id: 'stgeorge',  name: 'St.George',        initials: 'STG',  badgeA: '#2e8b57', badgeB: '#1e6b3f' },
  { id: 'boq',       name: 'Bank of Qld',      initials: 'BOQ',  badgeA: '#7a1f2b', badgeB: '#4f1219' },
  { id: 'hsbc',      name: 'HSBC',             initials: 'HSBC', badgeA: '#db0011', badgeB: '#a4000d' },
  { id: 'citi',      name: 'Citi',             initials: 'CITI', badgeA: '#1f6fd0', badgeB: '#134a8f' },
  { id: 'amex',      name: 'Amex',             initials: 'AMEX', badgeA: '#2e77bb', badgeB: '#1c4f80' },
  { id: 'orde',      name: 'ORDE Financial',   initials: 'ORDE', badgeA: '#1e293b', badgeB: '#0f172a' },
  { id: 'Mego',      name: 'Mego',             initials: 'MEGO', badgeA: '#1e293b', badgeB: '#0f172a' }, 
  { id: 'other',     name: 'Other',            initials: '',     badgeA: '#64748b', badgeB: '#334155' }
];

export function getInstitution(id) {
  return INSTITUTIONS.find(i => i.id === id) || null;
}

// Deterministic, purely cosmetic 4 digits derived from a string (e.g. an
// account id) so a card always has something to display in place of a
// real card number when the user hasn't set one. Not derived from any
// real account/card number.
export function pseudoLast4(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return String(h % 10000).padStart(4, '0');
}

// Renders the small logo/badge shown top-left of a card face.
export function renderInstitutionMark(institutionId, customName) {
  const inst = getInstitution(institutionId);
  if (inst && inst.logo) {
    return `<img class="institution-logo" src="${inst.logo}" alt="${inst.name}" loading="lazy">`;
  }
  const label = (inst && inst.id !== 'other') ? inst.initials : (customName || '').slice(0, 4).toUpperCase() || '🏦';
  const a = inst ? inst.badgeA : '#64748b';
  const b = inst ? inst.badgeB : '#334155';
  return `<div class="institution-badge" style="--badge-a:${a};--badge-b:${b};">${label}</div>`;
}

export function institutionDisplayName(institutionId, customName) {
  const inst = getInstitution(institutionId);
  if (!inst) return customName || '';
  if (inst.id === 'other') return customName || 'Other';
  return inst.name;
}

export function institutionOptions(selectedId) {
  return INSTITUTIONS.map(inst =>
    `<option value="${inst.id}" ${selectedId === inst.id ? 'selected' : ''}>${inst.name}</option>`
  ).join('');
}
