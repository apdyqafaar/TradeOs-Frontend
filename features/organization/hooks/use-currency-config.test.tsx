import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/features/auth/hooks/use-session";
import { authKeys } from "@/features/auth/keys";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";
import { organizationKeys } from "@/features/organization/keys";
import type { CurrencyConfig } from "@/features/organization/types";

// A cache miss must not reach axios; the never-resolving promise is also what
// the "still loading" case stands on.
vi.mock("@/features/organization/services/organization.service", () => ({
  getCurrencyConfig: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock("@/features/auth/services/auth.service", () => ({
  getSession: vi.fn(() => new Promise<never>(() => {})),
}));

const SESSION: SessionData = {
  user: {
    id: "u1",
    name: "Amina",
    email: "a@example.com",
    emailVerified: true,
  },
  organization: {
    id: "o1",
    name: "Amina Traders",
    slug: "amina-traders",
    timezone: "Africa/Nairobi",
  },
  role: { id: "r1", name: "Owner" },
  permissions: [],
  twoFactorEnabled: false,
};

const config = (overrides: Partial<CurrencyConfig> = {}): CurrencyConfig => ({
  mainCurrency: "KES",
  exchangeCurrency: "USD",
  exchangeRate: 130,
  updatedAt: "2026-09-07T10:00:00.000Z",
  ...overrides,
});

function wrapperWith(
  seed?: CurrencyConfig,
  session: SessionData | null = SESSION,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  if (session) queryClient.setQueryData(authKeys.session(), session);
  if (seed) queryClient.setQueryData(organizationKeys.currency(), seed);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useCurrencyConfig", () => {
  it("exposes the rate the counter needs, in the backend's direction", () => {
    const { result } = renderHook(() => useCurrencyConfig(), {
      wrapper: wrapperWith(config()),
    });

    expect(result.current.mainCurrency).toBe("KES");
    expect(result.current.exchangeCurrency).toBe("USD");
    // Units of MAIN per one unit of EXCHANGE: one dollar is 130 shillings.
    expect(result.current.exchangeRate).toBe(130);
    expect(result.current.hasExchange).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("offers no second currency when a business picked the same code twice", () => {
    // Neither `createOrganizationSchema` nor this repo's own schema compares
    // the two codes, so this configuration is reachable. Without the guard the
    // counter renders a `USD | USD` toggle and `1 USD = 1 USD`.
    const { result } = renderHook(() => useCurrencyConfig(), {
      wrapper: wrapperWith(
        config({
          mainCurrency: "USD",
          exchangeCurrency: "USD",
          exchangeRate: 1,
        }),
      ),
    });

    expect(result.current.hasExchange).toBe(false);
    // The codes themselves still resolve — only the offer is withheld.
    expect(result.current.mainCurrency).toBe("USD");
  });

  it("offers no second currency for a rate that could never price a bill", () => {
    const { result } = renderHook(() => useCurrencyConfig(), {
      wrapper: wrapperWith(config({ exchangeRate: 0 })),
    });

    expect(result.current.hasExchange).toBe(false);
  });

  it("is loading, and offers nothing, until the config arrives", () => {
    const { result } = renderHook(() => useCurrencyConfig(), {
      wrapper: wrapperWith(undefined),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasExchange).toBe(false);
    // Empty rather than a plausible default — the same rule `useOrganization`
    // follows, so a value escaping an `isLoading` guard reads as incomplete
    // instead of as somebody else's currency.
    expect(result.current.mainCurrency).toBe("");
  });

  it("does not sit loading for ever for somebody still in onboarding", () => {
    // No organization means the query is disabled, and a disabled query is
    // `isPending` for ever in React Query v5.
    const { result } = renderHook(() => useCurrencyConfig(), {
      wrapper: wrapperWith(undefined, {
        ...SESSION,
        organization: null,
      } as unknown as SessionData),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasExchange).toBe(false);
  });
});
