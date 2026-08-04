import Anthropic from "@anthropic-ai/sdk";

export type AiResult = { text: string } | { error: string };

const NOT_CONFIGURED: AiResult = {
  error: "AI analysis isn't configured yet — set ANTHROPIC_API_KEY to enable this.",
};

export async function generateText(prompt: string): Promise<AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NOT_CONFIGURED;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return { text: textBlock && "text" in textBlock ? textBlock.text : "" };
}

export async function analyzeDocument(
  prompt: string,
  fileBase64: string,
  mediaType: string,
): Promise<AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NOT_CONFIGURED;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
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
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return { text: textBlock && "text" in textBlock ? textBlock.text : "" };
}
