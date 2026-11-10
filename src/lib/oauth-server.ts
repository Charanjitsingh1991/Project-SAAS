import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { PROVIDER_META, OAUTH_PROVIDER_IDS, type OAuthProvider } from "./oauth";

export function oauthCredentials(provider: OAuthProvider) {
  const meta = PROVIDER_META[provider];
  const clientId = process.env[meta.clientIdEnv];
  const clientSecret = process.env[meta.clientSecretEnv];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function configuredProviders() {
  return OAUTH_PROVIDER_IDS.filter((p) => oauthCredentials(p));
}

export function stateSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  return secret;
}

export function redirectUri(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/${provider}/callback`;
}

const jwks = new Map<OAuthProvider, ReturnType<typeof createRemoteJWKSet>>();
function keySet(provider: OAuthProvider) {
  let set = jwks.get(provider);
  if (!set) {
    set = createRemoteJWKSet(new URL(PROVIDER_META[provider].jwksUri));
    jwks.set(provider, set);
  }
  return set;
}

/** Exchanges the code (client secret + PKCE verifier) and returns the raw ID token. */
export async function exchangeCode(provider: OAuthProvider, p: { code: string; verifier: string; redirectUri: string }) {
  const creds = oauthCredentials(provider);
  if (!creds) throw new Error("provider not configured");
  const res = await fetch(PROVIDER_META[provider].tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code_verifier: p.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string") throw new Error("no id_token");
  return json.id_token;
}

/** Verifies signature (provider JWKS), audience and expiry. Issuer/nonce/email are checked by validateClaims. */
export async function verifyIdToken(provider: OAuthProvider, idToken: string): Promise<JWTPayload> {
  const creds = oauthCredentials(provider);
  if (!creds) throw new Error("provider not configured");
  const { payload } = await jwtVerify(idToken, keySet(provider), {
    algorithms: ["RS256"],
    audience: creds.clientId,
    clockTolerance: 30,
  });
  return payload;
}
