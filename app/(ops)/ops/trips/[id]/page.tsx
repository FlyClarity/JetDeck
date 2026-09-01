import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { revenueLegsOf, revenueLegsWithIndex, mapsSearchUrl, flightTimeLabel, type StoredLeg } from "@/lib/itinerary";
import { greatCircleDistanceNm, estimateFlightHours, resolveAirportTimezone } from "@/lib/geo";
import { addHoursAcrossTimezones, to12Hour, tzAbbreviation } from "@/lib/time";
import { STATUS_LABELS, STATUS_SHORT_LABELS, TRIP_STAGES, isTripPaid } from "@/lib/trip";
import { crewRoleLabel } from "@/lib/crew";
import { createManifestForTrip } from "@/lib/manifest";
import { evaluateOpsReview } from "@/lib/ops-review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyLinkButton } from "@/components/quote/copy-link-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAppUrl } from "@/lib/url";
import { cn } from "@/lib/utils";

// Crew assignment only ever moves a trip forward out of the pre-crew
// statuses — never regresses a trip that's already further along (e.g.
// re-assigning crew on an in-flight trip shouldn't knock it back a stage).
const PRE_CREW_STATUSES = ["confirmed", "ops_review"];

async function getScopedTrip(id: string) {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return null;

  const trip = await prisma.trip.findFirst({
    where: { id, operatorId: operator.id },
    include: {
      passengers: { orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] },
      crewAssignments: { include: { crew: true }, orderBy: { createdAt: "asc" } },
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

  // Self-heal: a Trip row can be stuck on a stale pre-cancellation status
  // (e.g. cancelled before the cascade fix existed) even though its Quote
  // is unambiguously cancelled — this is the one place that display bug
  // was still visible after the belt-and-suspenders list filters shipped,
  // since a direct detail-page visit doesn't go through those. Fixed for
  // real here instead of just hidden, so it stays fixed everywhere.
  if (trip.quote.status === "cancelled" && trip.status !== "cancelled_by_operator") {
    await prisma.trip.update({ where: { id: trip.id }, data: { status: "cancelled_by_operator" } });
    trip.status = "cancelled_by_operator";
  }

  return { trip, operator };
}

// Ops correction of the itinerary's schedule details (airports, date,
// times) and FBO assignment, post-booking — not part of pricing, so it
// lives here rather than the Quote Builder. Written back onto each leg's
// own position in the stored itinerary array (see revenueLegsWithIndex)
// rather than a separate table, since it's just fields on data that
// already exists per leg. Deliberately doesn't touch pricing
// (hourlyRate/overnightNights/totals) — this is for fixing a data-entry
// mistake or a schedule change the client already agreed to out of band,
// not a re-quote.
async function updateLegDetails(tripId: string, formData: FormData) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped || !scoped.trip.quote.selectedOptionId) return;

  const itinerary = (scoped.trip.quote.selectedOption?.itinerary as StoredLeg[] | null) ?? [];

  const edits = itinerary.map((leg, index) => {
    if ((leg.billAs ?? "revenue") !== "revenue") return null;
    const depTimeTBD = formData.get(`depTimeTBD-${index}`) === "on";
    return {
      index,
      depAirport: String(formData.get(`depAirport-${index}`) ?? "").trim().toUpperCase() || leg.depAirport || null,
      arrAirport: String(formData.get(`arrAirport-${index}`) ?? "").trim().toUpperCase() || leg.arrAirport || null,
      date: String(formData.get(`date-${index}`) ?? "").trim() || leg.date || null,
      depTimeTBD,
      depTime: depTimeTBD ? null : String(formData.get(`depTime-${index}`) ?? "").trim() || null,
    };
  });

  // Recompute flight time and arrival time the same way the Quote
  // Builder does live — otherwise editing an airport or departure time
  // here would silently leave a stale flightHours/arrTime behind, which
  // both the client-facing pages and the duty-time compliance check read
  // as if it were still accurate.
  const codes = new Set<string>();
  for (const e of edits) {
    if (e?.depAirport) codes.add(e.depAirport);
    if (e?.arrAirport) codes.add(e.arrAirport);
  }
  const airportRows = codes.size ? await prisma.airport.findMany({ where: { icao: { in: [...codes] } } }) : [];
  // Airport.timezone is never actually populated in the DB (see
  // resolveAirportTimezone) — resolve it from lat/lon here rather than
  // trusting the stored column, or every cross-timezone route silently
  // falls back to naive same-zone arrival math.
  const airportByCode = Object.fromEntries(
    airportRows.map((a) => [a.icao, { ...a, timezone: resolveAirportTimezone(a.timezone, a.lat, a.lon) }])
  );

  // Only ever recomputable for an owned-fleet aircraft — BrokeredAircraft
  // has no cruise-speed performance data, so a brokered trip keeps
  // whatever flight time it was quoted with.
  const cruiseSpeedKts = scoped.trip.quote.selectedOption?.aircraft?.cruiseSpeedKts ?? null;
  const blockTimeBufferHours = scoped.operator.defaultBlockTimeBufferHours;

  const updated = itinerary.map((leg, index) => {
    const edit = edits.find((e) => e?.index === index);
    if (!edit) return leg;

    const dep = edit.depAirport ? airportByCode[edit.depAirport] : undefined;
    const arr = edit.arrAirport ? airportByCode[edit.arrAirport] : undefined;

    const recomputedFlightHours =
      dep && arr && cruiseSpeedKts
        ? estimateFlightHours(greatCircleDistanceNm(dep.lat, dep.lon, arr.lat, arr.lon), cruiseSpeedKts, blockTimeBufferHours)
        : null;
    const flightHours = recomputedFlightHours ?? leg.flightHours;

    const arrTime =
      edit.depTimeTBD || !edit.depTime || !edit.date
        ? null
        : addHoursAcrossTimezones(edit.date, edit.depTime, flightHours ?? 0, dep?.timezone ?? null, arr?.timezone ?? null)
            .time || null;

    return {
      ...leg,
      depAirport: edit.depAirport,
      arrAirport: edit.arrAirport,
      date: edit.date,
      depTimeTBD: edit.depTimeTBD,
      depTime: edit.depTime,
      flightHours,
      arrTime,
      depFboName: String(formData.get(`depFboName-${index}`) ?? "").trim() || null,
      depFboAddress: String(formData.get(`depFboAddress-${index}`) ?? "").trim() || null,
      arrFboName: String(formData.get(`arrFboName-${index}`) ?? "").trim() || null,
      arrFboAddress: String(formData.get(`arrFboAddress-${index}`) ?? "").trim() || null,
    };
  });

  await prisma.quoteOption.update({
    where: { id: scoped.trip.quote.selectedOptionId },
    data: { itinerary: updated },
  });

  revalidatePath(`/ops/trips/${tripId}`);
}

