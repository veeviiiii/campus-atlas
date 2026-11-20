// /admin/'s data is built into a public static page, so it is locked with the maintainer's password
// (ADMIN_PASSWORD, set in Vercel; never NEXT_PUBLIC_): AES-256-GCM, with a key made in two steps (see
// lib/unseal.ts): PBKDF2 stretches the password into the device key, then HKDF mixes in this build's
// salt. Without the password the page holds only noise. Sealed at build time in Node; opened in the
// browser by lib/unseal.ts.

import { createCipheriv, hkdfSync, pbkdf2Sync, randomBytes } from "node:crypto";

import { DEVICE_SALT, REPORT_INFO, type Sealed } from "./unseal";

export const ITERATIONS = 600_000; // PBKDF2-SHA256, OWASP's figure: slows down guessing a weak password

export function seal(text: string, password: string, iterations = ITERATIONS): Sealed {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const device = pbkdf2Sync(password, DEVICE_SALT, iterations, 32, "sha256");
  const key = Buffer.from(hkdfSync("sha256", device, salt, REPORT_INFO, 32));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]); // WebCrypto expects the tag at the end
  return { v: 2, iterations, salt: salt.toString("base64"), iv: iv.toString("base64"), data: data.toString("base64") };
}
