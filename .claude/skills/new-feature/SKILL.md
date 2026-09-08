---
name: new-feature
description: Scaffold a new frontend feature slice for a TradeOs backend resource in this Next.js App Router app, following the page → components → hooks → services → api-client layering this repo uses. Always use this skill when asked to add, create, build or wire up a screen, page, list, table, form, detail view or feature for a resource the API already exposes — even when the request only describes the outcome ("let managers see their customers", "add a products screen", "we need a way to record payments") without naming a layer. Generates the slice from templates/ and leaves the decisions only a human can make clearly marked.
---

# Adding a feature slice to this frontend

This app is layered on purpose, and the layering mirrors the backend's
`route → controller → service → db action` one for one:

```
page                thin. Server Component: layout, metadata, Suspense.
  └─ components/    the screen. Client islands. Presentation and interaction.
       └─ hooks/    TanStack Query. The ONLY place useQuery/useMutation appear.
            └─ services/   typed axios calls. No React, no hooks.
                 └─ lib/api/client   apiGet / apiGetList / apiPost / apiPatch / apiDelete
```

Each layer has exactly one job, and each layer is testable without the one
above it. A component that fetches its own data owns a cache key nothing else
can see; a hook that builds its own URL cannot be tested without a renderer.
Skipping a layer is what makes a UI hard to follow and impossible to debug from
a screenshot.

**Build in that order — types and schemas first, then keys, service, hooks,
components, page.** Every layer only knows the one beneath it, so building
downward means writing against something imaginary; building upward means each
file compiles against a real thing the moment you save it.

The backend is finished and shipped (Phases 1–3, 939 tests). Every endpoint
this frontend needs already exists and is documented in
`Backend/docs/BACKEND-GUIDE.md`. The screens are specified, screen by screen and
field by field, in `docs/superpowers/specs/2026-09-07-frontend-ui-design-brief.md`.
**Neither is optional reading. Do not invent a field, a filter or a screen that
is not in one of them** — the brief says so in its own §0, and every field it
names exists in the backend because it was written from the backend.

---

## Step 1: decide what the user actually asked for

Before you copy a single template, get answers to these. Ask the user; do not
guess. Every one of them changes what gets generated, and the failure mode is
the same every time — a wired-up, correct-looking screen for the wrong thing,
which is hard to spot precisely because everything else looks finished.

1. **The resource, singular and plural.** `product` / `products`. This becomes
   the folder, the URL segment, the API path and the query-key root, and
   changing it later touches every file in the slice.

2. **Which endpoints it wraps.** Read them off brief §2's endpoint→screen table
   and confirm against `Backend/docs/BACKEND-GUIDE.md` §3. "Let users manage
   their categories" is a list plus create plus update plus delete. "Add a way
   to record a payment" is **one** POST — not a CRUD set, and generating five
   hooks for it is the most common way this skill fails.

3. **Which permission gates view, create, update and delete.** Not four
   guesses from the resource name — the actual answer, which sometimes is not
   the obvious one. See "Picking the right permission" below.

4. **Is the list paginated?** Every list endpoint in this API is
   (BACKEND-GUIDE §4), so the answer is almost always yes; the exception is an
   endpoint that returns a fixed small set (`GET /categories`). A non-paginated
   list still uses `apiGet`, not `apiGetList`, and drops the pagination footer.

5. **Does it have a detail page?** A row that opens a page needs
   `app/(app)/<resources>/[id]/page.tsx` and a `detail` route. A row that opens
   a sheet does not, and generating an unreachable route is dead code that will
   be maintained for a year.

6. **What is the destructive action, and what is it called?** Brief §9 is
   binding on this: financial records are never deleted. A sale is **voided**,
   a debt is **written off**, a payment is **voided**, a customer or product is
   **archived**. If the answer is any of those, the endpoint is a POST and the
   UI is a ReasonDialog, not a `DELETE` and a confirm.

### Picking the right permission

`PERMISSIONS` (`lib/auth/permissions.ts`) mirrors the backend catalog, so a
typo is a compile error rather than a check that is silently false forever.
That protects the spelling. It does not protect the **choice**, and the choice
is where this goes wrong.

