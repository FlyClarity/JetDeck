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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TermsAcceptGate } from "@/components/quote/terms-accept-gate";

async function getQuoteByToken(token: string) {
  return prisma.quote.findUnique({
    where: { token },
    include: { operator: true, tripRequest: true, aircraft: true, brokeredAircraft: true },
  });
}

async function acceptQuote(token: string, formData: FormData) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote || quote.status !== "sent") return;
  if (quote.validUntil < new Date()) return;

  const acceptedByName = String(formData.get("acceptedByName") ?? "").trim() || null;
  if (!acceptedByName) return;

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
  const userAgent = hdrs.get("user-agent");
  const termsHash = quote.operator.termsText
    ? createHash("sha256").update(quote.operator.termsText).digest("hex")
    : null;
  const acceptedAt = new Date();

  // The legal acceptance (terms agreement, deposit authorization) is
  // recorded right here regardless of what happens next — that's the
  // clickwrap moment (E-SIGN/UETA), an operational question about aircraft
  // availability shouldn't gate it. A conflict only determines whether the
  // booking finalizes immediately or waits on the operator to resolve it.
  const conflictWarning = await findBookingConflict(quote);

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
        html: `<p>Hi ${requestorName},</p><p>Thanks for accepting quote ${quote.quoteNumber} — we're confirming aircraft availability for your dates and will follow up shortly with final confirmation.</p><p>— ${quote.operator.name}</p>`,
        replyTo: quote.operator.replyToEmail ?? undefined,
        from: quote.operator.fromEmail,
        fromName: quote.operator.name,
      });
    }

    if (quote.operator.notifyEmail) {
      await sendEmail({
        to: quote.operator.notifyEmail,
        subject: `⚠️ Booking conflict — Quote ${quote.quoteNumber} needs your confirmation`,
        html: `<p>${acceptedByName} (${requestorName}) accepted quote ${quote.quoteNumber} (${formatCurrency(quote.total)}), but a conflict was found:</p><p style="color:#b91c1c"><strong>⚠️ ${conflictWarning}</strong></p><p>Review and confirm or decline from the <a href="${appUrl}/quotes/${quote.id}">quote detail page</a> — nothing has been finalized with the client yet.</p>`,
        replyTo: requestorEmail,
        from: quote.operator.fromEmail,
        fromName: quote.operator.name,
      });
    }
  } else {
    await finalizeBooking(quote.id);
  }

  redirect(`/q/${token}`);
}

