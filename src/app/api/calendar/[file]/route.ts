import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildCalendar, hashFeedToken, tokenFromFile, type IcsEvent } from "@/lib/ics";
import { activeModules, effectivePlan } from "@/lib/plans";
import { roleCanUse, type ModuleKey } from "@/lib/roles";
import { accessFor } from "@/lib/trial";

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** Personal iCal subscription: GET /api/calendar/<token>.ics. The secret token is the only credential. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const token = tokenFromFile(file);
  if (!token) return text("Not found", 404);

  const [feed] = await db
    .select({ orgId: schema.calendarFeeds.orgId, userId: schema.calendarFeeds.userId, org: schema.organizations })
    .from(schema.calendarFeeds)
    .innerJoin(schema.organizations, eq(schema.calendarFeeds.orgId, schema.organizations.id))
    .where(eq(schema.calendarFeeds.tokenHash, hashFeedToken(token)))
    .limit(1);
  if (!feed) return text("Not found", 404);

  const [member] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, feed.orgId), eq(schema.memberships.userId, feed.userId)))
    .limit(1);
  if (!member) return text("Not found", 404);

  const access = accessFor(feed.org);
  if (access.state === "locked") return text("This workspace is deactivated.", 403);

  const orgId = feed.orgId;
  const plan = effectivePlan(feed.org, access.state === "trial");
  const mods = activeModules(plan, feed.org.enabledModules);
  const can = (m: ModuleKey) => mods.includes(m) && roleCanUse(member.role, m);
  const today = todayIn(feed.org.timezone || "Asia/Kolkata");
  const since = addDays(today, -30);
  const events: IcsEvent[] = [];
  const uid = (kind: string, id: number) => `${kind}-${orgId}-${id}@saasmodels.tech`;

  const holidays = await db.select().from(schema.holidays).where(and(eq(schema.holidays.orgId, orgId), gte(schema.holidays.date, since)));
  for (const h of holidays) {
    events.push({ uid: uid("holiday", h.id), start: h.date, summary: h.optional ? `${h.name} (optional holiday)` : h.name, categories: "Holiday" });
  }

  // Leave is part of HRM; employees without HRM access see themselves and their direct reports.
  if (mods.includes("hrm")) {
    const [me] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.userId, feed.userId)))
      .limit(1);
    let scopeIds: number[] | null = null; // null = everyone
    if (!can("hrm")) {
      scopeIds = [];
      if (me) {
        const reports = await db
          .select({ id: schema.employees.id })
          .from(schema.employees)
          .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.managerId, me.id)));
        scopeIds = [me.id, ...reports.map((r) => r.id)];
      }
    }
    if (scopeIds === null || scopeIds.length) {
      const rows = await db
        .select({ r: schema.leaveRequests, name: schema.employees.name, type: schema.leaveTypes.name })
        .from(schema.leaveRequests)
        .innerJoin(schema.employees, and(eq(schema.leaveRequests.employeeId, schema.employees.id), eq(schema.employees.orgId, orgId)))
        .innerJoin(schema.leaveTypes, and(eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id), eq(schema.leaveTypes.orgId, orgId)))
        .where(
          and(
            eq(schema.leaveRequests.orgId, orgId),
            eq(schema.leaveRequests.status, "approved"),
            gte(schema.leaveRequests.endDate, since),
            scopeIds ? inArray(schema.leaveRequests.employeeId, scopeIds) : undefined,
          ),
        );
      for (const { r, name, type } of rows) {
        events.push({
          uid: uid("leave", r.id),
          start: r.startDate,
          end: r.endDate,
          summary: `${name}: ${type}${r.halfDay ? " (half day)" : ""}`,
          categories: "Leave",
        });
      }
    }
  }

  if (can("projects")) {
    const [me] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.userId, feed.userId)))
      .limit(1);
    if (me) {
      const tasks = await db
        .select({ t: schema.tasks, project: schema.projects.name })
        .from(schema.tasks)
        .innerJoin(schema.projects, and(eq(schema.tasks.projectId, schema.projects.id), eq(schema.projects.orgId, orgId)))
        .where(and(eq(schema.tasks.orgId, orgId), eq(schema.tasks.assigneeId, me.id), ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate)));
      for (const { t, project } of tasks) {
        events.push({ uid: uid("task", t.id), start: t.dueDate!, summary: `Task due: ${t.title}`, description: `Project: ${project}`, categories: "Task" });
      }
    }
  }

  if (can("finance")) {
    const invoices = await db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), inArray(schema.invoices.status, ["sent", "partial"]), gte(schema.invoices.dueDate, since)));
    for (const i of invoices) {
      events.push({ uid: uid("invoice", i.id), start: i.dueDate, summary: `Invoice ${i.number} due`, description: `Customer: ${i.customerName}`, categories: "Invoice" });
    }
  }

  const body = buildCalendar({ name: `${feed.org.name} – workspace calendar`, events });
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="workspace.ics"',
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}
