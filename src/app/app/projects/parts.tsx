import Link from "next/link";
import { Badge, StatusBadge } from "@/components/app/ui";
import { ActionForm, Input, Select, StatusSelect, SubmitButton, Textarea } from "@/components/app/forms";
import { BILLING_TYPES, PRIORITIES, PROJECT_STATUSES } from "@/db/schema";
import type { FormState } from "@/lib/definitions";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PROJECT_TONES } from "./tones";

export function Bar({ pct, className = "bg-ink", danger }: { pct: number; className?: string; danger?: boolean }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", danger ? "bg-signal" : className)} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Avatar({ name }: { name?: string | null }) {
  if (!name) return <span className="text-xs text-ink-mute">Unassigned</span>;
  return (
    <span title={name} className="inline-grid size-6 place-items-center rounded-full bg-lilac text-[10px] font-semibold text-ink">
      {initials(name)}
    </span>
  );
}

export function PriorityBadge({ value }: { value: string }) {
  return <StatusBadge value={value} />;
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-block text-sm text-ink-soft hover:text-ink">
      ← {children}
    </Link>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return <Badge>{children}</Badge>;
}

export type Opt = { value: string | number; label: string };

export type ProjectDefaults = {
  id?: number;
  name?: string;
  companyId?: number | null;
  description?: string | null;
  ownerId?: number | null;
  color?: string;
  billingType?: string;
  budget?: string;
  hourlyRate?: string;
  startDate?: string | null;
  dueDate?: string | null;
  status?: string;
};

export function ProjectForm({
  action,
  companies,
  members,
  defaults = {},
  submit,
  resetOnSuccess,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  companies: Opt[];
  members: Opt[];
  defaults?: ProjectDefaults;
  submit: string;
  resetOnSuccess?: boolean;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <Input label="Project name" name="name" defaultValue={defaults.name} required className="sm:col-span-2" />
      <Select label="Client" name="companyId" options={companies} placeholder="Internal / no client" defaultValue={defaults.companyId ?? ""} />
      <Select label="Billing type" name="billingType" options={BILLING_TYPES} defaultValue={defaults.billingType ?? "fixed"} />
      <Input label="Budget" name="budget" type="number" step="0.01" min="0" defaultValue={defaults.budget} />
      <Input label="Hourly rate" name="hourlyRate" type="number" step="0.01" min="0" defaultValue={defaults.hourlyRate} />
      <Input label="Start date" name="startDate" type="date" defaultValue={defaults.startDate ?? ""} />
      <Input label="Due date" name="dueDate" type="date" defaultValue={defaults.dueDate ?? ""} />
      <Select label="Status" name="status" options={PROJECT_STATUSES} defaultValue={defaults.status ?? "planning"} />
      <Select label="Colour" name="color" options={PROJECT_TONES} defaultValue={defaults.color ?? "lilac"} />
      <Select label="Owner" name="ownerId" options={members} placeholder="Me" defaultValue={defaults.ownerId ?? ""} />
      <Textarea label="Description" name="description" rows={3} defaultValue={defaults.description ?? ""} className="sm:col-span-2 lg:col-span-3" />
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton>{submit}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type TaskDefaults = {
  id?: number;
  title?: string;
  description?: string | null;
  assigneeId?: number | null;
  status?: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  milestoneId?: number | null;
};

export function TaskForm({
  action,
  projectId,
  employees,
  milestones,
  defaults = {},
  submit,
  full,
  statuses,
  resetOnSuccess,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  projectId?: number;
  employees: Opt[];
  milestones: Opt[];
  defaults?: TaskDefaults;
  submit: string;
  full?: boolean;
  statuses?: readonly string[];
  resetOnSuccess?: boolean;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <Input label="Title" name="title" defaultValue={defaults.title} required className="sm:col-span-2" />
      <Select label="Assignee" name="assigneeId" options={employees} placeholder="Unassigned" defaultValue={defaults.assigneeId ?? ""} />
      <Select label="Priority" name="priority" options={PRIORITIES} defaultValue={defaults.priority ?? "medium"} />
      {statuses && <Select label="Status" name="status" options={statuses} defaultValue={defaults.status} />}
      {full && <Input label="Start date" name="startDate" type="date" defaultValue={defaults.startDate ?? ""} />}
      <Input label="Due date" name="dueDate" type="date" defaultValue={defaults.dueDate ?? ""} />
      <Input label="Estimate (hours)" name="estimateHours" type="number" step="0.25" min="0" defaultValue={defaults.estimateHours ?? ""} />
      <Select label="Milestone" name="milestoneId" options={milestones} placeholder="None" defaultValue={defaults.milestoneId ?? ""} />
      {full && <Textarea label="Description" name="description" rows={4} defaultValue={defaults.description ?? ""} className="sm:col-span-2 lg:col-span-4" />}
      <div className="flex items-end">
        <SubmitButton>{submit}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export { StatusSelect };
