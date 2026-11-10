import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDayYmd, buildCalendar, buildEvent, escapeText, foldLine, hashFeedToken, newFeedToken, tokenFromFile } from "../ics";

const now = new Date("2026-03-01T10:20:30.456Z");

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    assert.equal(escapeText("a,b;c\\d\ne\r\nf"), "a\\,b\\;c\\\\d\\ne\\nf");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    assert.equal(foldLine("SUMMARY:hi"), "SUMMARY:hi");
  });
  it("folds at 75 octets with a leading space on continuations", () => {
    const folded = foldLine("SUMMARY:" + "x".repeat(200));
    const parts = folded.split("\r\n");
    assert.ok(parts.length > 1);
    assert.equal(Buffer.byteLength(parts[0]), 75);
    for (const p of parts.slice(1)) {
      assert.ok(p.startsWith(" "));
      assert.ok(Buffer.byteLength(p) <= 75);
    }
    assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(""), "SUMMARY:" + "x".repeat(200));
  });
  it("never splits a multi-byte character", () => {
    const line = "SUMMARY:" + "é".repeat(80) + "😀".repeat(20);
    const folded = foldLine(line);
    for (const p of folded.split("\r\n")) assert.ok(Buffer.byteLength(p) <= 75);
    assert.equal(folded.replace(/\r\n /g, ""), line);
  });
});

describe("buildEvent", () => {
  it("writes all-day dates with an exclusive DTEND", () => {
    const lines = buildEvent({ uid: "u1", start: "2026-03-10", end: "2026-03-12", summary: "Leave" }, now);
    assert.ok(lines.includes("DTSTART;VALUE=DATE:20260310"));
    assert.ok(lines.includes("DTEND;VALUE=DATE:20260313"));
    assert.ok(lines.includes("DTSTAMP:20260301T102030Z"));
  });
  it("defaults to a single day and handles month/year rollover", () => {
    assert.ok(buildEvent({ uid: "u", start: "2026-12-31", summary: "x" }, now).includes("DTEND;VALUE=DATE:20270101"));
    assert.equal(addDayYmd("2028-02-28", 1), "2028-02-29");
  });
  it("ignores an end before the start", () => {
    assert.ok(buildEvent({ uid: "u", start: "2026-03-10", end: "2026-03-01", summary: "x" }, now).includes("DTEND;VALUE=DATE:20260311"));
  });
});

describe("buildCalendar", () => {
  const ics = buildCalendar({
    name: "Acme, Inc",
    now,
    events: [{ uid: "holiday-1@x", start: "2026-08-15", summary: "Independence Day; national", description: "line1\nline2" }],
  });
  it("is a CRLF-only VCALENDAR with required properties", () => {
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
    assert.doesNotMatch(ics.replace(/\r\n/g, ""), /[\r\n]/);
    assert.match(ics, /PRODID:/);
    assert.match(ics, /X-WR-CALNAME:Acme\\, Inc\r\n/);
    assert.match(ics, /SUMMARY:Independence Day\\; national\r\n/);
    assert.match(ics, /DESCRIPTION:line1\\nline2\r\n/);
    assert.match(ics, /UID:holiday-1@x\r\n/);
  });
  it("keeps every physical line within 75 octets", () => {
    const long = buildCalendar({ name: "n", now, events: [{ uid: "u", start: "2026-01-01", summary: "y".repeat(300) }] });
    for (const l of long.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75);
  });
  it("produces an empty but valid calendar with no events", () => {
    const empty = buildCalendar({ name: "n", events: [], now });
    assert.doesNotMatch(empty, /VEVENT/);
  });
});

describe("feed tokens", () => {
  it("creates 32-byte base64url tokens stored as sha256", () => {
    const { token, hash } = newFeedToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hash, hashFeedToken(token));
    assert.equal(hash.length, 64);
  });
  it("extracts the token from <token>.ics only", () => {
    const { token } = newFeedToken();
    assert.equal(tokenFromFile(`${token}.ics`), token);
    assert.equal(tokenFromFile(token), null);
    assert.equal(tokenFromFile("short.ics"), null);
    assert.equal(tokenFromFile(`${token}.ics.txt`), null);
  });
});
