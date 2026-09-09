# Slice 2, Task 9 — Customer detail

## `debtSummary` is two counts and one amount, and the canvas draws three amounts

**What:** `GET /customers/:id` answers `{ ...publicCustomer, debtSummary }` where `debtSummary` is
exactly `{ open, overdue, totalRemaining }`. `open` and `overdue` are **counts of debt rows**;
`totalRemaining` is the only money on the object. Every field is always present — the aggregate
coalesces a customer with no debts to `{ open: 0, overdue: 0, totalRemaining: 0 }` rather than
returning nothing, so there is no undefined case to guard.

**Evidence:** `../Backend/src/db/actions/debt.actions.ts:197-221`, read directly:

```js
{ $match: { organizationId, customerId, status: "open" } },
{ $group: {
    _id: null,
    open:           { $sum: 1 },
    overdue:        { $sum: { $cond: [{ $lt: ["$dueDate", now] }, 1, 0] } },
    totalRemaining: { $sum: "$remaining" },
} }
```

`$sum: 1` counts matched documents. The `$match` is `status: "open"`, so all three numbers describe
**open debts only** — a settled debt is in none of them. Artboard `2h` (line ~1040) draws
`Outstanding USD 76.50` beside `Overdue USD 0.00`, i.e. two money figures.

**So what:** `customer-debt-summary.tsx` renders each field for what it is:

| Field | Rendered as | Why |
|---|---|---|
| `totalRemaining` | `formatMoney(totalRemaining, currency)` → `USD 76.50`, mono, 22px | The one amount. This is the canvas's *Outstanding* figure, unchanged. |
| `overdue` | `"1 overdue"` / `"None overdue"`, **never a currency code** | A count. `formatMoney(1, "USD")` would print `USD 1.00` for one late debt of any size — a figure that exists nowhere in the books, on the screen whose whole job is saying what someone is owed. |
| `open` | `"across 3 open debts"`, muted, under the amount | The other count, and what makes the amount mean something: one debt of 76.50 and ten of 7.65 are different problems. |

Zero is its own state — `open === 0 && totalRemaining === 0` renders *Nothing outstanding* rather
than `USD 0.00` and `None overdue` side by side, which reads as a panel that failed to load. Both
behaviours are pinned by `customer-debt-summary.test.tsx`, and the reasoning is in a block comment
at the top of the component because the canvas will look wrong to whoever reads it next.

An overdue *amount* is not obtainable in this slice at any price: it would need the debts
themselves (`GET /debts?customerId=…`), which is Slice 3. The count is the whole truth available.

---

## An unknown customer id is a 404; a malformed one is a **422**, and both mean "no such customer"

**What:** Two different failures put a reader on a page with no customer, and only one of them is a
404.

- **404 `NOT_FOUND`, message `"Customer not found"`.** Raised for a well-formed id that matches no
  row **in this organization**. `findCustomerById` filters on `organizationId`, so an id belonging
  to another business is a 404 and not a 403 — an id cannot be probed for existence.
- **422 `VALIDATION_ERROR`, `fieldErrors: { id: "Invalid id" }`.** Raised for anything that is not
  24 hex characters, e.g. `/customers/abc`. The `validate` middleware runs **before** the handler
  and before `requireAuth`, so the lookup never happens.

**Evidence:** `../Backend/src/services/customer.service.ts:75-80` (`if (!customer) throw new
NotFoundError("Customer")`), `../Backend/src/util/errors.ts:77-88` (`NotFoundError` →
`404` / `"NOT_FOUND"` / `"<resource> not found"`), `../Backend/src/routes/v1/customer.route.ts:42-49`
(`validate({ params: idParamSchema, body: noBodySchema })` is the first entry in the chain),
`../Backend/src/validators/common.validation.ts:5-10` (`objectIdSchema` is
`/^[0-9a-fA-F]{24}$/`), and `../Backend/src/middleware/validate.middleware.ts:47-51` merging param
failures into a `ValidationError`.

