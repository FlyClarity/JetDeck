// FAR 135.263 (general) + 135.267 (unscheduled 1- and 2-pilot crews) —
// the sections that actually apply to on-demand charter. 135.265
// (scheduled service), 135.269 (3/4-pilot crews), and 135.271 (HEMES)
// don't apply to this operation; 135.273 (flight attendants) doesn't
// either — the operator treats cabin crew as no different than a
// passenger for compliance purposes (see PILOT_ROLES in lib/crew.ts).
//
// Deliberately scoped to what a single trip's Ops Review can actually
// verify: the 24-hour flight-time cap, the 14-hour duty period limit, and
// >=10 hours of rest immediately before/after, all checked against this
// operator's own JetDeck-tracked trips. The quarterly/annual flight-hour
// caps (500/qtr, 800/2 qtrs, 1,400/yr) and the "13 rest periods of >=24
// hours per quarter" rule need a full rolling history — including any
// commercial flying outside JetDeck, which this system can't see — so
// those are deferred to a future crew compliance dashboard rather than
// gating a single trip here (see BACKLOG.md).

import { departureInstantUtc } from "@/lib/time";
import { revenueLegsOf } from "@/lib/itinerary";

// Report 90 minutes before the first scheduled departure, released 60
// minutes after the last scheduled arrival — exact numbers given by the
// operator, not a guess.
const REPORT_BUFFER_MIN = 90;
const RELEASE_BUFFER_MIN = 60;
const MAX_DUTY_PERIOD_HOURS = 14;
const MIN_REST_HOURS = 10;

// How long a gap between one leg's arrival and the next leg's departure
// has to be before it counts as a break between two separate duty
// periods, rather than just ground time within the same one (a normal
// turn, a same-day layover). FAR doesn't define this threshold — whether
// a real rest period was given is an operational fact, not something
// derivable purely from a schedule — so this is a deliberate heuristic:
// comfortably longer than any ordinary connection, comfortably shorter
// than the 10-hour minimum rest requirement itself (a gap that size or
// larger is unambiguously a break either way).
const SAME_DUTY_PERIOD_GAP_HOURS = 6;

export type DutyPeriod = {
  start: Date;
  end: Date;
  flightHours: number;
};

// A trip's revenue legs split into one duty period per cluster of legs
// close together in time — a same-day multi-stop trip (or a late-night-
// to-early-morning connection) is one duty period; a round trip with
// days between the outbound and return legs is two. The earlier version
// of this folded every leg in the itinerary into a single min-departure-
// to-max-arrival span regardless of how far apart they were, which
// turned a week-apart round trip into one supposed multi-day duty
// period — obviously wrong, since the crew is off duty (and presumably
// resting/home) in between, not continuously on the clock.
//
// Arrival is derived from departure + flight time rather than the leg's
// own arrTime/arrival timezone — StoredLeg doesn't persist which calendar
// day an overnight arrival lands on, so recomputing from flight duration
// (which is already timezone-independent) is more reliable than trusting
// a stored arrTime string with no day-offset attached.
export function computeDutyPeriods(
  itinerary: unknown,
  timezoneByIcao: Record<string, string | null | undefined>
): DutyPeriod[] {
  const legs = revenueLegsOf(itinerary);
  if (legs.length === 0) return [];

  const spans: { dep: Date; arr: Date; flightHours: number }[] = [];
  for (const leg of legs) {
    if (!leg.date || leg.depTimeTBD || !leg.depTime) return [];
    const depTz = leg.depAirport ? timezoneByIcao[leg.depAirport] : null;
    const dep = departureInstantUtc(leg.date, leg.depTime, depTz);
    if (!dep) return [];

    const flightHours = leg.flightHours ?? 0;
    spans.push({ dep, arr: new Date(dep.getTime() + flightHours * 3600000), flightHours });
  }
  spans.sort((a, b) => a.dep.getTime() - b.dep.getTime());

  const periods: DutyPeriod[] = [];
  let clusterStart = spans[0].dep;
  let clusterEnd = spans[0].arr;
  let clusterFlightHours = spans[0].flightHours;

  const closeCluster = () => {
    periods.push({
      start: new Date(clusterStart.getTime() - REPORT_BUFFER_MIN * 60000),
      end: new Date(clusterEnd.getTime() + RELEASE_BUFFER_MIN * 60000),
      flightHours: clusterFlightHours,
    });
  };

  for (let i = 1; i < spans.length; i++) {
    const gapHours = (spans[i].dep.getTime() - clusterEnd.getTime()) / 3600000;
    if (gapHours >= SAME_DUTY_PERIOD_GAP_HOURS) {
      closeCluster();
      clusterStart = spans[i].dep;
      clusterEnd = spans[i].arr;
      clusterFlightHours = spans[i].flightHours;
    } else {
      if (spans[i].arr > clusterEnd) clusterEnd = spans[i].arr;
      clusterFlightHours += spans[i].flightHours;
    }
  }
  closeCluster();

  return periods;
}

