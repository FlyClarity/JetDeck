import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/url";
import { routeSummary, relativeTime } from "@/lib/queue";
import { formatCurrency, QUOTE_MESSAGE_BADGES, TRIP_PURPOSE_LABELS } from "@/lib/quote";
import {
  confirmPendingBookingForOperator,
  declinePendingBookingForOperator,
  resendCardHoldLink,
} from "@/lib/booking-server";
import { parseOptionFromFormData, parseOptionCount } from "@/lib/quote-option-server";
import { getAirportsByIcao } from "@/lib/airport-server";
import { revenueLegsOf, legDate, autoNightsAwayOf } from "@/lib/itinerary";
import { QuoteBuilderForm } from "@/components/quote/quote-builder-form";
import { CopyLinkButton } from "@/components/quote/copy-link-button";
import { OriginalRequestPanel } from "@/components/quote/original-request-panel";
import { SendQuoteGate } from "@/components/quote/send-quote-gate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

async function getScopedQuote(id: string) {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return null;

  const quote = await prisma.quote.findFirst({
    where: { id, operatorId: operator.id },
    include: { tripRequest: true, selectedOption: true },
  });
  if (!quote || !quote.selectedOption) return null;

  return { quote, option: quote.selectedOption, operator };
}

async function updateQuote(id: string, formData: FormData) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  const { quote, operator } = scoped;

  const optionCount = parseOptionCount(formData);
  const parsedOptions = Array.from({ length: optionCount }, (_, i) =>
    parseOptionFromFormData(formData, `option_${i}_`, operator.defaultOvernightFee)
  );

  // Options aren't referenced by id anywhere except Quote.selectedOptionId
  // (Trip and the Stripe hold reference Quote directly, not any one
  // option) — simplest and most robust to just replace the whole set on
  // every save rather than diffing which tab is "the same" option as
  // before, mirroring how itinerary legs were already fully replaced
  // wholesale on every save pre-Options.
  await prisma.quoteOption.deleteMany({ where: { quoteId: quote.id } });
  const createdOptions = await Promise.all(
    parsedOptions.map((o) =>
      prisma.quoteOption.create({
        data: {
          quoteId: quote.id,
          label: o.label ?? "Option A",
          aircraftId: o.aircraftId,
          itinerary: o.itinerary,
          flightHours: o.flightHours,
          hourlyRate: o.hourlyRate,
          repoHours: o.repoHours,
          repoRate: o.repoRate,
          returnsToHomeBase: o.returnsToHomeBase,
          overnightNights: o.overnightNights,
          overnightFee: o.overnightFee,
          landingFees: o.landingFees,
          handlingFees: o.handlingFees,
          additionalFees: o.additionalFees,
          fetTax: o.fetTax,
          discount: o.discount,
          discountNote: o.discountNote,
          clientNotes: o.clientNotes,
          subtotal: o.subtotal,
          total: o.total,
          depositAmount: o.total * operator.depositPercent,
        },
      })
    )
  );

  const validUntil = String(formData.get("validUntil") ?? "");

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      selectedOptionId: createdOptions[0].id,
      internalNotes: String(formData.get("internalNotes") ?? "") || null,
      validUntil: validUntil ? new Date(validUntil) : quote.validUntil,
    },
  });

  redirect(`/quotes/${quote.id}`);
}

async function sendQuote(id: string) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  const { quote, option, operator } = scoped;
  if (quote.status !== "draft" || !quote.tripRequest) return;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "sent", sentAt: new Date() },
  });

  const appUrl = await getAppUrl();
  const quoteLink = `${appUrl}/q/${quote.token}`;
  const optionCount = await prisma.quoteOption.count({ where: { quoteId: quote.id } });
  // A single total is only meaningful for a single-option quote — with
  // multiple options the client picks one on the page itself, so naming
  // just the first one's price here would be misleading.
  const pricingLine =
    optionCount > 1
      ? `${optionCount} pricing options to choose from.`
      : `Total: ${formatCurrency(option.total)}.`;

  await sendEmail({
    to: quote.tripRequest.requestorEmail,
    subject: `Your Charter Quote — ${quote.quoteNumber}`,
    html: `<p>Hi ${quote.tripRequest.requestorName},</p><p>Your quote is ready: <a href="${quoteLink}">${quoteLink}</a></p><p>${pricingLine} Valid until ${quote.validUntil.toLocaleDateString()}.</p><p>— ${operator.name}</p>`,
    replyTo: operator.replyToEmail ?? undefined,
    from: operator.fromEmail,
    fromName: operator.name,
  });

  redirect(`/quotes/${quote.id}`);
}

