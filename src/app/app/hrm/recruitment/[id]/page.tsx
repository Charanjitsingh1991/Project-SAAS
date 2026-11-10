import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, Plus, Star } from "lucide-react";
import { ActionButton, ActionForm, Input, Select, StatusSelect, SubmitButton, Textarea } from "@/components/app/forms";
import { Kanban, type KanbanColumn } from "@/components/app/kanban";
import { Card, PageHeader, Stat } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/format";
import { activeCount, CANDIDATE_SOURCES, conversionPct, pipelineCounts, STAGE_LABELS } from "@/lib/recruitment";
import { canManage } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../../tabs";
import { bandOf, OpeningFields } from "../_components/opening-fields";
import { addCandidate, deleteOpening, moveCandidate, setOpeningStatus, updateOpening } from "../actions";
import { formOptions, loadJob } from "../data";

export const metadata: Metadata = { title: "Job opening" };

const TONES: Record<string, string> = { applied: "bg-card", screening: "bg-sky", interview: "bg-lilac", offer: "bg-butter", hired: "bg-mint", rejected: "bg-rose" };
// "hired" is set only by the Hire action on the candidate page.
const MOVABLE = schema.CANDIDATE_STAGES.filter((s) => s !== "hired");

export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "hrm", feature: "recruitment" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const job = await loadJob(orgId, Number((await params).id));
  if (!job) notFound();

  const [cands, opts] = await Promise.all([
    db
      .select()
      .from(schema.candidates)
      .where(and(eq(schema.candidates.orgId, orgId), eq(schema.candidates.jobId, job.id)))
      .orderBy(desc(schema.candidates.sortOrder), desc(schema.candidates.createdAt)),
    formOptions(orgId),
  ]);
  const counts = pipelineCounts(cands);
  const dept = opts.departments.find((d) => d.value === job.departmentId)?.label;
  const manager = opts.people.find((p) => p.value === job.hiringManagerId)?.label;
  const nowMs = Date.now();

  const columns: KanbanColumn[] = schema.CANDIDATE_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s], tone: TONES[s] }));
  const items = cands.map((c) => {
    const days = Math.max(0, Math.floor((nowMs - c.stageChangedAt.getTime()) / 86_400_000));
    return {
      id: c.id,
      column: c.stage,
      node: (
        <article className="rounded-2xl border border-line bg-card p-3 shadow-sm">
          <Link href={`/app/hrm/recruitment/candidates/${c.id}`} className="font-medium hover:underline">
            {c.name}
          </Link>
          <p className="mt-0.5 text-xs text-ink-mute">
            {[c.currentCompany, c.source.replace("_", " "), `${days}d in stage`].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-0.5" aria-label={c.rating ? `Rated ${c.rating} of 5` : "Not rated"}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`size-3.5 ${c.rating && n <= c.rating ? "fill-ink text-ink" : "text-ink/20"}`} />
              ))}
            </span>
            {c.stage === "hired" ? (
              c.employeeId ? (
                <Link href={`/app/hrm/${c.employeeId}`} className="text-xs underline">
                  Employee
                </Link>
              ) : null
            ) : c.stage === "offer" ? (
              <Link href={`/app/hrm/recruitment/candidates/${c.id}#hire`} className="rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-paper">
                Hire
              </Link>
            ) : (
              <StatusSelect action={moveCandidate} id={c.id} value={c.stage} options={MOVABLE} name="stage" label={`Stage of ${c.name}`} />
            )}
          </div>
          {c.expectedSalary > 0 && <p className="mt-1 text-xs text-ink-soft">Expects {formatMoney(c.expectedSalary, cur)}</p>}
        </article>
      ),
    };
  });

  return (
    <>
      <PageHeader
        title={job.title}
        description={[dept, job.location, job.employmentType.replace("_", " "), bandOf(job.salaryMin, job.salaryMax, cur), manager ? `Hiring manager: ${manager}` : null].filter(Boolean).join(" · ")}
        tabs={hrmTabs(ws, "recruitment")}
        actions={
          <>
            <Link href="/app/hrm/recruitment" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
              <ArrowLeft className="size-4" /> All openings
            </Link>
            <StatusSelect action={setOpeningStatus} id={job.id} value={job.status} options={schema.JOB_STATUSES} label="Opening status" />
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Positions filled" value={`${counts.hired}/${job.openings}`} hint={job.status === "closed" ? "Opening closed" : `Status: ${job.status.replace("_", " ")}`} tone={counts.hired >= job.openings ? "mint" : "peach"} />
        <Stat label="In pipeline" value={activeCount(counts)} hint={`${cands.length} applicants`} tone="sky" />
        <Stat label="Reached interview" value={`${conversionPct(counts, "interview") ?? 0}%`} hint={`${counts.interview} interviewing now`} />
        <Stat label="Offers out" value={counts.offer} hint={`${counts.rejected} rejected`} tone="butter" />
      </div>

      <p className="mb-3 text-sm text-ink-soft">Drag cards between stages. Offer-stage candidates are hired from their profile, which creates the employee record.</p>
      <Kanban columns={columns} items={items} onMove={moveCandidate} field="stage" emptyLabel="No candidates" />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <details className="h-fit rounded-[20px] border border-line bg-card" open={cands.length === 0} id="add">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 font-display text-base font-semibold">
            <Plus className="size-4" /> Add candidate
          </summary>
          <div className="border-t border-line p-5">
            {job.status === "closed" ? (
              <p className="text-sm text-ink-soft">This opening is closed. Reopen it to add candidates.</p>
            ) : (
              <ActionForm action={addCandidate} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="jobId" value={job.id} />
                <Input label="Full name" name="name" className="sm:col-span-2" />
                <Input label="Email" name="email" type="email" />
                <Input label="Phone" name="phone" type="tel" placeholder={ws.org.country === "AE" ? "+971 50 123 4567" : "+91 98765 43210"} />
                <Select label="Source" name="source" options={CANDIDATE_SOURCES} defaultValue="careers_page" />
                <Select label="Rating" name="rating" placeholder="— Not rated —" options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} / 5` }))} />
                <Input label="Current company" name="currentCompany" />
                <Input label="Notice period (days)" name="noticePeriodDays" type="number" min={0} />
                <Input label={`Expected annual salary (${cur})`} name="expectedSalary" inputMode="decimal" className="sm:col-span-2" />
                <Textarea label="Resume link / notes" name="notes" className="sm:col-span-2" placeholder="https://… or interview notes" />
                <div className="sm:col-span-2">
                  <SubmitButton>Add to Applied</SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>
        </details>

        <details className="h-fit rounded-[20px] border border-line bg-card">
          <summary className="cursor-pointer px-5 py-3.5 font-display text-base font-semibold">Edit opening</summary>
          <div className="border-t border-line p-5">
            <ActionForm action={updateOpening} resetOnSuccess={false} className="space-y-4">
              <input type="hidden" name="id" value={job.id} />
              <OpeningFields job={job} departments={opts.departments} people={opts.people} currency={cur} />
              <SubmitButton variant="outline">Save opening</SubmitButton>
            </ActionForm>
            {canManage(ws.role) && (
              <div className="mt-4 border-t border-line pt-4">
                <ActionButton action={deleteOpening} fields={{ id: job.id }} confirm={`Delete "${job.title}" and its ${cands.length} candidate(s)? Hired employees are kept.`}>
                  Delete opening
                </ActionButton>
              </div>
            )}
          </div>
        </details>
      </div>

      {job.description && (
        <Card title="Job description" className="mt-6">
          <p className="text-sm whitespace-pre-line text-ink-soft">{job.description}</p>
        </Card>
      )}
    </>
  );
}
