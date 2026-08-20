// The board's column order (app/(ops)/ops/board/page.tsx) — invoiced/closed/
// cancelled trips are done with this pipeline entirely, so they're not
// columns here (matches /ops/trips' existing filter). "awaiting_payment"
// used to be the first stage here — removed, since payment is no longer a
// pipeline stage (see isTripPaid below and Trip.status's schema comment).
export const TRIP_STAGES = [
  "confirmed",
  "ops_review",
  "crew_assigned",
  "pre_flight",
  "in_flight",
  "completed",
] as const;

// One-letter stage badges for tight spaces (the Fleet Calendar's tiles).
// Explicitly provisional — the user is still actively reworking the trip
// lifecycle's stage names/definitions, so this is deliberately a single,
// easy-to-edit map rather than baked into every place that shows a stage,
// so it's a one-line change per stage once that taxonomy settles.
export const STATUS_SHORT_LABELS: Record<string, string> = {
  confirmed: "C",
  ops_review: "O",
  crew_assigned: "W", // creW — "C" already taken by Confirmed
  pre_flight: "P",
  in_flight: "I",
  completed: "D", // Done
};

export const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  awaiting_payment: "Awaiting Payment", // legacy value, predates payment leaving the pipeline
  ops_review: "Ops Review",
  crew_assigned: "Crew Assigned",
  pre_flight: "Pre-Flight",
  in_flight: "In Flight",
  completed: "Completed",
  invoiced: "Invoiced",
  closed: "Closed",
  cancelled_by_operator: "Cancelled",
  cancelled: "Cancelled", // legacy value, predates the cancelled_by_operator rename
};

// Whether the flight has actually been paid for — derived from the same
// signals the sales side already tracks (captured card hold, confirmed
// wire, confirmed ACH, or cash-on-account) rather than a separate field to
// keep in sync by hand. Not enforced as a gate anywhere yet: the user's
// intent is that a future "released" action should require this, but
// "release" itself doesn't exist as a real stage/action yet — documented
// here so the requirement isn't lost before that gets built.
export function isTripPaid(quote: {
  paymentMethod: string | null;
  cardHoldStatus: string | null;
  wireConfirmedAt: Date | null;
  achConfirmedAt: Date | null;
  contact?: { paymentTerms: string | null } | null;
}): boolean {
  if (quote.contact?.paymentTerms === "cash_on_account") return true;
  if (quote.paymentMethod === "credit_card") return quote.cardHoldStatus === "captured";
  if (quote.paymentMethod === "wire") return !!quote.wireConfirmedAt;
  if (quote.paymentMethod === "ach") return !!quote.achConfirmedAt;
  return false;
}
