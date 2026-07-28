import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { routeSummary } from "@/lib/queue";
import { calculateQuoteTotals, formatCurrency } from "@/lib/quote";
import { getAirportsByIcao } from "@/lib/airport-server";
import { QuoteBuilderForm } from "@/components/quote/quote-builder-form";
import { Button } from "@/components/ui/button";

async function getScopedQuote(id: string) {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return null;

  const quote = await prisma.quote.findFirst({
    where: { id, operatorId: operator.id },
    include: { tripRequest: true },
  });
  if (!quote) return null;

  return { quote, operator };
}

async function updateQuote(id: string, formData: FormData) {
  "use server";

  const scoped = await getScopedQuote(id);
  if (!scoped) return;
  const { quote } = scoped;

  const aircraftId = String(formData.get("aircraftId") ?? "");
  const flightHours = Number(formData.get("flightHours") ?? 0);
  const hourlyRate = Number(formData.get("hourlyRate") ?? 0);
  const repoHours = Number(formData.get("repoHours") ?? 0);
  const repoRate = Number(formData.get("repoRate") ?? 0);
  const returnsToHomeBase = formData.get("returnsToHomeBase") === "on";
  const overnightNights = returnsToHomeBase ? 0 : Number(formData.get("overnightNights") ?? 0);
  const overnightFee = overnightNights * scoped.operator.defaultOvernightFee;
  const landingFees = Number(formData.get("landingFees") ?? 0);
  const handlingFees = Number(formData.get("handlingFees") ?? 0);
  const fetTaxEnabled = formData.get("fetTax") === "on";
  const discount = Number(formData.get("discount") ?? 0);
  const discountNote = String(formData.get("discountNote") ?? "") || null;

  let additionalFees: { label: string; amount: number }[] = [];
  try {
    additionalFees = JSON.parse(String(formData.get("additionalFeesJson") ?? "[]"));
  } catch {
    additionalFees = [];
  }

  const { subtotal, total, fetAmount } = calculateQuoteTotals({
    flightHours,
    hourlyRate,
    repoHours,
    repoRate,
    overnightFee,
    landingFees,
    handlingFees,
    additionalFees,
    fetTax: fetTaxEnabled,
    discount,
  });

  let legsJson: unknown[] = [];
  try {
    legsJson = JSON.parse(String(formData.get("legsJson") ?? "[]"));
  } catch {
    legsJson = [];
  }
  const itinerary = (legsJson as Record<string, unknown>[]).map((leg) => ({
    billAs: String(leg.billAs ?? "revenue"),
    depAirport: leg.depAirport ? String(leg.depAirport) : null,
    arrAirport: leg.arrAirport ? String(leg.arrAirport) : null,
    date: leg.date ? String(leg.date) : null,
    flightHours: Number(leg.flightHours) || 0,
  }));

  const validUntil = String(formData.get("validUntil") ?? "");

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      aircraftId: aircraftId || null,
      itinerary,
      flightHours,
      hourlyRate,
      repoHours,
      repoRate,
      returnsToHomeBase,
      overnightNights,
      overnightFee,
      landingFees,
      handlingFees,
      additionalFees,
      fetTax: fetAmount,
      discount,
      discountNote,
      subtotal,
      total,
      depositAmount: total * scoped.operator.depositPercent,
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
  const { quote, operator } = scoped;
  if (quote.status !== "draft" || !quote.tripRequest) return;

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "sent", sentAt: new Date() },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const quoteLink = `${appUrl}/q/${quote.token}`;

  await sendEmail({
    to: quote.tripRequest.requestorEmail,
    subject: `Your Charter Quote — ${quote.quoteNumber}`,
    html: `<p>Hi ${quote.tripRequest.requestorName},</p><p>Your quote is ready: <a href="${quoteLink}">${quoteLink}</a></p><p>Total: ${formatCurrency(quote.total)}. Valid until ${quote.validUntil.toLocaleDateString()}.</p><p>— ${operator.name}</p>`,
    replyTo: operator.replyToEmail ?? undefined,
  });

  redirect(`/quotes/${quote.id}`);
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scoped = await getScopedQuote(id);
  if (!scoped) notFound();
  const { quote, operator } = scoped;

  const aircraftList = await prisma.aircraft.findMany({
    where: { operatorId: operator.id, status: "active" },
    orderBy: { tailNumber: "asc" },
  });

  const routeSummaryText = quote.tripRequest
    ? routeSummary(quote.tripRequest.legs, quote.tripRequest.tripType)
    : "Route unknown";
  const requestorLine = quote.tripRequest
    ? [quote.tripRequest.requestorName, quote.tripRequest.requestorCompany]
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
  };
  const storedLegs = (quote.itinerary as StoredLeg[]) ?? [];
  const icaosToResolve = [
    ...storedLegs.flatMap((l) => [l.depAirport, l.arrAirport].filter(Boolean) as string[]),
    ...aircraftList.map((a) => a.homeBase),
  ];
  const resolvedAirports = await getAirportsByIcao(icaosToResolve);
  const airportsByIcao = Object.fromEntries(resolvedAirports.map((a) => [a.icao, a]));

  const savedLegs = storedLegs.map((l) => ({
    billAs: (l.billAs === "repositioning" ? "repositioning" : "revenue") as
      | "revenue"
      | "repositioning",
    dep: l.depAirport ? airportsByIcao[l.depAirport] ?? { icao: l.depAirport } : null,
    arr: l.arrAirport ? airportsByIcao[l.arrAirport] ?? { icao: l.arrAirport } : null,
    date: l.date ?? (l.depDt ? l.depDt.slice(0, 10) : ""),
    flightHours: l.flightHours ?? 0,
  }));

  const updateQuoteWithId = updateQuote.bind(null, quote.id);
  const sendQuoteWithId = sendQuote.bind(null, quote.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{quote.quoteNumber}</h1>
        <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium capitalize text-muted-foreground">
          {quote.status}
        </span>
      </div>

      {quote.status === "draft" ? (
        <form action={sendQuoteWithId} className="mt-4">
          <Button type="submit">Send Quote</Button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Sent {quote.sentAt?.toLocaleString()} — client link: {process.env.NEXT_PUBLIC_APP_URL}/q/
          {quote.token}
        </p>
      )}

      <div className="mt-8">
        <QuoteBuilderForm
          routeSummaryText={routeSummaryText}
          requestorLine={requestorLine}
          aircraftList={aircraftList}
          airportsByIcao={airportsByIcao}
          initialValues={{
            aircraftId: quote.aircraftId,
            requestedLegs: [],
            legs: savedLegs,
            hourlyRate: quote.hourlyRate,
            repoRate: quote.repoRate,
            returnsToHomeBase: quote.returnsToHomeBase,
            // Nights are recomputed from the reloaded legs' dates below; we
            // only stored the combined total at save time, not the auto vs.
            // manual split, so "extra" resets to 0 on reload.
            extraNightsAway: 0,
            landingFees: quote.landingFees,
            handlingFees: quote.handlingFees,
            additionalFees: (quote.additionalFees as { label: string; amount: number }[]) ?? [],
            fetTax: quote.fetTax > 0,
            discount: quote.discount,
            discountNote: quote.discountNote ?? "",
            internalNotes: quote.internalNotes ?? "",
            validUntil: quote.validUntil.toISOString().slice(0, 10),
          }}
          priceSuggestion={null}
          depositPercent={operator.depositPercent}
          defaultOvernightFee={operator.defaultOvernightFee}
          defaultBlockTimeBufferHours={operator.defaultBlockTimeBufferHours}
          action={updateQuoteWithId}
          submitLabel="Save Changes"
        />
      </div>
    </div>
  );
}
