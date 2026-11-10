import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ActionForm, Input, SubmitButton, Textarea } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { todayYmd } from "@/lib/format";
import { LETTER_KIND_LABEL, isLetterKind } from "@/lib/letters";
import { requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../../tabs";
import { draftLetter } from "../_data";
import { issueLetter } from "../actions";

export const metadata: Metadata = { title: "Issue letter" };

export default async function NewLetterPage({ searchParams }: { searchParams: Promise<{ employee?: string; kind?: string }> }) {
  const ws = await requireWorkspace({ module: "hrm" });
  const sp = await searchParams;
  const empId = /^\d+$/.test(sp.employee ?? "") ? Number(sp.employee) : null;
  const kind = isLetterKind(sp.kind) ? sp.kind : "experience";

  const employees = await db
    .select()
    .from(schema.employees)
    .where(eq(schema.employees.orgId, ws.org.id))
    .orderBy(asc(schema.employees.name));
  const emp = empId ? employees.find((e) => e.id === empId) : undefined;
  const today = todayYmd();
  const draft = emp ? await draftLetter(ws, emp, kind, today) : null;
  const kindOptions = Object.entries(LETTER_KIND_LABEL).map(([value, label]) => ({ value, label }));

  return (
    <>
      <PageHeader title="Issue a letter" description="Pick an employee and letter type, review the generated text, edit it if needed, then issue." tabs={hrmTabs(ws, "letters")} />
      <div className="mx-auto max-w-3xl space-y-6">
        <Card title="1. Employee and type">
          <form action="/app/hrm/letters/new" className="flex flex-wrap items-end gap-3">
            <label className="block min-w-56 flex-1">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Employee</span>
              <select name="employee" defaultValue={emp?.id ?? ""} className="h-10 w-full rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink">
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.code}){e.status === "exited" ? " — exited" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Letter type</span>
              <select name="kind" defaultValue={kind} className="h-10 w-full rounded-xl border border-line bg-paper/60 px-3 text-sm outline-none focus:border-ink">
                {kindOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="h-10 rounded-full border border-line px-5 text-sm font-medium hover:border-ink">Generate draft</button>
          </form>
        </Card>

        {emp && draft && (
          <Card title={`2. Review — ${LETTER_KIND_LABEL[kind]} for ${emp.name}`}>
            <ActionForm action={issueLetter} className="space-y-3" resetOnSuccess={false}>
              <input type="hidden" name="employeeId" value={emp.id} />
              <input type="hidden" name="kind" value={kind} />
              <Input label="Issue date" name="issuedOn" type="date" defaultValue={today} />
              <Input label="Subject" name="subject" defaultValue={draft.subject} />
              <Textarea label="Letter text (blank line = new paragraph)" name="body" rows={18} defaultValue={draft.body} />
              <p className="text-xs text-ink-mute">The text is frozen when issued; later changes to the employee record won&apos;t alter it.</p>
              <div className="flex items-center gap-3">
                <SubmitButton>Issue letter</SubmitButton>
                <Link href="/app/hrm/letters" className="text-sm text-ink-soft underline-offset-4 hover:underline">
                  Cancel
                </Link>
              </div>
            </ActionForm>
          </Card>
        )}
        {!emp && empId && <p className="rounded-xl bg-butter px-4 py-3 text-sm">Employee not found in this workspace.</p>}
      </div>
    </>
  );
}