**So what:** `customer-detail.tsx`'s `isMissingCustomer()` treats **both** as not-found and renders
one calm `EmptyState` — *"This customer doesn't exist"* — instead of an `ErrorCard` offering to
retry a request whose answer will not change. Handling only the 404 would show a typed-URL visitor
a red panel reading `"Invalid id"`. This route can raise no other 422: it takes no query and a GET
carries no body, so a 422 from it always means the id.

The same pair applies to `/products/[id]` and to every other `:id` detail page in this app; the
check is written as a small named function so it can be lifted to `lib/` when a second caller
appears.

---

## Three things in artboard `2h`'s detail half have no data behind them

**What:** Working through the canvas's lower card against the wire shape, three drawn elements
could not be built as drawn, and one real field is drawn nowhere.

1. **`Overdue USD 0.00`** — the money-vs-count problem above. Rendered as a count.
2. **The tab counts, `Debts 3` and `Sales 21`.** Neither number is available. `debtSummary.open`
   counts *open* debts only, so it is not the number of rows a Debts tab would list — a customer
   with three settled debts and none open would show `Debts 0` above a list of three. And **no
   `/customers` response carries a sales count at all**; `publicCustomer` is nine fields
   (`../Backend/src/controller/customer.controller.ts:13-23`) and none of them is one. Both counts
   are omitted rather than approximated, with a comment in the tab strip saying why. They arrive
   with the lists in Slice 3.
3. **The tab panels themselves.** Out of scope by the plan's own "Explicitly out of scope"; both
   render an `EmptyState` carrying a `// TODO(slice: 3)` naming the endpoint that will fill it.
   Both endpoints were verified to exist and to accept the filter before being named:
   `GET /debts?customerId=` (`debts:view`, `docs/API-ROUTES.md:111`;
   `../Backend/src/validators/debt.validation.ts:19`) and `GET /sales?customerId=`
   (`sales:view`, `docs/API-ROUTES.md:205`; `../Backend/src/validators/sale.validation.ts:23`).
   Neither is called from this slice.

And the other direction: **`notes` is on the wire and the create sheet captures it, but artboard
`2h` never draws it on the detail card.** It is real data a shopkeeper typed — "Buys in bulk on
Fridays", per the canvas's own sheet — and it would be invisible everywhere if this page dropped
it, so it is rendered in a small muted section below the debt panel, `whitespace-pre-line` because
the field is a 2000-character textarea people put one line per thing in.

**So what:** Do not "fix" the tab counts or the overdue figure to match the canvas without an
endpoint behind them. If `2h` is ever compared side by side at 1440px, these four differences are
the expected ones.

---

## Archiving is refused inline, and the refusal is the only one the reader can clear

**What:** `DELETE /customers/:id` is refused with 409 `CUSTOMER_HAS_OPEN_DEBT` while the customer
has **any** debt in `status: "open"` — the amount is irrelevant, the check is a count.

**Evidence:** `../Backend/src/services/customer.service.ts:24-33` — `assertCustomerArchivable`
runs `countOpenDebtsForCustomer` and throws when it is `> 0`. `archiveCustomer` calls it between
the lookup and the write, so a 404 for a missing customer still wins over the 409.

**So what:** The message renders inline beside the Archive control, branching on `code` and never
on `message` (`CLAUDE.md`). The API's own wording — "This customer has an open debt" — is true but
says nothing to do about it, so this one refusal gets its own copy naming the way out (settle or
write off). Everything else falls through to `error.message` verbatim.

Two details worth keeping: `archive.reset()` fires when the confirm step opens, so the message
beside the button always belongs to the attempt in front of the reader; and a failed attempt
collapses the confirm step, because a 409 is an answer and re-pressing "Yes, archive" only produces
the same one.

---

## No dialog primitive exists, so the archive confirm is a two-step inline control

