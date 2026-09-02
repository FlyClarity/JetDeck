"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type ResultType = "quote" | "trip_request" | "contact" | "aircraft" | "crew" | "trip";

type SearchResult = {
  type: ResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const TYPE_LABELS: Record<ResultType, string> = {
  quote: "Quotes",
  trip_request: "Trip Requests",
  contact: "Contacts",
  aircraft: "Fleet",
  crew: "Crew",
  trip: "Trips",
};

// App-wide search across Quotes, Trip Requests, Contacts, Fleet, Crew, and
// Trips (see app/api/search/route.ts) — replaces the earlier tab-local
// search box on the dashboard queue, which only ever searched whatever list
// was currently on screen. Self-contained: renders both its own trigger
// button and the modal, so mounting it once in AppHeader is enough — no
// state needs to be lifted or wired in from outside.
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resets the palette's own state as part of the same event that opens
  // it, rather than in a useEffect watching `open` — setState calls
  // synchronously at the top of an effect body is a cascading-render
  // anti-pattern the project's lint config flags; here there's no actual
  // need for an effect at all since opening is already a discrete event.
  const openPalette = useCallback(() => {
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
      if (!open && e.key === "/" && !isTyping) {
        e.preventDefault();
        openPalette();
      } else if (open && e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette]);

  // Purely a DOM sync (focus), not a setState call — legitimate effect use.
  useEffect(() => {
    if (!open) return;
    // Focus after the modal actually paints, not the click/keypress that
    // opened it — an immediate focus() can lose to the browser's own
    // handling of the triggering event on some paths.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // A too-short query needs no fetch — the render below already shows
    // "Keep typing…" purely from query length, without needing `results`
    // cleared, so there's nothing to synchronously setState here either.
    if (q.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json();
        setResults(data.results ?? []);
        setActiveIndex(0);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Search failed", err);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, open]);

  const navigateTo = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[activeIndex];
      if (result) navigateTo(result.href);
    }
  }

  const grouped = results.reduce<Partial<Record<ResultType, SearchResult[]>>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});
  let flatIndex = -1;

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        title="Search (press /)"
        aria-label="Search"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Search className="size-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search quotes, requests, contacts, fleet, crew, trips…"
                className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {query.trim().length < 2 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Keep typing to search…</p>
              ) : loading ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Searching…</p>
              ) : results.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">No matches.</p>
              ) : (
                (Object.entries(grouped) as [ResultType, SearchResult[]][]).map(([type, items]) => (
                  <div key={type} className="mb-2 last:mb-0">
                    <p className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {TYPE_LABELS[type]}
                    </p>
                    {items.map((r) => {
                      flatIndex += 1;
                      const isActive = flatIndex === activeIndex;
                      return (
                        <button
                          key={`${r.type}-${r.id}`}
                          type="button"
                          onClick={() => navigateTo(r.href)}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          className={cn(
                            "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                            isActive ? "bg-muted" : "hover:bg-muted/50"
                          )}
                        >
                          <span className="font-medium">{r.title}</span>
                          {r.subtitle && <span className="text-xs text-muted-foreground">{r.subtitle}</span>}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
