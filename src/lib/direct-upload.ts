"use client";

import { createClient } from "@/lib/supabase/client";
import { tooLargeMessage } from "@/lib/upload-limits";

// Uploads straight to Supabase Storage from the browser -- bypasses the
// Server Action entirely (and therefore Vercel's hard, non-configurable
// ~4.5MB Function request-body limit, which every FormData-through-an-
// action upload was actually bound by, regardless of next.config.ts's own
// serverActions.bodySizeLimit). Same bucket/path-prefix convention every
// action already used (${projectId}/${uuid}.ext), so the existing RLS
// policies -- already scoped by that same path prefix -- apply completely
// unchanged; this is a transport change, not a security change.
export async function uploadFileDirect(
  bucket: string,
  path: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
  if (error) {
    // Never surface Supabase's own raw error text (e.g. its own oversize
    // message, or a raw network/HTTP error) directly to the user.
    const message = error.message.toLowerCase().includes("size") ? tooLargeMessage() : "Couldn't upload this file. Please try again.";
    return { error: message };
  }
  return { path };
}

// Same convention every upload action already used server-side --
// crypto.randomUUID() works identically in the browser, so the path can be
// generated client-side before the direct upload, with no extra round trip
// to the server just to mint an id.
export function newStoragePath(projectId: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop() : undefined;
  return `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
}
