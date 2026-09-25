"use client";

import { useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { SavedPassengerResult } from "@/lib/manifest";

// Sits next to "+ Add Passenger" on the ops trip page — type-ahead search
// over every saved passenger for this operator (not just this trip's own
// client), so a returning traveler doesn't need to be retyped from
// scratch. `onSearch`/`onSelect` are server actions passed in as props
// (already bound to this trip/operator server-side) rather than this
// component knowing anything about trip scoping itself.
export function PassengerPicker({
  onSearch,
  onSelect,
}: {
  onSearch: (query: string) => Promise<SavedPassengerResult[]>;
  onSelect: (savedPassengerId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SavedPassengerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchToken = useRef(0);

  function handleChange(value: string) {
    setQuery(value);
    setOpen(true);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const token = ++searchToken.current;
    startTransition(async () => {
      const found = await onSearch(trimmed);
      // A slower earlier search finishing after a newer one would
      // otherwise clobber it with stale results.
      if (token === searchToken.current) setResults(found);
    });
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search saved passengers…"
        className="h-8 w-56 text-sm"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-72 rounded-md border border-border bg-background py-1 shadow-md">
          {isPending ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
          ) : (
            results.map((r) => (
              <Button
                key={r.id}
                type="button"
                variant="ghost"
                className="flex h-auto w-full flex-col items-start gap-0.5 rounded-none px-3 py-2 text-left font-normal"
                onMouseDown={(e) => {
                  // Fires before the input's onBlur closes the dropdown —
                  // a plain onClick would lose the click to that blur.
                  e.preventDefault();
                  setOpen(false);
                  setQuery("");
                  startTransition(() => onSelect(r.id));
                }}
              >
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">
                  {r.dateOfBirth ? new Date(r.dateOfBirth).toLocaleDateString() : "DOB —"}
                  {r.clientLabel ? ` · ${r.clientLabel}` : ""}
                </span>
              </Button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
