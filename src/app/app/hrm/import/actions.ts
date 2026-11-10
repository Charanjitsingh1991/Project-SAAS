"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { missingForNew, parseEmployees, type EmployeeImportRow, type EmployeeImportSummary, type EmployeeRowError } from "@/lib/employee-import";
import { createChecklist } from "@/lib/hrm-data";
import { packageFromComponents } from "@/lib/hrm";
import { asDuplicateMode, readCsvInput } from "@/lib/imports";
import { createInvite, seatsLeft } from "@/lib/invites";
import { nextNumber } from "@/lib/sequence";
import { packFor, requireWorkspace } from "@/lib/tenancy";

const fail = (message: string): EmployeeImportSummary => ({ ok: false, message, created: 0, updated: 0, skipped: 0, errors: [] });

/** Columns shared by create and update; undefined means "not provided" (kept on update). */
function columnsOf(d: EmployeeImportRow, ae: boolean) {
  const set: Partial<typeof schema.employees.$inferInsert> = { ...d.fields };
  if (d.name) set.name = d.name;
  if (d.phone) set.phone = d.phone;
  if (d.designation) set.designation = d.designation;
  if (d.gender) set.gender = d.gender;
  if (d.dob) set.dob = d.dob;
  if (d.employmentType) set.employmentType = d.employmentType;
  if (d.workLocation) set.workLocation = d.workLocation;
  if (d.joinDate) set.joinDate = d.joinDate;
  if (d.probationEndDate) set.probationEndDate = d.probationEndDate;
  if (d.annualCtc !== undefined) set.annualCtc = d.annualCtc;
  if (ae && d.components) set.salaryComponents = packageFromComponents(d.components).json;
  if (!ae) {
    if (d.pfEnrolled !== undefined) set.pfEnrolled = d.pfEnrolled;
    if (d.metro !== undefined) set.metro = d.metro;
  }
  return set;
}

