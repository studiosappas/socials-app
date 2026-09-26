// Regression tests for result-safety.ts -- the rules that keep an unavailable
// or failing AI service from overwriting or corrupting saved data. No network,
// no Anthropic SDK, no Supabase: every provider call and database write is a
// fake, so nothing here can ever make a real (paid) API call. Runs directly
// under Node's native TS support:
//
//   node --experimental-strip-types "src/lib/ai/result-safety.test.ts"

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_USER_MESSAGES,
  AI_SAVE_FAILED_MESSAGE,
  AI_REFRESH_UNAVAILABLE_MESSAGE,
  LINK_ANALYSIS_NOTE,
  NON_PDF_ANALYSIS_NOTE,
  analysisForPrompt,
  displayableAnalysis,
  failure,
  isLegacyAnalysisError,
  parseInsights,
  parseSections,
  parseSpectrum,
  runDocumentAnalysis,
  safeAiCall,
  type AiResult,
  type DocumentAnalysisDeps,
  type MessageLike,
} from "./result-safety.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// The exact text older versions wrote into brand_documents.ai_analysis.
const LEGACY_ERROR_TEXT = "AI analysis isn't configured yet — set ANTHROPIC_API_KEY to enable this.";
const REAL_ANALYSIS = "A warm, minimalist skincare brand focused on sustainable packaging.";

// A fake brand document + database. `stored` is the ai_analysis column;
// every call is recorded so tests can assert what was (not) touched.
function fakeDoc(opts: {
  existing?: string | null;
  filename?: string;
  sourceType?: string;
  storagePath?: string | null;
  aiConfigured?: boolean;
  download?: string | null;
  analyze?: AiResult;
  saveOk?: boolean;
  missing?: boolean;
}) {
  const state = {
    stored: opts.existing ?? "",
    downloads: 0,
    analyzeCalls: 0,
    saves: [] as string[],
  };
  const deps: DocumentAnalysisDeps = {
    aiConfigured: opts.aiConfigured ?? true,
    loadDocument: async () =>
      opts.missing
        ? null
        : {
            sourceType: opts.sourceType ?? "file",
            storagePath: opts.storagePath === undefined ? "p/brand.pdf" : opts.storagePath,
            filename: opts.filename ?? "brand.pdf",
            existingAnalysis: state.stored,
          },
    downloadFile: async () => {
      state.downloads++;
      return opts.download === undefined ? "BASE64" : opts.download;
    },
    analyze: async () => {
      state.analyzeCalls++;
      return opts.analyze ?? { text: REAL_ANALYSIS };
    },
    saveAnalysis: async (text) => {
      if (opts.saveOk === false) return false;
      state.saves.push(text);
      state.stored = text;
      return true;
    },
  };
  return { state, deps };
}

// ---------------------------------------------------------------------------
// Missing API configuration
// ---------------------------------------------------------------------------

await test("missing configuration: no download, no AI call, no write, clear message", async () => {
  const { state, deps } = fakeDoc({ existing: REAL_ANALYSIS, aiConfigured: false });
  const outcome = await runDocumentAnalysis(deps);
  assert.deepEqual(outcome, { status: "failed", message: AI_USER_MESSAGES.not_configured });
  assert.equal(state.downloads, 0);
  assert.equal(state.analyzeCalls, 0);
  assert.deepEqual(state.saves, []);
  assert.equal(state.stored, REAL_ANALYSIS);
});

await test("missing configuration: failure() carries the customer-safe message and reason", () => {
  assert.deepEqual(failure("not_configured"), { error: AI_USER_MESSAGES.not_configured, reason: "not_configured" });
});

// ---------------------------------------------------------------------------
// Existing analysis preservation
// ---------------------------------------------------------------------------

for (const [label, analyze] of [
  ["request failed", failure("request_failed")],
  ["unusable response", failure("unusable_response")],
  ["not configured (returned by the provider layer)", failure("not_configured")],
] as const) {
  await test(`existing analysis preserved when AI ${label}`, async () => {
    const { state, deps } = fakeDoc({ existing: REAL_ANALYSIS, analyze });
    const outcome = await runDocumentAnalysis(deps);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(state.saves, [], "an AI failure must never be written");
    assert.equal(state.stored, REAL_ANALYSIS);
  });
}

