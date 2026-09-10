import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { ImportColumnMap, ImportJobSummary, ImportRow } from "../types";
import { ReviewStep } from "./review-step";

const jobQuery = vi.fn();
vi.mock("../hooks/use-import-job", () => ({
  useImportJob: (id: string, params: unknown) => jobQuery(id, params),
  useImportJobConflicts: () => jobQuery("conflicts", {}),
}));

const skipRow = vi.fn();
const patchRow = vi.fn();
const resolveConflict = vi.fn();
vi.mock("../hooks/use-import-mutations", () => ({
  useSkipImportRow: () => ({ mutate: skipRow, isPending: false }),
  usePatchImportRow: () => ({ mutate: patchRow, isPending: false }),
  useResolveImportConflict: () => ({
    mutate: resolveConflict,
    isPending: false,
  }),
}));

// The conflict banner fetches the existing product only when someone expands
// it; nothing in this file expands one, so this only has to exist.
vi.mock("@/features/products/hooks/use-product", () => ({
  useProduct: () => ({ data: undefined, error: null, isPending: false }),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "USD",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

const JOB_ID = "68c1f0a4e2b9c7d3a1f40b21";

/** Field → header, which is the inverse of how the design draws step 2. */
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

/**
 * The live counts from `docs/findings/slice4-import-live-observations.md` §4 —
 * `ready 12 / needsAttention 11 / conflict 2` over the owner's 25-row fixture.
 */
const job = (over: Partial<ImportJobSummary> = {}): ImportJobSummary => ({
  id: JOB_ID,
  status: "reviewing",
  filename: "test-import-products.csv",
  format: "csv",
  columnMap: COLUMN_MAP,
  unmatchedHeaders: ["Vendor"],
  totalRows: 25,
  counts: { ready: 12, needsAttention: 11, conflict: 2, skipped: 0 },
  expiresAt: "2026-09-17T10:00:00.000Z",
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
  ...over,
});

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  index: 0,
  raw: {},
  parsed: { name: "Sugar 1 kg", unit: "pcs", costPrice: 1, sellingPrice: 2 },
  status: "ready",
  errors: {},
  notes: [],
  ...over,
});

const answered = (rows: ImportRow[], total = rows.length) => ({
  data: {
    ...job(),
    rows,
    rowsMeta: { page: 1, limit: 50, total, totalPages: 1 },
  },
  error: null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
});

const wrapper = withNuqsTestingAdapter();

beforeEach(() => {
  vi.clearAllMocks();
  jobQuery.mockReturnValue(answered([row()]));
});

describe("ReviewStep — tabs", () => {
  it("takes each tab's count from the right key, camelCase and all", () => {
    // `counts.needsAttention` is camelCase while the row status is the
    // snake_case `needs_attention`, and `counts[row.status]` is `undefined`
    // (types.ts rule 4). A tab strip that indexed one with the other would show
    // a blank chip on the tab that matters most.
    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    const tab = (name: RegExp) => screen.getByRole("tab", { name });

    // "All rows" is `totalRows`, which is not in `counts` at all.
    expect(tab(/All rows/)).toHaveTextContent("25");
    expect(tab(/Needs attention/)).toHaveTextContent("11");
    expect(tab(/Conflicts/)).toHaveTextContent("2");
    expect(tab(/Ready/)).toHaveTextContent("12");
    expect(tab(/Skipped/)).toHaveTextContent("0");
  });

  it("asks the API for the selected status and goes back to page 1", async () => {
    const user = userEvent.setup();
    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    await user.click(screen.getByRole("tab", { name: /Needs attention/ }));

    expect(jobQuery).toHaveBeenLastCalledWith(JOB_ID, {
      status: "needs_attention",
      page: 1,
      limit: 50,
    });
  });
});

describe("ReviewStep — the Message column", () => {
  it("never shows the API's raw zod text as the primary message", async () => {
    // The live strings. `docs/findings/slice4-import-live-observations.md` §1:
    // "Invalid input" tells a trader nothing and "expected number, received
    // undefined" reads like a system fault rather than an empty cell in their
    // own spreadsheet.
    jobQuery.mockReturnValue(
      answered([
        row({
          index: 2,
          parsed: { unit: "pcs", costPrice: 1, sellingPrice: 2 },
          status: "needs_attention",
          errors: {
            name: "Invalid input: expected string, received undefined",
          },
        }),
      ]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    expect(screen.getByText("Name is missing")).toBeInTheDocument();
    expect(
      screen.queryByText(/expected string, received undefined/),
    ).not.toBeInTheDocument();
  });

  it("keeps the raw message reachable for a support conversation", async () => {
    const user = userEvent.setup();
    const raw = "Invalid input: expected number, received undefined";
    jobQuery.mockReturnValue(
      answered([
        row({
          index: 3,
          parsed: { name: "Rice 2 kg", unit: "pcs", costPrice: 1 },
          status: "needs_attention",
          errors: { sellingPrice: raw },
        }),
      ]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    // On the pill as a `title`…
    expect(screen.getByTitle(raw)).toHaveTextContent(
      "Selling price is missing",
    );

    // …and spelled out in the details, which is where support will look.
    await user.click(screen.getByRole("button", { name: "details" }));
    expect(screen.getByText(raw)).toBeInTheDocument();
  });

  it("numbers rows the way the reviewer's spreadsheet does", () => {
    // `index` is 0-based over data rows and line 1 of the file is the header,
    // so the spreadsheet number is index + 2 (contract Trap 6).
    jobQuery.mockReturnValue(answered([row({ index: 0 }), row({ index: 5 })]));

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("2");
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows a note on a ready row without styling it as a fault", () => {
    // Observation §3: `notes` are the good half, they already read well, and a
    // `ready` row can carry one. Styling it as a problem would send someone to
    // fix a row that is already fine.
    const note =
      'Category "Grains" does not exist yet — it will be created on commit';
    jobQuery.mockReturnValue(
      answered([row({ index: 4, status: "ready", notes: [note] })]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    const pill = screen.getByText(note).closest("[data-tone]");
    expect(pill).toHaveAttribute("data-tone", "note");
    // The muted tone, not the warning or destructive tint a problem wears.
    expect(pill?.className).toContain("text-muted-foreground");
    expect(pill?.className).not.toContain("warning");
    expect(pill?.className).not.toContain("destructive");
  });
});

describe("ReviewStep — row actions", () => {
  it("skips a row through the DELETE endpoint", async () => {
    const user = userEvent.setup();
    jobQuery.mockReturnValue(
      answered([row({ index: 5, status: "needs_attention" })]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(skipRow).toHaveBeenCalledWith(
      { jobId: JOB_ID, index: 5 },
      expect.anything(),
    );
  });

  it("restores a skipped row with ONE field, not by echoing the defaults", async () => {
    // There is no un-skip endpoint; the undo is a `PATCH` (contract Trap 9).
    // The old advice to echo `unit`, `trackStock` and `quantity` on every patch
    // is stale — `Backend` 48c7205 stopped the zod defaults leaking, so echoing
    // them today writes three fields nobody touched, which is the exact
    // corruption that fix removed (`docs/findings/slice4-import-data.md` §1).
    const user = userEvent.setup();
    jobQuery.mockReturnValue(
      answered([
        row({
          index: 6,
          status: "skipped",
          parsed: {
            name: "Salt 500 g",
            unit: "kg",
            trackStock: true,
            quantity: 4,
          },
        }),
      ]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(patchRow).toHaveBeenCalledWith(
      { jobId: JOB_ID, index: 6, input: { unit: "kg" } },
      expect.anything(),
    );
  });

  it("offers no row actions once the job is no longer reviewing", () => {
    jobQuery.mockReturnValue(answered([row({ status: "needs_attention" })]));

    render(<ReviewStep jobId={JOB_ID} job={job({ status: "committed" })} />, {
      wrapper,
    });

    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  });
});

describe("ReviewStep — the six list states", () => {
  it("shows the request id when the rows cannot be read", () => {
    jobQuery.mockReturnValue({
      data: undefined,
      error: new ApiError({
        message: "Something went wrong",
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        requestId: "req_9f2",
      }),
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    expect(screen.getByText(/req_9f2/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("does not offer a retry on a 403, which would answer the same way", () => {
    jobQuery.mockReturnValue({
      data: undefined,
      error: new ApiError({
        message: "You do not have permission",
        status: 403,
        code: "FORBIDDEN",
      }),
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    expect(
      screen.getByText("You cannot review this import"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("distinguishes a filtered-empty list from an empty file", () => {
    // The filter lives in the URL, so this state is reachable by a shared link
    // and survives a reload — which is also what makes it settable here.
    jobQuery.mockReturnValue(answered([], 0));

    render(<ReviewStep jobId={JOB_ID} job={job()} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?rowStatus=skipped" }),
    });

    expect(screen.getByText(/Nothing is skipped/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show all rows" }),
    ).toBeInTheDocument();
  });
});

describe("ReviewStep — conflicts", () => {
  it("names the existing product and invents no price or quantity", () => {
    // Observation §2: the conflict object has two keys and no more. The design
    // draws "(USD 12.40, 3 pcs)" beside the name; those figures are not on the
    // wire, so nothing here may show them until someone asks for them.
    jobQuery.mockReturnValue(
      answered([
        row({
          index: 19,
          status: "conflict",
          parsed: {
            name: "Coca-Cola 500ml",
            barcode: "5449000000996",
            unit: "pcs",
            costPrice: 0.5,
            sellingPrice: 0.9,
          },
          conflict: {
            existingProductId: "6aa178be2f7394082d889c7b",
            existingName: "Coca-Cola 500ml (crate)",
          },
        }),
      ]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    const banner = screen.getByText(/already belongs to/).closest("p");
    expect(banner).toHaveTextContent("Row 21");
    expect(banner).toHaveTextContent("Coca-Cola 500ml (crate)");
    // The imported row's own price must never stand in for the existing
    // product's — they are different numbers and comparing them is the point.
    expect(banner).not.toHaveTextContent("0.90");

    // Scoped to the banner: the row above it has a Skip action of its own, and
    // the two mean different things — one drops the row from the import, the
    // other leaves the live product alone.
    const panel = banner?.closest(
      '[data-slot="import-conflict"]',
    ) as HTMLElement;
    expect(
      within(panel).getByRole("button", { name: "Skip" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Update existing" }),
    ).toBeInTheDocument();
  });

  it("says the count will not move once a conflict is decided", () => {
    // `resolveConflict` writes `conflict.resolution` and leaves
    // `status: "conflict"` (`product-import.service.ts:434`), so the badge and
    // the tab count both stay where they were. Silence there reads as a failed
    // save.
    jobQuery.mockReturnValue(
      answered([
        row({
          index: 19,
          status: "conflict",
          parsed: { name: "Coca-Cola 500ml", barcode: "5449000000996" },
          conflict: {
            existingProductId: "6aa178be2f7394082d889c7b",
            existingName: "Coca-Cola 500ml (crate)",
            resolution: "update",
          },
        }),
      ]),
    );

    render(<ReviewStep jobId={JOB_ID} job={job()} />, { wrapper });

    expect(
      screen.getByText("Set to update the existing product"),
    ).toBeInTheDocument();
    expect(screen.getByText(/count will not go down/)).toBeInTheDocument();
    // And the tab still says 2, because that is the truth.
    expect(
      within(screen.getByRole("tab", { name: /Conflicts/ })).getByText("2"),
    ).toBeInTheDocument();
  });
});
