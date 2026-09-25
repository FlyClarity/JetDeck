import { extractJson } from "@/lib/ai/extract-json";
import { anthropic } from "@/lib/ai/anthropic-client";

export type PriceSuggestion = {
  suggestedPrice: number;
};

export async function suggestPrice(input: {
  routeSummary: string;
  flightHours: number | null;
  aircraftHourlyRate: number;
  positioningNote: string | null;
  historyNote: string | null;
}): Promise<PriceSuggestion | null> {
  if (!anthropic) {
    console.warn("ANTHROPIC_API_KEY not set — skipping AI price suggestion");
    return null;
  }

  const prompt = `You are a pricing assistant for a Part 135 charter operator.
Suggest a total quote price (in USD) for this trip, considering the
aircraft's hourly rate, positioning, and any quoting history provided.
Return ONLY valid JSON in this shape, no markdown code fences, no other
text, no explanation:

{ "suggestedPrice": number }

Route: ${input.routeSummary}
Estimated flight hours: ${input.flightHours ?? "unknown"}
Aircraft hourly rate: $${input.aircraftHourlyRate}/hr
Positioning: ${input.positioningNote ?? "none noted"}
History: ${input.historyNote ?? "no prior history with this broker/route"}`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 64,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    // A rejected promise here isn't just a missing suggestion — this page's
    // Suspense boundary doesn't catch it, so an unhandled rejection (rate
    // limit, out of credits, network error) fails the whole Create Quote
    // page load instead of just leaving the price field blank.
    console.error("AI price suggestion request failed:", err);
    return null;
  }

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";
  const parsed = extractJson<Record<string, unknown>>(text);

  if (!parsed || typeof parsed.suggestedPrice !== "number") {
    console.error("Failed to parse AI price suggestion:", text.slice(0, 500));
    return null;
  }

  return { suggestedPrice: parsed.suggestedPrice };
}
