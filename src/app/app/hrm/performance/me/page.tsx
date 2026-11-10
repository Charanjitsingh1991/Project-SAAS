import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { cycleOf, goalSummary } from "@/lib/performance";
import { hrmTabs } from "../../tabs";
import { ProgressCell } from "../_components/progress";
import { liveGoalStatus, requirePerformance } from "../data";

export const metadata: Metadata = { title: "My performance" };

/** Self-service: own goals + reviews, plus reviews assigned to me as reviewer. Open to any member. */
export default async function MyPerformancePage() {
  const p = await requirePerformance();
  const { ws, me } = p;
  const orgId = ws.org.id;
  const today = todayYmd();
  const cycle = cycleOf(today);
  const header = (
    <PageHeader
      title="My performance"
      description="Your goals, check-ins and reviews."
      tabs={p.isHr ? hrmTabs(ws, "performance") : undefined}
      actions={
        p.isHr ? (
          <Link href="/app/hrm/performance" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
            Team performance
          </Link>
        ) : undefined
      }
    />
  );
  if (!me) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title="No employee profile linked">Ask HR to link your account to your employee record.</EmptyState>
        </Card>
      </>
    );
  }

  const [goals, mine, toReview] = await Promise.all([
    db.select().from(schema.goals).where(and(eq(schema.goals.orgId, orgId), eq(schema.goals.employeeId, me.id))).orderBy(desc(schema.goals.cycle), asc(schema.goals.dueDate)),
    db.select().from(schema.performanceReviews).where(and(eq(schema.performanceReviews.orgId, orgId), eq(schema.performanceReviews.employeeId, me.id))).orderBy(desc(schema.performanceReviews.createdAt)),
    db
      .select({ review: schema.performanceReviews, name: schema.employees.name })
      .from(schema.performanceReviews)
      .innerJoin(schema.employees, eq(schema.performanceReviews.employeeId, schema.employees.id))
      .where(and(eq(schema.performanceReviews.orgId, orgId), eq(schema.performanceReviews.reviewerId, me.id)))
      .orderBy(desc(schema.performanceReviews.createdAt)),
  ]);
  const live = goals.map((g) => ({ ...g, live: liveGoalStatus(g, today) }));
  const current = live.filter((g) => g.cycle === cycle);
  const summary = goalSummary(current.map((g) => ({ status: g.live, progress: g.progress, weight: g.weight })));
  const pendingSelf = mine.filter((r) => r.status === "self_review").length;
  const pendingTeam = toReview.filter((r) => r.review.status !== "completed").length;

  return (
    <>
      {header}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Goals · ${cycle}`} value={summary.total} hint={`${summary.counts.done} done`} tone="sky" />
        <Stat label="On track" value={summary.onTrackPct === null ? "—" : `${summary.onTrackPct}%`} hint={summary.avgProgress === null ? undefined : `${summary.avgProgress}% avg progress`} tone="mint" />
        <Stat label="Self-reviews due" value={pendingSelf} tone={pendingSelf ? "butter" : "card"} />
        <Stat label="Team reviews to do" value={pendingTeam} tone={pendingTeam ? "peach" : "card"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="My goals">
          {live.length === 0 ? (
            <EmptyState title="No goals yet">Your manager or HR will set goals with you.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Goal</Th>
                  <Th>Cycle</Th>
                  <Th>Due</Th>
                  <Th>Progress</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {live.map((g) => (
                  <tr key={g.id}>
                    <Td>
                      <p className="font-medium">{g.title}</p>
                      {g.description && <p className="text-xs text-ink-mute">{g.description}</p>}
                    </Td>
                    <Td>{g.cycle}</Td>
                    <Td className="whitespace-nowrap">{formatDate(g.dueDate)}</Td>
                    <Td>
                      <ProgressCell id={g.id} progress={g.progress} />
                    </Td>
                    <Td>
                      <StatusBadge value={g.live} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="My reviews">
            {mine.length === 0 ? (
              <p className="text-sm text-ink-soft">No reviews yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {mine.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/app/hrm/performance/reviews/${r.id}`} className="font-medium hover:underline">
                      {r.cycle}
                    </Link>
                    <span className="flex items-center gap-2 text-sm">
                      {r.status === "completed" && r.managerRating ? `${r.managerRating}/5` : null}
                      <StatusBadge value={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {toReview.length > 0 && (
            <Card title="Reviews I give">
              <ul className="divide-y divide-line">
                {toReview.map(({ review: r, name }) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/app/hrm/performance/reviews/${r.id}`} className="font-medium hover:underline">
                      {name} · {r.cycle}
                    </Link>
                    <StatusBadge value={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
