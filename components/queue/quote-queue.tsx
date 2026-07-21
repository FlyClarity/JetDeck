"use client";

import { useEffect, useMemo, useState } from "react";
import type { TripRequest } from "@/lib/generated/prisma/client";
import {
  SOURCE_BADGES,
  SCORE_BADGES,
  STATUS_LABELS,
  relativeTime,
  routeSummary,
  paxCount,
} from "@/lib/queue";
import { categoryLabel } from "@/lib/aircraft";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

const PLACEHOLDER_VIEWS: ViewKey[] = ["draft", "sent", "accepted"];

export function QuoteQueue({
  tripRequests,
  passAction,
}: {
  tripRequests: TripRequest[];
  passAction: (id: string) => Promise<void>;
}) {
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

  const isPlaceholderView = PLACEHOLDER_VIEWS.includes(activeView);

  const currentList = useMemo(() => {
    if (isPlaceholderView) return [];
    if (activeView === "ready") return tripRequests.filter((t) => t.status === "ready");
    // "Active" hides passed/declined by default — the brief's own tab groups
    // Passed with Declined/Expired, and in practice most requests end up here,
    // so surfacing it by default would bury everything actionable under it.
    if (statusFilter === "active") return tripRequests.filter((t) => t.status !== "passed");
    return tripRequests.filter((t) => t.status === statusFilter);
  }, [isPlaceholderView, activeView, statusFilter, tripRequests]);

  const selected = currentList.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isPlaceholderView || currentList.length === 0) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      const currentIndex = currentList.findIndex((t) => t.id === selectedId);

      if (e.key === "j") {
        e.preventDefault();
        const next = currentList[Math.min(currentIndex + 1, currentList.length - 1)];
        setSelectedId((next ?? currentList[0]).id);
      } else if (e.key === "k") {
        e.preventDefault();
        const prev = currentList[Math.max(currentIndex - 1, 0)];
        setSelectedId((prev ?? currentList[0]).id);
      } else if (e.key === "Enter" && !selectedId) {
        setSelectedId(currentList[0].id);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key === "p" && selectedId) {
        passAction(selectedId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentList, selectedId, isPlaceholderView, passAction]);

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
              </button>
            ))}
          </div>

          {activeView === "all" && (
            <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
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
        </div>

        <div className="flex-1 overflow-y-auto">
          {isPlaceholderView ? (
            <p className="p-6 text-sm text-muted-foreground">
              No quotes yet — the quote builder lands in a later step.
            </p>
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

      {selected && (
        <div className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selected.requestorName}</h2>
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Esc
            </button>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <p className="text-muted-foreground">{selected.requestorEmail}</p>
            {selected.requestorPhone && (
              <p className="text-muted-foreground">{selected.requestorPhone}</p>
            )}
            {selected.requestorCompany && <p>{selected.requestorCompany}</p>}
            <p className="text-muted-foreground capitalize">{selected.requestorType}</p>
          </div>

          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{routeSummary(selected.legs, selected.tripType)}</p>
            {selected.specialRequests && (
              <p className="mt-2 text-muted-foreground">{selected.specialRequests}</p>
            )}
          </div>

          {selected.opportunityScore && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">
                {SCORE_BADGES[selected.opportunityScore]?.emoji}{" "}
                {SCORE_BADGES[selected.opportunityScore]?.label}
              </p>
              {selected.scoreReason && <p className="mt-1">{selected.scoreReason}</p>}
              {selected.positioningNote && (
                <p className="mt-1 text-muted-foreground">{selected.positioningNote}</p>
              )}
              {selected.historyNote && (
                <p className="mt-1 text-muted-foreground">{selected.historyNote}</p>
              )}
            </div>
          )}

          {selected.status !== "passed" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => passAction(selected.id)}
            >
              Pass (P)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
