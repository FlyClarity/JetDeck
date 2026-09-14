// Small presentational primitives shared by every client-facing page that
// uses the "rounded card on a muted background" look (the quote page, the
// passenger manifest page) — pulled out once two pages needed the exact
// same building blocks, rather than each page keeping its own near-copy.

import { mapsSearchUrl } from "@/lib/itinerary";
import { categoryLabel } from "@/lib/aircraft";

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

// "Bombardier Challenger 300 (N251FT) — Super-Midsize" — a client
// identifies the actual aircraft at the FBO by tail number, not make/model
// alone, so it's included for a brokered aircraft too (BrokeredAircraft.
// tailNumber is always set, unlike make/model which can be blank for a
// not-yet-fully-detailed source), not just an owned-fleet one. Category is
// appended when known — it's what actually tells a client what size/type
// of jet they're booking, since make/model alone means little to most
// people.
export function aircraftLabelFor(option: {
  aircraft: { make: string; model: string; tailNumber: string; category: string } | null;
  brokeredAircraft: {
    make: string | null;
    model: string | null;
    tailNumber: string;
    category: string | null;
  } | null;
}): string {
  if (option.aircraft) {
    return `${option.aircraft.make} ${option.aircraft.model} (${option.aircraft.tailNumber}) — ${categoryLabel(option.aircraft.category)}`;
  }
  if (option.brokeredAircraft) {
    const makeModel = `${option.brokeredAircraft.make ?? ""} ${option.brokeredAircraft.model ?? ""}`.trim();
    const base = makeModel
      ? `${makeModel} (${option.brokeredAircraft.tailNumber})`
      : option.brokeredAircraft.tailNumber;
    return option.brokeredAircraft.category ? `${base} — ${categoryLabel(option.brokeredAircraft.category)}` : base;
  }
  return "Aircraft to be confirmed";
}

// A generic side-profile jet glyph — shown when an aircraft has no photos
// uploaded yet, so the hero section below still reads as "an aircraft"
// rather than an empty gradient. Same shape Fleet's own placeholder could
// reuse later; kept local here since this is its only user today.
function AircraftGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );
}

// The single most important thing on this page for a client trying to
// actually find their plane: the tail number. Previously a small muted
// caption line buried after the itinerary — now a full-width photo (or a
// branded placeholder when none is uploaded yet) with the tail number set
// large and high-contrast directly over it, right after the header. Skips
// rendering entirely when no aircraft is selected yet (nothing to show).
export function AircraftHero({
  option,
  pax,
}: {
  option: {
    aircraft: {
      make: string;
      model: string;
      tailNumber: string;
      category: string;
      seats: number;
      yearOfManufacture: number | null;
      yearOfRefurbishment: number | null;
      photos: string[];
    } | null;
    brokeredAircraft: {
      make: string | null;
      model: string | null;
      tailNumber: string;
      category: string | null;
      seats: number | null;
      photos: string[];
    } | null;
  };
  pax: number | null;
}) {
  const media = option.aircraft ?? option.brokeredAircraft;
  if (!media) return null;

  const makeModel = option.aircraft
    ? `${option.aircraft.make} ${option.aircraft.model}`
    : `${option.brokeredAircraft?.make ?? ""} ${option.brokeredAircraft?.model ?? ""}`.trim();
  const category = option.aircraft ? option.aircraft.category : option.brokeredAircraft?.category;
  const seats = option.aircraft ? option.aircraft.seats : option.brokeredAircraft?.seats;
  const photo = media.photos[0];

  return (
    <section className="mt-8 sm:mt-11">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-foreground sm:aspect-[2/1]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={makeModel || media.tailNumber} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "radial-gradient(130% 160% at 12% 8%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 55%)," +
                "linear-gradient(160deg, var(--foreground), color-mix(in srgb, var(--foreground) 76%, #000 24%))",
            }}
          >
            <AircraftGlyph className="h-[34%] max-h-[220px] w-[34%] max-w-[220px] text-accent/90" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-5 pt-14 pb-4 sm:px-7 sm:pt-20 sm:pb-6">
          <span className="text-4xl leading-none font-extrabold tracking-wide text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.35)] sm:text-5xl">
            {media.tailNumber}
          </span>
          {category && (
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold tracking-wide text-accent-foreground uppercase">
              {categoryLabel(category)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {makeModel && <p className="font-medium">{makeModel}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {seats !== null && seats !== undefined && (
            <span>
              <strong className="font-medium text-foreground">{seats}</strong> passengers
            </span>
          )}
          {pax !== null && (
            <span>
              <strong className="font-medium text-foreground">{pax}</strong> traveling
            </span>
          )}
          {option.aircraft?.yearOfManufacture && (
            <span>
              YOM <strong className="font-medium text-foreground">{option.aircraft.yearOfManufacture}</strong>
            </span>
          )}
          {option.aircraft?.yearOfRefurbishment && (
            <span>
              Refurbished{" "}
              <strong className="font-medium text-foreground">{option.aircraft.yearOfRefurbishment}</strong>
            </span>
          )}
        </div>
      </div>
    </section>
  );
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
