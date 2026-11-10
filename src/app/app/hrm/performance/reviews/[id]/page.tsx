import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { ActionButton, ActionForm, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, PageHeader, StatusBadge } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { goalSummary, RATING_LABELS } from "@/lib/performance";
import { hrmTabs } from "../../../tabs";
import { ProgressCell } from "../../_components/progress";
import { deleteReview, reopenReview, saveManagerReview, submitSelfReview } from "../../actions";
import { liveGoalStatus, loadEmployee, loadReview, requirePerformance, reviewRoles } from "../../data";

export const metadata: Metadata = { title: "Performance review" };

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} — ${RATING_LABELS[n]}` }));

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePerformance();
  const { ws } = p;
  const orgId = ws.org.id;
  const r = await loadReview(orgId, Number((await params).id));
  if (!r) notFound();
  const roles = reviewRoles(p, r);
  if (!roles.canView) notFound();

  const today = todayYmd();
  const [emp, reviewer, goals] = await Promise.all([
    loadEmployee(orgId, r.employeeId),
    r.reviewerId ? loadEmployee(orgId, r.reviewerId) : null,
    db
      .select()
      .from(schema.goals)
      .where(and(eq(schema.goals.orgId, orgId), eq(schema.goals.employeeId, r.employeeId), eq(schema.goals.cycle, r.cycle)))
      .orderBy(asc(schema.goals.dueDate)),
  ]);
  if (!emp) notFound();
  const live = goals.map((g) => ({ ...g, live: liveGoalStatus(g, today) }));
  const summary = goalSummary(live.map((g) => ({ status: g.live, progress: g.progress, weight: g.weight })));
  const back = p.isHr ? `/app/hrm/performance?cycle=${encodeURIComponent(r.cycle)}` : "/app/hrm/performance/me";
  // The employee sees the manager assessment only once it is final.
  const showManager = r.status === "completed" || roles.canManage;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {emp.name} · {r.cycle} <StatusBadge value={r.status} />
          </span>
        }
        description={`${emp.designation} · Reviewer: ${reviewer?.name ?? "HR"}${r.completedAt ? ` · Completed ${formatDate(r.completedAt)}` : ""}`}
        tabs={p.isHr ? hrmTabs(ws, "performance") : undefined}
        actions={
          <Link href={back} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
            <ArrowLeft className="size-4" /> Back
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card title="Self-review">
            {roles.isSelf && r.status === "self_review" ? (
              <ActionForm action={submitSelfReview} resetOnSuccess={false} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <Select label="Your rating" name="selfRating" placeholder="Choose…" options={RATING_OPTIONS} defaultValue={r.selfRating ?? ""} />
                <Textarea label="Achievements, challenges and support needed" name="selfComments" rows={6} defaultValue={r.selfComments ?? ""} />
                <SubmitButton>Submit to reviewer</SubmitButton>
              </ActionForm>
            ) : r.selfRating || r.selfComments ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-ink-mute">Rating:</span> {r.selfRating ? `${r.selfRating}/5 — ${RATING_LABELS[r.selfRating]}` : "—"}
                </p>
                <p className="whitespace-pre-line text-ink-soft">{r.selfComments ?? "No comments."}</p>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">{r.status === "self_review" ? "Waiting for the employee's self-review." : "Skipped."}</p>
            )}
          </Card>

          {showManager && (
            <Card title="Manager assessment">
              {roles.canManage && r.status !== "completed" ? (
                <ActionForm action={saveManagerReview} resetOnSuccess={false} className="space-y-3">
                  <input type="hidden" name="id" value={r.id} />
                  <Select label="Overall rating" name="managerRating" placeholder="Choose…" options={RATING_OPTIONS} defaultValue={r.managerRating ?? ""} />
                  <Textarea label="Strengths" name="strengths" rows={4} defaultValue={r.strengths ?? ""} />
                  <Textarea label="Areas to improve" name="improvements" rows={4} defaultValue={r.improvements ?? ""} />
                  {r.status === "self_review" && <p className="text-xs text-ink-mute">The self-review hasn&apos;t been submitted; completing now skips it.</p>}
                  <div className="flex flex-wrap gap-2">
                    <button name="intent" value="draft" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-5 text-sm font-medium hover:border-ink">
                      Save draft
                    </button>
                    <button name="intent" value="complete" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
                      Complete review
                    </button>
                  </div>
                </ActionForm>
              ) : (
                <div className="space-y-3 text-sm">
                  <p>
                    <span className="text-ink-mute">Rating:</span> {r.managerRating ? `${r.managerRating}/5 — ${RATING_LABELS[r.managerRating]}` : "—"}
                  </p>
                  <div>
                    <p className="text-xs font-medium text-ink-mute">Strengths</p>
                    <p className="whitespace-pre-line">{r.strengths ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-ink-mute">Areas to improve</p>
                    <p className="whitespace-pre-line">{r.improvements ?? "—"}</p>
                  </div>
                  {roles.canManage && (
                    <ActionButton action={reopenReview} fields={{ id: r.id }}>
                      Reopen review
                    </ActionButton>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title={`Goals · ${r.cycle}`}>
            {live.length === 0 ? (
              <p className="text-sm text-ink-soft">No goals set for this cycle.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-ink-soft">
                  {summary.avgProgress}% weighted progress · {summary.onTrackPct}% on track
                </p>
                <ul className="space-y-4">
                  {live.map((g) => (
                    <li key={g.id}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{g.title}</p>
                        <StatusBadge value={g.live} />
                      </div>
                      <p className="mb-1 text-xs text-ink-mute">Due {formatDate(g.dueDate)}</p>
                      <ProgressCell id={g.id} progress={g.progress} editable={p.isHr || roles.isSelf} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          {p.isHr && (
            <ActionButton action={deleteReview} fields={{ id: r.id }} confirm={`Delete ${emp.name}'s ${r.cycle} review?`}>
              Delete review
            </ActionButton>
          )}
        </div>
      </div>
    </>
  );
}
