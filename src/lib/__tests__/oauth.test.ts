import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildAuthorizationUrl, pkcePair, sanitizeNext, signState, validateClaims, verifyState, type OAuthState } from "../oauth";

const SECRET = "x".repeat(40);
const TID = "11111111-2222-3333-4444-555555555555";
const state = (over: Partial<OAuthState> = {}): OAuthState => ({
  provider: "google",
  state: "s",
  nonce: "n",
  verifier: "v",
  next: "/app",
  invite: "",
  exp: Math.floor(Date.now() / 1000) + 60,
  ...over,
});

describe("pkcePair", () => {
  it("derives an S256 challenge from the verifier", () => {
    const { verifier, challenge } = pkcePair();
    assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
    assert.ok(verifier.length >= 43);
  });
});

describe("state cookie", () => {
  it("round-trips and rejects tampering, wrong secret and expiry", () => {
    const c = signState(state(), SECRET);
    assert.equal(verifyState(c, SECRET)?.nonce, "n");
    assert.equal(verifyState(c, "y".repeat(40)), null);
    const [body, sig] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state(), next: "//evil.com" })).toString("base64url");
    assert.equal(verifyState(`${forged}.${sig}`, SECRET), null);
    assert.equal(verifyState(`${body}.`, SECRET), null);
    assert.equal(verifyState(undefined, SECRET), null);
    assert.equal(verifyState(signState(state({ exp: 1 }), SECRET), SECRET), null);
  });
});

describe("sanitizeNext", () => {
  it("allows only same-site relative paths", () => {
    assert.equal(sanitizeNext("/app/hrm"), "/app/hrm");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "", null, undefined, 5]) assert.equal(sanitizeNext(bad), "/app");
  });
});

describe("buildAuthorizationUrl", () => {
  it("includes PKCE, state and nonce", () => {
    const u = new URL(buildAuthorizationUrl("microsoft", { clientId: "c", redirectUri: "https://a/cb", state: "s", nonce: "n", challenge: "ch" }));
    assert.equal(u.origin + u.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("state"), "s");
    assert.equal(u.searchParams.get("nonce"), "n");
  });
});

describe("validateClaims", () => {
  const g = { iss: "https://accounts.google.com", sub: "123", nonce: "n", email: "A@x.com", email_verified: true, name: "Ann" };
  const m = { iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, sub: "abc", nonce: "n", email: "a@x.com", xms_edov: true, name: "Ann" };

  it("accepts verified Google and Microsoft identities", () => {
    assert.deepEqual(validateClaims("google", g, "n"), { ok: true, profile: { subject: "123", email: "a@x.com", name: "Ann" } });
    const r = validateClaims("microsoft", m, "n");
    assert.ok(r.ok && r.profile.subject === `${TID}:abc`);
  });
  it("rejects nonce mismatch and bad issuers", () => {
    assert.equal(validateClaims("google", g, "other").ok, false);
    assert.equal(validateClaims("google", { ...g, iss: "https://evil.com" }, "n").ok, false);
    assert.equal(validateClaims("microsoft", { ...m, tid: "22222222-2222-3333-4444-555555555555" }, "n").ok, false);
    assert.equal(validateClaims("microsoft", { ...m, iss: "https://login.microsoftonline.com/common/v2.0", tid: "common" }, "n").ok, false);
  });
  it("requires a verified email", () => {
    assert.deepEqual(validateClaims("google", { ...g, email_verified: false }, "n"), { ok: false, code: "oauth_email_unverified" });
    assert.deepEqual(validateClaims("google", { ...g, email: undefined }, "n"), { ok: false, code: "oauth_email_missing" });
    assert.deepEqual(validateClaims("microsoft", { ...m, xms_edov: undefined }, "n"), { ok: false, code: "oauth_email_unverified" });
    assert.deepEqual(validateClaims("microsoft", { ...m, email: undefined, preferred_username: "a@x.com", xms_edov: true }, "n"), {
      ok: false,
      code: "oauth_email_missing",
    });
  });
});
