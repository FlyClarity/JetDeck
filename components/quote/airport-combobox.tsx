"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchAirports, type AirportOption } from "@/lib/airport-server";
import { cn } from "@/lib/utils";

type PartialAirport = { icao: string; iata?: string | null; name?: string; lat?: number; lon?: number };

export function AirportCombobox({
  value,
  onSelect,
  placeholder,
  className,
}: {
  value: PartialAirport | null;
  onSelect: (airport: AirportOption | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState(value?.icao ?? "");
  const [results, setResults] = useState<AirportOption[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Only resync the displayed text from an externally-changed value while
  // the field isn't open/being edited. Without the `!open` guard, typing a
  // replacement value eats its own first keystroke: onChange clears the
  // parent's value in the same batch as updating query, and this sync (if
  // unguarded) would see that value change on the next render and stomp
  // the just-typed character back to empty before the user sees it.
  const [syncedIcao, setSyncedIcao] = useState(value?.icao ?? null);
  if (!open && (value?.icao ?? null) !== syncedIcao) {
    setSyncedIcao(value?.icao ?? null);
    setQuery(value?.icao ?? "");
  }

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const handle = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      const matches = await searchAirports(q);
      setResults(matches);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        placeholder={placeholder ?? "ICAO, IATA, or name"}
        className={className}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
          if (value) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-72 max-w-[24rem] rounded-md border border-border bg-popover shadow-md">
          {results.map((airport) => (
            <button
              key={airport.icao}
              type="button"
              onClick={() => {
                onSelect(airport);
                setQuery(airport.icao);
                setOpen(false);
              }}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted",
                value?.icao === airport.icao && "bg-muted"
              )}
            >
              <span className="font-medium">
                {airport.icao}
                {airport.iata ? ` / ${airport.iata}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">{airport.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
