"use client";

import { cn } from "cn";
import { ChevronDown, CircleUser, LogOut } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useSession } from "@/features/auth/hooks/use-session";
import type { SidebarVariant } from "./nav";
import { getInitials } from "./nav-utils";

/**
 * The sidebar footer row (canvas `:1945`): who is signed in, and which role
 * they hold, on a `#F0EEE6` fill. The role name is the fastest answer to "why
 * can't I see Reports?", so it stays visible rather than hiding in the menu.
 *
 * The initials circle is 30px of `--info-soft` behind `--info` — the one blue
 * in the palette, chosen so the user row never competes with the terracotta
 * active pill a few rows above it.
 */
export function UserMenu({
  variant = "expanded",
}: {
  variant?: SidebarVariant;
}) {
  const { data: session, isPending } = useSession();
  const logout = useLogout();

  const collapsed = variant === "rail";

  if (isPending) {
    return (
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <Skeleton className="size-[30px] shrink-0 rounded-full" />
        {!collapsed && <Skeleton className="h-8 flex-1" />}
      </div>
    );
  }

  const name = session?.user.name ?? "Account";
  const roleName = session?.role?.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={collapsed ? name : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-md text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          collapsed
            ? "self-center"
            : "w-full bg-muted px-2.5 py-2 hover:bg-surface-2 aria-expanded:bg-surface-2",
        )}
      >
        {/* `after:hidden` drops the shared Avatar's inset ring: the canvas
            draws a flat tinted disc, not a bordered one. */}
        <Avatar className="size-[30px] shrink-0 after:hidden">
          {session?.user.image && (
            <AvatarImage src={session.user.image} alt="" />
          )}
          <AvatarFallback
            className={cn(
              "bg-info-soft font-mono text-info",
              collapsed ? "text-[11px]" : "text-xs",
            )}
          >
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[13px] text-sidebar-foreground">
                {name}
              </span>
              {roleName && (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {roleName}
                </span>
              )}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-2" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem render={<Link href={ROUTES.account} />}>
          <CircleUser />
          Account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
