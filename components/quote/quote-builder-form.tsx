"use client";

import { Suspense, useMemo, useState } from "react";
import { ArrowRight, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from "lucide-react";
import type { Aircraft } from "@/lib/generated/prisma/client";
import { calculateQuoteTotals, formatCurrency, type AdditionalFee } from "@/lib/quote";
import { greatCircleDistanceNm, estimateFlightHours, nightsBetween } from "@/lib/geo";
import { addHoursAcrossTimezones, type TimeWithDayOffset } from "@/lib/time";
import {
  findConflictingBooking,
  routeAndDateText,
  formatIsoDate,
  type ConflictCandidate,
} from "@/lib/itinerary";
import type { AirportOption } from "@/lib/airport-server";
import { AirportCombobox } from "@/components/quote/airport-combobox";
import {
  PriceSuggestionCard,
  PriceSuggestionSkeleton,
  type PriceSuggestion,
} from "@/components/quote/price-suggestion-card";
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
  depTime?: string | null;
  depTimeTBD?: boolean;
  arrTime?: string | null;
};

export type SavedLegInput = {
  billAs: "revenue" | "repositioning";
  dep: AirportOption | { icao: string } | null;
  arr: AirportOption | { icao: string } | null;
  date: string;
  flightHours: number;
  depTime?: string | null;
  depTimeTBD?: boolean;
  arrTime?: string | null;
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
  clientNotes: string;
  validUntil: string;
};

type LegAirport = {
  icao: string;
  iata?: string | null;
  name?: string;
  lat?: number;
  lon?: number;
  timezone?: string | null;
};

type LegRow = {
  id: string;
  billAs: "revenue" | "repositioning";
  auto: boolean;
  // Which side of an auto repositioning leg is home base — lets the
  // aircraft-change resync effect update the right endpoint no matter how
  // many repositioning legs exist or where they sit (leading, trailing, or
  // one of potentially several "between legs" pairs). Null for revenue
  // legs and any repositioning leg the user added by hand.
  homeSide: "dep" | "arr" | null;
  // Only true for repositioning legs inserted by the "returns to base
  // between legs" toggle — distinguishes them from the permanent leading/
  // trailing repositioning legs (and anything added by hand) so switching
  // the toggle back off removes exactly the right ones.
  betweenLegs: boolean;
  dep: LegAirport | null;
  arr: LegAirport | null;
  date: string;
  flightHours: string;
  dirty: boolean;
  collapsed: boolean;
  depTime: string;
  depTimeTBD: boolean;
  arrTime: string;
  // false = arrTime is auto-derived from depTime + flightHours; true = the
  // user typed an arrival time directly, so stop overwriting it.
  arrTimeDirty: boolean;
  // 0 unless auto-derived from a firm departure time — a manually-typed
  // arrival time (or one reloaded from a saved quote) has no reliable date
  // to compare against, since the field only ever stores a time of day.
  arrDayOffset: number;
};

// Best-effort arrival time: only fills in when we actually have a firm
// departure time and a flight-hours estimate to add to it. Converts across
// timezones when both airports' zones are known (see addHoursAcrossTimezones)
// instead of just adding hours on the departure airport's clock.
function computeArrTime(
  date: string,
  depTime: string,
  depTimeTBD: boolean,
  flightHours: string,
  dep: LegAirport | null,
  arr: LegAirport | null
): TimeWithDayOffset {
  if (depTimeTBD || !depTime) return { time: "", dayOffset: 0 };
  const hrs = Number(flightHours);
  if (!Number.isFinite(hrs) || hrs <= 0) return { time: "", dayOffset: 0 };
  return addHoursAcrossTimezones(date, depTime, hrs, dep?.timezone ?? null, arr?.timezone ?? null);
}

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

function makeRepoLeg(
  dep: LegAirport | null,
  arr: LegAirport | null,
  date: string,
  homeSide: "dep" | "arr",
  betweenLegs: boolean,
  cruiseSpeedKts: number | null | undefined,
  blockTimeBufferHours: number
): LegRow {
  const hrs = computeLegHours(dep, arr, cruiseSpeedKts, blockTimeBufferHours);
  return {
    id: rowId(),
    billAs: "repositioning",
    auto: true,
    homeSide,
    betweenLegs,
    dep,
    arr,
    date,
    flightHours: hrs !== null ? hrs.toFixed(1) : "",
    dirty: false,
    collapsed: true,
    depTime: "",
    depTimeTBD: true,
    arrTime: "",
    arrTimeDirty: false,
    arrDayOffset: 0,
  };
}

