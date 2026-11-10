"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/definitions";

const field = "h-10 w-full rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none transition focus:border-ink focus:bg-card focus:ring-4 focus:ring-ink/5";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper disabled:opacity-60">
      {pending && <Loader2 className="size-4 animate-spin" />}
      Create key
    </button>
  );
}

export function KeyForm({ action }: { action: (state: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, undefined);
  const [copied, setCopied] = useState(false);
  const key = state?.values?.key;

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end" noValidate>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Key name</span>
          <input name="name" placeholder="e.g. Zapier, website form" maxLength={80} className={field} />
          {state?.errors?.name?.[0] && <span className="mt-1 block text-xs text-signal">{state.errors.name[0]}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Access</span>
          <select name="scope" defaultValue="read" className={field}>
            <option value="read">Read only</option>
            <option value="write">Read + write</option>
          </select>
        </label>
        <Submit />
      </form>

      {state?.message && !key && <p role="status" className="rounded-xl bg-signal/10 px-3 py-2 text-sm text-signal">{state.message}</p>}

      {key && (
        <div role="status" className="rounded-2xl border border-ink/10 bg-butter/50 p-4">
          <p className="text-sm font-medium">{state?.message}</p>
          <div className="mt-3 flex items-center gap-2">
            <input readOnly value={key} onFocus={(e) => e.currentTarget.select()} aria-label="New API key" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 font-mono text-xs" />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(key);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-paper"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
