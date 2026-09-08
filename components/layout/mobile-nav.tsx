"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUiStore } from "@/stores/ui.store";
import { SidebarContent } from "./sidebar";

/**
 * The same sidebar as a drawer below 1024px. `mobileNavOpen` lives in the store
 * rather than here because the trigger is in the topbar, on the other side of
 * the layout tree.
 */
export function MobileNav() {
  const open = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <Sheet open={open} onOpenChange={setMobileNavOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-[17rem] flex-col gap-0 bg-sidebar p-0 sm:max-w-[17rem] lg:hidden"
      >
        {/* The org block already names the business on screen; this exists so
            the dialog has an accessible name. */}
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
