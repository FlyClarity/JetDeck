import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf, legDate } from "@/lib/itinerary";
import { crewRoleLabel } from "@/lib/crew";
import { FlightPathMap } from "@/components/ops/flight-path-map";

// Deliberately outside the (ops) route group — no nav chrome, so printing
// (or "Save as PDF") from the browser produces a clean page for the trip
// file. Standing in for real PDF generation for now; still auth-protected
// by middleware.ts's route matcher same as everything else under /ops.
export default async function ManifestPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) notFound();

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) notFound();

  const trip = await prisma.trip.findFirst({
    where: { id, operatorId: operator.id },
    include: {
      passengers: { orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] },
      crewAssignments: { include: { crew: true }, orderBy: { createdAt: "asc" } },
      quote: {
        include: {
          selectedOption: { include: { aircraft: true } },
          tripRequest: true,
        },
      },
    },
  });
  if (!trip) notFound();

  const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
  const tail = trip.quote.selectedOption?.aircraft?.tailNumber ?? "—";

  const legAirportCodes = [
    ...new Set(legs.flatMap((l) => [l.depAirport, l.arrAirport]).filter((c): c is string => Boolean(c))),
  ];
  const legAirportRows = await prisma.airport.findMany({ where: { icao: { in: legAirportCodes } } });
  const airportByIcao = Object.fromEntries(legAirportRows.map((a) => [a.icao, a]));

  const mapLegs = legs
    .map((l) => {
      const dep = l.depAirport ? airportByIcao[l.depAirport] : undefined;
      const arr = l.arrAirport ? airportByIcao[l.arrAirport] : undefined;
      if (!dep || !arr) return null;
      return {
        dep: { icao: dep.icao, lat: dep.lat, lon: dep.lon },
        arr: { icao: arr.icao, lat: arr.lat, lon: arr.lon },
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const passengerNotes = trip.passengers.filter((p) => p.specialRequests);
  const hasNotes =
    Boolean(trip.quote.tripRequest?.specialRequests) ||
    Boolean(trip.quote.selectedOption?.clientNotes) ||
    passengerNotes.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10 text-sm text-black">
      <div className="flex items-center justify-between border-b border-black pb-3">
        <div>
          <h1 className="text-lg font-semibold">{operator.name}</h1>
          <p>Passenger Manifest — {trip.tripNumber}</p>
        </div>
        <p>Aircraft: {tail}</p>
      </div>

      <div className="mt-4">
        {legs.map((leg, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <p>
              {leg.depAirport} → {leg.arrAirport} — {legDate(leg)}
            </p>
            {(leg.depFbo || leg.arrFbo) && (
              <p className="pl-3 text-xs text-black/70">
                {leg.depFbo && `Depart from: ${leg.depFbo}`}
                {leg.depFbo && leg.arrFbo && " · "}
                {leg.arrFbo && `Arrive at: ${leg.arrFbo}`}
              </p>
            )}
          </div>
        ))}
      </div>

      {mapLegs.length > 0 && (
        <div className="mt-4">
          <FlightPathMap legs={mapLegs} width={544} height={200} />
        </div>
      )}

      {trip.crewAssignments.length > 0 && (
        <p className="mt-4">
          Crew:{" "}
          {trip.crewAssignments
            .map((a) => `${a.crew.name} (${crewRoleLabel(a.roleOnTrip)})`)
            .join(", ")}
        </p>
      )}

      {hasNotes && (
        <div className="mt-4 border-t border-black/20 pt-3">
          <p className="text-xs font-semibold tracking-wide uppercase">Notes</p>
          {trip.quote.selectedOption?.clientNotes && (
            <p className="mt-1">{trip.quote.selectedOption.clientNotes}</p>
          )}
          {trip.quote.tripRequest?.specialRequests && (
            <p className="mt-1">{trip.quote.tripRequest.specialRequests}</p>
          )}
          {passengerNotes.map((p) => (
            <p key={p.id} className="mt-1">
              {p.firstName ?? ""} {p.lastName ?? ""}: {p.specialRequests}
            </p>
          ))}
        </div>
      )}

      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1.5 pr-3">Name</th>
            <th className="py-1.5 pr-3">DOB</th>
            <th className="py-1.5 pr-3">Weight</th>
            <th className="py-1.5 pr-3">ID</th>
            <th className="py-1.5">Verified</th>
          </tr>
        </thead>
        <tbody>
          {trip.passengers.map((p) => (
            <tr key={p.id} className="border-b border-black/20">
              <td className="py-1.5 pr-3">
                {p.firstName ?? ""} {p.lastName ?? ""}
                {p.isLead ? " (Lead)" : ""}
              </td>
              <td className="py-1.5 pr-3">{p.dateOfBirth ? p.dateOfBirth.toLocaleDateString() : "—"}</td>
              <td className="py-1.5 pr-3">{p.weightLbs ? `${p.weightLbs} lbs` : "—"}</td>
              <td className="py-1.5 pr-3">
                {p.idType ?? "—"} {p.idNumber ?? ""}
              </td>
              <td className="py-1.5">{p.verifiedAt ? "✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-xs text-black/60">Generated {new Date().toLocaleString()}</p>
    </div>
  );
}
