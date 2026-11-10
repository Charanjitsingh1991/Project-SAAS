import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createWorkspace } from "@/app/app/actions";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { COUNTRY_LIST } from "@/lib/countries";
import { getWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Create workspace" };

export default async function SetupPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");
  if (ws.org) redirect("/app");

  return (
    <div className="mx-auto max-w-lg py-10">
      <p className="font-mono text-xs tracking-widest text-ink-mute uppercase">Step 1 of 1</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Name your <span className="font-serif font-normal italic">workspace.</span>
      </h1>
      <p className="mt-2 text-ink-soft">This is your company account. You can invite your team and give them roles once it&apos;s created. Your 14-day free trial starts today — no card needed.</p>
      <ActionForm action={createWorkspace} className="mt-8 space-y-4 rounded-[20px] border border-line bg-card p-6" resetOnSuccess={false}>
        <Input label="Company / workspace name" name="name" defaultValue={ws.user.company ?? ""} placeholder="Acme Trading LLC" />
        <Select
          label="Country"
          name="country"
          defaultValue={ws.user.phone?.startsWith("+971") ? "AE" : "IN"}
          options={COUNTRY_LIST.map((c) => ({ value: c.code, label: `${c.flag} ${c.name} — ${c.currency}, ${c.tax.name}` }))}
          className="[&_select]:normal-case"
        />
        <p className="text-xs text-ink-mute">Sets currency, tax ({"GST/VAT"}), payroll rules, leave policy and public holidays. You can&apos;t change it later.</p>
        <SubmitButton className="w-full">Create workspace & start trial</SubmitButton>
      </ActionForm>
    </div>
  );
}
