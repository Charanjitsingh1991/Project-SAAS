import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th, type Tone } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { nationalityName, type CountryPack } from "@/lib/countries";
import { expiryAlerts, expiryText, maskId, monthRange, parseSalaryComponents, salaryStructure } from "@/lib/hrm";
import { uaeComponents } from "@/lib/payroll-ae";
import { leaveBalances } from "@/lib/hrm-data";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { addTask, deleteTask, linkUser, markExited, reactivate, startNotice, toggleTask, updateEmployee } from "../actions";
import { CompFields, JobFields, PersonalFields, StatutoryFields, annualPayLabel } from "../_components/employee-fields";
import { MiniCalendar } from "../_components/mini-calendar";

export const metadata: Metadata = { title: "Employee" };

const TABS = [
  ["overview", "Overview"],
  ["job", "Job"],
  ["compensation", "Compensation"],
  ["leave", "Leave"],
  ["attendance", "Attendance"],
  ["onboarding", "Onboarding"],
] as const;

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const { id: rawId } = await params;
  const { tab: rawTab } = await searchParams;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const tab = TABS.find((t) => t[0] === rawTab)?.[0] ?? "overview";

  const [emp] = await db.select().from(schema.employees).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId))).limit(1);
  if (!emp) notFound();

  const today = todayYmd();
  const month = today.slice(0, 7);
  const cur = ws.org.currency;
  const pack = packFor(ws);
  const alerts = emp.status === "exited" ? [] : expiryAlerts(pack.hr.employeeFields, emp, today);
  const masked = pack.hr.employeeFields.filter((f) => f.sensitive && emp[f.key]).map((f) => `${f.label} ${maskId(emp[f.key])}`);

  const [depts, people] = await Promise.all([
    db.select().from(schema.departments).where(eq(schema.departments.orgId, orgId)).orderBy(asc(schema.departments.name)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name, designation: schema.employees.designation, userId: schema.employees.userId })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited")))
      .orderBy(asc(schema.employees.name)),
  ]);
  const dept = depts.find((d) => d.id === emp.departmentId);
  const manager = people.find((p) => p.id === emp.managerId) ?? (emp.managerId ? (await db.select({ id: schema.employees.id, name: schema.employees.name, designation: schema.employees.designation, userId: schema.employees.userId }).from(schema.employees).where(and(eq(schema.employees.id, emp.managerId), eq(schema.employees.orgId, orgId))).limit(1))[0] : undefined);
  const reports = await db.select({ id: schema.employees.id }).from(schema.employees).where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.managerId, emp.id), ne(schema.employees.status, "exited")));

  const [linked] = emp.userId ? await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, emp.userId)).limit(1) : [];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {emp.name} <StatusBadge value={emp.status} />
          </span>
        }
        description={
          <>
            <span className="font-mono text-xs">{emp.code}</span> · {emp.designation}
            {dept ? ` · ${dept.name}` : ""}
            {masked.length > 0 && <span className="mt-1 block font-mono text-xs text-ink-mute">{masked.join(" · ")}</span>}
          </>
        }
        actions={
          <Link href="/app/hrm" className="text-sm text-ink-soft hover:text-ink">
            ← Directory
          </Link>
        }
        tabs={TABS.map(([k, label]) => ({ href: `/app/hrm/${emp.id}?tab=${k}`, label, active: k === tab }))}
      />

      {alerts.length > 0 && (
        <div role="alert" className="mb-6 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm">
          <p className="font-medium text-signal">Document renewal needed</p>
          <ul className="mt-1 space-y-0.5 text-ink">
            {alerts.map((a) => (
              <li key={a.key}>
                {expiryText(a)} ({formatDate(a.date)}).{" "}
                <Link href={`/app/hrm/${emp.id}?tab=compensation`} className="underline">
                  Update
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <Card title="Personal details">
              <ActionForm action={updateEmployee} resetOnSuccess={false} className="space-y-4">
                <input type="hidden" name="id" value={emp.id} />
                <input type="hidden" name="section" value="personal" />
                <PersonalFields e={emp} pack={pack} />
                <SubmitButton>Save personal details</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Summary">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label="Department" value={dept?.name} />
                <Item label="Manager" value={manager ? <Link className="hover:underline" href={`/app/hrm/${manager.id}`}>{manager.name}</Link> : undefined} />
                <Item label="Direct reports" value={String(reports.length)} />
                <Item label="Employment type" value={emp.employmentType.replace("_", " ")} />
                <Item label="Work location" value={emp.workLocation} />
                <Item label="Joined" value={formatDate(emp.joinDate)} />
                <Item label="Probation ends" value={emp.probationEndDate ? formatDate(emp.probationEndDate) : undefined} />
                <Item label={annualPayLabel(pack)} value={emp.annualCtc ? formatMoney(emp.annualCtc, cur) : undefined} />
                {pack.code === "AE" && <Item label="Nationality" value={emp.nationality ? nationalityName(emp.nationality) : undefined} />}
              </dl>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Lifecycle">
              <Lifecycle emp={emp} />
            </Card>
            <Card title="User account">
              <p className="mb-3 text-sm text-ink-soft">
                {linked ? (
                  <>
                    Linked to <strong>{linked.name}</strong> ({linked.email}). They see this record in My space.
                  </>
                ) : (
                  "Not linked. Link a workspace member so they can use My space (check-in, leave, payslips)."
                )}
              </p>
              <AccountLink empId={emp.id} orgId={orgId} current={emp.userId} />
            </Card>
          </div>
        </div>
      )}

      {tab === "job" && (
        <Card title="Job details">
          <ActionForm action={updateEmployee} resetOnSuccess={false} className="space-y-4">
            <input type="hidden" name="id" value={emp.id} />
            <input type="hidden" name="section" value="job" />
            <JobFields
              e={emp}
              departments={depts.map((d) => ({ value: d.id, label: d.name }))}
              managers={people.filter((p) => p.id !== emp.id).map((p) => ({ value: p.id, label: `${p.name} — ${p.designation}` }))}
            />
            <SubmitButton>Save job details</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {tab === "compensation" && <CompensationTab emp={emp} currency={cur} pack={pack} />}
      {tab === "leave" && <LeaveTab empId={emp.id} orgId={orgId} today={today} />}
      {tab === "attendance" && <AttendanceTab empId={emp.id} orgId={orgId} month={month} today={today} />}
      {tab === "onboarding" && <OnboardingTab empId={emp.id} orgId={orgId} />}
    </>
  );
}

function Item({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">{label}</dt>
      <dd className="mt-0.5 capitalize">{value || "—"}</dd>
    </div>
  );
}

function Lifecycle({ emp }: { emp: typeof schema.employees.$inferSelect }) {
  if (emp.status === "exited") {
    return (
      <div className="space-y-3 text-sm">
        <p>
          Exited on <strong>{formatDate(emp.exitDate)}</strong>
          {emp.exitReason ? ` — ${emp.exitReason}` : ""}.
        </p>
        <ActionButton action={reactivate} fields={{ id: emp.id }} confirm="Reactivate this employee?">
          Reactivate
        </ActionButton>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {emp.status === "notice" ? (
        <div className="space-y-3 text-sm">
          <p>
            On notice{emp.exitDate ? <> — last working day <strong>{formatDate(emp.exitDate)}</strong></> : ""}
            {emp.exitReason ? ` (${emp.exitReason})` : ""}. The offboarding checklist is under the Onboarding tab.
          </p>
          <ActionButton action={reactivate} fields={{ id: emp.id }} confirm="Cancel the notice and reactivate? Offboarding tasks will be removed.">
            Cancel notice
          </ActionButton>
        </div>
      ) : (
        <ActionForm action={startNotice} className="space-y-3">
          <input type="hidden" name="id" value={emp.id} />
          <p className="text-sm font-medium">Move to notice period</p>
          <Input label="Last working day" name="exitDate" type="date" />
          <Input label="Reason" name="exitReason" placeholder="Resignation, relocation…" />
          <SubmitButton variant="outline">Move to notice</SubmitButton>
        </ActionForm>
      )}
      <ActionForm action={markExited} className="space-y-3 border-t border-line pt-4">
        <input type="hidden" name="id" value={emp.id} />
        <p className="text-sm font-medium">Mark as exited</p>
        <Input label="Exit date" name="exitDate" type="date" defaultValue={emp.exitDate ?? ""} />
        <Input label="Reason" name="exitReason" defaultValue={emp.exitReason ?? ""} />
        <SubmitButton variant="outline">Mark exited</SubmitButton>
      </ActionForm>
    </div>
  );
}

async function AccountLink({ empId, orgId, current }: { empId: number; orgId: number; current: number | null }) {
  const members = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
  return (
    <ActionForm action={linkUser} resetOnSuccess={false} className="space-y-3">
      <input type="hidden" name="id" value={empId} />
      <Select label="Workspace member" name="userId" placeholder="— Not linked —" options={members.map((m) => ({ value: m.id, label: `${m.name} (${m.email})` }))} defaultValue={current ?? ""} />
      <SubmitButton variant="outline">Save link</SubmitButton>
    </ActionForm>
  );
}

function CompensationTab({ emp, currency }: { emp: typeof schema.employees.$inferSelect; currency: string }) {
  const s = salaryStructure(emp.annualCtc, emp.metro);
  const lines = [
    ["Basic (50% of CTC)", s.monthly.basic, s.annual.basic],
    [`HRA (${emp.metro ? 50 : 40}% of basic)`, s.monthly.hra, s.annual.hra],
    ["Special allowance (balance)", s.monthly.special, s.annual.special],
  ] as const;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card title="Compensation">
          <ActionForm action={updateEmployee} resetOnSuccess={false} className="space-y-4">
            <input type="hidden" name="id" value={emp.id} />
            <input type="hidden" name="section" value="compensation" />
            <CompFields e={emp} />
            <h3 className="pt-2 font-display text-sm font-semibold">Statutory & bank</h3>
            <StatutoryFields e={emp} />
            <SubmitButton>Save compensation</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <Card title="Salary structure preview">
        {emp.annualCtc > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Component</Th>
                <Th className="text-right">Monthly</Th>
                <Th className="text-right">Annual</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map(([label, m, a]) => (
                <tr key={label}>
                  <Td>{label}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(m, currency)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(a, currency)}</Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td>Total CTC</Td>
                <Td className="text-right tabular-nums">{formatMoney(s.monthly.total, currency)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(s.annual.total, currency)}</Td>
              </tr>
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No CTC set">Enter the annual CTC to preview the salary structure.</EmptyState>
        )}
        <p className="mt-8 text-xs text-ink-mute">Preview only — statutory deductions (PF, ESI, PT, TDS) are calculated in Payroll.</p>
      </Card>
    </div>
  );
}

async function LeaveTab({ empId, orgId, today }: { empId: number; orgId: number; today: string }) {
  const year = Number(today.slice(0, 4));
  const [balances, recent] = await Promise.all([
    leaveBalances(orgId, empId, year),
    db
      .select({ r: schema.leaveRequests, type: schema.leaveTypes.name })
      .from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveRequests.orgId, orgId), eq(schema.leaveRequests.employeeId, empId)))
      .orderBy(desc(schema.leaveRequests.startDate))
      .limit(10),
  ]);
  return (
    <div className="space-y-6">
      <Card title={`Leave balance ${year}`}>
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th className="text-right">Quota</Th>
              <Th className="text-right">Used</Th>
              <Th className="text-right">Pending</Th>
              <Th className="text-right">Balance</Th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.type.id}>
                <Td>
                  <Badge tone={b.type.color as Tone}>{b.type.code}</Badge> <span className="ml-1">{b.type.name}</span>
                  {!b.type.paid && <span className="ml-2 text-xs text-ink-mute">unpaid</span>}
                </Td>
                <Td className="text-right tabular-nums">{b.quota}</Td>
                <Td className="text-right tabular-nums">{b.used}</Td>
                <Td className="text-right tabular-nums">{b.pending}</Td>
                <Td className="text-right font-semibold tabular-nums">{b.type.paid ? b.balance : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card title="Recent requests" actions={<Link href="/app/hrm/leave" className="text-sm text-ink-soft hover:text-ink">All requests →</Link>}>
        {recent.length === 0 ? (
          <EmptyState title="No leave requests" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th className="text-right">Days</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ r, type }) => (
                <tr key={r.id}>
                  <Td>{type}</Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : r.halfDay ? " (half day)" : ""}
                  </Td>
                  <Td className="text-right tabular-nums">{r.days}</Td>
                  <Td>
                    <StatusBadge value={r.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function AttendanceTab({ empId, orgId, month, today }: { empId: number; orgId: number; month: string; today: string }) {
  const { start, end } = monthRange(month);
  const [rows, hols] = await Promise.all([
    db
      .select()
      .from(schema.attendance)
      .where(and(eq(schema.attendance.orgId, orgId), eq(schema.attendance.employeeId, empId), gte(schema.attendance.date, start), lte(schema.attendance.date, end))),
    db.select().from(schema.holidays).where(and(eq(schema.holidays.orgId, orgId), gte(schema.holidays.date, start), lte(schema.holidays.date, end))),
  ]);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <Card title="This month" actions={<Link href={`/app/hrm/attendance?month=${month}`} className="text-sm text-ink-soft hover:text-ink">Full register →</Link>}>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Badge tone="mint">{count("present")} present</Badge>
        <Badge tone="lime">{count("wfh")} WFH</Badge>
        <Badge tone="butter">{count("half_day")} half-day</Badge>
        <Badge tone="sky">{count("leave")} leave</Badge>
        <Badge tone="rose">{count("absent")} absent</Badge>
      </div>
      <div className="max-w-xl">
        <MiniCalendar month={month} rows={rows} holidays={new Map(hols.map((h) => [h.date, h.name]))} today={today} />
      </div>
    </Card>
  );
}

async function OnboardingTab({ empId, orgId }: { empId: number; orgId: number }) {
  const tasks = await db
    .select()
    .from(schema.onboardingTasks)
    .where(and(eq(schema.onboardingTasks.orgId, orgId), eq(schema.onboardingTasks.employeeId, empId)))
    .orderBy(asc(schema.onboardingTasks.dueDate), asc(schema.onboardingTasks.id));
  const groups = [
    ["onboarding", "Onboarding checklist"],
    ["offboarding", "Offboarding checklist"],
  ] as const;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        {groups.map(([kind, title]) => {
          const list = tasks.filter((t) => t.kind === kind);
          if (kind === "offboarding" && list.length === 0) return null;
          const done = list.filter((t) => t.done).length;
          return (
            <Card key={kind} title={title} actions={<span className="text-sm text-ink-soft">{done}/{list.length} done</span>}>
              {list.length === 0 ? (
                <EmptyState title="No tasks" />
              ) : (
                <ul className="divide-y divide-line/70">
                  {list.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <form action={toggleTask} className="flex items-center gap-3">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="done" value={t.done ? "0" : "1"} />
                        <button className="flex items-center gap-3 text-left text-sm">
                          <span className={`grid size-5 place-items-center rounded border text-xs ${t.done ? "border-ink bg-ink text-paper" : "border-line"}`}>{t.done ? "✓" : ""}</span>
                          <span className={t.done ? "text-ink-mute line-through" : ""}>{t.title}</span>
                        </button>
                      </form>
                      <span className="flex items-center gap-3">
                        {t.dueDate && <span className="text-xs text-ink-mute">due {formatDate(t.dueDate)}</span>}
                        <ActionButton action={deleteTask} fields={{ id: t.id }} confirm="Remove this task?">
                          Remove
                        </ActionButton>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      <Card title="Add a task">
        <ActionForm action={addTask} className="space-y-3">
          <input type="hidden" name="employeeId" value={empId} />
          <Select label="Checklist" name="kind" options={["onboarding", "offboarding"]} />
          <Input label="Task" name="title" />
          <Input label="Due date" name="dueDate" type="date" />
          <SubmitButton>Add task</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
