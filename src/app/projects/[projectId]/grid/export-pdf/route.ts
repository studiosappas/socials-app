import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { getGridRowsWithCoverPaths } from "@/lib/grid-data";
import { applyCoverTransform, type CoverTransform } from "@/lib/image-crop";
import { effectivePostType } from "@/lib/post-type";
import { exportCoverFraming, exportFraming, slideExportFraming } from "@/lib/cover-framing";
import { aspectValue, parseAspectChoice } from "@/lib/aspect-ratio";
import { GRID_COVER_ASPECT_RATIO } from "../grid-constants";
import { clientPdfThumbSize } from "@/lib/client-pdf-layout";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const THUMB_GAP = 4;
// A legacy (no ratio) single-image post's thumbnail at this size; a post
// with a chosen ratio gets the same height at its own ratio. A carousel's
// images shrink uniformly (keeping the ratio) only as far as needed to still
// all fit across one row, however many there are (lib/client-pdf-layout.ts).
const IDEAL_THUMB_W = 90;
const IDEAL_THUMB_H = IDEAL_THUMB_W / GRID_COVER_ASPECT_RATIO;
// Rendered pixel height of each embedded thumb (width follows its ratio).
const THUMB_PX_H = 480;
const TEXT_BLOCK_H = 46; // caption (up to 2 lines) + type tag
const ROW_GAP = 16;

const INK = rgb(0.09, 0.08, 0.07); // ~#171412, matches --foreground
const MUTED = rgb(0.42, 0.42, 0.41); // ~#6b6a68, matches --muted
const BORDER = rgb(0.91, 0.89, 0.87); // ~#e7e4de, matches --border

