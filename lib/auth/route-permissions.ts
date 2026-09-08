import { resolveActiveHref } from "@/components/layout/nav-utils";
import { ROUTE_PERMISSIONS } from "@/config/routes";
import type { Permission } from "@/lib/auth/permissions";

/** The guarded paths, flattened once at module load rather than per render. */
const GUARDED_PATHS: readonly string[] = Object.keys(ROUTE_PERMISSIONS);

/**
 * The permission `pathname` needs, or null when every member may see it.
 *
 * The matching rule is the sidebar's, and deliberately the same function:
 * longest prefix wins on a `/` boundary, so `/products/import` beats
 * `/products`, `/products/<id>` falls back to `/products`, and
 * `/products-import` — which shares a prefix but not a segment — matches
 * neither. Two matchers that were meant to agree and quietly drifted is how a
 * page ends up lit in the nav while being refused by the guard, so this reuses
 * `resolveActiveHref` rather than re-deriving it. It lives in
 * `components/layout/nav-utils.ts` because the nav was its first caller; if a
 * third caller appears, move the matcher to `lib/` and have all three import
 * it from there.
 *
 * This is the UX layer only. The API's 403 is the enforcement; this exists so
 * a person who types a URL they may not open sees a calm screen instead of a
 * page that can only fail.
 */
export function resolveRoutePermission(pathname: string): Permission | null {
  const match = resolveActiveHref(pathname, GUARDED_PATHS);
  // `match` is one of GUARDED_PATHS or null, so the lookup cannot miss.
  return match === null ? null : ROUTE_PERMISSIONS[match];
}
