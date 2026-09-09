"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/hooks/use-session";
import { organizationKeys } from "@/features/organization/keys";
import { getCurrencyConfig } from "@/features/organization/services/organization.service";
import type { CurrencyConfig } from "@/features/organization/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * The whole currency configuration, for the screens that take money.
 *
 * `useOrganization` deliberately narrows this to `{ timezone, currency }` —
 * that is everything a formatted amount or a rendered date needs, and it is
 * what every read-only screen imports. The counter and the record-payment
 * dialog need the rest: which second currency the shop accepts at the till,
 * and at what rate. Widening `OrganizationContext` instead would hand an
 * exchange rate to forty screens that must never apply one.
 *
 * It reads the **same** query key as `useOrganization`
 * (`organizationKeys.currency()`), so a screen using both issues one request
 * rather than two and both observe the same value at the same moment.
 */
export interface CurrencyContext {
  /** ISO 4217 code the business keeps its books in. `""` until known. */
  mainCurrency: string;
  /** ISO 4217 code accepted as a second tender. `""` until known. */
  exchangeCurrency: string;
  /**
   * Units of `mainCurrency` per one unit of `exchangeCurrency`, so converting
   * a tender into the books **multiplies** by it — `toMain` in
   * `Backend/src/lib/money.ts` is the authority, and it multiplies. `0` until
   * known, a value `hasExchange` already excludes.
   */
  exchangeRate: number;
  /**
   * Whether to offer a second currency at all.
   *
   * **Not merely "the config has loaded".** Nothing stops a business from
   * setting both codes to the same one: `createOrganizationSchema`
   * (`Backend/src/validators/organization.validation.ts:57-68`) carries no
   * refinement comparing them, and neither does this repo's own
   * `currencyConfigSchema`. A shop that picked USD twice would otherwise be
   * shown a `USD | USD` toggle above a rate line reading `1 USD = 1 USD`.
   *
   * False while loading, and false for a rate that could never price a bill.
   */
  hasExchange: boolean;
  /** True until the answer is known. Render a skeleton, not a value. */
  isLoading: boolean;
}

/** Matches `useOrganization`: a missing code renders as visibly incomplete. */
const LOADING_CODE = "";

export function useCurrencyConfig(): CurrencyContext {
  const session = useSession();
  const organization = session.data?.organization ?? null;

  // Disabled until there is a business, for the reason `useOrganization`
  // gives: `/organizations/current/currency` answers "you do not belong to a
  // business yet" for someone still in onboarding, which is an error on the
  // very screen that fixes it.
  const query = useQuery<CurrencyConfig, ApiError>({
    queryKey: organizationKeys.currency(),
    queryFn: getCurrencyConfig,
    enabled: organization !== null,
    staleTime: 30 * 60_000,
  });

  const config = query.data ?? null;
  // A disabled query stays `isPending` for ever in React Query v5 (status
  // "pending", fetchStatus "idle"), so it only counts once there is an
  // organization to fetch for.
  const isLoading =
    session.isPending || (organization !== null && query.isPending);

  const mainCurrency = config?.mainCurrency ?? LOADING_CODE;
  const exchangeCurrency = config?.exchangeCurrency ?? LOADING_CODE;
  const exchangeRate = config?.exchangeRate ?? 0;

  return {
    mainCurrency,
    exchangeCurrency,
    exchangeRate,
    hasExchange:
      !isLoading &&
      mainCurrency !== LOADING_CODE &&
      exchangeCurrency !== LOADING_CODE &&
      exchangeCurrency !== mainCurrency &&
      Number.isFinite(exchangeRate) &&
      exchangeRate > 0,
    isLoading,
  };
}
