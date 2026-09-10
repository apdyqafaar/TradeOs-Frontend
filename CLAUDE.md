@AGENTS.md

# CLAUDE.md

Guidance for Claude Code working in the TradeOs frontend. The design specification is
`docs/superpowers/specs/2026-09-07-frontend-ui-design-brief.md`; the API is documented in
`../Backend/docs/BACKEND-GUIDE.md`. When this file and the brief disagree, the brief wins for
*what* to build and this file wins for *how*.

## Where things stand (2026-09-10)

**Slices 1–3 are complete.** Auth, the shell and the Overview; products, categories, stock and
customers; and the counter, the receipt with its void flow, the debts list, debt detail with
payments and write-off, and manual debt creation.

**Not built:** the import wizard (`2e`), reports (`2i`), members and roles (`2j`), settings and
account (`2k`), projects (`2l`), announcements and Help Center (`2m`).

Verified 2026-09-10: 504 tests / 59 files, tsc and biome clean. Slices 2 and 3 were driven in a
real authenticated browser against a live backend — a credit sale rung up end to end at the
counter (stock moved, receipt rendered, debt opened and appeared named in the list), and the
category-protection fix confirmed on screen.

**Server-side page protection landed 2026-09-09** after the owner found that a forged cookie
reached the app shell. Confirmed live: `/overview` with a forged cookie answers 307 to `/login`
with no shell markup, and a live break-test — short-circuiting the session read — reproduced the
hole (200 plus a rendered sidebar) before it was restored.

## Runtime & commands

Bun, not Node — use `bun`, never `npm`.

