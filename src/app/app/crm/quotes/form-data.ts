import "server-only";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fromMinor } from "@/lib/format";
import { getCompanyOptions, getContactOptions } from "../data";

/** Options for the quote form: open deals, companies, contacts and active products (prices in major units). */
export async function getQuoteFormData(orgId: number) {
  const [deals, companies, contacts, products] = await Promise.all([
    db
      .select({ id: schema.deals.id, title: schema.deals.title })
      .from(schema.deals)
      .where(and(eq(schema.deals.orgId, orgId), notInArray(schema.deals.stage, ["won", "lost"])))
      .orderBy(asc(schema.deals.title)),
    getCompanyOptions(orgId),
    getContactOptions(orgId),
    db
      .select({ id: schema.products.id, name: schema.products.name, sku: schema.products.sku, price: schema.products.sellingPrice, taxRate: schema.products.taxRate })
      .from(schema.products)
      .where(and(eq(schema.products.orgId, orgId), eq(schema.products.active, true)))
      .orderBy(asc(schema.products.name)),
  ]);
  return {
    deals: deals.map((d) => ({ value: d.id, label: d.title })),
    companies,
    contacts,
    products: products.map((p) => ({ ...p, price: fromMinor(p.price) })),
  };
}

/** Plain, client-serialisable tax settings for the editor (packs contain functions). */
export function editorTax(pack: { tax: { name: string; rates: { code: string; rate: number; label: string; kind: "standard" | "zero" | "exempt" }[]; defaultCode: string } }) {
  return { name: pack.tax.name, rates: pack.tax.rates.map((r) => ({ ...r })), defaultCode: pack.tax.defaultCode };
}
