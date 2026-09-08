import type { ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";
import { MobileNav } from "@/components/layout/mobile-nav";
import { RouteGuard } from "@/components/layout/route-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Stays a Server Component: the client boundaries are the shell pieces and the
 * two guards, so every page rendered as {children} is free to be a server
 * component too.
 *
 * The two guards are nested deliberately and are not interchangeable.
 * `AppGate` wraps the whole shell and answers "may this person see a dashboard
 * at all?" — no session or no business means the sidebar and topbar never
 * mount. `RouteGuard` sits inside `<main>` and answers "may they see *this*
 * page?" — a member who lacks one permission keeps the shell, so they can
 * navigate somewhere they are allowed instead of being stranded.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <div className="flex flex-1">
        <Sidebar />
        <MobileNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {/* 32px of padding and a 24px column gap at `lg`, which reproduces
              the 1200px content region of artboard `1c` exactly at a 1440
              viewport. `max-w-[1280px]` stops an ultrawide screen stretching
              it. */}
          <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 p-4 lg:p-8">
            <RouteGuard>{children}</RouteGuard>
          </main>
        </div>
      </div>
    </AppGate>
  );
}
