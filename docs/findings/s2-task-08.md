# Slice 2, Task 8 — Customers list and the quick-create sheet

## The vendored `Sheet` needs `!` on **two** utilities, not one

**What:** `docs/findings/` already records that `SheetContent`'s `data-[side=left]:w-3/4` outranks a
plain width utility. The same is true of `data-[side=right]:w-3/4` — and there is a second one right
behind it that is easy to miss: `data-[side=right]:sm:max-w-sm`. Overriding only the width leaves the
sheet at 384px, which looks *nearly* right and is not the canvas's 440px.

**Evidence:** `components/ui/sheet.tsx:55` — the class list ends
`… data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm`. Both selectors carry
`[data-side=…]`, so both outrank a bare `w-…` / `sm:max-w-…`.

**So what:** `className="w-full! … sm:max-w-[440px]!"`. Anything that wants a non-default sheet
width needs both bangs. `components/layout/mobile-nav.tsx` gets away with one because 288px is under
`max-w-sm` and the cap never bites.

---

## base-ui's `Dialog` renders under happy-dom with no polyfill

**What:** The sheet is `@base-ui/react`'s `Dialog` behind a portal, and this is the first component
test in the repo that opens one. It needed nothing: no `ResizeObserver` stub, no `matchMedia`, no
`Element.prototype.animate`, no `inert` shim. `screen` queries reach the portalled content because
Testing Library queries `document.body`.

**Evidence:** `features/customers/components/customer-form-sheet.test.tsx` — seven tests, green on
the first run against `vitest.setup.ts` as it already stands.

**So what:** Slice 3's counter can test its quick-create the same way. Nobody needs to add
environment shims to `vitest.setup.ts` for a sheet.

---

## The empty-search 422, and why dropping the key twice is not redundant

**What:** `search` is `searchSchema.optional()` where
`searchSchema = z.string().trim().min(1).max(100)`, inside a `.strict()` query schema. `nuqs` holds
`""` for an untouched search box, and `?search=` is therefore a 422 on the normal state of the page
— not an ignored filter.

**Evidence:** `../Backend/src/validators/customer.validation.ts:25-30` and
`common.validation.ts:49`, read directly rather than taken from the plan.

**So what:** `toCustomerListParams` in `customers-page.tsx` spreads the key in conditionally
(`...(search === "" ? {} : { search })`) exactly the way `toProductListParams` does. The second
reason to do it *here* rather than only in the service is the one the products page already
documents: these params are also the React Query key, and `{ search: "" }` and `{}` hash to two
different keys for one identical request — two cache entries, two loading states, and a refetch
every time the box is cleared.

`status` is the opposite case and is always sent: the backend defaults it to `"active"`, so the URL
parser defaults to `"active"` too and the select shows the truth without ever writing
`?status=active`.

---

## The canvas's sheet fields match `createCustomerSchema` exactly

**What:** Artboard `2h` draws Name, Phone, Email *optional*, Address *optional*, Notes *optional*.
`createCustomerSchema` is `{ name, phone, email?, address?, notes? }`. Field for field, required for
required, that is the same form. The canvas even draws the phone box in its error state with "A
customer with this phone number already exists." **on the field**, which is where
`CUSTOMER_CONFLICT_FIELDS` puts a `DUPLICATE_PHONE` 409.

**Evidence:** `docs/design/TradeOs-UI.dc.html:1046-1080` against
`features/customers/schemas/customer.schema.ts:79-92`.

**So what:** Nothing to reconcile — recorded because the brief asked, and because `2h` is wrong
about the *other* half of the artboard (the debt panel draws two money figures where the API returns
two counts and one amount), so "the canvas is wrong here too" was a live possibility worth ruling
out.

Two small deviations from what `2h` draws, both deliberate:

- The subtitle under "New customer" is *"The same sheet opens from the counter."* That is a note to
  whoever is reading the design, not something to say to a shopkeeper. The dialog still needs an
  accessible description, so it gets one about the form: *"A name and a phone number are all this
  needs."*
- The canvas draws the sheet as a floating 440px card. It is rendered as the vendored right-anchored
  sheet at that width, because that is the component the repo has and a second, centred variant
  would be a new pattern for one screen.

---

## An email that has been set cannot be cleared, and the sheet says so

