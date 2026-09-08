"use client";

import { ChevronRight, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { UnverifiedEmailStrip } from "@/features/auth/components/unverified-email-strip";
import { useSession } from "@/features/auth/hooks/use-session";
import { useUiStore } from "@/stores/ui.store";
import { buildBreadcrumbs } from "./nav-utils";

/**
 * 56px tall on the page ground under a hairline, 24px of side padding, the
 * breadcrumb left and search + theme right (artboard `1c`,
 * `docs/design/TradeOs-UI.dc.html:2097`). The hamburger only exists below
 * `lg`, where `MobileNav` replaces the sidebar.
 */
export function Topbar() {
  const pathname = usePathname();
  const crumbs = buildBreadcrumbs(pathname);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { data: session } = useSession();

  // Explicitly `=== false`: while the session is loading there is nothing to
  // warn about, and an undefined check would flash the strip on every load.
  const emailUnverified = session?.user.emailVerified === false;

  return (
    <div className="sticky top-0 z-30">
      <header className="flex h-14 items-center justify-between gap-3 border-border border-b bg-background px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            className="-ml-1 lg:hidden"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu strokeWidth={1.5} />
          </Button>

          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-2">
              {crumbs.map((crumb, index) => {
                const isCurrent = index === crumbs.length - 1;

                return (
                  <li
                    key={crumb.href}
                    className="flex min-w-0 items-center gap-2"
                  >
                    {index > 0 && (
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-border-strong"
                        strokeWidth={2}
                      />
                    )}
                    {isCurrent ? (
                      <span
                        aria-current="page"
                        className="truncate font-medium text-[13px] text-primary"
                      >
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className="truncate rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <SearchTrigger />
          {/* The canvas draws a 34px bordered square here, but `ThemeToggle` is
              shared and takes no `className`; styling it through the wrapper
              keeps one toggle in the app instead of forking a second. Same
              trick as `app/(auth)/layout.tsx`. */}
          <div className="*:size-[34px] *:rounded-lg *:border *:border-border *:bg-card *:text-muted-foreground">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {emailUnverified && <UnverifiedEmailStrip />}
    </div>
  );
}

/**
 * 260×34 with a 15px glass, a `--muted-3` placeholder and a `⌘K` chip
 * (canvas `:2105`). Below `md` it collapses to the icon alone, because 260px
 * of chrome next to a breadcrumb does not fit a phone.
 *
 * Wired to nothing yet.
 * TODO(feature: search): open a command palette over products, customers and
 * receipt numbers, bound to Cmd/Ctrl+K.
 */
function SearchTrigger() {
  return (
    <button
      type="button"
      aria-label="Search"
      className="flex h-[34px] items-center gap-2 rounded-lg border border-border bg-card px-2.5 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:w-[260px]"
    >
      <Search
        aria-hidden="true"
        className="size-[15px] shrink-0 text-muted-3"
        strokeWidth={1.75}
      />
      <span className="hidden flex-1 text-left text-[13px] text-muted-3 md:inline">
        Search
      </span>
      <kbd
        data-slot="kbd"
        className="hidden rounded-[5px] border border-border bg-muted px-[5px] py-px font-mono text-[10px] text-muted-2 leading-4 md:inline"
      >
        ⌘K
      </kbd>
    </button>
  );
}
