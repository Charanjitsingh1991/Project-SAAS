import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => integer("id").primaryKey({ autoIncrement: true });
const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);
const orgId = () =>
  integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/* ───────────── Accounts & tenancy ───────────── */

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  company: text("company"),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("INR"),
  ownerId: integer("owner_id").notNull(),
  plan: text("plan", { enum: ["starter", "growth"] }).notNull().default("growth"),
  trialStartedAt: integer("trial_started_at", { mode: "timestamp" }).notNull(),
  /** Exact instant access ends if unpaid: 00:00 (APP_TIMEZONE) at the start of day 15. */
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Mirrors Stripe subscription.status; null until the org subscribes. */
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

/* ───────────── Marketing site ───────────── */

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

/* ───────────── HRM ───────────── */

export const employees = sqliteTable(
  "employees",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    email: text("email"),
    department: text("department").notNull(),
    designation: text("designation").notNull(),
    joinDate: text("join_date").notNull(), // YYYY-MM-DD
    monthlySalary: integer("monthly_salary").notNull().default(0),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [index("employees_org").on(t.orgId)],
);

export const leaveRequests = sqliteTable(
  "leave_requests",
  {
    id: id(),
    orgId: orgId(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["casual", "sick", "earned", "unpaid"] }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    reason: text("reason"),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("leave_org").on(t.orgId)],
);

/* ───────────── CRM ───────────── */

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_org").on(t.orgId)],
);

export const DEAL_STAGES = ["lead", "qualified", "proposal", "won", "lost"] as const;

export const deals = sqliteTable(
  "deals",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    value: integer("value").notNull().default(0),
    stage: text("stage", { enum: DEAL_STAGES }).notNull().default("lead"),
    expectedClose: text("expected_close"),
    createdAt: createdAt(),
  },
  (t) => [index("deals_org").on(t.orgId)],
);

/* ───────────── Finance ───────────── */

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    orgId: orgId(),
    number: text("number").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    amount: integer("amount").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status", { enum: ["draft", "sent", "paid", "void"] }).notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_org").on(t.orgId)],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: id(),
    orgId: orgId(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    amount: integer("amount").notNull(),
    date: text("date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_org").on(t.orgId)],
);

/* ───────────── Inventory ───────────── */

export const products = sqliteTable(
  "products",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    category: text("category"),
    quantity: integer("quantity").notNull().default(0),
    reorderLevel: integer("reorder_level").notNull().default(0),
    unitCost: integer("unit_cost").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("products_org").on(t.orgId)],
);

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: id(),
    orgId: orgId(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    change: integer("change").notNull(), // + received, - shipped
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("stock_org").on(t.orgId)],
);

/* ───────────── Payroll ───────────── */

export const payrollRuns = sqliteTable(
  "payroll_runs",
  {
    id: id(),
    orgId: orgId(),
    period: text("period").notNull(), // YYYY-MM
    employeeCount: integer("employee_count").notNull(),
    totalGross: integer("total_gross").notNull(),
    totalDeductions: integer("total_deductions").notNull(),
    totalNet: integer("total_net").notNull(),
    status: text("status", { enum: ["draft", "paid"] }).notNull().default("draft"),
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
    gross: integer("gross").notNull(),
    deductions: integer("deductions").notNull(),
    net: integer("net").notNull(),
  },
  (t) => [index("payslips_run").on(t.runId)],
);

/* ───────────── Projects ───────────── */

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    client: text("client"),
    budget: integer("budget").notNull().default(0),
    dueDate: text("due_date"),
    status: text("status", { enum: ["planning", "active", "on_hold", "done"] }).notNull().default("planning"),
    createdAt: createdAt(),
  },
  (t) => [index("projects_org").on(t.orgId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    orgId: orgId(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assignee: text("assignee"),
    status: text("status", { enum: ["todo", "doing", "done"] }).notNull().default("todo"),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_org").on(t.orgId)],
);

/* ───────────── Helpdesk ───────────── */

export const tickets = sqliteTable(
  "tickets",
  {
    id: id(),
    orgId: orgId(),
    subject: text("subject").notNull(),
    customerEmail: text("customer_email").notNull(),
    description: text("description"),
    priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
    status: text("status", { enum: ["open", "pending", "resolved"] }).notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [index("tickets_org").on(t.orgId)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;
