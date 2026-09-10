# Slice 5 — settings, account & security

Built against `docs/contracts/settings-account.md` (verified read of `Backend`,
2026-09-10) and artboard `2k` (`docs/design/TradeOs-UI.dc.html:1323-1491`).
`/settings` and `/account` were both dead links before this; both now exist.

---

## 1. What was built

| # | Area | Where |
|---|---|---|
| 1 | Business profile + currency | `features/settings/`, `app/(app)/settings/page.tsx` |
| 2 | Account profile + change password | `features/account/components/{profile-form,change-password-form}.tsx` |
| 3 | Sessions list + sign out other devices | `features/account/components/sessions-panel.tsx` |
| 4 | Two-factor enable / disable | `features/account/components/two-factor-{panel,enable-dialog}.tsx` |
| 5 | Passkeys — register, list, remove | `features/account/components/passkeys-panel.tsx` |

`features/organization/` was **extended, not duplicated**: the existing
`types.ts`, `keys.ts`, `services/organization.service.ts`,
`use-organization.ts` and `use-currency-config.ts` are all reused. What was
added there is the two PATCH service functions the file's own comment said to
add "when Settings lands", the two update schemas the schema file said the same
about, `hooks/use-organization-mutations.ts`, `hooks/use-organization-profile.ts`,
and `lib/{timezones,currencies}.ts`.

`features/settings/components/form-primitives.tsx` is shared with
`features/account`. Settings and Account are one slice and one artboard and sit
side by side in the design, so a divergence between them would be a visible bug.
They are deliberately **not** promoted into `components/ui/`, which is vendored
shadcn and is regenerated rather than hand-edited.

**Verification:** `bunx tsc --noEmit` clean, `bunx biome check` clean over the
slice, `bunx vitest run features/settings features/account features/organization`
green (59 tests / 8 files, of which 30 are new). One transient `tsc` failure was
seen mid-session — `.next/dev/types/validator.ts` referencing
`app/(app)/reports/page.tsx` — and was a live `next dev` regenerating route
types while another agent added that page. It cleared on the next run and has
nothing to do with this slice.

---

## 2. What was **not** built, and why

### 2.1 A per-session "sign out this device" — the API has no endpoint

The design draws one (`TradeOs-UI.dc.html:1449-1458`). The whole session surface
is four routes: `GET /auth/sessions`, `POST /auth/logout`,
`POST /auth/logout-all`, `POST /auth/logout-others`. There is **no
`DELETE /auth/sessions/:id`**, and `session.actions.ts` exports nothing
reachable with a client-supplied id — `deleteSessionById` exists and is wired
only to `/logout`, for the caller's own session.

So the list is **read-only**, with two account-wide actions above it, and an
info note under it that says signing out a single device is not possible yet.
`sessions-panel.test.tsx` asserts that no row contains a button, so a future
edit cannot quietly add one back.

**For the backend:** the db action to build `DELETE /auth/sessions/:id` on
already exists; it is only unrouted. Until it is, `GET /auth/sessions` returns an
`id` per row that nothing in the product consumes.

Two related gaps the panel also does not paper over:

- **No device parsing.** `userAgent` arrives raw or `null`.
  `features/account/lib/user-agent.ts` makes a shallow, tested guess
  ("Chrome · Windows") and, when it cannot tell, renders the **raw string**
  rather than "Unknown device" — a confident wrong label is what would make
  somebody dismiss a session that is not theirs.
- **No "last active".** Only `createdAt` and `expiresAt`, and `expiresAt` is
  written at most once a day. It is labelled as an expiry, never as activity.

### 2.2 Deleting an owner's account — the API refuses, permanently

`DELETE /auth/account` is a 409 `OWNS_ORGANIZATION` whenever
`countOrganizationsOwnedBy > 0`, checked before *and* inside the transaction.
The message says to transfer ownership first, and **there is no
ownership-transfer endpoint anywhere in the API** — no
`POST /organizations/current/transfer`, and `ownerId` is not writable on any
schema. Since `createOrganizationForUser` makes the creator the owner and
enforces one business per person, the first user of every tenant is permanently
in this state.

So an owner sees **no delete button at all** — the panel renders the explanation
where the control would be, says plainly that TradeOs cannot hand a business to
another member yet, and points at support. The API's own test proves the refusal
changes nothing (user, credentials, session and membership re-asserted intact),
so nothing is lost by not offering it, and a person is spared typing their
password to be told no.

Ownership is detected from `session.role.name === "Owner"`, because `GET /auth/me`
returns `role: { id, name }` and no `ownerId`. `"Owner"` is a reserved preset
name no custom role may take, so it is a good signal — but it is a hint, not the
gate. The 409 is still handled in the dialog for the case where the hint is
wrong.

