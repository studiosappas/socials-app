// Keeps the Library's optimistic upload order and its server order (Grid
// page's media_assets query: created_at DESC) identical, with no refresh.
//
// Storage uploads stay concurrent (uploadFilesConcurrently's worker pool),
// but each file's DB insert -- the moment its created_at is stamped -- waits
// its turn here, so inserts land in exactly the order the caller enqueued
// them regardless of which file's bytes finished uploading first. Before
// this, a concurrent batch got created_at in network-finish order, so a
// refresh could reshuffle a batch relative to what the client showed.
//
// A turn completes only when BOTH the previous turn has completed AND this
// one has been released -- so a file that fails early (size check, storage
// error) and releases before its predecessor has inserted can never let its
// successor jump ahead. Every enqueued id MUST eventually be released
// (success or failure), or every later turn waits forever; the Library
// releases in its single per-file outcome handler, and uploadFilesConcurrently
// guarantees exactly one outcome per file.
//
// Pure (no React/DOM) -- tested by upload-insert-order.test.ts.
export function createInsertSequencer() {
  let tail: Promise<void> = Promise.resolve();
  const turns = new Map<string, { ready: Promise<void>; release: () => void }>();

  return {
    // Reserves a place in line for each id, in the given order. Callers pass
    // the order inserts should HAPPEN in (oldest created_at first).
    enqueue(ids: string[]) {
      for (const id of ids) {
        const ready = tail;
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        tail = Promise.all([ready, released]).then(() => undefined);
        turns.set(id, { ready, release });
      }
    },
    // Resolves once every id enqueued before this one has completed. An id
    // that was never enqueued doesn't wait.
    waitTurn(id: string): Promise<void> {
      return turns.get(id)?.ready ?? Promise.resolve();
    },
    // Marks this id's insert as finished (succeeded OR failed) -- idempotent.
    release(id: string) {
      const turn = turns.get(id);
      if (!turn) return;
      turns.delete(id);
      turn.release();
    },
  };
}

export type InsertSequencer = ReturnType<typeof createInsertSequencer>;

// The Library's canonical ordering is newest-first (created_at DESC), so a
// batch whose placeholders are shown in SELECTION order at the top must be
// inserted in REVERSE selection order: the first-selected file is inserted
// last, becomes the newest row, and therefore sorts first after refresh.
export function insertOrderForNewestFirst<T>(selectionOrder: T[]): T[] {
  return [...selectionOrder].reverse();
}
