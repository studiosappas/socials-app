"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as fabric from "fabric";
import { Button } from "@/components/ui/button";
import { captureVideoFrameAsDataUrl } from "@/lib/video-poster";
import { useCustomFonts } from "@/lib/use-custom-fonts";
import {
  NEUTRAL_ADJUSTMENTS,
  applyAdjustments,
  readAdjustments,
  type AdjustmentValues,
} from "@/lib/image-adjustments";
import type { CustomFontFace } from "@/lib/data/brand-moodboard";

const INK = "#171412"; // matches --foreground
const MAX_DISPLAY = 640;
const CROP_MIN_ZOOM = 1;
const CROP_MAX_ZOOM = 4;
// The crop overlay is now always mounted (see its own render-site comment)
// even before cropSourceUrl exists -- a real, valid src is still required,
// and an empty string one triggers a React/browser warning about
// potentially refetching the whole page. A 1x1 transparent gif is a
// harmless placeholder that's never actually visible (the overlay is
// display:none until cropSourceUrl is set).
const EMPTY_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
// Minimum export pixel width for every targetAspect-locked frame (cover
// 1080x1350, carousel slide 1080x1440) -- the height follows from
// targetAspect itself, so only the width needs to be a shared constant.
// handleSave scales this up further when the source's native resolution
// at the current crop is larger, so this is a floor, not the actual
// output size.
const TARGET_EXPORT_W = 1080;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Accepts "#fff"/"fff"/"#ffffff"/"ffffff" (3- or 6-digit, with or without
// the leading #) and returns a normalized "#rrggbb", or null if the input
// isn't a valid hex color at all -- lets ColorPicker revert an invalid
// pasted/typed value instead of passing garbage to Fabric.
function normalizeHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[0]}${trimmed[0]}${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`.toLowerCase();
  }
  return null;
}

const BRUSH_WIDTHS: { label: string; value: number }[] = [
  { label: "Thin", value: 2 },
  { label: "Medium", value: 5 },
  { label: "Thick", value: 10 },
];
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

// Compact list -- label + slider + reset, per control, matching a Canva-
// style adjustments panel rather than a full Photoshop-style one. Hue is
// rendered separately below (own -180..180 range and gradient track).
const ADJUSTMENT_CONTROLS: { key: Exclude<keyof AdjustmentValues, "hue">; label: string; min: number; max: number }[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "exposure", label: "Exposure", min: -100, max: 100 },
  { key: "warmth", label: "Warmth", min: -100, max: 100 },
];
// A simple color-spectrum track for the Hue slider -- passes through every
// named direction the spec calls for (Yellow, Orange, Red, Pink, Purple,
// Blue, Cyan, Green) in order, wrapping back to Yellow.
const HUE_GRADIENT_CSS =
  "linear-gradient(to right, #e6b800, #e6821e, #e0483c, #e0459c, #9b59d0, #4a7fe0, #29b6c8, #4caf6b, #e6b800)";

type Tool = "select" | "draw" | "text" | "arrow" | "crop";

// The base photo lives as a regular (tagged, non-selectable) object in the
// canvas's own object stack rather than the special canvas.backgroundImage
// slot, specifically so other objects can be sent BEHIND it via Arrange, not
// just reordered in front of it. `appRole` marks which object that is; it
// only survives the toObject()/toJSON() round trip (and therefore
// reopening a saved annotation) because it's registered as a custom
// property here -- see fabric's own FabricObject.customProperties.
const BASE_PHOTO_ROLE = "basePhoto";
fabric.FabricObject.customProperties = ["appRole"];
// touchCornerSize is Fabric's own (already-existing, already-larger-than-
// cornerSize) invisible hit-area for the resize/rotate corner handles --
// confirmed live that FabricObject.ownDefaults IS the same object every
// interactive subclass (IText, FabricImage, etc.) reads its defaults from,
// so this one assignment reaches every object type. Left at Fabric's
// default (24) it's still meaningfully smaller than a comfortable finger
// target; bumped up here without touching cornerSize (13, unchanged) so
// the handles themselves stay visually identical -- only the invisible
// region a touch needs to land in to grab one gets bigger.
fabric.FabricObject.ownDefaults.touchCornerSize = 44;
// touchCornerSize (above) only widens the invisible hit-area for the
// resize/rotate CORNER controls -- grabbing an object anywhere on its own
// BODY to drag/move it is a completely separate hit-test
// (_pointIsInObjectSelectionArea in fabric's own SelectableCanvas, which
// expands the object's coords outward by exactly `padding` on every side
// before checking whether a pointer landed inside). Left at fabric's
// default of 0, a short/small text object (the common case here -- a
// single line at a modest font size) has a genuinely tiny drag target:
// only the tight pixel box around the glyphs themselves counts as "on the
// object," well under a finger's actual contact area, so a real touch
// drag started a few pixels off (very easy on a phone) grabs nothing and
// silently does nothing instead of moving the object -- this is what made
// text "not practically movable" specifically on touch, independent of
// the corner-control fix above. Same ownDefaults object every interactive
// subclass reads from, so this one assignment covers every object type.
fabric.FabricObject.ownDefaults.padding = 20;

type TaggableObject = fabric.FabricObject & { appRole?: string };
function tagAsBasePhoto(obj: fabric.FabricObject) {
  (obj as TaggableObject).appRole = BASE_PHOTO_ROLE;
}
// Adjustments (Brightness/Contrast/etc.) always target the base photo
// specifically, never whatever's currently selected -- the base photo is
// deliberately selectable:false (see tagAsBasePhoto's own comment above), so
// it can never be what selectedImage points at.
function findBasePhoto(canvas: fabric.Canvas): fabric.FabricImage | null {
  const obj = canvas.getObjects().find((o) => (o as TaggableObject).appRole === BASE_PHOTO_ROLE);
  return obj instanceof fabric.FabricImage ? obj : null;
}

// Fabric's cropX/cropY/width/height are just a WINDOW into the base photo's
// underlying element (getElement()) -- the element itself stays the full,
// un-cropped source no matter what's currently visible. This crops AND
// rotates/flips the currently-visible region in ONE canvas pass, returning
// the result as a data URL -- rotateBasePhoto/flipBasePhoto use it so
// rotating after cropping rotates the cropped result, not a version from
// before the crop.
//
// Originally two separate functions (flatten the visible crop to a PNG
// data URL, then load THAT back into an <img> and rotate it into a SECOND
// PNG data URL) -- each full-resolution PNG round-trip allocates its own
// uncompressed canvas buffer and base64 string, and on a real phone with a
// large (multi-megapixel, this app now genuinely produces native-
// resolution originals) source image, doing that twice per rotation was a
// plausible memory/performance cliff a small desktop-test image would
// never hit. Combining into one pass halves the peak memory and the
// number of async image-decode round trips (which also halves the window
// for a second rapid tap to race against the first -- see the `rotating`
// guard on the buttons below). JPEG instead of PNG for the same reason:
// smaller buffers/strings at a real phone's memory budget, negligible
// quality cost at 0.97 -- the app's own final Save already re-encodes to
// JPEG at 0.92 regardless (see handleSave), so this isn't introducing a
// new category of loss, just an earlier one at a much higher quality.
function getRotatedCropDataUrl(
  basePhoto: fabric.FabricImage,
  transform: { rotation: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean },
): string {
  const el = basePhoto.getElement() as HTMLImageElement;
  const cropX = basePhoto.cropX ?? 0;
  const cropY = basePhoto.cropY ?? 0;
  const cropW = basePhoto.width || el.naturalWidth || 1;
  const cropH = basePhoto.height || el.naturalHeight || 1;
  const swapped = transform.rotation === 90 || transform.rotation === 270;
  const outW = swapped ? cropH : cropW;
  const outH = swapped ? cropW : cropH;
  const off = document.createElement("canvas");
  off.width = outW || 1;
  off.height = outH || 1;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  ctx.drawImage(el, cropX, cropY, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
  return off.toDataURL("image/jpeg", 0.97);
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
  mediaType,
  targetAspect,
  onClose,
  onSaved,
  saveAction,
  customFonts = [],
}: {
  projectId: string;
  attachmentId: string | null;
  open: boolean;
  // For mediaType "video", this is the raw video's own URL, never something
  // fed directly into fabric.FabricImage.fromURL (which can't decode
  // video) -- see loadUrl below, which is what the canvas actually loads.
  imageUrl: string | null;
  initialAnnotationJson: object | null;
  // Undefined/omitted (Brief attachments, which are always images) behaves
  // exactly like "image" -- only "video" changes anything here.
  mediaType?: "image" | "video";
  // When set, the canvas frame is locked to this ratio (e.g. {w:4,h:5} for
  // a post's cover, {w:3,h:4} for every other carousel slide) instead of
  // the source image's own natural aspect ratio -- the image is fit via
  // "cover" (overflow cropped, same as CSS object-fit:cover) into that
  // fixed frame, so whatever the user crops to is already exactly the
  // shape the export pipeline expects, with no secondary auto-crop needed
  // at export time. Omitted preserves today's exact behavior (Brief's own
  // usage, and any other unconstrained case) -- canvas sized from the
  // image's own ratio.
  targetAspect?: { w: number; h: number };
  onClose: () => void;
  onSaved: (previewUrl: string) => void;
  // Brief attachments and post/Grid media assets are saved through
  // different tables (brief_attachments vs media_assets) behind an
  // identical (projectId, id, formData) => {previewUrl|message} shape, so
  // the editor itself stays agnostic to which one it's editing.
  saveAction: AnnotationSaveAction;
  // This project's uploaded Brand Moodboard fonts (see
  // lib/data/brand-moodboard.ts's deriveCustomFontFaces) -- merged into the
  // font picker below, alongside the built-in generic stacks.
  customFonts?: CustomFontFace[];
}) {
  const isVideo = mediaType === "video";
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const exportScaleRef = useRef(1);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);
  // Fabric v7's canvas.dispose() is asynchronous (tears down its own DOM
  // wrapper/upper-canvas over a promise, not synchronously) -- the main
  // load effect's construction awaits whatever this is holding before
  // building a new Canvas, so a fast second edit (e.g. re-picking a video
  // cover) never constructs on top of a still-in-flight disposal. See that
  // effect for the crash this prevents.
  const disposePromiseRef = useRef<Promise<boolean> | null>(null);
  // The explicit "editor idle" contract: Rotate and Crop Apply are the two
  // operations that asynchronously mutate the AUTHORITATIVE canvas state
  // (basePhoto's element/crop/scale) -- both read something (a fresh
  // Image load, a fetched FabricImage) that takes real, unbounded time,
  // then write the result back. Neither previously checked, after that
  // await, whether the canvas they were about to mutate was still the
  // live one -- if the user rotated or applied a crop and then quickly
  // moved on (another edit, Save, or closing the editor) before that
  // await resolved, the eventual completion still called
  // basePhoto.setElement()/canvas.loadFromJSON()/canvas.requestRenderAll()
  // regardless, sometimes against a canvas mid-disposal (Fabric's own
  // dispose() had already deleted its internal DOM-manager state) --
  // "Cannot read properties of undefined (reading 'clearRect')" and
  // friends, reproducible only under a fast combined sequence, never in
  // an isolated single-tool test. This ref is a serialized queue both
  // operations register into (trackPendingEdit below); Save awaits it
  // before snapshotting, and the disposal cleanup effect awaits it before
  // actually calling canvas.dispose() -- so persistence and teardown both
  // wait for in-flight editor mutations to genuinely settle first,
  // structurally, rather than by guessing at a delay.
  const pendingEditRef = useRef<Promise<void>>(Promise.resolve());
  // See handleAdjustmentInput below -- coalesces rapid slider ticks so the
  // expensive full-resolution filter pass runs at most once per animation
  // frame instead of once per native 'input' event (which fires far more
  // often than the screen can even repaint during a fast drag).
  const pendingAdjustmentsRef = useRef<AdjustmentValues | null>(null);
  const adjustmentRafRef = useRef<number | null>(null);

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
  // Distinguishes "this text object is selected, show move/resize/rotate
  // handles" from "the caret is live, I'm typing" -- the two states the
  // text toolbar needs to look and behave differently for (see the
  // text:editing:entered/exited listeners below). Fabric's own default way
  // to reach editing is a double-click/double-tap, which is exactly the
  // kind of gesture that's unreliable on a touch device (needs two taps
  // inside a short, easy-to-miss time window, and competes with the
  // browser's own tap-zoom/selection heuristics) -- the "Edit Text"/"Done"
  // buttons below (driven by this state) give an explicit, always-hittable
  // way to cross that boundary instead of relying on it.
  const [textEditing, setTextEditing] = useState(false);
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
  // Custom brand fonts load asynchronously (FontFace().load()) -- familyNames
  // feeds the merged font picker below, readyVersion drives the repaint
  // effect further down that corrects any text painted before its font
  // finished loading.
  const { familyNames: customFontFamilies, readyVersion: customFontsReady } = useCustomFonts(customFonts);
  const fontOptions = useMemo(
    () => [...FONT_OPTIONS, ...customFontFamilies.map((f) => ({ label: f, value: f }))],
    [customFontFamilies],
  );
  // Repaints once a custom font finishes loading -- a text object using that
  // family may have already painted (in a fallback font, since Canvas2D
  // doesn't wait for a font it doesn't know about) before this landed. Not
  // gated on `ready` below since a font can finish loading well after the
  // canvas itself is already up and interactive.
  useEffect(() => {
    fabricRef.current?.requestRenderAll();
  }, [customFontsReady]);
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
  // handleApplyCrop previously had no error handling or in-flight feedback
  // at all -- a failed fetch/loadFromJSON was an uncaught rejection, and
  // there was no way to tell "still applying" from "silently did nothing."
  const [applyingCrop, setApplyingCrop] = useState(false);
  const [cropError, setCropError] = useState<string | undefined>();
  // The base photo's CURRENT full source (getElement().src), captured fresh
  // every time the crop tool opens -- must match whatever handleApplyCrop
  // itself crops from, or the live drag-to-position preview shows the wrong
  // (e.g. pre-rotation) orientation while the actual apply step crops the
  // right one, positioning the crop window against a mismatched preview.
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  // Independent of `tool` -- Adjustments is a toggleable panel, not a canvas
  // interaction mode, so it can stay open alongside Select/Draw/etc. Synced
  // FROM the base photo's actual filters (not just reset to neutral) inside
  // finish()/handleUndo/handleRedo below, so it always reflects what's
  // really on the canvas, including on reopen or after undoing past an edit.
  const [adjustPanelOpen, setAdjustPanelOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<AdjustmentValues>(NEUTRAL_ADJUSTMENTS);
  const [rotatePanelOpen, setRotatePanelOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | undefined>();
  // `rotating` state only reflects in props on the NEXT render, so a second
  // rapid tap fired before that render (very plausible on a touch device --
  // exactly the class of bug a fast, non-latent desktop test would never
  // reproduce) could still slip past a disabled-button check alone and race
  // a second applyBaseTransform call against the first, each reading/writing
  // basePhoto at different points. This ref is set/cleared synchronously
  // around the async work so a second call can bail out immediately,
  // regardless of render timing.
  const rotatingRef = useRef(false);
  // Same synchronous-mutex reasoning as rotatingRef, for handleApplyCrop --
  // which previously had NO such guard at all. A rapid double-tap on
  // "Apply crop" (or any other trigger firing it twice back to back)
  // could start a second async apply while the first was still awaiting
  // its own fetch/loadFromJSON, each independently reading/mutating the
  // same basePhoto.
  const applyingCropRef = useRef(false);

  // For video: a JPEG data URL of whatever frame the user picked (or, when
  // reopening an already-edited video, one captured silently for canvas-
  // sizing purposes -- see the effect below). Everything downstream (the
  // main load effect, crop) treats this exactly like a normal image URL
  // once set -- fabric.FabricImage.fromURL can decode a data URL fine, it
  // just can't decode the raw video file this was captured from.
  const [pickedFrameUrl, setPickedFrameUrl] = useState<string | null>(null);
  // Forces the canvas (and its wrapper, see the render below) to remount
  // fresh every time a new editing session starts, instead of keying on
  // loadUrl's own content -- two different picked video frames can capture
  // byte-identical data URLs (e.g. a static/solid-color moment in the
  // source video), which would leave loadUrl unchanged and silently defeat
  // a content-based key, never forcing the remount Fabric's DOM ownership
  // needs on a second edit session.
  const [canvasNonce, setCanvasNonce] = useState(0);
  // True whenever the INTERACTIVE scrub-and-pick UI should be shown to the
  // user -- a fresh video with no saved annotation yet, or after "Choose a
  // Different Frame". Deliberately NOT the same thing as "no loadUrl yet":
  // reopening an existing annotation also starts with no loadUrl (see the
  // silent-capture effect below) but must NOT show this, only a bare
  // loading state -- see loadUrl's render usage further down for why.
  const [forcePicker, setForcePicker] = useState(false);
  // True only while pickedFrameUrl came from the SILENT reopen-capture
  // below (restoring a previously-saved annotation), never from an
  // explicit user pick (fresh video, or after "Choose a Different Frame").
  // The main load effect uses this -- not the raw initialAnnotationJson
  // prop -- to decide whether to loadFromJSON: the prop stays truthy for
  // the rest of THIS dialog session even after the user re-picks a brand
  // new frame (editingImage never gets reset until the dialog actually
  // closes), so branching on the prop directly restored the OLD saved
  // Fabric objects (referencing the OLD frame's data URL as their photo's
  // src) onto a canvas sized for the NEWLY picked frame -- a real, wrong
  // state that was also the actual trigger for an intermittent Fabric/
  // React DOM crash on a second pick, not just a cosmetic mismatch.
  const [isRestoringSaved, setIsRestoringSaved] = useState(false);
  const loadUrl = isVideo ? pickedFrameUrl : imageUrl;
  const shouldRestoreAnnotation = isVideo ? isRestoringSaved : Boolean(initialAnnotationJson);

  // Briefly forces the whole editor to unmount (return null, same as
  // `!open`) around every picker<->editor transition. Editing two DIFFERENT
  // image assets back to back (a genuine dialog close + reopen each time,
  // `open` cycling false->true for real) never crashes; toggling between
  // picker and editor purely via internal state while `open` stays true the
  // entire time is what produced an intermittent Fabric/React DOM conflict
  // ("insertBefore: node is not a child of this node") -- this makes every
  // such transition go through a real unmount/remount too, the same way a
  // normal close+reopen already safely does.
  const [internallyClosed, setInternallyClosed] = useState(false);
  function transitionWithRemount(applyChange: () => void) {
    setInternallyClosed(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyChange();
        setInternallyClosed(false);
      });
    });
  }

  // Resets picker state at the start of each editing session (opening the
  // dialog, or switching which asset it's editing) -- without this, closing
  // and reopening on a DIFFERENT video would reuse the previous video's
  // picked frame for a beat before the effects below caught up.
  //
  // This used to be a useEffect keyed on [open, attachmentId] that called
  // setCanvasNonce -- which meant the nonce bump (and therefore the
  // `key={canvasNonce}` remount below) landed in a SEPARATE, LATER commit
  // than the one that first rendered `open: true`. The main load effect
  // below reruns in that earlier commit too (it also depends on `open`),
  // so on a fast close-one-asset/open-a-different-one sequence it could
  // already be constructing a new fabric.Canvas on the not-yet-remounted
  // node before the nonce-bump commit swapped that node out from under it
  // -- an intermittent "insertBefore: node is not a child of this node"
  // crash. Computing the bump here, during render, is React's documented
  // pattern for "reset state when a prop changes" -- it lands in the SAME
  // commit as the rest of this render, so the remount and the load
  // effect's teardown/construct cycle stay in lock-step.
  const [session, setSession] = useState<{ active: boolean; attachmentId: string | null }>({
    active: false,
    attachmentId: null,
  });
  if (open && (!session.active || session.attachmentId !== attachmentId)) {
    setSession({ active: true, attachmentId });
    setPickedFrameUrl(null);
    setForcePicker(isVideo && !initialAnnotationJson);
    setIsRestoringSaved(false);
    setCanvasNonce((n) => n + 1);
  } else if (!open && session.active) {
    // Bookkeeping only (no picker/canvas resets) -- marks the session as
    // over so a later reopen of the SAME attachmentId is still detected as
    // a fresh session (attachmentId alone wouldn't have changed).
    setSession({ active: false, attachmentId: null });
  }

  // Reopening a video that already has a saved annotation skips the picker
  // (same as images: the saved state is what shows, not a fresh pick) --
  // but the main load effect below still needs *some* image URL to compute
  // the canvas's frame size from (loadFromJSON never restores canvas
  // width/height, see the comment on that effect), and the raw video file
  // itself can't serve that role. This silently captures one frame purely
  // for that sizing purpose; loadFromJSON immediately overwrites its actual
  // pixel content, so which frame it happens to be doesn't matter. While
  // this is in flight, loadUrl is still null and the render below shows a
  // bare loading state instead of mounting the canvas -- see there for why.
  useEffect(() => {
    if (!open || !isVideo || !imageUrl || !initialAnnotationJson) return;
    if (pickedFrameUrl || forcePicker) return;
    let cancelled = false;
    captureVideoFrameAsDataUrl(imageUrl, 0.1).then((dataUrl) => {
      if (!cancelled && dataUrl) {
        setIsRestoringSaved(true);
        setPickedFrameUrl(dataUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, isVideo, imageUrl, initialAnnotationJson, pickedFrameUrl, forcePicker]);

  function handleChooseDifferentFrame() {
    if (!confirm("Pick a new cover frame? This discards your current edits on this cover.")) return;
    transitionWithRemount(() => {
      setPickedFrameUrl(null);
      setForcePicker(true);
    });
  }


  useEffect(() => {
    if (!open || !loadUrl || !canvasElRef.current) return;
    // A separately-bound const (not the outer loadUrl prop-derived value)
    // so TS's narrowing to non-null carries into setupCanvas below, which
    // closes over it from a nested function declaration.
    const url = loadUrl;
    // See shouldRestoreAnnotation's own comment -- null here (even though
    // the initialAnnotationJson PROP is still truthy) means "treat this as
    // a fresh edit," which is exactly the case right after re-picking a
    // frame via "Choose a Different Frame."
    const restoreAnnotation = shouldRestoreAnnotation ? initialAnnotationJson : null;

    let disposed = false;
    let canvas: fabric.Canvas | null = null;

    (async () => {
      // Wait for any previous instance's (async, see disposePromiseRef's
      // own comment) disposal to actually finish before building a new one
      // -- constructing while the old one is still tearing down its DOM
      // wrapper is what caused an intermittent "insertBefore: node is not
      // a child of this node" crash when quickly picking a second cover
      // frame ("Choose a Different Frame" -> pick -> pick again).
      if (disposePromiseRef.current) {
        await disposePromiseRef.current;
      }
      if (disposed || !canvasElRef.current) return;

      canvas = new fabric.Canvas(canvasElRef.current, {
        backgroundColor: "#ffffff",
        selection: true,
      });
      fabricRef.current = canvas;
      setReady(false);
      setTool("select");
      setCropping(false);
      setCropSourceUrl(null);
      // These reference objects that belong to the PREVIOUS canvas instance
      // (disposed above/about to be) -- left stale, they kept the
      // selection-dependent toolbar rows (Align/Arrange, Remove Background,
      // text styling) rendered against a canvas that no longer has anything
      // selected on a second edit session (e.g. after "Choose a Different
      // Frame"), shifting the DOM layout React expects around the very
      // canvas-container div Fabric owns.
      setSelectedText(null);
      setSelectedImage(null);
      setSelectedObject(null);
      setTextEditing(false);
      setAdjustPanelOpen(false);
      setRotatePanelOpen(false);

      setupCanvas(canvas);
    })();

    function setupCanvas(canvas: fabric.Canvas) {
    fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" }).then((img) => {
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

      // With a targetAspect, the frame is locked to that ratio (both
      // supported ratios -- 4:5 cover, 3:4 slide -- are portrait, so height
      // is always the binding dimension against maxDisplay) instead of the
      // source image's own shape. exportScaleRef here is only a FLOOR of
      // TARGET_EXPORT_W (1080) -- handleSave re-reads the base photo's
      // then-current scale and exports at whichever is larger, that or the
      // crop's actual native resolution, so a large source no longer gets
      // silently downgraded to 1080xN.
      const canvasW = targetAspect ? maxDisplay * (targetAspect.w / targetAspect.h) : naturalW * displayScale;
      const canvasH = targetAspect ? maxDisplay : naturalH * displayScale;
      exportScaleRef.current = targetAspect
        ? TARGET_EXPORT_W / canvasW
        : displayScale > 0
          ? 1 / displayScale
          : 1;

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
      canvas.setDimensions({ width: canvasW, height: canvasH });

      function finish() {
        historyRef.current = [JSON.stringify(canvas.toJSON())];
        historyIndexRef.current = 0;
        const basePhoto = findBasePhoto(canvas);
        setAdjustments(basePhoto ? readAdjustments(basePhoto) : NEUTRAL_ADJUSTMENTS);
        setReady(true);
      }

      if (restoreAnnotation) {
        // For IMAGES, the saved JSON's base-photo object still carries
        // whatever `src` it had at save time -- a Supabase SIGNED url,
        // which expires after SIGNED_URL_TTL_SECONDS (1 hour, see
        // media.ts). Reopening an annotation any time after that shows
        // every other object (text, shapes -- all self-contained) but a
        // blank gap where the photo should be, since the browser is now
        // fetching a dead url baked into the JSON instead of the fresh,
        // currently-valid one this effect was just handed as `url`/
        // `loadUrl`. The underlying file hasn't changed -- only the
        // signature/expiry has -- so swapping just the src field (same
        // pattern handleApplyCrop already uses) is safe: every position/
        // crop/scale value stays exactly as saved.
        //
        // For VIDEO this must NOT run: the saved src there is a
        // self-contained data URL of the exact picked+annotated cover
        // frame (never expires, no network fetch), while `url` at this
        // point is a DIFFERENT frame silently captured only to size the
        // canvas (see the effect above) -- patching src here would swap
        // the correct saved cover for a random unrelated frame.
        //
        // Same "self-contained, never expires" reasoning excludes a rotated/
        // flipped base photo here too -- rotateBasePhoto/flipBasePhoto
        // (below) flatten the transform into a data URL via setElement(),
        // same technique Remove Background already uses, so a data: src
        // is never a stale signed URL to refresh; overwriting it with the
        // ORIGINAL un-rotated `url` would silently discard the rotation on
        // every reopen.
        let patched = restoreAnnotation;
        if (!isVideo) {
          const clone = JSON.parse(JSON.stringify(restoreAnnotation)) as {
            objects?: Record<string, unknown>[];
            backgroundImage?: Record<string, unknown>;
            [k: string]: unknown;
          };
          const basePhoto = clone.objects?.find((o) => o.appRole === BASE_PHOTO_ROLE);
          if (basePhoto && typeof basePhoto.src === "string" && !basePhoto.src.startsWith("data:")) {
            basePhoto.src = url;
          }
          // Legacy shape (pre-migration, see the backgroundImage handling
          // right below) stored the photo under its own top-level key
          // instead of in `objects` -- needs the same src refresh.
          if (
            clone.backgroundImage &&
            typeof clone.backgroundImage.src === "string" &&
            !clone.backgroundImage.src.startsWith("data:")
          ) {
            clone.backgroundImage.src = url;
          }
          patched = clone;
        }

        // Reload the exact saved state -- objects, background crop, everything --
        // so annotations remain fully editable across sessions, not just baked pixels.
        canvas.loadFromJSON(patched).then(() => {
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
        // targetAspect fits the image via "cover" (like CSS object-fit:
        // cover) -- scaled up until it fills the fixed frame on both axes,
        // overflow on one axis cropped by the canvas boundary, centered.
        // Without targetAspect the frame IS the image's own scaled size
        // (set above), so plain top-left placement already fills it exactly
        // with no cropping -- the original, unconstrained behavior.
        const imgScale = targetAspect ? Math.max(canvasW / naturalW, canvasH / naturalH) : displayScale;
        img.scale(imgScale);
        if (targetAspect) {
          img.set({ left: (canvasW - naturalW * imgScale) / 2, top: (canvasH - naturalH * imgScale) / 2 });
        }
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
      setTextEditing(false);
    });
    // See textEditing's own comment -- these fire regardless of whether
    // editing was entered via the "Edit Text" button, a real double-click/
    // double-tap, or activateTool's "Add Text" branch, so all three paths
    // stay in sync with the same two-state toolbar.
    canvas.on("text:editing:entered", () => setTextEditing(true));
    canvas.on("text:editing:exited", () => setTextEditing(false));
    }

    return () => {
      disposed = true;
      // Nulled IMMEDIATELY/synchronously, before the canvas is actually
      // disposed below -- this is the signal applyBaseTransform/
      // handleApplyCrop check (fabricRef.current !== canvas) to bail out
      // of a still-in-flight operation as early as possible, rather than
      // only once the (potentially delayed, see below) actual teardown
      // happens.
      fabricRef.current = null;
      if (adjustmentRafRef.current !== null) {
        cancelAnimationFrame(adjustmentRafRef.current);
        adjustmentRafRef.current = null;
      }
      pendingAdjustmentsRef.current = null;
      if (canvas) {
        const canvasToDispose = canvas;
        // See pendingEditRef's own declaration -- actually tearing the
        // canvas down (which deletes Fabric's internal DOM-manager state)
        // is deferred until any Rotate/Crop Apply still in flight against
        // THIS canvas has settled. pendingEditRef never rejects (see
        // trackPendingEdit), so no .catch needed. Combined with the
        // fabricRef.current nulling above (which makes that in-flight
        // operation bail out on its own the moment it next checks), this
        // guarantees dispose() never runs while that operation is
        // mid-mutation, and -- since the NEXT open's construction effect
        // itself awaits disposePromiseRef before building a new canvas --
        // that no old async work can ever reach a newly-constructed
        // canvas either.
        disposePromiseRef.current = pendingEditRef.current.then(() => canvasToDispose.dispose());
      }
    };
    // canvasNonce is a real dependency, not just a React key: the "reset
    // picker state" effect above bumps it on every open (for every media
    // type, not just video), which remounts <canvas> to a brand new DOM
    // node via its key. Without canvasNonce here, this effect can run once
    // against the ORIGINAL canvas node before that remount happens (both
    // effects fire in the same initial commit), attach Fabric and call
    // setDimensions() on a node that's about to be discarded, then never
    // run again -- leaving the node actually shown on screen a plain,
    // un-sized, Fabric-less <canvas> stuck at the browser's 300x150
    // default while `ready` (a separate, node-independent state variable)
    // still flips true and shows the toolbar over it. Depending on
    // canvasNonce forces this effect to rerun (disposing the stale
    // instance via disposePromiseRef, then constructing fresh) against
    // whichever canvas node is actually live.
  }, [open, loadUrl, initialAnnotationJson, shouldRestoreAnnotation, canvasNonce]);

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

  // Measures the crop frame ONLY after the crop-mode layout (the Apply/
  // Cancel button row above the canvas, which activateTool's own
  // state-batch also triggers) has actually painted -- a plain
  // getBoundingClientRect() inside activateTool itself reads the canvas's
  // box from BEFORE that row exists, which is taller than the canvas's
  // real box once it does, silently sizing/positioning the crop overlay
  // against a stale frame. Double rAF (not a single one, and not just
  // this effect's own commit) because the button row's own layout only
  // settles on the frame AFTER this render commits -- one rAF can still
  // land before the browser has actually laid out and painted that new
  // row, especially on a slower mobile device.
  useEffect(() => {
    if (!cropping) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const rect = canvasElRef.current?.getBoundingClientRect();
        setCropFrameSize(rect ? { width: rect.width, height: rect.height } : null);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [cropping]);

  function withCanvas(fn: (canvas: fabric.Canvas) => void) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    fn(canvas);
  }

  // See pendingEditRef's own declaration for why this exists. Chains `run`
  // after whatever edit was already pending (so two overlapping
  // authoritative-state mutations serialize instead of racing each other),
  // and leaves pendingEditRef holding an always-resolving tracker promise
  // (never rejecting) so a failed edit doesn't permanently wedge every
  // future Save/disposal into waiting on an already-rejected promise --
  // the ORIGINAL caller still observes whatever `run` actually
  // resolves/rejects with, via the returned promise, which is `run`'s own
  // promise, not the tracker.
  function trackPendingEdit<T>(run: () => Promise<T>): Promise<T> {
    const started = pendingEditRef.current.then(run, run);
    pendingEditRef.current = started.then(
      () => undefined,
      () => undefined,
    );
    return started;
  }

  function activateTool(next: Tool) {
    // Rotate and Crop Apply both asynchronously read/replace the base
    // photo's element (a fetch/decode that takes real, unbounded time) --
    // switching to ANY other tool while one is still in flight, most
    // concretely entering Crop, would capture/act on a basePhoto that's
    // about to change out from under it the moment that operation
    // completes (e.g. Crop's own cropSourceUrl snapshot going stale the
    // instant a still-pending Rotate finishes and calls setElement()).
    // Both buttons already disable themselves while their OWN operation is
    // running (rotating/applyingCrop); refusing every OTHER tool switch
    // here too closes off the cross-tool version of the same race
    // structurally, rather than only guarding the one case (Crop) known to
    // read basePhoto on entry -- correct regardless of what a future tool
    // might also read from it.
    if (rotatingRef.current || applyingCropRef.current) return;
    withCanvas((canvas) => {
      // Rotate/Flip (applyBaseTransform) resets the base photo's element
      // AND its crop window (cropX/Y reset to 0, width/height to the new
      // full size -- see applyBaseTransform) -- entirely disjoint from
      // whatever cropSourceUrl/cropZoom/cropOffset the crop overlay is
      // mid-gesture with, or from the base photo any other tool is about
      // to act on. Nothing previously stopped the Rotate panel from
      // staying open (or being opened) while another tool was also active,
      // so a rotate fired mid-crop-gesture left the crop overlay showing
      // a stale image at a stale zoom/pan while Apply would have read the
      // ALREADY-rotated element underneath it -- a real "what I see isn't
      // what gets applied" case, not just visual clutter. Closing it here
      // makes Rotate and every other tool mutually exclusive, same as
      // Crop/Draw/Text/Arrow already are via `tool`.
      setRotatePanelOpen(false);
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
        // Selects the placeholder "Text" the instant editing starts, so
        // the first character typed (mobile keyboard or otherwise)
        // replaces it outright instead of the user having to manually
        // select-all or backspace it away first.
        text.selectAll();
        canvas.requestRenderAll();
        setTool("select");
        canvas.isDrawingMode = false;
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
        // cropFrameSize itself is measured in the effect below, not here --
        // this fires inside the same state batch that flips `cropping` to
        // true, which is what makes the Apply/Cancel button row appear
        // above the canvas. React hasn't painted that layout change yet at
        // this point, so a getBoundingClientRect() read here would capture
        // the canvas's PRE-crop-mode box -- taller than its actual size
        // once the button row has taken its own space -- and the crop
        // overlay would then be sized/positioned against a stale frame.
        setCropZoom(1);
        setCropOffset({ x: 0, y: 0 });
        const basePhoto = findBasePhoto(canvas);
        setCropSourceUrl(basePhoto ? (basePhoto.getElement() as HTMLImageElement).src : null);
      }
    });
  }

  // The Rotate sidebar button used to just toggle rotatePanelOpen directly
  // -- see activateTool's own comment on why that let Rotate stay open (or
  // be opened) alongside an in-progress Crop gesture. Routes through
  // activateTool("select") first so opening Rotate always cleanly exits
  // whatever else was active (discarding any uncommitted crop pan/zoom,
  // same as tapping "Cancel crop" would). Reads the CURRENT rotatePanelOpen
  // before that reset (which itself closes it) rather than chaining a
  // functional update after -- two setRotatePanelOpen calls in the same
  // batch would otherwise compose against each other, not against the
  // pre-click value, turning "close" into "close then immediately reopen."
  function toggleRotatePanel() {
    const opening = !rotatePanelOpen;
    activateTool("select");
    if (opening) setRotatePanelOpen(true);
  }

  // Rotate/mirror the base photo itself -- never whatever's selected (text/
  // arrows/logos aren't touched, same "always the base photo" reasoning as
  // Adjustments above). Only reachable when targetAspect is set (Post/Grid's
  // fixed-frame covers) -- see the sidebar button below; without a fixed
  // frame the CANVAS itself would need to resize to the newly-rotated
  // image's own orientation, a materially bigger change than this.
  //
  // Always transforms getRotatedCropDataUrl's flattened output -- exactly
  // what's currently on screen, crop included -- not the pristine original.
  // Rotating now bakes the current crop into the new full underlying
  // element (cropX/Y reset to 0, width/height become the new full size),
  // which is also why handleApplyCrop below reads its source from
  // basePhoto.getElement() rather than the original url: that element IS
  // already the correctly-rotated, correctly-cropped-so-far image.
  async function applyBaseTransform(rotation: 0 | 90 | 180 | 270, flipX: boolean, flipY: boolean) {
    const canvas = fabricRef.current;
    const basePhoto = canvas ? findBasePhoto(canvas) : null;
    if (!canvas || !basePhoto || !targetAspect) return;
    // See rotatingRef's declaration -- bails out synchronously on a rapid
    // second tap instead of racing a second setElement() against this one.
    if (rotatingRef.current) return;

    rotatingRef.current = true;
    setRotating(true);
    setRotateError(undefined);
    // See pendingEditRef's own declaration -- registers this operation so
    // Save and disposal both know a mutation is in flight and wait for it,
    // instead of racing its eventual completion.
    await trackPendingEdit(async () => {
      try {
        const transformedUrl = getRotatedCropDataUrl(basePhoto, { rotation, flipX, flipY });
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new window.Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("Couldn't load the rotated image."));
          el.src = transformedUrl;
        });

        // The await above can take arbitrarily long (decoding a large
        // native-resolution frame). If the canvas this operation started
        // against has since been disposed/replaced (the user closed the
        // editor, or another open/reopen cycle already swapped in a fresh
        // instance), fabricRef.current no longer points at THIS canvas --
        // bail out instead of mutating/rendering a torn-down or stale
        // instance, which is exactly what produced Fabric-internal crashes
        // ("Cannot read properties of undefined (reading 'clearRect')")
        // under a fast combined sequence.
        if (fabricRef.current !== canvas) return;

        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        const frameW = canvas.getWidth();
        const frameH = canvas.getHeight();
        // Same cover-fit formula as the initial load (targetAspect branch) --
        // naturalW/H already reflect the swapped dimensions for a 90/270
        // rotation, so this re-centers/re-covers correctly with no separate
        // "swapped" case to handle.
        const imgScale = Math.max(frameW / naturalW, frameH / naturalH);

        basePhoto.setElement(img);
        basePhoto.set({
          scaleX: imgScale,
          scaleY: imgScale,
          left: (frameW - naturalW * imgScale) / 2,
          top: (frameH - naturalH * imgScale) / 2,
          cropX: 0,
          cropY: 0,
          width: naturalW,
          height: naturalH,
        });
        basePhoto.setCoords();
        canvas.requestRenderAll();
        canvas.fire("object:modified", { target: basePhoto });
        setCropZoom(1);
        setCropOffset({ x: 0, y: 0 });
      } catch (error) {
        // Previously uncaught -- any failure here (a CORS-tainted canvas
        // throwing SecurityError on toDataURL, same real failure mode already
        // handled in handleSave; a decode error; anything else) was silently
        // swallowed, so on a real device this looked exactly like "I tap
        // Rotate and nothing happens" with zero feedback.
        console.error("Failed to rotate/flip image:", error);
        // Also stale-guarded: don't surface an error banner for an
        // operation whose canvas has already been torn down/replaced --
        // there's no dialog left for it to mean anything to.
        if (fabricRef.current === canvas) {
          setRotateError(
            error instanceof DOMException && error.name === "SecurityError"
              ? "Couldn't rotate -- this image failed to load securely."
              : "Couldn't rotate the image. Try again.",
          );
        }
      } finally {
        rotatingRef.current = false;
        setRotating(false);
      }
    });
  }

  function rotateBasePhoto(deltaDegrees: 90 | -90) {
    void applyBaseTransform(deltaDegrees === 90 ? 90 : 270, false, false);
  }

  function flipBasePhoto(axis: "horizontal" | "vertical") {
    void applyBaseTransform(0, axis === "horizontal", axis === "vertical");
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
  async function handleApplyCrop() {
    const canvas = fabricRef.current;
    const basePhoto = canvas ? findBasePhoto(canvas) : null;
    if (!canvas || !basePhoto || !cropFrameSize) return;
    // See applyingCropRef's own declaration -- bails out synchronously on a
    // rapid double-tap instead of racing a second fetch/loadFromJSON
    // against this one.
    if (applyingCropRef.current) return;

    applyingCropRef.current = true;
    setApplyingCrop(true);
    setCropError(undefined);
    // See pendingEditRef's own declaration -- registers this operation so
    // Save and disposal both know a mutation is in flight and wait for it,
    // instead of racing its eventual completion.
    await trackPendingEdit(async () => {
      try {
        // frameW/frameH (Fabric's INTERNAL canvas resolution, i.e. canvas
        // units) are only used below for the final PLACEMENT onto the canvas
        // -- scaleX/scaleY/left/top -- since that's the coordinate space Fabric
        // actually renders in, independent of how big the canvas is drawn on
        // screen.
        const frameW = canvas.getWidth();
        const frameH = canvas.getHeight();

        // basePhoto.getElement() is always the current FULL underlying source
        // -- cropX/Y/width/height are just Fabric's window into it, never the
        // element itself -- so this already correctly reflects any prior
        // rotate/flip (rotateBasePhoto/flipBasePhoto bake those directly into
        // this same element) without needing to separately track/reapply a
        // transform here.
        const sourceUrl = (basePhoto.getElement() as HTMLImageElement).src;

        const freshImg = await fabric.FabricImage.fromURL(sourceUrl, { crossOrigin: "anonymous" });
        // The await above (a network fetch/decode) can take arbitrarily
        // long. If the canvas this operation started against has since
        // been disposed/replaced (editor closed, or a fresh open/reopen
        // cycle already swapped in a new instance), fabricRef.current no
        // longer points at THIS canvas -- bail out instead of mutating a
        // torn-down or stale instance. Same reasoning/failure mode as
        // applyBaseTransform's identical guard.
        if (fabricRef.current !== canvas) return;
        const naturalW = freshImg.width ?? frameW;
        const naturalH = freshImg.height ?? frameH;
        // THE ACTUAL BUG this fixes: the crop overlay the user drags/pinches is
        // sized and CSS-`object-cover`-fit against cropFrameSize -- the
        // canvas element's live CSS DISPLAY box (measured via
        // getBoundingClientRect() when crop mode opens). That box is NOT
        // guaranteed to equal canvas.getWidth()/getHeight() (Fabric's internal
        // resolution) -- entering crop mode adds the Apply/Cancel button row
        // above the canvas, which can shrink the canvas's available CSS height
        // below its own intrinsic resolution on a real, viewport-constrained
        // phone (this never reproduces on a spacious desktop test, or even a
        // roomy mobile-emulated one). Computing "cover scale" from
        // frameW/frameH here -- a DIFFERENT box than the one the overlay
        // visually panned/zoomed against -- silently cropped a different
        // window than what was shown, which is exactly the "Apply jumps to a
        // different framing" bug. Using cropFrameSize here instead is the
        // SAME number that already determines the overlay's own rendered
        // size/scale (see its JSX below), so by construction there is no
        // second, possibly-diverging "frame size" for this math to disagree
        // with -- whatever box the user saw is exactly the box this crops
        // against.
        const coverScale = Math.max(cropFrameSize.width / naturalW, cropFrameSize.height / naturalH);
        const cropW = clamp(cropFrameSize.width / (coverScale * cropZoom), 0, naturalW);
        const cropH = clamp(cropFrameSize.height / (coverScale * cropZoom), 0, naturalH);
        // offset is a fraction of the FRAME (matching Grid's own drag-delta
        // convention), which is the same as a fraction of the crop window's
        // own natural size -- both are scaled by the same factor to fill the
        // frame, so a "one frame-width" drag is exactly "one crop-window-
        // width" in natural pixels, regardless of zoom.
        //
        // THE ACTUAL "Apply doesn't match the preview" BUG: this used to ADD
        // cropOffset here, but the overlay's own gesture and the crop window
        // it's supposed to describe move in OPPOSITE directions. The overlay
        // pans by moving the IMAGE via `transform: translate(offset%, ...)` --
        // dragging right increases offset.x, which slides the image content
        // right on screen. But sliding the image right under a FIXED frame
        // reveals content from further toward the image's LEFT (smaller
        // natural-x), the same as sliding a photo right under a fixed peephole
        // -- so the crop window's left edge should DECREASE as offset.x
        // increases, not increase. Adding cropOffset here did the opposite:
        // every pan moved the crop window the wrong way, and every pinch-zoom
        // (which re-centers around the current offset, see
        // AnnotationCropOverlay's pinch handler) compounded that same wrong-
        // direction shift. Confirmed empirically -- extracting the source
        // image at the ADDED-offset coordinates the old formula computed
        // produced a visibly different, more-zoomed-out framing than what the
        // overlay showed; extracting it at these SUBTRACTED-offset coordinates
        // instead matches the overlay's preview.
        const cropX = clamp((naturalW - cropW) / 2 - cropOffset.x * cropW, 0, naturalW - cropW);
        const cropY = clamp((naturalH - cropH) / 2 - cropOffset.y * cropH, 0, naturalH - cropH);

        // The base photo is a regular (tagged) entry in json.objects now, not
        // the special json.backgroundImage key -- see BASE_PHOTO_ROLE.
        const json = canvas.toJSON() as { objects?: Record<string, unknown>[]; [k: string]: unknown };
        const objects = json.objects ?? [];
        const photoIndex = objects.findIndex((o) => o.appRole === BASE_PHOTO_ROLE);
        const updatedPhoto = {
          ...(photoIndex >= 0 ? objects[photoIndex] : {}),
          appRole: BASE_PHOTO_ROLE,
          src: sourceUrl,
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
        await canvas.loadFromJSON(json);
        // Second async boundary -- re-check for the same reason as above.
        // loadFromJSON reconstructs every object (including re-fetching the
        // base photo's own image), which can take real time on a large
        // native-resolution source; the canvas could have been torn down
        // during THIS await too, independent of the first check.
        if (fabricRef.current !== canvas) return;
        canvas.requestRenderAll();
        setCropping(false);
        setTool("select");
      } catch (error) {
        // Previously completely unhandled -- a failed fetch or a
        // loadFromJSON rejection was an uncaught promise rejection, so
        // tapping "Apply crop" and having it silently do nothing (no
        // error, crop mode just stayed open) was indistinguishable from
        // the tap not having registered at all.
        console.error("Failed to apply crop:", error);
        if (fabricRef.current === canvas) {
          setCropError(
            error instanceof DOMException && error.name === "SecurityError"
              ? "Couldn't crop -- this image failed to load securely."
              : "Couldn't apply the crop. Try again.",
          );
        }
      } finally {
        applyingCropRef.current = false;
        setApplyingCrop(false);
      }
    });
  }

  // Same class of bug as Rotate/Crop Apply had: loadFromJSON is
  // asynchronous (re-fetches/reconstructs every object, including the base
  // photo's own image), and this previously had neither a same-operation
  // mutex (a rapid double-tap on Undo could start a second restore before
  // the first's loadFromJSON resolved, each independently mutating the
  // canvas and racing to finish last) nor a staleness check (its .then()
  // ran unconditionally, regardless of whether the canvas it captured was
  // still the live one by the time it fired). historyOperationRef +
  // trackPendingEdit + the fabricRef.current check give it the identical
  // protection.
  const historyOperationRef = useRef(false);

  function handleUndo() {
    withCanvas((canvas) => {
      if (historyIndexRef.current <= 0 || historyOperationRef.current) return;
      historyIndexRef.current -= 1;
      const json = JSON.parse(historyRef.current[historyIndexRef.current]);
      historyOperationRef.current = true;
      restoringRef.current = true;
      void trackPendingEdit(async () => {
        try {
          await canvas.loadFromJSON(json);
          if (fabricRef.current !== canvas) return;
          canvas.requestRenderAll();
          const basePhoto = findBasePhoto(canvas);
          setAdjustments(basePhoto ? readAdjustments(basePhoto) : NEUTRAL_ADJUSTMENTS);
        } finally {
          restoringRef.current = false;
          historyOperationRef.current = false;
        }
      });
    });
  }

  function handleRedo() {
    withCanvas((canvas) => {
      if (historyIndexRef.current >= historyRef.current.length - 1 || historyOperationRef.current) return;
      historyIndexRef.current += 1;
      const json = JSON.parse(historyRef.current[historyIndexRef.current]);
      historyOperationRef.current = true;
      restoringRef.current = true;
      void trackPendingEdit(async () => {
        try {
          await canvas.loadFromJSON(json);
          if (fabricRef.current !== canvas) return;
          canvas.requestRenderAll();
          const basePhoto = findBasePhoto(canvas);
          setAdjustments(basePhoto ? readAdjustments(basePhoto) : NEUTRAL_ADJUSTMENTS);
        } finally {
          restoringRef.current = false;
          historyOperationRef.current = false;
        }
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

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't hijack normal text editing -- a DOM input/textarea focused
        // elsewhere in this editor (e.g. the hex color field), or an IText
        // object the user is actively typing into (Fabric's own isEditing
        // flag), both need their normal character-delete behavior.
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        const active = fabricRef.current?.getActiveObject();
        if (!active || ("isEditing" in active && (active as fabric.IText).isEditing)) return;
        e.preventDefault();
        handleDeleteSelected();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

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
    // Same class of bug as Rotate/Crop Apply/Undo/Redo: this awaits an
    // image decode (real, unbounded time) then mutates the canvas
    // afterward -- registers into pendingEditRef so Save/disposal wait for
    // it too, and re-checks fabricRef.current afterward so it can't touch
    // a canvas that's since been disposed or replaced.
    await trackPendingEdit(async () => {
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
        if (fabricRef.current !== canvas) return;

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

  // Explicit entry into the "typing" state for an already-placed text
  // object -- see textEditing's own comment for why this exists instead of
  // relying on Fabric's default double-click/double-tap. Cursor lands at
  // the end (not select-all -- that's specifically for the fresh "Text"
  // placeholder in activateTool's "Add Text" branch) so re-editing existing
  // custom content doesn't wipe it out the instant the keyboard opens.
  function handleEditTextContent() {
    withCanvas((canvas) => {
      const active = canvas.getActiveObject();
      if (!(active instanceof fabric.IText)) return;
      active.enterEditing();
      const end = active.text.length;
      active.setSelectionStart(end);
      active.setSelectionEnd(end);
      canvas.requestRenderAll();
    });
  }

  // Explicit exit back to the "move/resize/rotate" state -- the object
  // stays selected (exitEditing doesn't deselect it), just with its normal
  // transform handles active again instead of a live caret.
  function handleFinishTextEditing() {
    withCanvas((canvas) => {
      const active = canvas.getActiveObject();
      if (!(active instanceof fabric.IText) || !active.isEditing) return;
      active.exitEditing();
      canvas.requestRenderAll();
    });
  }

  // Actually runs the (expensive -- full native-resolution, multi-filter,
  // pure-JS Canvas2D pixel pass, see applyAdjustments/image-adjustments.ts)
  // filter application, at most once per animation frame -- see
  // handleAdjustmentInput below for why this is split out.
  function flushPendingAdjustments() {
    adjustmentRafRef.current = null;
    const next = pendingAdjustmentsRef.current;
    if (!next) return;
    pendingAdjustmentsRef.current = null;
    withCanvas((canvas) => {
      const basePhoto = findBasePhoto(canvas);
      if (basePhoto) {
        applyAdjustments(basePhoto, next);
        canvas.requestRenderAll();
      }
    });
  }

  // Live preview only -- does NOT push undo history (a slider drag can fire
  // this dozens of times), see commitAdjustments below for that.
  //
  // A native range input fires its 'input' event on every pixel of finger
  // movement -- far more often than Fabric's filter pass can actually keep
  // up with on a real phone (readAdjustments/applyFilters reprocesses the
  // FULL native-resolution source through every active filter, in pure JS,
  // on every single call -- see image-adjustments.ts). Calling that
  // synchronously per tick queued up a growing backlog the main thread
  // fell further behind on with every additional tick, which is what
  // "adjustment changes have noticeable latency" actually was: not one
  // slow render, but an ever-growing pile of stale-by-the-time-they-ran
  // ones -- and, since that backlog occupies the main thread, it's also
  // very likely why "Save Changes" appeared unresponsive immediately after
  // using Adjust (its tap handler couldn't even run until the backlog
  // drained). Only ever keeping the LATEST pending value and flushing at
  // most once per rAF means a fast drag naturally sheds intermediate
  // frames instead of queuing them -- the exact same
  // full-resolution/full-quality computation, just never allowed to pile
  // up. React state (`adjustments`) still updates on every tick so the
  // slider/number label track the finger exactly; only the expensive
  // canvas-side work is throttled.
  function handleAdjustmentInput(key: keyof AdjustmentValues, value: number) {
    setAdjustments((prev) => {
      const next = { ...prev, [key]: value };
      pendingAdjustmentsRef.current = next;
      if (adjustmentRafRef.current === null) {
        adjustmentRafRef.current = requestAnimationFrame(flushPendingAdjustments);
      }
      return next;
    });
  }

  // Fires "object:modified" (the same event a completed drag/resize fires)
  // once a slider is released -- that's what the history stack listens on,
  // so one undo step covers the whole gesture instead of every tick.
  function commitAdjustments() {
    // A release can land between rAF ticks with a pending value still
    // queued -- flush it synchronously first so the committed/undo-stack
    // state is always the exact final value, never a stale in-between frame.
    if (adjustmentRafRef.current !== null) {
      cancelAnimationFrame(adjustmentRafRef.current);
      adjustmentRafRef.current = null;
    }
    flushPendingAdjustments();
    withCanvas((canvas) => {
      const basePhoto = findBasePhoto(canvas);
      if (basePhoto) canvas.fire("object:modified", { target: basePhoto });
    });
  }

  function handleResetAdjustment(key: keyof AdjustmentValues) {
    handleAdjustmentInput(key, 0);
    commitAdjustments();
  }

  function handleResetAllAdjustments() {
    setAdjustments(NEUTRAL_ADJUSTMENTS);
    withCanvas((canvas) => {
      const basePhoto = findBasePhoto(canvas);
      if (basePhoto) {
        applyAdjustments(basePhoto, NEUTRAL_ADJUSTMENTS);
        canvas.requestRenderAll();
      }
    });
    commitAdjustments();
  }

  async function handleSave() {
    const canvas = fabricRef.current;
    if (!canvas || !attachmentId) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      // Establishes "the editor is idle" before snapshotting -- see
      // pendingEditRef's own declaration. An Adjust slider release already
      // flushes synchronously (commitAdjustments), but a release that
      // hasn't fired yet (or a drag still in progress) leaves a value
      // queued for the next animation frame rather than applied yet;
      // cancel-then-flush here too (same pair commitAdjustments itself
      // uses) means Save never captures a canvas that's one rAF behind the
      // sliders' displayed values, and never runs that same pending frame
      // a second time redundantly after this manual flush already did it.
      // Rotate/Crop Apply are asynchronous (a fetch/decode that can take
      // real time on a large source) and register themselves into
      // pendingEditRef -- if either is still in flight, awaiting it here
      // means Save always snapshots the SETTLED result of the user's most
      // recent edit, never a canvas mid-mutation.
      if (adjustmentRafRef.current !== null) {
        cancelAnimationFrame(adjustmentRafRef.current);
        adjustmentRafRef.current = null;
      }
      flushPendingAdjustments();
      await pendingEditRef.current;
      // The wait above can take a while on a slow rotate/crop. If the
      // editor closed (or reopened into a fresh instance) during that
      // wait, fabricRef.current no longer points at THIS canvas -- there's
      // no dialog left for a save result to mean anything to, so stop
      // rather than snapshot/export a canvas that's no longer live.
      if (fabricRef.current !== canvas) return;
      const annotationJson = JSON.stringify(canvas.toJSON());
      // For a targetAspect-locked frame, exportScaleRef.current is a FIXED
      // TARGET_EXPORT_W/canvasW ratio (see setupCanvas) -- it always produces
      // exactly TARGET_EXPORT_W regardless of the source's real resolution,
      // which silently saved every cropped cover/attachment at ~1080px even
      // when the original was much larger. basePhoto.scaleX is how many
      // canvas-units currently map to 1 native source pixel for the CURRENT
      // crop/zoom (see handleApplyCrop: scaleX = frameW / cropW), so its
      // reciprocal is exactly the multiplier that renders this same frame at
      // the crop's native resolution -- same idea as the non-cropping
      // branch's `1 / displayScale` below, just re-read at save time instead
      // of frozen at load time, since crop/zoom can change after that. Only
      // ever scales UP from the existing multiplier (never below it), so an
      // already-small source still exports at exactly what it did before.
      const basePhoto = findBasePhoto(canvas);
      const nativeMultiplier =
        targetAspect && basePhoto && basePhoto.scaleX
          ? Math.max(exportScaleRef.current, 1 / basePhoto.scaleX)
          : exportScaleRef.current;
      // canvas.toBlob() (Fabric's own, not a native <canvas> method -- it
      // still builds the same full-resolution temp canvas internally, see
      // toCanvasElement) goes straight to a real Blob via the browser's
      // native, off-main-thread-friendly HTMLCanvasElement.toBlob(). The
      // previous toDataURL()+fetch() pattern built a base64 STRING (~33%
      // larger than the raw bytes) of the full-resolution export, held it
      // entirely in memory, then had fetch() parse that whole string back
      // into a second, separate binary buffer to produce the Blob --
      // meaning peak memory during Save was roughly double what the actual
      // export needed, exactly during the highest-memory-pressure moment
      // (a full native-resolution multi-megapixel JPEG). On a memory-
      // constrained real phone that's a plausible reason Save could stall
      // or fail outright with no error a modest desktop test would ever
      // trigger.
      const blob = await canvas.toBlob({
        format: "jpeg",
        quality: 0.92,
        multiplier: nativeMultiplier,
      });
      if (!blob) {
        throw new Error("Couldn't render the edited image.");
      }
      const formData = new FormData();
      formData.set("file", new File([blob], "annotated-preview.jpg", { type: "image/jpeg" }));
      formData.set("annotation_json", annotationJson);
      // A dropped mobile connection mid-upload (common on cellular, rare on
      // a desktop test's wifi/wired connection) can leave the underlying
      // fetch simply never settling -- neither resolving nor rejecting --
      // which previously meant "Saving…" stayed on screen forever with no
      // way out and no feedback, indistinguishable from the button having
      // done nothing at all. 60s is generous enough not to false-trigger on
      // a genuinely slow-but-working upload of a large native-resolution
      // export over a weak connection, while still giving up eventually
      // instead of hanging indefinitely.
      const result = await Promise.race([
        saveAction(projectId, attachmentId, formData),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 60_000),
        ),
      ]);
      if (result.previewUrl) {
        onSaved(result.previewUrl);
      } else {
        // Previously silent -- a failed save (e.g. a pending migration
        // meaning the target column doesn't exist yet) looked identical to
        // a successful one from the user's side: the dialog just stayed
        // open with no feedback at all.
        setSaveError(result.message ?? "Couldn't save changes.");
      }
    } catch (error) {
      // canvas.toDataURL() throws a SecurityError (silently, with no
      // network request ever sent) if any object on the canvas is a
      // cross-origin image whose source didn't actually send permissive
      // CORS headers -- previously uncaught here, so the whole save
      // silently no-opped: the dialog stayed open looking like nothing was
      // wrong, but nothing was ever sent to saveAction, and reopening later
      // showed the pre-edit state because there was never anything new to
      // load. Surfacing it here doesn't fix a bad source, but at least
      // makes the failure visible instead of indistinguishable from success.
      console.error("Failed to save annotation:", error);
      setSaveError(
        error instanceof DOMException && error.name === "SecurityError"
          ? "Couldn't save -- an image on this canvas failed to load securely. Try re-adding it and save again."
          : error instanceof Error && error.message === "TIMEOUT"
            ? "Couldn't save -- the connection timed out. Check your connection and try again."
            : "Couldn't save changes. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open || internallyClosed) return null;

  return (
    // Keyed on canvasNonce -- the most reliable fix found for an
    // intermittent Fabric/React DOM conflict ("insertBefore: node is not a
    // child of this node") that kept recurring on a second pick/edit
    // session no matter how narrowly the remount boundary around just the
    // canvas was scoped. Forcing the ENTIRE modal subtree fresh on every
    // new canvas session eliminates any possibility of React trying to
    // reconcile into DOM Fabric has touched, anywhere in this tree.
    <div key={canvasNonce} className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-end px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase transition-colors duration-150 hover:text-muted"
        >
          Close <span aria-hidden>✕</span>
        </button>
      </div>

      {isVideo && forcePicker ? (
        <VideoFramePicker
          videoUrl={imageUrl}
          onPick={(dataUrl) => {
            transitionWithRemount(() => {
              setPickedFrameUrl(dataUrl);
              setForcePicker(false);
              // Always a fresh edit, never a restore -- even when re-picking
              // after "Choose a Different Frame" on a video that already had
              // a saved annotation (isRestoringSaved's own comment).
              setIsRestoringSaved(false);
              setCanvasNonce((n) => n + 1);
            });
          }}
        />
      ) : isVideo && !loadUrl ? (
        // Reopening an existing annotation: the silent background capture
        // above hasn't resolved yet. Deliberately NOT mounting the canvas
        // here at all (not just hiding it) -- Fabric takes ownership of
        // that DOM node the instant its own effect runs, and having a
        // plain, Fabric-untouched <canvas> sit in the tree in the meantime
        // is what raced against a later re-render and crashed with
        // "insertBefore: node is not a child of this node" (same class of
        // Fabric-vs-React DOM conflict as the upper-canvas/guide-lines
        // issues documented elsewhere in this file).
        <div className="flex flex-1 items-center justify-center px-6 py-2">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      ) : (
        <>
      {/* flex-col (mobile) vs sm:flex-row (unchanged desktop) -- this is
          the actual fix for "Adjust covers the image." Adjust used to be
          a direct sibling of the sidebar+center block below, both laid
          out in a single ALWAYS-horizontal row -- on a real phone that
          meant a ~176px fixed-width side column permanently eating into
          the ~300px or so left for everything else (left icon rail
          included), squeezing the canvas down to a sliver rather than
          actually reserving its own space. Below sm:, this wrapper
          stacks its two children instead: the sidebar+center block (its
          own always-horizontal row, unchanged) on top, Adjust as a
          full-width panel below it -- see Adjust's own block further
          down for the rest of this. At sm: and up this reverts to a
          row, reproducing today's exact side-by-side desktop layout. */}
      <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
      <div className="flex flex-1 overflow-hidden">
      {/* LEFT: every tool-switching button in one minimal vertical rail
          (icon + short label) -- replaces what used to be a horizontal row
          above the canvas plus a second grid-cols-5 row below it, both of
          which ate into the canvas's available height. Contextual option
          rows (draw brush picker, align/arrange, text styling, crop
          apply/cancel) stay as compact horizontal bars in the center
          column below -- they're per-tool option pickers, not tool
          switches, so they don't belong in this rail. */}
      <div className="flex w-16 shrink-0 flex-col items-stretch gap-0.5 overflow-y-auto border-r border-border px-1.5 py-3">
        <SidebarToolButton active={tool === "select"} onClick={() => activateTool("select")} label="Select">
          <SelectIcon />
        </SidebarToolButton>
        <SidebarToolButton active={tool === "crop"} onClick={() => activateTool("crop")} label="Crop" title="Crop Image">
          <CropIcon />
        </SidebarToolButton>
        <SidebarToolButton active={tool === "draw"} onClick={() => activateTool("draw")} label="Draw">
          <DrawIcon />
        </SidebarToolButton>
        <SidebarToolButton active={false} onClick={() => activateTool("text")} label="Text" title="Add Text">
          <TextIcon />
        </SidebarToolButton>
        <SidebarToolButton active={false} onClick={() => activateTool("arrow")} label="Arrow" title="Arrows">
          <ArrowIcon />
        </SidebarToolButton>
        <SidebarToolButton active={false} onClick={handleAddLogoClick} label="Logo" title="Add Logo">
          <LogoIcon />
        </SidebarToolButton>
        <span className="my-1 h-px w-full bg-border" />
        <SidebarToolButton
          active={adjustPanelOpen}
          onClick={() => setAdjustPanelOpen((v) => !v)}
          label="Adjust"
          title="Adjustments"
        >
          <AdjustIcon />
        </SidebarToolButton>
        {targetAspect && (
          <SidebarToolButton active={rotatePanelOpen} onClick={toggleRotatePanel} label="Rotate" title="Rotate / Flip Photo">
            <RotateIcon direction="right" />
          </SidebarToolButton>
        )}
        {isVideo && ready && (
          <SidebarToolButton
            active={false}
            onClick={handleChooseDifferentFrame}
            label="Frame"
            title="Select Cover Frame"
          >
            <FrameIcon />
          </SidebarToolButton>
        )}
        <span className="my-1 h-px w-full bg-border" />
        <SidebarToolButton active={false} onClick={handleUndo} label="Undo">
          <UndoIcon />
        </SidebarToolButton>
        <SidebarToolButton active={false} onClick={handleRedo} label="Redo">
          <RedoIcon />
        </SidebarToolButton>
        <SidebarToolButton active={false} onClick={handleDeleteSelected} label="Delete">
          <DeleteIcon />
        </SidebarToolButton>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
      {rotatePanelOpen && ready && targetAspect && (
        <div className="flex flex-col items-center gap-1 pb-2">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div className="flex items-center gap-1">
              <IconToolButton onClick={() => rotateBasePhoto(-90)} label="Rotate left" disabled={rotating}>
                <RotateIcon direction="left" />
              </IconToolButton>
              <IconToolButton onClick={() => rotateBasePhoto(90)} label="Rotate right" disabled={rotating}>
                <RotateIcon direction="right" />
              </IconToolButton>
              <IconToolButton
                onClick={() => flipBasePhoto("horizontal")}
                label="Flip horizontal"
                disabled={rotating}
              >
                <FlipIcon axis="horizontal" />
              </IconToolButton>
              <IconToolButton onClick={() => flipBasePhoto("vertical")} label="Flip vertical" disabled={rotating}>
                <FlipIcon axis="vertical" />
              </IconToolButton>
            </div>
            {rotating && <span className="text-xs text-muted">Rotating…</span>}
          </div>
          {rotateError && <p className="text-xs text-error">{rotateError}</p>}
        </div>
      )}
      {tool === "draw" && (
        <div className="flex flex-wrap items-center justify-center gap-3 pb-2">
          <ColorPicker value={brushColor} onChange={handleBrushColorChange} />
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
          {/* The explicit editing<->manipulation boundary -- see
              textEditing's own comment. Placed first/prominent so it reads
              as the primary action for a selected text object, not one
              option among the styling controls. */}
          {textEditing ? (
            <Button type="button" variant="primary" radius="full" onClick={handleFinishTextEditing}>
              Done editing
            </Button>
          ) : (
            <Button type="button" variant="secondary" radius="full" onClick={handleEditTextContent}>
              Edit text
            </Button>
          )}
          <ColorPicker value={textColor} onChange={handleTextColorChange} />
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
          <select
            value={textFont}
            onChange={(e) => handleTextFontChange(e.target.value)}
            className="rounded border border-border bg-transparent px-2 py-1 text-xs focus:border-foreground focus:outline-none"
          >
            {fontOptions.map((f) => (
              <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>
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
        <div className="flex flex-col items-center gap-1 pb-2">
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              radius="full"
              onClick={handleApplyCrop}
              disabled={applyingCrop}
            >
              {applyingCrop ? "Applying…" : "Apply crop"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              radius="full"
              onClick={() => activateTool("select")}
              disabled={applyingCrop}
            >
              Cancel crop
            </Button>
          </div>
          {cropError && <p className="text-xs text-error">{cropError}</p>}
        </div>
      )}

      <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-2">
        <div
          // Keyed on canvasNonce (not loadUrl -- two different picked video
          // frames can capture byte-identical data URLs, e.g. a static
          // moment in the source video, which would silently leave loadUrl
          // unchanged), same reasoning as the canvas's own key below but one
          // level up: Fabric wraps the <canvas> in its own internally-
          // created container div (a "canvas-container", invisible to
          // React's tracking) once it constructs -- so THIS div's actual DOM
          // children end up different from what React thinks they are the
          // moment Fabric runs. Re-keying only the canvas wasn't enough:
          // React could still try to insert one of the sibling overlays
          // below (loading text, crop overlay, guide lines) relative to the
          // canvas node as a reference point, which fails once Fabric has
          // re-parented it under its own wrapper -- "insertBefore: node is
          // not a child of this node". Keying this whole container instead
          // means React always discards and rebuilds the entire subtree
          // (Fabric's foreign DOM included) rather than ever trying to diff
          // into it.
          key={canvasNonce}
          className="relative flex max-h-full items-center justify-center border border-dashed border-border bg-black/[.015] p-2"
        >
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
          {
            // Both placeholders below are ALWAYS mounted (never
            // conditionally added/removed) -- visibility toggled via style
            // instead. Same "don't conditionally mount/unmount siblings of
            // the Fabric-touched canvas" principle as the canvas element's
            // own static className/style further down: React inserting or
            // removing an element here as `loadUrl`/`ready` change means it
            // has to figure out the correct position relative to the canvas
            // via sibling-relative DOM ops, and Fabric has restructured
            // that exact neighborhood (wrapped the canvas in its own
            // container, added an upper-canvas) outside React's
            // bookkeeping -- exactly the "insertBefore: node is not a
            // child of this node" crash this file already documents for
            // the canvas's own className. Toggling `display` on elements
            // that are ALWAYS present is a plain attribute update, never a
            // sibling-relative insert/remove.
          }
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/[.015]"
            style={{ display: loadUrl && !ready ? "flex" : "none" }}
          >
            <p className="text-sm text-muted">Loading image…</p>
          </div>
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{ display: loadUrl ? "none" : "flex" }}
          >
            <p className="p-24 text-2xl tracking-wide text-muted">IMAGE</p>
          </div>
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
            // Keyed on canvasNonce, same reasoning as the wrapper div above.
            // className/style here are STATIC (never toggled by `cropping`
            // or anything else) -- see the comment above this element about
            // why: Fabric clones this element's className into its own
            // internally-created "upper-canvas" once, at construction time,
            // not reactively. A `cropping`-conditional "invisible" class
            // used to live here, which correctly hid the React-owned
            // canvas but left Fabric's own upper-canvas (cloned from the
            // ORIGINAL, pre-toggle className) fully visible and, critically,
            // still receiving every pointer event in that screen region --
            // sitting on top of the crop overlay below and intercepting an
            // unpredictable subset of its drag/corner-handle touches. The
            // crop overlay's own opaque image (bg-background wrapper,
            // full-frame-coverage clipped copy) already visually replaces
            // what the canvas shows during crop, so hiding the canvas
            // itself was never actually necessary.
            ref={canvasElRef}
            style={{ maxWidth: "100%", maxHeight: "100%", height: "auto", touchAction: "none" }}
          />
          {
            // Always mounted (never a conditional `{cropping && ... && (...)}`
            // branch) -- same reasoning as the loading/IMAGE placeholders
            // above: this div is a sibling of the Fabric-controlled canvas
            // inside the canvasNonce-keyed container, and Fabric restructures
            // that neighborhood outside React's bookkeeping. Mounting/
            // unmounting this on every crop-mode enter/exit (`cropping`
            // flipping true<->false, e.g. right after Apply crop) hit the
            // exact same "insertBefore: node is not a child of this node" /
            // "Cannot read properties of undefined (reading 'clearRect')"
            // crash confirmed for the loading placeholder -- toggling
            // `display` on an always-present element sidesteps it instead.
            // cropSourceUrl/cropFrameSize can be null before crop mode has
            // ever been entered once; AnnotationCropOverlay tolerates an
            // empty imageUrl and a 0x0 frame fine since it's not visible.
          }
          <div
            // bg-background -- opaque, so this fully visually replaces
            // the (now always-visible) canvas underneath it; see the
            // canvas element's own comment above for why it's no longer
            // hidden via a className toggle.
            className="absolute z-10 bg-background"
            style={{
              display: cropping && cropSourceUrl && cropFrameSize ? "block" : "none",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: cropFrameSize?.width ?? 0,
              height: cropFrameSize?.height ?? 0,
            }}
          >
            <AnnotationCropOverlay
              imageUrl={cropSourceUrl ?? EMPTY_IMAGE_SRC}
              zoom={cropZoom}
              offset={cropOffset}
              onZoomChange={setCropZoom}
              onOffsetChange={setCropOffset}
            />
          </div>
          {/* Unconditionally mounted (not gated on guides.x/y like the lines
              inside it, and -- since the SAME crash this comment already
              describes turned out to apply to ITS OWN mount/unmount too,
              see below -- not gated on `cropping` either anymore) -- this
              div sits as a direct sibling of the Fabric-controlled
              <canvas>, and Fabric wraps that canvas in its own extra DOM
              (a "canvas-container" div + upper-canvas) that React never
              finds out about. Toggling THIS wrapper's own presence in/out
              of the tree on every mousemove during a drag (guides.x/y flip
              null<->set constantly while dragging) raced against Fabric's
              internal DOM writes and crashed with "Failed to execute
              'insertBefore' ... not a child of this node" -- severe enough
              to blank the whole app, not just this dialog. The original fix
              here only stopped toggling on guides.x/y and moved to
              toggling the two line elements INSIDE instead -- but the
              wrapper itself was still gated on `!cropping`, which flips at
              the exact same "crop mode just exited" moment already
              confirmed to trigger this same crash class elsewhere (see the
              crop overlay above) -- entering/exiting crop mode still
              mounted/unmounted this whole div. Same fix as there: always
              mounted, visibility toggled via style. canvasBox/
              canvasResolution can be null before the first image load
              settles; the guide lines inside are already independently
              gated on guides.x/y !== null and simply won't render meaningful
              positions while hidden regardless. */}
          <div
            className="pointer-events-none absolute"
            style={{
              display: !cropping && canvasBox && canvasResolution ? "block" : "none",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: canvasBox?.width ?? 0,
              height: canvasBox?.height ?? 0,
            }}
          >
            {guides.x !== null && canvasResolution && (
              <div
                className="absolute top-0 bottom-0 w-px bg-[#b25450]"
                style={{ left: `${(guides.x / canvasResolution.width) * 100}%` }}
              />
            )}
            {guides.y !== null && canvasResolution && (
              <div
                className="absolute left-0 right-0 h-px bg-[#b25450]"
                style={{ top: `${(guides.y / canvasResolution.height) * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>
      </div>
      </div>

      {adjustPanelOpen && ready && (
        // w-full + a capped height + its own scroll (mobile) vs the
        // original sm:w-60 fixed-width side column (unchanged desktop).
        // The canvas doesn't need any JS-driven resize to make room for
        // this -- it already renders via maxWidth/maxHeight:100% (see the
        // <canvas> element's own style above), so when this panel takes
        // its own real space in the now-column layout, the canvas's
        // flex-1 area simply shrinks and the canvas scales itself down to
        // match, same as it already does for any other viewport
        // constraint.
        //
        // max-h-[38vh] (Round 1) still left the image feeling squeezed on
        // a real phone -- dropped further to 26vh here, combined with
        // AdjustmentSlider's own single-row layout (was label-row-then-
        // slider-row) and a tighter gap-1 between rows, so the panel's
        // real footprint shrinks on BOTH axes at once instead of just
        // being clipped shorter with the same dense content still fighting
        // for space inside it. All 9 controls still reach via its own
        // vertical scroll -- explicitly acceptable per spec, the goal is
        // the image staying dominant, not fitting every slider unscrolled.
        // sm:max-h-none reverts to the unconstrained side-column height.
        <div className="flex w-full shrink-0 flex-col gap-1 overflow-y-auto border-t border-border px-3 py-2 max-h-[26vh] sm:w-60 sm:max-h-none sm:gap-3 sm:border-t-0 sm:border-l sm:px-4 sm:py-4">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs tracking-wide text-muted uppercase">Adjustments</span>
            <button
              type="button"
              onClick={handleResetAllAdjustments}
              className="text-xs tracking-wide text-muted uppercase hover:text-foreground"
            >
              Reset All
            </button>
          </div>
          {ADJUSTMENT_CONTROLS.map((control) => (
            <AdjustmentSlider
              key={control.key}
              label={control.label}
              value={adjustments[control.key]}
              min={control.min}
              max={control.max}
              onChange={(value) => handleAdjustmentInput(control.key, value)}
              onCommit={commitAdjustments}
              onReset={() => handleResetAdjustment(control.key)}
            />
          ))}
          <AdjustmentSlider
            label="Hue"
            value={adjustments.hue}
            min={-180}
            max={180}
            onChange={(value) => handleAdjustmentInput("hue", value)}
            onCommit={commitAdjustments}
            onReset={() => handleResetAdjustment("hue")}
            trackBackground={HUE_GRADIENT_CSS}
          />
        </div>
      )}
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleLogoFileChange}
      />
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
        </>
      )}
    </div>
  );
}