async function cancelBooking(id: string, formData: FormData) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  const { quote, operator } = scoped;
  if (quote.status !== "accepted") return;

  const note = String(formData.get("cancellationNote") ?? "").trim();
  if (!note) return;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "cancelled", cancelledAt: new Date(), cancellationNote: note },
  });

  if (quote.tripRequest?.requestorEmail) {
    await sendEmail({
      to: quote.tripRequest.requestorEmail,
      subject: `Important update — ${quote.quoteNumber}`,
      html: `<p>Hi ${quote.tripRequest.requestorName},</p><p>We're sorry to let you know your booking (${quote.quoteNumber}) has been cancelled: ${note}</p><p>Please contact us so we can help find another solution.</p><p>— ${operator.name}</p>`,
      replyTo: operator.replyToEmail ?? undefined,
      from: operator.fromEmail,
      fromName: operator.name,
    });
  }

  redirect(`/quotes/${quote.id}`);
}

async function confirmPendingBooking(id: string) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  await confirmPendingBookingForOperator(scoped.operator.id, id);

  redirect(`/quotes/${id}`);
}

async function declinePendingBooking(id: string, formData: FormData) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  const note = String(formData.get("declineNote") ?? "").trim();
  await declinePendingBookingForOperator(scoped.operator.id, id, note);

  redirect(`/quotes/${id}`);
}

