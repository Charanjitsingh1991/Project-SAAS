import assert from "node:assert/strict";
import { test } from "node:test";
import { averageRating, clampProgress, cycleOf, cycleRange, goalStatus, goalSummary, nextReviewStatus, ratingDistribution } from "../performance";
import { activeCount, avgTimeToHireDays, canHire, canMoveStage, conversionPct, isFilled, pipelineCounts, salaryRangeError } from "../recruitment";

test("stage moves: hired is final and only reachable via hire", () => {
  assert.deepEqual(canMoveStage("applied", "screening"), { ok: true });
  assert.deepEqual(canMoveStage("interview", "applied"), { ok: true });
  assert.deepEqual(canMoveStage("rejected", "interview"), { ok: true });
  assert.equal(canMoveStage("offer", "hired").ok, false);
  assert.equal(canMoveStage("hired", "rejected").ok, false);
  assert.equal(canMoveStage("offer", "offer").ok, false);
});

test("hire requires offer stage and a vacancy", () => {
  const job = { status: "open" as const, openings: 2 };
  assert.deepEqual(canHire("offer", job, 0), { ok: true });
  assert.equal(canHire("interview", job, 0).ok, false);
  assert.equal(canHire("offer", job, 2).ok, false);
  assert.equal(canHire("offer", { status: "closed", openings: 2 }, 0).ok, false);
  assert.equal(isFilled(2, 2), true);
  assert.equal(isFilled(1, 2), false);
});

test("pipeline counts, active count and conversion", () => {
  const c = pipelineCounts([{ stage: "applied" }, { stage: "applied" }, { stage: "interview" }, { stage: "hired" }, { stage: "rejected" }]);
  assert.deepEqual(c, { applied: 2, screening: 0, interview: 1, offer: 0, hired: 1, rejected: 1 });
  assert.equal(activeCount(c), 3);
  assert.equal(conversionPct(c, "applied"), 100);
  assert.equal(conversionPct(c, "interview"), 40);
  assert.equal(conversionPct(c, "hired"), 20);
  assert.equal(conversionPct(pipelineCounts([]), "hired"), null);
});

test("time to hire and salary range", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  assert.equal(avgTimeToHireDays([]), null);
  assert.equal(avgTimeToHireDays([{ appliedAt: d("2026-01-01"), hiredAt: d("2026-01-11") }, { appliedAt: d("2026-01-01"), hiredAt: d("2026-01-21") }]), 15);
  assert.equal(salaryRangeError(0, 0), null);
  assert.equal(salaryRangeError(500, 0), null);
  assert.equal(salaryRangeError(900, 500), "Minimum can't exceed maximum.");
  assert.equal(salaryRangeError(NaN, 0), "Enter valid amounts.");
});

test("goal status from progress and due date", () => {
  const start = "2026-07-01";
  assert.equal(goalStatus({ progress: 100, dueDate: "2026-07-10", startDate: start }, "2026-12-01"), "done");
  assert.equal(goalStatus({ progress: 10, dueDate: null, startDate: start }, "2026-12-01"), "on_track");
  assert.equal(goalStatus({ progress: 90, dueDate: "2026-09-30", startDate: start }, "2026-10-01"), "off_track");
  // ~50% of time elapsed
  assert.equal(goalStatus({ progress: 45, dueDate: "2026-08-31", startDate: start }, "2026-07-31"), "on_track");
  assert.equal(goalStatus({ progress: 25, dueDate: "2026-08-31", startDate: start }, "2026-07-31"), "at_risk");
  assert.equal(goalStatus({ progress: 5, dueDate: "2026-08-31", startDate: start }, "2026-07-31"), "off_track");
  assert.equal(clampProgress(140), 100);
  assert.equal(clampProgress(-3), 0);
});

test("goal summary and ratings", () => {
  const s = goalSummary([
    { status: "on_track", progress: 50, weight: 1 },
    { status: "done", progress: 100, weight: 3 },
    { status: "off_track", progress: 0, weight: 0 },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.onTrackPct, 67);
  assert.equal(s.avgProgress, 70); // (50 + 300 + 0) / 5
  assert.equal(goalSummary([]).onTrackPct, null);
  assert.equal(averageRating([4, 5, null, 3]), 4);
  assert.equal(averageRating([]), null);
  assert.deepEqual(ratingDistribution([1, 5, 5, null, 9]), [1, 0, 0, 0, 2]);
});

test("review workflow and cycles", () => {
  assert.equal(nextReviewStatus("self_review", "submit_self", false), "manager_review");
  assert.equal(nextReviewStatus("manager_review", "submit_self", false), null);
  assert.equal(nextReviewStatus("manager_review", "complete", false), null);
  assert.equal(nextReviewStatus("self_review", "complete", true), "completed");
  assert.equal(nextReviewStatus("completed", "reopen", true), "manager_review");
  assert.equal(cycleOf("2026-03-15"), "2026-H1");
  assert.equal(cycleOf("2026-11-10"), "2026-H2");
  assert.deepEqual(cycleRange("2026-H2"), { start: "2026-07-01", end: "2026-12-31" });
  assert.deepEqual(cycleRange("2026-Q1"), { start: "2026-01-01", end: "2026-03-31" });
  assert.equal(cycleRange("2026-X"), null);
});
