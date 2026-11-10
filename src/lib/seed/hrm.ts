import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "@/lib/activity";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { eachDate, isWeekend, monthRange, shiftMonth, workingDates } from "@/lib/hrm";
import { createChecklist } from "@/lib/hrm-data";
import { nextNumber } from "@/lib/sequence";

type EmpType = (typeof schema.EMPLOYMENT_TYPES)[number];
type Spec = {
  key: string;
  name: string;
  desig: string;
  dept: string | null;
  mgr: string | null;
  type?: EmpType;
  ctcL: number;
  joinAgo: number; // days before today (ignored when joinDate set)
  joinDate?: string;
  loc: string;
  gender: "male" | "female";
  dob: string;
  metro?: boolean;
  noStat?: boolean;
};

const IFSC = ["HDFC0001234", "ICIC0000456", "SBIN0005943", "UTIB0000312"];
const L = (n: number) => String.fromCharCode(65 + (n % 26));
const hash = (a: number, s: string) => {
  let h = a * 2654435761;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0) % 1_000_003;
  return h % 100;
};

/** Sample HR data: departments, a 3-level team, holidays, attendance and leave (with the attendance rows approving would create). */
export async function seedHrm(ctx: Ctx): Promise<void> {
  const { orgId } = ctx;
  const [existing] = await db.select({ id: schema.employees.id }).from(schema.employees).where(eq(schema.employees.orgId, orgId)).limit(1);
  if (existing) return;

  const today = todayYmd();
  const thisMonth = today.slice(0, 7);
  const prevMonth = shiftMonth(thisMonth, -1);
  const monthStart = `${thisMonth}-01`;
  const prev = monthRange(prevMonth);

  const [owner] = ctx.userId ? await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId)).limit(1) : [];

  /* Leave types (created with the workspace; ensure they exist). */
  let types = await db.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.orgId, orgId));
  if (!types.length) {
    types = await db
      .insert(schema.leaveTypes)
      .values([
        { orgId, name: "Casual leave", code: "CL", annualQuota: 12, paid: true, color: "mint" },
        { orgId, name: "Sick leave", code: "SL", annualQuota: 12, paid: true, color: "sky" },
        { orgId, name: "Earned leave", code: "EL", annualQuota: 15, paid: true, color: "lime" },
        { orgId, name: "Leave without pay", code: "LWP", annualQuota: 0, paid: false, color: "rose" },
      ])
      .returning();
  }
  const type = (code: string) => types.find((t) => t.code === code)!;

  /* Departments */
  const deptRows = await db
    .insert(schema.departments)
    .values(["Engineering", "Sales", "Finance", "Operations", "People", "Design"].map((name) => ({ orgId, name })))
    .returning();
  const deptId = (n: string | null) => deptRows.find((d) => d.name === n)?.id ?? null;

  /* Employees */
  const specs: Spec[] = [
    { key: "ceo", name: owner?.name ?? "Founder", desig: "Founder & CEO", dept: null, mgr: null, ctcL: 36, joinAgo: 1500, loc: "Bengaluru", gender: "male", dob: "1985-03-12" },
    { key: "eng", name: "Rohan Mehta", desig: "VP Engineering", dept: "Engineering", mgr: "ceo", ctcL: 30, joinAgo: 1320, loc: "Bengaluru", gender: "male", dob: "1987-07-21" },
    { key: "sales", name: "Ananya Iyer", desig: "Head of Sales", dept: "Sales", mgr: "ceo", ctcL: 24, joinAgo: 1100, loc: "Mumbai", gender: "female", dob: "1989-11-02" },
    { key: "fin", name: "Vikram Nair", desig: "Finance Controller", dept: "Finance", mgr: "ceo", ctcL: 22, joinAgo: 980, loc: "Bengaluru", gender: "male", dob: "1986-01-18" },
    { key: "ops", name: "Neha Kapoor", desig: "Operations Manager", dept: "Operations", mgr: "ceo", ctcL: 18, joinAgo: 900, loc: "Delhi NCR", gender: "female", dob: "1990-09-09" },
    { key: "hr", name: "Priya Sharma", desig: "HR Manager", dept: "People", mgr: "ceo", ctcL: 16, joinAgo: 800, loc: "Bengaluru", gender: "female", dob: "1991-04-27" },
    { key: "design", name: "Kabir Malhotra", desig: "Design Lead", dept: "Design", mgr: "ceo", ctcL: 20, joinAgo: 700, loc: "Bengaluru", gender: "male", dob: "1992-12-05" },
    { key: "arjun", name: "Arjun Reddy", desig: "Senior Software Engineer", dept: "Engineering", mgr: "eng", ctcL: 18, joinAgo: 640, loc: "Hyderabad", gender: "male", dob: "1993-06-30" },
    { key: "sneha", name: "Sneha Patil", desig: "Software Engineer", dept: "Engineering", mgr: "eng", ctcL: 12, joinAgo: 420, loc: "Pune", gender: "female", dob: "1996-02-14" },
    { key: "intern", name: "Karan Bhatia", desig: "Engineering Intern", dept: "Engineering", mgr: "eng", type: "intern", ctcL: 4.5, joinAgo: 80, loc: "Bengaluru", gender: "male", dob: "2002-08-19", noStat: true },
    { key: "divya", name: "Divya Menon", desig: "Account Executive", dept: "Sales", mgr: "sales", ctcL: 9, joinAgo: 380, loc: "Mumbai", gender: "female", dob: "1995-10-23" },
    { key: "pooja", name: "Pooja Singh", desig: "Sales Associate", dept: "Sales", mgr: "sales", ctcL: 7.5, joinAgo: 500, loc: "Mumbai", gender: "female", dob: "1997-05-06" },
    { key: "meera", name: "Meera Joshi", desig: "Accountant", dept: "Finance", mgr: "fin", ctcL: 7.2, joinAgo: 450, loc: "Bengaluru", gender: "female", dob: "1994-03-28" },
    { key: "sandeep", name: "Sandeep Kulkarni", desig: "Operations Executive", dept: "Operations", mgr: "ops", ctcL: 5.4, joinAgo: 300, loc: "Nagpur", gender: "male", dob: "1998-01-11", metro: false },
    { key: "tanvi", name: "Tanvi Desai", desig: "Talent Acquisition Specialist", dept: "People", mgr: "hr", ctcL: 6, joinAgo: 520, loc: "Bengaluru", gender: "female", dob: "1996-07-15" },
    { key: "aditya", name: "Aditya Rao", desig: "UI/UX Designer", dept: "Design", mgr: "design", ctcL: 12, joinAgo: 0, joinDate: monthStart, loc: "Bengaluru", gender: "male", dob: "1997-09-30" },
    { key: "farhan", name: "Farhan Ali", desig: "Freelance Illustrator", dept: "Design", mgr: "design", type: "contract", ctcL: 14, joinAgo: 200, loc: "Remote", gender: "male", dob: "1991-02-02", noStat: true },
  ];

  const ids = new Map<string, number>();
  const empRows = new Map<string, { id: number; joinDate: string; exitDate: string | null }>();
  for (const [i, s] of specs.entries()) {
    const joinDate = s.joinDate ?? addDaysYmd(today, -s.joinAgo);
    const code = await nextNumber(orgId, "employee");
    const first = s.name.split(" ")[0].toLowerCase();
    const isCeo = s.key === "ceo";
    const exitDate = s.key === "pooja" ? `${prevMonth}-15` : s.key === "tanvi" ? addDaysYmd(today, 20) : null;
    const [row] = await db
      .insert(schema.employees)
      .values({
        orgId,
        code,
        userId: isCeo ? ctx.userId : null,
        name: s.name,
        email: isCeo && owner ? owner.email : `${first}@acme-demo.in`,
        phone: `+91 98${String(10000000 + i * 777_031).slice(0, 8)}`,
        gender: s.gender,
        dob: s.dob,
        address: `${s.loc}, India`,
        departmentId: deptId(s.dept),
        designation: s.desig,
        managerId: s.mgr ? (ids.get(s.mgr) ?? null) : null,
        employmentType: s.type ?? "full_time",
        workLocation: s.loc,
        joinDate,
        probationEndDate: s.type === "contract" || s.joinAgo > 400 ? null : addDaysYmd(joinDate, 90),
        status: s.key === "pooja" ? "exited" : s.key === "tanvi" ? "notice" : "active",
        exitDate,
        exitReason: s.key === "pooja" ? "Better opportunity" : s.key === "tanvi" ? "Relocating to another city" : null,
        annualCtc: Math.round(s.ctcL * 100_000 * 100),
        pfEnrolled: !s.noStat,
        metro: s.metro ?? true,
        pan: s.key === "intern" ? null : `${L(i)}${L(i + 3)}${L(i + 7)}P${L(i + 11)}${String(1000 + i * 137).slice(0, 4)}${L(i + 5)}`,
        uan: s.noStat ? null : `1012${String(40_000_000 + i * 7919).padStart(8, "0")}`,
        bankAccount: `5010${String(10_000_000 + i * 104_729)}`,
        ifsc: IFSC[i % IFSC.length],
      })
      .returning({ id: schema.employees.id });
    ids.set(s.key, row.id);
    empRows.set(s.key, { id: row.id, joinDate, exitDate });
  }

  /* Department heads */
  const heads: Record<string, string> = { Engineering: "eng", Sales: "sales", Finance: "fin", Operations: "ops", People: "hr", Design: "design" };
  for (const [name, key] of Object.entries(heads)) {
    await db.update(schema.departments).set({ headEmployeeId: ids.get(key) }).where(and(eq(schema.departments.orgId, orgId), eq(schema.departments.name, name)));
  }

  /* Holidays for the current year (and the previous month's year when it differs) */
  const years = [...new Set([today.slice(0, 4), prev.start.slice(0, 4)])];
  const MOVABLE: Record<string, [string, string, string]> = {
    "2025": ["03-14", "10-02", "10-20"],
    "2026": ["03-04", "10-20", "11-08"],
  };
  const holidayRows: { orgId: number; date: string; name: string; optional: boolean }[] = [];
  for (const y of years) {
    const [holi, dussehra, diwali] = MOVABLE[y] ?? ["03-14", "10-20", "11-01"];
    const list: [string, string, boolean][] = [
      ["01-01", "New Year's Day", true],
      ["01-26", "Republic Day", false],
      [holi, "Holi", false],
      ["05-01", "Labour Day", false],
      ["08-15", "Independence Day", false],
      ["10-02", "Gandhi Jayanti", false],
      [dussehra, "Dussehra", false],
      [diwali, "Diwali", false],
      ["12-25", "Christmas", false],
    ];
    for (const [md, name, optional] of list) {
      const date = `${y}-${md}`;
      if (!holidayRows.some((h) => h.date === date)) holidayRows.push({ orgId, date, name, optional });
    }
  }
  await db.insert(schema.holidays).values(holidayRows);
  const holidays = new Set(holidayRows.filter((h) => !h.optional).map((h) => h.date));

  /* Attendance: previous month in full + this month to date */
  type Att = typeof schema.attendance.$inferInsert;
  const att = new Map<string, Att>();
  const key = (e: number, d: string) => `${e}|${d}`;
  const from = prev.start;
  for (const [k, e] of empRows) {
    const last = e.exitDate && e.exitDate < today ? e.exitDate : today;
    for (const date of eachDate(from > e.joinDate ? from : e.joinDate, last)) {
      if (isWeekend(date)) continue;
      const base = { orgId, employeeId: e.id, date };
      if (holidays.has(date)) {
        att.set(key(e.id, date), { ...base, status: "holiday" });
        continue;
      }
      if (date === today && k === "ceo") continue; // leave today open for the check-in demo
      const r = hash(e.id, date);
      const inT = `09:${String(5 + (r % 45)).padStart(2, "0")}`;
      const outT = `18:${String(r % 50).padStart(2, "0")}`;
      let status: (typeof schema.ATTENDANCE_STATUSES)[number] = "present";
      if (date !== today) status = r < 80 ? "present" : r < 88 ? "wfh" : r < 92 ? "half_day" : r < 95 ? "absent" : "present";
      att.set(key(e.id, date), {
        ...base,
        status,
        checkIn: status === "absent" ? null : inT,
        checkOut: status === "absent" || date === today ? null : status === "half_day" ? "13:30" : outT,
        note: status === "absent" ? "Uninformed absence" : null,
      });
    }
  }

  /* Leave requests; approved ones produce the same attendance rows as the approve action */
  const workDays = (start: string, n: number) => {
    const out: string[] = [];
    for (let d = start; out.length < n; d = addDaysYmd(d, 1)) if (!isWeekend(d) && !holidays.has(d)) out.push(d);
    return out;
  };
  const yesterday = addDaysYmd(today, -1);
  const recentDay = [...eachDate(addDaysYmd(today, -10), yesterday)].reverse().find((d) => !isWeekend(d) && !holidays.has(d) && d >= monthStart) ?? workDays(`${prevMonth}-10`, 1)[0];

  type Req = { emp: string; code: string; days: string[]; half?: boolean; status: "approved" | "pending" | "rejected"; reason: string };
  const reqs: Req[] = [
    { emp: "arjun", code: "CL", days: workDays(`${prevMonth}-08`, 2), status: "approved", reason: "Family function" },
    { emp: "sneha", code: "SL", days: [recentDay], status: "approved", reason: "Fever" },
    { emp: "divya", code: "EL", days: workDays(`${prevMonth}-18`, 3), status: "approved", reason: "Trip to Goa" },
    { emp: "meera", code: "LWP", days: workDays(`${prevMonth}-22`, 2), status: "approved", reason: "Personal work (unpaid)" },
    { emp: "sandeep", code: "CL", days: workDays(`${prevMonth}-12`, 1), half: true, status: "approved", reason: "Bank work" },
    { emp: "fin", code: "CL", days: workDays(addDaysYmd(today, 9), 2), status: "approved", reason: "Wedding" },
    { emp: "hr", code: "CL", days: workDays(addDaysYmd(today, 3), 2), status: "pending", reason: "Short break" },
    { emp: "design", code: "EL", days: workDays(addDaysYmd(today, 14), 5), status: "pending", reason: "Vacation" },
    { emp: "ops", code: "CL", days: workDays(addDaysYmd(today, 5), 1), status: "rejected", reason: "Quarter-end inventory — please reschedule" },
  ];
  for (const r of reqs) {
    const empId = ids.get(r.emp)!;
    const t = type(r.code);
    const start = r.days[0];
    const end = r.days[r.days.length - 1];
    const [row] = await db
      .insert(schema.leaveRequests)
      .values({
        orgId,
        employeeId: empId,
        leaveTypeId: t.id,
        startDate: start,
        endDate: end,
        halfDay: !!r.half,
        days: r.half ? 0.5 : r.days.length,
        reason: r.reason,
        status: r.status,
        decidedBy: r.status === "pending" ? null : ctx.userId,
        decidedAt: r.status === "pending" ? null : new Date(),
      })
      .returning({ id: schema.leaveRequests.id });
    if (r.status === "approved") {
      for (const date of workingDates(start, end, holidays)) {
        att.set(key(empId, date), { orgId, employeeId: empId, date, status: "leave", note: r.half ? `${t.name} (half day)` : t.name, leaveRequestId: row.id });
      }
    }
  }

  const attRows = [...att.values()];
  for (let i = 0; i < attRows.length; i += 80) await db.insert(schema.attendance).values(attRows.slice(i, i + 80));

  /* Checklists: onboarding for the newest joiner, offboarding for the person on notice */
  const newbie = empRows.get("aditya")!;
  await createChecklist(orgId, newbie.id, "onboarding", newbie.joinDate);
  const tasks = await db.select().from(schema.onboardingTasks).where(and(eq(schema.onboardingTasks.orgId, orgId), eq(schema.onboardingTasks.employeeId, newbie.id)));
  for (const t of tasks.filter((x) => x.dueDate && x.dueDate <= today)) {
    if (!t.title.startsWith("Add to payroll") && !t.title.startsWith("Day-1")) await db.update(schema.onboardingTasks).set({ done: true }).where(eq(schema.onboardingTasks.id, t.id));
  }
  const leaving = empRows.get("tanvi")!;
  await createChecklist(orgId, leaving.id, "offboarding", leaving.exitDate!);

  await logActivity(ctx, { module: "hrm", entityType: "employee", action: "seeded", summary: `Loaded ${specs.length} sample employees across ${deptRows.length} departments` });
}
