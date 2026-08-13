// Converts an AI-generated, deliberately small/abstract layout description
// into real Fabric.js object JSON -- the exact shape fabric's own
// canvas.toJSON() produces, confirmed against fabric's source
// (FabricObject.toObject: `type: this.constructor.type`, so the real,
// case-sensitive type strings are "Rect"/"Circle"/"Image"/"IText", not
// lowercase). This is deterministic, untrusted-input-safe code, not another
// AI call -- Claude only ever proposes positions/text/colors; this is what
// turns that into something loadFromJSON can actually open as real,
// draggable/resizable/deletable layers, same as annotation-editor.tsx's own
// hand-built photo object (handleApplyCrop) already proves is safe to feed
// canvas.loadFromJSON().

export type DesignLayoutTextElement = {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  color: string;
  fontWeight: "normal" | "bold";
  align: "left" | "center" | "right";
};

export type DesignLayoutImageElement = {
  type: "image";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DesignLayoutShapeElement = {
  type: "shape";
  shape: "rect" | "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
};

export type DesignLayoutElement = DesignLayoutTextElement | DesignLayoutImageElement | DesignLayoutShapeElement;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && (HEX_RE.test(value) || value === "transparent") ? value : fallback;
}
function clampFraction(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export type ParsedDesignLayout = { baseAssetId: string | null; elements: DesignLayoutElement[] };

// Untrusted model output never reaches the canvas unsanitized: every
// numeric field is clamped, every enum is whitelisted (falling back to a
// safe default rather than rejecting the whole element), and any "image"
// element (or baseAssetId) referencing an assetId that isn't actually one
// of the task's own Images/Products items is dropped/nulled outright.
export function parseDesignLayout(raw: string, validAssetIds: Set<string>): ParsedDesignLayout {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { baseAssetId: null, elements: [] };

  let parsed: { baseAssetId?: unknown; elements?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { baseAssetId: null, elements: [] };
  }
  const items = Array.isArray(parsed.elements) ? parsed.elements : [];
  const baseAssetId =
    typeof parsed.baseAssetId === "string" && validAssetIds.has(parsed.baseAssetId) ? parsed.baseAssetId : null;

  const out: DesignLayoutElement[] = [];
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const x = clampFraction(item.x, 0);
    const y = clampFraction(item.y, 0);
    const w = Math.max(0.02, clampFraction(item.w, 0.3));
    const h = Math.max(0.02, clampFraction(item.h, 0.1));

    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      out.push({
        type: "text",
        x,
        y,
        w,
        h,
        text: item.text.slice(0, 280),
        fontSize: Math.max(10, Math.min(140, Number(item.fontSize) || 32)),
        color: safeColor(item.color, "#171412"),
        fontWeight: item.fontWeight === "bold" ? "bold" : "normal",
        align: item.align === "center" || item.align === "right" ? item.align : "left",
      });
    } else if (item.type === "image" && typeof item.assetId === "string" && validAssetIds.has(item.assetId)) {
      out.push({ type: "image", assetId: item.assetId, x, y, w, h });
    } else if (item.type === "shape") {
      out.push({
        type: "shape",
        shape: item.shape === "circle" ? "circle" : "rect",
        x,
        y,
        w,
        h,
        fill: safeColor(item.fill, "transparent"),
        stroke: safeColor(item.stroke, "#171412"),
      });
    }
  }
  return { baseAssetId, elements: out };
}

type ImageSource = { src: string; naturalW: number; naturalH: number };
type FabricObjectJson = Record<string, unknown>;

// Same "cover" fit AnnotationEditor's own fresh-load path uses (Math.max of
// the two axis ratios, scaled up until both axes are filled) -- kept as one
// helper since both the base photo and any secondary image element need it.
function coverFit(natural: ImageSource, boxW: number, boxH: number) {
  const scale = Math.max(boxW / natural.naturalW, boxH / natural.naturalH);
  return {
    scale,
    left: (boxW - natural.naturalW * scale) / 2,
    top: (boxH - natural.naturalH * scale) / 2,
  };
}

function baseFields(left: number, top: number, width: number, height: number) {
  return {
    version: "6.0.0",
    originX: "left",
    originY: "top",
    left,
    top,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    visible: true,
    strokeWidth: 0,
  };
}

export function layoutToFabricJson(
  layout: DesignLayoutElement[],
  canvasW: number,
  canvasH: number,
  basePhoto: ImageSource,
  imagesById: Map<string, ImageSource>,
): { version: string; objects: FabricObjectJson[] } {
  const objects: FabricObjectJson[] = [];

  // Base photo always first (bottom of the stack), tagged the same way
  // annotation-editor.tsx tags every fresh-loaded photo -- non-selectable,
  // non-evented, full-frame cover fit.
  const fit = coverFit(basePhoto, canvasW, canvasH);
  objects.push({
    ...baseFields(fit.left, fit.top, basePhoto.naturalW, basePhoto.naturalH),
    type: "Image",
    src: basePhoto.src,
    crossOrigin: "anonymous",
    scaleX: fit.scale,
    scaleY: fit.scale,
    selectable: false,
    evented: false,
    appRole: "basePhoto",
  });

  for (const el of layout) {
    const boxX = el.x * canvasW;
    const boxY = el.y * canvasH;
    const boxW = el.w * canvasW;
    const boxH = el.h * canvasH;

    if (el.type === "text") {
      objects.push({
        ...baseFields(boxX, boxY, boxW, boxH),
        type: "IText",
        text: el.text,
        fontSize: el.fontSize,
        fill: el.color,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: el.fontWeight,
        fontStyle: "normal",
        textAlign: el.align,
      });
    } else if (el.type === "shape") {
      if (el.shape === "circle") {
        const radius = Math.min(boxW, boxH) / 2;
        objects.push({
          ...baseFields(boxX, boxY, radius * 2, radius * 2),
          type: "Circle",
          radius,
          fill: el.fill,
          stroke: el.stroke,
          strokeWidth: el.stroke === "transparent" ? 0 : 3,
        });
      } else {
        objects.push({
          ...baseFields(boxX, boxY, boxW, boxH),
          type: "Rect",
          fill: el.fill,
          stroke: el.stroke,
          strokeWidth: el.stroke === "transparent" ? 0 : 3,
        });
      }
    } else if (el.type === "image") {
      const source = imagesById.get(el.assetId);
      if (!source) continue;
      const innerFit = coverFit(source, boxW, boxH);
      objects.push({
        ...baseFields(boxX + innerFit.left, boxY + innerFit.top, source.naturalW, source.naturalH),
        type: "Image",
        src: source.src,
        crossOrigin: "anonymous",
        scaleX: innerFit.scale,
        scaleY: innerFit.scale,
        // A fully normal, selectable/editable object (unlike the base
        // photo) -- cover-fit within its suggested box, not clipped to it,
        // so it may slightly overflow on one axis until the user resizes it.
      });
    }
  }

  return { version: "6.0.0", objects };
}
