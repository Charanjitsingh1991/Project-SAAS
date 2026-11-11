"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePlatformAdmin } from "@/lib/tenancy";
import { addDays, midnightInTz, ymdInTz } from "@/lib/trial";

export async function setEnquiryStatus(fd: FormData) {
  await requirePlatformAdmin();
  const status = z.enum(["new", "contacted", "closed"]).parse(fd.get("status"));
  await db.update(schema.enquiries).set({ status }).where(eq(schema.enquiries.id, Number(fd.get("id"))));
  refresh();
}

/** Extend a workspace's trial by N days from whichever is later: today or the current end. */
export async function extendTrial(fd: FormData) {
  await requirePlatformAdmin();
  const orgId = Number(fd.get("orgId"));
  const days = z.coerce.number().int().min(1).max(90).parse(fd.get("days"));
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org) return;
  const base = org.trialEndsAt > new Date() ? org.trialEndsAt : midnightInTz(addDays(ymdInTz(new Date()), 1));
  await db
    .update(schema.organizations)
    .set({ trialEndsAt: midnightInTz(addDays(ymdInTz(new Date(base.getTime() - 1)), days + 1)) })
    .where(eq(schema.organizations.id, orgId));
  refresh();
}

/** End a trial immediately (e.g. to check the deactivated experience). */
export async function expireTrial(fd: FormData) {
  await requirePlatformAdmin();
  await db
    .update(schema.organizations)
    .set({ trialEndsAt: new Date(Date.now() - 1000) })
    .where(eq(schema.organizations.id, Number(fd.get("orgId"))));
  refresh();
}

/** Free Enterprise access with no trial or billing (partners, demos, internal workspaces). */
export async function grantFreeAccess(fd: FormData) {
  await requirePlatformAdmin();
  await db
    .update(schema.organizations)
    .set({ compedAt: new Date(), plan: "enterprise" })
    .where(eq(schema.organizations.id, Number(fd.get("orgId"))));
  refresh();
}

/** Back to normal billing on Growth; if the trial date has passed the workspace locks until it pays. */
export async function revokeFreeAccess(fd: FormData) {
  await requirePlatformAdmin();
  await db
    .update(schema.organizations)
    .set({ compedAt: null, plan: "growth" })
    .where(eq(schema.organizations.id, Number(fd.get("orgId"))));
  refresh();
}
