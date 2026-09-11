# Slice 6 — the announcements redesign, and unread tracking

Built 2026-09-10/11 on the owner's ask: make announcements *"look real, like Notion and real apps"*,
and *"let the menu see the user home if any new announcements are and he hasn't viewed"*.

## 1. The feed became a list, not a stack of cards

The old shape was a bordered card per notice with a full-bleed 16:9 cover. Three notices filled a
screen and the covers — decoration on most of them — carried more visual weight than the titles.

What it is now: **one row per notice** with a 68×52 (88×60 at `sm`) thumbnail on the right, the
title carrying the row, and the author and time receding to `text-muted-2`/`text-muted-3`. The
whole row is the click target via an `::after` overlay on the title's link, so there is one
tab stop per notice rather than three.

**The feed is grouped by time** — Pinned, then Today, Yesterday, Earlier this week, Earlier — which
is the shape a person already expects from every feed they use. Pinned sits above everything
regardless of age, which is what the API already sorts by, so the grouping never fights the server's
order.

### The grouping is where the bugs would have been

`lib/group-announcements.ts` is a pure function with a test each for the ways this goes wrong:

- it groups by the **business's calendar day**, not the browser's — an owner in London reading a
  Nairobi shop sees the shop's "Today";
- it counts **calendar days, not elapsed hours**, so a daylight-saving change does not shift a
  notice into the wrong bucket, and "Yesterday" still says Yesterday one minute after midnight;
- a `createdAt` in the future is filed under Today rather than silently dropped;
- an unparseable `createdAt` keeps its row;
- and one test asserts **no row is lost whatever the mix**, which is the failure the other tests
  would not catch individually.

## 2. Unread: a count, then the field that makes it visible

Three endpoints landed first: `GET /announcements/unread-count`, `POST /announcements/:id/read`,
`POST /announcements/read-all`. All on `announcements:view` — clearing your own badge is part of
reading a notice, and a Seller can see announcements, so a Seller must be able to clear their own.
Read state is keyed per **Member**, not per User: a person can belong to two businesses and
announcements are org-scoped.

### The gap that was nearly shipped

An aggregate count says *how many* are unread. **It can never say which** — the feed is sorted
`pinned, createdAt` and an unread notice may sit on any page. So the redesign's per-row dot had
nothing to drive it, and the frontend was written to degrade safely: `isUnread()` is
`readAt === null`, deliberately not `!readAt`, so an **absent** field draws nothing while an
explicit `null` means "tracked, and unread". `!readAt` would have collapsed the two and painted a
dot on every row in the feed — which reads as "this product thinks I have read nothing".

That degradation was correct and it was also only half the feature: the badge told you *that* there
was something new and the feed could not tell you *which*. So `GET /announcements` now carries
`readAt` on every row, resolved against the calling member in one `$in` for the page.

**The key is present on every row — `null` or an instant, never absent.** That is the whole
contract, and it is break-tested on the backend: omitting the key for unread rows instead of
sending `null` reddens exactly the two tests that assert it. Two members reading the same notice get
different answers, which is why it is attached per request and not stored on the announcement.

`GET /announcements/:id` deliberately does **not** carry it. The reading view marks the notice read
on arrival, so the value would describe a state that is already gone before anything renders.

## 3. The badge, and why it is a registry

One nav item needs a live number and eleven do not. The nav is rendered three times over (aside,
rail, mobile drawer) inside a layout that is on screen for the entire session. Four shapes were
considered and the rejected three are written out in `components/layout/nav.tsx`:

- a `useQuery` in `NavGroups` makes the **whole nav** a data-fetching component — eleven links
  re-rendering on a refetch of a count none of them use;
- a `count` prop threaded from the shell spells a fact about announcements into three layout files
  that have nothing to do with announcements;
- putting the component itself on `NavItem` drags React Query and the announcements feature into
  `config/routes.ts`, which **Server Components and the server-side page gate import**.

What shipped: the config names a token (`NavBadgeKey`), `nav.tsx` maps the token to a component, and
the badge owns its own query. Exactly one `<li>` subscribes to anything.

Details that are not decoration:

- **It renders nothing when there is nothing to say** — not a zero, not an empty pill, not a
  loading placeholder. `undefined` (loading, or a failure that must never surface in the chrome of
  every screen) and `0` are the same thing on screen: absence. A pill that appears and then fills in
  is a layout shift in the one component that is always visible.
- **It is announced as part of the link.** The `sr-only` text sits inside the anchor, so the
  accessible name is "Announcements, 3 unread" rather than a loose "3" beside it; the visible pill
  is `aria-hidden` so the number is not read twice.
- **The collapsed rail gets a dot, not a pill**, positioned against the link — which is why
  `relative` is on the link. The `ring-sidebar` is load-bearing: without a ring in the sidebar's own
  colour the dot merges into the icon beneath it at exactly 40px wide.
- **The count is invalidated, never decremented.** Client-side arithmetic on a number the server
  owns is how a badge ends up saying 2 when the truth is 0.

## 4. What the API would not allow

- **No search box, and no "Unread only" filter.** `listAnnouncementsQuerySchema` is
  `{ ...paginationQuerySchema.shape }` and `.strict()` — `page` and `limit` and nothing else, so
  `?search=x` is a 422 `Unrecognized key`, not an ignored parameter. A client-side filter over one
  page of twenty would confidently lie about the nineteen pages it cannot see. The redesign wanted
  an unread filter and could not have one: read state is three aggregate endpoints and no query
  parameter.
- **`limit` is kept out of the URL** too — nothing on screen can change it, and a URL-only knob that
  silently resizes the feed is worse than a fixed page.

## 5. Process note

This slice was built by a background agent that was interrupted twice — once by a stall watchdog and
once when the session ended — and it never wrote this file or reported. Its work was complete and
correct in the working tree and its tests passed; what was missing was the `readAt` field above, the
route inventory entries, and this record. **An agent's output is not done until someone has read
it**: the code was green and still only half the feature, and nothing in a passing suite said so.
