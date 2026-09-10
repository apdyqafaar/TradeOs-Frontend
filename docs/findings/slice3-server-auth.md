# Slice 3 — Server-side auth for the app shell

Added the first real server-side gate this app has had: `app/(app)/layout.tsx` is now `async` and
validates the session against `GET /auth/me` before anything under it renders. `proxy.ts` keeps its
optimistic cookie-presence check and gains one job — forwarding the request path so a Server
Component can resolve the route's permission. The client guards stay, for reasons set out below.

Verified: `bunx tsc --noEmit` clean, `bunx biome check .` clean, `bunx vitest run` 59 files /
500 tests green, and `bunx next build` succeeds across 22 routes.

---

## What was actually unprotected before

**What:** Nothing on the server checked whether a session was real. `proxy.ts` called
`request.cookies.has(serverEnv.sessionCookieName)` and nothing else — no fetch, no decode, no
validation. So this, typed into any browser console on the origin, got you the rendered dashboard:

```js
document.cookie = "tradeos_session=anything";
location.href = "/overview";
```

The proxy saw a cookie, waved the request through, the shell server-rendered, the browser hydrated,
`useSession` fired `GET /auth/me`, the API answered 401, and only then did the axios interceptor
send the visitor to `/login`. Every protected page was therefore protected by a *client component
choosing to leave*.

**Evidence:** `proxy.ts` before this change, and the two guards it delegated to —
`components/layout/app-gate.tsx` (`useSession` + `router.replace` in an effect) and
`components/layout/route-guard.tsx`. Both are explicit in their own comments that they are "a UX
layer, not a security boundary". They were right; nothing else was covering the boundary.

The exposure was rendered HTML, not data: every API endpoint is enforced by `requireAuth` /
`requirePermission`, so the forged-cookie visitor saw the shell's chrome and empty panels, never a
real customer or sale. That is still a real leak — the shell names the business, the nav names the
features, and the whole thing reads as "you are in".

**So what:** it is closed. `app/(app)/layout.test.tsx` has a test named for exactly this case
("sends a caller whose cookie the API rejects to /login"), and the break-test below shows it is the
test that dies first if anyone reverts the gate.

---

## What is enforced where now

The chain a request for `/reports` passes through, in order:

| # | Where | Runs on | Decides |
|---|---|---|---|
| 1 | `proxy.ts` matcher | Edge | Whether the proxy runs at all. Excludes `/api/*`, Next internals, `/p/*` and anything with a file extension. |
| 2 | `proxy.ts` — cookie presence | Edge | No cookie + inside `APP_SHELL_PREFIXES` → 302 to `/login?next=…`, no fetch. Cookie + `GUEST_ONLY_PATHS` → 302 to `/overview`. |
| 3 | `proxy.ts` — path header | Edge | Sets `x-tradeos-path` to `pathname + search` on a copy of the incoming headers, so a Server Component can read it. Always `set`, so a forged value never survives. |
| 4 | `lib/auth/server-session.ts` | Node, per request | Reads the cookie via `cookies()`, calls `GET {apiOrigin}/api/v1/auth/me` with `cache: "no-store"`, a 10s abort and only that one cookie forwarded. Returns the session or `null`. |
| 5 | `app/(app)/layout.tsx` | Node, per request | `null` → `redirect("/login?next=…")`. No `organization` → `redirect("/onboarding")`. Otherwise resolves `ROUTE_PERMISSIONS` via `resolveRoutePermission` and renders `<ForbiddenScreen>` **inside the shell** when the permission is absent. |
| 6 | `AppGate` | Browser, continuous | Session lost or organization gone *after* mount. |
| 7 | `RouteGuard` | Browser, continuous | Permission for a page reached by client-side navigation. |
| 8 | The API | Every request | `requireAuth`, `requireMember`, `requirePermission`. Still the only thing that actually protects data. |

Steps 4–5 are new. Nothing else in the list changed behaviour.

---

## The break-test: the gate is what the tests are testing

**What:** With `readServerSession` short-circuited to trust the cookie — returning a synthetic
owner session as soon as a cookie exists, never calling the API — **10 of 19 tests in
`app/(app)/layout.test.tsx` went red**, including the one that matters:

