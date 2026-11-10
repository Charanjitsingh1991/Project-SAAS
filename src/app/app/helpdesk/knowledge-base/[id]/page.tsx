import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { requireWorkspace } from "@/lib/tenancy";
import { HELPDESK_TABS } from "../../tabs";
import { ArticleForm } from "../article-form";

export const metadata: Metadata = { title: "Edit article" };

export default async function EditArticlePage({ params }: PageProps<"/app/helpdesk/knowledge-base/[id]">) {
  const ws = await requireWorkspace({ module: "helpdesk" });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [a] = await db.select().from(schema.kbArticles).where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.orgId, ws.org.id))).limit(1);
  if (!a) notFound();
  return (
    <>
      <PageHeader title="Edit article" description={`/support/${ws.org.slug}/article/${a.slug} · ${a.views} views`} tabs={HELPDESK_TABS("kb")} />
      <Card className="max-w-3xl">
        <ArticleForm article={a} />
      </Card>
    </>
  );
}
