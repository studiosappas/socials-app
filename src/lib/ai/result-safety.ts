// Data-protection rules for AI results -- shared by src/lib/ai/client.ts and
// every server action that persists an AI result (src/lib/actions/overview.ts).
//
// The rule this module exists to enforce: an AI failure of ANY kind (not
// configured, request failed, empty/truncated/refused/unparseable response)
// must never be written into user data, and must never overwrite a
// previously saved result. Before this, analyzeBrandDocument stored the
// "not configured" error text as the document's analysis (overwriting real
// analyses via the Analyze button), an empty response wiped the AI summary,
// a partial JSON response blanked every brand section or reset spectrum
// sliders to 50, and SDK errors were thrown instead of handled.
//
// Deliberately has NO runtime imports (type-only at most), so its tests run
// directly under Node's native TypeScript support, same as
// src/lib/crop-geometry.test.ts -- see result-safety.test.ts.

export type AiFailureReason = "not_configured" | "request_failed" | "unusable_response";

export type AiResult = { text: string } | { error: string; reason: AiFailureReason };

// Customer-facing wording. Never includes environment variable names, provider
// names, HTTP details or raw error text -- those go to the server log only.
export const AI_USER_MESSAGES: Record<AiFailureReason, string> = {
  not_configured: "AI features are currently unavailable. Nothing was changed.",
  request_failed: "The AI service couldn't complete this request. Nothing was changed. Please try again in a moment.",
  unusable_response: "The AI returned an incomplete response. Nothing was changed. Please try again.",
};

export const AI_SAVE_FAILED_MESSAGE = "Couldn't save the AI result. Nothing was changed. Please try again.";

// Shown after a brand document/link was saved but the follow-up AI refresh
// couldn't run -- the upload itself succeeded, so "nothing was changed"
// would be misleading here.
export const AI_REFRESH_UNAVAILABLE_MESSAGE = "Saved. AI analysis is currently unavailable, so brand insights weren't updated.";

export function failure(reason: AiFailureReason): { error: string; reason: AiFailureReason } {
  return { error: AI_USER_MESSAGES[reason], reason };
}

// ---------------------------------------------------------------------------
// Provider call wrapper
// ---------------------------------------------------------------------------

// The minimal shape of an Anthropic Messages API response this module reads.
// Typed structurally (not imported from the SDK) so the logic stays testable
// without the SDK or any network access.
export type MessageLike = {
  stop_reason?: string | null;
  content: Array<{ type: string; text?: string }>;
};

// Safe error facts for the server log -- never the prompt, never headers,
// never a key. `status` exists on the SDK's APIError subclasses.
function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; status?: unknown };
    const name = typeof e.name === "string" ? e.name : "Error";
    return typeof e.status === "number" ? `${name} (HTTP ${e.status})` : name;
  }
  return "Unknown error";
}

// Runs one provider call and turns every outcome into an AiResult:
// - a thrown error (auth, rate limit, server error, network, timeout)
//   -> request_failed (never thrown on to the caller);
// - stop_reason "max_tokens" (truncated) or "refusal" -> unusable_response,
//   because a cut-off or declined answer must not be saved as if complete;
// - no non-empty text block -> unusable_response.
export async function safeAiCall(
  operation: string,
  call: () => Promise<MessageLike>,
): Promise<AiResult> {
  let response: MessageLike;
  try {
    response = await call();
  } catch (err) {
    console.error(`[ai] ${operation} request failed: ${describeError(err)}`);
    return failure("request_failed");
  }
  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    console.error(`[ai] ${operation} unusable response: stop_reason=${response.stop_reason}`);
    return failure("unusable_response");
  }
  const text = response.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
  if (!text) {
    console.error(`[ai] ${operation} unusable response: no text`);
    return failure("unusable_response");
  }
  return { text };
}

// ---------------------------------------------------------------------------
// Response validation -- a result is written only if it's complete
// ---------------------------------------------------------------------------

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const value: unknown = JSON.parse(match ? match[0] : text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pct(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export const SPECTRUM_KEYS = [
  "serious_playful",
  "classic_futuristic",
  "premium_accessible",
  "editorial_commercial",
  "minimal_expressive",
  "luxury_casual",
] as const;
export type SpectrumValues = Record<(typeof SPECTRUM_KEYS)[number], number>;

// All six axes must be present and numeric. The previous code defaulted any
// missing axis to 50 -- silently resetting the user's own slider positions
// whenever the model returned a partial object.
export function parseSpectrum(text: string): SpectrumValues | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const out = {} as SpectrumValues;
  for (const key of SPECTRUM_KEYS) {
    const n = finiteNumber(obj[key]);
    if (n === null) return null;
    out[key] = pct(n);
  }
  return out;
}

export const SECTION_KEYS = [
  "brand_dna",
  "tone_of_voice",
  "communication_style",
  "content_pillars",
  "audience_snapshot",
  "visual_language",
  "avoid",
] as const;
export type BrandSections = Record<(typeof SECTION_KEYS)[number], string>;

// All seven sections must be non-empty. The previous code wrote "" for any
// missing key, so a partial response blanked the previously saved sections.
export function parseSections(text: string): BrandSections | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const out = {} as BrandSections;
  for (const key of SECTION_KEYS) {
    const s = nonEmptyString(obj[key]);
    if (s === null) return null;
    out[key] = s;
  }
  return out;
}

