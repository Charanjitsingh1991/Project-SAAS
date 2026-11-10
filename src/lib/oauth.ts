import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_PROVIDER_IDS = ["google", "microsoft"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDER_IDS)[number];

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export const PROVIDER_META = {
  google: {
    label: "Google",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    scope: "openid email profile",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    label: "Microsoft",
    // "common" accepts work/school and personal accounts; the issuer is checked per tenant id from the token.
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    scope: "openid email profile",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
} as const;

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Friendly messages for /login?error=<code>. */
export const OAUTH_ERRORS: Record<string, string> = {
  oauth_unavailable: "That sign-in option isn't available right now.",
  oauth_denied: "Sign-in was cancelled. You can try again or use your email and password.",
  oauth_state: "Your sign-in session expired. Please try again.",
  oauth_failed: "We couldn't complete sign-in with that provider. Please try again.",
  oauth_email_missing: "The provider didn't share an email address, so we couldn't sign you in.",
  oauth_email_unverified:
    "We couldn't confirm ownership of that email address with the provider. Use your email and password, or a different account.",
  oauth_invite_mismatch: "That account's email doesn't match the invited email address.",
};

export function oauthErrorMessage(code: unknown) {
  return typeof code === "string" ? (OAUTH_ERRORS[code] ?? null) : null;
}

/** Same-site relative paths only; same rule as password login. */
export function sanitizeNext(value: unknown, fallback = "/app") {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : fallback;
}

const base64url = (b: Buffer) => b.toString("base64url");

export function randomToken(bytes = 32) {
  return base64url(randomBytes(bytes));
}

export function pkcePair() {
  const verifier = randomToken(32);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export type OAuthState = {
  provider: OAuthProvider;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  invite: string;
  exp: number; // epoch seconds
};

function mac(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest();
}

export function signState(payload: OAuthState, secret: string) {
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${base64url(mac(secret, body))}`;
}

export function verifyState(cookie: string | undefined, secret: string, now = Date.now()): OAuthState | null {
  if (!cookie) return null;
  const [body, sig, extra] = cookie.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (!isOAuthProvider(String(p.provider)) || !p.state || !p.nonce || !p.verifier) return null;
    if (typeof p.exp !== "number" || p.exp * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}

export function buildAuthorizationUrl(
  provider: OAuthProvider,
  p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string },
) {
  const meta = PROVIDER_META[provider];
  const url = new URL(meta.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: meta.scope,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    ...(provider === "google" ? { prompt: "select_account" } : { response_mode: "query", prompt: "select_account" }),
  }).toString();
  return url.toString();
}

export type VerifiedProfile = { subject: string; email: string; name: string };
export type ClaimResult = { ok: true; profile: VerifiedProfile } | { ok: false; code: keyof typeof OAUTH_ERRORS };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

/**
 * Validates already signature-checked ID token claims (iss, nonce, email trust).
 * Google: requires email_verified.
 * Microsoft: the `email` claim is mutable and, per Microsoft, not guaranteed correct, so it is trusted only when
 * the optional claim `xms_edov` (email domain owner verified) is true. `preferred_username` is never used.
 * The account key is `sub` (stable per app); `tid` is checked against `iss`.
 */
export function validateClaims(provider: OAuthProvider, claims: Record<string, unknown>, expectedNonce: string): ClaimResult {
  if (typeof claims.nonce !== "string" || claims.nonce !== expectedNonce) return { ok: false, code: "oauth_state" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, code: "oauth_failed" };

  if (provider === "google") {
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return { ok: false, code: "oauth_failed" };
  } else {
    const tid = claims.tid;
    if (typeof tid !== "string" || !GUID.test(tid) || claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
      return { ok: false, code: "oauth_failed" };
    }
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || !EMAIL.test(email)) return { ok: false, code: "oauth_email_missing" };
  const verified = provider === "google" ? truthy(claims.email_verified) : truthy(claims.xms_edov);
  if (!verified) return { ok: false, code: "oauth_email_unverified" };

  const name = (typeof claims.name === "string" && claims.name.trim()) || email.split("@")[0];
  // Microsoft subjects are only unique per app registration; prefix the tenant to be explicit about the key.
  const subject = provider === "microsoft" ? `${String(claims.tid)}:${claims.sub}` : claims.sub;
  return { ok: true, profile: { subject, email, name: name.slice(0, 120) } };
}
