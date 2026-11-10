import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { Download, Plus, Search, Upload } from "lucide-react";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { addDaysYmd, formatDate, initials, todayYmd } from "@/lib/format";
import { attritionPct, expiryAlerts, expiryText } from "@/lib/hrm";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { inviteAllToPortal } from "./portal-actions";
import { hrmTabs } from "./tabs";

export const metadata: Metadata = { title: "People" };

type SP = { q?: string; dept?: string; status?: string; type?: string };

export default async function HrmDirectoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const orgId = ws.org.id;
  const today = todayYmd();

  const [emps, depts, pendingInvites] = await Promise.all([
    db.select().from(schema.employees).where(eq(schema.employees.orgId, orgId)).orderBy(asc(schema.employees.code)),
    db.select().from(schema.departments).where(eq(schema.departments.orgId, orgId)).orderBy(asc(schema.departments.name)),
    db
      .select({ email: schema.invites.email })
      .from(schema.invites)
      .where(and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date()))),
  ]);
  const pendingEmails = new Set(pendingInvites.map((i) => i.email.toLowerCase()));
  const invitable = new Set(emps.filter((e) => e.status === "active" && !e.userId && e.email && !pendingEmails.has(e.email.toLowerCase())).map((e) => e.email!.toLowerCase())).size;
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const empName = new Map(emps.map((e) => [e.id, e.name]));

  const monthStart = `${today.slice(0, 7)}-01`;
  const yearAgo = addDaysYmd(today, -365);
  const active = emps.filter((e) => e.status === "active").length;
  const onNotice = emps.filter((e) => e.status === "notice").length;
  const joiners = emps.filter((e) => e.joinDate >= monthStart && e.joinDate <= today).length;
  const exits12 = emps.filter((e) => e.status === "exited" && e.exitDate && e.exitDate > yearAgo && e.exitDate <= today).length;
  const headStart = emps.filter((e) => e.joinDate <= yearAgo && (e.status !== "exited" || !e.exitDate || e.exitDate > yearAgo)).length;
  const headNow = emps.filter((e) => e.status !== "exited").length;
  const attrition = attritionPct(exits12, headStart, headNow);
  const fields = packFor(ws).hr.employeeFields;
  const alertsByEmp = new Map(emps.filter((e) => e.status !== "exited").map((e) => [e.id, expiryAlerts(fields, e, today)] as const).filter(([, a]) => a.length));

  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = emps.filter(
    (e) =>
      (!q || [e.name, e.code, e.email ?? "", e.designation].some((s) => s.toLowerCase().includes(q))) &&
      (!sp.dept || String(e.departmentId) === sp.dept) &&
      (!sp.status || e.status === sp.status) &&
      (!sp.type || e.employmentType === sp.type),
  );
  const filtered = !!(q || sp.dept || sp.status || sp.type);

  return (
    <>
      <PageHeader
        title="People"
        description="Employee directory, lifecycle, leave and attendance in one place."
        tabs={hrmTabs(ws, "directory")}
        actions={
          <>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page */}
            <a href="/api/export/employees" className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:border-ink">
              <Download className="size-4" /> Export CSV
            </a>
            <Link href="/app/hrm/import" className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:border-ink">
              <Upload className="size-4" /> Import CSV
            </Link>
            <Link href="/app/hrm/new" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-paper hover:bg-ink/90">
              <Plus className="size-4" /> Add employee
            </Link>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active" value={active} hint={`${emps.length} records in total`} tone="mint" />
        <Stat label="Joined this month" value={joiners} tone="sky" />
        <Stat label="On notice" value={onNotice} tone="butter" />
        <Stat label="Attrition (12 mo)" value={`${attrition}%`} hint={`${exits12} exit${exits12 === 1 ? "" : "s"}`} tone="peach" />
      </div>

      {invitable > 0 && (
        <Card title="Employee portal" className="mb-6">
          <ActionForm action={inviteAllToPortal} resetOnSuccess={false} className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-soft">
              {invitable} active employee{invitable === 1 ? " has" : "s have"} an email but no portal access or pending invite.
            </p>
            <SubmitButton variant="outline">Invite all to portal</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {alertsByEmp.size > 0 && (
        <Card title={`Document renewals · ${alertsByEmp.size} employee${alertsByEmp.size === 1 ? "" : "s"}`} className="mb-6">
          <ul className="divide-y divide-line/70 text-sm">
            {[...alertsByEmp].map(([id, alerts]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/app/hrm/${id}?tab=compensation`} className="font-medium hover:underline">
                  {empName.get(id)}
                </Link>
                <span className="flex flex-wrap gap-1.5">
                  {alerts.map((a) => (
                    <Badge key={a.key} tone={a.expired || a.daysLeft <= 14 ? "rose" : "butter"}>
                      {expiryText(a)}
                    </Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" method="get">
        <Input label="Search" name="q" defaultValue={sp.q ?? ""} placeholder="Name, code, email, designation" />
        <Select label="Department" name="dept" placeholder="All" options={depts.map((d) => ({ value: d.id, label: d.name }))} defaultValue={sp.dept ?? ""} />
        <Select label="Status" name="status" placeholder="All" options={[...schema.EMPLOYEE_STATUSES]} defaultValue={sp.status ?? ""} />
        <Select label="Type" name="type" placeholder="All" options={[...schema.EMPLOYMENT_TYPES]} defaultValue={sp.type ?? ""} />
        <div className="flex items-end gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-paper">
            <Search className="size-4" /> Filter
          </button>
          {filtered && (
            <Link href="/app/hrm" className="inline-flex h-10 items-center text-sm text-ink-soft hover:text-ink">
              Clear
            </Link>
          )}
        </div>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={emps.length ? "No one matches these filters" : "No employees yet"}>
            {emps.length ? "Try clearing the filters." : "Add your first employee to start building the directory."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Department</Th>
                <Th>Designation</Th>
                <Th>Manager</Th>
                <Th>Type</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-paper/60">
                  <Td className="font-mono text-xs text-ink-soft">{e.code}</Td>
                  <Td>
                    <Link href={`/app/hrm/${e.id}`} className="flex items-center gap-3 font-medium hover:underline">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-mint text-xs font-semibold">{initials(e.name)}</span>
                      <span>
                        {e.name}
                        {e.email && <span className="block text-xs font-normal text-ink-mute">{e.email}</span>}
                      </span>
                    </Link>
                  </Td>
                  <Td>{e.departmentId ? (deptName.get(e.departmentId) ?? "—") : "—"}</Td>
                  <Td>{e.designation}</Td>
                  <Td>{e.managerId ? (empName.get(e.managerId) ?? "—") : "—"}</Td>
                  <Td>
                    <Badge>{e.employmentType.replace("_", " ")}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(e.joinDate)}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={e.status} />
                      {alertsByEmp.has(e.id) && (
                        <span title={alertsByEmp.get(e.id)!.map(expiryText).join(", ")}>
                          <Badge tone="rose">docs expiring</Badge>
                        </span>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
