import Anthropic from "@anthropic-ai/sdk";
import { CounterOfferResult } from "./negotiation";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

export function aiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Optionally rewrite the deterministic rationale/talking points in a more
 * natural, brand-appropriate voice using Claude. Falls back to the
 * deterministic text untouched when no API key is configured (default in
 * dev/test), so the app is fully usable and testable offline.
 */
export async function polishNegotiationCopy(
  result: CounterOfferResult,
  context: { creatorName: string; brandName: string; platform: string; contentType: string }
): Promise<CounterOfferResult> {
  const c = getClient();
  if (!c) return result;

  try {
    const msg = await c.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are a friendly but firm brand-deal negotiation coach for a content creator named ${context.creatorName}. A brand called ${context.brandName} made an offer for a ${context.contentType} on ${context.platform}. Rewrite the following rationale and talking points to sound natural and confident, in second person addressed to the creator. Keep all dollar figures exactly as given — do not change any numbers. Respond as JSON with keys "rationale" and "talkingPoints" (array of strings), nothing else.\n\nRationale: ${result.rationale}\n\nTalking points: ${JSON.stringify(result.talkingPoints)}`,
        },
      ],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(extractJson(text));
    if (parsed.rationale && Array.isArray(parsed.talkingPoints)) {
      return { ...result, rationale: parsed.rationale, talkingPoints: parsed.talkingPoints };
    }
    return result;
  } catch {
    // Any failure (network, parsing, rate limit) — silently fall back to the
    // deterministic copy rather than breaking the negotiation flow.
    return result;
  }
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json found");
  return text.slice(start, end + 1);
}

