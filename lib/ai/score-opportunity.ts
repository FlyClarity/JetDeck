import { prisma } from "@/lib/prisma";
import type { TripRequest } from "@/lib/generated/prisma/client";

export type OpportunityScoreResult = {
  opportunityScore: "high" | "medium" | "low" | "pass";
  scoreReason: string;
  positioningNote: string | null;
  historyNote: string | null;
  recommendedAction: "quote_now" | "review" | "pass";
};

type Leg = { depAirport?: string; arrAirport?: string; date?: string };
type ItineraryLeg = { depDt?: string };

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

  const candidateAircraft = await prisma.aircraft.findMany({
    where: {
      operatorId: tripRequest.operatorId,
      status: "active",
      ...(tripRequest.aircraftPref ? { category: tripRequest.aircraftPref } : {}),
    },
  });

  const historyNote = await buildHistoryNote(tripRequest);

  if (candidateAircraft.length === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: tripRequest.aircraftPref
        ? `No active ${tripRequest.aircraftPref} aircraft in fleet`
        : "No active aircraft in fleet",
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  const activeTrips = await prisma.trip.findMany({
    where: {
      operatorId: tripRequest.operatorId,
      status: { notIn: ["closed", "invoiced"] },
      quote: { aircraftId: { in: candidateAircraft.map((a) => a.id) } },
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

  const available = candidateAircraft.filter((a) => !isAircraftBusy(a.id));

  if (available.length === 0) {
    return finalize(tripRequestId, {
      opportunityScore: "pass",
      scoreReason: `Conflicts with a confirmed trip on ${candidateAircraft[0].tailNumber}`,
      positioningNote: null,
      historyNote,
      recommendedAction: "pass",
    });
  }

  const positioned = available.find((a) => a.currentBase === firstLeg.depAirport);
  const chosen = positioned ?? available[0];

  if (positioned) {
    return finalize(tripRequestId, {
      opportunityScore: "high",
      scoreReason: `${chosen.tailNumber} already in ${firstLeg.depAirport}`,
      positioningNote: `${chosen.tailNumber} is currently based at ${firstLeg.depAirport} — no repositioning needed`,
      historyNote,
      recommendedAction: "quote_now",
    });
  }

  return finalize(tripRequestId, {
    opportunityScore: "medium",
    scoreReason: `${chosen.tailNumber} available but requires repositioning from ${chosen.currentBase ?? chosen.homeBase}`,
    positioningNote: `Nearest available aircraft (${chosen.tailNumber}) is based at ${chosen.currentBase ?? chosen.homeBase}, not ${firstLeg.depAirport}`,
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
