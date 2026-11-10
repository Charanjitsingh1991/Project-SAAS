import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hourlyCost } from "@/lib/projects";
import type { ActiveWorkspace } from "@/lib/tenancy";

export function projectTabs(active: "portfolio" | "my-tasks" | "timesheets") {
  return [
    { href: "/app/projects", label: "Portfolio", active: active === "portfolio" },
    { href: "/app/projects/my-tasks", label: "My tasks", active: active === "my-tasks" },
    { href: "/app/projects/timesheets", label: "Timesheets", active: active === "timesheets" },
  ];
}

export async function linkedEmployee(ws: ActiveWorkspace) {
  const [e] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, ws.org.id), eq(schema.employees.userId, ws.user.id)))
    .limit(1);
  return e ?? null;
}

export async function loadEmployees(orgId: number) {
  return db
    .select({ id: schema.employees.id, name: schema.employees.name, annualCtc: schema.employees.annualCtc, status: schema.employees.status })
    .from(schema.employees)
    .where(eq(schema.employees.orgId, orgId))
    .orderBy(asc(schema.employees.name));
}

export async function loadMembers(orgId: number) {
  return db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
}

export function costPerHourMap(emps: { id: number; annualCtc: number }[]) {
  return new Map(emps.map((e) => [e.id, hourlyCost(e.annualCtc)]));
}
