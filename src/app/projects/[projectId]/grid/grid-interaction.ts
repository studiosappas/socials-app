// Grid interaction-mode reducer -- the single authoritative owner of "what
// interaction mode is the Grid in right now." Pure (no React/DOM) like
// grid-reducer.ts, for the same reason: the mutual-exclusion invariants
// below are unit-testable directly (see grid-interaction.test.ts) without a
// browser.
//
// WHY THIS EXISTS: across several rounds on this branch, interaction state
// accumulated in different places with no single owner -- a picker target
// slot id living in GridBoard, a crop-open boolean living in GridSlot's own
// local state, a pending single-click timer also local to GridSlot, drag
// state tracked separately via dnd-kit's own DragOverlay props. Nothing
// PREVENTED two of these from being simultaneously true (e.g. nothing
// stopped Library from opening while Crop was active), because there was
// no shared notion of "a mode is already active, so this can't start."
// This reducer makes that structural: every transition (open Library, open
// Crop, start dragging) is only accepted while the current mode is `idle`,
// and every accepting transition moves the mode away from `idle` --  so a
// second, conflicting transition attempted while one is already active is
// simply rejected (the reducer returns the unchanged state), not "possible
// but rare." There is exactly one field to check to answer "what mode is
// the Grid in," and exactly one place that can change it.

export type GridInteractionMode = "idle" | "library" | "crop" | "dragging";

export type GridInteractionState = {
  mode: GridInteractionMode;
  // Meaningful only while mode === "library".
  pickerTargetSlotId: string | null;
  // Meaningful only while mode === "crop".
  cropTargetSlotId: string | null;
};

export const initialGridInteractionState: GridInteractionState = {
  mode: "idle",
  pickerTargetSlotId: null,
  cropTargetSlotId: null,
};

export type GridInteractionAction =
  | { type: "OPEN_LIBRARY"; slotId: string }
  | { type: "CLOSE_LIBRARY" }
  | { type: "OPEN_CROP"; slotId: string }
  | { type: "CLOSE_CROP" }
  | { type: "DRAG_START" }
  | { type: "DRAG_END" };

export function gridInteractionReducer(
  state: GridInteractionState,
  action: GridInteractionAction,
): GridInteractionState {
  switch (action.type) {
    case "OPEN_LIBRARY":
      // Only from idle -- if Crop or a drag is already active, this is
      // rejected outright rather than silently stacking a second mode on
      // top. Nothing in this codebase currently WOULD dispatch this while
      // non-idle (Library only ever opens from an empty-slot click, and an
      // empty slot has no crop/drag surface), but the guard exists so that
      // stays true by construction, not by every call site happening to
      // agree.
      if (state.mode !== "idle") return state;
      return { mode: "library", pickerTargetSlotId: action.slotId, cropTargetSlotId: null };

    case "CLOSE_LIBRARY":
      if (state.mode !== "library") return state;
      return { ...initialGridInteractionState };

    case "OPEN_CROP":
      if (state.mode !== "idle") return state;
      return { mode: "crop", pickerTargetSlotId: null, cropTargetSlotId: action.slotId };

    case "CLOSE_CROP":
      if (state.mode !== "crop") return state;
      return { ...initialGridInteractionState };

    case "DRAG_START":
      // dnd-kit's own per-slot `disabled` flags (draggable/droppable) are
      // the first line of defense (see grid-board.tsx's useSortable call --
      // already withheld while Library or Crop is open), so this should
      // never actually fire from a non-idle state in practice. This guard
      // is the second, structural line: even if some future change to the
      // sensor config let a drag start anyway, the reducer itself refuses
      // to record it as DRAGGING while another mode is active, so
      // `hasPendingWork`-style callers still see the true active mode.
      if (state.mode !== "idle") return state;
      return { mode: "dragging", pickerTargetSlotId: null, cropTargetSlotId: null };

    case "DRAG_END":
      if (state.mode !== "dragging") return state;
      return { ...initialGridInteractionState };

    default:
      return state;
  }
}
