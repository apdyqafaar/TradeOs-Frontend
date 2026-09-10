import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomers } from "@/features/customers/hooks/use-customers";
import type { Customer } from "@/features/customers/types";
import type { CreateDebtInput } from "@/features/debts/schemas/debt.schema";
import type { Debt } from "@/features/debts/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { DebtForm } from "./debt-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mutate = vi.fn();
vi.mock("@/features/debts/hooks/use-debt-mutations", () => ({
  useCreateDebt: () => ({ mutate, isPending: false }),
}));

/**
 * Nairobi, UTC+3 **year-round** — which is what makes the noon assertion below
 * an exact string rather than a range. A zone with DST would move the `Z` hour
 * between June and December and turn that test into a seasonal flake.
 */
const TIMEZONE = "Africa/Nairobi";

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "KES",
    timezone: TIMEZONE,
    isLoading: false,
  }),
}));

// Both this form and `CustomerPicker` read it; every test here holds the two
// permissions this screen needs, and the one that does not overrides it.
const can = vi.fn(() => true);
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => can(),
}));

vi.mock("@/features/customers/hooks/use-customers", () => ({
  useCustomers: vi.fn(),
}));

const mwangi: Customer = {
  id: "cccccccccccccccccccccc01",
  name: "Mwangi Stores",
  phone: "+254712445900",
  status: "active",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

/** A month out, computed rather than written down, so this never expires. */
const FUTURE = new Date(Date.now() + 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);

const created: Debt = {
  id: "dddddddddddddddddddddd01",
  customerId: mwangi.id,
  source: "manual",
  description: "Two sacks of maize",
  principal: 4500,
  paid: 0,
  remaining: 4500,
  dueDate: `${FUTURE}T09:00:00.000Z`,
  status: "open",
  writtenOffAmount: 0,
  createdAt: "2026-09-09T08:00:00.000Z",
  updatedAt: "2026-09-09T08:00:00.000Z",
  isOverdue: false,
  daysOverdue: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  can.mockReturnValue(true);
  vi.mocked(useCustomers).mockReturnValue({
    data: { items: [mwangi], meta: {} },
    error: null,
    isPending: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCustomers>);
});

/** Fill every field with something the API would accept. */
async function fillValidDebt() {
  await userEvent.click(screen.getByRole("option", { name: /Mwangi/ }));
  await userEvent.type(screen.getByLabelText("Amount"), "4500");
  await userEvent.type(screen.getByLabelText("Due date"), FUTURE);
  await userEvent.type(
    screen.getByLabelText(/what this is for/i),
    "Two sacks of maize",
  );
}

const save = () => screen.getByRole("button", { name: /save debt/i });

/** The body handed to `useCreateDebt().mutate`. */
const sentBody = () => mutate.mock.calls[0][0] as CreateDebtInput;

describe("DebtForm", () => {
  it("sends `amount`, and never `principal`", async () => {
    // `principal` is server-set to `round2(amount)` and the body is
    // `.strict()`, so a `principal` key is a 422 rather than a rounding hint.
    render(<DebtForm />);
    await fillValidDebt();
    await userEvent.click(save());

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const body = sentBody();

    expect(body.amount).toBe(4500);
    expect(body).not.toHaveProperty("principal");
    expect(Object.keys(body).sort()).toEqual([
      "amount",
      "customerId",
      "description",
      "dueDate",
    ]);
  });

  it("sends the due date as noon in the BUSINESS's zone, with a Z", async () => {
    // Three traps in one field: a bare `YYYY-MM-DD` is a 422; midnight UTC is
    // yesterday for a business west of Greenwich, which is before the
    // start-of-day the server compares against; and `TZDate.toISOString()`
    // emits `+03:00`, which Zod's `datetime()` refuses exactly as it refuses
    // the bare date. Noon in Nairobi is 09:00Z on the day that was picked.
    render(<DebtForm />);
    await fillValidDebt();
    await userEvent.click(save());

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(sentBody().dueDate).toBe(`${FUTURE}T09:00:00.000Z`);
  });

  it("lands on the new debt rather than back in the list", async () => {
    mutate.mockImplementation((_input, options) => options.onSuccess(created));

    render(<DebtForm />);
    await fillValidDebt();
    await userEvent.click(save());

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/debts/${created.id}`),
    );
  });

  it("puts CUSTOMER_ARCHIVED at the customer control, not in a banner", async () => {
    // The only fix is choosing somebody else — there is no unarchive endpoint
    // in this phase — so the refusal belongs beside the picker.
    mutate.mockImplementation((_input, options) =>
      options.onError(
        new ApiError({
          message: "Customer is archived",
          status: 409,
          code: API_ERROR_CODE.CUSTOMER_ARCHIVED,
        }),
      ),
    );

    render(<DebtForm />);
    await fillValidDebt();
    await userEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /archived, so they can't take on new credit/i,
    );
  });

  it("routes the server's dueDate 422 onto the date field", async () => {
    // The one rule nothing client-side can be the authority on: the server
    // compares against `startOfDayIn(organization.timezone, now)` and answers
    // a field error on `dueDate`.
    mutate.mockImplementation((_input, options) =>
      options.onError(
        new ApiError({
          message: "Validation failed",
          status: 422,
          code: API_ERROR_CODE.VALIDATION_ERROR,
          fieldErrors: { dueDate: "Due date cannot be in the past" },
        }),
      ),
    );

    render(<DebtForm />);
    await fillValidDebt();
    await userEvent.click(save());

    const message = await screen.findByText("Due date cannot be in the past");
    expect(screen.getByLabelText("Due date")).toHaveAttribute(
      "aria-describedby",
      message.id,
    );
  });

  it("refuses a past due date without spending a round trip", async () => {
    render(<DebtForm />);
    await userEvent.click(screen.getByRole("option", { name: /Mwangi/ }));
    await userEvent.type(screen.getByLabelText("Amount"), "4500");
    await userEvent.type(screen.getByLabelText("Due date"), "2020-01-01");
    await userEvent.type(
      screen.getByLabelText(/what this is for/i),
      "Carried over",
    );
    await userEvent.click(save());

    expect(screen.getByText(/can't be before today/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("names every missing field at once, and sends nothing", async () => {
    // `description` is required for a manual debt — the validator requires it
    // unconditionally even though the model makes it conditional.
    render(<DebtForm />);
    await userEvent.click(save());

    expect(screen.getByText(/choose the customer/i)).toBeInTheDocument();
    expect(screen.getByText(/set the day this is due/i)).toBeInTheDocument();
    expect(screen.getByText(/amount is required/i)).toBeInTheDocument();
    expect(screen.getByText(/say what this debt is for/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("explains the dead end for a role that cannot look a customer up", async () => {
    // `CustomerPicker` renders nothing without `customers:view` — the repo
    // hides controls rather than disabling them — so without this sentence the
    // page is an unfillable form with nothing on it to read.
    can.mockReturnValue(false);
    render(<DebtForm />);

    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(save());

    expect(screen.getByText(/can't look customers up/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
