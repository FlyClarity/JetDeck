export type StoredLeg = {
  billAs?: string;
  depAirport?: string | null;
  arrAirport?: string | null;
  date?: string | null;
  depDt?: string | null;
  flightHours?: number;
  depTime?: string | null;
  depTimeTBD?: boolean;
  arrTime?: string | null;
};

export function revenueLegsOf(itinerary: unknown): StoredLeg[] {
  const legs = (itinerary as StoredLeg[]) ?? [];
  return legs.filter((l) => (l.billAs ?? "revenue") === "revenue");
}

export function legDateIso(leg: StoredLeg): string | null {
  return leg.date || (leg.depDt ? leg.depDt.slice(0, 10) : null);
}

export function legDate(leg: StoredLeg): string {
  const iso = legDateIso(leg);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function legTimeLabel(leg: StoredLeg): string {
  const dep = leg.depTimeTBD || !leg.depTime ? "TBD" : leg.depTime;
  return leg.arrTime ? `Departs ${dep} · Arrives ${leg.arrTime}` : `Departs ${dep}`;
}

export function routeAndDateText(itinerary: unknown) {
  const legs = revenueLegsOf(itinerary);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const route = first ? `${first.depAirport ?? "?"} → ${last?.arrAirport ?? first.arrAirport ?? "?"}` : "your trip";
  const date = first ? legDate(first) : "";
  return { route, date };
}

export type ConflictCandidate = {
  id: string;
  quoteNumber: string;
  aircraftId: string | null;
  itinerary: unknown;
};

export type BookingConflict = {
  booking: ConflictCandidate;
  date: string;
};

// Pure same-aircraft, same-date overlap check — no database access, so it can
// run both server-side (lib/booking-server.ts, backed by a Prisma query) and
// client-side (the Quote Builder, backed by candidates fetched once on page
// load) for instant feedback as the operator edits aircraft/legs.
export function findConflictingBooking(
  aircraftId: string | null | undefined,
  itinerary: unknown,
  candidates: ConflictCandidate[],
  excludeId?: string | null
): BookingConflict | null {
  if (!aircraftId) return null;

  const thisDates = new Set(
    revenueLegsOf(itinerary)
      .map(legDateIso)
      .filter((d): d is string => Boolean(d))
  );
  if (thisDates.size === 0) return null;

  for (const other of candidates) {
    if (other.aircraftId !== aircraftId) continue;
    if (excludeId && other.id === excludeId) continue;
    const overlap = revenueLegsOf(other.itinerary)
      .map(legDateIso)
      .find((d) => d && thisDates.has(d));
    if (overlap) {
      return { booking: other, date: overlap };
    }
  }
  return null;
}
