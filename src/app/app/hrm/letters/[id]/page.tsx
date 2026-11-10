import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { PrintButton } from "@/app/app/payroll/print-button";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { letterParagraphs } from "@/lib/letters";
import { canUseModule, packFor, requireWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Letter" };

export default async function LetterPage(props: PageProps<"/app/hrm/letters/[id]">) {
  const ws = await requireWorkspace();
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const [row] = await db
    .select({ l: schema.hrLetters, emp: schema.employees, issuer: schema.users.name })
    .from(schema.hrLetters)
    .innerJoin(schema.employees, eq(schema.hrLetters.employeeId, schema.employees.id))
    .leftJoin(schema.users, eq(schema.hrLetters.issuedBy, schema.users.id))
    .where(and(eq(schema.hrLetters.id, id), eq(schema.hrLetters.orgId, ws.org.id)))
    .limit(1);
  if (!row) notFound();
  const { l, emp, issuer } = row;

  const isHr = canUseModule(ws, "hrm");
  const isSelf = emp.userId != null && emp.userId === ws.user.id;
  if (!isHr && !isSelf) notFound();

  const pack = packFor(ws);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={isHr ? "/app/hrm/letters" : "/app/me"} className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← Back
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-[20px] border border-line bg-card p-10 print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-line pb-5">
          <h1 className="text-2xl font-semibold tracking-tight">{ws.org.name}</h1>
          {ws.org.address && <p className="mt-1 max-w-sm text-sm whitespace-pre-line text-ink-soft">{ws.org.address}</p>}
          {ws.org.gstin && (
            <p className="mt-1 font-mono text-xs text-ink-mute">
              {pack.tax.idLabel} {ws.org.gstin}
            </p>
          )}
        </header>

        <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
          <p>
            <span className="text-ink-mute">Ref:</span> <span className="font-mono">{l.number}</span>
          </p>
          <p>
            <span className="text-ink-mute">Date:</span> {formatDate(l.issuedOn)}
          </p>
        </div>

        <h2 className="mt-6 text-lg font-semibold">{l.subject}</h2>

        <div className="mt-5 space-y-4 text-[15px] leading-relaxed">
          {letterParagraphs(l.body).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>

        <footer className="mt-14">
          <div className="h-12 w-52 border-b border-ink/40" />
          <p className="mt-2 text-sm font-medium">{issuer ?? "Authorised signatory"}</p>
          <p className="text-sm text-ink-soft">{ws.org.name}</p>
        </footer>
      </article>
    </div>
  );
}