- Install: `bun install`
- Dev server: `bun run dev` (http://localhost:3000)
- Production build: `bun run build`
- Typecheck: `bunx tsc --noEmit` — do this before claiming work is done.
- Tests: `bun run test` (vitest, ~3 s) · watch with `bun run test:watch`
- Lint + format: `bun run lint` (check) · `bun run lint:fix` (write)
- **Everything at once: `bun run check`** — typecheck, lint, test. Run it before saying you are done.

The API must be running separately (`cd ../Backend && bun run dev`). It listens on the port in `Backend/.env` — currently **8001** — and `API_ORIGIN` in `.env.local` must match it. Without it the shell
renders but every query fails; that is the expected offline state, not a bug.

## Architecture

Next.js 16 App Router on React 19 with the React Compiler ON — **do not add `useMemo`/`useCallback`
for referential stability**; the compiler handles it, and hand-memoising fights it. Tailwind v4
(CSS-first, no `tailwind.config`), shadcn "base-nova" built on **`@base-ui/react`, not Radix** —
the polymorphic prop is `render`, never `asChild`.

### The layering rule

```
page (app/) → components/ → hooks/ → services/ → lib/api/client
```

Mirrors the backend's `route → controller → service → db action`. Each layer is thin and none may
be skipped:

| Layer | Location | Job |
|---|---|---|
| Page | `app/(app)/<feature>/page.tsx` | Server Component. Layout, `Suspense`, metadata. Renders feature components. |
| Component | `features/<x>/components/` | Rendering and interaction. `"use client"` where it needs to be. |
| Hook | `features/<x>/hooks/` | **The only place `useQuery`/`useMutation` appear.** Owns keys and invalidation. |
| Service | `features/<x>/services/` | Typed API calls. No React import, no hooks. |
| Client | `lib/api/client.ts` | The one axios instance. Nothing else may create one. |

Supporting files per feature: `schemas/` (zod, mirroring the backend validator), `keys.ts`
(`createQueryKeys`), `types.ts` (the domain types the API returns).

**Scaffolding a new feature**: `.claude/skills/new-feature/` generates this whole shape. Its
templates are the canonical example — if the architecture changes, change them too.

### The API client

One axios instance, `withCredentials: true`, `baseURL` = `/api/v1`. Three interceptor
responsibilities and no more:

1. **Unwrap** the envelope, so services see domain data. `{ success, message, data, meta }` never
   escapes `lib/api/`.
2. **Normalize** every failure — including a dead network — into an `ApiError` carrying `status`,
   `code`, `message`, `fieldErrors`, and the `requestId` from the `X-Request-Id` header.
3. **Redirect once on a 401** that is not from an auth endpoint, and toast on a 429.

There is deliberately **no request interceptor attaching a token**. Auth is an httpOnly cookie the
browser sends by itself; adding one would be dead code that implies a token exists.

`ApiError` is branded with a `Symbol.for` rather than detected structurally — an `AxiosError` also
carries `status` and `code`, and a structural guard let raw axios errors escape unnormalized. There
is a regression test.

### Data fetching

- **Server state is React Query's. Client state is zustand's.** They never hold the same fact. The
  session lives in one query on `/auth/me`; no store copies it, so a role change cannot leave a
  stale permission behind.
- **List filters and pagination live in the URL** via `nuqs`, not in a store — shareable links,
  working back button, no state to synchronise.
- Query defaults are in `lib/query/client.ts` with a comment per choice. The one to know:
  **a 4xx is never retried** (the server's answer will not change), 5xx retries twice.
- Keys come from `createQueryKeys(scope)` so `invalidateQueries({ queryKey: keys.lists })` reaches
  every filter variant. Never hand-write a key array.

### Permissions

`lib/auth/permissions.ts` mirrors the backend catalog; a permission string is a typed value, so a
typo is a compile error rather than a button that silently never appears. Use `useCan(...)` or
`<PermissionGate>`; a user without the permission sees **nothing**, not a disabled control.

**Pick the permission that matches the action, not the page's name.** The Seller preset holds
`members:view` (sellers need to see who recorded a sale) and `customers:update`. So the Members
management page is gated on `members:invite`. This has already caused one wrong gate — check
`PRESET_SELLER` in `lib/auth/permissions.ts` before choosing.

### Routing and the proxy

`config/routes.ts` is the single source of truth for paths and navigation. Adding a page means
adding it there with its permission, or it will not appear in the sidebar.

`proxy.ts` (Next 16 renamed Middleware → Proxy; the file is `proxy.ts`, **not** `middleware.ts`) is
still an **optimistic cookie-presence check only** — it never fetches and never decodes the token.
It exists to avoid a flash of the shell before a redirect, and it forwards the request path on
`x-tradeos-path` for the layout below.

**The real server-side gate is `app/(app)/layout.tsx`** (added 2026-09-09, after the owner pointed
out that a forged cookie reached the shell). It is async: it reads the session cookie, calls
`GET /auth/me` against the API origin with `cache: "no-store"`, and decides before anything
renders — `/login?next=…` on no session, `/onboarding` on no organization, `ForbiddenScreen`
inside the shell when the route's permission is missing. **An unreachable API fails closed.** See
`lib/auth/server-session.ts` and `docs/findings/slice3-server-auth.md`.

`next.config.ts` rewrites `/api/v1/*` to the Express origin so the browser calls the API
same-origin. That keeps the session cookie first-party, removes CORS entirely, and is what lets
`proxy.ts` see the cookie at all. Do not "simplify" it to a direct cross-origin base URL.

## Conventions that matter

- **Check `docs/API-ROUTES.md` before writing any service function.** It lists all 111 endpoints
  with their exact paths and permission gates, extracted from the backend source. If a path is not
  in it, the endpoint does not exist — do not invent one. Gate the UI on the same permission string
  the table names.
- **Branch on `code`, never on `message`.** Messages are for people and change freely. Codes are in
  `API_ERROR_CODE` in `lib/api/errors.ts`.
- **Never send an organization id.** The API resolves the tenant from the caller's session. If you
  find yourself typing `organizationId`, something is wrong.
- **Money is 2 dp, quantities up to 3 dp**, formatted through `lib/format/money.ts` with the
  currency **code**, not a symbol (`USD 1,250.00`) — this market mixes currencies whose symbols
  collide. Dates go through `lib/format/date.ts` and always take the **business timezone**; there is
  no safe default for either, so thread them from the organization rather than hardcoding.
- **Ids on the wire are `id`, not `_id`.** Every controller maps through a `publicX` shaper that
  reads Mongoose's `id` virtual; raw documents never reach the wire. Nested references are
  `.toString()`'d strings.
- **Every list handles six states** (brief §8.4): loading skeleton, empty, filtered-empty, error
  with the request id, 403, and the relevant 409 domain code shown where the action was taken.
- **Server Components by default.** Push `"use client"` as far down the tree as it will go; a page
  that is a client component drags its whole subtree into the bundle.
- **`import type` for type-only imports.** Double quotes, semicolons, 2-space indent — biome
  enforces it, so just run `bun run lint:fix`.
- **`components/ui/` is vendored shadcn.** Regenerate it, do not hand-edit it. `biome.json` has an
  override disabling one a11y rule there for that reason.
- **Read `node_modules/next/dist/docs/` before using an unfamiliar Next API.** This version has
  breaking changes from training data — Middleware→Proxy is one, and it will not be the last.

## Testing

Vitest + happy-dom + Testing Library. Config is `vitest.config.mts` (**`.mts` deliberately** — as
`.ts` it is loaded as CommonJS and the ESM imports warn today and break later).

- Test the API layer, hooks, stores and formatters. Components get tests when they hold logic worth
  protecting, not for rendering a div.
- Mock at the **axios adapter**, not by stubbing your own service — that way the interceptors, which
  are where the subtle bugs live, are actually exercised.
- Two real bugs were caught this way already: a structural `isApiError` that also matched
  `AxiosError`, and a header lookup that missed `X-Request-Id` because `AxiosHeaders` preserves the
  casing it was set with. Both have regression tests. Keep that standard.

## Open items for the owner

- **Contrast: design fidelity wins — decided 2026-09-07, not open.** The primary button (#D97757
  with off-white text, 3.0:1) and the active nav pill (#D97757 on #F6E7DF, 2.6:1) are below WCAG AA
  for small text. The owner chose to match the design canvas exactly. `app/globals.test.ts` locks
  both values — if it fails, someone is "fixing" the contrast. Ask before changing it.
- **`typedRoutes` is off** in `next.config.ts` — it would type `Link href` to routes that exist, and
  most paths in `config/routes.ts` have no page yet. Turn it on once the route tree is complete.
- **A dead network is not retried** (`ApiError` uses status 0, which the retry policy treats as
  final). If the mobile-heavy market makes offline blips common, exempt status 0 — it is one line.

## Findings

`docs/FINDINGS.md` holds what was learned building this that the code cannot tell you — open
decisions for the owner, bugs that shipped green once, and gotchas with real cost. Read §1 and §2
before starting a slice. Per-task detail is in `docs/findings/`.

Two entries there change how you work and are worth repeating here:

- **The client permission layers are UX, not security** — still true, and still not a boundary.
  `proxy.ts` checks only that a cookie exists; `RouteGuard` and `PermissionGate` hide what the
  caller cannot use. What changed on 2026-09-09 is that they are no longer the *only* thing in
  front of a page: `app/(app)/layout.tsx` validates the session server-side before rendering, and
  `login-form.tsx` no longer pushes an unvalidated `?next=` (that was an open redirect —
  `//evil.example` walked the user off-origin right after they typed their password). **The API is
  still the only thing protecting DATA**; the server gate protects pages.
- **Money direction.** `exchangeRate` is units of *main* per one unit of *exchange*, so converting
  to the main currency **multiplies**. The inverse reads more naturally out loud, which is exactly
  how it shipped backwards once.

## Compact Instructions

Auto-compaction is configured in `~/.claude/settings.json`: `autoCompactEnabled: true` with
`autoCompactWindow: 800000` — a **token count, not a percentage**, which is 80% of this model's
1M window. The schema requires an integer between 100,000 and 1,000,000, so a value like `80` is
rejected outright.

When compacting this project, preserve in this order:

1. **Open decisions in `docs/FINDINGS.md` §1** and any ruling the owner has made — the contrast
   ruling, the slice scope, anything answered through a question. A re-litigated decision costs
   more than the context it saved.
2. **Bugs found and their evidence**, especially ones that shipped green: the money-direction
   inversion, the dropped two-factor challenge token, the partial-update defaults. Each was
   invisible to the test suite, so a summary that drops them loses the only record.
3. **Which slice and task are in flight**, what has been pushed, and what any running agent owns.
4. **Corrections to the plan or the brief** — several field names and API claims were wrong and
   were fixed in place; the fix matters more than the narration around it.

Safe to drop: tool output already written to a file, file listings, the step-by-step of work that
landed and was committed, and any agent report whose durable content is already in
`docs/findings/`.
