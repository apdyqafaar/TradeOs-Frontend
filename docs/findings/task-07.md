# Task 7 — the organization slice and the onboarding wizard

## `formatExchange` converts in the opposite direction from the backend

**What:** `lib/format/money.ts` treats `exchangeRate` as *exchange units per one main unit*
and divides by it. The backend treats it as *units of MAIN per one unit of EXCHANGE* and
multiplies. One of the two is wrong, and it is the frontend.

**Evidence:** `Backend/src/lib/money.ts:25-28` —
`toMain = (amount, rate) => round2(amount * rate)`, with the comment "`rate` is
`CurrencyConfig.exchangeRate`: units of MAIN per one unit of EXCHANGE". The model agrees:
`Backend/src/db/models/currency-config.model.ts:9` — "How many units of mainCurrency one unit
of exchangeCurrency is worth". `sale.service.ts:57` and `debt.service.ts:33` both feed that
same value into `toMain`.

Against that, `Frontend/lib/format/money.ts:74` computes `amount / rate`, and
`lib/format/money.test.ts:54` locks it: `formatExchange(5000, "KES", 130, "USD")` →
`"≈ USD 38.46 @ 130"`. For a realistic Nairobi configuration — books in KES, dollars taken at
the counter, `mainCurrency: "KES"`, `exchangeCurrency: "USD"`, `exchangeRate: 130` — a USD 100
tender is KES 13,000 to the API (`toMain(100, 130)`) and `KES 0.77` on the receipt the frontend
prints.

**So what:** whoever owns `lib/format/money.ts` should multiply, not divide, and flip the
locked expectation in its test. It is out of scope for this task and was not touched. Until it
is fixed, do not use `formatExchange` on any screen that shows a foreign-currency payment
beside the API's own converted total — they will disagree by a factor of `rate²`.

The onboarding wizard's live helper line is written in the backend's direction on purpose:
`1 {exchangeCurrency} = {rate} {mainCurrency}` ("1 USD = 130 KES" for main KES). The plan's
step 6 gives the example line as "1 USD = 130 KES" alongside a payload whose `mainCurrency` is
USD, which is the inverted reading; `onboarding-wizard.test.tsx` now locks the correct one.

## There is no currency on an organization, so `useOrganization` cannot avoid a second request

**What:** the plan's interface note says `useOrganization` "reads
`useSession().data.organization.timezone` and the currency config, so it never triggers a second
request on a page that already has the session." Only the first half is achievable. The session
carries the timezone; nothing carries the currency, so one extra GET exists.

**Evidence:** `publicOrganization` in `Backend/src/controller/organization.controller.ts:21-31`
returns `id, name, slug, timezone, phone, address, logo, status, createdAt` — no currency, and
the comment above it says why: the backend's Task 26 moved currency onto its own
`CurrencyConfig` collection with its own endpoints, "so it is deliberately absent here rather
than reproduced from a stale pre-Task-26 shape". `SessionData.organization` in
`features/auth/services/auth.service.ts` mirrors that: `{ id, name, slug, timezone }`.
`GET /organizations/current/currency` is the only source.

**So what:** `useOrganization` issues exactly one extra query, under
`organizationKeys.currency()`, deduplicated across every component that calls the hook and held
for 30 minutes. It is **not** a second session fetch — the session comes back from cache. Do not
try to "optimise it away" by reading a currency off `/auth/me`; the field is not there. The one
place that gets it free is right after onboarding, where `useCreateOrganization` seeds the key
from the create response.

Related: `GET /organizations/current/currency` is gated on `organization:view`, which
`PRESET_SELLER` holds (`lib/auth/permissions.ts:115`). Checked, because a Seller who could not
read it would have no currency to format prices with anywhere in the app.

## `POST /organizations` returns three objects, not an organization

**What:** the plan types the mutation as
`UseMutationResult<Organization, ApiError, CreateOrganizationInput>`. The endpoint answers with
`{ organization, currency, role }`.

**Evidence:** `createOrganizationHandler`,
`Backend/src/controller/organization.controller.ts:64-68` — `createdResponse(res, "Your business
is ready", { organization, currency, role: { id, name, permissions } })`.

**So what:** the hook is typed `CreateOrganizationResult`. The extra two are worth having: the
currency seeds `organizationKeys.currency()` so the first screen after onboarding formats money
without a round trip, and the role is the permission list the shell renders from. Typing it as
`Organization` would have thrown both away and then re-fetched them.

## Neither `config/routes.ts` nor `proxy.ts` needed a change

