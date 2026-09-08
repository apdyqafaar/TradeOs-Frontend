"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Both icons are always in the markup and the `dark:` variant picks one, so the
 * server and the first client render agree. Reading `resolvedTheme` only inside
 * the handler avoids the usual mounted-flag dance and its flash of a wrong icon.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="dark:hidden" strokeWidth={1.5} />
      <Moon className="hidden dark:block" strokeWidth={1.5} />
    </Button>
  );
}
