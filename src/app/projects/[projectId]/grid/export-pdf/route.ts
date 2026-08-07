import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { getGridRowsWithCoverPaths } from "@/lib/grid-data";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const THUMB_GAP = 4;
// A single-image post's thumbnail at this size; a carousel's images shrink
// uniformly (keeping the 4:5 ratio) only as far as needed to still all fit
// across one row, however many there are.
const IDEAL_THUMB_W = 90;
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

  // All of every post's assets, in carousel order -- a single-image/reel
  // post only ever uses the first one, but a carousel needs every one of
  // them, so this fetches the full set up front rather than the single
  // cover-only resolution grid-data.ts's getGridRowsWithCoverPaths does.
  const { data: postAssets } = await supabase
    .from("post_assets")
    .select("post_id, position, media_assets(id, storage_path, media_type)")
    .in("post_id", orderedPostIds)
    .order("position");

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

  const imagePathsByPostId = new Map<string, string[]>();
  for (const pa of postAssets ?? []) {
    const media = pa.media_assets as { id: string; storage_path: string; media_type: string } | null;
    if (!media) continue;
    // Grid never shows a raw video file -- a video asset resolves to its
    // captured poster frame (or is skipped if it has none yet), exactly
    // like the on-screen grid and the full-feed export already do.
    const path =
      media.media_type === "video"
        ? (posterByMediaId.get(media.id) ?? null)
        : (previewByMediaId.get(media.id) || media.storage_path);
    if (!path) continue;
    const list = imagePathsByPostId.get(pa.post_id) ?? [];
    list.push(path);
    imagePathsByPostId.set(pa.post_id, list);
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

  const imageCache = new Map<string, Uint8Array | null>();
  async function embedThumb(path: string | undefined) {
    if (!path) return null;
    if (!imageCache.has(path)) {
      try {
        const { data, error } = await supabase.storage.from("project-media").download(path);
        if (error || !data) {
          imageCache.set(path, null);
        } else {
          const buf = Buffer.from(await data.arrayBuffer());
          const jpegBuf = await sharp(buf).resize(360, 450, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
          imageCache.set(path, jpegBuf);
        }
      } catch {
        imageCache.set(path, null);
      }
    }
    const bytes = imageCache.get(path);
    return bytes ? pdfDoc.embedJpg(bytes) : null;
  }

  let page = newPage();
  let cursorY = PAGE_H - 90;
  const contentTop = PAGE_H - 90;

  for (const postId of orderedPostIds) {
    const post = postById.get(postId);
    if (!post) continue;

    const allPaths = imagePathsByPostId.get(postId) ?? [];
    // Only a carousel shows every image, laid out across one row -- a
    // single-image post or reel just shows its one cover, same as before.
    const paths = post.post_type === "carousel" ? allPaths : allPaths.slice(0, 1);
    const count = Math.max(paths.length, 1);

    let thumbW = IDEAL_THUMB_W;
    if (count * IDEAL_THUMB_W + (count - 1) * THUMB_GAP > CONTENT_W) {
      thumbW = (CONTENT_W - (count - 1) * THUMB_GAP) / count;
    }
    const thumbH = thumbW * 1.25;
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
        const image = await embedThumb(paths[i]);
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
    page.drawText((TYPE_LABEL[post.post_type] ?? "Single Image").toUpperCase(), {
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
