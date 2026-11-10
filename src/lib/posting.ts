import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "./activity";
import { effectiveAutomations, parseAutomations } from "./automations";
import { packOf, taxOption } from "./countries";
import { REIMBURSEMENT_CODE, parseBreakdown, type PayslipBreakdown } from "./payroll-types";
import { activeModules, effectivePlan, planHas } from "./plans";
import { accessFor } from "./trial";
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

/** Automation toggles in force for a workspace (stored toggles ∩ plan features ∩ enabled modules). */
export async function automationsFor(orgId: number) {
  const org = await orgRow(orgId);
  const plan = effectivePlan(org, accessFor(org).state === "trial");
  return effectiveAutomations(parseAutomations(org.automations), {
    planAutomations: planHas(plan, "automations"),
    modules: activeModules(plan, org.enabledModules),
  });
}

/** Default tax line settings for a workspace's country. */
async function defaultTax(orgId: number) {
  const pack = packOf(await orgRow(orgId));
  const opt = taxOption(pack, pack.tax.defaultCode);
  return { taxRate: opt.rate, taxCode: opt.code };
}

// Reversals are dated on the original transaction date so voids/deletions cancel out in the same period.

/* ───────────── Invoices ───────────── */

export type InvoiceLineInput = {
  productId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number; // minor
  taxRate: number; // percent
  /** Country tax code (SR/ZR/EX, GST18…); inferred from the rate when omitted. */
  taxCode?: string | null;
};

