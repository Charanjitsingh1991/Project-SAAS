import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { ActionForm, Input, Select, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createProject, setProjectStatus } from "./actions";

export const metadata: Metadata = { title: "Projects" };

const STATUSES = ["planning", "active", "on_hold", "done"] as const;

export default async function ProjectsPage() {
  const ws = await requireWorkspace({ module: "projects" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;

  const [projects, counts] = await Promise.all([
    db.select().from(schema.projects).where(eq(schema.projects.orgId, orgId)).orderBy(desc(schema.projects.createdAt)),
    db
      .select({ projectId: schema.tasks.projectId, status: schema.tasks.status, n: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(eq(schema.tasks.orgId, orgId))
      .groupBy(schema.tasks.projectId, schema.tasks.status),
  ]);

  const byProject = new Map<number, { done: number; total: number }>();
  let open = 0;
  let done = 0;
  for (const c of counts) {
    const p = byProject.get(c.projectId) ?? { done: 0, total: 0 };
    p.total += c.n;
    if (c.status === "done") {
      p.done += c.n;
      done += c.n;
    } else open += c.n;
    byProject.set(c.projectId, p);
  }

  const activeCount = projects.filter((p) => p.status === "active").length;
  const budget = projects.filter((p) => p.status !== "done").reduce((s, p) => s + p.budget, 0);

  return (
    <>
      <PageHeader title="Projects" description="Plan client work, track budgets and move tasks across the board." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active projects" value={activeCount} tone="mint" />
        <Stat label="Open budget" value={formatMoney(budget, cur)} tone="lime" />
        <Stat label="Open tasks" value={open} tone="butter" />
        <Stat label="Done tasks" value={done} tone="sky" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {projects.length === 0 ? (
            <EmptyState title="No projects yet">Create your first project with the form.</EmptyState>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {projects.map((p) => {
                const t = byProject.get(p.id) ?? { done: 0, total: 0 };
                const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
                return (
                  <Card key={p.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-lg font-semibold">{p.name}</h3>
                        <p className="text-sm text-ink-soft">{p.client || "No client"}</p>
                      </div>
                      <StatusBadge value={p.status} />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Budget</dt>
                        <dd className="tabular-nums">{formatMoney(p.budget, cur)}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Due</dt>
                        <dd>{p.dueDate ? formatDate(p.dueDate) : "—"}</dd>
                      </div>
                    </dl>
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-ink-soft">
                        <span>
                          {t.done}/{t.total} tasks done
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <StatusSelect action={setProjectStatus} id={p.id} value={p.status} options={STATUSES} />
                      <Link href={`/app/projects/${p.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                        Open board →
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <Card title="New project" className="self-start">
          <ActionForm action={createProject} className="space-y-3">
            <Input label="Name" name="name" placeholder="Website redesign" />
            <Input label="Client" name="client" placeholder="Acme Corp" />
            <div className="grid grid-cols-2 gap-3">
              <Input label={`Budget (${cur})`} name="budget" type="number" min={0} defaultValue={0} />
              <Input label="Due date" name="dueDate" type="date" />
            </div>
            <Select label="Status" name="status" options={[...STATUSES]} defaultValue="planning" />
            <SubmitButton className="w-full">Create project</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
