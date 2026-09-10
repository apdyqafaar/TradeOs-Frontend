import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ImportJobDetail,
  ProductImportField,
} from "@/features/product-import/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import {
  ColumnMapStep,
  fileHeaders,
  hasBeenEdited,
  invertColumnMap,
  patchForHeader,
} from "./column-map-step";

const remap = vi.fn();
vi.mock("@/features/product-import/hooks/use-import-mutations", () => ({
  useRemapImportColumns: () => remap(),
}));

const mutate = vi.fn();

/**
 * The live fixture, as `docs/findings/slice4-import-live-observations.md`
 * recorded it: a QuickBooks export whose `columnMap` is keyed **field →
 * header**, with `Vendor` left unmatched.
 */
const job = (overrides: Partial<ImportJobDetail> = {}): ImportJobDetail => ({
  id: "6512ab34cd56ef7890123456",
  status: "reviewing",
  filename: "quickbooks.csv",
  format: "csv",
  columnMap: {
    name: "Item Name",
    barcode: "SKU",
    category: null,
    unit: null,
    costPrice: "Cost",
    sellingPrice: "Sales Price",
    quantity: "Quantity On Hand",
    lowStockThreshold: null,
    trackStock: null,
    description: "Description",
  },
  unmatchedHeaders: ["Vendor"],
  totalRows: 25,
  counts: { ready: 12, needsAttention: 11, conflict: 2, skipped: 0 },
  expiresAt: "2026-09-17T08:00:00.000Z",
  createdAt: "2026-09-10T08:00:00.000Z",
  updatedAt: "2026-09-10T08:00:00.000Z",
  rows: [
    {
      index: 0,
      // Key order is the file's own column order, which is what makes this
      // screen legible next to the spreadsheet it came from.
      raw: {
        "Item Name": "Coca-Cola 500ml",
        SKU: "5449000000996",
        Cost: "0.60",
        "Sales Price": "1.00",
        "Quantity On Hand": "48",
        Description: "Case of 24",
        Vendor: "Nairobi Beverages",
      },
      parsed: { name: "Coca-Cola 500ml", costPrice: 0.6, sellingPrice: 1 },
      status: "ready",
      errors: {},
      notes: [],
    },
  ],
  rowsMeta: { page: 1, limit: 20, total: 25, totalPages: 2 },
  ...overrides,
});

const confirmRemap = () =>
  userEvent.click(screen.getByRole("button", { name: /change the column/i }));

beforeEach(() => {
  mutate.mockReset();
  remap.mockReturnValue({ mutate, isPending: false, error: null });
});

describe("invertColumnMap", () => {
  /**
   * The whole reason this file exists. The API answers `field → header`;
   * artboard `2e` draws `header → [field]`. Reading the JSON and building the
   * obvious UI produces a screen keyed by our own field names, which is not
   * the design and not what someone looking at their own spreadsheet expects.
   */
  it("turns field → header into header → field and drops the nulls", () => {
    const byHeader = invertColumnMap(job());

    expect(byHeader.get("Sales Price")).toBe("sellingPrice");
    expect(byHeader.get("Cost")).toBe("costPrice");
    expect(byHeader.get("Vendor")).toBeUndefined();
    // Ten fields, four of them null on this fixture.
    expect(byHeader.size).toBe(6);
  });
});

describe("fileHeaders", () => {
  it("takes the file's own column order from a row's raw keys", () => {
    expect(fileHeaders(job())).toEqual([
      "Item Name",
      "SKU",
      "Cost",
      "Sales Price",
      "Quantity On Hand",
      "Description",
      "Vendor",
    ]);
  });

  it("falls back to the map plus the unmatched list when a page came back empty", () => {
    expect(fileHeaders(job({ rows: [] }))).toEqual([
      "Item Name",
      "SKU",
      "Cost",
      "Sales Price",
      "Quantity On Hand",
      "Description",
      "Vendor",
    ]);
  });
});

