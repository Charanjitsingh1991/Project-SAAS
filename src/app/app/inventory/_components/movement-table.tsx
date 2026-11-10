import Link from "next/link";
import { Badge, Table, Td, Th, type Tone } from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { fmtQty } from "@/lib/inventory";

export const MOVE_TONE: Record<string, Tone> = {
  opening: "lilac",
  receipt: "mint",
  issue: "peach",
  sale: "sky",
  transfer_in: "butter",
  transfer_out: "butter",
  adjustment: "card",
  sale_return: "lime",
};

export type MovementRow = {
  id: number;
  createdAt: Date;
  type: string;
  quantity: number;
  reference: string | null;
  note: string | null;
  productId: number;
  product: string;
  sku: string;
  warehouse: string;
  balance?: number;
};

export function TypeBadge({ type }: { type: string }) {
  return <Badge tone={MOVE_TONE[type] ?? "card"}>{type.replaceAll("_", " ")}</Badge>;
}

export function QtyDelta({ value }: { value: number }) {
  return <span className={value < 0 ? "font-medium text-signal tabular-nums" : "font-medium text-ink tabular-nums"}>{`${value > 0 ? "+" : ""}${fmtQty(value)}`}</span>;
}

export function MovementTable({ rows, showProduct = true, showBalance = false }: { rows: MovementRow[]; showProduct?: boolean; showBalance?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          {showProduct && <Th>Product</Th>}
          <Th>Type</Th>
          <Th className="text-right">Qty</Th>
          <Th>Warehouse</Th>
          <Th>Reference</Th>
          {showBalance && <Th className="text-right">Balance</Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(m.createdAt)}</Td>
            {showProduct && (
              <Td>
                <Link href={`/app/inventory/products/${m.productId}`} className="font-medium hover:underline">
                  {m.product}
                </Link>
                <p className="font-mono text-xs text-ink-mute">{m.sku}</p>
              </Td>
            )}
            <Td>
              <TypeBadge type={m.type} />
            </Td>
            <Td className="text-right">
              <QtyDelta value={m.quantity} />
            </Td>
            <Td className="text-ink-soft">{m.warehouse}</Td>
            <Td className="text-ink-soft">
              {m.reference ?? "—"}
              {m.note && <p className="text-xs text-ink-mute">{m.note}</p>}
            </Td>
            {showBalance && <Td className="text-right tabular-nums">{fmtQty(m.balance ?? 0)}</Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
