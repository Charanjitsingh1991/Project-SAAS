import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { getPortalOrg, PortalShell, RichText } from "../../../parts";

async function loadArticle(slug: string, articleSlug: string) {
  const org = await getPortalOrg(slug);
  const [a] = await db
    .select()
    .from(schema.kbArticles)
    .where(and(eq(schema.kbArticles.orgId, org.id), eq(schema.kbArticles.slug, articleSlug), eq(schema.kbArticles.published, true)))
    .limit(1);
  if (!a) notFound();
  return { org, a };
}

export async function generateMetadata({ params }: PageProps<"/support/[slug]/article/[articleSlug]">): Promise<Metadata> {
  const p = await params;
  const { a } = await loadArticle(p.slug, p.articleSlug);
  return { title: a.title };
}

export default async function ArticlePage({ params }: PageProps<"/support/[slug]/article/[articleSlug]">) {
  const p = await params;
  const { org, a } = await loadArticle(p.slug, p.articleSlug);
  await db
    .update(schema.kbArticles)
    .set({ views: sql`${schema.kbArticles.views} + 1` })
    .where(and(eq(schema.kbArticles.id, a.id), eq(schema.kbArticles.orgId, org.id)));

  return (
    <PortalShell org={org}>
      <Link href={`/support/${org.slug}`} className="text-sm text-ink-soft hover:text-ink">
        ← All articles
      </Link>
      <article className="mt-4 max-w-2xl">
        <p className="font-mono text-xs tracking-widest text-ink-mute uppercase">{a.category}</p>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-tight">{a.title}</h1>
        <p className="mt-2 text-sm text-ink-mute">Updated {formatDate(a.updatedAt)}</p>
        <RichText text={a.body} className="mt-8 text-lg leading-relaxed" />
      </article>
      <div className="mt-12 rounded-[20px] border border-line bg-card p-6">
        <p className="font-display text-lg font-semibold">Still need help?</p>
        <Link href={`/support/${org.slug}#request`} className="mt-1 inline-block text-sm underline underline-offset-4">
          Submit a request
        </Link>
      </div>
    </PortalShell>
  );
}
