"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FOOTER_ITEMS,
  NAV_GROUPS,
  type NavBadgeKey,
  type NavItem,
} from "@/config/routes";
import { AnnouncementsUnreadBadge } from "@/features/announcements/components/announcements-unread-badge";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useSession } from "@/features/auth/hooks/use-session";
import { resolveActiveHref } from "./nav-utils";

/**
 * The three shapes artboard `1b` draws. Manager and Seller are *not* variants:
 * the canvas shows them side by side because they differ only in how many
 * items survive the permission check, and each item hides itself.
 */
export type SidebarVariant = "expanded" | "rail" | "drawer";

/**
 * Row geometry per variant, straight off the canvas: 36px tall at 13px in both
 * desktop sidebars (`:1932`, `:2072`), 44px at 14px in the drawer (`:2036`),
 * which is a touch target rather than a pointer one. `rounded-md` is 8px on
 * this radius scale — `rounded-lg` would be 10px and miss the canvas's 8.
 */
const ROW_STYLES: Record<SidebarVariant, string> = {
  expanded: "h-9 gap-2.5 rounded-md px-2.5 text-[13px]",
  rail: "h-9 w-10 justify-center rounded-md text-[13px]",
  drawer: "h-11 gap-2.5 rounded-md px-2.5 text-sm",
};

/** Group spacing per variant — 8px under a group, 6px in the drawer. */
const GROUP_STYLES: Record<SidebarVariant, string> = {
  expanded: "gap-0.5 pb-2",
  rail: "items-center gap-1 pb-1",
  drawer: "gap-0.5 pb-1.5",
};

/**
 * The live counters a nav item may carry, resolved from the token on the item.
 *
 * **Why a registry and not a prop, a context or a hook in `NavGroups`.** The
 * requirement is one item with a live number and eleven without, and the nav is
 * rendered three times over (aside, rail, mobile drawer) inside a layout that
 * is on screen for the whole session. Four shapes were on the table:
 *
 * 1. **A `useQuery` in `NavGroups`.** One count would make the entire nav a
 *    data-fetching component: every item's render would depend on a query none
 *    of them use, a failure or a refetch would re-render eleven links, and the
 *    second badge anybody wants would be a second hook in the same place.
 * 2. **A `count` prop threaded from the shell.** Same problem one level up —
 *    `Sidebar`, `MobileNav` and the drawer would each have to fetch and pass
 *    it, so a fact about announcements would be spelled out in three layout
 *    files that have nothing to do with announcements.
 * 3. **The component itself on `NavItem`.** `config/routes.ts` is imported by
 *    Server Components and by the server-side page gate; a `"use client"`
 *    component sitting in it drags React Query and the announcements feature
 *    into all of those import graphs to describe a link.
 * 4. **This.** The config names a token, this map resolves it, and the badge
 *    owns its own query. Exactly one `<li>` in the tree subscribes to anything;
 *    the other eleven render as they always did. Adding a second counter later
 *    is one token, one row here and one component — and `NavLink` does not
 *    change at all.
 *
 * The component is mounted **inside the link**, deliberately, so its `sr-only`
 * text becomes part of the anchor's accessible name — "Announcements, 3
 * unread" rather than a stray number beside it — and so the rail's dot can be
 * positioned against the link, which is why `relative` is in the link's class
 * list below.
 */
const NAV_BADGES: Record<
  NavBadgeKey,
  ComponentType<{ collapsed?: boolean }>
> = {
  "announcements-unread": AnnouncementsUnreadBadge,
};

type NavLinkProps = {
  item: NavItem;
  activeHref: string | null;
  variant: SidebarVariant;
  /**
   * Help Center sits a step quieter than the main nav — `#6E6D68` against the
   * items' near-black (canvas `:1941`).
   */
  muted?: boolean;
  /** Set by the mobile drawer so tapping an item closes the sheet. */
  onNavigate?: () => void;
};

/**
 * Renders its own `<li>` so that a hidden item leaves nothing behind — an empty
 * `<li>` would still take a slice of the list's row gap.
 */