### 2.3 Recovery-code count, re-display and regeneration

Not implementable. The ten codes come back **once**, at `/2fa/verify`, and are
stored as argon2id hashes. There is no view endpoint, no regenerate endpoint,
and no remaining-count endpoint — `usedAt` is tracked in the database and never
serialised. A "3 of 10 remaining" panel would be a guess.

The enable dialog therefore ends on a hard stop: the codes are shown alone, an
explicit "I have written these down" checkbox gates the only exit, and both
`disablePointerDismissal` and the controlled `onOpenChange` guard block every
other way out — including Escape, which would otherwise destroy ten
unrecoverable credentials with one keystroke. The enabled-state panel says the
codes cannot be shown again and that turning 2FA off and on is the only way to a
fresh set.

There is deliberately **no copy button and no download** for them, and none for
the TOTP secret: both write a credential somewhere this app cannot clear it
from. The blocks are `select-all` instead.

### 2.4 Passkey rename, device type, and passkey **sign-in**

- **No rename.** `passkeyRenameSchema` exists upstream and is imported by
  nothing; there is no `PATCH /auth/passkeys/:id`. The label is fixed at
  registration, which is why the UI collects it deliberately *before* the
  ceremony and the hint says it cannot be changed.
- **No device type.** `transports` is stored and never returned, so every row
  gets the same neutral key glyph.
- **Passkey sign-in is not in this slice.** `POST /auth/passkeys/login/*` is
  public and belongs to the login screen, which `features/auth` owns. Noted for
  whoever builds it: `allowCredentials` is deliberately absent from the login
  options, so the flow is **usernameless / discoverable-credential only** — the
  button is "Sign in with a passkey", never "…for this email address" — and a
  passkey sign-in **bypasses 2FA entirely, on purpose**.

### 2.5 Email change, avatar upload, audit log, org delete

None exist in the API (contract §12). The profile screen renders the email as a
**read-only fact with a line saying why**, rather than a disabled input that
implies the feature is merely switched off. The avatar is a free-string URL,
because there is no upload-backed avatar endpoint — unlike the organization
logo, which is upload-backed and is wired.

---

## 3. Decisions and things worth knowing

### 3.1 No dependency was added. Two things were written instead.

**A QR encoder** (`features/account/lib/qr.ts`, ~330 lines, byte mode, EC level
M, versions 1-10). `POST /auth/2fa/setup` returns `otpauthUri` and **no QR
image** — deliberately, so the client renders it — and `package.json` has no QR
library. Adding one is the owner's call, so the algorithm is written out.

It is proven by round trip: `decodeQr` walks the same geometry in reverse and
`qr.test.ts` asserts `decodeQr(encodeQr(x)) === x` for a real `otpauth://` URI,
for multi-byte UTF-8, and at **every one of the ten version boundaries**. That
matters more than it sounds: a wrong mask, a transposed format-bit copy, an
off-by-one in the zigzag walk or a mistyped block-size row all produce a matrix
that renders convincingly and does not scan. Structural assertions (three finder
patterns, both timing lines, the always-dark module) cover the rest. One real
bug was caught this way — the mask was being read from the low three bits of the
format word instead of bits 12-10, which are BCH remainder; every round trip
failed until it was fixed.

The QR is the one place in this app that hardcodes `#ffffff` / `#000000` rather
than using tokens. A QR is read by a camera measuring contrast: under
`--foreground` on `--card` it inverts in dark mode, and an inverted QR is
unreadable to most scanners.

**A WebAuthn wrapper** (`features/account/lib/webauthn.ts`). `package.json` was
checked and has no `@simplewebauthn/*` entry, so the raw platform API is used:
`PublicKeyCredential.parseCreationOptionsFromJSON` and `credential.toJSON()`
where they exist, with a hand-written base64url conversion behind them for older
browsers. **base64url, never base64** — the API's validator is
`/^[A-Za-z0-9_-]*$/` and any `+`, `/` or `=` is a 422, which is the bug that
stays invisible until a real device is in front of you.

### 3.2 `lib/api/client.ts` **does** support a DELETE body — checked

`apiDelete(url, config)` forwards its config to `api.delete`, and axios sends
`config.data` on a DELETE. `features/auth/services/auth.service.ts` already
calls it correctly: `apiDelete<void>("/auth/account", { data: input })`, with a
comment on `apiDelete` naming this exact endpoint as the reason the parameter
exists. Nothing needed changing. A bodyless DELETE here would be a 422, not a
401 or 400.

### 3.3 Everything on the account side was already scaffolded at the service and
schema layer

