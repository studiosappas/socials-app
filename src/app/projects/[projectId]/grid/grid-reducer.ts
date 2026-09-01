// Grid client-state reducer -- the single authoritative owner of "what rows
// and slots does the Grid show right now." Framework-agnostic (no React/DOM/
// Supabase imports) on purpose: this is pure data + pure functions, so the
// invariants below are unit-testable directly (see grid-reducer.test.ts)
// without a browser, Playwright, or a real Supabase project.
//
// WHY THIS EXISTS (branch fix/grid-batch-upload-safari-stability, round 4):
// the previous architecture (GridBoard's `overrideRows` + a per-slot
// `overrideTransform`/`overridePatch` duplicate in GridSlot) had every
// mutation's failure path do a BLANKET `setOverrideRows(null)` /
// `setOverridePatch(null)`, discarding every other slot's not-yet-refreshed
// optimistic edit along with the one that actually failed -- because
// individual mutations stopped calling `revalidatePath('/grid')` (see
// grid.ts's own comments, added to fix the earlier "batched revalidation"
// bug), a slot's successful, DB-committed change could easily still be
// showing ONLY via that discarded local state. One unrelated slot's failure
// could visibly wipe an already-successful edit on a completely different
// slot until the next `router.refresh()` happened to land -- reproduced as
// exactly the reported "wrong asset appears" / "grid disappeared, refresh
// restored it" symptoms. Undo/redo had the same shape: a full `rowsSnapshot`
// captured 4+ seconds earlier as the entire "undo" payload, restorable over
// top of newer, unrelated edits made in between.
//
// THE FIX: every entity (a slot, or a row's existence) is independently
// owned. A mutation only ever touches the slot/row ids it explicitly names
// (Invariant 2 -- "a mutation targeting Slot X may only mutate Slot X").
// Every mutation carries an opId; a slot/row remembers which opId currently
// owns it. A COMMIT or FAIL is only applied if it still matches the
// current owner -- an older operation's completion can never overwrite a
// newer one (Invariant 3), and a fresh server snapshot only ever adopts a
// slot/row that has no operation in flight, and only for the very row/slot
// ids it's actually reporting (Invariant 4). Rollback restores exactly the
// pre-mutation value of the entities that operation began -- never a
// snapshot of the whole board (Invariant 7).

// rotation is in degrees, one of 0/90/180/270 (see grid-crop-overlay.tsx's
// own comment for why free/arbitrary rotation was deliberately NOT
// implemented), optional and defaulting to 0 wherever absent -- every
// crop saved before rotation existed has no `rotation` key at all, and
// must keep loading identically. No migration: posts.cover_transform is
// already a JSONB blob, so a new optional key needs no schema change.
export type GridCoverTransform = { scale: number; x: number; y: number; rotation?: number };

export type GridBoardSlot = {
  id: string;
  postId: string | null;
  thumbnailUrl: string | null;
  coverMediaType: "image" | "video" | null;
  coverMediaAssetId: string | null;
  coverOriginalUrl: string | null;
  assetCount: number;
  coverTransform: GridCoverTransform | null;
  scheduledDate: string | null;
  // Stable React key across a temp-id -> real-id reconciliation (Add Row's
  // optimistic slots). `id` itself is reassigned in place on reconciliation.
  clientKey?: string;
};

export type GridBoardRow = { id: string; slots: GridBoardSlot[]; clientKey?: string };

// THE canonical "is this slot empty or does it have content" answer -- used
// for BOTH what gets rendered (an image/video badge vs. the empty "+ Empty"
// placeholder) AND what a click on it does (open the Library picker vs.
// route to the Post Editor / Crop). Deliberately NOT based on `postId`:
// assignMediaToSlot's own optimistic value sets `thumbnailUrl`/
// `coverMediaAssetId` the instant a click/drop happens, but can't know the
// real `postId` until placeMediaInSlot's server round-trip returns one (a
// brand-new post is only created there). A slot going through that pending
// window was visually showing the newly picked image while `postId` was
// still null -- and grid-board.tsx's outer click handler used to route
// click/dblclick based on `slot.postId` being falsy, meaning EVERY click on
// that visually-filled tile reopened the Library picker for as long as the
// assignment was in flight. This is the exact, confirmed cause of "single-
// and double-clicking an already-filled image can open the Library" -- not
// inferred, found by reading assignMediaToSlot's own optimistic value
// against the click router it feeds. Fixed at the root by giving "filled"
// one single, content-based definition instead of relying on `postId`
// (which answers a related but different question: "does a persisted post
// exist yet"), and using that same definition everywhere a filled/empty
// decision is made.
export function isSlotFilled(slot: GridBoardSlot): boolean {
  return slot.thumbnailUrl !== null || slot.coverMediaType === "video";
}

