import { and, eq, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { runDueRecurring } from "@/lib/posting";
import { activeModules, effectivePlan, planHas } from "@/lib/plans";
import { accessFor } from "@/lib/trial";

/**
 * Daily Vercel Cron job (see vercel.json): generates every due recurring invoice across workspaces.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`; without CRON_SECRET set the endpoint stays closed.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(new Date());
  const due = await db
    .selectDistinct({ orgId: schema.recurringInvoices.orgId })
    .from(schema.recurringInvoices)
    .where(and(eq(schema.recurringInvoices.active, true), lte(schema.recurringInvoices.nextDate, today)));
  if (!due.length) return Response.json({ ok: true, workspaces: 0, invoices: 0, failed: [] });

  const orgs = await db
    .select()
    .from(schema.organizations)
    .where(inArray(schema.organizations.id, due.map((d) => d.orgId)));

  let invoices = 0;
  let workspaces = 0;
  const failed: number[] = [];
  for (const org of orgs) {
    // Same gates as the "Run due now" button: unlocked workspace, Finance enabled, plan includes recurring invoices.
    const access = accessFor(org);
    if (access.state === "locked") continue;
    const plan = effectivePlan(org, access.state === "trial");
    if (!planHas(plan, "recurringInvoices") || !activeModules(plan, org.enabledModules).includes("finance")) continue;
    try {
      invoices += await runDueRecurring({ orgId: org.id, userId: null });
      workspaces++;
    } catch (e) {
      console.error(`recurring invoices failed for org ${org.id}`, e);
      failed.push(org.id);
    }
  }
  return Response.json({ ok: failed.length === 0, workspaces, invoices, failed });
}
