import { createHash, randomBytes } from "node:crypto";

/** Pure RFC 5545 (iCalendar) helpers for all-day event feeds. */

export type IcsEvent = {
  /** Stable across regenerations so calendar apps update instead of duplicating. */
  uid: string;
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day (inclusive), YYYY-MM-DD. Defaults to `start`. DTEND is written exclusive. */
  end?: string;
  summary: string;
  description?: string;
  categories?: string;
};

export function newFeedToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashFeedToken(token) };
}

export function hashFeedToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** TEXT value escaping: backslash, semicolon, comma and newlines. */
export function escapeText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line so no physical line exceeds 75 octets (continuations start with one space). */
export function foldLine(line: string) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // the leading space on continuation lines counts
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const compact = (ymd: string) => ymd.replace(/-/g, "");

export function addDayYmd(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function stamp(now: Date) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildEvent(e: IcsEvent, now: Date) {
  const last = e.end && e.end >= e.start ? e.end : e.start;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compact(e.start)}`,
    `DTEND;VALUE=DATE:${compact(addDayYmd(last, 1))}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.categories) lines.push(`CATEGORIES:${escapeText(e.categories)}`);
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

/** Full VCALENDAR document, CRLF-terminated, with every line folded. */
export function buildCalendar(opts: { name: string; events: IcsEvent[]; now?: Date }) {
  const now = opts.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//saasmodels.tech//Workspace Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...opts.events.flatMap((e) => buildEvent(e, now)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Feed URL segment is `<token>.ics`; returns the token or null. */
export function tokenFromFile(file: string) {
  const m = /^([A-Za-z0-9_-]{20,128})\.ics$/.exec(file);
  return m ? m[1] : null;
}
