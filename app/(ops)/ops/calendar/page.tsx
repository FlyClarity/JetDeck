import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { awayWindows } from "@/lib/itinerary";
import { categoryLabel } from "@/lib/aircraft";
import { STATUS_SHORT_LABELS } from "@/lib/trip";
import { TRIP_PURPOSE_LABELS } from "@/lib/quote";
import { cn } from "@/lib/utils";
import { CalendarTodayRedirect } from "@/components/ops/calendar-today-redirect";

const WINDOW_DAYS = 14;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function formatShort(iso: string): { weekday: string; day: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    day: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

type StoredLegLike = { depAirport?: string | null; arrAirport?: string | null; date?: string | null };

// Every leg on the date in question — a day can show more than one if a
// repositioning leg and a revenue leg both fall on it.
function legsForDate(legs: StoredLegLike[], date: string): { dep: string; arr: string }[] {
  return legs
    .filter((l) => l.date === date && l.depAirport && l.arrAirport)
    .map((l) => ({ dep: l.depAirport as string, arr: l.arrAirport as string }));
}

// Where the aircraft is sitting on a day with no leg of its own — wherever
// it last landed, at or before this date. legs must already be sorted
// chronologically.
function sittingAirportFor(legs: StoredLegLike[], date: string): string | null {
  let airport: string | null = null;
  for (const leg of legs) {
    if (leg.date && leg.arrAirport && leg.date <= date) airport = leg.arrAirport;
  }
  return airport;
}

type Tile = {
  tripId: string;
  tripNumber: string;
  clientName: string;
  stage: string;
} & ({ kind: "leg"; legs: { dep: string; arr: string }[] } | { kind: "transient"; airport: string });

// The Fleet Calendar — where an aircraft is booked, day by day, across the
// whole fleet at once. Reuses lib/itinerary.ts's awayWindows() exactly as
// conflict-checking and the AI opportunity scorer already do, so "away"
// here means the same thing it means everywhere else in the app. Within an
// away window, each day is either a flying day (a leg actually departs)
// or a transient day (sitting wherever the last leg landed) — not just one
// flat "busy" block for the whole trip. Confirmed Trips only for now;
// pending/unaccepted quotes (tentative holds) aren't shown yet.
export default async function FleetCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; today?: string }>;
}) {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const { start, today } = await searchParams;
  // "Today" has to come from the viewer's own browser, not the server clock
  // — Vercel runs on UTC, which reads as tomorrow for anyone west of
  // Greenwich for several hours a day. See CalendarTodayRedirect.
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return <CalendarTodayRedirect start={start} />;
  }
  const todayIso = today;
  const startIso = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : todayIso;
  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(startIso, i));
  const endIso = dates[dates.length - 1];

  const aircraft = await prisma.aircraft.findMany({
    where: { operatorId: operator.id, status: "active" },
    orderBy: { tailNumber: "asc" },
  });

  const trips = await prisma.trip.findMany({
    where: {
      operatorId: operator.id,
      status: { notIn: ["closed", "invoiced", "cancelled_by_operator", "cancelled"] },
      // Not visible in Ops until sales sends it — see the Needs Review
      // queue's "Ready for Ops" section.
      sentToOps: true,
      // Belt-and-suspenders, same as /ops/trips and /ops/board: a Trip row
      // can be stuck on a stale pre-cancellation status if it was cancelled
      // before the cascade fix existed, so also check the Quote directly.
      quote: { status: { not: "cancelled" } },
    },
    include: { quote: { include: { selectedOption: true, tripRequest: true, contact: true } } },
  });

  function clientNameFor(trip: (typeof trips)[number]): string {
    const quote = trip.quote;
    if (quote.contact) return `${quote.contact.firstName} ${quote.contact.lastName}`;
    if (quote.tripRequest) return quote.tripRequest.requestorName;
    if (quote.tripPurpose) return TRIP_PURPOSE_LABELS[quote.tripPurpose] ?? "Internal";
    return "—";
  }

  const tilesByAircraft = new Map<string, Map<string, Tile>>();
  for (const trip of trips) {
    const option = trip.quote.selectedOption;
    const aircraftId = option?.aircraftId;
    if (!aircraftId) continue;

    const allLegs = ((option.itinerary as StoredLegLike[]) ?? [])
      .filter((l) => l.date && l.depAirport && l.arrAirport)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));
    const clientName = clientNameFor(trip);
    const stage = STATUS_SHORT_LABELS[trip.status] ?? "?";
    const aircraftMap = tilesByAircraft.get(aircraftId) ?? new Map<string, Tile>();

    for (const [blockStart, blockEnd] of awayWindows(option.itinerary)) {
      if (blockEnd < startIso || blockStart > endIso) continue;
      for (const date of dates) {
        if (date < blockStart || date > blockEnd) continue;
        const legsToday = legsForDate(allLegs, date);
        if (legsToday.length > 0) {
          aircraftMap.set(date, { tripId: trip.id, tripNumber: trip.tripNumber, clientName, stage, kind: "leg", legs: legsToday });
          continue;
        }
        const airport = sittingAirportFor(allLegs, date);
        if (!airport) continue;
        aircraftMap.set(date, { tripId: trip.id, tripNumber: trip.tripNumber, clientName, stage, kind: "transient", airport });
      }
    }
    tilesByAircraft.set(aircraftId, aircraftMap);
  }

  return (
    <div className="w-full px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet Calendar</h1>
          <p className="mt-1 text-muted-foreground">
            Every aircraft&apos;s confirmed bookings, at a glance — day by day.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/ops/calendar?start=${addDays(startIso, -WINDOW_DAYS)}&today=${todayIso}`}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-muted"
          >
            ← Prev
          </Link>
          <Link
            href={`/ops/calendar?today=${todayIso}`}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-muted"
          >
            Today
          </Link>
          <Link
            href={`/ops/calendar?start=${addDays(startIso, WINDOW_DAYS)}&today=${todayIso}`}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-muted"
          >
            Next →
          </Link>
        </div>
      </div>

      {aircraft.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No active aircraft in the fleet yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background py-2 pr-4 text-left font-medium text-muted-foreground">
                  Aircraft
                </th>
                {dates.map((date) => {
                  const { weekday, day } = formatShort(date);
                  return (
                    <th
                      key={date}
                      className={cn(
                        "min-w-32 border-l border-border px-1 py-2 text-center text-xs font-medium text-muted-foreground",
                        date === todayIso && "bg-accent/10"
                      )}
                    >
                      <div>{weekday}</div>
                      <div>{day}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {aircraft.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="sticky left-0 bg-background py-2 pr-4">
                    <p className="font-medium">{a.tailNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.make} {a.model} · {categoryLabel(a.category)}
                    </p>
                  </td>
                  {dates.map((date) => {
                    const tile = tilesByAircraft.get(a.id)?.get(date);
                    return (
                      <td
                        key={date}
                        className={cn(
                          "min-w-32 border-l border-border p-1 align-middle",
                          date === todayIso && "bg-accent/10"
                        )}
                      >
                        {tile ? (
                          <Link
                            href={`/ops/trips/${tile.tripId}`}
                            title={`${tile.tripNumber} — ${tile.clientName}`}
                            className={cn(
                              "block rounded px-1.5 py-1 text-left text-xs leading-tight hover:opacity-90",
                              tile.kind === "leg"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <div className="flex items-center gap-1 font-medium">
                              <span
                                className={cn(
                                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px]",
                                  tile.kind === "leg" ? "bg-primary-foreground/25" : "bg-foreground/10"
                                )}
                              >
                                {tile.stage}
                              </span>
                              <span className="truncate">{tile.clientName}</span>
                            </div>
                            <div className="mt-0.5 truncate opacity-80">
                              {tile.kind === "leg"
                                ? tile.legs.map((l) => `${l.dep}→${l.arr}`).join(", ")
                                : `Transient ${tile.airport}`}
                            </div>
                          </Link>
                        ) : (
                          <span className="block rounded bg-muted/40 px-1.5 py-1 text-center text-xs text-muted-foreground">
                            Open
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
