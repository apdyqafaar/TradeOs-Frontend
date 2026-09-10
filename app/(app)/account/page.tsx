import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { AccountPage } from "@/features/account/components/account-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Account",
};

/**
 * The personal account screen (design canvas artboard `2k`, right panel).
 *
 * **`/account` deliberately has no row in `ROUTE_PERMISSIONS`.** Not one of the
 * fourteen account and security routes carries `requireMember`,
 * `requirePermission` or `requireVerifiedEmail` — recorded as a decision at
 * `auth.route.ts:118-131,171-189,231-247` and `user.route.ts:9-42`, and proven
 * by a test in which a user with no `Member` row still gets a 200 from
 * `PATCH /users/me` (`user-profile.test.ts:181-195`). So `requirePageAccess`
 * resolves `permitted: true` here for everyone, and the `ForbiddenScreen`
 * branch below is unreachable today.
 *
 * It is written anyway, and the call is not ceremonial. `requirePageAccess` is
 * what re-validates the session on a **client-side navigation**, which does not
 * re-run the layout — without it, a session revoked mid-browse would keep
 * rendering this page server-side. A repo-wide test
 * (`lib/auth/require-page-access.test.ts`) walks every `page.tsx` under
 * `(app)` and fails any that skips it, for exactly that reason.
 *
 * **One known divergence, worth the owner's attention.** The API would serve
 * every endpoint on this screen to a signed-in user with no business, but
 * `requirePageAccess` redirects an organization-less caller to `/onboarding`
 * before this page renders — and so does `app/(app)/layout.tsx`, because
 * `/account` sits inside the app shell. Nothing in the components below needs
 * an organization (the only use is a timezone for date formatting, which falls
 * back to UTC), so moving the route out of the shell later is a relocation and
 * not a rewrite. See `docs/findings/slice5-settings-account.md`.
 */
export default async function Account() {
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <AccountPage />;
}