await test("existing analysis preserved when the file can't be downloaded", async () => {
  const { state, deps } = fakeDoc({ existing: REAL_ANALYSIS, download: null });
  const outcome = await runDocumentAnalysis(deps);
  assert.equal(outcome.status, "failed");
  assert.equal(state.analyzeCalls, 0);
  assert.equal(state.stored, REAL_ANALYSIS);
});

await test("a failed database write is reported as a failure, not success", async () => {
  const { state, deps } = fakeDoc({ existing: REAL_ANALYSIS, saveOk: false });
  const outcome = await runDocumentAnalysis(deps);
  assert.deepEqual(outcome, { status: "failed", message: AI_SAVE_FAILED_MESSAGE });
  assert.equal(state.stored, REAL_ANALYSIS);
});

await test("informational notes never overwrite a real analysis", async () => {
  const nonPdf = fakeDoc({ existing: REAL_ANALYSIS, filename: "brand.docx" });
  assert.deepEqual(await runDocumentAnalysis(nonPdf.deps), { status: "unchanged" });
  assert.equal(nonPdf.state.stored, REAL_ANALYSIS);

  const link = fakeDoc({ existing: REAL_ANALYSIS, sourceType: "link", storagePath: null });
  assert.deepEqual(await runDocumentAnalysis(link.deps), { status: "unchanged" });
  assert.equal(link.state.stored, REAL_ANALYSIS);
});

// ---------------------------------------------------------------------------
// New document uploads without AI
// ---------------------------------------------------------------------------

await test("new PDF without AI: analysis stays empty (no error text stored)", async () => {
  const { state, deps } = fakeDoc({ existing: "", aiConfigured: false });
  const outcome = await runDocumentAnalysis(deps);
  assert.equal(outcome.status, "failed");
  assert.deepEqual(state.saves, []);
  assert.equal(state.stored, "");
});

await test("new non-PDF without AI: stores only the informational note (no AI needed)", async () => {
  const { state, deps } = fakeDoc({ existing: "", aiConfigured: false, filename: "brand.docx" });
  assert.deepEqual(await runDocumentAnalysis(deps), { status: "saved" });
  assert.deepEqual(state.saves, [NON_PDF_ANALYSIS_NOTE]);
  assert.equal(state.downloads, 0);
});

await test("new link without AI: stores only the informational note", async () => {
  const { state, deps } = fakeDoc({ existing: "", aiConfigured: false, sourceType: "link", storagePath: null });
  assert.deepEqual(await runDocumentAnalysis(deps), { status: "saved" });
  assert.deepEqual(state.saves, [LINK_ANALYSIS_NOTE]);
});

await test("refresh-unavailable message makes clear the upload itself was saved", () => {
  assert.match(AI_REFRESH_UNAVAILABLE_MESSAGE, /^Saved\./);
});

// ---------------------------------------------------------------------------
// Failed AI requests (provider wrapper)
// ---------------------------------------------------------------------------

function apiError(name: string, status?: number) {
  const e = new Error(`${name} secret-looking-detail sk-ant-should-never-surface`) as Error & { status?: number };
  e.name = name;
  if (status !== undefined) e.status = status;
  return e;
}

// safeAiCall logs safe facts to console.error on failure -- silenced here so
// test output stays readable, and checked to never contain the error message.
const originalConsoleError = console.error;
const logged: string[] = [];
console.error = (...args: unknown[]) => {
  logged.push(args.map(String).join(" "));
};

for (const [label, err] of [
  ["401 authentication error", apiError("AuthenticationError", 401)],
  ["429 rate limit", apiError("RateLimitError", 429)],
  ["500 server error", apiError("InternalServerError", 500)],
  ["529 overloaded", apiError("APIError", 529)],
  ["network failure (no status)", apiError("APIConnectionError")],
  ["timeout", apiError("APIConnectionTimeoutError")],
  ["non-Error rejection", "boom"],
] as const) {
  await test(`failed request (${label}) returns request_failed and never throws`, async () => {
    const result = await safeAiCall("test", async () => {
      throw err;
    });
    assert.deepEqual(result, failure("request_failed"));
  });
}

await test("logged failure details never include the raw error message", () => {
  assert.ok(logged.length > 0);
  for (const line of logged) assert.ok(!line.includes("sk-ant"), `leaked detail in log: ${line}`);
});

const response = (stop_reason: string | null, content: MessageLike["content"]): MessageLike => ({ stop_reason, content });

