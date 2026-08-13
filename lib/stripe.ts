import Stripe from "stripe";

// Constructed defensively, not just gated on presence — same reasoning as
// lib/email.ts and lib/ai/anthropic-client.ts. A malformed STRIPE_SECRET_KEY
// throwing inside the SDK's own construction would, for module-scope code,
// happen at import time — taking down every route that imports this during
// Next.js's build-time page-data collection.
function buildClient(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    return new Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.error("Failed to construct Stripe client — check STRIPE_SECRET_KEY", err);
    return null;
  }
}

const stripe = buildClient();

// Card hold = a Checkout Session whose resulting PaymentIntent uses manual
// capture. Stripe authorizes the card for the deposit amount but takes no
// money — actual capture (or release) happens later, outside JetDeck in
// Phase 1 (see Module 5 of the build brief). Checkout mode "payment" creates
// the PaymentIntent eagerly, so its ID is available immediately rather than
// only after the client completes checkout.
export async function createCardHoldCheckoutSession(params: {
  quoteId: string;
  quoteNumber: string;
  depositAmount: number;
  appUrl: string;
  token: string;
}): Promise<{ url: string; paymentIntentId: string } | null> {
  if (!stripe) {
    console.warn("STRIPE_SECRET_KEY not set — skipping card hold checkout session");
    return null;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_intent_data: {
      capture_method: "manual",
      metadata: { quoteId: params.quoteId },
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Booking deposit hold — ${params.quoteNumber}` },
          unit_amount: Math.round(params.depositAmount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${params.appUrl}/q/${params.token}?hold=1`,
    cancel_url: `${params.appUrl}/q/${params.token}`,
    metadata: { quoteId: params.quoteId },
  });

  if (!session.url || !session.payment_intent) return null;

  return {
    url: session.url,
    paymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id,
  };
}

export function verifyStripeWebhook(body: string, signature: string): Stripe.Event | null {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn("Stripe not configured — rejecting webhook");
    return null;
  }
  try {
    return stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return null;
  }
}