`config/routes.ts` gates the **Members** page on `members:invite`, not on
`members:view`. That looks wrong until you read `PRESET_SELLER`: a Seller holds
`members:view`, because they need to see who recorded a sale. Gating the
management screen on it would put the whole team-management page in every
Seller's sidebar. **A management screen is gated on an action permission that
only a manager holds** — `members:invite`, not `members:view`.

So: before choosing, read `PRESET_SELLER` at the bottom of
`lib/auth/permissions.ts` and ask whether a Seller should see this screen. If
the answer is no and the `:view` permission is in that list, `:view` is the
wrong gate.

---

## Step 2: copy the templates

There is no generator script. The substitutions that matter — which endpoints,
which permission, which fields, which of five words means "delete" — are
judgement calls, and a script that guessed them would emit a screen that looks
finished and is not. What is mechanical is the renaming, and that is what the
placeholder convention below is for.

For each template you need: read it, split it on its `FILE:` banners, replace
every placeholder, write the files, delete the banners.

| Template | Produces | Skip it when |
|---|---|---|
| `types.ts.template` | `features/<res>/types.ts` | never |
| `schemas.ts.template` | `features/<res>/schemas/<res>.schema.ts` | the feature is read-only |
| `keys.ts.template` | `features/<res>/keys.ts` | never |
| `service.ts.template` | `features/<res>/services/<res>.service.ts` | never |
| `hooks.ts.template` | `features/<res>/hooks/use-<resources>.ts` | never |
| `list-page.tsx.template` | `app/(app)/<resources>/page.tsx`, `features/<res>/components/states.tsx`, `features/<res>/components/<res>-list.tsx` | there is no list screen |
| `form.tsx.template` | `features/<res>/components/<res>-form.tsx` | nothing is created or edited |
| `detail-page.tsx.template` | `app/(app)/<resources>/[id]/page.tsx`, `features/<res>/components/<res>-detail.tsx` | Step 1 said no detail page |
| `test.ts.template` | `features/<res>/services/<res>.service.test.ts`, `features/<res>/hooks/use-<resources>.test.tsx` | never |

Generate **only** the operations Step 1 identified. Five hooks for a
single-POST feature is not thoroughness, it is four unused exports and four
cache keys nobody will ever invalidate correctly.

### The full tree, for `product`

```
app/(app)/products/
  page.tsx                                  Server Component — layout + Suspense
  [id]/page.tsx                             Server Component — awaits params
features/products/
  types.ts                                  Product, ProductListParams
  keys.ts                                   productKeys via createQueryKeys
  schemas/
    product.schema.ts                       zod v4 create/update + inferred types
  services/
    product.service.ts                      list/getById/create/update/remove
    product.service.test.ts
  hooks/
    use-products.ts                         "use client" — every useQuery/useMutation
    use-products.test.tsx
  components/
    states.tsx                              ErrorCard, ForbiddenPanel, ListSkeleton
    product-list.tsx                        "use client" — nuqs filters + DataTable
    product-form.tsx                        "use client" — RHF + zodResolver
    product-detail.tsx                      "use client" — header, actions, states
```

### Placeholder convention

Every placeholder is wrapped in double underscores, and **the casing inside the
placeholder is the casing of the substitution** — so no substitution needs a
judgement call about capitalisation. There are four label placeholders for
exactly that reason: brief §9 puts UI copy in sentence case (`New product`,
not `New Product`), and a single label placeholder would force you to decide
per site and get it wrong somewhere.

| Placeholder | Means | `product` | `stockMovement` |
|---|---|---|---|
| `__Resource__` | PascalCase singular — type and component names | `Product` | `StockMovement` |
| `__resource__` | camelCase singular — variable names | `product` | `stockMovement` |
| `__resources__` | camelCase plural — the `ROUTES` key | `products` | `stockMovements` |
| `__resource-kebab__` | kebab singular — file names | `product` | `stock-movement` |
| `__resources-kebab__` | kebab plural — folder, URL segment, API path, query-key root | `products` | `stock-movements` |
| `__ResourceLabel__` | UI singular, sentence-initial | `Product` | `Stock movement` |
| `__resourceLabel__` | UI singular, mid-sentence | `product` | `stock movement` |
| `__ResourcesLabel__` | UI plural, sentence-initial | `Products` | `Stock movements` |
| `__resourcesLabel__` | UI plural, mid-sentence | `products` | `stock movements` |
| `__PERM_CREATE__` `__PERM_UPDATE__` `__PERM_DELETE__` | the **whole** expression, e.g. `PERMISSIONS.PRODUCTS_CREATE` | | |
| `__PERM_VIEW__` | the same, for the `NAV_GROUPS` entry — it appears in no template because the nav lives in `config/routes.ts` | | |

