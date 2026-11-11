import "server-only";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { clientIpFrom } from "./email-verification";

export async function clientIp() {
  return clientIpFrom(await headers());
}

export async function recentHits(key: string, windowMs: number) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.authThrottle)
    .where(and(eq(schema.authThrottle.key, key), gt(schema.authThrottle.createdAt, new Date(Date.now() - windowMs))));
  return row?.n ?? 0;
}

export async function recordHit(key: string) {
  await db.insert(schema.authThrottle).values({ key });
}

/** Counts this attempt and reports whether it is within `max` per window. */
export async function consume(key: string, max: number, windowMs: number) {
  if ((await recentHits(key, windowMs)) >= max) return false;
  await recordHit(key);
  return true;
}

export async function clearHits(key: string) {
  await db.delete(schema.authThrottle).where(eq(schema.authThrottle.key, key));
}

export async function pruneThrottle(olderThanMs = 24 * 60 * 60 * 1000) {
  await db.delete(schema.authThrottle).where(lt(schema.authThrottle.createdAt, new Date(Date.now() - olderThanMs)));
}
