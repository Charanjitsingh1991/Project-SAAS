import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "./activity";
import { parseAutomations } from "./automations";
import { postJournal, reverseJournal } from "./ledger";
import { taxOf } from "./money";
import { nextNumber } from "./sequence";
import { defaultWarehouseId, moveStock } from "./stock";

/*
 * Cross-module business events. Every money movement posts a balanced journal;
 * every stock change goes through moveStock(). Module actions should call these
 * instead of touching invoices/expenses/ledger/stock directly.
 */

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(new Date());
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function orgRow(orgId: number) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Workspace not found");
  return org;
}

export async function automationsFor(orgId: number) {
  return parseAutomations((await orgRow(orgId)).automations);
}

/* ───────────── Invoices ───────────── */

export type InvoiceLineInput = {
  productId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number; // minor
  taxRate: number; // percent
};

/** Replace an invoice's lines and recompute subtotal / tax / total. Only for drafts. */
export async function saveInvoiceLines(ctx: Ctx, invoiceId: number, lines: InvoiceLineInput[]) {
  const computed = lines.map((l, i) => {
    const amount = Math.round(l.quantity * l.unitPrice);
    return { ...l, amount, taxAmount: taxOf(amount, l.taxRate), sortOrder: i };
  });
  await db.delete(schema.invoiceLines).where(and(eq(schema.invoiceLines.invoiceId, invoiceId), eq(schema.invoiceLines.orgId, ctx.orgId)));
  if (computed.length) {
    await db.insert(schema.invoiceLines).values(
      computed.map((l) => ({
        orgId: ctx.orgId,
        invoiceId,
        productId: l.productId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        amount: l.amount,
        taxAmount: l.taxAmount,
        sortOrder: l.sortOrder,
      })),
    );
  }
  const subtotal = computed.reduce((s, l) => s + l.amount, 0);
  const taxTotal = computed.reduce((s, l) => s + l.taxAmount, 0);
  await db
    .update(schema.invoices)
    .set({ subtotal, taxTotal, total: subtotal + taxTotal })
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ctx.orgId)));
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

export type InvoiceHeaderInput = {
  companyId?: number | null;
  customerName: string;
  customerEmail?: string | null;
  billingAddress?: string | null;
  customerGstin?: string | null;
  placeOfSupply?: string | null;
  issueDate?: string;
  dueDate?: string;
  notes?: string | null;
  dealId?: number | null;
  projectId?: number | null;
};

/** Create a draft invoice with an auto number. Returns its id and number. */
export async function createDraftInvoice(ctx: Ctx, header: InvoiceHeaderInput, lines: InvoiceLineInput[]) {
  const issueDate = header.issueDate ?? today();
  const number = await nextNumber(ctx.orgId, "invoice");
  const [inv] = await db
    .insert(schema.invoices)
    .values({
      orgId: ctx.orgId,
      number,
      companyId: header.companyId ?? null,
      customerName: header.customerName,
      customerEmail: header.customerEmail ?? null,
      billingAddress: header.billingAddress ?? null,
      customerGstin: header.customerGstin ?? null,
      placeOfSupply: header.placeOfSupply ?? null,
      issueDate,
      dueDate: header.dueDate ?? plusDays(issueDate, 15),
      notes: header.notes ?? null,
      dealId: header.dealId ?? null,
      projectId: header.projectId ?? null,
      status: "draft",
    })
    .returning({ id: schema.invoices.id });
  await saveInvoiceLines(ctx, inv.id, lines);
  return { id: inv.id, number };
}

