import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ROUTES } from "@/config/routes";

/**
 * The claude.ai-like auth frame (section 3.3): one centred column on the cream
 * ground, wordmark top-left, no split-screen illustration and no marketing
 * copy. Pages supply only what goes inside the 400px column.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link
          href={ROUTES.login}
          className="rounded-sm font-medium text-sm tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          TradeOs
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
