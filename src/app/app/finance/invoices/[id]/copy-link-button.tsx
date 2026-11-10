"use client";

import { useState } from "react";

export function CopyLinkButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
      className="inline-flex h-9 items-center rounded-full border border-ink/20 px-4 text-sm font-medium hover:border-ink"
    >
      {done ? "Copied" : "Copy link"}
    </button>
  );
}
