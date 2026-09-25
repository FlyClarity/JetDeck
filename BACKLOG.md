# Backlog

Open items only — anything shipped has been removed. For the Part 135
ops/compliance rebuild specifically, see `OPS_BUILD_PLAN.md` instead of
here; a couple of items below that turned out to be compliance-shaped
were moved there rather than duplicated.

## Quoting & sales pipeline

- **CRM module** — still not started (explicitly deferred). A real CRM
  phase would need contact activity/interaction history across quotes/
  trips/emails, client-specific rate cards, tags/segments, and maybe a
  lightweight deal/pipeline view distinct from the Quoting Queue's
  operational focus. Worth its own scoping pass whenever there's
  appetite for it. `/contacts` is real CRUD today (detail/edit page,
  payment terms) but nothing CRM-shaped beyond that.
- **Create vs. Send Quote page — deeper redesign**: still one dense
  edit form for both creating and sending a quote. The ask was for the
  two stages to feel like genuinely different screens — e.g. a
  lighter "review" layout for a freshly-created draft vs. the current
  form, or a distinct confirmation step between Create and Send.
- **Pricing profiles per aircraft, by client type**: no way to give
  the same aircraft a different rate depending on who's asking (direct
  client vs. broker, or arbitrary named tiers). Not scoped — open
  questions: direct-vs-broker only, or operator-defined tiers; profile
  per-aircraft or an operator-wide default with overrides.
- **AI profitability / margin analysis on quotes**: `suggest-price.ts`
  and `score-opportunity.ts` are both cost-blind — no per-aircraft
  operating-cost basis (fuel burn, maintenance reserve, crew cost,
  insurance/hangar amortized per hour) exists in the schema. Natural
  fit to build alongside owner monthly settlement statements (below),
  which will need the same cost model.
- **Owner monthly settlement statements** — not built.
- **Invoice generation** — not built. `Trip.status` already has an
  `"invoiced"` value but nothing generates an actual invoice document.
- **Escape key in the Quote Builder doesn't go back**: every other
  page treats Escape as "back," but the Quote Builder excludes it
  since there's no autosave — an accidental Escape would discard
  unsaved pricing changes. Needs a design decision first: real
  background autosave vs. only saving on the explicit "leave" gesture.
- **Daily AI pass to re-surface passed one-way requests** that now fit
  a trip already on the books (e.g. a round trip to a city makes a
  previously-passed one-way request from that city viable as a
  connecting leg). Not scoped — needs a design pass on what "fits"
  means, how much slack counts as connectable, and where it surfaces
  (digest email, dashboard section, reopening the request itself).
