import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EditorProduct } from "@/components/app/invoice-lines-editor";
import { fromMinor } from "@/lib/money";
import type { CustomerOption } from "./_components/invoice-form";

/** CRM companies (with their first contact email) and active products for the invoice form pickers. */
export async function invoiceFormOptions(orgId: number): Promise<{ customers: CustomerOption[]; products: EditorProduct[] }> {
  const [companies, contacts, products] = await Promise.all([
    db.select().from(schema.companies).where(eq(schema.companies.orgId, orgId)).orderBy(asc(schema.companies.name)),
    db.select({ companyId: schema.contacts.companyId, email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.orgId, orgId)).orderBy(asc(schema.contacts.id)),
    db.select().from(schema.products).where(eq(schema.products.orgId, orgId)).orderBy(asc(schema.products.name)),
  ]);
  const email = new Map<number, string>();
  for (const c of contacts) if (c.companyId && c.email && !email.has(c.companyId)) email.set(c.companyId, c.email);
  return {
    customers: companies.map((c) => ({
      id: c.id,
      name: c.name,
      gstin: c.gstin ?? "",
      address: [c.billingAddress, c.city].filter(Boolean).join(", "),
      state: c.state ?? "",
      email: email.get(c.id) ?? "",
    })),
    products: products
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: fromMinor(p.sellingPrice), taxRate: p.taxRate })),
  };
}
