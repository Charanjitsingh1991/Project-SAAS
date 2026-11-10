import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openAiTools, TOOL_DEFS, type ToolResult } from "../ai/catalog";
import { parseDateRange } from "../ai/dates";
import { planQuestion, templateAnswer } from "../ai/intent";
import { buildSystemPrompt, llmConfigFromEnv, runToolLoop, LlmError, type LlmConfig } from "../ai/llm";

const TODAY = "2026-11-10"; // a Tuesday
const ALL = TOOL_DEFS.map((t) => t.name);

describe("parseDateRange", () => {
  it("parses weeks (Monday–Sunday)", () => {
    assert.deepEqual(parseDateRange("who is on leave next week", TODAY), { from: "2026-11-16", to: "2026-11-22", label: "next week" });
    assert.equal(parseDateRange("this week", TODAY)?.from, "2026-11-09");
    assert.equal(parseDateRange("last week", TODAY)?.to, "2026-11-08");
  });
  it("parses months and quarters", () => {
    assert.deepEqual(parseDateRange("revenue this month", TODAY), { from: "2026-11-01", to: "2026-11-30", label: "this month" });
    assert.equal(parseDateRange("last month", "2026-01-15")?.from, "2025-12-01");
    assert.deepEqual(parseDateRange("expenses last quarter", TODAY), { from: "2026-07-01", to: "2026-09-30", label: "last quarter" });
    assert.equal(parseDateRange("next quarter", "2026-11-10")?.from, "2027-01-01");
  });
  it("parses relative days, named months and Q-notation", () => {
    assert.deepEqual(parseDateRange("in the next 10 days", TODAY), { from: TODAY, to: "2026-11-20", label: "next 10 days" });
    assert.equal(parseDateRange("sales in March 2026", TODAY)?.to, "2026-03-31");
    assert.equal(parseDateRange("Q2 2026", TODAY)?.from, "2026-04-01");
    assert.equal(parseDateRange("tomorrow", TODAY)?.from, "2026-11-11");
  });
  it("does not treat the verb 'may' as a month and returns null without a date", () => {
    assert.equal(parseDateRange("which invoices may be late", TODAY), null);
    assert.equal(parseDateRange("show the pipeline", TODAY), null);
  });
});

describe("planQuestion", () => {
  const ctx = { today: TODAY, allowed: ALL, departments: ["Engineering", "Sales"], locations: ["Bengaluru", "Pune"] };

  it("maps the three homepage questions", () => {
    assert.deepEqual(planQuestion("Which customers have overdue invoices and an open deal?", ctx), [{ tool: "overdue_invoices", params: { withOpenDeals: true } }]);
    assert.deepEqual(planQuestion("Who's on leave next week in the Bengaluru warehouse?", ctx), [
      { tool: "on_leave", params: { from: "2026-11-16", to: "2026-11-22", location: "Bengaluru" } },
    ]);
    assert.deepEqual(planQuestion("Reorder anything below 2 weeks of stock.", ctx), [{ tool: "low_stock", params: { maxDaysCover: 14 } }]);
  });
  it("matches department names and unknown locations", () => {
    const [c] = planQuestion("Who is on leave this week in Engineering?", ctx);
    assert.equal(c.params.department, "Engineering");
    const [d] = planQuestion("who is on leave tomorrow in the Hyderabad office", ctx);
    assert.equal(d.params.location, "hyderabad");
  });
  it("routes finance, CRM, helpdesk, project and payroll questions", () => {
    assert.equal(planQuestion("revenue and expenses last quarter", ctx)[0].tool, "revenue_expenses");
    assert.equal(planQuestion("show the sales pipeline", ctx)[0].tool, "pipeline");
    assert.equal(planQuestion("deals closing this month", ctx)[0].tool, "deals_closing");
    assert.equal(planQuestion("which tasks are overdue", ctx)[0].tool, "overdue_tasks");
    assert.equal(planQuestion("tickets that breached SLA", ctx)[0].tool, "open_tickets");
    assert.deepEqual(planQuestion("payroll cost for October 2026", ctx)[0], { tool: "payroll_cost", params: { month: "2026-10" } });
    assert.equal(planQuestion("any birthdays this month?", ctx)[0].tool, "upcoming_events");
  });
  it("only plans tools the user is allowed to run", () => {
    assert.deepEqual(planQuestion("overdue invoices", { ...ctx, allowed: ["on_leave"] }), []);
  });
  it("returns nothing for unrelated questions", () => {
    assert.deepEqual(planQuestion("tell me a joke", ctx), []);
  });
});

describe("templateAnswer", () => {
  it("joins facts per result", () => {
    const r: ToolResult = { tool: "headcount", title: "Headcount", columns: [], rows: [], facts: ["12 employees."] };
    assert.equal(templateAnswer([r]), "Headcount: 12 employees.");
  });
});

describe("catalog", () => {
  it("emits JSON schemas only for allowed tools", () => {
    const specs = openAiTools(["on_leave", "headcount"]);
    assert.deepEqual(specs.map((s) => s.function.name), ["on_leave", "headcount"]);
    const params = specs[0].function.parameters as { properties: Record<string, unknown>; required: string[] };
    assert.ok("from" in params.properties);
    assert.deepEqual(params.required.sort(), ["from", "to"]);
  });
});

