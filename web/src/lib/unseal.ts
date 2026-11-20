// Opens what lib/seal.ts locked, in the browser (WebCrypto). A wrong password gives null.
//
// Two steps, so that /admin/ can stay signed in across reloads and daily rebuilds: the password is
// stretched once (PBKDF2) with a salt that never changes, into the "device key"; each build then mixes in
// its own random salt (HKDF) for the key that locks that build's report. The browser keeps the device key
// (lib/admin-device.ts), never the password.

export interface Sealed {
  v: 2;
  iterations: number; // PBKDF2 rounds for the device key
  salt: string; // base64: this build's salt, for HKDF
  iv: string; // base64
  data: string; // base64: ciphertext then the 16-byte GCM tag
}

/** Same for every build, so one device key opens them all. Changing it signs every device out. */
export const DEVICE_SALT = "campus-atlas /admin/ device key";
export const REPORT_INFO = "campus-atlas /admin/ report";

const text = (s: string) => new TextEncoder().encode(s);
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The password, stretched. Not extractable: a script can use it to open the report, never read it out. */
export async function deviceKey(password: string, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", text(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: text(DEVICE_SALT), iterations, hash: "SHA-256" }, base, 256);
  return crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
}

export async function unsealWith(sealed: Sealed, device: CryptoKey): Promise<string | null> {
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bytes(sealed.salt), info: text(REPORT_INFO) },
    device,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, key, bytes(sealed.data));
    return new TextDecoder().decode(plain);
  } catch {
    return null; // wrong password (or a damaged page)
  }
}

export async function unseal(sealed: Sealed, password: string): Promise<string | null> {
  return unsealWith(sealed, await deviceKey(password, sealed.iterations));
}
