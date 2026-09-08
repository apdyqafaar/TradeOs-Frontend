import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ROUTES } from "@/config/routes";

/**
 * The auth frame from artboard `1f` (`docs/design/TradeOs-UI.dc.html:2661`):
 * one centred column on the cream ground, wordmark pinned top-left and the
 * theme toggle top-right. No split-screen illustration, no marketing copy —
 * pages supply only what goes inside the 400px column.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-background px-6 py-24">
      <Link
        href={ROUTES.login}
        className="absolute top-[22px] left-[26px] rounded-sm font-semibold text-[15px] tracking-[-0.01em] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        TradeOs
      </Link>

      {/* The canvas draws a 32px bordered square here, but `ThemeToggle` is a
          shared component owned by the shell and takes no `className`. Styling
          it through the wrapper keeps the one toggle everywhere instead of
          forking a second one for this frame. */}
      <div className="absolute top-5 right-6 *:size-8 *:rounded-[9px] *:border *:border-border *:bg-card">
        <ThemeToggle />
      </div>

      <main className="flex w-full justify-center">{children}</main>
    </div>
  );
}
