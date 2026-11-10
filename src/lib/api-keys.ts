import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** Pure helpers for REST API keys (no DB access, safe to unit-test). */

export const API_KEY_PREFIX = "sm_live_";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SECRET_LEN = 32;
/** `sm_live_` + 4 secret chars, shown in the UI so keys are recognisable. */
const DISPLAY_PREFIX_LEN = API_KEY_PREFIX.length + 4;

const KEY_RE = new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{${SECRET_LEN}}$`);

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** New key: `sm_live_<32 base62>`. randomInt is unbiased, so every character is uniform. */
export function generateApiKey() {
  let secret = "";
  for (let i = 0; i < SECRET_LEN; i++) secret += BASE62[randomInt(BASE62.length)];
  const key = API_KEY_PREFIX + secret;
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LEN), hash: hashApiKey(key) };
}

export function isWellFormedApiKey(key: string) {
  return KEY_RE.test(key);
}

/** Extract the token from `Authorization: Bearer <key>` (scheme is case-insensitive). */
export function parseBearer(header: string | null | undefined) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ───────────── Pagination ───────────── */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function encodeCursor(id: number) {
  return Buffer.from(`id:${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): number | null {
  const m = /^id:(\d{1,15})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return m ? Number(m[1]) : null;
}

/** `?limit` (1–100, default 25) and opaque `?cursor`. Returns an error message for bad input. */
export function parsePagination(params: URLSearchParams): { limit: number; afterId: number | null } | { error: string } {
  const rawLimit = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null && rawLimit !== "") {
    if (!/^\d+$/.test(rawLimit)) return { error: "limit must be a positive integer." };
    limit = Number(rawLimit);
    if (limit < 1) return { error: "limit must be at least 1." };
    limit = Math.min(limit, MAX_LIMIT);
  }
  const rawCursor = params.get("cursor");
  let afterId: number | null = null;
  if (rawCursor) {
    afterId = decodeCursor(rawCursor);
    if (afterId === null) return { error: "cursor is invalid." };
  }
  return { limit, afterId };
}

/** Rows were fetched with limit + 1; trim and build the cursor for the next page. */
export function pageOf<T extends { id: number }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, hasMore, nextCursor: hasMore ? encodeCursor(data[data.length - 1].id) : null };
}

/* ───────────── Rate limit ───────────── */

export const RATE_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

export type RateState = Map<string | number, { start: number; count: number }>;

/**
 * Fixed-window counter. Best effort only: state lives in process memory, so on
 * serverless/multi-instance deployments each instance counts separately.
 */
export function hitRateLimit(state: RateState, key: string | number, now: number, limit = RATE_LIMIT_PER_MINUTE) {
  let w = state.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0 };
    state.set(key, w);
    if (state.size > 5000) for (const [k, v] of state) if (now - v.start >= WINDOW_MS) state.delete(k);
  }
  w.count += 1;
  const allowed = w.count <= limit;
  return { allowed, remaining: Math.max(0, limit - w.count), retryAfterSec: Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000)) };
}

/** lastUsedAt is written at most once a minute per key. */
export function shouldTouchLastUsed(lastUsed: Date | null, now: Date) {
  return !lastUsed || now.getTime() - lastUsed.getTime() >= WINDOW_MS;
}

/* ───────────── Validation helpers ───────────── */

/** Real calendar date in YYYY-MM-DD. */
export function isYmd(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
