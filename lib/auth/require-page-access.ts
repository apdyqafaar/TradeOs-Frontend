import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";
import type { SessionData } from "@/features/auth/services/auth.service";
import { hasPermission } from "@/lib/auth/permissions";
import { resolveRoutePermission } from "@/lib/auth/route-permissions";
import {
  loginRedirectTarget,
  pathnameOf,
  readRequestPath,
  readServerSession,
} from "@/lib/auth/server-session";

/**
 * What a protected page learns before it renders anything.
 *
 * `session` is never null: an unauthenticated caller has already been
 * redirected by the time this resolves.
 */
export interface PageAccess {
  session: SessionData;
  /** Whether the caller holds the permission this route is keyed on. */
  permitted: boolean;
}

/**
 * The per-page server-side gate. **Every page under `app/(app)/` awaits this.**
 *
 * The layout awaits the same check, and that is not duplication — the two run
 * at different times and only together cover every request. Next's own docs
 * say it plainly: "layouts preserve state, remain interactive, and **do not
 * re-render on navigation**", and during a client-side navigation the router
 * "serves cached layouts ... **without a server request**". Pages are not
 * cached that way. So:
 *
 * - **Full page load** (typed URL, refresh, first paint) — the layout runs and
 *   so does the page. One `/auth/me` between them, because `readServerSession`
 *   is wrapped in React's `cache()`.
 * - **Client-side navigation** (`/products` → `/debts` in the shell) — the
 *   layout does **not** run. Only the page segment is requested from the
 *   server, so without this call nothing would re-validate the session for the
 *   rest of that browsing session. A session revoked in between — signed out
 *   elsewhere, removed from the business, role changed, banned — would keep
 *   rendering pages on the server until some client query happened to 401.
 *
 * That is the gap this closes, and it is the reason a layout-only gate is not
 * enough however correct it looks.
 *
 * **Redirects, then reports.** No session at all sends the caller to `/login`
 * carrying where they were aiming; a session with no business goes to
 * `/onboarding`. Both are `redirect()`, which throws to unwind the render, so
 * neither may be wrapped in a `try` — and `readServerSession` never throws, so
 * there is nothing to catch anyway.
 *
 * **A missing permission is NOT a redirect**, which is why this returns a flag
 * rather than handling it. The rule this repo settled on is that a member who
 * lacks one permission keeps the shell and sees `ForbiddenScreen` inside it,
 * so they can navigate somewhere they are allowed instead of being bounced to
 * a page with no explanation. A page renders that itself:
 *
 * ```tsx
 * const { permitted } = await requirePageAccess();
 * if (!permitted) return <ForbiddenScreen />;
 * ```
 *
 * Two lines, and explicit at the point it matters. A helper that rendered the
 * refusal itself would have to return JSX from `lib/`, and one that redirected
 * would quietly contradict the rule the client half (`route-guard.tsx`) spends
 * a comment defending.
 */
export async function requirePageAccess(): Promise<PageAccess> {
  const path = await readRequestPath();
  const session = await readServerSession();

  if (!session) redirect(loginRedirectTarget(path));
  if (!session.organization) redirect(ROUTES.onboarding);

  const permission = resolveRoutePermission(pathnameOf(path));

  return {
    session,
    permitted:
      permission === null || hasPermission(session.permissions, permission),
  };
}
