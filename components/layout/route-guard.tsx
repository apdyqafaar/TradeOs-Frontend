"use client";

import { redirect, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ROUTES } from "@/config/routes";
import { useSession } from "@/features/auth/hooks/use-session";
import { RequirePermission } from "@/lib/auth/permission-gate";
import { resolveRoutePermission } from "@/lib/auth/route-permissions";

/**
 * The two checks `proxy.ts` cannot make, applied to every page in the shell.
 *
 * The proxy sees a cookie and nothing more: it never fetches and never decodes
 * the token, because the Next docs say plainly that Proxy is not a session or
 * authorization solution. So it cannot know that this person has no business
 * yet, and it cannot know which permissions they hold. Both facts live in
 * `GET /auth/me`, which is a query, which means a client component — this one.
 *
 * It is a UX layer, not a security boundary. The API's 401/403 is the
 * enforcement; this exists so nobody reaches a screen that can only fail.
 */
export function RouteGuard({ children }: { children: ReactNode }): ReactNode {
  const { data, isPending } = useSession();
  const pathname = usePathname();

  // 1. The session is still resolving. Render nothing rather than flashing a
  //    refusal at someone who turns out to be allowed in — the permissions
  //    are not known yet, so any answer here would be a guess.
  if (isPending) return null;

  // 2. Signed in, but no business yet: a normal state for someone who has
  //    registered and not finished onboarding. `requireMember` would fail on
  //    every endpoint inside the shell, so send them to the one screen that
  //    fixes it instead of to a dashboard that 403s section by section.
  if (data && !data.organization) {
    redirect(ROUTES.onboarding);
  }

  // 3. The permission gate. Most paths are ungated and cost nothing here.
  const permission = resolveRoutePermission(pathname);
  if (!permission) return children;

  return (
    <RequirePermission permission={permission} fallback={<ForbiddenScreen />}>
      {children}
    </RequirePermission>
  );
}
