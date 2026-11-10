import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, like, or } from "drizzle-orm";
import { Search } from "lucide-react";
import { ActionForm, Input, SubmitButton, Textarea } from "@/components/app/forms";
import { db, schema } from "@/db";
import { getPortalOrg, PortalShell } from "../parts";
import { submitRequestAction } from "../actions";

export async function generateMetadata({ params }: PageProps<"/support/[slug]">): Promise<Metadata> {
  const org = await getPortalOrg((await params).slug);
  return { title: `${org.name} Help center` };
}

export default async function SupportHome({ params, searchParams }: PageProps<"/support/[slug]">) {
  const org = await getPortalOrg((await params).slug);
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 100);

  const conds = [eq(schema.kbArticles.orgId, org.id), eq(schema.kbArticles.published, true)];
  if (q) conds.push(or(like(schema.kbArticles.title, `%${q}%`), like(schema.kbArticles.body, `%${q}%`))!);
  const articles = await db
    .select({ id: schema.kbArticles.id, title: schema.kbArticles.title, slug: schema.kbArticles.slug, category: schema.kbArticles.category, body: schema.kbArticles.body })
    .from(schema.kbArticles)
    .where(and(...conds))
    .orderBy(asc(schema.kbArticles.category), asc(schema.kbArticles.title));

  const byCategory = new Map<string, typeof articles>();
  for (const a of articles) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);

  return (
    <PortalShell org={org}>
      <section className="mb-10 rounded-[28px] border border-ink/10 bg-lime/60 px-6 py-10 text-center md:px-12">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">How can we help?</h1>
        <p className="mx-auto mt-2 max-w-lg text-ink-soft">Search {org.name}&apos;s help articles, or send us a request and we&apos;ll get back to you.</p>
        <form className="mx-auto mt-6 flex max-w-lg gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-mute" />
            <input name="q" defaultValue={q} maxLength={100} placeholder="Search articles…" aria-label="Search articles" className="h-12 w-full rounded-full border border-ink/10 bg-card pr-4 pl-10 outline-none focus:border-ink" />
          </div>
          <button className="h-12 rounded-full bg-ink px-6 font-medium text-paper">Search</button>
        </form>
      </section>

      <section className="mb-14">
        <h2 className="mb-4 font-display text-2xl font-semibold">{q ? `Results for “${q}”` : "Browse articles"}</h2>
        {articles.length === 0 ? (
          <p className="rounded-[16px] border border-dashed border-ink/20 px-6 py-10 text-center text-ink-soft">
            {q ? "No articles match your search. Try different words, or submit a request below." : "No articles published yet."}
          </p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {[...byCategory].map(([cat, list]) => (
              <div key={cat} className="rounded-[20px] border border-line bg-card p-5">
                <h3 className="mb-3 font-display text-lg font-semibold">{cat}</h3>
                <ul className="space-y-2">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={`/support/${org.slug}/article/${a.slug}`} className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="request" className="scroll-mt-8 rounded-[24px] border border-line bg-card p-6 md:p-8">
        <h2 className="font-display text-2xl font-semibold">Submit a request</h2>
        <p className="mt-1 mb-5 text-sm text-ink-soft">Can&apos;t find an answer? Tell us what&apos;s going on and we&apos;ll follow up by email.</p>
        <ActionForm action={submitRequestAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="slug" value={org.slug} />
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <Input label="Your name" name="name" required maxLength={120} autoComplete="name" />
          <Input label="Email" name="email" type="email" required maxLength={200} autoComplete="email" />
          <Input label="Subject" name="subject" required maxLength={200} className="md:col-span-2" />
          <Textarea label="How can we help?" name="description" rows={6} required maxLength={5000} className="md:col-span-2" />
          <div className="md:col-span-2">
            <SubmitButton variant="signal">Send request</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </PortalShell>
  );
}
