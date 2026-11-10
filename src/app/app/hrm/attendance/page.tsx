import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { CheckCheck } from "lucide-react";
import { ActionButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { addDaysYmd, formatDate, todayYmd } from "@/lib/format";
import { YM_RE, dayOfWeek, isValidYmd, isWeekend, monthRange, shiftMonth, summarizeAttendance } from "@/lib/hrm";
import { unpaidLeaveByRequest } from "@/lib/hrm-data";
import { requireWorkspace } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { markAllPresent, saveAttendance } from "../attendance-actions";
import { ATT_BG, ATT_LEGEND } from "../_components/mini-calendar";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Attendance" };

const CODE: Record<string, string> = { present: "P", absent: "A", half_day: "½", leave: "L", holiday: "H", wfh: "W" };
const WD = ["S", "M", "T", "W", "T", "F", "S"];

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; date?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const today = todayYmd();
  const daily = sp.view === "day";
  const date = isValidYmd(sp.date) ? sp.date : today;
  const month = sp.month && YM_RE.test(sp.month) ? sp.month : today.slice(0, 7);

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Monthly register with loss-of-pay totals, and a daily view to mark attendance."
        tabs={hrmTabs("attendance")}
        actions={
          <div className="flex gap-1 text-sm">
            <Link href={`/app/hrm/attendance?month=${daily ? date.slice(0, 7) : month}`} className={cn("rounded-full border px-4 py-1.5", !daily ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
              Register
            </Link>
            <Link href={`/app/hrm/attendance?view=day&date=${daily ? date : today}`} className={cn("rounded-full border px-4 py-1.5", daily ? "border-ink bg-ink text-paper" : "border-line hover:border-ink")}>
              Daily
            </Link>
          </div>
        }
      />
      {daily ? <Daily orgId={ws.org.id} date={date} today={today} /> : <Register orgId={ws.org.id} month={month} today={today} />}
    </>
  );
}

async function Register({ orgId, month, today }: { orgId: number; month: string; today: string }) {
  const { start, end, days } = monthRange(month);
  const [emps, rows, hols, unpaid] = await Promise.all([
    db.select().from(schema.employees).where(and(eq(schema.employees.orgId, orgId), lte(schema.employees.joinDate, end))).orderBy(asc(schema.employees.code)),
    db.select().from(schema.attendance).where(and(eq(schema.attendance.orgId, orgId), gte(schema.attendance.date, start), lte(schema.attendance.date, end))),
    db.select().from(schema.holidays).where(and(eq(schema.holidays.orgId, orgId), eq(schema.holidays.optional, false), gte(schema.holidays.date, start), lte(schema.holidays.date, end))),
    unpaidLeaveByRequest(orgId),
  ]);
  const people = emps.filter((e) => e.status !== "exited" || !e.exitDate || e.exitDate >= start);
  const hmap = new Map(hols.map((h) => [h.date, h.name]));
  const byEmp = new Map<number, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, new Map());
    byEmp.get(r.employeeId)!.set(r.date, r);
  }
  const dates = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const label = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const nav = "rounded-full border border-line px-3 py-1 hover:border-ink";

  return (
    <Card
      title={`Register · ${label}`}
      actions={
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/app/hrm/attendance?month=${shiftMonth(month, -1)}`} className={nav}>←</Link>
          <Link href={`/app/hrm/attendance?month=${today.slice(0, 7)}`} className={nav}>This month</Link>
          <Link href={`/app/hrm/attendance?month=${shiftMonth(month, 1)}`} className={nav}>→</Link>
        </div>
      }
    >
      {people.length === 0 ? (
        <EmptyState title="No employees in this month" />
      ) : (
        <div className="-mx-5 -my-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-center text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-44 border-b border-line bg-card px-4 py-2 text-left font-mono text-[11px] font-normal tracking-widest text-ink-mute uppercase">Employee</th>
                {dates.map((d) => (
                  <th key={d} title={hmap.get(d)} className={cn("border-b border-line px-0 py-1 font-normal", (isWeekend(d) || hmap.has(d)) && "bg-ink/5", d === today && "text-signal")}>
                    <span className="block text-[9px] text-ink-mute">{WD[dayOfWeek(d)]}</span>
                    {Number(d.slice(8))}
                  </th>
                ))}
                {["Present", "Absent", "Half", "Leave", "LOP"].map((h) => (
                  <th key={h} className="border-b border-l border-line px-2 py-2 font-mono text-[10px] font-normal tracking-wider text-ink-mute uppercase first:border-l-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((e) => {
                const m = byEmp.get(e.id) ?? new Map();
                const s = summarizeAttendance(
                  [...m.values()].map((r) => ({ date: r.date, status: r.status, unpaidLeaveDays: r.leaveRequestId ? (unpaid.get(r.leaveRequestId) ?? 0) : 0 })),
                );
                return (
                  <tr key={e.id}>
                    <td className="sticky left-0 z-10 border-b border-line/70 bg-card px-4 py-1.5 text-left">
                      <Link href={`/app/hrm/${e.id}?tab=attendance`} className="font-medium hover:underline">{e.name}</Link>
                      <span className="ml-2 font-mono text-[10px] text-ink-mute">{e.code}</span>
                    </td>
                    {dates.map((d) => {
                      const r = m.get(d);
                      const off = isWeekend(d) || hmap.has(d);
                      const status = r?.status ?? (hmap.has(d) ? "holiday" : null);
                      return (
                        <td key={d} title={r ? `${r.status.replace("_", " ")}${r.checkIn ? ` · ${r.checkIn}–${r.checkOut ?? "…"}` : ""}` : hmap.get(d)} className={cn("h-8 min-w-7 border-b border-line/70", status ? ATT_BG[status] : off ? "bg-ink/5" : "")}>
                          {status ? CODE[status] : ""}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-line/70 px-2 font-semibold tabular-nums">{s.present + s.wfh}</td>
                    <td className="border-b border-line/70 px-2 tabular-nums">{s.absent}</td>
                    <td className="border-b border-line/70 px-2 tabular-nums">{s.half}</td>
                    <td className="border-b border-line/70 px-2 tabular-nums">{s.leave}</td>
                    <td className={cn("border-b border-line/70 px-2 font-semibold tabular-nums", s.lop > 0 && "text-signal")}>{s.lop}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {ATT_LEGEND.map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("grid size-4 place-items-center rounded text-[9px]", ATT_BG[k])}>{CODE[k]}</span> {l}
          </span>
        ))}
        <span>LOP = absent + half-days × 0.5 + unpaid leave days. Blank weekday = not marked.</span>
      </div>
    </Card>
  );
}

async function Daily({ orgId, date, today }: { orgId: number; date: string; today: string }) {
  const [emps, rows, hol] = await Promise.all([
    db.select().from(schema.employees).where(and(eq(schema.employees.orgId, orgId), lte(schema.employees.joinDate, date))).orderBy(asc(schema.employees.name)),
    db.select().from(schema.attendance).where(and(eq(schema.attendance.orgId, orgId), eq(schema.attendance.date, date))),
    db.select().from(schema.holidays).where(and(eq(schema.holidays.orgId, orgId), eq(schema.holidays.date, date), eq(schema.holidays.optional, false))).limit(1),
  ]);
  const people = emps.filter((e) => e.status !== "exited" || !e.exitDate || e.exitDate >= date);
  const byEmp = new Map(rows.map((r) => [r.employeeId, r]));
  const off = isWeekend(date) ? "Weekend" : hol[0] ? `Holiday — ${hol[0].name}` : null;
  const unmarked = people.filter((e) => e.status !== "exited" && !byEmp.has(e.id)).length;
  const nav = "rounded-full border border-line px-3 py-1 hover:border-ink";
  const link = (d: string) => `/app/hrm/attendance?view=day&date=${d}`;

  return (
    <Card
      title={`Daily · ${formatDate(date)}`}
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href={link(addDaysYmd(date, -1))} className={nav}>←</Link>
          <Link href={link(today)} className={nav}>Today</Link>
          <Link href={link(addDaysYmd(date, 1))} className={nav}>→</Link>
          <form method="get" className="flex items-center gap-1">
            <input type="hidden" name="view" value="day" />
            <input type="date" name="date" defaultValue={date} aria-label="Pick date" className="h-8 rounded-full border border-line bg-paper/60 px-3 text-xs" />
            <button className={nav}>Go</button>
          </form>
        </div>
      }
    >
      {off && <p className="mb-4 rounded-xl bg-lilac/50 px-3 py-2 text-sm">{off}. Bulk marking is disabled; you can still record individual entries.</p>}
      {people.length === 0 ? (
        <EmptyState title="No employees on this date" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            {!off && unmarked > 0 && (
              <ActionButton action={markAllPresent} fields={{ date }} confirm={`Mark ${unmarked} unmarked employee(s) present?`} className="h-9 bg-mint">
                <CheckCheck className="size-4" /> Mark all present ({unmarked})
              </ActionButton>
            )}
            <span className="text-ink-soft">{rows.length} of {people.length} marked</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px] space-y-2">
              {people.map((e) => {
                const r = byEmp.get(e.id);
                return (
                  <form key={e.id} action={saveAttendance} className="grid grid-cols-[1.6fr_1fr_.8fr_.8fr_auto] items-center gap-2">
                    <input type="hidden" name="employeeId" value={e.id} />
                    <input type="hidden" name="date" value={date} />
                    <span className="text-sm">
                      <span className="font-medium">{e.name}</span>
                      <span className="block font-mono text-[10px] text-ink-mute">{e.code}{r?.leaveRequestId ? " · from leave request" : ""}</span>
                    </span>
                    <select name="status" defaultValue={r?.status ?? ""} aria-label={`Status for ${e.name}`} className="h-9 rounded-xl border border-line bg-paper/60 px-2 text-sm capitalize">
                      <option value="">— not marked —</option>
                      {schema.ATTENDANCE_STATUSES.map((s) => (
                        <option key={s} value={s}>{s.replace("_", " ")}</option>
                      ))}
                    </select>
                    <input type="time" name="checkIn" defaultValue={r?.checkIn ?? ""} aria-label="Check-in" className="h-9 rounded-xl border border-line bg-paper/60 px-2 text-sm" />
                    <input type="time" name="checkOut" defaultValue={r?.checkOut ?? ""} aria-label="Check-out" className="h-9 rounded-xl border border-line bg-paper/60 px-2 text-sm" />
                    <button className="h-9 rounded-full border border-line px-4 text-xs font-medium hover:border-ink">Save</button>
                  </form>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
