// Orchestrates the Ops Review checklist: aircraft availability, crew
// qualification, and duty-time compliance. Used both to render the
// checklist on the trip detail page and to re-verify server-side before
// actually approving — same function either way, so the button's enabled
// state and what the approve action actually enforces can never drift
// apart.
import { prisma } from "@/lib/prisma";
import { revenueLegsOf, legDateIso, findConflictingBooking } from "@/lib/itinerary";
import { computeDutyPeriods, checkDutyCompliance, dutyComplianceIssueLabel } from "@/lib/duty-time";
import { PILOT_ROLES, crewQualificationStatus, QUALIFICATION_STATUS_LABELS } from "@/lib/crew";
import { resolveAirportTimezone } from "@/lib/geo";
import { isTripPaid } from "@/lib/trip";

export type OpsReviewCheck = {
  label: string;
  passed: boolean;
  notes: string[];
};

export type OpsReviewResult = {
  passed: boolean;
  checks: OpsReviewCheck[];
};

async function fetchOtherAssignments(crewId: string, excludeTripId: string, operatorId: string) {
  return prisma.tripCrewAssignment.findMany({
    where: {
      crewId,
      tripId: { not: excludeTripId },
      operatorId,
      trip: { quote: { status: { not: "cancelled" } } },
    },
    include: { trip: { include: { quote: { include: { selectedOption: true } } } } },
  });
}

