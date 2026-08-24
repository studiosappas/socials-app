// Serialization for Brief's body/text fields' Bold/Italic formatting.
//
// STORAGE FORMAT: a JSON string holding { v: 1, paragraphs: [{ runs: [...] }] },
// stored directly in brief_task_frames.body -- still a plain `text` column,
// no migration needed (see the accompanying report for why this was
// deliberately chosen over storing raw/sanitized HTML).
//
// SAFETY: this format is never rendered via dangerouslySetInnerHTML.
// RichTextField (src/components/ui/rich-text-field.tsx) renders every run's
// `text` as a plain React child (<b>{run.text}</b>), which React always
// HTML-escapes regardless of content -- there is no code path anywhere that
// interprets a stored run's text as markup, so this format carries zero XSS
// risk by construction, independent of any sanitizer.
//
// BACKWARD COMPATIBILITY: every brief_task_frames.body value written before
// this feature existed is a plain string that is NOT valid JSON shaped like
// the above (a plain sentence essentially never parses as JSON at all, and
// even in the astronomically unlikely case it did, it wouldn't have the
// `v: 1` + `paragraphs` shape this code checks for). parseBriefBody below
// treats anything that doesn't match as legacy plain text -- one paragraph
// per existing line break, no formatting -- so every existing Brief loads,
// displays, and is immediately editable/formattable exactly as before,
// with no backfill or migration of existing rows ever required.

export type FormattedRun = { text: string; bold?: boolean; italic?: boolean };
export type FormattedParagraph = { runs: FormattedRun[] };

const FORMAT_VERSION = 1;

function isFormattedRun(value: unknown): value is FormattedRun {
  if (!value || typeof value !== "object") return false;
  const run = value as { text?: unknown; bold?: unknown; italic?: unknown };
  if (typeof run.text !== "string") return false;
  if (run.bold !== undefined && typeof run.bold !== "boolean") return false;
  if (run.italic !== undefined && typeof run.italic !== "boolean") return false;
  return true;
}

function isFormattedParagraph(value: unknown): value is FormattedParagraph {
  if (!value || typeof value !== "object") return false;
  const runs = (value as { runs?: unknown }).runs;
  return Array.isArray(runs) && runs.every(isFormattedRun);
}

// Any failure/mismatch here (not valid JSON, not our shape) is treated as
// legacy plain text -- never an error, never data loss, just "no formatting
// to apply yet."
export function parseBriefBody(raw: string): FormattedParagraph[] {
  if (raw.trim().startsWith("{")) {
    try {
      const data: unknown = JSON.parse(raw);
      if (
        data &&
        typeof data === "object" &&
        (data as { v?: unknown }).v === FORMAT_VERSION &&
        Array.isArray((data as { paragraphs?: unknown }).paragraphs) &&
        (data as { paragraphs: unknown[] }).paragraphs.every(isFormattedParagraph)
      ) {
        const paragraphs = (data as { paragraphs: FormattedParagraph[] }).paragraphs;
        return paragraphs.length > 0 ? paragraphs : [{ runs: [{ text: "" }] }];
      }
    } catch {
      // Falls through to plain-text handling below.
    }
  }
  const lines = raw.length > 0 ? raw.split("\n") : [""];
  return lines.map((line) => ({ runs: [{ text: line }] }));
}

export function serializeBriefBody(paragraphs: FormattedParagraph[]): string {
  return JSON.stringify({ v: FORMAT_VERSION, paragraphs });
}

// Plain-text extraction for every downstream consumer that just needs the
// words -- the AI design-generation prompt (generateBriefDesign), and any
// future non-editor render of this same value. Formatting is dropped, line
// breaks are preserved, which is exactly what a plain-text-only consumer
// like an LLM prompt needs regardless of what's bold/italic.
export function plainTextFromBody(raw: string): string {
  return parseBriefBody(raw)
    .map((p) => p.runs.map((r) => r.text).join(""))
    .join("\n");
}

export function isBodyEmpty(raw: string): boolean {
  return plainTextFromBody(raw).trim().length === 0;
}
