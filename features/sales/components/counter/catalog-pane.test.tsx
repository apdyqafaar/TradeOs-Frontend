import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProducts } from "@/features/products/hooks/use-products";
import type { Product, ProductListParams } from "@/features/products/types";
import { CatalogPane } from "@/features/sales/components/counter/catalog-pane";

vi.mock("@/features/products/hooks/use-products", () => ({
  useProducts: vi.fn(),
}));
vi.mock("@/features/categories/hooks/use-categories", () => ({
  useCategories: vi.fn(() => ({ data: [], isPending: false })),
}));

const rice: Product = {
  id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Basmati rice",
  barcode: "6001234567890",
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

const brownRice: Product = {
  ...rice,
  id: "aaaaaaaaaaaaaaaaaaaaaaa2",
  name: "Basmati rice, brown",
  barcode: "6001234567891",
};

const sugar: Product = {
  ...rice,
  id: "aaaaaaaaaaaaaaaaaaaaaaa3",
  name: "Sugar",
  barcode: "6009999999999",
  quantity: 0,
};

const answer = (items: Product[]) =>
  ({
    data: { items, meta: { page: 1, limit: 12, total: items.length } },
    error: null,
    isPending: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  }) as unknown as ReturnType<typeof useProducts>;

/**
 * The endpoint's own behaviour, transcribed: `search` is a **prefix** match on
 * the name OR an **exact** barcode match, one parameter serving both
 * (`../Backend/src/db/actions/product.actions.ts:59-63`). Everything the
 * scanner path claims rests on that, so the fake honours it rather than
 * matching loosely.
 */
const catalogue = [rice, brownRice, sugar];
const search = (params: ProductListParams) => {
  const term = params.search;
  if (term === undefined) return catalogue;
  const lower = term.toLowerCase();
  return catalogue.filter(
    (product) =>
      product.name.toLowerCase().startsWith(lower) || product.barcode === term,
  );
};

const box = () => screen.getByLabelText(/scan a barcode/i);

beforeEach(() => {
  vi.mocked(useProducts).mockImplementation((params = {}) =>
    answer(search(params)),
  );
});

describe("CatalogPane — the scanner", () => {
  it("rings up the one product a scanned barcode resolves to, and clears the box", async () => {
    // A scanner types a burst and presses Enter. Enter goes straight past the
    // debounce — 300ms of nothing after a beep reads as a dropped scan.
    const onAdd = vi.fn();
    render(<CatalogPane currency="USD" onAdd={onAdd} />);

    await userEvent.type(box(), "6001234567890{Enter}");

    expect(onAdd).toHaveBeenCalledWith(rice);
    expect(box()).toHaveValue("");
  });

  it("leaves an ambiguous prefix on screen to be tapped", async () => {
    // Two matches is a name, not a barcode. Guessing which one was meant is
    // how the wrong thing ends up on a receipt.
    const onAdd = vi.fn();
    render(<CatalogPane currency="USD" onAdd={onAdd} />);

    await userEvent.type(box(), "Basmati{Enter}");

    expect(onAdd).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /basmati rice, brown/i }),
    ).toBeInTheDocument();
  });

  it("says so out loud when a scan matches nothing", async () => {
    const onAdd = vi.fn();
    render(<CatalogPane currency="USD" onAdd={onAdd} />);

    await userEvent.type(box(), "6000000000000{Enter}");

    // An `<output>`, so it is announced: the cashier is looking at the shelf,
    // and silence after a beep reads as a successful scan.
    expect(screen.getByRole("status")).toHaveTextContent(/nothing matches/i);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("refuses to scan an out-of-stock product into the cart", async () => {
    // The tile is inert for the same reason; the scanner must not be the way
    // round it.
    const onAdd = vi.fn();
    render(<CatalogPane currency="USD" onAdd={onAdd} />);

    await userEvent.type(box(), "6009999999999{Enter}");

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /sugar/i })).toBeDisabled();
  });
});

describe("CatalogPane — the query", () => {
  it("never sends an empty search, which the .strict() schema refuses", () => {
    // `?search=` is a 422 on `listProductsQuerySchema` (`search` is `min(1)`)
    // — and an empty box is this pane's normal state. Dropping the key also
    // keeps `{}` and `{ search: "" }` from hashing to two React Query keys for
    // one identical request.
    render(<CatalogPane currency="USD" onAdd={vi.fn()} />);

    expect(vi.mocked(useProducts).mock.calls[0][0]).toEqual({
      limit: 12,
      // Explicit rather than left to the server's default: an archived product
      // is a 409 `PRODUCT_ARCHIVED` at commit time, so it must never be a tile.
      status: "active",
    });
  });
});
