import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt } from "@/features/debts/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { WriteOffDialog } from "./write-off-dialog";

const writeOff = vi.fn();
vi.mock("@/features/debts/hooks/use-debt-mutations", () => ({
  useWriteOffDebt: () => writeOff(),
}));

const debt: Debt = {
  id: "d1",
  customerId: "cu1",
  source: "manual",
  description: "Two sacks of maize",
  principal: 223.75,
  paid: 56,
  remaining: 167.75,
  dueDate: "2026-09-21T09:00:00.000Z",
  status: "open",
  writtenOffAmount: 0,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  isOverdue: false,
  daysOverdue: 0,
};

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mutate.mockReset();
  writeOff.mockReturnValue({ mutate, isPending: false, reset: vi.fn() });
});

const open = () => ({
  open: true,
  onOpenChange: vi.fn(),
  debt,
  currency: "USD",
});

describe("WriteOffDialog", () => {
  it("names the amount in the headline, with the currency code", () => {
    // This is the last screen before an irreversible write, so the number is
    // the question rather than a detail in the body.
    render(<WriteOffDialog {...open()} />);

    expect(
      screen.getByRole("heading", { name: "Write off USD 167.75?" }),
    ).toBeInTheDocument();
  });

  it("will not write anything off without a reason", async () => {
    render(<WriteOffDialog {...open()} />);

    await userEvent.click(screen.getByRole("button", { name: /^write off$/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /say why this debt is being written off/i,
    );
  });

  it("sends only the reason — the amount is the server's to decide", async () => {
    // `writeOffDebtById` sets `writtenOffAmount` from the live `$remaining`
    // inside an aggregation-pipeline update, so there is no amount for this
    // form to propose and the body is `.strict()`.
    render(<WriteOffDialog {...open()} />);

    await userEvent.type(
      screen.getByLabelText(/reason/i),
      "Customer closed the shop",
    );
    await userEvent.click(screen.getByRole("button", { name: /^write off$/i }));

    expect(mutate).toHaveBeenCalledWith(
      { debtId: "d1", input: { reason: "Customer closed the shop" } },
      expect.anything(),
    );
  });

  it("reads DEBT_NOT_OPEN as 'nothing left to write off', not the payment path's wording", async () => {
    // 409 DEBT_NOT_OPEN comes back from both endpoints with the identical
    // message "Debt is not open". Here the guard is `status: "open"` AND
    // `remaining > 0`, so a fully-paid debt lands in this branch too.
    const onStale = vi.fn();
    mutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Debt is not open",
          status: 409,
          code: API_ERROR_CODE.DEBT_NOT_OPEN,
        }),
      );
    });
    render(<WriteOffDialog {...open()} onStale={onStale} />);

    await userEvent.type(screen.getByLabelText(/reason/i), "Unrecoverable");
    await userEvent.click(screen.getByRole("button", { name: /^write off$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /nothing left to write off/i,
    );
    expect(onStale).toHaveBeenCalled();
  });

  it("puts a field refusal on the reason box rather than in a banner", async () => {
    mutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Validation failed",
          status: 422,
          code: API_ERROR_CODE.VALIDATION_ERROR,
          fieldErrors: { reason: "That reason is too long" },
        }),
      );
    });
    render(<WriteOffDialog {...open()} />);

    await userEvent.type(screen.getByLabelText(/reason/i), "Unrecoverable");
    await userEvent.click(screen.getByRole("button", { name: /^write off$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That reason is too long",
    );
    expect(screen.getByLabelText(/reason/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
