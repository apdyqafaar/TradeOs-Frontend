# Findings and alerts

Things discovered while building the frontend that you should know about, but that are **not** part
of any task's requirements. The per-task record is in `docs/findings/`; this file keeps the ones
that outlive their task — risks, decisions that need you, and gotchas that will bite the next
person. Newest first within each section. Every entry says what was actually verified.

---

## 1. Needs a decision from you

### Accepting a second invitation silently rewrites an existing account
**Status: open, nobody has ruled. Verified in backend source.** When an invited person *already has
a TradeOs account*, `POST /auth/accept-invite` applies the name and password they type on the invite
form to that existing account and revokes every one of their other sessions
(`Backend/src/services/auth.service.ts:374-397`, `:442`). So "Your name" renames an account they
already have, and "Password" is a password reset they did not ask for.

The frontend cannot warn them: the endpoint is public and exposes nothing about the token before
submission, so the page has no way to tell a new invitee from a returning one. Options are to
ignore name/password for an existing user, to prompt them to sign in instead of filling the form, or
to accept it. This is a backend product call.

### The Debts list customer column — RULED and shipped
**Status: closed 2026-09-09. The owner chose to populate the customer on `GET /debts`.**

Artboard `2f` draws the Debts table with the customer's name over their phone as its first
column. `GET /debts` answered a bare `customerId`, so no client could render it without one
request per row — a debt-chasing screen that could not name who owes the money. Three options were
put up: populate server-side, join client-side, or redraw the column. The ruling was to populate.

Shipped as `Backend` `a117e5e`, following the pattern already in the codebase:
`services/dashboard/debts.section.ts` solved the same problem for the Overview's overdue panel
with a single `$in` over the distinct customer ids in the page. `findCustomerNamesByIds` is that
query. Not a `$lookup` per row, and not a join inside the query, which would have disturbed the
indexed sort in `findDebtsByOrganization`.

Three things about the shape, all pinned by backend tests:

- `customer` is **optional and absent** rather than blank when unresolved, so a row can never
  render an empty string that reads as a nameless customer.
- The lookup filters on `organizationId` as well as the ids, so a debt pointing at another
  tenant's customer resolves to nothing instead of leaking a name and phone number. That test was
  **break-tested**: dropping the tenant filter fails it and only it.
- `GET /debts/:id` deliberately still sends a bare `customerId`. A detail screen already fetches
  that one customer for their address and notes. A test pins the asymmetry so it cannot drift.

**Search and sort were deliberately NOT added.** Artboard `2f` draws neither, and the change was
scoped to what the blocked screen actually needed. The consequence is still live and worth knowing:
`GET /debts` has no sort parameter — ordering is a side effect of the status filter — so a fixed
"Due date" column indicator would be wrong on four of the six filters.


### A sale freezes its exchange rate but not its main currency, so old receipts can be re-labelled
**Status: open, needs a backend call. Verified in models and validators.** A sale stores
`payment.currency` (what the customer actually handed over) and `payment.exchangeRate`, frozen —
`Backend/src/db/models/sale.model.ts:23-24` says so in as many words. But `subtotal`, `total`,
`amountPaidMain` and `amountDue` are all "in main currency" with **no record of which currency
that was**. Nothing on the Sale or the Payment stores it.

`updateCurrencySchema` lets an owner change `mainCurrency` at any time
(`src/validators/organization.validation.ts:86`). The moment they do, every historical receipt
re-labels its totals with the new code: a sale genuinely rung up as KES 223.75 renders as
USD 223.75. The amounts do not move; only the word next to them changes, which is the worse
failure — the number stays plausible.

**One partial mitigation, worth knowing before designing a fix.** When `exchangeRate === 1` the
tender *was* in the main currency, so `payment.currency` **is** the main currency as it stood at
sale time and the receipt can be labelled correctly from the sale alone. It is only the
exchange-currency tenders — where `payment.currency` holds the *other* code — for which the main
currency is unrecoverable. So the gap is real but narrower than "every sale".

The fix is a stored `payment.mainCurrency` (or an organization-level currency history). Until
then, a receipt for an exchange-currency tender is labelled with today's main currency and there is
no way for a client to know better. Recorded rather than worked around, because a frontend
work-around here would be guessing at what a financial record says.


