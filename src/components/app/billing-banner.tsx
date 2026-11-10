import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { canManage } from "@/lib/roles";
import { getWorkspace, type ActiveWorkspace } from "@/lib/tenancy";
import { formatDate } from "@/lib/format";

/** Workspace-wide alerts: last trial day, failed payment, scheduled cancellation. */
export async function BillingBanner() {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.access || !ws.role) return null;
  const { access, org, role } = ws as ActiveWorkspace;
  const manager = canManage(role);

  const cta = manager ? (
    <Link href="/app/billing" className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/85">
      Add payment method
    </Link>
  ) : (
    <span className="shrink-0 text-sm font-medium">Ask your workspace owner to add a payment method.</span>
  );

  if (access.state === "trial" && access.lastDay) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-signal/30 bg-signal px-5 py-3 text-white md:px-8">
        <AlertTriangle className="size-5 shrink-0" />
        <p className="flex-1 text-sm">
          <b>Last day of your free trial.</b> Add a payment method before midnight tonight — otherwise your workspace and all
          services will be disabled at 12:00 AM.
        </p>
        <span className="[&_a]:bg-white [&_a]:text-ink">{cta}</span>
      </div>
    );
  }
  if (access.state === "past_due") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-ink/10 bg-butter px-5 py-3 md:px-8">
        <AlertTriangle className="size-5 shrink-0" />
        <p className="flex-1 text-sm">
          <b>Your last payment failed.</b> Update your card to keep your workspace running.
        </p>
        {cta}
      </div>
    );
  }
  if (access.state === "paid" && org.cancelAtPeriodEnd && org.currentPeriodEnd) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 bg-butter/70 px-5 py-2.5 text-sm md:px-8">
        <Clock className="size-4 shrink-0" />
        <p className="flex-1">Your subscription is set to end on {formatDate(org.currentPeriodEnd)}.</p>
        {manager && (
          <Link href="/app/billing" className="font-medium underline underline-offset-4">
            Manage billing
          </Link>
        )}
      </div>
    );
  }
  return null;
}
