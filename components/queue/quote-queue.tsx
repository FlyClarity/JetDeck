"use client";

import { useEffect, useMemo, useState } from "react";
import type { TripRequest } from "@/lib/generated/prisma/client";
import { SOURCE_BADGES, SCORE_BADGES, relativeTime, routeSummary, paxCount } from "@/lib/queue";
import { categoryLabel } from "@/lib/aircraft";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REAL_TABS = [
  { key: "new", label: "New" },
  { key: "scoring", label: "Scoring" },
  { key: "ready", label: "Ready to Quote" },
  { key: "passed", label: "Declined / Expired / Passed" },
] as const;

const QUOTE_TABS = [
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
] as const;

type RealTabKey = (typeof REAL_TABS)[number]["key"];
type TabKey = RealTabKey | (typeof QUOTE_TABS)[number]["key"];

export function QuoteQueue({
  tripRequests,
  passAction,
}: {
  tripRequests: TripRequest[];
  passAction: (id: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("new");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const grouped = useMemo(
    () => ({
      new: tripRequests.filter((t) => t.status === "new"),
      scoring: tripRequests.filter((t) => t.status === "scoring"),
      ready: tripRequests.filter((t) => t.status === "ready"),
      passed: tripRequests.filter((t) => t.status === "passed"),
    }),
    [tripRequests]
  );

  const isQuoteTab = activeTab === "draft" || activeTab === "sent" || activeTab === "accepted";
  const currentList = useMemo(
    () => (isQuoteTab ? [] : grouped[activeTab as RealTabKey]),
    [isQuoteTab, grouped, activeTab]
  );
  const selected = currentList.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isQuoteTab || currentList.length === 0) return;
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
  }, [currentList, selectedId, isQuoteTab, passAction]);

  return (
    <div className="flex flex-1">
      <div className="flex flex-1 flex-col border-r border-border">
        <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2">
          {[...REAL_TABS, ...QUOTE_TABS].map((tab) => {
            const count = tab.key in grouped ? grouped[tab.key as RealTabKey].length : 0;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSelectedId(null);
                }}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                {count > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isQuoteTab ? (
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
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(tr.createdAt)}
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
