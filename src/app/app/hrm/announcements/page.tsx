import type { Metadata } from "next";
import { desc, eq, and } from "drizzle-orm";
import { Pin } from "lucide-react";
import { ActionButton, ActionForm, Input, SubmitButton, Textarea } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../tabs";
import { createAnnouncement, deleteAnnouncement, togglePin, updateAnnouncement } from "./actions";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const today = todayYmd();
  const rows = await db
    .select({ a: schema.announcements, author: schema.users.name })
    .from(schema.announcements)
    .leftJoin(schema.users, eq(schema.announcements.postedBy, schema.users.id))
    .where(and(eq(schema.announcements.orgId, ws.org.id)))
    .orderBy(desc(schema.announcements.pinned), desc(schema.announcements.createdAt), desc(schema.announcements.id));

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Company-wide notices shown on every team member's overview. Pinned posts stay on top; expired ones disappear."
        tabs={hrmTabs(ws, "announcements")}
      />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card title={`${rows.length} announcement${rows.length === 1 ? "" : "s"}`}>
          {rows.length === 0 ? (
            <EmptyState title="No announcements yet">Post the first one on the right.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map(({ a, author }) => {
                const expired = !!a.expiresOn && a.expiresOn < today;
                return (
                  <li key={a.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {a.pinned && <Pin className="size-3.5 text-ink-soft" aria-label="Pinned" />}
                          {a.title}
                          {expired && <Badge tone="rose">expired</Badge>}
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-line text-ink-soft">{a.body}</p>
                        <p className="mt-1.5 text-xs text-ink-mute">
                          {formatDate(a.createdAt)}
                          {author ? ` · ${author}` : ""}
                          {a.expiresOn ? ` · ${expired ? "expired" : "expires"} ${formatDate(a.expiresOn)}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <ActionButton action={togglePin} fields={{ id: a.id }}>
                          {a.pinned ? "Unpin" : "Pin"}
                        </ActionButton>
                        <ActionButton action={deleteAnnouncement} fields={{ id: a.id }} confirm={`Delete “${a.title}”?`}>
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">Edit</summary>
                      <ActionForm action={updateAnnouncement} className="mt-3 space-y-3" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={a.id} />
                        <Input label="Title" name="title" defaultValue={a.title} />
                        <Textarea label="Message" name="body" rows={4} defaultValue={a.body} />
                        <Input label="Hide after (optional)" name="expiresOn" type="date" defaultValue={a.expiresOn ?? ""} />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="pinned" defaultChecked={a.pinned} className="size-4 accent-ink" /> Pin to top
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="emailAll" className="size-4 accent-ink" /> Also email all employees
                        </label>
                        <SubmitButton>Save changes</SubmitButton>
                      </ActionForm>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Post announcement" className="h-fit">
          <ActionForm action={createAnnouncement} className="space-y-3">
            <Input label="Title" name="title" placeholder="e.g. Office closed on Friday" />
            <Textarea label="Message" name="body" rows={5} />
            <Input label="Hide after (optional)" name="expiresOn" type="date" min={today} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="pinned" className="size-4 accent-ink" /> Pin to top
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="emailAll" className="size-4 accent-ink" /> Also email all employees
            </label>
            <SubmitButton>Post announcement</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
