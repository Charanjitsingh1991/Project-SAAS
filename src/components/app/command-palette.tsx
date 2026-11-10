"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { type: string; title: string; subtitle?: string; href: string };

/** Global ⌘K / Ctrl-K palette: quick actions + search across modules. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") close();
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { results: Item[]; actions: { title: string; href: string }[] };
        setItems([...data.actions.map((a) => ({ type: "Action", title: a.title, href: a.href })), ...data.results]);
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  function go(item: Item | undefined) {
    if (!item) return;
    close();
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-ink/30 px-4 pt-[12vh] backdrop-blur-sm print:hidden" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-xl overflow-hidden rounded-[22px] border border-line bg-card shadow-[0_40px_80px_-30px_rgba(20,20,18,.5)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-ink-mute" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[active]);
              }
            }}
            placeholder="Search people, customers, invoices, products, tickets…"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-mute"
          />
          <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-ink-mute">ESC</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-ink-mute">{loading ? "Searching…" : q.length < 2 ? "Type to search" : "No matches"}</li>
          )}
          {items.map((it, i) => (
            <li key={`${it.type}-${it.href}-${i}`}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === active ? "bg-ink text-paper" : "hover:bg-paper-2")}
              >
                <span
                  className={cn(
                    "w-16 shrink-0 font-mono text-[10px] tracking-widest uppercase",
                    i === active ? "text-paper/60" : "text-ink-mute",
                  )}
                >
                  {it.type === "Action" ? <Zap className="size-3.5" /> : it.type}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{it.title}</span>
                  {it.subtitle && <span className={cn("block truncate text-xs capitalize", i === active ? "text-paper/60" : "text-ink-mute")}>{it.subtitle.replaceAll("_", " ")}</span>}
                </span>
                {i === active && <CornerDownLeft className="size-3.5 opacity-60" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Small button that opens the palette (for the sidebar / mobile). */
export function SearchTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className="flex w-full items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink-mute hover:border-ink"
    >
      <Search className="size-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-line px-1.5 font-mono text-[10px]">⌘K</kbd>
    </button>
  );
}