// A pure tail swap within the same sourcing lane (own fleet <-> own fleet,
// or brokered <-> brokered) — the common ops case ("N123AB went down for
// maintenance, move this trip to N456CD"). Switching sourcing lane
// entirely (fleet to brokered or vice versa) changes the pricing model
// (wholesale cost, margin) and belongs in a re-quote, not a quick
// correction here, so this only ever updates the aircraft/brokeredAircraft
// FK that already applies to this option.
async function updateAircraft(tripId: string, formData: FormData) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped || !scoped.trip.quote.selectedOptionId) return;

  const newId = String(formData.get("aircraftId") ?? "");
  if (!newId) return;

  if (scoped.trip.quote.selectedOption?.fleetSource === "brokered") {
    const aircraft = await prisma.brokeredAircraft.findFirst({
      where: { id: newId, operatorId: scoped.operator.id },
    });
    if (!aircraft) return;
    await prisma.quoteOption.update({
      where: { id: scoped.trip.quote.selectedOptionId },
      data: { brokeredAircraftId: aircraft.id },
    });
  } else {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: newId, operatorId: scoped.operator.id },
    });
    if (!aircraft) return;
    await prisma.quoteOption.update({
      where: { id: scoped.trip.quote.selectedOptionId },
      data: { aircraftId: aircraft.id },
    });
  }

  revalidatePath(`/ops/trips/${tripId}`);
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

  revalidatePath(`/ops/trips/${tripId}`);
}

