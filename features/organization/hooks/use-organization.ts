"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/hooks/use-session";
import { organizationKeys } from "@/features/organization/keys";
import { getCurrencyConfig } from "@/features/organization/services/organization.service";
import type { CurrencyConfig } from "@/features/organization/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * The two values every formatted amount and every rendered date needs.
 *
 * `formatMoney(amount, currency)` and `formatDate(iso, timezone)` both take
 * their unit as a required argument because neither has a safe default — the
 * amount is in the business's main currency and the day is the business's day,
 * and neither is the browser's. This hook is the one place those two facts are
 * assembled, so no screen has to know where they come from.
 */
export interface OrganizationContext {
  /** IANA zone for `formatDate` / `formatDateTime` / `formatRelative`. */
  timezone: string;
  /** ISO 4217 main currency code for `formatMoney`. */
  currency: string;
  /** True until both facts are known. Render a skeleton, not a value. */
  isLoading: boolean;
}

/**
 * What the two fields are before the answers arrive.
 *
 * `timezone` falls back to `"UTC"` and not to `""`, because the fallback is
 * fed straight into `tz()` and a zone Intl cannot resolve throws a
 * `RangeError` that takes the whole tree down — verified: `format(new Date(),
 * "dd MMM yyyy", { in: tz("") })` throws, `tz("UTC")` does not. UTC is a real
 * zone, so the render survives; it is also obviously not a business's zone, so
 * a value that escapes an `isLoading` guard reads as wrong rather than as
 * plausible.
 *
 * `currency` falls back to `""` and NOT to `"USD"`. `formatMoney(1250, "")`
 * renders `" 1,250.00"` — a number with no unit, which is visibly incomplete.
 * `"USD"` would render `"USD 1,250.00"` over a Kenyan shop's takings and look
 * completely correct, which is the single failure this repo's "no hardcoded
 * currency" rule exists to prevent. A missing label beats a confident lie.
 *
 * Callers are still expected to gate on `isLoading`; these are what makes the
 * one that forgets a cosmetic bug instead of a crash or a mispriced screen.
 */
const LOADING_TIMEZONE = "UTC";
const LOADING_CURRENCY = "";

/**
 * `{ timezone, currency, isLoading }` for the whole app.
 *
 * **Timezone comes from the session**, which every page inside the shell has
 * already fetched (`GET /auth/me` returns `organization.timezone`), so asking
 * for it here costs nothing — React Query hands back the cached entry under
 * `authKeys.session()` rather than issuing a request.
 *
 * **Currency does not, and cannot.** The backend has no `currency` field on an
 * organization at all: its Task 26 moved currency onto a separate
 * `CurrencyConfig` collection reachable only at
 * `GET /organizations/current/currency`, and `publicOrganization` therefore
 * omits it. So one extra request exists, once per session — deduplicated
 * across every component by the shared `organizationKeys.currency()` key, kept
 * fresh for half an hour because the only thing that changes it is the
 * Settings screen, which will invalidate this key when that slice lands.
 *
 * The query is disabled until the session reports a business. A signed-in
 * person who has not finished onboarding has no tenant, so
 * `/organizations/current/currency` would answer "you do not belong to a
 * business yet" — an error on the very screen that fixes it.
 */
export function useOrganization(): OrganizationContext {
  const session = useSession();
  const organization = session.data?.organization ?? null;

  const currency = useQuery<CurrencyConfig, ApiError>({
    queryKey: organizationKeys.currency(),
    queryFn: getCurrencyConfig,
    enabled: organization !== null,
    staleTime: 30 * 60_000,
  });

  return {
    timezone: organization?.timezone ?? LOADING_TIMEZONE,
    currency: currency.data?.mainCurrency ?? LOADING_CURRENCY,
    // A disabled query reports `isPending: true` forever in React Query v5
    // (status "pending", fetchStatus "idle"), so it is only part of the answer
    // once there is an organization to fetch a currency for. Without the
    // guard, every signed-out and mid-onboarding screen would load for ever.
    isLoading:
      session.isPending || (organization !== null && currency.isPending),
  };
}
