import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/features/products/types";
import { ApiError } from "@/lib/api/errors";
import type { ImportRow } from "../types";
import { ConflictBanner } from "./conflict-banner";

const productQuery = vi.fn();
vi.mock("@/features/products/hooks/use-product", () => ({
  useProduct: (id?: string) => productQuery(id),
}));

const resolveMutate = vi.fn();
vi.mock("../hooks/use-import-mutations", () => ({
  useResolveImportConflict: () => ({
    mutate: resolveMutate,
    isPending: false,
  }),
}));

const JOB_ID = "68c1f0a4e2b9c7d3a1f40b21";
const EXISTING_ID = "6aa178be2f7394082d889c7b";

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  index: 19,
  raw: {},
  parsed: {
    name: "Basmati rice 5 kg",
    barcode: "6001234567890",
    unit: "pcs",
    costPrice: 9.1,
    // Deliberately different from the live product's 12.40 below — the whole
    // purpose of the design's parenthetical is to compare the two.
    sellingPrice: 10.5,
    quantity: 40,
  },
  status: "conflict",
  errors: {},
  notes: [],
  conflict: {
    existingProductId: EXISTING_ID,
    existingName: "Basmati rice 5 kg",
  },
  ...over,
});

const existing: Product = {
  id: EXISTING_ID,
  name: "Basmati rice 5 kg",
  barcode: "6001234567890",
  category: null,
  unit: "pcs",
  costPrice: 8.2,
  sellingPrice: 12.4,
  trackStock: true,
  quantity: 3,
  images: [],
  status: "active",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const idle = {
  data: undefined,
  error: null,
  isPending: true,
  refetch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  productQuery.mockReturnValue(idle);
});

const props = { jobId: JOB_ID, currency: "USD" };

describe("ConflictBanner — the parenthetical the API cannot deliver", () => {
  it("shows the existing product's NAME and fetches nothing until asked", () => {
    // Observation §2: the conflict object came back with exactly two keys —
    // `existingProductId` and `existingName`. The canvas draws
    // "(USD 12.40, 3 pcs)" beside the name; neither figure is on the wire, and
    // a file with fifty conflicts would be fifty `GET /products/:id` calls for
    // a parenthetical.
    render(<ConflictBanner {...props} row={row()} />);

    expect(productQuery).toHaveBeenCalledWith(undefined);
    expect(screen.getByText(/already belongs to/)).toHaveTextContent(
      "Row 21 · 6001234567890 already belongs to Basmati rice 5 kg",
    );
    expect(screen.queryByText(/USD 12.40/)).not.toBeInTheDocument();
    // And nothing invents the figures out of the imported row either.
    expect(screen.queryByText(/USD 10.50/)).not.toBeInTheDocument();
  });

  it("fetches the one product when a reviewer expands this conflict", async () => {
    const user = userEvent.setup();
    render(<ConflictBanner {...props} row={row()} />);

    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(productQuery).toHaveBeenLastCalledWith(EXISTING_ID);
  });

  it("labels both sides, so the imported price can never pass for the live one", async () => {
    // "Do not substitute the imported row's price for the existing product's —
    // they are different numbers and comparing them is the entire point."
    const user = userEvent.setup();
    productQuery.mockReturnValue({
      data: existing,
      error: null,
      isPending: false,
      refetch: vi.fn(),
    });

    render(<ConflictBanner {...props} row={row()} />);
    await user.click(screen.getByRole("button", { name: "Compare" }));

    const live = screen
      .getByText("Already in your products")
      .closest("div") as HTMLElement;
    const file = screen
      .getByText("This row in your file")
      .closest("div") as HTMLElement;

    // Money carries the CODE, never a symbol (brief §8.1).
    expect(within(live).getByText("USD 12.40")).toBeInTheDocument();
    expect(within(live).getByText("3 pcs")).toBeInTheDocument();
    expect(within(file).getByText("USD 10.50")).toBeInTheDocument();
    expect(within(file).getByText("40 pcs")).toBeInTheDocument();
  });

  it("says so plainly when the existing product has gone", async () => {
    const user = userEvent.setup();
    productQuery.mockReturnValue({
      data: undefined,
      error: new ApiError({
        message: "Product not found",
        status: 404,
        code: "NOT_FOUND",
      }),
      isPending: false,
      refetch: vi.fn(),
    });

    render(<ConflictBanner {...props} row={row()} />);
    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(screen.getByText(/no longer here/)).toBeInTheDocument();
  });
});

describe("ConflictBanner — the decision", () => {
  it("sends the resolution, which is required and has no default", async () => {
    const user = userEvent.setup();
    render(<ConflictBanner {...props} row={row()} />);

    await user.click(screen.getByRole("button", { name: "Update existing" }));

    expect(resolveMutate).toHaveBeenCalledWith(
      { jobId: JOB_ID, index: 19, input: { resolution: "update" } },
      expect.anything(),
    );
  });

  it("states the decision, because neither the status nor the count moves", () => {
    render(
      <ConflictBanner
        {...props}
        row={row({
          conflict: {
            existingProductId: EXISTING_ID,
            existingName: "Basmati rice 5 kg",
            resolution: "skip",
          },
        })}
      />,
    );

    expect(
      screen.getByText("Set to leave the existing product alone"),
    ).toBeInTheDocument();
    expect(screen.getByText(/count will not go down/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("explains a 422 IMPORT_ROW_NOT_CONFLICT rather than repeating it", async () => {
    // Editing a conflicted row clears its conflict until the file-wide
    // reconciliation re-creates it, so this is what a stale screen earns.
    const user = userEvent.setup();
    const onStale = vi.fn();
    resolveMutate.mockImplementation(
      (_vars: unknown, options: { onError: (e: ApiError) => void }) =>
        options.onError(
          new ApiError({
            message: "This row is not a conflict",
            status: 422,
            code: "IMPORT_ROW_NOT_CONFLICT",
          }),
        ),
    );

    render(<ConflictBanner {...props} row={row()} onStale={onStale} />);
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /not a conflict any more/,
    );
    expect(onStale).toHaveBeenCalled();
  });
});
