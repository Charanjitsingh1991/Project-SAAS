import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Role } from "@/db/schema";
import { emailHtml, sendEmail } from "./email";
import { orgEntitlements } from "./entitlements";
import { ROLE_INFO } from "./roles";

export type InviteResult = { error: string } | { link: string; emailed: boolean; email: string };

function origin() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Users + pending invites, checked against the plan's user limit. */
export async function seatsLeft(orgId: number) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  const max = orgEntitlements(org).plan.maxUsers;
  if (max === null) return { max: null, left: Infinity, planName: orgEntitlements(org).plan.name };
  const members = await db.$count(schema.memberships, eq(schema.memberships.orgId, orgId));
  const pending = await db.$count(schema.invites, and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  return { max, left: max - members - pending, planName: orgEntitlements(org).plan.name };
}

/**
 * Create (or replace) an invite and email the join link. Enforces the plan's user limit
 * and skips people who are already members.
 */
export async function createInvite(ctx: { orgId: number; userId: number }, rawEmail: string, role: Exclude<Role, "owner">): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `“${rawEmail}” is not a valid email.` };

  const [already] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.memberships.orgId, ctx.orgId), eq(schema.users.email, email)))
    .limit(1);
  if (already) return { error: `${email} is already in this workspace.` };

  // Replacing an existing pending invite doesn't use an extra seat.
  const [pending] = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(and(eq(schema.invites.orgId, ctx.orgId), eq(schema.invites.email, email), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .limit(1);
  if (!pending) {
    const seats = await seatsLeft(ctx.orgId);
    if (seats.left <= 0) return { error: `The ${seats.planName} plan allows up to ${seats.max} users. Upgrade to add more.` };
  }

  await db.delete(schema.invites).where(and(eq(schema.invites.orgId, ctx.orgId), eq(schema.invites.email, email), isNull(schema.invites.acceptedAt)));
  const token = randomBytes(24).toString("base64url");
  await db.insert(schema.invites).values({ orgId: ctx.orgId, email, role, token, invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });

  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, ctx.orgId)).limit(1);
  const [inviter] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ctx.userId)).limit(1);
  const link = `${origin()}/invite/${token}`;
  const text = `${inviter?.name ?? "Your admin"} invited you to join ${org?.name ?? "their workspace"} on saasmodels.tech as ${ROLE_INFO[role].label}.\n\nOpen the link to create your password and sign in. It expires in 7 days.`;
  const emailed = await sendEmail({
    to: email,
    subject: `You're invited to ${org?.name ?? "a workspace"} on saasmodels.tech`,
    text: `${text}\n\n${link}`,
    html: emailHtml({ heading: `Join ${org?.name ?? "your team"}`, text, button: { label: "Accept invite", href: link } }),
  });
  return { link, emailed, email };
}
