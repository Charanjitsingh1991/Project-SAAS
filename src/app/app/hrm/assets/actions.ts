"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import { ASSET_CATEGORIES, MANUAL_STATUSES, canAssign, canSetStatus } from "@/lib/assets";
import type { FormState } from "@/lib/definitions";
import { formObject, toMinor } from "@/lib/format";
import { isValidYmd } from "@/lib/hrm";
import { requireWorkspace } from "@/lib/tenancy";

const GUARD = { module: "hrm", manage: true } as const;
const Ymd = z.string().refine(isValidYmd, "Enter a valid date.");
const Id = z.string().regex(/^\d+$/, "Invalid selection.");

const AssetFields = z.object({
  name: z.string().min(2, "Enter the asset name.").max(120),
  category: z.enum(ASSET_CATEGORIES),
  serialNumber: z.string().max(80).optional(),
  purchaseDate: Ymd.optional(),
  purchaseCost: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount.").optional(),
  warrantyExpiry: Ymd.optional(),
  status: z.enum(MANUAL_STATUSES).optional(),
  notes: z.string().max(1000).optional(),
});

/** Reserve the next AST-0001 style tag (sequences.key is free text). */
async function nextAssetTag(orgId: number) {
  const [row] = await db
    .insert(schema.sequences)
    .values({ orgId, key: "asset", next: 2 })
    .onConflictDoUpdate({ target: [schema.sequences.orgId, schema.sequences.key], set: { next: sql`${schema.sequences.next} + 1` } })
    .returning({ next: schema.sequences.next });
  return `AST-${String(row.next - 1).padStart(4, "0")}`;
}

export async function createAsset(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace(GUARD);
  const parsed = AssetFields.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;
  const tag = await nextAssetTag(ws.org.id);
  const [row] = await db
    .insert(schema.companyAssets)
    .values({
      orgId: ws.org.id,
      tag,
      name: d.name,
      category: d.category,
      serialNumber: d.serialNumber ?? null,
      purchaseDate: d.purchaseDate ?? null,
      purchaseCost: d.purchaseCost ? toMinor(d.purchaseCost) : 0,
      warrantyExpiry: d.warrantyExpiry ?? null,
      status: d.status ?? "available",
      notes: d.notes ?? null,
    })
    .returning({ id: schema.companyAssets.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "asset", entityId: row.id, action: "created", summary: `Added asset ${tag} ${d.name}` });
  redirect(`/app/hrm/assets/${row.id}`);
}

export async function updateAsset(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace(GUARD);
  const obj = formObject(fd);
  const idp = Id.safeParse(obj.id);
  if (!idp.success) return { errors: { name: ["Invalid asset."] } };
  const [asset] = await db.select().from(schema.companyAssets).where(and(eq(schema.companyAssets.id, Number(idp.data)), eq(schema.companyAssets.orgId, ws.org.id))).limit(1);
  if (!asset) return { errors: { name: ["Asset not found."] } };
  const parsed = AssetFields.safeParse(obj);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;
  let status = asset.status;
  if (d.status && d.status !== asset.status) {
    const err = canSetStatus(asset.status, d.status);
    if (err) return { errors: { status: [err] } };
    status = d.status;
  }
  await db
    .update(schema.companyAssets)
    .set({
      name: d.name,
      category: d.category,
      serialNumber: d.serialNumber ?? null,
      purchaseDate: d.purchaseDate ?? null,
      purchaseCost: d.purchaseCost ? toMinor(d.purchaseCost) : 0,
      warrantyExpiry: d.warrantyExpiry ?? null,
      status,
      notes: d.notes ?? null,
    })
    .where(and(eq(schema.companyAssets.id, asset.id), eq(schema.companyAssets.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "asset", entityId: asset.id, action: "updated", summary: `Updated asset ${asset.tag}` });
  refresh();
  return { ok: true, message: "Asset saved." };
}

export async function assignAsset(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace(GUARD);
  const parsed = z.object({ id: Id, employeeId: Id, date: Ymd }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const orgId = ws.org.id;
  const [asset] = await db.select().from(schema.companyAssets).where(and(eq(schema.companyAssets.id, Number(parsed.data.id)), eq(schema.companyAssets.orgId, orgId))).limit(1);
  if (!asset) return { errors: { employeeId: ["Asset not found."] } };
  const [emp] = await db
    .select({ id: schema.employees.id, name: schema.employees.name, status: schema.employees.status })
    .from(schema.employees)
    .where(and(eq(schema.employees.id, Number(parsed.data.employeeId)), eq(schema.employees.orgId, orgId)))
    .limit(1);
  if (!emp) return { errors: { employeeId: ["Employee not found."] } };
  const err = canAssign(asset.status);
  if (err) return { errors: { employeeId: [err] } };
  try {
    await db.insert(schema.assetAssignments).values({ orgId, assetId: asset.id, employeeId: emp.id, assignedDate: parsed.data.date });
  } catch {
    return { errors: { employeeId: ["This asset already has an open assignment."] } };
  }
  await db.update(schema.companyAssets).set({ status: "assigned" }).where(and(eq(schema.companyAssets.id, asset.id), eq(schema.companyAssets.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "asset", entityId: asset.id, action: "assigned", summary: `Assigned ${asset.tag} to ${emp.name}` });
  refresh();
  return { ok: true, message: "Asset assigned." };
}

export async function returnAsset(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace(GUARD);
  const parsed = z
    .object({ id: Id, date: Ymd, condition: z.string().max(500).optional(), status: z.enum(MANUAL_STATUSES).default("available") })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const orgId = ws.org.id;
  const assetId = Number(parsed.data.id);
  const [asset] = await db.select().from(schema.companyAssets).where(and(eq(schema.companyAssets.id, assetId), eq(schema.companyAssets.orgId, orgId))).limit(1);
  if (!asset) return { errors: { date: ["Asset not found."] } };
  const [open] = await db
    .select()
    .from(schema.assetAssignments)
    .where(and(eq(schema.assetAssignments.assetId, assetId), eq(schema.assetAssignments.orgId, orgId), isNull(schema.assetAssignments.returnedDate)))
    .limit(1);
  if (!open) return { errors: { date: ["This asset is not currently assigned."] } };
  if (parsed.data.date < open.assignedDate) return { errors: { date: ["Return date can't be before the assigned date."] } };
  await db
    .update(schema.assetAssignments)
    .set({ returnedDate: parsed.data.date, returnCondition: parsed.data.condition ?? null })
    .where(and(eq(schema.assetAssignments.id, open.id), eq(schema.assetAssignments.orgId, orgId)));
  await db.update(schema.companyAssets).set({ status: parsed.data.status }).where(and(eq(schema.companyAssets.id, assetId), eq(schema.companyAssets.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "asset", entityId: assetId, action: "returned", summary: `Returned ${asset.tag}` });
  refresh();
  return { ok: true, message: "Asset returned." };
}
