import type { Metadata } from "next";
import { Building2, Check, LayoutGrid, Lock, Zap } from "lucide-react";
import { saveAutomations, saveCompanyProfile, saveModules } from "@/app/app/actions";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/app/forms";
import { Badge, Card, PageHeader } from "@/components/app/ui";
import { AUTOMATIONS, effectiveAutomations, parseAutomations } from "@/lib/automations";
import { packOf, statutoryOf, weekendOf } from "@/lib/countries";
import { MODULES } from "@/lib/modules";
import { ALL_MODULES, planHas } from "@/lib/plans";
import type { ModuleKey } from "@/lib/roles";
import { planModules, planOf, requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MODULE_NAMES: Record<ModuleKey, string> = {
  hrm: "People & HRM",
  payroll: "Payroll",
  crm: "Sales CRM",
  finance: "Finance & Accounts",
  inventory: "Inventory & Purchasing",
  projects: "Projects",
  helpdesk: "Helpdesk",
  analytics: "Analytics",
};

export default async function SettingsPage() {
  const ws = await requireWorkspace({ manage: true });
  const pack = packOf(ws.org);
  const plan = planOf(ws);
  const enabled = planModules(ws);
  const stored = parseAutomations(ws.org.automations);
  const effective = effectiveAutomations(stored, { planAutomations: planHas(plan, "automations"), modules: enabled });
  const weekend = weekendOf(ws.org);
  const statutory = statutoryOf(ws.org);
  const portal = `${await appOrigin()}/support/${ws.org.slug}`;

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${pack.flag} ${pack.name} workspace · ${pack.currency} · ${pack.tax.name} · ${plan.name} plan${ws.access.state === "trial" ? " (trial)" : ""}`}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card
            title={
              <span className="flex items-center gap-2">
                <LayoutGrid className="size-4" /> Modules
              </span>
            }
          >
            <p className="mb-4 text-sm text-ink-soft">
              {plan.moduleLimit
                ? `Your ${plan.name} plan includes any ${plan.moduleLimit} of the core modules. Switched-off modules are hidden from everyone; their data is kept.`
                : `Your ${plan.name} plan includes every module. Switch off what you don't use — data is kept and comes back when you switch it on.`}
            </p>
            <ActionForm action={saveModules} resetOnSuccess={false}>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_MODULES.map((key) => {
                  const m = MODULES.find((x) => x.key === key)!;
                  const allowed = plan.allowedModules.includes(key);
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition has-checked:border-ink has-checked:bg-paper-2",
                        allowed ? "border-line" : "cursor-not-allowed border-dashed border-line opacity-60",
                      )}
                    >
                      <input type="checkbox" name="modules" value={key} defaultChecked={enabled.includes(key)} disabled={!allowed} className="size-4 accent-ink" />
                      <span className={cn("grid size-8 place-items-center rounded-lg border border-ink/10", m.color)}>
                        <m.icon className="size-4" />
                      </span>
                      <span className="flex-1 text-sm font-medium">{MODULE_NAMES[key]}</span>
                      {!allowed && (
                        <span className="flex items-center gap-1 text-xs text-ink-mute">
                          <Lock className="size-3" /> Growth
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-4">
                <SubmitButton>Save modules</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Zap className="size-4" /> Automations
              </span>
            }
          >
            <form action={saveAutomations} className="space-y-1">
              <p className="mb-4 text-sm text-ink-soft">
                These run instantly when the event happens. Core links keep your books and stock correct; workflow automations need the Growth plan.
              </p>
              <ul className="divide-y divide-line">
                {AUTOMATIONS.map((a) => {
                  const planBlocked = a.tier === "workflow" && !planHas(plan, "automations");
                  const moduleOff = a.modules.filter((m) => !enabled.includes(m as ModuleKey));
                  return (
                    <li key={a.key}>
                      <label className="flex cursor-pointer items-start gap-4 py-4">
                        <input type="checkbox" name={a.key} defaultChecked={stored[a.key]} className="peer sr-only" />
                        <span className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full border border-line bg-paper-2 transition peer-checked:border-ink peer-checked:bg-ink after:absolute after:top-0.5 after:left-0.5 after:size-[18px] after:rounded-full after:bg-card after:shadow after:transition peer-checked:after:translate-x-4 peer-focus-visible:ring-4 peer-focus-visible:ring-ink/10" />
                        <span className="flex-1">
                          <span className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-ink-mute uppercase">
                            {a.module} {a.tier === "workflow" ? <Badge tone="lilac">workflow</Badge> : <Badge>core</Badge>}
                          </span>
                          <span className="block font-medium">{a.title}</span>
                          <span className="block text-sm text-ink-soft">{a.description}</span>
                          {(planBlocked || moduleOff.length > 0) && (
                            <span className="mt-1 block text-xs text-signal">
                              Not running: {planBlocked ? "needs the Growth plan" : `switch on ${moduleOff.map((m) => MODULE_NAMES[m as ModuleKey]).join(" & ")}`}.
                            </span>
                          )}
                          {!planBlocked && !moduleOff.length && effective[a.key] && (
                            <span className="mt-1 flex items-center gap-1 text-xs text-ink-mute">
                              <Check className="size-3" /> Active
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="pt-4">
                <SubmitButton>Save automations</SubmitButton>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title={
              <span className="flex items-center gap-2">
                <Building2 className="size-4" /> Company profile
              </span>
            }
          >
            <ActionForm action={saveCompanyProfile} className="space-y-3" resetOnSuccess={false}>
              <Select
                label={`${pack.regionLabel} (place of business)`}
                name="state"
                defaultValue={ws.org.state ?? ""}
                placeholder={`Select ${pack.regionLabel.toLowerCase()}…`}
                options={pack.regions}
                className="[&_select]:normal-case"
              />
              <Input label={pack.tax.idLabel} name="gstin" defaultValue={ws.org.gstin ?? ""} placeholder={pack.tax.idExample} className="[&_input]:uppercase" />
              <Textarea label="Registered address" name="address" defaultValue={ws.org.address ?? ""} />
              {pack.statutoryOrgFields.map((f) => (
                <Input key={f.key} label={f.label} name={`st_${f.key}`} defaultValue={statutory[f.key] ?? ""} placeholder={f.placeholder} />
              ))}
              <Select
                label="Fiscal year starts"
                name="fiscalYearStart"
                defaultValue={String(ws.org.fiscalYearStart)}
                options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                className="[&_select]:normal-case"
              />
              <fieldset>
                <legend className="mb-1 block text-xs font-medium text-ink-soft">Weekend days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => (
                    <label key={d} className="cursor-pointer">
                      <input type="checkbox" name="weekend" value={i} defaultChecked={weekend.includes(i)} className="peer sr-only" />
                      <span className="inline-flex rounded-full border border-line px-3 py-1 text-xs transition peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper">
                        {d.slice(0, 3)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-ink-mute">
                Printed on invoices, POs and payslips. {pack.code === "IN" ? "Same-state invoices show CGST + SGST; others show IGST." : "Tax invoices show your TRN and 5% VAT; customer TRN is shown when registered."}{" "}
                Weekend days are skipped when counting leave and working days.
              </p>
              <SubmitButton variant="outline" className="w-full">
                Save
              </SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Customer support portal">
            {planHas(plan, "supportPortal") ? (
              <>
                <p className="text-sm text-ink-soft">Customers can search your knowledge base and raise tickets here:</p>
                <a href={portal} target="_blank" className="mt-2 block truncate font-mono text-xs underline underline-offset-4">
                  {portal}
                </a>
              </>
            ) : (
              <p className="text-sm text-ink-soft">The public support portal is part of the Growth plan.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
