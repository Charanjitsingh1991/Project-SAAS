import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Role } from "@/db/schema";
import { sendEmail } from "./email";
import { planOf, type ActiveWorkspace } from "./tenancy";
import { appOrigin } from "./url";

export const INVITE_TTL_DAYS = 7;

export type InviteOutcome =
  | { ok: true; email: string; url: string; emailed: boolean }
  | { ok: false; email: string; error: string; field?: "email" };

/** Seats still available on the plan (members + pending invites), or null for unlimited. */
export async function seatsLeft(ws: ActiveWorkspace) {
  const plan = planOf(ws);
  if (plan.maxUsers === null) return null;
  const members = await db.$count(schema.memberships, eq(schema.memberships.orgId, ws.org.id));
  const pending = await db.$count(
    schema.invites,
    and(eq(schema.invites.orgId, ws.org.id), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())),
  );
  return Math.max(0, plan.maxUsers - members - pending);
}

/**
 * Create (or replace) a pending invite and email the link. Callers must already hold
 * `requireWorkspace({ manage: true })` (or HRM access for employee portal invites).
 */
export async function createInvite(ws: ActiveWorkspace, rawEmail: string, role: Exclude<Role, "owner">, opts: { skipSeatCheck?: boolean } = {}): Promise<InviteOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const [already] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.memberships.orgId, ws.org.id), eq(schema.users.email, email)))
    .limit(1);
  if (already) return { ok: false, email, error: "This person is already in your workspace.", field: "email" };

  // Replace any earlier pending invite for the same email (it doesn't count against seats twice).
  await db.delete(schema.invites).where(and(eq(schema.invites.orgId, ws.org.id), eq(schema.invites.email, email), isNull(schema.invites.acceptedAt)));

  if (!opts.skipSeatCheck) {
    const left = await seatsLeft(ws);
    if (left !== null && left <= 0) {
      const plan = planOf(ws);
      return { ok: false, email, error: `The ${plan.name} plan allows up to ${plan.maxUsers} users. Upgrade to Growth for unlimited users.` };
    }
  }

  const token = randomBytes(24).toString("base64url");
  await db.insert(schema.invites).values({
    orgId: ws.org.id,
    email,
    role,
    token,
    invitedBy: ws.user.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  });
  const url = `${await appOrigin()}/invite/${token}`;
  const res = await sendInviteEmail({ email, url, orgName: ws.org.name, inviterName: ws.user.name, role });
  return { ok: true, email, url, emailed: res.sent };
}

export async function sendInviteEmail(p: { email: string; url: string; orgName: string; inviterName: string; role: string }) {
  const employee = p.role === "member";
  return sendEmail({
    to: p.email,
    subject: `${p.inviterName} invited you to ${p.orgName}`,
    paragraphs: [
      `Hi,`,
      employee
        ? `${p.inviterName} has invited you to the ${p.orgName} employee portal. You'll be able to check in, apply for leave, see your payslips and submit expense claims.`
        : `${p.inviterName} has invited you to join ${p.orgName} on saasmodels.tech.`,
      `Create your account (or log in with this email) to accept. The link is valid for ${INVITE_TTL_DAYS} days.`,
    ],
    action: { label: "Accept invite", url: p.url },
  });
}
