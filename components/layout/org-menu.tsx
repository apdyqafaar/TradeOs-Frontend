"use client";

import { cn } from "cn";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useLogout } from "@/features/auth/hooks/use-logout";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useSession } from "@/features/auth/hooks/use-session";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SidebarVariant } from "./nav";
import { getInitials } from "./nav-utils";

/**
 * The organization block at the top of the sidebar (canvas `:1919`). The
 * chevron is deliberately not an org switcher: a user belongs to one business
 * at a time (section 1), so the menu holds Settings and Log out and nothing
 * else.
 *
 * Only the expanded sidebar draws the bordered box the canvas shows. The rail
 * keeps the 32px mark alone (`:2013`) and the drawer sets the mark beside the
 * name with no frame, because its header already carries a close control on
 * the other side (`:2027`).
 */
export function OrgMenu({
  variant = "expanded",
}: {
  variant?: SidebarVariant;
}) {
  const { data: session, isPending } = useSession();
  const canOpenSettings = useCan(PERMISSIONS.ORGANIZATION_UPDATE);
  const logout = useLogout();

  const collapsed = variant === "rail";

  if (isPending) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5",
          variant === "expanded" && "rounded-lg border border-border p-2",
        )}
      >
        <Skeleton className="size-8 shrink-0 rounded-md" />
        {!collapsed && <Skeleton className="h-8 flex-1" />}
      </div>
    );
  }

  const name = session?.organization?.name ?? "Your business";

  return (
    <DropdownMenu>
      {/* The collapsed rail leaves only the mark, so the accessible name has to
          come from aria-label rather than the visible text. */}
      <DropdownMenuTrigger
        aria-label={collapsed ? name : undefined}
        className={cn(
          "flex items-center gap-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          // 8px padding inside a 10px-radius hairline box on the page ground,
          // one step darker than the sidebar it sits on.
          variant === "expanded" &&
            "w-full rounded-lg border border-border bg-background p-2 hover:bg-muted aria-expanded:bg-muted",
          variant === "drawer" &&
            "rounded-md p-1 hover:bg-sidebar-accent/45 aria-expanded:bg-sidebar-accent/45",
          collapsed && "rounded-md",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft font-medium font-mono text-primary-soft-foreground text-sm">
          {getInitials(name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[10px] text-muted-2 uppercase tracking-[0.08em]">
                Business
              </span>
              <span className="block truncate font-medium text-[13px] text-sidebar-foreground">
                {name}
              </span>
            </span>
            {variant === "expanded" && (
              <ChevronDown className="size-3.5 shrink-0 text-muted-2" />
            )}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {canOpenSettings && (
          <>
            <DropdownMenuItem render={<Link href={ROUTES.settings} />}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
