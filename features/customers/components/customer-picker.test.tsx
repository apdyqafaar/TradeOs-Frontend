import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/features/auth/hooks/use-session";
import { authKeys } from "@/features/auth/keys";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import { useCustomers } from "@/features/customers/hooks/use-customers";
import type { Customer } from "@/features/customers/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("@/features/customers/hooks/use-customers", () => ({
  useCustomers: vi.fn(),
}));
// `useCan` reads the seeded session below; the service must never be reached.
vi.mock("@/features/auth/services/auth.service", () => ({
  getSession: vi.fn(() => new Promise<never>(() => {})),
}));

const mwangi: Customer = {
  id: "cu1",
  name: "Mwangi Stores",
  phone: "+254712445900",
  status: "active",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

const faisal: Customer = {
  ...mwangi,
  id: "cu2",
  name: "Faisal Traders",
  phone: "+252612207781",
};

type CustomersResult = ReturnType<typeof useCustomers>;

/** Only the four fields the picker reads; the rest of the query result is not
 *  what any of this is about. */
function answer(over: {
  items?: Customer[];
  isPending?: boolean;
  error?: ApiError | null;
}): CustomersResult {
  const { items, isPending = false, error = null } = over;
  return {
    data: items === undefined ? undefined : { items, meta: {} },
    error,
    isPending,
    isPlaceholderData: false,
    refetch: vi.fn(),
  } as unknown as CustomersResult;
}

function session(permissions: string[]): SessionData {
  return {
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
    role: { id: "r1", name: "Seller" },
    permissions,
    twoFactorEnabled: false,
  } as SessionData;
}

/** Controlled the way the counter holds it — the picker never stores a row. */
function Harness({
  initial = null,
  onChange,
}: {
  initial?: Customer | null;
  onChange?: (customer: Customer) => void;
}) {
  const [value, setValue] = useState<Customer | null>(initial);
  return (
    <CustomerPicker
      value={value}
      onChange={(customer) => {
        setValue(customer);
        onChange?.(customer);
      }}
    />
  );
}

function mount(
  ui: ReactNode,
  permissions: string[] = [PERMISSIONS.CUSTOMERS_VIEW],
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(authKeys.session(), session(permissions));
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useCustomers).mockReturnValue(answer({ items: [mwangi, faisal] }));
});

describe("CustomerPicker — permission", () => {
  it("renders nothing at all for a role without customers:view", () => {
    // CLAUDE.md: a user without the permission sees nothing, not a disabled
    // control. The screen that needs a customer gates its own path.
    const { container } = mount(<Harness />, []);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CustomerPicker — chosen", () => {
  it("shows the name over the phone with a Change affordance", () => {
    mount(<Harness initial={mwangi} />);

    // Artboard `2a` draws exactly these three things.
    expect(screen.getByText("Mwangi Stores")).toBeInTheDocument();
    expect(screen.getByText("+254712445900")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
    // Nothing is being searched, so there is no box to type in.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("goes back to searching, and hands over the whole row", async () => {
    const onChange = vi.fn();
    mount(<Harness initial={mwangi} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /change/i }));
    await userEvent.click(screen.getByRole("option", { name: /Faisal/ }));

    // A row, not an id: a caller that needs the name or the phone must not
    // have to re-fetch a customer it was just handed.
    expect(onChange).toHaveBeenCalledWith(faisal);
    expect(screen.getByText("Faisal Traders")).toBeInTheDocument();
  });
});

describe("CustomerPicker — searching", () => {
  it("is operable by keyboard alone", async () => {
    const onChange = vi.fn();
    mount(<Harness onChange={onChange} />);

    const input = screen.getByRole("combobox");
    input.focus();
    // Focus stays in the box and `aria-activedescendant` names the row, so the
    // arrow keys never take the caret out of the text being typed.
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /Faisal/ }).id,
    );

    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(faisal);
  });

  it("wraps the highlight rather than stopping at the end", async () => {
    mount(<Harness />);

    const input = screen.getByRole("combobox");
    input.focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /Faisal/ }).id,
    );
  });

  it("says it is working rather than showing an empty list", () => {
    vi.mocked(useCustomers).mockReturnValue(answer({ isPending: true }));
    mount(<Harness />);

    expect(screen.getByText("Searching customers")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("explains a prefix search when nothing matches", async () => {
    vi.mocked(useCustomers).mockReturnValue(answer({ items: [] }));
    mount(<Harness />);

    await userEvent.type(screen.getByRole("combobox"), "wholesale");

    // The backend matches `^term`, so "wholesale" finds nothing for "Bakaara
    // Wholesale" and the recovery is fewer characters, not a new spelling.
    expect(screen.getByText(/try fewer characters/i)).toBeInTheDocument();
  });

  it("carries the request id when the lookup fails", () => {
    vi.mocked(useCustomers).mockReturnValue(
      answer({
        error: new ApiError({
          message: "Something went wrong.",
          status: 500,
          code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
          requestId: "req-77",
        }),
      }),
    );
    mount(<Harness />);

    expect(screen.getByRole("alert")).toHaveTextContent("Request ID: req-77");
  });

  it("offers no retry for a 403, which retrying cannot fix", () => {
    vi.mocked(useCustomers).mockReturnValue(
      answer({
        error: new ApiError({
          message: "You do not have permission to do this.",
          status: 403,
          code: "FORBIDDEN",
        }),
      }),
    );
    mount(<Harness />);

    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });
});