export async function importEmployees(_: EmployeeImportSummary | undefined, fd: FormData): Promise<EmployeeImportSummary> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const pack = packFor(ws);
  const ae = pack.code === "AE";
  const mode = asDuplicateMode(fd.get("onDuplicate"));
  const createDepts = fd.get("createDepartments") === "on";
  const invite = fd.get("invite") === "on";

  const input = await readCsvInput(fd);
  if ("error" in input) return fail(input.error);
  const parsed = parseEmployees(input.text, pack);
  if (parsed.fatal) return fail(parsed.fatal);

  const [emps, depts, members] = await Promise.all([
    db.select().from(schema.employees).where(eq(schema.employees.orgId, orgId)),
    db.select().from(schema.departments).where(eq(schema.departments.orgId, orgId)),
    db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.orgId, orgId)),
  ]);
  const byCode = new Map(emps.map((e) => [e.code.toLowerCase(), e]));
  const byEmail = new Map(emps.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e]));
  const takenCodes = new Set(byCode.keys());
  const linkedUsers = new Set(emps.flatMap((e) => (e.userId ? [e.userId] : [])));
  const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));
  const deptByName = new Map(depts.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const managerOf = new Map<number, number | null>(emps.map((e) => [e.id, e.managerId]));

  const errors: EmployeeRowError[] = [...parsed.errors];
  let rejected = parsed.errors.length;
  const reject = (row: number, message: string) => {
    errors.push({ row, message });
    rejected++;
  };

  // Departments named in the file but missing from the workspace.
  const unknown = new Map<string, string>();
  for (const { data } of parsed.rows) {
    const key = data.department?.toLowerCase();
    if (key && !deptByName.has(key) && !unknown.has(key)) unknown.set(key, data.department!);
  }
  if (createDepts) {
    for (const [key, name] of unknown) {
      await db.insert(schema.departments).values({ orgId, name }).onConflictDoNothing();
      const [d] = await db.select({ id: schema.departments.id }).from(schema.departments).where(and(eq(schema.departments.orgId, orgId), eq(schema.departments.name, name))).limit(1);
      if (d) deptByName.set(key, d.id);
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const pendingManagers: { row: number; id: number; ref: string }[] = [];
  const toInvite: { id: number; email: string }[] = [];

  for (const { row, data } of parsed.rows) {
    let departmentId: number | undefined;
    if (data.department) {
      departmentId = deptByName.get(data.department.toLowerCase());
      if (departmentId === undefined) {
        reject(row, `department: "${data.department}" not found. Create it first or tick "Create missing departments".`);
        continue;
      }
    }

    const codeHit = data.code ? byCode.get(data.code.toLowerCase()) : undefined;
    const emailHit = data.email ? byEmail.get(data.email) : undefined;
    if (codeHit && emailHit && codeHit.id !== emailHit.id) {
      reject(row, `Code ${codeHit.code} and email ${data.email} belong to different employees.`);
      continue;
    }
    const existing = codeHit ?? emailHit;

    try {
      if (existing) {
        if (mode === "skip") {
          skipped++;
          continue;
        }
        const set = columnsOf(data, ae);
        if (departmentId !== undefined) set.departmentId = departmentId;
        if (data.email && data.email !== existing.email?.toLowerCase()) {
          if (byEmail.has(data.email)) {
            reject(row, "email: Another employee already uses this email.");
            continue;
          }
          set.email = data.email;
        }
        await db.update(schema.employees).set(set).where(and(eq(schema.employees.id, existing.id), eq(schema.employees.orgId, orgId)));
        if (data.manager) pendingManagers.push({ row, id: existing.id, ref: data.manager });
        updated++;
        continue;
      }

      const missing = missingForNew(data);
      if (missing.length) {
        reject(row, `${missing.join(", ")} required for new employees.`);
        continue;
      }
      let code = data.code;
      if (!code) {
        do code = await nextNumber(orgId, "employee");
        while (takenCodes.has(code.toLowerCase()));
      }
      const memberId = data.email ? memberByEmail.get(data.email) : undefined;
      const userId = memberId && !linkedUsers.has(memberId) ? memberId : null;
      const cols = columnsOf(data, ae);
      const [inserted] = await db
        .insert(schema.employees)
        .values({
          // India PF / metro default on; they don't apply to the UAE.
          pfEnrolled: !ae,
          metro: !ae,
          annualCtc: 0,
          ...cols,
          orgId,
          code,
          userId,
          name: data.name,
          email: data.email ?? null,
          designation: data.designation!,
          joinDate: data.joinDate!,
          departmentId: departmentId ?? null,
        })
        .returning({ id: schema.employees.id });
      await createChecklist(orgId, inserted.id, "onboarding", data.joinDate!);
      takenCodes.add(code.toLowerCase());
      byCode.set(code.toLowerCase(), { id: inserted.id, code, email: data.email ?? null } as (typeof emps)[number]);
      if (data.email) byEmail.set(data.email, { id: inserted.id, code, email: data.email } as (typeof emps)[number]);
      if (userId) linkedUsers.add(userId);
      managerOf.set(inserted.id, null);
      if (data.manager) pendingManagers.push({ row, id: inserted.id, ref: data.manager });
      if (data.email && !userId) toInvite.push({ id: inserted.id, email: data.email });
      created++;
    } catch {
      reject(row, "Could not save this employee.");
    }
  }

  // Managers resolve after every row is in, so a manager may appear later in the file.
  for (const { row, id, ref } of pendingManagers) {
    const key = ref.toLowerCase();
    const target = (byCode.get(key) ?? byEmail.get(key))?.id;
    let problem: string | null = null;
    if (target === undefined) problem = `manager: "${ref}" not found`;
    else if (target === id) problem = "manager: an employee can't report to themselves";
    else {
      for (let cur: number | null | undefined = target, i = 0; cur != null && i <= managerOf.size; i++) {
        if (cur === id) {
          problem = "manager: that would create a reporting loop";
          break;
        }
        cur = managerOf.get(cur);
      }
    }
    if (problem || target === undefined) {
      errors.push({ row, message: `${problem} — employee imported without a manager change.` });
      continue;
    }
    await db.update(schema.employees).set({ managerId: target }).where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)));
    managerOf.set(id, target);
  }

  let invites: EmployeeImportSummary["invites"];
  if (invite) {
    invites = { emailed: 0, linkOnly: 0, failed: 0, links: [] };
    let left = await seatsLeft(ws);
    for (const [i, p] of toInvite.entries()) {
      if (left !== null && left <= 0) {
        invites.stopped = `Seat limit reached: ${toInvite.length - i} employee${toInvite.length - i === 1 ? " was" : "s were"} not invited. Upgrade to Growth for unlimited users, then use "Invite all to portal" on the People page.`;
        break;
      }
      const res = await createInvite(ws, p.email, "member");
      if (res.ok) {
        if (res.emailed) invites.emailed++;
        else {
          invites.linkOnly++;
          invites.links.push({ email: res.email, url: res.url });
        }
        if (left !== null) left--;
      } else if (res.error.includes("plan allows")) {
        invites.stopped = `${res.error} ${toInvite.length - i} employee${toInvite.length - i === 1 ? " was" : "s were"} not invited.`;
        break;
      } else invites.failed++;
    }
  }

  errors.sort((a, b) => a.row - b.row);
  if (created + updated) {
    await logActivity(ctxOf(ws), {
      module: "hrm",
      entityType: "employee",
      action: "imported",
      summary: `Imported employees from CSV: ${created} created, ${updated} updated, ${skipped} skipped, ${rejected} rejected${invites ? `, ${invites.emailed + invites.linkOnly} portal invites` : ""}`,
    });
    refresh();
  }
  return { ok: true, message: "Import finished.", created, updated, skipped: skipped + rejected, errors, invites };
}
