# Settings, account & security — API contract

Extracted read-only from `Backend` (no edits made there; the one temporary probe
file used for the zod proof in §3 was written outside the repo and the repo is
clean). Every claim below is `file:line` against `Backend` as of this read
(2026-09-10).

Chains traced end to end:

```
src/routes/v1/organization.route.ts -> src/controller/organization.controller.ts
  -> src/services/organization.service.ts -> src/db/actions/{organization,currency-config}.actions.ts
  -> src/db/models/{organization,currency-config}.model.ts

src/routes/v1/user.route.ts -> src/controller/user.controller.ts
  -> src/services/user.service.ts -> src/db/actions/user.actions.ts -> src/db/models/user.model.ts

src/routes/v1/auth.route.ts -> src/controller/{auth,two-factor,passkey}.controller.ts
  -> src/services/{auth,two-factor,passkey,session}.service.ts
  -> src/db/actions/{session,two-factor,two-factor-challenge,passkey,passkey-challenge,account}.actions.ts
  -> src/db/models/{session,two-factor,two-factor-challenge,passkey,passkey-challenge}.model.ts
```

Plus `src/validators/{organization,user,two-factor,passkey,auth,common}.validation.ts`,
`src/lib/{totp,cookies,money,period}.ts`, `src/middleware/{validate,auth,rate-limit,error}.middleware.ts`,
`src/util/{responses,errors}.ts`, `src/config/index.ts`, `src/app.ts`.

Tests read: `tests/integration/auth/{account,login,two-factor-setup,two-factor-login,passkeys}.test.ts`,
`tests/integration/user-profile.test.ts`, `tests/integration/organization.test.ts`,
`tests/helpers/webauthn.ts`.

---

## 0. Facts that apply to every row below

**Base URL** is `/api/v1` (`Backend/src/app.ts:54`). Services pass the path only.

**Envelope** (`Backend/src/util/responses.ts:3-29`):

```jsonc
{ "success": true,  "message": "…", "data": { /* … */ } }               // success
{ "success": false, "message": "…", "errors": {…}, "code": "…", "details": {…} } // failure
```

`errors` (field map) appears only on 422; `code` and `details` appear only when
the failure was raised as an `AppError` (`error.middleware.ts:80-98`). `data` is
omitted entirely when a handler passes none — e.g. `POST /auth/2fa/disable`
and `DELETE /auth/passkeys/:id` return `{ success, message }` with **no `data`
key at all** (`two-factor.controller.ts:75`, `passkey.controller.ts:120`,
`responses.ts:41`).

**Middleware chain**, declared per-route, never `router.use(...)`:

```
[rateLimit] -> validate({ body|params }) -> requireAuth -> [requireVerifiedEmail]
   -> [requireMember] -> [requirePermission] -> handler
```

**Trap 0 — validate runs before auth, and rateLimit runs before validate.**
An anonymous request with a bad body gets **422**, not 401. An anonymous
request that has blown the limiter gets **429**, not 401. Both are visible in
the tests: `tests/integration/auth/two-factor-login.test.ts:344-356` asserts
422 for a missing `challengeToken` on the *public* `/2fa/challenge` with no
session anywhere in sight.

**Every route with no body declares `noBodySchema`** =
`z.object({}).strict().optional()` (`common.validation.ts:21`). An unexpected
payload is a **422 `Unrecognized key: "x"`**, not a silent no-op — proven for
`/2fa/setup` (`two-factor-setup.test.ts:146-160`), `/logout-others`
(`account.test.ts:228-238`) and `/passkeys/register/options`
(`passkeys.test.ts:225-236`). **Do not send `{}` "just in case" on a
GET/POST-with-no-body — `{}` is accepted, but any key is a 422.**

**Cookies and CORS.** The session cookie is `httpOnly`, `path=/`,
`secure` only in production, `sameSite: "none"` in production and `"lax"`
otherwise (`Backend/src/lib/cookies.ts:4-12`). CORS is
`origin: config.frontendUrl` (a single exact origin) with `credentials: true`
(`Backend/src/app.ts:34-41`). Every request from the browser must be
`credentials: "include"`. There is no bearer-token path anywhere in this
surface.

**Rate limits** are per-IP fixed windows, one named bucket per endpoint
(`rate-limit.middleware.ts:108,144-170`). On exhaustion: **429**, header
`Retry-After: <seconds>`, body `code: "TOO_MANY_REQUESTS"`, message
`"Too many attempts. Try again in N seconds."` The buckets relevant here:

| bucket | window | max | route |
|---|---|---|---|
| `login` | 15 min | 10 | `POST /auth/login` (`auth.route.ts:63`) |
| `change-password` | 15 min | 10 | `POST /auth/change-password` (`auth.route.ts:134-138`) |
| `delete-account` | 15 min | 10 | `DELETE /auth/account` (`auth.route.ts:139-143`) |
| `2fa-setup` | 15 min | 20 | `POST /auth/2fa/setup` (`auth.route.ts:200`) |
| `2fa-verify` | 15 min | 10 | `POST /auth/2fa/verify` (`auth.route.ts:196`) |
| `2fa-disable` | 15 min | 10 | `POST /auth/2fa/disable` (`auth.route.ts:197`) |
| `2fa-challenge` | 15 min | 10 | `POST /auth/2fa/challenge` (`auth.route.ts:191-195`) |
| `passkey-register` | 15 min | 20 | both `/auth/passkeys/register/*` **share one bucket** (`auth.route.ts:265-269`) |
| `passkey-login-options` | 15 min | 30 | `POST /auth/passkeys/login/options` (`auth.route.ts:260-264`) |
| `passkey-login-verify` | 15 min | 10 | `POST /auth/passkeys/login/verify` (`auth.route.ts:252-256`) |

`GET /auth/sessions`, `PATCH /users/me`, `GET|DELETE /auth/passkeys*` and every
`/organizations*` route carry **no limiter**.

---

## A. Organization settings

`organization.route.ts` mounts five routes at `/organizations`
(`Backend/src/routes/v1/index.ts:27`). There are **no others** — no list, no
`GET /organizations/:id`, no delete, no ownership transfer.

| # | Method | Path | Gate | Line |
|---|---|---|---|---|
| A1 | POST | `/organizations` | `requireAuth` + `requireVerifiedEmail` (**no** `requireMember`, **no** permission) | `organization.route.ts:50-56` |
| A2 | GET | `/organizations/current` | `organization:view` | `organization.route.ts:68-75` |
| A3 | PATCH | `/organizations/current` | `organization:update` | `organization.route.ts:77-84` |
| A4 | GET | `/organizations/current/currency` | `organization:view` | `organization.route.ts:86-93` |
| A5 | PATCH | `/organizations/current/currency` | `organization:update` | `organization.route.ts:95-102` |

Permission constants: `PERMISSIONS.ORGANIZATION_VIEW = "organization:view"`,
`PERMISSIONS.ORGANIZATION_UPDATE = "organization:update"`
(`Backend/src/lib/permissions.ts:9-10`). Gate the UI on those exact strings.

### A0. Two response mappers — memorise these, nothing else is returned

`publicOrganization` (`organization.controller.ts:21-31`):

```ts
{
  id: string,            // organization.id — never _id
  name: string,
  slug: string,          // read-only, derived from name at creation
  timezone: string,
  phone?: string,        // ABSENT from JSON when unset — not null
  address?: string,      // ABSENT from JSON when unset — not null
  logo?: string,         // ABSENT when unset; a URL derived from an Upload
  status: "active" | "suspended",
  createdAt: string      // Date -> ISO 8601
}
```

`publicCurrency` (`organization.controller.ts:33-38`):

```ts
{
  mainCurrency: string,      // 3-letter uppercase
  exchangeCurrency: string,  // 3-letter uppercase
  exchangeRate: number,
  updatedAt: string          // ISO 8601
}
```

