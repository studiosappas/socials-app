"use client";

import { useEffect, useState, useTransition } from "react";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { generateBrandCopy, type BrandWriterAlternative, type BrandWriterTurn } from "@/lib/actions/brand-writer";

// A brand-aware writing assistant attached to a single text field -- built
// generic (projectId + the target field's live DOM node) so it can be
// dropped onto other fields (Brief text boxes, headline/CTA) later; only
// Post Editor's Caption and Brief's frame text boxes wire it up so far. See
// plan notes: the panel never asks the user to explain the brand --
// generateBrandCopy always pulls that from Overview's brand_strategy + real
// past captions/notes.
//
// Takes `field` as a plain nullable VALUE, not a ref object -- callers get
// it via `useState` + `ref={setFieldEl}` on the real input/textarea (React's
// own recommended pattern for reactively observing a DOM node), rather than
// `useRef`, since a `useRef`-backed value read during render (e.g. to hand
// out a stable per-row ref from a list) trips the react-hooks/refs rule.
export type WriterFieldElement = HTMLTextAreaElement | HTMLInputElement;

// A plain module-level helper, not part of the component -- react-hooks'
// stricter "immutability" rule disallows assigning a property directly on a
// component prop (`field.value = text` inside BrandWriterField itself), even
// though `field` is a real DOM node and this is an ordinary imperative DOM
// write, not a React-owned value. Doing the actual mutation in a plain
// function outside the component sidesteps that false positive.
function insertIntoField(field: WriterFieldElement, text: string) {
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  // Some fields (Brief's frame text) auto-save on blur rather than via a
  // page-level Save button -- blurring after insert makes that fire the
  // same way it would if the text had been typed by hand and then clicked
  // away from. Harmless where nothing listens for blur (Post Editor's
  // Caption still needs its own Save button either way).
  field.blur();
}

export function BrandWriterField({
  projectId,
  field,
  disabled,
}: {
  projectId: string;
  field: WriterFieldElement | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [requestText, setRequestText] = useState("");
  const [alternatives, setAlternatives] = useState<BrandWriterAlternative[] | null>(null);
  const [activeDraft, setActiveDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<BrandWriterTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ref = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));

  // Auto-opens on focus of an EMPTY field -- reads the field's live value at
  // focus time (not a prop) so it stays correct after Insert writes text
  // into the field directly (a prop snapshot from the initial server render
  // would go stale the moment that happens).
  useEffect(() => {
    if (!field || disabled) return;
    function handleFocus() {
      if (!field!.value.trim()) setOpen(true);
    }
    field.addEventListener("focus", handleFocus);
    return () => field.removeEventListener("focus", handleFocus);
  }, [field, disabled]);

  function reset() {
    setRequestText("");
    setAlternatives(null);
    setActiveDraft(null);
    setHistory([]);
    setError(null);
  }

  function handleGenerate() {
    const request = requestText.trim();
    if (!request || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await generateBrandCopy(projectId, request, history, activeDraft ?? undefined);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (activeDraft !== null) {
        // Refinement of the active draft -- exactly one alternative comes
        // back; it replaces the draft in place rather than showing a card.
        const next = result.alternatives[0]?.text ?? activeDraft;
        setHistory((h) => [...h, { request, text: next }]);
        setActiveDraft(next);
      } else {
        setAlternatives(result.alternatives);
      }
      setRequestText("");
    });
  }

  function selectAlternative(alt: BrandWriterAlternative) {
    setHistory((h) => [...h, { request: requestText || "(initial request)", text: alt.text }]);
    setActiveDraft(alt.text);
  }

  function handleInsert() {
    const text = activeDraft;
    if (!field || !text) return;
    insertIntoField(field, text);
    setOpen(false);
    reset();
  }

  function handleClose() {
    setOpen(false);
  }

  if (disabled) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Write with AI"
        title="Write with AI"
        className={`flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:text-foreground ${
          open ? "text-foreground" : ""
        }`}
      >
        <SparkleIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-border bg-card p-3 shadow-lg sm:w-96">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
              <SparkleIcon className="h-3 w-3" />
              Brand Writer
            </span>
            <button type="button" onClick={handleClose} className="text-xs text-muted hover:text-foreground">
              Close
            </button>
          </div>

          {activeDraft !== null && (
            <div className="mb-3 flex flex-col gap-2">
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-background p-2.5 text-sm whitespace-pre-wrap">
                {activeDraft}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInsert}
                  className="rounded-md bg-foreground px-3 py-1.5 text-xs tracking-wide text-background uppercase transition-opacity duration-150 hover:opacity-85"
                >
                  Insert
                </button>
                {alternatives && (
                  <button
                    type="button"
                    onClick={() => setActiveDraft(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Back to options
                  </button>
                )}
              </div>
            </div>
          )}

          {activeDraft === null && alternatives && (
            <div className="mb-3 flex flex-col gap-1.5">
              {alternatives.map((alt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectAlternative(alt)}
                  className="rounded-md border border-border p-2.5 text-left text-sm transition-colors duration-100 hover:bg-foreground/[0.04]"
                >
                  <span className="mb-1 block text-[10px] tracking-wide text-muted uppercase">{alt.label}</span>
                  <span className="line-clamp-3">{alt.text}</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="mb-2 text-xs text-error">{error}</p>}

          <div className="flex flex-col gap-2">
            <textarea
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder={
                activeDraft !== null
                  ? "Keep going -- \"make it shorter\", \"add emojis\"…"
                  : "Describe what you need -- \"write a caption announcing our new collection\"…"
              }
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-transparent px-2.5 py-2 text-sm focus:border-foreground focus:outline-none"
            />
            <div className="flex items-center justify-between">
              {(alternatives || activeDraft !== null) && (
                <button type="button" onClick={reset} className="text-xs text-muted hover:text-foreground">
                  New request
                </button>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={pending || !requestText.trim()}
                className="ml-auto rounded-md bg-foreground px-3 py-1.5 text-xs tracking-wide text-background uppercase transition-opacity duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? "Generating…" : activeDraft !== null ? "Refine" : alternatives ? "Regenerate" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11 2.5a1 1 0 0 1 1.94 0l1.2 4.79a4 4 0 0 0 2.9 2.9l4.79 1.2a1 1 0 0 1 0 1.94l-4.79 1.2a4 4 0 0 0-2.9 2.9l-1.2 4.79a1 1 0 0 1-1.94 0l-1.2-4.79a4 4 0 0 0-2.9-2.9L2.11 13.3a1 1 0 0 1 0-1.94l4.79-1.2a4 4 0 0 0 2.9-2.9L11 2.5Z" />
    </svg>
  );
}
