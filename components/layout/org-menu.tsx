"use client";

import { cn } from "cn";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
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
import { getInitials } from "./nav-utils";

/**
 * The organization block at the top of the sidebar. The chevron is deliberately
 * not an org switcher: a user belongs to one business at a time (section 1), so
 * the menu holds Settings and Log out and nothing else.
 */
export function OrgMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { data: session, isPending } = useSession();
  const canOpenSettings = useCan(PERMISSIONS.ORGANIZATION_UPDATE);
  const logout = useLogout();

  if (isPending) {
    return (
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <Skeleton className="size-8 shrink-0 rounded-md" />
        {!collapsed && <Skeleton className="h-8 flex-1" />}
      </div>
    );
  }

  const name = session?.organization?.name ?? "Your business";

  const mark = (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft font-medium text-[13px] text-primary-soft-foreground">
      {getInitials(name)}
    </span>
  );

  return (
    <DropdownMenu>
      {/* The collapsed rail leaves only the mark, so the accessible name has to
          come from aria-label rather than the visible text. */}
      <DropdownMenuTrigger
        aria-label={collapsed ? name : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-sidebar-accent/45",
          collapsed && "w-auto justify-center px-1",
        )}
      >
        {mark}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
                Business
              </span>
              <span className="block truncate font-medium text-sidebar-foreground text-sm">
                {name}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
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
