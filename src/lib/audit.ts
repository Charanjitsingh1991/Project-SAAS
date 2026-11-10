import "server-only";
import { and, desc, eq, gte, like, lte, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";

export type AuditFilters = { module?: string; actor?: number; from?: string; to?: string; q?: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Parse audit filters from search params, ignoring anything malformed. */
export function auditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const actor = Number(s("actor"));
  return {
    module: /^[a-z]{2,20}$/.test(s("module")) ? s("module") : undefined,
    actor: Number.isInteger(actor) && actor > 0 ? actor : undefined,
    from: YMD.test(s("from")) ? s("from") : undefined,
    to: YMD.test(s("to")) ? s("to") : undefined,
    q: s("q").slice(0, 100) || undefined,
  };
}

export async function auditRows(orgId: number, f: AuditFilters, limit: number) {
  const conds: SQL[] = [eq(schema.activityLog.orgId, orgId)];
  if (f.module) conds.push(eq(schema.activityLog.module, f.module));
  if (f.actor) conds.push(eq(schema.activityLog.actorId, f.actor));
  if (f.from) conds.push(gte(schema.activityLog.createdAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lte(schema.activityLog.createdAt, new Date(`${f.to}T23:59:59Z`)));
  if (f.q) conds.push(or(like(schema.activityLog.summary, `%${f.q}%`), like(schema.activityLog.entityType, `%${f.q}%`))!);
  return db
    .select({ a: schema.activityLog, actor: schema.users.name, email: schema.users.email })
    .from(schema.activityLog)
    .leftJoin(schema.users, eq(schema.activityLog.actorId, schema.users.id))
    .where(and(...conds))
    .orderBy(desc(schema.activityLog.createdAt), desc(schema.activityLog.id))
    .limit(limit);
}
