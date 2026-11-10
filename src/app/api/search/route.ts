import { and, eq, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { canUseModule, getWorkspace, type ActiveWorkspace } from "@/lib/tenancy";
import type { ModuleKey } from "@/lib/roles";

type Result = { type: string; title: string; subtitle?: string; href: string };

const QUICK_ACTIONS: { module: ModuleKey | null; title: string; href: string }[] = [
  { module: null, title: "Go to My space", href: "/app/me" },
  { module: "finance", title: "New invoice", href: "/app/finance/invoices/new" },
  { module: "crm", title: "Open sales pipeline", href: "/app/crm" },
  { module: "hrm", title: "Add employee", href: "/app/hrm" },
  { module: "hrm", title: "Mark attendance", href: "/app/hrm/attendance" },
  { module: "payroll", title: "Run payroll", href: "/app/payroll" },
  { module: "inventory", title: "New purchase order", href: "/app/inventory/purchase-orders/new" },
  { module: "inventory", title: "Reorder planner", href: "/app/inventory/reorder" },
  { module: "projects", title: "Log time", href: "/app/projects/timesheets" },
  { module: "projects", title: "My tasks", href: "/app/projects/my-tasks" },
  { module: "helpdesk", title: "Ticket queue", href: "/app/helpdesk" },
  { module: "analytics", title: "Analytics & insights", href: "/app/analytics" },
  { module: "finance", title: "Profit & loss", href: "/app/finance/reports" },
];

/** ⌘K search across every module the user can access. */
export async function GET(req: Request) {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access || ws.access.state === "locked") return Response.json({ results: [], actions: [] }, { status: 401 });
  const active = ws as ActiveWorkspace;
  const orgId = active.org.id;
  const can = (m: ModuleKey) => canUseModule(active, m);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 60) ?? "";

  const actions = QUICK_ACTIONS.filter((a) => (a.module ? can(a.module) : true)).filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()));
  if (q.length < 2) return Response.json({ results: [], actions });

  const p = `%${q}%`;
  const jobs: Promise<Result[]>[] = [];

  if (can("hrm"))
    jobs.push(
      db
        .select({ id: schema.employees.id, name: schema.employees.name, code: schema.employees.code, designation: schema.employees.designation })
        .from(schema.employees)
        .where(and(eq(schema.employees.orgId, orgId), or(like(schema.employees.name, p), like(schema.employees.code, p), like(schema.employees.email, p))))
        .limit(5)
        .then((r) => r.map((e) => ({ type: "Employee", title: e.name, subtitle: `${e.code} · ${e.designation}`, href: `/app/hrm/${e.id}` }))),
    );
  if (can("crm")) {
    jobs.push(
      db
        .select({ id: schema.companies.id, name: schema.companies.name, city: schema.companies.city })
        .from(schema.companies)
        .where(and(eq(schema.companies.orgId, orgId), like(schema.companies.name, p)))
        .limit(5)
        .then((r) => r.map((c) => ({ type: "Company", title: c.name, subtitle: c.city ?? undefined, href: `/app/crm/companies/${c.id}` }))),
      db
        .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.orgId, orgId), or(like(schema.contacts.name, p), like(schema.contacts.email, p))))
        .limit(5)
        .then((r) => r.map((c) => ({ type: "Contact", title: c.name, subtitle: c.email ?? undefined, href: `/app/crm/contacts/${c.id}` }))),
      db
        .select({ id: schema.deals.id, title: schema.deals.title, stage: schema.deals.stage })
        .from(schema.deals)
        .where(and(eq(schema.deals.orgId, orgId), like(schema.deals.title, p)))
        .limit(5)
        .then((r) => r.map((d) => ({ type: "Deal", title: d.title, subtitle: d.stage, href: `/app/crm/deals/${d.id}` }))),
    );
  }
  if (can("finance"))
    jobs.push(
      db
        .select({ id: schema.invoices.id, number: schema.invoices.number, customer: schema.invoices.customerName, status: schema.invoices.status })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.orgId, orgId), or(like(schema.invoices.number, p), like(schema.invoices.customerName, p))))
        .limit(5)
        .then((r) => r.map((i) => ({ type: "Invoice", title: `${i.number} · ${i.customer}`, subtitle: i.status, href: `/app/finance/invoices/${i.id}` }))),
    );
  if (can("inventory"))
    jobs.push(
      db
        .select({ id: schema.products.id, name: schema.products.name, sku: schema.products.sku })
        .from(schema.products)
        .where(and(eq(schema.products.orgId, orgId), or(like(schema.products.name, p), like(schema.products.sku, p), like(schema.products.barcode, p))))
        .limit(5)
        .then((r) => r.map((x) => ({ type: "Product", title: x.name, subtitle: x.sku, href: `/app/inventory/products/${x.id}` }))),
    );
  if (can("projects"))
    jobs.push(
      db
        .select({ id: schema.projects.id, name: schema.projects.name, code: schema.projects.code })
        .from(schema.projects)
        .where(and(eq(schema.projects.orgId, orgId), or(like(schema.projects.name, p), like(schema.projects.code, p))))
        .limit(5)
        .then((r) => r.map((x) => ({ type: "Project", title: x.name, subtitle: x.code, href: `/app/projects/${x.id}` }))),
      db
        .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.orgId, orgId), like(schema.tasks.title, p)))
        .limit(5)
        .then((r) => r.map((x) => ({ type: "Task", title: x.title, subtitle: x.status, href: `/app/projects/tasks/${x.id}` }))),
    );
  if (can("helpdesk"))
    jobs.push(
      db
        .select({ id: schema.tickets.id, number: schema.tickets.number, subject: schema.tickets.subject, status: schema.tickets.status })
        .from(schema.tickets)
        .where(and(eq(schema.tickets.orgId, orgId), or(like(schema.tickets.subject, p), like(schema.tickets.number, p), like(schema.tickets.requesterEmail, p))))
        .limit(5)
        .then((r) => r.map((t) => ({ type: "Ticket", title: `${t.number} · ${t.subject}`, subtitle: t.status, href: `/app/helpdesk/tickets/${t.id}` }))),
    );

  const results = (await Promise.all(jobs)).flat();
  return Response.json({ results, actions });
}
