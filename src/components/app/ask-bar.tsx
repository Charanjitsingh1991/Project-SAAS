"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";

/** Compact "ask your business" input that opens /app/ask with the question prefilled and run. */
export function AskBar({ placeholder = "Ask your business a question…" }: { placeholder?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const text = q.trim().slice(0, 500);
        router.push(text ? `/app/ask?q=${encodeURIComponent(text)}` : "/app/ask");
      }}
      className="flex items-center gap-2 rounded-2xl border bg-card p-2 pl-4"
    >
      <Sparkles className="size-4 shrink-0 text-ink-soft" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={500}
        aria-label="Ask your business a question"
        placeholder={placeholder}
        className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-soft"
      />
      <button type="submit" className="h-9 shrink-0 rounded-xl bg-ink px-4 text-sm font-medium text-paper transition hover:bg-ink/90">
        Ask
      </button>
    </form>
  );
}
