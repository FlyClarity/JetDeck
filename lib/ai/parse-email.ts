import { extractJson } from "@/lib/ai/extract-json";
import { anthropic } from "@/lib/ai/anthropic-client";

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
Extract trip details from this inbound email and return ONLY valid JSON —
no markdown code fences, no commentary before or after. If a field cannot
be determined, use null.

Charter request emails are often terse shorthand, e.g. "9/10 1000L KSNA -
KTEB" means a leg on Sept 10, departing 10:00 AM local, from KSNA to KTEB.
Emails also commonly end with a sender's signature block and unrelated
legal/travel-advisory boilerplate (e.g. REAL ID notices) — extract trip
details from the body only and ignore that trailing boilerplate; it does
not affect the legs, dates, or passenger count.

The subject line is part of the request, not just a label — brokers
often put the route, date, and trip type in the subject (e.g. "NEED: OW
10/15 KSNA KPDX") and leave only secondary details like pax count or
time in the body. Always read both together: if an airport, date, or
route only appears in the subject, still extract it into the legs.

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
      "date": string, // "YYYY-MM-DD"
      "timePref": string | null, // 24-hour "HH:MM" if a specific time is stated or implied, e.g. "1000L" -> "10:00", "2pm" -> "14:00"; else null
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
  subject: string | null | undefined,
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
        content: `${EXTRACTION_PROMPT}\n\nSubject: ${subject ?? ""}\n\n${bodyText}`,
      },
    ],
  });

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";
  const parsed = extractJson<Record<string, unknown>>(text);

  if (!parsed) {
    console.error(
      "Failed to parse AI extraction response:",
      text.slice(0, 500)
    );
    return null;
  }

  return {
    requestorName: (parsed.requestorName as string) ?? null,
    requestorCompany: (parsed.requestorCompany as string) ?? null,
    requestorEmail: (parsed.requestorEmail as string) ?? null,
    requestorPhone: (parsed.requestorPhone as string) ?? null,
    requestorType: (parsed.requestorType as ExtractedTripData["requestorType"]) ?? null,
    tripType: (parsed.tripType as ExtractedTripData["tripType"]) ?? null,
    legs: Array.isArray(parsed.legs) ? (parsed.legs as ExtractedLeg[]) : [],
    aircraftCategory: (parsed.aircraftCategory as ExtractedTripData["aircraftCategory"]) ?? null,
    budgetMentioned: (parsed.budgetMentioned as number) ?? null,
    specialRequests: (parsed.specialRequests as string) ?? null,
    urgency: (parsed.urgency as ExtractedTripData["urgency"]) ?? null,
    rawNeedsSummary: (parsed.rawNeedsSummary as string) ?? "",
  };
}
