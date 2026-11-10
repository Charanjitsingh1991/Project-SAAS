import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/*
 * AES-256-GCM for secrets stored in the database (per-workspace API keys of third-party services).
 * Key: ENCRYPTION_KEY if set, otherwise derived from SESSION_SECRET. Changing either makes stored
 * secrets unreadable, so set ENCRYPTION_KEY once in production and keep it.
 */

function key() {
  const base = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!base || base.length < 32) throw new Error("ENCRYPTION_KEY (or SESSION_SECRET) must be at least 32 characters.");
  return Buffer.from(hkdfSync("sha256", base, "saasmodels.tech", "org-secrets-v1", 32));
}

/** Returns "v1:<iv>:<tag>:<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(":");
}

/** Decrypts encryptSecret() output; returns null when it can't (wrong key or tampered). */
export function decryptSecret(stored: string | null | undefined) {
  if (!stored) return null;
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "rzp_live_…ab12" style hint for showing a stored secret without revealing it. */
export function secretHint(plain: string) {
  return plain.length <= 8 ? "••••" : `${plain.slice(0, 4)}…${plain.slice(-4)}`;
}
