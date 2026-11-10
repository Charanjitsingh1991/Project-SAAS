import { Input, Select, Textarea } from "@/components/app/forms";
import { schema } from "@/db";
import { formatMoney, fromMinor } from "@/lib/money";

export function bandOf(min: number, max: number, cur: string) {
  if (!min && !max) return "Not disclosed";
  if (min && max) return `${formatMoney(min, cur)} – ${formatMoney(max, cur)}`;
  return min ? `From ${formatMoney(min, cur)}` : `Up to ${formatMoney(max, cur)}`;
}

type Opening = typeof schema.jobOpenings.$inferSelect;
type Option = { value: number; label: string };

export function OpeningFields({ job, departments, people, currency }: { job?: Opening; departments: Option[]; people: Option[]; currency: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Job title" name="title" defaultValue={job?.title} placeholder="e.g. Senior Accountant" className="sm:col-span-2" />
      <Select label="Department" name="departmentId" placeholder="— None —" options={departments} defaultValue={job?.departmentId ?? ""} />
      <Select label="Hiring manager" name="hiringManagerId" placeholder="— None —" options={people} defaultValue={job?.hiringManagerId ?? ""} />
      <Input label="Location" name="location" defaultValue={job?.location ?? ""} placeholder="e.g. Dubai / Bengaluru / Remote" />
      <Select label="Employment type" name="employmentType" options={schema.EMPLOYMENT_TYPES} defaultValue={job?.employmentType ?? "full_time"} />
      <Input label="Positions" name="openings" type="number" min={1} defaultValue={job?.openings ?? 1} />
      <Select label="Status" name="status" options={schema.JOB_STATUSES} defaultValue={job?.status ?? "open"} />
      <Input label={`Annual salary from (${currency})`} name="salaryMin" inputMode="decimal" defaultValue={job?.salaryMin ? fromMinor(job.salaryMin) : ""} />
      <Input label={`Annual salary to (${currency})`} name="salaryMax" inputMode="decimal" defaultValue={job?.salaryMax ? fromMinor(job.salaryMax) : ""} />
      <Textarea label="Description" name="description" rows={6} defaultValue={job?.description ?? ""} className="sm:col-span-2" placeholder="Responsibilities, requirements, benefits…" />
    </div>
  );
}
