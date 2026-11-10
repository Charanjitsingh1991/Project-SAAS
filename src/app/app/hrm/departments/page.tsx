import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { requireWorkspace } from "@/lib/tenancy";
import { createDepartment, deleteDepartment, updateDepartment } from "../actions";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const [depts, emps] = await Promise.all([
    db.select().from(schema.departments).where(eq(schema.departments.orgId, orgId)).orderBy(asc(schema.departments.name)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name, departmentId: schema.employees.departmentId, status: schema.employees.status })
      .from(schema.employees)
      .where(eq(schema.employees.orgId, orgId))
      .orderBy(asc(schema.employees.name)),
  ]);
  const live = emps.filter((e) => e.status !== "exited");
  const headOptions = live.map((e) => ({ value: e.id, label: e.name }));

  return (
    <>
      <PageHeader title="Departments" description="Teams, their heads and current headcount." tabs={hrmTabs(ws, "departments")} />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {depts.length === 0 && (
            <Card>
              <EmptyState title="No departments yet">Create one on the right.</EmptyState>
            </Card>
          )}
          {depts.map((d) => {
            const count = live.filter((e) => e.departmentId === d.id).length;
            return (
              <Card key={d.id} title={d.name} actions={<Badge tone="sky">{count} {count === 1 ? "person" : "people"}</Badge>}>
                <ActionForm action={updateDepartment} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="id" value={d.id} />
                  <Input label="Name" name="name" defaultValue={d.name} />
                  <Select label="Department head" name="headEmployeeId" placeholder="— None —" options={headOptions} defaultValue={d.headEmployeeId ?? ""} />
                  <SubmitButton variant="outline">Save</SubmitButton>
                </ActionForm>
                <div className="mt-3">
                  <ActionButton action={deleteDepartment} fields={{ id: d.id }} confirm={`Delete ${d.name}? ${count} employee(s) will be left without a department.`}>
                    Delete department
                  </ActionButton>
                </div>
              </Card>
            );
          })}
        </div>
        <Card title="New department" className="h-fit">
          <ActionForm action={createDepartment} className="space-y-3">
            <Input label="Name" name="name" placeholder="e.g. Customer Success" />
            <Select label="Department head" name="headEmployeeId" placeholder="— None —" options={headOptions} />
            <SubmitButton>Add department</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
