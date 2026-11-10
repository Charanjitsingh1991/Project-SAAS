import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTOMATIONS, effectiveAutomations, parseAutomations } from "../automations";
import { activeModules, effectivePlan, PLANS, planHas } from "../plans";

test("Starter: default 3 modules, selection capped at 3, payroll/analytics never allowed", () => {
  assert.deepEqual(activeModules(PLANS.starter, null), ["hrm", "crm", "projects"]);
  assert.deepEqual(activeModules(PLANS.starter, JSON.stringify(["finance", "inventory", "helpdesk", "crm"])), ["finance", "inventory", "helpdesk"]);
  assert.deepEqual(activeModules(PLANS.starter, JSON.stringify(["payroll", "analytics", "crm"])), ["crm"]);
});

test("Growth/Enterprise: all modules by default, owner can switch some off", () => {
  assert.equal(activeModules(PLANS.growth, null).length, 8);
  assert.deepEqual(activeModules(PLANS.enterprise, JSON.stringify(["hrm", "payroll"])), ["hrm", "payroll"]);
  assert.deepEqual(activeModules(PLANS.growth, "not json"), activeModules(PLANS.growth, null));
});

test("Trials run on Growth; features follow the plan", () => {
  assert.equal(effectivePlan({ plan: "starter" }, true).key, "growth");
  assert.equal(effectivePlan({ plan: "starter" }, false).key, "starter");
  assert.equal(planHas(PLANS.starter, "automations"), false);
  assert.equal(planHas(PLANS.growth, "auditLog"), false);
  assert.equal(planHas(PLANS.enterprise, "auditLog"), true);
});

test("Automations: workflow tier needs the plan feature; every automation needs its modules", () => {
  const all = parseAutomations(null);
  const starter = effectiveAutomations(all, { planAutomations: false, modules: ["crm", "finance", "inventory"] });
  assert.equal(starter.dealWonInvoice, false, "workflow automation blocked on Starter");
  assert.equal(starter.invoiceStockIssue, true, "core automation runs when both modules are on");
  assert.equal(starter.payrollExpense, false, "payroll not enabled");
  const growth = effectiveAutomations(all, { planAutomations: true, modules: ["crm", "finance"] });
  assert.equal(growth.dealWonInvoice, true);
  assert.equal(growth.dealWonProject, false, "projects module off");
  const off = effectiveAutomations({ ...all, dealWonInvoice: false }, { planAutomations: true, modules: ["crm", "finance"] });
  assert.equal(off.dealWonInvoice, false, "owner toggle respected");
  assert.equal(Object.keys(growth).length, AUTOMATIONS.length);
});
