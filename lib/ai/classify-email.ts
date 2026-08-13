import { extractJson } from "@/lib/ai/extract-json";
import type { ExtractedLeg, ExtractedTripData } from "@/lib/ai/parse-email";
import { anthropic } from "@/lib/ai/anthropic-client";

export const EMAIL_CLASSIFICATIONS = [
  "new_trip_request",
  "quote_response_accepted",
  "quote_response_questions",
  "quote_response_declined",
  "general_inquiry",
  "spam_or_auto_reply",
  "unclassifiable",
] as const;

export type EmailClassificationType = (typeof EMAIL_CLASSIFICATIONS)[number];

// The model occasionally drifts from the exact enum string (e.g.
// "trip_request" instead of "new_trip_request") despite the prompt
// spelling it out — normalize common near-misses instead of silently
// dropping a correctly-reasoned classification to unclassifiable.
const CLASSIFICATION_SYNONYMS: Record<string, EmailClassificationType> = {
  trip_request: "new_trip_request",
  new_request: "new_trip_request",
  quote_request: "new_trip_request",
  request_quote: "new_trip_request",
  new_quote_request: "new_trip_request",
  availability_request: "new_trip_request",
  charter_request: "new_trip_request",
  new_charter_request: "new_trip_request",
  quote_accepted: "quote_response_accepted",
  quote_declined: "quote_response_declined",
  quote_questions: "quote_response_questions",
  inquiry: "general_inquiry",
  spam: "spam_or_auto_reply",
  auto_reply: "spam_or_auto_reply",
};

function normalizeClassification(raw: unknown): EmailClassificationType {
  if (typeof raw !== "string") return "unclassifiable";

  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (EMAIL_CLASSIFICATIONS.includes(normalized as EmailClassificationType)) {
    return normalized as EmailClassificationType;
  }
  return CLASSIFICATION_SYNONYMS[normalized] ?? "unclassifiable";
}

export type EmailClassificationResult = {
  classification: EmailClassificationType;
  confidence: "high" | "medium" | "low";
  reason: string;
  quoteNumber: string | null;
  senderEmail: string;
  senderName: string | null;
  // Populated only when classification is "new_trip_request" — extracted
  // in the same call instead of a separate follow-up request. See the
  // module comment below for why.
  extraction: ExtractedTripData | null;
};

// Classification and extraction used to be two separate Anthropic calls:
// classify the email, then (if it was a trip request) make a second call
// to pull out the trip details — re-sending the whole email body again and
// paying for a second copy of the instructional prompt. Since
// classification already requires reading the full email, extracting the
// trip fields "for free" in the same pass cuts AI calls roughly in half
// for the common case (a real cost driver, not just latency). Every field
// and behavior from the two original prompts is preserved here — see the
// commit that introduced this for the two-call version if this needs to
// be split apart again.
function buildTriagePrompt(todayIso: string) {
  return `You are a triage assistant for a private jet charter company reading inbound email.

Today's date is ${todayIso}.

First, classify this email into exactly one of these categories:
new_trip_request, quote_response_accepted, quote_response_questions,
quote_response_declined, general_inquiry, spam_or_auto_reply, unclassifiable.

new_trip_request: the sender wants a charter quote or aircraft availability
for a trip, however it's phrased. Charter brokers write these in dense
industry shorthand, not full sentences — treat these as strong
new_trip_request signals even with no other context:
- Subject or body starting with "NEED:", "LOOKING FOR:", "AVAIL?", or
  "QUOTE:" followed by trip shorthand (broker slang for "I need
  availability/pricing for this trip"). These markers are case-insensitive
  and brokers are inconsistent about it in practice — "need:", "Need:",
  "NEED:", and "Need :" (extra space before the colon) are all the exact
  same signal. Never let casing alone push this toward unclassifiable.
- Terse leg notation like "9/10 1000L KSNA-KTEB" (date, 24hr local time,
  dep-arr airports) or "RT"/"OW" for round-trip/one-way
- A bare "pax" count with no other explanation (e.g. "8 pax")
Example: an email reading only "NEED: RT 9/10-15 KSNA KTEB" with a body of
"8 pax / 9/10 1000L KSNA - KTEB / 9/15 1000L KTEB - KSNA" plus a signature
block is a new_trip_request, not unclassifiable — brokers omit
pleasantries like "please quote me" because the shorthand already implies
it. The exact same email with a lowercase "need: rt 9/10-15 ksna kteb"
subject is identical in meaning and must classify the same way.

Watch for the mirror-image case: broker blast feeds also carry "HAVE:"
listings — another operator advertising empty-leg aircraft *availability*,
using the exact same shorthand style (route, date, aircraft type) as a
NEED: request. A HAVE: listing is NOT a new_trip_request — nobody is
asking for a quote, there's nothing to extract. If the subject or body
opens with "HAVE:" (in any casing — "have:", "Have:", "HAVE:" are the
same marker) or is clearly an aircraft-for-sale/available posting rather
than a request, classify it as unclassifiable instead.

Reserve unclassifiable for emails you genuinely cannot place in any other
category (e.g. no discernible trip details, quote reference, or intent at
all) — don't use it just because an email is terse or informally
formatted.

Second, only if the classification is new_trip_request, also extract the
trip's details into the "extraction" field below. For every other
classification, "extraction" must be null — don't extract from an email
that isn't a trip request. When extracting:
- Charter request emails are often terse shorthand, e.g. "9/10 1000L
  KSNA - KTEB" means a leg on Sept 10, departing 10:00 AM local, from
  KSNA to KTEB.
- Emails also commonly end with a sender's signature block and unrelated
  legal/travel-advisory boilerplate (e.g. REAL ID notices) — extract
  trip details from the body only and ignore that trailing boilerplate;
  it does not affect the legs, dates, or passenger count.
- The subject line is part of the request, not just a label — brokers
  often put the route, date, and trip type in the subject (e.g. "NEED:
  OW 10/15 KSNA KPDX") and leave only secondary details like pax count
  or time in the body. Always read both together: if an airport, date,
  or route only appears in the subject, still extract it into the legs.
- Always give airports as 4-letter ICAO codes, not 3-letter IATA codes —
  e.g. write "KSAN", not "SAN", for San Diego. Convert if the email uses
  the IATA code (most continental-US ICAO codes are just "K" + the IATA
  code, e.g. IATA "ASE" -> ICAO "KASE", but this isn't universal — use
  the airport's real ICAO code, not a guessed prefix, if you know it
  differs).
- Dates are frequently given without a year (e.g. "9/10", "Aug 17",
  "Sept 10th"). When no year is stated, infer the year so the resulting
  date is the next upcoming occurrence on or after today's date given
  above: if that month/day has already passed this year, use next year,
  not this year and never a past year. Only use an explicitly stated
  year as-is.

Return ONLY valid JSON, no markdown code fences, no other text, in
exactly this shape and field order:

{
  "reason": string, // explain in one sentence what the email is actually asking for — work this out BEFORE picking a classification below, and make sure the classification you choose matches what you just wrote here
  "classification": "new_trip_request" | "quote_response_accepted" | "quote_response_questions" | "quote_response_declined" | "general_inquiry" | "spam_or_auto_reply" | "unclassifiable",
  "confidence": "high" | "medium" | "low",
  "quoteNumber": string | null, // an existing quote number this email references (e.g. Q-2024-0042), else null
  "senderEmail": string, // the From address
  "senderName": string | null, // the sender name if identifiable, else null
  "extraction": null | {
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
  }
}`;
}

