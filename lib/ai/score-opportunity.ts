import { prisma } from "@/lib/prisma";
import type { Aircraft, TripRequest } from "@/lib/generated/prisma/client";
import { greatCircleDistanceNm, estimateFlightHours } from "@/lib/geo";
import { resolveAirportCodesToIcao } from "@/lib/airport-server";

export type OpportunityScoreResult = {
  opportunityScore: "high" | "medium" | "low" | "pass";
  scoreReason: string;
  positioningNote: string | null;
  historyNote: string | null;
  recommendedAction: "quote_now" | "review" | "pass";
};

type Leg = { depAirport?: string; arrAirport?: string; date?: string };
type ItineraryLeg = {
  depAirport?: string | null;
  arrAirport?: string | null;
  date?: string | null;
  depDt?: string | null;
};
type AircraftLeg = { depAirport: string; arrAirport: string; date: string };

// Repositioning-time tiers, in estimated flight hours (no block-time buffer
// added — this is a rough scoring heuristic, not a billing calculation).
// A 20-minute repo and a 3-hour cross-country repo are not the same
// opportunity and shouldn't both land in the same bucket. Beyond the medium
// threshold, the trip auto-passes instead of scoring low (see below).
const REPO_HIGH_HOURS = 0.75;
const REPO_MEDIUM_HOURS = 2;

// A window of free time in an aircraft's schedule — between two confirmed
// commitments, before the first, or after the last. "Free" doesn't mean
// "at home doing nothing": an aircraft sitting at an away airport for days
// between two legs of the same trip (waiting for a return flight) is just
// as much a gap as one sitting idle at home — the whole point is that a
// gap is an opportunity to fill, not a reason to treat the aircraft as
// unavailable. startAnchor is where the aircraft arrives from (the start
// of the gap); endAnchor is where it needs to depart from next — either
// the next confirmed leg's departure airport, or home base if nothing
// else is booked. Null dates mean unbounded (open now / nothing booked
// after).
type Gap = {
  startAnchor: string;
  startDate: string | null;
  endAnchor: string;
  endDate: string | null;
};

function legDateIso(leg: { date?: string | null; depDt?: string | null }): string | null {
  return leg.date ?? (leg.depDt ? leg.depDt.slice(0, 10) : null);
}