export async function evaluateOpsReview(tripId: string, operatorId: string): Promise<OpsReviewResult> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, operatorId },
    include: {
      crewAssignments: { include: { crew: true } },
      quote: { include: { selectedOption: true } },
    },
  });
  if (!trip) {
    return { passed: false, checks: [{ label: "Trip", passed: false, notes: ["Trip not found."] }] };
  }

  const itinerary = trip.quote.selectedOption?.itinerary;
  const legs = revenueLegsOf(itinerary);
  const checks: OpsReviewCheck[] = [];

  // --- Aircraft availability ---
  const aircraftId = trip.quote.selectedOption?.aircraftId;
  if (legs.length === 0) {
    checks.push({ label: "Aircraft Availability", passed: false, notes: ["No itinerary to check."] });
  } else if (!aircraftId) {
    // Brokered aircraft belong to a third-party operator — JetDeck has no
    // visibility into their maintenance/scheduling, so this isn't a
    // blocker, just a reminder it wasn't actually verified.
    checks.push({
      label: "Aircraft Availability",
      passed: true,
      notes: ["Brokered aircraft — availability isn't tracked in JetDeck; verify with the source operator."],
    });
  } else {
    const notes: string[] = [];
    const candidates = await prisma.quote.findMany({
      where: {
        operatorId,
        id: { not: trip.quoteId },
        status: { in: ["accepted", "pending_confirmation", "approved"] },
        selectedOption: { aircraftId },
      },
      select: { id: true, quoteNumber: true, selectedOption: { select: { aircraftId: true, itinerary: true } } },
    });
    const conflict = findConflictingBooking(
      aircraftId,
      itinerary,
      candidates.map((c) => ({
        id: c.id,
        quoteNumber: c.quoteNumber,
        aircraftId: c.selectedOption?.aircraftId ?? null,
        itinerary: c.selectedOption?.itinerary,
      })),
      trip.quoteId
    );
    if (conflict) {
      notes.push(`Conflicts with ${conflict.booking.quoteNumber} (${conflict.startDate} – ${conflict.endDate}).`);
    }

    const dates = legs.map((l) => legDateIso(l)).filter((d): d is string => Boolean(d)).sort();
    const tripStart = dates[0];
    const tripEnd = dates[dates.length - 1];
    const downtimes = await prisma.aircraftDowntime.findMany({ where: { aircraftId } });
    for (const d of downtimes) {
      if (tripStart <= d.endDate && d.startDate <= tripEnd) {
        notes.push(`Down for maintenance ${d.startDate} – ${d.endDate}${d.reason ? ` (${d.reason})` : ""}.`);
      }
    }
    checks.push({ label: "Aircraft Availability", passed: notes.length === 0, notes });
  }

  // Brokered trips fly with the source operator's own crew, not this
  // operator's roster — there's nothing here to check qualification or
  // duty-time compliance against, and doing so would be checking the
  // wrong people entirely. Compliance is the source operator's
  // responsibility; ops just records who's flying as free text
  // (Trip.brokeredCaptainName/brokeredCoPilotName/brokeredCabinHostName)
  // instead of a real CrewMember assignment.
  if (trip.quote.selectedOption?.fleetSource === "brokered") {
    const names = [
      trip.brokeredCaptainName && `Captain: ${trip.brokeredCaptainName}`,
      trip.brokeredCoPilotName && `Co-Pilot: ${trip.brokeredCoPilotName}`,
      trip.brokeredCabinHostName && `Cabin Host: ${trip.brokeredCabinHostName}`,
    ].filter((n): n is string => Boolean(n));
    checks.push({
      label: "Crew",
      passed: true,
      notes: [
        "Brokered aircraft — crew is the source operator's own; not tracked or checked here.",
        ...names,
      ],
    });
    return { passed: checks.every((c) => c.passed), checks };
  }

  // --- Crew qualification ---
  const pilots = trip.crewAssignments.filter((a) => PILOT_ROLES.includes(a.crew.role));
  if (pilots.length === 0) {
    checks.push({ label: "Crew Assigned & Qualified", passed: false, notes: ["No pilot assigned."] });
    checks.push({ label: "Duty Time Compliance", passed: false, notes: ["No pilot assigned."] });
    return { passed: checks.every((c) => c.passed), checks };
  }

  const qualNotes: string[] = [];
  for (const p of pilots) {
    const qual = crewQualificationStatus(p.crew);
    if (qual !== "qualified") {
      qualNotes.push(`${p.crew.name}: ${QUALIFICATION_STATUS_LABELS[qual]}.`);
    }
  }
  checks.push({ label: "Crew Assigned & Qualified", passed: qualNotes.length === 0, notes: qualNotes });

  // --- Duty time compliance (§135.263 + §135.267) ---
  if (legs.length === 0) {
    checks.push({ label: "Duty Time Compliance", passed: false, notes: ["No itinerary to check."] });
    return { passed: checks.every((c) => c.passed), checks };
  }

  const otherAssignmentsByPilot = new Map<string, Awaited<ReturnType<typeof fetchOtherAssignments>>>();
  for (const p of pilots) {
    otherAssignmentsByPilot.set(p.crewId, await fetchOtherAssignments(p.crewId, tripId, operatorId));
  }

  const allCodes = new Set<string>();
  for (const l of legs) {
    if (l.depAirport) allCodes.add(l.depAirport);
  }
  for (const others of otherAssignmentsByPilot.values()) {
    for (const a of others) {
      for (const l of revenueLegsOf(a.trip.quote.selectedOption?.itinerary)) {
        if (l.depAirport) allCodes.add(l.depAirport);
      }
    }
  }
  const airportRows = allCodes.size ? await prisma.airport.findMany({ where: { icao: { in: [...allCodes] } } }) : [];
  const tzByIcao = Object.fromEntries(
    airportRows.map((a) => [a.icao, resolveAirportTimezone(a.timezone, a.lat, a.lon)])
  );

  // A trip's own legs can split into more than one duty period (e.g. a
  // round trip with days between the outbound and return legs) — each
  // one is checked independently, since they're separate days of flying
  // with rest in between, not one continuous multi-day duty period.
  const thisDutyPeriods = computeDutyPeriods(itinerary, tzByIcao);
  const dutyNotes: string[] = [];
  if (thisDutyPeriods.length === 0) {
    dutyNotes.push("Can't verify — one or more legs is missing a departure date/time.");
  } else {
    // A flight crewmember qualified under this part flying alongside
    // another pilot is a 2-pilot crew (higher flight-time cap) — anything
    // else (solo, or more crew than that) defaults to the stricter 1-pilot
    // cap, since §135.269's 3/4-pilot provisions aren't implemented here.
    const pilotCount = pilots.length === 2 ? 2 : 1;
    const multiDay = thisDutyPeriods.length > 1;
    for (const p of pilots) {
      const others = otherAssignmentsByPilot.get(p.crewId) ?? [];
      const otherTripDutyPeriods = others.flatMap((a) =>
        computeDutyPeriods(a.trip.quote.selectedOption?.itinerary, tzByIcao).map((dp) => ({
          tripId: a.tripId,
          start: dp.start,
          end: dp.end,
        }))
      );

      for (let i = 0; i < thisDutyPeriods.length; i++) {
        const period = thisDutyPeriods[i];
        // Rest between this trip's own other duty periods matters too —
        // a round trip split close enough to land as two periods (but
        // still short of real rest) would otherwise only ever get
        // compared against unrelated other trips and never against
        // itself.
        const sameTripOtherPeriods = thisDutyPeriods
          .filter((_, j) => j !== i)
          .map((dp) => ({ tripId, start: dp.start, end: dp.end }));

        const dutyIssues = checkDutyCompliance(period, pilotCount, [
          ...otherTripDutyPeriods,
          ...sameTripOtherPeriods,
        ]);
        const dayLabel = multiDay ? ` (${period.start.toISOString().slice(0, 10)})` : "";
        for (const issue of dutyIssues) {
          dutyNotes.push(`${p.crew.name}${dayLabel}: ${dutyComplianceIssueLabel(issue)}`);
        }
      }
    }
  }
  checks.push({ label: "Duty Time Compliance", passed: dutyNotes.length === 0, notes: dutyNotes });

  return { passed: checks.every((c) => c.passed), checks };
}

