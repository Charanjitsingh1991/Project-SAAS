import "server-only";
import { db, schema } from "@/db";
import { STAGE_PROBABILITY, type DealStage } from "@/db/schema";
import type { Ctx } from "@/lib/activity";
import { logActivity } from "@/lib/activity";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { onDealWon } from "@/lib/posting";

type Source = "website" | "referral" | "outbound" | "event" | "partner" | "other";
type Lifecycle = "lead" | "prospect" | "customer" | "churned";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const lakh = (n: number) => Math.round(n * 100_000 * 100);

const COMPANIES = [
  { name: "Tata Elxsi Labs", industry: "Engineering services", gstin: "29AABCT1234F1Z5", city: "Bengaluru", state: "Karnataka", country: "India", website: "tataelxsi.example", phone: "+91 80 4000 1100" },
  { name: "Reliance Retail Ventures", industry: "Retail", gstin: "27AAACR5055K1ZK", city: "Mumbai", state: "Maharashtra", country: "India", website: "relretail.example", phone: "+91 22 3555 0100" },
  { name: "Infosys BPM", industry: "IT services", gstin: "29AAACI4798L1Z9", city: "Bengaluru", state: "Karnataka", country: "India", website: "infosysbpm.example", phone: "+91 80 2852 0261" },
  { name: "Sundaram Textiles", industry: "Manufacturing", gstin: "33AABCS7321M1Z2", city: "Coimbatore", state: "Tamil Nadu", country: "India", website: "sundaramtex.example", phone: "+91 422 400 2200" },
  { name: "Zenith Logistics", industry: "Logistics", gstin: "07AAFCZ8812N1ZP", city: "New Delhi", state: "Delhi", country: "India", website: "zenithlogistics.example", phone: "+91 11 4100 7788" },
  { name: "GreenLeaf Organics", industry: "Food & beverage", gstin: "24AABCG4410P1Z8", city: "Ahmedabad", state: "Gujarat", country: "India", website: "greenleaf.example", phone: "+91 79 4890 1234" },
  { name: "Northwind Traders", industry: "Wholesale", gstin: null, city: "Seattle", state: "Washington", country: "USA", website: "northwind.example", phone: "+1 206 555 0148" },
  { name: "Atlas Fintech Pte Ltd", industry: "Financial services", gstin: null, city: "Singapore", state: "Singapore", country: "Singapore", website: "atlasfintech.example", phone: "+65 6123 4567" },
  { name: "Kaveri Hospitals", industry: "Healthcare", gstin: "36AABCK9087Q1Z3", city: "Hyderabad", state: "Telangana", country: "India", website: "kaverihospitals.example", phone: "+91 40 6600 3300" },
];

// [companyIdx, name, title, lifecycle, source, hasPhone]
const CONTACTS: [number, string, string, Lifecycle, Source, boolean][] = [
  [0, "Anita Rao", "VP Engineering", "customer", "referral", true],
  [0, "Vikram Nair", "Procurement Lead", "prospect", "referral", true],
  [1, "Meera Kapoor", "Head of Digital", "customer", "event", true],
  [1, "Rohan Shah", "IT Manager", "prospect", "outbound", false],
  [2, "Suresh Iyer", "CTO", "customer", "website", true],
  [2, "Divya Menon", "Finance Controller", "prospect", "website", true],
  [3, "Karthik Subramanian", "Managing Director", "customer", "partner", true],
  [3, "Lakshmi Pillai", "Operations Head", "lead", "outbound", false],
  [4, "Arjun Malhotra", "COO", "prospect", "event", true],
  [4, "Neha Gupta", "Supply Chain Manager", "lead", "website", true],
  [5, "Pooja Desai", "Founder", "customer", "referral", true],
  [5, "Amit Patel", "Finance Head", "lead", "other", false],
  [6, "Jordan Ellis", "Director of IT", "prospect", "partner", true],
  [6, "Sam Whitaker", "Buyer", "lead", "outbound", false],
  [7, "Wei Lim", "Head of Operations", "prospect", "event", true],
  [7, "Priya Raman", "Product Manager", "churned", "website", false],
  [8, "Dr. Srinivas Reddy", "Administrator", "prospect", "referral", true],
  [8, "Fatima Sheikh", "IT Head", "lead", "website", true],
  [-1, "Rahul Verma", "Independent consultant", "lead", "website", false],
];

type DealSeed = {
  title: string;
  company: number;
  contact: number; // index into CONTACTS
  value: number; // lakh
  stage: DealStage;
  source: Source;
  closeInDays: number | null;
  createdDaysAgo: number;
  stageDaysAgo: number;
  lostReason?: string;
};