The permission placeholders hold the full expression, not a prefix, because
the mapping is not mechanical — that is the whole point of the Members case
above. Substituting them forces you to have made the choice.

No placeholder is a substring of another, so the order you replace them in
does not matter.

Two other markers appear in the templates:

- **`// PICK:`** — a real decision that depends on the resource, with the
  options and the rule that governs them written out beside it. Every `PICK`
  must be resolved or deleted before the feature is done. A `PICK` left in
  place is not a placeholder, it is an unfinished screen.
- **`FILE:` banners** — where each block goes. Delete them after splitting.

---

## Step 3: fill in the slice, bottom up

1. **`types.ts`** — start from `Backend/src/db/models/<resource>.model.ts` for
   the field list, then read the controller's `publicX` shaper (or the db
   action's `toXResponse`) for the **shape**, because no raw document reaches
   the wire. Ids are `id: string` — the shaper reads Mongoose's `id` virtual
   explicitly, which is why the backend needs no `toJSON` transform. Nested
   references are `.toString()`'d strings. `organizationId` and `__v` are
   dropped by the shaper and must not appear in the type. Dates arrive as ISO
   strings, not `Date`. Some endpoints wrap the row rather than returning it
   flat (`GET /categories` → `{ category, productCount }`).

2. **`schemas/`** — mirror `Backend/src/validators/<resource>.validation.ts`
   field for field. This schema is not the authority; the API is. Its job is to
   catch the mistake in the browser, where the user can see which field is
   wrong. When the backend validator changes, change this in the same commit.

3. **`keys.ts`** — usually needs nothing but the rename. It is the one seam
   between this slice and `lib/query/keys`.

4. **`services/`** — the paths and the parameter names. Nothing else. No React,
   no envelope, no error handling.

5. **`hooks/`** — the invalidation targets. `create` and `delete` invalidate
   `lists()`; `update` writes the response into `detail(id)` and invalidates
   `lists()`. Read the optimistic-update block at the bottom of the template
   before adding optimism to anything.

6. **`components/`** — resolve every `PICK` against brief §6's block for this
   screen. That block names every field, filter, column, tab and CTA the screen
   has. Anything not in it does not exist. Two `PICK`s here are not about the
   resource: the hook that supplies the organization's `timezone` and
   `currency` (confirm its path against the auth slice), and the shared
   components from `components/shared/` — `DataTable`, `EmptyState` — whose
   props are the one place this slice couples to anything outside it.

7. **`app/(app)/…`** — the pages stay Server Components. See below.

8. **`config/routes.ts`** — add the `ROUTES` entries the components import
   (`list`, `new`, `detail(id)`, `edit(id)`; `ForbiddenPanel` also uses
   `ROUTES.overview`, which already exists) and the `NAV_GROUPS` entry, gated
   on the permission Step 1 chose. Brief §5 is the approved navigation and is
   final: do not add, rename or regroup a menu item that is not in it.

---

## Server Components and client islands

The page is a Server Component. It does layout, `metadata`, and a `Suspense`
boundary, and it has no `"use client"`. Everything interactive is one child
component that opts in.

That split is not decoration:

- A page that fetches on the server and a client island that fetches the same
  row through React Query are two sources of truth that will disagree, and the
  one the user sees depends on the navigation that got them there.
- `params` is a `Promise` in this version of Next. The page awaits it; the
  island receives a plain `id`.
- The `Suspense` boundary is load-bearing. `nuqs` reads the query string
  through `useSearchParams`, and a client component that does that with no
  Suspense boundary above it opts the whole route out of static rendering.
