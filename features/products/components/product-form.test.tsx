import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/features/products/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { ProductForm } from "./product-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/categories/hooks/use-categories", () => ({
  useCategories: () => ({
    isPending: false,
    error: null,
    data: [{ id: "c1", name: "General", isDefault: true, productCount: 0 }],
  }),
}));
vi.mock("@/features/auth/hooks/use-permission", () => ({ useCan: () => true }));
const create = vi.fn();
const update = vi.fn();
vi.mock("@/features/products/hooks/use-product-mutations", () => ({
  useCreateProduct: () => ({ mutate: create, isPending: false, error: null }),
  useUpdateProduct: () => ({ mutate: update, isPending: false, error: null }),
}));

/**
 * Four mocks the plan does not list, all additive — none of them changes an
 * assertion, and every one of them removes a real network call from a unit
 * test. `<ImagePicker>` is rendered by this form, and it owns two query hooks
 * of its own; `useOrganization` is one more. Left real, each would fire an
 * axios request into happy-dom that can only fail, and the form's own
 * behaviour is not what would be under test while that happened.
 */
vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "USD",
    timezone: "Africa/Mogadishu",
    isLoading: false,
  }),
}));
vi.mock("@/features/uploads/hooks/use-uploads", () => ({
  useUploads: () => ({ isPending: false, error: null, data: { items: [] } }),
}));
vi.mock("@/features/uploads/hooks/use-upload-mutations", () => ({
  useCreateUpload: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteUpload: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const tracked: Product = {
  id: "p1",
  name: "Basmati rice 5 kg",
  unit: "kg",
  costPrice: 9.1,
  sellingPrice: 12.4,
  trackStock: true,
  quantity: 48,
  category: { id: "c1", name: "General" },
  images: [],
  status: "active",
  createdAt: "",
  updatedAt: "",
};

describe("ProductForm", () => {
  it("hides the stock fields entirely when the product is untracked", async () => {
    render(wrap(<ProductForm mode="create" />));
    expect(screen.getByLabelText(/opening quantity/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /track stock/i }));

    expect(
      screen.queryByLabelText(/opening quantity/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/low stock/i)).not.toBeInTheDocument();
  });

  it("offers no quantity field when editing a tracked product", () => {
    // PATCH /products/:id does not move stock. A quantity box here would look
    // like it worked and change nothing — restock and adjust are the only ways.
    render(wrap(<ProductForm mode="edit" product={tracked} />));
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument();
  });

  it("does ask for an opening quantity when tracking is being switched ON", async () => {
    // The one case `updateProductForOrg` honours a body `quantity` in:
    // trackStock false -> true. Omitting it there is not "leave stock alone",
    // it is `data.quantity = 0` plus no movement row
    // (../Backend/src/services/product.service.ts:290-291, :233-246).
    render(
      wrap(
        <ProductForm
          mode="edit"
          product={{ ...tracked, trackStock: false, quantity: 0 }}
        />,
      ),
    );
    expect(
      screen.queryByLabelText(/opening quantity/i),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /track stock/i }));

    expect(screen.getByLabelText(/opening quantity/i)).toBeInTheDocument();
  });

  it("reads margin off the selling price, the way the canvas does", async () => {
    // Artboard `2d` prints 26.6% for cost 9.10 / selling 12.40, which is
    // (12.40 - 9.10) / 12.40 — gross margin, not the 36.3% markup on cost.
    render(wrap(<ProductForm mode="create" />));

    await userEvent.type(screen.getByLabelText(/cost price/i), "9.10");
    await userEvent.type(screen.getByLabelText(/selling price/i), "12.40");

    expect(screen.getByText("26.6%")).toBeInTheDocument();
  });

  it("sends only the field that changed on an edit", async () => {
    render(wrap(<ProductForm mode="edit" product={tracked} />));

    const name = screen.getByLabelText(/^name$/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Basmati rice 10 kg");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(update).toHaveBeenCalledWith(
      { id: "p1", input: { name: "Basmati rice 10 kg" } },
      expect.anything(),
    );
  });

  it("puts a duplicate barcode under the barcode field", async () => {
    create.mockImplementationOnce(
      (_input: unknown, opts?: { onError?: (error: ApiError) => void }) =>
        opts?.onError?.(
          new ApiError({
            message: "A product with this barcode already exists",
            status: 409,
            code: API_ERROR_CODE.DUPLICATE_BARCODE,
          }),
        ),
    );

    render(wrap(<ProductForm mode="create" />));
    await userEvent.type(screen.getByLabelText(/^name$/i), "Basmati rice");
    await userEvent.type(screen.getByLabelText(/barcode/i), "6001234567890");
    await userEvent.type(screen.getByLabelText(/cost price/i), "9.10");
    await userEvent.type(screen.getByLabelText(/selling price/i), "12.40");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(
      await screen.findByText(/barcode already belongs to another product/i),
    ).toBeInTheDocument();
  });
});
