import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { StatusSelect } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { activeCount, avgTimeToHireDays, conversionPct, pipelineCounts, PIPELINE_STAGES, STAGE_LABELS } from "@/lib/recruitment";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { hrmTabs } from "../tabs";
import { bandOf } from "./_components/opening-fields";
import { setOpeningStatus } from "./actions";

export const metadata: Metadata = { title: "Recruitment" };

const FILTERS = ["active", "open", "draft", "on_hold", "closed", "all"] as const;

export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm", feature: "recruitment" });
  const orgId = ws.org.id;
  const cur = ws.org.currency;
  const { status: rawStatus } = await searchParams;
  const filter = FILTERS.find((f) => f === rawStatus) ?? "active";

  const [jobs, cands, depts] = await Promise.all([
    db.select().from(schema.jobOpenings).where(eq(schema.jobOpenings.orgId, orgId)).orderBy(desc(schema.jobOpenings.createdAt)),
    db
      .select({ jobId: schema.candidates.jobId, stage: schema.candidates.stage, createdAt: schema.candidates.createdAt, stageChangedAt: schema.candidates.stageChangedAt })
      .from(schema.candidates)
      .where(eq(schema.candidates.orgId, orgId)),
    db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.orgId, orgId)).orderBy(asc(schema.departments.name)),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const counts = pipelineCounts(cands);
  const openJobs = jobs.filter((j) => j.status === "open");
  const openPositions = openJobs.reduce((s, j) => s + j.openings, 0);
  const tth = avgTimeToHireDays(cands.filter((c) => c.stage === "hired").map((c) => ({ appliedAt: c.createdAt, hiredAt: c.stageChangedAt })));
  const shown = jobs.filter((j) => (filter === "all" ? true : filter === "active" ? j.status !== "closed" : j.status === filter));

  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Job openings, candidate pipelines and hiring — hires become employees with onboarding ready."
        tabs={hrmTabs(ws, "recruitment")}
        actions={
          <Link href="/app/hrm/recruitment/new" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/85">
            <Plus className="size-4" /> New opening
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open roles" value={openJobs.length} hint={`${openPositions} position${openPositions === 1 ? "" : "s"}`} tone="peach" />
        <Stat label="In pipeline" value={activeCount(counts)} hint={`${counts.applied + counts.screening + counts.interview + counts.offer + counts.hired + counts.rejected} total applicants`} tone="sky" />
        <Stat label="Hired" value={counts.hired} hint={`${conversionPct(counts, "hired") ?? 0}% of applicants`} tone="mint" />
        <Stat label="Avg time to hire" value={tth === null ? "—" : `${tth}d`} hint="Applied → hired" />
      </div>

      <Card title="Pipeline" className="mb-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[...PIPELINE_STAGES, "hired" as const, "rejected" as const].map((s) => (
            <div key={s} className="rounded-xl border border-line px-3 py-2">
              <p className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{STAGE_LABELS[s]}</p>
              <p className="mt-1 font-display text-2xl font-semibold">{counts[s]}</p>
              {s !== "rejected" && <p className="text-xs text-ink-mute">{conversionPct(counts, s) ?? 0}% reached</p>}
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "active" ? "/app/hrm/recruitment" : `/app/hrm/recruitment?status=${f}`}
            className={cn("rounded-full border px-3 py-1 text-sm capitalize", filter === f ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}
          >
            {f.replace("_", " ")}
          </Link>
        ))}
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState title={jobs.length ? "No openings match this filter" : "No job openings yet"}>
            {jobs.length ? null : <Link href="/app/hrm/recruitment/new" className="underline">Create your first opening</Link>}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Salary band</Th>
                <Th>Pipeline</Th>
                <Th>Filled</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => {
                const c = pipelineCounts(cands.filter((x) => x.jobId === j.id));
                return (
                  <tr key={j.id}>
                    <Td>
                      <Link href={`/app/hrm/recruitment/${j.id}`} className="font-medium hover:underline">
                        {j.title}
                      </Link>
                      <p className="text-xs text-ink-mute">
                        {[j.departmentId ? deptName.get(j.departmentId) : null, j.location, j.employmentType.replace("_", " "), `Posted ${formatDate(j.createdAt)}`].filter(Boolean).join(" · ")}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap">{bandOf(j.salaryMin, j.salaryMax, cur)}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-soft">
                      {PIPELINE_STAGES.map((s) => `${STAGE_LABELS[s].slice(0, 3)} ${c[s]}`).join(" · ")}
                    </Td>
                    <Td>
                      {c.hired}/{j.openings}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={j.status} />
                        <StatusSelect action={setOpeningStatus} id={j.id} value={j.status} options={schema.JOB_STATUSES} label={`Status of ${j.title}`} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
