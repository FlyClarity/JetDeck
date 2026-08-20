import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { awayWindows } from "@/lib/itinerary";
import { categoryLabel } from "@/lib/aircraft";
import { cn } from "@/lib/utils";

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

type AwayBlock = { start: string; end: string; tripId: string; tripNumber: string };

// The Fleet Calendar — where an aircraft is booked, day by day, across the
// whole fleet at once. Reuses lib/itinerary.ts's awayWindows() exactly as
// conflict-checking and the AI opportunity scorer already do, so "busy" here
// means the same thing it means everywhere else in the app — not a
// separate reimplementation that could quietly drift out of sync with
// those. Confirmed Trips only for now; pending/unaccepted quotes (tentative
// holds) aren't shown yet — a real but separate follow-up.
export default async function FleetCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const { start } = await searchParams;
  const todayIso = isoDate(new Date());
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
    },
    include: { quote: { include: { selectedOption: true } } },
  });

  const blocksByAircraft = new Map<string, AwayBlock[]>();
  for (const trip of trips) {
    const option = trip.quote.selectedOption;
    const aircraftId = option?.aircraftId;
    if (!aircraftId) continue;
    for (const [blockStart, blockEnd] of awayWindows(option.itinerary)) {
      // Skip anything entirely outside the visible window — no point
      // carrying it into the per-day lookup below.
      if (blockEnd < startIso || blockStart > endIso) continue;
      const list = blocksByAircraft.get(aircraftId) ?? [];
      list.push({ start: blockStart, end: blockEnd, tripId: trip.id, tripNumber: trip.tripNumber });
      blocksByAircraft.set(aircraftId, list);
    }
  }

  function blockFor(aircraftId: string, date: string): AwayBlock | null {
    const blocks = blocksByAircraft.get(aircraftId) ?? [];
    return blocks.find((b) => b.start <= date && date <= b.end) ?? null;
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
            href={`/ops/calendar?start=${addDays(startIso, -WINDOW_DAYS)}`}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-muted"
          >
            ← Prev
          </Link>
          <Link
            href="/ops/calendar"
            className="rounded-md border border-border px-2.5 py-1 hover:bg-muted"
          >
            Today
          </Link>
          <Link
            href={`/ops/calendar?start=${addDays(startIso, WINDOW_DAYS)}`}
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
                        "min-w-16 border-l border-border px-1 py-2 text-center text-xs font-medium text-muted-foreground",
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
                    const block = blockFor(a.id, date);
                    return (
                      <td
                        key={date}
                        className={cn(
                          "min-w-16 border-l border-border px-1 py-2 text-center align-middle",
                          date === todayIso && "bg-accent/10"
                        )}
                      >
                        {block ? (
                          <Link
                            href={`/ops/trips/${block.tripId}`}
                            title={block.tripNumber}
                            className="block rounded bg-primary px-1 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                          >
                            {block.tripNumber}
                          </Link>
                        ) : (
                          <span className="block rounded bg-muted/40 px-1 py-1 text-xs text-muted-foreground">
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
