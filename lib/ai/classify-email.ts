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

  const classification = EMAIL_CLASSIFICATIONS.includes(
    parsed.classification as EmailClassificationType
  )
    ? (parsed.classification as EmailClassificationType)
    : "unclassifiable";

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
