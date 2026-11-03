// Hands already-fetched Files to the native share sheet and classifies the
// result -- pure (no imports, navigator injectable), so share-sheet.test.ts
// runs under Node.
//
// iOS Safari only allows navigator.share() shortly after the tap. When the
// files take longer than that to arrive (a post with an aspect ratio renders
// every image on the server), share() rejects with NotAllowedError. That is
// "needs-tap", not "unsupported": the caller keeps the files and asks for one
// more tap, whose handler calls shareFiles again with the same files -- no
// refetch, so share() runs inside that fresh gesture.
//
// Nothing here awaits before navigator.share(), so calling it straight from a
// click handler keeps the click's user activation.

export type ShareOutcome =
  // shared, or the user dismissed the sheet themselves -- nothing more to do
  | "shared"
  // the files can be shared, but this call came too long after the tap
  | "needs-tap"
  // no file sharing here (or it failed some other way) -- use the fallback
  | "unavailable";

type ShareNavigator = {
  share?: (data: { files: File[] }) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
};

// The retry button's label: "Save 3 Images", "Save 1 Video", and "Items"
// when a post mixes both (a carousel with a video, a Reel and its cover).
export function saveFilesLabel(files: { type: string }[]): string {
  const videos = files.filter((f) => f.type.startsWith("video/")).length;
  const noun = videos === 0 ? "Image" : videos === files.length ? "Video" : "Item";
  return `Save ${files.length} ${noun}${files.length === 1 ? "" : "s"}`;
}

export async function shareFiles(
  files: File[],
  nav: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<ShareOutcome> {
  if (files.length === 0 || typeof nav?.share !== "function" || typeof nav.canShare !== "function") return "unavailable";
  try {
    if (!nav.canShare({ files })) return "unavailable";
    await nav.share({ files });
    return "shared";
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") return "shared";
    if (name === "NotAllowedError") return "needs-tap";
    return "unavailable";
  }
}
