/**
 * Auth query keys.
 *
 * Not built on `createQueryKeys`: none of these are a list/detail pair. There
 * is exactly one session, one list of devices and one list of passkeys per
 * signed-in person, so the generic shape would only add empty `list({})`
 * segments to hash.
 */
export const authKeys = {
  /** The prefix. `invalidateQueries({ queryKey: authKeys.all })` refetches all three. */
  all: ["auth"] as const,
  /** `GET /auth/me` — who the caller is, which business, what they may do. */
  session: () => ["auth", "session"] as const,
  /** `GET /auth/sessions` — the "where am I signed in" list. */
  sessions: () => ["auth", "sessions"] as const,
  /** `GET /auth/passkeys` — the security screen's credential list. */
  passkeys: () => ["auth", "passkeys"] as const,
} as const;
