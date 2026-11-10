import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { MANUAL_STATUSES } from "@/lib/assets";
import { formatDate, todayYmd } from "@/lib/format";
import { canManage } from "@/lib/roles";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../../tabs";
import { AssetForm } from "../_asset-form";
import { assignAsset, returnAsset, updateAsset } from "../actions";

export const metadata: Metadata = { title: "Asset" };

const TONES = { available: "mint", assigned: "sky", in_repair: "butter", retired: "card" } as const;

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const orgId = ws.org.id;
  const [asset] = await db.select().from(schema.companyAssets).where(and(eq(schema.companyAssets.id, id), eq(schema.companyAssets.orgId, orgId))).limit(1);
  if (!asset) notFound();

  const history = await db
    .select({ a: schema.assetAssignments, employeeName: schema.employees.name, employeeCode: schema.employees.code })
    .from(schema.assetAssignments)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.assetAssignments.employeeId))
    .where(and(eq(schema.assetAssignments.assetId, id), eq(schema.assetAssignments.orgId, orgId)))
    .orderBy(desc(schema.assetAssignments.assignedDate), desc(schema.assetAssignments.id));
  const open = history.find((h) => !h.a.returnedDate);

  const manage = canManage(ws.role);
  const today = todayYmd();
  const employees =
    manage && asset.status === "available"
      ? await db
          .select({ id: schema.employees.id, name: schema.employees.name, code: schema.employees.code })
          .from(schema.employees)
          .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.status, "active")))
          .orderBy(asc(schema.employees.name))
      : [];

  return (
    <>
      <PageHeader
        title={`${asset.tag} · ${asset.name}`}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge tone={TONES[asset.status]}>{asset.status.replace("_", " ")}</Badge>
            {open && (
              <Link href={`/app/hrm/${open.a.employeeId}`} className="hover:underline">
                Held by {open.employeeName}
              </Link>
            )}
          </span>
        }
        tabs={hrmTabs(ws, "assets")}
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card title="Assignment history">
            {history.length === 0 ? (
              <EmptyState title="Never assigned" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Assigned</Th>
                    <Th>Returned</Th>
                    <Th>Condition</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(({ a, employeeName, employeeCode }) => (
                    <tr key={a.id}>
                      <Td>
                        <Link href={`/app/hrm/assets?employee=${a.employeeId}`} className="hover:underline">
                          {employeeName}
                        </Link>{" "}
                        <span className="text-xs text-ink-soft">{employeeCode}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(a.assignedDate)}</Td>
                      <Td className="whitespace-nowrap">{a.returnedDate ? formatDate(a.returnedDate) : <Badge tone="sky">current</Badge>}</Td>
                      <Td className="text-ink-soft">{a.returnCondition ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {manage && open && (
            <Card title="Return asset">
              <ActionForm action={returnAsset} className="space-y-3">
                <input type="hidden" name="id" value={asset.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Return date" name="date" type="date" defaultValue={today} min={open.a.assignedDate} />
                  <Select label="Status after return" name="status" options={MANUAL_STATUSES} defaultValue="available" />
                </div>
                <Textarea label="Condition note" name="condition" rows={2} placeholder="e.g. Good, minor scratches" />
                <SubmitButton>Mark returned</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {manage && asset.status === "available" && (
            <Card title="Assign to employee">
              <ActionForm action={assignAsset} className="space-y-3">
                <input type="hidden" name="id" value={asset.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Employee"
                    name="employeeId"
                    placeholder="Select employee"
                    options={employees.map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))}
                  />
                  <Input label="Assigned date" name="date" type="date" defaultValue={today} />
                </div>
                <SubmitButton>Assign</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <Card title={manage ? "Details" : "Asset"} className="h-fit">
          {manage ? (
            <AssetForm action={updateAsset} asset={asset} currency={ws.org.currency} />
          ) : (
            <dl className="space-y-2 text-sm">
              <div>Category: <span className="capitalize">{asset.category}</span></div>
              <div>Serial: {asset.serialNumber ?? "—"}</div>
              <div>Purchased: {formatDate(asset.purchaseDate)}</div>
              <div>Warranty: {formatDate(asset.warrantyExpiry)}</div>
              <div>Notes: {asset.notes ?? "—"}</div>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
