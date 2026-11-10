"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/** Submits the count form with intent=complete after a confirmation. */
export function CompleteCountButton({ number }: { number: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      name="intent"
      value="complete"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(`Complete ${number}? Every counted line with a variance is posted as a stock adjustment.`)) e.preventDefault();
      }}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      Save &amp; complete count
    </button>
  );
}