**There is no `id` and no `organizationId` on the currency shape**, and no
`createdAt`. A freshly created organization has never had `phone`, `address` or
`logo` set (`organization.service.ts:126` creates only `name`, `slug`,
`ownerId`, `timezone`), so **those three keys are missing from the JSON, not
`null`.** A settings form must treat "key absent" and "empty string" as the
same empty state.

### A1. `POST /organizations` — session + verified email

Body `createOrganizationSchema` (`organization.validation.ts:57-68`):

| field | type | required | rules |
|---|---|---|---|
| `name` | string | **yes** | trim, 1..120 |
| `mainCurrency` | string | **yes** | trim, **uppercased by zod**, `/^[A-Z]{3}$/` |
| `exchangeCurrency` | string | **yes** | same |
| `exchangeRate` | number | **yes** | `> 0`, finite. **Must be a JSON number, not a string** — proven in §3 |
| `timezone` | string | **yes** | trim, 1..100. **Not checked against IANA** |

No `.default()` on any field. Currency is deliberately *rejected rather than
defaulted* (`organization.validation.ts:59-60`).

**201** `createdResponse` (`organization.controller.ts:64-68`):

```jsonc
{ "success": true, "message": "Your business is ready",
  "data": {
    "organization": { /* publicOrganization */ },
    "currency":     { /* publicCurrency */ },
    "role": { "id": "…", "name": "Owner", "permissions": ["…"] }
  } }
```

Failures: **403 `EMAIL_NOT_VERIFIED`** before anything else if the address is
unconfirmed (`auth.middleware.ts` `requireVerifiedEmail`, `errors.ts:69-75`);
**409 `CONFLICT`** `"You already belong to a business on TradeOs. Each account
can own one business."` (`organization.service.ts:71-72,109,174`); **409** with
`An organization named "X" is already registered. Choose a different business
name.` after three slug-collision retries (`organization.service.ts:179-183`).

### A2. `GET /organizations/current`

No body. **200** `{ message: "Organization fetched", data: publicOrganization }`
(`organization.controller.ts:74`). **404 `NOT_FOUND`** `"Organization Not
found!"` if the row vanished (`organization.service.ts:199`).

### A3. `PATCH /organizations/current`

Body `updateOrganizationSchema` (`organization.validation.ts:20-30`):

| field | type | required | rules |
|---|---|---|---|
| `name` | string | optional | trim, 1..120 |
| `timezone` | string | optional | trim, **min 1, NO max, NO IANA check** |
| `phone` | string | optional | trim, max 40 (**min 0** — `""` is legal and clears it) |
| `address` | string | optional | trim, max 200 (`""` legal) |
| `logoUploadId` | string \| null | optional | 24-hex ObjectId, or `null` to detach |

Plus `.refine(Object.keys(data).length > 0, "Provide at least one field to
update")` — an **empty body is 422**, and so is a body containing *only*
stripped keys (`organization.test.ts:203-230`: `{ currency: "DOLLARS" }` is a
422 via the empty-update path, because `currency` is not a field on this schema
at all).

Absent by design and silently stripped: `slug`, `ownerId`, `status`, `logo`,
`currency`, `mainCurrency`, `exchangeCurrency`, `exchangeRate`
(`organization.validation.ts:4-18`; proven `organization.test.ts:177-201`).

`logoUploadId` names an already-uploaded image (`POST /uploads` with
`purpose: "logo"` — `upload.validation.ts:10`, `upload.model.ts:14`). The
service derives the public `logo` URL from it
(`organization.service.ts:229-251`). Its failures come from
`attachments.service.ts:36-68`:

- **404 `NOT_FOUND` "Upload not found"** — id unknown, or belongs to another tenant.
- **409 `UPLOAD_PURPOSE_MISMATCH`** — the upload's purpose is not `"logo"`.
- **409 `UPLOAD_ATTACHED`** — already attached to a different resource. Re-sending the same id for the same organization is idempotent.

`logoUploadId: null` detaches and deletes the old image from storage after the
transaction commits (`organization.service.ts:231-236,261`).

**200** `{ message: "Organization updated", data: publicOrganization }`.

### A4. `GET /organizations/current/currency`

No body. **200** `{ message: "Currency configuration fetched", data: publicCurrency }`.
**404 `NOT_FOUND` "Currency configuration not found"** only if the tenant is
malformed — the config is created inside the same transaction as the
organization, so its absence is a bug, not an unset state
(`organization.service.ts:265-272`).

### A5. `PATCH /organizations/current/currency`

Body `updateCurrencySchema` (`organization.validation.ts:84-96`):

| field | type | required | rules |
|---|---|---|---|
| `mainCurrency` | string | optional | trim, **uppercased**, `/^[A-Z]{3}$/` |
| `exchangeCurrency` | string | optional | same |
| `exchangeRate` | number | optional | `> 0`, finite, **JSON number** |

Same `.refine` — empty body is 422 (`organization.test.ts:293-320` covers a
non-positive rate and a malformed code, both 422).

`organizationId` is deliberately **absent from the schema** and additionally
stripped at runtime inside `upsertCurrencyConfig`
(`currency-config.actions.ts:49`) because `immutable: true` gives zero
protection on an upsert's insert branch (`currency-config.model.ts:33-42`;
proven both ways `organization.test.ts:366-396,415-477`).

**200** `{ message: "Currency configuration updated", data: publicCurrency }`.

---

## B. Account and security — the fourteen rows

| # | Method | Path | Gate | Route line |
|---|---|---|---|---|
| B1 | PATCH | `/users/me` | session only (**no** `requireMember`) | `user.route.ts:43` |
| B2 | POST | `/auth/change-password` | session only, limiter | `auth.route.ts:152-157` |
| B3 | GET | `/auth/sessions` | session only | `auth.route.ts:145` |
| B4 | DELETE | `/auth/account` | session only, limiter, **body required** | `auth.route.ts:162-167` |
| B5 | POST | `/auth/2fa/setup` | session only, limiter | `auth.route.ts:202-208` |
| B6 | POST | `/auth/2fa/verify` | session only, limiter | `auth.route.ts:209-215` |
| B7 | POST | `/auth/2fa/disable` | session only, limiter | `auth.route.ts:216-222` |
| B8 | POST | `/auth/2fa/challenge` | **public**, limiter | `auth.route.ts:223-228` |
| B9 | POST | `/auth/passkeys/register/options` | session only, limiter | `auth.route.ts:271-277` |
| B10 | POST | `/auth/passkeys/register/verify` | session only, limiter | `auth.route.ts:278-284` |
| B11 | POST | `/auth/passkeys/login/options` | **public**, limiter | `auth.route.ts:285-290` |
| B12 | POST | `/auth/passkeys/login/verify` | **public**, limiter | `auth.route.ts:291-296` |
| B13 | GET | `/auth/passkeys` | session only | `auth.route.ts:297-302` |
| B14 | DELETE | `/auth/passkeys/:id` | session only | `auth.route.ts:303-307` |

**None of the fourteen carries `requireMember`, `requirePermission` or
`requireVerifiedEmail`** — recorded as a deliberate decision at
`auth.route.ts:118-131,171-189,231-247` and `user.route.ts:9-42`, and enforced
by a test: a user with no `Member` row at all still gets a 200 from
`PATCH /users/me` (`user-profile.test.ts:181-195`). **A settings screen must
therefore not be gated behind an organization** — it has to render for a
member-less user.

### B1. `PATCH /users/me`

Body `updateProfileSchema` (`user.validation.ts:35-44`):

| field | type | required | rules |
|---|---|---|---|
| `name` | string | optional | trim, 1..120 |
| `image` | string | optional | trim, **max 500, min 0** — `""` clears the avatar |

