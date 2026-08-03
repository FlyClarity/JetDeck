import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export type PriceSuggestion = {
  suggestedPrice: number;
  reasoning: string;
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
Suggest a total quote price (in USD) for this trip and briefly explain your
reasoning in one or two sentences. Consider the aircraft's hourly rate,
positioning, and any quoting history provided. Return ONLY valid JSON in
this shape, no other text:

{ "suggestedPrice": number, "reasoning": string }

Route: ${input.routeSummary}
Estimated flight hours: ${input.flightHours ?? "unknown"}
Aircraft hourly rate: $${input.aircraftHourlyRate}/hr
Positioning: ${input.positioningNote ?? "none noted"}
History: ${input.historyNote ?? "no prior history with this broker/route"}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.suggestedPrice !== "number") return null;
    return {
      suggestedPrice: parsed.suggestedPrice,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}
