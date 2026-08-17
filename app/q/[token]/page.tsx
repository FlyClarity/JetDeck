import { notFound, redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCurrency, allocateProportionally } from "@/lib/quote";
import { paxCount } from "@/lib/queue";
import { getAppUrl } from "@/lib/url";
import { findBookingConflict, finalizeBooking } from "@/lib/booking-server";
import { revenueLegsOf, legDate, legTimeLabel } from "@/lib/itinerary";
import { amenityLabel } from "@/lib/aircraft";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TermsAcceptGate } from "@/components/quote/terms-accept-gate";

async function getQuoteByToken(token: string) {
  return prisma.quote.findUnique({
    where: { token },
    include: {
      operator: true,
      tripRequest: true,
      contact: true,
      selectedOption: { include: { aircraft: true, brokeredAircraft: true } },
      options: {
        include: { aircraft: true, brokeredAircraft: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

// "Options" — a quote sent with more than one priced itinerary lets the
// client pick before requesting to book. Only meaningful while the quote is
// still "sent": once they've requested to book (or beyond), the choice is
// locked in and the rest of the flow proceeds against whichever option was
// selected, exactly as a single-option quote always has.
async function selectOption(token: string, optionId: string) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote || quote.status !== "sent") return;
  if (!quote.options.some((o) => o.id === optionId)) return;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { selectedOptionId: optionId },
  });

  redirect(`/q/${token}`);
}

// Step 1 of 2: a non-binding "I'd like to book this" click — no terms shown,
// no signature, nothing legally committed yet. Just tells the operator to
// go check availability. The conflict check still runs here so it's ready
// as advisory context the moment the operator looks at it, but it no
// longer branches the outcome — every request goes to pending_confirmation
// either way, since the operator review is now unconditional.
async function requestToBook(token: string) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote || quote.status !== "sent" || !quote.selectedOption) return;
  if (quote.validUntil < new Date()) return;

  const conflictWarning = await findBookingConflict({
    id: quote.id,
    aircraftId: quote.selectedOption.aircraftId,
    itinerary: quote.selectedOption.itinerary,
  });

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "pending_confirmation", requestedAt: new Date(), conflictWarning },
  });

  if (quote.operator.notifyEmail) {
    const appUrl = await getAppUrl();
    const requestorName = quote.tripRequest?.requestorName ?? "A client";
    await sendEmail({
      to: quote.operator.notifyEmail,
      subject: `New booking request — Quote ${quote.quoteNumber}`,
      html: `<p>${requestorName} requested to book quote ${quote.quoteNumber} (${formatCurrency(quote.selectedOption.total)}).</p>${
        conflictWarning
          ? `<p style="color:#b91c1c"><strong>⚠️ ${conflictWarning}</strong></p>`
          : ""
      }<p>Review and confirm or decline availability: <a href="${appUrl}/quotes/${quote.id}">${appUrl}/quotes/${quote.id}</a></p>`,
      replyTo: quote.tripRequest?.requestorEmail,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }

  redirect(`/q/${token}`);
}

// Step 2 of 2: the real legal acceptance — only reachable once the operator
// has approved the request (status "approved"). Records the clickwrap
// moment (terms agreement, deposit authorization — E-SIGN/UETA) and, unless
// a fresh conflict has appeared since approval (rare — something else got
// booked in the gap between the operator's approval and the client coming
// back to sign), finalizes the booking immediately.
async function acceptQuote(token: string, formData: FormData) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote || quote.status !== "approved" || !quote.selectedOption) return;
  if (quote.validUntil < new Date()) return;

  const acceptedByName = String(formData.get("acceptedByName") ?? "").trim() || null;
  if (!acceptedByName) return;

  const paymentMethodRaw = String(formData.get("paymentMethod") ?? "");
  const paymentMethod = paymentMethodRaw === "wire" || paymentMethodRaw === "credit_card" ? paymentMethodRaw : null;
  const waivesCardHold = quote.contact?.paymentTerms === "cash_on_account";
  const needsPaymentMethod = !waivesCardHold && !!quote.selectedOption.depositAmount && quote.selectedOption.depositAmount > 0;
  if (needsPaymentMethod && !paymentMethod) return;

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
  const userAgent = hdrs.get("user-agent");
  // Hash the snapshot taken when the quote was sent (what this client
  // actually read), not the operator's live, currently-editable termsText —
  // otherwise an edit in Settings between send and signature would silently
  // change what acceptedTermsHash claims they agreed to.
  const termsTextForHash = quote.termsTextSnapshot ?? quote.operator.termsText;
  const termsHash = termsTextForHash
    ? createHash("sha256").update(termsTextForHash).digest("hex")
    : null;
  const acceptedAt = new Date();

  const conflictWarning = await findBookingConflict({
    id: quote.id,
    aircraftId: quote.selectedOption.aircraftId,
    itinerary: quote.selectedOption.itinerary,
  });

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: conflictWarning ? "pending_confirmation" : "accepted",
      acceptedAt,
      acceptedByName,
      acceptedIp: ip,
      acceptedUserAgent: userAgent,
      acceptedTermsHash: termsHash,
      conflictWarning,
      paymentMethod,
    },
  });

  const requestorEmail = quote.tripRequest?.requestorEmail;
  const requestorName = quote.tripRequest?.requestorName ?? "there";

  if (conflictWarning) {
    const appUrl = await getAppUrl();

    if (requestorEmail) {
      await sendEmail({
        to: requestorEmail,
        subject: `Confirming availability — ${quote.quoteNumber}`,
        html: `<p>Hi ${requestorName},</p><p>Thanks for signing quote ${quote.quoteNumber} — we're re-confirming aircraft availability for your dates and will follow up shortly with final confirmation.</p><p>— ${quote.operator.name}</p>`,
        replyTo: quote.operator.replyToEmail ?? undefined,
        from: quote.operator.fromEmail,
        fromName: quote.operator.name,
      });
    }

    if (quote.operator.notifyEmail) {
      await sendEmail({
        to: quote.operator.notifyEmail,
        subject: `⚠️ Booking conflict — Quote ${quote.quoteNumber} needs your confirmation`,
        html: `<p>${acceptedByName} (${requestorName}) signed quote ${quote.quoteNumber} (${formatCurrency(quote.selectedOption.total)}), but a new conflict was found since you approved it:</p><p style="color:#b91c1c"><strong>⚠️ ${conflictWarning}</strong></p><p>Review and confirm or decline from the <a href="${appUrl}/quotes/${quote.id}">quote detail page</a> — nothing has been finalized with the client yet.</p>`,
        replyTo: requestorEmail,
        from: quote.operator.fromEmail,
        fromName: quote.operator.name,
      });
    }
  } else {
    const { cardHoldUrl } = await finalizeBooking(quote.id);
    // Redirect straight into Stripe Checkout in the same browser session
    // rather than emailing a link — an emailed link is easy to ignore, and
    // the client just finished signing anyway, so there's no reason to make
    // them go find it in their inbox. redirect() throws, so the fallback
    // below only runs when there's no checkout to send them to.
    if (cardHoldUrl) {
      redirect(cardHoldUrl);
    }
  }

  redirect(`/q/${token}`);
}

