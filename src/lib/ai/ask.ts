import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ROLE_INFO } from "@/lib/roles";
import { todayYmd } from "@/lib/format";
import { canUseModule, type ActiveWorkspace } from "@/lib/tenancy";
import type { ToolResult } from "./catalog";
import { NO_MATCH_MESSAGE, planQuestion, templateAnswer } from "./intent";
import { LlmError, buildSystemPrompt, llmConfigFromEnv, providerLabel, runToolLoop } from "./llm";
import { allowedToolNames, runTool } from "./tools";

export const MAX_QUESTION_CHARS = 500;
const DEFAULT_DAILY_LIMIT = 200;

export type AskOutcome = {
  ok: boolean;
  question: string;
  mode: "ai" | "rules";
  answer: string;
  results: ToolResult[];
  /** Why rules mode was used although a key is configured, or other caveats. */
  note?: string;
  provider?: string;
};

export function dailyLimit() {
  const v = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_DAILY_LIMIT;
}

async function aiCallsLast24h(orgId: number) {
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.aiQueries)
    .where(and(eq(schema.aiQueries.orgId, orgId), eq(schema.aiQueries.mode, "ai"), gte(schema.aiQueries.createdAt, new Date(Date.now() - 86_400_000))));
  return Number(row?.c ?? 0);
}

async function planContext(ws: ActiveWorkspace, allowed: string[]) {
  let departments: string[] = [];
  let locations: string[] = [];
  if (canUseModule(ws, "hrm")) {
    const [d, l] = await Promise.all([
      db.select({ n: schema.departments.name }).from(schema.departments).where(eq(schema.departments.orgId, ws.org.id)),
      db.selectDistinct({ n: schema.employees.workLocation }).from(schema.employees).where(eq(schema.employees.orgId, ws.org.id)),
    ]);
    departments = d.map((x) => x.n);
    locations = l.map((x) => x.n).filter((x): x is string => !!x);
  }
  return { today: todayYmd(), allowed, departments, locations };
}

async function log(ws: ActiveWorkspace, question: string, tools: string[], mode: "ai" | "rules", ok: boolean) {
  await db.insert(schema.aiQueries).values({ orgId: ws.org.id, userId: ws.user.id, question, tools: JSON.stringify(tools), mode, ok });
}

async function answerWithRules(ws: ActiveWorkspace, question: string, allowed: string[], note?: string): Promise<AskOutcome> {
  const calls = planQuestion(question, await planContext(ws, allowed));
  const results: ToolResult[] = [];
  for (const c of calls) {
    try {
      results.push(await runTool(ws, c.tool, c.params));
    } catch {
      // Skip a failing lookup; the others still answer.
    }
  }
  const ok = results.length > 0;
  await log(ws, question, results.map((r) => r.tool), "rules", ok);
  return { ok, question, mode: "rules", answer: ok ? templateAnswer(results) : NO_MATCH_MESSAGE, results, note };
}

/** Answers one question for the current user. The caller must already have passed requireWorkspace({ feature: "copilot" }). */
export async function askQuestion(ws: ActiveWorkspace, rawQuestion: string): Promise<AskOutcome> {
  const question = rawQuestion.trim().slice(0, MAX_QUESTION_CHARS);
  const allowed = allowedToolNames(ws);
  const cfg = llmConfigFromEnv();
  if (!cfg) return answerWithRules(ws, question, allowed);

  const used = await aiCallsLast24h(ws.org.id);
  if (used >= dailyLimit()) return answerWithRules(ws, question, allowed, "Daily AI limit reached for this workspace, so this answer used built-in rules.");

  const system = buildSystemPrompt({
    orgName: ws.org.name,
    country: ws.org.country,
    currency: ws.org.currency,
    today: todayYmd(),
    role: ROLE_INFO[ws.role].label,
    toolNames: allowed,
  });
  try {
    const out = await runToolLoop({ config: cfg, system, question, allowedTools: allowed, execute: (name, params) => runTool(ws, name, params) });
    await log(ws, question, out.toolsUsed, "ai", true);
    return { ok: true, question, mode: "ai", answer: out.answer, results: out.results, provider: providerLabel(cfg) };
  } catch (e) {
    const reason = e instanceof LlmError ? e.message : "The AI provider failed.";
    return answerWithRules(ws, question, allowed, `${reason} This answer used built-in rules instead.`);
  }
}

export async function recentQuestions(ws: ActiveWorkspace) {
  return db
    .select({ id: schema.aiQueries.id, question: schema.aiQueries.question, mode: schema.aiQueries.mode, ok: schema.aiQueries.ok, createdAt: schema.aiQueries.createdAt })
    .from(schema.aiQueries)
    .where(and(eq(schema.aiQueries.orgId, ws.org.id), eq(schema.aiQueries.userId, ws.user.id)))
    .orderBy(desc(schema.aiQueries.createdAt), desc(schema.aiQueries.id))
    .limit(10);
}

export function providerInfo() {
  const cfg = llmConfigFromEnv();
  return cfg ? providerLabel(cfg) : null;
}
