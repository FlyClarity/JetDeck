import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { verifyStripeWebhook } from "@/lib/stripe";
import { sendBookingConfirmationEmail } from "@/lib/booking-server";

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
    }
    const quoteId = session.metadata?.quoteId;
    if (quoteId) {
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

  return new Response("OK", { status: 200 });
}
