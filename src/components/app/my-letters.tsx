import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Card } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { LETTER_KIND_LABEL } from "@/lib/letters";

/** Letters issued to one employee, linking to the printable view they are allowed to open. */
export async function MyLetters({ orgId, employeeId }: { orgId: number; employeeId: number }) {
  const rows = await db
    .select()
    .from(schema.hrLetters)
    .where(and(eq(schema.hrLetters.orgId, orgId), eq(schema.hrLetters.employeeId, employeeId)))
    .orderBy(desc(schema.hrLetters.issuedOn), desc(schema.hrLetters.id));

  return (
    <Card title="My letters">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No letters have been issued to you yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium">{LETTER_KIND_LABEL[l.kind]}</p>
                <p className="text-xs text-ink-mute">
                  <span className="font-mono">{l.number}</span> · {formatDate(l.issuedOn)}
                </p>
              </div>
              <Link href={`/app/hrm/letters/${l.id}`} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-ink">
                View / print
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
