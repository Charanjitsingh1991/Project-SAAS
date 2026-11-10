"use client";

import { useActionState } from "react";
import { Download } from "lucide-react";
import { SubmitButton } from "@/components/app/forms";
import type { EmployeeImportSummary } from "@/lib/employee-import";
import { cn } from "@/lib/utils";

const field = "w-full rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink";

export function EmployeeImportForm({
  action,
  template,
}: {
  action: (state: EmployeeImportSummary | undefined, formData: FormData) => Promise<EmployeeImportSummary>;
  template: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">CSV file (UTF-8, comma separated, max 2 MiB / 1,000 rows)</span>
          <input type="file" name="file" accept=".csv,text/csv" className={cn(field, "py-2")} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">…or paste CSV (used only when no file is chosen)</span>
          <textarea name="csv" rows={5} spellCheck={false} className={cn(field, "py-2 font-mono text-xs")} />
        </label>
        <label className="block max-w-md">
          <span className="mb-1 block text-xs font-medium text-ink-soft">When a row matches an existing employee (same code or email)</span>
          <select name="onDuplicate" defaultValue="skip" className={cn(field, "h-10")}>
            <option value="skip">Skip it (leave existing record unchanged)</option>
            <option value="update">Update it (only columns with a value are overwritten)</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="createDepartments" className="mt-1" />
          <span>Create departments that don’t exist yet</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="invite" className="mt-1" />
          <span>Invite imported employees with an email to the employee portal</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Import</SubmitButton>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
            download="employees-template.csv"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink"
          >
            <Download className="size-4" /> Download template
          </a>
        </div>
      </form>

      {state && (
        <div role="status" className={cn("rounded-xl px-4 py-3 text-sm", state.ok ? "bg-mint/60 text-ink" : "bg-signal/10 text-signal")}>
          {state.message && <p className="font-medium">{state.message}</p>}
          {(state.ok || state.created + state.updated + state.skipped > 0) && (
            <p className="mt-1">
              Created {state.created} · Updated {state.updated} · Skipped {state.skipped}
            </p>
          )}
          {state.invites && (
            <div className="mt-2 text-xs">
              <p>
                Portal invites: {state.invites.emailed} emailed · {state.invites.linkOnly} link-only (email not configured) · {state.invites.failed} failed
              </p>
              {state.invites.stopped && <p className="mt-1 font-medium">{state.invites.stopped}</p>}
              {state.invites.links.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer">Invite links to send by hand</summary>
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto break-all font-mono">
                    {state.invites.links.map((l) => (
                      <li key={l.email}>
                        {l.email}: {l.url}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {state.errors.length > 0 && (
            <ul className="mt-2 max-h-64 list-disc space-y-0.5 overflow-auto pl-5 text-xs">
              {state.errors.slice(0, 200).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
              {state.errors.length > 200 && <li>…and {state.errors.length - 200} more.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
