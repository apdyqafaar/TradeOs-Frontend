import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/features/sales/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { VoidSaleDialog } from "./void-sale-dialog";

const mutate = vi.fn();
vi.mock("@/features/sales/hooks/use-sale-mutations", () => ({
  useVoidSale: () => ({
    mutate,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

const sale = {
  id: "s1",
  number: "S-000129",
  debtId: "d1",
} as Sale;

const onOpenChange = vi.fn();

const open = () =>
  render(<VoidSaleDialog open onOpenChange={onOpenChange} sale={sale} />);

/** Makes the next `mutate` answer with a given failure, as the hook would. */
const refuse = (code: string, message: string, status = 409) => {
  mutate.mockImplementation(
    (_variables: unknown, options: { onError: (error: ApiError) => void }) => {
      options.onError(new ApiError({ message, status, code }));
    },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mutate.mockImplementation(() => undefined);
});

describe("VoidSaleDialog", () => {
  it("will not send a void with no reason", async () => {
    // `reason` is `min(1)` and an empty one is a 422 (`void.test.ts:155-161`).
    // A void restores stock and cancels a debt; the reason is the audit trail,
    // so it is refused here rather than after a round trip.
    open();
    await userEvent.click(screen.getByRole("button", { name: /void sale/i }));

    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason with the sale's id", async () => {
    open();
    await userEvent.type(
      screen.getByLabelText(/reason/i),
      "  Duplicate scan  ",
    );
    await userEvent.click(screen.getByRole("button", { name: /void sale/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "s1", input: { reason: "Duplicate scan" } },
      expect.anything(),
    );
  });

  it("explains DEBT_HAS_PAYMENTS in the dialog and keeps it open", async () => {
    // The 409 the canvas puts on the Void button as a tooltip. It is checked
    // server-side *before* stock moves, so the copy can promise nothing
    // changed — and it belongs where the action was taken, not in a toast the
    // reader has to catch.
    refuse(API_ERROR_CODE.DEBT_HAS_PAYMENTS, "Debt has payments");
    open();
    await userEvent.type(screen.getByLabelText(/reason/i), "Wrong customer");
    await userEvent.click(screen.getByRole("button", { name: /void sale/i }));

    expect(
      await screen.findByText(/payment has already been taken/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing was changed/i)).toBeInTheDocument();
    // Still open: the reader has a decision to make about the debt, and
    // closing would take the explanation with it.
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("explains a second void attempt rather than offering a retry", async () => {
    // A sale can be voided at most once, races included.
    refuse(API_ERROR_CODE.SALE_ALREADY_VOIDED, "Sale already voided");
    open();
    await userEvent.type(screen.getByLabelText(/reason/i), "Duplicate scan");
    await userEvent.click(screen.getByRole("button", { name: /void sale/i }));

    expect(await screen.findByText(/already been voided/i)).toBeInTheDocument();
  });

  it("shows a 422's own message for the reason field", async () => {
    mutate.mockImplementation(
      (
        _variables: unknown,
        options: { onError: (error: ApiError) => void },
      ) => {
        options.onError(
          new ApiError({
            message: "Validation failed",
            status: 422,
            code: API_ERROR_CODE.VALIDATION_ERROR,
            fieldErrors: { reason: "Keep the reason under 500 characters" },
          }),
        );
      },
    );

    open();
    await userEvent.type(screen.getByLabelText(/reason/i), "Too long");
    await userEvent.click(screen.getByRole("button", { name: /void sale/i }));

    expect(
      await screen.findByText(/under 500 characters/i),
    ).toBeInTheDocument();
  });

  it("closes only when the void actually lands", async () => {
    mutate.mockImplementation(
      (_variables: unknown, options: { onSuccess: () => void }) => {
        options.onSuccess();
      },
    );

    open();
    await userEvent.type(screen.getByLabelText(/reason/i), "Duplicate scan");
    await userEvent.click(screen.getByRole("button", { name: /void sale/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
