import Anthropic from "@anthropic-ai/sdk";
import { failure, safeAiCall, type AiResult } from "./result-safety";

export type { AiResult } from "./result-safety";

// Whether an AI provider is configured at all. Callers that do expensive
// preparation before an AI call (e.g. downloading a document) check this
// first; every function below also checks it itself.
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Every function here returns an AiResult and never throws: provider errors,
// truncated/refused/empty responses and a missing configuration all come back
// as { error, reason } with customer-safe wording (see result-safety.ts), and
// nothing is sent anywhere when the key is missing.

export async function generateText(prompt: string): Promise<AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return failure("not_configured");

  const client = new Anthropic({ apiKey });
  return safeAiCall("generateText", () =>
    client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    }),
  );
}

// Same shape as generateText/analyzeDocument, but for real vision input --
// one image content block per reference photo, ahead of the text prompt.
// Used by Brief's "Generate Design" to let Claude actually see Reference/
// Brand Moodboard images (design language, composition, color, mood) rather
// than guessing from labels alone.
export async function generateWithImages(
  prompt: string,
  images: { base64: string; mediaType: string }[],
): Promise<AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return failure("not_configured");

  const client = new Anthropic({ apiKey });
  return safeAiCall("generateWithImages", () =>
    client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg", data: img.base64 },
            })),
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  );
}

// Every JSON-shaped AI action (overview.ts's brand section/insights/spectrum
// generators, and brand-writer.ts) asks the model for "ONLY a JSON object,
// no other text" but still has to tolerate it wrapping that in prose or
// markdown fences -- this is the one shared "find the {...} block and parse
// it" implementation instead of another copy-pasted try/catch.
export function parseAiJson<T>(text: string): T | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : text) as T;
  } catch {
    return null;
  }
}

export async function analyzeDocument(
  prompt: string,
  fileBase64: string,
  mediaType: string,
): Promise<AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return failure("not_configured");

  const client = new Anthropic({ apiKey });
  return safeAiCall("analyzeDocument", () =>
    client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: mediaType as "application/pdf", data: fileBase64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  );
}