async function declineQuote(token: string) {
  "use server";

  const quote = await getQuoteByToken(token);
  if (!quote || quote.status !== "sent") return;

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
      <span className={emphasis === "destructive" ? "text-destructive" : ""}>{value}</span>
    </div>
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
  if (!quote || quote.status === "draft") notFound();

  const operator = quote.operator;
  const tripRequest = quote.tripRequest;
  const legs = revenueLegsOf(quote.itinerary);
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
  const preTaxSubtotal = quote.total - quote.fetTax;
  const segmentFees = allocateProportionally(
    legs.map((l) => l.flightHours ?? 0),
    preTaxSubtotal
  );

  const isExpired = quote.status === "sent" && quote.validUntil < new Date();
  const pendingDecision = quote.status === "sent" && !isExpired;
  const daysRemaining = Math.ceil(
    (quote.validUntil.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  const acceptQuoteWithToken = acceptQuote.bind(null, token);
  const declineQuoteWithToken = declineQuote.bind(null, token);
  const requestChangesWithToken = requestChanges.bind(null, token);

  const aircraftLabel = quote.aircraft
    ? `${quote.aircraft.make} ${quote.aircraft.model} (${quote.aircraft.tailNumber})`
    : quote.brokeredAircraft
      ? `${quote.brokeredAircraft.make ?? ""} ${quote.brokeredAircraft.model ?? ""}`.trim() ||
        "Aircraft to be confirmed"
      : "Aircraft to be confirmed";

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <header className="flex items-center gap-3">
          {operator.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={operator.logoUrl} alt={operator.name} className="h-10 w-auto" />
          )}
          <span className="text-lg font-semibold tracking-tight">{operator.name}</span>
        </header>

        <div className="mt-8 rounded-lg border border-border bg-background p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{quote.quoteNumber}</h1>
              <p className="text-muted-foreground">
                Prepared for {tripRequest?.requestorName ?? "you"}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-sm font-medium capitalize text-muted-foreground">
              {isExpired
                ? "Expired"
                : quote.status === "pending_confirmation"
                  ? "Confirming"
                  : quote.status}
            </span>
          </div>

          <section className="mt-6">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Itinerary
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {legs.map((leg, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
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
            <p className="mt-2 text-sm text-muted-foreground">
              {aircraftLabel}
              {pax !== null && ` · ${pax} passengers`}
            </p>
          </section>

          <section className="mt-6">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Pricing
            </h2>
            <div className="mt-2 flex flex-col gap-1.5 text-sm">
              {legs.map((leg, i) => (
                <Row
                  key={i}
                  label={`${leg.depAirport} → ${leg.arrAirport}`}
                  value={formatCurrency(segmentFees[i] ?? 0)}
                  emphasis="muted"
                />
              ))}
              <div className="flex justify-between border-t border-border pt-1.5">
                <span>Subtotal</span>
                <span>{formatCurrency(preTaxSubtotal)}</span>
              </div>
              {quote.fetTax > 0 && (
                <Row label="Federal Excise Tax (7.5%)" value={formatCurrency(quote.fetTax)} emphasis="muted" />
              )}
              <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
                <span>Total</span>
                <span>{formatCurrency(quote.total)}</span>
              </div>
              {quote.depositAmount !== null && (
                <Row
                  label={`Deposit (${Math.round(operator.depositPercent * 100)}%)`}
                  value={formatCurrency(quote.depositAmount ?? 0)}
                  emphasis="muted"
                />
              )}
            </div>
          </section>

          {operator.termsText && !pendingDecision && (
            <section className="mt-6">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Charter Terms
              </h2>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border p-3 text-sm whitespace-pre-wrap text-muted-foreground">
                {operator.termsText}
              </div>
            </section>
          )}

          <p className="mt-6 text-sm text-muted-foreground">
            Valid until {quote.validUntil.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            {!isExpired &&
              quote.status === "sent" &&
              (daysRemaining > 0
                ? ` — ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`
                : " — expires today")}
          </p>

          {quote.status === "accepted" ? (
            <div className="mt-6 rounded-md border border-accent/40 bg-accent/10 p-4 text-sm">
              <p className="font-medium">You&apos;re confirmed!</p>
              <p className="mt-1 text-muted-foreground">
                Accepted {quote.acceptedAt?.toLocaleString()}. A confirmation email with your
                charter agreement and wire instructions is on its way.
              </p>
              {quote.cardHoldStatus === "pending" && (
                <p className="mt-1 text-muted-foreground">
                  Check your email for a secure link to authorize your deposit card hold.
                </p>
              )}
              {quote.cardHoldStatus === "authorized" && (
                <p className="mt-1 text-muted-foreground">Your deposit card hold is authorized.</p>
              )}
            </div>
          ) : quote.status === "pending_confirmation" ? (
            <div className="mt-6 rounded-md border border-accent/40 bg-accent/10 p-4 text-sm">
              <p className="font-medium">Confirming your booking</p>
              <p className="mt-1 text-muted-foreground">
                Thanks for accepting — we&apos;re confirming aircraft availability for your dates
                and will follow up shortly with final confirmation.
              </p>
            </div>
          ) : quote.status === "declined" ? (
            <div className="mt-6 rounded-md border border-border p-4 text-sm text-muted-foreground">
              This quote was declined. Contact {operator.name} if that was a mistake.
            </div>
          ) : isExpired ? (
            <div className="mt-6 rounded-md border border-border p-4 text-sm text-muted-foreground">
              This quote has expired. Contact {operator.name} for an updated quote.
            </div>
          ) : (
            <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6">
              <TermsAcceptGate
                termsText={operator.termsText}
                depositPercent={operator.depositPercent}
                action={acceptQuoteWithToken}
              />

              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">Need changes, or can&apos;t accept as-is?</summary>
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
            </div>
          )}

          {requested === "1" && (
            <p className="mt-4 rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
              Your message has been sent — we&apos;ll follow up shortly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
