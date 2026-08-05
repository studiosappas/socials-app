"use client";

import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Button } from "@/components/ui/button";

const INK = "#171412"; // matches --foreground
const MAX_DISPLAY = 640;
const CROP_MIN_ZOOM = 1;
const CROP_MAX_ZOOM = 4;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const BRUSH_COLORS = ["#171412", "#6b6a68", "#a8a29e", "#6b8e6b", "#b08a4e", "#b25450"];
const BRUSH_WIDTHS: { label: string; value: number }[] = [
  { label: "Thin", value: 2 },
  { label: "Medium", value: 5 },
  { label: "Thick", value: 10 },
];
const TEXT_COLORS = ["#171412", "#6b6a68", "#a8a29e", "#6b8e6b", "#b08a4e", "#b25450", "#ffffff"];
// Generic CSS font-family stacks rather than named webfonts -- the canvas
// renders with whatever the browser resolves at draw time, and these three
// generic families (serif/sans-serif/cursive) always resolve to *something*
// reasonable without needing to load + await a custom webfont first.
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Sans Serif", value: "Arial, Helvetica, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Hand Write", value: "'Segoe Script', 'Bradley Hand', cursive" },
];
type TextAlign = "left" | "center" | "right";
const ALIGN_OPTIONS: { label: string; value: TextAlign }[] = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
];

type Tool = "select" | "draw" | "text" | "arrow" | "rect" | "circle" | "crop";

// The base photo lives as a regular (tagged, non-selectable) object in the
// canvas's own object stack rather than the special canvas.backgroundImage
// slot, specifically so other objects can be sent BEHIND it via Arrange, not
// just reordered in front of it. `appRole` marks which object that is; it
// only survives the toObject()/toJSON() round trip (and therefore
// reopening a saved annotation) because it's registered as a custom
// property here -- see fabric's own FabricObject.customProperties.
const BASE_PHOTO_ROLE = "basePhoto";
fabric.FabricObject.customProperties = ["appRole"];

type TaggableObject = fabric.FabricObject & { appRole?: string };
function tagAsBasePhoto(obj: fabric.FabricObject) {
  (obj as TaggableObject).appRole = BASE_PHOTO_ROLE;
}

export type AnnotationSaveAction = (
  projectId: string,
  targetId: string,
  formData: FormData,
) => Promise<{ previewUrl?: string; message?: string }>;

