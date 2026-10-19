import { applyCoverTransform, type CoverTransform } from "@/lib/image-crop";
import { GRID_COVER_EXPORT_WIDTH, GRID_COVER_EXPORT_HEIGHT } from "@/app/projects/[projectId]/grid/grid-constants";
import type { PostExportItem } from "@/lib/post-export-plan";

// Server-side half of a post export: turns planned items (post-export-plan.ts)
// into real bytes. Kept separate from the route so the storage access is
// injected (`download`) -- the route passes Supabase Storage, the regression
// check passes fixtures, and both run this exact code.

export class PostExportError extends Error {
  // Safe to show to the user: names which item failed, never a storage path
  // or a raw backend message.
  readonly userMessage: string;
  constructor(item: PostExportItem, cause?: unknown) {
    super(`post export failed for ${item.label} (${item.sourcePath})`, { cause });
    this.name = "PostExportError";
    this.userMessage = `Couldn't prepare ${item.label} for download, so nothing was downloaded. Please try again — if it keeps failing, re-save that image and try once more.`;
  }
}

export type ExportDownload = (storagePath: string) => Promise<Buffer | null>;

export async function renderPostExportItem(
  item: PostExportItem,
  coverTransform: CoverTransform | null,
  download: ExportDownload,
): Promise<Buffer> {
  let source: Buffer | null;
  try {
    source = await download(item.sourcePath);
  } catch (error) {
    throw new PostExportError(item, error);
  }
  if (!source || source.length === 0) throw new PostExportError(item);

  if (item.operation === "verbatim") return source;

  try {
    // The width/height here only pin the crop's ASPECT RATIO (the Grid
    // cover's 3:4) -- nativeResolution makes applyCoverTransform return the
    // crop at its own native pixel size, derived from the source's real
    // resolution, never scaled to a fixed 1080-ish target (and never
    // upscaled). The source is the saved edit when there is one, which is
    // the image the framing was actually set against.
    const pipeline = await applyCoverTransform(source, coverTransform, GRID_COVER_EXPORT_WIDTH, GRID_COVER_EXPORT_HEIGHT, {
      nativeResolution: true,
    });
    return await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } catch (error) {
    throw new PostExportError(item, error);
  }
}

// All-or-nothing: the first item that can't be produced fails the whole
// export (PostExportError) instead of being skipped -- a zip that silently
// lacks a slide looks like a successful download.
export async function renderPostExport(
  items: PostExportItem[],
  coverTransform: CoverTransform | null,
  download: ExportDownload,
): Promise<{ item: PostExportItem; data: Buffer }[]> {
  const out: { item: PostExportItem; data: Buffer }[] = [];
  for (const item of items) {
    out.push({ item, data: await renderPostExportItem(item, coverTransform, download) });
  }
  return out;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function contentTypeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}
