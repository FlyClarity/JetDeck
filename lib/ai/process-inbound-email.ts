import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { classifyEmail, type EmailClassificationResult } from "@/lib/ai/classify-email";
import { parseEmailToTripRequest } from "@/lib/ai/parse-email";

type InboundEmailWithOperator = Prisma.InboundEmailGetPayload<{
  include: { operator: true };
}>;

export async function processInboundEmail(inboundEmailId: string) {
  const inboundEmail = await prisma.inboundEmail.findUnique({
    where: { id: inboundEmailId },
    include: { operator: true },
  });
  if (!inboundEmail) return;

  const result = await classifyEmail({
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
      await handleGeneralInquiry(inboundEmail, result);
      return;

    case "new_trip_request":
      await handleNewTripRequest(inboundEmail);
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

async function handleGeneralInquiry(
  inboundEmail: InboundEmailWithOperator,
  result: EmailClassificationResult
) {
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
    const displayName = result.senderName ?? inboundEmail.fromName ?? inboundEmail.fromEmail;
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

async function handleNewTripRequest(inboundEmail: InboundEmailWithOperator) {
  const extracted = await parseEmailToTripRequest(inboundEmail.bodyText);

  if (!extracted) {
    await prisma.inboundEmail.update({
      where: { id: inboundEmail.id },
      data: { status: "needs_review" },
    });
    return;
  }

  const tripRequest = await prisma.tripRequest.create({
    data: {
      operatorId: inboundEmail.operatorId,
      source: "email_inbound",
      rawEmailBody: inboundEmail.bodyText,
      rawEmailFrom: inboundEmail.fromEmail,
      requestorName:
        extracted.requestorName || inboundEmail.fromName || inboundEmail.fromEmail,
      requestorEmail: extracted.requestorEmail || inboundEmail.fromEmail,
      requestorPhone: extracted.requestorPhone,
      requestorCompany: extracted.requestorCompany,
      requestorType: extracted.requestorType || "direct",
      tripType: extracted.tripType || "one_way",
      legs: extracted.legs,
      aircraftPref: extracted.aircraftCategory,
      budgetMentioned: extracted.budgetMentioned,
      specialRequests: extracted.specialRequests,
      urgency: extracted.urgency,
    },
  });

  await prisma.inboundEmail.update({
    where: { id: inboundEmail.id },
    data: { status: "trip_request_created", tripRequestId: tripRequest.id },
  });
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
