import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ProjectsPage } from "@/features/projects/components/projects-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Projects",
};

/**
 * The projects grid (design canvas artboard `2l`, the top-left panel).
 *
 * `/projects` **is** in `ROUTE_PERMISSIONS`, keyed on `projects:view`
 * (`config/routes.ts`) — unlike `/announcements`, which is open to every
 * member. Every preset does in fact hold `projects:view` (contract §5), but
 * roles are editable and a custom role without it must meet a calm refusal
 * rather than an empty grid full of 403s.
 *
 * Stays a Server Component holding only the metadata: the grid pages and
 * filters from the URL and every control on it is gated on the client session,
 * so the client boundary starts at `<ProjectsPage>` — the same shape
 * `/announcements`, `/debts` and `/customers` use.
 */
export default async function Projects() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <ProjectsPage />;
}
