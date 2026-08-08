"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { TripRequest, Prisma } from "@/lib/generated/prisma/client";
import {
  SOURCE_BADGES,
  SCORE_BADGES,
  STATUS_LABELS,
  relativeTime,
  routeSummary,
  paxCount,
} from "@/lib/queue";
import { formatCurrency, TRIP_PURPOSE_LABELS } from "@/lib/quote";
import { categoryLabel } from "@/lib/aircraft";
import { revenueLegsOf } from "@/lib/itinerary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RawLeg = { depAirport?: string | null; arrAirport?: string | null; date?: string | null };

function formatLegDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Full leg-by-leg routing for the detail pane — the list rows still use
// routeSummary()'s collapsed "first → last +N more" for scannability, but
// the pane has room to show every segment.
function FullRouting({ legs }: { legs: RawLeg[] }) {
  if (legs.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {legs.map((leg, i) => (
        <div key={i} className="flex items-center justify-between text-sm">
          <span>
            {leg.depAirport ?? "?"} → {leg.arrAirport ?? "?"}
          </span>
          <span className="text-muted-foreground">{formatLegDate(leg.date)}</span>
        </div>
      ))}
    </div>
  );
}

type QuoteWithTripRequest = Prisma.QuoteGetPayload<{ include: { tripRequest: true } }>;

const VIEWS = [
  { key: "ready", label: "Ready to Quote" },
  { key: "all", label: "All Requests" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "pending_confirmation", label: "Needs Confirmation" },
  { key: "accepted", label: "Accepted" },
  { key: "inactive", label: "Inactive" },
] as const;

// "new" and "scoring" aren't included as filters — scoring runs
// synchronously right after a trip request is created, so a request is
// essentially never observed sitting in either state; filtering by them
// only ever turns up empty. "Ready" is covered by its own top-level tab.
const STATUS_FILTERS = [
  { key: "active", label: "Active" },
  { key: "passed", label: "Passed" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];
type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];

const QUOTE_VIEWS: ViewKey[] = ["draft", "sent", "pending_confirmation", "accepted", "inactive"];

const QUOTE_ACTION_LABEL: Record<string, string> = {
  draft: "Continue draft →",
  sent: "Sent — view →",
  pending_confirmation: "Needs your confirmation →",
  accepted: "Accepted — view →",
  declined: "Declined — view →",
  cancelled: "Cancelled — view →",
};

const INACTIVE_QUOTE_STATUSES = ["declined", "cancelled"];

const TRIP_TYPE_LABELS: Record<string, string> = {
  one_way: "One-way",
  round_trip: "Round-trip",
  multi_leg: "Multi-leg",
};

