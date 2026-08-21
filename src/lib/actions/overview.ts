"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { analyzeDocument, generateText } from "@/lib/ai/client";
import { notifyProjectMembers } from "@/lib/notifications";
import type { AiInsights } from "@/types/database";

export type OverviewActionState = { message?: string; success?: boolean } | undefined;

export async function updateBrandStrategy(
  projectId: string,
  _state: OverviewActionState,
  formData: FormData,
): Promise<OverviewActionState> {
  const supabase = await createClient();

  // Spectrum values are saved independently via updateSpectrumValue (each
  // slider commits on its own) -- this form only ever submits the five text
  // fields below, so it must never touch the spectrum_* columns here, or a
  // save from this dialog would silently zero out every slider.
  const update = {
    project_id: projectId,
    brand_values: String(formData.get("brand_values") ?? ""),
    vision: String(formData.get("vision") ?? ""),
    voice: String(formData.get("voice") ?? ""),
    positioning: String(formData.get("positioning") ?? ""),
    audience_notes: String(formData.get("audience_notes") ?? ""),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("brand_strategy").upsert(update);
  if (error) return { message: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

function spectrumPatch(column: string, value: number): Partial<{
  spectrum_serious_playful: number;
  spectrum_classic_futuristic: number;
  spectrum_premium_accessible: number;
  spectrum_editorial_commercial: number;
  spectrum_minimal_expressive: number;
  spectrum_luxury_casual: number;
}> | null {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  switch (column) {
    case "spectrum_serious_playful":
      return { spectrum_serious_playful: clamped };
    case "spectrum_classic_futuristic":
      return { spectrum_classic_futuristic: clamped };
    case "spectrum_premium_accessible":
      return { spectrum_premium_accessible: clamped };
    case "spectrum_editorial_commercial":
      return { spectrum_editorial_commercial: clamped };
    case "spectrum_minimal_expressive":
      return { spectrum_minimal_expressive: clamped };
    case "spectrum_luxury_casual":
      return { spectrum_luxury_casual: clamped };
    default:
      return null;
  }
}

// Each slider commits independently (on release) via this action, so
// dragging one axis never touches the other five or the text fields --
// unlike a single "save the whole form" submit would.
export async function updateSpectrumValue(
  projectId: string,
  column: string,
  value: number,
): Promise<OverviewActionState> {
  const patch = spectrumPatch(column, value);
  if (!patch) return { message: "Invalid spectrum field." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_strategy")
    .upsert({ project_id: projectId, ...patch, updated_at: new Date().toISOString() });
  if (error) return { message: error.message };

  // Not revalidating this action's own route -- the slider's own local
  // `value` state (overview-panels.tsx's SpectrumSlider) already shows the
  // dragged position correctly and permanently, with or without this;
  // revalidating /projects/[projectId] here only forced a full fresh page
  // render to be bundled into this action's own response before it could
  // resolve, for a value the UI was already showing correctly.
  return { success: true };
}

// Shared by generateBrandSummary/suggestPersonalitySpectrum/
// generateBrandSections (via brandContextLines) -- all three read the same
// brand_strategy row and brand_documents rows to build their own prompt.
// Each still fetches its own copy by default (they're independently called
// from their own "Refresh AI" buttons elsewhere in Overview), but
// refreshBrandIntelligence fetches this once and passes it to all three
// instead of triggering 2-3x redundant re-fetches of identical rows when
// they run in its Promise.all below.
type BrandContextRows = {
  strategy: {
    brand_values: string | null;
    vision: string | null;
    voice: string | null;
    positioning: string | null;
    audience_notes: string | null;
  } | null;
  documents: { source_type: string; filename: string; url: string | null; ai_analysis: string | null }[] | null;
};

async function fetchBrandContextRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<BrandContextRows> {
  const [{ data: strategy }, { data: documents }] = await Promise.all([
    supabase
      .from("brand_strategy")
      .select("brand_values, vision, voice, positioning, audience_notes")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase.from("brand_documents").select("source_type, filename, url, ai_analysis").eq("project_id", projectId),
  ]);
  return { strategy, documents };
}

export async function generateBrandSummary(
  projectId: string,
  preFetched?: BrandContextRows,
): Promise<OverviewActionState> {
  const supabase = await createClient();

  const { strategy } = preFetched ?? (await fetchBrandContextRows(supabase, projectId));

  const prompt = [
    "Summarize this brand's strategy in 3-4 concise sentences for an internal team dashboard.",
    `Values: ${strategy?.brand_values || "(none provided)"}`,
    `Vision: ${strategy?.vision || "(none provided)"}`,
    `Voice: ${strategy?.voice || "(none provided)"}`,
    `Positioning: ${strategy?.positioning || "(none provided)"}`,
    `Audience notes: ${strategy?.audience_notes || "(none provided)"}`,
  ].join("\n");

  const result = await generateText(prompt);
  if ("error" in result) return { message: result.error };

  const { error } = await supabase
    .from("brand_strategy")
    .upsert({ project_id: projectId, ai_summary: result.text, updated_at: new Date().toISOString() });
  if (error) return { message: error.message };

  // Not revalidating this action's own route -- its one caller
  // (BrandIntelligenceSection.handleRefreshAi) already calls
  // router.refresh() itself right after this resolves, so this was purely
  // redundant: the same fresh render, minted twice.
  return { success: true };
}

export async function suggestPersonalitySpectrum(
  projectId: string,
  preFetched?: BrandContextRows,
): Promise<OverviewActionState> {
  const supabase = await createClient();

  const { strategy, documents } = preFetched ?? (await fetchBrandContextRows(supabase, projectId));

  const documentSummaries = (documents ?? [])
    .map((d) => d.ai_analysis)
    .filter(Boolean)
    .join("\n");

  const prompt = [
    "Based on this brand information, suggest values from 0-100 for six personality axes.",
    "Respond with ONLY a JSON object with these exact keys, no other text:",
    '{"serious_playful": 0-100, "classic_futuristic": 0-100, "premium_accessible": 0-100, "editorial_commercial": 0-100, "minimal_expressive": 0-100, "luxury_casual": 0-100}',
    "For each axis, 0 means the first word and 100 means the second word.",
    `Values: ${strategy?.brand_values || "(none provided)"}`,
    `Vision: ${strategy?.vision || "(none provided)"}`,
    `Voice: ${strategy?.voice || "(none provided)"}`,
    `Positioning: ${strategy?.positioning || "(none provided)"}`,
    `Audience notes: ${strategy?.audience_notes || "(none provided)"}`,
    documentSummaries ? `Brand documents analysis: ${documentSummaries}` : "",
  ].join("\n");

  const result = await generateText(prompt);
  if ("error" in result) return { message: result.error };

  let parsed: Record<string, number>;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
  } catch {
    return { message: "AI response could not be parsed. Try again." };
  }

  const clamp = (n: unknown) => Math.min(100, Math.max(0, Number(n) || 50));

  const { error } = await supabase.from("brand_strategy").upsert({
    project_id: projectId,
    spectrum_serious_playful: clamp(parsed.serious_playful),
    spectrum_classic_futuristic: clamp(parsed.classic_futuristic),
    spectrum_premium_accessible: clamp(parsed.premium_accessible),
    spectrum_editorial_commercial: clamp(parsed.editorial_commercial),
    spectrum_minimal_expressive: clamp(parsed.minimal_expressive),
    spectrum_luxury_casual: clamp(parsed.luxury_casual),
    updated_at: new Date().toISOString(),
  });
  if (error) return { message: error.message };

  // Not revalidating this action's own route -- its callers
  // (BrandSpectrumPanel.handleSuggestSpectrum, refreshBrandIntelligence)
  // already bring back fresh data themselves (router.refresh() / their own
  // revalidation), same reasoning as generateBrandSummary above.
  return { success: true };
}

export type UploadDocumentState = { message?: string; success?: boolean; documentId?: string } | undefined;

export async function uploadBrandDocument(
  projectId: string,
  _state: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  // The file itself already went direct browser-to-Storage before this
  // action ever runs (see the client's upload handler) -- this only ever
  // receives the resulting storage path, never the raw file, so a large PDF
  // deck stays well under Vercel's Function request-body limit.
  const storagePath = formData.get("storagePath");
  const fileName = formData.get("fileName");
  if (typeof storagePath !== "string" || !storagePath) return { message: "Choose a file first." };

  const { data, error } = await supabase
    .from("brand_documents")
    .insert({
      project_id: projectId,
      source_type: "file",
      storage_path: storagePath,
      filename: typeof fileName === "string" ? fileName : "document",
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { message: error.message };

  // Not revalidating this action's own route -- its one caller
  // (BrandKnowledgeDialog) always follows a successful upload with
  // onUploaded(documentId), which triggers handleIntelligenceRefresh ->
  // refreshBrandIntelligence -> router.refresh(), so the document list
  // gets a fresh render regardless of anything revalidated here.
  return { success: true, documentId: data?.id };
}

export async function addBrandLink(
  projectId: string,
  _state: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { message: "URL is required." };

  const { data, error } = await supabase
    .from("brand_documents")
    .insert({
      project_id: projectId,
      source_type: "link",
      url,
      filename: label || url,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { message: error.message };

  // Not revalidating -- same reasoning as uploadBrandDocument above (its
  // one caller, the same BrandKnowledgeDialog, triggers the same
  // onUploaded -> refreshBrandIntelligence -> router.refresh() chain).
  return { success: true, documentId: data?.id };
}

// Not revalidating anywhere in this function -- both of its callers already
// bring back fresh data themselves: BrandKnowledgeDialog.handleAnalyze
// calls router.refresh() right after, and refreshBrandIntelligence (which
// also calls this internally) has its own client-side refresh chain too.
export async function analyzeBrandDocument(projectId: string, documentId: string) {
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("brand_documents")
    .select("source_type, storage_path, filename")
    .eq("id", documentId)
    .single();
  if (!doc) return;

  if (doc.source_type === "link" || !doc.storage_path) {
    // Links have no fetchable file server-side; they're passed to the AI as
    // labeled context (URL text) whenever a brand summary/insights prompt runs,
    // rather than analyzed individually.
    await supabase
      .from("brand_documents")
      .update({ ai_analysis: "Links are used as context automatically -- no separate analysis needed." })
      .eq("id", documentId);
    return;
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from("brand-documents")
    .download(doc.storage_path);
  if (downloadError || !file) return;

  const isPdf = doc.filename.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    await supabase
      .from("brand_documents")
      .update({ ai_analysis: "Only PDF analysis is supported right now." })
      .eq("id", documentId);
    return;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  const result = await analyzeDocument(
    "Summarize this brand document's key points in 3-5 sentences for an internal team knowledge base.",
    base64,
    "application/pdf",
  );

  const analysis = "error" in result ? result.error : result.text;
  await supabase.from("brand_documents").update({ ai_analysis: analysis }).eq("id", documentId);
}

// Not revalidating its own route -- its one caller
// (BrandKnowledgeOrbit.handleDelete) always calls router.refresh() itself
// right after this resolves.
export async function deleteBrandDocument(
  projectId: string,
  documentId: string,
): Promise<{ success: true } | { success: false; message: string }> {
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("brand_documents")
    .select("storage_path")
    .eq("id", documentId)
    .single();

  if (doc?.storage_path) {
    await supabase.storage.from("brand-documents").remove([doc.storage_path]);
  }
  const { error } = await supabase.from("brand_documents").delete().eq("id", documentId);
  if (error) return { success: false, message: error.message };

  // Not revalidating -- its one caller (BrandIntelligenceSection's
  // handleDelete) already hides the tile optimistically before this runs,
  // and only calls router.refresh() on failure to resync.
  return { success: true };
}

async function brandContextLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  preFetched?: BrandContextRows,
): Promise<string> {
  const { strategy, documents } = preFetched ?? (await fetchBrandContextRows(supabase, projectId));

  const docLines = (documents ?? []).map((d) =>
    d.source_type === "link" ? `Link -- ${d.filename}: ${d.url}` : `File "${d.filename}": ${d.ai_analysis || "(not analyzed yet)"}`,
  );

  return [
    `Values: ${strategy?.brand_values || "(none provided)"}`,
    `Vision: ${strategy?.vision || "(none provided)"}`,
    `Voice: ${strategy?.voice || "(none provided)"}`,
    `Positioning: ${strategy?.positioning || "(none provided)"}`,
    `Audience notes: ${strategy?.audience_notes || "(none provided)"}`,
    ...docLines,
  ].join("\n");
}

export async function generateBrandSections(
  projectId: string,
  preFetched?: BrandContextRows,
): Promise<OverviewActionState> {
  const supabase = await createClient();
  const context = await brandContextLines(supabase, projectId, preFetched);

  const prompt = [
    "Based on this brand information, write a concise brand breakdown for an internal team dashboard.",
    "Respond with ONLY a JSON object with these exact keys, no other text, each value 1-3 sentences:",
    `{"brand_dna": "...", "tone_of_voice": "...", "communication_style": "...", "content_pillars": "...", "audience_snapshot": "...", "visual_language": "...", "avoid": "..."}`,
    "- brand_dna: the core identity/essence of the brand.",
    "- tone_of_voice: how the brand sounds when it writes.",
    "- communication_style: format/structure patterns it favors.",
    "- content_pillars: recurring themes/topics it should post about.",
    "- audience_snapshot: who the brand is talking to.",
    "- visual_language: colors/imagery/aesthetic patterns.",
    "- avoid: things the brand should NOT do or say.",
    context,
  ].join("\n");

  const result = await generateText(prompt);
  if ("error" in result) return { message: result.error };

  let parsed: Record<string, string>;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
  } catch {
    return { message: "AI response could not be parsed. Try again." };
  }

  const str = (key: string) => (typeof parsed[key] === "string" ? parsed[key] : "");

  const { error } = await supabase.from("brand_strategy").upsert({
    project_id: projectId,
    ai_brand_dna: str("brand_dna"),
    ai_tone_of_voice: str("tone_of_voice"),
    ai_communication_style: str("communication_style"),
    ai_content_pillars: str("content_pillars"),
    ai_audience_snapshot: str("audience_snapshot"),
    ai_visual_language: str("visual_language"),
    ai_avoid: str("avoid"),
    updated_at: new Date().toISOString(),
  });
  if (error) return { message: error.message };

  // Not revalidating -- same reasoning as generateBrandSummary above (both
  // callers, handleRefreshAi and refreshBrandIntelligence, already bring
  // back fresh data themselves).
  return { success: true };
}

export async function generateAiInsights(projectId: string): Promise<OverviewActionState> {
  const supabase = await createClient();

  const [context, { data: recentPosts }, { data: recentStories }] = await Promise.all([
    brandContextLines(supabase, projectId),
    supabase
      .from("posts")
      .select("caption, notes, status, scheduled_date")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("stories")
      .select("name, notes, status, scheduled_date")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const contentLines = [
    ...(recentPosts ?? []).map(
      (p) => `Post [${p.status}${p.scheduled_date ? "" : ", unscheduled"}]: ${p.caption || "(no caption)"}`,
    ),
    ...(recentStories ?? []).map(
      (s) => `Story [${s.status}${s.scheduled_date ? "" : ", unscheduled"}] "${s.name}": ${s.notes || "(no notes)"}`,
    ),
  ].join("\n");

  const prompt = [
    "You are a brand-consistency assistant reviewing a social content calendar.",
    "Based on the brand info and recent content below, respond with ONLY a JSON object with these exact keys:",
    `{"brand_health_pct": 0-100, "today_label": "short phrase", "next_gap_label": "short phrase", "tone_label": "1-2 words", "content_mix_pct": 0-100, "content_mix_label": "short phrase describing the dominant content type", "cta_usage_pct": 0-100, "cta_usage_label": "short phrase", "notices": ["short actionable notice", "..."]}`,
    "- brand_health_pct: overall how consistently the content matches the brand voice/values (100 = excellent).",
    "- today_label: a short phrase about what needs attention today (e.g. '2 posts need approval').",
    "- next_gap_label: the next upcoming day/period with no content scheduled.",
    "- tone_label: the dominant tone detected across recent captions (e.g. 'Editorial').",
    "- content_mix_pct + content_mix_label: the rough % split and dominant category (e.g. 78, 'Educational').",
    "- cta_usage_pct + cta_usage_label: how often captions include a clear call-to-action, and a short note.",
    "- notices: 2-5 short, specific, actionable bullet points (drafts needing a schedule, tone drift, off-brand risk, etc).",
    "Brand info:",
    context,
    "Recent content:",
    contentLines || "(no content yet)",
  ].join("\n");

  const result = await generateText(prompt);
  if ("error" in result) return { message: result.error };

  let parsed: AiInsights;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
  } catch {
    return { message: "AI response could not be parsed. Try again." };
  }

  const { error } = await supabase.from("brand_strategy").upsert({
    project_id: projectId,
    ai_insights: parsed,
    ai_insights_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { message: error.message };

  // Not revalidating -- its one caller (AiRecommendationsPanel.handleRefresh)
  // already calls router.refresh() itself right after this resolves.
  return { success: true };
}

// Runs the full "feed the AI" pipeline after new brand knowledge is added:
// analyze the new document (if any), then regenerate the summary, the
// 7-section breakdown, and the personality spectrum -- so uploading a file
// or adding a link visibly updates the whole right column, not just the
// document list.
export async function refreshBrandIntelligence(
  projectId: string,
  newDocumentId?: string,
): Promise<OverviewActionState> {
  if (newDocumentId) {
    await analyzeBrandDocument(projectId, newDocumentId);
  }

  // Fetched once (after analyzeBrandDocument above, so a freshly-analyzed
  // document's ai_analysis is included) and shared across all three --
  // previously each independently re-fetched the identical brand_strategy/
  // brand_documents rows inside this same Promise.all.
  const supabase = await createClient();
  const context = await fetchBrandContextRows(supabase, projectId);

  const [summary, sections, spectrum] = await Promise.all([
    generateBrandSummary(projectId, context),
    generateBrandSections(projectId, context),
    suggestPersonalitySpectrum(projectId, context),
  ]);

  const message = summary?.message || sections?.message || spectrum?.message;
  if (message) return { message };

  await notifyProjectMembers(supabase, projectId, "ai_analysis_complete", {
    title: "AI finished analyzing your brand knowledge",
    icon: "✨",
    link: `/projects/${projectId}`,
  });

  // Not revalidating -- its one caller (BrandIntelligenceSection's
  // handleIntelligenceRefresh) already calls router.refresh() itself right
  // after this resolves.
  return { success: true };
}
