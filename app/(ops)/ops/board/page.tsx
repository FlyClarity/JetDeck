import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf } from "@/lib/itinerary";
import { STATUS_LABELS, TRIP_STAGES } from "@/lib/trip";
import { Button } from "@/components/ui/button";

// Nothing else in the app moves a trip through ops_review/pre_flight/
// in_flight/completed — this board is the only place those transitions
// happen. crew_assigned can also be set here (skipping the roster) or from
// the trip detail page's actual crew picker; either way lands on the same
// status.
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
                  const crewNames = t.crewAssignments.map((a) => a.crew.name).join(", ");
                  const moveForward = moveTripStage.bind(null, t.id, "forward");
                  const moveBackward = moveTripStage.bind(null, t.id, "backward");
                  return (
                    <div key={t.id} className="rounded-md border border-border p-3 text-sm">
                      <Link
                        href={`/ops/trips/${t.id}`}
                        className="font-medium hover:underline hover:underline-offset-4"
                      >
                        {t.tripNumber}
                      </Link>
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
                            disabled={stageIdx === TRIP_STAGES.length - 1}
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
