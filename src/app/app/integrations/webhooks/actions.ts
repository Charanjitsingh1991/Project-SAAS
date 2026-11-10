"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { WEBHOOK_KINDS } from "@/db/schema";
import { ctxOf, logActivity } from "@/lib/activity";
import { encryptSecret } from "@/lib/crypto";
import type { FormState } from "@/lib/definitions";
import { isEventName } from "@/lib/integrations/catalog";
import { deliverById, queueDeliveries, redeliver } from "@/lib/integrations/deliver";
import type { EventPayload } from "@/lib/integrations/format";
import { urlHint, validateEndpointUrl } from "@/lib/integrations/security";
import { hasFeature, requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";

export type SecretState = (NonNullable<FormState> & { secret?: string }) | undefined;

const MAX_ENDPOINTS = 20;
const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

const EndpointSchema = z.object({
  kind: z.enum(WEBHOOK_KINDS),
  name: z.string().trim().min(2, "Give it a name.").max(80),
  url: z.string().trim().max(2000).optional(),
});

async function ownEndpoint(orgId: number, id: unknown) {
  const [row] = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.id, Number(id)), eq(schema.webhookEndpoints.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Create (no `id`) or update (`id`) an endpoint. Returns the signing secret once, on create. */
export async function saveEndpoint(_: SecretState, fd: FormData): Promise<SecretState> {
  const ws = await requireWorkspace({ manage: true });
  const orgId = ws.org.id;
  const events = [...new Set(fd.getAll("events").map(String))].filter(isEventName);
  const parsed = EndpointSchema.safeParse({ kind: fd.get("kind"), name: fd.get("name"), url: fd.get("url") || undefined });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  if (!events.length) return { message: "Choose at least one event." };

  const existing = fd.get("id") ? await ownEndpoint(orgId, fd.get("id")) : null;
  if (fd.get("id") && !existing) return { message: "Endpoint not found." };
  const kind = existing?.kind ?? parsed.data.kind;
  if (kind === "webhook" && !hasFeature(ws, "developerApi")) return { message: "Generic webhooks need the Growth plan. Slack, Teams and Google Chat are available on every plan." };

  let urlPatch: { urlEnc: string; urlHint: string } | null = null;
  if (parsed.data.url) {
    const check = validateEndpointUrl(kind, parsed.data.url);
    if (!check.ok) return { errors: { url: [check.error] } };
    urlPatch = { urlEnc: encryptSecret(check.url.toString()), urlHint: urlHint(check.url.toString()) };
  } else if (!existing) {
    return { errors: { url: ["Paste the destination URL."] } };
  }

  if (existing) {
    await db
      .update(schema.webhookEndpoints)
      .set({ name: parsed.data.name, events: JSON.stringify(events), ...urlPatch })
      .where(eq(schema.webhookEndpoints.id, existing.id));
    refresh();
    return { ok: true, message: "Saved." };
  }

  const current = await db.select({ id: schema.webhookEndpoints.id }).from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, orgId));
  if (current.length >= MAX_ENDPOINTS) return { message: `You can have up to ${MAX_ENDPOINTS} integrations.` };

  const secret = kind === "webhook" ? newSecret() : null;
  const [row] = await db
    .insert(schema.webhookEndpoints)
    .values({
      orgId,
      kind,
      name: parsed.data.name,
      urlEnc: urlPatch!.urlEnc,
      urlHint: urlPatch!.urlHint,
      secretEnc: secret ? encryptSecret(secret) : null,
      events: JSON.stringify(events),
      createdBy: ws.user.id,
    })
    .returning({ id: schema.webhookEndpoints.id });
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "webhook_endpoint", entityId: row.id, action: "created", summary: `Added ${kind.replace("_", " ")} integration “${parsed.data.name}”` });
  refresh();
  return { ok: true, message: secret ? "Endpoint created. Copy the signing secret now — it won't be shown again." : "Integration added. Use “Send test event” to check it.", secret: secret ?? undefined };
}

export async function toggleEndpoint(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const ep = await ownEndpoint(ws.org.id, fd.get("id"));
  if (!ep) return;
  if (!ep.active && ep.kind === "webhook" && !hasFeature(ws, "developerApi")) return;
  await db
    .update(schema.webhookEndpoints)
    .set({ active: !ep.active, failureCount: 0 })
    .where(eq(schema.webhookEndpoints.id, ep.id));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "webhook_endpoint", entityId: ep.id, action: ep.active ? "disabled" : "enabled", summary: `${ep.active ? "Disabled" : "Enabled"} integration “${ep.name}”` });
  refresh();
}

export async function deleteEndpoint(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const ep = await ownEndpoint(ws.org.id, fd.get("id"));
  if (!ep) return;
  await db.delete(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, ep.id));
  await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, ep.id));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "webhook_endpoint", entityId: ep.id, action: "deleted", summary: `Deleted integration “${ep.name}”` });
  refresh();
}

/** Issue a new signing secret (old one stops working immediately) and show it once. */
export async function rotateSecret(_: SecretState, fd: FormData): Promise<SecretState> {
  const ws = await requireWorkspace({ manage: true });
  const ep = await ownEndpoint(ws.org.id, fd.get("id"));
  if (!ep || ep.kind !== "webhook") return { message: "Only generic webhooks have a signing secret." };
  if (!hasFeature(ws, "developerApi")) return { message: "Generic webhooks need the Growth plan." };
  const secret = newSecret();
  await db.update(schema.webhookEndpoints).set({ secretEnc: encryptSecret(secret) }).where(eq(schema.webhookEndpoints.id, ep.id));
  await logActivity(ctxOf(ws), { module: "workspace", entityType: "webhook_endpoint", entityId: ep.id, action: "secret_rotated", summary: `Rotated the signing secret of “${ep.name}”` });
  refresh();
  return { ok: true, message: "New signing secret. Copy it now — it won't be shown again.", secret };
}

/** Send a `test.ping` delivery and wait for the result so it shows in the log immediately. */
export async function sendTestEvent(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  const ep = await ownEndpoint(ws.org.id, fd.get("id"));
  if (!ep || !ep.active) return;
  if (ep.kind === "webhook" && !hasFeature(ws, "developerApi")) return;
  const base = await appOrigin();
  const payload: EventPayload = {
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    event: "test.ping",
    created_at: new Date().toISOString(),
    workspace: { id: ws.org.id, name: ws.org.name, currency: ws.org.currency },
    data: { message: "This is a test event.", url: `${base}/app/integrations/webhooks` },
  };
  const [id] = await queueDeliveries(ws.org.id, [ep], payload);
  if (id) await deliverById(id);
  refresh();
}

export async function redeliverAction(fd: FormData) {
  const ws = await requireWorkspace({ manage: true });
  await redeliver(ws.org.id, Number(fd.get("id")));
  refresh();
}
