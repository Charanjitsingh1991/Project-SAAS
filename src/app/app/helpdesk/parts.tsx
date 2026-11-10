"use client";

import { useRef, useState } from "react";
import { Lock, Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { cn } from "@/lib/utils";
import { replyAction } from "./actions";

/** Select that submits its form when changed; options can carry numeric ids. */
export function AutoSelect({
  action,
  id,
  name,
  value,
  options,
  label,
}: {
  action: (fd: FormData) => Promise<void>;
  id: number;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <select
        name={name}
        defaultValue={value}
        aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9 w-full cursor-pointer rounded-xl border border-line bg-paper/60 px-2.5 text-sm capitalize outline-none hover:border-ink focus:border-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}

const STATUS_AFTER = [
  { value: "", label: "Keep status" },
  { value: "open", label: "Set open" },
  { value: "pending", label: "Set pending" },
  { value: "on_hold", label: "Set on hold" },
  { value: "resolved", label: "Set resolved" },
  { value: "closed", label: "Set closed" },
];

export function ReplyComposer({ ticketId, canned }: { ticketId: number; canned: { id: number; title: string; body: string }[] }) {
  const [mode, setMode] = useState<"public" | "internal">("public");
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(id: string) {
    const c = canned.find((x) => String(x.id) === id);
    const el = ref.current;
    if (!c || !el) return;
    el.value = el.value ? `${el.value.trimEnd()}\n\n${c.body}` : c.body;
    el.focus();
  }

  return (
    <ActionForm action={replyAction} className={cn("rounded-[20px] border p-4", mode === "internal" ? "border-ink/20 bg-butter/50" : "border-line bg-card")}>
      <input type="hidden" name="id" value={ticketId} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-line bg-paper/60 p-0.5 text-sm">
          {(["public", "internal"] as const).map((m) => (
            <label key={m} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1", mode === m ? "bg-ink text-paper" : "text-ink-soft")}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              {m === "public" ? <Send className="size-3.5" /> : <Lock className="size-3.5" />}
              {m === "public" ? "Public reply" : "Internal note"}
            </label>
          ))}
        </div>
        {canned.length > 0 && (
          <select
            aria-label="Insert canned response"
            defaultValue=""
            onChange={(e) => {
              insert(e.target.value);
              e.target.value = "";
            }}
            className="h-9 max-w-[220px] rounded-xl border border-line bg-paper/60 px-2 text-sm"
          >
            <option value="">Canned responses…</option>
            {canned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea
        ref={ref}
        name="body"
        rows={5}
        maxLength={10000}
        required
        aria-label="Message"
        placeholder={mode === "public" ? "Write a reply to the requester…" : "Write a note only your team can see…"}
        className="w-full rounded-xl border border-line bg-paper/60 px-3 py-2 text-sm outline-none focus:border-ink focus:bg-card focus:ring-4 focus:ring-ink/5"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <select name="setStatus" aria-label="Status on send" defaultValue="" className="h-9 rounded-xl border border-line bg-paper/60 px-2 text-sm">
          {STATUS_AFTER.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <SubmitButton>{mode === "public" ? "Send reply" : "Add note"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