`.refine(...)` — empty body 422; a body of only forbidden keys is 422
(`user-profile.test.ts:238-254`). Stripped: `email`, `emailVerified`, `status`,
`banReason`, `bannedAt`, `platformRole`, `password`, `id`, `_id`, `userId`
(`user.validation.ts:14-33`; proven `user-profile.test.ts:68-92,207-236`).

`image` is a **free string with no URL validation** — unlike the organization
logo, which was deliberately moved to `logoUploadId` for exactly this reason
(`organization.validation.ts:15-18`). There is **no upload-backed avatar
endpoint**; the frontend must supply a URL it trusts.

**200** `{ message: "Profile updated", data: publicUser }` where `publicUser`
(`user.controller.ts:20-26`, mirrored from `auth.controller.ts:19-25`):

```ts
{ id: string, name: string, email: string, emailVerified: boolean, image?: string }
```

Exactly five keys, asserted key-for-key at `user-profile.test.ts:151-157`.

**There is no `GET /users/me`.** The read is `GET /auth/me`
(`user.route.ts:36-41`), which returns `{ user, organization|null, role|null,
permissions, twoFactorEnabled }` (`auth.controller.ts:94-107`).
`twoFactorEnabled` on that response is the **only** way to know whether 2FA is
on — there is no `GET /auth/2fa/status`.

**404 `NOT_FOUND` "User not found"** only if the row vanished mid-request
(`user.service.ts:28`).

### B2. `POST /auth/change-password`

Body `changePasswordSchema` (`auth.validation.ts:74-77`):

| field | type | required | rules |
|---|---|---|---|
| `currentPassword` | string | **yes** | min 1 only — deliberately *not* today's policy (`auth.validation.ts:70-73`) |
| `newPassword` | string | **yes** | **8..128** (`auth.validation.ts:3-6`) |

**200** `{ message: "Your password has been changed", data: { revokedSessions: number } }`
(`auth.controller.ts:190`). **The caller's own cookie is deliberately left
alive** (`auth.controller.ts:188-189`) — do not sign the user out client-side.
Every *other* session is revoked (`auth.service.ts:688`), and
`revokedSessions` is that count.

Failures:
- **401 `UNAUTHORIZED` "Email or password is incorrect"** — wrong current password. Byte-identical to what `login` answers, asserted at `account.test.ts:258-288`.
- **400 `BAD_REQUEST` "Your new password must be different from your current one"** (`auth.service.ts:676-678`; `account.test.ts:339-352`).
- **422** — `newPassword` shorter than 8, or either field missing (`account.test.ts:354-372`).
- **429** after 10 attempts / 15 min per IP.

### B3. `GET /auth/sessions`

No body. **200**:

```jsonc
{ "success": true, "message": "Your active sessions",
  "data": { "sessions": [
    { "id": "…", "ipAddress": "203.0.113.4" | null, "userAgent": "Mozilla/5.0 …" | null,
      "createdAt": "2026-09-10T…Z", "expiresAt": "2026-10-10T…Z", "isCurrent": true }
  ] } }
```

`PublicSession` (`session.service.ts:115-123`), built key by key
(`session.service.ts:141-148`). **Six keys exactly** — asserted sorted at
`account.test.ts:128-137`. Sorted **newest first** by `createdAt`
(`session.actions.ts:70`). `tokenHash` is never emitted, and the test even
refuses anything 32-hex-shaped in the whole body (`account.test.ts:107-140`).

See §5 for what this endpoint **cannot** do.

### B4. `DELETE /auth/account`

**A DELETE with a JSON body** (`auth.route.ts:159-167`). Body
`deleteAccountSchema` (`auth.validation.ts:83-85`):

| field | type | required | rules |
|---|---|---|---|
| `currentPassword` | string | **yes** | min 1 |

There is **no** `confirm: true`, no typed-organization-name field, and no
`reason`. Omitting the body is a **422** (`account.test.ts:486-497`).

**200** `{ message: "Your account has been deleted" }`, **no `data`**. The
cookie is cleared server-side (`auth.controller.ts:203`).

See §6 for the semantics.

### B5–B8. Two-factor — schemas

`POST /auth/2fa/setup` — **no body** (`noBodySchema`). Response **200**:

```jsonc
{ "message": "Scan this with your authenticator app, then confirm a code to switch it on",
  "data": { "otpauthUri": "otpauth://totp/TradeOs:you@example.com?secret=…&issuer=TradeOs",
            "secret": "JBSWY3DPEHPK3PXP" } }
```

(`two-factor.controller.ts:32-42`.) **No QR image** — the URI is returned
deliberately so the client renders the QR itself (`lib/totp.ts:34-45`). The
frontend needs its own QR library. `secret` is the manual-entry fallback.
**409 `CONFLICT`** `"Two-factor authentication is already enabled on this
account"` if 2FA is already on (`two-factor.service.ts:61,92`).

`POST /auth/2fa/verify` — `twoFactorVerifySchema` (`two-factor.validation.ts:27-29`):

| field | type | required | rules |
|---|---|---|---|
| `code` | string | **yes** | trim, **`/^\d{6}$/` exactly** |

A recovery code here is a **422**, not a 401 — see §3. Response **200**:

```jsonc
{ "message": "Two-factor authentication is on. Save these recovery codes now.",
  "data": { "recoveryCodes": ["A2B3C-D4E5F", … 10 of them] } }
```

`POST /auth/2fa/disable` — `twoFactorDisableSchema` (`two-factor.validation.ts:46-49`):

| field | type | required | rules |
|---|---|---|---|
| `currentPassword` | string | **yes** | min 1 |
| `code` | string | **yes** | trim, **1..64** — a TOTP *or* a recovery code |

Response **200** `{ message: "Two-factor authentication is off" }`, **no `data`**.

`POST /auth/2fa/challenge` — **public** — `twoFactorChallengeSchema`
(`two-factor.validation.ts:31-34`):

| field | type | required | rules |
|---|---|---|---|
| `challengeToken` | string | **yes** | min 1, **no max, no trim** |
| `code` | string | **yes** | trim, 1..64 |

Response **200** `{ message: "Signed in", data: { user: publicUser } }` **plus
`Set-Cookie`** (`two-factor.controller.ts:92-95`).

### B9–B14. Passkeys — schemas

`register/options` and `login/options` take **no body** (`noBodySchema`) and
return `{ data: { options: … } }` — the raw
`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`
from `@simplewebauthn/server@13.3.3` (`passkey.controller.ts:35,73`;
`package.json:24`).

`register/verify` — `passkeyRegisterVerifySchema` (`passkey.validation.ts:66-69`):

```ts
{
  label: string,            // REQUIRED. trim, 1..100
  response: {               // .loose() — unknown keys pass through
    id: base64url,          // ^[A-Za-z0-9_-]*$, 1..65536
    rawId: base64url,
    type: "public-key",     // z.literal — anything else is 422
    clientExtensionResults?: Record<string, unknown>,
    authenticatorAttachment?: string | null,   // max 32
    response: {             // .loose()
      clientDataJSON: base64url,
      attestationObject: base64url,
      transports?: string[]                    // each max 32, up to 16
    }
  }
}
```

`login/verify` — `passkeyLoginVerifySchema` (`passkey.validation.ts:73-75`):
same envelope, **no `label`**, and the inner `response` is
`{ clientDataJSON, authenticatorData, signature, userHandle?: base64url | null }`
(`passkey.validation.ts:33-43`).

`GET /auth/passkeys` — **200**
`{ message: "Passkeys retrieved", data: { passkeys: [...] } }` where each entry
is exactly (`passkey.service.ts:424-429`):

```ts
{ id: string, label: string, createdAt: string, lastUsedAt: string | null }
```