// Structurally identical to AiInsights in src/types/database.ts (kept local so
// this module has no runtime imports; overview.ts assigns it to that type,
// so any drift fails type-checking there).
export type InsightsValues = {
  brand_health_pct: number;
  today_label: string;
  next_gap_label: string;
  tone_label: string;
  content_mix_pct: number;
  content_mix_label: string;
  cta_usage_pct: number;
  cta_usage_label: string;
  notices: string[];
};

// Every field must be present with the right type. The previous code stored
// whatever JSON came back (even `{}`), replacing the previous insights.
export function parseInsights(text: string): InsightsValues | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const health = finiteNumber(obj.brand_health_pct);
  const mix = finiteNumber(obj.content_mix_pct);
  const cta = finiteNumber(obj.cta_usage_pct);
  const labels = ["today_label", "next_gap_label", "tone_label", "content_mix_label", "cta_usage_label"] as const;
  if (health === null || mix === null || cta === null) return null;
  for (const key of labels) {
    if (typeof obj[key] !== "string") return null;
  }
  if (!Array.isArray(obj.notices)) return null;
  const notices = obj.notices.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  return {
    brand_health_pct: pct(health),
    today_label: obj.today_label as string,
    next_gap_label: obj.next_gap_label as string,
    tone_label: obj.tone_label as string,
    content_mix_pct: pct(mix),
    content_mix_label: obj.content_mix_label as string,
    cta_usage_pct: pct(cta),
    cta_usage_label: obj.cta_usage_label as string,
    notices,
  };
}

// ---------------------------------------------------------------------------
// Stored brand-document analysis text
// ---------------------------------------------------------------------------

// Informational (non-AI) notes the app itself stores as an "analysis". They
// are legitimate content, but never real analysis -- so they may be replaced
// by a real result, and never replace one.
export const LINK_ANALYSIS_NOTE = "Links are used as context automatically -- no separate analysis needed.";
export const NON_PDF_ANALYSIS_NOTE = "Only PDF analysis is supported right now.";

// Error text that earlier versions wrote INTO brand_documents.ai_analysis
// when AI was unavailable. Existing rows may still contain it: it must never
// be shown to customers (it names an environment variable) or fed back into
// prompts as if it were brand knowledge. Matched by prefix so any variant of
// that old message is covered.
const LEGACY_ERROR_PREFIXES = ["AI analysis isn't configured yet"];

export function isLegacyAnalysisError(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  return LEGACY_ERROR_PREFIXES.some((prefix) => t.startsWith(prefix));
}

// What the UI should display for a stored analysis ("" hides it).
export function displayableAnalysis(text: string | null | undefined): string {
  return text && !isLegacyAnalysisError(text) ? text : "";
}

// Whether a stored value counts as a real analysis worth protecting.
function isRealAnalysis(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  if (isLegacyAnalysisError(text)) return false;
  return text !== LINK_ANALYSIS_NOTE && text !== NON_PDF_ANALYSIS_NOTE;
}

// What a prompt should see for a stored analysis (null = "not analyzed").
export function analysisForPrompt(text: string | null | undefined): string | null {
  return isRealAnalysis(text) ? (text as string) : null;
}

// ---------------------------------------------------------------------------
// Brand document analysis flow (I/O injected, so every branch is testable)
// ---------------------------------------------------------------------------

export type DocumentAnalysisDeps = {
  aiConfigured: boolean;
  loadDocument: () => Promise<{
    sourceType: string;
    storagePath: string | null;
    filename: string;
    existingAnalysis: string | null;
  } | null>;
  // Base64 file content, or null if it couldn't be read.
  downloadFile: (storagePath: string) => Promise<string | null>;
  analyze: (fileBase64: string) => Promise<AiResult>;
  // true only if the database confirmed the write.
  saveAnalysis: (text: string) => Promise<boolean>;
};

export type DocumentAnalysisOutcome =
  | { status: "saved" }
  | { status: "unchanged"; message?: string }
  | { status: "failed"; message: string };

export async function runDocumentAnalysis(deps: DocumentAnalysisDeps): Promise<DocumentAnalysisOutcome> {
  const doc = await deps.loadDocument();
  if (!doc) return { status: "failed", message: "This document couldn't be found." };

  const hasRealAnalysis = isRealAnalysis(doc.existingAnalysis);

  // Informational notes are only ever written into an EMPTY field (or over a
  // legacy error placeholder) -- never over anything else.
  async function noteIfEmpty(note: string): Promise<DocumentAnalysisOutcome> {
    if (hasRealAnalysis || doc!.existingAnalysis === note) return { status: "unchanged" };
    const ok = await deps.saveAnalysis(note);
    return ok ? { status: "saved" } : { status: "failed", message: AI_SAVE_FAILED_MESSAGE };
  }

  if (doc.sourceType === "link" || !doc.storagePath) return noteIfEmpty(LINK_ANALYSIS_NOTE);
  if (!doc.filename.toLowerCase().endsWith(".pdf")) return noteIfEmpty(NON_PDF_ANALYSIS_NOTE);

  // Checked before downloading, so an unavailable AI service doesn't cost a
  // full file download either.
  if (!deps.aiConfigured) return { status: "failed", message: AI_USER_MESSAGES.not_configured };

  const fileBase64 = await deps.downloadFile(doc.storagePath);
  if (!fileBase64) {
    return { status: "failed", message: "This document couldn't be read, so it wasn't analyzed. Nothing was changed." };
  }

  const result = await deps.analyze(fileBase64);
  if ("error" in result) return { status: "failed", message: result.error };

  const ok = await deps.saveAnalysis(result.text);
  return ok ? { status: "saved" } : { status: "failed", message: AI_SAVE_FAILED_MESSAGE };
}
