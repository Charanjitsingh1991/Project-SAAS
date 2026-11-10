import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th, type Tone } from "@/components/app/ui";
import { db, schema } from "@/db";
import { addDaysYmd, formatDate, todayYmd } from "@/lib/format";
import { LEAVE_COLORS, dayOfWeek, isValidYmd, isWeekend, monthRange, shiftMonth } from "@/lib/hrm";
import { weekendOf } from "@/lib/countries";
import { requireWorkspace } from "@/lib/tenancy";
import { applyLeaveForEmployee, decideLeaveAction, saveLeaveType } from "../leave-actions";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Leave" };

type SP = { status?: string; error?: string; view?: string; d?: string };

export default async function LeavePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const orgId = ws.org.id;
  const today = todayYmd();
  const statusFilter = ["pending", "approved", "rejected", "cancelled"].includes(sp.status ?? "") ? sp.status! : "";

  const [reqs, types, emps] = await Promise.all([
    db
      .select({ r: schema.leaveRequests, emp: schema.employees.name, empCode: schema.employees.code, type: schema.leaveTypes })
      .from(schema.leaveRequests)
      .innerJoin(schema.employees, eq(schema.leaveRequests.employeeId, schema.employees.id))
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveRequests.orgId, orgId), statusFilter ? eq(schema.leaveRequests.status, statusFilter as "pending") : undefined))
      .orderBy(desc(schema.leaveRequests.createdAt), desc(schema.leaveRequests.id))
      .limit(200),
    db.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.orgId, orgId)).orderBy(asc(schema.leaveTypes.id)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name, code: schema.employees.code })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited")))
      .orderBy(asc(schema.employees.name)),
  ]);
  const pendingCount = reqs.filter((x) => x.r.status === "pending").length;
  const activeTypes = types.filter((t) => t.active);

  return (
    <>
      <PageHeader title="Leave" description="Requests, who's out, and leave types." tabs={hrmTabs(ws, "leave")} />

      {sp.error && <p role="alert" className="mb-4 rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">{sp.error}</p>}

      <Card
        title={`Requests${pendingCount && !statusFilter ? ` · ${pendingCount} pending` : ""}`}
        actions={
          <div className="flex flex-wrap gap-1 text-xs">
            {["", "pending", "approved", "rejected", "cancelled"].map((s) => (
              <Link
                key={s || "all"}
                href={s ? `/app/hrm/leave?status=${s}` : "/app/hrm/leave"}
                className={`rounded-full border px-3 py-1 capitalize ${s === statusFilter ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
              >
                {s || "all"}
              </Link>
            ))}
          </div>
        }
      >
        {reqs.length === 0 ? (
          <EmptyState title="No leave requests">{statusFilter ? "Nothing with this status." : "Requests from employees will appear here."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th className="text-right">Days</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {reqs.map(({ r, emp, empCode, type }) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/app/hrm/${r.employeeId}?tab=leave`} className="font-medium hover:underline">
                      {emp}
                    </Link>
                    <span className="block font-mono text-[11px] text-ink-mute">{empCode}</span>
                  </Td>
                  <Td>
                    <Badge tone={type.color as Tone}>{type.code}</Badge>
                    {!type.paid && <span className="ml-1.5 text-xs text-ink-mute">unpaid</span>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : r.halfDay ? " (half)" : ""}
                  </Td>
                  <Td className="text-right tabular-nums">{r.days}</Td>
                  <Td className="max-w-56 truncate text-ink-soft" >{r.reason ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={r.status} />
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      {r.status === "pending" && (
                        <>
                          <ActionButton action={decideLeaveAction} fields={{ id: r.id, decision: "approve" }} className="bg-mint">
                            Approve
                          </ActionButton>
                          <ActionButton action={decideLeaveAction} fields={{ id: r.id, decision: "reject" }}>
                            Reject
                          </ActionButton>
                        </>
                      )}
                      {(r.status === "pending" || r.status === "approved") && (
                        <ActionButton action={decideLeaveAction} fields={{ id: r.id, decision: "cancel" }} confirm={r.status === "approved" ? "Cancel this approved leave? Its attendance rows will be removed." : undefined}>
                          Cancel
                        </ActionButton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <WhosOut orgId={orgId} weekend={weekendOf(ws.org)} today={today} view={sp.view === "month" ? "month" : "week"} anchor={isValidYmd(sp.d) ? sp.d : today} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Apply on behalf of an employee" className="h-fit">
          <ActionForm action={applyLeaveForEmployee} className="grid gap-3 sm:grid-cols-2">
            <Select label="Employee" name="employeeId" placeholder="Select…" options={emps.map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))} />
            <Select label="Leave type" name="leaveTypeId" placeholder="Select…" options={activeTypes.map((t) => ({ value: t.id, label: t.name }))} />
            <Input label="From" name="startDate" type="date" />
            <Input label="To" name="endDate" type="date" />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="halfDay" className="size-4 accent-ink" /> Half day (single date)
            </label>
            <Input label="Reason" name="reason" className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <SubmitButton>Create request</SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-mute">Weekends and holidays are skipped. Overlaps and insufficient paid balance are blocked.</p>
        </Card>

        <Card title="Leave types" className="h-fit">
          <div className="space-y-4">
            {types.map((t) => (
              <ActionForm key={t.id} action={saveLeaveType} resetOnSuccess={false} className="grid gap-2 border-b border-line pb-4 sm:grid-cols-[1.4fr_.7fr_.7fr_1fr]">
                <input type="hidden" name="id" value={t.id} />
                <Input label="Name" name="name" defaultValue={t.name} />
                <Input label="Code" name="code" defaultValue={t.code} />
                <Input label="Quota/yr" name="annualQuota" defaultValue={t.annualQuota} inputMode="decimal" />
                <Select label="Colour" name="color" options={[...LEAVE_COLORS]} defaultValue={t.color} />
                <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="paid" defaultChecked={t.paid} className="size-4 accent-ink" /> Paid
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="active" defaultChecked={t.active} className="size-4 accent-ink" /> Active
                  </label>
                  <SubmitButton variant="outline">Save</SubmitButton>
                </div>
              </ActionForm>
            ))}
            <ActionForm action={saveLeaveType} className="grid gap-2 sm:grid-cols-[1.4fr_.7fr_.7fr_1fr]">
              <p className="text-sm font-medium sm:col-span-4">Add leave type</p>
              <Input label="Name" name="name" placeholder="Paternity leave" />
              <Input label="Code" name="code" placeholder="PL" />
              <Input label="Quota/yr" name="annualQuota" defaultValue="0" inputMode="decimal" />
              <Select label="Colour" name="color" options={[...LEAVE_COLORS]} defaultValue="mint" />
              <div className="flex items-center gap-4 text-sm sm:col-span-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="paid" defaultChecked className="size-4 accent-ink" /> Paid
                </label>
                <SubmitButton>Add</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}

async function WhosOut({ orgId, weekend, today, view, anchor }: { orgId: number; weekend: number[]; today: string; view: "week" | "month"; anchor: string }) {
  let start: string;
  let end: string;
  let prev: string;
  let next: string;
  let label: string;
  if (view === "week") {
    start = addDaysYmd(anchor, -((dayOfWeek(anchor) + 6) % 7));
    end = addDaysYmd(start, 6);
    prev = addDaysYmd(start, -7);
    next = addDaysYmd(start, 7);
    label = `${formatDate(start)} – ${formatDate(end)}`;
  } else {
    const ym = anchor.slice(0, 7);
    ({ start, end } = monthRange(ym));
    prev = `${shiftMonth(ym, -1)}-01`;
    next = `${shiftMonth(ym, 1)}-01`;
    label = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }

  const [out, hols] = await Promise.all([
    db
      .select({ r: schema.leaveRequests, name: schema.employees.name, color: schema.leaveTypes.color })
      .from(schema.leaveRequests)
      .innerJoin(schema.employees, eq(schema.leaveRequests.employeeId, schema.employees.id))
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveRequests.orgId, orgId), inArray(schema.leaveRequests.status, ["approved", "pending"]), lte(schema.leaveRequests.startDate, end), gte(schema.leaveRequests.endDate, start)))
      .orderBy(asc(schema.employees.name)),
    db.select().from(schema.holidays).where(and(eq(schema.holidays.orgId, orgId), gte(schema.holidays.date, start), lte(schema.holidays.date, end))),
  ]);
  const hmap = new Map(hols.map((h) => [h.date, h.name]));
  const lead = (dayOfWeek(start) + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: view === "month" ? lead : 0 }, () => null);
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) cells.push(d);
  const q = (v: string, d: string) => `/app/hrm/leave?view=${v}&d=${d}`;

  return (
    <Card
      className="mt-6"
      title={`Who's out · ${label}`}
      actions={
        <div className="flex items-center gap-2 text-xs">
          {(["week", "month"] as const).map((v) => (
            <Link key={v} href={q(v, anchor)} className={`rounded-full border px-3 py-1 capitalize ${v === view ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}>
              {v}
            </Link>
          ))}
          <Link href={q(view, prev)} className="rounded-full border border-line px-3 py-1 hover:border-ink" aria-label="Previous">←</Link>
          <Link href={q(view, today)} className="rounded-full border border-line px-3 py-1 hover:border-ink">Today</Link>
          <Link href={q(view, next)} className="rounded-full border border-line px-3 py-1 hover:border-ink" aria-label="Next">→</Link>
        </div>
      }
    >
      {out.length === 0 && <p className="mb-3 text-sm text-ink-soft">Everyone is in for this period.</p>}
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 gap-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d} className="font-mono text-[10px] tracking-widest text-ink-mute uppercase">{d}</span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const off = isWeekend(d, weekend) || hmap.has(d);
            const people = off ? [] : out.filter((o) => o.r.startDate <= d && o.r.endDate >= d);
            return (
              <div key={d} className={`min-h-20 rounded-xl border p-1.5 text-xs ${off ? "border-transparent bg-ink/5" : "border-line bg-card"} ${d === today ? "ring-2 ring-ink" : ""}`}>
                <span className="text-ink-mute">{Number(d.slice(8))}</span>
                {hmap.has(d) && <span className="ml-1 text-[10px] text-ink-soft">{hmap.get(d)}</span>}
                <div className="mt-1 flex flex-col gap-1">
                  {people.map((p) => (
                    <Badge key={p.r.id} tone={p.r.status === "pending" ? "butter" : (p.color as Tone)}>
                      {p.name.split(" ")[0]}
                      {p.r.halfDay ? " ½" : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-mute">Yellow = pending approval. Weekends and holidays are shaded.</p>
    </Card>
  );
}
