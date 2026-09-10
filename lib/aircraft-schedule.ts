import { prisma } from "@/lib/prisma";
import { nightsBetween } from "@/lib/geo";

export type AircraftLeg = { depAirport: string; arrAirport: string; date: string };

// A window of free time in an aircraft's schedule — between two confirmed
// commitments, before the first, or after the last. "Free" doesn't mean "at
// home doing nothing": an aircraft sitting at an away airport for days
// between two legs of the same trip (waiting for a return flight) is just as
// much a gap as one sitting idle at home. startAnchor is where the aircraft
// arrives from (the start of the gap); endAnchor is where it needs to depart
// from next — either the next confirmed leg's departure airport, or home
// base if nothing else is booked. Null dates mean unbounded (open now /
// nothing booked after).
export type Gap = {
  startAnchor: string;
  startDate: string | null;
  endAnchor: string;
  endDate: string | null;
};

export function legDateIso(leg: { date?: string | null; depDt?: string | null }): string | null {
  return leg.date ?? (leg.depDt ? leg.depDt.slice(0, 10) : null);
}

// Every confirmed leg (revenue or repositioning — both are real scheduled
// commitments) across every active trip on this tail, sorted chronologically,
// turned into the sequence of gaps between them.
export function buildGapsForAircraft(
  legs: AircraftLeg[],
  currentBase: string,
  homeBase: string
): Gap[] {
  const sorted = [...legs].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    return [{ startAnchor: currentBase, startDate: null, endAnchor: homeBase, endDate: null }];
  }

  const gaps: Gap[] = [
    { startAnchor: currentBase, startDate: null, endAnchor: sorted[0].depAirport, endDate: sorted[0].date },
  ];
  for (let i = 0; i < sorted.length - 1; i++) {
    gaps.push({
      startAnchor: sorted[i].arrAirport,
      startDate: sorted[i].date,
      endAnchor: sorted[i + 1].depAirport,
      endDate: sorted[i + 1].date,
    });
  }
  gaps.push({
    startAnchor: sorted[sorted.length - 1].arrAirport,
    startDate: sorted[sorted.length - 1].date,
    endAnchor: homeBase,
    endDate: null,
  });
  return gaps;
}

// The gap this request's own date range fits cleanly inside, if any. A
// request that starts in one gap but would still be in the air past that
// gap's end date doesn't fit anywhere — fulfilling it would mean bumping
// whatever's already confirmed next, which this function (deliberately)
// doesn't offer as an option.
export function findFittingGap(gaps: Gap[], requestStart: string, requestEnd: string): Gap | null {
  return (
    gaps.find(
      (g) =>
        (g.startDate === null || g.startDate <= requestStart) &&
        (g.endDate === null || requestEnd <= g.endDate)
    ) ?? null
  );
}

// Which gap a single date falls inside — used to find where an aircraft is
// actually expected to be on a given date, even when that date sits inside a
// gap too tight to cleanly fit a whole new request (findFittingGap would
// return null there — a real conflict the operator still needs to resolve,
// but the repositioning leg should still start from where the plane actually
// is instead of always defaulting to its permanent home base).
export function findGapForDate(gaps: Gap[], date: string): Gap | null {
  return (
    gaps.find(
      (g) => (g.startDate === null || g.startDate <= date) && (g.endDate === null || date <= g.endDate)
    ) ?? null
  );
}

export function findAnchorForDate(gaps: Gap[], date: string): string | null {
  return findGapForDate(gaps, date)?.startAnchor ?? null;
}

// Beyond this many idle days, repositioning the aircraft to wherever its
// next confirmed commitment happens to depart from stops being worth it —
// holding position for a day or two to be ready for a nearby next booking is
// normal, but sitting away from home for the better part of a week waiting
// on something a week out is not. Past this threshold the trailing leg
// defaults to home base instead, same as when there's no next commitment at
// all — that next trip's own leading repositioning leg (findAnchorForDate)
// will pick the aircraft back up from wherever it actually is when the time
// comes.
export const MAX_PRODUCTIVE_IDLE_DAYS = 3;

// Where the aircraft should reposition to right after finishing a trip that
// ends on `date`: the departure airport of whatever's confirmed next on this
// tail, but only when that commitment is close enough to be worth holding
// position for (see MAX_PRODUCTIVE_IDLE_DAYS). Returns null when there's no
// next commitment, or it's too far out — the caller falls back to home base
// either way, same as findAnchorForDate.
export function findTrailingAnchorForDate(gaps: Gap[], date: string): string | null {
  const gap = findGapForDate(gaps, date);
  if (!gap || gap.endDate === null) return null;
  if (nightsBetween(date, gap.endDate) > MAX_PRODUCTIVE_IDLE_DAYS) return null;
  return gap.endAnchor;
}

// Every active trip's legs on this operator's fleet, grouped by aircraft —
// the shared raw material behind both AI opportunity scoring
// (lib/ai/score-opportunity.ts) and the Quote Builder's "where does this
// aircraft actually start from" positioning.
export async function getActiveLegsByAircraft(
  operatorId: string,
  aircraftIds: string[]
): Promise<Map<string, AircraftLeg[]>> {
  const activeTrips = await prisma.trip.findMany({
    where: {
      operatorId,
      // Same cancelled-trip leak fixed elsewhere in the app (Board/Trips/
      // Calendar/AI scoring) — a cancelled trip's itinerary isn't a real
      // scheduling commitment.
      status: { notIn: ["closed", "invoiced", "cancelled", "cancelled_by_operator"] },
      quote: {
        status: { not: "cancelled" },
        selectedOption: { aircraftId: { in: aircraftIds } },
      },
    },
    include: { quote: { include: { selectedOption: true } } },
  });

  type ItineraryLeg = {
    depAirport?: string | null;
    arrAirport?: string | null;
    date?: string | null;
    depDt?: string | null;
  };

  const legsByAircraft = new Map<string, AircraftLeg[]>();
  for (const trip of activeTrips) {
    const aircraftId = trip.quote.selectedOption?.aircraftId;
    if (!aircraftId) continue;
    const itinerary = (trip.quote.selectedOption?.itinerary as ItineraryLeg[] | null) ?? [];
    const legList = legsByAircraft.get(aircraftId) ?? [];
    for (const leg of itinerary) {
      const date = legDateIso(leg);
      if (!leg.depAirport || !leg.arrAirport || !date) continue;
      legList.push({ depAirport: leg.depAirport, arrAirport: leg.arrAirport, date });
    }
    legsByAircraft.set(aircraftId, legList);
  }
  return legsByAircraft;
}
