import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { averageRating, cycleOf, goalSummary, ratingDistribution } from "@/lib/performance";
import { hrmTabs } from "../tabs";
import { ProgressCell } from "./_components/progress";
import { createGoal, createReview, deleteGoal, startReviewCycle } from "./actions";
import { liveGoalStatus, requirePerformance } from "./data";

export const metadata: Metadata = { title: "Performance" };

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ cycle?: string; employee?: string }> }) {
  const { ws } = await requirePerformance({ manage: true });
  const orgId = ws.org.id;
  const today = todayYmd();
  const sp = await searchParams;
  const current = cycleOf(today);

  const [goals, reviews, people] = await Promise.all([
    db
      .select({ goal: schema.goals, name: schema.employees.name })
      .from(schema.goals)
      .innerJoin(schema.employees, eq(schema.goals.employeeId, schema.employees.id))
      .where(eq(schema.goals.orgId, orgId))
      .orderBy(asc(schema.employees.name), asc(schema.goals.dueDate)),
    db
      .select({ review: schema.performanceReviews, name: schema.employees.name })
      .from(schema.performanceReviews)
      .innerJoin(schema.employees, eq(schema.performanceReviews.employeeId, schema.employees.id))
      .where(eq(schema.performanceReviews.orgId, orgId))
      .orderBy(desc(schema.performanceReviews.createdAt)),
    db
      .select({ value: schema.employees.id, label: schema.employees.name })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited")))
      .orderBy(asc(schema.employees.name)),
  ]);

  const cycles = [...new Set([current, ...goals.map((g) => g.goal.cycle), ...reviews.map((r) => r.review.cycle)])].sort().reverse();
  const cycle = cycles.includes(sp.cycle ?? "") ? sp.cycle! : current;
  const empFilter = Number(sp.employee) || null;
  const nameOf = new Map(people.map((p) => [p.value, p.label]));

  const cycleGoals = goals
    .filter((g) => g.goal.cycle === cycle && (!empFilter || g.goal.employeeId === empFilter))
    .map((g) => ({ ...g, live: liveGoalStatus(g.goal, today) }));
  const cycleReviews = reviews.filter((r) => r.review.cycle === cycle && (!empFilter || r.review.employeeId === empFilter));
  const summary = goalSummary(cycleGoals.map((g) => ({ status: g.live, progress: g.goal.progress, weight: g.goal.weight })));
  const completed = cycleReviews.filter((r) => r.review.status === "completed");
  const avg = averageRating(completed.map((r) => r.review.managerRating));
  const dist = ratingDistribution(completed.map((r) => r.review.managerRating));
  const maxDist = Math.max(1, ...dist);
  const qs = (c: string) => `/app/hrm/performance?cycle=${encodeURIComponent(c)}${empFilter ? `&employee=${empFilter}` : ""}`;

  return (
    <>
      <PageHeader title="Performance" description="Goals, check-ins and review cycles. Employees update their own goals and self-reviews from My performance." tabs={hrmTabs(ws, "performance")} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {cycles.map((c) => (
          <Link key={c} href={qs(c)} className={`rounded-full border px-3 py-1 text-sm ${c === cycle ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}>
            {c}
          </Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="cycle" value={cycle} />
          <select name="employee" defaultValue={empFilter ?? ""} aria-label="Filter by employee" className="h-9 rounded-full border border-line bg-paper/60 px-3 text-sm">
            <option value="">All employees</option>
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button className="h-9 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">Filter</button>
        </form>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Goals on track" value={summary.onTrackPct === null ? "—" : `${summary.onTrackPct}%`} hint={`${summary.total} goals · ${summary.counts.done} done`} tone="mint" />
        <Stat label="At risk / off track" value={summary.counts.at_risk + summary.counts.off_track} hint={`${summary.counts.off_track} off track`} tone="butter" />
        <Stat label="Avg progress" value={summary.avgProgress === null ? "—" : `${summary.avgProgress}%`} hint="Weighted by goal weight" tone="sky" />
        <Stat label="Avg rating" value={avg === null ? "—" : `${avg} / 5`} hint={`${completed.length}/${cycleReviews.length} reviews completed`} tone="lilac" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-6">
          <Card title={`Goals · ${cycle}`}>
            {cycleGoals.length === 0 ? (
              <EmptyState title="No goals in this cycle">Add one on the right.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Goal</Th>
                    <Th>Due</Th>
                    <Th>Progress</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {cycleGoals.map(({ goal: g, name, live }) => (
                    <tr key={g.id}>
                      <Td>
                        <Link href={`/app/hrm/${g.employeeId}`} className="hover:underline">
                          {name}
                        </Link>
                      </Td>
                      <Td>
                        <p className="font-medium">{g.title}</p>
                        {g.description && <p className="max-w-xs truncate text-xs text-ink-mute">{g.description}</p>}
                        {g.weight > 1 && <p className="text-xs text-ink-mute">Weight ×{g.weight}</p>}
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(g.dueDate)}</Td>
                      <Td>
                        <ProgressCell id={g.id} progress={g.progress} />
                      </Td>
                      <Td>
                        <StatusBadge value={live} />
                      </Td>
                      <Td>
                        <ActionButton action={deleteGoal} fields={{ id: g.id }} confirm={`Delete goal "${g.title}"?`}>
                          Delete
                        </ActionButton>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={`Reviews · ${cycle}`}>
            {cycleReviews.length === 0 ? (
              <EmptyState title="No reviews in this cycle">Start the cycle on the right to open a review for everyone.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Reviewer</Th>
                    <Th>Self</Th>
                    <Th>Manager</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {cycleReviews.map(({ review: r, name }) => (
                    <tr key={r.id}>
                      <Td>
                        <Link href={`/app/hrm/performance/reviews/${r.id}`} className="font-medium hover:underline">
                          {name}
                        </Link>
                      </Td>
                      <Td>{r.reviewerId ? (nameOf.get(r.reviewerId) ?? "—") : <span className="text-ink-mute">HR</span>}</Td>
                      <Td>{r.selfRating ? `${r.selfRating}/5` : "—"}</Td>
                      <Td>{r.managerRating ? `${r.managerRating}/5` : "—"}</Td>
                      <Td>
                        <StatusBadge value={r.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="New goal">
            <ActionForm action={createGoal} className="space-y-3">
              <Select label="Employee" name="employeeId" placeholder="Choose…" options={people} defaultValue={empFilter ?? ""} />
              <Input label="Goal" name="title" placeholder="e.g. Close FY books within 5 working days" />
              <Input label="Details (optional)" name="description" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Cycle" name="cycle" defaultValue={cycle} />
                <Input label="Due date" name="dueDate" type="date" />
                <Input label="Progress %" name="progress" type="number" min={0} max={100} defaultValue={0} />
                <Input label="Weight (1–10)" name="weight" type="number" min={1} max={10} defaultValue={1} />
              </div>
              <SubmitButton>Add goal</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Review cycle">
            <ActionForm action={startReviewCycle} className="space-y-3">
              <Input label="Cycle" name="cycle" defaultValue={cycle} />
              <p className="text-xs text-ink-mute">Opens a self-review for every active employee who doesn&apos;t have one yet; their reporting manager is the reviewer.</p>
              <SubmitButton variant="outline">Start cycle</SubmitButton>
            </ActionForm>
            <div className="my-4 border-t border-line" />
            <ActionForm action={createReview} className="space-y-3">
              <Select label="Single review for" name="employeeId" placeholder="Choose…" options={people} />
              <Select label="Reviewer" name="reviewerId" placeholder="— Reporting manager —" options={people} />
              <input type="hidden" name="cycle" value={cycle} />
              <SubmitButton variant="outline">Start review</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Rating distribution">
            {completed.length === 0 ? (
              <p className="text-sm text-ink-soft">No completed reviews in {cycle} yet.</p>
            ) : (
              <ul className="space-y-2">
                {dist.map((n, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-6 font-mono">{i + 1}★</span>
                    <span className="h-2 flex-1 rounded-full bg-paper-2">
                      <span className="block h-2 rounded-full bg-ink" style={{ width: `${(n / maxDist) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
