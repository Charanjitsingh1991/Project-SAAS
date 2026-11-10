"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { newFeedToken } from "@/lib/ics";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";

/** Create or replace the caller's feed token. Replacing invalidates the previous URL immediately. */
export async function generateCalendarFeed(): Promise<FormState> {
  const ws = await requireWorkspace();
  const { token, hash } = newFeedToken();
  await db
    .insert(schema.calendarFeeds)
    .values({ orgId: ws.org.id, userId: ws.user.id, tokenHash: hash })
    .onConflictDoUpdate({
      target: [schema.calendarFeeds.orgId, schema.calendarFeeds.userId],
      set: { tokenHash: hash, createdAt: new Date() },
    });
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "calendar_feed", action: "regenerated", summary: `${ws.user.name} generated a calendar subscription link` });
  refresh();
  return { ok: true, message: "Your calendar link is ready. Copy it now — it is only shown once.", values: { url: `${await appOrigin()}/api/calendar/${token}.ics` } };
}

export async function revokeCalendarFeed(): Promise<FormState> {
  const ws = await requireWorkspace();
  await db.delete(schema.calendarFeeds).where(and(eq(schema.calendarFeeds.orgId, ws.org.id), eq(schema.calendarFeeds.userId, ws.user.id)));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "calendar_feed", action: "revoked", summary: `${ws.user.name} turned off their calendar subscription link` });
  refresh();
  return { ok: true, message: "Calendar link turned off." };
}
