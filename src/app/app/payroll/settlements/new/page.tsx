import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Input } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { settlementSuggestions } from "../data";
import { SettlementForm } from "../settlement-form";

export const metadata: Metadata = { title: "New final settlement" };

export default async function NewSettlementPage(props: PageProps<"/app/payroll/settlements/new">) {
  const ws = await requireWorkspace({ module: "payroll", manage: true });
  const sp = await props.searchParams;
  const employeeId = Number(sp.employee);
  if (!Number.isInteger(employeeId)) redirect("/app/payroll/settlements");

  const [emp] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, ws.org.id)))
    .limit(1);
  if (!emp) notFound();
  const [existing] = await db.select({ id: schema.finalSettlements.id }).from(schema.finalSettlements).where(eq(schema.finalSettlements.employeeId, emp.id)).limit(1);
  if (existing) redirect(`/app/payroll/settlements/${existing.id}`);

  const requested = typeof sp.exit === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.exit) ? sp.exit : null;
  let exitDate = requested ?? emp.exitDate ?? todayYmd();
  if (exitDate < emp.joinDate) exitDate = emp.joinDate;
  const s = await settlementSuggestions(ws.org, emp, exitDate);

  return (
    <>
      <PageHeader
        title={`Final settlement · ${emp.name}`}
        description={`${emp.code} · ${emp.designation} · joined ${formatDate(emp.joinDate)} · ${emp.status}`}
        actions={
          <Link href="/app/payroll/settlements" className="text-sm text-ink-soft underline-offset-4 hover:underline">
            All settlements
          </Link>
        }
      />

      <Card title="Exit date" className="mb-6">
        <form className="flex flex-wrap items-start gap-3">
          <input type="hidden" name="employee" value={emp.id} />
          <Input label="Last working day" name="exit" type="date" defaultValue={exitDate} className="w-52" />
          <div className="pt-[22px]">
            <button className="inline-flex h-10 items-center rounded-full border border-ink/20 px-5 text-sm font-medium hover:border-ink">Refresh suggestions</button>
          </div>
        </form>
        <p className="mt-3 text-sm text-ink-soft">
          {emp.exitDate ? `HRM exit date: ${formatDate(emp.exitDate)}.` : "No exit date recorded in HRM yet — it is set when the settlement is paid."} Outstanding loans:{" "}
          <strong>{formatMoney(s.loanBalance, ws.org.currency)}</strong>.
        </p>
      </Card>

      <Card title="Settlement inputs">
        <SettlementForm
          employeeId={emp.id}
          values={{ exitDate, unpaidDays: s.unpaidDays, leaveDays: s.leaveDays, otherEarnings: 0, otherDeductions: 0 }}
          hints={{ unpaid: s.unpaidHint, leave: s.leaveHint }}
          submitLabel="Calculate & save draft"
        />
      </Card>
    </>
  );
}
