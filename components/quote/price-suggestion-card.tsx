"use client";

import { use } from "react";
import { formatCurrency } from "@/lib/quote";

export type PriceSuggestion = { suggestedPrice: number } | null;

// The AI call this renders takes a couple of seconds — it's passed down as
// an unawaited promise and streamed in via Suspense so the rest of the page
// (aircraft list, form fields) renders immediately instead of blocking on it.
export function PriceSuggestionCard({ promise }: { promise: Promise<PriceSuggestion> }) {
  const priceSuggestion = use(promise);
  if (!priceSuggestion) return null;

  return (
    <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
      <p className="font-medium">AI suggests {formatCurrency(priceSuggestion.suggestedPrice)}</p>
    </div>
  );
}

export function PriceSuggestionSkeleton() {
  return (
    <div className="h-[38px] animate-pulse rounded-md border border-border bg-muted/40" />
  );
}
