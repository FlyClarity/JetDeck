// Small presentational primitives shared by every client-facing page that
// uses the "rounded card on a muted background" look (the quote page, the
// passenger manifest page) — pulled out once two pages needed the exact
// same building blocks, rather than each page keeping its own near-copy.

import { mapsSearchUrl } from "@/lib/itinerary";

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold tracking-wide text-foreground/55 uppercase">
      {children}
    </h2>
  );
}

export function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "muted" | "destructive";
}) {
  return (
    <div className="flex justify-between">
      <span className={emphasis === "muted" ? "text-muted-foreground" : ""}>{label}</span>
      <span className={emphasis === "destructive" ? "font-medium text-destructive" : ""}>{value}</span>
    </div>
  );
}

// "Bombardier Challenger 300 (N251FT)" — a client identifies the actual
// aircraft at the FBO by tail number, not make/model alone, so it's
// included for a brokered aircraft too (BrokeredAircraft.tailNumber is
// always set, unlike make/model which can be blank for a not-yet-fully-
// detailed source), not just an owned-fleet one.
export function aircraftLabelFor(option: {
  aircraft: { make: string; model: string; tailNumber: string } | null;
  brokeredAircraft: { make: string | null; model: string | null; tailNumber: string } | null;
}): string {
  if (option.aircraft) {
    return `${option.aircraft.make} ${option.aircraft.model} (${option.aircraft.tailNumber})`;
  }
  if (option.brokeredAircraft) {
    const makeModel = `${option.brokeredAircraft.make ?? ""} ${option.brokeredAircraft.model ?? ""}`.trim();
    return makeModel
      ? `${makeModel} (${option.brokeredAircraft.tailNumber})`
      : option.brokeredAircraft.tailNumber;
  }
  return "Aircraft to be confirmed";
}

type LegEndpoint = {
  timeLabel: string;
  airportName: string;
  location?: string;
  fboName?: string | null;
  fboAddress?: string | null;
};

// One leg of a client-facing itinerary — a header bar (route, date,
// distance/flight-time/time-zone-change) over a two-column Departs/Arrives
// block, each side stacking local time, the airport's full name and
// city/state, and FBO name + clickable maps address when ops has set one.
// Modeled on a sample itinerary the operator shared from another platform:
// same information, laid out so it doesn't have to compete for space on a
// single crowded line the way an earlier version of this page did.
export function LegItineraryCard({
  legNumber,
  route,
  dateLabel,
  metaLabel,
  dep,
  arr,
}: {
  legNumber: number;
  route: string;
  dateLabel: string;
  metaLabel?: string | null;
  dep: LegEndpoint;
  arr: LegEndpoint;
}) {
  const renderFbo = (name?: string | null, address?: string | null) => {
    if (!name && !address) return null;
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {name}
        {name && address && <br />}
        {address && (
          <a href={mapsSearchUrl(address)} className="underline underline-offset-4">
            {address}
          </a>
        )}
      </p>
    );
  };

  const endpoint = (label: string, e: LegEndpoint, className?: string) => (
    <div className={className}>
      <p className="text-[11px] font-semibold tracking-wide text-accent uppercase">{label}</p>
      <p className="mt-1 font-medium">{e.timeLabel}</p>
      <p className="text-muted-foreground">{e.airportName}</p>
      {e.location && <p className="text-xs text-muted-foreground">{e.location}</p>}
      {renderFbo(e.fboName, e.fboAddress)}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 bg-muted/60 px-4 py-2.5">
        <span className="text-sm font-semibold">
          Leg {legNumber}: {route}
        </span>
        <span className="text-xs text-muted-foreground">{dateLabel}</span>
      </div>
      {metaLabel && (
        <div className="border-b border-border/70 px-4 py-1.5 text-xs text-muted-foreground">{metaLabel}</div>
      )}
      <div className="grid gap-4 p-4 text-sm sm:grid-cols-2">
        {endpoint("Departs", dep)}
        {endpoint("Arrives", arr, "sm:border-l sm:border-border/70 sm:pl-4")}
      </div>
    </div>
  );
}
