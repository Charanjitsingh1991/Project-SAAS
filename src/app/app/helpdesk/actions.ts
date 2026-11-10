"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const TicketSchema = z.object({
  subject: z.string().min(3, "Enter a subject."),
  customerEmail: z.email("Invalid email."),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  description: z.string().max(2000).optional(),
});

export async function createTicket(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const parsed = TicketSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  await db.insert(schema.tickets).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: "Ticket created." };
}

export async function setTicketStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const status = z.enum(["open", "pending", "resolved"]).parse(fd.get("status"));
  await db
    .update(schema.tickets)
    .set({ status })
    .where(and(eq(schema.tickets.id, Number(fd.get("id"))), eq(schema.tickets.orgId, ws.org.id)));
  refresh();
}

export async function setTicketPriority(fd: FormData) {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const priority = z.enum(["low", "medium", "high", "urgent"]).parse(fd.get("priority"));
  await db
    .update(schema.tickets)
    .set({ priority })
    .where(and(eq(schema.tickets.id, Number(fd.get("id"))), eq(schema.tickets.orgId, ws.org.id)));
  refresh();
}