/** Draft → sent: posts AR/Sales/GST and (if enabled) issues stock + COGS. Returns an error message or null. */
export async function sendInvoice(ctx: Ctx, invoiceId: number): Promise<string | null> {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ctx.orgId)))
    .limit(1);
  if (!inv) return "Invoice not found.";
  if (inv.status !== "draft") return "Only draft invoices can be sent.";
  if (inv.total <= 0) return "Add at least one line with an amount before sending.";

  await postJournal(ctx, {
    date: inv.issueDate,
    memo: `Invoice ${inv.number} — ${inv.customerName}`,
    sourceType: "invoice",
    sourceId: inv.id,
    lines: [
      { key: "ar", debit: inv.total },
      { key: "sales", credit: inv.subtotal },
      { key: "gst_out", credit: inv.taxTotal },
    ],
  });

  const auto = await automationsFor(ctx.orgId);
  if (auto.invoiceStockIssue) {
    const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id));
    const productIds = lines.map((l) => l.productId).filter((x): x is number => !!x);
    if (productIds.length) {
      const prods = await db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.orgId, ctx.orgId), inArray(schema.products.id, productIds)));
      const byId = new Map(prods.map((p) => [p.id, p]));
      const wh = await defaultWarehouseId(ctx.orgId);
      let cogs = 0;
      for (const l of lines) {
        const p = l.productId ? byId.get(l.productId) : undefined;
        if (!p || !p.trackStock) continue;
        cogs += Math.round(p.costPrice * l.quantity);
        await moveStock(ctx, {
          productId: p.id,
          warehouseId: wh,
          quantity: -l.quantity,
          type: "sale",
          unitCost: p.costPrice,
          reference: inv.number,
          sourceType: "invoice",
          sourceId: inv.id,
        });
      }
      if (cogs > 0) {
        await postJournal(ctx, {
          date: inv.issueDate,
          memo: `Cost of goods — ${inv.number}`,
          sourceType: "invoice",
          sourceId: inv.id,
          lines: [
            { key: "cogs", debit: cogs },
            { key: "inventory", credit: cogs },
          ],
        });
      }
    }
  }

  await db.update(schema.invoices).set({ status: "sent", sentAt: new Date() }).where(eq(schema.invoices.id, inv.id));
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: inv.id, action: "sent", summary: `Sent invoice ${inv.number} to ${inv.customerName}` });
  return null;
}

/** Void an invoice. Sent invoices are reversed in the ledger and stock is returned. Not allowed once paid. */
export async function voidInvoice(ctx: Ctx, invoiceId: number): Promise<string | null> {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ctx.orgId)))
    .limit(1);
  if (!inv) return "Invoice not found.";
  if (inv.status === "void") return null;
  if (inv.amountPaid > 0) return "This invoice has payments. Delete the payments first.";

  if (inv.status !== "draft") {
    await reverseJournal(ctx, "invoice", inv.id, today(), `Void invoice ${inv.number}`);
    const moves = await db
      .select()
      .from(schema.stockMovements)
      .where(and(eq(schema.stockMovements.orgId, ctx.orgId), eq(schema.stockMovements.sourceType, "invoice"), eq(schema.stockMovements.sourceId, inv.id), eq(schema.stockMovements.type, "sale")));
    for (const m of moves) {
      await moveStock(ctx, {
        productId: m.productId,
        warehouseId: m.warehouseId,
        quantity: -m.quantity,
        type: "sale_return",
        reference: inv.number,
        sourceType: "invoice_void",
        sourceId: inv.id,
        note: "Invoice voided",
      });
    }
  }
  await db.update(schema.invoices).set({ status: "void" }).where(eq(schema.invoices.id, inv.id));
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: inv.id, action: "voided", summary: `Voided invoice ${inv.number}` });
  return null;
}

async function refreshInvoicePaid(ctx: Ctx, invoiceId: number) {
  const pays = await db.select({ amount: schema.payments.amount }).from(schema.payments).where(eq(schema.payments.invoiceId, invoiceId));
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
  const status = paid <= 0 ? "sent" : paid >= inv.total ? "paid" : "partial";
  await db.update(schema.invoices).set({ amountPaid: paid, status }).where(eq(schema.invoices.id, invoiceId));
}