type SlotState = {
  value: GridBoardSlot;
  pendingOpId: string | null;
  // Snapshot of `value` from immediately before the current pendingOpId's
  // optimistic apply -- the ONLY thing a FAIL for that exact opId restores.
  rollbackTo: GridBoardSlot | null;
};

type RowMeta = {
  clientKey: string;
  slotIds: string[];
  // Locally requested removal, not yet structurally dropped -- distinct
  // from the row simply not existing, so a FAIL can bring it back.
  removed: boolean;
  pendingOpId: string | null;
};

export type GridState = {
  // Display order. Includes temp (not-yet-reconciled) row ids and real ones.
  rowIds: string[];
  rowMeta: Record<string, RowMeta>;
  slots: Record<string, SlotState>;
  // Sticky tombstones for rows this client has confirmed deleted -- once a
  // ROW_REMOVE_COMMIT lands, that row id is never resurrected by a later
  // server snapshot, even one whose own fetch happened to be initiated
  // before the delete but arrives after (Invariant 4 in the one case a
  // simple "pendingOpId === null" check can't tell apart, since there's no
  // server-side revision this client can compare against). There is no
  // "undo a row removal" feature today (see grid-board.tsx's comment on
  // handleRemoveRow), so this sticky behavior costs nothing real.
  confirmedRemovedRowIds: Set<string>;
  // Row-order (drag-the-whole-row) reorder in flight -- see ROW_REORDER_*
  // below. Only one reorder is ever in flight at a time (drag-and-drop is
  // inherently serial: you can't start a second row drag while one is
  // still being dropped/settling), so a single global opId + rollback
  // snapshot of the whole `rowIds` array is enough here, unlike the
  // per-slot/per-row mutations above which can genuinely be concurrent
  // and so need their own independent rollback target each.
  rowOrder: { pendingOpId: string | null; rollbackRowIds: string[] | null };
};

export function newOpId(): string {
  return crypto.randomUUID();
}

export function initGridState(rows: GridBoardRow[]): GridState {
  const rowIds: string[] = [];
  const rowMeta: Record<string, RowMeta> = {};
  const slots: Record<string, SlotState> = {};
  for (const row of rows) {
    rowIds.push(row.id);
    rowMeta[row.id] = {
      clientKey: row.clientKey ?? row.id,
      slotIds: row.slots.map((s) => s.id),
      removed: false,
      pendingOpId: null,
    };
    for (const slot of row.slots) {
      slots[slot.id] = { value: slot, pendingOpId: null, rollbackTo: null };
    }
  }
  return { rowIds, rowMeta, slots, confirmedRemovedRowIds: new Set(), rowOrder: { pendingOpId: null, rollbackRowIds: null } };
}

export function deriveRows(state: GridState): GridBoardRow[] {
  return state.rowIds
    .filter((id) => !state.rowMeta[id]?.removed)
    .map((id) => {
      const meta = state.rowMeta[id];
      return {
        id,
        clientKey: meta.clientKey,
        slots: meta.slotIds.map((sid) => state.slots[sid].value),
      };
    });
}

// True while ANY entity (slot or row) has an operation in flight -- the one
// thing that gates whether it's currently safe to fire a `router.refresh()`
// at all (see grid-board.tsx's requestIdleRefresh). Firing a refresh while
// something is still pending risks the server's read happening before that
// pending write's own commit reaches the database, which would make the
// refreshed snapshot legitimately stale for that entity -- deferring until
// this is false removes that race entirely, since by the time it's called
// every earlier mutation's own await has already returned (its write is
// durably committed), so any subsequent read -- whenever it actually runs
// server-side -- is guaranteed to see it.
export function hasPendingWork(state: GridState): boolean {
  if (state.rowOrder.pendingOpId) return true;
  for (const id of state.rowIds) {
    if (state.rowMeta[id]?.pendingOpId) return true;
  }
  for (const id of Object.keys(state.slots)) {
    if (state.slots[id].pendingOpId) return true;
  }
  return false;
}

