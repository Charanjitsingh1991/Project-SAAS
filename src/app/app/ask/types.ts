import type { ToolResult } from "@/lib/ai/catalog";

export type AskState =
  | undefined
  | {
      ok: boolean;
      question: string;
      mode?: "ai" | "rules";
      answer?: string;
      results?: ToolResult[];
      note?: string;
      provider?: string;
      error?: string;
    };
