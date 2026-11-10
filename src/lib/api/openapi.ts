/** OpenAPI 3.1 description of /api/v1 (pure; also drives the reference on the API page). */

export type Endpoint = { method: "GET" | "POST"; path: string; summary: string; module: string; filters?: string[]; body?: string };

export const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/contacts", summary: "List contacts", module: "crm", filters: ["email", "company_id"] },
  { method: "POST", path: "/contacts", summary: "Create a contact", module: "crm", body: "Contact" },
  { method: "GET", path: "/companies", summary: "List companies", module: "crm" },
  { method: "POST", path: "/companies", summary: "Create a company", module: "crm", body: "Company" },
  { method: "GET", path: "/deals", summary: "List deals", module: "crm", filters: ["stage"] },
  { method: "POST", path: "/deals", summary: "Create a deal", module: "crm", body: "Deal" },
  { method: "GET", path: "/invoices", summary: "List invoices", module: "finance", filters: ["status", "company_id"] },
  { method: "GET", path: "/invoices/{id}", summary: "Get an invoice with its lines", module: "finance" },
  { method: "POST", path: "/invoices", summary: "Create a DRAFT invoice", module: "finance", body: "Invoice" },
  { method: "GET", path: "/payments", summary: "List payments", module: "finance", filters: ["invoice_id"] },
  { method: "GET", path: "/products", summary: "List products with stock on hand", module: "inventory" },
  { method: "GET", path: "/employees", summary: "List employees (no salary, bank or ID-document fields)", module: "hrm", filters: ["status"] },
  { method: "GET", path: "/leave-requests", summary: "List leave requests", module: "hrm", filters: ["status", "employee_id"] },
  { method: "GET", path: "/tickets", summary: "List helpdesk tickets", module: "helpdesk", filters: ["status"] },
  { method: "POST", path: "/tickets", summary: "Create a ticket", module: "helpdesk", body: "Ticket" },
  { method: "GET", path: "/projects", summary: "List projects", module: "projects" },
  { method: "GET", path: "/tasks", summary: "List tasks", module: "projects", filters: ["project_id", "status"] },
];

const money = { type: "integer", description: "Integer minor units (e.g. paise / fils) of `currency`." };
const nullable = (type: string) => ({ type: [type, "null"] });

