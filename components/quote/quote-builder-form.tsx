"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import type { Aircraft } from "@/lib/generated/prisma/client";
import { calculateQuoteTotals, formatCurrency, type AdditionalFee } from "@/lib/quote";
import { greatCircleDistanceNm, estimateFlightHours, nightsBetween } from "@/lib/geo";
import type { AirportOption } from "@/lib/airport-server";
import { AirportCombobox } from "@/components/quote/airport-combobox";
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
import { cn } from "@/lib/utils";

export type QuoteLegInput = {
  dep: AirportOption | { icao: string } | null;
  arr: AirportOption | { icao: string } | null;
  date: string;
  flightHours?: number;
};

export type SavedLegInput = {
  billAs: "revenue" | "repositioning";
  dep: AirportOption | { icao: string } | null;
  arr: AirportOption | { icao: string } | null;
  date: string;
  flightHours: number;
};

export type QuoteBuilderInitialValues = {
  aircraftId: string | null;
  // For a brand-new quote: only the customer-requested legs are known, and
  // repositioning legs get derived (home base + aircraft cruise speed).
  requestedLegs: QuoteLegInput[];
  // For an existing quote: the full previously-saved leg breakdown, loaded
  // as-is instead of re-derived. Takes precedence over requestedLegs.
  legs?: SavedLegInput[];
  hourlyRate: number;
  repoRate: number;
  returnsToHomeBase: boolean;
  extraNightsAway: number;
  landingFees: number;
  handlingFees: number;
  additionalFees: AdditionalFee[];
  fetTax: boolean;
  discount: number;
  discountNote: string;
  internalNotes: string;
  validUntil: string;
};

type LegAirport = { icao: string; iata?: string | null; name?: string; lat?: number; lon?: number };

type LegRow = {
  id: string;
  billAs: "revenue" | "repositioning";
  auto: boolean;
  dep: LegAirport | null;
  arr: LegAirport | null;
  date: string;
  flightHours: string;
  dirty: boolean;
  collapsed: boolean;
};

function rowId() {
  return Math.random().toString(36).slice(2);
}

function computeLegHours(
  dep: LegAirport | null,
  arr: LegAirport | null,
  cruiseSpeedKts: number | null | undefined,
  blockTimeBufferHours: number
): number | null {
  if (!dep?.lat || !dep?.lon || !arr?.lat || !arr?.lon || !cruiseSpeedKts) return null;
  const distanceNm = greatCircleDistanceNm(dep.lat, dep.lon, arr.lat, arr.lon);
  return estimateFlightHours(distanceNm, cruiseSpeedKts, blockTimeBufferHours);
}

function needsRepositioning(a: LegAirport | null, b: LegAirport | null) {
  if (!a || !b) return true;
  return a.icao !== b.icao;
}

function buildInitialLegs(
  requestedLegs: QuoteLegInput[],
  cruiseSpeedKts: number | null | undefined,
  homeBase: LegAirport | null,
  returnsToHomeBase: boolean,
  blockTimeBufferHours: number
): LegRow[] {
  const rows: LegRow[] = [];
  const firstLeg = requestedLegs[0];
  const lastLeg = requestedLegs[requestedLegs.length - 1];

  if (homeBase && firstLeg?.dep && needsRepositioning(homeBase, firstLeg.dep)) {
    const hrs = computeLegHours(homeBase, firstLeg.dep, cruiseSpeedKts, blockTimeBufferHours);
    rows.push({
      id: rowId(),
      billAs: "repositioning",
      auto: true,
      dep: homeBase,
      arr: firstLeg.dep,
      date: firstLeg.date,
      flightHours: hrs !== null ? hrs.toFixed(1) : "",
      dirty: false,
      collapsed: true,
    });
  }

  requestedLegs.forEach((leg) => {
    const hrs =
      leg.flightHours ?? computeLegHours(leg.dep, leg.arr, cruiseSpeedKts, blockTimeBufferHours);
    rows.push({
      id: rowId(),
      billAs: "revenue",
      auto: true,
      dep: leg.dep,
      arr: leg.arr,
      date: leg.date,
      flightHours: hrs !== null && hrs !== undefined ? Number(hrs).toFixed(1) : "",
      dirty: false,
      collapsed: false,
    });
  });

  if (returnsToHomeBase && homeBase && lastLeg?.arr && needsRepositioning(lastLeg.arr, homeBase)) {
    const hrs = computeLegHours(lastLeg.arr, homeBase, cruiseSpeedKts, blockTimeBufferHours);
    rows.push({
      id: rowId(),
      billAs: "repositioning",
      auto: true,
      dep: lastLeg.arr,
      arr: homeBase,
      date: lastLeg.date,
      flightHours: hrs !== null ? hrs.toFixed(1) : "",
      dirty: false,
      collapsed: true,
    });
  }

  return rows;
}

