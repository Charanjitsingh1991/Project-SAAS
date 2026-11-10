import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm, Input, Select, StatusSelect, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, PageHeader, StatusBadge } from "@/components/app/ui";
import { schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { fromMinor } from "@/lib/money";
import { CANDIDATE_SOURCES, canHire, STAGE_LABELS } from "@/lib/recruitment";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../../../tabs";
import { addCandidateNote, hire, moveCandidate, rejectCandidate, updateCandidate } from "../../actions";
import { formOptions, hiredCount, loadCandidate, loadJob } from "../../data";

export const metadata: Metadata = { title: "Candidate" };

const MOVABLE = schema.CANDIDATE_STAGES.filter((s) => s !== "hired");

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "hrm", feature: "recruitment" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const c = await loadCandidate(orgId, Number((await params).id));
  if (!c) notFound();
  const [job, opts] = await Promise.all([loadJob(orgId, c.jobId), formOptions(orgId)]);
  if (!job) notFound();
  const hired = await hiredCount(orgId, job.id);
  const hireCheck = canHire(c.stage, job, hired);
  // Offer amount defaults: expected salary, else top of band.
  const offerDefault = c.expectedSalary || job.salaryMax || job.salaryMin;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name} <StatusBadge value={c.stage} />
          </span>
        }
        description={
          <>
            Applied for{" "}
            <Link href={`/app/hrm/recruitment/${job.id}`} className="underline">
              {job.title}
            </Link>{" "}
            on {formatDate(c.createdAt)} · in {STAGE_LABELS[c.stage]} since {formatDate(c.stageChangedAt)}
          </>
        }
        tabs={hrmTabs(ws, "recruitment")}
        actions={
          <>
            <Link href={`/app/hrm/recruitment/${job.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
              <ArrowLeft className="size-4" /> Pipeline
            </Link>
            {c.stage !== "hired" && <StatusSelect action={moveCandidate} id={c.id} value={c.stage} options={MOVABLE} name="stage" label="Move stage" />}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card title="Profile">
            <ActionForm action={updateCandidate} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={c.id} />
              <Input label="Full name" name="name" defaultValue={c.name} className="sm:col-span-2" />
              <Input label="Email" name="email" type="email" defaultValue={c.email ?? ""} />
              <Input label="Phone" name="phone" type="tel" defaultValue={c.phone ?? ""} />
              <Select label="Source" name="source" options={CANDIDATE_SOURCES.includes(c.source as (typeof CANDIDATE_SOURCES)[number]) ? CANDIDATE_SOURCES : [...CANDIDATE_SOURCES, c.source]} defaultValue={c.source} />
              <Select label="Rating" name="rating" placeholder="— Not rated —" options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} / 5` }))} defaultValue={c.rating ?? ""} />
              <Input label="Current company" name="currentCompany" defaultValue={c.currentCompany ?? ""} />
              <Input label="Notice period (days)" name="noticePeriodDays" type="number" min={0} defaultValue={c.noticePeriodDays ?? ""} />
              <Input label={`Expected annual salary (${cur})`} name="expectedSalary" inputMode="decimal" defaultValue={c.expectedSalary ? fromMinor(c.expectedSalary) : ""} className="sm:col-span-2" />
              <Textarea label="Resume link / notes" name="notes" rows={8} defaultValue={c.notes ?? ""} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <SubmitButton variant="outline">Save profile</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card title="Add a note">
            <ActionForm action={addCandidateNote} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <Textarea label="Interview feedback, call summary…" name="note" />
              <SubmitButton variant="outline">Add note</SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-6">
          {c.stage === "hired" ? (
            <Card title="Hired">
              <p className="text-sm text-ink-soft">
                {c.name} joined as an employee.{" "}
                {c.employeeId && (
                  <Link href={`/app/hrm/${c.employeeId}`} className="underline">
                    Open employee record
                  </Link>
                )}
              </p>
            </Card>
          ) : (
            <Card title="Hire" className="scroll-mt-6">
              <span id="hire" />
              {hireCheck.ok ? (
                <ActionForm action={hire} resetOnSuccess={false} className="space-y-3">
                  <input type="hidden" name="id" value={c.id} />
                  <Input label="Designation" name="designation" defaultValue={job.title} />
                  <Select label="Department" name="departmentId" placeholder="— None —" options={opts.departments} defaultValue={job.departmentId ?? ""} />
                  <Select label="Employment type" name="employmentType" options={schema.EMPLOYMENT_TYPES} defaultValue={job.employmentType} />
                  <Input label="Join date" name="joinDate" type="date" defaultValue={todayYmd()} />
                  <Input
                    label={`Offered annual ${ws.org.country === "AE" ? "package" : "CTC"} (${cur})`}
                    name="annualCtc"
                    inputMode="decimal"
                    defaultValue={offerDefault ? fromMinor(offerDefault) : ""}
                  />
                  <p className="text-xs text-ink-mute">
                    Creates the employee with an onboarding checklist. {hired + 1 >= job.openings ? "This fills the last position and closes the opening." : `${job.openings - hired - 1} position(s) will remain open.`}
                  </p>
                  <SubmitButton>Hire {c.name.split(" ")[0]}</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-soft">{hireCheck.reason}</p>
              )}
            </Card>
          )}

          {c.stage !== "hired" && c.stage !== "rejected" && (
            <Card title="Reject">
              <ActionForm action={rejectCandidate} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <Input label="Reason" name="reason" placeholder="e.g. Salary expectations, skills gap" />
                <SubmitButton variant="outline">Reject candidate</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {c.stage === "rejected" && (
            <Card title="Rejected">
              <p className="text-sm text-ink-soft">{c.rejectionReason ?? "No reason recorded."} Use the stage menu above to reconsider.</p>
            </Card>
          )}

          <Card title="Opening">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-mute">Positions</dt>
                <dd>
                  {hired}/{job.openings} filled
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-mute">Status</dt>
                <dd className="capitalize">{job.status.replace("_", " ")}</dd>
              </div>
              {c.expectedSalary > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-mute">Expected</dt>
                  <dd>{formatMoney(c.expectedSalary, cur)}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
