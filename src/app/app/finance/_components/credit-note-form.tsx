"use client";

import { useState } from "react";
import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import type { FormState } from "@/lib/definitions";
import { formatMoney, taxOf } from "@/lib/money";

export type CreditableLine = { id: number; description: string; remaining: number; unitPrice: number; taxRate: number; hasProduct: boolean };

/** Issue a credit note for chosen quantities of an invoice's lines. */
export function CreditNoteForm({
  action,
  invoiceId,
  lines,
  currency,
  today,
  taxName,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  invoiceId: number;
  lines: CreditableLine[];
  currency: string;
  today: string;
  taxName: string;
}) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const total = lines.reduce((s, l) => {
    const q = Math.min(Number(qty[l.id]) || 0, l.remaining);
    const amount = Math.round(q * l.unitPrice);
    return s + amount + taxOf(amount, l.taxRate);
  }, 0);
  const anyProduct = lines.some((l) => l.hasProduct);

  return (
    <ActionForm action={action} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{l.description}</span>
              <span className="text-xs text-ink-mute">
                up to {l.remaining} × {formatMoney(l.unitPrice, currency)}
              </span>
            </span>
            <input
              name={`qty_${l.id}`}
              aria-label={`Quantity to credit for ${l.description}`}
              inputMode="decimal"
              placeholder="0"
              value={qty[l.id] ?? ""}
              onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
              className="h-8 w-20 rounded-lg border border-line bg-paper/60 px-2 text-right text-sm outline-none focus:border-ink"
            />
          </li>
        ))}
      </ul>
      <Input label="Date" name="date" type="date" defaultValue={today} required />
      <Input label="Reason" name="reason" placeholder="e.g. Damaged goods returned" required />
      {anyProduct && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="restock" className="size-4 accent-ink" /> Return products to stock
        </label>
      )}
      <p className="text-sm text-ink-soft">
        Credit incl. {taxName}: <span className="font-medium text-ink tabular-nums">{formatMoney(total, currency)}</span>
      </p>
      <SubmitButton className="w-full">Issue credit note</SubmitButton>
    </ActionForm>
  );
}
