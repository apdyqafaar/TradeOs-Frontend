/**
 * How `proxy.ts` hands the request's path to a Server Component, which has no
 * way to read the pathname itself.
 *
 * The value is `pathname + search`, so the `next=` on the app layout's login
 * redirect carries the query the caller was aiming at and not just the path.
 * `lib/auth/server-session.ts` reads it; `app/(app)/layout.tsx` resolves the
 * route's permission from it.
 *
 * **A file of its own, holding one string, on purpose.** Both ends of this
 * contract must agree, and the writer is `proxy.ts`, which runs in the Edge
 * runtime on every request its matcher covers — which is every page navigation
 * in the app. It therefore imports almost nothing: `config/routes.ts`
 * pulls in the lucide icon set through `NAV_GROUPS`, and `server-session.ts`
 * pulls in `config/routes.ts` and `next/headers`. A shared constant with zero
 * imports is what lets the two sides share a literal without either dragging
 * the other's dependencies into that bundle. Duplicating the string instead
 * would work exactly until someone renamed one copy.
 *
 * A client can put this header on a request but never keep it there: the proxy
 * `set`s it on a copy of the incoming headers for every request its matcher
 * covers, which overwrites whatever arrived. Every `(app)` path is inside that
 * matcher — it excludes only `/api/*`, Next's internals, `/p/*` and paths with
 * a file extension — so a forged value cannot reach the layout.
 */
export const REQUEST_PATH_HEADER = "x-tradeos-path";