export type GridAction =
  | { type: "SERVER_ROWS_RECEIVED"; rows: GridBoardRow[] }
  | { type: "SLOT_BEGIN"; opId: string; slotId: string; value: GridBoardSlot }
  | { type: "SLOT_COMMIT"; opId: string; slotId: string; patch?: Partial<GridBoardSlot> }
  | { type: "SLOT_FAIL"; opId: string; slotId: string }
  | {
      type: "ROW_ADD_BEGIN";
      opId: string;
      tempRowId: string;
      clientKey: string;
      tempSlots: GridBoardSlot[];
    }
  | { type: "ROW_ADD_COMMIT"; opId: string; tempRowId: string; realRowId: string; realSlotIds: string[] }
  | { type: "ROW_ADD_FAIL"; opId: string; tempRowId: string }
  | { type: "ROW_REMOVE_BEGIN"; opId: string; rowId: string }
  | { type: "ROW_REMOVE_COMMIT"; opId: string; rowId: string }
  | { type: "ROW_REMOVE_FAIL"; opId: string; rowId: string }
  // Drag-the-whole-row reorder -- nextRowIds is the full, already-permuted
  // display order (e.g. from dnd-kit's arrayMove), applied immediately on
  // BEGIN so the drag feels instant. Narrow, not whole-board: this only
  // ever touches `rowIds`/`rowOrder`, never any row's own slotIds/removed
  // flag or any slot's own value (Invariant 2).
  | { type: "ROW_REORDER_BEGIN"; opId: string; nextRowIds: string[] }
  | { type: "ROW_REORDER_COMMIT"; opId: string }
  | { type: "ROW_REORDER_FAIL"; opId: string };

