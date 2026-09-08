import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * SCAFFOLDING, not the Overview of section 6.3. The real page greets the user
 * by name in the business timezone and renders one `GET /dashboard` response as
 * a stack of optional sections (stat cards, trend, debts, stock, staff,
 * projects, announcements). This exists so the shell has somewhere to land and
 * so the foundation can be seen working; replace it wholesale.
 */
const WIRED = [
  "Warm palette and dark mode across every shadcn token",
  "Instrument Serif for display, Geist for prose, Geist Mono for figures",
  "Sidebar, rail, drawer and topbar, filtered by permission",
  "TanStack Query, nuqs, sonner and tooltips mounted app-wide",
  "proxy.ts bouncing anonymous requests to /login",
  "/api/v1 rewritten to the API so the session cookie stays first-party",
];

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[28px] leading-tight tracking-tight">
        Good morning.
      </h1>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Foundation ready</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-muted-foreground">
            {WIRED.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-primary">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