await test("truncated response (max_tokens) is unusable, not saved as complete", async () => {
  const r = await safeAiCall("test", async () => response("max_tokens", [{ type: "text", text: "Half a sum" }]));
  assert.deepEqual(r, failure("unusable_response"));
});

await test("refused response is unusable", async () => {
  const r = await safeAiCall("test", async () => response("refusal", [{ type: "text", text: "I can't" }]));
  assert.deepEqual(r, failure("unusable_response"));
});

await test("empty or whitespace-only response is unusable", async () => {
  assert.deepEqual(await safeAiCall("t", async () => response("end_turn", [])), failure("unusable_response"));
  assert.deepEqual(
    await safeAiCall("t", async () => response("end_turn", [{ type: "text", text: "   " }])),
    failure("unusable_response"),
  );
});

await test("successful response returns its text (successful AI behavior preserved)", async () => {
  const r = await safeAiCall("t", async () =>
    response("end_turn", [
      { type: "thinking" },
      { type: "text", text: " Summary text. " },
    ]),
  );
  assert.deepEqual(r, { text: "Summary text." });
});

console.error = originalConsoleError;

await test("customer messages never mention environment variables, keys or API internals", () => {
  const all = [...Object.values(AI_USER_MESSAGES), AI_SAVE_FAILED_MESSAGE, AI_REFRESH_UNAVAILABLE_MESSAGE];
  for (const m of all) {
    assert.ok(!/ANTHROPIC|API|_KEY|env|HTTP|status|sk-/i.test(m), `technical wording in: ${m}`);
  }
});

// ---------------------------------------------------------------------------
// Repeated Analyze clicks
// ---------------------------------------------------------------------------

await test("repeated Analyze clicks while AI is unavailable never touch the stored analysis", async () => {
  const doc = fakeDoc({ existing: REAL_ANALYSIS, aiConfigured: false });
  for (let i = 0; i < 5; i++) await runDocumentAnalysis(doc.deps);
  assert.deepEqual(doc.state.saves, []);
  assert.equal(doc.state.stored, REAL_ANALYSIS);
});

await test("a successful analysis followed by failing clicks keeps the successful result", async () => {
  const ok = fakeDoc({ existing: "" });
  assert.deepEqual(await runDocumentAnalysis(ok.deps), { status: "saved" });
  assert.equal(ok.state.stored, REAL_ANALYSIS);

  // Same stored value, now with a failing provider.
  const failing = fakeDoc({ existing: ok.state.stored, analyze: failure("request_failed") });
  await runDocumentAnalysis(failing.deps);
  await runDocumentAnalysis(failing.deps);
  assert.equal(failing.state.stored, REAL_ANALYSIS);
});

await test("repeated clicks on a non-PDF don't rewrite an identical note", async () => {
  const doc = fakeDoc({ existing: NON_PDF_ANALYSIS_NOTE, filename: "brand.txt" });
  assert.deepEqual(await runDocumentAnalysis(doc.deps), { status: "unchanged" });
  assert.deepEqual(doc.state.saves, []);
});

await test("a successful re-analysis may replace a legacy error placeholder", async () => {
  const doc = fakeDoc({ existing: LEGACY_ERROR_TEXT });
  assert.deepEqual(await runDocumentAnalysis(doc.deps), { status: "saved" });
  assert.equal(doc.state.stored, REAL_ANALYSIS);
});

await test("missing document is reported, nothing written", async () => {
  const doc = fakeDoc({ missing: true });
  const outcome = await runDocumentAnalysis(doc.deps);
  assert.equal(outcome.status, "failed");
  assert.deepEqual(doc.state.saves, []);
});

// ---------------------------------------------------------------------------
// Legacy stored error text
// ---------------------------------------------------------------------------

await test("legacy error text is hidden from display and excluded from prompts", () => {
  assert.equal(isLegacyAnalysisError(LEGACY_ERROR_TEXT), true);
  assert.equal(displayableAnalysis(LEGACY_ERROR_TEXT), "");
  assert.equal(analysisForPrompt(LEGACY_ERROR_TEXT), null);
  assert.equal(displayableAnalysis(REAL_ANALYSIS), REAL_ANALYSIS);
  assert.equal(analysisForPrompt(REAL_ANALYSIS), REAL_ANALYSIS);
  assert.equal(displayableAnalysis(NON_PDF_ANALYSIS_NOTE), NON_PDF_ANALYSIS_NOTE, "informational notes stay visible");
  assert.equal(analysisForPrompt(NON_PDF_ANALYSIS_NOTE), null, "but never reach prompts as brand knowledge");
  assert.equal(analysisForPrompt(""), null);
  assert.equal(displayableAnalysis(null), "");
});

