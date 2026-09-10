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
// Phase 1 (see Module 5 of the build brief).
//
// session.payment_intent is NOT reliably populated at session-creation time
// on current Stripe API versions (confirmed against a live test session —
// it came back null despite the session itself being created successfully)
// — the PaymentIntent only exists once the customer actually reaches
// checkout. Gating on it being present here used to silently discard a
// perfectly good checkout URL and fall back to "our team will follow up."
// Falls back to the Checkout Session id (a real, stable identifier that
// exists immediately) when the PaymentIntent isn't known yet; the webhook's
// checkout.session.completed handler (see app/api/webhooks/stripe/route.ts)
// upgrades the stored id to the real PaymentIntent id once checkout
// completes, so later payment_intent.* events match correctly.
// Passing a connectedAccountId routes the hold to that operator's own
// Stripe Connect account (a "destination charge" — the PaymentIntent is
// still created on the platform account, funds transfer to the connected
// account) rather than JetDeck's own balance. Omitted/null falls back to a
// plain platform-account charge — used for an operator who hasn't finished
// Stripe Connect onboarding yet (see stripeChargesEnabled on Operator).
export async function createCardHoldCheckoutSession(params: {
  quoteId: string;
  quoteNumber: string;
  // The actual dollar amount to hold — the plain payment-for-flight amount
  // for a wire payer (this hold is just a backup), or that amount plus the
  // operator's CC processing fee surcharge for a credit-card payer (this
  // hold IS the payment). Computed by the caller — see finalizeBooking.
  holdAmount: number;
  appUrl: string;
  token: string;
  connectedAccountId?: string | null;
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
      ...(params.connectedAccountId
        ? {
            on_behalf_of: params.connectedAccountId,
            transfer_data: { destination: params.connectedAccountId },
          }
        : {}),
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Card hold — ${params.quoteNumber}` },
          unit_amount: Math.round(params.holdAmount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${params.appUrl}/q/${params.token}?hold=1`,
    cancel_url: `${params.appUrl}/q/${params.token}`,
    metadata: { quoteId: params.quoteId },
  });

  if (!session.url) return null;

  const paymentIntentId =
    (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) ??
    session.id;

  return { url: session.url, paymentIntentId };
}

// The ACH payment itself — a separate Checkout Session/PaymentIntent from
// the card hold above. ACH can't do manual-capture the way the hold does
// (it's already a multi-day settlement process once submitted), so this is
// a plain automatic-capture payment: Stripe moves it through
// processing -> succeeded (or payment_failed) on its own, reported via
// webhook (see app/api/webhooks/stripe/route.ts). No CC processing fee
// surcharge — that only ever applies to an actual credit-card payment.
export async function createAchPaymentCheckoutSession(params: {
  quoteId: string;
  quoteNumber: string;
  amount: number;
  appUrl: string;
  token: string;
  connectedAccountId?: string | null;
}): Promise<{ url: string; paymentIntentId: string } | null> {
  if (!stripe) {
    console.warn("STRIPE_SECRET_KEY not set — skipping ACH payment checkout session");
    return null;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["us_bank_account"],
    payment_intent_data: {
      metadata: { quoteId: params.quoteId },
      ...(params.connectedAccountId
        ? {
            on_behalf_of: params.connectedAccountId,
            transfer_data: { destination: params.connectedAccountId },
          }
        : {}),
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `ACH payment — ${params.quoteNumber}` },
          unit_amount: Math.round(params.amount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${params.appUrl}/q/${params.token}`,
    cancel_url: `${params.appUrl}/q/${params.token}`,
    metadata: { quoteId: params.quoteId },
  });

  if (!session.url) return null;

  const paymentIntentId =
    (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) ??
    session.id;

  return { url: session.url, paymentIntentId };
}

// Releases a manual-capture hold without ever charging it — used when a
// wire payer's payment actually shows up, so the backup card hold placed at
// signing no longer needs to sit there. Stripe rejects cancelling a
// PaymentIntent that's already been captured or canceled; treated as
// already-resolved rather than a hard failure, since either way the hold
// isn't sitting open anymore by the time this is called.
export async function cancelCardHold(paymentIntentId: string): Promise<boolean> {
  if (!stripe) return false;
  try {
    await stripe.paymentIntents.cancel(paymentIntentId);
    return true;
  } catch (err) {
    console.error(`Failed to cancel card hold ${paymentIntentId}`, err);
    return false;
  }
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

// Creates the operator's connected Express account the first time they
// start onboarding — a lightweight shell Stripe fills in via the hosted
// onboarding flow (createConnectAccountLink). Safe to call once per
// operator; the resulting id is stored on Operator.stripeAccountId so
// later calls just reuse it and jump straight to a fresh Account Link.
export async function createConnectedAccount(operator: {
  name: string;
  email?: string | null;
}): Promise<string | null> {
  if (!stripe) {
    console.warn("STRIPE_SECRET_KEY not set — cannot create Stripe Connect account");
    return null;
  }
  try {
    const account = await stripe.accounts.create({
      type: "express",
      business_type: "company",
      business_profile: { name: operator.name },
      email: operator.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
        us_bank_account_ach_payments: { requested: true },
      },
    });
    return account.id;
  } catch (err) {
    // Most likely cause of a failure here: the platform's own Stripe
    // account isn't approved for Connect in the mode (test/live) the
    // current STRIPE_SECRET_KEY belongs to — Stripe requires a separate
    // Connect platform application/review per mode. Logged rather than
    // thrown so a misconfiguration surfaces as "couldn't connect, try
    // again" on the Settings page instead of crashing it outright.
    console.error("Failed to create Stripe Connect account", err);
    return null;
  }
}

// Stripe's hosted onboarding flow — the operator fills in business/bank
// details on Stripe's own pages, never JetDeck's. Account Links are
// single-use and expire quickly, so this is generated fresh on every
// "Connect Stripe" / "Finish onboarding" click rather than stored.
// refreshUrl is where Stripe sends the operator back if the link itself
// expired before they used it (should just re-trigger this same flow);
// returnUrl is where they land after finishing (or leaving) onboarding —
// completion itself is confirmed separately via the account.updated
// webhook, not by reaching this URL.
export async function createConnectOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<string | null> {
  if (!stripe) return null;
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return accountLink.url;
  } catch (err) {
    console.error(`Failed to create Connect onboarding link for account ${accountId}`, err);
    return null;
  }
}

// A one-time link into the operator's own Stripe Express Dashboard (their
// payout history, balance, bank account) — Stripe-hosted, not something
// JetDeck builds a view for.
export async function createConnectDashboardLoginLink(accountId: string): Promise<string | null> {
  if (!stripe) return null;
  const loginLink = await stripe.accounts.createLoginLink(accountId);
  return loginLink.url;
}
