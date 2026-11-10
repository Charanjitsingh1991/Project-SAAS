import type { Metadata } from "next";
import { count, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/app/ui";
import { db, schema } from "@/db";
import { requireWorkspace } from "@/lib/tenancy";
import { createContact, deleteContact } from "../actions";
import { CRM_TABS } from "../tabs";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const ws = await requireWorkspace({ module: "crm" });

  const rows = await db
    .select({ contact: schema.contacts, deals: count(schema.deals.id) })
    .from(schema.contacts)
    .leftJoin(schema.deals, eq(schema.deals.contactId, schema.contacts.id))
    .where(eq(schema.contacts.orgId, ws.org.id))
    .groupBy(schema.contacts.id)
    .orderBy(schema.contacts.name);

  return (
    <>
      <PageHeader title="CRM" description="People and companies you do business with." tabs={CRM_TABS("contacts")} />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`Contacts (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState title="No contacts yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Company</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Deals</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ contact: c, deals }) => (
                  <tr key={c.id}>
                    <Td className="font-medium">{c.name}</Td>
                    <Td>{c.company ?? "—"}</Td>
                    <Td className="text-ink-soft">{c.email ?? "—"}</Td>
                    <Td className="text-ink-soft">{c.phone ?? "—"}</Td>
                    <Td>{deals}</Td>
                    <Td>
                      <ActionButton action={deleteContact} fields={{ id: c.id }} confirm={`Delete ${c.name}?`}>
                        <Trash2 className="size-3" /> Delete
                      </ActionButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Add contact">
          <ActionForm action={createContact} className="space-y-3">
            <Input label="Name" name="name" />
            <Input label="Company" name="company" />
            <Input label="Email" name="email" type="email" />
            <Input label="Phone" name="phone" />
            <SubmitButton className="w-full">Add contact</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
