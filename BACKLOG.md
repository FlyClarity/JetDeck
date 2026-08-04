# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

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
  double. Worth spot-checking a handful of other previously-missing
  airports (if the user has more examples) to confirm this really was
  the complete fix and not just these two. Also worth eventually
  tracking down *why* the original import lost rows, in case the same
  process gets reused for a future data refresh.
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
- **Arrival-time timezone conversion doesn't flag a day change**: the
  new `addHoursAcrossTimezones` (lib/time.ts) correctly converts the
  computed arrival time into the destination's local clock, but a long
  or heavily-eastbound trip can land on the next calendar day and the
  UI has no way to show that today (`Arrives` is a plain time input,
  no date component). Worth a small "+1 day" indicator if this comes
  up in practice.
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
- **Double-booking detection is same-aircraft-only and date-only**
  (raised alongside cancel/decline): `acceptQuote`'s conflict check
  compares revenue-leg dates across other `accepted` quotes sharing
  the same `aircraftId` — it doesn't look at repositioning legs, don't
  account for time-of-day (two same-day legs that don't actually
  overlap in time still flag), and says nothing about crew
  availability (no crew-scheduling data exists yet). It's also
  advisory only, by design — the client's acceptance still goes
  through, and the operator resolves it manually via Cancel Booking.
  Worth tightening once there's real leg-time data to compare instead
  of whole-day granularity.
- **No dashboard view for cancelled bookings** (raised alongside
  Cancel Booking): cancelling an accepted quote moves it to a
  `cancelled` status with no tab to find it again afterward — same gap
  already noted above for `declined` quotes. Both should probably be
  solved together once there's enough terminal-state volume to
  justify a tab (or a combined "Inactive" filter).
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
- **Stripe card hold link in the acceptance email** (Step 17, not
  started): the confirmation email sent on accept currently tells the
  client wire instructions and says a card-hold link is coming
  separately, since there's no Stripe integration yet to generate one.
  Once Step 17 lands, that email should include the real Payment Link.

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
  Known gap: declining a sent quote (or a client declining by email)
  moves it out of every visible tab — there's no "Declined" view yet
  to see where it went, matching the original brief's status list
  (Draft/Sent/Accepted/**Declined**/Expired/Passed) which only
  partially exists today. Worth adding once there's enough of that
  state to be worth a tab.

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
  (raised after Step 14): today Escape only does something on the
  dashboard itself (closes the detail pane). Inside `/quotes/new` or
  `/quotes/[id]`, there's no keyboard way back, and — this is the
  real ask — no autosave, so navigating away any other way loses
  unsaved edits. Two things to design before building: (1) autosave
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