describe("llmConfigFromEnv", () => {
  it("is null without a key and uses Gemini defaults otherwise", () => {
    assert.equal(llmConfigFromEnv({}), null);
    const c = llmConfigFromEnv({ AI_API_KEY: "k" });
    assert.equal(c?.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
    assert.equal(c?.model, "gemini-2.5-flash");
  });
});

const cfg: LlmConfig = { apiKey: "secret-key", baseUrl: "https://example.test/v1/", model: "m" };
const toolResult: ToolResult = { tool: "headcount", title: "Headcount", columns: ["Department", "Employees"], rows: [["Eng", 4]], facts: ["4 active employees."] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const base = (messages: unknown) => ({ config: cfg, system: "sys", question: "headcount?", allowedTools: ["headcount", "on_leave"], messages });

describe("runToolLoop", () => {
  it("calls a tool, feeds its result back and returns the final answer", async () => {
    const bodies: { messages: { role: string; content?: string; name?: string; tool_call_id?: string }[]; tools?: unknown[] }[] = [];
    const urls: string[] = [];
    let auth = "";
    const replies = [
      { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "headcount", arguments: "{}" } }] } }] },
      { choices: [{ message: { role: "assistant", content: "You have 4 people." } }] },
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      auth = (init.headers as Record<string, string>).authorization;
      bodies.push(JSON.parse(init.body as string));
      return json(replies.shift());
    }) as unknown as typeof fetch;
    const executed: string[] = [];
    const out = await runToolLoop({
      ...base(undefined),
      fetchImpl,
      execute: async (name) => (executed.push(name), toolResult),
    });
    assert.equal(out.answer, "You have 4 people.");
    assert.deepEqual(executed, ["headcount"]);
    assert.deepEqual(out.toolsUsed, ["headcount"]);
    assert.equal(urls[0], "https://example.test/v1/chat/completions");
    assert.equal(auth, "Bearer secret-key");
    assert.equal(bodies[0].tools?.length, 2);
    const tool = bodies[1].messages.find((m) => m.role === "tool");
    assert.equal(tool?.tool_call_id, "c1");
    assert.equal(tool?.name, "headcount");
    assert.match(tool?.content ?? "", /4 active employees/);
    assert.ok(!JSON.stringify(bodies).includes("secret-key"));
  });

  it("rejects unknown/forbidden tools and bad arguments without executing them", async () => {
    const mkCall = (id: string, name: string, args: string) => ({ id, type: "function", function: { name, arguments: args } });
    const replies = [
      { choices: [{ message: { role: "assistant", tool_calls: [mkCall("a", "drop_tables", "{}"), mkCall("b", "on_leave", "{\"from\":\"nope\"}"), mkCall("c", "on_leave", "not json")] } }] },
      { choices: [{ message: { role: "assistant", content: "Sorry." } }] },
    ];
    let seen: { role: string; content: string }[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = JSON.parse(init.body as string).messages;
      return json(replies.shift());
    }) as unknown as typeof fetch;
    let ran = 0;
    const out = await runToolLoop({ ...base(undefined), fetchImpl, execute: async () => (ran++, toolResult) });
    assert.equal(ran, 0);
    assert.equal(out.results.length, 0);
    assert.equal(seen.filter((m) => m.role === "tool" && m.content.includes("error")).length, 3);
  });

  it("caps tool executions at 4 and forces a final answer", async () => {
    let n = 0;
    const calls = (k: number) => ({ choices: [{ message: { role: "assistant", tool_calls: Array.from({ length: k }, (_, i) => ({ id: `x${n}${i}`, type: "function", function: { name: "headcount", arguments: "{}" } })) } }] });
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      n++;
      if (body.tools) return json(calls(3));
      return json({ choices: [{ message: { role: "assistant", content: "Done." } }] });
    }) as unknown as typeof fetch;
    let ran = 0;
    const out = await runToolLoop({ ...base(undefined), fetchImpl, execute: async () => (ran++, toolResult) });
    assert.equal(ran, 4);
    assert.equal(out.answer, "Done.");
  });

  it("throws LlmError on HTTP errors, empty answers and network failures", async () => {
    const run = (f: typeof fetch) => runToolLoop({ ...base(undefined), fetchImpl: f, execute: async () => toolResult });
    await assert.rejects(run((async () => json({ error: "x" }, 429)) as unknown as typeof fetch), (e) => e instanceof LlmError && /429/.test(e.message));
    await assert.rejects(run((async () => json({ choices: [{ message: { role: "assistant", content: "" } }] })) as unknown as typeof fetch), LlmError);
    await assert.rejects(
      run((async () => {
        throw new Error("boom secret-key");
      }) as unknown as typeof fetch),
      (e) => e instanceof LlmError && !e.message.includes("secret-key"),
    );
  });
});

describe("buildSystemPrompt", () => {
  it("includes workspace context and only the allowed tools", () => {
    const p = buildSystemPrompt({ orgName: "Acme", country: "IN", currency: "INR", today: TODAY, role: "HR", toolNames: ["headcount"] });
    assert.match(p, /Acme/);
    assert.match(p, /2026-11-10/);
    assert.match(p, /Available tools: headcount\./);
    assert.ok(!p.includes("overdue_invoices"));
  });
});
