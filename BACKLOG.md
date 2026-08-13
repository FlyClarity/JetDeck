# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

- **Reorder legs in the Quote Builder — shipped, iterated twice on UI
  in one day** (raised directly). Three passes, each on direct feedback:
  1. Move Up/Down buttons (`ArrowUp`/`ArrowDown`) on every leg row.
  2. Replaced with a drag handle (`GripVertical`) using native HTML5
     drag-and-drop, after "I dont like the up and down arrow ui... I
     would rather have the hamburger/hash style to move leg around with
     the mouse."
  3. Replaced again with Move Up/Down buttons after all, after "that
     does work as well i want to roll that back but i want the arrows
     to be more subtle not arros just '^' and down on the left side of
     the leg card" — back to buttons, but `ChevronUp`/`ChevronDown`
     (smaller, lighter — `text-muted-foreground/60`, `disabled:opacity-20`)
     instead of the original full arrow icons, sitting at the card's left
     edge out of the way of the actual fields.
  Underlying logic (`moveLeg` — plain array-position swap) is unchanged
  across all three; only the UI/interaction model moved. Same deliberate
  non-goal throughout: doesn't try to re-derive `homeSide`/`betweenLegs`
  after a move (those only matter to the aircraft-resync effect and the
  "returns to base" toggle, not rendering) — an operator reordering an
  auto-managed leg away from its original leading/trailing/bracketing
  position is already choosing to override it by hand.

