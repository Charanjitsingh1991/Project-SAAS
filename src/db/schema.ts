import { sql } from "drizzle-orm";
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/*
 * Conventions:
 * - Every business table has org_id (cascade delete with the workspace).
 * - Money columns are INTEGER minor units (paise / cents).
 * - Calendar dates are TEXT "YYYY-MM-DD"; instants are INTEGER unix seconds (mode: "timestamp").
 */

const id = () => integer("id").primaryKey({ autoIncrement: true });
const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);
const orgId = () =>
  integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const money = (name: string) => integer(name).notNull().default(0);

/* ═════════════ Accounts & tenancy ═════════════ */

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  company: text("company"),
  phone: text("phone"), // E.164, e.g. +971501234567
  passwordHash: text("password_hash").notNull(),
  /** Sessions issued before this moment are rejected (set on password change/reset). */
  passwordChangedAt: integer("password_changed_at", { mode: "timestamp" }),
  createdAt: createdAt(),
});

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  /** Public slug for the support portal (/support/[slug]). */
  slug: text("slug").notNull().unique(),
  /** ISO country code of the workspace; drives tax, payroll, leave, holidays and formats (see lib/countries). */
  country: text("country", { enum: ["IN", "AE"] }).notNull().default("IN"),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  currency: text("currency").notNull().default("INR"),
  /** Workspace state/region — decides CGST+SGST vs IGST on invoices. */
  state: text("state"),
  gstin: text("gstin"),
  address: text("address"),
  /** JSON object of automation toggles; see lib/automations.ts for keys/defaults. */
  automations: text("automations").notNull().default("{}"),
  /** JSON array of enabled module keys; null = every module the plan allows. */
  enabledModules: text("enabled_modules"),
  /** JSON array of weekend weekdays (0 = Sunday … 6 = Saturday). */
  weekendDays: text("weekend_days").notNull().default("[0,6]"),
  /** Month (1–12) the fiscal year starts. */
  fiscalYearStart: integer("fiscal_year_start").notNull().default(4),
  /** JSON object of country-specific employer IDs (e.g. MOHRE establishment ID, WPS routing code, TAN, EPF code). */
  statutory: text("statutory").notNull().default("{}"),
  ownerId: integer("owner_id").notNull(),
  plan: text("plan", { enum: ["starter", "growth", "enterprise"] }).notNull().default("growth"),
  trialStartedAt: integer("trial_started_at", { mode: "timestamp" }).notNull(),
  /** Exact instant access ends if unpaid: 00:00 (APP_TIMEZONE) at the start of day 15. */
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  billingInterval: text("billing_interval", { enum: ["month", "year"] }),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  cardBrand: text("card_brand"),
  cardLast4: text("card_last4"),
  cardExpMonth: integer("card_exp_month"),
  cardExpYear: integer("card_exp_year"),
  createdAt: createdAt(),
});

export const ROLES = ["owner", "admin", "hr", "sales", "finance", "member"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = sqliteTable(
  "memberships",
  {
    id: id(),
    orgId: orgId(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("membership_org_user").on(t.orgId, t.userId)],
);

export const invites = sqliteTable("invites", {
  id: id(),
  orgId: orgId(),
  email: text("email").notNull(),
  role: text("role", { enum: ROLES }).notNull(),
  token: text("token").notNull().unique(),
  invitedBy: integer("invited_by").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp" }),
  createdAt: createdAt(),
});

/** Per-workspace document number counters (INV, PO, TCK, EMP, PRJ). */
export const sequences = sqliteTable(
  "sequences",
  {
    id: id(),
    orgId: orgId(),
    key: text("key").notNull(),
    next: integer("next").notNull(),
  },
  (t) => [uniqueIndex("sequence_org_key").on(t.orgId, t.key)],
);

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: id(),
    orgId: orgId(),
    actorId: integer("actor_id"), // null = system/automation
    module: text("module").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_org_time").on(t.orgId, t.createdAt), index("activity_entity").on(t.orgId, t.entityType, t.entityId)],
);

/* ═════════════ Marketing site ═════════════ */

export const enquiries = sqliteTable("enquiries", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  teamSize: text("team_size"),
  interest: text("interest"),
  message: text("message").notNull(),
  status: text("status", { enum: ["new", "contacted", "closed"] })
    .notNull()
    .default("new"),
  createdAt: createdAt(),
});

/* ═════════════ HRM ═════════════ */

