import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_MAX_PER_HOUR = 3;
export const BCRYPT_COST = 12;

/** Same rules as SignupSchema.password. */
export const NewPasswordSchema = z
  .string()
  .min(8, "At least 8 characters.")
  .regex(/[a-zA-Z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

export function generateResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function resetExpiry(now = Date.now()) {
  return new Date(now + RESET_TTL_MS);
}

export function isResetUsable(row: { expiresAt: Date; usedAt: Date | null }, now = Date.now()) {
  return !row.usedAt && row.expiresAt.getTime() > now;
}
