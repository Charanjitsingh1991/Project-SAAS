import { Input, Select } from "@/components/app/forms";
import type { schema } from "@/db";
import { NATIONALITIES, type CountryPack } from "@/lib/countries";
import type { EmployeeFieldDef } from "@/lib/countries/types";
import { UAE_COMPONENT_KEYS, parseSalaryComponents } from "@/lib/hrm";
import { fromMinor } from "@/lib/money";
import { uaeComponents } from "@/lib/payroll-ae";

type Employee = typeof schema.employees.$inferSelect;
type Opt = { value: number; label: string };

export function PersonalFields({ e, pack }: { e?: Employee; pack?: CountryPack }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Full name" name="name" defaultValue={e?.name} required />
      <Input label="Work email" name="email" type="email" defaultValue={e?.email ?? ""} />
      <Input label="Phone" name="phone" defaultValue={e?.phone ?? ""} placeholder={pack?.phone.example} />
      <Select label="Gender" name="gender" options={["undisclosed", "female", "male", "other"]} defaultValue={e?.gender ?? "undisclosed"} />
      <Input label="Date of birth" name="dob" type="date" defaultValue={e?.dob ?? ""} />
      <Input label="Address" name="address" defaultValue={e?.address ?? ""} />
    </div>
  );
}

export function JobFields({ e, departments, managers, joinDefault }: { e?: Employee; departments: Opt[]; managers: Opt[]; joinDefault?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Designation" name="designation" defaultValue={e?.designation} required />
      <Select label="Department" name="departmentId" placeholder="— None —" options={departments} defaultValue={e?.departmentId ?? ""} />
      <Select label="Reports to" name="managerId" placeholder="— No manager —" options={managers} defaultValue={e?.managerId ?? ""} />
      <Select label="Employment type" name="employmentType" options={["full_time", "part_time", "contract", "intern"]} defaultValue={e?.employmentType ?? "full_time"} />
      <Input label="Work location" name="workLocation" defaultValue={e?.workLocation ?? ""} placeholder="Head office / Remote" />
      <Input label="Join date" name="joinDate" type="date" defaultValue={e?.joinDate ?? joinDefault} required />
      <Input label="Probation ends" name="probationEndDate" type="date" defaultValue={e?.probationEndDate ?? ""} />
    </div>
  );
}

const check = "size-4 rounded border-line accent-ink";

export function annualPayLabel(pack: CountryPack) {
  return pack.code === "AE" ? "Annual package" : "Annual CTC";
}

/** India: annual CTC + PF/metro. UAE: monthly components (form names comp_<key>); annual package = total × 12. */
export function CompFields({ e, pack }: { e?: Employee; pack: CountryPack }) {
  if (pack.code === "AE") {
    const c = e ? uaeComponents(e.annualCtc, parseSalaryComponents(e.salaryComponents), pack.payroll.defaultSplit) : null;
    const labels = new Map(pack.payroll.components.map((x) => [x.code, x.label]));
    return (
      <div className="space-y-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {UAE_COMPONENT_KEYS.map((k) => (
            <Input
              key={k}
              label={`${labels.get(k) ?? k} — monthly (${pack.currency})`}
              name={`comp_${k}`}
              inputMode="decimal"
              defaultValue={c && c[k] ? fromMinor(c[k]) : ""}
              placeholder="0"
            />
          ))}
        </div>
        <p className="text-xs text-ink-mute">
          {annualPayLabel(pack)} = monthly total × 12. Gratuity accrues on basic; GPSSA pension applies to UAE nationals.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label={`${annualPayLabel(pack)} (${pack.currency})`} name="annualCtc" inputMode="decimal" defaultValue={e ? fromMinor(e.annualCtc) : ""} placeholder="1200000" />
      <div className="flex items-end gap-6 pb-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pfEnrolled" defaultChecked={e?.pfEnrolled ?? true} className={check} /> PF enrolled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="metro" defaultChecked={e?.metro ?? true} className={check} /> Metro city (HRA 50%)
        </label>
      </div>
    </div>
  );
}

const SECTION_TITLE: Record<EmployeeFieldDef["section"], string> = { identity: "Identity", work_permit: "Work permit", bank: "Bank" };

/** Identity / work-permit / bank fields from the country pack. */
export function StatutoryFields({ e, pack }: { e?: Employee; pack: CountryPack }) {
  const sections = (["identity", "work_permit", "bank"] as const)
    .map((s) => [s, pack.hr.employeeFields.filter((f) => f.section === s)] as const)
    .filter(([, list]) => list.length);
  return (
    <div className="space-y-5">
      {sections.map(([s, list]) => (
        <div key={s}>
          {sections.length > 1 && <p className="mb-2 font-mono text-[11px] tracking-widest text-ink-mute uppercase">{SECTION_TITLE[s]}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {list.map((f) => (
              <EmployeeField key={f.key} f={f} value={e?.[f.key] ?? ""} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmployeeField({ f, value }: { f: EmployeeFieldDef; value: string }) {
  if (f.type === "country") {
    return <Select label={f.label} name={f.key} placeholder="— Select —" options={NATIONALITIES.map((n) => ({ value: n.code, label: n.name }))} defaultValue={value} className="[&_select]:normal-case" />;
  }
  if (f.type === "date") return <Input label={f.label} name={f.key} type="date" defaultValue={value} />;
  return (
    <Input
      label={f.patternHint ? `${f.label} (${f.patternHint})` : f.label}
      name={f.key}
      defaultValue={value}
      placeholder={f.placeholder}
      autoComplete="off"
      className={f.uppercase ? "[&_input]:uppercase" : undefined}
    />
  );
}