function NavLink({
  item,
  activeHref,
  variant,
  muted = false,
  onNavigate,
}: NavLinkProps) {
  // Spread rather than a conditional call: the hook must run on every render,
  // but an item with no `permission` is visible to everyone and ignores it.
  const granted = useCan(...(item.permission ? [item.permission] : []));
  if (item.permission && !granted) return null;

  const active = activeHref === item.href;
  const collapsed = variant === "rail";
  const Icon = item.icon;
  const Badge = item.badge ? NAV_BADGES[item.badge] : null;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        // `relative` is for the rail's badge dot, which is positioned against
        // this link. Harmless on the other two variants, and keeping it in the
        // base class list means the rail cannot lose it by way of a variant
        // style being edited.
        "relative flex items-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        ROW_STYLES[variant],
        // The active pill is `#F6E7DF` behind `#D97757` at weight 500. That is
        // 2.6:1 and deliberate — owner decision 2026-09-07, locked by
        // `app/globals.test.ts`. Do not deepen it.
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : cn(
              "hover:bg-sidebar-accent/45 hover:text-sidebar-foreground",
              muted ? "text-muted-foreground" : "text-sidebar-foreground/85",
            ),
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.5} />
      <span className={cn("truncate", collapsed && "sr-only")}>
        {item.label}
      </span>
      {/* After the label, so the accessible name reads "Announcements, 3
          unread" in that order. Renders nothing at all at zero or while the
          count is loading. */}
      {Badge ? <Badge collapsed={collapsed} /> : null}
    </Link>
  );

  if (!collapsed) return <li>{link}</li>;

  return (
    <li>
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    </li>
  );
}

function NavSkeleton({ variant }: { variant: SidebarVariant }) {
  return (
    <div className="flex flex-col gap-0.5" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder rows, never reordered
          key={index}
          className={cn(
            "rounded-md",
            variant === "drawer" ? "h-11" : "h-9",
            variant === "rail" ? "w-10" : "w-full",
          )}
        />
      ))}
    </div>
  );
}

type NavProps = {
  variant?: SidebarVariant;
  onNavigate?: () => void;
};

/**
 * The grouped nav (section 5, canvas `:1927`). Group emptiness is decided in
 * CSS rather than by counting permissions here: each item hides itself, and a
 * wrapper that ends up with no `<a>` inside stays `display: none`, taking its
 * label with it. That keeps permission logic in exactly one place — `NavLink`.
 * It is what turns the manager's 11 rows into the seller's 7 and drops the
 * whole "Manage" heading along with Members and Settings.
 */
export function NavGroups({ variant = "expanded", onNavigate }: NavProps) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname);
  const { isPending } = useSession();

  if (isPending) return <NavSkeleton variant={variant} />;

  return (
    <div className="flex flex-col gap-0.5">
      {NAV_GROUPS.map((group) => (
        <div
          key={group.label}
          className={cn("hidden flex-col has-[a]:flex", GROUP_STYLES[variant])}
        >
          <p
            className={cn(
              // 11px medium uppercase at 0.06em on `#A9A7A0`, 10/10/6 padding.
              "px-2.5 pt-2.5 pb-1.5 font-medium text-[11px] text-muted-3 uppercase tracking-[0.06em]",
              variant === "rail" && "sr-only",
            )}
          >
            {group.label}
          </p>
          <ul
            className={cn(
              "flex flex-col",
              variant === "rail" ? "items-center gap-1" : "gap-0.5",
            )}
          >
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                activeHref={activeHref}
                variant={variant}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Help Center and anything else that sits under the rule above the user row. */
export function NavFooterItems({ variant = "expanded", onNavigate }: NavProps) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname);

  return (
    <ul
      className={cn(
        "flex flex-col",
        variant === "rail" ? "items-center gap-1" : "gap-0.5",
      )}
    >
      {FOOTER_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          activeHref={activeHref}
          variant={variant}
          muted
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}
