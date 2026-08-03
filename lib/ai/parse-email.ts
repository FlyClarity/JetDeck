import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export type ExtractedLeg = {
  depAirport: string;
  arrAirport: string;
  date: string;
  timePref: string | null;
  timeFlexible: boolean;
  passengerCount: number | null;
};

export type ExtractedTripData = {
  requestorName: string | null;
  requestorCompany: string | null;
  requestorEmail: string | null;
  requestorPhone: string | null;
  requestorType: "broker" | "direct" | null;
  tripType: "one_way" | "round_trip" | "multi_leg" | null;
  legs: ExtractedLeg[];
  aircraftCategory:
    | "light"
    | "midsize"
    | "super_midsize"
    | "heavy"
    | "ultra_long"
    | null;
  budgetMentioned: number | null;
  specialRequests: string | null;
  urgency: "asap" | "normal" | "flexible" | null;
  rawNeedsSummary: string;
};

const EXTRACTION_PROMPT = `You are a flight operations assistant for a Part 135 charter operator.
Extract the following from this broker email and return ONLY valid JSON.
If a field cannot be determined, use null.

{
  "requestorName": string | null,
  "requestorCompany": string | null,
  "requestorEmail": string | null,
  "requestorPhone": string | null,
  "requestorType": "broker" | "direct" | null,
  "tripType": "one_way" | "round_trip" | "multi_leg" | null,
  "legs": [
    {
      "depAirport": string,
      "arrAirport": string,
      "date": string,
      "timePref": string | null,
      "timeFlexible": boolean,
      "passengerCount": number | null
    }
  ],
  "aircraftCategory": "light" | "midsize" | "super_midsize" | "heavy" | "ultra_long" | null,
  "budgetMentioned": number | null,
  "specialRequests": string | null,
  "urgency": "asap" | "normal" | "flexible" | null,
  "rawNeedsSummary": string
}`;

export async function parseEmailToTripRequest(
  bodyText: string
): Promise<ExtractedTripData | null> {
  if (!anthropic) {
    console.warn("ANTHROPIC_API_KEY not set — cannot extract trip data from email");
    return null;
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\n${bodyText}`,
      },
    ],
  });

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";

  try {
    const parsed = JSON.parse(text);
    return {
      requestorName: parsed.requestorName ?? null,
      requestorCompany: parsed.requestorCompany ?? null,
      requestorEmail: parsed.requestorEmail ?? null,
      requestorPhone: parsed.requestorPhone ?? null,
      requestorType: parsed.requestorType ?? null,
      tripType: parsed.tripType ?? null,
      legs: Array.isArray(parsed.legs) ? parsed.legs : [],
      aircraftCategory: parsed.aircraftCategory ?? null,
      budgetMentioned: parsed.budgetMentioned ?? null,
      specialRequests: parsed.specialRequests ?? null,
      urgency: parsed.urgency ?? null,
      rawNeedsSummary: parsed.rawNeedsSummary ?? "",
    };
  } catch {
    console.error("Failed to parse AI extraction response");
    return null;
  }
}
