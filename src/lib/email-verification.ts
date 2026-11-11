import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_PER_HOUR = 5;

/** Signup limits per client IP. */
export const SIGNUP_MAX_PER_IP_HOUR = 5;
/** Failed log-ins before the email (or IP) is paused for the window. */
export const LOGIN_MAX_FAILS_PER_EMAIL = 8;
export const LOGIN_MAX_FAILS_PER_IP = 30;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function generateOtp() {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

/** Accepts "123 456", "123-456" etc. Returns null unless exactly six digits remain. */
export function normalizeOtp(input: string) {
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(digits) ? digits : null;
}

function secret() {
  return process.env.SESSION_SECRET || "dev-only-otp-secret";
}

/** Bound to the user so a stored hash can't be replayed for another account. */
export function hashOtp(userId: number, code: string) {
  return createHmac("sha256", secret()).update(`${userId}:${code}`).digest("hex");
}

export function otpMatches(userId: number, code: string, storedHash: string) {
  const a = Buffer.from(hashOtp(userId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function otpExpiry(now = Date.now()) {
  return new Date(now + OTP_TTL_MS);
}

export function isOtpUsable(row: { expiresAt: Date; usedAt: Date | null; attempts: number }, now = Date.now()) {
  return !row.usedAt && row.expiresAt.getTime() > now && row.attempts < OTP_MAX_ATTEMPTS;
}

/** Seconds until another code may be sent, given when the last one was created. */
export function resendWaitSec(lastCreatedAt: Date | null | undefined, now = Date.now()) {
  if (!lastCreatedAt) return 0;
  return Math.max(0, Math.ceil((lastCreatedAt.getTime() + OTP_RESEND_COOLDOWN_MS - now) / 1000));
}

/** Common throwaway-inbox providers. Not exhaustive; the emailed code is the real gate. */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "temp-mail.io",
  "tempr.email",
  "yopmail.com",
  "yopmail.net",
  "trashmail.com",
  "trashmail.de",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "throwawaymail.com",
  "fakeinbox.com",
  "mohmal.com",
  "emailondeck.com",
  "mintemail.com",
  "spamgourmet.com",
  "mailcatch.com",
  "moakt.com",
  "burnermail.io",
  "inboxkitten.com",
  "mail.tm",
  "1secmail.com",
  "dropmail.me",
  "emailfake.com",
]);

export function isDisposableEmail(email: string) {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return Boolean(domain && DISPOSABLE_DOMAINS.has(domain));
}

/** First address in X-Forwarded-For (set by Vercel), else X-Real-IP. */
export function clientIpFrom(h: { get(name: string): string | null }) {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || "unknown";
}