const DEALS: DealSeed[] = [
  { title: "Inbound website enquiry — warehouse tracking", company: 4, contact: 9, value: 0.8, stage: "lead", source: "website", closeInDays: 90, createdDaysAgo: 3, stageDaysAgo: 3 },
  { title: "Retail analytics pilot", company: 1, contact: 3, value: 2.5, stage: "lead", source: "outbound", closeInDays: 120, createdDaysAgo: 40, stageDaysAgo: 34 },
  { title: "Hospital patient-portal scoping", company: 8, contact: 17, value: 1.2, stage: "lead", source: "website", closeInDays: 100, createdDaysAgo: 8, stageDaysAgo: 8 },
  { title: "ERP integration — Phase 2", company: 0, contact: 1, value: 12, stage: "qualified", source: "referral", closeInDays: 60, createdDaysAgo: 25, stageDaysAgo: 12 },
  { title: "Fleet management suite", company: 4, contact: 8, value: 8.5, stage: "qualified", source: "event", closeInDays: 75, createdDaysAgo: 30, stageDaysAgo: 9 },
  { title: "Cross-border payments dashboard", company: 7, contact: 14, value: 18, stage: "qualified", source: "event", closeInDays: 130, createdDaysAgo: 22, stageDaysAgo: 6 },
  { title: "Supplier portal build", company: 6, contact: 12, value: 6.5, stage: "proposal", source: "partner", closeInDays: 30, createdDaysAgo: 45, stageDaysAgo: 10 },
  { title: "Finance automation rollout", company: 2, contact: 5, value: 15, stage: "proposal", source: "website", closeInDays: 45, createdDaysAgo: 50, stageDaysAgo: 35 },
  { title: "Organic marketplace storefront", company: 5, contact: 11, value: 0.5, stage: "proposal", source: "other", closeInDays: -5, createdDaysAgo: 40, stageDaysAgo: 14 },
  { title: "Hospital ERP & billing", company: 8, contact: 16, value: 25, stage: "negotiation", source: "referral", closeInDays: 20, createdDaysAgo: 70, stageDaysAgo: 5 },
  { title: "Textile ERP renewal & upgrade", company: 3, contact: 6, value: 9, stage: "negotiation", source: "partner", closeInDays: 12, createdDaysAgo: 80, stageDaysAgo: 33 },
  { title: "Retail POS integration", company: 1, contact: 2, value: 14, stage: "negotiation", source: "event", closeInDays: 35, createdDaysAgo: 60, stageDaysAgo: 8 },
  { title: "Engineering portal — Phase 1", company: 0, contact: 0, value: 10, stage: "won", source: "referral", closeInDays: null, createdDaysAgo: 75, stageDaysAgo: 20 },
  { title: "Data warehouse implementation", company: 2, contact: 4, value: 20, stage: "won", source: "website", closeInDays: null, createdDaysAgo: 110, stageDaysAgo: 45 },
  { title: "Retail loyalty app", company: 1, contact: 2, value: 7.5, stage: "won", source: "event", closeInDays: null, createdDaysAgo: 60, stageDaysAgo: 12 },
  { title: "Textile planning module", company: 3, contact: 6, value: 4.2, stage: "won", source: "partner", closeInDays: null, createdDaysAgo: 40, stageDaysAgo: 6 },
  { title: "Organic ERP starter", company: 5, contact: 10, value: 1.5, stage: "lost", source: "referral", closeInDays: null, createdDaysAgo: 85, stageDaysAgo: 30, lostReason: "Chose a cheaper competitor" },
  { title: "Fintech compliance suite", company: 7, contact: 15, value: 22, stage: "lost", source: "website", closeInDays: null, createdDaysAgo: 100, stageDaysAgo: 25, lostReason: "Budget frozen for the year" },
];

