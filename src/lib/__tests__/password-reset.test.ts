import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NewPasswordSchema, generateResetToken, hashResetToken, isResetUsable, resetExpiry, RESET_TTL_MS } from "../password-reset";

describe("password reset helpers", () => {
  it("generates unique url-safe tokens and stable sha-256 hashes", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashResetToken(a), hashResetToken(a));
    assert.match(hashResetToken(a), /^[0-9a-f]{64}$/);
    assert.notEqual(hashResetToken(a), a);
  });

  it("expires after 60 minutes and rejects used tokens", () => {
    const now = 1_000_000;
    assert.equal(resetExpiry(now).getTime(), now + RESET_TTL_MS);
    assert.equal(isResetUsable({ expiresAt: new Date(now + 1), usedAt: null }, now), true);
    assert.equal(isResetUsable({ expiresAt: new Date(now), usedAt: null }, now), false);
    assert.equal(isResetUsable({ expiresAt: new Date(now + 1000), usedAt: new Date(now) }, now), false);
  });

  it("applies signup password rules", () => {
    assert.equal(NewPasswordSchema.safeParse("abcdefg1").success, true);
    assert.equal(NewPasswordSchema.safeParse("short1").success, false);
    assert.equal(NewPasswordSchema.safeParse("12345678").success, false);
    assert.equal(NewPasswordSchema.safeParse("abcdefgh").success, false);
  });
});