Newest first (`passkey.actions.ts:13`). **No `publicKey`, no `credentialId`, no
`transports`, no `counter`** — asserted at `passkeys.test.ts:594-621`.

`DELETE /auth/passkeys/:id` — params `idParamSchema` (24-hex);
**200** `{ message: "Passkey removed" }`, **no `data`**. A malformed id is a
**422 before any query** (`passkeys.test.ts:688-696`). Another user's passkey
is a **404, never a 403** (`passkey.service.ts:443-445`; `passkeys.test.ts:663-687`).

---

## 3. `.default()` audit — the "`.partial()` keeps defaults" defect

This codebase has shipped that defect four times, and the fixes are documented
in place: `announcement.validation.ts:12-15`, `product.validation.ts:26-29`,
`project.validation.ts:9-13`, `product-import.validation.ts:52`. In Zod 4,
`.partial()` wraps a field in `.optional()` but the `.default()` **still fires**
on a missing key, so a `PATCH { name: "x" }` silently also writes the default.

**Every schema in this contract is clean.** Not one of the five validator files
in scope contains a single `.default(...)`:

```
$ grep -rn "\.default(" src/validators/{organization,user,two-factor,passkey,auth}.validation.ts
(no matches)
```

And not one of them uses `.partial()` — all optionality is declared field by
field with explicit `.optional()` (`organization.validation.ts:22-26,86-92`,
`user.validation.ts:37-40`).

### Proof by running the real validators (`bun 1.4.0`)

The actual exported schemas were imported and parsed. Relevant lines of output:

```
updateOrganizationSchema {name:'X'}            => OK {"name":"X"}
updateOrganizationSchema {phone:'  1 '}        => OK {"phone":"1"}
updateOrganizationSchema {}                    => FAIL [["","Provide at least one field to update"]]
updateOrganizationSchema {logoUploadId:null}   => OK {"logoUploadId":null}
updateOrganizationSchema {slug,ownerId,status,logo,currency,timezone}
                                               => OK {"timezone":"Africa/Mogadishu"}
updateCurrencySchema {exchangeRate:600}        => OK {"exchangeRate":600}
updateCurrencySchema {mainCurrency:'  usd '}   => OK {"mainCurrency":"USD"}
updateCurrencySchema {}                        => FAIL [["","Provide at least one field to update"]]
updateCurrencySchema same main/exchange        => OK {"mainCurrency":"USD","exchangeCurrency":"USD"}
updateCurrencySchema {exchangeRate:0}          => FAIL [["exchangeRate","Exchange rate must be greater than zero"]]
updateCurrencySchema {exchangeRate:'600'}      => FAIL [["exchangeRate","Invalid input: expected number, received string"]]
updateCurrencySchema {organizationId:…}        => OK {"exchangeRate":5}
updateProfileSchema {name:'  A  '}             => OK {"name":"A"}
updateProfileSchema {image:''}                 => OK {"image":""}
updateProfileSchema forbidden-only             => FAIL [["","Provide at least one field to update"]]
twoFactorVerifySchema {code:' 123456 '}        => OK {"code":"123456"}
twoFactorVerifySchema recovery code            => FAIL [["code","Enter the 6-digit code from your authenticator app"]]
twoFactorChallengeSchema 65-char code          => FAIL [["code","That is not a valid verification code"]]
twoFactorDisableSchema no password             => FAIL [["currentPassword","Invalid input: expected string, received undefined"]]
changePasswordSchema short new                 => FAIL [["newPassword","Password must be at least 8 characters"]]
noBodySchema undefined                         => OK undefined
noBodySchema {}                                => OK {}
noBodySchema {a:1}                             => FAIL [["","Unrecognized key: \"a\""]]
idParamSchema bad                              => FAIL [["id","Invalid id"]]
passkeyRegisterVerifySchema no label           => FAIL [["label","Invalid input: expected string, received undefined"]]
passkeyRegisterVerifySchema base64 with '='    => FAIL [["response.response.clientDataJSON","Expected base64url-encoded data"]]
passkeyLoginVerifySchema userHandle null       => OK  (null accepted)
passkeyLoginVerifySchema wrong type literal    => FAIL [["response.type","Invalid input: expected \"public-key\""]]
```

**Answer: no PATCH schema in this contract has the defect.** A one-field PATCH
parses to exactly that one field — the output object never grows a key. Every
untouched field is genuinely untouched by the write
(`updateOrganization`/`updateUserProfile` pass the parsed object straight to
`findByIdAndUpdate`, `organization.actions.ts:17-24`, `user.actions.ts:37-40`).

Six things the same run also proves, which matter more for the frontend than
the defect does:

1. **Currency codes are uppercased by zod** — send `"usd"`, get `"USD"` back.
2. **`exchangeRate` must be a JSON number.** `"600"` is a 422. An `<input type="number">` bound naively to a string will fail.
3. **A recovery code is a 422 on `/2fa/verify`**, because that schema is `\d{6}` only. It is only a 401 on `/2fa/challenge` and `/2fa/disable`, whose `code` field is the loose 1..64 rule.
4. **A 65-character code is a 422**, not a 401.
5. **base64url only** — a `+`, `/` or `=` anywhere in a passkey payload is a 422 (`passkey.validation.ts:20`). Standard base64 will not do.
6. **`{}` on a `noBodySchema` route is fine; `{ anything: 1 }` is a 422.**

---

## 4. The 2FA flow, end to end

### Enabling it (signed in)

1. `POST /auth/2fa/setup` (no body) -> `{ otpauthUri, secret }`.
   A fresh base32 secret (20 random bytes, `lib/totp.ts:32`) is stored with
   **`enabled: false`** (`two-factor.actions.ts:34-39`). **This does not turn 2FA
   on.** Calling it again replaces the pending secret and the old one stops
   working (`two-factor-setup.test.ts:110-131`). Calling it while 2FA is
   already on is a **409**.
   The URI is `otpauth://totp/TradeOs:<email>?secret=…&issuer=TradeOs`
   (`lib/totp.ts:16,44-45`). **Render the QR client-side from this string.**

2. `POST /auth/2fa/verify` `{ code: "123456" }` -> `{ recoveryCodes: [10 strings] }`.
   Only a working TOTP flips `enabled: true` and stamps `enabledAt`
   (`two-factor.service.ts:110-141`). **Recovery codes are generated here, not
   at setup, and are returned exactly once** — they are stored as argon2id
   hashes (`two-factor.service.ts:127-132`; `two-factor-setup.test.ts:163-192`).
   There is **no endpoint to view or regenerate them, ever.** The UI must force
   the user to save them at this moment or they are gone.
   Shape: ten codes, `AAAAA-BBBBB`, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
   (no I/1/O/0/L) (`lib/totp.ts:86-101,134-135`).

TOTP acceptance window is ±30 s around the current 30-second step, i.e. a code
is usable for up to 90 s (`lib/totp.ts:29,54-77`).

### Signing in with it — how `/login/2fa` and `challengeToken` connect

`POST /auth/login` returns **one of two different shapes at the same 200**
(`auth.controller.ts:53-75`):

```jsonc
// 2FA off
{ "message": "Signed in",
  "data": { "twoFactorRequired": false, "user": { …publicUser } } }   // + Set-Cookie

// 2FA on
{ "message": "Enter the code from your authenticator app",
  "data": { "twoFactorRequired": true,
            "challengeToken": "<64 hex>",
            "expiresAt": "2026-09-10T…Z" } }                          // NO Set-Cookie, NO user
```

Branch on `data.twoFactorRequired`, never on the message. On the 2FA branch
there is **no `user` object at all** — the login screen cannot show a name or
avatar on `/login/2fa`, and `expiresAt` is the countdown to render.

