import type { Metadata } from "next";
import { DuplicateMode, ImportForm } from "@/app/app/crm/companies/import/import-ui";
import { Card, PageHeader } from "@/components/app/ui";
import { UNITS } from "@/db/schema";
import { PRODUCT_COLUMNS, templateCsv } from "@/lib/imports";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { INVENTORY_TABS } from "../../tabs";
import { importProducts } from "./actions";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportProductsPage() {
  const ws = await requireWorkspace({ module: "inventory" });
  const pack = packFor(ws);
  const columns = [...PRODUCT_COLUMNS];
  const rates = pack.tax.rates.map((r) => r.rate);
  const template = templateCsv(columns, { sku: "SKU-001", name: "Sample product", category: "General", unit: "pcs", cost_price: "10.00", selling_price: "15.00", gst_rate: String(rates[0] ?? 0), reorder_level: "5", active: "true" });

  return (
    <>
      <PageHeader title="Import products" description="Add or update products in bulk from a CSV file." tabs={INVENTORY_TABS("products")} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Upload">
          <ImportForm action={importProducts} template={template} filename="products-template.csv">
            <DuplicateMode keyLabel="same SKU" />
          </ImportForm>
        </Card>
        <Card title="Expected columns">
          <p className="font-mono text-xs break-all">{columns.join(",")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Header names are case-insensitive and match the products export, so an exported file can be re-imported.</li>
            <li>
              <b>sku</b> and <b>name</b> are required. unit: {UNITS.join(", ")} (default pcs). Prices are in major units (e.g. 12.50) in {ws.org.currency}.
            </li>
            <li>
              {pack.tax.name} rate (gst_rate) must be one of: {rates.join(", ")}. Blank uses the default rate. active: true/false.
            </li>
            <li>Products are matched by exact SKU. Repeated SKUs inside the file are rejected after the first.</li>
            <li>on_hand and stock_value columns are ignored; stock changes go through movements, receipts or stock counts.</li>
            <li>Invalid rows are skipped and listed with their line number; valid rows are still imported.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
