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
// committed to that slot — "accepted" bookings, and other
// "pending_confirmation" requests still waiting on a decision, so two
// near-simultaneous requests for the same aircraft/dates both correctly see
// each other rather than only ever checking against fully-resolved
// bookings. The actual overlap matching is shared with the live in-builder
// check (see findConflictingBooking) — it compares each booking's full away
// window (first leg to last leg), not just exact leg dates, so a multi-day
// trip's middle days still register as a conflict even with no shared leg
// date.
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
      aircraftId: quote.aircraftId,
      status: { in: ["accepted", "pending_confirmation"] },
      ...(quote.id ? { id: { not: quote.id } } : {}),
    },
  });

  const conflict = findConflictingBooking(quote.aircraftId, quote.itinerary, others, quote.id);
  if (!conflict) return null;
  const label =
    conflict.startDate === conflict.endDate
      ? formatIsoDate(conflict.startDate)
      : `${formatIsoDate(conflict.startDate)} – ${formatIsoDate(conflict.endDate)}`;
  return `Also booked on this aircraft ${label} via quote ${conflict.booking.quoteNumber}.`;
}

// Runs the full "this booking is definitely happening" pipeline: Trip
// record, aircraft positioning update, Stripe card hold, and the client's
// real confirmation email (wire instructions + card hold link). Shared by
// the client's direct accept (no conflict found) and the operator's manual
// Confirm Booking action (conflict was found, operator resolved it).
export async function finalizeBooking(quoteId: string) {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { operator: true, tripRequest: true },
  });

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
  const allLegs = (quote.itinerary as { arrAirport?: string | null }[]) ?? [];
  const lastArrAirport = allLegs[allLegs.length - 1]?.arrAirport;
  if (quote.aircraftId && lastArrAirport) {
    await prisma.aircraft.update({
      where: { id: quote.aircraftId },
      data: { currentBase: lastArrAirport },
    });
  }

  const appUrl = await getAppUrl();
  let cardHoldUrl: string | null = null;
  if (quote.depositAmount && quote.depositAmount > 0) {
    const session = await createCardHoldCheckoutSession({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      depositAmount: quote.depositAmount,
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
  const revenueLegs = revenueLegsOf(quote.itinerary);
  const routingHtml = revenueLegs
    .map((leg) => `${leg.depAirport} → ${leg.arrAirport} — ${legDate(leg)}, ${legTimeLabel(leg)}`)
    .join("<br/>");

  const { route, date } = routeAndDateText(quote.itinerary);

  if (requestorEmail) {
    await sendEmail({
      to: requestorEmail,
      subject: `Your Charter Agreement — ${route} on ${date}`,
      html: `
        <p>Hi ${requestorName},</p>
        <p>Thank you for booking with ${quote.operator.name}. Your charter agreement is confirmed.</p>
        <p><strong>Reference:</strong> ${quote.quoteNumber}</p>
        <p><strong>Routing:</strong><br/>${routingHtml}</p>
        <p><strong>Total:</strong> ${formatCurrency(quote.total)}${
          quote.depositAmount ? `<br/><strong>Deposit due:</strong> ${formatCurrency(quote.depositAmount)}` : ""
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
      html: `<p>${requestorName} is confirmed on quote ${quote.quoteNumber} (${formatCurrency(quote.total)}).</p>`,
      replyTo: requestorEmail,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }
}

// Shared by both places a pending_confirmation booking gets resolved: the
// quote detail page and the Needs Review inbox (the operator's already
// emailed a direct link when the conflict is found, so both surfaces just
// need to trigger the same outcome). Each does its own operator-scoped
// lookup rather than trusting a quote object handed in, since callers come
// from different page contexts with different scoping already done.
export async function confirmPendingBookingForOperator(operatorId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, operatorId },
  });
  if (!quote || quote.status !== "pending_confirmation") return false;

  // The client already legally accepted (terms/IP/timestamp recorded when
  // they clicked) — this just runs the same finalize pipeline their
  // acceptance would have triggered automatically if there'd been no
  // conflict: Trip creation, positioning update, Stripe hold, and the real
  // confirmation email with wire instructions.
  await finalizeBooking(quote.id);
  return true;
}

export async function declinePendingBookingForOperator(
  operatorId: string,
  quoteId: string,
  note: string
) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, operatorId },
    include: { operator: true, tripRequest: true },
  });
  if (!quote || quote.status !== "pending_confirmation") return false;
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
