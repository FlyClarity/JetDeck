"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TripPlanner } from "@/components/intake/trip-planner";
import { PillField } from "@/components/intake/pill-field";
import { ContactCombobox } from "@/components/quote/contact-combobox";
import type { ContactOption } from "@/lib/contact-server";

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
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);

  return (
    <form action={action} className="mt-8 flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <SectionLabel>Trip</SectionLabel>
        <TripPlanner />
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Contact</SectionLabel>

        {!selectedContact && (
          <div className="flex flex-col gap-2">
            <Label>Existing client</Label>
            <ContactCombobox onSelect={setSelectedContact} />
          </div>
        )}

        {selectedContact ? (
          <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
            <div>
              <p className="font-medium">
                {selectedContact.firstName} {selectedContact.lastName}
                {selectedContact.company ? ` — ${selectedContact.company}` : ""}
              </p>
              <p className="text-muted-foreground">
                {selectedContact.email}
                {selectedContact.phone ? ` · ${selectedContact.phone}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedContact(null)}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Change
            </button>
            <input type="hidden" name="contactId" value={selectedContact.id} />
            <input
              type="hidden"
              name="requestorName"
              value={`${selectedContact.firstName} ${selectedContact.lastName}`.trim()}
            />
            <input type="hidden" name="requestorEmail" value={selectedContact.email} />
            <input type="hidden" name="requestorPhone" value={selectedContact.phone ?? ""} />
            <input type="hidden" name="requestorCompany" value={selectedContact.company ?? ""} />
            <input type="hidden" name="requestorType" value={selectedContact.type} />
          </div>
        ) : (
          <>
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
            <p className="text-sm text-muted-foreground">
              New clients are saved automatically — search for them by name next time.
            </p>
          </>
        )}
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
