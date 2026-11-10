import Link from "next/link";
import { Badge, type Tone } from "@/components/app/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { quoteDisplayStatus, type QuoteStatus } from "@/lib/quotes";

const TONE: Record<QuoteStatus, Tone> = { draft: "card", sent: "sky", accepted: "mint", declined: "rose", expired: "butter", invoiced: "lilac" };

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={TONE[status]}>{status}</Badge>;
}

/** Compact quote list for deal / company sidebars. */
export function QuoteList({ quotes, currency, today }: { quotes: { id: number; number: string; status: string; validUntil: string; total: number }[]; currency: string; today: string }) {
  if (!quotes.length) return <p className="text-sm text-ink-soft">No quotes yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {quotes.map((q) => (
        <li key={q.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div>
            <Link href={`/app/crm/quotes/${q.id}`} className="font-mono font-medium hover:underline">
              {q.number}
            </Link>
            <p className="text-xs text-ink-mute">Valid until {formatDate(q.validUntil)}</p>
          </div>
          <span className="flex items-center gap-2 tabular-nums">
            {formatMoney(q.total, currency)} <QuoteStatusBadge status={quoteDisplayStatus(q, today)} />
          </span>
        </li>
      ))}
    </ul>
  );
}
