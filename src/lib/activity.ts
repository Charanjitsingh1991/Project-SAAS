import "server-only";
import { db, schema } from "@/db";

export type Ctx = { orgId: number; userId: number | null };

export type ActivityModule = "hrm" | "payroll" | "crm" | "finance" | "inventory" | "projects" | "helpdesk" | "workspace" | "automation";

/** Append to the workspace activity log. Never throws (logging must not break the action). */
export async function logActivity(
  ctx: Ctx,
  entry: { module: ActivityModule; entityType: string; entityId?: number | null; action: string; summary: string },
) {
  try {
    await db.insert(schema.activityLog).values({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      module: entry.module,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      action: entry.action,
      summary: entry.summary,
    });
  } catch (e) {
    console.error("logActivity failed", e);
  }
}

/** Build a Ctx from a workspace returned by requireWorkspace(). */
export function ctxOf(ws: { org: { id: number }; user: { id: number } }): Ctx {
  return { orgId: ws.org.id, userId: ws.user.id };
}