// The aircraft always ends the trip back at home base — that repositioning
// leg is unconditional, same as the leading one. Whether it also comes home
// *between* legs (instead of sitting overnight) is a separate, later choice
// (see toggleReturnsToHomeBase) that a brand-new quote never starts with.
function buildInitialLegs(
  requestedLegs: QuoteLegInput[],
  cruiseSpeedKts: number | null | undefined,
  homeBase: LegAirport | null,
  blockTimeBufferHours: number
): LegRow[] {
  const rows: LegRow[] = [];
  const firstLeg = requestedLegs[0];
  const lastLeg = requestedLegs[requestedLegs.length - 1];

  if (homeBase && firstLeg?.dep && needsRepositioning(homeBase, firstLeg.dep)) {
    rows.push(
      makeRepoLeg(homeBase, firstLeg.dep, firstLeg.date, "dep", false, cruiseSpeedKts, blockTimeBufferHours)
    );
  }

  requestedLegs.forEach((leg) => {
    const hrs =
      leg.flightHours ?? computeLegHours(leg.dep, leg.arr, cruiseSpeedKts, blockTimeBufferHours);
    const flightHours = hrs !== null && hrs !== undefined ? Number(hrs).toFixed(1) : "";
    const depTime = leg.depTime ?? "";
    const depTimeTBD = leg.depTimeTBD ?? !leg.depTime;
    const computedArr = computeArrTime(leg.date, depTime, depTimeTBD, flightHours, leg.dep, leg.arr);
    const arrTimeDirty = Boolean(leg.arrTime);
    rows.push({
      id: rowId(),
      billAs: "revenue",
      auto: true,
      homeSide: null,
      betweenLegs: false,
      dep: leg.dep,
      arr: leg.arr,
      date: leg.date,
      flightHours,
      dirty: false,
      collapsed: false,
      depTime,
      depTimeTBD,
      arrTime: leg.arrTime || computedArr.time,
      arrTimeDirty,
      arrDayOffset: arrTimeDirty ? 0 : computedArr.dayOffset,
    });
  });

  if (homeBase && lastLeg?.arr && needsRepositioning(lastLeg.arr, homeBase)) {
    rows.push(
      makeRepoLeg(lastLeg.arr, homeBase, lastLeg.date, "arr", false, cruiseSpeedKts, blockTimeBufferHours)
    );
  }

  return rows;
}

