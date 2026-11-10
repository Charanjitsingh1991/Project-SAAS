import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../../tabs";
import { OpeningFields } from "../_components/opening-fields";
import { createOpening } from "../actions";
import { formOptions } from "../data";

export const metadata: Metadata = { title: "New job opening" };

export default async function NewOpeningPage() {
  const ws = await requireWorkspace({ module: "hrm", feature: "recruitment" });
  const { departments, people } = await formOptions(ws.org.id);
  return (
    <>
      <PageHeader title="New job opening" description="Publish a role and start collecting candidates." tabs={hrmTabs(ws, "recruitment")} />
      <Card className="max-w-3xl">
        <ActionForm action={createOpening} resetOnSuccess={false} className="space-y-4">
          <OpeningFields departments={departments} people={people} currency={ws.org.currency} />
          <div className="flex gap-2">
            <SubmitButton>Create opening</SubmitButton>
            <Link href="/app/hrm/recruitment" className="inline-flex h-10 items-center rounded-full border border-ink/20 px-5 text-sm hover:border-ink">
              Cancel
            </Link>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
