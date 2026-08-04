import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { classifyAndExtractEmail, type EmailClassificationResult } from "@/lib/ai/classify-email";
import { parseEmailToTripRequest, type ExtractedTripData } from "@/lib/ai/parse-email";
import { scoreOpportunity } from "@/lib/ai/score-opportunity";

export type InboundEmailWithOperator = Prisma.InboundEmailGetPayload<{
  include: { operator: true };
}>;

export async function processInboundEmail(inboundEmailId: string) {
  const inboundEmail = await prisma.inboundEmail.findUnique({
    where: { id: inboundEmailId },
    include: { operator: true },
  });
  if (!inboundEmail) return;

  const result = await classifyAndExtractEmail({
    fromEmail: inboundEmail.fromEmail,
    fromName: inboundEmail.fromName,
    subject: inboundEmail.subject,
    bodyText: inboundEmail.bodyText,
  });

  await prisma.inboundEmail.update({
    where: { id: inboundEmail.id },
    data: {
      classification: result.classification,
      classificationConfidence: result.confidence,
      classificationReason: result.reason,
      aiProcessedAt: new Date(),
    },
  });

  switch (result.classification) {
    case "spam_or_auto_reply":
      await prisma.inboundEmail.update({
        where: { id: inboundEmail.id },
        data: { status: "discarded" },
      });
      return;

    case "general_inquiry":
      await logInboundEmailAsInquiry(inboundEmail);
      return;

    case "new_trip_request":
      // Already extracted in the same call as classification above — pass
      // it straight through instead of re-extracting from scratch.
      await createTripRequestFromInboundEmail(inboundEmail, result.extraction);
      return;

    case "quote_response_accepted":
    case "quote_response_questions":
    case "quote_response_declined":
      await handleQuoteResponse(inboundEmail, result);
      return;

    case "unclassifiable":
    default:
      await prisma.inboundEmail.update({
        where: { id: inboundEmail.id },
        data: { status: "needs_review" },
      });
  }
}

/**
 * Matches/creates a Contact and logs the inquiry against it. Shared by the
 * automatic AI-routing path and the manual "Log as Inquiry" review action.
 */
export async function logInboundEmailAsInquiry(inboundEmail: InboundEmailWithOperator) {
  const existing = await prisma.contact.findFirst({
    where: { operatorId: inboundEmail.operatorId, email: inboundEmail.fromEmail },
  });

  const noteLine = `[${new Date().toISOString()}] General inquiry: ${inboundEmail.subject ?? "(no subject)"}`;

  if (existing) {
    await prisma.contact.update({
      where: { id: existing.id },
      data: { notes: existing.notes ? `${existing.notes}\n${noteLine}` : noteLine },
    });
  } else {
    const displayName = inboundEmail.fromName ?? inboundEmail.fromEmail;
    const [firstName, ...rest] = displayName.split(" ");
    await prisma.contact.create({
      data: {
        operatorId: inboundEmail.operatorId,
        firstName: firstName || "Unknown",
        lastName: rest.join(" "),
        email: inboundEmail.fromEmail,
        type: "direct",
        notes: noteLine,
      },
    });
  }

  await prisma.inboundEmail.update({
    where: { id: inboundEmail.id },
    data: { status: "logged_as_inquiry" },
  });

  if (inboundEmail.operator.notifyEmail) {
    await sendEmail({
      to: inboundEmail.operator.notifyEmail,
      subject: `General inquiry — ${inboundEmail.fromEmail}`,
      html: `<p>New general inquiry from ${inboundEmail.fromName ?? inboundEmail.fromEmail} (${inboundEmail.fromEmail}).</p><p>Subject: ${inboundEmail.subject ?? "(no subject)"}</p>`,
    });
  }
}

