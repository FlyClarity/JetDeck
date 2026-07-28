import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { generateQuoteNumber } from "@/lib/quote-server";
import { suggestPrice } from "@/lib/ai/suggest-price";
import { scoreOpportunity } from "@/lib/ai/score-opportunity";
import { routeSummary } from "@/lib/queue";
import { calculateQuoteTotals } from "@/lib/quote";
import { getAirportsByIcao } from "@/lib/airport-server";
import { QuoteBuilderForm } from "@/components/quote/quote-builder-form";
import { NewLeadForm } from "@/components/quote/new-lead-form";

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

async function createManualLead(formData: FormData) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  let legs: unknown[] = [];
  try {
    legs = JSON.parse(String(formData.get("legsJson") ?? "[]"));
  } catch {
    legs = [];
  }

  const normalizedLegs = (legs as Record<string, unknown>[]).map((leg) => ({
    depAirport: String(leg.depAirport ?? ""),
    arrAirport: String(leg.arrAirport ?? ""),
    date: String(leg.date ?? ""),
    timePref: leg.timePref ? String(leg.timePref) : null,
    timeFlexible: Boolean(leg.timeFlexible),
    passengerCount: leg.passengerCount ? Number(leg.passengerCount) : null,
  }));

  const aircraftPref = String(formData.get("aircraftPref") ?? "no_preference");

  const tripRequest = await prisma.tripRequest.create({
    data: {
      operatorId: operator.id,
      source: "manual",
      requestorName: String(formData.get("requestorName") ?? ""),
      requestorEmail: String(formData.get("requestorEmail") ?? ""),
      requestorPhone: String(formData.get("requestorPhone") ?? "") || null,
      requestorCompany: String(formData.get("requestorCompany") ?? "") || null,
      requestorType: String(formData.get("requestorType") ?? "direct"),
      tripType: String(formData.get("tripType") ?? "one_way"),
      legs: normalizedLegs,
      aircraftPref: aircraftPref === "no_preference" ? null : aircraftPref,
      specialRequests: String(formData.get("specialRequests") ?? "") || null,
      status: "ready",
    },
  });

  await scoreOpportunity(tripRequest.id);

  redirect(`/quotes/new?tripRequestId=${tripRequest.id}`);
}

