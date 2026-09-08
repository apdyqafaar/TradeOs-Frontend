# Task 12 — Route protection

## Two rows in `ROUTE_PERMISSIONS` are not derivable from `docs/API-ROUTES.md`

**What:** Nine of the eleven guarded paths map straight onto the permission that gates the page's
primary endpoint. Two do not, and both are stricter than the endpoint the page reads from:

| Path | Chosen | The endpoint's own gate | Why |
|---|---|---|---|
| `/team` | `members:invite` | `GET /members` → `members:view` | The Seller preset holds `members:view` so a seller can see who recorded a sale. Gating on it would put member management in the counter staff's sidebar. |
| `/settings` | `organization:update` | `GET /organizations/current` → `organization:view` | Every member holds `organization:view` — it is what `GET /dashboard` runs on — so gating on it would gate nothing. The page exists to change the business, and every mutation on it (`PATCH /organizations/current`, `PATCH /organizations/current/currency`) is `organization:update`. |

Two more looked like judgement calls and were not: `/products/import` is `products:create` because
*every* `/products/import/*` row in the contract is `products:create` (intuition says `update`), and
`/team/roles` is `roles:view` because `GET /roles` is `roles:view` and no Seller holds it.

**Evidence:** `docs/API-ROUTES.md` §features/team, §features/organization, §features/products
(import); `PRESET_SELLER` in `lib/auth/permissions.ts`; the same reasoning already applied to the
Members nav item in `config/routes.ts`.

**So what:** The rule to copy for a future page is *the permission that gates the page's primary
**action**, falling back to its primary endpoint* — not the page's name and not always its read
endpoint. When the read gate is one every preset holds, it is not a gate.

## The map is preset-shaped, so a custom role can still meet a 403 inside an "ungated" page

**What:** `/overview` and `/announcements` are ungated by the plan, but their endpoints are not:
`GET /dashboard` is `organization:view` and `GET /announcements` is `announcements:view`. That is
correct for the three presets — Owner, Manager and Seller all hold both — but roles are editable
(`POST /roles`, `PATCH /roles/:id`), so a hand-built role without `announcements:view` would see the
Announcements nav item, pass `RouteGuard`, and get a 403 from the panel.

**Evidence:** `docs/API-ROUTES.md` rows `GET /dashboard | organization:view` and
`GET /announcements | announcements:view`; `PRESET_SELLER` in `lib/auth/permissions.ts` holds both;
`ROUTE_PERMISSIONS` in `config/routes.ts` has no row for either path.

**So what:** `RouteGuard` removes the *common* dead end, not every one. Every page still owes brief
§8.4 its own inline 403 state; do not treat the guard as permission to skip it. If custom roles turn
out to be widely used, adding `/overview → ORGANIZATION_VIEW` and
`/announcements → ANNOUNCEMENTS_VIEW` rows is a one-line change each — but note that gating
`/overview` gives a refused user nowhere to land, since the ForbiddenScreen's way out points there.

## `proxy.ts` does not know about `/onboarding`, in both directions

**What:** `/onboarding` appears in neither `APP_SHELL_PREFIXES` nor `GUEST_ONLY_PATHS`. So a
signed-out visitor who types `/onboarding` reaches the wizard and only discovers the problem when
the API answers 401; and a signed-in user with a valid cookie but no business who types `/login` is
bounced to `/overview` by the guest-only rule and then bounced again by `RouteGuard` to
`/onboarding` — two redirects to reach the right screen.

**Evidence:** `proxy.ts:26-45`; `RouteGuard` step 2 in `components/layout/route-guard.tsx`.

**So what:** The second case works and is cheap. The first is worth one line in `proxy.ts` when
someone next edits it (Task 5 and Task 6 both do) — but it belongs to whoever owns that file, not
here. Note also that `APP_SHELL_PREFIXES` is a hand-maintained second copy of the shell's path list,
kept literal on purpose so the proxy bundle does not pull in lucide: adding a page now means editing
`config/routes.ts` (`ROUTES`, `NAV_GROUPS`, `ROUTE_PERMISSIONS`) **and** `proxy.ts`.

## `organization: null` is the load-bearing signal, and it is only visible after `/auth/me`

**What:** `SessionData.organization` and `SessionData.role` are `null` — not absent, not undefined —
for a registered user who has not created or joined a business. Nothing in the session *cookie*
carries that fact, which is exactly why this check cannot move into `proxy.ts`: the proxy sees a
cookie and nothing more, and the Next docs say Proxy must not be used as a session or authorization
solution.

**Evidence:** `SessionData` in `features/auth/services/auth.service.ts`; the Proxy note in
`CLAUDE.md`; `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` confirms
`redirect` may be called in a Client Component during render, which is what makes the client-side
guard possible at all.

**So what:** Read `data.organization === null` for "has not onboarded". Do not infer it from
`permissions.length === 0` or from a 403, and do not add a server-side check that would need a fetch
per request.

## The route matcher is reused from `components/layout/nav-utils.ts`, not extracted

**What:** `resolveRoutePermission` imports `resolveActiveHref` from `components/layout/nav-utils.ts`
rather than owning a copy or moving it into `lib/`. Extracting it would have meant editing
`nav-utils.ts`, which was outside this task's file list while three agents worked in parallel.

**Evidence:** `lib/auth/route-permissions.ts:1`; the extraction note in the plan's Task 12 Step 3.

**So what:** The import direction (`lib/` → `components/`) is backwards and is a deliberate,
temporary trade: one matcher that is definitely identical beats two that were meant to be. If a
third caller appears, move `resolveActiveHref` to `lib/` and have all three import it from there.
Whatever happens, do not fork it — two prefix matchers that drift is how a page ends up lit in the
sidebar and refused by the guard.

## Not verified by hand

**What:** The guard's runtime behaviour was verified by test only. There is no seeded data and no
signed-in session available in this environment, so the Seller-types-`/reports` and
no-organization-redirect paths were never exercised in a browser.

**Evidence:** `bunx vitest run lib/auth/route-permissions.test.ts` → 5 passed; `bunx tsc --noEmit` →
clean; `bunx biome check` → clean. No dev server was run.

**So what:** Step 6 of the plan ("sign in as a Seller, type `/reports`") is still outstanding and
should be done once the API has seeded accounts. Two things to look at specifically: that the
`isPending` branch does not leave the content region blank for a visible beat on a cold load, and
that the redirect to `/onboarding` lands — that page is Task 7's, and it appeared in
`app/(auth)/onboarding/` while this task was being written, so the target exists but the two halves
have never been run together.