// Shown instead of the canvas/toolbar for a video with no picked cover
// frame yet -- scrub to any moment, capture it, and that frame flows into
// the exact same crop/text/arrows/draw pipeline a normal image would (see
// pickedFrameUrl/loadUrl above). Captures directly from this <video>
// element's current displayed frame rather than re-fetching the video a
// second time offscreen -- it's already loaded and already showing
// whatever the user just scrubbed to.
function VideoFramePicker({
  videoUrl,
  onPick,
}: {
  videoUrl: string | null;
  onPick: (dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handleSeek(value: number) {
    setCurrentTime(value);
    const video = videoRef.current;
    if (video) video.currentTime = value;
  }

  function handleUseFrame() {
    const video = videoRef.current;
    if (!video) return;
    setCapturing(true);
    setError(undefined);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onPick(canvas.toDataURL("image/jpeg", 0.92));
    } catch {
      // A tainted canvas (crossOrigin rejected by the storage host) throws
      // on drawImage rather than erroring earlier -- fail closed with a
      // message instead of a silently-broken button, since here (unlike the
      // background auto-heal capture) there's a user waiting on this click.
      setError("Couldn't capture this frame. Try scrubbing to a different moment.");
    } finally {
      setCapturing(false);
    }
  }

  if (!videoUrl) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-auto px-6 py-2">
      <p className="text-sm text-muted">Scrub to a moment, then use it as the cover.</p>
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        crossOrigin="anonymous"
        className="max-h-[55dvh] max-w-full border border-dashed border-border bg-black/[.015]"
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          setDuration(video.duration || 0);
          // Same starting point as the automatic poster capture -- a hair
          // past 0, since frame 0 of many encodes is a solid black/blank
          // frame -- the user can scrub anywhere from there.
          const start = Math.min(0.1, (video.duration || 1) / 2);
          video.currentTime = start;
          setCurrentTime(start);
        }}
        onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={currentTime}
        onChange={(e) => handleSeek(Number(e.target.value))}
        disabled={!duration}
        className="w-full max-w-md accent-foreground"
      />
      {error && <p className="text-xs text-error">{error}</p>}
      <Button
        type="button"
        variant="primary"
        radius="full"
        onClick={handleUseFrame}
        disabled={capturing || !duration}
        className="w-64"
      >
        {capturing ? "Capturing…" : "Use This Frame"}
      </Button>
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
  // Tracks every currently-down pointer on the pan/pinch image by id, not
  // just the most recent one. The original code kept a single shared
  // panRef -- fine for a mouse (exactly one pointer, ever) but on a real
  // touch device the natural gesture to zoom a crop frame is a two-finger
  // pinch, and a pinch starts as two SIMULTANEOUS pointerdowns on this same
  // <img>. With only one shared ref, the second finger's pointerdown
  // silently overwrote the first finger's start position, and both
  // fingers' subsequent moves fed the same single-pointer pan math --
  // producing exactly the erratic, "doesn't feel reliable" jumpiness a
  // fast isolated single-pointer test (mouse, or one synthetic touch)
  // would never surface. This also means pinch-to-zoom never actually
  // existed on touch at all -- the only way to zoom was dragging one of
  // the tiny corner handles (handleCornerPointerDown/Move/Up below, left
  // untouched here since it's the desktop-mouse path and already works).
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    mode: "pan" | "pinch";
    startOffset: { x: number; y: number };
    startZoom: number;
    startX: number;
    startY: number;
    startDist: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);
  // Desktop-mouse-only zoom path (drag a corner handle away from center) --
  // unrelated to activePointersRef/gestureRef above, left exactly as it was.
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
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size === 1) {
      gestureRef.current = {
        mode: "pan",
        startOffset: offset,
        startZoom: zoom,
        startX: e.clientX,
        startY: e.clientY,
        startDist: 0,
        startMidX: 0,
        startMidY: 0,
      };
    } else if (activePointersRef.current.size === 2) {
      const [p1, p2] = [...activePointersRef.current.values()];
      gestureRef.current = {
        mode: "pinch",
        startOffset: offset,
        startZoom: zoom,
        startX: 0,
        startY: 0,
        startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        startMidX: (p1.x + p2.x) / 2,
        startMidY: (p1.y + p2.y) / 2,
      };
    }
    // A third+ simultaneous pointer is tracked (so its later pointerup is
    // accounted for) but doesn't change the active gesture -- pinch stays
    // anchored to whichever two pointers started it.
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!activePointersRef.current.has(e.pointerId) || !containerRef.current || !gestureRef.current) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = containerRef.current.getBoundingClientRect();
    const gesture = gestureRef.current;

    if (gesture.mode === "pan" && activePointersRef.current.size === 1) {
      const dxFrac = (e.clientX - gesture.startX) / rect.width;
      const dyFrac = (e.clientY - gesture.startY) / rect.height;
      onOffsetChange(
        clampOffset({ x: gesture.startOffset.x + dxFrac, y: gesture.startOffset.y + dyFrac }, zoom),
      );
    } else if (gesture.mode === "pinch" && activePointersRef.current.size === 2) {
      const [p1, p2] = [...activePointersRef.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const ratio = gesture.startDist > 0 ? dist / gesture.startDist : 1;
      const nextZoom = clamp(gesture.startZoom * ratio, CROP_MIN_ZOOM, CROP_MAX_ZOOM);
      // Pans by the midpoint's own drift too, not just zooming in place --
      // matches how pinch-zoom behaves everywhere else on a phone (the
      // point between your fingers stays under your fingers).
      const dxFrac = (midX - gesture.startMidX) / rect.width;
      const dyFrac = (midY - gesture.startMidY) / rect.height;
      onZoomChange(nextZoom);
      onOffsetChange(
        clampOffset({ x: gesture.startOffset.x + dxFrac, y: gesture.startOffset.y + dyFrac }, nextZoom),
      );
    }
  }

  function handleImagePointerUp(e: React.PointerEvent<HTMLImageElement>) {
    if (activePointersRef.current.has(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Already released/gone (e.g. a pointercancel already fired) --
        // nothing left to release.
      }
    }
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size === 1) {
      // Lifting one finger out of a pinch drops straight back to a single-
      // finger pan, anchored fresh from the CURRENT (post-pinch) offset/
      // zoom and the still-down finger's last known position -- not the
      // pinch's original start -- so there's no jump/snap at the handoff.
      const [[, pt]] = activePointersRef.current;
      gestureRef.current = {
        mode: "pan",
        startOffset: offset,
        startZoom: zoom,
        startX: pt.x,
        startY: pt.y,
        startDist: 0,
        startMidX: 0,
        startMidY: 0,
      };
    } else if (activePointersRef.current.size === 0) {
      gestureRef.current = null;
    }
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
    if (handleDragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Already released/gone (e.g. a pointercancel already fired).
      }
    }
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
        onPointerCancel={handleImagePointerUp}
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
          onPointerCancel={handleImagePointerUp}
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
          onPointerCancel={handleCornerPointerUp}
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
  onPointerCancel,
}: {
  corner: "tl" | "tr" | "bl" | "br";
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isTop = corner.startsWith("t");
  const isLeft = corner.endsWith("l");
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
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

// A single vertical rail item: icon on top, a short label underneath --
// deliberately minimal (no borders/pills like the old horizontal toolbar
// buttons) so a column of ~10 of these doesn't read as noisy.
function SidebarToolButton({
  active,
  onClick,
  label,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title ?? label}
      className={`flex flex-col items-center gap-1 rounded px-1 py-2 text-[10px] tracking-wide uppercase transition-colors duration-150 ${
        active ? "bg-foreground text-background" : "text-foreground hover:bg-black/[.05]"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

// Single row -- label, slider, and value all inline -- rather than a label
// row stacked above the slider. Mobile Adjust was still hiding too much of
// the image behind the panel even after Round 1's height cap; the biggest
// lever left, short of shrinking type past legibility, was cutting each
// control's own footprint roughly in half by not giving the label/value
// their own dedicated row. Double-click-to-reset is a lightweight bonus
// alongside the panel's own "Reset All". onCommit fires only on release
// (mouse/touch up), not on every drag tick -- see commitAdjustments' own
// comment.
function AdjustmentSlider({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
  onReset,
  trackBackground,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  onReset: () => void;
  trackBackground?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 truncate tracking-wide text-muted uppercase" title={label}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onDoubleClick={onReset}
        title={`${label} (double-click to reset)`}
        className="min-w-0 flex-1 accent-foreground"
        style={
          trackBackground
            ? { background: trackBackground, WebkitAppearance: "none", appearance: "none", height: 6, borderRadius: 9999 }
            : undefined
        }
      />
      <span className="w-7 shrink-0 text-right tabular-nums text-muted">{value}</span>
    </label>
  );
}

function IconToolButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      // p-3.5 (was p-1.5) -- these 14px icons (Rotate/Flip/Align/Arrange)
      // had only a ~26px tap target, well under a comfortable finger
      // target; this brings it to ~42px without enlarging the icon itself,
      // same "grow the invisible hit area, not the visual size" approach
      // as FabricObject.ownDefaults.touchCornerSize above.
      className="flex items-center justify-center rounded p-3.5 text-foreground transition-colors duration-150 hover:bg-black/[.05] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// <input type="color"> is the browser's own full-RGB-spectrum picker --
// no custom color-wheel UI/dependency needed. Paired with a plain hex text
// input (same pairing Google Drive's own color picker uses) so a color code
// can be typed/pasted directly; only commits on blur/Enter, and reverts to
// the last valid value on an invalid entry instead of erroring.
function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hexInput, setHexInput] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setHexInput(value);
  }

  function commitHexInput() {
    const normalized = normalizeHex(hexInput);
    if (normalized) {
      onChange(normalized);
    } else {
      setHexInput(value);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Pick a color"
        className="h-6 w-6 cursor-pointer rounded-full border border-border bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0"
      />
      <input
        type="text"
        value={hexInput}
        onChange={(e) => setHexInput(e.target.value)}
        onBlur={commitHexInput}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="#000000"
        className="w-[4.5rem] rounded border border-border bg-transparent px-1.5 py-0.5 text-[11px] focus:border-foreground focus:outline-none"
      />
    </div>
  );
}

// Minimal "equalizer sliders" glyph -- three horizontal tracks with a handle
// at a different position on each, the standard shorthand for an
// adjustments/tuning panel (distinct enough from the plain-text toolbar
// buttons around it that the Adjust button reads as its own thing, not just
// another Select/Undo/Redo item).
function AdjustIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9" cy="3" r="1.6" fill="currentColor" />
      <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="5" cy="7" r="1.6" fill="currentColor" />
      <line x1="1" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="10.5" cy="11" r="1.6" fill="currentColor" />
    </svg>
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

// Curved arrow around a partial circle, arrowhead pointing the turn
// direction -- "left" mirrors "right" horizontally via scaleX.
function RotateIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: direction === "left" ? "scaleX(-1)" : undefined }}>
      <path
        d="M3 5.5A5 5 0 1 1 2.2 8.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M3.4 2.2L3 5.7L6.4 5.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Two facing triangles with a dashed mirror-line between them -- the
// standard flip-horizontal glyph, rotated 90deg for vertical via `axis`.
function FlipIcon({ axis }: { axis: "horizontal" | "vertical" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ transform: axis === "vertical" ? "rotate(90deg)" : undefined }}
    >
      <path d="M2 3L5.5 7L2 11Z" fill="currentColor" />
      <path d="M12 3L8.5 7L12 11Z" fill="currentColor" />
      <path d="M7 1.5V12.5" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6 1.6" strokeLinecap="round" />
    </svg>
  );
}

// Sidebar rail icons -- all 14x14, stroke-only currentColor glyphs, same
// minimal convention as AlignIcon/LayerIcon/AdjustIcon above.
function SelectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 1.5L11.5 6.5L7 7.5L5.5 12L2 1.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function CropIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M4 1V10H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 4H10V13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DrawIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 1.5L12.5 4.5L4.5 12.5L1 13L1.5 9.5L9.5 1.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M8 3L11 6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 2H12M7 2V12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 11.5L11.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 2.5H11.5V8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="4.5" cy="4.5" r="1.1" stroke="currentColor" strokeWidth="1" />
      <path d="M1.5 9L5 6L7.5 8L9.5 5.5L12.5 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 4H9.5C11.5 4 13 5.5 13 7.5C13 9.5 11.5 11 9.5 11H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 1.5L3 4L5.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M11 4H4.5C2.5 4 1 5.5 1 7.5C1 9.5 2.5 11 4.5 11H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8.5 1.5L11 4L8.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 3.5H11.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M5 3.5V2C5 1.5 5.4 1 6 1H8C8.6 1 9 1.5 9 2V3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 3.5L4 12C4 12.5 4.4 13 5 13H9C9.6 13 10 12.5 10 12L10.5 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1 5H13M1 9H13" stroke="currentColor" strokeWidth="1" />
      <path d="M4 2V5M10 2V5M4 9V12M10 9V12" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
