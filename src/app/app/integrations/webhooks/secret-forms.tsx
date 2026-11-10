"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import type { FormState } from "@/lib/definitions";
import type { SecretState } from "./actions";

function SecretBox({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-ink/15 bg-butter/40 p-3">
      <p className="text-xs font-medium">Signing secret (shown once)</p>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly value={secret} aria-label="Signing secret" onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 font-mono text-[11px]" />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-ink px-3 text-xs font-medium text-paper"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** ActionForm that also reveals a one-time signing secret returned by the action. */
export function EndpointForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (state: SecretState, fd: FormData) => Promise<SecretState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <>
      <ActionForm
        className={className}
        resetOnSuccess={resetOnSuccess}
        action={async (prev: FormState, fd: FormData) => {
          const res = await action(prev, fd);
          setSecret(res?.secret ?? null);
          return res;
        }}
      >
        {children}
      </ActionForm>
      {secret && <SecretBox secret={secret} />}
    </>
  );
}

export function RotateSecret({ id, action }: { id: number; action: (state: SecretState, fd: FormData) => Promise<SecretState> }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <div>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm("Rotate the signing secret? The current secret stops working immediately.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <SubmitButton variant="outline" className="h-8 px-3 text-xs">
          Rotate secret
        </SubmitButton>
      </form>
      {state?.message && !state.secret && <p className="mt-2 text-xs text-signal">{state.message}</p>}
      {state?.secret && <SecretBox secret={state.secret} />}
    </div>
  );
}
