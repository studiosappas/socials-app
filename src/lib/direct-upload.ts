"use client";

import { createClient } from "@/lib/supabase/client";
import { problemMessage, storageErrorProblem, type UploadProblem } from "@/lib/upload-validation";

// Uploads straight to Supabase Storage from the browser -- bypasses the
// Server Action entirely (and therefore Vercel's hard, non-configurable
// ~4.5MB Function request-body limit, which every FormData-through-an-
// action upload was actually bound by, regardless of next.config.ts's own
// serverActions.bodySizeLimit). Same bucket/path-prefix convention every
// action already used (${projectId}/${uuid}.ext), so the existing RLS
// policies -- already scoped by that same path prefix -- apply completely
// unchanged; this is a transport change, not a security change.
//
// Never surfaces Supabase's own raw error text. `problem` says WHY it failed
// (too large / not allowed / network / server -- see storageErrorProblem),
// and `error` is the same thing as one ready-to-show message.
export async function uploadFileDirect(
  bucket: string,
  path: string,
  file: File,
): Promise<{ path: string } | { error: string; problem: UploadProblem }> {
  let problem: UploadProblem | null = null;
  try {
    const supabase = createClient();
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
    if (error) problem = storageErrorProblem(error as { message?: string; statusCode?: string | number });
  } catch (error) {
    // A thrown fetch failure is a network problem, never a bad file.
    problem = storageErrorProblem({ message: error instanceof Error ? `network: ${error.message}` : "network" });
  }
  return problem ? { error: problemMessage(problem), problem } : { path };
}

// Same convention every upload action already used server-side --
// crypto.randomUUID() works identically in the browser, so the path can be
// generated client-side before the direct upload, with no extra round trip
// to the server just to mint an id.
export function newStoragePath(projectId: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop() : undefined;
  return `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
}