const props = {
  Contact: { id: { type: "integer" }, name: { type: "string" }, title: nullable("string"), email: nullable("string"), phone: nullable("string"), company_id: nullable("integer"), lifecycle: { enum: ["lead", "prospect", "customer", "churned"] }, source: { enum: ["website", "referral", "outbound", "event", "partner", "other"] }, created_at: { type: "string", format: "date-time" } },
  Company: { id: { type: "integer" }, name: { type: "string" }, industry: nullable("string"), website: nullable("string"), phone: nullable("string"), tax_id: nullable("string"), billing_address: nullable("string"), city: nullable("string"), state: nullable("string"), country: nullable("string"), created_at: { type: "string", format: "date-time" } },
  Deal: { id: { type: "integer" }, title: { type: "string" }, company_id: nullable("integer"), contact_id: nullable("integer"), value: money, currency: { type: "string", examples: ["INR"] }, stage: { enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost"] }, probability: { type: "integer" }, source: { type: "string" }, expected_close: nullable("string"), created_at: { type: "string", format: "date-time" } },
  InvoiceLine: { id: { type: "integer" }, product_id: nullable("integer"), description: { type: "string" }, quantity: { type: "number" }, unit_price: money, tax_rate: { type: "number" }, tax_code: nullable("string"), amount: money, tax_amount: money },
  Invoice: { id: { type: "integer" }, number: { type: "string" }, company_id: nullable("integer"), customer_name: { type: "string" }, customer_email: nullable("string"), issue_date: { type: "string", format: "date" }, due_date: { type: "string", format: "date" }, status: { enum: ["draft", "sent", "partial", "paid", "void"] }, subtotal: money, tax_total: money, total: money, amount_paid: money, amount_credited: money, balance_due: money, currency: { type: "string" }, created_at: { type: "string", format: "date-time" } },
  Payment: { id: { type: "integer" }, invoice_id: { type: "integer" }, date: { type: "string", format: "date" }, amount: money, currency: { type: "string" }, method: { type: "string" }, reference: nullable("string"), created_at: { type: "string", format: "date-time" } },
  Product: { id: { type: "integer" }, sku: { type: "string" }, name: { type: "string" }, barcode: nullable("string"), category: nullable("string"), unit: { type: "string" }, cost_price: money, selling_price: money, currency: { type: "string" }, tax_rate: { type: "number" }, reorder_level: { type: "number" }, track_stock: { type: "boolean" }, active: { type: "boolean" }, stock_on_hand: { type: "number" }, created_at: { type: "string", format: "date-time" } },
  Employee: { id: { type: "integer" }, code: { type: "string" }, name: { type: "string" }, email: nullable("string"), phone: nullable("string"), department: nullable("string"), designation: { type: "string" }, manager_id: nullable("integer"), employment_type: { type: "string" }, work_location: nullable("string"), status: { enum: ["active", "notice", "exited"] }, join_date: { type: "string", format: "date" }, exit_date: nullable("string") },
  LeaveRequest: { id: { type: "integer" }, employee_id: { type: "integer" }, employee_code: { type: "string" }, leave_type: { type: "string" }, start_date: { type: "string", format: "date" }, end_date: { type: "string", format: "date" }, half_day: { type: "boolean" }, days: { type: "number" }, status: { enum: ["pending", "approved", "rejected", "cancelled"] }, created_at: { type: "string", format: "date-time" } },
  Ticket: { id: { type: "integer" }, number: { type: "string" }, subject: { type: "string" }, description: nullable("string"), requester_name: { type: "string" }, requester_email: { type: "string" }, contact_id: nullable("integer"), company_id: nullable("integer"), channel: { type: "string" }, category: nullable("string"), priority: { enum: ["low", "medium", "high", "urgent"] }, status: { type: "string" }, assignee_id: nullable("integer"), resolved_at: nullable("string"), created_at: { type: "string", format: "date-time" } },
  Project: { id: { type: "integer" }, code: { type: "string" }, name: { type: "string" }, company_id: nullable("integer"), description: nullable("string"), status: { type: "string" }, billing_type: { type: "string" }, budget: money, hourly_rate: money, currency: { type: "string" }, start_date: nullable("string"), due_date: nullable("string"), created_at: { type: "string", format: "date-time" } },
  Task: { id: { type: "integer" }, project_id: { type: "integer" }, title: { type: "string" }, description: nullable("string"), assignee_id: nullable("integer"), status: { type: "string" }, priority: { type: "string" }, start_date: nullable("string"), due_date: nullable("string"), estimate_hours: nullable("number"), completed_at: nullable("string"), created_at: { type: "string", format: "date-time" } },
} as const;

const inputs = {
  ContactInput: { type: "object", required: ["name"], properties: { name: { type: "string" }, title: { type: "string" }, email: { type: "string", format: "email" }, phone: { type: "string" }, company_id: { type: "integer" }, lifecycle: props.Contact.lifecycle, source: props.Contact.source } },
  CompanyInput: { type: "object", required: ["name"], properties: { name: { type: "string" }, industry: { type: "string" }, website: { type: "string" }, phone: { type: "string" }, tax_id: { type: "string", description: "GSTIN (India) / TRN (UAE)." }, billing_address: { type: "string" }, city: { type: "string" }, state: { type: "string" }, country: { type: "string" } } },
  DealInput: { type: "object", required: ["title"], properties: { title: { type: "string" }, company_id: { type: "integer" }, contact_id: { type: "integer" }, value: money, stage: { enum: ["lead", "qualified", "proposal", "negotiation"], default: "lead" }, source: props.Contact.source, expected_close: { type: "string", format: "date" } } },
  TicketInput: { type: "object", required: ["subject", "requester_name", "requester_email"], properties: { subject: { type: "string" }, description: { type: "string" }, requester_name: { type: "string" }, requester_email: { type: "string", format: "email" }, channel: { enum: ["email", "phone", "chat", "whatsapp", "web", "portal"], default: "web" }, category: { type: "string" }, priority: { enum: ["low", "medium", "high", "urgent"], default: "medium" }, assignee_id: { type: "integer", description: "User id of a workspace member." } } },
  InvoiceInput: {
    type: "object",
    required: ["lines"],
    description: "Creates a DRAFT invoice. Tax is computed from each line's rate using the workspace's country tax rules.",
    properties: {
      company_id: { type: "integer" },
      customer_name: { type: "string", description: "Required unless company_id is given." },
      customer_email: { type: "string", format: "email" },
      issue_date: { type: "string", format: "date" },
      due_date: { type: "string", format: "date" },
      notes: { type: "string" },
      lines: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: { type: "object", properties: { product_id: { type: "integer" }, description: { type: "string" }, quantity: { type: "number", default: 1 }, unit_price: money, tax_rate: { type: "number", description: "Percent. Defaults to the product's rate or the workspace default." }, tax_code: { type: "string" } } },
      },
    },
  },
} as const;

const SCHEMA_FOR: Record<string, string> = { Contact: "ContactInput", Company: "CompanyInput", Deal: "DealInput", Ticket: "TicketInput", Invoice: "InvoiceInput" };
const ITEM_FOR: Record<string, string> = { "/contacts": "Contact", "/companies": "Company", "/deals": "Deal", "/invoices": "Invoice", "/payments": "Payment", "/products": "Product", "/employees": "Employee", "/leave-requests": "LeaveRequest", "/tickets": "Ticket", "/projects": "Project", "/tasks": "Task" };

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const isDetail = e.path.includes("{id}");
    const item = ITEM_FOR[isDetail ? e.path.replace("/{id}", "") : e.path];
    const parameters: unknown[] = isDetail
      ? [{ name: "id", in: "path", required: true, schema: { type: "integer" } }]
      : e.method === "GET"
        ? [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
            { name: "cursor", in: "query", description: "`next_cursor` from the previous page.", schema: { type: "string" } },
            ...(e.filters ?? []).map((f) => ({ name: f, in: "query", schema: { type: f.endsWith("_id") ? "integer" : "string" } })),
          ]
        : [];
    const ok = isDetail
      ? { type: "object", properties: { data: { allOf: [ref(item), { type: "object", properties: { lines: { type: "array", items: ref("InvoiceLine") } } }] } } }
      : e.method === "GET"
        ? { type: "object", properties: { data: { type: "array", items: ref(item) }, has_more: { type: "boolean" }, next_cursor: nullable("string") } }
        : { type: "object", properties: { data: ref(item) } };
    const op: Record<string, unknown> = {
      summary: e.summary,
      tags: [e.module],
      description: `Requires the ${e.module} module.${e.method === "POST" ? " Requires a read + write key." : ""}`,
      ...(parameters.length ? { parameters } : {}),
      ...(e.body ? { requestBody: { required: true, content: { "application/json": { schema: ref(SCHEMA_FOR[e.body]) } } } } : {}),
      responses: {
        [e.method === "POST" ? "201" : "200"]: { description: "OK", content: { "application/json": { schema: ok } } },
        "401": { description: "Missing, invalid or revoked key", content: { "application/json": { schema: ref("Error") } } },
        "403": { description: "Plan, module, scope or workspace state forbids this", content: { "application/json": { schema: ref("Error") } } },
        ...(e.method === "POST" ? { "422": { description: "Validation error", content: { "application/json": { schema: ref("Error") } } } } : {}),
        "429": { description: "Rate limited (120 requests per minute per key)", content: { "application/json": { schema: ref("Error") } } },
      },
    };
    (paths[e.path] ??= {})[e.method.toLowerCase()] = op;
  }

  const schemas: Record<string, unknown> = {
    Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
    ...inputs,
  };
  for (const [name, properties] of Object.entries(props)) schemas[name] = { type: "object", properties };

  return {
    openapi: "3.1.0",
    info: { title: "saasmodels.tech REST API", version: "1.0.0", description: "Money fields are integer minor units with a `currency` code. Lists are cursor-paginated (`limit` ≤ 100)." },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths,
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "API key: `Authorization: Bearer sm_live_…`" } }, schemas },
  };
}
