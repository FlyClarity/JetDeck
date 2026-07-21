"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Leg = {
  depAirport: string;
  arrAirport: string;
  date: string;
  timePref: string;
  timeFlexible: boolean;
  passengerCount: string;
};

const emptyLeg: Leg = {
  depAirport: "",
  arrAirport: "",
  date: "",
  timePref: "",
  timeFlexible: false,
  passengerCount: "",
};

export function LegsField() {
  const [legs, setLegs] = useState<Leg[]>([{ ...emptyLeg }]);

  function updateLeg(index: number, patch: Partial<Leg>) {
    setLegs((prev) =>
      prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg))
    );
  }

  function addLeg() {
    setLegs((prev) => [...prev, { ...emptyLeg }]);
  }

  function removeLeg(index: number) {
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="legsJson" value={JSON.stringify(legs)} />

      {legs.map((leg, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-md border border-border p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Leg {index + 1}</span>
            {legs.length > 1 && (
              <button
                type="button"
                onClick={() => removeLeg(index)}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>Departure airport</Label>
              <Input
                placeholder="KTEB"
                value={leg.depAirport}
                onChange={(e) =>
                  updateLeg(index, { depAirport: e.target.value.toUpperCase() })
                }
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Arrival airport</Label>
              <Input
                placeholder="KMIA"
                value={leg.arrAirport}
                onChange={(e) =>
                  updateLeg(index, { arrAirport: e.target.value.toUpperCase() })
                }
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={leg.date}
                onChange={(e) => updateLeg(index, { date: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Passengers</Label>
              <Input
                type="number"
                min={1}
                value={leg.passengerCount}
                onChange={(e) =>
                  updateLeg(index, { passengerCount: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="flex flex-col gap-2">
              <Label>Preferred time</Label>
              <Input
                type="time"
                value={leg.timePref}
                onChange={(e) => updateLeg(index, { timePref: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                id={`flexible-${index}`}
                className="size-4 rounded border-input"
                checked={leg.timeFlexible}
                onChange={(e) =>
                  updateLeg(index, { timeFlexible: e.target.checked })
                }
              />
              <Label htmlFor={`flexible-${index}`}>Time is flexible</Label>
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={addLeg} className="self-start">
        Add another leg
      </Button>
    </div>
  );
}
