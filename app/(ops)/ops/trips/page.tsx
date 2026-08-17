import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf } from "@/lib/itinerary";
import { STATUS_LABELS } from "@/lib/trip";

export default async function TripsPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const trips = await prisma.trip.findMany({
    where: {
      operatorId: operator.id,
      status: { notIn: ["invoiced", "closed", "cancelled"] },
      // Belt-and-suspenders: cancelBooking cascades Quote cancellation to
      // Trip.status now, but this also self-heals any Trip rows left over
      // from before that cascade existed.
      quote: { status: { not: "cancelled" } },
    },
    include: {
      passengers: true,
      crewAssignments: { include: { crew: true } },
      quote: { include: { tripRequest: true, selectedOption: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
      <p className="mt-1 text-muted-foreground">
        Confirmed bookings from acceptance through post-flight close.
      </p>

      {trips.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No active trips yet — they appear here once a quote is accepted.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Trip</th>
                <th className="py-2 pr-4 font-medium">Route</th>
                <th className="py-2 pr-4 font-medium">Departs</th>
                <th className="py-2 pr-4 font-medium">Manifest</th>
                <th className="py-2 pr-4 font-medium">Crew</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const legs = revenueLegsOf(t.quote.selectedOption?.itinerary);
                const firstLeg = legs[0];
                // Full stop-by-stop routing rather than just start→end, so a
                // multi-leg or round trip (e.g. KTEB → KMIA → KTEB) doesn't
                // collapse into a route that looks like a one-way KTEB → KTEB.
                const route =
                  legs.length > 0
                    ? [legs[0].depAirport ?? "?", ...legs.map((l) => l.arrAirport ?? "?")].join(" → ")
                    : "Route unknown";
                const submitted = t.passengers.filter((p) => p.submittedAt).length;
                return (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">
                      <Link href={`/ops/trips/${t.id}`} className="font-medium hover:underline hover:underline-offset-4">
                        {t.tripNumber}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{route}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{firstLeg?.date ?? "—"}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {t.passengers.length > 0 ? `${submitted}/${t.passengers.length} submitted` : "—"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {t.crewAssignments.length > 0
                        ? t.crewAssignments.map((a) => a.crew.name).join(", ")
                        : "Unassigned"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
