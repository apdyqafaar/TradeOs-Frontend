import type { ReactNode } from "react";
import { MobileNav } from "@/components/layout/mobile-nav";
import { RouteGuard } from "@/components/layout/route-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Stays a Server Component: only the three shell pieces need hooks, so the
 * client boundary starts at them rather than at the whole subtree, and every
 * page rendered as {children} is free to be a server component too.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1">
      <Sidebar />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* 32px of padding and a 24px column gap at `lg`, which reproduces the
            1200px content region of artboard `1c` exactly at a 1440 viewport.
            `max-w-[1280px]` stops an ultrawide screen from stretching it. */}
        <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 p-4 lg:p-8">
          {/* The guard, not the layout, is the client boundary: it needs the
              session to know whether this person has a business and whether
              they may open this path. */}
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>
    </div>
  );
}
