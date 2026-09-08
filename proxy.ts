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

/** Exact matches only: /login/2fa runs *without* a session cookie by design. */
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
  // Must be a literal — matchers are statically analysed at build time.
  // Excludes Next's internals, the rewritten API, anything with a file
  // extension, and /p/:token, which is the public share page and has to stay
  // reachable without a session.
  matcher: [
    "/((?!api/|_next/static|_next/image|p/|favicon.ico|.*\\.[\\w]+$).*)",
  ],
};
