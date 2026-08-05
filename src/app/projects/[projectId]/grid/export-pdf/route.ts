import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { getGridRowsWithCoverPaths } from "@/lib/grid-data";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 40;
const COVER_W = 110;
const COVER_H = 137.5; // 4:5, matching the Grid's own slot ratio
const ROW_GAP = 18;
const ROW_H = COVER_H + ROW_GAP;

const INK = rgb(0.09, 0.08, 0.07); // ~#171412, matches --foreground
const MUTED = rgb(0.42, 0.42, 0.41); // ~#6b6a68, matches --muted
const BORDER = rgb(0.91, 0.89, 0.87); // ~#e7e4de, matches --border

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
};
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not scheduled";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "No time set";
  const [h, m] = timeStr.split(":").map(Number);
  if (h === undefined || m === undefined) return timeStr;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
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

  const { data: project } = await supabase
    .from("projects")
    .select("name, platform")
    .eq("id", projectId)
    .single();

  const rows = await getGridRowsWithCoverPaths(supabase, projectId);
  const orderedPostIds = rows.flatMap((row) => row.slots).map((slot) => slot.postId);
  const coverPathByPostId = new Map(
    rows.flatMap((row) => row.slots).map((slot) => [slot.postId, slot.coverStoragePath] as const),
  );

  if (orderedPostIds.length === 0) {
    return new Response("Nothing to export yet.", { status: 400 });
  }

  const { data: postRows } = await supabase
    .from("posts")
    .select("id, post_type, caption, scheduled_date, status")
    .in("id", orderedPostIds.filter((id): id is string => Boolean(id)));

  // Isolated from the select above -- scheduled_time is a new column that
  // may not exist yet on a not-yet-migrated database, same reasoning as
  // every other pending-column isolation in this codebase (see grid-data.ts).
  const { data: timeRows } = await supabase
    .from("posts")
    .select("id, scheduled_time")
    .in("id", orderedPostIds.filter((id): id is string => Boolean(id)));
  const timeByPostId = new Map((timeRows ?? []).map((r) => [r.id, r.scheduled_time as string | null]));

  const postById = new Map((postRows ?? []).map((p) => [p.id, p]));

  const platformLabel = PLATFORM_LABEL[project?.platform ?? "instagram"] ?? "Instagram";

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

  let page = newPage();
  let cursorY = PAGE_H - 90;
  const contentTop = PAGE_H - 90;

  for (const postId of orderedPostIds) {
    if (!postId) continue;
    const post = postById.get(postId);
    if (!post) continue;

    if (cursorY - ROW_H < MARGIN) {
      page = newPage();
      cursorY = contentTop;
    }

    const rowTop = cursorY;
    const imageY = rowTop - COVER_H;

    // Cover image, normalized to JPEG via sharp so pdf-lib can embed it
    // regardless of the source format (uploads can be png/webp/etc, and a
    // video's poster is always a jpg already).
    const coverPath = coverPathByPostId.get(postId);
    if (coverPath) {
      try {
        const { data, error } = await supabase.storage.from("project-media").download(coverPath);
        if (!error && data) {
          const buf = Buffer.from(await data.arrayBuffer());
          const jpegBuf = await sharp(buf).resize(440, 550, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
          const image = await pdfDoc.embedJpg(jpegBuf);
          page.drawImage(image, { x: MARGIN, y: imageY, width: COVER_W, height: COVER_H });
        } else {
          page.drawRectangle({ x: MARGIN, y: imageY, width: COVER_W, height: COVER_H, color: BORDER });
        }
      } catch {
        page.drawRectangle({ x: MARGIN, y: imageY, width: COVER_W, height: COVER_H, color: BORDER });
      }
    } else {
      page.drawRectangle({ x: MARGIN, y: imageY, width: COVER_W, height: COVER_H, color: BORDER });
    }
    page.drawRectangle({
      x: MARGIN,
      y: imageY,
      width: COVER_W,
      height: COVER_H,
      borderColor: BORDER,
      borderWidth: 1,
    });

    // Info column, to the right of the cover.
    const textX = MARGIN + COVER_W + 20;
    const textWidth = PAGE_W - MARGIN - textX;
    let textY = rowTop - 4;

    const captionLines = post.caption?.trim()
      ? wrapText(post.caption.trim(), font, 10, textWidth).slice(0, 3)
      : ["No caption"];
    for (const line of captionLines) {
      page.drawText(line, { x: textX, y: textY, size: 10, font, color: INK });
      textY -= 13;
    }

    textY -= 6;
    const meta: [string, string][] = [
      ["Scheduled", `${formatDate(post.scheduled_date)} · ${formatTime(timeByPostId.get(postId) ?? null)}`],
      ["Type", TYPE_LABEL[post.post_type] ?? "Single Image"],
      ["Platform", platformLabel],
      ["Status", post.status.charAt(0).toUpperCase() + post.status.slice(1)],
    ];
    for (const [label, value] of meta) {
      page.drawText(label.toUpperCase(), { x: textX, y: textY, size: 7, font: fontBold, color: MUTED });
      page.drawText(value, { x: textX + 62, y: textY, size: 8.5, font, color: INK });
      textY -= 14;
    }

    page.drawLine({
      start: { x: MARGIN, y: imageY - 12 },
      end: { x: PAGE_W - MARGIN, y: imageY - 12 },
      thickness: 0.5,
      color: BORDER,
    });

    cursorY -= ROW_H;
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
