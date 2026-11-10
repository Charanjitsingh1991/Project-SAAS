"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import type { FormState } from "@/lib/definitions";

type Action = (state: FormState) => Promise<FormState>;

export function FeedForm({ generate, revoke, hasFeed }: { generate: Action; revoke: Action; hasFeed: boolean }) {
  const [gen, genAction, genPending] = useActionState(generate, undefined);
  const [rev, revAction, revPending] = useActionState(revoke, undefined);
  const [copied, setCopied] = useState(false);
  const url = gen?.values?.url;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          action={genAction}
          onSubmit={(e) => {
            if (hasFeed && !window.confirm("Generate a new link? The old link stops working and must be re-added in your calendar app.")) e.preventDefault();
          }}
        >
          <button disabled={genPending} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper disabled:opacity-60">
            {genPending && <Loader2 className="size-4 animate-spin" />}
            {hasFeed ? "Regenerate link" : "Create my calendar link"}
          </button>
        </form>
        {hasFeed && (
          <form
            action={revAction}
            onSubmit={(e) => {
              if (!window.confirm("Turn off your calendar link? Calendars subscribed to it will stop updating.")) e.preventDefault();
            }}
          >
            <button disabled={revPending} className="inline-flex h-10 items-center rounded-full border border-line px-5 text-sm font-medium hover:border-ink disabled:opacity-60">
              Turn off
            </button>
          </form>
        )}
      </div>

      {rev?.message && !url && <p role="status" className="rounded-xl bg-mint/60 px-3 py-2 text-sm">{rev.message}</p>}

      {url && (
        <div role="status" className="rounded-2xl border border-ink/10 bg-butter/50 p-4">
          <p className="text-sm font-medium">{gen?.message}</p>
          <div className="mt-3 flex items-center gap-2">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar subscription URL" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 font-mono text-xs" />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
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
