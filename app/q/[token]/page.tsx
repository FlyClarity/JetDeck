import { notFound, redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/quote";
import { paxCount } from "@/lib/queue";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TermsAcceptGate } from "@/components/quote/terms-accept-gate";

export type StoredLeg = {
  billAs?: string;
  depAirport?: string | null;
  arrAirport?: string | null;
  date?: string | null;
  depDt?: string | null;
  flightHours?: number;
  depTime?: string | null;
  depTimeTBD?: boolean;
  arrTime?: string | null;
};

export function revenueLegsOf(itinerary: unknown): StoredLeg[] {
  const legs = (itinerary as StoredLeg[]) ?? [];
  return legs.filter((l) => (l.billAs ?? "revenue") === "revenue");
}

export function legDateIso(leg: StoredLeg): string | null {
  return leg.date || (leg.depDt ? leg.depDt.slice(0, 10) : null);
}

export function legDate(leg: StoredLeg): string {
  const iso = legDateIso(leg);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function legTimeLabel(leg: StoredLeg): string {
  const dep = leg.depTimeTBD || !leg.depTime ? "TBD" : leg.depTime;
  return leg.arrTime ? `Departs ${dep} · Arrives ${leg.arrTime}` : `Departs ${dep}`;
}

function routeAndDateText(itinerary: unknown) {
  const legs = revenueLegsOf(itinerary);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const route = first ? `${first.depAirport ?? "?"} → ${last?.arrAirport ?? first.arrAirport ?? "?"}` : "your trip";
  const date = first ? legDate(first) : "";
  return { route, date };
}

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

  // Flag a possible double-booking: another already-accepted quote on the
  // same aircraft covering one of the same dates. Doesn't block the client's
  // acceptance (they've already committed) — surfaces it to the operator to
  // resolve manually, e.g. via Cancel Booking on whichever can't be honored.
  let conflictWarning: string | null = null;
  if (quote.aircraftId) {
    const thisDates = new Set(
      revenueLegsOf(quote.itinerary)
        .map(legDateIso)
        .filter((d): d is string => Boolean(d))
    );
    const otherAccepted = await prisma.quote.findMany({
      where: { aircraftId: quote.aircraftId, status: "accepted", id: { not: quote.id } },
    });
    for (const other of otherAccepted) {
      const overlap = revenueLegsOf(other.itinerary)
        .map(legDateIso)
        .find((d) => d && thisDates.has(d));
      if (overlap) {
        conflictWarning = `Also booked on this aircraft for ${overlap} via quote ${other.quoteNumber}.`;
        break;
      }
    }
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: "accepted",
      acceptedAt,
      acceptedByName,
      acceptedIp: ip,
      acceptedUserAgent: userAgent,
      acceptedTermsHash: termsHash,
      conflictWarning,
    },
  });

  const { route, date } = routeAndDateText(quote.itinerary);
  const requestorEmail = quote.tripRequest?.requestorEmail;
  const requestorName = quote.tripRequest?.requestorName ?? "there";

  if (requestorEmail) {
    await sendEmail({
      to: requestorEmail,
      subject: `Your Charter Agreement — ${route} on ${date}`,
      html: `
        <p>Hi ${requestorName},</p>
        <p>Thank you for booking with ${quote.operator.name}. Your charter agreement is confirmed.</p>
        <p><strong>Reference:</strong> ${quote.quoteNumber}<br/>
        <strong>Accepted:</strong> ${acceptedAt.toUTCString()}<br/>
        <strong>Route:</strong> ${route}<br/>
        <strong>Total:</strong> ${formatCurrency(quote.total)}${
          quote.depositAmount ? `<br/><strong>Deposit due:</strong> ${formatCurrency(quote.depositAmount)}` : ""
        }</p>
        ${quote.operator.wireInstructions ? `<p><strong>Wire instructions:</strong><br/>${quote.operator.wireInstructions.replace(/\n/g, "<br/>")}</p>` : ""}
        <p>Our team will follow up shortly with a secure card authorization link for your deposit hold.</p>
        ${
          quote.operator.termsText
            ? `<p><strong>Charter terms you agreed to:</strong></p><p style="white-space:pre-wrap">${quote.operator.termsText}</p>`
            : ""
        }
        <p>— ${quote.operator.name}</p>
      `,
      replyTo: quote.operator.replyToEmail ?? undefined,
    });
  }

  if (quote.operator.notifyEmail) {
    await sendEmail({
      to: quote.operator.notifyEmail,
      subject: conflictWarning
        ? `⚠️ Double-booking risk — Quote ${quote.quoteNumber} accepted`
        : `Quote ${quote.quoteNumber} accepted!`,
      html: `<p>${acceptedByName} (${requestorName}) accepted quote ${quote.quoteNumber} (${formatCurrency(quote.total)}) at ${acceptedAt.toUTCString()}.</p>${
        conflictWarning
          ? `<p style="color:#b91c1c"><strong>⚠️ ${conflictWarning}</strong></p>`
          : ""
      }`,
    });
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
  const additionalFees = (quote.additionalFees as { label: string; amount: number }[]) ?? [];
  const pax = tripRequest ? paxCount(tripRequest.legs) : null;

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
              {isExpired ? "Expired" : quote.status}
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
                  <span className="font-medium">
                    {leg.depAirport} → {leg.arrAirport}
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
              <Row
                label={`Flight (${quote.flightHours.toFixed(1)} hrs @ ${formatCurrency(quote.hourlyRate)}/hr)`}
                value={formatCurrency(quote.flightHours * quote.hourlyRate)}
                emphasis="muted"
              />
              {quote.repoHours > 0 && (
                <Row
                  label={`Repositioning (${quote.repoHours.toFixed(1)} hrs)`}
                  value={formatCurrency(quote.repoHours * quote.repoRate)}
                  emphasis="muted"
                />
              )}
              {quote.overnightFee > 0 && (
                <Row label="Overnight fee" value={formatCurrency(quote.overnightFee)} emphasis="muted" />
              )}
              {quote.landingFees > 0 && (
                <Row label="Landing fees" value={formatCurrency(quote.landingFees)} emphasis="muted" />
              )}
              {quote.handlingFees > 0 && (
                <Row label="Handling fees" value={formatCurrency(quote.handlingFees)} emphasis="muted" />
              )}
              {additionalFees.map((fee, i) => (
                <Row key={i} label={fee.label || "Fee"} value={formatCurrency(fee.amount)} emphasis="muted" />
              ))}
              {quote.discount > 0 && (
                <Row
                  label="Discount"
                  value={`-${formatCurrency(quote.discount)}`}
                  emphasis="destructive"
                />
              )}
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