export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    // The one place server data enters this reducer. Structural merge, not
    // a replace: a row/slot with an operation still in flight keeps its
    // local value regardless of what the snapshot says (Invariant 4); a
    // temp row not yet reconciled is preserved even though the server has
    // never heard of it; a confirmed-removed row never comes back.
    case "SERVER_ROWS_RECEIVED": {
      const incoming = action.rows;
      const incomingIds = new Set(incoming.map((r) => r.id));
      const incomingById = new Map(incoming.map((r) => [r.id, r]));
      const rowMeta: Record<string, RowMeta> = {};
      const slots = { ...state.slots };
      const nextRowIds: string[] = [];

      function mergeRow(row: GridBoardRow) {
        const existing = state.rowMeta[row.id];
        rowMeta[row.id] = {
          clientKey: existing?.clientKey ?? row.clientKey ?? row.id,
          slotIds: row.slots.map((s) => s.id),
          removed: existing?.pendingOpId ? existing.removed : false,
          pendingOpId: existing?.pendingOpId ?? null,
        };
        for (const slot of row.slots) {
          const existingSlot = state.slots[slot.id];
          if (!existingSlot || existingSlot.pendingOpId === null) {
            slots[slot.id] = { value: slot, pendingOpId: null, rollbackTo: null };
          }
          // else: a mutation for this exact slot is still in flight --
          // narrow skip, keep the local optimistic value (Invariant 4).
        }
      }

      if (state.rowOrder.pendingOpId) {
        // A row-order reorder is still in flight -- the local `rowIds`
        // ARRAY ORDER is the source of truth until it settles (Invariant 4
        // applied to order itself, not just individual row/slot values).
        // Per-row/per-slot CONTENT still comes fresh from this snapshot;
        // only the sequence they're displayed in is held. Any row this
        // snapshot reports that isn't in the local order yet (added by
        // another client concurrently) is appended at the end -- rare, and
        // a safe default until the NEXT snapshot (after this reorder
        // settles) resolves its real position.
        for (const id of state.rowIds) {
          const row = incomingById.get(id);
          if (row) {
            nextRowIds.push(id);
            mergeRow(row);
          } else if (state.rowMeta[id]?.pendingOpId) {
            nextRowIds.push(id);
            rowMeta[id] = state.rowMeta[id];
          }
          // else: existed locally, snapshot no longer has it, not pending
          // -- drop it (e.g. removed by another client).
        }
        for (const row of incoming) {
          if (nextRowIds.includes(row.id) || state.confirmedRemovedRowIds.has(row.id)) continue;
          nextRowIds.push(row.id);
          mergeRow(row);
        }
      } else {
        for (const id of state.rowIds) {
          if (!incomingIds.has(id) && state.rowMeta[id]?.pendingOpId) {
            // A temp (not-yet-reconciled) row, or a real row whose own
            // structural op hasn't been confirmed by THIS snapshot yet.
            nextRowIds.push(id);
            rowMeta[id] = state.rowMeta[id];
          }
        }
        for (const row of incoming) {
          if (state.confirmedRemovedRowIds.has(row.id)) continue;
          nextRowIds.push(row.id);
          mergeRow(row);
        }
      }
      for (const id of Object.keys(slots)) {
        if (!Object.values(rowMeta).some((m) => m.slotIds.includes(id))) delete slots[id];
      }

      return {
        rowIds: nextRowIds,
        rowMeta,
        slots,
        confirmedRemovedRowIds: state.confirmedRemovedRowIds,
        rowOrder: state.rowOrder,
      };
    }

    case "SLOT_BEGIN": {
      const existing = state.slots[action.slotId];
      return {
        ...state,
        slots: {
          ...state.slots,
          [action.slotId]: {
            value: action.value,
            pendingOpId: action.opId,
            // Chain of custody back to the last truly-settled value: if a
            // second mutation starts on this slot before the first one
            // resolved, keep the ORIGINAL rollback target, not the first
            // mutation's own (still-unconfirmed) optimistic value -- a FAIL
            // must always be able to get back to real, committed ground.
            rollbackTo: existing?.pendingOpId ? existing.rollbackTo : (existing?.value ?? null),
          },
        },
      };
    }

    case "SLOT_COMMIT": {
      const existing = state.slots[action.slotId];
      // A newer operation already took this slot over -- an older
      // completion must never overwrite it (Invariant 3).
      if (!existing || existing.pendingOpId !== action.opId) return state;
      return {
        ...state,
        slots: {
          ...state.slots,
          [action.slotId]: {
            value: action.patch ? { ...existing.value, ...action.patch } : existing.value,
            pendingOpId: null,
            rollbackTo: null,
          },
        },
      };
    }

    case "SLOT_FAIL": {
      const existing = state.slots[action.slotId];
      if (!existing || existing.pendingOpId !== action.opId) return state;
      return {
        ...state,
        slots: {
          ...state.slots,
          [action.slotId]: {
            value: existing.rollbackTo ?? existing.value,
            pendingOpId: null,
            rollbackTo: null,
          },
        },
      };
    }

    case "ROW_ADD_BEGIN": {
      const rowMeta = {
        ...state.rowMeta,
        [action.tempRowId]: {
          clientKey: action.clientKey,
          slotIds: action.tempSlots.map((s) => s.id),
          removed: false,
          pendingOpId: action.opId,
        },
      };
      const slots = { ...state.slots };
      for (const slot of action.tempSlots) {
        slots[slot.id] = { value: slot, pendingOpId: action.opId, rollbackTo: null };
      }
      return { ...state, rowIds: [action.tempRowId, ...state.rowIds], rowMeta, slots };
    }

    case "ROW_ADD_COMMIT": {
      const meta = state.rowMeta[action.tempRowId];
      if (!meta || meta.pendingOpId !== action.opId) return state;
      const rowMeta = { ...state.rowMeta };
      delete rowMeta[action.tempRowId];
      rowMeta[action.realRowId] = { ...meta, slotIds: action.realSlotIds, pendingOpId: null };

      const slots = { ...state.slots };
      meta.slotIds.forEach((tempSlotId, i) => {
        const realSlotId = action.realSlotIds[i];
        const slotState = slots[tempSlotId];
        delete slots[tempSlotId];
        if (slotState && realSlotId) {
          slots[realSlotId] = {
            value: { ...slotState.value, id: realSlotId },
            pendingOpId: null,
            rollbackTo: null,
          };
        }
      });

      return {
        ...state,
        rowIds: state.rowIds.map((id) => (id === action.tempRowId ? action.realRowId : id)),
        rowMeta,
        slots,
      };
    }

    case "ROW_ADD_FAIL": {
      const meta = state.rowMeta[action.tempRowId];
      if (!meta || meta.pendingOpId !== action.opId) return state;
      const rowMeta = { ...state.rowMeta };
      delete rowMeta[action.tempRowId];
      const slots = { ...state.slots };
      for (const slotId of meta.slotIds) delete slots[slotId];
      return {
        ...state,
        rowIds: state.rowIds.filter((id) => id !== action.tempRowId),
        rowMeta,
        slots,
      };
    }

    case "ROW_REMOVE_BEGIN": {
      const meta = state.rowMeta[action.rowId];
      if (!meta) return state;
      // Taking ownership of the row away from whatever previously owned it
      // (e.g. its own still-pending Add Row) -- that owner's eventual
      // COMMIT/FAIL will now correctly no-op (Invariant 3), but its slots
      // must not be left with a pendingOpId nothing will ever clear: with
      // the row hidden, nothing will ever dispatch a matching SLOT_COMMIT/
      // SLOT_FAIL for them (they're not shown, nothing can mutate them),
      // which would otherwise orphan them as permanently "pending" and
      // wrongly block every future refresh (see hasPendingWork). Found via
      // this file's own randomized adversarial test (grid-reducer.test.ts),
      // not observed live -- removing a row that's still mid-optimistic-add
      // is an edge case, not the reported bug, but the fuzzer doesn't care
      // how unlikely a sequence is, only whether it's reachable.
      const slots = { ...state.slots };
      for (const slotId of meta.slotIds) {
        if (slots[slotId]) slots[slotId] = { ...slots[slotId], pendingOpId: null, rollbackTo: null };
      }
      return {
        ...state,
        rowMeta: { ...state.rowMeta, [action.rowId]: { ...meta, removed: true, pendingOpId: action.opId } },
        slots,
      };
    }

    case "ROW_REMOVE_COMMIT": {
      const meta = state.rowMeta[action.rowId];
      if (!meta || meta.pendingOpId !== action.opId) return state;
      const confirmedRemovedRowIds = new Set(state.confirmedRemovedRowIds);
      confirmedRemovedRowIds.add(action.rowId);
      return {
        ...state,
        rowMeta: { ...state.rowMeta, [action.rowId]: { ...meta, pendingOpId: null } },
        confirmedRemovedRowIds,
      };
    }

    case "ROW_REMOVE_FAIL": {
      const meta = state.rowMeta[action.rowId];
      if (!meta || meta.pendingOpId !== action.opId) return state;
      return {
        ...state,
        rowMeta: { ...state.rowMeta, [action.rowId]: { ...meta, removed: false, pendingOpId: null } },
      };
    }

    case "ROW_REORDER_BEGIN": {
      return {
        ...state,
        rowIds: action.nextRowIds,
        rowOrder: {
          pendingOpId: action.opId,
          // Chain of custody back to the last truly-settled order, same
          // reasoning as SLOT_BEGIN's rollbackTo: if a second reorder
          // starts before the first one resolved, keep the ORIGINAL
          // rollback target, not the first reorder's own (still
          // unconfirmed) optimistic order -- a FAIL must always be able to
          // get back to real, committed order.
          rollbackRowIds: state.rowOrder.pendingOpId ? state.rowOrder.rollbackRowIds : state.rowIds,
        },
      };
    }

    case "ROW_REORDER_COMMIT": {
      // A newer reorder already took over -- an older completion must
      // never overwrite it (Invariant 3).
      if (state.rowOrder.pendingOpId !== action.opId) return state;
      return { ...state, rowOrder: { pendingOpId: null, rollbackRowIds: null } };
    }

    case "ROW_REORDER_FAIL": {
      if (state.rowOrder.pendingOpId !== action.opId) return state;
      return {
        ...state,
        rowIds: state.rowOrder.rollbackRowIds ?? state.rowIds,
        rowOrder: { pendingOpId: null, rollbackRowIds: null },
      };
    }

    default:
      return state;
  }
}
