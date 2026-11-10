import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { Select } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, formatMoney } from "@/lib/format";
import { packFor, requireWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Final settlements" };

const STATUS_ORDER: Record<string, number> = { exited: 0, notice: 1, active: 2 };

export default async function SettlementsPage() {
  const ws = await requireWorkspace({ module: "payroll", manage: true });
  const orgId = ws.org.id;
  const m = (n: number) => formatMoney(n, ws.org.currency);
  const uae = packFor(ws).code === "AE";

  const [rows, emps] = await Promise.all([
    db
      .select({ s: schema.finalSettlements, name: schema.employees.name, code: schema.employees.code })
      .from(schema.finalSettlements)
      .innerJoin(schema.employees, eq(schema.finalSettlements.employeeId, schema.employees.id))
      .where(eq(schema.finalSettlements.orgId, orgId))
      .orderBy(asc(schema.finalSettlements.status), desc(schema.finalSettlements.exitDate)),
    db
      .select({ id: schema.employees.id, name: schema.employees.name, code: schema.employees.code, status: schema.employees.status, exitDate: schema.employees.exitDate })
      .from(schema.employees)
      .where(eq(schema.employees.orgId, orgId))
      .orderBy(asc(schema.employees.name)),
  ]);

  const settled = new Set(rows.map((r) => r.s.employeeId));
  const candidates = emps.filter((e) => !settled.has(e.id)).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const paid = rows.filter((r) => r.s.status === "paid");
  const drafts = rows.filter((r) => r.s.status === "draft");

  return (
    <>
      <PageHeader
        title="Final settlements"
        description={
          uae
            ? "Full & final settlement on exit: pending salary, annual leave encashment, end-of-service gratuity (Art. 51) and loan recovery."
            : "Full & final settlement on exit: pending salary, earned leave encashment, gratuity (Payment of Gratuity Act) and loan recovery."
        }
        tabs={[
          { href: "/app/payroll", label: "Runs" },
          { href: "/app/payroll/loans", label: "Loans & advances" },
          { href: "/app/payroll/settlements", label: "Final settlements", active: true },
        ]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Drafts" value={drafts.length} hint={m(drafts.reduce((t, r) => t + r.s.netPayable, 0))} tone="butter" />
        <Stat label="Paid" value={paid.length} hint={m(paid.reduce((t, r) => t + r.s.netPayable, 0))} tone="mint" />
        <Stat label="Gratuity paid" value={m(paid.reduce((t, r) => t + r.s.gratuity, 0))} tone="sky" />
      </div>

      <Card title="New settlement" className="mb-6">
        {candidates.length === 0 ? (
          <EmptyState title="Everyone is settled">Employees without a settlement appear here.</EmptyState>
        ) : (
          <form action="/app/payroll/settlements/new" className="flex flex-wrap items-start gap-3">
            <Select
              label="Employee"
              name="employee"
              required
              className="w-80"
              options={candidates.map((e) => ({
                value: e.id,
                label: `${e.name} (${e.code}) · ${e.status}${e.exitDate ? ` · exit ${formatDate(e.exitDate)}` : ""}`,
              }))}
            />
            <div className="pt-[22px]">
              <button className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper transition hover:bg-ink/85">Continue</button>
            </div>
          </form>
        )}
        <p className="mt-3 text-sm text-ink-soft">Employees on notice or exited are listed first. Mark an exit in HRM to prefill the exit date.</p>
      </Card>

      <Card title="Settlements">
        {rows.length === 0 ? (
          <EmptyState title="No settlements yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Exit date</Th>
                <Th className="text-right">Service</Th>
                <Th className="text-right">Gratuity</Th>
                <Th className="text-right">Recovery</Th>
                <Th className="text-right">Net</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, name, code }) => (
                <tr key={s.id}>
                  <Td>
                    <p className="font-medium">{name}</p>
                    <p className="font-mono text-xs text-ink-mute">{code}</p>
                  </Td>
                  <Td>{formatDate(s.exitDate)}</Td>
                  <Td className="text-right tabular-nums">{(s.serviceDays / 365).toFixed(1)} yrs</Td>
                  <Td className="text-right tabular-nums">{m(s.gratuity)}</Td>
                  <Td className="text-right tabular-nums">{m(s.loanRecovery + s.otherDeductions)}</Td>
                  <Td className={`text-right font-medium tabular-nums ${s.netPayable < 0 ? "text-signal" : ""}`}>{m(s.netPayable)}</Td>
                  <Td>
                    <StatusBadge value={s.status} />
                  </Td>
                  <Td className="text-right">
                    <Link href={`/app/payroll/settlements/${s.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                      Open
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
