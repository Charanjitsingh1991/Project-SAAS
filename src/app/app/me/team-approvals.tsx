import { and, asc, desc, eq, inArray, lte, gte } from "drizzle-orm";
import { Badge, Card, EmptyState, StatusBadge, type Tone } from "@/components/app/ui";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { db, schema } from "@/db";
import { REGULARIZATION_WINDOW_DAYS } from "@/lib/approvals";
import { addDaysYmd, formatDate } from "@/lib/format";
import { cancelMyRegularization, decideTeamLeave, decideTeamRegularization, requestRegularization } from "./actions";

const btn = "h-8 rounded-full border border-line px-3 text-xs font-medium hover:border-ink";

/** Employee's own correction requests + the request form. */
export async function RegularizationCard({ orgId, employeeId, today }: { orgId: number; employeeId: number; today: string }) {
  const reg = schema.attendanceRegularizations;
  const mine = await db
    .select()
    .from(reg)
    .where(and(eq(reg.orgId, orgId), eq(reg.employeeId, employeeId)))
    .orderBy(desc(reg.createdAt), desc(reg.id))
    .limit(8);
  return (
    <Card title="Attendance correction" className="h-fit">
      <ActionForm action={requestRegularization} className="grid gap-3 sm:grid-cols-2">
        <Input label="Date" name="date" type="date" min={addDaysYmd(today, -REGULARIZATION_WINDOW_DAYS)} max={today} />
        <Select label="Status" name="requestedStatus" options={[...["present", "half_day", "wfh"]]} />
        <Input label="Check-in" name="checkIn" type="time" />
        <Input label="Check-out" name="checkOut" type="time" />
        <Input label="Reason" name="reason" className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <SubmitButton>Request correction</SubmitButton>
          <p className="mt-2 text-xs text-ink-mute">Past dates only, up to {REGULARIZATION_WINDOW_DAYS} days back.</p>
        </div>
      </ActionForm>
      {mine.length > 0 && (
        <ul className="mt-5 divide-y divide-line border-t border-line text-sm">
          {mine.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {formatDate(r.date)} · <span className="capitalize">{r.requestedStatus.replace("_", " ")}</span>
                {r.decisionNote ? <span className="text-ink-mute"> — {r.decisionNote}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge value={r.status} />
                {r.status === "pending" && (
                  <ActionButton action={cancelMyRegularization} fields={{ id: r.id }} confirm="Cancel this request?">
                    Cancel
                  </ActionButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Pending leave + corrections of direct reports, and who on the team is away today. Renders nothing for non-managers. */
export async function TeamApprovals({ orgId, managerId, today }: { orgId: number; managerId: number; today: string }) {
  const reports = await db
    .select({ id: schema.employees.id, name: schema.employees.name })
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.managerId, managerId), inArray(schema.employees.status, ["active", "notice"])));
  if (!reports.length) return null;
  const ids = reports.map((r) => r.id);
  const L = schema.leaveRequests;
  const R = schema.attendanceRegularizations;

  const [leaves, regs, away] = await Promise.all([
    db
      .select({ r: L, name: schema.employees.name, type: schema.leaveTypes.name })
      .from(L)
      .innerJoin(schema.employees, eq(L.employeeId, schema.employees.id))
      .innerJoin(schema.leaveTypes, eq(L.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(L.orgId, orgId), eq(L.status, "pending"), inArray(L.employeeId, ids)))
      .orderBy(asc(L.startDate))
      .limit(50),
    db
      .select({ r: R, name: schema.employees.name })
      .from(R)
      .innerJoin(schema.employees, eq(R.employeeId, schema.employees.id))
      .where(and(eq(R.orgId, orgId), eq(R.status, "pending"), inArray(R.employeeId, ids)))
      .orderBy(asc(R.date))
      .limit(50),
    db
      .select({ name: schema.employees.name, type: schema.leaveTypes.code, color: schema.leaveTypes.color, halfDay: L.halfDay, endDate: L.endDate })
      .from(L)
      .innerJoin(schema.employees, eq(L.employeeId, schema.employees.id))
      .innerJoin(schema.leaveTypes, eq(L.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(L.orgId, orgId), eq(L.status, "approved"), inArray(L.employeeId, ids), lte(L.startDate, today), gte(L.endDate, today))),
  ]);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card title={`Team approvals (${leaves.length + regs.length})`} className="lg:col-span-2">
        {leaves.length + regs.length === 0 ? (
          <EmptyState title="Nothing waiting for you" />
        ) : (
          <div className="space-y-3">
            {leaves.map(({ r, name, type }) => (
              <div key={`l${r.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">
                    {name} <Badge>Leave</Badge>
                  </p>
                  <p className="text-ink-soft">
                    {type} · {formatDate(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : r.halfDay ? " (half)" : ""} · {r.days} day(s)
                  </p>
                  {r.reason && <p className="text-xs text-ink-mute">{r.reason}</p>}
                </div>
                <ActionButton action={decideTeamLeave} fields={{ id: r.id, decision: "approve" }} className="bg-mint">
                  Approve
                </ActionButton>
                <ActionButton action={decideTeamLeave} fields={{ id: r.id, decision: "reject" }}>
                  Reject
                </ActionButton>
              </div>
            ))}
            {regs.map(({ r, name }) => (
              <form key={`r${r.id}`} action={decideTeamRegularization} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
                <input type="hidden" name="id" value={r.id} />
                <div className="min-w-48 flex-1">
                  <p className="font-medium">
                    {name} <Badge>Attendance</Badge>
                  </p>
                  <p className="text-ink-soft">
                    {formatDate(r.date)} · <span className="capitalize">{r.requestedStatus.replace("_", " ")}</span>
                    {r.checkIn ? ` · in ${r.checkIn}` : ""}
                    {r.checkOut ? ` · out ${r.checkOut}` : ""}
                  </p>
                  <p className="text-xs text-ink-mute">{r.reason}</p>
                </div>
                <input name="note" placeholder="Note (optional)" maxLength={300} aria-label="Decision note" className="h-8 rounded-xl border border-line bg-paper/60 px-3 text-xs" />
                <button name="decision" value="approve" className={`${btn} bg-mint`}>
                  Approve
                </button>
                <button name="decision" value="reject" className={btn}>
                  Reject
                </button>
              </form>
            ))}
          </div>
        )}
      </Card>
      <Card title="Team on leave today">
        {away.length === 0 ? (
          <EmptyState title="Everyone's in" />
        ) : (
          <ul className="space-y-2 text-sm">
            {away.map((a) => (
              <li key={`${a.name}${a.endDate}`} className="flex items-center justify-between gap-2">
                <span>{a.name}</span>
                <Badge tone={a.color as Tone}>
                  {a.type}
                  {a.halfDay ? " ½" : ""} · till {formatDate(a.endDate)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