// Deliberately can't remove the lead — their token is what the booking
// confirmation email and every reminder point to, and the self-service page
// keys "who can add/manage other passengers" off isLead. Removing them
// would orphan those links and the rest of the manifest with no one able
// to manage it. An ops mistake there means editing the lead's own info
// instead, not deleting the row.
async function removePassenger(tripId: string, passengerId: string) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped) return;

  const passenger = scoped.trip.passengers.find((p) => p.id === passengerId);
  if (!passenger || passenger.isLead) return;

  await prisma.passenger.delete({ where: { id: passengerId } });

  revalidatePath(`/ops/trips/${tripId}`);
}

// Ops-side entry point for a trip that never got a manifest automatically
// (internal trips — owner/maintenance/repositioning — skip this in
// finalizeBooking by design) but still needs one, e.g. a booking that came
// in by phone/text outside the usual client checkout.
async function startManifest(tripId: string) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped || scoped.trip.passengers.length > 0) return;

  await createManifestForTrip(tripId);
  revalidatePath(`/ops/trips/${tripId}`);
}

// Mirrors the self-service /manifest/[token] "+ Add Another Passenger"
// action, but triggered by the operator directly — for a passenger whose
// info was collected some other way (phone, email) rather than through the
// link, so there's no need to make the operator go open the lead's own
// manifest link just to add a blank row for them to fill in.
async function addPassengerOps(tripId: string) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped) return;
  const { trip, operator } = scoped;

  const seatCap = trip.quote.selectedOption?.aircraft?.seats ?? trip.quote.selectedOption?.brokeredAircraft?.seats ?? null;
  if (seatCap !== null && trip.passengers.length >= seatCap) return;

  await prisma.passenger.create({
    data: { operatorId: operator.id, tripId },
  });

  revalidatePath(`/ops/trips/${tripId}`);
}

// On-demand, resendable any time — unlike the one-time automatic booking
// confirmation (sendBookingConfirmationEmail), this is how ops gets a
// fresh, polished copy of the itinerary into the client's inbox whenever
// it changes (FBOs added, times adjusted) or the original email never
// reached them. Links to the same /q/[token] page the client already
// uses, which always reflects the trip's current state.
async function sendItinerary(tripId: string) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped) return;
  const { trip, operator } = scoped;

  const requestorEmail = trip.quote.tripRequest?.requestorEmail;
  if (!requestorEmail) return;

  const requestorName = trip.quote.tripRequest?.requestorName ?? "there";
  const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
  const routeText = legs.length
    ? `${legs[0].depAirport} → ${legs[legs.length - 1].arrAirport}`
    : "";
  const appUrl = await getAppUrl();
  const quoteLink = `${appUrl}/q/${trip.quote.token}`;

  await sendEmail({
    to: requestorEmail,
    subject: `Your Itinerary — ${trip.tripNumber}${routeText ? ` (${routeText})` : ""}`,
    html: `<p>Hi ${requestorName},</p><p>Here's your itinerary for ${trip.tripNumber}: <a href="${quoteLink}">View Your Itinerary</a></p><p>— ${operator.name}</p>`,
    replyTo: operator.replyToEmail ?? undefined,
    bcc: operator.replyToEmail ?? undefined,
    from: operator.fromEmail,
    fromName: operator.name,
  });
}

