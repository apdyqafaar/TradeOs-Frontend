"use client";

import { cn } from "cn";
import { CircleUser, LogOut } from "lucide-react";
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
import { getInitials } from "./nav-utils";

/**
 * The sidebar footer row: who is signed in, and which role they hold. The role
 * name is the fastest answer to "why can't I see Reports?", so it stays visible
 * rather than hiding inside the menu.
 */
export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { data: session, isPending } = useSession();
  const logout = useLogout();

  if (isPending) {
    return (
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <Skeleton className="size-8 shrink-0 rounded-full" />
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
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-sidebar-accent/45",
          collapsed && "w-auto justify-center px-1",
        )}
      >
        <Avatar>
          {session?.user.image && (
            <AvatarImage src={session.user.image} alt="" />
          )}
          <AvatarFallback className="text-xs">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-sidebar-foreground text-sm">
              {name}
            </span>
            {roleName && (
              <span className="block truncate text-muted-foreground text-xs">
                {roleName}
              </span>
            )}
          </span>
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
