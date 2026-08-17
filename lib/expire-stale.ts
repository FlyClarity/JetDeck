import { prisma } from "@/lib/prisma";

type Leg = { date?: string | null; depDt?: string | null };

function legDateIso(leg: Leg): string | null {
  return leg.date ?? (leg.depDt ? leg.depDt.slice(0, 10) : null);
}

function lastLegDateIso(legs: unknown): string | null {
  const legArray = Array.isArray(legs) ? (legs as Leg[]) : [];
  for (let i = legArray.length - 1; i >= 0; i--) {
    const date = legDateIso(legArray[i]);
    if (date) return date;
  }
  return null;
}

// Run daily (see app/api/cron/expire-stale/route.ts) to flag trip requests
// and quotes nobody ever acted on before the flight itself happened —
// otherwise they sit in "Ready to Quote"/"Draft"/"Sent" forever, cluttering
// the operator's queue with leads that can no longer actually be booked.
// Marks status only; nothing is ever deleted, so the record (and any
// reporting value in it) stays intact.
export async function expireStaleRequestsAndQuotes(): Promise<{
  tripRequestsExpired: number;
  quotesExpired: number;
}> {
  const todayIso = new Date().toISOString().slice(0, 10);

  // Only requests that never made it to a quote — once a TripRequest has a
  // Quote, its fate is tracked through that Quote instead (see below), so
  // expiring the request itself here would be redundant.
  const candidateRequests = await prisma.tripRequest.findMany({
    where: { status: { in: ["new", "ready"] } },
    select: { id: true, legs: true },
  });
  const expiredRequestIds = candidateRequests
    .filter((r) => {
      const lastDate = lastLegDateIso(r.legs);
      return lastDate !== null && lastDate < todayIso;
    })
    .map((r) => r.id);

  if (expiredRequestIds.length > 0) {
    await prisma.tripRequest.updateMany({
      where: { id: { in: expiredRequestIds } },
      data: { status: "expired" },
    });
  }

  // Every non-terminal quote status — still awaiting either the operator
  // sending it, the client deciding, or the client signing.
  const candidateQuotes = await prisma.quote.findMany({
    where: { status: { in: ["draft", "sent", "pending_confirmation", "approved"] } },
    include: { selectedOption: { select: { itinerary: true } } },
  });
  const expiredQuoteIds = candidateQuotes
    .filter((q) => {
      const lastDate = lastLegDateIso(q.selectedOption?.itinerary);
      return lastDate !== null && lastDate < todayIso;
    })
    .map((q) => q.id);

  if (expiredQuoteIds.length > 0) {
    await prisma.quote.updateMany({
      where: { id: { in: expiredQuoteIds } },
      data: { status: "expired" },
    });
  }

  return {
    tripRequestsExpired: expiredRequestIds.length,
    quotesExpired: expiredQuoteIds.length,
  };
}