async function assignCrew(tripId: string, formData: FormData) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped) return;

  const crewId = String(formData.get("crewId") ?? "");
  const crew = await prisma.crewMember.findFirst({
    where: { id: crewId, operatorId: scoped.operator.id },
  });
  if (!crew) return;

  await prisma.tripCrewAssignment.upsert({
    where: { tripId_crewId: { tripId, crewId } },
    create: { operatorId: scoped.operator.id, tripId, crewId, roleOnTrip: crew.role },
    update: {},
  });

  if (PRE_CREW_STATUSES.includes(scoped.trip.status)) {
    await prisma.trip.update({ where: { id: tripId }, data: { status: "crew_assigned" } });
  }

  revalidatePath(`/ops/trips/${tripId}`);
}

async function unassignCrew(tripId: string, assignmentId: string) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped) return;

  await prisma.tripCrewAssignment.deleteMany({
    where: { id: assignmentId, tripId, operatorId: scoped.operator.id },
  });

  // Mirrors assignCrew's forward bump: removing the last crew member off a
  // trip that's only at "crew_assigned" because crew was assigned (not
  // further along in the pipeline) drops it back a stage on the board
  // rather than leaving a crewless trip stuck showing as staffed.
  const remaining = await prisma.tripCrewAssignment.count({ where: { tripId } });
  if (remaining === 0 && scoped.trip.status === "crew_assigned") {
    const idx = TRIP_STAGES.findIndex((s) => s === "crew_assigned");
    await prisma.trip.update({ where: { id: tripId }, data: { status: TRIP_STAGES[idx - 1] } });
  }

  revalidatePath(`/ops/trips/${tripId}`);
}

