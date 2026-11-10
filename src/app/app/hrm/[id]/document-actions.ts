"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { DOC_TYPE_LABELS, MAX_DOC_BYTES, detectMime, sanitizeFilename } from "@/lib/documents";
import { isValidYmd } from "@/lib/hrm";
import { requireWorkspace } from "@/lib/tenancy";

export async function uploadDocument(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;

  const employeeId = Number(fd.get("employeeId"));
  const [emp] = Number.isInteger(employeeId)
    ? await db.select({ id: schema.employees.id, name: schema.employees.name }).from(schema.employees).where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, orgId))).limit(1)
    : [];
  if (!emp) return { message: "Employee not found." };

  const docType = String(fd.get("docType") ?? "");
  if (!(docType in DOC_TYPE_LABELS)) return { errors: { docType: ["Choose a document type."] } };
  const title = String(fd.get("title") ?? "").trim().slice(0, 120) || null;
  const expiry = String(fd.get("expiryDate") ?? "").trim();
  if (expiry && !isValidYmd(expiry)) return { errors: { expiryDate: ["Enter a valid date."] } };

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: { file: ["Choose a file to upload."] } };
  if (file.size > MAX_DOC_BYTES) return { errors: { file: ["File is larger than 4 MB."] } };
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (!mime) return { errors: { file: ["Unsupported file. Upload a PDF, PNG, JPG, WEBP or DOCX."] } };
  const fileName = sanitizeFilename(file.name, mime);

  const [row] = await db
    .insert(schema.employeeFiles)
    .values({
      orgId,
      employeeId: emp.id,
      docType: docType as keyof typeof DOC_TYPE_LABELS,
      title,
      fileName,
      mimeType: mime,
      size: bytes.length,
      expiryDate: expiry || null,
      data: bytes,
      uploadedBy: ws.user.id,
    })
    .returning({ id: schema.employeeFiles.id });
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee_document", entityId: row.id, action: "uploaded", summary: `Uploaded ${DOC_TYPE_LABELS[docType as keyof typeof DOC_TYPE_LABELS]} for ${emp.name}` });
  refresh();
  return { ok: true, message: "Document uploaded." };
}

export async function deleteDocument(fd: FormData): Promise<void> {
  const ws = await requireWorkspace({ module: "hrm" });
  const orgId = ws.org.id;
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const [doc] = await db
    .select({ id: schema.employeeFiles.id, fileName: schema.employeeFiles.fileName })
    .from(schema.employeeFiles)
    .where(and(eq(schema.employeeFiles.id, id), eq(schema.employeeFiles.orgId, orgId)))
    .limit(1);
  if (!doc) return;
  await db.delete(schema.employeeFiles).where(and(eq(schema.employeeFiles.id, id), eq(schema.employeeFiles.orgId, orgId)));
  await logActivity(ctxOf(ws), { module: "hrm", entityType: "employee_document", entityId: id, action: "deleted", summary: `Deleted document ${doc.fileName}` });
  refresh();
}
