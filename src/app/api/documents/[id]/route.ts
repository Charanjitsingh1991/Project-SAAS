import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resolveMyEmployee } from "@/lib/hrm-data";
import { canUseModule, getWorkspace, type ActiveWorkspace } from "@/lib/tenancy";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access || ws.access.state === "locked") return new Response("Unauthorized", { status: 401 });
  const orgId = ws.org.id;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });
  const [doc] = await db
    .select()
    .from(schema.employeeFiles)
    .where(and(eq(schema.employeeFiles.id, id), eq(schema.employeeFiles.orgId, orgId)))
    .limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  if (!canUseModule(ws as ActiveWorkspace, "hrm")) {
    const mine = await resolveMyEmployee(orgId, ws.user);
    if (!mine || mine.id !== doc.employeeId) return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${doc.fileName.replace(/[^\w .()-]/g, "_")}"`,
      "Content-Length": String(doc.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
