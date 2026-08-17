import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/url";
import { revenueLegsOf } from "@/lib/itinerary";
import { departureInstantUtc } from "@/lib/time";

// Ops Build Brief, Module 2 — reprioritized ahead of Crew Assignment
// (Step 24), so the trigger here is Trip creation itself rather than the
// brief's original "CREW_ASSIGNED" status change: there's no crew module
// yet, and starting collection as early as possible is strictly better for
// the actual goal (getting manifest data in before departure) regardless.
//
// Only ever called for a Trip with a real client behind it (a linked
// Contact or TripRequest) — internal trips (owner flights, maintenance,
// repositioning — see quotes/internal/new) are created directly by the
// operator, who already knows exactly who's aboard; the "stop chasing
// people by email" problem this module solves doesn't apply there.
export async function createManifestForTrip(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: {
      operator: true,
      quote: {
        include: {
          contact: true,
          tripRequest: true,
          selectedOption: { include: { aircraft: true, brokeredAircraft: true } },
        },
      },
    },
  });

  const { quote } = trip;
  const leadEmail = quote.contact?.email ?? quote.tripRequest?.requestorEmail;
  if (!leadEmail || !quote.selectedOption) return;

  const leadFirstName = quote.contact?.firstName ?? quote.tripRequest?.requestorName?.split(" ")[0] ?? "";
  const leadLastName =
    quote.contact?.lastName ??
    quote.tripRequest?.requestorName?.split(" ").slice(1).join(" ") ??
    "";

  const lead = await prisma.passenger.create({
    data: {
      operatorId: trip.operatorId,
      tripId: trip.id,
      isLead: true,
      firstName: leadFirstName || null,
      lastName: leadLastName || null,
    },
  });

  const legs = revenueLegsOf(quote.selectedOption.itinerary);
  const firstLeg = legs[0];
  const routeText = firstLeg ? `${firstLeg.depAirport ?? "?"} → ${legs[legs.length - 1]?.arrAirport ?? "?"}` : "your flight";
  const dateText = firstLeg?.date ? new Date(`${firstLeg.date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";

  const appUrl = await getAppUrl();
  const manifestUrl = `${appUrl}/manifest/${lead.token}`;

  await sendEmail({
    to: leadEmail,
    subject: `Passenger info needed — ${routeText}${dateText ? ` on ${dateText}` : ""}`,
    html: `<p>Hi ${leadFirstName || "there"},</p><p>Your charter flight ${routeText}${dateText ? ` on ${dateText}` : ""} is confirmed. Please complete your passenger information at the link below — this is required for your flight. If you have additional passengers, you can add them yourself or forward this link to them.</p><p><a href="${manifestUrl}">Complete Passenger Information</a></p><p>— ${trip.operator.name}</p>`,
    replyTo: trip.operator.replyToEmail ?? undefined,
    from: trip.operator.fromEmail,
    fromName: trip.operator.name,
  });
}

const REMINDER_THRESHOLDS: { type: string; hours: number }[] = [
  { type: "72hr", hours: 72 },
  { type: "48hr", hours: 48 },
  { type: "24hr", hours: 24 },
  { type: "12hr", hours: 12 },
];

// Run frequently (see app/api/cron/manifest-reminders/route.ts) so the
// 12-hour threshold is actually meaningful. Degrades gracefully on a
// coarser schedule too (e.g. a Vercel Hobby plan limited to once daily) —
// each threshold just fires a bit late relative to its exact hour mark
// instead of not firing at all, since this always checks actual
// hours-until-departure rather than assuming how recently it last ran.
export async function sendManifestReminders(): Promise<{ sent: number }> {
  const trips = await prisma.trip.findMany({
    where: { status: { notIn: ["completed", "invoiced", "closed"] } },
    include: {
      operator: true,
      passengers: true,
      manifestReminders: true,
      quote: {
        include: {
          contact: true,
          tripRequest: true,
          selectedOption: { include: { aircraft: true } },
        },
      },
    },
  });

  let sent = 0;

  for (const trip of trips) {
    if (trip.passengers.length === 0) continue; // no manifest ever generated (internal trip, etc.)

    const lead = trip.passengers.find((p) => p.isLead);
    if (!lead) continue;
    // Passenger has no email field (each additional passenger is only ever
    // reachable via the link the lead forwards) — the lead's own email
    // still lives on the Quote, same lookup as createManifestForTrip.
    const leadEmail = trip.quote.contact?.email ?? trip.quote.tripRequest?.requestorEmail;
    if (!leadEmail) continue;

    const allSubmitted = trip.passengers.every((p) => p.submittedAt);
    if (allSubmitted) continue;

    const legs = revenueLegsOf(trip.quote.selectedOption?.itinerary);
    const firstLeg = legs[0];
    if (!firstLeg?.date) continue;

    const depAirport = await prisma.airport.findUnique({
      where: { icao: firstLeg.depAirport ?? "" },
      select: { timezone: true },
    });
    const departureInstant = departureInstantUtc(
      firstLeg.date,
      firstLeg.depTimeTBD ? null : firstLeg.depTime,
      depAirport?.timezone
    );
    if (!departureInstant) continue;

    const hoursUntilDeparture = (departureInstant.getTime() - Date.now()) / 3600000;
    if (hoursUntilDeparture < 0) continue; // already departed — nothing left to remind about

    const sentTypes = new Set(
      trip.manifestReminders.filter((r) => r.sentAt).map((r) => r.type)
    );

    for (const threshold of REMINDER_THRESHOLDS) {
      if (hoursUntilDeparture > threshold.hours) continue; // not due yet
      if (sentTypes.has(threshold.type)) continue; // already sent

      const missing = trip.passengers.filter((p) => !p.submittedAt).length;
      const appUrl = await getAppUrl();
      const manifestUrl = `${appUrl}/manifest/${lead.token}`;

      await sendEmail({
        to: leadEmail,
        subject: `Reminder: passenger info needed for your upcoming flight`,
        html: `<p>Hi ${lead.firstName || "there"},</p><p>Your flight is coming up and we're still missing passenger information for ${missing} passenger${missing === 1 ? "" : "s"}. Please complete it as soon as you can: <a href="${manifestUrl}">Complete Passenger Information</a></p><p>— ${trip.operator.name}</p>`,
        replyTo: trip.operator.replyToEmail ?? undefined,
        from: trip.operator.fromEmail,
        fromName: trip.operator.name,
      });

      if (threshold.type === "12hr" && trip.operator.notifyEmail) {
        await sendEmail({
          to: trip.operator.notifyEmail,
          subject: `⚠️ Manifest incomplete — ${trip.tripNumber} departs in under 12 hours`,
          html: `<p>${missing} passenger${missing === 1 ? " hasn't" : "s haven't"} submitted info for ${trip.tripNumber}, departing in under 12 hours.</p>`,
          from: trip.operator.fromEmail,
          fromName: trip.operator.name,
        });
      }

      await prisma.manifestReminder.upsert({
        where: { tripId_type: { tripId: trip.id, type: threshold.type } },
        create: { operatorId: trip.operatorId, tripId: trip.id, type: threshold.type, sentAt: new Date() },
        update: { sentAt: new Date() },
      });
      sent++;
    }
  }

  return { sent };
}
