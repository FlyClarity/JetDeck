import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { verifyStripeWebhook } from "@/lib/stripe";

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
