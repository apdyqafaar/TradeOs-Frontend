import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { RolesPage } from "@/features/team/components/roles-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Roles",
};

/**
 * The roles screen (design canvas artboard `2j`, lower panel and matrix card).
 *
 * `/team/roles` has its own row in `config/routes.ts` gated on **`roles:view`**,
 * which is stricter than its `/team` parent would give it by longest-prefix
 * match. It needs to be: `roles:view` is the one permission in this area the
 * Seller preset does **not** hold, and it is what `GET /roles` — the request
 * that fills this entire screen — is gated on.
 */
export default async function TeamRoles() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <RolesPage />;
}
