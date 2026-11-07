// Tests for schedule-status.ts's date-driven status rules and the Calendar's
// dark-day rule they feed -- no Supabase, no React. Run with:
//   node --experimental-strip-types src/lib/schedule-status.test.ts

import assert from "node:assert/strict";
import { applyScheduleDateEdit, isAutoPublishable, statusForScheduleChange } from "./schedule-status.ts";
import { isDayAllPublished } from "./calendar-cells.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const TODAY = "2026-11-07";

// Date assignment
test("draft given a date becomes scheduled", () => {
  assert.equal(statusForScheduleChange("draft", null, "2026-11-20"), "scheduled");
});
test("draft given a past date becomes scheduled", () => {
  assert.equal(statusForScheduleChange("draft", null, "2026-11-01"), "scheduled");
});
test("dated draft moved to another date becomes scheduled", () => {
  assert.equal(statusForScheduleChange("draft", "2026-11-01", "2026-11-02"), "scheduled");
});
test("empty-string date (form field) counts as no date", () => {
  assert.equal(statusForScheduleChange("draft", "", ""), "draft");
  assert.equal(statusForScheduleChange("draft", null, ""), "draft");
});

// Date removal
test("scheduled with its date removed becomes draft", () => {
  assert.equal(statusForScheduleChange("scheduled", "2026-11-20", null), "draft");
  assert.equal(statusForScheduleChange("scheduled", "2026-11-20", ""), "draft");
});
test("draft with its date removed stays draft", () => {
  assert.equal(statusForScheduleChange("draft", "2026-11-20", null), "draft");
});

// Status preservation
test("published is never rewritten by a date change", () => {
  assert.equal(statusForScheduleChange("published", null, "2026-11-20"), "published");
  assert.equal(statusForScheduleChange("published", "2026-11-01", null), "published");
  assert.equal(statusForScheduleChange("published", "2026-11-01", "2026-11-05"), "published");
});
test("in_review is never rewritten by a date change", () => {
  assert.equal(statusForScheduleChange("in_review", null, "2026-11-20"), "in_review");
  assert.equal(statusForScheduleChange("in_review", "2026-11-20", null), "in_review");
});
test("story-only statuses pass through", () => {
  for (const s of ["ready", "approved", "sent", "delivered"]) {
    assert.equal(statusForScheduleChange(s, null, "2026-11-20"), s);
    assert.equal(statusForScheduleChange(s, "2026-11-20", null), s);
  }
});
test("unchanged date keeps an explicit status, incl. a hand-picked draft", () => {
  assert.equal(statusForScheduleChange("draft", "2026-11-20", "2026-11-20"), "draft");
  assert.equal(statusForScheduleChange("scheduled", "2026-11-20", "2026-11-20"), "scheduled");
});
test("scheduled moved to another date stays scheduled", () => {
  assert.equal(statusForScheduleChange("scheduled", "2026-11-20", "2026-11-21"), "scheduled");
});

// Post Editor: unsaved date-picker edits update Status immediately
test("editor: picking a date on a draft shows scheduled", () => {
  assert.deepEqual(applyScheduleDateEdit({ status: "draft", date: "" }, "2026-11-20"), { status: "scheduled", date: "2026-11-20" });
});
test("editor: clearing the date on a scheduled post shows draft", () => {
  assert.deepEqual(applyScheduleDateEdit({ status: "scheduled", date: "2026-11-20" }, ""), { status: "draft", date: "" });
});
test("editor: published / in_review are kept while editing the date", () => {
  assert.equal(applyScheduleDateEdit({ status: "published", date: "" }, "2026-11-20").status, "published");
  assert.equal(applyScheduleDateEdit({ status: "in_review", date: "2026-11-20" }, "").status, "in_review");
});
test("editor: pick then clear before saving returns to draft", () => {
  const picked = applyScheduleDateEdit({ status: "draft", date: "" }, "2026-11-20");
  assert.deepEqual(applyScheduleDateEdit(picked, ""), { status: "draft", date: "" });
});
test("editor: re-picking the same date leaves status alone", () => {
  assert.equal(applyScheduleDateEdit({ status: "draft", date: "2026-11-20" }, "2026-11-20").status, "draft");
});
test("editor: an edit returns new state and never mutates the original (discard on close)", () => {
  const original = { status: "draft" as const, date: "" };
  applyScheduleDateEdit(original, "2026-11-20");
  assert.deepEqual(original, { status: "draft", date: "" });
});
test("editor + server agree: unsaved edit and save-time rule give the same status", () => {
  const edited = applyScheduleDateEdit({ status: "draft", date: "" }, "2026-11-20");
  assert.equal(statusForScheduleChange(edited.status, null, edited.date), edited.status);
  const cleared = applyScheduleDateEdit({ status: "scheduled", date: "2026-11-20" }, "");
  assert.equal(statusForScheduleChange(cleared.status, "2026-11-20", cleared.date), cleared.status);
});

// Calendar behavior: Scheduled -> Published flip and the dark day
test("auto-publish: scheduled on or before today only", () => {
  assert.equal(isAutoPublishable("scheduled", "2026-11-06", TODAY), true);
  assert.equal(isAutoPublishable("scheduled", TODAY, TODAY), true);
  assert.equal(isAutoPublishable("scheduled", "2026-11-08", TODAY), false);
  assert.equal(isAutoPublishable("scheduled", null, TODAY), false);
  assert.equal(isAutoPublishable("draft", "2026-11-01", TODAY), false);
  assert.equal(isAutoPublishable("in_review", "2026-11-01", TODAY), false);
});
test("chain: draft dropped on a past day -> scheduled -> auto-publishable", () => {
  const status = statusForScheduleChange("draft", null, "2026-11-01");
  assert.equal(isAutoPublishable(status, "2026-11-01", TODAY), true);
});
test("chain: draft dropped on a future day is not auto-publishable yet", () => {
  const status = statusForScheduleChange("draft", null, "2026-11-30");
  assert.equal(isAutoPublishable(status, "2026-11-30", TODAY), false);
});
test("dark day only when every item is published", () => {
  assert.equal(isDayAllPublished([]), false);
  assert.equal(isDayAllPublished([{ status: "published" }]), true);
  assert.equal(isDayAllPublished([{ status: "published" }, { status: "published" }]), true);
  assert.equal(isDayAllPublished([{ status: "published" }, { status: "scheduled" }]), false);
  assert.equal(isDayAllPublished([{ status: "draft" }]), false);
});

console.log(`\n${passed} passed`);
