// ============================================================================
// 🔐 backupCrypto.js — Password-based encryption for backup exports
// ============================================================================
// Uses Web Crypto SubtleCrypto only (no external dependency): PBKDF2 to
// derive a key from the user's password + a random salt, then AES-GCM to
// encrypt the backup JSON. Requires a secure context (https or localhost).
//
// HONESTY NOTE: this protects a backup FILE at rest (e.g. sitting in a
// cloud-synced folder). It does not change how data is stored inside the
// app itself — see appLock.js for that. If you forget the backup password,
// the data in that file is unrecoverable; there is no backdoor.
// ============================================================================

const PBKDF2_ITERATIONS = 250000; // deliberately high to slow down brute force
const SALT_BYTES = 16;
const IV_BYTES = 12; // recommended size for AES-GCM

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}

export function isSupported() {
  return !!(globalThis.crypto && globalThis.crypto.subtle);
}

async function deriveKey(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plain JS object into a self-describing envelope that
 * decryptJSON() can reverse given the same password.
 */
export async function encryptJSON(obj, password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const ivBytes = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, saltBytes, PBKDF2_ITERATIONS);

  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    plaintext
  );

  return {
    encrypted: true,
    kdf: 'PBKDF2',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToHex(saltBytes),
    iv: bytesToHex(ivBytes),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer))
  };
}

/**
 * Reverses encryptJSON(). Throws (with a clear message) if the password is
 * wrong or the payload is corrupted — AES-GCM's built-in authentication tag
 * makes wrong-password/corruption indistinguishable from each other, which
 * is expected and fine here.
 */
export async function decryptJSON(envelope, password) {
  if (!envelope || envelope.encrypted !== true) {
    throw new Error('Not an encrypted backup envelope');
  }
  const saltBytes = hexToBytes(envelope.salt);
  const ivBytes = hexToBytes(envelope.iv);
  const key = await deriveKey(password, saltBytes, envelope.iterations || PBKDF2_ITERATIONS);
  const ciphertextBytes = base64ToBytes(envelope.ciphertext);

  let plaintextBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      ciphertextBytes
    );
  } catch (err) {
    throw new Error('Incorrect password or corrupted backup file');
  }

  const plaintext = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(plaintext);
}
