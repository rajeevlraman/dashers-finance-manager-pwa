// ============================================================================
// 🛡️ sanitize.js — Shared HTML-escaping utility
// ============================================================================
// Every "manager" module in this app builds its UI by interpolating data
// straight into innerHTML template strings. Free-text fields the user
// types (property/tenant/bill names, addresses, notes, descriptions...)
// were being inserted completely unescaped. In this app specifically, the
// realistic risk isn't a remote attacker (everything is local-only), it's:
//   - importing a backup/export file that came from somewhere else
//   - a shared/family device where one person's data could affect another
//     person's view of the app
//   - just typing something like `Rob's Storage <Unit 3>` and having the
//     "<Unit 3>" silently vanish because the browser treated it as a tag
// escapeHtml() should be used any time a user-entered string is interpolated
// into an innerHTML template. It does not need to be used for values you
// generated yourself (formatted currency, dates, ids, etc).
// ============================================================================

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}
