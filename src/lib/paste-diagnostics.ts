"use client";

// TEMPORARY DIAGNOSTIC MODULE -- added specifically to trace a real,
// Supabase-backed Adjustments Paste failure that could not be reproduced
// in a local/stubbed environment (the crossOrigin/tainted-canvas fix in
// commit 84dbe34 did not resolve it in the real app). Every failure this
// app's Paste Style pipeline can hit was previously collapsed into one
// generic "Couldn't save changes. Try again." toast with no way to see
// which stage or what the underlying error actually was. This module (and
// its call sites in grid-board.tsx / annotation-engine.ts / media.ts)
// exists ONLY to make that real, specific failure visible in the browser
// console -- delete this file and every diagStage/diagFail call site once
// the real failing stage has been identified and properly fixed.
//
// Deliberately logs NO signed URLs, auth tokens, cookies, service-role
// keys, or full user content -- only stage names, error name/message/code/
// digest, and small non-sensitive identifiers (a truncated asset id,
// object counts, byte sizes).

export function newDiagOpId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function shortId(id: string | null | undefined): string {
  if (!id) return "none";
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
export { shortId as diagShortId };

export function diagStage(opId: string, stage: string, extra?: Record<string, unknown>) {
  console.log(`[PasteStyle][${opId}] stage=${stage}`, extra ?? "");
}

type SafeErrorInfo = { name: string; message: string; code?: string; digest?: string; cause?: string };

function safeErrorInfo(error: unknown): SafeErrorInfo {
  if (error instanceof Error) {
    const anyErr = error as Error & { code?: string; digest?: string; cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      code: anyErr.code,
      digest: anyErr.digest,
      cause: anyErr.cause !== undefined ? String(anyErr.cause) : undefined,
    };
  }
  return { name: typeof error, message: String(error) };
}

export function diagFail(opId: string, stage: string, error: unknown, extra?: Record<string, unknown>) {
  const info = safeErrorInfo(error);
  console.error(
    `[PasteStyle][${opId}] FAILED stage=${stage}\n` +
      `name=${info.name}\n` +
      `message=${info.message}\n` +
      `code=${info.code ?? "n/a"}\n` +
      `digest=${info.digest ?? "n/a"}\n` +
      `cause=${info.cause ?? "n/a"}`,
    extra ?? "",
  );
}
