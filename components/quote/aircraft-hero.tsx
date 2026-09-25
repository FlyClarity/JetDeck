"use client";

// The single most important thing on this page for a client trying to
// actually find their plane: the tail number. A full-width photo (or a
// branded placeholder when none is uploaded yet) with the tail number set
// large and high-contrast directly over it, right after the header — a
// carousel when there's more than one photo, since a client deciding on a
// charter wants to actually look at the aircraft, not just confirm it
// exists. Client component (not the rest of client-page-ui.tsx) purely
// because the carousel needs click/swipe state; everything else on this
// page stays a server component.

import { useState } from "react";
import { categoryLabel } from "@/lib/aircraft";

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

function ChevronIcon({ direction, className }: { direction: "left" | "right"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

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
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  if (!media) return null;

  const makeModel = option.aircraft
    ? `${option.aircraft.make} ${option.aircraft.model}`
    : `${option.brokeredAircraft?.make ?? ""} ${option.brokeredAircraft?.model ?? ""}`.trim();
  const category = option.aircraft ? option.aircraft.category : option.brokeredAircraft?.category;
  const seats = option.aircraft ? option.aircraft.seats : option.brokeredAircraft?.seats;
  const photos = media.photos;
  const hasMultiple = photos.length > 1;
  const photo = photos[index] ?? photos[0];

  const go = (delta: number) => {
    setIndex((i) => (i + delta + photos.length) % photos.length);
  };

  return (
    <section className="mt-8 sm:mt-11">
      <div
        className="relative aspect-[16/9] w-full touch-pan-y overflow-hidden rounded-2xl bg-foreground select-none sm:aspect-[2/1]"
        onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStartX === null) return;
          const delta = e.changedTouches[0].clientX - touchStartX;
          if (Math.abs(delta) > 40) go(delta > 0 ? -1 : 1);
          setTouchStartX(null);
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={`${makeModel || media.tailNumber}${hasMultiple ? ` — photo ${index + 1} of ${photos.length}` : ""}`}
            className="h-full w-full object-cover"
            draggable={false}
          />
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

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute top-1/2 left-2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55 sm:left-3 sm:h-9 sm:w-9"
            >
              <ChevronIcon direction="left" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute top-1/2 right-2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55 sm:right-3 sm:h-9 sm:w-9"
            >
              <ChevronIcon direction="right" className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Kept small and tight to the bottom edge on mobile — this sits on
            top of the photo the client actually wants to look at, so it
            shouldn't compete with it for space the way a larger, taller
            overlay would on a short mobile hero. pointer-events-none since
            it has nothing clickable in it — without it, this being later
            in the DOM than the arrow buttons let it silently swallow their
            clicks whenever the two boxes overlapped (e.g. the badge
            wrapping under the tail number on a narrower photo). */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pt-8 pb-2.5 sm:px-7 sm:pt-20 sm:pb-6">
          <span className="text-2xl leading-none font-extrabold tracking-wide text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.35)] sm:text-5xl">
            {media.tailNumber}
          </span>
          {category && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wide text-accent-foreground uppercase sm:px-2.5 sm:py-1 sm:text-xs">
              {categoryLabel(category)}
            </span>
          )}
        </div>
      </div>

      {hasMultiple && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {photos.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              className={
                i === index
                  ? "h-1.5 w-4 rounded-full bg-foreground/70 transition-all"
                  : "h-1.5 w-1.5 rounded-full bg-foreground/25 transition-all hover:bg-foreground/40"
              }
            />
          ))}
        </div>
      )}

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
