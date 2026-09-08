"use client";

import { useSession } from "@/features/auth/hooks/use-session";
import { hasEveryPermission, type Permission } from "@/lib/auth/permissions";

/**
 * The caller's granted permissions, straight off `GET /auth/me`.
 *
 * `string[]`, not `Permission[]`: the list is whatever the API sent, which
 * includes the Owner preset's `"*"` and any permission a later backend phase
 * added before this build knew about it. `hasPermission` understands both.
 */
export function usePermissions(): string[] {
  const { data } = useSession();
  return data?.permissions ?? [];
}

/**
 * True only when every one of `required` is held.
 *
 * False while the session is loading, and false when signed out. Defaulting to
 * false is the safe direction for a gate: a moment of a hidden button is a
 * cosmetic flicker, while a moment of a visible one is a click that ends in a
 * 403 the user cannot explain. The API enforces the same rules regardless.
 */
export function useCan(...required: Permission[]): boolean {
  const { data } = useSession();
  if (!data) return false;
  return hasEveryPermission(data.permissions, required);
}
