"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider, useTheme } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getQueryClient } from "@/lib/query/client";
import { useHydrateUiStore } from "@/stores/ui.store";

/**
 * sonner defaults to its light skin and has no idea next-themes exists, so a
 * dark app would raise cream toasts. This has to be a child of ThemeProvider
 * to read the context, hence a component rather than a prop below.
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      richColors
      closeButton
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // The UI store persists the sidebar rail with `skipHydration`, so the
  // remembered value is read here — the one client component mounted for the
  // whole app — after hydration rather than at import time.
  useHydrateUiStore();

  // getQueryClient() is the singleton-per-request accessor; calling
  // it in render (rather than useState) is what keeps the server and the
  // browser on the same client without a second cache.
  const queryClient = getQueryClient();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <TooltipProvider>
            {children}
            <ThemedToaster />
            {/* Statically false in production, so the devtools bundle is
                dropped rather than shipped and hidden. */}
            {process.env.NODE_ENV === "development" && (
              <ReactQueryDevtools initialIsOpen={false} />
            )}
          </TooltipProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
