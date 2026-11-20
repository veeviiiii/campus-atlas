// /admin/'s data is built into a public static page, so it is locked with the maintainer's password
// (ADMIN_PASSWORD, set in Vercel; never NEXT_PUBLIC_): AES-256-GCM with a key stretched from the password
// by PBKDF2. Without the password the page holds only noise. Sealed at build time in Node; opened in
// the browser by lib/unseal.ts.

import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

import type { Sealed } from "./unseal";

export const ITERATIONS = 600_000; // PBKDF2-SHA256, OWASP's figure: slows down guessing a weak password

export function seal(text: string, password: string, iterations = ITERATIONS): Sealed {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]); // WebCrypto expects the tag at the end
  return { v: 1, iterations, salt: salt.toString("base64"), iv: iv.toString("base64"), data: data.toString("base64") };
}