### Day one is a long column of empty panels
**Status: open.** Artboard `1e` draws only "First steps" and "Nothing to chart yet" for a
brand-new business, and says nothing about the rest. But a new owner still receives `debts`,
`stock`, `staff`, `projects`, `announcements` and `team` from `GET /dashboard` — all empty — so the
page renders First steps followed by six calm empty panels. Suppressing them until the business has
data is one condition in `features/dashboard/components/overview.tsx`; leaving them is also
defensible (it shows what the product will do). Nobody has ruled.

### Registering, then refreshing, loses the "check your email" panel
**Status: open, degrades rather than breaks.** `/register` is in `proxy.ts`'s `GUEST_ONLY_PATHS`
and registration *sets a session cookie*, so a refresh on the check-your-email panel bounces the
user to `/overview`, then `RouteGuard` sends them to `/onboarding` — which does tell them to verify.
The specific "we sent a link to <address>" message is what is lost. Fixing it properly means
deciding where that message lives: a dedicated route, or onboarding's own notice.

### Contrast: decided, recorded here so it is not reopened
**Status: ruled by the owner on 2026-09-07 — design fidelity wins.** The active nav pill
(#D97757 on #F6E7DF, 2.6:1) and the primary button (3.0:1) are below WCAG AA for small text. They
match the design canvas exactly, which is what was asked for. `app/globals.test.ts` locks both
values with a comment naming the decision. Do not "fix" them without asking.

---

## 2. Bugs found and fixed — each one shipped green

### The camera scanner was never offered on desktop, or on any iPhone
**Fixed 2026-09-11.** Camera scanning was built on the browser's own `BarcodeDetector`, and
`cameraSupport()` returned "this browser cannot scan" when it was absent. The Shape Detection API
has never shipped outside Android and ChromeOS, so the camera button was **not rendered at all** on
Windows, macOS, Linux and every iOS browser — including this shop's own counter PC, whose webcam
was working the entire time. The owner reported it as "we need to use the camera"; the feature was
built, tested and invisible.

The probe that settled it, run in the owner's Chrome 152 on Windows: `window.BarcodeDetector` is
`undefined` while `isSecureContext` is `true`, `navigator.mediaDevices.getUserMedia` is a function,
and `enumerateDevices` lists one camera. **Every condition for a camera was met; only the decoder
was missing — and that is the one thing the code refused on.**

Feature-detecting the API was right. Treating its absence as a verdict on the *browser* was not:
a decoder is a library you can ship. `@zxing/library` is now the fallback behind a one-method
`BarcodeDetectorLike` seam, dynamically imported so it costs nothing to anyone who never opens the
camera, and resolved *before* `getUserMedia` is called so a failed import cannot leave someone
having granted a camera permission for a feature that never worked.

**Why the suite was worse than useless here.** happy-dom has no `BarcodeDetector` either, so the
environment agreed with the bug: the tests asserted the refusal and passed. *A test that asserts a
refusal is only as strong as the reason for refusing*, and this one wrote the wrong reason down and
then defended it. `barcode-camera.test.ts` now asserts the inverse — with no `BarcodeDetector`,
support must be `{ available: true }` — and decodes hand-encoded EAN-13 and Code 39 frames back
through the wrapper. Break-tested both ways.

**Verified by driving a real browser, again.** A canvas holding a seeded product's EAN-13 was piped
into the live `<video>` with `canvas.captureStream(15)` while the scanner ran; the sheet closed on
its own and the cart read "AA batteries 4pk — ETB 95.00". That covers `drawImage` off a real video
element, which happy-dom cannot do, and it confirmed in a browser that closing the sheet leaves the
camera track `"ended"`. Worth reusing for any camera feature: no props, no human, repeatable.
Detail in `docs/findings/slice6-camera-scanning.md`.

### 24 links-that-look-like-buttons were announced and keyed as buttons
**Fixed 2026-09-10.** Every "New sale", "Back to products", "Import" and empty-state action in
the product was `<Button render={<Link href={…} />}>`. Base UI's `Button` has exactly two modes
and **neither one is a link** (`@base-ui/react/internals/use-button/useButton.js:183-187`):

```js
isNativeButton ? { type: 'button' } : { role: 'button' }
```

Left at the default `true`, it put `type="button"` on the `<a>` — where `type` is a content-type
hint and means nothing — and made `isLink` compute `false`, so **Space activated the anchor** like
a button. Links follow on Enter; Space is supposed to scroll the page. It also logged a console
error on every affected page.

The trap is the fix that suggests itself. The console error names `nativeButton={false}`, and
setting it does silence the error and correct the key handling — by putting `role="button"` on the
anchor, so assistive technology stops announcing a link at all and the element drops out of the
page's list of links. That was tried first here and was caught by an existing test asserting the
"New debt" control is reachable `byRole("link")` — the one test in the suite that happened to care
about the role.

The answer is not to configure `Button` but not to use it: `<ButtonLink>`
(`components/shared/button-link.tsx`) renders a real `<Link>` and borrows the styling through the
exported `buttonVariants`, so it is an ordinary anchor — role link, Enter to follow, Space to
scroll, middle-click and right-click behaving as a reader expects — dressed by the same cva.

**Found in a browser, not by a test**: the Next dev overlay showed "1 Issue" on `/sales` during a
pass over the finished slices. Nothing in 998 tests had an opinion. There is now a source-walk
guard (`components/shared/button-as-link.test.ts`) that fails naming any file that reintroduces
the pattern; break-tested. `<DropdownMenuItem render={<Link />}>` is deliberately not matched —
Base UI's `MenuItem` already defaults `nativeButton` to `false`, and `role="menuitem"` is correct
for a menu entry.

### `login-form.tsx` pushed an unvalidated `?next=` — an open redirect
**Fixed 2026-09-09.** `router.push(searchParams.get("next") ?? ROUTES.overview)` trusted a value
that lives in a URL anyone can compose. `/login?next=//evil.example` is protocol-relative: the
browser supplies the scheme and leaves the origin, so the victim is walked off this product's
domain *immediately after typing their password* on a page they reached by trusting that domain.
`/\evil.example` does the same in browsers that normalise a backslash.

Found by the agent that built the server-side gate, which had already written the predicate for
its own header and noted in a comment that the login form did not apply it. That predicate now
lives in `lib/auth/safe-path.ts` — a module with **zero imports**, because both ends need it and
`lib/auth/server-session.ts` pulls in `next/headers`, which a client component can never import.
One copy, so the two ends cannot drift about what "internal" means.

Break-tested: restoring the old line turns exactly the three refusal tests red while the
legitimate-`next` test stays green.

### `formatExchange` converted money in the wrong direction
**Fixed.** It divided by the exchange rate where the backend multiplies. `exchangeRate` is *units of
MAIN per one unit of EXCHANGE* (`Backend/src/lib/money.ts:25-28`, `toMain = amount * rate`), so for
a Kenyan shop taking dollars — main KES, exchange USD, rate 130 — a USD 100 tender is **KES 13,000**
to the API and would have printed **KES 0.77** on the receipt.

The existing test locked the wrong answer, so the suite was green. The root cause was in the design
brief, which stated the pair backwards ("USD main, KES exchange at 130"); that has been corrected in
four places. **The direction is easy to invert because the way people say it out loud is the inverse
of the stored config.**

### The two-factor challenge token was dropped, and nothing failed
**Fixed.** `POST /auth/login` sets no cookie on the 2FA branch — `challengeToken` exists only in the
response body. The login form branched on `twoFactorRequired` and navigated to `/login/2fa` without
storing it, so the next screen had nothing to send and **a 2FA account could never finish signing
in**. No test, no typecheck, no lint and no console error caught it; every check was green and the
feature was simply impossible to use.

The token now parks in `sessionStorage` (`features/auth/hooks/use-two-factor-challenge.ts`),
deliberately not a `?challenge=` query param, which would put a value one six-digit guess from a
session into browser history, the `Referer` of every subresource, and any proxy log. The regression
guard in `login-form.test.tsx` was break-tested — removed the fix, watched it go red, restored it.

### Dark `--border-strong` equalled `--border`
**Fixed.** Every "strong" hairline was identical to a plain one, so the breadcrumb chevron was
effectively invisible in dark mode. The canvas draws `#565349` (artboard `1d`), a full step lighter
than the border it outranks.

### `API_ORIGIN` pointed at the wrong port
**Fixed.** `.env.local` said `8000`; the backend's `.env` runs it on **8001**. Every proxied request
would have failed. Confirmed fixed by a live round trip: `POST /api/v1/auth/register` through the
Next rewrite returns 201 with `Set-Cookie: tradeos_session=…; HttpOnly; SameSite=Lax`, first-party
on `localhost:3000`, which is the whole reason for the rewrite.

### Five plan/brief claims that were wrong about the API
All verified against backend source and then against a live server:

- **`sales.trend7`, not `sales.trend`.** Before the type existed this read as a silent `undefined` —
  a chart rendering nothing, with no error.
- **`debts` also returns `dueWithin7Days: { count, amount }`.**
- **`me.role` is `{ id, name }`**, an object, not a string.
- **`organization` also returns `timezone`, and `currency` is `{ main, exchange, rate } | null`** —
  not a currency code.
- **`stock.lowStock[].threshold` is `number | null`.**
- **There is no `DUPLICATE_EMAIL` code.** A taken address is `409 CONFLICT`.
- **The inviting business's name is not available before accepting.** The brief promised
  `Join {Business name}`; no public endpoint exposes it, and adding one would make a public route an
  oracle confirming a guessed token is live.

---

## 3. Security and risk

### The public page's rate limit is now shared by every reader of every link
**Found 2026-09-10 while building the projects slice. Needs a backend or infra change.**
`GET /public/projects/:token` is rate limited at **60 requests per minute keyed on `req.ip`**.
That is a sensible per-visitor budget when the visitor's browser calls the API directly. It is not
what happens here: the public page is rendered **server-side**, so the API sees the **Next server's
IP** for every reader of every business's link. The 60/minute is therefore a **product-wide** budget,
not a per-visitor one, and one business sharing a link widely can exhaust it for everybody.

The frontend mitigates only the cheap part — a token that fails a local shape check never becomes a
request. The real fix belongs behind the frontend: key the limit on the forwarded client IP
(`X-Forwarded-For`), or exempt the server-side renderer, or raise the ceiling knowing what it now
means. Worth deciding before the first client link is shared at any volume.

### Public project dates are rendered in UTC, because the payload has no timezone
**Found 2026-09-10. One backend field would fix it.** Every in-app screen renders dates in the
business's own timezone, taken from the session. The public page has no session, and the public
payload carries `startDate`, `dueDate`, `updatedAt` and each update's `createdAt` with **no
timezone anywhere in it**. So the client-facing page reads them in UTC.

Uniform for every reader, which is the least-bad default, but for a business east of Greenwich a
date can land a day early — a project "due 21 Sep" showing as 20 Sep to the customer it was shared
with. Adding the organization's timezone to the public payload is the whole fix.


### The public project page: three things that outlive an unpublish
**Found 2026-09-10 while extracting the projects contract. Backend, not frontend.**
`GET /public/projects/:token` is the only unauthenticated business route, and its payload is
tight — ids, customer, author and publish state are all dropped, and the key sets are asserted at
all three levels by `public-link.test.ts`. Three things still leak, in rising order of concern:

1. **`updatedAt` is exposed**, so an anonymous visitor can see when the project was last edited
   internally. Minor, but it is timing information about private activity.
2. **`cover.url` and `business.logo` embed the organizationId in plaintext**, and the bucket is
   public-read with no signed URLs. So those images keep resolving **after the project is
   unpublished** — the page goes away, the pictures do not.
3. **The public lookup never checks organization status.** A suspended organization's published
   project stays reachable. Suspension is presumably meant to stop a business being served; here it
   does not stop the one route that serves it to strangers.

Also worth knowing, and not a leak but an oracle: a token longer than 128 characters returns
**422**, not 404, so the route is not perfectly opaque about what a well-formed token looks like.

None of these is fixable from the frontend. Recorded here rather than worked around.

### The share token is shown once and cannot be recovered
**Found 2026-09-10. Product consequence, not a bug.** The token is 32 random bytes, stored only as
a SHA-256 hash, and returned exactly once — by the `publish` that mints it. `publish` on an
already-hashed project reuses the hash and answers `shareToken: null`, and no read endpoint ever
returns it. So a client that does not keep the value from that one response has lost the link, and
the only recovery is `regenerate-link`, which **kills every link already shared with a client**.
The UI must therefore treat the publish response as the single moment the link exists, and say so.


### `RouteGuard` is preset-shaped, not catalog-shaped
`/overview`, `/announcements`, `/help` and `/account` are ungated because all three preset roles
hold the permissions behind them. **Roles are editable**, so a hand-built custom role without
`announcements:view` would see the nav item, pass the guard, and meet a 403 inside the panel.
`RouteGuard` removes the common dead end, not every one — pages still owe brief §8.4 their own
inline 403 handling. Gating `/overview` is also self-defeating: the ForbiddenScreen's way out points
there.

### The client permission layers are UX, not security
Three layers, and only one of them enforces anything:

| Layer | What it does |
|---|---|
| `proxy.ts` | Cookie present? Bounce to `/login` if not. Optimistic, never fetches. |
| `RouteGuard` + `PermissionGate` | Hides what the caller cannot use, shows a calm refusal on a direct URL. |
| **The API** | The only thing actually enforcing. 403, re-checked on every request. |

Do not let a future change treat the first two as the boundary.

### Next 16 Proxy now defaults to the Node runtime
Previously Edge. Proxy code can now reach for `fs`/`crypto` and compile, so the "never fetch, never
do slow work in the proxy" rule is easier to break by accident than when the runtime refused. The
matcher syntax is unchanged from Middleware; the rename is file and function name only.

### `proxy.ts` is a deny-list, and five paths must never be added to `GUEST_ONLY_PATHS`
There is no public-paths allow-list, and adding one would be behaviour-identical dead code that
*reads* like a gate. `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite` and
`/onboarding` already fall through in both states. Two have signed-in callers **by design**: a
returning invitee is signed in when they click an invitation link
(`Backend/src/services/auth.service.ts:338-397`), and a signed-in user may follow a verification
link. Making either guest-only breaks a supported flow.

---

## 4. Operational gotchas

- **Next 16 allows exactly one dev server per project directory, whatever the port.** A second
  `next dev` in this repo fails outright with a `taskkill` suggestion. This blocks parallel agents
  from each running one.
- **`POST /auth/resend-verification` requires a session**, and the verification link is routinely
  opened on a *different device* from the one that registered. An expired-link page must branch on
  whether a session exists; offering a Resend button that 401s is the trap.
- **Resending a verification email invalidates the link already in the inbox** — the backend clears
  prior verifications before minting a new token, so the older email starts reading as expired.
- **The real resend limit is 5 per hour**, not the 60-second UI cooldown, which is only a
  double-click guard and does not survive a remount.
- **Every invite failure is one `400 BAD_REQUEST`** — unknown, expired, already-accepted, mismatched
  — deliberately, so the endpoint cannot be probed. A banned invitee is 403 and an existing-email
  invitee is 409.
- **`rounded-lg` is 10px in this repo** (`--radius: 0.625rem`), so the canvas's 8px rows need
  `rounded-md`.
- **Biome's `useSemanticElements` rejects `role="status"` and `role="group"`** — use `<output>` and
  `<fieldset>` with an `sr-only` `<legend>`.
- **`searchParams` is a Promise in Next 16.** Awaiting it in a Server Component avoids the
  `<Suspense>` boundary `useSearchParams` would otherwise require.
- **`**/verify-email**` inside a JSDoc block silently ends the comment.**

---

## 5. Deferred and worth doing

- **`useOrganization()` costs a request the dashboard has already answered.** `GET /dashboard`
  returns `organization.timezone` and `organization.currency`, so the Overview fetches the currency
  config a second time. Reading it from the dashboard payload on that page would remove a request.
- **No *automated* end-to-end browser test exists.** A manual pass has now been driven through a
  real Chrome session against a real backend (see §6), so the claim that nothing had ever been seen
  in a browser is retired. What is still missing is a test that *re-runs*: today the pass is a
  person driving a browser, so it proves the screens at one moment and guards nothing afterwards.
  Playwright remains the obvious investment.
- **A 429 shows twice** — the axios interceptor toasts centrally and the auth forms also banner it.
  One cross-form cleanup.
- **The `⌘K` search trigger is rendered and wired to nothing.**
- **Passkey login renders disabled.** The backend supports it; the WebAuthn ceremony is unbuilt.
- **`SheetOverlay` hardcodes `bg-black/10`** where the canvas wants ~45%; it is inside vendored
  `components/ui/sheet.tsx`.
- **Three things the reports screens want and the API cannot give** (`docs/findings/slice5-reports.md`
  §5): there is **no export endpoint** behind the design's Export chip; **no period-over-period
  figure**, so "up 12% on last month" cannot be shown without a second request per number and a
  client-side subtraction; and **366 days is a hard ceiling** on any range, which rules out a
  year-on-year view. The Export chip and the reserved Highlights card were left unbuilt rather than
  shipped as controls that do nothing.
- **`typedRoutes` can now be turned on.** It was off because most paths in `config/routes.ts` had no
  page; every one of them does as of 2026-09-10. Worth its own change — the first build with it on
  is the one that finds every stale `href`.

---

## 6. The visual pass — what a real browser actually showed

**Run 2026-09-09** against `localhost:3000` proxying a live backend on `8001`, in Chrome, signed in
as a seeded business (`Bakaara Traders`, main **KES**, exchange **USD** at 130, `Africa/Nairobi`)
holding ten products across every stock state and five customers. Both themes. Slice 2's screens
had never been opened in a browser before this; every prior claim about them rested on unit tests,
typechecks and source reading.

### Confirmed working, against a real server

- **The category-protection fix (`Backend a70ebef`) is correct end to end.** All four seeded
  categories carry `isDefault: true`; only **General** rendered the *Protected* badge and only
  General lacked a delete control. The other three — Electronics, Food & Drinks, Household — each
  kept theirs. This is the exact screen the bug would have ruined: gating on `isDefault` shows four
  Protected badges and offers a delete on none. Product counts also reconciled (3 + 5 + 0 + 2 = 10).
- **Money renders as a code, never a symbol**, two decimals, right-aligned mono — `KES 1,450.00`
  throughout, on a business whose books are in shillings. Quantities kept three decimals and trimmed
  trailing zeros (`2.5 kg`, `63 bag`).
- **The restock dialog's live preview is arithmetically right**: 63 bag + 12.5 → `75.5 bag`,
  including the fractional quantity.
- **Stock movements read correctly.** `quantityAfter` is a **server-provided field per movement**
  (`id, productId, type, quantity, quantityAfter, reason, createdBy, createdAt`) — it is not
  derived client-side, so pagination cannot desynchronise it.
- **Dark mode holds up** across list, detail and dialog. `color-scheme: dark` is set on the root, so
  even the native `<select>` popups render dark rather than flashing white.
- **Timezone is the business's, not the browser's**: movements recorded at 15:17 UTC displayed as
  `09 Sep 2026 18:19` — East Africa Time.

### Deviations from the canvas, both cosmetic

- **The `<select>` arrow is the OS glyph**, where artboard `2c` draws a lucide chevron. The controls
  are otherwise fully themed — 10px radius, Geist, 38px tall, correct token border — so this is the
  arrow alone, not an unstyled control.
- **The product thumbnail placeholder is a flat panel reading "No photo"**, where artboards `2a`
  and `2c` draw a 135° diagonal hatch with a small mono caption.

### What the pass could not establish

- **It ran at a 1513px CSS viewport, not 1440.** The Chrome window was maximized and refused
  programmatic resize, and the display runs at DPR 1.25. Both widths sit in the same breakpoint
  band, so layout structure is comparable and column proportions are not.
- **It is a moment, not a guard.** Nothing here re-runs; see the Playwright note in §5.

### Method note, for whoever repeats this

Signing in was done **without typing a password**: the session was established over the API with
`curl`, and the resulting `tradeos_session` cookie was set on the origin from the console. The
backend logs verification emails rather than sending them when SMTP is unconfigured
(`Backend/src/lib/mailer.ts`), so the seeded account's address was marked verified directly in
MongoDB — `POST /organizations` requires a verified email and would otherwise be unreachable.