- The fallback is the same skeleton the island shows while refetching, so the
  first paint and every later load look identical.

`"use client"` goes on: the hooks file, and every component that uses a hook,
a handler or browser state. Not on pages, not on `types.ts`, not on
`schemas/`, not on `services/`.

---

## The six states every screen owes the user

Brief §8.4 is binding. A screen that renders rows and nothing else is not
finished — it is finished for the one case the developer had data for.

| State | What it must be | Where the template does it |
|---|---|---|
| **Loading** | A skeleton shaped like the content — cards, rows. Never a spinner in the page body. | `ListSkeleton` / `DetailSkeleton` |
| **Empty** | `EmptyState`: one line, one CTA. And **filtered-empty is a different state**: say the filters are why, and offer `Clear filters`. Offering "New product" to someone whose search just missed is how a duplicate gets created. | `__Resource__List`, both branches |
| **Error** | An inline card with the human message and a mono `Request ID: …` line. Support asks for it first; it is the only thing tying the screen to a line in the server log. | `ErrorCard` |
| **403** | A calm full-page "You don't have access to this" with a way back. Should be unreachable — items are absent, not disabled — so if it renders, navigation has a hole. | `ForbiddenPanel` |
| **422** | Field-level messages from `errors: { field: message }`, mapped onto the form with `setError`. A banner **only** when no field matched. | `applyServerError` |
| **409** | The domain message inline, at the control the user has to change — `INSUFFICIENT_STOCK` on the cart line, `DUPLICATE_BARCODE` on the barcode field, `DEBT_HAS_PAYMENTS` on the void button. | `CONFLICT_FIELDS` |

The codes are in brief Appendix A. They are the contract; the messages are not.

---

## Anti-patterns

Each of these compiles, ships, and breaks something that is hard to trace back.

**`useQuery` outside `hooks/`.** A component that fetches inline owns a cache
key, a stale time and an invalidation contract nothing else can see — so the
next component needing the same data invents a second key, and a mutation now
refreshes one of them. The screen shows a row the user just deleted until the
next hard reload, and nothing in the diff looks wrong.

**axios, or a URL, outside `services/`.** The moment a path is written in two
places, one of them is stale after the next backend change. Services are also
the only layer that can be tested without a renderer; a hook that builds its
own URL drags a React tree into a test about a query string.

**Unwrapping the envelope.** The response interceptor has already turned
`{ success, message, data, meta }` into the domain object and a failure into an
`ApiError`. A second `response.data.data` is `undefined`, and the `?.` someone
adds to silence it hides the fetch that is now returning nothing.

**Branching on `message`.** Messages are written for people and change without
notice; a UI that keys off one silently stops handling that case the next time
someone improves the copy. Branch on `code` — `hasCode(error, API_ERROR_CODE.X)`
— which is the contract (BACKEND-GUIDE §4).

**Sending an organization id.** There is no endpoint that accepts one, in a
path, body, query or header. `requireMember` resolves the tenant from the
caller's own session on every request, which is the mechanism that stops one
business reading another's data. A stray `organizationId` in a strict body is a
422; the fact that it is *also* a category error about where trust lives is the
reason it is listed here.

**Building a permission string by hand.** `useCan("sales:crate")` is not a
typo you will find — it is a button that is invisible forever, for everyone,
and it looks exactly like a working permission check. `PERMISSIONS.X` makes it
a compile error.

**Filters in a store.** A filtered list is a place, and a place has an address:
reloadable, bookmarkable, sendable to a colleague, back-buttonable. A zustand
store gives up all four, and — worse — it survives navigation, so returning to
the screen later shows someone else's search. Filters, tabs, page, sort and
period go in the URL via `nuqs`.

**Server data in zustand.** zustand is for client-only UI state: a sidebar
collapsed, a dialog open, an unsent draft. Server data belongs to React Query,
which already has caching, deduplication, invalidation, retries and staleness.
Copying a row into a store forks it: the store's copy has no way to learn that
the row changed, and the two versions diverge the moment anything mutates.

