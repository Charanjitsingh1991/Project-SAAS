import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/app/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/format";
import { canUseModule, requireWorkspace } from "@/lib/tenancy";
import { generateCalendarFeed, revokeCalendarFeed } from "./actions";
import { FeedForm } from "./feed-form";

export const metadata: Metadata = { title: "Calendar sync" };

export default async function CalendarPage() {
  const ws = await requireWorkspace();
  const [feed] = await db
    .select({ createdAt: schema.calendarFeeds.createdAt })
    .from(schema.calendarFeeds)
    .where(and(eq(schema.calendarFeeds.orgId, ws.org.id), eq(schema.calendarFeeds.userId, ws.user.id)))
    .limit(1);

  const includes = [
    "Workspace holidays",
    canUseModule(ws, "hrm") ? "Approved leave for everyone" : "Approved leave for you and your direct reports",
    "Your open tasks that have a due date",
    ...(canUseModule(ws, "finance") ? ["Invoice due dates"] : []),
  ];

  return (
    <>
      <PageHeader title="Calendar sync" description="Subscribe to a private calendar feed in Google Calendar, Outlook or Apple Calendar." />

      <div className="space-y-6">
        <Card title="Your calendar link">
          <FeedForm generate={generateCalendarFeed} revoke={revokeCalendarFeed} hasFeed={!!feed} />
          <p className="mt-3 text-xs text-ink-mute">
            {feed ? `Link created ${formatDate(feed.createdAt)}. For security it is only shown when generated; regenerate to get a new one. ` : ""}
            Anyone with the link can see this calendar, so don&apos;t share it. Regenerating or turning it off cuts off the old link.
          </p>
          <div className="mt-4">
            <p className="text-sm font-medium">What&apos;s in the feed</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
              {includes.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        </Card>

        <Card title="How to subscribe">
          <div className="grid gap-6 text-sm md:grid-cols-3">
            <div>
              <h3 className="font-semibold">Google Calendar</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
                <li>Open Google Calendar on the web.</li>
                <li>Next to &ldquo;Other calendars&rdquo;, click <b>+</b> then <b>From URL</b>.</li>
                <li>Paste your link and click <b>Add calendar</b>.</li>
              </ol>
            </div>
            <div>
              <h3 className="font-semibold">Outlook</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
                <li>Open Outlook Calendar.</li>
                <li>Choose <b>Add calendar</b> then <b>Subscribe from web</b>.</li>
                <li>Paste your link, name it, and click <b>Import</b>.</li>
              </ol>
            </div>
            <div>
              <h3 className="font-semibold">Apple Calendar</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
                <li>In Calendar, choose <b>File → New Calendar Subscription…</b> (on iPhone: Settings → Calendar → Accounts → Add Subscribed Calendar).</li>
                <li>Paste your link and click <b>Subscribe</b>.</li>
                <li>Pick an auto-refresh interval.</li>
              </ol>
            </div>
          </div>
          <p className="mt-4 text-xs text-ink-mute">Calendar apps refresh subscribed feeds on their own schedule, often every few hours, so changes are not instant.</p>
        </Card>
      </div>
    </>
  );
}