/** Replace an invoice's lines and recompute subtotal / tax / total. Only for drafts. */
export async function saveInvoiceLines(ctx: Ctx, invoiceId: number, lines: InvoiceLineInput[]) {
  const pack = packOf(await orgRow(ctx.orgId));
  const computed = lines.map((l, i) => {
    const amount = Math.round(l.quantity * l.unitPrice);
    const opt = taxOption(pack, l.taxCode, l.taxRate);
    const rate = opt.kind === "standard" ? l.taxRate : 0;
    return { ...l, taxRate: rate, taxCode: opt.code, amount, taxAmount: taxOf(amount, rate), sortOrder: i };
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
        taxCode: l.taxCode,
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
  if (inv.amountCredited > 0) return "This invoice has credit notes and can't be voided.";

  if (inv.status !== "draft") {
    await reverseJournal(ctx, "invoice", inv.id, inv.issueDate, `Void invoice ${inv.number}`);
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
  const notes = await db.select({ total: schema.creditNotes.total }).from(schema.creditNotes).where(eq(schema.creditNotes.invoiceId, invoiceId));
  const credited = notes.reduce((s, n) => s + n.total, 0);
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
  if (inv.status === "void" || inv.status === "draft") return;
  const settled = paid + credited;
  const status = settled <= 0 ? "sent" : settled >= inv.total ? "paid" : "partial";
  await db.update(schema.invoices).set({ amountPaid: paid, amountCredited: credited, status }).where(eq(schema.invoices.id, invoiceId));
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
  const balance = inv.total - inv.amountPaid - inv.amountCredited;
  if (p.amount <= 0) return "Amount must be more than zero.";
  if (p.amount > balance) return "Amount is more than the balance due.";
  if (p.date < inv.issueDate) return "Payment date can't be before the invoice date.";

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
  await reverseJournal(ctx, "payment", pay.id, pay.date, "Payment deleted");
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
  await reverseJournal(ctx, "expense", ex.id, ex.date, `Deleted expense: ${ex.description}`);
  await reverseJournal(ctx, "bill_payment", ex.id, ex.paidDate ?? ex.date, `Deleted bill payment: ${ex.description}`);
  await db.delete(schema.expenses).where(eq(schema.expenses.id, ex.id));
  await logActivity(ctx, { module: "finance", entityType: "expense", entityId: ex.id, action: "deleted", summary: `Deleted expense: ${ex.description}` });
  return null;
}

/* ───────────── Payroll ───────────── */

/** Breakdown for payslips created before country engines existed (India columns only). */
export function legacyBreakdown(p: typeof schema.payslips.$inferSelect): PayslipBreakdown {
  return {
    earnings: [
      { code: "basic", label: "Basic", amount: p.basic },
      { code: "hra", label: "HRA", amount: p.hra },
      { code: "special", label: "Special allowance", amount: p.special },
      { code: "bonus", label: "Bonus", amount: p.bonus },
      { code: "other_earnings", label: "Other earnings", amount: p.otherEarnings },
    ],
    deductions: [
      { code: "pf", label: "Provident fund", amount: p.pfEmployee, account: "pf_payable" },
      { code: "esi", label: "ESI", amount: p.esiEmployee, account: "pf_payable" },
      { code: "pt", label: "Professional tax", amount: p.professionalTax, account: "pt_payable" },
      { code: "tds", label: "Income tax (TDS)", amount: p.tds, account: "tds_payable" },
      { code: "other", label: "Other deductions", amount: p.otherDeductions, account: "other_income" },
    ],
    employer: [
      { code: "pf_employer", label: "Employer PF", amount: p.pfEmployer, expenseAccount: "employer_contrib", liabilityAccount: "pf_payable" },
      { code: "esi_employer", label: "Employer ESI", amount: p.esiEmployer, expenseAccount: "employer_contrib", liabilityAccount: "pf_payable" },
    ],
  };
}

/**
 * Approved → paid. Posts one balanced salary journal built from every payslip's breakdown:
 *   Dr salaries (earnings) · Dr reimbursements payable (claims) · Dr employer cost accounts
 *   Cr bank (net) · Cr each deduction's account · Cr each employer liability.
 * Then marks payroll-reimbursed claims as reimbursed and reduces loan balances.
 */
export async function markPayrollPaid(ctx: Ctx, runId: number, paymentDate: string): Promise<string | null> {
  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ctx.orgId)))
    .limit(1);
  if (!run) return "Payroll run not found.";
  if (run.status !== "approved") return "Approve the run before marking it paid.";

  const slips = await db.select().from(schema.payslips).where(eq(schema.payslips.runId, runId));
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => v && m.set(k, (m.get(k) ?? 0) + v);
  let net = 0;
  let salaryCost = 0;

  for (const p of slips) {
    const b = parseBreakdown(p.breakdown) ?? legacyBreakdown(p);
    for (const e of b.earnings) {
      if (e.code === REIMBURSEMENT_CODE) add(debit, "reimb_payable", e.amount);
      else {
        add(debit, "salaries", e.amount);
        salaryCost += e.amount;
      }
    }
    for (const d of b.deductions) add(credit, d.account, d.amount);
    for (const r of b.employer) {
      add(debit, r.expenseAccount, r.amount);
      add(credit, r.liabilityAccount, r.amount);
      salaryCost += r.amount;
    }
    net += p.net;
  }
  add(credit, "bank", net);

  const auto = await automationsFor(ctx.orgId);
  if (auto.payrollExpense && (debit.size || credit.size)) {
    await postJournal(ctx, {
      date: paymentDate,
      memo: `Payroll ${run.period}`,
      sourceType: "payroll",
      sourceId: run.id,
      lines: [...[...debit].map(([key, v]) => ({ key, debit: v })), ...[...credit].map(([key, v]) => ({ key, credit: v }))],
    });
    await createExpense(
      ctx,
      {
        date: paymentDate,
        description: `Payroll ${run.period} (${slips.length} employees)`,
        category: "salaries",
        amount: salaryCost,
        status: "paid",
        paymentMethod: "bank_transfer",
        sourceType: "payroll",
        sourceId: run.id,
      },
      { post: false },
    );
  }

  // Claims reimbursed through this run.
  const slipIds = slips.map((s) => s.id);
  if (slipIds.length) {
    await db
      .update(schema.expenseClaims)
      .set({ status: "reimbursed", reimbursedAt: new Date() })
      .where(and(eq(schema.expenseClaims.orgId, ctx.orgId), inArray(schema.expenseClaims.payslipId, slipIds)));
  }

  // Loan recoveries: reduce balances oldest-first per employee.
  for (const p of slips) {
    let remaining = p.loanDeduction;
    if (remaining <= 0) continue;
    const loans = await db
      .select()
      .from(schema.employeeLoans)
      .where(and(eq(schema.employeeLoans.employeeId, p.employeeId), eq(schema.employeeLoans.status, "active")))
      .orderBy(schema.employeeLoans.id);
    for (const l of loans) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, l.balance);
      remaining -= take;
      const balance = l.balance - take;
      await db
        .update(schema.employeeLoans)
        .set({ balance, status: balance <= 0 ? "closed" : "active" })
        .where(eq(schema.employeeLoans.id, l.id));
    }
  }

  await db
    .update(schema.payrollRuns)
    .set({ status: "paid", paidAt: new Date(), paymentDate })
    .where(eq(schema.payrollRuns.id, run.id));
  await logActivity(ctx, { module: "payroll", entityType: "payroll_run", entityId: run.id, action: "paid", summary: `Paid payroll for ${run.period}` });
  return null;
}

