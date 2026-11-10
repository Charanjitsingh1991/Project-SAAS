import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "@/lib/activity";
import { addDaysYmd, todayYmd } from "@/lib/format";
import { toMinor } from "@/lib/money";
import { createDraftInvoice, createExpense, payBill, recordPayment, sendInvoice, voidInvoice, type InvoiceLineInput } from "@/lib/posting";

type Method = (typeof schema.PAYMENT_METHODS)[number];

const FALLBACK_CUSTOMERS = ["Northwind Traders", "Bluepeak Logistics", "Sunrise Hospitality", "Kiran Textiles", "Apex Realty"];

/** Sample invoices and expenses, all created through the posting functions so the ledger balances. */
export async function seedFinance(ctx: Ctx): Promise<void> {
  const today = todayYmd();
  const ago = (n: number) => addDaysYmd(today, -n);

  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, ctx.orgId)).limit(1);
  const [companies, products, vendors] = await Promise.all([
    db.select().from(schema.companies).where(eq(schema.companies.orgId, ctx.orgId)).orderBy(asc(schema.companies.id)),
    db.select().from(schema.products).where(eq(schema.products.orgId, ctx.orgId)).orderBy(asc(schema.products.id)),
    db.select().from(schema.vendors).where(eq(schema.vendors.orgId, ctx.orgId)).orderBy(asc(schema.vendors.id)),
  ]);

  const customers = companies.length
    ? companies.map((c) => ({ id: c.id as number | null, name: c.name, gstin: c.gstin, address: [c.billingAddress, c.city].filter(Boolean).join(", ") || null, state: c.state }))
    : FALLBACK_CUSTOMERS.map((name) => ({ id: null as number | null, name, gstin: null, address: null, state: null as string | null }));
  const customer = (i: number) => customers[i % customers.length];

  const stocked = products.filter((p) => p.active && p.trackStock && p.sellingPrice > 0);
  const productLine = (i: number, qty: number): InvoiceLineInput | null => {
    const p = stocked[i];
    return p ? { productId: p.id, description: p.name, quantity: qty, unitPrice: p.sellingPrice, taxRate: p.taxRate } : null;
  };
  const svc = (description: string, qty: number, price: number, taxRate = 18): InvoiceLineInput => ({ description, quantity: qty, unitPrice: toMinor(price), taxRate });
  const compact = (xs: (InvoiceLineInput | null)[]) => xs.filter((x): x is InvoiceLineInput => !!x);

  type Plan = {
    ago: number;
    terms: number;
    cust: number;
    lines: InvoiceLineInput[];
    send: boolean;
    pays?: { after: number; share: number; method: Method; ref?: string }[];
    void?: boolean;
    outOfState?: boolean;
  };

  const plans: Plan[] = [
    { ago: 118, terms: 30, cust: 0, lines: compact([svc("ERP implementation — phase 1", 1, 185000), productLine(0, 2)]), send: true, pays: [{ after: 24, share: 1, method: "bank_transfer", ref: "NEFT-48213" }] },
    { ago: 101, terms: 15, cust: 1, lines: [svc("Monthly support retainer", 1, 45000), svc("Onsite training (days)", 3, 12000, 18)], send: true, pays: [{ after: 10, share: 0.5, method: "upi", ref: "UPI-771204" }, { after: 29, share: 1, method: "bank_transfer", ref: "NEFT-50977" }] },
    { ago: 84, terms: 30, cust: 2, lines: compact([productLine(1, 5), productLine(2, 3), svc("Installation & setup", 1, 8500, 18)]), send: true, pays: [{ after: 33, share: 1, method: "cheque", ref: "CHQ 004512" }], outOfState: true },
    { ago: 66, terms: 30, cust: 3, lines: [svc("Website redesign — milestone 2", 1, 120000), svc("Hosting (annual)", 1, 18000, 18)], send: true, pays: [{ after: 20, share: 0.4, method: "bank_transfer", ref: "NEFT-61442" }] },
    { ago: 52, terms: 15, cust: 4, lines: compact([productLine(0, 4), svc("Freight & handling", 1, 3200, 5)]), send: true, outOfState: true },
    { ago: 41, terms: 15, cust: 0, lines: [svc("Consulting hours", 24, 3500)], send: true, void: true },
    { ago: 33, terms: 30, cust: 1, lines: compact([productLine(2, 6), svc("Annual maintenance contract", 1, 36000, 18)]), send: true, pays: [{ after: 9, share: 1, method: "upi", ref: "UPI-889120" }] },
    { ago: 24, terms: 30, cust: 2, lines: [svc("Brand identity package", 1, 65000), svc("Printed collateral", 200, 45, 12)], send: true, pays: [{ after: 11, share: 0.6, method: "bank_transfer", ref: "NEFT-70311" }] },
    { ago: 14, terms: 15, cust: 3, lines: compact([productLine(1, 2), svc("Consulting hours", 10, 3500)]), send: true },
    { ago: 6, terms: 30, cust: 4, lines: [svc("Quarterly SEO & content retainer", 1, 52000)], send: true },
    { ago: 4, terms: 15, cust: 0, lines: [svc("Data migration services", 1, 28000), svc("Training materials", 1, 4000, 0)], send: false },
  ];

  for (const p of plans) {
    const c = customer(p.cust);
    const issueDate = ago(p.ago);
    const inv = await createDraftInvoice(
      ctx,
      {
        companyId: c.id,
        customerName: c.name,
        customerGstin: c.gstin,
        billingAddress: c.address,
        placeOfSupply: p.outOfState ? "Karnataka" : (c.state ?? org?.state ?? null),
        issueDate,
        dueDate: addDaysYmd(issueDate, p.terms),
        notes: "Payment due within the stated terms. Thank you for your business.",
      },
      p.lines,
    );
    if (!p.send) continue;
    if (await sendInvoice(ctx, inv.id)) continue;

    if (p.void) {
      await voidInvoice(ctx, inv.id);
      continue;
    }
    if (!p.pays?.length) continue;
    const [row] = await db.select({ total: schema.invoices.total }).from(schema.invoices).where(eq(schema.invoices.id, inv.id)).limit(1);
    let paid = 0;
    for (const pay of p.pays) {
      const amount = pay.share >= 1 ? row.total - paid : Math.round((row.total * pay.share) / 100) * 100;
      if (amount <= 0) continue;
      const date = addDaysYmd(issueDate, pay.after) > today ? today : addDaysYmd(issueDate, pay.after);
      if (!(await recordPayment(ctx, inv.id, { date, amount, method: pay.method, reference: pay.ref ?? null }))) paid += amount;
    }
  }

  const vendor = (i: number) => (vendors.length ? vendors[i % vendors.length].id : null);
  type Exp = { ago: number; desc: string; cat: string; amount: number; gst: number; unpaidDue?: number; payAfter?: number; method?: Method; ref?: string; vendor?: number };
  const expenses: Exp[] = [
    { ago: 112, desc: "Office rent — July", cat: "rent", amount: 65000, gst: 18, method: "bank_transfer", ref: "RENT-JUL" },
    { ago: 105, desc: "Cloud hosting & SaaS tools", cat: "software", amount: 18400, gst: 18, method: "card" },
    { ago: 92, desc: "Client visit — Bengaluru flights", cat: "travel", amount: 14200, gst: 5, method: "card" },
    { ago: 81, desc: "Office rent — August", cat: "rent", amount: 65000, gst: 18, method: "bank_transfer", ref: "RENT-AUG" },
    { ago: 70, desc: "Google Ads campaign", cat: "marketing", amount: 22000, gst: 18, method: "card", ref: "ADS-2208" },
    { ago: 58, desc: "Statutory audit fees", cat: "professional_fees", amount: 40000, gst: 18, unpaidDue: -20, vendor: 0 },
    { ago: 50, desc: "Office rent — September", cat: "rent", amount: 65000, gst: 18, method: "bank_transfer", ref: "RENT-SEP" },
    { ago: 44, desc: "Electricity & internet", cat: "utilities", amount: 9800, gst: 18, unpaidDue: -22, payAfter: 18, method: "upi", vendor: 1 },
    { ago: 36, desc: "Stationery & printer cartridges", cat: "supplies", amount: 4650, gst: 12, method: "cash" },
    { ago: 28, desc: "AC servicing & repairs", cat: "maintenance", amount: 7200, gst: 18, unpaidDue: -3, vendor: 2 },
    { ago: 20, desc: "Office rent — October", cat: "rent", amount: 65000, gst: 18, method: "bank_transfer", ref: "RENT-OCT" },
    { ago: 15, desc: "Legal consultation — vendor contract", cat: "professional_fees", amount: 25000, gst: 18, unpaidDue: 12, vendor: 0 },
    { ago: 9, desc: "Team offsite lunch", cat: "other_expense", amount: 6400, gst: 5, method: "upi" },
    { ago: 5, desc: "LinkedIn & design subscriptions", cat: "software", amount: 11800, gst: 18, unpaidDue: 20, vendor: 1 },
  ];

  for (const [i, e] of expenses.entries()) {
    const date = ago(e.ago);
    const amount = toMinor(e.amount);
    const unpaid = e.unpaidDue !== undefined;
    const id = await createExpense(ctx, {
      date,
      vendorId: vendor(e.vendor ?? i),
      description: e.desc,
      category: e.cat,
      amount,
      taxAmount: Math.round((amount * e.gst) / 100),
      status: unpaid ? "unpaid" : "paid",
      dueDate: unpaid ? addDaysYmd(today, e.unpaidDue!) : null,
      paymentMethod: unpaid ? null : (e.method ?? "bank_transfer"),
      reference: e.ref ?? null,
      sourceType: "manual",
    });
    if (unpaid && e.payAfter !== undefined) {
      const payDate = addDaysYmd(date, e.payAfter);
      await payBill(ctx, id, payDate > today ? today : payDate, e.method ?? "bank_transfer");
    }
  }
}
