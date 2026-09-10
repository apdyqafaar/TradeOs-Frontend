# Slice 5 — Projects, and the public client page

Built 2026-09-10 against `docs/contracts/projects-announcements.md` (the verified
contract, `file:line` per claim) and design canvas artboard `2l`. Announcements are
the other half of that contract and were already built; this covers projects only.

Everything below is either a decision that cost something to make, or a fact the
code cannot tell you.

---

## 1. The share token: what was built and why

**The fact the whole slice bends around:** the token is 32 random bytes, returned
**exactly once** by the `publish` that mints it, and stored server-side only as a
SHA-256 hash (`lib/tokens.ts:4,11-12`, `project.model.ts:31`). No read endpoint
returns it. `publish` on an already-hashed project answers `shareToken: null` —
the old link still works, but the plain value was never stored and cannot be
re-issued (`project.service.ts:333-338,348`). The only recovery is
`regenerate-link`, which invalidates every link already given to a client.

### Where the token is kept — and where it is deliberately not

`features/projects/share-token-store.ts`: a **module-level `Map`**, plus a
`useSyncExternalStore` reader (`hooks/use-share-token.ts`).

- Survives client-side navigation within the tab, so clicking away from a project
  and back still finds the link.
- Dies on refresh or tab close.
- **Not `localStorage`, not `sessionStorage`, and that is the decision.** A share
  token is a bearer credential: anyone holding it can read the project's public
  page. Disk-backed storage would keep it readable by any later script on the
  origin and by the next person on a shared machine, indefinitely, in exchange
  for surviving one refresh. The trade taken is: lose it on refresh, say so
  plainly, and offer the documented recovery with its price named.
- **Cleared on unpublish and on delete.** The public lookup filters on
  `isPublished: true` with no cache and no grace period
  (`project.actions.ts:130-131`), so a Copy button still offering that URL would
  be handing a client a 404 — the "stale link" case the brief forbids.
- **A `null` token is never written over a held one.** On a re-publish the server
  says `null`; if this tab captured the value on the original publish, that is the
  only copy in existence and erasing it would destroy it. Guarded, and tested
  (`hooks/use-project-publish.test.tsx`).

### The share card has four states, not two

`components/share-card.tsx`. The canvas draws only state 2.

| | Condition | What it shows |
|---|---|---|
| 1 | never published | one button, and what publishing will expose |
| 2 | published, token held | the full URL in a selectable field, Copy, Regenerate, Unpublish |
| 3 | **published, token not held** | no URL at all; "the link still works for anyone holding it", and Create-a-new-link with its cost |
| 4 | unpublished after publishing | "Last shared …", plus "publishing again turns the previous link back on" |

**State 3 is the common one** — anyone opening a project published last week is in
it — and the canvas has no drawing for it. The rule enforced there and asserted in
`share-card.test.tsx`: render no URL, no placeholder, nothing that pattern-matches
a link. The three things that all have to be true at once in the copy are that the
client's link works, that this screen cannot show it, and that the fix costs the
client's link.

Two more copy decisions that come straight from the contract:

- **Unpublish warns that the same link comes back on a re-publish, and that the
  URL will not be showable again.** Both halves are surprising and both are true.
- **Unpublishing does not revoke the images.** `cover.url` and `business.logo` sit
  on a public-read bucket with no signed URLs (`storage.ts:27-28`), so they keep
  resolving. The dialog says so rather than implying a clean revocation.

`ALREADY_PUBLISHED` (409) is treated as **success, not failure**: the state the
user asked for is the state the server is in. It sets a flag that tells them
somebody else published first, so the missing link is explained rather than
mysterious.

---

## 2. The public page

`app/p/[token]/page.tsx` → `features/projects/services/public-project.service.ts`
→ `components/public-project-view.tsx`.

- **No `requirePageAccess()`.** Confirmed rather than assumed: `proxy.ts`'s
  matcher literal is
  `"/((?!api/|_next/static|_next/image|p/|favicon.ico|.*\\.[\\w]+$).*)"` — `p/` is
  in the exclusion list, so an anonymous request never reaches the cookie check.
  The route is also outside `(app)`, so the real server-side gate in
  `app/(app)/layout.tsx` does not wrap it, and it has no `ROUTE_PERMISSIONS` row.
  The repo-wide test in `lib/auth/require-page-access.test.ts:119` walks
  `app/(app)` only, and both in-app pages satisfy it.
