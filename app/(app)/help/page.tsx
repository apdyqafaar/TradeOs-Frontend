import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { HelpCenter } from "@/features/help/components/help-center";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Help Center",
};

/**
 * The Help Center (design canvas artboard `2m`).
 *
 * `/help` is deliberately absent from `ROUTE_PERMISSIONS` — `config/routes.ts`
 * lists it among the paths open to every member. `requirePageAccess()` is still
 * awaited, because it is what proves there is a session at all before anything
 * renders; with no row in the map it resolves no permission and `permitted`
 * comes back true for any signed-in member.
 *
 * The articles are local (`features/help/content.ts`), so this page has nothing
 * to fetch and the client boundary exists only for the search box and the
 * `?article=` state.
 */
export default async function Help() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-4xl text-foreground leading-tight">
          Help Center
        </h1>
        <p className="text-[14px] text-muted-foreground">
          How TradeOs works, in the order you are likely to need it.
        </p>
      </div>

      <HelpCenter />
    </div>
  );
}