describe("patchForHeader", () => {
  /**
   * `{ sellingPrice: "Cost" }` alone is refused while `costPrice` still holds
   * "Cost" — the *merged* map is what the server validates. Both halves have
   * to travel in one call (`import.test.ts:540-547`).
   */
  it("clears the old field and claims the new one in a single patch", () => {
    expect(patchForHeader("Cost", "costPrice", "sellingPrice")).toEqual({
      costPrice: null,
      sellingPrice: "Cost",
    });
  });

  it("unmaps with a null when a column stops being imported", () => {
    expect(patchForHeader("Cost", "costPrice", null)).toEqual({
      costPrice: null,
    });
  });

  it("claims a field for a column that was not imported before", () => {
    expect(patchForHeader("Vendor", null, "description")).toEqual({
      description: "Vendor",
    });
  });

  /**
   * An unchanged `change` event must not reach the most destructive call in
   * the slice — `{ columnMap: {} }` is a 422 besides.
   */
  it("returns null when nothing would change", () => {
    expect(patchForHeader("Cost", "costPrice", "costPrice")).toBeNull();
    expect(patchForHeader("Vendor", null, null)).toBeNull();
  });
});

describe("hasBeenEdited", () => {
  it("reads a later updatedAt as work that a remap would destroy", () => {
    expect(hasBeenEdited(job())).toBe(false);
    expect(hasBeenEdited(job({ updatedAt: "2026-09-10T09:12:00.000Z" }))).toBe(
      true,
    );
  });
});

