"use server";

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { sendEmail, emailConfigured } from "@/lib/email";
import { formObject, todayYmd } from "@/lib/format";
import { isValidYmd } from "@/lib/hrm";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";

const Fields = z.object({
  title: z.string().trim().min(2, "Enter a title.").max(140),
  body: z.string().trim().min(2, "Write the announcement.").max(5000),
  pinned: z.string().optional(),
  expiresOn: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || isValidYmd(v), "Enter a valid date."),
  emailAll: z.string().optional(),
});

const BATCH = 10;
const MAX_RECIPIENTS = 500;

async function emailEmployees(orgId: number, orgName: string, title: string, body: string) {
  const rows = await db
    .select({ email: schema.employees.email })
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited"), isNotNull(schema.employees.email)));
  const emails = [...new Set(rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))].slice(0, MAX_RECIPIENTS);
  if (!emails.length) return { sent: 0, total: 0 };
  const url = `${await appOrigin()}/app`;
  let sent = 0;
  for (let i = 0; i < emails.length; i += BATCH) {
    const results = await Promise.all(
      emails.slice(i, i + BATCH).map((to) => sendEmail({ to, subject: `[${orgName}] ${title}`, paragraphs: [title, body], action: { label: "Open workspace", url } }).catch(() => ({ sent: false }))),
    );
    sent += results.filter((r) => r.sent).length;
  }
  return { sent, total: emails.length };
}

async function save(fd: FormData, id?: number): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const parsed = Fields.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;
  if (d.expiresOn && d.expiresOn < todayYmd()) return { errors: { expiresOn: ["Expiry date is in the past."] } };
  const values = { title: d.title, body: d.body, pinned: d.pinned === "on", expiresOn: d.expiresOn ?? null };

  let rowId = id;
  if (id) {
    const [row] = await db
      .update(schema.announcements)
      .set(values)
      .where(and(eq(schema.announcements.id, id), eq(schema.announcements.orgId, ws.org.id)))
      .returning({ id: schema.announcements.id });
    if (!row) return { message: "Announcement not found." };
  } else {
    const [row] = await db
      .insert(schema.announcements)
      .values({ ...values, orgId: ws.org.id, postedBy: ws.user.id })
      .returning({ id: schema.announcements.id });
    rowId = row.id;
  }
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "announcement", entityId: rowId, action: id ? "updated" : "created", summary: `${id ? "Updated" : "Posted"} announcement “${d.title}”` });

  let note = "";
  if (d.emailAll === "on") {
    if (!emailConfigured()) note = " Email is not configured, so no emails were sent.";
    else {
      const r = await emailEmployees(ws.org.id, ws.org.name, d.title, d.body).catch(() => ({ sent: 0, total: 0 }));
      note = ` Emailed ${r.sent} of ${r.total} employee${r.total === 1 ? "" : "s"}.`;
    }
  }
  refresh();
  return { ok: true, message: `${id ? "Announcement updated." : "Announcement posted."}${note}` };
}

export async function createAnnouncement(_: FormState, fd: FormData): Promise<FormState> {
  return save(fd);
}

export async function updateAnnouncement(_: FormState, fd: FormData): Promise<FormState> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return { message: "Announcement not found." };
  return save(fd, id);
}

export async function togglePin(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const [a] = await db.select().from(schema.announcements).where(and(eq(schema.announcements.id, id), eq(schema.announcements.orgId, ws.org.id))).limit(1);
  if (!a) return;
  await db.update(schema.announcements).set({ pinned: !a.pinned }).where(and(eq(schema.announcements.id, id), eq(schema.announcements.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "announcement", entityId: id, action: a.pinned ? "unpinned" : "pinned", summary: `${a.pinned ? "Unpinned" : "Pinned"} announcement “${a.title}”` });
  refresh();
}

export async function deleteAnnouncement(fd: FormData) {
  const ws = await requireWorkspace({ module: "hrm" });
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const [a] = await db.select().from(schema.announcements).where(and(eq(schema.announcements.id, id), eq(schema.announcements.orgId, ws.org.id))).limit(1);
  if (!a) return;
  await db.delete(schema.announcements).where(and(eq(schema.announcements.id, id), eq(schema.announcements.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "announcement", entityId: id, action: "deleted", summary: `Deleted announcement “${a.title}”` });
  refresh();
}
