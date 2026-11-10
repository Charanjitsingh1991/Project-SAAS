import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { ActionForm, Input, StatusSelect, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createEmployee, setEmployeeStatus } from "./actions";
import { HRM_TABS } from "./tabs";

export const metadata: Metadata = { title: "People" };


export default async function HrmPage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;

  const [rows, [agg], pendingLeave] = await Promise.all([
    db.select().from(schema.employees).where(eq(schema.employees.orgId, orgId)).orderBy(desc(schema.employees.createdAt)),
    db
      .select({
        active: sql<number>`sum(case when ${schema.employees.status} = 'active' then 1 else 0 end)`,
        payroll: sql<number>`coalesce(sum(case when ${schema.employees.status} = 'active' then ${schema.employees.monthlySalary} else 0 end), 0)`,
        depts: sql<number>`count(distinct ${schema.employees.department})`,
      })
      .from(schema.employees)
      .where(eq(schema.employees.orgId, orgId)),
    db.$count(schema.leaveRequests, sql`${schema.leaveRequests.orgId} = ${orgId} and ${schema.leaveRequests.status} = 'pending'`),
  ]);

  return (
    <>
      <PageHeader title="People" description="Your employee directory — the record every other module reads from." tabs={HRM_TABS("people")} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active employees" value={agg?.active ?? 0} tone="mint" />
        <Stat label="Departments" value={agg?.depts ?? 0} />
        <Stat label="Monthly payroll" value={formatMoney(agg?.payroll ?? 0, ws.org.currency)} tone="lime" />
        <Stat label="Pending leave" value={pendingLeave} tone="butter" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Employees (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState title="No employees yet">Add your first team member with the form.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Department</Th>
                  <Th>Joined</Th>
                  <Th className="text-right">Salary / mo</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <Td>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-ink-mute">{e.designation}{e.email ? ` · ${e.email}` : ""}</p>
                    </Td>
                    <Td>{e.department}</Td>
                    <Td>{formatDate(e.joinDate)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(e.monthlySalary, ws.org.currency)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={e.status} />
                        <StatusSelect action={setEmployeeStatus} id={e.id} value={e.status} options={["active", "inactive"]} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Add employee">
          <ActionForm action={createEmployee} className="space-y-3">
            <Input label="Full name" name="name" placeholder="Priya Sharma" />
            <Input label="Email" name="email" type="email" placeholder="priya@company.com" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Department" name="department" placeholder="Engineering" />
              <Input label="Designation" name="designation" placeholder="Engineer" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Join date" name="joinDate" type="date" defaultValue={todayYmd()} />
              <Input label={`Salary / mo (${ws.org.currency})`} name="monthlySalary" type="number" min={0} placeholder="75000" />
            </div>
            <SubmitButton className="w-full">Add employee</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
