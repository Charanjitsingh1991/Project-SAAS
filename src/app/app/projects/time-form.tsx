"use client";

import { useState } from "react";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import type { FormState } from "@/lib/definitions";

type Project = { id: number; label: string; billingType: string };
type TaskOpt = { id: number; projectId: number; title: string };

/** Log-time form: tasks follow the chosen project and billable defaults from its billing type. */
export function TimeForm({
  action,
  projects,
  tasks,
  employees,
  defaultEmployeeId,
  defaultDate,
  defaultProjectId,
  defaultTaskId,
  lockProject,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  projects: Project[];
  tasks: TaskOpt[];
  employees?: { value: number; label: string }[];
  defaultEmployeeId?: number;
  defaultDate: string;
  defaultProjectId?: number;
  defaultTaskId?: number;
  lockProject?: boolean;
}) {
  const [projectId, setProjectId] = useState<number | undefined>(defaultProjectId ?? (lockProject ? undefined : undefined));
  const project = projects.find((p) => p.id === projectId);
  const taskOptions = tasks.filter((t) => t.projectId === projectId).map((t) => ({ value: t.id, label: t.title }));

  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {employees && <Select label="Person" name="employeeId" options={employees} defaultValue={defaultEmployeeId ?? ""} />}
      <Select
        label="Project"
        name="projectId"
        options={projects.map((p) => ({ value: p.id, label: p.label }))}
        placeholder="Choose project…"
        value={projectId ?? ""}
        onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)}
        disabled={lockProject}
      />
      {lockProject && projectId && <input type="hidden" name="projectId" value={projectId} />}
      <Select
        label="Task (optional)"
        name="taskId"
        options={taskOptions}
        placeholder={projectId ? "General work" : "Pick a project first"}
        defaultValue={defaultTaskId ?? ""}
        key={projectId ?? "none"}
      />
      <Input label="Date" name="date" type="date" defaultValue={defaultDate} required />
      <Input label="Hours" name="hours" type="number" step="0.25" min="0.25" max="24" required />
      <Select
        label="Billable"
        name="billable"
        options={[
          { value: "1", label: "Billable" },
          { value: "0", label: "Non-billable" },
        ]}
        key={`b-${project?.billingType ?? ""}`}
        defaultValue={project?.billingType === "non_billable" ? "0" : "1"}
      />
      <Input label="Description" name="description" className="sm:col-span-2" />
      <div className="flex items-end">
        <SubmitButton>Log time</SubmitButton>
      </div>
    </ActionForm>
  );
}
