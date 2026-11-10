import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Badge, Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { requireWorkspace } from "@/lib/tenancy";
import { appOrigin } from "@/lib/url";
import { ConfirmAction } from "../../finance/_components/confirm-action";
import { connectRazorpayAction, disconnectRazorpayAction } from "./actions";

export const metadata: Metadata = { title: "Razorpay" };

export default async function RazorpayPage() {
  const ws = await requireWorkspace({ manage: true, module: "finance" });
  const [row] = await db
    .select({ hint: schema.orgIntegrations.hint, active: schema.orgIntegrations.active, updatedAt: schema.orgIntegrations.updatedAt })
    .from(schema.orgIntegrations)
    .where(and(eq(schema.orgIntegrations.orgId, ws.org.id), eq(schema.orgIntegrations.provider, "razorpay")))
    .limit(1);
  const webhookUrl = `${await appOrigin()}/api/razorpay/webhook/${ws.org.slug}`;

  return (
    <>
      <PageHeader
        title="Razorpay"
        description="Let customers pay invoices online. Use your own Razorpay account: there is no extra charge from us, Razorpay only charges its per-transaction fee."
        actions={
          <Link href="/app/integrations" className="text-sm text-ink-soft hover:text-ink">
            All integrations
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={row ? "Connected" : "Connect your account"} actions={row && <Badge tone="mint">{row.hint}</Badge>}>
          {ws.org.currency !== "INR" && (
            <p className="mb-4 rounded-xl bg-butter/60 px-3 py-2 text-sm">
              Razorpay accepts only INR on most accounts; other currencies such as {ws.org.currency} need international payments to be enabled by Razorpay. Links for {ws.org.currency} invoices will fail until then.
            </p>
          )}
          <ActionForm action={connectRazorpayAction} className="space-y-3">
            <Input label="Key ID" name="keyId" placeholder="rzp_live_…" autoComplete="off" required />
            <Input label="Key Secret" name="keySecret" type="password" autoComplete="off" required />
            <Input label="Webhook Secret" name="webhookSecret" type="password" autoComplete="off" required />
            <p className="text-xs text-ink-mute">Keys are checked with Razorpay and stored encrypted. {row ? "Saving replaces the current keys." : ""}</p>
            <SubmitButton>{row ? "Replace keys" : "Connect Razorpay"}</SubmitButton>
          </ActionForm>
          {row && (
            <div className="mt-4 border-t border-line pt-4">
              <ConfirmAction action={disconnectRazorpayAction} fields={{}} confirm="Disconnect Razorpay? Existing payment links stop updating invoices." variant="danger">
                Disconnect
              </ConfirmAction>
            </div>
          )}
        </Card>

        <Card title="Set up the webhook">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
            <li>In Razorpay Dashboard open Account &amp; Settings → Webhooks → Add new webhook.</li>
            <li>
              Webhook URL:
              <code className="mt-1 block rounded-lg bg-paper px-3 py-2 font-mono text-xs break-all text-ink select-all">{webhookUrl}</code>
            </li>
            <li>Set a Secret of your choice and enter the same value here as the Webhook Secret.</li>
            <li>
              Tick the event <span className="font-mono text-ink">payment_link.paid</span> (optionally also <span className="font-mono">payment_link.expired</span> and <span className="font-mono">payment_link.cancelled</span>).
            </li>
          </ol>
          <p className="mt-4 text-xs text-ink-mute">Payments are recorded against the invoice automatically when Razorpay confirms them. The invoice page has a “Create payment link” button once connected.</p>
        </Card>
      </div>
    </>
  );
}