- **Fetched server-side with `fetch`, not the axios client.** That instance is
  built for the browser — `withCredentials`, a relative `baseURL`, a 401
  interceptor calling `window.location.assign`, a process-wide cache — every one
  of which is meaningless or wrong on the server. Same posture as
  `lib/auth/server-session.ts`.
- **A dead link renders a plain page**, `components/public-link-unavailable.tsx`:
  one heading, one sentence, and "ask whoever sent it to you for the current
  link". No error card, no request id, no retry, no shell, no sign-in link. The
  reader has no account and nothing here is retryable by them.
- **Every failure is the same answer.** Wrong token, malformed token,
  unpublished, regenerated, deleted, 429, 5xx, timeout, non-JSON body — all
  `null`, all the same page. The API's 404 bodies are byte-identical by design
  (`public-link.test.ts:168-191`), and a token over 128 characters is a **422**
  rather than a 404, so branching on status would be both leaky and wrong.
- **`dynamic = "force-dynamic"` and `cache: "no-store"`.** An unpublish takes
  effect on the API instantly; a cached page would keep serving a revoked project.
- **`robots: { index: false, follow: false, nocache: true, noarchive: true }`.**
  Not in the brief, added deliberately: the token is a bearer credential, and an
  indexed copy would put a business's private job into a search result recoverable
  only by regenerating — which breaks the client's link too. The `<title>` is the
  generic word "Project" for the same reason: a per-project title would leak the
  name into browser history, a tab bar during a screen share, and any link preview.
- The payload is **validated defensively** before it is rendered. It is the one
  body in the product with no session behind it and nothing upstream that has
  already checked it, so a 200 that is not shaped like a project renders the
  unavailable page rather than a half-drawn one.

---

## 3. Three things worth escalating

### 3.1 The public rate limit is now shared by *every* visitor, not per IP

`rateLimit({ name: "public-project", windowMs: 60_000, max: 60 })` is keyed on
`req.ip` with no token in the key (`public.route.ts:18`,
`rate-limit.middleware.ts:140-143`). Because this page is fetched **server-side**,
the API sees the Next server's IP for every reader of every share link. So the
ceiling is **60 public page loads per minute across the entire product**, and the
61st reader in a minute sees "this link is not available".

Mitigated slightly by shape-checking the token locally before spending a request,
so a crawler walking garbage tokens burns nothing. Not fixable from the frontend
beyond that. The options, all backend or infrastructure: raise the limit, key it
on `X-Forwarded-For`, or exempt the app's own egress. **Worth a decision before
a business emails a link to a hundred customers.**

### 3.2 The public payload has no timezone, so public dates are read in UTC

In-app screens format in the business's IANA zone, which comes from the session.
The public page has no session, and the payload carries instants with no zone
(contract §3.4). Three options, one honest:

- the *reader's* zone — shifts a due date by a day for anyone west of the business
  and makes one link say different things to different people;
- a guessed business zone — inventing data;
- the instant exactly as written, i.e. UTC. **Taken.**

