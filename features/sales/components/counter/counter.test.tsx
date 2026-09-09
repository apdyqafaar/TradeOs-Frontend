import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/features/auth/hooks/use-session";
import { authKeys } from "@/features/auth/keys";
import { useCustomers } from "@/features/customers/hooks/use-customers";
import type { Customer } from "@/features/customers/types";
import { organizationKeys } from "@/features/organization/keys";
import { useProducts } from "@/features/products/hooks/use-products";
import type { Product } from "@/features/products/types";
import { Counter } from "@/features/sales/components/counter/counter";
import type { CreateSaleInput } from "@/features/sales/schemas/sale.schema";
import * as saleService from "@/features/sales/services/sale.service";
import { useCartStore } from "@/features/sales/store/cart";
import type { Sale } from "@/features/sales/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("@/features/products/hooks/use-products", () => ({
  useProducts: vi.fn(),
}));
vi.mock("@/features/categories/hooks/use-categories", () => ({
  useCategories: vi.fn(() => ({ data: [], isPending: false })),
}));
vi.mock("@/features/customers/hooks/use-customers", () => ({
  useCustomers: vi.fn(),
}));
vi.mock("@/features/sales/services/sale.service", () => ({ create: vi.fn() }));
// Both seeded into the cache below; neither service may be reached.
vi.mock("@/features/auth/services/auth.service", () => ({
  getSession: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock("@/features/organization/services/organization.service", () => ({
  getCurrencyConfig: vi.fn(() => new Promise<never>(() => {})),
}));

const rice: Product = {
  id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Basmati rice",
  category: { id: "c1", name: "Food" },
  unit: "kg",
  costPrice: 3,
  sellingPrice: 10,
  trackStock: true,
  quantity: 40,
  images: [],
  status: "active",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

const delivery: Product = {
  ...rice,
  id: "aaaaaaaaaaaaaaaaaaaaaaa2",
  name: "Delivery",
  unit: "job",
  sellingPrice: 5,
  // A service: no stock at all, so a quantity of zero is perfectly sellable.
  trackStock: false,
  quantity: 0,
};

const sugar: Product = {
  ...rice,
  id: "aaaaaaaaaaaaaaaaaaaaaaa3",
  name: "Sugar",
  quantity: 0,
};

const mwangi: Customer = {
  id: "cccccccccccccccccccccc01",
  name: "Mwangi Stores",
  phone: "+254712445900",
  status: "active",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

const TIMEZONE = "Africa/Nairobi";

/** A month out, computed rather than written down, so this never expires. */
const FUTURE = new Date(Date.now() + 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function session(permissions: string[]): SessionData {
  return {
    user: {
      id: "u1",
      name: "Amina Mohamed",
      email: "a@example.com",
      emailVerified: true,
    },
    organization: {
      id: "o1",
      name: "Amina Traders",
      slug: "amina-traders",
      timezone: TIMEZONE,
    },
    role: { id: "r1", name: "Seller" },
    permissions,
    twoFactorEnabled: false,
  } as SessionData;
}

const productsAnswer = (items: Product[]) =>
  ({
    data: { items, meta: { page: 1, limit: 12, total: items.length } },
    error: null,
    isPending: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  }) as unknown as ReturnType<typeof useProducts>;

const customersAnswer = (items: Customer[]) =>
  ({
    data: { items, meta: {} },
    error: null,
    isPending: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  }) as unknown as ReturnType<typeof useCustomers>;

function mount(
  ui: ReactNode,
  // The Seller preset, which is who stands at a counter.
  permissions: string[] = [
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
  ],
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(authKeys.session(), session(permissions));
  queryClient.setQueryData(organizationKeys.currency(), {
    mainCurrency: "USD",
    exchangeCurrency: "KES",
    exchangeRate: 0.0077,
    updatedAt: "2026-09-01T08:00:00.000Z",
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** The 201 body is `publicSale`, byte-identical to what `GET /sales/:id` answers. */
const recorded = (over: Partial<Sale> = {}): Sale =>
  ({
    id: "s1",
    number: "S-000123",
    items: [],
    subtotal: 20,
    discount: 0,
    total: 20,
    payment: {
      currency: "USD",
      exchangeRate: 1,
      amountTendered: 20,
      amountPaidMain: 20,
      change: 0,
      amountDue: 0,
    },
    paymentStatus: "paid",
    status: "completed",
    soldBy: "m1",
    createdAt: "2026-09-09T11:32:00.000Z",
    updatedAt: "2026-09-09T11:32:00.000Z",
    ...over,
  }) as Sale;

const tenderBox = () => screen.getByLabelText("Amount tendered");
const submit = () => screen.getByRole("button", { name: /^complete/i });

/** Two of rice: USD 20.00 owed. */
async function ringUpTwoRice() {
  await userEvent.click(screen.getByRole("button", { name: /basmati rice/i }));
  await userEvent.click(screen.getByRole("button", { name: /one more/i }));
}

beforeEach(() => {
  useCartStore.getState().clear();
  vi.mocked(useProducts).mockReturnValue(
    productsAnswer([rice, delivery, sugar]),
  );
  vi.mocked(useCustomers).mockReturnValue(customersAnswer([mwangi]));
  vi.mocked(saleService.create).mockReset();
});

describe("Counter — the catalogue", () => {
  it("rings a product up and totals it from the store", async () => {
    mount(<Counter />);
    await ringUpTwoRice();

    expect(screen.getByText("Cart · 1 line")).toBeInTheDocument();
    // 10.00 x 2, in the business's MAIN currency and rendered as a code.
    expect(screen.getAllByText("USD 20.00").length).toBeGreaterThan(0);
  });

  it("will not let an out-of-stock product be rung up at all", () => {
    // The guarded decrement makes oversell impossible server-side, so the tile
    // would only be a 409 at the end of the sale. Better refused at the shelf.
    mount(<Counter />);
    expect(screen.getByRole("button", { name: /sugar/i })).toBeDisabled();
  });

  it("still sells a service with no stock", () => {
    // `trackStock: false` means no stock at all, not a stock of zero — a
    // delivery fee sitting at 0 is perfectly sellable.
    mount(<Counter />);
    expect(screen.getByRole("button", { name: /delivery/i })).toBeEnabled();
  });
});

describe("Counter — what it refuses to send", () => {
  it("refuses an empty amount tendered rather than assuming 'paid in full'", async () => {
    // `amountTendered` has no server-side default, and an omitted one is a 422
    // (`docs/contracts/sales.md` trap 7).
    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.click(submit());

    expect(screen.getByText(/enter the amount tendered/i)).toBeInTheDocument();
    expect(saleService.create).not.toHaveBeenCalled();
  });

  it("refuses a credit sale with no customer and no due date, without a round trip", async () => {
    // Both are 422s keyed `customerId` and `dueDate`, and both are knowable
    // here — so the answer arrives while the cashier is still looking at it.
    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "5");
    await userEvent.click(submit());

    expect(screen.getByText(/choose the customer/i)).toBeInTheDocument();
    expect(
      screen.getByText(/set the day this balance is due/i),
    ).toBeInTheDocument();
    expect(saleService.create).not.toHaveBeenCalled();
  });

  it("refuses a due date before today in the BUSINESS's timezone", async () => {
    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "5");

    await userEvent.click(screen.getByRole("option", { name: /Mwangi/ }));
    await userEvent.type(screen.getByLabelText("Due date"), "2020-01-01");
    await userEvent.click(submit());

    expect(screen.getByText(/can't be before today/i)).toBeInTheDocument();
    expect(saleService.create).not.toHaveBeenCalled();
  });

  it("shows no submit at all to a role without sales:create", async () => {
    // The repo hides a control rather than disabling one, and `POST /sales`
    // would answer 403 for certain.
    mount(<Counter />, [PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.CUSTOMERS_VIEW]);
    await ringUpTwoRice();

    expect(screen.queryByRole("button", { name: /^complete/i })).toBeNull();
  });

  it("explains the dead end for a role that cannot look a customer up", async () => {
    // `CustomerPicker` renders nothing without `customers:view`, so the credit
    // path is gated here instead of leaving an unfillable form.
    mount(<Counter />, [PERMISSIONS.SALES_CREATE, PERMISSIONS.PRODUCTS_VIEW]);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "5");
    await userEvent.click(submit());

    expect(screen.getByText(/can't look customers up/i)).toBeInTheDocument();
    expect(saleService.create).not.toHaveBeenCalled();
  });
});

describe("Counter — the credit block", () => {
  it("stays hidden until a tender actually leaves a balance", async () => {
    mount(<Counter />);
    await ringUpTwoRice();
    // Every untouched sale owes its whole total; opening the debt form on the
    // first scan would make the exceptional case the default one.
    expect(screen.queryByLabelText("Due date")).toBeNull();

    await userEvent.type(tenderBox(), "5");
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
    expect(
      screen.getByText(/a balance turns this into a debt/i),
    ).toBeInTheDocument();
  });

  it("closes again once the tender covers the bill", async () => {
    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "5");
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();

    await userEvent.clear(tenderBox());
    await userEvent.type(tenderBox(), "20");
    expect(screen.queryByLabelText("Due date")).toBeNull();
  });

  it("sends dueDate with a Z suffix, on the day that was picked", async () => {
    // Three traps in one field: a bare `YYYY-MM-DD` is a 422; midnight UTC is
    // yesterday for a business west of Greenwich; and `TZDate.toISOString()`
    // emits `+03:00`, which Zod's `datetime()` refuses exactly as it refuses
    // the bare date. Noon in the shop's own zone, serialised through a plain
    // `Date`, is the only spelling that satisfies all three.
    vi.mocked(saleService.create).mockResolvedValue(
      recorded({ paymentStatus: "partial", debtId: "d1" }),
    );

    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "5");
    await userEvent.click(screen.getByRole("option", { name: /Mwangi/ }));
    await userEvent.type(screen.getByLabelText("Due date"), FUTURE);
    await userEvent.type(screen.getByLabelText(/note/i), "Pays on delivery");
    await userEvent.click(submit());

    await waitFor(() => expect(saleService.create).toHaveBeenCalled());
    const body = vi.mocked(saleService.create).mock
      .calls[0][0] as CreateSaleInput;

    expect(body.dueDate?.endsWith("Z")).toBe(true);
    expect(body.dueDate?.startsWith(FUTURE)).toBe(true);
    expect(body).toMatchObject({
      customerId: mwangi.id,
      note: "Pays on delivery",
      payment: { currency: "USD", amountTendered: 5 },
      // `unitPrice` omitted because it still equals the product's selling
      // price, and `discount` omitted because it is zero — both are what
      // `buildSalePayload` exists to leave off a `.strict()` body.
      items: [{ productId: rice.id, quantity: 2 }],
    });
  });

  it("does not send a due date on a sale that is paid in full", async () => {
    // The server never reads it there, and a date left in the box from before
    // a larger tender was typed would ride along meaning nothing.
    vi.mocked(saleService.create).mockResolvedValue(recorded());

    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "5");
    await userEvent.type(screen.getByLabelText("Due date"), FUTURE);
    await userEvent.clear(tenderBox());
    await userEvent.type(tenderBox(), "20");
    await userEvent.click(submit());

    await waitFor(() => expect(saleService.create).toHaveBeenCalled());
    const body = vi.mocked(saleService.create).mock
      .calls[0][0] as CreateSaleInput;
    expect(body.dueDate).toBeUndefined();
  });
});

describe("Counter — what the server refuses", () => {
  it("puts a 409 INSUFFICIENT_STOCK on the cart line it names", async () => {
    // The artboard puts it on the offending row, not in a toast: the `details`
    // carry the `productId`, and the fix is the stepper on that row.
    vi.mocked(saleService.create).mockRejectedValue(
      new ApiError({
        message: "Insufficient stock",
        status: 409,
        code: API_ERROR_CODE.INSUFFICIENT_STOCK,
        details: { productId: rice.id, requested: 2, available: 1 },
      }),
    );

    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "20");
    await userEvent.click(submit());

    const message = await screen.findByText(
      /only 1 kg in stock, and this line asks for 2 kg/i,
    );
    // On the row, and not in a card over the submit.
    expect(message).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reopens the credit block for a 422 the client thought could not happen", async () => {
    // The two can genuinely disagree: an omitted `unitPrice` is substituted
    // from the product's price at COMMIT time, so a price edited in another tab
    // makes the server's total larger than the one on screen and turns a sale
    // this screen called settled into one that owes money. The client's copy of
    // the rule saves a round trip; `createDebtForSale` is the authority.
    vi.mocked(saleService.create).mockRejectedValue(
      new ApiError({
        message: "Validation failed",
        status: 422,
        code: API_ERROR_CODE.VALIDATION_ERROR,
        fieldErrors: { dueDate: "Due date cannot be in the past" },
      }),
    );

    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "20");
    await userEvent.click(submit());

    expect(
      await screen.findByText("Due date cannot be in the past"),
    ).toBeInTheDocument();
    // And the field it names is on screen to be fixed.
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
  });

  it("falls back to an error card, with the request id, for a failure it cannot place", async () => {
    vi.mocked(saleService.create).mockRejectedValue(
      new ApiError({
        message: "Something went wrong",
        status: 500,
        code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
        requestId: "req_abc",
      }),
    );

    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "20");
    await userEvent.click(submit());

    const card = await screen.findByRole("alert");
    expect(within(card).getByText(/request id: req_abc/i)).toBeInTheDocument();
  });
});

describe("Counter — after the sale", () => {
  it("prints the receipt number, empties the cart and stays at the till", async () => {
    // A counter is used all day and the next customer is already waiting, so
    // nothing navigates: the receipt is one deliberate tap away, off a cache
    // `useCreateSale` already seeded with the 201 body.
    vi.mocked(saleService.create).mockResolvedValue(
      recorded({ payment: { ...recorded().payment, change: 5 } }),
    );

    mount(<Counter />);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "25");
    await userEvent.click(submit());

    expect(
      await screen.findByText("Sale S-000123 recorded"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cart · 0 lines")).toBeInTheDocument();
    expect(useCartStore.getState().lines).toEqual([]);
    expect(screen.getByRole("link", { name: /receipt/i })).toHaveAttribute(
      "href",
      "/sales/s1",
    );
  });

  it("offers no receipt link to a role that may not read one", async () => {
    // `/sales/<id>` inherits the `/sales` row by longest-prefix matching, so a
    // role holding `sales:create` without `sales:view` would land on a refusal.
    vi.mocked(saleService.create).mockResolvedValue(recorded());

    mount(<Counter />, [PERMISSIONS.SALES_CREATE, PERMISSIONS.PRODUCTS_VIEW]);
    await ringUpTwoRice();
    await userEvent.type(tenderBox(), "20");
    await userEvent.click(submit());

    expect(
      await screen.findByText("Sale S-000123 recorded"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /receipt/i })).toBeNull();
  });

  it("labels the submit by what the sale will become", async () => {
    mount(<Counter />);
    await ringUpTwoRice();

    // Nothing tendered yet: the whole bill is on credit.
    expect(submit()).toHaveTextContent("Complete · credit");

    await userEvent.type(tenderBox(), "5");
    expect(submit()).toHaveTextContent("Complete · partial");

    await userEvent.clear(tenderBox());
    await userEvent.type(tenderBox(), "20");
    expect(submit()).toHaveTextContent("Complete sale");
  });
});
