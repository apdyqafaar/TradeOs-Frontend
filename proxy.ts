import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { serverEnv } from "@/config/env";
import { REQUEST_PATH_HEADER } from "@/lib/auth/request-path-header";

/**
 * An optimistic cookie-presence gate, plus one piece of plumbing.
 *
 * The Next docs are explicit that Proxy "should not be used as a full session
 * management or authorization solution". So this still never fetches, never
 * decodes the token and never trusts it. **The check that does trust nothing
 * now lives one layer up**: `app/(app)/layout.tsx` awaits `GET /auth/me`
 * before it renders anything, so a forged cookie gets past this gate and is
 * refused there — on the server, before any of the shell exists. What this
 * buys is cheapness: the common signed-out case is turned away without a fetch
 * at all, and the signed-in case never sees the login form.
 *
 * The plumbing is `REQUEST_PATH_HEADER`, set on the way through. A Server
 * Component has no way to read the pathname and the layout needs it, both to
 * resolve the route's permission and to build its own `next=`. See the comment
 * on the `NextResponse.next()` at the bottom of `proxy()`.
 *
 * **It is a deny-list, not an allow-list, and there is no third list.** A path
 * named in neither array below falls through to `NextResponse.next()` in both
 * the signed-in and signed-out states — which is exactly the behaviour every
 * token-driven page needs, so those pages are correct here by being *absent*.
 * Do not add a "public paths" array to make that explicit: it would be dead
 * code that reads like a gate, and the next person would start believing a page
 * has to be listed to be reachable.
 *
 * Paths are literals rather than imports from `config/routes.ts` because that
 * module pulls in the lucide icon set for `NAV_GROUPS`, and the proxy bundle is
 * evaluated on every matched request.
 */
const APP_SHELL_PREFIXES = [
  "/overview",
  "/sales",
  "/products",
  "/customers",
  "/debts",
  "/reports",
  "/announcements",
  "/projects",
  "/team",
  "/settings",
  "/account",
  "/help",
];

/**
 * Signed in, so there is nothing here for you: bounced to /overview.
 *
 * Exact matches only — /login/2fa runs *without* a session cookie by design.
 *
 * **Five paths must never be added to this array**, however much they look like
 * sign-in screens. Each is reached from a link in an email, on whatever device
 * the mailbox is open on, and each has a real signed-in caller:
 *
 * - `/verify-email` — the ordinary case IS signed in: registered on this laptop
 *   a minute ago, clicked the link in the same browser. A bounce to /overview
 *   would swallow the token and leave the address unverified, with nothing on
 *   screen to explain why `POST /organizations` keeps refusing.
 * - `/accept-invite` — a RETURNING INVITEE already has a TradeOs account and is
 *   being invited to a second business, so they arrive signed in.
 *   `Backend/src/services/auth.service.ts:330-397` handles that branch
 *   explicitly. Guest-only here means they can never accept an invitation.
 * - `/forgot-password`, `/reset-password` — someone signed in on a phone and
 *   locked out on a laptop is one person with one account. And the reset
 *   endpoint revokes every session anyway, so "already signed in" says nothing
 *   about whether they belong here.
 * - `/onboarding` — a signed-in user with `organization: null` is precisely who
 *   belongs there, and `components/layout/route-guard.tsx` redirects them there
 *   out of the shell. Guest-only would make that a redirect loop:
 *   /overview -> guard -> /onboarding -> proxy -> /overview.
 *
 * They must equally stay out of APP_SHELL_PREFIXES — every endpoint behind them
 * is `public` in `docs/API-ROUTES.md`, because the token in the URL *is* the
 * credential. /onboarding is the one exception and is still right to be absent:
 * letting an anonymous visitor load the page and take the api client's 401
 * redirect (which carries a `next`) is better than a blind bounce.
 */
const GUEST_ONLY_PATHS = ["/login", "/register"];

function isInsideAppShell(pathname: string): boolean {
  return APP_SHELL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(serverEnv.sessionCookieName);

  if (!hasSession && isInsideAppShell(pathname)) {
    const url = new URL("/login", request.url);
    // Carries the caller back where they were aiming once they sign in.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasSession && GUEST_ONLY_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  // Two jobs on the way through, not one.
  //
  // The path rides upstream on a request header because a Server Component has
  // no way to read the pathname: `app/(app)/layout.tsx` needs it to resolve
  // this route's entry in `ROUTE_PERMISSIONS` and to build the `next=` on its
  // own /login redirect. `NextResponse.next({ request: { headers } })` is the
  // documented shape — `NextResponse.next({ headers })` sends them to the
  // *client* instead, which is a different thing entirely
  // (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`,
  // "Setting Headers").
  //
  // It is `set` on a copy of the incoming headers, unconditionally and on
  // every matched request: a caller may send this header, but their value
  // never survives, so the layout cannot be lied to about which page it is
  // being asked to gate. `REQUEST_PATH_HEADER` is imported from a module that
  // holds nothing but the string, because anything richer — `config/routes.ts`
  // and its lucide icons above all — would land in this bundle.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${search}`);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Must be a literal — matchers are statically analysed at build time and a
  // value built from a variable is ignored without a warning
  // (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`,
  // "Matcher"). Without a matcher at all, Proxy runs on *every* request,
  // `_next/static` and `public/` assets included.
  //
  // This is an exclusion list, not a route allow-list. It names only the paths
  // that must not pay for the proxy at all: Next's internals, the rewritten
  // API, anything with a file extension, and /p/:token, the client-facing
  // project share page, which has to stay reachable without a session.
  // Everything else reaches `proxy()` above, which decides by cookie. So a new
  // public page needs no entry here and none in either array — see the note on
  // GUEST_ONLY_PATHS for the five that would break if they got one.
  matcher: [
    "/((?!api/|_next/static|_next/image|p/|favicon.ico|.*\\.[\\w]+$).*)",
  ],
};
