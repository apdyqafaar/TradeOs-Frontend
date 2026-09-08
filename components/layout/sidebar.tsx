"use client";

import { cn } from "cn";
import { PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUiStore } from "@/stores/ui.store";
import { NavFooterItems, NavGroups, type SidebarVariant } from "./nav";
import { OrgMenu } from "./org-menu";
import { UserMenu } from "./user-menu";

type SidebarContentProps = {
  variant?: SidebarVariant;
  /** The mobile drawer passes this to close itself after a tap. */
  onNavigate?: () => void;
  showCollapseToggle?: boolean;
  /** The drawer's close control, rendered beside the org block. */
  headerAction?: ReactNode;
};

/**
 * Org block, groups, footer — shared verbatim by the desktop aside, the rail
 * and the mobile drawer so the four canvas variants can never drift apart.
 *
 * Measurements come from artboard `1b` (`docs/design/TradeOs-UI.dc.html:1908`):
 * 12px around the org block, `4px 12px 12px` around the nav, and a footer under
 * a hairline at `10px 12px` with a 4px gap.
 */
export function SidebarContent({
  variant = "expanded",
  onNavigate,
  showCollapseToggle = false,
  headerAction,
}: SidebarContentProps) {
  const collapsed = variant === "rail";

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between",
          variant === "expanded" && "p-3",
          // The drawer's header is tighter at the bottom because its first nav
          // group heading supplies the rest of the gap (canvas `:2027`).
          variant === "drawer" && "px-3.5 pt-3.5 pb-2",
          collapsed && "justify-center pt-3 pb-3",
        )}
      >
        <OrgMenu variant={variant} />
        {headerAction}
      </div>

      <nav
        aria-label="Main"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-3",
          collapsed ? "pb-3" : "pt-1 pb-3",
        )}
      >
        <NavGroups variant={variant} onNavigate={onNavigate} />
      </nav>

      <div
        className={cn(
          "flex flex-col gap-1 border-sidebar-border border-t px-3 py-2.5",
          collapsed && "items-center",
        )}
      >
        {showCollapseToggle && <CollapseToggle collapsed={collapsed} />}
        <nav aria-label="Support">
          <NavFooterItems variant={variant} onNavigate={onNavigate} />
        </nav>
        <UserMenu variant={variant} />
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
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        collapsed && "w-10 justify-center px-0",
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
 * 240px expanded, 64px rail, on `--card` behind a `#E3E1D8` right border
 * (canvas `:2055`). Hidden below `lg` — `MobileNav` takes over there, which is
 * why this is `hidden lg:flex` rather than a responsive width.
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
      <SidebarContent
        variant={collapsed ? "rail" : "expanded"}
        showCollapseToggle
      />
    </aside>
  );
}
