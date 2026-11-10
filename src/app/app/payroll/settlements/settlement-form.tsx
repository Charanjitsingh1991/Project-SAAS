import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { fromMinor } from "@/lib/format";
import { saveSettlement } from "../extras-actions";

export function SettlementForm({
  employeeId,
  values,
  hints,
  submitLabel,
}: {
  employeeId: number;
  values: { exitDate: string; unpaidDays: number; leaveDays: number; otherEarnings: number; otherDeductions: number };
  hints: { unpaid?: string; leave?: string };
  submitLabel: string;
}) {
  return (
    <ActionForm action={saveSettlement} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" resetOnSuccess={false}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Input label="Exit (last working) date" name="exitDate" type="date" defaultValue={values.exitDate} required />
      <Input label="Unpaid days worked (exit month)" name="unpaidDays" type="number" step="0.5" min="0" defaultValue={values.unpaidDays} />
      <Input label="Unused annual leave (days)" name="leaveDays" type="number" step="0.5" min="0" defaultValue={values.leaveDays} />
      <Input label="Other earnings" name="otherEarnings" type="number" step="0.01" min="0" defaultValue={fromMinor(values.otherEarnings)} />
      <Input label="Other deductions" name="otherDeductions" type="number" step="0.01" min="0" defaultValue={fromMinor(values.otherDeductions)} />
      <div className="space-y-1 text-xs text-ink-mute sm:col-span-2 lg:col-span-5">
        {hints.unpaid && <p>Unpaid days: {hints.unpaid}</p>}
        {hints.leave && <p>Leave: {hints.leave}</p>}
        <p>Gratuity and loan recovery are calculated from the employee&apos;s salary, service and active loans.</p>
      </div>
      <div className="sm:col-span-2 lg:col-span-5">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