async function createQuote(tripRequestId: string, formData: FormData) {
  "use server";

  const { clerkOrgId, userId } = await getTenantContext();
  if (!clerkOrgId || !userId) return;

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const tripRequest = await prisma.tripRequest.findFirst({
    where: { id: tripRequestId, operatorId: operator.id },
  });
  if (!tripRequest) return;

  const aircraftId = String(formData.get("aircraftId") ?? "");
  const aircraft = await prisma.aircraft.findFirst({
    where: { id: aircraftId, operatorId: operator.id },
  });
  if (!aircraft) return;

  const flightHours = Number(formData.get("flightHours") ?? 0);
  const hourlyRate = Number(formData.get("hourlyRate") ?? 0);
  const repoHours = Number(formData.get("repoHours") ?? 0);
  const repoRate = Number(formData.get("repoRate") ?? 0);
  const returnsToHomeBase = formData.get("returnsToHomeBase") === "on";
  const overnightNights = returnsToHomeBase ? 0 : Number(formData.get("overnightNights") ?? 0);
  const overnightFee = overnightNights * operator.defaultOvernightFee;
  const landingFees = Number(formData.get("landingFees") ?? 0);
  const handlingFees = Number(formData.get("handlingFees") ?? 0);
  const fetTax = formData.get("fetTax") === "on";
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
    fetTax,
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

  const quoteNumber = await generateQuoteNumber(operator.id);
  const validUntil = String(formData.get("validUntil") ?? defaultValidUntil());

  const quote = await prisma.quote.create({
    data: {
      operatorId: operator.id,
      quoteNumber,
      tripRequestId: tripRequest.id,
      aircraftId: aircraft.id,
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
      depositAmount: total * operator.depositPercent,
      internalNotes: String(formData.get("internalNotes") ?? "") || null,
      validUntil: new Date(validUntil),
      createdBy: userId,
    },
  });

  await prisma.tripRequest.update({
    where: { id: tripRequest.id },
    data: { status: "quoted" },
  });

  redirect(`/quotes/${quote.id}`);
}

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ tripRequestId?: string }>;
}) {
  const { tripRequestId } = await searchParams;
  const operator = await getCurrentOperator();
  if (!operator) notFound();

  if (!tripRequestId) {
    return (
      <div className="mx-auto w-full max-w-xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">New Quote</h1>
        <p className="mt-1 text-muted-foreground">
          Enter the trip and requestor details — you&apos;ll build the quote next.
        </p>
        <NewLeadForm action={createManualLead} />
      </div>
    );
  }

  const tripRequest = await prisma.tripRequest.findFirst({
    where: { id: tripRequestId, operatorId: operator.id },
  });
  if (!tripRequest) notFound();

  const aircraftList = await prisma.aircraft.findMany({
    where: { operatorId: operator.id, status: "active" },
    orderBy: { tailNumber: "asc" },
  });

  const defaultAircraft =
    aircraftList.find((a) => a.category === tripRequest.aircraftPref) ?? aircraftList[0] ?? null;

  const routeSummaryText = routeSummary(tripRequest.legs, tripRequest.tripType);
  const requestorLine = [tripRequest.requestorName, tripRequest.requestorCompany]
    .filter(Boolean)
    .join(" · ");

  const tripLegs =
    (tripRequest.legs as { depAirport?: string; arrAirport?: string; date?: string }[]) ?? [];
  const icaosToResolve = [
    ...tripLegs.flatMap((l) => [l.depAirport, l.arrAirport].filter(Boolean) as string[]),
    ...aircraftList.map((a) => a.homeBase),
  ];
  const resolvedAirports = await getAirportsByIcao(icaosToResolve);
  const airportsByIcao = Object.fromEntries(resolvedAirports.map((a) => [a.icao, a]));

  const requestedLegs = tripLegs.map((l) => ({
    dep: l.depAirport ? airportsByIcao[l.depAirport] ?? { icao: l.depAirport } : null,
    arr: l.arrAirport ? airportsByIcao[l.arrAirport] ?? { icao: l.arrAirport } : null,
    date: l.date ?? "",
  }));

  const priceSuggestion = defaultAircraft
    ? await suggestPrice({
        routeSummary: routeSummaryText,
        flightHours: null,
        aircraftHourlyRate: defaultAircraft.hourlyRate,
        positioningNote: tripRequest.positioningNote,
        historyNote: tripRequest.historyNote,
      })
    : null;

  const createQuoteWithId = createQuote.bind(null, tripRequest.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">New Quote</h1>

      <div className="mt-8">
        <QuoteBuilderForm
          routeSummaryText={routeSummaryText}
          requestorLine={requestorLine}
          aircraftList={aircraftList}
          airportsByIcao={airportsByIcao}
          initialValues={{
            aircraftId: defaultAircraft?.id ?? null,
            requestedLegs,
            hourlyRate: defaultAircraft?.hourlyRate ?? 0,
            repoRate: defaultAircraft?.repoRate ?? defaultAircraft?.hourlyRate ?? 0,
            returnsToHomeBase: true,
            extraNightsAway: 0,
            landingFees: 0,
            handlingFees: 0,
            additionalFees: [],
            fetTax: true,
            discount: 0,
            discountNote: "",
            internalNotes: "",
            validUntil: defaultValidUntil(),
          }}
          priceSuggestion={priceSuggestion}
          depositPercent={operator.depositPercent}
          defaultOvernightFee={operator.defaultOvernightFee}
          defaultBlockTimeBufferHours={operator.defaultBlockTimeBufferHours}
          action={createQuoteWithId}
          submitLabel="Create Quote"
        />
      </div>
    </div>
  );
}
