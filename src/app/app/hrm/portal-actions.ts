"use server";

import { and, eq, gt, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { createInvite, seatsLeft } from "@/lib/invites";
import { requireWorkspace } from "@/lib/tenancy";

/** Invite every active employee that has an email, no linked user and no pending invite. */
export async function inviteAllToPortal(): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const [emps, pending] = await Promise.all([
    db
      .select({ email: schema.employees.email })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.status, "active"), isNull(schema.employees.userId))),
    db
      .select({ email: schema.invites.email })
      .from(schema.invites)
      .where(and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date()))),
  ]);
  const pendingEmails = new Set(pending.map((p) => p.email.toLowerCase()));
  const emails = [...new Set(emps.flatMap((e) => (e.email ? [e.email.toLowerCase()] : [])))].filter((e) => !pendingEmails.has(e));
  if (!emails.length) return { ok: true, message: "Everyone with an email already has access or a pending invite." };

  let left = await seatsLeft(ws);
  let emailed = 0;
  let failed = 0;
  let stopped = 0;
  const links: string[] = [];
  for (const [i, email] of emails.entries()) {
    if (left !== null && left <= 0) {
      stopped = emails.length - i;
      break;
    }
    const res = await createInvite(ws, email, "member");
    if (res.ok) {
      if (res.emailed) emailed++;
      else links.push(`${res.email}: ${res.url}`);
      if (left !== null) left--;
    } else if (res.error.includes("plan allows")) {
      stopped = emails.length - i;
      break;
    } else failed++;
  }
  const sent = emailed + links.length;
  if (sent) await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee", action: "invited", summary: `Invited ${sent} employees to the employee portal` });
  refresh();

  const parts = [`${emailed} invite${emailed === 1 ? "" : "s"} emailed`];
  if (links.length) parts.push(`${links.length} link-only (email isn't configured) — send by hand: ${links.join(" · ")}`);
  if (failed) parts.push(`${failed} failed`);
  if (stopped) parts.push(`stopped at the seat limit with ${stopped} not invited (upgrade to Growth for unlimited users)`);
  return { ok: sent > 0 || !stopped, message: `${parts.join("; ")}.` };
}
