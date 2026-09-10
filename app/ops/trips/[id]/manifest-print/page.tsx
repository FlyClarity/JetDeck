import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf, revenueLegsWithIndex, legDate, mapsSearchUrl } from "@/lib/itinerary";
import { crewRoleLabel } from "@/lib/crew";

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
  const legsIndexed = revenueLegsWithIndex(trip.quote.selectedOption?.itinerary);
  const tail = trip.quote.selectedOption?.aircraft?.tailNumber ?? "—";
  // Only worth a column when the trip has more than one leg and at least
  // one passenger isn't on all of them — otherwise every passenger is
  // trivially "on every leg" and the column would be dead weight.
  const showLegsColumn =
    legsIndexed.length > 1 && trip.passengers.some((p) => p.legIndexes.length > 0);
  function legsLabelFor(indexes: number[]): string {
    if (indexes.length === 0) return "All";
    return indexes
      .map((i) => legsIndexed.find((l) => l.index === i))
      .filter((l): l is (typeof legsIndexed)[number] => Boolean(l))
      .map((l) => `${l.leg.depAirport}→${l.leg.arrAirport}`)
      .join(", ");
  }

  const legAirportCodes = [
    ...new Set(legs.flatMap((l) => [l.depAirport, l.arrAirport]).filter((c): c is string => Boolean(c))),
  ];
  const legAirportRows = await prisma.airport.findMany({ where: { icao: { in: legAirportCodes } } });
  const airportByIcao = Object.fromEntries(legAirportRows.map((a) => [a.icao, a]));

  // "KILG" means nothing to most people reading this document — pair every
  // code with the airport's city/state. Deliberately short (not the full
  // FAA facility name) so a leg's two endpoints fit on one line instead of
  // wrapping mid-phrase.
  function airportLabel(icao: string | null | undefined): string {
    if (!icao) return "—";
    const a = airportByIcao[icao];
    if (!a) return icao;
    const location = [a.city, a.state].filter(Boolean).join(", ");
    return location ? `${location} (${icao})` : icao;
  }

  const passengerNotes = trip.passengers.filter((p) => p.specialRequests);
  const hasNotes =
    Boolean(trip.quote.tripRequest?.specialRequests) ||
    Boolean(trip.quote.selectedOption?.clientNotes) ||
    passengerNotes.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10 text-sm text-black">
      <div className="flex items-center justify-between gap-4 border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          {operator.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={operator.logoUrl} alt={operator.name} className="h-10 w-auto object-contain" />
          ) : (
            <h1 className="text-xl font-semibold tracking-tight">{operator.name}</h1>
          )}
          <div className={operator.logoUrl ? "border-l border-black/20 pl-3" : ""}>
            <p className="font-semibold">Passenger Manifest</p>
            <p className="text-black/60">{trip.tripNumber}</p>
          </div>
        </div>
        <p className="text-right font-medium">Aircraft: {tail}</p>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {legs.map((leg, i) => (
          <div key={i} className="rounded border border-black/15 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">
                {airportLabel(leg.depAirport)} → {airportLabel(leg.arrAirport)}
              </p>
              <p className="shrink-0 text-black/60">{legDate(leg)}</p>
            </div>
            {(leg.depFboName || leg.depFboAddress) && (
              <div className="mt-2 border-l-2 border-black/15 pl-3">
                <p className="text-xs font-semibold tracking-wide text-black/60 uppercase">
                  Depart — {leg.depAirport} FBO
                </p>
                {leg.depFboName && <p>{leg.depFboName}</p>}
                {leg.depFboAddress && (
                  <a href={mapsSearchUrl(leg.depFboAddress)} className="text-xs underline">
                    {leg.depFboAddress}
                  </a>
                )}
              </div>
            )}
            {(leg.arrFboName || leg.arrFboAddress) && (
              <div className="mt-2 border-l-2 border-black/15 pl-3">
                <p className="text-xs font-semibold tracking-wide text-black/60 uppercase">
                  Arrive — {leg.arrAirport} FBO
                </p>
                {leg.arrFboName && <p>{leg.arrFboName}</p>}
                {leg.arrFboAddress && (
                  <a href={mapsSearchUrl(leg.arrFboAddress)} className="text-xs underline">
                    {leg.arrFboAddress}
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

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
            {showLegsColumn && <th className="py-1.5 pr-3">Legs</th>}
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
              {showLegsColumn && <td className="py-1.5 pr-3">{legsLabelFor(p.legIndexes)}</td>}
              <td className="py-1.5">{p.verifiedAt ? "✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-xs text-black/60">Generated {new Date().toLocaleString()}</p>
    </div>
  );
}
