import { Badge, type Tone } from "@/components/app/ui";
import type { QuoteStatus } from "@/lib/quotes";

const TONE: Record<QuoteStatus, Tone> = { draft: "card", sent: "sky", accepted: "mint", declined: "rose", expired: "butter", invoiced: "lilac" };

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={TONE[status]}>{status}</Badge>;
}