- **Overnight nights not updating when editing a leg's date — likely
  root cause found and fixed** (raised directly: "adjusting the
  departure dates... does not automatically update the overnights").
  The live recompute itself was already reactive (verified by reading
  through the render path — `autoNightsAway`'s `useMemo` recomputes
  every render since its `revenueLegs` dependency is a fresh array each
  time), so a plain "edit a date, see the total change" case should
  already have worked. The real bug: the gap sum was computed over
  **array order**, not **date order** — `nightsBetween(legs[i].date,
  legs[i+1].date)` for consecutive array positions. Since
  `nightsBetween` clamps a negative span to 0, any leg sitting out of
  chronological order in the array (e.g. added via "Add leg" and not
  yet dragged into place — see the reordering item above, which makes
  this more likely to happen, not less) would silently contribute a 0
  to that pair instead of the real gap, and moving its date around
  would appear to do nothing. Fixed by sorting the revenue legs' dates
  before summing gaps between consecutive *dates* instead of consecutive
  *array positions* — order-independent now, so this can't recur once
  reordering (or any other way legs might end up array-order-scrambled)
  is in the picture.

- **AI-extracted dates picking random years — fixed** (raised directly:
  "the system keeps using random years, sometimes... 2024 or 2025").
  Neither AI prompt that extracts trip dates from email text
  (`EXTRACTION_PROMPT` in `lib/ai/parse-email.ts`, used by the manual
  "Create Trip Request" review action; `TRIAGE_PROMPT` in
  `lib/ai/classify-email.ts`, used by the live inbound pipeline) ever
  told the model what today's date actually was — so a bare "8/17" with
  no year had nothing to anchor a guess to, and the model's guess
  varied. Both prompts are now built as functions taking `todayIso`
  (`new Date().toISOString().slice(0, 10)`, computed fresh at call
  time, not baked into the static prompt string) and include an
  explicit instruction: infer the year so the resulting date is the
  next upcoming occurrence on or after today — if that month/day has
  already passed this year, use next year, never a past year — and only
  use an explicitly stated year as-is. Matches exactly what was asked:
  in August, a bare "1/3" should resolve to next January, not a past
  or arbitrary one.

- **Two-step booking flow — shipped** (raised directly: "I think we need
  to move the booking process to a two step process"). Previously a
  single client click ("I Accept — Book This Charter") was both the
  non-negotiable legal signature *and* the only trigger for an operator
  availability review, and that review only happened automatically when
  a same-aircraft conflict was detected — otherwise the booking
  finalized (Trip, Stripe hold, confirmation email) immediately with no
  human in the loop at all. Restructured into two steps:
  1. Client clicks **"Request to Book"** on `/q/[token]` — a plain,
     non-binding button (no terms shown, no name/signature collected,
     confirmed directly with the user rather than assumed). Quote moves
     to `pending_confirmation`, `requestedAt` is set, and the same
     conflict check runs and gets stored as advisory context
     (`conflictWarning`) — it's just no longer a hard gate, since the
     review step is unconditional now regardless of whether a conflict
     was found.
  2. Operator reviews on **Needs Review** (reusing the
     `pending_confirmation` UI/actions already built for the old
     conflict-only gate — same Confirm/Decline buttons, same shared
     helpers) and either **declines** (client gets the existing "unable
     to confirm" email, done) or **confirms availability** — which no
     longer finalizes anything by itself. It moves the quote to a new
     `approved` status and emails the client a link back to
     `/q/[token]`, where they *now* see the real terms/signature step
     for the first time (`TermsAcceptGate`, unchanged component,
     unchanged "I Accept — Book This Charter" wording — the E-SIGN/UETA
     clickwrap moment just moved later in the flow, not away). Signing
     re-runs the conflict check once more as a safety net (in case
     something else got booked in the gap between approval and
     signature) — if a fresh one turns up, it drops back to
     `pending_confirmation` instead of finalizing, reusing the exact
     same conflict-branch logic the old single-step flow already had.
  New `Quote.approved`/`requestedAt`/`approvedAt` fields (migration
  `20260811170000_quote_two_step_booking`); `confirmPendingBookingForOperator`
  (`lib/booking-server.ts`) now transitions to `approved` + emails the
  client instead of calling `finalizeBooking` directly;
  `declinePendingBookingForOperator`'s guard broadened to accept either
  `pending_confirmation` or `approved`, since the operator can still back
  out after approving but before the client signs. Same-aircraft
  conflict checks (`findBookingConflict`'s own candidate query, and both
  Quote Builder pages' `existingBookings` fetches) now also treat
  `approved` bookings as taken, alongside `accepted` and
  `pending_confirmation` — an approved-but-unsigned booking still
  represents a real commitment. `approved` quotes fold into the existing
  "Sent" tab in the Quoting Queue (both are "out to the client, awaiting
  their action") rather than getting a dedicated tab.
  Noted in passing, not fixed (pre-existing, not introduced by this
  pass): the client-facing page has no explicit branch for a
  `cancelled` quote (post-acceptance operator cancellation) — it falls
  through to the last conditional branch, which now shows the "Request
  to Book" button rather than anything cancellation-appropriate. Low
  practical risk (the `requestToBook` action's own status guard still
  refuses to act on it), but worth a real "this booking was cancelled"
  branch next time this file is touched.

- **Manually-added overnight nights dropped on save/reload — fixed**
  (raised directly). Only the combined `Quote.overnightNights` total was
  ever persisted, not the split between auto-computed (from leg date
  gaps) and manually-added "extra" nights — reopening a saved quote
  always reset the extra-nights input to 0 (a documented known gap),
  which looked like the manual addition had silently vanished, and
  resaving from there would actually drop it from the stored total for
  real. Fixed by adding `autoNightsAwayOf()` (`lib/itinerary.ts`, same
  gap-between-consecutive-revenue-legs math the Quote Builder already
  runs live, just against a saved itinerary instead of live leg state)
  and using it to back out the correct split on reload:
  `extraNightsAway = max(0, overnightNights - autoNightsAwayOf(itinerary))`
  in `app/(app)/quotes/[id]/page.tsx`.

- **Client-visible notes on quotes — shipped** (raised directly: "need a
  way to add notes for the client to see on the quote"). New
  `Quote.clientNotes` field (migration
  `20260811160000_quote_client_notes`), distinct from the existing
  `internalNotes` (operator-only, never shown to the client) — a
  "Notes for client" textarea in the Quote Builder, saved by both
  `createQuote`/`updateQuote`, and rendered in its own "Notes" section
  on `/q/[token]` (only when non-empty) between the itinerary and
  pricing sections.

- **Dashboard was pulling unbounded data on every load and every poll —
  fixed** (raised directly after hitting Neon's data-transfer/egress
  limit): `DashboardPage`'s two queries
  (`prisma.tripRequest.findMany`/`prisma.quote.findMany`, both scoped
  only by `operatorId`) had no `take` limit at all — every page load,
  and every 30s dashboard poll, fetched the operator's *entire* history
  of trip requests and quotes, growing without bound as more accumulate
  (thousands of `passed` trip requests over time, for instance). Capped
  both to the 500 most recent (`RECENT_LIMIT` in
  `app/(app)/dashboard/page.tsx`) — comfortably more than any tab
  realistically needs day-to-day, but no longer unbounded. Also
  lengthened the dashboard's `router.refresh()` poll interval
  (`components/queue/quote-queue.tsx`) from 30s to 2 minutes, since it
  re-fetches that same full payload on every tick — a tighter interval
  directly multiplies transfer usage per open tab without meaningfully
  improving freshness for a sales queue.
  Not done: real pagination/an archive view for very old records — the
  500 cap is a stopgap, not a fix for the underlying "all filtering
  happens client-side over the full fetched set" design once an
  operator's genuinely *active* (non-terminal) volume approaches it.
  Worth revisiting if that happens in practice.

- **"Route unknown" on internal/owner trips — fixed**: the quote detail
  page header, the dashboard queue list row, and the queue side pane all
  computed the route summary from `quote.tripRequest.legs`, which is
  `null` for internal trips (Log Internal Flight has no `TripRequest` at
  all — see the earlier internal-trip-creation item). Even though the
  itinerary legs were entered and saved correctly, the summary line
  always fell back to a hardcoded "Route unknown" string instead of
  reading `quote.itinerary`. Fixed all three spots to fall back to
  `routeSummary(revenueLegsOf(quote.itinerary), "multi_leg")` when
  there's no `tripRequest`.

- **Original-request panel was missing the email subject — fixed**:
  routing is frequently stated in the subject line (e.g. "TEB-PBI
  9/15") rather than the body, and the operator needs to eyeball it
  against what the AI extracted — but `TripRequest` never stored the
  subject, and `OriginalRequestPanel` only rendered `rawEmailBody`.
  Fixed by looking up the originating `InboundEmail` row (via its
  `tripRequestId` link, which is already set when
  `createTripRequestFromInboundEmail` runs) and passing its `subject`
  into a new `rawEmailSubject` prop, rendered as its own line above the
  body in both `/quotes/new` and `/quotes/[id]`.

- **Airport city/state under ICAO on the client quote page — shipped
  ("ITEM 1")**: user sent the OurAirports source CSV. Added
  `Airport.city`/`Airport.state` (migration
  `20260808100000_add_airport_city_state`) and backfilled them by
  matching each CSV row's `icao_code` (falling back to `ident` when
  blank — the same fallback OurAirports itself derives, and the one the
  original re-import used to choose each row's `icao`) against the
  existing `Airport.icao`. Deliberately an UPDATE, not a rebuild — the
  two prior airport migrations carefully filtered the dataset down
  (worldwide large/medium, US small airports with a runway ≥ 3000ft),
  and that set had to be preserved exactly; a row from the CSV whose
  icao doesn't match anything already in the table is just a silent
  no-op, not an error, so it was safe to generate updates from the
  full CSV without needing to know the current table contents from this
  sandbox (no live DB access here, same limitation as always). Filtered
  the ~85k-row CSV down to ~20.5k candidate rows first (large/medium
  worldwide, or small + `iso_country = "US"`) to keep the migration file
  a reasonable size instead of generating all 85k as one statement.
  `state` stores just the region code with the country prefix stripped
  (`"US-CA"` → `"CA"`) for readability. `/q/[token]` now queries
  `Airport` directly for the legs' city/state (a plain `prisma.airport`
  call, not `getAirportsByIcao`, since that helper requires an
  authenticated tenant context and this is the public client-facing
  page) and renders it under each leg's ICAO pair.
  Noted in passing, not acted on: 13 of the ~20.5k CSV rows have a
  corrupted `ident`/`icao_code` that looks like Excel scientific
  notation (e.g. `"1.00E+02"`) — an artifact in the source CSV itself,
  not something this migration introduced. Harmless (those keys simply
  never match a real `Airport.icao`), but flagging in case the same
  corruption shows up in a future data refresh from the same source.

- **Log Internal Flight — Trip creation without the client quoting
  pipeline** (raised directly, for owner flights/maintenance/
  repositioning that shouldn't go through pricing or client
  acceptance): new `/quotes/internal/new` route
  (`components/quote/internal-trip-form.tsx` +
  `app/(app)/quotes/internal/new/page.tsx`). Operator picks a purpose
  (Owner Flight / Maintenance / Repositioning / Other — see
  `TRIP_PURPOSE_LABELS` in `lib/quote.ts`), aircraft, and legs; on submit
  it creates a `Quote` directly (all pricing fields zeroed,
  `tripPurpose` set, `status: "accepted"`, no `tripRequestId` at all —
  that field was already optional) and a `Trip` (`status: "confirmed"`,
  not `"awaiting_payment"` since nothing is owed), then updates
  `Aircraft.currentBase` the same way a real acceptance does. No client
  email, no Stripe hold, no "Send Quote" step — none of that applies.
  Runs through the exact same `findBookingConflict` check as a real
  client acceptance (per the user's explicit priority: the system should
  always check current aircraft availability) — unlike the client flow,
  which downgrades to `pending_confirmation` on a conflict, this refuses
  to create outright and shows the conflict inline, since there's no
  client already committed to reconcile after the fact — the operator is
  creating it themselves in real time and can just fix the dates. New
  `Quote.tripPurpose` field (migration
  `20260807195655_quote_trip_purpose`) is what marks these; shown as a
  badge on the quote detail page and in place of the (nonexistent)
  requestor line in the Quoting Queue list/detail pane.
  Not done: the quote detail page below the header still renders the
  full `QuoteBuilderForm` (pricing fields, etc.) since building a
  separate stripped-down internal-trip detail view was more than this
  pass needed — harmless since everything's zeroed, just a bit of
  unnecessary UI for what's actually a non-revenue record.

- **Overnight/repositioning logic overhaul — core fix shipped, advisory
  detection deferred** (raised directly, explicitly called "imperative").
  The bug: "returns to home base" and "sits overnight between legs" were
  treated as one mutually-exclusive toggle (checked = 0 nights + trailing
  leg home; unchecked = manual nights, no trailing leg) when they're
  actually independent — a trip can return to home base *and* still need
  overnight nights at the away city in between. Fixed in
  `components/quote/quote-builder-form.tsx`:
  - Overnight nights (`autoNightsAway`) are now always auto-computed from
    the date gap between consecutive revenue legs, not gated by the
    toggle — covers scenario 1 (KSNA→KTEB→KSNA, 2 nights auto-added, 0
    repositioning) and scenario 2 (KVNY→KTEB→KVNY, repositioning on both
    ends *and* 2 nights) correctly now.
  - The trailing repositioning-home leg is unconditional in
    `buildInitialLegs`, same as the leading leg already was — no longer
    tied to the checkbox at all.
  - The checkbox itself was repurposed (scenario 4): now labeled
    "Aircraft returns to base between each leg (no overnight stays)",
    defaults unchecked (new default = stays overnight), and when checked,
    `toggleReturnsToHomeBase` brackets every gap between consecutive
    revenue legs with a repositioning-home + repositioning-back-out pair
    instead of letting the aircraft sit — traced by hand against all four
    of the user's scenarios and confirmed correct, including the 2-leg
    and home-base-round-trip cases.
  - New `LegRow.homeSide` ("dep" | "arr") replaces the old index-0-is-
    outbound assumption for the aircraft-change resync effect, since
    there can now be several repositioning legs (leading, trailing, and
    any number of "between legs" pairs) instead of just one.
  - New `LegRow.betweenLegs` flag marks which repositioning legs the
    toggle inserted, so unchecking it removes exactly those and nothing
    else (not the permanent leading/trailing ones, not anything added by
    hand).
  Known gap: reopening an already-saved quote only recognizes the
  leading/trailing repositioning legs as auto-managed on reload (same
  heuristic as before) — any "between legs" repositioning legs a quote
  was built with don't get re-tagged `betweenLegs: true` on reload, so
  toggling the checkbox off on a reopened quote won't auto-remove them
  (they'd need removing by hand). Low-impact in practice since most
  quotes are built once and sent, not heavily re-toggled after reload.
  Also unchanged: editing a revenue leg's airports/dates after the
  toggle is on doesn't reactively move the adjacent auto repositioning
  legs to match — pre-existing limitation of the leading/trailing legs
  too, not something this pass made worse.

  **Scenario 3 (auto-detecting another booking during what would be an
  overnight gap) — shipped, as a side effect of the away-windows
  segmentation fix below** rather than as a separate function. Once
  `findConflictingBooking` computes away time per *segment* instead of
  one whole-trip span, a gap the operator left as a plain overnight stay
  (no repositioning leg bridging it) is just another away segment like
  any other — so an overlapping booking during that gap surfaces through
  the same live Quote Builder banner described below, no separate
  "advisory nudge" UI needed. See the away-windows entry for the
  mechanics.

- **Live double-booking warning in the Quote Builder** (raised directly:
  "if there is a trip that is already booked/accepted, then that needs
  to be flagged on the quote page ... so we can either decide to pass,
  or adjust the quoting trip"). Previously `findBookingConflict` only
  ran server-side at the moment the client accepted (or when creating an
  internal trip) — the operator building the quote had no visibility
  into a conflict until then. Extracted the pure same-aircraft/
  same-date matching logic out of `findBookingConflict`
  (`lib/booking-server.ts`, which imports Prisma and can't be used
  client-side) into a new `findConflictingBooking()` in `lib/itinerary.ts`
  (already zero-server-dependency, safe for "use client" components);
  `findBookingConflict` now just runs its Prisma query and hands the
  results to the shared pure function. Both `/quotes/new` and
  `/quotes/[id]` now fetch the operator's other `accepted`/
  `pending_confirmation` quotes (`id`, `quoteNumber`, `aircraftId`,
  `itinerary` only) and pass them into `QuoteBuilderForm` as
  `existingBookings`; the form recomputes the conflict in a `useMemo`
  keyed on `[aircraftId, legs, existingBookings]`, so it updates
  instantly as the operator changes aircraft or edits leg dates — no
  network round-trip. A conflict renders as a dismissable-by-editing (not
  literally dismissable, just resolved by changing something) red banner
  right under the aircraft picker with the interrupting quote's number
  (linked), route, and date. Purely advisory — doesn't block saving or
  sending; the actual enforcement is still the existing accept-time gate
  (`pending_confirmation` status) and the internal-trip-creation hard
  block. This is the in-builder half of the same-aircraft-conflict work;
  the Scenario 3 "advisory nudge for another booking during an overnight
  gap" item above is a distinct, still-unbuilt follow-up (that one is
  about flagging a conflict that falls *inside* a gap between two of the
  *same* quote's own legs, not against the quote as a whole).

  **Follow-up fix, same day — exact-date matching missed multi-day
  trips**: caught live in testing — an owner flight KSNA→PAKN Sep 11,
  PAKN→KSNA Sep 18 (only two explicit leg dates) didn't flag a new quote
  built for Sep 15–20, because the original matching compared exact leg
  dates as a set intersection (`{Sep 11, Sep 18}` vs `{Sep 15, Sep 20}` —
  no shared date) instead of asking whether the aircraft's away *window*
  overlapped. This was a pre-existing bug in `findBookingConflict` too,
  not something the live-check pass introduced — it always compared
  exact dates, so the same scenario would have slipped through the
  accept-time gate as well. Fixed by changing `findConflictingBooking`
  (`lib/itinerary.ts`) to compute each booking's away window as
  `[earliest revenue-leg date, latest revenue-leg date]` and check for
  range overlap (`thisStart <= otherEnd && otherStart <= thisEnd`)
  instead of exact-date intersection. `BookingConflict` now carries
  `startDate`/`endDate` instead of a single `date`; both the
  `findBookingConflict` message and the Quote Builder banner render a
  range (e.g. "Sep 11 – Sep 18") when the two differ, a single date when
  they don't. New `formatIsoDate()` helper extracted from `legDate()` for
  formatting raw ISO strings outside the `StoredLeg` shape.

  **Second follow-up, same day — away windows now split around
  repositioning legs instead of spanning the whole trip**: the range-
  overlap fix above (whole-trip `[first leg date, last leg date]`) fixed
  the continuous-away case but introduced a converse false-positive: a
  quote with "returns to base between each leg" on (so the aircraft
  actually comes home and goes back out between two widely-spaced
  revenue legs, e.g. a one-day trip on the 5th and another one-day trip
  on the 20th) would still flag *any* other booking landing anywhere in
  that 15-day span, even though the aircraft was actually home and free
  the whole time in between. Fixed by having `awayWindows()`
  (`lib/itinerary.ts`, replacing the single-range `awayWindow()`) split
  the trip into separate away segments wherever a repositioning leg sits
  between two revenue legs — a repositioning leg's date always lands on
  one of its adjacent revenue legs' own dates (see `makeRepoLeg` in the
  Quote Builder), so its presence there, chronologically, reliably means
  the gap was bridged rather than sat through, with no need to know the
  aircraft's actual home base to tell the two cases apart. A trip with
  no repositioning between two revenue legs still collapses to one
  continuous segment (correctly catching the Sep 11–18 owner-trip case
  from the first fix); a trip with repositioning between them now
  produces two short segments instead of one long one, closing the false
  positive. `findConflictingBooking` now checks every segment pair
  between the two itineraries instead of one whole-trip range each.

- **Cancelled/declined quotes had no dashboard tab — fixed**: cancelling
  an accepted quote (or a client declining a sent one) moved it out of
  every visible Quoting Queue tab with no way to find it again
  afterward. Added a combined "Inactive" status covering both terminal
  states rather than two separate ones, per the option already flagged
  here — low expected volume for either status individually didn't
  justify splitting them. `QUOTE_ACTION_LABEL` gained `declined`/
  `cancelled` entries so the list row shows "Declined — view →" /
  "Cancelled — view →" instead of the generic fallback.

  **Follow-up, same day — moved from its own tab into a filter under
  "All Requests"** (raised directly: "I think inactive should be a
  filter tab under all requests instead of its own header"). Initially
  shipped as a seventh top-level `VIEWS` tab, competing for header space
  with Ready/All/Draft/Sent/Accepted; moved into the existing `STATUS_FILTERS`
  bar (`components/queue/quote-queue.tsx`) that already toggles
  Active/Passed under "All Requests" — "Inactive" is a third option
  there now. Since that filter bar drives the trip-request list
  normally, but "Inactive" needs to show *quotes* instead, added a
  `showingInactiveQuotes` flag (`activeView === "all" && statusFilter
  === "inactive"`) that folds into the existing `isQuoteView` check, so
  the same quote-rendering/selection code path used by Draft/Sent/
  Accepted picks it up automatically rather than needing its own
  branch.

  **Second follow-up, same day — "Needs Confirmation" removed as its
  own tab too, surfaced on Needs Review instead** (raised directly:
  "instead of a needs confirmation tab, they should go under needs
  review, and in the acceptance email there is a notification to the
  operator that verification is needed" — the operator's already
  emailed a direct link when a conflict is found at accept time, so a
  second "needs my attention" tab in the Quoting Queue was redundant
  with `/inbox/review`, which already exists as the one inbox for
  things needing a human decision). Removed `pending_confirmation` from
  `VIEWS`/`QUOTE_VIEWS` entirely — those quotes no longer appear
  anywhere in the Quoting Queue. `/inbox/review` now fetches them
  alongside its existing `needs_review` emails and renders a "Bookings
  needing confirmation" section above the email list, with inline
  Confirm Booking / Decline actions (a textarea + button, same pattern
  as the email cards' forms) and a "View quote" link through to the
  full detail page. The Confirm/Decline logic itself was extracted out
  of `app/(app)/quotes/[id]/page.tsx`'s page-scoped server actions into
  two new shared, operator-scoped helpers in `lib/booking-server.ts` —
  `confirmPendingBookingForOperator(operatorId, quoteId)` and
  `declinePendingBookingForOperator(operatorId, quoteId, note)` — since
  both the quote detail page (which still keeps its own Confirm/Decline
  UI, for acting from the full quote view) and the new Needs Review
  section now need to trigger the same outcome from different page
  contexts with different scoping already done. The nav's "Needs
  Review" unread badge (`app/(app)/layout.tsx`) now counts
  `pending_confirmation` quotes alongside `needs_review` emails, so it
  stays the one number that means "something needs you."

- **Arrival time now flags a day change — shipped**: a long or
  eastbound-heavy leg can land the next calendar day, but the `Arrives`
  field is a plain time-of-day input with nothing to show that. Rather
  than adding a whole date component to the field, `lib/time.ts`'s
  `addHoursToTime`/`addHoursAcrossTimezones` now return
  `{ time, dayOffset }` instead of a bare string (`dayOffset` computed by
  comparing the arrival's local calendar date, in the arrival zone, to
  the leg's own departure date — not raw UTC days, so the timezone shift
  itself is never miscounted as a day change). `LegRow` gained
  `arrDayOffset`, threaded through every place that derives `arrTime` in
  `quote-builder-form.tsx`; a small "+1d" (or "+2d", "-1d", etc.) badge
  renders next to the "Arrives" label whenever it's nonzero. Only ever
  populated for an auto-derived arrival time — a manually-typed time (or
  one reloaded from a saved quote) has no date attached to compare
  against, so `arrDayOffset` resets to 0 in both cases rather than
  guessing.

- **Outbound email gaps — internal notify missing on inbound trip
  requests, inconsistent Reply-To — fixed**: two issues found doing an
  audit of every `sendEmail` call site. (1) The intake form path sent
  the operator a "New trip request" notification, but the AI email
  pipeline — JetDeck's primary feature — created and scored the
  TripRequest without notifying anyone; an operator not watching the
  dashboard had no way to know a 🟢 HIGH opportunity had just landed by
  email. `createTripRequestFromInboundEmail`
  (`lib/ai/process-inbound-email.ts`) now sends the same kind of
  internal notification, including the score badge and reason. (2) The
  "Request Changes" flow already set `replyTo` to the client's email so
  a sales user could hit reply and land straight in the client's inbox
  — but that pattern wasn't applied to the other internal notify
  emails (general inquiry, quote response matched, quote accepted,
  quote declined, intake form new-request), so replying to any of
  those went nowhere useful. All five now set `replyTo` to the
  relevant client/broker address.
  Not tested live — no `RESEND_API_KEY` in this sandbox, same
  limitation as everywhere else email-related in this project.

- **Airport dataset gaps (KUAO, KOEB) — root cause found and fixed, but
  worth a second look**: the original import (10,463 rows) silently
  dropped a meaningful number of legitimate ICAO-coded airports —
  confirmed by diffing against the exact source CSV the user provided:
  KUAO and KOEB were both present in the source with normal data (a
  medium_airport and small_airport respectively, both missing an IATA
  code but that's common and not disqualifying — e.g. KMMV, which
  matches that same profile, *did* make it into the original import).
  No single filter rule explains the gap; it looks like incomplete/lossy
  processing in whatever script built the original import rather than
  a deliberate exclusion. Rebuilt from scratch instead of patching
  individual rows: full re-import migration
  (`20260804213733_reimport_full_airport_dataset`) parses the source
  CSV directly, keeping only `type` in (large_airport, medium_airport,
  small_airport), preferring `ident` as the ICAO code and falling back
  to `gps_code` when `ident` isn't 4-letter ICAO-shaped (this is what
  makes airports like Nunapitchuk — ident "16A", gps_code "PPIT" —
  resolve correctly), excluding heliports/seaplane bases/balloonports
  (not relevant to fixed-wing charter) and OurAirports' own "ZZ"
  placeholder rows. Result: 18,353 airports, up from 10,463 — nearly
  double.

  Follow-up: that full-world import turned out to be too broad —
  13,468 of the 18,353 were `small_airport` type, and 87% of those
  (11,779) were outside the US, i.e. mostly irrelevant remote/private
  strips for a US charter operator. Narrowed with a second migration
  (`20260804221336_narrow_small_airports_to_us_runway_3000ft`):
  large/medium airports stay worldwide (only ~4,885, no real noise
  there), but `small_airport` is now scoped to `iso_country = "US"`
  and requires a longest open runway ≥ 3,000ft, cross-referenced from
  a companion `runways.csv` the user also provided (joined on
  airports.csv's numeric `id` == runways.csv's `airport_ref`, not on
  `ident`, since the chosen ICAO sometimes comes from `gps_code`
  instead — see the ident/gps_code fallback note above). A
  small_airport with no runway record at all is excluded rather than
  assumed to qualify. Net result: 6,472 airports, still including
  KUAO and KOEB. If international small-airport charters ever come up
  (Caribbean, Mexico, Canada, etc.), this is a one-line change to
  extend the country allowlist — flagging here so it's not forgotten
  when that need arises. Also worth spot-checking a handful of other
  previously-missing airports (if the user has more examples) to
  confirm the original fix was complete, and eventually tracking down
  *why* the original import lost rows in the first place, in case the
  same process gets reused for a future data refresh.
- **Daily AI pass to re-surface passed one-way requests that now fit a
  scheduled trip** (raised directly): at the end of each day, have the
  AI review upcoming confirmed trips alongside trip requests that were
  previously passed on, looking for ones that could now be strung
  together — e.g., a client books a round trip to Colorado and back,
  and a one-way request from Colorado to SNA that was passed on two
  days ago (wrong fit in isolation) would actually work well as a
  connecting leg once the aircraft is already going to be out there.
  The stated goal: a human can't keep that much of the schedule in
  their head at once, but the AI can cross-reference it automatically.
  Not scoped yet — needs a design pass on: what "fits" means precisely
  (same aircraft only, or same category/range-compatible substitutes
  too; how much date/time slack counts as connectable; whether this
  should also actively suggest repositioning-leg savings, not just
  flag matches), and where surfaced (a daily digest email, a
  dashboard section, re-opening the passed request itself with a
  note). Likely wants to build on the same great-circle/repositioning
  math already in `lib/geo.ts` and `score-opportunity.ts` rather than
  inventing new logic from scratch — the "how far is this aircraft
  from this trip" computation is the same shape either way, just
  comparing against a confirmed Trip's schedule instead of the current
  live fleet position.
- **HAVE:/NEED: pre-filter is a single hardcoded prefix, watch for other
  non-request patterns in real feed traffic**: after connecting a real
  NBAA/broker blast feed, a huge chunk of the volume turned out to be
  "HAVE:" (empty-leg availability) listings — not trip requests at
  all, but structurally identical shorthand to a real "NEED:" request,
  so the AI couldn't reliably be trusted to tell them apart alone. Now
  filtered before any AI call via `NON_REQUEST_SUBJECT_PREFIXES` in
  `lib/ai/process-inbound-email.ts` (currently just `HAVE:`), with a
  prompt-level fallback in case the prefix format varies. If other
  non-request patterns show up in real traffic (e.g. "SOLD:",
  "BOOKED:", other brokers' own confirmations echoed back into the
  feed), add them to that same list rather than relying on the AI to
  catch them after the fact — it's both cheaper and more reliable.
  Also worth periodically spot-checking what's landing in `discarded`
  with `classification: "availability_listing"` to make sure the
  filter isn't accidentally swallowing anything that was actually a
  real request.
- **AI triage cost — needs a live test** (raised when asked how to cut
  AI triage costs): investigated prompt caching first, but both the
  classification and extraction prompts were only ~450–550 tokens —
  below Claude Sonnet 5's 1024-token minimum cacheable prefix, so
  marking them `cache_control` would've silently done nothing. Instead
  merged classify + extract into one call (`classifyAndExtractEmail`
  in `lib/ai/classify-email.ts`) — a `new_trip_request` email used to
  cost two full model calls (classify, then a second extract call
  re-reading the same email body); now it's one. The manual "Create
  Trip Request" review action in Needs Review still calls the
  original standalone `parseEmailToTripRequest` unchanged, so that
  path is unaffected either way. Couldn't test the merged prompt
  against the live API from this sandbox (no key here) — send a batch
  of real test emails (plain language and broker shorthand both)
  through the live inbound address and confirm classification and
  extraction accuracy both still hold before trusting it unsupervised.
  If the combined prompt's length ever crosses 1024 tokens, prompt
  caching becomes worth revisiting too.
- **Opportunity scoring: repositioning uses aircraft base, not a live
  fleet-tracking feed** (raised alongside the scoring refinement below):
  the new distance-tiered scoring still reasons from
  `Aircraft.currentBase`/`homeBase`, which is only as fresh as the last
  manual update — there's no real-time "where is this tail right now"
  data source. Also, the range/reachability check only looks at the
  first requested leg, not the full multi-leg itinerary, so a
  multi-leg trip that's fine outbound but exceeds range on a later leg
  won't get caught yet.
- **Category-relaxed scoring always calls out the mismatch, even for
  an operator with only one category of aircraft**: after relaxing
  the hard category filter, every off-preference match adds a
  parenthetical note ("flagged as a good fit anyway rather than
  passed"). For a single-aircraft-type fleet this note fires on nearly
  every request, which may get noisy — worth revisiting if it turns
  out to be more clutter than signal in practice.
- ~~**Operator logo upload**~~ — not actually a gap: `Operator.logoUrl`
  is already synced automatically from Clerk's own hosted Organization
  Profile UI (`app/api/webhooks/clerk/route.ts` reads `has_image`/
  `image_url` off the `organization.updated` webhook payload and writes
  `logoUrl`). An operator changes their logo in Clerk's org settings, not
  in JetDeck — no custom upload UI needed here. (Previously logged as an
  open item in error; corrected after review.)
- **Double-booking now actually blocks instead of just warning after the
  fact** (raised directly — two clients booking the same aircraft/dates):
  previously `acceptQuote` always accepted immediately and only *flagged*
  a conflict for the operator to sort out manually after both were already
  "confirmed." Now: the legal acceptance (terms/IP/timestamp — the E-SIGN/
  UETA clickwrap moment) still happens unconditionally on click, since
  that's independent of aircraft availability, and the button/legal text
  are unchanged from the brief's required wording. But if
  `findBookingConflict` (`lib/booking-server.ts`) finds a same-aircraft/
  date conflict against another `accepted` **or** `pending_confirmation`
  quote, the booking goes to `pending_confirmation` instead of `accepted`
  — no Trip, no Stripe hold, no wire-instructions email fire yet. Client
  sees "confirming availability," operator gets an email with a direct
  link to the quote, and resolves it from there with new Confirm
  Booking/Decline actions (`app/(app)/quotes/[id]/page.tsx`) — Confirm
  runs the same `finalizeBooking` pipeline the no-conflict path runs
  automatically. Surfaced in the Quoting Queue as a new "Needs
  Confirmation" tab with a badge count.
  Still same-aircraft/date-only, not leg-time-aware (two same-day legs
  that don't actually overlap in time still flag) and doesn't know about
  repositioning legs or crew availability — worth tightening once there's
  real leg-time data. Also, checking-then-writing isn't wrapped in a DB
  transaction/lock, so two genuinely simultaneous requests for the same
  conflicting slot could both still slip through as a narrow race —
  closing that fully would need serializable isolation or a unique
  constraint, not attempted here.
- **Client quote page — terms-hash snapshotting** (raised while building
  Step 15/16): `acceptedTermsHash` is computed at accept time from
  whatever `operator.termsText` currently holds, not from a snapshot
  taken when the quote was sent. If an operator edits their charter
  terms in Settings between sending a quote and the client accepting
  it, the hash reflects the edited version, not what the client
  actually read on the page (which is also live-fetched, so the page
  and the hash always agree with each other — just not necessarily
  with whatever the operator originally intended when the quote was
  sent). Low risk in practice (terms rarely change quote-to-quote) but
  worth hardening later by storing a terms snapshot on the Quote at
  send time, matching how `Operator.termsVersion` already snapshots a
  hash on Settings save.
- **Resend card hold link — shipped** (raised directly): Stripe Checkout
  Sessions expire 24h after creation, and the client's confirmation email
  only ever contains the one link generated at booking time
  (`finalizeBooking`). If a client doesn't click through in time, that
  link goes dead with no way back in short of the operator manually
  sorting it out over email/phone. New `resendCardHoldLink(operatorId,
  quoteId)` in `lib/booking-server.ts` regenerates a fresh Checkout
  Session for the same deposit amount, updates `stripePaymentIntentId`/
  `cardHoldStatus: "pending"`, and re-emails the client the new link.
  Wired up as a "Resend card hold link" button on the quote detail page
  (`app/(app)/quotes/[id]/page.tsx`), shown for `accepted` quotes with a
  deposit that hasn't already been captured (`cardHoldStatus !==
  "captured"` — no point resending once the hold already went through).

- **Stripe card hold (Step 17) + Trip creation (Step 18) — shipped**:
  `acceptQuote` (`app/q/[token]/page.tsx`) now does both on acceptance,
  in order: creates a `Trip` record (`lib/trip-server.ts`'s
  `generateTripNumber`, status `awaiting_payment`), updates
  `Aircraft.currentBase` to the last leg's arrival airport (own-fleet
  quotes only — reads the *full* itinerary including the trailing
  repositioning-home leg, not just revenue legs, since that's where the
  tail actually ends up), then creates a Stripe Checkout Session
  (`lib/stripe.ts`) for the deposit amount with
  `payment_intent_data.capture_method: "manual"` — a hold, not a charge.
  The resulting `stripePaymentIntentId` and `cardHoldStatus: "pending"`
  are stored on the Quote, and the real checkout link is included in the
  client's confirmation email (falls back to the old "our team will
  follow up" copy if `STRIPE_SECRET_KEY` isn't configured, same
  graceful-degradation pattern as `lib/email.ts` when `RESEND_API_KEY`
  is missing). A new webhook (`/api/webhooks/stripe`) verifies the
  signature and updates `cardHoldStatus` as the hold progresses
  (`amount_capturable_updated` → authorized, `canceled` → released,
  `succeeded` → captured — that last one is for Phase 2's eventual
  capture flow, unused for now since Phase 1 never captures). Status is
  shown on both the operator's quote detail page and the client's
  accepted-quote page.
  Not tested live — no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in
  this sandbox (same limitation as Postmark/live-DB testing elsewhere in
  this project). Before trusting this unsupervised: create a Stripe
  test-mode key, accept a quote with a deposit amount set, confirm the
  Checkout Session opens and authorizes a test card
  (`4000 0025 0000 3155` is Stripe's manual-capture-friendly test card),
  and confirm the webhook flips `cardHoldStatus` to `authorized`.
  Also not done: the checkout link is only ever sent once, at accept
  time — if the client doesn't complete it before the Checkout Session
  expires (24h default), there's no way from JetDeck to regenerate and
  resend it. Worth a "Resend card hold link" action on the operator's
  quote detail page once this comes up in practice.

- **Buy a domain + finish Postmark setup** (raised after Step 13):
  inbound email (Step 7) is built but not actually live — `jetdeck.app`
  is hardcoded in the code (Clerk webhook's inbound address generation,
  outbound sender fallback) but isn't a domain anyone owns yet. Needed,
  in order:
  1. Buy a domain (not necessarily `jetdeck.app` specifically — just
     needs to be decided)
  2. Point it at the Vercel project (currently only reachable via the
     `.vercel.app` preview URL)
  3. Create a Postmark account, set up an Inbound stream
  4. Add an MX record for an inbound subdomain (e.g.
     `inbound.<domain>`) pointing at Postmark's inbound mail servers
  5. Configure Postmark's inbound webhook → `/api/webhooks/postmark`
     with Basic Auth matching `POSTMARK_WEBHOOK_SECRET`
  Once a domain is picked, the hardcoded `jetdeck.app` references need
  to be swapped for it (and made configurable via env var instead of
  hardcoded again). This also blocks testing real inbound sources like
  NBAA Air Mail, since nothing can forward mail to an address that
  doesn't resolve anywhere yet.

- **Aircraft photos + expanded amenities — shipped**: `Aircraft.hasWifi`
  (a single boolean) replaced with `photos String[]` and
  `amenities String[]` (migration
  `20260812120000_aircraft_photos_amenities`, backfilling `hasWifi: true`
  aircraft to `amenities: ["wifi"]` before dropping the column). Managed
  entirely in the Fleet section:
  - `/fleet/[id]` (edit page): a photo gallery with per-photo Remove,
    plus an upload form — new `uploadPhoto`/`removePhoto` server actions
    using `@vercel/blob`'s `put()`/`del()` (`access: "public"`, since
    the client-facing quote page that displays them has no auth session
    at all). Basic guardrails: image-mimetype check, 8MB cap. Upload
    failures (most likely a missing `BLOB_READ_WRITE_TOKEN`) are caught
    and logged rather than crashing the page — same graceful-degradation
    pattern used everywhere else an external service's credentials might
    not be configured yet (Resend, Stripe, Postmark).
  - `/fleet/new` and `/fleet/[id]`: a checkbox grid against a new
    `AIRCRAFT_AMENITIES` list in `lib/aircraft.ts` (wifi, galley,
    lavatory, flat-screen displays, leather seating, berthing, pet
    friendly, wheelchair accessible), replacing the single Wi-Fi
    checkbox. Photo upload isn't offered on `/fleet/new` — the aircraft
    needs to exist first (nothing to attach a blob to yet) — the create
    form says as much and points to the edit page afterward.
  - `/fleet` (list page): a small thumbnail per row from the aircraft's
    first photo, a plain placeholder box when there isn't one yet.
  Rendered on the client-facing quote page (`/q/[token]`) in a new
  "Aircraft" section — a horizontally-scrolling photo strip plus amenity
  badges — shown only when the aircraft actually has photos or
  amenities set, and only for owned-fleet aircraft (`quote.aircraft`);
  brokered third-party aircraft (`BrokeredAircraft`) don't have a photo/
  amenity model yet, out of scope for this pass.
  Not tested live — this sandbox has no `BLOB_READ_WRITE_TOKEN`, same
  limitation as everywhere else external-service-related in this
  project. Before trusting this unsupervised: in the Vercel dashboard,
  add a Blob store to the project (Storage tab) — this auto-populates
  `BLOB_READ_WRITE_TOKEN` as an env var — then upload a photo on an
  existing aircraft's edit page and confirm it appears there and on that
  aircraft's quotes' `/q/[token]` pages.

  **Follow-up, same day — upload did nothing after connecting the Blob
  store, multi-upload + cover photo added**: user connected a Blob
  store to all three environments and redeployed, but the upload button
  silently did nothing (store stayed empty) — and the original
  implementation's failure path was `console.error` only, with no
  feedback to the operator at all, so there was no way to tell "it
  failed" from "it worked" without server log access neither of us had.
  Rebuilt as a proper client component
  (`components/fleet/aircraft-photo-manager.tsx`) using
  `useActionState`, so `uploadPhotos` (renamed from `uploadPhoto`) now
  returns a real `{ error }` message rendered inline instead of just
  logging — the next attempt should actually say what's wrong rather
  than nothing happening. While rebuilding this, added the two other
  things asked for at the same time: the file input now accepts
  `multiple`, uploading everything selected in one submit
  (`formData.getAll("photos")`, one `put()` per file, one combined
  `photos: { push: [...] }` update); and each non-first photo gets a
  "Set as cover" button that reorders the array to put it first — no
  separate `coverPhotoUrl` field, the first photo in `photos` doubles
  as the cover everywhere it's already used (fleet list thumbnail,
  first image on `/q/[token]`), so this was purely a reordering
  operation. Root cause of the original silent failure is still
  unconfirmed (no log access) — the improved error message is meant to
  surface it on the next real attempt; if it turns out to be something
  other than credentials (e.g. the store not actually scoped to the
  Preview environment this branch deploys to, despite "all three" being
  selected), that'll need a follow-up once known.

- **In-app calendar view** (raised after Step 6): a calendar grid of
  trips inside JetDeck itself — organized by date + tail for
  part135/hybrid operators, by date only for pure brokers (no fleet
  to organize by). Not the same as the brief's Phase 2.6 calendar
  *sync* (which just pushes trips to external Google/Outlook
  calendars via iCal feeds). Would likely live at the already-planned
  `/trips` route, whose actual UI was never specified in the brief.

- **Separate Dispatch dashboard** (raised after Step 12): the current
  Quoting Queue (`/dashboard`) is sales-focused — trip requests,
  scoring, quoting. Once a trip is accepted and moves to dispatch/ops
  (Step 18's Trip creation), it needs its own dashboard for the
  dispatch team, distinct from the sales queue. Natural fit for the
  already-planned `/trips` route once Trip records exist — nothing to
  build yet since there's no Trip data until Step 16 (accept) → 18
  (trip creation) land. Also relevant to the brief's role hierarchy
  (Sales vs. Dispatch as distinct operator roles) — may eventually
  want role-based routing/defaults, not just a shared nav link.

- **Automate flight/repositioning time calculation** (raised after
  Step 13; shipped after Step 13.5 once the user provided the airport
  dataset). Quote Builder is now leg-based and self-computing:
  - `Airport` table seeded with 10,420 real airports (OurAirports
    dataset, user-provided) — icao/iata/name/lat/lon/elevation
  - `lib/geo.ts` — haversine great-circle distance + estimated flight
    hours (`distance / cruiseSpeedKts + defaultBlockTimeBufferHours`)
  - `AirportCombobox` — searchable, autofilling airport picker
    (`lib/airport-server.ts`'s `searchAirports`, debounced, ICAO/IATA/
    name prefix match)
  - Quote Builder renders one editable row per leg (dep, arr, date,
    flight hours, revenue-vs-repositioning), prefilled from the trip
    request's requested legs plus auto-added repositioning legs
    (home base → first departure, last arrival → home base — skipped
    entirely when they'd be a 0nm no-op, e.g. aircraft already at the
    departure airport)
  - Flight hours auto-recompute live as airports/aircraft change,
    unless the user directly edits a leg's hours (marks it "dirty";
    a "Reset to auto" link reverts it)
  - "Returns to home base" toggle: on (default) adds the trailing
    return leg, no overnight fee; off drops that leg and
    auto-calculates nights away from the gaps between requested legs'
    dates (`nightsBetween` in `lib/geo.ts`), billed at
    `defaultOvernightFee`/night, with an editable "additional nights"
    field for open-ended cases
  - `Quote.itinerary` now stores the full per-leg breakdown (billAs,
    airports, date, flightHours) instead of a single repeated total;
    old quotes created before this shipped are read back
    compatibly (missing `billAs`/`date` default to revenue/derived
    from `depDt`)
  Known gap: the live airport search-as-you-type couldn't be verified
  in this sandbox (no route to the live Neon DB locally, same
  limitation as everywhere else in this project) — the math and
  layout were verified with mocked airport data instead. Worth a
  quick smoke test on the deployed app: type a partial ICAO/name into
  a leg's airport field and confirm results appear.
  Not done: repositioning always assumes `Aircraft.homeBase`, never
  `currentBase` (the "updated as trips complete" field already in the
  schema) — so back-to-back trips don't yet chain repositioning from
  wherever the aircraft actually ended up last. Also, opportunity
  scoring's positioning logic is still qualitative text, not tied to
  this new hours math yet.

- **"Options" — multiple priced itinerary variations per quote** (raised
  after Step 13.5, made an explicit pre-ops priority directly: "one
  quote can have 3 different options"). Decided direction: one `Quote`
  (single client-facing token/thread) gets N child `QuoteOption` rows —
  functionally "a variants array on one quote," implemented relationally
  rather than as a raw JSON blob so conflict-checking, Stripe, and every
  existing query stay type-safe and indexable. `Quote.selectedOptionId`
  points at whichever option is "active" for booking purposes.
  **Phase 1 — shipped**: schema migration (`QuoteOption` model,
  `Quote.selectedOptionId`) plus every read/write call site
  (`lib/booking-server.ts` conflict-checking/`finalizeBooking`/
  `resendCardHoldLink`, the Quote Builder create/edit server actions,
  the internal-trip shortcut, `/q/[token]`, the Quoting Queue, the
  dashboard, `score-opportunity.ts`'s aircraft-busy check) redirected to
  read/write through `quote.selectedOption`. Purely structural and
  backward-compatible — the migration backfills exactly one
  `QuoteOption` per existing quote with its current values, so nothing
  already sent/accepted/paid changes behavior; every quote still behaves
  as single-option until Phase 2/3 ship. A mapping pass before writing
  the migration found two housekeeping items worth noting: `Quote.
  aiPriceSuggestion`/`aiPriceReasoning` appear unused anywhere in the
  codebase (the real AI price suggestion lives on `TripRequest`) —
  carried over into `QuoteOption` as-is rather than dropped, in case
  they're meant for later; and `wholesaleCost`/`brokerMargin` similarly
  have no UI reads/writes yet (no brokered-cost entry form exists) —
  also carried over unchanged.
  **Phase 2+3 — shipped together** (built as one unit — Phase 2 alone
  would have let an operator send a 2-option quote with no way for the
  client to ever see or pick the second one). Confirmed via
  `AskUserQuestion` before building: options are fully independent (own
  aircraft/itinerary/pricing each, not just alternate pricing on one
  aircraft), authored via tabs, and picking one silently retires the
  others rather than formally "declining" each with its own record.
  - **Quote Builder** (`components/quote/quote-builder-form.tsx`): the
    pre-Options single-option state/logic is untouched — extracted
    as-is into an inner `QuoteOptionFields` component that still owns
    its own aircraft/legs/pricing state via local `useState`, exactly
    as before. The outer `QuoteBuilderForm` renders one
    `QuoteOptionFields` instance per option inside a single shared
    `<form>`, all mounted simultaneously; switching tabs only toggles
    CSS visibility (`hidden` class), never unmounts, so in-progress
    edits on any tab survive tab-switching without lifting state up
    into the parent. Each instance's fields are namespaced
    (`option_0_*`, `option_1_*`, ...) so one submission carries every
    option — HTML forms include `display:none` descendants in
    submission, so hidden tabs' fields still post normally. "+ Add
    Option" seeds a new option from the trip's original requested legs
    with no aircraft/pricing pre-filled; "Remove option" drops any but
    the last one; tab labels are editable inline.
  - **New `lib/quote-option-server.ts`**: `parseOptionFromFormData`/
    `parseOptionCount`, shared by `createQuote` (`quotes/new`) and
    `updateQuote` (`quotes/[id]`) to parse N options out of one
    submission (previously each page inlined this parsing for a single
    implicit option). `updateQuote` deletes and recreates the whole
    option set on every save rather than diffing which tab is "the
    same" option as before — safe because nothing references
    `QuoteOption.id` by foreign key except `Quote.selectedOptionId`
    (Trip and the Stripe hold reference `Quote` directly), so a fresh
    set of IDs every save has no downstream consequence.
  - **Client-facing** (`app/q/[token]/page.tsx`): a new "Choose an
    option" picker renders above the itinerary/pricing detail whenever
    a `sent` quote has more than one option — cards show each option's
    label, route, aircraft, and total; selecting one calls a new
    `selectOption` server action that updates
    `Quote.selectedOptionId`. Only shown while still `sent` (before the
    client has committed to anything) — once they click "Request to
    Book," the pick is locked in and everything downstream (operator
    review, signature, Stripe, `finalizeBooking`) proceeds against
    whichever option they chose, identically to how a single-option
    quote always has.
  - **Known minor gaps, not blocking**: the draft-quote "review before
    sending" preview (`SendQuoteGate`) still only previews the first
    option's route/total, not all of them, before the operator clicks
    Send — the actual send still includes every option correctly, this
    is just the preview pane. The "Send Quote" email drops the
    misleading single total for multi-option quotes ("N pricing
    options to choose from" instead) but doesn't otherwise summarize
    them. Both cosmetic, worth a follow-up pass if it comes up in
    practice.

- **AI profitability / margin analysis on quotes** (raised after Step
  13.5): the user wants the AI layer to surface how profitable a trip
  actually is, not just suggest a sell price. What exists today:
  `lib/ai/suggest-price.ts` recommends a total price using the
  aircraft's hourly rate, positioning, and quote history — no cost
  basis at all, so it can't compute margin. `lib/ai/score-opportunity.ts`
  (Quoting Queue's score badges) is also cost-blind — it only reasons
  about availability/positioning/history, not profitability, despite
  the original build brief's illustrative example text ("est. margin
  38%") suggesting otherwise; that number was never actually
  implemented. To do this for real needs a real operating-cost basis
  per aircraft (fuel burn, maintenance reserve, crew cost, insurance/
  hangar amortized per hour, etc.) that doesn't exist in the schema
  yet. The user's own instinct is right: this is a natural fit for
  Phase 2.4 (Owner Monthly Settlement Statements), which will already
  need per-aircraft cost data to compute owner settlements — build the
  cost model once, use it for both. Once that data exists, `suggest-
  price.ts` and `score-opportunity.ts` could both be extended to
  reason about margin, not just sell price.

- **Create vs. Send Quote page — deeper redesign** (raised as a UX
  question, not a firm spec — "open to your thoughts"). The immediate
  confusion ("why does hitting Create Quote just show me the same
  page again") is mostly resolved now: newly created quotes correctly
  land in the dashboard's Draft tab (see the fix below), and the
  quote detail page now says outright "Saved as a draft — edit
  anything below, then send when ready." But the deeper ask — making
  the create and send stages feel like genuinely different screens,
  not the same form with a button added — is still open. Worth
  considering once Step 15 (client quote page) exists and we can see
  the whole lifecycle end to end: e.g. a lighter-weight "review"
  layout for a freshly-created draft (pricing summary up front,
  fields collapsed until touched) vs. the current dense edit form,
  or a distinct confirmation step between Create and Send.

- **Quoting Queue: Draft/Sent/Accepted tabs now show real quotes**
  (fixed): these tabs used to be hardcoded placeholders ("the quote
  builder lands in a later step") even though the Quote Builder has
  existed since Step 13 — so a created draft had nowhere to appear
  except buried in All Requests under the parent trip request's
  "quoted" status. `QuoteQueue` now receives the operator's `Quote`
  rows alongside `TripRequest` rows and renders them per status
  (quote number, requestor, route, total, a status-appropriate action
  label). Follow-up fix: these were initially plain link rows, not
  wired into the same selection model as TripRequest rows — the user
  caught this ("the UI and UX needs to be uniform") and it's now
  unified: quote rows are selectable via click or `j`/`k` exactly like
  trip requests, with their own right-side pane (Continue Draft/Delete
  Draft for drafts, View/Mark Declined for sent). Also fixed in the
  same pass: list rows (both kinds) were stealing `Tab` focus from the
  top-level view tabs, which fought with `j`/`k` for list movement —
  rows are now excluded from the tab order (`tabIndex={-1}`) so `Tab`
  stays a clean left-to-right pass across the dashboard's tabs/filters
  and `j`/`k` is the only way to move through a list.
  Known gap, since closed: declining a sent quote (or a client
  declining by email) used to move it out of every visible tab with no
  way to see where it went — fixed by the combined "Inactive" tab noted
  elsewhere in this file (covers both `declined` and `cancelled`).
  `expired` still isn't a real status anywhere in the schema (checked
  computed on the fly from `validUntil`, not stored) — the brief's full
  Draft/Sent/Accepted/Declined/Expired/Passed list is otherwise
  covered now.

- **Pricing profiles per aircraft, by client type** (raised after
  Step 14): the user wants different rates for the same aircraft
  depending on who's asking — e.g. a direct-client rate vs. a broker
  rate, rather than the single flat `hourlyRate`/`repoRate` on
  `Aircraft` today. Not scoped yet — open questions before building:
  is this just direct-vs-broker (matches `requestorType`, simplest),
  or arbitrary named tiers an operator defines themselves (more
  flexible, more UI)? Is a profile per-aircraft or an operator-wide
  default with per-aircraft overrides? Straw-man data model: a new
  `AircraftPricingProfile` (aircraftId, clientType, hourlyRate,
  repoRate) that the Quote Builder looks up by the trip request's
  `requestorType` when an aircraft is selected, falling back to the
  aircraft's base rate if no profile matches. Fleet management would
  need a UI to manage profiles per tail.

- **Escape key in the Quote Builder → back to dashboard, saving work**
  (raised after Step 14): Escape now navigates back on every page
  *except* the quote builder (`components/escape-to-back.tsx`,
  rendered in `app/(app)/layout.tsx` — explicitly excludes
  `/dashboard`, which handles Escape itself, and `/quotes`, for the
  reason below). Inside `/quotes/new` or `/quotes/[id]` there's still
  no keyboard way back, because — this is the real ask — there's no
  autosave, so navigating away on an accidental Escape (e.g. while
  just trying to close a dropdown) would silently discard unsaved
  pricing changes. Two things to design before building: (1) autosave
  itself — the existing `createQuote`/`updateQuote` server actions
  already persist the full form state, but they also each call
  `redirect()` to the quote detail page internally, so invoking them
  from an Escape handler wouldn't land back on the dashboard, it'd
  land on `/quotes/[id]` (which does at least mean edits are never
  lost — same outcome, different destination than asked for); (2)
  whether every keystroke should debounce-autosave in the background
  (real autosave) vs. only saving on the explicit Escape-to-leave
  gesture (simpler, matches what was actually asked for). Leaning
  toward (2) for a first pass — lower risk of surprising partial
  saves — but flagging both since it changes how "draft" status
  should be interpreted (a true autosave means there's no unsaved
  state to lose in the first place).

- **Operator/broker onboarding game plan** (raised directly — JetDeck
  is a multi-tenant SaaS, not a single-operator app; domain is
  jetdeck.us): today only one tenant, "Clarity Aviation, LLC," has
  working inbound (Postmark) and outbound (Resend) email — set up
  manually. Every new operator or broker who signs up will need their
  own inbound trip-request address and outbound sending domain
  configured before they can use JetDeck for real. Not scoped or
  built yet — this is a planning flag, not a build item. Open
  questions to work out before designing it: does each operator get a
  subdomain under jetdeck.us (e.g. `requests@clarityaviation.jetdeck.us`,
  simplest, fully self-service, no DNS work on the operator's end) or
  their own domain (more "native" feel in their inbox, but requires
  the operator to add DNS records — SPF/DKIM for Resend, MX/inbound
  routing for Postmark — either themselves or with JetDeck support
  walking them through it)? Does onboarding happen through a
  self-service flow in Settings (operator pastes/verifies their own
  domain) or is it always support-assisted for now given how few
  operators there are today? Whatever's decided needs to slot into
  the existing Clerk organization signup flow (`organization.created`
  webhook) so a new org lands in a clear "email not yet configured"
  state rather than silently failing to receive trip requests.
