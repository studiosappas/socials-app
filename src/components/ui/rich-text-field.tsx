"use client";

import { useEffect, useRef, useState } from "react";
import { parseBriefBody, serializeBriefBody, type FormattedParagraph, type FormattedRun } from "@/lib/brief-rich-text";

// Minimal Bold/Italic text field for Brief's body/text boxes. Deliberately
// NOT a general rich-text editor -- no headings, lists, colors, alignment,
// links. There was no existing rich-text/contenteditable component or
// library anywhere in this repo to reuse (checked package.json and the
// whole src/ tree first), so this is a small, purpose-built contentEditable
// wrapper rather than a new heavy editor dependency, matching "keep this
// extremely minimal."
//
// Uses document.execCommand("bold"/"italic") to toggle formatting on the
// live browser selection. That API is old and formally "not recommended"
// in newer specs, but it's still implemented and stable in every browser
// this app targets, and hand-rolling Range-splitting logic to toggle
// overlapping/partial bold+italic spans correctly (including turning
// formatting back OFF on an already-formatted selection) is real,
// easy-to-get-subtly-wrong complexity that execCommand already handles
// correctly -- exactly the kind of thing worth NOT re-implementing for a
// two-button toolbar. styleWithCSS is forced off so the browser emits
// plain <b>/<i> tags instead of inline style="font-weight:bold", which is
// what serializeDomToModel below actually looks for.
//
// SAFETY: nothing here ever calls dangerouslySetInnerHTML with stored
// content. Initial content is built into real DOM nodes via
// document.createElement/textContent (never innerHTML from a stored
// string), and the model this serializes back into (brief-rich-text.ts) is
// rendered everywhere else via plain React children, which React always
// escapes. Pasted content is normalized to plain text (see handlePaste) --
// no incoming HTML, styles, or scripts from a paste can ever reach the DOM.
export function RichTextField({
  value,
  onSave,
  disabled,
  placeholder,
  onEditorRef,
}: {
  value: string;
  onSave: (serialized: string) => void;
  disabled?: boolean;
  placeholder?: string;
  // Hands the live contentEditable node up to the caller -- e.g. so
  // BrandWriterField (src/components/ai/brand-writer.tsx) can attach to
  // this exact field the same way it already attaches to a plain
  // input/textarea elsewhere, via the same useState+ref-callback pattern.
  onEditorRef?: (el: HTMLDivElement | null) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(() => parseBriefBody(value).every((p) => p.runs.every((r) => !r.text)));
  // Only ever (re)built from `value` on mount -- same "uncontrolled,
  // defaultValue-style" convention every other Brief field already uses
  // (see FrameRow's own label/body inputs). Re-running this on every
  // keystroke would fight the live DOM and destroy cursor position; a fresh
  // `value` from outside (e.g. after undo/redo's router.refresh()) is a
  // genuinely new mount of this row anyway, since Brief re-renders the
  // whole frame list from the server tasks prop.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = "";
    for (const paragraph of parseBriefBody(value)) {
      el.appendChild(buildParagraphElement(paragraph));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFocus() {
    setFocused(true);
    try {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand("defaultParagraphSeparator", false, "div");
    } catch {
      // Some environments (older WebViews) may not support these -- the
      // editor still works as a plain single-block field either way.
    }
  }

  function handleBlur() {
    setFocused(false);
    const el = editorRef.current;
    if (!el) return;
    const paragraphs = serializeDomToModel(el);
    setIsEmpty(paragraphs.every((p) => p.runs.every((r) => !r.text)));
    onSave(serializeBriefBody(paragraphs));
  }

  function handleInput() {
    const el = editorRef.current;
    if (el) setIsEmpty(el.textContent?.trim().length === 0);
  }

  // Pasted content is normalized to plain text ONLY -- no incoming
  // fonts/colors/headings/links/embedded HTML from an external site or
  // document ever enters the model. A user can still select the pasted
  // text afterward and apply Bold/Italic themselves, same as freshly typed
  // text; this only strips what the SOURCE brought with it.
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
  }

  function toggleBold() {
    editorRef.current?.focus();
    document.execCommand("bold");
  }

  function toggleItalic() {
    editorRef.current?.focus();
    document.execCommand("italic");
  }

  return (
    <div
      className="relative min-w-0 flex-1"
      // Load-bearing the same way ImageItemChip's name span's is -- stops a
      // text-selection drag from ever bubbling to an ancestor's drag
      // listener. Frames/Text rows aren't inside Brief's DndContext at all
      // today (only the References/Images/Products item chips are), so
      // there's nothing above this to actually steal from right now -- kept
      // as the same defensive convention anyway, at zero cost, so this stays
      // correct if that ever changes.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {focused && !disabled && (
        <div className="absolute -top-8 left-0 z-10 flex items-center gap-0.5 rounded-full border border-border bg-background px-1 py-1 shadow-sm">
          <button
            type="button"
            title="Bold"
            aria-label="Bold"
            // Prevents the mousedown from blurring/collapsing the editor's
            // selection before the click's execCommand runs -- without this
            // the toolbar would always format nothing.
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleBold}
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors duration-150 hover:bg-black/[.06]"
          >
            B
          </button>
          <button
            type="button"
            title="Italic"
            aria-label="Italic"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleItalic}
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs italic transition-colors duration-150 hover:bg-black/[.06]"
          >
            I
          </button>
        </div>
      )}
      <div
        ref={(el) => {
          editorRef.current = el;
          onEditorRef?.(el);
        }}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onFocus={handleFocus}
        onBlur={handleBlur}
        onInput={handleInput}
        onPaste={handlePaste}
        // Resting: locked to a single compact row (min-h and max-h equal,
        // overflow-hidden) -- purely visual clipping, never touches the
        // actual content/model, so a long-content frame still LOOKS compact
        // at rest instead of growing to fit it. Focused: expands to the
        // real writing area, grows with content up to a sane max, then
        // scrolls. CSS-only either way (no JS resize logic needed;
        // contentEditable already grows/scrolls like any other block box).
        className={`min-w-0 rounded-none border border-border bg-transparent px-3 py-2 text-sm whitespace-pre-wrap transition-[min-height,max-height] duration-150 focus:border-foreground focus:outline-none disabled:opacity-60 ${
          focused ? "min-h-32 max-h-64 overflow-y-auto" : "min-h-9 max-h-9 overflow-hidden"
        }`}
      />
      {isEmpty && placeholder && (
        <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted">{placeholder}</span>
      )}
    </div>
  );
}

