import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { MemberDetail } from "@/features/team/components/member-detail";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Member",
};

/**
 * One member's record.
 *
 * A sibling of the literal `/team/roles`, which is safe: Next resolves a
 * literal segment ahead of a dynamic one, so `/team/roles` still reaches the
 * roles screen and never arrives here as an id.
 *
 * No `ROUTE_PERMISSIONS` row of its own — `resolveRoutePermission` falls back
 * to the longest matching prefix, `/team`, and therefore to `members:invite`.
 * That is deliberate: a Seller holds `members:view` so a name can be resolved
 * on a receipt, not so they can open a colleague's record.
 *
 * **`params` is a Promise in Next 16** and must be awaited.
 */
export default async function Member({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  const { id } = await params;
  return <MemberDetail memberId={id} />;
}
