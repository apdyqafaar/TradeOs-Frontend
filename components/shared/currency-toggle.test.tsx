import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CurrencyToggle } from "@/components/shared/currency-toggle";
import type { SessionData } from "@/features/auth/hooks/use-session";
import { authKeys } from "@/features/auth/keys";
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

/** A Kenyan shop keeping books in KES and taking dollars at the counter. */
const config = (overrides: Partial<CurrencyConfig> = {}): CurrencyConfig => ({
  mainCurrency: "KES",
  exchangeCurrency: "USD",
  exchangeRate: 130,
  updatedAt: "2026-09-07T10:00:00.000Z",
  ...overrides,
});

function wrapperWith(seed?: CurrencyConfig) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(authKeys.session(), SESSION);
  if (seed) queryClient.setQueryData(organizationKeys.currency(), seed);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const mount = (
  ui: ReactNode,
  seed: CurrencyConfig | undefined = config(),
): void => {
  const Wrapper = wrapperWith(seed);
  render(<Wrapper>{ui}</Wrapper>);
};

describe("CurrencyToggle", () => {
  it("states the rate in the backend's direction", () => {
    mount(<CurrencyToggle value="KES" onChange={vi.fn()} />);

    /*
     * `exchangeRate` is units of MAIN per one unit of EXCHANGE, so with main
     * KES and exchange USD one dollar is 130 shillings. The inverse reads more
     * naturally out loud, which is exactly how this repo once printed KES 0.77
     * for a KES 13,000 tender.
     */
    expect(screen.getByText("1 USD = 130 KES")).toBeInTheDocument();
  });

  it("keeps a fractional rate readable instead of rounding it to money", () => {
    // The same pair the other way round. `formatMoney` is two decimals, so it
    // would print 0.01 here and state a rate nobody trades at.
    mount(
      <CurrencyToggle value="USD" onChange={vi.fn()} />,
      config({
        mainCurrency: "USD",
        exchangeCurrency: "KES",
        exchangeRate: 0.0077,
      }),
    );

    expect(screen.getByText("1 KES = 0.0077 USD")).toBeInTheDocument();
  });

  it("offers the main currency first and reports the code that was chosen", async () => {
    const onChange = vi.fn();
    mount(<CurrencyToggle value="KES" onChange={onChange} />);

    const options = screen.getAllByRole("radio");
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      "KES",
      "USD",
    ]);
    expect(screen.getByRole("radio", { name: "KES" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "USD" }));
    expect(onChange).toHaveBeenCalledWith("USD");
  });

  it("is operable from the keyboard", async () => {
    const onChange = vi.fn();
    mount(<CurrencyToggle value="KES" onChange={onChange} />);

    // Real radios, so the group is one tab stop and each option has a name —
    // the reason this is not two buttons with `aria-pressed`.
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "KES" })).toHaveFocus();

    screen.getByRole("radio", { name: "USD" }).focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith("USD");
  });

  it("renders nothing when a business picked the same code twice", () => {
    // Nothing in either repo forbids it, and the alternative is a `USD | USD`
    // control above a line reading `1 USD = 1 USD`.
    const { container } = renderWith(
      config({ mainCurrency: "USD", exchangeCurrency: "USD", exchangeRate: 1 }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a rate that could never price a bill", () => {
    const { container } = renderWith(config({ exchangeRate: 0 }));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing until the config arrives, so there is no half-toggle", () => {
    const { container } = renderWith(undefined);
    expect(container).toBeEmptyDOMElement();
  });
});

/** Mounts with a seed and hands back the container, for the absent cases. */
function renderWith(seed: CurrencyConfig | undefined) {
  const Wrapper = wrapperWith(seed);
  return render(
    <Wrapper>
      <CurrencyToggle value="USD" onChange={vi.fn()} />
    </Wrapper>,
  );
}