```
FAIL > sends a caller whose cookie the API rejects to /login
FAIL > sends a caller the API forbids to /login
FAIL > sends an authenticated user with no organization to /onboarding
FAIL > refuses a page the caller lacks the permission for, inside the shell
FAIL > calls /auth/me on the API origin, uncached, with the session cookie
FAIL > treats an unreachable API as unauthenticated
FAIL > treats a 500 as unauthenticated
FAIL > treats a 200 that is not a session as unauthenticated
FAIL > treats an unparseable body as unauthenticated
FAIL > resolves the permission from the path alone, ignoring the query
```

The nine that stayed green are the ones that should: "no cookie → /login" (the proxy's case, which
the break did not touch), the happy paths, and the filesystem assertions about the `(auth)` group.
The failure output showed the broken layout returning the full shell — `HydrationBoundary → AppGate
→ … → RouteGuard → the page` — for a request the API had rejected, which is precisely the bug this
work removes, reproduced on demand.

**So what:** the suite is coupled to the decision, not to the markup. Restored and re-verified: 19/19
green, and the full run is 500/500.

---

## What the client guards still cover, and why deleting them would be a regression

The layout runs **once**, for the request that entered the `(app)` segment. Two things happen after
that which it cannot see:

1. **Client-side navigation.** Clicking from `/overview` to `/reports` is a client transition; the
   layout does not re-run, so its permission decision is stale for every page after the first.
   `RouteGuard` re-resolves on `usePathname` and is the only check between those two moments.
2. **A session that ends mid-visit.** Signing out on another device, an admin revoking the session,
   or the cookie simply expiring while someone reads a page. The layout finished minutes ago;
   `AppGate` notices because the query underneath it does.

Both are written into the comments on `AppGate`, `RouteGuard` and the layout itself, in the form
"not made redundant by the server check, and not to be deleted as a duplicate", because the shape of
this code invites exactly that deletion.

The double fetch is gone: the layout seeds the session it already fetched into the React Query cache
with `queryClient.setQueryData(authKeys.session(), session)` and a `<HydrationBoundary>`, so
`useSession` starts resolved. One `/auth/me` per page load, and no flash of `AppGate`'s "Setting up
your workspace…" for someone plainly signed in.

---

## `serverEnv.apiOrigin` defaulted to the wrong port — fixed as a default, not as a throw

