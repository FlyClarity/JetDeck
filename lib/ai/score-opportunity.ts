import { prisma } from "@/lib/prisma";
import type { TripRequest } from "@/lib/generated/prisma/client";
import { greatCircleDistanceNm, estimateFlightHours } from "@/lib/geo";

export type OpportunityScoreResult = {
  opportunityScore: "high" | "medium" | "low" | "pass";
  scoreReason: string;
  positioningNote: string | null;
  historyNote: string | null;
  recommendedAction: "quote_now" | "review" | "pass";
};

type Leg = { depAirport?: string; arrAirport?: string; date?: string };
type ItineraryLeg = { depDt?: string };

// Repositioning-time tiers, in estimated flight hours (no block-time buffer
// added — this is a rough scoring heuristic, not a billing calculation).
// A 20-minute repo and a 3-hour cross-country repo are not the same
// opportunity and shouldn't both land in the same bucket. Beyond the medium
// threshold, the trip auto-passes instead of scoring low (see below).
const REPO_HIGH_HOURS = 0.75;
const REPO_MEDIUM_HOURS = 2;

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
  const firstLeg = legs[0];

  if (!firstLeg?.depAirport || !firstLeg?.date) {
    return finalize(tripRequestId, {
      opportunityScore: "low",
      scoreReason: "Trip details incomplete — needs manual review",
      positioningNote: null,
      historyNote: null,
      recommendedAction: "review",
    });
  }

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
    prisma.airport.findUnique({ where: { icao: firstLeg.depAirport } }),
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

  const activeTrips = await prisma.trip.findMany({
    where: {
      operatorId: tripRequest.operatorId,
      status: { notIn: ["closed", "invoiced"] },
      quote: { aircraftId: { in: reachable.map((a) => a.id) } },
    },
    include: { quote: true },
  });

  function isAircraftBusy(aircraftId: string) {
    return activeTrips.some((trip) => {
      if (trip.quote.aircraftId !== aircraftId) return false;
      const itinerary = (trip.quote.itinerary as ItineraryLeg[] | null) ?? [];
      return itinerary.some((leg) => leg.depDt?.slice(0, 10) === firstLeg.date);
    });
  }

  const available = reachable.filter((a) => !isAircraftBusy(a.id));

  if (available.length === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: `Conflicts with a confirmed trip on ${reachable[0].tailNumber}`,
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  // Category is a soft preference: prefer a match, but fall back to the
  // full available pool instead of passing when nothing matches exactly.
  const categoryMatches = tripRequest.aircraftPref
    ? available.filter((a) => a.category === tripRequest.aircraftPref)
    : available;
  const pool = categoryMatches.length > 0 ? categoryMatches : available;
  const offCategory = tripRequest.aircraftPref !== null && categoryMatches.length === 0;

  // Rank by actual repositioning distance rather than a binary
  // positioned-or-not.
  const basesToResolve = [...new Set(pool.map((a) => a.currentBase ?? a.homeBase))];
  const baseAirports = await prisma.airport.findMany({
    where: { icao: { in: basesToResolve } },
  });
  const baseAirportByIcao = Object.fromEntries(baseAirports.map((a) => [a.icao, a]));

  const ranked = pool
    .map((a) => {
      const base = a.currentBase ?? a.homeBase;
      if (base === firstLeg.depAirport) {
        return { aircraft: a, repoHours: 0 as number | null, base };
      }
      const baseAirport = baseAirportByIcao[base];
      if (!baseAirport || !depAirport || !a.cruiseSpeedKts) {
        return { aircraft: a, repoHours: null, base };
      }
      const distanceNm = greatCircleDistanceNm(
        baseAirport.lat,
        baseAirport.lon,
        depAirport.lat,
        depAirport.lon
      );
      return { aircraft: a, repoHours: estimateFlightHours(distanceNm, a.cruiseSpeedKts, 0), base };
    })
    .sort((a, b) => (a.repoHours ?? Infinity) - (b.repoHours ?? Infinity));

  const chosen = ranked[0];
  const categoryNote = offCategory
    ? ` (${chosen.aircraft.tailNumber} is ${chosen.aircraft.category}, not the requested ${tripRequest.aircraftPref} — flagged as a good fit anyway rather than passed)`
    : "";

  if (chosen.repoHours === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "high",
      scoreReason: `${chosen.aircraft.tailNumber} already in ${firstLeg.depAirport}${categoryNote}`,
      positioningNote: `${chosen.aircraft.tailNumber} is currently based at ${firstLeg.depAirport} — no repositioning needed`,
      historyNote,
      recommendedAction: "quote_now",
    });
  }

  if (chosen.repoHours === null) {
    // Can't compute a distance (missing airport or cruise-speed data) —
    // fall back to the old qualitative behavior rather than guessing.
    return finalize(tripRequestId, {
      opportunityScore: "medium",
      scoreReason: `${chosen.aircraft.tailNumber} available but requires repositioning from ${chosen.base}${categoryNote}`,
      positioningNote: `Nearest available aircraft (${chosen.aircraft.tailNumber}) is based at ${chosen.base}, not ${firstLeg.depAirport} — repositioning distance unknown`,
      historyNote,
      recommendedAction: "quote_now",
    });
  }

  const repoMinutes = Math.round(chosen.repoHours * 60);
  const repoLabel = repoMinutes < 60 ? `${repoMinutes}min` : `${chosen.repoHours.toFixed(1)}hr`;

  // Beyond the medium threshold, even the closest available aircraft is too
  // far out of position to be worth quoting — auto-pass instead of scoring
  // it low and leaving it in the queue.
  if (chosen.repoHours > REPO_MEDIUM_HOURS) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: `Nearest aircraft (${chosen.aircraft.tailNumber}) requires a ${repoLabel} repositioning from ${chosen.base} — too far out of position${categoryNote}`,
      positioningNote: `Nearest available aircraft (${chosen.aircraft.tailNumber}) is based at ${chosen.base}, ~${repoLabel} from ${firstLeg.depAirport}`,
      historyNote,
      recommendedAction: "pass",
    });
  }

  return finalize(tripRequestId, {
    opportunityScore: chosen.repoHours <= REPO_HIGH_HOURS ? "high" : "medium",
    scoreReason: `${chosen.aircraft.tailNumber} requires a ${repoLabel} repositioning from ${chosen.base}${categoryNote}`,
    positioningNote: `Nearest available aircraft (${chosen.aircraft.tailNumber}) is based at ${chosen.base}, ~${repoLabel} from ${firstLeg.depAirport}`,
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
  });

  if (recentQuote) {
    return `Quoted this broker before — most recent quote ${recentQuote.quoteNumber} (${recentQuote.status}) at $${recentQuote.total.toLocaleString()}`;
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
