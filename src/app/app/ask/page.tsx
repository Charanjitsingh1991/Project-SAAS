import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/app/ui";
import { dailyLimit, MAX_QUESTION_CHARS, providerInfo, recentQuestions } from "@/lib/ai/ask";
import { timeAgo } from "@/lib/format";
import type { ModuleKey } from "@/lib/roles";
import { canUseModule, requireWorkspace } from "@/lib/tenancy";
import { AskClient } from "./ask-client";

export const metadata: Metadata = { title: "Ask AI" };

const CHIPS: { q: string; module: ModuleKey }[] = [
  { q: "Which customers have overdue invoices and an open deal?", module: "finance" },
  { q: "Who's on leave next week?", module: "hrm" },
  { q: "Reorder anything below 2 weeks of stock.", module: "inventory" },
  { q: "What are our revenue and expenses this quarter?", module: "finance" },
  { q: "Show the sales pipeline by stage", module: "crm" },
  { q: "Which deals are closing this month?", module: "crm" },
  { q: "How many employees are in each department?", module: "hrm" },
  { q: "Open tickets that breached SLA", module: "helpdesk" },
  { q: "Which tasks are overdue?", module: "projects" },
  { q: "What was our payroll cost last month?", module: "payroll" },
];

export default async function AskPage({ searchParams }: PageProps<"/app/ask">) {
  const ws = await requireWorkspace({ feature: "copilot" });
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, MAX_QUESTION_CHARS) : undefined;
  const [recent, provider] = await Promise.all([recentQuestions(ws), Promise.resolve(providerInfo())]);
  const chips = CHIPS.filter((c) => canUseModule(ws, c.module)).map((c) => c.q);

  return (
    <>
      <PageHeader title="Ask your business a question" description="Get an answer from your own workspace data. Read-only: it never changes anything." />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <AskClient initialQuestion={q} chips={chips} />
          <p className="mt-8 text-xs text-ink-soft">
            {provider
              ? `Answers are written by ${provider} using only data from this workspace that your role can access. Up to ${dailyLimit()} AI answers per day; after that, built-in rules answer.`
              : "Answers come from your workspace data using built-in rules. Set AI_API_KEY (Google Gemini's free tier works) to get AI-written answers."}
          </p>
        </div>
        <aside>
          <Card title="Your recent questions">
            {recent.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing asked yet.</p>
            ) : (
              <ul className="space-y-3">
                {recent.map((r) => (
                  <li key={r.id} className="text-sm">
                    <Link href={`/app/ask?q=${encodeURIComponent(r.question)}`} className="underline-offset-4 hover:underline">
                      {r.question}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
                      <Badge tone={r.mode === "ai" ? "lilac" : "butter"}>{r.mode === "ai" ? "AI" : "Rules"}</Badge>
                      {timeAgo(r.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
