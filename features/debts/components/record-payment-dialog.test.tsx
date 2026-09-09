import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt } from "@/features/debts/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { RecordPaymentDialog } from "./record-payment-dialog";

const recordPayment = vi.fn();
vi.mock("@/features/debts/hooks/use-debt-mutations", () => ({
  useRecordPayment: () => recordPayment(),
}));

const config = vi.fn();
vi.mock("@/features/organization/hooks/use-currency-config", () => ({
  useCurrencyConfig: () => config(),
}));

/** Books in USD, dollars-per-… no: main USD, exchange KES at 0.0078 USD each. */
const singleCurrency = {
  mainCurrency: "USD",
  exchangeCurrency: "USD",
  exchangeRate: 0,
  hasExchange: false,
  isLoading: false,
};

/** A Kenyan shop: books in KES, dollars taken at the counter at 130 KES each. */
const twoCurrencies = {
  mainCurrency: "KES",
  exchangeCurrency: "USD",
  exchangeRate: 130,
  hasExchange: true,
  isLoading: false,
};

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
  recordPayment.mockReturnValue({ mutate, isPending: false, reset: vi.fn() });
  config.mockReturnValue(singleCurrency);
});

const open = () => ({ open: true, onOpenChange: vi.fn(), debt });

describe("RecordPaymentDialog", () => {
  it("fills the box with the exact balance on Pay in full", async () => {
    render(<RecordPaymentDialog {...open()} />);

    await userEvent.click(screen.getByRole("button", { name: /pay in full/i }));

    expect(screen.getByLabelText("Amount")).toHaveValue("167.75");
    expect(screen.getByText("USD 0.00")).toBeInTheDocument();
  });

  it("previews the remaining balance without promising a settlement", async () => {
    render(<RecordPaymentDialog {...open()} />);

    await userEvent.type(screen.getByLabelText("Amount"), "60");
    expect(screen.getByText("USD 107.75")).toBeInTheDocument();

    // Past the balance there is nothing honest to preview: the server refuses
    // anything more than a cent over, and `0.00` would promise a closure.
    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.type(screen.getByLabelText("Amount"), "500");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("names the server's own balance on the 422 PAYMENT_EXCEEDS_BALANCE", async () => {
    // The pre-transaction check knows the balance and sends it in
    // `details.remaining` (plus a field error on `amount`), so the message can
    // quote the figure the reader has to type under.
    mutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Payment exceeds the remaining balance",
          status: 422,
          code: API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
          fieldErrors: { amount: "Payment exceeds the remaining balance" },
          details: { remaining: 120.5 },
        }),
      );
    });
    render(<RecordPaymentDialog {...open()} />);

    await userEvent.type(screen.getByLabelText("Amount"), "160");
    await userEvent.click(
      screen.getByRole("button", { name: /^record payment$/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is more than the USD 120.50 still owed on this debt.",
    );
  });

  it("says someone else got there first on the 409, and quotes no balance", async () => {
    // The 409 is the concurrency race inside the transaction. It carries no
    // `details` and no field map, because the server no longer claims to know
    // the balance — printing the one on screen would dress up a stale number.
    const onStale = vi.fn();
    mutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Payment no longer fits the balance",
          status: 409,
          code: API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
        }),
      );
    });
    render(<RecordPaymentDialog {...open()} onStale={onStale} />);

    await userEvent.type(screen.getByLabelText("Amount"), "160");
    await userEvent.click(
      screen.getByRole("button", { name: /^record payment$/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/someone else recorded a payment/i);
    expect(alert).not.toHaveTextContent("167.75");
    expect(onStale).toHaveBeenCalled();
  });

  it("reads DEBT_NOT_OPEN as this screen's situation, not the write-off's", async () => {
    // The same code and the same API message come back from the write-off
    // endpoint for a different situation. Which call raised it is the only
    // thing that tells them apart.
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
    render(<RecordPaymentDialog {...open()} onStale={onStale} />);

    await userEvent.type(screen.getByLabelText("Amount"), "10");
    await userEvent.click(
      screen.getByRole("button", { name: /^record payment$/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no longer open/i,
    );
    expect(onStale).toHaveBeenCalled();
  });

  it("refuses an empty amount before anything is sent", async () => {
    render(<RecordPaymentDialog {...open()} />);

    await userEvent.click(
      screen.getByRole("button", { name: /^record payment$/i }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/required/i);
  });

  it("sends the selected currency and drops a blank note", async () => {
    render(<RecordPaymentDialog {...open()} />);

    await userEvent.type(screen.getByLabelText("Amount"), "60");
    await userEvent.click(
      screen.getByRole("button", { name: /^record payment$/i }),
    );

    // `note` collapses from `""` to absent in the schema, so `JSON.stringify`
    // drops the key and the request omits it — which is what "no note" means
    // to the API.
    expect(mutate).toHaveBeenCalledWith(
      {
        debtId: "d1",
        input: expect.objectContaining({ amount: 60, currency: "USD" }),
      },
      expect.anything(),
    );
    expect(mutate.mock.calls[0][0].input.note).toBeUndefined();
  });

  it("caps the exchange currency below the balance rather than over it", async () => {
    // KES 167.75 at 130 KES per USD is USD 1.2903…; 1.30 would convert to
    // 169.00, more than a cent past the balance and therefore a 422. The hint
    // floors instead — and "Pay in full" is withheld, because an amount that
    // leaves a residue is not a settlement.
    config.mockReturnValue(twoCurrencies);
    render(<RecordPaymentDialog {...open()} />);

    await userEvent.click(screen.getByRole("radio", { name: "USD" }));

    expect(screen.getByText("max USD 1.29")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /pay in full/i }),
    ).not.toBeInTheDocument();
  });
});
