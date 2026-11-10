"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-4 text-sm hover:border-ink">
      <Printer className="size-4" /> Print
    </button>
  );
}