Dates are written by the app as midnight in the business's zone, so reading them
back in UTC can land on the previous calendar day for a business east of
Greenwich (Nairobi's 1 January is `2025-12-31T21:00:00Z`). That is a known,
bounded, *uniform* inaccuracy. **Fixing it properly means adding `timezone` to the
public payload** — one field on `public-project.service.ts:46-49`. Recorded rather
than worked around. `<time dateTime>` carries the unmodified instant either way.

### 3.3 `TZDate.toISOString()` emits the offset form the API rejects

`@date-fns/tz`'s `TZDate` overrides `toISOString()` to return
`…T00:00:00.000+03:00` (`node_modules/@date-fns/tz/date/index.js:14-17`). The
backend's `z.string().datetime()` runs with `offset: false`, so **that exact
string is a 422** — and it is what the obvious code produces. `dateInputToIso`
reads the epoch back through a plain `Date` to get the `Z` form, and
`project.schema.test.ts` asserts both that it ends in `Z` and that it does not end
in an offset. This is the same bite as `dueDate` on `POST /sales`.

---

## 4. What the design asks for that the API cannot give

| Canvas element | Reality | What was built |
|---|---|---|
| Customer name on every grid card ("Mwangi Stores") | `customerId` is a bare id; the Customer collection is never touched on this path (contract §1.5). Naming twelve cards costs twelve requests. | `Customer —` with the id in `title`, following `stock-movements-table.tsx`'s "Who" column. The **detail** screen pays for one lookup and shows the real name. |
| A person's name on each update (`{{ u.who }}`) | `createdBy` is a bare **Member** id — no name, no `author` object, the exact opposite of an announcement (contract trap 4) — and there is no members slice to use. | Em dash with `title="Posted by member <id>"`. Traceable, not fabricated. |
| A short share URL (`tradeos.app/p/9f3c2a7b41`) | The token is **64** hex characters and there is no shortener. | The real URL in full, in a selectable read-only field. It is long; hiding it behind Copy alone would break the clipboard-refused fallback. |
| A live "Copy link" on any published project | The token is unrecoverable after the publish that minted it. | State 3 above. |
| A read-only progress bar in the update composer | Needs to be draggable and keyboard-reachable. | A native `range` with `accent-primary`; the picture lives elsewhere on the page. |
| "Regenerate" as a plain button | It kills every link a client holds, and is reached most often by someone who has just *lost* something and is not reading carefully. | Behind `ShareConfirmDialog`, with the cost as the first sentence. |
| A customer field | There is no combobox and no projects-side customer search. | A `<select>` of the first 100 active customers, gated on `customers:view`, with an explicit "current customer (not in this list)" option so an edit cannot silently try to detach. |

Also absent by necessity: **no search box on the grid** (`?search=` is a 422
`Unrecognized key`, not an ignored one) and **no sort control** (fixed
`{ createdAt: -1, _id: -1 }`).

---

## 5. Smaller decisions, recorded so they are not re-litigated

- **Four fields are one-way doors.** `description: null`, `customerId: null`,
  `startDate: null` and `dueDate: null` are each a 422. `projectPatch` never emits
  a `null` for any of them, so emptying the control does nothing — and the edit
  sheet says that in place rather than letting someone discover it by saving and
  reloading. Only `description` has a usable empty, `""`, which round-trips as
  `""` and not `null`; every screen therefore tests `?.trim()`, never `== null`.
- **Posting an update mutates the project**, and the composer only sends
  `progress` when the slider has actually been moved. An untouched slider must not
  silently rewrite the project's number. The sentence under it changes to name the
  side effect once it will happen, and says that deleting the note later will not
  undo it (it does not — `project.service.ts:305-315` has no progress logic).
- **The permissions are not what the route names suggest.** `POST /:id/updates` and
  `DELETE /:id/updates/:updateId` are both **`projects:update`**; publish,
  unpublish and regenerate all share **`projects:publish`**, so the share card is
  all-or-nothing. Both gated on the real strings, hidden rather than disabled.
- **`publishedAt` means "last published at"**, is refreshed by every publish and
  regenerate, and survives an unpublish. It is only ever rendered as "Last
  shared", never as current state.
- **Publish/unpublish/regenerate do not seed the detail cache.** They answer a
  different shape (`unpublish` carries one key), so spreading a `PublishResult`
  over a cached `Project` would write a field that shape does not have. They
  invalidate.
- **`POST` with no body at all** on the three publish routes. `noBodySchema` is
  `.strict()`, so `{}` is fine but `{ projectId }` is a 422; asserted in the
  service test so no wrapper can helpfully attach a payload later.

---

## Verification

- `bunx tsc --noEmit` — clean.
- `bunx biome check features/projects "app/(app)/projects" app/p` — clean, 36 files.
- `bunx vitest run features/projects` — **7 files, 65 tests, green.**
- `bunx vitest run lib/auth "app/(app)/layout.test.tsx"` — 31 tests green, i.e. the
  repo-wide `requirePageAccess` walk accepts both new in-app pages.
- Not verified in a browser: no dev server was started for this task.
