"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Card, Table, Td, Th } from "@/components/app/ui";
import type { ToolResult } from "@/lib/ai/catalog";
import { askAction } from "./actions";

const MAX = 500;

function ResultTable({ r }: { r: ToolResult }) {
  return (
    <Card
      title={r.title}
      actions={
        r.href ? (
          <Link href={r.href} className="text-sm font-medium underline underline-offset-4">
            Open in app →
          </Link>
        ) : undefined
      }
    >
      {r.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No matching records.</p>
      ) : (
        <Table compact>
          <thead>
            <tr>
              {r.columns.map((c) => (
                <Th key={c}>{c}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => {
              const href = r.links?.[i];
              return (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <Td key={j}>
                      {j === 0 && href ? (
                        <Link href={href} className="font-medium underline underline-offset-4">
                          {cell ?? "—"}
                        </Link>
                      ) : (
                        (cell ?? "—")
                      )}
                    </Td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function AskClient({ initialQuestion, chips }: { initialQuestion?: string; chips: string[] }) {
  const [state, action, pending] = useActionState(askAction, undefined);
  const [text, setText] = useState(initialQuestion ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const autoRan = useRef(false);

  const run = (q: string) => {
    const fd = new FormData();
    fd.set("question", q);
    startTransition(() => action(fd));
  };

  useEffect(() => {
    if (autoRan.current || !initialQuestion?.trim()) return;
    autoRan.current = true;
    run(initialQuestion.trim().slice(0, MAX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className="space-y-6">
      <form ref={formRef} action={action} className="rounded-2xl border bg-card p-4">
        <label htmlFor="ask-q" className="sr-only">
          Your question
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="ask-q"
            name="question"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX}
            required
            autoComplete="off"
            placeholder="e.g. Which customers have overdue invoices and an open deal?"
            className="h-11 w-full rounded-xl border bg-paper/60 px-4 text-sm outline-none transition focus:border-ink focus:bg-card focus:ring-4 focus:ring-ink/5"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-medium text-paper transition hover:bg-ink/90 disabled:opacity-60"
          >
            <Sparkles className="size-4" /> {pending ? "Thinking…" : "Ask"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              disabled={pending}
              onClick={() => {
                setText(c);
                run(c);
              }}
              className="rounded-full border bg-paper/60 px-3 py-1 text-xs text-ink-soft transition hover:border-ink hover:text-ink disabled:opacity-60"
            >
              {c}
            </button>
          ))}
        </div>
      </form>

      {pending && <p className="text-sm text-ink-soft">Looking through your workspace data…</p>}

      {state && !pending && (
        <div className="space-y-4" aria-live="polite">
          {state.error ? (
            <p role="alert" className="rounded-xl bg-signal/10 px-4 py-3 text-sm text-signal">
              {state.error}
            </p>
          ) : (
            <Card
              title={
                <span className="flex items-center gap-2">
                  Answer <Badge tone={state.mode === "ai" ? "lilac" : "butter"}>{state.mode === "ai" ? "AI" : "Built-in rules"}</Badge>
                </span>
              }
            >
              <p className="text-xs text-ink-soft">{state.question}</p>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{state.answer}</p>
              {state.note && <p className="mt-3 rounded-lg bg-butter/50 px-3 py-2 text-xs">{state.note}</p>}
            </Card>
          )}
          {state.results?.map((r, i) => (
            <ResultTable key={`${r.tool}-${i}`} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
