# Keyboard Shortcuts

A running list, kept up to date as each page gets built. Goal: a
Superhuman/Linear-style keyboard-first experience by the time Phase 1
wraps up. Nothing here needs to be built now — this is a reference to
implement in one deliberate pass later (naturally fits Step 20,
"Polish", which already calls out the command palette).

## Already implemented

**Quoting Queue** (`/dashboard`)
| Key | Action |
|---|---|
| `j` / `k` | Move selection down / up in the current list |
| `Enter` | Open the detail pane for the first item (if nothing selected) |
| `Esc` | Close the detail pane |
| `p` | Pass the selected request |

## Planned — global

| Key | Action | Notes |
|---|---|---|
| `Cmd/Ctrl+K` | Command palette — jump to any page, search quotes/requests/aircraft/contacts | Explicitly called out in the brief (Step 20) |
| `?` | Show a shortcuts help overlay | |
| `g` then `d` | Go to Dashboard | "go to X" pattern, like Linear/GitHub |
| `g` then `f` | Go to Fleet | |
| `g` then `r` | Go to Needs Review | |
| `g` then `s` | Go to Settings | |
| `g` then `t` | Go to Trips | once that page exists |

## Planned — Quoting Queue

| Key | Action | Notes |
|---|---|---|
| `q` | Open quote builder for selected request | Brief-specified. Blocked on Step 13 (Quote Builder) existing |
| `a` | Assign to teammate | Brief-specified. Blocked — no assignee concept on TripRequest yet; needs a schema decision first |
| `n` | Add internal note | Brief-specified. Blocked — TripRequest has no notes field (Quote has internalNotes, Contact has notes, TripRequest doesn't) |
| `1` `2` `3` `4` | Jump directly to a tab (Ready / All / Draft / Sent, etc.) | |
| `/` | Focus a search/filter input | Only useful once the queue has search |

## Planned — Needs Review (`/inbox/review`)

No keyboard nav exists on this page yet at all (it's click-only right
now). Once added:

| Key | Action |
|---|---|
| `j` / `k` | Move between review items |
| `c` | Create Trip Request for selected |
| `i` | Log as Inquiry |
| `d` | Discard |
| `Esc` | Deselect |

## Planned — Fleet

| Key | Action |
|---|---|
| `n` | New aircraft |
| `j` / `k` | Move between rows |
| `Enter` | Edit selected aircraft |

## Planned — Quote Builder (Step 13, not built yet)

| Key | Action |
|---|---|
| `Cmd/Ctrl+Enter` | Save / Send quote |
| `Esc` | Back to queue without saving |

## Open questions for the real implementation pass

- Where does the shortcut *listener* live — per-page (like the queue
  today) or one global provider in the `(app)` layout that routes by
  context? Global is cleaner for `Cmd+K` and `g`-prefixed nav; per-page
  is simpler for list-specific ones like `j`/`k`. Likely both.
- `a` (assign) and `n` (note) need schema changes first — worth
  deciding those fields once, not shortcut-by-shortcut.
- Need a consistent rule for "don't fire shortcuts while typing in an
  input" — the queue already does this (`INPUT`/`TEXTAREA` check) but
  it should probably be a shared hook once there are 4-5 pages doing
  it independently, instead of copy-pasted each time.
