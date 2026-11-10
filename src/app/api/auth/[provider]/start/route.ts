import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  buildAuthorizationUrl,
  isOAuthProvider,
  pkcePair,
  randomToken,
  sanitizeNext,
  signState,
} from "@/lib/oauth";
import { oauthCredentials, redirectUri, stateSecret } from "@/lib/oauth-server";
import { appOrigin } from "@/lib/url";

export async function GET(req: Request, ctx: RouteContext<"/api/auth/[provider]/start">) {
  const { provider } = await ctx.params;
  const origin = await appOrigin();
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, origin));
  if (!isOAuthProvider(provider)) return fail("oauth_unavailable");
  const creds = oauthCredentials(provider);
  if (!creds) return fail("oauth_unavailable");

  const q = new URL(req.url).searchParams;
  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = pkcePair();
  const cookie = signState(
    {
      provider,
      state,
      nonce,
      verifier,
      next: sanitizeNext(q.get("next")),
      invite: (q.get("invite") ?? "").slice(0, 200),
      exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    },
    stateSecret(),
  );

  const res = NextResponse.redirect(
    buildAuthorizationUrl(provider, { clientId: creds.clientId, redirectUri: redirectUri(origin, provider), state, nonce, challenge }),
  );
  res.cookies.set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must accompany the top-level redirect back from the provider
    path: "/api/auth",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return res;
}
