@AGENTS.md

# CLAUDE.md

Guidance for Claude Code working in the TradeOs frontend. The design specification is
`docs/superpowers/specs/2026-09-07-frontend-ui-design-brief.md`; the API is documented in
`../Backend/docs/BACKEND-GUIDE.md`. When this file and the brief disagree, the brief wins for
*what* to build and this file wins for *how*.

## Where things stand (2026-09-07)

The **foundation is complete**; no product feature is built yet. What exists: the app shell
(sidebar, topbar, breadcrumbs, theme), the API client and error model, the query layer, the auth
session/permission hooks, the UI store, formatters, the shared `DataTable`/`EmptyState`, and a
feature scaffolder skill. `app/(app)/overview` and `app/(auth)/login` are placeholders that exist
to prove the wiring — replace them, do not extend them.

Verified at the time of writing: `bunx tsc --noEmit` clean, `bunx biome check` clean,
`bunx vitest run` 72 passing across 6 files, `bun run build` succeeds, and `proxy.ts` redirects
correctly in a live dev server.

Build features in the order the brief's §10 lists them.

## Runtime & commands

Bun, not Node — use `bun`, never `npm`.

- Install: `bun install`
- Dev server: `bun run dev` (http://localhost:3000)
- Production build: `bun run build`
- Typecheck: `bunx tsc --noEmit` — do this before claiming work is done.
- Tests: `bun run test` (vitest, ~3 s) · watch with `bun run test:watch`
- Lint + format: `bun run lint` (check) · `bun run lint:fix` (write)
- **Everything at once: `bun run check`** — typecheck, lint, test. Run it before saying you are done.

The API must be running separately (`cd ../Backend && bun run dev`, port 8000). Without it the shell
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
an **optimistic cookie-presence check only** — it never fetches and never decodes the token. It
exists to avoid a flash of the shell before a redirect. Real authorization is the API's 401/403.

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
