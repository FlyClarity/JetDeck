# JetDeck Ops Build Brief v2.0 — Gap Analysis & Implementation Plan

Companion to `OPS_BUILD_BRIEF_v2.md` (stored alongside this file per the
brief's own instructions). This document compares the brief's 35 build
steps (Modules A–K) against what actually exists in this codebase today,
then proposes a phased order to build the gap — reordered from the
brief's own step numbering where the actual dependency chain, or the
operator's own demonstrated preferences this build, argue for a
different sequence.

**Status:** Comparison complete. Implementation not started. This is a
planning document to work from, not a record of shipped work — nothing
below gets a `~~strikethrough~~` until it's actually built, committed,
and deployed (matching `BACKLOG.md`'s convention).

---

## Zero, before anything else: two scope calls worth making explicit

**1. "Sales Brief v5.0, Steps 1–20" doesn't exist in this repo.**
The Ops Brief assumes a formal Sales Brief was followed step-by-step.
It wasn't — this app's sales side (quoting, contacts, fleet, Stripe
Connect, brokered sourcing, the client-facing `/q/[token]` flow) was
built incrementally through direct rounds of operator feedback, not
from a written brief. Functionally, most of what a "Sales Phase 1"
would cover already exists — but there's no Step 1–20 checklist to
literally check off. Treat the Ops Brief's steps as continuing from
"wherever sales actually is today," not from a specific numbered
starting line.

**2. The mobile app is a second product, not a step.**
Steps 26, 39–44, and 54 build a brand-new React Native/Expo codebase,
submitted to two app stores, with its own build pipeline and ongoing
maintenance burden completely separate from this Next.js app. That's a
real, standalone commitment — new tooling, a new release cadence, app
review cycles measured in days, and a second place bugs can live. It
deserves its own explicit yes/no, made with that cost in mind, rather
than being step 26 of 55 as if it were the same size as the steps
around it. This plan defers it to its own phase (Phase 6) and proposes
a mobile-optimized *web* crew portal first — same data, same engine,
no app-store dependency, reachable the moment it's built.

---

## Module-by-module comparison

| Module | Brief scope | Current state | Gap |
|---|---|---|---|
| **A — Crew Portal** | Mobile app + web, crew login, home dashboard, trip accept/decline, duty/flight logging, currency view, manual ack, discrepancy reporting | **Not built.** `CrewMember` has no `clerkUserId` — crew have no login of any kind. Ops enters everything on their behalf today (assign crew, mark stages, free-text brokered crew names). | Full module. No shortcuts — this is genuinely new. |
| **B — Duty & Flight Time Engine** | Rolling 24h/7d/30d/90d/365d accumulators from real flight logs; pre-assignment 8-point check; configurable alert thresholds | **Partially built**, but on a different foundation than the brief assumes. `lib/duty-time.ts` computes duty periods and checks the 14-hr duty cap, the 8/10-hr flight-time cap, and a 10-hr rest minimum — **entirely from the *planned* itinerary** at Ops Review time, not from actual logged duty/flight events. There is no `FlightTimeAccumulator`, no rolling 7d/30d/90d/365d totals, no real accumulation over time (explicitly deferred in the code's own comments). The pre-assignment check today is 3 items (aircraft availability, crew qualification, duty/rest against other *JetDeck* trips), not the brief's 8. | Needs a real engine built on logged (not planned) flight time — see Phase 2. Also: the brief specifies 9hr rest for multi-crew / 10hr for single-pilot; the current code uses a flat 10hr for both. Worth reconciling against the actual regulation during the rebuild, not carrying the discrepancy forward silently. |
| **C — Crew Records & Qualifications** | Full profile, per-aircraft-category qualifications, multi-certificate tracking with expiry, currency (landings/approaches), training history, PRIA | **Partially built, thin.** `CrewMember` today: name, role, email, phone, active, a single manual `qualified` boolean, one `medicalExpiry`, one `trainingExpiry`. No per-aircraft `CrewQualification`, no `CrewCertificate` (multiple certs/ratings each with their own expiry), no `CrewCurrency` (landings/approaches), no `TrainingRecord` history, no PRIA at all. | Real gap, but the existing fields map cleanly onto the new models (e.g. today's `medicalExpiry` becomes one row in `CrewCertificate`). No throwaway work — extend, don't replace. |
| **D — Aircraft Compliance & Discrepancy** | Airframe/engine hours, OpSpec flags, insurance/registration tracking, CAMP import, full discrepancy/squawk/MEL lifecycle | **Partially built.** `AircraftDowntime` exists — a date-ranged maintenance window, already read by the Ops Review "aircraft available" check. That's it. No `AircraftCompliance` (hours, cycles, OpSpecs, insurance, registration), no `MaintenanceItem`, no `Discrepancy` model at all — no squawk lifecycle, no MEL categories/deferral limits, no AOG status, no photos. | `AircraftDowntime` isn't replaced — a squawk that gets deferred still creates a downtime-shaped fact (aircraft unavailable for a window) alongside its own richer `Discrepancy` record. Build `Discrepancy`/MEL/AOG as new; keep `AircraftDowntime` as-is for planned maintenance windows that aren't squawk-driven. |
| **E — Document & Manual Management** | Versioned document library, mandatory crew acknowledgment gating trip acceptance | **Not built.** Zero document/manual storage of any kind today. | Full module, new. |
| **F — Flight Release** | Per-leg electronic release: aircraft/crew/flight/passenger checklist, PIC acknowledgment, signature + PDF, gates departure | **Partially built**, as a much lighter approximation. `evaluateReleaseReadiness` / `evaluateBrokeredReleaseReadiness` (`lib/ops-review.ts`) already gate a trip's "Ready for Release" / "Released (Brokered)" stage on: Ops Review checklist passed, itinerary sent, payment secured (owned-fleet only), crew acknowledged (owned-fleet only, a manual ops override standing in for a real crew ack). This is trip-level, not per-leg, has no weather/NOTAM/fuel/W&B checklist items, no signature capture, and no generated PDF. | The existing gate is the right shape (checklist function → pass/fail → named action that flips status) — Module F should extend this pattern per-leg rather than replace the trip-level stage machine, which the rest of the Ops Board already depends on. |
| **G — Weight & Balance** | Aircraft envelope config, calculator from manifest + fuel + baggage, CG graph, pass/fail, PDF | **Not built.** `Passenger.weightLbs` exists (already collected today) — that's the only usable input already in the system. No aircraft envelope config, no baggage weight field, no calculator, no CG math. | Full module, new. `Passenger.weightLbs` is a real head start; add a baggage weight field alongside it when this is built. |
| **H — Electronic Flight Logs** | Per-leg log: block/takeoff/landing times, landings, approaches, night time, IMC, fuel, linked to accumulators/currency | **Not built** as a real log. `Trip.actualBlockHours` / `Trip.actualFlightHours` are two manually-typed numbers ops enters when marking a trip Landed — no per-leg breakdown, no landings/approaches/night-time/IMC data, nothing an accumulator or currency engine could read. | Full module, new — and it's the *prerequisite* for Module B's real engine and Module C's currency tracking, not an independent late-stage item the way the brief's step order (Step 36, under crew portal) implies. See Phase 2. |
| **I — DAAP** | Safety-sensitive registry, test records, random pool + quarterly rate math, supervisor training | **Not built at all.** Nothing DAAP-related exists. | Full module, new. Administrative record-keeping — see phasing note below on why this doesn't need to block flight-ops-critical work. |
| **J — Availability & Scheduling** | Crew availability calendar, combined aircraft+crew+trip master schedule | **Partially built.** The Fleet Calendar already plots trips and `AircraftDowntime` on a calendar with day/week/month views and conflict detail. No crew rows, no `CrewAvailability` model, no vacation/sick/training-day tracking. | Extends the existing Fleet Calendar rather than a separate screen — add a crew swimlane once `CrewAvailability` exists. |
| **K — Compliance Dashboard & Audit** | Single-screen red/yellow/green compliance health view; permanent, non-editable audit log; PDF/CSV reports | **Not built.** No `AuditLog` of any kind exists anywhere in the app. The Ops Board and the sales-side "Needs Review" queue are the closest analogues, but they're narrow (trip-stage and quote-review only) — not a compliance rollup. | Full module, new — and it's the natural capstone once B–I have real data to summarize. Building it before that data exists would just be an empty dashboard. |

**Bottom line:** every module has *some* real foundation to build on except
E (documents), G (W&B), H (flight logs), I (DAAP), and K (dashboard/audit),
which are genuinely starting from zero. Nothing existing needs to be torn
out — the pattern already established throughout this app (a pure
`evaluate*` function that both renders a checklist and re-verifies
server-side before a status change, e.g. `evaluateOpsReview`) is exactly
the right shape to extend into the new modules, not a design this brief
requires abandoning.

---

## Proposed phase order

Reordered from the brief's Step 21–55 sequence for two reasons: (1) Module
H (flight logs) has to exist before Module B's real accumulator engine or
Module C's currency tracking can be anything but a placeholder, but the
brief's own step order puts flight log entry under the crew portal (Step
36) — after the compliance dashboard (Step 31) that's supposed to read
from it. (2) This operator has now twice, on this exact app, explicitly
chosen "ops enters it directly" over "make the client/crew do it and hope
they respond" (manifest collection, brokered crew names) — the same
instinct argues for building duty/flight logging as an **ops-web-entered**
feature first, crew self-service second, and native mobile last, rather
than assuming mobile-first the way the brief's step order does.

### Phase 1 — Compliance data foundation
*Brief steps ≈21, 23–25, reordered; no mobile, no engine logic yet.*

Pure schema + CRUD, ops-web-only (no crew login required for any of
this — ops enters and maintains it, same as crew records work today).
Lower risk than it looks despite being a large migration: nothing here
changes existing behavior, it only adds new tables and new pages.

- Extend `CrewMember` toward the full profile (address, emergency
  contact, employment type, hire/termination, status) and add
  `CrewQualification` (per-aircraft-category), `CrewCertificate`
  (replaces the single `medicalExpiry`/`trainingExpiry` pair with a
  real multi-certificate list, each with its own expiry and alert
  window).
- Add `AircraftCompliance` (hours/cycles, OpSpec flags, insurance,
  registration) and `MaintenanceItem` (manual entry only — CAMP CSV
  import is a Phase-1.5 nice-to-have, not a blocker).
- Add `Document` / `DocumentVersion` / `ManualAcknowledgment` — upload
  and version a manual; acknowledgment tracking is buildable now even
  with no crew login, since ops can record "I confirmed with James
  verbally" as a manual override until Module A/crew-web exists to let
  crew self-acknowledge.
- Add a **lightweight** `AuditLog` now (not the full middleware the
  brief's Step 22 describes) — a single `logAction()` helper called
  explicitly from the handful of new server actions this phase adds
  (crew record changes, document uploads). Wrapping *every* route from
  day one is the right end state, but retrofitting it onto the entire
  existing app as a prerequisite step would be a large, risky,
  low-value-on-its-own change to do before anything depends on it.
  Widen it as later phases add actions worth auditing.

### Phase 2 — Real flight/duty logging + engine
*Brief steps ≈27–30 + H, reordered ahead of the crew portal.*

The regulatory heart of the brief, and the one place accuracy matters
most. Build it ops-web-entered first:

- `FlightLog` model + an ops-side entry page (per leg, on the trip
  detail page) — same "ops fills it in directly" pattern as the
  manifest and brokered-crew work already shipped this build. This
  replaces `Trip.actualBlockHours`/`actualFlightHours` as the source
  of truth (keep those two fields reading from the new log for
  backward compat on old trips, or backfill them).
- `FlightTimeAccumulator` + `lib/compliance/accumulators.ts` —
  recalculated from `FlightLog` on every submission, never a running
  total that can drift (per the brief's own explicit warning). Replaces
  `lib/duty-time.ts`'s current planned-itinerary approximation as the
  real source for 24h/7d/30d/90d/365d totals; the existing function's
  per-trip duty-period math is still useful as the *pre-assignment
  estimate* before a flight happens, so keep it for that, not as the
  post-flight record of truth.
- `CrewCurrency` + `lib/compliance/currency.ts` (instrument approaches,
  day/night landings/takeoffs) and `TrainingRecord` due-date engine —
  both read the same `FlightLog`/certificate data this phase and Phase
  1 just added.
- Pre-assignment 8-point check (`lib/compliance/availability-check.ts`),
  replacing the current 3-item version inside `evaluateOpsReview`.
- Resolve the 9hr/10hr rest-by-crew-size question explicitly before
  shipping this (see the Module B row above) rather than carrying the
  current flat-10hr assumption forward without checking it against the
  actual regulation text.

### Phase 3 — Aircraft ops: discrepancies, W&B, flight release
*Brief steps ≈45, 46, 49, D.3, F, G.*

The pieces that most directly reduce day-to-day operational and
certificate risk on an actual flight, and depend on nothing from
Phases 1–2 except the aircraft/crew data already in place by then.

- `Discrepancy` + MEL category/deferral-limit tracking + AOG status
  (auto-blocks an aircraft from new quotes, same enforcement style
  already used for `AircraftDowntime`).
- `WeightBalanceConfig` (per aircraft) + `WeightBalanceRecord` +
  calculator UI, feeding off `Passenger.weightLbs` (already collected)
  plus new fuel/baggage inputs.
- `FlightRelease`, extending the existing `evaluateReleaseReadiness`
  pattern to a real per-leg checklist (aircraft/crew/flight/passenger
  sections, PIC acknowledgment, generated PDF) rather than replacing
  the trip-stage machine the Ops Board already runs on.

### Phase 4 — Compliance dashboard, audit trail, reports
*Brief steps ≈31, 32, 52, 53.*

The capstone — deliberately last, since it's a rollup of data that
doesn't exist until Phases 1–3 ship. Widen the lightweight `AuditLog`
from Phase 1 to cover every action added since (releases, discrepancy
changes, training records, document acks, overrides), build the
red/yellow/green dashboard, and add the PDF/CSV exports from Module
K.3.

### Phase 5 — DAAP + PRIA
*Brief steps ≈50, 51, C.5, I.*

Administrative record-keeping the certificate requires but that
doesn't block any single day's flight the way duty-time or W&B does.
Can run in parallel with Phase 3/4 as time allows rather than strictly
after — sequenced last here only because it has the least dependency
on anything else and the least day-to-day workflow urgency for a
one-person ops shop, not because it's optional.

### Phase 6 — Crew self-service, web first
*Brief steps ≈33–38 (Module A, web only — no mobile app yet).*

Once Phases 1–2 exist, exposing a read-mostly, mobile-browser-friendly
`app/(crew)/` route group (own trips, own currency, accept/decline,
log own duty/flight, acknowledge manuals) is comparatively cheap: same
data, same engine, just a narrower, role-scoped view with `clerkUserId`
finally added to `CrewMember` to give crew a real login. This is the
point where the "ops enters everything" pattern from Phases 1–3
starts shifting load onto crew themselves, once there's something
solid for them to log into.

### Phase 7 — Native mobile app
*Brief steps ≈26, 39–44, 54.*

Explicit, separate go/no-go — not a default continuation of Phase 6.
If the mobile-web crew portal from Phase 6 is good enough day-to-day
(push notifications are the main thing a phone browser can't do as
well as a native app), this phase can be deferred indefinitely with no
loss of compliance capability. If push notifications for new
assignments/compliance alerts turn out to matter enough in practice,
that's the actual trigger to greenlight this phase, not step order.

---

## What this plan deliberately does not change

Everything currently shipped and working — the 6-stage owned-fleet /
3-then-6-stage brokered pipeline, the Ops Board, the Ops Review
checklist pattern, the manifest system (ops-entered per the operator's
own recent call), the Fleet Calendar, crew assignment/emails — stays
exactly as it is. Every phase above extends this app's existing
patterns (an `evaluate*` function per gate, a named "Mark ..." action
per stage transition, `operatorId`-scoped models throughout) rather
than introducing a new architecture alongside it.

---

## Recommended next step

Start with **Phase 1** (compliance data foundation) as its own
migration and set of CRUD pages — it's the largest single risk
reduction for the least behavioral change to the app you're already
running day to day, and every later phase depends on it existing.
Confirm this ordering (or redirect it) before that migration starts,
given its size.