3. `POST /auth/2fa/challenge` `{ challengeToken, code }` — **public, no cookie
   needed** — is the only place a 2FA-protected account gets a session
   (`two-factor.service.ts:244-290`). **200** `{ user }` + `Set-Cookie`.

The `challengeToken` in `sessionStorage` is exactly right in kind: it is not a
session, `requireAuth` refuses it as a cookie
(`two-factor-login.test.ts:114-128`), only its SHA-256 hash is stored, and it
**expires after 5 minutes** (`two-factor.service.ts:47`;
`two-factor-login.test.ts:130-147`). Behaviours the screen must encode:

- **A wrong code does NOT burn the token.** The user retypes and continues on the *same* `challengeToken` (`two-factor.service.ts:276-280`; proven `two-factor-login.test.ts:208-233`). Do **not** bounce back to `/login` on a 401.
- **A correct code burns it, once.** A replay is a 401 (`two-factor-login.test.ts:235-257`).
- **A recovery code is accepted here** in place of the TOTP, and it is single-use — the same string on a second challenge is a 401 (`two-factor-login.test.ts:379-413`). 2FA stays **on** after a recovery-code sign-in (`two-factor-login.test.ts:359-377`).
- **Every code failure is `401` with one message**, `"That verification code is not valid"` (`two-factor.service.ts:51`). Expired/unknown/spent token is `401` `"This sign-in request is invalid or has expired. Please sign in again."` (`two-factor.service.ts:55`). **These two are indistinguishable by status** — branch on the message, or better, on `expiresAt` having passed locally, to decide "retry here" vs "start over".
- **A ban applied between the steps still bites: 403**, message = the ban reason (`two-factor.service.ts:270-273`; `two-factor-login.test.ts:297-317`).
- **429 after 10 attempts / 15 min per IP** (`two-factor-login.test.ts:319-342`). Render the `Retry-After` value.

### Disabling it

`POST /auth/2fa/disable` `{ currentPassword, code }`. **Both** are required —
a session cookie alone is deliberately not enough (`two-factor.service.ts:188-213`;
BREAK TEST at `two-factor-setup.test.ts:249-278`). The `code` may be a TOTP or a
recovery code (`two-factor-setup.test.ts:324-340`). Success deletes the whole
record and every outstanding challenge (`two-factor.service.ts:209-212`).
Wrong password → **401 "Email or password is incorrect"**; wrong code →
**401 "That verification code is not valid"**; 2FA not on → **400 "Two-factor
authentication is not enabled on this account"**.

### What 2FA does **not** do

- No `GET /auth/2fa/status` — read `twoFactorEnabled` from `GET /auth/me`.
- No recovery-code regeneration, and no "how many are left" endpoint. `ITwoFactor.recoveryCodes[].usedAt` exists in the database (`two-factor.model.ts:11-15`) but **is never serialised anywhere**. A "3 of 10 codes remaining" panel is not implementable.
- No SMS/email second factor. TOTP and recovery codes only.
- Passkey sign-in **bypasses 2FA entirely, on purpose** (`passkey.service.ts:320-327`; test at `passkeys.test.ts:541-591`).

---

## 5. The passkey flow, end to end

Library: `@simplewebauthn/server@13.3.3` (`package.json:24`,
`passkey.service.ts:2-14`). Relying-party config is derived from
`FRONTEND_URL`: `rpID = url.hostname` (bare domain, no scheme/port),
`origin = url.origin`, `rpName = "TradeOs"` (`config/index.ts:89-114,147`).
**The passkey origin is the frontend's, not the API's** — and in production it
must be https or boot fails (`config/index.ts:100-104`).

### Yes, this is implementable with the standard browser WebAuthn API.

The server hands back and consumes the JSON forms the browser speaks, so
`@simplewebauthn/browser`'s `startRegistration({ optionsJSON })` /
`startAuthentication({ optionsJSON })` are a drop-in — pass `data.options`
through untouched and post the returned object as `response`. Plain
`navigator.credentials.create/get` also works, but you must base64url-encode
the ArrayBuffers yourself; **standard base64 with `+ / =` is a 422** (§3).

### Registration (2 calls, signed in)

1. `POST /auth/passkeys/register/options` (no body) -> **200**
   `{ message: "Complete this in your browser to add a passkey", data: { options } }`.
   `options` is `PublicKeyCredentialCreationOptionsJSON`:
   `{ rp: { name: "TradeOs", id: <hostname> }, user: { id, name: <email>, displayName },
   challenge, pubKeyCredParams: [-8, -7, -257], timeout: 60000, attestation: "none",
   excludeCredentials: [...], authenticatorSelection: { residentKey: "preferred",
   userVerification: "preferred" } }` (`passkey.service.ts:184-209`; library
   defaults at `node_modules/@simplewebauthn/server/esm/registration/generateRegistrationOptions.js:48,69`).
   `user.id` is the **Mongo id**, not the email (`passkey.service.ts:187`).
   `excludeCredentials` lists what the account already holds, so re-registering
   the same authenticator is refused by the *browser*, not by the server.
   **409 `CONFLICT`** at 20 passkeys: `"You can register up to 20 passkeys.
   Remove one before adding another."` (`passkey.service.ts:55,176-180`).

2. Browser: `navigator.credentials.create({ publicKey: options })`.

3. `POST /auth/passkeys/register/verify` `{ label, response }` -> **201**
   `{ message: "Passkey added", data: { passkey: { id, label, createdAt, lastUsedAt } } }`
   (`passkey.controller.ts:53-60`). `lastUsedAt` is `null` on a fresh one
   (`passkey.model.ts:53`).
   **`label` is required and the server never invents one** — collect it in the
   UI *before* or *after* the browser ceremony, but you cannot skip it.

### Login (2 calls, no session)

4. `POST /auth/passkeys/login/options` (no body) -> **200** `{ data: { options } }`
   = `{ challenge, timeout: 60000, rpId, userVerification: "preferred" }`.
   **`allowCredentials` is absent from the JSON**, deliberately — listing a
   user's credential ids on a public endpoint would be an account-existence
   oracle (`passkey.service.ts:290-298`; asserted `passkeys.test.ts:503-517`).
   This means the flow is **usernameless/discoverable-credential only**: the
   button is "Sign in with a passkey", not "…for this email address". A user
   whose authenticator did not create a discoverable credential
   (`residentKey: "preferred"`, not `"required"`) may find nothing to pick.

5. Browser: `navigator.credentials.get({ publicKey: options })`.

6. `POST /auth/passkeys/login/verify` `{ response }` -> **200**
   `{ message: "Signed in", data: { user: publicUser } }` + `Set-Cookie`
   (`passkey.controller.ts:85-88`). **No `twoFactorRequired` key at all** on
   this response (`passkeys.test.ts:576`) — a client that reads
   `data.twoFactorRequired` here gets `undefined`, which is correctly falsy but
   is not a documented field.

### Management

7. `GET /auth/passkeys` -> `{ passkeys: [{ id, label, createdAt, lastUsedAt }] }`.
8. `DELETE /auth/passkeys/:id` -> `{ message: "Passkey removed" }`, no `data`.

### Failure map the UI must handle

| condition | status | message | source |
|---|---|---|---|
| challenge unknown / expired / already spent / wrong ceremony | **401** | `"This passkey request is invalid or has expired. Please start again."` | `passkey.service.ts:63-64,150-151` |
| registration attestation fails to verify (bad signature, wrong origin, wrong rpID) | **400** | `"That passkey could not be verified. Please try again."` | `passkey.service.ts:261-267`; `passkeys.test.ts:179-211` |
| login assertion fails to verify, or credential id unknown | **401** | same message | `passkey.service.ts:338-342,378-381` |
| signature counter went backwards | **403** | `"This passkey has been used out of order and may have been copied. Remove it and register a new one."` | `passkey.service.ts:66-67,375-377,400-402` |
| banned / suspended account | **403** | ban reason, or `"This account is suspended"` | `passkey.service.ts:348-351` |
| 20-passkey cap | **409** | `"You can register up to 20 passkeys…"` | `passkey.service.ts:176-180` |
| delete someone else's, or a nonexistent id | **404** | `"Passkey not found"` | `passkey.service.ts:445` |
| malformed `:id` | **422** | `"Invalid id"` | `common.validation.ts:6` |

