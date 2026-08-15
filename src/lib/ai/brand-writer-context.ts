import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Distinct from overview.ts's private brandContextLines() -- that one only
// pulls the raw brand_values/vision/voice/positioning/audience_notes a user
// typed in. Brand Writer wants the AI-DISTILLED fields too (ai_tone_of_voice
// etc, produced by Overview's "Refresh Brand Intelligence"), which are a
// much more direct signal for how the brand should actually sound in
// generated copy -- and it wants real caption/story examples, not just a
// summary of them, since a model imitates concrete examples far more
// reliably than it acts on an abstract instruction like "sound premium."
export async function buildBrandWriterContext(supabase: SupabaseServerClient, projectId: string): Promise<string> {
  const [{ data: strategy }, { data: posts }, { data: stories }] = await Promise.all([
    supabase
      .from("brand_strategy")
      .select(
        "brand_values, vision, voice, positioning, audience_notes, ai_brand_dna, ai_tone_of_voice, ai_communication_style, ai_content_pillars, ai_audience_snapshot, ai_visual_language, ai_avoid",
      )
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("caption")
      .eq("project_id", projectId)
      .not("caption", "eq", "")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("stories")
      .select("notes")
      .eq("project_id", projectId)
      .not("notes", "eq", "")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const identity = [
    `Brand values: ${strategy?.brand_values || "(none provided)"}`,
    `Vision: ${strategy?.vision || "(none provided)"}`,
    `Voice: ${strategy?.voice || "(none provided)"}`,
    `Positioning: ${strategy?.positioning || "(none provided)"}`,
    `Audience: ${strategy?.audience_notes || "(none provided)"}`,
    `Brand DNA: ${strategy?.ai_brand_dna || "(none yet -- run Refresh Brand Intelligence on Overview)"}`,
    `Tone of voice: ${strategy?.ai_tone_of_voice || "(none yet)"}`,
    `Communication style: ${strategy?.ai_communication_style || "(none yet)"}`,
    `Content pillars: ${strategy?.ai_content_pillars || "(none yet)"}`,
    `Audience snapshot: ${strategy?.ai_audience_snapshot || "(none yet)"}`,
    `Visual language: ${strategy?.ai_visual_language || "(none yet)"}`,
    `Things to avoid: ${strategy?.ai_avoid || "(none yet)"}`,
  ].join("\n");

  const examples = [...(posts ?? []).map((p) => `- ${p.caption}`), ...(stories ?? []).map((s) => `- ${s.notes}`)].join(
    "\n",
  );

  return [
    "BRAND IDENTITY",
    identity,
    "",
    "EXAMPLES OF HOW THIS BRAND WRITES (real captions/notes from this project -- match this vocabulary, sentence length, emoji use, and CTA style)",
    examples || "(no existing content yet -- write from the brand identity above)",
  ].join("\n");
}