// "Ready for Release" needs more than the Ops Review checklist passing —
// the operator's own spec: checklist complete, itinerary sent, payment
// secured, and crew has acknowledged the trip. The last one has no crew
// app to source it from yet, so it's an explicit ops override
// (Trip.crewAcknowledgedAt) standing in for that event.
export async function evaluateReleaseReadiness(
  tripId: string,
  operatorId: string,
  opsReview: OpsReviewResult
): Promise<OpsReviewResult> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, operatorId },
    include: { quote: { include: { contact: true } } },
  });
  if (!trip) {
    return { passed: false, checks: [{ label: "Trip", passed: false, notes: ["Trip not found."] }] };
  }

  const checks: OpsReviewCheck[] = [
    { label: "Ops Review Checklist", passed: opsReview.passed, notes: opsReview.passed ? [] : ["See Ops Review Checklist above."] },
    {
      label: "Itinerary Sent",
      passed: Boolean(trip.itinerarySentAt),
      notes: trip.itinerarySentAt ? [] : ["Send the itinerary to the client first."],
    },
    {
      label: "Payment Secured",
      passed: isTripPaid(trip.quote),
      notes: isTripPaid(trip.quote) ? [] : ["Payment hasn't been confirmed yet."],
    },
    {
      label: "Crew Acknowledged",
      passed: Boolean(trip.crewAcknowledgedAt),
      notes: trip.crewAcknowledgedAt
        ? []
        : ["Stand-in for the crew app — mark this once crew has confirmed the trip."],
    },
  ];

  return { passed: checks.every((c) => c.passed), checks };
}

// "Released (Brokered)" is the brokered pipeline's terminal stage — the
// operator's spec for it only names two things: the Ops Review checklist
// and the itinerary having gone out to the client. Unlike
// evaluateReleaseReadiness above, payment and crew acknowledgment aren't
// part of this gate — the operator didn't ask for them here, and crew
// acknowledgment in particular presumes a JetDeck crew app event that
// doesn't apply to a source operator's own crew.
export async function evaluateBrokeredReleaseReadiness(
  tripId: string,
  operatorId: string,
  opsReview: OpsReviewResult
): Promise<OpsReviewResult> {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, operatorId } });
  if (!trip) {
    return { passed: false, checks: [{ label: "Trip", passed: false, notes: ["Trip not found."] }] };
  }

  const checks: OpsReviewCheck[] = [
    { label: "Ops Review Checklist", passed: opsReview.passed, notes: opsReview.passed ? [] : ["See Ops Review Checklist above."] },
    {
      label: "Itinerary Sent",
      passed: Boolean(trip.itinerarySentAt),
      notes: trip.itinerarySentAt ? [] : ["Send the itinerary to the client first."],
    },
  ];

  return { passed: checks.every((c) => c.passed), checks };
}