/**
 * Extracts trip data and creates + scores a TripRequest from an inbound
 * email. Shared by the automatic AI-routing path and the manual "Create
 * Trip Request" review action. Extraction runs when ANTHROPIC_API_KEY is
 * configured; when it's not (or parsing fails), this still creates a
 * bare-bones TripRequest from the raw email fields rather than failing —
 * a human explicitly asked for this one, so it should always produce
 * something to work with, even if AI couldn't fill in the details.
 *
 * `preExtracted` lets the automatic pipeline pass through the extraction
 * it already got as part of classification (see classifyAndExtractEmail)
 * instead of paying for a second AI call here. Omit it (as the manual
 * "Create Trip Request" review action does) to have this run extraction
 * itself.
 */
export async function createTripRequestFromInboundEmail(
  inboundEmail: InboundEmailWithOperator,
  preExtracted?: ExtractedTripData | null
) {
  const extracted =
    preExtracted !== undefined
      ? preExtracted
      : await parseEmailToTripRequest(inboundEmail.subject, inboundEmail.bodyText);

  const tripRequest = await prisma.tripRequest.create({
    data: {
      operatorId: inboundEmail.operatorId,
      source: "email_inbound",
      rawEmailBody: inboundEmail.bodyText,
      rawEmailFrom: inboundEmail.fromEmail,
      requestorName:
        extracted?.requestorName || inboundEmail.fromName || inboundEmail.fromEmail,
      requestorEmail: extracted?.requestorEmail || inboundEmail.fromEmail,
      requestorPhone: extracted?.requestorPhone ?? null,
      requestorCompany: extracted?.requestorCompany ?? null,
      requestorType: extracted?.requestorType || "direct",
      tripType: extracted?.tripType || "one_way",
      legs: extracted?.legs ?? [],
      aircraftPref: extracted?.aircraftCategory ?? null,
      budgetMentioned: extracted?.budgetMentioned ?? null,
      specialRequests: extracted?.specialRequests ?? inboundEmail.bodyText,
      urgency: extracted?.urgency ?? null,
    },
  });

  await prisma.inboundEmail.update({
    where: { id: inboundEmail.id },
    data: { status: "trip_request_created", tripRequestId: tripRequest.id },
  });

  await scoreOpportunity(tripRequest.id);

  return tripRequest;
}

async function handleQuoteResponse(
  inboundEmail: InboundEmailWithOperator,
  result: EmailClassificationResult
) {
  // Priority 1: explicit quote number in the email
  let quote = result.quoteNumber
    ? await prisma.quote.findFirst({
        where: { operatorId: inboundEmail.operatorId, quoteNumber: result.quoteNumber },
      })
    : null;

  // Priority 2: sender email matches the contact on a quote that's been sent
  if (!quote) {
    quote = await prisma.quote.findFirst({
      where: {
        operatorId: inboundEmail.operatorId,
        status: "sent",
        contact: { email: inboundEmail.fromEmail },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!quote) {
    await prisma.inboundEmail.update({
      where: { id: inboundEmail.id },
      data: { status: "needs_review" },
    });
    return;
  }

  if (result.classification === "quote_response_declined") {
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: "declined", declinedAt: new Date() },
    });
  }

  // "Accepted" needs the real click-to-accept record (timestamp, IP, terms hash —
  // Step 16). Auto-accepting off an email reply would skip that entirely, so this
  // flags it for a human instead of faking acceptance.
  const status =
    result.classification === "quote_response_accepted" ? "needs_review" : "attached_to_quote";

  await prisma.inboundEmail.update({
    where: { id: inboundEmail.id },
    data: { status, quoteId: quote.id },
  });

  if (inboundEmail.operator.notifyEmail) {
    const action = result.classification.replace("quote_response_", "");
    await sendEmail({
      to: inboundEmail.operator.notifyEmail,
      subject: `Quote ${quote.quoteNumber} — ${action}`,
      html: `<p>${inboundEmail.fromName ?? inboundEmail.fromEmail} replied to quote ${quote.quoteNumber} (${action}).</p>`,
    });
  }
}
