// Tests for upload-batch.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/upload-batch.test.ts

import assert from "node:assert/strict";
import { createUploadBatchRunner, type UploadBatchProgress } from "./upload-batch.ts";

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

const tick = () => new Promise((r) => setTimeout(r, 0));
const FALLBACK = "fallback";

await test("a second batch started while one is running is refused (no duplicate upload)", async () => {
  const runner = createUploadBatchRunner();
  let release!: () => void;
  let processCalls = 0;
  const first = runner.run(["a.mp4"], async (report) => {
    processCalls++;
    await new Promise<void>((r) => (release = r));
    report("a.mp4", null);
  }, { fallbackProblem: FALLBACK });
  assert.equal(runner.isRunning(), true);

  const second = await runner.run(["a.mp4"], async () => {
    processCalls++;
  }, { fallbackProblem: FALLBACK });
  assert.equal(second, null);

  release();
  assert.deepEqual(await first, { saved: 1, failures: [] });
  assert.equal(processCalls, 1);
  assert.equal(runner.isRunning(), false);
});

await test("a new batch can start once the previous one finished", async () => {
  const runner = createUploadBatchRunner();
  await runner.run(["a.png"], async (report) => report("a.png", null), { fallbackProblem: FALLBACK });
  const again = await runner.run(["b.png"], async (report) => report("b.png", null), { fallbackProblem: FALLBACK });
  assert.deepEqual(again, { saved: 1, failures: [] });
});

await test("one failed file is reported and the rest still save", async () => {
  const runner = createUploadBatchRunner();
  const result = await runner.run(["1.png", "2.png", "3.png"], async (report) => {
    report("1.png", null);
    report("2.png", "server");
    report("3.png", null);
  }, { fallbackProblem: FALLBACK });
  assert.deepEqual(result, { saved: 2, failures: [{ fileName: "2.png", problem: "server" }] });
});

await test("process throwing never crashes, and every unreported file becomes a failure", async () => {
  const runner = createUploadBatchRunner();
  const result = await runner.run(["1.png", "2.mp4", "3.png"], async (report) => {
    report("1.png", null);
    throw new Error("Failed to find Server Action");
  }, { fallbackProblem: FALLBACK });
  assert.deepEqual(result, {
    saved: 1,
    failures: [
      { fileName: "2.mp4", problem: FALLBACK },
      { fileName: "3.png", problem: FALLBACK },
    ],
  });
  assert.equal(runner.isRunning(), false);
});

await test("progress counts up per file and clears at the end", async () => {
  const runner = createUploadBatchRunner();
  const seen: (UploadBatchProgress | null)[] = [];
  await runner.run(["a", "b"], async (report) => {
    report("a", null);
    await tick();
    report("b", "x");
  }, { fallbackProblem: FALLBACK, onProgress: (p) => seen.push(p) });
  assert.deepEqual(seen, [{ total: 2, done: 0 }, { total: 2, done: 1 }, { total: 2, done: 2 }, null]);
});

await test("same file name twice in a batch counts twice; a repeated report counts once", async () => {
  const runner = createUploadBatchRunner();
  const result = await runner.run(["clip.mp4", "clip.mp4"], async (report) => {
    report("clip.mp4", null);
    report("clip.mp4", null);
    report("clip.mp4", null);
  }, { fallbackProblem: FALLBACK });
  assert.deepEqual(result, { saved: 2, failures: [] });
});

await test("an empty selection starts nothing", async () => {
  const runner = createUploadBatchRunner();
  let called = false;
  const result = await runner.run([], async () => {
    called = true;
  }, { fallbackProblem: FALLBACK });
  assert.equal(result, null);
  assert.equal(called, false);
});

console.log(`\n${passed} passed`);