function normalizeExtraction(raw: unknown): ExtractedTripData | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as Record<string, unknown>;

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

export async function classifyAndExtractEmail(email: {
  fromEmail: string;
  fromName?: string | null;
  subject?: string | null;
  bodyText: string;
}): Promise<EmailClassificationResult> {
  if (!anthropic) {
    console.warn(
      "ANTHROPIC_API_KEY not set — cannot classify email, flagging for manual review"
    );
    return {
      classification: "unclassifiable",
      confidence: "low",
      reason: "ANTHROPIC_API_KEY not configured",
      quoteNumber: null,
      senderEmail: email.fromEmail,
      senderName: email.fromName ?? null,
      extraction: null,
    };
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `${buildTriagePrompt(todayIso)}\n\nFrom: ${email.fromName ?? ""} <${email.fromEmail}>\nSubject: ${email.subject ?? ""}\n\n${email.bodyText}`,
        },
      ],
    });
  } catch (err) {
    console.error("AI classification request failed:", err);
    return {
      classification: "unclassifiable",
      confidence: "low",
      reason: "AI request failed — see server logs",
      quoteNumber: null,
      senderEmail: email.fromEmail,
      senderName: email.fromName ?? null,
      extraction: null,
    };
  }

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";
  const parsed = extractJson<Record<string, unknown>>(text);

  if (!parsed) {
    console.error(
      "Failed to parse AI triage response:",
      text.slice(0, 500)
    );
    return {
      classification: "unclassifiable",
      confidence: "low",
      reason: "Failed to parse AI triage response",
      quoteNumber: null,
      senderEmail: email.fromEmail,
      senderName: email.fromName ?? null,
      extraction: null,
    };
  }

  const classification = normalizeClassification(parsed.classification);
  if (classification === "unclassifiable" && parsed.classification !== "unclassifiable") {
    console.warn(
      "Unrecognized classification value from AI, defaulting to unclassifiable:",
      parsed.classification
    );
  }

  return {
    classification,
    confidence: ["high", "medium", "low"].includes(parsed.confidence as string)
      ? (parsed.confidence as "high" | "medium" | "low")
      : "low",
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    quoteNumber: (parsed.quoteNumber as string) ?? null,
    senderEmail: (parsed.senderEmail as string) ?? email.fromEmail,
    senderName: (parsed.senderName as string) ?? email.fromName ?? null,
    extraction: classification === "new_trip_request" ? normalizeExtraction(parsed.extraction) : null,
  };
}