export function QuoteBuilderForm({
  routeSummaryText,
  requestorLine,
  aircraftList,
  airportsByIcao,
  existingBookings,
  initialValues,
  priceSuggestionPromise,
  depositPercent,
  defaultOvernightFee,
  defaultBlockTimeBufferHours,
  isAccepted,
  action,
  submitLabel,
}: {
  routeSummaryText: string;
  requestorLine: string;
  aircraftList: Aircraft[];
  airportsByIcao: Record<string, AirportOption>;
  // Other operator bookings already accepted or awaiting confirmation — fed
  // into a live, purely client-side overlap check (see
  // findConflictingBooking) so a double-booking surfaces the moment the
  // operator picks the aircraft/dates, not just when the client accepts.
  existingBookings: ConflictCandidate[];
  initialValues: QuoteBuilderInitialValues;
  priceSuggestionPromise: Promise<PriceSuggestion>;
  depositPercent: number;
  defaultOvernightFee: number;
  defaultBlockTimeBufferHours: number;
  isAccepted?: boolean;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
}) {
  const [unlocked, setUnlocked] = useState(!isAccepted);
  const locked = Boolean(isAccepted) && !unlocked;
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
        // Reload only ever recognizes the leading/trailing repositioning
        // legs as auto-managed — any repositioning leg the "between legs"
        // toggle inserted at save time reloads as a plain manual leg
        // instead (betweenLegs: false), so toggling it back off here won't
        // auto-remove those specific legs. Rare in practice (a
        // freshly-built quote is the common path); acceptable gap for now.
        const homeSide: "dep" | "arr" | null = auto ? (idx === 0 ? "dep" : "arr") : null;
        return {
          id: rowId(),
          billAs: leg.billAs,
          auto,
          homeSide,
          betweenLegs: false,
          dep: leg.dep,
          arr: leg.arr,
          date: leg.date,
          flightHours: leg.flightHours ? leg.flightHours.toFixed(1) : "",
          dirty: false,
          collapsed: auto,
          depTime: leg.depTime ?? "",
          depTimeTBD: leg.depTimeTBD ?? !leg.depTime,
          arrTime: leg.arrTime ?? "",
          // Reloaded from a saved time-of-day string with no date attached
          // to compare against — no way to know if it crossed a day.
          arrTimeDirty: Boolean(leg.arrTime),
          arrDayOffset: 0,
        };
      });
    }
    return buildInitialLegs(
      initialValues.requestedLegs,
      selectedAircraft?.cruiseSpeedKts,
      homeBaseAirport,
      defaultBlockTimeBufferHours
    );
  });

  // Re-derive flight hours for non-dirty legs (new cruise speed), and refresh
  // auto repositioning legs' airports (new home base), whenever the selected
  // aircraft changes. homeSide says which endpoint is home for a given
  // repositioning leg, since there can now be several of them (leading,
  // trailing, and any "between legs" pairs) rather than just one at index 0.
  const [syncedAircraftId, setSyncedAircraftId] = useState(aircraftId);
  if (aircraftId !== syncedAircraftId) {
    setSyncedAircraftId(aircraftId);
    setLegs((prev) =>
      prev
        .map((leg) => {
          let dep = leg.dep;
          let arr = leg.arr;
          if (leg.auto && leg.billAs === "repositioning" && leg.homeSide) {
            dep = leg.homeSide === "dep" ? homeBaseAirport : leg.dep;
            arr = leg.homeSide === "arr" ? homeBaseAirport : leg.arr;
          }
          if (leg.dirty) return { ...leg, dep, arr };
          const hrs = computeLegHours(
            dep,
            arr,
            selectedAircraft?.cruiseSpeedKts,
            defaultBlockTimeBufferHours
          );
          const flightHours = hrs !== null ? hrs.toFixed(1) : leg.flightHours;
          if (leg.arrTimeDirty) return { ...leg, dep, arr, flightHours };
          const computedArr = computeArrTime(leg.date, leg.depTime, leg.depTimeTBD, flightHours, dep, arr);
          return {
            ...leg,
            dep,
            arr,
            flightHours,
            arrTime: computedArr.time,
            arrDayOffset: computedArr.dayOffset,
          };
        })
        // Dropping the aircraft onto a plane already based at this leg's
        // airport makes an auto repositioning leg redundant (0nm).
        .filter(
          (leg) =>
            !(leg.auto && leg.billAs === "repositioning" && !needsRepositioning(leg.dep, leg.arr))
        )
    );
  }

  // Checked: instead of letting the aircraft sit overnight between legs, it
  // comes home after each one and repositions back out for the next —
  // bracket every internal gap between consecutive revenue legs with a
  // repositioning-home and repositioning-back-out pair. The permanent
  // leading/trailing legs (already unconditional — see buildInitialLegs)
  // are untouched either way. Unchecked: drop exactly the legs this
  // inserted (betweenLegs: true), leaving everything else as-is.
  function toggleReturnsToHomeBase(checked: boolean) {
    setReturnsToHomeBase(checked);
    setLegs((prev) => {
      if (!checked) {
        return prev.filter((l) => !l.betweenLegs);
      }

      const revenueRows = prev.filter((l) => l.billAs === "revenue");
      const result: LegRow[] = [];
      prev.forEach((leg) => {
        result.push(leg);
        if (leg.billAs !== "revenue") return;
        const revenueIdx = revenueRows.indexOf(leg);
        const nextLeg = revenueRows[revenueIdx + 1];
        if (!nextLeg) return; // last revenue leg — trailing leg already handles getting home

        if (leg.arr && needsRepositioning(leg.arr, homeBaseAirport)) {
          result.push(
            makeRepoLeg(
              leg.arr,
              homeBaseAirport,
              leg.date,
              "arr",
              true,
              selectedAircraft?.cruiseSpeedKts,
              defaultBlockTimeBufferHours
            )
          );
        }
        if (nextLeg.dep && needsRepositioning(homeBaseAirport, nextLeg.dep)) {
          result.push(
            makeRepoLeg(
              homeBaseAirport,
              nextLeg.dep,
              nextLeg.date,
              "dep",
              true,
              selectedAircraft?.cruiseSpeedKts,
              defaultBlockTimeBufferHours
            )
          );
        }
      });
      return result;
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
        if ("arrTime" in patch) {
          updated.arrTimeDirty = true;
          updated.arrDayOffset = 0;
        } else if (!updated.arrTimeDirty) {
          const computedArr = computeArrTime(
            updated.date,
            updated.depTime,
            updated.depTimeTBD,
            updated.flightHours,
            updated.dep,
            updated.arr
          );
          updated.arrTime = computedArr.time;
          updated.arrDayOffset = computedArr.dayOffset;
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
        const flightHours = hrs !== null ? hrs.toFixed(1) : leg.flightHours;
        if (leg.arrTimeDirty) return { ...leg, dirty: false, flightHours };
        const computedArr = computeArrTime(leg.date, leg.depTime, leg.depTimeTBD, flightHours, leg.dep, leg.arr);
        return {
          ...leg,
          dirty: false,
          flightHours,
          arrTime: computedArr.time,
          arrDayOffset: computedArr.dayOffset,
        };
      })
    );
  }

  function resetArrTime(id: string) {
    setLegs((prev) =>
      prev.map((leg) => {
        if (leg.id !== id) return leg;
        const computedArr = computeArrTime(
          leg.date,
          leg.depTime,
          leg.depTimeTBD,
          leg.flightHours,
          leg.dep,
          leg.arr
        );
        return {
          ...leg,
          arrTimeDirty: false,
          arrTime: computedArr.time,
          arrDayOffset: computedArr.dayOffset,
        };
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
        homeSide: null,
        betweenLegs: false,
        dep: null,
        arr: null,
        date: "",
        flightHours: "",
        dirty: true,
        collapsed: false,
        depTime: "",
        depTimeTBD: true,
        arrTime: "",
        arrTimeDirty: false,
        arrDayOffset: 0,
      },
    ]);
  }

  function toggleCollapsed(id: string) {
    setLegs((prev) =>
      prev.map((leg) => (leg.id === id ? { ...leg, collapsed: !leg.collapsed } : leg))
    );
  }

  // Plain array-position swap — doesn't try to re-derive which endpoint of
  // an auto repositioning leg is "home" (homeSide) or which gap a
  // between-legs pair brackets (betweenLegs) after the move, since those
  // are only ever read again by the aircraft-change resync effect and the
  // "returns to base" toggle, not by rendering itself. Reordering an auto
  // leg away from its original leading/trailing/bracketing position is an
  // edge case an operator doing this at all is already choosing to
  // override by hand.
  function moveLeg(id: string, direction: -1 | 1) {
    setLegs((prev) => {
      const index = prev.findIndex((l) => l.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function legMoveButtons(id: string, index: number) {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => moveLeg(id, -1)}
          disabled={index === 0}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move leg up"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => moveLeg(id, 1)}
          disabled={index === legs.length - 1}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move leg down"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </div>
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

  // Sum of gaps in date order, not array order — a leg added or edited out
  // of chronological sequence (e.g. via "Add leg", or reordering) would
  // otherwise silently compute a 0-or-negative gap for that pair instead of
  // the real one, since nightsBetween clamps negative spans to 0.
  const autoNightsAway = useMemo(() => {
    const dates = revenueLegs.map((l) => l.date).filter(Boolean).sort();
    let nights = 0;
    for (let i = 0; i < dates.length - 1; i++) {
      nights += nightsBetween(dates[i], dates[i + 1]);
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
      depTime: l.depTimeTBD ? null : l.depTime || null,
      depTimeTBD: l.depTimeTBD,
      arrTime: l.arrTime || null,
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

  const conflict = useMemo(() => {
    const itineraryForCheck = legs.map((l) => ({
      billAs: l.billAs,
      depAirport: l.dep?.icao ?? null,
      arrAirport: l.arr?.icao ?? null,
      date: l.date,
    }));
    return findConflictingBooking(aircraftId, itineraryForCheck, existingBookings);
  }, [aircraftId, legs, existingBookings]);

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
        {isAccepted && (
          <div className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            {locked ? (
              <>
                <p className="font-medium">
                  The client has already taken action on this quote (requested to book, been
                  approved, or accepted).
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "The client has already taken action on this quote. Are you sure you want to change the pricing?"
                      )
                    ) {
                      setUnlocked(true);
                    }
                  }}
                  className="mt-1 text-sm underline underline-offset-4 hover:text-foreground"
                >
                  Unlock to edit pricing
                </button>
              </>
            ) : (
              <p className="font-medium">
                Pricing unlocked — the client has already taken action on this quote, so
                double-check any changes before saving.
              </p>
            )}
          </div>
        )}

        <fieldset disabled={locked} className="contents">
        <div>
          <p className="font-medium">{routeSummaryText}</p>
          <p className="text-sm text-muted-foreground">{requestorLine}</p>
        </div>

        <Suspense fallback={<PriceSuggestionSkeleton />}>
          <PriceSuggestionCard promise={priceSuggestionPromise} />
        </Suspense>

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

        {conflict && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">⚠️ Possible double-booking</p>
            <p className="mt-1">
              This aircraft is already away{" "}
              {conflict.startDate === conflict.endDate
                ? formatIsoDate(conflict.startDate)
                : `${formatIsoDate(conflict.startDate)} – ${formatIsoDate(conflict.endDate)}`}{" "}
              via{" "}
              <a
                href={`/quotes/${conflict.booking.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                {conflict.booking.quoteNumber}
              </a>{" "}
              ({routeAndDateText(conflict.booking.itinerary).route}). Pick a different aircraft, or
              adjust this trip&apos;s dates to avoid the overlap.
            </p>
          </div>
        )}

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
                  {legMoveButtons(leg.id, i)}
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
                    {leg.depTimeTBD ? "TBD" : leg.depTime || "TBD"}
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
                <div className="flex h-9 items-center gap-2">
                  {legMoveButtons(leg.id, i)}
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
                  <Label className="text-xs">Departs</Label>
                  {leg.depTimeTBD ? (
                    <div className="flex h-9 w-24 items-center text-sm text-muted-foreground">TBD</div>
                  ) : (
                    <Input
                      type="time"
                      className="w-24"
                      value={leg.depTime}
                      onChange={(e) => updateLeg(leg.id, { depTime: e.target.value })}
                    />
                  )}
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-3.5 rounded border-input"
                      checked={leg.depTimeTBD}
                      onChange={(e) =>
                        updateLeg(leg.id, { depTimeTBD: e.target.checked, depTime: "" })
                      }
                    />
                    TBD
                  </label>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">
                    Arrives
                    {leg.arrDayOffset !== 0 && (
                      <span
                        className="ml-1 text-accent"
                        title={
                          leg.arrDayOffset > 0
                            ? `Lands ${leg.arrDayOffset === 1 ? "the next" : `${leg.arrDayOffset} days`} calendar day${leg.arrDayOffset === 1 ? "" : "s"} later`
                            : "Lands a calendar day earlier"
                        }
                      >
                        {leg.arrDayOffset > 0 ? `+${leg.arrDayOffset}d` : `${leg.arrDayOffset}d`}
                      </span>
                    )}
                  </Label>
                  <Input
                    type="time"
                    className="w-24"
                    value={leg.arrTime}
                    onChange={(e) => updateLeg(leg.id, { arrTime: e.target.value })}
                  />
                  {leg.arrTimeDirty && !leg.depTimeTBD && leg.depTime && (
                    <button
                      type="button"
                      onClick={() => resetArrTime(leg.id)}
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Reset
                    </button>
                  )}
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
              Aircraft returns to base between each leg (no overnight stays)
            </Label>
          </div>
          {returnsToHomeBase ? (
            <p className="pl-6 text-sm text-muted-foreground">
              Repositioning legs added between each leg instead of overnight fees — the aircraft
              comes home and goes back out for every one.
            </p>
          ) : (
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
          <Label htmlFor="clientNotes">Notes for client</Label>
          <Textarea
            id="clientNotes"
            name="clientNotes"
            rows={3}
            defaultValue={initialValues.clientNotes}
            placeholder="Shown on the client's quote page — e.g. catering, ground transport, special instructions"
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
        </fieldset>
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
