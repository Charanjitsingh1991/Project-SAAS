import "server-only";
import { and, count, desc, eq, gt, isNull, lt, notExists, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { countryFromPhone } from "./countries";
import { sendEmail } from "./email";
import { OTP_MAX_PER_HOUR, OTP_TTL_MS, generateOtp, hashOtp, otpExpiry, resendWaitSec } from "./email-verification";
import { createOrganization } from "./org";
import { appOrigin } from "./url";

export type IssueResult = { ok: true } | { ok: false; reason: "cooldown"; waitSec: number } | { ok: false; reason: "hourly" | "send_failed" };

export async function latestCode(userId: number) {
  const [row] = await db
    .select()
    .from(schema.emailVerifications)
    .where(eq(schema.emailVerifications.userId, userId))
    .orderBy(desc(schema.emailVerifications.createdAt), desc(schema.emailVerifications.id))
    .limit(1);
  return row ?? null;
}

/** Emails a fresh 6-digit code, retiring older ones. Enforces the resend cooldown and hourly cap. */
export async function issueCode(user: { id: number; email: string; name: string }): Promise<IssueResult> {
  const last = await latestCode(user.id);
  const wait = resendWaitSec(last?.createdAt);
  if (wait > 0) return { ok: false, reason: "cooldown", waitSec: wait };

  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.emailVerifications)
    .where(and(eq(schema.emailVerifications.userId, user.id), gt(schema.emailVerifications.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
  if (n >= OTP_MAX_PER_HOUR) return { ok: false, reason: "hourly" };

  await db
    .update(schema.emailVerifications)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.emailVerifications.userId, user.id), isNull(schema.emailVerifications.usedAt)));

  const code = generateOtp();
  await db.insert(schema.emailVerifications).values({ userId: user.id, codeHash: hashOtp(user.id, code), expiresAt: otpExpiry() });

  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  const sent = await sendEmail({
    to: user.email,
    subject: `${pretty} is your saasmodels.tech verification code`,
    paragraphs: [
      `Hi ${user.name.split(" ")[0]},`,
      `Your verification code is ${pretty}. It expires in ${OTP_TTL_MS / 60000} minutes.`,
      "If you didn't try to create a saasmodels.tech account, you can ignore this email.",
    ],
  });
  if (!sent.sent) {
    console.error(`[verify-email] code email failed for user ${user.id}: ${sent.error}`);
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true };
}

/** Marks the account verified and, for a self sign-up, creates the workspace it asked for. Returns the org to open. */
export async function completeVerification(user: { id: number; name: string; email: string; company: string | null; phone: string | null }) {
  await db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(schema.users.id, user.id), isNull(schema.users.emailVerifiedAt)));

  const [member] = await db
    .select({ orgId: schema.memberships.orgId })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (member) return member.orgId;

  // Workspaces are only created once the email is proven, so abandoned sign-ups leave nothing behind.
  const country = countryFromPhone(user.phone) ?? "IN";
  const orgId = await createOrganization(user.id, user.company || `${user.name.split(" ")[0]}'s workspace`, { country, phone: user.phone });
  await sendEmail({
    to: user.email,
    subject: "Welcome to saasmodels.tech",
    paragraphs: [`Hi ${user.name.split(" ")[0]},`, "Your workspace is ready and your 14-day trial has started. Set up your company and invite your team whenever you're ready."],
    action: { label: "Open your workspace", url: `${await appOrigin()}/app` },
  });
  return orgId;
}

/** Removes stale codes and never-verified accounts (which own nothing) after `days`. */
export async function pruneUnverified(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await db.delete(schema.emailVerifications).where(lt(schema.emailVerifications.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const removed = await db
    .delete(schema.users)
    .where(
      and(
        isNull(schema.users.emailVerifiedAt),
        lt(schema.users.createdAt, cutoff),
        notExists(db.select({ x: sql`1` }).from(schema.memberships).where(eq(schema.memberships.userId, schema.users.id))),
      ),
    )
    .returning({ id: schema.users.id });
  return removed.length;
}