export const departments = sqliteTable(
  "departments",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    headEmployeeId: integer("head_employee_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("department_org_name").on(t.orgId, t.name)],
);

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export const EMPLOYEE_STATUSES = ["active", "notice", "exited"] as const;

export const employees = sqliteTable(
  "employees",
  {
    id: id(),
    orgId: orgId(),
    code: text("code").notNull(), // EMP-0001
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    gender: text("gender", { enum: ["male", "female", "other", "undisclosed"] }).notNull().default("undisclosed"),
    dob: text("dob"),
    address: text("address"),
    departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
    designation: text("designation").notNull(),
    managerId: integer("manager_id"),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES }).notNull().default("full_time"),
    workLocation: text("work_location"),
    joinDate: text("join_date").notNull(),
    probationEndDate: text("probation_end_date"),
    status: text("status", { enum: EMPLOYEE_STATUSES }).notNull().default("active"),
    exitDate: text("exit_date"),
    exitReason: text("exit_reason"),
    /** Annual cost-to-company (IN) / annual gross package (AE), minor units. */
    annualCtc: money("annual_ctc"),
    /** Optional monthly component override JSON, e.g. {"basic":900000,"housing":375000,"transport":150000,"other":75000} (minor units). */
    salaryComponents: text("salary_components"),
    pfEnrolled: integer("pf_enrolled", { mode: "boolean" }).notNull().default(true),
    metro: integer("metro", { mode: "boolean" }).notNull().default(true),
    pan: text("pan"),
    uan: text("uan"),
    bankAccount: text("bank_account"),
    ifsc: text("ifsc"),
    nationality: text("nationality"), // ISO country code, e.g. "AE", "IN"
    passportNumber: text("passport_number"),
    passportExpiry: text("passport_expiry"),
    visaNumber: text("visa_number"),
    visaExpiry: text("visa_expiry"),
    emiratesId: text("emirates_id"),
    emiratesIdExpiry: text("emirates_id_expiry"),
    labourCardNumber: text("labour_card_number"),
    wpsPersonId: text("wps_person_id"), // MOHRE 14-digit person ID
    iban: text("iban"),
    bankName: text("bank_name"),
    bankRoutingCode: text("bank_routing_code"),
    createdAt: createdAt(),
  },
  (t) => [index("employees_org").on(t.orgId), uniqueIndex("employee_org_code").on(t.orgId, t.code)],
);

export const onboardingTasks = sqliteTable(
  "onboarding_tasks",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["onboarding", "offboarding"] }).notNull(),
    title: text("title").notNull(),
    dueDate: text("due_date"),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("onboarding_emp").on(t.employeeId)],
);

export const holidays = sqliteTable(
  "holidays",
  {
    id: id(),
    orgId: orgId(),
    date: text("date").notNull(),
    name: text("name").notNull(),
    optional: integer("optional", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("holiday_org_date").on(t.orgId, t.date)],
);

export const leaveTypes = sqliteTable("leave_types", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  annualQuota: real("annual_quota").notNull().default(0),
  paid: integer("paid", { mode: "boolean" }).notNull().default(true),
  /** Share of salary paid on this leave: 100 full, 50 half-pay (0.5 LOP per day), 0 unpaid. */
  payPercent: integer("pay_percent").notNull().default(100),
  appliesTo: text("applies_to", { enum: ["all", "female", "male"] }).notNull().default("all"),
  color: text("color").notNull().default("mint"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const leaveRequests = sqliteTable(
  "leave_requests",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    halfDay: integer("half_day", { mode: "boolean" }).notNull().default(false),
    days: real("days").notNull(), // working days, computed on submit
    reason: text("reason"),
    status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] }).notNull().default("pending"),
    decidedBy: integer("decided_by"),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("leave_org").on(t.orgId), index("leave_emp").on(t.employeeId)],
);

export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "leave", "holiday", "wfh"] as const;

export const attendance = sqliteTable(
  "attendance",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull(),
    checkIn: text("check_in"), // HH:MM
    checkOut: text("check_out"),
    note: text("note"),
    /** Set when the row was created by an approved leave request. */
    leaveRequestId: integer("leave_request_id"),
  },
  (t) => [uniqueIndex("attendance_emp_date").on(t.employeeId, t.date), index("attendance_org_date").on(t.orgId, t.date)],
);

/* ═════════════ Payroll ═════════════ */

export const payrollRuns = sqliteTable(
  "payroll_runs",
  {
    id: id(),
    orgId: orgId(),
    period: text("period").notNull(), // YYYY-MM
    status: text("status", { enum: ["draft", "approved", "paid"] }).notNull().default("draft"),
    daysInMonth: integer("days_in_month").notNull(),
    employeeCount: integer("employee_count").notNull().default(0),
    totalGross: money("total_gross"),
    totalDeductions: money("total_deductions"),
    totalNet: money("total_net"),
    totalEmployerCost: money("total_employer_cost"),
    approvedBy: integer("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    paymentDate: text("payment_date"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_org_period").on(t.orgId, t.period)],
);

