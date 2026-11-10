"use client";

import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export type KanbanColumn = { key: string; label: string; meta?: React.ReactNode; tone?: string };
export type KanbanItem = { id: number; column: string; node: React.ReactNode };

/**
 * Drag-and-drop board. Moves are optimistic; `onMove` receives FormData with
 * `id` and `<field>` (default "status") and should persist + refresh.
 * Cards should also include a non-drag control (e.g. StatusSelect) for keyboard/touch users.
 */
export function Kanban({
  columns,
  items,
  onMove,
  field = "status",
  emptyLabel = "Drop here",
  columnClassName,
}: {
  columns: KanbanColumn[];
  items: KanbanItem[];
  onMove: (fd: FormData) => Promise<void>;
  field?: string;
  emptyLabel?: string;
  columnClassName?: string;
}) {
  const [optimistic, applyMove] = useOptimistic(items, (state, move: { id: number; column: string }) =>
    state.map((it) => (it.id === move.id ? { ...it, column: move.column } : it)),
  );
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function drop(column: string, id: number) {
    const item = optimistic.find((i) => i.id === id);
    if (!item || item.column === column) return;
    startTransition(async () => {
      applyMove({ id, column });
      const fd = new FormData();
      fd.set("id", String(id));
      fd.set(field, column);
      await onMove(fd);
    });
  }

  return (
    <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3 md:mx-0 md:px-0">
      {columns.map((col) => {
        const colItems = optimistic.filter((i) => i.column === col.key);
        return (
          <section
            key={col.key}
            aria-label={col.label}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== col.key) setOver(col.key);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = Number(e.dataTransfer.getData("text/plain"));
              if (id) drop(col.key, id);
            }}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-[20px] border bg-paper-2/50 p-3 transition-colors",
              over === col.key ? "border-ink bg-paper-2" : "border-line",
              columnClassName,
            )}
          >
            <header className="mb-3 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                {col.tone && <span className={cn("size-2.5 rounded-full border border-ink/20", col.tone)} />}
                <h3 className="font-mono text-[11px] tracking-widest text-ink-soft uppercase">{col.label}</h3>
                <span className="rounded-full bg-card px-1.5 font-mono text-[11px] text-ink-mute">{colItems.length}</span>
              </div>
              {col.meta && <div className="text-xs text-ink-mute">{col.meta}</div>}
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2">
              {colItems.map((it) => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(it.id));
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(it.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn("cursor-grab active:cursor-grabbing", dragging === it.id && "opacity-40")}
                >
                  {it.node}
                </div>
              ))}
              {colItems.length === 0 && (
                <p className="grid flex-1 place-items-center rounded-xl border border-dashed border-ink/15 py-6 text-xs text-ink-mute">{emptyLabel}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