/** Record a customer payment against a sent/partial invoice. Returns an error message or null. */
export async function recordPayment(
  ctx: Ctx,
  invoiceId: number,
  p: { date: string; amount: number; method: (typeof schema.PAYMENT_METHODS)[number]; reference?: string | null },
): Promise<string | null> {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ctx.orgId)))
    .limit(1);
  if (!inv) return "Invoice not found.";
  if (inv.status !== "sent" && inv.status !== "partial") return "Send the invoice before recording payments.";
  const balance = inv.total - inv.amountPaid;
  if (p.amount <= 0) return "Amount must be more than zero.";
  if (p.amount > balance) return "Amount is more than the balance due.";

  const [pay] = await db
    .insert(schema.payments)
    .values({ orgId: ctx.orgId, invoiceId, date: p.date, amount: p.amount, method: p.method, reference: p.reference ?? null })
    .returning({ id: schema.payments.id });
  await postJournal(ctx, {
    date: p.date,
    memo: `Payment for ${inv.number} — ${inv.customerName}`,
    sourceType: "payment",
    sourceId: pay.id,
    lines: [
      { key: "bank", debit: p.amount },
      { key: "ar", credit: p.amount },
    ],
  });
  await refreshInvoicePaid(ctx, invoiceId);
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: invoiceId, action: "payment", summary: `Recorded payment on ${inv.number}` });
  return null;
}

export async function deletePayment(ctx: Ctx, paymentId: number) {
  const [pay] = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.orgId, ctx.orgId)))
    .limit(1);
  if (!pay) return;
  await reverseJournal(ctx, "payment", pay.id, today(), "Payment deleted");
  await db.delete(schema.payments).where(eq(schema.payments.id, pay.id));
  await refreshInvoicePaid(ctx, pay.invoiceId);
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: pay.invoiceId, action: "payment_deleted", summary: "Deleted a payment" });
}

/* ───────────── Expenses & bills ───────────── */

export type ExpenseInput = {
  date: string;
  vendorId?: number | null;
  description: string;
  category: string; // account system key
  amount: number; // minor, excl. tax
  taxAmount?: number;
  status: "paid" | "unpaid";
  dueDate?: string | null;
  paymentMethod?: (typeof schema.PAYMENT_METHODS)[number] | null;
  reference?: string | null;
  sourceType?: "manual" | "payroll" | "purchase_order";
  sourceId?: number | null;
};

/** Record an expense / bill. Posts Dr expense (+ GST input) / Cr bank or AP unless post=false. */
export async function createExpense(ctx: Ctx, e: ExpenseInput, opts: { post?: boolean } = {}) {
  const tax = e.taxAmount ?? 0;
  const total = e.amount + tax;
  const [row] = await db
    .insert(schema.expenses)
    .values({
      orgId: ctx.orgId,
      date: e.date,
      vendorId: e.vendorId ?? null,
      description: e.description,
      category: e.category,
      amount: e.amount,
      taxAmount: tax,
      total,
      status: e.status,
      dueDate: e.dueDate ?? null,
      paidDate: e.status === "paid" ? e.date : null,
      paymentMethod: e.paymentMethod ?? null,
      reference: e.reference ?? null,
      sourceType: e.sourceType ?? "manual",
      sourceId: e.sourceId ?? null,
    })
    .returning({ id: schema.expenses.id });

  if (opts.post !== false) {
    await postJournal(ctx, {
      date: e.date,
      memo: e.description,
      sourceType: "expense",
      sourceId: row.id,
      lines: [
        { key: e.category, debit: e.amount },
        { key: "gst_in", debit: tax },
        { key: e.status === "paid" ? "bank" : "ap", credit: total },
      ],
    });
  }
  return row.id;
}

