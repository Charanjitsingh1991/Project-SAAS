import type { Metadata } from "next";
import Link from "next/link";
import { asc, and, eq, ne } from "drizzle-orm";
import { Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { initials } from "@/lib/format";
import { buildOrgTree } from "@/lib/hrm";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Org chart" };

type P = { id: number; managerId: number | null; name: string; designation: string; dept: string | null };
type N = P & { children: N[] };

function Node({ n }: { n: N }) {
  return (
    <li>
      <Link href={`/app/hrm/${n.id}`} className="inline-flex min-w-44 items-center gap-2.5 rounded-2xl border border-line bg-card px-3 py-2 text-left hover:border-ink">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-mint text-xs font-semibold">{initials(n.name)}</span>
        <span className="text-sm leading-tight">
          <span className="block font-medium">{n.name}</span>
          <span className="block text-xs text-ink-soft">{n.designation}</span>
          {n.dept && <span className="block font-mono text-[10px] tracking-wider text-ink-mute uppercase">{n.dept}</span>}
        </span>
      </Link>
      {n.children.length > 0 && (
        <ul>
          {n.children.map((c) => (
            <Node key={c.id} n={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrgChartPage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const [emps, depts] = await Promise.all([
    db
      .select({ id: schema.employees.id, managerId: schema.employees.managerId, name: schema.employees.name, designation: schema.employees.designation, departmentId: schema.employees.departmentId })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), ne(schema.employees.status, "exited")))
      .orderBy(asc(schema.employees.name)),
    db.select().from(schema.departments).where(eq(schema.departments.orgId, orgId)),
  ]);
  const dn = new Map(depts.map((d) => [d.id, d.name]));
  const tree = buildOrgTree<P>(emps.map((e) => ({ id: e.id, managerId: e.managerId, name: e.name, designation: e.designation, dept: e.departmentId ? (dn.get(e.departmentId) ?? null) : null })));

  return (
    <>
      <PageHeader title="Org chart" description="Reporting lines built from each employee's manager. Click a card to open the profile." tabs={hrmTabs("org-chart")} />
      <Card>
        {tree.length === 0 ? (
          <EmptyState title="Nothing to draw yet">Add employees and set who they report to.</EmptyState>
        ) : (
          <div className="overflow-x-auto pb-2">
            <ul className="org-tree">
              {tree.map((n) => (
                <Node key={n.id} n={n} />
              ))}
            </ul>
          </div>
        )}
      </Card>
      <style>{`
        .org-tree, .org-tree ul { list-style: none; margin: 0; padding: 0; }
        .org-tree ul { margin-left: 1.5rem; padding-left: 1.25rem; border-left: 1px solid var(--color-line, #ddd); }
        .org-tree li { position: relative; padding: 0.35rem 0; }
        .org-tree ul > li::before { content: ""; position: absolute; left: -1.25rem; top: 1.6rem; width: 1.25rem; border-top: 1px solid var(--color-line, #ddd); }
      `}</style>
    </>
  );
}
