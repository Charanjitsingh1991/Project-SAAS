import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { Pin } from "lucide-react";
import { Card } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";

/** Pinned first, then latest; expired announcements are hidden. Scoped to one workspace. */
export async function AnnouncementsFeed({ orgId, limit = 5 }: { orgId: number; limit?: number }) {
  const today = todayYmd();
  const rows = await db
    .select({ a: schema.announcements, author: schema.users.name })
    .from(schema.announcements)
    .leftJoin(schema.users, eq(schema.announcements.postedBy, schema.users.id))
    .where(and(eq(schema.announcements.orgId, orgId), or(isNull(schema.announcements.expiresOn), gte(schema.announcements.expiresOn, today))))
    .orderBy(desc(schema.announcements.pinned), desc(schema.announcements.createdAt), desc(schema.announcements.id))
    .limit(limit);
  if (rows.length === 0) return null;

  return (
    <Card title="Announcements" className="mb-6">
      <ul className="divide-y divide-line">
        {rows.map(({ a, author }) => (
          <li key={a.id} className="py-3 first:pt-0 last:pb-0">
            <p className="flex items-center gap-1.5 font-medium">
              {a.pinned && <Pin className="size-3.5 text-ink-soft" aria-label="Pinned" />}
              {a.title}
            </p>
            <p className="mt-1 text-sm whitespace-pre-line text-ink-soft">{a.body}</p>
            <p className="mt-1.5 text-xs text-ink-mute">
              {formatDate(a.createdAt)}
              {author ? ` · ${author}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
