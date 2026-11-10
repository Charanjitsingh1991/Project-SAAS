import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { ActionForm, Input, Select, StatusSelect, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createLeave, setLeaveStatus } from "../actions";
import { HRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Leave" };

function days(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
}

export default async function LeavePage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;

  const [rows, emps] = await Promise.all([
    db
      .select({ leave: schema.leaveRequests, employee: schema.employees.name })
      .from(schema.leaveRequests)
      .innerJoin(schema.employees, eq(schema.leaveRequests.employeeId, schema.employees.id))
      .where(eq(schema.leaveRequests.orgId, orgId))
      .orderBy(desc(schema.leaveRequests.createdAt)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name })
      .from(schema.employees)
      .where(eq(schema.employees.orgId, orgId))
      .orderBy(asc(schema.employees.name)),
  ]);

  return (
    <>
      <PageHeader title="People" description="Log leave requests and approve or reject them." tabs={HRM_TABS("leave")} />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Leave requests (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState title="No leave requests" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>Dates</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ leave: l, employee }) => (
                  <tr key={l.id}>
                    <Td className="font-medium">{employee}</Td>
                    <Td className="capitalize">{l.type}</Td>
                    <Td>
                      {formatDate(l.startDate)} → {formatDate(l.endDate)}
                      <span className="ml-1 text-xs text-ink-mute">({days(l.startDate, l.endDate)}d)</span>
                    </Td>
                    <Td className="max-w-[200px] truncate text-ink-soft">{l.reason ?? "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={l.status} />
                        <StatusSelect action={setLeaveStatus} id={l.id} value={l.status} options={["pending", "approved", "rejected"]} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Log leave">
          {emps.length === 0 ? (
            <EmptyState title="Add employees first" />
          ) : (
            <ActionForm action={createLeave} className="space-y-3">
              <Select label="Employee" name="employeeId" placeholder="Choose…" options={emps.map((e) => ({ value: e.id, label: e.name }))} />
              <Select label="Type" name="type" options={["casual", "sick", "earned", "unpaid"]} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="From" name="startDate" type="date" defaultValue={todayYmd()} />
                <Input label="To" name="endDate" type="date" defaultValue={todayYmd()} />
              </div>
              <Textarea label="Reason" name="reason" />
              <SubmitButton className="w-full">Log leave</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
