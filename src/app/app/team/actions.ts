"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { createInvite } from "@/lib/invites";
import { syncSeats } from "@/lib/stripe";
import { requireWorkspace } from "@/lib/tenancy";

const InvitableRole = z.enum(["admin", "hr", "sales", "finance", "member"]);

export async function inviteMember(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true });
  const parsed = z
    .object({ email: z.email("Enter a valid email.").toLowerCase(), role: InvitableRole })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { email, role } = parsed.data;

  const res = await createInvite(ws, email, role);
  if (!res.ok) return res.field ? { errors: { [res.field]: [res.error] } } : { message: res.error };
  refresh();
  return {
    ok: true,
    message: res.emailed ? `Invite emailed to ${email}. You can also copy the link below.` : `Invite created for ${email}. Copy the link below and send it to them.`,
  };
}

export async function resendInvite(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const [inv] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.id, Number(fd.get("id"))), eq(schema.invites.orgId, ws.org.id), isNull(schema.invites.acceptedAt)))
    .limit(1);
  if (!inv) return;
  // Re-issuing extends the expiry and sends a fresh link.
  await createInvite(ws, inv.email, inv.role === "owner" ? "admin" : inv.role, { skipSeatCheck: true });
  refresh();
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
