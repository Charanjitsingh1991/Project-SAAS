import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { CalendarDays, Code2, CreditCard, KeyRound, MessageSquare, Plug, Sparkles, Webhook } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { canManage } from "@/lib/roles";
import { canUseModule, hasFeature, requireWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Integrations" };

type Tile = {
  href: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  status?: string;
  /** Why the tile is unavailable to this user, if it is. */
  locked?: string;
};

export default async function IntegrationsPage() {
  const ws = await requireWorkspace();
  const orgId = ws.org.id;
  const manage = canManage(ws.role);
  const api = hasFeature(ws, "developerApi");

  const [endpoints, keys, feed, razorpay] = await Promise.all([
    db.select({ kind: schema.webhookEndpoints.kind, active: schema.webhookEndpoints.active }).from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, orgId)),
    db.$count(schema.apiKeys, and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt))),
    db.$count(schema.calendarFeeds, and(eq(schema.calendarFeeds.orgId, orgId), eq(schema.calendarFeeds.userId, ws.user.id))),
    db.select({ active: schema.orgIntegrations.active }).from(schema.orgIntegrations).where(and(eq(schema.orgIntegrations.orgId, orgId), eq(schema.orgIntegrations.provider, "razorpay"))).limit(1),
  ]);
  const hooks = endpoints.filter((e) => e.kind === "webhook" && e.active).length;
  const chats = endpoints.filter((e) => e.kind !== "webhook" && e.active).length;
  const adminOnly = manage ? undefined : "Owners and admins manage this.";
  const growth = api ? undefined : "Available on Growth.";

  const tiles: Tile[] = [
    {
      href: "/app/ask",
      title: "Ask AI",
      body: "Ask questions about invoices, deals, leave, stock, tickets and payroll in plain English. Answers come only from your workspace data.",
      icon: <Sparkles className="size-5" />,
      locked: hasFeature(ws, "copilot") ? undefined : "Available on Growth.",
    },
    {
      href: "/app/integrations/webhooks",
      title: "Slack, Microsoft Teams & Google Chat",
      body: "Post new deals, paid invoices, leave requests and tickets to a channel.",
      icon: <MessageSquare className="size-5" />,
      status: chats ? `${chats} connected` : undefined,
      locked: adminOnly,
    },
    {
      href: "/app/integrations/webhooks",
      title: "Zapier, Make, n8n & webhooks",
      body: "Send signed events to Zapier, Make, n8n, Pabbly or your own server, and connect thousands of other apps from there.",
      icon: <Webhook className="size-5" />,
      status: hooks ? `${hooks} active` : undefined,
      locked: adminOnly ?? growth,
    },
    {
      href: "/app/integrations/api",
      title: "REST API",
      body: "Read and create contacts, companies, deals, invoices, tickets and more with API keys.",
      icon: <Code2 className="size-5" />,
      status: keys ? `${keys} key${keys === 1 ? "" : "s"}` : undefined,
      locked: adminOnly ?? growth,
    },
    {
      href: "/app/integrations/calendar",
      title: "Google, Outlook & Apple Calendar",
      body: "Subscribe to holidays, team leave, your task due dates and invoice due dates.",
      icon: <CalendarDays className="size-5" />,
      status: feed ? "Feed active" : undefined,
    },
    {
      href: "/app/integrations/razorpay",
      title: "Razorpay payment links",
      body: "Let customers pay invoices online by UPI, card or netbanking. Payments are recorded on the invoice automatically. Share links by email or WhatsApp.",
      icon: <CreditCard className="size-5" />,
      status: razorpay[0]?.active ? "Connected" : undefined,
      locked: !canUseModule(ws, "finance") ? "Needs the Finance module." : adminOnly,
    },
  ];

  return (
    <>
      <PageHeader title="Integrations" description="Connect saasmodels.tech to the tools your team already uses. All of these are free to set up." />
      <div className="grid gap-4 md:grid-cols-2">
        {tiles.map((t) => {
          const inner = (
            <Card className="h-full transition-colors hover:border-ink">
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-paper">{t.icon}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-semibold">{t.title}</h2>
                    {t.status && <Badge tone="mint">{t.status}</Badge>}
                    {t.locked && <Badge>{t.locked}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{t.body}</p>
                </div>
              </div>
            </Card>
          );
          return t.locked ? (
            <div key={t.title} className="opacity-70">
              {inner}
            </div>
          ) : (
            <Link key={t.title} href={t.href} className="block">
              {inner}
            </Link>
          );
        })}
      </div>
      <Card className="mt-6" title="Also built in">
        <ul className="grid gap-2 text-sm text-ink-soft md:grid-cols-2">
          <li className="flex gap-2">
            <KeyRound className="mt-0.5 size-4 shrink-0" /> Sign in with Google or Microsoft (set up once by the platform owner).
          </li>
          <li className="flex gap-2">
            <Plug className="mt-0.5 size-4 shrink-0" /> CSV import and export for people, contacts, companies and products.
          </li>
        </ul>
      </Card>
    </>
  );
}
