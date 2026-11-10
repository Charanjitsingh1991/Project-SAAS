"use server";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { syncSeats } from "@/lib/stripe";
import { planOf, requireWorkspace } from "@/lib/tenancy";

const InvitableRole = z.enum(["admin", "hr", "sales", "finance", "member"]);

export async function inviteMember(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true });
  const parsed = z
    .object({ email: z.email("Enter a valid email.").toLowerCase(), role: InvitableRole })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { email, role } = parsed.data;

  const plan = planOf(ws);
  if (plan.maxUsers !== null) {
    const members = await db.$count(schema.memberships, eq(schema.memberships.orgId, ws.org.id));
    const pending = await db.$count(
      schema.invites,
      and(eq(schema.invites.orgId, ws.org.id), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())),
    );
    if (members + pending >= plan.maxUsers) {
      return { message: `The ${plan.name} plan allows up to ${plan.maxUsers} users. Upgrade to Growth for unlimited users.` };
    }
  }

  const [already] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.memberships.orgId, ws.org.id), eq(schema.users.email, email)))
    .limit(1);
  if (already) return { errors: { email: ["This person is already in your workspace."] } };

  // Replace any earlier pending invite for the same email.
  await db
    .delete(schema.invites)
    .where(and(eq(schema.invites.orgId, ws.org.id), eq(schema.invites.email, email), isNull(schema.invites.acceptedAt)));
  await db.insert(schema.invites).values({
    orgId: ws.org.id,
    email,
    role,
    token: randomBytes(24).toString("base64url"),
    invitedBy: ws.user.id,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  refresh();
  return { ok: true, message: `Invite created for ${email}. Copy the link below and send it to them.` };
}

export async function revokeInvite(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  await db.delete(schema.invites).where(and(eq(schema.invites.id, Number(fd.get("id"))), eq(schema.invites.orgId, ws.org.id)));
  refresh();
}

export async function changeRole(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const role = InvitableRole.parse(fd.get("role"));
  const id = Number(fd.get("id"));
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, id), eq(schema.memberships.orgId, ws.org.id)))
    .limit(1);
  // The owner's role and your own role can't be changed here.
  if (!m || m.role === "owner" || m.userId === ws.user.id) return;
  await db.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, m.id));
  refresh();
}

export async function removeMember(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const id = Number(fd.get("id"));
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, id), eq(schema.memberships.orgId, ws.org.id)))
    .limit(1);
  if (!m || m.role === "owner" || m.userId === ws.user.id) return;
  await db.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
  await syncSeats(ws.org.id);
  refresh();
}

export async function updateWorkspace(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true });
  const parsed = z
    .object({ name: z.string().min(2, "Too short.").max(80), currency: z.enum(["INR", "USD", "EUR", "GBP", "AED", "SGD"]) })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  await db.update(schema.organizations).set(parsed.data).where(eq(schema.organizations.id, ws.org.id));
  refresh();
  return { ok: true, message: "Workspace updated." };
}
