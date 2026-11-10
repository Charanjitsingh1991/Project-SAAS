import { auditFilters, auditRows } from "@/lib/audit";
import { canManage } from "@/lib/roles";
import { getWorkspace, hasFeature, type ActiveWorkspace } from "@/lib/tenancy";

const esc = (v: string) => {
  // Prefix formula-like values so spreadsheets don't execute them.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: Request) {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access || ws.access.state === "locked") return new Response("Unauthorized", { status: 401 });
  if (!canManage(ws.role) || !hasFeature(ws as ActiveWorkspace, "auditLog")) return new Response("Forbidden", { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await auditRows(ws.org.id, auditFilters(sp), 10_000);
  const lines = [
    "timestamp,user,email,module,entity_type,entity_id,action,summary",
    ...rows.map(({ a, actor, email }) =>
      [a.createdAt.toISOString(), actor ?? "System", email ?? "", a.module, a.entityType, a.entityId == null ? "" : String(a.entityId), a.action, a.summary].map(esc).join(","),
    ),
  ];
  return new Response(`\uFEFF${lines.join("\n")}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
