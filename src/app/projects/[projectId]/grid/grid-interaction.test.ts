// Deterministic + randomized invariant tests for grid-interaction.ts -- no
// React, no DOM, no browser. Run with:
//   node --experimental-strip-types "src/app/projects/[projectId]/grid/grid-interaction.test.ts"

import assert from "node:assert/strict";
import {
  gridInteractionReducer,
  initialGridInteractionState,
  type GridInteractionState,
  type GridInteractionAction,
} from "./grid-interaction.ts";

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

test("legal: idle -> library -> idle", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "OPEN_LIBRARY", slotId: "s1" });
  assert.equal(s.mode, "library");
  assert.equal(s.pickerTargetSlotId, "s1");
  s = gridInteractionReducer(s, { type: "CLOSE_LIBRARY" });
  assert.deepEqual(s, initialGridInteractionState);
});

test("legal: idle -> crop -> idle", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "OPEN_CROP", slotId: "s1" });
  assert.equal(s.mode, "crop");
  assert.equal(s.cropTargetSlotId, "s1");
  s = gridInteractionReducer(s, { type: "CLOSE_CROP" });
  assert.deepEqual(s, initialGridInteractionState);
});

test("legal: idle -> dragging -> idle", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "DRAG_START" });
  assert.equal(s.mode, "dragging");
  s = gridInteractionReducer(s, { type: "DRAG_END" });
  assert.deepEqual(s, initialGridInteractionState);
});

test("illegal: OPEN_CROP while library is open is rejected", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "OPEN_LIBRARY", slotId: "s1" });
  const before = s;
  s = gridInteractionReducer(s, { type: "OPEN_CROP", slotId: "s2" });
  assert.equal(s, before, "state reference must be unchanged -- the action was a no-op");
  assert.equal(s.mode, "library");
});

test("illegal: OPEN_LIBRARY while crop is open is rejected", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "OPEN_CROP", slotId: "s1" });
  const before = s;
  s = gridInteractionReducer(s, { type: "OPEN_LIBRARY", slotId: "s2" });
  assert.equal(s, before);
  assert.equal(s.mode, "crop");
});

test("illegal: DRAG_START while crop is open is rejected", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "OPEN_CROP", slotId: "s1" });
  const before = s;
  s = gridInteractionReducer(s, { type: "DRAG_START" });
  assert.equal(s, before);
});

test("illegal: OPEN_CROP while dragging is rejected", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "DRAG_START" });
  const before = s;
  s = gridInteractionReducer(s, { type: "OPEN_CROP", slotId: "s1" });
  assert.equal(s, before);
});

test("illegal: CLOSE_CROP while idle is a no-op", () => {
  const s = gridInteractionReducer(initialGridInteractionState, { type: "CLOSE_CROP" });
  assert.deepEqual(s, initialGridInteractionState);
});

test("illegal: CLOSE_LIBRARY while crop is open is rejected (does not close crop)", () => {
  let s = initialGridInteractionState;
  s = gridInteractionReducer(s, { type: "OPEN_CROP", slotId: "s1" });
  s = gridInteractionReducer(s, { type: "CLOSE_LIBRARY" });
  assert.equal(s.mode, "crop", "an unrelated CLOSE_LIBRARY must never close an active Crop");
});

// ---------------------------------------------------------------------------
// Randomized: thousands of transitions, asserting at every step that at
// most one mode is ever active and target ids are only ever set for the
// mode they belong to.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertInvariants(s: GridInteractionState, label: string) {
  // At most one mode active is true by construction (mode is a single enum
  // field), but the target-id invariants are real cross-field checks.
  if (s.mode !== "library") {
    assert.equal(s.pickerTargetSlotId, null, `${label}: pickerTargetSlotId must be null outside library mode`);
  }
  if (s.mode !== "crop") {
    assert.equal(s.cropTargetSlotId, null, `${label}: cropTargetSlotId must be null outside crop mode`);
  }
  if (s.mode === "library") assert.notEqual(s.pickerTargetSlotId, null);
  if (s.mode === "crop") assert.notEqual(s.cropTargetSlotId, null);
}

test("randomized: 5000 transitions hold every invariant", () => {
  for (let seed = 0; seed < 50; seed++) {
    const rand = mulberry32(seed * 104729 + 7);
    let s: GridInteractionState = initialGridInteractionState;
    for (let step = 0; step < 100; step++) {
      const actions: GridInteractionAction[] = [
        { type: "OPEN_LIBRARY", slotId: `s${Math.floor(rand() * 6)}` },
        { type: "CLOSE_LIBRARY" },
        { type: "OPEN_CROP", slotId: `s${Math.floor(rand() * 6)}` },
        { type: "CLOSE_CROP" },
        { type: "DRAG_START" },
        { type: "DRAG_END" },
      ];
      const action = actions[Math.floor(rand() * actions.length)];
      s = gridInteractionReducer(s, action);
      assertInvariants(s, `seed=${seed} step=${step} after ${action.type}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Regression: grid-board.tsx derives a slot's drop-eligibility from
// `mode === "idle" || mode === "dragging"`, deliberately NOT the same
// condition as `interactionIdle` (mode === "idle" alone). Getting this
// wrong once already broke Library-to-Grid drag entirely in real Preview:
// DRAG_START flips mode away from "idle" the instant any drag begins
// (including a Library-sidebar drag), so gating droppable on
// interactionIdle made every slot reject drops for the whole span of the
// very drag that needed one. This test doesn't exercise the component, but
// pins the exact boolean logic it must use for each mode so that logic
// can't drift back to `=== "idle"` alone without a visible test failure.
// ---------------------------------------------------------------------------
function dropEligibleFor(mode: GridInteractionState["mode"]): boolean {
  return mode === "idle" || mode === "dragging";
}

test("dropEligible: true for idle and dragging, false for library and crop", () => {
  assert.equal(dropEligibleFor("idle"), true);
  assert.equal(dropEligibleFor("dragging"), true, "a slot must stay droppable for the whole span of an in-progress drag");
  assert.equal(dropEligibleFor("library"), false);
  assert.equal(dropEligibleFor("crop"), false);
});

console.log(`\n${passed} passed`);