**Registration and login challenges expire after 5 minutes**
(`passkey.service.ts:51`) and are single-use — a registration response replayed
byte-for-byte is a 401 (`passkeys.test.ts:155-176`). Note the asymmetry with
2FA: a **failed** passkey verify still burns the challenge
(`passkey.service.ts:216-227`), so any retry must start from a fresh
`/options` call.

### What passkeys do **not** offer

- **No rename endpoint.** `passkeyRenameSchema` exists at `passkey.validation.ts:77` and **is imported by nothing** — there is no `PATCH /auth/passkeys/:id`. A label is fixed at registration.
- No `transports` or device-type in the list response, so no "security key" vs "this device" icon.
- No conditional-UI / autofill hint from the server; the frontend would drive that itself.

---

## 6. Sessions — what `GET /auth/sessions` can and cannot do

Per session, exactly six fields (`session.service.ts:115-123,141-148`):

| field | type | notes |
|---|---|---|
| `id` | string | the Session `_id` |
| `ipAddress` | `string \| null` | captured at sign-in from `req.ip` (`auth.service.ts:71-74`) |
| `userAgent` | `string \| null` | the **raw UA string**, unparsed |
| `createdAt` | ISO string | when this device signed in |
| `expiresAt` | ISO string | slides forward, written at most once a day (`session.service.ts:68-75`) |
| `isCurrent` | boolean | exactly one row is true (`account.test.ts:81-105`) |

Sorted newest first.

### **There is no per-session revoke endpoint. None.**

Confirmed by exhaustive grep over `src/routes/`: the only session-shaped paths
in the whole API are `GET /auth/sessions`, `POST /auth/logout`,
`POST /auth/logout-all` and `POST /auth/logout-others`. There is **no**
`DELETE /auth/sessions/:id`, and `session.actions.ts` exports only
`deleteSessionById` (used by `/logout` for the *caller's own* session),
`deleteSessionsByUserId` and `deleteOtherSessionsForUser`
(`session.actions.ts:11,30-36,50-57`) — none of them is reachable with a
client-supplied session id.

So **a "Sign out this device" button next to each row is not implementable.**
The three things that are:

- `POST /auth/logout` — ends the caller's own session, clears the cookie.
- `POST /auth/logout-all` — ends every session **including the caller's**, clears the cookie (`auth.controller.ts:83-88`). The user is signed out.
- `POST /auth/logout-others` (no body) — **200** `{ data: { revokedSessions: number } }`, keeps the caller signed in, deliberately does **not** clear the cookie (`auth.controller.ts:165-175`; `account.test.ts:180-206`).

`GET /auth/sessions` returning `id` per row is therefore a field with no
consumer today. The design should render the list as read-only with one
"Sign out all other devices" action, and it is worth telling the backend if a
per-row revoke is wanted — the db action to build it on
(`deleteSessionById`) already exists, it is only unrouted.

Two more gaps: **no device/browser/OS parsing** (raw UA only — the frontend
must parse it, or show it raw) and **no "last active" timestamp**. `expiresAt`
is the closest proxy and it only advances once per day, so it cannot be
rendered as "active 4 minutes ago".

---

## 7. `DELETE /auth/account` — exactly what it does

**Requires:** the current password in the body, and nothing else
(`auth.validation.ts:83-85`). No typed confirmation string, no email
re-verification step. Any "type DELETE to confirm" UI is purely client-side.

**Order of operations** (`auth.service.ts:743-805`):

1. Verify `currentPassword` against the argon2 hash on the separate `Account` model. Wrong → **401 "Email or password is incorrect"**; a missing credentials record still pays for a throwaway hash so it cannot be told apart by timing (`auth.service.ts:745-753`).
2. **`countOrganizationsOwnedBy(userId) > 0` → 409 `CONFLICT`** with:
   `"You own a business on TradeOs, so your account cannot be deleted yet. Transfer ownership to another member first, and then delete your account."` (`auth.service.ts:698-699,760`). Re-checked inside the transaction (`auth.service.ts:769-771`).
3. Otherwise, in one transaction: memberships → `status: "removed"`, `Account` rows deleted, **all** sessions revoked, and the **`User` document hard-deleted** (`auth.service.ts:774-787`).
4. After the transaction: 2FA record + challenges purged, passkeys + challenges purged (`auth.service.ts:796-804`).

**It is a hard delete, not a soft one** (`auth.service.ts:717-723`). The email
is freed and the same person can register again immediately — asserted at
`account.test.ts:446-467`.

**If the caller owns the organization: nothing happens at all.** The 409 is a
hard stop, and the test proves the user, credentials, session and membership
are all still intact afterwards (`account.test.ts:396-414`). Since **there is
no ownership-transfer endpoint anywhere in the API** (grep: no
`POST /organizations/current/transfer`, no `ownerId` writable on any schema),
**an owner can never delete their own account through this API.** The settings
UI must say so plainly rather than showing a button that always 409s. Worse:
`createOrganizationForUser` makes the creator the owner and enforces one
organization per person (`organization.service.ts:71-72,101-195`), so the
typical first user of a tenant is permanently in this state.

On success the response is **200** `{ message: "Your account has been deleted" }`
and the cookie is cleared server-side (`auth.controller.ts:203-206`). A
non-owner member's `Member` row survives as `status: "removed"` so the
organization's history stays readable (`auth.service.ts:723-736`;
`account.test.ts:416-444`).

---

## 8. Currency config — semantics

**`exchangeRate` is units of MAIN per one unit of EXCHANGE.** Confirmed in
three independent places:

- `Backend/src/db/models/currency-config.model.ts:9` — *"How many units of mainCurrency one unit of exchangeCurrency is worth, right now."*
- `Backend/src/lib/money.ts:24-28` — `toMain(amount, rate) = round2(amount * rate)`, with the comment *"`rate` is `CurrencyConfig.exchangeRate`: units of MAIN per one unit of EXCHANGE."*
- `Backend/src/services/debt.service.ts:32-33` and `sale.service.ts:57` — `resolveRate` returns `1` for the main currency and `config.exchangeRate` for the exchange currency, and the caller multiplies.

So with `mainCurrency: "SOS"`, `exchangeCurrency: "USD"`, `exchangeRate: 570.5`
(the test fixture, `tests/helpers/factories.ts:88-90`): **1 USD = 570.5 SOS**.
Label the input `1 <exchangeCurrency> = ___ <mainCurrency>`. Inverting it
misprices every converted amount on the platform.

`fromMain(amountMain, rate) = round2(amountMain / rate)` (`money.ts:30-31`).

### Nothing prevents `mainCurrency === exchangeCurrency`

Proven by running the real validators (§3): `updateCurrencySchema` accepts
`{ mainCurrency: "USD", exchangeCurrency: "USD" }`, and `createOrganizationSchema`
accepts the same on create. There is no `.refine` comparing them
(`organization.validation.ts:57-68,84-96`), no schema-level check
(`currency-config.model.ts:26-58`) and no service-level check
(`organization.service.ts:274-281`).

The consequence is silent and downstream: `resolveRate`
(`debt.service.ts:25-38`, `sale.service.ts:57`) tests `currency ===
config.mainCurrency` **first**, so with both set to `USD` every amount resolves
to `rate: 1` and the configured `exchangeRate` becomes dead data — an
organization that then sets `exchangeRate: 570.5` sees it ignored by every
sale, payment and debt. **The frontend must refuse
`mainCurrency === exchangeCurrency` in its own form validation**; the API will
happily store it.

