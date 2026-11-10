import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

function ymd(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Fills an empty workspace with realistic demo records across every module. Idempotent per org. */
export async function seedWorkspace(orgId: number) {
  const existing = await db.$count(schema.employees, eq(schema.employees.orgId, orgId));
  if (existing > 0) return;

  const emps = await db
    .insert(schema.employees)
    .values([
      { orgId, name: "Priya Sharma", email: "priya@example.com", department: "Engineering", designation: "Senior Engineer", joinDate: "2023-04-03", monthlySalary: 145000 },
      { orgId, name: "Rahul Verma", email: "rahul@example.com", department: "Sales", designation: "Account Executive", joinDate: "2024-01-15", monthlySalary: 82000 },
      { orgId, name: "Aisha Khan", email: "aisha@example.com", department: "Finance", designation: "Accountant", joinDate: "2022-09-01", monthlySalary: 76000 },
      { orgId, name: "Arjun Mehta", email: "arjun@example.com", department: "Operations", designation: "Warehouse Lead", joinDate: "2021-06-21", monthlySalary: 54000 },
      { orgId, name: "Sneha Patel", email: "sneha@example.com", department: "People", designation: "HR Manager", joinDate: "2023-11-06", monthlySalary: 98000 },
      { orgId, name: "Vikram Rao", email: "vikram@example.com", department: "Engineering", designation: "Product Designer", joinDate: "2024-07-08", monthlySalary: 110000 },
    ])
    .returning({ id: schema.employees.id });

  await db.insert(schema.leaveRequests).values([
    { orgId, employeeId: emps[0].id, type: "casual", startDate: ymd(3), endDate: ymd(4), reason: "Family function", status: "pending" },
    { orgId, employeeId: emps[1].id, type: "sick", startDate: ymd(-2), endDate: ymd(-1), reason: "Fever", status: "approved" },
    { orgId, employeeId: emps[3].id, type: "earned", startDate: ymd(10), endDate: ymd(14), reason: "Vacation", status: "pending" },
  ]);

  const cts = await db
    .insert(schema.contacts)
    .values([
      { orgId, name: "Neha Gupta", company: "Initech Pvt Ltd", email: "neha@initech.in", phone: "+91 98100 11111" },
      { orgId, name: "Daniel Kim", company: "Orbital Systems", email: "daniel@orbital.io", phone: "+1 415 555 0101" },
      { orgId, name: "Fatima Noor", company: "Globex Retail", email: "fatima@globex.com", phone: "+971 50 555 0102" },
      { orgId, name: "Karan Singh", company: "Umbrella Labs", email: "karan@umbrella.in", phone: "+91 99000 22222" },
    ])
    .returning({ id: schema.contacts.id });

  await db.insert(schema.deals).values([
    { orgId, title: "Initech — HR + Payroll rollout", contactId: cts[0].id, value: 480000, stage: "proposal", expectedClose: ymd(20) },
    { orgId, title: "Orbital — CRM seats", contactId: cts[1].id, value: 260000, stage: "qualified", expectedClose: ymd(35) },
    { orgId, title: "Globex — Inventory, 4 warehouses", contactId: cts[2].id, value: 720000, stage: "won", expectedClose: ymd(-5) },
    { orgId, title: "Umbrella — pilot", contactId: cts[3].id, value: 95000, stage: "lead", expectedClose: ymd(45) },
    { orgId, title: "Initech — Helpdesk add-on", contactId: cts[0].id, value: 60000, stage: "lost", expectedClose: ymd(-12) },
  ]);

  await db.insert(schema.invoices).values([
    { orgId, number: "INV-1001", customerName: "Globex Retail", customerEmail: "fatima@globex.com", amount: 240000, issueDate: ymd(-20), dueDate: ymd(-5), status: "paid" },
    { orgId, number: "INV-1002", customerName: "Initech Pvt Ltd", customerEmail: "neha@initech.in", amount: 160000, issueDate: ymd(-15), dueDate: ymd(-1), status: "sent" },
    { orgId, number: "INV-1003", customerName: "Orbital Systems", customerEmail: "daniel@orbital.io", amount: 88000, issueDate: ymd(-3), dueDate: ymd(12), status: "sent" },
    { orgId, number: "INV-1004", customerName: "Umbrella Labs", amount: 45000, issueDate: ymd(0), dueDate: ymd(15), status: "draft" },
  ]);

  await db.insert(schema.expenses).values([
    { orgId, description: "Office rent — November", category: "Rent", amount: 180000, date: ymd(-8) },
    { orgId, description: "AWS hosting", category: "Software", amount: 42000, date: ymd(-6) },
    { orgId, description: "Team offsite travel", category: "Travel", amount: 65000, date: ymd(-4) },
    { orgId, description: "Office supplies", category: "Supplies", amount: 8500, date: ymd(-2) },
  ]);

  await db.insert(schema.products).values([
    { orgId, name: 'Laptop — Pro 14"', sku: "LP-14", category: "Electronics", quantity: 42, reorderLevel: 10, unitCost: 92000 },
    { orgId, name: "USB-C dock", sku: "DK-USBC", category: "Accessories", quantity: 6, reorderLevel: 20, unitCost: 7800 },
    { orgId, name: "Office chair", sku: "CH-ERGO", category: "Furniture", quantity: 18, reorderLevel: 5, unitCost: 14500 },
    { orgId, name: 'Monitor 27"', sku: "MN-27", category: "Electronics", quantity: 25, reorderLevel: 8, unitCost: 21000 },
    { orgId, name: "Thermal paper rolls", sku: "TP-80", category: "Supplies", quantity: 3, reorderLevel: 50, unitCost: 120 },
  ]);

  const prj = await db
    .insert(schema.projects)
    .values([
      { orgId, name: "Website relaunch", client: "Internal", budget: 600000, dueDate: ymd(30), status: "active" },
      { orgId, name: "Globex inventory migration", client: "Globex Retail", budget: 350000, dueDate: ymd(18), status: "active" },
      { orgId, name: "Q1 hiring drive", client: "Internal", budget: 150000, dueDate: ymd(60), status: "planning" },
    ])
    .returning({ id: schema.projects.id });

  await db.insert(schema.tasks).values([
    { orgId, projectId: prj[0].id, title: "Finalise homepage copy", assignee: "Vikram Rao", status: "doing" },
    { orgId, projectId: prj[0].id, title: "Build pricing page", assignee: "Priya Sharma", status: "todo" },
    { orgId, projectId: prj[0].id, title: "Set up analytics", assignee: "Priya Sharma", status: "done" },
    { orgId, projectId: prj[1].id, title: "Import SKUs from Tally", assignee: "Arjun Mehta", status: "doing" },
    { orgId, projectId: prj[1].id, title: "Train warehouse staff", assignee: "Arjun Mehta", status: "todo" },
    { orgId, projectId: prj[2].id, title: "Publish job descriptions", assignee: "Sneha Patel", status: "todo" },
  ]);

  await db.insert(schema.tickets).values([
    { orgId, subject: "Cannot download payslip PDF", customerEmail: "staff@globex.com", priority: "high", status: "open", description: "Getting a blank page on download." },
    { orgId, subject: "Add GST number to invoices", customerEmail: "neha@initech.in", priority: "medium", status: "pending" },
    { orgId, subject: "Login link expired", customerEmail: "daniel@orbital.io", priority: "low", status: "resolved" },
    { orgId, subject: "Stock count mismatch in Godown B", customerEmail: "ops@umbrella.in", priority: "urgent", status: "open" },
  ]);
}