**What:** the plan lists `config/routes.ts` as a modified file for this task and the File
Structure section lists `proxy.ts` under "(Task 5, Task 7)". Neither needed an edit.

**Evidence:** `ROUTES.onboarding: "/onboarding"` already exists in `config/routes.ts:32`. In
`proxy.ts`, `/onboarding` is correctly in neither list: not `GUEST_ONLY_PATHS` (a signed-in
person is exactly who belongs there) and not `APP_SHELL_PREFIXES` (there is no tenant yet, so
there is no shell). Both files were left untouched.

**So what:** one consequence is worth knowing. An anonymous visitor to `/onboarding` is not
bounced by the proxy; the page renders, `GET /auth/me` 401s, and the api client's 401 handler
navigates to `/login`. That is the documented posture ("optimistic cookie-presence check only"),
not a hole — but it is a redirect the user sees rather than one the proxy absorbs.

## The unverified-email notice has no working Resend, by necessity

**What:** the plan asks for the notice "with a resend link". `POST /auth/resend-verification`
needs a hook (`features/auth/hooks/use-resend-verification.ts`) that belongs to Task 4 and did
not exist when this task ran. Importing a file another agent had not written yet would have
failed the typecheck.

**So what:** the notice offers "I've confirmed it — check again", which invalidates
`authKeys.session()` and re-reads the verification flag. That is the case that actually happens
— the link is opened on a phone or in another tab and nothing tells this page — and it needed no
new endpoint. When Task 4's `useResendVerification` lands, adding a Resend beside it is a
four-line change in `onboarding-wizard.tsx`.

## Backend create/update bodies here are NOT strict, contrary to the scaffolder's advice

**What:** `.claude/skills/new-feature/templates/schemas.ts.template` says to mirror backend
bodies with `z.strictObject` because "the backend's bodies are `.strict()`, so an unknown key is
a 422". The organization validators are plain `z.object`s and rely on the opposite behaviour.

**Evidence:** `Backend/src/validators/organization.validation.ts:5-9` — "Only these fields are
updatable. slug, ownerId and status are absent by design — **Zod strips unknown keys**, so a
client cannot rename its slug, transfer ownership, or un-suspend itself by adding fields to the
body." The same reasoning is spelled out again over `updateCurrencySchema` for `organizationId`.

**So what:** `createOrganizationSchema` in this slice is a `z.object`, not a `z.strictObject`.
Mirroring it as strict would reject payloads the API accepts. Check the actual validator before
following the template's rule of thumb — it is not uniform across the backend.

## Three Zod-4 / React-Query behaviours that cost time

**What, evidence and so what,** three short ones:

- **Zod 4 fails the base type check before any refinement.** An empty
  `<input type="number">` registered with `valueAsNumber` yields `NaN`, and
  `z.number().positive("…").finite("…")` reports `"Invalid input: expected number, received
  NaN"` — neither custom message fires. Verified with the installed zod 4.5.4. The readable
  message has to go on the type itself: `z.number({ error: "Exchange rate is required" })`.

- **`tz("")` throws.** `format(new Date(), "dd MMM yyyy", { in: tz("") })` raises
  `RangeError: Invalid time value`; `tz("UTC")` does not. That is why `useOrganization` falls
  back to `"UTC"` and not `""` while the session loads — an empty zone reaching `formatDate`
  takes the tree down. The currency falls back to `""` instead, deliberately: `formatMoney(x,
  "")` renders an unlabelled number, which is visibly incomplete, whereas `"USD"` would render
  a confident lie over a Kenyan shop's takings.

- **A disabled query reports `isPending: true` forever** in React Query v5 (`status: "pending"`,
  `fetchStatus: "idle"`). `useOrganization` therefore only folds the currency query into
  `isLoading` when there is an organization to fetch one for; without that guard every
  signed-out and mid-onboarding screen would load for ever.

## Both 409s from `POST /organizations` share one code

**What:** the endpoint can answer 409 for two unrelated reasons — the caller already belongs to
a business, and the derived slug is taken — and both arrive as `code: "CONFLICT"`.

**Evidence:** `Backend/src/services/organization.service.ts` throws `ConflictError` with
`ALREADY_HAS_ORGANIZATION` in one branch and `An organization named "…" is already registered.`
in the other. `ConflictError` carries no distinguishing code.

**So what:** the repo rule is "branch on `code`, never on `message`", and here there is no code
to branch on. The wizard therefore *renders* the API's sentence rather than branching on it —
the backend writes both sentences for a person to read, and they are the only thing that tells
the two cases apart. If a screen ever needs to *behave* differently between them (offer "go to
your business" versus "pick another name"), the backend needs to give them distinct codes first.
