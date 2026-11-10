import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity } from "../activity";
import { decryptSecret } from "../crypto";
import { googleChatBody, slackBody, teamsBody, type EventPayload } from "./format";
import { AUTO_DISABLE_AFTER, MAX_ATTEMPTS, TIMEOUT_MS, retryDelayMs, truncate } from "./retry";
import { isPrivateIp, signPayload, validateEndpointUrl } from "./security";

type Endpoint = typeof schema.webhookEndpoints.$inferSelect;
type Delivery = typeof schema.webhookDeliveries.$inferSelect;

/** An in-flight attempt keeps the row claimed this long, so cron and `after()` never double-send. */
const CLAIM_MS = 2 * 60_000;

/** Insert one pending delivery per endpoint and return their ids. */
export async function queueDeliveries(orgId: number, endpoints: Pick<Endpoint, "id">[], payload: EventPayload) {
  if (!endpoints.length) return [];
  const body = JSON.stringify(payload);
  const rows = await db
    .insert(schema.webhookDeliveries)
    .values(endpoints.map((e) => ({ orgId, endpointId: e.id, event: payload.event, eventId: payload.id, payload: body })))
    .returning({ id: schema.webhookDeliveries.id });
  return rows.map((r) => r.id);
}

/** Attempt every delivery id once; never throws. */
export async function deliverMany(ids: number[]) {
  await Promise.allSettled(ids.map((id) => deliverById(id).catch((e) => console.error("webhook delivery failed", id, e))));
}

async function assertPublicHost(host: string) {
  if (process.env.NODE_ENV !== "production" || isIP(host)) return;
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("Destination resolves to a private address.");
}

function requestFor(endpoint: Endpoint, payload: EventPayload, rawBody: string, secret: string | null): { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Saasmodels-Webhooks/1.0" };
  if (endpoint.kind === "slack") return { body: JSON.stringify(slackBody(payload)), headers };
  if (endpoint.kind === "teams") return { body: JSON.stringify(teamsBody(payload)), headers };
  if (endpoint.kind === "google_chat") return { body: JSON.stringify(googleChatBody(payload)), headers };
  const ts = Math.floor(Date.now() / 1000).toString();
  headers["X-Saasmodels-Event"] = payload.event;
  headers["X-Saasmodels-Delivery"] = payload.id;
  headers["X-Saasmodels-Timestamp"] = ts;
  if (secret) headers["X-Saasmodels-Signature"] = signPayload(secret, ts, rawBody);
  return { body: rawBody, headers };
}

type Outcome = { ok: boolean; status: number | null; body: string; terminal?: boolean };

async function send(endpoint: Endpoint, delivery: Delivery): Promise<Outcome> {
  const url = decryptSecret(endpoint.urlEnc);
  if (!url) return { ok: false, status: null, body: "Stored URL can't be decrypted. Re-save the endpoint.", terminal: true };
  const check = validateEndpointUrl(endpoint.kind, url);
  if (!check.ok) return { ok: false, status: null, body: check.error, terminal: true };
  try {
    await assertPublicHost(check.url.hostname);
    const payload = JSON.parse(delivery.payload) as EventPayload;
    const req = requestFor(endpoint, payload, delivery.payload, decryptSecret(endpoint.secretEnc));
    const res = await fetch(check.url, { method: "POST", headers: req.headers, body: req.body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = truncate(await res.text().catch(() => ""));
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: text };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, status: null, body: timedOut ? `Timed out after ${TIMEOUT_MS / 1000}s` : truncate(e instanceof Error ? e.message : "Request failed") };
  }
}

/** Claim and attempt one delivery. No-op when it is not pending/due or another worker holds it. */
export async function deliverById(id: number) {
  const now = new Date();
  const [claimed] = await db
    .update(schema.webhookDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + CLAIM_MS) })
    .where(
      and(
        eq(schema.webhookDeliveries.id, id),
        eq(schema.webhookDeliveries.status, "pending"),
        or(isNull(schema.webhookDeliveries.nextAttemptAt), lte(schema.webhookDeliveries.nextAttemptAt, now)),
      ),
    )
    .returning();
  if (!claimed) return;

  const [endpoint] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, claimed.endpointId)).limit(1);
  if (!endpoint || !endpoint.active) {
    await db.update(schema.webhookDeliveries).set({ status: "failed", nextAttemptAt: null, responseBody: "Endpoint is disabled." }).where(eq(schema.webhookDeliveries.id, id));
    return;
  }

  const out = await send(endpoint, claimed);
  const attempts = claimed.attempts + 1;
  const delay = out.ok || out.terminal ? null : retryDelayMs(attempts);
  await db
    .update(schema.webhookDeliveries)
    .set({
      status: out.ok ? "succeeded" : delay === null || attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      attempts,
      responseStatus: out.status,
      responseBody: out.body || null,
      nextAttemptAt: delay === null ? null : new Date(Date.now() + delay),
    })
    .where(eq(schema.webhookDeliveries.id, id));

  if (out.ok) {
    await db.update(schema.webhookEndpoints).set({ failureCount: 0, lastDeliveryAt: new Date() }).where(eq(schema.webhookEndpoints.id, endpoint.id));
    return;
  }
  const [updated] = await db
    .update(schema.webhookEndpoints)
    .set({ failureCount: sql`${schema.webhookEndpoints.failureCount} + 1`, lastDeliveryAt: new Date() })
    .where(eq(schema.webhookEndpoints.id, endpoint.id))
    .returning({ failureCount: schema.webhookEndpoints.failureCount });
  if (updated && updated.failureCount >= AUTO_DISABLE_AFTER) {
    await db.update(schema.webhookEndpoints).set({ active: false }).where(and(eq(schema.webhookEndpoints.id, endpoint.id), eq(schema.webhookEndpoints.active, true)));
    await logActivity(
      { orgId: endpoint.orgId, userId: null },
      { module: "workspace", entityType: "webhook_endpoint", entityId: endpoint.id, action: "auto_disabled", summary: `Integration “${endpoint.name}” was switched off after ${AUTO_DISABLE_AFTER} consecutive failures` },
    );
  }
}

/** Cron entry: attempt deliveries whose retry time has come. */
export async function retryDueDeliveries(limit = 100) {
  const due = await db
    .select({ id: schema.webhookDeliveries.id })
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.status, "pending"), or(isNull(schema.webhookDeliveries.nextAttemptAt), lte(schema.webhookDeliveries.nextAttemptAt, new Date()))))
    .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
    .limit(limit);
  await deliverMany(due.map((d) => d.id));
  return due.length;
}

/** Re-send a past delivery's payload as a fresh delivery to the same endpoint (history is kept). */
export async function redeliver(orgId: number, deliveryId: number) {
  const [d] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.orgId, orgId)))
    .limit(1);
  if (!d) return;
  const [row] = await db
    .insert(schema.webhookDeliveries)
    .values({ orgId, endpointId: d.endpointId, event: d.event, eventId: d.eventId, payload: d.payload })
    .returning({ id: schema.webhookDeliveries.id });
  await deliverById(row.id);
}