export function QuoteQueue({
  tripRequests,
  quotes,
  passAction,
  deleteDraftAction,
  declineQuoteAction,
}: {
  tripRequests: TripRequest[];
  quotes: QuoteWithTripRequest[];
  passAction: (id: string) => Promise<void>;
  deleteDraftAction: (id: string) => Promise<void>;
  declineQuoteAction: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Landing here from "Create Trip Request" in Needs Review (?open=<id>) —
  // jump straight to that trip's detail pane instead of leaving the operator
  // to find it in the list themselves. Computed as lazy initial state
  // (rather than an effect) since tripRequests and the URL are both already
  // available on mount, and this route remounts fresh on each navigation
  // here from a different page.
  const openTrip = useMemo(() => {
    const openId = searchParams.get("open");
    return openId ? (tripRequests.find((t) => t.id === openId) ?? null) : null;
  }, [searchParams, tripRequests]);

  const [activeView, setActiveView] = useState<ViewKey>(() =>
    openTrip?.status === "passed" ? "all" : "ready"
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>(() =>
    openTrip?.status === "passed" ? "passed" : "active"
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => openTrip?.id ?? null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Keyboard nav (j/k) only ever moved the selection state — the list
  // itself never scrolled to follow it, so moving past the visible rows
  // left the highlighted row (and the native focus outline, previously
  // stuck wherever a mouse last clicked) out of view or visually
  // disconnected from the actual selection.
  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Poll for fresh data instead of requiring a manual reload — new inbound
  // trip requests should show up without the operator remembering to hit
  // refresh. router.refresh() re-fetches this page's server data in place;
  // it doesn't reset component state (selected item, active tab, etc.).
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(interval);
  }, [router]);

  const readyCount = useMemo(
    () => tripRequests.filter((t) => t.status === "ready").length,
    [tripRequests]
  );

  const passedCount = useMemo(
    () => tripRequests.filter((t) => t.status === "passed").length,
    [tripRequests]
  );

  const draftCount = useMemo(() => quotes.filter((q) => q.status === "draft").length, [quotes]);

  const pendingConfirmationCount = useMemo(
    () => quotes.filter((q) => q.status === "pending_confirmation").length,
    [quotes]
  );

  const isQuoteView = QUOTE_VIEWS.includes(activeView);

  const quoteList = useMemo(
    () =>
      activeView === "inactive"
        ? quotes.filter((q) => INACTIVE_QUOTE_STATUSES.includes(q.status))
        : quotes.filter((q) => q.status === activeView),
    [quotes, activeView]
  );

  const currentList = useMemo(() => {
    if (isQuoteView) return [];
    if (activeView === "ready") return tripRequests.filter((t) => t.status === "ready");
    // "Active" hides passed requests, and also hides quoted ones — once a
    // trip request has a quote, it's tracked via the Draft/Sent/Accepted
    // tabs instead, so leaving it in "All Requests" too just double-lists
    // the same lead in two places.
    if (statusFilter === "active") {
      return tripRequests.filter((t) => t.status !== "passed" && t.status !== "quoted");
    }
    return tripRequests.filter((t) => t.status === statusFilter);
  }, [isQuoteView, activeView, statusFilter, tripRequests]);

  const selectedTripRequest = !isQuoteView
    ? (currentList.find((t) => t.id === selectedId) ?? null)
    : null;
  const selectedQuote = isQuoteView ? (quoteList.find((q) => q.id === selectedId) ?? null) : null;

  // Both list types share one selection model and one set of j/k/Enter/Esc
  // shortcuts — only "p" (pass) is trip-request-specific.
  const activeList: { id: string }[] = isQuoteView ? quoteList : currentList;

  // Passing removes the item from view once the list refreshes — advance to
  // whatever's next (or previous, if it was the last) right away instead of
  // dropping the operator back to an empty detail pane.
  const handlePass = useCallback(
    (id: string) => {
      const idx = currentList.findIndex((item) => item.id === id);
      const next = currentList[idx + 1] ?? currentList[idx - 1] ?? null;
      setSelectedId(next ? next.id : null);
      passAction(id);
    },
    [currentList, passAction]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "q") {
        e.preventDefault();
        router.push(
          selectedId && !isQuoteView ? `/quotes/new?tripRequestId=${selectedId}` : "/quotes/new"
        );
        return;
      }

      if (activeList.length === 0) return;

      const currentIndex = activeList.findIndex((item) => item.id === selectedId);

      if (e.key === "j") {
        e.preventDefault();
        const next = activeList[Math.min(currentIndex + 1, activeList.length - 1)];
        setSelectedId((next ?? activeList[0]).id);
      } else if (e.key === "k") {
        e.preventDefault();
        const prev = activeList[Math.max(currentIndex - 1, 0)];
        setSelectedId((prev ?? activeList[0]).id);
      } else if (e.key === "Enter" && !selectedId) {
        setSelectedId(activeList[0].id);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key === "p" && selectedId && !isQuoteView) {
        handlePass(selectedId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeList, selectedId, isQuoteView, router, handlePass]);

  return (
    <div className="flex flex-1">
      <div className="flex flex-1 flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="flex gap-1 overflow-x-auto">
            {VIEWS.map((view) => (
              <button
                key={view.key}
                onClick={() => {
                  setActiveView(view.key);
                  setSelectedId(null);
                }}
                onFocus={() => {
                  setActiveView(view.key);
                  setSelectedId(null);
                }}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeView === view.key
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {view.label}
                {view.key === "ready" && readyCount > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{readyCount}</span>
                )}
                {view.key === "draft" && draftCount > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{draftCount}</span>
                )}
                {view.key === "pending_confirmation" && pendingConfirmationCount > 0 && (
                  <span className="ml-1.5 text-xs font-medium text-destructive">
                    {pendingConfirmationCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {activeView === "all" && (
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    onFocus={() => setStatusFilter(f.key)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      statusFilter === f.key
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f.label}
                    {f.key === "passed" && passedCount > 0 && (
                      <span className="ml-1 text-muted-foreground">{passedCount}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href="/quotes/internal/new">+ Log Internal Flight</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/quotes/new">+ New Quote</Link>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isQuoteView ? (
            quoteList.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>
            ) : (
              quoteList.map((q) => {
                const requestorLine = q.tripRequest
                  ? [q.tripRequest.requestorName, q.tripRequest.requestorCompany]
                      .filter(Boolean)
                      .join(" · ")
                  : q.tripPurpose
                    ? TRIP_PURPOSE_LABELS[q.tripPurpose] ?? "Internal"
                    : "";
                return (
                  <button
                    key={q.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(q.id, el);
                      else rowRefs.current.delete(q.id);
                    }}
                    tabIndex={-1}
                    onClick={() => setSelectedId(q.id)}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 border-b border-border px-4 py-3 text-left transition-colors focus:outline-none",
                      selectedId === q.id ? "bg-muted" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {q.quoteNumber}
                        {requestorLine && (
                          <span className="font-normal text-muted-foreground"> · {requestorLine}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(q.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {q.tripRequest
                        ? routeSummary(q.tripRequest.legs, q.tripRequest.tripType)
                        : routeSummary(revenueLegsOf(q.itinerary), "multi_leg")}
                      {" · "}
                      {formatCurrency(q.total)}
                    </p>
                    <span className="text-xs font-medium text-accent">
                      {QUOTE_ACTION_LABEL[q.status] ?? "View →"}
                    </span>
                  </button>
                );
              })
            )
          ) : currentList.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            currentList.map((tr) => {
              const source = SOURCE_BADGES[tr.source] ?? SOURCE_BADGES.manual;
              const score = tr.opportunityScore ? SCORE_BADGES[tr.opportunityScore] : null;
              const pax = paxCount(tr.legs);

              return (
                <button
                  key={tr.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(tr.id, el);
                    else rowRefs.current.delete(tr.id);
                  }}
                  tabIndex={-1}
                  onClick={() => setSelectedId(tr.id)}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 border-b border-border px-4 py-3 text-left transition-colors focus:outline-none",
                    selectedId === tr.id ? "bg-muted" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span title={source.label}>{source.emoji}</span>
                      {score && (
                        <span title={score.label}>
                          {score.emoji} {score.label}
                        </span>
                      )}
                      <span>
                        {tr.requestorName}
                        {tr.requestorCompany && ` · ${tr.requestorCompany}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {activeView === "all" && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {STATUS_LABELS[tr.status] ?? tr.status}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(tr.createdAt)}
                      </span>
                    </span>
                  </div>
                  <p className="text-base font-medium text-foreground">
                    {routeSummary(tr.legs, tr.tripType)}
                    {TRIP_TYPE_LABELS[tr.tripType] && ` · ${TRIP_TYPE_LABELS[tr.tripType]}`}
                    {pax !== null && ` · ${pax} pax`}
                    {tr.aircraftPref && ` · ${categoryLabel(tr.aircraftPref)}`}
                  </p>
                  {tr.scoreReason && (
                    <p className="text-xs text-muted-foreground">{tr.scoreReason}</p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {selectedTripRequest && (
        <div className="sticky top-4 flex max-h-[calc(100vh-2rem)] w-96 shrink-0 flex-col gap-4 self-start overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selectedTripRequest.requestorName}</h2>
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Esc
            </button>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <p className="text-muted-foreground">{selectedTripRequest.requestorEmail}</p>
            {selectedTripRequest.requestorPhone && (
              <p className="text-muted-foreground">{selectedTripRequest.requestorPhone}</p>
            )}
            {selectedTripRequest.requestorCompany && <p>{selectedTripRequest.requestorCompany}</p>}
            <p className="text-muted-foreground capitalize">{selectedTripRequest.requestorType}</p>
          </div>

          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">
              {routeSummary(selectedTripRequest.legs, selectedTripRequest.tripType)}
            </p>
            <FullRouting legs={(selectedTripRequest.legs as RawLeg[]) ?? []} />
            {selectedTripRequest.specialRequests && (
              <p className="mt-2 text-muted-foreground">{selectedTripRequest.specialRequests}</p>
            )}
          </div>

          {selectedTripRequest.opportunityScore && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">
                {SCORE_BADGES[selectedTripRequest.opportunityScore]?.emoji}{" "}
                {SCORE_BADGES[selectedTripRequest.opportunityScore]?.label}
              </p>
              {selectedTripRequest.scoreReason && (
                <p className="mt-1">{selectedTripRequest.scoreReason}</p>
              )}
              {selectedTripRequest.positioningNote && (
                <p className="mt-1 text-muted-foreground">{selectedTripRequest.positioningNote}</p>
              )}
              {selectedTripRequest.historyNote && (
                <p className="mt-1 text-muted-foreground">{selectedTripRequest.historyNote}</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" size="sm" className="self-start" asChild>
              <Link href={`/quotes/new?tripRequestId=${selectedTripRequest.id}`}>
                Quote Now (Q)
              </Link>
            </Button>
            {selectedTripRequest.status !== "passed" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => handlePass(selectedTripRequest.id)}
              >
                Pass (P)
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedQuote && (
        <div className="sticky top-4 flex max-h-[calc(100vh-2rem)] w-96 shrink-0 flex-col gap-4 self-start overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selectedQuote.quoteNumber}</h2>
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Esc
            </button>
          </div>

          {selectedQuote.tripRequest ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">
                {selectedQuote.tripRequest.requestorName}
                {selectedQuote.tripRequest.requestorCompany &&
                  ` · ${selectedQuote.tripRequest.requestorCompany}`}
              </p>
              <p className="text-muted-foreground">{selectedQuote.tripRequest.requestorEmail}</p>
            </div>
          ) : (
            selectedQuote.tripPurpose && (
              <p className="text-sm font-medium">
                {TRIP_PURPOSE_LABELS[selectedQuote.tripPurpose] ?? "Internal"}
              </p>
            )
          )}

          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">
              {selectedQuote.tripRequest
                ? routeSummary(selectedQuote.tripRequest.legs, selectedQuote.tripRequest.tripType)
                : routeSummary(revenueLegsOf(selectedQuote.itinerary), "multi_leg")}
            </p>
            <FullRouting legs={revenueLegsOf(selectedQuote.itinerary)} />
            <p className="mt-2 text-muted-foreground">{formatCurrency(selectedQuote.total)}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="self-start" asChild>
              <Link href={`/quotes/${selectedQuote.id}`}>
                {selectedQuote.status === "draft" ? "Continue Draft" : "View Quote"}
              </Link>
            </Button>
            {selectedQuote.status === "draft" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  deleteDraftAction(selectedQuote.id);
                  setSelectedId(null);
                }}
              >
                Delete Draft
              </Button>
            )}
            {selectedQuote.status === "sent" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  declineQuoteAction(selectedQuote.id);
                  setSelectedId(null);
                }}
              >
                Mark Declined
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
