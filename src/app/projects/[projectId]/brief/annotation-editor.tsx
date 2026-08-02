"use client";

import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uploadBriefImage } from "@/lib/actions/brief";

const INK = "#171412"; // matches --foreground
const MAX_DISPLAY = 640;

type Tool = "select" | "draw" | "text" | "arrow" | "rect" | "circle";

export function AnnotationEditor({
  projectId,
  open,
  imageUrl,
  onClose,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  imageUrl: string | null;
  onClose: () => void;
  onSaved: (newUrl: string) => void;
}) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const exportScaleRef = useRef(1);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);

  const [tool, setTool] = useState<Tool>("select");
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open || !imageUrl || !canvasElRef.current) return;

    let disposed = false;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      backgroundColor: "#ffffff",
      selection: true,
    });
    fabricRef.current = canvas;
    setReady(false);

    fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((img) => {
      if (disposed) return;
      const naturalW = img.width ?? MAX_DISPLAY;
      const naturalH = img.height ?? MAX_DISPLAY;
      const displayScale = Math.min(1, MAX_DISPLAY / Math.max(naturalW, naturalH));
      exportScaleRef.current = displayScale > 0 ? 1 / displayScale : 1;

      canvas.setDimensions({ width: naturalW * displayScale, height: naturalH * displayScale });
      img.scale(displayScale);
      img.set({ selectable: false, evented: false });
      canvas.backgroundImage = img;
      canvas.requestRenderAll();

      historyRef.current = [JSON.stringify(canvas.toJSON())];
      historyIndexRef.current = 0;
      setReady(true);
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
  }, [open, imageUrl]);

  function withCanvas(fn: (canvas: fabric.Canvas) => void) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    fn(canvas);
  }

  function activateTool(next: Tool) {
    setTool(next);
    withCanvas((canvas) => {
      canvas.isDrawingMode = next === "draw";
      if (next === "draw") {
        const brush = new fabric.PencilBrush(canvas);
        brush.color = INK;
        brush.width = 3;
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

  async function handleSave() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const dataUrl = canvas.toDataURL({
        format: "jpeg",
        quality: 0.92,
        multiplier: exportScaleRef.current,
      });
      const blob = await (await fetch(dataUrl)).blob();
      const formData = new FormData();
      formData.set("file", new File([blob], "annotated.jpg", { type: "image/jpeg" }));
      const result = await uploadBriefImage(projectId, formData);
      if (result.url) {
        onSaved(result.url);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Annotate image" widthClassName="max-w-3xl">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          <ToolButton active={tool === "select"} onClick={() => activateTool("select")} label="Select" />
          <ToolButton active={tool === "draw"} onClick={() => activateTool("draw")} label="Draw" />
          <ToolButton active={false} onClick={() => activateTool("text")} label="Text" />
          <ToolButton active={false} onClick={() => activateTool("arrow")} label="Arrow" />
          <ToolButton active={false} onClick={() => activateTool("rect")} label="Rectangle" />
          <ToolButton active={false} onClick={() => activateTool("circle")} label="Circle" />
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolButton active={false} onClick={handleUndo} label="Undo" />
          <ToolButton active={false} onClick={handleRedo} label="Redo" />
          <ToolButton active={false} onClick={handleDeleteSelected} label="Delete" />
        </div>

        <div className="flex items-center justify-center overflow-auto rounded border border-border bg-black/[.02] p-4">
          {!ready && <p className="text-sm text-muted">Loading image…</p>}
          <canvas ref={canvasElRef} className={ready ? "" : "hidden"} />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={saving || !ready}>
            {saving ? "Saving…" : "Save annotation"}
          </Button>
        </div>
      </div>
    </Dialog>
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
