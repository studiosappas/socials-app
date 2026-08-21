"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  runThumbnailBackfillBatch,
  type ThumbnailBackfillStatus,
  type ThumbnailBackfillBatchResult,
} from "@/lib/actions/thumbnail-backfill";

const TEST_BATCH_SIZE = 5;
// Kept conservative -- each image is a full download (originals here run
// 18-24MB) + sharp resize + upload + DB update, sequentially, all inside
// one server invocation. 10 keeps a comfortable margin under the 60s
// maxDuration set on this route even on a slow connection.
const RUN_BATCH_SIZE = 10;

function fmtKB(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FailedItem = { id: string; projectName: string; reason: string };
type SucceededItem = { id: string; projectName: string; originalBytes: number; thumbnailBytes: number };

export function ThumbnailBackfillPanel({ initialStatus }: { initialStatus: ThumbnailBackfillStatus }) {
  const [status] = useState(initialStatus);
  const [phase, setPhase] = useState<"idle" | "busy" | "test-done" | "done">("idle");
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [succeeded, setSucceeded] = useState<SucceededItem[]>([]);
  const [failed, setFailed] = useState<FailedItem[]>([]);
  const [remaining, setRemaining] = useState(status.totalMissing);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runOneBatch(batchSize: number, currentExclude: string[]): Promise<ThumbnailBackfillBatchResult> {
    return runThumbnailBackfillBatch(batchSize, currentExclude);
  }

  async function handleTestBatch() {
    setError(null);
    setPhase("busy");
    setProgressNote(`Processing a test batch of ${TEST_BATCH_SIZE}…`);
    try {
      const result = await runOneBatch(TEST_BATCH_SIZE, excludeIds);
      setSucceeded(result.succeeded);
      setFailed(result.failed);
      setExcludeIds(result.failed.map((f) => f.id));
      setRemaining(result.remaining);
      setPhase("test-done");
      setProgressNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test batch failed. Please try again.");
      setPhase("idle");
      setProgressNote(null);
    }
  }

  async function handleRunAll() {
    setError(null);
    setPhase("busy");
    let currentExclude = excludeIds;
    let allSucceeded = succeeded;
    let allFailed = failed;
    let totalAttempted = succeeded.length + failed.length;
    const grandTotal = status.totalMissing;

    try {
      // Loops client-side, one small batch per call, rather than one huge
      // server invocation -- keeps every individual request well inside
      // Vercel's function time budget and means "restart-safe" and
      // "process in batches" are the same mechanism: if this tab is closed
      // mid-run, whatever wasn't attempted yet is simply still missing a
      // thumbnail, ready to pick up again from a fresh status query.
      for (;;) {
        const result = await runOneBatch(RUN_BATCH_SIZE, currentExclude);
        allSucceeded = [...allSucceeded, ...result.succeeded];
        allFailed = [...allFailed, ...result.failed];
        currentExclude = allFailed.map((f) => f.id);
        totalAttempted += result.processed;
        setSucceeded(allSucceeded);
        setFailed(allFailed);
        setExcludeIds(currentExclude);
        setRemaining(result.remaining);
        setProgressNote(`Processed ${Math.min(totalAttempted, grandTotal)} of ${grandTotal}…`);
        // processed === 0 means nothing eligible was left to attempt (every
        // remaining row was already excluded as a prior failure) -- stop
        // instead of looping forever on an empty batch.
        if (result.remaining === 0 || result.processed === 0) break;
      }
      setPhase("done");
      setProgressNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing stopped early. Please try again.");
      setPhase("test-done");
      setProgressNote(null);
    }
  }

  if (status.totalMissing === 0) {
    return (
      <div className="rounded border border-border bg-card p-4 text-sm text-muted">
        Every image across the projects you manage already has a thumbnail. Nothing to do.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded border border-border bg-card p-4">
        <p className="text-sm font-medium">{remaining} image{remaining === 1 ? "" : "s"} still need a thumbnail</p>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
          {status.byProject.map((p) => (
            <li key={p.projectId}>
              {p.projectName} — {p.missing} image{p.missing === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {progressNote && <p className="text-sm text-muted">{progressNote}</p>}

      {phase === "idle" && (
        <Button type="button" variant="primary" radius="none" onClick={handleTestBatch}>
          Run test batch ({Math.min(TEST_BATCH_SIZE, status.totalMissing)} images)
        </Button>
      )}

      {phase === "busy" && (
        <Button type="button" variant="primary" radius="none" disabled>
          Working…
        </Button>
      )}

      {(phase === "test-done" || phase === "done") && (succeeded.length > 0 || failed.length > 0) && (
        <div className="flex flex-col gap-3">
          {succeeded.length > 0 && (
            <div>
              <p className="text-xs font-medium tracking-wide uppercase text-muted">
                Succeeded ({succeeded.length})
              </p>
              <ul className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
                {succeeded.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span className="truncate text-muted">{s.projectName}</span>
                    <span className="shrink-0 tabular-nums">
                      {fmtMB(s.originalBytes)} → {fmtKB(s.thumbnailBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failed.length > 0 && (
            <div>
              <p className="text-xs font-medium tracking-wide uppercase text-error">
                Skipped ({failed.length}) — couldn&apos;t be processed
              </p>
              <ul className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
                {failed.map((f) => (
                  <li key={f.id} className="flex flex-col">
                    <span className="text-muted">{f.projectName}</span>
                    <span className="text-error">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {phase === "test-done" && (
        <Button type="button" variant="primary" radius="none" onClick={handleRunAll}>
          Continue — process the remaining {remaining} image{remaining === 1 ? "" : "s"}
        </Button>
      )}

      {phase === "done" && (
        <p className="text-sm text-muted">
          Done. {succeeded.length} thumbnail{succeeded.length === 1 ? "" : "s"} created
          {failed.length > 0 ? `, ${failed.length} skipped (see reasons above)` : ""}. Originals were never
          modified.
        </p>
      )}
    </div>
  );
}