**What:** `config/env.ts` defaulted `API_ORIGIN` to `http://localhost:8000`. This backend runs on
**8001** (`Backend/.env`: `PORT=8001`, and this repo's own `.env.example` already says 8001). It
worked only because `.env.local` overrode it. Now that the app-shell layout fetches on this origin,
a missing `.env.local` would not merely break the API rewrite — it would bounce every signed-in user
to `/login`, because an unreachable API fails closed.

**Evidence:** `Backend/.env:1`, `Frontend/.env.example`, and `config/env.ts:52` before the change.

**So what — and why not the loud-failure option.** The brief offered "make the default correct, or
make a missing value fail loudly at boot the way `publicEnvSchema` does". I made the default
correct, because **the loud option is unsafe in this file**:

- `config/env.ts` is in the *client* bundle — `lib/api/client.ts` imports `env` from it — confirmed
  by `grep -rl apiBaseUrl .next/static/chunks`, which hits.
- In the browser `process.env.API_ORIGIN` is `undefined` by design; only `NEXT_PUBLIC_*` and
  `NODE_ENV` survive.
- The current `serverEnv` object literal is side-effect-free and is therefore tree-shaken out of
  that bundle. Reproduce against a fresh `bunx next build`: searching `.next/static` finds
  `apiBaseUrl` in one chunk and `localhost:8001` in none. A top-level `if (!x) throw` is a side
  effect no bundler may drop, so it would ship to the browser and throw on load in production.

Trading "the dev port is wrong" for "the client app does not boot" is a bad trade. The clean way to
have both is to move `sessionCookieName` and `apiOrigin` into a `server-only` module of their own
and validate that with zod; that is a three-file change (`config/env.ts`, `next.config.ts`,
`proxy.ts`) and is left for whoever next touches env plumbing.

---

## `REQUEST_PATH_HEADER` lives in a file of its own because of the Edge bundle

**What:** `lib/auth/request-path-header.ts` exports one string and imports nothing.

**Evidence:** `proxy.ts`'s existing comment — "Paths are literals rather than imports from
`config/routes.ts` because that module pulls in the lucide icon set for `NAV_GROUPS`, and the proxy
bundle is evaluated on every matched request." `lib/auth/server-session.ts` imports
`config/routes.ts` (for `ROUTES.login`/`ROUTES.overview`) and `next/headers`, so the proxy cannot
import the constant from there.

**So what:** the two ends of the header contract share a literal without either dragging the other's
dependencies into the Edge bundle. Do not "simplify" this by inlining the string in `proxy.ts` — the
duplicate works exactly until someone renames one copy.

---

## Things found along the way

### The `next=` param is pushed onto the router unvalidated

`features/auth/components/login-form.tsx:81` does
`router.push(searchParams.get("next") ?? ROUTES.overview)`. A hand-crafted
`/login?next=//evil.example` is therefore an open redirect from the sign-in page. Nothing this slice
adds makes it worse — `readRequestPath` refuses any value that is not a same-origin absolute path,
so neither the proxy nor the layout can produce one, and there is a test for it — but the form
itself will still follow a value a user was emailed. **One line to fix, in the form, and it is not
fixed here** because it is outside this task's blast radius. Worth doing.

### Every route under `(app)` is now server-rendered on demand

`cookies()` and `headers()` are request-time APIs, and the Next docs are explicit that using one in
a layout opts the route into dynamic rendering
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, "Good to know").
The build confirms it: all twelve `(app)` routes print `ƒ` while `/login`, `/register` and
`/onboarding` — structurally similar, client-heavy, outside the group — stay `○`. This is correct
and unavoidable: a page whose visibility depends on who is asking cannot be prerendered. The cost is
that `/overview`, which has no request-time input of its own, is rendered per request.

### `/onboarding` sits outside `(app)`, and that is now load-bearing

The layout redirects a user with no organization to `/onboarding`. If that page were inside the
group the redirect would loop forever. It is in `app/(auth)/onboarding/`, and the build lists it as
a static route, so the layout never runs for it. Asserted rather than assumed —
`app/(app)/layout.test.tsx` checks the file's location on disk for `/onboarding` and for the other
four email-link paths (`/verify-email`, `/accept-invite`, `/forgot-password`, `/reset-password`),
because `proxy.ts` documents per path what breaks when one of them is put behind an auth gate.

### The gate fails closed on five distinct failures, and they are deliberately indistinguishable

No cookie, a 401/403, a 5xx, a body that is not a session, and a connection that never opened or
never answered all return `null`. There is no branch that treats "the backend is down" as "let them
in" — that is how one bad deploy becomes an open door, and it is the shape of bug that ships green.
The `fetch` also carries `AbortSignal.timeout(10_000)`: a backend that accepts the connection and
then never answers would otherwise hang the render for as long as the platform allows, and a
redirect to `/login` after ten seconds beats a page that never paints.

A 200 whose body is not shaped like a session is rejected too (`toSessionData`), because an HTML
error page from a proxy or a backend mid-deploy must not read as authorization.

### `GET /auth/me`'s envelope, verified against the backend rather than assumed

`Backend/src/controller/auth.controller.ts:90-107` wraps the payload in `successResponse`, i.e.
`{ success, message, data: { user, organization, role, permissions, twoFactorEnabled } }`, and
`Backend/src/app.ts:54` mounts the router at `/api/v1`. The server gate unwraps that envelope itself
rather than going through `lib/api/client.ts`, whose axios instance is built for a browser —
`withCredentials` (no ambient cookie jar on the server), a relative `baseURL`, a 401 interceptor
that calls `window.location.assign`, and a React Query cache it clears that on the server would be
shared between concurrent users.

Only the session cookie is forwarded, not the whole jar: the rest of the browser's cookies are none
of the API's business.
