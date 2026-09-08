import type { ReactNode } from "react";
import { MobileNav } from "@/components/layout/mobile-nav";
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
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
