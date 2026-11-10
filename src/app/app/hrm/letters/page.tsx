import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { LETTER_KIND_LABEL, isLetterKind } from "@/lib/letters";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "HR letters" };

const selectCls = "h-10 rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink";

export default async function LettersPage({ searchParams }: { searchParams: Promise<{ employee?: string; kind?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const empId = /^\d+$/.test(sp.employee ?? "") ? Number(sp.employee) : null;
  const kind = isLetterKind(sp.kind) ? sp.kind : null;

  const [employees, rows] = await Promise.all([
    db
      .select({ id: schema.employees.id, name: schema.employees.name, code: schema.employees.code })
      .from(schema.employees)
      .where(eq(schema.employees.orgId, ws.org.id))
      .orderBy(asc(schema.employees.name)),
    db
      .select({ l: schema.hrLetters, name: schema.employees.name, code: schema.employees.code })
      .from(schema.hrLetters)
      .innerJoin(schema.employees, eq(schema.hrLetters.employeeId, schema.employees.id))
      .where(
        and(
          eq(schema.hrLetters.orgId, ws.org.id),
          empId ? eq(schema.hrLetters.employeeId, empId) : undefined,
          kind ? eq(schema.hrLetters.kind, kind) : undefined,
        ),
      )
      .orderBy(desc(schema.hrLetters.createdAt), desc(schema.hrLetters.id))
      .limit(200),
  ]);

  return (
    <>
      <PageHeader
        title="HR letters"
        description="Issue offer, appointment, experience, relieving, salary and no-objection letters. The text is frozen when issued."
        tabs={hrmTabs(ws, "letters")}
        actions={
          <Link href="/app/hrm/letters/new" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-paper">
            Issue a letter
          </Link>
        }
      />
      <Card
        title={`${rows.length} letter${rows.length === 1 ? "" : "s"}`}
        actions={
          <form className="flex flex-wrap items-center gap-2" action="/app/hrm/letters">
            <select name="employee" defaultValue={empId ?? ""} className={selectCls} aria-label="Employee">
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </select>
            <select name="kind" defaultValue={kind ?? ""} className={selectCls} aria-label="Letter type">
              <option value="">All types</option>
              {Object.entries(LETTER_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:border-ink">Filter</button>
          </form>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No letters found">Issue the first letter with the button above.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Subject</Th>
                <Th>Issued</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, name, code }) => (
                <tr key={l.id}>
                  <Td className="font-mono text-xs whitespace-nowrap">
                    <Link href={`/app/hrm/letters/${l.id}`} className="underline-offset-4 hover:underline">
                      {l.number}
                    </Link>
                  </Td>
                  <Td>
                    {name} <span className="text-xs text-ink-mute">{code}</span>
                  </Td>
                  <Td>{LETTER_KIND_LABEL[l.kind]}</Td>
                  <Td className="text-ink-soft">{l.subject}</Td>
                  <Td className="whitespace-nowrap">{formatDate(l.issuedOn)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
