import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { revenueLegsOf, legDate, legDateIso, flightTimeLabel } from "@/lib/itinerary";
import { greatCircleDistanceNm } from "@/lib/geo";
import { to12Hour, tzAbbreviation, tzChangeLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyLinkButton } from "@/components/quote/copy-link-button";
import { SectionHeading, LegItineraryCard } from "@/components/quote/client-page-ui";
import { getAppUrl } from "@/lib/url";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const ID_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "government_id", label: "Government ID" },
] as const;

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

function aircraftLabelFor(option: {
  aircraft: { make: string; model: string; tailNumber: string } | null;
  brokeredAircraft: { make: string | null; model: string | null } | null;
}): string {
  return option.aircraft
    ? `${option.aircraft.make} ${option.aircraft.model} (${option.aircraft.tailNumber})`
    : option.brokeredAircraft
      ? `${option.brokeredAircraft.make ?? ""} ${option.brokeredAircraft.model ?? ""}`.trim() ||
        "Aircraft to be confirmed"
      : "Aircraft to be confirmed";
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

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const dobRaw = String(formData.get("dateOfBirth") ?? "");
  const weightRaw = String(formData.get("weightLbs") ?? "");
  const idType = String(formData.get("idType") ?? "") || null;
  const idNumber = String(formData.get("idNumber") ?? "").trim() || null;
  const idExpiryRaw = String(formData.get("idExpiry") ?? "");
  const ktn = String(formData.get("ktn") ?? "").trim() || null;
  const specialRequests = String(formData.get("specialRequests") ?? "").trim() || null;

  let idImageUrl = target.idImageUrl;
  const photo = formData.get("idImage");
  if (photo instanceof File && photo.size > 0) {
    if (photo.type.startsWith("image/") && photo.size <= MAX_PHOTO_BYTES) {
      try {
        const blob = await put(`manifest/${target.tripId}/${randomUUID()}-${photo.name}`, photo, {
          access: "public",
        });
        idImageUrl = blob.url;
      } catch (err) {
        console.error(`Failed to upload ID photo for passenger ${target.id}`, err);
      }
    }
  }

  const complete = Boolean(firstName && lastName && dobRaw && weightRaw);

  await prisma.passenger.update({
    where: { id: target.id },
    data: {
      firstName: firstName || null,
      lastName: lastName || null,
      dateOfBirth: dobRaw ? new Date(`${dobRaw}T00:00:00`) : null,
      weightLbs: weightRaw ? Number(weightRaw) : null,
      idType,
      idNumber,
      idExpiry: idExpiryRaw ? new Date(`${idExpiryRaw}T00:00:00`) : null,
      idImageUrl,
      ktn,
      specialRequests,
      submittedAt: complete ? new Date() : target.submittedAt,
    },
  });

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

function PassengerForm({
  passenger,
  actingToken,
  title,
}: {
  passenger: { id: string; firstName: string | null; lastName: string | null; dateOfBirth: Date | null; weightLbs: number | null; idType: string | null; idNumber: string | null; idExpiry: Date | null; idImageUrl: string | null; ktn: string | null; specialRequests: string | null; submittedAt: Date | null };
  actingToken: string;
  title: string;
}) {
  const saveWithIds = savePassengerInfo.bind(null, actingToken, passenger.id);
  const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <div className="rounded-2xl border border-border bg-background p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {passenger.submittedAt && (
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
            Submitted
          </span>
        )}
      </div>

      <form action={saveWithIds} className="mt-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`firstName-${passenger.id}`}>First name</Label>
            <Input id={`firstName-${passenger.id}`} name="firstName" defaultValue={passenger.firstName ?? ""} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`lastName-${passenger.id}`}>Last name</Label>
            <Input id={`lastName-${passenger.id}`} name="lastName" defaultValue={passenger.lastName ?? ""} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`dob-${passenger.id}`}>Date of birth</Label>
            <Input
              id={`dob-${passenger.id}`}
              name="dateOfBirth"
              type="date"
              defaultValue={toDateInput(passenger.dateOfBirth)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`weight-${passenger.id}`}>Weight (lbs)</Label>
            <Input
              id={`weight-${passenger.id}`}
              name="weightLbs"
              type="number"
              min={1}
              defaultValue={passenger.weightLbs ?? ""}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`idType-${passenger.id}`}>ID type</Label>
            <select
              id={`idType-${passenger.id}`}
              name="idType"
              defaultValue={passenger.idType ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select...</option>
              {ID_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`idNumber-${passenger.id}`}>ID number</Label>
            <Input id={`idNumber-${passenger.id}`} name="idNumber" defaultValue={passenger.idNumber ?? ""} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`idExpiry-${passenger.id}`}>ID expiry</Label>
            <Input
              id={`idExpiry-${passenger.id}`}
              name="idExpiry"
              type="date"
              defaultValue={toDateInput(passenger.idExpiry)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`ktn-${passenger.id}`}>Known Traveler Number</Label>
            <Input id={`ktn-${passenger.id}`} name="ktn" placeholder="Optional" defaultValue={passenger.ktn ?? ""} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`idImage-${passenger.id}`}>ID photo</Label>
          <Input id={`idImage-${passenger.id}`} name="idImage" type="file" accept="image/*" />
          {passenger.idImageUrl && (
            <p className="text-xs text-muted-foreground">A photo is already on file — upload again to replace it.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`special-${passenger.id}`}>Special requests</Label>
          <Textarea
            id={`special-${passenger.id}`}
            name="specialRequests"
            rows={2}
            placeholder="Dietary, mobility, medical — optional"
            defaultValue={passenger.specialRequests ?? ""}
          />
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>
    </div>
  );
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
  const airportByIcao = Object.fromEntries(legAirportRows.map((a) => [a.icao, a]));

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
            actingToken={token}
            title={passenger.isLead ? "Your Information" : "Your Information"}
          />

          {passenger.isLead && (
            <>
              {otherPassengers.map((p, i) => (
                <div key={p.id} className="flex flex-col gap-2">
                  <PassengerForm
                    passenger={p}
                    actingToken={token}
                    title={p.firstName ? `${p.firstName} ${p.lastName ?? ""}`.trim() : `Passenger ${i + 2}`}
                  />
                  {appUrl && (
                    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                      <span>Forward this passenger&apos;s own link:</span>
                      <CopyLinkButton link={`${appUrl}/manifest/${p.token}`} />
                    </div>
                  )}
                </div>
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
