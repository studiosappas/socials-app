"use client";

import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Button } from "@/components/ui/button";
import { saveBriefAnnotation } from "@/lib/actions/brief";

const INK = "#171412"; // matches --foreground
const MAX_DISPLAY = 640;

const BRUSH_COLORS = ["#171412", "#6b6a68", "#a8a29e", "#6b8e6b", "#b08a4e", "#b25450"];
const BRUSH_WIDTHS: { label: string; value: number }[] = [
  { label: "Thin", value: 2 },
  { label: "Medium", value: 5 },
  { label: "Thick", value: 10 },
];

type Tool = "select" | "draw" | "text" | "arrow" | "rect" | "circle" | "crop";

export function AnnotationEditor({
  projectId,
  attachmentId,
  open,
  imageUrl,
  initialAnnotationJson,
  onClose,
  onSaved,
}: {
  projectId: string;
  attachmentId: string | null;
  open: boolean;
  imageUrl: string | null;
  initialAnnotationJson: object | null;
  onClose: () => void;
  onSaved: (previewUrl: string) => void;
}) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const exportScaleRef = useRef(1);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);
  const cropGuideRef = useRef<fabric.Rect | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [brushColor, setBrushColor] = useState(INK);
  const [brushWidth, setBrushWidth] = useState(BRUSH_WIDTHS[1].value);

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
    cropGuideRef.current = null;

    fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((img) => {
      if (disposed) return;
      const naturalW = img.width ?? MAX_DISPLAY;
      const naturalH = img.height ?? MAX_DISPLAY;
      const displayScale = Math.min(1, MAX_DISPLAY / Math.max(naturalW, naturalH));
      exportScaleRef.current = displayScale > 0 ? 1 / displayScale : 1;

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
          canvas.requestRenderAll();
          finish();
        });
      } else {
        canvas.setDimensions({ width: naturalW * displayScale, height: naturalH * displayScale });
        img.scale(displayScale);
        img.set({ selectable: false, evented: false });
        canvas.backgroundImage = img;
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

    return () => {
      disposed = true;
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [open, imageUrl, initialAnnotationJson]);

  function withCanvas(fn: (canvas: fabric.Canvas) => void) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    fn(canvas);
  }

  function removeCropGuide(canvas: fabric.Canvas) {
    if (cropGuideRef.current) {
      canvas.remove(cropGuideRef.current);
      cropGuideRef.current = null;
      canvas.requestRenderAll();
    }
  }

  function activateTool(next: Tool) {
    withCanvas((canvas) => {
      if (tool === "crop" && next !== "crop") removeCropGuide(canvas);

      setTool(next);
      canvas.isDrawingMode = next === "draw";
      if (next === "draw") {
        const brush = new fabric.PencilBrush(canvas);
        brush.color = brushColor;
        brush.width = brushWidth;
        canvas.freeDrawingBrush = brush;
      }
      if (next === "text") {
        const text = new fabric.IText("Text", {
          left: canvas.getWidth() / 2 - 30,
          top: canvas.getHeight() / 2 - 12,
          fill: INK,
          fontFamily: "Inter, sans-serif",
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
        const w = canvas.getWidth() * 0.7;
        const h = canvas.getHeight() * 0.7;
        const guide = new fabric.Rect({
          left: (canvas.getWidth() - w) / 2,
          top: (canvas.getHeight() - h) / 2,
          width: w,
          height: h,
          fill: "transparent",
          stroke: INK,
          strokeDashArray: [6, 4],
          strokeWidth: 2,
          cornerColor: INK,
          transparentCorners: false,
        });
        cropGuideRef.current = guide;
        canvas.add(guide);
        canvas.setActiveObject(guide);
        canvas.requestRenderAll();
      }
    });
  }

  function handleApplyCrop() {
    withCanvas((canvas) => {
      const guide = cropGuideRef.current;
      const bg = canvas.backgroundImage as fabric.FabricImage | undefined;
      if (!guide || !bg) return;

      const bgLeft = bg.left ?? 0;
      const bgTop = bg.top ?? 0;
      const bgScaleX = bg.scaleX ?? 1;
      const bgScaleY = bg.scaleY ?? 1;

      const guideLeft = guide.left ?? 0;
      const guideTop = guide.top ?? 0;
      const guideW = guide.width! * (guide.scaleX ?? 1);
      const guideH = guide.height! * (guide.scaleY ?? 1);

      const cropX = Math.max(0, (bg.cropX ?? 0) + (guideLeft - bgLeft) / bgScaleX);
      const cropY = Math.max(0, (bg.cropY ?? 0) + (guideTop - bgTop) / bgScaleY);
      const cropW = guideW / bgScaleX;
      const cropH = guideH / bgScaleY;

      bg.set({ cropX, cropY, width: cropW, height: cropH, left: 0, top: 0 });
      canvas.setDimensions({ width: guideW, height: guideH });
      canvas.remove(guide);
      cropGuideRef.current = null;
      canvas.requestRenderAll();
      setTool("select");
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

  async function handleSave() {
    const canvas = fabricRef.current;
    if (!canvas || !attachmentId) return;
    setSaving(true);
    try {
      removeCropGuide(canvas);
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
      const result = await saveBriefAnnotation(projectId, attachmentId, formData);
      if (result.previewUrl) {
        onSaved(result.previewUrl);
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
        <div className="flex max-h-full items-center justify-center border border-dashed border-border bg-black/[.015] p-2">
          {!ready && imageUrl && <p className="p-10 text-sm text-muted">Loading image…</p>}
          {!imageUrl && <p className="p-24 text-2xl tracking-wide text-muted">IMAGE</p>}
          <canvas ref={canvasElRef} className={ready ? "" : "hidden"} />
        </div>
      </div>

      <div className="grid grid-cols-4 border-t border-border">
        <PrimaryToolButton active={tool === "crop"} onClick={() => activateTool("crop")} label="Crop Image" />
        <PrimaryToolButton active={tool === "draw"} onClick={() => activateTool("draw")} label="Draw" />
        <PrimaryToolButton active={false} onClick={() => activateTool("text")} label="Add Text" />
        <PrimaryToolButton active={false} onClick={() => activateTool("arrow")} label="Arrows" />
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
      </div>
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
