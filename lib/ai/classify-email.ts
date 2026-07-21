import Anthropic from "@anthropic-ai/sdk";

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

Return ONLY valid JSON. No other text.`;

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
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${CLASSIFICATION_PROMPT}\n\nFrom: ${email.fromName ?? ""} <${email.fromEmail}>\nSubject: ${email.subject ?? ""}\n\n${email.bodyText}`,
      },
    ],
  });

  const text = message.content.find((block) => block.type === "text")?.text ?? "{}";

  try {
    const parsed = JSON.parse(text);
    const classification = EMAIL_CLASSIFICATIONS.includes(parsed.classification)
      ? (parsed.classification as EmailClassificationType)
      : "unclassifiable";

    return {
      classification,
      confidence: ["high", "medium", "low"].includes(parsed.confidence)
        ? parsed.confidence
        : "low",
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      quoteNumber: parsed.quoteNumber ?? null,
      senderEmail: parsed.senderEmail ?? email.fromEmail,
      senderName: parsed.senderName ?? email.fromName ?? null,
    };
  } catch {
    return {
      classification: "unclassifiable",
      confidence: "low",
      reason: "Failed to parse AI classification response",
      quoteNumber: null,
      senderEmail: email.fromEmail,
      senderName: email.fromName ?? null,
    };
  }
}