function buildParagraphElement(paragraph: FormattedParagraph): HTMLDivElement {
  const div = document.createElement("div");
  if (paragraph.runs.length === 0 || paragraph.runs.every((r) => !r.text)) {
    div.appendChild(document.createElement("br"));
    return div;
  }
  for (const run of paragraph.runs) {
    div.appendChild(buildRunNode(run));
  }
  return div;
}

function buildRunNode(run: FormattedRun): Node {
  let node: Node = document.createTextNode(run.text);
  if (run.italic) {
    const em = document.createElement("i");
    em.appendChild(node);
    node = em;
  }
  if (run.bold) {
    const strong = document.createElement("b");
    strong.appendChild(node);
    node = strong;
  }
  return node;
}

// Walks the live contentEditable DOM back into the paragraphs/runs model.
// Browsers are inconsistent about exactly how they shape a contentEditable's
// DOM (a top-level <div> per line after Enter is typical with
// defaultParagraphSeparator="div", but the very FIRST line before any Enter
// is often left as bare text/inline nodes directly under the root, not
// wrapped in its own <div>) -- rather than assume one specific shape, this
// walks every top-level child in order and treats each top-level <div> (or
// <br>) as a paragraph boundary, accumulating any bare top-level text/inline
// content in between as its own (implicit) paragraph. This handles both
// shapes correctly instead of silently losing whichever one wasn't assumed.
function serializeDomToModel(root: HTMLElement): FormattedParagraph[] {
  const paragraphs: FormattedParagraph[] = [];
  let currentRuns: FormattedRun[] = [];
  let currentHasContent = false;

  function pushRun(text: string, bold: boolean, italic: boolean) {
    if (!text) return;
    currentHasContent = true;
    const last = currentRuns[currentRuns.length - 1];
    if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) {
      last.text += text;
    } else {
      currentRuns.push({ text, bold: bold || undefined, italic: italic || undefined });
    }
  }

  function walkInline(node: Node, bold: boolean, italic: boolean) {
    if (node.nodeType === Node.TEXT_NODE) {
      pushRun(node.textContent ?? "", bold, italic);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") return;
    const nextBold = bold || el.tagName === "B" || el.tagName === "STRONG";
    const nextItalic = italic || el.tagName === "I" || el.tagName === "EM";
    for (const child of Array.from(el.childNodes)) walkInline(child, nextBold, nextItalic);
  }

  function flushParagraph() {
    paragraphs.push({ runs: currentRuns.length > 0 ? currentRuns : [{ text: "" }] });
    currentRuns = [];
    currentHasContent = false;
  }

  for (const node of Array.from(root.childNodes)) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "DIV";
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR";
    if (isBlock) {
      if (currentHasContent) flushParagraph();
      walkInline(node, false, false);
      flushParagraph();
    } else if (isBreak) {
      flushParagraph();
    } else {
      walkInline(node, false, false);
    }
  }
  if (currentHasContent || paragraphs.length === 0) flushParagraph();

  return paragraphs;
}