describe("ColumnMapStep", () => {
  /**
   * One row per **file header**, each with a dropdown choosing the field it
   * feeds. A regression to rendering `columnMap` as it arrives shows rows
   * labelled `sellingPrice`, which this catches twice over.
   */
  it("draws a row per file column, with the field it feeds selected", () => {
    render(<ColumnMapStep jobId="j1" job={job()} />);

    expect(screen.getByLabelText("Sales Price")).toHaveValue("sellingPrice");
    expect(screen.getByLabelText("Cost")).toHaveValue("costPrice");
    // Unmatched, and honestly so: it is ignored, not broken.
    expect(screen.getByLabelText("Vendor")).toHaveValue("");
    expect(screen.queryByLabelText("sellingPrice")).toBeNull();
  });

  it("names the columns nothing is read from, without calling them a problem", () => {
    render(<ColumnMapStep jobId="j1" job={job()} />);

    expect(screen.getByText(/one column is not imported/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is read from them/i)).toBeInTheDocument();
  });

  /**
   * A `PATCH /columns` re-derives every non-skipped row from `raw` and throws
   * away every manual fix. The dialog is unconditional, and the API is not
   * touched until it is answered.
   */
  it("asks before remapping, then sends both halves in one call", async () => {
    render(<ColumnMapStep jobId="j1" job={job()} />);

    await userEvent.selectOptions(
      screen.getByLabelText("Cost"),
      "sellingPrice",
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/is undone/i)).toBeInTheDocument();

    await confirmRemap();
    expect(mutate).toHaveBeenCalledWith(
      {
        jobId: "j1",
        input: { columnMap: { costPrice: null, sellingPrice: "Cost" } },
      },
      expect.anything(),
    );
  });

  it("sharpens the warning when the job has already been worked on", async () => {
    render(
      <ColumnMapStep
        jobId="j1"
        job={job({ updatedAt: "2026-09-10T09:30:00.000Z" })}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Vendor"), "unit");
    expect(
      screen.getByText(/edited since it was uploaded/i),
    ).toBeInTheDocument();
  });

  /**
   * `IMPORT_UNKNOWN_HEADER` keyed by the **product field** — the header is not
   * one of the file's own. Unreachable from this screen's own arithmetic, so
   * it means the job moved underneath the page; the message says that, and the
   * API's own sentence stays on the element for a support conversation.
   */
  it("puts a header-keyed refusal on the control that caused it", async () => {
    mutate.mockImplementation(
      (
        _variables: unknown,
        options: { onError: (error: ApiError) => void },
      ) => {
        options.onError(
          new ApiError({
            message: "Unknown column",
            status: 422,
            code: API_ERROR_CODE.IMPORT_UNKNOWN_HEADER,
            fieldErrors: { unit: '"Vendor" is not a column in this file' },
            requestId: "req-31",
          }),
        );
      },
    );

    render(<ColumnMapStep jobId="j1" job={job()} />);
    await userEvent.selectOptions(screen.getByLabelText("Vendor"), "unit");
    await confirmRemap();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/not in this file any more/i);
    expect(alert).toHaveTextContent(/req-31/);
    expect(alert).toHaveAttribute("title", "Unknown column");
    // The control it belongs to, not a banner at the top of the panel.
    expect(screen.getByLabelText("Vendor")).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });

  /**
   * The same code, keyed by the literal `"columnMap"` — two fields claiming
   * one header in the merged map. Three `errors` shapes come out of this one
   * endpoint and only the keys tell them apart (contract Trap 8).
   */
  it("recognises the two-fields-one-header shape keyed by columnMap", async () => {
    mutate.mockImplementation(
      (
        _variables: unknown,
        options: { onError: (error: ApiError) => void },
      ) => {
        options.onError(
          new ApiError({
            message: '"Cost" cannot be mapped to both "costPrice" and "unit"',
            status: 422,
            code: API_ERROR_CODE.IMPORT_UNKNOWN_HEADER,
            fieldErrors: {
              columnMap:
                '"Cost" cannot be mapped to both "costPrice" and "unit"',
            },
          }),
        );
      },
    );

    render(<ColumnMapStep jobId="j1" job={job()} />);
    await userEvent.selectOptions(screen.getByLabelText("Vendor"), "unit");
    await confirmRemap();

    expect(screen.getByRole("alert")).toHaveTextContent(
      /another field is already reading that column/i,
    );
  });

  it("explains a 409 on a job that is no longer being reviewed", async () => {
    mutate.mockImplementation(
      (
        _variables: unknown,
        options: { onError: (error: ApiError) => void },
      ) => {
        options.onError(
          new ApiError({
            message: "This import has already been committed or cancelled",
            status: 409,
            code: API_ERROR_CODE.IMPORT_NOT_REVIEWING,
          }),
        );
      },
    );

    render(<ColumnMapStep jobId="j1" job={job()} />);
    await userEvent.selectOptions(screen.getByLabelText("Vendor"), "unit");
    await confirmRemap();

    expect(screen.getByRole("alert")).toHaveTextContent(
      /can no longer be changed/i,
    );
  });

  /**
   * `name`, `costPrice` and `sellingPrice` are the only three fields with no
   * default and no `.optional()`, so an unmapped one puts every single row in
   * "needs attention" — which is worth knowing here rather than discovering
   * in the review table.
   */
  it("warns when nothing feeds a field every row needs", () => {
    const columnMap = { ...job().columnMap, sellingPrice: null };
    render(
      <ColumnMapStep
        jobId="j1"
        job={job({ columnMap, unmatchedHeaders: ["Vendor", "Sales Price"] })}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/selling price/i);
    expect(notice).toHaveTextContent(/every row will need attention/i);
  });

  it("offers the wizard's own way forward only when it is given one", async () => {
    const onContinue = vi.fn();
    render(<ColumnMapStep jobId="j1" job={job()} onContinue={onContinue} />);

    await userEvent.click(
      screen.getByRole("button", { name: /review the rows/i }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

/** Nothing here may reach outside the ten fields the service accepts. */
describe("the field list", () => {
  it("offers exactly the ten product fields plus 'not imported'", () => {
    render(<ColumnMapStep jobId="j1" job={job()} />);

    const options = Array.from(
      screen.getByLabelText<HTMLSelectElement>("Vendor").options,
    ).map((option) => option.value as ProductImportField | "");

    expect(options).toHaveLength(11);
    expect(options[0]).toBe("");
  });
});
