// Tests for calendar-cells.ts's pure month layout -- no Supabase, no React.
// Run with:
//   node --experimental-strip-types src/lib/calendar-cells.test.ts

import assert from "node:assert/strict";
import { buildCalendarCells, calendarGridRange, type CalendarItem } from "./calendar-cells.ts";

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

const item = (itemType: "post" | "story", itemId: string): CalendarItem => ({
  itemType,
  itemId,
  label: itemType === "post" ? "post" : "",
  thumbnailUrl: null,
  assetUrls: [],
  href: `/x/${itemId}`,
  status: "draft",
});

// November 2026: the 1st is a Sunday, the 30th a Monday.
const NOV = new Date("2026-11-15T00:00:00");

test("grid range covers whole weeks, Sunday start", () => {
  const r = calendarGridRange(NOV, 0);
  assert.equal(r.gridStartStr, "2026-11-01");
  assert.equal(r.gridEndStr, "2026-12-05");
});

test("grid range covers whole weeks, Monday start", () => {
  const r = calendarGridRange(NOV, 1);
  assert.equal(r.gridStartStr, "2026-10-26");
  assert.equal(r.gridEndStr, "2026-12-06");
});

test("one cell per grid day, a multiple of 7, starting on the week start", () => {
  for (const weekStartsOn of [0, 1] as const) {
    const cells = buildCalendarCells({ anchor: NOV, weekStartsOn, todayStr: "", items: [], noteByDate: new Map() });
    const r = calendarGridRange(NOV, weekStartsOn);
    assert.equal(cells.length % 7, 0);
    assert.equal(cells[0].date, r.gridStartStr);
    assert.equal(cells[cells.length - 1].date, r.gridEndStr);
    assert.equal(new Date(`${cells[0].date}T00:00:00`).getDay(), weekStartsOn);
  }
});

test("isCurrentMonth, dayNumber and isToday", () => {
  const cells = buildCalendarCells({ anchor: NOV, weekStartsOn: 1, todayStr: "2026-11-10", items: [], noteByDate: new Map() });
  const byDate = new Map(cells.map((c) => [c.date, c]));
  assert.equal(byDate.get("2026-10-31")!.isCurrentMonth, false);
  assert.equal(byDate.get("2026-11-01")!.isCurrentMonth, true);
  assert.equal(byDate.get("2026-12-01")!.isCurrentMonth, false);
  assert.equal(byDate.get("2026-12-01")!.dayNumber, 1);
  assert.deepEqual(
    cells.filter((c) => c.isToday).map((c) => c.date),
    ["2026-11-10"],
  );
});

test("items land on their date in the given order; notes attach; empty days are empty", () => {
  const p1 = item("post", "p1");
  const p2 = item("post", "p2");
  const s1 = item("story", "s1");
  const cells = buildCalendarCells({
    anchor: NOV,
    weekStartsOn: 0,
    todayStr: "",
    items: [
      { date: "2026-11-03", item: p1 },
      { date: "2026-11-03", item: p2 },
      { date: "2026-11-03", item: s1 },
      { date: "2026-12-02", item: item("post", "trailing") },
    ],
    noteByDate: new Map([["2026-11-18", "Shoot"]]),
  });
  const byDate = new Map(cells.map((c) => [c.date, c]));
  assert.deepEqual(byDate.get("2026-11-03")!.items, [p1, p2, s1]);
  assert.equal(byDate.get("2026-11-03")!.items[0], p1, "same object, not a copy");
  assert.equal(byDate.get("2026-12-02")!.items[0].itemId, "trailing", "trailing-week days still show content");
  assert.equal(byDate.get("2026-11-18")!.note, "Shoot");
  assert.equal(byDate.get("2026-11-04")!.note, null);
  assert.deepEqual(byDate.get("2026-11-04")!.items, []);
});

test("items dated outside the grid are dropped, not misplaced", () => {
  const cells = buildCalendarCells({
    anchor: NOV,
    weekStartsOn: 0,
    todayStr: "",
    items: [
      { date: "2026-10-15", item: item("post", "before") },
      { date: "2027-01-10", item: item("post", "after") },
    ],
    noteByDate: new Map([["2026-10-15", "outside"]]),
  });
  assert.equal(cells.flatMap((c) => c.items).length, 0);
  assert.equal(cells.filter((c) => c.note).length, 0);
});

console.log(`\n${passed} passed`);
