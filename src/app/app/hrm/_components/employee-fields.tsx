import { Input, Select } from "@/components/app/forms";
import type { schema } from "@/db";
import { fromMinor } from "@/lib/money";

type Employee = typeof schema.employees.$inferSelect;
type Opt = { value: number; label: string };

export function PersonalFields({ e }: { e?: Employee }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Full name" name="name" defaultValue={e?.name} required />
      <Input label="Work email" name="email" type="email" defaultValue={e?.email ?? ""} />
      <Input label="Phone" name="phone" defaultValue={e?.phone ?? ""} />
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
      <Input label="Work location" name="workLocation" defaultValue={e?.workLocation ?? ""} placeholder="Bengaluru / Remote" />
      <Input label="Join date" name="joinDate" type="date" defaultValue={e?.joinDate ?? joinDefault} required />
      <Input label="Probation ends" name="probationEndDate" type="date" defaultValue={e?.probationEndDate ?? ""} />
    </div>
  );
}

const check = "size-4 rounded border-line accent-ink";

export function CompFields({ e }: { e?: Employee }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Annual CTC (₹)" name="annualCtc" inputMode="decimal" defaultValue={e ? fromMinor(e.annualCtc) : ""} placeholder="1200000" />
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

export function StatutoryFields({ e }: { e?: Employee }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="PAN" name="pan" defaultValue={e?.pan ?? ""} placeholder="ABCDE1234F" maxLength={10} className="[&_input]:uppercase" />
      <Input label="UAN" name="uan" defaultValue={e?.uan ?? ""} inputMode="numeric" maxLength={12} />
      <Input label="Bank account" name="bankAccount" defaultValue={e?.bankAccount ?? ""} inputMode="numeric" />
      <Input label="IFSC" name="ifsc" defaultValue={e?.ifsc ?? ""} placeholder="HDFC0001234" maxLength={11} className="[&_input]:uppercase" />
    </div>
  );
}
