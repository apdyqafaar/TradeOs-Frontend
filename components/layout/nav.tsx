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

type NavLinkProps = {
  item: NavItem;
  activeHref: string | null;
  collapsed: boolean;
  /** Set by the mobile drawer so tapping an item closes the sheet. */
  onNavigate?: () => void;
};

/**
 * Renders its own `<li>` so that a hidden item leaves nothing behind — an empty
 * `<li>` would still take a slice of the list's row gap.
 */
function NavLink({ item, activeHref, collapsed, onNavigate }: NavLinkProps) {
  // Spread rather than a conditional call: the hook must run on every render,
  // but an item with no `permission` is visible to everyone and ignores it.
  const granted = useCan(...(item.permission ? [item.permission] : []));
  if (item.permission && !granted) return null;

  const active = activeHref === item.href;
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/45 hover:text-sidebar-foreground",
        collapsed && "w-9 justify-center px-0",
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

function NavSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder rows, never reordered
          key={index}
          className={cn("h-9 rounded-lg", collapsed ? "w-9" : "w-full")}
        />
      ))}
    </div>
  );
}

type NavProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
};

/**
 * The grouped nav (section 5). Group emptiness is decided in CSS rather than by
 * counting permissions here: each item hides itself, and a wrapper that ends up
 * with no `<a>` inside stays `display: none`, taking its label and its top rule
 * with it. That keeps permission logic in exactly one place — `NavLink`.
 */
export function NavGroups({ collapsed = false, onNavigate }: NavProps) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname);
  const { isPending } = useSession();

  if (isPending) return <NavSkeleton collapsed={collapsed} />;

  return (
    <div className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => (
        <div
          key={group.label}
          className="hidden border-sidebar-border border-t pt-4 first:border-t-0 first:pt-0 has-[a]:block"
        >
          <p
            className={cn(
              "px-2 pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.08em]",
              collapsed && "sr-only",
            )}
          >
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                activeHref={activeHref}
                collapsed={collapsed}
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
export function NavFooterItems({ collapsed = false, onNavigate }: NavProps) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname);

  return (
    <ul className="flex flex-col gap-0.5">
      {FOOTER_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          activeHref={activeHref}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}
