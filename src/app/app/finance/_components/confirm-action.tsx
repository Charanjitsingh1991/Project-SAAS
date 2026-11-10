"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import type { FormState } from "@/lib/definitions";
import { cn } from "@/lib/utils";

/** Button that runs a FormState server action with hidden fields, an optional confirm prompt, and an inline result message. */
export function ConfirmAction({
  action,
  fields,
  children,
  confirm,
  variant = "outline",
  className,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string | number>;
  children: React.ReactNode;
  confirm?: string;
  variant?: "outline" | "ink" | "danger";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col items-start gap-1"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        disabled={pending}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition disabled:opacity-50",
          variant === "outline" && "border border-ink/20 hover:border-ink",
          variant === "ink" && "bg-ink text-paper hover:bg-ink/85",
          variant === "danger" && "border border-signal/40 text-signal hover:bg-signal/10",
          className,
        )}
      >
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {children}
      </button>
      {state?.message && !state.ok && (
        <span role="status" className="max-w-xs text-xs text-signal">
          {state.message}
        </span>
      )}
    </form>
  );
}
