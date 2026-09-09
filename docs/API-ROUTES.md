# API route map

**All 112 endpoints, extracted from `../Backend/src/routes/v1/*.route.ts` on 2026-09-07 (plus `GET /uploads/:id`, added 2026-09-09) and
verified against the source, not from memory.** This is the contract the frontend codes against.

## Rules

- **Base URL is `/api/v1`**, set in `config/env.ts` and rewritten to the Express origin by
  `next.config.ts`. Services pass the path only: `apiGet("/products")`, never `/api/v1/products`
  and never an absolute URL.
- **Every path below is exactly what the backend mounts.** Before adding a service function, find
  its row here. If the row does not exist, the endpoint does not exist — check with the backend
  rather than inventing a path.
- **"Requires" is the middleware gate**, not a suggestion. `session only` means signed in;
  a `resource:action` value means `requirePermission` — gate the UI on the same string via
  `useCan()`. `public` means no session at all.
- **Never send an organization id.** `requireMember` resolves the tenant from the caller's own
  membership; no endpoint accepts one in a path, body, query or header.
- **Lists are paginated** with `?page=&limit=` (limit max 100) and return `meta`. Use `apiGetList`.
- **Ids on the wire are `id`**, never `_id` — every controller maps through a `publicX` shaper.

## Regenerating this file

It is generated, so it can drift. After any backend route change, re-derive it rather than editing
by hand; the extraction walks each `*.route.ts`, balances the parentheses of every `router.<verb>(…)`
call, and reads `requirePermission(PERMISSIONS.X)` and `requireVerifiedEmail` out of the chain.

## Three gates that bite

1. **`POST /auth/resend-verification` needs a session.** It is the one verification-flow route that
   is not public. A user who opens their verification link on a different device (registered on a
   laptop, opened the email on a phone) has no session there, so an expired-link page **cannot**
   offer a working Resend — it must send them to sign in first.
2. **`POST /organizations` needs a *verified* email**, so onboarding must be blocked, with an
   explanation, until the address is confirmed. Same for `POST /members/invite` and
   `POST /members/:id/resend-invite`.
3. **`GET /uploads` is gated on `uploads:create`**, not a view permission — there is no
   `uploads:view`. A Seller cannot list the image gallery at all.

## Endpoints by owning feature slice

> Two rows are filed under `features/account` but belong to the **sign-in** flow, not settings:
> `POST /auth/2fa/challenge` and `POST /auth/passkeys/login/*`. They are public for that reason.


### features/account

| Method | Path | Requires |
|---|---|---|
| POST | `/auth/2fa/challenge` | public |
| POST | `/auth/2fa/disable` | session only |
| POST | `/auth/2fa/setup` | session only |
| POST | `/auth/2fa/verify` | session only |
| DELETE | `/auth/account` | session only |
| POST | `/auth/change-password` | session only |
| GET | `/auth/passkeys` | session only |
| DELETE | `/auth/passkeys/:id` | session only |
| POST | `/auth/passkeys/login/options` | public |
| POST | `/auth/passkeys/login/verify` | public |
| POST | `/auth/passkeys/register/options` | session only |
| POST | `/auth/passkeys/register/verify` | session only |
| GET | `/auth/sessions` | session only |
| PATCH | `/users/me` | session only |

### features/announcements

| Method | Path | Requires |
|---|---|---|
| GET | `/announcements` | announcements:view |
| POST | `/announcements` | announcements:create |
| DELETE | `/announcements/:id` | announcements:delete |
| GET | `/announcements/:id` | announcements:view |
| PATCH | `/announcements/:id` | announcements:update |

### features/auth

| Method | Path | Requires |
|---|---|---|
| POST | `/auth/accept-invite` | public |
| POST | `/auth/forgot-password` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | session only |
| POST | `/auth/logout-all` | session only |
| POST | `/auth/logout-others` | session only |
| GET | `/auth/me` | session only |
| POST | `/auth/register` | public |
| POST | `/auth/resend-verification` | session only |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |

### features/customers

| Method | Path | Requires |
|---|---|---|
| GET | `/customers` | customers:view |
| POST | `/customers` | customers:create |
| DELETE | `/customers/:id` | customers:delete |
| GET | `/customers/:id` | customers:view |
| PATCH | `/customers/:id` | customers:update |

### features/dashboard

| Method | Path | Requires |
|---|---|---|
| GET | `/dashboard` | organization:view |

### features/debts

