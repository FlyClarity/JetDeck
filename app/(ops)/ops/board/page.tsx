import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf } from "@/lib/itinerary";
import { resolveAirportTimezone } from "@/lib/geo";
import { departureInstantUtc } from "@/lib/time";
import { STATUS_LABELS, TRIP_STAGES } from "@/lib/trip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RELEASE_FLAG_MINUTES = 45;

// Every stage from "In Review" onward is a crew-app event in the
// operator's eventual vision (checklist+release, at the aircraft,
// departing, landed) — each one has its own named, gated action on the
// trip detail page (see app/(ops)/ops/trips/[id]) instead of this bare
// next/back arrow, so the arrow explicitly refuses to make any of these
// jumps rather than silently bypassing whatever that stage's action
// actually checks or records.
const GATED_STAGES = new Set(["ready_for_release", "released_brokered", "pre_flight", "in_flight", "completed"]);

async function moveTripStage(tripId: string, direction: "forward" | "backward") {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const trip = await prisma.trip.findFirst({ where: { id: tripId, operatorId: operator.id } });
  if (!trip) return;

  const idx = TRIP_STAGES.findIndex((s) => s === trip.status);
  if (idx === -1) return;

  const nextIdx = direction === "forward" ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= TRIP_STAGES.length) return;
  if (GATED_STAGES.has(TRIP_STAGES[nextIdx])) return;

  await prisma.trip.update({ where: { id: tripId }, data: { status: TRIP_STAGES[nextIdx] } });
  revalidatePath("/ops/board");
}

export default async function OpsBoardPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const trips = await prisma.trip.findMany({
    where: {
      operatorId: operator.id,
      status: { in: [...TRIP_STAGES] },
      // Not visible in Ops until sales sends it — see the Needs Review
      // queue's "Ready for Ops" section.
      sentToOps: true,
      // Belt-and-suspenders, same as /ops/trips: a cancelled Quote should
      // never show as a live card here even if something failed to cascade
      // cancellation onto the Trip row itself.
      quote: { status: { not: "cancelled" } },
    },
    include: {
      passengers: true,
      crewAssignments: { include: { crew: true } },
      quote: { include: { selectedOption: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Batched once for every trip's first leg rather than per-card, so the
  // "flagged if released and not yet Preflight 45 minutes before
  // departure" check doesn't turn into an N+1 query.
  const firstLegDepCodes = new Set<string>();
  for (const t of trips) {
    const dep = revenueLegsOf(t.quote.selectedOption?.itinerary)[0]?.depAirport;
    if (dep) firstLegDepCodes.add(dep);
  }
  const depAirportRows = firstLegDepCodes.size
    ? await prisma.airport.findMany({ where: { icao: { in: [...firstLegDepCodes] } } })
    : [];
  const tzByIcao = Object.fromEntries(
    depAirportRows.map((a) => [a.icao, resolveAirportTimezone(a.timezone, a.lat, a.lon)])
  );

  return (
    <div className="w-full px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Ops Board</h1>
      <p className="mt-1 text-muted-foreground">
        Trips move left to right as they progress toward departure.
      </p>

      <div className="mt-8 flex gap-4 overflow-x-auto pb-4">
        {TRIP_STAGES.map((stage, stageIdx) => {
          const stageTrips = trips.filter((t) => t.status === stage);
          return (
            <div key={stage} className="flex w-64 shrink-0 flex-col gap-2">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {STATUS_LABELS[stage] ?? stage}
                <span className="ml-1.5 normal-case">({stageTrips.length})</span>
              </h2>
              <div className="flex flex-col gap-2">
                {stageTrips.map((t) => {
                  const legs = revenueLegsOf(t.quote.selectedOption?.itinerary);
                  const firstLeg = legs[0];
                  const lastLeg = legs[legs.length - 1];
                  const route = firstLeg
                    ? `${firstLeg.depAirport ?? "?"} → ${lastLeg?.arrAirport ?? "?"}`
                    : "Route unknown";
                  const brokered = t.quote.selectedOption?.fleetSource === "brokered";
                  // A brokered trip has no CrewMember assignment to show —
                  // fall back to the free-typed names instead.
                  const crewNames =
                    t.crewAssignments.map((a) => a.crew.name).join(", ") ||
                    [t.brokeredCaptainName, t.brokeredCoPilotName, t.brokeredCabinHostName]
                      .filter(Boolean)
                      .join(", ");
                  const moveForward = moveTripStage.bind(null, t.id, "forward");
                  const moveBackward = moveTripStage.bind(null, t.id, "backward");

                  const firstLegDeparture =
                    firstLeg?.date && !firstLeg.depTimeTBD && firstLeg.depTime
                      ? departureInstantUtc(firstLeg.date, firstLeg.depTime, tzByIcao[firstLeg.depAirport ?? ""])
                      : null;
                  const minutesToDeparture = firstLegDeparture
                    ? (firstLegDeparture.getTime() - new Date().getTime()) / 60000
                    : null;
                  const flagged =
                    t.status === "ready_for_release" &&
                    minutesToDeparture !== null &&
                    minutesToDeparture <= RELEASE_FLAG_MINUTES;

                  const nextStage = TRIP_STAGES[stageIdx + 1];
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "rounded-md border p-3 text-sm",
                        flagged
                          ? "border-destructive/50 bg-destructive/5"
                          : brokered
                            ? "border-blue-500/40 bg-blue-500/5"
                            : "border-border"
                      )}
                    >
                      <Link
                        href={`/ops/trips/${t.id}`}
                        className="font-medium hover:underline hover:underline-offset-4"
                      >
                        {t.tripNumber}
                      </Link>
                      {brokered && (
                        <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                          Brokered
                        </span>
                      )}
                      {flagged && (
                        <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                          Not yet Preflight
                        </span>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">{route}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{firstLeg?.date ?? "—"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Crew: {crewNames || "Unassigned"}</p>
                      {t.passengers.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Manifest: {t.passengers.filter((p) => p.submittedAt).length}/{t.passengers.length}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <form action={moveBackward}>
                          <Button type="submit" size="sm" variant="ghost" disabled={stageIdx === 0}>
                            ← Back
                          </Button>
                        </form>
                        <form action={moveForward}>
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            disabled={stageIdx === TRIP_STAGES.length - 1 || GATED_STAGES.has(nextStage)}
                            title={
                              GATED_STAGES.has(nextStage)
                                ? "Use the named action on the trip detail page for this stage"
                                : undefined
                            }
                          >
                            Next →
                          </Button>
                        </form>
                      </div>
                    </div>
                  );
                })}
                {stageTrips.length === 0 && <p className="text-xs text-muted-foreground">No trips</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
