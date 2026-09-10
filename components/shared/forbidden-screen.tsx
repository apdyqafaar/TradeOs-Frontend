import { Lock } from "lucide-react";
import { ButtonLink } from "@/components/shared/button-link";
import { ROUTES } from "@/config/routes";

/**
 * The 403 boundary from brief §8.4: a calm full-page refusal with a way out.
 *
 * Navigation should never lead here — every nav item is gated, so a Seller
 * never sees Reports in the sidebar. This is the typed-URL case, and it is not
 * an error: nothing failed, the person simply stood outside a door. So it
 * borrows the empty state's quiet language (a muted circle, a serif line, one
 * action) and none of the error card's — no red, no triangle, no request id,
 * because there is no request to trace.
 *
 * It is not `<EmptyState>` itself because this replaces a whole page rather
 * than filling a panel inside one: it owns the page's `h1`, which an empty
 * list must not.
 *
 * Copy names no role. "Ask an owner or manager" is true whoever the person is,
 * where "you need the reports:view permission" would leak the catalog and tell
 * them nothing they can act on.
 */
export function ForbiddenScreen() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
        <Lock className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h1 className="font-serif text-2xl leading-tight text-foreground">
        You don't have access to this
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Ask an owner or manager if you need it.
      </p>
      <ButtonLink variant="outline" className="mt-5" href={ROUTES.overview}>
        Back to overview
      </ButtonLink>
    </div>
  );
}