export type DutyComplianceIssue =
  | { code: "duty_period_too_long"; hours: number }
  | { code: "flight_time_exceeded"; hours: number; cap: number }
  | { code: "overlapping_duty"; otherTripId: string }
  | { code: "insufficient_rest_before"; hours: number; otherTripId: string }
  | { code: "insufficient_rest_after"; hours: number; otherTripId: string };

// otherDutyPeriods is every OTHER trip this same crew member is assigned
// to (any status that isn't cancelled) — the caller fetches and computes
// these, since this function stays pure/DB-free like the rest of this
// module.
export function checkDutyCompliance(
  dutyPeriod: DutyPeriod,
  pilotCount: 1 | 2,
  otherDutyPeriods: { tripId: string; start: Date; end: Date }[]
): DutyComplianceIssue[] {
  const issues: DutyComplianceIssue[] = [];

  const durationHours = (dutyPeriod.end.getTime() - dutyPeriod.start.getTime()) / 3600000;
  if (durationHours > MAX_DUTY_PERIOD_HOURS) {
    issues.push({ code: "duty_period_too_long", hours: durationHours });
  }

  const cap = pilotCount >= 2 ? 10 : 8;
  if (dutyPeriod.flightHours > cap) {
    issues.push({ code: "flight_time_exceeded", hours: dutyPeriod.flightHours, cap });
  }

  // Only the nearest duty period on each side matters for a rest check —
  // if the closest one clears the minimum, anything further away does too.
  let nearestBefore: { tripId: string; end: Date } | null = null;
  let nearestAfter: { tripId: string; start: Date } | null = null;

  for (const other of otherDutyPeriods) {
    const overlaps = other.start < dutyPeriod.end && dutyPeriod.start < other.end;
    if (overlaps) {
      issues.push({ code: "overlapping_duty", otherTripId: other.tripId });
      continue;
    }
    if (other.end <= dutyPeriod.start) {
      if (!nearestBefore || other.end > nearestBefore.end) nearestBefore = other;
    } else if (other.start >= dutyPeriod.end) {
      if (!nearestAfter || other.start < nearestAfter.start) nearestAfter = other;
    }
  }

  if (nearestBefore) {
    const restHours = (dutyPeriod.start.getTime() - nearestBefore.end.getTime()) / 3600000;
    if (restHours < MIN_REST_HOURS) {
      issues.push({ code: "insufficient_rest_before", hours: restHours, otherTripId: nearestBefore.tripId });
    }
  }
  if (nearestAfter) {
    const restHours = (nearestAfter.start.getTime() - dutyPeriod.end.getTime()) / 3600000;
    if (restHours < MIN_REST_HOURS) {
      issues.push({ code: "insufficient_rest_after", hours: restHours, otherTripId: nearestAfter.tripId });
    }
  }

  return issues;
}

export function dutyComplianceIssueLabel(issue: DutyComplianceIssue): string {
  switch (issue.code) {
    case "duty_period_too_long":
      return `Duty period is ${issue.hours.toFixed(1)} hours — exceeds the 14-hour limit (§135.267(c)).`;
    case "flight_time_exceeded":
      return `${issue.hours.toFixed(1)} flight hours exceeds the ${issue.cap}-hour limit for this crew size (§135.267(b)).`;
    case "overlapping_duty":
      return "Duty period overlaps another trip this crew member is assigned to.";
    case "insufficient_rest_before":
      return `Only ${issue.hours.toFixed(1)} hours of rest before this trip — needs at least 10 (§135.267(d)).`;
    case "insufficient_rest_after":
      return `Only ${issue.hours.toFixed(1)} hours of rest after this trip before the next one — needs at least 10 (§135.267(d)).`;
  }
}