/** Pay an unpaid bill: Dr AP / Cr Bank. */
export async function payBill(ctx: Ctx, expenseId: number, date: string, method?: (typeof schema.PAYMENT_METHODS)[number]): Promise<string | null> {
  const [ex] = await db
    .select()
    .from(schema.expenses)
    .where(and(eq(schema.expenses.id, expenseId), eq(schema.expenses.orgId, ctx.orgId)))
    .limit(1);
  if (!ex) return "Bill not found.";
  if (ex.status === "paid") return "This bill is already paid.";
  await postJournal(ctx, {
    date,
    memo: `Bill payment — ${ex.description}`,
    sourceType: "bill_payment",
    sourceId: ex.id,
    lines: [
      { key: "ap", debit: ex.total },
      { key: "bank", credit: ex.total },
    ],
  });
  await db
    .update(schema.expenses)
    .set({ status: "paid", paidDate: date, paymentMethod: method ?? ex.paymentMethod ?? "bank_transfer" })
    .where(eq(schema.expenses.id, ex.id));
  await logActivity(ctx, { module: "finance", entityType: "expense", entityId: ex.id, action: "paid", summary: `Paid bill: ${ex.description}` });
  return null;
}

/** Delete a manual expense, reversing its postings. Automatic ones (payroll/PO) can't be deleted here. */
export async function deleteExpense(ctx: Ctx, expenseId: number): Promise<string | null> {
  const [ex] = await db
    .select()
    .from(schema.expenses)
    .where(and(eq(schema.expenses.id, expenseId), eq(schema.expenses.orgId, ctx.orgId)))
    .limit(1);
  if (!ex) return "Expense not found.";
  if (ex.sourceType !== "manual") return "This entry was created automatically and can't be deleted.";
  await reverseJournal(ctx, "expense", ex.id, today(), `Deleted expense: ${ex.description}`);
  await reverseJournal(ctx, "bill_payment", ex.id, today(), `Deleted bill payment: ${ex.description}`);
  await db.delete(schema.expenses).where(eq(schema.expenses.id, ex.id));
  await logActivity(ctx, { module: "finance", entityType: "expense", entityId: ex.id, action: "deleted", summary: `Deleted expense: ${ex.description}` });
  return null;
}

/* ───────────── Payroll ───────────── */

/** Approved → paid: posts the salary journal and an expense record (if enabled). */
export async function markPayrollPaid(ctx: Ctx, runId: number, paymentDate: string): Promise<string | null> {
  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ctx.orgId)))
    .limit(1);
  if (!run) return "Payroll run not found.";
  if (run.status !== "approved") return "Approve the run before marking it paid.";

  const slips = await db.select().from(schema.payslips).where(eq(schema.payslips.runId, runId));
  const sum = (k: keyof (typeof slips)[number]) => slips.reduce((s, p) => s + Number(p[k] ?? 0), 0);
  const gross = sum("gross");
  const net = sum("net");
  const pfEsiEmp = sum("pfEmployee") + sum("esiEmployee");
  const employer = sum("pfEmployer") + sum("esiEmployer");
  const tds = sum("tds");
  const pt = sum("professionalTax");
  const other = sum("otherDeductions");

  const auto = await automationsFor(ctx.orgId);
  if (auto.payrollExpense && gross > 0) {
    await postJournal(ctx, {
      date: paymentDate,
      memo: `Payroll ${run.period}`,
      sourceType: "payroll",
      sourceId: run.id,
      lines: [
        { key: "salaries", debit: gross },
        { key: "employer_contrib", debit: employer },
        { key: "bank", credit: net },
        { key: "pf_payable", credit: pfEsiEmp + employer },
        { key: "tds_payable", credit: tds },
        { key: "pt_payable", credit: pt },
        { key: "other_income", credit: other },
      ],
    });
    await createExpense(
      ctx,
      {
        date: paymentDate,
        description: `Payroll ${run.period} (${slips.length} employees)`,
        category: "salaries",
        amount: gross + employer,
        status: "paid",
        paymentMethod: "bank_transfer",
        sourceType: "payroll",
        sourceId: run.id,
      },
      { post: false },
    );
  }

  await db
    .update(schema.payrollRuns)
    .set({ status: "paid", paidAt: new Date(), paymentDate })
    .where(eq(schema.payrollRuns.id, run.id));
  await logActivity(ctx, { module: "payroll", entityType: "payroll_run", entityId: run.id, action: "paid", summary: `Paid payroll for ${run.period}` });
  return null;
}

