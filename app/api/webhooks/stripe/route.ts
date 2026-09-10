import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { verifyStripeWebhook } from "@/lib/stripe";
import { sendBookingConfirmationEmail, confirmAchPayment } from "@/lib/booking-server";

const STATUS_BY_EVENT: Record<string, string> = {
  "payment_intent.amount_capturable_updated": "authorized",
  "payment_intent.canceled": "released",
  "payment_intent.succeeded": "captured",
};

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  const event = verifyStripeWebhook(body, signature);
  if (!event) return new Response("Invalid signature", { status: 400 });

  // The Checkout Session's PaymentIntent isn't reliably known at session-
  // creation time (see lib/stripe.ts) — createCardHoldCheckoutSession stores
  // the Checkout Session id as a placeholder for stripePaymentIntentId in
  // that case. Once the customer completes checkout, this event carries the
  // real PaymentIntent id — upgrade the stored value so subsequent
  // payment_intent.* events below match correctly.
  //
  // This is also the trigger for the client's confirmation email (moved out
  // of finalizeBooking — see lib/booking-server.ts) — "checkout completed"
  // is the definitive, customer-driven signal that the hold actually went
  // through, rather than emailing a link and hoping. Looked up via
  // session.metadata.quoteId directly rather than stripePaymentIntentId,
  // since payment_intent.* events for the same booking could in principle
  // arrive before this id-upgrade lands.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (paymentIntentId) {
      await prisma.quote.updateMany({
        where: { stripePaymentIntentId: session.id },
        data: { stripePaymentIntentId: paymentIntentId },
      });
      // Same session-id-as-placeholder upgrade, but for the ACH payment's
      // separate PaymentIntent — a no-op updateMany for every session that
      // isn't an ACH one (matches zero rows).
      await prisma.quote.updateMany({
        where: { achPaymentIntentId: session.id },
        data: { achPaymentIntentId: paymentIntentId },
      });
    }
    const quoteId = session.metadata?.quoteId;
    if (quoteId) {
      // Idempotent (guarded by confirmationEmailSentAt) — this event fires
      // for the ACH session completing too, which for an ACH payer happens
      // after the card-hold session already triggered this once.
      await sendBookingConfirmationEmail(quoteId);
    }
  }

  const cardHoldStatus = STATUS_BY_EVENT[event.type];
  if (cardHoldStatus) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await prisma.quote.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: { cardHoldStatus },
    });
  }

  // ACH-specific lifecycle — a real direct debit, not an authorize-then-
  // capture hold, so it gets its own event handling distinct from
  // STATUS_BY_EVENT above (which only ever matches on stripePaymentIntentId,
  // the card hold's PaymentIntent, never achPaymentIntentId).
  if (event.type === "payment_intent.processing") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await prisma.quote.updateMany({
      where: { achPaymentIntentId: paymentIntent.id },
      data: { achPaymentStatus: "processing" },
    });
  }
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await confirmAchPayment(paymentIntent.id);
  }
  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await prisma.quote.updateMany({
      where: { achPaymentIntentId: paymentIntent.id },
      data: { achPaymentStatus: "failed" },
    });
  }

  // Connect: fired whenever a connected account's status changes, including
  // when Express onboarding finishes. charges_enabled is what actually
  // gates whether we route a card hold to this operator's own account
  // (see Operator.stripeChargesEnabled) — Operator.stripeAccountId alone
  // only means onboarding was started, not completed.
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    await prisma.operator.updateMany({
      where: { stripeAccountId: account.id },
      data: { stripeChargesEnabled: account.charges_enabled ?? false },
    });
  }

  return new Response("OK", { status: 200 });
}