/* ───────────── HR money: claims, loans, final settlement ───────────── */

/** Approve a submitted claim: Dr expense (+ input tax) / Cr reimbursements payable; "direct" claims are paid from bank at once. */
export async function approveClaim(ctx: Ctx, claimId: number, date = today()): Promise<string | null> {
  const [c] = await db
    .select({ c: schema.expenseClaims, name: schema.employees.name })
    .from(schema.expenseClaims)
    .innerJoin(schema.employees, eq(schema.expenseClaims.employeeId, schema.employees.id))
    .where(and(eq(schema.expenseClaims.id, claimId), eq(schema.expenseClaims.orgId, ctx.orgId)))
    .limit(1);
  if (!c) return "Claim not found.";
  if (c.c.status !== "submitted") return "Only submitted claims can be approved.";
  const auto = await automationsFor(ctx.orgId);
  const via = c.c.reimburseVia === "payroll" && auto.claimsViaPayroll ? "payroll" : "direct";

  await postJournal(ctx, {
    date,
    memo: `Expense claim — ${c.name}: ${c.c.description}`,
    sourceType: "claim",
    sourceId: c.c.id,
    lines: [
      { key: c.c.category, debit: c.c.amount },
      { key: "gst_in", debit: c.c.taxAmount },
      { key: "reimb_payable", credit: c.c.total },
    ],
  });
  if (via === "direct") {
    await postJournal(ctx, {
      date,
      memo: `Claim reimbursement — ${c.name}`,
      sourceType: "claim",
      sourceId: c.c.id,
      lines: [
        { key: "reimb_payable", debit: c.c.total },
        { key: "bank", credit: c.c.total },
      ],
    });
  }
  await db
    .update(schema.expenseClaims)
    .set({
      status: via === "direct" ? "reimbursed" : "approved",
      reimburseVia: via,
      decidedBy: ctx.userId,
      decidedAt: new Date(),
      reimbursedAt: via === "direct" ? new Date() : null,
    })
    .where(eq(schema.expenseClaims.id, c.c.id));
  await logActivity(ctx, {
    module: "hrm",
    entityType: "expense_claim",
    entityId: c.c.id,
    action: "approved",
    summary: `Approved ${c.name}'s claim “${c.c.description}”${via === "payroll" ? " (reimbursed in next payroll)" : " and paid it"}`,
  });
  return null;
}

/** Disburse a loan/advance: Dr employee advances / Cr bank. */
export async function disburseLoan(ctx: Ctx, loanId: number): Promise<string | null> {
  const [l] = await db
    .select({ l: schema.employeeLoans, name: schema.employees.name })
    .from(schema.employeeLoans)
    .innerJoin(schema.employees, eq(schema.employeeLoans.employeeId, schema.employees.id))
    .where(and(eq(schema.employeeLoans.id, loanId), eq(schema.employeeLoans.orgId, ctx.orgId)))
    .limit(1);
  if (!l) return "Loan not found.";
  await postJournal(ctx, {
    date: l.l.disbursedOn,
    memo: `${l.l.type === "loan" ? "Loan" : "Salary advance"} to ${l.name}`,
    sourceType: "loan",
    sourceId: l.l.id,
    lines: [
      { key: "advances", debit: l.l.principal },
      { key: "bank", credit: l.l.principal },
    ],
  });
  await logActivity(ctx, { module: "payroll", entityType: "loan", entityId: l.l.id, action: "disbursed", summary: `Disbursed a ${l.l.type} to ${l.name}` });
  return null;
}

