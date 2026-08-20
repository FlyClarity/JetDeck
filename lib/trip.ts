// The board's column order (app/(ops)/ops/board/page.tsx) — invoiced/closed/
// cancelled trips are done with this pipeline entirely, so they're not
// columns here (matches /ops/trips' existing filter).
export const TRIP_STAGES = [
  "awaiting_payment",
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
  awaiting_payment: "A",
  confirmed: "C",
  ops_review: "O",
  crew_assigned: "W", // creW — "C" already taken by Confirmed
  pre_flight: "P",
  in_flight: "I",
  completed: "D", // Done
};

export const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  awaiting_payment: "Awaiting Payment",
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
