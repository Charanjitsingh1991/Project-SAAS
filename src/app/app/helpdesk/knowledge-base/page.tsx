import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ExternalLink, Plus } from "lucide-react";
import { ActionButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { timeAgo } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { deleteArticleAction, toggleArticleAction } from "../actions";
import { HELPDESK_TABS } from "../tabs";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgeBasePage() {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const articles = await db.select().from(schema.kbArticles).where(eq(schema.kbArticles.orgId, ws.org.id)).orderBy(desc(schema.kbArticles.updatedAt));

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Self-service answers that deflect tickets. Published articles appear on your public help center."
        tabs={HELPDESK_TABS("kb")}
        actions={
          <>
            <Link href={`/support/${ws.org.slug}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
              <ExternalLink className="size-4" /> View help center
            </Link>
            <Link href="/app/helpdesk/knowledge-base/new" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-paper">
              <Plus className="size-4" /> New article
            </Link>
          </>
        }
      />
      <Card>
        {articles.length === 0 ? (
          <EmptyState title="No articles yet">Write your first answer to cut repeat questions.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th>Views</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} className="hover:bg-paper/50">
                  <Td>
                    <Link href={`/app/helpdesk/knowledge-base/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                    <span className="block font-mono text-xs text-ink-mute">{a.slug}</span>
                  </Td>
                  <Td>{a.category}</Td>
                  <Td>{a.published ? <Badge tone="mint">Published</Badge> : <Badge>Draft</Badge>}</Td>
                  <Td>{a.views}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{timeAgo(a.updatedAt)}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <ActionButton action={toggleArticleAction} fields={{ id: a.id }}>
                        {a.published ? "Unpublish" : "Publish"}
                      </ActionButton>
                      <ActionButton action={deleteArticleAction} fields={{ id: a.id }} confirm={`Delete “${a.title}”?`} className="text-signal">
                        Delete
                      </ActionButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
