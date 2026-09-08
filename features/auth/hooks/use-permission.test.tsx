import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCan, usePermissions } from "@/features/auth/hooks/use-permission";
import type { SessionData } from "@/features/auth/hooks/use-session";
import { authKeys } from "@/features/auth/keys";
import { PERMISSIONS, PRESET_SELLER } from "@/lib/auth/permissions";

// A cache miss must not reach axios. The never-resolving promise is also what
// the "still loading" case below is standing on.
vi.mock("@/features/auth/services/auth.service", () => ({
  getSession: vi.fn(() => new Promise<never>(() => {})),
}));

const session = (permissions: string[]): SessionData => ({
  user: {
    id: "u1",
    name: "Amina",
    email: "amina@example.com",
    emailVerified: true,
  },
  organization: {
    id: "o1",
    name: "Amina Traders",
    slug: "amina-traders",
    timezone: "Africa/Nairobi",
  },
  role: { id: "r1", name: "Owner" },
  permissions,
  twoFactorEnabled: false,
});

function makeWrapper(seed?: SessionData) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  if (seed) queryClient.setQueryData(authKeys.session(), seed);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useCan — an Owner holding the wildcard", () => {
  const wrapper = makeWrapper(session(["*"]));

  it("holds every permission, including ones this build predates", () => {
    // The Owner preset is `["*"]` so a permission a later backend phase adds
    // reaches owners without a migration; the mirror in lib/auth/permissions.ts
    // has to honour that.
    const { result } = renderHook(() => useCan(PERMISSIONS.SALES_VOID), {
      wrapper,
    });
    expect(result.current).toBe(true);
  });

  it("holds several at once", () => {
    const { result } = renderHook(
      () =>
        useCan(
          PERMISSIONS.SALES_VOID,
          PERMISSIONS.DEBTS_WRITE_OFF,
          PERMISSIONS.ROLES_DELETE,
        ),
      { wrapper },
    );
    expect(result.current).toBe(true);
  });
});

describe("useCan — a Seller", () => {
  const wrapper = makeWrapper(session([...PRESET_SELLER]));

  it("can create a sale", () => {
    const { result } = renderHook(() => useCan(PERMISSIONS.SALES_CREATE), {
      wrapper,
    });
    expect(result.current).toBe(true);
  });

  it("cannot void one", () => {
    const { result } = renderHook(() => useCan(PERMISSIONS.SALES_VOID), {
      wrapper,
    });
    expect(result.current).toBe(false);
  });

  it("needs ALL of several, not any", () => {
    const { result } = renderHook(
      () => useCan(PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_VOID),
      { wrapper },
    );
    expect(result.current).toBe(false);
  });

  it("holds members:view, which is why it is the wrong gate for the Members page", () => {
    const { result } = renderHook(
      () =>
        [
          useCan(PERMISSIONS.MEMBERS_VIEW),
          useCan(PERMISSIONS.MEMBERS_INVITE),
        ] as const,
      { wrapper },
    );
    expect(result.current).toEqual([true, false]);
  });
});

describe("useCan — while the session is loading", () => {
  it("is false, so a control never flashes into view before being taken away", () => {
    const { result } = renderHook(() => useCan(PERMISSIONS.PRODUCTS_VIEW), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toBe(false);
  });
});

describe("usePermissions", () => {
  it("returns the granted list once the session is there", () => {
    const { result } = renderHook(() => usePermissions(), {
      wrapper: makeWrapper(session(["products:view", "sales:create"])),
    });
    expect(result.current).toEqual(["products:view", "sales:create"]);
  });

  it("returns an empty list while loading rather than undefined", () => {
    const { result } = renderHook(() => usePermissions(), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([]);
  });
});