async function resendCardHold(id: string) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  await resendCardHoldLink(scoped.operator.id, id);

  redirect(`/quotes/${id}`);
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scoped = await getScopedQuote(id);
  if (!scoped) notFound();
  const { quote, option, operator } = scoped;

  const allOptions = await prisma.quoteOption.findMany({
    where: { quoteId: quote.id },
    orderBy: { createdAt: "asc" },
  });

  const aircraftList = await prisma.aircraft.findMany({
    where: { operatorId: operator.id, status: "active" },
    orderBy: { tailNumber: "asc" },
  });

  const messages = await prisma.inboundEmail.findMany({
    where: { quoteId: quote.id },
    orderBy: { receivedAt: "asc" },
  });

  // TripRequest doesn't store the email subject — it lives on the
  // InboundEmail row that created it. Routing is often stated there (e.g.
  // "TEB-PBI 9/15"), so it's worth surfacing next to the body for a quick
  // sanity check against what the AI extracted.
  const originalEmail = quote.tripRequest
    ? await prisma.inboundEmail.findFirst({
        where: { tripRequestId: quote.tripRequest.id },
        orderBy: { receivedAt: "asc" },
        select: { subject: true },
      })
    : null;

  // Fed into the Quote Builder for a live "is this aircraft already booked
  // over these dates?" check as the operator adjusts aircraft/legs — see
  // findConflictingBooking in lib/itinerary.ts.
  const existingBookingsRaw = await prisma.quote.findMany({
    where: {
      operatorId: operator.id,
      status: { in: ["accepted", "approved", "pending_confirmation"] },
      id: { not: quote.id },
    },
    select: {
      id: true,
      quoteNumber: true,
      selectedOption: { select: { aircraftId: true, itinerary: true } },
    },
  });
  const existingBookings = existingBookingsRaw
    .filter((q): q is typeof q & { selectedOption: NonNullable<(typeof q)["selectedOption"]> } =>
      Boolean(q.selectedOption)
    )
    .map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      aircraftId: q.selectedOption.aircraftId,
      itinerary: q.selectedOption.itinerary,
    }));

  const routeSummaryText = quote.tripRequest
    ? routeSummary(quote.tripRequest.legs, quote.tripRequest.tripType)
    : routeSummary(revenueLegsOf(option.itinerary), "multi_leg");
  const requestorLine = quote.tripRequest
    ? [
        quote.tripRequest.requestorName,
        quote.tripRequest.requestorCompany,
        quote.tripRequest.requestorEmail,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  // Quotes created before per-leg tracking shipped stored itinerary as
  // { depAirport, arrAirport, depDt, arrDt, flightHours } with no billAs/date.
  type StoredLeg = {
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
  const optionsStoredLegs = allOptions.map((o) => (o.itinerary as StoredLeg[]) ?? []);
  const icaosToResolve = [
    ...optionsStoredLegs.flatMap((legs) =>
      legs.flatMap((l) => [l.depAirport, l.arrAirport].filter(Boolean) as string[])
    ),
    ...aircraftList.map((a) => a.homeBase),
  ];
  const resolvedAirports = await getAirportsByIcao(icaosToResolve);
  // Keyed by both ICAO and IATA so a leg that stored the 3-letter code
  // (e.g. "SAN" instead of "KSAN") still resolves to the same airport.
  const airportsByIcao = Object.fromEntries(
    resolvedAirports.flatMap((a) => (a.iata ? [[a.icao, a], [a.iata, a]] : [[a.icao, a]]))
  );

  const toSavedLegs = (storedLegs: StoredLeg[]) =>
    storedLegs.map((l) => ({
      billAs: (l.billAs === "repositioning" ? "repositioning" : "revenue") as
        | "revenue"
        | "repositioning",
      dep: l.depAirport ? airportsByIcao[l.depAirport] ?? { icao: l.depAirport } : null,
      arr: l.arrAirport ? airportsByIcao[l.arrAirport] ?? { icao: l.arrAirport } : null,
      date: l.date ?? (l.depDt ? l.depDt.slice(0, 10) : ""),
      flightHours: l.flightHours ?? 0,
      depTime: l.depTime ?? "",
      depTimeTBD: l.depTimeTBD ?? !l.depTime,
      arrTime: l.arrTime ?? "",
    }));

  const initialOptions = allOptions.map((o) => ({
    label: o.label,
    aircraftId: o.aircraftId,
    requestedLegs: [],
    legs: toSavedLegs((o.itinerary as StoredLeg[]) ?? []),
    hourlyRate: o.hourlyRate,
    repoRate: o.repoRate,
    returnsToHomeBase: o.returnsToHomeBase,
    extraNightsAway: Math.max(0, o.overnightNights - autoNightsAwayOf(o.itinerary)),
    landingFees: o.landingFees,
    handlingFees: o.handlingFees,
    additionalFees: (o.additionalFees as { label: string; amount: number }[]) ?? [],
    fetTax: o.fetTax > 0,
    discount: o.discount,
    discountNote: o.discountNote ?? "",
    clientNotes: o.clientNotes ?? "",
  }));

  const updateQuoteWithId = updateQuote.bind(null, quote.id);
  const sendQuoteWithId = sendQuote.bind(null, quote.id);
  const cancelBookingWithId = cancelBooking.bind(null, quote.id);
  const confirmPendingBookingWithId = confirmPendingBooking.bind(null, quote.id);
  const declinePendingBookingWithId = declinePendingBooking.bind(null, quote.id);
  const resendCardHoldWithId = resendCardHold.bind(null, quote.id);
  const clientLink = `${await getAppUrl()}/q/${quote.token}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{quote.quoteNumber}</h1>
          {quote.tripPurpose && (
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-sm font-medium text-accent">
              {TRIP_PURPOSE_LABELS[quote.tripPurpose] ?? "Internal"}
            </span>
          )}
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium capitalize text-muted-foreground">
          {quote.status === "pending_confirmation"
            ? "Needs your review"
            : quote.status === "approved"
              ? "Approved — awaiting signature"
              : quote.status}
        </span>
      </div>

      {quote.status === "draft" ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Saved as a draft — edit anything below, then send when ready.
          </p>
          <SendQuoteGate
            action={sendQuoteWithId}
            requestorName={quote.tripRequest?.requestorName ?? "the client"}
            requestorEmail={quote.tripRequest?.requestorEmail ?? ""}
            routeLines={revenueLegsOf(option.itinerary).map(
              (leg) => `${leg.depAirport} → ${leg.arrAirport} — ${legDate(leg)}`
            )}
            total={formatCurrency(option.total)}
            validUntil={quote.validUntil.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          />
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          <p>Sent {quote.sentAt?.toLocaleString()}</p>
          <a
            href={clientLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-foreground underline underline-offset-4"
          >
            Client link
          </a>
          <CopyLinkButton link={clientLink} />
        </div>
      )}

      {quote.status === "pending_confirmation" && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
            <p className="font-medium">
              {quote.tripRequest?.requestorName || "The client"} requested to book
              {quote.requestedAt && ` on ${quote.requestedAt.toLocaleString()}`} — needs your
              review
            </p>
            <p className="mt-1 text-muted-foreground">
              This is a non-binding request — nothing&apos;s been signed yet. Confirming
              availability emails the client to review the charter terms and finalize; declining
              lets them know it&apos;s not available.
            </p>
          </div>

          {quote.conflictWarning && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">⚠️ Possible double-booking</p>
              <p className="mt-1">{quote.conflictWarning}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <form action={confirmPendingBookingWithId}>
              <Button type="submit" size="sm">
                Confirm Availability
              </Button>
            </form>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Decline instead</summary>
              <form action={declinePendingBookingWithId} className="mt-3 flex flex-col gap-2">
                <Textarea
                  name="declineNote"
                  rows={2}
                  placeholder="Reason — this is sent to the client"
                  required
                />
                <Button type="submit" variant="destructive" size="sm" className="self-start">
                  Decline
                </Button>
              </form>
            </details>
          </div>
        </div>
      )}

      {quote.status === "approved" && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
            <p className="font-medium">
              Approved{quote.approvedAt && ` on ${quote.approvedAt.toLocaleString()}`} — awaiting
              the client&apos;s signature
            </p>
            <p className="mt-1 text-muted-foreground">
              They&apos;ve been emailed a link to review the charter terms and authorize their
              deposit hold. Nothing&apos;s finalized yet.
            </p>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Aircraft no longer available after all?
            </summary>
            <form action={declinePendingBookingWithId} className="mt-3 flex flex-col gap-2">
              <Textarea
                name="declineNote"
                rows={2}
                placeholder="Reason — this is sent to the client"
                required
              />
              <Button type="submit" variant="destructive" size="sm" className="self-start">
                Decline
              </Button>
            </form>
          </details>
        </div>
      )}

      {quote.status === "accepted" && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
            <p className="font-medium">
              Accepted by {quote.acceptedByName || quote.tripRequest?.requestorName || "the client"}
              {quote.acceptedAt && ` on ${quote.acceptedAt.toLocaleString()}`}
            </p>
            {quote.acceptedIp && (
              <p className="mt-1 text-xs text-muted-foreground">IP: {quote.acceptedIp}</p>
            )}
            {quote.cardHoldStatus && (
              <p className="mt-1 text-xs text-muted-foreground capitalize">
                Card hold: {quote.cardHoldStatus}
              </p>
            )}
            {option.depositAmount && option.depositAmount > 0 && quote.cardHoldStatus !== "captured" && (
              <form action={resendCardHoldWithId} className="mt-2">
                <Button type="submit" variant="outline" size="sm">
                  Resend card hold link
                </Button>
              </form>
            )}
          </div>

          {quote.conflictWarning && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">⚠️ Possible double-booking</p>
              <p className="mt-1">{quote.conflictWarning}</p>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Aircraft or crew no longer available?
            </summary>
            <form action={cancelBookingWithId} className="mt-3 flex flex-col gap-2">
              <Textarea
                name="cancellationNote"
                rows={2}
                placeholder="Reason for cancelling — this is sent to the client"
                required
              />
              <Button type="submit" variant="destructive" size="sm" className="self-start">
                Cancel Booking
              </Button>
            </form>
          </details>
        </div>
      )}

      {quote.status === "cancelled" && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Booking cancelled</p>
          {quote.cancelledAt && <p className="mt-1">On {quote.cancelledAt.toLocaleString()}</p>}
          {quote.cancellationNote && <p className="mt-1">{quote.cancellationNote}</p>}
        </div>
      )}

      {quote.tripRequest && (
        <div className="mt-6">
          <OriginalRequestPanel
            source={quote.tripRequest.source}
            rawEmailFrom={quote.tripRequest.rawEmailFrom}
            rawEmailSubject={originalEmail?.subject}
            rawEmailBody={quote.tripRequest.rawEmailBody}
            specialRequests={quote.tripRequest.specialRequests}
          />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Messages
        </h2>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {quote.status === "draft"
              ? "Replies will appear here once this quote is sent."
              : "No replies yet — client replies to the quote email land here automatically."}
          </p>
        ) : (
          messages.map((message) => {
            const badge = message.classification
              ? QUOTE_MESSAGE_BADGES[message.classification]
              : null;
            return (
              <div key={message.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {message.fromName ?? message.fromEmail}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(message.receivedAt)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {badge && (
                    <span>
                      {badge.emoji} {badge.label}
                    </span>
                  )}
                  {message.classification === "quote_response_accepted" &&
                    message.status === "needs_review" && (
                      <span className="text-accent">
                        Needs manual confirmation — email acceptance isn&apos;t a legal
                        record on its own
                      </span>
                    )}
                </div>
                {message.subject && <p className="mt-2 font-medium">{message.subject}</p>}
                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
                  {message.bodyText}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-8">
        <QuoteBuilderForm
          routeSummaryText={routeSummaryText}
          requestorLine={requestorLine}
          aircraftList={aircraftList}
          airportsByIcao={airportsByIcao}
          existingBookings={existingBookings}
          initialOptions={initialOptions}
          internalNotes={quote.internalNotes ?? ""}
          validUntil={quote.validUntil.toISOString().slice(0, 10)}
          priceSuggestionPromise={Promise.resolve(null)}
          depositPercent={operator.depositPercent}
          defaultOvernightFee={operator.defaultOvernightFee}
          defaultBlockTimeBufferHours={operator.defaultBlockTimeBufferHours}
          isAccepted={["pending_confirmation", "approved", "accepted"].includes(quote.status)}
          action={updateQuoteWithId}
          submitLabel="Save Changes"
        />
      </div>
    </div>
  );
}
