"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper transition hover:bg-ink/85 print:hidden"
    >
      <Printer className="size-4" />
      Print
    </button>
  );
}