export const payslips = sqliteTable(
  "payslips",
  {
    id: id(),
    orgId: orgId(),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    employeeName: text("employee_name").notNull(),
    employeeCode: text("employee_code").notNull(),
    designation: text("designation"),
    department: text("department"),
    paidDays: real("paid_days").notNull(),
    lopDays: real("lop_days").notNull().default(0),
    basic: money("basic"),
    hra: money("hra"),
    special: money("special"),
    bonus: money("bonus"),
    otherEarnings: money("other_earnings"),
    gross: money("gross"),
    pfEmployee: money("pf_employee"),
    esiEmployee: money("esi_employee"),
    professionalTax: money("professional_tax"),
    tds: money("tds"),
    otherDeductions: money("other_deductions"),
    totalDeductions: money("total_deductions"),
    net: money("net"),
    pfEmployer: money("pf_employer"),
    esiEmployer: money("esi_employer"),
    transport: money("transport"),
    reimbursements: money("reimbursements"),
    loanDeduction: money("loan_deduction"),
    pensionEmployee: money("pension_employee"),
    pensionEmployer: money("pension_employer"),
    gratuityAccrual: money("gratuity_accrual"),
    employerCost: money("employer_cost"),
    /** Country engine output: {"earnings":[{code,label,amount}],"deductions":[{code,label,amount,account}],"employer":[{code,label,amount,expenseAccount,liabilityAccount}]} */
    breakdown: text("breakdown"),
    note: text("note"),
  },
  (t) => [index("payslips_run").on(t.runId), index("payslips_emp").on(t.employeeId)],
);

/* ═════════════ CRM ═════════════ */

export const companies = sqliteTable(
  "companies",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    industry: text("industry"),
    website: text("website"),
    phone: text("phone"),
    gstin: text("gstin"),
    billingAddress: text("billing_address"),
    city: text("city"),
    state: text("state"),
    country: text("country").default("India"),
    ownerId: integer("owner_id"),
    createdAt: createdAt(),
  },
  (t) => [index("companies_org").on(t.orgId)],
);

export const LIFECYCLES = ["lead", "prospect", "customer", "churned"] as const;
export const LEAD_SOURCES = ["website", "referral", "outbound", "event", "partner", "other"] as const;

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    orgId: orgId(),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    ownerId: integer("owner_id"),
    lifecycle: text("lifecycle", { enum: LIFECYCLES }).notNull().default("lead"),
    source: text("source", { enum: LEAD_SOURCES }).notNull().default("other"),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_org").on(t.orgId), index("contacts_email").on(t.orgId, t.email)],
);

export const DEAL_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const STAGE_PROBABILITY: Record<DealStage, number> = { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };

export const deals = sqliteTable(
  "deals",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ownerId: integer("owner_id"),
    value: money("value"),
    stage: text("stage", { enum: DEAL_STAGES }).notNull().default("lead"),
    probability: integer("probability").notNull().default(10),
    source: text("source", { enum: LEAD_SOURCES }).notNull().default("other"),
    expectedClose: text("expected_close"),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    lostReason: text("lost_reason"),
    stageChangedAt: integer("stage_changed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    invoiceId: integer("invoice_id"),
    projectId: integer("project_id"),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("deals_org").on(t.orgId), index("deals_stage").on(t.orgId, t.stage)],
);

export const ACTIVITY_TYPES = ["note", "call", "meeting", "email", "task"] as const;

export const crmActivities = sqliteTable(
  "crm_activities",
  {
    id: id(),
    orgId: orgId(),
    dealId: integer("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
    type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    dueDate: text("due_date"),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    ownerId: integer("owner_id"),
    createdAt: createdAt(),
  },
  (t) => [index("crm_act_org").on(t.orgId), index("crm_act_deal").on(t.dealId)],
);

/* ═════════════ Finance & accounting ═════════════ */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    orgId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    /** Stable key used by automatic postings (e.g. "ar", "bank", "sales", "rent"). */
    systemKey: text("system_key"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("account_org_code").on(t.orgId, t.code), index("account_org_key").on(t.orgId, t.systemKey)],
);

export const SOURCE_TYPES = ["invoice", "payment", "expense", "bill_payment", "payroll", "stock", "manual", "reversal", "credit_note", "claim", "loan", "settlement", "stock_count"] as const;

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: id(),
    orgId: orgId(),
    date: text("date").notNull(),
    memo: text("memo").notNull(),
    sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull(),
    sourceId: integer("source_id"),
    reversed: integer("reversed", { mode: "boolean" }).notNull().default(false),
    createdBy: integer("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("je_org_date").on(t.orgId, t.date), index("je_source").on(t.orgId, t.sourceType, t.sourceId)],
);

export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: id(),
    orgId: orgId(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    debit: money("debit"),
    credit: money("credit"),
  },
  (t) => [index("jl_entry").on(t.entryId), index("jl_account").on(t.orgId, t.accountId)],
);

export const vendors = sqliteTable(
  "vendors",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    gstin: text("gstin"),
    address: text("address"),
    createdAt: createdAt(),
  },
  (t) => [index("vendors_org").on(t.orgId)],
);

export const INVOICE_STATUSES = ["draft", "sent", "partial", "paid", "void"] as const;

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    billingAddress: text("billing_address"),
    customerGstin: text("customer_gstin"),
    placeOfSupply: text("place_of_supply"),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
    subtotal: money("subtotal"),
    taxTotal: money("tax_total"),
    total: money("total"),
    amountPaid: money("amount_paid"),
    /** Sum of credit notes issued against this invoice. Balance due = total − amountPaid − amountCredited. */
    amountCredited: money("amount_credited"),
    notes: text("notes"),
    dealId: integer("deal_id"),
    projectId: integer("project_id"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoice_org_number").on(t.orgId, t.number), index("invoices_org_status").on(t.orgId, t.status)],
);

