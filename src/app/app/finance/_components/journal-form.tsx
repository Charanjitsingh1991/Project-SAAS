"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import type { FormState } from "@/lib/definitions";
import { formatMoney, toMinor } from "@/lib/money";

type Row = { key: number; accountId: string; debit: string; credit: string };
const cell = "h-9 w-full rounded-lg border border-line bg-paper/60 px-2 text-sm outline-none focus:border-ink focus:bg-card";

export function JournalForm({
  action,
  accounts,
  today,
  currency,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  accounts: { id: number; label: string }[];
  today: string;
  currency: string;
}) {
  const counter = useRef(2);
  const blank = (): Row[] => [
    { key: 1, accountId: "", debit: "", credit: "" },
    { key: 2, accountId: "", debit: "", credit: "" },
  ];
  const [rows, setRows] = useState<Row[]>(blank);
  const [lineError, setLineError] = useState<string>();
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const dr = rows.reduce((s, r) => s + (toMinor(r.debit) || 0), 0);
  const cr = rows.reduce((s, r) => s + (toMinor(r.credit) || 0), 0);
  const balanced = dr === cr && dr > 0;

  const json = JSON.stringify(
    rows.map((r) => ({
      accountId: Number(r.accountId) || 0,
      debit: Number(r.debit.replace(/,/g, "") || 0),
      credit: Number(r.credit.replace(/,/g, "") || 0),
    })),
  );

  const wrapped = async (prev: FormState, fd: FormData): Promise<FormState> => {
    const res = await action(prev, fd);
    if (res?.ok) {
      setRows(blank());
      setLineError(undefined);
    } else setLineError(res?.errors?.lines?.[0]);
    return res;
  };

  return (
    <ActionForm action={wrapped}>
      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <Input label="Date" name="date" type="date" defaultValue={today} required />
        <Input label="Memo" name="memo" placeholder="e.g. Owner capital introduced" required />
      </div>
      <input type="hidden" name="lines" value={json} />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] tracking-widest text-ink-mute uppercase">
              <th className="pb-2 pr-2 font-normal">Account</th>
              <th className="w-32 pb-2 pr-2 font-normal">Debit</th>
              <th className="w-32 pb-2 pr-2 font-normal">Credit</th>
              <th className="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="pr-2 pb-2">
                  <select aria-label="Account" value={r.accountId} onChange={(e) => patch(r.key, { accountId: e.target.value })} className={cell}>
                    <option value="">— Select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Debit" inputMode="decimal" value={r.debit} onChange={(e) => patch(r.key, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} placeholder="0.00" className={cell} />
                </td>
                <td className="pr-2 pb-2">
                  <input aria-label="Credit" inputMode="decimal" value={r.credit} onChange={(e) => patch(r.key, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} placeholder="0.00" className={cell} />
                </td>
                <td className="pb-2">
                  <button
                    type="button"
                    aria-label="Remove line"
                    disabled={rows.length <= 2}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="grid size-7 place-items-center rounded-full text-ink-mute hover:bg-signal/10 hover:text-signal disabled:opacity-30"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-sm font-semibold">
              <td className="pt-1 text-right text-ink-soft">Totals</td>
              <td className="pr-2 pt-1 tabular-nums">{formatMoney(dr, currency)}</td>
              <td className="pr-2 pt-1 tabular-nums">{formatMoney(cr, currency)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {lineError && <p className="mt-1 text-xs text-signal">{lineError}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { key: ++counter.current, accountId: "", debit: "", credit: "" }])}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium hover:border-ink"
        >
          <Plus className="size-3.5" /> Add line
        </button>
        <span className={balanced ? "text-sm text-ink-soft" : "text-sm text-signal"}>
          {balanced ? "Balanced ✓" : dr === cr ? "Enter amounts" : `Out of balance by ${formatMoney(Math.abs(dr - cr), currency)}`}
        </span>
        <SubmitButton className="ml-auto">Post journal</SubmitButton>
      </div>
    </ActionForm>
  );
}
