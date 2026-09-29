// Tests for upload-insert-order.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/upload-insert-order.test.ts
//
// The simulation below reproduces the Library's real upload shape: a
// 3-worker pool (same as uploadFilesConcurrently) where each file's
// "storage upload" finishes after an arbitrary delay, then its "insert"
// stamps a monotonically increasing created_at. The server's canonical
// Library order is created_at DESC; the client shows placeholders at the top
// in selection order. The tests assert those two orders are IDENTICAL for
// many random finish-time permutations, with failures, and across
// overlapping batches.

import assert from "node:assert/strict";
import { createInsertSequencer, insertOrderForNewestFirst } from "./upload-insert-order.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Row = { id: string; createdAt: number };

// Mirrors useLibraryItems.uploadFiles + uploadFilesConcurrently: placeholders
// prepended in selection order; files handed to a 3-worker pool in insert
// order; each worker uploads (random delay), then waits its turn, inserts,
// and releases. Failing files release without inserting.
async function runBatch(
  seq: ReturnType<typeof createInsertSequencer>,
  db: Row[],
  clock: { t: number },
  client: string[],
  selection: string[],
  delayMs: (id: string) => number,
  fails: Set<string> = new Set(),
) {
  const insertOrder = insertOrderForNewestFirst(selection);
  client.unshift(...selection);
  seq.enqueue(insertOrder);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= insertOrder.length) return;
      const id = insertOrder[i];
      await sleep(delayMs(id));
      if (fails.has(id)) {
        seq.release(id);
        client.splice(client.indexOf(id), 1);
        continue;
      }
      await seq.waitTurn(id);
      await sleep(delayMs(id) % 3); // the insert itself takes time too
      db.push({ id, createdAt: ++clock.t });
      seq.release(id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, insertOrder.length) }, worker));
}

function serverOrder(db: Row[]) {
  return [...db].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.id);
}

await test("single batch: client order == server order across 200 random finish-time permutations", async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = rng(seed);
    const existing: Row[] = [{ id: "old-1", createdAt: -2 }, { id: "old-2", createdAt: -3 }];
    const db = [...existing];
    const client = serverOrder(db);
    const selection = Array.from({ length: 1 + Math.floor(rand() * 7) }, (_, i) => `f${i}`);
    const delays = new Map(selection.map((id) => [id, Math.floor(rand() * 8)]));
    await runBatch(createInsertSequencer(), db, { t: 0 }, client, selection, (id) => delays.get(id)!);
    assert.deepEqual(client, serverOrder(db), `seed ${seed}`);
    assert.deepEqual(client.slice(0, selection.length), selection, "new uploads first, in selection order");
    assert.deepEqual(client.slice(selection.length), ["old-1", "old-2"], "existing assets untouched, below");
  }
});

await test("failed uploads are never inserted and don't let a successor jump ahead", async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rand = rng(seed * 7);
    const db: Row[] = [];
    const client: string[] = [];
    const selection = ["a", "b", "c", "d", "e"];
    const fails = new Set(selection.filter(() => rand() < 0.35));
    const delays = new Map(selection.map((id) => [id, Math.floor(rand() * 8)]));
    await runBatch(createInsertSequencer(), db, { t: 0 }, client, selection, (id) => delays.get(id)!, fails);
    assert.deepEqual(client, serverOrder(db), `seed ${seed}`);
    assert.ok(db.every((r) => !fails.has(r.id)), "failed file inserted");
    assert.equal(new Set(db.map((r) => r.id)).size, db.length, "duplicate row");
  }
});

await test("overlapping batches: a second batch started mid-upload lands above the first, before and after refresh", async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rand = rng(seed * 13);
    const seq = createInsertSequencer();
    const db: Row[] = [];
    const client: string[] = [];
    const clock = { t: 0 };
    const delays = (id: string) => Math.floor(((id.charCodeAt(0) * 31 + id.charCodeAt(1) * 7 + seed) % 11) * rand());
    const first = runBatch(seq, db, clock, client, ["a1", "a2", "a3", "a4"], delays);
    await sleep(Math.floor(rand() * 4));
    const second = runBatch(seq, db, clock, client, ["b1", "b2"], delays);
    await Promise.all([first, second]);
    assert.deepEqual(client, ["b1", "b2", "a1", "a2", "a3", "a4"]);
    assert.deepEqual(serverOrder(db), client, `seed ${seed}`);
  }
});

await test("release is idempotent and unknown ids never block", async () => {
  const seq = createInsertSequencer();
  seq.enqueue(["x", "y"]);
  seq.release("x");
  seq.release("x");
  await seq.waitTurn("y");
  await seq.waitTurn("never-enqueued");
});

console.log(`\n${passed} passed`);