async function declineQuote(token: string) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote || !["sent", "approved"].includes(quote.status)) return;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "declined", declinedAt: new Date() },
  });

  if (quote.operator.notifyEmail) {
    await sendEmail({
      to: quote.operator.notifyEmail,
      subject: `Quote ${quote.quoteNumber} — declined`,
      html: `<p>${quote.tripRequest?.requestorName ?? "The client"} declined quote ${quote.quoteNumber}.</p>`,
      replyTo: quote.tripRequest?.requestorEmail,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }

  redirect(`/q/${token}`);
}

async function requestChanges(token: string, formData: FormData) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote) return;

  const message = String(formData.get("message") ?? "").trim();
  if (!message) return;

  if (quote.operator.notifyEmail) {
    await sendEmail({
      to: quote.operator.notifyEmail,
      subject: `Change request — Quote ${quote.quoteNumber}`,
      html: `<p>${quote.tripRequest?.requestorName ?? "The client"} (${quote.tripRequest?.requestorEmail ?? "no email"}) requested changes to quote ${quote.quoteNumber}:</p><p style="white-space:pre-wrap">${message}</p>`,
      replyTo: quote.tripRequest?.requestorEmail,
      from: quote.operator.fromEmail,
      fromName: quote.operator.name,
    });
  }

  redirect(`/q/${token}?requested=1`);
}

