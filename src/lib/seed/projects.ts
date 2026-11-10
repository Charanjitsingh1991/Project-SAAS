import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "@/lib/activity";
import { packOf, type CountryCode } from "@/lib/countries";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { invoiceProjectTime } from "@/lib/posting";
import { weekStartOf } from "@/lib/projects";
import { nextNumber } from "@/lib/sequence";

type Status = (typeof schema.TASK_STATUSES)[number];
type Priority = (typeof schema.PRIORITIES)[number];
// [title, status, priority, start offset (days from today), due offset, estimate h, assignee index, milestone index]
type TaskSpec = [string, Status, Priority, number, number, number, number, number | null];

type ProjectSpec = {
  name: string;
  description: string;
  billingType: "fixed" | "hourly" | "non_billable";
  budgetL?: number;
  rate?: number;
  status: "planning" | "active" | "on_hold" | "done";
  color: string;
  start: number;
  due: number;
  client: boolean;
  milestones: [string, number, boolean][];
  tasks: TaskSpec[];
};

/** Budgets are authored in lakh and rates in rupees; UAE uses AED 15,000 per budget unit and AED 350/h for the ₹2,500/h rate. */
const MONEY: Record<CountryCode, { budgetUnit: number; rateFactor: number }> = { IN: { budgetUnit: 100_000, rateFactor: 1 }, AE: { budgetUnit: 15_000, rateFactor: 0.14 } };

const hash = (a: number, b: number) => {
  let h = Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return (h >>> 0) % 1000;
};

const NEW_PROJECTS: ProjectSpec[] = [
  {
    name: "Website Revamp Retainer",
    description: "Ongoing design and engineering support for the marketing site, billed monthly on logged hours.",
    billingType: "hourly",
    rate: 2500,
    budgetL: 6,
    status: "active",
    color: "sky",
    start: -50,
    due: 40,
    client: true,
    milestones: [
      ["Design system sign-off", -20, true],
      ["Landing pages live", 10, false],
      ["Performance & SEO pass", 35, false],
    ],
    tasks: [
      ["Audit current site analytics", "done", "medium", -50, -40, 6, 0, 0],
      ["Design new homepage hero", "done", "high", -42, -25, 14, 1, 0],
      ["Build component library", "done", "high", -35, -18, 24, 2, 0],
      ["Implement pricing page", "review", "high", -14, 2, 12, 2, 1],
      ["Case study template", "in_progress", "medium", -10, 8, 10, 1, 1],
      ["Migrate blog to new CMS", "in_progress", "urgent", -12, -3, 16, 3, 1],
      ["Core Web Vitals optimisation", "todo", "medium", 5, 28, 18, 3, 2],
      ["Structured data & sitemap", "backlog", "low", 15, 34, 6, 4, 2],
    ],
  },
  {
    name: "Internal Platform Upgrade",
    description: "Non-billable engineering work: dependency upgrades, observability and developer tooling.",
    billingType: "non_billable",
    status: "active",
    color: "lime",
    start: -45,
    due: 30,
    client: false,
    milestones: [
      ["CI pipeline modernised", -10, true],
      ["Observability rollout", 25, false],
    ],
    tasks: [
      ["Upgrade framework & dependencies", "done", "high", -45, -30, 20, 2, 0],
      ["Speed up CI with caching", "done", "medium", -30, -12, 8, 3, 0],
      ["Set up error tracking", "in_progress", "high", -8, 6, 10, 2, 1],
      ["Structured logging across services", "todo", "medium", 2, 18, 12, 3, 1],
      ["Write runbooks for on-call", "backlog", "low", 10, 28, 8, 4, 1],
      ["Fix flaky end-to-end tests", "review", "urgent", -6, -1, 9, 3, null],
    ],
  },
  {
    name: "Brand Identity Refresh",
    description: "Logo, colour palette and brand guidelines delivered as a fixed-fee engagement.",
    billingType: "fixed",
    budgetL: 4.5,
    status: "done",
    color: "peach",
    start: -75,
    due: -12,
    client: true,
    milestones: [
      ["Moodboards approved", -60, true],
      ["Guidelines delivered", -14, true],
    ],
    tasks: [
      ["Stakeholder interviews", "done", "medium", -75, -66, 6, 1, 0],
      ["Logo concepts round 1", "done", "high", -64, -52, 18, 1, 0],
      ["Colour & typography system", "done", "medium", -50, -34, 12, 4, 1],
      ["Brand guidelines document", "done", "high", -32, -16, 20, 1, 1],
      ["Asset handover & training", "done", "low", -16, -12, 5, 4, 1],
    ],
  },
  {
    name: "Mobile App MVP",
    description: "Customer-facing mobile app: onboarding, orders and push notifications. Fixed fee with phased delivery.",
    billingType: "fixed",
    budgetL: 18,
    status: "active",
    color: "lilac",
    start: -38,
    due: 55,
    client: true,
    milestones: [
      ["Prototype approved", -15, true],
      ["Beta release", 28, false],
      ["Store launch", 52, false],
    ],
    tasks: [
      ["Define MVP scope & user stories", "done", "high", -38, -28, 10, 0, 0],
      ["Clickable prototype", "done", "high", -30, -16, 22, 1, 0],
      ["Authentication & onboarding flow", "in_progress", "urgent", -12, 4, 26, 2, 1],
      ["Order history screens", "in_progress", "medium", -5, 14, 20, 3, 1],
      ["Push notification service", "todo", "medium", 4, 22, 16, 2, 1],
      ["Offline mode & sync", "todo", "high", 8, 30, 28, 3, 1],
      ["Payment gateway integration", "backlog", "high", 18, 40, 24, 2, 2],
      ["App store submission checklist", "backlog", "low", 38, 50, 6, 0, 2],
    ],
  },
];

