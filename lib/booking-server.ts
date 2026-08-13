import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/quote";
import { getAppUrl } from "@/lib/url";
import { generateTripNumber } from "@/lib/trip-server";
import { createCardHoldCheckoutSession } from "@/lib/stripe";
import {
  revenueLegsOf,
  legDate,
  legTimeLabel,
  routeAndDateText,
  findConflictingBooking,
  formatIsoDate,
} from "@/lib/itinerary";

// Same-aircraft, overlapping-away-window conflicts against anything already
// committed to that slot — "accepted" bookings, "approved" ones still
// awaiting the client's signature (the operator already said yes, so that
// slot is effectively spoken for), and "pending_confirmation" requests
// still waiting on a decision — so two near-simultaneous requests for the
// same aircraft/dates all correctly see each other rather than only ever
// checking against fully-resolved bookings. The actual overlap matching is
// shared with the live in-builder check (see findConflictingBooking) — it
// compares each booking's full away window (first leg to last leg), not
// just exact leg dates, so a multi-day trip's middle days still register as
// a conflict even with no shared leg date.
export async function findBookingConflict(quote: {
  // Omitted for a not-yet-created quote (e.g. checking availability before
  // creating an internal trip directly) — nothing to exclude in that case.
  id?: string;
  aircraftId: string | null;
  itinerary: unknown;
}): Promise<string | null> {
  if (!quote.aircraftId) return null;

  const others = await prisma.quote.findMany({
    where: {
      selectedOption: { aircraftId: quote.aircraftId },
      status: { in: ["accepted", "approved", "pending_confirmation"] },
      ...(quote.id ? { id: { not: quote.id } } : {}),
    },
    include: { selectedOption: true },
  });

  const candidates = others
    .filter((o): o is typeof o & { selectedOption: NonNullable<(typeof o)["selectedOption"]> } =>
      Boolean(o.selectedOption)
    )
    .map((o) => ({
      id: o.id,
      quoteNumber: o.quoteNumber,
      aircraftId: o.selectedOption.aircraftId,
      itinerary: o.selectedOption.itinerary,
    }));

  const conflict = findConflictingBooking(quote.aircraftId, quote.itinerary, candidates, quote.id);
  if (!conflict) return null;
  const label =
    conflict.startDate === conflict.endDate
      ? formatIsoDate(conflict.startDate)
      : `${formatIsoDate(conflict.startDate)} – ${formatIsoDate(conflict.endDate)}`;
  return `Also booked on this aircraft ${label} via quote ${conflict.booking.quoteNumber}.`;
}