export const invoiceLines = sqliteTable(
  "invoice_lines",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    productId: integer("product_id"),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitPrice: money("unit_price"),
    taxRate: real("tax_rate").notNull().default(0), // percent
    /** Country tax code, e.g. "SR"/"ZR"/"EX" (UAE VAT) or "GST18"/"EXEMPT" (India). Drives return boxes. */
    taxCode: text("tax_code"),
    amount: money("amount"), // quantity × unitPrice (excl. tax)
    taxAmount: money("tax_amount"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("invoice_lines_inv").on(t.invoiceId)],
);

export const PAYMENT_METHODS = ["bank_transfer", "upi", "card", "cash", "cheque"] as const;

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    amount: money("amount"),
    method: text("method", { enum: PAYMENT_METHODS }).notNull().default("bank_transfer"),
    reference: text("reference"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_inv").on(t.invoiceId)],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: id(),
    orgId: orgId(),
    date: text("date").notNull(),
    vendorId: integer("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    /** Account system key of the expense category, e.g. "rent", "software", "inventory", "salaries". */
    category: text("category").notNull(),
    amount: money("amount"), // excl. tax
    taxAmount: money("tax_amount"),
    total: money("total"),
    status: text("status", { enum: ["paid", "unpaid"] }).notNull().default("paid"),
    dueDate: text("due_date"),
    paidDate: text("paid_date"),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }),
    reference: text("reference"),
    sourceType: text("source_type", { enum: ["manual", "payroll", "purchase_order"] }).notNull().default("manual"),
    sourceId: integer("source_id"),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_org_date").on(t.orgId, t.date)],
);

/* ═════════════ Inventory & purchasing ═════════════ */

export const warehouses = sqliteTable(
  "warehouses",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("warehouse_org_code").on(t.orgId, t.code)],
);

export const UNITS = ["pcs", "box", "kg", "g", "l", "ml", "m", "hr"] as const;

