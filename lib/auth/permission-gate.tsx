"use client";

import type { ReactNode } from "react";
import { useSession } from "@/features/auth/hooks/use-session";
import { hasEveryPermission, type Permission } from "@/lib/auth/permissions";

interface GateProps {
  /** One permission, or several that must ALL be held. */
  permission: Permission | Permission[];
  children: ReactNode;
}

const toList = (permission: Permission | Permission[]): Permission[] =>
  Array.isArray(permission) ? permission : [permission];

/**
 * Hides a control the caller may not use.
 *
 * Both branches render nothing by default, including while the session is
 * still loading: a button that appears and then vanishes reads as a bug, and
 * one that appears for a Seller ends in a 403 they cannot act on. This is
 * presentation only — the API enforces the same rule and is the thing actually
 * stopping the action.
 */
export function PermissionGate({
  permission,
  fallback = null,
  children,
}: GateProps & { fallback?: ReactNode }): ReactNode {
  const { data } = useSession();
  if (!data) return null;
  return hasEveryPermission(data.permissions, toList(permission))
    ? children
    : fallback;
}

/**
 * Gates a whole page, and says so.
 *
 * Same check, different silence: where `PermissionGate` renders nothing when
 * refused, this renders `fallback` — the calm "You don't have access to this"
 * screen the brief asks for (§8.4). Navigation should never lead here, because
 * the nav items are themselves gated; this is the direct-URL case.
 *
 * `loading` is separate from `fallback` so a page does not flash "no access"
 * for the moment before the session resolves.
 */
export function RequirePermission({
  permission,
  fallback,
  loading = null,
  children,
}: GateProps & { fallback: ReactNode; loading?: ReactNode }): ReactNode {
  const { data, isPending } = useSession();
  if (isPending) return loading;
  if (!data) return fallback;
  return hasEveryPermission(data.permissions, toList(permission))
    ? children
    : fallback;
}
