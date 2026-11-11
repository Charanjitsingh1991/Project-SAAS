import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessFor } from "../trial";

const now = new Date("2026-11-11T12:00:00Z");
const base = {
  trialStartedAt: new Date("2026-10-01T00:00:00Z"),
  trialEndsAt: new Date("2026-10-15T00:00:00Z"),
  subscriptionStatus: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
};

describe("free (comped) access", () => {
  it("keeps an expired-trial workspace open when comped", () => {
    assert.equal(accessFor(base, now).state, "locked");
    assert.equal(accessFor({ ...base, compedAt: new Date("2026-11-01") }, now).state, "comped");
  });

  it("takes precedence over a failed subscription", () => {
    const pastDue = { ...base, stripeSubscriptionId: "sub_1", subscriptionStatus: "past_due" };
    assert.equal(accessFor(pastDue, now).state, "past_due");
    assert.equal(accessFor({ ...pastDue, compedAt: now }, now).state, "comped");
  });

  it("is off by default", () => {
    assert.equal(accessFor({ ...base, trialEndsAt: new Date("2026-11-20T00:00:00Z"), compedAt: null }, now).state, "trial");
  });
});
