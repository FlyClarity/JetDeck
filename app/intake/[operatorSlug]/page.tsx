import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LegsField } from "@/components/intake/legs-field";

const AIRCRAFT_PREFS = [
  { value: "no_preference", label: "No preference" },
  { value: "light", label: "Light" },
  { value: "midsize", label: "Midsize" },
  { value: "super_midsize", label: "Super-Midsize" },
  { value: "heavy", label: "Heavy" },
];

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
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <span className="text-sm font-medium tracking-wide text-accent">
        {operator.name.toUpperCase()}
      </span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Request a Charter
      </h1>

      <form action={submitWithSlug} className="mt-8 flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="requestorName">Full name</Label>
            <Input id="requestorName" name="requestorName" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="requestorCompany">Company (optional)</Label>
            <Input id="requestorCompany" name="requestorCompany" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="requestorEmail">Email</Label>
            <Input id="requestorEmail" name="requestorEmail" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="requestorPhone">Phone (optional)</Label>
            <Input id="requestorPhone" name="requestorPhone" type="tel" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="requestorType">I am a</Label>
            <Select name="requestorType" defaultValue="direct">
              <SelectTrigger id="requestorType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct Client</SelectItem>
                <SelectItem value="broker">Broker</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tripType">Trip type</Label>
            <Select name="tripType" defaultValue="one_way">
              <SelectTrigger id="tripType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_way">One-Way</SelectItem>
                <SelectItem value="round_trip">Round Trip</SelectItem>
                <SelectItem value="multi_leg">Multi-Leg</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <LegsField />

        <div className="flex flex-col gap-2">
          <Label htmlFor="aircraftPref">Aircraft category preference</Label>
          <Select name="aircraftPref" defaultValue="no_preference">
            <SelectTrigger id="aircraftPref">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AIRCRAFT_PREFS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="specialRequests">Special requests (optional)</Label>
          <Textarea id="specialRequests" name="specialRequests" rows={3} />
        </div>

        <Button type="submit" size="lg" className="self-start">
          Submit Request
        </Button>
      </form>
    </div>
  );
}
