"use client";

import { X } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUiStore } from "@/stores/ui.store";
import { SidebarContent } from "./sidebar";

/**
 * The same sidebar as a drawer below 1024px, 288px wide on `--card` behind a
 * hairline right border (canvas `:2025`). Its rows are 44px rather than 36px
 * and its labels 14px rather than 13px — the one place the shell trades the
 * canvas's desktop density for a touch target.
 *
 * `mobileNavOpen` lives in the store rather than here because the trigger is in
 * the topbar, on the other side of the layout tree.
 */
export function MobileNav() {
  const open = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <Sheet open={open} onOpenChange={setMobileNavOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        // `w-72!`, not `w-72`: `SheetContent`'s own `data-[side=left]:w-3/4`
        // carries an attribute selector, so it outranks a plain width utility
        // and the drawer would silently be 75% of the viewport instead of the
        // canvas's 288px.
        className="flex w-72! flex-col gap-0 border-sidebar-border border-r bg-sidebar p-0 lg:hidden"
      >
        {/* The org block already names the business on screen; this exists so
            the dialog has an accessible name. */}
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent
          variant="drawer"
          onNavigate={() => setMobileNavOpen(false)}
          headerAction={
            <SheetClose
              aria-label="Close navigation"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/45 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-[18px]" strokeWidth={1.5} />
            </SheetClose>
          }
        />
      </SheetContent>
    </Sheet>
  );
}