// Every confirmed leg (revenue or repositioning — both are real scheduled
// commitments) across every active trip on this tail, sorted
// chronologically, turned into the sequence of gaps between them.
function buildGapsForAircraft(
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
function findFittingGap(gaps: Gap[], requestStart: string, requestEnd: string): Gap | null {
  return (
    gaps.find(
      (g) =>
        (g.startDate === null || g.startDate <= requestStart) &&
        (g.endDate === null || requestEnd <= g.endDate)
    ) ?? null
  );
}

function repoLabel(hours: number): string {
  const minutes = Math.round(hours * 60);
  return minutes < 60 ? `${minutes}min` : `${hours.toFixed(1)}hr`;
}

export async function scoreOpportunity(
  tripRequestId: string
): Promise<OpportunityScoreResult> {
  await prisma.tripRequest.update({
    where: { id: tripRequestId },
    data: { status: "scoring" },
  });

  const tripRequest = await prisma.tripRequest.findUniqueOrThrow({
    where: { id: tripRequestId },
  });

  const legs = (tripRequest.legs as Leg[] | null) ?? [];
  const firstLegRaw = legs[0];
  const lastLegRaw = legs[legs.length - 1];

  if (!firstLegRaw?.depAirport || !firstLegRaw?.date || !lastLegRaw?.arrAirport || !lastLegRaw?.date) {
    return finalize(tripRequestId, {
      opportunityScore: "low",
      scoreReason: "Trip details incomplete — needs manual review",
      positioningNote: null,
      historyNote: null,
      recommendedAction: "review",
    });
  }

  // AI-extracted (and some manually entered) legs sometimes carry the
  // 3-letter IATA code (e.g. "SAN") instead of the 4-letter ICAO code
  // ("KSAN") this function and the rest of the app assume. Normalize once
  // here so every lookup and comparison below just works.
  const codeMap = await resolveAirportCodesToIcao([
    firstLegRaw.depAirport,
    firstLegRaw.arrAirport,
    lastLegRaw.depAirport,
    lastLegRaw.arrAirport,
  ]);
  const resolve = (code?: string) => (code ? (codeMap[code.toUpperCase()] ?? code) : code);

  const firstLeg: Leg = {
    ...firstLegRaw,
    depAirport: resolve(firstLegRaw.depAirport),
    arrAirport: resolve(firstLegRaw.arrAirport),
  };
  const lastLeg: Leg = {
    ...lastLegRaw,
    depAirport: resolve(lastLegRaw.depAirport),
    arrAirport: resolve(lastLegRaw.arrAirport),
  };

  const historyNote = await buildHistoryNote(tripRequest);

  const allActive = await prisma.aircraft.findMany({
    where: { operatorId: tripRequest.operatorId, status: "active" },
  });

  if (allActive.length === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: "No active aircraft in fleet",
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  // Range is a hard constraint — an aircraft either can physically make the
  // trip or it can't. Category preference (below) is not, and is no longer
  // treated like one: a good routing/positioning fit on an off-preference
  // aircraft can still win the business rather than being passed on outright.
  const [depAirport, arrAirport] = await Promise.all([
    prisma.airport.findUnique({ where: { icao: firstLeg.depAirport! } }),
    firstLeg.arrAirport
      ? prisma.airport.findUnique({ where: { icao: firstLeg.arrAirport } })
      : Promise.resolve(null),
  ]);
  const legDistanceNm =
    depAirport && arrAirport
      ? greatCircleDistanceNm(depAirport.lat, depAirport.lon, arrAirport.lat, arrAirport.lon)
      : null;

  const reachable = allActive.filter(
    (a) => !a.rangeNm || legDistanceNm === null || a.rangeNm >= legDistanceNm
  );

  if (reachable.length === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: `Route (~${Math.round(legDistanceNm ?? 0)}nm) exceeds every active aircraft's range`,
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  // Every confirmed leg (revenue or repositioning) across every active trip
  // on each reachable tail — the raw material for each aircraft's gap
  // timeline below. Grouped by aircraft rather than checked one date at a
  // time, so a multi-day trip's "sitting" period between two of its own
  // legs is visible as free time, not lumped in as a blanket conflict.
  const activeTrips = await prisma.trip.findMany({
    where: {
      operatorId: tripRequest.operatorId,
      status: { notIn: ["closed", "invoiced"] },
      quote: { selectedOption: { aircraftId: { in: reachable.map((a) => a.id) } } },
    },
    include: { quote: { include: { selectedOption: true } } },
  });

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

  // For each reachable aircraft, find whichever gap in its schedule (if
  // any) cleanly contains this request's whole date range. An aircraft
  // with no fitting gap is excluded entirely — not "busy that day," but
  // genuinely unavailable without bumping an existing commitment.
  const fitted = reachable
    .map((aircraft) => {
      const gaps = buildGapsForAircraft(
        legsByAircraft.get(aircraft.id) ?? [],
        aircraft.currentBase ?? aircraft.homeBase,
        aircraft.homeBase
      );
      const gap = findFittingGap(gaps, firstLeg.date!, lastLeg.date!);
      return gap ? { aircraft, gap } : null;
    })
    .filter((x): x is { aircraft: Aircraft; gap: Gap } => x !== null);

  if (fitted.length === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: "No aircraft has an open slot for these dates — would require rescheduling an existing booking",
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  // Category is a soft preference: prefer a match, but fall back to the
  // full available pool instead of passing when nothing matches exactly.
  const categoryMatches = tripRequest.aircraftPref
    ? fitted.filter((f) => f.aircraft.category === tripRequest.aircraftPref)
    : fitted;
  const pool = categoryMatches.length > 0 ? categoryMatches : fitted;
  const offCategory = tripRequest.aircraftPref !== null && categoryMatches.length === 0;

  // Must include the trip request's own dep/arr airports, not just each
  // aircraft's gap boundaries — repoHoursBetween below measures distance
  // *from* a gap anchor *to* firstLeg.depAirport/lastLeg.arrAirport, so
  // leaving those two out of the resolved set meant that lookup always
  // missed, pickup/dropoff hours came back null on every request, and the
  // 2-hour repositioning cap below (gated on knowing pickupHours) never
  // actually ran.
  const anchorsToResolve = [
    ...new Set([
      ...pool.flatMap((f) => [f.gap.startAnchor, f.gap.endAnchor]),
      firstLeg.depAirport!,
      lastLeg.arrAirport!,
    ]),
  ];
  const anchorAirports = await prisma.airport.findMany({ where: { icao: { in: anchorsToResolve } } });
  const anchorByIcao = Object.fromEntries(anchorAirports.map((a) => [a.icao, a]));

  function repoHoursBetween(fromIcao: string, toIcao: string, cruiseSpeedKts: number | null): number | null {
    if (fromIcao === toIcao) return 0;
    const from = anchorByIcao[fromIcao];
    const to = anchorByIcao[toIcao];
    if (!from || !to || !cruiseSpeedKts) return null;
    const distanceNm = greatCircleDistanceNm(from.lat, from.lon, to.lat, to.lon);
    return estimateFlightHours(distanceNm, cruiseSpeedKts, 0);
  }

  const scored = pool.map(({ aircraft, gap }) => ({
    aircraft,
    gap,
    pickupHours: repoHoursBetween(gap.startAnchor, firstLeg.depAirport!, aircraft.cruiseSpeedKts),
    dropoffHours: repoHoursBetween(lastLeg.arrAirport!, gap.endAnchor, aircraft.cruiseSpeedKts),
  }));

  function categoryNoteFor(aircraft: Aircraft): string {
    return offCategory
      ? ` (${aircraft.tailNumber} is ${aircraft.category}, not the requested ${tripRequest.aircraftPref} — flagged as a good fit anyway rather than passed)`
      : "";
  }

  // The 2-hour pickup-repositioning cap is a hard eligibility filter, not
  // just a tiebreaker on top of it — an aircraft too far out of position to
  // reach the client at all shouldn't be able to win the ranking below just
  // because it happens to end up well-positioned for whatever's next.
  // Unknown pickup distance (no cruise speed / airport data) is kept rather
  // than excluded, same as always — scored medium further down instead of
  // silently dropped.
  const withinPickupRange = scored.filter((s) => s.pickupHours === null || s.pickupHours <= REPO_MEDIUM_HOURS);

  if (withinPickupRange.length === 0) {
    const nearest = scored.reduce((best, s) =>
      (s.pickupHours ?? Infinity) < (best.pickupHours ?? Infinity) ? s : best
    );
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: `Nearest open aircraft (${nearest.aircraft.tailNumber}) requires a ${repoLabel(nearest.pickupHours ?? 0)} repositioning to pick up — too far out of position${categoryNoteFor(nearest.aircraft)}`,
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  // Among aircraft close enough to actually take the trip, productive
  // repositioning matters more than cheap pickup — one that ends up
  // well-positioned for whatever's next outranks one that's merely
  // convenient to grab, even if that one's pickup leg is shorter.
  const ranked = withinPickupRange.sort((a, b) => {
    const dropoffDiff = (a.dropoffHours ?? Infinity) - (b.dropoffHours ?? Infinity);
    if (dropoffDiff !== 0) return dropoffDiff;
    return (a.pickupHours ?? Infinity) - (b.pickupHours ?? Infinity);
  });

  const chosen = ranked[0];
  const categoryNote = categoryNoteFor(chosen.aircraft);

  const pickupPhrase =
    chosen.pickupHours === null
      ? "pickup distance unknown"
      : chosen.pickupHours === 0
        ? `already at ${firstLeg.depAirport}`
        : `${repoLabel(chosen.pickupHours)} repositioning from ${chosen.gap.startAnchor} to pick up`;
  const dropoffPhrase =
    chosen.dropoffHours === null
      ? "repositioning fit for what's next is unknown"
      : chosen.dropoffHours === 0
        ? chosen.gap.endDate
          ? `lands exactly where it needs to be for its ${chosen.gap.endDate} departure`
          : "lands right at home base"
        : chosen.gap.endDate
          ? `then ${repoLabel(chosen.dropoffHours)} short of where it needs to be for its ${chosen.gap.endDate} departure from ${chosen.gap.endAnchor}`
          : `then ${repoLabel(chosen.dropoffHours)} from home base (${chosen.gap.endAnchor})`;
  const positioningNote = `${chosen.aircraft.tailNumber}: ${pickupPhrase}, ${dropoffPhrase}`;

  if (chosen.pickupHours === null) {
    return finalize(tripRequestId, {
      opportunityScore: "medium",
      scoreReason: `${chosen.aircraft.tailNumber} has an open slot for these dates but positioning distance is unknown${categoryNote}`,
      positioningNote,
      historyNote,
      recommendedAction: "quote_now",
    });
  }

  // chosen is drawn from withinPickupRange, so pickupHours here is
  // guaranteed <= REPO_MEDIUM_HOURS (the null case already returned above)
  // — the >REPO_MEDIUM_HOURS auto-pass already happened earlier, before
  // ranking, when no aircraft made it into withinPickupRange at all.
  return finalize(tripRequestId, {
    opportunityScore: chosen.pickupHours <= REPO_HIGH_HOURS ? "high" : "medium",
    scoreReason: `${positioningNote}${categoryNote}`,
    positioningNote,
    historyNote,
    recommendedAction: "quote_now",
  });
}

async function buildHistoryNote(tripRequest: TripRequest): Promise<string | null> {
  const domain = tripRequest.requestorEmail.split("@")[1];
  if (!domain) return null;

  const priorRequestCount = await prisma.tripRequest.count({
    where: {
      operatorId: tripRequest.operatorId,
      requestorEmail: { endsWith: `@${domain}` },
      id: { not: tripRequest.id },
    },
  });

  if (priorRequestCount === 0) return null;

  const recentQuote = await prisma.quote.findFirst({
    where: {
      operatorId: tripRequest.operatorId,
      contact: { email: { endsWith: `@${domain}` } },
    },
    orderBy: { createdAt: "desc" },
    include: { selectedOption: true },
  });

  if (recentQuote?.selectedOption) {
    return `Quoted this broker before — most recent quote ${recentQuote.quoteNumber} (${recentQuote.status}) at $${recentQuote.selectedOption.total.toLocaleString()}`;
  }

  return `${priorRequestCount} prior request${priorRequestCount === 1 ? "" : "s"} from this domain`;
}

async function finalize(
  tripRequestId: string,
  score: OpportunityScoreResult
): Promise<OpportunityScoreResult> {
  await prisma.tripRequest.update({
    where: { id: tripRequestId },
    data: {
      opportunityScore: score.opportunityScore,
      scoreReason: score.scoreReason,
      positioningNote: score.positioningNote,
      historyNote: score.historyNote,
      recommendedAction: score.recommendedAction,
      aiProcessedAt: new Date(),
      status: score.recommendedAction === "pass" ? "passed" : "ready",
    },
  });
  return score;
}
