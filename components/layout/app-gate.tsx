"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { ROUTES } from "@/config/routes";
import { useSession } from "@/features/auth/hooks/use-session";

/**
 * The full-viewport holding screen. Deliberately not a skeleton of the shell:
 * a skeleton promises "your dashboard is loading", which is a lie to someone
 * who is about to be sent to onboarding or to the sign-in page. A wordmark and
 * one honest line say what is actually happening.
 */
function Preparing() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-background px-6">
      <span className="font-semibold text-[15px] tracking-[-0.01em]">
        TradeOs
      </span>
      <div className="flex flex-col items-center gap-3">
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        {/* `role="status"` on a live region so a screen reader hears this
            rather than silence; biome's useSemanticElements wants <output>. */}
        <output className="text-muted-foreground text-sm">
          Setting up your workspace…
        </output>
      </div>
    </div>
  );
}

/**
 * Decides whether this person may see the shell at all — as opposed to
 * `RouteGuard`, which decides whether they may see one page within it.
 *
 * The split matters, and it is why this component wraps the sidebar and topbar
 * while `RouteGuard` sits inside `<main>`:
 *
 *   - **No session, or no business yet.** They belong to nothing, so a sidebar
 *     full of business navigation is meaningless. The whole shell is replaced.
 *   - **A member on a page they lack the permission for.** They are legitimate
 *     and took a wrong turn, so the shell stays and only the content becomes a
 *     ForbiddenScreen — a full-page takeover would strand them with no way to
 *     navigate anywhere else. That case is `RouteGuard`'s.
 *
 * Before this existed the shell painted first and redirected after, so a user
 * with no business saw a fully drawn dashboard with a hole where the page
 * should be, then a jump. Everything below only ever mounts once the answer is
 * known.
 *
 * This is a UX layer, not a security boundary. `requireMember` and
 * `requirePermission` on the API are the enforcement; this stops people
 * reaching screens that can only fail.
 *
 * **Not made redundant by the server check, and not to be deleted as a
 * duplicate.** `app/(app)/layout.tsx` now validates the session against
 * `GET /auth/me` before any of this renders, which is what actually protects
 * the page. It answers once, for the request that entered the segment. This
 * answers continuously: a session that expires while someone is sitting on a
 * page, or is revoked from another device, is caught by the query underneath
 * this component and nowhere else — the layout has long since finished. The
 * server seeds this query's cache with the session it already fetched, so the
 * pair costs one `/auth/me`, not two.
 */
export function AppGate({ children }: { children: ReactNode }): ReactNode {
  const { data, isPending } = useSession();
  const router = useRouter();

  const signedOut = !isPending && !data;
  const withoutBusiness = !isPending && !!data && !data.organization;

  // Navigation is a side effect, so it belongs in an effect rather than in the
  // render path: calling `redirect()` while rendering throws to unwind the
  // tree, which fights React's concurrent rendering and makes this component
  // awkward to test. The `Preparing` screen covers the frame or two before the
  // route actually changes, which is exactly what it is for.
  useEffect(() => {
    if (signedOut) router.replace(ROUTES.login);
    else if (withoutBusiness) router.replace(ROUTES.onboarding);
  }, [signedOut, withoutBusiness, router]);

  if (isPending || signedOut || withoutBusiness) return <Preparing />;

  return children;
}
