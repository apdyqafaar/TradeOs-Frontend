import type {
  CreateOrganizationInput,
  UpdateCurrencyInput,
  UpdateOrganizationInput,
} from "@/features/organization/schemas/organization.schema";
import type {
  CreateOrganizationResult,
  CurrencyConfig,
  Organization,
} from "@/features/organization/types";
import { apiGet, apiPatch, apiPost } from "@/lib/api/client";

/**
 * All five `/organizations` rows in `docs/API-ROUTES.md`. There are no others:
 * no list, no `GET /organizations/:id`, no delete, and no ownership-transfer
 * route anywhere — `organization.route.ts` mounts exactly these five.
 *
 * No React here: these are called from hooks and from tests, and a `useQuery`
 * import would make the second impossible.
 *
 * **No organization id is ever sent.** `POST /organizations` mints the tenant
 * from the session's user; the other two resolve it from the caller's own
 * active Member row.
 */

/**
 * `POST /organizations` — requires a session **and a verified email**
 * (`requireVerifiedEmail` sits immediately after `requireAuth` on this route,
 * and on no other route in the file). A caller who already belongs to a
 * business gets a 409, not a second one: `Member.userId` carries a unique
 * partial index on active memberships.
 */
export const createOrganization = (
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> =>
  apiPost<CreateOrganizationResult>("/organizations", input);

/** `GET /organizations/current` — `organization:view`. */
export const getCurrentOrganization = (): Promise<Organization> =>
  apiGet<Organization>("/organizations/current");

/**
 * `GET /organizations/current/currency` — `organization:view`, which the
 * Seller preset holds, so every role in the product can read it. That matters:
 * it is the only source of the currency code `formatMoney` needs, and a screen
 * a Seller cannot price is not a screen.
 */
export const getCurrencyConfig = (): Promise<CurrencyConfig> =>
  apiGet<CurrencyConfig>("/organizations/current/currency");

/**
 * `PATCH /organizations/current` — `organization:update`.
 *
 * The response is the **whole** `publicOrganization`, not just the fields that
 * changed, so a caller can seed the cache with it rather than merging.
 *
 * The input type carries all four editable fields because the Settings form
 * always sends all four. Two upstream behaviours make a partial body a trap
 * rather than an optimisation: an **empty** body is a 422 through the
 * "Provide at least one field to update" refinement, and so is a body of only
 * keys the schema strips — `{ currency: "USD" }` is a 422, not a no-op
 * (`organization.test.ts:203-230`).
 */
export const updateOrganization = (
  input: UpdateOrganizationInput,
): Promise<Organization> =>
  apiPatch<Organization>("/organizations/current", input);

/**
 * `PATCH /organizations/current/currency` — `organization:update`.
 *
 * **`exchangeRate` must be a JSON number.** `"600"` is a 422
 * (`docs/contracts/settings-account.md` §3), which is why
 * `updateCurrencySchema` types it as `z.number()` and the form parses before
 * it calls this.
 *
 * **No `organizationId`.** It is absent from the upstream schema *and*
 * stripped again inside `upsertCurrencyConfig`, because `immutable: true`
 * gives no protection on an upsert's insert branch. Sending one is not a
 * silent tenant switch — it is simply ignored — but sending it would still be
 * this repo's clearest sign that something has gone wrong.
 */
export const updateCurrencyConfig = (
  input: UpdateCurrencyInput,
): Promise<CurrencyConfig> =>
  apiPatch<CurrencyConfig>("/organizations/current/currency", input);