/**
 * Pay a final settlement:
 *   Dr salaries (pending salary + leave encashment + other earnings)
 *   Dr gratuity provision (up to what was accrued for this employee) + Dr gratuity expense (any shortfall)
 *   Cr advances (loan recovery) · Cr other income (other deductions) · Cr bank (net).
 */
export async function paySettlement(ctx: Ctx, settlementId: number, date: string): Promise<string | null> {
  const [s] = await db
    .select({ s: schema.finalSettlements, name: schema.employees.name })
    .from(schema.finalSettlements)
    .innerJoin(schema.employees, eq(schema.finalSettlements.employeeId, schema.employees.id))
    .where(and(eq(schema.finalSettlements.id, settlementId), eq(schema.finalSettlements.orgId, ctx.orgId)))
    .limit(1);
  if (!s) return "Settlement not found.";
  if (s.s.status === "paid") return "This settlement is already paid.";

  const accrued = await db
    .select({ a: schema.payslips.gratuityAccrual })
    .from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(and(eq(schema.payslips.employeeId, s.s.employeeId), eq(schema.payrollRuns.status, "paid")));
  const provision = accrued.reduce((t, r) => t + r.a, 0);
  const fromProvision = Math.min(provision, s.s.gratuity);
  const earnings = s.s.pendingSalary + s.s.leaveEncashment + s.s.otherEarnings;
  const net = s.s.netPayable;

  await postJournal(ctx, {
    date,
    memo: `Final settlement — ${s.name}`,
    sourceType: "settlement",
    sourceId: s.s.id,
    lines: [
      { key: "salaries", debit: earnings },
      { key: "gratuity_provision", debit: fromProvision },
      { key: "gratuity_expense", debit: s.s.gratuity - fromProvision },
      { key: "advances", credit: s.s.loanRecovery },
      { key: "other_income", credit: s.s.otherDeductions },
      ...(net >= 0 ? [{ key: "bank", credit: net }] : [{ key: "bank", debit: -net }]),
    ],
  });
  if (s.s.loanRecovery > 0) {
    await db
      .update(schema.employeeLoans)
      .set({ balance: 0, status: "closed" })
      .where(and(eq(schema.employeeLoans.employeeId, s.s.employeeId), eq(schema.employeeLoans.status, "active")));
  }
  await db.update(schema.finalSettlements).set({ status: "paid", paidOn: date }).where(eq(schema.finalSettlements.id, s.s.id));
  await logActivity(ctx, { module: "payroll", entityType: "settlement", entityId: s.s.id, action: "paid", summary: `Paid final settlement for ${s.name}` });
  return null;
}

/* ───────────── Credit notes, recurring invoices, quotes ───────────── */

/**
 * Issue a credit note against a sent/partial/paid invoice for some quantity of its lines.
 * Dr sales returns + Dr output tax / Cr AR. With restock, product lines return to stock (Dr inventory / Cr COGS at original cost).
 */
