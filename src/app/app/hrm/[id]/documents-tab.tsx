import { and, desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { DOC_ACCEPT, DOC_TYPE_LABELS } from "@/lib/documents";
import { formatDate, todayYmd } from "@/lib/format";
import { deleteDocument, uploadDocument } from "./document-actions";

/** Lists documents without selecting the blob column. */
export async function listDocuments(orgId: number, employeeId: number) {
  const t = schema.employeeFiles;
  return db
    .select({ id: t.id, docType: t.docType, title: t.title, fileName: t.fileName, size: t.size, expiryDate: t.expiryDate, createdAt: t.createdAt })
    .from(t)
    .where(and(eq(t.orgId, orgId), eq(t.employeeId, employeeId)))
    .orderBy(desc(t.createdAt), desc(t.id));
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Doc = Awaited<ReturnType<typeof listDocuments>>[number];

export function DocumentList({ docs, canManage }: { docs: Doc[]; canManage: boolean }) {
  const today = todayYmd();
  if (docs.length === 0) return <EmptyState title="No documents yet" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Document</Th>
          <Th>Type</Th>
          <Th>Expires</Th>
          <Th>Size</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => (
          <tr key={d.id}>
            <Td>
              <p className="font-medium">{d.title || d.fileName}</p>
              {d.title && <p className="font-mono text-xs text-ink-mute">{d.fileName}</p>}
            </Td>
            <Td>{DOC_TYPE_LABELS[d.docType]}</Td>
            <Td>
              {d.expiryDate ? (
                <span className="flex items-center gap-2">
                  {formatDate(d.expiryDate)}
                  {d.expiryDate < today && <Badge tone="signal">Expired</Badge>}
                </span>
              ) : (
                "—"
              )}
            </Td>
            <Td>{kb(d.size)}</Td>
            <Td className="text-right">
              <span className="inline-flex items-center gap-2">
                <a href={`/api/documents/${d.id}`} className="inline-flex h-8 items-center rounded-full border border-line px-3 text-xs font-medium hover:border-ink">
                  Download
                </a>
                {canManage && (
                  <ActionButton action={deleteDocument} fields={{ id: d.id }} confirm="Delete this document permanently?">
                    Delete
                  </ActionButton>
                )}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export async function DocumentsTab({ empId, orgId }: { empId: number; orgId: number }) {
  const docs = await listDocuments(orgId, empId);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Documents">
        <DocumentList docs={docs} canManage />
      </Card>
      <Card title="Upload document">
        <ActionForm action={uploadDocument} className="space-y-4">
          <input type="hidden" name="employeeId" value={empId} />
          <Select label="Type" name="docType" options={Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          <Input label="Title (optional)" name="title" maxLength={120} />
          <Input label="Expiry date (optional)" name="expiryDate" type="date" />
          <Input label="File (PDF, PNG, JPG, WEBP, DOCX · max 4 MB)" name="file" type="file" accept={DOC_ACCEPT} />
          <SubmitButton>Upload</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
