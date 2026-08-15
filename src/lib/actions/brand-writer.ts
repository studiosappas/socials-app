"use server";

import { createClient } from "@/lib/supabase/server";
import { generateText, parseAiJson } from "@/lib/ai/client";
import { buildBrandWriterContext } from "@/lib/ai/brand-writer-context";

export type BrandWriterTurn = { request: string; text: string };
export type BrandWriterAlternative = { label: string; text: string };
export type BrandWriterResult = { alternatives: BrandWriterAlternative[] } | { error: string };

// Called directly from BrandWriterField (not a useActionState form action --
// this is a plain request/response round trip triggered by a button, same
// "async server action called imperatively" pattern as posts.ts's
// fetchPostForModal), for both the initial "describe what you need" request
// AND every follow-up ("make it shorter") -- the caller passes the running
// `history` and, once something is selected, `currentText` so refinements
// apply to that specific draft instead of restarting from scratch.
export async function generateBrandCopy(
  projectId: string,
  request: string,
  history: BrandWriterTurn[],
  currentText?: string,
): Promise<BrandWriterResult> {
  const supabase = await createClient();
  const context = await buildBrandWriterContext(supabase, projectId);

  const historyBlock = history.length
    ? [
        "CONVERSATION SO FAR (earlier requests and what was written in response, most recent last)",
        ...history.map((turn, i) => `${i + 1}. Asked: "${turn.request}"\n   Got: ${turn.text}`),
      ].join("\n")
    : "";

  const currentTextBlock = currentText ? `CURRENT DRAFT IN THE FIELD\n${currentText}` : "";

  const prompt = [
    "You are a brand copywriter embedded in a social media content planning tool. You already know this brand -- never ask the user to explain it.",
    context,
    historyBlock,
    currentTextBlock,
    `NEW REQUEST: "${request}"`,
    "Write copy that matches the brand's real vocabulary, tone, sentence length, emoji use, and CTA style from the examples above.",
    currentText
      ? "This is a refinement of the current draft -- apply the new request to it directly, don't start over unless asked to."
      : "Generate 3-4 distinct alternatives.",
    'Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape: {"alternatives":[{"label":"...","text":"..."}]}',
    currentText
      ? "Since this is a refinement, return exactly ONE alternative -- label it briefly (e.g. \"Revised\")."
      : 'Choose short, specific labels for each alternative that actually fit what was asked (e.g. tone names like "Playful" for a caption, or "Hook 1"/"Hook 2" for a request for hooks) -- don\'t force a fixed set of labels that don\'t fit the request.',
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateText(prompt);
  if ("error" in result) return { error: result.error };

  const parsed = parseAiJson<{ alternatives?: BrandWriterAlternative[] }>(result.text);
  if (!parsed?.alternatives?.length) {
    return { error: "Couldn't generate that -- try rephrasing your request." };
  }

  return { alternatives: parsed.alternatives };
}
