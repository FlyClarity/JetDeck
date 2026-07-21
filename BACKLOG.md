# Backlog

Ideas and requests noted for later — not part of the current Phase 1 build order.

- **Aircraft photos + expanded amenities** (raised after Step 5): Fleet
  currently only tracks `hasWifi` as a boolean. Eventually needs:
  - Photo upload/gallery per aircraft (Vercel Blob is the natural fit
    since we're already on Vercel)
  - Amenities as a flexible list (e.g. JSON array like
    `["wifi", "galley", "lavatory", "flat_screen"]`) rather than one
    boolean column per amenity
