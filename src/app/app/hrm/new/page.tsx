import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { todayYmd } from "@/lib/format";
import { peekNumber } from "@/lib/sequence";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { createEmployee } from "../actions";
import { CompFields, JobFields, PersonalFields, StatutoryFields } from "../_components/employee-fields";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const [depts, mgrs, code] = await Promise.all([
    db.select().from(schema.departments).where(eq(schema.departments.orgId, orgId)).orderBy(asc(schema.departments.name)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name, designation: schema.employees.designation })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited")))
      .orderBy(asc(schema.employees.name)),
    peekNumber(orgId, "employee"),
  ]);
  const today = todayYmd();
  const pack = packFor(ws);

  return (
    <>
      <PageHeader
        title="Add employee"
        description={`Employee code ${code} is assigned automatically. An onboarding checklist is created from the join date.`}
        actions={
          <Link href="/app/hrm" className="text-sm text-ink-soft hover:text-ink">
            ← Back to directory
          </Link>
        }
      />
      <ActionForm action={createEmployee} resetOnSuccess={false} className="space-y-6">
        <Card title="Personal">
          <PersonalFields pack={pack} />
        </Card>
        <Card title="Job">
          <JobFields
            departments={depts.map((d) => ({ value: d.id, label: d.name }))}
            joinDefault={today}
            managers={mgrs.map((m) => ({ value: m.id, label: `${m.name} — ${m.designation}` }))}
          />

        </Card>
        <Card title="Compensation">
          <CompFields pack={pack} />
        </Card>
        <Card title={pack.code === "AE" ? "Identity, visa & bank" : "Statutory & bank"}>
          <StatutoryFields pack={pack} />
        </Card>
        <p className="text-xs text-ink-mute">If the work email matches a workspace member, their login is linked automatically for My space.</p>
        <SubmitButton>Create employee</SubmitButton>
      </ActionForm>
    </>
  );
}
