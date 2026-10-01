// What a resolved link import (addBriefTaskLink -> createBriefMediaItem in
// lib/actions/brief.ts) writes to Storage and to brief_attachments -- pulled
// out as a pure plan so the "the PRIMARY stored file is the real media, a
// poster is only ever the poster" rule is testable without Supabase
// (brief-media-import.test.ts). brief.ts performs the uploads/inserts.
//
// This is the SAME representation a normal uploaded Brief video gets
// (addBriefTaskVideo): one brief_attachments row whose original_storage_path
// is the video file and whose poster_storage_path is an optional JPEG, plus a
// brief_task_items row with kind "video" and no url -- which the Brief page
// loader turns into originalUrl/posterUrl and VideoItemChip plays. No link
// back to the source page is stored anywhere.
//
// No imports on purpose (Node runs the test file directly).

export type MediaBytes = { buffer: Buffer; contentType: string };

export type BriefMediaImportPlan = {
  original: { path: string; buffer: Buffer; contentType: string };
  // Video only, and only when the source published one.
  poster: { path: string; buffer: Buffer; contentType: string } | null;
  itemKind: "image" | "video";
};

export function planBriefMediaImport(input: {
  projectId: string;
  kind: "image" | "video";
  primary: MediaBytes;
  // Extension for the primary file (already derived by the caller from a
  // known filename extension or the MIME type); undefined = none.
  primaryExt: string | undefined;
  poster: (MediaBytes & { ext: string | undefined }) | null | undefined;
  newId: () => string;
}): BriefMediaImportPlan {
  const pathFor = (ext: string | undefined) => `${input.projectId}/${input.newId()}${ext ? `.${ext}` : ""}`;
  const poster =
    input.kind === "video" && input.poster
      ? { path: pathFor(input.poster.ext), buffer: input.poster.buffer, contentType: input.poster.contentType }
      : null;
  return {
    original: { path: pathFor(input.primaryExt), buffer: input.primary.buffer, contentType: input.primary.contentType },
    poster,
    itemKind: input.kind,
  };
}
