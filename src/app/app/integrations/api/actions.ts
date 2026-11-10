"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { generateApiKey } from "@/lib/api-keys";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const MAX_ACTIVE_KEYS = 20;

export async function createApiKey(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ manage: true, feature: "developerApi" });
  const parsed = z
    .object({ name: z.string().trim().min(1, "Give the key a name.").max(80), scope: z.enum(schema.API_SCOPES) })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };

  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.orgId, ws.org.id), isNull(schema.apiKeys.revokedAt)));
  if (n >= MAX_ACTIVE_KEYS) return { message: `You can have at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` };

  const { key, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ orgId: ws.org.id, name: parsed.data.name, prefix, keyHash: hash, scope: parsed.data.scope, createdBy: ws.user.id })
    .returning({ id: schema.apiKeys.id });
  await logActivity(ctxOf(ws), {
    module: "workspace",
    entityType: "api_key",
    entityId: row.id,
    action: "created",
    summary: `Created ${parsed.data.scope === "write" ? "read + write" : "read-only"} API key "${parsed.data.name}" (${prefix}…)`,
  });
  refresh();
  return { ok: true, message: "Key created. Copy it now — it will not be shown again.", values: { key } };
}

export async function revokeApiKey(fd: FormData) {
  const ws = await requireWorkspace({ manage: true, feature: "developerApi" });
  const id = Number(fd.get("id"));
  const [key] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, ws.org.id), isNull(schema.apiKeys.revokedAt)))
    .returning({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix });
  if (key) {
    await logActivity(ctxOf(ws), { module: "workspace", entityType: "api_key", entityId: key.id, action: "revoked", summary: `Revoked API key "${key.name}" (${key.prefix}…)` });
  }
  refresh();
}
