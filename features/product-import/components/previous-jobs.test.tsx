import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportJobSummary } from "@/features/product-import/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { expiryLabel, PreviousJobs } from "./previous-jobs";

const jobs = vi.fn();
vi.mock("@/features/product-import/hooks/use-import-jobs", () => ({
  useImportJobs: () => jobs(),
}));

const cancel = vi.fn();
vi.mock("@/features/product-import/hooks/use-import-mutations", () => ({
  useCancelImport: () => cancel(),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "USD",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

const mutate = vi.fn();
const reset = vi.fn();
const onOpen = vi.fn();

const NOW = new Date("2026-09-10T09:00:00.000Z");

const summary = (
  overrides: Partial<ImportJobSummary> = {},
): ImportJobSummary => ({
  id: "6512ab34cd56ef7890123456",
  status: "reviewing",
  filename: "september-stock.xlsx",
  format: "xlsx",
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
  totalRows: 195,
  counts: { ready: 180, needsAttention: 12, conflict: 3, skipped: 0 },
  // Uploaded a little over a day ago, so six of the seven days are left —
  // the artboard's own "expires in 6 d".
  expiresAt: "2026-09-16T08:00:00.000Z",
  createdAt: "2026-09-09T08:00:00.000Z",
  updatedAt: "2026-09-09T08:00:00.000Z",
  ...overrides,
});

const answered = (items: ImportJobSummary[]) => ({
  data: {
    items,
    meta: { page: 1, limit: 5, total: items.length, totalPages: 1 },
  },
  error: null,
  isPending: false,
  isPlaceholderData: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  mutate.mockReset();
  reset.mockReset();
  onOpen.mockReset();
  cancel.mockReturnValue({ mutate, reset, isPending: false });
  jobs.mockReturnValue(answered([summary()]));
});

describe("expiryLabel", () => {
  /**
   * Days round **up**, because a job with 5 d 23 h left dies during its sixth
   * day from now and "5 d" is an hour-accurate lie about which day that is.
   */
  it("rounds days up and switches unit inside the last day", () => {
    const from = (ms: number) =>
      expiryLabel(new Date(NOW.getTime() + ms).toISOString(), NOW);

    expect(from(7 * 86_400_000)).toBe("expires in 7 d");
    expect(from(5 * 86_400_000 + 23 * 3_600_000)).toBe("expires in 6 d");
    expect(from(5 * 3_600_000)).toBe("expires in 5 h");
    expect(from(10 * 60_000)).toBe("expires within the hour");
  });

  /**
   * Mongo's TTL monitor runs about once a minute, so a job whose `expiresAt`
   * has passed is often still readable. The label tells the truth anyway.
   */
  it("says expired the moment the instant passes, ahead of the 404", () => {
    expect(expiryLabel(new Date(NOW.getTime() - 1000).toISOString(), NOW)).toBe(
      "expired",
    );
  });
});

describe("PreviousJobs", () => {
  it("shows format, row count, status and the expiry the artboard draws", () => {
    render(<PreviousJobs onOpen={onOpen} now={NOW} />);

    expect(screen.getByText("XLSX")).toBeInTheDocument();
    expect(screen.getByText("195 rows")).toBeInTheDocument();
    expect(screen.getByText("Reviewing")).toBeInTheDocument();
    expect(screen.getByText("expires in 6 d")).toBeInTheDocument();
  });

  it("resumes a reviewing job when its row is pressed", async () => {
    render(<PreviousJobs onOpen={onOpen} now={NOW} />);
    await userEvent.click(
      screen.getByRole("button", { name: /resume the import/i }),
    );

    expect(onOpen).toHaveBeenCalledWith("6512ab34cd56ef7890123456");
  });

  /**
   * Every mutating endpoint requires `reviewing`, so a committed job has
   * nothing this wizard can do with it — opening one would be a screen of
   * controls that all 409. It shows the commit date instead of an expiry,
   * exactly as the artboard's second row does.
   */
  it("leaves a committed job inert and dates it instead of counting down", () => {
    jobs.mockReturnValue(
      answered([
        summary({
          id: "j2",
          status: "committed",
          format: "csv",
          totalRows: 412,
          committedAt: "2026-09-02T11:30:00.000Z",
        }),
      ]),
    );

    render(<PreviousJobs onOpen={onOpen} now={NOW} />);

    expect(screen.getByText("Committed")).toBeInTheDocument();
    expect(screen.getByText("02 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /cancel the import/i }),
    ).toBeNull();
  });

  /**
   * Cancelling stops everything staged in the job from ever being imported and
   * there is no un-cancel, so it asks first — and it says the thing that is
   * easy to get wrong: the job is not deleted, it stays in this list.
   */
  it("asks before cancelling, and only then calls the API", async () => {
    render(<PreviousJobs onOpen={onOpen} now={NOW} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: /cancel the import of september-stock/i,
      }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(/stays in this list as cancelled/i),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /stop the import/i }),
    );
    expect(mutate).toHaveBeenCalledWith(
      "6512ab34cd56ef7890123456",
      expect.anything(),
    );
  });

  it("puts a refused cancel inside the dialog that asked for it", async () => {
    mutate.mockImplementation(
      (_id: string, options: { onError: (error: ApiError) => void }) => {
        options.onError(
          new ApiError({
            message: "This import has already been committed or cancelled",
            status: 409,
            code: API_ERROR_CODE.IMPORT_NOT_REVIEWING,
          }),
        );
      },
    );

    render(<PreviousJobs onOpen={onOpen} now={NOW} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: /cancel the import of september-stock/i,
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /stop the import/i }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/another tab/i);
  });

  it("carries the request id when the list itself fails", () => {
    jobs.mockReturnValue({
      data: undefined,
      error: new ApiError({
        message: "Something went wrong",
        status: 500,
        code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
        requestId: "req-12",
      }),
      isPending: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    });

    render(<PreviousJobs onOpen={onOpen} now={NOW} />);
    expect(screen.getByText(/Request ID: req-12/)).toBeInTheDocument();
  });

  it("says what would put something here when nothing has been imported", () => {
    jobs.mockReturnValue(answered([]));

    render(<PreviousJobs onOpen={onOpen} now={NOW} />);
    expect(screen.getByText(/nothing imported yet/i)).toBeInTheDocument();
  });

  /**
   * The TTL has no partial filter, so a committed job's receipt dies seven
   * days after the **upload** like everything else. Someone who reads
   * "Committed" as "kept" will come looking for it in a fortnight.
   */
  it("warns that a committed import is cleared on the same seven-day clock", () => {
    render(<PreviousJobs onOpen={onOpen} now={NOW} />);
    expect(
      screen.getByText(/Committing does not extend that/i),
    ).toBeInTheDocument();
  });
});