export const products = sqliteTable(
  "products",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    category: text("category"),
    unit: text("unit", { enum: UNITS }).notNull().default("pcs"),
    costPrice: money("cost_price"), // weighted average
    sellingPrice: money("selling_price"),
    taxRate: real("tax_rate").notNull().default(18),
    reorderLevel: real("reorder_level").notNull().default(0),
    reorderQty: real("reorder_qty").notNull().default(0),
    preferredVendorId: integer("preferred_vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    trackStock: integer("track_stock", { mode: "boolean" }).notNull().default(true),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("product_org_sku").on(t.orgId, t.sku), index("products_org").on(t.orgId)],
);

export const stockLevels = sqliteTable(
  "stock_levels",
  {
    id: id(),
    orgId: orgId(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    quantity: real("quantity").notNull().default(0),
  },
  (t) => [uniqueIndex("stock_product_wh").on(t.productId, t.warehouseId)],
);

export const MOVEMENT_TYPES = ["opening", "receipt", "issue", "sale", "transfer_in", "transfer_out", "adjustment", "sale_return"] as const;

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: id(),
    orgId: orgId(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    type: text("type", { enum: MOVEMENT_TYPES }).notNull(),
    quantity: real("quantity").notNull(), // signed
    unitCost: money("unit_cost"),
    reference: text("reference"), // e.g. PO-0003, INV-1004
    sourceType: text("source_type"), // "invoice" | "purchase_order" | "manual" | "transfer"
    sourceId: integer("source_id"),
    note: text("note"),
    createdBy: integer("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("stock_mv_org").on(t.orgId, t.createdAt), index("stock_mv_product").on(t.productId)],
);

export const PO_STATUSES = ["draft", "ordered", "received", "cancelled"] as const;

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendors.id),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: text("status", { enum: PO_STATUSES }).notNull().default("draft"),
    orderDate: text("order_date").notNull(),
    expectedDate: text("expected_date"),
    subtotal: money("subtotal"),
    taxTotal: money("tax_total"),
    total: money("total"),
    notes: text("notes"),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    expenseId: integer("expense_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("po_org_number").on(t.orgId, t.number)],
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: id(),
    orgId: orgId(),
    poId: integer("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: real("quantity").notNull(),
    unitCost: money("unit_cost"),
    taxRate: real("tax_rate").notNull().default(0),
    amount: money("amount"),
    taxAmount: money("tax_amount"),
  },
  (t) => [index("po_lines_po").on(t.poId)],
);

/* ═════════════ Projects ═════════════ */

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "done", "cancelled"] as const;
export const BILLING_TYPES = ["fixed", "hourly", "non_billable"] as const;

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    orgId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    description: text("description"),
    ownerId: integer("owner_id"),
    color: text("color").notNull().default("lilac"),
    billingType: text("billing_type", { enum: BILLING_TYPES }).notNull().default("fixed"),
    budget: money("budget"),
    hourlyRate: money("hourly_rate"),
    startDate: text("start_date"),
    dueDate: text("due_date"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("planning"),
    createdAt: createdAt(),
  },
  (t) => [index("projects_org").on(t.orgId)],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: id(),
    orgId: orgId(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: text("due_date"),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("milestones_project").on(t.projectId)],
);

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "review", "done"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    orgId: orgId(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: integer("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: integer("assignee_id").references(() => employees.id, { onDelete: "set null" }),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    startDate: text("start_date"),
    dueDate: text("due_date"),
    estimateHours: real("estimate_hours"),
    sortOrder: real("sort_order").notNull().default(0),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_project").on(t.projectId), index("tasks_org").on(t.orgId)],
);

export const taskComments = sqliteTable(
  "task_comments",
  {
    id: id(),
    orgId: orgId(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: integer("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("task_comments_task").on(t.taskId)],
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: id(),
    orgId: orgId(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    hours: real("hours").notNull(),
    description: text("description"),
    billable: integer("billable", { mode: "boolean" }).notNull().default(true),
    invoiceId: integer("invoice_id"),
    createdAt: createdAt(),
  },
  (t) => [index("time_project").on(t.projectId), index("time_emp_date").on(t.employeeId, t.date)],
);

/* ═════════════ Helpdesk ═════════════ */

export const TICKET_STATUSES = ["open", "pending", "on_hold", "resolved", "closed"] as const;
export const TICKET_CHANNELS = ["email", "phone", "chat", "whatsapp", "web", "portal"] as const;

export const tickets = sqliteTable(
  "tickets",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(),
    subject: text("subject").notNull(),
    description: text("description"),
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email").notNull(),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    channel: text("channel", { enum: TICKET_CHANNELS }).notNull().default("email"),
    category: text("category"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("open"),
    assigneeId: integer("assignee_id"),
    firstResponseDueAt: integer("first_response_due_at", { mode: "timestamp" }),
    resolutionDueAt: integer("resolution_due_at", { mode: "timestamp" }),
    firstRespondedAt: integer("first_responded_at", { mode: "timestamp" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    csatRating: integer("csat_rating"),
    csatComment: text("csat_comment"),
    publicToken: text("public_token").notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("ticket_org_number").on(t.orgId, t.number), uniqueIndex("ticket_token").on(t.publicToken), index("tickets_org_status").on(t.orgId, t.status)],
);

export const ticketMessages = sqliteTable(
  "ticket_messages",
  {
    id: id(),
    orgId: orgId(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: ["agent", "requester", "system"] }).notNull(),
    authorId: integer("author_id"),
    body: text("body").notNull(),
    internal: integer("internal", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_msgs").on(t.ticketId)],
);

export const slaPolicies = sqliteTable(
  "sla_policies",
  {
    id: id(),
    orgId: orgId(),
    priority: text("priority", { enum: PRIORITIES }).notNull(),
    firstResponseMins: integer("first_response_mins").notNull(),
    resolutionMins: integer("resolution_mins").notNull(),
  },
  (t) => [uniqueIndex("sla_org_priority").on(t.orgId, t.priority)],
);

export const cannedResponses = sqliteTable("canned_responses", {
  id: id(),
  orgId: orgId(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const kbArticles = sqliteTable(
  "kb_articles",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    category: text("category").notNull().default("General"),
    body: text("body").notNull(),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    views: integer("views").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("kb_org_slug").on(t.orgId, t.slug)],
);


/* ═════════════ HRM: documents, recruitment, performance, claims ═════════════ */

export const DOCUMENT_TYPES = ["passport", "visa", "emirates_id", "labour_card", "pan", "aadhaar", "driving_licence", "contract", "certificate", "other"] as const;

export const employeeDocuments = sqliteTable(
  "employee_documents",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: DOCUMENT_TYPES }).notNull(),
    number: text("number"),
    issueDate: text("issue_date"),
    expiryDate: text("expiry_date"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("emp_docs_emp").on(t.employeeId), index("emp_docs_expiry").on(t.orgId, t.expiryDate)],
);

export const JOB_STATUSES = ["draft", "open", "on_hold", "closed"] as const;

export const jobOpenings = sqliteTable(
  "job_openings",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
    location: text("location"),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES }).notNull().default("full_time"),
    openings: integer("openings").notNull().default(1),
    salaryMin: money("salary_min"),
    salaryMax: money("salary_max"),
    description: text("description"),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("open"),
    hiringManagerId: integer("hiring_manager_id"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_org").on(t.orgId)],
);

export const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;

export const candidates = sqliteTable(
  "candidates",
  {
    id: id(),
    orgId: orgId(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobOpenings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    source: text("source").notNull().default("other"),
    stage: text("stage", { enum: CANDIDATE_STAGES }).notNull().default("applied"),
    rating: integer("rating"), // 1–5
    expectedSalary: money("expected_salary"),
    currentCompany: text("current_company"),
    noticePeriodDays: integer("notice_period_days"),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    employeeId: integer("employee_id"), // set when hired
    sortOrder: real("sort_order").notNull().default(0),
    stageChangedAt: integer("stage_changed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: createdAt(),
  },
  (t) => [index("candidates_job").on(t.jobId), index("candidates_org").on(t.orgId)],
);

export const goals = sqliteTable(
  "goals",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    cycle: text("cycle").notNull(), // e.g. "2026-H2"
    dueDate: text("due_date"),
    progress: integer("progress").notNull().default(0), // 0–100
    weight: integer("weight").notNull().default(1),
    status: text("status", { enum: ["on_track", "at_risk", "off_track", "done"] }).notNull().default("on_track"),
    createdAt: createdAt(),
  },
  (t) => [index("goals_emp").on(t.employeeId)],
);

export const performanceReviews = sqliteTable(
  "performance_reviews",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    reviewerId: integer("reviewer_id").references(() => employees.id, { onDelete: "set null" }),
    cycle: text("cycle").notNull(),
    selfRating: integer("self_rating"),
    selfComments: text("self_comments"),
    managerRating: integer("manager_rating"),
    strengths: text("strengths"),
    improvements: text("improvements"),
    status: text("status", { enum: ["self_review", "manager_review", "completed"] }).notNull().default("self_review"),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("review_emp_cycle").on(t.employeeId, t.cycle)],
);

export const CLAIM_STATUSES = ["submitted", "approved", "rejected", "reimbursed"] as const;

export const expenseClaims = sqliteTable(
  "expense_claims",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    /** Expense account system key (travel, supplies, software, …). */
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: money("amount"), // excl. tax
    taxAmount: money("tax_amount"),
    total: money("total"),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("submitted"),
    /** "payroll" = paid with the next payroll run; "direct" = paid from bank on approval. */
    reimburseVia: text("reimburse_via", { enum: ["payroll", "direct"] }).notNull().default("payroll"),
    decidedBy: integer("decided_by"),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    rejectionReason: text("rejection_reason"),
    payslipId: integer("payslip_id"),
    reimbursedAt: integer("reimbursed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("claims_org_status").on(t.orgId, t.status), index("claims_emp").on(t.employeeId)],
);

/* ═════════════ Payroll: loans & final settlement ═════════════ */

export const employeeLoans = sqliteTable(
  "employee_loans",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["loan", "advance"] }).notNull().default("advance"),
    principal: money("principal"),
    monthlyInstallment: money("monthly_installment"),
    balance: money("balance"),
    disbursedOn: text("disbursed_on").notNull(),
    startPeriod: text("start_period").notNull(), // YYYY-MM of first deduction
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("loans_emp").on(t.employeeId)],
);

export const finalSettlements = sqliteTable(
  "final_settlements",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    exitDate: text("exit_date").notNull(),
    serviceDays: integer("service_days").notNull(),
    pendingSalary: money("pending_salary"),
    leaveEncashmentDays: real("leave_encashment_days").notNull().default(0),
    leaveEncashment: money("leave_encashment"),
    gratuity: money("gratuity"),
    otherEarnings: money("other_earnings"),
    loanRecovery: money("loan_recovery"),
    otherDeductions: money("other_deductions"),
    netPayable: money("net_payable"),
    breakdown: text("breakdown"), // JSON explanation lines
    status: text("status", { enum: ["draft", "paid"] }).notNull().default("draft"),
    paidOn: text("paid_on"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("settlement_emp").on(t.employeeId)],
);

/* ═════════════ CRM: quotes & web forms ═════════════ */

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired", "invoiced"] as const;

export const quotes = sqliteTable(
  "quotes",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(), // QT-0001
    dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    placeOfSupply: text("place_of_supply"),
    issueDate: text("issue_date").notNull(),
    validUntil: text("valid_until").notNull(),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    subtotal: money("subtotal"),
    taxTotal: money("tax_total"),
    total: money("total"),
    terms: text("terms"),
    invoiceId: integer("invoice_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quote_org_number").on(t.orgId, t.number)],
);

export const quoteLines = sqliteTable(
  "quote_lines",
  {
    id: id(),
    orgId: orgId(),
    quoteId: integer("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    productId: integer("product_id"),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitPrice: money("unit_price"),
    discountPercent: real("discount_percent").notNull().default(0),
    taxRate: real("tax_rate").notNull().default(0),
    taxCode: text("tax_code"),
    amount: money("amount"), // after discount, excl. tax
    taxAmount: money("tax_amount"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("quote_lines_q").on(t.quoteId)],
);

/* ═════════════ Finance: credit notes, recurring, bank reconciliation ═════════════ */

export const creditNotes = sqliteTable(
  "credit_notes",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(), // CN-0001
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    date: text("date").notNull(),
    reason: text("reason").notNull(),
    subtotal: money("subtotal"),
    taxTotal: money("tax_total"),
    total: money("total"),
    restock: integer("restock", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cn_org_number").on(t.orgId, t.number)],
);

export const creditNoteLines = sqliteTable(
  "credit_note_lines",
  {
    id: id(),
    orgId: orgId(),
    creditNoteId: integer("credit_note_id")
      .notNull()
      .references(() => creditNotes.id, { onDelete: "cascade" }),
    invoiceLineId: integer("invoice_line_id"),
    productId: integer("product_id"),
    description: text("description").notNull(),
    quantity: real("quantity").notNull(),
    unitPrice: money("unit_price"),
    taxRate: real("tax_rate").notNull().default(0),
    taxCode: text("tax_code"),
    amount: money("amount"),
    taxAmount: money("tax_amount"),
  },
  (t) => [index("cn_lines_cn").on(t.creditNoteId)],
);

export const recurringInvoices = sqliteTable(
  "recurring_invoices",
  {
    id: id(),
    orgId: orgId(),
    /** Source invoice whose header and lines are copied each cycle. */
    templateInvoiceId: integer("template_invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    frequency: text("frequency", { enum: ["monthly", "quarterly", "yearly"] }).notNull().default("monthly"),
    nextDate: text("next_date").notNull(),
    endDate: text("end_date"),
    autoSend: integer("auto_send", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastGeneratedAt: integer("last_generated_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_org").on(t.orgId)],
);

export const bankStatementLines = sqliteTable(
  "bank_statement_lines",
  {
    id: id(),
    orgId: orgId(),
    date: text("date").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    amount: money("amount"), // signed: + money in, − money out
    /** Matched journal entry (payment, bill payment, expense, payroll…). */
    journalEntryId: integer("journal_entry_id"),
    status: text("status", { enum: ["unmatched", "matched", "ignored"] }).notNull().default("unmatched"),
    importBatch: text("import_batch"),
    createdAt: createdAt(),
  },
  (t) => [index("bank_lines_org").on(t.orgId, t.status)],
);

/* ═════════════ Inventory: stock counts ═════════════ */

export const stockCounts = sqliteTable(
  "stock_counts",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(), // SC-0001
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: text("status", { enum: ["in_progress", "completed", "cancelled"] }).notNull().default("in_progress"),
    note: text("note"),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sc_org_number").on(t.orgId, t.number)],
);

export const stockCountLines = sqliteTable(
  "stock_count_lines",
  {
    id: id(),
    orgId: orgId(),
    countId: integer("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    expectedQty: real("expected_qty").notNull(),
    countedQty: real("counted_qty"),
  },
  (t) => [uniqueIndex("sc_line_product").on(t.countId, t.productId)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Product = typeof products.$inferSelect;

// --- Assets ---

export const companyAssets = sqliteTable(
  "company_assets",
  {
    id: id(),
    orgId: orgId(),
    tag: text("tag").notNull(), // AST-0001
    name: text("name").notNull(),
    category: text("category", { enum: ["laptop", "phone", "vehicle", "furniture", "other"] }).notNull().default("other"),
    serialNumber: text("serial_number"),
    purchaseDate: text("purchase_date"),
    purchaseCost: money("purchase_cost"),
    warrantyExpiry: text("warranty_expiry"),
    status: text("status", { enum: ["available", "assigned", "in_repair", "retired"] }).notNull().default("available"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("company_asset_org_tag").on(t.orgId, t.tag), index("company_asset_org_status").on(t.orgId, t.status)],
);

export const assetAssignments = sqliteTable(
  "asset_assignments",
  {
    id: id(),
    orgId: orgId(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => companyAssets.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    assignedDate: text("assigned_date").notNull(),
    returnedDate: text("returned_date"),
    returnCondition: text("return_condition"),
    createdAt: createdAt(),
  },
  (t) => [
    index("asset_assign_asset").on(t.assetId),
    index("asset_assign_employee").on(t.orgId, t.employeeId),
    uniqueIndex("asset_assign_open").on(t.assetId).where(sql`returned_date is null`),
  ],
);

// --- Helpdesk round-robin ---
export const helpdeskAssignment = sqliteTable(
  "helpdesk_assignment",
  {
    id: id(),
    orgId: orgId(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    memberUserIds: text("member_user_ids").notNull().default("[]"),
    lastAssignedUserId: integer("last_assigned_user_id"),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("helpdesk_assignment_org").on(t.orgId)],
);

// --- Employee documents ---
// Uploaded file vault (bytes in a BLOB); distinct from the employeeDocuments expiry-metadata table.
export const EMPLOYEE_DOC_TYPES = ["passport", "visa", "national_id", "tax_id", "contract", "certificate", "other"] as const;

export const employeeFiles = sqliteTable(
  "employee_files",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    docType: text("doc_type", { enum: EMPLOYEE_DOC_TYPES }).notNull().default("other"),
    title: text("title"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    expiryDate: text("expiry_date"),
    data: blob("data", { mode: "buffer" }).notNull(),
    uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("employee_files_emp_idx").on(t.orgId, t.employeeId)],
);

// --- Password resets ---
/** One-time reset links; only a SHA-256 hash of the token is stored. */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: id(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user").on(t.userId)],
);

// --- Attendance regularisation ---
export const REGULARIZATION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

/** Employee request to correct a day's attendance; approval writes the attendance row. */
export const attendanceRegularizations = sqliteTable(
  "attendance_regularizations",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    requestedStatus: text("requested_status", { enum: ATTENDANCE_STATUSES }).notNull().default("present"),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    reason: text("reason").notNull(),
    status: text("status", { enum: REGULARIZATION_STATUSES }).notNull().default("pending"),
    decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [index("att_reg_org_status").on(t.orgId, t.status), index("att_reg_emp").on(t.employeeId, t.date)],
);

// --- Announcements ---
export const announcements = sqliteTable(
  "announcements",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /** Hidden from feeds after this date (YYYY-MM-DD); null = no expiry. */
    expiresOn: text("expires_on"),
    postedBy: integer("posted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("announcements_org").on(t.orgId, t.createdAt)],
);

// --- HR letters ---
export const LETTER_KINDS = ["offer", "appointment", "experience", "relieving", "salary_certificate", "noc"] as const;

/** Issued HR letters; the rendered text is frozen at issue time. */
export const hrLetters = sqliteTable(
  "hr_letters",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LETTER_KINDS }).notNull(),
    number: text("number").notNull(),
    issuedOn: text("issued_on").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    issuedBy: integer("issued_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("hr_letters_emp").on(t.orgId, t.employeeId), uniqueIndex("hr_letters_org_number").on(t.orgId, t.number)],
);

/* ═════════════ Integrations ═════════════ */

// --- Outgoing webhooks (Zapier, Make, n8n, custom) and chat notifications (Slack, Teams, Google Chat) ---
export const WEBHOOK_KINDS = ["webhook", "slack", "teams", "google_chat"] as const;

export const webhookEndpoints = sqliteTable(
  "webhook_endpoints",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind", { enum: WEBHOOK_KINDS }).notNull().default("webhook"),
    name: text("name").notNull(),
    /** Encrypted with lib/crypto (URLs of chat webhooks are bearer secrets). */
    urlEnc: text("url_enc").notNull(),
    urlHint: text("url_hint").notNull(),
    /** HMAC-SHA256 signing secret for kind=webhook (encrypted). */
    secretEnc: text("secret_enc"),
    /** JSON array of event names, e.g. ["invoice.paid","deal.won"]. */
    events: text("events").notNull().default("[]"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastDeliveryAt: integer("last_delivery_at", { mode: "timestamp" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_endpoints_org").on(t.orgId)],
);

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "succeeded", "failed"] as const;

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: id(),
    orgId: orgId(),
    endpointId: integer("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    /** Unique event id sent to receivers for idempotency. */
    eventId: text("event_id").notNull(),
    payload: text("payload").notNull(),
    status: text("status", { enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_endpoint").on(t.endpointId, t.createdAt), index("webhook_deliveries_retry").on(t.status, t.nextAttemptAt)],
);

// --- REST API keys ---
export const API_SCOPES = ["read", "write"] as const;

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    /** First characters shown in the UI, e.g. "sm_live_ab12". */
    prefix: text("prefix").notNull(),
    /** SHA-256 hex of the full key; the key itself is shown once. */
    keyHash: text("key_hash").notNull().unique(),
    scope: text("scope", { enum: API_SCOPES }).notNull().default("read"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_org").on(t.orgId)],
);

// --- Calendar feeds (iCal subscription for Google / Outlook / Apple Calendar) ---
export const calendarFeeds = sqliteTable(
  "calendar_feeds",
  {
    id: id(),
    orgId: orgId(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the secret token in the feed URL. */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calendar_feeds_org_user").on(t.orgId, t.userId)],
);

// --- Per-workspace third-party credentials (e.g. Razorpay), encrypted ---
export const ORG_INTEGRATION_PROVIDERS = ["razorpay"] as const;

export const orgIntegrations = sqliteTable(
  "org_integrations",
  {
    id: id(),
    orgId: orgId(),
    provider: text("provider", { enum: ORG_INTEGRATION_PROVIDERS }).notNull(),
    /** Encrypted JSON of credentials (lib/crypto). */
    configEnc: text("config_enc").notNull(),
    /** Non-secret display hint, e.g. key id. */
    hint: text("hint"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("org_integrations_org_provider").on(t.orgId, t.provider)],
);

/** Online payment links created for invoices (Razorpay). */
export const invoicePaymentLinks = sqliteTable(
  "invoice_payment_links",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ORG_INTEGRATION_PROVIDERS }).notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    amount: integer("amount").notNull(),
    status: text("status", { enum: ["created", "paid", "cancelled", "expired"] }).notNull().default("created"),
    /** Payment id recorded on the invoice once paid (idempotency for webhooks). */
    paymentRef: text("payment_ref"),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_payment_links_invoice").on(t.invoiceId), uniqueIndex("invoice_payment_links_ext").on(t.provider, t.externalId)],
);

// --- Social sign-in (Google, Microsoft) ---
export const OAUTH_PROVIDERS = ["google", "microsoft"] as const;

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: id(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: OAUTH_PROVIDERS }).notNull(),
    /** Provider's stable subject id (OIDC `sub`). */
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_provider_subject").on(t.provider, t.subject), index("oauth_user").on(t.userId)],
);

// --- Ask AI ---
/** One row per question, for daily limits and an audit trail. */
export const aiQueries = sqliteTable(
  "ai_queries",
  {
    id: id(),
    orgId: orgId(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    /** JSON array of tool names used to answer. */
    tools: text("tools").notNull().default("[]"),
    mode: text("mode", { enum: ["ai", "rules"] }).notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ai_queries_org_created").on(t.orgId, t.createdAt)],
);
