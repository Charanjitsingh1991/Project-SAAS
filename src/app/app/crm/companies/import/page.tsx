import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app/ui";
import { COMPANY_COLUMNS, templateCsv } from "@/lib/imports";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { CRM_TABS } from "../../tabs";
import { importCompanies } from "./actions";
import { DuplicateMode, ImportForm } from "./import-ui";

export const metadata: Metadata = { title: "Import companies" };

export default async function ImportCompaniesPage() {
  const ws = await requireWorkspace({ module: "crm" });
  const pack = packFor(ws);
  const columns = COMPANY_COLUMNS.map((c) => (c === "gstin" ? pack.tax.idLabel.toLowerCase() : c === "state" ? pack.regionLabel.toLowerCase() : c));
  const template = templateCsv(columns, { name: "Acme Traders", industry: "Retail", website: "https://acme.example", phone: "+1 555 0100", [columns[4]]: pack.tax.idExample, city: "Mumbai", country: pack.name });

  return (
    <>
      <PageHeader title="Import companies" description="Add or update accounts in bulk from a CSV file." tabs={CRM_TABS("companies")} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Upload">
          <ImportForm action={importCompanies} template={template} filename="companies-template.csv">
            <DuplicateMode keyLabel="same company name, case-insensitive" />
          </ImportForm>
        </Card>
        <Card title="Expected columns">
          <p className="font-mono text-xs break-all">{columns.join(",")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Header names are case-insensitive and match the companies export, so an exported file can be re-imported.</li>
            <li>
              <b>name</b> is required; everything else is optional. {pack.tax.idLabel} is validated for your country.
            </li>
            <li>Companies are matched by name within this workspace. Duplicate names inside the file are rejected after the first.</li>
            <li>Invalid rows are skipped and listed with their line number; valid rows are still imported.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
