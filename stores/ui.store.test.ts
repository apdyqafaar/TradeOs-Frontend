import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui.store";

const PERSIST_KEY = "tradeos-ui";

const persisted = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(PERSIST_KEY);
  return raw
    ? ((JSON.parse(raw) as { state: Record<string, unknown> }).state ?? null)
    : null;
};

beforeEach(() => {
  useUiStore.setState({ sidebarCollapsed: false, mobileNavOpen: false });
  localStorage.clear();
});

describe("sidebar", () => {
  it("toggles", () => {
    const { toggleSidebar } = useUiStore.getState();

    toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);

    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it("can be set directly, for a resize handler that knows the answer", () => {
    useUiStore.getState().setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);

    useUiStore.getState().setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it("is written to localStorage", () => {
    useUiStore.getState().setSidebarCollapsed(true);
    expect(persisted()).toEqual({ sidebarCollapsed: true });
  });
});

describe("mobile nav", () => {
  it("opens and closes", () => {
    useUiStore.getState().setMobileNavOpen(true);
    expect(useUiStore.getState().mobileNavOpen).toBe(true);

    useUiStore.getState().setMobileNavOpen(false);
    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });

  it("is never persisted", () => {
    // Persisting it would reopen the drawer over the page on the next visit.
    useUiStore.getState().setMobileNavOpen(true);

    const state = persisted();
    expect(state).not.toBeNull();
    expect(state).toEqual({ sidebarCollapsed: false });
    expect(state && "mobileNavOpen" in state).toBe(false);
  });
});

describe("hydration", () => {
  it("keeps the server's defaults until rehydrate is called", async () => {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ state: { sidebarCollapsed: true }, version: 0 }),
    );

    // `skipHydration` is what keeps the first client render identical to the
    // server's; reading localStorage at import time is the mismatch.
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);

    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it("does not resurrect a mobileNavOpen left in storage by an older build", async () => {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        state: { sidebarCollapsed: true, mobileNavOpen: true },
        version: 0,
      }),
    );

    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });

  it("ignores a stored value of the wrong type", async () => {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ state: { sidebarCollapsed: "yes" }, version: 0 }),
    );

    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });
});