export function AnnotationEditor({
  projectId,
  attachmentId,
  open,
  imageUrl,
  initialAnnotationJson,
  onClose,
  onSaved,
  saveAction,
}: {
  projectId: string;
  attachmentId: string | null;
  open: boolean;
  imageUrl: string | null;
  initialAnnotationJson: object | null;
  onClose: () => void;
  onSaved: (previewUrl: string) => void;
  // Brief attachments and post/Grid media assets are saved through
  // different tables (brief_attachments vs media_assets) behind an
  // identical (projectId, id, formData) => {previewUrl|message} shape, so
  // the editor itself stays agnostic to which one it's editing.
  saveAction: AnnotationSaveAction;
}) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const exportScaleRef = useRef(1);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);

  const [tool, setTool] = useState<Tool>("select");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [brushColor, setBrushColor] = useState(INK);
  const [brushWidth, setBrushWidth] = useState(BRUSH_WIDTHS[1].value);
  // Mirrors the currently-selected IText object (if any) so the text
  // toolbar reflects and edits it -- shown whenever an IText is selected,
  // not just right after "Add Text", so re-selecting an existing text
  // object to restyle it also works.
  const [selectedText, setSelectedText] = useState<fabric.IText | null>(null);
  // Any FabricImage the user can select is one they added via "Add Logo /
  // Image" -- the canvas's own background image is set non-selectable/
  // non-evented (see the initial-load effect below), so it can never be
  // what this points at, which is what makes "Remove Background" safe to
  // scope to whatever's selected here without a separate is-it-the-
  // background check.
  const [selectedImage, setSelectedImage] = useState<fabric.FabricImage | null>(null);
  const [removingBackground, setRemovingBackground] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  // Any selected object at all (text, image, shape, arrow) -- gates the
  // Align/Arrange row, which applies the same regardless of object type.
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  // Snap-guide lines shown while dragging, in canvas-internal-pixel space
  // (converted to a CSS percentage at render time, which works regardless
  // of the canvas's internal-resolution-vs-display-size ratio). At most one
  // per axis -- only ever the single closest match, matching what actually
  // gets snapped to.
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [canvasBox, setCanvasBox] = useState<{ width: number; height: number } | null>(null);
  // The canvas's internal pixel resolution (distinct from canvasBox's CSS
  // display size) -- needed to convert a guide's canvas-space position into
  // a display percentage. Read from the fabric canvas inside an effect, not
  // inline during render, since reading a ref's .current during render
  // isn't render-pure (see the identical reasoning in use-undo-stack.ts).
  const [canvasResolution, setCanvasResolution] = useState<{ width: number; height: number } | null>(null);
  const [textColor, setTextColor] = useState(INK);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textFont, setTextFont] = useState(FONT_OPTIONS[0].value);
  const [textAlign, setTextAlign] = useState<TextAlign>("left");
  const [cropping, setCropping] = useState(false);
  // Same pan/zoom-within-a-fixed-frame model as Grid's own crop tool
  // (grid-crop-overlay.tsx): the frame (current canvas size) never changes,
  // only which portion of the source image fills it. zoom/offset are lifted
  // here rather than kept inside the overlay so the "Apply crop" button
  // (outside the overlay) can read the live values.
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [cropFrameSize, setCropFrameSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !imageUrl || !canvasElRef.current) return;

    let disposed = false;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      backgroundColor: "#ffffff",
      selection: true,
    });
    fabricRef.current = canvas;
    setReady(false);
    setTool("select");
    setCropping(false);

    fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((img) => {
      if (disposed) return;
      // Cap the canvas's actual pixel resolution to whatever's visible, not
      // just a fixed 640 -- on a narrow phone a 640px-wide canvas would
      // overflow and force scrolling *inside* the annotation area, which
      // makes touch dragging/drawing miss objects that are off-screen.
      // Sizing the canvas itself to fit avoids any CSS-vs-canvas-resolution
      // mismatch that could otherwise throw off touch/pointer accuracy.
      const maxDisplay = Math.max(240, Math.min(MAX_DISPLAY, window.innerWidth - 64, window.innerHeight - 280));
      const naturalW = img.width ?? maxDisplay;
      const naturalH = img.height ?? maxDisplay;
      const displayScale = Math.min(1, maxDisplay / Math.max(naturalW, naturalH));
      exportScaleRef.current = displayScale > 0 ? 1 / displayScale : 1;

      // Fabric's own toJSON()/loadFromJSON() never include canvas width/height
      // (their docs say so explicitly: "loadFromJSON does not affect canvas
      // size") -- so this must always be (re)computed and set here from the
      // ORIGINAL image's natural size before loading anything in, regardless
      // of which branch below runs. Without it, the canvas element keeps
      // whatever size a *previous* open left it at (or the browser's default
      // 300x150 on first mount), while every saved object's absolute
      // left/top/scale values were computed relative to the frame size at
      // save time -- rendering them into a differently-sized frame makes
      // them overflow past the visible canvas edge, which is exactly what
      // "the image is cut off" looked like.
      canvas.setDimensions({ width: naturalW * displayScale, height: naturalH * displayScale });

      function finish() {
        historyRef.current = [JSON.stringify(canvas.toJSON())];
        historyIndexRef.current = 0;
        setReady(true);
      }

      if (initialAnnotationJson) {
        // Reload the exact saved state -- objects, background crop, everything --
        // so annotations remain fully editable across sessions, not just baked pixels.
        canvas.loadFromJSON(initialAnnotationJson).then(() => {
          if (disposed) return;
          // The base photo used to live in canvas.backgroundImage (outside
          // the reorderable object stack, always rendered first no matter
          // what) -- it's now a regular, tagged, non-selectable object
          // instead, specifically so other objects can be sent BEHIND it
          // via Arrange, not just in front. An annotation saved before this
          // change still has the old backgroundImage shape; migrate it into
          // the new one on load rather than requiring a data migration.
          if (canvas.backgroundImage) {
            const legacyPhoto = canvas.backgroundImage as fabric.FabricImage;
            canvas.backgroundImage = undefined;
            legacyPhoto.set({ selectable: false, evented: false });
            tagAsBasePhoto(legacyPhoto);
            canvas.add(legacyPhoto);
            canvas.sendObjectToBack(legacyPhoto);
          }
          canvas.requestRenderAll();
          finish();
        });
      } else {
        img.scale(displayScale);
        // originX/originY default to "center" for every Fabric object
        // (including images) -- every left/top value anywhere in this file
        // is written assuming top-left positioning (0,0 = canvas corner),
        // so this must be set explicitly everywhere a background image is
        // configured, or the object renders offset by half its own size.
        // Added as a regular (tagged, non-selectable) object rather than
        // canvas.backgroundImage -- being first in the object stack already
        // puts it behind everything added after it, but unlike a true
        // background image, other objects can still be sent BEHIND it later
        // via Arrange (see the customProperties/BASE_PHOTO_ROLE note above
        // the component).
        img.set({ selectable: false, evented: false, originX: "left", originY: "top" });
        tagAsBasePhoto(img);
        canvas.add(img);
        canvas.requestRenderAll();
        finish();
      }
    });

    function pushHistory() {
      if (restoringRef.current) return;
      const json = JSON.stringify(canvas.toJSON());
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(json);
      historyIndexRef.current = historyRef.current.length - 1;
    }

    canvas.on("object:added", pushHistory);
    canvas.on("object:modified", pushHistory);
    canvas.on("object:removed", pushHistory);

    // Smart-guide snapping: while dragging, checks the moving object's own
    // edges/center against the canvas's edges/center and every OTHER
    // object's edges/center, and snaps (by nudging left/top directly) to
    // whichever single candidate is closest on each axis, within a small
    // pixel tolerance. Directly mutating target.left/top inside
    // "object:moving" and calling setCoords() is the standard fabric.js
    // pattern for this -- fabric's own render loop picks up the change
    // immediately after the handler returns.
    const SNAP_THRESHOLD = 6;
    function handleObjectMoving(e: { target?: fabric.FabricObject }) {
      const target = e.target;
      if (!target) return;
      const cw = canvas.getWidth();
      const ch = canvas.getHeight();
      const rect = target.getBoundingRect();

      const candidatesX = [0, cw / 2, cw];
      const candidatesY = [0, ch / 2, ch];
      for (const obj of canvas.getObjects()) {
        if (obj === target) continue;
        const r = obj.getBoundingRect();
        candidatesX.push(r.left, r.left + r.width / 2, r.left + r.width);
        candidatesY.push(r.top, r.top + r.height / 2, r.top + r.height);
      }

      const edgesX = [rect.left, rect.left + rect.width / 2, rect.left + rect.width];
      const edgesY = [rect.top, rect.top + rect.height / 2, rect.top + rect.height];

      let bestDx: number | null = null;
      let guideX: number | null = null;
      for (const edge of edgesX) {
        for (const cand of candidatesX) {
          const d = cand - edge;
          if (Math.abs(d) <= SNAP_THRESHOLD && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
            bestDx = d;
            guideX = cand;
          }
        }
      }
      let bestDy: number | null = null;
      let guideY: number | null = null;
      for (const edge of edgesY) {
        for (const cand of candidatesY) {
          const d = cand - edge;
          if (Math.abs(d) <= SNAP_THRESHOLD && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
            bestDy = d;
            guideY = cand;
          }
        }
      }

      if (bestDx !== null) target.set({ left: (target.left ?? 0) + bestDx });
      if (bestDy !== null) target.set({ top: (target.top ?? 0) + bestDy });
      if (bestDx !== null || bestDy !== null) target.setCoords();

      setGuides({ x: guideX, y: guideY });
    }
    canvas.on("object:moving", handleObjectMoving);
    canvas.on("object:modified", () => setGuides({ x: null, y: null }));
    canvas.on("mouse:up", () => setGuides({ x: null, y: null }));

    function syncSelection() {
      const active = canvas.getActiveObject();
      setSelectedObject(active ?? null);
      if (active instanceof fabric.IText) {
        setSelectedText(active);
        setTextColor((active.fill as string) ?? INK);
        setTextBold(active.fontWeight === "bold" || active.fontWeight === 700);
        setTextItalic(active.fontStyle === "italic");
        setTextFont((active.fontFamily as string) ?? FONT_OPTIONS[0].value);
        setTextAlign((active.textAlign as TextAlign) ?? "left");
      } else {
        setSelectedText(null);
      }
      setSelectedImage(active instanceof fabric.FabricImage ? active : null);
    }
    canvas.on("selection:created", syncSelection);
    canvas.on("selection:updated", syncSelection);
    canvas.on("selection:cleared", () => {
      setSelectedText(null);
      setSelectedImage(null);
      setSelectedObject(null);
    });

    return () => {
      disposed = true;
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [open, imageUrl, initialAnnotationJson]);

  // The canvas's on-screen box only actually changes when a new image
  // loads (ready flips false -> true) -- measured here once rather than on
  // every drag frame, since it's what the guide-line overlay below sizes
  // itself to match.
  useEffect(() => {
    if (!ready) return;
    const rect = canvasElRef.current?.getBoundingClientRect();
    if (rect) setCanvasBox({ width: rect.width, height: rect.height });
    const canvas = fabricRef.current;
    if (canvas) setCanvasResolution({ width: canvas.getWidth(), height: canvas.getHeight() });
  }, [ready]);

  function withCanvas(fn: (canvas: fabric.Canvas) => void) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    fn(canvas);
  }

  function activateTool(next: Tool) {
    withCanvas((canvas) => {
      setCropping(next === "crop");
      setTool(next);
      canvas.isDrawingMode = next === "draw";
      if (next === "draw") {
        canvas.discardActiveObject();
        const brush = new fabric.PencilBrush(canvas);
        brush.color = brushColor;
        brush.width = brushWidth;
        canvas.freeDrawingBrush = brush;
      }
      if (next === "text") {
        const text = new fabric.IText("Text", {
          left: canvas.getWidth() / 2 - 30,
          top: canvas.getHeight() / 2 - 12,
          fill: textColor,
          fontFamily: textFont,
          fontWeight: textBold ? "bold" : "normal",
          fontStyle: textItalic ? "italic" : "normal",
          textAlign,
          fontSize: 22,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        setTool("select");
        canvas.isDrawingMode = false;
      }
      if (next === "rect") {
        const rect = new fabric.Rect({
          left: canvas.getWidth() / 2 - 60,
          top: canvas.getHeight() / 2 - 40,
          width: 120,
          height: 80,
          fill: "transparent",
          stroke: INK,
          strokeWidth: 3,
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
        setTool("select");
      }
      if (next === "circle") {
        const circle = new fabric.Circle({
          left: canvas.getWidth() / 2 - 40,
          top: canvas.getHeight() / 2 - 40,
          radius: 40,
          fill: "transparent",
          stroke: INK,
          strokeWidth: 3,
        });
        canvas.add(circle);
        canvas.setActiveObject(circle);
        setTool("select");
      }
      if (next === "arrow") {
        const line = new fabric.Line([0, 20, 100, 20], {
          stroke: INK,
          strokeWidth: 3,
          originX: "center",
          originY: "center",
        });
        const head = new fabric.Triangle({
          left: 100,
          top: 20,
          originX: "center",
          originY: "center",
          angle: 90,
          width: 16,
          height: 18,
          fill: INK,
        });
        const arrow = new fabric.Group([line, head], {
          left: canvas.getWidth() / 2 - 50,
          top: canvas.getHeight() / 2,
        });
        canvas.add(arrow);
        canvas.setActiveObject(arrow);
        setTool("select");
      }
      if (next === "crop") {
        const rect = canvasElRef.current?.getBoundingClientRect();
        setCropFrameSize(rect ? { width: rect.width, height: rect.height } : null);
        setCropZoom(1);
        setCropOffset({ x: 0, y: 0 });
      }
    });
  }

  // Mirrors Grid's crop math exactly (see grid-crop-overlay.tsx): the frame
  // (current canvas size) never changes -- only which portion of the
  // original source image is scaled to fill it. Always recomputed against a
  // freshly-loaded copy of the ORIGINAL image (not the current, possibly
  // already-cropped background) so a new crop always starts from the true
  // full image rather than compounding shrinking precision from a previous
  // crop, and "Cancel crop" has nothing partial to undo.
  // Applying a crop by directly mutating (or replacing) the live
  // canvas.backgroundImage object and calling requestRenderAll() turned out
  // not to visually update the canvas at all -- verified with a debug hook
  // reading the object's own properties (correct), toDataURL() output
  // (byte-identical before/after despite different crop values), and even
  // mutating the SAME already-rendering object in place (still no change).
  // Root cause not fully isolated, but canvas.loadFromJSON() is a
  // completely different code path that's already proven to correctly
  // restore a cropped background image (it's what reopening a saved
  // annotation uses), so route through that instead of the imperative
  // object-mutation API: take the canvas's own current serialization as a
  // template (preserving whatever shape Fabric already uses for type/
  // originX/originY/etc, which side-steps needing to guess it), and only
  // override the crop-specific fields.
  function handleApplyCrop() {
    const canvas = fabricRef.current;
    if (!canvas || !imageUrl) return;
    const frameW = canvas.getWidth();
    const frameH = canvas.getHeight();
    fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((freshImg) => {
      const naturalW = freshImg.width ?? frameW;
      const naturalH = freshImg.height ?? frameH;
      // Same "cover" baseline as the initial image load: at zoom 1 the full
      // image exactly fills the frame (cropping whichever axis overflows).
      const coverScale = Math.max(frameW / naturalW, frameH / naturalH);
      const cropW = clamp(frameW / (coverScale * cropZoom), 0, naturalW);
      const cropH = clamp(frameH / (coverScale * cropZoom), 0, naturalH);
      // offset is a fraction of the FRAME (matching Grid's own drag-delta
      // convention), which is the same as a fraction of the crop window's
      // own natural size -- both are scaled by the same factor to fill the
      // frame, so a "one frame-width" drag is exactly "one crop-window-
      // width" in natural pixels, regardless of zoom.
      const cropX = clamp((naturalW - cropW) / 2 + cropOffset.x * cropW, 0, naturalW - cropW);
      const cropY = clamp((naturalH - cropH) / 2 + cropOffset.y * cropH, 0, naturalH - cropH);

      // The base photo is a regular (tagged) entry in json.objects now, not
      // the special json.backgroundImage key -- see BASE_PHOTO_ROLE.
      const json = canvas.toJSON() as { objects?: Record<string, unknown>[]; [k: string]: unknown };
      const objects = json.objects ?? [];
      const photoIndex = objects.findIndex((o) => o.appRole === BASE_PHOTO_ROLE);
      const updatedPhoto = {
        ...(photoIndex >= 0 ? objects[photoIndex] : {}),
        appRole: BASE_PHOTO_ROLE,
        src: imageUrl,
        cropX,
        cropY,
        width: cropW,
        height: cropH,
        scaleX: frameW / cropW,
        scaleY: frameH / cropH,
        left: 0,
        top: 0,
        // See the identical note on the initial-load path -- without this,
        // the object renders centered on (left,top) instead of anchored
        // there, which is why the crop never appeared to visually apply.
        originX: "left",
        originY: "top",
      };
      if (photoIndex >= 0) {
        objects[photoIndex] = updatedPhoto;
      } else {
        objects.unshift(updatedPhoto);
      }
      json.objects = objects;
      canvas.loadFromJSON(json).then(() => {
        canvas.requestRenderAll();
        setCropping(false);
        setTool("select");
      });
    });
  }

  function handleUndo() {
    withCanvas((canvas) => {
      if (historyIndexRef.current <= 0) return;
      historyIndexRef.current -= 1;
      restoringRef.current = true;
      canvas.loadFromJSON(JSON.parse(historyRef.current[historyIndexRef.current])).then(() => {
        canvas.requestRenderAll();
        restoringRef.current = false;
      });
    });
  }

  function handleRedo() {
    withCanvas((canvas) => {
      if (historyIndexRef.current >= historyRef.current.length - 1) return;
      historyIndexRef.current += 1;
      restoringRef.current = true;
      canvas.loadFromJSON(JSON.parse(historyRef.current[historyIndexRef.current])).then(() => {
        canvas.requestRenderAll();
        restoringRef.current = false;
      });
    });
  }

  function handleDeleteSelected() {
    withCanvas((canvas) => {
      const active = canvas.getActiveObjects();
      if (active.length === 0) return;
      active.forEach((obj) => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    });
  }

  // Delta-based (compute how far off the object's current bounding box is
  // from the target edge/center, then nudge left/top by that amount) rather
  // than setting left/top directly to an absolute value -- works regardless
  // of the object's own originX/originY, since getBoundingRect() is always
  // in absolute canvas-space.
  function alignObject(edge: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) return;
    const rect = active.getBoundingRect();
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    let dx = 0;
    let dy = 0;
    switch (edge) {
      case "left":
        dx = 0 - rect.left;
        break;
      case "centerH":
        dx = (cw - rect.width) / 2 - rect.left;
        break;
      case "right":
        dx = cw - rect.width - rect.left;
        break;
      case "top":
        dy = 0 - rect.top;
        break;
      case "centerV":
        dy = (ch - rect.height) / 2 - rect.top;
        break;
      case "bottom":
        dy = ch - rect.height - rect.top;
        break;
    }
    active.set({ left: (active.left ?? 0) + dx, top: (active.top ?? 0) + dy });
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: active });
  }

  function arrangeZ(action: "front" | "forward" | "backward" | "back") {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) return;
    if (action === "front") canvas.bringObjectToFront(active);
    else if (action === "forward") canvas.bringObjectForward(active);
    else if (action === "backward") canvas.sendObjectBackwards(active);
    else canvas.sendObjectToBack(active);
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: active });
  }

  function handleAddLogoClick() {
    logoInputRef.current?.click();
  }

  // Reads the file as a data URL rather than uploading it anywhere first --
  // the whole canvas (this image included) already gets baked into one flat
  // JPEG at save time, and fabric's own toJSON()/loadFromJSON() already
  // round-trips every other object type (text, shapes) purely through this
  // same JSON blob, so embedding the logo's own bytes here keeps it in that
  // one already-established, self-contained persistence model instead of
  // adding a second upload path and a stored-file reference to keep in sync.
  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      withCanvas((canvas) => {
        fabric.FabricImage.fromURL(dataUrl).then((img) => {
          // Sized to a reasonable starting footprint (40% of the shorter
          // canvas dimension) rather than the logo's own often-huge native
          // pixel size -- it's still fully resizable afterward like any
          // other object.
          const maxDim = Math.min(canvas.getWidth(), canvas.getHeight()) * 0.4;
          const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          img.set({
            left: canvas.getWidth() / 2,
            top: canvas.getHeight() / 2,
            originX: "center",
            originY: "center",
            scaleX: scale,
            scaleY: scale,
          });
          canvas.add(img);
          canvas.setActiveObject(img);
          canvas.requestRenderAll();
          setTool("select");
        });
      });
    };
    reader.readAsDataURL(file);
  }

  // Chroma-key removal, not general (ML) background removal -- matched to
  // the actual ask ("logos/packshots with colored background"), which is
  // exactly the case a corner-sampled flat-color key handles well, without
  // pulling in a heavy segmentation model/dependency for it. Samples the
  // four corners of the selected image (assumed background, not subject)
  // and makes anything within a color-distance tolerance transparent, with
  // a short feather band so the cut edge isn't hard-aliased.
  async function handleRemoveBackground() {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !(active instanceof fabric.FabricImage)) return;

    setRemovingBackground(true);
    try {
      const { width, height } = active.getOriginalSize();
      if (!width || !height) return;
      const off = document.createElement("canvas");
      off.width = width;
      off.height = height;
      const ctx = off.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(active.getElement() as CanvasImageSource, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      function pixelAt(x: number, y: number): [number, number, number] {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      }
      const corners = [pixelAt(0, 0), pixelAt(width - 1, 0), pixelAt(0, height - 1), pixelAt(width - 1, height - 1)];
      const bg = [0, 1, 2].map((c) => corners.reduce((sum, p) => sum + p[c], 0) / corners.length);

      const TOLERANCE = 40;
      const FEATHER = 25;
      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - bg[0];
        const dg = data[i + 1] - bg[1];
        const db = data[i + 2] - bg[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < TOLERANCE) {
          data[i + 3] = 0;
        } else if (dist < TOLERANCE + FEATHER) {
          data[i + 3] = Math.round(data[i + 3] * ((dist - TOLERANCE) / FEATHER));
        }
      }
      ctx.putImageData(imageData, 0, 0);

      const resultUrl = off.toDataURL("image/png");
      const resultEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = resultUrl;
      });

      // Swaps which element this SAME object renders, rather than
      // replacing the object -- position/scale/rotation/selection all stay
      // exactly as they were, no remove+re-add bookkeeping needed.
      active.setElement(resultEl);
      canvas.requestRenderAll();
      canvas.fire("object:modified", { target: active });
    } catch (error) {
      console.error("Failed to remove background:", error);
    } finally {
      setRemovingBackground(false);
    }
  }

  function handleBrushColorChange(color: string) {
    setBrushColor(color);
    withCanvas((canvas) => {
      if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = color;
    });
  }

  function handleBrushWidthChange(width: number) {
    setBrushWidth(width);
    withCanvas((canvas) => {
      if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = width;
    });
  }

  // Direct .set() calls on a fabric object don't fire "object:modified" on
  // their own (that only fires after a user drag/resize gesture completes),
  // so re-fire it manually -- that's the event the history stack listens on,
  // and reusing it keeps style edits undo-able the same way moves/resizes are.
  function applyTextStyle(props: Partial<fabric.ITextProps>) {
    if (!selectedText) return;
    selectedText.set(props);
    withCanvas((canvas) => {
      canvas.requestRenderAll();
      canvas.fire("object:modified", { target: selectedText });
    });
  }

  function handleTextColorChange(color: string) {
    setTextColor(color);
    applyTextStyle({ fill: color });
  }

  function handleTextBoldToggle() {
    const next = !textBold;
    setTextBold(next);
    applyTextStyle({ fontWeight: next ? "bold" : "normal" });
  }

  function handleTextItalicToggle() {
    const next = !textItalic;
    setTextItalic(next);
    applyTextStyle({ fontStyle: next ? "italic" : "normal" });
  }

  function handleTextFontChange(font: string) {
    setTextFont(font);
    applyTextStyle({ fontFamily: font });
  }

  function handleTextAlignChange(align: TextAlign) {
    setTextAlign(align);
    applyTextStyle({ textAlign: align });
  }

  async function handleSave() {
    const canvas = fabricRef.current;
    if (!canvas || !attachmentId) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const annotationJson = JSON.stringify(canvas.toJSON());
      const dataUrl = canvas.toDataURL({
        format: "jpeg",
        quality: 0.92,
        multiplier: exportScaleRef.current,
      });
      const blob = await (await fetch(dataUrl)).blob();
      const formData = new FormData();
      formData.set("file", new File([blob], "annotated-preview.jpg", { type: "image/jpeg" }));
      formData.set("annotation_json", annotationJson);
      const result = await saveAction(projectId, attachmentId, formData);
      if (result.previewUrl) {
        onSaved(result.previewUrl);
      } else {
        // Previously silent -- a failed save (e.g. a pending migration
        // meaning the target column doesn't exist yet) looked identical to
        // a successful one from the user's side: the dialog just stayed
        // open with no feedback at all.
        setSaveError(result.message ?? "Couldn't save changes.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-end px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
        >
          Close <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1 px-6 pb-2">
        <ToolButton active={tool === "select"} onClick={() => activateTool("select")} label="Select" />
        <ToolButton active={false} onClick={() => activateTool("rect")} label="Rectangle" />
        <ToolButton active={false} onClick={() => activateTool("circle")} label="Circle" />
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolButton active={false} onClick={handleUndo} label="Undo" />
        <ToolButton active={false} onClick={handleRedo} label="Redo" />
        <ToolButton active={false} onClick={handleDeleteSelected} label="Delete" />
      </div>

      {tool === "draw" && (
        <div className="flex flex-wrap items-center justify-center gap-3 pb-2">
          <div className="flex items-center gap-1">
            {BRUSH_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handleBrushColorChange(color)}
                title={color}
                style={{ backgroundColor: color }}
                className={`h-5 w-5 rounded-full border ${
                  brushColor === color ? "border-foreground" : "border-border"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {BRUSH_WIDTHS.map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => handleBrushWidthChange(w.value)}
                className={`rounded px-2 py-1 text-xs ${
                  brushWidth === w.value ? "bg-foreground text-background" : "hover:bg-black/[.05]"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedObject && (
        <div className="flex flex-wrap items-center justify-center gap-3 pb-2">
          <div className="flex items-center gap-1">
            <IconToolButton onClick={() => alignObject("left")} label="Align left">
              <AlignIcon axis="h" edge="start" />
            </IconToolButton>
            <IconToolButton onClick={() => alignObject("centerH")} label="Align center">
              <AlignIcon axis="h" edge="center" />
            </IconToolButton>
            <IconToolButton onClick={() => alignObject("right")} label="Align right">
              <AlignIcon axis="h" edge="end" />
            </IconToolButton>
          </div>
          <div className="flex items-center gap-1">
            <IconToolButton onClick={() => alignObject("top")} label="Align top">
              <AlignIcon axis="v" edge="start" />
            </IconToolButton>
            <IconToolButton onClick={() => alignObject("centerV")} label="Align middle">
              <AlignIcon axis="v" edge="center" />
            </IconToolButton>
            <IconToolButton onClick={() => alignObject("bottom")} label="Align bottom">
              <AlignIcon axis="v" edge="end" />
            </IconToolButton>
          </div>
          <div className="flex items-center gap-1">
            <IconToolButton onClick={() => arrangeZ("front")} label="Bring to front">
              <LayerIcon variant="front" />
            </IconToolButton>
            <IconToolButton onClick={() => arrangeZ("forward")} label="Bring forward">
              <LayerIcon variant="forward" />
            </IconToolButton>
            <IconToolButton onClick={() => arrangeZ("backward")} label="Send backward">
              <LayerIcon variant="backward" />
            </IconToolButton>
            <IconToolButton onClick={() => arrangeZ("back")} label="Send to back">
              <LayerIcon variant="back" />
            </IconToolButton>
          </div>
        </div>
      )}

      {selectedImage && (
        <div className="flex flex-wrap items-center justify-center gap-3 pb-2">
          <Button
            type="button"
            variant="secondary"
            radius="full"
            onClick={handleRemoveBackground}
            disabled={removingBackground}
          >
            {removingBackground ? "Removing…" : "Remove Background"}
          </Button>
        </div>
      )}

      {selectedText && (
        <div className="flex flex-wrap items-center justify-center gap-3 pb-2">
          <div className="flex items-center gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handleTextColorChange(color)}
                title={color}
                style={{ backgroundColor: color }}
                className={`h-5 w-5 rounded-full border ${
                  textColor === color ? "border-foreground" : "border-border"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleTextBoldToggle}
              title="Bold"
              className={`w-7 rounded px-2 py-1 text-xs font-bold ${
                textBold ? "bg-foreground text-background" : "hover:bg-black/[.05]"
              }`}
            >
              B
            </button>
            <button
              type="button"
              onClick={handleTextItalicToggle}
              title="Italic"
              className={`w-7 rounded px-2 py-1 text-xs italic ${
                textItalic ? "bg-foreground text-background" : "hover:bg-black/[.05]"
              }`}
            >
              I
            </button>
          </div>
          <div className="flex items-center gap-1">
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => handleTextFontChange(f.value)}
                style={{ fontFamily: f.value }}
                className={`rounded px-2 py-1 text-xs ${
                  textFont === f.value ? "bg-foreground text-background" : "hover:bg-black/[.05]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {ALIGN_OPTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => handleTextAlignChange(a.value)}
                title={`Align ${a.label.toLowerCase()}`}
                className={`rounded px-2 py-1 text-xs ${
                  textAlign === a.value ? "bg-foreground text-background" : "hover:bg-black/[.05]"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {tool === "crop" && (
        <div className="flex items-center justify-center gap-2 pb-2">
          <Button type="button" variant="primary" radius="full" onClick={handleApplyCrop}>
            Apply crop
          </Button>
          <Button type="button" variant="secondary" radius="full" onClick={() => activateTool("select")}>
            Cancel crop
          </Button>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-2">
        <div className="relative flex max-h-full items-center justify-center border border-dashed border-border bg-black/[.015] p-2">
          {/* A loading/placeholder OVERLAY, not a class toggle on the canvas
              itself -- Fabric.js clones the canvas element's className into
              its own internally-created interactive "upper-canvas" once, at
              construction time (which happens here before the image finishes
              loading, while ready is still false). Toggling the ref'd
              canvas's own className between "hidden" and "" therefore
              permanently bakes `class="hidden upper-canvas"` into Fabric's
              real interactive layer -- it never becomes visible/sized again
              even once `ready` flips true, which silently breaks every
              pointer-driven interaction (draw, crop-guide drag, object
              select/move) while leaving button-triggered actions like
              canvas.add() working fine, since those don't depend on the
              upper-canvas receiving events at all. The canvas element here
              must always keep the exact same className/style. */}
          {!ready && imageUrl && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/[.015]">
              <p className="text-sm text-muted">Loading image…</p>
            </div>
          )}
          {!imageUrl && <p className="p-24 text-2xl tracking-wide text-muted">IMAGE</p>}
          {/* max-width/height here is a display-only fallback (e.g. reopening
              an annotation that was originally saved at a larger desktop
              resolution) -- Fabric's own pointer scaling already accounts
              for CSS size differing from the canvas's internal resolution
              (the same mechanism it uses for retina/HiDPI), so this doesn't
              risk touch/mouse coordinate accuracy. The fresh-image path
              above already sizes the canvas's actual resolution to fit, so
              this rarely has to do any work there. Uses `invisible`, not a
              layout-affecting hide, so its measured box stays put for the
              crop overlay below to align against -- and importantly, this
              class only ever gets applied well after `ready` is already
              true (crop can't be entered before then), so it can't hit the
              upper-canvas construction-time staleness bug documented above. */}
          <canvas
            ref={canvasElRef}
            className={cropping ? "invisible" : ""}
            style={{ maxWidth: "100%", maxHeight: "100%", height: "auto" }}
          />
          {cropping && imageUrl && cropFrameSize && (
            <div
              className="absolute"
              style={{
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: cropFrameSize.width,
                height: cropFrameSize.height,
              }}
            >
              <AnnotationCropOverlay
                imageUrl={imageUrl}
                zoom={cropZoom}
                offset={cropOffset}
                onZoomChange={setCropZoom}
                onOffsetChange={setCropOffset}
              />
            </div>
          )}
          {/* Unconditionally mounted (not gated on guides.x/y like the lines
              inside it) -- this div sits as a direct sibling of the
              Fabric-controlled <canvas>, and Fabric wraps that canvas in its
              own extra DOM (a "canvas-container" div + upper-canvas) that
              React never finds out about. Toggling THIS wrapper's own
              presence in/out of the tree on every mousemove during a drag
              (guides.x/y flip null<->set constantly while dragging) raced
              against Fabric's internal DOM writes and crashed with "Failed
              to execute 'insertBefore' ... not a child of this node" --
              severe enough to blank the whole app, not just this dialog.
              Keeping the wrapper itself always present (mounted once
              per image load, same low frequency as the crop overlay below,
              which never showed this crash) and only toggling the two line
              elements INSIDE it avoids ever touching this div's own
              sibling position relative to the canvas. */}
          {!cropping && canvasBox && canvasResolution && (
            <div
              className="pointer-events-none absolute"
              style={{
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: canvasBox.width,
                height: canvasBox.height,
              }}
            >
              {guides.x !== null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-[#b25450]"
                  style={{ left: `${(guides.x / canvasResolution.width) * 100}%` }}
                />
              )}
              {guides.y !== null && (
                <div
                  className="absolute left-0 right-0 h-px bg-[#b25450]"
                  style={{ top: `${(guides.y / canvasResolution.height) * 100}%` }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleLogoFileChange}
      />
      <div className="grid grid-cols-5 border-t border-border">
        <PrimaryToolButton active={tool === "crop"} onClick={() => activateTool("crop")} label="Crop Image" />
        <PrimaryToolButton active={tool === "draw"} onClick={() => activateTool("draw")} label="Draw" />
        <PrimaryToolButton active={false} onClick={() => activateTool("text")} label="Add Text" />
        <PrimaryToolButton active={false} onClick={() => activateTool("arrow")} label="Arrows" />
        <PrimaryToolButton active={false} onClick={handleAddLogoClick} label="Add Logo" />
      </div>

      <div className="flex flex-col items-center gap-2 px-6 py-6">
        {!attachmentId && (
          <p className="text-xs text-error">Annotation storage isn&apos;t set up yet for this image.</p>
        )}
        <Button
          type="button"
          variant="primary"
          radius="full"
          onClick={handleSave}
          disabled={saving || !ready || !attachmentId}
          className="w-64"
        >
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        {saveError && <p className="text-xs text-error">{saveError}</p>}
      </div>
    </div>
  );
}

// Same pan/zoom-within-a-fixed-frame interaction as Grid's own crop tool
// (grid-crop-overlay.tsx): drag the image to pan, drag a corner handle to
// scale it uniformly around the frame's center -- the frame itself never
// moves or resizes. zoom/offset are controlled from the parent (rather than
// committing internally on click-outside/double-click like Grid does) since
// Brief already has explicit "Apply crop"/"Cancel crop" buttons elsewhere in
// its toolbar, unlike Grid's chrome-less inline editing.
function AnnotationCropOverlay({
  imageUrl,
  zoom,
  offset,
  onZoomChange,
  onOffsetChange,
}: {
  imageUrl: string;
  zoom: number;
  offset: { x: number; y: number };
  onZoomChange: (zoom: number) => void;
  onOffsetChange: (offset: { x: number; y: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(
    null,
  );
  const handleDragRef = useRef<{
    startDist: number;
    startZoom: number;
    startOffset: { x: number; y: number };
  } | null>(null);

  function clampOffset(next: { x: number; y: number }, z: number) {
    const maxOffset = (z - 1) / 2;
    return {
      x: clamp(next.x, -maxOffset, maxOffset),
      y: clamp(next.y, -maxOffset, maxOffset),
    };
  }

  function handleImagePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!panRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dxFrac = (e.clientX - panRef.current.startX) / rect.width;
    const dyFrac = (e.clientY - panRef.current.startY) / rect.height;
    onOffsetChange(
      clampOffset(
        { x: panRef.current.startOffset.x + dxFrac, y: panRef.current.startOffset.y + dyFrac },
        zoom,
      ),
    );
  }

  function handleImagePointerUp(e: React.PointerEvent<HTMLImageElement>) {
    if (panRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    panRef.current = null;
  }

  function handleCornerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy);
    handleDragRef.current = { startDist, startZoom: zoom, startOffset: offset };
  }

  function handleCornerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!handleDragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    const ratio = dist / handleDragRef.current.startDist;
    const nextZoom = clamp(handleDragRef.current.startZoom * ratio, CROP_MIN_ZOOM, CROP_MAX_ZOOM);
    onZoomChange(nextZoom);
    onOffsetChange(clampOffset(handleDragRef.current.startOffset, nextZoom));
  }

  function handleCornerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (handleDragRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    handleDragRef.current = null;
  }

  const imageStyle: React.CSSProperties = {
    transform: `translate(${offset.x * 100}%, ${offset.y * 100}%) scale(${zoom})`,
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Dimmed, unclipped copy shows the full image so the part outside the
          frame stays visible as context, exactly like Grid's crop tool. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        onPointerDown={handleImagePointerDown}
        onPointerMove={handleImagePointerMove}
        onPointerUp={handleImagePointerUp}
        className="absolute inset-0 h-full w-full cursor-move touch-none object-cover opacity-40"
        style={imageStyle}
      />
      {/* Full-opacity copy, clipped to the frame -- this is the actual crop. */}
      <div className="absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={handleImagePointerUp}
          className="absolute inset-0 h-full w-full cursor-move touch-none object-cover"
          style={imageStyle}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 border-2 border-foreground" />
      {(["tl", "tr", "bl", "br"] as const).map((corner) => (
        <CropCornerHandle
          key={corner}
          corner={corner}
          onPointerDown={handleCornerPointerDown}
          onPointerMove={handleCornerPointerMove}
          onPointerUp={handleCornerPointerUp}
        />
      ))}
    </div>
  );
}

function CropCornerHandle({
  corner,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  corner: "tl" | "tr" | "bl" | "br";
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isTop = corner.startsWith("t");
  const isLeft = corner.endsWith("l");
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`absolute z-10 flex h-9 w-9 touch-none items-center justify-center ${
        isTop && isLeft ? "cursor-nwse-resize" : ""
      } ${isTop && !isLeft ? "cursor-nesw-resize" : ""} ${!isTop && isLeft ? "cursor-nesw-resize" : ""} ${
        !isTop && !isLeft ? "cursor-nwse-resize" : ""
      }`}
      style={{
        top: isTop ? -18 : undefined,
        bottom: !isTop ? -18 : undefined,
        left: isLeft ? -18 : undefined,
        right: !isLeft ? -18 : undefined,
      }}
    >
      <div className="h-5 w-5 rounded-full border-2 border-foreground bg-background shadow-[0_1px_5px_rgba(0,0,0,0.35)]" />
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs ${
        active ? "bg-foreground text-background" : "hover:bg-black/[.05]"
      }`}
    >
      {label}
    </button>
  );
}

function IconToolButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex items-center justify-center rounded p-1.5 text-foreground transition-colors duration-150 hover:bg-black/[.05]"
    >
      {children}
    </button>
  );
}

// Object-alignment glyphs: a line marking the edge/axis being aligned to,
// plus a few bars of different lengths flush/centered against it -- the
// same visual convention Figma/Canva use for these. `axis` picks
// horizontal (align left/center/right, bars are horizontal rows) vs
// vertical (align top/middle/bottom, bars are vertical columns); `edge`
// picks which of the three positions along that axis.
function AlignIcon({ axis, edge }: { axis: "h" | "v"; edge: "start" | "center" | "end" }) {
  const lengths = [10, 6, 8];
  const positions = [2, 6, 10];
  function trackStart(length: number) {
    if (edge === "start") return 2;
    if (edge === "end") return 12 - length;
    return 7 - length / 2;
  }
  const linePos = edge === "start" ? 1 : edge === "end" ? 13 : 7;

  if (axis === "h") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <line
          x1={linePos}
          y1="1"
          x2={linePos}
          y2="13"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeDasharray={edge === "center" ? "1.5 1.5" : undefined}
        />
        {lengths.map((len, i) => (
          <rect key={i} x={trackStart(len)} y={positions[i]} width={len} height="1.6" fill="currentColor" />
        ))}
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <line
        x1="1"
        y1={linePos}
        x2="13"
        y2={linePos}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeDasharray={edge === "center" ? "1.5 1.5" : undefined}
      />
      {lengths.map((len, i) => (
        <rect key={i} x={positions[i]} y={trackStart(len)} width="1.6" height={len} fill="currentColor" />
      ))}
    </svg>
  );
}

// Z-order glyph: two overlapping squares (the object being moved, and
// everything else) -- which one renders filled marks the extremes ("to
// front"/"to back"); a small chevron on the outline pair marks the
// one-step "forward"/"backward" moves.
function LayerIcon({ variant }: { variant: "front" | "forward" | "backward" | "back" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="7.5"
        height="7.5"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.1"
        fill={variant === "back" ? "currentColor" : "none"}
      />
      <rect
        x="5"
        y="5"
        width="7.5"
        height="7.5"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.1"
        fill={variant === "front" ? "currentColor" : "none"}
      />
      {variant === "forward" && (
        <path d="M9.6 8.6L8.75 7.6L7.9 8.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {variant === "backward" && (
        <path d="M9.6 7.4L8.75 8.4L7.9 7.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function PrimaryToolButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-3 text-xs font-semibold tracking-wide uppercase text-background transition-colors duration-150 ${
        active ? "bg-black/85" : "bg-foreground hover:bg-black/85"
      }`}
    >
      {label}
    </button>
  );
}
