import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "../activity";
import { effectivePlan, planHas } from "../plans";
import { accessFor } from "../trial";
import { appOrigin } from "../url";
import { eventPath, parseEvents, type AnyEvent, type EventData, type EventName } from "./catalog";
import { deliverMany, queueDeliveries } from "./deliver";
import type { EventPayload } from "./format";

export type { EventName } from "./catalog";

async function origin() {
  try {
    return await appOrigin();
  } catch {
    return process.env.APP_URL?.replace(/\/$/, "") ?? null;
  }
}

/** Build the envelope, queue one delivery per matching endpoint and attempt them. */
async function dispatch(orgId: number, event: AnyEvent, data: EventData, base: string | null) {
  const endpoints = (await db.select().from(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.orgId, orgId), eq(schema.webhookEndpoints.active, true)))).filter((e) =>
    parseEvents(e.events).includes(event as EventName),
  );
  if (!endpoints.length) return;

  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org) return;
  const access = accessFor(org);
  if (access.state === "locked") return;
  const plan = effectivePlan(org, access.state === "trial");
  const allowed = endpoints.filter((e) => e.kind !== "webhook" || planHas(plan, "developerApi"));
  if (!allowed.length) return;

  const path = eventPath(event, data);
  const payload: EventPayload = {
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    event,
    created_at: new Date().toISOString(),
    workspace: { id: org.id, name: org.name, currency: org.currency },
    data: { ...data, url: path && base ? `${base}${path}` : null },
  };
  await deliverMany(await queueDeliveries(orgId, allowed, payload));
}

/**
 * Fire a business event to the workspace's webhooks and chat integrations.
 * Never throws and never blocks the caller: all work (including the endpoint lookup) runs in `after()`
 * inside a request, or as a detached promise elsewhere (seed scripts, cron).
 * `data` must be concise and free of secrets; money is in minor units.
 */
export async function emitEvent(ctx: Ctx, event: EventName, data: EventData) {
  try {
    const base = await origin();
    const run = () => dispatch(ctx.orgId, event, data, base).catch((e) => console.error(`emitEvent ${event} failed`, e));
    try {
      after(run);
    } catch {
      void run();
    }
  } catch (e) {
    console.error(`emitEvent ${event} failed`, e);
  }
}