**Rendering money, dates or quantities by hand.** `{row.price}` renders
`1250.5`. `new Date(x).toLocaleString()` shows a bookkeeper working from
another country a different day than the business's books say. Money goes
through `formatMoney(value, currency)` (mono, 2 dp, currency **code** not
symbol — the market uses currencies whose symbols collide), quantities through
`formatQuantity(value, unit)`, dates through `formatDate(value, timezone)` and
`formatDateTime(value, timezone)`, all per brief §8.1–8.2.

**Defaulting the currency or the timezone.** Both formatters take them as
required arguments precisely because there is no safe default: the amount is in
the organization's main currency and the date is resolved in its timezone, and
neither is the browser's. Read both from the organization on `GET /auth/me` and
thread them down. Hardcoding `"USD"` works on every screen the developer tests
and on none of the ones the customer uses. A practical consequence: a column
array whose cells format anything must live **inside** the component, not at
module scope, because that is the only place the values exist. The React
Compiler memoises it.

**Disabling instead of hiding.** A button the user can see but not use is a
promise the API will refuse with a 403. Brief §5 makes absence the rule for
navigation, and the same reasoning applies to every CTA and row action:
`PermissionGate`, or `useCan` and no element at all.

---

## Conventions to keep

- **File naming**: `<resource>.service.ts`, `<resource>.schema.ts`,
  `use-<resources>.ts`, `<resource>-list.tsx`, `<resource>-form.tsx`,
  `<resource>-detail.tsx`. Kebab-case files, one exported component per file
  where it is a screen.
- **`import type`** for every type-only import.
- **No `any`.** Narrow with `isApiError`, not with a cast. A cast that is wrong
  compiles and fails at the first property access.
- Double quotes, semicolons, 2-space indent. Biome enforces it: `bun run lint`.
- **shadcn is base-nova on Base UI**: the polymorphic prop is `render`
  (`<Button render={<Link href={…} />}>`), not `asChild`. `cn` comes from the
  `cn` package (`import { cn } from "cn"`).
- **Never read `process.env`** outside `config/env.ts`. Next only inlines
  `NEXT_PUBLIC_*` when it is written as a literal expression, so a computed
  lookup reads as `undefined` in the browser — silently.
- **Comments carry the reason, not the restatement.** `// invalidate the list`
  above `invalidateQueries` is noise. `// lists(), not all: the detail entry is
  already correct and invalidating it refetches what we just stored` is the
  comment that stops the next person from "simplifying" it.

---

## Before you claim it is done

Every box, in order. `bun run check` runs the first three together.

- [ ] **`bun run typecheck`** — clean. `strict` is on.
- [ ] **`bun run lint`** — clean. Biome, with the Next and React domains on.
- [ ] **`bun run test`** — clean, including the two generated test files, with
      the fixtures replaced by this resource's real shape.
- [ ] **Every `PICK:` is resolved or deleted.** Grep for it. A remaining `PICK`
      is an unfinished screen, not a placeholder.
- [ ] **Every `FILE:` banner is deleted** and no `__placeholder__` survives.
      Grep for `__` in the new files.
- [ ] **`config/routes.ts`** has the `ROUTES` entries the components import and
      a `NAV_GROUPS` entry gated on the permission from Step 1 — checked
      against `PRESET_SELLER`, not against the resource name.
- [ ] **All six states from brief §8.4 render**: loading skeleton, empty,
      filtered-empty with `Clear filters`, error card with the request id, 403
      full page, 422 on the fields, 409 inline at the control.
- [ ] **The screen matches brief §6's block for it** — every field, filter,
      column, tab and CTA it names, and nothing it does not.
- [ ] **No hardcoded currency or timezone.** Every `formatMoney` passes the
      organization's main currency, every `formatDate`/`formatDateTime` passes
      its timezone. Grep the new files for `"USD"` and for `toLocale`.
- [ ] **The words are the brief's** (§9): titles are nouns, buttons are verbs,
      *void* / *write off* / *cancelled* / *archive* used exactly, and never
      "delete" for anything financial.
- [ ] **No `useQuery` or `useMutation` outside `hooks/`**, and no URL outside
      `services/`. Grep both.
- [ ] The page is still a Server Component: no `"use client"` in `app/`.
