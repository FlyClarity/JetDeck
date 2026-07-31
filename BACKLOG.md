# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

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
  "quoted" status. Now `QuoteQueue` receives the operator's `Quote`
  rows alongside `TripRequest` rows and renders them per status
  (quote number, requestor, route, total, and a status-appropriate
  action label — "Continue draft →" / "Sent — view →" /
  "Accepted — view →"). These are plain link rows for now, not
  wired into the `j`/`k`/detail-pane selection machinery that
  TripRequest rows use, since a Quote isn't a TripRequest and forcing
  it through the same detail pane would need a larger refactor —
  worth doing once there's more to show per quote (e.g. once Step 16
  gives Accepted quotes a real accept record to display).

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
