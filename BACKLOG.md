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
  Step 13; foundations built after Step 13.5 — still blocked on the
  airport dataset). Direction the user gave: compute block time
  instead of asking for it, default repositioning to return-to-home-base,
  charge an overnight fee instead when it doesn't. What's built:
  - `Aircraft.cruiseSpeedKts` — manual cruise speed field (fleet
    forms), manufacturer spec, entered once per tail
  - `Operator.defaultBlockTimeBufferHours` (default 0.2 hrs/leg,
    editable in Settings) — buffer for climb/descent/taxi on top of
    raw cruise-speed flight time
  - `Operator.defaultOvernightFee` (default $1,500/night, editable in
    Settings) — applied when a quote doesn't return to home base
  - `Quote.returnsToHomeBase` (defaults true), `Quote.overnightNights`,
    `Quote.overnightFee` — Quote Builder now has a "returns to home
    base" toggle; unchecking it reveals a nights-away input and adds
    the overnight fee to the total instead of a return repositioning
    leg
  - Empty `Airport` model (icao/iata/name/lat/lon/elevation/timezone)
    scaffolded, ready for the dataset
  Still blocked: the actual distance/flight-time calculation. Needs
  the user's airport dataset imported into `Airport`, then: distance
  between dep/arr ICAOs (great-circle) → raw flight time from
  `cruiseSpeedKts` → + `defaultBlockTimeBufferHours` per leg →
  flight hours becomes a calculated field instead of manual entry.
  Would also sharpen opportunity scoring's positioning logic, which
  is currently qualitative ("requires repositioning from X") rather
  than an actual hours estimate.
  General theme to keep in mind going forward: reduce manual data
  entry everywhere automation is realistically possible, not just
  here — revisit other steps with this lens too once this is scoped.
