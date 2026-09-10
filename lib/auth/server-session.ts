import { cookies, headers } from "next/headers";
import { cache } from "react";
import { serverEnv } from "@/config/env";
import { ROUTES } from "@/config/routes";
import type { SessionData } from "@/features/auth/services/auth.service";
import { REQUEST_PATH_HEADER } from "@/lib/auth/request-path-header";
import { isSafeInternalPath } from "@/lib/auth/safe-path";

/**
 * The real server-side session check — the one thing in this app that decides
 * whether a protected page may render *before* it renders.
 *
 * `proxy.ts` deliberately does not do this. It checks that a cookie exists and
 * nothing more, because the Next docs say Proxy "should not be used as a full
 * session management or authorization solution", and because a fetch on every
 * matched request — every page navigation — is the wrong place to pay for one.
 * That left `document.cookie = "tradeos_session=anything"` walking straight
 * into the app shell: the shell rendered, the API 401'd, and only then did a
 * client component bounce them. This module closes that — the `(app)` layout
 * awaits it, and never renders the shell for a session the API has not
 * vouched for.
 *
 * Deliberately NOT `lib/api/client.ts`. That is one axios instance built for
 * the browser: `withCredentials` (there is no ambient cookie jar here),
 * `baseURL: "/api/v1"` (relative to nothing on the server), a 401 interceptor
 * that calls `window.location.assign`, and a shared React Query cache it
 * clears — every one of those is either meaningless or actively wrong in a
 * Server Component, and the cache is process-wide, which on the server means
 * shared between users. This talks to the Express origin directly with `fetch`
 * and unwraps the one envelope it needs.
 */

/**
 * The path this request is for, as `pathname + search`.
 *
 * Falls back to `/overview` rather than to `/`: the value is used for the
 * permission lookup and for `next=`, and `/` would silently resolve to "no
 * permission required" — the wrong direction to fail in. `/overview` is the
 * one page every member may open, so a missing header costs a redirect to a
 * page they are allowed rather than a gate that opens.
 */
export async function readRequestPath(): Promise<string> {
  const headerList = await headers();
  const value = headerList.get(REQUEST_PATH_HEADER);
  return value && isSafeInternalPath(value) ? value : ROUTES.overview;
}

/** `/sales?page=2` -> `/sales`. `ROUTE_PERMISSIONS` is keyed by path alone. */
export const pathnameOf = (path: string): string => path.split("?")[0] ?? "/";

/** Where an unauthenticated caller goes, carrying where they were aiming. */
export const loginRedirectTarget = (path: string): string =>
  `${ROUTES.login}?next=${encodeURIComponent(path)}`;

/** The envelope `Backend/src/util/responses.ts` wraps every body in. */
interface Envelope {
  success?: unknown;
  data?: unknown;
}

/**
 * A body is only a session if it carries the fields the gate reads. A 200 that
 * is not shaped like one — an HTML error page from a proxy, a rewritten login
 * screen, a backend mid-deploy — is not a licence to render the shell.
 */
function toSessionData(body: unknown): SessionData | null {
  if (typeof body !== "object" || body === null) return null;
  const envelope = body as Envelope;
  if (envelope.success !== true) return null;

  const data = envelope.data;
  if (typeof data !== "object" || data === null) return null;

  const candidate = data as Partial<SessionData>;
  if (typeof candidate.user?.id !== "string") return null;
  if (!Array.isArray(candidate.permissions)) return null;
  // `organization` and `role` are `null` for a signed-in user with no business
  // yet — a supported state, and the one that sends them to /onboarding.
  if (candidate.organization === undefined) return null;

  return data as SessionData;
}

/**
 * Who the caller is according to the API, or `null` if they are nobody.
 *
 * `null` covers every way this can fail and they are deliberately not
 * distinguished: no cookie, a cookie the API rejects (401/403), a 5xx, a
 * body that is not a session, a connection that never opened, a backend that
 * never answered. **Every one of them fails closed.** A backend that is down
 * must not become a way in — an `if (unreachable) return session` here would
 * turn one bad deploy into an open door, and that is precisely the shape of
 * bug that ships green.
 *
 * The one thing the caller must not do is wrap this in a `try`: it never
 * throws, and `redirect()` — which the caller calls on `null` — throws by
 * design to unwind the tree.
 *
 * **Wrapped in React's `cache()`, which is what makes calling it twice free.**
 * The layout checks, and so does every page (see `require-page-access.ts`),
 * because a layout does not re-run on a client-side navigation — the Next docs
 * are explicit that "layouts preserve state, remain interactive, and do not
 * re-render on navigation", and that the router serves cached layouts "without
 * a server request". Pages are not cached that way, so the per-page call is
 * the one that runs every time. `cache()` scopes the result to a single server
 * request, so a full page load pays for one `/auth/me` and not two, while a
 * later navigation — a fresh request — pays for its own, which is the whole
 * point.
 */
export const readServerSession = cache(
  async (): Promise<SessionData | null> => {
    const cookieStore = await cookies();
    const session = cookieStore.get(serverEnv.sessionCookieName);
    // No cookie at all: nothing to ask the API about, so do not ask it.
    if (!session?.value) return null;

    try {
      const response = await fetch(`${serverEnv.apiOrigin}/api/v1/auth/me`, {
        headers: {
          // Only the session cookie is forwarded. The rest of this browser's
          // jar (theme, analytics, another app on the domain) is none of the
          // API's business and would widen what a compromised backend can see.
          cookie: `${session.name}=${session.value}`,
          accept: "application/json",
        },
        // Per-request, per-user auth. Anything cached here is one user's
        // identity answered to the next one; `no-store` is not an optimisation
        // choice, it is the correctness requirement.
        cache: "no-store",
        // A backend that accepts the connection and then never answers would
        // otherwise hang the render for as long as the platform allows. Failing
        // closed after ten seconds is a redirect to /login; not failing is a
        // page that never paints.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return null;
      return toSessionData(await response.json());
    } catch {
      // Unreachable, aborted, or a body that is not JSON. Fail closed.
      return null;
    }
  },
);