export async function issueCreditNote(
  ctx: Ctx,
  invoiceId: number,
  input: { date: string; reason: string; restock: boolean; lines: { invoiceLineId: number; quantity: number }[] },
): Promise<{ error: string } | { id: number; number: string }> {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ctx.orgId)))
    .limit(1);
  if (!inv) return { error: "Invoice not found." };
  if (!["sent", "partial", "paid"].includes(inv.status)) return { error: "Credit notes can only be issued on sent invoices." };
  if (input.date < inv.issueDate) return { error: "Credit note date can't be before the invoice date." };

  const invLines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
  const prior = await db
    .select({ lineId: schema.creditNoteLines.invoiceLineId, qty: schema.creditNoteLines.quantity })
    .from(schema.creditNoteLines)
    .innerJoin(schema.creditNotes, eq(schema.creditNoteLines.creditNoteId, schema.creditNotes.id))
    .where(eq(schema.creditNotes.invoiceId, invoiceId));
  const creditedQty = new Map<number, number>();
  for (const p of prior) if (p.lineId) creditedQty.set(p.lineId, (creditedQty.get(p.lineId) ?? 0) + p.qty);

  const lines: (typeof schema.creditNoteLines.$inferInsert)[] = [];
  for (const req of input.lines) {
    if (!(req.quantity > 0)) continue;
    const l = invLines.find((x) => x.id === req.invoiceLineId);
    if (!l) return { error: "Unknown invoice line." };
    const left = l.quantity - (creditedQty.get(l.id) ?? 0);
    if (req.quantity > left + 1e-9) return { error: `Only ${left} of “${l.description}” can still be credited.` };
    const amount = Math.round(req.quantity * l.unitPrice);
    lines.push({
      orgId: ctx.orgId,
      creditNoteId: 0,
      invoiceLineId: l.id,
      productId: l.productId,
      description: l.description,
      quantity: req.quantity,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      taxCode: l.taxCode,
      amount,
      taxAmount: taxOf(amount, l.taxRate),
    });
  }
  if (!lines.length) return { error: "Choose at least one line to credit." };
  const subtotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const taxTotal = lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
  const total = subtotal + taxTotal;

  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.creditNotes).where(eq(schema.creditNotes.orgId, ctx.orgId));
  const number = `CN-${String(Number(n) + 1).padStart(4, "0")}`;
  const [cn] = await db
    .insert(schema.creditNotes)
    .values({ orgId: ctx.orgId, number, invoiceId, date: input.date, reason: input.reason, subtotal, taxTotal, total, restock: input.restock })
    .returning({ id: schema.creditNotes.id });
  await db.insert(schema.creditNoteLines).values(lines.map((l) => ({ ...l, creditNoteId: cn.id })));

  await postJournal(ctx, {
    date: input.date,
    memo: `Credit note ${number} against ${inv.number} — ${input.reason}`,
    sourceType: "credit_note",
    sourceId: cn.id,
    lines: [
      { key: "sales_returns", debit: subtotal },
      { key: "gst_out", debit: taxTotal },
      { key: "ar", credit: total },
    ],
  });

  if (input.restock) {
    const sales = await db
      .select()
      .from(schema.stockMovements)
      .where(and(eq(schema.stockMovements.orgId, ctx.orgId), eq(schema.stockMovements.sourceType, "invoice"), eq(schema.stockMovements.sourceId, invoiceId), eq(schema.stockMovements.type, "sale")));
    let cost = 0;
    for (const l of lines) {
      const sale = sales.find((m) => m.productId === l.productId);
      if (!sale || !l.productId) continue;
      cost += Math.round(l.quantity! * sale.unitCost);
      await moveStock(ctx, {
        productId: l.productId,
        warehouseId: sale.warehouseId,
        quantity: l.quantity!,
        type: "sale_return",
        unitCost: sale.unitCost,
        reference: number,
        sourceType: "credit_note",
        sourceId: cn.id,
        note: input.reason,
        post: false,
      });
    }
    if (cost > 0) {
      await postJournal(ctx, {
        date: input.date,
        memo: `Restocked goods — ${number}`,
        sourceType: "credit_note",
        sourceId: cn.id,
        lines: [
          { key: "inventory", debit: cost },
          { key: "cogs", credit: cost },
        ],
      });
    }
  }

  await refreshInvoicePaid(ctx, invoiceId);
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: invoiceId, action: "credited", summary: `Issued credit note ${number} on ${inv.number}` });
  return { id: cn.id, number };
}

/** Refund a customer's credit balance on an invoice (after credit notes/overpayment): Dr AR / Cr bank. */
export async function refundCustomer(ctx: Ctx, invoiceId: number, amount: number, date: string): Promise<string | null> {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, ctx.orgId)))
    .limit(1);
  if (!inv) return "Invoice not found.";
  const creditBalance = inv.amountPaid + inv.amountCredited - inv.total;
  if (amount <= 0 || amount > creditBalance) return "Refund can't exceed the customer's credit balance on this invoice.";
  await postJournal(ctx, {
    date,
    memo: `Refund to ${inv.customerName} — ${inv.number}`,
    sourceType: "payment",
    sourceId: null,
    lines: [
      { key: "ar", debit: amount },
      { key: "bank", credit: amount },
    ],
  });
  // Record as a negative payment so invoice balances stay consistent.
  await db.insert(schema.payments).values({ orgId: ctx.orgId, invoiceId, date, amount: -amount, method: "bank_transfer", reference: "Refund" });
  await refreshInvoicePaid(ctx, invoiceId);
  return null;
}

