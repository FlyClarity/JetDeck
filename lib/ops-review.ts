// Orchestrates the Ops Review checklist: aircraft availability, crew
// qualification, and duty-time compliance. Used both to render the
// checklist on the trip detail page and to re-verify server-side before
// actually approving — same function either way, so the button's enabled
// state and what the approve action actually enforces can never drift
// apart.
import { prisma } from "@/lib/prisma";
import { revenueLegsOf, legDateIso, findConflictingBooking } from "@/lib/itinerary";
import { computeDutyPeriod, checkDutyCompliance, dutyComplianceIssueLabel } from "@/lib/duty-time";
import { PILOT_ROLES, crewQualificationStatus, QUALIFICATION_STATUS_LABELS } from "@/lib/crew";
import { resolveAirportTimezone } from "@/lib/geo";

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

  const thisDuty = computeDutyPeriod(itinerary, tzByIcao);
  const dutyNotes: string[] = [];
  if (!thisDuty) {
    dutyNotes.push("Can't verify — one or more legs is missing a departure date/time.");
  } else {
    // A flight crewmember qualified under this part flying alongside
    // another pilot is a 2-pilot crew (higher flight-time cap) — anything
    // else (solo, or more crew than that) defaults to the stricter 1-pilot
    // cap, since §135.269's 3/4-pilot provisions aren't implemented here.
    const pilotCount = pilots.length === 2 ? 2 : 1;
    for (const p of pilots) {
      const others = otherAssignmentsByPilot.get(p.crewId) ?? [];
      const otherDutyPeriods = others
        .map((a) => {
          const dp = computeDutyPeriod(a.trip.quote.selectedOption?.itinerary, tzByIcao);
          return dp ? { tripId: a.tripId, start: dp.start, end: dp.end } : null;
        })
        .filter((d): d is { tripId: string; start: Date; end: Date } => Boolean(d));

      const dutyIssues = checkDutyCompliance(thisDuty, pilotCount, otherDutyPeriods);
      for (const issue of dutyIssues) {
        dutyNotes.push(`${p.crew.name}: ${dutyComplianceIssueLabel(issue)}`);
      }
    }
  }
  checks.push({ label: "Duty Time Compliance", passed: dutyNotes.length === 0, notes: dutyNotes });

  return { passed: checks.every((c) => c.passed), checks };
}
