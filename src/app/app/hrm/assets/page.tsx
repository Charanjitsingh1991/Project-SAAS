import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, isNull, like, or } from "drizzle-orm";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, type Tone } from "@/components/app/ui";
import { db, schema } from "@/db";
import { ASSET_CATEGORIES, ASSET_STATUSES, warrantyState } from "@/lib/assets";
import { formatDate, formatMoney, todayYmd } from "@/lib/format";
import { canManage } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Assets" };

export const STATUS_TONES: Record<string, Tone> = { available: "mint", assigned: "sky", in_repair: "butter", retired: "card" };

type SP = { q?: string; status?: string; category?: string; employee?: string };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const orgId = ws.org.id;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const status = ASSET_STATUSES.find((s) => s === sp.status);
  const category = ASSET_CATEGORIES.find((c) => c === sp.category);
  const employeeId = /^\d+$/.test(sp.employee ?? "") ? Number(sp.employee) : null;
  const today = todayYmd();

  const [employee] = employeeId
    ? await db.select({ id: schema.employees.id, name: schema.employees.name }).from(schema.employees).where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId))).limit(1)
    : [];

  const where = [eq(schema.companyAssets.orgId, orgId)];
  if (status) where.push(eq(schema.companyAssets.status, status));
  if (category) where.push(eq(schema.companyAssets.category, category));
  if (q) {
    const pat = `%${q.replace(/[%_]/g, "")}%`;
    where.push(or(like(schema.companyAssets.name, pat), like(schema.companyAssets.tag, pat), like(schema.companyAssets.serialNumber, pat))!);
  }

  const rows = await db
    .select({
      asset: schema.companyAssets,
      holderId: schema.employees.id,
      holder: schema.employees.name,
    })
    .from(schema.companyAssets)
    .leftJoin(schema.assetAssignments, and(eq(schema.assetAssignments.assetId, schema.companyAssets.id), isNull(schema.assetAssignments.returnedDate)))
    .leftJoin(schema.employees, eq(schema.employees.id, schema.assetAssignments.employeeId))
    .where(and(...where, employee ? eq(schema.assetAssignments.employeeId, employee.id) : undefined))
    .orderBy(desc(schema.companyAssets.createdAt), asc(schema.companyAssets.tag));

  const manage = canManage(ws.role);
  const field = "h-10 rounded-xl border border-line bg-paper/60 px-3 text-sm capitalize";

  return (
    <>
      <PageHeader
        title="Assets"
        description="Company equipment register with assignment history."
        tabs={hrmTabs(ws, "assets")}
        actions={manage ? <Link href="/app/hrm/assets/new" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">New asset</Link> : undefined}
      />
      <Card title={`${rows.length} asset${rows.length === 1 ? "" : "s"}${employee ? ` held by ${employee.name}` : ""}`}>
        <form className="mb-4 flex flex-wrap items-center gap-2" action="/app/hrm/assets">
          <input name="q" defaultValue={q} placeholder="Search name, tag, serial" className={`${field} normal-case`} />
          <select name="status" defaultValue={status ?? ""} className={field}>
            <option value="">All statuses</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select name="category" defaultValue={category ?? ""} className={field}>
            <option value="">All categories</option>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {employee && <input type="hidden" name="employee" value={employee.id} />}
          <button className="h-10 rounded-full border border-line px-4 text-sm hover:border-ink">Filter</button>
          {(q || status || category || employee) && (
            <Link href="/app/hrm/assets" className="text-sm text-ink-soft hover:text-ink">
              Clear
            </Link>
          )}
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No assets found">{manage ? "Add an asset or adjust the filters." : "Adjust the filters."}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tag</Th>
                <Th>Asset</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th>Held by</Th>
                <Th>Warranty</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ asset: a, holderId, holder }) => {
                const w = warrantyState(a.warrantyExpiry, today);
                return (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link href={`/app/hrm/assets/${a.id}`} className="hover:underline">
                        {a.tag}
                      </Link>
                    </Td>
                    <Td>
                      {a.name}
                      {a.serialNumber && <div className="text-xs text-ink-soft">S/N {a.serialNumber}</div>}
                    </Td>
                    <Td className="capitalize">{a.category}</Td>
                    <Td>
                      <Badge tone={STATUS_TONES[a.status]}>{a.status.replace("_", " ")}</Badge>
                    </Td>
                    <Td>{holderId ? <Link href={`/app/hrm/assets?employee=${holderId}`} className="hover:underline">{holder}</Link> : "—"}</Td>
                    <Td className="whitespace-nowrap">
                      {a.warrantyExpiry ? formatDate(a.warrantyExpiry) : "—"}{" "}
                      {w === "expired" && <Badge tone="rose">expired</Badge>}
                      {w === "expiring" && <Badge tone="butter">expiring</Badge>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">{a.purchaseCost ? formatMoney(a.purchaseCost, ws.org.currency) : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
