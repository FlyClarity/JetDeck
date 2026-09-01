// The board's column order (app/(ops)/ops/board/page.tsx) — invoiced/closed/
// cancelled trips are done with this pipeline entirely, so they're not
// columns here (matches /ops/trips' existing filter). "awaiting_payment"
// used to be the first stage here — removed, since payment is no longer a
// pipeline stage (see isTripPaid below and Trip.status's schema comment).
//
// Six stages, specified directly by the operator: Confirmed (just sent
// from sales) -> In Review (ops works the checklist — aircraft/crew/duty-
// time compliance, passenger manifest, FBOs; crew is assigned during this
// stage, not as its own separate one) -> Ready for Release (checklist
// passed, itinerary sent, payment secured, crew acknowledged) -> Preflight
// (crew at the aircraft) -> Inflight (crew departed) -> Landed (crew
// landed, block/flight time recorded). Every transition from Ready for
// Release onward is a crew-app event in the operator's eventual vision;
// since that app doesn't exist yet, each one has an explicit ops-side
// "Mark ..." override action instead of a bare next/back arrow — see
// app/(ops)/ops/trips/[id]/page.tsx.
export const TRIP_STAGES = [
  "confirmed",
  "ops_review",
  "ready_for_release",
  "pre_flight",
  "in_flight",
  "completed",
] as const;

// One-letter stage badges for tight spaces (the Fleet Calendar's tiles).
export const STATUS_SHORT_LABELS: Record<string, string> = {
  confirmed: "C",
  ops_review: "R",
  ready_for_release: "D", // reaDy — "R" already taken by Review
  pre_flight: "P",
  in_flight: "I",
  completed: "L", // Landed
};

export const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  awaiting_payment: "Awaiting Payment", // legacy value, predates payment leaving the pipeline
  ops_review: "In Review",
  crew_assigned: "In Review", // legacy value, folded into In Review — see Trip.status's schema comment
  ready_for_release: "Ready for Release",
  ops_approved: "Ready for Release", // legacy value, renamed — see Trip.status's schema comment
  pre_flight: "Preflight",
  in_flight: "Inflight",
  completed: "Landed",
  invoiced: "Invoiced",
  closed: "Closed",
  cancelled_by_operator: "Cancelled",
  cancelled: "Cancelled", // legacy value, predates the cancelled_by_operator rename
};

// Whether the flight has actually been paid for — derived from the same
// signals the sales side already tracks (captured card hold, confirmed
// wire, confirmed ACH, or cash-on-account) rather than a separate field to
// keep in sync by hand. Gates "ready_for_release" — see
// evaluateReleaseReadiness in lib/ops-review.ts.
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
