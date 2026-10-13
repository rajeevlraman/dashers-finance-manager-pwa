// userName.js
//
// An optional name or nickname used only to personalise greetings ("Good
// morning, Sam"). It is stored in this browser only (localStorage), never in
// the database, so it is not synced to other family members, not sent anywhere,
// and each person on a shared device or server keeps their own.

export const NAME_KEY = 'dfm_display_name';
export const MAX_NAME_LENGTH = 30;

// Trim, collapse spaces, drop control characters and angle brackets, cap length.
export function cleanName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

export function getDisplayName(storage = globalThis.localStorage) {
  try { return cleanName(storage?.getItem(NAME_KEY)); } catch { return ''; }
}

// An empty name clears it. Returns the cleaned value that was stored.
export function setDisplayName(value, storage = globalThis.localStorage) {
  const name = cleanName(value);
  try {
    if (name) storage.setItem(NAME_KEY, name);
    else storage.removeItem(NAME_KEY);
  } catch { /* private mode: the greeting just stays generic */ }
  return name;
}

// "Good morning" + "Sam" + "!"  ->  "Good morning, Sam!"   (no name: "Good morning!")
export function greetWithName(greeting, name, punctuation = '') {
  return name ? `${greeting}, ${name}${punctuation}` : `${greeting}${punctuation}`;
}
