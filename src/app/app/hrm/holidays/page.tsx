import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate, todayYmd } from "@/lib/format";
import { dayOfWeek } from "@/lib/hrm";
import { requireWorkspace } from "@/lib/tenancy";
import { addHoliday, deleteHoliday } from "../actions";
import { hrmTabs } from "../tabs";

export const metadata: Metadata = { title: "Holidays" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const thisYear = Number(todayYmd().slice(0, 4));
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : thisYear;
  const list = await db
    .select()
    .from(schema.holidays)
    .where(and(eq(schema.holidays.orgId, ws.org.id), gte(schema.holidays.date, `${year}-01-01`), lte(schema.holidays.date, `${year}-12-31`)))
    .orderBy(asc(schema.holidays.date));

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Holidays are skipped when counting leave days and show as non-working in the attendance register."
        tabs={hrmTabs(ws, "holidays")}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/app/hrm/holidays?year=${year - 1}`} className="rounded-full border border-line px-3 py-1.5 hover:border-ink">
              ← {year - 1}
            </Link>
            <span className="font-semibold">{year}</span>
            <Link href={`/app/hrm/holidays?year=${year + 1}`} className="rounded-full border border-line px-3 py-1.5 hover:border-ink">
              {year + 1} →
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card title={`${list.length} holiday${list.length === 1 ? "" : "s"} in ${year}`}>
          {list.length === 0 ? (
            <EmptyState title="No holidays for this year">Add the first one on the right.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Day</Th>
                  <Th>Holiday</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.map((h) => (
                  <tr key={h.id}>
                    <Td className="whitespace-nowrap">{formatDate(h.date)}</Td>
                    <Td className="text-ink-soft">{DAYS[dayOfWeek(h.date)]}</Td>
                    <Td>
                      {h.name} {h.optional && <Badge tone="butter">optional</Badge>}
                    </Td>
                    <Td className="text-right">
                      <ActionButton action={deleteHoliday} fields={{ id: h.id }} confirm={`Remove ${h.name}?`}>
                        Delete
                      </ActionButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Add holiday" className="h-fit">
          <ActionForm action={addHoliday} className="space-y-3">
            <Input label="Date" name="date" type="date" defaultValue={`${year}-01-01`} />
            <Input label="Name" name="name" placeholder="e.g. Diwali" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="optional" className="size-4 accent-ink" /> Optional (restricted) holiday
            </label>
            <SubmitButton>Add holiday</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
