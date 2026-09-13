import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { InsightsScreen } from "@/features/insights/components/insights-screen";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Insights",
};

/**
 * The evening digest (design/plan `2026-09-12-ai-daily-digest-frontend`) —
 * `/insights`, gated on `reports:view` (`config/routes.ts`).
 *
 * Stays a Server Component holding only the metadata and the page-level gate;
 * every control on the screen is a query or a mutation, so the client
 * boundary starts at `<InsightsScreen>` — the same shape `/projects`,
 * `/debts` and `/customers` use.
 */
export default async function InsightsPage() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <InsightsScreen />;
}