// Re-verifies the Ops Review checklist server-side before actually
// advancing the stage — never trusts that the button was disabled
// correctly client-side, since this is the one transition in the trip
// lifecycle that's actually gated (see the Board's moveTripStage, which
// deliberately refuses to make this same jump).
async function approveForOps(tripId: string) {
  "use server";

  const scoped = await getScopedTrip(tripId);
  if (!scoped) return;
  if (!["ops_review", "crew_assigned"].includes(scoped.trip.status)) return;

  const result = await evaluateOpsReview(tripId, scoped.operator.id);
  if (!result.passed) return;

  await prisma.trip.update({ where: { id: tripId }, data: { status: "ops_approved" } });
  revalidatePath(`/ops/trips/${tripId}`);
}

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await getScopedTrip(id);
  if (!scoped) notFound();
  const { trip } = scoped;

  const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
  const legsIndexed = revenueLegsWithIndex(trip.quote.selectedOption?.itinerary);

  const legAirportCodes = [
    ...new Set(legs.flatMap((l) => [l.depAirport, l.arrAirport]).filter((c): c is string => Boolean(c))),
  ];
  const legAirportRows = await prisma.airport.findMany({ where: { icao: { in: legAirportCodes } } });
  const airportByIcao = Object.fromEntries(
    legAirportRows.map((a) => [a.icao, { ...a, timezone: resolveAirportTimezone(a.timezone, a.lat, a.lon) }])
  );
  // "KILG" means nothing to most people — shown as a caption under each
  // airport input so ops can confirm it's the right one without needing to
  // already know the ICAO code by heart.
  function airportLocation(icao: string | null | undefined): string | null {
    if (!icao) return null;
    const a = airportByIcao[icao];
    return a ? [a.city, a.state].filter(Boolean).join(", ") || null : null;
  }

  const passengerNotes = trip.passengers.filter((p) => p.specialRequests);
  const hasNotes =
    Boolean(trip.quote.tripRequest?.specialRequests) ||
    Boolean(trip.quote.selectedOption?.clientNotes) ||
    passengerNotes.length > 0;

  const aircraftLabel = trip.quote.selectedOption?.aircraft
    ? `${trip.quote.selectedOption.aircraft.make} ${trip.quote.selectedOption.aircraft.model} (${trip.quote.selectedOption.aircraft.tailNumber})`
    : trip.quote.selectedOption?.brokeredAircraft
      ? `${trip.quote.selectedOption.brokeredAircraft.make ?? ""} ${trip.quote.selectedOption.brokeredAircraft.model ?? ""}`.trim()
      : "Aircraft TBD";
  const requestorName = trip.quote.contact
    ? `${trip.quote.contact.firstName} ${trip.quote.contact.lastName}`
    : (trip.quote.tripRequest?.requestorName ?? "");

  const appUrl = await getAppUrl();

  const assignedCrewIds = trip.crewAssignments.map((a) => a.crewId);
  const availableCrew = await prisma.crewMember.findMany({
    where: { operatorId: scoped.operator.id, active: true, id: { notIn: assignedCrewIds } },
    orderBy: { name: "asc" },
  });
  const assignWithId = assignCrew.bind(null, trip.id);
  const updateLegDetailsWithId = updateLegDetails.bind(null, trip.id);
  const updateAircraftWithId = updateAircraft.bind(null, trip.id);

  // Reassignment offers only aircraft in the same sourcing lane as what's
  // already selected — swapping fleet-sourced for brokered (or vice versa)
  // changes the pricing model and belongs in a re-quote, not here.
  const fleetSource = trip.quote.selectedOption?.fleetSource ?? "own_fleet";
  const otherAircraft =
    fleetSource === "brokered"
      ? (
          await prisma.brokeredAircraft.findMany({
            where: { operatorId: scoped.operator.id, id: { not: trip.quote.selectedOption?.brokeredAircraftId ?? undefined } },
            orderBy: { tailNumber: "asc" },
          })
        ).map((a) => ({ id: a.id, label: `${a.tailNumber}${a.make || a.model ? ` — ${a.make ?? ""} ${a.model ?? ""}`.trim() : ""}` }))
      : (
          await prisma.aircraft.findMany({
            where: { operatorId: scoped.operator.id, status: "active", id: { not: trip.quote.selectedOption?.aircraftId ?? undefined } },
            orderBy: { tailNumber: "asc" },
          })
        ).map((a) => ({ id: a.id, label: `${a.tailNumber} — ${a.make} ${a.model}` }));

  const paid = isTripPaid(trip.quote);
  const stageIndex = TRIP_STAGES.findIndex((s) => s === trip.status);

  // The checklist only matters before the trip has actually been approved
  // — once past that gate, it stays approved (nothing here re-litigates
  // an approval if, say, a crew member's medical lapses afterward; that's
  // the future crew compliance dashboard's job, not this one-time gate).
  const showOpsReview = ["confirmed", "ops_review", "crew_assigned"].includes(trip.status);
  const opsReview = showOpsReview ? await evaluateOpsReview(trip.id, scoped.operator.id) : null;
  const approveWithId = approveForOps.bind(null, trip.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{trip.tripNumber}</h1>
          <p className="mt-1 text-muted-foreground">
            {requestorName} · {aircraftLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-sm font-medium",
              paid ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
            )}
          >
            {paid ? "Paid" : "Not Paid"}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
            {STATUS_LABELS[trip.status] ?? trip.status}
          </span>
        </div>
      </div>

      {stageIndex !== -1 && (
        <div className="mt-6 flex items-start">
          {TRIP_STAGES.map((stage, i) => {
            const isDone = stageIndex > i;
            const isCurrent = stageIndex === i;
            return (
              <div key={stage} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                      isDone
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                          ? "border-2 border-primary text-primary"
                          : "border border-border text-muted-foreground"
                    )}
                  >
                    {isDone ? "✓" : STATUS_SHORT_LABELS[stage]}
                  </div>
                  <span
                    className={cn(
                      "w-16 text-center text-[10px]",
                      isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {STATUS_LABELS[stage]}
                  </span>
                </div>
                {i < TRIP_STAGES.length - 1 && (
                  <div className={cn("mb-4 h-px flex-1", isDone ? "bg-primary" : "bg-border")} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {opsReview && (
        <div className="mt-6 rounded-md border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Ops Review Checklist
            </h2>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                opsReview.passed ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"
              )}
            >
              {opsReview.passed ? "Ops Approved — ready" : "Needs Further Review"}
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {opsReview.checks.map((check) => (
              <div key={check.label} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className={check.passed ? "text-accent" : "text-destructive"}>
                    {check.passed ? "✓" : "✗"}
                  </span>
                  <span className="font-medium">{check.label}</span>
                </div>
                {check.notes.map((note, i) => (
                  <p key={i} className="pl-6 text-xs text-muted-foreground">
                    {note}
                  </p>
                ))}
              </div>
            ))}
          </div>

          <form action={approveWithId} className="mt-4">
            <Button type="submit" size="sm" disabled={!opsReview.passed}>
              Approve for Ops
            </Button>
          </form>
        </div>
      )}

      <div className="mt-6 rounded-md border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Itinerary</h2>
          {trip.quote.tripRequest?.requestorEmail && (
            <form action={sendItinerary.bind(null, trip.id)}>
              <Button type="submit" size="sm" variant="outline">
                Send Itinerary to Client
              </Button>
            </form>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3">
          <p className="text-sm">
            <span className="text-muted-foreground">Aircraft: </span>
            <span className="font-medium">{aircraftLabel}</span>
          </p>
          {otherAircraft.length > 0 && (
            <form action={updateAircraftWithId} className="flex items-center gap-2">
              <Select name="aircraftId">
                <SelectTrigger className="h-8 w-56 overflow-hidden text-sm">
                  <SelectValue placeholder="Swap to..." className="min-w-0 flex-1 truncate" />
                </SelectTrigger>
                <SelectContent>
                  {otherAircraft.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="sm" variant="outline">
                Swap
              </Button>
            </form>
          )}
        </div>

        <form action={updateLegDetailsWithId} className="mt-3 flex flex-col gap-4">
          {legsIndexed.map(({ leg, index }) => (
            <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Departure Airport
                  </p>
                  <Input
                    name={`depAirport-${index}`}
                    defaultValue={leg.depAirport ?? ""}
                    placeholder="ICAO"
                    className="h-8 text-sm uppercase"
                  />
                  {airportLocation(leg.depAirport) && (
                    <p className="text-xs text-muted-foreground">{airportLocation(leg.depAirport)}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Arrival Airport
                  </p>
                  <Input
                    name={`arrAirport-${index}`}
                    defaultValue={leg.arrAirport ?? ""}
                    placeholder="ICAO"
                    className="h-8 text-sm uppercase"
                  />
                  {airportLocation(leg.arrAirport) && (
                    <p className="text-xs text-muted-foreground">{airportLocation(leg.arrAirport)}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Date</p>
                  <Input name={`date-${index}`} type="date" defaultValue={leg.date ?? ""} className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Departure Time
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      name={`depTime-${index}`}
                      type="time"
                      defaultValue={leg.depTime ?? ""}
                      className="h-8 text-sm"
                    />
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        name={`depTimeTBD-${index}`}
                        defaultChecked={leg.depTimeTBD ?? false}
                        className="h-3.5 w-3.5"
                      />
                      TBD
                    </label>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Arrival Time</p>
                  <div className="flex h-8 items-center text-sm">
                    {leg.arrTime
                      ? `${to12Hour(leg.arrTime)} ${tzAbbreviation(airportByIcao[leg.arrAirport ?? ""]?.timezone, leg.date)}`.trim()
                      : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Auto-computed from departure time + flight time
                    {leg.flightHours ? ` (${flightTimeLabel(leg.flightHours)})` : ""} — save to recalculate.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Departure FBO — {leg.depAirport}
                  </p>
                  <Input
                    name={`depFboName-${index}`}
                    defaultValue={leg.depFboName ?? ""}
                    placeholder="Name (e.g. Atlantic Aviation)"
                    className="h-8 text-sm"
                  />
                  <Input
                    name={`depFboAddress-${index}`}
                    defaultValue={leg.depFboAddress ?? ""}
                    placeholder="Address"
                    className="h-8 text-sm"
                  />
                  {leg.depFboAddress && (
                    <a
                      href={mapsSearchUrl(leg.depFboAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline underline-offset-4"
                    >
                      Open in Maps ↗
                    </a>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Arrival FBO — {leg.arrAirport}
                  </p>
                  <Input
                    name={`arrFboName-${index}`}
                    defaultValue={leg.arrFboName ?? ""}
                    placeholder="Name (e.g. Signature Flight Support)"
                    className="h-8 text-sm"
                  />
                  <Input
                    name={`arrFboAddress-${index}`}
                    defaultValue={leg.arrFboAddress ?? ""}
                    placeholder="Address"
                    className="h-8 text-sm"
                  />
                  {leg.arrFboAddress && (
                    <a
                      href={mapsSearchUrl(leg.arrFboAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline underline-offset-4"
                    >
                      Open in Maps ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Button type="submit" size="sm" className="self-start">
            Save Itinerary
          </Button>
        </form>

        {hasNotes && (
          <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-sm">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Notes</p>
            {trip.quote.selectedOption?.clientNotes && <p>{trip.quote.selectedOption.clientNotes}</p>}
            {trip.quote.tripRequest?.specialRequests && <p>{trip.quote.tripRequest.specialRequests}</p>}
            {passengerNotes.map((p) => (
              <p key={p.id}>
                {p.firstName ?? ""} {p.lastName ?? ""}: {p.specialRequests}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-md border border-border p-4">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Crew</h2>
        {trip.crewAssignments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No crew assigned yet.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {trip.crewAssignments.map((a) => {
              const unassignWithIds = unassignCrew.bind(null, trip.id, a.id);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {a.crew.name} <span className="text-muted-foreground">({crewRoleLabel(a.roleOnTrip)})</span>
                  </span>
                  <form action={unassignWithIds}>
                    <Button type="submit" size="sm" variant="ghost">
                      Remove
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
        {availableCrew.length > 0 ? (
          <form action={assignWithId} className="mt-3 flex items-center gap-2">
            <Select name="crewId">
              <SelectTrigger className="w-64 overflow-hidden">
                <SelectValue placeholder="Select crew member" className="min-w-0 flex-1 truncate" />
              </SelectTrigger>
              <SelectContent>
                {availableCrew.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({crewRoleLabel(c.role)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" variant="outline">
              Assign
            </Button>
          </form>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {trip.crewAssignments.length === 0 ? "No" : "No more"} active crew available to assign —{" "}
            <Link href="/ops/crew/new" className="underline underline-offset-4">
              add crew
            </Link>
            .
          </p>
        )}
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
        <div className="flex shrink-0 items-center gap-2">
          {trip.passengers.length > 0 ? (
            <>
              <form action={addPassengerOps.bind(null, trip.id)}>
                <Button type="submit" size="sm" variant="outline">
                  + Add Passenger
                </Button>
              </form>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/ops/trips/${trip.id}/manifest-print`} target="_blank">
                  Print Manifest
                </Link>
              </Button>
            </>
          ) : (
            <form action={startManifest.bind(null, trip.id)}>
              <Button type="submit" size="sm" variant="outline">
                Start Manifest Collection
              </Button>
            </form>
          )}
        </div>
      </div>

      {trip.passengers.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No manifest yet — internal/non-client trips don&apos;t collect one automatically, but you can
          start one manually above if this trip needs it.
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
                  {legsIndexed.length > 1 && p.legIndexes.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Legs:{" "}
                      {p.legIndexes
                        .map((i) => legsIndexed.find((l) => l.index === i))
                        .filter((l): l is (typeof legsIndexed)[number] => Boolean(l))
                        .map((l) => `${l.leg.depAirport} → ${l.leg.arrAirport}`)
                        .join(", ")}
                    </p>
                  )}
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
                  {!p.isLead && (
                    <form action={removePassenger.bind(null, trip.id, p.id)}>
                      <Button type="submit" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                        Remove
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
