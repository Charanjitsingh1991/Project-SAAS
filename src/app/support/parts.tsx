import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { LogoMark } from "@/components/logo";
import { db, schema } from "@/db";

/** Resolve a workspace by its public slug; 404 when unknown. Only id/name/slug are exposed. */
export const getPortalOrg = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{1,80}$/i.test(slug)) notFound();
  const [org] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, slug.toLowerCase()))
    .limit(1);
  if (!org) notFound();
  return org;
});

export function PortalShell({ org, children }: { org: { name: string; slug: string }; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-card/60">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4">
          <Link href={`/support/${org.slug}`} className="font-display text-xl font-bold tracking-tight">
            {org.name}
            <span className="ml-2 font-sans text-sm font-normal text-ink-mute">Help center</span>
          </Link>
          <Link href={`/support/${org.slug}#request`} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
            Submit a request
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">{children}</main>
      <footer className="border-t border-line py-6">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-2 px-5 text-xs text-ink-mute">
          <LogoMark className="size-4" /> Support powered by <span className="font-display font-semibold text-ink">saas.tech</span>
        </div>
      </footer>
    </div>
  );
}

/** Plain text → paragraphs (blank line) with line breaks. React escapes everything. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={className}>
      {paras.map((p, i) => (
        <p key={i} className="mb-4 break-words last:mb-0">
          {p.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
