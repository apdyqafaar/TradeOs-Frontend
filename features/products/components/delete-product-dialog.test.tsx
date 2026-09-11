import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/features/products/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { DeleteProductDialog, saleCountOf } from "./delete-product-dialog";

const mutate = vi.fn();
const push = vi.fn();

vi.mock("@/features/products/hooks/use-product-mutations", () => ({
  useDeleteProduct: () => ({ mutate, isPending: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const product = { id: "p1", name: "Rice 5kg" } as Product;

const refusal = (details?: Record<string, unknown>) =>
  new ApiError({
    message: "This product has been sold 4 times and cannot be deleted.",
    status: 409,
    code: API_ERROR_CODE.PRODUCT_HAS_SALES,
    details,
  });

/** Runs the mutation's `onError` with `error`, the way the hook would. */
const failWith = (error: ApiError) => {
  mutate.mockImplementation((_id, opts) => opts.onError(error));
};

beforeEach(() => {
  mutate.mockReset();
  push.mockReset();
});

const openDialog = () =>
  render(
    wrap(<DeleteProductDialog product={product} open onOpenChange={vi.fn()} />),
  );

const pressDelete = () =>
  userEvent.click(screen.getByRole("button", { name: /delete permanently/i }));

describe("saleCountOf", () => {
  it("reads the count off a refusal", () => {
    expect(saleCountOf(refusal({ saleCount: 4 }))).toBe(4);
  });

  it("answers null when the refusal carries no count", () => {
    // `details` is whatever the server put there. A refusal that arrives
    // without the number is still a refusal; it must not render "sold in
    // undefined sales".
    expect(saleCountOf(refusal())).toBeNull();
    expect(saleCountOf(refusal({ saleCount: "four" }))).toBeNull();
  });

  it("answers null for a different failure entirely", () => {
    const other = new ApiError({
      message: "Nope",
      status: 500,
      code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
      details: { saleCount: 9 },
    });
    expect(saleCountOf(other)).toBeNull();
  });
});

describe("DeleteProductDialog", () => {
  it("says what does not come back, and points at Archive instead", () => {
    // The whole reason this dialog is separate from Archive's: two controls
    // that both remove a product from the list have to be told apart BEFORE
    // either is pressed.
    openDialog();

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/use Archive instead/i)).toBeInTheDocument();
  });

  it("sends the reader back to the list once the product is gone", async () => {
    mutate.mockImplementation((_id, opts) => opts.onSuccess({ id: "p1" }));
    openDialog();
    await pressDelete();

    expect(mutate).toHaveBeenCalledWith("p1", expect.anything());
    expect(push).toHaveBeenCalledWith("/products");
  });

  it("shows the refusal with its sale count, where the button was pressed", async () => {
    // The count is the reason the answer is no. A toast would float it away
    // from the control that earned it — the same call `features/categories`
    // makes for CATEGORY_IN_USE.
    failWith(refusal({ saleCount: 4 }));
    openDialog();
    await pressDelete();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/sold in 4 sales/i);
    expect(alert).toHaveTextContent(/Archive it instead/i);
  });

  it("says 1 sale, not 1 sales", async () => {
    failWith(refusal({ saleCount: 1 }));
    openDialog();
    await pressDelete();

    expect(await screen.findByRole("alert")).toHaveTextContent(/in 1 sale,/i);
  });

  it("still explains itself when the refusal carries no count", async () => {
    failWith(refusal());
    openDialog();
    await pressDelete();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already been sold/i);
    expect(alert).not.toHaveTextContent(/undefined|NaN|null/);
  });

  it("withdraws the delete button once the answer is a standing no", async () => {
    // Pressing again cannot succeed — the product is just as sold as it was.
    // Leaving the button invites retrying instead of reading why.
    failWith(refusal({ saleCount: 4 }));
    openDialog();
    await pressDelete();

    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: /delete permanently/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("shows an unexpected failure as itself rather than as a refusal", async () => {
    // Branch on `code`, never on status alone: a 500 is not "this product has
    // been sold" and must not be dressed as one.
    failWith(
      new ApiError({
        message: "Something went wrong",
        status: 500,
        code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
      }),
    );
    openDialog();
    await pressDelete();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).not.toHaveTextContent(/Archive it instead/i);
    // Retryable, unlike the refusal.
    expect(
      screen.getByRole("button", { name: /delete permanently/i }),
    ).toBeInTheDocument();
  });
});
