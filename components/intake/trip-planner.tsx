"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PillToggle } from "@/components/intake/pill-toggle";

const TRIP_TYPES = [
  { value: "one_way", label: "One-Way" },
  { value: "round_trip", label: "Round Trip" },
  { value: "multi_leg", label: "Multi-Leg" },
] as const;

type MultiLeg = {
  depAirport: string;
  arrAirport: string;
  date: string;
  passengerCount: string;
};

const emptyMultiLeg: MultiLeg = {
  depAirport: "",
  arrAirport: "",
  date: "",
  passengerCount: "",
};

export function TripPlanner() {
  const [tripType, setTripType] = useState<string>("one_way");

  // Shared route + date state for one-way / round-trip
  const [depAirport, setDepAirport] = useState("");
  const [arrAirport, setArrAirport] = useState("");
  const [date, setDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [timePref, setTimePref] = useState("");
  const [passengerCount, setPassengerCount] = useState("");

  // Independent legs for multi-leg
  const [multiLegs, setMultiLegs] = useState<MultiLeg[]>([{ ...emptyMultiLeg }]);

  function updateMultiLeg(index: number, patch: Partial<MultiLeg>) {
    setMultiLegs((prev) =>
      prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg))
    );
  }

  const legsJson = useMemo(() => {
    if (tripType === "round_trip") {
      return JSON.stringify([
        {
          depAirport,
          arrAirport,
          date,
          timePref: timePref || null,
          timeFlexible: !timePref,
          passengerCount: passengerCount ? Number(passengerCount) : null,
        },
        {
          depAirport: arrAirport,
          arrAirport: depAirport,
          date: returnDate,
          timePref: null,
          timeFlexible: true,
          passengerCount: passengerCount ? Number(passengerCount) : null,
        },
      ]);
    }

    if (tripType === "multi_leg") {
      return JSON.stringify(
        multiLegs.map((leg) => ({
          depAirport: leg.depAirport,
          arrAirport: leg.arrAirport,
          date: leg.date,
          timePref: null,
          timeFlexible: true,
          passengerCount: leg.passengerCount ? Number(leg.passengerCount) : null,
        }))
      );
    }

    return JSON.stringify([
      {
        depAirport,
        arrAirport,
        date,
        timePref: timePref || null,
        timeFlexible: !timePref,
        passengerCount: passengerCount ? Number(passengerCount) : null,
      },
    ]);
  }, [tripType, depAirport, arrAirport, date, returnDate, timePref, passengerCount, multiLegs]);

  return (
    <div className="flex flex-col gap-5">
      <input type="hidden" name="tripType" value={tripType} />
      <input type="hidden" name="legsJson" value={legsJson} />

      <div className="flex flex-col gap-2">
        <Label>Trip type</Label>
        <PillToggle options={TRIP_TYPES} value={tripType} onChange={setTripType} />
      </div>

      {tripType !== "multi_leg" && (
        <>
          <div className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="depAirport">From</Label>
              <Input
                id="depAirport"
                placeholder="KTEB"
                value={depAirport}
                onChange={(e) => setDepAirport(e.target.value.toUpperCase())}
                required
              />
            </div>
            <ArrowRight className="mb-2.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="arrAirport">To</Label>
              <Input
                id="arrAirport"
                placeholder="KMIA"
                value={arrAirport}
                onChange={(e) => setArrAirport(e.target.value.toUpperCase())}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="date">
                {tripType === "round_trip" ? "Depart" : "Date"}
              </Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            {tripType === "round_trip" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="returnDate">Return</Label>
                <Input
                  id="returnDate"
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  required
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="timePref">Time</Label>
                <Input
                  id="timePref"
                  type="time"
                  value={timePref}
                  onChange={(e) => setTimePref(e.target.value)}
                  placeholder="Flexible"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="passengerCount">Passengers</Label>
              <Input
                id="passengerCount"
                type="number"
                min={1}
                value={passengerCount}
                onChange={(e) => setPassengerCount(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {tripType === "multi_leg" && (
        <div className="flex flex-col gap-3">
          {multiLegs.map((leg, index) => (
            <div key={index} className="flex items-end gap-3">
              <div className="flex flex-1 flex-col gap-2">
                {index === 0 && <Label>From</Label>}
                <Input
                  placeholder="KTEB"
                  value={leg.depAirport}
                  onChange={(e) =>
                    updateMultiLeg(index, { depAirport: e.target.value.toUpperCase() })
                  }
                  required
                />
              </div>
              <ArrowRight className="mb-2.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-1 flex-col gap-2">
                {index === 0 && <Label>To</Label>}
                <Input
                  placeholder="KMIA"
                  value={leg.arrAirport}
                  onChange={(e) =>
                    updateMultiLeg(index, { arrAirport: e.target.value.toUpperCase() })
                  }
                  required
                />
              </div>
              <div className="flex w-36 flex-col gap-2">
                {index === 0 && <Label>Date</Label>}
                <Input
                  type="date"
                  value={leg.date}
                  onChange={(e) => updateMultiLeg(index, { date: e.target.value })}
                  required
                />
              </div>
              <div className="flex w-24 flex-col gap-2">
                {index === 0 && <Label>Pax</Label>}
                <Input
                  type="number"
                  min={1}
                  value={leg.passengerCount}
                  onChange={(e) =>
                    updateMultiLeg(index, { passengerCount: e.target.value })
                  }
                />
              </div>
              {multiLegs.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setMultiLegs((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="mb-2.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMultiLegs((prev) => [...prev, { ...emptyMultiLeg }])}
            className="self-start text-sm font-medium text-primary underline underline-offset-4"
          >
            Add another leg
          </button>
        </div>
      )}
    </div>
  );
}