export async function seedCrm(ctx: Ctx): Promise<void> {
  const owner = ctx.userId;
  const today = todayYmd();

  const companyIds: number[] = [];
  for (const c of COMPANIES) {
    const [row] = await db
      .insert(schema.companies)
      .values({
        orgId: ctx.orgId,
        name: c.name,
        industry: c.industry,
        website: c.website,
        phone: c.phone,
        gstin: c.gstin,
        city: c.city,
        state: c.state,
        country: c.country,
        billingAddress: `${c.city}, ${c.state}, ${c.country}`,
        ownerId: owner,
      })
      .returning({ id: schema.companies.id });
    companyIds.push(row.id);
  }

  const contactIds: number[] = [];
  for (const [ci, name, title, lifecycle, source, phone] of CONTACTS) {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    const domain = ci >= 0 ? COMPANIES[ci].website : "gmail.example";
    const [row] = await db
      .insert(schema.contacts)
      .values({
        orgId: ctx.orgId,
        companyId: ci >= 0 ? companyIds[ci] : null,
        name,
        title,
        email: name === "Amit Patel" ? null : `${slug}@${domain}`,
        phone: phone ? `+91 98${String(10000000 + contactIds.length * 137731).slice(0, 8)}` : null,
        ownerId: owner,
        lifecycle,
        source,
        createdAt: ago(30 + contactIds.length * 3),
      })
      .returning({ id: schema.contacts.id });
    contactIds.push(row.id);
  }

  const dealIds: number[] = [];
  for (const d of DEALS) {
    const closing = d.stage === "won" || d.stage === "lost";
    const stageAt = ago(d.stageDaysAgo);
    const [row] = await db
      .insert(schema.deals)
      .values({
        orgId: ctx.orgId,
        title: d.title,
        companyId: companyIds[d.company],
        contactId: contactIds[d.contact],
        ownerId: owner,
        value: lakh(d.value),
        stage: d.stage,
        probability: STAGE_PROBABILITY[d.stage],
        source: d.source,
        expectedClose: d.closeInDays === null ? null : addDaysYmd(today, d.closeInDays),
        closedAt: closing ? stageAt : null,
        lostReason: d.lostReason ?? null,
        stageChangedAt: stageAt,
        createdAt: ago(d.createdDaysAgo),
      })
      .returning({ id: schema.deals.id });
    dealIds.push(row.id);
    await logActivity(ctx, { module: "crm", entityType: "deal", entityId: row.id, action: "created", summary: `Created deal ${d.title} in lead` });
    if (d.stage !== "lead") {
      await logActivity(ctx, { module: "crm", entityType: "deal", entityId: row.id, action: "stage_changed", summary: `Moved ${d.title} from lead to ${d.stage}${d.lostReason ? ` (${d.lostReason})` : ""}` });
    }
    if (d.stage === "won") await onDealWon(ctx, row.id);
  }

  // [dealIdx|-1, contactIdx|-1, type, subject, body, dueInDays|null, done, createdDaysAgo]
  const ACTIVITIES: [number, number, "note" | "call" | "meeting" | "email" | "task", string, string | null, number | null, boolean, number][] = [
    [3, 1, "call", "Discovery call with procurement", "Walked through scope; they need SAP connector.", null, true, 10],
    [3, 1, "task", "Send revised Phase 2 estimate", null, -3, false, 6],
    [3, 0, "meeting", "Architecture review with VP Engineering", "Agreed on API-first approach.", null, true, 4],
    [4, 8, "email", "Shared fleet suite brochure", null, null, true, 9],
    [4, 8, "task", "Schedule on-site demo", null, 2, false, 5],
    [5, 14, "call", "Intro call — compliance requirements", "Needs MAS audit trail.", null, true, 6],
    [5, 14, "task", "Prepare payments dashboard mock-up", null, 5, false, 3],
    [6, 12, "meeting", "Supplier portal requirements workshop", "Two-hour session, 14 attendees.", null, true, 12],
    [6, 12, "task", "Send proposal revision to Jordan", null, 0, false, 2],
    [7, 5, "note", "Finance team worried about migration downtime", "Offer a weekend cutover plan.", null, true, 20],
    [7, 5, "task", "Follow up — proposal stuck for 5 weeks", null, -6, false, 15],
    [8, 11, "task", "Chase Amit for budget approval", null, -9, false, 14],
    [9, 16, "meeting", "Negotiation meeting with hospital board", "Board wants 3-year support pricing.", null, true, 3],
    [9, 16, "task", "Send final contract draft", null, 1, false, 2],
    [9, 16, "email", "Pricing breakdown shared", null, null, true, 1],
    [10, 6, "call", "Renewal pricing call", "Asked for 8% discount.", null, true, 35],
    [10, 6, "task", "Escalate discount approval internally", null, -2, false, 7],
    [11, 2, "meeting", "POS integration technical session", null, null, true, 7],
    [11, 2, "task", "Draft SOW for POS integration", null, 7, false, 4],
    [12, 0, "note", "Kickoff done — project opened", null, null, true, 18],
    [13, 4, "call", "Go-live checklist review", null, null, true, 40],
    [14, 2, "email", "Welcome pack sent", null, null, true, 10],
    [0, 9, "task", "Qualify inbound lead", null, 0, false, 1],
    [1, 3, "task", "Re-engage Rohan — no reply in a month", null, -1, false, 5],
    [16, 10, "note", "Lost on price; revisit in 6 months", null, null, true, 28],
    [-1, 18, "call", "Cold call — independent consultant", "Interested in a reseller arrangement.", 4, false, 1],
  ];
  for (const [di, ci, type, subject, body, due, done, createdAgo] of ACTIVITIES) {
    const deal = di >= 0 ? DEALS[di] : null;
    await db.insert(schema.crmActivities).values({
      orgId: ctx.orgId,
      dealId: di >= 0 ? dealIds[di] : null,
      contactId: ci >= 0 ? contactIds[ci] : null,
      companyId: deal ? companyIds[deal.company] : ci >= 0 && CONTACTS[ci][0] >= 0 ? companyIds[CONTACTS[ci][0]] : null,
      type,
      subject,
      body,
      dueDate: due === null ? null : addDaysYmd(today, due),
      done,
      ownerId: owner,
      createdAt: ago(createdAgo),
    });
  }
}
