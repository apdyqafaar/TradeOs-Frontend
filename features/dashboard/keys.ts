/**
 * Dashboard query keys.
 *
 * Not built on `createQueryKeys`, for the same reason `features/auth/keys.ts`
 * is not: `GET /dashboard` is a singleton with no parameters at all — no
 * filters, no pagination, no id — so the generic list/detail shape would only
 * add an empty `list({})` segment to hash. `all` is still a prefix of
 * `overview()`, so `invalidateQueries({ queryKey: dashboardKeys.all })` after a
 * sale or a payment still reaches it.
 */
export const dashboardKeys = {
  /** The prefix. Invalidate this after any write that moves a figure on the Overview. */
  all: ["dashboard"] as const,
  /** `GET /dashboard` — every section the caller is allowed to see. */
  overview: () => ["dashboard", "overview"] as const,
} as const;
