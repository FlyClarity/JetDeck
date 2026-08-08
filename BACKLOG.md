# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

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
- **Operator logo upload** (raised alongside the client quote page's
  missing logo): `Operator.logoUrl` and the Settings field only accept
  a pasted URL to an already-hosted image. There's no file upload —
  worth adding via Vercel Blob (same tool already flagged for aircraft
  photos above) once there's appetite to batch image-upload work
  together.
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

- **Aircraft photos + expanded amenities** (raised after Step 5): Fleet
  currently only tracks `hasWifi` as a boolean. Eventually needs:
  - Photo upload/gallery per aircraft (Vercel Blob is the natural fit
    since we're already on Vercel)
  - Amenities as a flexible list (e.g. JSON array like
    `["wifi", "galley", "lavatory", "flat_screen"]`) rather than one
    boolean column per amenity

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

- **Multiple itinerary variations per quote** (raised after Step 13.5):
  the user asked about presenting two options on the same quote — e.g.
  the same trip priced from a more efficient departure airport vs. the
  requested one, so the client can pick. Not scoped or built yet, just
  flagging the design fork for when we get to it: (a) a `Quote` gets a
  `variants`/`options` array so one quote record holds N priced
  itineraries, client page shows a picker, or (b) each variation is
  its own sibling `Quote` row (new `quoteGroupId` or similar linking
  them) sent together. (b) fits the current schema with much less
  disruption — `Quote` is already a flat, self-contained pricing
  record — but (a) is the more natural authoring experience in the
  Quote Builder (duplicate a draft, tweak the airport, compare
  side-by-side before sending). Worth scoping properly before Step 14
  if the user wants to prioritize it, since it touches the client quote
  page (Step 15, not built yet) too — better to design it in from the
  start than retrofit.

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
