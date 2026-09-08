"use client";

import { ChevronRight, Menu, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/hooks/use-session";
import { useUiStore } from "@/stores/ui.store";
import { buildBreadcrumbs } from "./nav-utils";

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
      <header className="flex h-14 items-center gap-3 border-border border-b bg-background px-4 lg:px-8">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open navigation"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu strokeWidth={1.5} />
        </Button>

        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1.5 text-sm">
            {crumbs.map((crumb, index) => {
              const isCurrent = index === crumbs.length - 1;

              return (
                <li
                  key={crumb.href}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {index > 0 && (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
                  )}
                  {isCurrent ? (
                    <span
                      aria-current="page"
                      className="truncate font-medium text-primary"
                    >
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="truncate text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <SearchTrigger />
        <ThemeToggle />
      </header>

      {emailUnverified && <UnverifiedEmailStrip />}
    </div>
  );
}

/**
 * Placeholder only — rendered so the shell is complete, wired to nothing.
 * TODO(feature: search): open a command palette over products, customers and
 * receipt numbers, bound to Cmd/Ctrl+K.
 */
function SearchTrigger() {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Search"
      className="gap-2 text-muted-foreground"
    >
      <Search strokeWidth={1.5} />
      <span className="hidden sm:inline">Search</span>
      <kbd
        data-slot="kbd"
        className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 sm:inline"
      >
        ⌘K
      </kbd>
    </Button>
  );
}

function UnverifiedEmailStrip() {
  return (
    <div className="flex items-center gap-2 border-border border-b bg-warning-soft px-4 py-1.5 text-warning-soft-foreground text-xs lg:px-8">
      <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.5} />
      <p className="min-w-0">
        Your email is not verified. Creating a business stays blocked until it
        is.
      </p>
      {/* TODO(feature: auth): POST /auth/resend-verification with a 60s cooldown. */}
      <Button
        variant="link"
        size="xs"
        className="ml-auto shrink-0 text-warning-soft-foreground underline"
      >
        Resend verification
      </Button>
    </div>
  );
}