| Method | Path | Requires |
|---|---|---|
| GET | `/debts` | debts:view |
| POST | `/debts` | debts:create |
| GET | `/debts/:id` | debts:view |
| GET | `/debts/:id/payments` | debts:view |
| POST | `/debts/:id/payments` | payments:create |
| POST | `/debts/:id/write-off` | debts:write_off |
| POST | `/payments/:id/void` | payments:void |

### features/organization

| Method | Path | Requires |
|---|---|---|
| POST | `/organizations` | session only + verified email |
| GET | `/organizations/current` | organization:view |
| PATCH | `/organizations/current` | organization:update |
| GET | `/organizations/current/currency` | organization:view |
| PATCH | `/organizations/current/currency` | organization:update |

### features/products (categories)

| Method | Path | Requires |
|---|---|---|
| GET | `/categories` | categories:view |
| POST | `/categories` | categories:create |
| DELETE | `/categories/:id` | categories:delete |
| GET | `/categories/:id` | categories:view |
| PATCH | `/categories/:id` | categories:update |

### features/products (import)

| Method | Path | Requires |
|---|---|---|
| GET | `/products/import` | products:create |
| POST | `/products/import` | products:create |
| DELETE | `/products/import/:id` | products:create |
| GET | `/products/import/:id` | products:create |
| PATCH | `/products/import/:id/columns` | products:create |
| POST | `/products/import/:id/commit` | products:create |
| DELETE | `/products/import/:id/rows/:index` | products:create |
| PATCH | `/products/import/:id/rows/:index` | products:create |
| POST | `/products/import/:id/rows/:index/resolve` | products:create |
| GET | `/products/import/template` | products:create |

### features/products

| Method | Path | Requires |
|---|---|---|
| GET | `/products` | products:view |
| POST | `/products` | products:create |
| DELETE | `/products/:id` | products:delete |
| GET | `/products/:id` | products:view |
| PATCH | `/products/:id` | products:update |
| POST | `/products/:id/stock` | products:adjust_stock |
| GET | `/products/:id/stock-movements` | products:view |
| GET | `/products/barcode/:code` | products:view |

### features/projects

| Method | Path | Requires |
|---|---|---|
| GET | `/projects` | projects:view |
| POST | `/projects` | projects:create |
| DELETE | `/projects/:id` | projects:delete |
| GET | `/projects/:id` | projects:view |
| PATCH | `/projects/:id` | projects:update |
| POST | `/projects/:id/publish` | projects:publish |
| POST | `/projects/:id/regenerate-link` | projects:publish |
| POST | `/projects/:id/unpublish` | projects:publish |
| GET | `/projects/:id/updates` | projects:view |
| POST | `/projects/:id/updates` | projects:update |
| DELETE | `/projects/:id/updates/:updateId` | projects:update |
| GET | `/public/projects/:token` | public |

### features/reports

| Method | Path | Requires |
|---|---|---|
| GET | `/reports` | reports:view |
| GET | `/reports/customers/top` | reports:view |
| GET | `/reports/dashboard` | reports:view |
| GET | `/reports/debts/ageing` | reports:view |
| GET | `/reports/debts/summary` | reports:view |
| GET | `/reports/products/dead` | reports:view |
| GET | `/reports/products/stock` | reports:view |
| GET | `/reports/products/top` | reports:view |
| GET | `/reports/sales/payment-mix` | reports:view |
| GET | `/reports/sales/summary` | reports:view |
| GET | `/reports/sales/trend` | reports:view |
| GET | `/reports/staff/sales` | reports:view |

### features/sales

| Method | Path | Requires |
|---|---|---|
| GET | `/sales` | sales:view |
| POST | `/sales` | sales:create |
| GET | `/sales/:id` | sales:view |
| POST | `/sales/:id/void` | sales:void |

### features/team

| Method | Path | Requires |
|---|---|---|
| GET | `/members` | members:view |
| DELETE | `/members/:id` | members:remove |
| PATCH | `/members/:id` | members:update |
| POST | `/members/:id/resend-invite` | members:invite + verified email |
| POST | `/members/invite` | members:invite + verified email |
| GET | `/roles` | roles:view |
| POST | `/roles` | roles:create |
| DELETE | `/roles/:id` | roles:delete |
| PATCH | `/roles/:id` | roles:update |

### features/uploads

| Method | Path | Requires |
|---|---|---|
| GET | `/uploads` | uploads:create |
| GET | `/uploads/:id` | uploads:create |
| POST | `/uploads` | uploads:create |
| DELETE | `/uploads/:id` | uploads:create |