/* ───────────── Purchasing ───────────── */

/** Receive an ordered PO: stock in at weighted-average cost, then (if enabled) an unpaid vendor bill. */
export async function receivePurchaseOrder(ctx: Ctx, poId: number, date = today()): Promise<string | null> {
  const [po] = await db
    .select({ po: schema.purchaseOrders, vendor: schema.vendors.name })
    .from(schema.purchaseOrders)
    .innerJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
    .where(and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.orgId, ctx.orgId)))
    .limit(1);
  if (!po) return "Purchase order not found.";
  if (po.po.status !== "ordered") return "Only ordered purchase orders can be received.";

  const lines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, poId));
  for (const l of lines) {
    const qty = l.quantity;
    if (qty <= 0) continue;
    await moveStock(ctx, {
      productId: l.productId,
      warehouseId: po.po.warehouseId,
      quantity: qty,
      type: "receipt",
      unitCost: l.unitCost,
      reference: po.po.number,
      sourceType: "purchase_order",
      sourceId: poId,
    });
  }

  let expenseId: number | null = null;
  const auto = await automationsFor(ctx.orgId);
  if (auto.poReceivedBill && po.po.total > 0) {
    expenseId = await createExpense(ctx, {
      date,
      vendorId: po.po.vendorId,
      description: `${po.po.number} — ${po.vendor}`,
      category: "inventory",
      amount: po.po.subtotal,
      taxAmount: po.po.taxTotal,
      status: "unpaid",
      dueDate: plusDays(date, 30),
      reference: po.po.number,
      sourceType: "purchase_order",
      sourceId: poId,
    });
  }

  await db
    .update(schema.purchaseOrders)
    .set({ status: "received", receivedAt: new Date(), expenseId })
    .where(eq(schema.purchaseOrders.id, poId));
  await logActivity(ctx, { module: "inventory", entityType: "purchase_order", entityId: poId, action: "received", summary: `Received ${po.po.number} from ${po.vendor}` });
  return null;
}

/* ───────────── CRM → Finance / Projects ───────────── */

