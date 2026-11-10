import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { Clock } from "lucide-react";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th, type Tone } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, formatPeriod, initials, todayYmd } from "@/lib/format";
import { EXPENSE_CATEGORIES } from "@/lib/accounting";
import { CLAIM_TONE, claimCategoryLabel, claimTaxOptions, myClaims } from "@/lib/claims";
import { monthRange } from "@/lib/hrm";
import { leaveBalances, resolveMyEmployee } from "@/lib/hrm-data";
import { hasFeature, packFor, planModules, requireWorkspace, type ActiveWorkspace } from "@/lib/tenancy";
import { MiniCalendar } from "../hrm/_components/mini-calendar";
import { applyMyLeave, cancelMyLeave, checkIn, checkOut, submitMyClaim, withdrawMyClaim } from "./actions";

export const metadata: Metadata = { title: "My space" };

export default async function MySpacePage() {
  const ws = await requireWorkspace();
  const orgId = ws.org.id;
  const emp = await resolveMyEmployee(orgId, ws.user);

  if (!emp) {
    return (
      <>
        <PageHeader title="My space" description={`Hi ${ws.user.name.split(" ")[0]} — your personal HR hub.`} />
        <Card>
          <EmptyState title="Your profile isn't linked yet">
            Ask HR to link your login ({ws.user.email}) to your employee record. Once linked you can check in, apply for leave and see your payslips here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const today = todayYmd();
  const month = today.slice(0, 7);
  const claimsOn = hasFeature(ws, "expenseClaims") && planModules(ws).includes("hrm");
  const { start, end } = monthRange(month);

  const [dept, manager, balances, requests, att, hols, slips] = await Promise.all([
    emp.departmentId ? db.select({ name: schema.departments.name }).from(schema.departments).where(and(eq(schema.departments.id, emp.departmentId), eq(schema.departments.orgId, orgId))).limit(1) : Promise.resolve([]),
    emp.managerId ? db.select({ name: schema.employees.name }).from(schema.employees).where(and(eq(schema.employees.id, emp.managerId), eq(schema.employees.orgId, orgId))).limit(1) : Promise.resolve([]),
    leaveBalances(orgId, emp.id, Number(today.slice(0, 4))),
    db
      .select({ r: schema.leaveRequests, type: schema.leaveTypes.name, code: schema.leaveTypes.code, color: schema.leaveTypes.color })
      .from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveRequests.orgId, orgId), eq(schema.leaveRequests.employeeId, emp.id)))
      .orderBy(desc(schema.leaveRequests.startDate))
      .limit(10),
    db
      .select()
      .from(schema.attendance)
      .where(and(eq(schema.attendance.orgId, orgId), eq(schema.attendance.employeeId, emp.id), gte(schema.attendance.date, start), lte(schema.attendance.date, end))),
    db.select().from(schema.holidays).where(and(eq(schema.holidays.orgId, orgId), gte(schema.holidays.date, start), lte(schema.holidays.date, end))),
    db
      .select({ id: schema.payslips.id, period: schema.payrollRuns.period, net: schema.payslips.net, status: schema.payrollRuns.status })
      .from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
      .where(and(eq(schema.payslips.orgId, orgId), eq(schema.payslips.employeeId, emp.id), eq(schema.payrollRuns.orgId, orgId), inArray(schema.payrollRuns.status, ["approved", "paid"])))
      .orderBy(desc(schema.payrollRuns.period))
      .limit(12),
  ]);

  const todayRow = att.find((a) => a.date === today);
  const present = att.filter((a) => a.status === "present" || a.status === "wfh").length;
  const activeBalances = balances.filter((b) => b.type.active);

  return (
    <>
      <PageHeader
        title="My space"
        description={`Hi ${ws.user.name.split(" ")[0]} — check in, manage leave and see your payslips.`}
        actions={
          <>
            {hasFeature(ws, "performance") && planModules(ws).includes("hrm") && (
              <Link href="/app/hrm/performance/me" className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:border-ink">
                My goals & reviews
              </Link>
            )}
            <Link href="/app/projects/timesheets" className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:border-ink">
              <Clock className="size-4" /> Log hours (timesheets)
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-full bg-mint text-lg font-semibold">{initials(emp.name)}</span>
            <div>
              <p className="text-lg font-semibold">{emp.name}</p>
              <p className="text-sm text-ink-soft">
                {emp.designation}
                {dept[0] ? ` · ${dept[0].name}` : ""}
              </p>
              <p className="font-mono text-xs text-ink-mute">{emp.code}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Manager</dt>
              <dd>{manager[0]?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Joined</dt>
              <dd>{formatDate(emp.joinDate)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Type</dt>
              <dd className="capitalize">{emp.employmentType.replace("_", " ")}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] tracking-widest text-ink-mute uppercase">Location</dt>
              <dd>{emp.workLocation ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card title={`Today · ${formatDate(today)}`}>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            {todayRow ? <StatusBadge value={todayRow.status} /> : <Badge>not checked in</Badge>}
            {todayRow?.checkIn && <span>In <strong>{todayRow.checkIn}</strong></span>}
            {todayRow?.checkOut && <span>Out <strong>{todayRow.checkOut}</strong></span>}
          </div>
          <div className="flex flex-wrap gap-3">
            {!todayRow?.checkIn && (
              <>
                <ActionForm action={checkIn} resetOnSuccess={false}>
                  <input type="hidden" name="mode" value="present" />
                  <SubmitButton variant="signal">Check in</SubmitButton>
                </ActionForm>
                <ActionForm action={checkIn} resetOnSuccess={false}>
                  <input type="hidden" name="mode" value="wfh" />
                  <SubmitButton variant="outline">Check in (WFH)</SubmitButton>
                </ActionForm>
              </>
            )}
            {todayRow?.checkIn && !todayRow.checkOut && (
              <ActionForm action={checkOut} resetOnSuccess={false}>
                <SubmitButton>Check out</SubmitButton>
              </ActionForm>
            )}
            {todayRow?.checkOut && <p className="text-sm text-ink-soft">All done for today. See you tomorrow!</p>}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activeBalances.slice(0, 3).map((b) => (
          <Stat key={b.type.id} label={b.type.name} value={b.type.paid ? b.balance : b.used} hint={b.type.paid ? `of ${b.quota} days left${b.pending ? ` · ${b.pending} pending` : ""}` : "days taken this year"} tone={b.type.color as Tone} />
        ))}
        <Stat label="Present this month" value={present} hint={`${att.filter((a) => a.status === "leave").length} on leave`} tone="card" />
      </div>
      {activeBalances.length > 3 && (
        <p className="mt-2 text-sm text-ink-soft">
          Also: {activeBalances.slice(3).map((b) => `${b.type.name} ${b.type.paid ? b.balance : b.used}`).join(" · ")}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Apply for leave" className="h-fit">
          <ActionForm action={applyMyLeave} className="grid gap-3 sm:grid-cols-2">
            <Select label="Leave type" name="leaveTypeId" placeholder="Select…" options={activeBalances.map((b) => ({ value: b.type.id, label: b.type.name }))} className="sm:col-span-2" />
            <Input label="From" name="startDate" type="date" />
            <Input label="To" name="endDate" type="date" />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="halfDay" className="size-4 accent-ink" /> Half day (single date)
            </label>
            <Input label="Reason" name="reason" className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <SubmitButton>Submit request</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="My requests">
          {requests.length === 0 ? (
            <EmptyState title="No leave requests yet" />
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Dates</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {requests.map(({ r, code, color }) => (
                  <tr key={r.id}>
                    <Td>
                      <Badge tone={color as Tone}>{code}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(r.startDate)}
                      {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : r.halfDay ? " (half)" : ""}
                    </Td>
                    <Td className="text-right tabular-nums">{r.days}</Td>
                    <Td>
                      <StatusBadge value={r.status} />
                    </Td>
                    <Td className="text-right">
                      {r.status === "pending" && (
                        <ActionButton action={cancelMyLeave} fields={{ id: r.id }} confirm="Cancel this request?">
                          Cancel
                        </ActionButton>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="My attendance — this month">
          <MiniCalendar month={month} rows={att} holidays={new Map(hols.map((h) => [h.date, h.name]))} today={today} />
        </Card>

        <Card title="My payslips">
          {slips.length === 0 ? (
            <EmptyState title="No payslips yet">Payslips appear here once payroll for a month is approved.</EmptyState>
          ) : (
            <Table compact>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th className="text-right">Net pay</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <Td>{formatPeriod(s.period)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(s.net, ws.org.currency)}</Td>
                    <Td>
                      <StatusBadge value={s.status} />
                    </Td>
                    <Td className="text-right">
                      <Link href={`/app/payroll/payslips/${s.id}`} className="text-sm font-medium hover:underline">
                        View →
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {claimsOn && <MyClaims ws={ws} emp={emp} today={today} />}
    </>
  );
}

async function MyClaims({ ws, emp, today }: { ws: ActiveWorkspace; emp: { id: number; userId: number | null }; today: string }) {
  const cur = ws.org.currency;
  if (emp.userId !== ws.user.id) {
    return (
      <Card title="Expense claims" className="mt-6">
        <EmptyState title="Link your login to claim expenses">Ask HR to link your login ({ws.user.email}) to your employee record from the employee profile.</EmptyState>
      </Card>
    );
  }
  const pack = packFor(ws);
  const payroll = planModules(ws).includes("payroll");
  const claims = await myClaims(ws.org.id, emp.id);
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card title="Claim an expense" className="h-fit">
        <ActionForm action={submitMyClaim} className="grid gap-3 sm:grid-cols-2">
          <Input label="Date" name="date" type="date" defaultValue={today} max={today} />
          <Select label="Category" name="category" placeholder="Select…" options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} className="[&_select]:normal-case" />
          <Input label="Description" name="description" placeholder="Client lunch, taxi to airport…" className="sm:col-span-2" />
          <Input label={`Amount before tax (${cur})`} name="amount" inputMode="decimal" placeholder="0.00" />
          <Select label={`${pack.tax.name} on receipt`} name="tax" options={claimTaxOptions(pack)} defaultValue={pack.tax.defaultCode} className="[&_select]:normal-case" />
          {payroll ? (
            <Select
              label="Reimburse"
              name="reimburseVia"
              options={[
                { value: "payroll", label: "With my next salary" },
                { value: "direct", label: "Bank transfer on approval" },
              ]}
              defaultValue="payroll"
              className="sm:col-span-2 [&_select]:normal-case"
            />
          ) : (
            <input type="hidden" name="reimburseVia" value="direct" />
          )}
          <div className="sm:col-span-2">
            <SubmitButton>Submit claim</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card title="My claims">
        {claims.length === 0 ? (
          <EmptyState title="No claims yet">Submitted claims and their status appear here.</EmptyState>
        ) : (
          <Table compact>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Expense</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="align-top">
                  <Td className="whitespace-nowrap">{formatDate(c.date)}</Td>
                  <Td>
                    {c.description}
                    <span className="block text-xs text-ink-mute">
                      {claimCategoryLabel(c.category)} · via {c.reimburseVia}
                    </span>
                    {c.status === "rejected" && c.rejectionReason && <span className="block text-xs text-signal">{c.rejectionReason}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(c.total, cur)}</Td>
                  <Td>
                    <Badge tone={CLAIM_TONE[c.status]}>{c.status === "approved" && c.reimburseVia === "payroll" ? "in next payroll" : c.status}</Badge>
                  </Td>
                  <Td className="text-right">
                    {c.status === "submitted" && (
                      <ActionButton action={withdrawMyClaim} fields={{ id: c.id }} confirm="Withdraw this claim?">
                        Withdraw
                      </ActionButton>
                    )}
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
