import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/plain|text\/csv|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword)$/;

/** Validate and store an uploaded file in the database. Returns the file id or an error message. */
export async function saveUpload(orgId: number, userId: number, file: File | null): Promise<{ id: number } | { error: string }> {
  if (!file || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_FILE_BYTES) return { error: "Files must be 5 MB or smaller." };
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.test(mime)) return { error: "Upload a PDF, image, Word, Excel, text or CSV file." };
  const name = file.name.replace(/[\\/\r\n"]/g, "_").slice(0, 160) || "file";
  const data = Buffer.from(await file.arrayBuffer());
  const [row] = await db.insert(schema.files).values({ orgId, name, mime, size: data.length, data, uploadedBy: userId }).returning({ id: schema.files.id });
  return { id: row.id };
}

export async function fileMeta(orgId: number, id: number) {
  const [f] = await db
    .select({ id: schema.files.id, name: schema.files.name, mime: schema.files.mime, size: schema.files.size, createdAt: schema.files.createdAt })
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.orgId, orgId)))
    .limit(1);
  return f ?? null;
}

/** Load a file for download. Callers must authorize access to the record that references it. */
export async function readFile(orgId: number, id: number) {
  const [f] = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.orgId, orgId))).limit(1);
  return f ?? null;
}

export async function deleteFile(orgId: number, id: number) {
  await db.delete(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.orgId, orgId)));
}

/** Response for a stored file; inline for PDFs/images so they open in the browser. */
export function fileResponse(f: { name: string; mime: string; data: Buffer | Uint8Array }) {
  const inline = /^(application\/pdf|image\/)/.test(f.mime);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${f.name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