Also unenforced: **the codes are only shape-checked, never checked against a
real ISO-4217 list** — `/^[A-Z]{3}$/` accepts `"ZZZ"`, `"ABC"`, `"XYZ"`
(`organization.validation.ts:34-39`, mirrored `currency-config.model.ts:15-24`).
Ship a curated dropdown, not a text field.

And a partial `PATCH` cannot be relied on to keep the pair coherent: sending
only `{ mainCurrency: "KES" }` changes the main currency and leaves
`exchangeCurrency` and `exchangeRate` exactly as they were, with no
recalculation of anything already recorded — every historical sale keeps the
rate frozen at write time (`sale.model.ts:24`, `payment.model.ts:14`). The
currency form should submit all three fields together.

---

## 9. Error codes — every domain code reachable from this surface

`code` comes from `AppError.code` and is present on every `AppError`-derived
failure (`errors.ts:1-29`, `error.middleware.ts:95-98`).

| status | `code` | condition | exact constant / message |
|---|---|---|---|
| 400 | `BAD_REQUEST` | new password equals the current one | `"Your new password must be different from your current one"` (`auth.service.ts:677`) |
| 400 | `BAD_REQUEST` | `/2fa/verify` before `/2fa/setup` | `"Start two-factor setup before confirming a code"` (`two-factor.service.ts:115`) |
| 400 | `BAD_REQUEST` | `/2fa/disable` when 2FA is off | `NOT_ENABLED` = `"Two-factor authentication is not enabled on this account"` (`two-factor.service.ts:60,193`) |
| 400 | `BAD_REQUEST` | passkey registration did not verify | `INVALID_ASSERTION` = `"That passkey could not be verified. Please try again."` (`passkey.service.ts:59,264,267`) |
| 401 | `UNAUTHORIZED` | no cookie / expired session | `"Authentication required"` or `"Your session has expired, please sign in again"` (`errors.ts:38-42`, `auth.middleware.ts`) |
| 401 | `UNAUTHORIZED` | wrong password on login / change-password / delete-account / 2fa-disable | `INVALID_CREDENTIALS` = `"Email or password is incorrect"` (`auth.service.ts:168`, `two-factor.service.ts:58`) |
| 401 | `UNAUTHORIZED` | wrong or spent 2FA code | `INVALID_CODE` = `"That verification code is not valid"` (`two-factor.service.ts:51`) |
| 401 | `UNAUTHORIZED` | bad/expired/spent 2FA challenge token | `INVALID_CHALLENGE` = `"This sign-in request is invalid or has expired. Please sign in again."` (`two-factor.service.ts:55`) |
| 401 | `UNAUTHORIZED` | bad/expired/spent passkey challenge | `"This passkey request is invalid or has expired. Please start again."` (`passkey.service.ts:63-64`) |
| 401 | `UNAUTHORIZED` | passkey assertion did not verify / unknown credential | `"That passkey could not be verified. Please try again."` (`passkey.service.ts:59`) |
| 403 | `FORBIDDEN` | missing `organization:view` / `organization:update` | `"You do not have permission to do that"` (`errors.ts:44-56`) |
| 403 | `FORBIDDEN` | caller has no active membership | `"You do not belong to a business yet"` (`auth.middleware.ts`, `requireMember`) |
| 403 | `FORBIDDEN` | organization suspended | `"This business is suspended"` (`auth.middleware.ts`, `requireMember`) |
| 403 | `EMAIL_NOT_VERIFIED` | `POST /organizations` with an unconfirmed address | `"Confirm your email address before doing this…"` (`errors.ts:69-75`) |
| 403 | `FORBIDDEN` | banned / suspended user at login, 2FA challenge or passkey login | ban reason, or `"This account is suspended"` (`auth.service.ts:210-214`, `two-factor.service.ts:270-273`, `passkey.service.ts:348-351`) |
| 403 | `FORBIDDEN` | passkey counter regression | `CLONED_AUTHENTICATOR` = `"This passkey has been used out of order and may have been copied. Remove it and register a new one."` (`passkey.service.ts:66-67`) |
| 404 | `NOT_FOUND` | organization / currency config / user / passkey / upload missing | `"<Resource> not found"`, except `"Organization Not found!"` (`errors.ts:77-88`, `organization.service.ts:199`) |
| 409 | `CONFLICT` | already owns a business | `"You already belong to a business on TradeOs. Each account can own one business."` (`organization.service.ts:71-72`) |
| 409 | `CONFLICT` | business-name/slug collision after retries | `` `An organization named "X" is already registered. Choose a different business name.` `` (`organization.service.ts:180-182`) |
| 409 | `CONFLICT` | deleting an owner's account | `OWNS_ORGANIZATION` = `"You own a business on TradeOs, so your account cannot be deleted yet. Transfer ownership to another member first, and then delete your account."` (`auth.service.ts:698-699`) |
| 409 | `CONFLICT` | 2FA already on (`/setup` or `/verify`) | `ALREADY_ENABLED` = `"Two-factor authentication is already enabled on this account"` (`two-factor.service.ts:61`) |
| 409 | `CONFLICT` | 20-passkey cap | `"You can register up to 20 passkeys. Remove one before adding another."` (`passkey.service.ts:177-179`) |
| 409 | `UPLOAD_PURPOSE_MISMATCH` | `logoUploadId` points at a non-`logo` upload | `"Upload purpose does not match this resource"` (`attachments.service.ts:53`) |
| 409 | `UPLOAD_ATTACHED` | `logoUploadId` already attached elsewhere | `"Upload is already attached to another resource"` (`attachments.service.ts:56`) |
| 422 | `VALIDATION_ERROR` | any zod failure | `"Validation failed"` + `errors: { "<dotted.path>": "<message>" }` (`errors.ts:100-119`, `error.middleware.ts:9-16`) |
| 429 | `TOO_MANY_REQUESTS` | limiter exhausted | `` `Too many attempts. Try again in N seconds.` `` + `Retry-After` header (`rate-limit.middleware.ts:161-167`) |
| 500 | `CREDENTIALS_MISSING` | password write returned nothing | `"This account cannot change its password"` (`auth.service.ts:684`) |
| 500 | `SEED_MISSING` | Owner role not seeded | `"Owner role is not seeded — the server did not start correctly"` (`organization.service.ts:113-118`) |

Field-error keys on a 422 are dotted paths from the schema root — e.g.
`"response.response.clientDataJSON"` on a passkey payload (§3). When both
`params` and `body` fail on the same key, the second is namespaced
`body.<key>` / `params.<key>` (`validate.middleware.ts:20-28`).

---

## 10. What the tests prove that source alone does not

