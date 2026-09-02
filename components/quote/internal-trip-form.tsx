"use client";

import { useActionState, useState } from "react";
import { AirportCombobox } from "@/components/quote/airport-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { AirportOption } from "@/lib/airport-server";

type Leg = { id: string; dep: AirportOption | null; arr: AirportOption | null; date: string };

const PURPOSES = [
  { value: "owner", label: "Owner Flight" },
  { value: "maintenance", label: "Maintenance" },
  { value: "repositioning", label: "Repositioning" },
  { value: "other", label: "Other" },
];

function newLeg(): Leg {
  return { id: crypto.randomUUID(), dep: null, arr: null, date: "" };
}

export function InternalTripForm({
  aircraftList,
  action,
}: {
  aircraftList: { id: string; tailNumber: string; make: string; model: string }[];
  action: (prevState: { error: string } | null, formData: FormData) => Promise<{ error: string } | null>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [legs, setLegs] = useState<Leg[]>([newLeg()]);

  function updateLeg(id: string, patch: Partial<Leg>) {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLeg(id: string) {
    setLegs((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  const legsJson = JSON.stringify(
    legs.map((l) => ({
      depAirport: l.dep?.icao ?? "",
      arrAirport: l.arr?.icao ?? "",
      date: l.date,
    }))
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="legsJson" value={legsJson} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="purpose">Purpose</Label>
        <select
          id="purpose"
          name="purpose"
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PURPOSES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="aircraftId">Aircraft</Label>
        <select
          id="aircraftId"
          name="aircraftId"
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select aircraft</option>
          {aircraftList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.tailNumber} — {a.make} {a.model}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-3">
        <Label>Legs</Label>
        {legs.map((leg) => (
          <div
            key={leg.id}
            className="flex flex-wrap items-end gap-3 rounded-md border border-border p-2.5"
          >
            <div className="flex flex-col gap-1">
              <Label className="text-xs">From</Label>
              <AirportCombobox
                value={leg.dep}
                className="w-28"
                onSelect={(a) => updateLeg(leg.id, { dep: a })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">To</Label>
              <AirportCombobox
                value={leg.arr}
                className="w-28"
                onSelect={(a) => updateLeg(leg.id, { arr: a })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="w-36"
                value={leg.date}
                onChange={(e) => updateLeg(leg.id, { date: e.target.value })}
              />
            </div>
            {legs.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removeLeg(leg.id)}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setLegs((prev) => [...prev, newLeg()])}
        >
          + Add Leg
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" name="note" rows={3} placeholder="Internal note — not visible to anyone outside your team" />
      </div>

      {state?.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Creating…" : "Create Trip"}
      </Button>
    </form>
  );
}
