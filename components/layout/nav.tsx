"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FOOTER_ITEMS, NAV_GROUPS, type NavItem } from "@/config/routes";
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

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
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
