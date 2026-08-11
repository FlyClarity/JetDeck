import { nightsBetween } from "@/lib/geo";

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

export function formatIsoDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function legDate(leg: StoredLeg): string {
  const iso = legDateIso(leg);
  if (!iso) return "";
  return formatIsoDate(iso);
}

export function legTimeLabel(leg: StoredLeg): string {
  const dep = leg.depTimeTBD || !leg.depTime ? "TBD" : leg.depTime;
  return leg.arrTime ? `Departs ${dep} · Arrives ${leg.arrTime}` : `Departs ${dep}`;
}

// Same gap-between-consecutive-revenue-legs math the Quote Builder uses live
// (see autoNightsAway in quote-builder-form.tsx), but computed from a saved
// itinerary instead of live leg state — used to split a saved
// Quote.overnightNights total back into its auto vs. manually-added-extra
// portions on reload, since only the combined total gets persisted.
export function autoNightsAwayOf(itinerary: unknown): number {
  const legs = revenueLegsOf(itinerary);
  let nights = 0;
  for (let i = 0; i < legs.length - 1; i++) {
    const start = legDateIso(legs[i]);
    const end = legDateIso(legs[i + 1]);
    if (start && end) nights += nightsBetween(start, end);
  }
  return nights;
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
  // ISO start/end of the *other* booking's away window that overlaps.
  startDate: string;
  endDate: string;
};

// The aircraft is presumed unavailable for the whole span between two
// consecutive revenue legs — not just on the exact days a leg departs. A
// 4-day owner trip (Sep 11 out, Sep 18 back) only has two leg dates, but the
// plane is gone the whole week; a quote landing anywhere in that window is a
// real conflict even though Sep 15 never appears in the owner trip's own
// leg dates.
//
// But that "away the whole time" assumption only holds for a gap the
// aircraft actually sits through. When "returns to base between each leg"
// is on, a repositioning leg brings it home and back out again inside the
// gap — the away time splits into two short segments bracketing a stretch
// where the aircraft is actually free. A repositioning leg's date always
// lands on one of its adjacent revenue legs' dates (see makeRepoLeg in the
// Quote Builder), so its presence between two revenue legs, chronologically,
// is a reliable signal that the gap was bridged rather than sat through —
// no need to know the aircraft's home base to tell the two cases apart.
function awayWindows(itinerary: unknown): [string, string][] {
  const legs = (itinerary as StoredLeg[]) ?? [];
  const dated = legs
    .map((l) => ({ billAs: l.billAs, iso: legDateIso(l) }))
    .filter((l): l is { billAs: string | undefined; iso: string } => Boolean(l.iso))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  const windows: [string, string][] = [];
  let segmentStart: string | null = null;
  let segmentEnd: string | null = null;

  for (const leg of dated) {
    if ((leg.billAs ?? "revenue") === "revenue") {
      segmentStart ??= leg.iso;
      segmentEnd = leg.iso;
    } else if (segmentStart !== null && segmentEnd !== null) {
      windows.push([segmentStart, segmentEnd]);
      segmentStart = null;
      segmentEnd = null;
    }
  }
  if (segmentStart !== null && segmentEnd !== null) windows.push([segmentStart, segmentEnd]);
  return windows;
}

function windowsOverlap(a: [string, string], b: [string, string]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

// Pure same-aircraft, overlapping-away-window check — no database access, so
// it can run both server-side (lib/booking-server.ts, backed by a Prisma
// query) and client-side (the Quote Builder, backed by candidates fetched
// once on page load) for instant feedback as the operator edits
// aircraft/legs. Also doubles as the "another booking during this overnight
// gap" advisory check: when a gap isn't bridged by a repositioning leg (see
// awayWindows above), it's just another away segment, so an overlapping
// booking surfaces the same way a whole-trip conflict would.
export function findConflictingBooking(
  aircraftId: string | null | undefined,
  itinerary: unknown,
  candidates: ConflictCandidate[],
  excludeId?: string | null
): BookingConflict | null {
  if (!aircraftId) return null;

  const thisWindows = awayWindows(itinerary);
  if (thisWindows.length === 0) return null;

  for (const other of candidates) {
    if (other.aircraftId !== aircraftId) continue;
    if (excludeId && other.id === excludeId) continue;
    const otherWindows = awayWindows(other.itinerary);
    for (const otherWindow of otherWindows) {
      if (thisWindows.some((w) => windowsOverlap(w, otherWindow))) {
        return { booking: other, startDate: otherWindow[0], endDate: otherWindow[1] };
      }
    }
  }
  return null;
}
