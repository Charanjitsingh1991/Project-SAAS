import { addDaysYmd } from "@/lib/format";
import { dayOfWeek, monthRange } from "@/lib/hrm";
import { cn } from "@/lib/utils";

export const ATT_BG: Record<string, string> = {
  present: "bg-mint",
  absent: "bg-rose",
  half_day: "bg-butter",
  leave: "bg-sky",
  holiday: "bg-lilac",
  wfh: "bg-lime",
};

export const ATT_LEGEND = [
  ["present", "Present"],
  ["wfh", "WFH"],
  ["half_day", "Half day"],
  ["leave", "Leave"],
  ["absent", "Absent"],
  ["holiday", "Holiday"],
] as const;

/** Month grid (Mon–Sun) coloured by attendance status; weekends and holidays are shaded. */
export function MiniCalendar({
  month,
  rows,
  holidays,
  today,
}: {
  month: string;
  rows: { date: string; status: string; checkIn?: string | null; checkOut?: string | null }[];
  holidays: ReadonlyMap<string, string>;
  today: string;
}) {
  const { start, end } = monthRange(month);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const lead = (dayOfWeek(start) + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) cells.push(d);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center font-mono text-[10px] tracking-widest text-ink-mute uppercase">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />;
          const r = byDate.get(d);
          const hol = holidays.get(d);
          const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6;
          const status = r?.status ?? (hol ? "holiday" : null);
          const title = [r ? r.status.replace("_", " ") : hol, hol && r ? hol : null, r?.checkIn ? `in ${r.checkIn}` : null, r?.checkOut ? `out ${r.checkOut}` : null].filter(Boolean).join(" · ");
          return (
            <div
              key={d}
              title={title || undefined}
              className={cn(
                "grid h-11 place-items-center rounded-lg border text-xs",
                status ? cn(ATT_BG[status], "border-ink/10") : weekend ? "border-transparent bg-ink/5 text-ink-mute" : "border-line bg-card",
                d === today && "ring-2 ring-ink",
              )}
            >
              {Number(d.slice(8))}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {ATT_LEGEND.map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("size-3 rounded", ATT_BG[k])} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
