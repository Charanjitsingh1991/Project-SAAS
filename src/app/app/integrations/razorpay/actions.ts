"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { encryptSecret } from "@/lib/crypto";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { razorpayMode } from "@/lib/razorpay";
import { verifyKeys } from "@/lib/razorpay-api";
import { requireWorkspace } from "@/lib/tenancy";

const Schema = z.object({
  keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, "Key ID looks like rzp_live_… or rzp_test_…"),
  keySecret: z.string().trim().min(8, "Enter the Key Secret.").max(200),
  webhookSecret: z.string().trim().min(6, "Enter the Webhook Secret you set in Razorpay.").max(200),
});

export async function connectRazorpayAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true, module: "finance" });
  const parsed = Schema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };

  const check = await verifyKeys(parsed.data);
  if (!check.ok) return { errors: { keySecret: [check.error] }, message: check.error };

  const row = {
    configEnc: encryptSecret(JSON.stringify(parsed.data)),
    hint: `${parsed.data.keyId} (${razorpayMode(parsed.data.keyId)})`,
    active: true,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.orgIntegrations)
    .values({ orgId: ws.org.id, provider: "razorpay", ...row })
    .onConflictDoUpdate({ target: [schema.orgIntegrations.orgId, schema.orgIntegrations.provider], set: row });
  await logActivity(ctxOf(ws), { module: "finance", entityType: "integration", action: "connected", summary: "Connected Razorpay" });
  refresh();
  return { ok: true, message: "Razorpay connected." };
}

export async function disconnectRazorpayAction(): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true, module: "finance" });
  await db.delete(schema.orgIntegrations).where(and(eq(schema.orgIntegrations.orgId, ws.org.id), eq(schema.orgIntegrations.provider, "razorpay")));
  await logActivity(ctxOf(ws), { module: "finance", entityType: "integration", action: "disconnected", summary: "Disconnected Razorpay" });
  refresh();
  return { ok: true, message: "Razorpay disconnected." };
}
