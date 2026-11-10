import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { addDaysYmd, fromMinor, todayYmd } from "@/lib/format";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { QuoteForm } from "../../_components/quote-form";
import { CRM_TABS } from "../../tabs";
import { editorTax, getQuoteFormData } from "../form-data";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ dealId?: string; companyId?: string; contactId?: string }> }) {
  const ws = await requireWorkspace({ module: "crm" });
  const sp = await searchParams;
  const orgId = ws.org.id;
  const pack = packFor(ws);
  const data = await getQuoteFormData(orgId);

  // Prefill from a deal (company, contact, value as a single line) or a company/contact.
  const dealId = Number(sp.dealId) || undefined;
  const [deal] = dealId ? await db.select().from(schema.deals).where(and(eq(schema.deals.id, dealId), eq(schema.deals.orgId, orgId))).limit(1) : [];
  const companyId = deal?.companyId ?? (Number(sp.companyId) || null);
  const [company] = companyId ? await db.select().from(schema.companies).where(and(eq(schema.companies.id, companyId), eq(schema.companies.orgId, orgId))).limit(1) : [];
  const today = todayYmd();

  return (
    <>
      <PageHeader title="New quote" description={deal ? `For deal “${deal.title}”` : company ? `For ${company.name}` : undefined} tabs={CRM_TABS("quotes")} />
      <Card>
        <QuoteForm
          initial={{
            dealId: deal?.id ?? null,
            companyId: company?.id ?? null,
            contactId: deal?.contactId ?? (Number(sp.contactId) || null),
            placeOfSupply: company?.state ?? null,
            issueDate: today,
            validUntil: addDaysYmd(today, 30),
            lines: deal && deal.value > 0 ? [{ productId: null, description: deal.title, quantity: 1, unitPrice: fromMinor(deal.value), discountPercent: 0, taxCode: pack.tax.defaultCode }] : undefined,
          }}
          {...data}
          currency={ws.org.currency}
          tax={editorTax(pack)}
          regionLabel={pack.regionLabel}
          regions={pack.regions}
        />
      </Card>
    </>
  );
}
