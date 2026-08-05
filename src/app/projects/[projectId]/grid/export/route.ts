import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { getGridRowsWithCoverPaths } from "@/lib/grid-data";

const CELL_W = 1080;
const CELL_H = 1350; // 4:5, matching the on-screen grid's slot ratio
const BLANK_FILL = "#e7e4de"; // matches the --border design token

type RawCell = { input: Buffer; raw: { width: number; height: number; channels: 1 | 2 | 3 | 4 } };

async function buildBlankCell(): Promise<RawCell> {
  const { data, info } = await sharp({
    create: { width: CELL_W, height: CELL_H, channels: 3, background: BLANK_FILL },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { input: data, raw: { width: info.width, height: info.height, channels: 3 } };
}

async function buildImageCell(buffer: Buffer): Promise<RawCell> {
  const { data, info } = await sharp(buffer)
    .resize(CELL_W, CELL_H, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { input: data, raw: { width: info.width, height: info.height, channels: 3 } };
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

  const rows = await getGridRowsWithCoverPaths(supabase, projectId);
  if (rows.length === 0) {
    return new Response("Nothing to export yet.", { status: 400 });
  }

  const blankCell = await buildBlankCell();

  const cellsByRow = await Promise.all(
    rows.map(async (row) => {
      const cells = await Promise.all(
        row.slots.map(async (slot): Promise<RawCell> => {
          // coverStoragePath always resolves to an actual image file (the
          // poster frame for a video cover, never the raw video itself --
          // see getGridRowsWithCoverPaths), so it's safe to download and use
          // regardless of coverMediaType; only a genuinely missing cover
          // (no path at all, e.g. a video with no poster yet) falls back to blank.
          if (!slot.coverStoragePath) {
            return blankCell;
          }
          const { data, error } = await supabase.storage
            .from("project-media")
            .download(slot.coverStoragePath);
          if (error || !data) return blankCell;
          try {
            const buf = Buffer.from(await data.arrayBuffer());
            return await buildImageCell(buf);
          } catch {
            return blankCell;
          }
        }),
      );
      return cells;
    }),
  );

  const cols = Math.max(...cellsByRow.map((r) => r.length), 1);
  const canvasW = cols * CELL_W;
  const canvasH = cellsByRow.length * CELL_H;

  const compositeOps = cellsByRow.flatMap((cells, r) =>
    cells.map((cell, c) => ({
      input: cell.input,
      raw: cell.raw,
      left: c * CELL_W,
      top: r * CELL_H,
    })),
  );

  const finalBuffer = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: "#ffffff" },
  })
    .composite(compositeOps)
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

  return new Response(new Uint8Array(finalBuffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="grid-export-${projectId}.jpg"`,
      "Cache-Control": "no-store",
    },
  });
}
