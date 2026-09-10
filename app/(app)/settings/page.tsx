import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * The business settings screen (design canvas artboard `2k`, left panel).
 *
 * `/settings` is in `config/routes.ts` gated on **`organization:update`**, not
 * `organization:view`. That row is deliberate and predates this slice: every
 * preset holds `organization:view` — it is what `GET /dashboard` runs on — so
 * gating on view would gate nothing at all, and both PATCH routes this screen
 * exists to call are `organization:update` anyway.
 *
 * Stays a Server Component holding only the metadata and the gate; the tab
 * strip and both forms are interactive, so the client boundary starts at
 * `SettingsPage`.
 */
export default async function Settings() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <SettingsPage />;
}
