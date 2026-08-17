import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf, legDate } from "@/lib/itinerary";
import { STATUS_LABELS } from "@/lib/trip";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/quote/copy-link-button";
import { getAppUrl } from "@/lib/url";

async function getScopedTrip(id: string) {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return null;

  const trip = await prisma.trip.findFirst({
    where: { id, operatorId: operator.id },
    include: {
      passengers: { orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] },
      quote: {
        include: {
          tripRequest: true,
          contact: true,
          selectedOption: { include: { aircraft: true, brokeredAircraft: true } },
        },
      },
    },
  });
  if (!trip) return null;
  return { trip, operator };
}

async function verifyPassenger(tripId: string, passengerId: string) {
  "use server";

  const { userId } = await getTenantContext();
  const scoped = await getScopedTrip(tripId);
  if (!scoped || !userId) return;

  const passenger = scoped.trip.passengers.find((p) => p.id === passengerId);
  if (!passenger) return;

  await prisma.passenger.update({
    where: { id: passengerId },
    data: passenger.verifiedAt ? { verifiedAt: null, verifiedBy: null } : { verifiedAt: new Date(), verifiedBy: userId },
  });

  revalidatePath(`/trips/${tripId}`);
}

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await getScopedTrip(id);
  if (!scoped) notFound();
  const { trip } = scoped;

  const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
  const aircraftLabel = trip.quote.selectedOption?.aircraft
    ? `${trip.quote.selectedOption.aircraft.make} ${trip.quote.selectedOption.aircraft.model} (${trip.quote.selectedOption.aircraft.tailNumber})`
    : trip.quote.selectedOption?.brokeredAircraft
      ? `${trip.quote.selectedOption.brokeredAircraft.make ?? ""} ${trip.quote.selectedOption.brokeredAircraft.model ?? ""}`.trim()
      : "Aircraft TBD";
  const requestorName = trip.quote.contact
    ? `${trip.quote.contact.firstName} ${trip.quote.contact.lastName}`
    : (trip.quote.tripRequest?.requestorName ?? "");

  const appUrl = await getAppUrl();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{trip.tripNumber}</h1>
          <p className="mt-1 text-muted-foreground">
            {requestorName} · {aircraftLabel}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
          {STATUS_LABELS[trip.status] ?? trip.status}
        </span>
      </div>

      <div className="mt-6 rounded-md border border-border p-4">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Itinerary</h2>
        <div className="mt-2 flex flex-col gap-1">
          {legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>
                {leg.depAirport} → {leg.arrAirport}
              </span>
              <span className="text-muted-foreground">{legDate(leg)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Passenger Manifest
          {trip.passengers.length > 0 && (
            <span className="ml-2 normal-case text-muted-foreground">
              {trip.passengers.filter((p) => p.submittedAt).length}/{trip.passengers.length} submitted
            </span>
          )}
        </h2>
        {trip.passengers.length > 0 && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/trips/${trip.id}/manifest-print`} target="_blank">
              Print Manifest
            </Link>
          </Button>
        )}
      </div>

      {trip.passengers.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No manifest was generated for this trip (internal/non-client trips don&apos;t collect one).
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {trip.passengers.map((p) => {
            const verifyWithIds = verifyPassenger.bind(null, trip.id, p.id);
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {p.firstName || p.lastName ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "Not yet submitted"}
                    {p.isLead && <span className="ml-1.5 text-xs text-muted-foreground">(Lead)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.dateOfBirth ? `DOB ${p.dateOfBirth.toLocaleDateString()}` : "DOB —"}
                    {" · "}
                    {p.weightLbs ? `${p.weightLbs} lbs` : "Weight —"}
                    {" · "}
                    {p.idNumber ? `ID on file (${p.idType ?? "type unknown"})` : "ID missing"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.submittedAt ? (
                    <form action={verifyWithIds}>
                      <Button type="submit" size="sm" variant={p.verifiedAt ? "default" : "outline"}>
                        {p.verifiedAt ? "Verified ✓" : "Verify"}
                      </Button>
                    </form>
                  ) : (
                    <span className="text-xs text-muted-foreground">Awaiting submission</span>
                  )}
                  <CopyLinkButton link={`${appUrl}/manifest/${p.token}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
