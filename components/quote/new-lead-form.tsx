"use client";

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

export function NewLeadForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action} className="mt-8 flex flex-col gap-10">
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
            <Input id="requestorPhone" name="requestorPhone" type="tel" placeholder="Optional" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Preferences</SectionLabel>

        <div className="flex flex-col gap-2">
          <Label>Aircraft category</Label>
          <PillField name="aircraftPref" options={AIRCRAFT_PREFS} defaultValue="no_preference" />
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
        Continue to Quote
      </Button>
    </form>
  );
}