/** Create the next invoice from a recurring schedule and advance it. Returns the new invoice id (or null if not due). */
export async function generateRecurringInvoice(ctx: Ctx, recurringId: number, opts: { force?: boolean } = {}) {
  const [r] = await db
    .select()
    .from(schema.recurringInvoices)
    .where(and(eq(schema.recurringInvoices.id, recurringId), eq(schema.recurringInvoices.orgId, ctx.orgId)))
    .limit(1);
  if (!r || !r.active) return null;
  if (!opts.force && r.nextDate > today()) return null;
  if (r.endDate && r.nextDate > r.endDate) {
    await db.update(schema.recurringInvoices).set({ active: false }).where(eq(schema.recurringInvoices.id, r.id));
    return null;
  }
  const [tpl] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.templateInvoiceId)).limit(1);
  if (!tpl) return null;
  const tplLines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, tpl.id)).orderBy(schema.invoiceLines.sortOrder);
  const terms = Math.max(0, Math.round((Date.parse(`${tpl.dueDate}T00:00:00Z`) - Date.parse(`${tpl.issueDate}T00:00:00Z`)) / 86_400_000));
  const inv = await createDraftInvoice(
    ctx,
    {
      companyId: tpl.companyId,
      customerName: tpl.customerName,
      customerEmail: tpl.customerEmail,
      billingAddress: tpl.billingAddress,
      customerGstin: tpl.customerGstin,
      placeOfSupply: tpl.placeOfSupply,
      issueDate: r.nextDate,
      dueDate: plusDays(r.nextDate, terms),
      notes: tpl.notes,
    },
    tplLines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxCode: l.taxCode })),
  );
  if (r.autoSend) await sendInvoice(ctx, inv.id);
  const months = r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 3 : 12;
  const d = new Date(`${r.nextDate}T00:00:00Z`);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())).toISOString().slice(0, 10);
  await db.update(schema.recurringInvoices).set({ nextDate: next, lastGeneratedAt: new Date() }).where(eq(schema.recurringInvoices.id, r.id));
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: inv.id, action: "recurring", summary: `Generated ${inv.number} from a recurring schedule` });
  return inv.id;
}

/** Generate every due recurring invoice for a workspace (called lazily when Finance pages load). */
export async function runDueRecurring(ctx: Ctx) {
  const due = await db
    .select({ id: schema.recurringInvoices.id })
    .from(schema.recurringInvoices)
    .where(and(eq(schema.recurringInvoices.orgId, ctx.orgId), eq(schema.recurringInvoices.active, true), lte(schema.recurringInvoices.nextDate, today())));
  let made = 0;
  for (const r of due) {
    // Catch up at most 12 cycles per schedule.
    for (let i = 0; i < 12; i++) {
      const id = await generateRecurringInvoice(ctx, r.id);
      if (!id) break;
      made++;
    }
  }
  return made;
}

