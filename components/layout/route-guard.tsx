"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { RequirePermission } from "@/lib/auth/permission-gate";
import { resolveRoutePermission } from "@/lib/auth/route-permissions";

/**
 * The per-page permission check that `proxy.ts` cannot make.
 *
 * The proxy sees a cookie and nothing more — it never fetches and never
 * decodes the token, because the Next docs say plainly that Proxy is not a
 * session or authorization solution. So it cannot know which permissions this
 * person holds. That lives in `GET /auth/me`, which is a query, which means a
 * client component: this one.
 *
 * **The shell stays.** Someone here is a real member of a real business who
 * opened a page they lack one permission for — typically by typing a URL,
 * since the nav hides what they cannot use. Replacing the whole frame would
 * strand them with no way to reach a page they *are* allowed. Only the content
 * region becomes a refusal.
 *
 * Whether they may see a dashboard at all is `AppGate`'s question, one level
 * up: it owns the no-session and no-business cases, and nothing here mounts
 * until it has answered.
 *
 * This is a UX layer, not a security boundary. The API's 403 is the
 * enforcement; this exists so nobody reaches a screen that can only fail.
 *
 * **Not made redundant by the server check, and not to be deleted as a
 * duplicate.** `app/(app)/layout.tsx` now runs the same resolution on the
 * server and refuses the page before it renders — but a layout runs for the
 * request that *entered* the segment, and every navigation after that is a
 * client transition it does not see. Someone who lands on `/overview` and then
 * clicks through to a page they lack the permission for is caught here and
 * nowhere else. Same rule, two moments: server-first, client-continuous.
 */
export function RouteGuard({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();

  // Most paths are ungated and cost nothing here.
  const permission = resolveRoutePermission(pathname);
  if (!permission) return children;

  return (
    <RequirePermission permission={permission} fallback={<ForbiddenScreen />}>
      {children}
    </RequirePermission>
  );
}
