import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeCursor, encodeCursor, generateApiKey, hashApiKey, hitRateLimit, isWellFormedApiKey, isYmd, pageOf, parseBearer, parsePagination, safeEqualHex,
  shouldTouchLastUsed, type RateState,
} from "../api-keys";
import { buildOpenApi, ENDPOINTS } from "../api/openapi";

describe("api keys", () => {
  it("generates sm_live_ + 32 base62 chars with a matching sha256 hash", () => {
    const { key, prefix, hash } = generateApiKey();
    assert.match(key, /^sm_live_[0-9A-Za-z]{32}$/);
    assert.equal(prefix, key.slice(0, 12));
    assert.equal(hash, hashApiKey(key));
    assert.equal(hash.length, 64);
    assert.ok(isWellFormedApiKey(key));
  });
  it("generates distinct keys", () => {
    assert.equal(new Set(Array.from({ length: 50 }, () => generateApiKey().key)).size, 50);
  });
  it("rejects malformed keys", () => {
    assert.equal(isWellFormedApiKey("sm_live_short"), false);
    assert.equal(isWellFormedApiKey(`sm_test_${"a".repeat(32)}`), false);
    assert.equal(isWellFormedApiKey(`sm_live_${"a".repeat(31)}-`), false);
  });
  it("parses bearer headers", () => {
    assert.equal(parseBearer("Bearer abc"), "abc");
    assert.equal(parseBearer("bearer   abc "), "abc");
    assert.equal(parseBearer("Basic abc"), null);
    assert.equal(parseBearer(null), null);
    assert.equal(parseBearer("Bearer"), null);
  });
  it("compares digests in constant time without throwing on length mismatch", () => {
    assert.equal(safeEqualHex("ab", "ab"), true);
    assert.equal(safeEqualHex("ab", "abc"), false);
  });
});

describe("pagination", () => {
  it("defaults and clamps the limit", () => {
    assert.deepEqual(parsePagination(new URLSearchParams()), { limit: 25, afterId: null });
    assert.deepEqual(parsePagination(new URLSearchParams("limit=500")), { limit: 100, afterId: null });
    assert.deepEqual(parsePagination(new URLSearchParams("limit=7")), { limit: 7, afterId: null });
  });
  it("rejects bad limits and cursors", () => {
    assert.ok("error" in parsePagination(new URLSearchParams("limit=0")));
    assert.ok("error" in parsePagination(new URLSearchParams("limit=-3")));
    assert.ok("error" in parsePagination(new URLSearchParams("limit=abc")));
    assert.ok("error" in parsePagination(new URLSearchParams("cursor=!!!")));
  });
  it("round-trips cursors", () => {
    assert.equal(decodeCursor(encodeCursor(42)), 42);
    assert.deepEqual(parsePagination(new URLSearchParams(`cursor=${encodeCursor(9)}`)), { limit: 25, afterId: 9 });
  });
  it("pageOf trims the extra row and sets the next cursor", () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const p = pageOf(rows, 2);
    assert.deepEqual(p.data, [{ id: 1 }, { id: 2 }]);
    assert.equal(p.hasMore, true);
    assert.equal(decodeCursor(p.nextCursor!), 2);
    const last = pageOf(rows, 3);
    assert.equal(last.hasMore, false);
    assert.equal(last.nextCursor, null);
  });
});

describe("rate limit", () => {
  it("allows up to the limit per window then resets", () => {
    const s: RateState = new Map();
    for (let i = 0; i < 3; i++) assert.equal(hitRateLimit(s, 1, 1000, 3).allowed, true);
    const blocked = hitRateLimit(s, 1, 2000, 3);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSec, 59);
    assert.equal(hitRateLimit(s, 2, 2000, 3).allowed, true);
    assert.equal(hitRateLimit(s, 1, 61_000, 3).allowed, true);
  });
  it("touches lastUsedAt at most once a minute", () => {
    const now = new Date("2026-01-01T00:10:00Z");
    assert.equal(shouldTouchLastUsed(null, now), true);
    assert.equal(shouldTouchLastUsed(new Date("2026-01-01T00:09:30Z"), now), false);
    assert.equal(shouldTouchLastUsed(new Date("2026-01-01T00:09:00Z"), now), true);
  });
});

describe("isYmd", () => {
  it("accepts real dates only", () => {
    assert.equal(isYmd("2026-02-28"), true);
    assert.equal(isYmd("2026-02-30"), false);
    assert.equal(isYmd("2026-2-3"), false);
    assert.equal(isYmd("nope"), false);
  });
});

describe("openapi", () => {
  it("describes every endpoint under bearer auth", () => {
    const doc = buildOpenApi("https://x.test/api/v1");
    assert.equal(doc.openapi, "3.1.0");
    for (const e of ENDPOINTS) assert.ok((doc.paths[e.path] as Record<string, unknown>)[e.method.toLowerCase()], `${e.method} ${e.path}`);
    assert.ok(doc.paths["/invoices/{id}"]);
    assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
  });
  it("never exposes sensitive employee fields", () => {
    const props = Object.keys((buildOpenApi("x").components.schemas as Record<string, { properties: object }>).Employee.properties).join(",");
    assert.doesNotMatch(props, /salary|ctc|bank|pan|aadhaar|passport|emirates|iban|dob/i);
  });
});
