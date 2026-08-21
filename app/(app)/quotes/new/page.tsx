import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { generateQuoteNumber } from "@/lib/quote-server";
import { suggestPrice } from "@/lib/ai/suggest-price";
import { scoreOpportunity } from "@/lib/ai/score-opportunity";
import { routeSummary } from "@/lib/queue";
import { parseOptionFromFormData, parseOptionCount } from "@/lib/quote-option-server";
import { getAirportsByIcao } from "@/lib/airport-server";
import {
  buildGapsForAircraft,
  findAnchorForDate,
  findTrailingAnchorForDate,
  getActiveLegsByAircraft,
} from "@/lib/aircraft-schedule";
import { normalizeTimeString } from "@/lib/time";
import { QuoteBuilderForm } from "@/components/quote/quote-builder-form";
import { NewLeadForm } from "@/components/quote/new-lead-form";
import { OriginalRequestPanel } from "@/components/quote/original-request-panel";

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

  const requestorName = String(formData.get("requestorName") ?? "");
  const requestorEmail = String(formData.get("requestorEmail") ?? "");
  const requestorPhone = String(formData.get("requestorPhone") ?? "") || null;
  const requestorCompany = String(formData.get("requestorCompany") ?? "") || null;
  const requestorType = String(formData.get("requestorType") ?? "direct");

  // A contact picked from the search box already has an id. Otherwise, save
  // this person as a new Contact (or reuse one matching by email) so they're
  // searchable next time instead of re-entering the same info every lead.
  let contactId = String(formData.get("contactId") ?? "") || null;
  if (!contactId && requestorEmail) {
    const existingContact = await prisma.contact.findFirst({
      where: { operatorId: operator.id, email: requestorEmail },
    });
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const [firstName, ...rest] = requestorName.split(" ");
      const newContact = await prisma.contact.create({
        data: {
          operatorId: operator.id,
          firstName: firstName || "Unknown",
          lastName: rest.join(" "),
          email: requestorEmail,
          phone: requestorPhone,
          company: requestorCompany,
          type: requestorType,
        },
      });
      contactId = newContact.id;
    }
  }

  const tripRequest = await prisma.tripRequest.create({
    data: {
      operatorId: operator.id,
      source: "manual",
      contactId,
      requestorName,
      requestorEmail,
      requestorPhone,
      requestorCompany,
      requestorType,
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

  const optionCount = parseOptionCount(formData);
  const parsedOptions = Array.from({ length: optionCount }, (_, i) =>
    parseOptionFromFormData(formData, `option_${i}_`, operator.defaultOvernightFee)
  );
  // Every option needs a real aircraft on this operator's fleet — silently
  // refusing to create anything on a bad submission matches the prior
  // single-option behavior rather than partially creating a quote with a
  // missing aircraft on one of its options.
  const aircraftIds = parsedOptions.map((o) => o.aircraftId).filter((id): id is string => Boolean(id));
  const aircraftById = new Map(
    (
      await prisma.aircraft.findMany({
        where: { id: { in: aircraftIds }, operatorId: operator.id },
      })
    ).map((a) => [a.id, a])
  );
  if (parsedOptions.some((o) => !o.aircraftId || !aircraftById.has(o.aircraftId))) return;

  const quoteNumber = await generateQuoteNumber(operator.id);
  const validUntil = String(formData.get("validUntil") ?? defaultValidUntil());

  const quote = await prisma.quote.create({
    data: {
      operatorId: operator.id,
      quoteNumber,
      tripRequestId: tripRequest.id,
      contactId: tripRequest.contactId,
      internalNotes: String(formData.get("internalNotes") ?? "") || null,
      validUntil: new Date(validUntil),
      createdBy: userId,
    },
  });

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

  await prisma.quote.update({
    where: { id: quote.id },
    data: { selectedOptionId: createdOptions[0].id },
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

  // TripRequest itself doesn't store the email subject — it lives on the
  // InboundEmail row that created it. Routing is often stated there (e.g.
  // "TEB-PBI 9/15"), so it's worth surfacing next to the body for a quick
  // sanity check against what the AI extracted.
  const originalEmail = await prisma.inboundEmail.findFirst({
    where: { tripRequestId: tripRequest.id },
    orderBy: { receivedAt: "asc" },
    select: { subject: true },
  });

  const aircraftList = await prisma.aircraft.findMany({
    where: { operatorId: operator.id, status: "active" },
    orderBy: { tailNumber: "asc" },
  });

  // Fed into the Quote Builder for a live "is this aircraft already booked
  // over these dates?" check as the operator picks an aircraft and edits
  // legs — no round-trip needed since the comparison itself is pure (see
  // findConflictingBooking).
  const existingBookingsRaw = await prisma.quote.findMany({
    where: {
      operatorId: operator.id,
      status: { in: ["accepted", "approved", "pending_confirmation"] },
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

  const defaultAircraft =
    aircraftList.find((a) => a.category === tripRequest.aircraftPref) ?? aircraftList[0] ?? null;

  const routeSummaryText = routeSummary(tripRequest.legs, tripRequest.tripType);
  const requestorLine = [
    tripRequest.requestorName,
    tripRequest.requestorCompany,
    tripRequest.requestorEmail,
  ]
    .filter(Boolean)
    .join(" · ");

  const tripLegs =
    (tripRequest.legs as {
      depAirport?: string;
      arrAirport?: string;
      date?: string;
      timePref?: string | null;
      timeFlexible?: boolean;
    }[]) ?? [];

  // Where each aircraft is actually expected to be on this trip's first
  // (leading leg) and last (trailing leg) dates — an aircraft can be away
  // on another trip when this one starts, or have another one confirmed
  // right after this one ends, so neither position is always the same as
  // its permanent home base. Reuses the same gap logic the AI opportunity
  // scorer uses for positioning, so the Quote Builder's auto-generated
  // repositioning legs reflect the same reality the AI already reasoned
  // about when it recommended this aircraft. The trailing side only uses
  // the next commitment's airport when it's close enough to be worth
  // holding position for (see MAX_PRODUCTIVE_IDLE_DAYS) — otherwise it
  // falls back to home base rather than leaving the aircraft to sit away
  // for days waiting on something further out.
  const requestStartDate = tripLegs[0]?.date ?? null;
  const requestEndDate = tripLegs[tripLegs.length - 1]?.date ?? null;
  const positionByAircraftId: Record<string, string> = {};
  const trailingPositionByAircraftId: Record<string, string> = {};
  if (requestStartDate) {
    const legsByAircraft = await getActiveLegsByAircraft(
      operator.id,
      aircraftList.map((a) => a.id)
    );
    for (const aircraft of aircraftList) {
      const gaps = buildGapsForAircraft(
        legsByAircraft.get(aircraft.id) ?? [],
        aircraft.currentBase ?? aircraft.homeBase,
        aircraft.homeBase
      );
      const anchor = findAnchorForDate(gaps, requestStartDate);
      if (anchor) positionByAircraftId[aircraft.id] = anchor;
      const trailingAnchor = findTrailingAnchorForDate(gaps, requestEndDate ?? requestStartDate);
      if (trailingAnchor) trailingPositionByAircraftId[aircraft.id] = trailingAnchor;
    }
  }

  const icaosToResolve = [
    ...tripLegs.flatMap((l) => [l.depAirport, l.arrAirport].filter(Boolean) as string[]),
    ...aircraftList.map((a) => a.homeBase),
    ...Object.values(positionByAircraftId),
    ...Object.values(trailingPositionByAircraftId),
  ];
  const resolvedAirports = await getAirportsByIcao(icaosToResolve);
  // Keyed by both ICAO and IATA so a leg that stored the 3-letter code
  // (e.g. "SAN" instead of "KSAN") still resolves to the same airport.
  const airportsByIcao = Object.fromEntries(
    resolvedAirports.flatMap((a) => (a.iata ? [[a.icao, a], [a.iata, a]] : [[a.icao, a]]))
  );

  const requestedLegs = tripLegs.map((l) => {
    const depTime = normalizeTimeString(l.timePref);
    return {
      dep: l.depAirport ? airportsByIcao[l.depAirport] ?? { icao: l.depAirport } : null,
      arr: l.arrAirport ? airportsByIcao[l.arrAirport] ?? { icao: l.arrAirport } : null,
      date: l.date ?? "",
      depTime,
      depTimeTBD: l.timeFlexible ?? !depTime,
    };
  });

  // Not awaited — the Anthropic call takes a couple of seconds, and blocking
  // the whole page on it made this route noticeably slow to open from the
  // queue. Streamed into the form via Suspense instead (see
  // PriceSuggestionCard) so the rest of the page renders immediately.
  //
  // Cached on the trip request once computed — this page gets reloaded a
  // lot in practice (checking back on a lead, re-opening from the queue),
  // and re-billing the AI for the same suggestion on every visit was a real
  // cost driver, not just a latency one.
  const priceSuggestionPromise: Promise<{ suggestedPrice: number } | null> =
    tripRequest.aiPriceSuggestion !== null
      ? Promise.resolve({ suggestedPrice: tripRequest.aiPriceSuggestion })
      : defaultAircraft
        ? suggestPrice({
            routeSummary: routeSummaryText,
            flightHours: null,
            aircraftHourlyRate: defaultAircraft.hourlyRate,
            positioningNote: tripRequest.positioningNote,
            historyNote: tripRequest.historyNote,
          })
        : Promise.resolve(null);

  if (tripRequest.aiPriceSuggestion === null && defaultAircraft) {
    after(async () => {
      const result = await priceSuggestionPromise;
      if (result) {
        await prisma.tripRequest.update({
          where: { id: tripRequest.id },
          data: { aiPriceSuggestion: result.suggestedPrice },
        });
      }
    });
  }

  const createQuoteWithId = createQuote.bind(null, tripRequest.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">New Quote</h1>

      <div className="mt-6">
        <OriginalRequestPanel
          source={tripRequest.source}
          rawEmailFrom={tripRequest.rawEmailFrom}
          rawEmailSubject={originalEmail?.subject}
          rawEmailBody={tripRequest.rawEmailBody}
          specialRequests={tripRequest.specialRequests}
        />
      </div>

      <div className="mt-8">
        <QuoteBuilderForm
          routeSummaryText={routeSummaryText}
          requestorLine={requestorLine}
          aircraftList={aircraftList}
          airportsByIcao={airportsByIcao}
          positionByAircraftId={positionByAircraftId}
          trailingPositionByAircraftId={trailingPositionByAircraftId}
          existingBookings={existingBookings}
          initialOptions={[
            {
              aircraftId: defaultAircraft?.id ?? null,
              requestedLegs,
              hourlyRate: defaultAircraft?.hourlyRate ?? 0,
              repoRate: defaultAircraft?.repoRate ?? defaultAircraft?.hourlyRate ?? 0,
              // Default is "stays overnight" now — the aircraft always
              // repositions home at the very end of the trip regardless (see
              // buildInitialLegs), this toggle is only about what happens
              // *between* legs.
              returnsToHomeBase: false,
              extraNightsAway: 0,
              landingFees: 0,
              handlingFees: 0,
              additionalFees: [],
              fetTax: true,
              discount: 0,
              discountNote: "",
              clientNotes: "",
            },
          ]}
          internalNotes=""
          validUntil={defaultValidUntil()}
          priceSuggestionPromise={priceSuggestionPromise}
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
