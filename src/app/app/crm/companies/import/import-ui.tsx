"use client";

import { useActionState } from "react";
import { Download } from "lucide-react";
import { SubmitButton } from "@/components/app/forms";
import type { ImportSummary } from "@/lib/imports";
import { cn } from "@/lib/utils";

/** Shared upload form + result summary for the CSV import pages. */
export function ImportForm({
  action,
  template,
  filename,
  children,
}: {
  action: (state: ImportSummary | undefined, formData: FormData) => Promise<ImportSummary>;
  template: string;
  filename: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const field = "w-full rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink";
  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">CSV file (UTF-8, comma separated, max 2 MiB / 2,000 rows)</span>
          <input type="file" name="file" accept=".csv,text/csv" className={cn(field, "py-2")} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">…or paste CSV (used only when no file is chosen)</span>
          <textarea name="csv" rows={5} spellCheck={false} className={cn(field, "py-2 font-mono text-xs")} />
        </label>
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Import</SubmitButton>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
            download={filename}
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

export function DuplicateMode({ keyLabel }: { keyLabel: string }) {
  return (
    <label className="block max-w-md">
      <span className="mb-1 block text-xs font-medium text-ink-soft">When a row matches an existing record ({keyLabel})</span>
      <select name="onDuplicate" defaultValue="skip" className="h-10 w-full rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink">
        <option value="skip">Skip it (leave existing record unchanged)</option>
        <option value="update">Update it (only columns with a value are overwritten)</option>
      </select>
    </label>
  );
}
