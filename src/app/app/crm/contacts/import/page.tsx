import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app/ui";
import { LEAD_SOURCES, LIFECYCLES } from "@/db/schema";
import { CONTACT_COLUMNS, templateCsv } from "@/lib/imports";
import { requireWorkspace } from "@/lib/tenancy";
import { CRM_TABS } from "../../tabs";
import { DuplicateMode, ImportForm } from "../../companies/import/import-ui";
import { importContacts } from "./actions";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportContactsPage() {
  await requireWorkspace({ module: "crm" });
  const columns = [...CONTACT_COLUMNS];
  const template = templateCsv(columns, { name: "Jane Doe", title: "Procurement lead", email: "jane@acme.example", phone: "+1 555 0101", company: "Acme Traders", lifecycle: "lead", source: "referral" });

  return (
    <>
      <PageHeader title="Import contacts" description="Add or update contacts in bulk from a CSV file." tabs={CRM_TABS("contacts")} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Upload">
          <ImportForm action={importContacts} template={template} filename="contacts-template.csv">
            <DuplicateMode keyLabel="same email, case-insensitive" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="createCompanies" className="size-4" /> Create missing companies referenced in the company column
            </label>
          </ImportForm>
        </Card>
        <Card title="Expected columns">
          <p className="font-mono text-xs break-all">{columns.join(",")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Header names are case-insensitive and match the contacts export, so an exported file can be re-imported.</li>
            <li>
              <b>name</b> is required. lifecycle: {LIFECYCLES.join(", ")} (default lead). source: {LEAD_SOURCES.join(", ")} (default other).
            </li>
            <li>Contacts are matched by email. Rows without an email are always created; repeated emails inside the file are rejected after the first.</li>
            <li>company links to an existing company by name. Unknown names reject the row unless you tick the create option.</li>
            <li>Invalid rows are skipped and listed with their line number; valid rows are still imported.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
