# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

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
  Step 13 — major, user is compiling fuller notes before we scope
  this properly): Quote Builder currently requires manually typing
  flight hours, which is real friction and error-prone. Direction:
  compute it instead of asking for it. Would need:
  - Real performance data on Aircraft (cruise speed at minimum,
    possibly fuel burn) — currently only `rangeNm` exists
  - A way to resolve airport locations (ICAO → lat/long) to compute
    distance — either a bundled airport database or an aviation API
  - Flight hours and repositioning hours become calculated fields,
    not manual entry
  - Would also sharpen opportunity scoring's positioning logic, which
    is currently qualitative ("requires repositioning from X") rather
    than an actual hours estimate
  General theme to keep in mind going forward: reduce manual data
  entry everywhere automation is realistically possible, not just
  here — revisit other steps with this lens too once this is scoped.