export function QuoteBuilderForm({
  routeSummaryText,
  requestorLine,
  aircraftList,
  airportsByIcao,
  initialValues,
  priceSuggestion,
  depositPercent,
  defaultOvernightFee,
  defaultBlockTimeBufferHours,
  action,
  submitLabel,
}: {
  routeSummaryText: string;
  requestorLine: string;
  aircraftList: Aircraft[];
  airportsByIcao: Record<string, AirportOption>;
  initialValues: QuoteBuilderInitialValues;
  priceSuggestion: { suggestedPrice: number; reasoning: string } | null;
  depositPercent: number;
  defaultOvernightFee: number;
  defaultBlockTimeBufferHours: number;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
}) {
  const [aircraftId, setAircraftId] = useState(initialValues.aircraftId ?? "");
  const [hourlyRate, setHourlyRate] = useState(String(initialValues.hourlyRate || ""));
  const [repoRate, setRepoRate] = useState(String(initialValues.repoRate || ""));
  const [returnsToHomeBase, setReturnsToHomeBase] = useState(initialValues.returnsToHomeBase);
  const [extraNightsAway, setExtraNightsAway] = useState(
    String(initialValues.extraNightsAway || "")
  );
  const [landingFees, setLandingFees] = useState(String(initialValues.landingFees || ""));
  const [handlingFees, setHandlingFees] = useState(String(initialValues.handlingFees || ""));
  const [additionalFees, setAdditionalFees] = useState<AdditionalFee[]>(
    initialValues.additionalFees
  );
  const [fetTax, setFetTax] = useState(initialValues.fetTax);
  const [discount, setDiscount] = useState(String(initialValues.discount || ""));
  const [discountNote, setDiscountNote] = useState(initialValues.discountNote);

  const selectedAircraft = aircraftList.find((a) => a.id === aircraftId);
  const homeBaseAirport: LegAirport | null = selectedAircraft
    ? airportsByIcao[selectedAircraft.homeBase] ?? { icao: selectedAircraft.homeBase }
    : null;

  const [legs, setLegs] = useState<LegRow[]>(() => {
    if (initialValues.legs && initialValues.legs.length > 0) {
      const savedLegs = initialValues.legs;
      return savedLegs.map((leg, idx) => {
        const auto = leg.billAs === "repositioning" && (idx === 0 || idx === savedLegs.length - 1);
        return {
          id: rowId(),
          billAs: leg.billAs,
          auto,
          dep: leg.dep,
          arr: leg.arr,
          date: leg.date,
          flightHours: leg.flightHours ? leg.flightHours.toFixed(1) : "",
          dirty: false,
          collapsed: auto,
        };
      });
    }
    return buildInitialLegs(
      initialValues.requestedLegs,
      selectedAircraft?.cruiseSpeedKts,
      homeBaseAirport,
      returnsToHomeBase,
      defaultBlockTimeBufferHours
    );
  });

  // Re-derive flight hours for non-dirty legs (new cruise speed), and refresh
  // auto repositioning legs' airports (new home base), whenever the selected
  // aircraft changes. The outbound repositioning leg is always index 0.
  const [syncedAircraftId, setSyncedAircraftId] = useState(aircraftId);
  if (aircraftId !== syncedAircraftId) {
    setSyncedAircraftId(aircraftId);
    setLegs((prev) =>
      prev
        .map((leg, idx) => {
          let dep = leg.dep;
          let arr = leg.arr;
          if (leg.auto && leg.billAs === "repositioning") {
            const isOutbound = idx === 0;
            dep = isOutbound ? homeBaseAirport : leg.dep;
            arr = isOutbound ? leg.arr : homeBaseAirport;
          }
          if (leg.dirty) return { ...leg, dep, arr };
          const hrs = computeLegHours(
            dep,
            arr,
            selectedAircraft?.cruiseSpeedKts,
            defaultBlockTimeBufferHours
          );
          return { ...leg, dep, arr, flightHours: hrs !== null ? hrs.toFixed(1) : leg.flightHours };
        })
        // Dropping the aircraft onto a plane already based at this leg's
        // airport makes an auto repositioning leg redundant (0nm).
        .filter(
          (leg) =>
            !(leg.auto && leg.billAs === "repositioning" && !needsRepositioning(leg.dep, leg.arr))
        )
    );
  }

  function toggleReturnsToHomeBase(checked: boolean) {
    setReturnsToHomeBase(checked);
    setLegs((prev) => {
      if (checked) {
        const lastRevenue = [...prev].reverse().find((l) => l.billAs === "revenue") ?? prev[prev.length - 1];
        if (!lastRevenue?.arr || !needsRepositioning(lastRevenue.arr, homeBaseAirport)) return prev;
        const hrs = computeLegHours(
          lastRevenue.arr,
          homeBaseAirport,
          selectedAircraft?.cruiseSpeedKts,
          defaultBlockTimeBufferHours
        );
        return [
          ...prev,
          {
            id: rowId(),
            billAs: "repositioning",
            auto: true,
            dep: lastRevenue.arr,
            arr: homeBaseAirport,
            date: lastRevenue.date,
            flightHours: hrs !== null ? hrs.toFixed(1) : "",
            dirty: false,
            collapsed: true,
          },
        ];
      }
      const last = prev[prev.length - 1];
      if (last && last.auto && last.billAs === "repositioning") return prev.slice(0, -1);
      return prev;
    });
  }

  function updateLeg(id: string, patch: Partial<LegRow>) {
    setLegs((prev) =>
      prev.map((leg) => {
        if (leg.id !== id) return leg;
        const updated = { ...leg, ...patch };
        if ("dep" in patch || "arr" in patch) {
          const hrs = computeLegHours(
            updated.dep,
            updated.arr,
            selectedAircraft?.cruiseSpeedKts,
            defaultBlockTimeBufferHours
          );
          if (!updated.dirty && hrs !== null) updated.flightHours = hrs.toFixed(1);
        }
        return updated;
      })
    );
  }

  function recalcLeg(id: string) {
    setLegs((prev) =>
      prev.map((leg) => {
        if (leg.id !== id) return leg;
        const hrs = computeLegHours(
          leg.dep,
          leg.arr,
          selectedAircraft?.cruiseSpeedKts,
          defaultBlockTimeBufferHours
        );
        return { ...leg, dirty: false, flightHours: hrs !== null ? hrs.toFixed(1) : leg.flightHours };
      })
    );
  }

  function addLeg() {
    setLegs((prev) => [
      ...prev,
      {
        id: rowId(),
        billAs: "revenue",
        auto: false,
        dep: null,
        arr: null,
        date: "",
        flightHours: "",
        dirty: true,
        collapsed: false,
      },
    ]);
  }

  function toggleCollapsed(id: string) {
    setLegs((prev) =>
      prev.map((leg) => (leg.id === id ? { ...leg, collapsed: !leg.collapsed } : leg))
    );
  }

  function handleAircraftChange(id: string) {
    setAircraftId(id);
    const aircraft = aircraftList.find((a) => a.id === id);
    if (aircraft) {
      setHourlyRate(String(aircraft.hourlyRate));
      setRepoRate(String(aircraft.repoRate ?? aircraft.hourlyRate));
    }
  }

  function updateFee(index: number, patch: Partial<AdditionalFee>) {
    setAdditionalFees((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  }

  const revenueLegs = legs.filter((l) => l.billAs === "revenue");
  const repoLegs = legs.filter((l) => l.billAs === "repositioning");

  const flightHours = revenueLegs.reduce((sum, l) => sum + (Number(l.flightHours) || 0), 0);
  const repoHours = repoLegs.reduce((sum, l) => sum + (Number(l.flightHours) || 0), 0);

  const autoNightsAway = useMemo(() => {
    let nights = 0;
    for (let i = 0; i < revenueLegs.length - 1; i++) {
      nights += nightsBetween(revenueLegs[i].date, revenueLegs[i + 1].date);
    }
    return nights;
  }, [revenueLegs]);

  const totalNightsAway = returnsToHomeBase ? 0 : autoNightsAway + (Number(extraNightsAway) || 0);
  const overnightFee = totalNightsAway * defaultOvernightFee;

  const legsJson = JSON.stringify(
    legs.map((l) => ({
      billAs: l.billAs,
      depAirport: l.dep?.icao ?? null,
      arrAirport: l.arr?.icao ?? null,
      date: l.date,
      flightHours: Number(l.flightHours) || 0,
    }))
  );

  const totals = useMemo(
    () =>
      calculateQuoteTotals({
        flightHours,
        hourlyRate: Number(hourlyRate) || 0,
        repoHours,
        repoRate: Number(repoRate) || 0,
        overnightFee,
        landingFees: Number(landingFees) || 0,
        handlingFees: Number(handlingFees) || 0,
        additionalFees,
        fetTax,
        discount: Number(discount) || 0,
      }),
    [flightHours, hourlyRate, repoHours, repoRate, overnightFee, landingFees, handlingFees, additionalFees, fetTax, discount]
  );

  const discountPercentOfSubtotal =
    totals.subtotal > 0 ? ((Number(discount) || 0) / totals.subtotal) * 100 : 0;
  const needsDiscountNote = discountPercentOfSubtotal > 10;
  const depositAmount = totals.total * depositPercent;

  return (
    <form action={action} className="flex gap-8">
      <input type="hidden" name="aircraftId" value={aircraftId} />
      <input type="hidden" name="additionalFeesJson" value={JSON.stringify(additionalFees)} />
      <input type="hidden" name="fetTax" value={fetTax ? "on" : ""} />
      <input type="hidden" name="returnsToHomeBase" value={returnsToHomeBase ? "on" : ""} />
      <input type="hidden" name="overnightNights" value={totalNightsAway} />
      <input type="hidden" name="flightHours" value={flightHours} />
      <input type="hidden" name="repoHours" value={repoHours} />
      <input type="hidden" name="legsJson" value={legsJson} />

      <div className="flex flex-1 flex-col gap-6">
        <div>
          <p className="font-medium">{routeSummaryText}</p>
          <p className="text-sm text-muted-foreground">{requestorLine}</p>
        </div>

        {priceSuggestion && (
          <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
            <p className="font-medium">
              AI suggests {formatCurrency(priceSuggestion.suggestedPrice)}
            </p>
            <p className="mt-1 text-muted-foreground">{priceSuggestion.reasoning}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="aircraftId-select">Aircraft</Label>
          <Select value={aircraftId} onValueChange={handleAircraftChange}>
            <SelectTrigger id="aircraftId-select">
              <SelectValue placeholder="Select aircraft" />
            </SelectTrigger>
            <SelectContent>
              {aircraftList.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.tailNumber} — {a.make} {a.model}
                  {!a.cruiseSpeedKts && " (no cruise speed set)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="hourlyRate">Hourly rate ($)</Label>
            <Input
              id="hourlyRate"
              name="hourlyRate"
              type="number"
              min={0}
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="repoRate">Repositioning rate ($)</Label>
            <Input
              id="repoRate"
              name="repoRate"
              type="number"
              min={0}
              step="0.01"
              value={repoRate}
              onChange={(e) => setRepoRate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Legs</Label>
          {legs.map((leg, i) => {
            const isRepositioning = leg.billAs === "repositioning";

            if (isRepositioning && leg.collapsed) {
              return (
                <div
                  key={leg.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(leg.id)}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className="size-3.5" />
                    <span className="text-xs font-medium tracking-wide uppercase">Reposition</span>
                  </button>
                  <span className="text-muted-foreground">
                    {leg.dep?.icao ?? "?"} → {leg.arr?.icao ?? "?"}
                  </span>
                  <span className="text-muted-foreground">
                    {leg.flightHours ? `${leg.flightHours} hrs` : "— hrs"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(leg.id)}
                    className="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Edit
                  </button>
                </div>
              );
            }

            return (
              <div
                key={leg.id}
                className="flex flex-wrap items-end gap-3 rounded-md border border-border p-2.5"
              >
                <div className="flex h-9 items-center">
                  {isRepositioning ? (
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(leg.id)}
                      className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
                    >
                      <ChevronDown className="size-3.5" />
                      Reposition
                    </button>
                  ) : (
                    <span className="text-xs font-medium tracking-wide text-accent uppercase">
                      Leg {i + 1}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-xs">From</Label>
                  <AirportCombobox
                    value={leg.dep}
                    className="w-24"
                    onSelect={(airport) => updateLeg(leg.id, { dep: airport })}
                  />
                </div>
                <ArrowRight className="mb-2.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">To</Label>
                  <AirportCombobox
                    value={leg.arr}
                    className="w-24"
                    onSelect={(airport) => updateLeg(leg.id, { arr: airport })}
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
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Hours</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      className="w-20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      value={leg.flightHours}
                      onChange={(e) =>
                        updateLeg(leg.id, { flightHours: e.target.value, dirty: true })
                      }
                    />
                    {leg.dirty && (leg.dep as LegAirport)?.lat && (leg.arr as LegAirport)?.lat && (
                      <button
                        type="button"
                        onClick={() => recalcLeg(leg.id)}
                        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {(["revenue", "repositioning"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => updateLeg(leg.id, { billAs: option })}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                        leg.billAs === option
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option === "revenue" ? "Revenue" : "Reposition"}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setLegs((prev) => prev.filter((l) => l.id !== leg.id))}
                  className="mb-2.5 ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={addLeg}>
            Add leg
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <input
              id="returnsToHomeBaseCheckbox"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={returnsToHomeBase}
              onChange={(e) => toggleReturnsToHomeBase(e.target.checked)}
            />
            <Label htmlFor="returnsToHomeBaseCheckbox">
              Aircraft returns to home base after this trip
            </Label>
          </div>
          {!returnsToHomeBase && (
            <div className="flex flex-col gap-2 pl-6">
              {autoNightsAway > 0 && (
                <p className="text-sm text-muted-foreground">
                  {autoNightsAway} night{autoNightsAway === 1 ? "" : "s"} away calculated from leg
                  dates
                </p>
              )}
              <Label htmlFor="extraNightsAwayInput">Additional nights away</Label>
              <Input
                id="extraNightsAwayInput"
                type="number"
                min={0}
                step="1"
                className="w-32"
                value={extraNightsAway}
                onChange={(e) => setExtraNightsAway(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                {totalNightsAway} night{totalNightsAway === 1 ? "" : "s"} total ×{" "}
                {formatCurrency(defaultOvernightFee)}/night — rate set in Settings
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="landingFees">Landing fees ($)</Label>
            <Input
              id="landingFees"
              name="landingFees"
              type="number"
              min={0}
              step="0.01"
              value={landingFees}
              onChange={(e) => setLandingFees(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="handlingFees">Handling fees ($)</Label>
            <Input
              id="handlingFees"
              name="handlingFees"
              type="number"
              min={0}
              step="0.01"
              value={handlingFees}
              onChange={(e) => setHandlingFees(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Additional fees</Label>
          {additionalFees.map((fee, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Catering"
                value={fee.label}
                onChange={(e) => updateFee(i, { label: e.target.value })}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                className="w-32"
                placeholder="0.00"
                value={fee.amount || ""}
                onChange={(e) => updateFee(i, { amount: Number(e.target.value) || 0 })}
              />
              <button
                type="button"
                onClick={() => setAdditionalFees((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setAdditionalFees((prev) => [...prev, { label: "", amount: 0 }])}
          >
            Add fee
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="fetTaxCheckbox"
            type="checkbox"
            className="size-4 rounded border-input"
            checked={fetTax}
            onChange={(e) => setFetTax(e.target.checked)}
          />
          <Label htmlFor="fetTaxCheckbox">FET tax (7.5%, US domestic)</Label>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="discount">Discount ($)</Label>
          <Input
            id="discount"
            name="discount"
            type="number"
            min={0}
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
          {totals.subtotal > 0 && Number(discount) > 0 && (
            <p className="text-sm text-muted-foreground">
              {discountPercentOfSubtotal.toFixed(1)}% of subtotal
            </p>
          )}
          {needsDiscountNote && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="discountNote">Reason for discount (required, &gt;10%)</Label>
              <Input
                id="discountNote"
                name="discountNote"
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                required
              />
            </div>
          )}
          {!needsDiscountNote && (
            <input type="hidden" name="discountNote" value={discountNote} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="internalNotes">Internal notes</Label>
          <Textarea
            id="internalNotes"
            name="internalNotes"
            rows={3}
            defaultValue={initialValues.internalNotes}
            placeholder="Not visible to the client"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="validUntil">Quote valid until</Label>
          <Input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={initialValues.validUntil}
            required
          />
        </div>

        <Button type="submit" size="lg" className="self-start" disabled={!aircraftId}>
          {submitLabel}
        </Button>
      </div>

      <div className="w-72 shrink-0">
        <div className="sticky top-6 flex flex-col gap-2 rounded-md border border-border p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Flight ({flightHours.toFixed(1)} hrs)</span>
            <span>{formatCurrency(totals.flightCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Repositioning ({repoHours.toFixed(1)} hrs)</span>
            <span>{formatCurrency(totals.repoCost)}</span>
          </div>
          {overnightFee > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Overnight fee</span>
              <span>{formatCurrency(overnightFee)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fees</span>
            <span>
              {formatCurrency(
                Number(landingFees || 0) + Number(handlingFees || 0) + totals.feesTotal
              )}
            </span>
          </div>
          {Number(discount) > 0 && (
            <div className="flex justify-between text-destructive">
              <span>Discount</span>
              <span>-{formatCurrency(Number(discount))}</span>
            </div>
          )}
          {fetTax && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">FET (7.5%)</span>
              <span>{formatCurrency(totals.fetAmount)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Deposit ({Math.round(depositPercent * 100)}%)</span>
            <span>{formatCurrency(depositAmount)}</span>
          </div>
        </div>
      </div>
    </form>
  );
}
