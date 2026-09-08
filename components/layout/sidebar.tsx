"use client";

import { cn } from "cn";
import { PanelLeft } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUiStore } from "@/stores/ui.store";
import { NavFooterItems, NavGroups } from "./nav";
import { OrgMenu } from "./org-menu";
import { UserMenu } from "./user-menu";

type SidebarContentProps = {
  collapsed?: boolean;
  /** The mobile drawer passes this to close itself after a tap. */
  onNavigate?: () => void;
  showCollapseToggle?: boolean;
};

/**
 * Org block, groups, footer — shared verbatim by the desktop aside and the
 * mobile drawer so the two can never drift apart.
 */
export function SidebarContent({
  collapsed = false,
  onNavigate,
  showCollapseToggle = false,
}: SidebarContentProps) {
  const pad = collapsed ? "px-2" : "px-3";

  return (
    <>
      <div className={cn("py-3", pad)}>
        <OrgMenu collapsed={collapsed} />
      </div>

      <nav
        aria-label="Main"
        className={cn("min-h-0 flex-1 overflow-y-auto pb-3", pad)}
      >
        <NavGroups collapsed={collapsed} onNavigate={onNavigate} />
      </nav>

      <div
        className={cn(
          "flex flex-col gap-1 border-sidebar-border border-t py-3",
          pad,
        )}
      >
        {showCollapseToggle && <CollapseToggle collapsed={collapsed} />}
        <nav aria-label="Support">
          <NavFooterItems collapsed={collapsed} onNavigate={onNavigate} />
        </nav>
        <UserMenu collapsed={collapsed} />
      </div>
    </>
  );
}

function CollapseToggle({ collapsed }: { collapsed: boolean }) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  const button = (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2 text-sidebar-foreground/85 text-sm outline-none transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        collapsed && "w-9 justify-center px-0",
      )}
    >
      <PanelLeft
        className={cn("size-[18px] shrink-0", collapsed && "rotate-180")}
        strokeWidth={1.5}
      />
      {!collapsed && <span>Collapse</span>}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 240px expanded, 64px rail. Hidden below `lg` — `MobileNav` takes over there,
 * which is why this is `hidden lg:flex` rather than a responsive width.
 */
export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-sidebar-border border-r bg-sidebar lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <SidebarContent collapsed={collapsed} showCollapseToggle />
    </aside>
  );
}
