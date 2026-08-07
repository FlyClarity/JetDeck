import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { generateQuoteNumber } from "@/lib/quote-server";
import { generateTripNumber } from "@/lib/trip-server";
import { findBookingConflict } from "@/lib/booking-server";
import { InternalTripForm } from "@/components/quote/internal-trip-form";

async function createInternalTrip(
  _prevState: { error: string } | null,
  formData: FormData
): Promise<{ error: string } | null> {
  "use server";

  const { userId, clerkOrgId } = await getTenantContext();
  if (!clerkOrgId || !userId) return { error: "Not signed in." };

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return { error: "Operator not found." };

  const purpose = String(formData.get("purpose") ?? "other");
  const aircraftId = String(formData.get("aircraftId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  const aircraft = await prisma.aircraft.findFirst({
    where: { id: aircraftId, operatorId: operator.id },
  });
  if (!aircraft) return { error: "Select an aircraft." };

  let rawLegs: { depAirport?: string; arrAirport?: string; date?: string }[] = [];
  try {
    rawLegs = JSON.parse(String(formData.get("legsJson") ?? "[]"));
  } catch {
    rawLegs = [];
  }
  const legs = rawLegs.filter((l) => l.depAirport && l.arrAirport && l.date);
  if (legs.length === 0) return { error: "Add at least one complete leg." };

  const itinerary = legs.map((l) => ({
    billAs: "revenue",
    depAirport: l.depAirport,
    arrAirport: l.arrAirport,
    date: l.date,
    flightHours: 0,
  }));

  // Internal trips go through the exact same aircraft-availability check as
  // a client booking — the whole point of this shortcut isn't to bypass
  // that, just the pricing/send/accept pipeline around it. Refuses to
  // create rather than silently double-booking; the operator fixes the
  // dates/aircraft and resubmits, same as they'd have to reconcile it
  // manually otherwise.
  const conflictWarning = await findBookingConflict({ aircraftId, itinerary });
  if (conflictWarning) {
    return { error: `Conflict: ${conflictWarning}` };
  }

  const quoteNumber = await generateQuoteNumber(operator.id);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  const quote = await prisma.quote.create({
    data: {
      operatorId: operator.id,
      quoteNumber,
      aircraftId,
      fleetSource: "own_fleet",
      itinerary,
      flightHours: 0,
      hourlyRate: 0,
      subtotal: 0,
      total: 0,
      depositAmount: 0,
      validUntil,
      internalNotes: note,
      tripPurpose: purpose,
      status: "accepted",
      acceptedAt: new Date(),
      createdBy: userId,
    },
  });

  const tripNumber = await generateTripNumber(operator.id);
  await prisma.trip.create({
    data: {
      operatorId: operator.id,
      tripNumber,
      quoteId: quote.id,
      status: "confirmed",
    },
  });

  const lastArrAirport = legs[legs.length - 1]?.arrAirport;
  if (lastArrAirport) {
    await prisma.aircraft.update({
      where: { id: aircraftId },
      data: { currentBase: lastArrAirport },
    });
  }

  redirect(`/quotes/${quote.id}`);
}

export default async function NewInternalTripPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const aircraftList = await prisma.aircraft.findMany({
    where: { operatorId: operator.id, status: "active" },
    orderBy: { tailNumber: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Log Internal Flight</h1>
      <p className="mt-1 text-muted-foreground">
        For owner flights, maintenance ferries, or repositioning — skips pricing and the client
        quoting pipeline entirely, but still counts against the aircraft&apos;s schedule for
        conflict checking.
      </p>

      <div className="mt-8">
        <InternalTripForm aircraftList={aircraftList} action={createInternalTrip} />
      </div>
    </div>
  );
}
