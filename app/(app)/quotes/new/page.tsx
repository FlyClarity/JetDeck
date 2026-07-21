import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { generateQuoteNumber } from "@/lib/quote-server";
import { suggestPrice } from "@/lib/ai/suggest-price";
import { routeSummary } from "@/lib/queue";
import { QuoteBuilderForm } from "@/components/quote/quote-builder-form";

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
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

  const flightCost = flightHours * hourlyRate;
  const repoCost = repoHours * repoRate;
  const feesTotal = additionalFees.reduce((sum, f) => sum + (f.amount || 0), 0);
  const subtotal = flightCost + repoCost + landingFees + handlingFees + feesTotal;
  const discountedSubtotal = Math.max(subtotal - discount, 0);
  const fetAmount = fetTax ? discountedSubtotal * 0.075 : 0;
  const total = discountedSubtotal + fetAmount;

  const legs = (tripRequest.legs as { depAirport?: string; arrAirport?: string; date?: string }[]) ?? [];
  const itinerary = legs.map((leg) => ({
    depAirport: leg.depAirport ?? null,
    arrAirport: leg.arrAirport ?? null,
    depDt: leg.date ? `${leg.date}T00:00:00.000Z` : null,
    arrDt: null,
    flightHours,
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
  if (!operator || !tripRequestId) notFound();

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
          initialValues={{
            aircraftId: defaultAircraft?.id ?? null,
            flightHours: 0,
            hourlyRate: defaultAircraft?.hourlyRate ?? 0,
            repoHours: 0,
            repoRate: defaultAircraft?.repoRate ?? defaultAircraft?.hourlyRate ?? 0,
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
          action={createQuoteWithId}
          submitLabel="Create Quote"
        />
      </div>
    </div>
  );
}
