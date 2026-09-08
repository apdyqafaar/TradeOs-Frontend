"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface UiState {
  /** The desktop sidebar's rail mode. Remembered across visits. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  /** The mobile drawer. Deliberately transient — see `partialize` below. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (value: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      mobileNavOpen: false,
      setMobileNavOpen: (value) => set({ mobileNavOpen: value }),
    }),
    {
      name: "tradeos-ui",
      storage: createJSONStorage(() => localStorage),
      // Only the sidebar rail is remembered. Persisting `mobileNavOpen` would
      // reopen the drawer over the page on the next visit, on top of content
      // the user had already navigated to.
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
      // The default merge shallow-spreads whatever was in localStorage over
      // the store, so one key left behind by an older build — or typed into
      // devtools — comes back as state. Reading the single field explicitly
      // means only what `partialize` writes can ever be read.
      merge: (persistedState, currentState) => {
        const stored = persistedState as Partial<UiState> | undefined;
        return {
          ...currentState,
          sidebarCollapsed:
            typeof stored?.sidebarCollapsed === "boolean"
              ? stored.sidebarCollapsed
              : currentState.sidebarCollapsed,
        };
      },
      // Zustand normally rehydrates from localStorage the moment this module
      // is imported. Under SSR that produces markup rendered with
      // `sidebarCollapsed: false` on the server and `true` on the client's
      // first paint, which React reports as a hydration mismatch and repairs
      // by discarding the client tree. `skipHydration` defers the read; the
      // hook below performs it in an effect, after hydration has finished.
      skipHydration: true,
    },
  ),
);

/**
 * Reads the persisted sidebar state in.
 *
 * Call once, from a client component mounted at the app root. Until it runs
 * the store holds its defaults, which is exactly what the server rendered.
 */
export function useHydrateUiStore(): void {
  useEffect(() => {
    void useUiStore.persist.rehydrate();
  }, []);
}
