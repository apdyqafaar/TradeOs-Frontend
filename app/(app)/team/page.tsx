import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { TeamPage } from "@/features/team/components/team-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Members",
};

/**
 * The members screen (design canvas artboard `2j`).
 *
 * Stays a Server Component holding only the metadata and the gate: the list is
 * paged from the URL and every control below it is interactive, so the client
 * boundary starts at `TeamPage`.
 *
 * `/team` is already in `config/routes.ts` gated on **`members:invite`**, not
 * `members:view` — the Seller preset holds `members:view` so a seller can see
 * who recorded a sale, and gating on it would put member management in the
 * counter staff's sidebar. That row is deliberate and is not this slice's to
 * change.
 */
export default async function Team() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <TeamPage />;
}
