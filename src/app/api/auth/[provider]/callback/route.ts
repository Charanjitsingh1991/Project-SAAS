import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import {
  OAUTH_STATE_COOKIE,
  isOAuthProvider,
  randomToken,
  sanitizeNext,
  validateClaims,
  verifyState,
  type OAuthProvider,
  type VerifiedProfile,
} from "@/lib/oauth";
import { exchangeCode, redirectUri, stateSecret, verifyIdToken } from "@/lib/oauth-server";
import { createSession } from "@/lib/session";
import { syncSeats } from "@/lib/stripe";
import { ORG_COOKIE } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";

async function resolveUser(provider: OAuthProvider, p: VerifiedProfile) {
  const [linked] = await db
    .select({ userId: schema.oauthAccounts.userId })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.provider, provider), eq(schema.oauthAccounts.subject, p.subject)))
    .limit(1);
  if (linked) return linked.userId;

  // The email is provider-verified (validateClaims), so linking to the existing account is safe.
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, p.email)).limit(1);
  let userId = existing?.id;
  if (!userId) {
    // Random password: password login stays impossible until the user runs "Forgot password".
    const passwordHash = await bcrypt.hash(randomToken(32), 12);
    [{ id: userId }] = await db
      .insert(schema.users)
      .values({ name: p.name, email: p.email, passwordHash, emailVerifiedAt: new Date() })
      .returning({ id: schema.users.id });
  } else {
    await db
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(schema.users.id, userId), isNull(schema.users.emailVerifiedAt)));
  }
  await db.insert(schema.oauthAccounts).values({ userId, provider, subject: p.subject, email: p.email }).onConflictDoNothing();
  return userId;
}

export async function GET(req: Request, ctx: RouteContext<"/api/auth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const origin = await appOrigin();
  const to = (path: string) => new URL(path, origin);
  const done = (url: URL) => {
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth" });
    return res;
  };
  const fail = (code: string) => done(to(`/login?error=${code}`));
  if (!isOAuthProvider(provider)) return fail("oauth_unavailable");

  const q = new URL(req.url).searchParams;
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);
  const st = verifyState(raw, stateSecret());
  if (!st || st.provider !== provider || q.get("state") !== st.state) return fail("oauth_state");
  if (q.get("error")) return fail(q.get("error") === "access_denied" ? "oauth_denied" : "oauth_failed");
  const code = q.get("code");
  if (!code) return fail("oauth_failed");

  let profile: VerifiedProfile;
  try {
    const idToken = await exchangeCode(provider, { code, verifier: st.verifier, redirectUri: redirectUri(origin, provider) });
    const result = validateClaims(provider, await verifyIdToken(provider, idToken), st.nonce);
    if (!result.ok) return fail(result.code);
    profile = result.profile;
  } catch (err) {
    console.error("[oauth] sign-in failed", provider, err instanceof Error ? err.message : err);
    return fail("oauth_failed");
  }

  const [invite] = st.invite
    ? await db
        .select()
        .from(schema.invites)
        .where(and(eq(schema.invites.token, st.invite), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
        .limit(1)
    : [];
  if (invite && invite.email.toLowerCase() !== profile.email) return fail("oauth_invite_mismatch");

  const userId = await resolveUser(provider, profile);

  const res = done(to(sanitizeNext(st.next)));
  if (invite) {
    await db.insert(schema.memberships).values({ orgId: invite.orgId, userId, role: invite.role }).onConflictDoNothing();
    await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
    await syncSeats(invite.orgId);
    res.cookies.set(ORG_COOKIE, String(invite.orgId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    if (st.next === "/app" || st.next.startsWith("/invite/")) res.headers.set("location", to("/app").toString());
  }
  await createSession(userId);
  return res;
}
