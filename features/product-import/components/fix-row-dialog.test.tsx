import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { ImportColumnMap, ImportRow } from "../types";
import { FixRowDialog } from "./fix-row-dialog";

const patchMutate = vi.fn();
vi.mock("../hooks/use-import-mutations", () => ({
  usePatchImportRow: () => ({ mutate: patchMutate, isPending: false }),
}));

const JOB_ID = "68c1f0a4e2b9c7d3a1f40b21";

const COLUMN_MAP: ImportColumnMap = {
  name: "Item Name",
  barcode: "SKU",
  category: "Category",
  unit: "Unit",
  costPrice: "Cost",
  sellingPrice: "Sales Price",
  quantity: "Qty",
  lowStockThreshold: null,
  trackStock: null,
  description: null,
};

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  index: 3,
  raw: { "Item Name": "Sugar 1 kg", "Sales Price": "" },
  parsed: {
    name: "Sugar 1 kg",
    category: "Grains",
    unit: "pcs",
    costPrice: 1,
    sellingPrice: 2,
    quantity: 4,
    trackStock: true,
  },
  status: "needs_attention",
  errors: {},
  notes: [],
  ...over,
});

const props = (over: Partial<ImportRow> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  jobId: JOB_ID,
  row: row(over),
  columnMap: COLUMN_MAP,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FixRowDialog — the body it sends", () => {
  it("sends ONLY the field that changed, and never echoes the defaults", async () => {
    // The contract's Trap 1 ("always echo `unit`, `trackStock` and `quantity`")
    // is **stale**. `Backend` 48c7205 stopped zod's defaults leaking through
    // `.partial()`, so echoing them today writes three fields the reviewer did
    // not touch — the exact corruption that fix removed
    // (`docs/findings/slice4-import-data.md` §1). This test is the guard.
    const user = userEvent.setup();
    render(<FixRowDialog {...props()} />);

    const price = screen.getByLabelText("Selling price");
    await user.clear(price);
    await user.type(price, "12");
    await user.click(screen.getByRole("button", { name: "Save row" }));

    expect(patchMutate).toHaveBeenCalledWith(
      { jobId: JOB_ID, index: 3, input: { sellingPrice: 12 } },
      expect.anything(),
    );
  });

  it("refuses to send an empty body, which is now a genuine 422", async () => {
    // The same fix un-vacuous-ed the `"Nothing to update"` refine, so `{}` is a
    // real refusal rather than the destructive 200 it used to be. Mirrored here
    // so the request is never made at all.
    const user = userEvent.setup();
    render(<FixRowDialog {...props()} />);

    await user.click(screen.getByRole("button", { name: "Save row" }));

    expect(patchMutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Nothing has changed on this row yet."),
    ).toBeInTheDocument();
  });

  it("clears a category with the empty string, which is the documented way", async () => {
    // `category` carries no `.min()` (`clean.ts:17`), and `resolveRowCategories`
    // then deletes both `parsed.category` and `parsed.categoryId` because the
    // trimmed name is falsy. Sending `categoryId` instead would be an
    // `unrecognized_keys` 422.
    const user = userEvent.setup();
    render(<FixRowDialog {...props()} />);

    await user.clear(screen.getByLabelText("Category"));
    await user.click(screen.getByRole("button", { name: "Save row" }));

    expect(patchMutate).toHaveBeenCalledWith(
      { jobId: JOB_ID, index: 3, input: { category: "" } },
      expect.anything(),
    );
  });

  it("will not silently drop an emptied number, because it cannot be unset", async () => {
    // `editRow` merges (`{ ...row.parsed, ...patch }`) and the patch schema has
    // no `null`, so there is no way to remove a numeric value the file already
    // supplied. Dropping it from the diff would look like a saved edit that did
    // nothing.
    const user = userEvent.setup();
    render(<FixRowDialog {...props()} />);

    await user.clear(screen.getByLabelText("Quantity"));
    await user.click(screen.getByRole("button", { name: "Save row" }));

    expect(patchMutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Quantity cannot be emptied here/),
    ).toBeInTheDocument();
  });
});

describe("FixRowDialog — what it tells the reviewer", () => {
  it("leads with the translation and keeps the API's words underneath", async () => {
    render(
      <FixRowDialog
        {...props({
          parsed: { name: "Sugar 1 kg", unit: "pcs", costPrice: 1 },
          errors: {
            sellingPrice: "Invalid input: expected number, received undefined",
          },
        })}
      />,
    );

    expect(screen.getByText("Selling price is missing")).toBeInTheDocument();
    // Reachable for support, never the headline.
    expect(
      screen.getByText("Invalid input: expected number, received undefined"),
    ).toBeInTheDocument();
  });

  it("warns that saving a conflicted row throws its decision away", () => {
    // `editRow` clears `conflict` before re-reconciling, and the reconcile pass
    // re-creates it with **no** resolution. A Commit button that was enabled a
    // moment ago will correctly go back to blocked.
    render(
      <FixRowDialog
        {...props({
          status: "conflict",
          conflict: {
            existingProductId: "6aa178be2f7394082d889c7b",
            existingName: "Sugar 1 kg (sack)",
          },
        })}
      />,
    );

    expect(
      screen.getByText(/clears the decision made about it/),
    ).toBeInTheDocument();
  });

  it("has somewhere to put an object-level 422, which is keyed '_'", async () => {
    // `zodToFieldErrors` keys an empty zod path as the literal `"_"`
    // (`error.middleware.ts:9-16`), so a form that only maps `fieldErrors` onto
    // registered inputs shows nothing at all for that refusal.
    const user = userEvent.setup();
    patchMutate.mockImplementation(
      (_vars: unknown, options: { onError: (e: ApiError) => void }) =>
        options.onError(
          new ApiError({
            message: "Validation failed",
            status: 422,
            code: "VALIDATION_ERROR",
            fieldErrors: { _: "Nothing to update" },
          }),
        ),
    );

    render(<FixRowDialog {...props()} />);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Sugar 2 kg");
    await user.click(screen.getByRole("button", { name: "Save row" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing to update");
  });

  it("shows the reviewer their own cell beside each field", () => {
    render(<FixRowDialog {...props()} />);

    expect(screen.getByText("File: Sugar 1 kg")).toBeInTheDocument();
  });
});
