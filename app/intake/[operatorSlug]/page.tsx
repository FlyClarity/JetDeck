import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TripPlanner } from "@/components/intake/trip-planner";
import { PillField } from "@/components/intake/pill-field";

const REQUESTOR_TYPES = [
  { value: "direct", label: "Direct Client" },
  { value: "broker", label: "Broker" },
] as const;

const AIRCRAFT_PREFS = [
  { value: "no_preference", label: "No preference" },
  { value: "light", label: "Light" },
  { value: "midsize", label: "Midsize" },
  { value: "super_midsize", label: "Super-Midsize" },
  { value: "heavy", label: "Heavy" },
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

async function submitTripRequest(operatorSlug: string, formData: FormData) {
  "use server";

  const operator = await prisma.operator.findUnique({
    where: { slug: operatorSlug },
  });
  if (!operator) return;

  let legs: unknown[] = [];
  try {
    legs = JSON.parse(String(formData.get("legsJson") ?? "[]"));
  } catch {
    legs = [];
  }

  const normalizedLegs = (legs as Record<string, unknown>[]).map((leg) => ({
    depAirport: String(leg.depAirport ?? ""),
    arrAirport: String(leg.arrAirport ?? ""),
    date: String(leg.date ?? ""),
    timePref: leg.timePref ? String(leg.timePref) : null,
    timeFlexible: Boolean(leg.timeFlexible),
    passengerCount: leg.passengerCount ? Number(leg.passengerCount) : null,
  }));

  const requestorName = String(formData.get("requestorName") ?? "");
  const requestorEmail = String(formData.get("requestorEmail") ?? "");
  const aircraftPref = String(formData.get("aircraftPref") ?? "no_preference");

  await prisma.tripRequest.create({
    data: {
      operatorId: operator.id,
      source: "intake_form",
      requestorName,
      requestorEmail,
      requestorPhone: String(formData.get("requestorPhone") ?? "") || null,
      requestorCompany: String(formData.get("requestorCompany") ?? "") || null,
      requestorType: String(formData.get("requestorType") ?? "direct"),
      tripType: String(formData.get("tripType") ?? "one_way"),
      legs: normalizedLegs,
      aircraftPref: aircraftPref === "no_preference" ? null : aircraftPref,
      specialRequests: String(formData.get("specialRequests") ?? "") || null,
    },
  });

  const firstLeg = normalizedLegs[0] as
    | { depAirport?: string; arrAirport?: string; date?: string }
    | undefined;
  const routeSummary = firstLeg
    ? `${firstLeg.depAirport ?? "?"} → ${firstLeg.arrAirport ?? "?"} on ${firstLeg.date ?? "?"}`
    : "your trip";

  await sendEmail({
    to: requestorEmail,
    subject: `Request received — ${operator.name}`,
    html: `<p>Hi ${requestorName},</p><p>We received your trip request for ${routeSummary}. A member of our team will follow up shortly with a quote.</p><p>— ${operator.name}</p>`,
  });

  if (operator.notifyEmail) {
    await sendEmail({
      to: operator.notifyEmail,
      subject: `New trip request — ${requestorName}`,
      html: `<p>New trip request from ${requestorName} (${requestorEmail}) for ${routeSummary}.</p>`,
    });
  }

  redirect(`/intake/${operatorSlug}?submitted=1`);
}

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ operatorSlug: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { operatorSlug } = await params;
  const { submitted } = await searchParams;

  const operator = await prisma.operator.findUnique({
    where: { slug: operatorSlug },
  });

  if (!operator) {
    notFound();
  }

  if (submitted) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <span className="text-sm font-medium tracking-wide text-accent">
          {operator.name.toUpperCase()}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Request received
        </h1>
        <p className="text-muted-foreground">
          A member of our team will follow up shortly with a quote.
        </p>
      </div>
    );
  }

  const submitWithSlug = submitTripRequest.bind(null, operatorSlug);

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      <span className="text-sm font-medium tracking-wide text-accent">
        {operator.name.toUpperCase()}
      </span>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
        Request a Charter
      </h1>
      <p className="mt-2 text-muted-foreground">
        Tell us where you&apos;re headed — we&apos;ll follow up with a quote.
      </p>

      <form action={submitWithSlug} className="mt-10 flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <SectionLabel>Trip</SectionLabel>
          <TripPlanner />
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>Contact</SectionLabel>

          <PillField name="requestorType" options={REQUESTOR_TYPES} defaultValue="direct" />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="requestorName">Name</Label>
              <Input id="requestorName" name="requestorName" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="requestorEmail">Email</Label>
              <Input id="requestorEmail" name="requestorEmail" type="email" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="requestorCompany">Company</Label>
              <Input id="requestorCompany" name="requestorCompany" placeholder="Optional" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="requestorPhone">Phone</Label>
              <Input
                id="requestorPhone"
                name="requestorPhone"
                type="tel"
                placeholder="Optional"
              />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>Preferences</SectionLabel>

          <div className="flex flex-col gap-2">
            <Label>Aircraft category</Label>
            <PillField
              name="aircraftPref"
              options={AIRCRAFT_PREFS}
              defaultValue="no_preference"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="specialRequests">Special requests</Label>
            <Textarea
              id="specialRequests"
              name="specialRequests"
              rows={3}
              placeholder="Catering, ground transport, pets — anything we should know"
            />
          </div>
        </section>

        <Button type="submit" size="lg" className="self-start">
          Submit Request
        </Button>
      </form>
    </div>
  );
}
