import type { Metadata } from "next";
import { Zap } from "lucide-react";
import { saveAutomations, saveCompanyProfile } from "@/app/app/actions";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { INDIAN_STATES } from "@/lib/accounting";
import { AUTOMATIONS, parseAutomations } from "@/lib/automations";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ws = await requireWorkspace({ manage: true });
  const auto = parseAutomations(ws.org.automations);
  const portal = `${await appOrigin()}/support/${ws.org.slug}`;

  return (
    <>
      <PageHeader title="Settings" description="Company tax profile and the automations that connect your modules." />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Zap className="size-4" /> Automations
            </span>
          }
        >
          <form action={saveAutomations} className="space-y-1">
            <p className="mb-4 text-sm text-ink-soft">
              These run instantly when the event happens — no sync jobs. Turn off any you&apos;d rather do by hand.
            </p>
            <ul className="divide-y divide-line">
              {AUTOMATIONS.map((a) => (
                <li key={a.key}>
                  <label className="flex cursor-pointer items-start gap-4 py-4">
                    <input type="checkbox" name={a.key} defaultChecked={auto[a.key]} className="peer sr-only" />
                    <span className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full border border-line bg-paper-2 transition peer-checked:border-ink peer-checked:bg-ink after:absolute after:top-0.5 after:left-0.5 after:size-[18px] after:rounded-full after:bg-card after:shadow after:transition peer-checked:after:translate-x-4 peer-focus-visible:ring-4 peer-focus-visible:ring-ink/10" />
                    <span>
                      <span className="block font-mono text-[10px] tracking-widest text-ink-mute uppercase">{a.module}</span>
                      <span className="block font-medium">{a.title}</span>
                      <span className="block text-sm text-ink-soft">{a.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="pt-4">
              <SubmitButton>Save automations</SubmitButton>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card title="Company tax profile">
            <ActionForm action={saveCompanyProfile} className="space-y-3" resetOnSuccess={false}>
              <Select label="State (place of business)" name="state" defaultValue={ws.org.state ?? ""} placeholder="Select state…" options={INDIAN_STATES} className="[&_select]:normal-case" />
              <Input label="GSTIN" name="gstin" defaultValue={ws.org.gstin ?? ""} placeholder="29ABCDE1234F1Z5" className="[&_input]:uppercase" />
              <Textarea label="Registered address" name="address" defaultValue={ws.org.address ?? ""} />
              <p className="text-xs text-ink-mute">Printed on invoices, POs and payslips. Invoices to customers in the same state show CGST + SGST; others show IGST.</p>
              <SubmitButton variant="outline" className="w-full">
                Save
              </SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Customer support portal">
            <p className="text-sm text-ink-soft">Customers can search your knowledge base and raise tickets here:</p>
            <a href={portal} target="_blank" className="mt-2 block truncate font-mono text-xs underline underline-offset-4">
              {portal}
            </a>
          </Card>
        </div>
      </div>
    </>
  );
}