**What:** The backend validates `email` with `.email()` on both create and update, so `""` is a 422,
and an omitted key on a PATCH means "leave it alone". There is therefore no request that removes an
email. `customer.schema.ts` already records this; what was left open was what the *form* does when
somebody empties the box on an existing customer.

**So what:** It sets a message on the email field — "An email can't be removed once it is set." —
rather than dropping the change. Silently omitting it would close the sheet on an edit that did not
happen, which is the worst of the three options. If the backend ever gains a nullable email, this is
the branch to delete (`customer-form-sheet.tsx`, the `dirtyFields.email` block).

---

## Deviations from the plan's draft test

**What:** The plan's Task 8 test asserts `await screen.findByText(/phone/i)` after a submit with an
empty phone. That regex matches the field's own **label** as well as its message, and `findByText`
throws on more than one match — the draft cannot pass against any form that labels its phone box
"Phone", which the same file's second test requires via `getByLabelText("Phone")`.

**So what:** The assertion matches the message exactly
(`/enter a phone number of at least 5 digits/i`) and additionally checks
`aria-invalid` on the input. Everything else the draft specified — the mocked mutation hooks, the
`QueryClientProvider` wrapper, `mutate(input, { onSuccess })`, and `onCreated` receiving the created
customer — is kept as written, because Slice 3 codes against exactly that shape.

---

## Row click goes to a page that does not exist yet

**What:** `<CustomerTable>` routes a row click to `ROUTES.customer(id)` — `/customers/[id]` — which
**Task 9 creates**. Until it lands, clicking a row 404s.

**So what:** Left wired rather than disabled, unlike the products page's Import button. The
difference is that Import belongs to a later slice and may never exist; the customer detail is the
very next task in this plan. If Task 9 slips, this is the line to make conditional.

---

## Two things about react-hook-form I believed, wrote down, then checked — and both were wrong

Recorded because the *beliefs* are the widely repeated ones, and a later task that acts on them will
write code that does nothing. Verified against react-hook-form **7.87** by unpacking
`node_modules/react-hook-form/dist/index.esm.mjs.map` (the published build ships its TypeScript
sources in the source map, which is the only readable copy in the tree — `index.cjs.js` is minified).

**"`dirtyFields` read for the first time inside a callback comes back empty."** It does not, in this
version. `updateTouchAndDirty` maintains `_formState.dirtyFields` unconditionally
(`src/logic/createFormControl.ts` — the `set`/`unset` on `_formState.dirtyFields` runs before, and
outside, the `_proxyFormState.dirtyFields` check); the proxy flag gates only whether the change
causes a **re-render**. A "send only what changed" PATCH built from a callback-only read would have
worked. The sheet still destructures `const { errors, dirtyFields } = form.formState;` during
render — that is the documented pattern and the subscription is wanted — but it is a style choice,
not the thing standing between this form and an empty PATCH body.

**"A `root.serverError` survives the next validation pass, so clear it by hand."** It does not.
`handleSubmit` runs `unset(_formState.errors, ROOT_ERROR_TYPE)` — `ROOT_ERROR_TYPE` is `'root'`,
`src/constants.ts` — on every submit, *after* the resolver and *before* it decides whether to call
the valid callback. A `form.clearErrors("root.serverError")` at the top of that callback is a line
that can never fire. It was written, then deleted; the banner's lifetime is already "until the next
attempt" for free.

---

## Two small shape decisions, recorded so the next task does not re-litigate them

- **The filters live in `customers-page.tsx`, not a `customer-filters.tsx`.** Products earned a
  separate file because it has four filters, three tabs, a `lowStock` pin and a category query that
  can 403 on its own. Customers has two controls and no tab bar; a second file for
  `useCustomerFilters` + `toCustomerListParams` + a 40-line bar would be ceremony. The plan's Task 8
  file list agrees — it names no filters file.
- **Biome's `useExhaustiveDependencies` refuses a dependency the effect body does not read.** The
  re-seed effect was first written as `[open, customerId, form.reset]` with `customerId` as a cheap
  identity guard; biome calls that "more dependencies than necessary" and it is a lint **error**, not
  a warning. It is now `[open, customer, form.reset]`, which means **callers must pass a stable
  `customer`** — the row out of React Query's cache, not one rebuilt inline — or the form resets
  under the user's typing. Task 9 passes `detail.customer`, which is stable.
