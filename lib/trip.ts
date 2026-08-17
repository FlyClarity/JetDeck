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
