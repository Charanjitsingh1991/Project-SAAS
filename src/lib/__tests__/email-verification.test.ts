import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  clientIpFrom,
  generateOtp,
  hashOtp,
  isDisposableEmail,
  isOtpUsable,
  normalizeOtp,
  otpExpiry,
  otpMatches,
  resendWaitSec,
} from "../email-verification";

describe("email verification codes", () => {
  it("generates six digits, keeping leading zeros", () => {
    for (let i = 0; i < 200; i++) assert.match(generateOtp(), /^\d{6}$/);
  });

  it("normalizes spaced or dashed input and rejects anything else", () => {
    assert.equal(normalizeOtp("123 456"), "123456");
    assert.equal(normalizeOtp(" 012-345 "), "012345");
    assert.equal(normalizeOtp("12345"), null);
    assert.equal(normalizeOtp("1234567"), null);
    assert.equal(normalizeOtp("12a456"), null);
  });

  it("binds the hash to the user", () => {
    const h = hashOtp(7, "123456");
    assert.ok(otpMatches(7, "123456", h));
    assert.ok(!otpMatches(7, "123457", h));
    assert.ok(!otpMatches(8, "123456", h));
    assert.ok(!otpMatches(7, "123456", "abc"));
  });

  it("expires, burns after max attempts and after use", () => {
    const now = Date.now();
    const fresh = { expiresAt: otpExpiry(now), usedAt: null, attempts: 0 };
    assert.ok(isOtpUsable(fresh, now));
    assert.ok(!isOtpUsable(fresh, now + OTP_TTL_MS + 1));
    assert.ok(!isOtpUsable({ ...fresh, attempts: OTP_MAX_ATTEMPTS }, now));
    assert.ok(isOtpUsable({ ...fresh, attempts: OTP_MAX_ATTEMPTS - 1 }, now));
    assert.ok(!isOtpUsable({ ...fresh, usedAt: new Date(now) }, now));
  });

  it("enforces the resend cooldown", () => {
    const now = Date.now();
    assert.equal(resendWaitSec(null, now), 0);
    assert.equal(resendWaitSec(new Date(now), now), OTP_RESEND_COOLDOWN_MS / 1000);
    assert.equal(resendWaitSec(new Date(now - OTP_RESEND_COOLDOWN_MS), now), 0);
  });
});

describe("sign-up abuse guards", () => {
  it("flags throwaway inboxes only", () => {
    assert.ok(isDisposableEmail("bot@mailinator.com"));
    assert.ok(isDisposableEmail("x@YOPMAIL.com"));
    assert.ok(!isDisposableEmail("charanjit@saasmodels.tech"));
    assert.ok(!isDisposableEmail("someone@gmail.com"));
  });

  it("takes the first forwarded client IP", () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
    assert.equal(clientIpFrom(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
    assert.equal(clientIpFrom(h({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
    assert.equal(clientIpFrom(h({})), "unknown");
  });
});
