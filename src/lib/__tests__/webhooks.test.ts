import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { EVENT_NAMES, eventPath, parseEvents } from "../integrations/catalog";
import { describeEvent, googleChatBody, slackBody, teamsBody, type EventPayload } from "../integrations/format";
import { BACKOFF_MS, MAX_ATTEMPTS, retryDelayMs } from "../integrations/retry";
import { isPrivateIp, signPayload, urlHint, validateEndpointUrl, verifySignature } from "../integrations/security";

const payload = (event: EventPayload["event"], data: EventPayload["data"]): EventPayload => ({
  id: "evt_1",
  event,
  created_at: "2026-01-01T00:00:00.000Z",
  workspace: { id: 1, name: "Acme", currency: "INR" },
  data,
});

test("signature is HMAC-SHA256 of timestamp.body and verifies", () => {
  const sig = signPayload("whsec_test", 1700000000, '{"a":1}');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(sig, "sha256=" + createHmac("sha256", "whsec_test").update('1700000000.{"a":1}').digest("hex"));
  assert.ok(verifySignature("whsec_test", 1700000000, '{"a":1}', sig));
  assert.ok(!verifySignature("whsec_test", 1700000001, '{"a":1}', sig));
  assert.ok(!verifySignature("other", 1700000000, '{"a":1}', sig));
  assert.ok(!verifySignature("whsec_test", 1700000000, '{"a":1}', "sha256=short"));
});

test("backoff schedule: 1m, 5m, 30m, 2h, 12h then give up", () => {
  assert.deepEqual([...BACKOFF_MS], [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(5), 43_200_000);
  assert.equal(retryDelayMs(MAX_ATTEMPTS), null);
  assert.equal(retryDelayMs(0), null);
});

test("webhook URLs must be public https; localhost only outside production", () => {
  assert.ok(validateEndpointUrl("webhook", "https://hooks.zapier.com/hooks/catch/1/abc/", true).ok);
  for (const bad of ["http://example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://db.internal/x", "https://intranet/x", "https://user:pw@example.com/x", "not a url", "ftp://example.com"]) {
    assert.ok(!validateEndpointUrl("webhook", bad, true).ok, bad);
  }
  assert.ok(validateEndpointUrl("webhook", "http://localhost:4000/hook", false).ok);
  assert.ok(!validateEndpointUrl("webhook", "http://localhost:4000/hook", true).ok);
  assert.ok(!validateEndpointUrl("webhook", "http://192.168.0.1/hook", false).ok);
});

test("chat URLs are pinned to the vendor's hosts", () => {
  assert.ok(validateEndpointUrl("slack", "https://hooks.slack.com/services/T/B/x", true).ok);
  assert.ok(!validateEndpointUrl("slack", "https://evil.com/services/T/B/x", true).ok);
  assert.ok(!validateEndpointUrl("slack", "https://hooks.slack.com.evil.com/x", true).ok);
  assert.ok(validateEndpointUrl("google_chat", "https://chat.googleapis.com/v1/spaces/A/messages?key=k&token=t", true).ok);
  assert.ok(validateEndpointUrl("teams", "https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x", true).ok);
  assert.ok(validateEndpointUrl("teams", "https://default123.4a.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x", true).ok);
  assert.ok(!validateEndpointUrl("teams", "https://logic.azure.com.evil.io/x", true).ok);
  assert.ok(!validateEndpointUrl("teams", "http://prod-12.westus.logic.azure.com/x", true).ok);
});

test("private IP detection", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"]) assert.ok(!isPrivateIp(ip), ip);
});

test("url hint hides the secret part of the URL", () => {
  const hint = urlHint("https://hooks.slack.com/services/T000/B000/SECRETSECRET");
  assert.ok(hint.startsWith("https://hooks.slack.com/…"));
  assert.ok(!hint.includes("SECRETSECRET"));
});

test("every catalogue event has a message and no raw undefined leaks", () => {
  for (const event of EVENT_NAMES) {
    const line = describeEvent(payload(event, {}));
    assert.ok(line.length > 3, event);
    assert.ok(!line.includes("undefined") && !line.includes("[object"), `${event}: ${line}`);
  }
});

test("messages are human-friendly and format money from minor units", () => {
  assert.equal(describeEvent(payload("invoice.paid", { number: "INV-1", customer: "Globex", total: 118000 })), "Invoice INV-1 from Globex is fully paid (₹1,180)");
  assert.match(describeEvent(payload("deal.stage_changed", { title: "Big deal", from: "proposal", to: "negotiation" })), /moved from proposal to negotiation/);
  assert.match(describeEvent(payload("test.ping", {})), /Test event/);
});

test("chat bodies: Slack text+blocks, Teams adaptive card, Google Chat text", () => {
  const p = payload("ticket.created", { number: "T-1", subject: "Printer <down>", priority: "high", requester_name: "Sam", url: "https://app.test/app/helpdesk/tickets/1" });
  const slack = slackBody(p);
  assert.match(slack.text, /T-1/);
  assert.ok(slack.text.endsWith("https://app.test/app/helpdesk/tickets/1"));
  assert.ok(JSON.stringify(slack.blocks).includes("&lt;down&gt;"), "mrkdwn is escaped");
  const teams = teamsBody(p);
  assert.equal(teams.type, "message");
  assert.equal(teams.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
  assert.equal(teams.attachments[0].content.type, "AdaptiveCard");
  assert.equal(teams.attachments[0].content.actions?.[0].url, "https://app.test/app/helpdesk/tickets/1");
  assert.match(googleChatBody(p).text, /<https:\/\/app\.test\/app\/helpdesk\/tickets\/1\|Open>/);
  assert.equal(teamsBody(payload("test.ping", {})).attachments[0].content.actions, undefined);
});

test("event paths and stored event lists", () => {
  assert.equal(eventPath("deal.won", { id: 7 }), "/app/crm/deals/7");
  assert.equal(eventPath("payment.received", { id: 3, invoice_id: 9 }), "/app/finance/invoices/9");
  assert.equal(eventPath("lead.captured", { deal_id: 4 }), "/app/crm/deals/4");
  assert.equal(eventPath("invoice.sent", {}), null);
  assert.deepEqual(parseEvents('["deal.won","nope",1]'), ["deal.won"]);
  assert.deepEqual(parseEvents("garbage"), []);
});
