import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";
import { MobileNav } from "@/components/layout/mobile-nav";
import { RouteGuard } from "@/components/layout/route-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ROUTES } from "@/config/routes";
import { authKeys } from "@/features/auth/keys";
import { hasPermission } from "@/lib/auth/permissions";
import { resolveRoutePermission } from "@/lib/auth/route-permissions";
import {
  loginRedirectTarget,
  pathnameOf,
  readRequestPath,
  readServerSession,
} from "@/lib/auth/server-session";
import { getQueryClient } from "@/lib/query/client";

/**
 * The server-side gate for everything inside the app shell.
 *
 * **This is where a protected page is actually protected.** Before this
 * existed the only server-side check was `proxy.ts`, which tests that a cookie
 * is *present* and never validates it — so `document.cookie =
 * "tradeos_session=anything"` got you the rendered shell, and only the client
 * bounced you once the API refused. Now the request does not render until
 * `GET /auth/me` has said who is asking. Every failure mode is a redirect or a
 * refusal, and every unknown fails closed (see `readServerSession`).
 *
 * `/onboarding` is outside this group — it lives in `app/(auth)/` — so the
 * no-organization redirect below cannot loop back through here. It and the
 * other four email-link paths (`/verify-email`, `/accept-invite`,
 * `/forgot-password`, `/reset-password`) are all outside `(app)` and so are
 * never gated by this layout; `proxy.ts` sets out, path by path, what breaks
 * the moment one of them is put behind an auth check. `app/(app)/layout.test.tsx`
 * asserts where each of the five lives rather than trusting this comment.
 *
 * **This layout is not the whole gate, and must not be treated as it.** It
 * runs for the request that entered the segment and then does not run again:
 * Next's docs are explicit that layouts "preserve state, remain interactive,
 * and do not re-render on navigation", and that the router serves cached
 * layouts during a client-side navigation "without a server request". So a
 * layout-only check validates the session once per full page load and never
 * again for the rest of that browsing session. **Every page under this layout
 * therefore awaits `requirePageAccess()` as well** (`lib/auth/require-page-access.ts`),
 * which is the call that runs on every navigation, and a test walks this
 * directory so a page added later cannot quietly skip it. `readServerSession`
 * is wrapped in React's `cache()`, so a full load still pays for exactly one
 * `GET /auth/me` across the two.
 *
 * **The two client guards below are NOT redundant either.** They cover the one
 * thing no server check can: a session that is revoked while someone is
 * sitting on a page they already have, with no navigation to trigger a new
 * request. They run off the same `GET /auth/me` this layout just made — which
 * is why the result is seeded into the React Query cache below rather than
 * fetched again on mount.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const path = await readRequestPath();
  const session = await readServerSession();

  // `redirect()` throws to unwind the render, so it is called here in the
  // straight line of the function and never inside a `try` — `readServerSession`
  // owns the only `catch` in this path and is careful to never rethrow.
  if (!session) redirect(loginRedirectTarget(path));
  // Signed in, but belongs to no business yet. Same destination the client's
  // `AppGate` sends them to; this just gets there without painting a shell for
  // an organization that does not exist.
  if (!session.organization) redirect(ROUTES.onboarding);

  const permission = resolveRoutePermission(pathnameOf(path));
  const allowed =
    permission === null || hasPermission(session.permissions, permission);

  // The session the server already paid for, handed to the client cache so
  // `useSession` starts resolved: no second `/auth/me` on mount, and no flash
  // of `AppGate`'s "Setting up your workspace…" for someone who is plainly
  // signed in. `getQueryClient()` returns a fresh client per server render, so
  // nothing here is shared between concurrent requests.
  const queryClient = getQueryClient();
  queryClient.setQueryData(authKeys.session(), session);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AppGate>
        <div className="flex flex-1">
          <Sidebar />
          <MobileNav />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            {/* 32px of padding and a 24px column gap at `lg`, which reproduces
                the 1200px content region of artboard `1c` exactly at a 1440
                viewport. `max-w-[1280px]` stops an ultrawide screen stretching
                it. */}
            <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 p-4 lg:p-8">
              {/* Refused *inside* the shell, never as a redirect. A member who
                  lacks one permission is a real member who took a wrong turn;
                  a full-page bounce would strand them with no nav to reach a
                  page they are allowed. `route-guard.tsx` argues this at
                  length and is the client-side half of the same rule. */}
              {allowed ? (
                <RouteGuard>{children}</RouteGuard>
              ) : (
                <ForbiddenScreen />
              )}
            </main>
          </div>
        </div>
      </AppGate>
    </HydrationBoundary>
  );
}