const TYPE_LABEL: Record<string, string> = {
  post: "Single Image",
  carousel: "Carousel",
  reel: "Video",
};

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return new Response("Forbidden", { status: 403 });
  }

  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).single();

  const rows = await getGridRowsWithCoverPaths(supabase, projectId);
  // getGridRowsWithCoverPaths returns rows top-to-bottom and each row's
  // slots left-to-right -- the same order the on-screen Grid renders in,
  // which is also real Instagram's reading order (newest post top-left,
  // getting older as you go right then down). New rows are always added
  // above existing ones (see addGridRow), so the OLDEST planned post ends
  // up bottom-right, exactly like a real profile's actual posting history.
  // Reversing this flattened order walks the grid from that oldest,
  // bottom-right post forward to the newest, top-left one -- i.e. real
  // chronological posting order, which is what "bottom right is first" asks for.
  const orderedPostIds = rows
    .flatMap((row) => row.slots)
    .map((slot) => slot.postId)
    .filter((id): id is string => Boolean(id))
    .reverse();

  if (orderedPostIds.length === 0) {
    return new Response("Nothing to export yet.", { status: 400 });
  }

  const { data: postRows } = await supabase
    .from("posts")
    .select("id, post_type, caption")
    .in("id", orderedPostIds);
  const postById = new Map((postRows ?? []).map((p) => [p.id, p]));

  // Isolated from the select above, same reasoning as preview_storage_path/
  // poster_storage_path below -- cover_transform is the one canonical crop
  // for a post's cover (position 0), same value Grid's own on-screen tiles
  // and its PNG export already apply; this is what was missing here.
  const { data: transformRows } = await supabase.from("posts").select("id, cover_transform").in("id", orderedPostIds);
  const storedCoverTransformByPostId = new Map(
    (transformRows ?? []).map((r) => [r.id, (r as { cover_transform: CoverTransform | null }).cover_transform]),
  );

  // All of every post's assets, in carousel order -- a single-image/reel
  // post only ever uses the first one, but a carousel needs every one of
  // them, so this fetches the full set up front rather than the single
  // cover-only resolution grid-data.ts's getGridRowsWithCoverPaths does.
  const { data: postAssets } = await supabase
    .from("post_assets")
    .select("post_id, position, media_assets(id, storage_path, media_type)")
    .in("post_id", orderedPostIds)
    .order("position");

  // The PDF shows each post's Grid tile, so its cover gets the Grid framing:
  // a legacy framing, or a standalone Reel's cover framing (its centred 3:4
  // band, see lib/image-crop.ts) -- never a Grid-preview-only image crop
  // (lib/cover-framing.ts).
  const assetsPerPost = new Map<string, { count: number; firstType: string | null }>();
  for (const pa of postAssets ?? []) {
    const entry = assetsPerPost.get(pa.post_id) ?? { count: 0, firstType: null };
    if (entry.count === 0) entry.firstType = (pa.media_assets as { media_type: string } | null)?.media_type ?? null;
    entry.count += 1;
    assetsPerPost.set(pa.post_id, entry);
  }
  // A post with a chosen aspect ratio shows its export framing's centred 3:4
  // window instead, same as its Grid tile (lib/grid-data.ts). Newer columns,
  // isolated: until they exist every post is legacy.
  const { data: aspectRows } = await supabase.from("posts").select("id, aspect_ratio").in("id", orderedPostIds);
  const aspectByPostId = new Map((aspectRows ?? []).map((r) => [r.id, parseAspectChoice((r as { aspect_ratio?: unknown }).aspect_ratio)]));
  // Every item's own frame (a carousel's slides have theirs too), by position.
  const { data: frameRows } = await supabase.from("post_assets").select("post_id, position, frame_transform").in("post_id", orderedPostIds);
  const frameByPostPosition = new Map(
    ((frameRows ?? []) as { post_id: string; position: number; frame_transform: CoverTransform | null }[]).map((r) => [
      `${r.post_id}:${r.position}`,
      r.frame_transform,
    ]),
  );
  const coverFrameByPostId = new Map(orderedPostIds.map((id) => [id, frameByPostPosition.get(`${id}:0`) ?? null]));
  const coverTransformByPostId = new Map(
    orderedPostIds.map((id) => {
      const choice = aspectByPostId.get(id) ?? null;
      const value = choice === "original" ? "original" : choice ? aspectValue(choice, null) : null;
      if (value) return [id, exportFraming(value, coverFrameByPostId.get(id)) as CoverTransform];
      const a = assetsPerPost.get(id);
      return [id, exportCoverFraming(storedCoverTransformByPostId.get(id) ?? null, a?.count === 1 && a.firstType === "video")];
    }),
  );

  const mediaAssetIds = (postAssets ?? [])
    .map((pa) => (pa.media_assets as { id: string } | null)?.id)
    .filter((id): id is string => Boolean(id));

  // Isolated from the selects above -- preview_storage_path/poster_storage_path
  // are newer media_assets columns that may not exist yet on a not-yet-migrated
  // database, same reasoning as every other pending-column isolation in this
  // codebase (see grid-data.ts). A missing one here just means that one
  // image/video falls back to its raw upload instead of breaking the export.
  const { data: previewRows } = mediaAssetIds.length
    ? await supabase.from("media_assets").select("id, preview_storage_path").in("id", mediaAssetIds)
    : { data: [] };
  const previewByMediaId = new Map(
    (previewRows ?? []).map((r) => [r.id, (r as { preview_storage_path: string | null }).preview_storage_path]),
  );
  const { data: posterRows } = mediaAssetIds.length
    ? await supabase.from("media_assets").select("id, poster_storage_path").in("id", mediaAssetIds)
    : { data: [] };
  const posterByMediaId = new Map(
    (posterRows ?? []).map((r) => [r.id, (r as { poster_storage_path: string | null }).poster_storage_path]),
  );

  // One entry per real media item, in carousel order -- null where an item
  // has nothing drawable (a video with no poster yet). Kept positional so
  // index 0 is always the post's real cover (the only position its
  // cover_transform belongs to) and the length is the post's real item count.
  const imagePathsByPostId = new Map<string, (string | null)[]>();
  // Parallel to imagePathsByPostId: each item's position and media type.
  const itemsByPostId = new Map<string, { position: number; mediaType: string }[]>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string; storage_path: string; media_type: string } | null;
    if (!media) continue;
    // Grid never shows a raw video file -- a video asset resolves to its
    // captured poster frame (an empty box if it has none yet), exactly
    // like the on-screen grid and the full-feed export already do.
    const path =
      media.media_type === "video"
        ? (posterByMediaId.get(media.id) ?? null)
        : (previewByMediaId.get(media.id) || media.storage_path);
    const list = imagePathsByPostId.get(pa.post_id) ?? [];
    list.push(path);
    imagePathsByPostId.set(pa.post_id, list);
    itemsByPostId.set(pa.post_id, [...(itemsByPostId.get(pa.post_id) ?? []), { position: pa.position, mediaType: media.media_type }]);
  }

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  function newPage(): PDFPage {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    page.drawText(project?.name || "Content Calendar", { x: MARGIN, y: PAGE_H - 40, size: 16, font: fontBold, color: INK });
    page.drawText(
      `Content Calendar — Exported ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      { x: MARGIN, y: PAGE_H - 58, size: 9, font, color: MUTED },
    );
    page.drawLine({
      start: { x: MARGIN, y: PAGE_H - 68 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 68 },
      thickness: 1,
      color: BORDER,
    });
    return page;
  }

  // Cache key includes the transform -- the SAME path can legitimately need
  // two different renders (a carousel's own slides reuse this same cache,
  // and only the cover position ever gets a non-null transform).
  const imageCache = new Map<string, Uint8Array | null>();
  const sourceCache = new Map<string, Promise<Buffer | null>>();
  function downloadSource(path: string): Promise<Buffer | null> {
    if (!sourceCache.has(path)) {
      sourceCache.set(
        path,
        supabase.storage
          .from("project-media")
          .download(path)
          .then(async ({ data, error }) => (error || !data ? null : Buffer.from(await data.arrayBuffer())))
          .catch(() => null),
      );
    }
    return sourceCache.get(path)!;
  }

  // A post with a chosen ratio is shown AT that ratio, like Client Review:
  // "Original" is the FIRST item's displayed ratio (as the download resolves
  // it). Null = legacy (no ratio, or an Original whose first item can't be
  // read): the 3:4 Grid tile as before.
  async function postAspect(postId: string): Promise<number | null> {
    const choice = aspectByPostId.get(postId) ?? null;
    if (!choice) return null;
    if (choice !== "original") return aspectValue(choice, null);
    const first = imagePathsByPostId.get(postId)?.[0];
    const buf = first ? await downloadSource(first) : null;
    const shown = buf ? (await sharp(buf).metadata().catch(() => null))?.autoOrient : null;
    return shown?.width && shown?.height ? shown.width / shown.height : null;
  }

  // Each item's framing in a post shown at its ratio: the cover its own
  // frame, every other IMAGE slide its own frame at the shared ratio, video
  // slides unframed -- exactly Client Review's rule (lib/data/share-preview.ts).
  function itemFraming(postId: string, index: number, aspect: number): CoverTransform | null {
    const item = itemsByPostId.get(postId)?.[index];
    const frame = item ? frameByPostPosition.get(`${postId}:${item.position}`) : null;
    if (index === 0) return exportFraming(aspect, frame) as CoverTransform;
    return (item ? slideExportFraming(aspectByPostId.get(postId) ?? null, item.mediaType, frame, aspect) : null) as CoverTransform | null;
  }

  // aspect: the thumb's box ratio (the post's, or the Grid's 3:4).
  async function embedThumb(path: string | null | undefined, transform: CoverTransform | null, aspect: number) {
    if (!path) return null;
    const cacheKey = `${path}:${aspect}:${transform ? JSON.stringify(transform) : "none"}`;
    if (!imageCache.has(cacheKey)) {
      try {
        const buf = await downloadSource(path);
        if (!buf) {
          imageCache.set(cacheKey, null);
        } else {
          const pipeline = await applyCoverTransform(buf, transform, Math.round(THUMB_PX_H * aspect), THUMB_PX_H);
          const jpegBuf = await pipeline.jpeg({ quality: 90 }).toBuffer();
          imageCache.set(cacheKey, jpegBuf);
        }
      } catch {
        imageCache.set(cacheKey, null);
      }
    }
    const bytes = imageCache.get(cacheKey);
    return bytes ? pdfDoc.embedJpg(bytes) : null;
  }

  let page = newPage();
  let cursorY = PAGE_H - 90;
  const contentTop = PAGE_H - 90;

  for (const postId of orderedPostIds) {
    const post = postById.get(postId);
    if (!post) continue;

    const allPaths = imagePathsByPostId.get(postId) ?? [];
    // Only a carousel shows every slide, laid out across one row -- a
    // single-image post or reel just shows its one cover, same as before.
    // effectivePostType, not the raw stored value: a mixed image/video
    // carousel saved as "reel" under the old derivation rule is still a
    // carousel here (read-time only, nothing is written).
    const postType = effectivePostType(post.post_type, allPaths.length);
    const paths = postType === "carousel" ? allPaths : allPaths.slice(0, 1);
    const count = Math.max(paths.length, 1);

    // The post's own ratio when it has one (every slide shares it), else the
    // Grid's canonical 3:4 cover ratio, as before.
    const aspect = await postAspect(postId);
    const boxAspect = aspect ?? GRID_COVER_ASPECT_RATIO;
    const { w: thumbW, h: thumbH } = clientPdfThumbSize(count, boxAspect, CONTENT_W, THUMB_GAP, IDEAL_THUMB_H);
    const rowH = thumbH + ROW_GAP + TEXT_BLOCK_H;

    if (cursorY - rowH < MARGIN) {
      page = newPage();
      cursorY = contentTop;
    }

    const rowTop = cursorY;
    const imageY = rowTop - thumbH;

    if (paths.length === 0) {
      page.drawRectangle({ x: MARGIN, y: imageY, width: thumbW, height: thumbH, color: BORDER });
    } else {
      for (let i = 0; i < paths.length; i++) {
        const x = MARGIN + i * (thumbW + THUMB_GAP);
        // At its ratio: each item's own whole frame (itemFraming). Legacy: the
        // cover's Grid framing, other slides unframed, as before. An Edit
        // Image crop is baked into the item's preview_storage_path image.
        const transform = aspect ? itemFraming(postId, i, aspect) : i === 0 ? (coverTransformByPostId.get(postId) ?? null) : null;
        const image = await embedThumb(paths[i], transform, boxAspect);
        if (image) {
          page.drawImage(image, { x, y: imageY, width: thumbW, height: thumbH });
        } else {
          page.drawRectangle({ x, y: imageY, width: thumbW, height: thumbH, color: BORDER });
        }
        page.drawRectangle({ x, y: imageY, width: thumbW, height: thumbH, borderColor: BORDER, borderWidth: 1 });
      }
    }

    // Minimal, per the ask: just the caption and the content type -- no
    // schedule/platform/status clutter.
    let textY = imageY - 16;
    const captionLines = post.caption?.trim()
      ? wrapText(post.caption.trim(), font, 10, CONTENT_W).slice(0, 2)
      : ["No caption"];
    for (const line of captionLines) {
      page.drawText(line, { x: MARGIN, y: textY, size: 10, font, color: INK });
      textY -= 13;
    }
    page.drawText((TYPE_LABEL[postType] ?? "Single Image").toUpperCase(), {
      x: MARGIN,
      y: textY - 4,
      size: 7.5,
      font: fontBold,
      color: MUTED,
    });

    page.drawLine({
      start: { x: MARGIN, y: rowTop - rowH + 8 },
      end: { x: PAGE_W - MARGIN, y: rowTop - rowH + 8 },
      thickness: 0.5,
      color: BORDER,
    });

    cursorY -= rowH + 10;
  }

  const pdfBytes = await pdfDoc.save();

  return new Response(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="grid-client-review-${projectId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