`features/auth/services/auth.service.ts` and
`features/auth/schemas/auth.schema.ts` already contained every one of the
fourteen account/security calls and their input schemas, correctly typed. This
slice added hooks and components on top and **wrote no new service function for
`/auth/*`**. Worth knowing before anyone adds a `features/account/services/`
directory: it would be a second copy of a correct file.

### 3.4 Credentials are kept out of the React Query cache on purpose

Every mutation whose `variables` or `data` is a credential — change password,
delete account, 2FA setup, verify and disable — is declared **`gcTime: 0`**.
React Query keeps a settled mutation for five minutes by default, and
`@tanstack/react-query-devtools` is mounted in development
(`app/providers.tsx:56-58`) and renders mutation variables and data verbatim in
a panel. The default would put a plaintext password, a TOTP secret or ten
recovery codes on screen for five minutes after they were typed, and leave them
in any heap snapshot taken meanwhile.

Alongside that: no component holds a credential in state past the request that
used it (all are cleared in both `onSuccess` and `onError`), and **nothing in
this slice logs anything** — no `console.*` was added to any file.

### 3.5 The currency form refuses what the API accepts

`mainCurrency === exchangeCurrency` parses fine upstream, and the damage is
silent: `resolveRate` tests `currency === config.mainCurrency` **first**, so
with both set the same, every amount resolves at rate 1 and the configured
`exchangeRate` becomes data no sale, payment or debt will ever apply. The
refinement lives on `updateCurrencySchema`, targets the **second** field so the
message lands where the fix is, and says why rather than only refusing.

Three more shapes the form is built around: the rate is typed as a JSON
**number** (`"600"` is a 422) and held as a string in state so a half-typed
`"0."` is representable; all three fields submit together, because a one-field
PATCH leaves the pair describing a currency that is no longer main; and the code
list is a curated dropdown, because the API only shape-checks `/^[A-Z]{3}$/` and
would store `"ZZZ"`. `ensureCurrencyOption` keeps a business's existing code
selectable even when the catalog does not list it, so opening this screen can
never silently overwrite a working configuration.

The rate line reads `1 <exchange> = <rate> <main>`, matching
`toMain(amount, rate) = amount * rate`. This repo has shipped that inversion
once already (`docs/FINDINGS.md`, "Money direction").

### 3.6 Timezone: a picker, even though the backend now validates

Backend commit `5179756` made an invalid zone a 422 rather than a silent write,
so the old failure — a garbage zone reaching `TZDate`, `getTime()` returning
`NaN`, and every period-scoped report for the tenant reading empty — is closed
server-side. The picker is still built from `Intl.supportedValuesOf("timeZone")`
because a 422 on a free-text field is a dead end for someone who does not know
how their own zone is spelled. It degrades to fifteen common zones plus UTC on a
runtime without `supportedValuesOf` (older Safari, a Node built without full
ICU), and `isSupportedTimezone` probes `Intl` directly on that path so a real
zone this build could not enumerate is never rejected.

---

## 4. Open for the owner

1. **Ask the backend for `DELETE /auth/sessions/:id`.** It is the one thing the
   design asks for that the API cannot do, `deleteSessionById` already exists,
   and until it lands `GET /auth/sessions` returns an `id` per row with no
   consumer. (§2.1)

2. **`/account` is gated more tightly than the API requires.** Not one of the
   fourteen account routes carries `requireMember`, and a user with no `Member`
   row gets a 200 from `PATCH /users/me` — the contract is explicit that a
   settings screen must render for a member-less user. But `/account` lives
   inside `app/(app)/`, and both `app/(app)/layout.tsx` and `requirePageAccess()`
   redirect an organization-less caller to `/onboarding` before the page
   renders. The repo-wide test in `lib/auth/require-page-access.test.ts` requires
   every page under `(app)` to call `requirePageAccess`, so diverging here was
   not this slice's call to make.

   Nothing in the components needs an organization — the only use is a timezone
   for date formatting, which falls back to UTC — so if the owner wants a
   member-less user to reach their own account settings (to turn on 2FA before
   creating a business, say), moving the route out of the shell is a relocation,
   not a rewrite.

3. **Should the QR encoder stay, or should a library land?** It is written,
   tested and dependency-free, and `qr.ts` is self-contained enough to delete in
   one commit if the owner would rather add `qrcode` or
   `@simplewebauthn/browser` and simplify both `qr.ts` and `webauthn.ts`. That
   is a dependency decision, not an implementation one, so it was not taken
   here.

4. **`/settings` currently has no read-only mode.** It is gated on
   `organization:update`, so a member with only `organization:view` does not
   reach it at all and has no way to look up the business's own phone number or
   currency. That matches the existing `ROUTE_PERMISSIONS` row and was not
   changed; worth a decision if it comes up.