- **Opportunity scoring's repositioning distance uses `Aircraft.
  currentBase`/`homeBase`**, not a live fleet-tracking feed — only as
  fresh as the last manual update. Would need a real ADS-B/tracking
  integration; out of scope for a quick fix.
- **Category-relaxed scoring may be noisy for single-aircraft-type
  fleets**: every off-preference match adds a parenthetical note,
  which fires on nearly every request when there's only one aircraft
  category. Revisit if it turns out to be more clutter than signal.
- **AI triage cost**: the merged classify+extract prompt
  (`classifyAndExtractEmail`) has never been tested against the live
  API end to end — needs a batch of real test emails run through the
  live inbound address to confirm classification/extraction accuracy
  before trusting it unsupervised.
- **Double-booking conflict check is same-aircraft/date-only**, not
  leg-time-aware (two same-day legs that don't actually overlap in
  time still flag), and doesn't account for repositioning legs or crew
  availability. Also not wrapped in a DB transaction — two genuinely
  simultaneous conflicting requests could both slip through as a
  narrow race; closing that needs serializable isolation or a unique
  constraint.
- **Multi-option quotes, two cosmetic gaps**: the "review before
  sending" preview only shows the first option's route/total, not all
  of them (the actual send is correct); the Send Quote email doesn't
  summarize each option beyond "N pricing options to choose from."
- **`/q/[token]` has no explicit branch for a cancelled quote**: a
  quote cancelled after acceptance falls through to the last
  conditional branch, which shows "Request to Book" rather than a
  real "this booking was cancelled" message. Low practical risk (the
  action itself still refuses), but worth a real branch.
- **Internal-trip quotes still render the full `QuoteBuilderForm`**
  (pricing fields, etc.) on the detail page instead of a stripped-down
  view suited to a zeroed-out, non-revenue record. Harmless, just
  unnecessary UI.
- **Quote Builder: editing a revenue leg's airport/date after
  "returns to base between each leg" is on** doesn't reactively move
  the adjacent auto-inserted repositioning legs to match.
- **Dashboard/Quoting Queue has no real pagination or archive view**:
  capped at the 500 most recent trip requests/quotes as a stopgap.
  Fine today; revisit if an operator's active (non-terminal) volume
  approaches that cap.

## Fleet & scheduling

- **Fleet Calendar gaps**: no month view (14 days only), no
  pending-quote tentative holds, no visual distinction between
  "flying that day" and "sitting away between two legs of the same
  trip" (both read as one plain "booked" block), and nothing from
  scoring/ranking surfaces on the calendar itself.
- **Bulk-import a fleet list from a URL** (an operator's public fleet
  page) — nice-to-have, not built. Needs a scoping pass: a plain
  server fetch won't render JS-heavy fleet pages, and whether
  extracted aircraft should be reviewed before adding or inserted
  directly.
- **Ops Board: completed trips just accumulate** in the last column —
  no archiving or graduation out of it once a trip's fully wrapped up.

## Payments (Stripe)

- **Confirm required webhook events are actually subscribed** in the
  Stripe dashboard — flagged at various points, never confirmed done:
  `checkout.session.completed`, `account.updated`,
  `payment_intent.processing`, `payment_intent.payment_failed` (the
  three original `payment_intent.*` events were already there).
- **Confirm Stripe Connect onboarding is fully complete** for Clarity
  Aviation itself (their account needs to be a proper connected
  operator account, not just running on the platform key).
- **No client-side "resume checkout"** if a client abandons the
  Stripe Checkout tab without completing it — today they're told to
  contact the operator, who can use the existing "Resend card hold
  link" button. A self-service resume button would close this but
  wasn't asked for yet.
- **ACH has no fee passthrough** (eating Stripe's ~0.8%/$5-cap ACH
  fee) — fine for now, easy to add a surcharge later if wanted.

## Email & domain

- **Reply-to-quote spam**: confirmed it's the *operator's own* inbox
  flagging a client's reply as spam, not the client's — caused by
  plain replies getting routed through the same `inbound.<domain>`
  relay built for AI triage, which breaks DKIM alignment for the
  original sender. Not fixable from the codebase alone; needs the
  operator to check how their mail routing is actually configured
  (Google Workspace routing rule vs. DNS MX straight at Postmark) and
  decide whether plain replies should skip the triage relay entirely.
- **Operator/broker self-service onboarding**: only one tenant
  (Clarity Aviation) has working inbound (Postmark) and outbound
  (Resend) email today, set up manually. Every new operator/broker
  will need their own inbound trip-request address and outbound
  sending domain configured before they can use JetDeck for real.
  Not scoped — open questions: subdomain under jetdeck.us (simplest,
  self-service) vs. the operator's own domain (more native, needs DNS
  work on their end); self-service Settings flow vs. support-assisted
  for now. Needs to slot into the Clerk `organization.created` webhook
  so a new org lands in a clear "email not yet configured" state.
- **Stale "Sent" quotes past their departure date — open diagnostic**:
  the expiry cron's logic looks correct on review and unconditional
  logging was added to `/api/cron/expire-stale`, but this was never
  confirmed against real production behavior. Check the Vercel
  dashboard's Cron Jobs tab, or get a concrete example (which quote,
  what departure date) if it recurs.

## Client-facing pages

- **`/manifest/[token]` doesn't have the wider/roomier/hero-photo
  treatment** `/q/[token]` got — same narrow container, same tiny
  aircraft caption instead of the photo-carousel hero. Natural next
  candidate for the identical redesign.

## Passengers & manifests

- **Saved passengers have no manual edit/delete UI**: a record is
  entirely auto-maintained from completed manifests (see
  `SavedPassenger` in `prisma/schema.prisma`), so a typo entered once
  (wrong DOB, misspelled name) sticks around under the Contact's
  "Saved Passengers" list until another completed manifest happens to
  reuse the exact same first/last name and overwrites it. Fine as a
  v1; a correction/delete affordance would close this.

## Small infrastructure fix

- **`/contacts` is missing from `middleware.ts`'s protected-route
  matcher** — page-level auth still protects it, just without the
  proper redirect-to-sign-in a route in the matcher gets. One-line
  fix, just never done as a drive-by when noticed.
