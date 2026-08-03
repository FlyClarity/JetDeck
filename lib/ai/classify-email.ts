import Anthropic from "@anthropic-ai/sdk";
import { extractJson } from "@/lib/ai/extract-json";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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
};

const CLASSIFICATION_PROMPT = `You are an email triage assistant for a private jet charter company.
Classify this inbound email into exactly one of these categories:
new_trip_request, quote_response_accepted, quote_response_questions,
quote_response_declined, general_inquiry, spam_or_auto_reply, unclassifiable.

new_trip_request: the sender wants a charter quote or aircraft availability
for a trip, however it's phrased. Charter brokers write these in dense
industry shorthand, not full sentences — treat these as strong
new_trip_request signals even with no other context:
- Subject or body starting with "NEED:", "LOOKING FOR:", "AVAIL?", or
  "QUOTE:" followed by trip shorthand (broker slang for "I need
  availability/pricing for this trip")
- Terse leg notation like "9/10 1000L KSNA-KTEB" (date, 24hr local time,
  dep-arr airports) or "RT"/"OW" for round-trip/one-way
- A bare "pax" count with no other explanation (e.g. "8 pax")
Example: an email reading only "NEED: RT 9/10-15 KSNA KTEB" with a body of
"8 pax / 9/10 1000L KSNA - KTEB / 9/15 1000L KTEB - KSNA" plus a signature
block is a new_trip_request, not unclassifiable — brokers omit
pleasantries like "please quote me" because the shorthand already implies
it.

Reserve unclassifiable for emails you genuinely cannot place in any other
category (e.g. no discernible trip details, quote reference, or intent at
all) — don't use it just because an email is terse or informally
formatted.

Also return:
- confidence: "high" | "medium" | "low"
- reason: one sentence explaining your classification
- quoteNumber: extract if this email references an existing quote number (e.g. Q-2024-0042), else null
- senderEmail: the From address
- senderName: the sender name if identifiable, else null

Return ONLY valid JSON. No markdown code fences, no other text.`;

export async function classifyEmail(email: {
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
    };
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${CLASSIFICATION_PROMPT}\n\nFrom: ${email.fromName ?? ""} <${email.fromEmail}>\nSubject: ${email.subject ?? ""}\n\n${email.bodyText}`,
      },
    ],
  });

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";
  const parsed = extractJson<Record<string, unknown>>(text);

  if (!parsed) {
    console.error(
      "Failed to parse AI classification response:",
      text.slice(0, 500)
    );
    return {
      classification: "unclassifiable",
      confidence: "low",
      reason: "Failed to parse AI classification response",
      quoteNumber: null,
      senderEmail: email.fromEmail,
      senderName: email.fromName ?? null,
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
  };
}