/** Run won-deal automations. Safe to call more than once. */
export async function onDealWon(ctx: Ctx, dealId: number) {
  const [row] = await db
    .select({ deal: schema.deals, company: schema.companies, contact: schema.contacts })
    .from(schema.deals)
    .leftJoin(schema.companies, eq(schema.deals.companyId, schema.companies.id))
    .leftJoin(schema.contacts, eq(schema.deals.contactId, schema.contacts.id))
    .where(and(eq(schema.deals.id, dealId), eq(schema.deals.orgId, ctx.orgId)))
    .limit(1);
  if (!row) return;
  const { deal, company, contact } = row;
  const org = await orgRow(ctx.orgId);
  const auto = parseAutomations(org.automations);
  const sys: Ctx = { orgId: ctx.orgId, userId: ctx.userId };
  const patch: Partial<typeof schema.deals.$inferInsert> = {};

  if (auto.dealWonInvoice && !deal.invoiceId && deal.value > 0) {
    const inv = await createDraftInvoice(
      sys,
      {
        companyId: company?.id ?? null,
        customerName: company?.name ?? contact?.name ?? deal.title,
        customerEmail: contact?.email ?? null,
        billingAddress: company?.billingAddress ?? null,
        customerGstin: company?.gstin ?? null,
        placeOfSupply: company?.state ?? null,
        dealId: deal.id,
        notes: `Created from won deal “${deal.title}”.`,
      },
      [{ description: deal.title, quantity: 1, unitPrice: deal.value, taxRate: org.currency === "INR" ? 18 : 0 }],
    );
    patch.invoiceId = inv.id;
    await logActivity(sys, { module: "automation", entityType: "invoice", entityId: inv.id, action: "created", summary: `Draft invoice ${inv.number} created from won deal “${deal.title}”` });
  }

  if (auto.dealWonProject && !deal.projectId) {
    const code = await nextNumber(ctx.orgId, "project");
    const [p] = await db
      .insert(schema.projects)
      .values({
        orgId: ctx.orgId,
        code,
        name: deal.title,
        companyId: company?.id ?? null,
        description: `Opened automatically when the deal was won.`,
        ownerId: deal.ownerId ?? ctx.userId,
        billingType: "fixed",
        budget: deal.value,
        startDate: today(),
        status: "planning",
      })
      .returning({ id: schema.projects.id });
    patch.projectId = p.id;
    await logActivity(sys, { module: "automation", entityType: "project", entityId: p.id, action: "created", summary: `Project ${code} opened from won deal “${deal.title}”` });
  }

  if (Object.keys(patch).length) await db.update(schema.deals).set(patch).where(eq(schema.deals.id, deal.id));
  if (contact && contact.lifecycle !== "customer") {
    await db.update(schema.contacts).set({ lifecycle: "customer" }).where(eq(schema.contacts.id, contact.id));
  }
}

/* ───────────── Projects → Finance ───────────── */

/** Turn a project's unbilled billable hours into a draft invoice. */
export async function invoiceProjectTime(ctx: Ctx, projectId: number): Promise<{ error: string } | { invoiceId: number; number: string }> {
  const [row] = await db
    .select({ project: schema.projects, company: schema.companies })
    .from(schema.projects)
    .leftJoin(schema.companies, eq(schema.projects.companyId, schema.companies.id))
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, ctx.orgId)))
    .limit(1);
  if (!row) return { error: "Project not found." };
  const { project, company } = row;
  if (project.hourlyRate <= 0) return { error: "Set an hourly rate on the project first." };

  const entries = await db
    .select({ e: schema.timeEntries, task: schema.tasks.title })
    .from(schema.timeEntries)
    .leftJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
    .where(and(eq(schema.timeEntries.projectId, projectId), eq(schema.timeEntries.billable, true), isNull(schema.timeEntries.invoiceId)));
  if (!entries.length) return { error: "No unbilled billable hours." };

  const groups = new Map<string, number>();
  for (const { e, task } of entries) groups.set(task ?? "General work", (groups.get(task ?? "General work") ?? 0) + e.hours);
  const org = await orgRow(ctx.orgId);

  const inv = await createDraftInvoice(
    ctx,
    {
      companyId: company?.id ?? null,
      customerName: company?.name ?? project.name,
      billingAddress: company?.billingAddress ?? null,
      customerGstin: company?.gstin ?? null,
      placeOfSupply: company?.state ?? null,
      projectId,
      notes: `Billable hours for ${project.code} ${project.name}.`,
    },
    [...groups.entries()].map(([task, hours]) => ({
      description: `${project.name} — ${task}`,
      quantity: Math.round(hours * 100) / 100,
      unitPrice: project.hourlyRate,
      taxRate: org.currency === "INR" ? 18 : 0,
    })),
  );
  await db
    .update(schema.timeEntries)
    .set({ invoiceId: inv.id })
    .where(inArray(schema.timeEntries.id, entries.map((x) => x.e.id)));
  await logActivity(ctx, { module: "projects", entityType: "project", entityId: projectId, action: "invoiced", summary: `Billed ${entries.length} time entries on ${project.code} → ${inv.number}` });
  return { invoiceId: inv.id, number: inv.number };
}
