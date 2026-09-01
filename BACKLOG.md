# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

- ~~**Reorder legs in the Quote Builder — shipped, iterated twice on UI
  in one day**~~ (raised directly). Three passes, each on direct feedback:
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

- ~~**Overnight nights not updating when editing a leg's date — likely
  root cause found and fixed**~~ (raised directly: "adjusting the
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

- ~~**AI-extracted dates picking random years — fixed**~~ (raised directly:
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

- ~~**Two-step booking flow — shipped**~~ (raised directly: "I think we need
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

- ~~**Manually-added overnight nights dropped on save/reload — fixed**~~
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

- ~~**Client-visible notes on quotes — shipped**~~ (raised directly: "need a
  way to add notes for the client to see on the quote"). New
  `Quote.clientNotes` field (migration
  `20260811160000_quote_client_notes`), distinct from the existing
  `internalNotes` (operator-only, never shown to the client) — a
  "Notes for client" textarea in the Quote Builder, saved by both
  `createQuote`/`updateQuote`, and rendered in its own "Notes" section
  on `/q/[token]` (only when non-empty) between the itinerary and
  pricing sections.

- ~~**Dashboard was pulling unbounded data on every load and every poll —
  fixed**~~ (raised directly after hitting Neon's data-transfer/egress
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

- ~~**"Route unknown" on internal/owner trips — fixed**~~: the quote detail
  page header, the dashboard queue list row, and the queue side pane all
  computed the route summary from `quote.tripRequest.legs`, which is
  `null` for internal trips (Log Internal Flight has no `TripRequest` at
  all — see the earlier internal-trip-creation item). Even though the
  itinerary legs were entered and saved correctly, the summary line
  always fell back to a hardcoded "Route unknown" string instead of
  reading `quote.itinerary`. Fixed all three spots to fall back to
  `routeSummary(revenueLegsOf(quote.itinerary), "multi_leg")` when
  there's no `tripRequest`.

- ~~**Original-request panel was missing the email subject — fixed**~~:
  routing is frequently stated in the subject line (e.g. "TEB-PBI
  9/15") rather than the body, and the operator needs to eyeball it
  against what the AI extracted — but `TripRequest` never stored the
  subject, and `OriginalRequestPanel` only rendered `rawEmailBody`.
  Fixed by looking up the originating `InboundEmail` row (via its
  `tripRequestId` link, which is already set when
  `createTripRequestFromInboundEmail` runs) and passing its `subject`
  into a new `rawEmailSubject` prop, rendered as its own line above the
  body in both `/quotes/new` and `/quotes/[id]`.

- ~~**Airport city/state under ICAO on the client quote page — shipped
  ("ITEM 1")**~~: user sent the OurAirports source CSV. Added
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

- ~~**Log Internal Flight — Trip creation without the client quoting
  pipeline**~~ (raised directly, for owner flights/maintenance/
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

- ~~**Overnight/repositioning logic overhaul — shipped, including the
  reload gap**~~ (raised directly, explicitly called "imperative").
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
  **Follow-up — reload gap closed**: reopening an already-saved quote
  used to only recognize the leading/trailing repositioning legs as
  auto-managed — any "between legs" repositioning leg a quote was
  built with reloaded as a plain manual leg instead, so toggling the
  checkbox off on a reopened quote wouldn't auto-remove them. Fixed in
  `components/quote/quote-builder-form.tsx`'s reload mapping: every
  repositioning leg is now recognized as auto-managed, and any one
  that isn't the very first or last row is tagged `betweenLegs: true`
  — by construction, the toggle only ever inserts repositioning legs
  internally (bracketing a gap between two revenue legs), so position
  alone reliably identifies them. `homeSide` for an internal leg is
  derived by checking which endpoint (dep or arr) matches the current
  aircraft's home base, mirroring how `makeRepoLeg` originally built
  the pair, rather than assuming a fixed position like the boundary
  legs can.
  Still unchanged: editing a revenue leg's airports/dates after the
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

- ~~**Live double-booking warning in the Quote Builder**~~ (raised directly:
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

- ~~**Cancelled/declined quotes had no dashboard tab — fixed**~~: cancelling
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

- ~~**Arrival time now flags a day change — shipped**~~: a long or
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

- ~~**Outbound email gaps — internal notify missing on inbound trip
  requests, inconsistent Reply-To — fixed**~~: two issues found doing an
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

- ~~**Airport dataset gaps (KUAO, KOEB) — root cause found and fixed, but
  worth a second look**~~: the original import (10,463 rows) silently
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
- ~~**HAVE:/NEED: pre-filter is a single hardcoded prefix, watch for other
  non-request patterns in real feed traffic**~~: after connecting a real
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
- ~~**AI triage cost — needs a live test**~~ (raised when asked how to cut
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
  the distance-tiered scoring still reasons from `Aircraft.currentBase`/
  `homeBase`, which is only as fresh as the last manual update — there's
  no real-time "where is this tail right now" data source. Out of scope
  for a quick fix (would need a real ADS-B/fleet-tracking integration);
  flagging remains, not attempted.
  ~~The range/reachability check only looked at the first requested leg,
  not the full multi-leg itinerary~~ — **fixed**: found while chasing a
  separate, more serious repositioning bug (see below). Every leg's
  distance is now checked, and the aircraft filter uses the longest one,
  so a multi-leg trip that's fine outbound but exceeds range on a later
  leg is correctly excluded instead of slipping through.

- ~~**Opportunity scoring: the 2-hour repositioning cap stopped actually
  filtering anything — fixed**~~ (user-reported: "it does not appear to
  be using that 2 hour repositioning time from the aircraft's location.
  That two hour filter should still be there on top of the changes we
  made"). A screenshot showed every single trip request scoring
  "medium — positioning distance is unknown," regardless of route —
  the tell that this wasn't the ranking-priority change misbehaving,
  it was every distance calculation failing outright. Root cause in
  `lib/ai/score-opportunity.ts`: `anchorsToResolve` (the batch of
  airports resolved for pickup/dropoff distance math) only collected
  each aircraft's own gap-boundary airports — never the trip request's
  own dep/arr airports, which `repoHoursBetween` also needs to look up
  distance *to*. That lookup missed every time, `pickupHours` came back
  null on every request, and the null branch returns "medium" without
  ever reaching the 2-hour cap check — so the cap had silently stopped
  doing anything. Fixed by adding `firstLeg.depAirport`/
  `lastLeg.arrAirport` to the resolved set.
  Second, related fix found in the same pass: the cap was only ever
  checked against the final dropoff-ranked winner, not applied before
  ranking — so in principle an aircraft requiring an enormous
  repositioning to even reach the client could still win the ranking
  purely by having a great next-position fit, since nothing excluded it
  from the candidate pool first. `REPO_MEDIUM_HOURS` is now a hard
  pre-filter (`withinPickupRange`) applied before the dropoff-priority
  sort runs, matching what was actually asked: the cap gates which
  aircraft are eligible, the dropoff-priority ranking only decides
  among whichever of those remain.
  Trip requests already scored under the broken code keep their stale
  "medium — positioning unknown" result until re-scored — the fix only
  applies to newly-scored requests. Offered to build a "re-score"
  action for the existing queue; not yet requested.

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
- ~~**Double-booking now actually blocks instead of just warning after the
  fact**~~ (raised directly — two clients booking the same aircraft/dates):
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
- ~~**Client quote page — terms-hash snapshotting — shipped**~~ (raised
  while building Step 15/16): `acceptedTermsHash` used to be computed
  at accept time from whatever `operator.termsText` currently held,
  not from a snapshot taken when the quote was sent — an operator
  editing their charter terms in Settings between sending a quote and
  the client accepting it would silently change both what the client
  saw and what the hash claimed they'd agreed to. Fixed exactly as
  scoped: new `Quote.termsTextSnapshot` (migration
  `20260815100000_quote_terms_snapshot`), captured in `sendQuote`
  (`app/(app)/quotes/[id]/page.tsx`) the moment a draft goes out.
  `/q/[token]`'s Charter Terms section, `TermsAcceptGate`, the
  `acceptedTermsHash` computation, and the confirmation email's
  "Charter terms you agreed to" section (`lib/booking-server.ts`) all
  read `quote.termsTextSnapshot ?? operator.termsText` now — falling
  back to the live text only for quotes sent before this field
  existed.
- ~~**Resend card hold link — shipped**~~ (raised directly): Stripe Checkout
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

- ~~**Stripe card hold (Step 17) + Trip creation (Step 18) — shipped**~~:
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
  **Live-tested and confirmed working** (this couldn't be tested from
  the sandbox — no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` there,
  same limitation as Postmark/live-DB testing elsewhere in this
  project — so this only got exercised once the user set it up for
  real on the deployed app). Getting there took three separate fixes,
  worth recording since the failure mode looked identical each time
  ("our team will follow up" instead of a real link) but the causes
  were all different:
  1. **Webhook URL hit a redirect.** The user's `jetdeck.us` apex
     domain 308-redirects to `www.jetdeck.us`, and the webhook was
     registered against the apex — Stripe doesn't follow redirects for
     webhook delivery, so every event delivery silently failed. Fixed
     by pointing the webhook at `https://www.jetdeck.us/api/webhooks/stripe`
     instead.
  2. **Env var wasn't scoped to what's actually being tested against.**
     Vercel logs showed every request to `jetdeck.us` running under
     `"environment":"preview"` — the domain is pinned directly to this
     git branch rather than the project's Production branch, so it
     serves Preview builds. `STRIPE_SECRET_KEY` had only been checked
     for Production. Fixed by also checking Preview (with the "Git
     Branch" restriction field left blank, since Vercel won't let a
     branch-restricted variable also target Production in the same
     entry).
  3. **The real bug**: `createCardHoldCheckoutSession` (`lib/stripe.ts`)
     required `session.payment_intent` to be present before returning
     a link, on the assumption Checkout Sessions in `mode: "payment"`
     populate it eagerly. Confirmed via a live session pulled from the
     Stripe dashboard that current API versions don't — it comes back
     `null` until the customer actually reaches checkout, even on an
     otherwise fully successful session creation. This silently
     discarded a perfectly good checkout URL every single time. Fixed
     by only requiring `session.url`, falling back to the Checkout
     Session id (always present immediately) as the tracked
     `stripePaymentIntentId` when the real PaymentIntent id isn't known
     yet. New `checkout.session.completed` handler in
     `app/api/webhooks/stripe/route.ts` upgrades the stored id to the
     real PaymentIntent id once checkout completes, so the existing
     `payment_intent.*` handlers keep matching correctly from there.
     Requires `checkout.session.completed` added to the webhook's
     subscribed events in the Stripe dashboard (the original three
     `payment_intent.*` events were already subscribed) — flagged to
     the user, not yet confirmed done.
  Confirmed working end-to-end after all three: real checkout link in
  the confirmation email, Stripe's test card
  (`4000 0025 0000 3155`, any future expiry/CVC/ZIP) authorizes
  successfully.

- ~~**Immediate-checkout redirect + deferred confirmation email + terms
  display bug — shipped**~~ (raised directly, right after confirming the
  card hold worked end-to-end): three related fixes to the booking
  flow's final steps.
  1. Signing ("I Accept — Book This Charter") now redirects the
     browser straight into Stripe Checkout in the same session instead
     of only ever emailing a link — an emailed link is an easy thing
     to ignore right after the client already committed to signing.
     `finalizeBooking` (`lib/booking-server.ts`) returns
     `{ cardHoldUrl }`; `acceptQuote` (`app/q/[token]/page.tsx`)
     redirects there directly, falling back to the quote page only
     when there's no deposit due or Stripe isn't configured.
  2. The client's confirmation email no longer sends at signature time
     when a deposit is due — it used to promise a card hold link that
     might never get opened. Split into a new, reusable
     `sendBookingConfirmationEmail` (`lib/booking-server.ts`): sent
     immediately only when there's nothing to wait for (no deposit, or
     Stripe unconfigured); otherwise deferred to fire from the new
     `checkout.session.completed` webhook handler once the client
     actually finishes authorizing their hold — looked up via
     `session.metadata.quoteId` directly rather than
     `stripePaymentIntentId`, sidestepping a possible ordering race
     against the `payment_intent.*` events. The email itself never
     mentions a Stripe link anymore either way — by the time it sends,
     the hold is already authorized (or was never going through
     Stripe to begin with). Guarded by a new
     `Quote.confirmationEmailSentAt` against double-sending, since
     Stripe redelivers webhooks on retry.
  3. Fixed a real bug: the client quote page was showing the full
     Charter Terms section right after "Request to Book" — status
     `pending_confirmation`, nothing signed yet. Terms should only
     ever appear at the actual signature step (already handled inline
     by `TermsAcceptGate` during `approved`) and afterward as a record
     on `accepted` quotes.
  Still open: `checkout.session.completed` needs to be added to the
  webhook's subscribed events in the Stripe dashboard (the original
  three `payment_intent.*` events were already there) for both the
  `cardHoldStatus` correction and the new deferred-email trigger to
  actually fire — flagged to the user, not yet confirmed done. Also
  not built: if a client abandons the Stripe Checkout tab without
  completing it, there's no client-facing self-service way back in
  (the copy on `/q/[token]` tells them to contact the operator, who
  can already use the existing "Resend card hold link" button) — a
  client-side "resume checkout" button would close this gap but wasn't
  asked for yet.

- ~~**Buy a domain + finish Postmark setup**~~ (raised after Step 13):
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

- ~~**Aircraft photos + expanded amenities — shipped**~~: `Aircraft.hasWifi`
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

- ~~**Automate flight/repositioning time calculation**~~ (raised after
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

- ~~**"Options" — multiple priced itinerary variations per quote**~~ (raised
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

- ~~**Quoting Queue: Draft/Sent/Accepted tabs now show real quotes**
  (fixed)~~: these tabs used to be hardcoded placeholders ("the quote
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

- ~~**Cash-on-account payment terms — shipped**~~ (raised directly,
  alongside the CRM-timing question below): new `Contact.paymentTerms`
  field (`"standard"` | `"cash_on_account"`), toggled from a new,
  deliberately minimal `/contacts` page (list + one button per row —
  no add/edit/delete, no activity history, nothing CRM-shaped beyond
  what this one field needed). `finalizeBooking`/
  `sendBookingConfirmationEmail` (`lib/booking-server.ts`) check the
  quote's linked contact and skip the Stripe card hold entirely for a
  cash-on-account client, same as if no deposit were due — their
  `Trip` starts as `"confirmed"` instead of `"awaiting_payment"` since
  there's no hold to wait on, and the confirmation email says "billed
  on account" instead of either the authorized-hold or
  manual-follow-up copy.

- **CRM module — not started, explicitly deferred** (raised directly:
  "is this the appropriate time to begin building the CRM part of
  JetDeck?"). Answered no for now — the cash-on-account need above
  only required one field on the existing `Contact` model, not a new
  module. A real CRM phase would be substantially bigger: contact
  activity/interaction history (every quote/trip/email tied to a
  client, not just the current one-way `Contact → TripRequest/Quote`
  links), client-specific rate cards or pricing tiers, tags/segments
  for targeted outreach, maybe a lightweight deal/pipeline view
  distinct from the Quoting Queue's operational focus. Worth its own
  scoping pass (data model options, what "activity" even means across
  the existing tables) whenever there's appetite for it — flagging
  now so it's on the list, not building it yet.
  **Follow-up, since shipped**: the Contacts page itself was rebuilt
  ("I do not like the contacts page the way that it is... I would
  prefer to be able to click into the contacts and manage their
  information and in there set payment terms") — `/contacts` is now a
  plain list, each row linking to a real `/contacts/[id]` detail/edit
  page (firstName/lastName/email/phone/company/type/paymentTerms/notes,
  same edit-and-redirect pattern as `/fleet/[id]`). Still not a full
  CRM — no activity history, rate cards, or tagging — but it's real
  CRUD now, not the bare view-plus-toggle described above.

- ~~**Website Widget — lead-capture embed for operator websites**~~
  (raised directly: "how to do I add the lead capture tool/flight
  request onto my website at www.flyclarity.com... each operator will
  need a tool on their website"). The `/intake/[operatorSlug]` form
  page already existed but was never surfaced anywhere in the app —
  confirmed it has no headers blocking iframing before recommending
  it. Added a "Website Widget" section to Settings
  (`app/(app)/settings/page.tsx`) showing the direct link
  (`${appUrl}/intake/${operator.slug}`) plus copyable embed snippets
  (a plain link and an iframe), each with a `CopyLinkButton`. Works
  automatically for every operator via their own `slug` — no
  per-operator configuration needed beyond what Settings already
  shows.

- ~~**Stripe Connect migration — shipped**~~. Raised directly, right
  after confirming the single-account Stripe integration works
  end-to-end: the current setup (one global `STRIPE_SECRET_KEY`) only
  worked because there was exactly one operator (Clarity Aviation) and
  their Stripe account happened to be that key. The moment a second
  operator signed up, their clients' card holds would have landed in
  Clarity's Stripe account, not theirs. Decided direction (user
  confirmed): **Stripe Connect**, Express accounts specifically —
  Stripe-hosted onboarding (operator links their own bank account
  through a Stripe-hosted flow, minimal custom UI needed), each
  operator's checkout sessions route funds directly to their own
  connected account via destination charges
  (`on_behalf_of`/`transfer_data.destination`), which also gets
  real per-operator branding on the Checkout page for free once
  connected. Built: new `Operator.stripeAccountId`/
  `stripeChargesEnabled`/`ccProcessingFeePercent` fields (migration
  `20260813060000_stripe_connect`); `lib/stripe.ts` gained
  `createConnectedAccount`/`createConnectOnboardingLink`/
  `createConnectDashboardLoginLink`, and
  `createCardHoldCheckoutSession` now takes an optional
  `connectedAccountId` that adds `on_behalf_of`/
  `transfer_data.destination` to the payment intent when present; a
  new "Payments" section in Settings (Connect Stripe / Finish
  Onboarding / Open Stripe Dashboard buttons, driven by
  `operator.stripeChargesEnabled`/`stripeAccountId`); the Stripe
  webhook gained an `account.updated` handler that syncs
  `stripeChargesEnabled` from `account.charges_enabled`; and
  `finalizeBooking` (`lib/booking-server.ts`) now passes the
  operator's connected account through whenever charges are enabled,
  falling back to the platform key otherwise (same
  degrade-gracefully pattern used for a missing `STRIPE_SECRET_KEY`
  elsewhere).
  Still open: the user needs to add `account.updated` to the
  webhook's subscribed events in the Stripe dashboard, and complete
  Stripe Connect onboarding for Clarity Aviation itself (their
  current Stripe account is now the platform key, not an individual
  operator account) — flagged, not yet confirmed done.

- ~~**Wire vs. credit card payment method choice — shipped**~~. Raised
  directly alongside Connect, then refined through two rounds of
  clarification once Connect actually shipped — the built design ended
  up meaningfully different from the original one-or-the-other framing:
  1. **A card hold is authorized either way** (unless the linked
     Contact is cash-on-account, which still skips Stripe entirely, no
     change there). Paying by wire, the hold is just backup security
     for the plain amount; paying by credit card, the hold *is* the
     payment, so the operator's `ccProcessingFeePercent` surcharge
     (Settings, default 3%) gets added on top — confirmed directly: "a
     credit card hold/information is still required, unless... that
     client is exempt."
  2. **Wire confirmation is a manual operator action, not automatic on
     selection** — confirmed directly: "the flight should be confirmed
     immediately if wire is received." New "Mark Wire Received" button
     on the quote detail page (`markWireReceived` in
     `lib/booking-server.ts`) sets `Quote.wireConfirmedAt`, flips the
     linked Trip to `"confirmed"`, and releases the now-unneeded backup
     hold via a new `cancelCardHold` in `lib/stripe.ts`
     (`stripe.paymentIntents.cancel`). A credit-card payer's hold IS
     the payment, so there's no equivalent manual step for them.
  3. **Client-facing wording deliberately avoids "deposit"** — corrected
     directly: "Lets not refer to it as a deposit it is paying for the
     flight." Every client-visible surface (the payment-method picker
     on the sign step, the pricing line item, the accepted-status
     banner, the confirmation email) says "payment for your flight"
     instead. Internal field/config names (`depositAmount`,
     `depositPercent`) were left as-is — operator-only, not part of
     what was raised.
  New `Quote.paymentMethod` ("wire" | "credit_card", chosen alongside
  the signature in the rebuilt `TermsAcceptGate`), `Quote.
  cardHoldAmount` (the actual dollar amount held — snapshotted at
  creation so it stays accurate even if the operator's fee % changes
  later; reused as-is by "Resend card hold link" rather than
  recomputed), and `Quote.wireConfirmedAt` (migration
  `20260815090000_quote_payment_method`). The payment-method picker
  itself is skipped entirely when there's nothing to pay up front or
  the client is cash-on-account — same `needsPaymentMethod` gate on
  both the client page (enforced server-side in `acceptQuote`) and the
  component that renders the choice.

- ~~**Client notes moved from Quote to QuoteOption — shipped**~~ (bug
  raised directly): "Notes for client" was still quote-wide after
  Options shipped — one shared field instead of being specific to
  whichever priced itinerary variation it was written for (e.g.
  catering notes for one aircraft option bleeding into a different
  option on the same quote). `Quote.clientNotes` moved to
  `QuoteOption.clientNotes`; the Quote Builder field moved from the
  outer form into `QuoteOptionFields` (per-tab, namespaced like every
  other option field); the client quote page now reads it off the
  selected option. Migration backfills each existing quote's note onto
  all of its options (no way to know which option it was "meant" for
  once a quote already has more than one — preserves the content
  rather than dropping it).

- ~~**Opportunity scoring rebuilt around an aircraft gap timeline —
  shipped**~~ (raised directly, with real examples: an aircraft sitting
  at KMYL 8/20–23 waiting for its return leg, a week-long Florida trip,
  a one-way with nothing booked after). The old model
  (`lib/ai/score-opportunity.ts`) treated "has a trip during this
  window" as roughly synonymous with unavailable — `isAircraftBusy`
  only checked for an exact-date collision, and ranking only ever
  measured distance from `Aircraft.currentBase`, a single stored
  snapshot rather than a real schedule. That's backwards from how
  charter dispatching actually works: every gap in an aircraft's
  schedule is a selling opportunity to fill, not a reason to bury
  matching requests — the operator wants to see everything that fits
  geographically into where the plane already is (or is about to be)
  and where it needs to go next, and rank it by how well it keeps the
  aircraft productively moving.
  New model: every confirmed leg (revenue or repositioning) across all
  of an aircraft's active trips gets flattened and sorted
  chronologically into a sequence of **gaps** — each bounded by where
  the aircraft arrives from (`startAnchor`) and where it needs to
  depart from next (`endAnchor`: the following leg's departure
  airport, or home base if nothing else is booked). A multi-day trip's
  own sitting period between two of its legs, a one-way with nothing
  booked after, and a fleet with zero bookings at all all fall out of
  the same model with no special-casing needed. An incoming request is
  scored against whichever gap its full date range fits inside — if it
  doesn't fit any gap cleanly (would require bumping something already
  confirmed), that aircraft is excluded, same spirit as before but now
  actually correct about *why*.
  Ranking priority was a direct design decision, not assumed:
  productive repositioning outranks cheap pickup — candidates are
  sorted primarily by how well the request's dropoff point sets up the
  gap's end anchor (closer to where the plane needs to be next wins),
  falling back to pickup distance as a tiebreaker only when dropoff
  quality ties. The high/medium/auto-pass tier itself still keys off
  pickup distance alone against the original, unchanged thresholds —
  deliberately conservative, so the auto-pass aggressiveness doesn't
  shift, only which aircraft/gap combination wins and how it's
  explained.
  The "conflicts with a confirmed trip on `<tail>`" pass reason is now
  "would require rescheduling an existing booking" — broader and more
  accurate, since a request can now fail to fit for reasons beyond a
  single exact-date collision (e.g. spanning across a gap boundary).

- ~~**Client quote page — modern font + cleaner layout — shipped**~~
  (raised directly: "I want more of a simple modern font and layout so
  when they are looking at the quote it looks clean. But lets keep all
  operator font what we have now."). Scoped entirely to `/q/[token]`
  — the operator dashboard's JetBrains Mono is untouched. New
  `app/q/layout.tsx` loads Inter and scopes it to this route tree via
  a wrapping div (`font-[family-name:var(--font-inter)]`), rather than
  touching the root layout or `globals.css`, so nothing else in the
  app is affected. Visual refresh on `/q/[token]` and
  `TermsAcceptGate` (same client-facing flow): `rounded-2xl` card with
  a subtle shadow instead of a flat bordered box, more generous
  padding/section spacing, quieter section labels, a bolder pricing
  total, `rounded-xl` throughout instead of the sharper `rounded-md`
  used elsewhere. Purely visual — no booking logic, data binding, or
  conditional flow touched. User confirmed: "WOW thats beautiful."

- ~~**Production migration: live Stripe + Clerk Production instance —
  shipped**~~ (raised directly: "I am getting ready to move away from
  the test key for JetDeck"). Clarity Aviation moved off test-mode
  credentials for both Stripe and Clerk — the two identity/payment
  providers this app depends on. One real code fix came out of it;
  the rest was operator-side configuration, recorded here since the
  failure modes hit along the way are exactly what the next operator
  migration (or the next environment) will probably hit too.
  **Code fix**: `createConnectedAccount`/`createConnectOnboardingLink`
  (`lib/stripe.ts`) had no try/catch, unlike every other Stripe call in
  the file — a rejected request threw unhandled out of the "Connect
  Stripe" server action and crashed the whole Settings page instead of
  failing gracefully. Both now log and return `null` on failure;
  `startStripeOnboarding` redirects to `/settings?stripe_error=1` on
  either failure path, and Settings renders a visible red banner in the
  Payments section instead of a dead page. This is what turned every
  subsequent Stripe misconfiguration below into a readable message
  instead of a crash.
  **What actually went wrong, in order** (each one distinct, worth
  knowing about since they look identical from the client-page
  symptom alone):
  1. Test-mode `Operator.stripeAccountId`/`stripeChargesEnabled`
     don't carry over when `STRIPE_SECRET_KEY` switches to live —
     Stripe test/live are separate account spaces. Cleared via a
     one-off SQL update (`UPDATE "Operator" SET "stripeAccountId" =
     NULL, "stripeChargesEnabled" = false WHERE id = ...`) so
     "Connect Stripe" would create a fresh live-mode account instead
     of erroring against a dead test-mode id.
  2. First live key tried was a **restricted key**
     (`rk_live_...`), missing the `connected_account_write`,
     `accounts_kyc_basic_read`, and `business_network_profile_read`
     permissions Connect account creation needs. Decided to switch to
     the standard `sk_live_...` secret key instead of hand-tracking
     restricted-key permissions across every Stripe feature this app
     uses (Checkout, Connect, PaymentIntents).
  3. The Vercel env var update to the standard key didn't actually
     take the first time — `STRIPE_SECRET_KEY` was still serving the
     old restricted key (by then revoked in the Stripe dashboard,
     surfacing as `api_key_expired`) even after a redeploy. Re-saving
     it for real fixed this.
  4. Once the correct key was live, Stripe's own fraud/risk system
     temporarily blocked connected-account creation on the platform
     account ("suspicious activity") — almost certainly triggered by
     the repeated Connect-account-creation attempts while debugging
     steps 1–3 in quick succession on a brand-new live account.
     Resolved entirely on Stripe's side (dashboard confirmation), no
     code or config change needed.
  **Separately, Clerk**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` was still
  `pk_test_...` (Clerk's Development instance) even though the app was
  live on a custom domain — Development instances don't reliably
  support the session handshake against a custom domain, which
  surfaced as `MIDDLEWARE_INVOCATION_FAILED` (a 500 from
  `middleware.ts`'s `clerkMiddleware`) the moment a real sign-in
  redirect landed back on the app. Fixed by creating a Clerk
  **Production** instance, verifying the custom domain via the DNS
  records Clerk provides, and swapping in the resulting `pk_live_`/
  `sk_live_` keys. Since Clerk's Development and Production instances
  are entirely separate user/org databases, the operator had to sign
  up fresh under Production — which would have created a second,
  empty `Operator` row via the `organization.created` webhook
  (`app/api/webhooks/clerk/route.ts`) rather than reusing the real one
  with all its Fleet/Contacts/quote history. Avoided with one more
  targeted SQL update, keyed by name rather than copy-pasted ids to
  avoid transcription errors:
  ```sql
  DO $$
  DECLARE new_org_id text;
  BEGIN
    SELECT "clerkOrgId" INTO new_org_id FROM "Operator" WHERE name = 'DOPA Jets Inc.';
    DELETE FROM "Operator" WHERE name = 'DOPA Jets Inc.';
    UPDATE "Operator" SET "clerkOrgId" = new_org_id WHERE name = 'Clarity Aviation, LLC';
  END $$;
  ```
  (deleting the duplicate before updating, since `clerkOrgId` is
  unique and both rows briefly holding the same value would violate
  that). Confirmed via `SELECT` afterward: one `Operator` row,
  original id and data intact, new Clerk org id attached.

- ~~**Client-facing email links show friendly anchor text instead of the
  raw URL — shipped**~~ (raised directly): "Your quote is ready:
  https://www.jetdeck.us/q/abc123..." read as a wall of URL rather
  than a clean link. Three client-facing emails were showing the raw
  link as the visible anchor text — the send-quote email
  (`app/(app)/quotes/[id]/page.tsx`), the resend-card-hold-link email
  and the operator-confirmed-availability email (both
  `lib/booking-server.ts`) — now read "View Quote," "Authorize Card
  Hold," and "Finalize Your Booking" respectively. Operator-facing
  notification emails (to `notifyEmail`) were left as raw links
  on purpose — not what was raised, and an operator may actually want
  the plain URL visible/copyable there.

- ~~**Credit card payment still said "hold" instead of "charge" —
  shipped**~~ (raised directly: "when they select credit card it
  still refers to it as hold... they are paying the full amount via
  credit card, not a 'hold'"). The wire path was already correct
  (a card hold really is just backup security there) — the credit
  card path's copy hadn't been updated to match, even though the
  underlying amount/fee math was already right. Fixed in
  `TermsAcceptGate` (the payment-method description and the
  "authorize the ... described above" disclaimer line), the
  accepted-status banner on `/q/[token]` (`quote.cardHoldStatus ===
  "authorized"` now reads "Your payment is confirmed" for credit
  card, vs "Your backup card hold is authorized" for wire), and the
  confirmation email's payment line in `lib/booking-server.ts`
  ("charged to your card" instead of "card hold authorized"). No
  change to the actual Stripe mechanism (still a manual-capture hold
  either way, per the existing capture-later design) — this was
  purely a client-facing wording fix, matching what was actually
  asked.

- ~~**Auto-expire stale, unconfirmed requests/quotes past their flight
  date — shipped**~~ (raised directly: "Can the system purge
  requests/quotes that have not been accepted/confirmed after the
  date of the flight for that request has passed?"). Confirmed via
  `AskUserQuestion` before building: mark as expired and keep the
  data (reversible, preserves reporting history), not a hard delete.
  New `lib/expire-stale.ts`, run daily by a Vercel Cron Job hitting
  `/api/cron/expire-stale` (registered in a new `vercel.json`,
  protected by a `CRON_SECRET` bearer-token check so the endpoint
  can't be triggered by anyone who finds the URL):
  - `TripRequest`s still sitting in `"new"`/`"ready"` — never even
    quoted — whose last requested leg date has passed get set to a
    new `"expired"` status. Deliberately scoped to only those two
    statuses: once a request has a `Quote` (`"quoted"`), its fate is
    tracked through that quote instead, so expiring the request too
    would be redundant.
  - `Quote`s still in `"draft"`/`"sent"`/`"pending_confirmation"`/
    `"approved"` whose selected option's last itinerary leg date has
    passed also get set to `"expired"` — `Quote.status` already
    anticipated this value in its schema comment (previously only
    ever computed live from `validUntil` on `/q/[token]`, never
    actually stored); this is a different trigger (the flight date
    itself, not the pricing offer's shelf life) now stored for real.
  Wired into the existing Quoting Queue UI rather than a new surface:
  a new `"Expired"` entry in `STATUS_FILTERS` (alongside Active/
  Passed/Inactive) shows expired trip requests with its own count
  badge, and `"expired"` was added to `INACTIVE_QUOTE_STATUSES` so
  expired quotes fold into the existing "Inactive" tab alongside
  declined/cancelled ones rather than getting a redundant tab of
  their own. `/q/[token]`'s `isExpired` flag (already driving the
  status pill and the "this quote has expired" client message) now
  also treats the stored `"expired"` status as expired, so no new
  branch was needed there — it already did the right thing once the
  flag recognized the new case.

---

## Ops Build Brief (v1.0) — reprioritized start

User supplied a companion Ops Build Brief (trip lifecycle, manifest
collection, crew assignment, checklist, communications, post-flight
close, squawks, owner updates — full step order in the brief itself,
Steps 21–33 continuing from the Sales Brief's Steps 1–20). Two things
worth recording before the first module's entry below, since they
affect everything after it too:

- **`Trip.status`'s existing schema comment doesn't match the brief's
  proposed flow** — today: `"confirmed" | "awaiting_payment" |
  "ops_review" | "crew_assigned" | "pre_flight" | "in_flight" |
  "completed" | "invoiced" | "closed"`. The brief adds
  `manifest_pending`/`manifest_complete`/`released` and three
  cancellation variants (`cancelled_by_client`/`cancelled_by_operator`/
  `cancelled_weather`) that aren't in the current enum. Not
  reconciled yet — still open, needs doing whenever Trip model
  expansion (the brief's Step 21) actually happens.
- **Reprioritized**: the brief's own step order builds Trip fields →
  Crew roster → Ops Dashboard → Crew assignment → Checklist before
  ever reaching Passenger Manifest (Steps 26–28), even though the
  brief itself calls that module "the highest-priority... directly
  solves the biggest operational pain identified." User asked to
  move it up. Done as a standalone slice rather than literally
  reordering the numbered steps — see below.

- ~~**Passenger manifest collection — shipped (moved up ahead of Crew/
  Dashboard/Checklist)**~~: built as a self-contained slice rather
  than following the brief's step order, since its own trigger
  (`CREW_ASSIGNED` status) depends on a Crew module that doesn't
  exist yet. Decoupled the trigger instead — the manifest link now
  goes out **the moment a Trip is created** (`finalizeBooking`, right
  at the sales→ops handoff), which is strictly earlier than the
  brief's own design and needs nothing else built first. Skipped
  entirely for internal trips (owner flights, maintenance,
  repositioning — `quotes/internal/new`), since those are created
  directly by the operator, who already knows who's aboard.
  New models exactly as specified in the brief (`Passenger`,
  `ManifestReminder`, migration `20260817090000_passenger_manifest`),
  with one addition: `@@unique([tripId, type])` on
  `ManifestReminder` so the reminder sweep can `upsert` instead of
  needing its own duplicate-check query.
  - **`lib/manifest.ts`**: `createManifestForTrip` (seeds the lead
    `Passenger` row from `Quote.contact`/`tripRequest`, since
    `Passenger` itself has no email field — matching the brief's own
    schema — and emails the manifest link) and `sendManifestReminders`
    (the 72/48/24/12hr sweep, run by a new daily Vercel Cron,
    `/api/cron/manifest-reminders`, same `CRON_SECRET` bearer-auth
    pattern as the expire-stale cron). Departure timing is computed
    from the Quote's existing itinerary data (`revenueLegsOf` +
    a new `departureInstantUtc` helper in `lib/time.ts`, timezone-aware
    via the departure airport's `Airport.timezone`) rather than
    waiting on the Step 21 Trip date fields that don't exist yet.
    First deploy attempt used an hourly schedule and failed outright —
    the Vercel plan on this project only allows daily crons, so
    `manifest-reminders` runs once a day instead. Always checks actual
    hours-until-departure rather than assuming how recently it last
    ran, so a threshold just fires a bit late instead of not firing.
  - **`/manifest/[token]`**: public, no login, mirrors the `/q/[token]`/
    `/intake/[operatorSlug]` pattern. Every passenger (lead or
    additional) gets their own token; `isLead` controls whether the
    page shows just that person's own form or the whole trip's
    roster with an "+ Add Another Passenger" action (capped at the
    aircraft's `seats`) and forwardable per-passenger links
    (`CopyLinkButton`, reused from the quote-link work). ID photo
    upload reuses the exact `@vercel/blob` `put()` pattern from
    Aircraft photos.
  - **Minimal operator UI** (`/trips`, `/trips/[id]`) — Trip records
    existed in the database with no operator-facing page at all
    before this; building manifest visibility required *some* home
    for it, so a bare-bones list + detail page was built now rather
    than waiting for the brief's full board-view Ops Dashboard
    (Step 23). Detail page: passenger list with submission/ID
    status, a Verify toggle (`verifiedAt`/`verifiedBy`), and a "Print
    Manifest" link. New `lib/trip.ts` for `Trip.status` labels,
    matching the existing `lib/queue.ts` pattern for `TripRequest`.
    This becomes the seed the real Ops Dashboard later expands into,
    not a permanent replacement for it.
  - **PDF download**: the brief asks for "Download manifest as PDF."
    Built as a clean, chrome-free print view instead
    (`/trips/[id]/manifest-print`, deliberately outside the `(app)`
    layout group so it has no nav header) that the operator can
    Ctrl+P → Save as PDF from — same practical outcome (a copy for
    the trip file) without pulling in a PDF-generation dependency.
    Worth swapping for real server-generated PDFs later if the print
    step turns out to be friction in practice.
  Not built yet (still open, per the brief's own later steps): Crew
  roster/assignment, the full Ops Dashboard board view, pre-flight
  checklist, automated trip-status-driven communications beyond the
  manifest emails, post-flight close, squawk logging, owner updates,
  invoice generation.

## Ops Build Brief (v1.0) — three follow-up fixes on the manifest slice

- ~~**Cancelled bookings kept showing as active Trips — fixed**~~: the
  operator's "Cancel booking" action (`app/(app)/quotes/[id]/page.tsx`,
  `cancelBooking`) has always set `Quote.status = "cancelled"`, but
  never touched the `Trip` row created for it back in `finalizeBooking`
  — so a cancelled booking just sat on `/ops/trips` looking like any
  other live trip forever. Fixed two ways: `cancelBooking` now cascades
  `Trip.status = "cancelled"` (added to the status enum comment in
  `prisma/schema.prisma` and to `lib/trip.ts`'s `STATUS_LABELS`, no
  migration needed — still an unconstrained string column); and the
  Trips list query also filters on `quote: { status: { not:
  "cancelled" } }` as a belt-and-suspenders self-heal, so any Trip rows
  already stuck from before this fix disappear from the list
  immediately without needing a one-off DB update.
- ~~**Trips list route showed only start→end — fixed**~~: a multi-stop
  or round trip (e.g. KTEB → MIA → KTEB) collapsed to `KTEB → KTEB`,
  since the list only ever read `legs[0]` and `legs[last]`. Now chains
  every leg's airports (`legs[0].depAirport, ...legs.map(arrAirport)`)
  so the full routing shows.
- ~~**Ops moved to a genuinely separate dashboard, not a Trips tab —
  shipped**~~: was a single "Trips" link inside the sales-side nav
  (`(app)/layout.tsx`); the user wanted actual separation. New `(ops)`
  route group (`app/(ops)/layout.tsx`) with its own header/nav — "JETDECK
  OPS" branding, a "← Sales" link back, room to add Crew/Checklist/etc.
  links later — same Clerk org/session as the sales side, not a new
  login (asked the user directly: same-login-different-nav vs.
  role-gated access; went with the former since a
  permission/role concept doesn't exist on Operator users yet and
  wasn't asked for). Everything moved under a real `/ops` URL prefix
  rather than staying at bare `/trips`, so future ops modules (Crew,
  Dashboard board view, Checklist) have a natural home without another
  URL migration: `/ops` (redirects to `/ops/trips` — the only module
  today), `/ops/trips`, `/ops/trips/[id]`, and
  `/ops/trips/[id]/manifest-print` (still outside the `(ops)` group,
  same as before, so the print view stays chrome-free).
  `middleware.ts`'s route matcher swapped `/trips(.*)` for `/ops(.*)`.
  The sales nav's old "Trips" link is now "Ops →", pointing at `/ops`.

## Collapsible left sidebar + Sales/Ops switcher

- ~~**Horizontal top nav → collapsible left sidebar, with an Apple-style
  Sales/Ops segmented switcher — shipped**~~: both `(app)/layout.tsx`
  and `(ops)/layout.tsx` had their own separate `<header>` with a
  horizontal link row (duplicated nearly verbatim between the two).
  Replaced both with one shared client component,
  `components/app-sidebar.tsx`, rendered by each layout instead of its
  old header. The sidebar itself derives which nav items to show
  (`Dashboard`/`Fleet`/`Contacts`/`Needs Review`/`Settings` vs. just
  `Trips` for now) from whether the current pathname starts with
  `/ops` — no separate "mode" prop needed, the URL is already the
  single source of truth, which also drives the segmented control's
  active side. `needsReviewCount`/`showFleet` are still computed
  server-side in `(app)/layout.tsx` (unchanged queries) and passed
  down as props since those need the DB.
  - Collapse state persists across reloads via `localStorage`, read
    through `useSyncExternalStore` rather than `useState` +
    `useEffect` — the effect-based version tripped this repo's
    `react-hooks/set-state-in-effect` lint rule (calling `setState`
    synchronously inside an effect body), and `useSyncExternalStore`
    is the more correct tool for "read from an external store, avoid
    an SSR/client snapshot mismatch" anyway: it renders the server
    snapshot (`false`, i.e. expanded) until hydration finishes, then
    swaps to the real stored value with no manual mount-guard needed.
  - Collapsed width is icon-only (`lucide-react` icons, already a
    project dependency); expanded shows icons + labels. The Sales/Ops
    switcher collapses to single-letter "S"/"O" tabs rather than
    disappearing, so mode-switching still works collapsed.
  - `OrganizationSwitcher`/`UserButton` (Clerk) moved from each header
    into the sidebar footer; `OrganizationSwitcher` itself is hidden
    when collapsed (it doesn't have a sane icon-only form), `UserButton`
    always shows since it's already just an avatar.
  - Not visually verified in an authenticated browser — this sandbox
    has no `.env.local` (no live Clerk keys or `DATABASE_URL`), so
    only `tsc`/`eslint`/`next build` and an unauthenticated dev-server
    boot (confirms no build-time crash) were possible here. Worth a
    once-over on the live deploy, especially the collapsed-state icon
    layout and the segmented control's sliding highlight.
- ~~**Org name spilling outside the sidebar — fixed**~~: exactly what
  the "not visually verified" note above was worried about — the user
  caught it on the live deploy. Clerk's `OrganizationSwitcher` trigger
  has no built-in max-width, so "Clarity Aviation, LLC" rendered at
  its natural width and visually spilled out past the sidebar's right
  edge into the main content area instead of wrapping/truncating.
  Fixed by actually clipping it rather than trusting Clerk to size
  itself: `overflow-hidden` added to the `<aside>` itself and to the
  footer row (belt-and-suspenders — CSS overflow clipping doesn't
  care what's inside it, so it holds regardless of Clerk's internal
  DOM), plus an `appearance.elements` override on
  `OrganizationSwitcher` (`organizationSwitcherTrigger:
  "w-full max-w-full overflow-hidden"`,
  `organizationPreviewMainIdentifier: "truncate"`) so the org name
  itself truncates with an ellipsis instead of just getting clipped
  mid-character.
- ~~**Collapsed Sales/Ops switcher cramped + dashboard filter bar
  overflowing behind buttons — fixed**~~: two more things the user
  caught on the live deploy. (1) The collapsed sidebar's Sales/Ops
  switcher packed "S" and "O" side-by-side into a `grid-cols-2` inside
  a 56px rail — barely enough room for either letter, let alone both,
  and read as garbled/overlapping. Now renders as two full-width
  stacked rows when collapsed (only the expanded state keeps the
  side-by-side pill with the sliding highlight). (2) The dashboard's
  filter/tab row (`components/queue/quote-queue.tsx`) already had
  `overflow-x-auto` on the tabs container, but was missing `min-w-0` —
  a classic flexbox gotcha where a flex item won't actually shrink
  below its content's natural width (and so `overflow-x-auto` never
  engages) unless `min-width: 0` overrides the default `min-width:
  auto`. That bug predates the sidebar, but only became visible once
  the sidebar ate ~224px of horizontal room the top nav never
  permanently claimed — narrower windows now show it overlapping the
  "+ Log Internal Flight"/"+ New Quote" buttons instead of scrolling.
  One-line fix: `min-w-0` added to that container.
- ~~**Sidebar reverted back to a top nav, keeping the Sales/Ops
  switcher — shipped**~~: after living with it, the user decided
  against the left sidebar overall (not any specific bug — the shape
  itself). `components/app-sidebar.tsx` deleted; new
  `components/app-header.tsx` replaces it as what both `(app)` and
  `(ops)` layouts render, restoring a horizontal header bar (same
  general shape as before the sidebar existed) but keeping the
  Apple-style Sales/Ops segmented switcher this whole detour was
  chasing in the first place — now living next to the wordmark instead
  of at the top of a sidebar. Same pathname-driven mode detection as
  the sidebar had (`/ops(.*)` → Ops), so no behavior changed, only the
  chrome shape. The `min-w-0` dashboard-filter-bar fix and the
  `OrganizationSwitcher` overflow-clipping fix from the sidebar detour
  both stay — they're real bugs independent of nav shape.

## Ops Build Brief — Crew roster + assignment (Steps 22/24, folding in Step 21)

- ~~**Crew roster + assignment — shipped**~~: next module after
  Passenger Manifest, per the user's pick from the remaining Ops Build
  Brief items (Crew roster/assignment, Ops Dashboard board view,
  checklist, communications, post-flight close, squawks, invoicing,
  owner updates). Deliberately minimal roster — no duty-time/currency
  tracking, type ratings, or a scheduling calendar, matching the
  brief's own explicit deferral of those as later modules; this is
  just enough to put a name on a trip.
  - New `CrewMember` (name, role, email, phone, active) and
    `TripCrewAssignment` (join table, `roleOnTrip` snapshots
    `CrewMember.role` at assignment time rather than always reading
    the live role, so changing someone's default role later doesn't
    rewrite history on trips they already flew) models, migration
    `20260818090000_crew_roster`. `lib/crew.ts` for the
    `CREW_ROLES` constant (captain/first officer/flight attendant/
    other) and a label helper, matching the `lib/aircraft.ts` pattern.
  - Roster CRUD at `/ops/crew` (list), `/ops/crew/new`,
    `/ops/crew/[id]` (edit + active/inactive toggle) — same
    server-action-in-a-Server-Component pattern as Fleet's aircraft
    pages. Added to the Ops nav in `components/app-header.tsx`.
  - Assignment lives on the trip detail page
    (`/ops/trips/[id]`): a new Crew section between Itinerary and
    Passenger Manifest, listing assigned crew with a Remove button and
    a picker (active, not-already-assigned crew only) to add more.
    Assigning crew upserts a `TripCrewAssignment`
    (`@@unique([tripId, crewId])`, so re-assigning the same person is
    a no-op rather than an error) and bumps `Trip.status` to
    `"crew_assigned"` — but only when the trip is still in a
    pre-crew status (`confirmed`/`awaiting_payment`/`ops_review`), so
    re-assigning crew on a trip that's already further along (e.g.
    in-flight) never regresses it. This is also what makes
    `"crew_assigned"` a real status for the first time — it's existed
    in `Trip.status`'s documented enum since the passenger-manifest
    work but nothing set it until now.
  - Folded in Step 21 (the `Trip.status` schema mismatch flagged when
    the Ops Build Brief kicked off): the schema comment now documents
    the brief's full proposed status set
    (`manifest_pending`/`manifest_complete`/`released`, and
    `cancelled_by_client`/`cancelled_by_operator`/`cancelled_weather`
    replacing the plain `"cancelled"` the auto-expire cascade used
    before). Renamed the one cancellation path that actually exists
    (`cancelBooking`'s cascade) to `"cancelled_by_operator"`. The
    other new statuses are documented but deliberately **not** wired
    to any transition yet — there's no client-initiated or
    weather-cancellation flow, and no manifest-driven or release/
    closeout flow, to hang them on. Same pattern as `"expired"` before
    it: comment-first, wired in once the feature that needs it
    actually gets built.
  - Small parity additions elsewhere: `/ops/trips` list gets a Crew
    column (assigned names, or "Unassigned"); the print manifest
    (`/ops/trips/[id]/manifest-print`) now lists crew under the
    itinerary, matching what a real dispatch manifest would show.
  - Not built: any actual scheduling/availability view (who's free
    when), duty-time/rest tracking, type ratings/currency, or crew
    self-service (crew don't get their own login or a way to see
    their own assignments — this is entirely an ops-side roster
    today).
- ~~**Fixed a bug from the crew commit: `cancelled_by_operator` rename
  was only in the schema comment, not the actual code**~~: caught
  while checking the codebase before starting the board. The BACKLOG
  entry and `Trip.status` schema comment both claimed
  `cancelBooking`'s cascade had been renamed from `"cancelled"` to
  `"cancelled_by_operator"` — it hadn't; the write path, `lib/trip.ts`'s
  `STATUS_LABELS` key, and the `/ops/trips` list filter were all still
  using the old value, just the doc comment had drifted ahead of the
  code. Fixed for real this time: the cascade now writes
  `"cancelled_by_operator"`, `STATUS_LABELS` has both keys (new value
  plus `cancelled` kept mapped for any trip cancelled before this fix
  shipped), and the `/ops/trips` filter excludes both values so
  already-cancelled trips don't reappear.

## Ops Build Brief — Ops Dashboard board view (Step 23)

- ~~**Ops Board — shipped**~~: next pick after Crew (user: "there are a
  few items for the crew stuff but they are larger items that might
  be easier to work in later. Lets go ahead with 23" — crew feedback
  deferred, not yet actioned). Before this, nothing in the app ever
  actually set a trip to `ops_review`, `pre_flight`, `in_flight`, or
  `completed` — those statuses have existed in `Trip.status`'s
  documented enum since Passenger Manifest, completely unreachable.
  The board is what makes them real.
  - `/ops/board`: one column per stage in a new ordered
    `TRIP_STAGES` constant (`lib/trip.ts`) — `awaiting_payment` →
    `confirmed` → `ops_review` → `crew_assigned` → `pre_flight` →
    `in_flight` → `completed`. Excludes `invoiced`/`closed`/
    `cancelled_by_operator`, matching `/ops/trips`' existing filter —
    those trips are done with this pipeline. No drag-and-drop (no
    dnd library in the project, and pulling one in for a first cut
    felt like the wrong tradeoff) — each card gets "← Back"/"Next →"
    buttons that step it one stage in `TRIP_STAGES`, disabled at
    either end. Deliberately doesn't gate advancing past
    `crew_assigned` on actually having crew assigned — the stage name
    is aspirational/pipeline position, not a hard requirement; the
    Crew section on the trip detail page stays the real source of
    truth for who's actually on the trip.
  - Cards show route, departure date, assigned crew (or
    "Unassigned"), and manifest submission count where applicable —
    same data as the `/ops/trips` list, reused for at-a-glance
    scanning without opening each trip.
  - `/ops` now redirects to `/ops/board` instead of `/ops/trips` — the
    board is the real ops home now. `/ops/trips` (the flat list) and
    the new "Board" nav link both stay; the list is still useful for
    scanning/sorting, no reason to remove something already built and
    working.
  - Not built: any archiving/graduation out of the `Completed` column
    (it'll just accumulate until Post-flight close/Invoicing exist to
    move trips out of the active pipeline), and no manual override
    that skips stages or jumps non-sequentially — only one step at a
    time, forward or back.
- ~~**Cancelled trips leaking onto the board — fixed**~~: user caught
  it right after the board shipped. `/ops/trips`' list query has
  carried a `quote: { status: { not: "cancelled" } }` belt-and-
  suspenders filter since the original cancel-cascade bug (a Trip
  whose Quote was cancelled without the status ever cascading onto
  the Trip row itself), but the new board query only filtered on
  `Trip.status` — the same guard never got copied over when the board
  was built. Added it.

## Board/Crew round of feedback

Six items from testing the Board + Crew work. Two (crew qualifications/
availability, and outbound email landing in spam) needed scoping/
diagnostic questions back to the user rather than a same-pass fix —
see the open questions at the end of this entry.

- ~~**Sales/Ops switcher's active pill touched the container's edge —
  fixed**~~: the sliding white indicator behind "Sales"/"Ops"
  (`components/app-header.tsx`) had `inset-y-1` for top/bottom but no
  horizontal anchor at all — `left` was left to whatever "static
  position" fallback the browser computed for an absolutely
  positioned element with no explicit `left`/`right`, instead of the
  intended 4px inset matching the pill's own `p-1`. Added `left-1`
  explicitly so it's actually anchored the same as the visible Sales/
  Ops text is.
- ~~**Crew picker dropdown text overflowing past its box, crowding the
  Assign button — fixed**~~: `/ops/trips/[id]`'s crew-assignment
  `<SelectTrigger>` had a fixed `w-64` but no `overflow-hidden`, and
  the `<SelectValue>` had no `truncate` — a longer "Name (Role)"
  string (e.g. "Andrew Harnetiaux (Captain (PIC))") just spilled past
  the box's right edge instead of being contained. Added
  `overflow-hidden` to the trigger and `min-w-0 truncate` to the
  value — same class of flex-truncation gotcha as the dashboard
  filter-bar bug from the sidebar detour.
- ~~**Quote and Trip had separate identifiers — fixed**~~: `Quote`
  generated its own `Q-2026-XXXX` sequence, `Trip` generated a
  completely separate `T-2026-XXXX` sequence at booking time — the
  same charter had two different numbers depending on whether sales
  or ops (or the client) was looking at it. `finalizeBooking` and the
  internal-trip creation path now set `Trip.tripNumber` to the
  quote's own `quoteNumber` directly instead of calling a separate
  generator — one identifier for the whole lifecycle. `lib/trip-
  server.ts` (`generateTripNumber`) deleted, now fully unused.
- ~~**Removing crew didn't drop a trip back off "Crew Assigned" —
  fixed**~~: `assignCrew` bumps `Trip.status` forward to
  `"crew_assigned"`, but `unassignCrew` never moved it back — a trip
  with zero crew left could still sit in the board's Crew Assigned
  column looking staffed. `unassignCrew` now checks the remaining
  assignment count after removal; if it hits zero and the trip is
  still exactly at `"crew_assigned"` (not further along), it steps
  back one stage in `TRIP_STAGES` (to `"ops_review"`) rather than
  leaving a crewless trip stuck showing as staffed.
- ~~**Aircraft Year of Manufacture / Year of Refurbishment — shipped**~~:
  new optional `yearOfManufacture`/`yearOfRefurbishment` Int fields on
  `Aircraft` (migration `20260818120000_aircraft_yom_yor`), added to
  the Fleet add/edit forms alongside the other spec-sheet fields
  (range, cruise speed). Not added to the Fleet list table (already
  wide) or the client-facing quote page — scoped to "under fleet" as
  asked; can surface elsewhere later if wanted.

**Open, needs the user's input before proceeding:**
- **Crew availability/qualifications/currency/addresses**: explicitly
  out of scope when Crew roster shipped (matching the brief's own
  deferral), and the user separately flagged Crew feedback as "larger
  items... easier to work in later." Holding rather than guessing at
  scope — availability/scheduling (a calendar of who's free when) is
  a materially bigger feature than adding static fields
  (qualifications, currency expiry dates, address) to `CrewMember`.
- **Client email replies landing in spam**: `lib/email.ts`'s send
  path looks correct (proper `Reply-To`, display name) — nothing
  code-side jumps out. This sandbox has no network access to check
  DNS (SPF/DKIM/DMARC) for the sending domain, and that's the most
  common real-world cause of exactly this symptom. Asked the user to
  check the sending domain's verification status in Resend's
  dashboard, and which mailbox is actually seeing the spam flag.

Follow-ups from testing the above:
- **Reply-to-quote spam**: confirmed it's the *operator's own* inbox
  flagging the client's reply, not the client's. A Gmail screenshot
  showed the telltale "kym@independentjets.info via flyclarity.com"
  sender tag — Gmail's label for a message not DKIM-authenticated by
  the domain it claims to be from, routed instead through the
  visible-domain's own infrastructure. `app/api/webhooks/postmark/
  route.ts` has a comment confirming the mechanism: the operator's
  real inbox address is set up to route through an
  `inbound.<domain>` address Postmark actually monitors, for the AI
  triage pipeline — so a plain reply with nothing to do with triage
  takes the same relay hop as a new trip request, and that hop is
  almost certainly what breaks DKIM alignment for the original
  sender. Not something the codebase alone can confirm or fix — the
  actual mail-routing configuration (Google Workspace routing rule?
  DNS MX straight at Postmark with a forward back to Gmail?) lives
  outside the repo. Asked the user to check how that routing is
  actually configured before deciding whether this needs an app-side
  change (e.g., not routing plain replies through the triage
  pipeline) or a DNS/routing fix on their end.
- ~~**Sales/Ops switcher pill still touching the edge, now on the Ops
  side — fixed for real this time**~~: the `left-1` fix from the
  previous round anchored the untransformed (Sales) position
  correctly, but the indicator's width (`calc(50% - 0.25rem)`) only
  accounted for one 4px inset — the left one. Once `translateX`
  slides it over for Ops, that math lands its right edge exactly at
  the container's right edge (0 gap) instead of the intended matching
  4px inset, because a `translateX(100%)` shift is relative to the
  element's own width, and reaching a symmetric mirror position needs
  the width to leave room for both the outer edge inset *and* the
  gap in the middle — `calc(50% - 0.375rem)`, not `calc(50% -
  0.25rem)`. Worked through the pixel math explicitly this time
  (documented in the component) rather than adjusting by feel.

## ACH as a third payment option

- ~~**ACH bank transfer, still requiring the backup card hold —
  shipped**~~: user asked whether ACH was possible instead of wire;
  discussed the tradeoff (ACH can't do an authorize-then-capture hold
  the way a card does — it's a real direct debit with a multi-day
  settlement window, so it can't reuse the same Checkout Session as
  the hold) and landed on adding it as a third option alongside wire/
  credit card, keeping the card hold requirement for all three.
  - `Quote.paymentMethod` now accepts `"ach"`. New `achPaymentIntentId`/
    `achPaymentStatus` ("pending"|"processing"|"succeeded"|"failed")/
    `achConfirmedAt` fields (migration `20260818140000_quote_ach_
    payment`) track the ACH payment as its own Stripe PaymentIntent,
    entirely separate from the card hold's `stripePaymentIntentId`/
    `cardHoldStatus`.
  - `lib/stripe.ts`: new `createAchPaymentCheckoutSession` — plain
    automatic-capture `mode: "payment"` Checkout Session with
    `payment_method_types: ["us_bank_account"]`, no CC processing fee
    (that only ever applies to an actual credit-card payment). Also
    requests the `us_bank_account_ach_payments` capability when
    creating a *new* Connect account — existing already-onboarded
    operators won't get it retroactively and may need to redo
    onboarding before ACH will actually work on their account; not
    verified against a live Stripe account from here.
  - Flow: signing still redirects straight into the card-hold
    checkout immediately, same as today, for all three payment
    methods — a Checkout Session can only ever resolve to one
    PaymentIntent, so the ACH payment can't be bundled into that same
    redirect. Once back on `/q/[token]` with the hold authorized, an
    ACH payer sees a new "Pay via ACH" button (`startAchPayment` in
    `lib/booking-server.ts`) that creates the second session and
    redirects there — a manual second step, not automatic chaining.
  - Confirmation is fully automatic via webhook
    (`payment_intent.succeeded` → `confirmAchPayment`), unlike wire's
    manual "Mark Wire Received" button — Stripe itself is the bank
    feed here. Releases the backup hold and moves the Trip to
    "confirmed", same as `markWireReceived` does for wire.
    `payment_intent.processing` and `payment_intent.payment_failed`
    drive the intermediate/failure states shown to both the client
    and the operator.
  - **Requires a Stripe Dashboard change**: the webhook endpoint needs
    `payment_intent.processing` and `payment_intent.payment_failed`
    added to its subscribed events (`payment_intent.succeeded` was
    almost certainly already subscribed, so ACH confirmation itself
    would still work without this — only the "processing"/"failed"
    intermediate status displays would silently never update).
  - Not built: no ACH-specific fee passthrough (Stripe's ACH fee is
    small — 0.8%, capped at $5 — cheap enough that eating it seemed
    reasonable, but easy to add a surcharge later if wanted), and no
    resend mechanism if a client needs a fresh ACH link (unlike the
    card hold's "Resend card hold link" button) — the client just
    clicks "Pay via ACH" again from their own quote page, no
    operator action needed.

## Round of quick fixes + one open diagnostic

- ~~**YOM/YOR shown to the client — shipped**~~: `/q/[token]` now
  shows "YOM 20XX"/"YOR 20XX" next to the aircraft description
  (spurred by an actual client emailing to ask, per the spam-triage
  investigation earlier) — reuses `Aircraft.yearOfManufacture`/
  `yearOfRefurbishment` from the Fleet fields shipped a few rounds
  ago, no schema change needed.
- ~~**Quote Builder: changing an airport left ETE/ETA stuck on the old
  manual override — fixed**~~: `updateLeg`'s dirty-flag system (an
  intentional design — once someone manually overrides ETE or arrival
  time, further edits stop silently clobbering it, so tweaking a date
  doesn't blow away a real ATC-delay adjustment) never cleared on a
  dep/arr airport change specifically. Changing the airport makes it a
  materially different leg, so any override from the old routing
  shouldn't keep blocking the recompute — now `dirty`/`arrTimeDirty`
  both clear when either airport changes, no "Reset" click needed.
  Date/time edits still respect an existing override, by design —
  flagged this distinction back to the user since their report also
  mentioned "departure times," which this fix doesn't touch; asked for
  a concrete repro if that's still happening after this fix before
  changing the time-edit behavior too (which risks defeating the
  override entirely).
- ~~**Overnight nights not updating when an earlier leg's date changes
  — fixed**~~: two separate implementations of the same "nights away"
  calculation existed — the Quote Builder's own live one (sorts leg
  dates before summing consecutive gaps, specifically to handle a leg
  edited out of chronological order) and `autoNightsAwayOf` in
  `lib/itinerary.ts` (used only to split a *saved* quote's persisted
  total back into its auto/extra portions on reload), which iterated
  legs in raw array order with no sort. Editing an earlier leg's date
  can leave the array chronologically out of order without affecting
  which element is array-first; the unsorted version then handed
  `nightsBetween` a negative span for that pair, which it silently
  clamps to 0 — under-counting on reload even though the in-form total
  was already right when it was saved. Ported the same sort into
  `autoNightsAwayOf`.
- ~~**Leg reorder arrows moved outside the leg's border — shipped**~~:
  were the first child inside each leg card's own bordered box;
  restructured so `legMoveButtons` renders as a sibling of the
  bordered div instead of a child of it, in both the expanded and
  collapsed (repositioning-leg) leg layouts.
- ~~**Search added to the request/quote queue — shipped**~~: a text
  box (name, company, quote #, or airport) now filters whichever
  list/tab is currently showing — applies everywhere, not just
  "Sent," since the same need (find one thing in a long list) applies
  to every tab.
- **Stale "Sent" quotes past their departure date — open,
  investigating**: the cron this describes
  (`expireStaleRequestsAndQuotes`) already covers exactly this case —
  draft/sent/pending_confirmation/approved quotes past their last leg
  date get marked "expired," which the "Sent" tab already excludes.
  Nothing wrong found in the logic on review. Added an unconditional
  log line to `/api/cron/expire-stale` (same pattern as the Postmark
  webhook's own always-log line) so a future check of Vercel's
  function logs can show whether it's actually running and what it's
  finding — no visibility existed before this. Couldn't verify further
  from this sandbox (no access to production logs or the DB); asked
  the user to check the Vercel dashboard's Cron Jobs tab (can be
  manually triggered from there) or share a concrete example (which
  quote, what departure date) to narrow down further.

## App-wide command palette

- ~~**Global search, "/" to open — shipped**~~: the tab-local search box
  shipped a round earlier only ever searched whatever list the
  dashboard queue currently had loaded (Quotes/Trip Requests) — the
  user asked for something app-wide instead, discussed building it
  now vs. deferring until more modules exist (recommended now: adding
  a new entity type later is a small additive change to the search
  endpoint, not a rearchitecture, and there's no real "end" to defer
  to in an actively-evolving build), and went with building it now.
  Replaces the tab-local box entirely (removed) rather than keeping
  both.
  - `app/api/search/route.ts`: one endpoint, `getTenantContext()`
    resource-based auth (Clerk's own recommended pattern — see
    `lib/auth.ts` — since middleware path matchers can drift out of
    sync; added `/api/search` to the matcher anyway for consistency
    with how every other protected route is listed there). Queries
    Quotes, Trip Requests, Contacts, Fleet, Crew, and Trips in
    parallel, all operator-scoped, `contains`/insensitive matching,
    top 5 per type.
  - `components/command-palette.tsx`: self-contained — renders both
    its own header trigger button and the modal overlay, so mounting
    it once in `AppHeader` was enough, no state to lift or wire in
    from outside. Opens on `/` from anywhere (guarded against firing
    while actually typing a literal "/" into a text field, same
    pattern as the existing j/k/p dashboard shortcuts), closes on
    Escape, arrow keys + Enter to navigate results without a mouse.
    200ms debounced fetch with `AbortController` cancellation of
    in-flight requests as the query changes.
    No Radix Dialog/cmdk dependency added — hand-rolled, since the
    behavior needed (overlay, escape-to-close, click-outside-to-close)
    was simple enough not to justify a new dependency.
  - Hit the same `react-hooks/set-state-in-effect` lint rule as the
    sidebar's collapse state a few rounds back — restructured so the
    "reset on open" logic lives in the event handler that opens the
    palette (a real discrete event, no effect needed at all) rather
    than a `useEffect` watching `open`, and the debounced-search
    effect's early "query too short" case does nothing rather than
    clearing `results` synchronously, since the render already shows
    "Keep typing…" from query length alone without needing `results`
    itself cleared.

## Quote tool round: follow-ups, overnight fix, stale-quote self-heal

- ~~**Send a follow-up/custom message after a quote's been sent —
  shipped**~~: `app/(app)/quotes/[id]/page.tsx` gets a new "Send a
  follow-up message" collapsible with a plain textarea, available for
  any non-draft, non-dead-end status (sent/approved/
  pending_confirmation/accepted — not draft, and not declined/
  cancelled/expired, where following up doesn't mean anything).
  Emails the requestor directly with the operator's text plus a link
  back to the quote; distinct from resending the quote itself or the
  legal cancellation notice, both of which already existed.
- ~~**Overnight fee missed repositioning-leg dates — fixed**~~: both
  nights-away calculations (`autoNightsAway` in the Quote Builder,
  `autoNightsAwayOf` in `lib/itinerary.ts`) summed gaps between
  *revenue*-leg dates only — a repositioning leg's own date never fed
  into the calculation at all. Reported case: positioning the aircraft
  out the evening before an early-morning revenue departure (editing
  the repositioning leg's date to the day before) didn't add the
  overnight it obviously creates, since that leg's date was invisible
  to the calc entirely. Both functions now sum gaps across every leg's
  date (still sorted chronologically, per the earlier reload-order
  fix), not just revenue legs. "Returns to base between each leg"
  still zeroes the whole total regardless, unaffected by this change.
- ~~**Stale "Sent" quotes past departure — made self-healing**~~: user
  reported this a second time with a concrete case (quotes from Aug
  17 still showing Aug 19) after the logging-only fix from the
  previous round. Re-reviewed the cron logic again and still found
  nothing wrong in it, so rather than keep asking the user to check
  Vercel logs I can't see myself, made the whole thing self-healing:
  `expireStaleRequestsAndQuotes` now takes an optional `operatorId` to
  scope both queries (cron usage stays unscoped — sweeps every
  operator in one daily pass); the dashboard page now calls it,
  scoped to the current operator, before every load. A stale quote
  now disappears the moment anyone actually opens the dashboard —
  including via the existing 2-minute poll — regardless of whether
  the separate Vercel cron is firing on schedule or not. Doesn't
  explain *why* the cron itself seemed to be missing this, but no
  longer depends on answering that question for the operator's actual
  visible experience to be correct.

## Fleet Calendar (v1)

User pushed on the quoting engine feeling "too simple" compared to a
competitor (Hamilton AI), pasting their marketing copy. Investigated
what already existed before reacting: `lib/ai/score-opportunity.ts`
already does real cross-fleet gap analysis on every inbound request —
builds each aircraft's actual schedule from every confirmed leg,
excludes aircraft that can't physically make the trip or have no
open slot, ranks by *productive* repositioning (lands well-placed for
its next job, not just cheapest to grab), and names a specific
recommended tail number with reasoning. That's already comparable to
(arguably more nuanced in the ranking than) Hamilton's "instant
aircraft matching." The real, honest gaps: no visual fleet calendar,
only one aircraft ever surfaced per request (not a ranked shortlist),
static (not calendar/demand-based) pricing, no quote history/
collaboration. Recommended starting with the calendar, since the
other two — ranked multi-aircraft suggestions, demand-based pricing —
would build on top of having the schedule visible as a real surface
rather than only existing as a headless calculation. User agreed, and
specifically wants it useful from both Sales (quoting against
availability) and Ops (what's the fleet doing).

- ~~**`/ops/calendar` — shipped**~~: one row per active aircraft, one
  column per day (14-day window, Prev/Next/Today navigation via a
  `?start=` param), a cell showing the trip number when that aircraft
  is booked that day or "Open" when it isn't — click a booked cell to
  jump straight to that trip.
  - Reuses `awayWindows()` from `lib/itinerary.ts` (newly exported)
    for the day-by-day "is this aircraft busy" check — the exact same
    away-window logic conflict-checking and the AI opportunity scorer
    already rely on, rather than a second implementation of "when is
    an aircraft away" that could quietly drift from those over time.
  - Confirmed Trips only for v1 — a sent-but-not-yet-accepted quote
    doesn't show as a tentative hold. Real gap, but a separate one:
    that's closer to the existing (currently invisible-to-the-
    operator) conflict-warning system than to "what's actually
    booked."
  - Added to both the Sales and Ops nav (same page either way — the
    Sales/Ops switcher just reflects landing on an `/ops`-prefixed
    page, same as any other cross-mode link already does), gated on
    `showFleet` the same as the Fleet link itself (a broker has no
    owned aircraft to show a calendar for). `(ops)/layout.tsx` didn't
    previously pass `operatorType` through to `AppHeader` at all — now
    does, matching how `(app)/layout.tsx` already gates its own Fleet
    link.
  - Not built yet: pending-quote tentative holds, a month view (14
    days only), any visual distinction between "flying that day" vs.
    "sitting away between two legs of the same trip" (both just read
    as one plain "booked" block for now), and nothing from the
    scoring/ranking side surfaces on the calendar itself — it's purely
    a read of confirmed reality, not yet where a ranked-aircraft
    suggestion would eventually show up.
- ~~**Cancelled trip still showing on the Fleet Calendar, and stale on
  its own detail page — fixed**~~: caught immediately on first real
  use — a cancelled test trip (Quote genuinely cancelled) still
  rendered as a booked block on the calendar, and its own `/ops/
  trips/[id]` page still showed "Awaiting Payment." The calendar's
  trips query never got the `quote.status !== "cancelled"` belt-and-
  suspenders filter `/ops/trips` and `/ops/board` already carry —
  added it. But that filter only ever hides a stale row from *list*
  views; the Trip's own detail page doesn't filter, it just displays
  whatever's in the row, so a Trip cancelled before the original
  cascade fix existed (this test trip predates it) kept showing the
  wrong status forever, on every direct visit. Fixed for real instead
  of just hidden: `getScopedTrip` now self-heals on read — if the
  linked Quote is cancelled but the Trip row isn't yet marked
  `cancelled_by_operator`, it corrects the row right there before
  rendering, the same write-on-read pattern the dashboard's stale-
  quote self-heal already uses.

## Fleet Calendar v2: per-day legs, tile content, conflict detail

Follow-up round on the Fleet Calendar right after v1 shipped, plus a
long-running product-direction conversation (user: JetDeck's quoting
needs to be genuinely competitive with Hamilton.ai's — instant aircraft
matching, live fleet availability, dynamic pricing — not just triage +
one portal; shared Hamilton's feature list for reference). Landed on
building this out incrementally starting with the Fleet Calendar,
since it's the shared foundation multi-aircraft matching and schedule
optimization would both need, useful for Sales and Ops both.

- ~~**Calendar showed one flat "busy" block per trip instead of actual
  legs — fixed**~~: a 4-day trip (KSNA→KMYL 8/20, sits, KMYL→KSNA 8/23)
  showed the same trip-number tile on every day in between, with no
  way to tell flying days from sitting-there days. Rewrote the day
  computation: within each of `awayWindows()`'s away segments, a day
  with a leg departing shows that leg's route; a day with no leg
  shows a lighter "Transient <ICAO>" tag naming wherever the aircraft
  last landed (walking the sorted leg list forward to find it) — not
  just the trip number repeated.
- ~~**Tiles now show client name, leg/transient info, and a stage
  badge — shipped**~~: each tile is a small card (client name +
  1-letter stage badge on top, route or "Transient X" below) instead
  of a bare trip-number pill. New `STATUS_SHORT_LABELS` in
  `lib/trip.ts` (A/C/O/W/P/I/D) — deliberately kept to one small,
  easy-to-edit map rather than baked into the calendar itself, since
  the user is still actively reworking the trip lifecycle's stage
  names/definitions and this will need to change again once that
  settles. Scope stayed Trips-only (confirmed bookings) per the
  user's steer — not pulling in not-yet-accepted Quotes as tentative
  tiles, at least not yet.
- ~~**Conflict warnings now show leg-by-leg detail instead of a bare
  link — shipped**~~: both the Quote Builder's live double-booking
  banner and the persisted/emailed `conflictWarning` text collapsed a
  multi-leg conflicting trip to its first-dep → last-arr span (e.g.
  "KSNA → KSNA" for a KSNA→KMYL→KSNA trip, hiding the actual routing
  entirely) and made the operator click through to `/quotes/[id]` to
  see what was really going on. Both now list every leg's route and
  date inline, using the same itinerary data the link already pointed
  at — no new query, just surfacing what was already being fetched.

## Ops tool round: crew delete, manual manifest for internal trips

- ~~**Delete a crew member — shipped**~~: `/ops/crew/[id]` gets a
  delete action, gated behind a disclosure (same soft-confirmation
  pattern as "Cancel Booking"'s reason field). Only allowed when the
  crew member has never actually been assigned to a trip —
  `TripCrewAssignment` is real flight history, not something to
  silently cascade away; someone who's flown gets told to mark
  Inactive instead, with a clear error banner rather than a raw FK
  constraint failure.
- ~~**Internal trips had no way to start manifest collection, and ops
  had no way to add a passenger directly — shipped**~~: internal trips
  (owner/maintenance/repositioning) skip manifest collection
  automatically by design — no client checkout to trigger it from,
  and usually no passengers in the traditional sense. But some still
  need a real manifest (a booking that came in by phone/text outside
  the usual flow), and there was no way to start one. `createManifestForTrip`
  (`lib/manifest.ts`) now always creates the lead `Passenger` row
  regardless of whether there's an email to send it to — previously
  it bailed out entirely before creating anything if no
  Contact/TripRequest email could be resolved, which is exactly the
  internal-trip case. `/ops/trips/[id]` gets a "Start Manifest
  Collection" button (shown when no manifest exists yet) and an
  "+ Add Passenger" button (once one does) that creates a blank row
  the operator can fill in themselves or forward — mirrors the
  self-service page's own "Add Another Passenger" action, just
  triggered by the operator instead of requiring them to open the
  lead's own manifest link first.

## Trip lifecycle rework: Send to Ops, payment leaves the pipeline, stepper

User flagged the sales/ops boundary was blurry, proposed a "Send to
Ops" handoff, confirmed two specifics before this shipped: payment
should gate a future "released" action (not built yet — "we have not
gotten that far yet... but that's where the hold up would be", so this
is documented intent, not an enforced gate today) and "Send to Ops"
belongs in the Needs Review queue.

- ~~**"Send to Ops" handoff — shipped**~~: new `Trip.sentToOps`
  boolean (migration `20260819100000_trip_send_to_ops`), default
  `false`. A Trip is created the moment the client signs and the hold
  is placed, exactly as before — but it's no longer visible on the
  Ops Board/Trips list/Calendar until this flips. `/inbox/review` gets
  a new "Ready for ops" section (trip #, client, route, a link back to
  the quote, a "Send to Ops" button) — the real sales→ops handoff
  moment now, not Trip creation. Counts toward the "Needs Review" nav
  badge too. Internal trips (`quotes/internal/new`) are created with
  `sentToOps: true` directly — the operator created it themselves,
  there's no sales review step to hand off from. Existing Trip rows
  were backfilled to `true` by the migration so nothing already
  visible in Ops disappeared — only new trips need the explicit click.
- ~~**"Awaiting Payment" removed as a pipeline stage — shipped**~~:
  `TRIP_STAGES` (`lib/trip.ts`) drops it; the board's first column is
  now "Confirmed." `finalizeBooking` creates every Trip as
  `"confirmed"` now regardless of `waivesCardHold` (that variable
  still drives the actual hold-amount/session logic, just not the
  initial status anymore). The migration folds any existing Trip still
  sitting at `awaiting_payment` into `confirmed`.
- ~~**Derived "Paid" indicator — shipped**~~: new `isTripPaid()` in
  `lib/trip.ts`, computed from what's already tracked per payment
  method (captured card hold / confirmed wire / confirmed ACH / cash-
  on-account) rather than a new field to keep in sync by hand. Shown
  as a Paid/Not Paid badge on `/ops/trips/[id]`. Not enforced as a
  gate anywhere yet — there's no "released" action to gate, so nothing
  to block. Documented in `Trip.status`'s schema comment and here so
  the requirement isn't lost before "released" gets built for real.
- ~~**Stage-progress stepper on the trip detail page — shipped**~~:
  circles connected by lines, one per `TRIP_STAGES` entry, filled for
  completed stages, outlined for the current one, muted for what's
  ahead — built directly against the now-settled stage list rather
  than the old one, so it isn't redone once "Awaiting Payment" moved
  out. Reuses the same `STATUS_SHORT_LABELS` single-letter map from
  the Fleet Calendar's tiles. Hidden entirely for a trip whose status
  isn't one of the board's stages (cancelled, invoiced, closed) rather
  than rendering a stepper that doesn't mean anything for those.

- ~~**Cancelled trips still counted as real commitments in AI
  opportunity scoring — fixed**~~: the same leak fixed on `/ops/trips`,
  `/ops/board`, and the Fleet Calendar earlier this file, found a
  fourth time — user reported a new trip request being scored against
  a cancelled trip's itinerary (a cancelled KAMA departure was still
  showing up in the reasoning as a real repositioning constraint on
  N243BA). `scoreOpportunity`'s `activeTrips` query
  (`lib/ai/score-opportunity.ts`), which feeds `buildGapsForAircraft`
  for every aircraft's gap-fit/positioning math, had `status: {
  notIn: ["closed", "invoiced"] }` with no cancellation exclusion at
  all — no `cancelled`/`cancelled_by_operator` in the list, and no
  `quote.status !== "cancelled"` belt-and-suspenders check either, so
  it was the one query site that had never gotten either half of the
  fix. Added both: `status: { notIn: ["closed", "invoiced",
  "cancelled", "cancelled_by_operator"] }` plus `quote: { status: {
  not: "cancelled" }, ... }`. A cancelled trip's legs no longer factor
  into an aircraft's repositioning time or gap availability when
  scoring new requests. Four instances of this exact bug class in one
  file this session prompted a deliberate sweep of every remaining
  `prisma.trip.findMany`/`findFirst` call site rather than waiting for
  the next one to surface by accident — turned up a fifth, worse one:
  `sendManifestReminders` (`lib/manifest.ts`, run by the daily
  manifest-reminders cron) had the same bare `status: { notIn:
  ["completed", "invoiced", "closed"] }` with no cancellation
  exclusion, meaning a cancelled trip with an incomplete manifest
  would keep emailing the client "your flight is coming up, please
  complete your passenger information" — actively wrong, not just a
  stale UI row. Fixed the same way. Checked the other two remaining
  `Trip` query sites and left them alone on purpose: `/api/search`
  intentionally returns cancelled trips too (a lookup tool should find
  everything, not just active bookings), and the manifest-print page
  looks up one specific trip by id for direct printing, not a list of
  "active" ones, so there's no leak to guard against.

## Quote Builder's auto repositioning leg ignored an aircraft's real position

User reported a live example: N243BA recommended for a new KCVO→KBPG
trip on Aug 22, with a genuine conflict banner showing it's already
away Aug 20–23 flying KSNA→KMYL→KSNA. Despite that, the auto-generated
leading repositioning leg still started from KSNA — the aircraft's
permanent home base — when the aircraft is actually sitting at KMYL
that whole window. The Quote Builder had never accounted for an
aircraft being mid-trip elsewhere; `buildInitialLegs` in
`quote-builder-form.tsx` always repositioned from `Aircraft.homeBase`,
a static field, with no notion of "where is this tail actually
expected to be on this trip's first date."

- ~~**Shared gap-schedule logic extracted — shipped**~~: the AI
  opportunity scorer (`lib/ai/score-opportunity.ts`) already solved
  this exact problem for its own positioning math —
  `buildGapsForAircraft` turns every active trip's legs on a tail into
  a sequence of gaps (where it's sitting between commitments, home
  base before/after everything). Pulled that, `findFittingGap`, and
  the active-trips-by-aircraft query out into a new
  `lib/aircraft-schedule.ts` so both the scorer and the Quote Builder
  read from one definition instead of two independent (and now,
  provably out of sync) copies. Added `findAnchorForDate`: which gap a
  single date falls inside, returning that gap's `startAnchor` — this
  is the new piece, since scoring only ever needed "does the whole
  request fit in one gap," not "where is the plane on this one date,"
  including when the answer is a real conflict (as in the reported
  case) rather than a clean fit.
- ~~**Quote Builder resolves each aircraft's real starting position —
  shipped**~~: `quotes/new/page.tsx` and `quotes/[id]/page.tsx` both
  now compute a `positionByAircraftId` map (per active aircraft, the
  `findAnchorForDate` result for the trip's first leg date) and pass
  it down to `QuoteBuilderForm`. `buildInitialLegs` takes a new
  `startingPosition` param, used only for the *leading* repositioning
  leg — the trailing leg and any "between legs" pair still resolve to
  true `homeBase`, since by the end of the trip (or between two of its
  own revenue legs) the plane really is expected home, just not
  necessarily *before* it. The aircraft-change resync effect (picking
  a different aircraft from the dropdown mid-build) got the same
  split: only the leg with `homeSide === "dep" && !betweenLegs`
  (the true leading leg) resyncs to the new aircraft's expected
  position; everything else still resyncs to home base as before.
  Falls back to home base whenever no schedule data says otherwise
  (nothing else booked, or genuinely just sitting at home) — this
  never removes information, only replaces a wrong static guess with
  a real one where the schedule has an answer.

Follow-up on the same trip, from the user re-testing the fix above: the
leading leg now correctly read KMYL → KCOE, but the *trailing* leg still
went KSJC → KSNA (home base) even though the AI's own positioning note
said the aircraft needs to be at KMYL by 2026-08-23 for its next
confirmed leg. Plus a design note for the general case: if the next
commitment were a week out instead of the next day, sending the
aircraft to sit at that airport for a week waiting isn't realistic —
better to send it home and let that trip's own leading leg (now fixed
above) pick it back up from there when the time comes.

- ~~**Trailing repositioning leg now targets the next real commitment
  (within a productive window) — shipped**~~: added
  `findTrailingAnchorForDate` and a `MAX_PRODUCTIVE_IDLE_DAYS = 3`
  threshold to `lib/aircraft-schedule.ts`. Given the date this trip
  ends, it looks at the same gap the leading leg reads from — if the
  next confirmed commitment on that tail departs within 3 days, the
  trailing leg targets *that* airport instead of home base (matching
  the leading-leg fix's reasoning: the plane is actually needed
  elsewhere, not idle). Beyond 3 days it falls back to home base
  rather than parking the aircraft away for the better part of a
  week — the threshold is a named constant with the reasoning
  documented next to it, easy to retune if 3 days turns out wrong in
  practice. `buildInitialLegs` takes this as a second position param
  (`endingPosition`, parallel to the leading leg's `startingPosition`)
  and the aircraft-change resync effect got the matching split: the
  true trailing leg (`homeSide === "arr" && !betweenLegs`) resyncs to
  this computed position, while a "between legs" pair's arrival-home
  leg (same trip, different concept — see the code comment) still
  resyncs to true home base, unaffected.

## Editable client name/email on a quote

User reported quote emails not always reaching the client, and asked to
be able to edit the recipient's name/email in case the stored
information is wrong. Every outbound email tied to a quote — the quote
itself, follow-ups, cancellation notices, and every booking-confirmation
email in `lib/booking-server.ts` — sends to
`TripRequest.requestorName`/`requestorEmail`, not anything on `Contact`.
That's usually AI-extracted from the original inbound email (or typed by
hand on a manual lead) and had no way to fix if wrong — a bad address
just fails silently from the operator's side, no bounce ever reaches
this app to flag it.

- ~~**"Client contact" edit disclosure on the quote page — shipped**~~:
  new `updateRequestorInfo` server action writes straight to
  `TripRequest.requestorName`/`requestorEmail`, so a fix here reaches
  every send path at once rather than just the next one. Exposed as a
  `<details>` disclosure right under the quote header (matching the
  existing "Send a follow-up message" pattern), visible regardless of
  quote status — draft, sent, accepted, whatever — since a wrong
  address can be caught at any point, not just before the first send.
  Basic validation only (non-empty name, an email-shaped string) —
  this isn't trying to verify deliverability, just catch the obvious
  typo/garbage-extraction case. The "Review before sending" step on a
  still-draft quote already reads live from `TripRequest`, so a fix
  made here shows up there immediately without any separate wiring.

## Automatic BCC to the operator on client-facing emails

User asked for an automatic BCC to the operator's reply-to address on
outbound emails, so there's proof in their own inbox that a client
email actually went out — the only prior record was whatever Resend's
own dashboard showed, which isn't somewhere an operator would think to
check when a client says "I never got that."

- ~~**`sendEmail` gets a `bcc` param — shipped**~~: `lib/email.ts`
  passes it straight through to Resend alongside the existing
  `replyTo`. Not inferred from `replyTo` automatically — several
  *internal* notification emails (an operator alert about a new
  booking request, a decline, a change request) set `replyTo` to the
  *client's* address instead, specifically so the operator can hit
  reply and land in the client's inbox. BCC-ing those to the same
  address the email already went to would be a no-op at best.
- ~~**Every client-facing send now BCCs `operator.replyToEmail` —
  shipped**~~: added `bcc: operator.replyToEmail ?? undefined`
  alongside each call site's existing `replyTo: operator.replyToEmail
  ?? undefined` (the two were already a reliable marker of "this one
  actually goes to the client," found by auditing all 11 `sendEmail`
  call sites) — the quote itself, follow-ups, cancellation notices,
  the card-hold-link resend, the "your aircraft is available"
  nudge, the "unable to confirm" notice, manifest collection
  requests and reminders, and the public intake page's "request
  received" auto-reply. The reverse pattern (an internal alert
  `to: operator.notifyEmail`) was left untouched — the operator's
  already the primary recipient there, nothing to confirm. No BCC
  goes out when `Operator.replyToEmail` isn't set, same graceful
  fallback the existing `replyTo` already has — nothing to configure
  beyond the reply-to address already in Settings.

## Editable email templates + Settings reorganized into tabs

User asked for more information in the quote email (routing, a more
descriptive subject line), whether the email content could be made
editable from Settings, and — separately — for Settings itself to be
reorganized into categories (payment, email, branding, website, etc.)
instead of one long page. Scoped the template editor to the three core
booking-lifecycle emails a client is most likely to actually read
closely (quote sent, booking confirmed, booking cancelled) rather than
every outbound send, per a quick scope check.

- ~~**`lib/email-templates.ts` — shipped**~~: new module defining the
  three templatable emails (`EMAIL_TEMPLATES`), each with a default
  subject/body and a documented list of `{{variable}}` placeholders;
  `renderTemplate()` does plain string substitution (no HTML
  sanitization beyond what `wireInstructions`/`termsText` already
  skip — same trust level, an operator's own words going to their own
  clients); `routingVars()` builds the shared `{{routeShort}}`
  (subject-safe) and `{{routing}}` (full per-leg breakdown, matching
  the leg-by-leg detail pattern already used for conflict banners
  rather than a collapsed first→last summary) variables from an
  itinerary, replacing three near-duplicate inline builders.
- ~~**Six new nullable `Operator` fields — shipped**~~: `quoteSentSubject`/
  `Body`, `bookingConfirmedSubject`/`Body`, `bookingCancelledSubject`/
  `Body` (migration `20260821090000_email_templates`). Null means "use
  the built-in default," so no existing operator's emails change until
  they actually customize one — same fallback pattern as leaving a
  field blank on save.
- ~~**Default templates now include full routing + a descriptive
  subject — shipped**~~: the actual fix for what was reported. Quote
  Sent's subject went from `Your Charter Quote — {{quoteNumber}}` to
  `Your Charter Quote — {{routeShort}} ({{quoteNumber}})`, and its body
  gained a `<strong>Routing:</strong>` block it never had before —
  every operator gets this improvement automatically, not just ones
  who go customize their template.
- ~~**Booking Confirmed keeps its logic-dependent parts app-controlled —
  shipped**~~: `sendBookingConfirmationEmail` (`lib/booking-server.ts`)
  only templates the intro/reference/routing/total — wire instructions,
  the card-authorization follow-up line, and the charter terms still
  get appended after the templated body exactly as before, since those
  reflect real payment-method/state logic (whether wire instructions
  should show at all, for instance), not just wording an operator
  should be free to rewrite.
- ~~**Email Templates editor on the Settings page — shipped**~~: each
  template is a `<details>` disclosure (subject `Input` + body
  `Textarea`, pre-filled with the current custom value or the default)
  with its variable list spelled out above the fields. Saving a blank
  field stores `null`, falling back to the default rather than
  persisting (and sending) an empty subject/body.
- ~~**Settings reorganized into five tabs — shipped**~~: Payments,
  Email, Branding, Website, Quoting Defaults — new
  `components/settings/settings-tabs.tsx` (`SettingsTabProvider`/
  `SettingsTabPanel`, same active-tab-via-CSS-class pattern already
  used for the Quote Builder's Options tabs). One wrinkle: the Stripe
  connect/dashboard actions and the Website widget/embed content have
  their own standalone `<form>`s (or no form at all) and can't nest
  inside the single big `updateSettings` form the rest of the fields
  submit through — nested `<form>` elements aren't valid HTML. Solved
  by sharing one active-tab context across two separate top-level
  panel instances for the "Payments" tab (Stripe box outside the form,
  deposit%/cc-fee/wire-instructions fields inside it) — both show/hide
  in sync, and the split is invisible to the user since forms have no
  visual chrome. Field-to-category mapping: Payments = deposit %, CC
  fee, wire instructions, Stripe connect; Email = from/reply-to/notify/
  inbound addresses + the new template editor; Branding = the existing
  read-only org name/logo pointer; Website = the existing widget/embed
  section; Quoting Defaults = charter terms, block time buffer,
  overnight fee. Nothing about `updateSettings` itself changed beyond
  adding the six new template fields — same single server action,
  same single Save button (kept outside every tab panel so it's
  always visible regardless of which tab is active).

## Broker sales — Phase 1: Preferred Operators directory

User wants JetDeck to work well for both full-time brokers (no fleet at
all) and part135/hybrid operators who occasionally need to source an
off-fleet tail — explicitly framed as a real SaaS product, so it needs
to be genuinely polished for either kind of account, not a bolted-on
afterthought. The data model for this (`PreferredOperator`,
`BrokeredAircraft`, `QuoteOption.fleetSource`/`wholesaleCost`/
`brokerMargin`) has existed since the earliest schema pass but never had
any UI built on it — `/fleet` already tells a broker "you source
aircraft from your preferred operators instead," pointing at a feature
that didn't exist yet. Scoped as a multi-round build:

1. **Preferred Operators directory** (this round)
2. Brokered aircraft per preferred operator
3. Quote Builder integration — source a brokered tail, price it off an
   all-in wholesale cost instead of hourly-rate math (matches what's
   already in the schema — a broker knows what a third-party operator
   quoted them, not that operator's real hourly cost)
4. Downstream polish — client quote page, Ops/Trips reading the
   aircraft from the right place, AI scoring staying owned-fleet-only

- ~~**`/sourcing` — list, add, edit, delete — shipped**~~: new route
  group mirroring the established Contacts/Fleet CRUD pattern (list +
  `/sourcing/new` create + `/sourcing/[id]` edit). Every operator type
  sees it, not just brokers — a part135 shop sourcing off-fleet
  occasionally needs this exactly as much as a full-time broker does,
  just less often. Fields: company name, contact name/email/phone,
  notes, active/inactive. Delete is blocked (redirect + friendly
  banner, same pattern as crew delete) once any `BrokeredAircraft`
  references the operator — mark Inactive instead to keep history
  intact for past quotes, rather than an FK error or a silent
  cascade-delete of quote history.
- ~~**Nav + route protection — shipped**~~: added to `AppHeader`'s
  Sales nav (next to Contacts, unconditional — not gated behind
  `showFleet` like Fleet/Calendar are, since this is relevant
  regardless of whether an operator has their own fleet). Also added
  `/sourcing(.*)` to `middleware.ts`'s protected-route matcher —
  noticed `/contacts` itself was never added there (page-level auth
  checks still protect it, just without the proper redirect-to-sign-in
  a missing route gets), left as a pre-existing gap out of scope here
  rather than fixed as a drive-by.

Not built yet: adding/managing the actual aircraft under a preferred
operator (Phase 2), and nothing references this from the Quote Builder
yet (Phase 3) — `wholesaleCost`/`brokerMargin` are still unused columns
until then.

## Broker sales — Phase 2 & 3: brokered aircraft + Quote Builder integration

Continuing the broker-sales build from Phase 1 (Preferred Operators
directory). This round: the actual tails you can source, and wiring the
whole thing into the Quote Builder so a brokered trip can actually be
quoted end to end.

- ~~**Brokered aircraft management — shipped**~~: `/sourcing/[id]` now
  lists and manages the tails on file under that preferred operator
  (tail number, make/model, category, seats, home base) — an inline
  "Add an aircraft" disclosure plus a "Remove" action per row. Remove
  is blocked once any `QuoteOption` actually references the tail
  (redirect + friendly banner, same pattern used everywhere else this
  session for FK-guarded deletes) — nothing to "mark inactive" instead
  since `BrokeredAircraft` has no such flag, it's a much lighter record
  than a preferred operator.
- ~~**Quote Builder: source a brokered aircraft — shipped**~~: a new
  "My Fleet / Brokered" toggle at the top of each option's aircraft
  picker (`components/quote/quote-builder-form.tsx`). Brokered mode
  swaps in a `<Select>` of every active preferred operator's tails
  (`TAIL — Make Model (Preferred Operator)`) in place of the owned-
  fleet dropdown, and skips repositioning-leg logic entirely — no
  home base to reposition from/to on a plane you don't operate, so
  `buildInitialLegs` gets `null` for both the starting and ending
  position and never synthesizes a leading/trailing/between-legs
  repositioning leg. The double-booking conflict check is skipped too
  for the same reason (a brokered tail isn't on a schedule this
  operator's JetDeck controls).
- ~~**Wholesale-cost pricing, decoupled from the client-facing total —
  shipped**~~: brokered mode replaces "Hourly rate" / "Repositioning
  rate" with "Wholesale cost ($)" (what the source operator quoted —
  tracked for margin only, never sent to the client) and "Your price
  to client ($)" (a flat number, not multiplied by flight hours — see
  `calculateQuoteTotals`'s new `flatRate` mode in `lib/quote.ts`).
  Landing/handling fees, discount, and FET tax still apply on top
  exactly as they do for an owned-fleet option. A live "Margin: $X"
  line shows `total - wholesaleCost`, matching
  `QuoteOption.brokerMargin`'s already-documented meaning — red if
  negative. Flight hours themselves stay a real, separately-tracked
  duration (summed from the legs, entered by hand since a brokered
  tail has no cruise speed on file) — never hijacked to make the
  pricing math work, so "Flight (3.2 hrs)" in the sidebar still means
  what it says.
- ~~**Server-side wiring — shipped**~~: `parseOptionFromFormData`
  parses `fleetSource`/`brokeredAircraftId`/`wholesaleCost` and
  computes `brokerMargin`; both `createQuote`
  (`quotes/new/page.tsx`) and `updateQuote` (`quotes/[id]/page.tsx`)
  validate a brokered option against a real `BrokeredAircraft` the
  operator owns (same silent-refuse-on-bad-submission behavior the
  owned-fleet path already had) and persist all four new columns.
  Both pages fetch the operator's active-preferred-operator tails
  (`quotes/[id]/page.tsx` also keeps an already-selected tail visible
  even if its preferred operator has since gone inactive, so reopening
  an old quote doesn't show a hole where the aircraft used to be).
- **Not touched, confirmed already correct**: the client-facing quote
  page (`/q/[token]/page.tsx`) already queried `brokeredAircraft` and
  had a fallback aircraft-name builder for it from an earlier schema
  pass — no changes needed there. AI opportunity scoring
  (`lib/ai/score-opportunity.ts`) and the Fleet Calendar stay owned-
  fleet-only, unchanged, per the Phase 4 plan from last round.

Checked `/ops/trips/[id]` too, expecting to find the same gap there —
it already has its own `aircraft ?? brokeredAircraft` fallback for both
the display label and seat count, and `/ops/board`/`/ops/trips` don't
show aircraft at all on their list rows, so there was nothing to fix.
Only real remaining gap (Phase 4): aircraft photos/amenities for a
brokered tail on the client quote page — still just tail/make/model/
category/seats, no visual section, same limitation the fleet-photos
feature already flagged as out of scope for brokered aircraft.

## Broker sales feedback: margin entry, FET bug, nav move, aircraft edit

User tested the Phase 2/3 build and came back with four fixes: enter
margin (as % or $) instead of typing a client price directly; move the
Sourcing nav item under Settings; a way to edit an already-added
brokered aircraft (only add/remove existed); and a real bug — the
margin figure included FET, which isn't money the operator keeps.

- ~~**Margin-driven brokered pricing — shipped**~~: replaced the direct
  "Your price to client ($)" input with "Wholesale cost ($)" +
  "Margin" (a value plus a %/$ toggle, `components/quote/
  quote-builder-form.tsx`). Percent mode marks up the wholesale cost
  itself (not the sell price). The client-facing flight price is now
  computed (`wholesaleCost + marginAmount`) rather than typed, fed into
  `calculateQuoteTotals`'s existing `flatRate` mode via a hidden input
  — fees/discount/tax still layer on top exactly as before. Both the
  computed price and the margin ($ and %) are shown live so the
  operator can see the result of either entry mode. Reopening a saved
  brokered option defaults to flat-$ mode with the exact saved margin
  (back-derived from the two stored numbers) — only "which mode was
  typed in" is forgotten across a reload, never the dollar amount.
- ~~**Margin no longer includes FET — fixed**~~: was `total -
  wholesaleCost`, and `total` includes federal excise tax — money the
  operator collects and remits, not revenue. Now computed purely from
  wholesale cost + markup (`lib/quote-option-server.ts`'s
  `brokerMargin = hourlyRate - wholesaleCost`, where `hourlyRate` holds
  the flat flight price for a brokered option) — never touches fees,
  discount, or tax at all, by construction rather than by a subtraction
  that happened to need tax removed.
- ~~**Sourcing moved under Settings — shipped**~~: removed from
  `AppHeader`'s top nav; `components/settings/settings-tabs.tsx` gained
  a sixth "Sourcing" tab showing the same preferred-operators list
  `/sourcing` used to show at the top level. `SettingsTabProvider` now
  accepts an `initialTab` (read from `?tab=`), so `/sourcing` itself
  became a one-line redirect to `/settings?tab=sourcing` (keeps old
  links/bookmarks working) instead of just disappearing.
  `/sourcing/new` and `/sourcing/[id]` stay as real routes — same
  relationship Fleet has to `/fleet/new`/`/fleet/[id]`, a list-level nav
  entry with add/edit as sub-pages, just relocated one level under
  Settings now.
- ~~**Edit an already-added brokered aircraft — shipped**~~: each
  aircraft row on `/sourcing/[id]` is now a `<details>` disclosure —
  collapsed shows the same summary line as before, expanded shows a
  pre-filled edit form (new `updateBrokeredAircraft` server action)
  plus the existing "Remove" action, instead of add/remove being the
  only two options.

Not built yet: bulk-importing a fleet list from a URL (an operator's
public fleet page) — flagged as a "nice to have," not built this round.
Real design questions before starting it: a plain server-side fetch
won't render JS-heavy fleet pages (many are React/Vue-built), so some
sites would come back empty; and whether extracted aircraft should be
reviewed/edited before being added, or trusted and inserted directly
the way AI-extracted trip requests already are. Worth a scoping pass
before building rather than guessing at both.

## Brokered aircraft get photos and amenities, same as owned fleet

User asked for brokered aircraft to match owned fleet on photos and
amenities, so a client sees the same quality of aircraft presentation
regardless of whether the trip is flown on the operator's own tail or
a sourced one.

- ~~**Schema — shipped**~~: `BrokeredAircraft` gets `photos String[]` /
  `amenities String[]` (migration `20260821110000_brokered_aircraft_media`),
  identical shape to `Aircraft`'s existing fields.
- ~~**`/sourcing/[id]` (Settings → Sourcing) — shipped**~~: the "Add an
  aircraft" form gained an amenities checklist (same
  `AIRCRAFT_AMENITIES` list Fleet uses — reused directly, no
  duplication); each aircraft's edit disclosure gained the same
  checklist (pre-checked) plus a full photo manager. Reused
  `AircraftPhotoManager` (`components/fleet/aircraft-photo-manager.tsx`)
  as-is — it was already generic (props are `photos`/`uploadAction`/
  `removeAction`/`setCoverAction`, nothing Aircraft-specific), so no
  changes needed there. New `uploadBrokeredAircraftPhotos`/
  `removeBrokeredAircraftPhoto`/`setBrokeredAircraftCoverPhoto` server
  actions mirror Fleet's photo actions exactly (same `@vercel/blob`
  `put`/`del` calls, same 8MB/image-type validation, same "first photo
  in the array is the cover" convention), just scoped to
  `BrokeredAircraft` under a `brokered-aircraft/` blob path prefix
  instead of `aircraft/`. Photos can only be added after the aircraft
  is saved, same as Fleet — there's nothing to attach a blob to before
  that.
- ~~**Client quote page — shipped**~~: the aircraft photos/amenities
  section on `/q/[token]` read only `option.aircraft` before — now
  reads `option.aircraft ?? option.brokeredAircraft` (both carry the
  same shape) so a brokered option's photos/amenities show up exactly
  like an owned-fleet one's would, no separate rendering path needed.
- Not verified live: same known limitation as the original Fleet
  photos feature — this sandbox has no `BLOB_READ_WRITE_TOKEN`, so
  actual upload/remove/set-cover round-trips couldn't be tested here.
  Worth a quick smoke test on the deployed app: open a brokered
  aircraft's edit disclosure, upload a photo, confirm it shows up
  there and on that aircraft's quotes' client pages.

## Fleet Calendar showing tomorrow's date as "today"

User reported the calendar thinking it's the 23rd when it's still the
22nd locally. Root cause: `todayIso` was computed server-side via
`new Date().toISOString()`, which is always UTC — Vercel's serverless
functions run on UTC, so for anyone west of Greenwich (essentially all
US timezones), the server's "today" flips over several hours before
the viewer's own local midnight. At 9pm Eastern, the server already
thinks it's tomorrow.

- ~~**Client-derived "today" via a one-time redirect — fixed**~~: the
  server genuinely has no way to know the viewer's timezone, so
  `/ops/calendar` now requires a `today` query param; when it's
  missing, a new client component (`CalendarTodayRedirect`) computes
  the browser's actual local date and redirects to
  `?today=<local-date>` (preserving an explicit `start` if one was
  already given). The default window and the "today" column highlight
  both key off this value instead of the server clock. The Prev/Next/
  Today nav links all carry `today` forward so paging through the
  calendar never re-triggers the redirect or drifts back to a
  server-guessed date mid-session.

## Discounts weren't visible on the client-facing quote

User reported discounts don't show on the quote a client sees. True —
the client-facing pricing breakdown (`/q/[token]`) allocated the
per-leg segment fees from the *post-discount* subtotal, so a discount
was already baked invisibly into each leg's number with no line item
ever calling it out — a client receiving a discounted quote had no way
to tell one had been applied at all.

- ~~**Discount line item on the client quote page — fixed**~~: segment
  fees now allocate from the pre-discount subtotal (list price per
  leg), with a new "Discount" row (`-$X`) between the leg rows and
  Subtotal when `option.discount > 0` — standard receipt shape: line
  items, discount, subtotal, tax, total. `option.discountNote` stays
  internal-only (it's the operator's own justification for discounts
  over 10%, not client-facing copy — the existing type comment
  documenting it as client-facing was actually misattached to the
  wrong field, describes `clientNotes` instead) so nothing about *why*
  the discount was given leaks to the client, just that one exists.

## Manifest gets FBOs, a flight-path map, and notes

User flagged the manifest was missing several things it should have:
FBO info, a map showing the route, and any system-captured notes
(catering, ground transportation, etc.).

- ~~**FBO per leg — shipped**~~: `StoredLeg` (`lib/itinerary.ts`) gains
  optional `depFbo`/`arrFbo` — no schema migration needed since
  itinerary is already a JSON blob, just two new keys. This is an
  ops/dispatch detail decided once a trip is confirmed, not a pricing
  concern, so it's editable on `/ops/trips/[id]`'s Itinerary section
  (new `updateLegFbos` action) rather than the Quote Builder — one
  "FBO at X" input per leg endpoint, written back onto that leg's own
  position in the stored itinerary array (`revenueLegsWithIndex`, new
  in `lib/itinerary.ts`, keeps each revenue leg's true index into the
  full array so writing one leg's FBO can't disturb the repositioning
  legs interleaved around it). Scoped to revenue legs only —
  repositioning legs don't carry passengers, so there's no FBO
  coordination need there today.
- ~~**Flight-path map — shipped**~~: new `FlightPathMap`
  (`components/ops/flight-path-map.tsx`) — a dependency-free SVG, not
  a real geographic map: projects each leg's airports (lat/lon already
  in the `Airport` table) onto a plain equirectangular grid, connects
  them with a slightly-arced dashed line per leg, labels each unique
  airport by ICAO. No map-tile service, no coastline data, no network
  call — good enough to show a routing's shape at a glance, not meant
  to be geographically precise. Shown on both the ops trip detail page
  and the print manifest.
- ~~**System notes surfaced — shipped**~~: a trip's manifest now shows
  `QuoteOption.clientNotes` (the operator's own client-facing notes —
  catering, ground transport, etc.), `TripRequest.specialRequests`
  (whatever the client originally asked for), and each passenger's own
  `specialRequests` from manifest collection (dietary, mobility, etc.
  — collected already, never displayed anywhere before this). Nothing
  operator-internal-only (`Quote.internalNotes`) is included — that
  stays exactly as internal as it already was.
- Both `/ops/trips/[id]` and the print manifest
  (`/ops/trips/[id]/manifest-print`) got all three additions in
  parallel, sharing the same `FlightPathMap` component and the same
  airport-lookup pattern, so the ops-facing detail page and the
  document that actually leaves the building (print/PDF) show
  consistent information.

## Manifest follow-up: structured FBOs, richer map, readable itinerary

User tested the FBO/map/notes round and came back with concrete
feedback: the map read as empty with no real information on it; FBO
needed a proper name *and* a clickable address for directions, not one
free-text blob (the test screenshot showed a full "name + street
address" string jammed into the single field from the prior round);
airport codes alone (KILG, MWCR) aren't recognizable to most readers;
and the itinerary layout itself was cramped and hard to follow.

- ~~**FBO split into name + address — fixed**~~: `depFbo`/`arrFbo`
  (single string) replaced with `depFboName`/`depFboAddress`/
  `arrFboName`/`arrFboAddress` on `StoredLeg` (`lib/itinerary.ts`) —
  still just JSON keys, no migration, and no backfill for the one test
  value already saved (this is active test data, not anything worth
  preserving). New `mapsSearchUrl()` helper builds a plain Google Maps
  search link from the address — works for turn-by-turn directions on
  any phone without a geocoding call, Maps resolves the free-text
  address itself. The print manifest renders the address as that link;
  the ops edit page (`/ops/trips/[id]`) shows an "Open in Maps ↗" link
  next to any address already saved, so ops can sanity-check what they
  typed without leaving the edit form.
- ~~**Airports get real names, not just codes — fixed**~~: a shared
  `airportLabel()` (written once per page, small enough not to need a
  common export) renders `KILG — New Castle Airport (Wilmington, DE)`
  wherever a leg's airports are shown — the itinerary cards on both
  `/ops/trips/[id]` and the print manifest, and the map's own labels
  (`FlightPathMap` now takes each airport's city/state alongside
  lat/lon and prints both under the ICAO code).
- ~~**Map redesigned with actual content — fixed**~~: still no external
  map-tile service or coastline data (deliberately — see the original
  entry), but now reads as an aviation sectional chart instead of an
  empty grid: a warm cream/tan gradient background, a compass rose,
  distance in nautical miles labeled along each leg's path
  (`greatCircleDistanceNm`, already in `lib/geo.ts`), and two-line
  airport labels (ICAO + city/state) instead of a bare code.
- ~~**Itinerary readability — fixed**~~: each leg is now its own
  bordered card — route (with full airport labels) and date up top,
  then departure/arrival FBO name+address clearly grouped under their
  own labeled subsections — instead of a cramped single line with FBO
  text crammed underneath in tiny type. The map moved to the top of
  the Itinerary section (overview first, details below) on both pages.

## Manifest follow-up: map removed, itinerary decluttered

User tried the redesigned manifest and the map still wasn't landing —
"pretty empty" became "may is no good, remove it all together" once
seeing it filled in with real content. The itinerary text was also
still too crowded: pairing each airport with its full FAA facility
name plus city/state made both endpoints of a leg wrap mid-phrase onto
a second line, and the FBO details ran on immediately underneath with
no visual separation.

- ~~**Flight-path map removed — shipped**~~: deleted
  `components/ops/flight-path-map.tsx` and its usage on both
  `/ops/trips/[id]` and the print manifest. Two attempts at a
  dependency-free abstract map (grid, then a chart-style version with
  distance/compass) didn't land — not worth a third pass without a
  clearer sense of what would; simpler to drop it than keep guessing.
- ~~**Airport labels shortened — fixed**~~: `airportLabel()` on both
  pages now renders `City, State (ICAO)` (e.g. "Wilmington, DE
  (KILG)") instead of `ICAO — Full Facility Name (City, State)` — short
  enough that a leg's two endpoints reliably fit on one line instead
  of wrapping mid-phrase.
- ~~**Itinerary leg cards decluttered — fixed**~~: each leg is now a
  bordered card with the route/date on their own clear header line,
  and departure/arrival FBO details each in their own indented
  sub-block (small-caps "Depart — KILG FBO" label, name, then the
  address as its own line) instead of a single run-on paragraph.
  Applied identically to the print manifest and the ops edit page.

## Client-facing manifest gets the quote page's level of polish

User clarified an important distinction: the ops print manifest
(`/ops/trips/[id]/manifest-print`) is working well for crew reference
and should stay as-is — the actual gap is the *client-facing* side,
the self-service passenger page at `/manifest/[token]`, which already
matched the quote page's visual polish (same rounded-card-on-muted-
background look) but only ever showed a bare one-line route/date
before jumping straight into the passenger info form — no itinerary
detail, no FBO, no notes.

- ~~**Shared client-page primitives extracted — shipped**~~: pulled
  `SectionHeading`/`Row` out of `/q/[token]/page.tsx` into a new
  `components/quote/client-page-ui.tsx` — importing UI out of another
  route's `page.tsx` would've worked but is the wrong shape; now both
  client-facing pages share one real component source, guaranteeing
  they actually look consistent rather than two hand-matched copies
  drifting apart later.
- ~~**"Your Trip" section on the passenger manifest page — shipped**~~:
  added a full itinerary breakdown (per-leg city/state-labeled route,
  date, time, and FBO name + clickable maps link when set — same
  `mapsSearchUrl()` helper the ops side uses) plus the aircraft label
  and a Notes section (`clientNotes` + the original `specialRequests`
  from intake), styled identically to the quote page's own Itinerary/
  Notes sections (`rounded-xl border border-border/70 p-4` leg cards,
  `SectionHeading` labels). A client filling in their passenger info
  now sees the same trip detail and polish they saw on the quote
  itself, not a bare route string.

## Ops can send a polished itinerary email on demand

User wanted to replace a manual PDF-itinerary workflow with something
sent straight from JetDeck, "not in PDF format but the format like
what we send the quote in" — a real ask for two separate things: the
client-facing page needed the FBO/notes detail that had only existed
on the manifest page, and ops needed a button to actually send it
whenever they want (not just the one automatic email at booking time).

- ~~**`/q/[token]` gains FBO detail and full notes — fixed**~~: the
  Itinerary section's leg cards now show departure/arrival FBO name +
  clickable maps address (same `mapsSearchUrl()` pattern as the
  manifest and ops pages) when set, and the Notes section merges in
  the original intake `specialRequests` alongside `clientNotes` — this
  page is what both the booking-confirmation email and the new send
  button link to, so it needed the same detail already added to the
  passenger manifest page.
- ~~**"Send Itinerary to Client" button on the ops trip page —
  shipped**~~: a new `sendItinerary` action next to the Itinerary
  section header emails the trip's on-file requestor address a link to
  `/q/[token]` (bcc'd to the operator's reply-to address, same as every
  other client-facing send). Unlike `sendBookingConfirmationEmail`
  (fires once, guarded against re-sending), this is deliberately
  resendable any time — exactly what's needed after FBOs get filled in
  post-booking, or when a client says the original email never
  arrived.

## Itinerary leg cards redesigned for readability

User flagged the client-facing itinerary as still hard to read and
shared a sample PDF itinerary from another operator for inspiration —
a header bar per leg (route, date, distance, flight time, time-zone
change) over a two-column Departs/Arrives block with full airport
names and FBO detail. Skipped the sample's weather and embedded map
images deliberately: weather needs a forecast API with no upside once
the flight is imminent, and a map is exactly what got built, iterated
twice, and explicitly pulled a few rounds ago ("may is no good, remove
it all together") — the ask here was readability, not those specific
features.

- ~~**`LegItineraryCard` — shipped**~~: new shared component
  (`components/quote/client-page-ui.tsx`) replacing the leg-card JSX
  that had been hand-duplicated across `/q/[token]` and
  `/manifest/[token]`. Renders a `bg-muted/60` header bar ("Leg 1: ILG
  → MWCR", date, and a distance/flight-time/time-zone-change meta
  line when computable) over a two-column grid — each side stacking
  local time, the airport's full name (`"New Castle County (ILG)"`,
  safe to show in full now that it's not fighting for space on one
  crowded route line), city/state, and FBO name + clickable maps
  address.
- ~~**Distance, flight time, and time-zone change computed from data
  already on hand — shipped**~~: distance via the existing
  `greatCircleDistanceNm` (`lib/geo.ts`, already used for pricing) off
  each airport's lat/lon; flight time from the leg's own
  `flightHours`, formatted `H:MM` (new `flightTimeLabel` in
  `lib/itinerary.ts`); time-zone change and per-airport abbreviation
  (`tzChangeLabel`/`tzAbbreviation`, new in `lib/time.ts`) from each
  airport's IANA timezone, resolved for the leg's actual date so a
  flight near a DST transition doesn't get the wrong abbreviation. No
  new data entry required — everything needed was already stored.
- ~~**Times switched to 12-hour with zone abbreviation — shipped**~~:
  `to12Hour()` (`lib/time.ts`) turns the stored 24-hour `"14:00"` into
  `"2:00 PM"`; combined with `tzAbbreviation()` each side now reads
  "12:00 PM EDT" / "2:24 PM EST" instead of the bare 24-hour time. The
  crew-facing pages (`legTimeLabel`, ops itinerary editor, print
  manifest) are untouched — this only changed how the two
  client-facing pages format the same stored data.

## Manifest collection cleanup (six items in one round)

User feedback batch, all shipped together: KTN removed outright ("never
applicable" — no reason to keep collecting it), only name/DOB required,
a way to say which legs a passenger is actually on, a more prominent
share-link, passenger removal, and a branded print manifest.

- ~~**KTN field dropped — shipped**~~: `Passenger.ktn` removed from the
  schema entirely (migration `20260829090000_drop_passenger_ktn`), not
  just hidden — "never applicable" per the operator.
- ~~**Only name + DOB required — shipped**~~: weight is now optional on
  the passenger form; `submittedAt`/"complete" only checks
  firstName/lastName/dateOfBirth.
- ~~**Per-leg passenger assignment — shipped**~~: new
  `Passenger.legIndexes` (empty = every leg, the common case) lets a
  passenger be checked into specific legs of a multi-leg trip instead
  of all of them — the picker only appears on the passenger form when
  the trip actually has more than one leg. Surfaced back on the ops
  trip page (a "Legs: ..." line per passenger) and the print manifest
  (a "Legs" column, only shown when it'd actually say something other
  than "All" for every passenger) so crew still know who's on which
  leg — the one case where extending the print manifest was necessary
  to keep it correct rather than just decoration.
- ~~**Share-link banner moved to the top, made prominent — shipped**~~:
  was a small text line below the form; now a highlighted banner
  (`border-accent/40 bg-accent/10`) at the top of each additional
  passenger's card, matching how the operator described it — "an
  awesome feature" that deserved more visibility.
- ~~**Remove a passenger — shipped**~~: `removePassenger` action on the
  ops trip page, guarded against removing the lead (their token is
  what every email link and the "who can manage this manifest" check
  is keyed to — an ops mistake there means editing the lead's info,
  not deleting the row).
- ~~**Print manifest branded — shipped**~~: operator logo now shown
  prominently in the header (falls back to the name when there's no
  logo) instead of plain text, with a heavier header rule and a proper
  two-column layout for the trip/aircraft info.
- ~~**Brokered aircraft tail number on client pages — fixed**~~:
  `aircraftLabelFor` (extracted to the shared
  `components/quote/client-page-ui.tsx` from two near-identical
  copies) included the tail number for owned-fleet aircraft but not
  brokered ones, even though `BrokeredAircraft.tailNumber` is always
  set — a client sourcing a brokered aircraft had no way to identify
  the actual plane at the FBO. Now both branches include it.

## Ops itinerary editor: schedule fields and aircraft swap

User feedback: the ops trip page's itinerary section "just shows date
and airport codes" and needed to be editable — departure times,
airports, dates, aircraft.

- ~~**Editable airports/date/times — shipped**~~: `updateLegFbos`
  became `updateLegDetails`, extended to also write
  `depAirport`/`arrAirport`/`date`/`depTime`/`depTimeTBD`/`arrTime`
  back onto the leg's position in the stored itinerary array, same as
  FBOs already did. Each airport input keeps a city/state caption
  below it (using the airport data already looked up for the old
  read-only labels) so ops can confirm it's the right one without
  memorizing ICAO codes. Deliberately doesn't touch pricing
  (hourlyRate/overnightNights/totals stay whatever was quoted and
  paid) — this is for fixing a mistake or a schedule change already
  agreed with the client, not a re-quote.
- ~~**Aircraft swap — shipped**~~: new `updateAircraft` action and a
  "Swap" dropdown next to the aircraft line, scoped to the same
  sourcing lane as what's already selected (own-fleet aircraft can
  only swap to another own-fleet aircraft, brokered to another
  brokered) — crossing lanes changes the pricing model (wholesale
  cost, margin) and belongs in a re-quote, not a quick tail swap for
  "N123AB went down for maintenance."

## Client quote page shifts to "itinerary mode" once sent to Ops

User: once a trip moves to ops, the client's link should stop reading
like a quote (terms, raw status) and start reading like an itinerary
(who's confirmed, who's flying, who's crewing it).

- ~~**"Confirmed" pill + terms hidden — shipped**~~: new `isConfirmed`
  flag keyed off `quote.trip?.sentToOps` (not just `status ===
  "accepted"` — the deliberate sales-to-ops handoff, same gate the Ops
  Board itself uses) rather than the moment the client signs. Once
  true, the top-right pill reads "Confirmed" instead of the raw
  status, and the Charter Terms section — already signed, no longer
  the point once the trip's actually moving — stops showing.
- ~~**Passengers and Crew sections — shipped**~~: `getQuoteByToken` now
  pulls `trip.passengers`/`trip.crewAssignments` (Quote already had a
  `trip` back-relation); shown as name pills, same style as amenity
  tags, once `isConfirmed` and there's anyone to list.
- ~~**Pricing hidden too — fixed**~~: follow-up ("oh and remove the
  pricing from it as well i forgot") — the whole Pricing section
  (line items, tax, total, deposit) now sits behind the same
  `!isConfirmed` check as Charter Terms.

## Ops Build Brief v2 — full post-booking flow (design discussion, not started)

User course-corrected the ops build order: rather than the brief's
original module list (Checklist, etc. in isolation), the real target
is a full flight-management flow for everything after booking —
Ops Review → Ops Approved → Ops Released — with an automated
compliance checklist doing most of the work at Ops Review. Captured
here before any of it is built, since it's a multi-round initiative:

**The flow, as specified directly:**
1. **Ops Review** (sales hands off, ops notified) — system
   automatically checks: aircraft availability (not in maintenance,
   no conflicting trip/hold), qualified crew available (flight
   currency, training currency, company-required training — tracked
   by the Chief Pilot) and assigned, aircraft performance/runway
   (dropped per operator — dataset floor is 5,000', not worth
   checking), and crew duty-day limits under FAR 135 Subpart F.
   Outcome: "Ops Approved" or "Needs Further Review" with a reason.
2. **Ops Approved** — FBO assigned for all segments; passenger
   information collection becomes available to the client (today it
   goes out immediately at booking — this is a real behavior change,
   delaying it to this gate); passenger + crew manifests generated,
   ops sends the client their itinerary; crew notified via "their
   crew app" (doesn't exist yet — see below).
3. **Ops Released** — once everything above plus payment is
   confirmed, ops releases the trip to the crew (an FAA-significant
   moment) — must be clearly visible to crew as released.

**Duty-time rule (FAR 135 Subpart F), scoped directly by the
operator:**
- §135.263 (general, all ops) + §135.267 (unscheduled 1–2 pilot
  crews) are what apply — this is on-demand charter, not scheduled
  service, so §135.265 doesn't apply. §135.269 (3/4-pilot crews),
  §135.271 (HEMES), and §135.273 (flight attendants) are skipped
  unless the operator confirms they actually crew trips that way.
- "Total flight time in all commercial flying" (500/qtr, 800/2 qtrs,
  1,400/yr) — JetDeck only sees hours flown on JetDeck-booked trips.
  Operator's answer: crew self-report any other commercial flying to
  the Chief Pilot — so the system needs a Chief-Pilot-maintained
  baseline/adjustment per crew member that JetDeck-tracked trip hours
  accrue on top of, not an assumption that all flying goes through
  JetDeck.
- Duty period = first leg's scheduled departure **minus 90 minutes**
  through last leg's scheduled arrival **plus 60 minutes** — exact
  numbers given directly, not a guess.
- The quarterly/annual hour caps and "13 rest periods of ≥24 hours
  per quarter" need a full rolling duty-period history to mean
  anything, not just the trip under review — proposed as a **crew
  compliance dashboard** (continuous monitoring/flags) rather than a
  hard gate on one trip's checklist. Operator confirmed this is the
  right call and explicitly wants it built eventually — "that is
  something to add to the backlog" — but not now. The per-trip checks
  (24-hour flight time cap, required rest immediately before, the
  14-hour duty period option) are a hard Ops Review gate; the
  quarter/year/13-rest-periods rules feed the future dashboard
  instead.

**Not yet resolved / still needs a decision before building:**
- Whether crew qualification fields and the "other commercial hours"
  baseline are editable by anyone who can already edit Crew today, or
  need a real Chief-Pilot-restricted permission — JetDeck has no
  role system below "operator admin" yet, so a proper Chief Pilot
  role is its own small project.
- The "crew app" mentioned in Ops Approved/Released doesn't exist —
  crew have no login at all today. Whether to substitute an email
  notification for now (same pattern as the print-manifest standing
  in for real PDF generation) or treat the crew app as a prerequisite
  hasn't been decided.
- Whether §135.273 (flight attendants) matters — `CrewMember.role`
  already has a `flight_attendant` option; need to know if it's
  actually used before deciding whether to build FA duty rules.
  **Resolved**: flight attendants are listed under Crew on the
  manifest, but are operationally "no different than a passenger" —
  no duty-time or qualification rules apply to them. §135.273 skipped
  entirely; `PILOT_ROLES` (captain/first_officer only) gates every
  qualification and duty-time check.
- **Resolved**: don't build a Chief Pilot permission tier yet — the
  new qualification fields are editable by anyone who can already
  edit Crew today (`/ops/crew/[id]`), same access as always.

## Ops Review checklist — automated aircraft/crew/duty-time gate (Round 1)

First buildable slice of the Ops Build Brief v2 flow above: the
automated Ops Review checklist itself, gating a new `ops_approved`
stage. Ops Approved/Released (FBO-gated manifest release, crew app,
payment-gated release) are follow-up rounds, not built yet.

- ~~**`CrewMember` qualification fields — shipped**~~: `qualified`
  (Chief Pilot's manual sign-off — deliberately not derived purely
  from dates, per the operator's own framing: "the Chief Pilot is
  responsible for marking crew as qualified"), `medicalExpiry`,
  `trainingExpiry` — editable on `/ops/crew/[id]`, surfaced as a
  Qualified column on `/ops/crew`. `PILOT_ROLES`/`crewQualificationStatus`/
  `QUALIFICATION_STATUS_LABELS` added to `lib/crew.ts` — an expired
  date overrides a stale "qualified" checkbox so a lapsed certificate
  can't silently pass.
- ~~**`AircraftDowntime` model — shipped**~~: dated maintenance windows
  (not a status flag) so a future window can be entered ahead of time
  and checked against a specific trip's dates, not just "is it down
  right now." Small add/remove UI on `/fleet/[id]`.
- ~~**`lib/duty-time.ts`: §135.263 + §135.267 compliance engine —
  shipped**~~: `computeDutyPeriod` (report 90 min before first
  scheduled departure, released 60 min after last scheduled arrival —
  exact numbers given directly, not a guess; arrival derived from
  departure + flight hours rather than trusting a stored `arrTime`
  with no day-offset attached) and `checkDutyCompliance` (24-hour
  flight-time cap — 8hr solo/10hr two-pilot —, the 14-hour duty-period
  limit, and >=10 hours rest immediately before/after against a
  pilot's other trip assignments). Deliberately scoped to what a
  single trip can verify from JetDeck's own data — the quarterly/
  annual flight-hour caps and "13 rest periods of >=24 hours per
  quarter" need a full rolling history (including any commercial
  flying outside JetDeck, which this system can't see) and are
  explicitly deferred to the future crew compliance dashboard, not
  built as a gate here.
- ~~**`lib/ops-review.ts` + checklist panel + "Approve for Ops" —
  shipped**~~: `evaluateOpsReview()` runs all three checks (aircraft
  availability — booking conflicts via the existing
  `findConflictingBooking` plus the new downtime windows; crew
  qualification; duty-time compliance for every assigned pilot) and
  is called both to render the checklist and, again, server-side
  inside the `approveForOps` action before it actually flips the
  trip's status — so the button being enabled and what the action
  actually enforces can never drift apart. Brokered-aircraft trips
  skip the availability check with a note rather than failing it
  outright — JetDeck has no visibility into a third-party operator's
  maintenance schedule to check in the first place.
- ~~**New `ops_approved` stage, inserted after `crew_assigned` —
  shipped**~~: `TRIP_STAGES` in `lib/trip.ts`. The Ops Board's generic
  "Next →" arrow (previously the only thing that moved a trip through
  any stage) now explicitly refuses to make this one specific jump —
  it's disabled with an explanatory tooltip whenever the next stage
  would be `ops_approved`, forcing that transition through the gated
  action on the trip detail page instead. Every other stage
  transition is untouched.

## Ops itinerary editor gets the Quote Builder's flight-time/arrival-time logic

User caught a real gap: editing an airport or departure time in the
new ops itinerary editor (previous round) left `flightHours`/`arrTime`
stale — both the client-facing pages and the new duty-time compliance
check read those as if they were still accurate.

- ~~**`updateLegDetails` recomputes flight time and arrival time on
  save — fixed**~~: ported the exact same logic the Quote Builder uses
  live — `estimateFlightHours(greatCircleDistanceNm(...), cruiseSpeedKts,
  defaultBlockTimeBufferHours)` for flight time, `addHoursAcrossTimezones`
  for arrival time — so editing an airport or time now keeps both in
  sync instead of silently drifting. Only recomputable for an owned-
  fleet aircraft (`BrokeredAircraft` has no cruise-speed data); a
  brokered trip keeps whatever flight time it was quoted with.
- ~~**Arrival Time is no longer a free-text input — fixed**~~: since
  it's always derived now, a manually-typed value would just look
  like an override that silently gets discarded on the next save —
  replaced with a read-only computed display (`to12Hour` +
  `tzAbbreviation`, same helpers the client pages use) plus a flight-
  time caption, so what's shown always matches what the itinerary
  actually has stored.

## Real bug: timezone-aware time math was silently a no-op everywhere except quoting

User reported the ops itinerary editor's arrival time still wasn't
shifting across time zones despite the previous round porting over
the Quote Builder's exact logic. Root cause was much bigger than the
one page — `Airport.timezone` has **never actually been populated** in
the database (the OurAirports import never included it); the only
place that ever worked was `lib/airport-server.ts`'s
`getAirportsByIcao`/`searchAirports`, which already had a fallback
(`tz-lookup` on lat/lon) precisely because of this — but every other
place that needed timezone data queried `Airport` directly and used
the (always-null) stored column, silently getting "same zone" naive
math with no error.

- ~~**`resolveAirportTimezone` extracted to `lib/geo.ts` — fixed**~~:
  the same lat/lon fallback `lib/airport-server.ts` already had,
  pulled out as a plain, auth-free function (no `"use server"`/tenant
  context) so it's usable from public client-facing pages too, not
  just authenticated ops code. `airport-server.ts` now delegates to
  it instead of keeping its own copy.
- ~~**Every direct `Airport` query that does time math now resolves
  through it — fixed**~~: `app/(ops)/ops/trips/[id]/page.tsx`
  (`updateLegDetails`'s recompute, and the Arrival Time display),
  `lib/ops-review.ts` (the duty-time engine's `tzByIcao` — this one
  matters most: `computeDutyPeriod` was silently using naive UTC-as-
  local-time math for every duty period, which could have produced
  wrong compliance results for any cross-timezone trip), `/q/[token]`
  and `/manifest/[token]` (the "time zone change" line and per-
  endpoint zone abbreviation on the itinerary cards, which had been
  silently coming up empty this whole time rather than visibly wrong
  — no error, just nothing shown).

## Flight time in the ops itinerary editor: pass-through, not auto-computed

Follow-up correction: the previous round's flight-time recompute
(distance/cruise-speed based) was the wrong direction — user wants it
to just carry over from whatever the quote used and be directly
editable, same as the Quote Builder's own flight-time field.

- ~~**`flightHours` is now a real editable input, not a derived value
  — fixed**~~: `updateLegDetails` reads a new `flightHours-{index}`
  form field directly (falling back to the leg's existing stored
  value if left blank/invalid) instead of recalculating it from
  `estimateFlightHours`/`greatCircleDistanceNm` whenever an airport
  changes. Arrival time still auto-derives from departure time +
  flight time via `addHoursAcrossTimezones` (timezone-aware) — that
  part of the previous round stands; only where flightHours itself
  comes from changed.
