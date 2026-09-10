import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { applyPassengerFormUpdate } from "@/lib/manifest";
import { revenueLegsOf, revenueLegsWithIndex, legDate, legDateIso, flightTimeLabel } from "@/lib/itinerary";
import { greatCircleDistanceNm, resolveAirportTimezone } from "@/lib/geo";
import { to12Hour, tzAbbreviation, tzChangeLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { SectionHeading, LegItineraryCard, aircraftLabelFor } from "@/components/quote/client-page-ui";
import { PassengerForm } from "@/components/manifest/passenger-form";
import { getAppUrl } from "@/lib/url";

async function getPassengerByToken(token: string) {
  return prisma.passenger.findUnique({
    where: { token },
    include: {
      trip: {
        include: {
          operator: true,
          passengers: { orderBy: { createdAt: "asc" } },
          quote: {
            include: {
              selectedOption: { include: { aircraft: true, brokeredAircraft: true } },
              tripRequest: true,
            },
          },
        },
      },
    },
  });
}

// Any passenger can update their own row; the lead can also update any
// other passenger on the same trip (e.g. filling out a child's info
// themselves instead of forwarding the link) — enforced here rather than
// trusting the client, since this is a public, session-less page.
async function savePassengerInfo(actingToken: string, targetId: string, formData: FormData) {
  "use server";

  const acting = await prisma.passenger.findUnique({ where: { token: actingToken } });
  if (!acting) return;

  const target = await prisma.passenger.findUnique({ where: { id: targetId } });
  if (!target || target.tripId !== acting.tripId) return;
  if (target.id !== acting.id && !acting.isLead) return;

  await applyPassengerFormUpdate(targetId, formData);

  redirect(`/manifest/${actingToken}?saved=1`);
}

async function addPassenger(actingToken: string) {
  "use server";

  const acting = await prisma.passenger.findUnique({
    where: { token: actingToken },
    include: {
      trip: {
        include: {
          passengers: true,
          quote: { include: { selectedOption: { include: { aircraft: true, brokeredAircraft: true } } } },
        },
      },
    },
  });
  if (!acting || !acting.isLead) return;

  const seatCap =
    acting.trip.quote.selectedOption?.aircraft?.seats ??
    acting.trip.quote.selectedOption?.brokeredAircraft?.seats ??
    null;
  if (seatCap !== null && acting.trip.passengers.length >= seatCap) return;

  await prisma.passenger.create({
    data: { operatorId: acting.operatorId, tripId: acting.tripId, isLead: false },
  });

  redirect(`/manifest/${actingToken}`);
}

export default async function ManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { token } = await params;
  const { saved } = await searchParams;
  const passenger = await getPassengerByToken(token);
  if (!passenger) notFound();

  const { trip } = passenger;
  const operator = trip.operator;
  const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
  // Only worth asking "which legs" when there's more than one — a
  // single-leg trip has nothing to choose between.
  const legsIndexed = revenueLegsWithIndex(trip.quote.selectedOption?.itinerary);
  const legOptions =
    legsIndexed.length > 1
      ? legsIndexed.map(({ leg, index }) => ({
          index,
          label: `${leg.depAirport} → ${leg.arrAirport} (${legDate(leg)})`,
        }))
      : [];
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  const routeText = firstLeg ? `${firstLeg.depAirport ?? "?"} → ${lastLeg?.arrAirport ?? "?"}` : "your flight";
  const dateText = firstLeg?.date
    ? new Date(`${firstLeg.date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

  const legAirportCodes = [
    ...new Set(legs.flatMap((l) => [l.depAirport, l.arrAirport]).filter((c): c is string => Boolean(c))),
  ];
  const legAirportRows = legAirportCodes.length
    ? await prisma.airport.findMany({ where: { icao: { in: legAirportCodes } } })
    : [];
  // Airport.timezone is never actually populated in the DB — resolve it
  // from lat/lon (see resolveAirportTimezone) rather than trusting the
  // stored column, or the time-zone-change/abbreviation display below
  // silently comes up empty for every route.
  const airportByIcao = Object.fromEntries(
    legAirportRows.map((a) => [a.icao, { ...a, timezone: resolveAirportTimezone(a.timezone, a.lat, a.lon) }])
  );

  // "New Castle County (ILG)" — reads fine stacked on its own line per
  // Departs/Arrives column, unlike the single shared route line an earlier
  // version crammed it into (which is what caused the wrapping this
  // replaces).
  function airportNameFor(icao: string | null | undefined): string {
    if (!icao) return "—";
    const a = airportByIcao[icao];
    return a ? `${a.name} (${icao})` : icao;
  }
  function locationFor(icao: string | null | undefined): string | undefined {
    const a = icao ? airportByIcao[icao] : undefined;
    return a ? [a.city, a.state].filter(Boolean).join(", ") || undefined : undefined;
  }

  const aircraftLabel = trip.quote.selectedOption ? aircraftLabelFor(trip.quote.selectedOption) : null;
  const tripNotes = [trip.quote.selectedOption?.clientNotes, trip.quote.tripRequest?.specialRequests].filter(
    (n): n is string => Boolean(n)
  );

  const seatCap =
    trip.quote.selectedOption?.aircraft?.seats ?? trip.quote.selectedOption?.brokeredAircraft?.seats ?? null;
  const otherPassengers = passenger.isLead ? trip.passengers.filter((p) => p.id !== passenger.id) : [];
  const canAddMore = passenger.isLead && (seatCap === null || trip.passengers.length < seatCap);
  const appUrl = passenger.isLead ? await getAppUrl() : null;

  const addPassengerWithToken = addPassenger.bind(null, token);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto w-full max-w-xl px-6 py-16">
        <header className="flex items-center gap-3">
          {operator.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={operator.logoUrl} alt={operator.name} className="h-9 w-auto" />
          )}
          <span className="text-base font-semibold tracking-tight text-foreground/80">{operator.name}</span>
        </header>

        <div className="mt-6 rounded-2xl border border-border bg-background p-7 shadow-sm sm:p-9">
          <h1 className="text-2xl font-semibold tracking-tight">Passenger Information</h1>
          <p className="mt-1 text-muted-foreground">
            {routeText}
            {dateText ? ` — ${dateText}` : ""}
          </p>

          {saved === "1" && (
            <p className="mt-4 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
              Saved — thank you!
            </p>
          )}

          {!passenger.isLead && (
            <p className="mt-4 text-sm text-muted-foreground">
              Please complete your own information below for this flight.
            </p>
          )}

          {legs.length > 0 && (
            <section className="mt-7">
              <SectionHeading>Your Trip</SectionHeading>
              <div className="mt-3 flex flex-col gap-2">
                {legs.map((leg, i) => {
                  const dep = leg.depAirport ? airportByIcao[leg.depAirport] : undefined;
                  const arr = leg.arrAirport ? airportByIcao[leg.arrAirport] : undefined;
                  const isoDate = legDateIso(leg);
                  const distanceNm =
                    dep && arr ? Math.round(greatCircleDistanceNm(dep.lat, dep.lon, arr.lat, arr.lon)) : null;
                  const flightTime = flightTimeLabel(leg.flightHours);
                  const tzChange = tzChangeLabel(dep?.timezone, arr?.timezone, isoDate);
                  const metaLabel =
                    [
                      distanceNm !== null ? `${distanceNm.toLocaleString()} nm` : null,
                      flightTime ? `${flightTime} flight` : null,
                      tzChange ? `${tzChange} hr time change` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || null;
                  const depTimeLabel = leg.depTimeTBD || !leg.depTime
                    ? "TBD"
                    : `${to12Hour(leg.depTime)} ${tzAbbreviation(dep?.timezone, isoDate)}`.trim();
                  const arrTimeLabel = leg.arrTime
                    ? `${to12Hour(leg.arrTime)} ${tzAbbreviation(arr?.timezone, isoDate)}`.trim()
                    : "TBD";

                  return (
                    <LegItineraryCard
                      key={i}
                      legNumber={i + 1}
                      route={`${leg.depAirport} → ${leg.arrAirport}`}
                      dateLabel={legDate(leg)}
                      metaLabel={metaLabel}
                      dep={{
                        timeLabel: depTimeLabel,
                        airportName: airportNameFor(leg.depAirport),
                        location: locationFor(leg.depAirport),
                        fboName: leg.depFboName,
                        fboAddress: leg.depFboAddress,
                      }}
                      arr={{
                        timeLabel: arrTimeLabel,
                        airportName: airportNameFor(leg.arrAirport),
                        location: locationFor(leg.arrAirport),
                        fboName: leg.arrFboName,
                        fboAddress: leg.arrFboAddress,
                      }}
                    />
                  );
                })}
              </div>
              {aircraftLabel && <p className="mt-3 text-sm text-muted-foreground">{aircraftLabel}</p>}
            </section>
          )}

          {tripNotes.length > 0 && (
            <section className="mt-7">
              <SectionHeading>Notes</SectionHeading>
              <div className="mt-3 flex flex-col gap-1.5 text-sm">
                {tripNotes.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <PassengerForm
            passenger={passenger}
            action={savePassengerInfo.bind(null, token, passenger.id)}
            title={passenger.isLead ? "Your Information" : "Your Information"}
            legOptions={legOptions}
          />

          {passenger.isLead && (
            <>
              {otherPassengers.map((p, i) => (
                <PassengerForm
                  key={p.id}
                  passenger={p}
                  action={savePassengerInfo.bind(null, token, p.id)}
                  title={p.firstName ? `${p.firstName} ${p.lastName ?? ""}`.trim() : `Passenger ${i + 2}`}
                  shareLink={appUrl ? `${appUrl}/manifest/${p.token}` : undefined}
                  legOptions={legOptions}
                />
              ))}

              {canAddMore && (
                <form action={addPassengerWithToken}>
                  <Button type="submit" variant="outline" className="w-full">
                    + Add Another Passenger
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
