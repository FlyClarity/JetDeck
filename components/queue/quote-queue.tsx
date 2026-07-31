"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TripRequest, Prisma } from "@/lib/generated/prisma/client";
import {
  SOURCE_BADGES,
  SCORE_BADGES,
  STATUS_LABELS,
  relativeTime,
  routeSummary,
  paxCount,
} from "@/lib/queue";
import { formatCurrency } from "@/lib/quote";
import { categoryLabel } from "@/lib/aircraft";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QuoteWithTripRequest = Prisma.QuoteGetPayload<{ include: { tripRequest: true } }>;

const VIEWS = [
  { key: "ready", label: "Ready to Quote" },
  { key: "all", label: "All Requests" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
] as const;

const STATUS_FILTERS = [
  { key: "active", label: "Active" },
  { key: "new", label: "New" },
  { key: "scoring", label: "Scoring" },
  { key: "ready", label: "Ready" },
  { key: "passed", label: "Passed" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];
type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];

const QUOTE_VIEWS: ViewKey[] = ["draft", "sent", "accepted"];

const QUOTE_ACTION_LABEL: Record<string, string> = {
  draft: "Continue draft →",
  sent: "Sent — view →",
  accepted: "Accepted — view →",
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
  const [activeView, setActiveView] = useState<ViewKey>("ready");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const readyCount = useMemo(
    () => tripRequests.filter((t) => t.status === "ready").length,
    [tripRequests]
  );

  const passedCount = useMemo(
    () => tripRequests.filter((t) => t.status === "passed").length,
    [tripRequests]
  );

  const draftCount = useMemo(() => quotes.filter((q) => q.status === "draft").length, [quotes]);

  const isQuoteView = QUOTE_VIEWS.includes(activeView);

  const quoteList = useMemo(
    () => quotes.filter((q) => q.status === activeView),
    [quotes, activeView]
  );

  const currentList = useMemo(() => {
    if (isQuoteView) return [];
    if (activeView === "ready") return tripRequests.filter((t) => t.status === "ready");
    // "Active" hides passed/declined by default — the brief's own tab groups
    // Passed with Declined/Expired, and in practice most requests end up here,
    // so surfacing it by default would bury everything actionable under it.
    if (statusFilter === "active") return tripRequests.filter((t) => t.status !== "passed");
    return tripRequests.filter((t) => t.status === statusFilter);
  }, [isQuoteView, activeView, statusFilter, tripRequests]);

  const selectedTripRequest = !isQuoteView
    ? (currentList.find((t) => t.id === selectedId) ?? null)
    : null;
  const selectedQuote = isQuoteView ? (quoteList.find((q) => q.id === selectedId) ?? null) : null;

  // Both list types share one selection model and one set of j/k/Enter/Esc
  // shortcuts — only "p" (pass) is trip-request-specific.
  const activeList: { id: string }[] = isQuoteView ? quoteList : currentList;

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
        passAction(selectedId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeList, selectedId, isQuoteView, passAction, router]);

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
                  : "";
                return (
                  <button
                    key={q.id}
                    tabIndex={-1}
                    onClick={() => setSelectedId(q.id)}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 border-b border-border px-4 py-3 text-left transition-colors",
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
                        : "Route unknown"}
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
                  tabIndex={-1}
                  onClick={() => setSelectedId(tr.id)}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 border-b border-border px-4 py-3 text-left transition-colors",
                    selectedId === tr.id ? "bg-muted" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span title={source.label}>{source.emoji}</span>
                      {score && (
                        <span title={score.label}>
                          {score.emoji} {score.label}
                        </span>
                      )}
                      {tr.requestorName}
                      {tr.requestorCompany && (
                        <span className="font-normal text-muted-foreground">
                          · {tr.requestorCompany}
                        </span>
                      )}
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
                  {tr.scoreReason && (
                    <p className="text-xs text-muted-foreground">{tr.scoreReason}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {routeSummary(tr.legs, tr.tripType)}
                    {pax !== null && ` · ${pax} pax`}
                    {tr.aircraftPref && ` · ${categoryLabel(tr.aircraftPref)}`}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {selectedTripRequest && (
        <div className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto p-6">
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
                onClick={() => passAction(selectedTripRequest.id)}
              >
                Pass (P)
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedQuote && (
        <div className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selectedQuote.quoteNumber}</h2>
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Esc
            </button>
          </div>

          {selectedQuote.tripRequest && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">
                {selectedQuote.tripRequest.requestorName}
                {selectedQuote.tripRequest.requestorCompany &&
                  ` · ${selectedQuote.tripRequest.requestorCompany}`}
              </p>
              <p className="text-muted-foreground">{selectedQuote.tripRequest.requestorEmail}</p>
            </div>
          )}

          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">
              {selectedQuote.tripRequest
                ? routeSummary(selectedQuote.tripRequest.legs, selectedQuote.tripRequest.tripType)
                : "Route unknown"}
            </p>
            <p className="mt-1 text-muted-foreground">{formatCurrency(selectedQuote.total)}</p>
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