- **Step one of a 2FA login writes no `Set-Cookie` header at all** — asserted by capturing raw headers and replaying them with a bare `fetch`, outside the client's cookie jar, plus a `Session.countDocuments === 0` (`two-factor-login.test.ts:71-112`). Reading `loginHandler` only shows an early `return`; the test shows nothing leaks past it.
- **A wrong 2FA code does not consume the challenge; a correct one does.** Both directions asserted (`two-factor-login.test.ts:208-257`). This is the single behaviour a `/login/2fa` screen most needs and it is invisible from the route file.
- **A recovery code is single-use and account-scoped**, and a replay does not spend a second one (`two-factor-login.test.ts:379-413,444-461`).
- **`change-password` answers a wrong password byte-identically to `login`** — the test compares the two response bodies directly (`account.test.ts:258-288`). You cannot use the message to tell the flows apart.
- **`logout-others` leaves the caller's own cookie working**, proven by replaying a captured header for the other device (401) and a live `/auth/me` for the caller (200) (`account.test.ts:180-206`).
- **`DELETE /auth/account` on an owner changes literally nothing** — user, `Account`, `Session` and `Member.status: "active"` all re-asserted after the 409 (`account.test.ts:396-414`).
- **The deleted email is immediately re-registerable** (`account.test.ts:446-467`) — so a "your data is retained for 30 days" message would be false.
- **`PATCH /users/me` strips rather than rejects**, and the response is exactly five keys (`user-profile.test.ts:151-157,207-236`).
- **`PATCH /users/me` works for a user with no `Member` row** (`user-profile.test.ts:181-195`) — the proof that settings must render without an organization.
- **`PATCH /users/{someone else's id}` is a plain 404**, because no such route exists (`user-profile.test.ts:95-112`).
- **`organization:view` really guards the GET routes** — provable only with a purpose-built zero-permission role, because every preset role includes `organization:view` (`organization.test.ts:37-80,131-142,401-412`).
- **A platform passkey whose counter stays at 0 forever is not treated as a clone** (`passkeys.test.ts:443-460`) — i.e. Touch ID / Windows Hello / iCloud Keychain work.
- **A passkey sign-in on a 2FA-enabled account returns a full session with no `twoFactorRequired` key**, while the password door still demands the code (`passkeys.test.ts:541-591`).
- **The passkey list contains no `publicKey` or `credentialId`**, checked by scanning the serialized body (`passkeys.test.ts:594-621`).
- **`GET /auth/sessions` contains nothing 32-hex-shaped**, so no truncated token hash slips through (`account.test.ts:107-140`).

---

## 11. Traps a frontend developer would get wrong by guessing

1. **`POST /auth/login` returns two different 200 shapes.** On the 2FA branch there is no `user`, no cookie, and the fields are `{ twoFactorRequired, challengeToken, expiresAt }`. Branch on `data.twoFactorRequired`, never on the message text or on the presence of a cookie.
2. **A wrong code at `/2fa/challenge` does not invalidate `challengeToken`.** Keep the user on `/login/2fa` and let them retype; sending them back to `/login` throws away a still-valid 5-minute token. But a *correct* code burns it, so a double-submit is a 401 — disable the button on the first success.
3. **Recovery codes are shown exactly once, at `/2fa/verify`, and there is no way to see or regenerate them.** No count-remaining endpoint either. The enable flow must force an explicit "I have saved these" step.
4. **`/2fa/verify` accepts only `\d{6}`; a recovery code there is a 422.** The loose 1..64 rule applies only to `/2fa/challenge` and `/2fa/disable`. One shared "enter your code" component with one validation rule will produce the wrong error on one of the three screens.
5. **There is no per-session revoke.** `GET /auth/sessions` returns an `id` per row that nothing consumes. Design for a read-only list plus one "sign out other devices" button, or ask the backend for `DELETE /auth/sessions/:id`.
6. **`POST /auth/change-password` and `POST /auth/logout-others` deliberately keep the caller signed in** — no cookie is cleared. Do not redirect to `/login` on success; show `data.revokedSessions` instead. `POST /auth/logout-all` *does* end the caller's session.
7. **`DELETE` carries a JSON body.** `fetch("/auth/account", { method: "DELETE" })` with no body is a 422, not a 401 or a 400. Whatever HTTP helper the app uses must be able to send a body on DELETE.
8. **An organization owner can never delete their own account, and there is no transfer endpoint.** The button 409s forever. Detect ownership up front (the caller's role from `GET /auth/me`, or an owner-only 409 probe) and explain rather than offering the action.
9. **`exchangeRate` is MAIN per one EXCHANGE.** `1 USD = 570.5 SOS` for the standard fixture. Inverting the label misprices everything.
10. **Nothing stops `mainCurrency === exchangeCurrency`**, and setting them equal silently makes `exchangeRate` dead data (`resolveRate` matches main first). Validate this client-side. Likewise the codes are only `/^[A-Z]{3}$/` — use a curated ISO-4217 dropdown, and note zod **uppercases** what you send.
11. **`exchangeRate` must be a JSON `number`.** `"600"` is a 422. Coerce before sending.
12. **`phone`, `address` and `logo` are absent from the JSON when unset, not `null`.** A form bound to `data.phone` gets `undefined`. Sending `""` is legal and clears the field (min length is 0 on both).
13. **A PATCH body with only unknown keys is a 422, not a no-op.** `{ currency: "USD" }` on `PATCH /organizations/current` strips to `{}` and fails the "at least one field" refinement (`organization.test.ts:213-230`). Filter unchanged fields client-side, then skip the request entirely if nothing remains.
14. **`timezone` on `PATCH /organizations/current` has no maximum and no IANA validation.** `isValidTimezone` exists at `lib/period.ts:36` and is **called from nowhere**. A garbage string is accepted and stored, and every period-scoped read for that tenant then works from a `TZDate` whose `getTime()` is `NaN` (verified: `new Intl.DateTimeFormat("en-US", { timeZone: "Not/AZone" })` throws `RangeError`; `new TZDate(d, "Not/AZone").getTime()` is `NaN`). Ship a validated IANA picker — the API will not save you.
15. **Any `+`, `/` or `=` in a passkey payload is a 422.** base64url only (`passkey.validation.ts:16-20`). Use `@simplewebauthn/browser`, or encode by hand with care.
16. **`label` is required on `/passkeys/register/verify`** and there is no rename route, so the name is permanent. Collect it deliberately.
17. **Passkey login is usernameless only** — `allowCredentials` is intentionally absent, so an "enter your email, then use your passkey" flow is not supported by this API.
18. **A failed passkey verify burns the challenge** (unlike 2FA). Any retry must call `/options` again.
19. **Both `/passkeys/register/*` routes share one 20-per-15-min bucket.** A user who fumbles the OS prompt a few times can hit 429 on a settings page.
20. **`GET /auth/me` is the only source of `twoFactorEnabled`**, and the only read for the profile — there is no `GET /users/me` and no 2FA status route. Refetch `/auth/me` after `/2fa/verify`, `/2fa/disable` and `PATCH /users/me`.
21. **Validation beats authentication.** A malformed body on a protected route returns 422 while anonymous. An anonymous smoke test with a bad payload will look like broken auth.
22. **429 is reachable on ordinary settings actions**, not just login — `2fa-verify`, `2fa-disable`, `change-password` and `delete-account` all cap at 10 per 15 minutes per IP, which a shared office NAT will hit. Read the `Retry-After` header.

---

## 12. What the design will want that this API cannot do

- **Revoke one session from the list.** No route. (`GET /auth/sessions` returns an `id` that nothing accepts.)
- **Show device / browser / OS per session.** Raw `userAgent` string only, no parsing server-side.
- **Show "last active" per session.** Only `createdAt` and `expiresAt`, and `expiresAt` moves at most once a day.
- **Regenerate or re-display recovery codes**, or show how many remain. `usedAt` is tracked in the database and never serialised.
- **Rename a passkey.** `passkeyRenameSchema` exists and is wired to nothing.
- **Show which passkey is which kind of device.** `transports` is stored and never returned.
- **Delete an account that owns an organization**, or transfer ownership to another member. Both are hard blocks with no endpoint.
- **Delete or suspend an organization.** No route.
- **Change an email address.** Deliberately absent from `updateProfileSchema` — it needs a verification round-trip that does not exist yet (`user.validation.ts:16-22`).
- **Upload an avatar.** `image` is a free-string URL; the upload-backed pattern exists only for the organization logo.
- **See a security/audit log** ("password changed on…", "new sign-in from…"). Nothing is exposed.
- **Enable 2FA for the whole organization, or see which members have it on.** `twoFactorEnabled` is self-only, on `GET /auth/me`.
- **Ask "does this email have a passkey / an account?"** Every options endpoint is deliberately identical for every caller.
