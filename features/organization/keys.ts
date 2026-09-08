import { createQueryKeys } from "@/lib/query/keys";

/**
 * React Query keys for the organization slice.
 *
 * There is no list and no detail here: a caller belongs to exactly one
 * business and every read is `/organizations/current...`, so the generic
 * `list({})` / `detail(id)` pair would only add segments nothing ever
 * invalidates. `createQueryKeys` is still the source of the namespace, so the
 * scope string is written once and `organizationKeys.all` can never collide
 * with another feature's cache.
 */
const keys = createQueryKeys("organizations");

export const organizationKeys = {
  /** Everything this slice caches — the target after creating a business. */
  all: keys.all,

  /** `GET /organizations/current` — the profile the Settings screen edits. */
  current: () => [...keys.all, "current"] as const,

  /**
   * `GET /organizations/current/currency`.
   *
   * Its own key rather than a field of `current()`, because it is its own
   * endpoint with its own PATCH: the settings screen that changes the currency
   * must be able to invalidate the currency without throwing away the profile
   * it did not touch.
   */
  currency: () => [...keys.all, "current", "currency"] as const,
} as const;
