import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Input, Select, SubmitButton } from "@/components/app/forms";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { schema } from "@/db";
import { accountBalances } from "@/lib/finance";
import { formatMoney } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";
import { createAccountAction } from "../actions";
import { FINANCE_TABS } from "../tabs";

export const metadata: Metadata = { title: "Chart of accounts" };

const TONE = { asset: "sky", liability: "peach", equity: "lilac", income: "mint", expense: "butter" } as const;

export default async function AccountsPage() {
  const ws = await requireWorkspace({ module: "finance" });
  const cur = ws.org.currency;
  const accounts = await accountBalances(ws.org.id);

  return (
    <>
      <PageHeader title="Chart of accounts" description="Every posting lands on one of these accounts. Add your own for finer reporting." tabs={FINANCE_TABS("accounts")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Account</Th>
                <Th>Type</Th>
                <Th className="text-right">Debits</Th>
                <Th className="text-right">Credits</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-paper/60">
                  <Td className="text-ink-mute">{a.code}</Td>
                  <Td>
                    <Link href={`/app/finance/accounts/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    {!a.systemKey && <span className="ml-2 text-xs text-ink-mute">custom</span>}
                  </Td>
                  <Td>
                    <Badge tone={TONE[a.type]}>{a.type}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(a.debit, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(a.credit, cur)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(a.balance, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Add account" className="h-fit">
          <ActionForm action={createAccountAction} className="space-y-3">
            <Input label="Code" name="code" placeholder="e.g. 6950" inputMode="numeric" required />
            <Input label="Name" name="name" placeholder="e.g. Bank charges" required />
            <Select label="Type" name="type" options={schema.ACCOUNT_TYPES} defaultValue="expense" />
            <SubmitButton className="w-full">Add account</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
