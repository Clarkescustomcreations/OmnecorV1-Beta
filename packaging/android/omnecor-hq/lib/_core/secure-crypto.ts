/**
 * Hardware-backed envelope encryption for the Omnecor Mobile HQ app.
 *
 * `expo-secure-store` stores values in the Android KeyStore / iOS Keychain but
 * caps each value at ~2048 bytes — too small for chat histories, which grow
 * without bound. So we use envelope encryption:
 *
 *   - A random 256-bit data-encryption key (DEK) lives in SecureStore (small,
 *     hardware-backed). It never leaves the KeyStore-protected store in plaintext.
 *   - Bulk payloads are encrypted with the DEK (AES-256-CBC, encrypt-then-HMAC
 *     SHA-256) and the ciphertext is stored anywhere convenient (AsyncStorage).
 *
 * Without the KeyStore-held DEK the at-rest ciphertext is unreadable, so an
 * attacker who dumps AsyncStorage (another app, adb backup, stolen device)
 * cannot recover chat contents or any other enveloped data.
 *
 * Randomness comes from `crypto.getRandomValues`, polyfilled app-wide by
 * `react-native-get-random-values` (imported in `app/_layout.tsx`). crypto-js's
 * `WordArray.random` uses it, so key/IV generation is cryptographically secure.
 */
import CryptoJS from "crypto-js";
import * as SecureStore from "expo-secure-store";

// SecureStore slot holding the base64 master key. Hardware-backed on device.
const DEK_KEY = "omnecor_dek_v1";
// Payload format tag so we can evolve the scheme later without ambiguity.
const FORMAT = "v1";

// In-memory cache of the derived sub-keys so we don't hit SecureStore on every
// encrypt/decrypt. Populated lazily from the persisted master key.
let _encKey: CryptoJS.lib.WordArray | null = null;
let _macKey: CryptoJS.lib.WordArray | null = null;

/**
 * Load the master DEK from the KeyStore, creating one on first use, and derive
 * independent encryption and MAC sub-keys from it (so the same key material is
 * never reused across the two primitives).
 */
async function getKeys(): Promise<{
  encKey: CryptoJS.lib.WordArray;
  macKey: CryptoJS.lib.WordArray;
}> {
  if (_encKey && _macKey) return { encKey: _encKey, macKey: _macKey };

  let masterB64 = await SecureStore.getItemAsync(DEK_KEY);
  if (!masterB64) {
    // 32 random bytes → base64. WordArray.random pulls from crypto.getRandomValues.
    masterB64 = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Base64);
    await SecureStore.setItemAsync(DEK_KEY, masterB64);
  }

  const master = CryptoJS.enc.Base64.parse(masterB64);
  // Domain-separated sub-keys: SHA-256(master || tag). Distinct keys for AES vs HMAC.
  _encKey = CryptoJS.SHA256(
    master.clone().concat(CryptoJS.enc.Utf8.parse("omnecor-enc")),
  );
  _macKey = CryptoJS.SHA256(
    master.clone().concat(CryptoJS.enc.Utf8.parse("omnecor-mac")),
  );
  return { encKey: _encKey, macKey: _macKey };
}

/** Constant-time-ish comparison of two hex strings to avoid MAC timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Encrypt a UTF-8 string. Returns `v1.<ivB64>.<ctB64>.<macHex>`.
 * AES-256-CBC + PKCS7, then HMAC-SHA256 over `iv.ct` (encrypt-then-MAC).
 */
export async function encryptString(plaintext: string): Promise<string> {
  const { encKey, macKey } = await getKeys();
  const iv = CryptoJS.lib.WordArray.random(16);
  const ct = CryptoJS.AES.encrypt(plaintext, encKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext;

  const ivB64 = iv.toString(CryptoJS.enc.Base64);
  const ctB64 = ct.toString(CryptoJS.enc.Base64);
  const mac = CryptoJS.HmacSHA256(`${ivB64}.${ctB64}`, macKey).toString(
    CryptoJS.enc.Hex,
  );
  return `${FORMAT}.${ivB64}.${ctB64}.${mac}`;
}

/**
 * Decrypt a payload produced by {@link encryptString}. Returns null on any
 * format mismatch, MAC failure (tamper/wrong key), or decode error — callers
 * treat that as "no data" and degrade gracefully.
 */
export async function decryptString(payload: string): Promise<string | null> {
  try {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== FORMAT) return null;
    const [, ivB64, ctB64, mac] = parts;

    const { encKey, macKey } = await getKeys();
    const expectedMac = CryptoJS.HmacSHA256(`${ivB64}.${ctB64}`, macKey).toString(
      CryptoJS.enc.Hex,
    );
    if (!safeEqual(mac, expectedMac)) return null; // tampered or wrong key

    const iv = CryptoJS.enc.Base64.parse(ivB64);
    const ciphertext = CryptoJS.enc.Base64.parse(ctB64);
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext }),
      encKey,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
    );
    const text = decrypted.toString(CryptoJS.enc.Utf8);
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Heuristic: does this string look like an {@link encryptString} payload? */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${FORMAT}.`) && value.split(".").length === 4;
}