// ---------------------------------------------------------------------------
// Other AI actions that persist results
// ---------------------------------------------------------------------------

const FULL_SPECTRUM =
  '{"serious_playful": 20, "classic_futuristic": 70.4, "premium_accessible": 130, "editorial_commercial": -5, "minimal_expressive": "40", "luxury_casual": 55}';

await test("spectrum: complete response is accepted and clamped to 0-100", () => {
  assert.deepEqual(parseSpectrum(`Here you go:\n${FULL_SPECTRUM}`), {
    serious_playful: 20,
    classic_futuristic: 70,
    premium_accessible: 100,
    editorial_commercial: 0,
    minimal_expressive: 40,
    luxury_casual: 55,
  });
});

await test("spectrum: partial, empty, non-numeric or unparseable responses write nothing", () => {
  assert.equal(parseSpectrum('{"serious_playful": 20}'), null, "partial must not reset the other sliders to 50");
  assert.equal(parseSpectrum("{}"), null);
  assert.equal(parseSpectrum(FULL_SPECTRUM.replace('"40"', '"high"')), null);
  assert.equal(parseSpectrum("not json"), null);
  assert.equal(parseSpectrum("[1,2,3]"), null);
});

const FULL_SECTIONS = JSON.stringify({
  brand_dna: "Calm, honest care.",
  tone_of_voice: "Warm and direct.",
  communication_style: "Short sentences.",
  content_pillars: "Routines, ingredients.",
  audience_snapshot: "Busy professionals.",
  visual_language: "Soft neutrals.",
  avoid: "Hype and jargon.",
});

await test("sections: complete response is accepted", () => {
  const parsed = parseSections(FULL_SECTIONS);
  assert.ok(parsed);
  assert.equal(parsed.avoid, "Hype and jargon.");
});

await test("sections: a missing or empty section blanks nothing (whole result rejected)", () => {
  const partial = JSON.parse(FULL_SECTIONS);
  delete partial.avoid;
  assert.equal(parseSections(JSON.stringify(partial)), null);
  assert.equal(parseSections(JSON.stringify({ ...JSON.parse(FULL_SECTIONS), tone_of_voice: "  " })), null);
  assert.equal(parseSections("{}"), null);
});

const FULL_INSIGHTS = JSON.stringify({
  brand_health_pct: 82,
  today_label: "2 posts need approval",
  next_gap_label: "Next Tuesday",
  tone_label: "Editorial",
  content_mix_pct: 78,
  content_mix_label: "Educational",
  cta_usage_pct: 140,
  cta_usage_label: "Most captions",
  notices: ["Schedule 3 drafts", "", 42],
});

await test("insights: complete response is accepted (percentages clamped, bad notices dropped)", () => {
  const parsed = parseInsights(FULL_INSIGHTS);
  assert.ok(parsed);
  assert.equal(parsed.cta_usage_pct, 100);
  assert.deepEqual(parsed.notices, ["Schedule 3 drafts"]);
});

await test("insights: {} or wrongly typed fields never replace saved insights", () => {
  assert.equal(parseInsights("{}"), null);
  assert.equal(parseInsights(FULL_INSIGHTS.replace('"tone_label":"Editorial"', '"tone_label":5')), null);
  assert.equal(parseInsights(FULL_INSIGHTS.replace(/"notices":\[[^\]]*\]/, '"notices":"none"')), null);
});

// Source-level guard: no AI action may write an AI error message into data.
// This is the exact pattern that caused the original overwrite bug.
await test("no AI action writes an error result into the database (source scan)", () => {
  for (const file of ["src/lib/actions/overview.ts", "src/lib/actions/brief.ts", "src/lib/actions/brand-writer.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.ok(!/"error" in result \? result\.error/.test(src), `${file} stores result.error as content`);
    assert.ok(!/ai_analysis:\s*analysis\b/.test(src), `${file} writes an unchecked analysis`);
  }
});

console.log(`\n${passed} passed`);
