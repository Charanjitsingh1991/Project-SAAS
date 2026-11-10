import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Role } from "@/db/schema";
import { emailHtml, sendEmail } from "./email";

export type NotifyInput = {
  kind: string;
  title: string;
  body?: string;
  /** App-relative link, e.g. /app/me. */
  href?: string;
  /** Also send an email (default true). */
  email?: boolean;
};

function absolute(href: string | undefined) {
  if (!href) return undefined;
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${href}` : undefined;
}

/** In-app notification (bell) for each user, plus an optional email. Never throws. */
export async function notifyUsers(orgId: number, userIds: number[], n: NotifyInput) {
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return;
  try {
    await db.insert(schema.notifications).values(ids.map((userId) => ({ orgId, userId, kind: n.kind, title: n.title, body: n.body ?? null, href: n.href ?? null })));
    if (n.email === false) return;
    const users = await db.select({ email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ids));
    const link = absolute(n.href);
    await Promise.all(
      users.map((u) =>
        sendEmail({
          to: u.email,
          subject: n.title,
          text: [n.body, link].filter(Boolean).join("\n\n"),
          html: emailHtml({ heading: n.title, text: n.body ?? "", button: link ? { label: "Open saasmodels.tech", href: link } : undefined }),
        }),
      ),
    );
  } catch (e) {
    console.error("[notify failed]", e);
  }
}

/** Notify everyone in the workspace with one of the given roles. */
export async function notifyRoles(orgId: number, roles: Role[], n: NotifyInput) {
  const rows = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), inArray(schema.memberships.role, roles)));
  await notifyUsers(
    orgId,
    rows.map((r) => r.userId),
    n,
  );
}

/** Notify the user account linked to an employee (no-op if the employee has no login). */
export async function notifyEmployee(orgId: number, employeeId: number, n: NotifyInput) {
  const [e] = await db
    .select({ userId: schema.employees.userId })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId)))
    .limit(1);
  if (e?.userId) await notifyUsers(orgId, [e.userId], n);
}

/** Notify the reporting manager of an employee if they have a login; falls back to HR/admins. */
export async function notifyApprovers(orgId: number, employeeId: number, n: NotifyInput) {
  const [e] = await db
    .select({ managerId: schema.employees.managerId })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId)))
    .limit(1);
  if (e?.managerId) {
    const [m] = await db
      .select({ userId: schema.employees.userId })
      .from(schema.employees)
      .where(and(eq(schema.employees.id, e.managerId), eq(schema.employees.orgId, orgId)))
      .limit(1);
    if (m?.userId) return notifyUsers(orgId, [m.userId], n);
  }
  return notifyRoles(orgId, ["owner", "admin", "hr"], n);
}