/** Convert an accepted (or sent) quote into a draft invoice; links the deal and marks it won. */
export async function convertQuoteToInvoice(ctx: Ctx, quoteId: number): Promise<{ error: string } | { invoiceId: number; number: string }> {
  const [q] = await db
    .select()
    .from(schema.quotes)
    .where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.orgId, ctx.orgId)))
    .limit(1);
  if (!q) return { error: "Quote not found." };
  if (q.invoiceId) return { error: "This quote was already invoiced." };
  if (!["sent", "accepted"].includes(q.status)) return { error: "Send or accept the quote before invoicing it." };
  const lines = await db.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, quoteId)).orderBy(schema.quoteLines.sortOrder);
  const [company] = q.companyId ? await db.select().from(schema.companies).where(eq(schema.companies.id, q.companyId)).limit(1) : [];
  const inv = await createDraftInvoice(
    ctx,
    {
      companyId: q.companyId,
      customerName: q.customerName,
      customerEmail: q.customerEmail,
      billingAddress: company?.billingAddress ?? null,
      customerGstin: company?.gstin ?? null,
      placeOfSupply: q.placeOfSupply ?? company?.state ?? null,
      dealId: q.dealId,
      notes: `Based on quote ${q.number}.${q.terms ? `\n${q.terms}` : ""}`,
    },
    lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: Math.round(l.unitPrice * (1 - l.discountPercent / 100)),
      taxRate: l.taxRate,
      taxCode: l.taxCode,
    })),
  );
  await db.update(schema.quotes).set({ status: "invoiced", invoiceId: inv.id }).where(eq(schema.quotes.id, q.id));
  if (q.dealId) {
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, q.dealId)).limit(1);
    if (deal && deal.stage !== "won") {
      await db
        .update(schema.deals)
        .set({ stage: "won", probability: 100, closedAt: new Date(), stageChangedAt: new Date(), invoiceId: deal.invoiceId ?? inv.id, value: deal.value || q.subtotal })
        .where(eq(schema.deals.id, deal.id));
      await onDealWon(ctx, deal.id);
    } else if (deal && !deal.invoiceId) {
      await db.update(schema.deals).set({ invoiceId: inv.id }).where(eq(schema.deals.id, deal.id));
    }
  }
  await logActivity(ctx, { module: "crm", entityType: "quote", entityId: q.id, action: "invoiced", summary: `Converted quote ${q.number} into invoice ${inv.number}` });
  return { invoiceId: inv.id, number: inv.number };
}

/* ───────────── Stock counts ───────────── */

/** Complete a stock count: every counted line with a variance becomes an adjustment (posted to stock adjustments). */
export async function completeStockCount(ctx: Ctx, countId: number): Promise<string | null> {
  const [sc] = await db
    .select()
    .from(schema.stockCounts)
    .where(and(eq(schema.stockCounts.id, countId), eq(schema.stockCounts.orgId, ctx.orgId)))
    .limit(1);
  if (!sc) return "Stock count not found.";
  if (sc.status !== "in_progress") return "This count is already closed.";
  const lines = await db.select().from(schema.stockCountLines).where(eq(schema.stockCountLines.countId, countId));
  let adjusted = 0;
  for (const l of lines) {
    if (l.countedQty === null) continue;
    const [lvl] = await db
      .select({ q: schema.stockLevels.quantity })
      .from(schema.stockLevels)
      .where(and(eq(schema.stockLevels.productId, l.productId), eq(schema.stockLevels.warehouseId, sc.warehouseId)))
      .limit(1);
    const variance = l.countedQty - (lvl?.q ?? 0);
    if (Math.abs(variance) < 1e-9) continue;
    adjusted++;
    await moveStock(ctx, {
      productId: l.productId,
      warehouseId: sc.warehouseId,
      quantity: variance,
      type: "adjustment",
      reference: sc.number,
      sourceType: "stock_count",
      sourceId: sc.id,
      note: `Stock count variance (counted ${l.countedQty})`,
    });
  }
  await db.update(schema.stockCounts).set({ status: "completed", completedAt: new Date() }).where(eq(schema.stockCounts.id, sc.id));
  await logActivity(ctx, { module: "inventory", entityType: "stock_count", entityId: sc.id, action: "completed", summary: `Completed stock count ${sc.number} (${adjusted} adjustment${adjusted === 1 ? "" : "s"})` });
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
  const auto = await automationsFor(ctx.orgId);
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
      [{ description: deal.title, quantity: 1, unitPrice: deal.value, ...(await defaultTax(ctx.orgId)) }],
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
  const tax = await defaultTax(ctx.orgId);

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
      ...tax,
    })),
  );
  await db
    .update(schema.timeEntries)
    .set({ invoiceId: inv.id })
    .where(inArray(schema.timeEntries.id, entries.map((x) => x.e.id)));
  await logActivity(ctx, { module: "projects", entityType: "project", entityId: projectId, action: "invoiced", summary: `Billed ${entries.length} time entries on ${project.code} → ${inv.number}` });
  return { invoiceId: inv.id, number: inv.number };
}
