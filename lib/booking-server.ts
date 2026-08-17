import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/quote";
import { getAppUrl } from "@/lib/url";
import { generateTripNumber } from "@/lib/trip-server";
import { createCardHoldCheckoutSession, cancelCardHold } from "@/lib/stripe";
import { createManifestForTrip } from "@/lib/manifest";
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

// Sends the client's "you're confirmed" email (routing, wire instructions,
// terms) plus the operator's notification. Split out of finalizeBooking so
// it can fire from two different places: immediately, when there's no card
// hold to wait for (no deposit, or Stripe not configured), or later from
// the checkout.session.completed webhook once the client actually
// authorizes their hold — see app/api/webhooks/stripe/route.ts. The email
// itself never includes a Stripe link either way: by the time it sends, the
// hold is either already authorized or was never going to happen through
// Stripe at all.
//
// Guarded by confirmationEmailSentAt against double-sending — Stripe
// webhooks redeliver on retry, and re-sending a full "you're confirmed"
// email (with wire instructions) to a client a second time would be a bad
// look, not just a minor annoyance.
export async function sendBookingConfirmationEmail(quoteId: string) {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { operator: true, tripRequest: true, selectedOption: true, contact: true },
  });
  if (quote.confirmationEmailSentAt || !quote.selectedOption) return;
  const option = quote.selectedOption;
  const waivesCardHold = quote.contact?.paymentTerms === "cash_on_account";

  const requestorEmail = quote.tripRequest?.requestorEmail;
  const requestorName = quote.tripRequest?.requestorName ?? "there";
  const revenueLegs = revenueLegsOf(option.itinerary);
  const routingHtml = revenueLegs
    .map((leg) => `${leg.depAirport} → ${leg.arrAirport} — ${legDate(leg)}, ${legTimeLabel(leg)}`)
    .join("<br/>");

  const { route, date } = routeAndDateText(option.itinerary);
  // What the client actually read and signed at send/accept time, not
  // whatever the operator's Settings page currently holds — same reasoning
  // as acceptedTermsHash in app/q/[token]/page.tsx.
  const termsTextAtSend = quote.termsTextSnapshot ?? quote.operator.termsText;

  // stripePaymentIntentId is only ever set once a real Checkout Session was
  // created — its presence means a card hold genuinely went through
  // Stripe's flow (this email only fires after checkout completes, or
  // never had one to begin with), distinct from "there's a payment due but
  // Stripe isn't configured," which still needs the old manual-follow-up
  // copy. A cash-on-account client (Contacts page) never gets a card hold
  // at all, regardless of the quote's payment amount — billed separately.
  const paymentLine = !option.depositAmount
    ? ""
    : waivesCardHold
      ? `<br/><strong>Payment for your flight:</strong> ${formatCurrency(option.depositAmount)} — billed on account`
      : quote.stripePaymentIntentId
        ? quote.paymentMethod === "wire"
          ? `<br/><strong>Payment for your flight:</strong> ${formatCurrency(option.depositAmount)} — pay via wire (instructions below). A credit card hold of ${formatCurrency(quote.cardHoldAmount ?? option.depositAmount)} is authorized as backup security.`
          : quote.paymentMethod === "credit_card"
            ? `<br/><strong>Payment for your flight:</strong> ${formatCurrency(quote.cardHoldAmount ?? option.depositAmount)} — charged to your card (includes card processing fee)`
            : `<br/><strong>Payment for your flight:</strong> ${formatCurrency(quote.cardHoldAmount ?? option.depositAmount)} — card hold authorized`
        : `<br/><strong>Payment due:</strong> ${formatCurrency(option.depositAmount)}`;
  const followUpLine =
    option.depositAmount && !quote.stripePaymentIntentId && !waivesCardHold
      ? `<p>Our team will follow up shortly with a secure card authorization link.</p>`
      : "";

  if (requestorEmail) {
    await sendEmail({
      to: requestorEmail,
      subject: `Your Charter Agreement — ${route} on ${date}`,
      html: `
        <p>Hi ${requestorName},</p>
        <p>Thank you for booking with ${quote.operator.name}. Your charter agreement is confirmed.</p>
        <p><strong>Reference:</strong> ${quote.quoteNumber}</p>
        <p><strong>Routing:</strong><br/>${routingHtml}</p>
        <p><strong>Total:</strong> ${formatCurrency(option.total)}${paymentLine}</p>
        ${quote.operator.wireInstructions && (waivesCardHold || quote.paymentMethod === "wire") ? `<p><strong>Wire instructions:</strong><br/>${quote.operator.wireInstructions.replace(/\n/g, "<br/>")}</p>` : ""}
        ${followUpLine}
        ${
          termsTextAtSend
            ? `<p><strong>Charter terms you agreed to:</strong></p><p style="white-space:pre-wrap">${termsTextAtSend}</p>`
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

  await prisma.quote.update({
    where: { id: quote.id },
    data: { confirmationEmailSentAt: new Date() },
  });
}

// Runs the full "this booking is definitely happening" pipeline: Trip
// record, aircraft positioning update, and (when a deposit is due) a Stripe
// card hold Checkout Session. Only ever called once the client has actually
// signed (the "I Accept — Book This Charter" step, which only appears
// after the operator has approved their Request to Book) — see acceptQuote
// in app/q/[token]/page.tsx, which redirects the browser straight into the
// returned cardHoldUrl in the same session rather than emailing it — an
// emailed link is an easy thing to ignore, and signing without immediately
// authorizing the hold left too many bookings stuck half-done.
//
// The confirmation email is deliberately NOT sent here when a checkout
// session was created — it waits for the client to actually complete
// checkout (checkout.session.completed webhook) so it always reflects a
// real authorized hold rather than promising one that might never happen
// if they abandon the Stripe tab. Only sent immediately here when there's
// nothing to wait for (no deposit due, or Stripe isn't configured).
export async function finalizeBooking(quoteId: string): Promise<{ cardHoldUrl: string | null }> {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { operator: true, tripRequest: true, selectedOption: true, contact: true },
  });
  if (!quote.selectedOption) throw new Error(`Quote ${quoteId} has no selectedOption`);
  const option = quote.selectedOption;

  // A trusted client marked cash-on-account (Contacts page) skips the card
  // hold requirement entirely, same as if no deposit were due — they're
  // invoiced/settled outside JetDeck instead.
  const waivesCardHold = quote.contact?.paymentTerms === "cash_on_account";

  const tripNumber = await generateTripNumber(quote.operatorId);
  const trip = await prisma.trip.create({
    data: {
      operatorId: quote.operatorId,
      tripNumber,
      quoteId: quote.id,
      status: waivesCardHold ? "confirmed" : "awaiting_payment",
    },
  });

  // Sales→ops handoff: kick off passenger manifest collection immediately
  // rather than waiting on a crew-assignment step that doesn't exist yet
  // (see lib/manifest.ts) — starting collection as early as possible only
  // helps. Best-effort: a failure here (e.g. email provider down) shouldn't
  // break booking finalization, which is already in progress by this point.
  try {
    await createManifestForTrip(trip.id);
  } catch (err) {
    console.error(`Failed to create manifest for trip ${trip.id}`, err);
  }

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
  if (!waivesCardHold && option.depositAmount && option.depositAmount > 0) {
    // A card hold is authorized either way (unless cash-on-account, above)
    // — the difference is what it's for. Paying by wire, the hold is just a
    // backup for the plain flight-payment amount; paying by credit card,
    // the hold IS the payment, so the operator's CC processing fee surcharge
    // gets added on top. Snapshotted onto the quote so later displays/emails
    // stay accurate even if the operator's fee % changes afterward.
    const holdAmount =
      quote.paymentMethod === "credit_card"
        ? option.depositAmount * (1 + quote.operator.ccProcessingFeePercent / 100)
        : option.depositAmount;
    const session = await createCardHoldCheckoutSession({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      holdAmount,
      appUrl,
      token: quote.token,
      // Falls back to a plain platform-account charge when the operator
      // hasn't finished Stripe Connect onboarding yet — additive, not a
      // hard gate, so an operator who hasn't connected Stripe still gets a
      // working (if not yet properly routed) card hold rather than nothing.
      connectedAccountId: quote.operator.stripeChargesEnabled ? quote.operator.stripeAccountId : null,
    });
    if (session) {
      cardHoldUrl = session.url;
      await prisma.quote.update({
        where: { id: quote.id },
        data: {
          stripePaymentIntentId: session.paymentIntentId,
          cardHoldStatus: "pending",
          cardHoldAmount: holdAmount,
        },
      });
    }
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "accepted" },
  });

  if (!cardHoldUrl) {
    await sendBookingConfirmationEmail(quote.id);
  }

  return { cardHoldUrl };
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

  // Reuse whatever amount was actually communicated originally (includes the
  // CC processing fee if that's what they picked) rather than recomputing —
  // a quote from before this field existed falls back to the plain amount.
  const holdAmount = quote.cardHoldAmount ?? quote.selectedOption.depositAmount;

  const appUrl = await getAppUrl();
  const session = await createCardHoldCheckoutSession({
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    holdAmount,
    appUrl,
    token: quote.token,
    connectedAccountId: quote.operator.stripeChargesEnabled ? quote.operator.stripeAccountId : null,
  });
  if (!session) return false;

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      stripePaymentIntentId: session.paymentIntentId,
      cardHoldStatus: "pending",
      cardHoldAmount: holdAmount,
    },
  });

  const requestorEmail = quote.tripRequest?.requestorEmail;
  if (requestorEmail) {
    await sendEmail({
      to: requestorEmail,
      subject: `New card hold link — ${quote.quoteNumber}`,
      html: `<p>Hi ${quote.tripRequest?.requestorName ?? "there"},</p><p>Your previous card authorization link expired. Please use this new link to authorize your card hold — no charge is made, this only places a hold: <a href="${session.url}">Authorize Card Hold</a></p><p>— ${quote.operator.name}</p>`,
      replyTo: quote.operator.replyToEmail ?? undefined,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }

  return true;
}

// Called by the operator (a "Mark Wire Received" button on the quote detail
// page) once a wire payment actually shows up in their account — JetDeck has
// no bank feed to detect this automatically. Only meaningful for a wire
// payer: their card hold was always just backup security, not the payment
// itself, so once the real payment is in hand the hold can be released and
// the Trip can move to "confirmed" for dispatch/ops purposes. A credit-card
// payer's hold already IS the payment — nothing to do here for them.
export async function markWireReceived(operatorId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, operatorId },
    include: { trip: true },
  });
  if (!quote || quote.status !== "accepted") return false;
  if (quote.paymentMethod !== "wire" || quote.wireConfirmedAt) return false;

  if (quote.stripePaymentIntentId && quote.cardHoldStatus && !["captured", "released"].includes(quote.cardHoldStatus)) {
    const released = await cancelCardHold(quote.stripePaymentIntentId);
    if (released) {
      await prisma.quote.update({ where: { id: quote.id }, data: { cardHoldStatus: "released" } });
    }
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: { wireConfirmedAt: new Date() },
  });

  if (quote.trip) {
    await prisma.trip.update({ where: { id: quote.trip.id }, data: { status: "confirmed" } });
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
      html: `<p>Hi ${quote.tripRequest?.requestorName ?? "there"},</p><p>We can confirm ${quote.operator.name} has your aircraft available for this trip. Please finalize your booking — review the charter terms and complete payment: <a href="${appUrl}/q/${quote.token}">Finalize Your Booking</a></p><p>— ${quote.operator.name}</p>`,
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
