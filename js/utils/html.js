// ============================================================================
// ✨ html.js — Minimal HTML utility for tagged template literals
// ----------------------------------------------------------------------------
// Provides `html` (returns string) and `htmlToFragment` (returns DocumentFragment)
// Used by render functions to safely generate markup.
// ============================================================================

export function html(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
}

export function htmlToFragment(strings, ...values) {
  const template = document.createElement('template');
  template.innerHTML = html(strings, ...values);
  return template.content.cloneNode(true);
}
