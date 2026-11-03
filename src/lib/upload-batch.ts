// One upload batch at a time, with progress and exactly one result per file.
// Used by the Content board's upload zone (stories-board.tsx).
//
// Why this exists: Content used to dispatch every file's save through ONE
// useActionState hook. When a single save THREW (network drop, a stale tab
// after a deploy, a request-size rejection), React rejected every queued
// save, permanently disabled the hook (actionQueue.action = null, so later
// dispatches were silently dropped), and threw the page into its error
// boundary -- while the loop kept uploading the remaining files' bytes to
// Storage with no row ever saved for them. The tile also stayed clickable
// (and the drop target live) during the whole browser-side upload, so a
// second drop started a second, duplicate batch.
//
// `process` runs the actual uploads and calls `report` once per file it
// finished (failure = null when the file was saved). Anything it never
// reported -- including everything left when it throws -- is counted as a
// failure with `fallbackProblem`, never silently skipped.
//
// Pure (no React/DOM/network) -- tested by upload-batch.test.ts.
export type UploadBatchProgress = { total: number; done: number };

export type UploadBatchResult<TProblem> = {
  saved: number;
  failures: { fileName: string; problem: TProblem }[];
};

export function createUploadBatchRunner() {
  let running = false;

  return {
    isRunning: () => running,
    // Resolves to null (and does nothing) when a batch is already running.
    async run<TProblem>(
      fileNames: string[],
      process: (report: (fileName: string, failure: TProblem | null) => void) => Promise<void>,
      options: { fallbackProblem: TProblem; onProgress?: (progress: UploadBatchProgress | null) => void },
    ): Promise<UploadBatchResult<TProblem> | null> {
      if (running || fileNames.length === 0) return null;
      running = true;
      const remaining = [...fileNames];
      const result: UploadBatchResult<TProblem> = { saved: 0, failures: [] };
      const total = fileNames.length;
      options.onProgress?.({ total, done: 0 });

      const report = (fileName: string, failure: TProblem | null) => {
        const index = remaining.indexOf(fileName);
        // A file reported twice (or one this batch never had) is ignored --
        // each file counts exactly once.
        if (index === -1) return;
        remaining.splice(index, 1);
        if (failure === null) result.saved += 1;
        else result.failures.push({ fileName, problem: failure });
        options.onProgress?.({ total, done: total - remaining.length });
      };

      try {
        await process(report);
      } catch {
        // Reported below, per file.
      } finally {
        for (const fileName of remaining) result.failures.push({ fileName, problem: options.fallbackProblem });
        remaining.length = 0;
        running = false;
        options.onProgress?.(null);
      }
      return result;
    },
  };
}
