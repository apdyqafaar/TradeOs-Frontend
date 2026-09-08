import type { CreateOrganizationInput } from "@/features/organization/schemas/organization.schema";
import type {
  CreateOrganizationResult,
  CurrencyConfig,
  Organization,
} from "@/features/organization/types";
import { apiGet, apiPost } from "@/lib/api/client";

/**
 * The three `/organizations` rows in `docs/API-ROUTES.md` that this slice
 * uses. The two PATCH rows belong to the Settings screen and are deliberately
 * absent — an unused service export is a URL that goes stale unnoticed.
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
