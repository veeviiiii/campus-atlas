// Opens what lib/seal.ts locked, in the browser (WebCrypto). A wrong password gives null.

export interface Sealed {
  v: 1;
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64: ciphertext then the 16-byte GCM tag
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function unseal(sealed: Sealed, password: string): Promise<string | null> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(sealed.salt), iterations: sealed.iterations, hash: "SHA-256" },
    base,
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