**What:** `components/ui/` has no `dialog.tsx` — `sheet.tsx` is the only thing wrapping base-ui's
`Dialog`, and it is a side sheet. There is nothing to confirm a destructive action with.

**Evidence:** `ls components/ui` — avatar, badge, button, card, collapsible, dropdown-menu, input,
label, scroll-area, separator, skeleton, sheet, tooltip.

**So what:** `<ArchiveControl>` swaps the single **Archive** button for *"Archive this customer?"* +
**Cancel** / **Yes, archive** in the same place, rather than vendoring a new shadcn primitive for
one button in a slice that was not asked to add one. Task 7's product archive wants a confirm too
(the plan says "opens a confirm dialog"); whoever builds it should either reuse this shape or
regenerate `dialog.tsx` through shadcn — `components/ui/` is vendored and must not be hand-written
(`CLAUDE.md`).

---

## The route needed no `config/routes.ts` entry

**What:** `/customers/[id]` is guarded correctly with no change to `ROUTE_PERMISSIONS`, and
`ROUTES.customer(id)` already existed.

**Evidence:** `lib/auth/route-permissions.ts` resolves through `resolveActiveHref`, whose rule is
longest guarded prefix on a `/` boundary — so `/customers/<id>` falls back to `/customers` and
inherits `customers:view`. `config/routes.ts:46` already has `customer: (id) => `/customers/${id}``,
which `customer-table.tsx` has been pushing to since Task 8.

**So what:** Nothing to do. Noted because the sibling `/products/[id]` is in the same position, and
because the *stricter* case is the one that needs an entry — `/products/new` has one precisely
because a Seller holds `products:view` and would otherwise reach a form whose every submit is a 403.

---

## `params` is a Promise, and `PageProps<'/customers/[id]'>` is not usable before a build

**What:** The route props helper the Next docs recommend (`PageProps<'/customers/[id]'>`) is a
global generated into `.next/types/routes.d.ts` by `next dev` / `next build` / `next typegen`. That
file currently lists only the Slice 1 routes — `/products` and `/customers` are not in it either —
so a `bunx tsc --noEmit` run before the next build fails on any route literal added since.

**Evidence:** `.next/types/routes.d.ts:4` —
`type AppRoutes = "/" | "/accept-invite" | "/forgot-password" | "/login" | … | "/verify-email"`.
The docs' Promise form is at
`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md:216-232`.

**So what:** `app/(app)/customers/[id]/page.tsx` types the prop by hand as
`{ params: Promise<{ id: string }> }` and awaits it. Switch to the helper only once the route tree
is stable and someone has run `next typegen` — the same condition `CLAUDE.md` already records for
turning `typedRoutes` on.

---

## Verification

`bunx vitest run features/customers` — 3 files, 23 tests, all passing.
`bunx tsc --noEmit` — clean for every file in this task (the one error in the run,
`features/products/components/stock-dialog.test.tsx`, belongs to Task 7, in flight in parallel).
`bunx biome check` over the four files — clean.

`<CustomerDetail>` itself has **no committed test**, because the task's file list names only
`customer-debt-summary.test.tsx`. It was nonetheless smoke-tested during the work with a temporary
spec that was then deleted: four cases — a loaded customer, the archived banner (and the absence of
an Archive button on an already-archived row), the not-found panel for **both** a 404 and a 422,
and the inline `CUSTOMER_HAS_OPEN_DEBT` refusal — all passing. Mocking is straightforward if
someone wants it permanently: `vi.mock` over `use-customer`, `use-customer-mutations`,
`use-organization` and `use-permission`, wrapped in `NuqsTestingAdapter` from `nuqs/adapters/testing`
for the tab param. No environment shims were needed.

**Not verified:** nothing on this page has been seen in a browser. No dev server was started —
Next 16 locks per project directory and Task 7 shares this tree — so the comparison against
artboard `2h` at 1440px in both themes is still owed, as is any run against a live API. The debt
panel in particular has only ever rendered against hand-written props in a test.