// Runs the full "this booking is definitely happening" pipeline: Trip
// record, aircraft positioning update, Stripe card hold, and the client's
// real confirmation email (wire instructions + card hold link). Only ever
// called once the client has actually signed (the "I Accept — Book This
// Charter" step, which only appears after the operator has approved their
// Request to Book) — see acceptQuote in app/q/[token]/page.tsx.
export async function finalizeBooking(quoteId: string) {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { operator: true, tripRequest: true, selectedOption: true },
  });
  if (!quote.selectedOption) throw new Error(`Quote ${quoteId} has no selectedOption`);
  const option = quote.selectedOption;

  const tripNumber = await generateTripNumber(quote.operatorId);
  await prisma.trip.create({
    data: {
      operatorId: quote.operatorId,
      tripNumber,
      quoteId: quote.id,
      status: "awaiting_payment",
    },
  });

  // Positioning tracking: the aircraft ends this trip wherever its last
  // itinerary leg lands, whether that's the trip's actual destination or
  // (when "returns to home base" is on) the trailing repositioning leg back
  // home. Only own-fleet aircraft have a currentBase to update.
  const allLegs = (option.itinerary as { arrAirport?: string | null }[]) ?? [];
  const lastArrAirport = allLegs[allLegs.length - 1]?.arrAirport;
  if (option.aircraftId && lastArrAirport) {
    await prisma.aircraft.update({
      where: { id: option.aircraftId },
      data: { currentBase: lastArrAirport },
    });
  }

  const appUrl = await getAppUrl();
  let cardHoldUrl: string | null = null;
  if (option.depositAmount && option.depositAmount > 0) {
    const session = await createCardHoldCheckoutSession({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      depositAmount: option.depositAmount,
      appUrl,
      token: quote.token,
    });
    if (session) {
      cardHoldUrl = session.url;
      await prisma.quote.update({
        where: { id: quote.id },
        data: { stripePaymentIntentId: session.paymentIntentId, cardHoldStatus: "pending" },
      });
    }
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "accepted" },
  });

  const requestorEmail = quote.tripRequest?.requestorEmail;
  const requestorName = quote.tripRequest?.requestorName ?? "there";
  const revenueLegs = revenueLegsOf(option.itinerary);
  const routingHtml = revenueLegs
    .map((leg) => `${leg.depAirport} → ${leg.arrAirport} — ${legDate(leg)}, ${legTimeLabel(leg)}`)
    .join("<br/>");

  const { route, date } = routeAndDateText(option.itinerary);

  if (requestorEmail) {
    await sendEmail({
      to: requestorEmail,
      subject: `Your Charter Agreement — ${route} on ${date}`,
      html: `
        <p>Hi ${requestorName},</p>
        <p>Thank you for booking with ${quote.operator.name}. Your charter agreement is confirmed.</p>
        <p><strong>Reference:</strong> ${quote.quoteNumber}</p>
        <p><strong>Routing:</strong><br/>${routingHtml}</p>
        <p><strong>Total:</strong> ${formatCurrency(option.total)}${
          option.depositAmount ? `<br/><strong>Deposit due:</strong> ${formatCurrency(option.depositAmount)}` : ""
        }</p>
        ${quote.operator.wireInstructions ? `<p><strong>Wire instructions:</strong><br/>${quote.operator.wireInstructions.replace(/\n/g, "<br/>")}</p>` : ""}
        ${
          cardHoldUrl
            ? `<p><strong>Card hold:</strong> please authorize your deposit hold now — no charge is made, this only places a hold: <a href="${cardHoldUrl}">${cardHoldUrl}</a></p>`
            : `<p>Our team will follow up shortly with a secure card authorization link for your deposit hold.</p>`
        }
        ${
          quote.operator.termsText
            ? `<p><strong>Charter terms you agreed to:</strong></p><p style="white-space:pre-wrap">${quote.operator.termsText}</p>`
            : ""
        }
        <p>— ${quote.operator.name}</p>
      `,
      replyTo: quote.operator.replyToEmail ?? undefined,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }

  if (quote.operator.notifyEmail) {
    await sendEmail({
      to: quote.operator.notifyEmail,
      subject: `Quote ${quote.quoteNumber} confirmed!`,
      html: `<p>${requestorName} is confirmed on quote ${quote.quoteNumber} (${formatCurrency(option.total)}).</p>`,
      replyTo: requestorEmail,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }
}

// The Stripe Checkout Session created in finalizeBooking expires after 24h
// (Stripe's default) — if the client doesn't click through in time, the
// original link in their confirmation email goes dead with no way back in.
// This regenerates a fresh session for the same deposit and re-sends it,
// rather than requiring the operator to re-run the whole booking pipeline.
export async function resendCardHoldLink(operatorId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, operatorId },
    include: { operator: true, tripRequest: true, selectedOption: true },
  });
  if (!quote || quote.status !== "accepted") return false;
  if (!quote.selectedOption?.depositAmount || quote.selectedOption.depositAmount <= 0) return false;

  const appUrl = await getAppUrl();
  const session = await createCardHoldCheckoutSession({
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    depositAmount: quote.selectedOption.depositAmount,
    appUrl,
    token: quote.token,
  });
  if (!session) return false;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { stripePaymentIntentId: session.paymentIntentId, cardHoldStatus: "pending" },
  });

  const requestorEmail = quote.tripRequest?.requestorEmail;
  if (requestorEmail) {
    await sendEmail({
      to: requestorEmail,
      subject: `New card hold link — ${quote.quoteNumber}`,
      html: `<p>Hi ${quote.tripRequest?.requestorName ?? "there"},</p><p>Your previous card authorization link expired. Please use this new link to authorize your deposit hold — no charge is made, this only places a hold: <a href="${session.url}">${session.url}</a></p><p>— ${quote.operator.name}</p>`,
      replyTo: quote.operator.replyToEmail ?? undefined,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }

  return true;
}

// Shared by both places a pending_confirmation request gets resolved: the
// quote detail page and the Needs Review inbox. Each does its own
// operator-scoped lookup rather than trusting a quote object handed in,
// since callers come from different page contexts with different scoping
// already done.
//
// The client only ever clicked a non-binding "Request to Book" to get here
// — no terms shown, no signature, nothing legally committed yet — so
// confirming availability doesn't finalize anything by itself. It moves the
// quote to "approved" and emails the client a link back to /q/[token],
// where they now see the real "I Accept — Book This Charter" terms/
// signature step for the first time.
export async function confirmPendingBookingForOperator(operatorId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, operatorId },
    include: { operator: true, tripRequest: true },
  });
  if (!quote || quote.status !== "pending_confirmation") return false;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "approved", approvedAt: new Date() },
  });

  const requestorEmail = quote.tripRequest?.requestorEmail;
  if (requestorEmail) {
    const appUrl = await getAppUrl();
    await sendEmail({
      to: requestorEmail,
      subject: `Good news — ${quote.quoteNumber} is available!`,
      html: `<p>Hi ${quote.tripRequest?.requestorName ?? "there"},</p><p>We can confirm ${quote.operator.name} has your aircraft available for this trip. Please finalize your booking — review the charter terms and authorize your deposit hold: <a href="${appUrl}/q/${quote.token}">${appUrl}/q/${quote.token}</a></p><p>— ${quote.operator.name}</p>`,
      replyTo: quote.operator.replyToEmail ?? undefined,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }
  return true;
}

// Declining is valid from either side of the "approved" step — before it
// (operator reviewing the initial request) or after (operator or
// circumstances change before the client comes back to sign).
export async function declinePendingBookingForOperator(
  operatorId: string,
  quoteId: string,
  note: string
) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, operatorId },
    include: { operator: true, tripRequest: true },
  });
  if (!quote || !["pending_confirmation", "approved"].includes(quote.status)) return false;
  if (!note.trim()) return false;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "declined", declinedAt: new Date() },
  });

  if (quote.tripRequest?.requestorEmail) {
    await sendEmail({
      to: quote.tripRequest.requestorEmail,
      subject: `Unable to confirm — ${quote.quoteNumber}`,
      html: `<p>Hi ${quote.tripRequest.requestorName},</p><p>We're sorry — we're unable to confirm your booking (${quote.quoteNumber}): ${note}</p><p>Please contact us so we can help find another solution.</p><p>— ${quote.operator.name}</p>`,
      replyTo: quote.operator.replyToEmail ?? undefined,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }
  return true;
}
