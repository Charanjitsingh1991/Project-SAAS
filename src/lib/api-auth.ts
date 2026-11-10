import "server-only";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashApiKey, hitRateLimit, isWellFormedApiKey, parseBearer, safeEqualHex, shouldTouchLastUsed, type RateState, RATE_LIMIT_PER_MINUTE } from "./api-keys";
import { activeModules, effectivePlan, planHas } from "./plans";
import type { ModuleKey } from "./roles";
import { accessFor } from "./trial";

export type ApiCtx = {
  orgId: number;
  keyId: number;
  keyName: string;
  scope: "read" | "write";
  /** User who created the key; used as the actor on activity entries. */
  actorId: number | null;
  currency: string;
  country: string;
  rate: { remaining: number };
};

type OrgRow = typeof schema.organizations.$inferSelect;

const JSON_HEADERS = { "cache-control": "no-store" };

export function apiError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message } }, { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function apiJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return Response.json(body, { status: init.status ?? 200, headers: { ...JSON_HEADERS, ...init.headers } });
}

/** Per-process counters. On serverless each instance counts separately, so this is a best-effort guard. */
const rateState: RateState = new Map();

export type AuthOpts = { module?: ModuleKey; write?: boolean };

/** Validate the bearer key, workspace state, plan, module and scope. Returns the context or an error Response. */
export async function authenticate(req: Request, opts: AuthOpts = {}): Promise<ApiCtx | Response> {
  const token = parseBearer(req.headers.get("authorization"));
  if (!token || !isWellFormedApiKey(token)) {
    return apiError(401, "unauthorized", "Missing or invalid API key. Send `Authorization: Bearer <key>`.", { "www-authenticate": "Bearer" });
  }

  const hash = hashApiKey(token);
  const [row] = await db
    .select({ key: schema.apiKeys, org: schema.organizations })
    .from(schema.apiKeys)
    .innerJoin(schema.organizations, eq(schema.apiKeys.orgId, schema.organizations.id))
    .where(eq(schema.apiKeys.keyHash, hash))
    .limit(1);
  if (!row || !safeEqualHex(row.key.keyHash, hash) || row.key.revokedAt) {
    return apiError(401, "unauthorized", "Missing or invalid API key.", { "www-authenticate": "Bearer" });
  }

  const { key, org } = row;
  const failure = checkWorkspace(org, key.scope, opts);
  if (failure) return failure;

  const limit = hitRateLimit(rateState, key.id, Date.now());
  if (!limit.allowed) {
    return apiError(429, "rate_limited", `Rate limit of ${RATE_LIMIT_PER_MINUTE} requests per minute exceeded.`, {
      "retry-after": String(limit.retryAfterSec),
      "x-ratelimit-limit": String(RATE_LIMIT_PER_MINUTE),
      "x-ratelimit-remaining": "0",
    });
  }

  const now = new Date();
  if (shouldTouchLastUsed(key.lastUsedAt, now)) {
    await db.update(schema.apiKeys).set({ lastUsedAt: now }).where(eq(schema.apiKeys.id, key.id)).catch(() => {});
  }

  return {
    orgId: org.id,
    keyId: key.id,
    keyName: key.name,
    scope: key.scope,
    actorId: key.createdBy,
    currency: org.currency,
    country: org.country,
    rate: { remaining: limit.remaining },
  };
}

function checkWorkspace(org: OrgRow, scope: "read" | "write", opts: AuthOpts): Response | null {
  const access = accessFor(org);
  if (access.state === "locked") return apiError(403, "workspace_locked", "This workspace is deactivated. Update billing to restore API access.");
  const plan = effectivePlan(org, access.state === "trial");
  if (!planHas(plan, "developerApi")) return apiError(403, "plan_required", "The REST API requires the Growth plan or higher.");
  if (opts.module && !activeModules(plan, org.enabledModules).includes(opts.module)) {
    return apiError(403, "module_disabled", `The ${opts.module} module is not enabled for this workspace.`);
  }
  if (opts.write && scope !== "write") return apiError(403, "insufficient_scope", "This key is read-only. Create a key with read + write scope.");
  return null;
}

/** Wrap a handler: authenticate, then run it; unexpected errors become JSON 500s. */
export async function withApi(req: Request, opts: AuthOpts, handler: (ctx: ApiCtx) => Promise<Response>): Promise<Response> {
  try {
    const ctx = await authenticate(req, opts);
    if (ctx instanceof Response) return ctx;
    const res = await handler(ctx);
    res.headers.set("x-ratelimit-limit", String(RATE_LIMIT_PER_MINUTE));
    res.headers.set("x-ratelimit-remaining", String(ctx.rate.remaining));
    return res;
  } catch (e) {
    // Let Next's internal signals (dynamic bail-out during prerender, notFound, redirect) through.
    unstable_rethrow(e);
    console.error("api error", e);
    return apiError(500, "internal_error", "Something went wrong.");
  }
}

/** Parse a JSON object body; returns an error Response for bad JSON. */
export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "invalid_json", "Request body must be a JSON object.");
  return body as Record<string, unknown>;
}