const GENERIC: TaskSpec[] = [
  ["Kick-off call & requirements", "done", "high", -20, -14, 4, 0, null],
  ["Prepare delivery plan", "in_progress", "medium", -10, 5, 8, 1, null],
  ["Client review & feedback", "todo", "medium", 4, 18, 6, 2, null],
];

const COMMENTS = [
  "Pushed a first draft — would love eyes on the edge cases before we move this to review.",
  "Client confirmed the scope in this morning's call. We can proceed as planned.",
  "Blocked on assets from the client; I've pinged them again.",
  "Looks good to me. Moving forward once the estimate is updated.",
  "Reproduced the issue locally — it only happens on slower connections.",
  "Added notes to the shared doc. Let's discuss in tomorrow's stand-up.",
];

/** Sample projects: enriches CRM-opened projects, adds more with tasks, milestones, six weeks of time and a billed batch. */
export async function seedProjects(ctx: Ctx): Promise<void> {
  const { orgId } = ctx;
  const today = todayYmd();
  const d = (n: number) => addDaysYmd(today, n);
  const [org] = await db.select({ country: schema.organizations.country }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  const money = MONEY[packOf(org ?? {}).code];
  const rateMinor = (s: ProjectSpec) => Math.round((s.rate ?? 0) * money.rateFactor * 100);

  const emps = await db
    .select({ id: schema.employees.id, annualCtc: schema.employees.annualCtc })
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.status, "active")))
    .orderBy(asc(schema.employees.id));
  if (!emps.length) return;
  const team = emps.slice(0, 6);
  const who = (i: number) => team[i % team.length].id;

  const companyIds = (await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.orgId, orgId)).orderBy(asc(schema.companies.id))).map((c) => c.id);

  let finished: { id: number; tasks: number[] } | null = null;
  const projectIds: { id: number; spec: { billingType: string; rate: number }; tasks: number[] }[] = [];

  async function addTasks(projectId: number, specs: TaskSpec[], milestoneIds: number[]) {
    const ids: number[] = [];
    let order = 0;
    for (const [title, status, priority, s, due, est, a, ms] of specs) {
      const [t] = await db
        .insert(schema.tasks)
        .values({
          orgId,
          projectId,
          milestoneId: ms !== null ? (milestoneIds[ms] ?? null) : null,
          title,
          assigneeId: who(a),
          status,
          priority,
          startDate: d(s),
          dueDate: d(due),
          estimateHours: est,
          sortOrder: ++order,
          completedAt: status === "done" ? new Date(`${d(Math.min(due, 0))}T10:00:00Z`) : null,
        })
        .returning({ id: schema.tasks.id });
      ids.push(t.id);
    }
    return ids;
  }

  /* Enrich projects opened from won CRM deals. */
  const existing = await db.select().from(schema.projects).where(eq(schema.projects.orgId, orgId)).orderBy(asc(schema.projects.id));
  const tones = ["mint", "butter", "rose", "sky"];
  for (const [i, p] of existing.entries()) {
    const active = i < 3;
    await db
      .update(schema.projects)
      .set({
        status: active ? "active" : p.status,
        startDate: d(-30 - i * 6),
        dueDate: d(30 + i * 20),
        color: tones[i % tones.length],
        ownerId: p.ownerId ?? ctx.userId,
      })
      .where(eq(schema.projects.id, p.id));
    const ms = await db
      .insert(schema.milestones)
      .values([
        { orgId, projectId: p.id, title: "Kick-off complete", dueDate: d(-20 - i * 6), done: true },
        { orgId, projectId: p.id, title: "Delivery", dueDate: d(25 + i * 20), done: false },
      ])
      .returning({ id: schema.milestones.id });
    const tasks = i < 2 ? await addTasks(p.id, GENERIC, ms.map((m) => m.id)) : [];
    if (active) projectIds.push({ id: p.id, spec: { billingType: p.billingType, rate: p.hourlyRate }, tasks });
  }

  /* New projects. */
  for (const [i, s] of NEW_PROJECTS.entries()) {
    const code = await nextNumber(orgId, "project");
    const [p] = await db
      .insert(schema.projects)
      .values({
        orgId,
        code,
        name: s.name,
        companyId: s.client && companyIds.length ? companyIds[(i + 1) % companyIds.length] : null,
        description: s.description,
        ownerId: ctx.userId,
        color: s.color,
        billingType: s.billingType,
        budget: Math.round((s.budgetL ?? 0) * money.budgetUnit * 100),
        hourlyRate: rateMinor(s),
        startDate: d(s.start),
        dueDate: d(s.due),
        status: s.status,
      })
      .returning({ id: schema.projects.id });
    const ms = await db
      .insert(schema.milestones)
      .values(s.milestones.map(([title, due, done]) => ({ orgId, projectId: p.id, title, dueDate: d(due), done })))
      .returning({ id: schema.milestones.id });
    const tasks = await addTasks(p.id, s.tasks, ms.map((m) => m.id));
    await logActivity(ctx, { module: "projects", entityType: "project", entityId: p.id, action: "created", summary: `Created project ${code} ${s.name}` });
    if (s.status !== "done") projectIds.push({ id: p.id, spec: { billingType: s.billingType, rate: rateMinor(s) }, tasks });
    else finished = { id: p.id, tasks };
  }

  /* Comments on a few tasks. */
  if (ctx.userId) {
    const sample = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.orgId, orgId)).orderBy(asc(schema.tasks.id));
    for (let i = 0; i < Math.min(6, sample.length); i++) {
      const t = sample[(i * 4 + 1) % sample.length];
      await db.insert(schema.taskComments).values({ orgId, taskId: t.id, authorId: ctx.userId, body: COMMENTS[i % COMMENTS.length] });
    }
  }

  /* Six weeks of time entries, billed batch in the middle. */
  const logProjects = projectIds;
  const hourly = projectIds.find((p) => p.spec.billingType === "hourly" && p.spec.rate > 0);
  const start = addDaysYmd(weekStartOf(today), -35);
  const rows: (typeof schema.timeEntries.$inferInsert)[] = [];
  const DESC = ["Implementation", "Code review", "Client call", "Design iteration", "Bug fixing", "Planning & estimation", "Testing", "Documentation"];
  for (let n = 0; n <= daysSpan(start, today); n++) {
    const date = addDaysYmd(start, n);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const [ei, e] of team.entries()) {
      const h = hash(n, ei);
      if (h < 120) continue;
      const parts = h > 650 ? 2 : 1;
      for (let k = 0; k < parts; k++) {
        const hk = hash(n * 7 + k, ei + 11);
        const pr = logProjects[hk % logProjects.length];
        const taskId = pr.tasks.length && hk % 7 !== 0 ? pr.tasks[(hk >> 2) % pr.tasks.length] : null;
        rows.push({
          orgId,
          projectId: pr.id,
          taskId,
          employeeId: e.id,
          date,
          hours: [1, 1.5, 2, 2.5, 3, 4][(hk >> 1) % 6],
          description: DESC[hk % DESC.length],
          billable: pr.spec.billingType === "non_billable" ? false : hk % 100 < 85,
        });
      }
    }
  }
  // Make sure the hourly project has plenty of time on both sides of the billing cut-off.
  if (hourly) {
    for (let n = 0; n < 30; n++) {
      const date = addDaysYmd(start, n + (n > 14 ? 3 : 0));
      if (date > today || [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
      rows.push({ orgId, projectId: hourly.id, taskId: hourly.tasks[n % hourly.tasks.length] ?? null, employeeId: who(n % 4 + 1), date, hours: 2 + (n % 3), description: DESC[n % DESC.length], billable: true });
    }
  }

  if (finished) {
    for (let n = 0; n < 14; n++) {
      const date = d(-70 + n * 4);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0) continue;
      rows.push({ orgId, projectId: finished.id, taskId: finished.tasks[n % finished.tasks.length], employeeId: who((n % 2) + 1), date, hours: 3 + (n % 4), description: DESC[n % DESC.length], billable: true });
    }
  }

  const cutoff = d(-16);
  const insert = async (batch: typeof rows) => {
    for (let i = 0; i < batch.length; i += 80) await db.insert(schema.timeEntries).values(batch.slice(i, i + 80));
  };
  await insert(rows.filter((r) => r.date < cutoff));
  if (hourly) {
    try {
      const res = await invoiceProjectTime(ctx, hourly.id);
      if ("error" in res) console.error("seedProjects: billing skipped", res.error);
    } catch (e) {
      console.error("seedProjects: billing failed", e);
    }
  }
  await insert(rows.filter((r) => r.date >= cutoff));
}

function daysSpan(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
