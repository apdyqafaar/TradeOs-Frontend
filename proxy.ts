import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { serverEnv } from "@/config/env";

/**
 * An optimistic cookie-presence gate, and nothing more.
 *
 * The Next docs are explicit that Proxy "should not be used as a full session
 * management or authorization solution". So this never fetches, never decodes
 * the token and never trusts it: a forged cookie buys a redirect into the app
 * shell and an immediate 401 from the API, which the query layer turns back
 * into a trip to /login. What it does buy is that the common signed-out case
 * never renders the shell, and the signed-in case never sees the login form.
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

  return NextResponse.next();
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
