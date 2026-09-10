import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportJobDetail } from "@/features/product-import/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { ImportWizard } from "./import-wizard";

const importJob = vi.fn();
vi.mock("@/features/product-import/hooks/use-import-job", () => ({
  useImportJob: (id: string | undefined) => importJob(id),
}));

/**
 * Every step is stubbed. This file is about the shell's decisions — which step
 * is showing, what the rail says, and what happens to a job that is gone — and
 * each step has its own spec next door.
 */
vi.mock("./upload-step", () => ({
  UploadStep: ({ onUploaded }: { onUploaded: (id: string) => void }) => (
    <button type="button" onClick={() => onUploaded("j1")}>
      stub upload
    </button>
  ),
}));

vi.mock("./previous-jobs", () => ({
  PreviousJobs: () => <div>stub previous jobs</div>,
}));

vi.mock("./column-map-step", () => ({
  ColumnMapStep: ({ onContinue }: { onContinue?: () => void }) => (
    <div>
      stub column map
      <button type="button" onClick={onContinue}>
        stub continue
      </button>
    </div>
  ),
}));

vi.mock("@/features/product-import/components/review-step", () => ({
  ReviewStep: () => <div>stub review</div>,
}));

vi.mock("@/features/product-import/components/commit-bar", () => ({
  CommitBar: () => <div>stub commit</div>,
}));

const job = (overrides: Partial<ImportJobDetail> = {}): ImportJobDetail => ({
  id: "j1",
  status: "reviewing",
  filename: "september-stock.csv",
  format: "csv",
  columnMap: {
    name: "Item Name",
    barcode: null,
    category: null,
    unit: null,
    costPrice: null,
    sellingPrice: null,
    quantity: null,
    lowStockThreshold: null,
    trackStock: null,
    description: null,
  },
  unmatchedHeaders: [],
  totalRows: 25,
  counts: { ready: 25, needsAttention: 0, conflict: 0, skipped: 0 },
  expiresAt: "2026-09-17T08:00:00.000Z",
  createdAt: "2026-09-10T08:00:00.000Z",
  updatedAt: "2026-09-10T08:00:00.000Z",
  rows: [],
  rowsMeta: { page: 1, limit: 20, total: 25, totalPages: 2 },
  ...overrides,
});

const settled = (data: ImportJobDetail) => ({
  data,
  error: null,
  isPending: false,
  refetch: vi.fn(),
});

const renderWizard = (search = "") =>
  render(<ImportWizard />, {
    // `hasMemory` so `setJobId` actually changes the URL the component reads
    // back; without it the adapter freezes the params and a step transition
    // would silently assert the old state.
    wrapper: withNuqsTestingAdapter({ searchParams: search, hasMemory: true }),
  });

/** The rail entry the wizard says is live. */
const currentStep = (): string | null => {
  const item = document.querySelector('li[aria-current="step"]');
  return item?.textContent ?? null;
};

beforeEach(() => {
  importJob.mockReset();
  importJob.mockReturnValue({
    data: undefined,
    error: null,
    isPending: true,
    refetch: vi.fn(),
  });
});

describe("ImportWizard", () => {
  it("opens on step 1 with the drop zone and the previous jobs beside it", () => {
    renderWizard();

    expect(currentStep()).toContain("Upload");
    expect(screen.getByText("stub upload")).toBeInTheDocument();
    expect(screen.getByText("stub previous jobs")).toBeInTheDocument();
    // Nothing is fetched until there is a job id in the URL.
    expect(importJob).not.toHaveBeenCalled();
  });

  /**
   * Columns before rows, and not as a matter of taste: `PATCH /columns`
   * re-derives every non-skipped row and destroys every manual fix, so the
   * only order in which a remap costs nothing is the one that settles the
   * mapping first.
   */
  it("moves to the mapping step once a file has been read", async () => {
    importJob.mockReturnValue(settled(job()));

    renderWizard();
    await userEvent.click(screen.getByText("stub upload"));

    expect(currentStep()).toContain("Map columns");
    expect(screen.getByText("stub column map")).toBeInTheDocument();
    expect(screen.queryByText("stub review")).toBeNull();
  });

  it("shows the review table and the commit bar together, as the artboard does", async () => {
    importJob.mockReturnValue(settled(job()));

    renderWizard("?job=j1");
    expect(screen.getByText("stub column map")).toBeInTheDocument();

    await userEvent.click(screen.getByText("stub continue"));

    expect(currentStep()).toContain("Review rows");
    expect(screen.getByText("stub review")).toBeInTheDocument();
    expect(screen.getByText("stub commit")).toBeInTheDocument();
    expect(screen.queryByText("stub column map")).toBeNull();
  });

  it("can go back to the columns from the review", async () => {
    importJob.mockReturnValue(settled(job()));

    renderWizard("?job=j1");
    await userEvent.click(screen.getByText("stub continue"));
    await userEvent.click(
      screen.getByRole("button", { name: /back to columns/i }),
    );

    expect(screen.getByText("stub column map")).toBeInTheDocument();
  });

  /**
   * A 404 covers three different histories the API cannot tell apart, and the
   * seven-day TTL makes "it aged out" the likeliest by a distance — which the
   * server's own "Import job not found" does not hint at even slightly.
   */
  it("reads a 404 as an expired or cancelled job, and offers a way on", () => {
    importJob.mockReturnValue({
      data: undefined,
      error: new ApiError({
        message: "Import job not found",
        status: 404,
        code: API_ERROR_CODE.NOT_FOUND,
        requestId: "req-4",
      }),
      isPending: false,
      refetch: vi.fn(),
    });

    renderWizard("?job=j1");

    expect(screen.getByRole("alert")).toHaveTextContent(/seven days/i);
    expect(screen.getByText(/Request ID: req-4/)).toBeInTheDocument();
    // Retrying a 404 asks the same question and gets the same answer.
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /start a new import/i }),
    ).toBeInTheDocument();
  });

  /**
   * Every mutating endpoint requires `reviewing`, so a committed job gets the
   * receipt `CommitBar` owns and none of the controls that would 409.
   */
  it("hands a committed job to the commit bar and shows no editing steps", () => {
    importJob.mockReturnValue(
      settled(
        job({
          status: "committed",
          result: { created: 20, updated: 3, skipped: 2 },
        }),
      ),
    );

    renderWizard("?job=j1");

    expect(currentStep()).toContain("Commit");
    expect(screen.getByText("stub commit")).toBeInTheDocument();
    expect(screen.queryByText("stub column map")).toBeNull();
    expect(screen.queryByText("stub review")).toBeNull();
  });

  it("keeps the job id in the URL so a reload does not lose the review", () => {
    importJob.mockReturnValue(settled(job()));

    renderWizard("?job=j1");
    expect(importJob).toHaveBeenCalledWith("j1");
  });
});
