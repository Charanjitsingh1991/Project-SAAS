"use client";

import { createContext, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { FormState } from "@/lib/definitions";
import { cn } from "@/lib/utils";

const ErrorsContext = createContext<Record<string, string[] | undefined> | undefined>(undefined);

/**
 * Form bound to a `(prevState, formData) => FormState` server action.
 * Shows field errors and a status message; resets itself after a successful submit.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <ErrorsContext.Provider value={state?.errors}>
      <form ref={ref} action={formAction} className={className} noValidate>
        {children}
        {state?.message && (
          <p
            role="status"
            className={cn("mt-3 rounded-xl px-3 py-2 text-sm", state.ok ? "bg-mint/60 text-ink" : "bg-signal/10 text-signal")}
          >
            {state.message}
          </p>
        )}
      </form>
    </ErrorsContext.Provider>
  );
}

function useFieldError(name: string) {
  return useContext(ErrorsContext)?.[name]?.[0];
}

const inputCls =
  "h-10 w-full rounded-xl border bg-paper/60 px-3 text-sm outline-none transition focus:border-ink focus:bg-card focus:ring-4 focus:ring-ink/5";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string };

export function Input({ label, name, className, ...props }: InputProps) {
  const err = useFieldError(name);
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      <input name={name} aria-invalid={!!err} className={cn(inputCls, err ? "border-signal" : "border-line")} {...props} />
      {err && <span className="mt-1 block text-xs text-signal">{err}</span>}
    </label>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: (string | { value: string | number; label: string })[];
  placeholder?: string;
};

export function Select({ label, name, options, placeholder, className, ...props }: SelectProps) {
  const err = useFieldError(name);
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      <select name={name} aria-invalid={!!err} className={cn(inputCls, "capitalize", err ? "border-signal" : "border-line")} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o.replace("_", " ")}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </select>
      {err && <span className="mt-1 block text-xs text-signal">{err}</span>}
    </label>
  );
}

export function Textarea({ label, name, className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string }) {
  const err = useFieldError(name);
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      <textarea
        name={name}
        rows={3}
        aria-invalid={!!err}
        className={cn(inputCls, "h-auto resize-none py-2", err ? "border-signal" : "border-line")}
        {...props}
      />
      {err && <span className="mt-1 block text-xs text-signal">{err}</span>}
    </label>
  );
}

export function SubmitButton({ children, className, variant = "ink" }: { children: React.ReactNode; className?: string; variant?: "ink" | "signal" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition disabled:opacity-60",
        variant === "ink" && "bg-ink text-paper hover:bg-ink/85",
        variant === "signal" && "bg-signal text-white hover:bg-signal/90",
        variant === "outline" && "border border-ink/20 hover:border-ink",
        className,
      )}
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/**
 * Compact select that submits its form as soon as the value changes —
 * used for inline status changes in tables (e.g. deal stage, ticket status).
 */
export function StatusSelect({
  action,
  id,
  value,
  options,
  name = "status",
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  id: number;
  value: string;
  options: readonly string[];
  name?: string;
  label?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <select
        name={name}
        defaultValue={value}
        aria-label={label ?? "Change status"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 cursor-pointer rounded-full border border-line bg-paper/60 px-2.5 text-xs font-medium capitalize outline-none hover:border-ink focus:border-ink"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace("_", " ")}
          </option>
        ))}
      </select>
    </form>
  );
}

/** Small icon/text button that runs a server action, optionally asking for confirmation first. */
export function ActionButton({
  action,
  fields,
  children,
  confirm,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string | number>;
  children: React.ReactNode;
  confirm?: string;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <InlineSubmit className={className}>{children}</InlineSubmit>
    </form>
  );
}

function InlineSubmit({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium transition hover:border-ink disabled:opacity-50", className)}
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : null}
      {children}
    </button>
  );
}