function aircraftLabelFor(o: {
  aircraft: { make: string; model: string; tailNumber: string } | null;
  brokeredAircraft: { make: string | null; model: string | null } | null;
}) {
  return o.aircraft
    ? `${o.aircraft.make} ${o.aircraft.model} (${o.aircraft.tailNumber})`
    : o.brokeredAircraft
      ? `${o.brokeredAircraft.make ?? ""} ${o.brokeredAircraft.model ?? ""}`.trim() ||
        "Aircraft to be confirmed"
      : "Aircraft to be confirmed";
}

export function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "muted" | "destructive";
}) {
  return (
    <div className="flex justify-between">
      <span className={emphasis === "muted" ? "text-muted-foreground" : ""}>{label}</span>
      <span className={emphasis === "destructive" ? "font-medium text-destructive" : ""}>{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold tracking-wide text-foreground/55 uppercase">
      {children}
    </h2>
  );
}

export default async function ClientQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ requested?: string }>;
}) {
  const { token } = await params;
  const { requested } = await searchParams;
  const quote = await getQuoteByToken(token);
  if (!quote || quote.status === "draft" || !quote.selectedOption) notFound();

  const operator = quote.operator;
  const tripRequest = quote.tripRequest;
  const option = quote.selectedOption;
  // Snapshotted at send time (see sendQuote) so an operator editing their
  // charter terms in Settings after this quote went out can't change what
  // this particular client sees or is recorded as having agreed to. Falls
  // back to the live text for quotes sent before this field existed.
  const termsText = quote.termsTextSnapshot ?? operator.termsText;
  const legs = revenueLegsOf(option.itinerary);
  const pax = tripRequest ? paxCount(tripRequest.legs) : null;

  // Client-facing page, no operator session — query Airport directly
  // (global reference data, not tenant-scoped) rather than going through
  // getAirportsByIcao, which requires an authenticated tenant context.
  const legAirportCodes = [
    ...new Set(legs.flatMap((l) => [l.depAirport, l.arrAirport]).filter((c): c is string => Boolean(c))),
  ];
  const legAirports = await prisma.airport.findMany({
    where: { icao: { in: legAirportCodes } },
    select: { icao: true, city: true, state: true },
  });
  const cityStateByIcao = Object.fromEntries(
    legAirports.map((a) => [
      a.icao,
      [a.city, a.state].filter(Boolean).join(", "),
    ])
  );

  // Client-facing pricing shows one fee per segment, not the internal cost
  // breakdown (hourly rate, repositioning, landing/handling fees, discount)
  // that produced it — those stay internal-only, visible on the operator's
  // quote detail page instead. Derived from total/fetTax rather than the
  // stored subtotal so it's always self-consistent with what's displayed
  // below, regardless of how subtotal was computed at save time.
  const preTaxSubtotal = option.total - option.fetTax;
  const segmentFees = allocateProportionally(
    legs.map((l) => l.flightHours ?? 0),
    preTaxSubtotal
  );

  // "expired" itself is a real stored status now (see the daily cron sweep,
  // lib/expire-stale.ts) for quotes whose flight date passed unconfirmed —
  // distinct from the existing validUntil-based check, which is about the
  // pricing offer's own shelf life. Folding the stored status into this
  // same flag means every downstream branch that already keys off
  // isExpired (the status pill, the action section, pendingDecision) picks
  // it up automatically with no separate branch needed.
  const isExpired =
    quote.status === "expired" ||
    (["sent", "approved"].includes(quote.status) && quote.validUntil < new Date());
  const pendingDecision = ["sent", "approved"].includes(quote.status) && !isExpired;
  const daysRemaining = Math.ceil(
    (quote.validUntil.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  const requestToBookWithToken = requestToBook.bind(null, token);
  const acceptQuoteWithToken = acceptQuote.bind(null, token);
  const declineQuoteWithToken = declineQuote.bind(null, token);
  const requestChangesWithToken = requestChanges.bind(null, token);

  const aircraftLabel = aircraftLabelFor(option);

  // Only relevant before the client has committed to anything — once
  // they've requested to book, the pick is locked in and the rest of the
  // flow (operator review, signature, Stripe) proceeds against whatever
  // was selected, same as a single-option quote always has.
  const showOptionPicker = quote.status === "sent" && !isExpired && quote.options.length > 1;

  // Shared by both decision-pending states ("sent", before requesting, and
  // "approved", before signing) — the client can back out or ask for
  // changes at either point.
  const requestChangesOrDecline = (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">Need changes, or can&apos;t book as-is?</summary>
      <form action={requestChangesWithToken} className="mt-3 flex flex-col gap-2">
        <Textarea
          name="message"
          rows={3}
          placeholder="Let us know what you'd like to change"
          required
        />
        <Button type="submit" variant="outline" size="sm" className="self-start">
          Send Request
        </Button>
      </form>
      <form action={declineQuoteWithToken} className="mt-3">
        <button
          type="submit"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-destructive"
        >
          Decline this quote
        </button>
      </form>
    </details>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto w-full max-w-xl px-6 py-16">
        <header className="flex items-center gap-3">
          {operator.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={operator.logoUrl} alt={operator.name} className="h-9 w-auto" />
          )}
          <span className="text-base font-semibold tracking-tight text-foreground/80">
            {operator.name}
          </span>
        </header>

        <div className="mt-6 rounded-2xl border border-border bg-background p-7 shadow-sm sm:p-9">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{quote.quoteNumber}</h1>
              <p className="mt-0.5 text-muted-foreground">
                Prepared for {tripRequest?.requestorName ?? "you"}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize text-muted-foreground">
              {isExpired
                ? "Expired"
                : quote.status === "pending_confirmation"
                  ? "Confirming availability"
                  : quote.status === "approved"
                    ? "Ready to finalize"
                    : quote.status}
            </span>
          </div>

          {showOptionPicker && (
            <section className="mt-7">
              <SectionHeading>Choose an option</SectionHeading>
              <div className="mt-3 flex flex-col gap-2">
                {quote.options.map((o) => {
                  const isSelected = o.id === option.id;
                  const optLegs = revenueLegsOf(o.itinerary);
                  const optRoute = optLegs.length
                    ? `${optLegs[0].depAirport} → ${optLegs[optLegs.length - 1].arrAirport}`
                    : "Route TBD";
                  return (
                    <form key={o.id} action={selectOption.bind(null, token, o.id)}>
                      <button
                        type="submit"
                        disabled={isSelected}
                        className={`w-full rounded-xl border p-4 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-accent/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium">{o.label}</p>
                            <p className="text-muted-foreground">{optRoute}</p>
                            <p className="text-xs text-muted-foreground">{aircraftLabelFor(o)}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(o.total)}</p>
                            {isSelected && (
                              <p className="text-xs text-accent">Selected — viewing below</p>
                            )}
                          </div>
                        </div>
                      </button>
                    </form>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-7">
            <SectionHeading>Itinerary</SectionHeading>
            <div className="mt-3 flex flex-col gap-2">
              {legs.map((leg, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl border border-border/70 p-4 text-sm"
                >
                  <span>
                    <span className="font-medium">
                      {leg.depAirport} → {leg.arrAirport}
                    </span>
                    {(cityStateByIcao[leg.depAirport ?? ""] || cityStateByIcao[leg.arrAirport ?? ""]) && (
                      <span className="block text-xs text-muted-foreground">
                        {cityStateByIcao[leg.depAirport ?? ""] ?? "—"} →{" "}
                        {cityStateByIcao[leg.arrAirport ?? ""] ?? "—"}
                      </span>
                    )}
                  </span>
                  <span className="text-right text-muted-foreground">
                    <span className="block">{legDate(leg)}</span>
                    <span className="block text-xs">{legTimeLabel(leg)}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {aircraftLabel}
              {pax !== null && ` · ${pax} passengers`}
            </p>
          </section>

          {option.aircraft && (option.aircraft.photos.length > 0 || option.aircraft.amenities.length > 0) && (
            <section className="mt-7">
              <SectionHeading>Aircraft</SectionHeading>
              {option.aircraft.photos.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {option.aircraft.photos.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt={aircraftLabel}
                      className="h-32 w-48 shrink-0 rounded-xl border border-border/70 object-cover"
                    />
                  ))}
                </div>
              )}
              {option.aircraft.amenities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {option.aircraft.amenities.map((a) => (
                    <span
                      key={a}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {amenityLabel(a)}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {option.clientNotes && (
            <section className="mt-7">
              <SectionHeading>Notes</SectionHeading>
              <p className="mt-3 text-sm whitespace-pre-wrap">{option.clientNotes}</p>
            </section>
          )}

          <section className="mt-7">
            <SectionHeading>Pricing</SectionHeading>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              {legs.map((leg, i) => (
                <Row
                  key={i}
                  label={`${leg.depAirport} → ${leg.arrAirport}`}
                  value={formatCurrency(segmentFees[i] ?? 0)}
                  emphasis="muted"
                />
              ))}
              <div className="flex justify-between border-t border-border pt-2">
                <span>Subtotal</span>
                <span>{formatCurrency(preTaxSubtotal)}</span>
              </div>
              {option.fetTax > 0 && (
                <Row label="Federal Excise Tax (7.5%)" value={formatCurrency(option.fetTax)} emphasis="muted" />
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-3 text-base font-semibold">
                <span>Total</span>
                <span>{formatCurrency(option.total)}</span>
              </div>
              {option.depositAmount !== null && (
                <Row
                  label={`Payment for Flight (${Math.round(operator.depositPercent * 100)}%)`}
                  value={formatCurrency(option.depositAmount ?? 0)}
                  emphasis="muted"
                />
              )}
            </div>
          </section>

          {termsText && !pendingDecision && quote.status !== "pending_confirmation" && (
            <section className="mt-7">
              <SectionHeading>Charter Terms</SectionHeading>
              <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/70 p-4 text-sm whitespace-pre-wrap text-muted-foreground">
                {termsText}
              </div>
            </section>
          )}

          <p className="mt-6 text-sm text-muted-foreground">
            Valid until {quote.validUntil.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            {!isExpired &&
              ["sent", "approved"].includes(quote.status) &&
              (daysRemaining > 0
                ? ` — ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`
                : " — expires today")}
          </p>

          {quote.status === "accepted" ? (
            <div className="mt-7 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
              <p className="font-medium">You&apos;re confirmed!</p>
              <p className="mt-1 text-muted-foreground">
                Accepted {quote.acceptedAt?.toLocaleString()}.{" "}
                {quote.cardHoldStatus === "pending"
                  ? quote.paymentMethod === "credit_card"
                    ? "Please complete checkout to charge your card — your confirmation email with the charter agreement will follow once that's done. If you closed the checkout page before finishing, contact us and we'll send a new link."
                    : "Please complete checkout to authorize your card hold — your confirmation email with the charter agreement will follow once that's done. If you closed the checkout page before finishing, contact us and we'll send a new link."
                  : quote.cardHoldStatus === "authorized" && quote.paymentMethod === "wire"
                    ? "Your backup card hold is authorized. A confirmation email with your charter agreement and wire instructions is on its way."
                    : quote.cardHoldStatus === "authorized"
                      ? "Your payment is confirmed. A confirmation email with your charter agreement is on its way."
                      : "A confirmation email with your charter agreement is on its way."}
              </p>
            </div>
          ) : quote.status === "pending_confirmation" ? (
            <div className="mt-7 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
              <p className="font-medium">Confirming availability</p>
              <p className="mt-1 text-muted-foreground">
                Thanks for your request — we&apos;re confirming aircraft availability for your
                dates and will follow up shortly.
              </p>
            </div>
          ) : quote.status === "declined" ? (
            <div className="mt-7 rounded-xl border border-border p-4 text-sm text-muted-foreground">
              This quote was declined. Contact {operator.name} if that was a mistake.
            </div>
          ) : isExpired ? (
            <div className="mt-7 rounded-xl border border-border p-4 text-sm text-muted-foreground">
              This quote has expired. Contact {operator.name} for an updated quote.
            </div>
          ) : quote.status === "approved" ? (
            <div className="mt-9 flex flex-col gap-4 border-t border-border pt-7">
              <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
                <p className="font-medium">Good news — your aircraft is available!</p>
                <p className="mt-1 text-muted-foreground">
                  Review the charter terms below and sign to finalize your booking.
                </p>
              </div>
              <TermsAcceptGate
                termsText={termsText}
                depositAmount={option.depositAmount}
                ccProcessingFeePercent={operator.ccProcessingFeePercent}
                waivesCardHold={quote.contact?.paymentTerms === "cash_on_account"}
                action={acceptQuoteWithToken}
              />
              {requestChangesOrDecline}
            </div>
          ) : (
            <div className="mt-9 flex flex-col gap-4 border-t border-border pt-7">
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Requesting to book doesn&apos;t charge or commit you yet — we&apos;ll confirm
                  aircraft availability and follow up before anything is finalized.
                </p>
                <form action={requestToBookWithToken}>
                  <Button type="submit" size="lg" className="h-11 w-full rounded-xl">
                    Request to Book
                  </Button>
                </form>
              </div>
              {requestChangesOrDecline}
            </div>
          )}

          {requested === "1" && (
            <p className="mt-4 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
              Your message has been sent — we&apos;ll follow up shortly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
