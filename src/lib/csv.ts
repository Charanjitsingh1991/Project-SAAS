/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). Returns header-keyed rows; header names are lower-cased and trimmed. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) records.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) records.push(row);
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = records.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

/** Limits for in-browser CSV imports. */
export const CSV_MAX_ROWS = 2000;
export const CSV_MAX_BYTES = 2 * 1024 * 1024;
